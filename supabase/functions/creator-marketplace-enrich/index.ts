// Supabase Edge Function — Instagram Creator Marketplace enrichment (SPEC-87).
//
// FREE, first-party Meta data — the legitimate Modash-equivalent. Uses the IG
// Creator Marketplace Discovery + Insights APIs to (a) DISCOVER creators per
// category x city and (b) fill real followers / email / engagement onto our
// leads_influencers pool. First-party API — NOT scraping (fully ToS-compliant).
//
// Requires (set once Tarik adds `instagram_creator_marketplace_discovery`,
// accepts the Marketplace ToS, and mints a Page token):
//   IG_USER_ID           - the brand IG business account id
//   IG_MARKETPLACE_TOKEN - Page access token with the marketplace permission
// If either is missing the function NO-OPS with status 'pending_access' — it
// never crashes and never fabricates. Everything written is fill-only (never
// overwrites a non-null field) and lands pending_review (non-sendable) with
// discovered_via='ig-creator-marketplace'.
//
// AUTH: service-role bearer (cron / launcher).  Modes: ?mode=discover | insights

import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4?target=deno&deno-std=0.224.0';

const GRAPH = 'https://graph.facebook.com/v25.0';

// Tarik's 14 categories -> Marketplace creator_interests enum (when one exists)
// + a free-text query keyword (used when no enum maps, and always for the city).
const CAT: Record<string, { interest?: string; kw: string }> = {
  parenting:     { kw: 'parenting mom family' },
  fitness:       { interest: 'FITNESS_AND_WORKOUTS', kw: 'fitness' },
  health:        { interest: 'FITNESS_AND_WORKOUTS', kw: 'health' },
  pets:          { interest: 'ANIMALS_AND_PETS', kw: 'pets' },
  nutrition:     { interest: 'FOOD_AND_DRINK', kw: 'nutrition dietitian' },
  weddings:      { kw: 'wedding bride' },
  home:          { interest: 'HOME_AND_GARDEN', kw: 'home decor interior' },
  'real estate': { interest: 'BUSINESS_FINANCE_AND_ECONOMICS', kw: 'real estate realtor' },
  fashion:       { interest: 'FASHION', kw: 'fashion style' },
  lifestyle:     { kw: 'lifestyle' },
  beauty:        { interest: 'BEAUTY', kw: 'beauty skincare' },
  shopping:      { interest: 'FASHION', kw: 'shopping haul deals' },
  auto:          { interest: 'VEHICLES_AND_TRANSPORTATION', kw: 'car auto' },
  wellness:      { interest: 'FITNESS_AND_WORKOUTS', kw: 'wellness self care' },
};

const CITIES: Record<string, { state: string; aliases: string[] }> = {
  'New York': { state: 'NY', aliases: ['new york', 'nyc', 'brooklyn', 'manhattan', 'queens', 'bronx'] },
  'Miami':    { state: 'FL', aliases: ['miami', 'miami beach', 'brickell', 'wynwood', 'coral gables', 'south florida'] },
};

