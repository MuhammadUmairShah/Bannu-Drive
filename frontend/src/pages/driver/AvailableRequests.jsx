import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { RefreshCw, Car } from 'lucide-react';

import Button from '../../components/Button';
import api from '../../utils/api';
import { getErrorMessage } from '../../utils/errors';
import { formatCurrency } from '../../utils/formatters';
import { toast } from '../../utils/toast';
import { useSocketEvent } from '../../context/RealtimeContext';

export default function AvailableRequests() {
  const navigate = useNavigate();
  const [filter, setFilter] = useState('All');
  const [requests, setRequests] = useState([]);
  const [loading, setLoading] = useState(true);
  const [acceptingId, setAcceptingId] = useState(null);
  const [loadError, setLoadError] = useState('');
  const [search, setSearch] = useState('');

  async function loadAvailable(silent = false) {
    try {
      if (!silent) {
        setLoading(true);
        setLoadError('');
      }

      const params = search.trim() ? { q: search.trim() } : {};

      const [rideRes, deliveryRes] = await Promise.all([
        api.get('/ride/available', { params }),
        api.get('/delivery/available', { params })
      ]);

      const items = [];

      if (rideRes.data.success) {
        rideRes.data.rides.forEach((r) =>
          items.push({
            id: r._id,
            type: 'Ride',
            pickup: r.pickupLocation,
            dest: r.destination,
            fare: r.offeredFare,
            vehicle: r.vehicleType,
            distanceKm: r.distanceKm,
            durationMin: r.durationMin,
            estimatedFare: r.estimatedFare,
            createdAt: r.createdAt,
            myOffer: r.myOffer || null
          })
        );
      }

      if (deliveryRes.data.success) {
        deliveryRes.data.deliveries.forEach((d) =>
          items.push({
            id: d._id,
            type: 'Delivery',
            pickup: d.pickupLocation,
            dest: d.destination,
            fare: d.offeredFare,
            vehicle: 'Any',
            parcelType: d.parcelType,
            parcelSize: d.parcelSize,
            packageDescription: d.packageDescription,
            distanceKm: d.distanceKm,
            durationMin: d.durationMin,
            estimatedFare: d.estimatedFare,
            createdAt: d.createdAt
          })
        );
      }

      items.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

      setRequests(items);
    } catch (error) {
      setRequests([]);
      setLoadError(getErrorMessage(error));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadAvailable();
     
  }, []);

  // Real-time: a new request was created / another driver took one
  useSocketEvent('notification:new', (n) => {
    if (n.type === 'new_ride_request' || n.type === 'new_delivery_request') loadAvailable(true);
  });
  useSocketEvent('notification:new', (n) => {
    if (n.type === 'driver_selected') {
      toast.success('You were selected! Opening your trip.');
      navigate('/driver/requests/active');
    }
  });
  useSocketEvent('request:unavailable', ({ serviceId }) => {
    setRequests((current) => current.filter((r) => r.id !== serviceId));
  });

  const [counter, setCounter] = useState({}); // request id -> counter fare text
  const [openCounter, setOpenCounter] = useState(null);

  // Deliveries are taken directly; rides become an OFFER the customer chooses from
  const handleAccept = async (item, fare) => {
    try {
      setAcceptingId(item.id);

      if (item.type === 'Ride') {
        const response = await api.post(`/ride/${item.id}/offer`, fare ? { fare } : {});
        if (response.data.success) {
          toast.success(response.data.message + '. You will be notified if the customer picks you.');
          setOpenCounter(null);
          loadAvailable(true);
        } else {
          toast.error(response.data.message);
          loadAvailable();
        }
        return;
      }

      const response = await api.patch(`/delivery/accept/${item.id}`);

      if (response.data.success) {
        navigate('/driver/requests/active');
      } else {
        toast.error(response.data.message);
        loadAvailable();
      }
    } catch (error) {
      toast.error(getErrorMessage(error));
      loadAvailable();
    } finally {
      setAcceptingId(null);
    }
  };

  const withdraw = async (item) => {
    try {
      await api.delete(`/ride/${item.id}/offer`);
      toast.info('Offer withdrawn.');
      loadAvailable(true);
    } catch (error) {
      toast.error(getErrorMessage(error));
    }
  };

  const sendCounter = (item) => {
    const value = Number(counter[item.id]);
    if (!Number.isInteger(value) || value < 1 || value > 100000) {
      toast.error('Enter a whole-number fare, e.g. 350.');
      return;
    }
    handleAccept(item, value);
  };

  const filtered = requests.filter((r) => {
    if (filter === 'All') return true;
    if (filter === 'Rides') return r.type === 'Ride';
    return r.type === 'Delivery';
  });

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-fg">Available Requests</h1>
          <p className="text-xs text-muted">Nearby customers broadcasting ride & delivery fare offers</p>
        </div>
        <button
          onClick={() => loadAvailable()}
          disabled={loading}
          className="inline-flex items-center gap-2 px-3 py-2 rounded-xl bg-primary hover:bg-primary-hover text-on-primary text-xs font-semibold disabled:opacity-60"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
          Refresh
        </button>
      </div>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          loadAvailable();
        }}
        className="flex gap-2"
      >
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Filter by pickup or destination..."
          className="flex-1 min-w-0 text-xs border border-field-line rounded-xl px-3 py-2 focus:outline-none focus:ring-2 focus:ring-primary bg-field text-fg"
        />
        <button type="submit" className="px-3 py-2 rounded-xl bg-fg text-bg hover:bg-primary hover:text-on-primary transition-colors text-xs font-semibold">
          Filter
        </button>
      </form>

      <div className="flex space-x-2 border-b border-line pb-2">
        {['All', 'Rides', 'Deliveries'].map((tab) => (
          <button
            key={tab}
            onClick={() => setFilter(tab)}
            className={`px-3 py-1.5 text-xs font-semibold rounded-xl ${
              filter === tab ? 'bg-fg text-bg' : 'text-muted hover:bg-surface-2'
            }`}
          >
            {tab}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="card p-10 text-center">
          <RefreshCw className="w-7 h-7 animate-spin text-link mx-auto mb-3" />
          <p className="text-sm text-muted">Loading available requests...</p>
        </div>
      ) : loadError ? (
        <div className="bg-warning-soft border border-warning/30 rounded-xl p-8 text-center shadow-sm">
          <p className="text-sm font-semibold text-warning">{loadError}</p>
          <p className="text-xs text-warning mt-1">
            You must be verified and online, and not already on a trip, to see requests.
          </p>
        </div>
      ) : filtered.length === 0 ? (
        <div className="card p-10 text-center">
          <Car className="w-8 h-8 text-subtle mx-auto mb-2" />
          <p className="text-sm font-semibold text-muted">No requests available right now</p>
          <p className="text-xs text-subtle mt-1">New ride and delivery requests will appear here.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {filtered.map((item) => (
            <div key={`${item.type}-${item.id}`} className="card p-5 space-y-4">
              <div className="flex justify-between items-start">
                <span className={`px-2.5 py-0.5 rounded-full text-xs font-bold ${
                  item.type === 'Ride' ? 'bg-primary-soft text-link' : 'bg-info-soft text-info'
                }`}>
                  {item.type} • {item.vehicle}
                </span>
                <span className="text-xs text-subtle">
                  {new Date(item.createdAt).toLocaleTimeString()}
                </span>
              </div>

              <div className="space-y-1 text-xs">
                <p className="text-muted">Pickup: <span className="font-semibold text-fg">{item.pickup}</span></p>
                <p className="text-muted">Dropoff: <span className="font-semibold text-fg">{item.dest}</span></p>
              </div>

              {item.type === 'Delivery' && (
                <p className="text-xs text-muted">
                  Parcel: <span className="capitalize font-semibold">{item.parcelType} · {item.parcelSize}</span> — {item.packageDescription}
                </p>
              )}

              {item.distanceKm != null && (
                <p className="text-xs text-muted">
                  {item.distanceKm} km • ~{item.durationMin} min
                  {item.estimatedFare != null ? ` • estimate ${formatCurrency(item.estimatedFare)}` : ''}
                </p>
              )}

              <div className="pt-3 border-t border-line space-y-3">
                <div className="flex items-center justify-between">
                  <div>
                    <span className="text-xs text-subtle block ">Customer offers</span>
                    <span className="text-lg font-bold text-fg">{formatCurrency(item.fare)}</span>
                  </div>

                  {item.type === 'Delivery' && (
                    <Button variant="primary" size="sm" disabled={acceptingId === item.id} onClick={() => handleAccept(item)}>
                      {acceptingId === item.id ? 'Accepting...' : 'Accept Request'}
                    </Button>
                  )}

                  {item.type === 'Ride' && !item.myOffer && (
                    <div className="flex gap-2">
                      <Button variant="primary" size="sm" disabled={acceptingId === item.id} onClick={() => handleAccept(item)}>
                        {acceptingId === item.id ? 'Sending...' : `Accept ${formatCurrency(item.fare)}`}
                      </Button>
                      <Button variant="outline" size="sm" onClick={() => setOpenCounter(openCounter === item.id ? null : item.id)}>
                        Counter
                      </Button>
                    </div>
                  )}
                </div>

                {item.type === 'Ride' && item.myOffer && (
                  <div className="p-2.5 rounded-xl bg-info-soft border border-info/30 text-xs flex items-center justify-between gap-2">
                    <span className="text-info">
                      Your offer: <b>{formatCurrency(item.myOffer.fare)}</b>
                      {item.myOffer.kind === 'accept' ? ' (customer fare)' : ' (counter)'} — waiting for the customer
                    </span>
                    <span className="flex gap-3 shrink-0">
                      <button type="button" className="font-semibold text-info" onClick={() => setOpenCounter(openCounter === item.id ? null : item.id)}>Change</button>
                      <button type="button" className="font-semibold text-danger" onClick={() => withdraw(item)}>Withdraw</button>
                    </span>
                  </div>
                )}

                {item.type === 'Ride' && openCounter === item.id && (
                  <div className="flex gap-2">
                    <input
                      type="number" inputMode="numeric" min="1" max="100000" placeholder="Your fare (PKR)"
                      value={counter[item.id] || ''}
                      onChange={(e) => setCounter({ ...counter, [item.id]: e.target.value })}
                      className="flex-1 min-w-0 text-sm border border-field-line rounded-xl px-3 py-2 focus:outline-none focus:ring-2 focus:ring-primary bg-field text-fg"
                    />
                    <Button variant="primary" size="sm" disabled={acceptingId === item.id} onClick={() => sendCounter(item)}>
                      Send offer
                    </Button>
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
