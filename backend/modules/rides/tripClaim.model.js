import mongoose from "mongoose";

// One claim per booking, enforced by a UNIQUE index. A driver must insert the claim BEFORE
// the booking is updated, so even if two drivers tap "Accept" in the same millisecond the
// database itself lets exactly one insert succeed. (The status update is then a formality.)
const tripClaimSchema = new mongoose.Schema(
  {
    serviceType: { type: String, enum: ["ride", "delivery"], required: true },
    serviceId: { type: mongoose.Schema.Types.ObjectId, required: true },
    driver: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true }
  },
  { timestamps: true }
);

tripClaimSchema.index({ serviceType: 1, serviceId: 1 }, { unique: true });

export default mongoose.model("TripClaim", tripClaimSchema);
