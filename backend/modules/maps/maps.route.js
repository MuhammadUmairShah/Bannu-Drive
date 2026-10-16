import express from "express";
import { authMiddleware } from "../../shared/middleware/auth.middleware.js";
import { mapsLimiter } from "../../shared/middleware/rateLimit.middleware.js";
import * as c from "./maps.controller.js";

// Login required: map lookups cost money with commercial providers and must not be an open proxy.
const route = express.Router();
route.use(authMiddleware, mapsLimiter);
route.get("/config", c.config);
route.get("/search", c.search);
route.get("/reverse", c.reverse);
route.get("/route", c.route);
export default route;
