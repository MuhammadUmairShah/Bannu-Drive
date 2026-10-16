import userModel from "../users/user.model.js";
import { audit } from "../audit/audit.service.js";
import { assertDocumentsApproved } from "../verification/verification.service.js";
import { revokeAllForUser } from "../../shared/auth/session.service.js";
import { disconnectUser } from "../../shared/realtime/socket.js";
import rideModel from "../rides/ride.model.js";
import deliveryModel from "../deliveries/delivery.model.js";
import complaintModel from "../complaints/complaint.model.js";
import ratingModel from "../ratings/rating.model.js";
import transactionModel from "../payments/payment.model.js";
import { getDriverRatingMap, getDriverRatingSummary } from "../ratings/rating.service.js";
import { createNotification } from "../notifications/notification.service.js";
import { str, escapeRegex } from "../../shared/utils/objectId.js";
import { sumField, countByKey } from "../../shared/utils/aggregate.js";

const STATUSES = ["pending", "accepted", "started", "completed", "cancelled"];

const serverError = (res, label, error) => {
  console.error(`${label}:`, error);
  return res.status(500).json({ success: false, message: "Something went wrong" });
};

function parseDate(value, endOfDay = false) {
  if (typeof value !== "string" || !value) return null;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  if (endOfDay) d.setHours(23, 59, 59, 999);
  return d;
}

function dateFilter(query) {
  const from = parseDate(query.from);
  const to = parseDate(query.to, true);
  return from || to ? { ...(from && { $gte: from }), ...(to && { $lte: to }) } : null;
}

async function sumTransactions(match = {}) {
  const [fare, commission, driverEarnings, count] = await Promise.all([
    sumField(transactionModel, match, "fare"),
    sumField(transactionModel, match, "commissionAmount"),
    sumField(transactionModel, match, "driverEarning"),
    transactionModel.countDocuments(match)
  ]);

  return { fare, commission, driverEarnings, count };
}

// ==========================================
// DASHBOARD STATISTICS
// ==========================================
export async function getDashboardStats(req, res) {
  try {
    const [
      totalCustomers, totalDrivers, onlineDrivers, verifiedDrivers, blockedUsers,
      totalRides, completedRides, pendingRides, cancelledRides,
      totalDeliveries, completedDeliveries, pendingDeliveries, cancelledDeliveries,
      totalComplaints, pendingComplaints, ratingAgg, money,
      recentRides, recentDeliveries
    ] = await Promise.all([
      userModel.countDocuments({ role: "customer" }),
      userModel.countDocuments({ role: "driver" }),
      userModel.countDocuments({ role: "driver", driverStatus: { $in: ["online", "busy"] } }),
      userModel.countDocuments({ role: "driver", isVerified: true }),
      userModel.countDocuments({ isBlocked: true }),
      rideModel.countDocuments({}),
      rideModel.countDocuments({ status: "completed" }),
      rideModel.countDocuments({ status: "pending" }),
      rideModel.countDocuments({ status: "cancelled" }),
      deliveryModel.countDocuments({}),
      deliveryModel.countDocuments({ status: "completed" }),
      deliveryModel.countDocuments({ status: "pending" }),
      deliveryModel.countDocuments({ status: "cancelled" }),
      complaintModel.countDocuments({}),
      complaintModel.countDocuments({ status: { $in: ["pending", "in_review"] } }),
      Promise.all([ratingModel.countDocuments({}), sumField(ratingModel, {}, "rating")]),
      sumTransactions(),
      rideModel.find({}).populate("customer", "name").sort({ createdAt: -1 }).limit(6).select("customer pickupLocation destination status offeredFare createdAt"),
      deliveryModel.find({}).populate("customer", "name").sort({ createdAt: -1 }).limit(6).select("customer pickupLocation destination status offeredFare createdAt")
    ]);

    const recentActivity = [
      ...recentRides.map((r) => ({ ...r.toObject(), serviceType: "ride" })),
      ...recentDeliveries.map((d) => ({ ...d.toObject(), serviceType: "delivery" }))
    ]
      .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
      .slice(0, 8);

    return res.json({
      success: true,
      stats: {
        totalCustomers,
        totalDrivers,
        onlineDrivers,
        activeDrivers: onlineDrivers,
        verifiedDrivers,
        blockedUsers,
        totalRides,
        completedRides,
        pendingRides,
        cancelledRides,
        totalDeliveries,
        completedDeliveries,
        pendingDeliveries,
        cancelledDeliveries,
        completedServices: completedRides + completedDeliveries,
        pendingServices: pendingRides + pendingDeliveries,
        totalComplaints,
        pendingComplaints,
        totalRatings: ratingAgg[0],
        averageRating: ratingAgg[0] ? Number((ratingAgg[1] / ratingAgg[0]).toFixed(2)) : 0,
        totalRevenue: money.fare,
        totalFareProcessed: money.fare,
        totalCommissionEarned: money.commission,
        totalDriverEarnings: money.driverEarnings
      },
      recentActivity
    });
  } catch (error) {
    return serverError(res, "Get Dashboard Stats Error", error);
  }
}

