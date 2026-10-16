import { CoachBooking, CoachSchedule } from "./coach.model.js";
import { CoachOrder, CoachPayment } from "./coach.order.model.js";
import { cfg } from "./coach.config.js";
import { OPEN_ORDER } from "./coach.states.js";
import { holdSeats, releaseOrder, extendHold, HoldError, expireOrder } from "./coach.holds.js";
import { confirmWithCash, startOnlinePayment, applyPaymentEvent, syncPayment, stateError } from "./coach.payment.service.js";
import { parseSeatRequest, loadSellableSchedule, idempotencyKeyOf, pointsFromRequest, sendHoldError, ticketViews, populateBooking } from "./coach.customer.controller.js";
import { getProvider, listPaymentOptions, isProviderUsable } from "../../shared/payments/provider.js";
import { MockProvider } from "../../shared/payments/mock.provider.js";
import { startManualPayment, manualOptionsFor, walletOf, WALLETS } from "./coach.manual.js";
import { isManualProvider } from "./coach.states.js";
import { str } from "../../shared/utils/objectId.js";
import { audit } from "../audit/audit.service.js";

const fail = (res, status, message, extra = {}) => res.status(status).json({ success: false, message, ...extra });
const serverError = (res, label, error) => {
  console.error(`${label}:`, error);
  return fail(res, 500, "Something went wrong");
};

// ---- what the customer's checkout page needs, in one shape ----
export async function orderView(order) {
  const [schedule, bookings, payment] = await Promise.all([
    CoachSchedule.findById(order.schedule).populate("operator", "companyName").populate("coach", "name type"),
    populateBooking(CoachBooking.find({ order: order._id }).sort({ seat: 1 })),
    order.payment ? CoachPayment.findById(order.payment) : null
  ]);
  const open = OPEN_ORDER.includes(order.status);
  const live = payment && ["PENDING", "PROCESSING"].includes(payment.status);
  const manual = !!payment && isManualProvider(payment.provider);
  // Wallets this operator accepts, and (back in HOLD) why the last proof was rejected
  const manualOptions = open ? await manualOptionsFor(order.operator) : [];
  const rejected = order.status === "HOLD"
    ? await CoachPayment.findOne({ order: order._id, provider: { $in: ["easypaisa_manual", "jazzcash_manual"] }, status: "FAILED", rejectReason: { $ne: "" } }).sort({ updatedAt: -1 }).select("rejectReason reviewedAt")
    : null;

  return {
    _id: order._id,
    orderCode: order.orderCode,
    status: order.status,
    scheduleId: order.schedule,
    seats: order.seats,
    boardingPoint: order.boardingPoint ? { name: order.boardingPoint.name, time: order.boardingPoint.time } : undefined,
    droppingPoint: order.droppingPoint ? { name: order.droppingPoint.name, time: order.droppingPoint.time } : undefined,
    seatCount: order.seatCount,
    amount: order.amount,
    // The server clock travels with every order so the countdown never depends on the customer's device clock
    holdExpiresAt: open ? order.holdExpiresAt : undefined,
    serverTime: new Date(),
    canExtend: order.status === "HOLD" && order.holdExtensions < cfg.maxExtensions(),
    paymentMethod: order.paymentMethod,
    paymentStatus: order.paymentStatus,
    lateConfirmed: order.lateConfirmed,
    cancelReason: order.cancelReason || undefined,
    createdAt: order.createdAt,
    confirmedAt: order.confirmedAt,
    trip: schedule && {
      fromCity: schedule.fromCity, toCity: schedule.toCity, departureAt: schedule.departureAt, arrivalAt: schedule.arrivalAt,
      operator: schedule.operator?.companyName, coach: schedule.coach?.name, coachType: schedule.coach?.type
    },
    manualOptions,
    rejection: rejected ? { reason: rejected.rejectReason, at: rejected.reviewedAt } : undefined,
    payment: payment && {
      id: payment._id, provider: payment.provider, mode: payment.mode, status: payment.status, amount: payment.amount, reference: payment.providerRef,
      expiresAt: payment.expiresAt, checkout: live ? payment.checkout : undefined,
      manual, wallet: manual ? walletOf(payment.provider) : undefined,
      tid: manual ? payment.tid : undefined, senderNumber: manual ? payment.senderNumber : undefined,
      submittedAt: manual ? payment.submittedAt : undefined, hasReceipt: manual ? !!payment.receipt : undefined
    },
    bookings: await ticketViews(bookings)
  };
}

