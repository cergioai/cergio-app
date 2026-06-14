// Fallback structured intake form. Reached either from the "Use form" link
// in the Cergio chat header or the "Switch to form" banner that surfaces
// when Claude flags switch_to_form=true. Optionally prefills from the
// chat's existing state so the user doesn't redo work.
import { useState } from 'react';
import { useNavigate, useLocation, useOutletContext } from 'react-router-dom';
import { AddressAutocomplete } from '../components/ui/AddressAutocomplete';
import { AddressLabelPrompt } from '../components/ui/AddressLabelPrompt';

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
  const {
    chat, auth, showToast, defaultAddress, refreshDefaultAddress,
  } = useOutletContext();
  const prefill   = location.state?.prefill ?? {};

  const [what,       setWhat]       = useState(prefill.what  ?? '');
  const [date,       setDate]       = useState(prefill.date  ?? '');
  const [time,       setTime]       = useState(prefill.time  ?? '');
  const [flexible,   setFlexible]   = useState(prefill.flexible_time === true);
  const [where,      setWhere]      = useState(prefill.where ?? defaultAddress?.formatted_address ?? '');
  const [coords,     setCoords]     = useState(null);
  const [placeId,    setPlaceId]    = useState(null);
  const [budget,     setBudget]     = useState(prefill.budget  ?? '');
  const [details,    setDetails]    = useState(prefill.details ?? '');
  const [savePrompt, setSavePrompt] = useState(null);
  const [pendingNav, setPendingNav] = useState(false);

  // A specific start time is required UNLESS the user is flexible (then the
  // provider picks the time on the request screen).
  const mandatoryOk = what.trim() && where.trim() && date.trim() && (flexible || time.trim());

  // Compose the chat turn and head to /results.
  const finishSubmit = () => {
    const whenLabel = (() => {
      const d = date.trim() ? new Date(`${date}T${time || '00:00'}`) : null;
      const dateLabel = d ? d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' }) : '';
      if (flexible) return `${dateLabel} (flexible time)`;
      const timeLabel = time ? new Date(`2000-01-01T${time}`).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }) : '';
      return `${dateLabel}${timeLabel ? ` at ${timeLabel}` : ''}`;
    })();
    const composed = [
      `Service: ${what.trim()}`,
      `When: ${whenLabel}`,
      `Where: ${where.trim()}`,
      budget.trim()  ? `Budget: ${budget.trim()}`     : null,
      details.trim() ? `Details: ${details.trim()}`   : null,
    ].filter(Boolean).join(' · ');
    chat.send(composed);
    navigate('/results', { state: { fromForm: true } });
  };

  const submit = async () => {
    if (!mandatoryOk) return;
    setPendingNav(true);
    try {
      // Skip the validate+prompt step when not signed in OR when the
      // address matches the user's default already.
      if (!auth?.isSignedIn) { finishSubmit(); return; }
      if (defaultAddress?.formatted_address &&
          where.trim().toLowerCase() === defaultAddress.formatted_address.toLowerCase()) {
        finishSubmit(); return;
      }

      // Geocode + dedup check.
      const { geocodeAddress } = await import('../lib/google');
      const g = coords && placeId
        ? { lat: coords.lat, lng: coords.lng, formatted: where.trim(), placeId }
        : await geocodeAddress(where.trim());
      if (!g) {
        showToast("Couldn't verify that address. Try a more specific one?");
        setPendingNav(false);
        return;
      }
      const { listMyAddresses } = await import('../lib/api');
      const { data: saved } = await listMyAddresses();
      if (saved?.some(a => a.place_id && a.place_id === g.placeId)) {
        finishSubmit();
        return;
      }

      // New address — show label prompt, defer submit until user picks or skips.
      setSavePrompt({
        formatted: g.formatted, lat: g.lat, lng: g.lng, placeId: g.placeId,
      });
    } finally {
      setPendingNav(false);
    }
  };

  const onSaveLabel = async (label) => {
    if (!savePrompt) return;
    const { saveAddress } = await import('../lib/api');
    const { data, error } = await saveAddress({
      label,
      formattedAddress: savePrompt.formatted,
      lat: savePrompt.lat,
      lng: savePrompt.lng,
      placeId: savePrompt.placeId,
    });
    if (error) showToast(`Couldn't save: ${error.message}`);
    else {
      showToast(`Saved as ${label}`);
      if (data?.is_default) await refreshDefaultAddress();
    }
    setSavePrompt(null);
    finishSubmit();
  };

  const onSkipLabel = () => {
    setSavePrompt(null);
    finishSubmit();
  };

  return (
    <div className="flex-1 flex flex-col bg-cr overflow-y-auto pb-32">
      <div className="px-5 pt-5 flex items-center justify-between">
        <button
          onClick={() => navigate(-1)}
          className="text-heading-1 text-b3 bg-transparent border-none cursor-pointer px-1"
        >
          ←
        </button>
        <p className="text-body font-extrabold text-black">Tell us about your request</p>
        <div className="w-8" />
      </div>

      <div className="px-5 pt-6 flex flex-col gap-5">
        <Field label="What service do you need?" required>
          <input
            list="cergio-categories"
            value={what}
            onChange={e => setWhat(e.target.value)}
            placeholder="e.g. Cleaning"
            className="w-full bg-bg5 rounded-[14px] px-4 py-3.5 text-body text-black
                       placeholder-b3 outline-none focus:ring-2 focus:ring-g/30"
          />
          <datalist id="cergio-categories">
            {CATEGORY_OPTIONS.map(c => <option key={c} value={c} />)}
          </datalist>
        </Field>

        <Field label="When do you need this done?" required>
          <div className="flex gap-2">
            <input
              type="date"
              value={date}
              onChange={e => setDate(e.target.value)}
              className="flex-1 min-w-0 bg-bg5 rounded-[14px] px-4 py-3.5 text-body text-black
                         outline-none focus:ring-2 focus:ring-g/30"
            />
            {!flexible && (
              <input
                type="time"
                value={time}
                onChange={e => setTime(e.target.value)}
                className="flex-1 min-w-0 bg-bg5 rounded-[14px] px-4 py-3.5 text-body text-black
                           outline-none focus:ring-2 focus:ring-g/30"
              />
            )}
          </div>
          <label className="inline-flex items-center gap-2 mt-2 text-meta text-b2 font-medium">
            <input
              type="checkbox"
              checked={flexible}
              onChange={e => setFlexible(e.target.checked)}
              className="accent-g"
            />
            I'm flexible on the exact time — the provider picks it
          </label>
        </Field>

        <Field label="Where should the provider come to?" required>
          <AddressAutocomplete
            value={where}
            onChange={setWhere}
            onSelect={({ lat, lng, address, placeId: pid }) => {
              setCoords({ lat, lng });
              setPlaceId(pid ?? null);
              setWhere(address);
            }}
            placeholder="Enter address or area"
          />
          {defaultAddress && where !== defaultAddress.formatted_address && (
            <button
              type="button"
              onClick={() => setWhere(defaultAddress.formatted_address)}
              className="text-meta-sm text-g font-extrabold underline underline-offset-2 mt-1.5"
            >
              📍 Use {defaultAddress.label || 'saved address'}
            </button>
          )}
        </Field>

        <Field label="Maximum budget" hint="Optional — leave blank for open">
          <input
            value={budget}
            onChange={e => setBudget(e.target.value)}
            placeholder="e.g. $200"
            className="w-full bg-bg5 rounded-[14px] px-4 py-3.5 text-body text-black
                       placeholder-b3 outline-none focus:ring-2 focus:ring-g/30"
          />
        </Field>

        <Field label="Additional details" hint="Optional — helps providers quote accurately">
          <textarea
            value={details}
            onChange={e => setDetails(e.target.value)}
            rows={3}
            placeholder="e.g. 2 bedroom apartment, post-party, have pets"
            className="w-full bg-bg5 rounded-[14px] px-4 py-3.5 text-body text-black
                       placeholder-b3 outline-none focus:ring-2 focus:ring-g/30 resize-none font-sans"
          />
        </Field>

        {/* CERGIO-GUARD: removed the disabled 'Photos / videos — coming
            soon' field per CRITICAL_FLOWS.md #7. A disabled button with
            a future-tense hint is a worse signal than no field. Photo
            attachment lands when ServiceListAddOfferingScreen-style
            uploadServiceCover is wired into the request flow — until
            then, the chat captures details well enough on its own. */}
      </div>

      <div className="fixed bottom-0 left-1/2 -translate-x-1/2 w-full max-w-[390px]
                      bg-white border-t border-bdr px-5 py-4">
        <button
          onClick={submit}
          disabled={!mandatoryOk || pendingNav}
          className={`w-full rounded-[24px] py-4 text-body-lg font-extrabold transition-all
                      ${mandatoryOk && !pendingNav
                        ? 'bg-g text-white hover:opacity-90 active:scale-[.97]'
                        : 'bg-bg5 text-b3 cursor-not-allowed'}`}
        >
          {pendingNav ? 'Verifying…' : 'Show me providers →'}
        </button>
      </div>

      {savePrompt && (
        <AddressLabelPrompt
          formattedAddress={savePrompt.formatted}
          defaultLabel={defaultAddress ? 'Office' : 'Home'}
          onSave={onSaveLabel}
          onSkip={onSkipLabel}
        />
      )}
    </div>
  );
}

function Field({ label, hint, required, children }) {
  return (
    <div>
      <label className="block text-body font-extrabold text-black mb-1.5">
        {label}{required && <span className="text-danger ml-1">*</span>}
      </label>
      {hint && <p className="text-meta-sm text-b3 mb-2">{hint}</p>}
      {children}
    </div>
  );
}
