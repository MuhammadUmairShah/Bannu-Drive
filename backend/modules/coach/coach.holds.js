import crypto from "crypto";
import { CoachBooking, CoachSchedule } from "./coach.model.js";
import { CoachOrder, CoachPayment } from "./coach.order.model.js";
import { cfg } from "./coach.config.js";
import { HOLDING, OPEN_ORDER, fromStates } from "./coach.states.js";
import { newBookingCode, pushSeatUpdate, pushOrderUpdate, notifyOperator, occupiedFilter } from "./coach.service.js";
import { createNotification } from "../notifications/notification.service.js";
import { audit } from "../audit/audit.service.js";
import { newQrToken } from "./coach.scan.js";
import { isDuplicateKey } from "../../shared/utils/dbErrors.js";

export class HoldError extends Error {
  constructor(status, message, extra = {}) {
    super(message);
    this.name = "HoldError";
    this.status = status;
    this.extra = extra;
  }
}

const CODE_CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
export function newOrderCode() {
  let code = "BO-";
  for (let i = 0; i < 8; i++) code += CODE_CHARS[crypto.randomInt(CODE_CHARS.length)];
  return code;
}

const ago = (now, ms) => new Date(now.getTime() - ms);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const idemKeyOf = (customerId, key) => (typeof key === "string" && /^[A-Za-z0-9_-]{8,80}$/.test(key) ? `${customerId}:${key}` : undefined);

// =========================================================================================
// EXPIRE: an order whose hold ran out becomes EXPIRED and its seats are released.
// `force` skips the time check (used when a trip is cancelled). Safe to call from anywhere, any number of times.
// =========================================================================================
export async function expireOrder(orderId, { now = new Date(), force = false, reason = "hold expired" } = {}) {
  const filter = { _id: orderId, status: { $in: OPEN_ORDER } };
  if (!force) filter.holdExpiresAt = { $lt: ago(now, cfg.graceMs()) };

  const prev = await CoachOrder.findOneAndUpdate(
    filter,
    { $set: { status: "EXPIRED", expiredAt: now, purgeAt: new Date(now.getTime() + cfg.retentionMs()), cancelReason: reason.slice(0, 200) }, $unset: { slotKey: 1 } },
    { returnDocument: "before" }
  );
  if (!prev) return null; // someone else decided this order first (confirmed, extended, cancelled...)

  const seats = await CoachBooking.find({ order: orderId, status: { $in: HOLDING } }).select("seat");
  await CoachBooking.updateMany(
    { order: orderId, status: { $in: HOLDING } },
    { $set: { status: "EXPIRED", expiredAt: now, paymentStatus: prev.paymentStatus === "PENDING" ? "EXPIRED" : "UNPAID", purgeAt: new Date(now.getTime() + cfg.retentionMs()) }, $unset: { activeSeatKey: 1, holdExpiresAt: 1 } }
  );

  // An unfinished payment is closed, but it can still succeed later at the provider: that is handled as a "late payment"
  await CoachPayment.updateMany(
    { order: orderId, status: { $in: ["PENDING", "PROCESSING"] } },
    { $set: { status: "EXPIRED" }, $push: { events: { $each: [{ id: `expire:${now.getTime()}`, status: "EXPIRED", source: "system", note: reason }], $slice: -50 } } }
  );
  if (prev.paymentStatus === "PENDING") await CoachOrder.updateOne({ _id: orderId }, { $set: { paymentStatus: "EXPIRED" } });

  if (seats.length) await pushSeatUpdate(prev.schedule, seats.map((s) => s.seat), "AVAILABLE");

  if (prev.status !== "CREATING") {
    await createNotification(prev.customer, {
      type: "coach_hold_expired", title: "Seat hold expired",
      message: `Your seat hold for booking ${prev.orderCode} expired and the seats were released. Please book again.`,
      serviceType: "coach_booking", serviceId: prev._id
    });
    pushOrderUpdate({ ...prev.toObject(), status: "EXPIRED" });
  }
  return prev;
}

