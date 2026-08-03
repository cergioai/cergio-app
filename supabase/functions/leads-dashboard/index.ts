// Supabase Edge Function — leads dashboard (SPEC-90). Admin-gated live data view:
// counts by SOURCE / city / status / entity + growth + filtered rows, reading past
// RLS server-side (the reason cergio.ai/ops/data showed "No rows" before).
// AUTH: caller JWT email must be in the admin allowlist. Mirrors admin-crawl-status.
import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4?target=deno&deno-std=0.224.0';
import { growthDb } from '../_shared/growthDb.ts';
import { AUDIT_CAP_SOURCES, DMAS, DMA_STATE_SPELLINGS, auditFreshSince, resolveDma, sourceAuditCap } from '../_shared/opsPayload.ts';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const DEFAULT_ADMINS = ['t@cergio.ai', 'info@cergio.ai', 'tarik.sansal2@gmail.com', 'tarik@cergio.ai', 'tariksansal@gmail.com'];  // founder's signed-in emails (Forbidden fix 2026-07-29)
const SVC_SOURCES = ['yelp', 'google_local', 'google_lsa', 'google_sponsored', 'craigslist', 'yellowpages', 'osm', 'google_places'];
// SPEC-221 (founder, 2026-08-02): "remove the creator marketplace as a source.. and add
// the IG service as a source (duplicate it as a services and creator source)".
// ig_services is DUAL-CLASS: one crawl writes a service row AND a creator row for the same
// person. It is now the only creator source. ig-creator-marketplace is REMOVED, not parked
// — it never produced a row and depended on a Meta permission we do not have, and a source
// that can never run is noise on every report it appears in.
// SPEC-230 (founder, 2026-08-02): "we're supposed to have 2 (IG services and the other IG
// local creator search)". They are:
//   1. ig-scraper-user-search — Apify Instagram user search, written by the DUAL-CLASS
//      ig_services crawl: one person yields a service row AND a creator row.
//   2. se:web-harvest        — creator-harvest, FREE keyless web search (DuckDuckGo HTML)
//      for local on-values creators, with contact taken from their own link-in-bio. Not
//      Meta property, no key, no Mac.
// ig-creator-marketplace was the Meta first-party path and is removed: it never produced a
// row and needs a permission we do not have.
//
// se:web-harvest is stamped PER RUN DAY (se:web-harvest-2026-07-28, …), so it must be
// matched by PREFIX. An eq() on the bare name once reported 0 beside a real total of 4,211.
const CRE_SOURCES = ['ig-scraper-user-search', 'se:web-harvest'];
const isPrefixSource = (s: string) => s.startsWith('se:');
function json(b: unknown, s = 200) { return new Response(JSON.stringify(b), { status: s, headers: { ...cors, 'Content-Type': 'application/json' } }); }

serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  try {
    const url = Deno.env.get('SUPABASE_URL')!;
    const anon = Deno.env.get('SUPABASE_ANON_KEY')!;
    const svc = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) return json({ error: 'Not signed in' }, 401);
    const asUser = createClient(url, anon, { global: { headers: { Authorization: authHeader } } });
    const { data: u } = await asUser.auth.getUser();
    const email = (u?.user?.email || '').toLowerCase();
    const admins = (Deno.env.get('ADMIN_EMAILS') || DEFAULT_ADMINS.join(',')).split(',').map(s => s.trim().toLowerCase());
    if (!email || !admins.includes(email)) return json({ error: 'Forbidden' }, 403);

    // SPEC-203 — THE DASHBOARD WAS READING THE WRONG DATABASE.
    // Auth lives in the PRODUCT project; every lead lives in the GROWTH project. This
    // line used to be createClient(url, svc) — the product client — so the dashboard
    // queried tables that hold almost nothing and rendered as "truncated". Auth stays
    // on product (above); leads now come from growth.
    const db = growthDb();
    const body = req.method === 'POST' ? await req.json().catch(() => ({})) : {};
    // SPEC-210 — EVERY dataset is downloadable, not just the two lead tables. The
    // founder asked for "all available on dashboard to download live"; the crawl queue
    // is where spend and parking actually live (cost_usd sits on crawl_requests), so a
    // dashboard without it cannot answer what a source cost or why it stopped.
    const DATASETS: Record<string, { table: string; srcCol: string; emailCol: string; label: string }> = {
      services:  { table: 'leads_services',     srcCol: 'data_source',     emailCol: 'owner_email', label: 'Service leads' },
      creators:  { table: 'leads_influencers',  srcCol: 'discovered_via',  emailCol: 'email',       label: 'Creators' },
      crawls:    { table: 'crawl_requests',     srcCol: 'source',          emailCol: '',            label: 'Crawl queue + spend' },
      runs:      { table: 'agent_runs',         srcCol: 'agent',           emailCol: '',            label: 'Agent runs' },
    };
    const audience = DATASETS[body.audience] ? body.audience : 'services';
    const DS = DATASETS[audience];
    const table = DS.table;
    const isLeadTable = audience === 'services' || audience === 'creators';
    // SPEC-224 — METRO and LOCALITY are different columns and must be different filters.
    // `state` is the metro (NY = NYC, FL = Miami); `city` is the neighbourhood (Manhattan,
    // Brooklyn, Wynwood). Conflating them is what made the Miami filter appear to vanish:
    // one control was trying to mean both.
    // SPEC-244: the metro filter is a Nielsen DMA code ('501' New York, '528'
    // Miami-Ft. Lauderdale). Legacy 'NY'/'FL' values from older screens resolve to the
    // DMA they meant. Matching uses the DMA's full spelling set — a single state
    // equality was the state-as-DMA proxy the founder corrected (it also missed every
    // row stored under another spelling, the SPEC-235 defect).
    const dmaFilter: string | null = resolveDma(body.city) || null;
    const dmaSpellings: string[] | null = dmaFilter ? (DMA_STATE_SPELLINGS[dmaFilter] || null) : null;
    const locality: string | null = body.locality || null;    // 'Brooklyn', 'Wynwood', …
    const typeFilter: string | null = body.serviceType || null;
    const categoryFilter: string | null = body.category || null;
    const sinceHours = Number(body.sinceHours || 0);
    // The cap was 10,000 while the screen now offers 25,000. A control that silently returns
    // less than it promises is the same defect as the capped row count that read as a small
    // market, so the ceiling moves with it.
    const limit = Math.min(Number(body.limit || 1000), 25000);
    const sourceFilter: string | null = body.source || null;
    const stateCol = 'state';
    // Creator rows label their origin in discovered_via; service rows use data_source.
    const srcCol = DS.srcCol;
    // SPEC-219 — DECLARED HERE, ABOVE EVERY USE. This was declared 7 lines BELOW its first
    // use on line 102, which is the temporal dead zone: a const is hoisted but unusable
    // until its declaration runs, so the function threw ReferenceError on every call and
    // /ops/data returned "Edge Function returned a non-2xx status code".
    //
    // THIS IS THE FOURTH OUTAGE OF EXACTLY THIS SHAPE on this project: the blank homepage
    // (mode used before binding), the white /auth (useEffect above const returnTo), every
    // crawled row discarded (flushBuf referencing a handler-scoped gdb), and now this.
    // Every one passed the build. Every one passed the gate suite.
    const emailCol = DS.emailCol;

    const count = async (q: (b: any) => any) => {
      const { count } = await q(db.from(table).select('id', { count: 'exact', head: true }));
      return count ?? 0;
    };
    // Sources are DERIVED from the data, not read off a hardcoded list. The old list
    // still named 'modash-vetted-seed' — a source we abandoned — while every real source
    // we added since fell into "(other/unlabeled)". A dashboard whose source list can go
    // stale silently is how a dead source keeps looking alive.
    const { data: srcRows } = await db.from(table).select(srcCol).limit(50000);
    const seen = new Set<string>();
    for (const r of (srcRows || [])) {
      let v = String((r as any)[srcCol] ?? '').trim();
      if (!v) continue;
      // Collapse per-run-day tags to their algorithm, or one source reads as forty.
      const m = v.match(/^(se:[a-z-]+)/);
      if (m) v = m[1];
      seen.add(v);
    }
    const known = audience === 'creators' ? CRE_SOURCES : SVC_SOURCES;
    for (const k of known) seen.add(k);
    const sources = [...seen].sort();

    // by source
    const bySource: Record<string, number> = {};
    await Promise.all(sources.map(async (src) => {
      bySource[src] = await count((b) => (isPrefixSource(src) ? b.like(srcCol, `${src}%`) : b.eq(srcCol, src)));
    }));
    bySource['(other/unlabeled)'] = Math.max(0, (await count((b) => b)) - Object.values(bySource).reduce((a, c) => a + c, 0));

    // by DMA (SPEC-244: Nielsen names, full spelling sets — NJ/CT rows inside the New
    // York DMA count toward it) and by status
    const byCity: Record<string, number> = {};
    if (isLeadTable) {
      for (const [code, d] of Object.entries(DMAS)) {
        byCity[`${d.name} (DMA ${code})`] = await count((b) => b.in(stateCol, DMA_STATE_SPELLINGS[code] || []));
      }
    }
    const statuses = isLeadTable
      ? ['new', 'pending_review', 'queued', 'opted_in', 'do_not_contact']
      : ['new', 'crawling', 'delivered', 'failed', 'parked'];
    const statusCol = isLeadTable ? 'outreach_status' : 'status';
    const byStatus: Record<string, number> = {};
    await Promise.all(statuses.map(async (st) => { byStatus[st] = await count((b) => b.eq(statusCol, st)); }));

    // growth: rows fetched in last 1/7/14 days
    const since = (d: number) => new Date(Date.now() - d * 864e5).toISOString();
    const tsCol = isLeadTable ? 'fetched_at' : 'created_at';
    const growth = {
      last1d: await count((b) => b.gte(tsCol, since(1))),
      last7d: await count((b) => b.gte(tsCol, since(7))),
      last14d: await count((b) => b.gte(tsCol, since(14))),
    };

    // contactable totals
    const withPhone = isLeadTable ? await count((b) => b.not('phone', 'is', null)) : 0;
    const withEmail = isLeadTable ? await count((b) => b.not(emailCol, 'is', null)) : 0;
    const total = await count((b) => b);

    // SPEC-192 is a HARD spec: a lead without a phone or an email is not a lead. A
    // platform-wide contactable total hides which source is producing the junk, so it is
    // broken out per source — that is the number that should decide where a dollar goes.
    const contactBySource: Record<string, { total: number; contactable: number; pct: number }> = {};
    if (isLeadTable) await Promise.all(sources.map(async (src) => {
      const m = (b: any) => (isPrefixSource(src) ? b.like(srcCol, `${src}%`) : b.eq(srcCol, src));
      const t = await count((b) => m(b));
      const c = await count((b) => m(b).or(`phone.not.is.null,${emailCol}.not.is.null`));
      contactBySource[src] = { total: t, contactable: c, pct: t ? Math.round((c / t) * 100) : 0 };
    }));

    // filtered rows for the table/download
    const ROW_CAP = limit;
    // The facet lists come from the data, so an option that cannot return a row is never
    // offered. Scoped to the CURRENT metro, because the neighbourhoods of NYC are not
    // choices when the metro is Miami.
    const facet = async (col: string) => {
      let q2 = db.from(table).select(col).limit(20000);
      if (dmaSpellings) q2 = q2.in(stateCol, dmaSpellings);
      const { data } = await q2;
      const set = new Set<string>();
      for (const r of (data || [])) { const v = String((r as any)[col] ?? '').trim(); if (v) set.add(v); }
      return [...set].sort();
    };
    const localities = isLeadTable || audience === 'crawls' ? await facet('city') : [];
    const serviceTypes = audience === 'services' || audience === 'crawls' ? await facet('service_type') : [];
    const categories = audience === 'creators' ? await facet('category') : [];

    let rq = db.from(table).select('*').limit(ROW_CAP);
    if (locality) rq = rq.eq('city', locality);
    if (typeFilter) rq = rq.eq('service_type', typeFilter);
    if (categoryFilter) rq = rq.eq('category', categoryFilter);
    if (sinceHours > 0) rq = rq.gte(tsCol, new Date(Date.now() - sinceHours * 36e5).toISOString());
    rq = rq.order(tsCol, { ascending: false });
    if (dmaSpellings) rq = rq.in(stateCol, dmaSpellings);
    if (sourceFilter) rq = isPrefixSource(sourceFilter) ? rq.like(srcCol, `${sourceFilter}%`) : rq.eq(srcCol, sourceFilter);
    if (body.status) rq = rq.eq(statusCol, body.status);
    // "Contactable only" is the 40% bar made actionable: it exports the rows we can
    // actually reach, so a download is a working list rather than a row count.
    if (body.contactableOnly && isLeadTable) rq = rq.or(`phone.not.is.null,${emailCol}.not.is.null`);
    const { data: rows } = await rq;
    // The TRUE size of this filter, so the screen can say "showing 10,000 of 41,203"
    // instead of quietly implying the cap is the whole set. A silent cap reads as a
    // small market.
    let cq = db.from(table).select('id', { count: 'exact', head: true });
    if (locality) cq = cq.eq('city', locality);
    if (typeFilter) cq = cq.eq('service_type', typeFilter);
    if (categoryFilter) cq = cq.eq('category', categoryFilter);
    if (sinceHours > 0) cq = cq.gte(tsCol, new Date(Date.now() - sinceHours * 36e5).toISOString());
    if (dmaSpellings) cq = cq.in(stateCol, dmaSpellings);
    if (sourceFilter) cq = isPrefixSource(sourceFilter) ? cq.like(srcCol, `${sourceFilter}%`) : cq.eq(srcCol, sourceFilter);
    if (body.status) cq = cq.eq(statusCol, body.status);
    if (body.contactableOnly && isLeadTable) cq = cq.or(`phone.not.is.null,${emailCol}.not.is.null`);
    const { count: filteredTotal } = await cq;

    // ── SPEC-249 · THE PER-SOURCE AUDIT BOARD ────────────────────────────────────────
    // Founder, 2026-08-03, verbatim: "need to see a clear per source status filetrable
    // by last 100 500 etc and time... filetrable by creators or services and per
    // service type... i can't see this right now.. so i don't know what's working and
    // what's not and how to download" + "per city and per location" + "with contactable
    // % (with drill down to (email%) % phone) % both".
    // One row per source. STATE is absolute (fresh-100 progress vs the committed line —
    // never affected by filters, or a time filter would read as a source dying). The
    // COUNTS obey every filter on the screen (DMA, location, type/category, time).
    // Queries run SEQUENTIALLY and every error is SURFACED on the row verbatim — the
    // ops console's swallowed `count ?? 0` is how the founder saw confident zeros
    // beside real data, and this board exists to answer "what's working", so a count
    // that failed must say FAILED, never 0.
    type BoardRow = {
      source: string; state: string; state_detail: string;
      fresh: number | null; fresh_target: number;
      filtered: number | null; phone_pct: number | null; email_pct: number | null; both_pct: number | null;
      queue_new: number | null; queue_parked: number | null; errors: string[];
    };
    const board: BoardRow[] = [];
    // `db` IS the growth client here (SPEC-203) — aliased so gate #166 can tell a
    // growth read from a product read by name alone.
    const gdb = db;
    if (isLeadTable) {
      const FRESH = auditFreshSince(Deno.env.get('AUDIT_FRESH_SINCE'));
      const CAP = sourceAuditCap(Deno.env.get('SOURCE_AUDIT_CAP'));
      const CREATOR_TARGET = Number(Deno.env.get('CREATOR_TARGET') || 100);
      const boardSources = audience === 'creators'
        ? CRE_SOURCES
        : ['osm', 'craigslist', 'yellowpages_apify', 'google_lsa', 'gmaps_apify', 'ig_services', 'yelp'];
      const phoneCol = 'phone';
      for (const src of boardSources) {
        const row: BoardRow = { source: src, state: '', state_detail: '', fresh: null,
          fresh_target: audience === 'creators' ? CREATOR_TARGET : CAP,
          filtered: null, phone_pct: null, email_pct: null, both_pct: null,
          queue_new: null, queue_parked: null, errors: [] };
        const keys = audience === 'creators' ? [src] : (AUDIT_CAP_SOURCES[src] || [src]);
        const srcMatch = (q: any) => (isPrefixSource(src) ? q.like(srcCol, `${src}%`) : q.in(srcCol, keys));
        const cnt = async (label: string, build: (q: any) => any): Promise<number | null> => {
          const { count, error } = await build(srcMatch(db.from(table).select('id', { count: 'exact', head: true })));
          if (error) { row.errors.push(`${label}: ${error.message}`); return null; }
          return count ?? 0;
        };
        // 1) absolute fresh progress (creators: absolute total vs CREATOR_TARGET —
        //    the standing get-100-then-audit order counts every row, and the table
        //    started tonight at zero anyway)
        row.fresh = audience === 'creators'
          ? await cnt('target count', (q) => q)
          : await cnt('fresh count', (q) => (FRESH ? q.gte('fetched_at', FRESH) : q));
        // 2) queue health FIRST (services only) — the state below must not claim a
        //    source is "crawling" when its queue holds nothing runnable. That lie stood
        //    on this screen: five sources read "still crawling" with 0 runnable jobs
        //    and 2,500–13,000 parked (founder: "they're not working.. need them up").
        if (audience === 'services') {
          const qcnt = async (label: string, st: string[]): Promise<number | null> => {
            const { count, error } = await gdb.from('crawl_requests').select('id', { count: 'exact', head: true }).eq('source', src).in('status', st);
            if (error) { row.errors.push(`${label}: ${error.message}`); return null; }
            return count ?? 0;
          };
          row.queue_new = await qcnt('queue new', ['new', 'crawling']);
          row.queue_parked = await qcnt('queue parked', ['parked']);
        }
        // 3) state — founder orders first, then the honest fresh-100 math. The x/100
        //    display never exceeds its target (founder: "status of # out of 100
        //    accurate"): a capped source says 100 of 100 and reports the overshoot —
        //    the cap is checked before a CLAIM, so one in-flight tick can land more
        //    rows than the remainder.
        const shown = row.fresh === null ? null : Math.min(row.fresh, row.fresh_target);
        if (audience === 'services' && src === 'yelp') {
          row.state = 'paused';
          row.state_detail = 'paused by founder order 2026-08-02 ("don\'t delete yelp.. just pause as a source") — rows kept, source idle until re-activated';
        } else if (row.fresh === null) {
          row.state = 'COUNT FAILED';
          row.state_detail = row.errors.join(' | ');
        } else if (row.fresh >= row.fresh_target) {
          row.state = audience === 'creators' ? 'target met — paused for audit' : 'audit-cap met — stopped for audit';
          row.state_detail = `${shown} of ${row.fresh_target} — download and audit; it stopped itself (SPEC-246)${row.fresh > row.fresh_target ? ` · ${row.fresh} gathered before the stop` : ''}`;
        } else if (audience === 'services' && row.queue_new === 0) {
          row.state = 'NO RUNNABLE JOBS';
          row.state_detail = `${shown} of ${row.fresh_target} fresh but the queue holds nothing runnable (${row.queue_parked ?? '?'} parked) — cannot gather until jobs are un-parked/seeded`;
        } else if (audience === 'services' && src === 'ig_services') {
          row.state = (row.fresh ?? 0) > 0 ? 'crawling (dual-class)' : 'starting (dual-class)';
          row.state_detail = 'writes a service row AND a creator row per crawl; stops at the 100-creator target, exempt from the service cap (SPEC-246/248)';
        } else {
          row.state = audience === 'creators' ? `gathering ${row.fresh_target}` : 'gathering fresh 100';
          row.state_detail = `${shown} of ${row.fresh_target}${audience === 'services' ? ` FRESH since ${FRESH ?? 'ever'}` : ''} — crawling (${row.queue_new ?? '?'} runnable jobs)`;
        }
        // 3) filtered counts + contactable drill-down (obey every screen filter)
        const f = (q: any) => {
          let out = q;
          if (dmaSpellings) out = out.in(stateCol, dmaSpellings);
          if (locality) out = out.eq('city', locality);
          if (typeFilter) out = out.eq('service_type', typeFilter);
          if (categoryFilter) out = out.eq('category', categoryFilter);
          if (sinceHours > 0) out = out.gte(tsCol, new Date(Date.now() - sinceHours * 36e5).toISOString());
          return out;
        };
        row.filtered = await cnt('filtered count', f);
        if (row.filtered) {
          const nPhone = await cnt('phone count', (q) => f(q).not(phoneCol, 'is', null));
          const nEmail = await cnt('email count', (q) => f(q).not(emailCol, 'is', null));
          const nBoth = await cnt('both count', (q) => f(q).not(phoneCol, 'is', null).not(emailCol, 'is', null));
          row.phone_pct = nPhone === null ? null : Math.round((nPhone / row.filtered) * 100);
          row.email_pct = nEmail === null ? null : Math.round((nEmail / row.filtered) * 100);
          row.both_pct = nBoth === null ? null : Math.round((nBoth / row.filtered) * 100);
        } else if (row.filtered === 0) { row.phone_pct = 0; row.email_pct = 0; row.both_pct = 0; }
        board.push(row);
      }
    }

    return json({ audience, label: DS.label, srcCol, isLeadTable, total, filteredTotal: filteredTotal ?? 0, rowCap: ROW_CAP, localities, serviceTypes, categories, withPhone, withEmail, bySource, contactBySource, byCity, byStatus, growth, board, rows: rows || [] });
  } catch (e) {
    return json({ error: String(e).slice(0, 300) }, 500);
  }
});
