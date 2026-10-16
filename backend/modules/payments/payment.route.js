import express from "express";

import {
  getSettings,
  updateSettings,
  getMyTransactions,
  getAllTransactions,
  estimateFare
} from "./payment.controller.js";

import { authMiddleware } from "../../shared/middleware/auth.middleware.js";
import { roleMiddleware } from "../../shared/middleware/role.middleware.js";

import { paymentLimiter } from "../../shared/middleware/rateLimit.middleware.js";
const route = express.Router();


// ==========================================
// ADMIN - COMMISSION SETTINGS
// ==========================================
route.get(
  "/settings",
  authMiddleware,
  roleMiddleware(["admin"]),
  getSettings
);

route.patch(
  "/settings",
  authMiddleware,
  roleMiddleware(["admin"]),
  paymentLimiter,
  updateSettings
);


// ==========================================
// CUSTOMER - FARE ESTIMATE
// ==========================================
route.post(
  "/estimate",
  authMiddleware,
  roleMiddleware(["customer"]),
  paymentLimiter,
  estimateFare
);


// ==========================================
// DRIVER - MY TRANSACTIONS / EARNINGS
// ==========================================
route.get(
  "/my-transactions",
  authMiddleware,
  roleMiddleware(["driver"]),
  getMyTransactions
);


// ==========================================
// ADMIN - ALL TRANSACTIONS
// ==========================================
route.get(
  "/all",
  authMiddleware,
  roleMiddleware(["admin"]),
  getAllTransactions
);


export default route;
