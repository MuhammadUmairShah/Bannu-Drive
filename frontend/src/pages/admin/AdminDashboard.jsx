import { useEffect, useState, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { Users, Car, Package, AlertCircle, Radio, CheckCircle2, Clock, DollarSign, Percent, RefreshCw } from 'lucide-react';
import api from '../../utils/api';
import { getErrorMessage } from '../../utils/errors';
import { formatCurrency } from '../../utils/formatters';

const STATUS_STYLES = {
  pending: 'text-warning',
  accepted: 'text-info',
  started: 'text-violet',
  completed: 'text-link',
  cancelled: 'text-danger'
};

export default function AdminDashboard() {
  const [stats, setStats] = useState(null);
  const [activity, setActivity] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    try {
      setLoading(true);
      setError('');
      const response = await api.get('/admin/stats');
      if (response.data.success) {
        setStats(response.data.stats);
        setActivity(response.data.recentActivity || []);
      }
    } catch (err) {
      setError(getErrorMessage(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  if (loading) {
    return (
      <div className="py-20 text-center">
        <RefreshCw className="w-7 h-7 animate-spin text-link mx-auto mb-3" />
        <p className="text-sm text-muted">Loading dashboard...</p>
      </div>
    );
  }

  if (error || !stats) {
    return (
      <div className="py-20 text-center space-y-2">
        <p className="text-sm text-danger">{error || 'Could not load statistics'}</p>
        <button type="button" onClick={load} className="text-xs font-semibold text-link">Try again</button>
      </div>
    );
  }

  const cards = [
    { label: 'Customers', value: stats.totalCustomers, icon: Users, color: 'text-info bg-info-soft', to: '/admin/customers' },
    { label: 'Drivers', value: `${stats.totalDrivers} (${stats.verifiedDrivers} verified)`, icon: Car, color: 'text-link bg-primary-soft', to: '/admin/drivers' },
    { label: 'Online Drivers', value: stats.onlineDrivers, icon: Radio, color: 'text-success bg-success-soft', to: '/admin/drivers' },
    { label: 'Total Rides', value: stats.totalRides, icon: Car, color: 'text-muted bg-surface-2', to: '/admin/rides' },
    { label: 'Total Deliveries', value: stats.totalDeliveries, icon: Package, color: 'text-muted bg-surface-2', to: '/admin/deliveries' },
    { label: 'Completed Services', value: stats.completedServices, icon: CheckCircle2, color: 'text-link bg-primary-soft' },
    { label: 'Pending Services', value: stats.pendingServices, icon: Clock, color: 'text-warning bg-warning-soft' },
    { label: 'Open Complaints', value: stats.pendingComplaints, icon: AlertCircle, color: 'text-danger bg-danger-soft', to: '/admin/complaints' },
    { label: 'Revenue (fares)', value: formatCurrency(stats.totalRevenue), icon: DollarSign, color: 'text-info bg-info-soft' },
    { label: 'Commission', value: formatCurrency(stats.totalCommissionEarned), icon: Percent, color: 'text-link bg-primary-soft' }
  ];

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-fg">Platform Overview</h1>
          <p className="text-xs text-muted">Live statistics from the Bannu Drive database</p>
        </div>
        <button type="button" onClick={load} className="inline-flex items-center gap-2 px-3 py-2 rounded-xl bg-fg text-bg hover:bg-primary hover:text-on-primary transition-colors text-xs font-semibold">
          <RefreshCw className="w-3.5 h-3.5" /> Refresh
        </button>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5 gap-4">
        {cards.map((c) => {
          const Icon = c.icon;
          const body = (
            <div className="bg-surface p-4 rounded-xl border border-line shadow-sm flex items-center justify-between h-full hover:border-field-line">
              <div className="min-w-0">
                <p className="text-xs font-medium text-muted ">{c.label}</p>
                <p className="text-lg font-bold text-fg mt-1 break-words">{c.value}</p>
              </div>
              <div className={`p-2.5 rounded-xl shrink-0 ${c.color}`}><Icon className="w-5 h-5" /></div>
            </div>
          );
          return c.to ? <Link key={c.label} to={c.to}>{body}</Link> : <div key={c.label}>{body}</div>;
        })}
      </div>

      <div className="card overflow-hidden">
        <div className="px-6 py-4 border-b border-line"><h3 className="text-sm font-bold text-fg">Recent Activity</h3></div>
        {activity.length === 0 ? (
          <p className="p-8 text-center text-sm text-muted">No rides or deliveries yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="bg-surface-2 border-b border-line text-muted  font-semibold">
                <tr><th className="px-6 py-3">Type</th><th className="px-6 py-3">Customer</th><th className="px-6 py-3">Route</th><th className="px-6 py-3">Fare</th><th className="px-6 py-3">Status</th><th className="px-6 py-3">When</th></tr>
              </thead>
              <tbody className="divide-y divide-line">
                {activity.map((a) => (
                  <tr key={`${a.serviceType}-${a._id}`}>
                    <td className="px-6 py-3 capitalize">{a.serviceType}</td>
                    <td className="px-6 py-3">{a.customer?.name || '-'}</td>
                    <td className="px-6 py-3">{a.pickupLocation} → {a.destination}</td>
                    <td className="px-6 py-3 font-semibold">{formatCurrency(a.offeredFare)}</td>
                    <td className={`px-6 py-3 font-bold capitalize ${STATUS_STYLES[a.status]}`}>{a.status}</td>
                    <td className="px-6 py-3 text-muted">{new Date(a.createdAt).toLocaleString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
