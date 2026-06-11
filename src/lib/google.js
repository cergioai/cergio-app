// Lazy-loads the Google Maps JavaScript API exactly once. If no key is
// configured, returns null so callers can gracefully degrade.
//
// CERGIO-GUARD: this module is the SINGLE chokepoint for Google failures.
// It instruments every failure mode that has bitten us (key rejected,
// script load blocked, geocoder REQUEST_DENIED) and exposes the most
// recent error via getGoogleMapsStatus() so:
//   - AddressAutocomplete can fall back to Nominatim at runtime even
//     when a key IS present but Google is rejecting it
//   - SetupCheckBanner can surface the ACTUAL reason to the user
//     instead of "Google didn't load" (which they can't act on)
//
// Failure modes captured here, with the GCP fix in parentheses:
//   - 'auth'    → window.gm_authFailure  (key invalid / referrer blocked
//                                        / billing disabled / Maps JS
//                                        API not enabled)
//   - 'load'    → script onerror          (CSP block, network, ad blocker)
//   - 'geocode' → geocoder status != OK   (REQUEST_DENIED → Places API
//                                        not enabled; OVER_QUERY_LIMIT
//                                        → quota; ZERO_RESULTS → fine,
//                                        but we still log it)

let googlePromise = null;

// Structured status surface. `lastError === null` means "no problems so
// far"; once set, it stays set until the next successful call clears it.
const status = {
  keyPresent:  null,   // boolean
  scriptReady: false,
  lastError:   null,   // { kind, code, message, when } | null
};

const listeners = new Set();
function emit() {
  for (const fn of listeners) {
    try { fn(getGoogleMapsStatus()); } catch { /* ignore */ }
  }
}

export function onGoogleMapsStatusChange(fn) {
  listeners.add(fn);
  // Fire once with the current snapshot so subscribers don't need a
  // separate "read on mount" step.
  try { fn(getGoogleMapsStatus()); } catch { /* ignore */ }
  return () => listeners.delete(fn);
}

export function getGoogleMapsKey() {
  return import.meta.env.VITE_GOOGLE_MAPS_KEY || null;
}

export function getGoogleMapsStatus() {
  return {
    keyPresent:  status.keyPresent ?? !!getGoogleMapsKey(),
    scriptReady: status.scriptReady,
    lastError:   status.lastError,
    ok:          status.scriptReady && !status.lastError,
  };
}

function recordError(kind, code, message) {
  status.lastError = { kind, code: code || null, message: message || '', when: Date.now() };
  // eslint-disable-next-line no-console
  console.error(`[google-maps] ${kind}${code ? ` (${code})` : ''}: ${message}`);
  emit();
}

// Human-friendly remediation hint for each known Google error code. The
// banner pipes the .lastError through this to tell the user what to fix.
export function describeGoogleError(err) {
  if (!err) return null;
  const code = (err.code || '').toString();
  const msg  = err.message || '';
  if (err.kind === 'auth') {
    return {
      title: 'Google rejected your API key',
      detail: 'Open GCP → APIs & Services → Credentials → your Maps key. Add this site to "HTTP referrers", enable "Maps JavaScript API" + "Places API" + "Geocoding API", and enable billing on the project.',
    };
  }
  if (err.kind === 'load') {
    return {
      title: 'Google Maps script failed to load',
      detail: 'A network filter, ad blocker, or CSP rule is blocking maps.googleapis.com. Check the browser console for the blocked request.',
    };
  }
  if (err.kind === 'geocode') {
    if (/REQUEST_DENIED/i.test(code)) return {
      title: 'Google geocoder denied the request',
      detail: msg || 'Likely cause: the Geocoding API is not enabled on this project, or the API key is restricted to a different API. Enable Geocoding API in GCP for the same key.',
    };
    if (/OVER_QUERY_LIMIT/i.test(code)) return {
      title: 'Google geocoder quota exceeded',
      detail: 'Daily quota or QPS cap hit. Enable billing or raise the quota in GCP.',
    };
    if (/INVALID_REQUEST/i.test(code)) return {
      title: 'Google geocoder rejected the address',
      detail: 'The typed address didn\'t parse. Try adding the city/state.',
    };
    if (/ZERO_RESULTS/i.test(code)) return {
      title: 'Google found no match for that address',
      detail: 'Try a more specific address — include street number, city and state.',
    };
    return { title: 'Google geocoder error', detail: `${code} ${msg}`.trim() };
  }
  return { title: 'Google Maps error', detail: msg };
}