// ==========================================
// USER LISTS (customers / drivers) with search + filters
// ==========================================
function userFilter(role, query) {
  const filter = { role };
  const q = str(query.q, 60);

  if (q) {
    const rx = new RegExp(escapeRegex(q), "i");
    filter.$or = [{ name: rx }, { email: rx }, { phone: rx }, ...(role === "driver" ? [{ vehicleNumber: rx }] : [])];
  }

  if (query.blocked === "true") filter.isBlocked = true;
  if (query.blocked === "false") filter.isBlocked = false;

  if (role === "driver") {
    if (query.verified === "true") filter.isVerified = true;
    if (query.verified === "false") filter.isVerified = false;
    if (["online", "offline", "busy"].includes(query.driverStatus)) filter.driverStatus = query.driverStatus;
  }

  const created = dateFilter(query);
  if (created) filter.createdAt = created;

  return filter;
}

export async function getCustomers(req, res) {
  try {
    const customers = await userModel
      .find(userFilter("customer", req.query))
      .select("-password")
      .sort({ createdAt: -1 })
      .limit(500);

    return res.json({ success: true, customers });
  } catch (error) {
    return serverError(res, "Get Customers Error", error);
  }
}

export async function getDrivers(req, res) {
  try {
    const drivers = await userModel
      .find(userFilter("driver", req.query))
      .select("-password")
      .sort({ createdAt: -1 })
      .limit(500);

    const ratings = await getDriverRatingMap(drivers.map((d) => d._id));

    return res.json({
      success: true,
      drivers: drivers.map((d) => ({ ...d.toObject(), rating: ratings[d._id.toString()] || { average: 0, count: 0 } }))
    });
  } catch (error) {
    return serverError(res, "Get Drivers Error", error);
  }
}

// ==========================================
// SINGLE USER DETAILS
// ==========================================
export async function getUserDetails(req, res) {
  try {
    const user = await userModel.findById(req.params.userId).select("-password");

    if (!user) return res.status(404).json({ success: false, message: "User not found" });

    const owner = user.role === "driver" ? { driver: user._id } : { customer: user._id };

    const [rides, deliveries, complaints] = await Promise.all([
      rideModel.countDocuments(owner),
      deliveryModel.countDocuments(owner),
      complaintModel.countDocuments({ customer: user._id })
    ]);

    const details = { ...user.toObject(), stats: { rides, deliveries, complaints } };

    if (user.role === "driver") {
      details.rating = await getDriverRatingSummary(user._id);
      details.earnings = await sumTransactions({ driver: user._id });
    }

    return res.json({ success: true, user: details });
  } catch (error) {
    return serverError(res, "Get User Details Error", error);
  }
}

