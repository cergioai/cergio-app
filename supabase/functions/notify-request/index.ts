// Supabase Edge Function — marketplace request notifications.
//
// CERGIO-GUARD (2026-06-12): Tarik — "need to receive an sms and email
// ... of these (connector requesting and service accepting)". Two events:
//
//   event 'created'  — a consumer posted a request; notify each matched
//                      provider by email (+SMS when phone + Twilio set).
//                      Caller passes the providerIds it already resolved
//                      via getProvidersForNotify (client fan-out logic
//                      stays the single source of matching truth).
//   event 'response' — a provider responded (offered/countered) to a
//                      request; notify the REQUESTER. This is the
//                      "info@cergio.ai accepted" confirm t@cergio.ai
//                      never received. Also writes a `notifications`
//                      row for the requester (kinds per
//                      NOTIFICATIONS_AUDIT.md § 3).
//
// Caller payloads:
//   { event: 'created',  requestId: string, providerIds: string[], app_url? }
//   { event: 'response', responseId: string, app_url? }
//
// Required secrets:
//   RESEND_API_KEY              — email (already set)
//   SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY (auto-populated)
//   TWILIO_ACCOUNT_SID / TWILIO_AUTH_TOKEN / TWILIO_FROM_NUMBER — SMS,
//     silently skipped when unset (same contract as notify-user).
//
// DELIVERABILITY: cergio.ai was verified in Resend on 2026-06-12
// (DKIM + SPF + MX on `send` subdomain via GoDaddy), so FROM_EMAIL
// uses notify@cergio.ai and mail delivers to any recipient.

import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4?target=deno&deno-std=0.224.0';

const corsHeaders = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const FROM_EMAIL       = 'Cergio <notify@cergio.ai>'; // verified domain 2026-06-12
const APP_URL_FALLBACK = 'https://cergio-app-cergio-s-projects.vercel.app';
const MAX_FANOUT       = 20; // hard cap per call — protects Resend quota

serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const serviceKey  = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supaAdmin   = createClient(supabaseUrl, serviceKey);

    const body    = await req.json().catch(() => ({} as any));
    const event   = body?.event;
    const appBase = (typeof body?.app_url === 'string' && body.app_url) || APP_URL_FALLBACK;

    if (event === 'created')  return await handleCreated(supaAdmin, body, appBase);
    if (event === 'response') return await handleResponse(supaAdmin, body, appBase);
    return json({ error: `unknown event: ${event}` }, 400);
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
});

// ── event: created — consumer request fan-out → providers ──────────────────
async function handleCreated(supaAdmin: any, body: any, appBase: string) {
  const requestId   = body?.requestId;
  const providerIds = Array.isArray(body?.providerIds) ? body.providerIds.slice(0, MAX_FANOUT) : [];
  if (!requestId) return json({ error: 'requestId required' }, 400);
  if (providerIds.length === 0) return json({ sent: 0, note: 'no providerIds' });

  const { data: request, error: rErr } = await supaAdmin
    .from('requests')
    .select(`
      id, service_type, description, location_text, created_at,
      requester:profiles!requests_requester_id_fkey ( id, display_name )
    `)
    .eq('id', requestId)
    .single();
  if (rErr || !request) return json({ error: 'request not found', detail: rErr?.message }, 404);

  const requesterName = request.requester?.display_name || 'A Cergio user';
  const serviceType   = request.service_type || 'service';
  const link          = `${appBase}/inbox`;
  const subject       = `${requesterName} needs a ${serviceType} near you — Cergio`;
  const lead          = `<strong>${escapeHtml(requesterName)}</strong> just posted a <strong>${escapeHtml(serviceType)}</strong> request${request.location_text ? ` near <strong>${escapeHtml(request.location_text)}</strong>` : ' near you'}. First to respond wins the job.`;
  const smsText       = `Cergio: ${requesterName} needs a ${serviceType}${request.location_text ? ` near ${request.location_text}` : ' near you'}. Respond: ${link}`;
  const textBody      =
    `${requesterName} needs a ${serviceType}\n` +
    (request.description ? `"${request.description}"\n` : '') +
    (request.location_text ? `Where: ${request.location_text}\n` : '') +
    `\nAccept, counter, or decline: ${link}\n`;

  const results: any[] = [];
  for (const pid of providerIds) {
    const r = await sendToProfile(supaAdmin, pid, {
      subject,
      heading:  'New request near you',
      lead,
      detail:   request.description ? `“${escapeHtml(request.description)}”` : null,
      cta:      'Accept or counter →',
      link,
      text:     textBody,
      sms:      smsText,
    });
    results.push({ pid, ...r });
  }
  return json({ event: 'created', sent: results.filter(r => r.email === 'sent').length, results });
}

