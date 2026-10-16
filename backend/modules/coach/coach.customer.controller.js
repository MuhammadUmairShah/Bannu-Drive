import { CoachSchedule, CoachBooking, CoachOperator, cityKey } from "./coach.model.js";
import { isValidPhone } from "../../shared/utils/validators.js";
import { str } from "../../shared/utils/objectId.js";
import {
  dayRange, seatMap, availabilityFor, bookableOperatorIds, sweepCoachData, buildSeats, cancelBookingRecord,
  ACTIVE_STATUSES, BOOKING_CLOSES_MIN_BEFORE, CUSTOMER_CANCEL_HOURS_BEFORE, MAX_SEATS_PER_BOOKING
} from "./coach.service.js";
import { holdSeats, HoldError } from "./coach.holds.js";
import { ensureQrToken, qrPayloadOf } from "./coach.scan.js";
import { resolvePoints } from "./coach.stops.js";
import { confirmWithCash } from "./coach.payment.service.js";

const fail = (res, status, message, extra = {}) => res.status(status).json({ success: false, message, ...extra });
const serverError = (res, label, error) => {
  console.error(`${label}:`, error);
  return fail(res, 500, "Something went wrong");
};

const populateSchedule = (q) =>
  q.populate("operator", "companyName isDemo").populate("coach", "name type amenities registrationNumber isActive");

const closesAt = (schedule) => new Date(schedule.departureAt.getTime() - BOOKING_CLOSES_MIN_BEFORE * 60000);
const isBookable = (schedule, available, now = new Date()) =>
  schedule.status === "scheduled" && now < closesAt(schedule) && available > 0;

function scheduleCard(s, available) {
  const tripInfo = { tripState: s.trip?.state || "SCHEDULED", delayMin: s.trip?.delayMin || 0 };
  return {
    ...tripInfo,
    _id: s._id,
    operator: { _id: s.operator._id, companyName: s.operator.companyName, isDemo: s.operator.isDemo },
    coach: { name: s.coach.name, type: s.coach.type, amenities: s.coach.amenities, registrationNumber: s.coach.registrationNumber },
    fromCity: s.fromCity,
    toCity: s.toCity,
    departureAt: s.departureAt,
    arrivalAt: s.arrivalAt,
    fare: s.fare,
    totalSeats: s.totalSeats,
    availableSeats: available,
    bookable: isBookable(s, available),
    status: s.status
  };
}

// One shape for a booking everywhere (customer, operator, admin)
// Owner-facing tickets: a view that also carries the QR payload. Never used for operator or admin listings.
export async function ticketViews(list) {
  const out = [];
  for (const b of list) {
    const view = bookingView(b);
    if (["CONFIRMED", "COMPLETED"].includes(b.status)) view.qrPayload = qrPayloadOf(await ensureQrToken(b));
    view.checkInStatus = b.checkInStatus || "NONE";
    view.boardedAt = b.boardedAt;
    out.push(view);
  }
  return out;
}

export function bookingView(b) {
  const now = new Date();
  const hoursLeft = (new Date(b.departureAt) - now) / 3600000;

  return {
    _id: b._id,
    bookingCode: b.bookingCode,
    status: b.status,
    seat: b.seat,
    fare: b.fare,
    passenger: b.passenger,
    fromCity: b.fromCity,
    toCity: b.toCity,
    departureAt: b.departureAt,
    arrivalAt: b.arrivalAt,
    scheduleId: b.schedule?._id || b.schedule,
    operator: b.operator && b.operator.companyName ? { _id: b.operator._id, companyName: b.operator.companyName, isDemo: b.operator.isDemo } : undefined,
    coach: b.schedule?.coach?.name ? { name: b.schedule.coach.name, type: b.schedule.coach.type } : undefined,
    customer: b.customer && b.customer.name ? { _id: b.customer._id, name: b.customer.name, phone: b.customer.phone } : undefined,
    orderId: b.order,
    boardingPoint: b.boardingPoint ? { name: b.boardingPoint.name, time: b.boardingPoint.time } : undefined,
    droppingPoint: b.droppingPoint ? { name: b.droppingPoint.name, time: b.droppingPoint.time } : undefined,
    paymentMethod: b.paymentMethod || "",
    paymentStatus: b.paymentStatus || "UNPAID",
    confirmedAt: b.confirmedAt,
    holdExpiresAt: ["HOLD", "PENDING_PAYMENT"].includes(b.status) ? b.holdExpiresAt : undefined,
    createdAt: b.createdAt,
    cancelledAt: b.cancelledAt,
    cancelledBy: b.cancelledBy,
    cancelReason: b.cancelReason,
    canCancel: ACTIVE_STATUSES.includes(b.status) && hoursLeft >= CUSTOMER_CANCEL_HOURS_BEFORE
  };
}

