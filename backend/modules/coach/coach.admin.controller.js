import { Coach, CoachRoute, CoachSchedule, CoachBooking, CoachOperator } from "./coach.model.js";
import userModel from "../users/user.model.js";
import { str, escapeRegex } from "../../shared/utils/objectId.js";
import { sumField, countByKey } from "../../shared/utils/aggregate.js";
import { createNotification } from "../notifications/notification.service.js";
import { availabilityFor, dayRange, sweepCoachData, cancelBookingRecord, ACTIVE_STATUSES } from "./coach.service.js";
import { bookingView, populateBooking } from "./coach.customer.controller.js";
import { cancelScheduleCore } from "./coach.operator.controller.js";
import { seedDemo, purgeDemo } from "./coach.demo.js";

import { audit } from "../audit/audit.service.js";
import { demoEnabled } from "./coach.service.js";
import { CoachScan } from "./coach.scan.js";
import { CoachOrder, CoachPayment, CoachRefund } from "./coach.order.model.js";
import { operatorSeatMap } from "./coach.opsmap.js";
import { markRefundProcessed } from "./coach.refunds.js";
import { releaseOrder } from "./coach.holds.js";
import { assertDocumentsApproved } from "../verification/verification.service.js";
const fail = (res, status, message) => res.status(status).json({ success: false, message });
const serverError = (res, label, error) => {
  console.error(`${label}:`, error);
  return fail(res, 500, "Something went wrong");
};
const isId = (v) => typeof v === "string" && /^[a-fA-F0-9]{24}$/.test(v);

export async function stats(req, res) {
  try {
    await sweepCoachData();
    const [operators, approved, coaches, routes, scheduled, byStatusRaw, revenueConfirmed, revenueCompleted] = await Promise.all([
      CoachOperator.countDocuments({}),
      userModel.countDocuments({ role: "operator", isVerified: true }),
      Coach.countDocuments({}),
      CoachRoute.countDocuments({}),
      CoachSchedule.countDocuments({ status: "scheduled", departureAt: { $gt: new Date() } }),
      countByKey(CoachBooking, {}, "status"),
      sumField(CoachBooking, { status: "CONFIRMED" }, "fare"),
      sumField(CoachBooking, { status: "COMPLETED" }, "fare")
    ]);

    const byStatus = { HOLD: 0, PENDING_PAYMENT: 0, CONFIRMED: 0, CANCELLED: 0, EXPIRED: 0, COMPLETED: 0, ...byStatusRaw };

    return res.json({
      success: true,
      stats: {
        operators, approvedOperators: approved, pendingOperators: operators - approved,
        coaches, routes, upcomingSchedules: scheduled,
        bookings: byStatus, totalBookings: byStatus.CONFIRMED + byStatus.COMPLETED,
        revenue: revenueConfirmed + revenueCompleted
      }
    });
  } catch (error) {
    return serverError(res, "Coach Admin Stats Error", error);
  }
}

export async function listOperators(req, res) {
  try {
    const filter = {};
    const q = str(req.query.q, 40);
    if (q) filter.companyName = new RegExp(escapeRegex(q), "i");

    const ops = await CoachOperator.find(filter).populate("user", "name email phone isVerified isBlocked createdAt").sort({ createdAt: -1 }).limit(300);
    const ids = ops.map((o) => o._id);
    const [coaches, bookings] = await Promise.all([
      ids.length ? countByKey(Coach, { operator: { $in: ids } }, "operator") : {},
      ids.length ? countByKey(CoachBooking, { operator: { $in: ids }, status: { $ne: "CANCELLED" } }, "operator") : {}
    ]);

    let rows = ops.filter((o) => o.user).map((o) => ({
      _id: o._id, companyName: o.companyName, isDemo: o.isDemo, contactPhone: o.contactPhone, createdAt: o.createdAt,
      user: o.user, approved: o.user.isVerified, blocked: o.user.isBlocked,
      coaches: coaches[o._id.toString()] || 0, bookings: bookings[o._id.toString()] || 0
    }));

    if (req.query.status === "pending") rows = rows.filter((r) => !r.approved);
    if (req.query.status === "approved") rows = rows.filter((r) => r.approved);

    return res.json({ success: true, operators: rows });
  } catch (error) {
    return serverError(res, "List Operators Error", error);
  }
}

