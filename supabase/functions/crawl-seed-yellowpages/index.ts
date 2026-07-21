// Supabase Edge Function — crawl-seed-yellowpages (server-side, off-Mac).
//
// ENUMERATES the (service_type × city) matrix across the target US metros and
// bulk-inserts `crawl_requests` rows with source='yellowpages' + the YellowPages
// search URL (in `notes`), staged status='new'. `fulfill-crawl` then drains those
// jobs, parses the YP result pages, and upserts real businesses into
// leads_services — SAME columns / same 'new' staging / same gate as the Google
// Places path (leads never auto-sent; the DATA-QUALITY gate promotes reachable
// mobile types new→queued and quarantines blocked categories).
//
// Idempotent: re-running never duplicates. Dedupe mirrors the DB partial-unique
// index crawl_requests_open_dedupe_idx (kind, lower(city), lower(service_type))
// for OPEN rows, via INSERT ... WHERE NOT EXISTS on (kind, city, service_type).
//
// BLOCKED categories are NEVER enumerated here (first safety net): massage,
// tattoo, makeup, personal chef, + SHAFT (plastic surgery, drugs, alcohol,
// tobacco, gambling, firearms, adult, nightclub/DJ). fulfill-crawl re-checks at
// parse time (second net).
//
// AUTH: service-role bearer only (cron / launcher). No cold outreach here — this
// only enqueues sourcing jobs.
// Secrets: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY.

import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4?target=deno&deno-std=0.224.0';

// ── Target metros: top US metros (city + USPS state) ─────────────────────────
// Kept as [city, state] so the YP geo_location_terms + leads_services.state map
// cleanly. ~100 metros. Extend freely — the matrix + dedupe scale automatically.
const CITIES: Array<[string, string]> = [
  ['New York', 'NY'], ['Los Angeles', 'CA'], ['Chicago', 'IL'], ['Houston', 'TX'],
  ['Phoenix', 'AZ'], ['Philadelphia', 'PA'], ['San Antonio', 'TX'], ['San Diego', 'CA'],
  ['Dallas', 'TX'], ['San Jose', 'CA'], ['Austin', 'TX'], ['Jacksonville', 'FL'],
  ['Fort Worth', 'TX'], ['Columbus', 'OH'], ['Charlotte', 'NC'], ['Indianapolis', 'IN'],
  ['San Francisco', 'CA'], ['Seattle', 'WA'], ['Denver', 'CO'], ['Washington', 'DC'],
  ['Boston', 'MA'], ['Nashville', 'TN'], ['El Paso', 'TX'], ['Detroit', 'MI'],
  ['Oklahoma City', 'OK'], ['Portland', 'OR'], ['Las Vegas', 'NV'], ['Memphis', 'TN'],
  ['Louisville', 'KY'], ['Baltimore', 'MD'], ['Milwaukee', 'WI'], ['Albuquerque', 'NM'],
  ['Tucson', 'AZ'], ['Fresno', 'CA'], ['Sacramento', 'CA'], ['Kansas City', 'MO'],
  ['Mesa', 'AZ'], ['Atlanta', 'GA'], ['Omaha', 'NE'], ['Colorado Springs', 'CO'],
  ['Raleigh', 'NC'], ['Long Beach', 'CA'], ['Virginia Beach', 'VA'], ['Miami', 'FL'],
  ['Oakland', 'CA'], ['Minneapolis', 'MN'], ['Tulsa', 'OK'], ['Bakersfield', 'CA'],
  ['Wichita', 'KS'], ['Arlington', 'TX'], ['Aurora', 'CO'], ['Tampa', 'FL'],
  ['New Orleans', 'LA'], ['Cleveland', 'OH'], ['Honolulu', 'HI'], ['Anaheim', 'CA'],
  ['Lexington', 'KY'], ['Stockton', 'CA'], ['Corpus Christi', 'TX'], ['Henderson', 'NV'],
  ['Riverside', 'CA'], ['Newark', 'NJ'], ['Saint Paul', 'MN'], ['Santa Ana', 'CA'],
  ['Cincinnati', 'OH'], ['Irvine', 'CA'], ['Orlando', 'FL'], ['Pittsburgh', 'PA'],
  ['St. Louis', 'MO'], ['Greensboro', 'NC'], ['Jersey City', 'NJ'], ['Anchorage', 'AK'],
  ['Lincoln', 'NE'], ['Plano', 'TX'], ['Durham', 'NC'], ['Buffalo', 'NY'],
  ['Chandler', 'AZ'], ['Chula Vista', 'CA'], ['Toledo', 'OH'], ['Madison', 'WI'],
  ['Gilbert', 'AZ'], ['Reno', 'NV'], ['Fort Wayne', 'IN'], ['North Las Vegas', 'NV'],
  ['St. Petersburg', 'FL'], ['Lubbock', 'TX'], ['Irving', 'TX'], ['Laredo', 'TX'],
  ['Winston-Salem', 'NC'], ['Chesapeake', 'VA'], ['Glendale', 'AZ'], ['Scottsdale', 'AZ'],
  ['Norfolk', 'VA'], ['Fremont', 'CA'], ['Garland', 'TX'], ['Boise', 'ID'],
  ['Richmond', 'VA'], ['Baton Rouge', 'LA'], ['Spokane', 'WA'], ['Salt Lake City', 'UT'],
  ['Fort Lauderdale', 'FL'], ['Charleston', 'SC'], ['Providence', 'RI'], ['Knoxville', 'TN'],
];

