import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { User, Mail, Phone, Lock, Truck, ShieldCheck, Bus } from 'lucide-react';
import AuthShell from '../../components/AuthShell';
import Input from '../../components/Input';
import Button from '../../components/Button';
import { validateEmail, validatePhone } from '../../utils/validators';
import api from '../../utils/api';
import { getErrorMessage } from '../../utils/errors';
import { useAuth } from '../../context/AuthContext';
import { toast } from '../../utils/toast';
import GoogleSignInButton, { googleEnabled } from '../../components/GoogleSignInButton';

export default function Register() {
  const [role, setRole] = useState('customer');
  const [formData, setFormData] = useState({
    name: '',
    companyName: '',
    email: '',
    phone: '',
    password: '',
    confirmPassword: '',
    vehicleType: 'bike',
    vehicleModel: '',
    vehicleNumber: '',
    licenseNumber: ''
  });

  const [errors, setErrors] = useState({});
  const [submitting, setSubmitting] = useState(false);
  const navigate = useNavigate();
  const { refreshUser } = useAuth();

  const handleChange = (e) => {
    setFormData({ ...formData, [e.target.name]: e.target.value });
    if (errors[e.target.name]) setErrors({ ...errors, [e.target.name]: null });
  };

  async function registration(e) {
    e.preventDefault();

    const newErrors = {};

    if (!formData.name) newErrors.name = 'Full name is required';
    if (!validateEmail(formData.email)) newErrors.email = 'Valid email is required';
    if (!validatePhone(formData.phone)) newErrors.phone = 'Valid Pakistani phone required (e.g. 03001234567)';
    if (!formData.password || formData.password.length < 8) newErrors.password = 'Password must be at least 8 characters';
    if (formData.password !== formData.confirmPassword) newErrors.confirmPassword = 'Passwords do not match';

    if (role === 'operator' && (formData.companyName || '').trim().length < 2) newErrors.companyName = 'Company name is required';

    if (role === 'driver') {
      if (!formData.vehicleNumber) newErrors.vehicleNumber = 'Vehicle registration number required';
      if (!formData.licenseNumber) newErrors.licenseNumber = 'Driving license number required';
    }

    if (Object.keys(newErrors).length > 0) {
      setErrors(newErrors);
      return;
    }

    setSubmitting(true);

    try {
      const response = await api.post('/user/registration', {
        name: formData.name,
        email: formData.email,
        phone: formData.phone,
        password: formData.password,
        role: role,
        companyName: role === 'operator' ? formData.companyName : undefined,
        vehicleType: role === 'driver' ? formData.vehicleType : undefined,
        vehicleModel: role === 'driver' ? formData.vehicleModel : undefined,
        vehicleNumber: role === 'driver' ? formData.vehicleNumber : undefined,
        licenseNumber: role === 'driver' ? formData.licenseNumber : undefined
      });

      if (response.data.success) {
        await refreshUser();

        if (role === 'driver') {
          navigate('/driver');
        } else if (role === 'operator') {
          navigate('/operator');
        } else {
          navigate('/customer');
        }
      } else {
        toast.error(response.data.message);
      }

    } catch (error) {
      console.log('Registration Error:', error);
      toast.error(getErrorMessage(error, 'Something went wrong while registering'));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <AuthShell title="Create your account" subtitle="Join Bannu's local ride & delivery network" maxWidth="max-w-xl">
      {/* Account Role Selector */}
      <div className="mb-6">
        <label className="block text-xs font-semibold text-fg  mb-2">
          Select Account Type
        </label>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <button
            type="button"
            onClick={() => setRole('customer')}
            className={`p-3 rounded-xl border text-left flex items-center space-x-3 transition-all ${role === 'customer'
                ? 'border-primary bg-primary-soft text-link ring-1 ring-primary'
                : 'border-line hover:bg-surface-2 text-muted'
              }`}
          >
            <User className="w-5 h-5 text-link" />
            <div>
              <p className="text-xs font-bold">Customer</p>
              <p className="text-xs text-muted">Book rides & send parcels</p>
            </div>
          </button>

          <button
            type="button"
            onClick={() => setRole('driver')}
            className={`p-3 rounded-xl border text-left flex items-center space-x-3 transition-all ${role === 'driver'
                ? 'border-primary bg-primary-soft text-link ring-1 ring-primary'
                : 'border-line hover:bg-surface-2 text-muted'
              }`}
          >
            <Truck className="w-5 h-5 text-link" />
            <div>
              <p className="text-xs font-bold">Rider / Driver</p>
              <p className="text-xs text-muted">Earn money on your vehicle</p>
            </div>
          </button>

          <button
            type="button"
            onClick={() => setRole('operator')}
            className={`p-3 rounded-xl border text-left flex items-center space-x-3 transition-all ${role === 'operator'
                ? 'border-primary bg-primary-soft text-link ring-1 ring-primary'
                : 'border-line hover:bg-surface-2 text-muted'
              }`}
          >
            <Bus className="w-5 h-5 text-link" />
            <div>
              <p className="text-xs font-bold">Coach Operator</p>
              <p className="text-xs text-muted">Sell intercity seats</p>
            </div>
          </button>
        </div>
      </div>

      {googleEnabled && role === 'customer' && (
        <div className="mb-6">
          <GoogleSignInButton
            text="signup_with"
            onSuccess={async (data) => {
              await refreshUser();
              navigate(data.user.role === 'admin' ? '/admin' : data.user.role === 'driver' ? '/driver' : data.user.role === 'operator' ? '/operator' : '/customer');
            }}
          />
          <div className="mt-4 flex items-center gap-3 text-[11px] uppercase tracking-wide text-subtle">
            <span className="h-px flex-1 bg-line" /> or register with email <span className="h-px flex-1 bg-line" />
          </div>
        </div>
      )}
      {googleEnabled && role !== 'customer' && (
        <p className="mb-4 rounded-xl border border-line bg-surface-2 px-3 py-2 text-xs text-muted">
          Driver and operator accounts are created with email and password, then verified with your documents. Google sign-in is for customers.
        </p>
      )}

      <div className="space-y-4">
        <Input
          label="Full Name"
          name="name"
          value={formData.name}
          onChange={handleChange}
          placeholder="Your full name"
          icon={User}
          error={errors.name}
          required
        />

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <Input
            label="Email Address"
            type="email"
            name="email"
            value={formData.email}
            onChange={handleChange}
            placeholder="name@domain.com"
            icon={Mail}
            error={errors.email}
            required
          />
          <Input
            label="Phone Number"
            name="phone"
            type="tel"
            inputMode="tel"
            autoComplete="tel"
            value={formData.phone}
            onChange={handleChange}
            placeholder="03001234567"
            icon={Phone}
            error={errors.phone}
            required
          />
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <Input
            label="Password"
            type="password"
            name="password"
            value={formData.password}
            onChange={handleChange}
            placeholder="••••••••"
            icon={Lock}
            error={errors.password}
            required
          />
          <Input
            label="Confirm Password"
            type="password"
            name="confirmPassword"
            value={formData.confirmPassword}
            onChange={handleChange}
            placeholder="••••••••"
            icon={Lock}
            error={errors.confirmPassword}
            required
          />
        </div>

        {role === 'operator' && (
          <div className="p-4 bg-surface-2 border border-line rounded-xl space-y-3 mt-4">
            <Input
              label="Company Name"
              name="companyName"
              value={formData.companyName || ''}
              onChange={handleChange}
              placeholder="e.g. Your Coaches"
              error={errors.companyName}
              required
            />
            <p className="text-xs text-muted">New operator accounts are reviewed by an admin before they can add coaches and sell seats.</p>
          </div>
        )}

        {/* Additional Fields for Drivers */}
        {role === 'driver' && (
          <div className="p-4 bg-surface-2 border border-line rounded-xl space-y-4 mt-4">
            <p className="text-xs font-bold text-fg flex items-center space-x-1">
              <ShieldCheck className="w-4 h-4 text-link" />
              <span>Driver Verification Details</span>
            </p>

            <div>
              <label className="block text-xs font-semibold text-fg  mb-1">
                Vehicle Type
              </label>
              <select
                name="vehicleType"
                value={formData.vehicleType}
                onChange={handleChange}
                className="w-full text-sm border-field-line rounded-xl focus:ring-primary focus:border-primary py-2 px-3 border bg-field text-fg"
              >
                <option value="bike">Motorbike</option>
                <option value="rickshaw">Auto Rickshaw</option>
                <option value="car">Car / Cab</option>
              </select>
            </div>

            <Input
              label="Vehicle Model (optional)"
              name="vehicleModel"
              value={formData.vehicleModel}
              onChange={handleChange}
              placeholder="Honda CD 70"
            />

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <Input
                label="Vehicle Number"
                name="vehicleNumber"
                value={formData.vehicleNumber}
                onChange={handleChange}
                placeholder="BNU-1234"
                error={errors.vehicleNumber}
                required
              />
              <Input
                label="License Number"
                name="licenseNumber"
                value={formData.licenseNumber}
                onChange={handleChange}
                placeholder="DL-98765"
                error={errors.licenseNumber}
                required
              />
            </div>
          </div>
        )}

        <Button onClick={registration} type="submit" variant="primary" fullWidth className="mt-2" disabled={submitting}>
          {submitting ? 'Creating account...' : `Register as ${role === 'driver' ? 'Driver' : role === 'operator' ? 'Coach Operator' : 'Customer'}`}
        </Button>
      </div>

      <p className="mt-4 text-center text-xs text-muted">
        Already have an account?{' '}
        <Link to="/login" className="font-semibold text-link hover:text-link">
          Sign In
        </Link>
      </p>

    </AuthShell>
  );
}
