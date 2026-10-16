import { useEffect, useState, useCallback } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Car, Package, Clock, ArrowRight, RefreshCw } from 'lucide-react';
import Button from '../../components/Button';
import Avatar from '../../components/Avatar';
import api from '../../utils/api';
import { formatCurrency } from '../../utils/formatters';
import { getErrorMessage } from '../../utils/errors';
import { useAuth } from '../../context/AuthContext';
import { useSocketEvent } from '../../context/RealtimeContext';

const STATUS_LABEL = {
  pending: 'Waiting for driver',
  accepted: 'Driver on the way',
  started: 'In progress',
  completed: 'Completed',
  cancelled: 'Cancelled'
};

const STATUS_COLOR = {
  pending: 'text-warning',
  accepted: 'text-info',
  started: 'text-violet',
  completed: 'text-link',
  cancelled: 'text-danger'
};

export default function CustomerDashboard() {
  const navigate = useNavigate();
  const { user } = useAuth();

  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = useCallback(async (silent = false) => {
    try {
      if (!silent) {
        setLoading(true);
        setError('');
      }

      const [activeRide, activeDelivery, rideHistory, deliveryHistory] = await Promise.all([
        api.get('/ride/my-rides'),
        api.get('/delivery/my-deliveries'),
        api.get('/ride/history'),
        api.get('/delivery/history')
      ]);

      setData({
        activeRide: activeRide.data.ride,
        activeDelivery: activeDelivery.data.delivery,
        rides: rideHistory.data.rides || [],
        deliveries: deliveryHistory.data.deliveries || []
      });
    } catch (err) {
      if (!silent) setError(getErrorMessage(err));
    } finally {
      if (!silent) setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  // Refresh whenever the server tells us a booking changed
  useSocketEvent('ride:updated', () => load(true));
  useSocketEvent('delivery:updated', () => load(true));

  if (loading) {
    return (
      <div className="py-20 text-center">
        <RefreshCw className="w-7 h-7 animate-spin text-link mx-auto mb-3" />
        <p className="text-sm text-muted">Loading your dashboard...</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="max-w-md mx-auto py-16 text-center space-y-3">
        <p className="text-sm text-danger">{error}</p>
        <Button size="sm" onClick={() => load()}>Try again</Button>
      </div>
    );
  }

  const completedRides = data.rides.filter((r) => r.status === 'completed').length;
  const completedDeliveries = data.deliveries.filter((d) => d.status === 'completed').length;
  const activeItems = [
    data.activeRide && { ...data.activeRide, type: 'ride' },
    data.activeDelivery && { ...data.activeDelivery, type: 'delivery' }
  ].filter(Boolean);

  const recent = [
    ...data.rides.map((r) => ({ ...r, type: 'ride' })),
    ...data.deliveries.map((d) => ({ ...d, type: 'delivery' })),
    ...activeItems
  ]
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
    .slice(0, 6);

  const stats = [
    { label: 'Completed Rides', value: completedRides, icon: Car, color: 'text-link bg-primary-soft' },
    { label: 'Completed Deliveries', value: completedDeliveries, icon: Package, color: 'text-info bg-info-soft' },
    {
      label: 'Total Requests',
      value: data.rides.length + data.deliveries.length + activeItems.length,
      icon: Clock,
      color: 'text-muted bg-surface-2'
    }
  ];

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <Avatar user={user} size="md" />
          <div>
            <h1 className="text-xl font-bold text-fg">Welcome, {user?.name?.split(' ')[0] || 'there'}</h1>
            <p className="text-xs text-muted">Manage rides and dispatch local parcels across Bannu</p>
          </div>
        </div>
        <div className="flex space-x-3">
          <Button variant="primary" size="sm" onClick={() => navigate('/customer/request-ride')} icon={Car}>
            Request Ride
          </Button>
          <Button variant="secondary" size="sm" onClick={() => navigate('/customer/request-delivery')} icon={Package}>
            Request Delivery
          </Button>
        </div>
      </div>

      {activeItems.map((item) => (
        <div key={`${item.type}-${item._id}`} className="relative overflow-hidden bg-sidebar text-white p-5 rounded-2xl border border-sidebar-line shadow-pop space-y-3">
          <div className="flex justify-between items-center border-b border-sidebar-line pb-3">
            <span className="inline-flex items-center space-x-2 text-xs font-bold text-sidebar-accent">
              <Clock className="w-4 h-4 animate-pulse" />
              <span>Active {item.type === 'ride' ? 'Ride' : 'Delivery'} Request</span>
            </span>
            <span className="bg-sidebar-accent text-navy text-xs font-bold px-2.5 py-1 rounded-full">
              {STATUS_LABEL[item.status]}
            </span>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-xs">
            <div>
              <p className="text-sidebar-muted">Pickup Location</p>
              <p className="font-semibold text-white">{item.pickupLocation}</p>
            </div>
            <div>
              <p className="text-sidebar-muted">Destination</p>
              <p className="font-semibold text-white">{item.destination}</p>
            </div>
            <div>
              <p className="text-sidebar-muted">Offered Fare / Assigned Driver</p>
              <p className="font-semibold text-white">
                {formatCurrency(item.offeredFare)} • {item.driver ? item.driver.name : 'Not assigned yet'}
              </p>
            </div>
          </div>

          <div className="pt-2 flex justify-end">
            <Link to={`/customer/requests/${item._id}?type=${item.type}`}>
              <Button size="sm" variant="outline" className="bg-white/10 hover:bg-white/20 text-white border-none">
                View Live Details <ArrowRight className="w-3.5 h-3.5 ml-1" />
              </Button>
            </Link>
          </div>
        </div>
      ))}

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        {stats.map((stat) => {
          const Icon = stat.icon;
          return (
            <div key={stat.label} className="card p-5 flex items-center justify-between">
              <div>
                <p className="text-xs font-medium text-muted ">{stat.label}</p>
                <p className="text-2xl font-bold text-fg mt-1">{stat.value}</p>
              </div>
              <div className={`p-3 rounded-xl ${stat.color}`}>
                <Icon className="w-6 h-6" />
              </div>
            </div>
          );
        })}
      </div>

      <div className="card overflow-hidden">
        <div className="px-6 py-4 border-b border-line flex items-center justify-between">
          <h3 className="text-sm font-bold text-fg">Recent Requests</h3>
          <Link to="/customer/requests" className="text-xs font-semibold text-link hover:text-link">
            View All
          </Link>
        </div>

        {recent.length === 0 ? (
          <p className="px-6 py-10 text-center text-sm text-muted">
            No requests yet. Request your first ride or delivery above.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="bg-surface-2 border-b border-line text-muted  font-semibold">
                <tr>
                  <th className="px-6 py-3">Type</th>
                  <th className="px-6 py-3">Route</th>
                  <th className="px-6 py-3">Fare</th>
                  <th className="px-6 py-3">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {recent.map((item) => (
                  <tr key={`${item.type}-${item._id}`}>
                    <td className="px-6 py-3.5 capitalize">{item.type}</td>
                    <td className="px-6 py-3.5">{item.pickupLocation} → {item.destination}</td>
                    <td className="px-6 py-3.5 font-semibold">{formatCurrency(item.offeredFare)}</td>
                    <td className={`px-6 py-3.5 font-semibold ${STATUS_COLOR[item.status]}`}>{STATUS_LABEL[item.status]}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
