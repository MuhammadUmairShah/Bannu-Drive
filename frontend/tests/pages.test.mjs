// SSR smoke test: new pages/components render without throwing (initial/loading state; effects do not run in SSR).
import { build } from "esbuild";
import { pathToFileURL } from "url";
import path from "path";

const out = path.resolve("tests/.pages-bundle.mjs");
await build({
  stdin: {
    contents: `
      import React from "react";
      import { renderToStaticMarkup } from "react-dom/server";
      import { MemoryRouter } from "react-router-dom";
      import { AuthProvider } from "./src/context/AuthContext.jsx";
      import VerificationPanel from "./src/components/verification/VerificationPanel.jsx";
      import AdminVerification from "./src/pages/admin/Verification.jsx";
      import AuditLog from "./src/pages/admin/AuditLog.jsx";
      import GoogleSignInButton from "./src/components/GoogleSignInButton.jsx";
      import Login from "./src/pages/auth/Login.jsx";
      import Register from "./src/pages/auth/Register.jsx";
      import CoachCheckout from "./src/pages/customer/CoachCheckout.jsx";
      import MockPay from "./src/pages/customer/MockPay.jsx";
      import OperatorSeatMap from "./src/pages/operator/OperatorSeatMap.jsx";
      import SeatMap from "./src/components/SeatMap.jsx";
      import ActiveHoldBanner from "./src/components/ActiveHoldBanner.jsx";
      import SyncBadge from "./src/components/SyncBadge.jsx";
      import OperatorScan from "./src/pages/operator/OperatorScan.jsx";
      import BookingTicket from "./src/components/BookingTicket.jsx";
      import { Routes, Route } from "react-router-dom";
      export const R = { React, renderToStaticMarkup, MemoryRouter, AuthProvider, VerificationPanel, AdminVerification, AuditLog, GoogleSignInButton, Login, Register, CoachCheckout, MockPay, OperatorSeatMap, SeatMap, ActiveHoldBanner, SyncBadge, OperatorScan, BookingTicket, Routes, Route };`,
    resolveDir: process.cwd(), loader: "jsx"
  },
  bundle: true, format: "esm", platform: "node", outfile: out, jsx: "automatic", logLevel: "silent",
  define: { "import.meta.env.VITE_API_URL": '"http://api.test"', "import.meta.env.VITE_GOOGLE_CLIENT_ID": '"test.apps.googleusercontent.com"' },
  external: ["react", "react-dom", "react-dom/server", "react-router-dom", "lucide-react", "axios", "socket.io-client", "qrcode", "jsqr"]
});
globalThis.window = Object.assign(new EventTarget(), { location: { pathname: "/" } });
const { R } = await import(pathToFileURL(out).href);
const h = R.React.createElement;
const wrap = (el) => h(R.MemoryRouter, null, h(R.AuthProvider, null, el));

let pass = 0, fail = 0;
const check = (n, f) => { try { const ok = f(); ok ? pass++ : fail++; console.log(`${ok ? "  PASS" : "  FAIL"}  ${n}`); } catch (e) { fail++; console.log(`  FAIL  ${n}: ${e.message}`); } };

check("VerificationPanel renders its loading state", () => R.renderToStaticMarkup(wrap(h(R.VerificationPanel))).includes("Loading"));
check("Admin Verification page renders filters + table shell", () => { const m = R.renderToStaticMarkup(wrap(h(R.AdminVerification))); return m.includes("Verification") && m.includes("Search"); });
check("Audit Log page renders", () => R.renderToStaticMarkup(wrap(h(R.AuditLog))).includes("Audit log"));
check("Google button renders its container when a client id is configured", () => R.renderToStaticMarkup(h(R.GoogleSignInButton, { onSuccess() {} })).includes("min-h-[44px]"));
check("Login shows 'Keep me signed in' and the Google section", () => { const m = R.renderToStaticMarkup(wrap(h(R.Login))); return m.includes("Keep me signed in") && m.includes("Signed up with Google"); });
check("Register (customer) offers Google sign-up", () => R.renderToStaticMarkup(wrap(h(R.Register))).includes("register with email"));

