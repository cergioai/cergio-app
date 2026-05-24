// Per design-spec.md — step 2 of Connector reg, fields vary by type.
import { useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';

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
  location:     { label: 'Your location', placeholder: 'Add your address',       type: 'input' },
  bio:          { label: 'Bio',           placeholder: '',                        type: 'textarea' },
};

function Field({ name, value, onChange, hint }) {
  const meta = FIELD_META[name];
  const placeholder = name === 'bio' ? hint : meta.placeholder;

  return (
    <div className="mb-6">
      <label className="block text-[18px] font-extrabold text-black mb-2.5">
        {meta.label}
      </label>
      {meta.type === 'textarea' ? (
        <textarea
          value={value}
          onChange={e => onChange(name, e.target.value)}
          placeholder={placeholder}
          rows={4}
          className="w-full bg-bg5 rounded-[14px] px-4 py-4 text-[14px] text-black
                     placeholder-b3 outline-none focus:ring-2 focus:ring-g/30
                     resize-none font-sans"
        />
      ) : (
        <input
          type="text"
          value={value}
          onChange={e => onChange(name, e.target.value)}
          placeholder={placeholder}
          className="w-full bg-bg5 rounded-[14px] px-4 py-4 text-[14px] text-black
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

  const handleChange = (name, val) => setValues(v => ({ ...v, [name]: val }));

  // Required: every visible field has at least 1 char
  const allFilled = config.fields.every(f => values[f].trim().length > 0);

  const next = () => {
    if (!allFilled) return;
    navigate(`/rainmaker/apply/instagram?type=${type}`);
  };

  return (
    <div className="flex-1 flex flex-col bg-cr">
      {/* green header */}
      <div className="bg-gradient-to-b from-gm to-g px-7 pt-12 pb-14 flex flex-col justify-end min-h-[260px]">
        <h1 className="text-[28px] font-extrabold text-white leading-tight">
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
