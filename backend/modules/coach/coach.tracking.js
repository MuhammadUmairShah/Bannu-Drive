import { haversineKm } from "../maps/maps.geo.js";

// ---------------------------------------------------------------------------
// Live coach tracking maths. Pure functions: everything is derived from REAL gps fixes and the route's stops.
// Nothing is guessed: when the data cannot support an answer, the answer is null.
// ---------------------------------------------------------------------------
export const TRIP_STATES = ["SCHEDULED", "BOARDING", "DEPARTED", "IN_TRANSIT", "ARRIVED", "COMPLETED", "CANCELLED"];
const NEXT = {
  SCHEDULED: ["BOARDING"],
  BOARDING: ["DEPARTED", "SCHEDULED"],
  DEPARTED: ["IN_TRANSIT", "ARRIVED"],
  IN_TRANSIT: ["ARRIVED"],
  ARRIVED: ["COMPLETED"],
  COMPLETED: [],
  CANCELLED: []
};
export const canMoveTrip = (from, to) => !!NEXT[from]?.includes(to);
export const TRACKING_STATES = ["DEPARTED", "IN_TRANSIT"]; // GPS is only accepted (and shown) while the coach is on the road

// How fresh a fix is. "live" must really mean live.
export const LIVE_SECONDS = 60;
export const STALE_SECONDS = 300;
export function freshness(at, now = new Date()) {
  if (!at) return { status: "none", ageSeconds: null };
  const age = Math.max(0, Math.round((now - new Date(at)) / 1000));
  return { status: age <= LIVE_SECONDS ? "live" : age <= STALE_SECONDS ? "stale" : "offline", ageSeconds: age };
}

// Validates an incoming GPS fix against the previous one. Returns { fix } or { error, status }.
export function validateFix(body, previous, now = new Date()) {
  const num = (v) => (v === undefined || v === null || v === "" ? undefined : Number(v));
  const latitude = num(body?.latitude), longitude = num(body?.longitude);
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude) || Math.abs(latitude) > 90 || Math.abs(longitude) > 180) return { error: "Valid latitude and longitude are required", status: 400 };
  if (latitude < 23 || latitude > 37.3 || longitude < 60.5 || longitude > 77.9) return { error: "Position is outside Pakistan", status: 422 };

  const accuracy = num(body.accuracy);
  if (accuracy !== undefined && (!Number.isFinite(accuracy) || accuracy < 0)) return { error: "Invalid accuracy", status: 400 };
  if (accuracy !== undefined && accuracy > 1000) return { error: "GPS accuracy is too low to use", status: 422 };
  const speed = num(body.speed); // m/s from the Geolocation API
  const heading = num(body.heading);

  // The device clock can be wrong: trust it only when it is close to ours
  let at = now;
  let clockSkew = false;
  if (body.timestamp !== undefined) {
    const t = new Date(typeof body.timestamp === "number" ? body.timestamp : String(body.timestamp));
    if (!Number.isNaN(t.getTime()) && t - now < 30000 && now - t < 120000) at = t; else clockSkew = true;
  }

  if (previous?.at) {
    if (at <= new Date(previous.at)) return { error: "Older than the last position", status: 409, stale: true };
    const dtH = (at - new Date(previous.at)) / 3600000;
    const km = haversineKm(previous, { latitude, longitude });
    if (dtH > 0 && km / dtH > 220 && km > 1) return { error: "Position jump looks wrong and was ignored", status: 422 };
  }
  return { fix: { latitude, longitude, accuracy, speed: Number.isFinite(speed) ? speed : undefined, heading: Number.isFinite(heading) ? heading : undefined, at, clockSkew } };
}

// ---------------------------------------------------------------------------
// Progress along the stop polyline. The vehicle is projected onto the nearest segment; `offRouteKm` says how far from
// the route it really is. Beyond OFF_ROUTE_KM the answer is "unknown", never a wrong place.
// ---------------------------------------------------------------------------
export const OFF_ROUTE_KM = 15;
const toXY = (p, ref) => [(p.longitude - ref.longitude) * 111.32 * Math.cos((ref.latitude * Math.PI) / 180), (p.latitude - ref.latitude) * 110.57];