// ==========================================
// BLOCK / UNBLOCK
// ==========================================
export async function setUserBlockedStatus(req, res) {
  try {
    const { userId } = req.params;

    if (typeof req.body.isBlocked !== "boolean") {
      return res.status(400).json({ success: false, message: "isBlocked must be true or false" });
    }

    const target = await userModel.findById(userId);

    if (!target) return res.status(404).json({ success: false, message: "User not found" });

    if (target.role === "admin") {
      return res.status(403).json({ success: false, message: "Admin accounts cannot be blocked" });
    }

    target.isBlocked = req.body.isBlocked;

    // A blocked driver must not stay online
    if (target.isBlocked && target.role === "driver") target.driverStatus = "offline";

    await target.save();

    if (target.isBlocked) {
      // A blocked user is signed out everywhere and their sockets are closed immediately
      await revokeAllForUser(target._id, "blocked");
      disconnectUser(target._id);
    }
    await audit(req, target.isBlocked ? "account.blocked" : "account.activated", { entityType: "User", entityId: target._id, meta: { role: target.role } });

    return res.json({
      success: true,
      message: target.isBlocked ? "User has been blocked" : "User has been activated",
      user: await userModel.findById(target._id).select("-password")
    });
  } catch (error) {
    return serverError(res, "Set User Blocked Status Error", error);
  }
}

// ==========================================
// VERIFY / UNVERIFY DRIVER
// ==========================================
export async function verifyDriver(req, res) {
  try {
    const driver = await userModel.findOne({ _id: req.params.userId, role: "driver" });

    if (!driver) return res.status(404).json({ success: false, message: "Driver not found" });

    const verified = req.body?.isVerified !== false;

    if (verified) {
      const gate = await assertDocumentsApproved(driver._id);
      if (!gate.ok) return res.status(409).json({ success: false, message: gate.message });
    }

    driver.isVerified = verified;

    // A driver who loses verification must stop appearing online
    if (!verified && driver.driverStatus !== "offline") driver.driverStatus = "offline";

    await driver.save();
    await audit(req, verified ? "driver.verified" : "driver.unverified", { entityType: "User", entityId: driver._id });

    await createNotification(driver._id, {
      type: verified ? "account_verified" : "account_unverified",
      title: verified ? "Account Verified" : "Verification Removed",
      message: verified
        ? "Your driver account is verified. You can now go online and accept requests."
        : "Your driver verification was removed. Contact support for details."
    });

    return res.json({
      success: true,
      message: verified ? "Driver verified successfully" : "Driver verification removed",
      user: { _id: driver._id, name: driver.name, isVerified: driver.isVerified }
    });
  } catch (error) {
    return serverError(res, "Verify Driver Error", error);
  }
}

// ==========================================
// RIDES / DELIVERIES (status, search, date filters)
// ==========================================
function serviceFilter(query) {
  const filter = {};
  const status = str(query.status, 12);
  const q = str(query.q, 60);

  if (STATUSES.includes(status)) filter.status = status;

  if (q) {
    const rx = new RegExp(escapeRegex(q), "i");
    filter.$or = [{ pickupLocation: rx }, { destination: rx }];
  }

  const created = dateFilter(query);
  if (created) filter.createdAt = created;

  return filter;
}

async function listServices(Model, req, res, key, label) {
  try {
    const items = await Model
      .find(serviceFilter(req.query))
      .populate("customer", "name phone")
      .populate("driver", "name phone vehicleType vehicleNumber")
      .sort({ createdAt: -1 })
      .limit(500);

    return res.json({ success: true, [key]: items });
  } catch (error) {
    return serverError(res, `Get All ${label} Error`, error);
  }
}

export const getAllRides = (req, res) => listServices(rideModel, req, res, "rides", "Rides");
export const getAllDeliveries = (req, res) => listServices(deliveryModel, req, res, "deliveries", "Deliveries");

