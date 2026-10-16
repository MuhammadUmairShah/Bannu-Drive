// Blocks NoSQL operator injection ({"$ne": ...}, {"a.b": ...}) in body/query/params.
function hasUnsafeKey(value, depth = 0) {
  if (depth > 6 || value === null || typeof value !== "object") return false;

  for (const key of Object.keys(value)) {
    if (key.startsWith("$") || key.includes(".")) return true;
    if (hasUnsafeKey(value[key], depth + 1)) return true;
  }
  return false;
}

export function sanitizeRequest(req, res, next) {
  if (hasUnsafeKey(req.body) || hasUnsafeKey(req.query) || hasUnsafeKey(req.params)) {
    return res.status(400).json({ success: false, message: "Invalid request" });
  }
  next();
}
