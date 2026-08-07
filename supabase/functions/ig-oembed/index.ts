// Supabase Edge Function — FW-21: real Instagram post thumbnails.
//
// WHY (founder 2026-08-06): "spotlights show REAL IG post image, not the IG
// logo tile." IgPostTile has been an honest IG-branded link tile since
// SPEC-12 because we can't scrape IG and Meta media access was pending. The
// LEGAL path to the real image is Meta's official oEmbed endpoint
// (graph.facebook.com/instagram_oembed) — it requires an app access token,
// so this function is TOKEN-GATED:
//
//   • IG_OEMBED_TOKEN set   → proxy the oEmbed call, return {thumbnail_url}.
//   • IG_OEMBED_TOKEN unset → 200 {thumbnail_url:null}; the client keeps the
//     honest branded tile. NO fabrication, ever (SPEC-12) — a null from here
//     must render the same tile as before, not a fake image.
//
// The token never reaches the browser — that is the whole reason this proxy
// exists. Public read-only; responses cache for a day (post thumbnails are
// effectively immutable; a deleted post 404s and we return null).

import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'authorization, content-type, apikey',
};
const JSON_HEADERS = {
  ...CORS,
  'Content-Type': 'application/json',
  // Thumbnails are stable; let the edge cache absorb repeat renders.
  'Cache-Control': 'public, max-age=86400',
};

const IG_URL_RE = /^https:\/\/(www\.)?instagram\.com\/(p|reel|tv)\/[A-Za-z0-9_-]+\/?/;

serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  try {
    let url = '';
    if (req.method === 'POST') {
      const body = await req.json().catch(() => ({}));
      url = String(body?.url || '');
    } else {
      url = new URL(req.url).searchParams.get('url') || '';
    }

    // Only real Instagram post URLs — this is a proxy, not an open fetcher.
    if (!IG_URL_RE.test(url)) {
      return new Response(JSON.stringify({ thumbnail_url: null, reason: 'not-an-ig-post-url' }), { headers: JSON_HEADERS });
    }

    const token = Deno.env.get('IG_OEMBED_TOKEN') || '';
    if (!token) {
      // Token not provisioned yet (Meta review pending) — the client keeps
      // the honest branded tile. This is a NORMAL state, not an error.
      return new Response(JSON.stringify({ thumbnail_url: null, reason: 'token-unset' }), { headers: JSON_HEADERS });
    }

    const api = `https://graph.facebook.com/v19.0/instagram_oembed?url=${encodeURIComponent(url)}&fields=thumbnail_url,author_name&access_token=${encodeURIComponent(token)}`;
    const res = await fetch(api);
    if (!res.ok) {
      return new Response(JSON.stringify({ thumbnail_url: null, reason: `oembed-${res.status}` }), { headers: JSON_HEADERS });
    }
    const data = await res.json();
    return new Response(JSON.stringify({
      thumbnail_url: data?.thumbnail_url || null,
      author_name:   data?.author_name || null,
    }), { headers: JSON_HEADERS });
  } catch (e) {
    return new Response(JSON.stringify({ thumbnail_url: null, reason: String(e?.message || e) }), { headers: JSON_HEADERS });
  }
});
