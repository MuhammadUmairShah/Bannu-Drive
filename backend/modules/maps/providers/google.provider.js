import { MapProvider, getJson, clean, uniq } from "./base.js";
import { decodePolyline, BANNU_BBOX } from "../maps.geo.js";

// Google Maps Platform: Geocoding API + Directions API. Needs GOOGLE_MAPS_KEY (server key, restrict it by IP).
// STATUS: written from Google's public API documentation; NOT yet exercised against the live API from this build
// environment. IMPORTANT (terms of service): Google requires its data (geocoding, directions) to be shown on a GOOGLE
// map. If you pick this provider, move the frontend map to the Google Maps JavaScript API too; showing Google results on
// OpenStreetMap/Leaflet tiles is not allowed by Google's terms.
const LOC = { ROOFTOP: 1, RANGE_INTERPOLATED: 0.8, GEOMETRIC_CENTER: 0.6, APPROXIMATE: 0.4 };
const pick = (comps, ...types) => clean(comps.find((c) => types.some((t) => c.types?.includes(t)))?.long_name);

export function normalizeGoogle(r) {
  const comps = r.address_components || [];
  const types = r.types || [];
  const kind = types.some((t) => ["establishment", "point_of_interest"].includes(t)) ? "poi" : types.includes("street_address") || types.includes("premise") ? "address" : types.includes("route") ? "street" : types.some((t) => ["neighborhood", "sublocality", "sublocality_level_1"].includes(t)) ? "area" : types.includes("locality") ? "locality" : types.some((t) => t.startsWith("administrative_area")) ? "region" : "unknown";
  let confidence = LOC[r.geometry?.location_type] ?? 0.5;
  if (r.partial_match) confidence = Math.min(confidence, 0.5);
  return {
    id: `google:${r.place_id}`, name: clean(comps[0]?.long_name) || clean(r.formatted_address).split(",")[0],
    address: uniq(clean(r.formatted_address).split(",").map((s) => s.trim())).slice(0, 4).join(", "),
    area: pick(comps, "sublocality", "neighborhood"), city: pick(comps, "locality", "administrative_area_level_2"),
    province: pick(comps, "administrative_area_level_1"), country: pick(comps, "country"),
    latitude: Number(r.geometry?.location?.lat), longitude: Number(r.geometry?.location?.lng), kind, confidence, provider: "google"
  };
}

export class GoogleProvider extends MapProvider {
  get id() { return "google"; }
  isConfigured() { return !!process.env.GOOGLE_MAPS_KEY; }
  get key() { return encodeURIComponent(process.env.GOOGLE_MAPS_KEY || ""); }

  async geocode({ query }) {
    const b = BANNU_BBOX;
    const p = new URLSearchParams({ address: query, components: "country:PK", bounds: `${b.south},${b.west}|${b.north},${b.east}`, language: "en", region: "pk" });
    const data = await getJson(`https://maps.googleapis.com/maps/api/geocode/json?${p}&key=${this.key}`);
    if (data.status === "ZERO_RESULTS") return [];
    if (data.status !== "OK") throw new Error(`Google geocode ${data.status}`);
    return data.results.map(normalizeGoogle);
  }
  async reverse({ latitude, longitude }) {
    const data = await getJson(`https://maps.googleapis.com/maps/api/geocode/json?latlng=${latitude},${longitude}&language=en&key=${this.key}`);
    if (data.status === "ZERO_RESULTS") return null;
    if (data.status !== "OK") throw new Error(`Google reverse ${data.status}`);
    return normalizeGoogle(data.results[0]);
  }
  async route({ from, to }) {
    const data = await getJson(`https://maps.googleapis.com/maps/api/directions/json?origin=${from.latitude},${from.longitude}&destination=${to.latitude},${to.longitude}&mode=driving&key=${this.key}`, { timeoutMs: 12000 });
    if (data.status === "ZERO_RESULTS" || data.status === "NOT_FOUND") { const e = new Error("No route"); e.noRoute = true; throw e; }
    if (data.status !== "OK") throw new Error(`Google directions ${data.status}`);
    const leg = data.routes[0].legs[0];
    return { distanceKm: leg.distance.value / 1000, durationMin: leg.duration.value / 60, path: decodePolyline(data.routes[0].overview_polyline.points) };
  }
}
