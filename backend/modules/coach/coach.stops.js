import { STOP_KINDS } from "./coach.model.js";
import { inPakistan } from "../maps/maps.geo.js";

// ---------------------------------------------------------------------------
// Route stops: validation of what an operator/admin submits, snapshotting onto a schedule, and the boarding/dropping
// combinations a customer may choose. Pure functions: no database.
// ---------------------------------------------------------------------------
const MAX_STOPS = 20;

// Returns { stops } (clean, ordered, validated) or { error }.
export function validateStopsInput(input) {
  if (!Array.isArray(input)) return { error: "Stops must be a list" };
  if (input.length < 2) return { error: "A route needs at least a start and an end stop" };
  if (input.length > MAX_STOPS) return { error: `A route can have at most ${MAX_STOPS} stops` };

  const stops = [];
  for (let i = 0; i < input.length; i++) {
    const s = input[i] || {};
    const name = String(s.name || "").trim().replace(/[<>]/g, "");
    if (name.length < 2 || name.length > 60) return { error: `Stop ${i + 1} needs a name (2-60 characters)` };
    const kind = i === 0 ? (s.kind === "intermediate" || s.kind === "dropping" ? "boarding" : s.kind || "boarding") : s.kind || "both";
    if (!STOP_KINDS.includes(kind)) return { error: `Stop "${name}" has an invalid type` };

    let latitude, longitude;
    const hasLat = s.latitude !== undefined && s.latitude !== null && s.latitude !== "";
    const hasLng = s.longitude !== undefined && s.longitude !== null && s.longitude !== "";
    if (hasLat !== hasLng) return { error: `Stop "${name}" needs both latitude and longitude, or neither` };
    if (hasLat) {
      latitude = Number(s.latitude); longitude = Number(s.longitude);
      if (!inPakistan(latitude, longitude)) return { error: `Stop "${name}" has coordinates outside Pakistan` };
    }

    const arr = Number(s.arrivalOffsetMin ?? 0), dep = Number(s.departureOffsetMin ?? arr);
    if (![arr, dep].every((n) => Number.isFinite(n) && n >= 0 && n <= 3000)) return { error: `Stop "${name}" has invalid times` };
    if (dep < arr) return { error: `Stop "${name}" cannot depart before it arrives` };
    if (i > 0 && arr < stops[i - 1].departureOffsetMin) return { error: `Stop "${name}" is reached before the previous stop is left` };
    if (i === 0 && (arr !== 0 || dep < 0)) return { error: "The first stop starts at minute 0" };

    stops.push({ name, kind, latitude, longitude, order: i, arrivalOffsetMin: i === 0 ? 0 : arr, departureOffsetMin: dep });
  }

  const names = stops.map((s) => s.name.toLowerCase());
  if (new Set(names).size !== names.length) return { error: "Two stops have the same name" };
  const last = stops[stops.length - 1];
  if (last.kind === "boarding" || last.kind === "intermediate") last.kind = "dropping"; // the end of the line is where people get off
  if (stops[0].kind === "dropping" || stops[0].kind === "intermediate") stops[0].kind = "boarding";
  return { stops };
}

// Copies the route's stops onto a schedule with absolute times
export function snapshotStops(routeStops, departureAt) {
  return [...(routeStops || [])].sort((a, b) => a.order - b.order).map((s, i) => ({
    stopId: s._id, name: s.name, kind: s.kind, latitude: s.latitude, longitude: s.longitude, order: i,
    arrivalAt: new Date(departureAt.getTime() + s.arrivalOffsetMin * 60000),
    departureAt: new Date(departureAt.getTime() + s.departureOffsetMin * 60000)
  }));
}

export const canBoardAt = (s) => s.kind === "boarding" || s.kind === "both";
export const canDropAt = (s) => s.kind === "dropping" || s.kind === "both";

// Picks the customer's boarding and dropping points. Defaults: first stop and last stop (the whole route).
// Returns { boardingPoint, droppingPoint } or { error }. Free-text from the client is never accepted: only stop ids.
export function resolvePoints(stops, boardingStopId, droppingStopId) {
  const list = [...(stops || [])].sort((a, b) => a.order - b.order);
  if (!list.length) return { boardingPoint: undefined, droppingPoint: undefined }; // legacy schedule without stops
  const find = (id) => list.find((s) => String(s.stopId) === String(id));

  const from = boardingStopId ? find(boardingStopId) : list[0];
  const to = droppingStopId ? find(droppingStopId) : list[list.length - 1];
  if (!from || !to) return { error: "Please choose a boarding and a dropping point from the list" };
  if (!canBoardAt(from)) return { error: `Passengers cannot board at ${from.name}` };
  if (!canDropAt(to)) return { error: `Passengers cannot get off at ${to.name}` };
  if (from.order >= to.order) return { error: "The dropping point must come after the boarding point" };

  const point = (s, time) => ({ stopId: s.stopId, name: s.name, order: s.order, time });
  return { boardingPoint: point(from, from.departureAt), droppingPoint: point(to, to.arrivalAt) };
}