const at = (path, routePath, el) => R.renderToStaticMarkup(h(R.MemoryRouter, { initialEntries: [path] }, h(R.AuthProvider, null, h(R.Routes, null, h(R.Route, { path: routePath, element: el })))));
check("Checkout page renders its loading state", () => at("/customer/checkout/abc", "/customer/checkout/:orderId", h(R.CoachCheckout)).includes("Loading"));
check("Sandbox payment page renders its loading state", () => at("/customer/pay/mock/BD1", "/customer/pay/mock/:ref", h(R.MockPay)).includes("Loading"));
check("Operator seat map page renders its loading state", () => at("/operator/schedules/x/seatmap", "/operator/schedules/:id/seatmap", h(R.OperatorSeatMap)).includes("Loading"));
const layout = { rows: 2, left: 2, right: 2 };
const seats = [{ label: "01", row: 0, side: "left", status: "AVAILABLE" }, { label: "02", row: 0, side: "left", status: "HELD" }, { label: "03", row: 0, side: "right", status: "BOOKED", mine: true }, { label: "04", row: 0, side: "right", status: "BLOCKED" }];
check("Customer seat map shows HELD, yours and blocked states with accessible labels", () => { const m = R.renderToStaticMarkup(h(R.SeatMap, { layout, seats })); return m.includes("Seat 02, held") && m.includes("your booking") && m.includes("Held by someone"); });
check("Operator seat map shows who booked each seat and payment due", () => { const m = R.renderToStaticMarkup(h(R.SeatMap, { operator: true, layout, seats: [{ label: "01", row: 0, side: "left", status: "BOOKED", booking: { passenger: { name: "Ali Khan" }, paymentStatus: "CASH_DUE" } }, { label: "02", row: 0, side: "left", status: "HELD", hold: {} }] })); return m.includes("Ali") && m.includes("payment due") && m.includes(">hold<"); });
check("Connection badge never says Live while reconnecting", () => { const a = R.renderToStaticMarkup(h(R.SyncBadge, { conn: "reconnecting" })); const b = R.renderToStaticMarkup(h(R.SyncBadge, { conn: "live" })); return a.includes("Reconnecting") && a.includes("out of date") && !a.includes(">Live<") && b.includes("Live"); });
check("Hold banner renders nothing until holds are loaded", () => R.renderToStaticMarkup(wrap(h(R.ActiveHoldBanner))) === "");

check("Scanner page renders camera controls, manual code fallback and trip selector", () => { const m = R.renderToStaticMarkup(wrap(h(R.OperatorScan))); return m.includes("Start camera") && m.includes("Booking code") && m.includes("Trip you are boarding"); });
const tk = { _id: "1", bookingCode: "BD-ABC123", status: "CONFIRMED", fromCity: "Bannu", toCity: "Islamabad", departureAt: "2026-11-01T05:00:00Z", arrivalAt: "2026-11-01T13:00:00Z", passenger: { name: "Ali", phone: "03001234567" }, seat: "05", fare: 1500, paymentMethod: "CASH", paymentStatus: "CASH_DUE", qrPayload: "BD1." + "A".repeat(32), createdAt: "2026-10-10T05:00:00Z", checkInStatus: "BOARDED", boardedAt: "2026-11-01T04:50:00Z", operator: { companyName: "Alpha" } };
check("Ticket shows QR area, print button, issue time, boarded state and payment", () => { const m = R.renderToStaticMarkup(h(R.BookingTicket, { booking: tk })); return m.includes("Show this at boarding") && m.includes("Print / save as PDF") && m.includes("Issued") && m.includes("Boarded") && m.includes("Cash") && m.includes("print-area"); });
check("A cancelled ticket shows no QR and no print button", () => { const m = R.renderToStaticMarkup(h(R.BookingTicket, { booking: { ...tk, status: "CANCELLED" } })); return !m.includes("Show this at boarding") && !m.includes("Print / save"); });

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
