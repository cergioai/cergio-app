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
import { LeafLogo } from '../components/ui/LeafLogo';
import { AddressAutocomplete } from '../components/ui/AddressAutocomplete';
import { LocationEditModal } from '../components/ui/LocationEditModal';
import { ServiceAreaMapPicker } from '../components/ui/ServiceAreaMapPicker';
import { getMyCcStatus, getDefaultAddress, saveAddress, listMyServices } from '../lib/api';
import { REWARDS, REWARD_COPY } from '../lib/rewards';

// Rotating example overlays — shown one at a time inside the search box
// when the input is empty. They cross-fade every ~4.5s like Claude's
// suggestion carousel. Tap an example to populate the input.
const ROTATING_FIND_EXAMPLES = [
  { hint: 'e.g. deep cleaning under $200 this tuesday',         task: 'Need deep cleaning under $200 this tuesday' },
  { hint: 'e.g. Spanish-speaking sitter tue night, max $55',    task: 'Need a babysitter who speaks Spanish Tuesday night under $55' },
  { hint: 'e.g. dog walker after 5pm, $40',                     task: 'Need a dog walker after 5pm under $40' },
];
const ROTATING_SPOTLIGHT_EXAMPLES = [
  { hint: 'e.g. Instagram pets Connector w/ 5K+ to spotlight my dog training',     task: 'Need an Instagram pets Connector w/ 5K+ followers to spotlight my new dog training program' },
  { hint: 'e.g. Instagram fashion Connector w/ 7K+ for my private chef',           task: 'Need an Instagram fashion Connector w/ 7K+ followers to spotlight my private chef service' },
  { hint: 'e.g. Instagram fitness Connector w/ 10K+ for my yoga studio',           task: 'Need an Instagram fitness Connector w/ 10K+ followers to spotlight my new yoga studio' },
];

