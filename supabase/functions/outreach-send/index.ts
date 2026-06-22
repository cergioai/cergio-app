// Supabase Edge Function — SPEC-65 outreach sender (EMAIL, CAN-SPAM compliant).
//
// Auto-emails newly-sourced businesses (leads_localbiz) with a genuine partner
// invite. Every message includes: honest sender identity, the legal business
// postal address, and a one-click unsubscribe. Before EVERY send we check the
// outreach_suppressions list; we send at most once per lead; we throttle per run.
//
// EMAIL is the only channel auto-enabled here. SMS/WhatsApp are intentionally
// NOT sent by this function:
//   • SMS needs 10DLC brand/campaign registration or carriers block it, and a
//     published number is not TCPA consent. Wire SMS only after registration.
//   • WhatsApp Business Platform forbids cold (non-opted-in) messaging and bans
//     accounts that do it; use it for replied/opted-in contacts only.
//
// AUTH: service-role bearer only (cron / "Send Outreach.command").
// Secrets: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, RESEND_API_KEY,
//          OUTREACH_OPTOUT_SECRET (HMAC key for unsubscribe links).
// Config (env): OUTREACH_FROM (default 'Cergio <partners@cergio.ai>'),
//   OUTREACH_POSTAL_ADDRESS, OUTREACH_REPLY_TO, OUTREACH_EMAIL_ENABLED (default 'true').

import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4?target=deno&deno-std=0.224.0';

const BATCH = 40;
const FUNCTIONS_BASE = 'https://vjmwnbftfquyquwaklue.functions.supabase.co';
const DEFAULT_ADDRESS = 'Yogotoo / Cergio, 14 West 23rd, 5th Floor, New York, NY 10010';

