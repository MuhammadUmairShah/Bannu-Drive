import { rateLimit, ipKeyGenerator } from "express-rate-limit";

// NOTE: counters live in memory, which is correct for ONE server instance (Render/Railway starter).
// When you scale to several instances, plug a shared store (e.g. rate-limit-redis) in `store`.
// Limits are deliberately generous per user and tighter per IP-only (unauthenticated) endpoints,
// because many Pakistani mobile users share one carrier-grade NAT IP.

const json = (message) => ({ success: false, code: "RATE_LIMITED", message });

function make({ windowMin, limit, message, perUser = false, skipSuccessful = false }) {
  return rateLimit({
    windowMs: windowMin * 60 * 1000,
    limit,
    standardHeaders: true,
    legacyHeaders: false,
    skipSuccessfulRequests: skipSuccessful,
    message: json(message),
    keyGenerator: (req) => (perUser && req.user?.id ? `u:${req.user.id}` : ipKeyGenerator(req.ip))
  });
}

const env = (name, fallback) => Number(process.env[name]) || fallback;

// ----- unauthenticated (per IP) -----
export const loginLimiter = make({ windowMin: 15, limit: env("LOGIN_RATE_LIMIT", 20), skipSuccessful: true, message: "Too many sign-in attempts. Please try again in a few minutes." });
export const registerLimiter = make({ windowMin: 60, limit: env("REGISTER_RATE_LIMIT", 20), message: "Too many sign-ups from this network. Please try again later." });
export const googleAuthLimiter = make({ windowMin: 15, limit: env("GOOGLE_RATE_LIMIT", 30), message: "Too many Google sign-in attempts. Please try again in a few minutes." });
export const refreshLimiter = make({ windowMin: 15, limit: env("REFRESH_RATE_LIMIT", 120), message: "Too many session refreshes. Please try again shortly." });
export const publicReadLimiter = make({ windowMin: 1, limit: env("PUBLIC_READ_RATE_LIMIT", 120), message: "Too many requests. Please slow down." });
// Provider callbacks come from a few server IPs and may retry: generous, still bounded
export const paymentCallbackLimiter = make({ windowMin: 15, limit: env("PAYMENT_CALLBACK_RATE_LIMIT", 600), message: "Too many callbacks." });
export const mapsLimiter = make({ windowMin: 1, limit: env("MAPS_RATE_LIMIT", 90), perUser: true, message: "Too many map requests. Please slow down." });
export const trackingLimiter = make({ windowMin: 1, limit: env("TRACKING_RATE_LIMIT", 60), perUser: true, message: "Sending positions too fast." });
export const trackReadLimiter = make({ windowMin: 1, limit: env("TRACK_READ_RATE_LIMIT", 60), perUser: true, message: "Too many tracking requests." });
export const passwordLimiter = make({ windowMin: 60, limit: env("PASSWORD_RATE_LIMIT", 10), message: "Too many password requests. Please try again later." });

// ----- authenticated (per user; place AFTER authMiddleware) -----
export const bookingLimiter = make({ windowMin: 10, limit: env("BOOKING_RATE_LIMIT", 20), perUser: true, message: "Too many booking attempts. Please wait a few minutes." });
export const requestLimiter = make({ windowMin: 10, limit: env("REQUEST_RATE_LIMIT", 30), perUser: true, message: "Too many requests. Please wait a few minutes." });
export const paymentLimiter = make({ windowMin: 10, limit: env("PAYMENT_RATE_LIMIT", 30), perUser: true, message: "Too many payment requests. Please wait a few minutes." });
export const uploadLimiter = make({ windowMin: 60, limit: env("UPLOAD_RATE_LIMIT", 30), perUser: true, message: "Too many uploads. Please try again later." });
export const qrVerifyLimiter = make({ windowMin: 1, limit: env("QR_RATE_LIMIT", 90), perUser: true, message: "Scanning too fast. Please slow down." });
export const adminActionLimiter = make({ windowMin: 10, limit: env("ADMIN_RATE_LIMIT", 300), perUser: true, message: "Too many admin actions. Please slow down." });

// Applies a limiter only to state-changing requests
export const onlyWrites = (limiter) => (req, res, next) => (["GET", "HEAD", "OPTIONS"].includes(req.method) ? next() : limiter(req, res, next));
