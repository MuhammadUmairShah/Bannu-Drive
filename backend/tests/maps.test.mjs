// Maps tests. Provider HTTP is faked with payloads shaped like the real APIs' documented responses.
// These prove OUR logic (normalisation, ranking, honesty rules, caching, fallback, security). They do NOT prove that
// OpenStreetMap / Mapbox / Google have good data for Bannu: use `npm run maps:probe` with real keys for that.
import "./helpers/atomic-shim.mjs";
import http from "http";
import mongoose from "mongoose";

const MONGO = process.env.MONGO_TEST_URI || "mongodb://127.0.0.1:27017/bd_maps";
Object.assign(process.env, { NODE_ENV: "development", JWT_SECRET: "test_secret_test_secret_test_secret_1234", CLIENT_URL: "http://localhost:5173", MONGO_URI: MONGO, OSM_MIN_INTERVAL_MS: "0", MAPS_CONTACT_EMAIL: "ops@bannudrive.test", MAPS_RATE_LIMIT: "40", MAPS_TIMEOUT_MS: "300", LOGIN_RATE_LIMIT: "100000", REGISTER_RATE_LIMIT: "100000" });
let pass = 0, fail = 0; const failures = [];
const check = (n, c, x = "") => { if (c) { pass++; console.log(`  PASS  ${n}`); } else { fail++; failures.push(n); console.log(`  FAIL  ${n} ${String(x).slice(0, 300)}`); } };
const section = (t) => console.log(`\n== ${t}`);

const svc = await import("../modules/maps/maps.service.js");
const geo = await import("../modules/maps/maps.geo.js");
const { normalizeNominatim } = await import("../modules/maps/providers/osm.provider.js");
const { normalizeMapbox } = await import("../modules/maps/providers/mapbox.provider.js");
const { normalizeGoogle } = await import("../modules/maps/providers/google.provider.js");

// ---------- fake network ----------
const keepAlive = setInterval(() => {}, 1000); // AbortSignal.timeout timers are unref'd: keep the test process alive
let calls = [], handler = () => ({ status: 404, body: {} });
globalThis.fetch = async (url, opts = {}) => {
  const u = new URL(url); calls.push({ url: u, headers: opts.headers || {} });
  const r = await handler(u, opts);
  if (r?.hang) return new Promise((_, rej) => opts.signal?.addEventListener("abort", () => rej(new DOMException("timeout", "TimeoutError"))));
  return { ok: (r.status ?? 200) < 400, status: r.status ?? 200, json: async () => r.body };
};
const nom = (name, lat, lon, a = {}, extra = {}) => ({ osm_type: "node", osm_id: Math.round(lat * 1e4), place_id: Math.round(lon * 1e4), name, display_name: `${name}, Bannu, Khyber Pakhtunkhwa, Pakistan`, lat: String(lat), lon: String(lon), importance: 0.5, addresstype: "suburb", category: "place", address: { suburb: name, county: "Bannu", state: "Khyber Pakhtunkhwa", country: "Pakistan", ...a }, ...extra });
const reset = (h) => { svc.clearMapsCache(); calls = []; handler = h; };
const env = (o) => { for (const [k, v] of Object.entries(o)) v === undefined ? delete process.env[k] : (process.env[k] = v); };

section("OSM adapter: request building");
reset((u) => ({ body: u.pathname === "/search" ? [nom("Bannu Cantt", 32.98, 70.59)] : [] }));
let res = await svc.searchPlaces("Cantt market");
const first = calls[0];
check("first search is restricted to the Bannu area, in Pakistan, with an identifying User-Agent", first.url.searchParams.get("bounded") === "1" && first.url.searchParams.get("countrycodes") === "pk" && first.url.searchParams.get("viewbox") === "70.25,33.25,71,32.5" && /ops@bannudrive\.test/.test(first.headers["User-Agent"]), first.url.search);
check("a thin result set widens the search step by step (Bannu-bounded, then ', Bannu', then soft-biased Pakistan)", calls.length === 3 && calls[2].url.searchParams.get("bounded") === "0");
check("results are normalised: name, address, coordinates, kind, confidence, provider", res[0].latitude === 32.98 && res[0].provider === "osm" && res[0].confidence > 0 && res[0].confidence <= 1 && res[0].address.includes("Bannu"));

