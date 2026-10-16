// ---------------------------------------------------------------------------
// Booking / order lifecycle. EVERY status change goes through these tables, and every write is an atomic
// "update where status is still one of the allowed previous states", so two requests can never both win.
//
//   CREATING ──► HOLD ──► PENDING_PAYMENT ──► CONFIRMED ──► COMPLETED
//                 │  ▲          │  │               │
//                 │  └──────────┘  │ (payment failed: back to HOLD)
//                 ▼                ▼               ▼
//             CANCELLED / EXPIRED (final)      CANCELLED (final)
//   EXPIRED ──► CONFIRMED  only for a late, verified payment whose seats are still free ("late recovery")
// ---------------------------------------------------------------------------
export const SEAT_STATUS = ["HOLD", "PENDING_PAYMENT", "CONFIRMED", "CANCELLED", "EXPIRED", "COMPLETED"];
export const ORDER_STATUS = ["CREATING", ...SEAT_STATUS];

export const HOLDING = ["HOLD", "PENDING_PAYMENT"]; // temporary: seat is reserved until holdExpiresAt
export const OPEN_ORDER = ["CREATING", "HOLD", "PENDING_PAYMENT"]; // order not decided yet
export const SEAT_OCCUPYING = ["HOLD", "PENDING_PAYMENT", "CONFIRMED"]; // statuses that carry an activeSeatKey
export const SOLD = ["CONFIRMED", "COMPLETED"]; // real tickets
export const FINAL = ["CANCELLED", "EXPIRED", "COMPLETED"];

const NEXT = {
  CREATING: ["HOLD", "CANCELLED", "EXPIRED"],
  HOLD: ["PENDING_PAYMENT", "CONFIRMED", "CANCELLED", "EXPIRED"],
  PENDING_PAYMENT: ["CONFIRMED", "HOLD", "CANCELLED", "EXPIRED"],
  CONFIRMED: ["CANCELLED", "COMPLETED"],
  CANCELLED: [],
  EXPIRED: [],
  COMPLETED: []
};
const LATE = { EXPIRED: ["CONFIRMED"] };

export class InvalidTransition extends Error {
  constructor(from, to) {
    super(`Invalid status change ${from} -> ${to}`);
    this.name = "InvalidTransition";
    this.from = from;
    this.to = to;
  }
}

export function canTransition(from, to, { late = false } = {}) {
  if (NEXT[from]?.includes(to)) return true;
  return late && !!LATE[from]?.includes(to);
}

export function assertTransition(from, to, opts) {
  if (!canTransition(from, to, opts)) throw new InvalidTransition(from, to);
}

// The previous states from which `to` may be reached: used as the filter of an atomic update
export function fromStates(to, { late = false } = {}) {
  return Object.keys(NEXT).filter((from) => canTransition(from, to, { late }));
}

export const PAYMENT_STATUS = ["PENDING", "PROCESSING", "PAID", "FAILED", "EXPIRED", "PARTIALLY_REFUNDED", "REFUNDED", "CANCELLED"];
export const ORDER_PAYMENT_STATUS = ["UNPAID", "CASH_DUE", "PENDING", "PAID", "FAILED", "EXPIRED", "REFUND_REQUIRED", "REFUNDED", "CANCELLED"];

// Manual wallet payments (EasyPaisa / JazzCash number + receipt). Provider ids look like "easypaisa_manual".
export const MANUAL_PROVIDERS = ["easypaisa_manual", "jazzcash_manual"];
export const isManualProvider = (id) => MANUAL_PROVIDERS.includes(String(id || ""));
