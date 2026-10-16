import {
  BrowserRouter as Router,
  Routes,
  Route,
  Navigate,
  useLocation,
} from 'react-router-dom';
import { useEffect } from 'react';

import { AuthProvider } from './context/AuthContext';
import { ThemeProvider } from './context/ThemeContext';
import ProtectedRoute from './components/ProtectedRoute';

// Layouts
import CustomerLayout from './layouts/CustomerLayout';
import DriverLayout from './layouts/DriverLayout';
import AdminLayout from './layouts/AdminLayout';
import OperatorLayout from './layouts/OperatorLayout';

// Public Pages
import LandingPage from './pages/public/LandingPage';
import AboutPage from './pages/public/AboutPage';
import ServicesPage from './pages/public/ServicesPage';
import ContactPage from './pages/public/ContactPage';
import CoachesPage from './pages/public/CoachesPage';

// Auth Pages
import Login from './pages/auth/Login';
import Register from './pages/auth/Register';
import ForgotPassword from './pages/auth/ForgotPassword';
import ResetPassword from './pages/auth/ResetPassword';

// Customer Pages
import CustomerDashboard from './pages/customer/CustomerDashboard';
import RequestRide from './pages/customer/RequestRide';
import RequestDelivery from './pages/customer/RequestDelivery';
import MyRequests from './pages/customer/MyRequests';
import RequestDetails from './pages/customer/RequestDetails';
import CustomerRideHistory from './pages/customer/RideHistory';
import CustomerDeliveryHistory from './pages/customer/DeliveryHistory';
import Ratings from './pages/customer/Ratings';
import CustomerComplaints from './pages/customer/Complaints';
import CustomerProfile from './pages/customer/Profile';

// Customer Coach Pages
import Intercity from './pages/customer/Intercity';
import CoachSeats from './pages/customer/CoachSeats';
import CoachCheckout from './pages/customer/CoachCheckout';
import MockPay from './pages/customer/MockPay';
import CoachBookings from './pages/customer/CoachBookings';
import TrackCoach from './pages/customer/TrackCoach';

// Driver Pages
import DriverDashboard from './pages/driver/DriverDashboard';
import AvailableRequests from './pages/driver/AvailableRequests';
import AcceptedRequest from './pages/driver/AcceptedRequest';
import DriverRideHistory from './pages/driver/RideHistory';
import DriverDeliveryHistory from './pages/driver/DeliveryHistory';
import Earnings from './pages/driver/Earnings';
import DriverProfile from './pages/driver/Profile';
import ManageTrip from './pages/driver/ManageTrip';

// Admin Pages
import AdminDashboard from './pages/admin/AdminDashboard';
import Customers from './pages/admin/Customers';
import Drivers from './pages/admin/Drivers';
import RideRequests from './pages/admin/RideRequests';
import DeliveryRequests from './pages/admin/DeliveryRequests';
import Complaints from './pages/admin/Complaints';
import Reports from './pages/admin/Reports';
import Settings from './pages/admin/Settings';
import AdminRatings from './pages/admin/Ratings';

import {
  AdminOperators,
  AdminCoaches,
  AdminRoutes,
  AdminSchedules,
  AdminCoachBookings,
} from './pages/admin/CoachAdmin';

import AdminVerification from './pages/admin/Verification';
import AuditLog from './pages/admin/AuditLog';
import CoachPayments from './pages/admin/CoachPayments';

// Operator Pages
import OperatorDashboard from './pages/operator/OperatorDashboard';
import OperatorCoaches from './pages/operator/OperatorCoaches';
import OperatorRoutes from './pages/operator/OperatorRoutes';
import OperatorSchedules from './pages/operator/OperatorSchedules';
import OperatorBookings from './pages/operator/OperatorBookings';
import OperatorPassengers from './pages/operator/OperatorPassengers';
import OperatorReports from './pages/operator/OperatorReports';
import OperatorProfile from './pages/operator/OperatorProfile';
import OperatorSeatMap from './pages/operator/OperatorSeatMap';
import OperatorScan from './pages/operator/OperatorScan';
import OperatorPayments from './pages/operator/OperatorPayments';
import OperatorTripTracking from './pages/operator/OperatorTripTracking';

// Global
import ToastHost from './components/ToastHost';
import AIChatbot from './components/AIChatbot';
import { RealtimeProvider } from './context/RealtimeContext';

function ScrollToTop() {
  const { pathname } = useLocation();

  useEffect(() => {
    window.scrollTo({
      top: 0,
      left: 0,
      behavior: 'instant',
    });
  }, [pathname]);

  return null;
}

