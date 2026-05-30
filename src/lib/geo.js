// CERGIO-GUARD (2026-05-30): client-side geometry helpers.
// Used by listServices to filter services by their provider-drawn
// service-area polygon, without needing PostGIS on the DB. Volume is
// small (low hundreds of providers), so ray-casting in JS after the
// proximity RPC is plenty fast and avoids the PostGIS install +
// migrations + RLS surface.

// Ray-casting point-in-polygon test.
// Accepts a polygon ring as [[lng,lat], [lng,lat], ...] (GeoJSON order).
// Returns true if the point is INSIDE (or on) the ring.
//
// Source: classic Franklin algorithm, widely used. We don't need a
// "robust" geometric kernel — the polygons we test are reasonable in
// size (a city-area polygon, not pathological with shared edges).
//
// Note on coordinate frames: lat/lng aren't planar near the poles,
// but for the city-scale polygons we draw (tens of miles tops) the
// distortion is negligible. If we ever support nationwide polygons
// or polygons crossing the antimeridian, swap this for a real
// spherical containment.
export function pointInRing(lng, lat, ring) {
  if (!Array.isArray(ring) || ring.length < 3) return false;
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i][0], yi = ring[i][1];
    const xj = ring[j][0], yj = ring[j][1];
    const intersects =
      ((yi > lat) !== (yj > lat)) &&
      (lng < ((xj - xi) * (lat - yi)) / ((yj - yi) || 1e-12) + xi);
    if (intersects) inside = !inside;
  }
  return inside;
}

// Apply containment to a GeoJSON Polygon (single outer ring; no holes
// in our shapes today).
export function pointInPolygon(lng, lat, geojson) {
  if (!geojson || geojson.type !== 'Polygon') return false;
  const ring = geojson.coordinates?.[0];
  return pointInRing(lng, lat, ring);
}
