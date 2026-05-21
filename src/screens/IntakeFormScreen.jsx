// Fallback structured intake form. Reached either from the "Use form" link
// in the Cergio chat header or the "Switch to form" banner that surfaces
// when Claude flags switch_to_form=true. Optionally prefills from the
// chat's existing state so the user doesn't redo work.
import { useState } from 'react';
import { useNavigate, useLocation, useOutletContext } from 'react-router-dom';
import { AddressAutocomplete } from '../components/ui/AddressAutocomplete';

const CATEGORY_OPTIONS = [
  'Cleaning', 'Handyman', 'TV Mounting', 'Furniture Assembly', 'Installation',
  'Personal Training', 'Yoga', 'Pilates', 'Massage',
  'Hair', 'Makeup', 'Nail Art', 'Beauty',
  'Catering', 'Cooking', 'Bartending',
  'Photography', 'Videography', 'Event Coordination', 'Wedding Bundle',
  'Tutoring', 'Music Lessons',
  'Gardening', 'Lawn Care', 'Painting', 'Moving',
  'Pet Care', 'Dog Walking', 'Childcare',
];

export function IntakeFormScreen() {
  const navigate  = useNavigate();
  const location  = useLocation();
  const { chat }  = useOutletContext();
  const prefill   = location.state?.prefill ?? {};

  const [what,       setWhat]       = useState(prefill.what  ?? '');
  const [when,       setWhen]       = useState(prefill.when  ?? '');
  const [flexible,   setFlexible]   = useState(prefill.flexible_time === true);
  const [where,      setWhere]      = useState(prefill.where ?? '');
  const [coords,     setCoords]     = useState(null);
  const [budget,     setBudget]     = useState(prefill.budget  ?? '');
  const [details,    setDetails]    = useState(prefill.details ?? '');

  const mandatoryOk = what.trim() && when.trim() && where.trim();

  const submit = () => {
    if (!mandatoryOk) return;
    // Push everything we have through one chat turn so /results inherits
    // the same `chat.state` shape it expects.
    const composed = [
      `Service: ${what.trim()}`,
      `When: ${when.trim()}${flexible ? ' (flexible)' : ''}`,
      `Where: ${where.trim()}`,
      budget.trim()  ? `Budget: ${budget.trim()}`     : null,
      details.trim() ? `Details: ${details.trim()}`   : null,
    ].filter(Boolean).join(' · ');
    chat.send(composed);
    // Hand off to results immediately — useChat will update state in
    // the background, ResultsScreen reads whatever's there.
    navigate('/results', { state: { fromForm: true } });
  };

  return (
    <div className="flex-1 flex flex-col bg-cr overflow-y-auto pb-32">
      <div className="px-5 pt-5 flex items-center justify-between">
        <button
          onClick={() => navigate(-1)}
          className="text-[20px] text-b3 bg-transparent border-none cursor-pointer px-1"
        >
          ←
        </button>
        <p className="text-[14px] font-extrabold text-black">Tell us about your request</p>
        <div className="w-8" />
      </div>

      <div className="px-5 pt-6 flex flex-col gap-5">
        <Field label="What service do you need?" required>
          <input
            list="cergio-categories"
            value={what}
            onChange={e => setWhat(e.target.value)}
            placeholder="e.g. Cleaning"
            className="w-full bg-bg5 rounded-[14px] px-4 py-3.5 text-[14px] text-black
                       placeholder-b3 outline-none focus:ring-2 focus:ring-g/30"
          />
          <datalist id="cergio-categories">
            {CATEGORY_OPTIONS.map(c => <option key={c} value={c} />)}
          </datalist>
        </Field>

        <Field label="When do you need this done?" required>
          <input
            value={when}
            onChange={e => setWhen(e.target.value)}
            placeholder="e.g. Monday 2pm, or 'any evening next week'"
            className="w-full bg-bg5 rounded-[14px] px-4 py-3.5 text-[14px] text-black
                       placeholder-b3 outline-none focus:ring-2 focus:ring-g/30"
          />
          <label className="inline-flex items-center gap-2 mt-2 text-[12px] text-b2 font-medium">
            <input
              type="checkbox"
              checked={flexible}
              onChange={e => setFlexible(e.target.checked)}
              className="accent-g"
            />
            I'm flexible on the exact time
          </label>
        </Field>

        <Field label="Where should the provider come to?" required>
          <AddressAutocomplete
            value={where}
            onChange={setWhere}
            onSelect={({ lat, lng, address }) => { setCoords({ lat, lng }); setWhere(address); }}
            placeholder="Enter address or area"
          />
        </Field>

        <Field label="Maximum budget" hint="Optional — leave blank for open">
          <input
            value={budget}
            onChange={e => setBudget(e.target.value)}
            placeholder="e.g. $200"
            className="w-full bg-bg5 rounded-[14px] px-4 py-3.5 text-[14px] text-black
                       placeholder-b3 outline-none focus:ring-2 focus:ring-g/30"
          />
        </Field>

        <Field label="Additional details" hint="Optional — helps providers quote accurately">
          <textarea
            value={details}
            onChange={e => setDetails(e.target.value)}
            rows={3}
            placeholder="e.g. 2 bedroom apartment, post-party, have pets"
            className="w-full bg-bg5 rounded-[14px] px-4 py-3.5 text-[14px] text-black
                       placeholder-b3 outline-none focus:ring-2 focus:ring-g/30 resize-none font-sans"
          />
        </Field>

        <Field label="Photos / videos" hint="Optional — coming soon">
          <button
            type="button"
            className="w-full bg-bg5 rounded-[14px] px-4 py-3.5 text-[13px] text-b3 font-bold"
            disabled
          >
            📷 Add photos / videos
          </button>
        </Field>
      </div>

      <div className="fixed bottom-0 left-1/2 -translate-x-1/2 w-full max-w-[390px]
                      bg-white border-t border-bdr px-5 py-4">
        <button
          onClick={submit}
          disabled={!mandatoryOk}
          className={`w-full rounded-[24px] py-4 text-[15px] font-extrabold transition-all
                      ${mandatoryOk
                        ? 'bg-g text-white hover:opacity-90 active:scale-[.97]'
                        : 'bg-bg5 text-b3 cursor-not-allowed'}`}
        >
          Show me providers →
        </button>
      </div>
    </div>
  );
}

function Field({ label, hint, required, children }) {
  return (
    <div>
      <label className="block text-[14px] font-extrabold text-black mb-1.5">
        {label}{required && <span className="text-[#A32D2D] ml-1">*</span>}
      </label>
      {hint && <p className="text-[11px] text-b3 mb-2">{hint}</p>}
      {children}
    </div>
  );
}