// Customer / admin / system gives up a hold before paying. Terminal, and different from expiry.
export async function releaseOrder(orderId, { by = "customer", reason = "released", now = new Date() } = {}) {
  const prev = await CoachOrder.findOneAndUpdate(
    { _id: orderId, status: { $in: OPEN_ORDER } },
    { $set: { status: "CANCELLED", cancelledAt: now, cancelledBy: by, cancelReason: reason.slice(0, 200), purgeAt: new Date(now.getTime() + cfg.failedAttemptRetentionMs()) }, $unset: { slotKey: 1 } },
    { returnDocument: "before" }
  );
  if (!prev) return null;

  const seats = await CoachBooking.find({ order: orderId, status: { $in: HOLDING } }).select("seat");
  await CoachBooking.updateMany(
    { order: orderId, status: { $in: HOLDING } },
    { $set: { status: "CANCELLED", cancelledAt: now, cancelledBy: by, cancelReason: reason.slice(0, 200), paymentStatus: "CANCELLED", purgeAt: new Date(now.getTime() + cfg.failedAttemptRetentionMs()) }, $unset: { activeSeatKey: 1, holdExpiresAt: 1 } }
  );
  await CoachPayment.updateMany(
    { order: orderId, status: { $in: ["PENDING", "PROCESSING"] } },
    { $set: { status: "CANCELLED" }, $push: { events: { $each: [{ id: `release:${now.getTime()}`, status: "CANCELLED", source: by, note: reason }], $slice: -50 } } }
  );
  await CoachOrder.updateOne({ _id: orderId, paymentStatus: { $in: ["PENDING", "UNPAID"] } }, { $set: { paymentStatus: "CANCELLED" } });

  if (seats.length) await pushSeatUpdate(prev.schedule, seats.map((s) => s.seat), "AVAILABLE");
  pushOrderUpdate({ ...prev.toObject(), status: "CANCELLED" });
  return prev;
}

// =========================================================================================
// CONFIRM: HOLD / PENDING_PAYMENT -> CONFIRMED. Exactly one caller wins the atomic claim; everyone else gets null.
// Cash can confirm only while the hold is live. A VERIFIED online payment may land inside the grace window.
// =========================================================================================
export async function confirmOrder(orderId, { method, paymentStatus, paid = false, paymentId = undefined, now = new Date() }) {
  const liveAfter = paid ? ago(now, cfg.graceMs()) : now;
  const set = { status: "CONFIRMED", paymentMethod: method, paymentStatus, confirmedAt: now };
  if (paymentId) set.payment = paymentId;

  const order = await CoachOrder.findOneAndUpdate(
    { _id: orderId, status: { $in: fromStates("CONFIRMED") }, holdExpiresAt: { $gt: liveAfter } },
    { $set: set, $unset: { slotKey: 1 } },
    { returnDocument: "after" }
  );
  if (!order) return null;
  // `fromStates("CONFIRMED")` includes only HOLD/PENDING_PAYMENT here (late recovery has its own path)

  const res = await CoachBooking.updateMany(
    { order: orderId, status: { $in: HOLDING } },
    { $set: { status: "CONFIRMED", paymentMethod: method, paymentStatus, confirmedAt: now }, $unset: { holdExpiresAt: 1 } }
  );
  if (res.modifiedCount !== order.seatCount) {
    await CoachOrder.updateOne({ _id: orderId }, { $set: { needsAttention: true } }); // never silently ignore an inconsistency
    console.error(`Order ${order.orderCode}: confirmed ${res.modifiedCount}/${order.seatCount} seats`);
  }

  await afterConfirmed(order, now);
  return order;
}

async function afterConfirmed(order, now) {
  const sched = await CoachSchedule.findById(order.schedule).select("fromCity toCity");
  const route = sched ? `${sched.fromCity} → ${sched.toCity}` : "your trip";
  const seatList = order.seats.join(", ");

  await createNotification(order.customer, {
    type: "coach_booking_confirmed", title: "Coach booking confirmed",
    message: `${route}, seat ${seatList}. Booking ${order.orderCode}.${order.paymentMethod === "CASH" ? " Pay cash to the operator." : ""}`.slice(0, 400),
    serviceType: "coach_booking", serviceId: order._id
  });
  await notifyOperator(order.operator, {
    type: "coach_booking_new", title: "New coach booking",
    message: `New booking: seat ${seatList} on ${route} (${order.orderCode}, ${order.paymentMethod === "CASH" ? "cash on boarding" : "paid online"}).`.slice(0, 400),
    serviceId: order._id
  });
  await pushSeatUpdate(order.schedule, order.seats, "BOOKED");
  pushOrderUpdate(order);
  await audit({ actor: order.customer, actorRole: "customer" }, "booking.confirmed", {
    entityType: "Order", entityId: order._id,
    meta: { orderCode: order.orderCode, method: order.paymentMethod, paymentStatus: order.paymentStatus, seats: order.seats, late: !!order.lateConfirmed, amount: order.amount }
  });
}

