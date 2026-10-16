import jwt from "jsonwebtoken";
import userModel from "../../modules/users/user.model.js";
import { readAccessToken, isSessionActive } from "../auth/session.service.js";

// Codes let the frontend decide: AUTH_EXPIRED / AUTH_REQUIRED -> try /user/refresh, then go to login.
export async function authMiddleware(req, res, next) {
  try {
    const token = readAccessToken(req);

    if (!token) {
      return res.status(401).json({ success: false, code: "AUTH_REQUIRED", message: "Please login first" });
    }

    let decoded;
    try {
      decoded = jwt.verify(token, process.env.JWT_SECRET);
    } catch (error) {
      const expired = error.name === "TokenExpiredError";
      return res.status(401).json({
        success: false,
        code: expired ? "AUTH_EXPIRED" : "AUTH_INVALID",
        message: expired ? "Session expired" : "Invalid token"
      });
    }

    // Always re-check the database so blocked / deleted users and logged-out sessions lose access immediately
    const [user, sessionOk] = await Promise.all([
      userModel.findById(decoded.id).select("role isBlocked"),
      decoded.sid ? isSessionActive(decoded.sid) : Promise.resolve(false)
    ]);

    if (!user) {
      return res.status(401).json({ success: false, code: "AUTH_INVALID", message: "Account no longer exists" });
    }

    if (user.isBlocked) {
      return res.status(403).json({ success: false, code: "ACCOUNT_BLOCKED", message: "Your account has been blocked. Please contact support." });
    }

    if (!sessionOk) {
      return res.status(401).json({ success: false, code: "AUTH_EXPIRED", message: "Session ended. Please sign in again." });
    }

    req.user = { id: user._id.toString(), role: user.role, sid: String(decoded.sid) };
    next();
  } catch (error) {
    console.error("Auth middleware error:", error.message);
    return res.status(500).json({ success: false, message: "Something went wrong" });
  }
}
