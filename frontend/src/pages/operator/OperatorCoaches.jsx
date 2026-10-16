import { useState } from 'react';
import { Bus, Plus } from 'lucide-react';
import api from '../../utils/api';
import useFetch from '../../hooks/useFetch';
import { getErrorMessage } from '../../utils/errors';
import { toast } from '../../utils/toast';
import { useAuth } from '../../context/AuthContext';
import SeatMap from '../../components/SeatMap';
import { PageHeader, DataTable, Badge, Field, inputCls, btnPrimary, btnGhost } from '../../components/ui';

const TYPES = ['standard', 'executive', 'luxury', 'minibus'];
const blank = { name: '', type: 'standard', registrationNumber: '', amenities: '', rows: 10, left: 2, right: 2, blocked: '' };

// Preview that mirrors how the server numbers seats (row by row)
function previewSeats(f) {
  const rows = Math.min(Math.max(Number(f.rows) || 1, 1), 20), left = Math.min(Math.max(Number(f.left) || 1, 1), 3), right = Math.min(Math.max(Number(f.right) || 0, 0), 3);
  const blocked = new Set(f.blocked.split(',').map((x) => x.trim()).filter(Boolean));
  const seats = []; let n = 0;
  for (let row = 0; row < rows; row++) for (let col = 0; col < left + right; col++) {
    n += 1; const label = String(n).padStart(2, '0');
    seats.push({ label, row, col, side: col < left ? 'left' : 'right', status: blocked.has(label) ? 'BLOCKED' : 'AVAILABLE' });
  }
  return { layout: { rows, left, right }, seats };
}

export default function OperatorCoaches() {
  const { user } = useAuth();
  const { data, loading, error, reload } = useFetch('/coach/operator/coaches');
  const [form, setForm] = useState(null); // null = closed
  const [editing, setEditing] = useState(null);
  const [saving, setSaving] = useState(false);
  const approved = user?.isVerified;

  const open = (c) => {
    setEditing(c?._id || null);
    setForm(c ? { name: c.name, type: c.type, registrationNumber: c.registrationNumber, amenities: c.amenities.join(', '), rows: c.layout.rows, left: c.layout.left, right: c.layout.right, blocked: c.layout.blocked.join(', ') } : blank);
  };
  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });

  async function save(e) {
    e.preventDefault();
    const body = {
      name: form.name, type: form.type, registrationNumber: form.registrationNumber,
      amenities: form.amenities.split(',').map((x) => x.trim()).filter(Boolean),
      layout: { rows: Number(form.rows), left: Number(form.left), right: Number(form.right), blocked: form.blocked.split(',').map((x) => x.trim()).filter(Boolean) }
    };
    try {
      setSaving(true);
      const r = editing ? await api.patch(`/coach/operator/coaches/${editing}`, body) : await api.post('/coach/operator/coaches', body);
      if (r.data.success) { toast.success(r.data.message); setForm(null); reload(true); } else toast.error(r.data.message);
    } catch (err) { toast.error(getErrorMessage(err)); } finally { setSaving(false); }
  }

  async function toggle(c) {
    try { await api.patch(`/coach/operator/coaches/${c._id}`, { isActive: !c.isActive }); reload(true); } catch (err) { toast.error(getErrorMessage(err)); }
  }

  const preview = form ? previewSeats(form) : null;

  return (
    <div className="space-y-5">
      <PageHeader icon={Bus} title="Coaches" subtitle="Your vehicles and their seat layouts"
        action={<button type="button" disabled={!approved} onClick={() => open(null)} className={btnPrimary + ' flex items-center gap-1.5'}><Plus className="w-4 h-4" /> Add coach</button>} />

      {form && (
        <form onSubmit={save} className="card p-5 grid gap-5 lg:grid-cols-[1fr_20rem]">
          <div className="grid gap-3 sm:grid-cols-2 content-start">
            <Field label="Coach name"><input required minLength={2} maxLength={60} className={inputCls} value={form.name} onChange={set('name')} placeholder="e.g. Express 40" /></Field>
            <Field label="Type"><select className={inputCls} value={form.type} onChange={set('type')}>{TYPES.map((t) => <option key={t} value={t} className="capitalize">{t}</option>)}</select></Field>
            <Field label="Registration number"><input maxLength={20} className={inputCls} value={form.registrationNumber} onChange={set('registrationNumber')} /></Field>
            <Field label="Amenities" hint="Comma separated, max 8"><input className={inputCls} value={form.amenities} onChange={set('amenities')} placeholder="Air conditioning, Reclining seats" /></Field>
            <Field label="Rows (1-20)"><input type="number" min={1} max={20} className={inputCls} value={form.rows} onChange={set('rows')} /></Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Left seats"><input type="number" min={1} max={3} className={inputCls} value={form.left} onChange={set('left')} /></Field>
              <Field label="Right seats"><input type="number" min={0} max={3} className={inputCls} value={form.right} onChange={set('right')} /></Field>
            </div>
            <div className="sm:col-span-2"><Field label="Seats not for sale" hint="Seat numbers, comma separated, e.g. 01, 02"><input className={inputCls} value={form.blocked} onChange={set('blocked')} /></Field></div>
            <p className="sm:col-span-2 text-xs text-muted">Sellable seats: <b>{preview.seats.filter((s) => s.status === 'AVAILABLE').length}</b>. Changes only apply to schedules you create afterwards.</p>
            <div className="sm:col-span-2 flex gap-2"><button className={btnPrimary} disabled={saving}>{saving ? 'Saving...' : editing ? 'Save changes' : 'Add coach'}</button><button type="button" className={btnGhost} onClick={() => setForm(null)}>Cancel</button></div>
          </div>
          <div><p className="text-xs font-semibold text-fg mb-2">Layout preview</p><SeatMap layout={preview.layout} seats={preview.seats} readOnly /></div>
        </form>
      )}

      <DataTable loading={loading} error={error} onRetry={reload} rows={data?.coaches}
        empty={{ title: 'No coaches yet', hint: approved ? 'Add your first coach.' : 'Available once an admin approves your account.' }}
        columns={[
          { label: 'Coach', render: (c) => <><b className="text-fg">{c.name}</b><span className="block text-subtle capitalize">{c.type} • {c.registrationNumber || 'no plate'}</span></> },
          { label: 'Seats', render: (c) => `${c.totalSeats} (${c.layout.rows} rows, ${c.layout.left}+${c.layout.right})` },
          { label: 'Amenities', render: (c) => c.amenities.join(', ') || '-' },
          { label: 'Status', render: (c) => <Badge tone={c.isActive ? 'green' : 'slate'}>{c.isActive ? 'active' : 'inactive'}</Badge> },
          { label: '', render: (c) => <div className="flex gap-2"><button className={btnGhost} disabled={!approved} onClick={() => open(c)}>Edit</button><button className={btnGhost} disabled={!approved} onClick={() => toggle(c)}>{c.isActive ? 'Deactivate' : 'Activate'}</button></div> }
        ]} />
    </div>
  );
}
