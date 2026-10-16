import { MapProvider, getJson, clean, uniq } from "./base.js";

// Mapbox: Geocoding API v6 + Directions v5. Needs MAPBOX_TOKEN (a SECRET `sk.` or a URL-restricted token), kept on the server.
// STATUS: written from Mapbox's public API documentation; NOT yet exercised against the live API from this build
// environment. Run `npm run maps:probe` with your token to verify it on the Bannu test places before choosing it.
const CONF = { exact: 1, high: 0.9, medium: 0.6, low: 0.3 };
const KIND = { poi: "poi", address: "address", street: "street", neighborhood: "area", locality: "area", place: "locality", district: "region", region: "region", postcode: "area" };

export function normalizeMapbox(f) {
  const p = f.properties || {};
  const ctx = p.context || {};
  const c = p.coordinates || {};
  const [lng, lat] = f.geometry?.coordinates || [];
  const name = clean(p.name_preferred || p.name);
  const kind = KIND[p.feature_type] || "unknown";
  const address = clean(p.full_address) || uniq([name, clean(p.place_formatted)]).join(", ");
  return {
    id: `mapbox:${p.mapbox_id || f.id}`, name, address,
    area: clean(ctx.neighborhood?.name || ctx.locality?.name || ""), city: clean(ctx.place?.name || ctx.district?.name || ""),
    province: clean(ctx.region?.name), country: clean(ctx.country?.name),
    latitude: Number(c.latitude ?? lat), longitude: Number(c.longitude ?? lng), kind,
    confidence: CONF[p.match_code?.confidence] ?? (kind === "region" ? 0.4 : 0.7), provider: "mapbox"
  };
}

export class MapboxProvider extends MapProvider {
  get id() { return "mapbox"; }
  isConfigured() { return !!process.env.MAPBOX_TOKEN; }
  get token() { return encodeURIComponent(process.env.MAPBOX_TOKEN || ""); }

  async geocode({ query, near, limit = 8 }) {
    const p = new URLSearchParams({ q: query, country: "pk", limit: String(limit), language: "en", autocomplete: "true", proximity: `${near.longitude},${near.latitude}` });
    const data = await getJson(`https://api.mapbox.com/search/geocode/v6/forward?${p}&access_token=${this.token}`);
    return (data.features || []).map(normalizeMapbox);
  }
  async reverse({ latitude, longitude }) {
    const data = await getJson(`https://api.mapbox.com/search/geocode/v6/reverse?longitude=${longitude}&latitude=${latitude}&limit=1&language=en&access_token=${this.token}`);
    return data.features?.[0] ? normalizeMapbox(data.features[0]) : null;
  }
  async route({ from, to }) {
    const data = await getJson(`https://api.mapbox.com/directions/v5/mapbox/driving/${from.longitude},${from.latitude};${to.longitude},${to.latitude}?geometries=geojson&overview=full&access_token=${this.token}`, { timeoutMs: 12000 });
    if (data.code !== "Ok" || !data.routes?.length) { const e = new Error("No route"); e.noRoute = true; throw e; }
    const r = data.routes[0];
    return { distanceKm: r.distance / 1000, durationMin: r.duration / 60, path: r.geometry.coordinates.map(([lng, lat]) => [lat, lng]) };
  }
}
