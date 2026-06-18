// Read-only diagnostic: why does a profile show "N recos made" but an empty
// Go-Tos section? Inspects a profile's authored recommendations and whether
// each resolves to a listed service. No writes. (Tarik 2026-06-17)
import fs from 'node:fs';
import path from 'node:path';

const REPO = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const env = Object.fromEntries(
  fs.readFileSync(path.join(REPO, '.env.local'), 'utf8')
    .split('\n').filter(l => l.includes('=') && !l.trim().startsWith('#'))
    .map(l => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^["']|["']$/g, '')]; })
);
const URL_ = env.VITE_SUPABASE_URL;
const KEY = env.SUPABASE_SERVICE_ROLE_KEY || env.VITE_SUPABASE_ANON_KEY;
const T = process.argv[2] || '19d989cd-f537-4db1-9980-de5e17347314';
const h = { apikey: KEY, Authorization: `Bearer ${KEY}` };
const q = async (p) => { const r = await fetch(`${URL_}/rest/v1/${p}`, { headers: h }); return r.json(); };

const recs = await q(`recommendations?recommender_id=eq.${T}&select=id,service_id,recipient_id,recipient_phone,message,sent_at`);
console.log(`\n=== Profile ${T} ===`);
console.log(`Recommendations MADE (raw count → what "recos made" shows): ${Array.isArray(recs) ? recs.length : JSON.stringify(recs)}`);
if (!Array.isArray(recs)) process.exit(0);

const withSvc = recs.filter(r => r.service_id);
const noSvc = recs.filter(r => !r.service_id);
console.log(`  • with a service_id:    ${withSvc.length}`);
console.log(`  • WITHOUT a service_id: ${noSvc.length}  (free-text / person recos — can't render in service-based Go-Tos)`);

const svcIds = [...new Set(withSvc.map(r => r.service_id))];
let resolved = [];
if (svcIds.length) {
  const svcs = await q(`services?id=in.(${svcIds.join(',')})&select=id,title,status,owner_id`);
  resolved = Array.isArray(svcs) ? svcs : [];
  const foundIds = new Set(resolved.map(s => s.id));
  const orphaned = svcIds.filter(id => !foundIds.has(id));
  console.log(`\n  service_ids referenced: ${svcIds.length}`);
  console.log(`  • resolve to a service row: ${resolved.length}`);
  console.log(`    statuses: ${JSON.stringify(resolved.map(s => s.status))}`);
  console.log(`  • ORPHANED (no service row — deleted): ${orphaned.length} ${JSON.stringify(orphaned)}`);
}

// What the profile's Go-Tos actually renders: recos whose service resolves
// (PublicProfileScreen fetches services by id with NO status filter, so
// listed AND unlisted resolve; only truly-missing rows drop out).
const renderable = withSvc.filter(r => resolved.some(s => s.id === r.service_id)).length;
console.log(`\n=== Go-Tos would render: ${renderable} of ${recs.length} ===`);
console.log(`(gap = ${recs.length - renderable}: ${noSvc.length} service-less + ${recs.length - renderable - noSvc.length} orphaned)\n`);
