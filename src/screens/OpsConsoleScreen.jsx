// Ops & Growth Console — OUTREACH module (increment 1: BUILD, no send).
//
// Founder/admin-only in-product console for building an outreach audience and
// composing a campaign against the SAME real lead tables + founding copy the
// outreach-send edge function uses. This increment does NOT send anything — the
// Send button is intentionally disabled ("dry-run + gated send — increment 2").
//
// Auth: reuses the app's admin gate (isAdminEmail), exactly like AdminCrawlScreen.
// Data: countOutreachAudience / sampleOutreachRecipient / getOutreachFilterOptions
//       — all queued-only (sendable) reads; honest empty states, no mock data.
// Style: design-spec tokens only (g/gd/gl/cr/line/b3/black + the named type scale).
import { useEffect, useMemo, useState, useCallback } from 'react';
import { supabase } from '../lib/supabase';
import {
  isAdminEmail,
  countOutreachAudience,
  sampleOutreachRecipient,
  getOutreachFilterOptions,
} from '../lib/api';
import { outreachTemplateFor, renderMergeFields } from '../lib/outreachCopy';

const AUDIENCES = [
  { id: 'creators', label: 'Creators', table: 'leads_influencers', nicheLabel: 'Niche' },
  { id: 'services', label: 'Services', table: 'leads_services', nicheLabel: 'Service type' },
];

const FOLLOWER_PRESETS = [
  { id: 'any',   label: 'Any reach',   min: null,   max: null },
  { id: 'micro', label: '5K–25K',      min: 5000,   max: 25000 },
  { id: 'mid',   label: '25K–75K',     min: 25000,  max: 75000 },
  { id: 'macro', label: '75K–150K',    min: 75000,  max: 150000 },
];

