import mongoose from "mongoose";

// A driver's response to a ride request: either "I accept your fare" or a counter-offer.
// The customer then selects exactly ONE offer.
const rideOfferSchema = new mongoose.Schema(
  {
    ride: { type: mongoose.Schema.Types.ObjectId, ref: "Ride", required: true },
    driver: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    fare: { type: Number, required: true, min: 1, max: 100000 },
    kind: { type: String, enum: ["accept", "counter"], required: true },
    status: { type: String, enum: ["pending", "selected", "rejected", "withdrawn"], default: "pending" },
    // Driver -> pickup distance when the offer was made (for the customer's "how far is he" info)
    distanceToPickupKm: { type: Number, default: null }
  },
  { timestamps: true }
);

// One live offer per driver per ride (re-offering simply updates it)
rideOfferSchema.index({ ride: 1, driver: 1 }, { unique: true });
rideOfferSchema.index({ ride: 1, status: 1 });
rideOfferSchema.index({ driver: 1, status: 1 });

export default mongoose.model("RideOffer", rideOfferSchema);
