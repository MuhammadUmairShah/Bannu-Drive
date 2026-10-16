export function isValidPhone(phone) {
  if (typeof phone !== "string") return false;
  const trimmed = phone.trim();
  if (trimmed.includes("@")) return false;
  const digits = trimmed.replace(/[\s-]/g, "");
  return /^\+?\d{10,15}$/.test(digits);
}

export function isValidEmail(email) {
  return typeof email === "string" && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());
}
