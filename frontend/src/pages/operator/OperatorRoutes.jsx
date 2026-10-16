import { useState } from 'react';
import { Route as RouteIcon, Plus } from 'lucide-react';
import api from '../../utils/api';
import useFetch from '../../hooks/useFetch';
import { getErrorMessage } from '../../utils/errors';
import { toast } from '../../utils/toast';
import { useAuth } from '../../context/AuthContext';
import { PageHeader, DataTable, Badge, Field, inputCls, btnPrimary, btnGhost } from '../../components/ui';

export default function OperatorRoutes() {
  const { user } = useAuth();
  const { data, loading, error, reload } = useFetch('/coach/operator/routes');
  const [form, setForm] = useState(null);
  const [saving, setSaving] = useState(false);
  const approved = user?.isVerified;
  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });

  async function save(e) {
    e.preventDefault();
    try {
      setSaving(true);
      const r = await api.post('/coach/operator/routes', form);
      if (r.data.success) { toast.success('Route added'); setForm(null); reload(true); } else toast.error(r.data.message);
    } catch (err) { toast.error(getErrorMessage(err)); } finally { setSaving(false); }
  }
  async function toggle(rt) {
    try { await api.patch(`/coach/operator/routes/${rt._id}`, { isActive: !rt.isActive }); reload(true); } catch (err) { toast.error(getErrorMessage(err)); }
  }

  return (
    <div className="space-y-5">
      <PageHeader icon={RouteIcon} title="Routes" subtitle="City pairs you operate. Any two cities work."
        action={<button type="button" disabled={!approved} onClick={() => setForm({ fromCity: '', toCity: '', distanceKm: '', durationMin: '' })} className={btnPrimary + ' flex items-center gap-1.5'}><Plus className="w-4 h-4" /> Add route</button>} />

      {form && (
        <form onSubmit={save} className="card p-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-4 items-end">
          <Field label="From city"><input required minLength={2} maxLength={50} className={inputCls} value={form.fromCity} onChange={set('fromCity')} placeholder="Bannu" /></Field>
          <Field label="To city"><input required minLength={2} maxLength={50} className={inputCls} value={form.toCity} onChange={set('toCity')} placeholder="Peshawar" /></Field>
          <Field label="Distance (km)" hint="Optional"><input type="number" min={0} className={inputCls} value={form.distanceKm} onChange={set('distanceKm')} /></Field>
          <Field label="Duration (minutes)" hint="Used as default arrival time"><input type="number" min={0} className={inputCls} value={form.durationMin} onChange={set('durationMin')} /></Field>
          <div className="flex gap-2"><button className={btnPrimary} disabled={saving}>{saving ? 'Saving...' : 'Add route'}</button><button type="button" className={btnGhost} onClick={() => setForm(null)}>Cancel</button></div>
        </form>
      )}

      <DataTable loading={loading} error={error} onRetry={reload} rows={data?.routes} empty={{ title: 'No routes yet', hint: approved ? 'Add the city pairs you serve.' : 'Available once an admin approves your account.' }}
        columns={[
          { label: 'Route', render: (r) => <b className="text-fg">{r.fromCity} → {r.toCity}</b> },
          { label: 'Distance', render: (r) => (r.distanceKm ? `${r.distanceKm} km` : '-') },
          { label: 'Duration', render: (r) => (r.durationMin ? `${Math.floor(r.durationMin / 60)}h ${r.durationMin % 60}m` : '-') },
          { label: 'Status', render: (r) => <Badge tone={r.isActive ? 'green' : 'slate'}>{r.isActive ? 'active' : 'inactive'}</Badge> },
          { label: '', render: (r) => <button className={btnGhost} disabled={!approved} onClick={() => toggle(r)}>{r.isActive ? 'Deactivate' : 'Activate'}</button> }
        ]} />
    </div>
  );
}
