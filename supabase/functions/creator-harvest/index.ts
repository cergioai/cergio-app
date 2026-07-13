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
// BLOCKED (never harvested — MEMORY: mobile_first_positioning + no-values guard):
// massage, tattoo, makeup, personal chef, plus SHAFT (sex/hate/alcohol/firearms/
// tobacco/gambling/adult/DJ-nightlife/plastic surgery/drugs). Do NOT re-add them.
const NICHES: Array<{ q: string; category: string }> = [
  { q: 'personal trainer',      category: 'fitness' },
  { q: 'fitness coach',         category: 'fitness' },
  { q: 'bootcamp trainer',      category: 'fitness' },
  { q: 'run coach',             category: 'fitness' },
  { q: 'hair stylist',          category: 'hair beauty' },
  { q: 'hair colorist',         category: 'hair beauty' },
  { q: 'braider',               category: 'hair beauty' },
  { q: 'lash artist',           category: 'beauty lash' },
  { q: 'lash tech',             category: 'beauty lash' },
  { q: 'nail artist',           category: 'beauty nail' },
  { q: 'nail tech',             category: 'beauty nail' },
  { q: 'esthetician skincare',  category: 'beauty skincare' },
  { q: 'skincare specialist',   category: 'beauty skincare' },
  { q: 'brow artist',           category: 'beauty brow' },
  { q: 'photographer',          category: 'photographer' },
  { q: 'portrait photographer', category: 'photographer' },
  { q: 'brand photographer',    category: 'photographer' },
  { q: 'videographer',          category: 'photographer' },
  { q: 'content photographer',  category: 'photographer' },
  { q: 'yoga instructor',       category: 'yoga wellness' },
  { q: 'yoga teacher',          category: 'yoga wellness' },
  { q: 'pilates instructor',    category: 'pilates wellness' },
  { q: 'pilates teacher',       category: 'pilates wellness' },
  { q: 'wellness coach',        category: 'wellness' },
  { q: 'nutrition coach',       category: 'nutrition wellness' },
  { q: 'holistic health coach', category: 'wellness' },
  { q: 'meditation teacher',    category: 'wellness' },
  { q: 'event wedding planner', category: 'event wedding planner' },
  { q: 'event planner',         category: 'event wedding planner' },
  { q: 'wedding photographer',  category: 'event wedding planner' },
  { q: 'party stylist',         category: 'event wedding planner' },
  { q: 'baker',                 category: 'baker food' },
  { q: 'cake artist',           category: 'baker food' },
  { q: 'pastry chef',           category: 'baker food' },
  { q: 'food blogger',          category: 'food creator' },
  { q: 'barber',                category: 'beauty barber' },
  { q: 'content creator',       category: 'creator lifestyle' },
  { q: 'lifestyle blogger',     category: 'creator lifestyle' },
  { q: 'fashion blogger',       category: 'fashion creator' },
  { q: 'fashion stylist',       category: 'fashion creator' },
  { q: 'personal stylist',      category: 'fashion creator' },
  { q: 'pet groomer',           category: 'pets' },
  { q: 'dog trainer',           category: 'pets' },
  { q: 'pet photographer',      category: 'pets' },
  { q: 'mom blogger',           category: 'mom family' },
];
// Greater-Miami cities + neighborhoods — a richer geo set finds different handles.
const CITIES = ['Miami', 'Miami Beach', 'Hialeah', 'Coral Gables', 'Doral', 'Aventura',
  'Hollywood FL', 'Fort Lauderdale', 'Kendall', 'Brickell', 'Wynwood', 'Little Havana',
  'Coconut Grove', 'South Beach', 'Pinecrest', 'Sunny Isles', 'North Miami',
  'Miami Lakes', 'Cutler Bay', 'Homestead'];
// Query-shape modifiers — each rotates independently so the SAME niche×city can
// still surface NEW handles run-to-run instead of repeating one rigid phrasing.
// {c} = city, {n} = niche query.
const MODIFIERS = [
  '{c} {n} instagram',
  '{c} {n} instagram contact email',
  '{c} {n} book on instagram',
  '{c} {n} creator instagram',
  '{c} {n} linktr.ee',
  '{c} {n} beacons.ai',
  '{c} {n} instagram gmail.com',
  '{c} based {n} instagram',
  'best {c} {n} instagram',
  '{c} {n} instagram dm to book',
];

const MAX_QUERIES   = 48;   // high-volume discovery — target 1000+ new/day across continuous runs
const MAX_SITEFETCH = 60;   // bounded external fetches for email mining
const DEADLINE_MS   = 125000;

