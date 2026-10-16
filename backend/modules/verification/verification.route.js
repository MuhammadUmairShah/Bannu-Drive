import express from "express";
import { authMiddleware } from "../../shared/middleware/auth.middleware.js";
import { roleMiddleware } from "../../shared/middleware/role.middleware.js";
import { uploadVerificationDocument } from "../../shared/middleware/upload.middleware.js";
import { uploadLimiter, adminActionLimiter, onlyWrites } from "../../shared/middleware/rateLimit.middleware.js";
import * as c from "./verification.controller.js";

const route = express.Router();
route.use(authMiddleware);

// ---- driver / operator ----
route.get("/me", roleMiddleware(["driver", "operator"]), c.getMyVerification);
route.post("/documents", roleMiddleware(["driver", "operator"]), uploadLimiter, uploadVerificationDocument, c.uploadDocument);

// ---- owner or admin (authorization is checked inside the handler) ----
route.get("/documents/:id/file", c.validateObjectIdParam("id"), roleMiddleware(["driver", "operator", "admin"]), c.getDocumentFile);

// ---- admin ----
const admin = express.Router();
admin.use(roleMiddleware(["admin"]), onlyWrites(adminActionLimiter));
admin.get("/cases", c.adminListCases);
admin.get("/cases/:userId", c.validateObjectIdParam("userId"), c.adminGetCase);
admin.patch("/documents/:id/review", c.validateObjectIdParam("id"), c.adminReviewDocument);
route.use("/admin", admin);

export default route;