export async function ownOrder(req, res) {
  const order = await CoachOrder.findOne({ _id: req.params.orderId, customer: req.user.id });
  if (!order) { fail(res, 404, "Booking not found"); return null; }
  // A hold that ran out is closed the moment its owner looks at it (no waiting for the sweeper)
  if (OPEN_ORDER.includes(order.status) && order.holdExpiresAt < new Date(Date.now() - cfg.graceMs())) {
    await expireOrder(order._id);
    return CoachOrder.findById(order._id);
  }
  return order;
}

// GET /coach/payment-options
export async function paymentOptions(req, res) {
  return res.json({
    success: true,
    cash: { enabled: cfg.cashEnabled() },
    online: listPaymentOptions(),
    manual: { enabled: cfg.manualEnabled(), verifyMinutes: cfg.manualVerifyMs() / 60000 },
    holdMinutes: cfg.holdMs() / 60000,
    paymentWindowMinutes: cfg.paymentWindowMs() / 60000,
    serverTime: new Date()
  });
}

// POST /coach/orders   { scheduleId, seats:[{seat, passenger}] }   header: Idempotency-Key
export async function createOrder(req, res) {
  try {
    const parsed = parseSeatRequest(req.body);
    if (parsed.error) return fail(res, parsed.error[0], parsed.error[1]);

    const loaded = await loadSellableSchedule(parsed.scheduleId, parsed.items);
    if (loaded.error) return fail(res, loaded.error[0], loaded.error[1], loaded.error[2] || {});

    const points = pointsFromRequest(loaded.schedule, req.body);
    if (points.error) return fail(res, 400, points.error);
    const { order, replay } = await holdSeats({ customerId: req.user.id, schedule: loaded.schedule, items: parsed.items, idemKey: idempotencyKeyOf(req), points });
    return res.status(replay ? 200 : 201).json({
      success: true,
      replay,
      message: replay ? "You already have this hold" : "Seats held. Complete your booking before the timer ends.",
      order: await orderView(order)
    });
  } catch (error) {
    if (error instanceof HoldError) return sendHoldError(res, error);
    return serverError(res, "Create Order Error", error);
  }
}

// GET /coach/orders/active : the customer's unfinished checkouts (browser closed, page refreshed, came back later)
export async function activeOrders(req, res) {
  try {
    const orders = await CoachOrder.find({ customer: req.user.id, status: { $in: ["HOLD", "PENDING_PAYMENT"] }, holdExpiresAt: { $gt: new Date() } }).sort({ createdAt: -1 }).limit(5);
    return res.json({ success: true, orders: await Promise.all(orders.map(orderView)), serverTime: new Date() });
  } catch (error) {
    return serverError(res, "Active Orders Error", error);
  }
}

// GET /coach/orders/:orderId
export async function getOrder(req, res) {
  try {
    const order = await ownOrder(req, res);
    if (!order) return;
    return res.json({ success: true, order: await orderView(order) });
  } catch (error) {
    return serverError(res, "Get Order Error", error);
  }
}

// POST /coach/orders/:orderId/extend
export async function extendOrder(req, res) {
  try {
    const order = await ownOrder(req, res);
    if (!order) return;
    const updated = await extendHold(order._id, req.user.id);
    return res.json({ success: true, message: "We added more time to your hold", order: await orderView(updated) });
  } catch (error) {
    if (error instanceof HoldError) return sendHoldError(res, error);
    return serverError(res, "Extend Order Error", error);
  }
}

