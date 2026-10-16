import { useEffect, useState } from 'react';
import { AlertCircle, RefreshCw, CheckCircle2 } from 'lucide-react';
import Input from '../../components/Input';
import Button from '../../components/Button';
import api from '../../utils/api';
import { getErrorMessage } from '../../utils/errors';

const STATUS_STYLES = {
  pending: 'bg-warning-soft text-warning',
  in_review: 'bg-info-soft text-info',
  resolved: 'bg-primary-soft text-link',
  rejected: 'bg-danger-soft text-danger'
};

export default function CustomerComplaints() {
  const [complaints, setComplaints] = useState([]);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [formData, setFormData] = useState({ subject: '', description: '', related: '', priority: 'medium' });
  const [trips, setTrips] = useState([]);
  const [formError, setFormError] = useState('');
  const [submitted, setSubmitted] = useState(false);
  const [loadError, setLoadError] = useState('');

  async function loadComplaints() {
    try {
      setLoading(true);
      setLoadError('');
      const response = await api.get('/complaint/my-complaints');
      if (response.data.success) {
        setComplaints(response.data.complaints);
      }
    } catch (error) {
      setLoadError(getErrorMessage(error));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadComplaints();

    async function loadTrips() {
      try {
        const [rides, deliveries] = await Promise.all([
          api.get('/ride/history'),
          api.get('/delivery/history')
        ]);

        const list = [];

        if (rides.data.success) {
          rides.data.rides.forEach((r) =>
            list.push({ key: `ride:${r._id}`, label: `Ride: ${r.pickupLocation} → ${r.destination}`, date: r.createdAt })
          );
        }
        if (deliveries.data.success) {
          deliveries.data.deliveries.forEach((d) =>
            list.push({ key: `delivery:${d._id}`, label: `Delivery: ${d.pickupLocation} → ${d.destination}`, date: d.createdAt })
          );
        }

        list.sort((a, b) => new Date(b.date) - new Date(a.date));
        setTrips(list);
      } catch (error) {
        console.log(error);
      }
    }

    loadTrips();
  }, []);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setSubmitting(true);
    setFormError('');

    try {
      const [serviceType, serviceId] = formData.related ? formData.related.split(':') : [undefined, undefined];

      const response = await api.post('/complaint/submit', {
        subject: formData.subject,
        description: formData.description,
        priority: formData.priority,
        serviceType,
        serviceId
      });

      if (response.data.success) {
        setFormData({ subject: '', description: '', related: '', priority: 'medium' });
        setSubmitted(true);
        setTimeout(() => setSubmitted(false), 3000);
        loadComplaints();
      } else {
        setFormError(response.data.message);
      }
    } catch (error) {
      setFormError(getErrorMessage(error));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="max-w-2xl mx-auto space-y-6">
      <div>
        <h1 className="text-xl font-bold text-fg">Complaints & Support</h1>
        <p className="text-xs text-muted">Report an issue with a ride, delivery, or the platform</p>
      </div>

      <form onSubmit={handleSubmit} className="card p-6 space-y-4">
        {submitted && (
          <div className="p-3 bg-primary-soft border border-primary/30 text-link text-xs rounded-xl font-semibold flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4" />
            Complaint submitted. Our team will review it shortly.
          </div>
        )}

        <Input
          label="Subject"
          value={formData.subject}
          onChange={(e) => setFormData({ ...formData, subject: e.target.value })}
          placeholder="e.g. Driver arrived very late"
          icon={AlertCircle}
          required
        />

        <div>
          <label className="block text-xs font-semibold text-fg  mb-1">Related Trip (Optional)</label>
          <select
            value={formData.related}
            onChange={(e) => setFormData({ ...formData, related: e.target.value })}
            className="w-full text-sm border-field-line rounded-xl p-2.5 border bg-field focus:outline-none focus:border-primary focus:ring-2 focus:ring-primary/25 text-fg"
          >
            <option value="">General complaint (no specific trip)</option>
            {trips.map((t) => (
              <option key={t.key} value={t.key}>{t.label}</option>
            ))}
          </select>
        </div>

        <div>
          <label className="block text-xs font-semibold text-fg  mb-1">Priority</label>
          <select
            value={formData.priority}
            onChange={(e) => setFormData({ ...formData, priority: e.target.value })}
            className="w-full text-sm border-field-line rounded-xl p-2.5 border bg-field focus:outline-none focus:border-primary focus:ring-2 focus:ring-primary/25 text-fg"
          >
            <option value="low">Low</option>
            <option value="medium">Medium</option>
            <option value="high">High - safety or urgent</option>
          </select>
        </div>

        <div>
          <label className="block text-xs font-semibold text-fg  mb-1">Description</label>
          <textarea
            rows={4}
            value={formData.description}
            onChange={(e) => setFormData({ ...formData, description: e.target.value })}
            placeholder="Describe what happened in detail..."
            className="w-full text-sm border-field-line rounded-xl p-2.5 border focus:ring-primary bg-field text-fg"
            required
          />
        </div>

        {formError && (
          <div className="p-3 bg-danger-soft border border-danger/30 text-danger text-xs rounded-xl font-semibold">{formError}</div>
        )}

        <Button type="submit" variant="primary" fullWidth disabled={submitting}>
          {submitting ? 'Submitting...' : 'Submit Complaint'}
        </Button>
      </form>

      <div className="card overflow-hidden">
        <div className="p-4 border-b border-line">
          <h3 className="text-sm font-bold text-fg">Your Past Complaints</h3>
        </div>

        {loading ? (
          <div className="p-8 text-center">
            <RefreshCw className="w-6 h-6 animate-spin text-link mx-auto mb-2" />
            <p className="text-sm text-muted">Loading...</p>
          </div>
        ) : loadError ? (
          <div className="p-6 text-center space-y-2">
            <p className="text-xs text-danger">{loadError}</p>
            <button type="button" onClick={loadComplaints} className="text-xs font-semibold text-link">Try again</button>
          </div>
        ) : complaints.length === 0 ? (
          <p className="text-xs text-subtle p-6 text-center">No complaints submitted yet.</p>
        ) : (
          <div className="divide-y divide-line">
            {complaints.map((c) => (
              <div key={c._id} className="p-4 space-y-1">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-semibold text-fg">{c.subject}</span>
                  <span className={`px-2 py-0.5 rounded-full text-xs font-bold capitalize ${STATUS_STYLES[c.status]}`}>
                    {c.status.replace('_', ' ')}
                  </span>
                </div>
                {c.serviceLabel && <p className="text-xs text-info">{c.serviceLabel}</p>}
                <p className="text-xs text-muted">{c.description}</p>
                {c.adminResponse && (
                  <div className="mt-2 rounded-xl border border-primary/30 bg-primary-soft p-3 text-xs">
                    <p className="font-semibold text-link">Response from Bannu Drive support</p>
                    <p className="text-link mt-0.5 whitespace-pre-wrap">{c.adminResponse}</p>
                  </div>
                )}
                <p className="text-xs text-subtle capitalize">
                  {new Date(c.createdAt).toLocaleDateString()} • {c.priority || 'medium'} priority
                </p>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
