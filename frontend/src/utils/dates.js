// Pakistan has no daylight saving; coach times are shown in the operating timezone (+05:00).
// Change TZ_OFFSET_HOURS (and the backend COACH_TIMEZONE_OFFSET) to operate in another country.
export const TZ_OFFSET_HOURS = 5;

const shifted = (d) => new Date(new Date(d).getTime() + TZ_OFFSET_HOURS * 3600e3);

export const fmtTime = (d) => {
  const t = shifted(d);
  const h = t.getUTCHours();
  return `${String(h % 12 || 12).padStart(2, '0')}:${String(t.getUTCMinutes()).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}`;
};

export const fmtDate = (d) => {
  const t = shifted(d);
  return `${['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][t.getUTCDay()]}, ${t.getUTCDate()} ${['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][t.getUTCMonth()]} ${t.getUTCFullYear()}`;
};

export const fmtDateTime = (d) => `${fmtDate(d)}, ${fmtTime(d)}`;

// YYYY-MM-DD for "today + n days" in the operating timezone
export const dayString = (offsetDays = 0) => new Date(Date.now() + TZ_OFFSET_HOURS * 3600e3 + offsetDays * 86400e3).toISOString().slice(0, 10);

// Local "YYYY-MM-DD" + "HH:MM" -> ISO instant
export const toIso = (day, hhmm) => new Date(`${day}T${hhmm}:00+0${TZ_OFFSET_HOURS}:00`).toISOString();

export const duration = (from, to) => {
  const mins = Math.round((new Date(to) - new Date(from)) / 60000);
  return `${Math.floor(mins / 60)}h ${String(mins % 60).padStart(2, '0')}m`;
};
