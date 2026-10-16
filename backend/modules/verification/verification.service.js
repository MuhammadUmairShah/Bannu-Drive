import userModel from "../users/user.model.js";
import { VerificationDocument, VerificationCase } from "./verification.model.js";
import { requiredTypesFor, requirementsFor } from "./verification.config.js";
import { requireDocuments } from "../../shared/config/env.js";
import { createNotification } from "../notifications/notification.service.js";
import { audit } from "../audit/audit.service.js";

// What the API is allowed to show about a document. Storage details are deliberately absent.
export function presentDocument(doc, { admin = false } = {}) {
  const out = {
    id: doc._id,
    type: doc.type,
    status: doc.status,
    mime: doc.mime,
    bytes: doc.bytes,
    originalName: doc.originalName,
    uploadedAt: doc.createdAt,
    reviewedAt: doc.reviewedAt,
    rejectionReason: doc.rejectionReason || "",
    reuploadRequested: !!doc.reuploadRequested,
    isCurrent: !!doc.isCurrent
  };

  if (admin) {
    out.history = (doc.history || []).map((h) => ({ status: h.status, byRole: h.byRole, note: h.note, at: h.at }));
  }
  return out;
}

// Pure function: overall status from the current documents (easy to unit test)
export function deriveCaseStatus(role, currentDocs) {
  const required = requiredTypesFor(role);
  const byType = new Map(currentDocs.map((d) => [d.type, d]));

  if (required.some((t) => byType.get(t)?.status === "REJECTED")) return "REJECTED";

  const allPresent = required.every((t) => byType.has(t));
  if (!allPresent) return "PENDING";

  return required.every((t) => byType.get(t).status === "APPROVED") ? "APPROVED" : "UNDER_REVIEW";
}

// Recomputes the case after any upload / review and applies the consequences (verified flag, history).
export async function recomputeCase(userId, actor = null) {
  const user = await userModel.findById(userId).select("role isVerified driverStatus name");
  if (!user || !["driver", "operator"].includes(user.role)) return null;

  const docs = await VerificationDocument.find({ owner: user._id, isCurrent: true }).select("type status").lean();
  const next = deriveCaseStatus(user.role, docs);

  let vcase = await VerificationCase.findOne({ user: user._id });
  if (!vcase) vcase = new VerificationCase({ user: user._id, subjectRole: user.role, status: "PENDING", history: [{ status: "PENDING", note: "Case opened" }] });

  const previous = vcase.status;
  if (previous === next && vcase.history.length) {
    await vcase.save();
    return vcase;
  }

  vcase.status = next;
  vcase.history.push({ status: next, by: actor?.id || null, byRole: actor?.role || "system", note: `Status changed from ${previous} to ${next}` });
  if (next === "UNDER_REVIEW" && !vcase.submittedAt) vcase.submittedAt = new Date();
  if (next === "APPROVED" || next === "REJECTED") {
    vcase.decidedAt = new Date();
    vcase.decidedBy = actor?.id || null;
  }
  await vcase.save();

  const ctx = actor ? { actor: actor.id, actorRole: actor.role } : {};

  if (next === "APPROVED" && !user.isVerified) {
    await userModel.updateOne({ _id: user._id }, { $set: { isVerified: true } });
    await createNotification(user._id, {
      type: "account_verified",
      title: "Account approved",
      message: user.role === "operator"
        ? "All your documents are approved. You can now add coaches, routes and schedules."
        : "All your documents are approved. You can now go online and accept requests."
    });
    await audit(ctx, "verification.approved", { entityType: "User", entityId: user._id, meta: { role: user.role } });
  }

  if (next === "REJECTED") {
    const update = user.isVerified ? { isVerified: false, ...(user.role === "driver" ? { driverStatus: "offline" } : {}) } : null;
    if (update) await userModel.updateOne({ _id: user._id }, { $set: update });
    await audit(ctx, "verification.rejected", { entityType: "User", entityId: user._id, meta: { role: user.role, hadVerifiedFlag: !!update } });
  }

  return vcase;
}

// When documents are mandatory (production), an admin cannot flip the flag without approved documents
export async function assertDocumentsApproved(userId) {
  if (!requireDocuments()) return { ok: true };
  const vcase = await VerificationCase.findOne({ user: userId }).select("status").lean();
  if (vcase?.status === "APPROVED") return { ok: true };
  return { ok: false, message: "Documents must be approved before this account can be verified" };
}

export async function ensureCase(user) {
  let vcase = await VerificationCase.findOne({ user: user._id });
  if (!vcase) vcase = await recomputeCase(user._id);
  return vcase;
}

export const requirementsPayload = (role) => requirementsFor(role).map((r) => ({ ...r }));
