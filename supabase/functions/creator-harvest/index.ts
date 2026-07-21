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
  // Tarik's 14 target categories — INFLUENCERS / content creators (people with an
  // audience who publish a partner/collab email), NOT bookable service providers.
  { q: 'parenting influencer',        category: 'parenting' },
  { q: 'mom influencer',              category: 'parenting' },
  { q: 'family content creator',      category: 'parenting' },
  { q: 'fitness influencer',          category: 'fitness' },
  { q: 'fitness content creator',     category: 'fitness' },
  { q: 'health influencer',           category: 'health' },
  { q: 'healthy living creator',      category: 'health' },
  { q: 'pet influencer',              category: 'pets' },
  { q: 'dog influencer',              category: 'pets' },
  { q: 'nutrition influencer',        category: 'nutrition' },
  { q: 'dietitian content creator',   category: 'nutrition' },
  { q: 'wedding influencer',          category: 'weddings' },
  { q: 'bride content creator',       category: 'weddings' },
  { q: 'home decor influencer',       category: 'home' },
  { q: 'interior design creator',     category: 'home' },
  { q: 'real estate influencer',      category: 'real estate' },
  { q: 'realtor content creator',     category: 'real estate' },
  { q: 'fashion influencer',          category: 'fashion' },
  { q: 'style content creator',       category: 'fashion' },
  { q: 'lifestyle influencer',        category: 'lifestyle' },
  { q: 'lifestyle blogger',           category: 'lifestyle' },
  { q: 'beauty influencer',           category: 'beauty' },
  { q: 'skincare influencer',         category: 'beauty' },
  { q: 'shopping influencer',         category: 'shopping' },
  { q: 'fashion haul creator',        category: 'shopping' },
  { q: 'car influencer',              category: 'auto' },
  { q: 'auto content creator',        category: 'auto' },
  { q: 'wellness influencer',         category: 'wellness' },
  { q: 'self care creator',           category: 'wellness' },
];
// NYC + Miami dual-metro geo set (SPEC-86 expansion): accumulate BOTH cities
// toward ~200 each. cityVerified() gates every hit to the creator's own text, so
// a Miami query that surfaces an LA/Utah handle is dropped — geo stays honest.
const CITIES = [
  // New York
  'New York', 'Manhattan', 'Brooklyn', 'Queens', 'Bronx', 'New York City',
  'Williamsburg', 'Bushwick', 'Harlem', 'Astoria', 'Long Island City',
  'Park Slope', 'Lower East Side', 'Upper East Side', 'SoHo', 'Greenpoint',
  // Miami
  'Miami', 'Miami Beach', 'Brickell', 'Wynwood', 'Coral Gables', 'Doral',
  'South Beach', 'Coconut Grove', 'Aventura', 'Little Havana', 'Hialeah',
  'Fort Lauderdale', 'North Miami', 'Kendall', 'Pinecrest'];
// Query-shape modifiers — each rotates independently so the SAME niche×city can
// still surface NEW handles run-to-run instead of repeating one rigid phrasing.
// {c} = city, {n} = niche query.
const MODIFIERS = [
  '{c} {n} instagram',
  'top {c} {n} instagram',
  'top 25 {c} {n} to follow',
  'best {c} {n} instagram to follow',
  '{c} {n} instagram collab email',
  '{c} {n} instagram partnerships email',
  '{c} micro influencer {n} instagram',
  '{c} {n} linktr.ee email',
  '{c} {n} instagram gmail.com',
  '{c} based {n} instagram',
]

const MAX_QUERIES   = 48;   // high-volume discovery — target 1000+ new/day across continuous runs
const MAX_SITEFETCH = 60;   // bounded external fetches for email mining
const DEADLINE_MS   = 125000;

