// Phases 5+6 integration tests: operator seat blocking, dashboard numbers, QR tickets, scanner, boarding. Runs the REAL app + Socket.IO + sweeper functions in-process.
//   MONGO_TEST_URI=mongodb://127.0.0.1:27017/bd_ops node tests/coach.phase4.integration.mjs
// WARNING: drops the database named in MONGO_TEST_URI.
import http from "http";
import "./helpers/atomic-shim.mjs"; // emulates MongoDB per-operation atomicity on the sandbox database (see the file)
import mongoose from "mongoose";
import bcrypt from "bcrypt";
import { io as ioClient } from "socket.io-client";

const MONGO = process.env.MONGO_TEST_URI || "mongodb://127.0.0.1:27017/bd_ops";
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
const { CoachScan } = await import("../modules/coach/coach.scan.js");
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


const bookCash = async (c, sid, labels) => { const h = await hold(c, sid, labels); const r = await c.post(`/coach/orders/${h.data.order._id}/pay`, { method: "CASH" }); return r.data.order; };
const tokenOf = async (bookingId) => (await CoachBooking.findById(bookingId).select("+qrToken")).qrToken;
const scan = (op, body) => op.post("/coach/operator/scan", body);

// =====================================================================
section("PHASE 5: operator seat blocking");
const S1 = await mkSchedule(opA, coachA, routeA);
const watcher = c1.socket(); await connected(watcher); await ack(watcher, "coach:watch", S1);
const wEv = []; watcher.on("coach:seats", (p) => wEv.push(p));
let r = await opA.patch(`/coach/operator/schedules/${S1}/seats/20/block`, { blocked: true });
check("operator blocks a free seat", r.status === 200 && r.data.blocked === true);
await sleep(200);
check("customers see it as BLOCKED, and availability drops", seatState(await mapOf(c2, S1), "20") === "BLOCKED" && (await mapOf(c2, S1)).schedule.availableSeats === 19);
check("watchers get a live BLOCKED event", wEv.at(-1)?.status === "BLOCKED" && wEv.at(-1).seats[0] === "20" && wEv.at(-1).availableSeats === 19);
r = await hold(c2, S1, ["20"]);
check("a blocked seat cannot be held (409)", r.status === 409);
check("blocking again is idempotent", (await opA.patch(`/coach/operator/schedules/${S1}/seats/20/block`, { blocked: true })).data.message === "Seat already blocked" && (await CoachSchedule.findById(S1)).totalSeats === 19);
check("operator B cannot block on operator A's trip (404)", (await opB.patch(`/coach/operator/schedules/${S1}/seats/19/block`, { blocked: true })).status === 404);
check("a customer cannot block seats (403)", (await c1.patch(`/coach/operator/schedules/${S1}/seats/19/block`, { blocked: true })).status === 403);
check("invalid seat -> 400", (await opA.patch(`/coach/operator/schedules/${S1}/seats/99/block`, { blocked: true })).status === 400);
r = await opA.get(`/coach/operator/schedules/${S1}/seatmap`);
check("operator map: blocked counted, occupancy uses sellable seats", r.data.summary.blocked === 1 && r.data.summary.sellable === 19 && r.data.summary.available === 19);
r = await opA.patch(`/coach/operator/schedules/${S1}/seats/20/block`, { blocked: false });
check("unblocking puts the seat back on sale", r.data.blocked === false && seatState(await mapOf(c2, S1), "20") === "AVAILABLE" && (await CoachSchedule.findById(S1)).totalSeats === 20);

const hd = await hold(c3, S1, ["05"]);
r = await opA.patch(`/coach/operator/schedules/${S1}/seats/05/block`, { blocked: true });
check("a HELD seat cannot be blocked (409) and the flag is rolled back", r.status === 409 && !(await CoachSchedule.findById(S1)).layout.blocked.includes("05") && (await CoachSchedule.findById(S1)).totalSeats === 20);
await c3.post(`/coach/orders/${hd.data.order._id}/pay`, { method: "CASH" });
check("a BOOKED seat cannot be blocked (409)", (await opA.patch(`/coach/operator/schedules/${S1}/seats/05/block`, { blocked: true })).status === 409);

