// Address input that auto-completes via Google Places when keyed,
// degrades to a plain <input> otherwise. Emits both the formatted string
// and (when available) lat/lng so callers can persist real coordinates.
import { useEffect, useRef, useState } from 'react';
import { loadGoogleMaps, getGoogleMapsKey } from '../../lib/google';

export function AddressAutocomplete({
  value,
  onChange,        // (text) => void          — called on every keystroke
  onSelect,        // ({lat, lng, address}) => void — called when a Place is picked
  placeholder = 'Add your address',
  className = '',
}) {
  const inputRef = useRef(null);
  const [keyed]  = useState(!!getGoogleMapsKey());

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
      // Drop any place_changed listeners Google bound to ac.
      if (ac && window.google?.maps?.event) {
        window.google.maps.event.clearInstanceListeners(ac);
      }
      // Google appends .pac-container divs straight to <body> and never
      // removes them on its own — without this they accumulate every time
      // the user navigates back to a screen with an autocomplete input.
      document.querySelectorAll('.pac-container').forEach(el => el.remove());
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [keyed]);

  return (
    <input
      ref={inputRef}
      type="text"
      value={value}
      onChange={e => onChange?.(e.target.value)}
      placeholder={placeholder}
      className={className || 'w-full bg-bg5 rounded-[14px] px-4 py-4 text-[14px] text-black placeholder-b3 outline-none focus:ring-2 focus:ring-g/30'}
    />
  );
}
