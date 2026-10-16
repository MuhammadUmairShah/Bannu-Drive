import mongoose from "mongoose";
import { ORDER_STATUS, ORDER_PAYMENT_STATUS, PAYMENT_STATUS } from "./coach.states.js";

const { ObjectId, Mixed } = mongoose.Schema.Types;

// ---------------------------------------------------------------------------
// ORDER: one checkout = one hold = one payment, for 1..N seats of ONE schedule.
// The order is the single arbiter of the hold's lifetime and of payment idempotency.
// The per-seat records (CoachBooking) are the tickets.
// ---------------------------------------------------------------------------
const orderSchema = new mongoose.Schema(
  {
    orderCode: { type: String, required: true, unique: true }, // BO-XXXXXXXX
    customer: { type: ObjectId, ref: "User", required: true },
    operator: { type: ObjectId, ref: "CoachOperator", required: true },
    schedule: { type: ObjectId, ref: "CoachSchedule", required: true },
    // "<customerId>:<client Idempotency-Key>". Unique + sparse: a retried/double-clicked request maps to ONE order
    idemKey: { type: String, default: undefined },
    // "<customerId>:<n>" while the order is open. Unique + sparse: the DATABASE hands out each customer's N open-order
    // slots, so the "max open holds" limit holds even under concurrent requests. Removed when the order is decided.
    slotKey: { type: String, default: undefined },
    seats: { type: [String], required: true }, // sorted
    boardingPoint: { type: new mongoose.Schema({ stopId: ObjectId, name: String, order: Number, time: Date }, { _id: false }), default: undefined },
    droppingPoint: { type: new mongoose.Schema({ stopId: ObjectId, name: String, order: Number, time: Date }, { _id: false }), default: undefined },
    seatCount: { type: Number, required: true, min: 1 },
    amount: { type: Number, required: true, min: 1 }, // PKR, computed on the server from the schedule fare
    status: { type: String, enum: ORDER_STATUS, default: "CREATING" },
    holdExpiresAt: { type: Date, required: true },
    holdExtensions: { type: Number, default: 0 },
    paymentMethod: { type: String, enum: ["CASH", "ONLINE", ""], default: "" },
    paymentStatus: { type: String, enum: ORDER_PAYMENT_STATUS, default: "UNPAID" },
    payment: { type: ObjectId, ref: "CoachPayment", default: undefined }, // current online payment attempt
    confirmedAt: { type: Date, default: undefined },
    lateConfirmed: { type: Boolean, default: false }, // confirmed by a payment that arrived after the hold expired
    cancelledAt: { type: Date, default: undefined },
    cancelledBy: { type: String, enum: ["customer", "operator", "admin", "system", ""], default: "" },
    cancelReason: { type: String, default: "", maxlength: 200 },
    expiredAt: { type: Date, default: undefined },
    purgeAt: { type: Date, default: undefined },
    expiryWarned: { type: Boolean, default: false }, // the "your hold is about to expire" notice was sent
    needsAttention: { type: Boolean, default: false } // inconsistency found by the sweeper: shown to admins
  },
  { timestamps: true }
);

orderSchema.index({ idemKey: 1 }, { unique: true, sparse: true });
orderSchema.index({ slotKey: 1 }, { unique: true, sparse: true });
orderSchema.index({ customer: 1, status: 1, createdAt: -1 });
orderSchema.index({ schedule: 1, status: 1 });
orderSchema.index({ status: 1, holdExpiresAt: 1 });
orderSchema.index({ purgeAt: 1 }, { expireAfterSeconds: 0 });