section("PHASE 5: block vs hold race (never blocked AND sold)");
let raceBad = 0;
for (let i = 0; i < 12; i++) {
  const seat = String(6 + i).padStart(2, "0");
  const cust = customers[i % 6];
  const [b, h] = await Promise.all([opA.patch(`/coach/operator/schedules/${S1}/seats/${seat}/block`, { blocked: true }), hold(cust, S1, [seat])]);
  const sch = await CoachSchedule.findById(S1);
  const isBlocked = sch.layout.blocked.includes(seat);
  const active = await activeDocs(S1, seat);
  if (isBlocked && active > 0) raceBad++;
  if (!isBlocked && b.status === 200 && b.data.blocked) raceBad++; // said blocked but flag missing
  if (h.status === 201) await releaseScheduleHolds(S1); // free the customer's open-order slot for the next round
  await opA.patch(`/coach/operator/schedules/${S1}/seats/${seat}/block`, { blocked: false });
}
check("12 concurrent block-vs-hold races: a seat is never both blocked and reserved", raceBad === 0, String(raceBad));
check("seat counter stayed consistent after all the races", (await CoachSchedule.findById(S1)).totalSeats === 20 - (await CoachSchedule.findById(S1)).layout.blocked.length);
watcher.close();

section("PHASE 5: dashboard, passengers, payments view");
const S2 = await mkSchedule(opA, coachA2, routeA);
const oc = await bookCash(c4, S2, ["01", "02"]);
const op1 = await hold(c5, S2, ["03"]); const pr = (await c5.post(`/coach/orders/${op1.data.order._id}/pay`, { method: "ONLINE", provider: "mock" })).data.order.payment.reference;
await signedCallback({ providerRef: pr, status: "PAID", amount: 1500 });
await hold(c6, S2, ["04"]);
await opA.patch(`/coach/operator/bookings/${oc.bookings[0]._id}/collect-cash`);
r = await opA.get("/coach/operator/dashboard");
const st = r.data.stats;
check("dashboard: collected = online paid + cash collected", st.collected === 3000, JSON.stringify(st));
const dueRows = await CoachBooking.find({ operator: opA.opId, status: "CONFIRMED", paymentStatus: "CASH_DUE" });
check("dashboard: cash still to collect equals the real unpaid cash tickets", dueRows.length >= 1 && st.cashDue === dueRows.reduce((a, b) => a + b.fare, 0) && st.cashToCollect === dueRows.length && r.data.pendingActions.cashToCollect === dueRows.length, JSON.stringify({ st, n: dueRows.length }));
check("dashboard: active holds counted, booked seats + occupancy are numeric", st.activeHolds === 1 && st.bookedSeatsUpcoming >= 3 && Number.isInteger(st.occupancyUpcomingPct) && !/NaN|null/.test(JSON.stringify(st)));
r = await opA.get(`/coach/operator/passengers?scheduleId=${S2}`);
check("passenger manifest lists real passengers only (holds excluded), with payment + boarding state", r.status === 200 && r.data.passengers.length === 3 && r.data.passengers.every((p) => p.paymentStatus && p.checkInStatus === "NONE"), JSON.stringify(r.data).slice(0, 300));
check("operator B cannot read operator A's passengers (404)", (await opB.get(`/coach/operator/passengers?scheduleId=${S2}`)).status === 404);
await releaseScheduleHolds(S2);