section("Ranking and the honesty rules");
reset((u) => ({ body: [nom("Peshawar Saddar", 34.01, 71.54, { city: "Peshawar", county: "Peshawar" }), nom("Karachi Port", 24.86, 66.99, { city: "Karachi" }), nom("Bannu City Center", 32.99, 70.6), nom("Nowhere", 51.5, -0.12, { country: "UK" }), nom("Bannu City Center dup", 32.99, 70.6), nom("Domel", 32.9, 70.62, { village: "Domel" })] }));
res = await svc.searchPlaces("center");
check("the Bannu area is listed first even if the provider ranked Peshawar higher", res[0].address.includes("Bannu City Center") || res[0].address.includes("Domel"), res.map((r) => r.address).join(" | "));
check("places outside Pakistan are dropped", !res.some((r) => /Nowhere/.test(r.address)));
check("duplicates at the same spot are dropped", res.filter((r) => r.latitude === 32.99 && r.longitude === 70.6).length === 1);
check("far places are ranked after local ones", res.findIndex((r) => /Peshawar/.test(r.address)) > res.findIndex((r) => /Domel/.test(r.address)));
check("each result says how far it is and whether it is only approximate", res.every((r) => typeof r.distanceKm === "number" && typeof r.approximate === "boolean"));
check("a vague area-level answer is flagged approximate", normalizeNominatim(nom("Bannu District", 32.9, 70.6, {}, { addresstype: "county", importance: 0.2 })).confidence < 0.5);

section("Input validation + safety");
const code = async (p) => { try { await p; return "ok"; } catch (e) { return e.code; } };
check("query of 1 character -> BAD_REQUEST", (await code(svc.searchPlaces("a"))) === "BAD_REQUEST");
check("query over 100 characters -> BAD_REQUEST", (await code(svc.searchPlaces("x".repeat(101)))) === "BAD_REQUEST");
reset(() => ({ body: [] })); await svc.searchPlaces("<script>alert(1)</script> Bannu");
check("markup and control characters are stripped before the provider ever sees them", calls.length > 0 && !calls.some((c) => /[<>]/.test(c.url.searchParams.get("q"))), calls[0]?.url.search);
check("coordinates outside Pakistan are refused (OUT_OF_REGION)", (await code(svc.reversePlace(51.5, -0.12))) === "OUT_OF_REGION" && (await code(svc.routeBetween({ latitude: 32.9, longitude: 70.6 }, { latitude: 48.8, longitude: 2.3 }))) === "OUT_OF_REGION");
check("garbage coordinates are refused (BAD_REQUEST)", (await code(svc.reversePlace("abc", 70))) === "BAD_REQUEST" && (await code(svc.reversePlace(95, 70))) === "BAD_REQUEST");

