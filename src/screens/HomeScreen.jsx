import { useEffect, useRef, useState } from 'react';
import { useNavigate, useOutletContext } from 'react-router-dom';
import { Logo } from '../components/ui/Logo';
import { CcGateModal } from '../components/ui/CcGateModal';
import { AddressAutocomplete } from '../components/ui/AddressAutocomplete';
import { getMyCcStatus, getDefaultAddress, saveAddress, listMyServices } from '../lib/api';
import { REWARDS } from '../lib/rewards';

// Example chips — conversational, single-task. Three per mode.
// Tone match: the kind of thing the user would actually type — short,
// budget-anchored, mentions a real constraint (language, time, vibe).
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

// Status ticker lines — shown one-by-one after Send is tapped. Mode-aware
// so the metaphor matches the user's intent. Each line lives for ~1.1s
// before being replaced, then we route to /intake (find) or
// /connectors/browse (spotlight).
const FIND_STATUS = [
  "Connecting with your friends' recommended providers",
  'Notifying providers',
  'Negotiating on your behalf',
];
const SPOTLIGHT_STATUS = [
  'Finding Connectors who match your audience',
  'Checking follower overlap',
  'Sending your pitch',
];

// Single option inside the mode-picker popover.
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

// Leaf icon — used inside the green send button. When `working` is true,
// the leaf "opens" — a tiny unfold + rotate that signals Cergio is on it.
// The animation classes are inline so we don't have to touch the Tailwind
// config: a custom keyframes block lives in index.css under .cg-leaf-open.
function LeafIcon({ working }) {
  return (
    <svg
      width="16" height="16" viewBox="0 0 24 24" fill="none"
      className={working ? 'cg-leaf-open' : 'cg-leaf-rest'}
      style={{ transformOrigin: '50% 70%' }}
    >
      {/* Stem */}
      <path d="M12 22V13" stroke="white" strokeWidth="2" strokeLinecap="round" />
      {/* Leaf body — a teardrop. The opening animation tilts + scales
          this shape, so it reads as a folded leaf unfurling. */}
      <path
        d="M12 13c-4 0-7-3-7-7 0-1.2.3-2.3.7-3.3C7.2 3.6 9.5 5 12 5s4.8-1.4 6.3-2.3c.4 1 .7 2.1.7 3.3 0 4-3 7-7 7z"
        fill="white"
      />
    </svg>
  );
}

