// All tunables, read lazily so tests and ops can change them without a code change.
const num = (key, fallback) => {
  const v = Number(process.env[key]);
  return Number.isFinite(v) && v > 0 ? v : fallback;
};

export const cfg = {
  holdMs: () => num("SEAT_HOLD_MINUTES", 10) * 60000, // how long seats are held while the customer fills in details
  paymentWindowMs: () => num("PAYMENT_WINDOW_MINUTES", 15) * 60000, // time allowed to finish an online payment
  maxHoldTotalMs: () => num("MAX_HOLD_TOTAL_MINUTES", 30) * 60000, // absolute cap, however often it is extended
  maxExtensions: () => Math.floor(num("HOLD_MAX_EXTENSIONS", 1)),
  creatingTimeoutMs: () => num("HOLD_CREATING_TIMEOUT_SECONDS", 45) * 1000, // a half-created order heals itself after this
  // A hold can be CONFIRMED until holdExpiresAt, and TAKEN by someone else only after holdExpiresAt + grace.
  // The gap makes it impossible for a confirmation and a takeover to both succeed.
  graceMs: () => num("HOLD_EXPIRY_GRACE_SECONDS", 3) * 1000,
  maxOpenOrders: () => Math.floor(num("MAX_OPEN_HOLD_ORDERS", 2)), // anti seat-hoarding
  maxSeatsPerTrip: () => Math.floor(num("MAX_SEATS_PER_TRIP_PER_CUSTOMER", 6)),
  manualEnabled: () => process.env.MANUAL_PAYMENT_ENABLED !== "false",
  manualVerifyMs: () => num("MANUAL_VERIFY_MINUTES", 60) * 60000, // how long seats stay held while the operator checks the receipt
  receiptMaxBytes: () => Math.floor(num("RECEIPT_MAX_MB", 2) * 1024 * 1024),
  cashEnabled: () => process.env.CASH_PAYMENT_ENABLED !== "false",
  cashMaxUnpaid: () => Math.floor(num("CASH_MAX_UNPAID_ORDERS", 3)), // anti no-show hoarding
  retentionMs: () => num("EXPIRED_RETENTION_DAYS", 90) * 86400000,
  failedAttemptRetentionMs: () => 7 * 86400000,
  customerRefundPercent: () => Math.min(100, Math.max(0, Number(process.env.CUSTOMER_REFUND_PERCENT ?? 100))),
  sweepIntervalMs: () => num("HOLD_SWEEP_SECONDS", 15) * 1000
};
