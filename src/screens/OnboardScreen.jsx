import { useState } from 'react';
import { useNavigate } from 'react-router-dom';

const SLIDES = [
  {
    icon: '🤖',
    bg: 'bg-gl',
    title: 'AI finds your perfect service',
    desc: "Just describe what you need — Cergio's AI matches you with the best local providers in seconds.",
  },
  {
    icon: '👥',
    bg: 'bg-bg5',
    title: 'Trusted by your friends',
    desc: "See which providers your friends booked and loved. Social proof you can actually trust.",
  },
  {
    icon: '🌧️',
    bg: 'bg-crd',
    title: 'Become a Rainmaker',
    desc: "Spotlight the best services, drive real earnings to great providers — and earn with them.",
  },
];

export function OnboardScreen() {
  const navigate = useNavigate();
  const [step, setStep] = useState(0);
  const last = step === SLIDES.length - 1;

  const next = () => {
    if (last) navigate('/home');
    else setStep(s => s + 1);
  };

  const { icon, bg, title, desc } = SLIDES[step];

  return (
    <div className="flex-1 flex flex-col bg-white">
      {/* slide */}
      <div className="flex-1 flex flex-col items-center justify-center px-8 text-center gap-7">
        <div className={`w-24 h-24 rounded-[28px] flex items-center justify-center text-4xl ${bg}`}>
          {icon}
        </div>
        <div>
          <h2 className="text-[26px] font-extrabold text-black leading-tight mb-3">{title}</h2>
          <p className="text-[15px] text-b3 leading-relaxed">{desc}</p>
        </div>
      </div>

      {/* dots */}
      <div className="flex justify-center gap-2 pb-5">
        {SLIDES.map((_, i) => (
          <div
            key={i}
            onClick={() => setStep(i)}
            className={`h-2 rounded-full cursor-pointer transition-all duration-300
                        ${i === step ? 'bg-g w-6' : 'bg-bdr w-2'}`}
          />
        ))}
      </div>

      {/* footer */}
      <div className="px-6 pb-9 flex flex-col gap-3">
        <button
          onClick={next}
          className="w-full bg-g text-white rounded-[24px] py-4 text-[15px] font-extrabold
                     transition-opacity hover:opacity-90 active:scale-[.97]"
        >
          {last ? 'Get started' : 'Next'}
        </button>
        {!last && (
          <button
            onClick={() => navigate('/home')}
            className="text-center text-[13px] text-b3 font-medium py-1"
          >
            Skip
          </button>
        )}
      </div>
    </div>
  );
}