section("Reverse geocoding never claims more than it knows");
const P = { latitude: 32.9889, longitude: 70.6056 };
const rev = (dLat, kind = "street") => nom("Main Road", 32.9889 + dLat, 70.6056, { road: "Main Road" }, { addresstype: kind === "street" ? "road" : "suburb" });
check("a result ~40 m away is shown as the address", svc.describeReverse(P, normalizeNominatim(rev(0.00036))).approximate === false && svc.describeReverse(P, normalizeNominatim(rev(0.00036))).label.includes("Main Road"));
let d = svc.describeReverse(P, normalizeNominatim(rev(0.009)));
check("a result ~1 km away is shown as 'Near ...' and marked approximate", /^Near /.test(d.label) && d.approximate === true && d.accuracyMeters > 800);
d = svc.describeReverse(P, normalizeNominatim(rev(0.05)));
check("a result ~5.5 km away is NOT used as a name (the UI shows the pinned coordinates)", d.label === null && d.approximate === true);
check("no result -> no name", svc.describeReverse(P, null).label === null);
check("a 200 m area-level result is only 'Near', a 200 m street result is exact", svc.describeReverse(P, normalizeNominatim(rev(0.0018, "area"))).approximate === true && svc.describeReverse(P, normalizeNominatim(rev(0.0018, "street"))).approximate === false);
reset((u) => ({ body: nom("Bannu Cantt", 32.9892, 70.6058) }));
res = await svc.reversePlace(32.9889, 70.6056);
check("reverse through the service returns label, accuracy and flags", res.label && res.accuracyMeters < 100 && res.approximate === false);
reset((u) => ({ body: { error: "Unable to geocode" } }));
res = await svc.reversePlace(33.2, 70.9);
check("provider 'unable to geocode' -> no name, not an error", res.label === null && res.approximate === true);

section("Routing");
const OSRM = (dist, dur, n = 4) => ({ body: { code: "Ok", routes: [{ distance: dist, duration: dur, geometry: { coordinates: Array.from({ length: n }, (_, i) => [70.6056 + i * 0.01, 32.9889 + i * 0.01]) } }] } });
const A = { latitude: 32.9889, longitude: 70.6056 }, B = { latitude: 34.0151, longitude: 71.5249 };
reset(() => OSRM(215000, 12600));
let r = await svc.routeBetween(A, B);
check("route: distance km, duration min, [lat,lng] path, provider; coordinates sent as lng,lat", r.distanceKm === 215 && r.durationMin === 210 && Array.isArray(r.path[0]) && r.path[0][0] === 32.9889 && r.provider === "osm" && calls[0].url.pathname.includes("70.6056,32.9889;71.5249,34.0151"));
reset(() => OSRM(5000, 600));
check("an impossible route (5 km for a ~150 km trip) is refused, never shown (ROUTE_SUSPICIOUS or unavailable)", ["ROUTE_SUSPICIOUS", "MAPS_UNAVAILABLE"].includes(await code(svc.routeBetween(A, B))));
reset(() => OSRM(215000, 300));
check("an impossible speed (215 km in 5 min) is refused", ["ROUTE_SUSPICIOUS", "MAPS_UNAVAILABLE"].includes(await code(svc.routeBetween(A, B))));
reset(() => ({ body: { code: "NoRoute", routes: [] } }));
check("'no route' -> NO_ROUTE (404), not a crash and not a made-up number", (await code(svc.routeBetween(A, B))) === "NO_ROUTE");
check("same pickup and destination -> BAD_REQUEST", (await code(svc.routeBetween(A, { latitude: 32.98891, longitude: 70.60561 }))) === "BAD_REQUEST");
reset(() => OSRM(215000, 12600, 5000));
check("long paths are thinned to at most 1200 points", (await svc.routeBetween(A, B)).path.length <= 1200);

section("Caching, sharing and failure handling");
reset(() => ({ body: [nom("Domel", 32.9, 70.62, { village: "Domel" }), nom("Domel Bazaar", 32.91, 70.621), nom("Domel School", 32.911, 70.622)] }));
await Promise.all([1, 2, 3, 4, 5].map(() => svc.searchPlaces("Domel")));
const afterBurst = calls.length;
check("5 identical simultaneous searches reach the provider once", afterBurst === 1, String(afterBurst));
await svc.searchPlaces("domel"); await svc.searchPlaces("Domel ");
check("repeating the search (any case / spacing) is served from cache", calls.length === afterBurst);
reset(() => ({ status: 500, body: {} }));
check("provider down -> MAPS_UNAVAILABLE (503) with a safe message", (await code(svc.searchPlaces("Bannu bazaar"))) === "MAPS_UNAVAILABLE");
reset(() => ({ hang: true }));
const t0 = Date.now();
check("a hanging provider is cut off by the timeout instead of hanging the request", (await code(svc.searchPlaces("Bannu hang"))) === "MAPS_UNAVAILABLE" && Date.now() - t0 < 3000, String(Date.now() - t0));

