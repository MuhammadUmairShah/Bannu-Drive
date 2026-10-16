import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import {
  Bus,
  Search,
  ArrowRight,
  Armchair,
  Clock,
  RefreshCw,
  MapPin,
  CalendarDays,
  Snowflake,
  Wifi,
} from "lucide-react";

import Navbar from "./Navbar";
import Footer from "./Footer";

import api from "../../utils/api";
import { getErrorMessage } from "../../utils/errors";
import { formatCurrency } from "../../utils/formatters";
import { fmtTime, dayString, duration } from "../../utils/dates";
import { toast } from "../../utils/toast";

const LOW_SEATS_LIMIT = 5;
const DATE_STRIP_DAYS = 7; // quick date buttons: today + next 6 days
const AUTO_FIND_DAYS = 3; // on first load, look at today, tomorrow, day after until some coaches are found
const MAX_ROUTES = 30; // safety limit on how many routes are searched at once

const normalize = (value) => (value || "").trim().toLowerCase();

const dateChipLabel = (offset) => {
  if (offset === 0) return "Today";
  if (offset === 1) return "Tomorrow";
  return new Date(`${dayString(offset)}T00:00:00`).toLocaleDateString("en-GB", {
    weekday: "short",
    day: "numeric",
    month: "short",
  });
};

/* ------------------------------------------------------------
   Reusable pieces
------------------------------------------------------------ */

function CityInput({ label, icon: Icon, ...inputProps }) {
  return (
    <label className="text-xs font-semibold text-fg">
      <span className="mb-1 block">{label}</span>
      <div className="relative">
        <Icon className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" />
        <input
          autoComplete="off"
          className="field w-full pl-10"
          {...inputProps}
        />
      </div>
    </label>
  );
}

function CoachCard({ schedule }) {
  const { coach, operator } = schedule;
  const amenities = coach?.amenities || [];

  const available = Number(schedule.availableSeats || 0);
  const total = Number(schedule.totalSeats || 0);
  const lowSeats = available > 0 && available <= LOW_SEATS_LIMIT;
  const canBook = schedule.bookable && available > 0;

  return (
    <article className="card overflow-hidden rounded-2xl transition hover:-translate-y-0.5 hover:shadow-lg">
      <div className="p-5 sm:p-6">
        <div className="flex flex-col gap-6 lg:flex-row lg:items-center">
          {/* Operator + times */}
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-3">
              <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-primary/10">
                <Bus className="h-6 w-6 text-link" />
              </div>

              <div>
                <h3 className="font-bold text-fg">
                  {operator?.companyName || "Bannu Drive Operator"}
                </h3>
                <p className="text-xs capitalize text-muted">
                  {coach?.name || "Coach"} • {coach?.type || "standard"}
                </p>
              </div>

              <span className="rounded-full bg-emerald-500/10 px-2.5 py-1 text-[10px] font-bold text-emerald-600">
                ACTIVE
              </span>

              {operator?.isDemo && (
                <span className="rounded-full bg-warning-soft px-2.5 py-1 text-[10px] font-bold text-warning">
                  DEMO
                </span>
              )}
            </div>

            <div className="mt-5 flex items-center gap-3">
              <div>
                <p className="text-2xl font-black text-fg">
                  {fmtTime(schedule.departureAt)}
                </p>
                <p className="text-xs text-muted">{schedule.fromCity}</p>
              </div>

              <div className="flex min-w-[70px] flex-1 flex-col items-center text-subtle">
                <div className="flex items-center gap-1">
                  <span className="h-px w-5 bg-line" />
                  <Clock className="h-4 w-4" />
                  <span className="h-px w-5 bg-line" />
                </div>
                <span className="mt-1 text-[11px]">
                  {duration(schedule.departureAt, schedule.arrivalAt)}
                </span>
              </div>

              <div className="text-right">
                <p className="text-2xl font-black text-fg">
                  {fmtTime(schedule.arrivalAt)}
                </p>
                <p className="text-xs text-muted">{schedule.toCity}</p>
              </div>
            </div>
          </div>

          {/* Details */}
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:w-[360px]">
            <div className="rounded-xl bg-surface-2 p-3">
              <Armchair className="mb-1 h-4 w-4 text-link" />
              <p className="text-[10px] text-muted">Seats</p>
              <p
                className={`text-sm font-bold ${
                  lowSeats ? "text-danger" : "text-fg"
                }`}
              >
                {available}/{total}
              </p>
            </div>

            <div className="rounded-xl bg-surface-2 p-3">
              <p className="mb-1 text-lg font-black text-link">Rs</p>
              <p className="text-[10px] text-muted">Fare / Seat</p>
              <p className="text-sm font-bold text-fg">
                {formatCurrency(schedule.fare)}
              </p>
            </div>

            <div className="rounded-xl bg-surface-2 p-3">
              <div className="mb-1 flex gap-1">
                {amenities.includes("AC") && (
                  <Snowflake className="h-4 w-4 text-link" />
                )}
                {amenities.includes("WiFi") && (
                  <Wifi className="h-4 w-4 text-link" />
                )}
                {!amenities.length && <Bus className="h-4 w-4 text-link" />}
              </div>
              <p className="text-[10px] text-muted">Coach</p>
              <p className="truncate text-sm font-bold capitalize text-fg">
                {coach?.type || "Standard"}
              </p>
            </div>
          </div>

          {/* Action */}
          <div className="flex shrink-0 flex-col gap-2 lg:w-32">
            {canBook ? (
              <Link
                to={`/customer/intercity/${schedule._id}`}
                className="btn btn-primary w-full"
              >
                View Seats
                <ArrowRight className="h-4 w-4" />
              </Link>
            ) : (
              <span className="rounded-xl bg-surface-2 px-4 py-3 text-center text-sm font-semibold text-muted">
                {available === 0 ? "Sold Out" : "Booking Closed"}
              </span>
            )}

            {lowSeats && (
              <p className="text-center text-[10px] font-semibold text-danger">
                Only {available} seats left
              </p>
            )}
          </div>
        </div>

        {/* Amenities */}
        {amenities.length > 0 && (
          <div className="mt-5 flex flex-wrap gap-2 border-t border-line pt-4">
            {amenities.map((amenity) => (
              <span
                key={amenity}
                className="rounded-full border border-line px-2.5 py-1 text-[11px] font-medium text-muted"
              >
                {amenity}
              </span>
            ))}
          </div>
        )}
      </div>
    </article>
  );
}