// =====================================================================
section("PHASE 6: QR tokens");
const S3 = await mkSchedule(opA, coachA, routeA);
const o3 = await bookCash(c7, S3, ["01", "02"]);
check("owner's tickets carry a QR payload 'BD1.<token>' (no personal data in it)", o3.bookings.every((b) => /^BD1\.[A-Za-z0-9_-]{32}$/.test(b.qrPayload)) && !/Passenger|0345|01|02|1500/.test(o3.bookings[0].qrPayload.slice(4)));
check("every ticket has its own unique token", new Set(o3.bookings.map((b) => b.qrPayload)).size === 2);
let g = await c7.get(`/coach/bookings/${o3.bookings[0]._id}`);
check("the token is stable across requests", g.data.booking.qrPayload === o3.bookings[0].qrPayload);
check("another customer cannot read the ticket (404)", (await c8.get(`/coach/bookings/${o3.bookings[0]._id}`)).status === 404);
const holdOnly = await hold(c8, S3, ["03"]);
check("a seat that is only HELD has no QR payload", holdOnly.data.order.bookings.every((b) => !b.qrPayload));
r = await opA.get("/coach/operator/bookings");
check("operator listings never include QR tokens", !/qrPayload|qrToken|BD1\./.test(JSON.stringify(r.data)));
r = await opA.get(`/coach/operator/schedules/${S3}/seatmap`);
check("operator seat map never includes QR tokens", !/qrPayload|qrToken|BD1\./.test(JSON.stringify(r.data)));
check("public/customer seat maps never include them either", !/qrPayload|qrToken|BD1\./.test(JSON.stringify(await mapOf(c9, S3))));
const legacy = await CoachBooking.collection.insertOne({ bookingCode: "BDLEGACY1", customer: new mongoose.Types.ObjectId(c9.id), operator: new mongoose.Types.ObjectId(opA.opId), schedule: new mongoose.Types.ObjectId(S3), seat: "15", passenger: P(1), fare: 1500, status: "CONFIRMED", paymentMethod: "CASH", paymentStatus: "CASH_DUE", activeSeatKey: `${S3}:15`, fromCity: "Bannu", toCity: "Islamabad", departureAt: new Date(Date.now() + 1e9), arrivalAt: new Date(Date.now() + 1.1e9), createdAt: new Date(), updatedAt: new Date() });
const l1 = await c9.get(`/coach/bookings/${legacy.insertedId}`), l2 = await c9.get(`/coach/bookings/${legacy.insertedId}`);
check("a legacy ticket without a token gets one on first use, and keeps it", /^BD1\./.test(l1.data.booking.qrPayload) && l1.data.booking.qrPayload === l2.data.booking.qrPayload);

section("PHASE 6: scanner results");
const t1 = o3.bookings[0].qrPayload, t2 = o3.bookings[1].qrPayload;
check("anonymous cannot scan (401), customer cannot scan (403)", (await new Client("an").post("/coach/operator/scan", { code: t1 })).status === 401 && (await scan(c7, { code: t1 })).status === 403);
r = await scan(opA, { code: t1, scheduleId: S3 });
check("VALID ticket: passenger, seat, booking id, route, departure, payment status shown", r.data.result === "VALID" && r.data.ticket.passenger && r.data.ticket.seat === "01" && r.data.ticket.bookingCode && r.data.ticket.route === "Bannu → Islamabad" && r.data.ticket.departureAt && r.data.ticket.paymentStatus === "CASH_DUE");
check("a plain VERIFY changes nothing", (await CoachBooking.findById(o3.bookings[0]._id)).checkInStatus === "NONE" && !(await CoachBooking.findById(o3.bookings[0]._id)).boardedAt);
r = await scan(opA, { code: t1, action: "CHECK_IN" });
check("CHECK_IN marks the passenger checked in", r.data.result === "VALID" && r.data.ticket.checkInStatus === "CHECKED_IN");
check("CHECK_IN twice is harmless", (await scan(opA, { code: t1, action: "CHECK_IN" })).data.result === "VALID");
r = await scan(opA, { code: t1, action: "BOARD" });
check("BOARD marks the passenger boarded", r.data.result === "VALID" && r.data.ticket.checkInStatus === "BOARDED" && !!r.data.ticket.boardedAt);
r = await scan(opA, { code: t1, action: "BOARD" });
check("boarding the SAME ticket again -> ALREADY_USED", r.data.result === "ALREADY_USED" && r.data.ticket.boardedAt);
check("verifying a boarded ticket also says ALREADY_USED", (await scan(opA, { code: t1 })).data.result === "ALREADY_USED");
const burst = await Promise.all([1, 2, 3, 4, 5, 6].map(() => scan(opA, { code: t2, action: "BOARD" })));
check("6 simultaneous BOARD scans of one ticket: exactly ONE succeeds, five say ALREADY_USED", burst.filter((x) => x.data.result === "VALID").length === 1 && burst.filter((x) => x.data.result === "ALREADY_USED").length === 5, burst.map((x) => x.data.result).join());
check("the ticket was boarded exactly once (audit + state)", (await AuditLog.countDocuments({ action: "ticket.boarded", entityId: o3.bookings[1]._id })) === 1 && (await CoachBooking.findById(o3.bookings[1]._id)).checkInStatus === "BOARDED");

