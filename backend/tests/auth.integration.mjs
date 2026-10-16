// Integration tests for Phase 2/3: sessions, Google sign-in, document verification, socket authorization,
// audit log, rate limits, role middleware. Runs the REAL Express app + Socket.IO in-process.
//   MONGO_TEST_URI=mongodb://127.0.0.1:27017/bd_auth node tests/auth.integration.mjs
// WARNING: drops the database named in MONGO_TEST_URI. Google verification is mocked (no network).
import "./helpers/atomic-shim.mjs";
import http from "http";
import https from "https";
import fs from "fs";
import { spawnSync } from "child_process";
import mongoose from "mongoose";
import bcrypt from "bcrypt";
import { io as ioClient } from "socket.io-client";

const MONGO = process.env.MONGO_TEST_URI || "mongodb://127.0.0.1:27017/bd_auth";
const ORIGIN = "http://localhost:5173";
Object.assign(process.env, {
  NODE_ENV: "development", JWT_SECRET: "test_secret_test_secret_test_secret_1234", CLIENT_URL: ORIGIN,
  GOOGLE_CLIENT_ID: "test-client.apps.googleusercontent.com", REFRESH_GRACE_SECONDS: "1", LOGIN_RATE_LIMIT: "6",
  REQUIRE_DOCUMENTS_FOR_VERIFICATION: "true", MONGO_URI: MONGO,
  CLOUDINARY_CLOUD_NAME: "demo", CLOUDINARY_API_KEY: "key", CLOUDINARY_API_SECRET: "secret", CLOUDINARY_UPLOAD_PREFIX: "https://127.0.0.1:9998", NODE_TLS_REJECT_UNAUTHORIZED: "0"
});

let pass = 0, fail = 0;
const failures = [];
const check = (name, cond, extra = "") => { if (cond) { pass++; console.log(`  PASS  ${name}`); } else { fail++; failures.push(name); console.log(`  FAIL  ${name} ${extra}`); } };
const section = (t) => console.log(`\n== ${t}`);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------- fake Cloudinary (https, self-signed) ----------
const cloud = { uploads: [], files: new Map() };
let n = 0;
if (!fs.existsSync("/tmp/fk.pem")) spawnSync("openssl", ["req", "-x509", "-newkey", "rsa:2048", "-nodes", "-keyout", "/tmp/fk.pem", "-out", "/tmp/fc.pem", "-days", "2", "-subj", "/CN=127.0.0.1"]);
const fake = https.createServer({ key: fs.readFileSync("/tmp/fk.pem"), cert: fs.readFileSync("/tmp/fc.pem") }, (req, res) => {
  const chunks = [];
  req.on("data", (c) => chunks.push(c));
  req.on("end", () => {
    const raw = Buffer.concat(chunks);
    const body = raw.toString("latin1");
    if (req.url.includes("/image/upload")) {
      const id = `bannu-drive/private/verification/fake_${++n}`;
      const fileStart = raw.indexOf("\r\n\r\n", raw.indexOf('name="file"')) + 4;
      cloud.files.set(id, raw.subarray(fileStart, raw.lastIndexOf("\r\n--")));
      cloud.uploads.push({ id, authenticated: /name="type"\r\n\r\nauthenticated/.test(body) });
      res.setHeader("content-type", "application/json");
      return res.end(JSON.stringify({ public_id: id, format: body.includes("%PDF") ? "pdf" : "png", resource_type: "image", type: "authenticated", version: 1 }));
    }
    if (req.url.includes("/image/download")) {
      const id = new URL(req.url, "http://x").searchParams.get("public_id");
      const f = cloud.files.get(id);
      if (!f) { res.statusCode = 404; return res.end("no"); }
      return res.end(f);
    }
    res.statusCode = 404; res.end("{}");
  });
});
await new Promise((r) => fake.listen(9998, r));

// ---------- boot app in-process ----------
await mongoose.connect(MONGO);
await mongoose.connection.dropDatabase();

const { default: app } = await import("../app.js");
const { initSocket, closeSocket } = await import("../shared/realtime/socket.js");
const { setGoogleVerifier } = await import("../modules/users/google.controller.js");
const { roleMiddleware } = await import("../shared/middleware/role.middleware.js");
const { default: User } = await import("../modules/users/user.model.js");
const { default: Session } = await import("../shared/auth/session.model.js");
const { default: AuditLog } = await import("../modules/audit/audit.model.js");
const { default: Notification } = await import("../modules/notifications/notification.model.js");
const { deriveCaseStatus } = await import("../modules/verification/verification.service.js");
await Promise.allSettled([User.init(), Session.init()]); // FerretDB (test DB) lacks partial indexes; real MongoDB has them

const server = http.createServer(app);
initSocket(server);
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const BASE = `http://127.0.0.1:${server.address().port}`;

