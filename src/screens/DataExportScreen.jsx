// Data dashboard — /ops/data. Live, admin-gated. Reads leads-dashboard (service role,
// past RLS) against the GROWTH database.
//
// SPEC-223 — rewritten for legibility after the founder said "filters not respecting
// view... formats are not legible... numbers run into each other". Three real defects,
// not styling taste:
//   1. Switching class KEPT the previous class's filters. Picking "parked" on the crawl
//      queue and then clicking Services sent status=parked against leads_services, which
//      has no such status, so it returned nothing and looked like broken data.
//   2. Source options came from the UNFILTERED source list, so a source with zero rows
//      under the current city was still offered and could only ever return empty.
//   3. Counts sat in a tight grid with proportional digits, so 21552 and 15796 ran into
//      each other and could not be read at a glance.
//
// SPEC-260 — SOURCES FIRST, RESULTS ON DEMAND (founder, 2026-08-05, verbatim: "creators
// have junk removal.. need to see a list of results accross SOURCES like in the table
// shared above.. to quickly scan sources.. (ahead of actual results.. i don't need to
// see results unless i download them or ask to load them on the screen).. redesign the
// filters so they're far easier to view more intuitive less bulky.."). Three changes:
//   1. The per-source SCAN TABLE (the SPEC-249 board data) is the PRIMARY, always-visible
//      view — SPEC-258's collapsed "Source status" toggle is superseded; the board data
//      IS the table now. One compact SourceRow per source, per-source CSV on the row.
//   2. The LeadRow list renders ONLY after an explicit "Load results" click. This is
//      RENDER-deferred, not fetch-deferred: the server computes
//      `limit = Math.min(Number(body.limit || 1000), 25000)`, so a limit of 0 is falsy
//      and silently becomes 1000 — "fetch nothing" is not a request it understands — and
//      the CSV must download WITHOUT the list on screen, which needs the rows
//      client-side anyway. The fetch keeps `limit: size` (gate #258's pin) untouched.
//   3. Legacy creator rows — the pre-SPEC-257 deviation rows whose category is a
//      services term like "junk removal" — are excluded from the Creators view by
//      default. Kept in the DB by founder order (data is data); hidden on screen, with
//      an honest opt-in under More filters. Every CSV path applies the same exclusion.
import { useEffect, useMemo, useState, useCallback } from 'react';
import { leadsDashboard } from '../lib/api';

// Four DIFFERENT CLASSES of data, not four filters on one pile: different tables,
// different origin columns (data_source vs discovered_via vs source), different fields.
// SPEC-260: Services | Creators are the segmented primary pair; the crawl queue and
// agent runs stay selectable (gate #210) as quiet secondary pills.
const AUDIENCES = [
  { id: 'services', label: 'Services' },
  { id: 'creators', label: 'Creators' },
  { id: 'crawls', label: 'Crawl queue' },
  { id: 'runs', label: 'Agent runs' },
];
const STATUSES = {
  services: ['new', 'pending_review', 'queued', 'opted_in', 'do_not_contact'],
  creators: ['new', 'pending_review', 'queued', 'opted_in', 'do_not_contact'],
  crawls: ['new', 'crawling', 'delivered', 'failed', 'parked'],
  runs: [],
};
// SPEC-226 (founder, 2026-08-02): "cities are DMA's only.. what you have under cities is
// locations.. which should be a sub filter of city, alongside service type or category".
//
// CITY = the DMA (NYC, Miami). LOCATION = the neighbourhood inside it (Manhattan,
// Brooklyn, Wynwood). They are different database columns — `state` and `city` — which is
// why one control trying to mean both made Miami appear to vanish. The column named
// `city` holds LOCATIONS, not cities; that mismatch is the whole confusion.
// SPEC-244 (founder, 2026-08-03): the City filter carries a Nielsen DMA code, not a
// state — "THE DMA is technically held by it's own DMA definition (that's unrelated to
// state)". 501 = New York (includes Jersey City/Newark NJ and CT areas), 528 =
// Miami-Ft. Lauderdale. The backend also accepts legacy 'NY'/'FL' from older screens.
// SPEC-260: short pill labels (the full DMA name lives in the tooltip) — compact filters.
const CITIES = [
  { id: '', label: 'All', title: 'All DMAs' },
  { id: '501', label: 'NYC', title: 'New York (DMA 501)' },
  { id: '528', label: 'Miami', title: 'Miami-Ft. Lauderdale (DMA 528)' },
];
// SPEC-229 (founder, 2026-08-02): "time filter (last 6 hours, 12 hours, 24 hours, 2 days,
// 3 days, 7 days, 2 weeks, 4 weeks) alongside last 100, 500, 1000, then increments up to
// 25000 or all".
//
// TIME and SIZE are separate questions: "what arrived since yesterday" and "give me the
// newest 500" are different asks and were being answered by one control. Two controls now,
// combined — last 7 days AND the newest 1000 of them is a legitimate query.
const TIMES = [
  { h: 0, label: 'All time' }, { h: 6, label: '6h' }, { h: 12, label: '12h' }, { h: 24, label: '24h' },
  { h: 48, label: '2d' }, { h: 72, label: '3d' }, { h: 168, label: '7d' }, { h: 336, label: '2w' }, { h: 672, label: '4w' },
];
const SIZES = [100, 500, 1000, 5000, 10000, 25000];

