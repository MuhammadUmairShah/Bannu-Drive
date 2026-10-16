import { useState } from 'react';
import { Ticket } from 'lucide-react';
import api from '../../utils/api';
import useFetch from '../../hooks/useFetch';
import { getErrorMessage } from '../../utils/errors';
import { toast, promptReason } from '../../utils/toast';
import { useAuth } from '../../context/AuthContext';
import { useSocketEvent } from '../../context/RealtimeContext';
import { formatCurrency } from '../../utils/formatters';
import { fmtDate, fmtTime } from '../../utils/dates';
import { PageHeader, DataTable, Badge, statusTone, inputCls, btnDanger } from '../../components/ui';

export default function OperatorBookings() {
  const { user } = useAuth();
  const [f, setF] = useState({ q: '', status: '', date: '' });
  const { data, loading, error, reload } = useFetch('/coach/operator/bookings', f, { debounce: 300 });
  useSocketEvent('notification:new', (n) => { if (n.serviceType === 'coach_booking') reload(true); });
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });

  async function cancel(b) {
    const reason = await promptReason({ title: `Cancel ${b.bookingCode}?`, message: `${b.passenger.name}, seat ${b.seat}. The customer will be notified and the seat released.`, reasons: ['Vehicle change', 'Passenger no-show', 'Operator issue', 'Other'], confirmText: 'Cancel booking' });
    if (reason === null) return;
    try { const r = await api.patch(`/coach/operator/bookings/${b._id}/cancel`, { reason }); r.data.success ? (toast.success(r.data.message), reload(true)) : toast.error(r.data.message); } catch (err) { toast.error(getErrorMessage(err)); }
  }

  return (
    <div className="space-y-5">
      <PageHeader icon={Ticket} title="Bookings" subtitle="Every seat booked on your coaches" />
      <div className="flex flex-wrap gap-2">
        <input className={inputCls + ' flex-1 min-w-[12rem]'} placeholder="Search booking ID, passenger or phone..." value={f.q} onChange={set('q')} />
        <select className={inputCls + ' w-auto'} value={f.status} onChange={set('status')}><option value="">All statuses</option>{['CONFIRMED', 'COMPLETED', 'CANCELLED'].map((s) => <option key={s}>{s}</option>)}</select>
        <input type="date" className={inputCls + ' w-auto'} value={f.date} onChange={set('date')} title="Departure date" />
      </div>
      <DataTable loading={loading} error={error} onRetry={reload} rows={data?.bookings} empty={{ title: 'No bookings found' }}
        columns={[
          { label: 'Booking', render: (b) => <><b className="font-mono text-fg">{b.bookingCode}</b><span className="block text-subtle">{new Date(b.createdAt).toLocaleDateString()}</span></> },
          { label: 'Passenger', render: (b) => <>{b.passenger.name}<span className="block text-subtle">{b.passenger.phone}</span></> },
          { label: 'Trip', render: (b) => <>{b.fromCity} → {b.toCity}<span className="block text-subtle">{fmtDate(b.departureAt)}, {fmtTime(b.departureAt)}</span></> },
          { label: 'Seat', render: (b) => b.seat },
          { label: 'Fare', render: (b) => formatCurrency(b.fare) },
          { label: 'Status', render: (b) => <><Badge tone={statusTone(b.status)}>{b.status}</Badge>{b.cancelledBy && <span className="block text-xs text-subtle mt-0.5">by {b.cancelledBy}</span>}</> },
          { label: '', render: (b) => ['CONFIRMED', 'PENDING'].includes(b.status) && <button className={btnDanger} disabled={!user?.isVerified} onClick={() => cancel(b)}>Cancel</button> }
        ]} />
    </div>
  );
}
