import { Server } from "socket.io";
import jwt from "jsonwebtoken";
import userModel from "../../modules/users/user.model.js";
import { CoachSchedule, CoachOperator, CoachBooking } from "../../modules/coach/coach.model.js";
import { allowedOrigins } from "../config/env.js";
import { ACCESS_COOKIE, isSessionActive } from "../auth/session.service.js";

let io = null;

function readCookie(header = "", name) {
  const part = header.split(";").map((c) => c.trim()).find((c) => c.startsWith(`${name}=`));
  return part ? decodeURIComponent(part.slice(name.length + 1)) : null;
}

const isId = (v) => typeof v === "string" && /^[a-fA-F0-9]{24}$/.test(v);

// ---------- room names ----------
// user:<id>          private notifications + a driver's location for the customer of their active trip
// session:<sid>      lets logout close exactly that device's socket
// coach:<id>         PUBLIC seat state of one schedule (seat labels + status only, never passenger data)
// coach:<id>:ops     operator-owner / admin only (passenger details, scans, manifest)
export const userRoom = (id) => `user:${id}`;
export const sessionRoom = (sid) => `session:${sid}`;
export const coachRoom = (scheduleId) => `coach:${scheduleId}`;
export const coachOpsRoom = (scheduleId) => `coach:${scheduleId}:ops`;
// track:<id>  live position of ONE coach: admin, the owning operator, and customers holding a confirmed ticket on that trip
export const trackRoom = (scheduleId) => `track:${scheduleId}`;

const MAX_WATCHED = 3;

// Decides who may watch a schedule. Returns { ok, ops } or { ok:false, message }
async function authorizeSchedule(socket, scheduleId) {
  const schedule = await CoachSchedule.findById(scheduleId).select("operator status").lean();
  if (!schedule) return { ok: false, message: "Schedule not found" };

  const { role, operatorId } = socket.data;

  if (role === "admin") return { ok: true, ops: true };

  if (role === "operator") {
    // Operators only ever see their own schedules, never a competitor's
    if (operatorId && String(schedule.operator) === operatorId) return { ok: true, ops: true };
    return { ok: false, message: "Not allowed" };
  }

  if (role === "customer") {
    if (schedule.status === "cancelled") return { ok: false, message: "Schedule not available" };
    return { ok: true, ops: false };
  }

  return { ok: false, message: "Not allowed" };
}

