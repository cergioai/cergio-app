// Per design-spec.md — step 3 of Rainmaker reg, Instagram username.
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';

export function RainmakerInstagramScreen() {
  const navigate = useNavigate();
  const [handle, setHandle] = useState('');

  const valid = handle.trim().length > 0;

  return (
    <div className="flex-1 flex flex-col bg-cr">
      {/* green header — taller, headline at bottom */}
      <div className="bg-gradient-to-b from-gm to-g px-7 pt-12 pb-14 flex flex-col justify-end min-h-[440px]">
        <h1 className="text-[28px] font-extrabold text-white leading-tight mb-2">
          What's your<br />Instagram username?
        </h1>
        <p className="text-[14px] text-white/85">
          Add basic information about expertise
        </p>
      </div>

      {/* sheet */}
      <div className="bg-cr rounded-t-[28px] -mt-7 px-7 pt-7 flex-1 pb-32">
        <label className="block text-[18px] font-extrabold text-black mb-2.5">
          Instagram username
        </label>
        <div className="relative">
          <span className="absolute left-4 top-1/2 -translate-y-1/2 text-[16px] text-b3">@</span>
          <input
            type="text"
            value={handle}
            onChange={e => setHandle(e.target.value.replace(/^@/, ''))}
            className="w-full bg-bg5 rounded-[14px] pl-9 pr-4 py-4 text-[14px]
                       text-black placeholder-b3 outline-none focus:ring-2 focus:ring-g/30"
          />
        </div>
      </div>

      {/* progress — almost full */}
      <div className="fixed bottom-[68px] left-1/2 -translate-x-1/2 w-full max-w-[390px] h-[3px] bg-bdr">
        <div className="h-full bg-g" style={{ width: '85%' }} />
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
          onClick={() => valid && navigate('/rainmaker/apply/submitted')}
          disabled={!valid}
          className={`rounded-[24px] px-10 py-3.5 text-[15px] font-extrabold transition-all
            ${valid
              ? 'bg-g text-white hover:opacity-90 active:scale-[.97]'
              : 'bg-bg5 text-b3 cursor-not-allowed'}`}
        >
          Submit
        </button>
      </div>
    </div>
  );
}