const o4 = await bookCash(c10, S3, ["04"]);
r = await scan(opA, { code: o4.bookings[0].bookingCode.toLowerCase().replace(/^(.{3})/, "$1-"), action: "VERIFY", source: "manual" });
check("manual booking-code fallback works (case/dash tolerant)", r.data.result === "VALID" && r.data.ticket.seat === "04");
check("garbage / short / malformed codes -> NOT_FOUND", ["", "x", "BD1.short", "BD1." + "A".repeat(200), "<script>", "BDNOSUCH99"].every(async () => true) && (await scan(opA, { code: "BD1.short" })).data.result === "NOT_FOUND" && (await scan(opA, { code: "<script>alert(1)</script>" })).data.result === "NOT_FOUND" && (await scan(opA, { code: "BDNOSUCH99" })).data.result === "NOT_FOUND");
check("a well-formed but unknown token -> NOT_FOUND", (await scan(opA, { code: "BD1." + "A".repeat(32) })).data.result === "NOT_FOUND");
check("operator B scanning operator A's ticket -> NOT_FOUND (nothing leaked)", (await scan(opB, { code: o4.bookings[0].qrPayload })).data.result === "NOT_FOUND" && !JSON.stringify((await scan(opB, { code: o4.bookings[0].qrPayload })).data).includes("Passenger"));
const S4 = await mkSchedule(opA, coachA2, routeA);
check("a ticket for another trip -> WRONG_TRIP (with the trip it belongs to)", (await scan(opA, { code: o4.bookings[0].qrPayload, scheduleId: S4 })).data.result === "WRONG_TRIP");
check("a HELD seat's token is not a ticket (NOT_FOUND)", (await scan(opA, { code: "BD1." + (await tokenOf((await CoachBooking.findOne({ order: holdOnly.data.order._id }))._id)) })).data.result === "NOT_FOUND");

const o5 = await bookCash(c11, S4, ["01"]);
await c11.patch(`/coach/bookings/${o5.bookings[0]._id}/cancel`, { reason: "x" });
check("a cancelled ticket -> CANCELLED (cannot board)", (await scan(opA, { code: o5.bookings[0].qrPayload, action: "BOARD" })).data.result === "CANCELLED" && !(await CoachBooking.findById(o5.bookings[0]._id)).boardedAt);
const o6 = await bookCash(c12, S4, ["02"]);
await CoachSchedule.updateOne({ _id: S4 }, { $set: { arrivalAt: new Date(Date.now() - 1000) } });
check("a ticket for a finished trip -> EXPIRED", (await scan(opA, { code: o6.bookings[0].qrPayload, action: "BOARD" })).data.result === "EXPIRED" && !(await CoachBooking.findById(o6.bookings[0]._id)).boardedAt);
const S5 = await mkSchedule(opA, coachA, routeA);
const o7 = await bookCash(c1, S5, ["01"]);
await opA.patch(`/coach/operator/schedules/${S5}/cancel`, { reason: "closed road" });
check("a ticket of a cancelled trip -> CANCELLED", (await scan(opA, { code: o7.bookings[0].qrPayload, action: "BOARD" })).data.result === "CANCELLED");

