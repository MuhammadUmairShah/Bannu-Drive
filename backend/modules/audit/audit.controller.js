import AuditLog from "./audit.model.js";
import { str, isObjectId } from "../../shared/utils/objectId.js";

// Admin only: GET /admin/audit-logs?action=&entityType=&entityId=&actor=&page=&limit=
export async function listAuditLogs(req, res) {
  try {
    const filter = {};
    const action = str(req.query.action, 80);
    const entityType = str(req.query.entityType, 40);
    const entityId = str(req.query.entityId, 60);
    const actor = str(req.query.actor, 24);

    if (action) filter.action = action.includes("*") ? new RegExp(`^${action.replace(/[^\w.]/g, "").replace(/\./g, "\\.")}`) : action;
    if (entityType) filter.entityType = entityType;
    if (entityId) filter.entityId = entityId;
    if (actor && isObjectId(actor)) filter.actor = actor;

    const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 50, 1), 100);
    const page = Math.max(parseInt(req.query.page, 10) || 1, 1);

    const [items, total] = await Promise.all([
      AuditLog.find(filter).sort({ createdAt: -1 }).skip((page - 1) * limit).limit(limit).populate("actor", "name role").lean(),
      AuditLog.countDocuments(filter)
    ]);

    res.json({ success: true, items, total, page, pages: Math.max(1, Math.ceil(total / limit)) });
  } catch (error) {
    console.error("List audit logs error:", error);
    res.status(500).json({ success: false, message: "Something went wrong" });
  }
}
