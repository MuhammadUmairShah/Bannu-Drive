import { useNavigate } from 'react-router-dom';
import { LayoutDashboard, Bus, Route, CalendarClock, Ticket, Users, BarChart3, User, ShieldAlert, ScanLine, Wallet } from 'lucide-react'; import { useAuth } from '../context/AuthContext';
import AppShell, { Banner } from '../components/AppShell';

const NAV = [
  { name: 'Dashboard', path: '/operator', icon: LayoutDashboard },
  { name: 'Coaches', path: '/operator/coaches', icon: Bus },
  { name: 'Routes', path: '/operator/routes', icon: Route },
  { name: 'Schedules', path: '/operator/schedules', icon: CalendarClock },
  { name: 'Scan Ticket', path: '/operator/scan', icon: ScanLine },
  { name: 'Bookings', path: '/operator/bookings', icon: Ticket },
  { name: 'Wallet Payments', path: '/operator/payments', icon: Wallet },
  { name: 'Passengers', path: '/operator/passengers', icon: Users },
  { name: 'Reports', path: '/operator/reports', icon: BarChart3 },
  { name: 'Profile', path: '/operator/profile', icon: User }
];

export default function OperatorLayout() {
  const navigate = useNavigate();
  const { user, logout } = useAuth();

  return (
    <AppShell
      portal="Operator"
      navItems={NAV}
      isActive={(item, pathname) => (item.path === '/operator' ? pathname === '/operator' : pathname.startsWith(item.path))}
      user={user}
      profileName={user?.operator?.companyName || user?.name}
      profileSub={user?.email}
      onLogout={async () => { await logout(); navigate('/login'); }}
      banners={
        !user?.isVerified && (
          <Banner tone="warning">
            <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0" />
            Your operator account is waiting for admin approval. You can look around, but coaches, routes and schedules can only be added once approved.
          </Banner>
        )
      }
    />
  );
}