// Engine plan — what the "backend" appears to be doing, in order. Each
// stage has a label (status text), an optional dynamic detail (provider
// count, etc.), and a duration. After the last stage we surface a result
// CTA pointing the user at their inbox.
function buildFindPlan() {
  // Friend-recommended provider pool — picked from the same mock cohort
  // the Activity tab uses. Real backend will replace this with the live
  // friends-of-friends recommendation set.
  // Stage durations doubled (~2x) so each notification lingers long
  // enough to actually read before the next one swaps in.
  const pool = [
    { name: 'Jamie (cleaning)',  by: 'Sara' },
    { name: 'John (handyman)',   by: 'Mike' },
    { name: 'Steve (mover)',     by: 'Lily' },
    { name: 'Ana (sitter)',      by: 'Priya' },
  ];
  return [
    { label: "Selecting providers your friends recommend",   ms: 2200 },
    { label: `Found ${pool.length} in your network`,         ms: 1800, detail: pool.map(p => p.name).join(' · ') },
    { label: 'Notifying providers',                          ms: 2200 },
    { label: 'Negotiating offers on your behalf',            ms: 2600 },
    { label: 'Awaiting first offer',                         ms: 1800 },
  ];
}
function buildSpotlightPlan() {
  // Stage durations doubled to match the find plan's pacing.
  return [
    { label: 'Matching Connectors who fit your audience',    ms: 2200 },
    { label: 'Found 6 Connectors in your area',              ms: 1800, detail: 'Pets · Fitness · Fashion · Food · Local · Lifestyle' },
    { label: 'Checking follower overlap',                    ms: 2200 },
    { label: 'Sending your pitch',                           ms: 2200 },
    { label: 'Awaiting Connector responses',                 ms: 1800 },
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

// LeafLogo moved to ../components/ui/LeafLogo so other screens
// (ResultsScreen header + status, etc.) share the same brand mark.

// localStorage key for signed-out users' "guest" address. Replaced by the
// server-side default once they sign in (auth flip reloads from Supabase).
const GUEST_ADDR_KEY = 'cergio.guestAddress';

// ─── Inline location editor ─────────────────────────────────────────────────
// Compact in-place editor for the address chip at the top of Home. Replaces
// the old bottom-sheet modal so the input is visible IMMEDIATELY adjacent
// to the chip — no page-jump, no overlay. Same two-tier verification
// (Google → Nominatim fallback) and persistent inline status as the
// modal version, just sized for inline use.
function InlineLocationEditor({ initialAddress, initialCoords, isSignedIn, onSaved, onCancel }) {
  const [text, setText] = useState(initialAddress || '');
  const [coords, setCoords] = useState(initialCoords || null);
  const [placeId, setPlaceId] = useState(null);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState(null); // { kind: 'info'|'warn'|'ok', text }

  const handleSelect = ({ lat, lng, address, placeId: pid }) => {
    if (address) setText(address);
    if (lat && lng) setCoords({ lat, lng });
    if (pid) setPlaceId(pid);
    setStatus(null);
  };

  const handleSave = async () => {
    const typed = (text || '').trim();
    if (!typed) { setStatus({ kind: 'warn', text: 'Type an address first.' }); return; }
    if (busy) return;
    setBusy(true);
    setStatus({ kind: 'info', text: 'Saving…' });

    // Always persist locally first — the user is never stuck.
    try {
      localStorage.setItem(GUEST_ADDR_KEY, JSON.stringify({
        address: typed,
        lat:     coords?.lat ?? null,
        lng:     coords?.lng ?? null,
        placeId: placeId ?? null,
      }));
    } catch { /* ignore */ }

    let final = { address: typed, lat: coords?.lat ?? null, lng: coords?.lng ?? null, placeId };
    const { verifyAddress } = await import('../lib/google');
    const v = await verifyAddress(typed);
    if (v.ok) {
      final = { address: v.address, lat: v.lat, lng: v.lng, placeId: v.placeId };
      try {
        localStorage.setItem(GUEST_ADDR_KEY, JSON.stringify({
          address: final.address, lat: final.lat, lng: final.lng, placeId: final.placeId,
        }));
      } catch { /* ignore */ }
    } else if (v.reason !== 'no-key') {
      setStatus({ kind: 'warn', text: `Saved as typed — couldn't verify "${typed}".` });
    }

    if (isSignedIn) {
      try {
        const { saveAddress } = await import('../lib/api');
        const { error } = await saveAddress({
          label: 'Home',
          formattedAddress: final.address,
          lat: final.lat, lng: final.lng,
          placeId: final.placeId,
          makeDefault: true,
        });
        if (error && !/relation|does not exist|schema cache/i.test(error.message || '')) {
          setStatus({ kind: 'warn', text: `Saved locally. Server sync failed: ${error.message}` });
        }
      } catch (e) {
        setStatus({ kind: 'warn', text: `Saved locally. Sync error.` });
      }
    }

    setBusy(false);
    onSaved?.(final);
  };

  return (
    <div className="flex-1 flex flex-col gap-1 min-w-0">
      <div className="flex items-center gap-1.5">
        <div className="flex-1 min-w-0">
          <AddressAutocomplete
            value={text}
            onChange={setText}
            onSelect={handleSelect}
            placeholder="Type your address…"
            className="w-full bg-bg5 rounded-[10px] px-3 py-1.5 text-[12px] text-black placeholder-b3 outline-none focus:ring-2 focus:ring-g/30"
          />
        </div>
        <button
          type="button"
          onClick={handleSave}
          disabled={busy || !text.trim()}
          className={`text-[11px] font-extrabold underline underline-offset-2 px-1
            ${busy || !text.trim() ? 'text-b3 cursor-not-allowed' : 'text-g'}`}
        >
          {busy ? '…' : 'Save'}
        </button>
        <button
          type="button"
          onClick={onCancel}
          disabled={busy}
          className="text-[11px] font-normal text-b3 underline underline-offset-2 px-1"
        >
          Cancel
        </button>
      </div>
      {status && (
        <p className={`text-[10px] leading-snug pl-1 ${status.kind === 'warn' ? 'text-warnText' : status.kind === 'ok' ? 'text-gd' : 'text-b3'}`}>
          {status.text}
        </p>
      )}
    </div>
  );
}

// sessionStorage marker — once the Hi-I'm-Cergio toast has played in this
// browser session, we skip it on subsequent Home mounts. Resets when the
// tab/window closes (session storage scope).
const TOAST_SHOWN_KEY = 'cergio.toastShown';

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
  // CERGIO-GUARD (2026-05-30 v2): budget no longer a Home pill — it's
  // now asked as a chat prompt like when/where (see useChat reply gate).
  // Home stays clean; the chat captures the value as part of the
  // existing question flow.
  const [showCcGate, setShowCcGate] = useState(false);
  const [ccVerified, setCcVerified] = useState(false);
  const [intent, setIntent] = useState('find');
  const [hasService, setHasService] = useState(null);
  const [reply, setReply] = useState('');   // inline mini-chat reply input
  const [exampleIdx, setExampleIdx] = useState(0); // rotating example overlay
  const inputRef = useRef(null);
  const fileRef = useRef(null);
  const modeBtnRef = useRef(null);
  const replyRef = useRef(null);
  const threadRef = useRef(null);

  // Headline phase — 'rolling' shows the long Cergio greeting word-by-
  // word as a toast. 'collapsed' shows the compact persistent line.
  // Initial value reads sessionStorage: if the toast has already played
  // this session, we go straight to collapsed (no replay on intent flip
  // or route round-trip).
  const [headlinePhase, setHeadlinePhase] = useState(() => {
    try {
      if (sessionStorage.getItem(TOAST_SHOWN_KEY)) return 'collapsed';
    } catch { /* ignore */ }
    return 'rolling';
  });

  // CERGIO-GUARD: when the user got bounced to /auth from submit, we
  // stashed their query in sessionStorage so they don't lose it. On
  // the way back in (signed in now), restore + auto-submit. Survives
  // the OAuth round-trip.
  useEffect(() => {
    if (!auth?.isSignedIn) return;
    try {
      const raw = sessionStorage.getItem('cergio.pendingQuery');
      if (!raw) return;
      const pending = JSON.parse(raw);
      sessionStorage.removeItem('cergio.pendingQuery');
      // Bail if the stash is stale (>15min) — assume user dropped intent.
      if (Date.now() - (pending.ts || 0) > 15 * 60 * 1000) return;
      if (pending.intent && pending.intent !== intent) setIntent(pending.intent);
      if (pending.query)   setQuery(pending.query);
      // Don't auto-submit — let the user re-confirm with one tap. Less
      // surprising than firing a request the moment they sign in.
      showToast('Welcome back — your request is queued. Tap send.', { sticky: false });
    } catch { /* ignore */ }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [auth?.isSignedIn]);

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

  // Location — read localStorage synchronously on FIRST render via the
  // useState initializer so the chip is painted on the very first paint,
  // not after a re-render. This is the difference between "address
  // sticks" and "address blank for a frame, then appears". The lazy
  // initializer runs once per mount.
  const [locationText, setLocationText] = useState(() => {
    try {
      const raw = localStorage.getItem(GUEST_ADDR_KEY);
      if (!raw) return '';
      const g = JSON.parse(raw);
      return g?.address || '';
    } catch { return ''; }
  });
  const [locationCoords, setLocationCoords] = useState(() => {
    try {
      const raw = localStorage.getItem(GUEST_ADDR_KEY);
      if (!raw) return null;
      const g = JSON.parse(raw);
      if (g?.lat != null && g?.lng != null) return { lat: g.lat, lng: g.lng };
      return null;
    } catch { return null; }
  });
  const [locEditing, setLocEditing] = useState(false);
  const [travelRadius, setTravelRadius] = useState('10mi');
  // CERGIO-GUARD (2026-05-30): polygon service-area (Zillow-style).
  // When set, supersedes travelRadius for spotlight intent — the
  // provider has drawn an explicit area instead of picking a radius.
  // Persisted later (separate slice); session state for now.
  const [serviceAreaGeoJson, setServiceAreaGeoJson] = useState(null);
  const [areaPickerOpen, setAreaPickerOpen]         = useState(false);

  // Persist the address the chat parser captures.
  // CERGIO-GUARD: verify via Google before saving as the default. If
  // verification succeeds we replace the chat's raw text with the
  // canonical formatted_address + real lat/lng. If it fails we still
  // keep the typed text in locationText (so the UI doesn't lose it)
  // but skip the saveAddress call so we don't persist a bogus address.
  // CERGIO-GUARD: this effect MIRRORS new addresses captured INSIDE the
  // chat (e.g. user types "the address is 123 Main St" mid-conversation)
  // into the top-of-screen location chip. It must NOT fight a manual
  // edit. Bug we hit: had `locationText` in the deps, so every time the
  // user typed a new address via InlineLocationEditor and we updated
  // locationText, this effect re-fired, saw chat.state.where was still
  // the OLD value, and reverted locationText back. Result: manual saves
  // appeared to revert to the old address.
  //
  // Fix: track the last chat-where value we synced via a ref. Only sync
  // when chat.state.where CHANGES (not when locationText changes), and
  // don't include locationText in deps. Each chat.state.where transition
  // syncs exactly once.
  const lastChatWhereSyncedRef = useRef(null);
  useEffect(() => {
    const where = chat?.state?.where;
    if (!where) return;
    if (lastChatWhereSyncedRef.current === where) return; // already synced this value
    lastChatWhereSyncedRef.current = where;
    if (where === locationText) return; // already in sync — nothing to do

    setLocationText(where);
    // Mirror to localStorage as-is for immediate fallback.
    try {
      const existing = JSON.parse(localStorage.getItem(GUEST_ADDR_KEY) || '{}');
      localStorage.setItem(GUEST_ADDR_KEY, JSON.stringify({ ...existing, address: where }));
    } catch { /* ignore */ }
    // Verify then persist.
    (async () => {
      const { verifyAddress } = await import('../lib/google');
      const v = await verifyAddress(where);
      if (!v.ok) return; // unverified — don't promote to canonical default
      setLocationText(v.address);
      setLocationCoords({ lat: v.lat, lng: v.lng });
      try {
        localStorage.setItem(GUEST_ADDR_KEY, JSON.stringify({
          address: v.address, lat: v.lat, lng: v.lng, placeId: v.placeId,
        }));
      } catch { /* ignore */ }
      if (auth?.isSignedIn) {
        saveAddress({
          label: 'Home',
          formattedAddress: v.address,
          lat: v.lat, lng: v.lng,
          placeId: v.placeId,
          makeDefault: true,
        }).catch(() => { /* metadata write path 1 succeeds anyway */ });
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chat?.state?.where, auth?.isSignedIn]);

  // Mirror locationText → localStorage on every change. This is the
  // safety net: even if the user types an address without picking a
  // Google Places suggestion (no onSelect), the typed value still
  // persists across reloads. Previously only the onSelect path saved,
  // so typed-but-not-picked addresses were lost on refresh.
  useEffect(() => {
    if (!locationText) return;
    try {
      const existing = JSON.parse(localStorage.getItem(GUEST_ADDR_KEY) || '{}');
      const next = {
        ...existing,
        address: locationText,
        lat:     locationCoords?.lat ?? existing.lat ?? null,
        lng:     locationCoords?.lng ?? existing.lng ?? null,
      };
      // Only write if something actually changed — avoids redundant
      // writes that could cause React to loop.
      if (existing.address !== next.address
          || existing.lat !== next.lat
          || existing.lng !== next.lng) {
        localStorage.setItem(GUEST_ADDR_KEY, JSON.stringify(next));
      }
    } catch { /* ignore */ }
  }, [locationText, locationCoords]);

  useEffect(() => {
    // Server-side default for signed-in users. Local cache already
    // painted the chip on first render via the useState initializer
    // above, so this is the canonical-truth refresh.
    //
    // Critical bridge: if Supabase has no default for this user BUT
    // localStorage has one (e.g. address was captured during a guest
    // session, or saveAddress failed silently), we PROMOTE the local
    // address up to Supabase here. That way subsequent logins survive
    // localStorage clears, and the address actually lives in the
    // user_addresses table where it belongs.

    if (!auth?.isSignedIn) return;
    getDefaultAddress().then(async ({ data }) => {
      if (data?.formatted_address) {
        setLocationText(data.formatted_address);
        if (data.lat != null && data.lng != null) {
          setLocationCoords({ lat: data.lat, lng: data.lng });
        }
        try {
          localStorage.setItem(GUEST_ADDR_KEY, JSON.stringify({
            address: data.formatted_address,
            lat:     data.lat ?? null,
            lng:     data.lng ?? null,
            placeId: data.place_id ?? null,
          }));
        } catch { /* ignore */ }
        return;
      }
      // Server has no default — try to promote whatever localStorage holds.
      try {
        const raw = localStorage.getItem(GUEST_ADDR_KEY);
        if (!raw) return;
        const g = JSON.parse(raw);
        if (!g?.address) return;
        await saveAddress({
          label: 'Home',
          formattedAddress: g.address,
          lat:     g.lat     ?? null,
          lng:     g.lng     ?? null,
          placeId: g.placeId ?? null,
          makeDefault: true,
        });
        // Update local state so the chip shows even if it was empty.
        setLocationText(g.address);
        if (g.lat != null && g.lng != null) setLocationCoords({ lat: g.lat, lng: g.lng });
      } catch { /* ignore — chip will still paint from localStorage on next mount */ }
    });
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

  // Rotating example placeholder — advances through ROTATING_*_EXAMPLES
  // one at a time (every ~6.75s, 50% slower than before). After ONE full
  // pass (idx reaches list.length-1) the rotation freezes on the final
  // example — no infinite loop. Resets if intent changes or query clears.
  useEffect(() => {
    setExampleIdx(0);
    if (submitted) return;
    if (query) return;
    const list = intent === 'spotlight' ? ROTATING_SPOTLIGHT_EXAMPLES : ROTATING_FIND_EXAMPLES;
    let tick = 0;
    const t = setInterval(() => {
      tick += 1;
      setExampleIdx(tick);
      if (tick >= list.length - 1) {
        clearInterval(t);
      }
    }, 6750);
    return () => clearInterval(t);
  }, [intent, submitted, query]);

  // Headline toast lifecycle — collapses to the compact line after ~9s
  // (matches the 2x-slowed word roll-in). Only plays if we're actually
  // in 'rolling' phase (i.e. first time this session). Submitting or
  // intent flipping jumps straight to collapsed without replaying.
  useEffect(() => {
    if (submitted) { setHeadlinePhase('collapsed'); return; }
    if (headlinePhase !== 'rolling') return;
    const t = setTimeout(() => {
      setHeadlinePhase('collapsed');
      try { sessionStorage.setItem(TOAST_SHOWN_KEY, '1'); } catch { /* ignore */ }
    }, 9000);
    return () => clearTimeout(t);
  }, [submitted, headlinePhase]);

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
    // CERGIO-GUARD: every find-mode + spotlight submit MUST require a
    // signed-in account. Cergio fires real notifications to providers
    // and Connectors when a request is processed — we cannot allow
    // anonymous spam / fake requests / scraped content to be blasted
    // out under no identity. Sign-in is the absolute floor; identity
    // verification (CC matching name) is the second gate enforced at
    // booking + spotlight-payment time via CcGateModal / Stripe.
    if (!auth?.isSignedIn) {
      // Cache the query so the user lands back here with it filled in
      // after signing in (sessionStorage survives the auth round-trip).
      try {
        sessionStorage.setItem('cergio.pendingQuery', JSON.stringify({
          query, intent, locationText, ts: Date.now(),
        }));
      } catch { /* private mode */ }
      showToast('Sign in to send your request — we ping real providers.', { sticky: true });
      navigate('/auth');
      return;
    }
    // Spotlight-mode pre-checks — same as before, but if user passes
    // them we run the engine here instead of routing.
    if (intent === 'spotlight') {
      if (hasService === false) {
        showToast("First list your service — we'll bring you right back.");
        navigate('/list-service');
        return;
      }
    } else if (images.length > 0 && !ccVerified) {
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

    // Spotlight requests don't need what/when/where — the pitch already
    // contains the Connector niche, follower threshold, and the service
    // being spotlighted. Skip the chat parser and run the engine right
    // away so the user doesn't get asked irrelevant booking questions.
    if (intent === 'spotlight') {
      setEngineStarted(true);
      startEngine('spotlight');
      return;
    }

    // Find mode: kick off the chat parser inline. If everything is
    // captured in the first message it goes straight to phase 'ready'
    // and the engine starts. Otherwise Cergio asks for the missing
    // field (what / when / where) right here on Home — no /intake
    // redirect.
    chat?.init?.({
      initialMessage:  text,
      default_address: locationText || null,
      is_repeat_user:  !!auth?.isSignedIn,
    });
  };

  // CERGIO-GUARD: find-mode submit MUST route to /results — the SRP
  // is where the real Supabase search lives. Do not short-circuit this
  // into a mock CTA on Home. See CHECKLIST.md §1.
  //
  // CERGIO-GUARD (2026-05-28): BEFORE routing to /results, write a
  // `requests` row + fan out notifications to matched providers. The
  // returned request.id is forwarded as nav state so ResultsScreen
  // seeds chat.state.request_id → useRequestActivity polls the real
  // counts → SRP status ticker reflects real engagement. Locked by
  // qa #28. Best-effort: a failed fan-out still routes to /results
  // (with no request_id, the SRP just shows the scripted ticker as
  // a graceful fallback).
  useEffect(() => {
    if (!submitted) return;
    if (intent !== 'find') return;
    if (chat?.phase !== 'ready') return;
    let cancelled = false;
    const t = setTimeout(async () => {
      let requestId = null;
      let notified  = 0;
      try {
        const { createRequestAndFanOut } = await import('../lib/api');
        const s = chat?.state || {};
        // Budget comes from the chat parser's `s.budget` — captured via
        // the chat prompt flow (what → when → where → budget).
        const budgetStr = String(s.budget || '');
        const m = budgetStr.match(/\$?\s*(\d{1,5})/);
        const budgetCents = m ? parseInt(m[1], 10) * 100 : null;
        const res = await createRequestAndFanOut({
          query:         submittedText,
          provider_type: s.provider_type || null,
          category:      s.category || null,
          what:          s.what || null,
          when_text:     s.when || null,
          where_text:    s.where || locationText || null,
          lat:           locationCoords?.lat ?? null,
          lng:           locationCoords?.lng ?? null,
          budget_cents:  budgetCents,
          notifySafe:    !!s.notifySafe,
        });
        if (res?.request?.id) requestId = res.request.id;
        if (typeof res?.notified === 'number') notified = res.notified;
        // eslint-disable-next-line no-console
        if (typeof window !== 'undefined' && window.__cergioDiag !== false) {
          console.log('[CERGIO/request]', { requestId, notified, blocked: res?.blocked || null, err: res?.error?.message || null });
        }
      } catch (e) {
        // eslint-disable-next-line no-console
        console.warn('[CERGIO/request] threw:', e?.message);
      }
      if (cancelled) return;
      navigate('/results', {
        state: { fromHome: true, query: submittedText, requestId, notified },
      });
    }, 700);
    return () => { cancelled = true; clearTimeout(t); };
  }, [chat?.phase, submitted, intent, navigate, submittedText, locationText, locationCoords, chat?.state]);

  // Spotlight mode: keep the Home engine ticker (skipped the chat,
  // started engine directly in submitQuery). When ticker completes
  // route to /connectors/browse with the pitch + location.
  useEffect(() => {
    if (!planDone) return;
    if (intent !== 'spotlight') return;
    const t = setTimeout(() => {
      navigate('/connectors/browse', {
        state: {
          pitch:           submittedText,
          serviceLocation: locationText || null,
          serviceCoords:   locationCoords || null,
          travelRadius,
        },
      });
    }, 600);
    return () => clearTimeout(t);
  }, [planDone, intent, navigate, submittedText, locationText, locationCoords, travelRadius]);

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

  // Pill click — populates input and runs the same submit path. For
  // spotlight pills we skip the chat parser and go straight to the
  // engine (same logic as the typed-submit path).
  const onPillClick = (task) => {
    setQuery(task);
    setTimeout(() => {
      setSubmittedText(task);
      setSubmittedAt(new Date().toISOString());
      setSubmitted(true);
      setEngineStarted(false);
      if (intent === 'spotlight') {
        setEngineStarted(true);
        startEngine('spotlight');
        return;
      }
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
    // Outer container — flex column when submitted (Claude-style: history
    // scrolls in the middle, reply input pinned at bottom). For the
    // pre-submit landing state we keep the single-scroll layout.
    <div className={submitted
      ? 'flex-1 flex flex-col bg-cream pb-20 overflow-hidden min-h-0'
      : 'flex-1 overflow-y-auto pb-20 bg-cream'}>

      {/* Header removed — profile is reachable via the bottom-nav Profile
          tab, so the top-right avatar was redundant. The Cergio brand mark
          now lives inline with the greeting below. */}

      {/* Cergio voice headline — slim, light on the eye. Leaf logo sits
          inline at the start and slowly rotates while the engine is
          thinking (Claude-style). Greeting is personalized for signed-in
          users using their display name. */}
      {/* Headline area — two phases. Phase 1 (rolling): the long Cergio
          greeting rolls in word-by-word, lingers, then fades out
          (toast-style). Phase 2 (collapsed): a compact "Hi {firstName},
          tell me what you need" line + a Start typing ↓ hint. Leaf logo
          persists across both phases (only hidden after submit, when it
          lives next to the streaming status instead). */}
      {(() => {
        const display = auth?.user?.user_metadata?.display_name || '';
        const firstName = display.trim().split(/\s+/)[0] || '';
        const greetingName = firstName ? `Hi ${firstName}` : 'Hi';

        const findLong      = `${greetingName}, I'm Cergio — I'll negotiate and book services your friends trust.`;
        const spotlightLong = `${greetingName}, I'm Cergio — I'll match you with a Connector who can spotlight you on Instagram / TikTok.`;
        const longText      = intent === 'find' ? findLong : spotlightLong;
        const longWords     = longText.split(' ');

        const compactText = intent === 'find'
          ? `${greetingName}, tell me what you need.`
          : `${greetingName}, tell me the Connector you need.`;

        return (
          <div className="px-5 pt-5 pb-0.5 flex items-start gap-2.5">
            {/* CERGIO-GUARD (2026-05-30): pre-submit leaf removed per
                Tarik's UX pass — the brand mark now anchors the
                streaming status block during search instead. Header
                stays clean: just the greeting + the search box. */}
            <div className="flex-1 min-w-0">
              {headlinePhase === 'rolling' && !submitted ? (
                <h1
                  key={`rolling-${intent}`}
                  className="text-[15px] font-normal text-b2 leading-relaxed tracking-tight cg-headline-toast"
                >
                  {longWords.map((w, i) => (
                    <span
                      key={i}
                      className="inline-block cg-word-roll"
                      style={{ animationDelay: `${i * 120}ms` }}
                    >
                      {w}{i < longWords.length - 1 ? ' ' : ''}
                    </span>
                  ))}
                </h1>
              ) : (
                <div className="cg-fade-in-soft">
                  <h1 className="text-[14px] font-normal text-b2 leading-snug">
                    {compactText}
                  </h1>
                  {/* "Start typing" hint moved into the box placeholder
                      below — no separate hint line under the headline. */}
                </div>
              )}
            </div>
          </div>
        );
      })()}

      {/* CERGIO-GUARD (2026-05-30): the location strip used to sit ABOVE
          the search box. Per Tarik's UX pass it's been moved BELOW the
          search box — see the "Searching near …" row inserted between
          the search box and the spotlight link further down. Both
          location AND the IG/TT spotlight link stay visible in the
          same scan path. Easier on the eye, and the "Searching near"
          phrasing ties location explicitly to the active search. */}

      {/* CERGIO-GUARD (2026-05-30): the spotlight travel-radius pills
          used to sit ABOVE the search box. Per Tarik's UX pass they
          now render BELOW the search box (alongside the find-side
          location strip) — see the matching block further down. */}

      {/* ─── Pre-submit: search box ──────────────────────────────────── */}
      {!submitted && (
        <>
          <div className="px-5 py-2">
            <div
              className="bg-white border border-bdr rounded-[24px] transition-all relative
                         focus-within:border-g/60 focus-within:shadow-[0_0_0_3px_#F3FFEA]"
            >
              {/* Rotating example overlay — sits over the textarea when
                  it's empty, cycles through ROTATING_*_EXAMPLES every
                  ~4.5s with a fade in/out. Tap to populate the input.
                  Disappears the moment the user starts typing. */}
              {!query && (() => {
                const list = intent === 'spotlight' ? ROTATING_SPOTLIGHT_EXAMPLES : ROTATING_FIND_EXAMPLES;
                const idx = Math.min(exampleIdx, list.length - 1);
                const cur = list[idx];
                // Last example uses cg-example-settle (fade-in + stay).
                // Earlier ones use cg-example-rotate (fade-in + linger +
                // fade-out) so the next one can swap in cleanly.
                const isLast = idx === list.length - 1;
                return (
                  <button
                    type="button"
                    onClick={() => { setQuery(cur.task); inputRef.current?.focus(); }}
                    aria-label="Use this example"
                    className="absolute top-3 left-4 right-4 text-left z-10 cursor-text"
                  >
                    <span
                      key={`${intent}-${idx}`}
                      className={`block text-[14px] text-b3 font-medium leading-snug ${isLast ? 'cg-example-settle' : 'cg-example-rotate'}`}
                    >
                      {cur.hint}
                    </span>
                  </button>
                );
              })()}
              {/* Textarea — empty placeholder so it doesn't compete with
                  the rotating overlay above. Tall enough that long
                  spotlight pitches fit without internal scroll. */}
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
                placeholder=""
                rows={intent === 'spotlight' ? 4 : 3}
                style={{ minHeight: intent === 'spotlight' ? 96 : 72 }}
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
                    className={`flex items-center gap-1 px-1 text-[12px] font-normal
                                transition-colors
                                ${freeServices ? 'text-gd' : 'text-b3 hover:text-b2'}`}
                  >
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

            {/* CERGIO-GUARD (2026-05-30): location strip — anchored to
                the search box (sits directly below it, no breathing-
                space gap) so the eye reads "I'm searching near X" as
                ONE unit. "Searching near" prefix makes the tie explicit
                so users never wonder if the address is a saved profile
                setting vs a per-search filter. Inline editor expands
                in place on Change. */}
            <div className="mt-2 px-1">
              {!locEditing && locationText && (
                <div className="flex items-center gap-1.5 text-[11px] text-b3">
                  <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                       strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="flex-shrink-0 text-gd">
                    <path d="M12 22s7-7 7-13a7 7 0 0 0-14 0c0 6 7 13 7 13z" />
                    <circle cx="12" cy="9" r="2.5" />
                  </svg>
                  <span className="text-b3 font-normal">Searching near</span>
                  <span className="font-bold text-b2 truncate">{locationText}</span>
                  <button
                    type="button"
                    onClick={() => setLocEditing(true)}
                    className="text-gd font-bold underline underline-offset-2 hover:opacity-80 flex-shrink-0"
                    aria-label="Change search location"
                  >
                    Change
                  </button>
                </div>
              )}
              {!locEditing && !locationText && (
                <button
                  type="button"
                  onClick={() => setLocEditing(true)}
                  className="flex items-center gap-1.5 text-[11px] text-gd font-bold underline underline-offset-2"
                >
                  <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                       strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="flex-shrink-0">
                    <path d="M12 22s7-7 7-13a7 7 0 0 0-14 0c0 6 7 13 7 13z" />
                    <circle cx="12" cy="9" r="2.5" />
                  </svg>
                  Add a search location
                </button>
              )}
              {locEditing && (
                <div className="flex items-start gap-1.5 text-[11px] text-b3">
                  <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                       strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="flex-shrink-0 mt-1 text-gd">
                    <path d="M12 22s7-7 7-13a7 7 0 0 0-14 0c0 6 7 13 7 13z" />
                    <circle cx="12" cy="9" r="2.5" />
                  </svg>
                  <InlineLocationEditor
                    initialAddress={locationText}
                    initialCoords={locationCoords}
                    isSignedIn={!!auth?.isSignedIn}
                    onCancel={() => setLocEditing(false)}
                    onSaved={(saved) => {
                      if (saved?.address) setLocationText(saved.address);
                      if (saved?.lat && saved?.lng) setLocationCoords({ lat: saved.lat, lng: saved.lng });
                      setLocEditing(false);
                    }}
                  />
                </div>
              )}

              {/* CERGIO-GUARD (2026-05-30): spotlight intent — Zillow-style
                  service-area polygon, replacing the old 5/10/25mi pills.
                  Provider taps "Draw your service area" → bottom-sheet
                  map opens centered on their address → freehand drag to
                  outline coverage. The pills row stays as a quick-pick
                  fallback so a provider who just wants "10 mi" doesn't
                  have to touch the map. */}
              {intent === 'spotlight' && locationText && (
                <div className="mt-1.5 flex flex-col gap-1.5">
                  <button
                    onClick={() => setAreaPickerOpen(true)}
                    className={`flex items-center gap-2 px-3 py-2 rounded-[12px] border text-left
                                ${serviceAreaGeoJson
                                  ? 'bg-gl border-g/40 text-gd'
                                  : 'bg-white border-bdr text-b2 hover:border-g/40'}`}
                  >
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                         strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="flex-shrink-0">
                      <path d="M3 7l6-3 6 3 6-3v13l-6 3-6-3-6 3V7z"/><path d="M9 4v13"/><path d="M15 7v13"/>
                    </svg>
                    <span className="text-[12px] font-extrabold">
                      {serviceAreaGeoJson ? 'Service area drawn — tap to edit' : 'Draw your service area'}
                    </span>
                    {serviceAreaGeoJson && (
                      <span
                        role="button"
                        tabIndex={0}
                        onClick={(e) => { e.stopPropagation(); setServiceAreaGeoJson(null); }}
                        className="ml-auto text-[11px] font-medium underline cursor-pointer"
                      >
                        Clear
                      </span>
                    )}
                  </button>
                  {/* Quick-pick radius pills — fallback when the provider
                      doesn't want to draw. Dimmed when an explicit
                      polygon is set (the polygon takes precedence). */}
                  <div className={`flex items-center gap-1.5 text-[11px] text-b3 flex-wrap
                                   ${serviceAreaGeoJson ? 'opacity-40 pointer-events-none' : ''}`}>
                    <span className="font-medium mr-0.5">Or quick-pick:</span>
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
                </div>
              )}
            </div>

            {/* Direction switch — slim text link, right-aligned. Sits
                directly below the location strip so both share visual
                space below the search box without competing. */}
            <div className="mt-1.5 flex justify-end px-1">
              <button
                type="button"
                onClick={() => setIntent(prev => prev === 'find' ? 'spotlight' : 'find')}
                className="text-[11px] text-b3 font-normal hover:text-g transition-colors"
                aria-pressed={intent === 'spotlight'}
              >
                {intent === 'find'
                  ? 'Have a service? Spotlight it free (IG/TT) →'
                  : '← Book a service instead'}
              </button>
            </div>
          </div>

          {/* Example pills removed — examples now rotate INSIDE the
              search box as a toast-style overlay (see ROTATING_*_EXAMPLES
              + the cg-example-rotate animation). */}
        </>
      )}

      {/* ─── Post-submit: Claude-style three-region layout ────────────
          - Summary card pinned just under the headline (flex-shrink-0)
          - Middle (flex-1, overflow-y-auto): chat thread + engine ticker
            + result CTAs. User scrolls up here to see earlier messages.
          - Bottom (flex-shrink-0): reply input sticks above BottomNav
            while chat is asking for missing fields. */}
      {submitted && (
        <>
          {/* SUMMARY — sits at top of the post-submit area, doesn't scroll. */}
          <div className="px-5 pt-2 pb-1 flex-shrink-0">
            <div className="bg-white border border-bdr rounded-[14px] px-3 py-2.5 flex items-start gap-3">
              <div className="w-8 h-8 rounded-[10px] bg-gl flex items-center justify-center flex-shrink-0 mt-0.5">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#3D8B00" strokeWidth="2"
                     strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="11" cy="11" r="7"/><path d="M21 21l-4-4"/>
                </svg>
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-[10px] font-extrabold uppercase tracking-widest text-b3">Your request</p>
                <p className="text-[13px] font-medium text-black leading-snug mt-0.5 break-words">
                  {submittedText}
                </p>
                <p className="text-[11px] text-b3 mt-1 leading-snug truncate">
                  {locationText ? `${locationText} · ` : ''}
                  {freeServices ? 'Free for Connectors' : 'Pay full price'}
                </p>
              </div>
              <button
                onClick={() => resetSubmit({ keepQuery: true })}
                className="text-[11px] font-medium text-g underline underline-offset-2 flex-shrink-0 mt-0.5"
              >
                Edit
              </button>
            </div>
          </div>

          {/* MIDDLE — scrollable history. Chat bubbles + engine ticker
              + result CTAs all live here. User can scroll up at any
              time to read earlier messages (Claude pattern). */}
          <div
            ref={threadRef}
            className="flex-1 overflow-y-auto px-5 pt-2 pb-3 flex flex-col gap-1.5 min-h-0"
          >
            {/* Chat messages — only render in find mode. Spotlight skips
                the chat parser entirely so there's no thread to show. */}
            {intent === 'find' && (chat?.messages || []).map(m => (
              <div
                key={m.id}
                className={m.role === 'user'
                  ? 'self-end max-w-[80%] bg-gl text-black rounded-[14px] rounded-br-[4px] px-3 py-1.5 text-[12px] font-medium leading-snug'
                  : 'self-start max-w-[85%] bg-white border border-bdr text-black rounded-[14px] rounded-bl-[4px] px-3 py-1.5 text-[12px] font-medium leading-snug whitespace-pre-line'}
              >
                {m.text}
              </div>
            ))}
            {intent === 'find' && chat?.typing && (
              <div className="self-start bg-white border border-bdr rounded-[14px] rounded-bl-[4px] px-3 py-1.5 flex items-center gap-1">
                <span className="w-1 h-1 rounded-full bg-b3 animate-pulse" />
                <span className="w-1 h-1 rounded-full bg-b3 animate-pulse" style={{ animationDelay: '120ms' }} />
                <span className="w-1 h-1 rounded-full bg-b3 animate-pulse" style={{ animationDelay: '240ms' }} />
              </div>
            )}

            {/* Engine ticker — appears as soon as the engine has fired
                (either because chat reached 'ready' in find mode, or
                because we bypassed chat in spotlight mode). */}
            {engineStarted && (
              <div className="mt-2 px-1 self-start" aria-live="polite">
                <div className="flex items-center gap-3">
                  {/* CERGIO-GUARD (2026-05-28 / -30): leaf intensity grows
                      as the engine ticks through stages — the plant
                      visibly accelerates during search. Size bumped to
                      56px (was 16) so the brand mark + animation are
                      the anchor of the loading state instead of a
                      tiny inline glyph. */}
                  <LeafLogo
                    working={engineSearching}
                    size={56}
                    intensity={engineSearching
                      ? Math.min(1, 0.35 + (planIdx / Math.max(1, plan.length - 1)) * 0.65)
                      : 0}
                  />
                  <div className="flex-1 min-w-0">
                    <p className="text-[14px] text-gd font-bold leading-snug">
                      {planDone ? "We'll notify you when offers come in" : `${activeStage?.label || ''}…`}
                    </p>
                    {!planDone && activeStage?.detail && (
                      <p className="text-[11px] text-b3 font-normal leading-snug mt-1">
                        {activeStage.detail}
                      </p>
                    )}
                  </div>
                </div>
              </div>
            )}

            {/* Result CTAs once the engine settles. */}
            {planDone && (
              <div className="mt-3 flex flex-col gap-2">
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
                             text-[12px] font-medium text-b2 hover:border-g/40 transition-colors"
                >
                  Send another request
                </button>
              </div>
            )}
          </div>

          {/* STICKY BOTTOM — reply input pinned above the BottomNav while
              the find-mode chat is asking follow-on questions. Hidden in
              spotlight mode (no chat) and once the engine takes over so
              the result CTAs aren't competing with another input. */}
          {intent === 'find' && chat?.phase === 'chat' && (
            <div className="flex-shrink-0 px-5 pt-1 pb-2 bg-cream">
              {/* Quick-reply chips */}
              {(chat?.quickReplies?.length || 0) > 0 && (
                <div className="mb-2 flex flex-wrap gap-1.5">
                  {chat.quickReplies.map(q => (
                    <button
                      key={q}
                      onClick={() => { setReply(''); chat?.send?.(q); }}
                      className="bg-white border border-bdr rounded-pill px-2.5 py-1
                                 text-[11px] font-normal text-b2 hover:border-g hover:text-gd transition-colors"
                    >
                      {q}
                    </button>
                  ))}
                </div>
              )}
              {/* Reply box — tripled in height (single-line input →
                  3-row textarea, min-height 96px). Send button anchors
                  to the bottom-right so the textarea can grow freely. */}
              <div className="flex items-end gap-2 bg-white border border-bdr rounded-[18px] px-3 py-2
                              focus-within:border-g/60 focus-within:shadow-[0_0_0_3px_#F3FFEA] transition-all">
                <textarea
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
                  rows={3}
                  style={{ minHeight: 96 }}
                  className="flex-1 bg-transparent outline-none resize-none text-[13px] text-black placeholder-b3 font-medium leading-snug"
                  autoFocus
                />
                <button
                  type="button"
                  onClick={sendReply}
                  aria-label="Send reply"
                  className="h-8 px-3 bg-g rounded-[10px] flex items-center justify-center flex-shrink-0
                             hover:opacity-90 active:scale-95 transition-transform"
                >
                  <SendArrowIcon />
                </button>
              </div>
            </div>
          )}
        </>
      )}

      {/* CERGIO-GUARD (2026-05-29): "50 friends → $12.5K" pill removed
          per user feedback ("too much"). The compounding math still
          lives on the Connector apply page + the reward-flow animation;
          we don't need it as a Home footnote — it reads as aspirational
          sales pitch instead of subtle context. House ad below still
          routes to the Connector page for users who want the deep dive. */}

      {/* Find-side house ad — shared economics frame. Soft green wash.
          Routes to the Connector apply page (the hero hook on the new
          copy is 'Become a Connector — $250 cash per friend'). */}
      {/* CERGIO-GUARD (2026-05-28): house ad softened per user audit.
          Was bg-gl + p-4 + 10x10 icon — felt sales-y. Now bg-cr2 +
          py-3 + 8x8 icon + text-[13px] headline. Same routing, half
          the visual weight. */}
      {intent === 'find' && !submitted && (
        <div className="px-5 mt-1 mb-6">
          <button
            onClick={() => navigate('/rainmaker/apply')}
            className="w-full bg-cr2 text-b2 border border-bdr rounded-[16px] px-4 py-3 flex items-center gap-3 text-left
                       hover:bg-bg5/30 active:scale-[.99] transition-all"
          >
            <div className="w-8 h-8 rounded-full bg-white flex items-center justify-center flex-shrink-0 border border-bdr">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#3D8B00" strokeWidth="2"
                   strokeLinecap="round" strokeLinejoin="round">
                <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/>
                <circle cx="9" cy="7" r="4"/>
                <path d="M22 11h-6M19 8v6"/>
              </svg>
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-[13px] font-bold text-black leading-tight">
                Become a Connector — ${REWARDS.perFriendConnector} cash + free services
              </p>
              <p className="text-[11px] text-b3 mt-0.5 leading-snug font-normal">
                Or stay a user → ${REWARDS.perFriendUser} credit per friend who joins + books.
              </p>
            </div>
            <span className="text-b3 text-base flex-shrink-0">›</span>
          </button>
        </div>
      )}

      {/* Spotlight-side house ad — provider parallel to the find-side
          card. Same soft-green palette. Copy leads with the provider
          flip: turn your existing clients + social into a referral
          network, then closes on the same shared-prosperity line so
          both sides read as one platform. */}
      {intent === 'spotlight' && !submitted && (
        <div className="px-5 mt-1 mb-6">
          <button
            onClick={() => navigate('/rainmaker/apply')}
            className="w-full bg-cr2 text-b2 border border-bdr rounded-[16px] px-4 py-3 flex items-center gap-3 text-left
                       hover:bg-bg5/30 active:scale-[.99] transition-all"
          >
            {/* Earthy sprout — softened to match the user-side ad. */}
            <div className="w-8 h-8 rounded-full bg-white flex items-center justify-center flex-shrink-0 border border-bdr">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
                <path d="M4 20 H20" stroke="#3D8B00" strokeWidth="2" strokeLinecap="round" />
                <path d="M12 20 V12" stroke="#3D8B00" strokeWidth="2" strokeLinecap="round" />
                <path d="M12 16 C 8 16, 6 13, 6 10 C 9 11, 12 13, 12 16 Z" fill="#3D8B00" />
                <path d="M12 13 C 16 13, 18 10, 18 7 C 15 8, 12 10, 12 13 Z" fill="#5BC404" />
              </svg>
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-[13px] font-bold text-black leading-tight">
                Invite your clients → become a Connector
              </p>
              <p className="text-[11px] text-b3 mt-0.5 leading-snug font-normal">
                ${REWARDS.perFriendConnector} cash per client who books + free spotlights (barter) + Growth Participation Income.
              </p>
            </div>
            <span className="text-b3 text-base flex-shrink-0">›</span>
          </button>
        </div>
      )}

      {/* Footer tagline — Claude-style disclaimer floating just ABOVE
          the BottomNav (nav is ~62px tall + has shadow-up). z-[60] so
          it sits over the nav, pointer-events-none so it can't block
          taps on the nav tabs underneath. */}
      <div className="fixed bottom-[72px] left-1/2 -translate-x-1/2 w-full max-w-[390px] px-5 z-[60] pointer-events-none">
        <p className="text-center text-[11px] text-b3 font-normal leading-snug">
          Cergio is human-powered AI for shared prosperity
        </p>
      </div>

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

      {/* CERGIO-GUARD: location editing is now INLINE under the address
          chip at the top of this screen (see InlineLocationEditor above).
          The LocationEditModal bottom-sheet was pulled because the user
          wants the input right next to where the address sits, not
          sliding up from the bottom. The modal still exists for any
          surface that wants a full-sheet editor; Home no longer uses it. */}

      {/* Service-area polygon picker — bottom sheet, Zillow-style. */}
      {areaPickerOpen && (
        <ServiceAreaMapPicker
          center={locationCoords}
          apiKey={import.meta.env.VITE_GOOGLE_MAPS_API_KEY}
          value={serviceAreaGeoJson}
          onChange={setServiceAreaGeoJson}
          onClose={() => setAreaPickerOpen(false)}
        />
      )}
    </div>
  );
}
