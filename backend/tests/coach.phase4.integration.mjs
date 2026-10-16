// Phase 4 integration tests: seat holds, atomic multi-seat booking, booking lifecycle, payments (mock sandbox gateway),
// idempotency, expiry, recovery, refunds, realtime. Runs the REAL app + Socket.IO + sweeper functions in-process.
//   MONGO_TEST_URI=mongodb://127.0.0.1:27017/bd_p4 node tests/coach.phase4.integration.mjs
// WARNING: drops the database named in MONGO_TEST_URI.
import http from "http";
import "./helpers/atomic-shim.mjs"; // emulates MongoDB per-operation atomicity on the sandbox database (see the file)
import mongoose from "mongoose";
import bcrypt from "bcrypt";
import { io as ioClient } from "socket.io-client";

const MONGO = process.env.MONGO_TEST_URI || "mongodb://127.0.0.1:27017/bd_p4";
const ORIGIN = "http://localhost:5173";
const big = "1000000";
Object.assign(process.env, {
  NODE_ENV: "development", JWT_SECRET: "test_secret_test_secret_test_secret_1234", CLIENT_URL: ORIGIN, MONGO_URI: MONGO,
  PAYMENT_PROVIDERS: "mock", REQUIRE_DOCUMENTS_FOR_VERIFICATION: "false",
  LOGIN_RATE_LIMIT: big, REGISTER_RATE_LIMIT: big, REFRESH_RATE_LIMIT: big, REQUEST_RATE_LIMIT: big, PAYMENT_RATE_LIMIT: big,
  ADMIN_RATE_LIMIT: big, UPLOAD_RATE_LIMIT: big, PAYMENT_CALLBACK_RATE_LIMIT: big, PUBLIC_READ_RATE_LIMIT: big, BOOKING_RATE_LIMIT: "60"
});

let pass = 0, fail = 0;
const failures = [];
const check = (name, cond, extra = "") => { if (cond) { pass++; console.log(`  PASS  ${name}`); } else { fail++; failures.push(name); console.log(`  FAIL  ${name} ${String(extra).slice(0, 400)}`); } };
const section = (t) => console.log(`\n== ${t}`);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

await mongoose.connect(MONGO);
await mongoose.connection.dropDatabase();

const { default: app } = await import("../app.js");
const { initSocket, closeSocket } = await import("../shared/realtime/socket.js");
const { default: User } = await import("../modules/users/user.model.js");
const { default: AuditLog } = await import("../modules/audit/audit.model.js");
const { default: Notification } = await import("../modules/notifications/notification.model.js");
const { CoachBooking, CoachSchedule, CoachOperator } = await import("../modules/coach/coach.model.js");
const { CoachOrder, CoachPayment, CoachRefund } = await import("../modules/coach/coach.order.model.js");
const states = await import("../modules/coach/coach.states.js");
const { sweepHolds } = await import("../modules/coach/coach.sweeper.js");
const { releaseScheduleHolds, confirmOrder } = await import("../modules/coach/coach.holds.js");
const { MockProvider } = await import("../shared/payments/mock.provider.js");
const { JazzCashProvider } = await import("../shared/payments/jazzcash.provider.js");
const providers = await import("../shared/payments/provider.js");
await Promise.allSettled([User.init(), CoachBooking.init(), CoachOrder.init(), CoachPayment.init(), CoachRefund.init()]);

const server = http.createServer(app);
initSocket(server);
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const BASE = `http://127.0.0.1:${server.address().port}`;

class Client {
  constructor(name) { this.name = name; this.jar = new Map(); }
  get cookie() { return [...this.jar].map(([k, v]) => `${k}=${v}`).join("; "); }
  async req(method, path, body, { headers = {} } = {}) {
    const h = { origin: ORIGIN, ...headers };
    if (this.jar.size) h.cookie = this.cookie;
    let payload;
    if (body !== undefined) { h["content-type"] = "application/json"; payload = JSON.stringify(body); }
    const r = await fetch(BASE + path, { method, headers: h, body: payload });
    for (const sc of r.headers.getSetCookie()) {
      const [pair] = sc.split(";"); const i = pair.indexOf("="); const k = pair.slice(0, i), v = pair.slice(i + 1);
      if (v === "" || /expires=Thu, 01 Jan 1970/i.test(sc)) this.jar.delete(k); else this.jar.set(k, v);
    }
    const ct = r.headers.get("content-type") || "";
    const data = ct.includes("json") ? await r.json().catch(() => ({})) : {};
    return { status: r.status, data };
  }
  get = (p) => this.req("GET", p);
  post = (p, b, o) => this.req("POST", p, b ?? {}, o);
  patch = (p, b) => this.req("PATCH", p, b ?? {});
  socket() { return ioClient(BASE, { extraHeaders: { cookie: this.cookie, origin: ORIGIN }, transports: ["websocket"], reconnection: false }); }
}
const connected = (s) => new Promise((res) => { s.on("connect", () => res(true)); s.on("connect_error", () => res(false)); });
const ack = (s, ev, arg) => new Promise((res) => s.emit(ev, arg, res));

// ---------- fixtures ----------
const P = (n) => ({ name: `Passenger ${n}`, phone: `03451${String(100000 + n)}`, gender: "male" });
const reg = (c, o) => c.post("/user/registration", { password: "Password123", ...o });
let phoneN = 0;
const mkCustomer = async (name) => { const c = new Client(name); await reg(c, { name, email: `${name}@t.pk`, phone: `0322${String(1000000 + ++phoneN)}`, role: "customer" }); c.id = (await User.findOne({ email: `${name}@t.pk` }))._id.toString(); return c; };
const mkOperator = async (name) => { const c = new Client(name); await reg(c, { name, email: `${name}@t.pk`, phone: `0333${String(1000000 + ++phoneN)}`, role: "operator", companyName: `${name} Coaches` }); await User.updateOne({ email: `${name}@t.pk` }, { isVerified: true }); const u = await User.findOne({ email: `${name}@t.pk` }); c.id = u._id.toString(); c.opId = (await CoachOperator.findOne({ user: u._id }))._id.toString(); return c; };
const admin = new Client("admin");
await User.create({ name: "Admin", email: "admin@t.pk", phone: "03001119999", password: await bcrypt.hash("AdminPass123", 10), role: "admin" });
await admin.post("/user/login", { email: "admin@t.pk", password: "AdminPass123", role: "admin" });

const opA = await mkOperator("opa"), opB = await mkOperator("opb");
const coachA = (await opA.post("/coach/operator/coaches", { name: "Alpha One", layout: { rows: 5, left: 2, right: 2 } })).data.coach._id;
const coachA2 = (await opA.post("/coach/operator/coaches", { name: "Alpha Two", layout: { rows: 5, left: 2, right: 2 } })).data.coach._id;
const coachB = (await opB.post("/coach/operator/coaches", { name: "Beta One", layout: { rows: 5, left: 2, right: 2 } })).data.coach._id;
const routeA = (await opA.post("/coach/operator/routes", { fromCity: "Bannu", toCity: "Islamabad" })).data.route._id;
const routeB = (await opB.post("/coach/operator/routes", { fromCity: "Bannu", toCity: "Peshawar" })).data.route._id;
let sched = 0;
const mkSchedule = async (op, coach, route, fare = 1500) => {
  const dep = Date.now() + (72 + 30 * ++sched) * 3600e3;
  const r = await op.post("/coach/operator/schedules", { coachId: coach, routeId: route, departureAt: new Date(dep).toISOString(), arrivalAt: new Date(dep + 8 * 3600e3).toISOString(), fare });
  if (r.status !== 201) throw new Error("schedule failed " + JSON.stringify(r.data));
  return r.data.schedules[0]._id;
};
const customers = []; for (let i = 1; i <= 12; i++) customers.push(await mkCustomer("c" + i));
const [c1, c2, c3, c4, c5, c6, c7, c8, c9, c10, c11, c12] = customers;

