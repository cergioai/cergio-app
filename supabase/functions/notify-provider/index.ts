// Supabase Edge Function — provider booking notification.
//
// Triggered (fire-and-forget) from the consumer side right after a booking
// row is inserted. Looks up the matched provider's email, composes a short
// Resend email with the booking details + a deep link back into the app,
// and sends. Never blocks the consumer's flow — if Resend fails we just
// return the error in the JSON; the booking still exists.
//
// Required secrets:
//   RESEND_API_KEY             (already in Supabase secrets)
//   SUPABASE_URL               (auto-populated)
//   SUPABASE_SERVICE_ROLE_KEY  (auto-populated)
//
// Caller payload:
//   { bookingId: string, app_url?: string }
//
// The default sender is Resend's sandbox onboarding@resend.dev. Once you
// verify a custom domain (e.g. notify@cergio.ai), update FROM_EMAIL.

import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4?target=deno&deno-std=0.224.0';

const corsHeaders = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const FROM_EMAIL    = 'Cergio <onboarding@resend.dev>';
const APP_URL_FALLBACK = 'https://cergio-app-cergio-s-projects.vercel.app';

serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const resendKey = Deno.env.get('RESEND_API_KEY');
    if (!resendKey) throw new Error('RESEND_API_KEY not set');

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const serviceKey  = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

    const body = await req.json().catch(() => ({} as any));
    const bookingId = body?.bookingId;
    if (!bookingId) return json({ error: 'bookingId required' }, 400);

    const supaAdmin = createClient(supabaseUrl, serviceKey);

    // ── Load booking + parties + service ──────────────────────────────────
    const { data: booking, error: bErr } = await supaAdmin
      .from('bookings')
      .select(`
        id, scheduled_at, total_cents, location_text, notes,
        is_free_for_rainmaker, status,
        consumer:profiles!bookings_consumer_id_fkey ( id, display_name ),
        provider:profiles!bookings_provider_id_fkey ( id, display_name ),
        service:services  ( id, title, category, taxonomy_provider_type )
      `)
      .eq('id', bookingId)
      .single();
    if (bErr || !booking) {
      return json({ error: 'booking not found', detail: bErr?.message }, 404);
    }

    // ── Provider's email lives on auth.users; profiles doesn't carry it ──
    const providerId = booking.provider?.id;
    if (!providerId) return json({ error: 'no provider on booking' }, 422);
    const { data: providerAuth, error: aErr } = await supaAdmin.auth.admin.getUserById(providerId);
    if (aErr || !providerAuth?.user?.email) {
      return json({ error: 'provider email not found', detail: aErr?.message }, 422);
    }

    // ── Compose email ─────────────────────────────────────────────────────
    const providerEmail = providerAuth.user.email;
    const providerName  = booking.provider?.display_name || 'there';
    const consumerName  = booking.consumer?.display_name || 'A Cergio user';
    const serviceTitle  = booking.service?.title         || 'Service';
    const providerType  = booking.service?.taxonomy_provider_type || booking.service?.category || 'service';
    const when = booking.scheduled_at
      ? new Date(booking.scheduled_at).toLocaleString('en-US', {
          weekday: 'short', month: 'short', day: 'numeric',
          hour: 'numeric', minute: '2-digit',
        })
      : 'TBD';
    const appBase = (typeof body?.app_url === 'string' && body.app_url) || APP_URL_FALLBACK;
    const link = `${appBase}/request/${booking.id}`;
    const totalStr = booking.is_free_for_rainmaker
      ? '🎁 Free for Rainmaker'
      : `$${((booking.total_cents ?? 0) / 100).toFixed(2)}`;

    const subject = `New ${providerType} request — ${consumerName} on Cergio`;

    const html = `<!doctype html>
<html><body style="margin:0;padding:0;background:#F8F8F8;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;color:#111;">
  <div style="max-width:560px;margin:0 auto;padding:32px 24px;">
    <div style="text-align:center;margin-bottom:24px;">
      <div style="display:inline-block;width:36px;height:36px;border-radius:50%;background:#4AA901;color:white;line-height:36px;font-weight:800;letter-spacing:2px;">C</div>
      <p style="margin:8px 0 0;font-size:12px;font-weight:800;letter-spacing:2px;color:#4AA901;text-transform:uppercase;">Cergio AI</p>
    </div>

    <h2 style="font-size:22px;margin:0 0 8px;line-height:1.25;">New booking request 🌟</h2>
    <p style="font-size:15px;color:#3A3A3A;margin:0 0 18px;">Hi ${escapeHtml(providerName)} — <strong>${escapeHtml(consumerName)}</strong> just booked you for <strong>${escapeHtml(serviceTitle)}</strong>.</p>

    <div style="background:#fff;border:1px solid #E5E5E5;border-radius:14px;padding:16px 20px;margin:0 0 20px;">
      <p style="margin:0 0 6px;font-size:13px;color:#6B6B6B;text-transform:uppercase;letter-spacing:1.5px;font-weight:700;">Details</p>
      <table cellpadding="0" cellspacing="0" style="width:100%;font-size:14px;">
        <tr><td style="padding:6px 0;color:#6B6B6B;width:90px;">When</td><td style="padding:6px 0;font-weight:700;">${escapeHtml(when)}</td></tr>
        ${booking.location_text ? `<tr><td style="padding:6px 0;color:#6B6B6B;">Where</td><td style="padding:6px 0;font-weight:700;">${escapeHtml(booking.location_text)}</td></tr>` : ''}
        <tr><td style="padding:6px 0;color:#6B6B6B;">Total</td><td style="padding:6px 0;font-weight:700;color:#4AA901;">${escapeHtml(totalStr)}</td></tr>
        ${booking.notes ? `<tr><td style="padding:6px 0;color:#6B6B6B;vertical-align:top;">Notes</td><td style="padding:6px 0;font-weight:500;">${escapeHtml(booking.notes)}</td></tr>` : ''}
      </table>
    </div>

    <div style="text-align:center;margin:24px 0;">
      <a href="${link}" style="display:inline-block;background:#4AA901;color:white;text-decoration:none;font-weight:800;font-size:15px;padding:14px 32px;border-radius:24px;">Accept or decline →</a>
    </div>

    <p style="color:#9B9B9B;font-size:11px;line-height:1.5;text-align:center;margin-top:32px;">
      You're getting this because you have a service listed on Cergio.<br/>
      Manage notifications in your profile.
    </p>
  </div>
</body></html>`;

    const text = `New ${providerType} request from ${consumerName}\n` +
                 `Service: ${serviceTitle}\n` +
                 `When: ${when}\n` +
                 (booking.location_text ? `Where: ${booking.location_text}\n` : '') +
                 `Total: ${totalStr}\n` +
                 (booking.notes ? `Notes: ${booking.notes}\n` : '') +
                 `\nOpen: ${link}\n`;

    // ── Send via Resend ──────────────────────────────────────────────────
    const resendResp = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${resendKey}`,
        'Content-Type':  'application/json',
      },
      body: JSON.stringify({
        from:    FROM_EMAIL,
        to:      [providerEmail],
        subject,
        html,
        text,
      }),
    });

    if (!resendResp.ok) {
      const errText = await resendResp.text();
      return json({ error: `resend ${resendResp.status}: ${errText.slice(0, 400)}` }, 502);
    }
    const sent = await resendResp.json();
    return json({
      sent:           true,
      provider_email: providerEmail,
      message_id:     sent?.id ?? null,
    });
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...corsHeaders },
  });
}

// Minimal HTML escape so user-provided strings don't break the email template.
function escapeHtml(s: string): string {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
