import mongoose from "mongoose";

const { ObjectId } = mongoose.Schema.Types;

// Lower-cased, single-spaced key used for searching ("  Bannu " -> "bannu")
export const cityKey = (s) => String(s || "").trim().toLowerCase().replace(/\s+/g, " ");

// ------------------------------------------------------------------
// Seat layout shared by Coach (template) and CoachSchedule (snapshot)
//   rows x (left + right) seats, numbered 01.. row by row, optional aisle between left/right.
// ------------------------------------------------------------------
const layoutSchema = new mongoose.Schema(
  {
    rows: { type: Number, required: true, min: 1, max: 20 },
    left: { type: Number, required: true, min: 1, max: 3 },
    right: { type: Number, required: true, min: 0, max: 3 },
    blocked: { type: [String], default: [] } // seats that can never be sold (broken, crew, etc.)
  },
  { _id: false }
);

// ------------------------------------------------------------------
// 1. Operator company profile (login lives on User with role "operator")
// ------------------------------------------------------------------
const operatorSchema = new mongoose.Schema(
  {
    user: { type: ObjectId, ref: "User", required: true, unique: true },
    companyName: { type: String, required: true, trim: true, minlength: 2, maxlength: 80 },
    contactPhone: { type: String, default: "", trim: true, maxlength: 20 },
    // Wallet accounts customers pay into (manual EasyPaisa / JazzCash). The operator receives the money directly.
    paymentAccounts: {
      type: new mongoose.Schema(
        {
          easypaisa: { type: new mongoose.Schema({ number: { type: String, default: "" }, title: { type: String, default: "" }, enabled: { type: Boolean, default: false } }, { _id: false }), default: () => ({}) },
          jazzcash: { type: new mongoose.Schema({ number: { type: String, default: "" }, title: { type: String, default: "" }, enabled: { type: Boolean, default: false } }, { _id: false }), default: () => ({}) }
        },
        { _id: false }
      ),
      default: () => ({})
    },
    isDemo: { type: Boolean, default: false }
  },
  { timestamps: true }
);

// ------------------------------------------------------------------
// 2. Coach (a vehicle + its seat layout)
// ------------------------------------------------------------------
const coachSchema = new mongoose.Schema(
  {
    operator: { type: ObjectId, ref: "CoachOperator", required: true, index: true },
    name: { type: String, required: true, trim: true, minlength: 2, maxlength: 60 },
    type: { type: String, enum: ["standard", "executive", "luxury", "minibus"], default: "standard" },
    registrationNumber: { type: String, default: "", trim: true, maxlength: 20 },
    amenities: { type: [String], default: [] },
    layout: { type: layoutSchema, required: true },
    totalSeats: { type: Number, required: true, min: 1 },
    isActive: { type: Boolean, default: true },
    isDemo: { type: Boolean, default: false }
  },
  { timestamps: true }
);

// ------------------------------------------------------------------
// 3. Route (operator A -> B). Cities are free text, so any city pair works.
// ------------------------------------------------------------------
// One stop on a route. Structured data (not free text): coordinates are optional but required for live progress.
//   kind: boarding (passengers may get on) | dropping (may get off) | both | intermediate (the coach passes, nobody boards/leaves)
export const STOP_KINDS = ["boarding", "dropping", "both", "intermediate"];
const stopSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true, minlength: 2, maxlength: 60 },
    kind: { type: String, enum: STOP_KINDS, default: "both" },
    latitude: { type: Number, min: -90, max: 90, default: undefined },
    longitude: { type: Number, min: -180, max: 180, default: undefined },
    order: { type: Number, required: true, min: 0 },
    arrivalOffsetMin: { type: Number, min: 0, max: 3000, default: 0 }, // minutes after departure from the origin
    departureOffsetMin: { type: Number, min: 0, max: 3000, default: 0 }
  },
  { _id: true }
);

const routeSchema = new mongoose.Schema(
  {
    operator: { type: ObjectId, ref: "CoachOperator", required: true, index: true },
    fromCity: { type: String, required: true, trim: true, minlength: 2, maxlength: 50 },
    toCity: { type: String, required: true, trim: true, minlength: 2, maxlength: 50 },
    fromKey: { type: String, required: true },
    toKey: { type: String, required: true },
    distanceKm: { type: Number, default: null, min: 0 },
    durationMin: { type: Number, default: null, min: 0 },
    isActive: { type: Boolean, default: true },
    stops: { type: [stopSchema], default: [] }, // empty = origin and destination only (no coordinates)
    isDemo: { type: Boolean, default: false }
  },
  { timestamps: true }
);

