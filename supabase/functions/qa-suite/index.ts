// Supabase Edge Function — CONTINUOUS QA runner (cron / dashboard-callable).
//
// Runs the live, DB-observable assertions of the P1 SEARCH + P2 RESPONSES suites
// against the SEEDED test world (seed=true fixtures only — never a real row), and
// wires every result into the same ledger the Node runner (scripts/qa-live.mjs)
// uses: cergio_qa_check (findings), cergio_verify_requirement / cergio_reopen_
// requirement (requirements ledger), cergio_record_qa_run (dashboard trend), and
// an on-spec reversible coo_proposal for the one auto-fixable failure class
// (blocked categories sitting sendable). It is IDEMPOTENT and writes ONE
// agent_runs row per invocation (rows_written = assertions that passed).
//
// The Node runner additionally covers code-import assertions (taxonomy resolve);
// this edge fn covers everything observable from the database so a cron can run
// it with zero Mac. Both share the same check_names, so a pass in either resolves
// the same finding — no drift.
//
// AUTH: service-role bearer (called by cergio_call_edge from pg_cron), OR a
// caller JWT whose email is in ADMIN_EMAILS (manual dashboard trigger).
// REVERSIBLE-ONLY. Never sends a message, never moves money, never deletes a real row.

import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4?target=deno&deno-std=0.224.0';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'authorization, content-type, apikey',
};
const j = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { ...CORS, 'Content-Type': 'application/json' } });

type Assert = {
  check: string; req: string; spec: string; summary: string; pass: boolean;
  fix?: { on_spec: boolean; kind: 'sql'; payload: string | null; note: string };
};

serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  const started = Date.now();
  let db: any = null;
  try {
    const url = Deno.env.get('SUPABASE_URL')!;
    const key = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    // AUTH: service-role bearer OR an admin JWT email.
    const auth = (req.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '').trim();
    let authorized = auth && auth === key;
    if (!authorized && auth) {
      try {
        const probe = createClient(url, Deno.env.get('SUPABASE_ANON_KEY') || key);
        const { data: u } = await probe.auth.getUser(auth);
        const admins = (Deno.env.get('ADMIN_EMAILS') || 't@cergio.ai,info@cergio.ai')
          .split(',').map((e) => e.trim().toLowerCase());
        authorized = !!u?.user?.email && admins.includes(u.user.email.toLowerCase());
      } catch { /* fallthrough */ }
    }
    if (!authorized) return j({ error: 'unauthorized' }, 401);

    db = createClient(url, key);
    const suites: Record<string, Assert[]> = { search: [], responses: [] };

    // ── load seed fixtures (seed=true only) ──────────────────────────────────
    const { data: services } = await db.from('services')
      .select('id, owner_id, title, taxonomy_provider_type, lat, lng, location_text, status')
      .eq('seed', true);
    const { data: profiles } = await db.from('profiles')
      .select('id, display_name, instagram_followers').eq('seed', true);
    const svcList = services || [];
    const miamiSvc = svcList.find((s: any) => String(s.taxonomy_provider_type).toLowerCase() === 'plumber');
    const austinSvc = svcList.find((s: any) => String(s.taxonomy_provider_type).toLowerCase() === 'house cleaner');

    // ── SUITE 1: SEARCH (DB-observable) ──────────────────────────────────────
    suites.search.push({
      check: 'qa_search_geocode_holds', req: 'p1-search-geocode-holds', spec: 'SPEC/#14',
      summary: 'Seeded services carry non-null lat/lng (geocode holds → visible in services_near).',
      pass: !!miamiSvc && miamiSvc.lat != null && miamiSvc.lng != null &&
            !!austinSvc && austinSvc.lat != null && austinSvc.lng != null,
    });
    suites.search.push({
      check: 'qa_search_address_persists', req: 'p1-search-address-persists', spec: 'SPEC-2/SPEC-19',
      summary: 'A verified service address persists — lat/lng not reverted to null.',
      pass: !!miamiSvc && miamiSvc.status === 'listed' && miamiSvc.lat != null,
    });

    // services_near — Miami radius
    const { data: nearMia } = await db.rpc('services_near',
      { near_lat: 25.7617, near_lng: -80.1918, radius_miles: 25, category_match: null });
    const miaIds = new Set((nearMia || []).map((r: any) => r.id));
    suites.search.push({
      check: 'qa_search_miami_live', req: 'p1-search-miami-live', spec: '#14',
      summary: 'A Miami services_near search returns the live seeded Miami service.',
      pass: miamiSvc ? miaIds.has(miamiSvc.id) : false,
    });
    suites.search.push({
      check: 'qa_search_geo_strict_no_spill', req: 'p1-search-miami-live', spec: '#6',
      summary: 'Geo is strict: an out-of-city service does not spill into a Miami-radius search.',
      pass: austinSvc ? !miaIds.has(austinSvc.id) : true,
    });

    // services_near — Austin radius (out-of-Miami)
    const { data: nearAtx } = await db.rpc('services_near',
      { near_lat: 30.2672, near_lng: -97.7431, radius_miles: 25, category_match: null });
    const atxIds = new Set((nearAtx || []).map((r: any) => r.id));
    suites.search.push({
      check: 'qa_search_outofmiami_live', req: 'p1-search-outofmiami-live', spec: 'plan §1',
      summary: 'An out-of-Miami (Austin) search returns the live seeded Austin service (multi-city).',
      pass: austinSvc ? atxIds.has(austinSvc.id) : false,
    });

    // free offering exists → no false paid-fallback
    let hasFree = false;
    if (miamiSvc) {
      const { data: offs } = await db.from('offerings').select('id')
        .eq('service_id', miamiSvc.id).eq('price_cents', 0);
      hasFree = (offs || []).length > 0;
    }
    suites.search.push({
      check: 'qa_search_no_false_paid_fallback', req: 'p1-search-no-false-paid', spec: 'SPEC-15',
      summary: 'A free ($0) offering exists so a free search returns hits (no false "showing paid options").',
      pass: hasFree,
    });

    // blocked categories not sendable in leads_services
    const { data: blocked } = await db.from('leads_services').select('id')
      .eq('outreach_status', 'queued')
      .or('service_type.ilike.*massage*,service_type.ilike.*tattoo*,service_type.ilike.*makeup*,service_type.ilike.*chef*');
    const blockedN = (blocked || []).length;
    suites.search.push({
      check: 'qa_search_blocked_never_surface', req: 'p1-search-blocked-never-surface', spec: 'blocked-cats',
      summary: 'Blocked categories (massage/tattoo/makeup/chef + SHAFT) never sit sendable in leads_services.',
      pass: blockedN === 0,
      fix: blockedN > 0 ? {
        on_spec: true, kind: 'sql',
        payload: "update leads_services set outreach_status='do_not_contact' where outreach_status='queued' and lower(coalesce(service_type,'')||' '||coalesce(name,'')) ~ '(massage|tattoo|makeup|\\ymua\\y|personal chef|private chef|\\bchef\\b)'",
        note: 'Quarantine blocked categories out of the sendable queue.',
      } : undefined,
    });

    // ── SUITE 2: RESPONSES & NOTIFICATIONS (DB-observable) ───────────────────
    // The edge fn asserts the seeded journey ROWS exist + are shaped per spec.
    // The full write-journey (create request → accept-with-time → notify) is
    // exercised by the seed runner + the Node runner (which signs in as the seed
    // users); the edge fn verifies the resulting state is spec-correct.
    const connector = (profiles || []).find((p: any) => Number(p.instagram_followers) >= 300);

    // distinct tables exist + seeded
    const { data: seedReqs } = await db.from('requests').select('id, provider_type').eq('seed', true).limit(1);
    const { data: seedBookings } = await db.from('bookings')
      .select('id, status, scheduled_at, schedule_confirmed_at, created_at, is_free_for_rainmaker')
      .eq('seed', true)
      .order('created_at', { ascending: false });
    suites.responses.push({
      check: 'qa_resp_paths_distinct', req: 'p2-paths-distinct', spec: 'SPEC-48b',
      summary: 'Connector-request rows (requests) and direct bookings (bookings) are distinct tables, both seedable.',
      pass: !!connector && Array.isArray(seedReqs) && Array.isArray(seedBookings),
    });

    // a confirmed booking exists (provider accept-with-time transition landed)
    const confirmed = (seedBookings || []).find((b: any) => b.status === 'confirmed');
    suites.responses.push({
      check: 'qa_resp_accept_confirmed_booking', req: 'p2-requester-confirm-provider-accept', spec: 'SPEC-47h',
      summary: 'A CONFIRMED seed booking exists (provider accept-with-time transition landed).',
      pass: !!confirmed,
    });

    // ── scheduled vs instant branch (SPEC-47) ────────────────────────────────
    // THE TEST WAS WRONG, NOT THE CODE (Forensic Auditor 2026-07-13).
    // The old assertion compared a PERSISTED fixture's scheduled_at to Date.now():
    //   scheduled_at > now + 12h
    // The fixture is written ONCE (qa-live.mjs books via accept_request_with_time at
    // now+3d and tags the row seed=true). It is never refreshed by this cron. So the
    // booking was correctly future-dated WHEN WRITTEN, then simply aged: three days
    // later its scheduled_at is in the past and the assertion flipped red and STAYED
    // red — a clock, not a regression. Meanwhile `accept_request_with_time` provably
    // honors the caller's time (`coalesce(p_scheduled_at, now() + interval '1 day')`,
    // migration 20260616020000) and stamps schedule_confirmed_at.
    // SPEC-47.1 is a WRITE-TIME invariant — "the user confirms day/time; no silent
    // +24h placeholder" — so assert it relative to the row's OWN created_at, which is
    // time-invariant and actually catches the regression it is meant to catch:
    //   • scheduled_at is materially later than created_at (a chosen future time,
    //     not an instant "now" placeholder), AND
    //   • schedule_confirmed_at is stamped (explicitly confirmed, not auto-timed).
    const bookedAt = confirmed ? new Date(confirmed.created_at || confirmed.scheduled_at).getTime() : 0;
    const schedAt  = confirmed ? new Date(confirmed.scheduled_at).getTime() : 0;
    const ageDays  = confirmed ? Math.floor((Date.now() - bookedAt) / 864e5) : 0;
    suites.responses.push({
      check: 'qa_resp_scheduled_branch', req: 'p2-instant-vs-scheduled', spec: 'SPEC-47',
      summary: 'Scheduled bookings honor the CHOSEN time at write: scheduled_at > created_at + 12h and ' +
        `schedule_confirmed_at is stamped — not an instant/auto placeholder (fixture age ${ageDays}d).`,
      pass: !!confirmed && !!confirmed.schedule_confirmed_at &&
            schedAt > bookedAt + 12 * 3600 * 1000,
    });

    // notify actually SENDS: a seeded notifications row with a deep_link exists
    const { data: notifs } = await db.from('notifications')
      .select('id, data').eq('seed', true).limit(5);
    const sent = (notifs || []).some((n: any) => n?.data?.deep_link);
    suites.responses.push({
      check: 'qa_resp_notify_actually_sends', req: 'p2-notify-actually-sends', spec: 'SPEC-55/56',
      summary: 'Notify actually SENDS: a notifications row (with deep_link) is created, not merely queued.',
      pass: sent,
    });

    // ── WIRE THE LEDGER (findings + requirements + proposals + suite-run) ─────
    let passedTotal = 0, failedTotal = 0;
    for (const [suiteName, asserts] of Object.entries(suites)) {
      const passed = asserts.filter((a) => a.pass).length;
      const failed = asserts.length - passed;
      passedTotal += passed; failedTotal += failed;

      for (const a of asserts) {
        // finding: open on fail (count=1), resolve on pass (count=0)
        await db.rpc('cergio_qa_check', {
          p_area: 'qa', p_check: a.check, p_sev: 'high',
          p_count: a.pass ? 0 : 1,
          p_detail: `[${suiteName}] ${a.summary} (spec ${a.spec})`,
        });
        if (a.pass) {
          await db.rpc('cergio_verify_requirement', {
            p_id: a.req,
            p_evidence: `${a.check} PASS @ ${new Date().toISOString().slice(0, 16)} — ${a.summary}`,
          });
        } else {
          await db.rpc('cergio_reopen_requirement', { p_id: a.req, p_reason: a.check });
          if (a.fix?.on_spec && a.fix.kind === 'sql' && a.fix.payload) {
            await db.from('coo_proposals').insert({
              run_date: new Date().toISOString().slice(0, 10), rank: 1, division: 'qa',
              title: `Auto-fix: ${a.check}`, detail: `${a.summary} — ${a.fix.note}`.slice(0, 500),
              expected_lift: 'restores a failing QA journey', effort: 'auto', status: 'pending',
              on_spec: true, action_kind: 'sql', action_payload: a.fix.payload, requires_approval: false,
            });
          }
        }
      }
      await db.rpc('cergio_record_qa_run', {
        p_suite: suiteName, p_passed: passed, p_failed: failed, p_total: asserts.length,
        p_ms: Date.now() - started,
        p_detail: JSON.stringify(asserts.map((a) => ({ check: a.check, pass: a.pass }))),
      });
    }

    // agent_runs backbone row (rows_written = assertions passed).
    try {
      await db.from('agent_runs').insert({
        agent: 'qa-suite', started_at: new Date(started).toISOString(), finished_at: new Date().toISOString(),
        raw_found: passedTotal + failedTotal, rows_written: passedTotal,
        status: failedTotal > 0 ? 'error' : (passedTotal === 0 ? 'empty' : 'ok'),
        error: failedTotal > 0 ? `${failedTotal} QA assertion(s) failing` : null,
        meta: { passed: passedTotal, failed: failedTotal },
      });
    } catch (_e) { /* best-effort */ }

    return j({
      ok: true, passed: passedTotal, failed: failedTotal,
      suites: Object.fromEntries(Object.entries(suites).map(([n, a]) => [n, {
        passed: a.filter((x) => x.pass).length, failed: a.filter((x) => !x.pass).length,
      }])),
      results: suites, ms: Date.now() - started,
    });
  } catch (e) {
    const msg = serr(e);
    try {
      await db?.from('agent_runs').insert({
        agent: 'qa-suite', started_at: new Date(started).toISOString(), finished_at: new Date().toISOString(),
        raw_found: null, rows_written: 0, status: 'error', error: msg.slice(0, 1000),
      });
    } catch (_e) { /* */ }
    return j({ error: msg, ms: Date.now() - started }, 500);
  }
});

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
