// Per design-spec.md — "What best describes you?" step 1 of Connector reg.
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';

const TYPES = [
  {
    id: 'influencer',
    title: 'Influencer',
    desc:  'You must have a minimum of 5,000 followers on Instagram.',
    icon: (
      <svg width="40" height="40" viewBox="0 0 48 48" fill="none" stroke="currentColor" strokeWidth="2">
        <circle cx="24" cy="14" r="6" />
        <path d="M24 20v8M16 28h16M12 36h8M28 36h8M16 28v8M32 28v8" />
        <circle cx="12" cy="40" r="3" /><circle cx="20" cy="40" r="3" />
        <circle cx="28" cy="40" r="3" /><circle cx="36" cy="40" r="3" />
      </svg>
    ),
  },
  {
    id: 'local-business',
    title: 'Local business or service',
    desc:  'You must run a business or provide services that engage with your local community (e.g. stores, gyms, pet shops, real-estate, and more).',
    icon: (
      <svg width="40" height="40" viewBox="0 0 48 48" fill="none" stroke="currentColor" strokeWidth="2">
        <circle cx="24" cy="22" r="8" />
        <circle cx="24" cy="22" r="3" />
        <circle cx="10" cy="14" r="3" /><circle cx="38" cy="14" r="3" />
        <circle cx="6"  cy="28" r="3" /><circle cx="42" cy="28" r="3" />
        <circle cx="14" cy="40" r="3" /><circle cx="34" cy="40" r="3" />
      </svg>
    ),
  },
  {
    id: 'super-user',
    title: 'Cergio Super User',
    desc:  'You must have invited 5 new users, who have successfully joined and completed a service within the last 30 days.',
    icon: (
      <svg width="40" height="40" viewBox="0 0 48 48" fill="none" stroke="currentColor" strokeWidth="2">
        <circle cx="18" cy="20" r="6" />
        <circle cx="30" cy="20" r="6" />
        <path d="M24 30c-8 0-14 4-14 10h28c0-6-6-10-14-10z" />
        <path d="M24 14l-2 2 2 2 2-2-2-2z" />
      </svg>
    ),
  },
];

export function RainmakerApplyScreen() {
  const navigate = useNavigate();
  const [selected, setSelected] = useState('influencer');

  return (
    <div className="flex-1 flex flex-col bg-cr">
      {/* green gradient header */}
      <div className="bg-gradient-to-b from-gm to-g px-7 pt-8 pb-12 relative">
        <button
          onClick={() => navigate(-1)}
          className="w-10 h-10 rounded-full bg-white/95 border-none
                     flex items-center justify-center text-black text-base mb-3"
        >
          ‹
        </button>
        <h1 className="text-[28px] font-extrabold text-white leading-tight">
          What best<br />describes you?
        </h1>
      </div>

      {/* sheet */}
      <div className="bg-cr rounded-t-[28px] -mt-7 px-5 pt-7 flex-1 pb-32">
        <p className="text-[18px] font-extrabold text-black mb-5">I am a…</p>

        <div className="flex flex-col gap-3">
          {TYPES.map(t => {
            const active = selected === t.id;
            return (
              <button
                key={t.id}
                onClick={() => setSelected(t.id)}
                className={`w-full text-left p-4 rounded-[18px] border-2 flex items-start gap-4 transition-colors
                  ${active ? 'bg-gl border-g' : 'bg-white border-bdr hover:border-g/40'}`}
              >
                <div className={`w-14 h-14 min-w-14 flex items-center justify-center
                                 ${active ? 'text-gd' : 'text-black'}`}>
                  {t.icon}
                </div>
                <div className="flex-1">
                  <p className="text-[15px] font-extrabold text-black mb-1">{t.title}</p>
                  <p className="text-[13px] text-b3 leading-relaxed">{t.desc}</p>
                </div>
              </button>
            );
          })}
        </div>
      </div>

      {/* footer */}
      <div className="fixed bottom-0 left-1/2 -translate-x-1/2 w-full max-w-[390px]
                      bg-cr border-t border-bdr px-5 py-4 flex justify-end">
        <button
          onClick={() => navigate(`/rainmaker/apply/details?type=${selected}`)}
          className="bg-g text-white rounded-[24px] px-10 py-3.5 text-[15px] font-extrabold
                     hover:opacity-90 active:scale-[.97] transition-all"
        >
          Next
        </button>
      </div>
    </div>
  );
}
