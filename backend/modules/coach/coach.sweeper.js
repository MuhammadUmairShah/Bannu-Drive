import { CoachBooking } from "./coach.model.js";
import { CoachOrder, CoachPayment } from "./coach.order.model.js";
import { cfg } from "./coach.config.js";
import { HOLDING, OPEN_ORDER, MANUAL_PROVIDERS } from "./coach.states.js";
import { expireOrder } from "./coach.holds.js";
import { syncPayment } from "./coach.payment.service.js";
import { sweepCoachData, pushSeatUpdate } from "./coach.service.js";
import { createNotification } from "../notifications/notification.service.js";
import { CoachSchedule } from "./coach.model.js";

// ---------------------------------------------------------------------------
// Background housekeeping. Correctness never depends on it (expired holds are also reaped the moment someone
// needs the seat), it just keeps the system tidy and tells people promptly. Every step is idempotent and safe
// to run on several server instances at once.
// ---------------------------------------------------------------------------
export async function sweepHolds(now = new Date()) {
  const stats = { expired: 0, recoveredPayments: 0, reconciled: 0, polled: 0 };
  const cutoff = new Date(now.getTime() - cfg.graceMs());

  // 1. Orders whose hold ran out. An online payment may have succeeded without telling us: ask the provider first.
  const due = await CoachOrder.find({ status: { $in: OPEN_ORDER }, holdExpiresAt: { $lt: cutoff } }).limit(200);
  for (const order of due) {
    try {
      if (order.status === "PENDING_PAYMENT") {
        const pays = await CoachPayment.find({ order: order._id, status: { $in: ["PENDING", "PROCESSING"] } });
        for (const p of pays) {
          const r = await syncPayment(p, { source: "sweeper" }).catch(() => null);
          if (r?.outcome === "confirmed") stats.recoveredPayments += 1;
        }
        const fresh = await CoachOrder.findById(order._id);
        if (!fresh || !OPEN_ORDER.includes(fresh.status)) continue;
      }
      if (await expireOrder(order._id, { now })) stats.expired += 1;
    } catch (error) {
      console.error(`Sweeper: order ${order._id} failed:`, error.message);
    }
  }

  // 2. Lost-callback recovery: poll payments still waiting after a minute (only providers that can be queried)
  const waiting = await CoachPayment.find({
    status: { $in: ["PENDING", "PROCESSING"] }, provider: { $nin: MANUAL_PROVIDERS }, createdAt: { $lt: new Date(now.getTime() - 60000) },
    $or: [{ lastSyncAt: { $exists: false } }, { lastSyncAt: { $lt: new Date(now.getTime() - 45000) } }]
  }).limit(50);
  for (const p of waiting) {
    try { await syncPayment(p, { source: "sweeper" }); stats.polled += 1; } catch (error) { console.error("Sweeper poll failed:", error.message); }
  }

  // 3. Reconcile seat records that disagree with their order (crash between two writes)
  const stuck = await CoachBooking.find({ status: { $in: HOLDING }, updatedAt: { $lt: new Date(now.getTime() - 30000) }, order: { $exists: true } }).distinct("order");
  for (const id of stuck) {
    const order = await CoachOrder.findById(id).select("status schedule seats");
    if (!order) continue;
    if (order.status === "CONFIRMED") {
      await CoachBooking.updateMany({ order: id, status: { $in: HOLDING } }, { $set: { status: "CONFIRMED" }, $unset: { holdExpiresAt: 1 } });
      stats.reconciled += 1;
    } else if (["EXPIRED", "CANCELLED"].includes(order.status)) {
      const seats = await CoachBooking.find({ order: id, status: { $in: HOLDING } }).select("seat");
      await CoachBooking.updateMany({ order: id, status: { $in: HOLDING } }, { $set: { status: order.status }, $unset: { activeSeatKey: 1, holdExpiresAt: 1 } });
      await pushSeatUpdate(order.schedule, seats.map((s) => s.seat), "AVAILABLE");
      stats.reconciled += 1;
    }
  }

  // 3b. A slot key must never outlive an open order (heals a crash between two writes)
  await CoachOrder.updateMany({ status: { $nin: OPEN_ORDER }, slotKey: { $exists: true } }, { $unset: { slotKey: 1 } });

  // 4. Seat holds with no order at all (legacy) that ran out
  await CoachBooking.updateMany(
    { status: { $in: HOLDING }, holdExpiresAt: { $lt: cutoff }, order: { $exists: false } },
    { $set: { status: "EXPIRED", expiredAt: now }, $unset: { activeSeatKey: 1, holdExpiresAt: 1 } }
  );

  // 5. "Your hold is about to expire": once per order, 2 minutes before the end
  const soon = await CoachOrder.find({ status: { $in: ["HOLD", "PENDING_PAYMENT"] }, expiryWarned: { $ne: true }, holdExpiresAt: { $gt: now, $lt: new Date(now.getTime() + 120000) } }).limit(100);
  for (const o of soon) {
    const claimed = await CoachOrder.findOneAndUpdate({ _id: o._id, expiryWarned: { $ne: true }, status: { $in: ["HOLD", "PENDING_PAYMENT"] } }, { $set: { expiryWarned: true } }, { returnDocument: "after" });
    if (claimed) { await createNotification(o.customer, { type: "coach_hold_expiring", title: "Your seats are about to be released", message: `Your hold for booking ${o.orderCode} ends in about 2 minutes. Complete the booking to keep your seats.`, serviceType: "coach_booking", serviceId: o._id }); stats.warned = (stats.warned || 0) + 1; }
  }

  // 6. Boarding reminder: once per ticket, about an hour before departure
  const departing = await CoachBooking.find({ status: "CONFIRMED", reminderSentAt: { $exists: false }, departureAt: { $gt: now, $lt: new Date(now.getTime() + 60 * 60000) } }).limit(200);
  for (const b of departing) {
    const claimed = await CoachBooking.findOneAndUpdate({ _id: b._id, status: "CONFIRMED", reminderSentAt: { $exists: false } }, { $set: { reminderSentAt: now } }, { returnDocument: "after" });
    if (!claimed) continue;
    const sch = await CoachSchedule.findById(b.schedule).select("status");
    if (sch?.status !== "scheduled") continue;
    const t = new Date(b.departureAt).toLocaleTimeString("en-PK", { hour: "2-digit", minute: "2-digit", timeZone: "Asia/Karachi" });
    await createNotification(b.customer, { type: "coach_boarding_reminder", title: "Your coach leaves soon", message: `${b.fromCity} → ${b.toCity} departs at ${t}${b.boardingPoint?.name ? ` from ${b.boardingPoint.name}` : ""}. Seat ${b.seat}. Show your ticket QR at boarding.`.slice(0, 400), serviceType: "coach_booking", serviceId: b._id });
    stats.reminded = (stats.reminded || 0) + 1;
  }

  await sweepCoachData(now);
  return stats;
}

let timer = null;
let running = false;

export function startCoachSweeper() {
  if (timer) return;
  timer = setInterval(async () => {
    if (running) return; // never overlap
    running = true;
    try { await sweepHolds(); } catch (error) { console.error("Coach sweeper error:", error.message); } finally { running = false; }
  }, cfg.sweepIntervalMs());
  timer.unref();
}

export function stopCoachSweeper() {
  if (timer) clearInterval(timer);
  timer = null;
}