// POST /coach/orders/:orderId/release : give the seats back before paying
export async function releaseMyOrder(req, res) {
  try {
    const order = await ownOrder(req, res);
    if (!order) return;
    if (!OPEN_ORDER.includes(order.status)) {
      if (order.status === "CANCELLED" || order.status === "EXPIRED") return res.json({ success: true, message: "Seats already released", order: await orderView(order) }); // idempotent
      return fail(res, 409, "A confirmed booking must be cancelled from My Bookings");
    }
    // Money may already be on its way: once proof was sent only the operator (or the timer) decides
    if (order.payment) {
      const sent = await CoachPayment.exists({ _id: order.payment, status: "PROCESSING", submittedAt: { $exists: true } });
      if (sent) return fail(res, 409, "You already sent your payment proof. Please wait for the operator, or contact them to cancel.", { code: "PROOF_SENT" });
    }
    await releaseOrder(order._id, { by: "customer", reason: str(req.body?.reason, 120) || "Released by customer" });
    return res.json({ success: true, message: "Seats released", order: await orderView(await CoachOrder.findById(order._id)) });
  } catch (error) {
    return serverError(res, "Release Order Error", error);
  }
}

// POST /coach/orders/:orderId/pay   { method: "CASH" | "ONLINE", provider?, retry? }
export async function payOrder(req, res) {
  try {
    const order = await ownOrder(req, res);
    if (!order) return;

    const method = str(req.body?.method, 8).toUpperCase();
    if (!["CASH", "ONLINE", "MANUAL"].includes(method)) return fail(res, 400, "Choose how you want to pay");

    // The hold may have just run out
    if (!["HOLD", "PENDING_PAYMENT", "CONFIRMED"].includes(order.status)) throw stateError(order);

    if (method === "CASH") {
      const { order: done, replay } = await confirmWithCash(order, req.user.id);
      return res.json({ success: true, replay, message: "Booking confirmed. Pay cash to the operator.", order: await orderView(done) });
    }

    if (method === "MANUAL") {
      const wallet = str(req.body?.provider, 20).toLowerCase();
      if (!WALLETS[wallet]) return fail(res, 400, "Choose EasyPaisa or JazzCash");
      const result = await startManualPayment(order, { wallet });
      return res.status(result.replay ? 200 : 201).json({ success: true, replay: result.replay, message: "Send the payment, then upload your receipt.", order: await orderView(result.order) });
    }

    const providerId = str(req.body?.provider, 20).toLowerCase();
    const base = process.env.SERVER_URL || `${req.protocol}://${req.get("host")}`;
    const result = await startOnlinePayment(order, { providerId, retry: req.body?.retry === true, callbackUrl: `${base.replace(/\/+$/, "")}/coach/payments/callback/${providerId}` });
    return res.status(result.replay ? 200 : 201).json({ success: true, replay: result.replay, message: "Continue to payment", order: await orderView(result.order) });
  } catch (error) {
    if (error instanceof HoldError) return sendHoldError(res, error);
    return serverError(res, "Pay Order Error", error);
  }
}

// POST /coach/orders/:orderId/sync : "I paid but nothing happened". Asks the provider; safe to press repeatedly.
export async function syncOrder(req, res) {
  try {
    const order = await ownOrder(req, res);
    if (!order) return;
    const payments = await CoachPayment.find({ order: order._id, status: { $in: ["PENDING", "PROCESSING", "EXPIRED", "FAILED"] } }).sort({ createdAt: -1 }).limit(3);
    for (const p of payments) await syncPayment(p, { source: "customer" });
    return res.json({ success: true, order: await orderView(await CoachOrder.findById(order._id)) });
  } catch (error) {
    return serverError(res, "Sync Order Error", error);
  }
}

