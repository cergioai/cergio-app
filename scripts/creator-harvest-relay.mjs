// SPEC-269 — CI SEARCH RELAY. Runs on a GitHub runner because the engines answer
// runner IPs and wall the Supabase edge egress (MEASURED: search-probe #1 —
// ddg-html HTTP 200 with 10 result__a blocks from 172.208.23.71, while the edge's
// meta.engines shows 0 across all four engines on every tick).
//
// This script carries TRANSPORT ONLY (the #204 lesson — extraction, geo, dedupe,
// caps and every quality gate live in ONE place, the creator-harvest edge fn):
//   1. POST {mode:'queries'} → the worker builds this run's query slice AFTER its
//      kill-switch, fresh self-stop and per-(category×metro) caps.
//   2. fetch ddg-html per query FROM THE RUNNER (8s cap, 300-700ms jitter between
//      queries — the runner IP must not be burned the way the edge IP was).
//   3. POST {mode:'ingest', items} → the worker runs its unmodified pipeline.
//
// Auth: SUPABASE_SERVICE_ROLE_KEY (repo secret — same bearer the kick step uses).
// $0, keyless, no vendor. PAID IG STAYS FORBIDDEN (founder, verbatim: "not paid! IG").

const FN = process.env.FN_BASE || 'https://vjmwnbftfquyquwaklue.functions.supabase.co';
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
if (!KEY) { console.error('SUPABASE_SERVICE_ROLE_KEY is EMPTY — the relay cannot authenticate; add the repo secret'); process.exit(1); }

const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0 Safari/537.36';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function stripTags(s) { return String(s).replace(/<[^>]+>/g, ' ').replace(/&amp;/g, '&').replace(/&#x27;/g, "'").replace(/&quot;/g, '"').replace(/&gt;/g, '>').replace(/&lt;/g, '<').replace(/\s+/g, ' ').trim(); }
function decodeDdg(href) {
  try {
    if (href.startsWith('//duckduckgo.com/l/') || href.startsWith('/l/') || href.includes('duckduckgo.com/l/')) {
      const u = new URL(href.startsWith('//') ? 'https:' + href : (href.startsWith('/') ? 'https://duckduckgo.com' + href : href));
      const target = u.searchParams.get('uddg');
      return target ? decodeURIComponent(target) : null;
    }
    return href.startsWith('http') ? href : null;
  } catch { return null; }
}
// Same result shape the worker's own parser produces: {url,title,snippet} × ≤12.
function parseDdgHtml(html) {
  const out = [];
  const re = /<a[^>]*class="[^"]*result__a[^"]*"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>[\s\S]*?(?:class="[^"]*result__snippet[^"]*"[^>]*>([\s\S]*?)<\/a>)?/gi;
  let m;
  while ((m = re.exec(html)) && out.length < 12) {
    const url = decodeDdg(m[1]);
    if (!url) continue;
    out.push({ url, title: stripTags(m[2] || ''), snippet: stripTags(m[3] || '') });
  }
  return out;
}

async function ddg(query) {
  try {
    const res = await fetch(`https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`, {
      signal: AbortSignal.timeout(8000),
      headers: { 'User-Agent': UA, 'Accept': 'text/html,application/xhtml+xml' },
    });
    if (!res.ok) return { results: [], code: res.status };
    return { results: parseDdgHtml(await res.text()), code: res.status };
  } catch { return { results: [], code: 0 }; }
}

async function callFn(body) {
  const res = await fetch(`${FN}/creator-harvest`, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  let j = null; try { j = JSON.parse(text); } catch { /* leave null */ }
  return { status: res.status, body: j, raw: text.slice(0, 400) };
}

// 1) the worker builds the slice (its kill-switch / self-stop / caps decide)
const q = await callFn({ mode: 'queries' });
if (q.status !== 200 || !q.body?.ok) {
  // paused/suspended/target-met is a CLEAN stop, not an error — say which.
  console.log(`queries mode -> HTTP ${q.status}: ${q.raw}`);
  process.exit(q.status === 200 ? 0 : 1);
}
let queries = Array.isArray(q.body.queries) ? q.body.queries : [];
// SPEC-271 — matrix lanes: each lane rotates the shared slice to its OWN disjoint
// window, so 8 fresh runner IPs spend their ~2 served queries on 16 DIFFERENT
// searches instead of the same head. Ingest dedupes any overlap regardless.
const LANE = Number(process.env.LANE || 0), LANES = Number(process.env.LANES || 1);
if (LANES > 1 && queries.length) {
  const off = (LANE * Math.ceil(queries.length / LANES)) % queries.length;
  queries = queries.slice(off).concat(queries.slice(0, off));
}
console.log(`worker handed ${queries.length} queries (spin ${q.body.spin}, lane ${LANE}/${LANES})`);
if (!queries.length) { console.log('nothing to search this tick'); process.exit(0); }

// 2) search from the runner — the leg the edge cannot do
const items = [];
let served = 0, walled = 0;
for (const item of queries) {
  const { results, code } = await ddg(item.query);
  if (results.length) served++; else walled++;
  items.push({ query: item.query, niche: item.niche, city: item.city, results });
  await sleep(300 + Math.floor(Math.random() * 400));
}
console.log(`searched ${queries.length} queries from the runner: ${served} served, ${walled} empty/walled`);

// 3) hand the results back to the single-truth pipeline
const ing = await callFn({ mode: 'ingest', items });
console.log(`ingest -> HTTP ${ing.status}: inserted=${ing.body?.inserted ?? '?'} found=${ing.body?.found ?? '?'} with_contact=${ing.body?.with_contact ?? '?'} skips=${JSON.stringify(ing.body?.skips ?? {})}`);
if (ing.status !== 200) process.exit(1);
// A relay that searched real results but inserted 0 is worth seeing loudly in the log,
// but it is NOT a failure — dedupe against known handles is the expected steady state.
