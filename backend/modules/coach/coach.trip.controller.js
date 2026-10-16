import { CoachSchedule, CoachBooking, CoachRoute, CoachTripPoint } from "./coach.model.js";
import { validateStopsInput } from "./coach.stops.js";
import { TRIP_STATES, TRACKING_STATES, canMoveTrip, freshness, validateFix, computeProgress, estimateEta } from "./coach.tracking.js";
import { emitToRoom, trackRoom } from "../../shared/realtime/socket.js";
import { createNotification } from "../notifications/notification.service.js";
import { audit } from "../audit/audit.service.js";
import { str } from "../../shared/utils/objectId.js";
import { haversineKm } from "../maps/maps.geo.js";
import { releaseScheduleHolds } from "./coach.holds.js";

const fail = (res, status, message, extra = {}) => res.status(status).json({ success: false, message, ...extra });
const serverError = (res, label, error) => { console.error(`${label}:`, error); return fail(res, 500, "Something went wrong"); };

// =========================================================================================
// ROUTE STOPS (operator: own routes; admin: any route). Existing schedules keep their own snapshot.
// =========================================================================================
async function saveStops(req, res, filter) {
  try {
    const route = await CoachRoute.findOne({ _id: req.params.id, ...filter });
    if (!route) return fail(res, 404, "Route not found");
    const { stops, error } = validateStopsInput(req.body?.stops);
    if (error) return fail(res, 400, error);
    route.stops = stops;
    await route.save();
    await audit(req, "route.stops_updated", { entityType: "Route", entityId: route._id, meta: { stops: stops.map((s) => s.name) } });
    return res.json({ success: true, message: "Stops saved. They apply to schedules you create from now on.", stops: route.stops });
  } catch (error) { return serverError(res, "Save Stops Error", error); }
}
export const setRouteStopsOperator = (req, res) => saveStops(req, res, { operator: req.operator.id });
export const setRouteStopsAdmin = (req, res) => saveStops(req, res, {});

// =========================================================================================
// WHAT A VIEWER MAY SEE about a trip. Built only from stored data: a missing position stays missing.
// =========================================================================================
export async function buildTrack(schedule, { now = new Date(), booking = null } = {}) {
  const trip = schedule.trip || {};
  const last = trip.lastLocation?.at ? trip.lastLocation : null;
  const tracking = TRACKING_STATES.includes(trip.state);
  const fresh = freshness(last?.at, now);

  let status;
  if (trip.state === "CANCELLED") status = "cancelled";
  else if (["ARRIVED", "COMPLETED"].includes(trip.state)) status = "ended";
  else if (!tracking) status = "not_started";
  else status = fresh.status === "none" ? "waiting" : fresh.status; // on the road, but no GPS received yet

  const pos = last && ["DEPARTED", "IN_TRANSIT", "ARRIVED"].includes(trip.state) ? { latitude: last.latitude, longitude: last.longitude, at: last.at, speed: last.speed ?? null, heading: last.heading ?? null, accuracy: last.accuracy ?? null } : null;
  const progress = pos ? computeProgress(schedule.stops, pos) : null;

  let eta = null;
  if (pos && status === "live") {
    const recent = await CoachTripPoint.find({ schedule: schedule._id }).sort({ at: -1 }).limit(8).select("at speed");
    eta = estimateEta(progress, recent.map((r) => ({ at: r.at, speed: r.speed })), now);
  }

  const passed = new Set(progress?.passedStops || []);
  return {
    scheduleId: schedule._id,
    trip: { state: trip.state || "SCHEDULED", stateChangedAt: trip.stateChangedAt, delayMin: trip.delayMin || 0 },
    route: { fromCity: schedule.fromCity, toCity: schedule.toCity, departureAt: schedule.departureAt, arrivalAt: schedule.arrivalAt },
    stops: (schedule.stops || []).map((s) => ({ name: s.name, kind: s.kind, order: s.order, latitude: s.latitude, longitude: s.longitude, arrivalAt: s.arrivalAt, departureAt: s.departureAt, passed: passed.has(s.name) })),
    boardingPoint: booking?.boardingPoint, droppingPoint: booking?.droppingPoint,
    status,                       // live | stale | offline | waiting | not_started | ended | cancelled
    ageSeconds: fresh.ageSeconds, // how old the last real GPS fix is
    position: pos,                // null unless a real fix exists
    // Only a trustworthy position on the route yields progress; anything weaker is shown as "Location unavailable"
    progress: progress && ["high", "medium"].includes(progress.confidence) ? progress : null,
    etaMinutes: eta ? eta.minutes : null, etaApproximate: eta ? true : undefined,
    locationLabel: progress?.label || (pos && progress?.confidence === "low" ? "Location unavailable" : null),
    serverTime: now
  };
}

