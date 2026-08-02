// SPEC-197 — FOUNDER AUDIT EXPORT. Read-only; spends nothing.
//
// Founder: "I now need to see 100 leads from each crawler and audit them before
// activating or scaling... the entire data output from each of the sources."
//
// Produces, per source: a 100-row sample, the full export, and a quality summary. The
// quality columns are the ones that decide whether a lead is worth anything — his HARD
// spec is that a lead without a phone or an email is useless.
import fs from 'node:fs';

const URL_G = (process.env.GROWTH_SUPABASE_URL || '').trim().replace(/\/+$/, '');
const KEY = (process.env.GROWTH_SERVICE_ROLE_KEY || '').trim();
if (!URL_G || !KEY) { console.error('growth credentials missing'); process.exit(1); }
const H = { apikey: KEY, Authorization: `Bearer ${KEY}` };

// SPEC-201 — TWO DATA CLASSES, never mixed. Founder, 2026-08-02: "what are the sources
// of creators?... clearly identify them as a separate class of data."
//
// SERVICES  = businesses/providers -> leads_services. Eight sources.
// CREATORS  = people with an audience who spotlight providers -> leads_influencers.
//             Only TWO discovery paths exist, and they are NOT interchangeable:
//               ig-creator-marketplace  (creator-marketplace-enrich) FIRST-PARTY Meta API
//               ig-scraper-user-search  (fulfill-crawl ig_services)  Apify IG scraper
//             `ig_services` is DUAL-CLASS: it writes a service row AND a creator row for
//             the same person, which is why it appears in both tables.
const SOURCES = ['osm', 'craigslist', 'yellowpages_apify', 'yelp',
                 'google_lsa', 'google_sponsored', 'gmaps_apify', 'ig_services'];
const CREATOR_SOURCES = ['ig-creator-marketplace', 'ig-scraper-user-search'];
const CREATOR_COLS = 'id,ig_handle,display_name,category,followers,email,phone,bio,external_url,city,state,is_business,discovered_via,outreach_status';
const COLS = 'id,name,service_type,phone,owner_email,website_url,instagram,address,city,state,lat,lon,data_source,outreach_status,fetched_at';

fs.mkdirSync('audit', { recursive: true });