// ==========================================
// RATINGS
// ==========================================
export async function getAllRatings(req, res) {
  try {
    const filter = {};
    const stars = Number(req.query.rating);

    if (Number.isInteger(stars) && stars >= 1 && stars <= 5) filter.rating = stars;
    if (["ride", "delivery"].includes(req.query.serviceType)) filter.serviceType = req.query.serviceType;
    if (/^[a-fA-F0-9]{24}$/.test(str(req.query.driver, 30))) filter.driver = req.query.driver;

    const created = dateFilter(req.query);
    if (created) filter.createdAt = created;

    const ratings = await ratingModel
      .find(filter)
      .populate("customer", "name")
      .populate("driver", "name")
      .sort({ createdAt: -1 })
      .limit(500);

    const average = ratings.length ? Number((ratings.reduce((s, r) => s + r.rating, 0) / ratings.length).toFixed(2)) : 0;

    return res.json({ success: true, ratings, average, count: ratings.length });
  } catch (error) {
    return serverError(res, "Get All Ratings Error", error);
  }
}

// ==========================================
// REPORTS (optional from / to date range)
// ==========================================
export async function getReports(req, res) {
  try {
    const range = dateFilter(req.query);
    const created = range ? { createdAt: range } : {};

    const byStatus = (Model) =>
      countByKey(Model, created, "status").then((m) => Object.entries(m).map(([k, v]) => ({ _id: k, count: v })));

    const [rideRows, deliveryRows, customers, drivers, money, transactions] = await Promise.all([
      byStatus(rideModel),
      byStatus(deliveryModel),
      userModel.countDocuments({ role: "customer", ...created }),
      userModel.countDocuments({ role: "driver", ...created }),
      sumTransactions(created),
      // Bounded read; grouped below (keeps the query portable and simple)
      transactionModel.find(created).select("driver fare commissionAmount driverEarning createdAt").sort({ createdAt: -1 }).limit(20000).lean()
    ]);

    const perDriver = new Map();
    const perDay = new Map();

    for (const t of transactions) {
      const d = perDriver.get(String(t.driver)) || { _id: t.driver, trips: 0, fare: 0, commission: 0, earnings: 0 };
      d.trips += 1; d.fare += t.fare; d.commission += t.commissionAmount; d.earnings += t.driverEarning;
      perDriver.set(String(t.driver), d);

      const day = new Date(t.createdAt).toISOString().slice(0, 10);
      const x = perDay.get(day) || { _id: day, trips: 0, fare: 0, commission: 0 };
      x.trips += 1; x.fare += t.fare; x.commission += t.commissionAmount;
      perDay.set(day, x);
    }

    const top = [...perDriver.values()].sort((a, b) => b.earnings - a.earnings).slice(0, 10);
    const names = await userModel.find({ _id: { $in: top.map((d) => d._id) } }).select("name");
    const nameOf = Object.fromEntries(names.map((u) => [u._id.toString(), u.name]));
    const topDrivers = top.map((d) => ({ ...d, name: nameOf[String(d._id)] || "Driver" }));
    const byDay = [...perDay.values()].sort((a, b) => (a._id < b._id ? 1 : -1)).slice(0, 31).reverse();

    const toMap = (rows) => ({
      total: rows.reduce((s, r) => s + r.count, 0),
      ...Object.fromEntries(STATUSES.map((s) => [s, rows.find((r) => r._id === s)?.count || 0]))
    });

    return res.json({
      success: true,
      report: {
        rides: toMap(rideRows),
        deliveries: toMap(deliveryRows),
        newCustomers: customers,
        newDrivers: drivers,
        revenue: money.fare,
        commission: money.commission,
        driverEarnings: money.driverEarnings,
        completedTransactions: money.count,
        topDrivers,
        daily: byDay
      }
    });
  } catch (error) {
    return serverError(res, "Get Reports Error", error);
  }
}