// ---------- client with a real cookie jar ----------
class Client {
  constructor(name) { this.name = name; this.jar = new Map(); this.lastSetCookie = []; }
  get cookie() { return [...this.jar].map(([k, v]) => `${k}=${v}`).join("; "); }
  async req(method, path, body, { form, origin = ORIGIN } = {}) {
    const headers = {};
    if (origin) headers.origin = origin;
    if (this.jar.size) headers.cookie = this.cookie;
    let payload;
    if (form) payload = form; else if (body !== undefined) { headers["content-type"] = "application/json"; payload = JSON.stringify(body); }
    const r = await fetch(BASE + path, { method, headers, body: payload });
    this.lastSetCookie = r.headers.getSetCookie();
    for (const sc of this.lastSetCookie) {
      const [pair] = sc.split(";"); const i = pair.indexOf("=");
      const k = pair.slice(0, i), v = pair.slice(i + 1);
      if (v === "" || /expires=Thu, 01 Jan 1970/i.test(sc)) this.jar.delete(k); else this.jar.set(k, v);
    }
    let data = {}; let buf = null;
    const ct = r.headers.get("content-type") || "";
    if (ct.includes("json")) data = await r.json().catch(() => ({})); else buf = Buffer.from(await r.arrayBuffer());
    return { status: r.status, data, buf, headers: r.headers };
  }
  get = (p, o) => this.req("GET", p, undefined, o);
  post = (p, b, o) => this.req("POST", p, b, o);
  patch = (p, b) => this.req("PATCH", p, b);
  socket(opts = {}) {
    return ioClient(BASE, { extraHeaders: { cookie: opts.cookie ?? this.cookie, origin: opts.origin ?? ORIGIN }, transports: ["websocket"], reconnection: false });
  }
}
const png = (w = 300, h = 300) => {
  const b = Buffer.alloc(64, 1);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(b, 0);
  b.write("IHDR", 12, "ascii"); b.writeUInt32BE(w, 16); b.writeUInt32BE(h, 20);
  return b;
};
const pdf = () => Buffer.from("%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n");
const form = (buf, type, { mime = "image/png", name = "doc.png", fields = { type } } = {}) => {
  const f = new FormData();
  for (const [k, v] of Object.entries(fields)) f.append(k, v);
  if (buf) f.append("file", new Blob([buf], { type: mime }), name);
  return f;
};
const connectResult = (s) => new Promise((resolve) => { s.on("connect", () => resolve({ ok: true })); s.on("connect_error", (e) => resolve({ ok: false, code: e.data?.code, message: e.message })); });
const ack = (s, ev, arg) => new Promise((resolve) => s.emit(ev, arg, resolve));

const reg = (c, o) => c.post("/user/registration", { password: "Password123", ...o });
const adminDoc = await User.create({ name: "Admin", email: "admin@test.pk", phone: "03001112222", password: await bcrypt.hash("AdminPass123", 10), role: "admin" });

// =====================================================================
section("SESSIONS: login, cookies, refresh, rotation");
const anon = new Client("anon");
const cust = new Client("cust");
let r = await reg(cust, { name: "Cust One", email: "cust@test.pk", phone: "03111111111", role: "customer" });
check("registration 201", r.status === 201);
const sc = cust.lastSetCookie.join("\n");
check("access cookie is HttpOnly", /safarx-bannu=[^;]+;[^\n]*HttpOnly/i.test(sc));
check("refresh cookie is HttpOnly and scoped to /user", /bd-refresh=[^;]+;[^\n]*Path=\/user;[^\n]*HttpOnly/i.test(sc) || /bd-refresh=[^;]+;[^\n]*HttpOnly[^\n]*Path=\/user/i.test(sc), sc);
check("refresh cookie is persistent (has expiry)", /bd-refresh=[^;]+;[^\n]*(Expires|Max-Age)/i.test(sc));
check("password never in response", !JSON.stringify(r.data).toLowerCase().includes('"password"'));
check("session stored hashed (no raw refresh token in DB)", await (async () => {
  const raw = cust.jar.get("bd-refresh");
  const s = await mongoose.connection.db.collection("sessions").findOne({});
  return !!s && !JSON.stringify(s).includes(raw) && s.tokenHash.length === 64;
})());
r = await cust.get("/user/profile");
check("profile works with session", r.status === 200 && r.data.user.email === "cust@test.pk");

const R1 = cust.jar.get("bd-refresh");
cust.jar.delete("safarx-bannu"); // simulate the 15-minute access cookie expiring
r = await cust.get("/user/profile");
check("expired access -> 401 AUTH_REQUIRED", r.status === 401 && r.data.code === "AUTH_REQUIRED");
r = await cust.post("/user/refresh");
check("refresh restores the session", r.status === 200 && r.data.user?.email === "cust@test.pk");
const R2 = cust.jar.get("bd-refresh");
check("refresh token ROTATES", !!R2 && R2 !== R1);
r = await cust.get("/user/profile");
check("profile works after refresh", r.status === 200);

