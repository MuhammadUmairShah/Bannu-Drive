import userModel from "../users/user.model.js";
import { VerificationDocument, VerificationCase } from "./verification.model.js";
import { requirementsFor } from "./verification.config.js";
import { presentDocument, recomputeCase, ensureCase, requirementsPayload } from "./verification.service.js";
import { uploadPrivateBuffer, fetchPrivateFile } from "../../shared/utils/cloudinaryUpload.js";
import { createNotification } from "../notifications/notification.service.js";
import { audit } from "../audit/audit.service.js";
import { str, isObjectId, escapeRegex } from "../../shared/utils/objectId.js";
import { requireDocuments } from "../../shared/config/env.js";

const fail = (res, status, message) => res.status(status).json({ success: false, message });
const serverError = (res, label, error) => {
  console.error(`${label}:`, error);
  return fail(res, 500, "Something went wrong");
};

// Safe display name for the stored original filename (no path, no odd characters)
const safeName = (name) => String(name || "document").replace(/[^\w.\- ]+/g, "_").slice(0, 100);

// =========================================================
// DRIVER / OPERATOR: my requirements + documents + case
// =========================================================
export async function getMyVerification(req, res) {
  try {
    const user = await userModel.findById(req.user.id).select("role isVerified");
    const vcase = await ensureCase(user);
    const docs = await VerificationDocument.find({ owner: user._id, isCurrent: true }).sort({ createdAt: 1 });

    return res.json({
      success: true,
      documentsRequired: requireDocuments(),
      isVerified: user.isVerified,
      requirements: requirementsPayload(user.role),
      documents: docs.map((d) => presentDocument(d)),
      case: vcase ? { status: vcase.status, submittedAt: vcase.submittedAt, decidedAt: vcase.decidedAt, history: vcase.history.map((h) => ({ status: h.status, note: h.note, at: h.at })) } : null
    });
  } catch (error) {
    return serverError(res, "Get my verification error", error);
  }
}

// =========================================================
// UPLOAD (new or replacement). Old versions are kept for history.
// =========================================================
export async function uploadDocument(req, res) {
  try {
    const user = await userModel.findById(req.user.id).select("role");
    const type = str(req.body.type, 40);
    const allowed = requirementsFor(user.role).map((r) => r.type);

    if (!allowed.includes(type)) return fail(res, 400, "This document type is not valid for your account");

    const current = await VerificationDocument.findOne({ owner: user._id, type, isCurrent: true });
    if (current?.status === "APPROVED") {
      return fail(res, 409, "This document is already approved. Contact support if it needs to change.");
    }

    let stored;
    try {
      stored = await uploadPrivateBuffer(req.file.buffer, { folder: `bannu-drive/private/verification/${user._id}` });
    } catch (error) {
      if (error.code === "CLOUDINARY_NOT_CONFIGURED") return fail(res, 503, "Document storage is not configured yet. Please try again later.");
      console.error("Private upload failed:", error.message);
      return fail(res, 502, "Upload failed. Please try again.");
    }

    if (current) {
      await VerificationDocument.updateOne({ _id: current._id }, { $set: { isCurrent: false, supersededAt: new Date() } });
    }

    const doc = await VerificationDocument.create({
      owner: user._id,
      subjectRole: user.role,
      type,
      status: "PENDING",
      storage: { publicId: stored.publicId, format: stored.format, resourceType: stored.resourceType },
      mime: req.file.mimetype,
      bytes: req.file.size,
      originalName: safeName(req.file.originalname),
      history: [{ status: "PENDING", by: user._id, byRole: user.role, note: current ? "Replacement uploaded" : "Uploaded" }]
    });

    await recomputeCase(user._id, { id: user._id, role: user.role });
    await audit(req, current ? "document.replaced" : "document.uploaded", { entityType: "Document", entityId: doc._id, meta: { type, owner: String(user._id) } });

    return res.status(201).json({ success: true, message: "Document uploaded. It will be reviewed by our team.", document: presentDocument(doc) });
  } catch (error) {
    if (error.code === 11000) return fail(res, 409, "Another upload for this document is in progress. Please try again.");
    return serverError(res, "Upload document error", error);
  }
}

// =========================================================
// VIEW FILE: owner or admin only, streamed through the backend
// =========================================================
export async function getDocumentFile(req, res) {
  try {
    const doc = await VerificationDocument.findById(req.params.id).select("+storage.publicId");

    // Same answer for "missing" and "not yours" so ids cannot be probed
    if (!doc || (req.user.role !== "admin" && String(doc.owner) !== req.user.id)) return fail(res, 404, "Document not found");

    let buffer;
    try {
      buffer = await fetchPrivateFile(doc.storage.publicId, doc.storage.format, doc.storage.resourceType);
    } catch (error) {
      console.error("Document fetch failed:", error.message);
      return fail(res, 502, "Could not load the document right now");
    }

    if (req.user.role === "admin") {
      await audit(req, "document.viewed", { entityType: "Document", entityId: doc._id, meta: { type: doc.type, owner: String(doc.owner) } });
    }

    res.set({
      "Content-Type": doc.mime || "application/octet-stream",
      "Content-Length": buffer.length,
      "Content-Disposition": `inline; filename="${safeName(doc.originalName)}"`,
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "default-src 'none'; img-src 'self' data:; style-src 'unsafe-inline'; sandbox"
    });
    return res.send(buffer);
  } catch (error) {
    return serverError(res, "Get document file error", error);
  }
}

