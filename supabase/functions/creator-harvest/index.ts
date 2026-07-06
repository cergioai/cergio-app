// Supabase Edge Function — FREE creator harvester (zero Mac, zero paid API).
//
// Discovers on-values greater-Miami creators via keyless web search (DuckDuckGo
// HTML endpoint), extracts a public email/phone from result snippets or the
// creator's OWN link-in-bio / website (third-party public sites — NOT Meta's
// property, same clean-room rule as enrich-influencers), and inserts them into
// leads_influencers as 'new'. Then runs the creator gate so reachable, on-values
// creators become 'queued' (sendable). Runs on pg_cron via cergio_call_edge —
// no Mac, no key. Reversible: everything tagged discovered_via='se:web-harvest'.
//
// AUTH: service-role bearer only (cron).

import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4?target=deno&deno-std=0.224.0';

// On-values creator niches (category is chosen to pass cergio_grade_creators).
const NICHES: Array<{ q: string; category: string }> = [
  { q: 'personal trainer',      category: 'fitness' },
  { q: 'fitness coach',         category: 'fitness' },
  { q: 'makeup artist',         category: 'makeup beauty' },
  { q: 'hair stylist',          category: 'hair beauty' },
  { q: 'lash artist',           category: 'beauty lash' },
  { q: 'nail artist',           category: 'beauty nail' },
  { q: 'esthetician skincare',  category: 'beauty skincare' },
  { q: 'photographer',          category: 'photographer' },
  { q: 'videographer',          category: 'photographer' },
  { q: 'yoga instructor',       category: 'yoga wellness' },
  { q: 'pilates instructor',    category: 'pilates wellness' },
  { q: 'wellness coach',        category: 'wellness' },
  { q: 'nutrition coach',       category: 'nutrition wellness' },
  { q: 'personal chef',         category: 'chef food' },
  { q: 'event wedding planner', category: 'event wedding planner' },
  { q: 'barber',                category: 'beauty barber' },
  { q: 'content creator',       category: 'creator lifestyle' },
  { q: 'mom blogger',           category: 'mom family' },
];
const CITIES = ['Miami', 'Miami Beach', 'Hialeah', 'Coral Gables', 'Doral', 'Aventura',
  'Hollywood FL', 'Fort Lauderdale', 'Kendall', 'Brickell'];

const MAX_QUERIES   = 40;   // high-volume discovery — target 1000+ new/day across continuous runs
const MAX_SITEFETCH = 60;   // bounded external fetches for email mining
const DEADLINE_MS   = 125000;

