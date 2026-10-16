import { useEffect, useState, useCallback } from 'react';
import { RefreshCw, Car, Package, AlertCircle } from 'lucide-react';
import api from '../utils/api';
import { getErrorMessage } from '../utils/errors';
import { formatCurrency } from '../utils/formatters';

const STATUS_STYLE = {
  completed: 'bg-primary-soft text-link',
  cancelled: 'bg-danger-soft text-danger'
};

// Shared history table for customer/driver, rides/deliveries.
//   kind: 'ride' | 'delivery'     audience: 'customer' | 'driver'
export default function HistoryList({ kind, audience, title, subtitle }) {
  const isRide = kind === 'ride';
  const Icon = isRide ? Car : Package;
  const endpoint = isRide ? '/ride/history' : '/delivery/history';
  const prefix = isRide ? 'RD' : 'DL';

  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [filters, setFilters] = useState({ q: '', status: '', from: '', to: '' });

  const load = useCallback(async () => {
    try {
      setLoading(true);
      setError('');
      const params = Object.fromEntries(Object.entries(filters).filter(([, v]) => v));
      const response = await api.get(endpoint, { params });
      if (response.data.success) setItems(response.data[isRide ? 'rides' : 'deliveries'] || []);
    } catch (err) {
      setError(getErrorMessage(err, 'Could not load history'));
    } finally {
      setLoading(false);
    }
  }, [filters, endpoint, isRide]);

  // Small delay so typing in the search box does not fire a request per key
  useEffect(() => {
    const timer = setTimeout(load, 300);
    return () => clearTimeout(timer);
  }, [load]);

  const set = (key) => (e) => setFilters({ ...filters, [key]: e.target.value });
  const filtered = Object.values(filters).some(Boolean);

  const otherParty = audience === 'driver' ? 'Customer' : 'Driver';

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-bold text-fg">{title}</h1>
        <p className="text-xs text-muted">{subtitle}</p>
      </div>

      <div className="flex flex-wrap gap-2 items-center">
        <input
          type="text"
          value={filters.q}
          onChange={set('q')}
          placeholder="Search pickup or destination..."
          className="flex-1 min-w-[12rem] text-xs border border-field-line rounded-xl px-3 py-2 focus:outline-none focus:ring-2 focus:ring-primary bg-field text-fg"
        />
        <select value={filters.status} onChange={set('status')} className="text-xs border border-field-line rounded-xl px-2 py-2 bg-surface">
          <option value="">Completed & cancelled</option>
          <option value="completed">Completed</option>
          <option value="cancelled">Cancelled</option>
        </select>
        <label className="text-xs text-muted flex items-center gap-1">From
          <input type="date" value={filters.from} onChange={set('from')} className="text-xs border border-field-line rounded-xl px-2 py-1.5" />
        </label>
        <label className="text-xs text-muted flex items-center gap-1">To
          <input type="date" value={filters.to} onChange={set('to')} className="text-xs border border-field-line rounded-xl px-2 py-1.5" />
        </label>
      </div>

      <div className="card overflow-x-auto">
        {loading ? (
          <div className="p-10 text-center">
            <RefreshCw className="w-6 h-6 animate-spin text-link mx-auto mb-2" />
            <p className="text-sm text-muted">Loading history...</p>
          </div>
        ) : error ? (
          <div className="p-10 text-center space-y-3">
            <AlertCircle className="w-8 h-8 text-danger mx-auto" />
            <p className="text-sm text-danger">{error}</p>
            <button type="button" onClick={load} className="px-4 py-2 rounded-xl bg-fg text-bg hover:bg-primary hover:text-on-primary text-xs font-semibold transition-colors">
              Try again
            </button>
          </div>
        ) : items.length === 0 ? (
          <div className="p-10 text-center">
            <Icon className="w-8 h-8 text-subtle mx-auto mb-2" />
            <p className="text-sm font-semibold text-muted">{filtered ? 'Nothing matches these filters' : `No past ${isRide ? 'rides' : 'deliveries'} yet`}</p>
            <p className="text-xs text-subtle mt-1">
              {filtered ? 'Try clearing the search or dates.' : 'Completed or cancelled trips will show up here.'}
            </p>
          </div>
        ) : (
          <table className="w-full min-w-[40rem] text-left text-xs">
            <thead className="bg-surface-2 border-b border-line text-muted  font-semibold">
              <tr>
                <th className="px-4 sm:px-6 py-3">ID</th>
                <th className="px-4 sm:px-6 py-3">{otherParty}</th>
                <th className="px-4 sm:px-6 py-3">Route</th>
                <th className="px-4 sm:px-6 py-3">Fare</th>
                <th className="px-4 sm:px-6 py-3">Status</th>
                <th className="px-4 sm:px-6 py-3">Date</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {items.map((r) => {
                const party = audience === 'driver' ? r.customer?.name : r.driver?.name;
                return (
                  <tr key={r._id}>
                    <td className="px-4 sm:px-6 py-3.5 font-bold text-fg">{prefix}-{r._id.slice(-6).toUpperCase()}</td>
                    <td className="px-4 sm:px-6 py-3.5">
                      {party || (r.status === 'cancelled' ? '-' : 'Unassigned')}
                      {isRide && audience === 'customer' && r.vehicleType && (
                        <span className="block text-xs text-subtle capitalize">{r.vehicleType}</span>
                      )}
                    </td>
                    <td className="px-4 sm:px-6 py-3.5">{r.pickupLocation} → {r.destination}</td>
                    <td className="px-4 sm:px-6 py-3.5 font-semibold text-fg">{formatCurrency(r.offeredFare)}</td>
                    <td className="px-4 sm:px-6 py-3.5">
                      <span className={`px-2 py-0.5 rounded-full text-xs font-bold capitalize ${STATUS_STYLE[r.status] || 'bg-surface-2 text-fg'}`}>
                        {r.status}
                      </span>
                    </td>
                    <td className="px-4 sm:px-6 py-3.5 text-muted whitespace-nowrap">{new Date(r.createdAt).toLocaleDateString()}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
