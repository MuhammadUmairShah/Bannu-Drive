import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Bus, Search, ArrowRight, Armchair, Clock, RefreshCw, ArrowLeftRight, X } from 'lucide-react';
import ActiveHoldBanner from '../../components/ActiveHoldBanner';
import api from '../../utils/api';
import { getErrorMessage } from '../../utils/errors';
import { formatCurrency } from '../../utils/formatters';
import { fmtTime, dayString, duration } from '../../utils/dates';
import { toast } from '../../utils/toast';

const BOARDING_WINDOW_MS = 60 * 60 * 1000; // "Boarding soon" = departs within 60 min

// live  -> trip is running right now (between departure and arrival)
// boarding -> departs within the next hour
// scheduled -> everything else
function tripState(s, now = Date.now()) {
  const dep = new Date(s.departureAt).getTime();
  const arr = new Date(s.arrivalAt).getTime();
  if (now >= dep && now <= arr) return 'live';
  if (dep > now && dep - now <= BOARDING_WINDOW_MS) return 'boarding';
  return 'scheduled';
}

const STATE_ORDER = { live: 0, boarding: 1, scheduled: 2 };

function StateBadge({ state }) {
  if (state === 'live') {
    return (
      <span className="inline-flex items-center gap-1.5 text-xs font-bold px-2 py-0.5 rounded-full bg-danger-soft text-danger">
        <span className="relative flex h-2 w-2">
          <span className="absolute inline-flex h-full w-full rounded-full bg-danger opacity-60 animate-ping motion-reduce:animate-none" />
          <span className="relative inline-flex h-2 w-2 rounded-full bg-danger" />
        </span>
        On the way
      </span>
    );
  }
  if (state === 'boarding') {
    return <span className="text-xs font-bold px-2 py-0.5 rounded-full bg-warning-soft text-warning">Boarding soon</span>;
  }
  return null;
}

