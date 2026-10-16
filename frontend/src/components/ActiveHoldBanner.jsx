import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Clock } from 'lucide-react';
import api from '../utils/api';
import useCountdown from '../hooks/useCountdown';
import { fmtCountdown } from '../utils/seatSync';

function Row({ order, serverTime }) {
  const left = useCountdown(order.holdExpiresAt, serverTime);
  if (left <= 0) return null;
  return (
    <Link to={`/customer/checkout/${order._id}`} className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-xl border border-warning/40 bg-warning-soft px-4 py-3 text-sm text-warning">
      <Clock className="h-4 w-4 shrink-0" />
      <span className="font-semibold">
        {order.status === 'PENDING_PAYMENT' ? 'Payment in progress' : 'Seats on hold'}: {order.trip?.fromCity} → {order.trip?.toCity}, seat {order.seats.join(', ')}
      </span>
      <span className="font-mono font-bold">{fmtCountdown(left)}</span>
      <span className="ml-auto font-semibold underline">Continue →</span>
    </Link>
  );
}

// Shown wherever a customer might land after closing the browser mid-checkout: their unfinished holds, with a live timer.
export default function ActiveHoldBanner() {
  const [state, setState] = useState({ orders: [], serverTime: null });

  useEffect(() => {
    let alive = true;
    api.get('/coach/orders/active').then((r) => alive && setState({ orders: r.data.orders || [], serverTime: r.data.serverTime })).catch(() => {});
    return () => { alive = false; };
  }, []);

  if (!state.orders.length) return null;
  return <div className="space-y-2">{state.orders.map((o) => <Row key={o._id} order={o} serverTime={state.serverTime} />)}</div>;
}
