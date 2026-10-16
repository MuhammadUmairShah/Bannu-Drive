import multer from "multer";
import { CoachOperator } from "./coach.model.js";
import { CoachPayment, CoachReceipt } from "./coach.order.model.js";
import { cfg } from "./coach.config.js";
import { HoldError } from "./coach.holds.js";
import { sendHoldError } from "./coach.customer.controller.js";
import { orderView, ownOrder } from "./coach.order.controller.js";
import { submitProof, listPaymentsForOperator, approveManualPayment, rejectManualPayment } from "./coach.manual.js";
import { isManualProvider } from "./coach.states.js";
import { str } from "../../shared/utils/objectId.js";

const fail = (res, status, message, extra = {}) => res.status(status).json({ success: false, message, ...extra });
const serverError = (res, label, error) => {
  console.error(`${label}:`, error);
  return fail(res, 500, "Something went wrong");
};

// ---------------- receipt upload: memory only (stored in MongoDB), 1 file, small, images or PDF ----------------
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: cfg.receiptMaxBytes(), files: 1, fields: 6, parts: 8 },
  fileFilter: (req, file, cb) => (["image/jpeg", "image/png", "image/webp", "application/pdf"].includes(file.mimetype) ? cb(null, true) : cb(new Error("Receipt must be a JPG, PNG, WebP or PDF file"))),
}).single("receipt");

export function receiptUpload(req, res, next) {
  upload(req, res, (err) => {
    if (!err) return next();
    if (err.code === "LIMIT_FILE_SIZE") return fail(res, 413, `Receipt is too large (max ${Math.round(cfg.receiptMaxBytes() / 1048576)} MB)`);
    return fail(res, 400, err instanceof multer.MulterError ? "Could not read the receipt file" : err.message);
  });
}

// The browser's content-type is only a claim: check the real file signature
function sniffMime(buf) {
  if (!buf || buf.length < 12) return null;
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return "image/jpeg";
  if (buf.slice(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return "image/png";
  if (buf.slice(0, 4).toString("latin1") === "RIFF" && buf.slice(8, 12).toString("latin1") === "WEBP") return "image/webp";
  if (buf.slice(0, 5).toString("latin1") === "%PDF-") return "application/pdf";
  return null;
}

// POST /coach/orders/:orderId/payment-proof   multipart: tid, senderNumber, receipt (file)
export async function submitPaymentProof(req, res) {
  try {
    const order = await ownOrder(req, res);
    if (!order) return;
    if (!req.file) return fail(res, 400, "Please attach your payment receipt (screenshot or PDF).", { code: "RECEIPT_REQUIRED" });
    const mime = sniffMime(req.file.buffer);
    if (!mime) return fail(res, 400, "The receipt must be a real JPG, PNG, WebP or PDF file.", { code: "BAD_RECEIPT" });

    const { order: updated } = await submitProof(order, { tid: req.body?.tid, senderNumber: req.body?.senderNumber, file: { buffer: req.file.buffer, mime } });
    return res.json({ success: true, message: "Payment proof sent. The operator will check it soon.", order: await orderView(updated) });
  } catch (error) {
    if (error instanceof HoldError) return sendHoldError(res, error);
    return serverError(res, "Submit Payment Proof Error", error);
  }
}

// GET /coach/manual-payments/:id/receipt : the customer who paid, the operator who is paid, or an admin
export async function getReceipt(req, res) {
  try {
    const pay = await CoachPayment.findById(req.params.id).select("customer operator provider receipt");
    if (!pay || !pay.receipt || !isManualProvider(pay.provider)) return fail(res, 404, "Receipt not found");

    let allowed = req.user.role === "admin" || (req.user.role === "customer" && String(pay.customer) === String(req.user.id));
    if (!allowed && req.user.role === "operator") {
      const op = await CoachOperator.findOne({ user: req.user.id }).select("_id");
      allowed = !!op && String(op._id) === String(pay.operator);
    }
    if (!allowed) return fail(res, 404, "Receipt not found"); // same answer as "missing": do not reveal that it exists

    const receipt = await CoachReceipt.findById(pay.receipt);
    if (!receipt) return fail(res, 404, "Receipt not found");
    res.set({
      "Content-Type": receipt.mime,
      "Content-Length": String(receipt.data.length),
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "default-src 'none'; sandbox",
      "Content-Disposition": "inline",
    });
    return res.send(receipt.data);
  } catch (error) {
    return serverError(res, "Get Receipt Error", error);
  }
}

// ---------------- operator ----------------
// GET /coach/operator/payments?tab=pending|approved|rejected
export async function operatorListPayments(req, res) {
  try {
    const tab = ["pending", "approved", "rejected"].includes(req.query.tab) ? req.query.tab : "pending";
    return res.json({ success: true, tab, payments: await listPaymentsForOperator(req.operator.id, tab) });
  } catch (error) {
    return serverError(res, "Operator Payments Error", error);
  }
}

// PATCH /coach/operator/payments/:id/approve
export async function operatorApprove(req, res) {
  try {
    const result = await approveManualPayment({ operatorId: req.operator.id, paymentId: req.params.id, reviewerId: req.user.id });
    const messages = {
      confirmed: "Payment approved. The booking is confirmed.",
      late_recovered: "Payment approved. The hold had ended but the seats were free, so the booking is confirmed.",
      late_refund: "Payment recorded, but the seats were already taken. A refund has been requested for the customer.",
      duplicate_refund: "This booking was already paid. The extra payment will be refunded.",
      closed_refund: "The booking was already closed. A refund has been requested for the customer.",
      already_paid: "Already approved.",
    };
    return res.json({ success: true, outcome: result.outcome || "ok", message: messages[result.outcome] || "Payment approved." });
  } catch (error) {
    if (error instanceof HoldError) return sendHoldError(res, error);
    return serverError(res, "Approve Payment Error", error);
  }
}

// PATCH /coach/operator/payments/:id/reject   { reason }
export async function operatorReject(req, res) {
  try {
    await rejectManualPayment({ operatorId: req.operator.id, paymentId: req.params.id, reviewerId: req.user.id, reason: str(req.body?.reason, 200) });
    return res.json({ success: true, message: "Payment rejected. The customer was told why." });
  } catch (error) {
    if (error instanceof HoldError) return sendHoldError(res, error);
    return serverError(res, "Reject Payment Error", error);
  }
}