export const populateBooking = (q) =>
  q.populate("operator", "companyName isDemo").populate({ path: "schedule", select: "coach", populate: { path: "coach", select: "name type" } });

// ==========================================
// GET /coach/cities  - cities that currently have sellable departures
// ==========================================
export async function listCities(req, res) {
  try {
    const ops = await bookableOperatorIds();
    const upcoming = await CoachSchedule.find({ operator: { $in: ops }, status: "scheduled", departureAt: { $gt: new Date() } })
      .select("fromCity toCity")
      .limit(2000);

    const from = [...new Set(upcoming.map((s) => s.fromCity))].sort();
    const to = [...new Set(upcoming.map((s) => s.toCity))].sort();
    const pairs = [...new Set(upcoming.map((s) => `${s.fromCity}|${s.toCity}`))].map((p) => {
      const [f, t] = p.split("|");
      return { from: f, to: t };
    });

    return res.json({ success: true, from, to, pairs });
  } catch (error) {
    return serverError(res, "List Cities Error", error);
  }
}

// ==========================================
// GET /coach/search?from=&to=&date=YYYY-MM-DD
// from, to and date are ALL optional.
//   - nothing sent  -> every upcoming coach (plus trips that are on the road right now)
//   - any filter    -> only the matching ones
// Replace the old searchSchedules function in coach.customer.controller.js with this one.
// ==========================================
export async function searchSchedules(req, res) {
  try {
    const rawDate = str(req.query.date, 10);
    const from = cityKey(str(req.query.from, 50));
    const to = cityKey(str(req.query.to, 50));
    const range = rawDate ? dayRange(rawDate) : null;

    if (from && from.length < 2) return fail(res, 400, "Please enter a valid From city");
    if (to && to.length < 2) return fail(res, 400, "Please enter a valid To city");
    if (from && to && from === to) return fail(res, 400, "From and To must be different cities");
    if (rawDate && !range) return fail(res, 400, "Please choose a valid travel date");

    await sweepCoachData();
    const ops = await bookableOperatorIds();
    const now = new Date();

    // Not departed yet (inside the chosen day, if a date was given)
    const upcoming = { departureAt: { $gte: range && range.start > now ? range.start : now } };
    if (range) upcoming.departureAt.$lt = range.end;

    // Already departed but still on the road. Shown so customers can see the coach is live.
    // Only when no date is chosen, or the chosen day includes "now".
    const includeRunning = !range || (range.start <= now && now < range.end);
    const running = { departureAt: { $lt: now }, arrivalAt: { $gte: now } };

    const filter = {
      operator: { $in: ops },
      status: "scheduled",
      $or: includeRunning ? [upcoming, running] : [upcoming]
    };
    if (from) filter.fromKey = from;
    if (to) filter.toKey = to;

    const schedules = await populateSchedule(
      CoachSchedule.find(filter).sort({ departureAt: 1 }).limit(200)
    );

    const live = schedules.filter((s) => s.coach && s.coach.isActive && s.operator);
    const availability = await availabilityFor(live);

    return res.json({ success: true, schedules: live.map((s) => scheduleCard(s, availability[s._id.toString()])) });
  } catch (error) {
    return serverError(res, "Search Schedules Error", error);
  }
}

