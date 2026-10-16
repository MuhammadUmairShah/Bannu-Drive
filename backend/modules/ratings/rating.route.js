import express from "express";

import {
  submitRating,
  getRatableServices,
  getReceivedRatings
} from "./rating.controller.js";

import { authMiddleware } from "../../shared/middleware/auth.middleware.js";
import { roleMiddleware } from "../../shared/middleware/role.middleware.js";

import { requestLimiter } from "../../shared/middleware/rateLimit.middleware.js";
const route = express.Router();


// ==========================================
// CUSTOMER - SUBMIT RATING
// ==========================================
route.post(
  "/submit",
  authMiddleware,
  roleMiddleware(["customer"]),
  requestLimiter,
  submitRating
);


// ==========================================
// CUSTOMER - COMPLETED SERVICES NOT YET RATED
// ==========================================
route.get(
  "/ratable",
  authMiddleware,
  roleMiddleware(["customer"]),
  getRatableServices
);


// ==========================================
// DRIVER - RECEIVED RATINGS
// ==========================================
route.get(
  "/received",
  authMiddleware,
  roleMiddleware(["driver"]),
  getReceivedRatings
);


export default route;
