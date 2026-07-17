// Supabase Edge Function — SPEC-84d: one-click A2P SMS batch to the OPTED-IN pool.
//
// The founder's "send 50 at once" button. SMS-ONLY, CONSENTED-ONLY: it sends only
// to leads with outreach_status='opted_in' (never 'queued' cold leads). Gated by
// OUTREACH_SMS_ENABLED — until the A2P campaign is VERIFIED and the flag is on, it
// reports PENDING and sends nothing (no fake "sent"). Admin-JWT gated. Twilio
// Messaging Service auto-honors STOP.
//
// Body: { dry: true }  → counts the opted-in pool (nothing sent)
//       { send: true, limit? } → sends up to `limit` (default 50, max 200)
// Secrets: SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY,
//          TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_MESSAGING_SERVICE_SID,
//          OUTREACH_SMS_ENABLED, ADMIN_EMAILS.
import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4?target=deno&deno-std=0.224.0';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const DEFAULT_ADMINS = ['t@cergio.ai', 'info@cergio.ai'];
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...cors, 'Content-Type': 'application/json' } });
const toE164 = (p: string) => {
  const d = String(p || '').replace(/[^\d+]/g, '');
  if (!d) return '';
  if (d.startsWith('+')) return d;
  if (d.length === 10) return '+1' + d;
  if (d.length === 11 && d.startsWith('1')) return '+' + d;
  return d.startsWith('+') ? d : '+' + d;
};

serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  try {
    const url = Deno.env.get('SUPABASE_URL')!;
    const anon = Deno.env.get('SUPABASE_ANON_KEY')!;
    const svc = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

    // Admin gate (caller's JWT).
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) return json({ error: 'Not signed in' }, 401);
    const supaUser = createClient(url, anon, { global: { headers: { Authorization: authHeader } } });
    const { data: u } = await supaUser.auth.getUser();
    const email = (u?.user?.email || '').toLowerCase();
    const admins = (Deno.env.get('ADMIN_EMAILS') || DEFAULT_ADMINS.join(',')).split(',').map(s => s.trim().toLowerCase()).filter(Boolean);
    if (!email || !admins.includes(email)) return json({ error: 'Forbidden' }, 403);

    const db = createClient(url, svc);
    const body = await req.json().catch(() => ({}));
    const smsEnabled = (Deno.env.get('OUTREACH_SMS_ENABLED') || 'false').toLowerCase() === 'true';

    // DRY: count the consented pool.
    if (body?.dry) {
      const svcCount = await db.from('leads_services').select('id', { count: 'exact', head: true }).eq('outreach_status', 'opted_in').not('phone', 'is', null);
      const infCount = await db.from('leads_influencers').select('ig_handle', { count: 'exact', head: true }).eq('outreach_status', 'opted_in').not('phone', 'is', null);
      const s = svcCount.count || 0, c = infCount.count || 0;
      return json({ dry: true, opted_in_services: s, opted_in_creators: c, total: s + c, sms_enabled: smsEnabled });
    }

    if (!body?.send) return json({ error: 'pass {dry:true} or {send:true}' }, 400);

    // SEND — consented pool only, gated.
    if (!smsEnabled) return json({ sent: 0, pending: 'OUTREACH_SMS_ENABLED is off — flip it only after the A2P campaign is VERIFIED, then a test to your phone.' });
    const twSid = Deno.env.get('TWILIO_ACCOUNT_SID');
    const twTok = Deno.env.get('TWILIO_AUTH_TOKEN');
    const twFrom = Deno.env.get('TWILIO_MESSAGING_SERVICE_SID');
    if (!(twSid && twTok && twFrom)) return json({ sent: 0, pending: 'Twilio creds not fully set' });

    const BATCH = Math.min(Math.max(1, Number(body.limit) || 50), 200);
    let sent = 0; const results: Array<Record<string, unknown>> = [];
    const auth = 'Basic ' + btoa(`${twSid}:${twTok}`);
    const send = async (e164: string, text: string) => {
      const form = new URLSearchParams();
      form.set('To', e164); form.set('MessagingServiceSid', twFrom!); form.set('Body', text);
      const r = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${twSid}/Messages.json`, {
        method: 'POST', headers: { Authorization: auth, 'Content-Type': 'application/x-www-form-urlencoded' }, body: form,
      });
      return r.ok ? { ok: true } : { ok: false, error: (await r.text().catch(() => '')).slice(0, 160) };
    };
    const suppressed = async (e164: string) => {
      const { data } = await db.from('outreach_suppressions').select('id').eq('channel', 'sms').ilike('address', e164).maybeSingle();
      return !!data;
    };

    // Services (opted-in, with phone).
    const { data: svcRows } = await db.from('leads_services').select('id, name, service_type, phone').eq('outreach_status', 'opted_in').not('phone', 'is', null).limit(BATCH);
    for (const r of svcRows ?? []) {
      const e164 = toE164(r.phone); if (!e164) continue;
      if (await suppressed(e164)) { await db.from('leads_services').update({ outreach_status: 'do_not_contact' }).eq('id', r.id); continue; }
      const body_ = `Hi${r.name ? ' ' + r.name : ''} — Tarik at Cergio. Thanks for opting in! We're onboarding founding ${r.service_type || 'providers'} now — reply YES and I'll get you set up. Reply STOP to opt out. (Cergio)`;
      const out = await send(e164, body_);
      if (out.ok) { sent++; await db.from('leads_services').update({ outreach_status: 'sent', outreach_last_at: new Date().toISOString() }).eq('id', r.id); results.push({ id: r.id, to: e164 }); }
      else results.push({ id: r.id, to: e164, error: out.error });
    }
    // Creators (opted-in, with phone) — fill remaining headroom.
    const remain = Math.max(0, BATCH - (svcRows?.length || 0));
    if (remain > 0) {
      const { data: infRows } = await db.from('leads_influencers').select('ig_handle, phone').eq('outreach_status', 'opted_in').not('phone', 'is', null).limit(remain);
      for (const r of infRows ?? []) {
        const e164 = toE164(r.phone); if (!e164) continue;
        if (await suppressed(e164)) { await db.from('leads_influencers').update({ outreach_status: 'do_not_contact' }).eq('ig_handle', r.ig_handle); continue; }
        const body_ = `Hi @${r.ig_handle} — Tarik at Cergio. Thanks for opting in! Onboarding founding creators now — reply YES to start. Reply STOP to opt out. (Cergio)`;
        const out = await send(e164, body_);
        if (out.ok) { sent++; await db.from('leads_influencers').update({ outreach_status: 'sent', outreach_last_at: new Date().toISOString() }).eq('ig_handle', r.ig_handle); results.push({ ig: r.ig_handle, to: e164 }); }
        else results.push({ ig: r.ig_handle, to: e164, error: out.error });
      }
    }
    return json({ sent, batch: BATCH, results });
  } catch (e) {
    return json({ error: String((e as Error)?.message || e) }, 500);
  }
});
