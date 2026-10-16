import rideModel from "./ride.model.js";
import deliveryModel from "../deliveries/delivery.model.js";
import offerModel from "./rideOffer.model.js";
import userModel from "../users/user.model.js";
import { checkDriverEligibility } from "../../shared/utils/driverRules.js";
import { assignDriverToTrip } from "../../shared/utils/assignDriver.js";
import { presentTrips } from "../../shared/utils/presenter.js";
import { distanceKm, etaMinutes } from "../../shared/utils/geoMath.js";
import { countByKey } from "../../shared/utils/aggregate.js";
import { getDriverRatingMap } from "../ratings/rating.service.js";
import { createNotification, retractRequestNotifications } from "../notifications/notification.service.js";
import { emitToUser } from "../../shared/realtime/socket.js";

const VEHICLE_TYPES = ["bike", "rickshaw", "car"];
const fail = (res, status, message) => res.status(status).json({ success: false, message });
const serverError = (res, label, error) => {
  console.error(`${label}:`, error);
  return fail(res, 500, "Something went wrong");
};

// Expire every pending offer of a ride (cancel / taken by someone else)
export const expireOffers = (rideId) =>
  offerModel.updateMany({ ride: rideId, status: "pending" }, { $set: { status: "withdrawn" } });

// ==========================================
// DRIVER - accept the customer's fare OR counter-offer
// ==========================================
export async function makeOffer(req, res) {
  try {
    const eligibility = await checkDriverEligibility(req.user.id, { requireIdle: true });
    if (!eligibility.ok) return fail(res, eligibility.status, eligibility.message);

    const ride = await rideModel.findById(req.params.rideId);
    if (!ride) return fail(res, 404, "Ride not found");
    if (ride.status !== "pending") return fail(res, 409, "This ride is no longer available");

    const vehicle = (eligibility.driver.vehicleType || "").toLowerCase();
    if (VEHICLE_TYPES.includes(vehicle) && ride.vehicleType !== vehicle) {
      return fail(res, 403, `This ride needs a ${ride.vehicleType}, your vehicle is a ${vehicle}`);
    }

    // No fare sent = "I accept the customer's fare"
    const raw = req.body?.fare;
    let fare = ride.offeredFare;

    if (raw !== undefined && raw !== null && raw !== "") {
      fare = Number(raw);
      if (!Number.isInteger(fare) || fare < 1 || fare > 100000) {
        return fail(res, 400, "Fare must be a whole number between 1 and 100000");
      }
    }

    const kind = fare === ride.offeredFare ? "accept" : "counter";
    const km = distanceKm(eligibility.driver.currentLocation, ride.pickupCoords);

    await offerModel.updateOne(
      { ride: ride._id, driver: req.user.id },
      { $set: { fare, kind, status: "pending", distanceToPickupKm: km } },
      { upsert: true }
    );
    const offer = await offerModel.findOne({ ride: ride._id, driver: req.user.id });

    // The ride may have been taken / cancelled while we were writing
    const fresh = await rideModel.findById(ride._id).select("status");
    if (!fresh || fresh.status !== "pending") {
      await offerModel.updateOne({ _id: offer._id }, { $set: { status: "withdrawn" } });
      return fail(res, 409, "This ride is no longer available");
    }

    await createNotification(ride.customer, {
      type: "ride_offer",
      title: kind === "accept" ? "Driver accepted your fare" : "New driver offer",
      message: `${eligibility.driver.name} ${kind === "accept" ? "will do it for" : "offers"} Rs ${fare}`,
      serviceType: "ride",
      serviceId: ride._id
    });
    emitToUser(ride.customer, "ride:offers", { rideId: ride._id });

    return res.json({
      success: true,
      message: kind === "accept" ? "Your offer was sent at the customer's fare" : "Counter-offer sent",
      offer
    });
  } catch (error) {
    return serverError(res, "Make Offer Error", error);
  }
}

