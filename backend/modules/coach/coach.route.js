import express from "express";
import { authMiddleware } from "../../shared/middleware/auth.middleware.js";
import { roleMiddleware } from "../../shared/middleware/role.middleware.js";
import { validateIdParams } from "../../shared/utils/objectId.js";
import { bookingLimiter, paymentLimiter, publicReadLimiter, paymentCallbackLimiter, qrVerifyLimiter, trackingLimiter, trackReadLimiter, adminActionLimiter, onlyWrites } from "../../shared/middleware/rateLimit.middleware.js";
import { operatorContext, requireApproved } from "./operator.middleware.js";
import * as customer from "./coach.customer.controller.js";
import * as operator from "./coach.operator.controller.js";
import * as admin from "./coach.admin.controller.js";
import * as orders from "./coach.order.controller.js";
import * as trip from "./coach.trip.controller.js";
import * as manual from "./coach.manual.controller.js";

const route = express.Router();

for (const name of ["id", "scheduleId", "bookingId", "orderId"]) {
  route.param(name, (req, res, next) => validateIdParams(name)(req, res, next));
}

const auth = authMiddleware;
const only = (...roles) => roleMiddleware(roles);

// ---------------- public (no login): browse trips and see seat availability. Nothing personal is ever returned ----------------
route.get("/public/cities", publicReadLimiter, customer.listCities);
route.get("/public/search", publicReadLimiter, customer.searchSchedules);
route.get("/public/schedules/:scheduleId", publicReadLimiter, customer.getScheduleWithSeats);

// ---------------- payment provider callbacks: no login, authenticated by the provider's signature ----------------
route.post("/payments/callback/:provider", paymentCallbackLimiter, orders.paymentCallback);

// ---------------- customer ----------------
route.get("/cities", auth, only("customer"), customer.listCities);
route.get("/search", auth, only("customer"), customer.searchSchedules);
route.get("/schedules/:scheduleId", auth, only("customer"), customer.getScheduleWithSeats);
route.post("/bookings", auth, only("customer"), bookingLimiter, customer.createBooking);
route.get("/payment-options", auth, only("customer"), orders.paymentOptions);
route.post("/orders", auth, only("customer"), bookingLimiter, orders.createOrder);
route.get("/orders/active", auth, only("customer"), orders.activeOrders);
route.get("/orders/:orderId", auth, only("customer"), orders.getOrder);
route.post("/orders/:orderId/extend", auth, only("customer"), bookingLimiter, orders.extendOrder);
route.post("/orders/:orderId/release", auth, only("customer"), bookingLimiter, orders.releaseMyOrder);
route.post("/orders/:orderId/pay", auth, only("customer"), paymentLimiter, orders.payOrder);
route.post("/orders/:orderId/sync", auth, only("customer"), paymentLimiter, orders.syncOrder);
route.post("/orders/:orderId/payment-proof", auth, only("customer"), paymentLimiter, manual.receiptUpload, manual.submitPaymentProof);
route.get("/manual-payments/:id/receipt", auth, only("customer", "operator", "admin"), paymentLimiter, manual.getReceipt);
route.get("/payments/mock/:ref", auth, only("customer"), orders.mockPaymentInfo);
route.post("/payments/mock/:ref/complete", auth, only("customer"), paymentLimiter, orders.mockPaymentComplete);
route.get("/bookings/mine", auth, only("customer"), customer.myBookings);
route.get("/bookings/:bookingId", auth, only("customer", "operator", "admin"), customer.getBooking);
route.patch("/bookings/:bookingId/cancel", auth, only("customer"), bookingLimiter, customer.cancelMyBooking);

// ---------------- operator (every handler filters by req.operator.id) ----------------
const op = [auth, only("operator"), operatorContext];
const opWrite = [...op, requireApproved];

route.get("/operator/me", ...op, operator.getMe);
route.patch("/operator/me", ...opWrite, operator.updateMe);
route.get("/operator/dashboard", ...op, operator.dashboard);
route.get("/operator/reports", ...op, operator.reports);

