import crypto from "crypto";
import mongoose from "mongoose";
import { CoachBooking, CoachSchedule } from "./coach.model.js";

const { ObjectId } = mongoose.Schema.Types;

// ---------------------------------------------------------------------------
// TICKET QR TOKEN: 192 random bits, opaque. The QR contains ONLY "BD1.<token>": no name, phone, seat or fare.
// Everything is looked up on the server, so a screenshot reveals nothing and a forged QR simply is not found.
// ---------------------------------------------------------------------------
export const newQrToken = () => crypto.randomBytes(24).toString("base64url");
export const qrPayloadOf = (token) => `BD1.${token}`;

// Legacy / demo tickets made before QR existed get their token the first time it is needed (race-safe)
export async function ensureQrToken(booking) {
  if (booking.qrToken) return booking.qrToken;
  const token = newQrToken();
  const updated = await CoachBooking.findOneAndUpdate({ _id: booking._id, qrToken: { $exists: false } }, { $set: { qrToken: token } }, { returnDocument: "after" });
  if (updated) return updated.qrToken;
  return (await CoachBooking.findById(booking._id).select("+qrToken")).qrToken;
}

// ---------------------------------------------------------------------------
// SCAN LOG: every scan attempt is recorded (who, when, what, result), including failed ones
// ---------------------------------------------------------------------------
const scanSchema = new mongoose.Schema(
  {
    operator: { type: ObjectId, ref: "CoachOperator", required: true },
    scannedBy: { type: ObjectId, ref: "User", required: true },
    schedule: { type: ObjectId, ref: "CoachSchedule", default: undefined },
    booking: { type: ObjectId, ref: "CoachBooking", default: undefined },
    action: { type: String, enum: ["VERIFY", "CHECK_IN", "BOARD"], required: true },
    result: { type: String, enum: ["VALID", "ALREADY_USED", "CANCELLED", "NOT_FOUND", "EXPIRED", "WRONG_TRIP"], required: true },
    source: { type: String, enum: ["camera", "manual"], default: "camera" },
    codeHint: { type: String, default: "", maxlength: 8 }, // first characters only: never the whole token
    scannedAt: { type: Date, default: Date.now }
  },
  { timestamps: false }
);
scanSchema.index({ operator: 1, scannedAt: -1 });
scanSchema.index({ booking: 1, scannedAt: -1 });
scanSchema.index({ schedule: 1, scannedAt: -1 });
export const CoachScan = mongoose.models.CoachScan || mongoose.model("CoachScan", scanSchema);

// "BD1.<token>" | booking code ("BD7K2PX9Q", spaces/dashes tolerated)
export function parseCode(raw) {
  const text = String(raw || "").trim();
  if (text.length < 6 || text.length > 80) return null;
  if (text.startsWith("BD1.")) {
    const token = text.slice(4);
    return /^[A-Za-z0-9_-]{20,64}$/.test(token) ? { by: "token", value: token } : null;
  }
  const code = text.toUpperCase().replace(/[\s-]/g, "");
  return /^[A-Z0-9]{6,20}$/.test(code) ? { by: "code", value: code } : null;
}

// Decides what a scan means. Pure reading: it changes nothing.
export function judge(booking, schedule, { scheduleId, now = new Date() } = {}) {
  if (booking.status === "CANCELLED" || schedule?.status === "cancelled") return "CANCELLED";
  if (booking.status === "EXPIRED" || booking.status === "COMPLETED" || (schedule && schedule.arrivalAt <= now)) return "EXPIRED";
  if (booking.status !== "CONFIRMED") return "NOT_FOUND"; // a hold is not a ticket
  if (scheduleId && String(booking.schedule) !== String(scheduleId)) return "WRONG_TRIP";
  if (booking.boardedAt) return "ALREADY_USED";
  return "VALID";
}

export async function findTicket(parsed, operatorId) {
  // Codes are stored as "BD-ABC123"; people type them with or without the dash, in any case
  const dashed = `${parsed.value.slice(0, 2)}-${parsed.value.slice(2)}`;
  const filter = parsed.by === "token" ? { qrToken: parsed.value } : { bookingCode: { $in: [parsed.value, dashed] } };
  // Scoped to the scanning operator: another company's ticket is simply "not found" (nothing is leaked)
  return CoachBooking.findOne({ ...filter, operator: operatorId }).select("+qrToken");
}

export async function boardAtomically(booking, userId, now = new Date()) {
  return CoachBooking.findOneAndUpdate(
    { _id: booking._id, status: "CONFIRMED", boardedAt: { $exists: false } },
    { $set: { checkInStatus: "BOARDED", boardedAt: now, boardedBy: userId, ...(booking.checkedInAt ? {} : { checkedInAt: now, checkedInBy: userId }) } },
    { returnDocument: "after" }
  );
}

export async function checkInAtomically(booking, userId, now = new Date()) {
  return CoachBooking.findOneAndUpdate(
    { _id: booking._id, status: "CONFIRMED", checkInStatus: "NONE", boardedAt: { $exists: false } },
    { $set: { checkInStatus: "CHECKED_IN", checkedInAt: now, checkedInBy: userId } },
    { returnDocument: "after" }
  );
}

export { CoachSchedule };
