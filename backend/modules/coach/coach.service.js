import crypto from "crypto";
import { CoachOperator, CoachSchedule, CoachBooking } from "./coach.model.js";
import { CoachOrder, CoachPayment } from "./coach.order.model.js";
import { cfg } from "./coach.config.js";
import { isProd } from "../../shared/config/env.js";
import { HOLDING, SEAT_OCCUPYING } from "./coach.states.js";
import { requestRefund } from "./coach.refunds.js";
import userModel from "../users/user.model.js";
import { countByKey } from "../../shared/utils/aggregate.js";
import { createNotification } from "../notifications/notification.service.js";
import { emitToRoom, emitToUser, coachRoom, coachOpsRoom } from "../../shared/realtime/socket.js";
import { audit } from "../audit/audit.service.js";

// ---------------- configuration ----------------
// Pakistan has no daylight saving, so a fixed offset is safe. Change for another country.
export const TZ_OFFSET = process.env.COACH_TIMEZONE_OFFSET || "+05:00";
export const BOOKING_CLOSES_MIN_BEFORE = 30; // no new bookings in the last 30 minutes
export const CUSTOMER_CANCEL_HOURS_BEFORE = 2; // customer may cancel until 2h before departure
export const MAX_SEATS_PER_BOOKING = 4;
// Bookings that are real, cancellable tickets. (Temporary holds are NOT bookings: see SEAT_OCCUPYING / occupiedFilter.)
export const ACTIVE_STATUSES = ["CONFIRMED"];
export { SEAT_OCCUPYING, HOLDING };

// Which seat records currently take a seat: confirmed tickets + holds that have not yet expired.
// A hold stays visible for `grace` seconds after expiry, so it matches the moment others may actually take it.
export function occupiedFilter(now = new Date()) {
  return {
    $or: [
      { status: "CONFIRMED" },
      { status: { $in: HOLDING }, holdExpiresAt: { $gt: new Date(now.getTime() - cfg.graceMs()) } }
    ]
  };
}

// Start / end instants of a local calendar day "YYYY-MM-DD"
export function dayRange(dateStr) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateStr || "")) return null;
  const start = new Date(`${dateStr}T00:00:00${TZ_OFFSET}`);
  if (Number.isNaN(start.getTime())) return null;
  return { start, end: new Date(start.getTime() + 24 * 3600 * 1000) };
}

// "Today" as YYYY-MM-DD in the operating timezone
export function localToday(now = new Date()) {
  const sign = TZ_OFFSET.startsWith("-") ? -1 : 1;
  const [h, m] = TZ_OFFSET.slice(1).split(":").map(Number);
  return new Date(now.getTime() + sign * (h * 60 + m) * 60000).toISOString().slice(0, 10);
}

// ---------------- seat layouts ----------------
export const seatLabel = (n) => String(n).padStart(2, "0");

export function layoutError(layout) {
  if (!layout || typeof layout !== "object") return "Seat layout is required";
  const { rows, left, right } = layout;
  const blocked = layout.blocked ?? [];

  if (![rows, left, right].every(Number.isInteger)) return "Rows, left seats and right seats must be whole numbers";
  if (rows < 1 || rows > 20) return "Rows must be between 1 and 20";
  if (left < 1 || left > 3) return "Left side must have 1 to 3 seats per row";
  if (right < 0 || right > 3) return "Right side must have 0 to 3 seats per row";
  if (rows * (left + right) > 60) return "A coach can have at most 60 seats";
  if (!Array.isArray(blocked) || blocked.some((b) => typeof b !== "string")) return "Blocked seats must be a list";

  const valid = new Set(buildSeats({ rows, left, right, blocked: [] }).map((s) => s.label));
  if (blocked.some((b) => !valid.has(b))) return "A blocked seat does not exist in this layout";
  if (new Set(blocked).size !== blocked.length) return "Duplicate blocked seats";
  if (blocked.length >= rows * (left + right)) return "At least one seat must be sellable";
  return null;
}

export const cleanLayout = (l) => ({
  rows: l.rows, left: l.left, right: l.right, blocked: [...new Set(l.blocked ?? [])].sort()
});

export const sellableSeats = (layout) => layout.rows * (layout.left + layout.right) - (layout.blocked?.length || 0);

// Full list of physical seats with grid position
export function buildSeats(layout) {
  const per = layout.left + layout.right;
  const blocked = new Set(layout.blocked || []);
  const seats = [];
  let n = 0;

  for (let row = 0; row < layout.rows; row++) {
    for (let col = 0; col < per; col++) {
      n += 1;
      const label = seatLabel(n);
      seats.push({ label, row, col, side: col < layout.left ? "left" : "right", blocked: blocked.has(label) });
    }
  }
  return seats;
}