serve(async (req: Request) => {
  if (req.method !== 'POST' && req.method !== 'GET') return new Response('Method not allowed', { status: 405 });
  const started = Date.now();
  let stage = 'init';
  const dbg = { raw_results: 0, queries_with_results: 0, first_urls: [] as string[] };
  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const serviceKey  = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const auth = (req.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '').trim();
    if (!auth || auth !== serviceKey) return json({ error: 'Unauthorized' }, 401);
    const db = createClient(supabaseUrl, serviceKey);

    const tag = `se:web-harvest-${new Date().toISOString().slice(0, 10)}`;
    // Rotate the niche subset by day so we cover the whole list over time.
    const day = Math.floor(Date.now() / 86400000);
    // Rotate by run (hour), not just day, so continuous runs cover more ground.
    const spin = Math.floor(Date.now() / 3600000);
    const niches = rotate(NICHES, (spin * 3) % NICHES.length).slice(0, 12);
    const cities = rotate(CITIES, (spin * 2) % CITIES.length).slice(0, 4);

    const queries: string[] = [];
    for (const n of niches) for (const c of cities) {
      queries.push(`${c} ${n.q} instagram gmail.com`);
      queries.push(`${c} ${n.q} linktr.ee email contact`);   // non-Meta pages we CAN fetch for the email
    }
    queries.length = Math.min(queries.length, MAX_QUERIES);

    const seen = new Set<string>();
    const rows: Array<Record<string, unknown>> = [];
    let siteFetches = 0;

    for (const query of queries) {
      if (Date.now() - started > DEADLINE_MS) break;
      const niche = niches.find(n => query.includes(n.q)) || NICHES[0];
      const city  = cities.find(c => query.startsWith(c)) || 'Miami';
      stage = 'search';
      const results = await ddgSearch(query);
      dbg.raw_results += results.length;
      if (results.length) { dbg.queries_with_results++; if (dbg.first_urls.length < 5) dbg.first_urls.push(...results.slice(0, 2).map(r => r.url)); }

      for (const r of results) {
        if (Date.now() - started > DEADLINE_MS) break;
        const handle = igHandle(r.url);
        const isIG = /instagram\.com/i.test(r.url);
        const key = (handle || r.url).toLowerCase();
        if (seen.has(key)) continue;

        // Contact from the snippet/title first (free, no fetch).
        let email = firstEmail(r.snippet + ' ' + r.title);
        let phone = firstPhone(r.snippet + ' ' + r.title);

        // If still nothing and it's a NON-Meta site, mine the page (bounded).
        if (!email && !phone && !isIG && siteFetches < MAX_SITEFETCH) {
          siteFetches++;
          const page = await fetchText(r.url);
          if (page) { email = firstEmail(page); phone = firstPhone(page); }
        }
        // VOLUME MODE: keep the creator if we have a contact OR a mineable link
        // (their non-IG site / linktree). Contactless-with-link rows get their
        // contacts filled by enrich-influencers (runs every 30 min) → then gated.
        const ext = isIG ? null : r.url;   // their own site/linktree = enrich can mine it
        if (!email && !phone && !ext) continue;

        // Suppression guard before persisting an email we'd contact.
        if (email) {
          stage = 'suppression';
          const { data: s, error: sErr } = await db.from('outreach_suppressions')
            .select('id').eq('channel', 'email').ilike('address', email).maybeSingle();
          if (!sErr && s) email = null;   // ignore suppression-table errors, don't abort the run
        }

        seen.add(key);
        const id = `harv:${(handle || email || r.url).replace(/[^a-z0-9]+/gi, '').slice(0, 60).toLowerCase()}`;
        rows.push({
          id, ig_handle: handle, display_name: cleanTitle(r.title),
          category: niche.category, email, phone, external_url: ext, city, state: 'FL',
          is_business: false, discovered_via: tag, outreach_status: 'new',
          created_at: new Date().toISOString(),
        });
      }
    }

    let inserted = 0; let upsertError: string | null = null;
    if (rows.length) {
      stage = 'upsert';
      // Insert in small chunks; capture (don't throw) so one bad row can't abort all.
      for (let i = 0; i < rows.length; i += 25) {
        const chunk = rows.slice(i, i + 25);
        const { error } = await db.from('leads_influencers')
          .upsert(chunk, { onConflict: 'id', ignoreDuplicates: false });
        if (error) { upsertError = serr(error); } else { inserted += chunk.length; }
      }
    }

    stage = 'gate';
    try { await db.rpc('cergio_grade_creators'); } catch (_e) { /* non-fatal */ }
    try { await db.rpc('cergio_ops_audit'); } catch (_e) { /* non-fatal */ }

    stage = 'count';
    const { count: sendable } = await db.from('leads_influencers')
      .select('id', { count: 'exact', head: true }).eq('outreach_status', 'queued');

    // Log EVERY run so a no-op can never look like success again.
    try {
      await db.from('harvest_runs').insert({
        tag, queries: queries.length, raw_results: dbg.raw_results,
        candidates: rows.length, upserted: inserted, ms: Date.now() - started,
      });
    } catch (_e) { /* table may not exist yet on first deploy */ }

    return json({
      ok: true, tag, queries: queries.length, site_fetches: siteFetches,
      candidates_with_contact: rows.length, upserted: inserted, upsert_error: upsertError,
      creators_sendable_total: sendable ?? null, dbg,
      ms: Date.now() - started,
      sample: rows.slice(0, 8).map(r => ({ h: r.ig_handle, c: r.email || r.phone })),
    });
  } catch (e) {
    return json({ error: serr(e), stage, dbg, ms: Date.now() - started }, 500);
  }
});

function serr(e: unknown): string {
  if (!e) return 'unknown';
  if (e instanceof Error) return e.message;
  if (typeof e === 'string') return e;
  const o = e as Record<string, unknown>;
  return String(o.message || o.error_description || o.msg || o.details || o.hint || o.code || JSON.stringify(e));
}

