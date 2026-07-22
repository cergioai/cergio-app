// Supabase Edge Function — SPEC-65 outreach sender (EMAIL, CAN-SPAM compliant).
//
// Auto-emails newly-sourced businesses (leads_services) with a genuine partner
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

// ── BLOCKED-category TERMINAL guard (defense-at-the-exit, catalog #72/#73). ───
// Seeders + fulfill-crawl each filter blocked categories, but that coverage is
// per-INGEST-PATH: a restored, hand-inserted, ad-source, or legacy row can still
// reach outreach_status='queued' (e.g. a "Head Spa" with service_type "massage").
// This is the LAST gate before a message leaves, so it re-checks EVERY recipient
// regardless of how it was queued, and quarantines the row (-> do_not_contact) so
// it can never re-surface. Mirrors fulfill-crawl's OSM_BLOCKED net + the #72
// weight-loss/peptide additions. Matches on name || service_type (either field
// can carry the category). Constitution brand-safety: free-first, on-brand only.
const OUTREACH_BLOCKED = new RegExp(
  '(massage|tattoo|makeup|\\bpersonal chef\\b|private chef' +
  '|weight ?loss|peptide|bariatric|semaglutide|ozempic|wegovy|tirzepatide' +
  '|med.?spa|medspa|botox|filler|injectable|liposuction|\\bBBL\\b|dermatolog' +
  '|hormone|\\bHRT\\b|\\bIV ?drip\\b|\\bIV ?therapy\\b' +
  '|plastic surgery|cosmetic surgery|\\bsurgeon\\b' +
  '|\\bdrug\\b|pharmac|cannabis|dispensary|marijuana' +
  '|liquor|\\bwine\\b|brewery|winery|distillery|\\bwine bar\\b|cocktail bar' +
  '|tobacco|smoke shop|\\bvape\\b|\\bcigar\\b' +
  '|casino|gambling|\\bbetting\\b|firearm|\\bgun\\b|\\bammo\\b' +
  '|\\bescort\\b|strip club|nightclub|night club|disc jockey|\\bdj\\b)',
  'i',
);
function outreachIsBlocked(a?: string | null, b?: string | null): boolean {
  return OUTREACH_BLOCKED.test(`${a || ''} ${b || ''}`);
}

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

    // SAFETY: ?dry=1 reports how many would be contacted without sending; ?test=
    // <email> sends ONE sample to that address only (no DB writes) so you can
    // see exactly what businesses receive + check deliverability before any blast.
    const url = new URL(req.url);
    const dry = url.searchParams.get('dry') === '1';
    const test = url.searchParams.get('test');
    if (dry) {
      const { count: emailable } = await db.from('leads_services').select('id', { count: 'exact', head: true })
        .eq('outreach_status', 'queued').not('owner_email', 'is', null);
      const { count: phoneOnly } = await db.from('leads_services').select('id', { count: 'exact', head: true })
        .eq('outreach_status', 'queued').is('owner_email', null).not('phone', 'is', null);
      const { count: suppressed } = await db.from('outreach_suppressions').select('id', { count: 'exact', head: true });
      return json({ dry: true, emailable, sms_phone_only: phoneOnly, suppressed, batch_per_run: BATCH });
    }
    if (test) {
      const sample = { name: 'Your Business', service_type: 'plumber', city: 'Miami' };
      const token = await hmac(test, optoutSecret);
      const optoutUrl = `${FUNCTIONS_BASE}/outreach-optout?c=email&a=${encodeURIComponent(test)}&k=${token}`;
      const optinUrl  = `${FUNCTIONS_BASE}/outreach-optin?t=biz&a=${encodeURIComponent(test)}&k=${token}`;
      const r = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${resendKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ from, to: test, reply_to: replyTo, subject: '[TEST] Cergio soft-launch preview', html: renderEmail(sample, optinUrl, optoutUrl, postal) }),
      });
      return json({ test_sent_to: test, ok: r.ok });
    }

    // ── Manual WhatsApp generator (?wa=1) ────────────────────────────────────
    // FREE, COMPLIANT soft-launch channel: returns tap-to-send wa.me click-to-chat
    // links (message pre-filled, incl. the per-recipient opt-in link) for phone
    // leads. The FOUNDER taps each one and sends personally from WhatsApp — no
    // bulk send, no API, no ban risk. Read-only: does NOT change lead status or
    // send anything. `limit` (default 50) caps the batch so daily volume stays
    // human. Excludes do_not_contact + already opted_in.
    if (url.searchParams.get('wa') === '1') {
      const limit = Math.min(parseInt(url.searchParams.get('limit') || '50', 10) || 50, 200);
      const waLink = (e164: string, msg: string) =>
        `https://wa.me/${e164.replace(/[^\d]/g, '')}?text=${encodeURIComponent(msg)}`;
      const out: Array<Record<string, unknown>> = [];

      const { data: bizs } = await db.from('leads_services')
        .select('id, name, service_type, city, phone, outreach_status')
        .not('phone', 'is', null).eq('outreach_status', 'queued')
        .limit(limit);
      for (const b of bizs ?? []) {
        const e164 = toE164(b.phone); if (!e164) continue;
        if (outreachIsBlocked(b.name, b.service_type)) continue; // never surface a blocked category in the tap-queue
        const { data: supp } = await db.from('outreach_suppressions').select('id').eq('channel', 'sms').ilike('address', e164).maybeSingle();
        if (supp) continue;
        const tok = await hmac(e164, optoutSecret);
        const optinUrl = `${FUNCTIONS_BASE}/outreach-optin?t=biz&a=${encodeURIComponent(e164)}&k=${tok}`;
        const msg = `Hi${b.name ? ' ' + b.name : ''} — Tarik, founder of Cergio. Hand-picking 25 founding services${b.city ? ' in ' + b.city : ''}: free Instagram spotlights from local Creators for 1 free ${b.service_type || 'service'}, plus $250 per client you invite + booking priority. Turn your network into earnings. Want a spot? ${optinUrl}`;
        out.push({ type: 'business', name: b.name, phone: e164, wa_url: waLink(e164, msg) });
      }

      const { data: infs } = await db.from('leads_influencers')
        .select('ig_handle, city, phone, outreach_status')
        .not('phone', 'is', null).eq('outreach_status', 'queued')
        .limit(limit);
      for (const inf of infs ?? []) {
        const e164 = toE164(inf.phone); if (!e164) continue;
        const { data: supp } = await db.from('outreach_suppressions').select('id').eq('channel', 'sms').ilike('address', e164).maybeSingle();
        if (supp) continue;
        const tok = await hmac(e164, optoutSecret);
        const optinUrl = `${FUNCTIONS_BASE}/outreach-optin?t=inf&a=${encodeURIComponent(e164)}&k=${tok}`;
        const msg = `Hi @${inf.ig_handle} — Tarik, founder of Cergio. I'm hand-picking 5 founding Creators${inf.city ? ' in ' + inf.city : ''} and I'd love for you to be one. To start it's simple: 1 free service for 1 spotlight. Beyond that, I'd love to work with you to refine how your network turns into real earnings. Want in? ${optinUrl}`;
        out.push({ type: 'creator', handle: inf.ig_handle, phone: e164, wa_url: waLink(e164, msg) });
      }
      return json({ whatsapp_manual: true, count: out.length, links: out });
    }

    // Candidates: sourced, never-contacted, have an email.
    const { data: leads, error } = await db
      .from('leads_services')
      .select('id, name, service_type, city, owner_email')
      .eq('outreach_status', 'queued')
      .not('owner_email', 'is', null)
      .limit(BATCH);
    if (error) throw error;

    let sent = 0, suppressed = 0;
    const results: Array<Record<string, unknown>> = [];
    for (const lead of leads ?? []) {
      const email = String(lead.owner_email).trim().toLowerCase();
      if (!email || !email.includes('@')) continue;

      // TERMINAL blocked-category guard - never email a blocked category; quarantine it.
      if (outreachIsBlocked(lead.name, lead.service_type)) {
        await db.from('leads_services').update({ outreach_status: 'do_not_contact' }).eq('id', lead.id);
        suppressed++; continue;
      }

      // Suppression check (never contact opt-outs).
      const { data: supp } = await db
        .from('outreach_suppressions')
        .select('id').eq('channel', 'email').ilike('address', email).maybeSingle();
      if (supp) {
        await db.from('leads_services').update({ outreach_status: 'do_not_contact' }).eq('id', lead.id);
        suppressed++; continue;
      }

      const token = await hmac(email, optoutSecret);
      const optoutUrl = `${FUNCTIONS_BASE}/outreach-optout?c=email&a=${encodeURIComponent(email)}&k=${token}`;
      const optinUrl  = `${FUNCTIONS_BASE}/outreach-optin?t=biz&a=${encodeURIComponent(email)}&k=${token}`;
      const html = renderEmail(lead, optinUrl, optoutUrl, postal);
      const subject = `Free IG spotlights for your ${lead.service_type || 'service'} — founding (25 spots)`;

      const r = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${resendKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          from, to: email, reply_to: replyTo, subject, html,
          headers: { 'List-Unsubscribe': `<${optoutUrl}>`, 'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click' },
        }),
      });
      if (r.ok) {
        await db.from('leads_services').update({ outreach_status: 'sent', outreach_last_at: new Date().toISOString() }).eq('id', lead.id);
        sent++; results.push({ id: lead.id, email });
      } else {
        const t = await r.text().catch(() => '');
        results.push({ id: lead.id, email, error: t.slice(0, 200) });
      }
    }

    // ── Influencers — email (SPEC-67) ─────────────────────────────────────────
    // Same compliant email, creator-flavored copy, to influencers whose public
    // business contact email we have. Keyed by ig_handle.
    let infEmail = 0;
    {
      const { data: infs } = await db
        .from('leads_influencers')
        .select('ig_handle, followers, email, city')
        .eq('outreach_status', 'queued')
        .not('email', 'is', null)
        .limit(BATCH);
      for (const inf of infs ?? []) {
        const email = String(inf.email).trim().toLowerCase();
        if (!email || !email.includes('@')) continue;
        // TERMINAL blocked-category guard (creator email path) - handle is the only text we have.
        if (outreachIsBlocked(inf.ig_handle, null)) {
          await db.from('leads_influencers').update({ outreach_status: 'do_not_contact' }).eq('ig_handle', inf.ig_handle); continue;
        }
        const { data: supp } = await db.from('outreach_suppressions').select('id').eq('channel', 'email').ilike('address', email).maybeSingle();
        if (supp) { await db.from('leads_influencers').update({ outreach_status: 'do_not_contact' }).eq('ig_handle', inf.ig_handle); continue; }
        const token = await hmac(email, optoutSecret);
        const optoutUrl = `${FUNCTIONS_BASE}/outreach-optout?c=email&a=${encodeURIComponent(email)}&k=${token}`;
        const optinUrl  = `${FUNCTIONS_BASE}/outreach-optin?t=inf&a=${encodeURIComponent(email)}&k=${token}`;
        const r = await fetch('https://api.resend.com/emails', {
          method: 'POST',
          headers: { 'Authorization': `Bearer ${resendKey}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            from, to: email, reply_to: replyTo,
            subject: `An invite — 1 of 5 founding Cergio creators`,
            html: renderInfluencerEmail(inf, optinUrl, optoutUrl, postal),
            headers: { 'List-Unsubscribe': `<${optoutUrl}>`, 'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click' },
          }),
        });
        if (r.ok) {
          await db.from('leads_influencers').update({ outreach_status: 'sent', outreach_last_at: new Date().toISOString() }).eq('ig_handle', inf.ig_handle);
          infEmail++;
        }
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
    // Prefer API Key auth (username = API Key SID, password = Secret); AccountSid
    // stays in the URL. Falls back to AccountSid:AuthToken (Tarik 2026-06-26).
    const twAuthUser = Deno.env.get('TWILIO_API_KEY_SID') || twSid;
    const twAuthPass = Deno.env.get('TWILIO_API_KEY_SECRET') || twTok;
    const twFrom = Deno.env.get('TWILIO_MESSAGING_SERVICE_SID') || Deno.env.get('TWILIO_FROM_NUMBER');
    if (smsEnabled && twSid && twAuthUser && twAuthPass && twFrom) {
      const { data: smsLeads } = await db
        .from('leads_services')
        .select('id, name, service_type, city, phone')
        .eq('outreach_status', 'queued')
        .is('owner_email', null)
        .not('phone', 'is', null)
        .limit(BATCH);
      for (const lead of smsLeads ?? []) {
        const e164 = toE164(lead.phone);
        if (!e164) continue;
        // TERMINAL blocked-category guard (SMS path).
        if (outreachIsBlocked(lead.name, lead.service_type)) {
          await db.from('leads_services').update({ outreach_status: 'do_not_contact' }).eq('id', lead.id); continue;
        }
        const { data: supp } = await db
          .from('outreach_suppressions').select('id').eq('channel', 'sms').ilike('address', e164).maybeSingle();
        if (supp) { await db.from('leads_services').update({ outreach_status: 'do_not_contact' }).eq('id', lead.id); continue; }
        const smsTok = await hmac(e164, optoutSecret);
        const optinUrl = `${FUNCTIONS_BASE}/outreach-optin?t=biz&a=${encodeURIComponent(e164)}&k=${smsTok}`;
        const body = `Hi${lead.name ? ' ' + lead.name : ''} — Tarik, founder of Cergio. 25 founding spots: free IG spotlights from local Creators for 1 free ${lead.service_type || 'service'}, + $250 per client you invite + priority. Want a spot? ${optinUrl} Reply STOP to opt out. (Cergio/Yogotoo)`;
        const form = new URLSearchParams();
        form.set(twFrom!.startsWith('MG') ? 'MessagingServiceSid' : 'From', twFrom!);
        form.set('To', e164); form.set('Body', body);
        const r = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${twSid}/Messages.json`, {
          method: 'POST',
          headers: { 'Authorization': 'Basic ' + btoa(`${twAuthUser}:${twAuthPass}`), 'Content-Type': 'application/x-www-form-urlencoded' },
          body: form.toString(),
        });
        if (r.ok) {
          await db.from('leads_services').update({ outreach_status: 'sent', outreach_last_at: new Date().toISOString() }).eq('id', lead.id);
          smsSent++; smsResult.push({ id: lead.id, to: e164 });
        } else {
          smsResult.push({ id: lead.id, to: e164, error: (await r.text().catch(() => '')).slice(0, 200) });
        }
      }

      // Influencers by SMS — have a phone, no email (SPEC-67).
      const { data: smsInf } = await db
        .from('leads_influencers')
        .select('ig_handle, city, phone')
        .eq('outreach_status', 'queued').is('email', null).not('phone', 'is', null).limit(BATCH);
      for (const inf of smsInf ?? []) {
        const e164 = toE164(inf.phone);
        if (!e164) continue;
        const { data: supp } = await db.from('outreach_suppressions').select('id').eq('channel', 'sms').ilike('address', e164).maybeSingle();
        if (supp) { await db.from('leads_influencers').update({ outreach_status: 'do_not_contact' }).eq('ig_handle', inf.ig_handle); continue; }
        const smsTok = await hmac(e164, optoutSecret);
        const optinUrl = `${FUNCTIONS_BASE}/outreach-optin?t=inf&a=${encodeURIComponent(e164)}&k=${smsTok}`;
        const body = `Hi @${inf.ig_handle} — Tarik, founder of Cergio. Hand-picking 5 founding Creators, would love you to be one. To start: 1 free service for 1 spotlight. Beyond that, let's refine how your network earns for you. Want in? ${optinUrl} Reply STOP to opt out. (Cergio/Yogotoo)`;
        const form = new URLSearchParams();
        form.set(twFrom!.startsWith('MG') ? 'MessagingServiceSid' : 'From', twFrom!);
        form.set('To', e164); form.set('Body', body);
        const r = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${twSid}/Messages.json`, {
          method: 'POST',
          headers: { 'Authorization': 'Basic ' + btoa(`${twAuthUser}:${twAuthPass}`), 'Content-Type': 'application/x-www-form-urlencoded' },
          body: form.toString(),
        });
        if (r.ok) {
          await db.from('leads_influencers').update({ outreach_status: 'sent', outreach_last_at: new Date().toISOString() }).eq('ig_handle', inf.ig_handle);
          smsSent++; smsResult.push({ ig: inf.ig_handle, to: e164 });
        }
      }
    }

    return json({
      candidates: (leads ?? []).length, sent, suppressed, results,
      influencers_emailed: infEmail,
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

// Big green tap target — the opt-in CTA. Tapping it records consent + drops the
// lead into the right "free" directory (see outreach-optin).
function ctaButton(url: string, label: string): string {
  const esc = (s: unknown) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  return `<p style="margin:20px 0">
    <a href="${esc(url)}" style="display:inline-block;background:#4AA901;color:#fff;text-decoration:none;
       font-weight:800;font-size:15px;padding:13px 22px;border-radius:24px">${esc(label)}</a>
  </p>`;
}

// Soft-launch CREATOR invite (SPEC-70): free services in exchange for an IG/TikTok
// spotlight. Sharp, founder-voiced, one tap to opt in.
function renderInfluencerEmail(inf: any, optinUrl: string, optoutUrl: string, postal: string): string {
  const esc = (s: unknown) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const handle = esc(inf.ig_handle || 'there');
  const city = esc(inf.city || 'your city');
  return `
  <div style="font-family:-apple-system,Segoe UI,Roboto,sans-serif;font-size:15px;color:#1a1a1a;line-height:1.5">
    <p>Hi @${handle},</p>
    <p>I'm Tarik, founder of <b>Cergio</b>. I'm hand-picking <b>5 founding Creators</b> in ${city}, and I'd love for you to be one.</p>
    <p>To start, it's simple: <b>1 free service for 1 spotlight</b>. Beyond that, I'd love to work with you to refine how your network turns into real earnings for you.</p>
    <p>Cergio books the services friends actually trust. Want in?</p>
    ${ctaButton(optinUrl, 'Count me in →')}
    <p style="color:#555">Or just reply — I read every message.</p>
    <p>— Tarik</p>
    <hr style="border:none;border-top:1px solid #eee;margin:18px 0" />
    <p style="font-size:12px;color:#888">
      You're receiving this because your creator account lists a public contact for partnerships.
      Cergio is operated by Yogotoo. ${esc(postal)}.<br/>
      <a href="${esc(optoutUrl)}" style="color:#888">Unsubscribe / don't contact me</a> — one click, honored immediately.
    </p>
  </div>`;
}

// Soft-launch BUSINESS invite (SPEC-70): give one free service to a local creator
// in exchange for a spotlight to their network.
function renderEmail(lead: any, optinUrl: string, optoutUrl: string, postal: string): string {
  const esc = (s: unknown) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const name = esc(lead.name || 'there');
  const type = esc(lead.service_type || 'service');
  const city = esc(lead.city || 'your area');
  return `
  <div style="font-family:-apple-system,Segoe UI,Roboto,sans-serif;font-size:15px;color:#1a1a1a;line-height:1.5">
    <p>Hi ${name},</p>
    <p>I'm Tarik, founder of <b>Cergio</b>. I'm hand-picking <b>25 founding services</b> for our beta in ${city}.</p>
    <p>You'll get <b>free Instagram spotlights</b> from local Creators in exchange for <b>1 free ${type}</b>, plus <b>$250 per client you invite</b> and <b>priority on bookings</b>.</p>
    <p>Turn your network into referrals and earnings. Cergio books the services friends and locals trust.</p>
    ${ctaButton(optinUrl, 'Claim my founding spot →')}
    <p style="color:#555">Tap above, or just reply — I read every message.</p>
    <p>— Tarik, Cergio</p>
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