// ==========================================
// DRIVER - withdraw my offer
// ==========================================
export async function withdrawOffer(req, res) {
  try {
    const result = await offerModel.updateOne(
      { ride: req.params.rideId, driver: req.user.id, status: "pending" },
      { $set: { status: "withdrawn" } }
    );
    if (!result.matchedCount) return fail(res, 404, "No pending offer found");

    const ride = await rideModel.findById(req.params.rideId).select("customer");
    if (ride) emitToUser(ride.customer, "ride:offers", { rideId: ride._id });

    return res.json({ success: true, message: "Offer withdrawn" });
  } catch (error) {
    return serverError(res, "Withdraw Offer Error", error);
  }
}

// Attach the logged-in driver's own offer to each available ride
export async function decorateWithMyOffer(rides, driverId) {
  if (!rides.length) return rides;

  const offers = await offerModel.find({
    driver: driverId,
    ride: { $in: rides.map((r) => r._id) },
    status: "pending"
  });
  const byRide = Object.fromEntries(offers.map((o) => [o.ride.toString(), { _id: o._id, fare: o.fare, kind: o.kind }]));

  return rides.map((r) => ({ ...r, myOffer: byRide[r._id.toString()] || null }));
}

// ==========================================
// CUSTOMER - list offers for my pending ride
// ==========================================
export async function listOffers(req, res) {
  try {
    const ride = await rideModel.findOne({ _id: req.params.rideId, customer: req.user.id });
    if (!ride) return fail(res, 404, "Ride not found");

    if (ride.status !== "pending") return res.json({ success: true, offers: [], rideStatus: ride.status });

    const offers = await offerModel
      .find({ ride: ride._id, status: "pending" })
      .populate("driver", "name profileImage vehicleType vehicleModel vehicleNumber isVerified isBlocked driverStatus");

    // Only drivers who can actually take the ride right now
    const busy = new Set([
      ...(await rideModel.distinct("driver", { status: { $in: ["accepted", "started"] } })),
      ...(await deliveryModel.distinct("driver", { status: { $in: ["accepted", "started"] } }))
    ].filter(Boolean).map(String));

    const live = offers.filter(
      (o) => o.driver && o.driver.isVerified && !o.driver.isBlocked && o.driver.driverStatus === "online" && !busy.has(o.driver._id.toString())
    );

    const ids = live.map((o) => o.driver._id);
    const [ratings, completed] = await Promise.all([
      getDriverRatingMap(ids),
      ids.length ? countByKey(rideModel, { driver: { $in: ids }, status: "completed" }, "driver") : {}
    ]);

    const cards = live
      .map((o) => ({
        _id: o._id,
        fare: o.fare,
        kind: o.kind,
        createdAt: o.createdAt,
        distanceToPickupKm: o.distanceToPickupKm,
        etaMin: etaMinutes(o.distanceToPickupKm),
        driver: {
          _id: o.driver._id,
          name: o.driver.name,
          profileImage: o.driver.profileImage || "",
          vehicleType: o.driver.vehicleType,
          vehicleModel: o.driver.vehicleModel,
          vehicleNumber: o.driver.vehicleNumber,
          rating: ratings[o.driver._id.toString()] || { average: 0, count: 0 },
          completedRides: completed[o.driver._id.toString()] || 0
        }
      }))
      .sort((a, b) => a.fare - b.fare || (a.distanceToPickupKm ?? 99) - (b.distanceToPickupKm ?? 99));

    return res.json({ success: true, offers: cards, rideStatus: ride.status, offeredFare: ride.offeredFare });
  } catch (error) {
    return serverError(res, "List Offers Error", error);
  }
}

