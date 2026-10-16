import { useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ArrowLeft, Printer, Banknote, Phone, Clock } from 'lucide-react';
import api from '../../utils/api';
import { getErrorMessage } from '../../utils/errors';
import { formatCurrency } from '../../utils/formatters';
import { fmtDate, fmtTime, fmtDateTime } from '../../utils/dates';
import { toast } from '../../utils/toast';
import useScheduleSeats from '../../hooks/useScheduleSeats';
import SeatMap from '../../components/SeatMap';
import SyncBadge from '../../components/SyncBadge';
import { Loading, ErrorBox, Badge, Stat, btnPrimary, btnGhost } from '../../components/ui';
import { PAYMENT_LABEL, PAYMENT_TONE, methodLabel } from '../../utils/coachPayment';
import { printArea } from '../../utils/print';
import useCountdown from '../../hooks/useCountdown';
import { fmtCountdown } from '../../utils/seatSync';

function HoldInfo({ seat, serverTime }) {
  const left = useCountdown(seat.hold.until, serverTime);
  return (
    <div className="space-y-1 text-sm">
      <p className="flex items-center gap-2 font-semibold text-warning"><Clock className="h-4 w-4" /> On hold: {fmtCountdown(left)} left</p>
      <p className="text-xs text-muted">{seat.hold.state === 'PENDING_PAYMENT' ? 'A customer is paying online.' : 'A customer is choosing how to pay.'} Passenger details appear only after the booking is confirmed. If it is not completed the seat is released automatically.</p>
    </div>
  );
}

