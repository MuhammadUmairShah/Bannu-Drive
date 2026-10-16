import express from "express";

import {
  submitComplaint,
  getMyComplaints,
  getAllComplaints,
  updateComplaintStatus
} from "./complaint.controller.js";

import { authMiddleware } from "../../shared/middleware/auth.middleware.js";
import { validateIdParams } from "../../shared/utils/objectId.js";
import { roleMiddleware } from "../../shared/middleware/role.middleware.js";

import { requestLimiter } from "../../shared/middleware/rateLimit.middleware.js";
const route = express.Router();


// ==========================================
// CUSTOMER - SUBMIT COMPLAINT
// ==========================================
route.post(
  "/submit",
  authMiddleware,
  roleMiddleware(["customer"]),
  requestLimiter,
  submitComplaint
);


// ==========================================
// CUSTOMER - MY COMPLAINTS
// ==========================================
route.get(
  "/my-complaints",
  authMiddleware,
  roleMiddleware(["customer"]),
  getMyComplaints
);


// ==========================================
// ADMIN - ALL COMPLAINTS
// ==========================================
route.get(
  "/all",
  authMiddleware,
  roleMiddleware(["admin"]),
  getAllComplaints
);


// ==========================================
// ADMIN - UPDATE STATUS
// ==========================================
route.patch(
  "/status/:complaintId",
  validateIdParams("complaintId"),
  authMiddleware,
  roleMiddleware(["admin"]),
  updateComplaintStatus
);


export default route;
