// Supabase Edge Function — spotlight request email notifications.
//
// Triggered fire-and-forget from api.js (or from stripe-webhook for `paid`)
// whenever a spotlight_requests row transitions to a state someone needs
// to know about:
//   created   → Connector receives "{Provider} wants a spotlight from you"
//   countered → Provider receives "{Connector} offered $X — Save $Y vs $Z"
//   accepted  → Provider receives "{Connector} accepted your request"
//   declined  → Provider receives "{Connector} declined"
//   cancelled → Connector receives "{Provider} cancelled their request"
//   paid      → Connector receives "You got paid $X — post your spotlight"
//   posted    → Provider receives "{Connector} posted — please confirm" with link
//   confirmed → Connector receives "Provider confirmed — funds released"
//
// Caller payload:
//   { requestId: string, event: 'created'|'countered'|'accepted'|'declined'|'cancelled', app_url?: string }
//
// Required secrets (already pushed via Deploy Edge Functions.command):
//   RESEND_API_KEY, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY.

import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4?target=deno&deno-std=0.224.0';

const corsHeaders = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const FROM_EMAIL       = 'Cergio <notify@cergio.ai>'; // verified domain 2026-06-12
const APP_URL_FALLBACK = 'https://cergio-app-cergio-s-projects.vercel.app';
const PLATFORM_FEE_RATE = 0.10;

serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    const resendKey = Deno.env.get('RESEND_API_KEY');
    if (!resendKey) throw new Error('RESEND_API_KEY not set');

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const serviceKey  = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

    const body = await req.json().catch(() => ({} as any));
    const requestId = body?.requestId;
    const event     = body?.event;
    if (!requestId || !event) return json({ error: 'requestId + event required' }, 400);

    const supaAdmin = createClient(supabaseUrl, serviceKey);

    // Pull the request + both party profiles.
    const { data: r, error: rErr } = await supaAdmin
      .from('spotlight_requests')
      .select(`
        id, platform, official_price_cents, offered_price_cents, message, status, created_at, last_counter_by,
        posted_url, posted_at, confirmed_at,
        provider:profiles!spotlight_requests_provider_id_fkey ( id, display_name, instagram_handle, tiktok_handle ),
        connector:profiles!spotlight_requests_connector_id_fkey ( id, display_name, instagram_handle, tiktok_handle )
      `)
      .eq('id', requestId)
      .single();
    if (rErr || !r) return json({ error: 'request not found', detail: rErr?.message }, 404);

    // Pick recipient (auth.users.email is canonical).
    //   created/cancelled/paid/confirmed → Connector receives.
    //   accepted/declined/posted         → Provider receives.
    //   countered → routes to the party who DIDN'T counter (their turn now).
    let recipientUser;
    if (event === 'countered') {
      recipientUser = r.last_counter_by === 'provider' ? r.connector : r.provider;
    } else if (['created', 'cancelled', 'paid', 'confirmed'].includes(event)) {
      recipientUser = r.connector;
    } else {
      recipientUser = r.provider;
    }
    if (!recipientUser?.id) return json({ error: 'no recipient party on request' }, 422);
    const { data: authRes, error: aErr } = await supaAdmin.auth.admin.getUserById(recipientUser.id);
    if (aErr || !authRes?.user?.email) return json({ error: 'recipient email not found', detail: aErr?.message }, 422);
    const toEmail = authRes.user.email;

    const appBase = (typeof body?.app_url === 'string' && body.app_url) || APP_URL_FALLBACK;
    const inboxLink = `${appBase}/connectors/requests`;

    const platformLabel = r.platform === 'instagram' ? 'Instagram' : 'TikTok';
    const providerName  = r.provider?.display_name  || `@${r.provider?.instagram_handle  || r.provider?.tiktok_handle}`;
    const connectorName = r.connector?.display_name || `@${r.connector?.instagram_handle || r.connector?.tiktok_handle}`;
    const official = fmt(r.official_price_cents);
    const offered  = fmt(r.offered_price_cents);
    // CERGIO-GUARD (2026-06-05): free swap = $0 effective price (service
    // in exchange for the post). Money copy ("$0", "funds released",
    // price tables) must not appear on free-swap emails.
    const isFree = ((r.offered_price_cents ?? r.official_price_cents ?? 0) as number) === 0;

    let subject = '';
    let heading = '';
    let body_html = '';
    let cta_label = 'Open Cergio';
    switch (event) {
      case 'created':
        subject = isFree
          ? `${providerName} is offering you a free service for a ${platformLabel} post`
          : `${providerName} wants a ${platformLabel} spotlight — ${official}`;
        heading = `New spotlight request 🌟`;
        body_html = `
          <p style="font-size:15px;color:#3A3A3A;margin:0 0 18px;">
            <strong>${escapeHtml(providerName)}</strong> ${isFree
              ? `is offering you their service free of charge in exchange for a ${platformLabel} post.`
              : `asked you for a ${platformLabel} spotlight at your rate-card price.`}
          </p>
          ${isFree ? '' : priceTable(r.official_price_cents)}
          ${r.message ? `<p style="font-size:14px;color:#3A3A3A;margin:16px 0 0;line-height:1.5;font-style:italic;">"${escapeHtml(r.message)}"</p>` : ''}`;
        cta_label = isFree ? 'Accept · Decline →' : 'Accept · Counter · Decline →';
        break;
      case 'countered': {
        const counterer = r.last_counter_by === 'provider' ? providerName : connectorName;
        subject = `${counterer} countered at ${offered} (vs ${official})`;
        heading = `Counter-offer in 🟢`;
        body_html = `
          <p style="font-size:15px;color:#3A3A3A;margin:0 0 18px;">
            <strong>${escapeHtml(counterer)}</strong> countered with a new price for the ${platformLabel} spotlight. Your turn — accept, counter back, or decline.
          </p>
          ${priceTable(r.offered_price_cents, r.official_price_cents)}`;
        cta_label = 'Open counter →';
        break;
      }
      case 'accepted':
        subject = isFree
          ? `${connectorName} accepted your free-swap ${platformLabel} spotlight`
          : `${connectorName} accepted your ${platformLabel} spotlight (${offered || official})`;
        heading = `Spotlight accepted ✓`;
        body_html = `
          <p style="font-size:15px;color:#3A3A3A;margin:0 0 18px;">
            <strong>${escapeHtml(connectorName)}</strong> accepted your ${platformLabel} spotlight request.
            ${isFree ? 'Coordinate the free service with them — they post once it\'s done.' : 'They\'ll coordinate posting details next.'}
          </p>
          ${isFree ? '' : priceTable(r.offered_price_cents || r.official_price_cents)}`;
        cta_label = 'View request →';
        break;
      case 'declined':
        subject = `${connectorName} declined your ${platformLabel} spotlight`;
        heading = `Declined`;
        body_html = `
          <p style="font-size:15px;color:#3A3A3A;margin:0 0 18px;">
            <strong>${escapeHtml(connectorName)}</strong> isn't able to take this spotlight right now.
            Browse other Connectors with similar audiences to find a fit.
          </p>`;
        cta_label = 'Browse Connectors →';
        break;
      case 'cancelled':
        subject = `${providerName} cancelled their ${platformLabel} spotlight request`;
        heading = `Request cancelled`;
        body_html = `
          <p style="font-size:15px;color:#3A3A3A;margin:0 0 18px;">
            <strong>${escapeHtml(providerName)}</strong> cancelled their ${platformLabel} spotlight request.
            No action needed.
          </p>`;
        cta_label = 'Open inbox →';
        break;
      case 'paid': {
        const paidCents = r.offered_price_cents || r.official_price_cents;
        const earn = paidCents - feeCents(paidCents);
        subject = `You got paid ${fmt(earn)} — time to post your ${platformLabel} spotlight`;
        heading = `Paid ✓`;
        body_html = `
          <p style="font-size:15px;color:#3A3A3A;margin:0 0 18px;">
            <strong>${escapeHtml(providerName)}</strong> paid for the ${platformLabel} spotlight.
            Your share landed in your Stripe Connect balance — they're waiting for the post.
          </p>
          ${priceTable(paidCents)}`;
        cta_label = 'Open request →';
        break;
      }
      case 'posted': {
        subject = `${connectorName} posted your ${platformLabel} spotlight — please confirm`;
        heading = `Spotlight posted 🎉`;
        body_html = `
          <p style="font-size:15px;color:#3A3A3A;margin:0 0 12px;">
            <strong>${escapeHtml(connectorName)}</strong> just posted your ${platformLabel} spotlight.
          </p>
          ${r.posted_url ? `
          <p style="font-size:14px;color:#3A3A3A;margin:0 0 18px;">
            View the post: <a href="${escapeHtml(r.posted_url)}" style="color:#4AA901;font-weight:700;">${escapeHtml(r.posted_url)}</a>
          </p>` : ''}
          <p style="font-size:14px;color:#3A3A3A;margin:0 0 18px;">
            Confirm the post is live and funds release to the Connector. If
            something looks off, open the request to dispute.
          </p>`;
        cta_label = 'Confirm post →';
        break;
      }
      case 'confirmed': {
        const paidCents = r.offered_price_cents || r.official_price_cents;
        const earn = paidCents - feeCents(paidCents);
        subject = isFree
          ? `Provider confirmed your ${platformLabel} spotlight ✓`
          : `Provider confirmed — ${fmt(earn)} released to your account`;
        heading = isFree ? `Spotlight confirmed ✓` : `Funds released ✓`;
        body_html = isFree
          ? `
          <p style="font-size:15px;color:#3A3A3A;margin:0 0 18px;">
            <strong>${escapeHtml(providerName)}</strong> confirmed your ${platformLabel} spotlight is live.
            Free swap complete — thanks for spotlighting!
          </p>`
          : `
          <p style="font-size:15px;color:#3A3A3A;margin:0 0 18px;">
            <strong>${escapeHtml(providerName)}</strong> confirmed your ${platformLabel} spotlight is live.
            <strong>${fmt(earn)}</strong> has been released to your Stripe Connect balance — payout per your usual schedule.
          </p>
          ${priceTable(paidCents)}`;
        cta_label = isFree ? 'Open Cergio →' : 'View earnings →';
        break;
      }
      default:
        return json({ error: `unknown event: ${event}` }, 400);
    }

    const html = htmlShell({ heading, body_html, cta_label, link: inboxLink });
    const text = `${heading}\n\n${stripTags(body_html)}\n\n${cta_label} ${inboxLink}`;

    const resendResp = await fetch('https://api.resend.com/emails', {
      method:  'POST',
      headers: {
        'Authorization': `Bearer ${resendKey}`,
        'Content-Type':  'application/json',
      },
      body: JSON.stringify({ from: FROM_EMAIL, to: [toEmail], subject, html, text }),
    });
    if (!resendResp.ok) {
      const errText = await resendResp.text();
      return json({ error: `resend ${resendResp.status}: ${errText.slice(0, 400)}` }, 502);
    }
    const sent = await resendResp.json();
    return json({ sent: true, to: toEmail, event, message_id: sent?.id ?? null });
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
});

