import { useEffect, useState, useCallback } from 'react';
import { RefreshCw, AlertCircle } from 'lucide-react';
import api from '../../utils/api';
import { getErrorMessage } from '../../utils/errors';
import { toast } from '../../utils/toast';

const STATUS_STYLES = {
  pending: 'bg-warning-soft text-warning',
  in_review: 'bg-info-soft text-info',
  resolved: 'bg-primary-soft text-link',
  rejected: 'bg-danger-soft text-danger'
};

const PRIORITY_STYLES = {
  low: 'bg-surface-2 text-fg',
  medium: 'bg-warning-soft text-warning',
  high: 'bg-danger-soft text-danger'
};

function ComplaintCard({ complaint, onSaved }) {
  const [status, setStatus] = useState(complaint.status);
  const [response, setResponse] = useState(complaint.adminResponse || '');
  const [saving, setSaving] = useState(false);

  const dirty = status !== complaint.status || response !== (complaint.adminResponse || '');

  async function save() {
    try {
      setSaving(true);
      const result = await api.patch(`/complaint/status/${complaint._id}`, { status, adminResponse: response });

      if (result.data.success) {
        onSaved({ ...complaint, ...result.data.complaint });
        toast.success('Complaint updated. The customer has been notified.');
      } else {
        toast.error(result.data.message);
      }
    } catch (error) {
      toast.error(getErrorMessage(error));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="p-5 space-y-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <p className="text-sm font-bold text-fg">{complaint.subject}</p>
          <p className="text-xs text-muted">
            {complaint.customer?.name || 'Customer'} • {complaint.customer?.phone || ''} •{' '}
            {new Date(complaint.createdAt).toLocaleString()}
          </p>
        </div>
        <div className="flex gap-2">
          <span className={`px-2.5 py-0.5 rounded-full text-xs font-bold capitalize ${PRIORITY_STYLES[complaint.priority] || PRIORITY_STYLES.medium}`}>
            {complaint.priority || 'medium'} priority
          </span>
          <span className={`px-2.5 py-0.5 rounded-full text-xs font-bold capitalize ${STATUS_STYLES[complaint.status]}`}>
            {complaint.status.replace('_', ' ')}
          </span>
        </div>
      </div>

      {complaint.serviceLabel && (
        <p className="text-xs font-semibold text-info">Related trip — {complaint.serviceLabel}</p>
      )}
      <p className="text-xs text-muted whitespace-pre-wrap">{complaint.description}</p>

      <div className="grid gap-2 sm:grid-cols-[10rem_1fr] items-start">
        <div>
          <label className="block text-xs text-subtle  font-semibold mb-1">Status</label>
          <select
            value={status}
            disabled={saving}
            onChange={(e) => setStatus(e.target.value)}
            className="w-full text-xs border-field-line rounded-xl p-2 border bg-field focus:outline-none focus:border-primary focus:ring-2 focus:ring-primary/25 text-fg"
          >
            <option value="pending">Pending</option>
            <option value="in_review">In Review</option>
            <option value="resolved">Resolved</option>
            <option value="rejected">Rejected</option>
          </select>
        </div>
        <div>
          <label className="block text-xs text-subtle  font-semibold mb-1">Response to customer</label>
          <textarea
            rows={2}
            maxLength={1000}
            value={response}
            disabled={saving}
            onChange={(e) => setResponse(e.target.value)}
            placeholder="Write a reply the customer will see..."
            className="w-full text-xs border-field-line rounded-xl p-2 border focus:ring-primary bg-field text-fg"
          />
        </div>
      </div>

      <div className="flex justify-end">
        <button
          type="button"
          onClick={save}
          disabled={!dirty || saving}
          className="px-4 py-1.5 rounded-xl bg-fg text-bg hover:bg-primary hover:text-on-primary transition-colors text-xs font-semibold disabled:opacity-40"
        >
          {saving ? 'Saving...' : 'Save changes'}
        </button>
      </div>
    </div>
  );
}

export default function AdminComplaints() {
  const [complaints, setComplaints] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [filters, setFilters] = useState({ q: '', status: '', priority: '' });

  const load = useCallback(async () => {
    try {
      setLoading(true);
      setError('');

      const params = Object.fromEntries(Object.entries(filters).filter(([, v]) => v));
      const response = await api.get('/complaint/all', { params });

      if (response.data.success) setComplaints(response.data.complaints);
    } catch (err) {
      setError(getErrorMessage(err));
    } finally {
      setLoading(false);
    }
  }, [filters]);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-bold text-fg">Complaint Management</h1>
        <p className="text-xs text-muted">Review, respond to and resolve customer complaints</p>
      </div>

      <div className="flex flex-wrap gap-2">
        <input
          type="text"
          value={filters.q}
          onChange={(e) => setFilters({ ...filters, q: e.target.value })}
          placeholder="Search subject or description..."
          className="flex-1 min-w-[12rem] text-xs border border-field-line rounded-xl px-3 py-2 focus:outline-none focus:ring-2 focus:ring-primary bg-field text-fg"
        />
        <select
          value={filters.status}
          onChange={(e) => setFilters({ ...filters, status: e.target.value })}
          className="text-xs border border-field-line rounded-xl px-2 py-2 bg-surface"
        >
          <option value="">All statuses</option>
          <option value="pending">Pending</option>
          <option value="in_review">In Review</option>
          <option value="resolved">Resolved</option>
          <option value="rejected">Rejected</option>
        </select>
        <select
          value={filters.priority}
          onChange={(e) => setFilters({ ...filters, priority: e.target.value })}
          className="text-xs border border-field-line rounded-xl px-2 py-2 bg-surface"
        >
          <option value="">All priorities</option>
          <option value="high">High</option>
          <option value="medium">Medium</option>
          <option value="low">Low</option>
        </select>
      </div>

      <div className="card overflow-hidden">
        {loading ? (
          <div className="p-10 text-center">
            <RefreshCw className="w-6 h-6 animate-spin text-link mx-auto mb-2" />
            <p className="text-sm text-muted">Loading complaints...</p>
          </div>
        ) : error ? (
          <div className="p-10 text-center space-y-2">
            <p className="text-sm text-danger">{error}</p>
            <button type="button" onClick={load} className="text-xs font-semibold text-link">Try again</button>
          </div>
        ) : complaints.length === 0 ? (
          <div className="p-10 text-center">
            <AlertCircle className="w-8 h-8 text-subtle mx-auto mb-2" />
            <p className="text-sm font-semibold text-muted">No complaints found</p>
          </div>
        ) : (
          <div className="divide-y divide-line">
            {complaints.map((c) => (
              <ComplaintCard
                key={c._id}
                complaint={c}
                onSaved={(updated) => setComplaints((prev) => prev.map((x) => (x._id === updated._id ? updated : x)))}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