// SPEC-260 — the 12 committed creator category slugs, WELDED by gate #260 to
// CREATOR_CATEGORIES in supabase/functions/_shared/opsPayload.ts (this JSX cannot import
// a Deno module, so this copy exists and the gate keeps the two lists identical). A
// creator row is NEW-SPEC iff its category is one of these; anything else is a
// pre-category legacy row ("junk removal" creators — the exact founder complaint).
const CREATOR_SLUGS = [
  'pets', 'parenting', 'fitness', 'home', 'beauty', 'local city life',
  'food', 'wellness', 'style', 'photography', 'events', 'neighbourhood accounts',
];
const isNewSpecCreator = (r) => CREATOR_SLUGS.includes(String(r.category || '').trim());

function toCsv(rows) {
  if (!rows || !rows.length) return '';
  const keys = [];
  for (const r of rows) for (const k of Object.keys(r)) if (!keys.includes(k)) keys.push(k);
  const esc = (v) => { if (v == null) return ''; const s = typeof v === 'object' ? JSON.stringify(v) : String(v); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
  return keys.join(',') + '\n' + rows.map((r) => keys.map((k) => esc(r[k])).join(',')).join('\n');
}
function saveCsv(csv, filename) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8;' }));
  a.download = filename; document.body.appendChild(a); a.click(); a.remove();
}
const n = (v) => (v == null ? '—' : Number(v).toLocaleString());
// SPEC-261 — THE TRUST WELD (founder defect report, 2026-08-05, verbatim: "IG scraper
// download had 1 record.. shoed 100 in download with 10% phone.. how can we trust the
// dashboard"). Every CSV path compares what it actually delivers against what the
// count promised — min(filteredTotal, rowCap). A shortfall is SAID, in both numbers,
// never silently saved: a file that quietly contradicts the number on screen is how
// trust in a dashboard dies.
const csvMismatch = (got, total, cap) => {
  const expect = Math.min(Number(total ?? 0), Number(cap ?? got));
  if (!(got < expect)) return null;
  return `CSV has ${got.toLocaleString()} rows; the count says ${expect.toLocaleString()} — mismatch, do not trust this export`;
};

// ── SPEC-258 — the results list itself is unchanged (LeadRow, bestLink chain, new-tab
// links); SPEC-260 only moves WHEN it renders (behind "Load results").