export async function approveOperator(req, res) {
  try {
    if (typeof req.body?.approved !== "boolean") return fail(res, 400, "approved must be true or false");

    const op = await CoachOperator.findById(req.params.id);
    if (!op) return fail(res, 404, "Operator not found");

    if (req.body.approved) {
      const gate = await assertDocumentsApproved(op.user);
      if (!gate.ok) return fail(res, 409, gate.message);
    }

    await userModel.updateOne({ _id: op.user, role: "operator" }, { $set: { isVerified: req.body.approved } });
    await audit(req, req.body.approved ? "operator.approved" : "operator.approval_removed", { entityType: "User", entityId: op.user, meta: { operator: String(op._id) } });
    await createNotification(op.user, {
      type: req.body.approved ? "account_verified" : "account_unverified",
      title: req.body.approved ? "Operator account approved" : "Operator approval removed",
      message: req.body.approved ? "You can now add coaches, routes and schedules and start selling seats." : "Your operator account is no longer approved. Contact support."
    });

    return res.json({ success: true, message: req.body.approved ? "Operator approved" : "Operator approval removed" });
  } catch (error) {
    return serverError(res, "Approve Operator Error", error);
  }
}

export async function listCoaches(req, res) {
  try {
    const filter = {};
    if (isId(str(req.query.operatorId, 30))) filter.operator = req.query.operatorId;
    if (req.query.active === "true") filter.isActive = true;
    if (req.query.active === "false") filter.isActive = false;
    const q = str(req.query.q, 40);
    if (q) filter.name = new RegExp(escapeRegex(q), "i");

    const coaches = await Coach.find(filter).populate("operator", "companyName isDemo").sort({ createdAt: -1 }).limit(300);
    return res.json({ success: true, coaches });
  } catch (error) {
    return serverError(res, "Admin List Coaches Error", error);
  }
}

export async function setCoachActive(req, res) {
  try {
    if (typeof req.body?.isActive !== "boolean") return fail(res, 400, "isActive must be true or false");
    const result = await Coach.updateOne({ _id: req.params.id }, { $set: { isActive: req.body.isActive } });
    if (!result.matchedCount) return fail(res, 404, "Coach not found");
    await audit(req, req.body.isActive ? "coach.activated" : "coach.deactivated", { entityType: "Coach", entityId: req.params.id });
    return res.json({ success: true, message: req.body.isActive ? "Coach activated" : "Coach deactivated" });
  } catch (error) {
    return serverError(res, "Admin Set Coach Error", error);
  }
}

export async function listRoutes(req, res) {
  try {
    const filter = {};
    if (isId(str(req.query.operatorId, 30))) filter.operator = req.query.operatorId;
    const q = str(req.query.q, 40);
    if (q) { const rx = new RegExp(escapeRegex(q), "i"); filter.$or = [{ fromCity: rx }, { toCity: rx }]; }
    const routes = await CoachRoute.find(filter).populate("operator", "companyName isDemo").sort({ fromCity: 1, toCity: 1 }).limit(300);
    return res.json({ success: true, routes });
  } catch (error) {
    return serverError(res, "Admin List Routes Error", error);
  }
}

export async function setRouteActive(req, res) {
  try {
    if (typeof req.body?.isActive !== "boolean") return fail(res, 400, "isActive must be true or false");
    const result = await CoachRoute.updateOne({ _id: req.params.id }, { $set: { isActive: req.body.isActive } });
    if (!result.matchedCount) return fail(res, 404, "Route not found");
    return res.json({ success: true, message: req.body.isActive ? "Route activated" : "Route deactivated" });
  } catch (error) {
    return serverError(res, "Admin Set Route Error", error);
  }
}

