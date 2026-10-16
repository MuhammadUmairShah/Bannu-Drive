import { useState } from 'react';
import { Building2, Bus, Route as RouteIcon, CalendarClock, Ticket, Database } from 'lucide-react';
import api from '../../utils/api';
import useFetch from '../../hooks/useFetch';
import { getErrorMessage } from '../../utils/errors';
import { toast, confirmDialog, promptReason } from '../../utils/toast';
import { formatCurrency } from '../../utils/formatters';
import { fmtDate, fmtTime } from '../../utils/dates';
import { PageHeader, DataTable, Badge, Stat, statusTone, inputCls, btnPrimary, btnGhost, btnDanger } from '../../components/ui';

const Company = ({ o }) => (o ? <>{o.companyName}{o.isDemo && <Badge tone="amber">DEMO</Badge>}</> : '-');

async function act(promise, reload) {
  try { const r = await promise; r.data.success ? (toast.success(r.data.message), reload(true)) : toast.error(r.data.message); return r.data; } catch (err) { toast.error(getErrorMessage(err)); return null; }
}

// ---------------------------------------------------------------- Operators (+ stats + demo data)
export function AdminOperators() {
  const [f, setF] = useState({ q: '', status: '' });
  const { data, loading, error, reload } = useFetch('/coach/admin/operators', f, { debounce: 300 });
  const stats = useFetch('/coach/admin/stats');
  const [creds, setCreds] = useState(null);
  const st = stats.data?.stats;

  const refresh = (silent) => { reload(silent); stats.reload(true); };

  async function seed() {
    const d = await act(api.post('/coach/admin/demo/seed', {}), refresh);
    if (d?.credentials) setCreds(d.credentials);
  }
  async function purge() {
    if (!(await confirmDialog({ title: 'Remove demo data?', message: 'Demo trips nobody booked are deleted. Demo trips with bookings are cancelled (customers are notified) and kept in history.', confirmText: 'Remove demo data', danger: true }))) return;
    act(api.delete('/coach/admin/demo'), refresh);
  }
  async function approve(o, approved) {
    if (!approved && !(await confirmDialog({ title: `Remove approval for ${o.companyName}?`, message: 'They will no longer be able to sell seats.', confirmText: 'Remove approval', danger: true }))) return;
    act(api.patch(`/coach/admin/operators/${o._id}/approve`, { approved }), refresh);
  }
  async function block(o) {
    const blocked = !o.blocked;
    if (blocked && !(await confirmDialog({ title: `Block ${o.companyName}?`, message: 'Their trips disappear from search and they are locked out.', confirmText: 'Block', danger: true }))) return;
    act(api.patch(`/admin/user/${o.user._id}/block`, { isBlocked: blocked }), refresh);
  }

  return (
    <div className="space-y-5">
      <PageHeader icon={Building2} title="Coach Operators" subtitle="Approve operators, block them, and manage demo data" />
      {st && (
        <div className="grid grid-cols-2 lg:grid-cols-4 xl:grid-cols-8 gap-3">
          <Stat label="Operators" value={st.operators} hint={`${st.pendingOperators} pending`} tone={st.pendingOperators ? 'amber' : 'slate'} />
          <Stat label="Coaches" value={st.coaches} /><Stat label="Routes" value={st.routes} /><Stat label="Upcoming trips" value={st.upcomingSchedules} />
          <Stat label="Bookings" value={st.totalBookings} /><Stat label="Cancelled" value={st.bookings.CANCELLED} /><Stat label="Completed" value={st.bookings.COMPLETED} />
          <Stat label="Revenue" value={formatCurrency(st.revenue)} tone="green" />
        </div>
      )}

      <div className="card p-4 flex flex-wrap items-center gap-3">
        <Database className="w-5 h-5 text-subtle" />
        <div className="flex-1 min-w-[14rem] text-xs text-muted"><b className="text-fg">Demo data</b><br />Creates "Adil Coaches - DEMO" with Bannu → Peshawar and Bannu → Islamabad departures for the next 14 days. Sample data only, not a real partner.</div>
        <button type="button" className={btnPrimary} onClick={seed}>Create / refresh demo data</button>
        <button type="button" className={btnDanger} onClick={purge}>Remove demo data</button>
      </div>
      {creds && (
        <div className="p-4 rounded-xl bg-primary-soft border border-primary/30 text-sm">
          <p className="font-bold text-link">Demo operator created. Save this now, it is shown only once:</p>
          <p className="font-mono mt-1 break-all">Email: {creds.email}<br />Password: {creds.password}</p>
          <button type="button" className={btnGhost + ' mt-2'} onClick={() => setCreds(null)}>I saved it</button>
        </div>
      )}

      <div className="flex flex-wrap gap-2">
        <input className={inputCls + ' flex-1 min-w-[12rem]'} placeholder="Search company..." value={f.q} onChange={(e) => setF({ ...f, q: e.target.value })} />
        <select className={inputCls + ' w-auto'} value={f.status} onChange={(e) => setF({ ...f, status: e.target.value })}><option value="">All</option><option value="pending">Pending approval</option><option value="approved">Approved</option></select>
      </div>
      <DataTable loading={loading} error={error} onRetry={reload} rows={data?.operators} empty={{ title: 'No operators found' }}
        columns={[
          { label: 'Company', render: (o) => <><b className="text-fg"><Company o={o} /></b><span className="block text-subtle">{new Date(o.createdAt).toLocaleDateString()}</span></> },
          { label: 'Contact', render: (o) => <>{o.user.name}<span className="block text-subtle">{o.user.email} • {o.user.phone}</span></> },
          { label: 'Coaches', key: 'coaches' }, { label: 'Bookings', key: 'bookings' },
          { label: 'Status', render: (o) => <div className="space-x-1"><Badge tone={o.approved ? 'green' : 'amber'}>{o.approved ? 'approved' : 'pending'}</Badge>{o.blocked && <Badge tone="red">blocked</Badge>}</div> },
          { label: '', render: (o) => <div className="flex flex-wrap gap-2">
            {o.approved ? <button className={btnGhost} onClick={() => approve(o, false)}>Unapprove</button> : <button className={btnPrimary} onClick={() => approve(o, true)}>Approve</button>}
            <button className={o.blocked ? btnGhost : btnDanger} onClick={() => block(o)}>{o.blocked ? 'Unblock' : 'Block'}</button></div> }
        ]} />
    </div>
  );
}