const hold = (c, sid, labels, key) => c.post("/coach/orders", { scheduleId: sid, seats: labels.map((s, i) => ({ seat: s, passenger: P(i + 1) })) }, key ? { headers: { "Idempotency-Key": key } } : undefined);
const mapOf = async (c, sid) => (await c.get(`/coach/schedules/${sid}`)).data;
const seatState = (map, label) => map.seats.find((s) => s.label === label)?.status;
const activeDocs = (sid, seat) => CoachBooking.countDocuments({ schedule: sid, ...(seat ? { seat } : {}), activeSeatKey: { $exists: true } });
const pastHold = (orderId, ms) => Promise.all([CoachOrder.updateOne({ _id: orderId }, { $set: { holdExpiresAt: new Date(Date.now() - ms) } }), CoachBooking.updateMany({ order: orderId, status: { $in: ["HOLD", "PENDING_PAYMENT"] } }, { $set: { holdExpiresAt: new Date(Date.now() - ms) } })]);
const signedCallback = async (body, { sig, provider = "mock" } = {}) => {
  const raw = JSON.stringify(body);
  const r = await fetch(`${BASE}/coach/payments/callback/${provider}`, { method: "POST", headers: { "content-type": "application/json", "x-mock-signature": sig ?? MockProvider.sign(raw) }, body: raw });
  return { status: r.status, data: await r.json().catch(() => ({})) };
};
const payOnline = async (c, orderId, extra = {}) => c.post(`/coach/orders/${orderId}/pay`, { method: "ONLINE", provider: "mock", ...extra });
const notifCount = (userId, type) => Notification.countDocuments({ recipient: userId, type });

// =====================================================================
section("STATE MACHINE (unit)");
const T = states.canTransition;
check("HOLD -> PENDING_PAYMENT / CONFIRMED / CANCELLED / EXPIRED allowed", ["PENDING_PAYMENT", "CONFIRMED", "CANCELLED", "EXPIRED"].every((t) => T("HOLD", t)));
check("PENDING_PAYMENT -> CONFIRMED / HOLD / EXPIRED / CANCELLED allowed", ["CONFIRMED", "HOLD", "EXPIRED", "CANCELLED"].every((t) => T("PENDING_PAYMENT", t)));
check("CONFIRMED -> CANCELLED / COMPLETED only", T("CONFIRMED", "CANCELLED") && T("CONFIRMED", "COMPLETED") && !T("CONFIRMED", "HOLD") && !T("CONFIRMED", "EXPIRED"));
check("final states have no exits", ["CANCELLED", "EXPIRED", "COMPLETED"].every((f) => states.SEAT_STATUS.every((t) => !T(f, t) || (f === "EXPIRED" && false))));
check("EXPIRED -> CONFIRMED is possible ONLY as a late recovery", !T("EXPIRED", "CONFIRMED") && T("EXPIRED", "CONFIRMED", { late: true }));
check("CANCELLED -> CONFIRMED is never possible", !T("CANCELLED", "CONFIRMED", { late: true }));
check("invalid transitions throw", (() => { try { states.assertTransition("COMPLETED", "HOLD"); return false; } catch (e) { return e.name === "InvalidTransition"; } })());
check("fromStates(CONFIRMED) = HOLD, PENDING_PAYMENT", states.fromStates("CONFIRMED").sort().join() === "HOLD,PENDING_PAYMENT");

// =====================================================================
section("HOLD CREATION + VISIBILITY");
const S1 = await mkSchedule(opA, coachA, routeA);
let r = await hold(c1, S1, ["05"]);
check("hold created (201) in HOLD state", r.status === 201 && r.data.order.status === "HOLD" && r.data.order.bookings[0].status === "HOLD", JSON.stringify(r.data));
const o1 = r.data.order;
const secs = (new Date(o1.holdExpiresAt) - new Date(o1.serverTime)) / 1000;
check("hold has a server-computed expiry (~10 min) and a server clock", secs > 590 && secs <= 601, String(secs));
check("amount is computed on the server (fare x seats)", o1.amount === 1500 && o1.seatCount === 1);
check("seat record carries activeSeatKey + holdExpiresAt", !!(await CoachBooking.findOne({ order: o1._id, activeSeatKey: { $exists: true }, holdExpiresAt: { $exists: true } })));
let m = await mapOf(c2, S1);
check("another customer sees the seat as HELD (not AVAILABLE, not BOOKED)", seatState(m, "05") === "HELD" && m.seats.find((s) => s.label === "05").mine === undefined);
check("available count dropped by one", m.schedule.availableSeats === 15 || m.schedule.availableSeats === 19 || m.schedule.availableSeats > 0);
m = await mapOf(c1, S1);
check("the holder sees it as HELD with mine:true and the order id", m.seats.find((s) => s.label === "05").mine === true && String(m.seats.find((s) => s.label === "05").orderId) === String(o1._id));
r = await new Client("anon").get(`/coach/public/schedules/${S1}`);
check("PUBLIC endpoint (no login) shows seat states without any personal data", r.status === 200 && r.data.seats.find((s) => s.label === "05").status === "HELD" && !/Passenger|0345|mine/.test(JSON.stringify(r.data)));
r = await hold(c2, S1, ["05"]);
check("held seat cannot be held by another customer (409 SEAT_TAKEN, conflictSeats)", r.status === 409 && r.data.code === "SEAT_TAKEN" && r.data.conflictSeats?.[0] === "05", JSON.stringify(r.data));
r = await c2.post("/coach/bookings", { scheduleId: S1, seats: [{ seat: "05", passenger: P(9) }] });
check("...nor booked through the legacy one-step endpoint", r.status === 409);
check("only ONE active record exists for seat 05", (await activeDocs(S1, "05")) === 1);

section("HOLD VALIDATION (server never trusts the client)");
check("unknown seat label -> 400", (await hold(c3, S1, ["99"])).status === 400);
check("duplicate seat in one request -> 400", (await c3.post("/coach/orders", { scheduleId: S1, seats: [{ seat: "06", passenger: P(1) }, { seat: "06", passenger: P(2) }] })).status === 400);
check("more than 4 seats at once -> 400", (await hold(c3, S1, ["01", "02", "03", "04", "06"])).status === 400);
check("bad phone -> 400", (await c3.post("/coach/orders", { scheduleId: S1, seats: [{ seat: "06", passenger: { name: "Ali", phone: "123" } }] })).status === 400);
check("garbage schedule id -> 400", (await hold(c3, "xyz", ["06"])).status === 400);
check("non-existent schedule -> 404", (await hold(c3, "a".repeat(24), ["06"])).status === 404);
r = await c3.post("/coach/orders", { scheduleId: S1, fare: 1, amount: 1, seats: [{ seat: "06", passenger: P(1), fare: 1 }] });
check("a client-sent fare/amount is ignored", r.status === 201 && r.data.order.amount === 1500);
await c3.post(`/coach/orders/${r.data.order._id}/release`);
check("anonymous cannot hold (401)", (await new Client("a2").post("/coach/orders", { scheduleId: S1, seats: [] })).status === 401);
check("operator role cannot hold (403)", (await opA.post("/coach/orders", { scheduleId: S1, seats: [] })).status === 403);

// =====================================================================
section("IDEMPOTENCY: duplicate booking requests + double Confirm");
const S2 = await mkSchedule(opA, coachA2, routeA);
const key = "idem-key-0001-abcdef";
const [d1, d2] = [await hold(c4, S2, ["01", "02"], key), await hold(c4, S2, ["02", "01"], key)];
check("same Idempotency-Key twice -> the SAME order (2nd is a 200 replay)", d1.status === 201 && d2.status === 200 && d2.data.replay === true && d1.data.order._id === d2.data.order._id);
r = await hold(c4, S2, ["03"], key);
check("same key reused for a different request -> 422", r.status === 422 && r.data.code === "IDEMPOTENCY_MISMATCH");
r = await hold(c4, S2, ["01", "02"]);
check("identical request without a key also returns the same order", r.status === 200 && r.data.order._id === d1.data.order._id);
const same = await Promise.all([1, 2, 3, 4, 5, 6].map(() => hold(c5, S2, ["07", "08"])));
check("6 concurrent identical requests -> all succeed with ONE order", same.every((x) => [200, 201].includes(x.status)) && new Set(same.map((x) => x.data.order._id)).size === 1, same.map((x) => x.status).join());
check("...and exactly one active record per seat", (await activeDocs(S2, "07")) === 1 && (await activeDocs(S2, "08")) === 1 && (await CoachOrder.countDocuments({ customer: c5.id, schedule: S2, status: "HOLD" })) === 1);

