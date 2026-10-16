import { CoachBooking, CoachOperator, CoachSchedule } from "./coach.model.js";
import { CoachOrder, CoachPayment, CoachReceipt } from "./coach.order.model.js";
import { cfg } from "./coach.config.js";
import { MANUAL_PROVIDERS, isManualProvider } from "./coach.states.js";
import { HoldError } from "./coach.holds.js";
import { applyPaymentEvent, newProviderRef, stateError, revertToHold } from "./coach.payment.service.js";
import { pushOrderUpdate, notifyOperator } from "./coach.service.js";
import { createNotification } from "../notifications/notification.service.js";
import { audit } from "../audit/audit.service.js";
import { isDuplicateKey } from "../../shared/utils/dbErrors.js";

// ---------------------------------------------------------------------------------------------
// MANUAL WALLET PAYMENTS (EasyPaisa / JazzCash number + receipt), checked by the operator.
//
//   customer: HOLD --pay--> PENDING_PAYMENT (payment PENDING)   sees the operator's number + amount
//   customer: sends money, then proof (TID + receipt)          payment PROCESSING, hold stretched so the operator has time
//   operator: approve  -> the SAME applyPaymentEvent(PAID) path as a real gateway: order CONFIRMED, QR ticket, notifications
//   operator: reject   -> payment FAILED, order back to HOLD with the reason, customer can send new proof
// ---------------------------------------------------------------------------------------------

export const WALLETS = { easypaisa: "EasyPaisa", jazzcash: "JazzCash" };
export const providerOf = (wallet) => `${wallet}_manual`;
export const walletOf = (provider) => String(provider || "").replace(/_manual$/, "");
export const walletLabel = (provider) => WALLETS[walletOf(provider)] || "Wallet";

// "0300-1234567", "+92 300 1234567", "923001234567" -> "03001234567"; anything else -> null
export function normalizeWalletNumber(value) {
  let d = String(value ?? "").replace(/[\s\-()]/g, "");
  if (d.startsWith("+92")) d = `0${d.slice(3)}`;
  else if (d.startsWith("0092")) d = `0${d.slice(4)}`;
  else if (/^92\d{10}$/.test(d)) d = `0${d.slice(2)}`;
  return /^03\d{9}$/.test(d) ? d : null;
}

// Validates what an operator typed for their accounts. Returns { error } or { set } (a Mongo $set with dotted keys).
export function cleanPaymentAccounts(input) {
  if (input === undefined) return { set: {} };
  if (!input || typeof input !== "object" || Array.isArray(input)) return { error: "Invalid payment account details" };
  const set = {};
  for (const wallet of Object.keys(WALLETS)) {
    const a = input[wallet];
    if (a === undefined) continue;
    if (!a || typeof a !== "object") return { error: `Invalid ${WALLETS[wallet]} details` };
    const enabled = a.enabled === true;
    const rawNumber = String(a.number ?? "").trim();
    const title = String(a.title ?? "").trim().slice(0, 60);
    const number = rawNumber ? normalizeWalletNumber(rawNumber) : "";
    if (rawNumber && !number) return { error: `${WALLETS[wallet]} number must be a mobile number like 03001234567` };
    if (enabled && (!number || title.length < 2)) return { error: `Enter the ${WALLETS[wallet]} number and account title to turn it on` };
    set[`paymentAccounts.${wallet}`] = { number, title, enabled };
  }
  return { set };
}

// The wallets this operator accepts (what the checkout page may offer)
export async function manualOptionsFor(operatorId) {
  if (!cfg.manualEnabled()) return [];
  const op = await CoachOperator.findById(operatorId).select("paymentAccounts");
  return Object.keys(WALLETS)
    .filter((w) => op?.paymentAccounts?.[w]?.enabled && op.paymentAccounts[w].number)
    .map((w) => ({ id: w, label: WALLETS[w] }));
}

const checkoutFor = (wallet, account, order) => ({ kind: "manual", wallet, walletLabel: WALLETS[wallet], number: account.number, title: account.title, amount: order.amount, note: order.orderCode });