// ==========================================
// GET /coach/schedules/:scheduleId  - details + seat map
// ==========================================
export async function getScheduleWithSeats(req, res) {
  try {
    const schedule = await populateSchedule(CoachSchedule.findById(req.params.scheduleId));
    const ops = (await bookableOperatorIds()).map(String);

    if (!schedule || !schedule.operator || !ops.includes(schedule.operator._id.toString()) || !schedule.coach) {
      return fail(res, 404, "Schedule not found");
    }

    const map = await seatMap(schedule, { viewerId: req.user?.id });

    return res.json({
      success: true,
      schedule: { ...scheduleCard(schedule, map.availableSeats), bookingClosesAt: closesAt(schedule), maxSeatsPerBooking: MAX_SEATS_PER_BOOKING },
      stops: (schedule.stops || []).map((st) => ({ stopId: st.stopId, name: st.name, kind: st.kind, order: st.order, latitude: st.latitude, longitude: st.longitude, arrivalAt: st.arrivalAt, departureAt: st.departureAt })),
      layout: map.layout,
      seats: map.seats,
      version: map.version,
      serverTime: map.serverTime
    });
  } catch (error) {
    return serverError(res, "Get Schedule Error", error);
  }
}

// ==========================================
// Shared by POST /coach/orders and the legacy POST /coach/bookings
// ==========================================
// Validates the request body. The frontend is never trusted. Returns { error } or { scheduleId, items }.
export function parseSeatRequest(body) {
  const scheduleId = str(body?.scheduleId, 30);
  const requested = Array.isArray(body?.seats) ? body.seats : null;

  if (!/^[a-fA-F0-9]{24}$/.test(scheduleId)) return { error: [400, "A valid schedule is required"] };
  if (!requested || requested.length < 1) return { error: [400, "Please choose at least one seat"] };
  if (requested.length > MAX_SEATS_PER_BOOKING) return { error: [400, `You can book at most ${MAX_SEATS_PER_BOOKING} seats at a time`] };

  const items = [];
  for (const entry of requested) {
    const seat = str(entry?.seat, 4);
    const name = str(entry?.passenger?.name, 60);
    const phone = str(entry?.passenger?.phone, 20);
    const gender = str(entry?.passenger?.gender, 6).toLowerCase();

    if (!seat) return { error: [400, "Every booking needs a seat number"] };
    if (name.length < 2) return { error: [400, `Please enter the passenger name for seat ${seat}`] };
    if (!isValidPhone(phone)) return { error: [400, `Please enter a valid phone number for seat ${seat}`] };
    if (gender && !["male", "female"].includes(gender)) return { error: [400, "Invalid gender"] };

    items.push({ seat, passenger: { name, phone, gender } });
  }
  if (new Set(items.map((i) => i.seat)).size !== items.length) return { error: [400, "The same seat was selected twice"] };
  return { scheduleId, items };
}

// Loads the schedule and checks everything that can be checked BEFORE seats are touched. Returns { schedule } or { error }.
export async function loadSellableSchedule(scheduleId, items) {
  const schedule = await populateSchedule(CoachSchedule.findById(scheduleId));
  const okOperators = (await bookableOperatorIds()).map(String);

  if (!schedule || !schedule.operator || !schedule.coach || !okOperators.includes(schedule.operator._id.toString())) return { error: [404, "Schedule not found"] };
  if (schedule.status !== "scheduled" || !schedule.coach.isActive) return { error: [409, "This trip is no longer available"] };
  if (new Date() >= closesAt(schedule)) return { error: [409, "Booking for this trip has closed"] };

  const physical = new Map(buildSeats(schedule.layout).map((s) => [s.label, s]));
  for (const i of items) {
    const seat = physical.get(i.seat);
    if (!seat) return { error: [400, `Seat ${i.seat} does not exist on this coach`] };
    if (seat.blocked) return { error: [409, `Seat ${i.seat} is not available`, { conflictSeats: [i.seat] }] };
  }
  return { schedule };
}

// Boarding/dropping points: only stop ids are accepted (never free text) and the pair must be valid for this trip
export function pointsFromRequest(schedule, body) {
  return resolvePoints(schedule.stops, str(body?.boardingStopId, 30) || undefined, str(body?.droppingStopId, 30) || undefined);
}

export const idempotencyKeyOf = (req) => req.get("Idempotency-Key") || req.body?.idempotencyKey || undefined;

export function sendHoldError(res, error) {
  return fail(res, error.status, error.message, { code: error.extra?.code, ...error.extra });
}