export async function listSchedules(req, res) {
  try {
    await sweepCoachData();
    const filter = {};
    if (isId(str(req.query.operatorId, 30))) filter.operator = req.query.operatorId;
    if (["scheduled", "cancelled", "completed"].includes(req.query.status)) filter.status = req.query.status;
    const from = dayRange(str(req.query.from, 10));
    const to = dayRange(str(req.query.to, 10));
    if (from || to) filter.departureAt = { ...(from && { $gte: from.start }), ...(to && { $lt: to.end }) };

    const rows = await CoachSchedule.find(filter).populate("operator", "companyName isDemo").populate("coach", "name").sort({ departureAt: -1 }).limit(300);
    const availability = await availabilityFor(rows);

    return res.json({
      success: true,
      schedules: rows.map((s) => ({
        _id: s._id, operator: s.operator ? { _id: s.operator._id, companyName: s.operator.companyName } : null, coach: s.coach?.name,
        fromCity: s.fromCity, toCity: s.toCity, departureAt: s.departureAt, arrivalAt: s.arrivalAt, fare: s.fare, status: s.status,
        totalSeats: s.totalSeats, availableSeats: availability[s._id.toString()], bookedSeats: s.totalSeats - availability[s._id.toString()]
      }))
    });
  } catch (error) {
    return serverError(res, "Admin List Schedules Error", error);
  }
}

export async function cancelSchedule(req, res) {
  try {
    const schedule = await CoachSchedule.findById(req.params.id);
    if (!schedule) return fail(res, 404, "Schedule not found");
    const count = await cancelScheduleCore(schedule, "admin", str(req.body?.reason, 150), req);
    if (count === null) return fail(res, 409, `A ${schedule.status} schedule cannot be cancelled`);
    return res.json({ success: true, message: `Schedule cancelled. ${count} booking(s) cancelled.`, cancelledBookings: count });
  } catch (error) {
    return serverError(res, "Admin Cancel Schedule Error", error);
  }
}

export async function listBookings(req, res) {
  try {
    await sweepCoachData();
    const filter = {};
    if (isId(str(req.query.operatorId, 30))) filter.operator = req.query.operatorId;
    const status = str(req.query.status, 10).toUpperCase();
    if (["HOLD", "PENDING_PAYMENT", "CONFIRMED", "CANCELLED", "EXPIRED", "COMPLETED"].includes(status)) filter.status = status;
    else filter.status = { $in: ["CONFIRMED", "CANCELLED", "COMPLETED"] };
    const day = dayRange(str(req.query.date, 10));
    if (day) filter.departureAt = { $gte: day.start, $lt: day.end };
    const q = str(req.query.q, 40);
    if (q) { const rx = new RegExp(escapeRegex(q), "i"); filter.$or = [{ bookingCode: rx }, { "passenger.name": rx }, { "passenger.phone": rx }]; }

    const rows = await populateBooking(CoachBooking.find(filter).populate("customer", "name phone").sort({ createdAt: -1 }).limit(300));
    return res.json({ success: true, bookings: rows.map(bookingView) });
  } catch (error) {
    return serverError(res, "Admin List Bookings Error", error);
  }
}

export async function cancelBooking(req, res) {
  try {
    const b = await CoachBooking.findById(req.params.id);
    if (!b) return fail(res, 404, "Booking not found");
    if (!ACTIVE_STATUSES.includes(b.status)) return fail(res, 409, `A ${b.status.toLowerCase()} booking cannot be cancelled`);
    const updated = await cancelBookingRecord(b, { by: "admin", reason: str(req.body?.reason, 200), req });
    if (!updated) return fail(res, 409, "This booking was already cancelled");
    return res.json({ success: true, message: "Booking cancelled", booking: bookingView(await populateBooking(CoachBooking.findById(updated._id))) });
  } catch (error) {
    return serverError(res, "Admin Cancel Booking Error", error);
  }
}