export default function OperatorSeatMap() {
  const { id } = useParams();
  const { data, loading, error, conn, lastSync, reload, refresh } = useScheduleSeats(id, { path: `/coach/operator/schedules/${id}/seatmap`, ops: true });
  const [active, setActive] = useState(null);
  const [busy, setBusy] = useState(false);

  const seat = useMemo(() => data?.seats.find((s) => s.label === active) || null, [data, active]);
  const manifest = useMemo(() => (data?.seats || []).filter((s) => s.status === 'BOOKED').sort((a, b) => a.label.localeCompare(b.label)), [data]);

  async function collect(bookingId) {
    if (busy) return;
    setBusy(true);
    try { const r = await api.patch(`/coach/operator/bookings/${bookingId}/collect-cash`); toast.success(r.data.message); refresh(); } catch (err) { toast.error(getErrorMessage(err)); } finally { setBusy(false); }
  }

  async function setBlocked(label, blocked) {
    if (busy) return;
    setBusy(true);
    try { const r = await api.patch(`/coach/operator/schedules/${id}/seats/${label}/block`, { blocked }); toast.success(r.data.message); refresh(); } catch (err) { toast.error(getErrorMessage(err)); } finally { setBusy(false); }
  }

  if (loading) return <Loading text="Loading seat map..." />;
  if (error || !data) return <ErrorBox message={error || 'Schedule not found'} onRetry={reload} />;
  const { schedule: s, summary: m } = data;

  return (
    <div className="space-y-5">
      <div className="flex items-center gap-3 print:hidden">
        <Link to="/operator/schedules" className="rounded-xl border border-line bg-surface p-2 text-muted hover:bg-surface-2" aria-label="Back to schedules"><ArrowLeft className="h-4 w-4" /></Link>
        <div className="min-w-0 flex-1">
          <h1 className="truncate text-lg font-bold text-fg">{s.fromCity} → {s.toCity}</h1>
          <p className="text-xs text-muted">{s.coach?.name} {s.coach?.registrationNumber ? `(${s.coach.registrationNumber})` : ''} • {fmtDate(s.departureAt)} {fmtTime(s.departureAt)} → {fmtTime(s.arrivalAt)} • {formatCurrency(s.fare)} / seat • <Badge tone={s.status === 'scheduled' ? 'green' : 'slate'}>{s.status}</Badge></p>
        </div>
        <button type="button" className={`${btnGhost} inline-flex items-center gap-1.5`} onClick={printArea}><Printer className="h-3.5 w-3.5" /> Print</button>
      </div>

      <div className="print:hidden"><SyncBadge conn={conn} lastSync={lastSync} onRefresh={refresh} /></div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-8 print:hidden">
        <Stat label="Total seats" value={m.totalSeats} /><Stat label="Booked" value={m.booked} tone="green" /><Stat label="On hold" value={m.held} tone="amber" /><Stat label="Blocked" value={m.blocked} />
        <Stat label="Available" value={m.available} /><Stat label="Occupancy" value={`${m.occupancyPct}%`} /><Stat label="Revenue" value={formatCurrency(m.revenue)} /><Stat label="Cash due" value={formatCurrency(m.cashDue)} tone="amber" />
      </div>

      <div className="grid gap-5 lg:grid-cols-[minmax(0,26rem)_1fr] print:hidden">
        <div className="card p-4"><SeatMap operator layout={data.layout} seats={data.seats} activeSeat={active} onSeatClick={(x) => setActive(x.label)} /></div>

        <div className="card min-h-[12rem] space-y-3 self-start p-5" aria-live="polite">
          {!seat && <p className="py-8 text-center text-sm text-muted">Click any seat to see who booked it.</p>}
          {seat && (
            <>
              <p className="text-sm font-bold text-fg">Seat {seat.label}</p>
              {seat.status === 'AVAILABLE' && (<div className="space-y-2"><p className="text-sm text-muted">Available for sale.</p>{s.status === 'scheduled' && <button type="button" disabled={busy} className={btnGhost} onClick={() => setBlocked(seat.label, true)}>Block this seat</button>}</div>)}
              {seat.status === 'BLOCKED' && (<div className="space-y-2"><p className="text-sm text-muted">Blocked: this seat is not for sale.</p>{s.status === 'scheduled' && <button type="button" disabled={busy} className={btnGhost} onClick={() => setBlocked(seat.label, false)}>Put back on sale</button>}</div>)}
              {seat.status === 'HELD' && <HoldInfo seat={seat} serverTime={data.serverTime} />}
              {seat.status === 'BOOKED' && (() => {
                const b = seat.booking;
                return (
                  <div className="space-y-2 text-sm">
                    <dl className="space-y-1">
                      {[['Passenger', b.passenger.name], ['Gender', b.passenger.gender || 'n/a'], ['Booking code', <span key="code" className="font-mono">{b.bookingCode}</span>], ['Booking status', b.status], ['Payment', `${methodLabel(b.paymentMethod)} • ${PAYMENT_LABEL[b.paymentStatus] || b.paymentStatus}`], ['Fare', formatCurrency(b.fare)], ['Booked', fmtDateTime(b.bookedAt)]].map(([k, v]) => (
                        <div key={k} className="flex justify-between gap-3 border-b border-dashed border-line py-1 last:border-0"><dt className="text-muted">{k}</dt><dd className="text-right font-semibold text-fg">{v}</dd></div>
                      ))}
                    </dl>
                    <a href={`tel:${b.passenger.phone}`} className="inline-flex items-center gap-1.5 font-semibold text-link"><Phone className="h-3.5 w-3.5" /> {b.passenger.phone}</a>
                    <div className="flex items-center gap-2"><Badge tone={PAYMENT_TONE[b.paymentStatus] || 'slate'}>{PAYMENT_LABEL[b.paymentStatus] || b.paymentStatus}</Badge></div>
                    {b.paymentMethod === 'CASH' && b.paymentStatus === 'CASH_DUE' && b.status === 'CONFIRMED' && (
                      <button type="button" disabled={busy} className={`${btnPrimary} inline-flex items-center gap-1.5`} onClick={() => collect(b._id)}><Banknote className="h-3.5 w-3.5" /> Record cash collected ({formatCurrency(b.fare)})</button>
                    )}
                  </div>
                );
              })()}
            </>
          )}
        </div>
      </div>

      <div className="card overflow-x-auto p-4 print-area">
        <p className="mb-2 text-sm font-bold text-fg">{s.fromCity} → {s.toCity}, {fmtDate(s.departureAt)} {fmtTime(s.departureAt)}: Passenger manifest ({manifest.length})</p>
        {manifest.length === 0 ? <p className="py-4 text-center text-sm text-muted">No confirmed passengers yet.</p> : (
          <table className="w-full min-w-[34rem] text-left text-xs">
            <thead><tr className="text-muted"><th className="py-1.5">Seat</th><th>Passenger</th><th>Phone</th><th>Code</th><th>Payment</th></tr></thead>
            <tbody>{manifest.map((x) => (
              <tr key={x.label} className="border-t border-line"><td className="py-1.5 font-bold">{x.label}</td><td>{x.booking.passenger.name}</td><td>{x.booking.passenger.phone}</td><td className="font-mono">{x.booking.bookingCode}</td><td>{methodLabel(x.booking.paymentMethod)} • {PAYMENT_LABEL[x.booking.paymentStatus]}</td></tr>
            ))}</tbody>
          </table>
        )}
      </div>
    </div>
  );
}
