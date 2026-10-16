import crypto from "crypto";
import { PaymentProvider, ProviderError } from "./base.js";

// ---------------------------------------------------------------------------
// JazzCash hosted checkout (page redirection / "Mobile Wallet & Card" form post).
//
// STATUS: implemented from JazzCash's public integration description; NOT yet verified against the real
// sandbox. It stays disabled until ALL of these are set AND you have run a sandbox transaction with your own
// merchant account:  JAZZCASH_MERCHANT_ID, JAZZCASH_PASSWORD, JAZZCASH_INTEGRITY_SALT.
// Optional: JAZZCASH_ENDPOINT (default = JazzCash sandbox), JAZZCASH_MODE=production.
// Treat field names / response codes below as a starting point to confirm with JazzCash's documentation.
// ---------------------------------------------------------------------------
const SANDBOX_URL = "https://sandbox.jazzcash.com.pk/CustomerPortal/transactionmanagement/merchantform/";

// Time in Pakistan (UTC+5) as yyyyMMddHHmmss
function pkt(date) {
  const d = new Date(date.getTime() + 5 * 3600 * 1000);
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getUTCFullYear()}${p(d.getUTCMonth() + 1)}${p(d.getUTCDate())}${p(d.getUTCHours())}${p(d.getUTCMinutes())}${p(d.getUTCSeconds())}`;
}

export class JazzCashProvider extends PaymentProvider {
  get id() { return "jazzcash"; }
  get label() { return "JazzCash"; }
  get mode() { return process.env.JAZZCASH_MODE === "production" ? "production" : "sandbox"; }
  isConfigured() {
    return Boolean(process.env.JAZZCASH_MERCHANT_ID && process.env.JAZZCASH_PASSWORD && process.env.JAZZCASH_INTEGRITY_SALT);
  }

  // HMAC-SHA256 over  salt & (all non-empty pp_* values ordered by field name)  keyed with the salt, upper-case hex
  static secureHash(fields, salt) {
    const parts = Object.keys(fields)
      .filter((k) => k.startsWith("pp_") && k !== "pp_SecureHash" && fields[k] !== "" && fields[k] != null)
      .sort()
      .map((k) => String(fields[k]));
    return crypto.createHmac("sha256", salt).update([salt, ...parts].join("&")).digest("hex").toUpperCase();
  }

  async createCheckout({ payment, order, callbackUrl }) {
    if (!this.isConfigured()) throw new ProviderError("PROVIDER_NOT_AVAILABLE", "JazzCash is not configured");

    const now = new Date();
    const fields = {
      pp_Version: "1.1",
      pp_TxnType: "MWALLET",
      pp_Language: "EN",
      pp_MerchantID: process.env.JAZZCASH_MERCHANT_ID,
      pp_Password: process.env.JAZZCASH_PASSWORD,
      pp_TxnRefNo: payment.providerRef,
      pp_Amount: String(Math.round(payment.amount * 100)), // paisa
      pp_TxnCurrency: "PKR",
      pp_TxnDateTime: pkt(now),
      pp_BillReference: String(order.orderCode).replace(/[^A-Za-z0-9]/g, ""),
      pp_Description: "Bannu Drive coach booking",
      pp_TxnExpiryDateTime: pkt(payment.expiresAt),
      pp_ReturnURL: callbackUrl
    };
    fields.pp_SecureHash = JazzCashProvider.secureHash(fields, process.env.JAZZCASH_INTEGRITY_SALT);

    return { kind: "form", url: process.env.JAZZCASH_ENDPOINT || SANDBOX_URL, method: "POST", fields };
  }

  // JazzCash posts the result through the customer's browser to pp_ReturnURL (form-encoded)
  parseCallback({ body }) {
    if (!this.isConfigured()) return { valid: false, reason: "not configured" };
    const b = body || {};
    const given = String(b.pp_SecureHash || "").toUpperCase();
    const expected = JazzCashProvider.secureHash(b, process.env.JAZZCASH_INTEGRITY_SALT);
    const ok = given.length === expected.length && crypto.timingSafeEqual(Buffer.from(given), Buffer.from(expected));
    if (!ok) return { valid: false, reason: "bad signature" };
    if (!b.pp_TxnRefNo) return { valid: false, reason: "no reference" };

    // Only "000" is success. Anything else is reported as PENDING (never as a hard failure) because a wrong guess
    // would reopen the seat while money may still arrive; the hold simply expires and late payments are recovered.
    const status = b.pp_ResponseCode === "000" ? "PAID" : "PENDING";
    return {
      valid: true,
      event: {
        eventId: `${b.pp_TxnRefNo}:${b.pp_RetreivalReferenceNo || b.pp_ResponseCode}`,
        providerRef: String(b.pp_TxnRefNo),
        providerTxnId: String(b.pp_RetreivalReferenceNo || ""),
        status,
        amount: Number(b.pp_Amount) / 100
      }
    };
  }
}
