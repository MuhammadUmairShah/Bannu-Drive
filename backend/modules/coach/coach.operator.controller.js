import { Coach, CoachRoute, CoachSchedule, CoachBooking, CoachOperator, cityKey } from "./coach.model.js";
import { isValidPhone } from "../../shared/utils/validators.js";
import { str, escapeRegex } from "../../shared/utils/objectId.js";
import { sumField, countByKey } from "../../shared/utils/aggregate.js";
import {
  layoutError,
  cleanLayout,
  sellableSeats,
  availabilityFor,
  dayRange,
  localToday,
  sweepCoachData,
  cancelBookingRecord,
  ACTIVE_STATUSES,
  occupiedFilter,
  pushSeatUpdate,
  buildSeats,
  TZ_OFFSET
} from "./coach.service.js";
import { bookingView, populateBooking } from "./coach.customer.controller.js";
import { audit } from "../audit/audit.service.js";
import { isDuplicateKey } from "../../shared/utils/dbErrors.js";
import { releaseScheduleHolds } from "./coach.holds.js";
import { HOLDING } from "./coach.states.js";
import { operatorSeatMap } from "./coach.opsmap.js";
import { snapshotStops } from "./coach.stops.js";
import {
  CoachScan,
  parseCode,
  findTicket,
  judge,
  boardAtomically,
  checkInAtomically
} from "./coach.scan.js";
import { CoachOrder } from "./coach.order.model.js";
import { createNotification } from "../notifications/notification.service.js";
import { cleanPaymentAccounts } from "./coach.manual.js";

const fail = (res, status, message, extra = {}) =>
  res.status(status).json({
    success: false,
    message,
    ...extra
  });

const serverError = (res, label, error) => {
  console.error(`${label}:`, error);
  return fail(res, 500, "Something went wrong");
};

const isId = (v) =>
  typeof v === "string" && /^[a-fA-F0-9]{24}$/.test(v);

function cleanAmenities(value) {
  if (value === undefined) return undefined;

  if (!Array.isArray(value)) return null;

  const list = value
    .map((v) => str(v, 30))
    .filter(Boolean);

  return list.length > 8 ? null : [...new Set(list)];
}

// ==========================================
// PROFILE
// ==========================================

export async function getMe(req, res) {
  return res.json({
    success: true,
    operator: req.operator.doc,
    approved: req.operator.approved
  });
}

export async function updateMe(req, res) {
  try {
    const update = {};

    if (req.body.companyName !== undefined) {
      const name = str(req.body.companyName, 80);

      if (name.length < 2) {
        return fail(res, 400, "Company name is too short");
      }

      update.companyName = name;
    }

    if (req.body.contactPhone !== undefined) {
      const phone = str(req.body.contactPhone, 20);

      if (phone && !isValidPhone(phone)) {
        return fail(res, 400, "Please enter a valid phone number");
      }

      update.contactPhone = phone;
    }

    const accounts = cleanPaymentAccounts(req.body.paymentAccounts);

    if (accounts.error) {
      return fail(res, 400, accounts.error);
    }

    Object.assign(update, accounts.set);

    await CoachOperator.updateOne(
      { _id: req.operator.id },
      { $set: update }
    );

    return res.json({
      success: true,
      message: "Company profile updated",
      operator: await CoachOperator.findById(req.operator.id)
    });
  } catch (error) {
    return serverError(res, "Update Operator Error", error);
  }
}

// ==========================================
// COACHES
// ==========================================

export async function listCoaches(req, res) {
  try {
    const coaches = await Coach.find({
      operator: req.operator.id
    }).sort({
      createdAt: -1
    });

    return res.json({
      success: true,
      coaches
    });
  } catch (error) {
    return serverError(res, "List Coaches Error", error);
  }
}

export async function createCoach(req, res) {
  try {
    const name = str(req.body.name, 60);
    const type = str(req.body.type, 12) || "standard";
    const amenities = cleanAmenities(req.body.amenities ?? []);
    const layout = req.body.layout;

    if (name.length < 2) {
      return fail(res, 400, "Coach name is required");
    }

    if (!["standard", "executive", "luxury", "minibus"].includes(type)) {
      return fail(res, 400, "Invalid coach type");
    }

    if (amenities === null) {
      return fail(
        res,
        400,
        "Amenities must be a list of up to 8 short items"
      );
    }

    const problem = layoutError(layout);

    if (problem) {
      return fail(res, 400, problem);
    }

    const clean = cleanLayout(layout);

    const coach = await Coach.create({
      operator: req.operator.id,
      name,
      type,
      amenities,
      registrationNumber: str(req.body.registrationNumber, 20),
      layout: clean,
      totalSeats: sellableSeats(clean)
    });

    return res.status(201).json({
      success: true,
      message: "Coach added",
      coach
    });
  } catch (error) {
    return serverError(res, "Create Coach Error", error);
  }
}

