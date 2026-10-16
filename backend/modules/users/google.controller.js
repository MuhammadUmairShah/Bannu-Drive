import crypto from "crypto";
import bcrypt from "bcrypt";
import { OAuth2Client } from "google-auth-library";
import usermodel from "./user.model.js";
import { userPayload } from "./user.controller.js";
import { startSession, revokeAllForUser } from "../../shared/auth/session.service.js";
import { disconnectUser } from "../../shared/realtime/socket.js";
import { googleConfigured } from "../../shared/config/env.js";
import { str } from "../../shared/utils/objectId.js";
import { audit } from "../audit/audit.service.js";

// ---------------------------------------------------------------------------
// Flow: the browser gets a Google ID token (Google Identity Services button) and posts ONLY that token.
// We verify signature, issuer, audience (our client id) and expiry with Google's official library,
// then read sub / email / email_verified / name / picture from the VERIFIED token. Nothing the
// browser says about the profile is ever trusted. No client secret is needed for this flow.
// ---------------------------------------------------------------------------

let client = null;

// Overridable so automated tests can run without calling Google
let verifier = async (idToken) => {
  client = client || new OAuth2Client(process.env.GOOGLE_CLIENT_ID);
  const ticket = await client.verifyIdToken({ idToken, audience: process.env.GOOGLE_CLIENT_ID });
  return ticket.getPayload();
};

export function setGoogleVerifier(fn) {
  verifier = fn;
}

const fail = (res, status, code, message) => res.status(status).json({ success: false, code, message });

export async function googleAuth(req, res) {
  try {
    if (!googleConfigured()) return fail(res, 503, "GOOGLE_NOT_CONFIGURED", "Google sign-in is not available right now");

    const credential = str(req.body?.credential, 4096);
    if (!credential) return fail(res, 400, "GOOGLE_TOKEN_MISSING", "Google sign-in failed. Please try again.");

    let claims;
    try {
      claims = await verifier(credential);
    } catch (error) {
      console.warn("Google token rejected:", error.message);
      return fail(res, 401, "GOOGLE_TOKEN_INVALID", "Google sign-in could not be verified. Please try again.");
    }

    const googleId = String(claims?.sub || "");
    const email = String(claims?.email || "").trim().toLowerCase();

    if (!googleId || !email) return fail(res, 401, "GOOGLE_TOKEN_INVALID", "Google sign-in could not be verified. Please try again.");
    if (claims.email_verified !== true) return fail(res, 403, "GOOGLE_EMAIL_UNVERIFIED", "Your Google email address is not verified.");

    const ctx = { ip: req.ip, userAgent: req.headers["user-agent"] };
    let user = await usermodel.findOne({ googleId }).select("+googleId");
    let created = false;
    let linked = false;

    if (!user) {
      const existing = await usermodel.findOne({ email }).select("+googleId");

      if (existing) {
        // Never let Google reach a privileged admin account, and never overwrite a different Google identity
        if (existing.role === "admin") return fail(res, 403, "GOOGLE_NOT_ALLOWED", "This account type cannot sign in with Google.");
        if (existing.googleId && existing.googleId !== googleId) return fail(res, 409, "GOOGLE_CONFLICT", "This email is linked to a different Google account.");
        if (existing.isBlocked) return fail(res, 403, "ACCOUNT_BLOCKED", "Your account has been blocked. Please contact support.");

        // Pre-hijack protection: the local account may have been created by someone who typed this email
        // without owning it. If we never verified the mailbox, whatever password exists is untrusted:
        // wipe it and end all sessions. The real owner (proven by Google) can set a new one via "Forgot password".
        if (!existing.emailVerified) {
          existing.password = await bcrypt.hash(crypto.randomBytes(32).toString("hex"), 10);
          existing.passwordSet = false;
          await revokeAllForUser(existing._id, "google_link");
          disconnectUser(existing._id);
        }

        existing.googleId = googleId;
        existing.emailVerified = true;
        if (!existing.profileImage && claims.picture) existing.profileImage = String(claims.picture).slice(0, 500);
        await existing.save();

        user = existing;
        linked = true;
      } else {
        // New people become customers. Driver/operator/admin can never be created through Google.
        user = await usermodel.create({
          name: str(claims.name || email.split("@")[0], 80) || "Customer",
          email,
          password: await bcrypt.hash(crypto.randomBytes(32).toString("hex"), 10),
          passwordSet: false,
          phone: "",
          role: "customer",
          googleId,
          emailVerified: true,
          profileImage: claims.picture ? String(claims.picture).slice(0, 500) : ""
        });
        created = true;
      }
    }

    if (user.isBlocked) return fail(res, 403, "ACCOUNT_BLOCKED", "Your account has been blocked. Please contact support.");

    const { accessToken: token } = await startSession(req, res, user, { remember: req.body?.remember !== false });

    if (created) await audit({ actor: user._id, actorRole: user.role, ...ctx }, "auth.google_registered", { entityType: "User", entityId: user._id });
    else if (linked) await audit({ actor: user._id, actorRole: user.role, ...ctx }, "auth.google_linked", { entityType: "User", entityId: user._id });
    else if (user.role !== "customer") await audit({ actor: user._id, actorRole: user.role, ...ctx }, "auth.login", { entityType: "User", entityId: user._id, meta: { provider: "google" } });

    return res.status(created ? 201 : 200).json({
      success: true,
      message: created ? "Account created with Google" : "You are logged in",
      created,
      linked,
      token,
      user: userPayload(user)
    });
  } catch (error) {
  if (error?.code === 11000) {
    console.error("GOOGLE DUPLICATE KEY ERROR:", {
      keyPattern: error.keyPattern,
      keyValue: error.keyValue,
      message: error.message
    });

    return fail(
      res,
      409,
      "GOOGLE_DUPLICATE_KEY",
      "Google account could not be linked because a unique account field is already in use."
    );
  }

  console.error("Google auth error:", error);
  return fail(res, 500, "SERVER_ERROR", "Something went wrong");
}
}
