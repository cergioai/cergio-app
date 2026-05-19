// Per design-spec.md — add a session-based (non-hourly) offering.
import { useState } from 'react';
import { useNavigate, useOutletContext } from 'react-router-dom';
import { RegHeader, RegFooter } from '../components/ui/RegHeader';

const DURATION_UNITS = ['minutes', 'hours', 'days'];
const UNIT_TO_MIN = { minutes: 1, hours: 60, days: 60 * 24 };

export function ServiceListAddSessionOfferingScreen() {
  const navigate = useNavigate();
  const { addOffering } = useOutletContext();
  const [name, setName]     = useState('');
  const [price, setPrice]   = useState('');
  const [duration, setDur]  = useState('');
  const [unit, setUnit]     = useState('minutes');

  const valid = name.trim() && price.trim() && duration.trim();

  return (
    <div className="flex-1 flex flex-col bg-cr">
      <RegHeader
        title="Add a session offering"
        sub="You may add as many offerings as you'd like"
        minHeight={400}
      />

      <div className="bg-cr rounded-t-[28px] -mt-7 px-7 pt-7 flex-1 pb-32 overflow-y-auto">
        <div className="mb-6">
          <label className="block text-[18px] font-extrabold text-black mb-2.5">Offering name</label>
          <input
            type="text" value={name} onChange={e => setName(e.target.value)}
            placeholder="Personal Training Session"
            className="w-full bg-bg5 rounded-[14px] px-4 py-4 text-[14px] text-black
                       placeholder-b3 outline-none focus:ring-2 focus:ring-g/30"
          />
        </div>

        <div className="mb-6">
          <label className="block text-[18px] font-extrabold text-black mb-2.5">Session price</label>
          <input
            type="text" value={price} onChange={e => setPrice(e.target.value)}
            placeholder="$150"
            className="w-full bg-bg5 rounded-[14px] px-4 py-4 text-[14px] text-black
                       placeholder-b3 outline-none focus:ring-2 focus:ring-g/30"
          />
        </div>

        <div className="mb-6">
          <label className="block text-[18px] font-extrabold text-black mb-2.5">Session duration</label>
          <div className="flex gap-3">
            <input
              type="number" inputMode="numeric"
              value={duration} onChange={e => setDur(e.target.value)}
              placeholder="30"
              className="w-1/3 bg-bg5 rounded-[14px] px-4 py-4 text-[14px] text-black
                         placeholder-b3 outline-none focus:ring-2 focus:ring-g/30"
            />
            <div className="relative flex-1">
              <select
                value={unit} onChange={e => setUnit(e.target.value)}
                className="w-full appearance-none bg-bg5 rounded-[14px] px-4 py-4 pr-10 text-[14px]
                           text-black outline-none focus:ring-2 focus:ring-g/30 font-sans"
              >
                {DURATION_UNITS.map(u => <option key={u} value={u}>{u}</option>)}
              </select>
              <span className="absolute right-4 top-1/2 -translate-y-1/2 text-black pointer-events-none">▾</span>
            </div>
          </div>
        </div>
      </div>

      <RegFooter
        progress={0.35}
        onNext={() => {
          const minutes = (parseInt(duration, 10) || 0) * (UNIT_TO_MIN[unit] || 1);
          addOffering({
            name: name.trim(), kind: 'session', price: price.trim(),
            durationMinutes: minutes,
          });
          navigate('/list-service/more-offerings');
        }}
        nextEnabled={valid}
      />
    </div>
  );
}
