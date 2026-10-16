// Pure helpers for live seat maps. No React, no sockets: easy to test.

// Applies ONE realtime seat event to the last known map.
//   - an event we already have (or older)            -> ignored
//   - exactly the next version                       -> applied
//   - a gap (we missed at least one event)           -> NOT applied, caller must re-fetch from the server
// The server is always the source of truth: a re-fetch fixes anything this function cannot know.
export function applySeatEvent(data, ev) {
  if (!data || !ev || String(ev.scheduleId) !== String(data.schedule?._id)) return { next: data, resync: false, changed: false };

  const known = Number(data.version) || 0;
  if (ev.version <= known) return { next: data, resync: false, changed: false }; // duplicate / stale
  if (ev.version > known + 1) return { next: data, resync: true, changed: false }; // we missed something

  const touched = new Set(ev.seats || []);
  const seats = data.seats.map((s) => {
    if (!touched.has(s.label)) return s;
    const { mine, orderId, ...rest } = s; // ownership is unknown from a public event; the next fetch restores it
    return ev.status === 'AVAILABLE' ? { ...rest, status: 'AVAILABLE' } : { ...rest, status: ev.status };
  });

  return {
    next: { ...data, seats, version: ev.version, schedule: { ...data.schedule, availableSeats: ev.availableSeats ?? data.schedule?.availableSeats } },
    resync: false,
    changed: true
  };
}

// Seats of mine (the selection) that another customer just took
export function lostSeats(selected, ev) {
  if (!ev || (ev.status !== 'BOOKED' && ev.status !== 'HELD')) return [];
  return selected.filter((label) => (ev.seats || []).includes(label));
}

// ---- countdowns that use the SERVER clock, never the customer's device clock ----
export const clockOffset = (serverTime) => (serverTime ? Date.parse(serverTime) - Date.now() : 0);

export function secondsLeft(expiresAt, offsetMs = 0, nowMs = Date.now()) {
  if (!expiresAt) return 0;
  return Math.max(0, Math.floor((Date.parse(expiresAt) - (nowMs + offsetMs)) / 1000));
}

export function fmtCountdown(totalSeconds) {
  const s = Math.max(0, Math.floor(totalSeconds));
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
}

// A fresh key per checkout attempt; reused when the SAME attempt is retried after a network failure.
export function newIdempotencyKey() {
  return globalThis.crypto?.randomUUID ? globalThis.crypto.randomUUID() : `k${Date.now().toString(36)}${Math.random().toString(36).slice(2, 12)}`;
}