// A row's best link, first available. Services rows carry website_url / instagram /
// listing urls; creator rows carry external_url / ig_handle. No link = not clickable.
function bestLink(r) {
  const ig = r.instagram || r.ig_handle;
  return r.website_url || r.external_url
    || (ig ? `https://instagram.com/${String(ig).replace(/^@/, '')}` : null)
    || r.yelp_url || r.cl_post_url || null;
}
// Relative time, because "2h ago" answers "is this fresh?" faster than an ISO stamp.
function timeAgo(ts) {
  if (!ts) return null;
  const s = (Date.now() - new Date(ts).getTime()) / 1000;
  if (!Number.isFinite(s)) return null;
  if (s < 3600) return `${Math.max(1, Math.round(s / 60))}m ago`;
  if (s < 86400) return `${Math.round(s / 3600)}h ago`;
  return `${Math.round(s / 86400)}d ago`;
}
// One lead per row, phone-friendly: big touch target, single column, zebra. The whole
// row is the tap — a row WITH a link is an <a> to it in a new tab (↗ affordance); a
// row without one is a plain <div>, because a dead-looking click reads as broken.
function LeadRow({ r, audience }) {
  const link = bestLink(r);
  const name = r.name || r.display_name || (r.ig_handle ? `@${r.ig_handle}` : '') || r.agent || r.source || '—';
  const kind = r.service_type || r.category || null;
  const src = r.data_source || r.discovered_via || (audience === 'runs' ? null : r.source);
  const status = audience === 'crawls' || audience === 'runs' ? r.status : null;
  const when = timeAgo(r.fetched_at || r.created_at || r.updated_at);
  const email = r.owner_email || r.email;
  const body = (
    <>
      <div className="flex items-baseline gap-2 min-w-0">
        <span className="text-[15px] font-extrabold text-black truncate">{name}</span>
        {kind && <span className="text-[13px] font-bold text-b2 truncate">{kind}</span>}
        {r.city && <span className="text-[13px] text-b3 truncate">{r.city}</span>}
        <div className="flex-1" />
        {link && <span className="text-[13px] font-bold text-g">↗</span>}
      </div>
      <div className="mt-1 flex items-baseline gap-x-3 gap-y-1 text-[12px] text-b3 flex-wrap">
        {r.phone && <span className="tabular-nums">☎ {r.phone}</span>}
        {email && <span className="truncate max-w-[16rem]">✉ {email}</span>}
        {audience === 'creators' && r.followers != null && <span className="tabular-nums">{Number(r.followers).toLocaleString()} followers</span>}
        {audience === 'crawls' && r.cost_usd != null && <span className="tabular-nums">${r.cost_usd}</span>}
        {audience === 'runs' && r.rows_written != null && <span className="tabular-nums">{Number(r.rows_written).toLocaleString()} rows</span>}
        {status && <span className="font-bold">{status}</span>}
        {audience === 'runs' && r.last_error && <span className="text-red-600 truncate max-w-[18rem]">{String(r.last_error)}</span>}
        {src && <span className="rounded-full bg-bg5 px-2 py-0.5 font-bold text-b2">{src}</span>}
        {when && <span>{when}</span>}
      </div>
    </>
  );
  const cls = 'block w-full px-3 py-3 odd:bg-white even:bg-bg4';
  return link
    ? <a data-lead-row href={link} target="_blank" rel="noopener noreferrer" className={`${cls} hover:bg-gl`}>{body}</a>
    : <div data-lead-row className={cls}>{body}</div>;
}

// SPEC-260 — ONE COMPACT SCANNABLE ROW PER SOURCE (the founder's "table shared above").
// Everything the SPEC-249 board computed, on one line: name · fresh x/target (never
// displayed past the target — the #251 rule; overshoot lives in state_detail, shown as
// the tooltip) · state (failures in danger red) · rows under the CURRENT filters ·
// ☎/✉/both % · queue health · a CSV for exactly this source under these filters.
// A failed count says FAILED, never a confident 0.
function SourceRow({ b, onCsv }) {
  const tone = /FAILED|NO RUNNABLE/.test(b.state) ? 'text-danger'
    : /met/.test(b.state) ? 'text-g'
    : /paused/.test(b.state) ? 'text-warnText' : 'text-b2';
  const pct = (v) => (v === null || v === undefined ? '—' : `${v}%`);
  return (
    <div data-source-row className="px-3 py-2 odd:bg-white even:bg-bg4" title={b.state_detail}>
      <div className="flex items-baseline gap-x-3 gap-y-1 flex-wrap">
        <span className="w-40 truncate text-[13px] font-extrabold text-black">{b.source}</span>
        <span className="text-[11px] text-b3 tabular-nums">fresh {b.fresh === null || b.fresh === undefined ? 'FAILED' : Math.min(b.fresh, b.fresh_target)}/{b.fresh_target}</span>
        <span className={`text-[11px] font-bold uppercase ${tone}`}>{b.state}</span>
        <div className="flex-1" />
        <span className="text-[13px] font-extrabold text-black tabular-nums">{b.filtered === null ? 'FAILED' : b.filtered.toLocaleString()} rows</span>
        <span className="text-[11px] text-b3 tabular-nums">☎ {pct(b.phone_pct)} · ✉ {pct(b.email_pct)} · both {pct(b.both_pct)}</span>
        {b.queue_new !== null && b.queue_new !== undefined && <span className="text-[11px] text-b3 tabular-nums">q {b.queue_new}{b.queue_parked ? <span className="text-danger"> +{b.queue_parked} parked</span> : ''}</span>}
        <button onClick={onCsv} className="rounded-lg bg-g px-2.5 py-1 text-[11px] font-bold text-white">⬇ CSV</button>
      </div>
      {!!(b.errors || []).length && <div className="mt-0.5 text-[10px] text-danger">{b.errors.join(' | ')}</div>}
    </div>
  );
}