function useDebounced(value, ms = 350) {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

export function OpsConsoleScreen() {
  const [email, setEmail] = useState(null);
  const [authChecked, setAuthChecked] = useState(false);

  useEffect(() => {
    (async () => {
      const { data } = await supabase?.auth?.getUser?.() ?? { data: null };
      setEmail(data?.user?.email || '');
      setAuthChecked(true);
    })();
  }, []);

  // ── Audience state ─────────────────────────────────────────────────────────
  const [audience, setAudience] = useState('creators');
  const [city, setCity] = useState('');
  const [niche, setNiche] = useState('');
  const [hasInstagram, setHasInstagram] = useState(false);
  const [followerPreset, setFollowerPreset] = useState('any');

  const [options, setOptions] = useState({ cities: [], niches: [] });
  const [optionsLoading, setOptionsLoading] = useState(false);

  const [count, setCount] = useState(null);
  const [countErr, setCountErr] = useState(null);
  const [counting, setCounting] = useState(false);

  const [sample, setSample] = useState(null);
  const [sampleErr, setSampleErr] = useState(null);

  const audMeta = AUDIENCES.find(a => a.id === audience) || AUDIENCES[0];
  const preset  = FOLLOWER_PRESETS.find(p => p.id === followerPreset) || FOLLOWER_PRESETS[0];

  const filters = useMemo(() => {
    const f = {};
    if (city.trim())  f.city = city.trim();
    if (niche.trim()) f[audience === 'services' ? 'serviceType' : 'niche'] = niche.trim();
    if (hasInstagram) f.hasInstagram = true;
    if (audience === 'creators') {
      if (Number.isFinite(preset.min)) f.minFollowers = preset.min;
      if (Number.isFinite(preset.max)) f.maxFollowers = preset.max;
    }
    return f;
  }, [audience, city, niche, hasInstagram, preset]);

  const dCity  = useDebounced(city);
  const dNiche = useDebounced(niche);

  // Reset niche/reach when the audience flips (they mean different things).
  const switchAudience = useCallback((id) => {
    setAudience(id);
    setNiche('');
    setFollowerPreset('any');
    setHasInstagram(false);
  }, []);

  // Load real filter options for the current audience.
  useEffect(() => {
    let live = true;
    setOptionsLoading(true);
    getOutreachFilterOptions(audience).then(({ data }) => {
      if (!live) return;
      setOptions(data || { cities: [], niches: [] });
      setOptionsLoading(false);
    });
    return () => { live = false; };
  }, [audience]);

  // Live count + sample recipient whenever filters change (debounced text).
  useEffect(() => {
    let live = true;
    setCounting(true);
    setCountErr(null);
    setSampleErr(null);
    const f = {
      ...filters,
      city: dCity.trim() || undefined,
      [audience === 'services' ? 'serviceType' : 'niche']: dNiche.trim() || undefined,
    };
    Promise.all([
      countOutreachAudience(audience, f),
      sampleOutreachRecipient(audience, f),
    ]).then(([c, s]) => {
      if (!live) return;
      if (c.error) setCountErr(c.error.message || 'Count failed');
      setCount(c.data?.count ?? 0);
      if (s.error) setSampleErr(s.error.message || 'Sample failed');
      setSample(s.data || null);
      setCounting(false);
    });
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [audience, dCity, dNiche, hasInstagram, followerPreset]);

  // ── Composer state (pre-filled from the real founding copy) ────────────────
  const template = outreachTemplateFor(audience);
  const [subject, setSubject]   = useState(template.subject);
  const [body, setBody]         = useState(template.body);
  const [whatsapp, setWhatsapp] = useState(template.whatsapp);

  // Re-seed the composer with the audience's canonical copy when audience flips.
  useEffect(() => {
    const t = outreachTemplateFor(audience);
    setSubject(t.subject);
    setBody(t.body);
    setWhatsapp(t.whatsapp);
  }, [audience]);

  const previewSubject  = renderMergeFields(subject, sample || {});
  const previewBody     = renderMergeFields(body, sample || {});
  const previewWhatsapp = renderMergeFields(whatsapp, sample || {});

  // ── Gates ──────────────────────────────────────────────────────────────────
  if (!authChecked) {
    return <Shell><p className="text-b3 text-body">Loading…</p></Shell>;
  }
  if (!isAdminEmail(email)) {
    return (
      <Shell>
        <div className="rounded-[16px] border border-line bg-white p-5 text-center">
          <p className="text-heading-2 text-black">Founders only</p>
          <p className="mt-2 text-body-sm text-b3">
            The Ops &amp; Growth Console is restricted to Cergio admins. You're signed in as{' '}
            <span className="text-black">{email || 'a signed-out user'}</span>.
          </p>
        </div>
      </Shell>
    );
  }

  return (
    <Shell>
      {/* Console header + tabs */}
      <div className="flex items-baseline justify-between">
        <h1 className="text-heading-1 text-black">Ops &amp; Growth</h1>
        <span className="text-meta text-b3">Founder console</span>
      </div>
      <div className="mt-4 flex gap-2">
        <span className="rounded-pill bg-g px-4 py-2 text-body-sm font-bold text-white">Outreach</span>
        <span className="rounded-pill bg-gl px-4 py-2 text-body-sm font-bold text-gd/50" title="More modules coming">More soon</span>
      </div>

      {/* ── AUDIENCE BUILDER ──────────────────────────────────────────────── */}
      <section className="mt-8">
        <h2 className="text-heading-2 text-black">Audience builder</h2>
        <p className="mt-1 text-body-sm text-b3">
          Filter sendable leads from the live pipeline. Only <b className="text-black">queued</b> (sendable) rows are counted —
          the same rule the sender uses.
        </p>

        {/* Audience toggle */}
        <div className="mt-4 flex gap-2">
          {AUDIENCES.map(a => (
            <button
              key={a.id}
              onClick={() => switchAudience(a.id)}
              className={`rounded-pill px-4 py-2 text-body-sm font-bold transition-colors ${
                audience === a.id ? 'bg-g text-white' : 'bg-gl text-gd'
              }`}
            >
              {a.label}
            </button>
          ))}
        </div>

        {/* Filters */}
        <div className="mt-4 space-y-4">
          <Field label="City">
            <TextWithList
              value={city} onChange={setCity} listId="ops-cities"
              options={options.cities} placeholder="Any city"
            />
          </Field>

          <Field label={audMeta.nicheLabel}>
            <TextWithList
              value={niche} onChange={setNiche} listId="ops-niches"
              options={options.niches}
              placeholder={audience === 'services' ? 'Any service type' : 'Any niche'}
            />
          </Field>

          {audience === 'creators' && (
            <Field label="Follower range">
              <div className="flex flex-wrap gap-2">
                {FOLLOWER_PRESETS.map(p => (
                  <button
                    key={p.id}
                    onClick={() => setFollowerPreset(p.id)}
                    className={`rounded-pill px-3 py-1.5 text-meta-sm font-semibold transition-colors ${
                      followerPreset === p.id ? 'bg-g text-white' : 'bg-bg5 text-b2'
                    }`}
                  >
                    {p.label}
                  </button>
                ))}
              </div>
            </Field>
          )}

          <label className="flex items-center gap-3">
            <input
              type="checkbox"
              checked={hasInstagram}
              onChange={e => setHasInstagram(e.target.checked)}
              className="h-4 w-4 accent-g"
            />
            <span className="text-body text-black">
              Has Instagram
              {audience === 'creators' && <span className="text-b3"> (creators always do)</span>}
            </span>
          </label>
        </div>

        {optionsLoading && options.cities.length === 0 && (
          <p className="mt-3 text-meta text-b3">Loading real filter values…</p>
        )}

        {/* LIVE COUNT */}
        <div className="mt-5 rounded-[16px] border border-line bg-white p-5">
          {countErr ? (
            <p className="text-body-sm text-danger">Couldn't load count: {countErr}</p>
          ) : count === 0 && !counting ? (
            <>
              <p className="text-display-2 font-black text-black">0</p>
              <p className="mt-1 text-body-sm text-b3">
                No sendable {audMeta.label.toLowerCase()} match these filters yet. Widen the filters, or
                let the pipeline source + queue more leads. (This is real data — nothing is faked.)
              </p>
            </>
          ) : (
            <>
              <p className="text-display-2 font-black text-g">
                {counting ? '…' : count?.toLocaleString?.() ?? count}
              </p>
              <p className="mt-1 text-body-sm text-b3">
                sendable {audMeta.label.toLowerCase()} match — queued in <span className="text-black">{audMeta.table}</span>.
              </p>
            </>
          )}
        </div>
      </section>

      {/* ── CAMPAIGN COMPOSER ─────────────────────────────────────────────── */}
      <section className="mt-8">
        <h2 className="text-heading-2 text-black">Campaign composer</h2>
        <p className="mt-1 text-body-sm text-b3">
          Pre-filled with the founding {audMeta.label.toLowerCase()} copy from the sender.
          Merge fields: <code className="text-black">{'{name}'}</code> <code className="text-black">{'{city}'}</code>{' '}
          <code className="text-black">{'{service_type}'}</code>{' '}
          {audience === 'creators' && <code className="text-black">{'{ig_handle}'}</code>}
        </p>

        <div className="mt-4 space-y-4">
          <Field label="Email subject">
            <input
              value={subject} onChange={e => setSubject(e.target.value)}
              className="w-full rounded-[12px] border border-line bg-white px-3 py-2.5 text-body text-black focus:border-g focus:outline-none"
            />
          </Field>
          <Field label="Email body">
            <textarea
              value={body} onChange={e => setBody(e.target.value)} rows={11}
              className="w-full resize-y rounded-[12px] border border-line bg-white px-3 py-2.5 text-body text-black leading-relaxed focus:border-g focus:outline-none"
            />
          </Field>
          <Field label="WhatsApp text">
            <textarea
              value={whatsapp} onChange={e => setWhatsapp(e.target.value)} rows={4}
              className="w-full resize-y rounded-[12px] border border-line bg-white px-3 py-2.5 text-body text-black leading-relaxed focus:border-g focus:outline-none"
            />
          </Field>
        </div>

        {/* LIVE PREVIEW against one real sampled recipient */}
        <div className="mt-5">
          <h3 className="text-body font-extrabold text-black">Live preview</h3>
          {sampleErr ? (
            <p className="mt-2 text-body-sm text-danger">Couldn't load a sample recipient: {sampleErr}</p>
          ) : !sample ? (
            <div className="mt-2 rounded-[16px] border border-line bg-soft p-4">
              <p className="text-body-sm text-b3">
                No sendable recipient matches the current filters, so there's no real recipient to preview
                against. Adjust the audience above — the preview fills in from the first live match. (No
                fake sample is ever shown.)
              </p>
            </div>
          ) : (
            <>
              <p className="mt-2 text-meta text-b3">
                Rendered against a real matched {audMeta.label.slice(0, -1).toLowerCase()}:{' '}
                <span className="text-black">
                  {sample.ig_handle ? '@' + sample.ig_handle : (sample.name || '—')}
                </span>
                {sample.city ? ` · ${sample.city}` : ''}
                {sample.service_type ? ` · ${sample.service_type}` : ''}
                {Number.isFinite(sample.followers) ? ` · ${sample.followers.toLocaleString()} followers` : ''}
                {sample._channel ? ` · via ${sample._channel}` : ''}
              </p>

              <div className="mt-3 overflow-hidden rounded-[16px] border border-line bg-white">
                <div className="border-b border-line px-4 py-3">
                  <p className="text-caps text-b3">Subject</p>
                  <p className="mt-0.5 text-body font-extrabold text-black">{previewSubject}</p>
                </div>
                <div className="px-4 py-3">
                  <p className="text-caps text-b3">Email body</p>
                  <p className="mt-1 whitespace-pre-wrap text-body text-b2 leading-relaxed">{previewBody}</p>
                </div>
                <div className="border-t border-line bg-gl/40 px-4 py-3">
                  <p className="text-caps text-gd">WhatsApp</p>
                  <p className="mt-1 whitespace-pre-wrap text-body text-b2 leading-relaxed">{previewWhatsapp}</p>
                </div>
              </div>
            </>
          )}
        </div>

        {/* GATED SEND — disabled in increment 1 */}
        <div className="mt-6 rounded-[16px] border border-line bg-soft p-4">
          <button
            type="button"
            disabled
            aria-disabled="true"
            title="Sending is built in the next increment behind a dry-run + gate"
            className="w-full cursor-not-allowed rounded-[24px] bg-bg5 py-4 text-body font-extrabold text-b3"
          >
            dry-run + gated send — increment 2
          </button>
          <p className="mt-2 text-center text-meta text-b3">
            Sending is intentionally not wired in this increment. The next increment adds a required dry-run
            preview + a safety gate before any real message goes out.
          </p>
        </div>
      </section>
    </Shell>
  );
}

// ── Layout primitives (design-spec tokens) ───────────────────────────────────
function Shell({ children }) {
  return (
    <div className="min-h-screen bg-cr">
      <div className="mx-auto max-w-[720px] px-5 py-6">{children}</div>
    </div>
  );
}

function Field({ label, children }) {
  return (
    <div>
      <p className="mb-1.5 text-caps text-b3">{label}</p>
      {children}
    </div>
  );
}

// Text input backed by a real <datalist> of pipeline values (free-typing still
// allowed — the list is a convenience, not a constraint).
function TextWithList({ value, onChange, options = [], listId, placeholder }) {
  return (
    <>
      <input
        value={value}
        onChange={e => onChange(e.target.value)}
        list={options.length ? listId : undefined}
        placeholder={placeholder}
        className="w-full rounded-[12px] border border-line bg-white px-3 py-2.5 text-body text-black focus:border-g focus:outline-none"
      />
      {options.length > 0 && (
        <datalist id={listId}>
          {options.map(o => <option key={o} value={o} />)}
        </datalist>
      )}
    </>
  );
}

export default OpsConsoleScreen;
