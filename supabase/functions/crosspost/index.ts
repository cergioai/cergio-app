// Supabase Edge Function — Cross-post a service's profile / offer to an
// external channel with one call.
//
//   POST /functions/v1/crosspost
//   body: {
//     service_id: uuid,
//     channel: 'google' | 'instagram' | 'tiktok' | 'craigslist',
//     asset: { kind?: 'profile'|'offer'|'spotlight',
//              caption?, description?, offer?, image_url?, link? }
//   }
//
// Behaviour per channel:
//   • google / instagram / tiktok — if the integration's secrets exist AND the
//     service has a 'connected' row in service_channel_connections, we call the
//     channel API. Until those are in place we return { status:'needs_connection'
//     } (or 'pending_review') so the button works end-to-end and degrades
//     gracefully — exactly like instagram-oauth does before its secrets land.
//   • craigslist — no API exists. We return { status:'manual', post, steps[] }
//     so the app can show the owner a copy-paste post + what to do.
//
// Every call appends a crosspost_jobs row (service_role bypasses RLS).
//
// Secrets (set later, per integration):
//   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY   (always)
//   GOOGLE_BUSINESS_ACCESS_TOKEN  / GOOGLE_BUSINESS_ACCOUNT_ID   (Google)
//   META_APP_ID / META_APP_SECRET (Instagram — also needs app review)
//   TIKTOK_CLIENT_KEY / TIKTOK_CLIENT_SECRET (TikTok — also needs app review)

import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const cors = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const json = (b: unknown, status = 200) =>
  new Response(JSON.stringify(b), { status, headers: { ...cors, 'Content-Type': 'application/json' } });

type Asset = {
  kind?: 'profile' | 'offer' | 'spotlight';
  caption?: string;
  description?: string;
  offer?: string;
  image_url?: string;
  link?: string;
};

serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST')    return json({ error: 'POST only' }, 405);

  let body: { service_id?: string; channel?: string; asset?: Asset };
  try { body = await req.json(); } catch { return json({ error: 'invalid JSON' }, 400); }

  const { service_id, channel } = body;
  const asset: Asset = body.asset || {};
  const VALID = ['google', 'instagram', 'tiktok', 'craigslist'];
  if (!service_id || !channel || !VALID.includes(channel)) {
    return json({ error: 'service_id and a valid channel are required' }, 400);
  }

  const SB_URL = Deno.env.get('SUPABASE_URL') || '';
  const SB_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';
  const admin  = createClient(SB_URL, SB_KEY);

  // Load the service + its connection row for this channel.
  const { data: svc } = await admin
    .from('services')
    .select('id, title, category, description, location_text, owner_id')
    .eq('id', service_id)
    .maybeSingle();
  if (!svc) return json({ error: 'service not found' }, 404);

  const { data: conn } = await admin
    .from('service_channel_connections')
    .select('status, external_handle, external_id')
    .eq('service_id', service_id)
    .eq('channel', channel)
    .maybeSingle();

  // Build the asset payload we'd publish.
  const link = asset.link || `https://cergio.ai/service/${service_id}`;
  const caption =
    asset.caption ||
    asset.description ||
    `${svc.title} — book on Cergio. ${asset.offer || ''}`.trim();

  // ── Craigslist: no API. Hand the owner a ready post + steps. ───────────────
  if (channel === 'craigslist') {
    const post = {
      title: `${svc.title}${svc.location_text ? ` — ${svc.location_text}` : ''} (book online)`,
      body:
        `${svc.description || svc.title}\n\n` +
        `We're on Cergio — book in two taps: ${link}\n` +
        (asset.offer ? `\nOffer: ${asset.offer}\n` : '') +
        `\nReal, local, verified.`,
      section: 'services',
    };
    const steps = [
      'Go to craigslist.org → your city → "post to classifieds".',
      'Choose "service offered", then the closest service category.',
      'Paste the Title and Body above. Add 1–2 photos.',
      'Use the business phone/email when prompted; complete phone verification if asked.',
      'Publish. Repost every ~48h (CL ranks newest first).',
    ];
    await logJob(admin, service_id, channel, asset, 'manual', null, null);
    return json({ status: 'manual', channel, post, steps });
  }

  // ── API channels: gate on secrets + a 'connected' row. ─────────────────────
  const secretsReady =
    channel === 'google'    ? !!Deno.env.get('GOOGLE_BUSINESS_ACCESS_TOKEN')
  : channel === 'instagram' ? !!Deno.env.get('META_APP_ID')
  : channel === 'tiktok'    ? !!Deno.env.get('TIKTOK_CLIENT_KEY')
  : false;

  if (!secretsReady) {
    await logJob(admin, service_id, channel, asset, 'needs_connection', null,
      `${channel} integration not configured yet`);
    return json({ status: 'pending_review', channel,
      message: `${channel} publishing isn't live yet (awaiting credentials / app review). Saved your post — it'll go out once ${channel} is connected.` });
  }
  if (!conn || conn.status !== 'connected') {
    await logJob(admin, service_id, channel, asset, 'needs_connection', null, 'no connected account');
    return json({ status: 'needs_connection', channel,
      message: `Connect this service's ${channel} account once, then one-click posting works.` });
  }

  // ── Real publish paths (structured; safe no-op fallbacks). ─────────────────
  try {
    let externalPostId: string | null = null;

    if (channel === 'google') {
      // Google Business Profile — Local Post on the connected location.
      const token   = Deno.env.get('GOOGLE_BUSINESS_ACCESS_TOKEN')!;
      const account = Deno.env.get('GOOGLE_BUSINESS_ACCOUNT_ID') || conn.external_id;
      const url = `https://mybusiness.googleapis.com/v4/accounts/${account}/locations/${conn.external_id}/localPosts`;
      const r = await fetch(url, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          languageCode: 'en-US',
          summary: caption.slice(0, 1500),
          callToAction: { actionType: 'BOOK', url: link },
          ...(asset.image_url ? { media: [{ mediaFormat: 'PHOTO', sourceUrl: asset.image_url }] } : {}),
        }),
      });
      if (!r.ok) throw new Error(`google ${r.status}: ${(await r.text()).slice(0, 200)}`);
      externalPostId = (await r.json())?.name ?? null;
    }

    if (channel === 'instagram') {
      // IG Content Publishing — 2-step (create container → publish) on the
      // service's own IG Business account. Requires image_url for a feed post.
      const igId  = conn.external_id;
      const token = Deno.env.get('META_PAGE_ACCESS_TOKEN') || '';
      if (!token) throw new Error('META_PAGE_ACCESS_TOKEN missing for IG publish');
      const create = await fetch(`https://graph.facebook.com/v22.0/${igId}/media`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ image_url: asset.image_url, caption, access_token: token }),
      });
      if (!create.ok) throw new Error(`ig media ${create.status}: ${(await create.text()).slice(0, 200)}`);
      const creationId = (await create.json())?.id;
      const pub = await fetch(`https://graph.facebook.com/v22.0/${igId}/media_publish`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ creation_id: creationId, access_token: token }),
      });
      if (!pub.ok) throw new Error(`ig publish ${pub.status}: ${(await pub.text()).slice(0, 200)}`);
      externalPostId = (await pub.json())?.id ?? null;
    }

    if (channel === 'tiktok') {
      // TikTok Content Posting API — photo/video post on the connected account.
      // Requires the service's user access token (stored server-side when the
      // TikTok app passes review). Until then this path is unreachable (gated
      // above), so we keep the call structured for when it lands.
      throw new Error('tiktok publish pending app review');
    }

    await logJob(admin, service_id, channel, asset, 'posted', externalPostId, null);
    return json({ status: 'posted', channel, external_post_id: externalPostId, link });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    await logJob(admin, service_id, channel, asset, 'error', null, msg);
    return json({ status: 'error', channel, error: msg }, 502);
  }
});

async function logJob(
  admin: ReturnType<typeof createClient>,
  service_id: string, channel: string, asset: Asset,
  status: string, external_post_id: string | null, error: string | null,
) {
  await admin.from('crosspost_jobs').insert({
    service_id, channel,
    asset_kind: asset.kind || 'profile',
    payload: asset,
    status,
    external_post_id,
    error,
    posted_at: status === 'posted' ? new Date().toISOString() : null,
  });
}