route.get("/operator/coaches", ...op, operator.listCoaches);
route.post("/operator/coaches", ...opWrite, operator.createCoach);
route.patch("/operator/coaches/:id", ...opWrite, operator.updateCoach);

route.get("/operator/routes", ...op, operator.listRoutes);
route.post("/operator/routes", ...opWrite, operator.createRoute);
route.patch("/operator/routes/:id", ...opWrite, operator.updateRoute);

route.get("/operator/schedules", ...op, operator.listSchedules);
route.post("/operator/schedules", ...opWrite, operator.createSchedule);
route.patch("/operator/schedules/:id", ...opWrite, operator.updateSchedule);
route.patch("/operator/schedules/:id/cancel", ...opWrite, operator.cancelSchedule);

route.get("/operator/bookings", ...op, operator.listBookings);
route.get("/operator/passengers", ...op, operator.passengers);
route.patch("/operator/bookings/:id/cancel", ...opWrite, operator.cancelBookingByOperator);
route.patch("/operator/bookings/:id/collect-cash", ...opWrite, operator.collectCash);
route.get("/operator/payments", ...op, manual.operatorListPayments);
route.patch("/operator/payments/:id/approve", ...opWrite, manual.operatorApprove);
route.patch("/operator/payments/:id/reject", ...opWrite, manual.operatorReject);
route.put("/operator/routes/:id/stops", ...opWrite, trip.setRouteStopsOperator);
route.patch("/operator/schedules/:id/trip-state", ...opWrite, trip.setTripState);
route.patch("/operator/schedules/:id/delay", ...opWrite, trip.setDelay);
route.post("/operator/schedules/:id/location", ...opWrite, trackingLimiter, trip.postLocation);
route.get("/operator/schedules/:id/track", ...op, trackReadLimiter, trip.trackForOperator);
route.get("/bookings/:bookingId/track", auth, only("customer"), trackReadLimiter, trip.trackForCustomer);
route.post("/operator/scan", ...op, qrVerifyLimiter, operator.scanTicket);
route.get("/operator/scans", ...op, operator.recentScans);
route.get("/operator/schedules/:id/seatmap", ...op, operator.seatMapForOperator);
route.patch("/operator/schedules/:id/seats/:seat/block", ...opWrite, operator.setSeatBlocked);

// ---------------- admin ----------------
const adm = [auth, only("admin"), onlyWrites(adminActionLimiter)];
route.get("/admin/stats", ...adm, admin.stats);
route.get("/admin/operators", ...adm, admin.listOperators);
route.patch("/admin/operators/:id/approve", ...adm, admin.approveOperator);
route.get("/admin/coaches", ...adm, admin.listCoaches);
route.patch("/admin/coaches/:id/active", ...adm, admin.setCoachActive);
route.get("/admin/routes", ...adm, admin.listRoutes);
route.patch("/admin/routes/:id/active", ...adm, admin.setRouteActive);
route.get("/admin/schedules", ...adm, admin.listSchedules);
route.patch("/admin/schedules/:id/cancel", ...adm, admin.cancelSchedule);
route.get("/admin/bookings", ...adm, admin.listBookings);
route.patch("/admin/bookings/:id/cancel", ...adm, admin.cancelBooking);
route.get("/admin/schedules/:id/seatmap", ...adm, admin.seatMapForAdmin);
route.put("/admin/routes/:id/stops", ...adm, trip.setRouteStopsAdmin);
route.get("/admin/scans", ...adm, admin.listScans);
route.get("/admin/payments", ...adm, admin.listPayments);
route.get("/admin/refunds", ...adm, admin.listRefunds);
route.patch("/admin/refunds/:id/processed", ...adm, admin.processRefund);
route.get("/admin/orders", ...adm, admin.listOrders);
route.post("/admin/orders/:id/release", ...adm, admin.releaseOrderAsAdmin);
route.post("/admin/demo/seed", ...adm, admin.seedDemoData);
route.delete("/admin/demo", ...adm, admin.removeDemoData);

export default route;