export default function App() {
  return (
    <ThemeProvider>
      <Router>
        <AuthProvider>
          <RealtimeProvider>

            <ScrollToTop />

            <ToastHost />

            {/* =========================================
                GLOBAL AI CHATBOT
                Available on the entire website
            ========================================== */}
            <AIChatbot />

            <Routes>

              {/* ===================== PUBLIC ROUTES ===================== */}

              <Route
                path="/"
                element={<LandingPage />}
              />

              <Route
                path="/about"
                element={<AboutPage />}
              />

              <Route
                path="/services"
                element={<ServicesPage />}
              />

              <Route
                path="/coaches"
                element={<CoachesPage />}
              />

              <Route
                path="/contact"
                element={<ContactPage />}
              />

              {/* ===================== AUTH ROUTES ===================== */}

              <Route
                path="/login"
                element={<Login />}
              />

              <Route
                path="/register"
                element={<Register />}
              />

              <Route
                path="/forgot-password"
                element={<ForgotPassword />}
              />

              <Route
                path="/reset-password"
                element={<ResetPassword />}
              />

              {/* ===================== CUSTOMER ROUTES ===================== */}

              <Route
                path="/customer"
                element={
                  <ProtectedRoute allowedRoles={['customer']}>
                    <CustomerLayout />
                  </ProtectedRoute>
                }
              >
                <Route
                  index
                  element={<CustomerDashboard />}
                />

                <Route
                  path="request-ride"
                  element={<RequestRide />}
                />

                <Route
                  path="request-delivery"
                  element={<RequestDelivery />}
                />

                <Route
                  path="intercity"
                  element={<Intercity />}
                />

                <Route
                  path="intercity/:scheduleId"
                  element={<CoachSeats />}
                />

                <Route
                  path="checkout/:orderId"
                  element={<CoachCheckout />}
                />

                <Route
                  path="pay/mock/:ref"
                  element={<MockPay />}
                />

                <Route
                  path="bookings"
                  element={<CoachBookings />}
                />

                <Route
                  path="bookings/:id"
                  element={<CoachBookings />}
                />

                <Route
                  path="track/:bookingId"
                  element={<TrackCoach />}
                />

                <Route
                  path="requests"
                  element={<MyRequests />}
                />

                <Route
                  path="requests/:id"
                  element={<RequestDetails />}
                />

                <Route
                  path="ride-history"
                  element={<CustomerRideHistory />}
                />

                <Route
                  path="delivery-history"
                  element={<CustomerDeliveryHistory />}
                />

                <Route
                  path="ratings"
                  element={<Ratings />}
                />

                <Route
                  path="complaints"
                  element={<CustomerComplaints />}
                />

                <Route
                  path="profile"
                  element={<CustomerProfile />}
                />
              </Route>

              {/* ===================== DRIVER ROUTES ===================== */}

              <Route
                path="/driver"
                element={
                  <ProtectedRoute allowedRoles={['driver']}>
                    <DriverLayout />
                  </ProtectedRoute>
                }
              >
                <Route
                  index
                  element={<DriverDashboard />}
                />

                <Route
                  path="requests"
                  element={<AvailableRequests />}
                />

                <Route
                  path="requests/active"
                  element={<ManageTrip />}
                />

                <Route
                  path="requests/:id"
                  element={<AcceptedRequest />}
                />

                <Route
                  path="ride-history"
                  element={<DriverRideHistory />}
                />

                <Route
                  path="delivery-history"
                  element={<DriverDeliveryHistory />}
                />

                <Route
                  path="earnings"
                  element={<Earnings />}
                />

                <Route
                  path="profile"
                  element={<DriverProfile />}
                />
              </Route>

              {/* ===================== OPERATOR ROUTES ===================== */}

              <Route
                path="/operator"
                element={
                  <ProtectedRoute allowedRoles={['operator']}>
                    <OperatorLayout />
                  </ProtectedRoute>
                }
              >
                <Route
                  index
                  element={<OperatorDashboard />}
                />

                <Route
                  path="coaches"
                  element={<OperatorCoaches />}
                />

                <Route
                  path="routes"
                  element={<OperatorRoutes />}
                />

                <Route
                  path="schedules"
                  element={<OperatorSchedules />}
                />

                <Route
                  path="schedules/:id/seatmap"
                  element={<OperatorSeatMap />}
                />

                <Route
                  path="schedules/:id/tracking"
                  element={<OperatorTripTracking />}
                />

                <Route
                  path="scan"
                  element={<OperatorScan />}
                />

                <Route
                  path="bookings"
                  element={<OperatorBookings />}
                />

                <Route
                  path="payments"
                  element={<OperatorPayments />}
                />

                <Route
                  path="passengers"
                  element={<OperatorPassengers />}
                />

                <Route
                  path="reports"
                  element={<OperatorReports />}
                />

                <Route
                  path="profile"
                  element={<OperatorProfile />}
                />
              </Route>

              {/* ===================== ADMIN ROUTES ===================== */}

              <Route
                path="/admin"
                element={
                  <ProtectedRoute allowedRoles={['admin']}>
                    <AdminLayout />
                  </ProtectedRoute>
                }
              >
                <Route
                  index
                  element={<AdminDashboard />}
                />

                <Route
                  path="customers"
                  element={<Customers />}
                />

                <Route
                  path="drivers"
                  element={<Drivers />}
                />

                <Route
                  path="rides"
                  element={<RideRequests />}
                />

                <Route
                  path="deliveries"
                  element={<DeliveryRequests />}
                />

                <Route
                  path="complaints"
                  element={<Complaints />}
                />

                <Route
                  path="ratings"
                  element={<AdminRatings />}
                />

                <Route
                  path="reports"
                  element={<Reports />}
                />

                <Route
                  path="settings"
                  element={<Settings />}
                />

                <Route
                  path="verification"
                  element={<AdminVerification />}
                />

                <Route
                  path="audit-log"
                  element={<AuditLog />}
                />

                <Route
                  path="coach-payments"
                  element={<CoachPayments />}
                />

                <Route
                  path="operators"
                  element={<AdminOperators />}
                />

                <Route
                  path="coaches"
                  element={<AdminCoaches />}
                />

                <Route
                  path="coach-routes"
                  element={<AdminRoutes />}
                />

                <Route
                  path="coach-schedules"
                  element={<AdminSchedules />}
                />

                <Route
                  path="coach-bookings"
                  element={<AdminCoachBookings />}
                />
              </Route>

              {/* ===================== FALLBACK ===================== */}

              <Route
                path="*"
                element={<Navigate to="/" replace />}
              />

            </Routes>

          </RealtimeProvider>
        </AuthProvider>
      </Router>
    </ThemeProvider>
  );
}