export function initSocket(httpServer) {
  const origins = allowedOrigins();

  io = new Server(httpServer, {
    cors: { origin: origins, credentials: true },
    // WebSocket upgrades are not covered by CORS, so cookie-carrying cross-site hijacking has to be
    // blocked here: browsers always send Origin, non-browser clients (no Origin) carry no cookies.
    allowRequest: (req, callback) => {
      const origin = req.headers.origin;
      callback(null, !origin || origins.includes(origin.replace(/\/+$/, "")));
    },
    maxHttpBufferSize: 10 * 1024 // we only ever receive tiny ids
  });

  // Same short-lived access token cookie the REST API uses
  io.use(async (socket, next) => {
    const reject = (code) => {
      const err = new Error("unauthorized");
      err.data = { code };
      next(err);
    };

    try {
      const token = readCookie(socket.handshake.headers.cookie, ACCESS_COOKIE);
      if (!token) return reject("AUTH_REQUIRED");

      let decoded;
      try {
        decoded = jwt.verify(token, process.env.JWT_SECRET);
      } catch (error) {
        return reject(error.name === "TokenExpiredError" ? "AUTH_EXPIRED" : "AUTH_INVALID");
      }

      const [user, active] = await Promise.all([
        userModel.findById(decoded.id).select("role isBlocked"),
        decoded.sid ? isSessionActive(decoded.sid) : false
      ]);

      if (!user || user.isBlocked || !active) return reject("AUTH_INVALID");

      socket.data.userId = user._id.toString();
      socket.data.role = user.role;
      socket.data.sid = String(decoded.sid);

      if (user.role === "operator") {
        const op = await CoachOperator.findOne({ user: user._id }).select("_id").lean();
        socket.data.operatorId = op ? String(op._id) : null;
      }

      next();
    } catch (error) {
      console.error("Socket auth error:", error.message);
      reject("AUTH_INVALID");
    }
  });

  io.on("connection", (socket) => {
    socket.join(userRoom(socket.data.userId));
    socket.join(sessionRoom(socket.data.sid));

    socket.data.watching = new Map(); // scheduleId -> true if ops room joined

    // Tiny per-socket flood guard: 40 events / 10 s
    let windowStart = Date.now();
    let count = 0;
    const allowed = () => {
      const now = Date.now();
      if (now - windowStart > 10_000) { windowStart = now; count = 0; }
      return ++count <= 40;
    };

    const reply = (ack, payload) => typeof ack === "function" && ack(payload);

    socket.on("coach:watch", async (scheduleId, ack) => {
      try {
        if (!allowed()) return reply(ack, { ok: false, message: "Too many requests" });
        if (!isId(scheduleId)) return reply(ack, { ok: false, message: "Invalid schedule" });
        if (socket.data.watching.has(scheduleId)) return reply(ack, { ok: true });

        const result = await authorizeSchedule(socket, scheduleId);
        if (!result.ok) return reply(ack, { ok: false, message: result.message });

        socket.join(coachRoom(scheduleId));
        if (result.ops) socket.join(coachOpsRoom(scheduleId));
        socket.data.watching.set(scheduleId, !!result.ops);

        // Keep at most MAX_WATCHED rooms per socket
        while (socket.data.watching.size > MAX_WATCHED) {
          const oldest = socket.data.watching.keys().next().value;
          socket.leave(coachRoom(oldest));
          socket.leave(coachOpsRoom(oldest));
          socket.data.watching.delete(oldest);
        }

        reply(ack, { ok: true });
      } catch (error) {
        console.error("coach:watch error:", error.message);
        reply(ack, { ok: false, message: "Something went wrong" });
      }
    });

    // ---- live coach tracking: only people who may know where THIS coach is ----
    socket.data.tracking = new Set();
    socket.on("coach:track-watch", async (scheduleId, ack) => {
      try {
        if (!allowed()) return reply(ack, { ok: false, message: "Too many requests" });
        if (!isId(scheduleId)) return reply(ack, { ok: false, message: "Invalid schedule" });
        if (socket.data.tracking.has(scheduleId)) return reply(ack, { ok: true });
        const { role, userId, operatorId } = socket.data;
        let ok = false;
        if (role === "admin") ok = !!(await CoachSchedule.exists({ _id: scheduleId }));
        else if (role === "operator") ok = !!operatorId && !!(await CoachSchedule.exists({ _id: scheduleId, operator: operatorId }));
        else if (role === "customer") ok = !!(await CoachBooking.exists({ schedule: scheduleId, customer: userId, status: { $in: ["CONFIRMED", "COMPLETED"] } }));
        if (!ok) return reply(ack, { ok: false, message: "Not allowed" });
        if (socket.data.tracking.size >= 3) { const oldest = socket.data.tracking.values().next().value; socket.leave(trackRoom(oldest)); socket.data.tracking.delete(oldest); }
        socket.join(trackRoom(scheduleId));
        socket.data.tracking.add(scheduleId);
        reply(ack, { ok: true });
      } catch (error) {
        console.error("coach:track-watch error:", error.message);
        reply(ack, { ok: false, message: "Something went wrong" });
      }
    });
    socket.on("coach:track-unwatch", (scheduleId) => {
      if (!isId(scheduleId)) return;
      socket.data.tracking.delete(scheduleId);
      socket.leave(trackRoom(scheduleId));
    });

    socket.on("coach:unwatch", (scheduleId) => {
      if (!isId(scheduleId)) return;
      socket.data.watching.delete(scheduleId);
      socket.leave(coachRoom(scheduleId));
      socket.leave(coachOpsRoom(scheduleId));
    });
  });

  return io;
}

// Safe no-ops when sockets are not initialised (scripts/tests/serverless)
export function emitToUser(userId, event, payload) {
  if (!io || !userId) return;
  io.to(userRoom(userId.toString())).emit(event, payload);
}

export function emitToRoom(room, event, payload) {
  if (!io) return;
  io.to(room).emit(event, payload);
}

// Called on logout / block / "log out everywhere" so a revoked login cannot keep receiving data
export function disconnectSession(sid) {
  if (io && sid) io.in(sessionRoom(String(sid))).disconnectSockets(true);
}

export function disconnectUser(userId) {
  if (io && userId) io.in(userRoom(String(userId))).disconnectSockets(true);
}

export const socketReady = () => !!io;

export async function closeSocket() {
  if (io) await io.close();
  io = null;
}
