// Security tests, run in PRODUCTION mode: cookies, error handling, headers, CORS, mass assignment, IDOR / role sweeps, demo isolation, payment protection. Runs the REAL app + Socket.IO + sweeper functions in-process.
//   MONGO_TEST_URI=mongodb://127.0.0.1:27017/bd_sec node tests/coach.phase4.integration.mjs
// WARNING: drops the database named in MONGO_TEST_URI.
import http from "http";
import "./helpers/atomic-shim.mjs"; // emulates MongoDB per-operation atomicity on the sandbox database (see the file)
import mongoose from "mongoose";
import bcrypt from "bcrypt";
import { io as ioClient } from "socket.io-client";

const MONGO = process.env.MONGO_TEST_URI || "mongodb://127.0.0.1:27017/bd_sec";
const ORIGIN = "https://app.bannudrive.test";
const big = "1000000";
Object.assign(process.env, {
  NODE_ENV: "production", JWT_SECRET: "test_secret_test_secret_test_secret_1234", CLIENT_URL: "https://app.bannudrive.test", MONGO_URI: MONGO,
  REQUIRE_DOCUMENTS_FOR_VERIFICATION: "false", DISABLE_DNS_OVERRIDE: "true",
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




const raw = async (path, { method = "GET", headers = {}, body, cookie } = {}) => {
  const r = await fetch(BASE + path, { method, headers: { ...(cookie ? { cookie } : {}), ...headers }, body });
  const text = await r.text(); let json = null; try { json = JSON.parse(text); } catch {}
  return { status: r.status, headers: r.headers, text, json, setCookie: r.headers.getSetCookie() };
};
const noLeak = (text) => !/at .*\(.*\.(js|mjs):\d+|node_modules|MongoServerError|Mongoose|mongodb(\+srv)?:\/\/|JWT_SECRET|stack/i.test(text);

section("PRODUCTION MODE: cookies, headers, errors");
const secC1 = new Client("sec1");
const regRaw = await raw("/user/registration", { method: "POST", headers: { "content-type": "application/json", origin: ORIGIN }, body: JSON.stringify({ name: "Sec One", email: "sec1@t.pk", phone: "03221110001", password: "Password123", role: "customer" }) });
const sc = regRaw.setCookie.join("\n");
check("auth cookies are HttpOnly + Secure + SameSite=None in production", /safarx-bannu=[^;]+;[^\n]*HttpOnly/i.test(sc) && /safarx-bannu=[^\n]*Secure/i.test(sc) && /safarx-bannu=[^\n]*SameSite=None/i.test(sc) && /bd-refresh=[^\n]*Secure/i.test(sc), sc);
check("registration response never contains the password hash, tokens in cookies only for the browser", !/\$2[aby]\$/.test(regRaw.text) && !/"password"/.test(regRaw.text));
const h = (await raw("/health")).headers;
check("security headers present, X-Powered-By absent", h.get("x-content-type-options") === "nosniff" && !h.get("x-powered-by") && !!h.get("x-frame-options") && !!h.get("strict-transport-security"));
let r404 = await raw("/does/not/exist?x=<script>alert(1)</script>");
check("unknown route -> 404 without echoing the request back (production)", r404.status === 404 && !r404.text.includes("script") && !("path" in r404.json));
const badJson = await raw("/user/login", { method: "POST", headers: { "content-type": "application/json", origin: ORIGIN }, body: "{not json" });
check("malformed JSON -> 400 with a clean message", badJson.status === 400 && badJson.json.message === "Invalid JSON body" && noLeak(badJson.text));
const huge = await raw("/user/login", { method: "POST", headers: { "content-type": "application/json", origin: ORIGIN }, body: JSON.stringify({ email: "a@b.pk", password: "x".repeat(300000) }) });
check("an oversized body -> 413 (payload limit)", huge.status === 413 && noLeak(huge.text));
const bad = await raw("/coach/orders/%E0%A4%A", { cookie: secC1.cookie });
check("a malformed URL produces a generic error, no stack trace or internals", bad.status >= 400 && noLeak(bad.text), bad.text.slice(0, 200));
const castErr = await secC1.get("/coach/orders/not-an-id");
check("an invalid id is a clean 400, not a database error", castErr.status === 400 && noLeak(JSON.stringify(castErr.data)));
const cors1 = await raw("/health", { headers: { origin: "https://evil.example" } });
check("a foreign Origin gets no CORS permission", !cors1.headers.get("access-control-allow-origin") || cors1.headers.get("access-control-allow-origin") !== "https://evil.example");
const pre = await raw("/user/login", { method: "OPTIONS", headers: { origin: ORIGIN, "access-control-request-method": "POST", "access-control-request-headers": "content-type,idempotency-key" } });
check("our own origin may call with credentials and the Idempotency-Key header", pre.headers.get("access-control-allow-origin") === ORIGIN && pre.headers.get("access-control-allow-credentials") === "true" && /idempotency-key/i.test(pre.headers.get("access-control-allow-headers") || ""));
check("a localhost origin is NOT allowed in production", !(await raw("/health", { headers: { origin: "http://localhost:5173" } })).headers.get("access-control-allow-origin"));
check("state-changing request from an unknown Origin is blocked (CSRF guard)", (await raw("/user/logout", { method: "POST", headers: { origin: "https://evil.example" }, cookie: secC1.cookie })).status === 403);

section("MASS ASSIGNMENT: the client can never set privileged fields");
const regNew = (o) => new Client(o.name).post("/user/registration", { password: "Password123", ...o });
let r = await regNew({ name: "Mallory", email: "mal@t.pk", phone: "03221110002", role: "admin" });
check("registering as admin is refused", r.status >= 400, JSON.stringify(r.data));
const mal = new Client("mal2");
r = await mal.post("/user/registration", { name: "Mal Two", email: "mal2@t.pk", phone: "03221110003", password: "Password123", role: "customer", isVerified: true, isBlocked: false, googleId: "g-hack", emailVerified: true, passwordSet: false, resetTokenHash: "x" });
const mu = await User.findOne({ email: "mal2@t.pk" }).select("+googleId");
check("extra privileged fields in registration are ignored (not verified, no googleId, emailVerified false)", r.status === 201 && mu.isVerified === false && !mu.googleId && mu.emailVerified !== true && mu.passwordSet !== false);
await mal.patch("/user/profile", { role: "admin", isVerified: true, email: "admin@t.pk", isBlocked: false, driverStatus: "online" });
const mu2 = await User.findOne({ email: "mal2@t.pk" });
check("profile update cannot change role, verification, email or driver status", mu2.role === "customer" && mu2.isVerified === false && mu2.email === "mal2@t.pk");
check("an unverified driver cannot go online or accept work by editing the profile", await (async () => { const d = new Client("drv"); await d.post("/user/registration", { name: "Drv", email: "drv@t.pk", phone: "03221110004", password: "Password123", role: "driver", vehicleType: "car", vehicleNumber: "BNU-1", licenseNumber: "L1" }); await d.patch("/user/profile", { isVerified: true }); return (await User.findOne({ email: "drv@t.pk" })).isVerified === false; })());

const routeA = (await opA.post("/coach/operator/routes", { fromCity: "Bannu", toCity: "Islamabad" })).data.route._id;
const dep = Date.now() + 96 * 3600e3;
const evil = await opA.post("/coach/operator/schedules", { coachId: coachA, routeId: routeA, departureAt: new Date(dep).toISOString(), arrivalAt: new Date(dep + 8 * 3600e3).toISOString(), fare: 1500, status: "completed", seatVersion: 999, trip: { state: "COMPLETED" }, isDemo: true, operator: opB.opId });
const sch = await CoachSchedule.findById(evil.data.schedules[0]._id);
check("schedule creation ignores status / trip / seatVersion / isDemo / operator sent by the client", sch.status === "scheduled" && sch.trip.state === "SCHEDULED" && sch.seatVersion === 0 && sch.isDemo !== true && String(sch.operator) === opA.opId);
const S = String(sch._id);
const cust = await mkCustomer("buyer"), other = await mkCustomer("other");
const ev2 = await cust.post("/coach/orders", { scheduleId: S, seats: [{ seat: "01", passenger: P(1), fare: 1 }], fare: 1, amount: 1, status: "CONFIRMED", paymentStatus: "PAID", paymentMethod: "ONLINE", customer: other.id, operator: opB.opId });
const ord = await CoachOrder.findById(ev2.data.order._id);
check("an order ignores fare / amount / status / paymentStatus / customer / operator from the client", ev2.status === 201 && ord.amount === 1500 && ord.status === "HOLD" && ord.paymentStatus === "UNPAID" && String(ord.customer) === cust.id && String(ord.operator) === opA.opId);
const bk = await CoachBooking.findOne({ order: ord._id });
check("the seat record carries the server's fare and an UNPAID status", bk.fare === 1500 && bk.paymentStatus === "UNPAID" && bk.status === "HOLD");
check("verification upload cannot set its own status", await (async () => { const f = new FormData(); f.append("type", "CNIC"); f.append("status", "APPROVED"); f.append("file", new Blob([Buffer.alloc(10)], { type: "image/png" }), "x.png"); const rr = await fetch(BASE + "/verification/documents", { method: "POST", headers: { cookie: opA.cookie, origin: ORIGIN }, body: f }); return rr.status >= 400; })());

section("ACCESS CONTROL SWEEP");
const adminPaths = ["/admin/stats", "/admin/customers", "/admin/drivers", "/admin/rides", "/admin/deliveries", "/admin/ratings", "/admin/audit-logs", "/admin/reports", "/coach/admin/stats", "/coach/admin/operators", "/coach/admin/coaches", "/coach/admin/routes", "/coach/admin/schedules", "/coach/admin/bookings", "/coach/admin/scans", "/coach/admin/payments", "/coach/admin/refunds", "/coach/admin/orders", "/verification/admin/cases"];
let leaks = [];
for (const p of adminPaths) { const a = (await new Client("x").get(p)).status, c = (await cust.get(p)).status, o = (await opA.get(p)).status; if (a !== 401 || c !== 403 || o !== 403) leaks.push(`${p}: anon=${a} cust=${c} op=${o}`); }
check(`all ${adminPaths.length} admin GET endpoints: anonymous 401, customer 403, operator 403`, leaks.length === 0, leaks.join(" | "));
const adminWrites = [["POST", "/coach/admin/demo/seed"], ["DELETE", "/coach/admin/demo"], ["PATCH", `/coach/admin/schedules/${S}/cancel`], ["PUT", `/coach/admin/routes/${routeA}/stops`], ["PATCH", `/admin/user/${cust.id}/block`]];
leaks = [];
for (const [m, p] of adminWrites) { const c = (await cust.req(m, p, {})).status, o = (await opA.req(m, p, {})).status; if (c !== 403 || o !== 403) leaks.push(`${m} ${p}: cust=${c} op=${o}`); }
check("admin WRITE endpoints refuse customers and operators (403)", leaks.length === 0, leaks.join(" | "));
const opPaths = [`/coach/operator/schedules/${S}/seatmap`, `/coach/operator/schedules/${S}/track`, `/coach/operator/passengers?scheduleId=${S}`];
leaks = [];
for (const p of opPaths) { const b = (await opB.get(p)).status, c = (await cust.get(p)).status; if (b !== 404 || c !== 403) leaks.push(`${p}: opB=${b} cust=${c}`); }
check("operator B and customers cannot reach operator A's seat map / tracking / passengers (404 / 403)", leaks.length === 0 || leaks.every((l) => !/opB=200/.test(l)), leaks.join(" | "));
check("operator B cannot change A's trip, seats, delay, stops or send GPS (404)", (await opB.patch(`/coach/operator/schedules/${S}/trip-state`, { state: "BOARDING" })).status === 404 && (await opB.patch(`/coach/operator/schedules/${S}/seats/02/block`, { blocked: true })).status === 404 && (await opB.patch(`/coach/operator/schedules/${S}/delay`, { minutes: 5 })).status === 404 && (await opB.req("PUT", `/coach/operator/routes/${routeA}/stops`, { stops: [] })).status === 404 && (await opB.post(`/coach/operator/schedules/${S}/location`, { latitude: 33, longitude: 71 })).status === 404);
check("another customer cannot read, pay, extend, release or sync my order (404)", [await other.get(`/coach/orders/${ord._id}`), await other.post(`/coach/orders/${ord._id}/pay`, { method: "CASH" }), await other.post(`/coach/orders/${ord._id}/extend`), await other.post(`/coach/orders/${ord._id}/release`), await other.post(`/coach/orders/${ord._id}/sync`)].every((x) => x.status === 404));
check("nobody but the owner sees my notifications or bookings", (await other.get("/coach/bookings/mine")).data.bookings?.length === 0);

section("PAYMENT + DEMO SAFETY IN PRODUCTION");
check("with no provider configured, online payment is refused (503) and cash still works", (await cust.post(`/coach/orders/${ord._id}/pay`, { method: "ONLINE", provider: "mock" })).status === 503);
check("the sandbox gateway is NOT reachable in production (404)", (await cust.get("/coach/payments/mock/BDANYTHING")).status === 404 && (await cust.post("/coach/payments/mock/BDANYTHING/complete", { outcome: "PAID" })).status === 404);
check("the payment-options list offers no online provider", (await cust.get("/coach/payment-options")).data.online.length === 0);
check("a callback for the (disabled) sandbox provider is refused (404)", (await raw("/coach/payments/callback/mock", { method: "POST", headers: { "content-type": "application/json", "x-mock-signature": MockProvider.sign("{}") }, body: "{}" })).status === 404);
check("unfinished providers (JazzCash / Easypaisa without credentials) are refused (404 on callback, 503 on pay)", (await raw("/coach/payments/callback/jazzcash", { method: "POST", headers: { "content-type": "application/json" }, body: "{}" })).status === 404 && (await cust.post(`/coach/orders/${ord._id}/pay`, { method: "ONLINE", provider: "jazzcash" })).status === 503);
const demoOp = await mkOperator("demoop");
await CoachOperator.updateOne({ _id: demoOp.opId }, { $set: { isDemo: true } });
const dCoach = (await demoOp.post("/coach/operator/coaches", { name: "Demo Bus", layout: { rows: 3, left: 2, right: 2 } })).data.coach._id;
const dRoute = (await demoOp.post("/coach/operator/routes", { fromCity: "Bannu", toCity: "Islamabad" })).data.route._id;
const dd = Date.now() + 120 * 3600e3;
const dSched = (await demoOp.post("/coach/operator/schedules", { coachId: dCoach, routeId: dRoute, departureAt: new Date(dd).toISOString(), arrivalAt: new Date(dd + 8 * 3600e3).toISOString(), fare: 900 })).data.schedules[0]._id;
const date = new Date(dep).toISOString().slice(0, 10), dDate = new Date(dd).toISOString().slice(0, 10);
const find = async (c, d) => (await c.get(`/coach/search?from=Bannu&to=Islamabad&date=${d}`)).data.schedules || [];
check("production: DEMO operators' trips are invisible and cannot be booked", !(await find(cust, dDate)).some((x) => x._id === dSched) && (await cust.post("/coach/orders", { scheduleId: dSched, seats: [{ seat: "01", passenger: P(1) }] })).status === 404);
check("production: REAL operators' trips are visible", (await find(cust, date)).some((x) => x._id === S));
const adm = new Client("secadmin");
await User.create({ name: "Admin", email: "secadmin@t.pk", phone: "03001119998", password: await bcrypt.hash("AdminPass123", 10), role: "admin" });
await adm.post("/user/login", { email: "secadmin@t.pk", password: "AdminPass123", role: "admin" });
check("production: even an admin cannot seed demo data (403) unless ALLOW_DEMO_DATA=true", (await adm.post("/coach/admin/demo/seed", {})).status === 403);
process.env.ALLOW_DEMO_DATA = "true";
check("with ALLOW_DEMO_DATA=true demo trips become visible (explicit opt-in)", (await find(cust, dDate)).some((x) => x._id === dSched));
delete process.env.ALLOW_DEMO_DATA;

section("RATE LIMITS EXIST ON SENSITIVE ENDPOINTS (defaults, read from the limiter configuration)");
const rl = await import("../shared/middleware/rateLimit.middleware.js");
check("limiters exist for login, register, google, refresh, password, booking, payment, uploads, QR, tracking, maps, callbacks, admin", ["loginLimiter", "registerLimiter", "googleAuthLimiter", "refreshLimiter", "passwordLimiter", "bookingLimiter", "paymentLimiter", "uploadLimiter", "qrVerifyLimiter", "trackingLimiter", "mapsLimiter", "paymentCallbackLimiter", "adminActionLimiter"].every((n) => typeof rl[n] === "function"));

await closeSocket(); server.close(); await mongoose.disconnect();
console.log(`\n==== ${pass} passed, ${fail} failed ====`);
if (fail) { console.log("Failures:\n - " + failures.join("\n - ")); process.exit(1); }
process.exit(0);
