import { useState } from 'react';
import { CalendarClock, Plus } from 'lucide-react';
import { Link } from 'react-router-dom';
import api from '../../utils/api';
import useFetch from '../../hooks/useFetch';
import { getErrorMessage } from '../../utils/errors';
import { toast, promptReason } from '../../utils/toast';
import { useAuth } from '../../context/AuthContext';
import { formatCurrency } from '../../utils/formatters';
import { fmtDate, fmtTime, dayString, toIso } from '../../utils/dates';
import { PageHeader, DataTable, Badge, statusTone, Field, inputCls, btnPrimary, btnGhost, btnDanger } from '../../components/ui';

export default function OperatorSchedules() {
  const { user } = useAuth();
  const approved = user?.isVerified;
  const [status, setStatus] = useState('scheduled');
  const { data, loading, error, reload } = useFetch('/coach/operator/schedules', { status, upcoming: status === 'scheduled' ? 'true' : '' });
  const lists = useFetch('/coach/operator/coaches');
  const routes = useFetch('/coach/operator/routes');
  const [form, setForm] = useState(null);
  const [saving, setSaving] = useState(false);
  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });

  const coaches = (lists.data?.coaches || []).filter((c) => c.isActive);
  const rts = (routes.data?.routes || []).filter((r) => r.isActive);

  async function save(e) {
    e.preventDefault();
    try {
      setSaving(true);
      const route = rts.find((r) => r._id === form.routeId);
      const dep = toIso(form.date, form.depart);
      const body = { coachId: form.coachId, routeId: form.routeId, departureAt: dep, fare: Number(form.fare), repeatDays: Number(form.repeatDays) || 0 };
      if (form.arrive) {
        // arrival earlier than departure on the clock means "next day"
        let arr = new Date(toIso(form.date, form.arrive));
        if (arr <= new Date(dep)) arr = new Date(arr.getTime() + 86400000);
        body.arrivalAt = arr.toISOString();
      } else if (!route?.durationMin) { toast.error('Enter an arrival time (this route has no default duration).'); return; }
      const r = await api.post('/coach/operator/schedules', body);
      if (r.data.success) { toast.success(r.data.message); setForm(null); reload(true); } else toast.error(r.data.message);
    } catch (err) { toast.error(getErrorMessage(err)); } finally { setSaving(false); }
  }

  async function editFare(s) {
    const value = window.prompt(`New fare per seat for ${s.fromCity} → ${s.toCity}\n(existing bookings keep their fare)`, s.fare);
    if (value === null) return;
    try { const r = await api.patch(`/coach/operator/schedules/${s._id}`, { fare: Number(value) }); r.data.success ? (toast.success('Fare updated'), reload(true)) : toast.error(r.data.message); } catch (err) { toast.error(getErrorMessage(err)); }
  }

  async function cancel(s) {
    const reason = await promptReason({
      title: 'Cancel this trip?', message: `${s.bookedSeats} booked passenger(s) will be cancelled and notified.`,
      reasons: ['Vehicle breakdown', 'Road closed / weather', 'Not enough passengers', 'Other'], confirmText: 'Cancel trip'
    });
    if (reason === null) return;
    try { const r = await api.patch(`/coach/operator/schedules/${s._id}/cancel`, { reason }); r.data.success ? (toast.success(r.data.message), reload(true)) : toast.error(r.data.message); } catch (err) { toast.error(getErrorMessage(err)); }
  }

  return (
    <div className="space-y-5">
      <PageHeader icon={CalendarClock} title="Schedules" subtitle="Departures customers can book"
        action={<button type="button" disabled={!approved} onClick={() => setForm({ coachId: '', routeId: '', date: dayString(1), depart: '08:00', arrive: '', fare: '', repeatDays: 0 })} className={btnPrimary + ' flex items-center gap-1.5'}><Plus className="w-4 h-4" /> Add schedule</button>} />

      {form && (
        <form onSubmit={save} className="card p-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-4 items-end">
          <Field label="Coach"><select required className={inputCls} value={form.coachId} onChange={set('coachId')}><option value="">Select coach</option>{coaches.map((c) => <option key={c._id} value={c._id}>{c.name} ({c.totalSeats} seats)</option>)}</select></Field>
          <Field label="Route"><select required className={inputCls} value={form.routeId} onChange={set('routeId')}><option value="">Select route</option>{rts.map((r) => <option key={r._id} value={r._id}>{r.fromCity} → {r.toCity}</option>)}</select></Field>
          <Field label="Date"><input type="date" required min={dayString(0)} className={inputCls} value={form.date} onChange={set('date')} /></Field>
          <Field label="Departure time"><input type="time" required className={inputCls} value={form.depart} onChange={set('depart')} /></Field>
          <Field label="Arrival time" hint="Blank = route duration"><input type="time" className={inputCls} value={form.arrive} onChange={set('arrive')} /></Field>
          <Field label="Fare per seat (PKR)"><input type="number" required min={1} max={50000} className={inputCls} value={form.fare} onChange={set('fare')} /></Field>
          <Field label="Repeat for extra days" hint="0 = this day only (max 30)"><input type="number" min={0} max={30} className={inputCls} value={form.repeatDays} onChange={set('repeatDays')} /></Field>
          <div className="flex gap-2"><button className={btnPrimary} disabled={saving}>{saving ? 'Saving...' : 'Create'}</button><button type="button" className={btnGhost} onClick={() => setForm(null)}>Cancel</button></div>
        </form>
      )}

      <div className="flex gap-2">{[['scheduled', 'Upcoming'], ['completed', 'Completed'], ['cancelled', 'Cancelled']].map(([k, l]) => (
        <button key={k} type="button" onClick={() => setStatus(k)} className={`px-3 py-1.5 rounded-xl text-xs font-semibold border ${status === k ? 'bg-fg text-bg border-fg' : 'border-field-line text-muted hover:bg-surface-2'}`}>{l}</button>
      ))}</div>

      <DataTable loading={loading} error={error} onRetry={reload} rows={data?.schedules} empty={{ title: `No ${status === 'scheduled' ? 'upcoming' : status} schedules` }}
        columns={[
          { label: 'Route', render: (s) => <><b className="text-fg">{s.fromCity} → {s.toCity}</b><span className="block text-subtle">{s.coach?.name}</span></> },
          { label: 'Departure', render: (s) => <>{fmtDate(s.departureAt)}<span className="block text-subtle">{fmtTime(s.departureAt)} → {fmtTime(s.arrivalAt)}</span></> },
          { label: 'Fare', render: (s) => formatCurrency(s.fare) },
          { label: 'Seats', render: (s) => `${s.bookedSeats} booked / ${s.availableSeats} free` },
          { label: 'Status', render: (s) => <Badge tone={statusTone(s.status)}>{s.status}</Badge> },
          { label: '', render: (s) => <div className="flex gap-2"><Link to={`/operator/schedules/${s._id}/seatmap`} className={btnGhost}>Seat map</Link>{s.status === 'scheduled' && <><Link to={`/operator/schedules/${s._id}/tracking`} className={btnGhost}>Track</Link><button className={btnGhost} disabled={!approved} onClick={() => editFare(s)}>Fare</button><button className={btnDanger} disabled={!approved} onClick={() => cancel(s)}>Cancel</button></>}</div> }
        ]} />
    </div>
  );
}