// ==========================================
// CUSTOMER - choose ONE offer (atomic assignment)
// ==========================================
export async function selectOffer(req, res) {
  try {
    const offerId = typeof req.body?.offerId === "string" ? req.body.offerId : "";
    if (!/^[a-fA-F0-9]{24}$/.test(offerId)) return fail(res, 400, "A valid offerId is required");

    const ride = await rideModel.findOne({ _id: req.params.rideId, customer: req.user.id });
    if (!ride) return fail(res, 404, "Ride not found");
    if (ride.status !== "pending") return fail(res, 409, "This ride already has a driver or was cancelled");

    const offer = await offerModel.findOne({ _id: offerId, ride: ride._id });
    if (!offer) return fail(res, 404, "Offer not found");
    if (offer.status !== "pending") return fail(res, 409, "That offer is no longer available");

    const eligibility = await checkDriverEligibility(offer.driver, { requireIdle: true });
    if (!eligibility.ok) {
      await offerModel.updateOne({ _id: offer._id }, { $set: { status: "withdrawn" } });
      emitToUser(req.user.id, "ride:offers", { rideId: ride._id });
      return fail(res, 409, "That driver is no longer available. Please choose another offer.");
    }

    const assigned = await assignDriverToTrip({
      Model: rideModel,
      OtherModel: deliveryModel,
      serviceType: "ride",
      id: ride._id,
      driverId: offer.driver,
      extraSet: { agreedFare: offer.fare }
    });
    if (!assigned.ok) {
      if (assigned.message.includes("another trip")) {
        await offerModel.updateOne({ _id: offer._id }, { $set: { status: "withdrawn" } });
      }
      return fail(res, assigned.status, assigned.message);
    }

    await offerModel.updateOne({ _id: offer._id }, { $set: { status: "selected" } });
    await offerModel.updateMany({ ride: ride._id, _id: { $ne: offer._id }, status: "pending" }, { $set: { status: "rejected" } });

    // Everyone else's "new request" alert disappears
    await retractRequestNotifications("ride", ride._id, offer.driver);

    const customer = await userModel.findById(req.user.id).select("name");

    await createNotification(offer.driver, {
      type: "driver_selected",
      title: "You were selected!",
      message: `${customer?.name || "A customer"} chose you: ${ride.pickupLocation} → ${ride.destination} · Rs ${offer.fare}`.slice(0, 400),
      serviceType: "ride",
      serviceId: ride._id,
      meta: { pickup: ride.pickupLocation, destination: ride.destination, offeredFare: offer.fare }
    });
    emitToUser(offer.driver, "ride:updated", { serviceId: ride._id, status: "accepted" });

    await createNotification(ride.customer, {
      type: "ride_accepted",
      title: "Driver confirmed",
      message: `${eligibility.driver.name} is on the way. Fare: Rs ${offer.fare}.`,
      serviceType: "ride",
      serviceId: ride._id
    });
    emitToUser(ride.customer, "ride:updated", { serviceId: ride._id, status: "accepted" });

    const populated = await rideModel
      .findById(ride._id)
      .populate("customer", "name phone")
      .populate("driver", "name phone profileImage vehicleType vehicleModel vehicleNumber currentLocation");

    return res.json({ success: true, message: "Driver selected", ride: await presentTrips(populated) });
  } catch (error) {
    return serverError(res, "Select Offer Error", error);
  }
}

// ==========================================
// DRIVER - "I've arrived" at pickup (starts the customer's waiting timer)
// ==========================================
export async function markArrived(req, res) {
  try {
    const ride = await rideModel.findOneAndUpdate(
      { _id: req.params.rideId, driver: req.user.id, status: "accepted", arrivedAt: null },
      { $set: { arrivedAt: new Date() } },
      { new: true }
    );

    if (!ride) {
      const exists = await rideModel.findById(req.params.rideId).select("driver status arrivedAt");
      if (!exists) return fail(res, 404, "Ride not found");
      if (!exists.driver || exists.driver.toString() !== req.user.id) return fail(res, 403, "You are not assigned to this ride");
      return fail(res, 409, exists.arrivedAt ? "You already marked arrival" : "Arrival can only be marked before the ride starts");
    }

    await createNotification(ride.customer, {
      type: "driver_arrived",
      title: "Your driver has arrived",
      message: `Your driver is waiting at ${ride.pickupLocation}.`,
      serviceType: "ride",
      serviceId: ride._id
    });
    emitToUser(ride.customer, "ride:updated", { serviceId: ride._id, status: "accepted", arrived: true });

    return res.json({ success: true, message: "Customer notified", arrivedAt: ride.arrivedAt });
  } catch (error) {
    return serverError(res, "Mark Arrived Error", error);
  }
}
