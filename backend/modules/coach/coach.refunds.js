import userModel from "../users/user.model.js";
import { CoachBooking } from "./coach.model.js";
import { CoachOrder, CoachPayment, CoachRefund } from "./coach.order.model.js";
import { getProvider } from "../../shared/payments/provider.js";
import { isManualProvider } from "./coach.states.js";
import { createNotification } from "../notifications/notification.service.js";
import { audit } from "../audit/audit.service.js";
import { isDuplicateKey } from "../../shared/utils/dbErrors.js";

export async function notifyAdmins(data) {
  try {
    const admins = await userModel.find({ role: "admin", isBlocked: { $ne: true } }).select("_id").limit(20);
    for (const a of admins) await createNotification(a._id, data);
  } catch (error) {
    console.error("notifyAdmins failed:", error.message);
  }
}

// Money owed back to a customer. Idempotent per (payment, booking): calling it twice returns the same row.
export async function requestRefund({ payment, order, booking = null, amount, kind, reason = "" }) {
  const key = `${payment._id}:${booking ? booking._id : "all"}`;
  const amt = Math.max(0, Math.min(Math.round(amount), payment.amount));
  if (amt === 0) return null;

  let refund;
  try {
    refund = await CoachRefund.create({ key, payment: payment._id, order: order._id, booking: booking?._id, customer: payment.customer, amount: amt, kind, reason });
  } catch (error) {
    if (isDuplicateKey(error)) return CoachRefund.findOne({ key });
    throw error;
  }

  // Try the provider first when it can refund by API (sandbox mock can; real providers may need manual refund)
  const provider = isManualProvider(payment.provider) ? null : getProvider(payment.provider);
  if (provider?.capabilities.refund && provider.isConfigured()) {
    try {
      const result = await provider.refund({ payment, amount: amt, reason });
      if (result?.ok) return markRefundProcessed(refund._id, { by: null, reference: result.providerRef, source: "provider" });
    } catch (error) {
      console.warn(`Provider refund failed (${payment.provider}):`, error.message);
    }
  }

  // Manual path: flag the ticket(s) and tell admins. A DUPLICATE payment leaves the valid booking untouched.
  const flag = { paymentStatus: "REFUND_REQUIRED" };
  if (booking) await CoachBooking.updateOne({ _id: booking._id }, { $set: flag });
  else if (kind !== "DUPLICATE_PAYMENT") {
    await CoachBooking.updateMany({ order: order._id }, { $set: flag });
    await CoachOrder.updateOne({ _id: order._id }, { $set: flag });
  }

  await notifyAdmins({
    type: "coach_refund_required", title: "Refund required",
    message: `${amt} PKR must be refunded (${payment.provider}, ref ${payment.providerRef}). ${reason}`.slice(0, 400),
    serviceType: "coach_booking", serviceId: order._id
  });
  await createNotification(payment.customer, {
    type: "coach_refund_required", title: "Refund on its way",
    message: `We owe you ${amt} PKR for your coach booking. ${reason} It will be refunded to your payment method.`.slice(0, 400),
    serviceType: "coach_booking", serviceId: order._id
  });
  await audit({ actorRole: "system" }, "payment.refund_required", { entityType: "Payment", entityId: payment._id, meta: { amount: amt, kind, order: String(order._id) } });
  return refund;
}

export async function markRefundProcessed(refundId, { by, reference = "", source = "admin" }) {
  const refund = await CoachRefund.findOneAndUpdate(
    { _id: refundId, status: { $in: ["REQUIRED", "FAILED"] } },
    { $set: { status: "PROCESSED", processedAt: new Date(), processedBy: by || undefined, providerRef: String(reference || "").slice(0, 80) } },
    { returnDocument: "after" }
  );
  if (!refund) return CoachRefund.findById(refundId); // already processed: idempotent

  const payment = await CoachPayment.findByIdAndUpdate(refund.payment, { $inc: { refundedTotal: refund.amount } }, { returnDocument: "after" });
  // PAID -> PARTIALLY_REFUNDED -> REFUNDED, driven only by the money actually returned
  if (payment && payment.refundedTotal >= payment.amount) await CoachPayment.updateOne({ _id: payment._id, status: { $in: ["PAID", "PARTIALLY_REFUNDED"] } }, { $set: { status: "REFUNDED" } });
  else if (payment && payment.refundedTotal > 0) await CoachPayment.updateOne({ _id: payment._id, status: "PAID" }, { $set: { status: "PARTIALLY_REFUNDED" } });

  if (refund.booking) await CoachBooking.updateOne({ _id: refund.booking }, { $set: { paymentStatus: "REFUNDED" } });
  else if (refund.kind !== "DUPLICATE_PAYMENT") await CoachBooking.updateMany({ order: refund.order }, { $set: { paymentStatus: "REFUNDED" } });

  if (refund.kind !== "DUPLICATE_PAYMENT") {
    const pending = await CoachRefund.countDocuments({ payment: refund.payment, status: "REQUIRED" });
    if (!pending) await CoachOrder.updateOne({ _id: refund.order }, { $set: { paymentStatus: payment?.status === "REFUNDED" ? "REFUNDED" : "PAID" } });
  }

  await createNotification(refund.customer, {
    type: "coach_refund_required", title: "Refund processed",
    message: `${refund.amount} PKR was refunded for your coach booking.`, serviceType: "coach_booking", serviceId: refund.order
  });
  await audit(by ? { actor: by, actorRole: "admin" } : { actorRole: source }, "payment.refund_processed", { entityType: "Refund", entityId: refund._id, meta: { amount: refund.amount, source } });
  return refund;
}
