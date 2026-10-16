import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  LayoutDashboard,
  Radio,
  CheckCircle,
  History,
  Truck,
  Wallet,
  User,
  AlertCircle,
  ShieldAlert,
  MapPinOff,
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import api, { JOB_CHANGED_EVENT } from '../utils/api';
import { useSocketEvent } from '../context/RealtimeContext';
import { getErrorMessage } from '../utils/errors';
import useDriverLocation, { LOCATION_STATE_TEXT } from '../hooks/useDriverLocation';
import AppShell, { Banner } from '../components/AppShell';

export default function DriverLayout() {
  const navigate = useNavigate();
  const { user, setUser, logout } = useAuth();
  const isOnline = user?.driverStatus === 'online';
  const [statusError, setStatusError] = useState('');

  // GPS is shared ONLY while the driver holds an accepted/started booking
  const [hasActiveJob, setHasActiveJob] = useState(false);

  const refreshActiveJob = useCallback(async () => {
    if (!isOnline) {
      setHasActiveJob(false);
      return;
    }
    try {
      const [ride, delivery] = await Promise.all([api.get('/ride/active'), api.get('/delivery/active')]);
      setHasActiveJob(Boolean(ride.data.ride || delivery.data.delivery));
    } catch (error) {
      // keep the previous value; the next event / poll retries
    }
  }, [isOnline]);

  useEffect(() => {
    refreshActiveJob();
    window.addEventListener(JOB_CHANGED_EVENT, refreshActiveJob);
    const timer = setInterval(refreshActiveJob, 60000);
    return () => {
      window.removeEventListener(JOB_CHANGED_EVENT, refreshActiveJob);
      clearInterval(timer);
    };
  }, [refreshActiveJob]);

  useSocketEvent('ride:updated', refreshActiveJob); // e.g. the customer cancelled
  useSocketEvent('delivery:updated', refreshActiveJob);

  const { state: locationState, lastSentAt } = useDriverLocation(isOnline && hasActiveJob);

  const handleLogout = async () => {
    await logout();
    navigate('/login');
  };

  const toggleOnline = async () => {
    setStatusError('');

    try {
      const response = await api.patch('/user/driver-status', {
        status: isOnline ? 'offline' : 'online'
      });
      if (response.data.success) {
        setUser(response.data.user);
      }
    } catch (error) {
      setStatusError(getErrorMessage(error));
    }
  };

  const navItems = [
    { name: 'Dashboard', path: '/driver', icon: LayoutDashboard },
    { name: 'Available Requests', path: '/driver/requests', icon: Radio },
    { name: 'Accepted Request', path: '/driver/requests/active', icon: CheckCircle },
    { name: 'Ride History', path: '/driver/ride-history', icon: History },
    { name: 'Delivery History', path: '/driver/delivery-history', icon: Truck },
    { name: 'Earnings', path: '/driver/earnings', icon: Wallet },
    { name: 'Profile', path: '/driver/profile', icon: User }
  ];

  // Online / offline switch (logic above is unchanged; this is just its new look)
  const onlineSwitch = (
    <div className={`mx-3 mt-2 rounded-2xl border p-3.5 transition-colors ${isOnline ? 'border-sidebar-accent/40 bg-sidebar-active' : 'border-sidebar-line bg-sidebar-hover'}`}>
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <span className="relative flex h-2.5 w-2.5">
            {isOnline && <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-sidebar-accent opacity-60" />}
            <span className={`relative inline-flex h-2.5 w-2.5 rounded-full ${isOnline ? 'bg-sidebar-accent' : 'bg-sidebar-muted'}`} />
          </span>
          <div className="leading-tight">
            <p className="text-sm font-semibold text-white">{isOnline ? 'You are online' : 'You are offline'}</p>
            <p className="text-xs text-sidebar-muted">{isOnline ? 'Receiving requests' : 'Go online to receive requests'}</p>
          </div>
        </div>
        <button
          type="button"
          role="switch"
          aria-checked={isOnline}
          aria-label={isOnline ? 'Go offline' : 'Go online'}
          onClick={toggleOnline}
          className={`flex h-6 w-11 shrink-0 items-center rounded-full p-0.5 transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sidebar-accent ${
            isOnline ? 'justify-end bg-sidebar-accent' : 'justify-start bg-white/20'
          }`}
        >
          <span className="h-5 w-5 rounded-full bg-white shadow-md" />
        </button>
      </div>
    </div>
  );

  const banners = (
    <>
      {statusError && (
        <Banner tone="danger">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
          {statusError}
        </Banner>
      )}

      {user && !user.isVerified && (
        <Banner tone="warning">
          <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0" />
          Your account is waiting for admin verification. You can go online and accept requests once approved.
        </Banner>
      )}

      {hasActiveJob && locationState !== 'sharing' && locationState !== 'starting' && (
        <Banner tone="warning">
          <MapPinOff className="mt-0.5 h-4 w-4 shrink-0" />
          <span>
            {LOCATION_STATE_TEXT[locationState]}. Customers cannot see your position until location access works.
            {locationState === 'denied' && ' Allow location for this site in your browser settings, then reload.'}
          </span>
        </Banner>
      )}
    </>
  );

  const sharing = hasActiveJob && locationState === 'sharing' && lastSentAt;

  return (
    <AppShell
      portal="Driver"
      navItems={navItems}
      isActive={(item, pathname) => pathname === item.path}
      user={user}
      profileName={user?.name}
      profileSub={`${isOnline ? 'Online' : 'Offline'}${sharing ? ' • sharing location' : ''}`}
      onLogout={handleLogout}
      sidebarTop={onlineSwitch}
      banners={banners}
    />
  );
}
