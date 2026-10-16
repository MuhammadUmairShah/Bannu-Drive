import usermodel from "./user.model.js";
import bcrypt from "bcrypt";
import crypto from "crypto";
import { sendPasswordResetEmail } from "../../shared/utils/mailer.js";
import { isValidPhone, isValidEmail } from "../../shared/utils/validators.js";
import { driverHasActiveJob } from "../../shared/utils/driverRules.js";
import { str } from "../../shared/utils/objectId.js";
import { uploadImageBuffer, deleteImage } from "../../shared/utils/cloudinaryUpload.js";
import { broadcastDriverLocation } from "../../shared/utils/liveLocation.js";
import { getDriverRatingSummary } from "../ratings/rating.service.js";
import { CoachOperator } from "../coach/coach.model.js";
import { startSession, rotateSession, revokeSession, revokeAllForUser, clearAuthCookies, readAccessToken, readRefreshSession } from "../../shared/auth/session.service.js";
import { disconnectSession, disconnectUser } from "../../shared/realtime/socket.js";
import { audit } from "../audit/audit.service.js";
import { distanceKm } from "../../shared/utils/geoMath.js";
import jwt from "jsonwebtoken";

const PUBLIC_ROLES = ["customer", "driver", "operator"]; // admin is created only through the CLI script
const MIN_PASSWORD = 8;
const STAFF_ROLES = ["driver", "operator", "admin"]; // their sign-ins are written to the audit log

// One consistent shape for the logged-in user. Never includes password / internal ids.
export function userPayload(user) {
  return {
    id: user._id,
    name: user.name,
    email: user.email,
    phone: user.phone,
    role: user.role,
    profileImage: user.profileImage || "",
    isVerified: user.isVerified,
    hasPassword: user.passwordSet !== false,
    needsPhone: !user.phone,
    vehicleType: user.vehicleType,
    vehicleModel: user.vehicleModel,
    vehicleNumber: user.vehicleNumber,
    licenseNumber: user.licenseNumber,
    driverStatus: user.driverStatus,
    createdAt: user.createdAt
  };
}

export async function registration(req, res) {
  try {
    const name = str(req.body.name, 80);
    const email = str(req.body.email, 120).toLowerCase();
    const password = typeof req.body.password === "string" ? req.body.password : "";
    const role = str(req.body.role, 20);
    const phone = str(req.body.phone, 20);
    const vehicleType = str(req.body.vehicleType, 30).toLowerCase();
    const vehicleModel = str(req.body.vehicleModel, 60);
    const vehicleNumber = str(req.body.vehicleNumber, 20);
    const licenseNumber = str(req.body.licenseNumber, 30);
    const companyName = str(req.body.companyName, 80);

    if (!name || !email || !password || !role || !phone) {
      return res.status(400).json({ success: false, message: "All fields are required" });
    }

    if (!PUBLIC_ROLES.includes(role)) {
      return res.status(403).json({
        success: false,
        message: "This role cannot be registered from the website"
      });
    }

    if (role === "driver" && (!vehicleType || !vehicleNumber || !licenseNumber)) {
      return res.status(400).json({
        success: false,
        message: "Vehicle type, vehicle number and license number are required for drivers"
      });
    }

    if (role === "operator" && companyName.length < 2) {
      return res.status(400).json({ success: false, message: "Company name is required for coach operators" });
    }

    if (role === "driver" && !["bike", "rickshaw", "car"].includes(vehicleType)) {
      return res.status(400).json({ success: false, message: "Vehicle type must be bike, rickshaw or car" });
    }

    if (!isValidEmail(email)) {
      return res.status(400).json({ success: false, message: "Please enter a valid email address" });
    }

    if (!isValidPhone(phone)) {
      return res.status(400).json({
        success: false,
        message: "Please enter a valid phone number (e.g. 03001234567)"
      });
    }

    if (password.length < MIN_PASSWORD || password.length > 72) {
      return res.status(400).json({
        success: false,
        message: `Password must be ${MIN_PASSWORD}-72 characters`
      });
    }

    if (await usermodel.exists({ phone })) {
      return res.status(409).json({ success: false, message: "Phone number already registered" });
    }

    if (await usermodel.exists({ email })) {
      return res.status(409).json({ success: false, message: "Email already registered" });
    }

    const hashPassword = await bcrypt.hash(password, 10);

    const data = await usermodel.create({
      name,
      email,
      password: hashPassword,
      phone,
      role,
      vehicleType: role === "driver" ? vehicleType : "",
      vehicleModel: role === "driver" ? vehicleModel : "",
      vehicleNumber: role === "driver" ? vehicleNumber : "",
      licenseNumber: role === "driver" ? licenseNumber : ""
    });

    if (role === "operator") {
      try {
        await CoachOperator.create({ user: data._id, companyName, contactPhone: phone });
      } catch (operatorError) {
        await usermodel.deleteOne({ _id: data._id }); // never leave an operator login without a company
        throw operatorError;
      }
    }

    const { accessToken: token } = await startSession(req, res, data, { remember: req.body.remember !== false });
    if (STAFF_ROLES.includes(role)) await audit({ actor: data._id, actorRole: role, ip: req.ip, userAgent: req.headers["user-agent"] }, "auth.registered", { entityType: "User", entityId: data._id });

    return res.status(201).json({
      success: true,
      message: role === "operator" ? "Registration successful. An admin must approve your account before you can sell seats." : "Registration successful",
      token,
      user: userPayload(data)
    });
  } catch (error) {
    if (error.code === 11000) {
      return res.status(409).json({ success: false, message: "Email or phone already registered" });
    }
    console.error("Registration error:", error);
    return res.status(500).json({ success: false, message: "Something went wrong" });
  }
}

