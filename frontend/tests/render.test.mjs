// Server-side render smoke test for the coach UI components (no browser needed).
import { build } from "esbuild";
import { pathToFileURL } from "url";
import path from "path";
import fs from "fs";

const out = path.resolve("tests/.render-bundle.mjs");
await build({
  stdin: {
    contents: `
      import React from "react";
      import { renderToStaticMarkup } from "react-dom/server";
      import SeatMap from "./src/components/SeatMap.jsx";
      import BookingTicket from "./src/components/BookingTicket.jsx";
      export const render = { React, renderToStaticMarkup, SeatMap, BookingTicket };`,
    resolveDir: process.cwd(), loader: "jsx"
  },
  bundle: true, format: "esm", platform: "node", outfile: out, jsx: "automatic", logLevel: "silent",
  external: ["react", "react-dom", "react-dom/server", "lucide-react", "qrcode", "jsqr", "axios", "socket.io-client", "react-router-dom"]
});

const { render: R } = await import(pathToFileURL(out).href);
let pass = 0, fail = 0;
const check = (n, c, x = "") => { c ? pass++ : fail++; console.log(`${c ? "  PASS" : "  FAIL"}  ${n} ${c ? "" : x}`); };

// 40-seat coach, 10 rows, 2 + 2; seat 03 booked, 05 blocked, 17 selected
const layout = { rows: 10, left: 2, right: 2 };
const seats = [];
for (let n = 1; n <= 40; n++) {
  const row = Math.floor((n - 1) / 4), col = (n - 1) % 4, label = String(n).padStart(2, "0");
  seats.push({ label, row, col, side: col < 2 ? "left" : "right", status: label === "03" ? "BOOKED" : label === "05" ? "BLOCKED" : "AVAILABLE" });
}
const html = R.renderToStaticMarkup(R.React.createElement(R.SeatMap, { layout, seats, selected: ["17"], onToggle() {} }));
const buttons = html.match(/<button[^>]*>/g) || [];
check("renders exactly 40 seat buttons", buttons.length === 40, String(buttons.length));
check("booked seat is disabled", /aria-label="Seat 03, booked"[^>]*disabled|disabled=""[^>]*aria-label="Seat 03, booked"/.test(html) || buttons.find((b) => b.includes("Seat 03")).includes("disabled"));
check("blocked seat is disabled", buttons.find((b) => b.includes("Seat 05")).includes("disabled"));
check("available seat is clickable (not disabled)", !buttons.find((b) => b.includes("Seat 01, available")).includes("disabled"));
check("selected seat reported as pressed", buttons.find((b) => b.includes("Seat 17")).includes('aria-pressed="true"') && buttons.find((b) => b.includes("Seat 17")).includes("selected"));
check("driver / front marker is shown", html.includes("Driver") && html.includes("Front"));
check("legend lists all four states", ["Available", "Selected", "Booked", "Not for sale"].every((t) => html.includes(t)));
check("seats are in rows of 2 + aisle + 2 (10 row containers)", (html.match(/justify-center gap-2/g) || []).length === 10);
const ro = R.renderToStaticMarkup(R.React.createElement(R.SeatMap, { layout, seats, selected: [], readOnly: true }));
check("read-only map disables every seat", (ro.match(/<button[^>]*>/g) || []).every((b) => b.includes("disabled")));
const small = R.renderToStaticMarkup(R.React.createElement(R.SeatMap, { layout: { rows: 3, left: 1, right: 1 }, seats: [0, 1, 2, 3, 4, 5].map((i) => ({ label: String(i + 1).padStart(2, "0"), row: Math.floor(i / 2), col: i % 2, side: i % 2 ? "right" : "left", status: "AVAILABLE" })), selected: [] }));
check("other layouts work (1+1, 3 rows = 6 seats)", (small.match(/<button/g) || []).length === 6);

const booking = { _id: "1", bookingCode: "BD-7K2M9Q", status: "CONFIRMED", seat: "17", fare: 1200, fromCity: "Bannu", toCity: "Peshawar",
  departureAt: "2026-10-03T03:00:00.000Z", arrivalAt: "2026-10-03T07:00:00.000Z", passenger: { name: "Umair Shah", phone: "03451234567" },
  operator: { companyName: "Adil Coaches - DEMO", isDemo: true }, coach: { name: "Adil Express 40 (DEMO)" } };
const t = R.renderToStaticMarkup(R.React.createElement(R.BookingTicket, { booking }));
check("ticket shows brand, booking ID, route", t.includes("Bannu Drive") && t.includes("BD-7K2M9Q") && t.includes("Bannu") && t.includes("Peshawar"));
check("ticket shows operator, passenger, seat, fare, status", t.includes("Adil Coaches - DEMO") && t.includes("Umair Shah") && t.includes(">17<") && /Rs\s?1,200|PKR\s?1,200/.test(t) && t.includes("CONFIRMED"), t.slice(0, 0));
check("ticket shows 08:00 AM departure and 12:00 PM arrival (Pakistan time)", t.includes("08:00 AM") && t.includes("12:00 PM"));
check("demo disclaimer shown (no partnership claim)", t.includes("not an official partner"));
const c = R.renderToStaticMarkup(R.React.createElement(R.BookingTicket, { booking: { ...booking, status: "CANCELLED", cancelledBy: "customer", cancelReason: "Plans changed", operator: { companyName: "X", isDemo: false } } }));
check("cancelled ticket shows who cancelled and why; no demo note", c.includes("CANCELLED") && c.includes("Plans changed") && !c.includes("not an official partner"));

fs.rmSync(out, { force: true });
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