// GET /coach/bookings/:bookingId/track  (customer: only their own confirmed booking)
export async function trackForCustomer(req, res) {
  try {
    const booking = await CoachBooking.findOne({ _id: req.params.bookingId, customer: req.user.id, status: { $in: ["CONFIRMED", "COMPLETED"] } });
    if (!booking) return fail(res, 404, "Booking not found");
    const schedule = await CoachSchedule.findById(booking.schedule).populate("coach", "name registrationNumber");
    if (!schedule) return fail(res, 404, "Trip not found");
    return res.json({ success: true, ...(await buildTrack(schedule, { booking })) });
  } catch (error) { return serverError(res, "Track For Customer Error", error); }
}

// GET /coach/operator/schedules/:id/track  (owner operator)
export async function trackForOperator(req, res) {
  try {
    const schedule = await CoachSchedule.findOne({ _id: req.params.id, operator: req.operator.id });
    if (!schedule) return fail(res, 404, "Schedule not found");
    return res.json({ success: true, ...(await buildTrack(schedule)) });
  } catch (error) { return serverError(res, "Track For Operator Error", error); }
}

// =========================================================================================
// TRIP STATE (operator): SCHEDULED -> BOARDING -> DEPARTED -> IN_TRANSIT -> ARRIVED -> COMPLETED
// Every change is an atomic claim from the expected previous state.
// =========================================================================================
const STATE_TEXT = {
  BOARDING: (s) => `Boarding has started for your coach to ${s.toCity}. Please go to the boarding point with your ticket.`,
  DEPARTED: (s) => `Your coach to ${s.toCity} has departed. You can track it live from My Bookings.`,
  ARRIVED: (s) => `Your coach has arrived in ${s.toCity}.`,
  SCHEDULED: (s) => `Boarding for your coach to ${s.toCity} was paused. We will let you know when it starts.`
};

async function notifyPassengers(schedule, title, message) {
  const customers = await CoachBooking.distinct("customer", { schedule: schedule._id, status: "CONFIRMED" });
  for (const c of customers) await createNotification(c, { type: "coach_trip_update", title, message: message.slice(0, 400), serviceType: "coach_booking", serviceId: schedule._id });
}

export async function setTripState(req, res) {
  try {
    const to = str(req.body?.state, 12).toUpperCase();
    if (!TRIP_STATES.includes(to) || to === "CANCELLED") return fail(res, 400, "Invalid trip state. Use the cancel action to cancel a trip.");

    const schedule = await CoachSchedule.findOne({ _id: req.params.id, operator: req.operator.id });
    if (!schedule) return fail(res, 404, "Schedule not found");
    if (schedule.status === "cancelled") return fail(res, 409, "This trip was cancelled");

    const from = schedule.trip?.state || "SCHEDULED";
    if (from === to) return res.json({ success: true, message: "Already in this state", state: to }); // idempotent
    if (!canMoveTrip(from, to)) return fail(res, 409, `A trip cannot go from ${from} to ${to}`, { code: "INVALID_TRIP_STATE", from, to });
    if (to === "BOARDING" && schedule.departureAt.getTime() - Date.now() > 4 * 3600000) return fail(res, 409, "Boarding can start up to 4 hours before departure", { code: "TOO_EARLY" });

    const now = new Date();
    const claimed = await CoachSchedule.findOneAndUpdate(
      { _id: schedule._id, operator: req.operator.id, status: "scheduled", "trip.state": { $in: from === "SCHEDULED" ? ["SCHEDULED", null] : [from] } },
      { $set: { "trip.state": to, "trip.stateChangedAt": now }, $push: { "trip.history": { state: to, at: now, by: req.user.id } } },
      { returnDocument: "after" }
    );
    if (!claimed) return fail(res, 409, "The trip changed. Please refresh.", { code: "TRIP_CHANGED" });

    // Once the coach has left, unpaid holds are pointless: give those seats back immediately
    if (to === "DEPARTED" || to === "COMPLETED") await releaseScheduleHolds(schedule._id, { by: "system", reason: "The coach has departed" });

    if (to === "COMPLETED") {
      const orders = await CoachBooking.distinct("order", { schedule: schedule._id, status: "CONFIRMED", order: { $exists: true } });
      await CoachBooking.updateMany({ schedule: schedule._id, status: "CONFIRMED" }, { $set: { status: "COMPLETED" }, $unset: { activeSeatKey: 1 } });
      if (orders.length) await (await import("./coach.order.model.js")).CoachOrder.updateMany({ _id: { $in: orders }, status: "CONFIRMED" }, { $set: { status: "COMPLETED" } });
      await CoachSchedule.updateOne({ _id: schedule._id }, { $set: { status: "completed" } });
    }

    await audit(req, "trip.state_changed", { entityType: "Schedule", entityId: schedule._id, meta: { from, to } });
    if (STATE_TEXT[to]) await notifyPassengers(schedule, "Trip update", STATE_TEXT[to](schedule));
    emitToRoom(trackRoom(schedule._id), "coach:trip-state", { scheduleId: String(schedule._id), state: to, at: now });
    return res.json({ success: true, message: `Trip is now ${to}`, state: to });
  } catch (error) { return serverError(res, "Set Trip State Error", error); }
}

