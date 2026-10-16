import { useState } from 'react';
import { Users, Printer } from 'lucide-react';
import useFetch from '../../hooks/useFetch';
import { PageHeader, DataTable, Badge, statusTone, Loading, ErrorBox, inputCls, btnGhost } from '../../components/ui';
import { fmtDate, fmtTime } from '../../utils/dates';
import { formatCurrency } from '../../utils/formatters';
import { printArea } from '../../utils/print';
import { PAYMENT_LABEL, methodLabel } from '../../utils/coachPayment';

export default function OperatorPassengers() {
  const sched = useFetch('/coach/operator/schedules', { upcoming: 'true', status: 'scheduled' });
  const [id, setId] = useState('');
  const list = useFetch('/coach/operator/passengers', { scheduleId: id }, { enabled: !!id });
  const s = list.data?.schedule;

  return (
    <div className="space-y-5">
      <PageHeader icon={Users} title="Passengers" subtitle="Passenger list for one trip, ordered by seat"
        action={id && list.data && <button type="button" className={btnGhost + ' flex items-center gap-1.5'} onClick={printArea}><Printer className="w-4 h-4" /> Print list</button>} />

      {sched.loading ? <Loading /> : sched.error ? <ErrorBox message={sched.error} onRetry={sched.reload} /> : (
        <select className={inputCls + ' max-w-lg'} value={id} onChange={(e) => setId(e.target.value)} aria-label="Choose a trip">
          <option value="">Choose a trip...</option>
          {sched.data.schedules.map((x) => <option key={x._id} value={x._id}>{x.fromCity} → {x.toCity} • {fmtDate(x.departureAt)} {fmtTime(x.departureAt)} • {x.bookedSeats} booked</option>)}
        </select>
      )}

      {!id ? <p className="text-sm text-muted">Select an upcoming trip to see who is travelling.</p> : (
        <div className="space-y-5 print-area">
          {s && <div className="card text-xs text-muted p-3">{s.fromCity} → {s.toCity} • {fmtDate(s.departureAt)}, {fmtTime(s.departureAt)} • {s.coach?.name} • <b>{s.bookedSeats}</b> booked, <b>{s.availableSeats}</b> seats free</div>}
          <DataTable loading={list.loading} error={list.error} onRetry={list.reload} rows={list.data?.passengers} rowKey="bookingId" empty={{ title: 'No passengers on this trip yet' }}
            columns={[
              { label: 'Seat', render: (p) => <b className="text-fg">{p.seat}</b> },
              { label: 'Passenger', render: (p) => p.name },
              { label: 'Phone', render: (p) => p.phone },
              { label: 'Gender', render: (p) => <span className="capitalize">{p.gender || '-'}</span> },
              { label: 'Booking', render: (p) => <span className="font-mono">{p.bookingCode}</span> },
              { label: 'Fare', render: (p) => formatCurrency(p.fare) },
              { label: 'Payment', render: (p) => `${methodLabel(p.paymentMethod)} • ${PAYMENT_LABEL[p.paymentStatus] || p.paymentStatus}` },
              { label: 'Boarding', render: (p) => <Badge tone={p.checkInStatus === 'BOARDED' ? 'green' : 'slate'}>{p.checkInStatus === 'BOARDED' ? 'Boarded' : p.checkInStatus === 'CHECKED_IN' ? 'Checked in' : 'Waiting'}</Badge> },
              { label: 'Status', render: (p) => <Badge tone={statusTone(p.status)}>{p.status}</Badge> }
            ]} />
        </div>
      )}
    </div>
  );
}
