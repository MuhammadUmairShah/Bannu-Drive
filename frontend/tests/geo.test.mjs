// Tests the browser's map client (src/utils/geo.js, hooks/usePlaceSearch behaviour) against a fake backend.
// Provider logic is tested in the backend (tests/maps.test.mjs); this proves the client's honesty and error handling.
import { build } from "esbuild";
import { pathToFileURL } from "url";
import path from "path";

globalThis.window = new EventTarget();
globalThis.window.location = { pathname: "/", assign() {} };
const out = path.resolve("tests/.geo-bundle.mjs");
await build({ entryPoints: ["src/utils/geo.js"], bundle: true, format: "esm", platform: "node", outfile: out, logLevel: "silent", external: ["axios"], define: { "import.meta.env.VITE_API_URL": '"http://api.test"' } });
const geo = await import(pathToFileURL(out).href);
const api = (await import(pathToFileURL(path.resolve("tests/.geo-bundle.mjs")).href)) && null;
const { default: axiosApi } = await (async () => { const m = await build({ entryPoints: ["src/utils/api.js"], bundle: true, format: "esm", platform: "node", outfile: path.resolve("tests/.api-bundle.mjs"), logLevel: "silent", external: ["axios"], define: { "import.meta.env.VITE_API_URL": '"http://api.test"' } }); return import(pathToFileURL(path.resolve("tests/.api-bundle.mjs")).href); })();
const { AxiosError } = await import("axios");

let pass = 0, fail = 0;
const check = (n, c, x = "") => { c ? pass++ : fail++; console.log(`${c ? "  PASS" : "  FAIL"}  ${n} ${c ? "" : x}`); };
const calls = [];
let handler = () => ({ status: 200, data: {} });
const adapterFor = (inst) => { inst.defaults.adapter = async (config) => { calls.push({ url: config.url, params: config.params, aborted: config.signal?.aborted }); const r = await handler(config); const response = { data: r.data, status: r.status, statusText: "", headers: {}, config }; if (r.status >= 400) throw new AxiosError("fail", "ERR_BAD_REQUEST", config, null, response); return response; }; };
adapterFor(axiosApi);

// NOTE: geo.js imports its own copy of api.js inside its bundle; point that copy at the same fake via a global hook
const geoSrc = await import("node:fs").then((fs) => fs.promises.readFile("src/utils/geo.js", "utf8"));
const inlineBundle = path.resolve("tests/.geo2-bundle.mjs");
await build({ stdin: { contents: geoSrc.replace("import api from './api';", "import api from 'FAKE_API';"), resolveDir: path.resolve("src/utils"), loader: "js" }, bundle: true, format: "esm", platform: "node", outfile: inlineBundle, logLevel: "silent", plugins: [{ name: "fake", setup(b) { b.onResolve({ filter: /^FAKE_API$/ }, () => ({ path: "fake", namespace: "fake" })); b.onLoad({ filter: /.*/, namespace: "fake" }, () => ({ contents: "export default globalThis.__fakeApi;", loader: "js" })); } }] });
globalThis.__fakeApi = axiosApi;
const g = await import(pathToFileURL(inlineBundle).href);

let r = await g.searchPlaces("a");
check("1-character searches never reach the network", r.length === 0 && calls.length === 0);
handler = () => ({ status: 200, data: { results: [{ address: "Bannu Cantt, Bannu", latitude: 32.98, longitude: 70.59, kind: "area", approximate: false, distanceKm: 1.4, confidence: 0.9, provider: "osm", id: "x" }] } });
r = await g.searchPlaces("Bannu Cantt");
check("search goes through OUR backend and returns only what the UI needs (no provider internals)", calls[0].url === "/maps/search" && calls[0].params.q === "Bannu Cantt" && r[0].address && !("provider" in r[0]) && !("id" in r[0]));
handler = () => ({ status: 200, data: { label: "Bannu Cantt", approximate: false, accuracyMeters: 40 } });
check("reverse geocode returns the provider's label when it is close", (await g.reverseGeocode(32.9889, 70.6056)) === "Bannu Cantt");
handler = () => ({ status: 200, data: { label: null, approximate: true, accuracyMeters: 5200 } });
let label = await g.reverseGeocode(32.9889, 70.6056);
check("a far-away or missing answer is NOT used as a name: the pinned coordinates are shown instead", /^Pinned location \(32\.98890, 70\.60560\)$/.test(label), label);
handler = () => ({ status: 503, data: { success: false, code: "MAPS_UNAVAILABLE" } });
label = await g.reverseGeocode(32.9889, 70.6056);
check("address lookup failing never blocks picking a point (coordinates label)", /^Pinned location/.test(label));
check("route failure -> 'Route unavailable. Please try again.' (no made-up distance)", await g.fetchRoute({ latitude: 32.9, longitude: 70.6 }, { latitude: 34, longitude: 71.5 }).then(() => false).catch((e) => e.message === "Route unavailable. Please try again." && !("distanceKm" in e)));
handler = () => ({ status: 404, data: { success: false, code: "NO_ROUTE", message: "x" } });
check("no road between the places gets its own clear message", await g.fetchRoute({ latitude: 32.9, longitude: 70.6 }, { latitude: 34, longitude: 71.5 }).catch((e) => e.message.includes("No road route") && e.code === "NO_ROUTE"));
handler = () => ({ status: 200, data: { distanceKm: 215, durationMin: 210, path: [[32.9, 70.6], [34, 71.5]], provider: "osm" } });
const rt = await g.fetchRoute({ latitude: 32.9, longitude: 70.6 }, { latitude: 34, longitude: 71.5 });
check("route returns distance, duration and path from the backend", rt.distanceKm === 215 && rt.durationMin === 210 && rt.path.length === 2 && calls.at(-1).params.fromLat === 32.9);
handler = () => ({ status: 200, data: { tiles: { url: "https://tiles.example/{z}/{x}/{y}.png", attribution: "x", maxZoom: 19 }, center: { latitude: 32.9889, longitude: 70.6056 } } });
const c1 = await g.getMapConfig(); const n = calls.length; const c2 = await g.getMapConfig();
check("map configuration is fetched once and cached", c1.tiles.url.includes("tiles.example") && calls.length === n && c1 === c2);
check("Bannu is the default centre", g.BANNU_CENTER.latitude === 32.9889 && g.BANNU_CENTER.longitude === 70.6056);
check("timeAgo labels", g.timeAgo(new Date(Date.now() - 5000).toISOString()).endsWith("s ago") && g.timeAgo(null) === "never");
check("no provider URLs or keys exist in the browser bundle", !/nominatim|router\.project-osrm|api\.mapbox\.com|maps\.googleapis/.test(geoSrc));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
