import { useNavigate } from 'react-router-dom';
import {
  Users,
  Car,
  Package,
  AlertCircle,
  BarChart3,
  Star,
  Building2,
  Bus,
  Route as RouteIcon,
  CalendarClock,
  Ticket,
  Settings,
  LayoutDashboard,
  ShieldCheck,
  ScrollText,
  Wallet,
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import AppShell from '../components/AppShell';

export default function AdminLayout() {
  const navigate = useNavigate();
  const { user, logout } = useAuth();

  const handleLogout = async () => {
    await logout();
    navigate('/login');
  };

  const navItems = [
    { name: 'Overview', path: '/admin', icon: LayoutDashboard },
    { name: 'Customers', path: '/admin/customers', icon: Users },
    { name: 'Drivers & Verification', path: '/admin/drivers', icon: Car },
    { name: 'Ride Requests', path: '/admin/rides', icon: Car },
    { name: 'Delivery Requests', path: '/admin/deliveries', icon: Package },
    { name: 'Complaints', path: '/admin/complaints', icon: AlertCircle },
    { name: 'Verification', path: '/admin/verification', icon: ShieldCheck },
    { name: 'Operators', path: '/admin/operators', icon: Building2 },
    { name: 'Coaches', path: '/admin/coaches', icon: Bus },
    { name: 'Coach Routes', path: '/admin/coach-routes', icon: RouteIcon },
    { name: 'Coach Schedules', path: '/admin/coach-schedules', icon: CalendarClock },
    { name: 'Coach Bookings', path: '/admin/coach-bookings', icon: Ticket },
    { name: 'Ratings', path: '/admin/ratings', icon: Star },
    { name: 'Reports & Analytics', path: '/admin/reports', icon: BarChart3 },
    { name: 'Coach Payments', path: '/admin/coach-payments', icon: Wallet },
    { name: 'Audit Log', path: '/admin/audit-log', icon: ScrollText },
    { name: 'Settings', path: '/admin/settings', icon: Settings }
  ];

  return (
    <AppShell
      portal="Admin"
      navItems={navItems}
      isActive={(item, pathname) => pathname === item.path}
      user={user}
      profileName={user?.name}
      profileSub={user?.email || ''}
      onLogout={handleLogout}
    />
  );
}