export async function updateCoach(req, res) {
  try {
    const coach = await Coach.findOne({
      _id: req.params.id,
      operator: req.operator.id
    });

    if (!coach) {
      return fail(res, 404, "Coach not found");
    }

    if (req.body.name !== undefined) {
      const name = str(req.body.name, 60);

      if (name.length < 2) {
        return fail(res, 400, "Coach name is required");
      }

      coach.name = name;
    }

    if (req.body.type !== undefined) {
      if (
        !["standard", "executive", "luxury", "minibus"].includes(
          req.body.type
        )
      ) {
        return fail(res, 400, "Invalid coach type");
      }

      coach.type = req.body.type;
    }

    if (req.body.registrationNumber !== undefined) {
      coach.registrationNumber = str(
        req.body.registrationNumber,
        20
      );
    }

    if (req.body.amenities !== undefined) {
      const a = cleanAmenities(req.body.amenities);

      if (a === null) {
        return fail(
          res,
          400,
          "Amenities must be a list of up to 8 short items"
        );
      }

      coach.amenities = a;
    }

    if (req.body.isActive !== undefined) {
      if (typeof req.body.isActive !== "boolean") {
        return fail(res, 400, "isActive must be true or false");
      }

      coach.isActive = req.body.isActive;
    }

    if (req.body.layout !== undefined) {
      // Existing schedules keep their own snapshot,
      // so this only affects schedules created later.
      const problem = layoutError(req.body.layout);

      if (problem) {
        return fail(res, 400, problem);
      }

      coach.layout = cleanLayout(req.body.layout);
      coach.totalSeats = sellableSeats(coach.layout);
    }

    await coach.save();

    return res.json({
      success: true,
      message: "Coach updated",
      coach
    });
  } catch (error) {
    return serverError(res, "Update Coach Error", error);
  }
}

// ==========================================
// ROUTES
// ==========================================

export async function listRoutes(req, res) {
  try {
    const routes = await CoachRoute.find({
      operator: req.operator.id
    }).sort({
      fromCity: 1,
      toCity: 1
    });

    return res.json({
      success: true,
      routes
    });
  } catch (error) {
    return serverError(res, "List Routes Error", error);
  }
}

export async function createRoute(req, res) {
  try {
    const fromCity = str(req.body.fromCity, 50);
    const toCity = str(req.body.toCity, 50);

    const distanceKm =
      req.body.distanceKm === undefined ||
      req.body.distanceKm === ""
        ? null
        : Number(req.body.distanceKm);

    const durationMin =
      req.body.durationMin === undefined ||
      req.body.durationMin === ""
        ? null
        : Number(req.body.durationMin);

    if (fromCity.length < 2 || toCity.length < 2) {
      return fail(res, 400, "Both cities are required");
    }

    if (cityKey(fromCity) === cityKey(toCity)) {
      return fail(res, 400, "From and To must be different");
    }

    if (
      [distanceKm, durationMin].some(
        (n) =>
          n !== null &&
          (!Number.isFinite(n) || n < 0 || n > 5000)
      )
    ) {
      return fail(
        res,
        400,
        "Distance and duration must be positive numbers"
      );
    }

    const route = await CoachRoute.create({
      operator: req.operator.id,
      fromCity,
      toCity,
      fromKey: cityKey(fromCity),
      toKey: cityKey(toCity),
      distanceKm,
      durationMin
    });

    return res.status(201).json({
      success: true,
      message: "Route added",
      route
    });
  } catch (error) {
    if (isDuplicateKey(error)) {
      return fail(res, 409, "You already have this route");
    }

    return serverError(res, "Create Route Error", error);
  }
}

// City names are fixed once created.
// Schedules and bookings keep a copy.
// Distance/duration/active can change.
export async function updateRoute(req, res) {
  try {
    const route = await CoachRoute.findOne({
      _id: req.params.id,
      operator: req.operator.id
    });

    if (!route) {
      return fail(res, 404, "Route not found");
    }

    for (const key of ["distanceKm", "durationMin"]) {
      if (req.body[key] !== undefined) {
        const n =
          req.body[key] === "" || req.body[key] === null
            ? null
            : Number(req.body[key]);

        if (
          n !== null &&
          (!Number.isFinite(n) || n < 0 || n > 5000)
        ) {
          return fail(
            res,
            400,
            "Distance and duration must be positive numbers"
          );
        }

        route[key] = n;
      }
    }

    if (req.body.isActive !== undefined) {
      if (typeof req.body.isActive !== "boolean") {
        return fail(res, 400, "isActive must be true or false");
      }

      route.isActive = req.body.isActive;
    }

    await route.save();

    return res.json({
      success: true,
      message: "Route updated",
      route
    });
  } catch (error) {
    return serverError(res, "Update Route Error", error);
  }
}

// ==========================================
// SCHEDULES
// ==========================================

function scheduleRow(s, available) {
  return {
    _id: s._id,
    fromCity: s.fromCity,
    toCity: s.toCity,
    departureAt: s.departureAt,
    arrivalAt: s.arrivalAt,
    fare: s.fare,
    totalSeats: s.totalSeats,
    availableSeats: available,
    bookedSeats: s.totalSeats - available,
    status: s.status,
    coach: s.coach?.name
      ? {
          _id: s.coach._id,
          name: s.coach.name
        }
      : undefined,
    route: s.route
  };
}

export async function listSchedules(req, res) {
  try {
    await sweepCoachData();

    const filter = {
      operator: req.operator.id
    };

    const status = str(req.query.status, 10);

    if (
      ["scheduled", "cancelled", "completed"].includes(status)
    ) {
      filter.status = status;
    }

    const from = dayRange(str(req.query.from, 10));
    const to = dayRange(str(req.query.to, 10));

    if (from || to) {
      filter.departureAt = {
        ...(from && { $gte: from.start }),
        ...(to && { $lt: to.end })
      };
    }

    /*
     * FIX:
     *
     * Previously:
     * departureAt > now
     *
     * That caused a trip to disappear from Upcoming
     * immediately after departure, even though the coach
     * had not arrived yet.
     *
     * Now:
     * arrivalAt > now
     *
     * So a scheduled trip remains visible until its
     * arrival time.
     */
    if (req.query.upcoming === "true") {
      filter.arrivalAt = {
        ...(filter.arrivalAt || {}),
        $gt: new Date()
      };
    }

    const rows = await CoachSchedule.find(filter)
      .populate("coach", "name")
      .sort({
        departureAt:
          req.query.upcoming === "true" ? 1 : -1
      })
      .limit(300);

    const availability = await availabilityFor(rows);

    return res.json({
      success: true,
      schedules: rows.map((s) =>
        scheduleRow(
          s,
          availability[s._id.toString()]
        )
      )
    });
  } catch (error) {
    return serverError(res, "List Schedules Error", error);
  }
}