routeSchema.index({ operator: 1, fromKey: 1, toKey: 1 }, { unique: true });

// ------------------------------------------------------------------
// 4. Schedule (one departure of a coach on a route)
// ------------------------------------------------------------------
const scheduleSchema = new mongoose.Schema(
  {
    operator: { type: ObjectId, ref: "CoachOperator", required: true },
    coach: { type: ObjectId, ref: "Coach", required: true },
    route: { type: ObjectId, ref: "CoachRoute", required: true },
    // Denormalised for fast search + so history survives route edits
    fromCity: { type: String, required: true },
    toCity: { type: String, required: true },
    fromKey: { type: String, required: true },
    toKey: { type: String, required: true },
    departureAt: { type: Date, required: true },
    arrivalAt: { type: Date, required: true },
    fare: { type: Number, required: true, min: 1, max: 50000 },
    // Layout is copied at creation, so editing a coach later never changes a sold schedule
    layout: { type: layoutSchema, required: true },
    totalSeats: { type: Number, required: true, min: 1 },
    status: { type: String, enum: ["scheduled", "cancelled", "completed"], default: "scheduled" },
    // Copy of the route's stops with absolute times, so editing a route later never changes a sold schedule
    stops: {
      type: [new mongoose.Schema({ stopId: ObjectId, name: String, kind: String, latitude: Number, longitude: Number, order: Number, arrivalAt: Date, departureAt: Date }, { _id: false })],
      default: []
    },
    // The real-world journey. `status` above stays the commercial state (scheduled/cancelled/completed).
    trip: {
      state: { type: String, enum: ["SCHEDULED", "BOARDING", "DEPARTED", "IN_TRANSIT", "ARRIVED", "COMPLETED", "CANCELLED"], default: "SCHEDULED" },
      stateChangedAt: { type: Date, default: undefined },
      delayMin: { type: Number, default: 0, min: 0, max: 1440 },
      history: { type: [new mongoose.Schema({ state: String, at: Date, by: ObjectId }, { _id: false })], default: [] },
      // The last REAL GPS fix received from the coach's device. Never invented, never extrapolated.
      lastLocation: { latitude: Number, longitude: Number, accuracy: Number, speed: Number, heading: Number, at: Date, receivedAt: Date }
    },
    // Bumped on every seat change; sockets carry it so clients can detect a missed event and re-fetch
    seatVersion: { type: Number, default: 0 },
    isDemo: { type: Boolean, default: false }
  },
  { timestamps: true }
);

scheduleSchema.index({ fromKey: 1, toKey: 1, departureAt: 1 });
scheduleSchema.index({ operator: 1, departureAt: 1 });
scheduleSchema.index({ coach: 1, departureAt: 1 }, { unique: true }); // a coach cannot depart twice at once

// ------------------------------------------------------------------
// 5. Booking: ONE seat, ONE passenger
//    activeSeatKey is present only while the booking holds the seat. A sparse UNIQUE index on it
//    is what makes double booking impossible, even for simultaneous requests.
// ------------------------------------------------------------------
export const BOOKING_STATUS = ["HOLD", "PENDING_PAYMENT", "CONFIRMED", "CANCELLED", "EXPIRED", "COMPLETED"];