// ── event: response — provider responded → requester ───────────────────────
async function handleResponse(supaAdmin: any, body: any, appBase: string) {
  const responseId = body?.responseId;
  if (!responseId) return json({ error: 'responseId required' }, 400);

  const { data: resp, error: rErr } = await supaAdmin
    .from('request_responses')
    .select(`
      id, request_id, responder_id, status, offered_price_cents, message,
      responder:profiles!request_responses_responder_id_fkey ( id, display_name ),
      service:services ( id, title, taxonomy_provider_type )
    `)
    .eq('id', responseId)
    .single();
  if (rErr || !resp) return json({ error: 'response not found', detail: rErr?.message }, 404);
  if (!['offered', 'countered'].includes(resp.status)) {
    return json({ skipped: `status ${resp.status} — only offered/countered notify the requester` });
  }

  const { data: request, error: qErr } = await supaAdmin
    .from('requests')
    .select('id, requester_id, service_type')
    .eq('id', resp.request_id)
    .single();
  if (qErr || !request?.requester_id) {
    return json({ error: 'parent request not found', detail: qErr?.message }, 404);
  }

  const providerName = resp.responder?.display_name || 'A provider';
  const serviceType  = request.service_type || 'service';
  const price        = resp.offered_price_cents;
  const priceLabel   = price != null ? ` — $${(price / 100).toFixed(0)}` : '';
  const accepted     = resp.status === 'offered';
  const link         = `${appBase}/inbox`;

  const subject = accepted
    ? `${providerName} accepted your ${serviceType} request — Cergio`
    : `${providerName} countered your ${serviceType} request${priceLabel} — Cergio`;
  const lead = accepted
    ? `<strong>${escapeHtml(providerName)}</strong> accepted your <strong>${escapeHtml(serviceType)}</strong> request${escapeHtml(priceLabel)}. View their profile and confirm to book.`
    : `<strong>${escapeHtml(providerName)}</strong> sent a counter-offer on your <strong>${escapeHtml(serviceType)}</strong> request${escapeHtml(priceLabel)}.`;
  const smsText = accepted
    ? `Cergio: ${providerName} accepted your ${serviceType} request${priceLabel}. Confirm: ${link}`
    : `Cergio: ${providerName} countered your ${serviceType} request${priceLabel}. Respond: ${link}`;
  const textBody =
    (accepted
      ? `${providerName} accepted your ${serviceType} request${priceLabel}.\n`
      : `${providerName} countered your ${serviceType} request${priceLabel}.\n`) +
    (resp.message ? `Message: "${resp.message}"\n` : '') +
    `\nReview: ${link}\n`;

  // In-app notification row (web notification surface) — kinds per
  // NOTIFICATIONS_AUDIT.md § 3 (#15 / #16).
  await supaAdmin.from('notifications').insert({
    profile_id: request.requester_id,
    kind:       accepted ? 'request_response_offered' : 'request_response_countered',
    body:       accepted
      ? `${providerName} accepted your ${serviceType} request${priceLabel}.`
      : `${providerName} countered your ${serviceType} request${priceLabel}.`,
    data: {
      request_id:   request.id,
      response_id:  resp.id,
      responder_id: resp.responder_id,
      service_id:   resp.service?.id ?? null,
      status:       resp.status,
      offered_price_cents: price ?? null,
      deep_link:    link,
    },
  });

  const sent = await sendToProfile(supaAdmin, request.requester_id, {
    subject,
    heading:  accepted ? 'Your request was accepted ✓' : 'You got a counter-offer',
    lead,
    detail:   resp.message ? `“${escapeHtml(resp.message)}”` : null,
    cta:      accepted ? 'View & confirm →' : 'Review counter →',
    link,
    text:     textBody,
    sms:      smsText,
  });
  return json({ event: 'response', ...sent });
}

