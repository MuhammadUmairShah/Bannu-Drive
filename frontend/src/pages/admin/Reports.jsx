import { useEffect, useState, useCallback } from 'react';
import { RefreshCw } from 'lucide-react';
import api from '../../utils/api';
import { getErrorMessage } from '../../utils/errors';
import { formatCurrency } from '../../utils/formatters';

function Card({ label, value, tone = 'slate' }) {
  const tones = { slate: 'bg-surface border-line', green: 'bg-primary-soft border-primary/30' };
  return (
    <div className={`rounded-xl border p-4 shadow-sm ${tones[tone]}`}>
      <p className="text-xs font-semibold  text-muted">{label}</p>
      <p className="mt-1 text-xl font-bold text-fg">{value}</p>
    </div>
  );
}

const STATUS_ROWS = ['pending', 'accepted', 'started', 'completed', 'cancelled'];

export default function Reports() {
  const [report, setReport] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [range, setRange] = useState({ from: '', to: '' });

  const load = useCallback(async () => {
    try {
      setLoading(true);
      setError('');
      const params = Object.fromEntries(Object.entries(range).filter(([, v]) => v));
      const response = await api.get('/admin/reports', { params });
      if (response.data.success) setReport(response.data.report);
    } catch (err) {
      setError(getErrorMessage(err));
    } finally {
      setLoading(false);
    }
  }, [range]);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-fg">Reports & Analytics</h1>
          <p className="text-xs text-muted">Rides, deliveries, users, revenue, commission and driver earnings</p>
        </div>
        <div className="flex gap-2 items-center text-xs text-muted">
          <label className="flex items-center gap-1">From
            <input type="date" value={range.from} onChange={(e) => setRange({ ...range, from: e.target.value })} className="text-xs border border-field-line rounded-xl px-2 py-1.5" />
          </label>
          <label className="flex items-center gap-1">To
            <input type="date" value={range.to} onChange={(e) => setRange({ ...range, to: e.target.value })} className="text-xs border border-field-line rounded-xl px-2 py-1.5" />
          </label>
        </div>
      </div>

      {loading ? (
        <div className="py-16 text-center">
          <RefreshCw className="w-7 h-7 animate-spin text-link mx-auto mb-3" />
          <p className="text-sm text-muted">Loading reports...</p>
        </div>
      ) : error ? (
        <div className="py-16 text-center space-y-2">
          <p className="text-sm text-danger">{error}</p>
          <button type="button" onClick={load} className="text-xs font-semibold text-link">Try again</button>
        </div>
      ) : (
        <>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <Card label="Revenue (fares)" value={formatCurrency(report.revenue)} />
            <Card label="Platform commission" value={formatCurrency(report.commission)} tone="green" />
            <Card label="Driver earnings" value={formatCurrency(report.driverEarnings)} />
            <Card label="Paid trips" value={report.completedTransactions} />
            <Card label="New customers" value={report.newCustomers} />
            <Card label="New drivers" value={report.newDrivers} />
            <Card label="Total rides" value={report.rides.total} />
            <Card label="Total deliveries" value={report.deliveries.total} />
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            <div className="card overflow-hidden">
              <p className="px-5 py-3 text-sm font-bold text-fg border-b border-line">Trips by status</p>
              <table className="w-full text-xs">
                <thead className="bg-surface-2 text-muted "><tr><th className="px-5 py-2 text-left">Status</th><th className="px-5 py-2 text-right">Rides</th><th className="px-5 py-2 text-right">Deliveries</th></tr></thead>
                <tbody className="divide-y divide-line">
                  {STATUS_ROWS.map((s) => (
                    <tr key={s}><td className="px-5 py-2.5 capitalize">{s}</td><td className="px-5 py-2.5 text-right font-semibold">{report.rides[s]}</td><td className="px-5 py-2.5 text-right font-semibold">{report.deliveries[s]}</td></tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="card overflow-hidden">
              <p className="px-5 py-3 text-sm font-bold text-fg border-b border-line">Top drivers by earnings</p>
              {report.topDrivers.length === 0 ? (
                <p className="p-6 text-center text-xs text-subtle">No completed trips in this period.</p>
              ) : (
                <table className="w-full text-xs">
                  <thead className="bg-surface-2 text-muted "><tr><th className="px-5 py-2 text-left">Driver</th><th className="px-5 py-2 text-right">Trips</th><th className="px-5 py-2 text-right">Earnings</th></tr></thead>
                  <tbody className="divide-y divide-line">
                    {report.topDrivers.map((d) => (
                      <tr key={d._id}><td className="px-5 py-2.5">{d.name}</td><td className="px-5 py-2.5 text-right">{d.trips}</td><td className="px-5 py-2.5 text-right font-semibold">{formatCurrency(d.earnings)}</td></tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </div>

          <div className="card overflow-x-auto">
            <p className="px-5 py-3 text-sm font-bold text-fg border-b border-line">Daily revenue (latest 31 days with trips)</p>
            {report.daily.length === 0 ? (
              <p className="p-6 text-center text-xs text-subtle">No completed trips in this period.</p>
            ) : (
              <>
              {/* Bar view of the same rows (CSS only, follows the theme) */}
              <div className="flex h-32 items-end gap-1 border-b border-line px-5 pb-3 pt-5" role="img" aria-label="Daily revenue bars">
                {(() => {
                  const days = [...report.daily].sort((a, b) => String(a._id).localeCompare(String(b._id)));
                  const max = Math.max(...days.map((d) => d.fare || 0), 1);
                  return days.map((d) => (
                    <div
                      key={d._id}
                      title={`${d._id}: ${formatCurrency(d.fare)}`}
                      className="min-h-[3px] flex-1 rounded-t-md bg-primary/60 transition-colors hover:bg-primary"
                      style={{ height: `${Math.max(((d.fare || 0) / max) * 100, 2)}%` }}
                    />
                  ));
                })()}
              </div>
              <table className="w-full text-xs">
                <thead className="bg-surface-2 text-muted "><tr><th className="px-5 py-2 text-left">Date</th><th className="px-5 py-2 text-right">Trips</th><th className="px-5 py-2 text-right">Fares</th><th className="px-5 py-2 text-right">Commission</th></tr></thead>
                <tbody className="divide-y divide-line">
                  {report.daily.map((d) => (
                    <tr key={d._id}><td className="px-5 py-2.5">{d._id}</td><td className="px-5 py-2.5 text-right">{d.trips}</td><td className="px-5 py-2.5 text-right">{formatCurrency(d.fare)}</td><td className="px-5 py-2.5 text-right font-semibold">{formatCurrency(d.commission)}</td></tr>
                  ))}
                </tbody>
              </table>
              </>
            )}
          </div>
        </>
      )}
    </div>
  );
}