export async function login(req, res) {
  try {
    const email = str(req.body.email, 120).toLowerCase();
    const password = typeof req.body.password === "string" ? req.body.password : "";
    const role = str(req.body.role, 20);

    if (!email || !password || !["customer", "driver", "operator", "admin"].includes(role)) {
      return res.status(400).json({ success: false, message: "Email, password and role are required" });
    }

    const data = await usermodel.findOne({ email, role });

    // Same message for unknown email and wrong password (no account enumeration)
    const valid = data ? await bcrypt.compare(password, data.password) : false;

    if (!valid) {
      return res.status(401).json({ success: false, message: "Invalid email or password" });
    }

    if (data.isBlocked) {
      return res.status(403).json({
        success: false,
        message: "Your account has been blocked. Please contact support."
      });
    }

    const { accessToken: token } = await startSession(req, res, data, { remember: req.body.remember !== false });
    if (STAFF_ROLES.includes(data.role)) await audit({ actor: data._id, actorRole: data.role, ip: req.ip, userAgent: req.headers["user-agent"] }, "auth.login", { entityType: "User", entityId: data._id, meta: { provider: "password" } });

    return res.json({
      success: true,
      message: "You are logged in",
      token,
      user: userPayload(data)
    });
  } catch (error) {
    console.error("Login error:", error);
    return res.status(500).json({ success: false, message: "Something went wrong" });
  }
}

export async function logout(req, res) {
  try {
    // Best effort: identify the session from the access token (even expired) or the refresh cookie
    try {
      let userId = null;
      let sid = null;

      const access = readAccessToken(req);
      if (access) {
        const decoded = jwt.verify(access, process.env.JWT_SECRET, { ignoreExpiration: true });
        userId = decoded.id;
        sid = decoded.sid;
      }

      const refreshSession = await readRefreshSession(req);
      if (refreshSession) {
        userId = userId || String(refreshSession.user);
        await revokeSession(refreshSession._id, "logout");
        disconnectSession(refreshSession._id);
      }
      if (sid) {
        await revokeSession(sid, "logout");
        disconnectSession(sid);
      }

      // An idle driver who logs out should stop appearing online
      if (userId) {
        const user = await usermodel.findById(userId).select("role");
        if (user && user.role === "driver" && !(await driverHasActiveJob(user._id))) {
          await usermodel.findByIdAndUpdate(user._id, {
            driverStatus: "offline",
            currentLocation: { latitude: null, longitude: null, accuracy: null, updatedAt: null }
          });
        }
      }
    } catch (innerError) {
      console.log("Logout cleanup skipped:", innerError.message);
    }

    clearAuthCookies(res);
    return res.json({ success: true, message: "Logged out successfully" });
  } catch (error) {
    console.error("Logout error:", error);
    return res.status(500).json({ success: false, message: "Something went wrong" });
  }
}

// POST /user/refresh: silent session restoration + refresh-token rotation.
export async function refresh(req, res) {
  try {
    const result = await rotateSession(req, res, (id) => usermodel.findById(id));

    if (!result.ok) {
      clearAuthCookies(res);
      return res.status(401).json({ success: false, code: "SESSION_ENDED", message: "Please sign in again" });
    }

    return res.json({ success: true, token: result.accessToken, user: userPayload(result.user) });
  } catch (error) {
    console.error("Refresh error:", error);
    return res.status(500).json({ success: false, message: "Something went wrong" });
  }
}

