// Per design-spec.md — choose hourly vs session-based pricing.
import { useState } from 'react';
import { useNavigate, useOutletContext } from 'react-router-dom';
import { RegHeader, RegFooter } from '../components/ui/RegHeader';

const OPTIONS = [
  { id: 'hourly',  title: 'Yes, I can be booked hourly', desc: 'You will submit/approve estimates' },
  { id: 'session', title: 'No, I only offer sessions',   desc: 'This includes day rates and fixed sessions.' },
];

export function ServiceListHourlyOrSessionScreen() {
  const navigate = useNavigate();
  const { updateListingDraft } = useOutletContext();
  const [selected, setSelected] = useState(null);

  return (
    <div className="flex-1 flex flex-col bg-cr">
      <RegHeader title="Do you have an hourly rate?" minHeight={400} />

      <div className="bg-cr rounded-t-[28px] -mt-7 px-5 pt-7 flex-1 pb-32">
        <div className="flex flex-col gap-3">
          {OPTIONS.map(o => {
            const active = selected === o.id;
            return (
              <button
                key={o.id}
                onClick={() => setSelected(o.id)}
                className={`w-full text-left p-5 rounded-[18px] border-2 transition-colors
                  ${active ? 'bg-gl border-g' : 'bg-white border-bdr hover:border-g/40'}`}
              >
                <p className="text-body-lg font-extrabold text-black mb-1">{o.title}</p>
                <p className="text-body-sm text-b3 leading-relaxed">{o.desc}</p>
              </button>
            );
          })}
        </div>
      </div>

      <RegFooter
        progress={0.2}
        onNext={() => {
          updateListingDraft({ pricingMode: selected });
          navigate(
            selected === 'hourly'
              ? '/list-service/add-offering'
              : '/list-service/add-session'
          );
        }}
        nextEnabled={!!selected}
      />
    </div>
  );
}
