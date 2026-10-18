import dotenv from "dotenv";

dotenv.config();

export const isProd = () =>
  process.env.NODE_ENV === "production" || !!process.env.VERCEL;

const clean = (v) =>
  String(v || "").trim().replace(/\/+$/, "");

// Browser + Capacitor app origins allowed
// to call the API and open sockets.
export const allowedOrigins = () => {
  const origins = [];

  // Production frontend
  for (const key of ["CLIENT_URL", "FRONTEND_URL", "Frontend_URL"]) {
    if (process.env[key]) {
      origins.push(
        ...String(process.env[key]).split(",").map(clean).filter(Boolean)
      );
    }
  }

  // Additional allowed origins from environment
  if (process.env.ALLOWED_ORIGINS) {
    origins.push(
      ...process.env.ALLOWED_ORIGINS
        .split(",")
        .map(clean)
        .filter(Boolean)
    );
  }

  // Capacitor app WebView origins
  origins.push(
    "https://localhost",       // Android (Capacitor default scheme)
    "http://localhost",        // Android (agar androidScheme "http" ho)
    "capacitor://localhost"    // iOS
  );

  // Local development
  if (!isProd()) {
    origins.push(
      "http://localhost:5173",
      "http://localhost:3000",
      "http://127.0.0.1:5173"
    );
  }

  return [...new Set(origins.filter(Boolean))];
};

export const cloudinaryConfigured = () =>
  Boolean(
    process.env.CLOUDINARY_CLOUD_NAME &&
      process.env.CLOUDINARY_API_KEY &&
      process.env.CLOUDINARY_API_SECRET
  );

export const googleConfigured = () =>
  Boolean(process.env.GOOGLE_CLIENT_ID);

// Authentication configuration
export const authConfig = () => ({
  accessTtlMin: Number(process.env.ACCESS_TOKEN_MINUTES) || 15,
  refreshDays: Number(process.env.REFRESH_TOKEN_DAYS) || 30,
  sessionOnlyHours: 24
});

// Documents must be approved before
// an operator/driver becomes verified.
export const requireDocuments = () => {
  const v = String(
    process.env.REQUIRE_DOCUMENTS_FOR_VERIFICATION || ""
  ).toLowerCase();

  if (v === "true") return true;
  if (v === "false") return false;

  return isProd();
};

// Validate environment variables
export const validateEnv = () => {
  const problems = [];

  if (!process.env.MONGO_URI) {
    problems.push("MONGO_URI is missing");
  }

  if (!process.env.JWT_SECRET) {
    problems.push("JWT_SECRET is missing");
  } else if (
    isProd() &&
    process.env.JWT_SECRET.length < 32
  ) {
    problems.push(
      "JWT_SECRET must be at least 32 characters in production"
    );
  }

  if (isProd() && allowedOrigins().length === 0) {
    problems.push("CLIENT_URL must be set in production");
  }

  if (problems.length && isProd()) {
    throw new Error(
      `Invalid environment: ${problems.join("; ")}`
    );
  }

  for (const problem of problems) {
    console.warn(`[env] ${problem}`);
  }

  if (!cloudinaryConfigured()) {
    console.warn(
      "[env] Cloudinary is not configured: image and document uploads are disabled"
    );
  }

  if (!googleConfigured()) {
    console.warn(
      "[env] GOOGLE_CLIENT_ID is not set: Google sign-in is disabled"
    );
  }
};