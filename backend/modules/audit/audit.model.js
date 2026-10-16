import mongoose from "mongoose";

const { ObjectId, Mixed } = mongoose.Schema.Types;

// Append-only record of sensitive actions. Never store secrets, tokens or document contents here.
const auditSchema = new mongoose.Schema(
  {
    actor: { type: ObjectId, ref: "User", default: null }, // null = system / anonymous
    actorRole: { type: String, default: "" },
    action: { type: String, required: true, maxlength: 80 }, // e.g. "document.approved"
    entityType: { type: String, default: "", maxlength: 40 }, // "User" | "Booking" | "Document" ...
    entityId: { type: String, default: "", maxlength: 60 },
    meta: { type: Mixed, default: {} },
    ip: { type: String, default: "" },
    userAgent: { type: String, default: "", maxlength: 200 }
  },
  { timestamps: { createdAt: true, updatedAt: false } }
);

auditSchema.index({ entityType: 1, entityId: 1, createdAt: -1 });
auditSchema.index({ actor: 1, createdAt: -1 });
auditSchema.index({ action: 1, createdAt: -1 });
auditSchema.index({ createdAt: -1 });

export default mongoose.model("AuditLog", auditSchema);