// =========================================================
// ADMIN: list cases
// =========================================================
export async function adminListCases(req, res) {
  try {
    const filter = {};
    const status = str(req.query.status, 20);
    const role = str(req.query.role, 20);
    const q = str(req.query.q, 60);

    if (["PENDING", "UNDER_REVIEW", "APPROVED", "REJECTED"].includes(status)) filter.status = status;
    if (["driver", "operator"].includes(role)) filter.subjectRole = role;

    if (q) {
      const rx = new RegExp(escapeRegex(q), "i");
      const ids = await userModel.find({ $or: [{ name: rx }, { email: rx }, { phone: rx }] }).select("_id").limit(200).lean();
      filter.user = { $in: ids.map((u) => u._id) };
    }

    const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 25, 1), 100);
    const page = Math.max(parseInt(req.query.page, 10) || 1, 1);

    const [cases, total] = await Promise.all([
      VerificationCase.find(filter).sort({ updatedAt: -1 }).skip((page - 1) * limit).limit(limit).populate("user", "name email phone role isVerified isBlocked vehicleType vehicleNumber").lean(),
      VerificationCase.countDocuments(filter)
    ]);

    const owners = cases.map((c) => c.user?._id).filter(Boolean);
    const [totals, waiting] = await Promise.all([
      VerificationDocument.aggregate([{ $match: { owner: { $in: owners }, isCurrent: true } }, { $group: { _id: "$owner", total: { $sum: 1 } } }]),
      VerificationDocument.aggregate([{ $match: { owner: { $in: owners }, isCurrent: true, status: { $in: ["PENDING", "UNDER_REVIEW"] } } }, { $group: { _id: "$owner", pending: { $sum: 1 } } }])
    ]);
    const pendingBy = new Map(waiting.map((w) => [String(w._id), w.pending]));
    const counts = totals.map((t) => ({ _id: t._id, total: t.total, pending: pendingBy.get(String(t._id)) || 0 }));
    const byOwner = new Map(counts.map((c) => [String(c._id), c]));

    return res.json({
      success: true,
      total,
      page,
      pages: Math.max(1, Math.ceil(total / limit)),
      items: cases.filter((c) => c.user).map((c) => ({
        user: c.user,
        status: c.status,
        submittedAt: c.submittedAt,
        updatedAt: c.updatedAt,
        documents: byOwner.get(String(c.user._id))?.total || 0,
        awaitingReview: byOwner.get(String(c.user._id))?.pending || 0
      }))
    });
  } catch (error) {
    return serverError(res, "Admin list cases error", error);
  }
}

// =========================================================
// ADMIN: one user's full verification file (all versions + history)
// =========================================================
export async function adminGetCase(req, res) {
  try {
    const user = await userModel.findById(req.params.userId).select("name email phone role isVerified isBlocked vehicleType vehicleModel vehicleNumber licenseNumber createdAt");
    if (!user || !["driver", "operator"].includes(user.role)) return fail(res, 404, "Driver or operator not found");

    const vcase = await ensureCase(user);
    const docs = await VerificationDocument.find({ owner: user._id }).sort({ type: 1, createdAt: -1 });

    return res.json({
      success: true,
      user,
      documentsRequired: requireDocuments(),
      requirements: requirementsPayload(user.role),
      case: vcase ? { status: vcase.status, submittedAt: vcase.submittedAt, decidedAt: vcase.decidedAt, history: vcase.history } : null,
      documents: docs.map((d) => presentDocument(d, { admin: true }))
    });
  } catch (error) {
    return serverError(res, "Admin get case error", error);
  }
}

// =========================================================
// ADMIN: review one document
// decision: APPROVED | REJECTED | UNDER_REVIEW | REUPLOAD
// =========================================================
export async function adminReviewDocument(req, res) {
  try {
    const decision = str(req.body.decision, 20).toUpperCase();
    const reason = str(req.body.reason, 300);

    if (!["APPROVED", "REJECTED", "UNDER_REVIEW", "REUPLOAD"].includes(decision)) return fail(res, 400, "Invalid decision");
    if ((decision === "REJECTED" || decision === "REUPLOAD") && reason.length < 3) return fail(res, 400, "Please give a reason (at least 3 characters)");

    const doc = await VerificationDocument.findById(req.params.id);
    if (!doc) return fail(res, 404, "Document not found");
    if (!doc.isCurrent) return fail(res, 409, "This is an old version. Review the current document instead.");

    const status = decision === "REUPLOAD" ? "REJECTED" : decision;

    doc.status = status;
    doc.reviewedBy = req.user.id;
    doc.reviewedAt = new Date();
    doc.rejectionReason = status === "REJECTED" ? reason : "";
    doc.reuploadRequested = decision === "REUPLOAD";
    doc.history.push({ status, by: req.user.id, byRole: "admin", note: reason || decision });
    await doc.save();

    const vcase = await recomputeCase(doc.owner, { id: req.user.id, role: "admin" });

    const label = doc.type.replace(/_/g, " ").toLowerCase();
    if (status === "REJECTED") {
      await createNotification(doc.owner, {
        type: "document_rejected",
        title: decision === "REUPLOAD" ? "Please upload your document again" : "Document rejected",
        message: `Your ${label} was not accepted: ${reason}`.slice(0, 400)
      });
    } else if (status === "APPROVED") {
      await createNotification(doc.owner, { type: "document_approved", title: "Document approved", message: `Your ${label} was approved.` });
    }

    await audit(req, `document.${decision === "REUPLOAD" ? "reupload_requested" : status.toLowerCase()}`, {
      entityType: "Document",
      entityId: doc._id,
      meta: { type: doc.type, owner: String(doc.owner), reason }
    });

    return res.json({ success: true, message: "Document updated", document: presentDocument(doc, { admin: true }), caseStatus: vcase?.status });
  } catch (error) {
    return serverError(res, "Admin review document error", error);
  }
}

export const validateObjectIdParam = (name) => (req, res, next) =>
  isObjectId(req.params[name]) ? next() : fail(res, 400, "Invalid id");