export async function seedDemoData(req, res) {
  try {
    if (!demoEnabled()) return fail(res, 403, "Demo data is disabled in this environment (set ALLOW_DEMO_DATA=true to enable it).");
    const password = typeof req.body?.password === "string" && req.body.password.length >= 8 ? req.body.password : undefined;
    const result = await seedDemo(password);
    return res.json({
      success: true,
      message: result.created ? "Demo operator created" : "Demo data refreshed",
      schedulesCreated: result.schedulesCreated,
      // credentials are only returned once, when the account is first created
      credentials: result.created ? { email: result.user.email, password: result.password } : undefined
    });
  } catch (error) {
    return serverError(res, "Seed Demo Error", error);
  }
}

export async function removeDemoData(req, res) {
  try {
    return res.json({ success: true, message: "Demo data removed", ...(await purgeDemo()) });
  } catch (error) {
    return serverError(res, "Remove Demo Error", error);
  }
}

// ==========================================
// SEAT MAP (admin: every schedule)
// ==========================================
export async function seatMapForAdmin(req, res) {
  try {
    const schedule = await CoachSchedule.findById(req.params.id).populate("coach", "name type registrationNumber").populate("operator", "companyName");
    if (!schedule) return fail(res, 404, "Schedule not found");
    const map = await operatorSeatMap(schedule);
    await audit(req, "schedule.seatmap_viewed", { entityType: "Schedule", entityId: schedule._id });
    return res.json({
      success: true,
      schedule: { _id: schedule._id, fromCity: schedule.fromCity, toCity: schedule.toCity, departureAt: schedule.departureAt, arrivalAt: schedule.arrivalAt, fare: schedule.fare, status: schedule.status, operator: schedule.operator?.companyName, coach: schedule.coach && { name: schedule.coach.name, type: schedule.coach.type, registrationNumber: schedule.coach.registrationNumber } },
      ...map
    });
  } catch (error) {
    return serverError(res, "Admin Seat Map Error", error);
  }
}

// ==========================================
// REFUNDS (money owed back to customers) and ORDERS needing attention
// ==========================================
export async function listRefunds(req, res) {
  try {
    const status = str(req.query.status, 10).toUpperCase();
    const filter = ["REQUIRED", "PROCESSED", "FAILED"].includes(status) ? { status } : { status: "REQUIRED" };
    const rows = await CoachRefund.find(filter).sort({ createdAt: 1 }).limit(200).populate("customer", "name phone").populate("order", "orderCode seats").populate("payment", "provider providerRef amount");
    return res.json({ success: true, refunds: rows });
  } catch (error) {
    return serverError(res, "List Refunds Error", error);
  }
}

export async function processRefund(req, res) {
  try {
    const reference = str(req.body?.reference, 80);
    if (reference.length < 3) return fail(res, 400, "Please enter the refund reference from the provider or bank");
    const existing = await CoachRefund.findById(req.params.id);
    if (!existing) return fail(res, 404, "Refund not found");
    const refund = await markRefundProcessed(existing._id, { by: req.user.id, reference });
    return res.json({ success: true, message: "Refund marked as processed", refund });
  } catch (error) {
    return serverError(res, "Process Refund Error", error);
  }
}

export async function listOrders(req, res) {
  try {
    const filter = {};
    const status = str(req.query.status, 16).toUpperCase();
    if (["CREATING", "HOLD", "PENDING_PAYMENT", "CONFIRMED", "CANCELLED", "EXPIRED", "COMPLETED"].includes(status)) filter.status = status;
    if (req.query.attention === "1") filter.needsAttention = true;
    const rows = await CoachOrder.find(filter).sort({ createdAt: -1 }).limit(200).populate("customer", "name phone");
    return res.json({ success: true, orders: rows });
  } catch (error) {
    return serverError(res, "Admin Orders Error", error);
  }
}

// Support: release a stuck hold on behalf of a customer
export async function releaseOrderAsAdmin(req, res) {
  try {
    const prev = await releaseOrder(req.params.id, { by: "admin", reason: str(req.body?.reason, 120) || "Released by admin" });
    if (!prev) return fail(res, 409, "This order is not on hold");
    await audit(req, "order.released", { entityType: "Order", entityId: req.params.id });
    return res.json({ success: true, message: "Hold released" });
  } catch (error) {
    return serverError(res, "Admin Release Order Error", error);
  }
}

