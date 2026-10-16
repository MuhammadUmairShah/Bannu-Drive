// Pure-logic tests for stops and live tracking (no database, no network).
import { validateStopsInput, snapshotStops, resolvePoints } from "../modules/coach/coach.stops.js";
import { computeProgress, estimateEta, freshness, validateFix, canMoveTrip, OFF_ROUTE_KM } from "../modules/coach/coach.tracking.js";

let pass = 0, fail = 0; const failures = [];
const check = (n, c, x = "") => { if (c) { pass++; console.log(`  PASS  ${n}`); } else { fail++; failures.push(n); console.log(`  FAIL  ${n} ${String(x).slice(0, 250)}`); } };
const section = (t) => console.log(`\n== ${t}`);

const route = [
  { name: "Bannu", kind: "boarding", latitude: 32.9889, longitude: 70.6056, arrivalOffsetMin: 0, departureOffsetMin: 0 },
  { name: "Bannu Bus Stand", kind: "boarding", latitude: 32.9925, longitude: 70.6, arrivalOffsetMin: 0, departureOffsetMin: 10 },
  { name: "Kohat", kind: "both", latitude: 33.5869, longitude: 71.4414, arrivalOffsetMin: 150, departureOffsetMin: 165 },
  { name: "Peshawar", kind: "both", latitude: 34.0151, longitude: 71.5249, arrivalOffsetMin: 240, departureOffsetMin: 255 },
  { name: "Islamabad", kind: "dropping", latitude: 33.6844, longitude: 73.0479, arrivalOffsetMin: 420, departureOffsetMin: 420 }
];
section("Stops: validation");
let v = validateStopsInput(route);
check("a valid route is accepted, ordered 0..n, first=boarding last=dropping", v.stops?.length === 5 && v.stops.every((s, i) => s.order === i) && v.stops[0].kind === "boarding" && v.stops[4].kind === "dropping", JSON.stringify(v).slice(0, 200));
check("fewer than 2 stops, or non-list, is rejected", !!validateStopsInput([route[0]]).error && !!validateStopsInput("x").error && !!validateStopsInput(null).error);
check("more than 20 stops is rejected", !!validateStopsInput(Array.from({ length: 21 }, (_, i) => ({ name: `Stop ${i}`, arrivalOffsetMin: i * 5, departureOffsetMin: i * 5 }))).error);
check("duplicate names are rejected", !!validateStopsInput([route[0], { ...route[2] }, { ...route[2], arrivalOffsetMin: 200, departureOffsetMin: 200 }]).error);
check("a stop with only latitude (no longitude) is rejected", !!validateStopsInput([route[0], { name: "X", latitude: 33 }]).error);
check("coordinates outside Pakistan are rejected", !!validateStopsInput([route[0], { name: "London", latitude: 51.5, longitude: -0.12, arrivalOffsetMin: 10, departureOffsetMin: 10 }]).error);
check("times must not go backwards", !!validateStopsInput([route[0], { name: "A", arrivalOffsetMin: 100, departureOffsetMin: 100 }, { name: "B", arrivalOffsetMin: 50, departureOffsetMin: 50 }]).error && !!validateStopsInput([route[0], { name: "A", arrivalOffsetMin: 100, departureOffsetMin: 90 }]).error);
check("script tags / angle brackets in names are stripped", validateStopsInput([{ name: "<b>Bannu</b>" }, { name: "Peshawar", arrivalOffsetMin: 10, departureOffsetMin: 10 }]).stops[0].name === "bBannu/b");
check("stops without coordinates are allowed (live progress is then simply unavailable)", validateStopsInput([{ name: "Bannu" }, { name: "Peshawar", arrivalOffsetMin: 200, departureOffsetMin: 200 }]).stops.length === 2);

