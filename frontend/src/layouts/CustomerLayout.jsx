import { useNavigate } from 'react-router-dom';
import {
  LayoutDashboard,
  Car,
  Package,
  ListOrdered,
  History,
  Truck,
  Bus,
  Ticket,
  Star,
  AlertCircle,
  User,
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import AppShell from '../components/AppShell';

export default function CustomerLayout() {
  const navigate = useNavigate();
  const { user, logout } = useAuth();

  const handleLogout = async () => {
    await logout();
    navigate('/login');
  };

  const navItems = [
    { name: 'Home', path: '/customer', icon: LayoutDashboard },
    { name: 'Ride', path: '/customer/request-ride', icon: Car },
    { name: 'Delivery', path: '/customer/request-delivery', icon: Package },
    { name: 'Intercity', path: '/customer/intercity', icon: Bus },
    { name: 'My Bookings', path: '/customer/bookings', icon: Ticket },
    { name: 'My Requests', path: '/customer/requests', icon: ListOrdered },
    { name: 'Ride History', path: '/customer/ride-history', icon: History },
    { name: 'Delivery History', path: '/customer/delivery-history', icon: Truck },
    { name: 'Ratings', path: '/customer/ratings', icon: Star },
    { name: 'Complaints', path: '/customer/complaints', icon: AlertCircle },
    { name: 'Profile', path: '/customer/profile', icon: User }
  ];

  return (
    <AppShell
      portal="Customer"
      navItems={navItems}
      isActive={(item, pathname) => (item.path === '/customer' ? pathname === '/customer' : pathname.startsWith(item.path))}
      user={user}
      profileName={user?.name}
      profileSub={user?.email || ''}
      onLogout={handleLogout}
    />
  );
}