// =========================================================================================
// POST /coach/payments/callback/:provider   (called by the payment provider, NOT by our frontend)
// No login: the provider's SIGNATURE is the authentication. Replays are harmless (idempotent).
// =========================================================================================
export async function paymentCallback(req, res) {
  try {
    const provider = getProvider(req.params.provider);
    if (!provider || !isProviderUsable(provider.id)) return fail(res, 404, "Unknown provider");

    const parsed = provider.parseCallback({ headers: req.headers, rawBody: req.rawBody, body: req.body, query: req.query });
    if (!parsed.valid) {
      console.warn(`Payment callback rejected (${provider.id}): ${parsed.reason}`);
      return fail(res, 400, "Invalid callback");
    }

    const result = await applyPaymentEvent(provider.id, parsed.event, { source: "callback" });
    if (!result.ok && result.reason === "unknown_payment") return fail(res, 404, "Unknown payment");
    if (!result.ok) return fail(res, 422, "Callback could not be applied", { reason: result.reason });

    // Providers that return the customer's browser here get sent back to the checkout page
    if (req.is("application/x-www-form-urlencoded") && result.payment) {
      const base = String(process.env.CLIENT_URL || "").replace(/\/+$/, "");
      return res.redirect(303, `${base}/customer/checkout/${result.payment.order}`);
    }
    return res.json({ success: true, duplicate: !!result.duplicate });
  } catch (error) {
    return serverError(res, "Payment Callback Error", error); // 500 makes the provider retry, which is safe
  }
}

// ---------------------------------------------------------------------------------------
// SANDBOX GATEWAY (mock provider only). Lets the owner "pay" or "fail" a test payment.
// ---------------------------------------------------------------------------------------
async function ownMockPayment(req, res) {
  if (!isProviderUsable("mock")) { fail(res, 404, "Not found"); return null; }
  const payment = await CoachPayment.findOne({ provider: "mock", providerRef: str(req.params.ref, 40), customer: req.user.id });
  if (!payment) { fail(res, 404, "Payment not found"); return null; }
  return payment;
}

export async function mockPaymentInfo(req, res) {
  try {
    const payment = await ownMockPayment(req, res);
    if (!payment) return;
    const order = await CoachOrder.findById(payment.order).select("orderCode status");
    return res.json({ success: true, payment: { reference: payment.providerRef, amount: payment.amount, status: payment.status, expiresAt: payment.expiresAt, orderId: payment.order, orderCode: order?.orderCode }, serverTime: new Date() });
  } catch (error) {
    return serverError(res, "Mock Info Error", error);
  }
}

// POST /coach/payments/mock/:ref/complete { outcome: "PAID" | "FAILED", deliver?: false }
// deliver:false changes only the gateway's own record (as if the callback got lost); the system must then recover it by itself.
export async function mockPaymentComplete(req, res) {
  try {
    const payment = await ownMockPayment(req, res);
    if (!payment) return;

    const outcome = str(req.body?.outcome, 8).toUpperCase();
    if (!["PAID", "FAILED"].includes(outcome)) return fail(res, 400, "Invalid outcome");

    await CoachPayment.updateOne({ _id: payment._id }, { $set: { "gateway.state": outcome } });

    if (req.body?.deliver !== false) {
      // Go through the exact same signed-callback path a real gateway uses
      const rawBody = JSON.stringify({ eventId: `${payment.providerRef}:${outcome}:${Date.now()}`, providerRef: payment.providerRef, status: outcome, amount: payment.amount });
      const parsed = getProvider("mock").parseCallback({ headers: { "x-mock-signature": MockProvider.sign(rawBody) }, rawBody });
      if (!parsed.valid) return fail(res, 500, "Sandbox signing failed");
      await applyPaymentEvent("mock", parsed.event, { source: "callback" });
    }

    const order = await CoachOrder.findById(payment.order);
    await audit(req, "payment.sandbox_completed", { entityType: "Payment", entityId: payment._id, meta: { outcome } });
    return res.json({ success: true, order: await orderView(order) });
  } catch (error) {
    return serverError(res, "Mock Complete Error", error);
  }
}