export async function createSchedule(req, res) {
  try {
    const { coachId, routeId } = req.body;

    const fare = Number(req.body.fare);

    const repeatDays =
      req.body.repeatDays === undefined
        ? 0
        : Number(req.body.repeatDays);

    const departureAt = new Date(req.body.departureAt);

    if (!isId(coachId) || !isId(routeId)) {
      return fail(res, 400, "Choose a coach and a route");
    }

    if (Number.isNaN(departureAt.getTime())) {
      return fail(
        res,
        400,
        "A valid departure time is required"
      );
    }

    if (departureAt <= new Date()) {
      return fail(
        res,
        400,
        "Departure must be in the future"
      );
    }

    if (
      !Number.isInteger(fare) ||
      fare < 1 ||
      fare > 50000
    ) {
      return fail(
        res,
        400,
        "Fare must be a whole number between 1 and 50000"
      );
    }

    if (
      !Number.isInteger(repeatDays) ||
      repeatDays < 0 ||
      repeatDays > 30
    ) {
      return fail(
        res,
        400,
        "Repeat days must be between 0 and 30"
      );
    }

    // Ownership: coach and route must both belong
    // to THIS operator.
    const [coach, route] = await Promise.all([
      Coach.findOne({
        _id: coachId,
        operator: req.operator.id
      }),
      CoachRoute.findOne({
        _id: routeId,
        operator: req.operator.id
      })
    ]);

    if (!coach || !route) {
      return fail(
        res,
        404,
        "Coach or route not found"
      );
    }

    if (!coach.isActive) {
      return fail(
        res,
        409,
        "This coach is deactivated"
      );
    }

    if (!route.isActive) {
      return fail(
        res,
        409,
        "This route is deactivated"
      );
    }

    let arrivalAt = req.body.arrivalAt
      ? new Date(req.body.arrivalAt)
      : null;

    if (!arrivalAt && route.durationMin) {
      arrivalAt = new Date(
        departureAt.getTime() +
          route.durationMin * 60000
      );
    }

    if (
      !arrivalAt ||
      Number.isNaN(arrivalAt.getTime())
    ) {
      return fail(
        res,
        400,
        "Arrival time is required"
      );
    }

    if (arrivalAt <= departureAt) {
      return fail(
        res,
        400,
        "Arrival must be after departure"
      );
    }

    if (
      arrivalAt - departureAt >
      48 * 3600000
    ) {
      return fail(
        res,
        400,
        "A trip cannot be longer than 48 hours"
      );
    }

    const created = [];
    let skipped = 0;

    for (let day = 0; day <= repeatDays; day++) {
      const shift =
        day * 24 * 3600000;

      try {
        created.push(
          await CoachSchedule.create({
            stops: snapshotStops(
              route.stops,
              new Date(
                departureAt.getTime() + shift
              )
            ),

            operator: req.operator.id,
            coach: coach._id,
            route: route._id,

            fromCity: route.fromCity,
            toCity: route.toCity,
            fromKey: route.fromKey,
            toKey: route.toKey,

            departureAt: new Date(
              departureAt.getTime() + shift
            ),

            arrivalAt: new Date(
              arrivalAt.getTime() + shift
            ),

            fare,
            layout: coach.layout,
            totalSeats: coach.totalSeats,
            status: "scheduled"
          })
        );
      } catch (error) {
        if (isDuplicateKey(error)) {
          skipped += 1;
        } else {
          throw error;
        }
      }
    }

    if (!created.length) {
      return fail(
        res,
        409,
        "This coach already has a schedule at that time"
      );
    }

    for (const sc of created) {
      await audit(
        req,
        "schedule.created",
        {
          entityType: "Schedule",
          entityId: sc._id,
          meta: {
            fare: sc.fare,
            departureAt: sc.departureAt
          }
        }
      );
    }

    return res.status(201).json({
      success: true,
      message: `${created.length} schedule${
        created.length > 1 ? "s" : ""
      } created${
        skipped
          ? `, ${skipped} skipped (coach already busy)`
          : ""
      }`,
      schedules: created,
      skipped
    });
  } catch (error) {
    return serverError(
      res,
      "Create Schedule Error",
      error
    );
  }
}