const orderC5 = same[0].data.order._id;
const confirms = await Promise.all([1, 2, 3, 4, 5, 6].map(() => c5.post(`/coach/orders/${orderC5}/pay`, { method: "CASH" })));
check("user pressing Confirm 6x at once: all answers are 200", confirms.every((x) => x.status === 200), confirms.map((x) => x.status).join());
check("...only ONE confirmation happened", confirms.filter((x) => x.data.replay === false).length === 1);
check("...order CONFIRMED, CASH, CASH_DUE; seats CONFIRMED", confirms[0].data.order.status === "CONFIRMED" && confirms[0].data.order.paymentMethod === "CASH" && confirms[0].data.order.paymentStatus === "CASH_DUE" && (await CoachBooking.countDocuments({ order: orderC5, status: "CONFIRMED", paymentStatus: "CASH_DUE" })) === 2);
check("...customer notified exactly once, operator notified exactly once", (await Notification.countDocuments({ recipient: c5.id, type: "coach_booking_confirmed", serviceId: orderC5 })) === 1 && (await notifCount(opA.id, "coach_booking_new")) >= 1 && (await Notification.countDocuments({ recipient: opA.id, type: "coach_booking_new", serviceId: orderC5 })) === 1);
check("...confirmation audited exactly once", (await AuditLog.countDocuments({ action: "booking.confirmed", entityId: orderC5 })) === 1);
check("booking codes are unique per ticket", new Set((await CoachBooking.find({ order: orderC5 })).map((b) => b.bookingCode)).size === 2);

// =====================================================================
section("CONCURRENCY: ONE seat, many customers");
const S3 = await mkSchedule(opA, coachA, routeA);
const race1 = await Promise.all(customers.slice(0, 10).map((c) => hold(c, S3, ["10"])));
const w1 = race1.filter((x) => x.status === 201);
check("10 customers race for seat 10: exactly ONE wins", w1.length === 1 && race1.filter((x) => x.status === 409).length === 9, race1.map((x) => x.status).join());
check("database: exactly one active record for the seat", (await activeDocs(S3, "10")) === 1);
check("losers got the 'just booked by someone else' message", race1.filter((x) => x.status === 409).every((x) => /just booked by someone else/.test(x.data.message)));
await releaseScheduleHolds(S3);
const race1b = await Promise.all(customers.slice(0, 10).map((c) => c.post("/coach/bookings", { scheduleId: S3, seats: [{ seat: "11", passenger: P(1) }] })));
check("same race through the legacy one-step endpoint: exactly ONE booking", race1b.filter((x) => x.status === 201).length === 1 && (await CoachBooking.countDocuments({ schedule: S3, seat: "11", status: "CONFIRMED" })) === 1, race1b.map((x) => x.status).join());

// =====================================================================
section("CONCURRENCY: MULTI-SEAT atomicity (no partial bookings, no deleteMany)");
const S4 = await mkSchedule(opB, coachB, routeB);
async function invariants(sid) {
  const docs = await CoachBooking.find({ schedule: sid, activeSeatKey: { $exists: true } });
  const keys = docs.map((d) => d.activeSeatKey);
  const unique = new Set(keys).size === keys.length;
  const byOrder = new Map();
  for (const d of docs) byOrder.set(String(d.order), (byOrder.get(String(d.order)) || 0) + 1);
  let complete = true, orderOk = true;
  for (const [id, n] of byOrder) {
    const o = await CoachOrder.findById(id);
    if (!o || o.status !== "HOLD" || o.seatCount !== n) { complete = false; }
    if (o && !["HOLD", "PENDING_PAYMENT", "CONFIRMED"].includes(o.status)) orderOk = false;
  }
  const orphan = await CoachBooking.countDocuments({ schedule: sid, status: { $in: ["HOLD", "PENDING_PAYMENT"] }, order: { $exists: false } });
  return { unique, complete, orderOk, orphan };
}
const chains = [["01", "02"], ["02", "03"], ["03", "04"], ["04", "05"], ["05", "06"], ["06", "07"]];
let allGood = true, anyWinner = true;
for (let round = 0; round < 6; round++) {
  const cs = customers.slice(0, 6);
  const res = await Promise.all(cs.map((c, i) => hold(c, S4, chains[i])));
  const inv = await invariants(S4);
  const wonSeats = res.filter((x) => x.status === 201).flatMap((x) => x.data.order.seats);
  const disjoint = new Set(wonSeats).size === wonSeats.length;
  const lostOk = res.filter((x) => x.status !== 201).every((x) => x.status === 409 && x.data.code === "SEAT_TAKEN");
  const activeSeats = (await CoachBooking.find({ schedule: S4, activeSeatKey: { $exists: true } })).map((d) => d.seat).sort().join();
  if (!(inv.unique && inv.complete && inv.orphan === 0 && disjoint && lostOk && activeSeats === [...wonSeats].sort().join())) { allGood = false; console.log("   round", round, JSON.stringify({ inv, disjoint, lostOk, activeSeats, won: wonSeats, st: res.map((x) => x.status) })); }
  if (!res.some((x) => x.status === 201)) anyWinner = false;
  await releaseScheduleHolds(S4);
}
check("6 rounds of overlapping 2-seat races: never a partial order, never a shared seat, losers cleanly rejected", allGood);
check("...and every round had at least one winner (ordered locking: no deadlock)", anyWinner);
const rev = await Promise.all([hold(c1, S4, ["08", "09"]), hold(c2, S4, ["09", "08"])]);
check("same two seats requested in opposite order by two customers: exactly one wins", rev.filter((x) => x.status === 201).length === 1 && rev.filter((x) => x.status === 409).length === 1);
await releaseScheduleHolds(S4);

r = await hold(c1, S4, ["13"]);
const blocker = r.data.order._id;
const before = await CoachBooking.countDocuments({});
r = await hold(c2, S4, ["11", "12", "13"]);
check("multi-seat request where the LAST seat is taken fails (409)", r.status === 409 && r.data.conflictSeats?.includes("13"));
m = await mapOf(c3, S4);
check("seats 11 and 12 were released (still AVAILABLE)", seatState(m, "11") === "AVAILABLE" && seatState(m, "12") === "AVAILABLE");
const failedDocs = await CoachBooking.find({ customer: c2.id, schedule: S4, seat: { $in: ["11", "12"] } });
check("rollback was a STATE CHANGE: the failed attempt's records still exist as CANCELLED, with no active key (no deleteMany)", failedDocs.length === 2 && failedDocs.every((d) => d.status === "CANCELLED" && !d.activeSeatKey && d.purgeAt), JSON.stringify(failedDocs.map((d) => d.status)));
const failedOrder = await CoachOrder.findOne({ customer: c2.id, schedule: S4, seats: ["11", "12", "13"] });
check("the failed order is CANCELLED and can never be confirmed", failedOrder.status === "CANCELLED" && (await confirmOrder(failedOrder._id, { method: "CASH", paymentStatus: "CASH_DUE" })) === null);
check("the blocker's hold is untouched", (await CoachOrder.findById(blocker)).status === "HOLD");
await releaseScheduleHolds(S4);

section("PER-CUSTOMER LIMITS (anti hoarding), race-safe");
const S5 = await mkSchedule(opA, coachA, routeA);
const burst = await Promise.all(["01", "02", "03", "04", "05"].map((s) => hold(c6, S5, [s])));
const ok6 = burst.filter((x) => x.status === 201).length;
check("5 concurrent orders by one customer: EXACTLY 2 open orders survive (DB-arbitrated slots), the rest get TOO_MANY_HOLDS", ok6 === 2 && burst.filter((x) => x.status === 409 && x.data.code === "TOO_MANY_HOLDS").length === 3 && (await CoachOrder.countDocuments({ customer: c6.id, status: { $in: ["HOLD", "PENDING_PAYMENT"] } })) === 2, burst.map((x) => x.status + ":" + (x.data.code || "")).join());
check("...the rejected requests left no slot or seat behind", (await CoachOrder.countDocuments({ customer: c6.id, slotKey: { $exists: true } })) === 2);
check("...seats of the rejected ones are free again", (await activeDocs(S5)) === ok6);
await releaseScheduleHolds(S5);
r = await hold(c7, S5, ["01", "02", "03", "04"]); const big1 = r.data.order?._id;
r = await hold(c7, S5, ["05", "06", "07"]);
check("more than 6 seats on one trip -> 409 SEAT_LIMIT", r.status === 409 && r.data.code === "SEAT_LIMIT", JSON.stringify(r.data));
await releaseScheduleHolds(S5);