export function loadGoogleMaps() {
  const key = getGoogleMapsKey();
  status.keyPresent = !!key;
  if (!key) return Promise.resolve(null);

  if (googlePromise) return googlePromise;

  googlePromise = new Promise((resolve) => {
    if (typeof window === 'undefined') { resolve(null); return; }
    if (window.google?.maps?.places) {
      status.scriptReady = true;
      status.lastError   = null;
      emit();
      resolve(window.google);
      return;
    }

    // CERGIO-GUARD: Google's "your key is bad" signal. Without this
    // handler the auth error goes only to the JS console and the user
    // sees no autocomplete + no explanation. Now we capture it,
    // record it, and let AddressAutocomplete fall back to Nominatim.
    const prevAuthFailure = window.gm_authFailure;
    window.gm_authFailure = () => {
      recordError('auth', 'AUTH', 'Google rejected the Maps API key. See describeGoogleError for the fix.');
      status.scriptReady = false;
      googlePromise = null;          // allow a retry once the user fixes GCP
      // Forward to any prior handler so we don't break other listeners.
      try { prevAuthFailure?.(); } catch { /* ignore */ }
      resolve(null);                  // never throw — let callers degrade
    };

    const cbName = `__cergio_gmaps_cb_${Date.now()}`;
    window[cbName] = () => {
      delete window[cbName];
      // The auth callback fires AFTER the JS callback when a key is
      // rejected, so don't mark ready yet if we already saw auth fail.
      if (status.lastError?.kind === 'auth') { resolve(null); return; }
      status.scriptReady = true;
      status.lastError   = null;
      emit();
      resolve(window.google);
    };

    const s = document.createElement('script');
    s.src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(key)}&libraries=places&callback=${cbName}&loading=async`;
    s.async = true;
    s.defer = true;
    s.onerror = (e) => {
      delete window[cbName];
      recordError('load', 'SCRIPT_ERROR', e?.message || 'script tag failed to load');
      googlePromise = null;
      resolve(null);
    };
    document.head.appendChild(s);
  });

  return googlePromise;
}

/**
 * CERGIO-GUARD: every persisted address MUST go through this before
 * saveAddress / chat capture / form submit. Returns:
 *   { ok: true,  address, lat, lng, placeId, verified: 'google' | 'osm' }
 *   { ok: false, reason: 'no-key' | 'not-found' | 'denied' | 'error' }
 *
 * Two-tier verification:
 *   1. Google's geocoder (canonical, gives a place_id).
 *   2. If Google is broken (auth rejected, denied, or no key),
 *      fall back to OpenStreetMap Nominatim so the user is never
 *      locked out of adding an address. The payload still includes
 *      lat/lng and `verified: 'osm'` so callers can label / warn.
 *
 * Callers should refuse to save when ok === false (or surface a clear
 * toast). This is the single choke-point that prevents bogus addresses
 * like "1 jane street ny" from being stored as-is.
 */
export async function verifyAddress(text) {
  if (!text || !text.trim()) return { ok: false, reason: 'not-found' };
  const trimmed = text.trim();

  // Tier 1: Google (when configured and not broken).
  if (getGoogleMapsKey()) {
    try {
      const g = await geocodeAddress(trimmed);
      if (g?.lat && g?.lng) {
        return {
          ok:       true,
          address:  g.formatted || trimmed,
          lat:      g.lat,
          lng:      g.lng,
          placeId:  g.placeId || null,
          verified: 'google',
        };
      }
    } catch (e) {
      recordError('geocode', 'EXCEPTION', e?.message || String(e));
    }
  }

  // Tier 2: Nominatim fallback. Only kicks in when Google didn't return
  // a real result — auth-rejected, key missing, REQUEST_DENIED, or
  // ZERO_RESULTS. Lets users keep working even with a broken GCP setup.
  try {
    const url = `https://nominatim.openstreetmap.org/search?format=json&limit=1&addressdetails=1&q=${encodeURIComponent(trimmed)}`;
    const res = await fetch(url, { headers: { 'Accept': 'application/json' } });
    if (res.ok) {
      const rows = await res.json();
      const r = Array.isArray(rows) ? rows[0] : null;
      if (r && r.lat && r.lon) {
        // CERGIO-GUARD: Nominatim rescued the request — clear any Google
        // geocode error so SetupCheckBanner doesn't show a false alarm.
        // The address resolved successfully; GCP config issues are a
        // developer concern, not a user-facing problem. Auth errors
        // (kind='auth') stay visible — those affect more than geocoding.
        if (status.lastError?.kind === 'geocode') {
          status.lastError = null;
          emit();
        }
        return {
          ok:       true,
          address:  r.display_name || trimmed,
          lat:      parseFloat(r.lat),
          lng:      parseFloat(r.lon),
          placeId:  `osm:${r.osm_type || ''}:${r.osm_id || ''}`,
          verified: 'osm',
        };
      }
    }
  } catch (_e) { /* network blip — fall through to error reason below */ }

  // Both tiers failed. Be specific about why so the toast can be useful.
  if (!getGoogleMapsKey())                                                 return { ok: false, reason: 'no-key' };
  const err = status.lastError;
  if (err?.kind === 'auth' || /REQUEST_DENIED/i.test(err?.code || ''))     return { ok: false, reason: 'denied' };
  return { ok: false, reason: 'not-found' };
}

/** Geocode an address string → { lat, lng, formatted } or null. */
export async function geocodeAddress(text) {
  if (!text?.trim()) return null;
  const google = await loadGoogleMaps();
  if (!google) return null;

  return new Promise(resolve => {
    let geocoder;
    try {
      geocoder = new google.maps.Geocoder();
    } catch (e) {
      recordError('geocode', 'CTOR', e?.message || 'Geocoder constructor threw');
      resolve(null);
      return;
    }
    geocoder.geocode({ address: text.trim() }, (results, gStatus) => {
      // CERGIO-GUARD: don't silently return null on non-OK. Record the
      // exact status code so the banner can show the user how to fix it.
      if (gStatus !== 'OK') {
        // ZERO_RESULTS is a user-content issue, not a config issue —
        // record at a softer severity (no "lastError" stamp).
        if (gStatus === 'ZERO_RESULTS') {
          // eslint-disable-next-line no-console
          console.warn('[google-maps] geocoder ZERO_RESULTS for "%s"', text);
        } else {
          recordError('geocode', gStatus, `geocoder returned ${gStatus} for "${text}"`);
        }
        resolve(null);
        return;
      }
      if (!results?.[0]) { resolve(null); return; }
      const r = results[0];
      const loc = r.geometry.location;
      resolve({
        lat:       typeof loc.lat === 'function' ? loc.lat() : loc.lat,
        lng:       typeof loc.lng === 'function' ? loc.lng() : loc.lng,
        formatted: r.formatted_address,
        placeId:   r.place_id,
      });
    });
  });
}
