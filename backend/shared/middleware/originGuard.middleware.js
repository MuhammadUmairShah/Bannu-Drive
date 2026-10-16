import { allowedOrigins } from "../config/env.js";

// CSRF defence in depth. Cookies are SameSite=None in cross-site deployments, so a malicious page
// could make a browser send them. Browsers always attach Origin to cross-site state-changing requests,
// so any POST/PUT/PATCH/DELETE from an origin we do not know is rejected.
// Requests without Origin (curl, server-to-server, same-origin GET) are not browser CSRF vectors.
export function originGuard(req, res, next) {
  if (["GET", "HEAD", "OPTIONS"].includes(req.method)) return next();

  // Provider callbacks carry no cookies and are authenticated by their signature, and a hosted payment page
  // (e.g. JazzCash) posts them from ITS origin through the customer's browser.
  if (req.originalUrl.startsWith("/coach/payments/callback/")) return next();

  const origin = req.headers.origin;
  if (!origin) return next();

  if (!allowedOrigins().includes(origin.replace(/\/+$/, ""))) {
    return res.status(403).json({ success: false, message: "Origin not allowed" });
  }
  next();
}
