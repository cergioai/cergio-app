// CERGIO-GUARD: this modal is the SINGLE permanent surface for editing
// your default location. The previous "inline chip + Change button +
// toast on save" flow had three soft failure modes that compounded:
//   1. Save errors vanished after 2.6s as a toast — actionable info
//      was gone before the user could react.
//   2. The edit input was a one-line row competing with the rest of the
//      Home chrome; suggestions clipped, focus got stolen, etc.
//   3. When Google's key was broken there was no good visual signal
//      explaining why "Save" refused to commit.
//
// This modal fixes all three by behaving like EditProfileModal:
//   - Full bottom-sheet interaction. Big input, clear suggestions list.
//   - Inline status row that PERSISTS until the user takes another
//     action (no auto-dismiss timer).
//   - Saves locally to localStorage FIRST so the user is never "stuck".
//     Google / Nominatim verification happens in background; the
//     canonical address replaces the typed one once verified, but a
//     failure never blocks the user from saving.
//
// Used by HomeScreen instead of the legacy inline editor.
import { useEffect, useRef, useState } from 'react';
import { AddressAutocomplete } from './AddressAutocomplete';
import { getGoogleMapsKey, verifyAddress, onGoogleMapsStatusChange, describeGoogleError } from '../../lib/google';

const GUEST_ADDR_KEY = 'cergio.guestAddress';

