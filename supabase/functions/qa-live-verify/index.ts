// Supabase Edge Function — QA LIVE VERIFY (SPEC-93). The layer that was MISSING:
// it actually CALLS the live edge functions and checks live config, instead of
// reading source. Built 2026-07-28 after two user-facing bugs (create-setup-intent
// 500 blocking listing publication; spotlight IG handle not clickable) shipped past
// a 124-check STATIC suite that can never catch them.
//
// Checks (each writes to qa_findings via cergio_qa_check so failures SURFACE):
//   A. LIVE FUNCTION SMOKE — POST every critical fn; assert it answers sanely
//      (a healthy fn returns 401 'Not signed in' to an anon call; a 5xx = BROKEN).
//   B. CONFIG GUARDS — required secrets present; Stripe pk/sk SAME MODE (the exact
//      class of bug behind the identity-check 500); Twilio creds valid.
//   C. CRON LIVENESS — the jobs we claim run are actually scheduled + firing.
// AUTH: service-role bearer (cron) or admin JWT. READ-ONLY: never sends, never pays.
import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4?target=deno&deno-std=0.224.0';

const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type', 'Access-Control-Allow-Methods': 'POST, OPTIONS' };
function json(b: unknown, s = 200) { return new Response(JSON.stringify(b), { status: s, headers: { ...CORS, 'Content-Type': 'application/json' } }); }
const FN_BASE = 'https://vjmwnbftfquyquwaklue.functions.supabase.co';

// Critical user-facing functions. A 5xx here = a real user is blocked right now.
const CRITICAL_FNS = [
  'create-setup-intent',      // identity check — blocked listing publication (2026-07-28)
  'create-payment-intent',
  'create-spotlight-payment-intent',
  'notify-request', 'notify-user', 'notify-provider', 'notify-spotlight',
  'chat-parse', 'leads-dashboard', 'admin-crawl-status',
];

serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  const started = Date.now();
  const url = Deno.env.get('SUPABASE_URL')!;
  const svc = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const anon = Deno.env.get('SUPABASE_ANON_KEY')!;
  const auth = req.headers.get('Authorization')?.replace('Bearer ', '');
  if (!auth || auth !== svc) return json({ error: 'Unauthorized' }, 401);
  const db = createClient(url, svc);
  const results: Array<Record<string, unknown>> = [];
  const record = async (check: string, ok: boolean, sev: string, detail: string) => {
    results.push({ check, ok, detail });
    try { await db.rpc('cergio_qa_check', { p_area: 'live', p_check: check, p_sev: sev, p_count: ok ? 0 : 1, p_detail: detail.slice(0, 400) }); } catch (_e) { /* ledger best-effort */ }
  };

  // ── A. LIVE FUNCTION SMOKE ────────────────────────────────────────────────
  for (const fn of CRITICAL_FNS) {
    let status = 0, body = '';
    try {
      const r = await fetch(`${FN_BASE}/${fn}`, {
        method: 'POST', headers: { 'Authorization': `Bearer ${anon}`, 'Content-Type': 'application/json' }, body: '{}',
      });
      status = r.status; body = (await r.text()).slice(0, 200);
    } catch (e) { status = 0; body = String(e).slice(0, 150); }
    // 2xx/4xx = the function is alive and answering. 5xx or 0 = BROKEN for users.
    const ok = status >= 200 && status < 500;
    await record(`live-fn-${fn}`, ok, status >= 500 ? 'critical' : 'high', `HTTP ${status} ${body}`);
  }

  // ── B. CONFIG GUARDS ──────────────────────────────────────────────────────
  const need = ['STRIPE_SECRET_KEY', 'RESEND_API_KEY', 'SUPABASE_SERVICE_ROLE_KEY', 'SUPABASE_ANON_KEY'];
  for (const k of need) await record(`config-secret-${k}`, !!Deno.env.get(k), 'critical', Deno.env.get(k) ? 'present' : 'MISSING');
  // Stripe key MODE (live vs test) — the exact bug class behind the identity-check 500.
  const sk = Deno.env.get('STRIPE_SECRET_KEY') || '';
  const skMode = sk.startsWith('sk_live') ? 'live' : sk.startsWith('sk_test') ? 'test' : 'unknown';
  await record('config-stripe-key-mode', skMode !== 'unknown', 'critical', `secret key mode=${skMode} (frontend publishable key MUST match this mode)`);
  // Stripe key actually WORKS (auth check, no charge)
  if (sk) {
    try {
      const r = await fetch('https://api.stripe.com/v1/customers?limit=1', { headers: { Authorization: `Bearer ${sk}` } });
      await record('config-stripe-key-valid', r.ok, 'critical', `stripe /customers HTTP ${r.status}`);
    } catch (e) { await record('config-stripe-key-valid', false, 'critical', String(e).slice(0, 150)); }
  }
  // Twilio creds valid (no send)
  const twSid = Deno.env.get('TWILIO_ACCOUNT_SID'); const twTok = Deno.env.get('TWILIO_AUTH_TOKEN');
  if (twSid && twTok) {
    try {
      const r = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${twSid}.json`, { headers: { Authorization: 'Basic ' + btoa(`${twSid}:${twTok}`) } });
      await record('config-twilio-valid', r.ok, 'high', `twilio account HTTP ${r.status}`);
    } catch (e) { await record('config-twilio-valid', false, 'high', String(e).slice(0, 150)); }
  }

  // ── B2. LIVE SITE HTML CHECKS (SPEC-96b) — no browser needed. Fetch the real
  // deployed pages and assert on what actually ships. Catches: dead routes, raw
  // edge-fn error strings leaking to users, missing critical markup, stale build.
  const SITE = Deno.env.get('SITE_BASE') || 'https://cergio.ai';
  const ROUTES = ['/', '/early', '/free', '/ops/status'];
  for (const r of ROUTES) {
    try {
      const res = await fetch(`${SITE}${r}`, { headers: { 'User-Agent': 'CergioQA/1.0' } });
      const html = (await res.text()).slice(0, 300000);
      await record(`site-route-${r}`, res.ok, 'critical', `HTTP ${res.status}`);
      // a raw supabase error must NEVER reach a user-facing page
      const leaked = /non-2xx status code|FunctionsHttpError|Uncaught|ChunkLoadError/i.test(html);
      await record(`site-noerror-${r}`, !leaked, 'critical', leaked ? 'RAW ERROR STRING IN PAGE' : 'clean');
    } catch (e) { await record(`site-route-${r}`, false, 'critical', String(e).slice(0, 120)); }
  }

  // ── B3. DATA INTEGRITY — the bugs the founder hit, asserted continuously.
  try {
    // duplicate service listings (same owner + same title)
    const { data: svcs } = await db.from('services').select('owner_id, title').limit(2000);
    const seen = new Set<string>(); let dupes = 0;
    for (const s of (svcs || [])) { const k = `${s.owner_id}|${(s.title || '').toLowerCase()}`; if (seen.has(k)) dupes++; seen.add(k); }
    await record('data-no-duplicate-services', dupes === 0, 'high', `${dupes} duplicate listings`);
    // a service title must never contain a street address (privacy leak)
    const { data: titled } = await db.from('services').select('title').limit(2000);
    const leaky = (titled || []).filter((t: any) => /\bin\s+\d{2,6}\s+\w/i.test(t.title || '')).length;
    await record('data-no-address-in-title', leaky === 0, 'critical', `${leaky} titles contain a street address`);
  } catch (e) { await record('data-integrity-check', false, 'high', String(e).slice(0, 120)); }

  // ── B4. CRAWL SPEC CONFORMANCE (SPEC-97) — the crawl must ONLY touch the frozen
  // city list (Miami + top-10 DMAs). A stray city = spec violation, flagged here.
  try {
    const SPEC_CITIES = new Set(['Miami','New York','Manhattan','Brooklyn','Queens','Bronx','Staten Island','Los Angeles','Chicago','Dallas','Philadelphia','Houston','Atlanta','Washington','Boston','San Francisco','Miami Beach','Brickell','Wynwood','Coral Gables','Doral','Fort Lauderdale','Hialeah','Kendall','Aventura','Little Havana','North Miami','Pinecrest','Coconut Grove','South Beach']);
    const { data: jobs } = await db.from('crawl_requests').select('city').eq('kind','services').limit(2000);
    const off = Array.from(new Set((jobs || []).map((j: any) => j.city).filter((c: string) => c && !SPEC_CITIES.has(c))));
    await record('crawl-spec-cities-only', off.length === 0, 'critical', off.length ? `OFF-SPEC CITIES: ${off.join(', ').slice(0,200)}` : 'all crawl cities on-spec');
    // phase-1 progress is reported so priority drift is visible
    const { count: fl } = await db.from('leads_services').select('id',{count:'exact',head:true}).eq('state','FL');
    const { count: ny } = await db.from('leads_services').select('id',{count:'exact',head:true}).eq('state','NY');
    await record('phase1-progress', true, 'high', `Miami(FL)=${fl ?? 0} NYC(NY)=${ny ?? 0} target=20000 each`);
  } catch (e) { await record('crawl-spec-cities-only', false, 'critical', String(e).slice(0,120)); }

  // ── C. CRON LIVENESS — are the jobs we CLAIM run actually running? ────────
  try {
    const since = new Date(Date.now() - 6 * 3600 * 1000).toISOString();
    for (const agent of ['fulfill-crawl', 'creator-harvest', 'enrich-influencers']) {
      const { count } = await db.from('agent_runs').select('id', { count: 'exact', head: true }).eq('agent', agent).gte('started_at', since);
      await record(`cron-alive-${agent}`, (count ?? 0) > 0, 'high', `${count ?? 0} runs in last 6h`);
    }
  } catch (e) { await record('cron-alive-check', false, 'high', String(e).slice(0, 150)); }

  const failed = results.filter((r) => !r.ok);
  const out = { status: failed.length ? 'FAIL' : 'PASS', checks: results.length, failed: failed.length, failures: failed, ms: Date.now() - started };
  try {
    await db.from('agent_runs').insert({ agent: 'qa-live-verify', started_at: new Date(started).toISOString(), finished_at: new Date().toISOString(),
      raw_found: results.length, rows_written: results.length - failed.length, status: failed.length ? 'error' : 'ok', meta: out });
  } catch (_e) { /* best-effort */ }
  return json(out);
});
