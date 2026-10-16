import { Bus, ArrowRight } from 'lucide-react';
import { formatCurrency } from '../utils/formatters';
import { fmtDate, fmtTime, fmtDateTime } from '../utils/dates';
import { Printer } from 'lucide-react';
import TicketQR from './TicketQR';
import { printArea } from '../utils/print';
import { BRAND } from '../config/platform';
import { PAYMENT_LABEL, methodLabel } from '../utils/coachPayment';

const STATUS = {
  CONFIRMED: 'bg-primary-soft text-link',
  HOLD: 'bg-warning-soft text-warning',
  PENDING_PAYMENT: 'bg-warning-soft text-warning',
  EXPIRED: 'bg-surface-3 text-subtle',
  PENDING: 'bg-warning-soft text-warning',
  COMPLETED: 'bg-surface-3 text-fg',
  CANCELLED: 'bg-danger-soft text-danger'
};

const Row = ({ label, children }) => (
  <div className="flex justify-between gap-4 py-1.5 text-sm border-b border-dashed border-line last:border-0">
    <dt className="text-muted">{label}</dt>
    <dd className="font-semibold text-fg text-right break-words">{children}</dd>
  </div>
);

// The booking confirmation / ticket. Used after booking and in My Bookings.
export default function BookingTicket({ booking, children }) {
  const b = booking;
  const showQr = b.qrPayload && ['CONFIRMED', 'COMPLETED'].includes(b.status);
  return (
    <div className="card overflow-hidden print-area">
      <div className="bg-sidebar text-white px-4 sm:px-5 py-3 flex items-center justify-between gap-3">
        <span className="flex items-center gap-2 font-bold"><Bus className="w-5 h-5 text-link" /> {BRAND.name}</span>
        <span className={`px-2.5 py-0.5 rounded-full text-xs font-bold ${STATUS[b.status]}`}>{b.status}</span>
      </div>

      <div className="p-4 sm:p-5">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-xs  text-subtle">Booking ID</p>
            <p className="text-2xl font-extrabold tracking-wider text-fg font-mono">{b.bookingCode}</p>
            {b.checkInStatus === 'BOARDED' && <p className="mt-1 text-xs font-bold text-link">Boarded {b.boardedAt ? fmtTime(b.boardedAt) : ''}</p>}
          </div>
          {showQr && (
            <div className="shrink-0 text-center">
              <TicketQR value={b.qrPayload} />
              <p className="mt-0.5 text-[10px] text-subtle">Show this at boarding</p>
            </div>
          )}
        </div>

        <p className="mt-3 flex items-center gap-2 text-lg font-bold text-fg">
          {b.fromCity} <ArrowRight className="w-4 h-4 text-link" /> {b.toCity}
        </p>

        <dl className="mt-3">
          <Row label="Operator">{b.operator?.companyName}{b.coach ? ` • ${b.coach.name}` : ''}</Row>
          <Row label="Date">{fmtDate(b.departureAt)}</Row>
          <Row label="Departure">{fmtTime(b.departureAt)}</Row>
          <Row label="Arrival">{fmtTime(b.arrivalAt)}</Row>
          <Row label="Passenger">{b.passenger.name} • {b.passenger.phone}</Row>
          <Row label="Seat">{b.seat}</Row>
          <Row label="Fare">{formatCurrency(b.fare)}</Row>
          <Row label="Booking status">{b.status}</Row>
          <Row label="Issued">{fmtDateTime(b.confirmedAt || b.createdAt)}</Row>
          {(b.paymentMethod || b.paymentStatus === 'PAID') && (
            <Row label="Payment">{methodLabel(b.paymentMethod)}{b.paymentMethod ? ' • ' : ''}{PAYMENT_LABEL[b.paymentStatus] || b.paymentStatus}</Row>
          )}
          {b.status === 'CANCELLED' && (
            <Row label="Cancelled">{b.cancelledBy ? `by ${b.cancelledBy}` : ''}{b.cancelReason ? ` — ${b.cancelReason}` : ''}</Row>
          )}
        </dl>

        {b.operator?.isDemo && (
          <p className="mt-3 text-xs text-warning bg-warning-soft border border-warning/30 rounded-xl p-2">
            DEMO booking. {b.operator.companyName} is sample data and is not an official partner of {BRAND.name}.
          </p>
        )}
        {showQr && (
          <button type="button" onClick={printArea} className="no-print print:hidden mt-3 inline-flex items-center gap-1.5 rounded-lg border border-field-line px-3 py-1.5 text-xs font-semibold text-fg hover:bg-surface-2">
            <Printer className="h-3.5 w-3.5" /> Print / save as PDF
          </button>
        )}
        {children}
      </div>
    </div>
  );
}
