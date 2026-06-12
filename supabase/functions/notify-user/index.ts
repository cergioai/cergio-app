// Supabase Edge Function — generic user notification dispatcher.
//
// One function, many templates. Centralizes the welcome/invite/recommend/
// nudge email + SMS messages so we keep voice consistent and adding a new
// template means editing one file instead of one edge function per event.
//
// Caller payload:
//   { event: 'signup_welcome' | 'invite_received' | 'invite_joined' |
//            'service_recommended' | 'first_booking' | 'become_connector_prompt',
//     recipient: { email?, phone?, name? },
//     data: { ... event-specific }, app_url? }
//
// Required secrets (push via Deploy Edge Functions.command):
//   RESEND_API_KEY               — email (already set)
//   TWILIO_ACCOUNT_SID           — SMS
//   TWILIO_AUTH_TOKEN            — SMS
//   TWILIO_FROM_NUMBER           — SMS sender (E.164: +15555550100)
// Email always attempts. SMS only sends when recipient.phone is set AND
// Twilio secrets are configured; otherwise silently skipped.

import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const FROM_EMAIL       = 'Cergio <onboarding@resend.dev>';
const APP_URL_FALLBACK = 'https://cergio-app-cergio-s-projects.vercel.app';

serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  try {
    const body = await req.json().catch(() => ({} as any));
    const { event, recipient, data, app_url } = body || {};
    if (!event || !recipient) return json({ error: 'event + recipient required' }, 400);

    const appBase = (typeof app_url === 'string' && app_url) || APP_URL_FALLBACK;
    const tpl     = TEMPLATES[event];
    if (!tpl) return json({ error: `unknown event: ${event}` }, 400);

    const rendered = tpl({ recipient, data: data || {}, appBase });
    const results: Record<string, unknown> = { event };

    // ── Email ─────────────────────────────────────────────────────────────
    if (recipient.email) {
      const resendKey = Deno.env.get('RESEND_API_KEY');
      if (resendKey) {
        const r = await fetch('https://api.resend.com/emails', {
          method:  'POST',
          headers: {
            'Authorization': `Bearer ${resendKey}`,
            'Content-Type':  'application/json',
          },
          body: JSON.stringify({
            from:    FROM_EMAIL,
            to:      [recipient.email],
            subject: rendered.subject,
            html:    htmlShell(rendered),
            text:    rendered.text,
          }),
        });
        results.email = r.ok ? 'sent' : `error ${r.status}: ${(await r.text()).slice(0, 200)}`;
      } else {
        results.email = 'skipped (RESEND_API_KEY not set)';
      }
    }

    // ── SMS via Twilio ────────────────────────────────────────────────────
    if (recipient.phone) {
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
            body: new URLSearchParams({
              From: from,
              To:   recipient.phone,
              Body: rendered.sms,
            }),
          },
        );
        results.sms = r.ok ? 'sent' : `error ${r.status}: ${(await r.text()).slice(0, 200)}`;
      } else {
        results.sms = 'skipped (Twilio secrets not configured)';
      }
    }

    return json(results);
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// Template library. Each fn returns { subject, html_body, sms, cta_label, cta_link }.
// Keep copy short, warm, and CTA-led. Templates compose into the same shell.
// ─────────────────────────────────────────────────────────────────────────────
type Ctx = {
  recipient: { name?: string; email?: string; phone?: string };
  data:      Record<string, any>;
  appBase:   string;
};
type Rendered = {
  subject:   string;
  body_html: string;
  cta_label: string;
  cta_link:  string;
  sms:       string;
  text:      string;
};
const TEMPLATES: Record<string, (ctx: Ctx) => Rendered> = {
  signup_welcome: ({ recipient, appBase }) => {
    const first = (recipient.name || '').split(/[\s@.]/)[0] || 'friend';
    const link  = `${appBase}/home`;
    return {
      subject: `Welcome to Cergio, ${first} 🌿`,
      body_html: `
        <p style="font-size:15px;color:#3A3A3A;margin:0 0 12px;">Hi ${escapeHtml(first)} — glad you're here. Cergio matches you with services your friends actually trust. Three things you can do right now:</p>
        <ul style="font-size:14px;color:#3A3A3A;line-height:1.7;padding-left:18px;margin:0 0 16px;">
          <li><strong>Find a service</strong> — describe what you need in one line and we route you to the right Provider.</li>
          <li><strong>List your service</strong> — turn what you already do into income.</li>
          <li><strong>Become a Connector</strong> — set a spotlight rate, earn from your social network.</li>
        </ul>`,
      cta_label: 'Open Cergio →',
      cta_link:  link,
      // SMS — keep tight, every variation < 160 chars, always include link.
      sms: `Welcome to Cergio, ${first} 🌿 services your friends trust. Start: ${link}`,
      text: `Welcome to Cergio, ${first}!`,
    };
  },

  invite_received: ({ recipient, data, appBase }) => {
    const inviterName = data.inviter_name || 'A friend';
    // CERGIO-GUARD (2026-06-12): prefer the short /i/<code> link the
    // client now builds (lands on the inviter's profile, not login).
    // The long ?ref= form stays as fallback for old callers.
    const link = data.invite_url
      || `${appBase}/?invite&ref=${encodeURIComponent(data.inviter_id || '')}`;
    const note = (data.note || '').slice(0, 300);
    return {
      subject: `${inviterName} invited you to Cergio`,
      body_html: `
        <p style="font-size:15px;color:#3A3A3A;margin:0 0 12px;">
          <strong>${escapeHtml(inviterName)}</strong> thinks Cergio would be useful for you — it's a friends-trusted marketplace for services.
        </p>
        ${note ? `<div style="background:#fff;border:1px solid #E5E5E5;border-radius:14px;padding:14px 18px;margin:0 0 16px;font-size:14px;color:#3A3A3A;">“${escapeHtml(note)}”</div>` : ''}
        <p style="font-size:14px;color:#3A3A3A;margin:0 0 16px;">Sign up and book your first service — ${escapeHtml(inviterName)} earns $250 in credits when you do.</p>`,
      cta_label: 'Sign up free →',
      cta_link:  link,
      sms: `${inviterName} invited you to Cergio — services your friends actually trust. Join: ${link}`,
      text: `${inviterName} invited you to Cergio.${note ? `\n\n"${note}"` : ''}\n\nJoin: ${link}`,
    };
  },

  invite_joined: ({ recipient, data, appBase }) => {
    const friendName = data.friend_name || 'Your friend';
    const link       = `${appBase}/earnings`;
    return {
      subject: `${friendName} just joined Cergio — you earned $25 🎉`,
      body_html: `
        <p style="font-size:15px;color:#3A3A3A;margin:0 0 12px;">
          <strong>${escapeHtml(friendName)}</strong> just signed up using your invite. $25 in Cergio credit is in your wallet.
        </p>
        <p style="font-size:14px;color:#3A3A3A;margin:0 0 16px;">Invite 10 friends + get one to book → you unlock <strong>Connector</strong> status.</p>`,
      cta_label: 'See earnings →',
      cta_link:  link,
      sms: `🎉 ${friendName} joined Cergio. +$25 credit yours. See balance: ${link}`,
      text: `${friendName} joined Cergio.`,
    };
  },

  // CERGIO-GUARD (2026-06-05 v4): "service_recommended" is now a
  // PROVIDER NOMINATION, not a customer pitch. Tarik 2026-06-05:
  // "the reco logic is wrong... recommending a service should not
  // be sent to the recommended party. The recommended party should
  // receive a msg saying 'James, your friend reco'd you' — click
  // to view + add your photos + offer free services to Connectors
  // who'll spotlight you on IG/TikTok and their networks. Turn
  // social network into referral network + cash."
  //
  // The recipient is the future service provider. Subject line, SMS,
  // and body all address them in second person + sell the provider
  // benefit (free spotlights from Connectors, referral earnings).
  // The blurb the recommender wrote becomes a pull-quote endorsement.
  service_recommended: ({ recipient, data, appBase }) => {
    const recommender  = data.recommender_name || 'A friend';
    const serviceTitle = data.service_title    || 'service provider';
    const blurb        = data.blurb            || '';
    const link         = data.deep_link || `${appBase}/?ref=${encodeURIComponent(data.recommender_id || '')}`;
    const firstName    = (recipient.name || '').split(/\s+/)[0] || 'there';
    const safeSvc      = escapeHtml(serviceTitle.toLowerCase());
    const safeRec      = escapeHtml(recommender);
    const safeBlurb    = escapeHtml(blurb);
    return {
      subject: `${recommender} reco’d you on Cergio`,
      body_html: `
        <p style="font-size:15px;color:#3A3A3A;margin:0 0 12px;">
          Hi ${escapeHtml(firstName)} — <strong>${safeRec}</strong> reco’d you on Cergio as a great <strong>${safeSvc}</strong>.
        </p>
        <p style="font-size:14px;color:#3A3A3A;margin:0 0 12px;">
          Cergio is friend-powered service discovery. Claim your profile in one tap and you can:
        </p>
        <ul style="font-size:14px;color:#3A3A3A;line-height:1.7;padding-left:18px;margin:0 0 14px;">
          <li>Add your photos + a short story about what you do.</li>
          <li>Offer free services to <strong>Connectors</strong> — locals with reach who spotlight you on Instagram + TikTok to their followers’ networks.</li>
          <li>Turn every booking into cash <strong>+</strong> recurring referrals from your own social graph.</li>
        </ul>
        ${safeBlurb ? `<p style="font-size:14px;color:#1A1A1A;background:#F3FFEA;border-left:3px solid #3D8B00;padding:10px 14px;margin:0 0 14px;border-radius:6px;font-style:italic;">“${safeBlurb}” <span style="color:#7A7A7A;font-style:normal;">— ${safeRec}</span></p>` : ''}
        <p style="font-size:13px;color:#5F5E5A;margin:0 0 4px;">AI-driven service discovery that expands your earnings + clients. Human impact, shared prosperity.</p>`,
      cta_label: 'Claim your profile →',
      cta_link:  link,
      // SMS — short + captivating per Tarik. Single line, under 160 chars.
      sms: `${firstName} — ${recommender} reco’d you on Cergio as a great ${serviceTitle.toLowerCase()}. Claim your profile + earn from your network: ${link}`,
      text: `${recommender} reco’d you on Cergio as a great ${serviceTitle.toLowerCase()}.`,
    };
  },

  first_booking: ({ recipient, data, appBase }) => {
    const first = (recipient.name || '').split(/[\s@.]/)[0] || 'there';
    const link  = `${appBase}/profile`;
    return {
      subject: `Nice — your first Cergio booking landed`,
      body_html: `
        <p style="font-size:15px;color:#3A3A3A;margin:0 0 12px;">Hey ${escapeHtml(first)}, your first booking is in. Two ideas to keep it rolling:</p>
        <ul style="font-size:14px;color:#3A3A3A;line-height:1.7;padding-left:18px;margin:0 0 16px;">
          <li>Set a <strong>spotlight rate</strong> on Instagram + TikTok — Providers will pay to be featured on your channels.</li>
          <li>Invite the customer's friends — every new booking from your network earns you more.</li>
        </ul>`,
      cta_label: 'Set your rate →',
      cta_link:  link,
      sms: `${first}, first booking landed 🌿 set your spotlight rate next: ${link}`,
      text: `Your first Cergio booking landed.`,
    };
  },

  become_connector_prompt: ({ recipient, data, appBase }) => {
    const first = (recipient.name || '').split(/[\s@.]/)[0] || 'there';
    const link  = `${appBase}/rainmaker/apply/instagram`;
    return {
      subject: `${first}, ready to earn as a Connector?`,
      body_html: `
        <p style="font-size:15px;color:#3A3A3A;margin:0 0 12px;">You've referred ${data.referrals_count ?? 'several'} friends to Cergio. Time to monetize:</p>
        <p style="font-size:14px;color:#3A3A3A;margin:0 0 8px;">As a <strong>Connector</strong>, providers pay you for an Instagram or TikTok spotlight at your set rate. Cergio takes 10%; you keep the rest. You can also negotiate down per request.</p>`,
      cta_label: 'Become a Connector →',
      cta_link:  link,
      sms: `Cergio: you've unlocked Connector. Set your IG/TT spotlight rate: ${link}`,
      text: `Become a Connector on Cergio.`,
    };
  },
};