// =========================================================================================
// START: HOLD -> PENDING_PAYMENT with ONE manual payment. Repeating the call returns the same payment;
// choosing the other wallet BEFORE sending proof just switches it.
// =========================================================================================
export async function startManualPayment(order, { wallet }) {
  if (!cfg.manualEnabled()) throw new HoldError(400, "This payment method is not available right now.", { code: "MANUAL_DISABLED" });
  if (!WALLETS[wallet]) throw new HoldError(400, "Choose EasyPaisa or JazzCash.", { code: "BAD_WALLET" });

  const op = await CoachOperator.findById(order.operator).select("paymentAccounts");
  const account = op?.paymentAccounts?.[wallet];
  if (!account?.enabled || !account.number) throw new HoldError(400, `This operator is not accepting ${WALLETS[wallet]} payments right now.`, { code: "WALLET_NOT_AVAILABLE" });

  const provider = providerOf(wallet);
  const now = new Date();
  const cur = await CoachOrder.findById(order._id);

  if (cur.status === "PENDING_PAYMENT") {
    const pay = cur.payment && (await CoachPayment.findById(cur.payment));
    if (!pay || !isManualProvider(pay.provider)) throw stateError(cur); // another kind of payment is already running
    if (pay.status === "PROCESSING") return { order: cur, payment: pay, replay: true }; // proof already sent
    if (pay.status !== "PENDING") throw stateError(cur);
    if (pay.provider === provider) return { order: cur, payment: pay, replay: true };
    const switched = await CoachPayment.findOneAndUpdate({ _id: pay._id, status: "PENDING" }, { $set: { provider, checkout: checkoutFor(wallet, account, cur) } }, { returnDocument: "after" });
    if (!switched) throw stateError(await CoachOrder.findById(cur._id));
    return { order: cur, payment: switched, replay: false };
  }
  if (cur.status !== "HOLD") throw stateError(cur);

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
    if (again.status === "PENDING_PAYMENT") return startManualPayment(again, { wallet }); // a concurrent request won: share its payment
    throw stateError(again);
  }
  await CoachBooking.updateMany({ order: claimed._id, status: "HOLD" }, { $set: { status: "PENDING_PAYMENT", holdExpiresAt: until, paymentMethod: "ONLINE", paymentStatus: "PENDING" } });

  let payment;
  try {
    payment = await CoachPayment.create({
      order: claimed._id, customer: claimed.customer, operator: claimed.operator, provider, mode: "production",
      providerRef: newProviderRef(), amount: claimed.amount, expiresAt: claimed.holdExpiresAt, status: "PENDING",
      checkout: checkoutFor(wallet, account, claimed),
      events: [{ id: "created", status: "PENDING", source: "system", note: `manual ${wallet} payment started` }]
    });
  } catch (error) {
    await revertToHold(claimed._id, null);
    throw error;
  }
  const linked = await CoachOrder.findOneAndUpdate({ _id: claimed._id }, { $set: { payment: payment._id } }, { returnDocument: "after" });
  pushOrderUpdate(linked);
  await audit({ actor: claimed.customer, actorRole: "customer" }, "payment.started", { entityType: "Payment", entityId: payment._id, meta: { provider, amount: payment.amount, order: String(claimed._id) } });
  return { order: linked, payment, replay: false };
}

