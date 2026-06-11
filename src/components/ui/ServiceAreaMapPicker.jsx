// CERGIO-GUARD (2026-05-30): Zillow-style freehand polygon picker.
// Used by HomeScreen spotlight mode (and eventually the provider
// listing flow) to let a service provider/Connector mark exactly
// which area they serve, replacing the coarse 5/10/25mi pills.
//
// Why custom freehand and not google.maps.drawing?
//   • The DrawingManager only ships click-to-vertex polygons (boring).
//   • Zillow draws as you drag — that's the experience Tarik asked for.
//   • Implemented via mousedown/move/up + touchstart/move/end. While
//     drawing, we disable map drag + zoom so the gesture is the draw.
//
// API:
//   <ServiceAreaMapPicker
//      center={{ lat, lng }}        // anchor point (user's address)
//      apiKey={string}              // Google Maps JS API key
//      value={geojson polygon|null} // controlled value (optional)
//      onChange={(geojson|null)}    // fires on save / clear
//      onClose={() => void}         // bottom-sheet close
//   />
//
// Output GeoJSON shape:
//   { type: 'Polygon', coordinates: [[[lng,lat], [lng,lat], ...]] }
// First & last coordinate are equal (closed ring) per GeoJSON spec.
import { useEffect, useRef, useState } from 'react';

// CERGIO-GUARD (2026-05-30): plain <script> tag loader for Google Maps
// JS API. We previously used @googlemaps/js-api-loader but Vite's
// import-analysis kept crashing the whole app when the package wasn't
// installed (the /* @vite-ignore */ pragma is honored in production
// builds but not in dev's import-analysis pass). The script-tag
// approach has zero npm dependencies — Google's loader resolves +
// caches itself, and Vite has nothing to analyze.
let _loaderPromise = null;
function ensureGoogleMaps(apiKey) {
  if (_loaderPromise) return _loaderPromise;
  _loaderPromise = new Promise((resolve, reject) => {
    if (typeof window === 'undefined') {
      reject(new Error('Google Maps requires a browser environment.'));
      return;
    }
    if (window.google?.maps?.Map) {
      resolve(window.google);
      return;
    }
    const callbackName = `__cergioGoogleMapsReady_${Math.random().toString(36).slice(2)}`;
    window[callbackName] = () => {
      delete window[callbackName];
      if (window.google?.maps?.Map) resolve(window.google);
      else reject(new Error('Google Maps loaded but window.google.maps.Map is missing.'));
    };
    const script = document.createElement('script');
    const params = new URLSearchParams({
      key:       apiKey,
      libraries: 'geometry',
      callback:  callbackName,
      loading:   'async',
      v:         'weekly',
    });
    script.src   = `https://maps.googleapis.com/maps/api/js?${params.toString()}`;
    script.async = true;
    script.defer = true;
    script.onerror = () => {
      delete window[callbackName];
      reject(new Error('Failed to load Google Maps. Check the API key, referrer restrictions, and that Maps JavaScript API is enabled.'));
    };
    document.head.appendChild(script);
  });
  return _loaderPromise;
}

// Convert a flat array of {lat,lng} points to a GeoJSON Polygon.
function pointsToGeoJson(points) {
  if (!points || points.length < 3) return null;
  const ring = points.map(p => [p.lng, p.lat]);
  // Close the ring
  if (ring[0][0] !== ring[ring.length - 1][0] || ring[0][1] !== ring[ring.length - 1][1]) {
    ring.push([ring[0][0], ring[0][1]]);
  }
  return { type: 'Polygon', coordinates: [ring] };
}

// Convert a GeoJSON Polygon back to a flat array of {lat,lng}.
function geoJsonToPoints(geo) {
  if (!geo || geo.type !== 'Polygon' || !geo.coordinates?.[0]) return [];
  // Drop the closing duplicate vertex when rebuilding the path
  const ring = geo.coordinates[0];
  const open = ring.slice(0, ring.length - 1);
  return open.map(([lng, lat]) => ({ lat, lng }));
}

// Convert pointer event (mouse OR touch) into a LatLng on the map.
// Uses Google's pixel→latLng projection on the overlay.
function eventToLatLng(map, projection, evt) {
  const rect = map.getDiv().getBoundingClientRect();
  const x = (evt.touches?.[0]?.clientX ?? evt.clientX) - rect.left;
  const y = (evt.touches?.[0]?.clientY ?? evt.clientY) - rect.top;
  const topRight = projection.fromLatLngToContainerPixel(map.getBounds().getNorthEast());
  const bottomLeft = projection.fromLatLngToContainerPixel(map.getBounds().getSouthWest());
  // We use the projection through the OverlayView attached below.
  const point = projection.fromContainerPixelToLatLng(new window.google.maps.Point(x, y));
  return { lat: point.lat(), lng: point.lng() };
}

