import { OsmProvider } from "./providers/osm.provider.js";
import { MapboxProvider } from "./providers/mapbox.provider.js";
import { GoogleProvider } from "./providers/google.provider.js";
import { BANNU, BANNU_BBOX, PAKISTAN_BBOX, inBox, inPakistan, haversineKm, thin } from "./maps.geo.js";
import { MapsError, Unavailable, BadRequest, OutOfRegion } from "./maps.errors.js";

// ---------------------------------------------------------------------------
// The ONLY entry point the rest of the app uses for maps. Responsibilities:
//   * pick the provider (MAP_PROVIDER) and a fallback (MAP_FALLBACK_PROVIDER)
//   * cache, share identical in-flight requests, time out, and stop hammering a provider that is failing (circuit breaker)
//   * NEVER show a confidently wrong location: reverse results are only described as precisely as their distance allows,
//     routes that look impossible are refused, nothing outside Pakistan is accepted
// ---------------------------------------------------------------------------
const providers = { osm: new OsmProvider(), mapbox: new MapboxProvider(), google: new GoogleProvider() };

export function providerOrder() {
  const primary = String(process.env.MAP_PROVIDER || "osm").toLowerCase();
  const fallback = String(process.env.MAP_FALLBACK_PROVIDER || (primary === "osm" ? "" : "osm")).toLowerCase();
  const chain = [primary, fallback].filter((id, i, a) => id && a.indexOf(id) === i && providers[id]?.isConfigured());
  return chain.length ? chain : ["osm"]; // a provider without its key is skipped, never half-used
}
export const activeProviderId = () => providerOrder()[0];

// ---------- cache + coalescing ----------
const cache = new Map();
const inflight = new Map();
const MAX_CACHE = 2000;
function remember(key, ttlMs, fn) {
  const hit = cache.get(key);
  if (hit && hit.expires > Date.now()) return Promise.resolve(hit.value);
  if (inflight.has(key)) return inflight.get(key); // identical request already running: share it
  const p = fn().then((value) => {
    if (cache.size >= MAX_CACHE) cache.delete(cache.keys().next().value);
    cache.set(key, { value, expires: Date.now() + ttlMs });
    return value;
  }).finally(() => inflight.delete(key));
  inflight.set(key, p);
  return p;
}
export const clearMapsCache = () => { cache.clear(); inflight.clear(); breakers.clear(); };

// ---------- circuit breaker ----------
const breakers = new Map(); // providerId -> { fails: number[], openUntil: number }
const isOpen = (id) => (breakers.get(id)?.openUntil || 0) > Date.now();
function noteFailure(id) {
  const b = breakers.get(id) || { fails: [], openUntil: 0 };
  const now = Date.now();
  b.fails = [...b.fails.filter((t) => now - t < 60000), now];
  if (b.fails.length >= 5) { b.openUntil = now + 30000; b.fails = []; console.warn(`Maps: provider ${id} failing, pausing it for 30s`); }
  breakers.set(id, b);
}
const noteSuccess = (id) => breakers.delete(id);

async function withProviders(fn) {
  let lastNoRoute = null;
  for (const id of providerOrder()) {
    if (isOpen(id)) continue;
    try {
      const out = await fn(providers[id]);
      noteSuccess(id);
      return out;
    } catch (error) {
      if (error.noRoute) { lastNoRoute = error; continue; } // that provider found no road: another may
      noteFailure(id);
      console.warn(`Maps: ${id} failed (${error.message})`);
    }
  }
  if (lastNoRoute) throw new MapsError("NO_ROUTE", 404, "No road route was found between these places");
  throw Unavailable();
}

// ---------- validation ----------
const num = (v) => (v === "" || v == null ? NaN : Number(v));
function point(lat, lng, label = "location") {
  const latitude = num(lat), longitude = num(lng);
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude) || Math.abs(latitude) > 90 || Math.abs(longitude) > 180) throw BadRequest(`Invalid ${label}`);
  if (!inPakistan(latitude, longitude)) throw OutOfRegion();
  return { latitude, longitude };
}

// ---------- SEARCH ----------
const dedupeKey = (p) => `${p.latitude.toFixed(4)},${p.longitude.toFixed(4)}`;

export function rankPlaces(places, near) {
  const seen = new Set();
  const good = places.filter((p) => Number.isFinite(p.latitude) && Number.isFinite(p.longitude) && inPakistan(p.latitude, p.longitude) && p.address)
    .filter((p) => (seen.has(dedupeKey(p)) ? false : seen.add(dedupeKey(p))));
  const tier = (p) => (inBox(p.latitude, p.longitude, BANNU_BBOX) ? 0 : haversineKm(near, p) <= 150 ? 1 : 2);
  return good
    .map((p, i) => ({ p, i, t: tier(p) }))
    .sort((a, b) => a.t - b.t || b.p.confidence - a.p.confidence || a.i - b.i) // area first, then how sure the provider is, then provider order
    .map(({ p }) => ({ ...p, distanceKm: Math.round(haversineKm(near, p) * 10) / 10, approximate: p.confidence < 0.5 }));
}

