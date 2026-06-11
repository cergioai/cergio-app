// Per design-spec.md — step 2 of Connector reg, fields vary by type.
// `location` field now uses Google Places AddressAutocomplete so the
// address is real and we can geocode it for proximity matching.
import { useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { AddressAutocomplete } from '../components/ui/AddressAutocomplete';

// Field configuration per type
const TYPE_CONFIG = {
  'influencer': {
    title: 'Tell us about yourself',
    fields: ['industry', 'location', 'bio'],
    bioHint: 'Add a quick bio about yourself, your occupation, and your niche categories.',
    progress: 0.4,
  },
  'local-business': {
    title: 'Tell us about your business',
    fields: ['businessName', 'industry', 'location', 'bio'],
    bioHint: 'Add a quick bio about yourself, your business or services, and the customers you serve.',
    progress: 0.5,
  },
  'super-user': {
    title: 'Tell us about yourself',
    fields: ['location', 'bio'],
    bioHint: 'Add a quick bio about yourself and the kind of services you love to recommend.',
    progress: 0.4,
  },
};

const FIELD_META = {
  businessName: { label: 'Business name', placeholder: 'Enter business entity', type: 'input' },
  industry:     { label: 'Industry',      placeholder: 'Select an industry',     type: 'input' },
  location:     { label: 'Your location', placeholder: 'Start typing your address…', type: 'address' },
  bio:          { label: 'Bio',           placeholder: '',                        type: 'textarea' },
};

function Field({ name, value, onChange, onAddressSelect, hint }) {
  const meta = FIELD_META[name];
  const placeholder = name === 'bio' ? hint : meta.placeholder;

  return (
    <div className="mb-6">
      <label className="block text-body-lg font-extrabold text-black mb-2">
        {meta.label}
      </label>
      {meta.type === 'textarea' ? (
        <textarea
          value={value}
          onChange={e => onChange(name, e.target.value)}
          placeholder={placeholder}
          rows={4}
          className="w-full bg-bg5 rounded-[14px] px-4 py-4 text-body text-black
                     placeholder-b3 outline-none focus:ring-2 focus:ring-g/30
                     resize-none font-sans"
        />
      ) : meta.type === 'address' ? (
        // Google Places autocomplete — picks resolve to lat/lng so the
        // address is geocoded at sign-up rather than later. Falls back to
        // a plain input gracefully if the Maps script fails to load.
        <AddressAutocomplete
          value={value}
          onChange={(v) => onChange(name, v)}
          onSelect={({ address, lat, lng }) => {
            onChange(name, address);
            onAddressSelect && onAddressSelect({ address, lat, lng });
          }}
          placeholder={placeholder}
        />
      ) : (
        <input
          type="text"
          value={value}
          onChange={e => onChange(name, e.target.value)}
          placeholder={placeholder}
          className="w-full bg-bg5 rounded-[14px] px-4 py-4 text-body text-black
                     placeholder-b3 outline-none focus:ring-2 focus:ring-g/30"
        />
      )}
    </div>
  );
}

export function RainmakerDetailsScreen() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const type = params.get('type') || 'influencer';
  const config = TYPE_CONFIG[type] || TYPE_CONFIG['influencer'];

  const [values, setValues] = useState(
    Object.fromEntries(config.fields.map(f => [f, '']))
  );
  // Keep the picked address's lat/lng around so the next step (or the
  // submit handler) can persist coords alongside the typed address string.
  // Stored as a side-cache; not surfaced in `values` to avoid breaking
  // the existing `allFilled` validation.
  const [addressCoords, setAddressCoords] = useState(null);

  const handleChange = (name, val) => setValues(v => ({ ...v, [name]: val }));

  // Required: every visible field has at least 1 char
  const allFilled = config.fields.every(f => values[f].trim().length > 0);

  const next = () => {
    if (!allFilled) return;
    // Forward the typed values + geocoded coords to the next step so the
    // final submit handler can save a complete location record.
    navigate(`/rainmaker/apply/instagram?type=${type}`, {
      state: { details: { ...values, coords: addressCoords } },
    });
  };

  return (
    <div className="flex-1 flex flex-col bg-cr">
      {/* green header */}
      <div className="bg-gradient-to-b from-gm to-g px-7 pt-12 pb-14 flex flex-col justify-end min-h-[260px]">
        <h1 className="text-display-2 font-extrabold text-white leading-tight">
          {config.title}
        </h1>
      </div>

      {/* sheet */}
      <div className="bg-cr rounded-t-[28px] -mt-7 px-7 pt-7 flex-1 pb-32 overflow-y-auto">
        {config.fields.map(f => (
          <Field
            key={f}
            name={f}
            value={values[f]}
            onChange={handleChange}
            onAddressSelect={({ lat, lng }) => setAddressCoords({ lat, lng })}
            hint={config.bioHint}
          />
        ))}
      </div>

      {/* progress bar — thin green line */}
      <div className="fixed bottom-[68px] left-1/2 -translate-x-1/2 w-full max-w-[390px] h-[3px] bg-bdr">
        <div className="h-full bg-g" style={{ width: `${config.progress * 100}%` }} />
      </div>

      {/* footer */}
      <div className="fixed bottom-0 left-1/2 -translate-x-1/2 w-full max-w-[390px]
                      bg-cr px-5 py-4 flex items-center justify-between">
        <button
          onClick={() => navigate(-1)}
          className="text-[15px] font-extrabold text-black underline underline-offset-2"
        >
          Back
        </button>
        <button
          onClick={next}
          disabled={!allFilled}
          className={`rounded-[24px] px-10 py-3.5 text-[15px] font-extrabold transition-all
            ${allFilled
              ? 'bg-g text-white hover:opacity-90 active:scale-[.97]'
              : 'bg-bg5 text-b3 cursor-not-allowed'}`}
        >
          Next
        </button>
      </div>
    </div>
  );
}
