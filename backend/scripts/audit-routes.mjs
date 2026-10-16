// Lists EVERY route with its authentication + role guard and fails if a route is unauthenticated
// without being on the explicit public allow-list. No database needed.   npm run audit:routes
import { authMiddleware } from "../shared/middleware/auth.middleware.js";

process.env.JWT_SECRET ||= "audit-only-secret-audit-only-secret-1234";
process.env.MONGO_URI ||= "mongodb://127.0.0.1:1/none";

const mounts = {
  "/user": "../modules/users/user.route.js",
  "/ride": "../modules/rides/ride.route.js",
  "/delivery": "../modules/deliveries/delivery.route.js",
  "/rating": "../modules/ratings/rating.route.js",
  "/complaint": "../modules/complaints/complaint.route.js",
  "/payment": "../modules/payments/payment.route.js",
  "/admin": "../modules/admin/admin.route.js",
  "/notification": "../modules/notifications/notification.route.js",
  "/coach": "../modules/coach/coach.route.js",
  "/verification": "../modules/verification/verification.route.js",
  "/maps": "../modules/maps/maps.route.js"
};

// Deliberately public endpoints. Anything else without authMiddleware is a failure.
const PUBLIC = new Set([
  "POST /user/registration", "POST /user/login", "POST /user/google", "POST /user/refresh", "POST /user/logout",
  "POST /user/forgot-password", "POST /user/reset-password",
  "GET /coach/public/cities", "GET /coach/public/search", "GET /coach/public/schedules/:scheduleId",
  "POST /coach/payments/callback/:provider" // signature-authenticated, rate-limited
]);

const rows = [];

function walk(router, prefix, authed, roles) {
  for (const layer of router.stack) {
    if (layer.route) {
      const chain = layer.route.stack.map((l) => l.handle);
      const hasAuth = authed || chain.includes(authMiddleware);
      const r = [...roles, ...chain.filter((h) => h.roles).map((h) => h.roles.join("|"))];
      for (const m of Object.keys(layer.route.methods)) {
        rows.push({ method: m.toUpperCase(), path: prefix + layer.route.path, auth: hasAuth, roles: r.join(" & ") });
      }
    } else if (layer.handle?.stack) {
      // nested router (mount path unknown in Express 5 internals -> we only use this for the verification admin router)
      walk(layer.handle, prefix + (layer.handle.__mount || ""), authed, roles);
    } else if (layer.handle === authMiddleware) {
      authed = true;
    } else if (layer.handle?.roles) {
      roles = [...roles, layer.handle.roles.join("|")];
    }
  }
}

for (const [prefix, file] of Object.entries(mounts)) {
  const { default: router } = await import(file);
  walk(router, prefix, false, []);
}

// verification: nested admin router is mounted at /admin inside /verification
for (const r of rows) if (r.path.startsWith("/verification/") && /^\/verification\/(cases|documents\/:id\/review)/.test(r.path)) r.path = r.path.replace("/verification/", "/verification/admin/");

rows.sort((a, b) => a.path.localeCompare(b.path) || a.method.localeCompare(b.method));
let bad = 0;
for (const r of rows) {
  const key = `${r.method} ${r.path}`;
  const ok = r.auth || PUBLIC.has(key);
  if (!ok) bad++;
  console.log(`${ok ? " ok " : "FAIL"}  ${r.method.padEnd(6)} ${r.path.padEnd(52)} ${r.auth ? "auth" : "PUBLIC"}${r.roles ? "  roles: " + r.roles : ""}`);
}
console.log(`\n${rows.length} routes, ${rows.filter((r) => r.auth).length} authenticated, ${rows.filter((r) => !r.auth).length} public (${bad} unexpected)`);
process.exit(bad ? 1 : 0);