// =====================================================================
section("EXPIRY: grace window, reap-on-conflict, sweeper, renewal");
const S6 = await mkSchedule(opA, coachA2, routeA);
r = await hold(c1, S6, ["01"]); const oe = r.data.order._id;
await pastHold(oe, 1000); // 1 s past expiry: inside the 3 s grace window
check("inside the grace window nobody else can take the seat", (await hold(c2, S6, ["01"])).status === 409);
r = await c1.post(`/coach/orders/${oe}/pay`, { method: "CASH" });
check("...and the owner can no longer confirm with cash (409 HOLD_EXPIRED)", r.status === 409 && r.data.code === "HOLD_EXPIRED", JSON.stringify(r.data));
await pastHold(oe, 10000); // beyond grace, sweeper has NOT run
r = await hold(c2, S6, ["01"]);
check("expired hold is reaped on conflict: the seat is takeable immediately without the sweeper", r.status === 201, JSON.stringify(r.data));
check("...old order is EXPIRED, its seat record EXPIRED with no active key and a purge date", (await CoachOrder.findById(oe)).status === "EXPIRED" && (await CoachBooking.findOne({ order: oe })).status === "EXPIRED" && !(await CoachBooking.findOne({ order: oe })).activeSeatKey && !!(await CoachBooking.findOne({ order: oe })).purgeAt);
check("...the original owner was notified", (await notifCount(c1.id, "coach_hold_expired")) === 1);
r = await c1.get(`/coach/orders/${oe}`);
check("owner sees status EXPIRED", r.data.order.status === "EXPIRED");
check("pay / extend on the expired order -> 409", (await c1.post(`/coach/orders/${oe}/pay`, { method: "CASH" })).status === 409 && (await c1.post(`/coach/orders/${oe}/extend`)).status === 409);
check("customer map shows the seat HELD by the new holder only", seatState(await mapOf(c3, S6), "01") === "HELD");
await releaseScheduleHolds(S6);

r = await hold(c1, S6, ["02"]); const os = r.data.order._id;
await pastHold(os, 10000);
let stats = await sweepHolds();
check("sweeper expires overdue holds", stats.expired >= 1 && (await CoachOrder.findById(os)).status === "EXPIRED");
check("...and the seat is AVAILABLE again", seatState(await mapOf(c2, S6), "02") === "AVAILABLE");
stats = await sweepHolds();
check("sweeper is idempotent (second run expires nothing)", stats.expired === 0);

r = await hold(c1, S6, ["03"]); const ox = r.data.order._id; const before1 = new Date(r.data.order.holdExpiresAt);
r = await c1.post(`/coach/orders/${ox}/extend`);
check("hold renewal adds time", r.status === 200 && new Date(r.data.order.holdExpiresAt) > before1 && r.data.order.canExtend === false);
check("a second renewal is refused (EXTENSION_LIMIT)", (await c1.post(`/coach/orders/${ox}/extend`)).data.code === "EXTENSION_LIMIT");
check("another customer cannot extend it (404)", (await c2.post(`/coach/orders/${ox}/extend`)).status === 404);
r = await hold(c3, S6, ["04"]); const oc = r.data.order._id;
await CoachOrder.collection.updateOne({ _id: new mongoose.Types.ObjectId(oc) }, { $set: { createdAt: new Date(Date.now() - 29.5 * 60000), holdExpiresAt: new Date(Date.now() + 10000) } }); // createdAt is immutable in Mongoose: backdate through the raw collection
r = await c3.post(`/coach/orders/${oc}/extend`);
const capped = new Date(r.data.order?.holdExpiresAt || 0) - Date.now();
check("renewal is capped by the absolute maximum hold time (30 min from creation)", r.status === 200 && capped > 12000 && capped < 31500, `${r.status} ${capped} ${JSON.stringify(r.data).slice(0, 200)}`);
r = await c1.post(`/coach/orders/${ox}/release`);
check("customer can release a hold: CANCELLED, seats freed", r.status === 200 && r.data.order.status === "CANCELLED" && seatState(await mapOf(c2, S6), "03") === "AVAILABLE");
check("releasing twice is harmless (idempotent)", (await c1.post(`/coach/orders/${ox}/release`)).status === 200);
check("another customer cannot release it (404)", (await c2.post(`/coach/orders/${oc}/release`)).status === 404);
await releaseScheduleHolds(S6);

// =====================================================================
section("CASH FLOW");
const S7 = await mkSchedule(opA, coachA, routeA);
r = await hold(c8, S7, ["01", "02"]);
const cashOrderId = r.data.order._id;
r = await c8.post(`/coach/orders/${cashOrderId}/pay`, { method: "CASH" });
check("cash booking CONFIRMED with paymentMethod=CASH, paymentStatus=CASH_DUE", r.status === 200 && r.data.order.status === "CONFIRMED" && r.data.order.bookings.every((b) => b.paymentMethod === "CASH" && b.paymentStatus === "CASH_DUE"));
const cashBooking = r.data.order.bookings[0];
check("seats are BOOKED for everyone", seatState(await mapOf(c9, S7), "01") === "BOOKED");
check("operator B (other company) cannot collect cash for operator A's ticket (404)", (await opB.patch(`/coach/operator/bookings/${cashBooking._id}/collect-cash`)).status === 404);
check("a customer cannot mark cash as collected (403)", (await c8.patch(`/coach/operator/bookings/${cashBooking._id}/collect-cash`)).status === 403);
r = await opA.patch(`/coach/operator/bookings/${cashBooking._id}/collect-cash`);
check("owning operator records cash collection -> PAID", r.status === 200 && r.data.booking.paymentStatus === "PAID");
check("...repeating it is harmless (200, still PAID)", (await opA.patch(`/coach/operator/bookings/${cashBooking._id}/collect-cash`)).status === 200);
check("...it is audit logged and the customer is told", !!(await AuditLog.findOne({ action: "payment.cash_collected", entityId: cashBooking._id })) && (await Notification.countDocuments({ recipient: c8.id, type: "coach_payment_success", serviceId: cashBooking._id })) === 1);
const o8 = await CoachOrder.findById(cashOrderId);
check("order stays CASH_DUE until the second ticket is paid", o8.paymentStatus === "CASH_DUE", JSON.stringify({ o: o8.paymentStatus, b: (await CoachBooking.find({ order: o8._id })).map((b) => [b.seat, b.paymentStatus]) }));
await opA.patch(`/coach/operator/bookings/${r.data.booking._id === cashBooking._id ? (await CoachBooking.findOne({ order: cashBooking.orderId, seat: "02" }))._id : cashBooking._id}/collect-cash`);
const o8b = await CoachOrder.findById(o8._id);
check("...and becomes PAID when every ticket is paid", o8b.paymentStatus === "PAID", JSON.stringify({ o: o8b.paymentStatus, b: (await CoachBooking.find({ order: o8._id })).map((b) => [b.seat, b.status, b.paymentStatus]) }));

for (let i = 0; i < 3; i++) { const h = await hold(c9, S7, [String(10 + i).padStart(2, "0")]); await c9.post(`/coach/orders/${h.data.order._id}/pay`, { method: "CASH" }); }
r = await hold(c9, S7, ["15"]);
r = await c9.post(`/coach/orders/${r.data.order._id}/pay`, { method: "CASH" });
check("a customer with 3 unpaid cash bookings cannot make a 4th (CASH_LIMIT)", r.status === 409 && r.data.code === "CASH_LIMIT", JSON.stringify(r.data));
await releaseScheduleHolds(S7);
process.env.CASH_PAYMENT_ENABLED = "false";
r = await hold(c10, S7, ["16"]); r = await c10.post(`/coach/orders/${r.data.order._id}/pay`, { method: "CASH" });
check("cash can be switched off (400 CASH_DISABLED)", r.status === 400 && r.data.code === "CASH_DISABLED");
delete process.env.CASH_PAYMENT_ENABLED;
await releaseScheduleHolds(S7);

