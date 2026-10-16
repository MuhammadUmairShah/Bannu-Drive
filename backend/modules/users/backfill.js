import rideModel from "../rides/ride.model.js";
import deliveryModel from "../deliveries/delivery.model.js";

// Bookings created before the lock fields existed need them once, so the unique indexes protect them too.
export async function backfillActiveLocks() {
  for (const Model of [rideModel, deliveryModel]) {
    const docs = await Model.find({
      status: { $in: ["pending", "accepted", "started"] },
      activeCustomer: { $exists: false }
    }).select("customer driver status");

    for (const doc of docs) {
      try {
        await Model.updateOne(
          { _id: doc._id },
          { $set: { activeCustomer: doc.customer, ...(doc.driver ? { activeDriver: doc.driver } : {}) } }
        );
      } catch (error) {
        if (error.code === 11000) {
          // An older duplicate already exists for this customer/driver: close the extra one
          await Model.updateOne({ _id: doc._id }, { $set: { status: "cancelled", cancelledAt: new Date() } });
          console.warn(`Backfill: cancelled duplicate active booking ${doc._id}`);
        } else {
          console.error("Backfill error:", error.message);
        }
      }
    }
  }
}
