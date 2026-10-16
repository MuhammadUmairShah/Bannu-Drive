import express from "express";

import {
  createDelivery,
  availableDeliveries,
  acceptDelivery,
  getActiveDelivery,
  getMyDeliveries,
  getDeliveryHistory,
  getDeliveryDetails,
  cancelDelivery,
  startDelivery,
  completeDelivery
} from "./delivery.controller.js";

import { authMiddleware } from "../../shared/middleware/auth.middleware.js";
import { validateIdParams } from "../../shared/utils/objectId.js";
import { roleMiddleware } from "../../shared/middleware/role.middleware.js";

import { requestLimiter } from "../../shared/middleware/rateLimit.middleware.js";
const route = express.Router();

route.param("deliveryId", (req, res, next, value) => validateIdParams("deliveryId")(req, res, next));


// ==========================================
// CUSTOMER - CREATE DELIVERY
// ==========================================
route.post(
  "/create",
  authMiddleware,
  roleMiddleware(["customer"]),
  requestLimiter,
  createDelivery
);


// ==========================================
// CUSTOMER - MY ACTIVE DELIVERY
// ==========================================
route.get(
  "/my-deliveries",
  authMiddleware,
  roleMiddleware(["customer"]),
  getMyDeliveries
);


// ==========================================
// CUSTOMER / DRIVER - DELIVERY HISTORY
// ==========================================
route.get(
  "/history",
  authMiddleware,
  roleMiddleware(["customer", "driver"]),
  getDeliveryHistory
);


// ==========================================
// DRIVER - AVAILABLE DELIVERIES
// ==========================================
route.get(
  "/available",
  authMiddleware,
  roleMiddleware(["driver"]),
  availableDeliveries
);


// ==========================================
// DRIVER - ACCEPT DELIVERY
// ==========================================
route.patch(
  "/accept/:deliveryId",
  authMiddleware,
  roleMiddleware(["driver"]),
  acceptDelivery
);


// ==========================================
// DRIVER - ACTIVE DELIVERY
// ==========================================
route.get(
  "/active",
  authMiddleware,
  roleMiddleware(["driver"]),
  getActiveDelivery
);


// ==========================================
// DRIVER - START DELIVERY
// ==========================================
route.patch(
  "/start/:deliveryId",
  authMiddleware,
  roleMiddleware(["driver"]),
  startDelivery
);


// ==========================================
// DRIVER - COMPLETE DELIVERY
// ==========================================
route.patch(
  "/complete/:deliveryId",
  authMiddleware,
  roleMiddleware(["driver"]),
  completeDelivery
);


// ==========================================
// CUSTOMER - CANCEL DELIVERY
// ==========================================
route.patch(
  "/cancel/:deliveryId",
  authMiddleware,
  roleMiddleware(["customer"]),
  cancelDelivery
);


// ==========================================
// CUSTOMER / DRIVER / ADMIN - SINGLE DELIVERY DETAILS
// ==========================================
route.get(
  "/:deliveryId",
  authMiddleware,
  getDeliveryDetails
);


export default route;
