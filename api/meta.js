// CERGIO-GUARD (2026-06-19, Tarik — SEO Part 2): server-rendered link previews.
//
// Part 1 (SPEC-61) set per-record <title>/description/OG via client JS. That
// helps Googlebot (renders JS) but NOT non-JS social scrapers
// (facebookexternalhit, Twitterbot, LinkedInBot, Slackbot, WhatsApp, iMessage,
// Discord, Telegram), which read the raw HTML once and never run scripts. So a
// shared /u/:id or /service/:id link pasted into iMessage/Slack/FB showed the
// generic site card.
//
// Why this and NOT Vike/SSG: the SEO pages are user-generated (profiles,
// services) created + edited constantly — they don't exist at build time, so
// build-time prerender (SSG) can't generate them. A full Vike SSR migration
// would also rewrite the entire 100-screen react-router shell (high regression
// risk, violates FROZEN_SPEC). This serverless function gives 100% of the
// crawler-meta benefit for ~0 risk: humans NEVER hit it (vercel.json routes
// only known bot user-agents here — see the `has` user-agent rule); everyone
// else falls through to the normal static SPA. Dynamic data is fetched live
// from Supabase via the public anon key (same read the public page already
// does under RLS), so no new secrets are required — VITE_SUPABASE_URL /
// VITE_SUPABASE_ANON_KEY are already set on Vercel for the frontend build.
//
// Routes (set by vercel.json rewrites, UA-gated):
//   /u/:id            -> ?kind=profile&id=:id
//   /u/:id/services   -> ?kind=profile_services&id=:id
//   /service/:id      -> ?kind=service&id=:id

const SUPABASE_URL =
  process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || '';
const SUPABASE_ANON_KEY =
  process.env.VITE_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY || '';
const ORIGIN = process.env.VITE_PUBLIC_ORIGIN || 'https://cergio.ai';

// ── helpers ────────────────────────────────────────────────────────────────
function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// Only accept UUID-ish ids — these routes are always uuids. Anything else is
// rejected (avoids SSRF / injection into the REST query string).
function cleanId(raw) {
  const s = String(raw || '').trim();
  return /^[0-9a-fA-F-]{16,40}$/.test(s) ? s : null;
}

async function sb(path) {
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) return null;
  try {
    const r = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
      headers: {
        apikey: SUPABASE_ANON_KEY,
        Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
        Accept: 'application/json',
      },
    });
    if (!r.ok) return null;
    const rows = await r.json();
    return Array.isArray(rows) && rows.length ? rows[0] : null;
  } catch {
    return null;
  }
}

function clip(s, n) {
  const t = String(s || '').replace(/\s+/g, ' ').trim();
  return t.length > n ? t.slice(0, n - 1).trimEnd() + '…' : t;
}

// ── meta builders ────────────────────────────────────────────────────────────
async function buildProfile(id, withServices) {
  const p = await sb(
    `profiles?id=eq.${id}&select=id,display_name,headline,bio,instagram_handle,instagram_followers,cc_verified_at`,
  );
  if (!p) return null;
  const name = p.display_name || 'Cergio member';
  const title = withServices ? `${name}'s services` : name;
  const desc =
    clip(p.headline, 180) ||
    clip(p.bio, 180) ||
    `${name} on Cergio — trusted local services through your network.`;
  const jsonld = {
    '@context': 'https://schema.org',
    '@type': 'Person',
    name,
    description: clip(p.bio || p.headline, 300) || undefined,
    url: `${ORIGIN}/u/${id}`,
  };
  return {
    title,
    description: desc,
    path: withServices ? `/u/${id}/services` : `/u/${id}`,
    image: null,
    bodyHeading: name,
    bodySub: p.headline ? esc(p.headline) : '',
    bodyText: p.bio ? esc(p.bio) : '',
    jsonld,
  };
}

