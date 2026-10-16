import deliveryModel from "./delivery.model.js";
import rideModel from "../rides/ride.model.js";
import { makeTripHandlers } from "../../shared/utils/tripFlow.js";
import { isValidPhone } from "../../shared/utils/validators.js";
import { str } from "../../shared/utils/objectId.js";

const PARCEL_TYPES = ["document", "food", "clothes", "electronics", "grocery", "other"];
const PARCEL_SIZES = ["small", "medium", "large"];

const handlers = makeTripHandlers({
  Model: deliveryModel,
  OtherModel: rideModel,
  serviceType: "delivery",
  single: "delivery",
  plural: "deliveries",
  Label: "Delivery",
  idParam: "deliveryId",

  validateCreate(req) {
    const pickupLocation = str(req.body.pickupLocation, 200);
    const destination = str(req.body.destination, 200);
    const receiverName = str(req.body.receiverName, 80);
    const receiverPhone = str(req.body.receiverPhone, 20);
    const packageDescription = str(req.body.packageDescription, 300);
    const parcelType = str(req.body.parcelType, 20).toLowerCase() || "other";
    const parcelSize = str(req.body.parcelSize, 10).toLowerCase() || "small";

    if (
      !pickupLocation || !destination || !receiverName ||
      !receiverPhone || !packageDescription || !req.body.offeredFare
    ) {
      return { error: "All fields are required" };
    }

    if (!isValidPhone(receiverPhone)) return { error: "Please enter a valid receiver phone number" };
    if (!PARCEL_TYPES.includes(parcelType)) return { error: "Invalid parcel type" };
    if (!PARCEL_SIZES.includes(parcelSize)) return { error: "Invalid parcel size" };

    return {
      kind: "delivery",
      data: {
        pickupLocation,
        destination,
        receiverName,
        receiverPhone,
        packageDescription,
        parcelType,
        parcelSize
      }
    };
  }
});

export const createDelivery = handlers.create;
export const availableDeliveries = handlers.available;
export const acceptDelivery = handlers.accept;
export const cancelDelivery = handlers.cancel;
export const getActiveDelivery = handlers.active;
export const getMyDeliveries = handlers.mine;
export const getDeliveryHistory = handlers.history;
export const getDeliveryDetails = handlers.details;
export const startDelivery = handlers.start;
export const completeDelivery = handlers.complete;
