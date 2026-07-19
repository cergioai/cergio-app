// Supabase Edge Function — crawl-seed-osm (server-side, off-Mac).
//
// WHY THIS EXISTS (free-first primary source, 2026-07-15 — SPEC-72):
//   Google Places is a paid API and is now billing-blocked, and YellowPages is
//   permanently 403-blocked from datacenter IPs. The CONSTITUTION is free-first,
//   so the primary services source is OpenStreetMap via the Overpass API — keyless,
//   no billing account, no card, no quota approval, and it cannot be switched off by
//   an account state. Coverage is thinner than Google for mobile providers, but it
//   is non-zero, always carries lat/lon (immediately visible to services_near), and
//   is 100% free.
//
//   This seeder enqueues the (service_type × DMA-city) matrix with source='osm' so
//   fulfill-crawl drains it via Overpass (fulfillOverpass) into leads_services with
//   data_source='osm'. It mirrors crawl-seed-google-places EXACTLY (same matrix,
//   same BLOCKED safety net, same idempotent dedupe against OPEN rows) — only
//   `source` differs. No cold outreach here; leads stage at outreach_status='new'.
//
// Idempotent: re-running never duplicates (dedupe mirrors the DB partial-unique
// index on OPEN rows — crawl_requests_open_dedupe_idx on (kind, city, service_type)).
// AUTH: service-role bearer only (cron / launcher).
// Secrets: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY.
//   (fulfill-crawl needs NOTHING extra to drain OSM — Overpass is keyless.)

import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4?target=deno&deno-std=0.224.0';

// ── FOUNDER-FROZEN TARGETS (2026-07-14): Miami (home) + the TOP 10 US DMAs by
// households. NOT "top cities by population" — DMA reach is what matters. ──
const CITIES: Array<[string, string]> = [
  ['Miami', 'FL'],            // home market
  ['New York', 'NY'],         // DMA 1
  ['Manhattan', 'NY'],        // NYC borough — real OSM admin boundary
  ['Brooklyn', 'NY'],         // NYC borough
  ['Queens', 'NY'],           // NYC borough
  ['Bronx', 'NY'],            // NYC borough
  ['Staten Island', 'NY'],    // NYC borough
  ['Los Angeles', 'CA'],      // DMA 2
  ['Chicago', 'IL'],          // DMA 3
  ['Dallas', 'TX'],           // DMA 4 (Dallas–Fort Worth)
  ['Philadelphia', 'PA'],     // DMA 5
  ['Houston', 'TX'],          // DMA 6
  ['Atlanta', 'GA'],          // DMA 7
  ['Washington', 'DC'],       // DMA 8
  ['Boston', 'MA'],           // DMA 9
  ['San Francisco', 'CA'],    // DMA 10
];

// ── Service types: mobile / independent / at-home providers ONLY. These keys
// MUST match fulfill-crawl's OSM_TAGS keys so every enqueued job resolves a real
// Overpass tag selector (unmapped types fall back to a name search, never zero). ──
const SERVICE_TYPES: string[] = [
  'plumber', 'electrician', 'hvac', 'handyman', 'house cleaning', 'maid service',
  'landscaping', 'lawn care', 'tree service', 'pest control', 'mover',
  'junk removal', 'painter', 'roofing', 'flooring', 'window cleaning',
  'pressure washing', 'gutter cleaning', 'pool cleaning', 'appliance repair',
  'locksmith', 'garage door repair', 'fencing', 'drywall', 'carpet cleaning',
  'photographer', 'videographer',
  'personal trainer', 'yoga instructor', 'pilates instructor', 'nutrition coach',
  'hair stylist', 'barber', 'nail technician', 'lash technician',
  'dog walker', 'dog grooming', 'pet sitting', 'mobile mechanic', 'auto detailing',
  'car wash', 'tutor', 'music teacher', 'bookkeeping', 'tax preparation',
  'computer repair', 'tech support', 'interior designer', 'home staging',
  'solar installer', 'window tinting', 'wedding planner', 'event planner',
];

// ── BLOCKED-category safety net (first net) — mirrors the DB gate / OSM parse. ──
const BLOCKED = new RegExp(
  '(massage|tattoo|makeup|\\bpersonal chef\\b|private chef|\\bchef\\b' +
  '|plastic surgery|cosmetic surgery|\\bsurgeon\\b' +
  '|drug|pharmac|cannabis|dispensary|marijuana' +
  '|alcohol|liquor|\\bwine\\b|brewery|winery|distillery|\\bbar\\b|cocktail|\\bpub\\b' +
  '|tobacco|smoke shop|\\bvape\\b|\\bcigar\\b' +
  '|casino|gambling|\\bbetting\\b' +
  '|firearm|\\bgun\\b|\\bammo\\b' +
  '|\\badult\\b|\\bescort\\b|strip club' +
  '|nightclub|night club|\\bdj\\b|disc jockey)',
  'i',
);
function isBlocked(s: string): boolean { return BLOCKED.test(s); }

