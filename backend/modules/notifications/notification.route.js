import express from "express";
import { listNotifications, markRead, markAllRead } from "./notification.controller.js";
import { authMiddleware } from "../../shared/middleware/auth.middleware.js";
import { validateIdParams } from "../../shared/utils/objectId.js";

const route = express.Router();

route.use(authMiddleware);

route.get("/", listNotifications);
route.patch("/read-all", markAllRead);
route.patch("/:notificationId/read", validateIdParams("notificationId"), markRead);

export default route;
