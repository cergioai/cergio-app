// Supabase Edge Function — Google Business Profile OAuth connect.
//
// Mirrors instagram-oauth: a popup-based connect flow that links a service's
// VERIFIED Google Business listing so the `crosspost` function can publish
// Local Posts to it.
//
// Lifecycle:
//   1. Frontend opens a popup at this fn's /auth-url (Google consent screen),
//      passing state = the service_id it's connecting.
//   2. User picks the Google account that owns the business, approves the
//      business.manage scope, Google redirects the popup to /callback?code=...
//   3. This fn exchanges code → tokens, lists the account's Business Profile
//      locations, and postMessages { source:'cergio-gbp-oauth', accounts:[…] }
//      back to the opener.
//   4. The opener shows the location picker and calls connectServiceChannel(
//      serviceId, 'google', { handle: locationName, externalId: locationId }).
//      Refresh token is returned to the opener too so it can be stored
//      server-side for posting (the opener persists via an authed call).
//
// Required secrets (see google-business-api-setup.md):
//   GOOGLE_BUSINESS_CLIENT_ID
//   GOOGLE_BUSINESS_CLIENT_SECRET
//   GOOGLE_BUSINESS_REDIRECT_URI  (defaults to this fn's /callback)
//
// Until those secrets exist the fn returns a friendly "not configured" page,
// so we can deploy now and flip it live once Google API access is approved.

import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
};

const SCOPE = 'https://www.googleapis.com/auth/business.manage';

serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  const url = new URL(req.url);
  const route = url.pathname.replace(/^.*\/google-business-oauth/, '') || '/';

  const CLIENT_ID     = Deno.env.get('GOOGLE_BUSINESS_CLIENT_ID')     || '';
  const CLIENT_SECRET = Deno.env.get('GOOGLE_BUSINESS_CLIENT_SECRET') || '';
  const REDIRECT_URI  = Deno.env.get('GOOGLE_BUSINESS_REDIRECT_URI')  ||
                        `${url.origin}/functions/v1/google-business-oauth/callback`;

  // ── /auth-url — build the Google consent URL. ──────────────────────────────
  if (route === '/auth-url') {
    if (!CLIENT_ID) return json({ error: 'GOOGLE_BUSINESS_CLIENT_ID not configured' }, 503);
    const state = url.searchParams.get('state') || crypto.randomUUID();
    const params = new URLSearchParams({
      client_id:     CLIENT_ID,
      redirect_uri:  REDIRECT_URI,
      response_type: 'code',
      scope:         SCOPE,
      access_type:   'offline',     // get a refresh token
      prompt:        'consent',
      state,
    });
    return json({ url: `https://accounts.google.com/o/oauth2/v2/auth?${params}`, state });
  }

  // ── /callback — Google redirects here. ─────────────────────────────────────
  if (route === '/callback' || route === '/') {
    const code  = url.searchParams.get('code');
    const error = url.searchParams.get('error');
    if (error) return html(popupResultPage({ ok: false, error: `Google cancelled: ${error}` }));
    if (!code)  return html(popupResultPage({ ok: false, error: 'Missing authorization code' }));
    if (!CLIENT_ID || !CLIENT_SECRET) {
      return html(popupResultPage({
        ok: false,
        error: 'Google Business OAuth not configured yet. Add GOOGLE_BUSINESS_CLIENT_ID + SECRET in Supabase secrets.',
      }));
    }

    try {
      // 1. Exchange code → tokens.
      const tokenResp = await fetch('https://oauth2.googleapis.com/token', {
        method:  'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          client_id:     CLIENT_ID,
          client_secret: CLIENT_SECRET,
          grant_type:    'authorization_code',
          redirect_uri:  REDIRECT_URI,
          code,
        }),
      });
      const tokenJson = await tokenResp.json();
      if (!tokenResp.ok || !tokenJson?.access_token) {
        throw new Error(`token exchange failed: ${JSON.stringify(tokenJson).slice(0, 300)}`);
      }
      const accessToken: string = tokenJson.access_token;
      const refreshToken: string | null = tokenJson.refresh_token ?? null;

      // 2. List the user's Business Profile accounts.
      const acctResp = await fetch(
        'https://mybusinessaccountmanagement.googleapis.com/v1/accounts',
        { headers: { Authorization: `Bearer ${accessToken}` } },
      );
      const acctJson = await acctResp.json();
      if (!acctResp.ok) {
        throw new Error(`accounts list failed: ${JSON.stringify(acctJson).slice(0, 300)}`);
      }
      const accounts = acctJson?.accounts || [];

      // 3. For the first account, list locations the user can post to.
      let locations: Array<{ id: string; name: string }> = [];
      if (accounts[0]?.name) {
        const locResp = await fetch(
          `https://mybusinessbusinessinformation.googleapis.com/v1/${accounts[0].name}/locations?readMask=name,title`,
          { headers: { Authorization: `Bearer ${accessToken}` } },
        );
        const locJson = await locResp.json();
        if (locResp.ok) {
          locations = (locJson?.locations || []).map((l: { name: string; title?: string }) => ({
            id:   l.name,                 // e.g. "locations/12345"
            name: l.title || l.name,
          }));
        }
      }

      return html(popupResultPage({
        ok:            true,
        account:       accounts[0]?.name ?? null,
        locations,
        refresh_token: refreshToken,      // opener stores server-side for posting
      }));
    } catch (e) {
      return html(popupResultPage({ ok: false, error: e instanceof Error ? e.message : String(e) }));
    }
  }

  return json({ error: 'unknown route', route }, 404);
});

function popupResultPage(payload: Record<string, unknown>): string {
  const data = JSON.stringify({ source: 'cergio-gbp-oauth', ...payload });
  return `<!doctype html>
<html><head><meta charset="utf-8"><title>Google Business — Cergio</title>
<style>
  body{margin:0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;
       background:#F8F8F8;color:#111114;display:flex;align-items:center;justify-content:center;
       min-height:100vh;padding:24px;text-align:center;}
  .card{max-width:360px;background:#fff;border:1px solid #E5E5E3;border-radius:18px;padding:28px 22px;}
  .ok{color:#4AA901;} .err{color:#A32D2D;}
  h1{font-size:20px;font-weight:800;margin:0 0 8px;}
  p{font-size:14px;color:#A0A0A2;margin:0;line-height:1.5;}
</style></head>
<body>
  <div class="card">
    <h1 class="${payload.ok ? 'ok' : 'err'}">${payload.ok ? 'Connected ✓' : 'Google connect failed'}</h1>
    <p>${payload.ok ? 'Pick your business location in Cergio…' : escapeHtml(String(payload.error ?? 'Unknown error'))}</p>
  </div>
<script>
  (function(){
    var msg = ${data};
    try { if (window.opener && !window.opener.closed) window.opener.postMessage(msg, '*'); } catch (e) {}
    setTimeout(function(){ try { window.close(); } catch(e){} }, ${payload.ok ? 600 : 2400});
  })();
</script>
</body></html>`;
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status, headers: { 'Content-Type': 'application/json', ...corsHeaders },
  });
}
function html(body: string, status = 200) {
  return new Response(body, {
    status, headers: { 'Content-Type': 'text/html; charset=utf-8', ...corsHeaders },
  });
}
function escapeHtml(s: string): string {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}
