import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Radio, DollarSign, CheckCircle2, ArrowRight } from 'lucide-react';
import Button from '../../components/Button';
import { formatCurrency } from '../../utils/formatters';
import api from '../../utils/api';
import { getErrorMessage } from '../../utils/errors';
import { useAuth } from '../../context/AuthContext';
import { useSocketEvent } from '../../context/RealtimeContext';
import Avatar from '../../components/Avatar';

export default function DriverDashboard() {
  const navigate = useNavigate();

  const [availableCount, setAvailableCount] = useState(0);
  const [completedCount, setCompletedCount] = useState(0);
  const [totalEarnings, setTotalEarnings] = useState(0);
  const [activeJob, setActiveJob] = useState(null); // { type, ...data }
  const [loading, setLoading] = useState(true);
  const [availabilityNote, setAvailabilityNote] = useState('');
  const [loadError, setLoadError] = useState('');
  const { user } = useAuth();

  async function loadDashboard(silent = false) {
    try {
      if (!silent) setLoading(true);
      setLoadError('');

      // allSettled: available-request endpoints legitimately refuse offline / unverified drivers
      const results = await Promise.allSettled([
        api.get('/ride/available'),
        api.get('/delivery/available'),
        api.get('/ride/history'),
        api.get('/delivery/history'),
        api.get('/ride/active'),
        api.get('/delivery/active'),
        api.get('/payment/my-transactions')
      ]);

      const ok = (i) => (results[i].status === 'fulfilled' ? results[i].value : { data: { success: false } });

      const availableRideRes = ok(0);
      const availableDeliveryRes = ok(1);
      const rideHistoryRes = ok(2);
      const deliveryHistoryRes = ok(3);
      const activeRideRes = ok(4);
      const activeDeliveryRes = ok(5);
      const transactionsRes = ok(6);

      // History / active / earnings failing is a real problem (unlike "offline" refusals above)
      const broken = [2, 3, 4, 5, 6].find((i) => results[i].status === 'rejected');
      if (broken !== undefined) setLoadError(getErrorMessage(results[broken].reason, 'Some dashboard data could not be loaded'));

      const refused = [results[0], results[1]].find((r) => r.status === 'rejected');
      setAvailabilityNote(refused ? getErrorMessage(refused.reason) : '');

      const availableRides = availableRideRes.data.success ? availableRideRes.data.rides : [];
      const availableDeliveries = availableDeliveryRes.data.success ? availableDeliveryRes.data.deliveries : [];
      setAvailableCount(availableRides.length + availableDeliveries.length);

      const completedRides = rideHistoryRes.data.success
        ? rideHistoryRes.data.rides.filter((r) => r.status === 'completed')
        : [];
      const completedDeliveries = deliveryHistoryRes.data.success
        ? deliveryHistoryRes.data.deliveries.filter((d) => d.status === 'completed')
        : [];

      setCompletedCount(completedRides.length + completedDeliveries.length);

      setTotalEarnings(transactionsRes.data.success ? transactionsRes.data.totalEarning : 0);

      if (activeRideRes.data.success && activeRideRes.data.ride) {
        setActiveJob({ type: 'ride', ...activeRideRes.data.ride });
      } else if (activeDeliveryRes.data.success && activeDeliveryRes.data.delivery) {
        setActiveJob({ type: 'delivery', ...activeDeliveryRes.data.delivery });
      } else {
        setActiveJob(null);
      }
    } catch (error) {
      setLoadError(getErrorMessage(error));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadDashboard();
     
  }, [user?.driverStatus, user?.isVerified]);

  // Live refresh when the server pushes a relevant change
  useSocketEvent('notification:new', () => loadDashboard(true));
  useSocketEvent('request:unavailable', () => loadDashboard(true));
  useSocketEvent('ride:updated', () => loadDashboard(true));
  useSocketEvent('delivery:updated', () => loadDashboard(true));

  const stats = [
    {
      label: 'Available Requests',
      value: availableCount,
      icon: Radio,
      color: 'text-warning bg-warning-soft'
    },
    {
      label: 'Completed Trips',
      value: completedCount,
      icon: CheckCircle2,
      color: 'text-link bg-primary-soft'
    },
    {
      label: 'Total Earnings',
      value: formatCurrency(totalEarnings),
      icon: DollarSign,
      color: 'text-info bg-info-soft'
    }
  ];

  return (
    <div className="space-y-6">

      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <Avatar user={user} size="md" />
          <div>
            <h1 className="text-xl font-bold text-fg">Hello, {user?.name?.split(' ')[0] || 'Driver'}</h1>
            <div className="flex flex-wrap gap-1.5 mt-1">
              <span className={`px-2 py-0.5 rounded-full text-xs font-bold ${user?.isVerified ? 'bg-primary-soft text-link' : 'bg-warning-soft text-warning'}`}>
                {user?.isVerified ? 'Verified' : 'Awaiting admin verification'}
              </span>
              <span className={`px-2 py-0.5 rounded-full text-xs font-bold capitalize ${user?.driverStatus === 'offline' ? 'bg-surface-2 text-muted' : 'bg-success-soft text-success'}`}>
                {user?.driverStatus || 'offline'}
              </span>
            </div>
          </div>
        </div>

        <Button
          variant="primary"
          size="sm"
          onClick={() => navigate('/driver/requests')}
          icon={Radio}
        >
          Browse Available Requests
        </Button>
      </div>

      {loadError && (
        <div className="p-3 bg-danger-soft border border-danger/30 rounded-xl flex flex-wrap items-center justify-between gap-2">
          <p className="text-xs font-semibold text-danger">{loadError}</p>
          <button type="button" onClick={() => loadDashboard()} className="px-3 py-1.5 rounded-xl bg-fg text-bg hover:bg-primary hover:text-on-primary transition-colors text-xs font-semibold">
            Try again
          </button>
        </div>
      )}

      {availabilityNote && (
        <div className="p-3 bg-warning-soft border border-warning/30 text-warning text-xs rounded-xl font-semibold">
          {availabilityNote}
        </div>
      )}

      {/* Statistics */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        {stats.map((stat, i) => {
          const Icon = stat.icon;
          return (
            <div key={i} className="card p-5 flex items-center justify-between">
              <div>
                <p className="text-xs font-medium text-muted ">{stat.label}</p>
                <p className="text-2xl font-bold text-fg mt-1">
                  {loading ? '...' : stat.value}
                </p>
              </div>
              <div className={`p-3 rounded-xl ${stat.color}`}>
                <Icon className="w-6 h-6" />
              </div>
            </div>
          );
        })}
      </div>

      {/* Active Trip Assignment */}
      <div className="card p-6 space-y-4">
        <h3 className="text-sm font-bold text-fg">Active Trip Assignment</h3>

        {loading ? (
          <p className="text-xs text-muted py-4 text-center">Loading...</p>
        ) : !activeJob ? (
          <div className="text-center py-8">
            <Radio className="w-8 h-8 text-subtle mx-auto mb-2" />
            <p className="text-sm text-muted">You have no active ride or delivery right now.</p>
            <p className="text-xs text-subtle mt-1">Browse available requests to accept one.</p>
          </div>
        ) : (
          <div className="p-4 bg-surface-2 rounded-xl border border-line flex flex-col sm:flex-row justify-between items-center gap-4 text-xs">
            <div>
              <span className="font-bold text-link ">
                {activeJob.type === 'ride' ? 'Ride' : 'Delivery'} #{activeJob._id.slice(-6).toUpperCase()}
              </span>
              <p className="text-fg font-semibold mt-0.5">
                {activeJob.pickupLocation} → {activeJob.destination}
              </p>
              <p className="text-muted">
                Customer: {activeJob.customer?.name || 'Customer'} ({activeJob.customer?.phone || '-'})
              </p>
            </div>

            <div className="text-right">
              <p className="text-base font-extrabold text-fg">
                {formatCurrency(activeJob.offeredFare)}
              </p>
              <Link to="/driver/requests/active">
                <Button size="sm" variant="primary" className="mt-1" icon={ArrowRight}>
                  Manage Trip Status
                </Button>
              </Link>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
