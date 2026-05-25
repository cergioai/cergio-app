import { useEffect, useRef, useState } from 'react';
import { useNavigate, useOutletContext } from 'react-router-dom';
import { Logo } from '../components/ui/Logo';
import { FEED } from '../data/mock';
import { CcGateModal } from '../components/ui/CcGateModal';
import { AddressAutocomplete } from '../components/ui/AddressAutocomplete';
import { getMyCcStatus, getDefaultAddress, saveAddress, listMyServices } from '../lib/api';

// Examples — mix of single tasks + bundles with budget hints. Replaces
// the old icon-pill category strip that was redundant with the search box.
const EXAMPLES = [
  { label: 'Plan my wedding under $100k',  task: 'Plan my wedding under $100k' },
  { label: 'Help me move under $1,000',    task: 'Help me move under $1,000' },
  { label: 'Deep clean my home',           task: 'Deep clean my home' },
  { label: 'Birthday party under $5k',     task: 'Birthday party under $5,000' },
  { label: 'Find me a dog walker',         task: 'Find a dog walker' },
  { label: 'Renovate my kitchen under $50k', task: 'Renovate my kitchen under $50k' },
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

// CcGateModal moved to its own file (../components/ui/CcGateModal.jsx) and
// now uses a real Stripe SetupIntent flow. Import is at the top of this file.

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
  // Per Tarik: if user has no service listed yet, route through /list-service
  // first so they have something to spotlight.
  const [intent, setIntent] = useState('find');
  const [hasService, setHasService] = useState(null); // null=unknown, true/false once loaded
  const inputRef = useRef(null);
  const fileRef = useRef(null);
  const modeBtnRef = useRef(null);

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

  // Location — prefilled from the user's saved default address. Editing
  // expands an AddressAutocomplete; picking a Place auto-saves it as the
  // new default so future visits land on it.
  const [locationText, setLocationText] = useState('');
  const [locationCoords, setLocationCoords] = useState(null);
  const [locEditing, setLocEditing] = useState(false);
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

  // Submit the home-bar query — branches on `intent`:
  //   - 'find' (default): route to /intake with the typed text as the chat's
  //     first user message. useChat parses it (service + when + where + budget)
  //     and skips ahead to whatever's missing. Images gate behind CC.
  //   - 'spotlight': user is offering a service to Connectors.
  //       • not signed in → /auth
  //       • signed in, no service listed → /list-service (with a toast)
  //       • signed in, has service(s) → /connectors/browse with the typed
  //         pitch in state so the next screen can pre-populate the request.
  const submitSpotlight = () => {
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
    navigate('/connectors/browse', { state: { pitch: query.trim() } });
  };
  const submitQuery = () => {
    if (intent === 'spotlight') { submitSpotlight(); return; }
    // Anti-abuse gate: photo uploads require CC verification (SetupIntent).
    // Signed-out users get redirected to /auth — can't verify without a profile.
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
    // TODO: pass images through to /intake once chat supports attachments.
    navigate('/intake', {
      state: {
        initialMessage:  text,
        initialLocation: locationText,
        initialCoords:   locationCoords,
      },
    });
  };

  // Image attach handler — read selected files as data URLs so we can
  // preview thumbs inline. Real upload happens once the user signs in +
  // passes the identity gate (deferred to a follow-up commit).
  const onFilesPicked = (e) => {
    const files = Array.from(e.target.files || []).slice(0, 4); // cap at 4
    files.forEach(file => {
      const reader = new FileReader();
      reader.onload = () => {
        setImages(prev => [...prev, { name: file.name, dataUrl: reader.result }].slice(0, 4));
      };
      reader.readAsDataURL(file);
    });
    e.target.value = ''; // allow re-picking same file later
  };

  const removeImage = (i) => setImages(prev => prev.filter((_, idx) => idx !== i));

  return (
    <div className="flex-1 overflow-y-auto pb-20 bg-cream">

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

      {/* Cergio's voice headline — first-person greeting that flips with
          intent. In find mode (default): negotiate-and-book promise.
          In spotlight mode: prompt the provider to describe themselves +
          their ideal audience, with an example so they know the shape
          of what to type. */}
      <div className="px-5 pt-4 pb-1">
        <h1 className="text-[22px] font-extrabold text-black leading-snug">
          {intent === 'find'
            ? <>Hi, I'm Cergio — I'll <span className="text-g">negotiate and book</span> services your friends trust.</>
            : <>Hi, I'm Cergio — describe your <span className="text-g">service and ideal audience</span>.</>}
        </h1>
        {intent === 'spotlight' && (
          <p className="text-[13px] text-b3 leading-snug mt-1.5 font-medium italic">
            e.g. boxing trainer, want a fitness Connector with 10K+ followers.
          </p>
        )}
      </div>

      {/* Location chip — shows the user's default address (from user_addresses
          table). Tap "Change" to swap, which opens Google Places autocomplete
          inline and auto-saves the pick as the new default. */}
      <div className="px-5 mt-1 mb-2 flex items-center gap-2 text-[12px] text-b3">
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
                // Auto-save as default for next visit. Best-effort.
                if (auth?.isSignedIn) {
                  await saveAddress({
                    label: 'Home',
                    formattedAddress: address,
                    lat, lng,
                    makeDefault: true,
                  }).catch(() => {});
                }
              }}
              placeholder="Add your address"
              className=""
            />
            <button onClick={() => setLocEditing(false)}
              className="text-[12px] font-extrabold text-b3">Cancel</button>
          </div>
        ) : (
          <>
            <span className="flex-1 truncate font-bold text-b2">
              {locationText || 'Add your address'}
            </span>
            <button onClick={() => setLocEditing(true)}
              className="text-[12px] font-extrabold text-g underline underline-offset-2">
              {locationText ? 'Change' : 'Set'}
            </button>
          </>
        )}
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
            placeholder={intent === 'find'
              ? 'Tell me what you need…  e.g. deep clean Mon 2pm, flexible, max $200'
              : "Describe your service + ideal audience… e.g. yoga studio in Brooklyn, want a fitness Connector w/ 10K+"}
            rows={2}
            className="w-full bg-transparent outline-none resize-none px-5 pt-4 pb-2
                       text-[15px] text-black placeholder-b3 font-medium leading-snug"
          />
          {/* Image thumbnails — shown above the toolbar when attached.
              Tap × to remove. Cap of 4 enforced in onFilesPicked. */}
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

          {/* Hint inside the box, left-aligned. Subtle so it doesn't compete
              with the input but visible enough to teach the "dump it all in
              one go" pattern. */}
          {/* Tip hint removed — was redundant with placeholder. */}

          {/* row 2: chip toolbar — + attach, mode dropdown, then send arrow. */}
          <div className="flex items-center gap-2 px-3 pb-3 pt-1">
            {/* + attach button (Claude-style). Hidden file input triggered
                via click. Submission with images is gated behind the
                credit-card identity modal. */}
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
              {/* Ultra-thin SVG plus — Claude style */}
              <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                <path d="M7 1.5v11M1.5 7h11" stroke="currentColor"
                      strokeWidth="1.4" strokeLinecap="round" />
              </svg>
            </button>

            {/* Mode dropdown — Free vs Pay only makes sense in the FIND
                direction. In spotlight intent the user IS the provider, so
                we hide the picker to keep the toolbar uncluttered. */}
            {intent === 'find' && (
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
                <div role="listbox" className="absolute top-full mt-1.5 left-0 z-10 bg-white border border-bdr rounded-[14px] shadow-card py-1 min-w-[200px]">
                  <ModeOption
                    active={freeServices}
                    label="Free for Connectors"
                    sub="Providers offer free in exchange for IG/TT post"
                    onClick={() => { setFreeServices(true); setModeOpen(false); }}
                  />
                  <ModeOption
                    active={!freeServices}
                    label="Pay full price"
                    sub="Normal paid booking"
                    onClick={() => { setFreeServices(false); setModeOpen(false); }}
                  />
                </div>
              )}
            </div>
            )}

            {/* FAQ link removed — the flip-line under the box now carries
                the "Learn about Connectors" message in find mode. */}
            <div className="flex-1" />
            {/* Send — green circle with up arrow (small cute), matches Claude */}
            <button
              type="button"
              onClick={submitQuery}
              aria-label="Search"
              className="w-9 h-9 bg-g rounded-full flex items-center justify-center flex-shrink-0
                         hover:opacity-90 active:scale-95 transition-transform"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
                <path d="M12 19V5M5 12l7-7 7 7" stroke="white"
                      strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </button>
          </div>
        </div>
        {/* Direction switch — sits on cream (no card), tiny type. Tap to
            flip search direction. In find mode this prompts providers
            ("Have a service? Learn about Connectors →") and in spotlight
            mode it offers the way back ("Need to book a service? →"). */}
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
          {/* Flip arrow — tiny rotating chevron */}
          <svg width="11" height="11" viewBox="0 0 24 24" fill="none"
               stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"
               className={`flex-shrink-0 transition-transform ${intent === 'spotlight' ? 'text-g rotate-180' : 'text-b3'}`}>
            <path d="M3 12h18M13 6l6 6-6 6" />
          </svg>
        </button>
      </div>

      {/* Examples — single tasks + bundles with budget hints. Replaces
          the old category pills row entirely. Tapping seeds /intake. */}
      <p className="px-5 text-[11px] font-extrabold uppercase tracking-widest text-b3 mt-2 mb-3">
        Try one of these
      </p>
      <div className="flex flex-wrap gap-2 px-5 mb-6">
        {EXAMPLES.map(e => (
          <button
            key={e.label}
            onClick={() => startTask(e.task)}
            className="bg-white border border-bdr rounded-pill px-3.5 py-1.5
                       text-[12px] font-bold text-b2 cursor-pointer hover:border-g hover:text-gd transition-colors"
          >
            {e.label}
          </button>
        ))}
      </div>

      {/* Connector banner removed — entry point is now the "Learn how" link
          under the free-services toggle at the top of this screen. */}

      {/* CC identity gate — fires when user submits with images attached.
          On verify, we flip local state + re-fire submit so the in-progress
          query (with photos) lands in /intake without making the user click
          again. */}
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
