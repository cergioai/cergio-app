import { useEffect, useRef } from 'react';
import { useNavigate, useLocation, useOutletContext } from 'react-router-dom';
import { Logo } from '../components/ui/Logo';
import { Toggle } from '../components/ui/Toggle';

export function IntakeScreen() {
  const navigate = useNavigate();
  const location = useLocation();
  const { chat, freeServices, setFreeServices } = useOutletContext();
  const seedTask = location.state?.seedTask ?? null;

  const { messages, quickReplies, phase, typing, init, send, state } = chat;
  const inputRef  = useRef(null);
  const bottomRef = useRef(null);

  // Re-initialize the chat each time the user navigates here fresh
  // (location.key changes on every new navigation entry).
  const initedKey = useRef(null);
  useEffect(() => {
    if (initedKey.current !== location.key) {
      initedKey.current = location.key;
      init(seedTask);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location.key]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, typing]);

  const handleSend = () => {
    const val = inputRef.current?.value.trim();
    if (!val) return;
    inputRef.current.value = '';
    send(val);
  };

  const handleKey = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend(); }
  };

  const { fields } = state;

  return (
    <div className="flex-1 flex flex-col bg-cr overflow-hidden">

      {/* header */}
      <div className="flex justify-between items-center px-5 py-3.5 border-b border-bdr bg-white flex-shrink-0">
        <button
          onClick={() => navigate(-1)}
          className="text-[20px] text-b3 bg-transparent border-none cursor-pointer px-1"
        >
          ←
        </button>
        <div className="flex items-center gap-2">
          <Logo size={22} />
          <span className="text-[14px] font-bold text-black">Cergio AI</span>
        </div>
        <div className="w-8" />
      </div>

      {/* progress */}
      <div className="flex items-center gap-1.5 px-5 py-2.5 bg-white border-b border-bg5 flex-shrink-0">
        {[1, 2, 3].map(n => (
          <div
            key={n}
            className={`w-2.5 h-2.5 rounded-full transition-colors duration-300
                        ${fields >= n ? 'bg-g' : 'bg-bdr'}`}
          />
        ))}
        <span className={`text-[11px] font-bold ml-1 ${fields >= 3 ? 'text-g' : 'text-b3'}`}>
          {fields >= 3 ? '3 / 3 ✓' : `${fields} / 3 required`}
        </span>
      </div>

      {/* messages */}
      <div className="flex-1 overflow-y-auto px-4 py-4 flex flex-col gap-2.5">
        {messages.map(m => (
          <div
            key={m.id}
            className={`max-w-[88%] px-3.5 py-2.5 text-[13px] font-medium leading-relaxed
                        ${m.role === 'bot'
                          ? 'bg-crd rounded-[4px_18px_18px_18px] text-black self-start'
                          : 'bg-g rounded-[18px_4px_18px_18px] text-white font-semibold self-end'}`}
            style={{ whiteSpace: 'pre-wrap' }}
          >
            {m.text}
          </div>
        ))}

        {typing && (
          <div className="self-start flex gap-1.5 px-3.5 py-2.5">
            {[0, 1, 2].map(i => (
              <div
                key={i}
                className="w-1.5 h-1.5 rounded-full bg-b3 animate-bounce"
                style={{ animationDelay: `${i * 0.15}s` }}
              />
            ))}
          </div>
        )}
        <div ref={bottomRef} />
      </div>

      {/* quick replies */}
      {quickReplies.length > 0 && (
        <div className="flex flex-wrap gap-2 px-4 pb-2">
          {quickReplies.map(r => (
            <button
              key={r}
              onClick={() => send(r)}
              className={`border rounded-pill px-3.5 py-1.5 text-[12px] font-bold cursor-pointer transition-colors
                          ${r === 'Skip →'
                            ? 'border-bdr text-b3 hover:bg-bg5'
                            : 'border-g text-gd hover:bg-gl'}`}
            >
              {r}
            </button>
          ))}
        </div>
      )}

      {/* CTA when ready */}
      {phase === 'ready' && (
        <div className="px-4 pb-3 flex flex-col gap-2">
          {/* small inline toggle for repeat Rainmakers, just above submit */}
          <div className="bg-soft rounded-[14px] px-3 py-2.5 flex items-center gap-3">
            <div className="flex-1">
              <p className="text-[12px] font-extrabold text-black leading-tight">
                Free service for Instagram post
              </p>
              <p className="text-[11px] text-b3">
                {freeServices ? 'On — receive free offers' : 'Off — pay normally'}
              </p>
            </div>
            <Toggle on={freeServices} onChange={setFreeServices} size="sm" />
          </div>

          {/* Phase C — split the chat-complete CTA on the free-services toggle:
              ON  → /enable-free-offers (existing free Rainmaker flow → /roaming)
              OFF → /results            (paid flow: real provider cards → Book → PaymentSheet)
          */}
          <button
            onClick={() => navigate(freeServices ? '/enable-free-offers' : '/results')}
            className="w-full bg-g text-white rounded-[24px] py-3.5 text-[15px] font-extrabold
                       hover:opacity-90 active:scale-[.97] transition-all"
          >
            {freeServices ? 'Get my free offers →' : 'Show me providers →'}
          </button>
          <button className="w-full bg-bg5 text-b2 rounded-pill py-3 text-[13px] font-bold">
            📷 Add photos / videos
          </button>
        </div>
      )}

      {/* input */}
      {phase === 'chat' && (
        <div className="px-4 py-2.5 bg-white border-t border-bdr flex-shrink-0">
          <div className="flex gap-2">
            <textarea
              ref={inputRef}
              rows={1}
              placeholder="Type here…"
              onKeyDown={handleKey}
              className="flex-1 bg-cr border border-bdr rounded-[14px] px-3.5 py-2.5
                         text-[13px] text-black font-medium resize-none outline-none
                         focus:border-g min-h-[42px] max-h-[120px] font-sans"
            />
            <button
              onClick={handleSend}
              className="w-[42px] h-[42px] bg-g border-none rounded-xl flex items-center
                         justify-center cursor-pointer hover:opacity-90 active:scale-95 flex-shrink-0"
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5" strokeLinecap="round" width="18" height="18">
                <path d="M12 19V5M5 12l7-7 7 7" />
              </svg>
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
