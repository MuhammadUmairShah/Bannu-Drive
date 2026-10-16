import { Link } from 'react-router-dom';
import { LayoutDashboard } from 'lucide-react';
import useFetch from '../../hooks/useFetch';
import { PageHeader, Loading, ErrorBox, EmptyBox, Stat, Badge, statusTone } from '../../components/ui';
import { formatCurrency } from '../../utils/formatters';
import { fmtDate, fmtTime } from '../../utils/dates';
import { useSocketEvent } from '../../context/RealtimeContext';

const TripRow = ({ s }) => (
  <div className="flex items-center justify-between gap-3 py-2.5 border-b border-line last:border-0 text-xs">
    <div className="min-w-0"><p className="font-semibold text-fg truncate">{s.fromCity} → {s.toCity}</p><p className="text-muted">{fmtDate(s.departureAt)}, {fmtTime(s.departureAt)} • {s.coach?.name}</p></div>
    <div className="text-right shrink-0"><p className="font-semibold">{s.bookedSeats}/{s.totalSeats} booked</p><p className="text-muted">{s.availableSeats} free</p></div>
  </div>
);

export default function OperatorDashboard() {
  const { data, loading, error, reload } = useFetch('/coach/operator/dashboard');
  useSocketEvent('notification:new', (n) => { if (n.serviceType === 'coach_booking') reload(true); });

  if (loading) return <Loading text="Loading dashboard..." />;
  if (error) return <ErrorBox message={error} onRetry={reload} />;

  const { stats: st, todaysTrips, upcoming, recentBookings, pendingActions: pa } = data;

  return (
    <div className="space-y-6">
      <PageHeader icon={LayoutDashboard} title="Operator Dashboard" subtitle="Live numbers from your coach bookings" />

      {pa && (pa.verification || pa.cashToCollect > 0) && (
        <div className="space-y-2">
          {pa.verification && <Link to="/operator/profile" className="block rounded-xl border border-warning/40 bg-warning-soft px-4 py-3 text-sm font-semibold text-warning">Your account is waiting for verification. Upload your documents so you can publish trips →</Link>}
          {pa.cashToCollect > 0 && <Link to="/operator/bookings" className="block rounded-xl border border-primary/40 bg-primary-soft px-4 py-3 text-sm font-semibold text-link">{pa.cashToCollect} cash booking{pa.cashToCollect > 1 ? 's' : ''} to collect ({formatCurrency(st.cashDue)}) →</Link>}
        </div>
      )}

      <div className="grid grid-cols-2 lg:grid-cols-4 xl:grid-cols-8 gap-3">
        <Stat label="Booked seats (upcoming)" value={st.bookedSeatsUpcoming} />
        <Stat label="Occupancy (upcoming)" value={`${st.occupancyUpcomingPct}%`} />
        <Stat label="Collected" value={formatCurrency(st.collected)} tone="green" hint="paid online + cash received" />
        <Stat label="Cash to collect" value={formatCurrency(st.cashDue)} tone="amber" />
        <Stat label="Seats on hold now" value={st.activeHolds} hint="customers checking out" />
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-3">
        <Stat label="Today's trips" value={st.todaysTrips} />
        <Stat label="Upcoming schedules" value={st.upcomingSchedules} />
        <Stat label="Total bookings" value={st.totalBookings} hint={`${st.cancelledBookings} cancelled`} />
        <Stat label="Seats available" value={st.availableSeats} hint="across upcoming trips" />
        <Stat label="Revenue (upcoming)" value={formatCurrency(st.revenueUpcoming)} />
        <Stat label="Revenue (total)" value={formatCurrency(st.revenueTotal)} tone="green" hint="confirmed + completed" />
      </div>

      <div className="grid gap-5 lg:grid-cols-2">
        <section className="card p-5">
          <h2 className="text-sm font-bold text-fg mb-2">Today's trips</h2>
          {todaysTrips.length === 0 ? <EmptyBox title="No trips today" /> : todaysTrips.map((s) => <TripRow key={s._id} s={s} />)}
        </section>
        <section className="card p-5">
          <div className="flex justify-between mb-2"><h2 className="text-sm font-bold text-fg">Upcoming schedules</h2><Link to="/operator/schedules" className="text-xs font-semibold text-link">Manage</Link></div>
          {upcoming.length === 0 ? <EmptyBox title="No upcoming schedules" hint="Add a coach, a route and a schedule to start selling seats." /> : upcoming.map((s) => <TripRow key={s._id} s={s} />)}
        </section>
      </div>

      <section className="card overflow-x-auto">
        <div className="px-5 py-4 border-b border-line flex justify-between"><h2 className="text-sm font-bold text-fg">Recent bookings</h2><Link to="/operator/bookings" className="text-xs font-semibold text-link">View all</Link></div>
        {recentBookings.length === 0 ? <EmptyBox title="No bookings yet" /> : (
          <table className="w-full min-w-[36rem] text-xs text-left">
            <tbody className="divide-y divide-line">
              {recentBookings.map((b) => (
                <tr key={b._id}>
                  <td className="px-5 py-3 font-mono font-bold">{b.bookingCode}</td>
                  <td className="px-3 py-3">{b.passenger.name}<span className="block text-subtle">{b.passenger.phone}</span></td>
                  <td className="px-3 py-3">{b.fromCity} → {b.toCity}<span className="block text-subtle">{fmtDate(b.departureAt)}, {fmtTime(b.departureAt)}</span></td>
                  <td className="px-3 py-3">Seat {b.seat}</td>
                  <td className="px-3 py-3 font-semibold">{formatCurrency(b.fare)}</td>
                  <td className="px-5 py-3"><Badge tone={statusTone(b.status)}>{b.status}</Badge></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </div>
  );
}
