import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Eye, Car, Package, RefreshCw } from 'lucide-react';
import api from '../../utils/api';
import { getErrorMessage } from '../../utils/errors';
import { formatCurrency } from '../../utils/formatters';

function statusLabel(status) {
  const map = {
    pending: 'Pending',
    accepted: 'Accepted',
    started: 'Started',
    completed: 'Completed',
    cancelled: 'Cancelled'
  };
  return map[status] || status;
}

export default function MyRequests() {
  const [filter, setFilter] = useState('All');
  const [requests, setRequests] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');

  // ==========================================
  // LOAD CUSTOMER'S ACTIVE + PAST RIDES/DELIVERIES
  // ==========================================
  async function loadRequests() {
    try {
      setLoading(true);
      setLoadError('');

      const [activeRideRes, activeDeliveryRes, rideHistoryRes, deliveryHistoryRes] =
        await Promise.all([
          api.get('/ride/my-rides'),
          api.get('/delivery/my-deliveries'),
          api.get('/ride/history'),
          api.get('/delivery/history')
        ]);

      const items = [];

      if (activeRideRes.data.success && activeRideRes.data.ride) {
        items.push({ raw: activeRideRes.data.ride, type: 'Ride' });
      }

      if (activeDeliveryRes.data.success && activeDeliveryRes.data.delivery) {
        items.push({ raw: activeDeliveryRes.data.delivery, type: 'Delivery' });
      }

      if (rideHistoryRes.data.success) {
        rideHistoryRes.data.rides.forEach((r) => items.push({ raw: r, type: 'Ride' }));
      }

      if (deliveryHistoryRes.data.success) {
        deliveryHistoryRes.data.deliveries.forEach((d) => items.push({ raw: d, type: 'Delivery' }));
      }

      const mapped = items.map(({ raw, type }) => ({
        id: raw._id,
        type,
        pickup: raw.pickupLocation,
        dest: raw.destination,
        fare: raw.offeredFare,
        status: statusLabel(raw.status),
        date: raw.createdAt ? new Date(raw.createdAt).toLocaleDateString() : '-'
      }));

      mapped.sort((a, b) => (a.date < b.date ? 1 : -1));

      setRequests(mapped);
    } catch (error) {
      setLoadError(getErrorMessage(error, 'Could not load your requests'));
      setRequests([]);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadRequests();
  }, []);

  // ==========================================
  // FILTER
  // ==========================================
  const filtered = requests.filter((request) => {
    if (filter === 'All') {
      return true;
    }

    if (filter === 'Rides') {
      return request.type === 'Ride';
    }

    if (filter === 'Deliveries') {
      return request.type === 'Delivery';
    }

    if (filter === 'Active') {
      return ['Pending', 'Accepted', 'Started'].includes(
        request.status
      );
    }

    return request.status === filter;
  });

  // ==========================================
  // STATUS STYLE
  // ==========================================
  function getStatusStyle(status) {
    if (status === 'Completed') {
      return 'bg-primary-soft text-link';
    }

    if (status === 'Accepted') {
      return 'bg-info-soft text-info';
    }

    if (status === 'Started') {
      return 'bg-violet-soft text-violet';
    }

    if (status === 'Pending') {
      return 'bg-warning-soft text-warning';
    }

    return 'bg-danger-soft text-danger';
  }

  // ==========================================
  // UI
  // ==========================================
  return (
    <div className="space-y-6">
      {loadError && (
        <div className="p-4 bg-danger-soft border border-danger/30 rounded-xl flex flex-wrap items-center justify-between gap-3">
          <p className="text-sm text-danger">{loadError}</p>
          <button type="button" onClick={() => loadRequests()} className="px-3 py-1.5 rounded-xl bg-fg text-bg hover:bg-primary hover:text-on-primary transition-colors text-xs font-semibold">
            Try again
          </button>
        </div>
      )}


      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">

        <div>
          <h1 className="text-xl font-bold text-fg">
            My Requests
          </h1>

          <p className="text-xs text-muted">
            View and track all your active or completed ride & parcel orders
          </p>
        </div>

        {/* Refresh */}
        <button
          onClick={loadRequests}
          disabled={loading}
          className="inline-flex items-center justify-center gap-2 px-4 py-2 rounded-xl bg-primary hover:bg-primary-hover text-on-primary text-xs font-semibold transition disabled:opacity-60"
        >
          <RefreshCw
            className={`w-3.5 h-3.5 ${
              loading ? 'animate-spin' : ''
            }`}
          />

          Refresh
        </button>

      </div>

      {/* Tabs */}
      <div className="flex space-x-2 border-b border-line pb-2 overflow-x-auto">

        {[
          'All',
          'Rides',
          'Deliveries',
          'Active',
          'Completed',
          'Cancelled'
        ].map((tab) => (
          <button
            key={tab}
            onClick={() => setFilter(tab)}
            className={`px-3 py-1.5 text-xs font-semibold rounded-xl transition-colors whitespace-nowrap ${
              filter === tab
                ? 'bg-fg text-bg'
                : 'text-muted hover:bg-surface-2'
            }`}
          >
            {tab}
          </button>
        ))}

      </div>

      {/* Loading */}
      {loading ? (
        <div className="card p-10 text-center">

          <RefreshCw className="w-7 h-7 animate-spin text-link mx-auto mb-3" />

          <p className="text-sm text-muted">
            Loading your requests...
          </p>

        </div>
      ) : (
        <div className="card overflow-hidden">

          <div className="overflow-x-auto">

            <table className="w-full text-left text-xs">

              {/* Table Header */}
              <thead className="bg-surface-2 border-b border-line text-muted  font-semibold">

                <tr>

                  <th className="px-6 py-3">
                    ID
                  </th>

                  <th className="px-6 py-3">
                    Type
                  </th>

                  <th className="px-6 py-3">
                    Pickup → Destination
                  </th>

                  <th className="px-6 py-3">
                    Fare
                  </th>

                  <th className="px-6 py-3">
                    Status
                  </th>

                  <th className="px-6 py-3">
                    Date
                  </th>

                  <th className="px-6 py-3">
                    Action
                  </th>

                </tr>

              </thead>

              {/* Table Body */}
              <tbody className="divide-y divide-line">

                {filtered.length === 0 ? (
                  <tr>

                    <td
                      colSpan="7"
                      className="px-6 py-12 text-center"
                    >

                      <Car className="w-8 h-8 text-subtle mx-auto mb-2" />

                      <p className="text-sm font-semibold text-muted">
                        No requests found
                      </p>

                      <p className="text-xs text-subtle mt-1">
                        No request matches the selected filter.
                      </p>

                    </td>

                  </tr>
                ) : (
                  filtered.map((item) => (
                    <tr
                      key={`${item.type}-${item.id}`}
                      className="hover:bg-surface-2"
                    >

                      {/* ID */}
                      <td className="px-6 py-3.5 font-bold text-fg">

                        {`REQ-${item.id.slice(-6).toUpperCase()}`}

                      </td>

                      {/* Type */}
                      <td className="px-6 py-3.5">

                        <span className="inline-flex items-center space-x-1">

                          {item.type === 'Ride' ? (
                            <Car className="w-3.5 h-3.5 text-link" />
                          ) : (
                            <Package className="w-3.5 h-3.5 text-info" />
                          )}

                          <span>
                            {item.type}
                          </span>

                        </span>

                      </td>

                      {/* Locations */}
                      <td className="px-6 py-3.5">

                        <span className="font-medium">
                          {item.pickup}
                        </span>

                        <span className="mx-1 text-subtle">
                          →
                        </span>

                        <span className="font-medium">
                          {item.dest}
                        </span>

                      </td>

                      {/* Fare */}
                      <td className="px-6 py-3.5 font-semibold text-fg">
                        {formatCurrency(item.fare)}
                      </td>

                      {/* Status */}
                      <td className="px-6 py-3.5">

                        <span
                          className={`px-2 py-0.5 rounded-full text-xs font-bold ${getStatusStyle(
                            item.status
                          )}`}
                        >
                          {item.status}
                        </span>

                      </td>

                      {/* Date */}
                      <td className="px-6 py-3.5 text-muted">
                        {item.date}
                      </td>

                      {/* Action */}
                      <td className="px-6 py-3.5">

                        <Link
                          to={`/customer/requests/${item.id}?type=${item.type.toLowerCase()}`}
                          className="text-link hover:text-link font-semibold inline-flex items-center space-x-1"
                        >

                          <Eye className="w-3.5 h-3.5" />

                          <span>
                            Details
                          </span>

                        </Link>

                      </td>

                    </tr>
                  ))
                )}

              </tbody>

            </table>

          </div>

        </div>
      )}

    </div>
  );
}
