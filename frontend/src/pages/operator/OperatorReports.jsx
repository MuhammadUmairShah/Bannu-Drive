import { useState } from 'react';
import { BarChart3 } from 'lucide-react';
import useFetch from '../../hooks/useFetch';
import { PageHeader, Loading, ErrorBox, EmptyBox, Stat, DataTable, inputCls } from '../../components/ui';
import { formatCurrency } from '../../utils/formatters';

export default function OperatorReports() {
  const [r, setR] = useState({ from: '', to: '' });
  const { data, loading, error, reload } = useFetch('/coach/operator/reports', r);
  const rep = data?.report;

  return (
    <div className="space-y-5">
      <PageHeader icon={BarChart3} title="Reports" subtitle="Bookings and revenue by departure date"
        action={<div className="flex gap-2 items-center text-xs text-muted"><label>From <input type="date" className={inputCls + ' w-auto inline-block'} value={r.from} onChange={(e) => setR({ ...r, from: e.target.value })} /></label><label>To <input type="date" className={inputCls + ' w-auto inline-block'} value={r.to} onChange={(e) => setR({ ...r, to: e.target.value })} /></label></div>} />
      {loading ? <Loading /> : error ? <ErrorBox message={error} onRetry={reload} /> : (
        <>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <Stat label="Bookings (not cancelled)" value={rep.totalBookings} />
            <Stat label="Revenue" value={formatCurrency(rep.revenue)} tone="green" />
            <Stat label="Completed" value={rep.byStatus.COMPLETED} />
            <Stat label="Cancelled" value={rep.byStatus.CANCELLED} tone="amber" />
          </div>
          <div className="grid gap-5 lg:grid-cols-2">
            <div><h2 className="text-sm font-bold text-fg mb-2">By route</h2>
              <DataTable rows={rep.routes} rowKey="route" empty={{ title: 'No bookings in this period' }} columns={[{ label: 'Route', key: 'route' }, { label: 'Bookings', key: 'bookings' }, { label: 'Revenue', render: (x) => formatCurrency(x.revenue) }]} /></div>
            <div><h2 className="text-sm font-bold text-fg mb-2">By day (departure date)</h2>
              {rep.daily.length === 0 ? <div className="card"><EmptyBox title="No bookings in this period" /></div> :
                <DataTable rows={rep.daily} rowKey="date" columns={[{ label: 'Date', key: 'date' }, { label: 'Bookings', key: 'bookings' }, { label: 'Revenue', render: (x) => formatCurrency(x.revenue) }]} />}</div>
          </div>
        </>
      )}
    </div>
  );
}
