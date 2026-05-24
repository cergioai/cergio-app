// Supabase Edge Function — TikTok OAuth.
//
// Two modes off the same flow:
//   ?mode=signin → after exchanging the auth code we create-or-link a
//                   Supabase user with email tiktok-{open_id}@users.cergio.ai
//                   (TikTok doesn't expose email; we synthesize one) and
//                   return a sign-in link via supabase.auth.admin.generateLink
//                   so the popup can complete the session in the opener.
//   ?mode=link    → the user is already signed in (via a separate Cergio
//                   account) and just wants to attach TikTok to their profile.
//                   We save the handle + follower count to profiles via the
//                   service-role client.
//
// The mode is round-tripped through the OAuth `state` parameter so we know
// which path to take in the callback.
//
// Required Supabase secrets (push via Deploy Edge Functions.command):
//   TIKTOK_CLIENT_KEY
//   TIKTOK_CLIENT_SECRET
//   TIKTOK_REDIRECT_URI  e.g. https://vjmwnbftfquyquwaklue.supabase.co/functions/v1/tiktok-oauth/callback
//
// Until those are set the function returns a friendly "not configured" HTML
// so we can deploy now and flip on later.

import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4?target=deno&deno-std=0.224.0';

const corsHeaders = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
};

serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  const url   = new URL(req.url);
  const route = url.pathname.replace(/^.*\/tiktok-oauth/, '') || '/';

  const CLIENT_KEY    = Deno.env.get('TIKTOK_CLIENT_KEY')    || '';
  const CLIENT_SECRET = Deno.env.get('TIKTOK_CLIENT_SECRET') || '';
  const REDIRECT_URI  = Deno.env.get('TIKTOK_REDIRECT_URI') ||
                        `${url.origin}/functions/v1/tiktok-oauth/callback`;

  if (route === '/callback' || route === '/') {
    const code  = url.searchParams.get('code');
    const state = url.searchParams.get('state') || '';
    const error = url.searchParams.get('error') || url.searchParams.get('error_description');

    // Parse mode out of state: "{nonce}.{mode}"
    const mode = state.split('.')[1] === 'link' ? 'link' : 'signin';

    if (error) return html(popupResultPage({ ok: false, error: `TikTok cancelled: ${error}` }, mode));
    if (!code) return html(popupResultPage({ ok: false, error: 'Missing authorization code' }, mode));
    if (!CLIENT_KEY || !CLIENT_SECRET) {
      return html(popupResultPage({
        ok: false,
        error: 'TikTok OAuth not configured yet. Add TIKTOK_CLIENT_KEY + TIKTOK_CLIENT_SECRET in Supabase secrets.',
      }, mode));
    }

    try {
      // ── 1. Exchange code → access token ───────────────────────────────
      const tokenBody = new URLSearchParams({
        client_key:    CLIENT_KEY,
        client_secret: CLIENT_SECRET,
        code,
        grant_type:    'authorization_code',
        redirect_uri:  REDIRECT_URI,
      });
      const tokenResp = await fetch('https://open.tiktokapis.com/v2/oauth/token/', {
        method:  'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body:    tokenBody,
      });
      const tokenJson = await tokenResp.json();
      if (!tokenResp.ok || !tokenJson?.access_token) {
        throw new Error(`TikTok token exchange failed: ${JSON.stringify(tokenJson).slice(0, 400)}`);
      }
      const accessToken: string = tokenJson.access_token;
      const openId:      string = tokenJson.open_id;

      // ── 2. Fetch profile (username + follower count if user.info.profile scope granted) ─
      const meResp = await fetch(
        'https://open.tiktokapis.com/v2/user/info/?fields=open_id,union_id,avatar_url,display_name,username,follower_count',
        { headers: { 'Authorization': `Bearer ${accessToken}` } },
      );
      const meJson = await meResp.json();
      const me = meJson?.data?.user;
      if (!me?.username && !me?.display_name) {
        throw new Error(`TikTok /user/info failed: ${JSON.stringify(meJson).slice(0, 400)}`);
      }
      const handle    = me.username || me.display_name;
      const followers = typeof me.follower_count === 'number' ? me.follower_count : null;

      if (mode === 'link') {
        // Caller is already signed in. Popup will postMessage back to opener
        // which calls saveTikTok() with the values; we don't write here.
        return html(popupResultPage({
          ok: true, handle, followers, verified: true, mode: 'link',
        }, mode));
      }

      // mode === 'signin' → create-or-link the Supabase user.
      const supaUrl   = Deno.env.get('SUPABASE_URL')!;
      const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
      const supaAdmin = createClient(supaUrl, serviceKey);

      // Synthesize a stable email keyed off TikTok's open_id (won't collide
      // across users because open_id is unique per app+user).
      const synthEmail = `tiktok-${openId}@users.cergio.ai`;

      // Find or create the auth user. We try sign-in by email first so
      // repeat sign-ins from the same TikTok account land on the same row.
      let userId: string | null = null;
      const { data: existing } = await supaAdmin.auth.admin.listUsers();
      const found = existing?.users?.find(u => u.email?.toLowerCase() === synthEmail);
      if (found) {
        userId = found.id;
      } else {
        const { data: created, error: cErr } = await supaAdmin.auth.admin.createUser({
          email:         synthEmail,
          email_confirm: true,                 // skip verification — TikTok already proved identity
          user_metadata: {
            display_name:    me.display_name || handle,
            tiktok_open_id:  openId,
            signin_provider: 'tiktok',
          },
        });
        if (cErr || !created?.user) throw new Error(`User create failed: ${cErr?.message}`);
        userId = created.user.id;
      }

      // Stamp TikTok handle + followers on the profile (idempotent upsert).
      await supaAdmin.from('profiles').upsert({
        id:                 userId,
        tiktok_handle:      handle,
        tiktok_followers:   followers,
        tiktok_connected_at: new Date().toISOString(),
        tiktok_verified_at:  new Date().toISOString(),
      }, { onConflict: 'id' });

      // Generate a magic link the opener can use to complete the session.
      const { data: linkData, error: linkErr } = await supaAdmin.auth.admin.generateLink({
        type:  'magiclink',
        email: synthEmail,
      });
      if (linkErr || !linkData?.properties?.action_link) {
        throw new Error(`Magic link generation failed: ${linkErr?.message}`);
      }

      return html(popupResultPage({
        ok: true, handle, followers, verified: true,
        mode: 'signin',
        signin_link: linkData.properties.action_link,
      }, mode));
    } catch (e) {
      return html(popupResultPage({
        ok: false, error: e instanceof Error ? e.message : String(e),
      }, mode));
    }
  }

  return json({ error: 'unknown route', route }, 404);
});

