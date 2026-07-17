// P2P SMS tap-to-send queue (SPEC-84) — /ops/sms
//
// The compliant "notify many providers fast" surface: Cergio builds a ranked list
// + personalizes each message; a HUMAN (founder or a $4/hr VA) taps "Send" one at a
// time from their OWN phone via an sms: deep link. Genuine person-to-person, so NO
// A2P/10DLC and NO prior opt-in required. The app NEVER auto-sends (that is A2P).
// Two modes: personal (warm cold 1:1 to hand-picked) | optin (invite + reply YES + STOP).
// Founder/admin only in practice: leads_* are admin-scoped by RLS, so a non-admin
// session simply loads an empty queue.
import { useEffect, useMemo, useState, useCallback } from 'react';
import { useOutletContext } from 'react-router-dom';
import { listOutreachRecipients, getOutreachFilterOptions } from '../lib/api';
import { smsTemplateFor, renderMergeFields, buildSmsLink } from '../lib/outreachCopy';

const AUDIENCES = [
  { id: 'services', label: 'Services' },
  { id: 'creators', label: 'Creators' },
];
const MODES = [
  { id: 'personal', label: 'Personal (cold)' },
  { id: 'optin', label: 'Opt-in invite' },
];

export function P2pSmsQueueScreen() {
  const ctx = useOutletContext?.() || {};
  const showToast = ctx.showToast || (() => {});

  const [audience, setAudience] = useState('services');
  const [mode, setMode]         = useState('personal');
  const [city, setCity]         = useState('');
  const [niche, setNiche]       = useState('');
  const [limit, setLimit]       = useState(50);
  const [options, setOptions]   = useState({ cities: [], niches: [] });

  const [rows, setRows]     = useState([]);
  const [i, setI]           = useState(0);
  const [sent, setSent]     = useState({});
  const [skipped, setSkipped] = useState({});
  const [loading, setLoading] = useState(false);
  const [err, setErr]       = useState(null);
  const [editBody, setEditBody] = useState('');

  useEffect(() => {
    let alive = true;
    getOutreachFilterOptions(audience).then(({ data }) => {
      if (alive && data) setOptions({ cities: data.cities || [], niches: data.niches || [] });
    }).catch(() => {});
    return () => { alive = false; };
  }, [audience]);

  const filters = useMemo(() => {
    const f = {};
    if (city.trim()) f.city = city.trim();
    if (niche.trim()) f[audience === 'services' ? 'serviceType' : 'niche'] = niche.trim();
    return f;
  }, [audience, city, niche]);

  const load = useCallback(async () => {
    setLoading(true); setErr(null);
    const { data, error } = await listOutreachRecipients(audience, filters, limit);
    setLoading(false);
    if (error) { setErr(error.message || 'Could not load recipients'); return; }
    setRows(data || []); setI(0); setSent({}); setSkipped({});
    if (!data?.length) setErr('No recipients with a phone match those filters.');
  }, [audience, filters, limit]);

  const current = rows[i] || null;

  useEffect(() => {
    if (!current) { setEditBody(''); return; }
    setEditBody(renderMergeFields(smsTemplateFor(audience, mode), current));
  }, [current, audience, mode]);

  const advance = () => setI(n => Math.min(n + 1, rows.length));
  const markSent = () => { setSent(s => ({ ...s, [i]: true })); advance(); };
  const skip     = () => { setSkipped(s => ({ ...s, [i]: true })); advance(); };

  const doneCount = Object.keys(sent).length;
  const smsHref = current ? buildSmsLink(current.phone, editBody) : '#';
  const finished = rows.length > 0 && i >= rows.length;

  return (
    <div className="max-w-xl mx-auto px-4 py-6">
      <h1 className="text-xl font-extrabold text-black">Tap-to-send · P2P SMS</h1>
      <p className="text-meta-sm text-b3 mt-1 leading-snug">
        You send each text from your own phone — genuine person-to-person, no opt-in needed.
        The app never auto-sends. Tap <b>Send</b>, hit send in Messages, come back, <b>Next</b>.
      </p>

      <div className="mt-4 grid grid-cols-2 gap-2">
        <div className="col-span-2 flex gap-2">
          {AUDIENCES.map(a => (
            <button key={a.id} onClick={() => setAudience(a.id)}
              className={`flex-1 rounded-xl py-2 text-meta-sm font-bold ${audience === a.id ? 'bg-g text-white' : 'bg-bg5 text-b3'}`}>
              {a.label}
            </button>
          ))}
        </div>
        <div className="col-span-2 flex gap-2">
          {MODES.map(m => (
            <button key={m.id} onClick={() => setMode(m.id)}
              className={`flex-1 rounded-xl py-2 text-meta-sm font-bold ${mode === m.id ? 'bg-black text-white' : 'bg-bg5 text-b3'}`}>
              {m.label}
            </button>
          ))}
        </div>
        <input list="cg-cities" value={city} onChange={e => setCity(e.target.value)} placeholder="City (optional)"
          className="bg-bg5 rounded-xl px-3 py-2 text-body outline-none" />
        <input list="cg-niches" value={niche} onChange={e => setNiche(e.target.value)}
          placeholder={audience === 'services' ? 'Service type (optional)' : 'Niche (optional)'}
          className="bg-bg5 rounded-xl px-3 py-2 text-body outline-none" />
        <datalist id="cg-cities">{options.cities.map(c => <option key={c} value={c} />)}</datalist>
        <datalist id="cg-niches">{options.niches.map(n => <option key={n} value={n} />)}</datalist>
        <select value={limit} onChange={e => setLimit(Number(e.target.value))}
          className="bg-bg5 rounded-xl px-3 py-2 text-body outline-none">
          {[20, 50, 100, 200].map(n => <option key={n} value={n}>{n} max</option>)}
        </select>
        <button onClick={load} disabled={loading}
          className="rounded-xl py-2 bg-g text-white font-bold disabled:opacity-50">
          {loading ? 'Loading…' : 'Load queue'}
        </button>
      </div>

      {err && <p className="mt-3 text-meta-sm text-danger">{err}</p>}

      {rows.length > 0 && (
        <div className="mt-5">
          <div className="flex justify-between text-meta-sm text-b3 mb-1">
            <span>{finished ? 'Done' : `#${i + 1} of ${rows.length}`}</span>
            <span>{doneCount} sent · {Object.keys(skipped).length} skipped</span>
          </div>
          <div className="h-1.5 bg-bg5 rounded-full overflow-hidden">
            <div className="h-full bg-g transition-all" style={{ width: `${(Math.min(i, rows.length) / rows.length) * 100}%` }} />
          </div>
        </div>
      )}

      {current && !finished && (
        <div className="mt-4 rounded-2xl border border-bg5 p-4">
          <div className="flex items-baseline justify-between">
            <div className="font-extrabold text-black">{current.name || '(no name)'}</div>
            <div className="text-meta-sm text-b3">{current.city}</div>
          </div>
          <div className="text-meta-sm text-b3">
            {audience === 'services' ? current.service_type : (current.ig_handle ? '@' + current.ig_handle : current.service_type)}
            {' · '}{current.phone}
          </div>
          <textarea value={editBody} onChange={e => setEditBody(e.target.value)} rows={5}
            className="mt-3 w-full bg-bg5 rounded-xl p-3 text-body outline-none focus:ring-2 focus:ring-g/30" />
          <div className="mt-2 text-meta-sm text-b3">{editBody.length} chars · ~{Math.ceil(editBody.length / 153) || 1} segment(s)</div>
          <div className="mt-3 flex gap-2">
            <a href={smsHref} onClick={() => setTimeout(markSent, 350)}
              className="flex-1 text-center rounded-xl py-3 bg-g text-white font-extrabold">
              Send text →
            </a>
            <button onClick={skip} className="rounded-xl px-5 py-3 bg-bg5 text-b3 font-bold">Skip</button>
          </div>
          <p className="mt-2 text-[11px] text-b3 leading-snug">
            Opens your Messages app pre-filled. Send it there, then come back — this marks it sent and advances.
          </p>
        </div>
      )}

      {finished && (
        <div className="mt-6 rounded-2xl border border-bg5 p-5 text-center">
          <div className="text-lg font-extrabold text-black">Queue complete 🎉</div>
          <p className="text-meta-sm text-b3 mt-1">{doneCount} sent · {Object.keys(skipped).length} skipped</p>
          <button onClick={() => { setI(0); setSent({}); setSkipped({}); }}
            className="mt-3 rounded-xl px-5 py-2 bg-bg5 text-b3 font-bold">Restart</button>
        </div>
      )}
    </div>
  );
}

export default P2pSmsQueueScreen;
