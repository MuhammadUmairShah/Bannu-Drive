import bcrypt from "bcrypt";
import crypto from "crypto";
import userModel from "../users/user.model.js";
import { CoachOperator, Coach, CoachRoute, CoachSchedule, CoachBooking, cityKey } from "./coach.model.js";
import { sellableSeats, localToday, TZ_OFFSET, ACTIVE_STATUSES, cancelBookingRecord } from "./coach.service.js";
import { releaseScheduleHolds } from "./coach.holds.js";

// Clearly-labelled DEMO data. These are NOT real partners of Bannu Drive.
export const DEMO_EMAIL = "adil.coaches.demo@example.com";
export const DEMO_COMPANY = "Adil Coaches - DEMO";
const DEMO_PHONE = "03009990001";

const LAYOUT_40 = { rows: 10, left: 2, right: 2, blocked: [] }; // 40 seats, 2 + 2

const ROUTES = [
  { fromCity: "Bannu", toCity: "Peshawar", distanceKm: 200, durationMin: 240, departures: [{ at: "08:00", fare: 1200 }, { at: "15:00", fare: 1200 }] },
  { fromCity: "Bannu", toCity: "Islamabad", distanceKm: 330, durationMin: 360, departures: [{ at: "07:00", fare: 2200 }] }
];

// "2026-10-05" + "08:00" in the operating timezone -> Date
const at = (day, hhmm) => new Date(`${day}T${hhmm}:00${TZ_OFFSET}`);
const addDays = (day, n) => new Date(new Date(`${day}T12:00:00Z`).getTime() + n * 86400000).toISOString().slice(0, 10);

export async function ensureDemoOperator(password) {
  let user = await userModel.findOne({ email: DEMO_EMAIL });
  let created = false;
  let usedPassword = null;

  if (!user) {
    usedPassword = password || crypto.randomBytes(9).toString("base64url");
    user = await userModel.create({
      name: "Adil Coaches Demo Operator", email: DEMO_EMAIL, phone: DEMO_PHONE, role: "operator",
      password: await bcrypt.hash(usedPassword, 10), isVerified: true
    });
    created = true;
  } else if (user.role !== "operator") {
    throw new Error(`${DEMO_EMAIL} already exists with another role`);
  }

  let op = await CoachOperator.findOne({ user: user._id });
  if (!op) op = await CoachOperator.create({ user: user._id, companyName: DEMO_COMPANY, contactPhone: DEMO_PHONE, isDemo: true });

  return { user, operator: op, created, password: usedPassword };
}

// Creates (or tops up) the demo coach, routes and the next `days` days of departures. Idempotent.
export async function ensureDemoSchedules(days = 14) {
  const op = await CoachOperator.findOne({ isDemo: true });
  if (!op) return { created: 0 };

  let coach = await Coach.findOne({ operator: op._id, name: "Adil Express 40 (DEMO)" });
  if (!coach) {
    coach = await Coach.create({
      operator: op._id, name: "Adil Express 40 (DEMO)", type: "standard", registrationNumber: "DEMO-001",
      amenities: ["Air conditioning", "Reclining seats"], layout: LAYOUT_40, totalSeats: sellableSeats(LAYOUT_40), isDemo: true
    });
  }
  if (!coach.isActive) return { created: 0 }; // admin switched the demo off

  const today = localToday();
  let made = 0;

  for (const def of ROUTES) {
    let route = await CoachRoute.findOne({ operator: op._id, fromKey: cityKey(def.fromCity), toKey: cityKey(def.toCity) });
    if (!route) {
      route = await CoachRoute.create({
        operator: op._id, fromCity: def.fromCity, toCity: def.toCity, fromKey: cityKey(def.fromCity), toKey: cityKey(def.toCity),
        distanceKm: def.distanceKm, durationMin: def.durationMin, isDemo: true
      });
    }
    if (!route.isActive) continue;

    for (let d = 0; d < days; d++) {
      for (const dep of def.departures) {
        const departureAt = at(addDays(today, d), dep.at);
        if (departureAt <= new Date()) continue;
        // one coach can only run one trip at a time: give each route/departure its own slot
        try {
          await CoachSchedule.create({
            operator: op._id, coach: coach._id, route: route._id,
            fromCity: route.fromCity, toCity: route.toCity, fromKey: route.fromKey, toKey: route.toKey,
            departureAt, arrivalAt: new Date(departureAt.getTime() + def.durationMin * 60000),
            fare: dep.fare, layout: coach.layout, totalSeats: coach.totalSeats, status: "scheduled", isDemo: true
          });
          made += 1;
        } catch (error) {
          if (error.code !== 11000) throw error; // already exists
        }
      }
    }
  }
  return { created: made };
}

export async function seedDemo(password) {
  const result = await ensureDemoOperator(password);
  const sched = await ensureDemoSchedules();
  return { ...result, schedulesCreated: sched.created };
}

// Removes demo schedules nobody booked; cancels (and hides) the rest; deactivates demo coaches/routes.
export async function purgeDemo(adminReason = "Demo data removed by admin") {
  const op = await CoachOperator.findOne({ isDemo: true });
  if (!op) return { removed: 0, cancelled: 0 };

  const schedules = await CoachSchedule.find({ operator: op._id, isDemo: true });
  let removed = 0;
  let cancelledBookings = 0;

  for (const s of schedules) {
    const hasHistory = await CoachBooking.exists({ schedule: s._id });
    if (!hasHistory) {
      await CoachSchedule.deleteOne({ _id: s._id });
      removed += 1;
      continue;
    }
    if (s.status === "scheduled") {
      await CoachSchedule.updateOne({ _id: s._id }, { $set: { status: "cancelled" } });
      await releaseScheduleHolds(s._id, { by: "admin", reason: adminReason });
      const active = await CoachBooking.find({ schedule: s._id, status: { $in: ACTIVE_STATUSES } });
      for (const b of active) {
        if (await cancelBookingRecord(b, { by: "admin", reason: adminReason })) cancelledBookings += 1;
      }
    }
  }

  await Coach.updateMany({ operator: op._id, isDemo: true }, { $set: { isActive: false } });
  await CoachRoute.updateMany({ operator: op._id, isDemo: true }, { $set: { isActive: false } });

  return { removed, cancelledBookings };
}