function fmt(cents: number | null): string {
  if (cents == null) return '$—';
  const n = cents / 100;
  return n % 1 === 0 ? `$${n}` : `$${n.toFixed(2)}`;
}
function feeCents(c: number): number { return Math.ceil(c * PLATFORM_FEE_RATE); }
function priceTable(priceCents: number | null, vsCents?: number | null): string {
  if (priceCents == null) return '';
  const fee     = feeCents(priceCents);
  const earn    = priceCents - fee;
  const savings = vsCents != null ? Math.max(0, vsCents - priceCents) : 0;
  return `
    <div style="background:#fff;border:1px solid #E5E5E5;border-radius:14px;padding:14px 18px;margin:0 0 8px;">
      <table cellpadding="0" cellspacing="0" style="width:100%;font-size:14px;">
        ${savings > 0 ? `<tr><td style="padding:6px 0;color:#3D8B00;font-weight:700;">You save</td><td style="padding:6px 0;font-weight:800;color:#3D8B00;text-align:right;">${fmt(savings)}</td></tr>` : ''}
        <tr><td style="padding:6px 0;color:#6B6B6B;">Price</td><td style="padding:6px 0;font-weight:700;text-align:right;">${fmt(priceCents)}</td></tr>
        <tr><td style="padding:6px 0;color:#6B6B6B;">Connector earns</td><td style="padding:6px 0;text-align:right;">${fmt(earn)}</td></tr>
        <tr><td style="padding:6px 0;color:#6B6B6B;">Cergio fee (${Math.round(PLATFORM_FEE_RATE * 100)}%)</td><td style="padding:6px 0;text-align:right;">${fmt(fee)}</td></tr>
      </table>
    </div>`;
}
function htmlShell({ heading, body_html, cta_label, link }: { heading: string; body_html: string; cta_label: string; link: string }): string {
  return `<!doctype html>
<html><body style="margin:0;padding:0;background:#F8F8F8;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;color:#111;">
  <div style="max-width:560px;margin:0 auto;padding:32px 24px;">
    <div style="text-align:center;margin-bottom:24px;">
      <div style="display:inline-block;width:36px;height:36px;border-radius:50%;background:#4AA901;color:white;line-height:36px;font-weight:800;letter-spacing:2px;">C</div>
      <p style="margin:8px 0 0;font-size:12px;font-weight:800;letter-spacing:2px;color:#4AA901;text-transform:uppercase;">Cergio</p>
    </div>
    <h2 style="font-size:22px;margin:0 0 8px;line-height:1.25;">${escapeHtml(heading)}</h2>
    ${body_html}
    <div style="text-align:center;margin:24px 0;">
      <a href="${link}" style="display:inline-block;background:#4AA901;color:white;text-decoration:none;font-weight:800;font-size:15px;padding:14px 32px;border-radius:24px;">${escapeHtml(cta_label)}</a>
    </div>
    <p style="color:#9B9B9B;font-size:11px;line-height:1.5;text-align:center;margin-top:32px;">
      You're getting this because you have a spotlight request on Cergio.<br/>
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
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}
function stripTags(s: string): string {
  return s.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
}