// ── shared: resolve a profile's email (auth.users) + phone (profile_private),
//    send email via Resend + SMS via Twilio. Both best-effort. ──────────────
async function sendToProfile(supaAdmin: any, profileId: string, msg: {
  subject: string; heading: string; lead: string; detail: string | null;
  cta: string; link: string; text: string; sms: string;
}) {
  const out: Record<string, unknown> = {};

  // Email — auth.users holds the address; profiles doesn't carry it.
  const { data: authUser, error: aErr } = await supaAdmin.auth.admin.getUserById(profileId);
  const email = authUser?.user?.email || null;
  if (!email) {
    out.email = `no email (${aErr?.message || 'not found'})`;
  } else {
    const resendKey = Deno.env.get('RESEND_API_KEY');
    if (!resendKey) {
      out.email = 'skipped (RESEND_API_KEY not set)';
    } else {
      const r = await fetch('https://api.resend.com/emails', {
        method:  'POST',
        headers: { 'Authorization': `Bearer ${resendKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          from: FROM_EMAIL, to: [email], subject: msg.subject,
          html: htmlShell(msg), text: msg.text,
        }),
      });
      out.email = r.ok ? 'sent' : `error ${r.status}: ${(await r.text()).slice(0, 200)}`;
    }
  }

  // SMS — phone lives in profile_private (schema v4). Silently skipped
  // when unset or Twilio secrets missing — same contract as notify-user.
  const { data: priv } = await supaAdmin
    .from('profile_private')
    .select('phone')
    .eq('id', profileId)
    .maybeSingle();
  const phone = priv?.phone || null;
  if (phone) {
    const sid   = Deno.env.get('TWILIO_ACCOUNT_SID');
    const token = Deno.env.get('TWILIO_AUTH_TOKEN');
    const from  = Deno.env.get('TWILIO_FROM_NUMBER');
    if (sid && token && from) {
      const auth = btoa(`${sid}:${token}`);
      const r = await fetch(
        `https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`,
        {
          method:  'POST',
          headers: {
            'Authorization': `Basic ${auth}`,
            'Content-Type':  'application/x-www-form-urlencoded',
          },
          body: new URLSearchParams({ To: phone, From: from, Body: msg.sms }),
        },
      );
      out.sms = r.ok ? 'sent' : `error ${r.status}`;
    } else {
      out.sms = 'skipped (Twilio secrets not set)';
    }
  } else {
    out.sms = 'skipped (no phone on profile_private)';
  }

  return out;
}

function htmlShell(msg: { heading: string; lead: string; detail: string | null; cta: string; link: string }) {
  return `<!doctype html>
<html><body style="margin:0;padding:0;background:#F8F8F8;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;color:#111;">
  <div style="max-width:560px;margin:0 auto;padding:32px 24px;">
    <div style="text-align:center;margin-bottom:24px;">
      <div style="display:inline-block;width:36px;height:36px;border-radius:50%;background:#4AA901;color:white;line-height:36px;font-weight:800;letter-spacing:2px;">C</div>
      <p style="margin:8px 0 0;font-size:12px;font-weight:800;letter-spacing:2px;color:#4AA901;text-transform:uppercase;">Cergio AI</p>
    </div>
    <h2 style="font-size:22px;margin:0 0 8px;line-height:1.25;">${msg.heading}</h2>
    <p style="font-size:15px;color:#3A3A3A;margin:0 0 18px;">${msg.lead}</p>
    ${msg.detail ? `<div style="background:#fff;border:1px solid #E5E5E5;border-radius:14px;padding:16px 20px;margin:0 0 20px;font-size:14px;color:#3A3A3A;">${msg.detail}</div>` : ''}
    <div style="text-align:center;margin:24px 0;">
      <a href="${msg.link}" style="display:inline-block;background:#4AA901;color:white;text-decoration:none;font-weight:800;font-size:15px;padding:14px 32px;border-radius:24px;">${msg.cta}</a>
    </div>
    <p style="color:#9B9B9B;font-size:11px;line-height:1.5;text-align:center;margin-top:32px;">
      You're getting this because of activity on your Cergio account.<br/>
      Manage notifications in your profile.
    </p>
  </div>
</body></html>`;
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...corsHeaders },
  });
}

function escapeHtml(s: string): string {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