// ── Service types: mobile / independent / at-home providers ONLY. ────────────
// BLOCKED categories are intentionally ABSENT (massage, tattoo, makeup, personal
// chef, + SHAFT). These strings are also what the gate regex approves, so they
// grade cleanly. Kept lowercase; used verbatim in service_type + the YP query.
const SERVICE_TYPES: string[] = [
  'plumber', 'electrician', 'hvac', 'handyman', 'house cleaning', 'maid service',
  'landscaping', 'lawn care', 'tree service', 'pest control', 'mover',
  'junk removal', 'painter', 'roofing', 'flooring', 'window cleaning',
  'pressure washing', 'gutter cleaning', 'pool cleaning', 'appliance repair',
  'locksmith', 'garage door repair', 'fencing', 'drywall', 'carpet cleaning',
  'photographer', 'videographer', 'dj-free', // NOTE: NOT a real type — placeholder guarded out below
  'personal trainer', 'yoga instructor', 'pilates instructor', 'nutrition coach',
  'hair stylist', 'barber', 'nail technician', 'lash technician',
  'dog walker', 'dog grooming', 'pet sitting', 'mobile mechanic', 'auto detailing',
  'car wash', 'tutor', 'music teacher', 'bookkeeping', 'tax preparation',
  'computer repair', 'tech support', 'interior designer', 'home staging',
  'solar installer', 'window tinting', 'wedding planner', 'event planner',
];

// ── BLOCKED-category safety net (first net). Any service type or query token ──
// matching this is refused enumeration. Word-bounded where a bare token could
// false-match (e.g. "bar" inside "barber"). Mirrors the DB gate quarantine list.
const BLOCKED = new RegExp(
  '(massage|tattoo|makeup|\\bpersonal chef\\b|private chef|\\bchef\\b' +
  '|plastic surgery|cosmetic surgery|\\bsurgeon\\b' +
  '|weight ?loss|\\bpeptide|bariatric|semaglutide|ozempic|wegovy|tirzepatide|med.?spa|medi.?spa|med.?aesthetic|medical aesthetic|botox|\\bfiller|injectable|dermatolog|liposuction|\\bbbl\\b|iv drip|iv therapy|hormone (replacement|therapy)|\\bhrt\\b' +
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

const YP_BASE = 'https://www.yellowpages.com/search';
function ypUrl(serviceType: string, city: string, state: string, page = 1): string {
  const terms = encodeURIComponent(serviceType);
  const geo = encodeURIComponent(`${city}, ${state}`);
  const p = page > 1 ? `&page=${page}` : '';
  return `${YP_BASE}?search_terms=${terms}&geo_location_terms=${geo}${p}`;
}

const TARGET_PER_JOB = 30;   // leads to source per (type × city); YP page = ~30 results
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

    // Build the full matrix, dropping any blocked type up front (safety net 1).
    const types = SERVICE_TYPES.filter((t) => !isBlocked(t) && t !== 'dj-free');
    const rows: Array<Record<string, unknown>> = [];
    const nowIso = new Date().toISOString();
    for (const [city, state] of CITIES) {
      for (const type of types) {
        // paranoia: also skip if the composed query trips the blocked net.
        if (isBlocked(`${type} ${city}`)) continue;
        rows.push({
          kind: 'services',
          city, state,
          service_type: type,
          target_count: TARGET_PER_JOB,
          status: 'new',
          source: 'yellowpages',
          notes: ypUrl(type, city, state, 1),
          created_at: nowIso,
          updated_at: nowIso,
        });
      }
    }

    // Idempotent insert: skip any (kind, city, service_type) that already has an
    // OPEN row (new/crawling) — matching crawl_requests_open_dedupe_idx. We can't
    // express NOT EXISTS through the REST client, so we pre-filter against the
    // existing OPEN set, then insert the remainder in batches.
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
      // A unique-violation (23505) means the partial-unique index caught a row
      // that slipped in between our SELECT and this INSERT (concurrent run /
      // on-demand enqueue). Postgres aborts the WHOLE multi-row INSERT on the
      // first conflict, so fall back to per-row inserts and skip only the
      // genuine duplicates — every other row still lands. Idempotent by design.
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

    // BACKBONE: unified agent_runs ledger. raw_found = new candidates to enqueue,
    // rows_written = rows actually inserted. When candidates=0 (matrix already
    // fully open) that is a legitimate no-op, NOT a silent collision (the watchdog
    // only flags raw_found>0 AND rows_written=0), so mark 'ok' unless we truly had
    // candidates but wrote none.
    await logAgentRun(db, 'crawl-seed-yellowpages', {
      started, raw_found: toInsert.length, rows_written: inserted,
      status: (toInsert.length > 0 && inserted === 0) ? 'empty' : 'ok', error: null,
      meta: { matrix: CITIES.length * types.length, already_open: seen.size, skipped_race_dupes: skipped },
    });
    return json({
      cities: CITIES.length,
      service_types: types.length,
      matrix: CITIES.length * types.length,
      already_open: seen.size,
      candidates: toInsert.length,
      inserted,
      skipped_race_dupes: skipped,
      source: 'yellowpages',
    });
  } catch (e) {
    await logAgentRun(dbRef, 'crawl-seed-yellowpages', {
      started, raw_found: null, rows_written: 0,
      status: 'error', error: e instanceof Error ? e.message : String(e),
    });
    return json({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
});

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
