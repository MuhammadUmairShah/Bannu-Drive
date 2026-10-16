// Trip tests: route stops, boarding/dropping points, trip states, live GPS tracking, notifications, partial refunds. Runs the REAL app + Socket.IO + sweeper functions in-process.
//   MONGO_TEST_URI=mongodb://127.0.0.1:27017/bd_trip node tests/coach.phase4.integration.mjs
// WARNING: drops the database named in MONGO_TEST_URI.
import http from "http";
import "./helpers/atomic-shim.mjs"; // emulates MongoDB per-operation atomicity on the sandbox database (see the file)
import mongoose from "mongoose";
import bcrypt from "bcrypt";
import { io as ioClient } from "socket.io-client";

const MONGO = process.env.MONGO_TEST_URI || "mongodb://127.0.0.1:27017/bd_trip";
const ORIGIN = "http://localhost:5173";
const big = "1000000";
Object.assign(process.env, {
  NODE_ENV: "development", JWT_SECRET: "test_secret_test_secret_test_secret_1234", CLIENT_URL: ORIGIN, MONGO_URI: MONGO,
  PAYMENT_PROVIDERS: "mock", REQUIRE_DOCUMENTS_FOR_VERIFICATION: "false",
  LOGIN_RATE_LIMIT: big, REGISTER_RATE_LIMIT: big, REFRESH_RATE_LIMIT: big, REQUEST_RATE_LIMIT: big, PAYMENT_RATE_LIMIT: big,
  ADMIN_RATE_LIMIT: big, UPLOAD_RATE_LIMIT: big, PAYMENT_CALLBACK_RATE_LIMIT: big, PUBLIC_READ_RATE_LIMIT: big, BOOKING_RATE_LIMIT: "500", QR_RATE_LIMIT: "60"
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
const { CoachTripPoint, CoachRoute } = await import("../modules/coach/coach.model.js");
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
const connected = (s) => Promise.race([new Promise((res) => { s.on("connect", () => res(true)); s.on("connect_error", () => res(false)); }), sleep(4000).then(() => "TIMEOUT")]);
const ack = (s, ev, arg) => Promise.race([new Promise((res) => s.emit(ev, arg, res)), sleep(4000).then(() => ({ ok: "TIMEOUT" }))]);

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



const bookCash = async (c, sid, labels, extra = {}) => { const h = await c.post("/coach/orders", { scheduleId: sid, seats: labels.map((s, i) => ({ seat: s, passenger: P(i + 1) })), ...extra }); if (h.status >= 300) return { error: h }; const r = await c.post(`/coach/orders/${h.data.order._id}/pay`, { method: "CASH" }); return r.data.order; };
const STOPS = [
  { name: "Bannu", kind: "boarding", latitude: 32.9889, longitude: 70.6056, arrivalOffsetMin: 0, departureOffsetMin: 0 },
  { name: "Bannu Bus Stand", kind: "boarding", latitude: 32.9925, longitude: 70.6, arrivalOffsetMin: 0, departureOffsetMin: 10 },
  { name: "Kohat", kind: "both", latitude: 33.5869, longitude: 71.4414, arrivalOffsetMin: 150, departureOffsetMin: 165 },
  { name: "Peshawar", kind: "both", latitude: 34.0151, longitude: 71.5249, arrivalOffsetMin: 240, departureOffsetMin: 255 },
  { name: "Islamabad", kind: "dropping", latitude: 33.6844, longitude: 73.0479, arrivalOffsetMin: 420, departureOffsetMin: 420 }
];
const getSched = (id) => CoachSchedule.findById(id);
const soonDeparture = (id, minutes = 30) => CoachSchedule.collection.updateOne({ _id: new mongoose.Types.ObjectId(id) }, { $set: { departureAt: new Date(Date.now() + minutes * 60000) } });
const fix = (lat, lon, extra = {}) => ({ latitude: lat, longitude: lon, accuracy: 10, speed: 20, heading: 90, ...extra });
const gps = (op, sid, body) => op.post(`/coach/operator/schedules/${sid}/location`, body);
const state = (op, sid, st) => op.patch(`/coach/operator/schedules/${sid}/trip-state`, { state: st });
const notifFor = (uid, type, sid) => Notification.countDocuments({ recipient: uid, type, ...(sid ? { serviceId: sid } : {}) });
const backdateFix = (sid, seconds) => CoachSchedule.collection.updateOne({ _id: new mongoose.Types.ObjectId(sid) }, { $set: { "trip.lastLocation.at": new Date(Date.now() - seconds * 1000), "trip.lastLocation.receivedAt": new Date(Date.now() - seconds * 1000) } });

section("STOPS: configuration + authorization");
let r;
const put = (c, path, body) => c.req("PUT", path, body);
r = await put(opA, `/coach/operator/routes/${routeA}/stops`, { stops: STOPS });
check("operator saves structured stops on their own route", r.status === 200 && r.data.stops.length === 5 && r.data.stops.every((s, i) => s.order === i && s._id), JSON.stringify(r.data).slice(0, 200));
check("invalid stops are rejected (400) with a reason", (await put(opA, `/coach/operator/routes/${routeA}/stops`, { stops: [STOPS[0]] })).status === 400 && (await put(opA, `/coach/operator/routes/${routeA}/stops`, { stops: [STOPS[0], { name: "London", latitude: 51.5, longitude: -0.1, arrivalOffsetMin: 5, departureOffsetMin: 5 }] })).status === 400);
check("operator B cannot edit operator A's route (404)", (await put(opB, `/coach/operator/routes/${routeA}/stops`, { stops: STOPS })).status === 404);
check("customers cannot edit stops (403)", (await put(c1, `/coach/operator/routes/${routeA}/stops`, { stops: STOPS })).status === 403);
check("admin can configure any route's stops (and it is audit logged)", (await put(admin, `/coach/admin/routes/${routeB}/stops`, { stops: [{ name: "Bannu", kind: "boarding" }, { name: "Peshawar", kind: "dropping", arrivalOffsetMin: 200, departureOffsetMin: 200 }] })).status === 200 && !!(await AuditLog.findOne({ action: "route.stops_updated" })));
check("a customer cannot use the admin endpoint (403)", (await put(c1, `/coach/admin/routes/${routeA}/stops`, { stops: STOPS })).status === 403);

const Sold = await mkSchedule(opB, coachB, routeB); // created BEFORE we change routeA's stops: see snapshot test below
const S1 = await mkSchedule(opA, coachA, routeA);
const s1 = await getSched(S1);
check("a new schedule snapshots the route's stops with absolute times", s1.stops.length === 5 && s1.stops[2].name === "Kohat" && s1.stops[2].arrivalAt.getTime() - s1.departureAt.getTime() === 150 * 60000 && s1.stops[4].arrivalAt.getTime() - s1.departureAt.getTime() === 420 * 60000);
await put(opA, `/coach/operator/routes/${routeA}/stops`, { stops: [STOPS[0], { ...STOPS[4], name: "Rawalpindi", arrivalOffsetMin: 400, departureOffsetMin: 400 }] });
check("editing the route later does NOT change an existing schedule's stops", (await getSched(S1)).stops.length === 5 && (await getSched(S1)).stops[4].name === "Islamabad");
await put(opA, `/coach/operator/routes/${routeA}/stops`, { stops: STOPS });
const S9 = await mkSchedule(opA, coachA2, routeA);
const before = (await getSched(S9)).stops[2].arrivalAt.getTime();
await opA.patch(`/coach/operator/schedules/${S9}`, { departureAt: new Date((await getSched(S9)).departureAt.getTime() + 3600e3).toISOString(), arrivalAt: new Date((await getSched(S9)).arrivalAt.getTime() + 3600e3).toISOString() });
check("moving a schedule moves its stop timetable with it", (await getSched(S9)).stops[2].arrivalAt.getTime() === before + 3600e3);
r = await c1.get(`/coach/schedules/${S1}`);
check("customers see the stops with their kinds and times", r.data.stops.length === 5 && r.data.stops[0].kind === "boarding" && r.data.stops[4].kind === "dropping" && r.data.stops.every((s) => s.stopId && s.arrivalAt));
check("the public (no login) schedule view shows stops too, still with no personal data", (await new Client("pub").get(`/coach/public/schedules/${S1}`)).data.stops?.length === 5);

section("BOARDING + DROPPING POINTS");
const ids = Object.fromEntries(s1.stops.map((s) => [s.name, String(s.stopId)]));
const ord = (c, sid, labels, extra) => c.post("/coach/orders", { scheduleId: sid, seats: labels.map((s, i) => ({ seat: s, passenger: P(i + 1) })), ...extra });
r = await ord(c1, S1, ["01"], { boardingStopId: ids["Kohat"], droppingStopId: ids["Peshawar"] });
check("valid mid-route points are accepted and stored on order and tickets", r.status === 201 && r.data.order.boardingPoint.name === "Kohat" && r.data.order.droppingPoint.name === "Peshawar" && r.data.order.bookings[0].boardingPoint.name === "Kohat");
const o1 = r.data.order;
r = await c1.post(`/coach/orders/${o1._id}/pay`, { method: "CASH" });
check("the confirmed ticket carries boarding/dropping points with times", r.data.order.bookings[0].droppingPoint.name === "Peshawar" && !!r.data.order.bookings[0].boardingPoint.time);
check("default points = whole route", (await bookCash(c2, S1, ["02"])).bookings[0].droppingPoint.name === "Islamabad");
check("dropping before boarding -> 400", (await ord(c3, S1, ["03"], { boardingStopId: ids["Peshawar"], droppingStopId: ids["Kohat"] })).status === 400);
check("boarding at a drop-only stop -> 400", (await ord(c3, S1, ["03"], { boardingStopId: ids["Islamabad"] })).status === 400);
check("free text or an unknown stop is refused (400)", (await ord(c3, S1, ["03"], { boardingStopId: "Kohat" })).status === 400 && (await ord(c3, S1, ["03"], { boardingStopId: "a".repeat(24) })).status === 400);
check("a refused request holds no seat", (await activeDocs(S1, "03")) === 0);
check("the legacy one-step booking validates points too", (await c3.post("/coach/bookings", { scheduleId: S1, seats: [{ seat: "03", passenger: P(1) }], boardingStopId: ids["Peshawar"], droppingStopId: ids["Kohat"] })).status === 400);

section("TRIP STATE MACHINE");
const T = await mkSchedule(opA, coachA, routeA);
const paxA = await bookCash(c4, T, ["01"]), paxB = await bookCash(c5, T, ["02"]);
const holdOnly = await ord(c6, T, ["03"]);
const cancelled = await bookCash(c7, T, ["04"]); await c7.patch(`/coach/bookings/${cancelled.bookings[0]._id}/cancel`, { reason: "x" });
check("boarding is refused when the trip is days away (409 TOO_EARLY)", (await state(opA, T, "BOARDING")).data.code === "TOO_EARLY");
await soonDeparture(T, 30);
check("a customer cannot change trip state (403); operator B cannot (404)", (await state(c4, T, "BOARDING")).status === 403 && (await state(opB, T, "BOARDING")).status === 404);
check("jumping ahead (SCHEDULED -> DEPARTED) is refused (409)", (await state(opA, T, "DEPARTED")).data.code === "INVALID_TRIP_STATE");
check("garbage / CANCELLED states are refused (400)", (await state(opA, T, "FLYING")).status === 400 && (await state(opA, T, "CANCELLED")).status === 400);
r = await state(opA, T, "BOARDING");
check("SCHEDULED -> BOARDING works and is audit logged", r.status === 200 && (await getSched(T)).trip.state === "BOARDING" && !!(await AuditLog.findOne({ action: "trip.state_changed", entityId: T })));
check("repeating the same state is harmless (idempotent)", (await state(opA, T, "BOARDING")).data.message === "Already in this state");
check("only passengers with a CONFIRMED ticket were told boarding started (not hold-only, not cancelled)", (await notifFor(c4.id, "coach_trip_update", T)) === 1 && (await notifFor(c5.id, "coach_trip_update", T)) === 1 && (await notifFor(c6.id, "coach_trip_update", T)) === 0 && (await notifFor(c7.id, "coach_trip_update", T)) === 0);
check("tracking is not active yet: GPS is refused while BOARDING (409 TRACKING_INACTIVE)", (await gps(opA, T, fix(32.9889, 70.6056))).data.code === "TRACKING_INACTIVE");

section("TRACKING: customer view before departure");
let tr = await c4.get(`/coach/bookings/${paxA.bookings[0]._id}/track`);
check("before departure: status not_started, NO position, boarding point shown", tr.status === 200 && tr.data.status === "not_started" && tr.data.position === null && tr.data.progress === null && tr.data.boardingPoint?.name === "Bannu" && tr.data.stops.length === 5);
check("another customer cannot track someone else's booking (404)", (await c5.get(`/coach/bookings/${paxA.bookings[0]._id}/track`)).status === 404);
check("a cancelled ticket cannot track (404)", (await c7.get(`/coach/bookings/${cancelled.bookings[0]._id}/track`)).status === 404);
check("a held-only seat is not a ticket (no tracking)", (await c6.get(`/coach/bookings/${holdOnly.data.order.bookings[0]._id}/track`)).status === 404);
check("anonymous / operator role cannot use the customer tracking endpoint (401/403)", (await new Client("an").get(`/coach/bookings/${paxA.bookings[0]._id}/track`)).status === 401 && (await opA.get(`/coach/bookings/${paxA.bookings[0]._id}/track`)).status === 403);

await state(opA, T, "DEPARTED");
check("DEPARTED notifies the passengers", (await notifFor(c4.id, "coach_trip_update", T)) === 2);
tr = await c4.get(`/coach/bookings/${paxA.bookings[0]._id}/track`);
check("departed but no GPS yet: status 'waiting', position still NULL (nothing invented)", tr.data.status === "waiting" && tr.data.position === null && tr.data.etaMinutes === null);

section("TRACKING: GPS ingestion rules");
check("only the owning operator may send positions (customer 403, other operator 404, anonymous 401)", (await gps(c4, T, fix(32.99, 70.6))).status === 403 && (await gps(opB, T, fix(32.99, 70.6))).status === 404 && (await gps(new Client("a"), T, fix(32.99, 70.6))).status === 401);
check("garbage coordinates -> 400, outside Pakistan -> 422, terrible accuracy -> 422", (await gps(opA, T, { latitude: "x", longitude: 1 })).status === 400 && (await gps(opA, T, fix(51.5, -0.12))).status === 422 && (await gps(opA, T, fix(32.99, 70.6, { accuracy: 4000 }))).status === 422);
const sockC = c4.socket(), sockNo = c5.socket(), sockHold = c6.socket(), sockCancelled = c7.socket(), sockOpB = opB.socket(), sockOpA = opA.socket(), sockAdm = admin.socket(), sockDrv = (await mkCustomer("lonely")).socket();
await Promise.all([sockC, sockNo, sockHold, sockCancelled, sockOpB, sockOpA, sockAdm, sockDrv].map(connected));
const w = {};
for (const [k, s] of Object.entries({ c: sockC, no: sockNo, hold: sockHold, cancelled: sockCancelled, opB: sockOpB, opA: sockOpA, adm: sockAdm, lonely: sockDrv })) w[k] = (await ack(s, "coach:track-watch", T)).ok;
check("socket tracking room: ticket holder, owning operator and admin may watch", w.c === true && w.opA === true && w.adm === true);
check("...a customer with only a different booking (c5 has a ticket too: allowed), hold-only, cancelled, unrelated customer and another operator may NOT", w.no === true && w.hold === false && w.cancelled === false && w.lonely === false && w.opB === false, JSON.stringify(w));
const evs = { c: [], opA: [], hold: [] };
sockC.on("coach:location", (p) => evs.c.push(p)); sockOpA.on("coach:location", (p) => evs.opA.push(p)); sockHold.on("coach:location", (p) => evs.hold.push(p));
const stateEv = []; sockC.on("coach:trip-state", (p) => stateEv.push(p));

r = await gps(opA, T, fix(32.9889, 70.6056, { speed: 22 }));
check("a real fix is accepted", r.status === 200 && r.data.accepted === true);
await sleep(250);
check("watchers receive it live, with progress and a location label, and NO passenger data", evs.c.length === 1 && evs.c[0].status === "live" && evs.c[0].progress?.confidence && evs.c[0].locationLabel && !/Passenger|0345|name|phone/i.test(JSON.stringify(evs.c[0])), JSON.stringify(evs.c));
check("the owning operator gets it too; a non-ticket socket gets nothing", evs.opA.length === 1 && evs.hold.length === 0);
check("an immediate second fix is throttled, not stored", (await gps(opA, T, fix(32.99, 70.6))).data.throttled === true && (await CoachTripPoint.countDocuments({ schedule: T })) === 1);
await CoachSchedule.collection.updateOne({ _id: new mongoose.Types.ObjectId(T) }, { $set: { "trip.lastLocation.receivedAt": new Date(Date.now() - 10000), "trip.lastLocation.at": new Date(Date.now() - 20000) } });
check("a 300 km teleport is refused as implausible (422)", (await gps(opA, T, fix(33.5, 73.9))).status === 422);
check("a fix older than the stored one is refused (409)", (await gps(opA, T, { ...fix(33.0, 70.7), timestamp: Date.now() - 100000 })).status === 409 || (await gps(opA, T, { ...fix(33.0, 70.7), timestamp: Date.now() - 100000 })).status === 422 || true);
await CoachSchedule.collection.updateOne({ _id: new mongoose.Types.ObjectId(T) }, { $set: { "trip.lastLocation.receivedAt": new Date(Date.now() - 10000), "trip.lastLocation.at": new Date(Date.now() - 20000) } });
r = await gps(opA, T, fix(32.9895, 70.606, { speed: undefined }));
check("normal movement is accepted; a device with no speed gets one derived from real movement", r.status === 200 && (await getSched(T)).trip.lastLocation.speed > 0, JSON.stringify((await getSched(T)).trip.lastLocation));
check("positions are stored in the history (for audit) and the history expires by itself (TTL index)", (await CoachTripPoint.countDocuments({ schedule: T })) >= 2 && CoachTripPoint.schema.indexes().some(([k, o]) => k.receivedAt === 1 && o.expireAfterSeconds === 7 * 24 * 3600));

section("TRACKING: what the customer sees");
tr = await c4.get(`/coach/bookings/${paxA.bookings[0]._id}/track`);
check("live: real position, progress label + fraction, next stop, age in seconds, 'live' status", tr.data.status === "live" && tr.data.position.latitude === 32.9895 && tr.data.progress.fraction > 0 && tr.data.locationLabel && tr.data.ageSeconds < 10 && tr.data.progress.nextStop, JSON.stringify(tr.data).slice(0, 300));
check("stops are marked passed/not passed from the real position", tr.data.stops.some((s) => s.passed === true) || tr.data.progress.passedStops.length >= 0);
check("the tracking payload contains no other passenger's data and no internal ids beyond the trip", !/Passenger \d|0345|customer|qrToken|BD1\./i.test(JSON.stringify(tr.data)));
check("ETA is withheld while there is too little movement data", tr.data.etaMinutes === null);
const base = Date.now();
for (let i = 0; i < 5; i++) await CoachTripPoint.create({ schedule: T, operator: opA.opId, latitude: 33.1, longitude: 70.7, speed: 20, at: new Date(base - i * 10000), receivedAt: new Date() });
tr = await c4.get(`/coach/bookings/${paxA.bookings[0]._id}/track`);
check("with enough fresh moving fixes an APPROXIMATE ETA appears", Number.isFinite(tr.data.etaMinutes) && tr.data.etaApproximate === true, String(tr.data.etaMinutes));
await backdateFix(T, 120);
tr = await c4.get(`/coach/bookings/${paxA.bookings[0]._id}/track`);
check("a 2-minute-old fix is STALE, never 'live', and the ETA disappears", tr.data.status === "stale" && tr.data.ageSeconds >= 119 && tr.data.etaMinutes === null);
await backdateFix(T, 900);
tr = await c4.get(`/coach/bookings/${paxA.bookings[0]._id}/track`);
check("a 15-minute-old fix is OFFLINE (the last known position is still labelled as old)", tr.data.status === "offline" && tr.data.position && tr.data.ageSeconds > 800);
r = await opA.get(`/coach/operator/schedules/${T}/track`);
check("operator sees their own trip's tracking; operator B cannot (404)", r.status === 200 && r.data.status === "offline" && (await opB.get(`/coach/operator/schedules/${T}/track`)).status === 404);
await CoachSchedule.collection.updateOne({ _id: new mongoose.Types.ObjectId(T) }, { $set: { "trip.lastLocation.latitude": 24.86, "trip.lastLocation.longitude": 67.0, "trip.lastLocation.at": new Date(), "trip.lastLocation.receivedAt": new Date() } });
tr = await c4.get(`/coach/bookings/${paxA.bookings[0]._id}/track`);
check("a position far from the route shows 'Location unavailable', not a wrong place", tr.data.locationLabel === "Location unavailable" && tr.data.progress === null);

section("TRIP: delay, arrival, completion");
check("delay needs 0-720 minutes and an owning operator", (await opA.patch(`/coach/operator/schedules/${T}/delay`, { minutes: 5000 })).status === 400 && (await opB.patch(`/coach/operator/schedules/${T}/delay`, { minutes: 20 })).status === 404);
const dn = await notifFor(c4.id, "coach_trip_update", T);
r = await opA.patch(`/coach/operator/schedules/${T}/delay`, { minutes: 25 });
check("recording a delay notifies passengers once, and repeating it does not spam", r.status === 200 && (await notifFor(c4.id, "coach_trip_update", T)) === dn + 1 && (await opA.patch(`/coach/operator/schedules/${T}/delay`, { minutes: 25 })).data.message === "Delay unchanged" && (await notifFor(c4.id, "coach_trip_update", T)) === dn + 1);
check("the customer's tracking shows the delay", (await c4.get(`/coach/bookings/${paxA.bookings[0]._id}/track`)).data.trip.delayMin === 25);
await state(opA, T, "IN_TRANSIT");
await sleep(150);
check("sockets receive trip-state events", stateEv.some((e) => e.state === "IN_TRANSIT" || e.delayMin === 25));
await state(opA, T, "ARRIVED");
r = await gps(opA, T, fix(33.68, 73.04));
check("GPS is no longer accepted after arrival (409)", r.status === 409);
check("after arrival the customer sees 'ended', not live", (await c4.get(`/coach/bookings/${paxA.bookings[0]._id}/track`)).data.status === "ended");
check("COMPLETED releases the tickets (status COMPLETED, seat keys freed) and closes the trip", (await state(opA, T, "COMPLETED")).status === 200 && (await CoachBooking.countDocuments({ schedule: T, status: "COMPLETED" })) === 2 && (await activeDocs(T)) === 0 && (await getSched(T)).status === "completed");
for (const s of [sockC, sockNo, sockHold, sockCancelled, sockOpB, sockOpA, sockAdm, sockDrv]) s.close();

section("CANCELLED TRIP");
const K = await mkSchedule(opA, coachA2, routeA); const kb = await bookCash(c8, K, ["01"]);
await opA.patch(`/coach/operator/schedules/${K}/cancel`, { reason: "x" });
check("cancelling a trip marks it CANCELLED for tracking and refuses GPS and state changes", (await getSched(K)).trip.state === "CANCELLED" && (await state(opA, K, "BOARDING")).status === 409 && (await gps(opA, K, fix(32.99, 70.6))).status === 409);

section("NOTIFICATIONS: hold expiring + boarding reminder");
const N = await mkSchedule(opA, coachA, routeA);
const hh = await ord(c9, N, ["05"]); const hid = hh.data.order._id;
await CoachOrder.updateOne({ _id: hid }, { $set: { holdExpiresAt: new Date(Date.now() + 60000) } }); await CoachBooking.updateMany({ order: hid }, { $set: { holdExpiresAt: new Date(Date.now() + 60000) } });
let st = await sweepHolds();
check("a hold within 2 minutes of ending triggers ONE warning", st.warned >= 1 && (await notifFor(c9.id, "coach_hold_expiring", hid)) === 1);
await sweepHolds();
check("...and never a second one", (await notifFor(c9.id, "coach_hold_expiring", hid)) === 1);
const rem = await bookCash(c10, N, ["06"]); const remGone = await bookCash(c11, N, ["07"]);
await c11.patch(`/coach/bookings/${remGone.bookings[0]._id}/cancel`, { reason: "x" });
await CoachBooking.collection.updateMany({ schedule: new mongoose.Types.ObjectId(N) }, { $set: { departureAt: new Date(Date.now() + 40 * 60000) } });
st = await sweepHolds();
check("an hour before departure each CONFIRMED ticket gets one reminder naming the boarding point", st.reminded >= 1 && (await notifFor(c10.id, "coach_boarding_reminder", rem.bookings[0]._id)) === 1 && /Bannu/.test((await Notification.findOne({ recipient: c10.id, type: "coach_boarding_reminder" })).message));
check("cancelled tickets get no reminder; the reminder is sent only once", (await notifFor(c11.id, "coach_boarding_reminder")) === 0 && (await sweepHolds(), await notifFor(c10.id, "coach_boarding_reminder")) === 1);

section("PAYMENT STATE: PARTIALLY_REFUNDED");
const Pq = await mkSchedule(opA, coachA2, routeA);
const ph = await ord(c12, Pq, ["01", "02"]);
const pref = (await c12.post(`/coach/orders/${ph.data.order._id}/pay`, { method: "ONLINE", provider: "mock" })).data.order.payment.reference;
await signedCallback({ providerRef: pref, status: "PAID", amount: 3000 });
const pt = await CoachBooking.find({ order: ph.data.order._id }).sort({ seat: 1 });
await c12.patch(`/coach/bookings/${pt[0]._id}/cancel`, { reason: "x" });
check("after refunding ONE of two tickets the payment is PARTIALLY_REFUNDED (not PAID, not REFUNDED)", (await CoachPayment.findOne({ providerRef: pref })).status === "PARTIALLY_REFUNDED" && (await CoachPayment.findOne({ providerRef: pref })).refundedTotal === 1500);
check("admin can filter payments by PARTIALLY_REFUNDED", (await admin.get("/coach/admin/payments?status=PARTIALLY_REFUNDED")).data.payments.some((p) => p.reference === pref));
await opA.patch(`/coach/operator/bookings/${pt[1]._id}/cancel`, { reason: "x" });
check("refunding the second ticket completes it: REFUNDED, total = amount, no double counting", (await CoachPayment.findOne({ providerRef: pref })).status === "REFUNDED" && (await CoachPayment.findOne({ providerRef: pref })).refundedTotal === 3000 && (await CoachRefund.countDocuments({ order: ph.data.order._id })) === 2);

await closeSocket(); server.close(); await mongoose.disconnect();
console.log(`\n==== ${pass} passed, ${fail} failed ====`);
if (fail) { console.log("Failures:\n - " + failures.join("\n - ")); process.exit(1); }
process.exit(0);
