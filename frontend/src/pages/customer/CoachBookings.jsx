import { useEffect, useState, useCallback } from 'react';
import { Link, useParams } from 'react-router-dom';
import { Bus, RefreshCw, ChevronDown, ChevronUp, XCircle, Navigation } from 'lucide-react';
import ActiveHoldBanner from '../../components/ActiveHoldBanner';
import api from '../../utils/api';
import { getErrorMessage } from '../../utils/errors';
import { formatCurrency } from '../../utils/formatters';
import { fmtDate, fmtTime } from '../../utils/dates';
import { toast, promptReason } from '../../utils/toast';
import { useSocketEvent } from '../../context/RealtimeContext';
import BookingTicket from '../../components/BookingTicket';

const TABS = [['upcoming', 'Upcoming'], ['completed', 'Completed'], ['cancelled', 'Cancelled']];

export default function CoachBookings() {
  const { id } = useParams(); // deep link from a notification
  const [tab, setTab] = useState('upcoming');
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [open, setOpen] = useState(id || null);
  const [busy, setBusy] = useState(null);

  const load = useCallback(async (silent = false) => {
    try {
      if (!silent) { setLoading(true); setError(''); }
      const response = await api.get('/coach/bookings/mine', { params: { tab } });
      if (response.data.success) setItems(response.data.bookings);
    } catch (err) {
      if (!silent) setError(getErrorMessage(err, 'Could not load your bookings'));
    } finally {
      setLoading(false);
    }
  }, [tab]);

  useEffect(() => { load(); }, [load]);
  useSocketEvent('notification:new', (n) => { if (n.serviceType === 'coach_booking') load(true); });

  async function cancel(b) {
    const reason = await promptReason({
      title: `Cancel booking ${b.bookingCode}?`,
      message: `Seat ${b.seat}, ${b.fromCity} → ${b.toCity}. The seat will be released.`,
      reasons: ['Change of plans', 'Found another option', 'Booked by mistake', 'Other'],
      confirmText: 'Cancel booking'
    });
    if (reason === null) return;
    try {
      setBusy(b._id);
      const response = await api.patch(`/coach/bookings/${b._id}/cancel`, { reason });
      if (response.data.success) { toast.success('Booking cancelled. Your seat was released.'); load(true); }
      else toast.error(response.data.message);
    } catch (err) {
      toast.error(getErrorMessage(err));
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="max-w-3xl mx-auto space-y-5">
      <ActiveHoldBanner />
      <div className="flex items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-fg flex items-center gap-2"><Bus className="w-6 h-6 text-link" /> My Coach Bookings</h1>
          <p className="text-xs text-muted">Your intercity coach tickets</p>
        </div>
        <Link to="/customer/intercity" className="px-4 py-2 rounded-xl bg-primary hover:bg-primary-hover text-on-primary text-xs font-semibold">Book a coach</Link>
      </div>

      <div className="flex gap-2 border-b border-line" role="tablist">
        {TABS.map(([key, label]) => (
          <button key={key} type="button" role="tab" aria-selected={tab === key} onClick={() => setTab(key)}
            className={`px-4 py-2 text-sm font-semibold border-b-2 -mb-px ${tab === key ? 'border-primary text-link' : 'border-transparent text-muted hover:text-fg'}`}>{label}</button>
        ))}
      </div>

      {loading ? (
        <div className="py-12 text-center"><RefreshCw className="w-6 h-6 animate-spin text-link mx-auto mb-2" /><p className="text-sm text-muted">Loading bookings...</p></div>
      ) : error ? (
        <div className="p-6 text-center space-y-2"><p className="text-sm text-danger">{error}</p><button type="button" onClick={() => load()} className="px-4 py-2 rounded-xl bg-fg text-bg hover:bg-primary hover:text-on-primary transition-colors text-xs font-semibold">Try again</button></div>
      ) : items.length === 0 ? (
        <div className="card p-10 text-center">
          <Bus className="w-9 h-9 text-subtle mx-auto mb-2" />
          <p className="text-sm font-semibold text-fg">No {tab} bookings</p>
          {tab === 'upcoming' && <p className="text-xs text-muted mt-1">Search a route to book your first seat.</p>}
        </div>
      ) : (
        <div className="space-y-3">
          {items.map((b) => {
            const expanded = open === b._id;
            return (
              <div key={b._id}>
                {expanded ? (
                  <BookingTicket booking={b}>
                    <div className="mt-4 flex flex-wrap gap-2">
                      {b.status === 'CONFIRMED' && (
                        <Link to={`/customer/track/${b._id}`} className="flex items-center gap-1.5 px-4 py-2 rounded-xl bg-primary hover:bg-primary-hover text-on-primary text-xs font-semibold"><Navigation className="w-4 h-4" /> Track my coach</Link>
                      )}
                      {b.canCancel && (
                        <button type="button" disabled={busy === b._id} onClick={() => cancel(b)} className="flex items-center gap-1.5 px-4 py-2 rounded-xl border border-danger/30 text-danger text-xs font-semibold hover:bg-danger-soft disabled:opacity-50"><XCircle className="w-4 h-4" /> Cancel booking</button>
                      )}
                      {['CONFIRMED', 'PENDING'].includes(b.status) && !b.canCancel && <p className="text-xs text-muted self-center">Cancellation closes 2 hours before departure. Contact the operator for changes.</p>}
                      <button type="button" onClick={() => setOpen(null)} className="ml-auto flex items-center gap-1 text-xs font-semibold text-muted"><ChevronUp className="w-4 h-4" /> Hide</button>
                    </div>
                  </BookingTicket>
                ) : (
                  <button type="button" onClick={() => setOpen(b._id)} className="w-full text-left bg-surface border border-line rounded-xl p-4 shadow-sm hover:border-primary flex items-center gap-4">
                    <div className="flex-1 min-w-0">
                      <p className="font-bold text-fg truncate">{b.fromCity} → {b.toCity}</p>
                      <p className="text-xs text-muted">{b.operator?.companyName} • {fmtDate(b.departureAt)}, {fmtTime(b.departureAt)}</p>
                      <p className="text-xs text-muted mt-1">Seat <b>{b.seat}</b> • {b.passenger.name} • <span className="font-mono">{b.bookingCode}</span></p>
                    </div>
                    <div className="text-right shrink-0">
                      <p className="font-bold text-fg">{formatCurrency(b.fare)}</p>
                      <p className={`text-xs font-bold ${b.status === 'CANCELLED' ? 'text-danger' : b.status === 'COMPLETED' ? 'text-muted' : 'text-link'}`}>{b.status}</p>
                    </div>
                    <ChevronDown className="w-4 h-4 text-subtle shrink-0" />
                  </button>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}