// Customer-facing seat map: AVAILABLE | HELD | BOOKED | BLOCKED. SELECTED is a client-only state.
// `mine` marks the viewer's own seats (hold or ticket) so their page can show them differently. No passenger data here.
export async function seatMap(schedule, { viewerId = null, now = new Date() } = {}) {
  const taken = await CoachBooking.find({ schedule: schedule._id, ...occupiedFilter(now) }).select("seat status customer order");
  const bySeat = new Map(taken.map((b) => [b.seat, b]));

  const seats = buildSeats(schedule.layout).map((s) => {
    const b = bySeat.get(s.label);
    const status = s.blocked ? "BLOCKED" : !b ? "AVAILABLE" : b.status === "CONFIRMED" ? "BOOKED" : "HELD";
    const seat = { label: s.label, row: s.row, col: s.col, side: s.side, status };
    if (b && viewerId && String(b.customer) === String(viewerId)) {
      seat.mine = true;
      if (b.order) seat.orderId = b.order;
    }
    return seat;
  });

  return {
    seats,
    layout: { rows: schedule.layout.rows, left: schedule.layout.left, right: schedule.layout.right },
    availableSeats: seats.filter((s) => s.status === "AVAILABLE").length,
    version: schedule.seatVersion || 0,
    serverTime: now
  };
}

// availableSeats for many schedules in one query
export async function availabilityFor(schedules) {
  if (!schedules.length) return {};
  const counts = await countByKey(
    CoachBooking,
    { schedule: { $in: schedules.map((s) => s._id) }, ...occupiedFilter() },
    "schedule"
  );
  return Object.fromEntries(schedules.map((s) => [s._id.toString(), Math.max(0, s.totalSeats - (counts[s._id.toString()] || 0))]));
}

// Operators whose coaches may be sold: approved by admin and not blocked
// Demo data (fake operators, coaches, schedules) is OFF in production unless ALLOW_DEMO_DATA=true, so a real customer can
// never book a demo trip. In development it is on by default.
export const demoEnabled = () => (process.env.ALLOW_DEMO_DATA ? process.env.ALLOW_DEMO_DATA === "true" : !isProd());

export async function bookableOperatorIds() {
  const ops = await CoachOperator.find(demoEnabled() ? {} : { isDemo: { $ne: true } }).populate("user", "isVerified isBlocked role");
  return ops.filter((o) => o.user && o.user.role === "operator" && o.user.isVerified && !o.user.isBlocked).map((o) => o._id);
}

// ---------------- booking codes ----------------
const CODE_CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // no 0/O/1/I
export function newBookingCode() {
  let code = "BD-";
  for (let i = 0; i < 6; i++) code += CODE_CHARS[crypto.randomInt(CODE_CHARS.length)];
  return code;
}

// ---------------- housekeeping ----------------
// Finished trips become COMPLETED (and release their seat key); finished schedules close.
export async function sweepCoachData(now = new Date()) {
  const finishing = { status: "CONFIRMED", arrivalAt: { $lt: now } };
  const orders = await CoachBooking.distinct("order", { ...finishing, order: { $exists: true } });

  await CoachBooking.updateMany(finishing, { $set: { status: "COMPLETED" }, $unset: { activeSeatKey: 1 } });
  if (orders.length) await CoachOrder.updateMany({ _id: { $in: orders }, status: "CONFIRMED" }, { $set: { status: "COMPLETED" } });
  await CoachSchedule.updateMany({ status: "scheduled", arrivalAt: { $lt: now } }, { $set: { status: "completed" } });
}

// ---------------- notifications + live seat events ----------------
// Tells everyone watching a schedule that seats changed. `status` is what the seats became:
// "HELD" | "BOOKED" | "AVAILABLE". `version` increases by exactly 1 per event, so a client that sees a jump knows it
// missed something and re-fetches the authoritative seat map instead of guessing.
export async function pushSeatUpdate(scheduleId, seats, status) {
  const sched = await CoachSchedule.findByIdAndUpdate(scheduleId, { $inc: { seatVersion: 1 } }, { returnDocument: "after" });
  if (!sched) return;
  const occupied = await CoachBooking.countDocuments({ schedule: scheduleId, ...occupiedFilter() });
  const availableSeats = Math.max(0, sched.totalSeats - occupied);

  // Public room: seat labels + status only. Never passenger data.
  emitToRoom(coachRoom(scheduleId), "coach:seats", { scheduleId: String(scheduleId), seats, status, availableSeats, version: sched.seatVersion, at: new Date() });
  // Operator/admin room: a hint to refetch the detailed map over the authorised REST API (no PII over the socket)
  emitToRoom(coachOpsRoom(scheduleId), "coach:ops-update", { scheduleId: String(scheduleId), seats, status, version: sched.seatVersion });
}