/* ------------------------------------------------------------
   Data helpers
------------------------------------------------------------ */

// The public search API needs From + To + date, so we search every route once for the chosen date
// and merge the answers. Returns { schedules, failed, total }.
async function fetchDepartures(pairs, date) {
  const routes = [
    ...new Map(
      (Array.isArray(pairs) ? pairs : [])
        .filter((p) => p?.from?.trim() && p?.to?.trim())
        .map((p) => [`${normalize(p.from)}|${normalize(p.to)}`, { from: p.from.trim(), to: p.to.trim() }])
    ).values(),
  ].slice(0, MAX_ROUTES);

  if (!routes.length) return { schedules: [], failed: 0, total: 0 };

  const responses = await Promise.allSettled(
    routes.map((route) => api.get("/coach/public/search", { params: { from: route.from, to: route.to, date } }))
  );

  const schedules = responses.flatMap((r) =>
    r.status === "fulfilled" && r.value?.data?.success ? r.value.data.schedules || [] : []
  );
  const failed = responses.filter((r) => r.status === "rejected").length;

  const unique = [...new Map(schedules.map((s) => [s._id, s])).values()].sort(
    (a, b) => new Date(a.departureAt) - new Date(b.departureAt)
  );

  return { schedules: unique, failed, total: routes.length };
}

/* ------------------------------------------------------------
   Page
------------------------------------------------------------ */