async function buildService(id) {
  const s = await sb(
    `services?id=eq.${id}&select=id,title,category,description,location_text,cover_url,owner_id`,
  );
  if (!s) return null;
  let ownerName = '';
  if (s.owner_id && cleanId(s.owner_id)) {
    const o = await sb(`profiles?id=eq.${s.owner_id}&select=display_name`);
    ownerName = (o && o.display_name) || '';
  }
  const title = ownerName || s.title || s.category || 'Service';
  const descParts = [];
  if (s.title && s.title !== ownerName) descParts.push(s.title);
  if (s.category) descParts.push(s.category);
  if (s.location_text) descParts.push(s.location_text);
  const desc =
    clip(s.description, 180) ||
    (descParts.length
      ? `${descParts.join(' · ')} on Cergio.`
      : 'A service on Cergio.');
  const img = s.cover_url
    ? s.cover_url.startsWith('http')
      ? s.cover_url
      : `${ORIGIN}${s.cover_url}`
    : null;
  const jsonld = {
    '@context': 'https://schema.org',
    '@type': 'Service',
    name: s.title || title,
    serviceType: s.category || undefined,
    areaServed: s.location_text || undefined,
    provider: ownerName ? { '@type': 'Person', name: ownerName } : undefined,
    description: clip(s.description, 300) || undefined,
    image: img || undefined,
    url: `${ORIGIN}/service/${id}`,
  };
  return {
    title,
    description: desc,
    path: `/service/${id}`,
    image: img,
    bodyHeading: title,
    bodySub: [s.category, s.location_text].filter(Boolean).map(esc).join(' · '),
    bodyText: s.description ? esc(s.description) : '',
    jsonld,
  };
}

// ── HTML renderer ────────────────────────────────────────────────────────────
function render(meta) {
  const fullTitle = `${meta.title} · Cergio`;
  const url = `${ORIGIN}${meta.path}`;
  const card = meta.image ? 'summary_large_image' : 'summary';
  const ogImage = meta.image
    ? `<meta property="og:image" content="${esc(meta.image)}" />
    <meta name="twitter:image" content="${esc(meta.image)}" />`
    : '';
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>${esc(fullTitle)}</title>
    <meta name="description" content="${esc(meta.description)}" />
    <link rel="canonical" href="${esc(url)}" />
    <meta property="og:site_name" content="Cergio" />
    <meta property="og:title" content="${esc(fullTitle)}" />
    <meta property="og:description" content="${esc(meta.description)}" />
    <meta property="og:type" content="website" />
    <meta property="og:url" content="${esc(url)}" />
    ${ogImage}
    <meta name="twitter:card" content="${card}" />
    <meta name="twitter:title" content="${esc(fullTitle)}" />
    <meta name="twitter:description" content="${esc(meta.description)}" />
    <script type="application/ld+json">${JSON.stringify(meta.jsonld)}</script>
  </head>
  <body>
    <main>
      <h1>${esc(meta.bodyHeading)}</h1>
      ${meta.bodySub ? `<p>${meta.bodySub}</p>` : ''}
      ${meta.bodyText ? `<p>${meta.bodyText}</p>` : ''}
      <p><a href="${esc(url)}">Open on Cergio</a></p>
    </main>
  </body>
</html>`;
}

// Fallback when the record can't be fetched (deleted, RLS, transient). Serve a
// valid generic card with a 200 so the scraper still gets SOMETHING branded
// rather than an error — and never a broken preview.
function fallback(path) {
  return render({
    title: 'Cergio',
    description:
      'Find trusted local services through your network. Free spotlights from connectors, refer friends and earn.',
    path: path || '/',
    image: null,
    bodyHeading: 'Cergio',
    bodySub: '',
    bodyText: 'Find trusted local services through your network.',
    jsonld: {
      '@context': 'https://schema.org',
      '@type': 'WebSite',
      name: 'Cergio',
      url: ORIGIN,
    },
  });
}

export default async function handler(req, res) {
  const q = req.query || {};
  const kind = String(q.kind || '');
  const id = cleanId(q.id);
  const reqPath =
    kind === 'service'
      ? `/service/${q.id}`
      : kind === 'profile_services'
        ? `/u/${q.id}/services`
        : `/u/${q.id}`;

  let meta = null;
  try {
    if (id && kind === 'service') meta = await buildService(id);
    else if (id && kind === 'profile') meta = await buildProfile(id, false);
    else if (id && kind === 'profile_services')
      meta = await buildProfile(id, true);
  } catch {
    meta = null;
  }

  // Crawlers benefit from caching; let the CDN hold the rendered card briefly.
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.setHeader(
    'Cache-Control',
    'public, max-age=0, s-maxage=300, stale-while-revalidate=86400',
  );
  res.status(200).send(meta ? render(meta) : fallback(reqPath));
}
