import { useEffect, useState } from 'react';
import { Star, CheckCircle, RefreshCw } from 'lucide-react';
import Button from '../../components/Button';
import api from '../../utils/api';
import { getErrorMessage } from '../../utils/errors';
import { toast } from '../../utils/toast';

export default function Ratings() {
  const [ratable, setRatable] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState(null);
  const [rating, setRating] = useState(5);
  const [comment, setComment] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [loadError, setLoadError] = useState('');

  async function loadRatable() {
    try {
      setLoading(true);
      setLoadError('');
      const response = await api.get('/rating/ratable');
      if (response.data.success) {
        setRatable(response.data.ratable);
        setSelected(response.data.ratable[0] || null);
      }
    } catch (error) {
      setLoadError(getErrorMessage(error, 'Could not load your completed trips'));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadRatable();
  }, []);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!selected) return;

    setSubmitting(true);

    try {
      const response = await api.post('/rating/submit', {
        serviceType: selected.serviceType,
        serviceId: selected.serviceId,
        rating,
        review: comment
      });

      if (response.data.success) {
        setSubmitted(true);
        setRatable((prev) => prev.filter((r) => r.serviceId !== selected.serviceId));
      } else {
        toast.error(response.data.message);
      }
    } catch (error) {
      console.log(error);
      toast.error(getErrorMessage(error));
    } finally {
      setSubmitting(false);
    }
  };

  const resetForm = () => {
    setSubmitted(false);
    setRating(5);
    setComment('');
    setSelected(ratable[0] || null);
  };

  if (loading) {
    return (
      <div className="max-w-2xl mx-auto py-16 text-center">
        <RefreshCw className="w-7 h-7 animate-spin text-link mx-auto mb-3" />
        <p className="text-sm text-muted">Loading your completed requests...</p>
      </div>
    );
  }

  if (!submitted && ratable.length === 0) {
    return (
      <div className="max-w-2xl mx-auto space-y-6">
        <div>
          <h1 className="text-xl font-bold text-fg">Rate a Completed Trip</h1>
          <p className="text-xs text-muted">Feedback for your completed rides and deliveries</p>
        </div>
        <div className="card p-8 text-center space-y-2">
          <Star className="w-10 h-10 text-subtle mx-auto" />
          <p className="text-sm font-semibold text-muted">Nothing to rate right now</p>
          <p className="text-xs text-subtle">Completed rides and deliveries you haven't rated will show up here.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-2xl mx-auto space-y-6">
      {loadError && (
        <div className="p-4 bg-danger-soft border border-danger/30 rounded-xl flex flex-wrap items-center justify-between gap-3">
          <p className="text-sm text-danger">{loadError}</p>
          <button type="button" onClick={() => loadRatable()} className="px-3 py-1.5 rounded-xl bg-fg text-bg hover:bg-primary hover:text-on-primary transition-colors text-xs font-semibold">
            Try again
          </button>
        </div>
      )}

      <div>
        <h1 className="text-xl font-bold text-fg">Rate a Completed Trip</h1>
        {selected && !submitted && (
          <p className="text-xs text-muted">
            Provide feedback for driver {selected.driverName} ({selected.pickupLocation} → {selected.destination})
          </p>
        )}
      </div>

      {submitted ? (
        <div className="card p-8 text-center space-y-3">
          <CheckCircle className="w-12 h-12 text-link mx-auto" />
          <h3 className="text-base font-bold text-fg">Thank You For Your Feedback!</h3>
          <p className="text-xs text-muted">Your rating helps maintain high service standards in Bannu.</p>
          {ratable.length > 0 && (
            <Button variant="outline" onClick={resetForm}>Rate Another Trip</Button>
          )}
        </div>
      ) : (
        <form onSubmit={handleSubmit} className="card p-6 space-y-4">
          {ratable.length > 1 && (
            <div>
              <label className="block text-xs font-semibold text-fg  mb-2">Which trip?</label>
              <select
                value={selected?.serviceId}
                onChange={(e) => setSelected(ratable.find((r) => r.serviceId === e.target.value))}
                className="w-full text-sm border-field-line rounded-xl p-2.5 border bg-field focus:outline-none focus:border-primary focus:ring-2 focus:ring-primary/25 text-fg"
              >
                {ratable.map((r) => (
                  <option key={r.serviceId} value={r.serviceId}>
                    {r.serviceType === 'ride' ? 'Ride' : 'Delivery'}: {r.pickupLocation} → {r.destination} ({r.driverName})
                  </option>
                ))}
              </select>
            </div>
          )}

          <div>
            <label className="block text-xs font-semibold text-fg  mb-2">Score Rating</label>
            <div className="flex space-x-2">
              {[1, 2, 3, 4, 5].map((star) => (
                <button
                  type="button"
                  key={star}
                  onClick={() => setRating(star)}
                  className="p-1 focus:outline-none"
                >
                  <Star className={`w-8 h-8 ${star <= rating ? 'text-warning fill-warning' : 'text-subtle'}`} />
                </button>
              ))}
            </div>
          </div>

          <div>
            <label className="block text-xs font-semibold text-fg  mb-1">Feedback / Comments</label>
            <textarea
              rows={3}
              value={comment}
              onChange={(e) => setComment(e.target.value)}
              placeholder="Driver was polite and reached location on time..."
              className="w-full text-sm border-field-line rounded-xl p-2.5 border focus:ring-primary bg-field text-fg"
            />
          </div>

          <Button type="submit" variant="primary" fullWidth disabled={submitting}>
            {submitting ? 'Submitting...' : 'Submit Driver Rating'}
          </Button>
        </form>
      )}
    </div>
  );
}
