import notificationModel from "./notification.model.js";
import userModel from "../users/user.model.js";
import rideModel from "../rides/ride.model.js";
import deliveryModel from "../deliveries/delivery.model.js";
import { emitToUser } from "../../shared/realtime/socket.js";

// Creates the DB record, then pushes it live to that one user only.
// Never throws: a failed notification must not break the ride flow.
export async function createNotification(recipient, data) {
  try {
    const doc = await notificationModel.create({ recipient, ...data });
    emitToUser(recipient, "notification:new", doc.toObject());
    return doc;
  } catch (error) {
    console.error("Create notification failed:", error.message);
    return null;
  }
}

// Notify every eligible driver: verified, not blocked, online, not on a trip,
// and (for rides) driving the requested vehicle type.
export async function notifyEligibleDrivers(serviceType, trip) {
  try {
    const busyFilter = { $in: ["accepted", "started"] };
    const [busyRides, busyDeliveries] = await Promise.all([
      rideModel.distinct("driver", { status: busyFilter }),
      deliveryModel.distinct("driver", { status: busyFilter })
    ]);

    const query = {
      role: "driver",
      isVerified: true,
      isBlocked: false,
      driverStatus: "online",
      _id: { $nin: [...busyRides, ...busyDeliveries].filter(Boolean) }
    };

    if (serviceType === "ride") query.vehicleType = new RegExp(`^${trip.vehicleType}$`, "i");

    const drivers = await userModel.find(query).select("_id");

    const isRide = serviceType === "ride";
    const distanceText = trip.distanceKm ? ` · ${trip.distanceKm} km` : "";

    await Promise.all(
      drivers.map((d) =>
        createNotification(d._id, {
          type: isRide ? "new_ride_request" : "new_delivery_request",
          title: isRide ? "New Ride Request" : "New Delivery Request",
          message: `${trip.pickupLocation} → ${trip.destination} · Rs ${trip.offeredFare}${distanceText}`.slice(0, 400),
          serviceType,
          serviceId: trip._id,
          meta: {
            pickup: trip.pickupLocation,
            destination: trip.destination,
            offeredFare: trip.offeredFare,
            distanceKm: trip.distanceKm ?? null
          }
        })
      )
    );

    return drivers.length;
  } catch (error) {
    console.error("Notify drivers failed:", error.message);
    return 0;
  }
}

// When a request is taken/cancelled, remove the stale "new request" alerts
// from other drivers so nobody taps a dead request.
export async function retractRequestNotifications(serviceType, serviceId, exceptDriverId = null) {
  try {
    const filter = {
      serviceType,
      serviceId,
      type: serviceType === "ride" ? "new_ride_request" : "new_delivery_request"
    };

    const docs = await notificationModel.find(filter).select("recipient");
    await notificationModel.deleteMany(filter);

    docs.forEach((d) => {
      if (exceptDriverId && d.recipient.toString() === exceptDriverId.toString()) return;
      emitToUser(d.recipient, "request:unavailable", { serviceType, serviceId });
    });
  } catch (error) {
    console.error("Retract notifications failed:", error.message);
  }
}
