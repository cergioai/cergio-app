// Supabase Edge Function — Instagram OAuth callback.
//
// Lifecycle:
//   1. Frontend (InstagramConnectModal) opens a popup window pointed at
//      Meta's authorize URL with our redirect_uri set to this function's
//      `/callback` route.
//   2. User logs in at Instagram, approves the requested scopes, and Meta
//      redirects the popup to:
//          GET .../instagram-oauth/callback?code=XYZ&state=ABC
//   3. This function exchanges the code for an access token, fetches the
//      user's IG handle + follower count from the Graph API, and returns an
//      HTML page that postMessages the result back to `window.opener`, then
//      closes itself.
//   4. The opener (InstagramConnectModal) listens for that message, calls
//      saveInstagram() with its existing authed Supabase session, and the
//      modal closes.
//
// We deliberately keep the user's Supabase JWT *out* of this OAuth round-trip
// — never park auth tokens in URLs/logs. The opener handles persistence.
//
// Required secrets (push via Deploy Edge Functions.command):
//   META_APP_ID
//   META_APP_SECRET
//   META_REDIRECT_URI    e.g. https://vjmwnbftfquyquwaklue.supabase.co/functions/v1/instagram-oauth/callback
//
// Until those secrets are set the function returns a friendly "not configured"
// HTML page so we can deploy the code early without breaking the popup.

import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
};

// Graph API version. Pinned so we don't break silently when Meta ships a new
// one. Bump (and re-test) when v23 lands.
const GRAPH_VERSION = 'v22.0';

serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  const url = new URL(req.url);
  // Supabase serves functions at /functions/v1/<name>/<rest>. Strip the prefix
  // so we can route on the trailing path.
  const route = url.pathname.replace(/^.*\/instagram-oauth/, '') || '/';

  const APP_ID       = Deno.env.get('META_APP_ID')       || '';
  const APP_SECRET   = Deno.env.get('META_APP_SECRET')   || '';
  const REDIRECT_URI = Deno.env.get('META_REDIRECT_URI') ||
                       `${url.origin}/functions/v1/instagram-oauth/callback`;

  // ── /auth-url — helper the frontend can call to build the authorize URL.
  // (The modal can also build it directly; this exists for symmetry.)
  if (route === '/auth-url') {
    if (!APP_ID) return json({ error: 'META_APP_ID not configured' }, 503);
    const state = url.searchParams.get('state') || crypto.randomUUID();
    const authorizeUrl = buildAuthorizeUrl(APP_ID, REDIRECT_URI, state);
    return json({ url: authorizeUrl, state });
  }

  // ── /callback — Meta redirects here after user approves.
  if (route === '/callback' || route === '/') {
    const code  = url.searchParams.get('code');
    const error = url.searchParams.get('error') || url.searchParams.get('error_description');

    if (error) {
      return html(popupResultPage({ ok: false, error: `Instagram cancelled: ${error}` }));
    }
    if (!code) {
      return html(popupResultPage({ ok: false, error: 'Missing authorization code' }));
    }
    if (!APP_ID || !APP_SECRET) {
      return html(popupResultPage({
        ok: false,
        error: 'Instagram OAuth not configured yet. Add META_APP_ID + META_APP_SECRET in Supabase secrets.',
      }));
    }

    try {
      // ── 1. Exchange code → short-lived access token ────────────────────
      const tokenBody = new URLSearchParams({
        client_id:     APP_ID,
        client_secret: APP_SECRET,
        grant_type:    'authorization_code',
        redirect_uri:  REDIRECT_URI,
        code,
      });
      const tokenResp = await fetch('https://api.instagram.com/oauth/access_token', {
        method:  'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body:    tokenBody,
      });
      const tokenJson = await tokenResp.json();
      if (!tokenResp.ok || !tokenJson?.access_token) {
        throw new Error(`token exchange failed: ${JSON.stringify(tokenJson).slice(0, 300)}`);
      }
      const shortToken: string = tokenJson.access_token;
      // tokenJson.user_id is sometimes present; we fetch /me to be sure.

      // ── 2. Upgrade to long-lived token (60 days) ───────────────────────
      // Optional but recommended; lets us refresh without re-authorizing.
      let longToken = shortToken;
      try {
        const longResp = await fetch(
          `https://graph.instagram.com/access_token?grant_type=ig_exchange_token&client_secret=${APP_SECRET}&access_token=${shortToken}`
        );
        const longJson = await longResp.json();
        if (longResp.ok && longJson?.access_token) longToken = longJson.access_token;
      } catch { /* fall back to short token */ }

      // ── 3. Fetch IG profile (username + followers) ─────────────────────
      // followers_count requires the account to be Business or Creator. For
      // Personal accounts the field is omitted; we just persist null.
      const meResp = await fetch(
        `https://graph.instagram.com/${GRAPH_VERSION}/me?fields=user_id,username,account_type,followers_count&access_token=${longToken}`
      );
      const meJson = await meResp.json();
      if (!meResp.ok || !meJson?.username) {
        throw new Error(`graph /me failed: ${JSON.stringify(meJson).slice(0, 300)}`);
      }

      // Hand the result back to the opener; opener persists via saveInstagram().
      return html(popupResultPage({
        ok:        true,
        handle:    meJson.username,
        followers: typeof meJson.followers_count === 'number' ? meJson.followers_count : null,
        verified:  true,
      }));
    } catch (e) {
      return html(popupResultPage({
        ok:    false,
        error: e instanceof Error ? e.message : String(e),
      }));
    }
  }

  return json({ error: 'unknown route', route }, 404);
});

function buildAuthorizeUrl(appId: string, redirectUri: string, state: string): string {
  // Scopes: instagram_business_basic gives username + account_type.
  //         instagram_business_manage_insights is required for followers_count.
  // If you only need handle (no follower count) you can drop the insights scope.
  const scopes = [
    'instagram_business_basic',
    'instagram_business_manage_insights',
  ].join(',');
  const params = new URLSearchParams({
    client_id:     appId,
    redirect_uri:  redirectUri,
    response_type: 'code',
    scope:         scopes,
    state,
    // force_authentication=1 means even already-logged-in users see the
    // chooser — useful so the popup always behaves the same.
    force_authentication: '1',
    enable_fb_login:      '0',
  });
  return `https://www.instagram.com/oauth/authorize?${params.toString()}`;
}

function popupResultPage(payload: Record<string, unknown>): string {
  // The opener listens for { source: 'cergio-ig-oauth', ... } via window.message.
  const json = JSON.stringify({ source: 'cergio-ig-oauth', ...payload });
  return `<!doctype html>
<html><head><meta charset="utf-8"><title>Instagram — Cergio</title>
<style>
  body{margin:0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;
       background:#F8F8F8;color:#111114;display:flex;align-items:center;justify-content:center;
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
    <h1 class="${payload.ok ? 'ok' : 'err'}">${payload.ok ? 'Connected ✓' : 'Instagram connect failed'}</h1>
    <p>${payload.ok ? 'Saving to your Cergio profile…' : escapeHtml(String(payload.error ?? 'Unknown error'))}</p>
    <p style="margin-top:14px;"><span class="pulse"></span></p>
  </div>
<script>
  (function(){
    var msg = ${json};
    try {
      if (window.opener && !window.opener.closed) {
        window.opener.postMessage(msg, '*');
      }
    } catch (e) {}
    // Give the opener a tick to react, then close.
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
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