// ==========================================
// POST /coach/bookings   (original one-step flow, kept for compatibility)
// Reserves the seats atomically and confirms them as a CASH booking in one call. Same response as before.
// New clients use POST /coach/orders -> pay, which supports holds and online payment.
// ==========================================
export async function createBooking(req, res) {
  try {
    const parsed = parseSeatRequest(req.body);
    if (parsed.error) return fail(res, parsed.error[0], parsed.error[1]);

    const loaded = await loadSellableSchedule(parsed.scheduleId, parsed.items);
    if (loaded.error) return fail(res, loaded.error[0], loaded.error[1], loaded.error[2] || {});

    const points = pointsFromRequest(loaded.schedule, req.body);
    if (points.error) return fail(res, 400, points.error);
    const { order } = await holdSeats({ customerId: req.user.id, schedule: loaded.schedule, items: parsed.items, idemKey: idempotencyKeyOf(req), points });
    const { order: confirmed } = await confirmWithCash(order, req.user.id);

    const full = await populateBooking(CoachBooking.find({ order: confirmed._id }).sort({ seat: 1 }));
    return res.status(201).json({
      success: true,
      message: "Booking confirmed",
      bookings: await ticketViews(full),
      totalFare: full.reduce((sum, b) => sum + b.fare, 0)
    });
  } catch (error) {
    if (error instanceof HoldError) return sendHoldError(res, error);
    return serverError(res, "Create Coach Booking Error", error);
  }
}

// ==========================================
// GET /coach/bookings/mine?tab=upcoming|completed|cancelled
// ==========================================
export async function myBookings(req, res) {
  try {
    await sweepCoachData();
    const tab = str(req.query.tab, 12);
    const filter = { customer: req.user.id };
    let sort = { departureAt: -1 };

    if (tab === "upcoming") { filter.status = { $in: ACTIVE_STATUSES }; sort = { departureAt: 1 }; }
    else if (tab === "completed") filter.status = "COMPLETED";
    else if (tab === "cancelled") filter.status = "CANCELLED";

    const rows = await populateBooking(CoachBooking.find(filter).sort(sort).limit(200));
    return res.json({ success: true, bookings: await ticketViews(rows) });
  } catch (error) {
    return serverError(res, "My Bookings Error", error);
  }
}

// ==========================================
// GET /coach/bookings/:bookingId  (owner customer, owning operator, admin)
// ==========================================
export async function getBooking(req, res) {
  try {
    const b = await populateBooking(CoachBooking.findById(req.params.bookingId)).populate("customer", "name phone");
    if (!b) return fail(res, 404, "Booking not found");

    let allowed = req.user.role === "admin" || b.customer._id.toString() === req.user.id;

    if (!allowed && req.user.role === "operator") {
      const op = await CoachOperator.findOne({ user: req.user.id }).select("_id");
      allowed = !!op && op._id.toString() === b.operator._id.toString();
    }

    // Same answer for "missing" and "not yours"
    if (!allowed) return fail(res, 404, "Booking not found");

    return res.json({ success: true, booking: (await ticketViews([b]))[0] });
  } catch (error) {
    return serverError(res, "Get Coach Booking Error", error);
  }
}

// ==========================================
// PATCH /coach/bookings/:bookingId/cancel  (customer)
// ==========================================
export async function cancelMyBooking(req, res) {
  try {
    const b = await CoachBooking.findOne({ _id: req.params.bookingId, customer: req.user.id });
    if (!b) return fail(res, 404, "Booking not found");
    if (!ACTIVE_STATUSES.includes(b.status)) return fail(res, 409, `A ${b.status.toLowerCase()} booking cannot be cancelled`);

    const hoursLeft = (b.departureAt - new Date()) / 3600000;
    if (hoursLeft < CUSTOMER_CANCEL_HOURS_BEFORE) {
      return fail(res, 409, `Cancellation closes ${CUSTOMER_CANCEL_HOURS_BEFORE} hours before departure. Please contact the operator.`);
    }

    const updated = await cancelBookingRecord(b, { by: "customer", reason: str(req.body?.reason, 200), req });
    if (!updated) return fail(res, 409, "This booking was already cancelled");

    const full = await populateBooking(CoachBooking.findById(updated._id));
    return res.json({ success: true, message: "Booking cancelled. Your seat has been released.", booking: bookingView(full) });
  } catch (error) {
    return serverError(res, "Cancel Coach Booking Error", error);
  }
}

