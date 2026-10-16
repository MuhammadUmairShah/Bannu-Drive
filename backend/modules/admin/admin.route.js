import express from "express";

import {
  getDashboardStats,
  getCustomers,
  getDrivers,
  getUserDetails,
  setUserBlockedStatus,
  verifyDriver,
  getAllRides,
  getAllDeliveries,
  getAllRatings,
  getReports
} from "./admin.controller.js";

import { authMiddleware } from "../../shared/middleware/auth.middleware.js";
import { roleMiddleware } from "../../shared/middleware/role.middleware.js";
import { adminActionLimiter, onlyWrites } from "../../shared/middleware/rateLimit.middleware.js";
import { listAuditLogs } from "../audit/audit.controller.js";
import { validateIdParams } from "../../shared/utils/objectId.js";

const route = express.Router();

route.param("userId", (req, res, next, value) => validateIdParams("userId")(req, res, next));

// All admin routes require an authenticated admin
route.use(authMiddleware, roleMiddleware(["admin"]), onlyWrites(adminActionLimiter));


// ==========================================
// DASHBOARD STATISTICS
// ==========================================
route.get("/stats", getDashboardStats);


// ==========================================
// CUSTOMERS
// ==========================================
route.get("/customers", getCustomers);


// ==========================================
// DRIVERS
// ==========================================
route.get("/drivers", getDrivers);


// ==========================================
// SINGLE USER DETAILS
// ==========================================
route.get("/user/:userId", getUserDetails);


// ==========================================
// ACTIVATE / BLOCK USER
// ==========================================
route.patch("/user/:userId/block", setUserBlockedStatus);


// ==========================================
// VERIFY DRIVER
// ==========================================
route.patch("/user/:userId/verify", verifyDriver);


// ==========================================
// RIDES
// ==========================================
route.get("/rides", getAllRides);


// ==========================================
// DELIVERIES
// ==========================================
route.get("/deliveries", getAllDeliveries);


// ==========================================
// RATINGS MONITORING
// ==========================================
route.get("/ratings", getAllRatings);


// ==========================================
// AUDIT LOG (read only)
// ==========================================
route.get("/audit-logs", listAuditLogs);


// ==========================================
// REPORTS
// ==========================================
route.get("/reports", getReports);


export default route;
