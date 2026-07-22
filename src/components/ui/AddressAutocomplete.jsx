// Address input with Nominatim autocomplete + optional Google geocode verify.
//
// Google deprecated google.maps.places.Autocomplete for new customers on
// March 1 2025 — the constructor no longer shows a dropdown on new GCP
// projects. We use OpenStreetMap Nominatim for the suggestion dropdown
// (free, no key, works immediately) and still call verifyAddress() on
// selection so Google geocoding enriches the result when the Geocoding
// API is enabled on the GCP project.
//
// CERGIO-GUARD: every picked address is verified via verifyAddress() which
// tries Google tier-1 then falls back to Nominatim tier-2, so lat/lng are
// always populated even when GCP is misconfigured.
import { useEffect, useRef, useState } from 'react';
import { verifyAddress } from '../../lib/google';

// Debounced fetch against Nominatim (https://nominatim.openstreetmap.org).
// Free, public, no key required. Rate-limited to 1 req/sec per policy;
// 350ms debounce is well within that limit.
async function nominatimSearch(q) {
  if (!q || q.length < 3) return [];
  try {
    const url = `https://nominatim.openstreetmap.org/search?format=json&addressdetails=1&limit=5&q=${encodeURIComponent(q)}`;
    // Time-box the dropdown lookup too (QA nightly 2026-07-22) so a stalled
    // Nominatim request can never leave the suggestions spinner stuck.
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 5000);
    let res;
    try { res = await fetch(url, { headers: { 'Accept': 'application/json' }, signal: ctrl.signal }); }
    finally { clearTimeout(t); }
    if (!res.ok) return [];
    const rows = await res.json();
    return rows.map(r => ({
      address: r.display_name,
      lat:     parseFloat(r.lat),
      lng:     parseFloat(r.lon),
      placeId: `osm:${r.osm_type || ''}:${r.osm_id || ''}`,
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
  const debounceRef = useRef(null);
  const [results, setResults] = useState([]);
  const [open,    setOpen]    = useState(false);
  const [loading, setLoading] = useState(false);

  // Debounced Nominatim search as the user types.
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    const q = (value || '').trim();
    if (q.length < 3) { setResults([]); setLoading(false); return; }
    setLoading(true);
    debounceRef.current = setTimeout(async () => {
      const rows = await nominatimSearch(q);
      setResults(rows);
      setLoading(false);
    }, 350);
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current); };
  }, [value]);

  const handlePick = async (r) => {
    setOpen(false);
    setResults([]);
    // Optimistically set the display address immediately so the field
    // doesn't feel laggy while verifyAddress runs.
    onChange?.(r.address);
    // verifyAddress: tries Google geocoder (tier 1), falls back to
    // Nominatim (tier 2). Either way lat/lng are populated.
    const v = await verifyAddress(r.address);
    if (v?.ok) {
      onSelect?.({
        lat:     v.lat,
        lng:     v.lng,
        address: v.address || r.address,
        placeId: v.placeId || r.placeId,
        verified: v.verified,   // 'google' | 'osm'
      });
    } else {
      // verifyAddress failed (network down, etc.) — still emit OSM data
      // so the form isn't stuck, just flag it unverified.
      onSelect?.({ lat: r.lat, lng: r.lng, address: r.address, placeId: r.placeId, verified: false });
    }
  };

  const showDropdown = open && (value || '').trim().length >= 3 && (loading || results.length > 0);

  return (
    <div className="relative">
      <input
        type="text"
        value={value}
        onChange={e => onChange?.(e.target.value)}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        placeholder={placeholder}
        autoComplete="off"
        className={className || 'w-full bg-bg5 rounded-[14px] px-4 py-4 text-body text-black placeholder-b3 outline-none focus:ring-2 focus:ring-g/30'}
      />
      {showDropdown && (
        <div className="absolute left-0 right-0 top-full mt-1 z-20 bg-white border border-bdr
                        rounded-[14px] shadow-card py-1 max-h-[260px] overflow-y-auto">
          {loading && results.length === 0 && (
            <p className="px-4 py-3 text-body-sm text-b3">Searching…</p>
          )}
          {results.map((r, i) => (
            <button
              key={`${r.placeId}-${i}`}
              type="button"
              onMouseDown={e => e.preventDefault()}
              onClick={() => handlePick(r)}
              className="w-full text-left px-4 py-2 text-body-sm text-b2 hover:bg-bg5 transition-colors leading-snug"
            >
              {r.address}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
