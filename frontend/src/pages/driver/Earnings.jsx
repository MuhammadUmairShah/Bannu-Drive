import { useEffect, useState, useCallback } from 'react';
import api from '../../utils/api';
import { formatCurrency } from '../../utils/formatters';
import { getErrorMessage } from '../../utils/errors';

function startOfDay(d) {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

export default function DriverEarnings() {
  const [loading, setLoading] = useState(true);
  const [transactions, setTransactions] = useState([]);
  const [totals, setTotals] = useState({ totalFare: 0, totalCommission: 0, totalEarning: 0 });
  const [error, setError] = useState('');

  const loadEarnings = useCallback(async () => {
    try {
      setLoading(true);
      setError('');
      const response = await api.get('/payment/my-transactions');
      if (response.data.success) {
        setTransactions(response.data.transactions.map((t) => ({ ...t, date: new Date(t.createdAt) })));
        setTotals({
          totalFare: response.data.totalFare || 0,
          totalCommission: response.data.totalCommission || 0,
          totalEarning: response.data.totalEarning || 0
        });
      }
    } catch (err) {
      setError(getErrorMessage(err, 'Could not load your earnings'));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadEarnings();
  }, [loadEarnings]);

  const now = new Date();
  const today = startOfDay(now);
  const weekStart = new Date(today);
  weekStart.setDate(weekStart.getDate() - 6);
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);

  const sumSince = (since) =>
    transactions
      .filter((t) => t.date >= since)
      .reduce((sum, t) => sum + (t.driverEarning || 0), 0);

  const earnings = {
    today: sumSince(today),
    thisWeek: sumSince(weekStart),
    thisMonth: sumSince(monthStart),
    total: totals.totalEarning
  };

  const dayLabels = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const last7Days = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(today);
    d.setDate(d.getDate() - (6 - i));
    const next = new Date(d);
    next.setDate(next.getDate() + 1);
    const total = transactions
      .filter((t) => t.date >= d && t.date < next)
      .reduce((sum, t) => sum + (t.driverEarning || 0), 0);
    return { day: dayLabels[d.getDay()], total };
  });

  const maxDay = Math.max(1, ...last7Days.map((d) => d.total));

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-bold text-fg">Driver Earnings</h1>
        <p className="text-xs text-muted">
          Your net earnings after platform commission on completed rides and deliveries
        </p>
      </div>

      {error && (
        <div className="p-4 bg-danger-soft border border-danger/30 rounded-xl flex flex-wrap items-center justify-between gap-3">
          <p className="text-sm text-danger">{error}</p>
          <button type="button" onClick={loadEarnings} className="px-3 py-1.5 rounded-xl bg-fg text-bg hover:bg-primary hover:text-on-primary transition-colors text-xs font-semibold">
            Try again
          </button>
        </div>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="card p-5">
          <p className="text-xs text-muted ">Today</p>
          <p className="text-2xl font-extrabold text-fg mt-1">
            {loading ? '...' : formatCurrency(earnings.today)}
          </p>
        </div>
        <div className="card p-5">
          <p className="text-xs text-muted ">This Week</p>
          <p className="text-2xl font-extrabold text-fg mt-1">
            {loading ? '...' : formatCurrency(earnings.thisWeek)}
          </p>
        </div>
        <div className="card p-5">
          <p className="text-xs text-muted ">This Month</p>
          <p className="text-2xl font-extrabold text-fg mt-1">
            {loading ? '...' : formatCurrency(earnings.thisMonth)}
          </p>
        </div>
        <div className="bg-sidebar text-white p-5 rounded-2xl border border-sidebar-line shadow-pop">
          <p className="text-xs text-sidebar-muted">All Time Total</p>
          <p className="text-2xl font-extrabold text-sidebar-accent mt-1">
            {loading ? '...' : formatCurrency(earnings.total)}
          </p>
        </div>
      </div>

      <div className="grid grid-cols-3 gap-3 text-center">
        <div className="card p-3">
          <p className="text-xs text-muted ">Trips paid</p>
          <p className="text-base sm:text-lg font-bold text-fg break-words">{loading ? '...' : transactions.length}</p>
        </div>
        <div className="card p-3">
          <p className="text-xs text-muted ">Total fares</p>
          <p className="text-base sm:text-lg font-bold text-fg break-words">{loading ? '...' : formatCurrency(totals.totalFare)}</p>
        </div>
        <div className="card p-3">
          <p className="text-xs text-muted ">Commission paid</p>
          <p className="text-base sm:text-lg font-bold text-danger break-words">{loading ? '...' : formatCurrency(totals.totalCommission)}</p>
        </div>
      </div>

      {/* Weekly Breakdown Chart */}
      <div className="card p-6 space-y-4">
        <h3 className="text-sm font-bold text-fg">Last 7 Days Earnings</h3>
        <div className="h-40 flex items-end gap-2 sm:gap-4 border-b border-line pb-2">
          {last7Days.map((bar, i) => (
            <div key={i} className="flex-1 flex flex-col items-center">
              <div
                style={{ height: `${Math.max(4, (bar.total / maxDay) * 100)}%` }}
                className="w-full bg-primary rounded-t-md hover:bg-primary transition-all"
                title={formatCurrency(bar.total)}
              />
              <span className="text-xs text-muted mt-2">{bar.day}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Recent Transactions */}
      <div className="card overflow-x-auto">
        <div className="p-4 border-b border-line">
          <h3 className="text-sm font-bold text-fg">Recent Transactions</h3>
        </div>
        {loading ? (
          <p className="text-xs text-subtle p-6 text-center">Loading...</p>
        ) : error ? (
          <p className="text-xs text-subtle p-6 text-center">Could not load transactions.</p>
        ) : transactions.length === 0 ? (
          <p className="text-xs text-subtle p-6 text-center">No completed trips yet.</p>
        ) : (
          <table className="w-full min-w-[34rem] text-left text-xs">
            <thead className="bg-surface-2 border-b border-line text-muted  font-semibold">
              <tr>
                <th className="px-6 py-3">Trip</th>
                <th className="px-6 py-3">Fare</th>
                <th className="px-6 py-3">Commission</th>
                <th className="px-6 py-3">Your Earning</th>
                <th className="px-6 py-3">Date</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {transactions.slice(0, 10).map((t) => (
                <tr key={t._id}>
                  <td className="px-6 py-3.5"><span className="capitalize font-semibold">{t.serviceType}</span>{t.routeLabel ? <span className="block text-xs text-muted">{t.routeLabel}</span> : null}</td>
                  <td className="px-6 py-3.5">{formatCurrency(t.fare)}</td>
                  <td className="px-6 py-3.5 text-danger">-{formatCurrency(t.commissionAmount)} ({t.commissionPercentage}%)</td>
                  <td className="px-6 py-3.5 font-bold text-link">{formatCurrency(t.driverEarning)}</td>
                  <td className="px-6 py-3.5 text-muted">{t.date.toLocaleDateString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
