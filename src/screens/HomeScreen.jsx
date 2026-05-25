// Home — single-screen search experience. After submit, we DO NOT navigate
// away. The entire post-submit flow happens inline:
//   1. A compact "Your request" summary card slides in above the input
//      (profile-style typography: 13/11px, on the side, not a takeover).
//   2. A live engine ticker streams what the backend is doing — selecting
//      providers your friends recommend → notifying → negotiating → offers
//      in. Matches the Claude-status pattern (single-line, animated).
//   3. As offers come back they stream in as tappable rows, right under
//      the status. Tap to open the request detail / inbox.
//
// We keep the user on this screen so the experience feels seamless —
// no /roaming / /intake takeover unless they need to chat for missing fields.
import { useEffect, useRef, useState } from 'react';
import { useNavigate, useOutletContext } from 'react-router-dom';
import { CcGateModal } from '../components/ui/CcGateModal';
import { AddressAutocomplete } from '../components/ui/AddressAutocomplete';
import { getMyCcStatus, getDefaultAddress, saveAddress, listMyServices } from '../lib/api';
import { REWARDS } from '../lib/rewards';

// Example chips — conversational, single-task.
const FIND_EXAMPLES = [
  { label: 'Deep cleaning under $250',           task: 'Need deep cleaning under $250' },
  { label: 'Spanish-speaking sitter · Tue · $55', task: 'Need a babysitter who speaks Spanish Tuesday night under $55' },
  { label: 'Dog walker after 5pm · $40',         task: 'Need a dog walker after 5pm under $40' },
];
const SPOTLIGHT_EXAMPLES = [
  { label: 'Cat sitter · pets Connector 5K+',      task: 'Cat sitter looking for a pets Connector with 5K+ followers' },
  { label: 'Chef · fashion/events Connector 7K+',  task: 'Chef looking for a fashion or events Connector with 7K+ followers' },
  { label: 'Yoga studio · fitness Connector 10K+', task: 'Yoga studio looking for a fitness Connector with 10K+ followers' },
];

// Engine plan — what the "backend" appears to be doing, in order. Each
// stage has a label (status text), an optional dynamic detail (provider
// count, etc.), and a duration. After the last stage we surface a result
// CTA pointing the user at their inbox.
function buildFindPlan() {
  // Friend-recommended provider pool — picked from the same mock cohort
  // the Activity tab uses. Real backend will replace this with the live
  // friends-of-friends recommendation set.
  const pool = [
    { name: 'Jamie (cleaning)',  by: 'Sara' },
    { name: 'John (handyman)',   by: 'Mike' },
    { name: 'Steve (mover)',     by: 'Lily' },
    { name: 'Ana (sitter)',      by: 'Priya' },
  ];
  return [
    { label: "Selecting providers your friends recommend",   ms: 1100 },
    { label: `Found ${pool.length} in your network`,         ms: 900,  detail: pool.map(p => p.name).join(' · ') },
    { label: 'Notifying providers',                          ms: 1100 },
    { label: 'Negotiating offers on your behalf',            ms: 1300 },
    { label: 'Awaiting first offer',                         ms: 900 },
  ];
}
function buildSpotlightPlan() {
  return [
    { label: 'Matching Connectors who fit your audience',    ms: 1100 },
    { label: 'Found 6 Connectors in your area',              ms: 900,  detail: 'Pets · Fitness · Fashion · Food · Local · Lifestyle' },
    { label: 'Checking follower overlap',                    ms: 1100 },
    { label: 'Sending your pitch',                           ms: 1100 },
    { label: 'Awaiting Connector responses',                 ms: 900 },
  ];
}

function ModeOption({ active, label, sub, onClick }) {
  return (
    <button
      type="button"
      role="option"
      aria-selected={active}
      onClick={onClick}
      className={`w-full text-left px-3 py-2.5 flex items-start gap-2 hover:bg-bg5/40 transition-colors
                  ${active ? 'bg-gl/30' : ''}`}
    >
      <span className={`mt-1 text-[12px] flex-shrink-0 ${active ? 'text-g' : 'text-transparent'}`}>✓</span>
      <span className="flex-1">
        <span className="block text-[13px] font-extrabold text-black leading-tight">{label}</span>
        <span className="block text-[11px] text-b3 mt-0.5 leading-snug">{sub}</span>
      </span>
    </button>
  );
}