function popupResultPage(payload: Record<string, unknown>, mode: string): string {
  const tag = mode === 'link' ? 'cergio-tt-oauth' : 'cergio-tt-signin';
  const msg = JSON.stringify({ source: tag, ...payload });
  return `<!doctype html>
<html><head><meta charset="utf-8"><title>TikTok — Cergio</title>
<style>
  body{margin:0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;
       background:#FAF4EE;color:#111114;display:flex;align-items:center;justify-content:center;
       min-height:100vh;padding:24px;text-align:center;}
  .card{max-width:360px;background:#fff;border:1px solid #E5E5E3;border-radius:18px;padding:28px 22px;}
  .ok  {color:#4AA901;}
  .err {color:#A32D2D;}
  h1{font-size:20px;font-weight:800;margin:0 0 8px;}
  p {font-size:14px;color:#A0A0A2;margin:0;line-height:1.5;}
  .pulse{display:inline-block;width:12px;height:12px;border-radius:50%;background:#4AA901;animation:pulse 1.2s infinite;}
  @keyframes pulse{0%,100%{opacity:.3}50%{opacity:1}}
</style></head>
<body>
  <div class="card">
    <h1 class="${payload.ok ? 'ok' : 'err'}">${payload.ok ? 'Connected ✓' : 'TikTok connect failed'}</h1>
    <p>${payload.ok ? 'Returning to Cergio…' : escapeHtml(String(payload.error ?? 'Unknown error'))}</p>
    <p style="margin-top:14px;"><span class="pulse"></span></p>
  </div>
<script>
  (function(){
    var msg = ${msg};
    try {
      if (window.opener && !window.opener.closed) {
        window.opener.postMessage(msg, '*');
      }
    } catch (e) {}
    setTimeout(function(){ try { window.close(); } catch(e){} }, ${payload.ok ? 600 : 2400});
  })();
</script>
</body></html>`;
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...corsHeaders },
  });
}
function html(body: string, status = 200) {
  return new Response(body, {
    status,
    headers: { 'Content-Type': 'text/html; charset=utf-8', ...corsHeaders },
  });
}
function escapeHtml(s: string): string {
  return String(s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}
