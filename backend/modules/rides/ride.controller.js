import rideModel from "./ride.model.js";
import deliveryModel from "../deliveries/delivery.model.js";
import { makeTripHandlers } from "../../shared/utils/tripFlow.js";
import { str } from "../../shared/utils/objectId.js";
import { makeOffer, decorateWithMyOffer, expireOffers } from "./rideOffer.controller.js";

const VEHICLE_TYPES = ["bike", "rickshaw", "car"];

const handlers = makeTripHandlers({
  Model: rideModel,
  OtherModel: deliveryModel,
  serviceType: "ride",
  single: "ride",
  plural: "rides",
  Label: "Ride",
  idParam: "rideId",

  validateCreate(req) {
    const pickupLocation = str(req.body.pickupLocation, 200);
    const destination = str(req.body.destination, 200);
    const vehicleType = str(req.body.vehicleType, 20).toLowerCase();

    if (!pickupLocation || !destination || !vehicleType || !req.body.offeredFare) {
      return { error: "All fields are required" };
    }

    if (!VEHICLE_TYPES.includes(vehicleType)) return { error: "Invalid vehicle type" };

    return { kind: vehicleType, data: { pickupLocation, destination, vehicleType } };
  },

  decorateAvailable: decorateWithMyOffer,
  onCancel: (ride) => expireOffers(ride._id),

  // Drivers only take rides for their own vehicle type
  driverMatches(driver, ride) {
    const vehicle = (driver.vehicleType || "").toLowerCase();

    if (VEHICLE_TYPES.includes(vehicle) && ride.vehicleType !== vehicle) {
      return `This ride needs a ${ride.vehicleType}, your vehicle is a ${vehicle}`;
    }
    return null;
  }
});

export const createRide = handlers.create;
export const availableRides = handlers.available;
// "Accept" now means: offer to do it at the customer's fare. The customer picks the driver.
export const acceptRide = makeOffer;
export const cancelRide = handlers.cancel;
export const getActiveRide = handlers.active;
export const getMyRides = handlers.mine;
export const getRideHistory = handlers.history;
export const getRideDetails = handlers.details;
export const startRide = handlers.start;
export const completeRide = handlers.complete;
