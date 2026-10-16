import { useEffect, useState, useCallback } from 'react';
import { RefreshCw, Users } from 'lucide-react';
import Button from '../../components/Button';
import Modal from '../../components/Modal';
import api from '../../utils/api';
import { getErrorMessage } from '../../utils/errors';
import { toast } from '../../utils/toast';
import Avatar from '../../components/Avatar';

export default function AdminCustomers() {
  const [customers, setCustomers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selectedUser, setSelectedUser] = useState(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [actionLoading, setActionLoading] = useState(false);
  const [error, setError] = useState('');
  const [filters, setFilters] = useState({ q: '', blocked: '' });

  const loadCustomers = useCallback(async () => {
    try {
      setLoading(true);
      setError('');
      const params = Object.fromEntries(Object.entries(filters).filter(([, v]) => v));
      const response = await api.get('/admin/customers', { params });
      if (response.data.success) {
        setCustomers(response.data.customers);
      }
    } catch (err) {
      setError(getErrorMessage(err));
    } finally {
      setLoading(false);
    }
  }, [filters]);

  // Small delay so typing in the search box does not fire a request per key
  useEffect(() => {
    const timer = setTimeout(loadCustomers, 300);
    return () => clearTimeout(timer);
  }, [loadCustomers]);

  const toggleStatus = async () => {
    if (!selectedUser) return;

    try {
      setActionLoading(true);

      const response = await api.patch(`/admin/user/${selectedUser._id}/block`, {
        isBlocked: !selectedUser.isBlocked
      });

      if (response.data.success) {
        setCustomers((prev) =>
          prev.map((c) => (c._id === selectedUser._id ? response.data.user : c))
        );
        setModalOpen(false);
      } else {
        toast.error(response.data.message);
      }
    } catch (error) {
      console.log(error);
      toast.error(getErrorMessage(error));
    } finally {
      setActionLoading(false);
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-bold text-fg">Manage Customers</h1>
        <p className="text-xs text-muted">View and manage passenger customer accounts</p>
      </div>

      <div className="flex flex-wrap gap-2">
        <input
          type="text"
          value={filters.q}
          onChange={(e) => setFilters({ ...filters, q: e.target.value })}
          placeholder="Search name, email or phone..."
          className="flex-1 min-w-[12rem] text-xs border border-field-line rounded-xl px-3 py-2 focus:outline-none focus:ring-2 focus:ring-primary bg-field text-fg"
        />
        <select
          value={filters.blocked}
          onChange={(e) => setFilters({ ...filters, blocked: e.target.value })}
          className="text-xs border border-field-line rounded-xl px-2 py-2 bg-surface"
        >
          <option value="">All accounts</option>
          <option value="false">Active</option>
          <option value="true">Blocked</option>
        </select>
      </div>

      <div className="card overflow-x-auto">
        {loading ? (
          <div className="p-10 text-center">
            <RefreshCw className="w-6 h-6 animate-spin text-link mx-auto mb-2" />
            <p className="text-sm text-muted">Loading customers...</p>
          </div>
        ) : error ? (
          <div className="p-10 text-center space-y-2">
            <p className="text-sm text-danger">{error}</p>
            <button type="button" onClick={loadCustomers} className="text-xs font-semibold text-link">Try again</button>
          </div>
        ) : customers.length === 0 ? (
          <div className="p-10 text-center">
            <Users className="w-8 h-8 text-subtle mx-auto mb-2" />
            <p className="text-sm font-semibold text-muted">No customers found</p>
          </div>
        ) : (
          <table className="w-full text-left text-xs">
            <thead className="bg-surface-2 border-b border-line text-muted  font-semibold">
              <tr>
                <th className="px-6 py-3">Name</th>
                <th className="px-6 py-3">Phone / Email</th>
                <th className="px-6 py-3">Status</th>
                <th className="px-6 py-3">Joined Date</th>
                <th className="px-6 py-3">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {customers.map((c) => (
                <tr key={c._id}>
                  <td className="px-6 py-3.5 font-semibold text-fg">
                    <span className="flex items-center gap-2"><Avatar user={c} size="xs" />{c.name}</span>
                  </td>
                  <td className="px-6 py-3.5">{c.phone} • {c.email}</td>
                  <td className="px-6 py-3.5">
                    <span className={`px-2 py-0.5 rounded-full text-xs font-bold ${
                      !c.isBlocked ? 'bg-primary-soft text-link' : 'bg-danger-soft text-danger'
                    }`}>
                      {c.isBlocked ? 'Blocked' : 'Active'}
                    </span>
                  </td>
                  <td className="px-6 py-3.5 text-muted">{new Date(c.createdAt).toLocaleDateString()}</td>
                  <td className="px-6 py-3.5">
                    <Button
                      size="sm"
                      variant={!c.isBlocked ? 'danger' : 'primary'}
                      onClick={() => { setSelectedUser(c); setModalOpen(true); }}
                    >
                      {!c.isBlocked ? 'Block' : 'Activate'}
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <Modal isOpen={modalOpen} onClose={() => setModalOpen(false)} title="Confirm Status Action">
        <p className="text-xs text-muted mb-4">
          Are you sure you want to {selectedUser?.isBlocked ? 'activate' : 'block'} <span className="font-bold">{selectedUser?.name}</span>?
        </p>
        <div className="flex justify-end space-x-2">
          <Button variant="outline" size="sm" onClick={() => setModalOpen(false)}>Cancel</Button>
          <Button variant="danger" size="sm" onClick={toggleStatus} disabled={actionLoading}>
            {actionLoading ? 'Please wait...' : 'Confirm Change'}
          </Button>
        </div>
      </Modal>
    </div>
  );
}