section("Stops: schedule snapshot and boarding/dropping choice");
const dep = new Date("2026-11-01T05:00:00Z");
const stops = snapshotStops(v.stops.map((s, i) => ({ ...s, _id: `id${i}` })), dep);
check("snapshot turns offsets into absolute times", stops[2].arrivalAt.toISOString() === "2026-11-01T07:30:00.000Z" && stops[4].arrivalAt.toISOString() === "2026-11-01T12:00:00.000Z");
let p = resolvePoints(stops);
check("default = whole route (first to last stop)", p.boardingPoint.name === "Bannu" && p.droppingPoint.name === "Islamabad" && p.droppingPoint.time.toISOString() === "2026-11-01T12:00:00.000Z");
p = resolvePoints(stops, "id2", "id3");
check("a mid-route boarding and dropping pair is allowed", p.boardingPoint.name === "Kohat" && p.droppingPoint.name === "Peshawar");
check("dropping before boarding is refused", !!resolvePoints(stops, "id3", "id2").error && !!resolvePoints(stops, "id2", "id2").error);
check("boarding at a drop-only stop, or dropping at a boarding-only stop, is refused", !!resolvePoints(stops, "id4", undefined).error && !!resolvePoints(stops, undefined, "id1").error);
check("an unknown stop id (or free text) is refused", !!resolvePoints(stops, "nope", "id3").error && !!resolvePoints(stops, "<script>", undefined).error);
check("schedules with no stops (legacy) still work", resolvePoints([]).boardingPoint === undefined && !resolvePoints([]).error);
const mid = snapshotStops([{ _id: "m", name: "Pass", kind: "intermediate", order: 0, arrivalOffsetMin: 0, departureOffsetMin: 0 }, { _id: "e", name: "End", kind: "dropping", order: 1, arrivalOffsetMin: 60, departureOffsetMin: 60 }], dep);
check("an intermediate stop cannot be a boarding point", !!resolvePoints(mid, "m", "e").error);

section("Progress along the route (real positions only)");
const S = stops;
let pr = computeProgress(S, { latitude: 33.5869, longitude: 71.4414 });
check("at Kohat: 'At Kohat', previous stops passed, next is Peshawar", pr.label === "At Kohat" && pr.currentStop === "Kohat" && pr.nextStop === "Peshawar" && pr.passedStops.includes("Bannu") && !pr.passedStops.includes("Kohat") && pr.confidence === "high", JSON.stringify(pr));
pr = computeProgress(S, { latitude: 33.3, longitude: 71.0 });
check("between stops: a 'Between A and B' / 'Near X' label with a sensible fraction", /^(Between Kohat|Between Bannu|Near)/.test(pr.label) && pr.fraction > 0.05 && pr.fraction < 0.6, JSON.stringify(pr));
pr = computeProgress(S, { latitude: 24.86, longitude: 67.0 });
check("a position in Karachi is 'far from the route': NO place name, NO progress", pr.confidence === "low" && pr.label === undefined && pr.fraction === undefined && pr.offRouteKm > OFF_ROUTE_KM);
pr = computeProgress(S, { latitude: 32.9889, longitude: 70.6056 });
check("at the very start: fraction 0, nothing passed", pr.fraction < 0.01 && pr.passedStops.length === 0);
pr = computeProgress(S, { latitude: 33.6844, longitude: 73.0479 });
check("at the destination: fraction ~1, everything but the last stop passed", pr.fraction > 0.99 && pr.currentStop === "Islamabad" && pr.nextStop === null && pr.remainingKm < 1);
check("progress grows monotonically along the route", (() => { const pts = [[32.99, 70.6], [33.3, 71.0], [33.59, 71.44], [33.8, 71.5], [34.0, 71.52], [33.9, 72.3], [33.68, 73.04]].map(([la, lo]) => computeProgress(S, { latitude: la, longitude: lo }).fraction); return pts.every((x, i) => i === 0 || x >= pts[i - 1]); })());
check("no coordinates on the route, or no position -> no progress (never a guess)", computeProgress([{ order: 0, name: "A" }, { order: 1, name: "B" }], { latitude: 33, longitude: 71 }).confidence === "none" && computeProgress(S, null).confidence === "none");

