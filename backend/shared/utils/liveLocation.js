import rideModel from "../../modules/rides/ride.model.js";
import deliveryModel from "../../modules/deliveries/delivery.model.js";
import { emitToUser } from "../realtime/socket.js";

// Sends the driver's newest position to the customer of the driver's active
// ride/delivery ONLY. Nobody else ever receives it.
export async function broadcastDriverLocation(driverId, location) {
  try {
    const active = { driver: driverId, status: { $in: ["accepted", "started"] } };

    const [ride, delivery] = await Promise.all([
      rideModel.findOne(active).select("customer status"),
      deliveryModel.findOne(active).select("customer status")
    ]);

    const payload = {
      latitude: location.latitude,
      longitude: location.longitude,
      accuracy: location.accuracy ?? null,
      updatedAt: location.updatedAt
    };

    if (ride) emitToUser(ride.customer, "driver:location", { serviceType: "ride", serviceId: ride._id, location: payload });
    if (delivery) emitToUser(delivery.customer, "driver:location", { serviceType: "delivery", serviceId: delivery._id, location: payload });
  } catch (error) {
    console.error("Broadcast location failed:", error.message);
  }
}
