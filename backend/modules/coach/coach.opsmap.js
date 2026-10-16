import { CoachBooking } from "./coach.model.js";
import { buildSeats, sellableSeats } from "./coach.service.js";
import { cfg } from "./coach.config.js";
import { HOLDING } from "./coach.states.js";

// ---------------------------------------------------------------------------
// The detailed seat map for the OWNING operator (or an admin). Passenger data appears ONLY here and only for
// real tickets. A held seat reveals nothing about who holds it. Callers must check ownership BEFORE calling.
// ---------------------------------------------------------------------------
export async function operatorSeatMap(schedule, now = new Date()) {
  const rows = await CoachBooking.find({
    schedule: schedule._id,
    $or: [
      { status: { $in: ["CONFIRMED", "COMPLETED"] } },
      { status: { $in: HOLDING }, holdExpiresAt: { $gt: new Date(now.getTime() - cfg.graceMs()) } }
    ]
  }).sort({ seat: 1 });
  const bySeat = new Map(rows.map((b) => [b.seat, b]));

  let booked = 0, held = 0, blocked = 0, revenue = 0, collected = 0, cashDue = 0;

  const seats = buildSeats(schedule.layout).map((s) => {
    const b = bySeat.get(s.label);
    const base = { label: s.label, row: s.row, col: s.col, side: s.side };

    if (s.blocked) { blocked += 1; return { ...base, status: "BLOCKED" }; }
    if (!b) return { ...base, status: "AVAILABLE" };

    if (HOLDING.includes(b.status)) {
      held += 1;
      return {
        ...base, status: "HELD",
        hold: { state: b.status, until: b.holdExpiresAt, secondsLeft: Math.max(0, Math.round((b.holdExpiresAt - now) / 1000)) } // no identity
      };
    }

    booked += 1;
    revenue += b.fare;
    if (b.paymentStatus === "PAID") collected += b.fare;
    if (b.paymentStatus === "CASH_DUE") cashDue += b.fare;
    return {
      ...base, status: "BOOKED",
      booking: {
        _id: b._id, bookingCode: b.bookingCode, status: b.status, fare: b.fare,
        passenger: { name: b.passenger.name, phone: b.passenger.phone, gender: b.passenger.gender },
        paymentMethod: b.paymentMethod, paymentStatus: b.paymentStatus,
        bookedAt: b.confirmedAt || b.createdAt, cashCollectedAt: b.cashCollectedAt
      }
    };
  });

  const sellable = sellableSeats(schedule.layout);
  return {
    seats,
    layout: { rows: schedule.layout.rows, left: schedule.layout.left, right: schedule.layout.right },
    summary: {
      totalSeats: schedule.layout.rows * (schedule.layout.left + schedule.layout.right),
      sellable, booked, held, blocked,
      available: Math.max(0, sellable - booked - held),
      occupancyPct: sellable ? Math.round((booked / sellable) * 100) : 0,
      revenue, collected, cashDue
    },
    version: schedule.seatVersion || 0,
    serverTime: now
  };
}
