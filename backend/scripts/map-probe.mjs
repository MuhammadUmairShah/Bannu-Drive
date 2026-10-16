// Compares map providers on the places that matter for Bannu Drive. Run it YOURSELF with your keys:
//   MAPBOX_TOKEN=sk... GOOGLE_MAPS_KEY=... MAPS_CONTACT_EMAIL=you@example.com npm run maps:probe
// It prints, per provider, the top search results (name, coordinates, distance from Bannu centre), reverse-geocoding
// behaviour, and the routes Bannu -> Peshawar / Islamabad. Review the output by eye; flags only catch gross errors.
import { OsmProvider } from "../modules/maps/providers/osm.provider.js";
import { MapboxProvider } from "../modules/maps/providers/mapbox.provider.js";
import { GoogleProvider } from "../modules/maps/providers/google.provider.js";
import { BANNU, haversineKm } from "../modules/maps/maps.geo.js";
import { describeReverse, checkRoute } from "../modules/maps/maps.service.js";

const PLACES = ["Bannu City", "Bannu Cantt", "Bannu City Center", "Chowk Bazaar Bannu", "Miranshah Road Bannu", "UST Bannu", "DHQ Hospital Bannu", "Bannu Bus Stand"];
const ROUTES = [["Peshawar", 150, 300], ["Islamabad", 280, 480]]; // plausible road-km ranges from Bannu
const providers = [new OsmProvider(), new MapboxProvider(), new GoogleProvider()].filter((p) => p.isConfigured());
const km = (a, b) => haversineKm(a, b).toFixed(1);
let flags = 0;

console.log(`Providers to test: ${providers.map((p) => p.id).join(", ")}\n`);
for (const p of providers) {
  console.log(`==================== ${p.id.toUpperCase()} ====================`);
  const tops = {};
  for (const q of PLACES) {
    try {
      const res = await p.geocode({ query: q, near: BANNU, limit: 5 });
      const top = res[0];
      const d = top ? haversineKm(BANNU, top) : null;
      const flag = !top ? "NO RESULT" : d > 40 ? `FAR (${d.toFixed(0)} km from Bannu)` : "";
      if (flag) flags++;
      tops[q] = top;
      console.log(`${q.padEnd(24)} -> ${top ? `${top.address} [${top.latitude.toFixed(4)}, ${top.longitude.toFixed(4)}] kind=${top.kind} conf=${top.confidence.toFixed(2)} ${km(BANNU, top)}km` : "(none)"} ${flag ? "  <-- " + flag : ""}`);
      res.slice(1, 3).forEach((r) => console.log(`${"".padEnd(24)}    also: ${r.address} (${r.latitude.toFixed(4)}, ${r.longitude.toFixed(4)})`));
    } catch (e) { flags++; console.log(`${q.padEnd(24)} ERROR ${e.message}`); }
  }
  console.log("\n-- reverse geocoding (what the app would show for a pin) --");
  for (const [label, pt] of [["Bannu centre", BANNU], ["+1 km east", { latitude: BANNU.latitude, longitude: BANNU.longitude + 0.0107 }], ["open land ~8 km NE", { latitude: 33.05, longitude: 70.66 }]]) {
    try { const d = describeReverse(pt, await p.reverse(pt)); console.log(`${label.padEnd(20)} -> ${d.label ?? "(no name: coordinates shown)"} ${d.accuracyMeters != null ? `[${d.accuracyMeters} m away${d.approximate ? ", approximate" : ""}]` : ""}`); } catch (e) { flags++; console.log(`${label.padEnd(20)} ERROR ${e.message}`); }
  }
  console.log("\n-- routes from Bannu --");
  for (const [city, lo, hi] of ROUTES) {
    try {
      const dest = (await p.geocode({ query: city, near: BANNU, limit: 3 })).find((x) => haversineKm(BANNU, x) > 50);
      if (!dest) { flags++; console.log(`Bannu -> ${city}: destination not found`); continue; }
      const r = await p.route({ from: BANNU, to: dest });
      let ok = true; try { checkRoute(BANNU, dest, r); } catch { ok = false; }
      const inRange = r.distanceKm >= lo && r.distanceKm <= hi;
      if (!ok || !inRange) flags++;
      console.log(`Bannu -> ${city.padEnd(10)} ${r.distanceKm.toFixed(0)} km, ${(r.durationMin / 60).toFixed(1)} h, ${r.path.length} pts  ${ok && inRange ? "ok" : `<-- CHECK (expected about ${lo}-${hi} km)`}`);
    } catch (e) { flags++; console.log(`Bannu -> ${city}: ERROR ${e.message}`); }
  }
  console.log("");
}
console.log(flags ? `${flags} item(s) flagged above: review them before choosing a provider.` : "No gross problems flagged. Still review the results by eye, especially UST Bannu, Chowk Bazaar and Bus Stand.");