export async function updateSchedule(req, res) {
  try {
    const schedule =
      await CoachSchedule.findOne({
        _id: req.params.id,
        operator: req.operator.id
      });

    if (!schedule) {
      return fail(
        res,
        404,
        "Schedule not found"
      );
    }

    if (schedule.status !== "scheduled") {
      return fail(
        res,
        409,
        `A ${schedule.status} schedule cannot be edited`
      );
    }

    const hasBookings =
      await CoachBooking.exists({
        schedule: schedule._id,
        ...occupiedFilter()
      });

    if (req.body.fare !== undefined) {
      const fare = Number(req.body.fare);

      if (
        !Number.isInteger(fare) ||
        fare < 1 ||
        fare > 50000
      ) {
        return fail(
          res,
          400,
          "Fare must be a whole number between 1 and 50000"
        );
      }

      schedule.fare = fare;
    }

    if (
      req.body.departureAt !== undefined ||
      req.body.arrivalAt !== undefined
    ) {
      if (hasBookings) {
        return fail(
          res,
          409,
          "This trip already has bookings. Cancel the schedule instead of moving it."
        );
      }

      const dep = new Date(
        req.body.departureAt ??
          schedule.departureAt
      );

      const arr = new Date(
        req.body.arrivalAt ??
          schedule.arrivalAt
      );

      if (
        Number.isNaN(dep.getTime()) ||
        Number.isNaN(arr.getTime())
      ) {
        return fail(
          res,
          400,
          "Invalid time"
        );
      }

      if (dep <= new Date()) {
        return fail(
          res,
          400,
          "Departure must be in the future"
        );
      }

      if (arr <= dep) {
        return fail(
          res,
          400,
          "Arrival must be after departure"
        );
      }

      const delta =
        dep.getTime() -
        schedule.departureAt.getTime();

      // The stop timetable moves with the trip.
      schedule.stops = (
        schedule.stops || []
      ).map((st) => ({
        stopId: st.stopId,
        name: st.name,
        kind: st.kind,
        latitude: st.latitude,
        longitude: st.longitude,
        order: st.order,
        arrivalAt: new Date(
          st.arrivalAt.getTime() + delta
        ),
        departureAt: new Date(
          st.departureAt.getTime() + delta
        )
      }));

      schedule.departureAt = dep;
      schedule.arrivalAt = arr;
    }

    try {
      await schedule.save();
    } catch (error) {
      if (isDuplicateKey(error)) {
        return fail(
          res,
          409,
          "This coach already has a schedule at that time"
        );
      }

      throw error;
    }

    await audit(
      req,
      "schedule.updated",
      {
        entityType: "Schedule",
        entityId: schedule._id,
        meta: {
          fare: schedule.fare,
          departureAt: schedule.departureAt,
          arrivalAt: schedule.arrivalAt
        }
      }
    );

    return res.json({
      success: true,
      message: "Schedule updated",
      schedule
    });
  } catch (error) {
    return serverError(
      res,
      "Update Schedule Error",
      error
    );
  }
}

// Cancels the schedule, releases every seat HOLD on it,
// and cancels every confirmed booking.
export async function cancelScheduleCore(
  schedule,
  by,
  reason,
  req = null
) {
  const result =
    await CoachSchedule.updateOne(
      {
        _id: schedule._id,
        status: "scheduled"
      },
      {
        $set: {
          status: "cancelled",
          "trip.state": "CANCELLED",
          "trip.stateChangedAt": new Date()
        }
      }
    );

  if (!result.matchedCount) {
    return null;
  }

  const released =
    await releaseScheduleHolds(
      schedule._id,
      {
        by,
        reason:
          reason || "Trip cancelled"
      }
    );

  const bookings =
    await CoachBooking.find({
      schedule: schedule._id,
      status: {
        $in: ACTIVE_STATUSES
      }
    });

  for (const b of bookings) {
    await cancelBookingRecord(
      b,
      {
        by,
        reason:
          reason || "Trip cancelled",
        req
      }
    );
  }

  await audit(
    req || { actorRole: by },
    "schedule.cancelled",
    {
      entityType: "Schedule",
      entityId: schedule._id,
      meta: {
        by,
        reason: reason || "",
        cancelledBookings:
          bookings.length,
        releasedHolds: released
      }
    }
  );

  return bookings.length;
}

export async function cancelSchedule(req, res) {
  try {
    const schedule =
      await CoachSchedule.findOne({
        _id: req.params.id,
        operator: req.operator.id
      });

    if (!schedule) {
      return fail(
        res,
        404,
        "Schedule not found"
      );
    }

    const count =
      await cancelScheduleCore(
        schedule,
        "operator",
        str(req.body?.reason, 150),
        req
      );

    if (count === null) {
      return fail(
        res,
        409,
        `A ${schedule.status} schedule cannot be cancelled`
      );
    }

    return res.json({
      success: true,
      message: `Schedule cancelled. ${count} booking${
        count === 1 ? "" : "s"
      } cancelled and customers notified.`,
      cancelledBookings: count
    });
  } catch (error) {
    return serverError(
      res,
      "Cancel Schedule Error",
      error
    );
  }
}

// ==========================================
// BOOKINGS + PASSENGERS
// ==========================================

export async function listBookings(req, res) {
  try {
    await sweepCoachData();

    const filter = {
      operator: req.operator.id
    };

    if (req.query.scheduleId !== undefined) {
      if (
        !isId(
          str(req.query.scheduleId, 30)
        )
      ) {
        return fail(
          res,
          400,
          "Invalid schedule"
        );
      }

      filter.schedule =
        req.query.scheduleId;
    }

    // Holds and expired attempts are not bookings.
    const status = str(
      req.query.status,
      10
    ).toUpperCase();

    filter.status = [
      "CONFIRMED",
      "CANCELLED",
      "COMPLETED"
    ].includes(status)
      ? status
      : {
          $in: [
            "CONFIRMED",
            "CANCELLED",
            "COMPLETED"
          ]
        };

    const day = dayRange(
      str(req.query.date, 10)
    );

    if (day) {
      filter.departureAt = {
        $gte: day.start,
        $lt: day.end
      };
    }

    const q = str(
      req.query.q,
      40
    );

    if (q) {
      const rx = new RegExp(
        escapeRegex(q),
        "i"
      );

      filter.$or = [
        { bookingCode: rx },
        { "passenger.name": rx },
        { "passenger.phone": rx }
      ];
    }

    const rows =
      await populateBooking(
        CoachBooking.find(filter)
          .populate(
            "customer",
            "name phone"
          )
          .sort({
            createdAt: -1
          })
          .limit(300)
      );

    return res.json({
      success: true,
      bookings: rows.map(bookingView)
    });
  } catch (error) {
    return serverError(
      res,
      "Operator Bookings Error",
      error
    );
  }
}

