// Shared geography + maths. Pure functions: easy to test.
export const BANNU = { latitude: 32.9889, longitude: 70.6056 };
export const BANNU_BBOX = { west: 70.25, south: 32.5, east: 71.0, north: 33.25 }; // Bannu district and surroundings
export const PAKISTAN_BBOX = { west: 60.5, south: 23.0, east: 77.9, north: 37.3 };

export const inBox = (lat, lng, b) => lat >= b.south && lat <= b.north && lng >= b.west && lng <= b.east;
export const inPakistan = (lat, lng) => Number.isFinite(lat) && Number.isFinite(lng) && inBox(lat, lng, PAKISTAN_BBOX);

const rad = (d) => (d * Math.PI) / 180;
export function haversineKm(a, b) {
  const dLat = rad(b.latitude - a.latitude), dLng = rad(b.longitude - a.longitude);
  const x = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.latitude)) * Math.cos(rad(b.latitude)) * Math.sin(dLng / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.sqrt(x));
}

// Thins a long polyline to at most `max` points (keeps first and last)
export function thin(path, max = 1200) {
  if (path.length <= max) return path;
  const step = (path.length - 1) / (max - 1);
  const out = [];
  for (let i = 0; i < max; i++) out.push(path[Math.round(i * step)]);
  return out;
}

// Google / OSRM "encoded polyline" (precision 5)
export function decodePolyline(str) {
  const out = [];
  let i = 0, lat = 0, lng = 0;
  while (i < str.length) {
    for (const axis of [0, 1]) {
      let shift = 0, result = 0, b;
      do { b = str.charCodeAt(i++) - 63; result |= (b & 0x1f) << shift; shift += 5; } while (b >= 0x20);
      const delta = result & 1 ? ~(result >> 1) : result >> 1;
      if (axis === 0) lat += delta; else lng += delta;
    }
    out.push([lat / 1e5, lng / 1e5]);
  }
  return out;
}
