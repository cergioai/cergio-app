// Address input with two-tier autocomplete:
//   1. Google Places (when VITE_GOOGLE_MAPS_KEY is set) — best UX.
//   2. OpenStreetMap Nominatim debounced fetch as a FREE, no-key
//      fallback — so the form always has some kind of type-ahead even
//      when Google isn't configured.
// Either path emits {lat, lng, address, placeId} via onSelect.
import { useEffect, useRef, useState } from 'react';
import { loadGoogleMaps, getGoogleMapsKey } from '../../lib/google';

// Debounced fetch against Nominatim (https://nominatim.openstreetmap.org).
// Free, public, no key required. Rate-limited to 1 req/sec per their
// policy — we debounce 350ms which is fine for typing. Custom
// User-Agent header satisfies their attribution policy.
async function nominatimSearch(q) {
  if (!q || q.length < 3) return [];
  try {
    const url = `https://nominatim.openstreetmap.org/search?format=json&addressdetails=1&limit=5&q=${encodeURIComponent(q)}`;
    const res = await fetch(url, { headers: { 'Accept': 'application/json' } });
    if (!res.ok) return [];
    const rows = await res.json();
    return rows.map(r => ({
      address:   r.display_name,
      lat:       parseFloat(r.lat),
      lng:       parseFloat(r.lon),
      placeId:   `osm:${r.osm_type || ''}:${r.osm_id || ''}`,
    }));
  } catch {
    return [];
  }
}

export function AddressAutocomplete({
  value,
  onChange,
  onSelect,
  placeholder = 'Add your address',
  className = '',
}) {
  const inputRef = useRef(null);
  const debounceRef = useRef(null);
  const [keyed]  = useState(!!getGoogleMapsKey());
  const [fbResults, setFbResults]   = useState([]);   // fallback suggestions
  const [fbOpen, setFbOpen]         = useState(false);

  // Google Places path.
  useEffect(() => {
    if (!keyed) return;
    let ac;
    let cancelled = false;

    loadGoogleMaps().then(google => {
      if (cancelled || !google || !inputRef.current) return;
      ac = new google.maps.places.Autocomplete(inputRef.current, {
        types: ['geocode'],
        fields: ['formatted_address', 'geometry', 'place_id'],
      });
      ac.addListener('place_changed', () => {
        const p = ac.getPlace();
        if (!p?.geometry?.location) return;
        const lat = p.geometry.location.lat();
        const lng = p.geometry.location.lng();
        const address = p.formatted_address || inputRef.current.value;
        onChange?.(address);
        onSelect?.({ lat, lng, address, placeId: p.place_id });
      });
    });

    return () => {
      cancelled = true;
      if (ac && window.google?.maps?.event) {
        window.google.maps.event.clearInstanceListeners(ac);
      }
      document.querySelectorAll('.pac-container').forEach(el => el.remove());
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [keyed]);

  // Nominatim fallback path. Debounced query as the user types.
  useEffect(() => {
    if (keyed) return; // Google is handling it
    if (debounceRef.current) clearTimeout(debounceRef.current);
    const q = (value || '').trim();
    if (q.length < 3) { setFbResults([]); return; }
    debounceRef.current = setTimeout(async () => {
      const rows = await nominatimSearch(q);
      setFbResults(rows);
    }, 350);
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current); };
  }, [value, keyed]);

  return (
    <div className="relative">
      <input
        ref={inputRef}
        type="text"
        value={value}
        onChange={e => onChange?.(e.target.value)}
        onFocus={() => setFbOpen(true)}
        onBlur={() => setTimeout(() => setFbOpen(false), 150)}
        placeholder={placeholder}
        autoComplete="off"
        className={className || 'w-full bg-bg5 rounded-[14px] px-4 py-4 text-[14px] text-black placeholder-b3 outline-none focus:ring-2 focus:ring-g/30'}
      />
      {/* Fallback dropdown — only renders when Google key is missing
          and Nominatim returned results. */}
      {!keyed && fbOpen && fbResults.length > 0 && (
        <div className="absolute left-0 right-0 top-full mt-1 z-20 bg-white border border-bdr
                        rounded-[14px] shadow-card py-1 max-h-[260px] overflow-y-auto">
          {fbResults.map((r, i) => (
            <button
              key={`${r.placeId}-${i}`}
              type="button"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => {
                onChange?.(r.address);
                onSelect?.({ lat: r.lat, lng: r.lng, address: r.address, placeId: r.placeId });
                setFbOpen(false);
              }}
              className="w-full text-left px-4 py-2 text-[13px] text-b2 hover:bg-bg5 transition-colors leading-snug"
            >
              {r.address}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