// POST /user/logout-all: sign this account out on every device
export async function logoutAll(req, res) {
  try {
    await revokeAllForUser(req.user.id, "logout_all");
    disconnectUser(req.user.id);
    await audit(req, "auth.logout_all", { entityType: "User", entityId: req.user.id });
    clearAuthCookies(res);
    return res.json({ success: true, message: "Signed out on all devices" });
  } catch (error) {
    console.error("Logout all error:", error);
    return res.status(500).json({ success: false, message: "Something went wrong" });
  }
}

export async function profile(req, res) {
  try {
    const data = await usermodel.findById(req.user.id).select("-password");

    if (!data) {
      return res.status(404).json({ success: false, message: "User not found" });
    }

    const user = data.toObject();

    if (data.role === "driver") {
      user.ratingSummary = await getDriverRatingSummary(data._id);
    }

    if (data.role === "operator") {
      user.operator = await CoachOperator.findOne({ user: data._id });
    }

    return res.json({ success: true, message: "User is authenticated", user });
  } catch (error) {
    console.error("Profile error:", error);
    return res.status(500).json({ success: false, message: "Something went wrong" });
  }
}

export async function updateProfile(req, res) {
  try {
    const updateData = {};

    if (req.body.name !== undefined) {
      const name = str(req.body.name, 80);
      if (!name) return res.status(400).json({ success: false, message: "Name cannot be empty" });
      updateData.name = name;
    }

    if (req.body.phone !== undefined) {
      const phone = str(req.body.phone, 20);

      if (!isValidPhone(phone)) {
        return res.status(400).json({
          success: false,
          message: "Please enter a valid phone number (e.g. 03001234567)"
        });
      }

      const phoneOwner = await usermodel.exists({ phone, _id: { $ne: req.user.id } });

      if (phoneOwner) {
        return res.status(409).json({ success: false, message: "Phone number already in use" });
      }

      updateData.phone = phone;
    }

    if (req.user.role === "driver") {
      if (req.body.vehicleType !== undefined) {
        const vehicleType = str(req.body.vehicleType, 30).toLowerCase();

        if (!["bike", "rickshaw", "car"].includes(vehicleType)) {
          return res.status(400).json({ success: false, message: "Vehicle type must be bike, rickshaw or car" });
        }

        // Changing vehicle mid-trip would break matching rules
        if (await driverHasActiveJob(req.user.id)) {
          return res.status(409).json({ success: false, message: "Finish your current trip before changing vehicle type" });
        }

        updateData.vehicleType = vehicleType;
      }

      if (req.body.vehicleModel !== undefined) updateData.vehicleModel = str(req.body.vehicleModel, 60);
      if (req.body.vehicleNumber !== undefined) updateData.vehicleNumber = str(req.body.vehicleNumber, 20);
      if (req.body.licenseNumber !== undefined) updateData.licenseNumber = str(req.body.licenseNumber, 30);
    }

    const result = await usermodel.updateOne({ _id: req.user.id }, { $set: updateData }, { runValidators: true });

    if (!result.matchedCount) return res.status(404).json({ success: false, message: "User not found" });

    const data = await usermodel.findById(req.user.id).select("-password");

    return res.json({ success: true, message: "Profile updated successfully", user: data });
  } catch (error) {
    if (error.code === 11000) {
      return res.status(409).json({ success: false, message: "Phone number already in use" });
    }
    console.error("Update profile error:", error);
    return res.status(500).json({ success: false, message: "Something went wrong" });
  }
}

export async function changePassword(req, res) {
  try {
    const currentPassword = typeof req.body.currentPassword === "string" ? req.body.currentPassword : "";
    const newPassword = typeof req.body.newPassword === "string" ? req.body.newPassword : "";

    if (!currentPassword || !newPassword) {
      return res.status(400).json({ success: false, message: "Current and new password are required" });
    }

    if (newPassword.length < MIN_PASSWORD || newPassword.length > 72) {
      return res.status(400).json({ success: false, message: `New password must be ${MIN_PASSWORD}-72 characters` });
    }

    const user = await usermodel.findById(req.user.id);

    if (!user || !(await bcrypt.compare(currentPassword, user.password))) {
      return res.status(401).json({ success: false, message: "Current password is incorrect" });
    }

    if (currentPassword === newPassword) {
      return res.status(400).json({ success: false, message: "New password must be different" });
    }

    user.password = await bcrypt.hash(newPassword, 10);
    user.passwordSet = true;
    await user.save();

    // Every other device must sign in again with the new password
    await revokeAllForUser(user._id, "password_changed", req.user.sid);
    await audit(req, "auth.password_changed", { entityType: "User", entityId: user._id });

    return res.json({ success: true, message: "Password changed successfully" });
  } catch (error) {
    console.error("Change password error:", error);
    return res.status(500).json({ success: false, message: "Something went wrong" });
  }
}