// =========================================================================================
// SUBMIT PROOF: customer sends the wallet transaction id + receipt. PENDING -> PROCESSING.
// The hold is stretched so the operator has time to check; nothing is confirmed until the operator approves.
// =========================================================================================
export async function submitProof(order, { tid, senderNumber, file }) {
  const cleanTid = String(tid ?? "").trim().toUpperCase().replace(/\s+/g, "");
  if (!/^[A-Z0-9]{6,24}$/.test(cleanTid)) throw new HoldError(400, "Enter the Transaction ID exactly as shown in your wallet app (letters and numbers only).", { code: "BAD_TID" });
  const sender = normalizeWalletNumber(senderNumber);
  if (!sender) throw new HoldError(400, "Enter the mobile number you paid from (like 03001234567).", { code: "BAD_SENDER" });

  const now = new Date();
  const cur = await CoachOrder.findById(order._id);
  if (cur.status !== "PENDING_PAYMENT") throw stateError(cur);
  const pay = cur.payment && (await CoachPayment.findById(cur.payment));
  if (!pay || !isManualProvider(pay.provider)) throw new HoldError(409, "Choose EasyPaisa or JazzCash first.", { code: "NO_MANUAL_PAYMENT" });
  if (pay.status === "PROCESSING") throw new HoldError(409, "You already sent your payment proof. The operator is checking it.", { code: "ALREADY_SUBMITTED" });
  if (pay.status !== "PENDING") throw stateError(cur);
  if (cur.holdExpiresAt <= now) throw stateError(cur);

  if (await CoachPayment.exists({ provider: pay.provider, tid: cleanTid, _id: { $ne: pay._id } })) {
    throw new HoldError(409, "This Transaction ID was already used for another booking. Please check it.", { code: "TID_USED" });
  }

  const receipt = await CoachReceipt.create({ customer: cur.customer, operator: cur.operator, mime: file.mime, size: file.buffer.length, data: file.buffer });
  const until = new Date(now.getTime() + cfg.manualVerifyMs());
  const rollback = async () => {
    await CoachReceipt.deleteOne({ _id: receipt._id });
    await CoachOrder.updateOne({ _id: cur._id, status: "PENDING_PAYMENT" }, { $set: { holdExpiresAt: cur.holdExpiresAt } });
    await CoachBooking.updateMany({ order: cur._id, status: "PENDING_PAYMENT" }, { $set: { holdExpiresAt: cur.holdExpiresAt } });
  };

  // 1. stretch the hold (only while it is still alive)
  const extended = await CoachOrder.findOneAndUpdate({ _id: cur._id, status: "PENDING_PAYMENT", holdExpiresAt: { $gt: now } }, { $set: { holdExpiresAt: until } }, { returnDocument: "after" });
  if (!extended) {
    await CoachReceipt.deleteOne({ _id: receipt._id });
    throw stateError(await CoachOrder.findById(cur._id));
  }
  await CoachBooking.updateMany({ order: cur._id, status: "PENDING_PAYMENT" }, { $set: { holdExpiresAt: until } });

  // 2. attach the proof. The unique (provider, tid) index is the final word on duplicate transaction ids.
  let updated;
  try {
    updated = await CoachPayment.findOneAndUpdate(
      { _id: pay._id, status: "PENDING" },
      { $set: { status: "PROCESSING", tid: cleanTid, senderNumber: sender, receipt: receipt._id, submittedAt: now, expiresAt: until, rejectReason: "" }, $push: { events: { $each: [{ id: `proof:${now.getTime()}`, status: "PROCESSING", source: "customer", note: "payment proof sent" }], $slice: -50 } } },
      { returnDocument: "after" }
    );
  } catch (error) {
    await rollback();
    if (isDuplicateKey(error)) throw new HoldError(409, "This Transaction ID was already used for another booking. Please check it.", { code: "TID_USED" });
    throw error;
  }
  if (!updated) {
    await rollback();
    throw new HoldError(409, "This payment changed. Please refresh and try again.", { code: "BAD_STATE" });
  }

  await notifyOperator(cur.operator, {
    type: "coach_payment_review", title: "Payment to verify",
    message: `Booking ${cur.orderCode}: PKR ${cur.amount} via ${walletLabel(pay.provider)}, Transaction ID ${cleanTid}. Check the receipt and approve or reject.`.slice(0, 400),
    serviceId: cur._id
  });
  pushOrderUpdate(extended);
  await audit({ actor: cur.customer, actorRole: "customer" }, "payment.proof_submitted", { entityType: "Payment", entityId: pay._id, meta: { provider: pay.provider, amount: pay.amount, order: String(cur._id), tid: cleanTid } });
  return { order: extended, payment: updated };
}

// =========================================================================================
// OPERATOR: list, approve, reject. Every query is filtered by the operator's own id.
// =========================================================================================
const PAID_STATES = ["PAID", "PARTIALLY_REFUNDED", "REFUNDED"];

export async function listPaymentsForOperator(operatorId, tab = "pending") {
  const base = { operator: operatorId, provider: { $in: MANUAL_PROVIDERS }, submittedAt: { $exists: true } };
  let filter;
  if (tab === "approved") filter = { ...base, status: { $in: PAID_STATES } };
  else if (tab === "rejected") filter = { ...base, status: "FAILED", reviewedAt: { $exists: true } };
  else filter = { ...base, $or: [{ status: "PROCESSING" }, { status: "EXPIRED", reviewedAt: { $exists: false } }] };

  const rows = await CoachPayment.find(filter).sort({ submittedAt: -1 }).limit(100).populate("customer", "name phone").populate("order", "orderCode seats status schedule");
  const scheduleIds = [...new Set(rows.map((p) => String(p.order?.schedule || "")).filter(Boolean))];
  const orderIds = rows.map((p) => p.order?._id).filter(Boolean);
  const [schedules, bookings] = await Promise.all([
    CoachSchedule.find({ _id: { $in: scheduleIds } }).select("fromCity toCity departureAt coach").populate("coach", "name"),
    CoachBooking.find({ order: { $in: orderIds } }).select("order seat passenger")
  ]);
  const scheduleById = new Map(schedules.map((s) => [String(s._id), s]));

  return rows.map((p) => {
    const s = scheduleById.get(String(p.order?.schedule));
    return {
      _id: p._id,
      status: p.status,
      late: p.status === "EXPIRED", // the hold ran out before the operator checked: approving still works if the seats are free
      wallet: walletLabel(p.provider),
      amount: p.amount,
      tid: p.tid || p.rejectedTid || "",
      senderNumber: p.senderNumber,
      submittedAt: p.submittedAt,
      reviewedAt: p.reviewedAt,
      rejectReason: p.rejectReason || undefined,
      hasReceipt: !!p.receipt,
      orderCode: p.order?.orderCode,
      orderStatus: p.order?.status,
      seats: p.order?.seats || [],
      customer: p.customer ? { name: p.customer.name, phone: p.customer.phone } : undefined,
      passengers: bookings.filter((b) => String(b.order) === String(p.order?._id)).map((b) => ({ seat: b.seat, name: b.passenger?.name })),
      trip: s ? { fromCity: s.fromCity, toCity: s.toCity, departureAt: s.departureAt, coach: s.coach?.name } : undefined
    };
  });
}

