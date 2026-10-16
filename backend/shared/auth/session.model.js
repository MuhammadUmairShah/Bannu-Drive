import mongoose from "mongoose";

const { ObjectId } = mongoose.Schema.Types;

// One document per logged-in device. Only a SHA-256 hash of the refresh token is stored,
// so a database leak cannot be used to resume sessions.
const sessionSchema = new mongoose.Schema(
  {
    user: { type: ObjectId, ref: "User", required: true, index: true },
    family: { type: String, required: true, index: true }, // all rotations of one login share a family
    tokenHash: { type: String, required: true, unique: true },
    expiresAt: { type: Date, required: true },
    persistent: { type: Boolean, default: true },
    revokedAt: { type: Date, default: null },
    revokedReason: { type: String, default: "" },
    replacedBy: { type: ObjectId, ref: "Session", default: null },
    lastUsedAt: { type: Date, default: Date.now },
    ip: { type: String, default: "" },
    userAgent: { type: String, default: "", maxlength: 200 }
  },
  { timestamps: true }
);

// Expired sessions are removed by MongoDB automatically (a week after expiry, for audit/debugging)
sessionSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 7 * 24 * 60 * 60 });
sessionSchema.index({ user: 1, revokedAt: 1 });

export default mongoose.model("Session", sessionSchema);