// ==========================================
// PAYMENTS (read-only overview for admins). Never exposes provider secrets or raw callback bodies.
// ==========================================
export async function listPayments(req, res) {
  try {
    const filter = {};
    const status = str(req.query.status, 12).toUpperCase();
    if (["PENDING", "PROCESSING", "PAID", "FAILED", "EXPIRED", "PARTIALLY_REFUNDED", "REFUNDED", "CANCELLED"].includes(status)) filter.status = status;
    if (req.query.attention === "1") filter.needsAttention = true;
    const provider = str(req.query.provider, 20).toLowerCase();
    if (provider) filter.provider = provider;

    const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 50, 1), 100);
    const page = Math.max(parseInt(req.query.page, 10) || 1, 1);
    const [rows, total] = await Promise.all([
      CoachPayment.find(filter).sort({ createdAt: -1 }).skip((page - 1) * limit).limit(limit).populate("customer", "name phone").populate("order", "orderCode status seats").select("-checkout -gateway"),
      CoachPayment.countDocuments(filter)
    ]);
    const [paid, refundDue] = await Promise.all([
      CoachPayment.aggregate([{ $match: { status: { $in: ["PAID", "PARTIALLY_REFUNDED", "REFUNDED"] } } }, { $group: { _id: null, total: { $sum: "$amount" }, refunded: { $sum: "$refundedTotal" } } }]),
      CoachRefund.countDocuments({ status: "REQUIRED" })
    ]);
    return res.json({
      success: true, total, page, pages: Math.max(1, Math.ceil(total / limit)),
      summary: { received: paid[0]?.total || 0, refunded: paid[0]?.refunded || 0, refundsRequired: refundDue },
      payments: rows.map((p) => ({ _id: p._id, provider: p.provider, mode: p.mode, reference: p.providerRef, providerTxnId: p.providerTxnId, amount: p.amount, status: p.status, lateSuccess: p.lateSuccess, needsAttention: p.needsAttention, refundedTotal: p.refundedTotal, createdAt: p.createdAt, paidAt: p.paidAt, customer: p.customer, order: p.order, events: (p.events || []).slice(-8) }))
    });
  } catch (error) {
    return serverError(res, "List Payments Error", error);
  }
}

// ==========================================
// BOARDING / QR SCAN RECORDS (read only)
// ==========================================
export async function listScans(req, res) {
  try {
    const filter = {};
    const result = str(req.query.result, 14).toUpperCase();
    if (["VALID", "ALREADY_USED", "CANCELLED", "NOT_FOUND", "EXPIRED", "WRONG_TRIP"].includes(result)) filter.result = result;
    const action = str(req.query.action, 10).toUpperCase();
    if (["VERIFY", "CHECK_IN", "BOARD"].includes(action)) filter.action = action;
    if (/^[a-fA-F0-9]{24}$/.test(str(req.query.scheduleId, 30))) filter.schedule = str(req.query.scheduleId, 30);
    const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 50, 1), 100);
    const page = Math.max(parseInt(req.query.page, 10) || 1, 1);
    const [rows, total, counts] = await Promise.all([
      CoachScan.find(filter).sort({ scannedAt: -1 }).skip((page - 1) * limit).limit(limit).populate("operator", "companyName").populate("scannedBy", "name").populate("booking", "bookingCode seat fromCity toCity"),
      CoachScan.countDocuments(filter),
      CoachScan.aggregate([{ $group: { _id: "$result", n: { $sum: 1 } } }])
    ]);
    return res.json({ success: true, total, page, pages: Math.max(1, Math.ceil(total / limit)), byResult: Object.fromEntries(counts.map((c) => [c._id, c.n])), scans: rows });
  } catch (error) {
    return serverError(res, "List Scans Error", error);
  }
}