// Up-arrow used on the green send button. Replaces the old leaf-in-button
// icon — the leaf now lives next to the headline as the brand mark.
function SendArrowIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
      <path d="M12 19V5M5 12l7-7 7 7" stroke="white"
            strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

// Cergio brand mark — a small plant with a stem and two unfurled leaves.
// `working` triggers a slow Claude-style rotation so the user can see the
// engine "thinking" without a separate spinner. The mark sits inline with
// the greeting at the top of Home.
function LeafLogo({ working = false, size = 22 }) {
  return (
    <span
      className={`inline-flex items-center justify-center flex-shrink-0 ${working ? 'cg-leaf-think' : ''}`}
      style={{ width: size, height: size, transformOrigin: '50% 60%' }}
      aria-hidden="true"
    >
      <svg width={size} height={size} viewBox="0 0 28 28" fill="none">
        {/* Stem — a thin curve growing up from the bottom. */}
        <path
          d="M14 26 C14 22 14 18 14 14"
          stroke="#3D8B00" strokeWidth="2" strokeLinecap="round"
        />
        {/* Left leaf — wide teardrop. */}
        <path
          d="M14 17 C 8 17, 4 14, 4 9 C 4 7, 5 5.5, 6 4.5 C 9 6, 12 8.5, 14 14 Z"
          fill="#4AA901"
        />
        {/* Right leaf — mirrored, slightly larger so the mark feels alive. */}
        <path
          d="M14 14 C 16 9, 19 5.5, 22.5 4 C 23.5 5, 24.5 7, 24.5 9 C 24.5 14, 20 17, 14 17 Z"
          fill="#5BC404"
        />
        {/* Leaf veins — tiny lines to add detail without being noisy. */}
        <path d="M14 14 L 8 9" stroke="#2F6E00" strokeWidth="0.8" strokeLinecap="round" opacity=".55" />
        <path d="M14 14 L 20 8" stroke="#2F6E00" strokeWidth="0.8" strokeLinecap="round" opacity=".55" />
      </svg>
    </span>
  );
}

// localStorage key for signed-out users' "guest" address. Replaced by the
// server-side default once they sign in (auth flip reloads from Supabase).
const GUEST_ADDR_KEY = 'cergio.guestAddress';

