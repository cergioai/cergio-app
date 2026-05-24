import { useRef, useState } from 'react';
import { useNavigate, useOutletContext } from 'react-router-dom';
import { Logo } from '../components/ui/Logo';
import { Toggle } from '../components/ui/Toggle';
import { CATEGORIES, FEED } from '../data/mock';

const BUNDLES = [
  { icon: '💍', label: 'Plan my wedding', task: 'Plan my wedding' },
  { icon: '🏠', label: 'Move in bundle',  task: 'Set up my new home' },
  { icon: '🎂', label: 'Birthday party',  task: 'Birthday party' },
  { icon: '🔨', label: 'Kitchen reno',    task: 'Renovate my kitchen' },
];

export function HomeScreen() {
  const navigate = useNavigate();
  const { showToast, startTask, freeServices, setFreeServices } = useOutletContext();
  const [activeCat, setActiveCat] = useState('cleaning');
  const [query, setQuery] = useState('');
  const inputRef = useRef(null);

  // Submit the home-bar query: route to /intake with the typed text as the
  // chat's first user message. useChat will parse it (service + when + where +
  // budget) and skip ahead to whatever's still missing.
  const submitQuery = () => {
    const text = query.trim();
    if (!text) {
      // Empty submit → just open the chat blank (preserves the legacy
      // "tap the search bar to open chat" UX).
      navigate('/intake');
      return;
    }
    navigate('/intake', { state: { initialMessage: text } });
  };

  const handleKeyDown = (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      submitQuery();
    }
  };

  return (
    <div className="flex-1 overflow-y-auto pb-20 bg-cr">

      {/* header */}
      <div className="flex justify-between items-center px-5 pt-4">
        <div className="flex items-center gap-2.5">
          <Logo size={36} />
          <span className="text-[13px] font-extrabold tracking-widest uppercase text-g">Cergio AI</span>
        </div>
        <button
          onClick={() => navigate('/profile')}
          className="w-10 h-10 rounded-full bg-gl flex items-center justify-center border-none text-lg cursor-pointer"
          aria-label="Profile"
        >
          👤
        </button>
      </div>

      {/* greeting */}
      <div className="px-5 pt-4 pb-1">
        <h1 className="text-[22px] font-extrabold text-black leading-tight">
          Hi there 👋<br />What do you <span className="text-g">need today?</span>
        </h1>
      </div>

      {/* Claude-style submit box — single rounded container with the input
          at the top and a chip toolbar at the bottom where Claude shows the
          model selector. We put the "Free services for Connectors" toggle in
          that bottom-left slot, and the green send arrow at the bottom-right.
          This is the primary UX: dump what/when/where/budget in one go and
          the chat only asks about what's still missing. */}
      <div className="px-5 py-3">
        <div
          className="bg-white border border-bdr rounded-[28px] transition-all
                     focus-within:border-g focus-within:shadow-[0_0_0_3px_#F3FFEA]"
        >
          {/* row 1: the textarea-ish input */}
          <textarea
            ref={inputRef}
            value={query}
            onChange={e => setQuery(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                submitQuery();
              }
            }}
            placeholder="Tell me what you need…  e.g. deep clean Mon 2pm, flexible, max $200"
            rows={2}
            className="w-full bg-transparent outline-none resize-none px-5 pt-4 pb-2
                       text-[15px] text-black placeholder-b3 font-medium leading-snug"
          />
          {/* row 2: chip toolbar — Free-services toggle on left, send on right */}
          <div className="flex items-center gap-2 px-3 pb-3 pt-1">
            {/* Toggle pill — single button that toggles freeServices on/off.
                Visual matches Claude's model-selector chip: rounded-pill,
                soft bg, label + state. On = mint pill; Off = neutral pill. */}
            <button
              type="button"
              onClick={() => setFreeServices(!freeServices)}
              className={`flex items-center gap-1.5 rounded-pill px-3 py-1.5 text-[12px] font-extrabold
                          transition-all
                          ${freeServices
                            ? 'bg-gl text-gd border border-g/30'
                            : 'bg-bg5 text-b2 border border-bdr hover:border-g/40'}`}
              aria-pressed={freeServices}
            >
              <span className={`w-2 h-2 rounded-full ${freeServices ? 'bg-g' : 'bg-b3'}`} />
              Free for Connectors
            </button>
            <button
              type="button"
              onClick={() => navigate('/rainmakers')}
              className="text-[11px] font-bold text-b3 underline underline-offset-2 hover:text-g transition-colors"
            >
              Learn how
            </button>
            <div className="flex-1" />
            {/* Send — green circle with up arrow, matches Claude's submit */}
            <button
              type="button"
              onClick={submitQuery}
              aria-label="Search"
              className="w-9 h-9 bg-g rounded-full flex items-center justify-center flex-shrink-0
                         hover:opacity-90 active:scale-95 transition-transform"
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
                <path d="M12 19V5M5 12l7-7 7 7" stroke="white"
                      strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </button>
          </div>
        </div>
        {/* hint under the box */}
        <p className="text-[11px] text-b3 mt-1.5 px-1 leading-snug">
          Mention <span className="font-bold">what · when · where · budget</span> all in one go.
          I'll only ask about what's missing.
        </p>

        {/* Service-side entry: a separate compact CTA for providers who want
            a Connector to spotlight their service (the reverse direction of
            the main flow). Routes to the placeholder marketplace stub. */}
        <button
          type="button"
          onClick={() => navigate('/connectors/browse')}
          className="w-full mt-3 bg-white border border-bdr rounded-[16px] px-4 py-3
                     flex items-center gap-3 text-left hover:border-g/40 transition-colors"
        >
          <div className="w-9 h-9 rounded-full bg-gl flex items-center justify-center flex-shrink-0">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none"
                 stroke="#3D8B00" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/>
            </svg>
          </div>
          <div className="flex-1">
            <p className="text-[14px] font-extrabold text-black leading-tight">
              Have a service? Ask a Connector to spotlight it
            </p>
            <p className="text-[12px] text-b3 mt-0.5 leading-snug">
              Browse Connectors by audience size + rate. Negotiate below the rate card.
            </p>
          </div>
          <svg width="9" height="14" viewBox="0 0 11 18" fill="none" className="flex-shrink-0">
            <path d="M1.5 1.5L9 9l-7.5 7.5" stroke="currentColor"
                  strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" className="text-black/60" />
          </svg>
        </button>
      </div>

      {/* categories */}
      <p className="px-5 text-[11px] font-extrabold uppercase tracking-widest text-b3 mb-3">Services</p>
      <div className="flex gap-2.5 overflow-x-auto px-5 pb-1 scrollbar-hide mb-5">
        {CATEGORIES.map(cat => (
          <button
            key={cat.id}
            onClick={() => { setActiveCat(cat.id); startTask(cat.label); }}
            className={`flex-shrink-0 flex items-center gap-1.5 border rounded-pill
                        px-3.5 py-2 text-[13px] font-semibold cursor-pointer transition-all
                        ${activeCat === cat.id
                          ? 'border-g bg-gl text-gd'
                          : 'border-bdr bg-white text-b2 hover:border-g hover:bg-gl'}`}
          >
            <span className="text-base">{cat.icon}</span>
            <span>{cat.label}</span>
          </button>
        ))}
      </div>

      {/* bundles */}
      <p className="px-5 text-[11px] font-extrabold uppercase tracking-widest text-b3 mb-3">Bundle requests</p>
      <div className="flex flex-wrap gap-2 px-5 mb-6">
        {BUNDLES.map(b => (
          <button
            key={b.label}
            onClick={() => startTask(b.task)}
            className="bg-white border border-bdr rounded-pill px-3.5 py-1.5
                       text-[12px] font-bold text-b2 cursor-pointer hover:border-g hover:text-gd transition-colors"
          >
            {b.icon} {b.label}
          </button>
        ))}
      </div>

      {/* Connector banner removed — entry point is now the "Learn how" link
          under the free-services toggle at the top of this screen. */}

      {/* friend activity */}
      <p className="px-5 text-[11px] font-extrabold uppercase tracking-widest text-b3 mb-3">Friends recently booked</p>
      {FEED.map(item => (
        <div key={item.id} className="mx-5 mb-3 bg-soft rounded-[20px] p-3.5 flex gap-3">
          <div className="w-10 h-10 rounded-full bg-gl flex items-center justify-center text-lg flex-shrink-0">😊</div>
          <div>
            <p className="text-[13px] font-bold text-black">{item.name}</p>
            <p className="text-[12px] text-b3 font-medium mt-0.5">
              booked <span className="font-bold text-g">{item.service}</span>
            </p>
            <p className="text-[11px] text-b3 mt-1">{item.time}{item.saved ? ` · saved ${item.saved}` : ''}</p>
          </div>
        </div>
      ))}
    </div>
  );
}