// tabular-nums so digits line up in a column and 21,552 beside 15,796 stays readable.
function Stat({ label, value, tone }) {
  return (
    <div className="rounded-xl bg-bg5 px-3 py-2.5">
      <div className="text-[10px] text-b3 font-bold uppercase tracking-wider leading-tight">{label}</div>
      <div className={`mt-1 text-xl font-extrabold tabular-nums leading-none ${tone || 'text-black'}`}>{value}</div>
    </div>
  );
}
function Pill({ on, onClick, title, children }) {
  return (
    <button onClick={onClick} title={title}
      className={`rounded-full px-3.5 py-1.5 text-[13px] font-bold ${on ? 'bg-black text-white' : 'bg-bg5 text-b3'}`}>
      {children}
    </button>
  );
}
// SPEC-260 — a removable chip for one active non-default filter, so the compact bar
// still SHOWS what is applied without a wall of always-visible controls.
function Chip({ onClear, children }) {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full bg-gl px-2.5 py-1 text-[12px] font-bold text-gd2">
      {children}
      <button onClick={onClear} aria-label="remove filter" className="text-[13px] font-extrabold leading-none text-gd2">×</button>
    </span>
  );
}

export function DataExportScreen() {
  const [audience, setAudience] = useState('services');
  const [city, setCity] = useState('');
  const [source, setSource] = useState('');
  const [status, setStatus] = useState('');
  const [locality, setLocality] = useState('');
  const [serviceType, setServiceType] = useState('');
  const [category, setCategory] = useState('');
  const [hours, setHours] = useState(0);
  const [size, setSize] = useState(1000);
  const [reachableOnly, setReachableOnly] = useState(false);
  const [data, setData] = useState(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);
  const [bulk, setBulk] = useState(null);
  // SPEC-260 — results render ON DEMAND: the list appears only after "Load results".
  const [showResults, setShowResults] = useState(false);
  // SPEC-260 — the bulky controls (status/reachable/time/size/legacy) collapse behind
  // one "More filters" disclosure, closed by default.
  const [moreOpen, setMoreOpen] = useState(false);
  // SPEC-260 — legacy pre-category creator rows are hidden by default; this opts in.
  const [showLegacy, setShowLegacy] = useState(false);

  // DEFECT 1. Every filter below the class is scoped TO that class. Carrying them across
  // sent nonsense to the server and returned an empty view that read as broken data.
  // SPEC-260: the legacy opt-in and the loaded list are class-scoped too — switching
  // class returns to the scan-table-first default.
  const pickAudience = (id) => { setAudience(id); setSource(''); setStatus(''); setReachableOnly(false); setLocality(''); setServiceType(''); setCategory(''); setShowLegacy(false); setShowResults(false); };
  // Changing city clears the location: Brooklyn is not a choice once the city is Miami.
  const pickCity = (id) => { setCity(id); setLocality(''); };
  const clearAll = () => { setCity(''); setLocality(''); setSource(''); setStatus(''); setServiceType(''); setCategory(''); setReachableOnly(false); setHours(0); setSize(1000); setShowLegacy(false); };

  const load = useCallback(async () => {
    setBusy(true); setErr(null);
    const { data: d, error } = await leadsDashboard(audience, {
      city: city || null, locality: locality || null, source: source || null, status: status || null,
      serviceType: serviceType || null, category: category || null,
      // SPEC-261 — the legacy exclusion is SERVER-side now: the count query and the
      // rows query must be the SAME query, or the board says 100 while the CSV has 1
      // (the founder defect, verbatim). Condition stated inline: `excludeLegacy` is
      // declared below this callback and naming it here would be the TDZ shape.
      categoriesIn: audience === 'creators' && !showLegacy && !category ? CREATOR_SLUGS : null,
      contactableOnly: reachableOnly, sinceHours: hours, limit: size,
    });
    setBusy(false);
    if (error) { setErr(error.message || 'Load failed'); setData(null); return; }
    if (d?.error) { setErr(d.error); setData(null); return; }
    setData(d);
  }, [audience, city, locality, source, status, serviceType, category, reachableOnly, hours, size, showLegacy]);
  useEffect(() => { load(); }, [load]);

  // DEFECT 2. Only offer sources that actually have rows. An option that can only ever
  // return nothing is a trap, not a filter.
  const sources = useMemo(
    () => Object.entries(data?.bySource || {}).filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1]),
    [data],
  );
  // SPEC-260 — LEGACY CREATOR ROWS OUT OF THE DEFAULT VIEW. An explicitly picked
  // category is an explicit ask, so it is never second-guessed. Rows stay in the DB —
  // this is display only (founder: data is data).
  // SPEC-261 — the exclusion moved SERVER-side (categoriesIn on every fetch above and
  // below): a client-side filter over a ROW_CAP page made the rows a DIFFERENT
  // population than the server counts — board said 100, CSV had 1 (founder: "how can
  // we trust the dashboard"). The client filter below stays as a belt-and-braces no-op
  // guarding a stale CREATOR_SLUGS copy.
  const allRows = data?.rows || [];
  const excludeLegacy = audience === 'creators' && !showLegacy && !category;
  const rows = excludeLegacy ? allRows.filter(isNewSpecCreator) : allRows;
  const legacyHidden = allRows.length - rows.length;
  const isLead = data?.isLeadTable;
  const filtered = !!(city || locality || source || status || serviceType || category || reachableOnly || hours > 0 || showLegacy);

  const download = () => {
    // `rows` is the VISIBLE set — the CSV obeys the legacy exclusion by construction.
    if (!rows.length) { setErr('Nothing to download for this filter.'); return; }
    // SPEC-261 — the export never claims more than it delivers: a shortfall against
    // the promised count is named in both numbers, and the filename carries the row
    // count as its own receipt.
    const warn = csvMismatch(rows.length, data?.filteredTotal, data?.rowCap);
    if (warn) setErr(warn);
    saveCsv(toCsv(rows), ['Cergio', audience, city, locality, source, serviceType, category, status, reachableOnly ? 'reachable' : '', hours ? hours + 'h' : ''].filter(Boolean).join(' ') + ` (${rows.length} rows).csv`);
  };
  // SPEC-249 — a source row's download is THAT source under the CURRENT filters
  // (city/location/type/time/size), not the whole pile. SPEC-260: same legacy exclusion
  // as the screen — what you see is what downloads.
  const downloadSource = async (src) => {
    const { data: d2, error } = await leadsDashboard(audience, {
      city: city || null, locality: locality || null, source: src,
      serviceType: serviceType || null, category: category || null,
      // SPEC-261 — server-side legacy exclusion: same query for the count and the rows.
      categoriesIn: excludeLegacy ? CREATOR_SLUGS : null,
      contactableOnly: reachableOnly, sinceHours: hours, limit: size,
    });
    // Belt and braces: the server already excluded legacy rows via categoriesIn; this
    // client filter is a cheap no-op that guards a stale CREATOR_SLUGS copy.
    const srcRows = d2?.rows ? (excludeLegacy ? d2.rows.filter(isNewSpecCreator) : d2.rows) : [];
    if (error || !srcRows.length) { setErr(error?.message || `Nothing to download for ${src} under these filters.`); return; }
    const warn = csvMismatch(srcRows.length, d2?.filteredTotal, d2?.rowCap);
    if (warn) setErr(warn);
    saveCsv(toCsv(srcRows), ['Cergio', audience, src, city, locality, serviceType, category, hours ? hours + 'h' : '', 'last' + size].filter(Boolean).join(' ') + ` (${srcRows.length} rows).csv`);
  };
  const downloadEach = async () => {
    const list = sources.map(([s]) => s).filter((s) => s !== '(other/unlabeled)');
    if (!list.length) { setErr('No sources with rows.'); return; }
    setBulk({ done: 0, total: list.length });
    for (let i = 0; i < list.length; i++) {
      // SPEC-261 — categoriesIn: the legacy exclusion rides server-side here too, so
      // this bulk path counts and fetches the same population as every other path.
      const { data: d2, error } = await leadsDashboard(audience, { city: city || null, source: list[i], status: status || null, contactableOnly: reachableOnly, categoriesIn: excludeLegacy ? CREATOR_SLUGS : null });
      const eachRows = !error && d2?.rows ? (excludeLegacy ? d2.rows.filter(isNewSpecCreator) : d2.rows) : [];
      if (eachRows.length) {
        const warn = csvMismatch(eachRows.length, d2?.filteredTotal, d2?.rowCap);
        if (warn) setErr(warn);
        saveCsv(toCsv(eachRows), `Cergio ${audience} ${list[i]} (${eachRows.length} rows).csv`);
      }
      setBulk({ done: i + 1, total: list.length });
    }
    setTimeout(() => setBulk(null), 2000);
  };

  // SPEC-260 — every active non-default filter as a removable chip: the compact bar
  // stays honest about what is applied even with the bulky controls collapsed.
  const chips = [];
  if (city) chips.push({ k: 'city', label: CITIES.find((c) => c.id === city)?.label || city, clear: () => pickCity('') });
  if (locality) chips.push({ k: 'loc', label: locality, clear: () => setLocality('') });
  if (source) chips.push({ k: 'src', label: source, clear: () => setSource('') });
  if (serviceType) chips.push({ k: 'type', label: serviceType, clear: () => setServiceType('') });
  if (category) chips.push({ k: 'cat', label: category, clear: () => setCategory('') });
  if (status) chips.push({ k: 'status', label: status, clear: () => setStatus('') });
  if (reachableOnly) chips.push({ k: 'reach', label: 'reachable only', clear: () => setReachableOnly(false) });
  if (hours > 0) chips.push({ k: 'time', label: TIMES.find((t) => t.h === hours)?.label || `${hours}h`, clear: () => setHours(0) });
  if (size !== 1000) chips.push({ k: 'size', label: `last ${size.toLocaleString()}`, clear: () => setSize(1000) });
  if (audience === 'creators' && showLegacy) chips.push({ k: 'legacy', label: 'legacy rows shown', clear: () => setShowLegacy(false) });

  return (
    <div className="max-w-4xl mx-auto px-4 py-6">
      <h1 className="text-2xl font-extrabold text-black">Data</h1>
      <p className="text-[13px] text-b3 mt-1">Live from the growth database. What you filter is what downloads.</p>

      {/* SPEC-260 — segmented Services | Creators class toggle; crawl queue and agent
          runs stay reachable as quiet pills (#210). */}
      <div className="mt-5 flex flex-wrap items-center gap-2">
        <div data-class-toggle className="inline-flex rounded-xl bg-bg5 p-1">
          {AUDIENCES.slice(0, 2).map((a) => (
            <button key={a.id} onClick={() => pickAudience(a.id)}
              className={`rounded-lg px-4 py-1.5 text-[13px] font-bold ${audience === a.id ? 'bg-white text-black shadow-card' : 'text-b3'}`}>
              {a.label}
            </button>
          ))}
        </div>
        <div className="flex-1" />
        {AUDIENCES.slice(2).map((a) => <Pill key={a.id} on={audience === a.id} onClick={() => pickAudience(a.id)}>{a.label}</Pill>)}
      </div>

      {/* ONE compact filter row: city pills · locality (only once a city is picked) ·
          source · type/category. Everything bulkier lives behind More filters. */}
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <div className="flex gap-1.5">
          {CITIES.map((c) => <Pill key={c.id} on={city === c.id} title={c.title} onClick={() => pickCity(c.id)}>{c.label}</Pill>)}
        </div>
        {!!city && !!(data?.localities || []).length && (
          <select value={locality} onChange={(e) => setLocality(e.target.value)}
            className="rounded-xl bg-bg5 px-3 py-2 text-[13px] font-bold text-black">
            <option value="">All locations</option>
            {data.localities.map((l) => <option key={l} value={l}>{l}</option>)}
          </select>
        )}
        <select value={source} onChange={(e) => setSource(e.target.value)}
          className="max-w-[16rem] rounded-xl bg-bg5 px-3 py-2 text-[13px] font-bold text-black">
          <option value="">All sources</option>
          {sources.map(([s, v]) => {
            const pc = data?.contactBySource?.[s]?.pct;
            return <option key={s} value={s}>{s} ({v.toLocaleString()}{pc != null ? ` · ${pc}% reachable` : ''})</option>;
          })}
        </select>
        {!!(data?.serviceTypes || []).length && (
          <select value={serviceType} onChange={(e) => setServiceType(e.target.value)}
            className="max-w-[13rem] rounded-xl bg-bg5 px-3 py-2 text-[13px] font-bold text-black">
            <option value="">All types</option>
            {data.serviceTypes.map((t) => <option key={t} value={t}>{t}</option>)}
          </select>
        )}
        {!!(data?.categories || []).length && (
          <select value={category} onChange={(e) => setCategory(e.target.value)}
            className="max-w-[13rem] rounded-xl bg-bg5 px-3 py-2 text-[13px] font-bold text-black">
            <option value="">All categories</option>
            {data.categories.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
        )}
        <button onClick={() => setMoreOpen((v) => !v)}
          className="rounded-xl bg-bg5 px-3 py-2 text-[13px] font-bold text-b2">
          More filters {moreOpen ? '▴' : '▾'}
        </button>
      </div>

      {moreOpen && (
        <div className="mt-2 rounded-xl border border-bg5 bg-bg4 p-3 grid gap-3">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-[10px] text-b3 font-bold uppercase tracking-wider">Status</span>
            <select value={status} onChange={(e) => setStatus(e.target.value)} disabled={!STATUSES[audience]?.length}
              className="rounded-xl bg-bg5 px-3 py-2 text-[13px] font-bold text-black disabled:opacity-40">
              <option value="">All statuses</option>
              {(STATUSES[audience] || []).map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
            {isLead && <Pill on={reachableOnly} onClick={() => setReachableOnly((v) => !v)}>Reachable only</Pill>}
          </div>
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="text-[10px] text-b3 font-bold uppercase tracking-wider mr-1">Time</span>
            {TIMES.map((t) => <Pill key={t.h} on={hours === t.h} onClick={() => setHours(t.h)}>{t.label}</Pill>)}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-[10px] text-b3 font-bold uppercase tracking-wider">How many (newest first)</span>
            <select value={size} onChange={(e) => setSize(Number(e.target.value))}
              className="rounded-xl bg-bg5 px-3 py-2 text-[13px] font-bold text-black">
              {SIZES.map((v) => <option key={v} value={v}>Last {v.toLocaleString()}</option>)}
            </select>
          </div>
          {audience === 'creators' && (
            <label className="flex items-start gap-2 text-[13px] font-bold text-b2">
              <input type="checkbox" checked={showLegacy} onChange={(e) => setShowLegacy(e.target.checked)} className="mt-0.5" />
              <span>Show legacy rows from the pre-category run <span className="font-normal text-b3">(category is a services term like "junk removal" — kept in the database, hidden by default)</span></span>
            </label>
          )}
        </div>
      )}

      {!!chips.length && (
        <div className="mt-2 flex flex-wrap items-center gap-1.5">
          {chips.map((c) => <Chip key={c.k} onClear={c.clear}>{c.label}</Chip>)}
          {filtered && <button onClick={clearAll} className="text-[13px] font-bold text-b3 underline">Clear</button>}
        </div>
      )}

      <div className="mt-3 flex flex-wrap gap-2 items-center">
        <div className="flex-1" />
        <button onClick={load} className="rounded-xl bg-bg5 px-3 py-2 text-[13px] font-bold text-b3">↻</button>
        <button onClick={download} className="rounded-xl bg-g px-4 py-2 text-[13px] font-bold text-white">Download view</button>
        <button onClick={downloadEach} disabled={!!bulk}
          className="rounded-xl bg-black px-4 py-2 text-[13px] font-bold text-white disabled:opacity-50">
          {bulk ? `${bulk.done}/${bulk.total}…` : 'Download each source'}
        </button>
      </div>

      {busy && <div className="mt-4 text-[13px] text-b3">Loading…</div>}
      {err && <div className="mt-4 rounded-xl bg-red-50 px-3 py-2 text-[13px] text-red-600">{err}</div>}
      {/* SPEC-261 — the server's honesty bit. False means the rows page does NOT
          deliver everything the count promises: the populations diverged, and the
          founder must see that BEFORE trusting any number or download on this screen. */}
      {data && data.rowsMatchCount === false && (
        <div className="mt-4 rounded-xl bg-red-50 px-3 py-2 text-[13px] text-red-600">
          Rows loaded: {allRows.length.toLocaleString()}; the count says {Math.min(Number(data.filteredTotal ?? 0), Number(data.rowCap ?? 0)).toLocaleString()} — mismatch, do not trust this view or its downloads.
        </div>
      )}

      {data && (
        <>
          <div className="mt-5 grid grid-cols-2 sm:grid-cols-4 gap-2">
            {/* Name the count after the CLASS being viewed. "Leads" was a generic label
                for four different things, so the headline number never said what it was
                counting — services, creators, crawl jobs and agent runs all read "Leads". */}
            <Stat label={AUDIENCES.find((a) => a.id === audience)?.label || audience} value={n(data.total)} />
            {isLead && <Stat label="With phone" value={n(data.withPhone)} />}
            {isLead && <Stat label="With email" value={n(data.withEmail)} />}
            <Stat label="New 24h" value={n(data.growth?.last1d)} />
          </div>

          {/* SPEC-260 — THE SCAN TABLE, FIRST AND ALWAYS. One compact row per source
              from the SPEC-249 board data — "to quickly scan sources.. (ahead of actual
              results". Counts obey every filter above; per-source CSV on the row. */}
          {!!(data.board || []).length && (
            <div className="mt-5 rounded-xl border border-bg5 divide-y divide-bg5 overflow-hidden">
              <div className="px-3 py-2 text-[10px] text-b3 font-bold uppercase tracking-wider">Sources · counts obey the filters above</div>
              {data.board.map((b) => <SourceRow key={b.source} b={b} onCsv={() => downloadSource(b.source)} />)}
            </div>
          )}

          {/* SPEC-260 — RESULTS ON DEMAND: "i don't need to see results unless i
              download them or ask to load them on the screen". The rows are already
              fetched (render-deferred — see the header comment for why); this button
              only reveals them. The CSV buttons above never need the list on screen. */}
          {!showResults && (
            <button onClick={() => setShowResults(true)}
              className="mt-5 w-full rounded-xl bg-black px-4 py-3 text-[14px] font-extrabold text-white">
              Load results ({n(excludeLegacy ? rows.length : data.filteredTotal)})
            </button>
          )}
          {showResults && (
            <>
              {/* SPEC-258 — the straight simple list, unchanged inside. Render is capped
                  at 1,000 rows (25k DOM rows freezes the phone this list is for); the
                  honest note below says so and the download always has everything. */}
              <div className="mt-5 flex items-baseline gap-2 flex-wrap">
                <div className="text-[13px] font-bold text-black tabular-nums">
                  {rows.length.toLocaleString()} rows
                  {excludeLegacy && legacyHidden > 0 && <span className="font-normal text-b3"> · {legacyHidden.toLocaleString()} legacy hidden</span>}
                  {data.filteredTotal > rows.length + legacyHidden && <span className="text-danger"> of {data.filteredTotal.toLocaleString()} (capped)</span>}
                </div>
                <div className="flex-1" />
                <button onClick={() => setShowResults(false)} className="text-[13px] font-bold text-b3 underline">Hide results ▴</button>
              </div>
              {!!rows.length && (
                <div className="mt-2 rounded-xl border border-bg5 divide-y divide-bg5 overflow-hidden">
                  {rows.slice(0, 1000).map((r, i) => <LeadRow key={r.id ?? i} r={r} audience={audience} />)}
                </div>
              )}
              {rows.length > 1000 && <div className="mt-2 text-[11px] text-b3">Showing 1,000 — the download has all {rows.length.toLocaleString()}.</div>}
              {!rows.length && !busy && <div className="mt-2 rounded-xl border border-bg5 px-3 py-4 text-[13px] text-b3">No rows for this filter.</div>}
            </>
          )}
        </>
      )}
    </div>
  );
}
