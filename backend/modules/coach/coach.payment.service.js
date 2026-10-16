import crypto from "crypto";
import { CoachBooking } from "./coach.model.js";
import { CoachOrder, CoachPayment } from "./coach.order.model.js";
import { cfg } from "./coach.config.js";
import { HOLDING, isManualProvider } from "./coach.states.js";
import { HoldError, confirmOrder, expireOrder, recoverExpiredOrder } from "./coach.holds.js";
import { requestRefund, notifyAdmins } from "./coach.refunds.js";
import { pushOrderUpdate } from "./coach.service.js";
import { getProvider, isProviderUsable } from "../../shared/payments/provider.js";
import { createNotification } from "../notifications/notification.service.js";
import { audit } from "../audit/audit.service.js";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
export const newProviderRef = () => `BD${crypto.randomBytes(8).toString("hex").toUpperCase()}`; // 18 chars, provider-safe

const pushEvent = (id, status, source, note = "", eventId = "") =>
  CoachPayment.updateOne({ _id: id }, { $push: { events: { $each: [{ id: eventId || `${source}:${Date.now()}`, status, source, note: String(note).slice(0, 160) }], $slice: -50 } } });

// =========================================================================================
// CASH: the booking is confirmed now, money is collected by the operator. Clearly marked CASH / CASH_DUE.
// Repeating the call (double click, retry) returns the already-confirmed order.
// =========================================================================================
export async function confirmWithCash(order, customerId) {
  if (!cfg.cashEnabled()) throw new HoldError(400, "Cash booking is not available. Please pay online.", { code: "CASH_DISABLED" });

  const current = await CoachOrder.findById(order._id);
  if (current.status === "CONFIRMED" && current.paymentMethod === "CASH") return { order: current, replay: true };

  const unpaid = await CoachOrder.countDocuments({ customer: customerId, status: "CONFIRMED", paymentMethod: "CASH", paymentStatus: "CASH_DUE" });
  if (unpaid >= cfg.cashMaxUnpaid()) {
    throw new HoldError(409, `You have ${unpaid} cash bookings that are not paid yet. Please pay online or settle them first.`, { code: "CASH_LIMIT" });
  }

  const confirmed = await confirmOrder(order._id, { method: "CASH", paymentStatus: "CASH_DUE" });
  if (confirmed) return { order: confirmed, replay: false };

  // Lost the race or too late: describe what actually happened
  const now = await CoachOrder.findById(order._id);
  if (now.status === "CONFIRMED" && now.paymentMethod === "CASH") return { order: now, replay: true };
  throw stateError(now);
}

export function stateError(order) {
  // Still marked open, but its time is up (inside the grace window or not yet swept): say so plainly
  if (["HOLD", "PENDING_PAYMENT", "CREATING"].includes(order.status) && order.holdExpiresAt <= new Date()) {
    return new HoldError(409, "Your seat hold has expired. Please choose your seats again.", { code: "HOLD_EXPIRED" });
  }
  switch (order.status) {
    case "EXPIRED": return new HoldError(409, "Your seat hold has expired. Please choose your seats again.", { code: "HOLD_EXPIRED" });
    case "CANCELLED": return new HoldError(409, "This booking was cancelled.", { code: "ORDER_CANCELLED" });
    case "CONFIRMED": return new HoldError(409, "This booking is already confirmed.", { code: "ALREADY_CONFIRMED" });
    case "COMPLETED": return new HoldError(409, "This trip is already completed.", { code: "ORDER_COMPLETED" });
    case "PENDING_PAYMENT": return new HoldError(409, "A payment is already in progress for this booking.", { code: "PAYMENT_IN_PROGRESS" });
    default: return new HoldError(409, "This booking cannot be changed right now.", { code: "BAD_STATE" });
  }
}