const TARGET_PER_JOB = 20;   // fulfillOverpass clamps to <= OSM_MAX_RESULTS (50)
const INSERT_BATCH   = 250;  // rows per insert round-trip

serve(async (req: Request) => {
  if (req.method !== 'POST' && req.method !== 'GET') return new Response('Method not allowed', { status: 405 });
  const started = Date.now();
  let dbRef: any = null;
  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const serviceKey  = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const auth = (req.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '').trim();
    if (!auth || auth !== serviceKey) return json({ error: 'Unauthorized' }, 401);
    const db = createClient(supabaseUrl, serviceKey);
    dbRef = db;

    const types = SERVICE_TYPES.filter((t) => !isBlocked(t));
    const rows: Array<Record<string, unknown>> = [];
    const nowIso = new Date().toISOString();
    for (const [city, state] of CITIES) {
      for (const type of types) {
        if (isBlocked(`${type} ${city}`)) continue;
        rows.push({
          kind: 'services',
          city, state,
          service_type: type,
          target_count: TARGET_PER_JOB,
          status: 'new',
          source: 'osm', // ← the FREE, KEYLESS drain path (Overpass; no billing)
          created_at: nowIso,
          updated_at: nowIso,
        });
      }
    }

    // Idempotent insert: skip any (kind, city, service_type) with an OPEN row —
    // matching crawl_requests_open_dedupe_idx. Pre-filter, then batch the rest.
    const { data: existing, error: exErr } = await db
      .from('crawl_requests')
      .select('city, service_type')
      .eq('kind', 'services')
      .in('status', ['new', 'crawling']);
    if (exErr) throw exErr;
    const seen = new Set<string>();
    for (const e of existing ?? []) {
      seen.add(`${(e.city ?? '').toLowerCase()}|${(e.service_type ?? '').toLowerCase()}`);
    }
    const toInsert = rows.filter((r) =>
      !seen.has(`${String(r.city).toLowerCase()}|${String(r.service_type).toLowerCase()}`));

    let inserted = 0;
    let skipped = 0;
    for (let i = 0; i < toInsert.length; i += INSERT_BATCH) {
      const batch = toInsert.slice(i, i + INSERT_BATCH);
      const { error: insErr } = await db.from('crawl_requests').insert(batch);
      if (!insErr) { inserted += batch.length; continue; }
      if ((insErr as any)?.code === '23505') {
        for (const r of batch) {
          const { error: rowErr } = await db.from('crawl_requests').insert(r);
          if (!rowErr) inserted++;
          else if ((rowErr as any)?.code === '23505') skipped++;
          else throw rowErr;
        }
      } else {
        throw insErr;
      }
    }

    await logAgentRun(db, 'crawl-seed-osm', {
      started, raw_found: toInsert.length, rows_written: inserted,
      status: (toInsert.length > 0 && inserted === 0) ? 'empty' : 'ok', error: null,
      meta: { matrix: CITIES.length * types.length, already_open: seen.size, skipped_race_dupes: skipped, source: 'osm' },
    });
    return json({
      cities: CITIES.length,
      service_types: types.length,
      matrix: CITIES.length * types.length,
      already_open: seen.size,
      candidates: toInsert.length,
      inserted,
      skipped_race_dupes: skipped,
      source: 'osm',
    });
  } catch (e) {
    await logAgentRun(dbRef, 'crawl-seed-osm', {
      started, raw_found: null, rows_written: 0,
      status: 'error', error: serr(e),
    });
    return json({ error: serr(e) }, 500);
  }
});

// ── CANONICAL ERROR SERIALIZER — DO NOT FORK (SPEC-73) ───────────────────────
// Byte-identical to the copy in fulfill-crawl et al. Supabase/PostgREST rejects
// with a PLAIN OBJECT ({message, details, hint, code}); String(e) on it yields the
// opaque "[object Object]". Always extract a REAL message + code (+ 2 stack frames).
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

// BACKBONE helper — write ONE agent_runs row per invocation. NEVER throws.
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
  } catch (_e) { /* best-effort */ }
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}