// ---------------------------------------------------------------- Coaches
export function AdminCoaches() {
  const [f, setF] = useState({ q: '', active: '' });
  const { data, loading, error, reload } = useFetch('/coach/admin/coaches', f, { debounce: 300 });
  return (
    <div className="space-y-5">
      <PageHeader icon={Bus} title="Coaches" subtitle="All coaches across operators" />
      <div className="flex flex-wrap gap-2">
        <input className={inputCls + ' flex-1 min-w-[12rem]'} placeholder="Search coach name..." value={f.q} onChange={(e) => setF({ ...f, q: e.target.value })} />
        <select className={inputCls + ' w-auto'} value={f.active} onChange={(e) => setF({ ...f, active: e.target.value })}><option value="">All</option><option value="true">Active</option><option value="false">Inactive</option></select>
      </div>
      <DataTable loading={loading} error={error} onRetry={reload} rows={data?.coaches} empty={{ title: 'No coaches found' }}
        columns={[
          { label: 'Coach', render: (c) => <><b className="text-fg">{c.name}</b><span className="block text-subtle capitalize">{c.type} • {c.registrationNumber || 'no plate'}</span></> },
          { label: 'Operator', render: (c) => <Company o={c.operator} /> },
          { label: 'Seats', render: (c) => `${c.totalSeats} (${c.layout.left}+${c.layout.right})` },
          { label: 'Status', render: (c) => <Badge tone={c.isActive ? 'green' : 'slate'}>{c.isActive ? 'active' : 'inactive'}</Badge> },
          { label: '', render: (c) => <button className={btnGhost} onClick={() => act(api.patch(`/coach/admin/coaches/${c._id}/active`, { isActive: !c.isActive }), reload)}>{c.isActive ? 'Deactivate' : 'Activate'}</button> }
        ]} />
    </div>
  );
}

// ---------------------------------------------------------------- Routes
export function AdminRoutes() {
  const [q, setQ] = useState('');
  const { data, loading, error, reload } = useFetch('/coach/admin/routes', { q }, { debounce: 300 });
  return (
    <div className="space-y-5">
      <PageHeader icon={RouteIcon} title="Routes" subtitle="All city pairs across operators" />
      <input className={inputCls + ' max-w-md'} placeholder="Search city..." value={q} onChange={(e) => setQ(e.target.value)} />
      <DataTable loading={loading} error={error} onRetry={reload} rows={data?.routes} empty={{ title: 'No routes found' }}
        columns={[
          { label: 'Route', render: (r) => <b className="text-fg">{r.fromCity} → {r.toCity}</b> },
          { label: 'Operator', render: (r) => <Company o={r.operator} /> },
          { label: 'Distance', render: (r) => (r.distanceKm ? `${r.distanceKm} km` : '-') },
          { label: 'Status', render: (r) => <Badge tone={r.isActive ? 'green' : 'slate'}>{r.isActive ? 'active' : 'inactive'}</Badge> },
          { label: '', render: (r) => <button className={btnGhost} onClick={() => act(api.patch(`/coach/admin/routes/${r._id}/active`, { isActive: !r.isActive }), reload)}>{r.isActive ? 'Deactivate' : 'Activate'}</button> }
        ]} />
    </div>
  );
}

