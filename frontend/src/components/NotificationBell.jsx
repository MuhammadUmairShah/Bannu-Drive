import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Bell, CheckCheck, RefreshCw } from 'lucide-react';
import { useRealtime } from '../context/RealtimeContext';
import { useAuth } from '../context/AuthContext';
import { timeAgo } from '../utils/geo';

// Where "Open" should take the user for each notification
function targetFor(notification, role) {
  const { type, serviceType, serviceId } = notification;

  if (type.startsWith('coach_booking')) {
    if (role === 'operator') return '/operator/bookings';
    return serviceId ? `/customer/bookings/${serviceId}` : '/customer/bookings';
  }

  if (role === 'operator') return type.startsWith('account_') ? '/operator/profile' : '/operator';

  if (type === 'ride_offer' || type === 'driver_arrived' || type === 'ride_accepted') {
    if (role === 'customer' && serviceId) return `/customer/requests/${serviceId}?type=ride`;
  }
  if (type === 'driver_selected') return '/driver/requests/active';

  if (role === 'driver') {
    if (type === 'new_ride_request' || type === 'new_delivery_request') return '/driver/requests';
    if (type.endsWith('_cancelled')) return '/driver/requests';
    if (type === 'account_verified' || type === 'account_unverified') return '/driver/profile';
    return '/driver/requests/active';
  }

  if (role === 'customer') {
    if (serviceType === 'complaint') return '/customer/complaints';
    if (serviceId && (serviceType === 'ride' || serviceType === 'delivery')) {
      return `/customer/requests/${serviceId}?type=${serviceType}`;
    }
    return '/customer';
  }

  return '/admin';
}

export default function NotificationBell() {
  const { user } = useAuth();
  const { notifications, unreadCount, loading, error, reload, markRead, markAllRead, connected } = useRealtime();
  const [open, setOpen] = useState(false);
  const wrapperRef = useRef(null);
  const navigate = useNavigate();

  useEffect(() => {
    function onClickAway(event) {
      if (wrapperRef.current && !wrapperRef.current.contains(event.target)) setOpen(false);
    }
    document.addEventListener('mousedown', onClickAway);
    return () => document.removeEventListener('mousedown', onClickAway);
  }, []);

  function openNotification(notification) {
    if (!notification.read) markRead(notification._id);
    setOpen(false);
    navigate(targetFor(notification, user?.role));
  }

  return (
    <div className="relative" ref={wrapperRef}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-label={`Notifications${unreadCount ? `, ${unreadCount} unread` : ''}`}
        className="relative rounded-full p-2 text-muted hover:bg-surface-2 focus:outline-none focus:ring-2 focus:ring-primary"
      >
        <Bell className="h-5 w-5" />
        {unreadCount > 0 && (
          <span className="absolute -top-0.5 -right-0.5 flex h-5 min-w-5 items-center justify-center rounded-full bg-danger-solid px-1 text-xs font-bold text-on-danger">
            {unreadCount > 99 ? '99+' : unreadCount}
          </span>
        )}
      </button>

      {open && (
        <div className="card absolute right-0 z-50 mt-2 w-[min(92vw,22rem)] overflow-hidden shadow-lg">
          <div className="flex items-center justify-between border-b border-line px-4 py-3">
            <div>
              <p className="text-sm font-bold text-fg">Notifications</p>
              <p className="text-xs text-muted">{connected ? 'Live' : 'Reconnecting...'}</p>
            </div>
            <div className="flex items-center gap-2">
              <button type="button" onClick={reload} aria-label="Refresh" className="text-muted hover:text-fg">
                <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
              </button>
              {unreadCount > 0 && (
                <button
                  type="button"
                  onClick={markAllRead}
                  className="inline-flex items-center gap-1 text-xs font-semibold text-link hover:text-link"
                >
                  <CheckCheck className="h-3.5 w-3.5" /> Mark all read
                </button>
              )}
            </div>
          </div>

          <div className="max-h-96 overflow-y-auto custom-scrollbar">
            {error && <p className="px-4 py-3 text-xs text-danger">{error}</p>}

            {!error && notifications.length === 0 && (
              <p className="px-4 py-8 text-center text-sm text-muted">No notifications yet.</p>
            )}

            {notifications.map((n) => (
              <button
                key={n._id}
                type="button"
                onClick={() => openNotification(n)}
                className={`flex w-full items-start gap-3 border-b border-line px-4 py-3 text-left hover:bg-surface-2 ${
                  n.read ? '' : 'bg-primary-soft/60'
                }`}
              >
                <span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${n.read ? 'bg-transparent' : 'bg-primary'}`} />
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-semibold text-fg">{n.title}</span>
                  <span className="block text-xs text-muted break-words">{n.message}</span>
                  <span className="mt-1 block text-xs text-subtle">{timeAgo(n.createdAt)}</span>
                </span>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
