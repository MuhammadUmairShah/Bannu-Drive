import { useEffect, useRef, useState } from 'react';
import { useParams, useSearchParams, Link } from 'react-router-dom';
import { ArrowLeft, User, RefreshCw, Navigation, Star, XCircle } from 'lucide-react';

import api from '../../utils/api';
import { formatCurrency } from '../../utils/formatters';
import { getErrorMessage } from '../../utils/errors';
import { timeAgo } from '../../utils/geo';
import TripMap from '../../components/map/TripMap';
import Button from '../../components/Button';
import Avatar from '../../components/Avatar';
import { useSocketEvent } from '../../context/RealtimeContext';
import { promptReason } from '../../utils/toast';
import RideOffers from '../../components/RideOffers';

const STATUS_STYLES = {
  pending: 'bg-warning-soft text-warning',
  accepted: 'bg-info-soft text-info',
  started: 'bg-violet-soft text-violet',
  completed: 'bg-primary-soft text-link',
  cancelled: 'bg-danger-soft text-danger'
};

const STATUS_HELP = {
  pending: 'Waiting for drivers to respond to your request.',
  accepted: 'A driver accepted and is heading to your pickup point.',
  started: 'Your trip is in progress.',
  completed: 'This trip is completed.',
  cancelled: 'This request was cancelled.'
};

const POLL_MS = 10000;

// "Your driver has arrived" + running waiting timer
function ArrivedBanner({ since }) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  const secs = Math.max(0, Math.floor((now - new Date(since).getTime()) / 1000));
  const mm = String(Math.floor(secs / 60)).padStart(2, '0');
  const ss = String(secs % 60).padStart(2, '0');
  return (
    <div className="p-3 rounded-xl border border-primary/30 bg-primary-soft text-sm flex items-center justify-between">
      <span className="font-semibold text-link">Your driver has arrived at the pickup point.</span>
      <span className="font-mono font-bold text-link" aria-label="waiting time">Waiting {mm}:{ss}</span>
    </div>
  );
}

