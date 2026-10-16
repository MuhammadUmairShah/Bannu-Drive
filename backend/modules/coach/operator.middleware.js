import { CoachOperator } from "./coach.model.js";
import userModel from "../users/user.model.js";

// Loads the logged-in operator's company. Every operator query is then filtered by req.operator.id,
// so one operator can never read or change another operator's data.
export async function operatorContext(req, res, next) {
  try {
    const [op, user] = await Promise.all([
      CoachOperator.findOne({ user: req.user.id }),
      userModel.findById(req.user.id).select("isVerified")
    ]);

    if (!op) return res.status(403).json({ success: false, message: "No coach operator profile found for this account" });

    req.operator = { id: op._id, doc: op, approved: !!user?.isVerified };
    next();
  } catch (error) {
    console.error("Operator context error:", error);
    res.status(500).json({ success: false, message: "Something went wrong" });
  }
}

// Writes (coaches, routes, schedules, cancellations) need admin approval first
export function requireApproved(req, res, next) {
  if (!req.operator?.approved) {
    return res.status(403).json({ success: false, message: "Your operator account is waiting for admin approval" });
  }
  next();
}