// ── QUALITY GATE HELPERS (SPEC-86, 2026-07-18) — enforce the frozen creator bar:
//    verified geo only, individual (not business), NO fabricated fields. ──
const CITY_STATE: Record<string, string> = {
  'New York': 'NY', 'Brooklyn': 'NY', 'Manhattan': 'NY', 'Queens': 'NY', 'Bronx': 'NY',
  'New York City': 'NY', 'Williamsburg': 'NY', 'Bushwick': 'NY', 'Harlem': 'NY', 'Astoria': 'NY', 'Long Island City': 'NY', 'Park Slope': 'NY', 'Lower East Side': 'NY', 'Upper East Side': 'NY', 'SoHo': 'NY', 'Chelsea NYC': 'NY', 'Greenpoint': 'NY', 'Flushing': 'NY', 'Jackson Heights': 'NY', 'Staten Island': 'NY',
  'Miami Beach': 'FL', 'Brickell': 'FL', 'Wynwood': 'FL', 'Coral Gables': 'FL', 'Doral': 'FL', 'South Beach': 'FL', 'Coconut Grove': 'FL', 'Aventura': 'FL', 'Little Havana': 'FL', 'Hialeah': 'FL', 'North Miami': 'FL', 'Kendall': 'FL', 'Pinecrest': 'FL',
  'Miami': 'FL', 'Fort Lauderdale': 'FL', 'Los Angeles': 'CA', 'Chicago': 'IL',
  'Atlanta': 'GA', 'Washington': 'DC', 'San Francisco': 'CA', 'Boston': 'MA',
  'Philadelphia': 'PA', 'Dallas': 'TX', 'Houston': 'TX',
};
const CITY_ALIASES: Record<string, string[]> = {
  'New York': ['new york', 'nyc', 'brooklyn', 'manhattan', 'queens', 'bronx', 'new york city'],
  'New York City': ['new york', 'nyc', 'new york city'],
  'Williamsburg': ['new york', 'nyc', 'williamsburg'],
  'Bushwick': ['new york', 'nyc', 'bushwick'],
  'Harlem': ['new york', 'nyc', 'harlem'],
  'Astoria': ['new york', 'nyc', 'astoria'],
  'Long Island City': ['new york', 'nyc', 'long island city'],
  'Park Slope': ['new york', 'nyc', 'park slope'],
  'Lower East Side': ['new york', 'nyc', 'lower east side'],
  'Upper East Side': ['new york', 'nyc', 'upper east side'],
  'SoHo': ['new york', 'nyc', 'soho'],
  'Chelsea NYC': ['new york', 'nyc', 'chelsea'],
  'Greenpoint': ['new york', 'nyc', 'greenpoint'],
  'Flushing': ['new york', 'nyc', 'flushing'],
  'Jackson Heights': ['new york', 'nyc', 'jackson heights'],
  'Staten Island': ['new york', 'nyc', 'staten island'],
  'Miami': ['miami', 'brickell', 'wynwood', 'coral gables', 'south beach', 'miami beach', 'doral'],
  'Miami Beach': ['miami', 'miami beach', 'south florida', 'miami beach'],
  'Brickell': ['miami', 'miami beach', 'south florida', 'brickell'],
  'Wynwood': ['miami', 'miami beach', 'south florida', 'wynwood'],
  'Coral Gables': ['miami', 'miami beach', 'south florida', 'coral gables'],
  'Doral': ['miami', 'miami beach', 'south florida', 'doral'],
  'South Beach': ['miami', 'miami beach', 'south florida', 'south beach'],
  'Coconut Grove': ['miami', 'miami beach', 'south florida', 'coconut grove'],
  'Aventura': ['miami', 'miami beach', 'south florida', 'aventura'],
  'Little Havana': ['miami', 'miami beach', 'south florida', 'little havana'],
  'Hialeah': ['miami', 'miami beach', 'south florida', 'hialeah'],
  'Fort Lauderdale': ['miami', 'miami beach', 'south florida', 'fort lauderdale'],
  'North Miami': ['miami', 'miami beach', 'south florida', 'north miami'],
  'Kendall': ['miami', 'miami beach', 'south florida', 'kendall'],
  'Pinecrest': ['miami', 'miami beach', 'south florida', 'pinecrest'],
};
/** Geo is set ONLY when the creator's own text names the target city/area — kills
 *  the Utah-labeled-Miami class. If unverifiable, the row is dropped (never guessed). */
function cityVerified(city: string, text: string): boolean {
  const t = (text || '').toLowerCase();
  const al = CITY_ALIASES[city] || [city.toLowerCase()];
  return al.some((a) => t.includes(a));
}
/** Drop obvious business/brand accounts — kills the business-as-creator class. */
function isBusinessLike(handle: string, title: string): boolean {
  const s = `${handle} ${title}`.toLowerCase();
  return /(studio|salon|\bspa\b|clinic|official|boutique|\bco\b|\binc\b|\bllc\b|academy|\bagency\b|\bshop\b|\bstore\b|\bteam\b|\bhq\b|\bgroup\b|\bcompany\b|\bbrand\b)/.test(s);
}

