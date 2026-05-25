import { useEffect, useRef, useState } from 'react';
import { useNavigate, useOutletContext } from 'react-router-dom';
import { Logo } from '../components/ui/Logo';
import { CATEGORIES, FEED } from '../data/mock';
import { CcGateModal } from '../components/ui/CcGateModal';
import { AddressAutocomplete } from '../components/ui/AddressAutocomplete';
import { getMyCcStatus, getDefaultAddress, saveAddress, listMyServices } from '../lib/api';

const BUNDLES = [
  { icon: '💍', label: 'Plan my wedding', task: 'Plan my wedding' },
  { icon: '🏠', label: 'Move in bundle',  task: 'Set up my new home' },
  { icon: '🎂', label: 'Birthday party',  task: 'Birthday party' },
  { icon: '🔨', label: 'Kitchen reno',    task: 'Renovate my kitchen' },
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
  const [activeCat, setActiveCat] = useState('cleaning');
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

      {/* greeting — Profile is the canon (30px h1). Headline doubles as
          guidance; subtitle (15px b3 medium) mirrors Profile's row-subtitle
          treatment so the whole app reads as one type system. */}
      <div className="px-5 pt-4 pb-1">
        <h1 className="text-[30px] font-extrabold text-black leading-tight">
          {intent === 'find'
            ? <>What do you <span className="text-g">need done?</span></>
            : <>Get a <span className="text-g">Connector spotlight</span></>}
        </h1>
        <p className="text-[15px] text-b3 leading-snug mt-1.5 font-medium">
          {intent === 'find'
            ? "Tell me what you need — I'll find someone trusted by friends-of-friends."
            : "Describe your service + audience target. We'll match you with Connectors."}
        </p>
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
          <p className="px-5 pb-1 text-[11px] text-b3 leading-snug">
            {intent === 'find' ? (
              <>Tip — say it like a friend would:{' '}
                <span className="font-bold text-b2">"deep clean Mon 2pm, max $200"</span>.</>
            ) : (
              <>Tip — be specific about audience:{' '}
                <span className="font-bold text-b2">"foodie Connector, NYC, 5K+ followers"</span>.</>
            )}
          </p>

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

            <button
              type="button"
              onClick={() => navigate('/rainmakers')}
              className="text-[11px] font-bold text-b3 underline underline-offset-2 hover:text-g transition-colors"
            >
              {intent === 'find' ? 'Learn how' : 'Connector FAQ'}
            </button>
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
        {/* Intent toggle — flips the search box from "I need a service"
            (default) to "I offer a service and want a Connector to spotlight
            it". Stays compact + adjacent to the box so it reads as a mode
            switch, not a separate CTA. Replaces the old standalone "Have a
            service?" card per design direction. */}
        <button
          type="button"
          onClick={() => setIntent(prev => prev === 'find' ? 'spotlight' : 'find')}
          className={`w-full mt-3 rounded-[16px] px-4 py-3 flex items-center gap-3 text-left
                      transition-colors border
                      ${intent === 'spotlight'
                        ? 'bg-gl border-g/40'
                        : 'bg-white border-bdr hover:border-g/40'}`}
          aria-pressed={intent === 'spotlight'}
        >
          <div className={`w-9 h-9 rounded-full flex items-center justify-center flex-shrink-0
                          ${intent === 'spotlight' ? 'bg-g' : 'bg-gl'}`}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none"
                 stroke={intent === 'spotlight' ? 'white' : '#3D8B00'}
                 strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/>
            </svg>
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-[14px] font-extrabold text-black leading-tight">
              Have a service? Offer it free for a spotlight
            </p>
            <p className="text-[12px] text-b3 mt-0.5 leading-snug">
              {intent === 'spotlight'
                ? "On ✓ — describe what you offer + your ideal Connector above."
                : 'Trade a free job for an Instagram or TikTok post by an influencer.'}
            </p>
          </div>
          {/* Small toggle pill — visual on/off cue */}
          <span className={`flex-shrink-0 w-9 h-5 rounded-pill flex items-center transition-colors
                            ${intent === 'spotlight' ? 'bg-g justify-end' : 'bg-bdr justify-start'}`}>
            <span className="w-4 h-4 rounded-full bg-white mx-0.5 shadow-card" />
          </span>
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
