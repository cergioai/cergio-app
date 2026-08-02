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
const CRE_SOURCES = ['ig-scraper-user-search', 'ig-creator-marketplace'];
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
    const audience = body.audience === 'creators' ? 'creators' : 'services';
    const table = audience === 'creators' ? 'leads_influencers' : 'leads_services';
    const cityFilter: string | null = body.city || null;   // 'NY' | 'FL' | null
    const sourceFilter: string | null = body.source || null;
    const stateCol = 'state';
    // Creator rows label their origin in discovered_via; service rows use data_source.
    const srcCol = audience === 'creators' ? 'discovered_via' : 'data_source';

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
    const byCity = { NYC: await count((b) => b.eq(stateCol, 'NY')), Miami: await count((b) => b.eq(stateCol, 'FL')) };
    const statuses = ['new', 'pending_review', 'queued', 'opted_in', 'do_not_contact'];
    const byStatus: Record<string, number> = {};
    await Promise.all(statuses.map(async (st) => { byStatus[st] = await count((b) => b.eq('outreach_status', st)); }));

    // growth: rows fetched in last 1/7/14 days
    const since = (d: number) => new Date(Date.now() - d * 864e5).toISOString();
    const growth = {
      last1d: await count((b) => b.gte('fetched_at', since(1))),
      last7d: await count((b) => b.gte('fetched_at', since(7))),
      last14d: await count((b) => b.gte('fetched_at', since(14))),
    };

    // contactable totals
    const withPhone = await count((b) => b.not('phone', 'is', null));
    const withEmail = await count((b) => audience === 'creators' ? b.not('email', 'is', null) : b.not('owner_email', 'is', null));
    const total = await count((b) => b);

    // SPEC-192 is a HARD spec: a lead without a phone or an email is not a lead. A
    // platform-wide contactable total hides which source is producing the junk, so it is
    // broken out per source — that is the number that should decide where a dollar goes.
    const contactBySource: Record<string, { total: number; contactable: number; pct: number }> = {};
    const emailCol = audience === 'creators' ? 'email' : 'owner_email';
    await Promise.all(sources.map(async (src) => {
      const t = await count((b) => b.eq(srcCol, src));
      const c = await count((b) => b.eq(srcCol, src).or(`phone.not.is.null,${emailCol}.not.is.null`));
      contactBySource[src] = { total: t, contactable: c, pct: t ? Math.round((c / t) * 100) : 0 };
    }));

    // filtered rows for the table/download
    let rq = db.from(table).select('*').neq('outreach_status', 'do_not_contact').limit(10000);
    if (cityFilter) rq = rq.eq(stateCol, cityFilter);
    if (sourceFilter) rq = rq.eq(srcCol, sourceFilter);
    const { data: rows } = await rq;

    return json({ audience, srcCol, total, withPhone, withEmail, bySource, contactBySource, byCity, byStatus, growth, rows: rows || [] });
  } catch (e) {
    return json({ error: String(e).slice(0, 300) }, 500);
  }
});
