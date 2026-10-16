import crypto from "crypto";
import jwt from "jsonwebtoken";
import Session from "./session.model.js";
import { authConfig, isProd } from "../config/env.js";
import { audit } from "../../modules/audit/audit.service.js";

export const ACCESS_COOKIE = "safarx-bannu"; // kept so existing clients/sockets keep working
export const REFRESH_COOKIE = "bd-refresh";
const REFRESH_PATH = "/user"; // the refresh cookie is only ever sent to /user/*
const ROTATION_GRACE_MS = (Number(process.env.REFRESH_GRACE_SECONDS) || 15) * 1000; // two tabs refreshing at once must not look like token theft

const sha256 = (v) => crypto.createHash("sha256").update(v).digest("hex");
const newToken = () => crypto.randomBytes(48).toString("base64url");

// ---------- cookies ----------
// Same parent domain (app.x.pk + api.x.pk): set COOKIE_DOMAIN=.x.pk and COOKIE_SAMESITE=lax.
// Different domains (vercel.app + onrender.com): defaults below (SameSite=None; Secure).
function baseCookie() {
  const prod = isProd();
  const sameSite = (process.env.COOKIE_SAMESITE || (prod ? "none" : "lax")).toLowerCase();
  return {
    httpOnly: true,
    secure: prod || sameSite === "none",
    sameSite,
    ...(process.env.COOKIE_DOMAIN ? { domain: process.env.COOKIE_DOMAIN } : {})
  };
}

export function setAuthCookies(res, { accessToken, refreshToken, persistent, refreshExpiresAt }) {
  const { accessTtlMin } = authConfig();
  res.cookie(ACCESS_COOKIE, accessToken, { ...baseCookie(), path: "/", maxAge: accessTtlMin * 60 * 1000 });

  if (refreshToken) {
    res.cookie(REFRESH_COOKIE, refreshToken, {
      ...baseCookie(),
      path: REFRESH_PATH,
      ...(persistent ? { expires: refreshExpiresAt } : {}) // no expiry = browser-session cookie
    });
  }
}

export function clearAuthCookies(res) {
  const opts = baseCookie();
  res.clearCookie(ACCESS_COOKIE, { ...opts, path: "/" });
  res.clearCookie(REFRESH_COOKIE, { ...opts, path: REFRESH_PATH });
}

// ---------- tokens ----------
export function signAccessToken(user, sessionId) {
  const { accessTtlMin } = authConfig();
  return jwt.sign({ id: user._id.toString(), role: user.role, sid: String(sessionId) }, process.env.JWT_SECRET, {
    expiresIn: `${accessTtlMin}m`
  });
}

const reqInfo = (req) => ({
  ip: String(req.ip || "").slice(0, 60),
  userAgent: String(req.headers?.["user-agent"] || "").slice(0, 200)
});

// ---------- lifecycle ----------
// Creates a session for a freshly authenticated user and sets both cookies.
export async function startSession(req, res, user, { remember = true } = {}) {
  const { refreshDays, sessionOnlyHours } = authConfig();
  const persistent = remember !== false;
  const refreshExpiresAt = new Date(Date.now() + (persistent ? refreshDays * 24 * 3600 * 1000 : sessionOnlyHours * 3600 * 1000));

  const refreshToken = newToken();
  const session = await Session.create({
    user: user._id,
    family: crypto.randomUUID(),
    tokenHash: sha256(refreshToken),
    expiresAt: refreshExpiresAt,
    persistent,
    ...reqInfo(req)
  });

  const accessToken = signAccessToken(user, session._id);
  setAuthCookies(res, { accessToken, refreshToken, persistent, refreshExpiresAt });
  return { accessToken, sessionId: session._id };
}

