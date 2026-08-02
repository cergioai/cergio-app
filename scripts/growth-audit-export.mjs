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

const SOURCES = ['osm', 'craigslist', 'yellowpages_apify', 'yelp',
                 'google_lsa', 'google_sponsored', 'gmaps_apify', 'ig_services'];
const COLS = 'id,name,service_type,phone,owner_email,website_url,instagram,address,city,state,lat,lon,data_source,outreach_status,fetched_at';

fs.mkdirSync('audit', { recursive: true });

const csv = (rows, cols) => [cols.join(','),
  ...rows.map((r) => cols.map((c) => {
    const v = r[c] == null ? '' : String(r[c]);
    return /[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
  }).join(','))].join('\n');

async function get(url) {
  const r = await fetch(url, { headers: H });
  if (!r.ok) { console.error(`  ${r.status} ${(await r.text()).slice(0, 120)}`); return []; }
  return r.json();
}

const summary = [];
for (const src of SOURCES) {
  // newest first — "since reset" means the most recent output, not the oldest
  const sample = await get(`${URL_G}/rest/v1/leads_services?select=${COLS}&data_source=eq.${src}&order=fetched_at.desc&limit=100`);
  fs.writeFileSync(`audit/sample-100-${src}.csv`, csv(sample, COLS.split(',')));

  let all = [], from = 0;
  for (;;) {
    const page = await get(`${URL_G}/rest/v1/leads_services?select=${COLS}&data_source=eq.${src}&order=fetched_at.desc&offset=${from}&limit=1000`);
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
md.push('', '## Files', '', 'Per source: `sample-100-<source>.csv` (newest 100, for eyeballing) and `all-<source>.csv` (everything).', '', '`QUALITY-SUMMARY.csv` holds these numbers as data.');
fs.writeFileSync('audit/QUALITY-SUMMARY.md', md.join('\n') + '\n');
console.log('\nwrote audit/QUALITY-SUMMARY.md + per-source CSVs');