// two tabs refreshing at the same moment must not log everyone out
const tab2 = new Client("tab2"); tab2.jar.set("bd-refresh", R1);
r = await tab2.post("/user/refresh");
check("replay inside the grace window is tolerated (parallel tab)", r.status === 200 && !tab2.lastSetCookie.some((c) => c.startsWith("bd-refresh=")));
await sleep(1300);
const thief = new Client("thief"); thief.jar.set("bd-refresh", R1);
r = await thief.post("/user/refresh");
check("replaying an OLD refresh token later is rejected (401)", r.status === 401 && r.data.code === "SESSION_ENDED");
r = await cust.post("/user/refresh");
check("...and the whole login family is revoked (theft response)", r.status === 401);
check("reuse is audit logged", !!(await AuditLog.findOne({ action: "auth.refresh_reuse_detected" })));
r = await cust.get("/user/profile");
check("revoked family: old access cookie no longer works", r.status === 401);

// ---- logout ----
r = await cust.post("/user/login", { email: "cust@test.pk", password: "Password123", role: "customer" });
check("login after theft response works", r.status === 200);
const keep = cust.cookie;
r = await cust.post("/user/logout");
check("logout 200 + cookies cleared", r.status === 200 && !cust.jar.has("bd-refresh") && !cust.jar.has("safarx-bannu"));
const ghost = new Client("ghost"); for (const p of keep.split("; ")) { const i = p.indexOf("="); ghost.jar.set(p.slice(0, i), p.slice(i + 1)); }
r = await ghost.get("/user/profile");
check("logged-out access token is dead immediately (server-side invalidation)", r.status === 401);
r = await ghost.post("/user/refresh");
check("logged-out refresh token is dead", r.status === 401);

// ---- remember me off ----
const sess = new Client("sess");
r = await sess.post("/user/login", { email: "cust@test.pk", password: "Password123", role: "customer", remember: false });
check("remember=false -> browser-session refresh cookie (no expiry)", r.status === 200 && !/bd-refresh=[^;]+;[^\n]*(Expires|Max-Age)/i.test(sess.lastSetCookie.join("\n")));

// ---- expired refresh (DB) ----
const exp = new Client("exp");
await exp.post("/user/login", { email: "cust@test.pk", password: "Password123", role: "customer" });
await Session.updateMany({ user: (await User.findOne({ email: "cust@test.pk" }))._id }, { $set: { expiresAt: new Date(Date.now() - 1000) } });
r = await exp.post("/user/refresh");
check("expired refresh token -> 401", r.status === 401);

// ---- logout-all + password change ----
const A = new Client("A"), B = new Client("B");
await A.post("/user/login", { email: "cust@test.pk", password: "Password123", role: "customer" });
await B.post("/user/login", { email: "cust@test.pk", password: "Password123", role: "customer" });
r = await A.patch("/user/password", { currentPassword: "Password123", newPassword: "Password456" });
check("password change ok", r.status === 200);
check("...keeps THIS device signed in", (await A.get("/user/profile")).status === 200);
check("...signs OTHER devices out", (await B.get("/user/profile")).status === 401);
const A2 = new Client("A2"); await A2.post("/user/login", { email: "cust@test.pk", password: "Password456", role: "customer" });
r = await A.post("/user/logout-all");
check("logout-all 200", r.status === 200);
check("logout-all ends every device", (await A2.get("/user/profile")).status === 401);

// ---- block revokes ----
const victim = new Client("victim");
await reg(victim, { name: "Vic", email: "vic@test.pk", phone: "03222222222", role: "customer" });
const adm = new Client("adm");
r = await adm.post("/user/login", { email: "admin@test.pk", password: "AdminPass123", role: "admin" });
check("admin login", r.status === 200 && r.data.user.role === "admin");
const vic = await User.findOne({ email: "vic@test.pk" });
const vicSocket = victim.socket(); const vicConn = await connectResult(vicSocket);
check("customer socket connects", vicConn.ok);
const disc = new Promise((res) => vicSocket.on("disconnect", () => res(true)));
r = await adm.patch(`/admin/user/${vic._id}/block`, { isBlocked: true });
check("admin blocks customer", r.status === 200);
check("block closes the live socket immediately", await Promise.race([disc, sleep(1500).then(() => false)]));
check("blocked user cannot refresh", (await victim.post("/user/refresh")).status === 401);
await adm.patch(`/admin/user/${vic._id}/block`, { isBlocked: false });
check("block + unblock are audit logged", (await AuditLog.countDocuments({ action: { $in: ["account.blocked", "account.activated"] } })) === 2);