export function ServiceAreaMapPicker({
  center,
  apiKey,
  value,
  onChange,
  onClose,
}) {
  const mapRef       = useRef(null);
  const mapInstance  = useRef(null);
  const overlayRef   = useRef(null);     // OverlayView for projection
  const polygonRef   = useRef(null);     // committed polygon
  const livePolyRef  = useRef(null);     // mid-draw polyline
  const isDrawingRef = useRef(false);
  const pointsRef    = useRef([]);
  const [loaded, setLoaded]     = useState(false);
  const [hasShape, setHasShape] = useState(!!value);
  const [error, setError]       = useState(null);

  // 1) Load Google Maps script + create the map instance once.
  useEffect(() => {
    if (!apiKey) {
      setError('Google Maps API key missing — add VITE_GOOGLE_MAPS_API_KEY.');
      return;
    }
    let cancelled = false;
    ensureGoogleMaps(apiKey).then((google) => {
      if (cancelled || !mapRef.current) return;
      const map = new google.maps.Map(mapRef.current, {
        center:           center || { lat: 40.7580, lng: -73.9855 }, // Times Sq fallback
        zoom:             13,
        disableDefaultUI: true,
        zoomControl:      true,
        gestureHandling:  'greedy',
        styles: [
          { featureType: 'poi',         elementType: 'labels', stylers: [{ visibility: 'off' }] },
          { featureType: 'transit',     elementType: 'labels', stylers: [{ visibility: 'off' }] },
          { featureType: 'road',        elementType: 'labels.icon', stylers: [{ visibility: 'off' }] },
        ],
      });
      mapInstance.current = map;

      // OverlayView gives us a projection for pixel↔latLng conversion
      // (required for freehand drag-to-draw).
      const overlay = new google.maps.OverlayView();
      overlay.onAdd    = () => {};
      overlay.draw     = () => {};
      overlay.onRemove = () => {};
      overlay.setMap(map);
      overlayRef.current = overlay;

      // Hydrate with existing value if any.
      if (value) {
        const pts = geoJsonToPoints(value);
        if (pts.length >= 3) {
          polygonRef.current = new google.maps.Polygon({
            paths:         pts,
            strokeColor:   '#3FA821',
            strokeOpacity: 0.95,
            strokeWeight:  3,
            fillColor:     '#3FA821',
            fillOpacity:   0.18,
            clickable:     false,
            editable:      false,
            map,
          });
          // Zoom to fit the existing polygon.
          const bounds = new google.maps.LatLngBounds();
          pts.forEach(p => bounds.extend(p));
          map.fitBounds(bounds, 40);
        }
      } else {
        // Drop a faint anchor marker at the user's address.
        if (center) {
          new google.maps.Marker({
            position: center,
            map,
            icon: {
              path:           google.maps.SymbolPath.CIRCLE,
              scale:          7,
              fillColor:      '#3FA821',
              fillOpacity:    1,
              strokeColor:    '#FFFFFF',
              strokeWeight:   2,
            },
          });
        }
      }
      setLoaded(true);
    }).catch((e) => {
      console.error('[ServiceAreaMapPicker] load failed', e);
      setError('Map failed to load. Check your Google Maps API key.');
    });
    return () => { cancelled = true; };
  }, [apiKey]); // eslint-disable-line react-hooks/exhaustive-deps

  // 2) Attach freehand draw handlers. Listens at the mapRef container
  //    level so pointer events fire even though the map div is on top.
  useEffect(() => {
    if (!loaded || !mapRef.current) return;
    const map = mapInstance.current;
    const google = window.google;
    const container = mapRef.current;

    const clearLive = () => {
      if (livePolyRef.current) {
        livePolyRef.current.setMap(null);
        livePolyRef.current = null;
      }
    };

    const start = (evt) => {
      if (!overlayRef.current?.getProjection()) return;
      // Wipe any previous shape — Zillow restarts the polygon on new drag.
      if (polygonRef.current) {
        polygonRef.current.setMap(null);
        polygonRef.current = null;
        setHasShape(false);
        onChange?.(null);
      }
      clearLive();
      isDrawingRef.current = true;
      pointsRef.current = [];
      // Freeze map so the drag IS the draw, not a pan.
      map.setOptions({ draggable: false, scrollwheel: false, disableDoubleClickZoom: true });
      // Push initial point.
      const proj = overlayRef.current.getProjection();
      const pt = eventToLatLng(map, proj, evt);
      pointsRef.current.push(pt);
      livePolyRef.current = new google.maps.Polyline({
        path:          [pt],
        strokeColor:   '#3FA821',
        strokeOpacity: 0.95,
        strokeWeight:  3,
        map,
      });
      evt.preventDefault?.();
    };

    const move = (evt) => {
      if (!isDrawingRef.current || !overlayRef.current?.getProjection()) return;
      const proj = overlayRef.current.getProjection();
      const pt = eventToLatLng(map, proj, evt);
      const last = pointsRef.current[pointsRef.current.length - 1];
      // Throttle — drop near-duplicate points so we don't drown the polygon.
      if (last && Math.hypot(pt.lat - last.lat, pt.lng - last.lng) < 0.0002) return;
      pointsRef.current.push(pt);
      livePolyRef.current?.getPath().push(new google.maps.LatLng(pt.lat, pt.lng));
      evt.preventDefault?.();
    };

    const end = () => {
      if (!isDrawingRef.current) return;
      isDrawingRef.current = false;
      map.setOptions({ draggable: true, scrollwheel: true, disableDoubleClickZoom: false });
      clearLive();
      const pts = pointsRef.current;
      pointsRef.current = [];
      if (pts.length < 3) {
        return; // not enough to form a shape — bail silently
      }
      const polygon = new google.maps.Polygon({
        paths:         pts,
        strokeColor:   '#3FA821',
        strokeOpacity: 0.95,
        strokeWeight:  3,
        fillColor:     '#3FA821',
        fillOpacity:   0.18,
        clickable:     false,
        editable:      false,
        map,
      });
      polygonRef.current = polygon;
      setHasShape(true);
      onChange?.(pointsToGeoJson(pts));
    };

    container.addEventListener('mousedown',  start);
    container.addEventListener('mousemove',  move);
    container.addEventListener('mouseup',    end);
    container.addEventListener('mouseleave', end);
    container.addEventListener('touchstart', start, { passive: false });
    container.addEventListener('touchmove',  move,  { passive: false });
    container.addEventListener('touchend',   end);
    return () => {
      container.removeEventListener('mousedown',  start);
      container.removeEventListener('mousemove',  move);
      container.removeEventListener('mouseup',    end);
      container.removeEventListener('mouseleave', end);
      container.removeEventListener('touchstart', start);
      container.removeEventListener('touchmove',  move);
      container.removeEventListener('touchend',   end);
    };
  }, [loaded]); // eslint-disable-line react-hooks/exhaustive-deps

  const clearShape = () => {
    if (polygonRef.current) {
      polygonRef.current.setMap(null);
      polygonRef.current = null;
    }
    setHasShape(false);
    onChange?.(null);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end bg-black/40" onClick={onClose}>
      <div
        className="w-full max-w-[420px] mx-auto bg-cream rounded-t-[20px] flex flex-col"
        style={{ maxHeight: '90vh', height: '90vh' }}
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="px-5 pt-4 pb-3 border-b border-bdr flex items-center justify-between">
          <div className="flex-1">
            <h2 className="text-[17px] font-extrabold text-black leading-tight">Draw your service area</h2>
            <p className="text-[11.5px] text-b3 font-medium mt-0.5">
              Drag your finger on the map to outline where you'll travel.
            </p>
          </div>
          <button
            onClick={onClose}
            aria-label="Close"
            className="w-9 h-9 rounded-full bg-white border border-bdr text-b2 text-heading-2 flex items-center justify-center"
          >
            ×
          </button>
        </div>

        {/* Map */}
        <div className="flex-1 relative" style={{ touchAction: 'none' }}>
          {!loaded && !error && (
            <div className="absolute inset-0 flex items-center justify-center bg-bg5">
              <p className="text-body-sm text-b3 font-medium">Loading map…</p>
            </div>
          )}
          {error && (
            <div className="absolute inset-0 flex items-center justify-center bg-bg5 p-5 text-center">
              <p className="text-body-sm text-warnText font-medium">{error}</p>
            </div>
          )}
          <div ref={mapRef} className="absolute inset-0" />
          {loaded && !hasShape && (
            <div className="absolute top-3 left-3 right-3 bg-white/95 backdrop-blur-sm
                            rounded-pill px-4 py-2 text-meta text-b2 font-medium text-center
                            shadow-sm pointer-events-none">
              ✏️ Hold and drag to draw your area
            </div>
          )}
        </div>

        {/* Footer — Cancel (always works) + Clear (only when shape) +
            Save (only when shape).
            CERGIO-GUARD (2026-05-31): Tarik: "draw on map should have
            save or cancel so user can exit of that screen". Before
            this fix, the only exit when nothing was drawn was the
            small ✕ in the header. Now there is a clearly-labelled
            Cancel button in the same footer band as Save — so the
            user always has a labelled escape hatch. */}
        <div className="px-5 pt-3 pb-5 border-t border-bdr bg-cream flex items-center gap-3">
          <button
            onClick={onClose}
            aria-label="Cancel and close map"
            className="px-4 py-3 rounded-pill text-body-sm font-extrabold border bg-white text-b2 border-bdr
                       hover:border-b3 transition-colors"
          >
            Cancel
          </button>
          {hasShape && (
            <button
              onClick={clearShape}
              className="px-4 py-3 rounded-pill text-body-sm font-extrabold border bg-white text-b2 border-bdr
                         hover:border-warn/50 transition-colors"
            >
              Clear
            </button>
          )}
          <button
            onClick={onClose}
            disabled={!hasShape}
            className={`flex-1 py-3 rounded-pill text-body font-extrabold transition-colors
                        ${hasShape
                          ? 'bg-g text-white hover:opacity-90'
                          : 'bg-bg5 text-b3 opacity-60 cursor-not-allowed'}`}
          >
            {hasShape ? 'Save area' : 'Draw an area first'}
          </button>
        </div>
      </div>
    </div>
  );
}