// =========================================================================================
// LATE RECOVERY: a verified payment arrived after the hold expired. If every seat is still free, take them back
// (the unique activeSeatKey index decides) and confirm. Otherwise nothing changes and the caller refunds.
// =========================================================================================
export async function recoverExpiredOrder(orderId, { paymentId, now = new Date() }) {
  const order = await CoachOrder.findById(orderId);
  if (!order || order.status !== "EXPIRED") return { ok: false, reason: "not_expired" };

  const sched = await CoachSchedule.findOne({ _id: order.schedule, status: "scheduled" }).select("departureAt");
  if (!sched || sched.departureAt <= now) return { ok: false, reason: "trip_unavailable" };

  const seats = await CoachBooking.find({ order: orderId, status: "EXPIRED" }).sort({ seat: 1 });
  if (seats.length !== order.seatCount) return { ok: false, reason: "seats_missing" };

  const taken = [];
  for (const b of seats) {
    try {
      const r = await CoachBooking.updateOne(
        { _id: b._id, status: "EXPIRED" },
        { $set: { status: "CONFIRMED", activeSeatKey: `${b.schedule}:${b.seat}`, paymentMethod: "ONLINE", paymentStatus: "PAID", confirmedAt: now }, $unset: { expiredAt: 1, purgeAt: 1, holdExpiresAt: 1 } }
      );
      if (!r.matchedCount) throw Object.assign(new Error("changed"), { code: "CHANGED" });
      taken.push(b);
    } catch (error) {
      // Seat gone: undo what we re-took (state change back to EXPIRED, never a delete) and report
      for (const t of taken) {
        await CoachBooking.updateOne(
          { _id: t._id, status: "CONFIRMED", order: orderId },
          { $set: { status: "EXPIRED", paymentMethod: "", paymentStatus: "EXPIRED", expiredAt: now, purgeAt: new Date(now.getTime() + cfg.retentionMs()) }, $unset: { activeSeatKey: 1 } }
        );
      }
      if (isDuplicateKey(error) || error.code === "CHANGED") return { ok: false, reason: "seat_taken" };
      throw error;
    }
  }

  const claimed = await CoachOrder.findOneAndUpdate(
    { _id: orderId, status: "EXPIRED" },
    { $set: { status: "CONFIRMED", paymentMethod: "ONLINE", paymentStatus: "PAID", confirmedAt: now, lateConfirmed: true, payment: paymentId }, $unset: { expiredAt: 1, purgeAt: 1 } },
    { returnDocument: "after" }
  );
  if (!claimed) {
    for (const t of taken) {
      await CoachBooking.updateOne({ _id: t._id, status: "CONFIRMED", order: orderId }, { $set: { status: "EXPIRED", paymentStatus: "EXPIRED" }, $unset: { activeSeatKey: 1 } });
    }
    return { ok: false, reason: "lost_race" };
  }

  await afterConfirmed(claimed, now);
  return { ok: true, order: claimed };
}