export default function Intercity() {
  const [params, setParams] = useSearchParams();
  // Every filter is optional. Empty = all cities / all upcoming dates.
  const [form, setForm] = useState({
    from: params.get('from') || '',
    to: params.get('to') || '',
    date: params.get('date') || ''
  });
  const [cities, setCities] = useState({ from: [], to: [], pairs: [] });
  const [results, setResults] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    api.get('/coach/cities').then((r) => r.data.success && setCities(r.data)).catch(() => {});
  }, []);

  async function search(values = form) {
    const from = values.from.trim();
    const to = values.to.trim();
    // Still typing a city name (1 letter) - wait
    if ((from && from.length < 2) || (to && to.length < 2)) return;
    if (from && to && from.toLowerCase() === to.toLowerCase()) {
      toast.error('From and To must be different cities.');
      return;
    }
    // Only send the filters the customer actually chose
    const query = Object.fromEntries(Object.entries(values).filter(([, v]) => v && String(v).trim()));
    try {
      setLoading(true);
      setError('');
      setParams(query, { replace: true });
      const response = await api.get('/coach/search', { params: query });
      if (response.data.success) setResults(response.data.schedules);
    } catch (err) {
      setError(getErrorMessage(err, 'Could not load coaches'));
    } finally {
      setLoading(false);
    }
  }

  // Runs on page open (shows ALL active coaches) and again whenever a filter changes
  const firstRun = useRef(true);
  useEffect(() => {
    const t = setTimeout(() => search(form), firstRun.current ? 0 : 450);
    firstRun.current = false;
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [form.from, form.to, form.date]);

  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });
  const swap = () => setForm({ ...form, from: form.to, to: form.from });
  const clearFilters = () => setForm({ from: '', to: '', date: '' });

  function pairsFor(from) {
    if (!from) return [];
    return [...new Set(cities.pairs.filter((p) => p.from.toLowerCase() === from.trim().toLowerCase()).map((p) => p.to))];
  }

  const toOptions = useMemo(() => {
    const matched = pairsFor(form.from);
    return matched.length ? matched : cities.to;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [form.from, cities]);

  // Live trips first, then boarding soon, then by departure time
  const sorted = useMemo(() => {
    if (!results) return null;
    const now = Date.now();
    return results
      .map((s) => ({ ...s, _state: tripState(s, now) }))
      .sort((a, b) => STATE_ORDER[a._state] - STATE_ORDER[b._state] || new Date(a.departureAt) - new Date(b.departureAt));
  }, [results]);

  const hasFilters = Boolean(form.from || form.to || form.date);
  const summary = hasFilters
    ? `${form.from || 'Any city'} → ${form.to || 'Any city'}${form.date ? ` • ${form.date}` : ''}`
    : 'All upcoming coaches';

  const fieldClass =
    'mt-1 w-full text-sm font-normal normal-case border border-field-line rounded-xl px-3 py-2.5 focus:outline-none focus:ring-2 focus:ring-primary bg-field text-fg';

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      <ActiveHoldBanner />
      <div>
        <h1 className="text-xl font-bold text-fg flex items-center gap-2"><Bus className="w-6 h-6 text-link" /> Intercity Coaches</h1>
        <p className="text-xs text-muted">All active coaches are listed below. Use the filters to narrow by route or date, then pick your seat on the seat map.</p>
      </div>

      <form onSubmit={(e) => { e.preventDefault(); search(); }} className="card p-4 sm:p-5">
        <div className="grid gap-3 md:grid-cols-[1fr_auto_1fr_11rem_auto] items-end">
          <label className="text-xs font-semibold text-fg">From
            <input list="from-cities" value={form.from} onChange={set('from')} placeholder="e.g. Bannu" autoComplete="off" className={fieldClass} />
          </label>
          <button type="button" onClick={swap} aria-label="Swap cities" disabled={!form.from && !form.to}
            className="hidden md:flex mb-0.5 p-2.5 rounded-xl border border-field-line text-muted hover:bg-surface-2 disabled:opacity-40">
            <ArrowLeftRight className="w-4 h-4" />
          </button>
          <label className="text-xs font-semibold text-fg">To
            <input list="to-cities" value={form.to} onChange={set('to')} placeholder="e.g. Peshawar" autoComplete="off" className={fieldClass} />
          </label>
          <label className="text-xs font-semibold text-fg">Date
            <input type="date" value={form.date} min={dayString(0)} onChange={set('date')} className={fieldClass} />
          </label>
          <button type="submit" disabled={loading}
            className="flex items-center justify-center gap-2 bg-primary hover:bg-primary-hover disabled:opacity-60 text-on-primary font-semibold text-sm rounded-xl px-5 py-2.5">
            <Search className="w-4 h-4" /> Search
          </button>
        </div>
        <datalist id="from-cities">{cities.from.map((c) => <option key={c} value={c} />)}</datalist>
        <datalist id="to-cities">{toOptions.map((c) => <option key={c} value={c} />)}</datalist>

        {form.from && !form.to && pairsFor(form.from).length > 0 && (
          <div className="mt-3 flex flex-wrap items-center gap-2 text-xs">
            <span className="text-muted">Popular from {form.from}:</span>
            {pairsFor(form.from).map((c) => (
              <button key={c} type="button" onClick={() => setForm({ ...form, to: c })}
                className="px-2.5 py-1 rounded-full border border-field-line text-fg hover:border-primary hover:text-link">{c}</button>
            ))}
          </div>
        )}

        {hasFilters && (
          <button type="button" onClick={clearFilters}
            className="mt-3 inline-flex items-center gap-1 text-xs font-semibold text-muted hover:text-fg">
            <X className="w-3.5 h-3.5" /> Clear filters
          </button>
        )}
      </form>

      {loading && (
        <div className="py-12 text-center"><RefreshCw className="w-6 h-6 animate-spin text-link mx-auto mb-2" /><p className="text-sm text-muted">Loading coaches...</p></div>
      )}

      {error && !loading && (
        <div className="p-4 bg-danger-soft border border-danger/30 rounded-xl flex flex-wrap items-center justify-between gap-3">
          <p className="text-sm text-danger">{error}</p>
          <button type="button" onClick={() => search()} className="px-3 py-1.5 rounded-xl bg-fg text-bg hover:bg-primary hover:text-on-primary transition-colors text-xs font-semibold">Try again</button>
        </div>
      )}

      {!loading && !error && sorted && sorted.length === 0 && (
        <div className="card p-10 text-center">
          <Bus className="w-9 h-9 text-subtle mx-auto mb-2" />
          <p className="text-sm font-semibold text-fg">{hasFilters ? 'No coaches match these filters' : 'No active coaches right now'}</p>
          <p className="text-xs text-muted mt-1">{hasFilters ? 'Try another date or clear the filters to see all coaches.' : 'Check back soon.'}</p>
          {hasFilters && (
            <button type="button" onClick={clearFilters} className="mt-4 px-4 py-2 rounded-xl bg-primary hover:bg-primary-hover text-on-primary text-xs font-semibold">Show all coaches</button>
          )}
        </div>
      )}

      {!loading && sorted && sorted.length > 0 && (
        <div className="space-y-3">
          <p className="text-xs text-muted">{sorted.length} departure{sorted.length === 1 ? '' : 's'} • {summary}</p>
          {sorted.map((s) => (
            <div key={s._id} className="card p-4 sm:p-5 flex flex-col md:flex-row md:items-center gap-4">
              <div className="flex-1 min-w-0 space-y-2">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-bold text-fg">{s.operator.companyName}</span>
                  <StateBadge state={s._state} />
                  {s.operator.isDemo && <span className="text-xs font-bold px-2 py-0.5 rounded-full bg-warning-soft text-warning">DEMO</span>}
                </div>
                <p className="text-xs text-muted capitalize">{s.coach.name} • {s.coach.type}{s.coach.amenities?.length ? ` • ${s.coach.amenities.join(', ')}` : ''}</p>
                <div className="flex items-center gap-3 text-fg">
                  <div><p className="text-lg font-extrabold">{fmtTime(s.departureAt)}</p><p className="text-xs text-muted">{s.fromCity}</p></div>
                  <div className="flex-1 flex flex-col items-center text-xs text-subtle min-w-[3.5rem]">
                    <Clock className="w-3.5 h-3.5" /><span>{duration(s.departureAt, s.arrivalAt)}</span><ArrowRight className="w-4 h-4" />
                  </div>
                  <div className="text-right"><p className="text-lg font-extrabold">{fmtTime(s.arrivalAt)}</p><p className="text-xs text-muted">{s.toCity}</p></div>
                </div>
                <p className={`text-xs flex items-center gap-1 ${s.availableSeats <= 5 ? 'text-danger font-semibold' : 'text-muted'}`}>
                  <Armchair className="w-3.5 h-3.5" /> {s.availableSeats} of {s.totalSeats} seats available
                </p>
              </div>
              <div className="flex md:flex-col items-center md:items-end justify-between gap-2 md:min-w-[9rem]">
                <div className="md:text-right"><p className="text-xs text-subtle">Fare / seat</p><p className="text-xl font-extrabold text-link">{formatCurrency(s.fare)}</p></div>
                {s.bookable ? (
                  <Link to={`/customer/intercity/${s._id}`} className="px-4 py-2.5 rounded-xl bg-primary hover:bg-primary-hover text-on-primary text-sm font-semibold">View Seats</Link>
                ) : (
                  <span className="px-4 py-2.5 rounded-xl bg-surface-2 text-muted text-sm font-semibold">{s.availableSeats === 0 ? 'Sold out' : 'Booking closed'}</span>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}