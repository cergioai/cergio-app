// Per design-spec.md — additional offerings (after the first one).
// Has a Hourly/Session toggle and a Description field. Footer is
// "Delete offering" / "Add" instead of "Back" / "Next".
import { useState } from 'react';
import { useNavigate, useOutletContext } from 'react-router-dom';
// TaxonomyMatchBadge removed — taxonomy resolves silently for routing.
import { useTaxonomyResolve } from '../hooks/useTaxonomyResolve';

const DURATION_UNITS = ['minutes', 'hours', 'days'];

const UNIT_TO_MIN = { minutes: 1, hours: 60, days: 60 * 24 };

export function ServiceListAddNewOfferingScreen() {
  const navigate = useNavigate();
  const { showToast, addOffering } = useOutletContext();
  const [mode, setMode] = useState('hourly'); // 'hourly' | 'session'

  const [title, setTitle]         = useState('');
  const [hourlyPrice, setHourly]  = useState('');
  const [sessionPrice, setSP]     = useState('');
  const [duration, setDur]        = useState('');
  const [unit, setUnit]           = useState('minutes');
  const [desc, setDesc]           = useState('');
  const [override, setOverride]   = useState(false);

  // Resolve the offering title (+ optional description) against the
  // taxonomy. We feed both fields so descriptions like "fix drains"
  // can rescue a sparse title like "Plumbing".
  const resolveInput = [title, desc].filter(s => s.trim()).join(' — ');
  const { resolving, result, resolveNow } = useTaxonomyResolve(resolveInput);

  const valid = mode === 'hourly'
    ? title.trim() && hourlyPrice.trim() && desc.trim()
    : title.trim() && sessionPrice.trim() && duration.trim() && desc.trim();

  return (
    <div className="flex-1 flex flex-col bg-cr">
      {/* header — no back chevron, just title + sub */}
      <div className="bg-gradient-to-b from-gm to-g px-7 pt-12 pb-12 flex flex-col justify-end min-h-[260px]">
        <h1 className="text-display-2 font-extrabold text-white leading-tight">Add new offering</h1>
        <p className="text-body text-white/85 mt-2">List an hourly or session-based offering</p>
      </div>

      {/* sheet */}
      <div className="bg-cr rounded-t-[28px] -mt-7 px-7 pt-7 flex-1 pb-32 overflow-y-auto">

        {/* segmented toggle */}
        <div className="bg-bg5 rounded-pill p-1 flex mb-6">
          {['hourly', 'session'].map(m => (
            <button
              key={m}
              onClick={() => setMode(m)}
              className={`flex-1 rounded-pill py-3 text-[15px] font-extrabold capitalize transition-all
                ${mode === m
                  ? 'bg-white text-black shadow-card'
                  : 'bg-transparent text-black/70'}`}
            >
              {m}
            </button>
          ))}
        </div>

        <Field label="Title" placeholder="Pilates Session, Haircut, etc."
               value={title} onChange={v => { setTitle(v); setOverride(false); }} />
        {/* Match badge hidden — provider's typed title is the source
            of truth. Taxonomy resolves silently in the background. */}

        {mode === 'hourly' ? (
          <Field label="Hourly price" placeholder="$ USD"
                 value={hourlyPrice} onChange={setHourly} />
        ) : (
          <>
            <Field label="Session price" placeholder="$ USD"
                   value={sessionPrice} onChange={setSP} />
            <div className="mb-6">
              <label className="block text-heading-2 font-extrabold text-black mb-2.5">Duration</label>
              <div className="flex gap-3">
                <input
                  type="number" inputMode="numeric"
                  value={duration} onChange={e => setDur(e.target.value)}
                  placeholder="30"
                  className="w-1/3 bg-bg5 rounded-[14px] px-4 py-4 text-body text-black
                             placeholder-b3 outline-none focus:ring-2 focus:ring-g/30"
                />
                <div className="relative flex-1">
                  <select
                    value={unit} onChange={e => setUnit(e.target.value)}
                    className="w-full appearance-none bg-bg5 rounded-[14px] px-4 py-4 pr-10 text-body
                               text-black outline-none focus:ring-2 focus:ring-g/30 font-sans"
                  >
                    {DURATION_UNITS.map(u => <option key={u} value={u}>{u}</option>)}
                  </select>
                  <span className="absolute right-4 top-1/2 -translate-y-1/2 text-black pointer-events-none">▾</span>
                </div>
              </div>
            </div>
          </>
        )}

        <div className="mb-6">
          <label className="block text-heading-2 font-extrabold text-black mb-2.5">Description</label>
          <textarea
            value={desc} onChange={e => setDesc(e.target.value)}
            placeholder="What can users expect from this offering?" rows={4}
            className="w-full bg-bg5 rounded-[14px] px-4 py-4 text-body text-black
                       placeholder-b3 outline-none focus:ring-2 focus:ring-g/30 resize-none font-sans"
          />
        </div>
      </div>

      {/* progress */}
      <div className="fixed bottom-[68px] left-1/2 -translate-x-1/2 w-full max-w-[390px] h-[3px] bg-bdr">
        <div className="h-full bg-g" style={{ width: '50%' }} />
      </div>

      {/* footer — Delete / Add */}
      <div className="fixed bottom-0 left-1/2 -translate-x-1/2 w-full max-w-[390px]
                      bg-cr px-5 py-4 flex items-center justify-between">
        <button
          onClick={() => { showToast('Offering deleted'); navigate(-1); }}
          className="text-[15px] font-extrabold text-black underline underline-offset-2"
        >
          Delete offering
        </button>
        <button
          onClick={async () => {
            if (!valid) return;
            const taxo = result ?? await resolveNow();
            const useTaxo = !override && taxo?.ok;
            const base = mode === 'hourly'
              ? { name: title.trim(), kind: 'hourly',  price: hourlyPrice.trim(),
                  description: desc.trim() }
              : { name: title.trim(), kind: 'session', price: sessionPrice.trim(),
                  description: desc.trim(),
                  durationMinutes: (parseInt(duration, 10) || 0) * (UNIT_TO_MIN[unit] || 1) };
            addOffering({
              ...base,
              taxonomy_offering_id: useTaxo ? (taxo.offering_id || null) : null,
              taxonomy_override:    !useTaxo,
            });
            navigate('/list-service/more-offerings');
          }}
          disabled={!valid}
          className={`rounded-[24px] px-10 py-3.5 text-[15px] font-extrabold transition-all
            ${valid
              ? 'bg-g text-white hover:opacity-90 active:scale-[.97]'
              : 'bg-bg5 text-b3 cursor-not-allowed'}`}
        >
          Add
        </button>
      </div>
    </div>
  );
}

function Field({ label, placeholder, value, onChange }) {
  return (
    <div className="mb-6">
      <label className="block text-heading-2 font-extrabold text-black mb-2.5">{label}</label>
      <input
        type="text" value={value} onChange={e => onChange(e.target.value)}
        placeholder={placeholder}
        className="w-full bg-bg5 rounded-[14px] px-4 py-4 text-body text-black
                   placeholder-b3 outline-none focus:ring-2 focus:ring-g/30"
      />
    </div>
  );
}