// Passenger manifest for ONE trip,
// ordered by seat.
export async function passengers(req, res) {
  try {
    const scheduleId = str(
      req.query.scheduleId,
      30
    );

    if (!isId(scheduleId)) {
      return fail(
        res,
        400,
        "Choose a trip"
      );
    }

    const schedule =
      await CoachSchedule.findOne({
        _id: scheduleId,
        operator: req.operator.id
      }).populate(
        "coach",
        "name"
      );

    if (!schedule) {
      return fail(
        res,
        404,
        "Schedule not found"
      );
    }

    const rows =
      await CoachBooking.find({
        schedule: schedule._id,
        status: {
          $in: [
            "CONFIRMED",
            "COMPLETED"
          ]
        }
      }).sort({
        seat: 1
      });

    const availability =
      await availabilityFor([
        schedule
      ]);

    return res.json({
      success: true,

      schedule: scheduleRow(
        schedule,
        availability[
          schedule._id.toString()
        ]
      ),

      passengers: rows.map(
        (b) => ({
          bookingId: b._id,
          bookingCode:
            b.bookingCode,
          seat: b.seat,
          status: b.status,
          fare: b.fare,
          paymentMethod:
            b.paymentMethod,
          paymentStatus:
            b.paymentStatus,
          checkInStatus:
            b.checkInStatus ||
            "NONE",
          boardedAt:
            b.boardedAt,
          name:
            b.passenger.name,
          phone:
            b.passenger.phone,
          gender:
            b.passenger.gender
        })
      )
    });
  } catch (error) {
    return serverError(
      res,
      "Passengers Error",
      error
    );
  }
}

export async function cancelBookingByOperator(
  req,
  res
) {
  try {
    const b =
      await CoachBooking.findOne({
        _id: req.params.id,
        operator: req.operator.id
      });

    if (!b) {
      return fail(
        res,
        404,
        "Booking not found"
      );
    }

    if (
      !ACTIVE_STATUSES.includes(
        b.status
      )
    ) {
      return fail(
        res,
        409,
        `A ${b.status.toLowerCase()} booking cannot be cancelled`
      );
    }

    const updated =
      await cancelBookingRecord(
        b,
        {
          by: "operator",
          reason: str(
            req.body?.reason,
            200
          ),
          req
        }
      );

    if (!updated) {
      return fail(
        res,
        409,
        "This booking was already cancelled"
      );
    }

    return res.json({
      success: true,
      message:
        "Booking cancelled and the customer was notified",
      booking: bookingView(
        await populateBooking(
          CoachBooking.findById(
            updated._id
          )
        )
      )
    });
  } catch (error) {
    return serverError(
      res,
      "Operator Cancel Booking Error",
      error
    );
  }
}

// ==========================================
// DASHBOARD + REPORTS
// ==========================================

export async function dashboard(req, res) {
  try {
    await sweepCoachData();

    const op = req.operator.id;
    const today = dayRange(
      localToday()
    );
    const now = new Date();

    const [
      todays,
      upcoming,
      totalBookings,
      cancelled,
      revConfirmed,
      revCompleted,
      recent,
      collectedA,
      collectedB,
      cashDue,
      cashToCollect,
      activeHolds
    ] = await Promise.all([
      CoachSchedule.find({
        operator: op,
        departureAt: {
          $gte: today.start,
          $lt: today.end
        },
        status: {
          $ne: "cancelled"
        }
      })
        .populate("coach", "name")
        .sort({
          departureAt: 1
        }),

      /*
       * FIX:
       *
       * Previously dashboard Upcoming used:
       * departureAt > now
       *
       * That removed a scheduled trip immediately
       * after its departure time.
       *
       * Now it remains visible until arrival.
       */
      CoachSchedule.find({
        operator: op,
        status: "scheduled",
        arrivalAt: {
          $gt: now
        }
      })
        .populate("coach", "name")
        .sort({
          departureAt: 1
        })
        .limit(200),

      CoachBooking.countDocuments({
        operator: op,
        status: {
          $in: [
            "CONFIRMED",
            "COMPLETED"
          ]
        }
      }),

      CoachBooking.countDocuments({
        operator: op,
        status: "CANCELLED"
      }),

      sumField(
        CoachBooking,
        {
          operator: op,
          status: "CONFIRMED"
        },
        "fare"
      ),

      sumField(
        CoachBooking,
        {
          operator: op,
          status: "COMPLETED"
        },
        "fare"
      ),

      populateBooking(
        CoachBooking.find({
          operator: op,
          status: {
            $in: [
              "CONFIRMED",
              "CANCELLED",
              "COMPLETED"
            ]
          }
        })
          .populate(
            "customer",
            "name phone"
          )
          .sort({
            createdAt: -1
          })
          .limit(8)
      ),

      sumField(
        CoachBooking,
        {
          operator: op,
          status: "CONFIRMED",
          paymentStatus: "PAID"
        },
        "fare"
      ),

      sumField(
        CoachBooking,
        {
          operator: op,
          status: "COMPLETED",
          paymentStatus: "PAID"
        },
        "fare"
      ),

      sumField(
        CoachBooking,
        {
          operator: op,
          status: "CONFIRMED",
          paymentStatus: "CASH_DUE"
        },
        "fare"
      ),

      CoachBooking.countDocuments({
        operator: op,
        status: "CONFIRMED",
        paymentStatus: "CASH_DUE"
      }),

      CoachBooking.countDocuments({
        operator: op,
        status: {
          $in: HOLDING
        },
        holdExpiresAt: {
          $gt: now
        }
      })
    ]);

    const [
      todayAvail,
      upcomingAvail
    ] = await Promise.all([
      availabilityFor(todays),
      availabilityFor(upcoming)
    ]);

    const availableSeats =
      upcoming.reduce(
        (sum, s) =>
          sum +
          upcomingAvail[
            s._id.toString()
          ],
        0
      );

    const upcomingCapacity =
      upcoming.reduce(
        (sum, s) =>
          sum + s.totalSeats,
        0
      );

    const bookedUpcoming =
      Math.max(
        0,
        upcomingCapacity -
          availableSeats
      );

    return res.json({
      success: true,
      approved:
        req.operator.approved,
      timezone: TZ_OFFSET,

      stats: {
        todaysTrips:
          todays.length,

        upcomingSchedules:
          upcoming.length,

        totalBookings,

        cancelledBookings:
          cancelled,

        availableSeats,

        revenueUpcoming:
          revConfirmed,

        revenueCompleted:
          revCompleted,

        revenueTotal:
          revConfirmed +
          revCompleted,

        bookedSeatsUpcoming:
          bookedUpcoming,

        occupancyUpcomingPct:
          upcomingCapacity
            ? Math.round(
                (bookedUpcoming /
                  upcomingCapacity) *
                  100
              )
            : 0,

        collected:
          collectedA +
          collectedB,

        cashDue,

        cashToCollect,

        activeHolds
      },

      pendingActions: {
        verification:
          !req.operator.approved,

        cashToCollect,

        tripsToday:
          todays.length
      },

      todaysTrips:
        todays.map((s) =>
          scheduleRow(
            s,
            todayAvail[
              s._id.toString()
            ]
          )
        ),

      upcoming:
        upcoming
          .slice(0, 8)
          .map((s) =>
            scheduleRow(
              s,
              upcomingAvail[
                s._id.toString()
              ]
            )
          ),

      recentBookings:
        recent.map(bookingView)
    });
  } catch (error) {
    return serverError(
      res,
      "Operator Dashboard Error",
      error
    );
  }
}