// POST /coach/operator/schedules/:id/delay { minutes }: tells passengers the coach is late (a real, human-entered fact)
export async function setDelay(req, res) {
  try {
    const minutes = Math.round(Number(req.body?.minutes));
    if (!Number.isFinite(minutes) || minutes < 0 || minutes > 720) return fail(res, 400, "Delay must be between 0 and 720 minutes");
    const schedule = await CoachSchedule.findOne({ _id: req.params.id, operator: req.operator.id, status: "scheduled" });
    if (!schedule) return fail(res, 404, "Schedule not found");
    if (["ARRIVED", "COMPLETED"].includes(schedule.trip?.state)) return fail(res, 409, "This trip has already ended");
    const before = schedule.trip?.delayMin || 0;
    if (before === minutes) return res.json({ success: true, message: "Delay unchanged", delayMin: minutes });
    await CoachSchedule.updateOne({ _id: schedule._id }, { $set: { "trip.delayMin": minutes } });
    await audit(req, "trip.delay_set", { entityType: "Schedule", entityId: schedule._id, meta: { from: before, to: minutes } });
    await notifyPassengers(schedule, "Coach delayed", minutes ? `Your coach to ${schedule.toCity} is running about ${minutes} minutes late.` : `Your coach to ${schedule.toCity} is back on time.`);
    emitToRoom(trackRoom(schedule._id), "coach:trip-state", { scheduleId: String(schedule._id), state: schedule.trip?.state || "SCHEDULED", delayMin: minutes, at: new Date() });
    return res.json({ success: true, message: "Delay recorded and passengers notified", delayMin: minutes });
  } catch (error) { return serverError(res, "Set Delay Error", error); }
}

// =========================================================================================
// GPS INGESTION: POST /coach/operator/schedules/:id/location
// From the operator's/driver's browser (Geolocation API). Accepted only while the coach is on the road, only for the
// owning operator, only if plausible. Stored as received; never smoothed, never extrapolated.
// =========================================================================================
const MIN_INTERVAL_MS = 2500;
export async function postLocation(req, res) {
  try {
    const schedule = await CoachSchedule.findOne({ _id: req.params.id, operator: req.operator.id });
    if (!schedule) return fail(res, 404, "Schedule not found");
    if (schedule.status === "cancelled" || schedule.trip?.state === "CANCELLED") return fail(res, 409, "This trip was cancelled", { code: "TRIP_ENDED" });
    if (!TRACKING_STATES.includes(schedule.trip?.state)) return fail(res, 409, "Tracking is only active after the coach has departed. Set the trip to DEPARTED first.", { code: "TRACKING_INACTIVE", state: schedule.trip?.state || "SCHEDULED" });

    const previous = schedule.trip?.lastLocation?.at ? schedule.trip.lastLocation : null;
    const now = new Date();
    if (previous?.receivedAt && now - new Date(previous.receivedAt) < MIN_INTERVAL_MS) return res.json({ success: true, throttled: true });

    const result = validateFix(req.body, previous, now);
    if (result.error) return fail(res, result.status, result.error);
    const fix = result.fix;

    // A device that cannot report speed gets one derived from real movement (marked by the absence of device speed upstream)
    if (fix.speed === undefined && previous) {
      const dt = (fix.at - new Date(previous.at)) / 1000;
      if (dt >= 3) fix.speed = (haversineKm(previous, fix) * 1000) / dt;
    }

    const stored = { latitude: fix.latitude, longitude: fix.longitude, accuracy: fix.accuracy, speed: fix.speed, heading: fix.heading, at: fix.at, receivedAt: now };
    const upd = await CoachSchedule.updateOne(
      { _id: schedule._id, "trip.state": { $in: TRACKING_STATES }, $or: [{ "trip.lastLocation.at": { $exists: false } }, { "trip.lastLocation.at": { $lt: fix.at } }] },
      { $set: { "trip.lastLocation": stored } }
    );
    if (!upd.modifiedCount) return fail(res, 409, "Older than the last position", { stale: true });

    await CoachTripPoint.create({ schedule: schedule._id, operator: req.operator.id, ...stored });

    // push to authorised watchers: position + progress, no passenger data
    const progress = computeProgress(schedule.stops, fix);
    emitToRoom(trackRoom(schedule._id), "coach:location", {
      scheduleId: String(schedule._id), coachId: String(schedule.coach), latitude: fix.latitude, longitude: fix.longitude, at: fix.at, speed: fix.speed ?? null, heading: fix.heading ?? null,
      status: "live", tripState: schedule.trip.state,
      progress: ["high", "medium"].includes(progress.confidence) ? progress : null, locationLabel: progress.label || (progress.confidence === "low" ? "Location unavailable" : null)
    });
    return res.json({ success: true, accepted: true, clockSkew: fix.clockSkew || undefined });
  } catch (error) { return serverError(res, "Post Location Error", error); }
}