export default function RequestDetails() {
  const { id } = useParams();
  const [searchParams] = useSearchParams();
  const type = searchParams.get('type') === 'delivery' ? 'delivery' : 'ride';

  const [request, setRequest] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [cancelling, setCancelling] = useState(false);
  const [actionMessage, setActionMessage] = useState('');
  const [lastRefresh, setLastRefresh] = useState(null);
  const statusRef = useRef(null);

  async function loadDetails(silent = false) {
    try {
      if (!silent) {
        setLoading(true);
        setError('');
      }

      const endpoint = type === 'delivery' ? `/delivery/${id}` : `/ride/${id}`;
      const response = await api.get(endpoint);

      if (response.data.success) {
        setRequest(response.data[type]);
        statusRef.current = response.data[type].status;
        setLastRefresh(new Date());
      } else if (!silent) {
        setError(response.data.message || 'Unable to load this request');
      }
    } catch (err) {
      if (!silent) setError(getErrorMessage(err));
    } finally {
      if (!silent) setLoading(false);
    }
  }

  useEffect(() => {
    loadDetails();

    // Poll while the trip is live: status changes and the driver's position
    const timer = setInterval(() => {
      if (['pending', 'accepted', 'started'].includes(statusRef.current)) {
        loadDetails(true);
      }
    }, POLL_MS);

    return () => clearInterval(timer);
     
  }, [id, type]);

  // Live updates pushed by the server (fallback: the 10s poll above)
  useSocketEvent('driver:location', (payload) => {
    if (payload.serviceType !== type || payload.serviceId !== id) return;
    setRequest((current) =>
      current && current.driver
        ? { ...current, driver: { ...current.driver, currentLocation: payload.location } }
        : current
    );
    setLastRefresh(new Date());
  });

  useSocketEvent(`${type}:updated`, (payload) => {
    if (payload.serviceId === id) loadDetails(true);
  });

  async function handleCancel() {
    const reason = await promptReason({
      title: 'Cancel this request?',
      message: 'The driver (if assigned) will be notified.',
      reasons: ['Driver is taking too long', 'Changed my plans', 'Found another ride', 'Booked by mistake', 'Other'],
      confirmText: 'Yes, cancel'
    });
    if (reason === null) return;

    try {
      setCancelling(true);
      setActionMessage('');

      const endpoint = type === 'delivery' ? `/delivery/cancel/${id}` : `/ride/cancel/${id}`;
      const response = await api.patch(endpoint, { reason });

      if (response.data.success) {
        await loadDetails(true);
        setActionMessage('Request cancelled.');
      } else {
        setActionMessage(response.data.message);
      }
    } catch (err) {
      setActionMessage(getErrorMessage(err));
    } finally {
      setCancelling(false);
    }
  }

  if (loading) {
    return (
      <div className="max-w-3xl mx-auto py-16 text-center">
        <RefreshCw className="w-7 h-7 animate-spin text-link mx-auto mb-3" />
        <p className="text-sm text-muted">Loading request details...</p>
      </div>
    );
  }

  if (error || !request) {
    return (
      <div className="max-w-3xl mx-auto space-y-4">
        <Link to="/customer/requests" className="inline-flex items-center space-x-2 text-sm text-muted hover:text-fg">
          <ArrowLeft className="w-4 h-4" />
          <span>Back to My Requests</span>
        </Link>
        <div className="card p-10 text-center">
          <p className="text-sm font-semibold text-fg">{error || 'Request not found'}</p>
        </div>
      </div>
    );
  }

  const isDelivery = type === 'delivery';
  const live = ['accepted', 'started'].includes(request.status);
  const driverLoc = request.driver?.currentLocation;
  const driverPoint =
    live && typeof driverLoc?.latitude === 'number'
      ? { latitude: driverLoc.latitude, longitude: driverLoc.longitude }
      : null;

  const staleLocation =
    driverLoc?.updatedAt && Date.now() - new Date(driverLoc.updatedAt).getTime() > 60000;

  return (
    <div className="max-w-3xl mx-auto space-y-6">
      <div className="flex items-center space-x-3">
        <Link to="/customer/requests" className="p-2 bg-surface rounded-xl border border-line text-muted hover:bg-surface-2">
          <ArrowLeft className="w-4 h-4" />
        </Link>
        <div>
          <h1 className="text-xl font-bold text-fg">Request #{request._id.slice(-6).toUpperCase()}</h1>
          <p className="text-xs text-muted">
            {['pending', 'accepted', 'started'].includes(request.status)
              ? `Live status • updated ${lastRefresh ? lastRefresh.toLocaleTimeString() : ''}`
              : 'Final status'}
          </p>
        </div>
      </div>

      <div className="card p-4 sm:p-6 space-y-6">
        <div className="flex flex-col sm:flex-row sm:justify-between sm:items-center gap-2 border-b border-line pb-4">
          <div>
            <span className="text-xs font-bold text-link ">
              {isDelivery ? 'Delivery Request' : `Ride Request • ${request.vehicleType}`}
            </span>
            <h3 className="text-lg font-bold text-fg">{request.pickupLocation} → {request.destination}</h3>
          </div>
          <span className={`self-start text-xs font-bold px-3 py-1 rounded-full capitalize ${STATUS_STYLES[request.status]}`}>
            {request.status}
          </span>
        </div>

        <p className="text-xs text-muted">
          {!isDelivery && request.status === 'pending'
            ? 'Drivers are responding. Pick the offer you like best.'
            : STATUS_HELP[request.status]}
        </p>

        {!isDelivery && request.status === 'pending' && (
          <RideOffers rideId={request._id} offeredFare={request.offeredFare} onSelected={() => loadDetails(true)} />
        )}

        {!isDelivery && request.status === 'accepted' && request.arrivedAt && (
          <ArrivedBanner since={request.arrivedAt} />
        )}

        {/* Live map */}
        <TripMap job={request} driverPoint={driverPoint} height={320} />

        {live && (
          <div className="p-3 rounded-xl border border-line bg-surface-2 text-xs flex items-start gap-2">
            <Navigation className="w-4 h-4 text-info mt-0.5 shrink-0" />
            {driverPoint ? (
              <span className="text-fg">
                Driver position updated <b>{timeAgo(driverLoc.updatedAt)}</b>.
                {staleLocation && ' The driver location may be out of date.'}
              </span>
            ) : (
              <span className="text-muted">
                The driver has not shared a live location yet. The map refreshes automatically.
              </span>
            )}
          </div>
        )}

        {isDelivery && (
          <div className="p-4 bg-surface-2 rounded-xl border border-line space-y-2 text-xs">
            <p className="font-bold text-fg ">Receiver Details</p>
            <p className="text-fg font-semibold">{request.receiverName}</p>
            <p className="text-muted">Phone: {request.receiverPhone}</p>
            <p className="text-muted">Package: {request.packageDescription}</p>
          </div>
        )}

        {request.notes && (
          <div className="p-3 bg-warning-soft border border-warning/30 rounded-xl text-xs text-warning">
            <b>Your note:</b> {request.notes}
          </div>
        )}

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 pt-2">
          <div className="p-4 bg-surface-2 rounded-xl border border-line space-y-2 text-xs">
            <p className="font-bold text-fg  flex items-center space-x-1">
              <User className="w-4 h-4 text-link" />
              <span>Assigned Driver</span>
            </p>
            {request.driver ? (
              <div className="flex items-start gap-3">
                <Avatar user={request.driver} size="md" />
                <div className="space-y-0.5">
                  <p className="text-fg font-semibold">{request.driver.name}</p>
                  {request.driver.rating?.count > 0 ? (
                    <p className="text-warning flex items-center gap-1">
                      <Star className="w-3.5 h-3.5 fill-warning text-warning" />
                      {request.driver.rating.average} ({request.driver.rating.count})
                    </p>
                  ) : (
                    <p className="text-subtle">No ratings yet</p>
                  )}
                  <p className="text-muted">Phone: {request.driver.phone}</p>
                  {request.driver.vehicleType && (
                    <p className="text-muted capitalize">
                      Vehicle: {request.driver.vehicleType}
                      {request.driver.vehicleModel ? ` ${request.driver.vehicleModel}` : ''} ({request.driver.vehicleNumber || '-'})
                    </p>
                  )}
                </div>
              </div>
            ) : (
              <p className="text-muted">
                {request.status === 'cancelled'
                  ? 'No driver was assigned.'
                  : 'Waiting for a driver to accept this request.'}
              </p>
            )}
          </div>

          <div className="p-4 bg-surface-2 rounded-xl border border-line space-y-2 text-xs">
            <p className="font-bold text-fg ">Fare Details</p>
            <p className="text-lg font-extrabold text-link">{formatCurrency(request.agreedFare ?? request.offeredFare)}</p>
            {request.agreedFare != null && request.agreedFare !== request.offeredFare && (
              <p className="text-muted">You offered {formatCurrency(request.offeredFare)}; the driver you chose asked {formatCurrency(request.agreedFare)}.</p>
            )}
            {request.estimatedFare != null && (
              <p className="text-muted">System estimate: {formatCurrency(request.estimatedFare)}</p>
            )}
            <p className="text-muted">Payment method: Cash on Completion</p>
          </div>
        </div>

        {actionMessage && (
          <div className="p-3 bg-surface-2 border border-line text-fg text-xs rounded-xl font-semibold">
            {actionMessage}
          </div>
        )}

        <div className="flex flex-wrap gap-3">
          {['pending', 'accepted'].includes(request.status) && (
            <Button variant="danger" size="sm" icon={XCircle} onClick={handleCancel} disabled={cancelling}>
              {cancelling ? 'Cancelling...' : 'Cancel Request'}
            </Button>
          )}

          {request.status === 'completed' && (
            <Link to="/customer/ratings">
              <Button variant="primary" size="sm" icon={Star}>
                Rate this trip
              </Button>
            </Link>
          )}
        </div>
      </div>
    </div>
  );
}