export function LocationEditModal({
  initialAddress = '',
  initialCoords  = null,
  isSignedIn     = false,
  saveAddress,                   // (payload) => Promise<{ data, error }>
  onSaved,                       // (saved) => void
  onClose,
}) {
  const [text,   setText]   = useState(initialAddress || '');
  const [coords, setCoords] = useState(initialCoords  || null);
  const [placeId, setPlaceId] = useState(null);
  const [verified, setVerified] = useState(initialAddress ? 'unknown' : null); // null | 'unknown' | 'google' | 'osm'
  const [busy, setBusy]   = useState(false);
  const [statusMsg, setStatusMsg] = useState(null); // { kind: 'info' | 'warn' | 'error', text }
  const [googleState, setGoogleState] = useState(null);
  const inputWrapRef = useRef(null);

  // Subscribe to Google status so we can show a persistent inline note
  // when the key is broken (instead of the user wondering why type-ahead
  // disappeared).
  useEffect(() => {
    const off = onGoogleMapsStatusChange((s) => setGoogleState(s));
    return off;
  }, []);

  const broken =
    !!googleState?.lastError &&
    (googleState.lastError.kind === 'auth' || googleState.lastError.kind === 'load');
  const googleHint = broken ? describeGoogleError(googleState.lastError) : null;

  const handleSelect = ({ lat, lng, address, placeId: pid, verified: how }) => {
    if (address) setText(address);
    if (lat && lng) setCoords({ lat, lng });
    if (pid) setPlaceId(pid);
    setVerified(how || (broken ? 'osm' : 'google'));
    setStatusMsg(null);
  };

  const persistLocally = (addr, lat, lng, pid) => {
    try {
      localStorage.setItem(GUEST_ADDR_KEY, JSON.stringify({
        address: addr,
        lat:     lat ?? null,
        lng:     lng ?? null,
        placeId: pid ?? null,
      }));
    } catch { /* ignore */ }
  };

  const handleSave = async () => {
    const typed = (text || '').trim();
    if (!typed) {
      setStatusMsg({ kind: 'warn', text: 'Type an address first.' });
      return;
    }
    if (busy) return;
    setBusy(true);

    // Always persist locally FIRST so the user is never stuck. We treat
    // local persistence as the source of truth for the chip; canonical
    // (Google or Nominatim) address replaces it if verification succeeds.
    persistLocally(typed, coords?.lat ?? null, coords?.lng ?? null, placeId);
    setStatusMsg({ kind: 'info', text: 'Saving…' });

    // Verify in background. verifyAddress is now two-tier — tries
    // Google, falls back to Nominatim, so it almost always returns ok.
    let final = { address: typed, lat: coords?.lat ?? null, lng: coords?.lng ?? null, placeId, verified };
    try {
      const v = await verifyAddress(typed);
      if (v.ok) {
        final = { address: v.address, lat: v.lat, lng: v.lng, placeId: v.placeId, verified: v.verified };
        persistLocally(final.address, final.lat, final.lng, final.placeId);
        setText(final.address);
        setCoords({ lat: final.lat, lng: final.lng });
        setPlaceId(final.placeId);
        setVerified(final.verified);
      } else if (v.reason === 'denied' || v.reason === 'no-key') {
        setStatusMsg({
          kind: 'warn',
          text:
            v.reason === 'denied'
              ? 'Saved as typed. Google rejected the lookup — see the setup banner for the fix.'
              : 'Saved as typed. Set VITE_GOOGLE_MAPS_KEY to enable address validation.',
        });
      } else {
        setStatusMsg({
          kind: 'warn',
          text: `Saved as typed — couldn't verify "${typed}" online. You can refine and Save again.`,
        });
      }
    } catch (e) {
      setStatusMsg({ kind: 'warn', text: `Saved locally. Verifier error: ${e?.message || 'unknown'}` });
    }

    // Push to Supabase if signed in. Errors here are non-fatal: the
    // local persistence still works for this session.
    if (isSignedIn && typeof saveAddress === 'function') {
      const { error } = await saveAddress({
        label:            'Home',
        formattedAddress: final.address,
        lat:              final.lat,
        lng:              final.lng,
        placeId:          final.placeId,
        makeDefault:      true,
      });
      if (error && !/relation|does not exist|schema cache/i.test(error.message || '')) {
        setStatusMsg({ kind: 'warn', text: `Saved locally. Server sync failed: ${error.message}` });
      }
    }

    onSaved?.(final);
    setBusy(false);
    // Auto-close after a tick so the user sees the saved status.
    setTimeout(() => onClose?.(), 380);
  };

  return (
    <div
      className="fixed inset-0 z-[80] bg-black/40 flex items-end justify-center"
      onClick={onClose}
    >
      <div
        className="w-full max-w-[390px] bg-white rounded-t-[24px] p-5 max-h-[85vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex justify-between items-start mb-3">
          <div>
            <h3 className="text-heading-2 font-extrabold text-black leading-tight">Your location</h3>
            <p className="text-meta text-b3 mt-0.5 leading-snug">
              This is where providers come — saved as your default for future requests.
            </p>
          </div>
          <button
            onClick={onClose}
            className="text-[20px] text-b3 font-extrabold px-2 -mt-1"
            aria-label="Close"
          >
            ×
          </button>
        </div>

        <label className="block text-meta-sm font-extrabold uppercase tracking-wide text-b2 mb-1.5 mt-3">
          Address
        </label>
        <div ref={inputWrapRef}>
          <AddressAutocomplete
            value={text}
            onChange={setText}
            onSelect={handleSelect}
            placeholder="Start typing your address…"
            className="w-full bg-bg5 rounded-[14px] px-4 py-3 text-body text-black placeholder-b3 outline-none focus:ring-2 focus:ring-g/30"
          />
        </div>

        {/* Google-status notice — collapsed by default to a calm one-liner
            so the user isn't alarmed when OSM is already handling things.
            CERGIO-GUARD: never auto-dismiss; the user expands for the
            full remediation when they're ready to fix GCP. */}
        {broken && googleHint && (
          <details className="mt-3 bg-warnBg/60 border border-warnText/20 rounded-[12px] px-3 py-2 group">
            <summary className="text-meta-sm text-warnText leading-snug cursor-pointer flex items-center gap-2 list-none [&::-webkit-details-marker]:hidden">
              <span aria-hidden="true">ℹ️</span>
              <span className="flex-1">Using OpenStreetMap — addresses save fine. Tap for Google fix.</span>
              <span className="text-warnText/60 text-caps group-open:rotate-180 transition-transform">▾</span>
            </summary>
            <div className="mt-2 pt-2 border-t border-warnText/15">
              <p className="text-meta-sm font-extrabold text-warnText leading-snug">{googleHint.title}</p>
              <p className="text-meta-sm text-warnText/90 mt-1 leading-snug font-normal">{googleHint.detail}</p>
            </div>
          </details>
        )}

        {/* Status / save feedback — persistent. */}
        {statusMsg && (
          <div
            className={`mt-3 rounded-[12px] p-3 border text-meta leading-snug ${
              statusMsg.kind === 'error'
                ? 'bg-warnBg border-warnText/30 text-warnText font-extrabold'
                : statusMsg.kind === 'warn'
                  ? 'bg-warnBg border-warnText/30 text-warnText font-medium'
                  : 'bg-gl border-g/30 text-gd font-medium'
            }`}
          >
            {statusMsg.text}
          </div>
        )}

        {verified === 'google' && !statusMsg && (
          <p className="text-meta-sm text-gd mt-3 font-medium">✓ Google-verified address</p>
        )}
        {verified === 'osm' && !statusMsg && (
          <p className="text-meta-sm text-b2 mt-3 font-medium">Verified via OpenStreetMap</p>
        )}

        <button
          onClick={handleSave}
          disabled={busy || !text.trim()}
          className={`w-full rounded-[14px] py-3.5 text-[15px] font-extrabold mt-5 transition-all
            ${busy || !text.trim()
              ? 'bg-bg5 text-b3 cursor-not-allowed'
              : 'bg-g text-white hover:opacity-90 active:scale-[.97]'}`}
        >
          {busy ? 'Saving…' : 'Save as default location'}
        </button>

        <button
          onClick={onClose}
          className="w-full rounded-[14px] py-2.5 text-body-sm font-extrabold mt-2 text-b3 hover:bg-bg5 transition-colors"
        >
          Cancel
        </button>

        {!getGoogleMapsKey() && (
          <p className="text-caps text-b3 mt-3 text-center leading-snug">
            VITE_GOOGLE_MAPS_KEY is not set — using OpenStreetMap. Addresses save fine but aren't Google-canonical.
          </p>
        )}
      </div>
    </div>
  );
}