function htmlShell({ subject, body_html, cta_label, cta_link }: Rendered): string {
  return `<!doctype html>
<html><body style="margin:0;padding:0;background:#F8F8F8;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;color:#111;">
  <div style="max-width:560px;margin:0 auto;padding:32px 24px;">
    <div style="text-align:center;margin-bottom:24px;">
      <div style="display:inline-block;width:36px;height:36px;border-radius:50%;background:#4AA901;color:white;line-height:36px;font-weight:800;letter-spacing:2px;">C</div>
      <p style="margin:8px 0 0;font-size:12px;font-weight:800;letter-spacing:2px;color:#4AA901;text-transform:uppercase;">Cergio</p>
    </div>
    <h2 style="font-size:22px;margin:0 0 8px;line-height:1.25;">${escapeHtml(subject)}</h2>
    ${body_html}
    <div style="text-align:center;margin:24px 0;">
      <a href="${cta_link}" style="display:inline-block;background:#4AA901;color:white;text-decoration:none;font-weight:800;font-size:15px;padding:14px 32px;border-radius:24px;">${escapeHtml(cta_label)}</a>
    </div>
    <p style="color:#9B9B9B;font-size:11px;line-height:1.5;text-align:center;margin-top:32px;">
      You're getting this because you have a Cergio account or were invited.<br/>
      <a href="${escapeHtml(cta_link)}" style="color:#9B9B9B;">Manage notifications</a>
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