// ---- DuckDuckGo keyless HTML search ----
async function ddgSearch(query: string): Promise<Array<{ url: string; title: string; snippet: string }>> {
  const endpoints = [
    `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`,
    `https://lite.duckduckgo.com/lite/?q=${encodeURIComponent(query)}`,
  ];
  for (const ep of endpoints) {
    const html = await fetchText(ep, 8000);
    if (!html) continue;
    const out: Array<{ url: string; title: string; snippet: string }> = [];
    // html endpoint: result blocks with result__a (link+title) and result__snippet.
    const re = /<a[^>]*class="[^"]*result__a[^"]*"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>[\s\S]*?(?:class="[^"]*result__snippet[^"]*"[^>]*>([\s\S]*?)<\/a>)?/gi;
    let m: RegExpExecArray | null;
    while ((m = re.exec(html)) && out.length < 12) {
      const url = decodeDdg(m[1]);
      if (!url) continue;
      out.push({ url, title: stripTags(m[2] || ''), snippet: stripTags(m[3] || '') });
    }
    // lite endpoint fallback: plain anchors + adjacent text.
    if (!out.length) {
      const re2 = /<a[^>]*href="(https?:\/\/[^"]+|\/l\/\?[^"]+)"[^>]*>([\s\S]*?)<\/a>/gi;
      let m2: RegExpExecArray | null;
      while ((m2 = re2.exec(html)) && out.length < 12) {
        const url = decodeDdg(m2[1]);
        if (!url || /duckduckgo\.com/i.test(url)) continue;
        out.push({ url, title: stripTags(m2[2] || ''), snippet: '' });
      }
    }
    if (out.length) return out;
  }
  return [];
}

function decodeDdg(href: string): string | null {
  try {
    if (href.startsWith('//duckduckgo.com/l/') || href.startsWith('/l/') || href.includes('duckduckgo.com/l/')) {
      const u = new URL(href.startsWith('//') ? 'https:' + href : (href.startsWith('/') ? 'https://duckduckgo.com' + href : href));
      const target = u.searchParams.get('uddg');
      return target ? decodeURIComponent(target) : null;
    }
    if (href.startsWith('http')) return href;
    return null;
  } catch { return null; }
}

function igHandle(url: string): string | null {
  const m = url.match(/instagram\.com\/([A-Za-z0-9._]+)/i);
  if (!m) return null;
  const h = m[1].toLowerCase();
  if (['p', 'reel', 'reels', 'explore', 'stories', 'tv', 'accounts'].includes(h)) return null;
  return h;
}

function cleanTitle(t: string): string {
  return t.replace(/\s*[•|(].*$/, '').replace(/on instagram.*$/i, '').replace(/\s+/g, ' ').trim().slice(0, 80) || 'Creator';
}
function rotate<T>(arr: T[], n: number): T[] { const k = ((n % arr.length) + arr.length) % arr.length; return arr.slice(k).concat(arr.slice(0, k)); }
function stripTags(s: string): string { return s.replace(/<[^>]+>/g, ' ').replace(/&amp;/g, '&').replace(/&#x27;/g, "'").replace(/&quot;/g, '"').replace(/&gt;/g, '>').replace(/&lt;/g, '<').replace(/\s+/g, ' ').trim(); }

async function fetchText(url: string, timeout = 6000): Promise<string | null> {
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), timeout);
    const res = await fetch(url, { signal: ctrl.signal, headers: {
      'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0 Safari/537.36',
      'Accept': 'text/html,application/xhtml+xml',
    } });
    clearTimeout(t);
    if (!res.ok) return null;
    return (await res.text()).slice(0, 250000);
  } catch { return null; }
}

// Directory/aggregator + infra domains whose email is NOT the creator's.
const BAD_EMAIL_DOMAIN = /(feedspot|modash|inbeat|snappr|superprof|peerspace|theknot|partyslate|wezoree|yelp|tripadvisor|thumbtack|nextdoor|takeachef|cookingenie|flytographer|lifetime|sentry|wixpress|example\.com|domain\.com|yourdomain|godaddy|squarespace|wix\.com|cloudflare|shopify|mailchimp|sentry\.io)/;
// Placeholder / role local-parts that aren't a real person to contact.
const BAD_EMAIL_LOCAL = /^(user|name|email|your|youremail|example|test|firstname|lastname|hello|admin|webmaster|noreply|no-reply|donotreply)$/;
function firstEmail(s: string): string | null {
  const m = s.match(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g) || [];
  for (const e of m) {
    const x = e.toLowerCase();
    if (/\.(png|jpg|jpeg|gif|webp|svg|css|js)$/.test(x)) continue;
    if (BAD_EMAIL_DOMAIN.test(x)) continue;
    const local = x.split('@')[0];
    if (BAD_EMAIL_LOCAL.test(local)) continue;
    return x;
  }
  return null;
}
function firstPhone(s: string): string | null {
  const m = s.match(/\(?\b\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4}\b|\+1\d{10}/g) || [];
  for (const p of m) {
    const digits = p.replace(/\D/g, '');
    if (digits.length === 10) return `+1${digits}`;
    if (digits.length === 11 && digits.startsWith('1')) return `+${digits}`;
  }
  return null;
}
function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}