// ==========================================
// PROFILE PICTURE (Cloudinary)
// ==========================================
export async function uploadProfilePicture(req, res) {
  try {
    const user = await usermodel.findById(req.user.id).select("+profileImagePublicId");

    if (!user) return res.status(404).json({ success: false, message: "User not found" });

    let uploaded;

    try {
      uploaded = await uploadImageBuffer(req.file.buffer);
    } catch (error) {
      if (error.code === "CLOUDINARY_NOT_CONFIGURED") {
        return res.status(503).json({
          success: false,
          message: "Image uploads are not configured on the server yet"
        });
      }
      console.error("Cloudinary upload error:", error.message);
      return res.status(502).json({ success: false, message: "Could not upload the image. Please try again." });
    }

    const oldPublicId = user.profileImagePublicId;

    user.profileImage = uploaded.url;
    user.profileImagePublicId = uploaded.publicId;

    try {
      await user.save();
    } catch (saveError) {
      // Database failed: do not leave an orphan image in Cloudinary
      await deleteImage(uploaded.publicId);
      throw saveError;
    }

    // Replace: remove the previous picture only after the new one is safely stored
    if (oldPublicId && oldPublicId !== uploaded.publicId) await deleteImage(oldPublicId);

    const fresh = await usermodel.findById(user._id).select("-password");

    return res.json({ success: true, message: "Profile picture updated", user: fresh });
  } catch (error) {
    console.error("Upload profile picture error:", error);
    return res.status(500).json({ success: false, message: "Something went wrong" });
  }
}

export async function removeProfilePicture(req, res) {
  try {
    const user = await usermodel.findById(req.user.id).select("+profileImagePublicId");

    if (!user) return res.status(404).json({ success: false, message: "User not found" });

    const oldPublicId = user.profileImagePublicId;

    user.profileImage = "";
    user.profileImagePublicId = "";
    await user.save();

    await deleteImage(oldPublicId);

    const fresh = await usermodel.findById(user._id).select("-password");

    return res.json({ success: true, message: "Profile picture removed", user: fresh });
  } catch (error) {
    console.error("Remove profile picture error:", error);
    return res.status(500).json({ success: false, message: "Something went wrong" });
  }
}

// ==========================================
// DRIVER STATUS / LOCATION
// ==========================================
export async function setDriverStatus(req, res) {
  try {
    const status = str(req.body.status, 10);

    if (!["online", "offline"].includes(status)) {
      return res.status(400).json({ success: false, message: "Invalid status" });
    }

    const driver = await usermodel.findById(req.user.id);

    if (status === "online" && !driver.isVerified) {
      return res.status(403).json({
        success: false,
        message: "Your account is pending admin verification. You can go online once approved."
      });
    }

    if (status === "offline" && (await driverHasActiveJob(driver._id))) {
      return res.status(409).json({ success: false, message: "Finish your current trip before going offline" });
    }

    driver.driverStatus = status;

    if (status === "offline") {
      driver.currentLocation = { latitude: null, longitude: null, accuracy: null, updatedAt: null };
    }

    await driver.save();

    const data = await usermodel.findById(driver._id).select("-password");

    return res.json({ success: true, message: `You are now ${status}`, user: data });
  } catch (error) {
    console.error("Set driver status error:", error);
    return res.status(500).json({ success: false, message: "Something went wrong" });
  }
}