const bookingSchema = new mongoose.Schema(
  {
    bookingCode: { type: String, required: true, unique: true }, // BD-XXXXXX
    customer: { type: ObjectId, ref: "User", required: true },
    operator: { type: ObjectId, ref: "CoachOperator", required: true },
    schedule: { type: ObjectId, ref: "CoachSchedule", required: true },
    seat: { type: String, required: true },
    passenger: {
      name: { type: String, required: true, trim: true, maxlength: 60 },
      phone: { type: String, required: true, trim: true, maxlength: 20 },
      gender: { type: String, enum: ["male", "female", ""], default: "" }
    },
    fare: { type: Number, required: true, min: 1 },
    status: { type: String, enum: BOOKING_STATUS, default: "CONFIRMED" },
    // The order (one checkout, one payment) this seat belongs to. Absent only on legacy / demo data.
    order: { type: ObjectId, ref: "CoachOrder", default: undefined },
    // While HOLD / PENDING_PAYMENT the seat is reserved only until this instant (see coach.config.js)
    holdExpiresAt: { type: Date, default: undefined },
    boardingPoint: { type: new mongoose.Schema({ stopId: ObjectId, name: String, order: Number, time: Date }, { _id: false }), default: undefined },
    droppingPoint: { type: new mongoose.Schema({ stopId: ObjectId, name: String, order: Number, time: Date }, { _id: false }), default: undefined },
    paymentMethod: { type: String, enum: ["CASH", "ONLINE", ""], default: "" },
    paymentStatus: {
      type: String,
      enum: ["UNPAID", "CASH_DUE", "PENDING", "PAID", "FAILED", "EXPIRED", "REFUND_REQUIRED", "REFUNDED", "CANCELLED"],
      default: "UNPAID"
    },
    confirmedAt: { type: Date, default: undefined },
    // Ticket QR + boarding. The token is never included in any API view except the owner's own ticket (views list their fields explicitly).
    qrToken: { type: String },
    reminderSentAt: { type: Date, default: undefined },
    checkInStatus: { type: String, enum: ["NONE", "CHECKED_IN", "BOARDED"], default: "NONE" },
    checkedInAt: { type: Date, default: undefined },
    checkedInBy: { type: ObjectId, ref: "User", default: undefined },
    boardedAt: { type: Date, default: undefined },
    boardedBy: { type: ObjectId, ref: "User", default: undefined },
    cashCollectedAt: { type: Date, default: undefined },
    cashCollectedBy: { type: ObjectId, ref: "User", default: undefined },
    expiredAt: { type: Date, default: undefined },
    // Only set on records that may be erased later (expired holds, failed attempts): see TTL index below
    purgeAt: { type: Date, default: undefined },
    activeSeatKey: { type: String },
    // Denormalised so a booking reads correctly even if the schedule/route is edited later
    fromCity: { type: String, required: true },
    toCity: { type: String, required: true },
    departureAt: { type: Date, required: true },
    arrivalAt: { type: Date, required: true },
    cancelledAt: { type: Date, default: null },
    cancelledBy: { type: String, enum: ["customer", "operator", "admin", ""], default: "" },
    cancelReason: { type: String, default: "", trim: true, maxlength: 200 },
    isDemo: { type: Boolean, default: false }
  },
  { timestamps: true }
);

bookingSchema.index({ activeSeatKey: 1 }, { unique: true, sparse: true });
bookingSchema.index({ customer: 1, departureAt: -1 });
bookingSchema.index({ operator: 1, createdAt: -1 });
bookingSchema.index({ schedule: 1, status: 1 });
bookingSchema.index({ order: 1, status: 1 });
bookingSchema.index({ qrToken: 1 }, { unique: true, sparse: true });
bookingSchema.index({ status: 1, holdExpiresAt: 1 }); // expiry sweeper
bookingSchema.index({ purgeAt: 1 }, { expireAfterSeconds: 0 }); // MongoDB erases expired/failed records once purgeAt passes

export const CoachOperator = mongoose.model("CoachOperator", operatorSchema);
export const Coach = mongoose.model("Coach", coachSchema);
export const CoachRoute = mongoose.model("CoachRoute", routeSchema);
export const CoachSchedule = mongoose.model("CoachSchedule", scheduleSchema);
export const CoachBooking = mongoose.model("CoachBooking", bookingSchema);

// Position history of a trip (for audit and for the "where was the coach" question). Erased automatically after 7 days.
const tripPointSchema = new mongoose.Schema(
  {
    schedule: { type: ObjectId, ref: "CoachSchedule", required: true },
    operator: { type: ObjectId, ref: "CoachOperator", required: true },
    latitude: Number, longitude: Number, accuracy: Number, speed: Number, heading: Number,
    at: { type: Date, required: true },
    receivedAt: { type: Date, default: Date.now }
  },
  { timestamps: false }
);
tripPointSchema.index({ schedule: 1, at: -1 });
tripPointSchema.index({ receivedAt: 1 }, { expireAfterSeconds: 7 * 24 * 3600 });
export const CoachTripPoint = mongoose.models.CoachTripPoint || mongoose.model("CoachTripPoint", tripPointSchema);
