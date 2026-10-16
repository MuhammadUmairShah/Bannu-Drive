import { MapProvider, getJson, clean, uniq } from "./base.js";
import { BANNU_BBOX } from "../maps.geo.js";

// OpenStreetMap: Nominatim (search) + OSRM (routing). No key, but the PUBLIC servers are for light use only
// (1 request/second, an identifying User-Agent, no heavy commercial traffic). For production traffic self-host both or
// switch MAP_PROVIDER to a paid provider. NOMINATIM_URL / OSRM_URL let you point at your own servers.
let lastCall = 0;
let queue = Promise.resolve();
const gap = () => Number(process.env.OSM_MIN_INTERVAL_MS ?? (process.env.NOMINATIM_URL ? 0 : 1100));

// All Nominatim calls from this server go through one queue so we never exceed the public rate limit
function throttled(fn) {
  const run = queue.then(async () => {
    const wait = gap() - (Date.now() - lastCall);
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    lastCall = Date.now();
    return fn();
  });
  queue = run.catch(() => {});
  return run;
}

const KIND = { amenity: "poi", shop: "poi", tourism: "poi", building: "poi", office: "poi", leisure: "poi", highway: "street", road: "street", house_number: "address", house: "address", suburb: "area", neighbourhood: "area", quarter: "area", village: "locality", hamlet: "locality", town: "locality", city: "locality", county: "region", state_district: "region", state: "region" };

export function normalizeNominatim(item) {
  const a = item.address || {};
  const type = item.addresstype || item.category || "";
  const name = clean(item.name || a[item.addresstype] || a.road || a.amenity || a.shop || a.suburb || a.village || a.hamlet || "");
  const area = clean(a.suburb || a.neighbourhood || a.village || a.hamlet || a.quarter || "");
  const city = clean(a.city || a.town || a.village || a.county || a.state_district || "");
  const address = uniq([name, area, city, clean(a.state)]).slice(0, 4).join(", ") || clean(item.display_name).split(",").slice(0, 3).join(",").trim();
  const kind = KIND[type] || KIND[item.category] || "unknown";
  const base = { poi: 0.85, address: 0.9, street: 0.75, area: 0.7, locality: 0.7, region: 0.4, unknown: 0.45 }[kind];
  return {
    id: `osm:${item.osm_type || "x"}${item.osm_id || item.place_id}`,
    name: name || address, address, area, city, province: clean(a.state), country: clean(a.country),
    latitude: Number(item.lat), longitude: Number(item.lon), kind,
    confidence: Math.min(1, Math.max(0.2, base * (0.6 + 0.4 * Math.min(1, Number(item.importance) || 0.4)))), provider: "osm"
  };
}

export class OsmProvider extends MapProvider {
  get id() { return "osm"; }
  isConfigured() { return true; }
  get base() { return (process.env.NOMINATIM_URL || "https://nominatim.openstreetmap.org").replace(/\/+$/, ""); }
  get osrm() { return (process.env.OSRM_URL || "https://router.project-osrm.org").replace(/\/+$/, ""); }
  get headers() { return { "User-Agent": process.env.MAPS_USER_AGENT || `BannuDrive/1.0 (${process.env.MAPS_CONTACT_EMAIL || "contact-not-set"})` }; }

  async #search(query, bounded, limit) {
    const b = BANNU_BBOX;
    const params = new URLSearchParams({ q: query, format: "jsonv2", limit: String(limit), countrycodes: "pk", addressdetails: "1", dedupe: "1", "accept-language": "en", viewbox: `${b.west},${b.north},${b.east},${b.south}`, bounded: bounded ? "1" : "0" });
    return throttled(() => getJson(`${this.base}/search?${params}`, { headers: this.headers }));
  }

  async geocode({ query, limit = 8 }) {
    // 1) strictly inside the Bannu area, 2) the same with ", Bannu" added (small localities), 3) soft bias over Pakistan
    let rows = await this.#search(query, true, limit);
    if (rows.length < 3 && !/bannu/i.test(query)) rows = [...rows, ...(await this.#search(`${query}, Bannu`, true, limit))];
    if (rows.length < 3) rows = [...rows, ...(await this.#search(query, false, limit))];
    return rows.map(normalizeNominatim);
  }

  async reverse({ latitude, longitude }) {
    const params = new URLSearchParams({ lat: String(latitude), lon: String(longitude), format: "jsonv2", zoom: "18", addressdetails: "1", "accept-language": "en" });
    const data = await throttled(() => getJson(`${this.base}/reverse?${params}`, { headers: this.headers }));
    return data && !data.error && data.lat ? normalizeNominatim(data) : null;
  }

  async route({ from, to }) {
    const url = `${this.osrm}/route/v1/driving/${from.longitude},${from.latitude};${to.longitude},${to.latitude}?overview=full&geometries=geojson`;
    const data = await getJson(url, { headers: this.headers, timeoutMs: 12000 });
    if (data.code !== "Ok" || !data.routes?.length) { const e = new Error("No route"); e.noRoute = true; throw e; }
    const r = data.routes[0];
    return { distanceKm: r.distance / 1000, durationMin: r.duration / 60, path: r.geometry.coordinates.map(([lng, lat]) => [lat, lng]) };
  }
}
