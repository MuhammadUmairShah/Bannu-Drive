// ---------------------------------------------------------------------------
// Map provider interface. The application only ever talks to this shape, never to OSM / Mapbox / Google directly,
// so a provider can be replaced by one new file and one line in maps.service.js.
//
//   geocode({ query, near, limit })      -> Place[]          (autocomplete / search)
//   reverse({ latitude, longitude })     -> Place | null     (the provider's best match, the SERVICE decides if it is close enough)
//   route({ from, to })                  -> { distanceKm, durationMin, path:[[lat,lng]...] }
//
// Place = { id, name, address, area, city, province, country, latitude, longitude, kind, confidence(0..1), provider }
// kind: poi | address | street | area | locality | region | unknown
// ---------------------------------------------------------------------------
export class MapProvider {
  get id() { throw new Error("id not implemented"); }
  isConfigured() { return false; }
  async geocode() { throw new Error("not implemented"); }
  async reverse() { throw new Error("not implemented"); }
  async route() { throw new Error("not implemented"); }
}

export async function getJson(url, { headers = {}, timeoutMs = Number(process.env.MAPS_TIMEOUT_MS) || 8000, fetchImpl = globalThis.fetch } = {}) {
  const res = await fetchImpl(url, { headers: { Accept: "application/json", ...headers }, signal: AbortSignal.timeout(timeoutMs) });
  if (!res.ok) {
    const err = new Error(`Provider responded ${res.status}`);
    err.status = res.status;
    throw err;
  }
  return res.json();
}

export const clean = (v) => (v == null ? "" : String(v).trim());
export const uniq = (arr) => arr.filter((x, i) => x && arr.indexOf(x) === i);
