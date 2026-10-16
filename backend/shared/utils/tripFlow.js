import { buildTripData } from "./trip.js";
import { checkDriverEligibility } from "./driverRules.js";
import { presentTrips, hidePreAcceptDetails } from "./presenter.js";
import { str, escapeRegex } from "./objectId.js";
import { recordTransaction } from "../../modules/payments/payment.controller.js";
import {
  createNotification,
  notifyEligibleDrivers,
  retractRequestNotifications
} from "../../modules/notifications/notification.service.js";
import { emitToUser } from "../realtime/socket.js";
import { assignDriverToTrip } from "./assignDriver.js";

const DRIVER_POPULATE =
  "name phone profileImage vehicleType vehicleModel vehicleNumber currentLocation";

const fail = (res, status, message) => res.status(status).json({ success: false, message });
const serverError = (res, label, error) => {
  console.error(`${label}:`, error);
  return fail(res, 500, "Something went wrong");
};

function parseDate(value, endOfDay = false) {
  if (typeof value !== "string" || !value) return null;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  if (endOfDay) d.setHours(23, 59, 59, 999);
  return d;
}

// ------------------------------------------------------------------
// Builds every handler for one service type ("ride" | "delivery").
// All state changes use atomic findOneAndUpdate with the expected
// current status in the filter, so two requests can never both win.
// ------------------------------------------------------------------
export function makeTripHandlers(cfg) {
  const {
    Model,
    OtherModel, // the other booking collection (for the driver cross-check)
    serviceType, // "ride" | "delivery"
    single, // response key, e.g. "ride"
    plural, // e.g. "rides"
    Label, // "Ride" | "Delivery"
    idParam, // "rideId" | "deliveryId"
    validateCreate, // (req) => { error } | { data }
    driverMatches, // (driver, trip) => string|null   (error message if not allowed)
    decorateAvailable, // optional async (docs, driverId) => docs
    onCancel // optional async (doc) => void  (e.g. expire ride offers)
  } = cfg;

  const label = Label.toLowerCase();

  const populated = (q) =>
    q.populate("customer", "name phone").populate("driver", DRIVER_POPULATE);

  async function sendTrip(res, id, message, extra = {}) {
    const trip = await populated(Model.findById(id));
    return res.json({ success: true, message, [single]: await presentTrips(trip), ...extra });
  }

  // ---------------- CREATE ----------------
  async function create(req, res) {
    try {
      const checked = validateCreate(req);
      if (checked.error) return fail(res, 400, checked.error);

      const offeredFare = Number(req.body.offeredFare);

      if (!Number.isFinite(offeredFare) || offeredFare <= 0 || offeredFare > 100000) {
        return fail(res, 400, "Offered fare must be between 1 and 100000");
      }

      const trip = await buildTripData(req.body, checked.kind);
      if (trip.error) return fail(res, 400, trip.error);

      // Friendly early check; the unique index below is what actually guarantees it
      const active = await Model.exists({
        customer: req.user.id,
        status: { $in: ["pending", "accepted", "started"] }
      });

      if (active) return fail(res, 409, `You already have an active ${label} request`);

      let doc;

      try {
        doc = await Model.create({
          customer: req.user.id,
          activeCustomer: req.user.id,
        ...checked.data,
        offeredFare: Math.round(offeredFare),
        notes: str(req.body.notes, 300),
          ...trip.data,
          status: "pending"
        });
      } catch (createError) {
        // Two simultaneous requests: the sparse unique index lets exactly one through
        if (createError.code === 11000) {
          return fail(res, 409, `You already have an active ${label} request`);
        }
        throw createError;
      }

      // Real notifications to eligible online drivers (DB + socket)
      const notified = await notifyEligibleDrivers(serviceType, doc);

      return res.status(201).json({
        success: true,
        message: `${Label} request created successfully`,
        [single]: doc,
        driversNotified: notified
      });
    } catch (error) {
      return serverError(res, `Create ${Label} Error`, error);
    }
  }

  // ---------------- AVAILABLE (driver) ----------------
  async function available(req, res) {
    try {
      const eligibility = await checkDriverEligibility(req.user.id);
      if (!eligibility.ok) return fail(res, eligibility.status, eligibility.message);

      const filter = { status: "pending" };

      if (serviceType === "ride") {
        const vehicle = (eligibility.driver.vehicleType || "").toLowerCase();
        if (["bike", "rickshaw", "car"].includes(vehicle)) filter.vehicleType = vehicle;
      }

      const q = str(req.query.q, 60);
      if (q) {
        const rx = new RegExp(escapeRegex(q), "i");
        filter.$or = [{ pickupLocation: rx }, { destination: rx }];
      }

      const minFare = Number(req.query.minFare);
      if (Number.isFinite(minFare) && minFare > 0) filter.offeredFare = { $gte: minFare };

      const sort = req.query.sort === "fare" ? { offeredFare: -1 } : { createdAt: -1 };

      const docs = await Model.find(filter).populate("customer", "name").sort(sort).limit(100);

      const shaped = docs.map(hidePreAcceptDetails);

      return res.json({
        success: true,
        [plural]: decorateAvailable ? await decorateAvailable(shaped, req.user.id) : shaped
      });
    } catch (error) {
      return serverError(res, `Available ${Label}s Error`, error);
    }
  }

  // ---------------- ACCEPT ----------------
  async function accept(req, res) {
    try {
      const id = req.params[idParam];

      const eligibility = await checkDriverEligibility(req.user.id, { requireIdle: true });
      if (!eligibility.ok) return fail(res, eligibility.status, eligibility.message);

      const existing = await Model.findById(id);
      if (!existing) return fail(res, 404, `${Label} not found`);

      const mismatch = driverMatches ? driverMatches(eligibility.driver, existing) : null;
      if (mismatch) return fail(res, 403, mismatch);

      const assigned = await assignDriverToTrip({
        Model, OtherModel, serviceType, id, driverId: req.user.id
      });
      if (!assigned.ok) return fail(res, assigned.status, assigned.message);
      const doc = assigned.doc;

      // Remove the request from every other driver's list/notifications
      await retractRequestNotifications(serviceType, doc._id, req.user.id);

      await createNotification(doc.customer, {
        type: `${serviceType}_accepted`,
        title: `${Label} Accepted`,
        message: `${eligibility.driver.name} accepted your ${label} request.`,
        serviceType,
        serviceId: doc._id
      });
      emitToUser(doc.customer, `${serviceType}:updated`, { serviceId: doc._id, status: "accepted" });

      return sendTrip(res, doc._id, `${Label} accepted successfully`);
    } catch (error) {
      return serverError(res, `Accept ${Label} Error`, error);
    }
  }

  // ---------------- CANCEL (customer) ----------------
  async function cancel(req, res) {
    try {
      const id = req.params[idParam];

      const doc = await Model.findOneAndUpdate(
        { _id: id, customer: req.user.id, status: { $in: ["pending", "accepted"] } },
        {
          $set: {
            status: "cancelled",
            cancelledAt: new Date(),
            cancelledBy: "customer",
            cancelReason: str(req.body?.reason, 200)
          },
          $unset: { activeCustomer: 1, activeDriver: 1 }
        },
        { new: false } // keep the previous state to know if a driver was assigned
      );

      if (!doc) {
        const exists = await Model.findById(id);

        if (!exists || exists.customer.toString() !== req.user.id) {
          return fail(res, 404, `${Label} not found`);
        }
        return fail(res, 409, `A ${exists.status} ${label} cannot be cancelled`);
      }

      if (onCancel) await onCancel(doc);

      if (doc.status === "pending") {
        await retractRequestNotifications(serviceType, doc._id);
      } else if (doc.driver) {
        await createNotification(doc.driver, {
          type: `${serviceType}_cancelled`,
          title: `${Label} Cancelled`,
          message: `The customer cancelled the ${label} ${doc.pickupLocation} → ${doc.destination}.${
            req.body?.reason ? ` Reason: ${str(req.body.reason, 120)}` : ""
          }`.slice(0, 400),
          serviceType,
          serviceId: doc._id
        });
        emitToUser(doc.driver, `${serviceType}:updated`, { serviceId: doc._id, status: "cancelled" });
      }

      return sendTrip(res, doc._id, `${Label} cancelled successfully`);
    } catch (error) {
      return serverError(res, `Cancel ${Label} Error`, error);
    }
  }

  // ---------------- ACTIVE (driver) ----------------
  async function active(req, res) {
    try {
      const doc = await populated(
        Model.findOne({ driver: req.user.id, status: { $in: ["accepted", "started"] } }).sort({ createdAt: -1 })
      );

      return res.json({
        success: true,
        [single]: doc ? await presentTrips(doc) : null,
        ...(doc ? {} : { message: `No active ${label} found` })
      });
    } catch (error) {
      return serverError(res, `Get Active ${Label} Error`, error);
    }
  }

  // ---------------- MINE (customer's active one) ----------------
  async function mine(req, res) {
    try {
      const doc = await populated(
        Model.findOne({ customer: req.user.id, status: { $in: ["pending", "accepted", "started"] } }).sort({ createdAt: -1 })
      );

      return res.json({
        success: true,
        [single]: doc ? await presentTrips(doc) : null,
        ...(doc ? {} : { message: `No active ${label} found` })
      });
    } catch (error) {
      return serverError(res, `Get My ${Label}s Error`, error);
    }
  }

  // ---------------- HISTORY (customer / driver) ----------------
  async function history(req, res) {
    try {
      const owner = req.user.role === "driver" ? { driver: req.user.id } : { customer: req.user.id };

      const statuses = ["completed", "cancelled"];
      const status = str(req.query.status, 12);
      const filter = { ...owner, status: statuses.includes(status) ? status : { $in: statuses } };

      const from = parseDate(req.query.from);
      const to = parseDate(req.query.to, true);
      if (from || to) filter.createdAt = { ...(from && { $gte: from }), ...(to && { $lte: to }) };

      const q = str(req.query.q, 60);
      if (q) {
        const rx = new RegExp(escapeRegex(q), "i");
        filter.$or = [{ pickupLocation: rx }, { destination: rx }];
      }

      const docs = await populated(Model.find(filter).sort({ createdAt: -1 }).limit(200));

      return res.json({ success: true, [plural]: await presentTrips(docs) });
    } catch (error) {
      return serverError(res, `Get ${Label} History Error`, error);
    }
  }

  // ---------------- DETAILS ----------------
  async function details(req, res) {
    try {
      const doc = await populated(Model.findById(req.params[idParam]));
      if (!doc) return fail(res, 404, `${Label} not found`);

      const isOwner = doc.customer._id.toString() === req.user.id;
      const isDriver = doc.driver && doc.driver._id.toString() === req.user.id;
      const isAdmin = req.user.role === "admin";

      if (!isOwner && !isDriver && !isAdmin) {
        return fail(res, 403, `You are not authorized to view this ${label}`);
      }

      return res.json({ success: true, [single]: await presentTrips(doc) });
    } catch (error) {
      return serverError(res, `Get ${Label} Details Error`, error);
    }
  }

  // ---------------- START / COMPLETE (assigned driver) ----------------
  function transition({ from, to, stamp, verb, notifyType, errorMsg, after }) {
    return async function (req, res) {
      try {
        const id = req.params[idParam];

        const doc = await Model.findOneAndUpdate(
          { _id: id, driver: req.user.id, status: from },
          {
            $set: { status: to, [stamp]: new Date() },
            ...(to === "completed" ? { $unset: { activeCustomer: 1, activeDriver: 1 } } : {})
          },
          { new: true }
        );

        if (!doc) {
          const exists = await Model.findById(id).select("driver");

          if (!exists) return fail(res, 404, `${Label} not found`);
          if (!exists.driver || exists.driver.toString() !== req.user.id) {
            return fail(res, 403, `You are not assigned to this ${label}`);
          }
          return fail(res, 409, errorMsg);
        }

        if (after) await after(doc);

        await createNotification(doc.customer, {
          type: notifyType,
          title: `${Label} ${verb}`,
          message: `Your ${label} ${doc.pickupLocation} → ${doc.destination} has ${to === "started" ? "started" : "been completed"}.`,
          serviceType,
          serviceId: doc._id
        });
        emitToUser(doc.customer, `${serviceType}:updated`, { serviceId: doc._id, status: to });

        return sendTrip(res, doc._id, `${Label} ${to} successfully`);
      } catch (error) {
        return serverError(res, `${verb} ${Label} Error`, error);
      }
    };
  }

  const start = transition({
    from: "accepted",
    to: "started",
    stamp: "startedAt",
    verb: "Started",
    notifyType: `${serviceType}_started`,
    errorMsg: `${Label} cannot be started`
  });

  const complete = transition({
    from: "started",
    to: "completed",
    stamp: "completedAt",
    verb: "Completed",
    notifyType: `${serviceType}_completed`,
    errorMsg: `${Label} must be started first`,
    after: (doc) =>
      recordTransaction({
        serviceType,
        serviceId: doc._id,
        customer: doc.customer,
        driver: doc.driver,
        fare: doc.agreedFare ?? doc.offeredFare,
        routeLabel: `${doc.pickupLocation} → ${doc.destination}`
      })
  });

  return { create, available, accept, cancel, active, mine, history, details, start, complete };
}