section("Provider selection, fallback and circuit breaker");
env({ MAP_PROVIDER: "mapbox", MAPBOX_TOKEN: undefined, MAP_FALLBACK_PROVIDER: undefined });
check("MAP_PROVIDER=mapbox without a token quietly uses OSM (never half-configured)", svc.providerOrder().join() === "osm");
env({ MAPBOX_TOKEN: "sk.SECRET-TOKEN-123" });
check("with a token the order is mapbox then OSM fallback", svc.providerOrder().join() === "mapbox,osm");
const mbFeature = (name, lat, lng, type = "poi", conf = "high") => ({ id: name, geometry: { coordinates: [lng, lat] }, properties: { mapbox_id: "mb" + name, name, full_address: `${name}, Bannu, Khyber Pakhtunkhwa, Pakistan`, place_formatted: "Bannu, Khyber Pakhtunkhwa, Pakistan", feature_type: type, coordinates: { latitude: lat, longitude: lng }, match_code: { confidence: conf }, context: { place: { name: "Bannu" }, region: { name: "Khyber Pakhtunkhwa" }, country: { name: "Pakistan" } } } });
reset((u) => (u.hostname === "api.mapbox.com" ? { body: { features: [mbFeature("UST Bannu", 32.9, 70.58)] } } : { body: [] }));
res = await svc.searchPlaces("UST Bannu");
check("mapbox is used first: proximity bias to Bannu, country=pk, token sent only to Mapbox", calls[0].url.hostname === "api.mapbox.com" && calls[0].url.searchParams.get("proximity") === "70.6056,32.9889" && calls[0].url.searchParams.get("country") === "pk" && calls.length === 1 && res[0].provider === "mapbox");
check("the token never appears in what the API returns", !JSON.stringify(res).includes("SECRET-TOKEN"));
reset((u) => (u.hostname === "api.mapbox.com" ? { status: 401, body: {} } : { body: [nom("Bannu Bus Stand", 32.99, 70.6)] }));
res = await svc.searchPlaces("Bus Stand");
check("mapbox failing -> the OSM fallback answers", res[0]?.provider === "osm" && calls.some((c) => c.url.hostname === "api.mapbox.com") && calls.some((c) => c.url.hostname.includes("openstreetmap")));
reset((u) => (u.hostname === "api.mapbox.com" ? { status: 500, body: {} } : { body: [nom("Bannu Bus Stand", 32.99, 70.6)] }));
for (let i = 0; i < 6; i++) await svc.searchPlaces(`bus stand ${i}`).catch(() => {});
const mbBefore = calls.filter((c) => c.url.hostname === "api.mapbox.com").length;
for (let i = 6; i < 10; i++) await svc.searchPlaces(`bus stand ${i}`).catch(() => {});
check("circuit breaker: after repeated failures the broken provider is skipped (no more calls to it)", calls.filter((c) => c.url.hostname === "api.mapbox.com").length === mbBefore && mbBefore <= 6, String(mbBefore));
svc.clearMapsCache(); env({ MAP_PROVIDER: undefined, MAPBOX_TOKEN: undefined });