serve(async (req: Request) => {
  if (req.method !== 'POST' && req.method !== 'GET') return new Response('Method not allowed', { status: 405 });
  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const serviceKey  = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const auth = (req.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '').trim();
    if (!auth || auth !== serviceKey) return json({ error: 'Unauthorized' }, 401);

    const emailEnabled = (Deno.env.get('OUTREACH_EMAIL_ENABLED') || 'true').toLowerCase() === 'true';
    if (!emailEnabled) return json({ skipped: 'OUTREACH_EMAIL_ENABLED is false' });

    const resendKey = Deno.env.get('RESEND_API_KEY');
    if (!resendKey) return json({ error: 'RESEND_API_KEY not set' }, 500);
    const optoutSecret = Deno.env.get('OUTREACH_OPTOUT_SECRET') || serviceKey;
    const from = Deno.env.get('OUTREACH_FROM') || 'Cergio <partners@cergio.ai>';
    const replyTo = Deno.env.get('OUTREACH_REPLY_TO') || 'partners@cergio.ai';
    const postal = Deno.env.get('OUTREACH_POSTAL_ADDRESS') || DEFAULT_ADDRESS;

    const db = createClient(supabaseUrl, serviceKey);

    // Candidates: sourced, never-contacted, have an email.
    const { data: leads, error } = await db
      .from('leads_localbiz')
      .select('id, name, service_type, city, owner_email')
      .eq('outreach_status', 'new')
      .not('owner_email', 'is', null)
      .limit(BATCH);
    if (error) throw error;

    let sent = 0, suppressed = 0;
    const results: Array<Record<string, unknown>> = [];
    for (const lead of leads ?? []) {
      const email = String(lead.owner_email).trim().toLowerCase();
      if (!email || !email.includes('@')) continue;

      // Suppression check (never contact opt-outs).
      const { data: supp } = await db
        .from('outreach_suppressions')
        .select('id').eq('channel', 'email').ilike('address', email).maybeSingle();
      if (supp) {
        await db.from('leads_localbiz').update({ outreach_status: 'do_not_contact' }).eq('id', lead.id);
        suppressed++; continue;
      }

      const token = await hmac(email, optoutSecret);
      const optoutUrl = `${FUNCTIONS_BASE}/outreach-optout?c=email&a=${encodeURIComponent(email)}&k=${token}`;
      const html = renderEmail(lead, optoutUrl, postal);
      const subject = `${lead.name ? lead.name + ' — ' : ''}get more local clients through Cergio`;

      const r = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${resendKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          from, to: email, reply_to: replyTo, subject, html,
          headers: { 'List-Unsubscribe': `<${optoutUrl}>`, 'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click' },
        }),
      });
      if (r.ok) {
        await db.from('leads_localbiz').update({ outreach_status: 'sent', outreach_last_at: new Date().toISOString() }).eq('id', lead.id);
        sent++; results.push({ id: lead.id, email });
      } else {
        const t = await r.text().catch(() => '');
        results.push({ id: lead.id, email, error: t.slice(0, 200) });
      }
    }

    // ── SMS channel (SPEC-66) ─────────────────────────────────────────────────
    // Tarik's call: text services/influencers who published a number to receive
    // client requests. SMS reaches leads we have a PHONE for but no email (so a
    // lead gets exactly ONE channel — email preferred, SMS fallback). Gated by
    // OUTREACH_SMS_ENABLED. It WILL NOT actually deliver until (a) Twilio creds
    // are set AND (b) US A2P 10DLC brand+campaign is registered — carriers block
    // unregistered traffic. Every text carries identity + "Reply STOP to opt
    // out" (Twilio Messaging Service auto-honors STOP); we also check our own
    // suppression list. TCPA risk is the operator's accepted business decision.
    let smsSent = 0, smsResult: Array<Record<string, unknown>> = [];
    const smsEnabled = (Deno.env.get('OUTREACH_SMS_ENABLED') || 'false').toLowerCase() === 'true';
    const twSid = Deno.env.get('TWILIO_ACCOUNT_SID');
    const twTok = Deno.env.get('TWILIO_AUTH_TOKEN');
    const twFrom = Deno.env.get('TWILIO_MESSAGING_SERVICE_SID') || Deno.env.get('TWILIO_FROM_NUMBER');
    if (smsEnabled && twSid && twTok && twFrom) {
      const { data: smsLeads } = await db
        .from('leads_localbiz')
        .select('id, name, service_type, city, phone')
        .eq('outreach_status', 'new')
        .is('owner_email', null)
        .not('phone', 'is', null)
        .limit(BATCH);
      for (const lead of smsLeads ?? []) {
        const e164 = toE164(lead.phone);
        if (!e164) continue;
        const { data: supp } = await db
          .from('outreach_suppressions').select('id').eq('channel', 'sms').ilike('address', e164).maybeSingle();
        if (supp) { await db.from('leads_localbiz').update({ outreach_status: 'do_not_contact' }).eq('id', lead.id); continue; }
        const body = `Hi${lead.name ? ' ' + lead.name : ''} — people near ${lead.city || 'you'} are looking for ${lead.service_type || 'your service'} on Cergio. Free to list & get local client requests: cergio.ai. Reply STOP to opt out. (Cergio/Yogotoo)`;
        const form = new URLSearchParams();
        form.set(twFrom!.startsWith('MG') ? 'MessagingServiceSid' : 'From', twFrom!);
        form.set('To', e164); form.set('Body', body);
        const r = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${twSid}/Messages.json`, {
          method: 'POST',
          headers: { 'Authorization': 'Basic ' + btoa(`${twSid}:${twTok}`), 'Content-Type': 'application/x-www-form-urlencoded' },
          body: form.toString(),
        });
        if (r.ok) {
          await db.from('leads_localbiz').update({ outreach_status: 'sent', outreach_last_at: new Date().toISOString() }).eq('id', lead.id);
          smsSent++; smsResult.push({ id: lead.id, to: e164 });
        } else {
          smsResult.push({ id: lead.id, to: e164, error: (await r.text().catch(() => '')).slice(0, 200) });
        }
      }
    }

    return json({
      candidates: (leads ?? []).length, sent, suppressed, results,
      sms: { enabled: smsEnabled, configured: !!(twSid && twTok && twFrom), sent: smsSent, results: smsResult },
    });
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
});

// Best-effort US phone normalization to E.164. Returns null if it can't.
function toE164(raw: string): string | null {
  const d = String(raw || '').replace(/[^\d+]/g, '');
  if (d.startsWith('+') && d.length >= 11) return d;
  const digits = d.replace(/\D/g, '');
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith('1')) return `+${digits}`;
  return null;
}

function renderEmail(lead: any, optoutUrl: string, postal: string): string {
  const esc = (s: unknown) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const name = esc(lead.name || 'there');
  const type = esc(lead.service_type || 'local service');
  const city = esc(lead.city || 'your area');
  return `
  <div style="font-family:-apple-system,Segoe UI,Roboto,sans-serif;font-size:15px;color:#1a1a1a;line-height:1.5">
    <p>Hi ${name},</p>
    <p>People in ${city} are searching for ${type} on <b>Cergio</b> — a network where neighbors book services their friends actually trust. A search for your category came up with no local provider yet, so I wanted to reach out.</p>
    <p>Listing is free, you only hear from real nearby clients, and connectors can spotlight you to their audience. If that's useful, just reply and I'll get you set up.</p>
    <p>— The Cergio team</p>
    <hr style="border:none;border-top:1px solid #eee;margin:18px 0" />
    <p style="font-size:12px;color:#888">
      You're receiving this because your business is publicly listed as a ${type} in ${city}.
      Cergio is operated by Yogotoo. ${esc(postal)}.<br/>
      <a href="${esc(optoutUrl)}" style="color:#888">Unsubscribe / don't contact me</a> — one click, honored immediately.
    </p>
  </div>`;
}

// HMAC-SHA256(address) -> hex, for tamper-proof unsubscribe links.
async function hmac(message: string, secret: string): Promise<string> {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(message.toLowerCase()));
  return [...new Uint8Array(sig)].map(b => b.toString(16).padStart(2, '0')).join('');
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}
