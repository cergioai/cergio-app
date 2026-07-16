// CERGIO-GUARD (2026-05-30 · rewritten 2026-07-16, SPEC-72 free-first):
// Zillow-style freehand polygon picker. Used by HomeScreen spotlight mode
// and the provider listing flow (ServiceListAboutScreen) to let a service
// provider/Connector mark exactly which area they serve, replacing the
// coarse 5/10/25mi pills.
//
// WHY LEAFLET + OpenStreetMap (was Google Maps JS API):
//   • The old surface loaded https://maps.googleapis.com/maps/api/js and
//     required VITE_GOOGLE_MAPS_API_KEY — with billing enabled — or it
//     rendered "Google Maps API key missing". That is a PAID dependency,
//     and in production the key path was surfacing that error to founders.
//   • Leaflet + the free OpenStreetMap raster tiles need NO API key and
//     NO billing ($0). Constitution: free-first (SPEC-72).
//   • The interaction + the SAVED value are UNCHANGED: the founder still
//     drags to freehand-draw their area, and we still persist the exact
//     same GeoJSON Polygon shape — so no backend/schema change is needed.
//
// Why custom freehand and not leaflet-draw?
//   • leaflet-draw only ships click-to-vertex polygons (a UX change).
//   • Zillow draws as you drag — that's the experience Tarik asked for and
//     the experience the old Google surface delivered. Implemented via
//     mousedown/move/up + touchstart/move/end. While drawing, we disable
//     map drag + zoom so the gesture IS the draw. Zero extra deps.
//
// OSM tile usage policy: ONE interactive map per listing (no bulk tile
// scraping), and the required attribution is displayed via Leaflet's
// attribution control (© OpenStreetMap contributors).
//
// API:
//   <ServiceAreaMapPicker
//      center={{ lat, lng }}        // anchor point (user's address)
//      value={geojson polygon|null} // controlled value (optional)
//      onChange={(geojson|null)}    // fires on save / clear
//      onClose={() => void}         // bottom-sheet close
//   />
//   (An `apiKey` prop is still accepted but IGNORED — kept only so older
//    callers don't break. No Google key is ever read or required.)
//
// Output GeoJSON shape (UNCHANGED — same as the Google version):
//   { type: 'Polygon', coordinates: [[[lng,lat], [lng,lat], ...]] }
// First & last coordinate are equal (closed ring) per GeoJSON spec.
import { useEffect, useRef, useState } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';

// Cergio green (design-spec token `g` = #3FA821). Same colors the old
// Google polygon used, so the drawn area looks identical.
const G = '#3FA821';

// Convert a flat array of {lat,lng} points to a GeoJSON Polygon.
// (Unchanged from the Google version — the persisted shape is frozen.)
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

// Convert a pointer event (mouse OR touch) into a Leaflet LatLng on the
// map, using the container-pixel → latLng projection. Mirrors the old
// Google eventToLatLng but through Leaflet's projection (no API key).
function eventToLatLng(map, evt) {
  const container = map.getContainer();
  const rect = container.getBoundingClientRect();
  const x = (evt.touches?.[0]?.clientX ?? evt.clientX) - rect.left;
  const y = (evt.touches?.[0]?.clientY ?? evt.clientY) - rect.top;
  return map.containerPointToLatLng([x, y]);
}