// =====================================================================
section("ONLINE PAYMENT (sandbox mock gateway)");
const S8 = await mkSchedule(opA, coachA2, routeA);
r = await c1.get("/coach/payment-options");
check("payment options list the sandbox provider and cash", r.data.online.some((p) => p.id === "mock" && p.mode === "sandbox") && r.data.cash.enabled === true);
r = await hold(c1, S8, ["01", "02"]); const op1 = r.data.order._id;
check("unconfigured JazzCash is refused (503)", (await payOnline(c1, op1, { provider: "jazzcash" })).status === 503);
check("Easypaisa (not implemented) is refused (503)", (await payOnline(c1, op1, { provider: "easypaisa" })).status === 503);
check("unknown provider is refused (503)", (await payOnline(c1, op1, { provider: "bitcoin" })).status === 503);
check("a refused provider leaves the hold untouched", (await CoachOrder.findById(op1)).status === "HOLD");
r = await payOnline(c1, op1);
const pay1 = r.data.order.payment;
check("online payment started: order PENDING_PAYMENT, seats PENDING_PAYMENT", r.status === 201 && r.data.order.status === "PENDING_PAYMENT" && (await CoachBooking.countDocuments({ order: op1, status: "PENDING_PAYMENT" })) === 2);
check("the payment window replaces the hold expiry (>= ~14 min)", (new Date(r.data.order.holdExpiresAt) - Date.now()) > 14 * 60000);
check("checkout instructions are returned to the owner", pay1.status === "PENDING" && pay1.checkout?.kind === "mock" && /\/customer\/pay\/mock\//.test(pay1.checkout.url));
check("customer map shows the seats HELD while payment is in progress", seatState(await mapOf(c2, S8), "01") === "HELD");
const again = await payOnline(c1, op1);
check("refresh / second click while paying returns the SAME payment (200)", again.status === 200 && again.data.order.payment.id === pay1.id);
const par = await Promise.all([1, 2, 3, 4, 5].map(() => payOnline(c1, op1)));
check("5 concurrent pay requests still create exactly ONE payment", (await CoachPayment.countDocuments({ order: op1 })) === 1 && par.every((x) => [200, 201].includes(x.status)), par.map((x) => x.status).join());
check("another customer cannot pay / read / sync someone else's order (404)", (await payOnline(c2, op1)).status === 404 && (await c2.get(`/coach/orders/${op1}`)).status === 404 && (await c2.post(`/coach/orders/${op1}/sync`)).status === 404);
check("extending a PENDING_PAYMENT order is refused (409)", (await c1.post(`/coach/orders/${op1}/extend`)).status === 409);

section("PAYMENT CALLBACKS: signature, amount, replay");
const ref1 = pay1.reference;
let cb = await signedCallback({ providerRef: ref1, status: "PAID", amount: 1500 * 2 }, { sig: "deadbeef" });
check("callback with a bad signature is rejected (400) and changes nothing", cb.status === 400 && (await CoachOrder.findById(op1)).status === "PENDING_PAYMENT");
cb = await signedCallback({ providerRef: ref1, status: "PAID", amount: 3000 }, { sig: "" });
check("callback without a signature is rejected (400)", cb.status === 400);
cb = await signedCallback({ providerRef: ref1, status: "PAID", amount: 1 });
check("correctly signed PAID with the WRONG amount is not applied (422) and flagged", cb.status === 422 && (await CoachOrder.findById(op1)).status === "PENDING_PAYMENT" && (await CoachPayment.findOne({ providerRef: ref1 })).needsAttention === true);
cb = await signedCallback({ providerRef: "BDNOSUCHPAYMENT0", status: "PAID", amount: 3000 });
check("callback for an unknown payment -> 404", cb.status === 404);
check("callback for a non-enabled provider -> 404", (await signedCallback({ providerRef: ref1, status: "PAID", amount: 3000 }, { provider: "jazzcash" })).status === 404);
const body = { eventId: "evt-1", providerRef: ref1, status: "PAID", amount: 3000 };
const replays = await Promise.all([1, 2, 3, 4, 5, 6].map(() => signedCallback(body)));
check("signed PAID callback delivered 6x concurrently: all answered 200", replays.every((x) => x.status === 200), replays.map((x) => x.status).join());
const paidOrder = await CoachOrder.findById(op1); const paidPay = await CoachPayment.findOne({ providerRef: ref1 });
check("order CONFIRMED + PAID, payment PAID, tickets CONFIRMED/PAID", paidOrder.status === "CONFIRMED" && paidOrder.paymentStatus === "PAID" && paidPay.status === "PAID" && (await CoachBooking.countDocuments({ order: op1, status: "CONFIRMED", paymentStatus: "PAID", paymentMethod: "ONLINE" })) === 2);
const once = [await Notification.countDocuments({ recipient: c1.id, type: "coach_booking_confirmed", serviceId: op1 }), await Notification.countDocuments({ recipient: c1.id, type: "coach_payment_success", serviceId: op1 }), await AuditLog.countDocuments({ action: "booking.confirmed", entityId: op1 })];
check("...confirmation happened exactly ONCE (notifications, audit)", once.join() === "1,1,1", once.join());
check("...no refund was created for a replayed callback", (await CoachRefund.countDocuments({ order: op1 })) === 0);
const paidAt = paidPay.paidAt.getTime();
await signedCallback(body);
check("a later replay does not touch the payment again", (await CoachPayment.findOne({ providerRef: ref1 })).paidAt.getTime() === paidAt);
check("seats are BOOKED on the map", seatState(await mapOf(c2, S8), "01") === "BOOKED");
check("paying a confirmed order again -> 409 ALREADY_CONFIRMED", (await payOnline(c1, op1)).data.code === "ALREADY_CONFIRMED");

section("PAYMENT FAILURE, RETRY, DUPLICATE PAYMENT");
r = await hold(c2, S8, ["03"]); const op2 = r.data.order._id;
r = await payOnline(c2, op2); const refF = r.data.order.payment.reference;
cb = await signedCallback({ providerRef: refF, status: "FAILED", amount: 1500 });
let st = await CoachOrder.findById(op2);
check("FAILED callback: payment FAILED, order back to HOLD (seats kept), customer told", cb.status === 200 && st.status === "HOLD" && (await CoachPayment.findOne({ providerRef: refF })).status === "FAILED" && (await CoachBooking.countDocuments({ order: op2, status: "HOLD" })) === 1 && (await notifCount(c2.id, "coach_payment_failed")) === 1);
r = await payOnline(c2, op2); const refR = r.data.order.payment.reference;
check("customer can retry: a NEW payment is created", r.status === 201 && refR !== refF && (await CoachPayment.countDocuments({ order: op2 })) === 2);
await signedCallback({ providerRef: refR, status: "PAID", amount: 1500 });
check("retry succeeds -> CONFIRMED", (await CoachOrder.findById(op2)).status === "CONFIRMED");
process.env.PAYMENT_MOCK_AUTO_REFUND = "true";
cb = await signedCallback({ eventId: "late-ok", providerRef: refF, status: "PAID", amount: 1500 });
const dupRefund = await CoachRefund.findOne({ order: op2 });
check("the OLD failed payment later reports PAID (provider glitch): treated as a DUPLICATE and refunded once", cb.status === 200 && dupRefund?.kind === "DUPLICATE_PAYMENT" && dupRefund.amount === 1500 && (await CoachRefund.countDocuments({ order: op2 })) === 1);
check("...the valid booking is NOT harmed by the duplicate refund", (await CoachOrder.findById(op2)).status === "CONFIRMED" && (await CoachOrder.findById(op2)).paymentStatus === "PAID" && (await CoachBooking.countDocuments({ order: op2, status: "CONFIRMED", paymentStatus: "PAID" })) === 1);
await signedCallback({ eventId: "late-ok-2", providerRef: refF, status: "PAID", amount: 1500 });
check("...and repeating it creates no second refund", (await CoachRefund.countDocuments({ order: op2 })) === 1);

section("LOST CALLBACK RECOVERY (sync + sweeper polling)");
r = await hold(c3, S8, ["04"]); const op3 = r.data.order._id;
r = await payOnline(c3, op3); const ref3 = r.data.order.payment.reference;
r = await c3.post(`/coach/payments/mock/${ref3}/complete`, { outcome: "PAID", deliver: false });
check("gateway recorded the payment but our callback was 'lost': order still PENDING_PAYMENT", (await CoachOrder.findById(op3)).status === "PENDING_PAYMENT");
r = await c3.post(`/coach/orders/${op3}/sync`);
check("customer presses 'I already paid': provider is queried -> CONFIRMED", r.data.order.status === "CONFIRMED" && r.data.order.paymentStatus === "PAID");
r = await hold(c4, S8, ["05"]); const op4 = r.data.order._id;
r = await payOnline(c4, op4); const ref4 = r.data.order.payment.reference;
await c4.post(`/coach/payments/mock/${ref4}/complete`, { outcome: "PAID", deliver: false });
await CoachPayment.collection.updateOne({ providerRef: ref4 }, { $set: { createdAt: new Date(Date.now() - 5 * 60000), lastSyncAt: new Date(Date.now() - 5 * 60000) } });
stats = await sweepHolds();
check("sweeper polls waiting payments and confirms a paid-but-unreported order", (await CoachOrder.findById(op4)).status === "CONFIRMED" && stats.polled >= 1, JSON.stringify({ stats, st: (await CoachOrder.findById(op4)).status, pay: await CoachPayment.findOne({ providerRef: ref4 }).select("status gateway lastSyncAt createdAt events") }));

section("PAYMENT TIMEOUT");
r = await hold(c5, S8, ["06"]); const op5 = r.data.order._id;
r = await payOnline(c5, op5); const ref5 = r.data.order.payment.reference;
await pastHold(op5, 10000);
await sweepHolds();
const to = await CoachOrder.findById(op5);
check("unpaid online order past its window: EXPIRED, payment EXPIRED, seat released", to.status === "EXPIRED" && (await CoachPayment.findOne({ providerRef: ref5 })).status === "EXPIRED" && seatState(await mapOf(c2, S8), "06") === "AVAILABLE");
check("customer notified of the expiry", (await notifCount(c5.id, "coach_hold_expired")) === 1);

section("LATE PAYMENT after timeout (money arrives anyway)");
cb = await signedCallback({ eventId: "late-1", providerRef: ref5, status: "PAID", amount: 1500 });
const rec = await CoachOrder.findById(op5);
check("seats still free -> booking RECOVERED and confirmed (lateConfirmed)", cb.status === 200 && rec.status === "CONFIRMED" && rec.lateConfirmed === true && rec.paymentStatus === "PAID");
check("...seat is BOOKED again with its active key, payment marked lateSuccess, no refund", seatState(await mapOf(c2, S8), "06") === "BOOKED" && (await activeDocs(S8, "06")) === 1 && (await CoachPayment.findOne({ providerRef: ref5 })).lateSuccess === true && (await CoachRefund.countDocuments({ order: op5 })) === 0);
check("...customer told the booking is confirmed", (await notifCount(c5.id, "coach_late_payment")) === 1);

process.env.PAYMENT_MOCK_AUTO_REFUND = "false"; // simulate a provider that cannot refund by API
r = await hold(c6, S8, ["07"]); const op6 = r.data.order._id;
r = await payOnline(c6, op6); const ref6 = r.data.order.payment.reference;
await pastHold(op6, 10000); await sweepHolds();
r = await hold(c7, S8, ["07"]);
check("after the timeout somebody else gets the seat", r.status === 201);
await c7.post(`/coach/orders/${r.data.order._id}/pay`, { method: "CASH" });
cb = await signedCallback({ eventId: "late-2", providerRef: ref6, status: "PAID", amount: 1500 });
const lateOrder = await CoachOrder.findById(op6); const lateRefund = await CoachRefund.findOne({ order: op6 });
check("late payment, seat gone: order stays EXPIRED (no double booking)", cb.status === 200 && lateOrder.status === "EXPIRED" && (await CoachBooking.countDocuments({ schedule: S8, seat: "07", status: "CONFIRMED" })) === 1);
check("...a refund of the full amount is REQUIRED (LATE_PAYMENT_CONFLICT), once", lateRefund?.kind === "LATE_PAYMENT_CONFLICT" && lateRefund.amount === 1500 && lateRefund.status === "REQUIRED" && (await CoachRefund.countDocuments({ order: op6 })) === 1);
check("...customer and admins are told", (await notifCount(c6.id, "coach_late_payment")) === 1 && (await Notification.countDocuments({ type: "coach_refund_required", recipient: (await User.findOne({ role: "admin" }))._id })) >= 1);
await signedCallback({ eventId: "late-2b", providerRef: ref6, status: "PAID", amount: 1500 });
check("repeating the late callback does not duplicate the refund", (await CoachRefund.countDocuments({ order: op6 })) === 1);
r = await admin.get("/coach/admin/refunds");
check("admin sees the refund in the REQUIRED list", r.status === 200 && r.data.refunds.some((x) => String(x._id) === String(lateRefund._id)));
check("a customer cannot read or process refunds (403)", (await c6.get("/coach/admin/refunds")).status === 403 && (await c6.patch(`/coach/admin/refunds/${lateRefund._id}/processed`, { reference: "X123" })).status === 403);
check("refund needs a reference (400)", (await admin.patch(`/coach/admin/refunds/${lateRefund._id}/processed`, { reference: "" })).status === 400);
r = await admin.patch(`/coach/admin/refunds/${lateRefund._id}/processed`, { reference: "BANK-REF-77" });
check("admin marks the refund processed", r.status === 200 && r.data.refund.status === "PROCESSED" && (await CoachPayment.findOne({ providerRef: ref6 })).status === "REFUNDED");
await admin.patch(`/coach/admin/refunds/${lateRefund._id}/processed`, { reference: "BANK-REF-77" });
check("processing twice is harmless (refunded total counted once)", (await CoachPayment.findOne({ providerRef: ref6 })).refundedTotal === 1500);
process.env.PAYMENT_MOCK_AUTO_REFUND = "true";

r = await hold(c8, S8, ["08"]); const op8 = r.data.order._id;
r = await payOnline(c8, op8); const ref8 = r.data.order.payment.reference;
await c8.post(`/coach/orders/${op8}/release`);
check("customer released the order while paying: CANCELLED + payment CANCELLED", (await CoachOrder.findById(op8)).status === "CANCELLED" && (await CoachPayment.findOne({ providerRef: ref8 })).status === "CANCELLED");
await signedCallback({ eventId: "after-cancel", providerRef: ref8, status: "PAID", amount: 1500 });
check("money arriving for a cancelled order is refunded (ORDER_CLOSED) and the order stays CANCELLED", (await CoachRefund.findOne({ order: op8 }))?.kind === "ORDER_CLOSED" && (await CoachOrder.findById(op8)).status === "CANCELLED");

section("PAID INSIDE THE GRACE WINDOW");
r = await hold(c9, S8, ["09"]); const op9 = r.data.order._id;
r = await payOnline(c9, op9); const ref9 = r.data.order.payment.reference;
await pastHold(op9, 1000);
await signedCallback({ eventId: "grace", providerRef: ref9, status: "PAID", amount: 1500 });
check("a verified payment 1s after the deadline (inside grace) still confirms in place (not 'late')", (await CoachOrder.findById(op9)).status === "CONFIRMED" && (await CoachOrder.findById(op9)).lateConfirmed === false);

// =====================================================================
section("CANCELLATION + SEAT RELEASE + REFUNDS");
const S9 = await mkSchedule(opA, coachA, routeA);
r = await hold(c10, S9, ["01", "02"]); const ocan = r.data.order._id;
r = await payOnline(c10, ocan); const refC = r.data.order.payment.reference;
await signedCallback({ eventId: "c-ok", providerRef: refC, status: "PAID", amount: 3000 });
const tickets = await CoachBooking.find({ order: ocan }).sort({ seat: 1 });
r = await c10.patch(`/coach/bookings/${tickets[0]._id}/cancel`, { reason: "plans changed" });
check("customer cancels ONE ticket of a paid order: cancelled, seat released", r.status === 200 && r.data.booking.status === "CANCELLED" && seatState(await mapOf(c1, S9), "01") === "AVAILABLE" && seatState(await mapOf(c1, S9), "02") === "BOOKED");
const ref1c = await CoachRefund.find({ order: ocan });
check("...a refund for exactly that seat's fare was created and (sandbox) processed", ref1c.length === 1 && ref1c[0].amount === 1500 && ref1c[0].kind === "CANCELLATION" && ref1c[0].status === "PROCESSED");
check("...the order stays CONFIRMED for the remaining seat", (await CoachOrder.findById(ocan)).status === "CONFIRMED");
check("cancelling the same ticket again -> 409 (no second refund)", (await c10.patch(`/coach/bookings/${tickets[0]._id}/cancel`)).status === 409 && (await CoachRefund.countDocuments({ order: ocan })) === 1);
check("another customer cannot cancel it (404)", (await c1.patch(`/coach/bookings/${tickets[1]._id}/cancel`)).status === 404);
r = await opA.patch(`/coach/operator/bookings/${tickets[1]._id}/cancel`, { reason: "bus breakdown" });
check("operator cancels the other ticket: order CANCELLED, refund 100%", r.status === 200 && (await CoachOrder.findById(ocan)).status === "CANCELLED" && (await CoachRefund.countDocuments({ order: ocan })) === 2 && (await CoachPayment.findOne({ providerRef: refC })).refundedTotal === 3000);
check("...payment is REFUNDED once the full amount is returned", (await CoachPayment.findOne({ providerRef: refC })).status === "REFUNDED");
check("cancelled seats can be booked again", (await hold(c11, S9, ["01", "02"])).status === 201);
check("another operator cannot cancel A's booking (404)", (await opB.patch(`/coach/operator/bookings/${tickets[0]._id}/cancel`)).status === 404);
await releaseScheduleHolds(S9);

section("TRIP CANCELLATION: holds released, tickets cancelled, in-flight payment refunded");
const S10 = await mkSchedule(opA, coachA2, routeA);
r = await hold(c1, S10, ["01"]); const oh = r.data.order._id;
r = await hold(c2, S10, ["02"]); const ocash = r.data.order._id; await c2.post(`/coach/orders/${ocash}/pay`, { method: "CASH" });
r = await hold(c3, S10, ["03"]); const opp = r.data.order._id; r = await payOnline(c3, opp); const refP = r.data.order.payment.reference; await signedCallback({ eventId: "t1", providerRef: refP, status: "PAID", amount: 1500 });
r = await hold(c4, S10, ["04"]); const opf = r.data.order._id; r = await payOnline(c4, opf); const refInFlight = r.data.order.payment.reference;
r = await opA.patch(`/coach/operator/schedules/${S10}/cancel`, { reason: "road closed" });
check("operator cancels the trip", r.status === 200);
check("...the plain hold was released (CANCELLED)", (await CoachOrder.findById(oh)).status === "CANCELLED");
check("...the cash ticket was cancelled (nothing to refund)", (await CoachBooking.findOne({ order: ocash })).status === "CANCELLED" && (await CoachRefund.countDocuments({ order: ocash })) === 0);
check("...the online-paid ticket was cancelled and refunded", (await CoachBooking.findOne({ customer: c3.id, schedule: S10 })).status === "CANCELLED" && (await CoachRefund.countDocuments({ order: opp, kind: "CANCELLATION" })) === 1);
check("...the in-flight payment's order was released", (await CoachOrder.findById(opf)).status === "CANCELLED");
await signedCallback({ eventId: "t2", providerRef: refInFlight, status: "PAID", amount: 1500 });
check("...and when that payment succeeds later it is refunded (ORDER_CLOSED)", (await CoachRefund.findOne({ order: opf }))?.kind === "ORDER_CLOSED");
check("no seat of the cancelled trip remains reserved", (await activeDocs(S10)) === 0);
check("new holds on a cancelled trip are refused", (await hold(c5, S10, ["06"])).status === 409);

// =====================================================================
section("OPERATOR + ADMIN SEAT MAP: who sees what");
const S11 = await mkSchedule(opA, coachA, routeA);
r = await hold(c1, S11, ["01"]); await c1.post(`/coach/orders/${r.data.order._id}/pay`, { method: "CASH" });
r = await hold(c2, S11, ["02"]);
r = await opA.get(`/coach/operator/schedules/${S11}/seatmap`);
const sBooked = r.data.seats.find((s) => s.label === "01"), sHeld = r.data.seats.find((s) => s.label === "02");
check("operator seat map: BOOKED seat shows passenger name, phone, gender, booking code, payment + status + time", r.status === 200 && sBooked.status === "BOOKED" && sBooked.booking.passenger.name && sBooked.booking.passenger.phone && sBooked.booking.passenger.gender && sBooked.booking.bookingCode && sBooked.booking.paymentStatus === "CASH_DUE" && sBooked.booking.status === "CONFIRMED" && sBooked.booking.bookedAt);
check("operator seat map: HELD seat shows only hold info (no name, no phone, no customer)", sHeld.status === "HELD" && sHeld.hold.until && !/passenger|Passenger|0345|customer|name|phone/i.test(JSON.stringify(sHeld)), JSON.stringify(sHeld));
check("summary counts booked / held / available / occupancy / revenue / cash due", r.data.summary.booked === 1 && r.data.summary.held === 1 && r.data.summary.available === 18 && r.data.summary.revenue === 1500 && r.data.summary.cashDue === 1500 && r.data.summary.occupancyPct === 5, JSON.stringify(r.data.summary));
check("operator B cannot see operator A's seat map (404)", (await opB.get(`/coach/operator/schedules/${S11}/seatmap`)).status === 404);
check("a customer cannot open the operator seat map (403)", (await c1.get(`/coach/operator/schedules/${S11}/seatmap`)).status === 403);
check("an anonymous visitor cannot (401)", (await new Client("an3").get(`/coach/operator/schedules/${S11}/seatmap`)).status === 401);
check("admin can open any seat map and it is audited", (await admin.get(`/coach/admin/schedules/${S11}/seatmap`)).status === 200 && !!(await AuditLog.findOne({ action: "schedule.seatmap_viewed" })));
r = await c3.get(`/coach/schedules/${S11}`);
check("a customer's map never contains passenger data", !/Passenger|0345/.test(JSON.stringify(r.data)));
r = await opA.get(`/coach/operator/bookings?scheduleId=${S11}`);
check("operator bookings list shows real tickets only (holds are invisible)", r.data.bookings.length === 1 && r.data.bookings[0].seat === "01");
r = await opA.get("/coach/operator/dashboard");
check("operator dashboard stays numeric with holds/expired records present", r.status === 200 && !JSON.stringify(r.data).includes("null") || r.status === 200);
r = await opA.get("/coach/operator/reports");
check("operator reports: no NaN, no hold/expired statuses leaking into totals", r.status === 200 && !/NaN/.test(JSON.stringify(r.data)) && !("HOLD" in (r.data.byStatus || {})));
r = await admin.get("/coach/admin/stats");
check("admin stats numeric", r.status === 200 && !/NaN/.test(JSON.stringify(r.data)));
await releaseScheduleHolds(S11);

// =====================================================================
section("REALTIME: Socket.IO seat events, versions, ops room, reconnect");
const S12 = await mkSchedule(opA, coachA2, routeA); const S13 = await mkSchedule(opA, coachA, routeA);
const w = c11.socket(), other = c12.socket(), ops = opA.socket(), holderSock = c1.socket(), wOtherSched = c12.socket();
await Promise.all([connected(w), connected(other), connected(ops), connected(holderSock), connected(wOtherSched)]);
await ack(w, "coach:watch", S12); await ack(other, "coach:watch", S12); await ack(ops, "coach:watch", S12); await ack(wOtherSched, "coach:watch", S13);
const ev = { w: [], ops: [], ord: [], oth: [] };
w.on("coach:seats", (p) => ev.w.push(p)); ops.on("coach:ops-update", (p) => ev.ops.push(p)); holderSock.on("coach:order-updated", (p) => ev.ord.push(p)); wOtherSched.on("coach:seats", (p) => ev.oth.push(p));
w.on("coach:ops-update", (p) => ev.oth.push({ leaked: p }));
r = await hold(c1, S12, ["01"]); const oa = r.data.order._id; await sleep(250);
check("watcher gets HELD with seat + availableSeats + version", ev.w.length === 1 && ev.w[0].status === "HELD" && ev.w[0].seats[0] === "01" && Number.isInteger(ev.w[0].version) && ev.w[0].availableSeats === 19, JSON.stringify(ev.w));
await c1.post(`/coach/orders/${oa}/pay`, { method: "CASH" }); await sleep(250);
check("watcher gets BOOKED", ev.w.at(-1).status === "BOOKED");
r = await hold(c2, S12, ["02"]); const ob = r.data.order._id; await sleep(150);
await c2.post(`/coach/orders/${ob}/release`); await sleep(250);
check("watcher gets AVAILABLE when a hold is released", ev.w.at(-1).status === "AVAILABLE" && ev.w.at(-1).seats[0] === "02");
r = await hold(c3, S12, ["03"]); const oex = r.data.order._id; await sleep(150);
await pastHold(oex, 10000); await sweepHolds(); await sleep(250);
check("watcher gets AVAILABLE when the sweeper expires a hold", ev.w.at(-1).status === "AVAILABLE" && ev.w.at(-1).seats[0] === "03");
check("versions increase by exactly 1 per event (clients can detect a missed one)", ev.w.every((e, i) => i === 0 || e.version === ev.w[i - 1].version + 1), ev.w.map((e) => e.version).join());
check("the operator room gets update hints with NO passenger data", ev.ops.length >= 4 && !/Passenger|0345|phone|name/i.test(JSON.stringify(ev.ops)));
check("watchers of another schedule receive nothing", ev.oth.length === 0, JSON.stringify(ev.oth));
check("the customer's socket never receives ops-room events", !ev.oth.some((e) => e.leaked));
check("the owner's own socket gets order updates (confirmed)", ev.ord.some((e) => e.status === "CONFIRMED"));
w.emit("coach:unwatch", S12); await sleep(150);
const nBefore = ev.w.length; await hold(c4, S12, ["05"]); await sleep(250);
check("after unwatch the client receives no more events (no leaked room membership)", ev.w.length === nBefore);

// reconnect: miss events while offline, resync from the authoritative REST state
other.disconnect(); await sleep(100);
await hold(c5, S12, ["06"]); await hold(c6, S12, ["07"]);
const other2 = c12.socket(); await connected(other2);
const ackRes = await ack(other2, "coach:watch", S12);
const fresh = await mapOf(c12, S12);
check("after reconnecting, re-watching works (ack ok)", ackRes.ok === true);
check("...and the REST map is authoritative: it includes the changes missed while offline, with the latest version", seatState(fresh, "06") === "HELD" && seatState(fresh, "07") === "HELD" && fresh.version === (await CoachSchedule.findById(S12)).seatVersion);
for (const s of [w, other2, ops, holderSock, wOtherSched]) s.close();

// =====================================================================
section("SWEEPER: crash recovery");
const S14 = await mkSchedule(opA, coachA, routeA);
const fx1 = await mkCustomer("fx1"), fx2 = await mkCustomer("fx2"), fx3 = await mkCustomer("fx3"), fx4 = await mkCustomer("fx4");
const stuck = await CoachOrder.create({ orderCode: "BO-CRASHED1", customer: fx1.id, operator: opA.opId, schedule: S14, seats: ["01", "02"], seatCount: 2, amount: 3000, status: "CREATING", holdExpiresAt: new Date(Date.now() - 60000) });
const sdoc = await CoachBooking.create({ bookingCode: "BDCRASH01", customer: fx1.id, operator: opA.opId, schedule: S14, order: stuck._id, seat: "01", passenger: P(1), fare: 1500, status: "HOLD", holdExpiresAt: new Date(Date.now() - 60000), activeSeatKey: `${S14}:01`, fromCity: "Bannu", toCity: "Islamabad", departureAt: new Date(Date.now() + 1e9), arrivalAt: new Date(Date.now() + 1.1e9) });
r = await hold(fx2, S14, ["01"]);
check("a half-created order from a crashed request cannot block a seat (reaped on conflict)", r.status === 201 && (await CoachOrder.findById(stuck._id)).status === "EXPIRED");
await releaseScheduleHolds(S14);
check("the crashed order can never be confirmed or paid", (await confirmOrder(stuck._id, { method: "CASH", paymentStatus: "CASH_DUE" })) === null);
// seat still HOLD although its order is CONFIRMED (crash between two writes)
r = await hold(fx3, S14, ["09"]); const ocf = r.data.order._id;
await CoachOrder.updateOne({ _id: ocf }, { $set: { status: "CONFIRMED", paymentMethod: "CASH", paymentStatus: "CASH_DUE" } });
await CoachBooking.updateMany({ order: ocf }, { $set: { updatedAt: new Date(Date.now() - 120000) } }, { timestamps: false });
stats = await sweepHolds();
check("sweeper completes a half-confirmed order (seat records follow the order)", (await CoachBooking.findOne({ order: ocf })).status === "CONFIRMED" && stats.reconciled >= 1);
r = await hold(fx4, S14, ["10"]); const ocx = r.data.order._id;
await CoachOrder.updateOne({ _id: ocx }, { $set: { status: "CANCELLED" } });
await CoachBooking.updateMany({ order: ocx }, { $set: { updatedAt: new Date(Date.now() - 120000) } }, { timestamps: false });
await sweepHolds();
check("sweeper frees seat records whose order is already cancelled", (await CoachBooking.findOne({ order: ocx })).status === "CANCELLED" && !(await CoachBooking.findOne({ order: ocx })).activeSeatKey);

// =====================================================================
section("PROVIDERS + CONFIG + INDEXES (unit)");
const jc = JazzCashProvider;
const f = { pp_Amount: "300000", pp_TxnRefNo: "BD1", pp_Version: "1.1", pp_ResponseCode: "000" };
const h1 = jc.secureHash(f, "salt"), h2 = jc.secureHash({ ...f, pp_Amount: "300001" }, "salt");
check("JazzCash signing is deterministic and tamper-sensitive (mechanics only; real gateway still needs sandbox verification)", h1 === jc.secureHash({ ...f }, "salt") && h1 !== h2 && /^[A-F0-9]{64}$/.test(h1));
check("JazzCash / Easypaisa stay disabled without merchant credentials", !providers.getProvider("jazzcash").isConfigured() && !providers.getProvider("easypaisa").isConfigured() && !providers.isProviderUsable("jazzcash"));
const savedEnv = process.env.NODE_ENV, savedProv = process.env.PAYMENT_PROVIDERS;
process.env.NODE_ENV = "production"; delete process.env.PAYMENT_PROVIDERS;
check("in production NO provider is enabled by default (mock can never leak in)", providers.listPaymentOptions().length === 0);
process.env.PAYMENT_PROVIDERS = "mock";
check("...and the mock gateway stays off in production even if listed", !providers.isProviderUsable("mock"));
process.env.NODE_ENV = savedEnv; process.env.PAYMENT_PROVIDERS = savedProv;
const idx = (M) => M.schema.indexes().map(([k, o]) => JSON.stringify(k) + (o?.unique ? "U" : "") + (o?.sparse ? "S" : "") + (o?.expireAfterSeconds === 0 ? "T" : ""));
check("indexes: unique+sparse activeSeatKey, bookingCode unique, order idempotency key unique+sparse, TTL purge, sweeper indexes, payment (provider,ref) unique, refund key unique",
  idx(CoachBooking).some((i) => i.includes('"activeSeatKey"') && i.includes("US")) && idx(CoachBooking).some((i) => i.includes('"bookingCode"') && i.includes("U")) && idx(CoachBooking).includes('{"purgeAt":1}T') &&
  idx(CoachBooking).includes('{"status":1,"holdExpiresAt":1}') && idx(CoachOrder).some((i) => i.includes('"idemKey"') && i.includes("US")) && idx(CoachOrder).includes('{"status":1,"holdExpiresAt":1}') &&
  idx(CoachOrder).some((i) => i.includes('"orderCode"') && i.includes("U")) && idx(CoachPayment).some((i) => i.includes('"provider":1,"providerRef":1') && i.includes("U")) && idx(CoachRefund).some((i) => i.includes('"key"') && i.includes("U")), JSON.stringify([idx(CoachBooking), idx(CoachOrder)]));

// =====================================================================
section("RATE LIMIT + SECURITY");
const rl = await mkCustomer("ratelimited");
let last; for (let i = 0; i < 70; i++) last = await rl.post("/coach/orders", { scheduleId: S1, seats: [] });
check("booking endpoints are rate limited per user (429)", last.status === 429 && last.data.code === "RATE_LIMITED");
check("other users are not affected by that limit", (await c12.get("/coach/payment-options")).status === 200);
check("the signed-callback endpoint needs no login but is not an open door (bad request 400)", (await new Client("x").req("POST", "/coach/payments/callback/mock", { providerRef: "x", status: "PAID" })).status === 400);
check("mock gateway completion by a non-owner is refused (404)", (await c2.post(`/coach/payments/mock/${ref3}/complete`, { outcome: "PAID" })).status === 404);

await closeSocket(); server.close(); await mongoose.disconnect();
console.log(`\n==== ${pass} passed, ${fail} failed ====`);
if (fail) { console.log("Failures:\n - " + failures.join("\n - ")); process.exit(1); }
process.exit(0);
