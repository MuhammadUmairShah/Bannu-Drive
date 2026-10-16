import mongoose from "mongoose";

export const NOTIFICATION_TYPES = [
  "new_ride_request",
  "new_delivery_request",
  "ride_offer",
  "driver_selected",
  "driver_arrived",
  "ride_accepted",
  "ride_started",
  "ride_completed",
  "ride_cancelled",
  "delivery_accepted",
  "delivery_started",
  "delivery_completed",
  "delivery_cancelled",
  "complaint_updated",
  "coach_booking_new",
  "coach_booking_confirmed",
  "coach_booking_cancelled",
  "account_verified",
  "account_unverified",
  "document_approved",
  "document_rejected",
  "verification_update",
  "coach_hold_expired",
  "coach_payment_success",
  "coach_payment_failed",
  "coach_refund_required",
  "coach_late_payment",
  "coach_trip_update",
  "coach_boarding_reminder",
  "coach_hold_expiring"
];

const notificationSchema = new mongoose.Schema(
  {
    recipient: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
    type: { type: String, enum: NOTIFICATION_TYPES, required: true },
    title: { type: String, required: true, trim: true, maxlength: 120 },
    message: { type: String, required: true, trim: true, maxlength: 400 },
    serviceType: { type: String, enum: ["ride", "delivery", "complaint", "coach_booking", null], default: null },
    serviceId: { type: mongoose.Schema.Types.ObjectId, default: null },
    meta: {
      pickup: { type: String, default: "" },
      destination: { type: String, default: "" },
      offeredFare: { type: Number, default: null },
      distanceKm: { type: Number, default: null }
    },
    read: { type: Boolean, default: false }
  },
  { timestamps: true }
);

notificationSchema.index({ recipient: 1, read: 1, createdAt: -1 });
// Old notifications clean themselves up after 30 days
notificationSchema.index({ createdAt: 1 }, { expireAfterSeconds: 60 * 60 * 24 * 30 });

export default mongoose.model("Notification", notificationSchema);