export async function reports(req, res) {
  try {
    await sweepCoachData();

    const filter = {
      operator: req.operator.id
    };

    const from = dayRange(
      str(req.query.from, 10)
    );

    const to = dayRange(
      str(req.query.to, 10)
    );

    if (from || to) {
      filter.departureAt = {
        ...(from && {
          $gte: from.start
        }),
        ...(to && {
          $lt: to.end
        })
      };
    }

    const rows =
      await CoachBooking.find({
        ...filter,
        status: {
          $in: [
            "CONFIRMED",
            "COMPLETED",
            "CANCELLED"
          ]
        }
      })
        .select(
          "status fare fromCity toCity departureAt"
        )
        .limit(20000)
        .lean();

    const byStatus = {
      CONFIRMED: 0,
      CANCELLED: 0,
      COMPLETED: 0
    };

    const routes = new Map();
    const days = new Map();

    let revenue = 0;

    for (const b of rows) {
      byStatus[b.status] += 1;

      if (b.status === "CANCELLED") {
        continue;
      }

      revenue += b.fare;

      const rk =
        `${b.fromCity} → ${b.toCity}`;

      const r =
        routes.get(rk) || {
          route: rk,
          bookings: 0,
          revenue: 0
        };

      r.bookings += 1;
      r.revenue += b.fare;

      routes.set(rk, r);

      const day =
        new Date(
          new Date(
            b.departureAt
          ).getTime() +
            (TZ_OFFSET.startsWith("-")
              ? -1
              : 1) *
              (
                Number(
                  TZ_OFFSET.slice(
                    1,
                    3
                  )
                ) *
                  60 +
                Number(
                  TZ_OFFSET.slice(
                    4,
                    6
                  )
                )
              ) *
              60000
        )
          .toISOString()
          .slice(0, 10);

      const d =
        days.get(day) || {
          date: day,
          bookings: 0,
          revenue: 0
        };

      d.bookings += 1;
      d.revenue += b.fare;

      days.set(day, d);
    }

    return res.json({
      success: true,

      report: {
        totalBookings:
          rows.length -
          byStatus.CANCELLED,

        revenue,

        byStatus,

        routes: [
          ...routes.values()
        ].sort(
          (a, b) =>
            b.revenue -
            a.revenue
        ),

        daily: [
          ...days.values()
        ]
          .sort(
            (a, b) =>
              a.date < b.date
                ? 1
                : -1
          )
          .slice(0, 31)
          .reverse()
      }
    });
  } catch (error) {
    return serverError(
      res,
      "Operator Reports Error",
      error
    );
  }
}

// ==========================================
// DETAILED SEAT MAP
// ==========================================

export async function seatMapForOperator(
  req,
  res
) {
  try {
    const schedule =
      await CoachSchedule.findOne({
        _id: req.params.id,
        operator: req.operator.id
      }).populate(
        "coach",
        "name type registrationNumber"
      );

    if (!schedule) {
      return fail(
        res,
        404,
        "Schedule not found"
      );
    }

    const map =
      await operatorSeatMap(
        schedule
      );

    return res.json({
      success: true,

      schedule: {
        _id: schedule._id,
        fromCity:
          schedule.fromCity,
        toCity:
          schedule.toCity,
        departureAt:
          schedule.departureAt,
        arrivalAt:
          schedule.arrivalAt,
        fare:
          schedule.fare,
        status:
          schedule.status,

        coach:
          schedule.coach && {
            name:
              schedule.coach.name,
            type:
              schedule.coach.type,
            registrationNumber:
              schedule.coach
                .registrationNumber
          }
      },

      ...map
    });
  } catch (error) {
    return serverError(
      res,
      "Operator Seat Map Error",
      error
    );
  }
}

// ==========================================
// CASH COLLECTION
// ==========================================