// =========================================================================================
// ONLINE: HOLD -> PENDING_PAYMENT, create ONE payment, return what the browser needs to continue.
// The payment window replaces the hold expiry (capped), so a slow gateway never loses the seat early
// and an abandoned payment never keeps it forever.
// =========================================================================================
export async function startOnlinePayment(order, { providerId, retry = false, callbackUrl }) {
  if (!isProviderUsable(providerId)) throw new HoldError(503, "This payment method is not available right now.", { code: "PROVIDER_NOT_AVAILABLE" });
  const provider = getProvider(providerId);
  const now = new Date();

  let cur = await CoachOrder.findById(order._id);

  // Already paying: return the SAME payment (refresh during payment, double click, second tab)
  if (cur.status === "PENDING_PAYMENT") {
    let pay = cur.payment && (await CoachPayment.findById(cur.payment));
    for (let i = 0; !pay && i < 20; i++) { await sleep(100); cur = await CoachOrder.findById(order._id); pay = cur.payment && (await CoachPayment.findById(cur.payment)); }
    if (pay && ["PENDING", "PROCESSING"].includes(pay.status) && !retry) return { order: cur, payment: pay, replay: true };
    if (!pay && cur.status === "PENDING_PAYMENT") throw new HoldError(503, "Please try again in a moment", { code: "RETRY" });
    if (pay && retry && ["PENDING", "PROCESSING"].includes(pay.status)) {
      // The old attempt is abandoned but may still succeed at the provider: that is reconciled as a duplicate payment
      await CoachPayment.updateOne({ _id: pay._id, status: { $in: ["PENDING", "PROCESSING"] } }, { $set: { status: "CANCELLED" } });
      await pushEvent(pay._id, "CANCELLED", "customer", "customer started a new payment");
    }
  } else if (cur.status === "HOLD") {
    // claim HOLD -> PENDING_PAYMENT
    const remaining = cur.createdAt.getTime() + cfg.maxHoldTotalMs() - now.getTime();
    if (remaining < 2 * 60000) throw new HoldError(409, "This hold is about to expire. Please choose your seats again.", { code: "HOLD_EXPIRING" });
    const until = new Date(Math.min(Math.max(cur.holdExpiresAt.getTime(), now.getTime() + cfg.paymentWindowMs()), cur.createdAt.getTime() + cfg.maxHoldTotalMs()));

    const claimed = await CoachOrder.findOneAndUpdate(
      { _id: cur._id, status: "HOLD", holdExpiresAt: { $gt: now } },
      { $set: { status: "PENDING_PAYMENT", paymentMethod: "ONLINE", paymentStatus: "PENDING", holdExpiresAt: until } },
      { returnDocument: "after" }
    );
    if (!claimed) {
      const again = await CoachOrder.findById(cur._id);
      if (again.status === "PENDING_PAYMENT") return startOnlinePayment(again, { providerId, retry, callbackUrl }); // a concurrent request won: share its payment
      throw stateError(again);
    }
    cur = claimed;
    await CoachBooking.updateMany({ order: cur._id, status: "HOLD" }, { $set: { status: "PENDING_PAYMENT", holdExpiresAt: until, paymentMethod: "ONLINE", paymentStatus: "PENDING" } });
  } else {
    throw stateError(cur);
  }

  // ---- create the payment attempt + provider checkout ----
  const payment = await CoachPayment.create({
    order: cur._id, customer: cur.customer, operator: cur.operator, provider: provider.id, mode: provider.mode,
    providerRef: newProviderRef(), amount: cur.amount, expiresAt: cur.holdExpiresAt, status: "PENDING",
    gateway: provider.id === "mock" ? { state: "PENDING" } : undefined,
    events: [{ id: "created", status: "PENDING", source: "system", note: "payment started" }]
  });

  try {
    const checkout = await provider.createCheckout({ payment, order: cur, callbackUrl });
    payment.checkout = checkout;
    await payment.save();
  } catch (error) {
    // Provider unreachable / misconfigured: give the hold back to the customer so they can retry or pay cash
    await CoachPayment.updateOne({ _id: payment._id }, { $set: { status: "FAILED" } });
    await revertToHold(cur._id, payment._id);
    throw new HoldError(502, "The payment provider is not responding. Your seats are still held, please try again.", { code: "PROVIDER_ERROR" });
  }

  const linked = await CoachOrder.findOneAndUpdate({ _id: cur._id }, { $set: { payment: payment._id } }, { returnDocument: "after" });
  pushOrderUpdate(linked);
  await audit({ actor: cur.customer, actorRole: "customer" }, "payment.started", { entityType: "Payment", entityId: payment._id, meta: { provider: provider.id, amount: payment.amount, order: String(cur._id) } });
  return { order: linked, payment, replay: false };
}

