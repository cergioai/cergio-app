// Per design-spec.md — add an hourly offering with name + rate.
import { useState } from 'react';
import { useNavigate, useOutletContext } from 'react-router-dom';
import { RegHeader, RegFooter } from '../components/ui/RegHeader';

export function ServiceListAddOfferingScreen() {
  const navigate = useNavigate();
  const { addOffering } = useOutletContext();
  const [name, setName] = useState('');
  const [rate, setRate] = useState('');

  const valid = name.trim() && rate.trim();

  return (
    <div className="flex-1 flex flex-col bg-cr">
      <RegHeader
        title="Add your hourly offering"
        sub="You may add as many offerings as you'd like"
        minHeight={400}
      />

      <div className="bg-cr rounded-t-[28px] -mt-7 px-7 pt-7 flex-1 pb-32 overflow-y-auto">
        <div className="mb-6">
          <label className="block text-[18px] font-extrabold text-black mb-2.5">Offering name</label>
          <input
            type="text" value={name} onChange={e => setName(e.target.value)}
            placeholder="Personal Training"
            className="w-full bg-bg5 rounded-[14px] px-4 py-4 text-[14px] text-black
                       placeholder-b3 outline-none focus:ring-2 focus:ring-g/30"
          />
        </div>
        <div className="mb-6">
          <label className="block text-[18px] font-extrabold text-black mb-2.5">Hourly rate</label>
          <input
            type="text" value={rate} onChange={e => setRate(e.target.value)}
            placeholder="$50 per hour"
            className="w-full bg-bg5 rounded-[14px] px-4 py-4 text-[14px] text-black
                       placeholder-b3 outline-none focus:ring-2 focus:ring-g/30"
          />
        </div>
      </div>

      <RegFooter
        progress={0.35}
        onNext={() => {
          addOffering({ name: name.trim(), kind: 'hourly', price: rate.trim() });
          navigate('/list-service/more-offerings');
        }}
        nextEnabled={valid}
      />
    </div>
  );
}