const csv = (rows, cols) => [cols.join(','),
  ...rows.map((r) => cols.map((c) => {
    const v = r[c] == null ? '' : String(r[c]);
    return /[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
  }).join(','))].join('\n');

const diag = [];
async function get(url, label) {
  const r = await fetch(url, { headers: H });
  const body = await r.text();
  if (!r.ok) {
    const msg = `${r.status} ${body.slice(0, 200)}`;
    console.error(`  FAIL ${label}: ${msg}`);
    diag.push(`${label}: HTTP ${msg}`);
    return [];
  }
  try { return JSON.parse(body); }
  catch (e) {
    diag.push(`${label}: unparseable body (${body.slice(0, 120)})`);
    return [];
  }
}

// Prove the connection ONCE before looping — an export that silently writes eight empty
// files is worse than one that fails loudly.
async function preflight() {
  const r = await fetch(`${URL_G}/rest/v1/leads_services?select=id&limit=1`, { headers: H });
  const b = await r.text();
  const line = `preflight: HTTP ${r.status} · key ${KEY.slice(0, 11)}… (${KEY.length} chars) · ${b.slice(0, 120)}`;
  console.log(line); diag.push(line);
  if (!r.ok) { console.error('PREFLIGHT FAILED — the export cannot read the growth DB'); }
  return r.ok;
}

const ok = await preflight();
const summary = [];
for (const src of SOURCES) {
  // newest first — "since reset" means the most recent output, not the oldest
  const sample = await get(`${URL_G}/rest/v1/leads_services?select=${COLS}&data_source=eq.${src}&order=fetched_at.desc&limit=100`, `sample ${src}`);
  fs.writeFileSync(`audit/sample-100-${src}.csv`, csv(sample, COLS.split(',')));

  let all = [], from = 0;
  for (;;) {
    const page = await get(`${URL_G}/rest/v1/leads_services?select=${COLS}&data_source=eq.${src}&order=fetched_at.desc&offset=${from}&limit=1000`, `all ${src} @${from}`);
    all = all.concat(page);
    if (page.length < 1000 || all.length >= 20000) break;
    from += 1000;
  }
  fs.writeFileSync(`audit/all-${src}.csv`, csv(all, COLS.split(',')));

  const n = all.length;
  const has = (f) => all.filter((r) => r[f] && String(r[f]).trim()).length;
  const phone = has('phone'), email = has('owner_email');
  const contactable = all.filter((r) => (r.phone && String(r.phone).trim()) || (r.owner_email && String(r.owner_email).trim())).length;
  const named = all.filter((r) => r.name && String(r.name).trim().length > 2).length;
  const geo = all.filter((r) => r.lat != null && r.lon != null).length;
  const dupPhone = n - new Set(all.map((r) => (r.phone || '').replace(/\D/g, '')).filter(Boolean)).size - (n - phone);

  summary.push({
    source: src, leads: n, sample: sample.length,
    with_phone: phone, with_email: email, contactable,
    contactable_pct: n ? Math.round((contactable / n) * 1000) / 10 : 0,
    with_website: has('website_url'), with_instagram: has('instagram'),
    with_name: named, with_coords: geo,
    duplicate_phones: dupPhone > 0 ? dupPhone : 0,
    newest: all[0]?.fetched_at || '', oldest: all[n - 1]?.fetched_at || '',
  });
  console.log(`${src.padEnd(20)} ${String(n).padStart(6)} leads · ${summary.at(-1).contactable_pct}% contactable`);
}

// ---- CREATORS: exported separately, never blended into the services numbers ----
const creatorRows = await get(`${URL_G}/rest/v1/leads_influencers?select=${CREATOR_COLS}&order=id.desc&limit=5000`, 'creators all');
fs.writeFileSync('audit/all-CREATORS.csv', csv(creatorRows, CREATOR_COLS.split(',')));
fs.writeFileSync('audit/sample-100-CREATORS.csv', csv(creatorRows.slice(0, 100), CREATOR_COLS.split(',')));
const creatorSummary = CREATOR_SOURCES.map((src) => {
  const rows = creatorRows.filter((r) => String(r.discovered_via || '').startsWith(src.split('-')[0] === 'ig' ? src : src));
  const reach = rows.filter((r) => (r.email && String(r.email).trim()) || (r.phone && String(r.phone).trim())).length;
  return { creator_source: src, creators: rows.length, contactable: reach,
           contactable_pct: rows.length ? Math.round((reach / rows.length) * 1000) / 10 : 0,
           with_followers: rows.filter((r) => Number(r.followers) > 0).length };
});
creatorSummary.push({ creator_source: 'TOTAL', creators: creatorRows.length,
  contactable: creatorRows.filter((r) => r.email || r.phone).length,
  contactable_pct: creatorRows.length ? Math.round((creatorRows.filter((r) => r.email || r.phone).length / creatorRows.length) * 1000) / 10 : 0,
  with_followers: creatorRows.filter((r) => Number(r.followers) > 0).length });
fs.writeFileSync('audit/CREATORS-SUMMARY.csv', csv(creatorSummary, Object.keys(creatorSummary[0])));
console.log(`creators: ${creatorRows.length} row(s) across ${CREATOR_SOURCES.length} discovery paths`);

const cols = Object.keys(summary[0] || { source: '' });
fs.writeFileSync('audit/QUALITY-SUMMARY.csv', csv(summary, cols));

// A plain-English verdict per source, so the founder does not have to read CSVs to know
// which sources are worth scaling.
const md = ['# Crawl audit — quality per source', '',
  `Generated ${new Date().toISOString()}. Crawling is SUSPENDED (SPEC-197) while this is reviewed.`, '',
  '**The bar (founder, HARD spec):** a lead without a phone OR an email is useless and must not be paid for.', '',
  '| source | leads | contactable | phone | email | website | IG | coords | verdict |',
  '|---|---|---|---|---|---|---|---|---|'];
for (const s of summary) {
  const v = s.leads === 0 ? 'no data'
    : s.contactable_pct >= 80 ? 'STRONG — scale'
    : s.contactable_pct >= 40 ? 'MIXED — usable, needs enrichment'
    : 'WEAK — most rows unreachable';
  md.push(`| **${s.source}** | ${s.leads} | **${s.contactable_pct}%** | ${s.with_phone} | ${s.with_email} | ${s.with_website} | ${s.with_instagram} | ${s.with_coords} | ${v} |`);
}
md.push('', '---', '', '## CREATORS — a SEPARATE data class', '',
  'Creators are people with an audience who spotlight providers. They live in',
  '`leads_influencers`, never mixed into the services numbers above. Only TWO discovery',
  'paths exist:', '',
  '| creator source | what it is | creators | contactable | with followers |',
  '|---|---|---|---|---|');
for (const c of creatorSummary) {
  const what = c.creator_source === 'ig-creator-marketplace' ? 'FIRST-PARTY Meta Creator Marketplace API'
    : c.creator_source === 'ig-scraper-user-search' ? 'Apify Instagram scraper (founder override)'
    : '—';
  md.push(`| **${c.creator_source}** | ${what} | ${c.creators} | ${c.contactable_pct}% | ${c.with_followers} |`);
}
md.push('', '`ig_services` is DUAL-CLASS: it writes a service row AND a creator row for the same person.', '');
md.push('', 'SERVICES per source: `sample-100-<source>.csv` and `all-<source>.csv`.',
  'CREATORS: `sample-100-CREATORS.csv`, `all-CREATORS.csv`, `CREATORS-SUMMARY.csv`.', '',
  '`QUALITY-SUMMARY.csv` holds the services numbers as data.');
// Every diagnostic goes in the artifact. If a source reads zero, the reason is on the
// page next to it — never a bare zero the reader has to interpret.
md.push('', '## Connection diagnostics', '', '```', ...diag, '```');
const totalRows = summary.reduce((a, s2) => a + s2.leads, 0);
if (totalRows === 0) {
  md.splice(4, 0, '> **THIS EXPORT READ NOTHING.** Every source returned 0 rows. See Connection diagnostics at the bottom — the database is not empty, the export could not read it.', '');
}
fs.writeFileSync('audit/QUALITY-SUMMARY.md', md.join('\n') + '\n');
console.log('\nwrote audit/QUALITY-SUMMARY.md + per-source CSVs');