// =====================================================================
section("ROLE MIDDLEWARE + CSRF/ORIGIN");
check("roleMiddleware with no user -> 401 (was HTTP 200)", await new Promise((resolve) => {
  const res = { status(c) { this.code = c; return this; }, json(b) { resolve(this.code === 401 && b.success === false); } };
  roleMiddleware(["admin"])({}, res, () => resolve(false));
}));
r = await anon.get("/admin/stats"); check("anonymous -> admin route 401", r.status === 401);
const cust2 = new Client("cust2"); await cust2.post("/user/login", { email: "cust@test.pk", password: "Password456", role: "customer" });
r = await cust2.get("/admin/stats"); check("customer -> admin route 403", r.status === 403);
r = await cust2.get("/verification/admin/cases"); check("customer -> admin verification route 403", r.status === 403);
r = await cust2.get("/admin/audit-logs"); check("customer -> audit log 403", r.status === 403);
r = await anon.post("/user/login", { email: "x@y.pk", password: "nope", role: "customer" }, { origin: "https://evil.example" });
check("state-changing request from an unknown Origin -> 403 (CSRF guard)", r.status === 403);
r = await anon.get("/health", { origin: null });
check("health works and reports realtime", r.status === 200 && r.data.realtime === "on");

// =====================================================================
section("GOOGLE SIGN-IN (verifier mocked)");
const claimsByToken = {
  "tok-new": { sub: "g-111", email: "newgoogle@test.pk", email_verified: true, name: "New Google", picture: "https://lh3.googleusercontent.com/a/x" },
  "tok-unverified": { sub: "g-222", email: "unv@test.pk", email_verified: false, name: "Unv" },
  "tok-link-unverified": { sub: "g-333", email: "local1@test.pk", email_verified: true, name: "Local One" },
  "tok-link-verified": { sub: "g-444", email: "local2@test.pk", email_verified: true, name: "Local Two" },
  "tok-driver": { sub: "g-555", email: "drv@test.pk", email_verified: true, name: "Drv" },
  "tok-admin": { sub: "g-666", email: "admin@test.pk", email_verified: true, name: "Admin" },
  "tok-conflict": { sub: "g-OTHER", email: "local1@test.pk", email_verified: true, name: "Evil" }
};
setGoogleVerifier(async (t) => { if (!claimsByToken[t]) throw new Error("bad token"); return claimsByToken[t]; });

const g = new Client("g");
r = await g.post("/user/google", {}); check("missing credential -> 400", r.status === 400);
r = await g.post("/user/google", { credential: "garbage" }); check("invalid Google token -> 401", r.status === 401 && r.data.code === "GOOGLE_TOKEN_INVALID");
r = await g.post("/user/google", { credential: "tok-unverified" }); check("unverified Google email -> 403", r.status === 403);
r = await g.post("/user/google", { credential: "tok-new", role: "admin", isVerified: true, email: "evil@x.pk" });
check("new Google user -> 201 customer (role/email in body ignored)", r.status === 201 && r.data.user.role === "customer" && r.data.user.email === "newgoogle@test.pk" && r.data.created === true);
check("Google user gets session cookies", g.jar.has("safarx-bannu") && g.jar.has("bd-refresh"));
check("Google user needs a phone (flag) and has no password", r.data.user.needsPhone === true && r.data.user.hasPassword === false);
const gu = await User.findOne({ email: "newgoogle@test.pk" }).select("+googleId");
check("googleId stored from the VERIFIED token", gu.googleId === "g-111" && gu.emailVerified === true);
r = await anon.post("/user/login", { email: "newgoogle@test.pk", password: "anything123", role: "customer" });
check("Google-only account cannot be entered with a password", r.status === 401);
r = await new Client("g2").post("/user/google", { credential: "tok-new" });
check("same Google account again -> 200, no duplicate", r.status === 200 && r.data.created === false && (await User.countDocuments({ email: "newgoogle@test.pk" })) === 1);

// link an UNVERIFIED local account: password wiped, sessions killed (pre-hijack protection)
const l1 = new Client("l1");
await reg(l1, { name: "Local One", email: "local1@test.pk", phone: "03333333333", role: "customer" });
r = await new Client("g3").post("/user/google", { credential: "tok-link-unverified" });
check("existing unverified local account is LINKED (200), not duplicated", r.status === 200 && r.data.linked === true && (await User.countDocuments({ email: "local1@test.pk" })) === 1);
check("...its old password no longer works (pre-hijack protection)", (await anon.post("/user/login", { email: "local1@test.pk", password: "Password123", role: "customer" })).status === 401);
check("...and its previous sessions were ended", (await l1.get("/user/profile")).status === 401);
r = await new Client("g4").post("/user/google", { credential: "tok-conflict" });
check("a different Google identity cannot take over a linked email (409)", r.status === 409);

// link an account whose email we already verified: password keeps working
const l2 = new Client("l2");
await reg(l2, { name: "Local Two", email: "local2@test.pk", phone: "03444444444", role: "customer" });
await User.updateOne({ email: "local2@test.pk" }, { $set: { emailVerified: true } });
r = await new Client("g5").post("/user/google", { credential: "tok-link-verified" });
check("verified-email local account linked", r.status === 200 && r.data.linked === true);
check("...password login and old session still work", (await anon.post("/user/login", { email: "local2@test.pk", password: "Password123", role: "customer" })).status === 200 && (await l2.get("/user/profile")).status === 200);

