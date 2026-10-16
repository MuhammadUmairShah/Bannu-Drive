import { useEffect, useState, useCallback } from 'react';
import { RefreshCw, Car } from 'lucide-react';
import Button from '../../components/Button';
import api from '../../utils/api';
import { getErrorMessage } from '../../utils/errors';
import { toast } from '../../utils/toast';
import Avatar from '../../components/Avatar';

export default function AdminDrivers() {
  const [drivers, setDrivers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [actionId, setActionId] = useState(null);
  const [error, setError] = useState('');
  const [filters, setFilters] = useState({ q: '', verified: '', driverStatus: '', blocked: '' });

  const loadDrivers = useCallback(async () => {
    try {
      setLoading(true);
      setError('');
      const params = Object.fromEntries(Object.entries(filters).filter(([, v]) => v));
      const response = await api.get('/admin/drivers', { params });
      if (response.data.success) setDrivers(response.data.drivers);
    } catch (err) {
      setError(getErrorMessage(err));
    } finally {
      setLoading(false);
    }
  }, [filters]);

  useEffect(() => {
    const timer = setTimeout(loadDrivers, 300);
    return () => clearTimeout(timer);
  }, [loadDrivers]);

  const verifyDriver = async (id, isVerified = true) => {
    try {
      setActionId(id);
      const response = await api.patch(`/admin/user/${id}/verify`, { isVerified });
      if (response.data.success) {
        setDrivers((prev) =>
          prev.map((d) =>
            d._id === id
              ? { ...d, isVerified, driverStatus: !isVerified && d.driverStatus === 'online' ? 'offline' : d.driverStatus }
              : d
          )
        );
      } else {
        toast.error(response.data.message);
      }
    } catch (error) {
      console.log(error);
      toast.error(getErrorMessage(error));
    } finally {
      setActionId(null);
    }
  };

  const toggleBlock = async (driver) => {
    try {
      setActionId(driver._id);
      const response = await api.patch(`/admin/user/${driver._id}/block`, {
        isBlocked: !driver.isBlocked
      });
      if (response.data.success) {
        setDrivers((prev) => prev.map((d) => (d._id === driver._id ? { ...d, ...response.data.user } : d)));
      } else {
        toast.error(response.data.message);
      }
    } catch (error) {
      console.log(error);
      toast.error(getErrorMessage(error));
    } finally {
      setActionId(null);
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-bold text-fg">Manage Drivers & Verification</h1>
        <p className="text-xs text-muted">Approve riders and verify vehicle document submissions</p>
      </div>

      <div className="flex flex-wrap gap-2">
        <input type="text" value={filters.q} onChange={(e) => setFilters({ ...filters, q: e.target.value })}
          placeholder="Search name, phone, email or plate..."
          className="flex-1 min-w-[12rem] text-xs border border-field-line rounded-xl px-3 py-2 focus:outline-none focus:ring-2 focus:ring-primary bg-field text-fg" />
        <select value={filters.verified} onChange={(e) => setFilters({ ...filters, verified: e.target.value })}
          className="text-xs border border-field-line rounded-xl px-2 py-2 bg-surface">
          <option value="">All verification</option><option value="true">Verified</option><option value="false">Pending</option>
        </select>
        <select value={filters.driverStatus} onChange={(e) => setFilters({ ...filters, driverStatus: e.target.value })}
          className="text-xs border border-field-line rounded-xl px-2 py-2 bg-surface">
          <option value="">Any availability</option><option value="online">Online</option><option value="busy">Busy</option><option value="offline">Offline</option>
        </select>
        <select value={filters.blocked} onChange={(e) => setFilters({ ...filters, blocked: e.target.value })}
          className="text-xs border border-field-line rounded-xl px-2 py-2 bg-surface">
          <option value="">All accounts</option><option value="false">Active</option><option value="true">Blocked</option>
        </select>
      </div>

      <div className="card overflow-x-auto">
        {loading ? (
          <div className="p-10 text-center">
            <RefreshCw className="w-6 h-6 animate-spin text-link mx-auto mb-2" />
            <p className="text-sm text-muted">Loading drivers...</p>
          </div>
        ) : error ? (
          <div className="p-10 text-center space-y-2">
            <p className="text-sm text-danger">{error}</p>
            <button type="button" onClick={loadDrivers} className="text-xs font-semibold text-link">Try again</button>
          </div>
        ) : drivers.length === 0 ? (
          <div className="p-10 text-center">
            <Car className="w-8 h-8 text-subtle mx-auto mb-2" />
            <p className="text-sm font-semibold text-muted">No drivers found</p>
          </div>
        ) : (
          <table className="w-full text-left text-xs">
            <thead className="bg-surface-2 border-b border-line text-muted  font-semibold">
              <tr>
                <th className="px-6 py-3">Name / Phone</th>
                <th className="px-6 py-3">Vehicle</th>
                <th className="px-6 py-3">Rating</th>
                <th className="px-6 py-3">Verification</th>
                <th className="px-6 py-3">Availability</th>
                <th className="px-6 py-3">Account Status</th>
                <th className="px-6 py-3">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {drivers.map((d) => (
                <tr key={d._id}>
                  <td className="px-6 py-3.5 font-semibold text-fg">
                    <span className="flex items-center gap-2"><Avatar user={d} size="xs" />{d.name} ({d.phone})</span>
                  </td>
                  <td className="px-6 py-3.5 capitalize">{d.vehicleType} {d.vehicleModel} ({d.vehicleNumber})</td>
                  <td className="px-6 py-3.5">{d.rating?.count ? `${d.rating.average} (${d.rating.count})` : '-'}</td>
                  <td className="px-6 py-3.5">
                    <span className={`px-2 py-0.5 rounded-full text-xs font-bold ${
                      d.isVerified ? 'bg-primary-soft text-link' : 'bg-warning-soft text-warning'
                    }`}>
                      {d.isVerified ? 'Verified' : 'Pending'}
                    </span>
                  </td>
                  <td className="px-6 py-3.5 capitalize">{d.driverStatus || 'offline'}</td>
                  <td className="px-6 py-3.5">
                    <span className={`px-2 py-0.5 rounded-full text-xs font-bold ${
                      !d.isBlocked ? 'bg-primary-soft text-link' : 'bg-danger-soft text-danger'
                    }`}>
                      {d.isBlocked ? 'Blocked' : 'Active'}
                    </span>
                  </td>
                  <td className="px-6 py-3.5 space-x-2">
                    {!d.isVerified ? (
                      <Button size="sm" variant="primary" onClick={() => verifyDriver(d._id, true)} disabled={actionId === d._id}>
                        Approve & Verify
                      </Button>
                    ) : (
                      <Button size="sm" variant="outline" onClick={() => verifyDriver(d._id, false)} disabled={actionId === d._id}>
                        Remove Verification
                      </Button>
                    )}
                    <Button size="sm" variant={!d.isBlocked ? 'danger' : 'outline'} onClick={() => toggleBlock(d)} disabled={actionId === d._id}>
                      {!d.isBlocked ? 'Block' : 'Activate'}
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
