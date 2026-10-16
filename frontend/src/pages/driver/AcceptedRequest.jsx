import { useEffect, useState } from 'react';
import { useParams, useSearchParams, useNavigate } from 'react-router-dom';
import { ArrowLeft, Play, CheckCircle2 } from 'lucide-react';

import Button from '../../components/Button';
import api from '../../utils/api';
import TripMap from '../../components/map/TripMap';
import { getErrorMessage } from '../../utils/errors';
import { formatCurrency } from '../../utils/formatters';
import { toast } from '../../utils/toast';

export default function AcceptedRequest() {
  const { id } = useParams();
  const [searchParams] = useSearchParams();
  const type = searchParams.get('type') === 'delivery' ? 'delivery' : 'ride';
  const navigate = useNavigate();

  const [job, setJob] = useState(null);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState(false);
  const [error, setError] = useState('');

  async function loadJob() {
    try {
      setLoading(true);
      setError('');

      const endpoint = type === 'delivery' ? `/delivery/${id}` : `/ride/${id}`;
      const response = await api.get(endpoint);

      if (response.data.success) {
        setJob(response.data[type]);
      } else {
        setError(response.data.message);
      }
    } catch (err) {
      console.log(err);
      setError(getErrorMessage(err));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadJob();
     
  }, [id, type]);

  async function handleStart() {
    try {
      setActionLoading(true);
      const endpoint = type === 'delivery' ? `/delivery/start/${id}` : `/ride/start/${id}`;
      const response = await api.patch(endpoint);
      if (response.data.success) {
        setJob(response.data[type]);
      } else {
        toast.error(response.data.message);
      }
    } catch (err) {
      toast.error(getErrorMessage(err));
    } finally {
      setActionLoading(false);
    }
  }

  async function handleComplete() {
    try {
      setActionLoading(true);
      const endpoint = type === 'delivery' ? `/delivery/complete/${id}` : `/ride/complete/${id}`;
      const response = await api.patch(endpoint);
      if (response.data.success) {
        toast.success(`${type === 'delivery' ? 'Delivery' : 'Ride'} completed successfully!`);
        navigate('/driver');
      } else {
        toast.error(response.data.message);
      }
    } catch (err) {
      toast.error(getErrorMessage(err));
    } finally {
      setActionLoading(false);
    }
  }

  if (loading) {
    return (
      <div className="max-w-2xl mx-auto py-16 text-center text-sm text-muted">
        Loading request...
      </div>
    );
  }

  if (error || !job) {
    return (
      <div className="max-w-2xl mx-auto space-y-4">
        <button onClick={() => navigate(-1)} className="p-2 bg-surface rounded-xl border border-line text-muted hover:bg-surface-2">
          <ArrowLeft className="w-4 h-4" />
        </button>
        <div className="card p-10 text-center">
          <p className="text-sm font-semibold text-fg">{error || 'Request not found'}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-2xl mx-auto space-y-6">
      <div className="flex items-center space-x-3">
        <button onClick={() => navigate(-1)} className="p-2 bg-surface rounded-xl border border-line text-muted hover:bg-surface-2">
          <ArrowLeft className="w-4 h-4" />
        </button>
        <div>
          <h1 className="text-xl font-bold text-fg">
            {type === 'delivery' ? 'Delivery' : 'Ride'} #{job._id.slice(-6).toUpperCase()}
          </h1>
          <p className="text-xs text-muted">Manage order progress and customer contact</p>
        </div>
      </div>

      <div className="card p-6 space-y-6">
        <div className="flex justify-between items-center border-b border-line pb-4">
          <div>
            <span className="text-xs font-bold text-link ">
              {type === 'delivery' ? `Delivery` : `Ride (${job.vehicleType})`}
            </span>
            <h3 className="text-base font-bold text-fg">{job.pickupLocation} → {job.destination}</h3>
          </div>
          <span className="bg-primary-soft text-link text-xs font-bold px-3 py-1 rounded-full capitalize">
            {job.status}
          </span>
        </div>

        <TripMap job={job} height={280} />

        <div className="p-4 bg-surface-2 rounded-xl space-y-2 text-xs">
          <p className="text-muted">Customer Name: <span className="font-bold text-fg">{job.customer?.name || '-'}</span></p>
          <p className="text-muted">Contact Number: <span className="font-bold text-link">{job.customer?.phone || '-'}</span></p>
          <p className="text-muted">Pickup Location: <span className="font-bold text-fg">{job.pickupLocation}</span></p>
          <p className="text-muted">Destination: <span className="font-bold text-fg">{job.destination}</span></p>
          {type === 'delivery' && (
            <>
              <p className="text-muted">Receiver: <span className="font-bold text-fg">{job.receiverName} ({job.receiverPhone})</span></p>
              <p className="text-muted">Package: <span className="font-bold text-fg">{job.packageDescription}</span></p>
            </>
          )}
          <p className="text-muted">Cash Collection: <span className="font-bold text-fg">{formatCurrency(job.offeredFare)}</span></p>
        </div>

        {job.notes && (
          <div className="p-3 bg-warning-soft border border-warning/30 rounded-xl text-xs text-warning">
            <b>Customer note:</b> {job.notes}
          </div>
        )}

        <div className="pt-2">
          {job.status === 'accepted' && (
            <Button variant="primary" fullWidth size="lg" icon={Play} onClick={handleStart} disabled={actionLoading}>
              {actionLoading ? 'Starting...' : `Start ${type === 'delivery' ? 'Delivery' : 'Trip'}`}
            </Button>
          )}

          {job.status === 'started' && (
            <Button variant="primary" fullWidth size="lg" icon={CheckCircle2} onClick={handleComplete} disabled={actionLoading}>
              {actionLoading ? 'Completing...' : `Complete ${type === 'delivery' ? 'Delivery' : 'Trip'} & Collect Cash`}
            </Button>
          )}

          {job.status === 'completed' && (
            <div className="p-4 bg-primary-soft text-link rounded-xl text-center font-bold text-xs">
              {type === 'delivery' ? 'Delivery' : 'Trip'} Completed! Cash Collected: {formatCurrency(job.offeredFare)}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