export async function updateDriverLocation(req, res) {
  try {
    const { latitude, longitude, accuracy } = req.body;

    if (
      typeof latitude !== "number" ||
      typeof longitude !== "number" ||
      !Number.isFinite(latitude) ||
      !Number.isFinite(longitude) ||
      latitude < -90 || latitude > 90 ||
      longitude < -180 || longitude > 180
    ) {
      return res.status(400).json({ success: false, message: "Valid latitude and longitude are required" });
    }

    if (latitude < 23 || latitude > 37.3 || longitude < 60.5 || longitude > 77.9) {
      return res.status(422).json({ success: false, message: "Position is outside Pakistan" });
    }
    if (typeof accuracy === "number" && accuracy > 2000) {
      return res.status(422).json({ success: false, message: "GPS accuracy is too low to use" });
    }

    const driver = await usermodel.findById(req.user.id);

    if (driver.driverStatus === "offline") {
      return res.status(409).json({ success: false, message: "Go online to share your location" });
    }

    // Throttle (a phone can fire many updates) and refuse impossible jumps (a bad GPS fix must not teleport the marker)
    const prev = driver.currentLocation;
    if (prev?.updatedAt && typeof prev.latitude === "number") {
      const dtMs = Date.now() - new Date(prev.updatedAt).getTime();
      if (dtMs < 1500) return res.json({ success: true, throttled: true, message: "Location unchanged (too frequent)" });
      const km = distanceKm({ latitude: prev.latitude, longitude: prev.longitude }, { latitude, longitude });
      if (dtMs < 120000 && km > 1 && km / (dtMs / 3600000) > 250) {
        return res.status(422).json({ success: false, message: "Position jump looks wrong and was ignored" });
      }
    }

    driver.currentLocation = {
      latitude,
      longitude,
      accuracy: typeof accuracy === "number" && Number.isFinite(accuracy) ? accuracy : null,
      updatedAt: new Date()
    };

    await driver.save();

    // Pushes to the customer of the driver's ACTIVE booking only
    await broadcastDriverLocation(driver._id, driver.currentLocation);

    return res.json({
      success: true,
      message: "Location updated",
      currentLocation: driver.currentLocation
    });
  } catch (error) {
    console.error("Update driver location error:", error);
    return res.status(500).json({ success: false, message: "Something went wrong" });
  }
}

// ==========================================
// FORGOT / RESET PASSWORD
// ==========================================
const sha256 = (value) => crypto.createHash("sha256").update(value).digest("hex");

export async function forgotPassword(req, res) {
  // Same answer whether or not the email exists (no account enumeration)
  const generic = {
    success: true,
    message: "If an account exists for that email, a password reset link has been sent."
  };

  try {
    const email = str(req.body.email, 120).toLowerCase();

    if (!isValidEmail(email)) {
      return res.status(400).json({ success: false, message: "Please enter a valid email address" });
    }

    const user = await usermodel.findOne({ email }).select("+resetTokenHash +resetTokenExpires");

    if (user && !user.isBlocked) {
      const token = crypto.randomBytes(32).toString("hex");

      user.resetTokenHash = sha256(token);
      user.resetTokenExpires = new Date(Date.now() + 30 * 60 * 1000); // 30 minutes
      await user.save();

      const base = (process.env.Frontend_URL || "").split(",")[0].trim().replace(/\/$/, "");
      await sendPasswordResetEmail(user.email, user.name, `${base}/reset-password?token=${token}`);
    }

    return res.json(generic);
  } catch (error) {
    console.error("Forgot password error:", error);
    return res.status(500).json({ success: false, message: "Something went wrong" });
  }
}

export async function resetPassword(req, res) {
  try {
    const token = str(req.body.token, 100);
    const password = typeof req.body.password === "string" ? req.body.password : "";

    if (!/^[a-f0-9]{64}$/.test(token)) {
      return res.status(400).json({ success: false, message: "This reset link is invalid or has expired" });
    }

    if (password.length < MIN_PASSWORD || password.length > 72) {
      return res.status(400).json({ success: false, message: `Password must be ${MIN_PASSWORD}-72 characters` });
    }

    const user = await usermodel
      .findOne({ resetTokenHash: sha256(token), resetTokenExpires: { $gt: new Date() } })
      .select("+resetTokenHash +resetTokenExpires");

    if (!user) {
      return res.status(400).json({ success: false, message: "This reset link is invalid or has expired" });
    }

    user.password = await bcrypt.hash(password, 10);
    user.resetTokenHash = "";
    user.resetTokenExpires = null; // single use
    user.passwordSet = true;
    user.emailVerified = true; // the reset link proves control of the mailbox
    await user.save();

    await revokeAllForUser(user._id, "password_reset");
    disconnectUser(user._id);
    await audit({ actor: user._id, actorRole: user.role, ip: req.ip, userAgent: req.headers["user-agent"] }, "auth.password_reset", { entityType: "User", entityId: user._id });

    return res.json({ success: true, message: "Password updated. You can now log in." });
  } catch (error) {
    console.error("Reset password error:", error);
    return res.status(500).json({ success: false, message: "Something went wrong" });
  }
}