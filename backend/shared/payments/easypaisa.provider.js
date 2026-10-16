import { PaymentProvider } from "./base.js";

// Easypaisa (Easypay hosted checkout) is NOT implemented yet. It needs the merchant integration document and
// sandbox store credentials from Telenor Microfinance Bank, and guessing the signing scheme would be worse than
// having none. The class exists so the registry, the admin UI and the booking code already treat it as a normal
// provider: implement createCheckout / parseCallback here, then add EASYPAISA_* env vars and list it in PAYMENT_PROVIDERS.
export class EasypaisaProvider extends PaymentProvider {
  get id() { return "easypaisa"; }
  get label() { return "Easypaisa"; }
  isConfigured() { return false; }
}
