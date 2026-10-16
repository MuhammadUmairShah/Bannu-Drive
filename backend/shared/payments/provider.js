// Provider registry: which payment providers exist and which are enabled + configured right now.
// To add a provider: create <name>.provider.js extending PaymentProvider (base.js), add it to `instances`,
// then list it in PAYMENT_PROVIDERS. Nothing in the booking code changes.
export { PaymentProvider, ProviderError } from "./base.js";

// ---------------- registry ----------------
import { MockProvider } from "./mock.provider.js";
import { JazzCashProvider } from "./jazzcash.provider.js";
import { EasypaisaProvider } from "./easypaisa.provider.js";
import { isProd } from "../config/env.js";

const instances = {
  mock: new MockProvider(),
  jazzcash: new JazzCashProvider(),
  easypaisa: new EasypaisaProvider()
};

// PAYMENT_PROVIDERS=jazzcash,easypaisa  (default: "mock" outside production, nothing in production)
function enabledIds() {
  const raw = process.env.PAYMENT_PROVIDERS;
  const ids = raw === undefined ? (isProd() ? [] : ["mock"]) : raw.split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);
  // The mock gateway can never be switched on in production by accident
  return ids.filter((id) => id !== "mock" || !isProd() || process.env.PAYMENT_MOCK_ENABLED === "true");
}

export const getProvider = (id) => instances[String(id || "").toLowerCase()] || null;

// Providers a customer may pay with right now (enabled AND fully configured)
export function listPaymentOptions() {
  return enabledIds()
    .map((id) => instances[id])
    .filter((p) => p && p.isConfigured())
    .map((p) => ({ id: p.id, label: p.label, mode: p.mode, capabilities: p.capabilities }));
}

export const isProviderUsable = (id) => listPaymentOptions().some((p) => p.id === String(id).toLowerCase());