// =========================================================================================
// EXTEND: give the customer more time while filling in details (limited, and capped overall)
// =========================================================================================
export async function extendHold(orderId, customerId, now = new Date()) {
  const order = await CoachOrder.findOne({ _id: orderId, customer: customerId });
  if (!order) throw new HoldError(404, "Order not found");
  if (order.status !== "HOLD") throw new HoldError(409, "Only seats that are being held can be extended");
  if (order.holdExpiresAt <= now) throw new HoldError(409, "This hold has already expired");
  if (order.holdExtensions >= cfg.maxExtensions()) throw new HoldError(409, "You have already used the extra time for this hold", { code: "EXTENSION_LIMIT" });

  const cap = order.createdAt.getTime() + cfg.maxHoldTotalMs();
  const next = new Date(Math.min(order.holdExpiresAt.getTime() + cfg.holdMs(), cap));
  if (next <= order.holdExpiresAt) throw new HoldError(409, "This hold cannot be extended any further", { code: "EXTENSION_LIMIT" });

  const updated = await CoachOrder.findOneAndUpdate(
    { _id: orderId, status: "HOLD", holdExtensions: { $lt: cfg.maxExtensions() }, holdExpiresAt: { $gt: now } },
    { $set: { holdExpiresAt: next }, $inc: { holdExtensions: 1 } },
    { returnDocument: "after" }
  );
  if (!updated) throw new HoldError(409, "This hold can no longer be extended");
  await CoachBooking.updateMany({ order: orderId, status: "HOLD" }, { $set: { holdExpiresAt: next } });
  return updated;
}

// =========================================================================================
// HOLD: reserve 1..N seats for one customer, all-or-nothing.
//  * seats are taken in SORTED order, so two overlapping requests can never deadlock each other
//  * the unique index on activeSeatKey is the final arbiter of every single seat
//  * on any conflict everything this request took is released by a STATE CHANGE (never deleteMany)
//  * a crash half-way leaves seats that expire on their own (short "creating" expiry) and an order that never
//    becomes HOLD, so it can never be confirmed or paid
// =========================================================================================
async function settled(order) {
  // A duplicate request may arrive while the first is still creating: wait briefly for its outcome
  for (let i = 0; i < 40 && order.status === "CREATING"; i++) {
    await sleep(100);
    order = await CoachOrder.findById(order._id);
  }
  return order;
}

async function replayOf(existing, schedule, seats) {
  if (String(existing.schedule) !== String(schedule._id) || existing.seats.join() !== seats.join()) {
    throw new HoldError(422, "This request id was already used for a different booking. Please start again.", { code: "IDEMPOTENCY_MISMATCH" });
  }
  return { order: await settled(existing), replay: true };
}

// Try to take ONE seat. Returns the booking doc, or null when the seat is genuinely taken.
async function acquireSeat({ order, schedule, item, customerId, creatingUntil, now, points = {} }) {
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      return await CoachBooking.create({
        bookingCode: newBookingCode(),
        qrToken: newQrToken(),
        customer: customerId,
        operator: schedule.operator._id || schedule.operator,
        schedule: schedule._id,
        order: order._id,
        boardingPoint: points.boardingPoint,
        droppingPoint: points.droppingPoint,
        seat: item.seat,
        passenger: item.passenger,
        fare: schedule.fare, // always the server-side fare
        status: "HOLD",
        holdExpiresAt: creatingUntil,
        paymentStatus: "UNPAID",
        activeSeatKey: `${schedule._id}:${item.seat}`,
        fromCity: schedule.fromCity, toCity: schedule.toCity,
        departureAt: schedule.departureAt, arrivalAt: schedule.arrivalAt,
        isDemo: false
      });
    } catch (error) {
      if (!isDuplicateKey(error)) throw error;

      const holder = await CoachBooking.findOne({ activeSeatKey: `${schedule._id}:${item.seat}` }).select("status holdExpiresAt order");
      if (!holder) continue; // the seat was just released, or only the random booking code collided: try again

      // Reap-on-conflict: an expired hold must not block anyone just because the sweeper has not run yet
      const stale = HOLDING.includes(holder.status) && holder.holdExpiresAt && holder.holdExpiresAt < ago(now, cfg.graceMs());
      if (stale) {
        if (holder.order) await expireOrder(holder.order, { now });
        else await CoachBooking.updateOne({ _id: holder._id, status: { $in: HOLDING } }, { $set: { status: "EXPIRED", expiredAt: now }, $unset: { activeSeatKey: 1, holdExpiresAt: 1 } });
        continue;
      }
      return null; // really taken
    }
  }
  return null;
}