export default function CoachesPage() {
  // From / To are optional filters: empty means "show every active coach"
  const [form, setForm] = useState({ from: "", to: "", date: dayString(0) });

  const [cities, setCities] = useState({ from: [], to: [], pairs: [] });
  const [results, setResults] = useState([]);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const requestId = useRef(0); // ignore answers that arrive after a newer request

  // Load all active departures for one date
  const loadForDate = useCallback(async (pairs, date) => {
    const id = ++requestId.current;
    try {
      setLoading(true);
      setError("");
      const { schedules, failed, total } = await fetchDepartures(pairs, date);
      if (id !== requestId.current) return schedules;
      if (total > 0 && failed === total) throw new Error("All route searches failed");
      setResults(schedules);
      return schedules;
    } catch (err) {
      if (id === requestId.current) {
        console.error("Active coaches error:", err);
        setError(getErrorMessage(err, "Could not load available coaches."));
        setResults([]);
      }
      return [];
    } finally {
      if (id === requestId.current) setLoading(false);
    }
  }, []);

  // First load: cities, then the first day (today, tomorrow, ...) that has active coaches
  const loadInitial = useCallback(async () => {
    try {
      setLoading(true);
      setError("");

      const res = await api.get("/coach/public/cities");
      if (!res.data?.success) { setResults([]); setLoading(false); return; }

      const next = { from: res.data.from || [], to: res.data.to || [], pairs: res.data.pairs || [] };
      setCities(next);

      for (let offset = 0; offset < AUTO_FIND_DAYS; offset += 1) {
        const date = dayString(offset);
        const found = await loadForDate(next.pairs, date);
        if (found.length > 0 || offset === AUTO_FIND_DAYS - 1) {
          setForm((f) => ({ ...f, date }));
          return;
        }
      }
    } catch (err) {
      console.error("Cities error:", err);
      setError(getErrorMessage(err, "Could not load available coaches."));
      setResults([]);
      setLoading(false);
    }
  }, [loadForDate]);

  useEffect(() => { loadInitial(); }, [loadInitial]);

  const set = (key) => (event) => setForm((current) => ({ ...current, [key]: event.target.value }));

  function changeDate(date) {
    if (!date) return;
    setForm((f) => ({ ...f, date }));
    loadForDate(cities.pairs, date);
  }

  function handleSubmit(event) {
    event.preventDefault();
    const from = form.from.trim();
    const to = form.to.trim();
    if (from && to && normalize(from) === normalize(to)) {
      toast.error("From and To cities must be different.");
      return;
    }
    loadForDate(cities.pairs, form.date); // refresh; the From / To boxes filter the list as you type
  }

  const handleRetry = () => (cities.pairs.length ? loadForDate(cities.pairs, form.date) : loadInitial());

  // From / To boxes filter the loaded coaches as you type
  const fromFilter = normalize(form.from);
  const toFilter = normalize(form.to);
  const filtering = !!(fromFilter || toFilter);

  const visible = useMemo(
    () => results.filter((s) =>
      (!fromFilter || normalize(s.fromCity).includes(fromFilter)) &&
      (!toFilter || normalize(s.toCity).includes(toFilter))
    ),
    [results, fromFilter, toFilter]
  );

  // Destinations to suggest (narrowed by the From box when something is typed)
  const popularCities = useMemo(() => {
    const pairs = fromFilter ? cities.pairs.filter((p) => normalize(p.from).includes(fromFilter)) : cities.pairs;
    return [...new Set(pairs.map((p) => p.to).filter(Boolean))];
  }, [cities.pairs, fromFilter]);

  return (
    <div className="min-h-screen bg-bg text-fg">
      <Navbar />

      {/* Hero */}
      <section className="relative overflow-hidden bg-navy pt-32 pb-24 text-white">
        <div className="absolute inset-0 bg-gradient-to-br from-brand/20 via-transparent to-mint/10" />
        <div className="absolute -right-32 -top-32 h-96 w-96 rounded-full bg-mint/10 blur-3xl" />
        <div className="absolute -left-32 bottom-0 h-80 w-80 rounded-full bg-brand/10 blur-3xl" />

        <div className="relative mx-auto max-w-7xl px-5 sm:px-6 lg:px-8">
          <div className="max-w-4xl">
            <div className="mb-6 inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-4 py-2 text-sm font-medium backdrop-blur">
              <Bus className="h-4 w-4 text-mint" />
              Bannu Drive Intercity
            </div>

            <h1 className="text-4xl font-black tracking-tight sm:text-5xl lg:text-6xl">
              Travel between cities with
              <span className="block text-mint">Bannu Drive Coaches.</span>
            </h1>

            <p className="mt-6 max-w-2xl text-base leading-7 text-white/70 sm:text-lg">
              Find active buses and coaches, compare departure times, check
              available seats and choose the journey that suits you.
            </p>
          </div>
        </div>
      </section>

      {/* Search box */}
      <section className="relative z-10 mx-auto -mt-10 max-w-6xl px-5 sm:px-6 lg:px-8">
        <form onSubmit={handleSubmit} className="card rounded-2xl border border-line p-5 shadow-xl sm:p-6">
          <div className="mb-5 flex items-center gap-2">
            <Search className="h-5 w-5 text-link" />
            <h2 className="font-bold text-fg">Find a Bus / Coach</h2>
          </div>

          <div className="grid gap-4 lg:grid-cols-[1fr_1fr_180px_auto] lg:items-end">
            <CityInput label="From (optional)" icon={MapPin} list="coach-from-cities" value={form.from} onChange={set("from")} placeholder="Any city" />
            <CityInput label="To (optional)" icon={MapPin} list="coach-to-cities" value={form.to} onChange={set("to")} placeholder="Any city" />
            <CityInput label="Travel Date" icon={CalendarDays} type="date" value={form.date} min={dayString(0)} onChange={(e) => changeDate(e.target.value)} />

            <button type="submit" disabled={loading} className="btn btn-primary min-h-[46px] px-6 disabled:cursor-not-allowed disabled:opacity-60">
              {loading ? <RefreshCw className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
              {loading ? "Loading..." : "Refresh"}
            </button>
          </div>

          <datalist id="coach-from-cities">{cities.from.map((city) => <option key={city} value={city} />)}</datalist>
          <datalist id="coach-to-cities">{cities.to.map((city) => <option key={city} value={city} />)}</datalist>

          {/* Quick date buttons */}
          <div className="mt-4 flex gap-2 overflow-x-auto pb-1" role="group" aria-label="Choose a travel date">
            {Array.from({ length: DATE_STRIP_DAYS }, (_, i) => dayString(i)).map((d, i) => (
              <button
                key={d}
                type="button"
                onClick={() => changeDate(d)}
                aria-pressed={form.date === d}
                className={`shrink-0 rounded-full border px-3 py-1.5 text-xs font-semibold transition ${
                  form.date === d ? "border-primary bg-primary-soft text-link" : "border-line text-fg hover:border-primary hover:text-link"
                }`}
              >
                {dateChipLabel(i)}
              </button>
            ))}
          </div>

          {/* Popular destinations */}
          {popularCities.length > 0 && !form.to && (
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <span className="text-xs text-muted">Destinations{form.from ? ` from ${form.from}` : ""}:</span>
              {popularCities.map((city) => (
                <button
                  key={city}
                  type="button"
                  onClick={() => setForm((f) => ({ ...f, to: city }))}
                  className="rounded-full border border-line px-3 py-1.5 text-xs font-medium text-fg transition hover:border-primary hover:text-link"
                >
                  {city}
                </button>
              ))}
            </div>
          )}

          {filtering && (
            <button type="button" onClick={() => setForm((f) => ({ ...f, from: "", to: "" }))} className="mt-3 text-xs font-semibold text-link">
              Clear From / To and show all coaches
            </button>
          )}
        </form>
      </section>

      {/* Active coaches */}
      <section className="mx-auto max-w-6xl px-5 py-14 sm:px-6 lg:px-8">
        <div className="mb-7 flex flex-wrap items-end justify-between gap-3">
          <div>
            <div className="flex items-center gap-2">
              <span className="h-2 w-2 animate-pulse rounded-full bg-emerald-500" />
              <p className="text-xs font-bold uppercase tracking-wider text-link">Active Coaches</p>
            </div>

            <h2 className="mt-2 text-2xl font-black text-fg sm:text-3xl">Available Buses & Coaches</h2>

            <p className="mt-1 text-sm text-muted">
              Active departures on {new Date(`${form.date}T00:00:00`).toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long" })}.
            </p>
          </div>

          {!loading && visible.length > 0 && (
            <span className="rounded-full bg-primary/10 px-3 py-1.5 text-xs font-semibold text-link">
              {visible.length} departure{visible.length === 1 ? "" : "s"}
            </span>
          )}
        </div>

        {/* Loading */}
        {loading && (
          <div className="py-16 text-center">
            <RefreshCw className="mx-auto mb-3 h-7 w-7 animate-spin text-link" />
            <p className="text-sm font-semibold text-fg">Loading active coaches...</p>
            <p className="mt-1 text-xs text-muted">Finding available buses and coaches.</p>
          </div>
        )}

        {/* Error */}
        {error && !loading && (
          <div className="rounded-2xl border border-danger/30 bg-danger-soft p-5">
            <p className="text-sm font-semibold text-danger">{error}</p>
            <button type="button" onClick={handleRetry} className="mt-3 rounded-xl bg-fg px-4 py-2 text-xs font-semibold text-bg transition hover:bg-primary hover:text-on-primary">
              Try Again
            </button>
          </div>
        )}

        {/* Empty */}
        {!loading && !error && visible.length === 0 && (
          <div className="card rounded-2xl p-12 text-center">
            <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-primary/10">
              <Bus className="h-8 w-8 text-link" />
            </div>
            <h3 className="text-lg font-bold text-fg">{filtering ? "No coaches match your search" : "No active coaches on this date"}</h3>
            <p className="mx-auto mt-2 max-w-md text-sm text-muted">
              {filtering
                ? "Try a different city, clear the From / To boxes, or pick another date above."
                : "Pick another date from the buttons above, or check again later."}
            </p>
          </div>
        )}

        {/* Coach cards */}
        {!loading && !error && visible.length > 0 && (
          <div className="space-y-4">
            {visible.map((schedule) => <CoachCard key={schedule._id} schedule={schedule} />)}
          </div>
        )}
      </section>

      <Footer />
    </div>
  );
}