// BLOCKED CONTENT guard (SPEC-86c, Forensic 2026-07-20): medical-aesthetic /
// medspa / injectable / laser / clinic accounts were slipping into the sendable
// pool tagged category 'beauty' (is_business=false), because isBusinessLike only
// scans handle+title and lacks medical terms. These are off-spec blocked
// categories (mobile_first_positioning: plastic surgery / med-spa). This scans
// handle+title+url+snippet for medical-aesthetic + SHAFT signals and is applied
// BOTH at the source (skip on harvest) and in the server-side self-heal cleanup
// (quarantine existing pending_review rows every cron tick — no Mac needed).
const BLOCKED_CONTENT_RE =
  /(med[\s.-]?spa|medi[\s.-]?spa|med[\s.-]?aesthetic|medical aesthetic|\baesthetics\b|\blaser\b|botox|filler|injectable|microneedl|dermatolog|plastic surg|liposuction|\bbbl\b|rejuven|iv[\s.-]?therapy|hormone|wellness ?center|health ?center|tattoo|\bvape\b|hookah|nightclub|casino|firearm)/i;
function isBlockedContent(...parts: Array<string | null | undefined>): boolean {
  return BLOCKED_CONTENT_RE.test(parts.filter(Boolean).join(' ').toLowerCase());
}

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

    // ── ONE-TIME SELF-HEALING CLEANUP (SPEC-86b): the earlier harvest pulled
    // bookable SERVICE providers (photographers, lash techs, event planners), not
    // influencers. Quarantine every pending_review row whose category is NOT one of
    // the 14 target influencer categories — EXCEPT the Modash-vetted seeds, which
    // are protected by discovered_via and kept no matter their legacy category tag.
    // Runs server-side on the cron tick (no Mac); harmless once the pool is clean.
    const TARGET_CATEGORIES = ['parenting','fitness','health','pets','nutrition',
      'weddings','home','real estate','fashion','lifestyle','beauty','shopping','auto','wellness'];
    try {
      const inList = '(' + TARGET_CATEGORIES.map((c) => '"' + c + '"').join(',') + ')';
      const { data: q } = await db.from('leads_influencers')
        .update({ outreach_status: 'do_not_contact' })
        .eq('outreach_status', 'pending_review')
        .neq('discovered_via', 'modash-vetted-seed')
        .not('category', 'in', inList)
        .select('id');
      if (q && q.length) console.log(`cleanup: quarantined ${q.length} off-target service-type rows`);
    } catch (_e) { /* cleanup is best-effort; never blocks a harvest run */ }

    // SELF-HEAL (SPEC-86c): quarantine any pending_review row that is a blocked
    // medical-aesthetic / med-spa / SHAFT account (matched on url/handle/name/bio).
    // Server-side, runs on the cron tick — closes the leak with zero Mac clicks.
    // Modash-vetted seeds are protected.
    try {
      const orExpr = [
        'external_url.ilike.%medspa%','external_url.ilike.%med-spa%','external_url.ilike.%aesthetic%',
        'external_url.ilike.%laser%','external_url.ilike.%botox%','external_url.ilike.%injectable%',
        'ig_handle.ilike.%medspa%','ig_handle.ilike.%aesthetic%','ig_handle.ilike.%laser%',
        'ig_handle.ilike.%medaesthetic%','display_name.ilike.%med spa%','display_name.ilike.%aesthetics%',
        'bio.ilike.%medspa%','bio.ilike.%med spa%','bio.ilike.%injectable%','bio.ilike.%botox%',
        'bio.ilike.%dermatolog%','bio.ilike.%plastic surg%',
      ].join(',');
      const { data: mq } = await db.from('leads_influencers')
        .update({ outreach_status: 'do_not_contact' })
        .eq('outreach_status', 'pending_review')
        .neq('discovered_via', 'modash-vetted-seed')
        .or(orExpr)
        .select('id');
      if (mq && mq.length) console.log(`cleanup: quarantined ${mq.length} blocked med-aesthetic rows`);
    } catch (_e) { /* best-effort */ }

    // ── PROMOTE HALF of the creator gate (SPEC-88, Forensic Auditor 2026-07-20) ──
    // ROOT CAUSE of "204 sendable, 0 EVER contacted": creator-harvest only ever
    // DEMOTED rows (the two quarantine blocks above). The PROMOTE half the
    // services gate has (leads_services new->'queued') was never built for
    // creators, so they sat forever at 'pending_review'. outreach-send's
    // influencer loop (WHERE outreach_status='queued') therefore found 0 rows and
    // the founder's MANUAL "Send Outreach" launcher emailed nobody.
    //
    // SAFETY — this does NOT auto-send. outreach-send is NOT on cron
    // (20260622180000_periodic_workers_cron.sql: "NOT scheduled: outreach-send.
    // Cold email/SMS stays MANUAL (the launcher)"). 'queued' is only the
    // sendable-but-not-yet-sent staging state; the founder still deliberately
    // fires the send launcher. Promoting to 'queued' therefore respects the
    // frozen never-auto-sent invariant (qa#84) — nothing leaves until a human
    // clicks. Reversible (a status flip).
    //
    // SCOPE — honors the spec's "passes the gate + human vet" rule: promote ONLY
    // the human-vetted set, never the raw se:web-harvest pool:
    //   (a) discovered_via='modash-vetted-seed' inside the category gate, OR
    //   (b) FOUNDER_VETTED_ALLOWLIST — the exact handles the founder hand-marked
    //       in "FOUNDING COHORT - creators (READY TO SEND).csv".
    // Both sets are hand-vetted (not med-spa), and the two quarantine blocks above
    // already ran this tick, so a blocked row cannot be sitting at pending_review
    // to be promoted.
    const FOUNDER_VETTED_ALLOWLIST = [
      'remixthedog','mallowfrenchie','bullyfambam','brookelilybrazelton',
      'byvictoriabarrientos','highonlifestylee','maryandpalettes','rachelove',
      'fromappletoorange','lopezjennylopez',
    ];
    try {
      const catList = '(' + TARGET_CATEGORIES.map((c) => '"' + c + '"').join(',') + ')';
      const allow   = '(' + FOUNDER_VETTED_ALLOWLIST.map((h) => '"' + h + '"').join(',') + ')';
      let promoted = 0;
      // (a) vetted seeds inside the category gate
      const { data: pa } = await db.from('leads_influencers')
        .update({ outreach_status: 'queued' })
        .eq('outreach_status', 'pending_review')
        .eq('discovered_via', 'modash-vetted-seed')
        .filter('category', 'in', catList)
        .select('id');
      promoted += pa?.length ?? 0;
      // (b) explicit founder allowlist (hand-picked, so no category gate needed)
      const { data: pb } = await db.from('leads_influencers')
        .update({ outreach_status: 'queued' })
        .eq('outreach_status', 'pending_review')
        .filter('ig_handle', 'in', allow)
        .select('id');
      promoted += pb?.length ?? 0;
      if (promoted) console.log(`promote: ${promoted} vetted creators pending_review -> queued (staged, NOT sent)`);
    } catch (_e) { /* best-effort; never blocks a harvest run */ }

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
    const skips = { known_handle: 0, no_handle: 0, no_contact_no_link: 0, blocked: 0, suppressed: 0, non_creator: 0, geo_unverified: 0, business: 0 };

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
        let pageText = '';
        if ((!handle || (!email && !phone)) && !isIG && siteFetches < MAX_SITEFETCH) {
          siteFetches++;
          pageText = (await fetchText(r.url)) || '';
          if (pageText) {
            if (!email) email = firstEmail(pageText);
            if (!phone) phone = firstPhone(pageText);
            if (!handle) handle = igHandle(pageText);   // creator's IG link on their linktree/site
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
        // ── QUALITY GATE at the SOURCE (SPEC-86): no fabrication, verified geo,
        //    individual-only, and NEVER sendable until vetted/promoted. ──
        const geoText = `${r.snippet} ${r.title} ${pageText}`;
        if (!cityVerified(city, geoText)) { skips.geo_unverified++; continue; }   // kills wrong-geo (Utah-for-Miami)
        if (isBusinessLike(handle, r.title)) { skips.business++; continue; }        // kills business-as-creator
        if (isBlockedContent(handle, r.title, ext, r.snippet)) { skips.blocked++; continue; } // kills med-spa/aesthetic/SHAFT leak at source
        const id = `harv:${handle.replace(/[^a-z0-9]+/gi, '').slice(0, 60).toLowerCase()}`;
        rows.push({
          id, ig_handle: handle, display_name: cleanTitle(r.title),
          category: niche.category,
          email,                                   // only a real, un-suppressed email or null
          phone: null,                             // creators are reached by IG/email — NEVER a scraped phone (no fabrication)
          external_url: ext,
          city, state: CITY_STATE[city] ?? null,   // mapped, NEVER hardcoded 'FL'
          is_business: false,
          discovered_via: tag,
          outreach_status: 'pending_review',       // NON-sendable until it passes the gate + (initial batches) human vet
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