export function HomeScreen() {
  const navigate = useNavigate();
  const {
    showToast,
    freeServices,
    setFreeServices,
    auth,
    chat,            // useChat hook — gives us the ask-for-missing-fields flow inline
  } = useOutletContext();
  const [query, setQuery] = useState('');
  const [images, setImages] = useState([]);
  const [modeOpen, setModeOpen] = useState(false);
  const [showCcGate, setShowCcGate] = useState(false);
  const [ccVerified, setCcVerified] = useState(false);
  const [intent, setIntent] = useState('find');
  const [hasService, setHasService] = useState(null);
  const [reply, setReply] = useState('');   // inline mini-chat reply input
  const inputRef = useRef(null);
  const fileRef = useRef(null);
  const modeBtnRef = useRef(null);
  const replyRef = useRef(null);
  const threadRef = useRef(null);

  // Engine state — kicks off once chat.phase flips to 'ready' (all
  // mandatory fields captured). We stay on Home through the whole thing.
  const [submitted, setSubmitted] = useState(false);
  const [submittedAt, setSubmittedAt] = useState(null);   // ISO for timestamping the summary
  const [submittedText, setSubmittedText] = useState(''); // their actual typed query
  const [planIdx, setPlanIdx] = useState(0);
  const [planDone, setPlanDone] = useState(false);
  const [engineStarted, setEngineStarted] = useState(false);
  const timersRef = useRef([]);

  // Mode-aware plan reference — rebuilt on each submit so the inline log
  // reflects the latest intent and any seeded data.
  const planRef = useRef(null);
  const plan = planRef.current || [];

  useEffect(() => {
    if (!auth?.isSignedIn) { setCcVerified(false); return; }
    getMyCcStatus().then(({ data }) => setCcVerified(!!data?.cc_verified_at));
  }, [auth?.isSignedIn]);

  useEffect(() => {
    if (!auth?.isSignedIn) { setHasService(null); return; }
    listMyServices().then(({ data }) => setHasService((data || []).length > 0));
  }, [auth?.isSignedIn]);

  // Location — saved-default-first, then guest localStorage, then blank.
  const [locationText, setLocationText] = useState('');
  const [locationCoords, setLocationCoords] = useState(null);
  const [locEditing, setLocEditing] = useState(false);
  const [travelRadius, setTravelRadius] = useState('10mi');

  useEffect(() => {
    // Signed-in: hydrate from Supabase default. If none, fall back to any
    // localStorage guest value the user had set pre-signin (we'll then
    // promote it to a real saved default on next pick).
    if (auth?.isSignedIn) {
      getDefaultAddress().then(({ data }) => {
        if (data?.formatted_address) {
          setLocationText(data.formatted_address);
          if (data.lat != null && data.lng != null) {
            setLocationCoords({ lat: data.lat, lng: data.lng });
          }
          return;
        }
        // No server default — try guest cache.
        try {
          const raw = localStorage.getItem(GUEST_ADDR_KEY);
          if (raw) {
            const g = JSON.parse(raw);
            if (g?.address) {
              setLocationText(g.address);
              if (g.lat != null && g.lng != null) setLocationCoords({ lat: g.lat, lng: g.lng });
            }
          }
        } catch { /* ignore */ }
      });
      return;
    }
    // Signed-out: just guest cache.
    try {
      const raw = localStorage.getItem(GUEST_ADDR_KEY);
      if (raw) {
        const g = JSON.parse(raw);
        if (g?.address) {
          setLocationText(g.address);
          if (g.lat != null && g.lng != null) setLocationCoords({ lat: g.lat, lng: g.lng });
        }
      }
    } catch { /* ignore */ }
  }, [auth?.isSignedIn]);

  useEffect(() => {
    if (!modeOpen) return;
    const onDoc = (e) => {
      if (modeBtnRef.current && !modeBtnRef.current.contains(e.target)) {
        setModeOpen(false);
      }
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [modeOpen]);

  // Kick the engine ticker. Sets up timers that advance planIdx through
  // the stages, then sets planDone when the last stage finishes.
  const startEngine = (mode) => {
    const built = mode === 'spotlight' ? buildSpotlightPlan() : buildFindPlan();
    planRef.current = built;
    setPlanIdx(0);
    setPlanDone(false);

    // Clear any prior run.
    timersRef.current.forEach(clearTimeout);
    timersRef.current = [];

    let cum = 0;
    built.forEach((stage, i) => {
      cum += stage.ms;
      if (i < built.length - 1) {
        timersRef.current.push(setTimeout(() => setPlanIdx(i + 1), cum));
      } else {
        timersRef.current.push(setTimeout(() => setPlanDone(true), cum));
      }
    });
  };

  // Clean up timers on unmount.
  useEffect(() => () => timersRef.current.forEach(clearTimeout), []);

  const submitQuery = () => {
    // Spotlight-mode pre-checks — same as before, but if user passes
    // them we run the engine here instead of routing.
    if (intent === 'spotlight') {
      if (!auth?.isSignedIn) {
        showToast('Sign in to send a spotlight request');
        navigate('/auth');
        return;
      }
      if (hasService === false) {
        showToast("First list your service — we'll bring you right back.");
        navigate('/list-service');
        return;
      }
    } else if (images.length > 0 && !ccVerified) {
      if (!auth?.isSignedIn) {
        showToast('Sign in to upload photos');
        navigate('/auth');
        return;
      }
      setShowCcGate(true);
      return;
    }
    const text = query.trim();
    if (!text && images.length === 0) {
      showToast('Tell me what you need — type or tap an example.');
      return;
    }
    setSubmittedText(text || (images.length ? `${images.length} photo${images.length > 1 ? 's' : ''} attached` : ''));
    setSubmittedAt(new Date().toISOString());
    setSubmitted(true);
    setEngineStarted(false);
    // Kick off the chat parser inline. If everything is captured in the
    // first message it goes straight to phase 'ready' and the engine
    // starts. Otherwise Cergio asks for the missing field (what / when /
    // where) right here on Home — no /intake redirect.
    chat?.init?.({
      initialMessage:  text,
      default_address: locationText || null,
      is_repeat_user:  !!auth?.isSignedIn,
    });
  };

  // When chat reaches 'ready' phase, fire the engine ticker once. This is
  // how the "missing-fields ask" flow on Home transitions into the
  // "engine doing work" flow without a route change.
  useEffect(() => {
    if (!submitted) return;
    if (chat?.phase === 'ready' && !engineStarted) {
      setEngineStarted(true);
      startEngine(intent);
    }
  }, [chat?.phase, submitted, engineStarted, intent]);

  // Auto-scroll the inline thread to the bottom when new messages arrive.
  useEffect(() => {
    if (!threadRef.current) return;
    threadRef.current.scrollTop = threadRef.current.scrollHeight;
  }, [chat?.messages?.length, chat?.typing]);

  // Send a reply in the inline mini-chat (used while chat.phase === 'chat').
  const sendReply = () => {
    const text = reply.trim();
    if (!text) return;
    setReply('');
    chat?.send?.(text);
    // Re-focus the reply box so the user can keep answering follow-ups.
    setTimeout(() => replyRef.current?.focus(), 0);
  };

  // Reset back to the search box. If `keepQuery` is true (the Edit
  // affordance on the summary card) we leave the original typed text in
  // the input so the user can tweak it instead of starting over.
  const resetSubmit = ({ keepQuery = false } = {}) => {
    timersRef.current.forEach(clearTimeout);
    timersRef.current = [];
    setSubmitted(false);
    setSubmittedAt(null);
    setPlanIdx(0);
    setPlanDone(false);
    setEngineStarted(false);
    if (keepQuery) {
      setQuery(submittedText);
    } else {
      setSubmittedText('');
      setQuery('');
    }
  };

  const onFilesPicked = (e) => {
    const files = Array.from(e.target.files || []).slice(0, 4);
    files.forEach(file => {
      const reader = new FileReader();
      reader.onload = () => {
        setImages(prev => [...prev, { name: file.name, dataUrl: reader.result }].slice(0, 4));
      };
      reader.readAsDataURL(file);
    });
    e.target.value = '';
  };

  const removeImage = (i) => setImages(prev => prev.filter((_, idx) => idx !== i));

  // Pill click — populates input and runs the same submit path so the
  // chat parser kicks in and the engine fires after mandatory fields
  // are captured.
  const onPillClick = (task) => {
    setQuery(task);
    setTimeout(() => {
      setSubmittedText(task);
      setSubmittedAt(new Date().toISOString());
      setSubmitted(true);
      setEngineStarted(false);
      chat?.init?.({
        initialMessage:  task,
        default_address: locationText || null,
        is_repeat_user:  !!auth?.isSignedIn,
      });
    }, 0);
  };

  // Engine searching = the moment the ticker is actually walking through
  // stages (Connecting → Notifying → Negotiating). NOT true during the
  // chat ask-for-missing-fields phase, NOT true once results have landed.
  // This is what drives the leaf-logo rotation — so the user only sees
  // motion when Cergio is really searching.
  const engineSearching = submitted && chat?.phase === 'ready' && !planDone;
  const working = submitted && !planDone; // (kept for any place that needs the broader "in flight" flag)
  const activeStage = plan[Math.min(planIdx, plan.length - 1)];

  return (
    <div className="flex-1 overflow-y-auto pb-20 bg-cream">

      {/* Header removed — profile is reachable via the bottom-nav Profile
          tab, so the top-right avatar was redundant. The Cergio brand mark
          now lives inline with the greeting below. */}

      {/* Cergio voice headline — slim, light on the eye. Leaf logo sits
          inline at the start and slowly rotates while the engine is
          thinking (Claude-style). Greeting is personalized for signed-in
          users using their display name. */}
      <div className="px-5 pt-5 pb-0.5 flex items-start gap-2.5">
        <LeafLogo working={engineSearching} size={22} />
        <h1 className="text-[15px] font-normal text-b2 leading-relaxed tracking-tight">
          {(() => {
            const display = auth?.user?.user_metadata?.display_name || '';
            const firstName = display.trim().split(/\s+/)[0] || '';
            const greeting = firstName ? `Hi ${firstName}, I'm Cergio` : `Hi, I'm Cergio`;
            return intent === 'find'
              ? <>{greeting} — I'll <span className="text-g font-medium">negotiate and book</span> services your friends trust.</>
              : <>{greeting} — I'll match you with a <span className="text-g font-medium">Connector</span> who can spotlight you on <span className="text-g font-medium">Instagram / TikTok</span>.</>;
          })()}
        </h1>
      </div>

      {/* Location chip — only after an address exists. */}
      {(locationText || locEditing) && (
        <div className="px-5 mt-1 mb-1 flex items-center gap-2 text-[11px] text-b3">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor"
               strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="flex-shrink-0">
            <path d="M12 22s7-7 7-13a7 7 0 0 0-14 0c0 6 7 13 7 13z" />
            <circle cx="12" cy="9" r="2.5" />
          </svg>
          {locEditing ? (
            <div className="flex-1 flex items-center gap-2">
              <AddressAutocomplete
                value={locationText}
                onChange={setLocationText}
                onSelect={async ({ lat, lng, address, placeId }) => {
                  setLocationText(address);
                  setLocationCoords({ lat, lng });
                  setLocEditing(false);
                  // Persist for non-logged-in users via localStorage so it
                  // survives reloads. Once they sign in, it gets promoted
                  // to a server-side default on the next pick.
                  try {
                    localStorage.setItem(GUEST_ADDR_KEY, JSON.stringify({ address, lat, lng, placeId }));
                  } catch { /* ignore */ }
                  if (auth?.isSignedIn) {
                    const { error } = await saveAddress({
                      label: 'Home',
                      formattedAddress: address,
                      lat, lng,
                      placeId,
                      makeDefault: true,
                    });
                    if (error) {
                      showToast(`Couldn't save: ${error.message || 'unknown error'}`);
                    } else {
                      showToast('Saved as your default location ✓');
                    }
                  } else {
                    showToast('Saved on this device. Sign in to sync it.');
                  }
                }}
                placeholder={intent === 'spotlight' ? 'Where do you offer the service?' : 'Add your address'}
                className=""
              />
              <button onClick={() => setLocEditing(false)}
                className="text-[12px] font-extrabold text-b3">Cancel</button>
            </div>
          ) : (
            <>
              <span className="flex-1 truncate font-bold text-b2">{locationText}</span>
              <button onClick={() => setLocEditing(true)}
                className="text-[12px] font-extrabold text-g underline underline-offset-2">
                Change
              </button>
            </>
          )}
        </div>
      )}

      {/* Spotlight travel-radius — only after a location exists. */}
      {intent === 'spotlight' && locationText && !submitted && (
        <div className="px-5 mt-0 mb-2 flex items-center gap-1.5 text-[11px] text-b3 flex-wrap">
          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor"
               strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="flex-shrink-0">
            <path d="M5 12a7 7 0 0 1 14 0"/><path d="M12 19v-7"/>
          </svg>
          <span className="font-medium mr-0.5">Willing to travel:</span>
          {[
            { id: 'onsite',   label: 'On-site only' },
            { id: '5mi',      label: '5 mi' },
            { id: '10mi',     label: '10 mi' },
            { id: '25mi',     label: '25 mi' },
            { id: 'anywhere', label: 'Anywhere' },
          ].map(opt => (
            <button
              key={opt.id}
              onClick={() => setTravelRadius(opt.id)}
              className={`rounded-pill px-2 py-0.5 text-[10px] font-extrabold transition-colors
                          ${travelRadius === opt.id
                            ? 'bg-gl text-gd border border-g/40'
                            : 'bg-white text-b2 border border-bdr hover:border-g/40'}`}
            >
              {opt.label}
            </button>
          ))}
        </div>
      )}

      {/* ─── Pre-submit: search box ──────────────────────────────────── */}
      {!submitted && (
        <>
          <div className="px-5 py-2">
            <div
              className="bg-white border border-bdr rounded-[24px] transition-all
                         focus-within:border-g/60 focus-within:shadow-[0_0_0_3px_#F3FFEA]"
            >
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
                placeholder={intent === 'find'
                  ? 'Tell me what you need… e.g. deep clean Mon 2pm, max $200'
                  : 'Describe your service and what you need… e.g. boxing trainer, want a fitness influencer w/ 10K+'}
                rows={2}
                className="w-full bg-transparent outline-none resize-none px-4 pt-3 pb-1.5
                           text-[14px] text-black placeholder-b3 font-medium leading-snug"
              />
              {images.length > 0 && (
                <div className="flex gap-2 px-4 pb-2 overflow-x-auto scrollbar-hide">
                  {images.map((img, i) => (
                    <div key={i} className="relative flex-shrink-0">
                      <img
                        src={img.dataUrl}
                        alt={img.name}
                        className="w-16 h-16 rounded-[10px] object-cover border border-bdr"
                      />
                      <button
                        type="button"
                        onClick={() => removeImage(i)}
                        aria-label="Remove image"
                        className="absolute -top-1 -right-1 w-5 h-5 rounded-full bg-black text-white text-[12px] font-bold flex items-center justify-center"
                      >
                        ×
                      </button>
                    </div>
                  ))}
                </div>
              )}

              <div className="flex items-center gap-2 px-3 pb-3 pt-1">
                <input
                  ref={fileRef}
                  type="file"
                  accept="image/*"
                  multiple
                  hidden
                  onChange={onFilesPicked}
                />
                {/* Attach — flat icon, no circle. Claude-style. */}
                <button
                  type="button"
                  onClick={() => fileRef.current?.click()}
                  aria-label="Attach photos"
                  className="p-1 text-b3 hover:text-g transition-colors flex-shrink-0"
                >
                  <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                    <path d="M8 2v12M2 8h12" stroke="currentColor"
                          strokeWidth="1.6" strokeLinecap="round" />
                  </svg>
                </button>

                <div ref={modeBtnRef} className="relative">
                  {/* Free/Pay mode — flat text + chevron. No pill, no
                      background. A small green dot signals the active
                      Free-for-Connectors state without shouting. */}
                  <button
                    type="button"
                    onClick={() => setModeOpen(o => !o)}
                    aria-haspopup="listbox"
                    aria-expanded={modeOpen}
                    className={`flex items-center gap-1.5 px-1 text-[12px] font-normal
                                transition-colors
                                ${freeServices ? 'text-gd' : 'text-b3 hover:text-b2'}`}
                  >
                    {freeServices && <span className="w-1.5 h-1.5 rounded-full bg-g flex-shrink-0" />}
                    {freeServices ? 'Free for Connectors' : 'Pay full price'}
                    <svg width="9" height="6" viewBox="0 0 10 6" fill="none" className="ml-0.5 opacity-70">
                      <path d="M1 1l4 4 4-4" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  </button>
                  {modeOpen && (
                    <div role="listbox" className="absolute top-full mt-1.5 left-0 z-10 bg-white border border-bdr rounded-[14px] shadow-card py-1 min-w-[220px]">
                      <ModeOption
                        active={freeServices}
                        label="Free for Connectors"
                        sub={intent === 'find'
                          ? 'Provider offers free in exchange for IG/TT post'
                          : "Offer free in exchange for the Connector's post"}
                        onClick={() => { setFreeServices(true); setModeOpen(false); }}
                      />
                      <ModeOption
                        active={!freeServices}
                        label="Pay full price"
                        sub={intent === 'find'
                          ? 'Normal paid booking'
                          : "Pay the Connector's spotlight rate"}
                        onClick={() => { setFreeServices(false); setModeOpen(false); }}
                      />
                    </div>
                  )}
                </div>

                <div className="flex-1" />
                <button
                  type="button"
                  onClick={submitQuery}
                  aria-label="Search"
                  className="h-9 px-3 bg-g rounded-[10px] flex items-center justify-center flex-shrink-0
                             hover:opacity-90 active:scale-95 transition-transform"
                >
                  <SendArrowIcon />
                </button>
              </div>
            </div>

            {/* Direction switch — slim text link, right-aligned. Way less
                visual weight than the previous full-width row. */}
            <div className="mt-1.5 flex justify-end px-1">
              <button
                type="button"
                onClick={() => setIntent(prev => prev === 'find' ? 'spotlight' : 'find')}
                className="text-[11px] text-b3 font-normal hover:text-g transition-colors"
                aria-pressed={intent === 'spotlight'}
              >
                {intent === 'find'
                  ? 'Have a service? Spotlight it →'
                  : '← Book a service instead'}
              </button>
            </div>
          </div>

          {/* Example chips — softer weight (font-normal) so they read as
              gentle suggestions, not strong CTAs. */}
          <div className="flex flex-wrap gap-1.5 px-5 mt-2 mb-4">
            {(intent === 'find' ? FIND_EXAMPLES : SPOTLIGHT_EXAMPLES).map(e => (
              <button
                key={e.label}
                onClick={() => onPillClick(e.task)}
                className="bg-white border border-bdr rounded-pill px-2.5 py-1
                           text-[11px] font-normal text-b2 cursor-pointer
                           hover:border-g hover:text-gd transition-colors"
              >
                {e.label}
              </button>
            ))}
          </div>
        </>
      )}

      {/* ─── Post-submit: summary + engine + offers ──────────────────── */}
      {submitted && (
        <div className="px-5 py-2">
          {/* Compact summary — profile-style typography (11px label /
              13px value), side-aligned, no big takeover card. */}
          <div className="bg-white border border-bdr rounded-[14px] px-3 py-2.5 flex items-start gap-3">
            <div className="w-8 h-8 rounded-[10px] bg-gl flex items-center justify-center flex-shrink-0 mt-0.5">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#3D8B00" strokeWidth="2"
                   strokeLinecap="round" strokeLinejoin="round">
                <circle cx="11" cy="11" r="7"/><path d="M21 21l-4-4"/>
              </svg>
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-[10px] font-extrabold uppercase tracking-widest text-b3">Your request</p>
              <p className="text-[13px] font-extrabold text-black leading-snug mt-0.5 break-words">
                {submittedText}
              </p>
              <p className="text-[11px] text-b3 mt-1 leading-snug truncate">
                {locationText ? `${locationText} · ` : ''}
                {freeServices ? 'Free for Connectors' : 'Pay full price'}
              </p>
            </div>
            <button
              onClick={() => resetSubmit({ keepQuery: true })}
              className="text-[11px] font-extrabold text-g underline underline-offset-2 flex-shrink-0 mt-0.5"
            >
              Edit
            </button>
          </div>

          {/* Inline mini-chat — while chat.phase === 'chat', Cergio asks
              for missing mandatory fields (what / when / where) one at a
              time. Bubbles render compactly so the thread doesn't take
              over the screen. Disappears once phase flips to 'ready'. */}
          {chat?.phase === 'chat' && (
            <>
              <div
                ref={threadRef}
                className="mt-3 max-h-[180px] overflow-y-auto flex flex-col gap-1.5"
              >
                {(chat?.messages || []).map(m => (
                  <div
                    key={m.id}
                    className={m.role === 'user'
                      ? 'self-end max-w-[80%] bg-gl text-black rounded-[14px] rounded-br-[4px] px-3 py-1.5 text-[12px] font-medium leading-snug'
                      : 'self-start max-w-[85%] bg-white border border-bdr text-black rounded-[14px] rounded-bl-[4px] px-3 py-1.5 text-[12px] font-medium leading-snug whitespace-pre-line'}
                  >
                    {m.text}
                  </div>
                ))}
                {chat?.typing && (
                  <div className="self-start bg-white border border-bdr rounded-[14px] rounded-bl-[4px] px-3 py-1.5 flex items-center gap-1">
                    <span className="w-1 h-1 rounded-full bg-b3 animate-pulse" />
                    <span className="w-1 h-1 rounded-full bg-b3 animate-pulse" style={{ animationDelay: '120ms' }} />
                    <span className="w-1 h-1 rounded-full bg-b3 animate-pulse" style={{ animationDelay: '240ms' }} />
                  </div>
                )}
              </div>

              {/* Quick-reply chips from the bot (e.g. "any evening", "tomorrow"). */}
              {(chat?.quickReplies?.length || 0) > 0 && (
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {chat.quickReplies.map(q => (
                    <button
                      key={q}
                      onClick={() => { setReply(''); chat?.send?.(q); }}
                      className="bg-white border border-bdr rounded-pill px-2.5 py-1
                                 text-[11px] font-bold text-b2 hover:border-g hover:text-gd transition-colors"
                    >
                      {q}
                    </button>
                  ))}
                </div>
              )}

              {/* Reply input — single-line, sits at the bottom of the thread. */}
              <div className="mt-2 flex items-center gap-2 bg-white border border-bdr rounded-pill px-3 py-1.5
                              focus-within:border-g/60 focus-within:shadow-[0_0_0_3px_#F3FFEA] transition-all">
                <input
                  ref={replyRef}
                  value={reply}
                  onChange={e => setReply(e.target.value)}
                  onKeyDown={e => {
                    if (e.key === 'Enter' && !e.shiftKey) {
                      e.preventDefault();
                      sendReply();
                    }
                  }}
                  placeholder="Your reply…"
                  className="flex-1 bg-transparent outline-none text-[13px] text-black placeholder-b3 font-medium"
                  autoFocus
                />
                <button
                  type="button"
                  onClick={sendReply}
                  aria-label="Send reply"
                  className="h-7 px-2.5 bg-g rounded-[8px] flex items-center justify-center
                             hover:opacity-90 active:scale-95 transition-transform"
                >
                  <SendArrowIcon />
                </button>
              </div>
            </>
          )}

          {/* Live engine ticker — fires once chat reaches 'ready'.
              When results have settled, the leaf logo slides in next to
              the line so the brand mark visually accompanies the outcome.
              Text is slim (font-medium) — not the bold status of before. */}
          {chat?.phase === 'ready' && (
            <div className="mt-3 px-1" aria-live="polite">
              <div className="flex items-center gap-2">
                {planDone
                  ? <LeafLogo working={false} size={16} />
                  : <span className="w-1.5 h-1.5 rounded-full bg-g animate-pulse flex-shrink-0" />}
                <p className="text-[13px] text-gd font-medium leading-snug truncate">
                  {planDone ? "We'll notify you when offers come in" : `${activeStage?.label || ''}…`}
                </p>
              </div>
              {!planDone && activeStage?.detail && (
                <p className="ml-3.5 mt-1 text-[11px] text-b3 font-normal leading-snug truncate">
                  {activeStage.detail}
                </p>
              )}
            </div>
          )}

          {/* Inline result CTA — once the engine settles, surface a
              tappable row pointing at Inbox where the actual offers
              will land. Keeps the user on Home; the route is opt-in. */}
          {planDone && (
            <div className="mt-4 flex flex-col gap-2">
              <button
                onClick={() => navigate('/inbox')}
                className="w-full bg-g text-white rounded-[14px] px-4 py-3 flex items-center justify-between text-left
                           hover:opacity-95 active:scale-[.99] transition-all"
              >
                <div>
                  <p className="text-[13px] font-extrabold leading-tight">Go to inbox</p>
                  <p className="text-[11px] text-white/85 mt-0.5 font-medium">
                    Offers land there. We'll text + email you when they come in.
                  </p>
                </div>
                <span className="text-white text-lg flex-shrink-0">›</span>
              </button>
              <button
                onClick={resetSubmit}
                className="w-full bg-white border border-bdr rounded-[14px] px-4 py-2.5
                           text-[12px] font-extrabold text-b2 hover:border-g/40 transition-colors"
              >
                Send another request
              </button>
            </div>
          )}
        </div>
      )}

      {/* Invite & earn ad — hidden once submitted, so the engine state
          is the focus. */}
      {intent === 'find' && !submitted && (
        <div className="px-5 mt-1 mb-6">
          <button
            onClick={() => navigate('/find-friends')}
            className="w-full bg-g text-white rounded-[20px] p-4 flex items-center gap-3 text-left
                       hover:opacity-95 active:scale-[.99] transition-all shadow-card"
          >
            <div className="w-10 h-10 rounded-full bg-white/15 flex items-center justify-center flex-shrink-0">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2"
                   strokeLinecap="round" strokeLinejoin="round">
                <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/>
                <circle cx="9" cy="7" r="4"/>
                <path d="M22 11h-6M19 8v6"/>
              </svg>
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-[15px] font-extrabold leading-tight">
                Invite & earn — ${REWARDS.perFriend}/friend
              </p>
              <p className="text-[11px] text-white/85 mt-0.5 leading-snug font-medium">
                10 friends in a month → Connector status, free services.
              </p>
            </div>
            <span className="text-white text-lg flex-shrink-0">›</span>
          </button>
        </div>
      )}

      {/* CC identity gate */}
      {showCcGate && (
        <CcGateModal
          onClose={() => setShowCcGate(false)}
          onVerified={() => {
            setCcVerified(true);
            setShowCcGate(false);
            showToast('Verified ✓ — running your search');
            // Re-fire submit after verification.
            setTimeout(() => submitQuery(), 0);
          }}
        />
      )}
    </div>
  );
}
