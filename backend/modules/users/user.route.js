import express from "express";

import {
  registration,
  login,
  logout,
  logoutAll,
  refresh,
  profile,
  updateProfile,
  changePassword,
  forgotPassword,
  resetPassword,
  uploadProfilePicture,
  removeProfilePicture,
  setDriverStatus,
  updateDriverLocation
} from "./user.controller.js";

import { googleAuth } from "./google.controller.js";
import { loginLimiter, registerLimiter, googleAuthLimiter, refreshLimiter, passwordLimiter, uploadLimiter } from "../../shared/middleware/rateLimit.middleware.js";
import { authMiddleware } from "../../shared/middleware/auth.middleware.js";
import { roleMiddleware } from "../../shared/middleware/role.middleware.js";
import { uploadProfileImage } from "../../shared/middleware/upload.middleware.js";

const route = express.Router();

route.post("/registration", registerLimiter, registration);
route.post("/login", loginLimiter, login);
route.post("/google", googleAuthLimiter, googleAuth);
route.post("/refresh", refreshLimiter, refresh);
route.post("/logout", refreshLimiter, logout);
route.post("/logout-all", authMiddleware, logoutAll);
route.post("/forgot-password", passwordLimiter, forgotPassword);
route.post("/reset-password", passwordLimiter, resetPassword);

route.get("/profile", authMiddleware, profile);
route.patch("/profile", authMiddleware, updateProfile);
route.patch("/password", authMiddleware, passwordLimiter, changePassword);

route.post("/profile-image", authMiddleware, uploadLimiter, uploadProfileImage, uploadProfilePicture);
route.delete("/profile-image", authMiddleware, removeProfilePicture);

route.patch("/driver-status", authMiddleware, roleMiddleware(["driver"]), setDriverStatus);
route.patch("/location", authMiddleware, roleMiddleware(["driver"]), updateDriverLocation);

export default route;