// roles are never granted by Google
const d0 = new Client("d0");
await reg(d0, { name: "Drv", email: "drv@test.pk", phone: "03555555555", role: "driver", vehicleType: "car", vehicleNumber: "BNU-123", licenseNumber: "L-1" });
r = await new Client("g6").post("/user/google", { credential: "tok-driver" });
check("existing driver may sign in with Google but stays an UNVERIFIED driver", r.status === 200 && r.data.user.role === "driver" && r.data.user.isVerified === false);
r = await new Client("g7").post("/user/google", { credential: "tok-admin" });
check("admin account can NEVER be reached through Google (403)", r.status === 403);
check("no Google flow ever created a privileged user", (await User.countDocuments({ googleId: { $exists: true }, role: { $in: ["admin", "operator"] } })) === 0);
await User.updateOne({ email: "newgoogle@test.pk" }, { $set: { isBlocked: true } });
check("blocked Google user rejected (403)", (await new Client("g8").post("/user/google", { credential: "tok-new" })).status === 403);
check("google events audit logged", (await AuditLog.countDocuments({ action: { $in: ["auth.google_registered", "auth.google_linked"] } })) >= 3);

// =====================================================================
section("DOCUMENT VERIFICATION (private storage)");
check("deriveCaseStatus: missing docs -> PENDING", deriveCaseStatus("driver", [{ type: "CNIC", status: "APPROVED" }]) === "PENDING");
const all = (st) => ["CNIC", "DRIVING_LICENSE", "VEHICLE_REGISTRATION", "PROFILE_PHOTO"].map((type) => ({ type, status: st }));
check("deriveCaseStatus: all present pending -> UNDER_REVIEW", deriveCaseStatus("driver", all("PENDING")) === "UNDER_REVIEW");
check("deriveCaseStatus: all approved -> APPROVED", deriveCaseStatus("driver", all("APPROVED")) === "APPROVED");
check("deriveCaseStatus: one rejected -> REJECTED", deriveCaseStatus("driver", [...all("APPROVED").slice(1), { type: "CNIC", status: "REJECTED" }]) === "REJECTED");

const drv = new Client("drv");
await reg(drv, { name: "Real Driver", email: "driver@test.pk", phone: "03666666666", role: "driver", vehicleType: "car", vehicleNumber: "BNU-777", licenseNumber: "L-77" });
const drv2 = new Client("drv2");
await reg(drv2, { name: "Other Driver", email: "driver2@test.pk", phone: "03777777777", role: "driver", vehicleType: "bike", vehicleNumber: "BNU-1", licenseNumber: "L-2" });

r = await drv.get("/verification/me");
check("driver sees requirements + case PENDING", r.status === 200 && r.data.case.status === "PENDING" && r.data.requirements.some((x) => x.type === "DRIVING_LICENSE" && x.required) && r.data.documentsRequired === true);
r = await cust2.get("/verification/me"); check("customer cannot use verification API (403)", r.status === 403);
r = await new Client("fresh").get("/verification/me"); check("anonymous -> 401", r.status === 401);
r = await drv.post("/verification/documents", undefined, { form: form(null, "CNIC") });
check("no file -> 400", r.status === 400);
r = await drv.post("/verification/documents", undefined, { form: form(png(), "NOT_A_TYPE") });
check("unknown document type -> 400", r.status === 400);
r = await drv.post("/verification/documents", undefined, { form: form(Buffer.from("MZ not an image at all, just text pretending"), "CNIC", { name: "x.png" }) });
check("text file renamed .png -> 400 (signature check)", r.status === 400);
r = await drv.post("/verification/documents", undefined, { form: form(png(), "CNIC", { name: "x.exe", mime: "application/x-msdownload" }) });
check("executable -> 400", r.status === 400);
r = await drv.post("/verification/documents", undefined, { form: form(png(50, 50), "CNIC") });
check("tiny image (50x50) -> 400", r.status === 400);
r = await drv.post("/verification/documents", undefined, { form: form(png(20000, 300), "CNIC") });
check("absurd dimensions -> 400", r.status === 400);
r = await drv.post("/verification/documents", undefined, { form: form(Buffer.concat([png(), Buffer.alloc(6 * 1024 * 1024)]), "CNIC") });
check("file over 5 MB -> 400", r.status === 400);
check("nothing was sent to storage by rejected files", cloud.uploads.length === 0);

