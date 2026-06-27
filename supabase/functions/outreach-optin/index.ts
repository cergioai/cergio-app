// Supabase Edge Function — soft-launch OPT-IN capture (PUBLIC, no auth). SPEC-70.
//
// This is the seam between the founder's personal soft-launch outreach and the
// permanent growth system. Every soft-launch message (email / WhatsApp / SMS)
// carries a per-recipient opt-in link to here. When the lead taps it:
//   1. We verify the HMAC token (same secret as the unsubscribe links — links
//      can't be forged).
//   2. We mark the matching lead row `outreach_status='opted_in'` (+ timestamp)
//      so they surface in the public "free" directories and never get re-blasted.
//   3. We 302-redirect them into the app to claim their spot — businesses to the
//      service side, creators to the connector side — so the personal convo
//      migrates seamlessly into the real product (claim → request → referrals).
//
// Tapping a link the recipient was personally sent IS their opt-in (consent),
// which is exactly what keeps the WhatsApp/SMS follow-ups compliant.
//
// Secrets: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, OUTREACH_OPTOUT_SECRET.

import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4?target=deno&deno-std=0.224.0';

const APP_BASE = 'https://cergio.ai';

serve(async (req: Request) => {
  try {
    const url = new URL(req.url);
    // t = lead type: 'biz' (business → service side) | 'inf' (creator → connector side)
    const type = (url.searchParams.get('t') || 'biz').toLowerCase();
    const address = (url.searchParams.get('a') || '').trim().toLowerCase();
    const token = url.searchParams.get('k') || '';
    if (!['biz', 'inf'].includes(type) || !address) {
      return html('Invalid link. Reply to our message and we’ll get you set up.', 400);
    }

    const secret = Deno.env.get('OUTREACH_OPTOUT_SECRET') || Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const expected = await hmac(address, secret);
    if (token !== expected) return html('This link is invalid or expired. Reply to our message and we’ll set you up.', 400);

    const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);

    // Address may be an email or a phone — pick the column accordingly.
    const isEmail = address.includes('@');
    const stamp = new Date().toISOString();
    // Mark the matching lead opted_in across the relevant table(s). Best-effort:
    // a column/table that doesn't exist is ignored so a partial schema can't 500.
    const tables = type === 'inf' ? ['leads_influencers'] : ['leads_localbiz', 'leads_services'];
    for (const tbl of tables) {
      // leads_influencers stores email in `email`; localbiz in `owner_email`.
      const emailCol = tbl === 'leads_influencers' ? 'email' : 'owner_email';
      const col = isEmail ? emailCol : 'phone';
      try {
        await db.from(tbl).update({ outreach_status: 'opted_in', outreach_last_at: stamp }).ilike(col, address);
      } catch { /* table/col may not exist in this env */ }
    }

    // Route into the permanent product. role drives which "free" directory +
    // claim path the soft-launch lead lands on; src lets the app attribute them.
    const role = type === 'inf' ? 'connector' : 'service';
    const dest = `${APP_BASE}/auth?src=soft_launch&role=${role}&optin=1`;
    return new Response(null, { status: 302, headers: { Location: dest } });
  } catch (e) {
    return html('Something went wrong, but your interest was noted. Reply to our message and we’ll set you up.', 500);
  }
});

async function hmac(message: string, secret: string): Promise<string> {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(message.toLowerCase()));
  return [...new Uint8Array(sig)].map(b => b.toString(16).padStart(2, '0')).join('');
}

function html(msg: string, status = 200) {
  return new Response(
    `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
     <div style="font-family:-apple-system,Segoe UI,Roboto,sans-serif;max-width:520px;margin:60px auto;padding:0 20px;color:#1a1a1a;text-align:center">
       <h2 style="color:#4AA901">Cergio</h2><p style="font-size:16px;line-height:1.5">${msg}</p></div>`,
    { status, headers: { 'Content-Type': 'text/html; charset=utf-8' } },
  );
}
