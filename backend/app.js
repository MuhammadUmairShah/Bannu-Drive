import express from "express";
import cors from "cors";
import helmet from "helmet";
import cookieParser from "cookie-parser";
import dns from "dns";

import { allowedOrigins, isProd } from "./shared/config/env.js";

// Atlas SRV lookups fail on some ISP resolvers in Pakistan; set DISABLE_DNS_OVERRIDE=true to opt out.
if (process.env.DISABLE_DNS_OVERRIDE !== "true") dns.setServers(["8.8.8.8", "1.1.1.1"]);

import dbConnection from "./shared/config/dbconnection.js";
import { originGuard } from "./shared/middleware/originGuard.middleware.js";
import { socketReady } from "./shared/realtime/socket.js";

import userroute from "./modules/users/user.route.js";
import rideroute from "./modules/rides/ride.route.js";
import deliveryroute from "./modules/deliveries/delivery.route.js";
import ratingroute from "./modules/ratings/rating.route.js";
import complaintroute from "./modules/complaints/complaint.route.js";
import paymentroute from "./modules/payments/payment.route.js";
import adminroute from "./modules/admin/admin.route.js";
import notificationroute from "./modules/notifications/notification.route.js";
import coachroute from "./modules/coach/coach.route.js";
import verificationroute from "./modules/verification/verification.route.js";
import mapsroute from "./modules/maps/maps.route.js";

const app = express();

// Hosting platforms (Render/Railway/Vercel) put a proxy in front of the app
app.set("trust proxy", 1);
app.disable("x-powered-by");

// ---------- Security & CORS ----------
app.use(helmet({ crossOriginResourcePolicy: false }));

const origins = allowedOrigins();

app.use(
  cors({
    origin: (origin, callback) => {
      // Allow Postman, curl, server-to-server
      if (!origin || origins.includes(origin)) {
        return callback(null, true);
      }
      console.log("Blocked CORS origin:", origin);
      return callback(new Error("Not allowed by CORS"));
    },
    credentials: true,
  })
);

// ---------- Body parsers ----------
// Payment providers sign the EXACT bytes they send, so the raw body is kept for callback routes only
app.use(express.json({
  limit: "100kb",
  verify: (req, res, buf) => { if (req.originalUrl.startsWith("/coach/payments/callback/")) req.rawBody = buf.toString("utf8"); }
}));
app.use(express.urlencoded({ extended: true, limit: "100kb" }));
app.use(cookieParser());
app.use(originGuard); // CSRF defence in depth for cookie-authenticated requests

// ---------- Database (runs before every request) ----------
app.use(async (req, res, next) => {
  if (req.method === "OPTIONS") return next(); // preflight needs no DB

  try {
    await dbConnection();
    next();
  } catch (error) {
    console.error("DB connection failed:", error.message);
    res.status(500).json({
      success: false,
      message: "Database connection failed",
    });
  }
});

// ---------- Health ----------
app.get("/", (req, res) => {
  res.json({
    success: true,
    message: "Bannu Drive Backend API",
    status: "running",
  });
});

app.get("/health", (req, res) => {
  res.json({
    success: true,
    status: "ok",
    database: "connected",
    realtime: socketReady() ? "on" : "off", // "off" on serverless hosts: sockets need server.js
  });
});

// ---------- Routes ----------
app.use("/user", userroute);
app.use("/ride", rideroute);
app.use("/delivery", deliveryroute);
app.use("/rating", ratingroute);
app.use("/complaint", complaintroute);
app.use("/payment", paymentroute);
app.use("/admin", adminroute);
app.use("/notification", notificationroute);
app.use("/coach", coachroute);
app.use("/verification", verificationroute);
app.use("/maps", mapsroute);

// ---------- 404 ----------
app.use((req, res) => {
  res.status(404).json({
    success: false,
    message: "Route not found",
    ...(isProd() ? {} : { path: req.originalUrl }), // never echo request data back in production
  });
});

// ---------- Error handler ----------
app.use((err, req, res, next) => {
  console.error("Backend error:", err.message);

  if (err.type === "entity.parse.failed") {
    return res.status(400).json({ success: false, message: "Invalid JSON body" });
  }
  if (err.type === "entity.too.large") {
    return res.status(413).json({ success: false, message: "Request body too large" });
  }
  if (err.message === "Not allowed by CORS") {
    return res.status(403).json({ success: false, message: "Origin not allowed" });
  }

  res.status(500).json({ success: false, message: "Something went wrong" });
});


export default app;