serve(async (req: Request) => {
  if (req.method !== 'POST' && req.method !== 'GET') return new Response('Method not allowed', { status: 405 });
  const started = Date.now();
  let stage = 'init';
  const dbg = { raw_results: 0, queries_with_results: 0, first_urls: [] as string[] };
  let dbRef: any = null;   // hoisted so the catch can log an agent_runs error row
  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const serviceKey  = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const auth = (req.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '').trim();
    if (!auth || auth !== serviceKey) return json({ error: 'Unauthorized' }, 401);
    const db = createClient(supabaseUrl, serviceKey);
    dbRef = db;

    const tag = `se:web-harvest-${new Date().toISOString().slice(0, 10)}`;
    // ROTATION (Discovery fix 2026-07-08): the old set repeated the SAME two rigid
    // query shapes over a 12×4 slice every run, so it kept re-finding already-known
    // handles and yielded 0 NEW candidates. Now each run advances a per-run counter
    // (`spin`, one step every ~20 min = the cron cadence) and rotates niches, cities
    // AND modifier phrasings by DIFFERENT co-prime offsets, so each run explores a
    // genuinely different slice of the niche × city × modifier space (≈ 45 niches ×
    // 20 cities × 10 shapes = 9,000 distinct queries cycled over successive runs).
    const spin = Math.floor(Date.now() / 1200000);   // 20-min run bucket
    const niches = rotate(NICHES,    (spin * 7)  % NICHES.length);
    const cities = rotate(CITIES,    (spin * 3)  % CITIES.length);
    const mods   = rotate(MODIFIERS, (spin * 2)  % MODIFIERS.length);

    // Build a rotated, de-duplicated query list: walk niche × city × modifier
    // diagonally so a single run mixes several niches/cities/shapes (max coverage)
    // rather than exhausting one niche first. Cap at MAX_QUERIES.
    const queries: Array<{ query: string; niche: { q: string; category: string }; city: string }> = [];
    const qseen = new Set<string>();
    outer:
    for (let i = 0; i < niches.length; i++) {
      const n = niches[i];
      for (let j = 0; j < cities.length; j++) {
        const c = cities[(i + j) % cities.length];
        const mod = mods[(i + j) % mods.length];
        const query = mod.replace('{c}', c).replace('{n}', n.q);
        const k = query.toLowerCase();
        if (qseen.has(k)) continue;
        qseen.add(k);
        queries.push({ query, niche: n, city: c });
        if (queries.length >= MAX_QUERIES) break outer;
      }
    }

    const seen = new Set<string>();
    const rows: Array<Record<string, unknown>> = [];
    let siteFetches = 0;
    // Skip-reason tally so the watchdog can see WHY a run found nothing new.
    const skips = { known_handle: 0, no_handle: 0, no_contact_no_link: 0, blocked: 0, suppressed: 0, non_creator: 0 };

    for (const item of queries) {
      if (Date.now() - started > DEADLINE_MS) break;
      const query = item.query;
      const niche = item.niche;
      const city  = item.city;
      stage = 'search';
      const results = await ddgSearch(query);
      dbg.raw_results += results.length;
      if (results.length) { dbg.queries_with_results++; if (dbg.first_urls.length < 5) dbg.first_urls.push(...results.slice(0, 2).map(r => r.url)); }

      for (const r of results) {
        if (Date.now() - started > DEADLINE_MS) break;
        // Handle can come from the result URL, the DDG snippet/title, or (below)
        // the fetched page. Discovery queries deliberately target linktr.ee/contact
        // pages, whose RESULT URL is not instagram.com — so igHandle(r.url) was null
        // for ~all of them and the handle-guard zeroed candidates (100 raw -> 0).
        // These pages almost always LINK to the creator's instagram.com/<handle>;
        // mining that restores real-handle discovery WITHOUT weakening the guard.
        // (Forensic Auditor 2026-07-08 — creators frozen at 26 sendable.)
        let handle = igHandle(r.url) || igHandle(r.snippet + ' ' + r.title);
        const isIG = /instagram\.com/i.test(r.url);
        const key = (handle || r.url).toLowerCase();
        if (seen.has(key)) { skips.known_handle++; continue; }

        // Contact from the snippet/title first (free, no fetch).
        let email = firstEmail(r.snippet + ' ' + r.title);
        let phone = firstPhone(r.snippet + ' ' + r.title);

        // Mine the NON-Meta page when we still need a contact OR a real IG handle.
        if ((!handle || (!email && !phone)) && !isIG && siteFetches < MAX_SITEFETCH) {
          siteFetches++;
          const page = await fetchText(r.url);
          if (page) {
            if (!email) email = firstEmail(page);
            if (!phone) phone = firstPhone(page);
            if (!handle) handle = igHandle(page);   // creator's IG link on their linktree/site
          }
        }
        // VOLUME MODE: keep the creator if we have a contact OR a mineable link
        // (their non-IG site / linktree). Contactless-with-link rows get their
        // contacts filled by enrich-influencers (runs every 30 min) → then gated.
        const ext = isIG ? null : r.url;   // their own site/linktree = enrich can mine it
        if (!email && !phone && !ext) { skips.no_contact_no_link++; continue; }

        // Suppression guard before persisting an email we'd contact.
        if (email) {
          stage = 'suppression';
          const { data: s, error: sErr } = await db.from('outreach_suppressions')
            .select('id').eq('channel', 'email').ilike('address', email).maybeSingle();
          if (!sErr && s) { email = null; skips.suppressed++; }   // ignore suppression-table errors, don't abort the run
        }

        seen.add(key);
        // QUALITY GATE (Forensic Auditor 2026-07-08): a creator row MUST have a
        // real IG handle. leads_influencers.ig_handle is NOT NULL, so handle-less
        // rows were (a) throwing a not-null violation that failed the WHOLE upsert
        // chunk (upserted:0 despite 68 candidates, creators frozen 55h) and (b)
        // letting non-creator emails in (e.g. billing@wordfence.com, business
        // front desks). enrich-influencers cannot add a handle, so skip these.
        if (!handle) { skips.no_handle++; continue; }
        // NON-CREATOR GUARD (Forensic Auditor 2026-07-08): listicles & news
        // pages link to media-outlet / wiki / aggregator IG handles
        // (foxbusiness, eatermiami, tampabaytimes, thefashionspot, wikipedia…).
        // Those are NOT individual creators and were polluting the sendable
        // pool ~20-25%. enrich/gate can't fix identity, so drop at the source.
        if (isBadHandle(handle)) { skips.non_creator++; continue; }
        const id = `harv:${handle.replace(/[^a-z0-9]+/gi, '').slice(0, 60).toLowerCase()}`;
        rows.push({
          id, ig_handle: handle, display_name: cleanTitle(r.title),
          category: niche.category, email, phone, external_url: ext, city, state: 'FL',
          is_business: false, discovered_via: tag, outreach_status: 'new',
          created_at: new Date().toISOString(),
        });
      }
    }

    // Dedupe by PRIMARY KEY before upserting. Two distinct handles can collapse
    // to the SAME id after stripping non-alphanumerics + slicing to 60 chars,
    // which puts duplicate ids in one chunk → Postgres "ON CONFLICT DO UPDATE
    // command cannot affect row a second time", aborting the whole chunk
    // (Forensic Auditor 2026-07-08 — creator_harvest_last_error). Keep first.
    const byId = new Map<string, Record<string, unknown>>();
    for (const r of rows) { const k = r.id as string; if (!byId.has(k)) byId.set(k, r); }
    const uniqueRows = [...byId.values()];

    let inserted = 0; let upsertError: string | null = null;
    if (uniqueRows.length) {
      stage = 'upsert';
      // Insert in small chunks; capture (don't throw) so one bad row can't abort all.
      for (let i = 0; i < uniqueRows.length; i += 25) {
        const chunk = uniqueRows.slice(i, i + 25);
        const { error } = await db.from('leads_influencers')
          .upsert(chunk, { onConflict: 'id', ignoreDuplicates: false });
        if (error) {
          upsertError = serr(error);
          // Chunk upsert is atomic, so one bad row zeroes 25 good ones. Retry the
          // chunk row-by-row so a single bad row can no longer abort the batch
          // (Forensic Auditor 2026-07-08 — the resilience the old comment claimed).
          for (const one of chunk) {
            const { error: e1 } = await db.from('leads_influencers')
              .upsert([one], { onConflict: 'id', ignoreDuplicates: false });
            if (!e1) inserted += 1;
          }
        } else { inserted += chunk.length; }
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

    // BACKBONE: unified agent_runs ledger — success = rows written, not sent.
    // 'empty' when we found raw results but wrote nothing OR found nothing.
    const harvestStatus = dbg.raw_results > 0 && inserted === 0 ? 'empty'
      : (inserted === 0 ? 'empty' : 'ok');
    await logAgentRun(db, 'creator-harvest', {
      started, raw_found: dbg.raw_results, rows_written: inserted,
      status: harvestStatus, error: upsertError,
      // skips explains WHY a run wrote nothing new so the watchdog can tell a
      // dedupe no-op (known_handle high) from a discovery miss (no_handle high).
      meta: { tag, queries: queries.length, candidates: rows.length, site_fetches: siteFetches, skips, spin },
    });

    return json({
      ok: true, tag, queries: queries.length, site_fetches: siteFetches,
      candidates_with_contact: rows.length, upserted: inserted, upsert_error: upsertError,
      creators_sendable_total: sendable ?? null, skips, dbg,
      ms: Date.now() - started,
      sample: rows.slice(0, 8).map(r => ({ h: r.ig_handle, c: r.email || r.phone })),
    });
  } catch (e) {
    // BACKBONE: log the crash so the watchdog sees status='error', not a stall.
    await logAgentRun(dbRef, 'creator-harvest', {
      started, raw_found: dbg.raw_results, rows_written: 0,
      status: 'error', error: serr(e), meta: { stage },
    });
    return json({ error: serr(e), stage, dbg, ms: Date.now() - started }, 500);
  }
});

// BACKBONE helper — write ONE agent_runs row per invocation. NEVER throws (a
// logging failure must never break or mask the worker's real outcome).
async function logAgentRun(
  db: any,
  agent: string,
  o: { started: number; raw_found?: number | null; rows_written?: number | null;
       status?: string; error?: string | null; meta?: unknown },
): Promise<void> {
  if (!db) return;
  try {
    await db.from('agent_runs').insert({
      agent,
      started_at: new Date(o.started).toISOString(),
      finished_at: new Date().toISOString(),
      raw_found: o.raw_found ?? null,
      rows_written: o.rows_written ?? null,
      status: o.status ?? 'ok',
      error: o.error ? String(o.error).slice(0, 1000) : null,
      meta: o.meta ?? null,
    });
  } catch (_e) { /* logging is best-effort; swallow */ }
}

// ── CANONICAL ERROR SERIALIZER — DO NOT FORK ─────────────────────────────────
// Supabase/PostgREST rejects with a PLAIN OBJECT ({message, details, hint, code}),
// NOT an Error. `String(e)` on that object yields the opaque "[object Object]" —
// which is exactly how 11/11 failed autonomous actions recorded an unreadable
// `result` and the loop went blind (Forensic Auditor 2026-07-13). Always extract a
// REAL message + code (+ 2 stack frames) so every failure is diagnosable.
// qa.mjs #73 asserts every copy of this helper is byte-identical, unit-tests it
// against a PostgREST-shaped rejection, and fails the push if it can ever emit
// "[object Object]".
function serr(e: unknown): string {
  if (e === null || e === undefined) return 'unknown error (null)';
  if (typeof e === 'string') return e || 'unknown error (empty string)';
  const o = e as any;
  const msg = (e instanceof Error ? e.message : null)
    || o?.message || o?.error?.message || o?.error_description || o?.msg
    || o?.details || o?.hint || null;
  const code = o?.code ?? o?.error?.code ?? o?.status ?? o?.statusCode ?? null;
  const parts: string[] = [];
  if (msg) parts.push(String(msg));
  if (code !== null && code !== undefined && String(code) !== '') parts.push('[' + String(code) + ']');
  if (o?.details && String(o.details) !== String(msg)) parts.push('- ' + String(o.details));
  if (o?.hint && String(o.hint) !== String(msg)) parts.push('(hint: ' + String(o.hint) + ')');
  if (parts.length === 0) {
    let dump = '';
    try { dump = JSON.stringify(e); } catch (_j) { dump = ''; }
    parts.push(dump && dump !== '{}' ? dump : 'unhandled ' + (typeof e) + ' thrown with no message/code/details fields');
  }
  if (e instanceof Error && e.stack) {
    const frames = String(e.stack).split('\n').slice(1, 3).map((s) => s.trim()).filter(Boolean).join(' <- ');
    if (frames) parts.push('| ' + frames);
  }
  return parts.join(' ').trim().slice(0, 900);
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

// Media outlets / publications / wikis / directories whose IG handle shows up on
// listicles and news results but is NOT an individual creator we can onboard.
// (Forensic Auditor 2026-07-08 — the 386 sendable pool was ~20-25% these.)
const BAD_HANDLE = /(news|nytimes|thetimes|herald|gazette|tribune|magazine|eater|thrillist|timeout|refinery29|buzzfeed|voguemagazine|foxbusiness|foxnews|^fox\d|cnn|nbc|abcnews|cbsnews|msnbc|wikipedia|wikimedia|tampabay|miamiherald|miaminewtimes|thefashionspot|forbes|businessinsider|bloomberg|reuters|yelp|tripadvisor|thumbtack|nextdoor|groupon|realtor|zillow|apartments|official_?news|dot_?com)/i;
function isBadHandle(h: string | null): boolean {
  if (!h) return true;
  if (h.length < 3) return true;      // too short to be a real handle
  if (/^\d+$/.test(h)) return true;   // purely numeric = not a creator handle
  return BAD_HANDLE.test(h);
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
