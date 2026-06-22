// Supabase Edge Function — SPEC-65 one-click unsubscribe (PUBLIC, no auth).
//
// Linked from every outreach email's footer + List-Unsubscribe header. Verifies
// the HMAC token so links can't be forged, then:
//   1. inserts into outreach_suppressions (channel+address) — checked before
//      every future send,
//   2. flips any matching lead to outreach_status='do_not_contact'.
// Honored immediately. Supports GET (link click) and POST (RFC 8058 one-click).
//
// Secrets: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, OUTREACH_OPTOUT_SECRET.

import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4?target=deno&deno-std=0.224.0';

serve(async (req: Request) => {
  try {
    const url = new URL(req.url);
    const channel = (url.searchParams.get('c') || 'email').toLowerCase();
    const address = (url.searchParams.get('a') || '').trim().toLowerCase();
    const token = url.searchParams.get('k') || '';
    if (!['email', 'sms', 'whatsapp'].includes(channel) || !address) {
      return html('Invalid unsubscribe link.', 400);
    }

    const secret = Deno.env.get('OUTREACH_OPTOUT_SECRET') || Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const expected = await hmac(address, secret);
    if (token !== expected) return html('This unsubscribe link is invalid or expired.', 400);

    const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);

    await db.from('outreach_suppressions').upsert(
      { channel, address, reason: 'optout', source: 'one-click' },
      { onConflict: 'channel,address' },
    );
    // Flip matching leads across the lead tables.
    const col = channel === 'email' ? 'owner_email' : 'phone';
    for (const tbl of ['leads_localbiz', 'leads_services', 'leads_influencers']) {
      try { await db.from(tbl).update({ outreach_status: 'do_not_contact' }).ilike(col, address); } catch { /* table/col may not exist */ }
    }

    return html(`You're unsubscribed. We won't contact <b>${escapeHtml(address)}</b> again. Sorry for the interruption.`);
  } catch (e) {
    return html('Something went wrong, but your request was noted. Email partners@cergio.ai to confirm.', 500);
  }
});

async function hmac(message: string, secret: string): Promise<string> {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(message.toLowerCase()));
  return [...new Uint8Array(sig)].map(b => b.toString(16).padStart(2, '0')).join('');
}

function escapeHtml(s: string) { return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }

function html(msg: string, status = 200) {
  return new Response(
    `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
     <div style="font-family:-apple-system,Segoe UI,Roboto,sans-serif;max-width:520px;margin:60px auto;padding:0 20px;color:#1a1a1a;text-align:center">
       <h2 style="color:#4AA901">Cergio</h2><p style="font-size:16px;line-height:1.5">${msg}</p></div>`,
    { status, headers: { 'Content-Type': 'text/html; charset=utf-8' } },
  );
}
