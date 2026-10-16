import api from './api';

// Map data comes from OUR backend (/maps/*), which talks to the configured provider (OSM / Mapbox / Google).
// No provider URL, key or provider-specific code lives in the browser. Coordinates are the source of truth;
// an address is only a label.

// Approximate centre of Bannu: default map view and search bias.
export const BANNU_CENTER = { latitude: 32.9889, longitude: 70.6056 };

const coords = (lat, lng) => `${Number(lat).toFixed(5)}, ${Number(lng).toFixed(5)}`;

// Search suggestions. Returns [{ address, latitude, longitude, kind, approximate, distanceKm }].
// Pass an AbortSignal to cancel a superseded request.
export async function searchPlaces(query, { signal, near } = {}) {
  const q = String(query || '').trim();
  if (q.length < 2) return [];
  const res = await api.get('/maps/search', { params: { q, ...(near ? { lat: near.latitude, lng: near.longitude } : {}) }, signal });
  return (res.data.results || []).map((r) => ({ address: r.address, latitude: r.latitude, longitude: r.longitude, kind: r.kind, approximate: !!r.approximate, distanceKm: r.distanceKm }));
}

// What the pin means. Never claims more than the provider knows: far-away or missing answers come back as null
// and the caller shows the coordinates instead.
export async function reverseGeocodeDetailed(latitude, longitude, { signal } = {}) {
  try {
    const res = await api.get('/maps/reverse', { params: { lat: latitude, lng: longitude }, signal });
    return { label: res.data.label || null, approximate: !!res.data.approximate, accuracyMeters: res.data.accuracyMeters ?? null };
  } catch (error) {
    if (error.name === 'CanceledError' || error.code === 'ERR_CANCELED') throw error;
    return { label: null, approximate: true, accuracyMeters: null }; // address lookup failing must never block picking a point
  }
}

// Label for a pin: the provider's name when it is close enough, otherwise the exact coordinates.
export async function reverseGeocode(latitude, longitude, opts) {
  const r = await reverseGeocodeDetailed(latitude, longitude, opts);
  return r.label || `Pinned location (${coords(latitude, longitude)})`;
}

export const ROUTE_UNAVAILABLE = 'Route unavailable. Please try again.';

// Road route: { distanceKm, durationMin, path:[[lat,lng]...] }. Throws with a user-safe message; never invents a number.
export async function fetchRoute(from, to, { signal } = {}) {
  try {
    const res = await api.get('/maps/route', { params: { fromLat: from.latitude, fromLng: from.longitude, toLat: to.latitude, toLng: to.longitude }, signal });
    return { distanceKm: res.data.distanceKm, durationMin: res.data.durationMin, path: res.data.path };
  } catch (error) {
    if (error.name === 'CanceledError' || error.code === 'ERR_CANCELED') throw error;
    const code = error.response?.data?.code;
    const e = new Error(code === 'NO_ROUTE' ? 'No road route was found between these places' : code === 'BAD_REQUEST' || code === 'OUT_OF_REGION' ? (error.response.data.message || ROUTE_UNAVAILABLE) : ROUTE_UNAVAILABLE);
    e.code = code;
    throw e;
  }
}

// Tile + centre configuration chosen on the server (no secrets). Cached for the session; safe defaults if it fails.
let configPromise = null;
const FALLBACK_CONFIG = { tiles: { url: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png', attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors', maxZoom: 19 }, center: BANNU_CENTER };
export function getMapConfig() {
  if (!configPromise) {
    configPromise = api.get('/maps/config').then((r) => r.data).catch(() => { configPromise = null; return FALLBACK_CONFIG; });
  }
  return configPromise;
}

// Small helper for "x min ago" style freshness labels
export function timeAgo(dateString) {
  if (!dateString) return 'never';
  const seconds = Math.max(0, Math.round((Date.now() - new Date(dateString).getTime()) / 1000));
  if (seconds < 60) return `${seconds}s ago`;
  if (seconds < 3600) return `${Math.round(seconds / 60)} min ago`;
  return `${Math.round(seconds / 3600)} h ago`;
}