// ---------------------------------------------------------------------------
// PAYMENT: one online payment attempt for an order. Provider-agnostic.
// ---------------------------------------------------------------------------
const paymentSchema = new mongoose.Schema(
  {
    order: { type: ObjectId, ref: "CoachOrder", required: true },
    customer: { type: ObjectId, ref: "User", required: true },
    operator: { type: ObjectId, ref: "CoachOperator", required: true },
    provider: { type: String, required: true }, // "mock" | "jazzcash" | "easypaisa" | ...
    mode: { type: String, enum: ["sandbox", "production"], default: "sandbox" },
    providerRef: { type: String, required: true }, // OUR transaction reference sent to the provider
    providerTxnId: { type: String, default: "" }, // the provider's own transaction id (from the callback)
    amount: { type: Number, required: true, min: 1 },
    currency: { type: String, default: "PKR" },
    status: { type: String, enum: PAYMENT_STATUS, default: "PENDING" },
    expiresAt: { type: Date, required: true },
    checkout: { type: Mixed, default: undefined }, // what the browser needs to continue (no secrets)
    gateway: { type: Mixed, default: undefined }, // sandbox gateway state (mock provider only)
    paidAt: { type: Date, default: undefined },
    lateSuccess: { type: Boolean, default: false }, // success arrived after the order had expired
    needsAttention: { type: Boolean, default: false },
    events: { type: [new mongoose.Schema({ id: String, status: String, source: String, note: String, at: { type: Date, default: Date.now } }, { _id: false })], default: [] },
    lastSyncAt: { type: Date, default: undefined },
    refundedTotal: { type: Number, default: 0 },
    // ---- manual wallet payment proof (EasyPaisa / JazzCash) ----
    tid: { type: String, default: undefined }, // customer's transaction id; unique per provider while it is in use
    senderNumber: { type: String, default: "" },
    receipt: { type: ObjectId, ref: "CoachReceipt", default: undefined },
    submittedAt: { type: Date, default: undefined },
    reviewedBy: { type: ObjectId, ref: "User", default: undefined },
    reviewedAt: { type: Date, default: undefined },
    rejectReason: { type: String, default: "", maxlength: 200 },
    rejectedTid: { type: String, default: "" } // the id that was refused, kept for the audit trail
  },
  { timestamps: true }
);

paymentSchema.index({ provider: 1, providerRef: 1 }, { unique: true });
// The same wallet transaction id can never back two payments (a rejected payment releases its id)
paymentSchema.index({ provider: 1, tid: 1 }, { unique: true, partialFilterExpression: { tid: { $type: "string" } } });
paymentSchema.index({ operator: 1, status: 1, submittedAt: -1 });
paymentSchema.index({ order: 1, createdAt: -1 });
paymentSchema.index({ status: 1, expiresAt: 1 });

// ---------------------------------------------------------------------------
// REFUND ledger. One row per refundable event; "key" makes creation idempotent (a retried cancel or callback can
// never create the same refund twice). Online refunds are attempted through the provider when it supports it,
// otherwise they wait here as REQUIRED for an admin to process and mark done.
// ---------------------------------------------------------------------------
const refundSchema = new mongoose.Schema(
  {
    key: { type: String, required: true, unique: true }, // "<paymentId>:<bookingId|all>"
    payment: { type: ObjectId, ref: "CoachPayment", required: true },
    order: { type: ObjectId, ref: "CoachOrder", required: true },
    booking: { type: ObjectId, ref: "CoachBooking", default: undefined },
    customer: { type: ObjectId, ref: "User", required: true },
    amount: { type: Number, required: true, min: 0 },
    reason: { type: String, default: "", maxlength: 200 },
    kind: { type: String, enum: ["CANCELLATION", "LATE_PAYMENT_CONFLICT", "DUPLICATE_PAYMENT", "ORDER_CLOSED"], required: true },
    status: { type: String, enum: ["REQUIRED", "PROCESSED", "FAILED"], default: "REQUIRED" },
    providerRef: { type: String, default: "" },
    processedAt: { type: Date, default: undefined },
    processedBy: { type: ObjectId, ref: "User", default: undefined }
  },
  { timestamps: true }
);
refundSchema.index({ status: 1, createdAt: 1 });
refundSchema.index({ payment: 1 });

// Receipt screenshot, kept in MongoDB so it survives redeploys. Served only through an authenticated endpoint.
const receiptSchema = new mongoose.Schema(
  {
    customer: { type: ObjectId, ref: "User", required: true },
    operator: { type: ObjectId, ref: "CoachOperator", required: true },
    mime: { type: String, required: true },
    size: { type: Number, required: true },
    data: { type: Buffer, required: true }
  },
  { timestamps: true }
);

export const CoachReceipt = mongoose.model("CoachReceipt", receiptSchema);
export const CoachRefund = mongoose.model("CoachRefund", refundSchema);
export const CoachOrder = mongoose.model("CoachOrder", orderSchema);
export const CoachPayment = mongoose.model("CoachPayment", paymentSchema);
