import express from "express";

import {
  createRide,
  availableRides,
  acceptRide,
  getActiveRide,
  getMyRides,
  getRideHistory,
  getRideDetails,
  cancelRide,
  startRide,
  completeRide
} from "./ride.controller.js";
import { makeOffer, withdrawOffer, listOffers, selectOffer, markArrived } from "./rideOffer.controller.js";

import { authMiddleware } from "../../shared/middleware/auth.middleware.js";
import { validateIdParams } from "../../shared/utils/objectId.js";
import { roleMiddleware } from "../../shared/middleware/role.middleware.js";

import { requestLimiter } from "../../shared/middleware/rateLimit.middleware.js";
const route = express.Router();

route.param("rideId", (req, res, next, value) => validateIdParams("rideId")(req, res, next));


// ==========================================
// CUSTOMER - CREATE RIDE
// ==========================================
route.post(
  "/create",
  authMiddleware,
  roleMiddleware(["customer"]),
  requestLimiter,
  createRide
);


// ==========================================
// CUSTOMER - MY ACTIVE RIDE
// ==========================================
route.get(
  "/my-rides",
  authMiddleware,
  roleMiddleware(["customer"]),
  getMyRides
);


// ==========================================
// CUSTOMER / DRIVER - RIDE HISTORY
// ==========================================
route.get(
  "/history",
  authMiddleware,
  roleMiddleware(["customer", "driver"]),
  getRideHistory
);


// ==========================================
// DRIVER - AVAILABLE RIDES
// ==========================================
route.get(
  "/available",
  authMiddleware,
  roleMiddleware(["driver"]),
  availableRides
);


// ==========================================
// DRIVER - ACCEPT RIDE
// ==========================================
route.patch(
  "/accept/:rideId",
  authMiddleware,
  roleMiddleware(["driver"]),
  acceptRide
);


// ==========================================
// OFFERS (InDrive-style): drivers offer, the customer chooses
// ==========================================
route.post("/:rideId/offer", authMiddleware, roleMiddleware(["driver"]), makeOffer);
route.delete("/:rideId/offer", authMiddleware, roleMiddleware(["driver"]), withdrawOffer);
route.get("/:rideId/offers", authMiddleware, roleMiddleware(["customer"]), listOffers);
route.post("/:rideId/select-offer", authMiddleware, roleMiddleware(["customer"]), selectOffer);
route.patch("/arrived/:rideId", authMiddleware, roleMiddleware(["driver"]), markArrived);


// ==========================================
// DRIVER - ACTIVE RIDE
// ==========================================
route.get(
  "/active",
  authMiddleware,
  roleMiddleware(["driver"]),
  getActiveRide
);


// ==========================================
// DRIVER - START RIDE
// ==========================================
route.patch(
  "/start/:rideId",
  authMiddleware,
  roleMiddleware(["driver"]),
  startRide
);


// ==========================================
// DRIVER - COMPLETE RIDE
// ==========================================
route.patch(
  "/complete/:rideId",
  authMiddleware,
  roleMiddleware(["driver"]),
  completeRide
);


// ==========================================
// CUSTOMER - CANCEL RIDE
// ==========================================
route.patch(
  "/cancel/:rideId",
  authMiddleware,
  roleMiddleware(["customer"]),
  cancelRide
);


// ==========================================
// CUSTOMER / DRIVER / ADMIN - SINGLE RIDE DETAILS
// ==========================================
route.get(
  "/:rideId",
  authMiddleware,
  getRideDetails
);


export default route;