export async function holdSeats({ customerId, schedule, items, idemKey, points = {}, now = new Date() }) {
  const byLabel = new Map(items.map((i) => [i.seat, i]));
  const seats = [...byLabel.keys()].sort();
  const key = idemKeyOf(customerId, idemKey);

  // ---- idempotency: same key, or an identical open order, returns the SAME order ----
  if (key) {
    const existing = await CoachOrder.findOne({ idemKey: key });
    if (existing) return replayOf(existing, schedule, seats);
  }
  // The customer's own identical open order (double click, retry, second tab). Checked again before ANY rejection below,
  // because concurrent duplicates would otherwise count against each other and be refused.
  const findTwin = (excludeId) => CoachOrder.findOne({
    customer: customerId, schedule: schedule._id, status: { $in: OPEN_ORDER }, seats, holdExpiresAt: { $gt: ago(new Date(), cfg.graceMs()) },
    ...(excludeId ? { _id: { $ne: excludeId } } : {})
  }).sort({ _id: 1 });
  const identical = await findTwin();
  if (identical) return { order: await settled(identical), replay: true };

  // ---- anti-hoarding: seats per trip (pre-check; re-verified after the seats are secured) ----
  const mine = await CoachBooking.countDocuments({ schedule: schedule._id, customer: customerId, ...occupiedFilter(now) });
  if (mine + seats.length > cfg.maxSeatsPerTrip()) {
    const twin = await findTwin();
    if (twin) return { order: await settled(twin), replay: true };
    throw new HoldError(409, `You can hold at most ${cfg.maxSeatsPerTrip()} seats on one trip`, { code: "SEAT_LIMIT" });
  }

  // ---- create the order in CREATING with a short deadline (it heals itself if this process dies) ----
  // The order must also win one of the customer's open-order SLOTS: a unique key the database hands out, so the
  // "at most N open holds" rule cannot be beaten by concurrent requests.
  const creatingUntil = new Date(now.getTime() + cfg.creatingTimeoutMs());
  let order = null;
  let reaped = false;
  for (let slot = 1; !order; slot++) {
    if (slot > cfg.maxOpenOrders()) {
      // Every slot looks busy. Some may belong to holds that already ran out: clear them once, then try again.
      if (!reaped) {
        reaped = true;
        const stale = await CoachOrder.find({ customer: customerId, status: { $in: OPEN_ORDER }, holdExpiresAt: { $lt: ago(new Date(), cfg.graceMs()) } }).select("_id");
        for (const o of stale) await expireOrder(o._id);
        if (stale.length) { slot = 0; continue; }
      }
      const twin = await findTwin();
      if (twin) return { order: await settled(twin), replay: true };
      throw new HoldError(409, "You already have seats on hold. Please finish or release them first.", { code: "TOO_MANY_HOLDS" });
    }

    for (let attempt = 0; attempt < 4 && !order; attempt++) {
      try {
        order = await CoachOrder.create({
          orderCode: newOrderCode(), customer: customerId, operator: schedule.operator._id || schedule.operator, schedule: schedule._id,
          idemKey: key, slotKey: `${customerId}:${slot}`, boardingPoint: points.boardingPoint, droppingPoint: points.droppingPoint, seats, seatCount: seats.length, amount: schedule.fare * seats.length, status: "CREATING", holdExpiresAt: creatingUntil
        });
      } catch (error) {
        if (!isDuplicateKey(error)) throw error;
        if (key) {
          const existing = await CoachOrder.findOne({ idemKey: key });
          if (existing) return replayOf(existing, schedule, seats); // a concurrent duplicate won: share its result
        }
        if (await CoachOrder.exists({ slotKey: `${customerId}:${slot}` })) break; // slot busy: try the next one
        // otherwise only the random order code collided: retry this slot with a new code
      }
    }
  }

  // ---- acquire every seat, lowest first ----
  const got = [];
  let failed = false;
  try {
    for (const label of seats) {
      const doc = await acquireSeat({ order, schedule, item: byLabel.get(label), customerId, creatingUntil, now, points });
      if (!doc) { failed = true; break; }
      got.push(doc);
    }
  } catch (error) {
    await abandon(order, "error while holding seats");
    throw error;
  }

  if (failed) {
    await abandon(order, "seat conflict");
    // The "conflict" may be this same customer's own identical request that just won (double-click, retry): share it
    const twin = await findTwin(order._id);
    if (twin) return { order: await settled(twin), replay: true };
    const busy = await CoachBooking.find({ schedule: schedule._id, seat: { $in: seats }, ...occupiedFilter(new Date()) }).select("seat");
    const conflictSeats = busy.map((b) => b.seat);
    throw new HoldError(409, `Seat ${(conflictSeats.length ? conflictSeats : seats).join(", ")} was just booked by someone else. Please choose another seat.`, { code: "SEAT_TAKEN", conflictSeats });
  }

  // ---- all seats secured: promote the order to HOLD with the real expiry ----
  const t = new Date();
  const fullUntil = new Date(t.getTime() + cfg.holdMs());
  const fresh = await CoachSchedule.findById(schedule._id).select("status layout");
  const live = fresh?.status === "scheduled";
  const nowBlocked = live ? seats.filter((l) => (fresh.layout.blocked || []).includes(l)) : [];
  if (nowBlocked.length) {
    // The operator blocked a seat while we were securing it: they win, and we back off cleanly
    await abandon(order, "seat blocked");
    throw new HoldError(409, `Seat ${nowBlocked.join(", ")} is not available`, { code: "SEAT_TAKEN", conflictSeats: nowBlocked });
  }
  const claimed = live && (await CoachOrder.findOneAndUpdate(
    { _id: order._id, status: "CREATING", holdExpiresAt: { $gt: t } },
    { $set: { status: "HOLD", holdExpiresAt: fullUntil } },
    { returnDocument: "after" }
  ));
  if (!claimed) {
    await abandon(order, live ? "creation took too long" : "trip cancelled");
    throw new HoldError(live ? 503 : 409, live ? "Please try again" : "This trip is no longer available", { code: live ? "RETRY" : "TRIP_UNAVAILABLE" });
  }
  const upd = await CoachBooking.updateMany({ order: order._id, status: "HOLD" }, { $set: { holdExpiresAt: fullUntil } });
  if (upd.matchedCount !== seats.length) {
    await abandon(claimed, "seat records changed");
    throw new HoldError(503, "Please try again", { code: "RETRY" });
  }

  // ---- race-safe seat limit: the LAST concurrent request always sees the others' seats and gives itself up ----
  const total = await CoachBooking.countDocuments({ schedule: schedule._id, customer: customerId, ...occupiedFilter(new Date()) });
  if (total > cfg.maxSeatsPerTrip()) {
    await releaseOrder(order._id, { by: "system", reason: "limit exceeded" });
    throw new HoldError(409, `You can hold at most ${cfg.maxSeatsPerTrip()} seats on one trip`, { code: "SEAT_LIMIT" });
  }

  await pushSeatUpdate(schedule._id, seats, "HELD");
  return { order: claimed, replay: false };
}