// ---------------------------------------------------------------- Schedules
export function AdminSchedules() {
  const [f, setF] = useState({ status: '', from: '', to: '' });
  const { data, loading, error, reload } = useFetch('/coach/admin/schedules', f);
  async function cancel(s) {
    const reason = await promptReason({ title: 'Cancel this trip?', message: `${s.bookedSeats} booking(s) will be cancelled and customers notified.`, reasons: ['Operator request', 'Safety / weather', 'Policy violation', 'Other'], confirmText: 'Cancel trip' });
    if (reason !== null) act(api.patch(`/coach/admin/schedules/${s._id}/cancel`, { reason }), reload);
  }
  return (
    <div className="space-y-5">
      <PageHeader icon={CalendarClock} title="Schedules" subtitle="Every departure on the platform" />
      <div className="flex flex-wrap gap-2 items-center text-xs text-muted">
        <select className={inputCls + ' w-auto'} value={f.status} onChange={(e) => setF({ ...f, status: e.target.value })}><option value="">All statuses</option><option value="scheduled">Scheduled</option><option value="completed">Completed</option><option value="cancelled">Cancelled</option></select>
        <label>From <input type="date" className={inputCls + ' w-auto inline-block'} value={f.from} onChange={(e) => setF({ ...f, from: e.target.value })} /></label>
        <label>To <input type="date" className={inputCls + ' w-auto inline-block'} value={f.to} onChange={(e) => setF({ ...f, to: e.target.value })} /></label>
      </div>
      <DataTable loading={loading} error={error} onRetry={reload} rows={data?.schedules} empty={{ title: 'No schedules found' }}
        columns={[
          { label: 'Trip', render: (s) => <><b className="text-fg">{s.fromCity} → {s.toCity}</b><span className="block text-subtle">{s.coach}</span></> },
          { label: 'Operator', render: (s) => <Company o={s.operator} /> },
          { label: 'Departure', render: (s) => <>{fmtDate(s.departureAt)}<span className="block text-subtle">{fmtTime(s.departureAt)} → {fmtTime(s.arrivalAt)}</span></> },
          { label: 'Fare', render: (s) => formatCurrency(s.fare) },
          { label: 'Seats', render: (s) => `${s.bookedSeats}/${s.totalSeats}` },
          { label: 'Status', render: (s) => <Badge tone={statusTone(s.status)}>{s.status}</Badge> },
          { label: '', render: (s) => s.status === 'scheduled' && <button className={btnDanger} onClick={() => cancel(s)}>Cancel</button> }
        ]} />
    </div>
  );
}

// ---------------------------------------------------------------- Coach bookings
export function AdminCoachBookings() {
  const [f, setF] = useState({ q: '', status: '', date: '' });
  const { data, loading, error, reload } = useFetch('/coach/admin/bookings', f, { debounce: 300 });
  async function cancel(b) {
    const reason = await promptReason({ title: `Cancel ${b.bookingCode}?`, message: 'The customer and operator are notified and the seat is released.', reasons: ['Customer request', 'Operator request', 'Fraud / abuse', 'Other'], confirmText: 'Cancel booking' });
    if (reason !== null) act(api.patch(`/coach/admin/bookings/${b._id}/cancel`, { reason }), reload);
  }
  return (
    <div className="space-y-5">
      <PageHeader icon={Ticket} title="Coach Bookings" subtitle="All intercity bookings" />
      <div className="flex flex-wrap gap-2">
        <input className={inputCls + ' flex-1 min-w-[12rem]'} placeholder="Search booking ID, passenger or phone..." value={f.q} onChange={(e) => setF({ ...f, q: e.target.value })} />
        <select className={inputCls + ' w-auto'} value={f.status} onChange={(e) => setF({ ...f, status: e.target.value })}><option value="">All statuses</option>{['CONFIRMED', 'COMPLETED', 'CANCELLED'].map((s) => <option key={s}>{s}</option>)}</select>
        <input type="date" className={inputCls + ' w-auto'} value={f.date} onChange={(e) => setF({ ...f, date: e.target.value })} />
      </div>
      <DataTable loading={loading} error={error} onRetry={reload} rows={data?.bookings} empty={{ title: 'No bookings found' }}
        columns={[
          { label: 'Booking', render: (b) => <><b className="font-mono text-fg">{b.bookingCode}</b><span className="block text-subtle">{b.operator?.companyName}</span></> },
          { label: 'Customer', render: (b) => <>{b.customer?.name}<span className="block text-subtle">{b.customer?.phone}</span></> },
          { label: 'Passenger', render: (b) => <>{b.passenger.name}<span className="block text-subtle">Seat {b.seat}</span></> },
          { label: 'Trip', render: (b) => <>{b.fromCity} → {b.toCity}<span className="block text-subtle">{fmtDate(b.departureAt)}, {fmtTime(b.departureAt)}</span></> },
          { label: 'Fare', render: (b) => formatCurrency(b.fare) },
          { label: 'Status', render: (b) => <Badge tone={statusTone(b.status)}>{b.status}</Badge> },
          { label: '', render: (b) => ['CONFIRMED', 'PENDING'].includes(b.status) && <button className={btnDanger} onClick={() => cancel(b)}>Cancel</button> }
        ]} />
    </div>
  );
}