export async function searchPlaces(rawQuery, rawNear = {}) {
  const query = String(rawQuery || "").replace(/[\u0000-\u001f<>]/g, " ").replace(/\s+/g, " ").trim();
  if (query.length < 2) throw BadRequest("Type at least 2 characters");
  if (query.length > 100) throw BadRequest("Search text is too long");

  let near = BANNU;
  const lat = num(rawNear.latitude), lng = num(rawNear.longitude);
  if (Number.isFinite(lat) && Number.isFinite(lng) && inPakistan(lat, lng)) near = { latitude: lat, longitude: lng };

  const key = `s|${providerOrder().join(">")}|${query.toLowerCase()}|${near.latitude.toFixed(1)},${near.longitude.toFixed(1)}`;
  return remember(key, 10 * 60000, async () => {
    const raw = await withProviders((p) => p.geocode({ query, near, limit: 8 }));
    return rankPlaces(raw, near).slice(0, 8);
  });
}

// ---------- REVERSE ----------
// A provider always returns SOMETHING. We only describe a point as precisely as the answer deserves.
export function describeReverse(point, place) {
  if (!place || !Number.isFinite(place.latitude) || !inPakistan(place.latitude, place.longitude)) return { label: null, address: null, place: null, accuracyMeters: null, approximate: true };
  const meters = Math.round(haversineKm(point, place) * 1000);
  const precise = ["address", "poi", "street"].includes(place.kind);
  if (meters <= (precise ? 250 : 150)) return { label: place.address, address: place.address, place, accuracyMeters: meters, approximate: false };
  if (meters <= 2000) return { label: `Near ${place.address}`, address: place.address, place, accuracyMeters: meters, approximate: true };
  return { label: null, address: null, place: null, accuracyMeters: meters, approximate: true }; // too far to name: the UI shows the pinned coordinates instead
}

export async function reversePlace(lat, lng) {
  const p = point(lat, lng, "location");
  const key = `r|${providerOrder().join(">")}|${p.latitude.toFixed(4)},${p.longitude.toFixed(4)}`;
  return remember(key, 24 * 3600000, async () => {
    const place = await withProviders((prov) => prov.reverse(p));
    return describeReverse(p, place);
  });
}

// ---------- ROUTE ----------
export function checkRoute(from, to, r) {
  const straight = haversineKm(from, to);
  const speed = r.distanceKm / Math.max(r.durationMin / 60, 1e-6);
  const suspicious =
    !Number.isFinite(r.distanceKm) || !Number.isFinite(r.durationMin) || !r.path?.length ||
    r.distanceKm < straight * 0.9 - 0.2 || r.distanceKm > straight * 6 + 3 ||
    (r.distanceKm >= 1 && (speed < 3 || speed > 130));
  if (suspicious) throw new MapsError("ROUTE_SUSPICIOUS", 502, "The route looked wrong, so it was not shown");
}

export async function routeBetween(a, b) {
  const from = point(a.latitude, a.longitude, "pickup");
  const to = point(b.latitude, b.longitude, "destination");
  if (haversineKm(from, to) < 0.03) throw BadRequest("Pickup and destination are the same place");

  const key = `x|${providerOrder().join(">")}|${from.latitude.toFixed(4)},${from.longitude.toFixed(4)}|${to.latitude.toFixed(4)},${to.longitude.toFixed(4)}`;
  return remember(key, 5 * 60000, async () => {
    const r = await withProviders(async (p) => {
      const out = await p.route({ from, to });
      checkRoute(from, to, out); // a nonsense answer counts as that provider failing, so the fallback gets a chance
      return { ...out, provider: p.id };
    });
    return { distanceKm: Math.round(r.distanceKm * 100) / 100, durationMin: Math.max(1, Math.round(r.durationMin)), path: thin(r.path), provider: r.provider };
  });
}

// ---------- config for the browser (no secrets) ----------
export function mapConfig() {
  const osmUrl = "https://tile.openstreetmap.org/{z}/{x}/{y}.png";
  const pub = process.env.MAPBOX_PUBLIC_TOKEN;
  const tileUrl = process.env.MAP_TILE_URL || (pub ? `https://api.mapbox.com/styles/v1/mapbox/streets-v12/tiles/256/{z}/{x}/{y}@2x?access_token=${pub}` : osmUrl);
  const attribution = process.env.MAP_TILE_ATTRIBUTION || (pub && !process.env.MAP_TILE_URL ? '&copy; <a href="https://www.mapbox.com/about/maps/">Mapbox</a> &copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>' : '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors');
  return {
    provider: activeProviderId(),
    tiles: { url: tileUrl, darkUrl: process.env.MAP_TILE_URL_DARK || undefined, attribution, maxZoom: 19, publicOsm: tileUrl === osmUrl },
    center: BANNU, bounds: PAKISTAN_BBOX
  };
}