section("Mapbox + Google payload normalisation (documented response shapes)");
const mb = normalizeMapbox(mbFeature("DHQ Hospital", 32.99, 70.6, "poi", "exact"));
check("mapbox: poi, exact match -> confidence 1, coordinates from properties", mb.kind === "poi" && mb.confidence === 1 && mb.latitude === 32.99 && mb.city === "Bannu" && mb.province === "Khyber Pakhtunkhwa");
check("mapbox: a low-confidence region is low confidence", normalizeMapbox(mbFeature("Bannu Division", 32.9, 70.6, "region", "low")).confidence <= 0.4);
const gr = (types, lt, partial) => ({ place_id: "g1", formatted_address: "Bannu Cantt, Bannu, Khyber Pakhtunkhwa, Pakistan", types, partial_match: partial, geometry: { location: { lat: 32.98, lng: 70.59 }, location_type: lt }, address_components: [{ long_name: "Bannu Cantt", types: ["neighborhood"] }, { long_name: "Bannu", types: ["locality"] }, { long_name: "Khyber Pakhtunkhwa", types: ["administrative_area_level_1"] }, { long_name: "Pakistan", types: ["country"] }] });
check("google: ROOFTOP street address -> confidence 1; APPROXIMATE -> 0.4; partial match is capped", normalizeGoogle(gr(["street_address"], "ROOFTOP")).confidence === 1 && normalizeGoogle(gr(["locality"], "APPROXIMATE")).confidence === 0.4 && normalizeGoogle(gr(["street_address"], "ROOFTOP", true)).confidence <= 0.5);
check("google: address components become area / city / province / country", (() => { const g = normalizeGoogle(gr(["neighborhood"], "GEOMETRIC_CENTER")); return g.area === "Bannu Cantt" && g.city === "Bannu" && g.province === "Khyber Pakhtunkhwa" && g.country === "Pakistan"; })());
const enc = geo.decodePolyline("_p~iF~ps|U_ulLnnqC_mqNvxq`@");
check("encoded polylines (Google Directions) decode correctly", enc.length === 3 && Math.abs(enc[0][0] - 38.5) < 1e-6 && Math.abs(enc[2][1] + 126.453) < 1e-6);
env({ MAP_PROVIDER: "google", GOOGLE_MAPS_KEY: "AIza-SECRET-KEY" });
reset((u) => (u.pathname.endsWith("/directions/json") ? { body: { status: "OK", routes: [{ overview_polyline: { points: "_p~iF~ps|U_ulLnnqC_mqNvxq`@" }, legs: [{ distance: { value: 215000 }, duration: { value: 12600 } }] }] } } : { body: { status: "OK", results: [gr(["neighborhood"], "GEOMETRIC_CENTER")] } }));
res = await svc.searchPlaces("Bannu Cantt");
check("google geocoding request: country restricted to PK, bounds around Bannu, key only sent to Google", calls[0].url.hostname === "maps.googleapis.com" && calls[0].url.searchParams.get("components") === "country:PK" && calls[0].url.searchParams.get("bounds") && res[0].provider === "google");
env({ MAP_PROVIDER: undefined, GOOGLE_MAPS_KEY: undefined }); svc.clearMapsCache();

section("Browser config + HTTP endpoints");
check("config exposes provider, tile URL, centre and bounds but no secrets", (() => { env({ MAPBOX_TOKEN: "sk.SECRET", GOOGLE_MAPS_KEY: "AIza-SECRET" }); const c = JSON.stringify(svc.mapConfig()); env({ MAPBOX_TOKEN: undefined, GOOGLE_MAPS_KEY: undefined }); return c.includes("tile.openstreetmap.org") && !/SECRET/.test(c) && c.includes("32.9889"); })());
check("a public Mapbox TILE token (meant for browsers) is the only token that may be exposed", (() => { env({ MAPBOX_PUBLIC_TOKEN: "pk.public-abc" }); const c = svc.mapConfig(); env({ MAPBOX_PUBLIC_TOKEN: undefined }); return c.tiles.url.includes("pk.public-abc") && c.tiles.publicOsm === false; })());