section("ETA only when it can be trusted");
const now = new Date("2026-11-01T09:00:00Z");
const fixes = (n, speedKmh, ageS = 5) => Array.from({ length: n }, (_, i) => ({ at: new Date(now - (ageS + i * 10) * 1000), speed: speedKmh / 3.6 }));
const pg = computeProgress(S, { latitude: 33.5869, longitude: 71.4414 });
let eta = estimateEta(pg, fixes(5, 70), now);
check("fresh fixes, moving 70 km/h: an approximate ETA from remaining distance", eta?.approximate === true && eta.minutes > 60 && eta.minutes < 300 && eta.basedOnKmh === 70, JSON.stringify(eta));
check("stale fixes (2 min old) -> no ETA", estimateEta(pg, fixes(5, 70, 130), now) === null);
check("too few moving samples -> no ETA", estimateEta(pg, fixes(2, 70), now) === null);
check("standing still / crawling -> no ETA", estimateEta(pg, fixes(6, 5), now) === null);
check("low-confidence progress -> no ETA", estimateEta(computeProgress(S, { latitude: 24.86, longitude: 67 }), fixes(5, 70), now) === null);
check("no fixes at all -> no ETA", estimateEta(pg, [], now) === null);

section("Freshness: live must really mean live");
const t0 = new Date("2026-11-01T09:00:00Z");
check("5 s old = live, 90 s = stale, 10 min = offline, none = none", freshness(new Date(t0 - 5000), t0).status === "live" && freshness(new Date(t0 - 90000), t0).status === "stale" && freshness(new Date(t0 - 600000), t0).status === "offline" && freshness(null, t0).status === "none");
check("exactly 60 s is still live, 61 s is stale", freshness(new Date(t0 - 60000), t0).status === "live" && freshness(new Date(t0 - 61000), t0).status === "stale");

section("GPS fix validation");
const ok = (o) => validateFix({ latitude: 33.5, longitude: 71.4, ...o }, null, t0);
check("a good fix is accepted with accuracy, speed and heading", ok({ accuracy: 12, speed: 18.5, heading: 270 }).fix?.speed === 18.5);
check("bad / missing / out-of-range coordinates -> 400", [undefined, "abc", 91, null].every((la) => validateFix({ latitude: la, longitude: 71 }, null, t0).status === 400));
check("a position outside Pakistan -> 422", validateFix({ latitude: 51.5, longitude: -0.12 }, null, t0).status === 422);
check("terrible accuracy (> 1 km) is refused", ok({ accuracy: 5000 }).status === 422 && ok({ accuracy: -1 }).status === 400);
check("a device clock far from ours is not trusted (server time used, flagged)", validateFix({ latitude: 33.5, longitude: 71.4, timestamp: Date.parse("2020-01-01") }, null, t0).fix.clockSkew === true && +validateFix({ latitude: 33.5, longitude: 71.4, timestamp: Date.parse("2020-01-01") }, null, t0).fix.at === +t0);
check("a timestamp a few seconds old is trusted", +validateFix({ latitude: 33.5, longitude: 71.4, timestamp: +t0 - 4000 }, null, t0).fix.at === +t0 - 4000);
const prev = { latitude: 33.5, longitude: 71.4, at: new Date(t0 - 20000) };
check("a fix older than or equal to the last one is rejected (409)", validateFix({ latitude: 33.5, longitude: 71.4, timestamp: +prev.at - 1000 }, prev, t0).status === 409);
check("a teleport (300 km in 20 s) is rejected as implausible", validateFix({ latitude: 33.5, longitude: 74.5 }, prev, t0).status === 422);
check("normal motion (400 m in 20 s) is accepted", !!validateFix({ latitude: 33.5036, longitude: 71.4 }, prev, t0).fix);

section("Trip state machine");
check("the normal journey is allowed step by step", [["SCHEDULED", "BOARDING"], ["BOARDING", "DEPARTED"], ["DEPARTED", "IN_TRANSIT"], ["IN_TRANSIT", "ARRIVED"], ["ARRIVED", "COMPLETED"]].every(([a, b]) => canMoveTrip(a, b)));
check("skipping or reversing is not (except un-boarding), and ends are final", !canMoveTrip("SCHEDULED", "DEPARTED") && !canMoveTrip("DEPARTED", "BOARDING") && !canMoveTrip("COMPLETED", "SCHEDULED") && !canMoveTrip("CANCELLED", "BOARDING") && canMoveTrip("BOARDING", "SCHEDULED") && !canMoveTrip("IN_TRANSIT", "COMPLETED"));

console.log(`\n==== ${pass} passed, ${fail} failed ====`);
if (fail) { console.log("Failures:\n - " + failures.join("\n - ")); process.exit(1); }
