import mongoose from "mongoose";
import { DOC_STATUS, CASE_STATUS, SUBJECT_ROLES } from "./verification.config.js";

const { ObjectId } = mongoose.Schema.Types;

const historyEntry = new mongoose.Schema(
  {
    status: { type: String, required: true },
    by: { type: ObjectId, ref: "User", default: null },
    byRole: { type: String, default: "" },
    note: { type: String, default: "", maxlength: 300 },
    at: { type: Date, default: Date.now }
  },
  { _id: false }
);

// One uploaded file. Replacing a document creates a NEW row and flips the old one to isCurrent=false,
// so the full history of what was submitted and reviewed is kept.
const documentSchema = new mongoose.Schema(
  {
    owner: { type: ObjectId, ref: "User", required: true },
    subjectRole: { type: String, enum: SUBJECT_ROLES, required: true },
    type: { type: String, required: true },
    status: { type: String, enum: DOC_STATUS, default: "PENDING" },
    isCurrent: { type: Boolean, default: true },
    supersededAt: { type: Date, default: null },

    // PRIVATE storage details. Never serialised to any API response (see presentDocument()).
    storage: {
      publicId: { type: String, required: true, select: false },
      format: { type: String, default: "" },
      resourceType: { type: String, default: "image" }
    },
    mime: { type: String, default: "" },
    bytes: { type: Number, default: 0 },
    originalName: { type: String, default: "", maxlength: 120 },

    reviewedBy: { type: ObjectId, ref: "User", default: null },
    reviewedAt: { type: Date, default: null },
    rejectionReason: { type: String, default: "", maxlength: 300 },
    reuploadRequested: { type: Boolean, default: false },
    history: { type: [historyEntry], default: [] }
  },
  { timestamps: true }
);

// A user can hold only ONE current document per type (race-safe, enforced by MongoDB)
documentSchema.index({ owner: 1, type: 1 }, { unique: true, partialFilterExpression: { isCurrent: true } });
documentSchema.index({ owner: 1, createdAt: -1 });
documentSchema.index({ status: 1, createdAt: -1 });

// The overall verification state of one driver/operator, with its own history
const caseSchema = new mongoose.Schema(
  {
    user: { type: ObjectId, ref: "User", required: true, unique: true },
    subjectRole: { type: String, enum: SUBJECT_ROLES, required: true },
    status: { type: String, enum: CASE_STATUS, default: "PENDING" },
    submittedAt: { type: Date, default: null },
    decidedAt: { type: Date, default: null },
    decidedBy: { type: ObjectId, ref: "User", default: null },
    history: { type: [historyEntry], default: [] }
  },
  { timestamps: true }
);

caseSchema.index({ status: 1, updatedAt: -1 });
caseSchema.index({ subjectRole: 1, status: 1 });

export const VerificationDocument = mongoose.model("VerificationDocument", documentSchema);
export const VerificationCase = mongoose.model("VerificationCase", caseSchema);