export function HomeScreen() {
  const navigate = useNavigate();
  const { showToast, startTask, freeServices, setFreeServices, auth } = useOutletContext();
  const [query, setQuery] = useState('');
  const [images, setImages] = useState([]);          // [{ name, dataUrl }]
  const [modeOpen, setModeOpen] = useState(false);   // Free vs Pay popover
  const [showCcGate, setShowCcGate] = useState(false);
  const [ccVerified, setCcVerified] = useState(false);
  // Search intent — 'find' (default; user is looking for a service) vs
  // 'spotlight' (user is a Provider; they want a Connector to spotlight
  // THEIR service in exchange for a free job). The toggle UNDER the search
  // box flips the placeholder + submit destination without changing layout.
  const [intent, setIntent] = useState('find');
  const [hasService, setHasService] = useState(null); // null=unknown, true/false once loaded
  const inputRef = useRef(null);
  const fileRef = useRef(null);
  const modeBtnRef = useRef(null);

  // Status ticker — one-line "Claude is working" indicator that runs after
  // a submit. `statusIdx` walks through FIND_STATUS / SPOTLIGHT_STATUS, then
  // we route to the next screen. While `working` is true, send button + leaf
  // are in their animated state and inputs are visually paused (not disabled
  // — user can still cancel via tap-outside or just wait).
  const [working, setWorking] = useState(false);
  const [statusIdx, setStatusIdx] = useState(0);

  // Pull CC verification status once on mount (and on auth flip).
  useEffect(() => {
    if (!auth?.isSignedIn) { setCcVerified(false); return; }
    getMyCcStatus().then(({ data }) => setCcVerified(!!data?.cc_verified_at));
  }, [auth?.isSignedIn]);

  // Detect if the signed-in user already has at least one listed service —
  // determines where the spotlight-intent send-arrow routes.
  useEffect(() => {
    if (!auth?.isSignedIn) { setHasService(null); return; }
    listMyServices().then(({ data }) => setHasService((data || []).length > 0));
  }, [auth?.isSignedIn]);

  // Location — prefilled from the user's saved default address. First-time
  // users see no address chip at all (clean Home). Once they set one, the
  // chip appears with "Change" next to it. Same pattern for find + spotlight.
  const [locationText, setLocationText] = useState('');
  const [locationCoords, setLocationCoords] = useState(null);
  const [locEditing, setLocEditing] = useState(false);

  // Travel radius — spotlight (provider) mode only.
  const [travelRadius, setTravelRadius] = useState('10mi');
  const [showMapDraw, setShowMapDraw] = useState(false);
  useEffect(() => {
    if (!auth?.isSignedIn) return;
    getDefaultAddress().then(({ data }) => {
      if (data?.formatted_address) {
        setLocationText(data.formatted_address);
        if (data.lat != null && data.lng != null) {
          setLocationCoords({ lat: data.lat, lng: data.lng });
        }
      }
    });
  }, [auth?.isSignedIn]);

  // Close mode popover on outside click.
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

  // Run the status ticker for the current intent, then call `after()` once
  // the last line has been shown. Returns a cancel fn so we can clean up
  // if the user navigates away mid-sequence.
  const runStatusTicker = (after) => {
    const lines = intent === 'spotlight' ? SPOTLIGHT_STATUS : FIND_STATUS;
    const PER_LINE_MS = 1100;
    setWorking(true);
    setStatusIdx(0);
    const timers = [];
    lines.forEach((_, i) => {
      if (i === 0) return; // first line already shown by setStatusIdx(0)
      timers.push(setTimeout(() => setStatusIdx(i), i * PER_LINE_MS));
    });
    timers.push(setTimeout(() => {
      setWorking(false);
      after();
    }, lines.length * PER_LINE_MS));
    return () => timers.forEach(clearTimeout);
  };

  // The actual nav decision — extracted so the status ticker can fire it.
  const doRoute = () => {
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
      navigate('/connectors/browse', {
        state: {
          pitch: query.trim(),
          serviceLocation: locationText || null,
          serviceCoords:   locationCoords || null,
          travelRadius,
        },
      });
      return;
    }
    // find mode
    if (images.length > 0 && !ccVerified) {
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
      navigate('/intake', { state: { initialLocation: locationText, initialCoords: locationCoords } });
      return;
    }
    navigate('/intake', {
      state: {
        initialMessage:  text,
        initialLocation: locationText,
        initialCoords:   locationCoords,
      },
    });
  };

  const submitQuery = () => {
    if (working) return; // already in progress — ignore double-taps
    // Gate before we even start the ticker, so we don't show "negotiating"
    // and then bounce them to /auth. Re-uses the same checks doRoute() does
    // but only for the blocking redirects.
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
    // Run the status ticker, THEN route.
    runStatusTicker(() => doRoute());
  };

  // Image attach handler.
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

  const statusLines = intent === 'spotlight' ? SPOTLIGHT_STATUS : FIND_STATUS;

  return (
    <div className="flex-1 overflow-y-auto pb-20 bg-cream">

      {/* header */}
      <div className="flex justify-between items-center px-5 pt-3">
        <div className="flex items-center gap-2">
          <Logo size={28} />
          <span className="text-[11px] font-extrabold tracking-widest uppercase text-g">Cergio AI</span>
        </div>
        <button
          onClick={() => navigate('/profile')}
          className="w-9 h-9 rounded-full bg-gl flex items-center justify-center border-none text-base cursor-pointer"
          aria-label="Profile"
        >
          👤
        </button>
      </div>

      {/* Cergio voice headline */}
      <div className="px-5 pt-3 pb-0.5">
        <h1 className="text-[17px] font-bold text-black leading-snug tracking-tight">
          {intent === 'find'
            ? <>Hi, I'm Cergio — I'll <span className="text-g">negotiate and book</span> services your friends trust.</>
            : <>Hi, I'm Cergio — I'll match you with a <span className="text-g">Connector</span> who can spotlight you on <span className="text-g">Instagram / TikTok</span>.</>}
        </h1>
      </div>

      {/* Location chip — ONLY appears once an address is set.
          First-time users see no chip at all (clean Home). Once saved, the
          row shows the address with a "Change" button next to it. While
          editing, the autocomplete unfolds in-line. Identical in both modes;
          the in-edit placeholder is mode-aware. */}
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
                onSelect={async ({ lat, lng, address }) => {
                  setLocationText(address);
                  setLocationCoords({ lat, lng });
                  setLocEditing(false);
                  if (auth?.isSignedIn) {
                    await saveAddress({
                      label: 'Home',
                      formattedAddress: address,
                      lat, lng,
                      makeDefault: true,
                    }).catch(() => {});
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

      {/* Travel-radius picker — spotlight mode only, AND only once a service
          location exists (otherwise it's noise on a blank-state Home). */}
      {intent === 'spotlight' && locationText && (
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
          <button
            onClick={() => {
              if (!locationCoords) {
                showToast('Set your service location first.');
                return;
              }
              setShowMapDraw(true);
              showToast('Draw on map — coming soon. Pick a radius preset for now.');
            }}
            className="text-[10px] font-bold text-g underline underline-offset-2 ml-1"
          >
            Draw on map
          </button>
        </div>
      )}

      {/* Submit box — Claude-search proportions. */}
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

          {/* row 2: chip toolbar */}
          <div className="flex items-center gap-2 px-3 pb-3 pt-1">
            <input
              ref={fileRef}
              type="file"
              accept="image/*"
              multiple
              hidden
              onChange={onFilesPicked}
            />
            <button
              type="button"
              onClick={() => fileRef.current?.click()}
              aria-label="Attach photos"
              className="w-8 h-8 rounded-full bg-bg5 border border-bdr text-b2 flex items-center justify-center
                         hover:border-g/40 hover:text-g transition-colors flex-shrink-0"
            >
              <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                <path d="M7 1.5v11M1.5 7h11" stroke="currentColor"
                      strokeWidth="1.4" strokeLinecap="round" />
              </svg>
            </button>

            <div ref={modeBtnRef} className="relative">
              <button
                type="button"
                onClick={() => setModeOpen(o => !o)}
                aria-haspopup="listbox"
                aria-expanded={modeOpen}
                className={`flex items-center gap-1.5 rounded-pill px-3 py-1.5 text-[12px] font-extrabold
                            transition-all
                            ${freeServices
                              ? 'bg-gl text-gd border border-g/30'
                              : 'bg-bg5 text-b2 border border-bdr hover:border-g/40'}`}
              >
                {freeServices ? 'Free for Connectors' : 'Pay full price'}
                <svg width="9" height="6" viewBox="0 0 10 6" fill="none" className="ml-0.5">
                  <path d="M1 1l4 4 4-4" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
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
            {/* Send — animated leaf inside a green pill-box. Boxy with
                rounded corners (not a circle) so it reads as a "send" button,
                not a status indicator. Idle = folded leaf; active = leaf
                unfolds + tilts to signal "Cergio is on it". */}
            <button
              type="button"
              onClick={submitQuery}
              disabled={working}
              aria-label="Search"
              className={`h-9 px-3 bg-g rounded-[10px] flex items-center justify-center flex-shrink-0
                          transition-transform ${working ? 'cg-leaf-btn-working' : 'hover:opacity-90 active:scale-95'}`}
            >
              <LeafIcon working={working} />
            </button>
          </div>
        </div>

        {/* Status ticker — sits directly under the box, single line, swaps
            text every ~1.1s. Cream background, no card. Tiny green dot to
            the left to echo the "working" state. Mirrors Claude's bottom-bar
            status line. */}
        {working && (
          <div className="mt-2 px-2 flex items-center gap-2" aria-live="polite">
            <span className="w-1.5 h-1.5 rounded-full bg-g animate-pulse flex-shrink-0" />
            <p className="text-[11px] text-gd font-bold leading-snug truncate">
              {statusLines[Math.min(statusIdx, statusLines.length - 1)]}…
            </p>
          </div>
        )}

        {/* Direction switch — flip between find / spotlight intents. Hidden
            while the ticker is running so the user doesn't accidentally swap
            mid-submit. */}
        {!working && (
          <button
            type="button"
            onClick={() => setIntent(prev => prev === 'find' ? 'spotlight' : 'find')}
            className="w-full mt-2 px-2 py-2 flex items-center gap-2 text-left
                       hover:opacity-90 transition-opacity"
            aria-pressed={intent === 'spotlight'}
          >
            <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 transition-colors
                              ${intent === 'spotlight' ? 'bg-g' : 'bg-b3/40'}`} />
            <p className={`flex-1 text-[11px] leading-snug font-medium
                           ${intent === 'spotlight' ? 'text-gd' : 'text-b3'}`}>
              {intent === 'find'
                ? <>Offer a service to a Connector in exchange for an <span className="font-bold">Instagram or TikTok post</span></>
                : <>Need to <span className="font-bold">book a service</span> instead?</>}
            </p>
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none"
                 stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"
                 className={`flex-shrink-0 transition-transform ${intent === 'spotlight' ? 'text-g rotate-180' : 'text-b3'}`}>
              <path d="M3 12h18M13 6l6 6-6 6" />
            </svg>
          </button>
        )}
      </div>

      {/* Example chips — conversational, one tap to seed /intake. */}
      <div className="flex flex-wrap gap-1.5 px-5 mt-2 mb-4">
        {(intent === 'find' ? FIND_EXAMPLES : SPOTLIGHT_EXAMPLES).map(e => (
          <button
            key={e.label}
            onClick={() => startTask(e.task)}
            className="bg-white border border-bdr rounded-pill px-2.5 py-1
                       text-[11px] font-bold text-b2 cursor-pointer
                       hover:border-g hover:text-gd transition-colors"
          >
            {e.label}
          </button>
        ))}
      </div>

      {/* Invite & earn ad card — replaces the old "Friends recently booked"
          strip. Big green hero number, single CTA. Network-effect engine:
          gets more friends on Cergio so the friends-of-friends value prop
          fills in. Only shown in find mode (in spotlight mode the user is
          focused on Connector outreach, different headspace). */}
      {intent === 'find' && (
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
            showToast('Verified ✓ — opening chat with your photos');
            const text = query.trim();
            navigate('/intake', { state: { initialMessage: text } });
          }}
        />
      )}
    </div>
  );
}
