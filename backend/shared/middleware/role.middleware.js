// Must run AFTER authMiddleware. 401 = not logged in, 403 = logged in but wrong role.
export function roleMiddleware(allowedRoles) {
  const requireRole = function requireRole(req, res, next) {
    if (!req.user) {
      return res.status(401).json({ success: false, code: "AUTH_REQUIRED", message: "Please login first" });
    }

    if (!allowedRoles.includes(req.user.role)) {
      return res.status(403).json({ success: false, message: "You are not authorized" });
    }

    next();
  };

  requireRole.roles = allowedRoles; // lets scripts/audit-routes.mjs report who may call each route
  return requireRole;
}
