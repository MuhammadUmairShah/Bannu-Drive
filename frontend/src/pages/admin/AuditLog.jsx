import { useCallback, useEffect, useState } from 'react';
import { ScrollText } from 'lucide-react';
import api from '../../utils/api';
import { getErrorMessage } from '../../utils/errors';
import { PageHeader, DataTable, Badge, inputCls, btnGhost } from '../../components/ui';
import { fmtDate } from '../../components/verification/docUtils';

const GROUPS = [
  ['', 'Everything'], ['auth.*', 'Sign-ins & security'], ['document.*', 'Documents'], ['verification.*', 'Verification outcomes'],
  ['account.*', 'Block / activate'], ['booking.*', 'Booking cancellations'], ['schedule.*', 'Schedules'], ['operator.*', 'Operator approval'], ['driver.*', 'Driver verification']
];

export default function AuditLog() {
  const [action, setAction] = useState('');
  const [rows, setRows] = useState([]);
  const [page, setPage] = useState(1);
  const [pages, setPages] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api.get('/admin/audit-logs', { params: { ...(action ? { action } : {}), page } });
      setRows(res.data.items);
      setPages(res.data.pages);
      setError('');
    } catch (err) {
      setError(getErrorMessage(err));
    } finally {
      setLoading(false);
    }
  }, [action, page]);

  useEffect(() => { load(); }, [load]);

  const meta = (m) => Object.entries(m || {}).filter(([, v]) => v !== '' && v != null).slice(0, 4).map(([k, v]) => `${k}: ${String(v).slice(0, 40)}`).join(' • ');

  return (
    <div className="space-y-5">
      <PageHeader icon={ScrollText} title="Audit log" subtitle="A permanent record of sensitive actions: who did what, to what, and when." />
      <div className="card p-4">
        <label className="text-xs font-semibold text-fg">Show
          <select className={`${inputCls} mt-1 max-w-xs`} value={action} onChange={(e) => { setPage(1); setAction(e.target.value); }}>
            {GROUPS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
        </label>
      </div>
      <DataTable
        rows={rows}
        loading={loading}
        error={error}
        onRetry={load}
        empty={{ title: 'No entries yet' }}
        columns={[
          { label: 'When', render: (r) => <span className="whitespace-nowrap">{fmtDate(r.createdAt)}</span> },
          { label: 'Who', render: (r) => (r.actor ? <div><p className="font-semibold">{r.actor.name}</p><p className="text-[11px] capitalize text-muted">{r.actorRole || r.actor.role}</p></div> : <span className="text-muted capitalize">{r.actorRole || 'system'}</span>) },
          { label: 'Action', render: (r) => <Badge>{r.action}</Badge> },
          { label: 'Target', render: (r) => <span className="text-[11px] text-muted">{r.entityType} {String(r.entityId).slice(-6)}</span> },
          { label: 'Details', render: (r) => <span className="text-[11px] text-muted">{meta(r.meta)}</span> }
        ]}
      />
      {pages > 1 && (
        <div className="flex items-center justify-center gap-3 text-xs">
          <button className={btnGhost} disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>Previous</button>
          <span className="text-muted">Page {page} of {pages}</span>
          <button className={btnGhost} disabled={page >= pages} onClick={() => setPage((p) => p + 1)}>Next</button>
        </div>
      )}
    </div>
  );
}
