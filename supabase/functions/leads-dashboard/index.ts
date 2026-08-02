// Supabase Edge Function — leads dashboard (SPEC-90). Admin-gated live data view:
// counts by SOURCE / city / status / entity + growth + filtered rows, reading past
// RLS server-side (the reason cergio.ai/ops/data showed "No rows" before).
// AUTH: caller JWT email must be in the admin allowlist. Mirrors admin-crawl-status.
import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4?target=deno&deno-std=0.224.0';
import { growthDb } from '../_shared/growthDb.ts';

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
const CRE_SOURCES = ['ig-scraper-user-search'];
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
    const cityFilter: string | null = body.city || null;      // metro: 'NY' | 'FL' | null
    const locality: string | null = body.locality || null;    // 'Brooklyn', 'Wynwood', …
    const typeFilter: string | null = body.serviceType || null;
    const categoryFilter: string | null = body.category || null;
    const sinceHours = Number(body.sinceHours || 0);
    const limit = Math.min(Number(body.limit || 10000), 10000);
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
    for (const r of (srcRows || [])) { const v = String((r as any)[srcCol] ?? '').trim(); if (v) seen.add(v); }
    const known = audience === 'creators' ? CRE_SOURCES : SVC_SOURCES;
    for (const k of known) seen.add(k);
    const sources = [...seen].sort();

    // by source
    const bySource: Record<string, number> = {};
    await Promise.all(sources.map(async (src) => { bySource[src] = await count((b) => b.eq(srcCol, src)); }));
    bySource['(other/unlabeled)'] = Math.max(0, (await count((b) => b)) - Object.values(bySource).reduce((a, c) => a + c, 0));

    // by city (NY / FL / other) and by status
    const byCity = isLeadTable
      ? { NYC: await count((b) => b.eq(stateCol, 'NY')), Miami: await count((b) => b.eq(stateCol, 'FL')) }
      : {};
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
      const t = await count((b) => b.eq(srcCol, src));
      const c = await count((b) => b.eq(srcCol, src).or(`phone.not.is.null,${emailCol}.not.is.null`));
      contactBySource[src] = { total: t, contactable: c, pct: t ? Math.round((c / t) * 100) : 0 };
    }));

    // filtered rows for the table/download
    const ROW_CAP = limit;
    // The facet lists come from the data, so an option that cannot return a row is never
    // offered. Scoped to the CURRENT metro, because the neighbourhoods of NYC are not
    // choices when the metro is Miami.
    const facet = async (col: string) => {
      let q2 = db.from(table).select(col).limit(20000);
      if (cityFilter) q2 = q2.eq(stateCol, cityFilter);
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
    if (cityFilter) rq = rq.eq(stateCol, cityFilter);
    if (sourceFilter) rq = rq.eq(srcCol, sourceFilter);
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
    if (cityFilter) cq = cq.eq(stateCol, cityFilter);
    if (sourceFilter) cq = cq.eq(srcCol, sourceFilter);
    if (body.status) cq = cq.eq(statusCol, body.status);
    if (body.contactableOnly && isLeadTable) cq = cq.or(`phone.not.is.null,${emailCol}.not.is.null`);
    const { count: filteredTotal } = await cq;

    return json({ audience, label: DS.label, srcCol, isLeadTable, total, filteredTotal: filteredTotal ?? 0, rowCap: ROW_CAP, localities, serviceTypes, categories, withPhone, withEmail, bySource, contactBySource, byCity, byStatus, growth, rows: rows || [] });
  } catch (e) {
    return json({ error: String(e).slice(0, 300) }, 500);
  }
});
