import crypto from "crypto";
import { PaymentProvider } from "./base.js";
import { isProd } from "../config/env.js";

// SANDBOX ONLY. A fake gateway that behaves like a real one (signed callbacks, status query, refunds) so the whole
// booking/payment flow can be developed and tested without merchant credentials. It never moves real money.
export class MockProvider extends PaymentProvider {
  get id() { return "mock"; }
  get label() { return "Test payment (sandbox)"; }
  // PAYMENT_MOCK_AUTO_REFUND=false simulates a provider that cannot refund by API (refunds then wait for an admin)
  get capabilities() { return { query: true, refund: process.env.PAYMENT_MOCK_AUTO_REFUND !== "false" }; }
  isConfigured() { return true; }

  static secret() {
    // In production the mock needs an explicit secret; in development a fixed one keeps tests simple
    return process.env.PAYMENT_MOCK_SECRET || (isProd() ? crypto.randomBytes(16).toString("hex") : "dev-mock-secret");
  }

  static sign(rawBody) {
    return crypto.createHmac("sha256", MockProvider.secret()).update(rawBody).digest("hex");
  }

  async createCheckout({ payment }) {
    const base = String(process.env.CLIENT_URL || "http://localhost:5173").replace(/\/+$/, "");
    return { kind: "mock", url: `${base}/customer/pay/mock/${payment.providerRef}`, method: "GET" };
  }

  parseCallback({ headers, rawBody }) {
    const sig = String(headers["x-mock-signature"] || "");
    const expected = MockProvider.sign(rawBody || "");
    const ok = sig.length === expected.length && crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected));
    if (!ok) return { valid: false, reason: "bad signature" };

    let body;
    try { body = JSON.parse(rawBody); } catch { return { valid: false, reason: "bad body" }; }
    if (!body.providerRef || !["PAID", "FAILED", "PENDING"].includes(body.status)) return { valid: false, reason: "bad event" };

    return {
      valid: true,
      event: {
        eventId: String(body.eventId || `${body.providerRef}:${body.status}`),
        providerRef: String(body.providerRef),
        providerTxnId: String(body.providerTxnId || `MOCKTXN-${body.providerRef}`),
        status: body.status,
        amount: Number(body.amount)
      }
    };
  }

  // The "gateway" state is stored on the payment by the sandbox-complete endpoint, like a real provider's own record
  async queryStatus(payment) {
    const g = payment.gateway;
    if (!g || g.state === "PENDING") return { eventId: `${payment.providerRef}:query:PENDING`, providerRef: payment.providerRef, status: "PENDING", amount: payment.amount };
    return {
      eventId: `${payment.providerRef}:query:${g.state}`,
      providerRef: payment.providerRef,
      providerTxnId: `MOCKTXN-${payment.providerRef}`,
      status: g.state,
      amount: payment.amount
    };
  }

  async refund({ payment, amount }) {
    return { ok: true, providerRef: `MOCKREFUND-${payment.providerRef}-${amount}-${crypto.randomBytes(3).toString("hex")}` };
  }
}