const MIN_FOLLOWERS = 10000;   // marketplace buckets: 0/10k/25k/50k/75k/100k
const MAX_PAGES     = 4;       // per category x city, per run (rate-limit friendly)
const DISCOVER_FIELDS = 'id,username,biography,country,is_account_verified,email,portfolio_url,onboarded_status,insights';

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}
function cityMatch(city: string, text: string): boolean {
  const t = (text || '').toLowerCase();
  return (CITIES[city]?.aliases || [city.toLowerCase()]).some((a) => t.includes(a));
}
function firstEmail(s: string): string | null {
  const m = (s || '').match(/[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/i);
  return m ? m[0].toLowerCase() : null;
}
// Pull a followers-like number out of the discovery insights blob if present.
function followersFrom(insights: unknown): number | null {
  try {
    const arr = (insights as any)?.data ?? insights;
    if (!Array.isArray(arr)) return null;
    for (const it of arr) {
      const name = String(it?.name || it?.metric || '').toLowerCase();
      if (name.includes('follower')) {
        const v = it?.total_value?.value ?? it?.value ?? it?.values?.[0]?.value;
        if (typeof v === 'number') return v;
      }
    }
  } catch (_e) { /* ignore */ }
  return null;
}

async function graphGet(url: string): Promise<any> {
  const ctrl = new AbortController();
  const to = setTimeout(() => ctrl.abort(), 20000);
  try {
    const r = await fetch(url, { signal: ctrl.signal });
    const body = await r.json().catch(() => ({}));
    return { ok: r.ok, status: r.status, body };
  } catch (e) {
    return { ok: false, status: 0, body: { error: { message: String(e) } } };
  } finally { clearTimeout(to); }
}

serve(async (req: Request) => {
  const started = Date.now();
  const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
  const serviceKey  = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const auth = req.headers.get('Authorization')?.replace('Bearer ', '');
  if (!auth || auth !== serviceKey) return json({ error: 'Unauthorized' }, 401);

  const IG_USER_ID = Deno.env.get('IG_USER_ID');
  const TOKEN      = Deno.env.get('IG_MARKETPLACE_TOKEN');
  if (!IG_USER_ID || !TOKEN) {
    return json({
      status: 'pending_access',
      note: 'Set IG_USER_ID + IG_MARKETPLACE_TOKEN after adding instagram_creator_marketplace_discovery, accepting the Marketplace ToS, and minting a Page token. Function is built and deployed; this is a graceful no-op until then.',
    });
  }

  const db = createClient(supabaseUrl, serviceKey);
  const mode = new URL(req.url).searchParams.get('mode') || 'discover';
  const skips = { no_handle: 0, below_min: 0, business_country: 0, existing_filled: 0 };
  let raw = 0, inserted = 0, updated = 0;

  // fill-only upsert keyed on ig_handle
  async function persist(row: Record<string, unknown>) {
    const handle = row.ig_handle as string;
    const { data: ex } = await db.from('leads_influencers').select('*').eq('ig_handle', handle).maybeSingle();
    if (ex) {
      const patch: Record<string, unknown> = {};
      for (const k of ['followers', 'email', 'city', 'state', 'external_url', 'display_name']) {
        const cur = (ex as any)[k];
        if ((cur === null || cur === undefined || cur === '') && row[k] != null && row[k] !== '') patch[k] = row[k];
      }
      if (Object.keys(patch).length === 0) { skips.existing_filled++; return; }
      patch.updated_at = new Date().toISOString();
      const { data: w } = await db.from('leads_influencers').update(patch).eq('id', (ex as any).id).select('id');
      if (w && w.length) updated++;
    } else {
      const { data: w } = await db.from('leads_influencers').insert({
        id: `igcm:${handle}`,
        ...row,
        is_business: false,
        outreach_status: 'pending_review',
        discovered_via: 'ig-creator-marketplace',
      }).select('id');
      if (w && w.length) inserted++;
    }
  }

  try {
    if (mode === 'insights') {
      // Fill real followers onto pending_review rows we still have null for.
      const { data: rows } = await db.from('leads_influencers')
        .select('id,ig_handle,followers,email')
        .eq('outreach_status', 'pending_review').is('followers', null)
        .not('ig_handle', 'is', null).limit(60);
      for (const r of rows || []) {
        const h = (r as any).ig_handle;
        const url = `${GRAPH}/${IG_USER_ID}/creator_marketplace_creators?username=${encodeURIComponent(h)}`
          + `&fields=username,email,biography,insights.metrics(total_followers)&access_token=${TOKEN}`;
        const res = await graphGet(url); raw++;
        if (!res.ok) continue;
        const c = res.body?.data?.[0] || res.body;
        const fol = followersFrom(c?.insights);
        const patch: Record<string, unknown> = {};
        if (fol != null) patch.followers = fol;
        if (!(r as any).email && c?.email) patch.email = String(c.email).toLowerCase();
        if (Object.keys(patch).length) {
          patch.updated_at = new Date().toISOString();
          const { data: w } = await db.from('leads_influencers').update(patch).eq('id', (r as any).id).select('id');
          if (w && w.length) updated++;
        }
      }
    } else {
      // DISCOVER creators per category x city.
      for (const [category, cfg] of Object.entries(CAT)) {
        for (const [city, meta] of Object.entries(CITIES)) {
          const params = new URLSearchParams({
            fields: DISCOVER_FIELDS,
            query: `${city} ${cfg.kw}`,
            creator_min_followers: String(MIN_FOLLOWERS),
            access_token: TOKEN,
          });
          params.set('creator_countries', JSON.stringify([meta.state === 'FL' || meta.state === 'NY' ? 'US' : 'US']));
          if (cfg.interest) params.set('creator_interests', JSON.stringify([cfg.interest]));
          let url: string | null = `${GRAPH}/${IG_USER_ID}/creator_marketplace_creators?${params.toString()}`;
          for (let page = 0; page < MAX_PAGES && url; page++) {
            const res = await graphGet(url); 
            if (!res.ok) { url = null; break; }
            const list = res.body?.data || [];
            for (const c of list) {
              raw++;
              const handle = (c?.username || '').toLowerCase();
              if (!handle) { skips.no_handle++; continue; }
              if (c?.country && String(c.country).toUpperCase() !== 'US') { skips.business_country++; continue; }
              const bioText = `${c?.biography || ''} ${handle}`;
              const geoOk = cityMatch(city, bioText);
              const email = (c?.email && String(c.email).toLowerCase()) || firstEmail(c?.biography || '') || null;
              await persist({
                ig_handle: handle,
                display_name: c?.username || null,
                category,
                followers: followersFrom(c?.insights),   // real or null — never faked
                email,
                external_url: c?.portfolio_url || null,
                city: geoOk ? city : null,                // only claim city if verified in bio
                state: geoOk ? meta.state : null,
              });
            }
            url = res.body?.paging?.next || null;
          }
        }
      }
    }
    const out = { status: 'ok', mode, raw, inserted, updated, skips, ms: Date.now() - started };
    try {
      await db.from('agent_runs').insert({
        agent: 'creator-marketplace-enrich', started_at: new Date(started).toISOString(),
        finished_at: new Date().toISOString(), raw_found: raw, rows_written: inserted + updated,
        status: 'ok', meta: out,
      });
    } catch (_e) { /* best-effort */ }
    return json(out);
  } catch (e) {
    return json({ status: 'error', error: String(e).slice(0, 500), raw, inserted, updated }, 200);
  }
});
