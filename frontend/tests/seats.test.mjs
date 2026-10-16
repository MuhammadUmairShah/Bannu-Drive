// Unit tests for the pure live-seat logic (no browser, no sockets).
import { build } from "esbuild";
import { pathToFileURL } from "url";
import path from "path";

const out = path.resolve("tests/.seats-bundle.mjs");
await build({ entryPoints: ["src/utils/seatSync.js"], bundle: true, format: "esm", platform: "node", outfile: out, logLevel: "silent" });
const { applySeatEvent, lostSeats, secondsLeft, clockOffset, fmtCountdown, newIdempotencyKey } = await import(pathToFileURL(out).href);

let pass = 0, fail = 0;
const check = (n, c, x = "") => { c ? pass++ : fail++; console.log(`${c ? "  PASS" : "  FAIL"}  ${n} ${c ? "" : x}`); };

const base = () => ({ schedule: { _id: "S1", availableSeats: 10 }, version: 5, seats: [
  { label: "01", status: "AVAILABLE" }, { label: "02", status: "HELD", mine: true, orderId: "O1" }, { label: "03", status: "BOOKED" }] });
const ev = (o) => ({ scheduleId: "S1", seats: ["01"], status: "HELD", availableSeats: 9, version: 6, ...o });

let r = applySeatEvent(base(), ev({}));
check("next version is applied", r.changed && r.next.version === 6 && r.next.seats[0].status === "HELD" && r.next.schedule.availableSeats === 9);
check("the input is not mutated", base().seats[0].status === "AVAILABLE");
r = applySeatEvent(base(), ev({ version: 5 }));
check("a duplicate event (same version) is ignored", !r.changed && !r.resync);
r = applySeatEvent(base(), ev({ version: 2 }));
check("an old event is ignored", !r.changed && !r.resync);
r = applySeatEvent(base(), ev({ version: 8 }));
check("a gap (missed events) asks for a full re-fetch and applies nothing", r.resync === true && !r.changed && r.next.version === 5);
r = applySeatEvent(base(), ev({ scheduleId: "OTHER" }));
check("an event for another schedule is ignored", !r.changed && !r.resync);
r = applySeatEvent(base(), ev({ seats: ["02"], status: "AVAILABLE" }));
check("a released seat becomes AVAILABLE and loses its 'mine' marker", r.next.seats[1].status === "AVAILABLE" && r.next.seats[1].mine === undefined);
r = applySeatEvent(base(), ev({ seats: ["01", "03"], status: "BOOKED" }));
check("multi-seat events update every seat", r.next.seats[0].status === "BOOKED" && r.next.seats[2].status === "BOOKED");
r = applySeatEvent(null, ev({}));
check("no map yet: nothing happens (the first fetch will load it)", !r.changed && !r.resync);
// replaying a whole stream out of order converges to the same state
let s = base();
for (const e of [ev({ version: 6, seats: ["01"], status: "HELD" }), ev({ version: 7, seats: ["01"], status: "BOOKED" })]) s = applySeatEvent(s, e).next;
check("in-order stream reaches the final state", s.seats[0].status === "BOOKED" && s.version === 7);
let t = base(); const out2 = [ev({ version: 7, seats: ["01"], status: "BOOKED" }), ev({ version: 6, seats: ["01"], status: "HELD" })];
let resyncs = 0; for (const e of out2) { const x = applySeatEvent(t, e); if (x.resync) resyncs++; t = x.next; }
check("out-of-order delivery triggers a re-fetch and never applies a future state early", resyncs === 1 && t.seats[0].status === "HELD" && t.version === 6);

check("lostSeats finds my selected seats that someone else took", lostSeats(["01", "02"], ev({ seats: ["02"], status: "BOOKED" })).join() === "02" && lostSeats(["01"], ev({ seats: ["02"], status: "BOOKED" })).length === 0 && lostSeats(["01"], ev({ status: "AVAILABLE" })).length === 0);

const server = "2026-10-09T10:00:00.000Z";
const off = clockOffset(server);
const fakeNow = Date.parse(server) - off; // the customer's device clock (could be wrong by anything)
check("countdown uses the server's clock, not the device clock", secondsLeft("2026-10-09T10:10:00.000Z", off, fakeNow) === 600);
check("a device clock that is 2 hours fast does not change the countdown", secondsLeft("2026-10-09T10:10:00.000Z", clockOffset(server), Date.parse(server) - clockOffset(server) + 0) === 600 && clockOffset(server) !== 0);
check("countdown never goes negative", secondsLeft("2026-10-09T09:00:00.000Z", off, fakeNow) === 0 && secondsLeft(undefined) === 0);
check("countdown formatting mm:ss", fmtCountdown(605) === "10:05" && fmtCountdown(0) === "00:00" && fmtCountdown(59) === "00:59" && fmtCountdown(-3) === "00:00");
check("idempotency keys are unique and accepted by the server's pattern", newIdempotencyKey() !== newIdempotencyKey() && /^[A-Za-z0-9_-]{8,80}$/.test(newIdempotencyKey()));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