// Payment failed or could not start: PENDING_PAYMENT -> HOLD again (if the hold is still alive) so the customer can retry
export async function revertToHold(orderId, paymentId) {
  const now = new Date();
  const back = await CoachOrder.findOneAndUpdate(
    { _id: orderId, status: "PENDING_PAYMENT", holdExpiresAt: { $gt: now } },
    { $set: { status: "HOLD", paymentStatus: "UNPAID", paymentMethod: "" } },
    { returnDocument: "after" }
  );
  if (back) {
    await CoachBooking.updateMany({ order: orderId, status: "PENDING_PAYMENT" }, { $set: { status: "HOLD", paymentStatus: "UNPAID", paymentMethod: "" } });
    pushOrderUpdate(back);
  }
  return back;
}

// =========================================================================================
// THE SINGLE ENTRY for everything a provider tells us: signed callbacks, status queries, sandbox completion.
// Safe to call any number of times, concurrently, in any order, for the same payment.
// =========================================================================================
export async function applyPaymentEvent(providerId, event, { source = "callback" } = {}) {
  const payment = await CoachPayment.findOne({ provider: providerId, providerRef: event.providerRef });
  if (!payment) return { ok: false, reason: "unknown_payment" };

  await pushEvent(payment._id, event.status, source, "", event.eventId);

  if (event.status === "PENDING") {
    await CoachPayment.updateOne({ _id: payment._id, status: "PENDING" }, { $set: { status: "PROCESSING" } });
    return { ok: true, payment };
  }

  if (event.status === "FAILED") {
    const claimed = await CoachPayment.findOneAndUpdate({ _id: payment._id, status: { $in: ["PENDING", "PROCESSING"] } }, { $set: { status: "FAILED" } }, { returnDocument: "after" });
    if (!claimed) return { ok: true, duplicate: true, payment };
    const back = await revertToHold(payment.order, payment._id);
    if (back) {
      await createNotification(payment.customer, { type: "coach_payment_failed", title: "Payment failed", message: "Your payment did not go through. Your seats are still held for a short time: try again or pay cash.", serviceType: "coach_booking", serviceId: payment.order });
    }
    return { ok: true, payment: claimed };
  }

  // ---- PAID: verify the amount, then claim the payment exactly once ----
  if (Number.isFinite(event.amount) && Math.round(event.amount) !== payment.amount) {
    await CoachPayment.updateOne({ _id: payment._id }, { $set: { needsAttention: true } });
    await pushEvent(payment._id, "AMOUNT_MISMATCH", source, `expected ${payment.amount}, provider said ${event.amount}`);
    await notifyAdmins({ type: "coach_refund_required", title: "Payment amount mismatch", message: `Payment ${payment.providerRef}: expected ${payment.amount}, provider reported ${event.amount}. Not confirmed.`, serviceType: "coach_booking", serviceId: payment.order });
    await audit({ actorRole: "system" }, "payment.amount_mismatch", { entityType: "Payment", entityId: payment._id, meta: { expected: payment.amount, got: event.amount } });
    return { ok: false, reason: "amount_mismatch" };
  }

  const wasExpired = payment.status === "EXPIRED";
  const claimed = await CoachPayment.findOneAndUpdate(
    { _id: payment._id, status: { $in: ["PENDING", "PROCESSING", "FAILED", "EXPIRED", "CANCELLED"] } },
    { $set: { status: "PAID", paidAt: new Date(), providerTxnId: event.providerTxnId || payment.providerTxnId, lateSuccess: wasExpired } },
    { returnDocument: "after" }
  );
  if (!claimed) return { ok: true, duplicate: true, payment }; // already PAID/REFUNDED: a repeated callback changes nothing

  const result = await settlePaid(claimed);
  return { ok: true, payment: claimed, ...result };
}