async function ownManualPayment(operatorId, paymentId) {
  const pay = await CoachPayment.findOne({ _id: paymentId, operator: operatorId, provider: { $in: MANUAL_PROVIDERS } });
  if (!pay) throw new HoldError(404, "Payment not found", { code: "NOT_FOUND" });
  if (!pay.submittedAt) throw new HoldError(409, "The customer has not sent payment proof yet.", { code: "NO_PROOF" });
  return pay;
}

export async function approveManualPayment({ operatorId, paymentId, reviewerId }) {
  const pay = await ownManualPayment(operatorId, paymentId);
  if (PAID_STATES.includes(pay.status)) return { outcome: "already_paid", payment: pay }; // pressed twice: harmless
  if (!["PROCESSING", "EXPIRED"].includes(pay.status)) throw new HoldError(409, `This payment can no longer be approved (${pay.status.toLowerCase()}).`, { code: "BAD_STATE" });

  await CoachPayment.updateOne({ _id: pay._id }, { $set: { reviewedBy: reviewerId, reviewedAt: new Date() } });
  // The very same path a real gateway callback takes: confirms the order, issues the ticket, handles late / duplicate payments
  const result = await applyPaymentEvent(pay.provider, { providerRef: pay.providerRef, status: "PAID", amount: pay.amount, providerTxnId: pay.tid, eventId: `manual-approve:${pay._id}` }, { source: "operator" });
  await audit({ actor: reviewerId, actorRole: "operator" }, "payment.manual_approved", { entityType: "Payment", entityId: pay._id, meta: { tid: pay.tid, amount: pay.amount, outcome: result.outcome || (result.duplicate ? "duplicate" : "ok") } });
  return { ...result, payment: await CoachPayment.findById(pay._id) };
}

export async function rejectManualPayment({ operatorId, paymentId, reviewerId, reason }) {
  const clean = String(reason ?? "").trim().slice(0, 200);
  if (clean.length < 3) throw new HoldError(400, "Please write why you are rejecting this payment.", { code: "REASON_REQUIRED" });
  const pay = await ownManualPayment(operatorId, paymentId);
  if (pay.status === "FAILED" && pay.reviewedAt) return { payment: pay, replay: true };
  if (!["PROCESSING", "EXPIRED"].includes(pay.status)) throw new HoldError(409, `This payment can no longer be rejected (${pay.status.toLowerCase()}).`, { code: "BAD_STATE" });

  const now = new Date();
  const wasProcessing = pay.status === "PROCESSING";
  const claimed = await CoachPayment.findOneAndUpdate(
    { _id: pay._id, status: { $in: ["PROCESSING", "EXPIRED"] } },
    { $set: { status: "FAILED", reviewedBy: reviewerId, reviewedAt: now, rejectReason: clean, rejectedTid: pay.tid || "" }, $unset: { tid: 1 }, $push: { events: { $each: [{ id: `reject:${now.getTime()}`, status: "FAILED", source: "operator", note: clean.slice(0, 160) }], $slice: -50 } } },
    { returnDocument: "after" }
  );
  if (!claimed) throw new HoldError(409, "This payment changed. Please refresh.", { code: "BAD_STATE" });

  let backToHold = false;
  if (wasProcessing) {
    const back = await revertToHold(pay.order, pay._id); // PENDING_PAYMENT -> HOLD while the hold is alive
    if (back) {
      backToHold = true;
      const until = new Date(now.getTime() + cfg.paymentWindowMs()); // fresh, short window to send correct proof
      await CoachOrder.updateOne({ _id: back._id, status: "HOLD" }, { $set: { holdExpiresAt: until } });
      await CoachBooking.updateMany({ order: back._id, status: "HOLD" }, { $set: { holdExpiresAt: until } });
    }
  }
  const order = await CoachOrder.findById(pay.order);
  await createNotification(pay.customer, {
    type: "coach_payment_failed", title: "Payment proof rejected",
    message: (backToHold
      ? `Your ${walletLabel(pay.provider)} payment for ${order?.orderCode} was rejected: ${clean} Your seats are held for a few minutes: send correct proof or pay again.`
      : `Your ${walletLabel(pay.provider)} payment for ${order?.orderCode} was rejected: ${clean} The seat hold had already ended.`).slice(0, 400),
    serviceType: "coach_booking", serviceId: pay.order
  });
  if (order) pushOrderUpdate(order);
  await audit({ actor: reviewerId, actorRole: "operator" }, "payment.manual_rejected", { entityType: "Payment", entityId: pay._id, meta: { tid: pay.tid, reason: clean, backToHold } });
  return { payment: claimed, backToHold };
}