export function ServiceAreaMapPicker({
  center,
  value,
  onChange,
  onClose,
  // apiKey is accepted but intentionally UNUSED — no Google key is read.
  apiKey, // eslint-disable-line no-unused-vars
}) {
  const mapRef       = useRef(null);
  const mapInstance  = useRef(null);
  const polygonRef   = useRef(null);     // committed polygon layer
  const livePolyRef  = useRef(null);     // mid-draw polyline layer
  const isDrawingRef = useRef(false);
  const pointsRef    = useRef([]);
  const [loaded, setLoaded]     = useState(false);
  const [hasShape, setHasShape] = useState(!!value);
  const [error, setError]       = useState(null);

  // 1) Create the Leaflet map + OSM tile layer once. No API key, no
  //    billing — free OpenStreetMap raster tiles with attribution.
  useEffect(() => {
    if (!mapRef.current) return;
    let cancelled = false;
    let map;
    try {
      map = L.map(mapRef.current, {
        center:            center ? [center.lat, center.lng] : [40.7580, -73.9855], // Times Sq fallback
        zoom:              13,
        zoomControl:       true,
        attributionControl: true, // required OSM attribution
        // Freehand ownership: we toggle these during a draw gesture.
        doubleClickZoom:   true,
        scrollWheelZoom:   true,
      });
      mapInstance.current = map;

      // FREE OpenStreetMap raster tiles — no key. The attribution string
      // is required by the OSM tile usage policy and renders bottom-right.
      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        maxZoom: 19,
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
      }).addTo(map);

      // The map lives in a bottom-sheet that animates open, so its
      // container has no size at construction — recompute once painted.
      setTimeout(() => { if (!cancelled) map.invalidateSize(); }, 60);
      setTimeout(() => { if (!cancelled) map.invalidateSize(); }, 300);

      // Hydrate with the existing value if any.
      if (value) {
        const pts = geoJsonToPoints(value);
        if (pts.length >= 3) {
          polygonRef.current = L.polygon(pts, {
            color:       G,
            weight:      3,
            opacity:     0.95,
            fillColor:   G,
            fillOpacity: 0.18,
            interactive: false,
          }).addTo(map);
          map.fitBounds(L.latLngBounds(pts), { padding: [40, 40] });
        }
      } else if (center) {
        // Faint anchor marker at the user's address (SVG circle — no
        // external marker-image asset, so no bundler icon config needed).
        L.circleMarker([center.lat, center.lng], {
          radius:      7,
          color:       '#FFFFFF',
          weight:      2,
          fillColor:   G,
          fillOpacity: 1,
        }).addTo(map);
      }
      if (!cancelled) setLoaded(true);
    } catch (e) {
      // eslint-disable-next-line no-console
      console.error('[ServiceAreaMapPicker] Leaflet init failed', e);
      if (!cancelled) setError('Map failed to load. Please try again.');
    }

    return () => {
      cancelled = true;
      if (mapInstance.current) {
        mapInstance.current.remove();
        mapInstance.current = null;
      }
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // 2) Freehand draw handlers on the map container. Drag = draw; while a
  //    gesture is active the map's own pan/zoom are frozen so the drag is
  //    the outline, not a pan (Zillow-style — identical to the old UX).
  useEffect(() => {
    if (!loaded || !mapRef.current || !mapInstance.current) return;
    const map = mapInstance.current;
    const container = mapRef.current;

    const clearLive = () => {
      if (livePolyRef.current) {
        map.removeLayer(livePolyRef.current);
        livePolyRef.current = null;
      }
    };

    const start = (evt) => {
      // Wipe any previous shape — Zillow restarts the polygon on a new drag.
      if (polygonRef.current) {
        map.removeLayer(polygonRef.current);
        polygonRef.current = null;
        setHasShape(false);
        onChange?.(null);
      }
      clearLive();
      isDrawingRef.current = true;
      pointsRef.current = [];
      // Freeze the map so the drag IS the draw, not a pan.
      map.dragging.disable();
      map.scrollWheelZoom.disable();
      map.doubleClickZoom.disable();
      const pt = eventToLatLng(map, evt);
      pointsRef.current.push(pt);
      livePolyRef.current = L.polyline([pt], {
        color:   G,
        weight:  3,
        opacity: 0.95,
      }).addTo(map);
      evt.preventDefault?.();
    };

    const move = (evt) => {
      if (!isDrawingRef.current) return;
      const pt = eventToLatLng(map, evt);
      const last = pointsRef.current[pointsRef.current.length - 1];
      // Throttle — drop near-duplicate points so we don't drown the polygon.
      if (last && Math.hypot(pt.lat - last.lat, pt.lng - last.lng) < 0.0002) return;
      pointsRef.current.push(pt);
      livePolyRef.current?.addLatLng(pt);
      evt.preventDefault?.();
    };

    const end = () => {
      if (!isDrawingRef.current) return;
      isDrawingRef.current = false;
      // Thaw the map.
      map.dragging.enable();
      map.scrollWheelZoom.enable();
      map.doubleClickZoom.enable();
      clearLive();
      const pts = pointsRef.current;
      pointsRef.current = [];
      if (pts.length < 3) return; // not enough to form a shape — bail silently
      polygonRef.current = L.polygon(pts, {
        color:       G,
        weight:      3,
        opacity:     0.95,
        fillColor:   G,
        fillOpacity: 0.18,
        interactive: false,
      }).addTo(map);
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
    if (polygonRef.current && mapInstance.current) {
      mapInstance.current.removeLayer(polygonRef.current);
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
            <div className="absolute inset-0 flex items-center justify-center bg-bg5 z-[500] pointer-events-none">
              <p className="text-body-sm text-b3 font-medium">Loading map…</p>
            </div>
          )}
          {error && (
            <div className="absolute inset-0 flex items-center justify-center bg-bg5 p-5 text-center z-[500]">
              <p className="text-body-sm text-warnText font-medium">{error}</p>
            </div>
          )}
          <div ref={mapRef} className="absolute inset-0" />
          {loaded && !hasShape && (
            <div className="absolute top-3 left-3 right-3 bg-white/95 backdrop-blur-sm
                            rounded-pill px-4 py-2 text-meta text-b2 font-medium text-center
                            shadow-sm pointer-events-none z-[600]">
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
