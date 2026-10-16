import { useEffect, useState, useCallback } from 'react';
import { RefreshCw, Car, Package } from 'lucide-react';
import api from '../utils/api';
import { getErrorMessage } from '../utils/errors';
import { formatCurrency } from '../utils/formatters';

const STATUS_STYLES = {
  pending: 'text-warning',
  accepted: 'text-info',
  started: 'text-violet',
  completed: 'text-link',
  cancelled: 'text-danger'
};

// Shared admin table for rides and deliveries (search, status and date filters run on the backend).
export default function AdminServiceList({ kind }) {
  const isRide = kind === 'ride';
  const endpoint = isRide ? '/admin/rides' : '/admin/deliveries';
  const Icon = isRide ? Car : Package;

  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [selected, setSelected] = useState(null);
  const [filters, setFilters] = useState({ q: '', status: '', from: '', to: '' });

  const load = useCallback(async () => {
    try {
      setLoading(true);
      setError('');
      const params = Object.fromEntries(Object.entries(filters).filter(([, v]) => v));
      const response = await api.get(endpoint, { params });
      if (response.data.success) setItems(response.data[isRide ? 'rides' : 'deliveries']);
    } catch (err) {
      setError(getErrorMessage(err));
    } finally {
      setLoading(false);
    }
  }, [filters, endpoint, isRide]);

  useEffect(() => {
    const timer = setTimeout(load, 300);
    return () => clearTimeout(timer);
  }, [load]);

  const set = (key) => (e) => setFilters({ ...filters, [key]: e.target.value });

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-bold text-fg">All {isRide ? 'Ride' : 'Delivery'} Requests</h1>
        <p className="text-xs text-muted">Monitor system-wide {isRide ? 'ride' : 'delivery'} requests</p>
      </div>

      <div className="flex flex-wrap gap-2 items-center">
        <input type="text" value={filters.q} onChange={set('q')} placeholder="Search pickup or destination..."
          className="flex-1 min-w-[12rem] text-xs border border-field-line rounded-xl px-3 py-2 focus:outline-none focus:ring-2 focus:ring-primary bg-field text-fg" />
        <select value={filters.status} onChange={set('status')} className="text-xs border border-field-line rounded-xl px-2 py-2 bg-surface">
          <option value="">All statuses</option>
          <option value="pending">Pending</option>
          <option value="accepted">Accepted</option>
          <option value="started">Started</option>
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
            <p className="text-sm text-muted">Loading...</p>
          </div>
        ) : error ? (
          <div className="p-10 text-center space-y-2">
            <p className="text-sm text-danger">{error}</p>
            <button type="button" onClick={load} className="text-xs font-semibold text-link">Try again</button>
          </div>
        ) : items.length === 0 ? (
          <div className="p-10 text-center">
            <Icon className="w-8 h-8 text-subtle mx-auto mb-2" />
            <p className="text-sm font-semibold text-muted">Nothing found</p>
          </div>
        ) : (
          <table className="w-full text-left text-xs">
            <thead className="bg-surface-2 border-b border-line text-muted  font-semibold">
              <tr>
                <th className="px-4 py-3">ID</th>
                <th className="px-4 py-3">Customer</th>
                <th className="px-4 py-3">Driver</th>
                <th className="px-4 py-3">Route</th>
                <th className="px-4 py-3">Fare</th>
                <th className="px-4 py-3">Date</th>
                <th className="px-4 py-3">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {items.map((r) => (
                <tr key={r._id} onClick={() => setSelected(selected?._id === r._id ? null : r)} className="cursor-pointer hover:bg-surface-2">
                  <td className="px-4 py-3.5 font-bold text-fg">{isRide ? 'RD' : 'DL'}-{r._id.slice(-6).toUpperCase()}</td>
                  <td className="px-4 py-3.5">{r.customer?.name || '-'}</td>
                  <td className="px-4 py-3.5">{r.driver?.name || 'Unassigned'}</td>
                  <td className="px-4 py-3.5">{r.pickupLocation} → {r.destination}</td>
                  <td className="px-4 py-3.5 font-semibold text-fg">{formatCurrency(r.offeredFare)}</td>
                  <td className="px-4 py-3.5 text-muted">{new Date(r.createdAt).toLocaleDateString()}</td>
                  <td className={`px-4 py-3.5 font-bold capitalize ${STATUS_STYLES[r.status]}`}>{r.status}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {selected && (
        <div className="card p-5 text-xs grid gap-2 sm:grid-cols-2">
          <p className="sm:col-span-2 text-sm font-bold text-fg">Details</p>
          <p><span className="text-muted">Customer:</span> {selected.customer?.name} ({selected.customer?.phone})</p>
          <p><span className="text-muted">Driver:</span> {selected.driver ? `${selected.driver.name} (${selected.driver.phone}) — ${selected.driver.vehicleType} ${selected.driver.vehicleNumber}` : 'Unassigned'}</p>
          <p><span className="text-muted">Pickup:</span> {selected.pickupLocation}</p>
          <p><span className="text-muted">Destination:</span> {selected.destination}</p>
          <p><span className="text-muted">Distance / time:</span> {selected.distanceKm ?? '-'} km / {selected.durationMin ?? '-'} min</p>
          <p><span className="text-muted">Offered / estimated fare:</span> {formatCurrency(selected.offeredFare)} / {selected.estimatedFare != null ? formatCurrency(selected.estimatedFare) : '-'}</p>
          {isRide ? (
            <p><span className="text-muted">Vehicle:</span> <span className="capitalize">{selected.vehicleType}</span></p>
          ) : (
            <>
              <p><span className="text-muted">Receiver:</span> {selected.receiverName} ({selected.receiverPhone})</p>
              <p><span className="text-muted">Parcel:</span> <span className="capitalize">{selected.parcelType} · {selected.parcelSize}</span> — {selected.packageDescription}</p>
            </>
          )}
          {selected.notes && <p className="sm:col-span-2"><span className="text-muted">Notes:</span> {selected.notes}</p>}
        </div>
      )}
    </div>
  );
}