// Roll back a failed creation by state change: seats -> CANCELLED (key freed), order -> CANCELLED. Nothing is deleted.
async function abandon(order, reason) {
  const now = new Date();
  const purgeAt = new Date(now.getTime() + cfg.failedAttemptRetentionMs());
  await CoachBooking.updateMany(
    { order: order._id, status: { $in: HOLDING } },
    { $set: { status: "CANCELLED", cancelledAt: now, cancelledBy: "system", cancelReason: reason, paymentStatus: "CANCELLED", purgeAt }, $unset: { activeSeatKey: 1, holdExpiresAt: 1 } }
  );
  await CoachOrder.updateOne(
    { _id: order._id, status: { $in: OPEN_ORDER } },
    { $set: { status: "CANCELLED", cancelledAt: now, cancelledBy: "system", cancelReason: reason, paymentStatus: "CANCELLED", purgeAt }, $unset: { idemKey: 1, slotKey: 1 } }
  );
}

// Releases every open hold on a schedule (used when a trip is cancelled)
export async function releaseScheduleHolds(scheduleId, { by = "system", reason = "Trip cancelled" } = {}) {
  const orders = await CoachOrder.find({ schedule: scheduleId, status: { $in: OPEN_ORDER } }).select("_id");
  for (const o of orders) await releaseOrder(o._id, { by, reason });
  return orders.length;
}
