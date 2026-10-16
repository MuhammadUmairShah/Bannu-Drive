import AuditLog from "./audit.model.js";

// Pulls who/where from an Express request (or accepts a plain { actor, actorRole } object)
function context(source) {
  if (!source) return {};
  if (source.headers) {
    return {
      actor: source.user?.id || null,
      actorRole: source.user?.role || "",
      ip: String(source.ip || "").slice(0, 60),
      userAgent: String(source.headers["user-agent"] || "").slice(0, 200)
    };
  }
  return { actor: source.actor || null, actorRole: source.actorRole || "", ip: source.ip || "", userAgent: source.userAgent || "" };
}

// Never throws: an audit failure must not break the business action it describes.
export async function audit(source, action, { entityType = "", entityId = "", meta = {} } = {}) {
  try {
    return await AuditLog.create({
      ...context(source),
      action,
      entityType,
      entityId: entityId ? String(entityId) : "",
      meta
    });
  } catch (error) {
    console.error("Audit log failed:", error.message);
    return null;
  }
}
