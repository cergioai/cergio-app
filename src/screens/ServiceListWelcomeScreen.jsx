// Per design-spec.md — entry to Service Listing flow.
import { useNavigate } from 'react-router-dom';

export function ServiceListWelcomeScreen() {
  const navigate = useNavigate();

  return (
    <div className="flex-1 flex flex-col bg-white">
      {/* hero image area — soft mint wave-bottom */}
      <div className="relative bg-gl pt-10 pb-2 flex items-center justify-center">
        <button
          onClick={() => navigate(-1)}
          className="absolute top-4 left-4 w-10 h-10 rounded-full bg-white/95
                     flex items-center justify-center text-black text-base"
        >
          ✕
        </button>
        <div className="w-44 h-44 rounded-full bg-g flex items-center justify-center shadow-card">
          <svg width="92" height="92" viewBox="0 0 24 24" fill="none"
               stroke="white" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
            <path d="M12 2L4 7v5c0 5 4 9.7 8 11 4-1.3 8-6 8-11V7l-8-5z" fill="rgba(255,255,255,0.18)" />
            <path d="M9 12l2 2 4-4" />
          </svg>
        </div>
      </div>
      <svg viewBox="0 0 390 32" preserveAspectRatio="none" className="w-full block -mt-px">
        <path d="M0,0 C60,30 130,30 195,15 C260,0 320,18 390,5 L390,0 Z" fill="#E8F5E0" />
      </svg>

      {/* body */}
      <div className="flex-1 px-7 pt-7">
        <h1 className="text-[26px] font-extrabold text-black mb-3">Hi Jennifer!</h1>
        <p className="text-[15px] text-b3 leading-relaxed mb-4">
          We're excited to learn about the service you'd like to host on Cergio.
        </p>
        <p className="text-[15px] text-b3 leading-relaxed mb-4">
          In a few minutes, you'll create your service profile, add your prices, view your verification
          options and invite your clients and friends to book you on Cergio.
        </p>
        <p className="text-[15px] text-b3 leading-relaxed">Ready to get started?</p>
      </div>

      {/* CTA */}
      <div className="px-5 pt-6 pb-6">
        <button
          onClick={() => navigate('/list-service/about')}
          className="w-full bg-g text-white rounded-[24px] py-4 text-[15px] font-extrabold
                     hover:opacity-90 active:scale-[.97] transition-all"
        >
          List my service
        </button>
      </div>
    </div>
  );
}