export async function collectCash(
  req,
  res
) {
  try {
    const b =
      await CoachBooking.findOne({
        _id: req.params.id,
        operator: req.operator.id
      });

    if (!b) {
      return fail(
        res,
        404,
        "Booking not found"
      );
    }

    if (
      b.status !== "CONFIRMED" ||
      b.paymentMethod !== "CASH"
    ) {
      return fail(
        res,
        409,
        "Only confirmed cash bookings can be marked as paid"
      );
    }

    if (b.paymentStatus === "PAID") {
      return res.json({
        success: true,
        message:
          "Already marked as paid",
        booking: bookingView(
          await populateBooking(
            CoachBooking.findById(
              b._id
            )
          )
        )
      });
    }

    const updated =
      await CoachBooking.findOneAndUpdate(
        {
          _id: b._id,
          operator: req.operator.id,
          status: "CONFIRMED",
          paymentMethod: "CASH",
          paymentStatus: "CASH_DUE"
        },
        {
          $set: {
            paymentStatus: "PAID",
            cashCollectedAt:
              new Date(),
            cashCollectedBy:
              req.user.id
          }
        },
        {
          returnDocument: "after"
        }
      );

    if (!updated) {
      return fail(
        res,
        409,
        "This booking changed. Please refresh."
      );
    }

    if (
      b.order &&
      !(
        await CoachBooking.exists({
          order: b.order,
          status: "CONFIRMED",
          paymentStatus: "CASH_DUE"
        })
      )
    ) {
      await CoachOrder.updateOne(
        {
          _id: b.order,
          paymentMethod: "CASH"
        },
        {
          $set: {
            paymentStatus: "PAID"
          }
        }
      );
    }

    await audit(
      req,
      "payment.cash_collected",
      {
        entityType: "Booking",
        entityId: b._id,
        meta: {
          bookingCode:
            b.bookingCode,
          fare: b.fare
        }
      }
    );

    await createNotification(
      b.customer,
      {
        type:
          "coach_payment_success",

        title:
          "Cash payment recorded",

        message:
          `The operator recorded your cash payment of ${b.fare} PKR for booking ${b.bookingCode}.`,

        serviceType:
          "coach_booking",

        serviceId:
          b._id
      }
    );

    await pushSeatUpdate(
      b.schedule,
      [b.seat],
      "BOOKED"
    );

    return res.json({
      success: true,
      message:
        "Cash payment recorded",
      booking: bookingView(
        await populateBooking(
          CoachBooking.findById(
            b._id
          )
        )
      )
    });
  } catch (error) {
    return serverError(
      res,
      "Collect Cash Error",
      error
    );
  }
}

// ==========================================
// BLOCK / UNBLOCK SEAT
// ==========================================

export async function setSeatBlocked(
  req,
  res
) {
  try {
    const seat = str(
      req.params.seat,
      4
    );

    const wantBlocked =
      req.body?.blocked !== false;

    const schedule =
      await CoachSchedule.findOne({
        _id: req.params.id,
        operator: req.operator.id
      });

    if (!schedule) {
      return fail(
        res,
        404,
        "Schedule not found"
      );
    }

    if (
      schedule.status !== "scheduled"
    ) {
      return fail(
        res,
        409,
        "This trip is no longer open"
      );
    }

    if (
      !buildSeats({
        ...(schedule.layout.toObject?.() ??
          schedule.layout),
        blocked: []
      }).some(
        (x) => x.label === seat
      )
    ) {
      return fail(
        res,
        400,
        "That seat does not exist on this coach"
      );
    }

    const isBlocked =
      (
        schedule.layout.blocked ||
        []
      ).includes(seat);

    if (
      isBlocked === wantBlocked
    ) {
      return res.json({
        success: true,
        blocked: isBlocked,
        message: isBlocked
          ? "Seat already blocked"
          : "Seat already on sale"
      });
    }

    if (wantBlocked) {
      if (
        sellableSeats(
          schedule.layout
        ) <= 1
      ) {
        return fail(
          res,
          409,
          "At least one seat must stay on sale"
        );
      }

      const set =
        await CoachSchedule.updateOne(
          {
            _id: schedule._id,
            status: "scheduled",
            "layout.blocked": {
              $ne: seat
            }
          },
          {
            $addToSet: {
              "layout.blocked":
                seat
            },
            $inc: {
              totalSeats: -1
            }
          }
        );

      if (!set.modifiedCount) {
        return res.json({
          success: true,
          blocked: true,
          message:
            "Seat already blocked"
        });
      }

      if (
        await CoachBooking.exists({
          schedule: schedule._id,
          seat,
          ...occupiedFilter()
        })
      ) {
        await CoachSchedule.updateOne(
          {
            _id: schedule._id,
            "layout.blocked": seat
          },
          {
            $pull: {
              "layout.blocked":
                seat
            },
            $inc: {
              totalSeats: 1
            }
          }
        );

        return fail(
          res,
          409,
          "This seat is held or booked. Cancel the booking first, or wait for the hold to end."
        );
      }
    } else {
      await CoachSchedule.updateOne(
        {
          _id: schedule._id,
          "layout.blocked": seat
        },
        {
          $pull: {
            "layout.blocked": seat
          },
          $inc: {
            totalSeats: 1
          }
        }
      );
    }

    await audit(
      req,
      wantBlocked
        ? "schedule.seat_blocked"
        : "schedule.seat_unblocked",
      {
        entityType: "Schedule",
        entityId: schedule._id,
        meta: {
          seat
        }
      }
    );

    await pushSeatUpdate(
      schedule._id,
      [seat],
      wantBlocked
        ? "BLOCKED"
        : "AVAILABLE"
    );

    return res.json({
      success: true,
      blocked: wantBlocked,
      message: wantBlocked
        ? "Seat blocked"
        : "Seat is on sale again"
    });
  } catch (error) {
    return serverError(
      res,
      "Set Seat Blocked Error",
      error
    );
  }
}

