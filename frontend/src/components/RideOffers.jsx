import { useEffect, useState, useCallback } from 'react';
import { Star, MapPin, Clock, Car, RefreshCw } from 'lucide-react';
import api from '../utils/api';
import { getErrorMessage } from '../utils/errors';
import { formatCurrency } from '../utils/formatters';
import { toast } from '../utils/toast';
import { useSocketEvent } from '../context/RealtimeContext';
import Avatar from './Avatar';

// InDrive-style: drivers accept your fare or counter-offer; you choose exactly one.
export default function RideOffers({ rideId, offeredFare, onSelected }) {
  const [offers, setOffers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [selecting, setSelecting] = useState(null);

  const load = useCallback(async (silent = false) => {
    try {
      if (!silent) { setLoading(true); setError(''); }
      const response = await api.get(`/ride/${rideId}/offers`);
      if (response.data.success) setOffers(response.data.offers);
    } catch (err) {
      if (!silent) setError(getErrorMessage(err, 'Could not load driver offers'));
    } finally {
      setLoading(false);
    }
  }, [rideId]);

  useEffect(() => {
    load();
    const timer = setInterval(() => load(true), 8000); // safety net if the socket drops
    return () => clearInterval(timer);
  }, [load]);

  useSocketEvent('ride:offers', (p) => { if (p.rideId === rideId) load(true); });

  async function select(offer) {
    try {
      setSelecting(offer._id);
      const response = await api.post(`/ride/${rideId}/select-offer`, { offerId: offer._id });
      if (response.data.success) {
        toast.success(`${offer.driver.name} is on the way.`);
        onSelected?.();
      } else {
        toast.error(response.data.message);
        load(true);
      }
    } catch (err) {
      toast.error(getErrorMessage(err));
      load(true);
    } finally {
      setSelecting(null);
    }
  }

  return (
    <div className="space-y-3" aria-live="polite">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-bold text-fg">Driver offers {offers.length > 0 && `(${offers.length})`}</h3>
        <button type="button" onClick={() => load()} className="text-subtle hover:text-fg" aria-label="Refresh offers">
          <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
        </button>
      </div>

      {error && <p className="text-xs text-danger">{error}</p>}

      {!error && offers.length === 0 && (
        <div className="p-5 rounded-xl border border-dashed border-field-line text-center">
          <RefreshCw className="w-5 h-5 animate-spin text-link mx-auto mb-2" />
          <p className="text-sm font-semibold text-fg">Waiting for drivers to respond...</p>
          <p className="text-xs text-muted mt-1">Nearby drivers have been notified of your {formatCurrency(offeredFare)} offer. Their offers appear here instantly.</p>
        </div>
      )}

      {offers.map((o) => (
        <div key={o._id} className="card p-4 flex flex-col sm:flex-row sm:items-center gap-3">
          <div className="flex items-start gap-3 flex-1 min-w-0">
            <Avatar user={o.driver} size="md" />
            <div className="min-w-0 text-xs space-y-0.5">
              <p className="text-sm font-bold text-fg truncate">{o.driver.name}</p>
              <p className="flex items-center gap-1 text-warning">
                <Star className="w-3.5 h-3.5 fill-warning text-warning" />
                {o.driver.rating.count ? `${o.driver.rating.average} (${o.driver.rating.count})` : 'New driver'}
                <span className="text-subtle">• {o.driver.completedRides} ride{o.driver.completedRides === 1 ? '' : 's'}</span>
              </p>
              <p className="flex items-center gap-1 text-muted capitalize">
                <Car className="w-3.5 h-3.5" /> {o.driver.vehicleType}{o.driver.vehicleModel ? ` ${o.driver.vehicleModel}` : ''} • {o.driver.vehicleNumber}
              </p>
              {o.distanceToPickupKm != null && (
                <p className="flex items-center gap-1 text-muted">
                  <MapPin className="w-3.5 h-3.5" /> {o.distanceToPickupKm} km away
                  <Clock className="w-3.5 h-3.5 ml-1" /> ~{o.etaMin} min
                </p>
              )}
            </div>
          </div>

          <div className="flex sm:flex-col items-center sm:items-end justify-between gap-2">
            <div className="text-right">
              <p className="text-lg font-extrabold text-fg">{formatCurrency(o.fare)}</p>
              <p className={`text-xs font-bold  ${o.kind === 'accept' ? 'text-link' : 'text-warning'}`}>
                {o.kind === 'accept' ? 'Accepts your fare' : o.fare > offeredFare ? `+${formatCurrency(o.fare - offeredFare)} counter` : `${formatCurrency(offeredFare - o.fare)} less`}
              </p>
            </div>
            <button
              type="button" disabled={selecting !== null} onClick={() => select(o)}
              className="px-4 py-2 rounded-xl bg-primary hover:bg-primary-hover disabled:opacity-50 text-on-primary text-xs font-semibold"
            >
              {selecting === o._id ? 'Selecting...' : 'Select'}
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}
