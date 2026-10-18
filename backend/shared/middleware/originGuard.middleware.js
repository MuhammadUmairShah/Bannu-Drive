import { allowedOrigins } from "../config/env.js";

// CSRF defence in depth.
export function originGuard(req, res, next) {
  if (["GET", "HEAD", "OPTIONS"].includes(req.method)) {
    return next();
  }

  // Provider callbacks carry no cookies and are authenticated by their signature.
  if (
    req.originalUrl.startsWith(
      "/coach/payments/callback/"
    )
  ) {
    return next();
  }

  const origin = req.headers.origin;

  // Requests without Origin are not browser CSRF vectors.
  if (!origin) {
    return next();
  }

  const normalizedOrigin = origin.replace(/\/+$/, "");

  if (!allowedOrigins().includes(normalizedOrigin)) {
    console.log("Blocked origin:", origin);

    return res.status(403).json({
      success: false,
      message: "Origin not allowed"
    });
  }

  next();
}