await mongoose.connect(MONGO); await mongoose.connection.dropDatabase();
const { default: app } = await import("../app.js");
const server = http.createServer(app); await new Promise((r) => server.listen(0, "127.0.0.1", r));
const BASE = `http://127.0.0.1:${server.address().port}`;
const fakeFetch = globalThis.fetch;
// our test harness replaced fetch; use a thin wrapper that only fakes the provider hosts
globalThis.fetch = async (url, opts) => (String(url).startsWith(BASE) ? realFetchImpl(url, opts) : fakeFetch(url, opts));
const realFetchImpl = (await import("node:http")).default && (async (url, opts = {}) => {
  const u = new URL(url);
  return new Promise((resolve, reject) => { const rq = http.request({ hostname: u.hostname, port: u.port, path: u.pathname + u.search, method: opts.method || "GET", headers: opts.headers || {} }, (rs) => { const ch = []; rs.on("data", (c) => ch.push(c)); rs.on("end", () => { const body = Buffer.concat(ch).toString(); resolve({ ok: rs.statusCode < 400, status: rs.statusCode, headers: { get: (k) => rs.headers[k.toLowerCase()], getSetCookie: () => rs.headers["set-cookie"] || [] }, json: async () => JSON.parse(body || "{}") }); }); }); rq.on("error", reject); if (opts.body) rq.write(opts.body); rq.end(); });
});
const post = async (path, body) => { const r = await realFetchImpl(BASE + path, { method: "POST", headers: { "content-type": "application/json", origin: "http://localhost:5173" }, body: JSON.stringify(body) }); return { status: r.status, cookies: r.headers.getSetCookie().map((c) => c.split(";")[0]).join("; "), data: await r.json() }; };
const reg = await post("/user/registration", { name: "Map User", email: "map@t.pk", phone: "03221234567", password: "Password123", role: "customer" });
const cookie = reg.cookies;
const api = async (p, c = cookie) => { const r = await realFetchImpl(BASE + p, { headers: c ? { cookie: c } : {} }); return { status: r.status, data: await r.json() }; };

reset((u) => (u.pathname === "/search" ? { body: [nom("Bannu Cantt", 32.98, 70.59)] } : u.pathname === "/reverse" ? { body: nom("Bannu Cantt", 32.9891, 70.6057) } : OSRM(215000, 12600)));
check("endpoints require login (401)", (await api("/maps/search?q=bannu", "")).status === 401 && (await api("/maps/config", "")).status === 401);
let h = await api("/maps/search?q=Bannu%20Cantt");
check("GET /maps/search -> ranked results", h.status === 200 && h.data.results[0].provider === "osm");
check("bad input is a 400 with a code, not a 500", (await api("/maps/search?q=a")).status === 400 && (await api("/maps/reverse?lat=x&lng=y")).data.code === "BAD_REQUEST" && (await api("/maps/reverse?lat=51&lng=0")).data.code === "OUT_OF_REGION");
h = await api("/maps/reverse?lat=32.9889&lng=70.6056");
check("GET /maps/reverse -> label + accuracy + approximate flag", h.status === 200 && h.data.label && typeof h.data.accuracyMeters === "number");
h = await api("/maps/route?fromLat=32.9889&fromLng=70.6056&toLat=34.0151&toLng=71.5249");
check("GET /maps/route -> distance, duration, path", h.status === 200 && h.data.distanceKm === 215 && h.data.path.length > 1);
reset(() => ({ body: { code: "NoRoute", routes: [] } }));
h = await api("/maps/route?fromLat=32.9889&fromLng=70.6056&toLat=34.1&toLng=71.6");
check("no route -> 404 NO_ROUTE with a friendly message", h.status === 404 && h.data.code === "NO_ROUTE");
reset(() => ({ status: 500, body: {} }));
h = await api("/maps/search?q=down%20town");
check("provider outage -> 503 MAPS_UNAVAILABLE, never a stack trace or a key", h.status === 503 && h.data.code === "MAPS_UNAVAILABLE" && !/at |SECRET|key=|token=/i.test(JSON.stringify(h.data)));
let last; for (let i = 0; i < 50; i++) last = await api(`/maps/search?q=spam${i}`);
check("map lookups are rate limited per user (429)", last.status === 429);

clearInterval(keepAlive); server.close(); await mongoose.disconnect();
console.log(`\n==== ${pass} passed, ${fail} failed ====`);
if (fail) { console.log("Failures:\n - " + failures.join("\n - ")); process.exit(1); }
process.exit(0);
