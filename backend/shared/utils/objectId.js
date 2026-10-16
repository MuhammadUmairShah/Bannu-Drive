import mongoose from "mongoose";

export function isObjectId(value) {
  return typeof value === "string" && mongoose.Types.ObjectId.isValid(value) && /^[a-fA-F0-9]{24}$/.test(value);
}

// Router param guard: rejects malformed ids with 400 instead of a CastError 500
export function validateIdParams(...names) {
  return (req, res, next) => {
    for (const name of names) {
      if (req.params[name] !== undefined && !isObjectId(req.params[name])) {
        return res.status(400).json({ success: false, message: "Invalid id" });
      }
    }
    next();
  };
}

// Coerces to a trimmed string (defeats object injection through body fields)
export function str(value, max = 500) {
  if (typeof value !== "string") return "";
  return value.trim().slice(0, max);
}

export function escapeRegex(text) {
  return String(text).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