// Exchanges the refresh cookie for a new access token + a NEW refresh token (rotation).
// Returns { ok:true, user-id, accessToken } or { ok:false, reason }.
export async function rotateSession(req, res, loadUser) {
  const raw = req.cookies?.[REFRESH_COOKIE];
  if (!raw || typeof raw !== "string") return { ok: false, reason: "no_refresh_token" };

  const session = await Session.findOne({ tokenHash: sha256(raw) });
  if (!session) return { ok: false, reason: "unknown_token" };

  const now = Date.now();
  if (session.expiresAt.getTime() <= now) return { ok: false, reason: "expired" };

  const user = await loadUser(session.user);
  if (!user || user.isBlocked) {
    await revokeSession(session._id, "user_unavailable");
    return { ok: false, reason: "user_unavailable" };
  }

  if (session.revokedAt) {
    // Benign race: this token was rotated moments ago (second tab). Hand out an access token for the
    // successor session without rotating again; the browser already received the new refresh cookie.
    const recentlyRotated = session.replacedBy && now - session.revokedAt.getTime() < ROTATION_GRACE_MS;
    if (recentlyRotated) {
      const successor = await Session.findOne({ _id: session.replacedBy, revokedAt: null });
      if (successor) {
        const accessToken = signAccessToken(user, successor._id);
        setAuthCookies(res, { accessToken });
        return { ok: true, user, accessToken, graceReuse: true };
      }
    }

    // Anything else is an old token being replayed: assume theft, kill the whole login family.
    await Session.updateMany({ family: session.family, revokedAt: null }, { $set: { revokedAt: new Date(), revokedReason: "reuse_detected" } });
    await audit({ actor: user._id, actorRole: user.role, ...reqInfo(req) }, "auth.refresh_reuse_detected", { entityType: "User", entityId: user._id });
    return { ok: false, reason: "reuse_detected" };
  }

  // Atomic rotation: only one concurrent request can flip revokedAt from null
  const refreshToken = newToken();
  const refreshExpiresAt = session.persistent ? new Date(now + authConfig().refreshDays * 24 * 3600 * 1000) : session.expiresAt;

  const claimed = await Session.findOneAndUpdate(
    { _id: session._id, revokedAt: null },
    { $set: { revokedAt: new Date(), revokedReason: "rotated", lastUsedAt: new Date() } },
    { new: true }
  );
  if (!claimed) return { ok: false, reason: "race_lost" };

  const next = await Session.create({
    user: session.user,
    family: session.family,
    tokenHash: sha256(refreshToken),
    expiresAt: refreshExpiresAt,
    persistent: session.persistent,
    ...reqInfo(req)
  });
  await Session.updateOne({ _id: session._id }, { $set: { replacedBy: next._id } });

  const accessToken = signAccessToken(user, next._id);
  setAuthCookies(res, { accessToken, refreshToken, persistent: session.persistent, refreshExpiresAt });
  return { ok: true, user, accessToken };
}

export async function revokeSession(sessionId, reason = "logout") {
  if (!sessionId) return;
  await Session.updateOne({ _id: sessionId, revokedAt: null }, { $set: { revokedAt: new Date(), revokedReason: reason } });
}

// Logs the user out everywhere (password change/reset, block, account link, "log out all devices")
export async function revokeAllForUser(userId, reason = "revoked", exceptSessionId = null) {
  const filter = { user: userId, revokedAt: null };
  if (exceptSessionId) filter._id = { $ne: exceptSessionId };
  await Session.updateMany(filter, { $set: { revokedAt: new Date(), revokedReason: reason } });
}

export async function isSessionActive(sessionId) {
  if (!sessionId) return false;
  const s = await Session.findById(sessionId).select("revokedAt expiresAt").lean();
  return !!s && !s.revokedAt && s.expiresAt.getTime() > Date.now();
}

export function readAccessToken(req) {
  const header = req.headers.authorization;
  const bearer = header && header.startsWith("Bearer ") ? header.split(" ")[1] : null;
  return req.cookies?.[ACCESS_COOKIE] || bearer || null;
}

export function readRefreshSession(req) {
  const raw = req.cookies?.[REFRESH_COOKIE];
  return raw ? Session.findOne({ tokenHash: sha256(raw) }).select("_id user") : null;
}
