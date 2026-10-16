// ---------------------------------------------------------------------------
// Payment provider interface. Booking logic never talks to Easypaisa / JazzCash / a card gateway directly:
// it only knows this interface, so a new provider is one new file + one line in the registry (provider.js).
//
//   createCheckout({ payment, order, callbackUrl }) -> what the browser must do next
//   parseCallback({ headers, rawBody, body, query }) -> verified, normalised event (or { valid:false })
//   queryStatus(payment)                             -> ask the provider (recovers lost callbacks)
//   refund({ payment, amount, reason })              -> money back (optional capability)
//
// A normalised event is { eventId, providerRef, providerTxnId, status: "PAID"|"FAILED"|"PENDING", amount }.
// ---------------------------------------------------------------------------
export class ProviderError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "ProviderError";
    this.code = code;
  }
}

export class PaymentProvider {
  get id() { throw new Error("id not implemented"); }
  get label() { return this.id; }
  get mode() { return "sandbox"; } // "sandbox" | "production"
  get capabilities() { return { query: false, refund: false }; }
  isConfigured() { return false; }
  async createCheckout() { throw new ProviderError("PROVIDER_NOT_AVAILABLE", `${this.label} is not available`); }
  parseCallback() { return { valid: false, reason: "callbacks not supported" }; }
  async queryStatus() { return null; }
  async refund() { throw new ProviderError("REFUND_UNSUPPORTED", `${this.label} refunds are processed manually`); }
}