async function settlePaid(payment, depth = 0) {
  const order = await CoachOrder.findById(payment.order);
  const refund = (kind, reason, ord = order) => requestRefund({ payment, order: ord, amount: payment.amount, kind, reason });

  if (!order) {
    await CoachPayment.updateOne({ _id: payment._id }, { $set: { needsAttention: true } });
    await notifyAdmins({ type: "coach_refund_required", title: "Payment without order", message: `Payment ${payment.providerRef} was received for an order that no longer exists.` });
    return { outcome: "orphan" };
  }

  // Normal path: the hold is alive. Whichever payment succeeds first confirms the order.
  if (["HOLD", "PENDING_PAYMENT"].includes(order.status)) {
    const confirmed = await confirmOrder(order._id, { method: "ONLINE", paymentStatus: "PAID", paid: true, paymentId: payment._id });
    if (confirmed) {
      // any other open attempt for this order is now pointless
      await CoachPayment.updateMany({ order: order._id, _id: { $ne: payment._id }, status: { $in: ["PENDING", "PROCESSING"] } }, { $set: { status: "CANCELLED" } });
      await createNotification(payment.customer, { type: "coach_payment_success", title: "Payment received", message: `We received ${payment.amount} PKR. Your coach booking ${order.orderCode} is confirmed.`, serviceType: "coach_booking", serviceId: order._id });
      await audit({ actorRole: "system" }, "payment.paid", { entityType: "Payment", entityId: payment._id, meta: { amount: payment.amount, provider: payment.provider, order: String(order._id) } });
      return { outcome: "confirmed" };
    }
    // The hold ran out (beyond grace) before anyone swept it: close it now, then decide again on the fresh state
    if (depth >= 3) {
      await CoachPayment.updateOne({ _id: payment._id }, { $set: { needsAttention: true } });
      await refund("ORDER_CLOSED", "Could not settle this payment automatically.");
      return { outcome: "closed_refund" };
    }
    await expireOrder(order._id, { force: true, reason: "payment arrived after hold ran out" });
    return settlePaid(payment, depth + 1);
  }

  if (order.status === "EXPIRED") {
    const rec = await recoverExpiredOrder(order._id, { paymentId: payment._id });
    if (rec.ok) {
      await createNotification(payment.customer, { type: "coach_late_payment", title: "Booking confirmed", message: `Your payment arrived after the hold expired, but your seats were still free, so booking ${order.orderCode} is confirmed.`, serviceType: "coach_booking", serviceId: order._id });
      await audit({ actorRole: "system" }, "payment.late_recovered", { entityType: "Payment", entityId: payment._id, meta: { order: String(order._id) } });
      return { outcome: "late_recovered" };
    }
    await CoachPayment.updateOne({ _id: payment._id }, { $set: { needsAttention: true } });
    await refund("LATE_PAYMENT_CONFLICT", `Payment arrived after the hold expired and the seats are no longer available (${rec.reason}).`);
    await createNotification(payment.customer, { type: "coach_late_payment", title: "Payment received, seats unavailable", message: `Your payment for ${order.orderCode} arrived after the hold expired and the seats were taken. A full refund of ${payment.amount} PKR is being processed.`, serviceType: "coach_booking", serviceId: order._id });
    await audit({ actorRole: "system" }, "payment.late_conflict", { entityType: "Payment", entityId: payment._id, meta: { reason: rec.reason, order: String(order._id) } });
    return { outcome: "late_refund" };
  }

  if (order.status === "CONFIRMED" || order.status === "COMPLETED") {
    if (String(order.payment) === String(payment._id)) return { outcome: "already_settled" }; // this very payment confirmed it
    await refund("DUPLICATE_PAYMENT", "A second payment was received for an already confirmed booking.");
    await audit({ actorRole: "system" }, "payment.duplicate", { entityType: "Payment", entityId: payment._id, meta: { order: String(order._id) } });
    return { outcome: "duplicate_refund" };
  }

  // CANCELLED (the customer released the hold, or the trip was cancelled) or CREATING
  await refund("ORDER_CLOSED", `Payment received for a booking that was already ${order.status.toLowerCase()}.`);
  await createNotification(payment.customer, { type: "coach_refund_required", title: "Payment refund", message: `Your payment for ${order.orderCode} arrived after the booking was ${order.status.toLowerCase()}. It will be refunded.`, serviceType: "coach_booking", serviceId: order._id });
  return { outcome: "closed_refund" };
}

// Ask the provider where a payment stands (recovers a lost callback; used by the customer's "check payment" and the sweeper)
export async function syncPayment(payment, { source = "query" } = {}) {
  if (isManualProvider(payment.provider)) return { ok: false, reason: "manual" }; // decided by the operator, nothing to ask a provider
  const provider = getProvider(payment.provider);
  if (!provider?.capabilities.query || !provider.isConfigured()) return { ok: false, reason: "unsupported" };
  await CoachPayment.updateOne({ _id: payment._id }, { $set: { lastSyncAt: new Date() } });
  const event = await provider.queryStatus(payment);
  if (!event) return { ok: false, reason: "no_answer" };
  return applyPaymentEvent(payment.provider, event, { source });
}