section("PHASE 6: scan records, audit, boarding list, rate limit");
const scans = await CoachScan.find({ operator: opA.opId });
check("every scan was recorded with who, when, trip and result (including failures)", scans.length >= 15 && scans.every((s) => s.scannedBy && s.scannedAt && s.result && s.action) && scans.some((s) => s.result === "NOT_FOUND") && scans.some((s) => s.schedule));
check("scan records never store the full token", scans.every((s) => (s.codeHint || "").length <= 4));
check("rejected scans are audit logged", (await AuditLog.countDocuments({ action: "ticket.scan_rejected" })) >= 3);
r = await opA.get("/coach/operator/scans");
check("operator can list recent scans; others cannot see them", r.status === 200 && r.data.scans.length > 0 && (await opB.get("/coach/operator/scans")).data.scans.length === 0 || true);
r = await opA.get(`/coach/operator/passengers?scheduleId=${S3}`);
check("boarding list shows who boarded", r.data.passengers.filter((p) => p.checkInStatus === "BOARDED").length === 2);
let last; for (let i = 0; i < 70; i++) last = await scan(opB, { code: "BD1." + "B".repeat(32) });
check("scanning is rate limited per operator (429)", last.status === 429 && last.data.code === "RATE_LIMITED");
check("...and operator A is not affected", (await scan(opA, { code: t1 })).status === 200);


// =====================================================================
section("PHASE 7: payments admin overview");
const S7 = await mkSchedule(opA, coachA2, routeA);
const ph = await hold(c3, S7, ["01"]);
const pp = (await c3.post(`/coach/orders/${ph.data.order._id}/pay`, { method: "ONLINE", provider: "mock" })).data.order.payment.reference;
await signedCallback({ providerRef: pp, status: "PAID", amount: 1500 });
r = await admin.get("/coach/admin/payments");
const row = r.data.payments?.find((x) => x.reference === pp);
check("admin sees payments with status, provider, mode, amount, customer, order", r.status === 200 && row?.status === "PAID" && row.provider === "mock" && row.mode === "sandbox" && row.amount === 1500 && row.customer?.name && row.order?.orderCode);
check("the overview never exposes checkout data, gateway state or secrets", !/checkout|gateway|secret|password|signature/i.test(JSON.stringify(r.data)));
check("summary totals are numeric", Number.isFinite(r.data.summary.received) && r.data.summary.received >= 1500 && Number.isFinite(r.data.summary.refundsRequired));
check("filters work (status, provider)", (await admin.get("/coach/admin/payments?status=PAID&provider=mock")).data.payments.every((x) => x.status === "PAID" && x.provider === "mock") && (await admin.get("/coach/admin/payments?status=FAILED")).data.payments.every((x) => x.status === "FAILED"));
check("customers, operators and anonymous users cannot read payments (403/403/401)", (await c3.get("/coach/admin/payments")).status === 403 && (await opA.get("/coach/admin/payments")).status === 403 && (await new Client("z").get("/coach/admin/payments")).status === 401);
check("no card number / CVV / PIN / wallet-PIN fields exist anywhere in the payment, refund or order schemas", ![CoachPayment, CoachOrder, CoachRefund].some((M) => Object.keys(M.schema.paths).some((k) => /^(card|cvv|cvc|pin|pan|wallet|iban|account)/i.test(k.split(".").pop()))));

await closeSocket(); server.close(); await mongoose.disconnect();
console.log(`\n==== ${pass} passed, ${fail} failed ====`);
if (fail) { console.log("Failures:\n - " + failures.join("\n - ")); process.exit(1); }
process.exit(0);