// ==========================================
// TICKET SCANNER
// ==========================================

export async function scanTicket(
  req,
  res
) {
  try {
    const action = [
      "VERIFY",
      "CHECK_IN",
      "BOARD"
    ].includes(
      str(
        req.body?.action,
        10
      ).toUpperCase()
    )
      ? str(
          req.body.action,
          10
        ).toUpperCase()
      : "VERIFY";

    const source =
      req.body?.source === "manual"
        ? "manual"
        : "camera";

    const scheduleId =
      /^[a-fA-F0-9]{24}$/.test(
        str(
          req.body?.scheduleId,
          30
        )
      )
        ? str(
            req.body.scheduleId,
            30
          )
        : undefined;

    const raw = str(
      req.body?.code,
      80
    );

    const log = (
      result,
      booking
    ) =>
      CoachScan.create({
        operator:
          req.operator.id,

        scannedBy:
          req.user.id,

        schedule:
          booking?.schedule ||
          scheduleId,

        booking:
          booking?._id,

        action,
        result,
        source,

        codeHint:
          raw
            .slice(0, 4)
            .replace(
              /[^A-Za-z0-9.]/g,
              ""
            )
      }).catch((e) =>
        console.error(
          "scan log failed:",
          e.message
        )
      );

    const reply = (
      result,
      extra = {}
    ) =>
      res.json({
        success: true,
        result,
        action,
        ...extra
      });

    const parsed =
      parseCode(raw);

    const booking =
      parsed &&
      (await findTicket(
        parsed,
        req.operator.id
      ));

    if (!booking) {
      await log("NOT_FOUND");

      return reply(
        "NOT_FOUND",
        {
          message:
            "No ticket with this code was found for your company."
        }
      );
    }

    const schedule =
      await CoachSchedule.findById(
        booking.schedule
      ).select(
        "status arrivalAt departureAt fromCity toCity"
      );

    let result = judge(
      booking,
      schedule,
      {
        scheduleId
      }
    );

    let current = booking;

    if (
      result === "VALID" &&
      action === "BOARD"
    ) {
      const boarded =
        await boardAtomically(
          booking,
          req.user.id
        );

      if (boarded) {
        current = boarded;
      } else {
        current =
          await CoachBooking.findById(
            booking._id
          );

        result =
          "ALREADY_USED";
      }
    } else if (
      result === "VALID" &&
      action === "CHECK_IN"
    ) {
      const checked =
        await checkInAtomically(
          booking,
          req.user.id
        );

      if (checked) {
        current = checked;
      } else {
        current =
          await CoachBooking.findById(
            booking._id
          );
      }
    }

    await log(
      result,
      booking
    );

    if (
      result === "VALID" &&
      action !== "VERIFY"
    ) {
      await audit(
        req,
        action === "BOARD"
          ? "ticket.boarded"
          : "ticket.checked_in",
        {
          entityType:
            "Booking",

          entityId:
            booking._id,

          meta: {
            bookingCode:
              booking.bookingCode,

            schedule:
              String(
                booking.schedule
              ),

            source
          }
        }
      );
    } else if (
      result === "ALREADY_USED" ||
      result === "CANCELLED" ||
      result === "EXPIRED" ||
      result === "WRONG_TRIP"
    ) {
      await audit(
        req,
        "ticket.scan_rejected",
        {
          entityType:
            "Booking",

          entityId:
            booking._id,

          meta: {
            result,
            action
          }
        }
      );
    }

    const ticket =
      ["NOT_FOUND"].includes(
        result
      )
        ? undefined
        : {
            bookingId:
              current._id,

            bookingCode:
              current.bookingCode,

            seat:
              current.seat,

            passenger:
              current.passenger.name,

            phone:
              current.passenger.phone,

            route:
              `${current.fromCity} → ${current.toCity}`,

            departureAt:
              current.departureAt,

            fare:
              current.fare,

            paymentMethod:
              current.paymentMethod,

            paymentStatus:
              current.paymentStatus,

            status:
              current.status,

            checkInStatus:
              current.checkInStatus ||
              "NONE",

            checkedInAt:
              current.checkedInAt,

            boardedAt:
              current.boardedAt,

            scheduleId:
              current.schedule
          };

    const messages = {
      VALID:
        action === "BOARD"
          ? "Passenger boarded."
          : action === "CHECK_IN"
          ? "Passenger checked in."
          : "Valid ticket.",

      ALREADY_USED:
        "This ticket was already used to board.",

      CANCELLED:
        "This ticket was cancelled.",

      EXPIRED:
        "This ticket is no longer valid (trip finished).",

      WRONG_TRIP:
        "This ticket is for a different trip.",

      NOT_FOUND:
        "No ticket with this code was found for your company."
    };

    return reply(
      result,
      {
        message:
          messages[result],
        ticket
      }
    );
  } catch (error) {
    return serverError(
      res,
      "Scan Ticket Error",
      error
    );
  }
}

// ==========================================
// RECENT SCANS
// ==========================================

export async function recentScans(
  req,
  res
) {
  try {
    const rows =
      await CoachScan.find({
        operator: req.operator.id
      })
        .sort({
          scannedAt: -1
        })
        .limit(20)
        .populate(
          "booking",
          "bookingCode seat passenger.name"
        );

    return res.json({
      success: true,
      scans: rows
    });
  } catch (error) {
    return serverError(
      res,
      "Recent Scans Error",
      error
    );
  }
}