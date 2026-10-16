import { useEffect, useState, useRef } from 'react';
import { Link, useParams, useNavigate } from 'react-router-dom';
import { ArrowLeft, RefreshCw, Clock, Phone, User } from 'lucide-react';
import api from '../../utils/api';
import { getErrorMessage } from '../../utils/errors';
import { formatCurrency } from '../../utils/formatters';
import { fmtDate, fmtTime } from '../../utils/dates';
import { toast } from '../../utils/toast';
import useScheduleSeats from '../../hooks/useScheduleSeats';
import { lostSeats, newIdempotencyKey } from '../../utils/seatSync';
import SyncBadge from '../../components/SyncBadge';
import { useAuth } from '../../context/AuthContext';
import SeatMap from '../../components/SeatMap';

export default function CoachSeats() {
  const { scheduleId } = useParams();
  const navigate = useNavigate();
  const { user } = useAuth();

  const [selected, setSelected] = useState([]);
  const [passengers, setPassengers] = useState({});
  const [holding, setHolding] = useState(false);
  const selectedRef = useRef([]);
  selectedRef.current = selected;
  const attempt = useRef({ sig: '', key: '' }); // one idempotency key per checkout attempt

  // Live seat map: REST is the truth, the socket makes it instant, reconnects re-sync from the server
  const { data, loading, error, conn, lastSync, reload, refresh } = useScheduleSeats(scheduleId, {
    onEvent: (p) => {
      const lost = lostSeats(selectedRef.current, p);
      if (lost.length) {
        setSelected((cur) => cur.filter((l) => !lost.includes(l)));
        toast.error('Sorry, this seat was just booked by another passenger.');
      }
    }
  });

  // Drop selections that are no longer free (e.g. after a re-sync)
  useEffect(() => {
    if (!data) return;
    const free = new Set(data.seats.filter((s) => s.status === 'AVAILABLE').map((s) => s.label));
    setSelected((cur) => (cur.every((l) => free.has(l)) ? cur : cur.filter((l) => free.has(l))));
  }, [data]);

  const max = data?.schedule.maxSeatsPerBooking || 4;

  function toggle(label) {
    setSelected((cur) => {
      if (cur.includes(label)) return cur.filter((l) => l !== label);
      if (cur.length >= max) { toast.info(`You can book up to ${max} seats at a time.`); return cur; }
      return [...cur, label].sort();
    });
  }

  const setP = (seat, key, value) => setPassengers((p) => ({ ...p, [seat]: { ...(p[seat] || {}), [key]: value } }));
  const copyFirst = () => {
    const first = passengers[selected[0]] || {};
    setPassengers((p) => ({ ...p, ...Object.fromEntries(selected.slice(1).map((s) => [s, { ...first, name: '' }])) }));
  };

  async function holdSeats() {
    if (holding) return; // a second click while the first request is running does nothing
    for (const seat of selected) {
      const p = passengers[seat] || {};
      if ((p.name || '').trim().length < 2) return toast.error(`Enter the passenger name for seat ${seat}.`);
      if (!/^(\+92|0)?3\d{9}$/.test((p.phone || '').replace(/[\s-]/g, ''))) return toast.error(`Enter a valid mobile number for seat ${seat} (e.g. 03001234567).`);
    }

    // Same seats retried after a network failure = same key = the server returns the SAME hold, never a second one
    const sig = selected.join(',');
    if (attempt.current.sig !== sig) attempt.current = { sig, key: newIdempotencyKey() };

    try {
      setHolding(true);
      const response = await api.post('/coach/orders', {
        scheduleId,
        seats: selected.map((seat) => ({ seat, passenger: { name: passengers[seat].name.trim(), phone: passengers[seat].phone.trim(), gender: passengers[seat].gender || '' } }))
      }, { headers: { 'Idempotency-Key': attempt.current.key } });
      attempt.current = { sig: '', key: '' };
      navigate(`/customer/checkout/${response.data.order._id}`);
    } catch (err) {
      const code = err.response?.data?.code;
      if (err.response) attempt.current = { sig: '', key: '' }; // a definite answer: next attempt is a new one
      if (code === 'SEAT_TAKEN') {
        toast.error('Sorry, this seat was just booked by another passenger.');
        setSelected((cur) => cur.filter((l) => !(err.response.data.conflictSeats || []).includes(l)));
      } else {
        toast.error(getErrorMessage(err));
      }
      refresh(); // the seat map may have changed: always re-fetch the server's truth
    } finally {
      setHolding(false);
    }
  }

  if (loading) return <div className="py-20 text-center"><RefreshCw className="w-7 h-7 animate-spin text-link mx-auto mb-3" /><p className="text-sm text-muted">Loading seat map...</p></div>;

  if (error || !data) {
    return (
      <div className="max-w-md mx-auto py-16 text-center space-y-3">
        <p className="text-sm text-danger">{error || 'Trip not found'}</p>
        <button type="button" onClick={reload} className="px-4 py-2 rounded-xl bg-fg text-bg hover:bg-primary hover:text-on-primary transition-colors text-xs font-semibold">Try again</button>
        <div><Link to="/customer/intercity" className="text-xs text-link font-semibold">Back to search</Link></div>
      </div>
    );
  }

  const mineHeld = data.seats.find((x) => x.mine && x.status === 'HELD' && x.orderId);

  const s = data.schedule;
  const total = selected.length * s.fare;

  return (
    <div className="max-w-5xl mx-auto space-y-5">
      <div className="flex items-center gap-3">
        <Link to={`/customer/intercity?from=${encodeURIComponent(s.fromCity)}&to=${encodeURIComponent(s.toCity)}&date=${s.departureAt.slice(0, 10)}`} className="p-2 bg-surface rounded-xl border border-line text-muted hover:bg-surface-2" aria-label="Back to results"><ArrowLeft className="w-4 h-4" /></Link>
        <div className="min-w-0">
          <h1 className="text-lg sm:text-xl font-bold text-fg truncate">{s.fromCity} → {s.toCity}</h1>
          <p className="text-xs text-muted">{s.operator.companyName}{s.operator.isDemo ? ' (DEMO)' : ''} • {fmtDate(s.departureAt)} • {fmtTime(s.departureAt)} → {fmtTime(s.arrivalAt)} • {formatCurrency(s.fare)} / seat</p>
        </div>
      </div>

      {mineHeld && (
        <Link to={`/customer/checkout/${mineHeld.orderId}`} className="flex items-center gap-2 rounded-xl border border-primary/40 bg-primary-soft px-4 py-3 text-sm font-semibold text-link">
          <Clock className="h-4 w-4" /> You have seats on hold for this trip. Continue to payment →
        </Link>
      )}

      <div className="grid gap-5 lg:grid-cols-[minmax(0,22rem)_1fr]">
        <div className="card p-4 sm:p-5">
          <p className="text-sm font-bold text-fg mb-1">Choose your seat{max > 1 ? 's' : ''}</p>
          <p className="text-xs text-muted mb-2">{s.availableSeats} of {s.totalSeats} seats available</p>
          <div className="mb-4"><SyncBadge conn={conn} lastSync={lastSync} onRefresh={refresh} /></div>
          <SeatMap layout={data.layout} seats={data.seats} selected={selected} onToggle={toggle} />
        </div>

        <div className="card p-4 sm:p-5 space-y-4 self-start">
          <p className="text-sm font-bold text-fg">Passenger details</p>

          {selected.length === 0 ? (
            <p className="text-sm text-muted py-6 text-center border border-dashed border-field-line rounded-xl">Select a seat on the map to continue.</p>
          ) : (
            <>
              {selected.map((seat, i) => (
                <div key={seat} className="p-3 rounded-xl border border-line bg-surface-2 space-y-2">
                  <div className="flex items-center justify-between">
                    <p className="text-xs font-bold text-fg">Seat {seat}</p>
                    {i === 0 && selected.length > 1 && <button type="button" onClick={copyFirst} className="text-xs font-semibold text-link">Copy phone to other seats</button>}
                  </div>
                  <div className="grid gap-2 sm:grid-cols-2">
                    <label className="relative"><User className="w-4 h-4 text-subtle absolute left-2.5 top-2.5" />
                      <input type="text" placeholder={i === 0 ? `Passenger name (${user?.name || ''})` : 'Passenger name'} maxLength={60} value={passengers[seat]?.name || ''} onChange={(e) => setP(seat, 'name', e.target.value)}
                        className="w-full text-sm border border-field-line rounded-xl pl-8 pr-3 py-2 bg-field focus:outline-none focus:ring-2 focus:ring-primary text-fg" /></label>
                    <label className="relative"><Phone className="w-4 h-4 text-subtle absolute left-2.5 top-2.5" />
                      <input type="tel" inputMode="tel" placeholder="03001234567" maxLength={15} value={passengers[seat]?.phone || ''} onChange={(e) => setP(seat, 'phone', e.target.value)}
                        className="w-full text-sm border border-field-line rounded-xl pl-8 pr-3 py-2 bg-field focus:outline-none focus:ring-2 focus:ring-primary text-fg" /></label>
                  </div>
                  <div className="flex gap-4 text-xs text-muted">
                    {['male', 'female'].map((g) => (
                      <label key={g} className="flex items-center gap-1.5 capitalize"><input type="radio" name={`g-${seat}`} checked={passengers[seat]?.gender === g} onChange={() => setP(seat, 'gender', g)} /> {g}</label>
                    ))}
                  </div>
                </div>
              ))}

              <div className="flex items-center justify-between pt-3 border-t border-line">
                <div><p className="text-xs text-muted">{selected.length} seat{selected.length > 1 ? 's' : ''} ({selected.join(', ')})</p><p className="text-xl font-extrabold text-fg">{formatCurrency(total)}</p></div>
                <button type="button" onClick={holdSeats} disabled={holding || conn !== 'live' && !data} className="px-6 py-3 rounded-xl bg-primary hover:bg-primary-hover disabled:opacity-60 text-on-primary text-sm font-semibold">
                  {holding ? 'Holding seats...' : 'Hold seats & continue'}
                </button>
              </div>
              <p className="text-xs text-muted">Your seats are held for a few minutes while you choose how to pay (online or cash to the operator). Free cancellation until 2 hours before departure.</p>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