// The owner's own checkout page reacts to this (e.g. "your hold expired")
export function pushOrderUpdate(order, extra = {}) {
  emitToUser(order.customer, "coach:order-updated", { orderId: String(order._id), status: order.status, paymentStatus: order.paymentStatus, ...extra });
}

export async function notifyOperator(operatorId, data) {
  const op = await CoachOperator.findById(operatorId).select("user");
  if (op) await createNotification(op.user, { serviceType: "coach_booking", ...data });
}

export const publicUser = (id) => userModel.findById(id).select("name");

// ---------------- cancellation (shared by customer / operator / admin / schedule cancellation) ----------------
// Cancels ONE confirmed ticket: frees the seat, keeps the record, creates a refund when money was paid online.
// Returns the updated booking, or null if it was not an active ticket (already cancelled / expired / completed).
export async function cancelBookingRecord(booking, { by, reason, req = null }) {
  const result = await CoachBooking.updateOne(
    { _id: booking._id, status: "CONFIRMED" },
    { $set: { status: "CANCELLED", cancelledAt: new Date(), cancelledBy: by, cancelReason: reason || "" }, $unset: { activeSeatKey: 1, holdExpiresAt: 1 } }
  );
  if (!result.matchedCount) return null;

  const fresh = await CoachBooking.findById(booking._id);

  // ---- money ----
  if (fresh.paymentMethod === "ONLINE" && fresh.paymentStatus === "PAID" && fresh.order) {
    const order = await CoachOrder.findById(fresh.order);
    const payment = order && (await CoachPayment.findOne({ order: order._id, status: { $in: ["PAID", "PARTIALLY_REFUNDED"] } }));
    if (payment) {
      const pct = by === "customer" ? cfg.customerRefundPercent() : 100;
      await requestRefund({ payment, order, booking: fresh, amount: Math.floor((fresh.fare * pct) / 100), kind: "CANCELLATION", reason: `Booking ${fresh.bookingCode} cancelled by ${by}` });
    }
  } else if (fresh.paymentMethod === "CASH" && fresh.paymentStatus === "PAID") {
    await CoachBooking.updateOne({ _id: fresh._id }, { $set: { paymentStatus: "REFUND_REQUIRED" } }); // cash already collected: operator settles it
  } else if (fresh.paymentStatus === "CASH_DUE" || fresh.paymentStatus === "PENDING") {
    await CoachBooking.updateOne({ _id: fresh._id }, { $set: { paymentStatus: "CANCELLED" } });
  }

  // ---- order roll-up: when its last live ticket is cancelled the order is cancelled too ----
  if (fresh.order) {
    const remaining = await CoachBooking.countDocuments({ order: fresh.order, status: { $in: ["CONFIRMED", "COMPLETED"] } });
    if (!remaining) {
      await CoachOrder.updateOne({ _id: fresh.order, status: "CONFIRMED" }, { $set: { status: "CANCELLED", cancelledAt: new Date(), cancelledBy: by, cancelReason: reason || "" } });
    }
  }

  await audit(req || { actorRole: by }, "booking.cancelled", {
    entityType: "Booking", entityId: booking._id,
    meta: { by, reason: reason || "", bookingCode: booking.bookingCode, schedule: String(booking.schedule), seat: booking.seat }
  });

  const label = `${booking.fromCity} → ${booking.toCity} (seat ${booking.seat}, ${booking.bookingCode})`;

  if (by !== "customer") {
    await createNotification(booking.customer, {
      type: "coach_booking_cancelled", title: "Coach booking cancelled",
      message: `Your booking ${label} was cancelled by the ${by}.${reason ? ` Reason: ${reason}` : ""}`.slice(0, 400),
      serviceType: "coach_booking", serviceId: booking._id
    });
  } else {
    await createNotification(booking.customer, {
      type: "coach_booking_cancelled", title: "Booking cancelled",
      message: `You cancelled ${label}. The seat has been released.`.slice(0, 400),
      serviceType: "coach_booking", serviceId: booking._id
    });
  }

  if (by !== "operator") {
    await notifyOperator(booking.operator, {
      type: "coach_booking_cancelled", title: "Booking cancelled",
      message: `${booking.passenger.name} · ${label}${reason ? ` · ${reason}` : ""}`.slice(0, 400), serviceId: booking._id
    });
  }

  await pushSeatUpdate(booking.schedule, [booking.seat], "AVAILABLE");
  return CoachBooking.findById(booking._id);
}