export function computeProgress(stops, pos) {
  const pts = [...(stops || [])].sort((a, b) => a.order - b.order);
  const located = pts.filter((s) => Number.isFinite(s.latitude) && Number.isFinite(s.longitude));
  if (located.length < 2 || !pos) return { confidence: "none", reason: located.length < 2 ? "route has no coordinates" : "no position" };

  // cumulative distance to each located stop (straight segments)
  const cum = [0];
  for (let i = 1; i < located.length; i++) cum.push(cum[i - 1] + haversineKm(located[i - 1], located[i]));
  const total = cum[cum.length - 1];
  if (!(total > 0.5)) return { confidence: "none", reason: "route too short" };

  let best = { dist: Infinity, along: 0, seg: 0 };
  for (let i = 0; i < located.length - 1; i++) {
    const [ax, ay] = [0, 0];
    const [bx, by] = toXY(located[i + 1], located[i]);
    const [px, py] = toXY(pos, located[i]);
    const len2 = bx * bx + by * by;
    const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((px - ax) * bx + (py - ay) * by) / len2));
    const d = Math.hypot(px - (ax + t * bx), py - (ay + t * by));
    if (d < best.dist) best = { dist: d, along: cum[i] + t * (cum[i + 1] - cum[i]), seg: i };
  }

  if (best.dist > OFF_ROUTE_KM) return { confidence: "low", offRouteKm: Math.round(best.dist * 10) / 10, reason: "far from the route" };

  const along = best.along;
  const passed = (s) => { const k = located.indexOf(s); return k >= 0 && cum[k] <= along - 0.3; };
  const passedStops = pts.filter((s) => located.includes(s) && passed(s)).map((s) => s.name);
  const atStop = located.find((s, k) => Math.abs(cum[k] - along) <= 0.5);
  // While AT a stop, the next stop is the one after it
  const upcoming = pts.filter((s) => located.includes(s) && !passed(s) && s !== atStop);
  const next = upcoming[0] || null;
  const prev = [...pts].reverse().find((s) => located.includes(s) && passed(s)) || null;

  let label;
  if (atStop) label = `At ${atStop.name}`;
  else {
    const nearest = located.map((s, k) => ({ s, d: Math.abs(cum[k] - along) })).sort((a, b) => a.d - b.d)[0];
    label = nearest.d <= 5 ? `Near ${nearest.s.name}` : prev && next ? `Between ${prev.name} and ${next.name}` : next ? `Before ${next.name}` : `Past ${prev?.name}`;
  }
  return {
    confidence: best.dist <= 5 ? "high" : "medium",
    fraction: Math.max(0, Math.min(1, along / total)),
    alongKm: Math.round(along * 10) / 10, totalKm: Math.round(total * 10) / 10, remainingKm: Math.round((total - along) * 10) / 10,
    offRouteKm: Math.round(best.dist * 10) / 10,
    label, currentStop: atStop?.name || null, nextStop: next?.name || null, nextStopKm: next ? Math.round(Math.max(0, cum[located.indexOf(next)] - along) * 10) / 10 : null,
    passedStops
  };
}

// ETA only when it can be trusted: a fresh fix, real progress, and enough recent movement to know the speed.
// Straight stop-to-stop segments under-estimate road distance, so a road factor is applied and the result is "approximate".
export const ROAD_FACTOR = 1.25;
export function estimateEta(progress, recentFixes, now = new Date()) {
  if (!progress || progress.confidence === "none" || progress.confidence === "low" || !(progress.remainingKm >= 0)) return null;
  const fixes = (recentFixes || []).filter((f) => f.at).sort((a, b) => new Date(b.at) - new Date(a.at));
  if (!fixes.length || (now - new Date(fixes[0].at)) / 1000 > LIVE_SECONDS) return null; // never extrapolate from stale data
  const moving = fixes.slice(0, 8).filter((f) => Number.isFinite(f.speed) && f.speed * 3.6 >= 15);
  if (moving.length < 3) return null;
  const avgKmh = (moving.reduce((a, f) => a + f.speed, 0) / moving.length) * 3.6;
  if (!(avgKmh >= 15 && avgKmh <= 130)) return null;
  const minutes = Math.round(((progress.remainingKm * ROAD_FACTOR) / avgKmh) * 60);
  return { minutes, approximate: true, basedOnKmh: Math.round(avgKmh) };
}
