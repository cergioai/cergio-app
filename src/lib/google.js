// Lazy-loads the Google Maps JavaScript API exactly once. If no key is
// configured, returns null so callers can gracefully degrade.
let googlePromise = null;

export function getGoogleMapsKey() {
  return import.meta.env.VITE_GOOGLE_MAPS_KEY || null;
}

export function loadGoogleMaps() {
  const key = getGoogleMapsKey();
  if (!key) return Promise.resolve(null);

  if (googlePromise) return googlePromise;

  googlePromise = new Promise((resolve, reject) => {
    if (typeof window === 'undefined') { resolve(null); return; }
    if (window.google?.maps?.places) { resolve(window.google); return; }

    const cbName = `__cergio_gmaps_cb_${Date.now()}`;
    window[cbName] = () => {
      delete window[cbName];
      resolve(window.google);
    };

    const s = document.createElement('script');
    s.src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(key)}&libraries=places&callback=${cbName}`;
    s.async = true;
    s.defer = true;
    s.onerror = (e) => { delete window[cbName]; googlePromise = null; reject(e); };
    document.head.appendChild(s);
  });

  return googlePromise;
}

/**
 * CERGIO-GUARD: every persisted address MUST go through this before
 * saveAddress / chat capture / form submit. Returns:
 *   { ok: true,  address, lat, lng, placeId }  — Google canonical
 *   { ok: false, reason: 'no-key' | 'not-found' | 'error' }
 *
 * Callers should refuse to save when ok === false (or surface a clear
 * toast asking the user to pick a suggestion). This is the single
 * choke-point that prevents bogus addresses like "1 jane street ny"
 * from being stored as-is.
 */
export async function verifyAddress(text) {
  if (!text || !text.trim()) return { ok: false, reason: 'not-found' };
  if (!getGoogleMapsKey()) return { ok: false, reason: 'no-key' };
  try {
    const g = await geocodeAddress(text.trim());
    if (!g?.lat || !g?.lng) return { ok: false, reason: 'not-found' };
    return {
      ok:       true,
      address:  g.formatted || text.trim(),
      lat:      g.lat,
      lng:      g.lng,
      placeId:  g.placeId || null,
    };
  } catch {
    return { ok: false, reason: 'error' };
  }
}

/** Geocode an address string → { lat, lng, formatted } or null. */
export async function geocodeAddress(text) {
  if (!text?.trim()) return null;
  const google = await loadGoogleMaps();
  if (!google) return null;

  return new Promise(resolve => {
    const geocoder = new google.maps.Geocoder();
    geocoder.geocode({ address: text.trim() }, (results, status) => {
      if (status !== 'OK' || !results?.[0]) { resolve(null); return; }
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