const pngBytes = png();
r = await drv.post("/verification/documents", undefined, { form: form(pngBytes, "CNIC") });
check("valid CNIC image uploaded (201)", r.status === 201 && r.data.document.status === "PENDING", `status=${r.status} ${JSON.stringify(r.data)}`);
check("upload went to PRIVATE (authenticated) storage", cloud.uploads.length === 1 && cloud.uploads[0].authenticated === true);
check("response contains no storage id / URL", !/publicId|public_id|cloudinary|http/i.test(JSON.stringify(r.data)));
const cnicId = r.data.document.id;
r = await drv.post("/verification/documents", undefined, { form: form(pdf(), "DRIVING_LICENSE", { mime: "application/pdf", name: "licence.pdf" }) });
check("PDF accepted for licence", r.status === 201);
r = await drv.get("/verification/me");
check("case still PENDING while required docs are missing", r.data.case.status === "PENDING");
for (const t of ["VEHICLE_REGISTRATION", "PROFILE_PHOTO"]) await drv.post("/verification/documents", undefined, { form: form(png(), t) });
r = await drv.get("/verification/me");
check("all required uploaded -> UNDER_REVIEW", r.data.case.status === "UNDER_REVIEW" && r.data.documents.length === 4);
check("GET /verification/me leaks no storage details", !/publicId|public_id|cloudinary|https?:\/\//i.test(JSON.stringify(r.data)));

r = await drv.get(`/verification/documents/${cnicId}/file`);
check("owner can view own document", r.status === 200 && Buffer.compare(r.buf, pngBytes) === 0 && r.headers.get("cache-control").includes("no-store") && r.headers.get("x-content-type-options") === "nosniff");
r = await drv2.get(`/verification/documents/${cnicId}/file`);
check("another driver cannot read it (404, not 403: no probing)", r.status === 404);
r = await cust2.get(`/verification/documents/${cnicId}/file`); check("customer cannot read it (403)", r.status === 403);
r = await new Client("fresh2").get(`/verification/documents/${cnicId}/file`); check("anonymous cannot read it (401)", r.status === 401);
r = await adm.get(`/verification/documents/${cnicId}/file`);
check("admin can view it", r.status === 200);
check("admin viewing is audit logged", !!(await AuditLog.findOne({ action: "document.viewed", entityId: cnicId })));
r = await adm.get(`/verification/documents/not-an-id/file`); check("bad id -> 400", r.status === 400);

// manual verify is blocked while documents are required
const drvUser = await User.findOne({ email: "driver@test.pk" });
r = await adm.patch(`/admin/user/${drvUser._id}/verify`, { isVerified: true });
check("admin cannot flip 'verified' without approved documents (409)", r.status === 409);

// review
r = await adm.get(`/verification/admin/cases?status=UNDER_REVIEW&role=driver`);
check("admin lists cases awaiting review", r.status === 200 && r.data.items.some((i) => String(i.user._id) === String(drvUser._id) && i.awaitingReview === 4), JSON.stringify(r.data).slice(0, 400));
r = await adm.get(`/verification/admin/cases/${drvUser._id}`);
check("admin sees the full case", r.status === 200 && r.data.documents.length === 4 && !/publicId|public_id|cloudinary/i.test(JSON.stringify(r.data)));
const docs = Object.fromEntries(r.data.documents.map((d) => [d.type, d.id]));
r = await adm.patch(`/verification/admin/documents/${docs.CNIC}/review`, { decision: "REJECTED" });
check("rejecting without a reason -> 400", r.status === 400);
r = await adm.patch(`/verification/admin/documents/${docs.CNIC}/review`, { decision: "REJECTED", reason: "Image is blurry" });
check("reject with reason", r.status === 200 && r.data.caseStatus === "REJECTED");
check("driver notified of the rejection", !!(await Notification.findOne({ recipient: drvUser._id, type: "document_rejected" })));
r = await drv.get("/verification/me");
check("driver sees the reason", r.data.documents.find((d) => d.type === "CNIC").rejectionReason === "Image is blurry" && r.data.case.status === "REJECTED");
check("DRIVER cannot review documents (403)", (await drv.patch(`/verification/admin/documents/${docs.CNIC}/review`, { decision: "APPROVED" })).status === 403);

// re-upload keeps history
r = await drv.post("/verification/documents", undefined, { form: form(png(400, 400), "CNIC") });
check("driver re-uploads the rejected document", r.status === 201);
r = await adm.get(`/verification/admin/cases/${drvUser._id}`);
const cnics = r.data.documents.filter((d) => d.type === "CNIC");
check("old version kept for history, only one is current", cnics.length === 2 && cnics.filter((d) => d.isCurrent).length === 1);
check("case back to UNDER_REVIEW", r.data.case.status === "UNDER_REVIEW");
check("case history recorded", r.data.case.history.length >= 3);
const cur = Object.fromEntries(r.data.documents.filter((d) => d.isCurrent).map((d) => [d.type, d.id]));
check("cannot review an OLD version (409)", (await adm.patch(`/verification/admin/documents/${cnics.find((d) => !d.isCurrent).id}/review`, { decision: "APPROVED" })).status === 409);

for (const id of Object.values(cur)) await adm.patch(`/verification/admin/documents/${id}/review`, { decision: "APPROVED" });
r = await adm.get(`/verification/admin/cases/${drvUser._id}`);
check("all approved -> case APPROVED", r.data.case.status === "APPROVED");
check("driver is now verified (isVerified=true) automatically", (await User.findById(drvUser._id)).isVerified === true);
r = await drv.post("/verification/documents", undefined, { form: form(png(), "CNIC") });
check("approved documents cannot be silently replaced (409)", r.status === 409);
r = await adm.patch(`/verification/admin/documents/${cur.CNIC}/review`, { decision: "REUPLOAD", reason: "Expired, please renew" });
check("admin can request re-upload; verification is withdrawn", r.status === 200 && (await User.findById(drvUser._id)).isVerified === false);
check("unverified driver cannot accept rides (eligibility rule)", await (async () => {
  const { checkDriverEligibility } = await import("../shared/utils/driverRules.js");
  await User.updateOne({ _id: drvUser._id }, { $set: { driverStatus: "online" } });
  return (await checkDriverEligibility(drvUser._id)).ok === false;
})());

// operator side
const opA = new Client("opA"), opB = new Client("opB");
await reg(opA, { name: "Op A", email: "opa@test.pk", phone: "03888888881", role: "operator", companyName: "Alpha Coaches" });
await reg(opB, { name: "Op B", email: "opb@test.pk", phone: "03888888882", role: "operator", companyName: "Beta Coaches" });
r = await opA.get("/verification/me");
check("operator requirements include permit + coach registration", r.data.requirements.some((x) => x.type === "ROUTE_PERMIT" && x.required) && r.data.requirements.some((x) => x.type === "COACH_REGISTRATION"));
r = await opA.post("/verification/documents", undefined, { form: form(png(), "DRIVING_LICENSE") });
check("operator cannot upload a driver-only document type", r.status === 400);
const opAUser = await User.findOne({ email: "opa@test.pk" });
const { CoachOperator } = await import("../modules/coach/coach.model.js");
const opADoc = await CoachOperator.findOne({ user: opAUser._id });
r = await adm.patch(`/coach/admin/operators/${opADoc._id}/approve`, { approved: true });
check("operator cannot be approved without approved documents (409)", r.status === 409);
r = await opA.get("/coach/operator/me");
check("unverified operator cannot publish schedules (403 on write)", (await opA.post("/coach/operator/coaches", { name: "X", layout: { rows: 2, left: 2, right: 2 } })).status === 403);
for (const t of ["CNIC", "BUSINESS_REGISTRATION", "COACH_REGISTRATION", "ROUTE_PERMIT"]) await opA.post("/verification/documents", undefined, { form: form(png(), t) });
let cs = await adm.get(`/verification/admin/cases/${opAUser._id}`);
for (const d of cs.data.documents) await adm.patch(`/verification/admin/documents/${d.id}/review`, { decision: "APPROVED" });
check("operator becomes verified once documents are approved", (await User.findById(opAUser._id)).isVerified === true);
r = await opA.post("/coach/operator/coaches", { name: "Alpha One", layout: { rows: 2, left: 2, right: 2 } });
check("...and can now create coaches", r.status === 201);
const coachA = r.data.coach._id;
// operator B approved directly (documents gate tested above)
await User.updateOne({ email: "opb@test.pk" }, { $set: { isVerified: true } });
r = await opB.post("/coach/operator/coaches", { name: "Beta One", layout: { rows: 2, left: 2, right: 2 } });
const coachB = r.data.coach._id;
r = await opA.post("/coach/operator/routes", { fromCity: "Bannu", toCity: "Islamabad" }); const routeA = r.data.route._id;
r = await opB.post("/coach/operator/routes", { fromCity: "Bannu", toCity: "Peshawar" }); const routeB = r.data.route._id;
const dep = new Date(Date.now() + 36 * 3600e3).toISOString();
r = await opA.post("/coach/operator/schedules", { coachId: coachA, routeId: routeA, departureAt: dep, arrivalAt: new Date(Date.now() + 44 * 3600e3).toISOString(), fare: 1500 });
check("schedule created + audit logged", r.status === 201 && !!(await AuditLog.findOne({ action: "schedule.created" })), JSON.stringify(r.data).slice(0, 300));
const schedA = r.data.schedules[0]._id;
r = await opB.post("/coach/operator/schedules", { coachId: coachB, routeId: routeB, departureAt: dep, arrivalAt: new Date(Date.now() + 44 * 3600e3).toISOString(), fare: 900 });
const schedB = r.data.schedules[0]._id;

// =====================================================================
section("SOCKET.IO authorization");
let s = ioClient(BASE, { transports: ["websocket"], reconnection: false, extraHeaders: { origin: ORIGIN } });
let cr = await connectResult(s); check("no cookie -> rejected (AUTH_REQUIRED)", !cr.ok && cr.code === "AUTH_REQUIRED"); s.close();
s = cust2.socket({ origin: "https://evil.example" }); cr = await connectResult(s);
check("cookie-carrying socket from a foreign Origin is refused", !cr.ok); s.close();
s = ioClient(BASE, { transports: ["websocket"], reconnection: false, extraHeaders: { origin: ORIGIN, cookie: "safarx-bannu=garbage" } }); cr = await connectResult(s);
check("forged access token rejected", !cr.ok && cr.code === "AUTH_INVALID"); s.close();
const staleCookie = cust2.cookie; await cust2.post("/user/logout");
s = ioClient(BASE, { transports: ["websocket"], reconnection: false, extraHeaders: { origin: ORIGIN, cookie: staleCookie } }); cr = await connectResult(s);
check("token of a logged-out session cannot open a socket", !cr.ok); s.close();

await cust2.post("/user/login", { email: "cust@test.pk", password: "Password456", role: "customer" });
const sc2 = cust2.socket(); check("customer socket connects", (await connectResult(sc2)).ok);
check("customer may watch a scheduled trip (public seat state)", (await ack(sc2, "coach:watch", schedA)).ok === true);
check("invalid schedule id rejected", (await ack(sc2, "coach:watch", "nope")).ok === false);
check("unknown schedule rejected", (await ack(sc2, "coach:watch", "a".repeat(24))).ok === false);
const sopA = opA.socket(); await connectResult(sopA);
check("operator A may watch OWN schedule", (await ack(sopA, "coach:watch", schedA)).ok === true);
check("operator A may NOT watch operator B's schedule", (await ack(sopA, "coach:watch", schedB)).ok === false);
const sadm = adm.socket(); await connectResult(sadm);
check("admin may watch any schedule", (await ack(sadm, "coach:watch", schedB)).ok === true);
const sdrv = drv.socket(); await connectResult(sdrv);
check("driver may NOT watch coach schedules", (await ack(sdrv, "coach:watch", schedA)).ok === false);

// seat events: only watchers of that schedule receive them
const got = { cust: [], opA: [], opB: [] };
sc2.on("coach:seats", (p) => got.cust.push(p)); sopA.on("coach:seats", (p) => got.opA.push(p));
const sopB = opB.socket(); await connectResult(sopB); await ack(sopB, "coach:watch", schedB); sopB.on("coach:seats", (p) => got.opB.push(p));
const { pushSeatUpdate } = await import("../modules/coach/coach.service.js");
await pushSeatUpdate(schedA, ["01"], "BOOKED"); await sleep(300);
check("watchers of schedule A receive the seat update", got.cust.length === 1 && got.opA.length === 1);
check("watchers of schedule B do NOT receive schedule A's update", got.opB.length === 0);
check("seat payload carries no passenger data", !/passenger|phone|name|booking/i.test(JSON.stringify(got.cust[0])));
sc2.emit("coach:unwatch", schedA); await sleep(150);
await pushSeatUpdate(schedA, ["02"], "BOOKED"); await sleep(250);
check("unwatch stops updates (no leaked listeners)", got.cust.length === 1 && got.opA.length === 2);
for (const x of [sc2, sopA, sadm, sdrv, sopB, vicSocket]) x.close();

// =====================================================================
section("AUDIT LOG API");
r = await adm.get("/admin/audit-logs?action=document.*");
check("admin can read the audit log with filters", r.status === 200 && r.data.items.length >= 5 && r.data.items.every((i) => i.action.startsWith("document.")));
check("audit entries carry actor + entity + time", r.data.items.every((i) => i.entityType && i.entityId && i.createdAt));
check("audit log holds no secrets (no JWTs, passwords, refresh tokens)", !/eyJ[\w-]+\.[\w-]+\.|Password123|Password456|AdminPass123|bd-refresh|safarx-bannu/.test(JSON.stringify(await AuditLog.find().lean())));
r = await adm.get(`/admin/audit-logs?entityType=User&entityId=${drvUser._id}`);
check("filter by entity works", r.status === 200 && r.data.items.length >= 1);

// =====================================================================
section("RATE LIMITING");
let last;
for (let i = 0; i < 8; i++) last = await new Client("rl").post("/user/login", { email: "who@test.pk", password: "wrongwrong", role: "customer" });
check("repeated failed logins get rate limited (429)", last.status === 429 && last.data.code === "RATE_LIMITED");
r = await new Client("rl2").post("/user/google", { credential: "tok-new" });
check("other endpoints keep their own counters (Google not locked by login failures)", r.status !== 429);

// ---------- done ----------
await closeSocket(); server.close(); fake.close(); await mongoose.disconnect();
console.log(`\n==== ${pass} passed, ${fail} failed ====`);
if (fail) { console.log("Failures:\n - " + failures.join("\n - ")); process.exit(1); }
process.exit(0);
