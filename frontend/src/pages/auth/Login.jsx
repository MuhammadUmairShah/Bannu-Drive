import { useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { Lock, Mail, ArrowRight } from 'lucide-react';
import AuthShell from '../../components/AuthShell';
import Input from '../../components/Input';
import Button from '../../components/Button';
import { validateEmail } from '../../utils/validators';
import api from '../../utils/api';
import { getErrorMessage } from '../../utils/errors';
import { useAuth } from '../../context/AuthContext';
import { toast } from '../../utils/toast';
import GoogleSignInButton, { googleEnabled } from '../../components/GoogleSignInButton';

export default function Login() {
  const [formData, setFormData] = useState({ email: '', password: '', role: 'customer', remember: true });
  const [errors, setErrors] = useState({});
  const [submitting, setSubmitting] = useState(false);
  const navigate = useNavigate();
  const { refreshUser } = useAuth();

  const goHome = (role) => navigate(role === 'admin' ? '/admin' : role === 'driver' ? '/driver' : role === 'operator' ? '/operator' : '/customer');

  const handleGoogle = async (data) => {
    await refreshUser();
    goHome(data.user.role);
  };

  const handleChange = (e) => {
    setFormData({ ...formData, [e.target.name]: e.target.value });
    if (errors[e.target.name]) {
      setErrors({ ...errors, [e.target.name]: null });
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();

    const newErrors = {};
    if (!validateEmail(formData.email)) newErrors.email = 'Enter a valid email address';
    if (!formData.password) newErrors.password = 'Password is required';

    if (Object.keys(newErrors).length > 0) {
      setErrors(newErrors);
      return;
    }

    setSubmitting(true);

    try {
      const response = await api.post('/user/login', formData);

      if (response.data.success) {
        await refreshUser();

        if (response.data.user.role === 'admin') {
          navigate('/admin');
        } else if (response.data.user.role === 'driver') {
          navigate('/driver');
        } else if (response.data.user.role === 'operator') {
          navigate('/operator');
        } else {
          navigate('/customer');
        }
      } else {
        toast.error(response.data.message);
      }
    } catch (error) {
      console.log(error);
      toast.error(getErrorMessage(error));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <AuthShell title="Sign in to your account" subtitle="Access your rides, deliveries, or dashboard">
      <form onSubmit={handleSubmit} className="space-y-5">
        <div>
          <label className="block text-xs font-semibold text-fg  mb-2">
            I am logging in as:
          </label>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            {['customer', 'driver', 'operator', 'admin'].map((role) => (
              <button
                key={role}
                type="button"
                onClick={() => setFormData({ ...formData, role })}
                className={`py-2 text-xs font-semibold rounded-xl capitalize border transition-all ${formData.role === role
                  ? 'bg-primary-soft border-primary text-link'
                  : 'border-line text-muted hover:bg-surface-2'
                  }`}
              >
                {role}
              </button>
            ))}
          </div>
        </div>

        <Input
          label="Email Address"
          type="email"
          name="email"
          value={formData.email}
          onChange={handleChange}
          placeholder="you@example.com"
          icon={Mail}
          error={errors.email}
          required
        />

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

        <div className="flex items-center justify-between text-xs">
          <div className="flex items-center">
            <input
              id="remember-me"
              name="remember-me"
              type="checkbox"
              checked={formData.remember}
              onChange={(e) => setFormData({ ...formData, remember: e.target.checked })}
              className="h-4 w-4 text-link focus:ring-primary border-field-line rounded"
            />
            <label htmlFor="remember-me" className="ml-2 text-muted">Keep me signed in</label>
          </div>
          <Link to="/forgot-password" className="font-medium text-link hover:text-link">
            Forgot password?
          </Link>
        </div>

        <Button
          type="submit"
          variant="primary"
          fullWidth
          icon={ArrowRight}
          disabled={submitting}
        >
          {submitting ? 'Signing in...' : 'Sign In'}
        </Button>
      </form>

      {googleEnabled && (
        <div className="mt-5">
          <div className="mb-4 flex items-center gap-3 text-[11px] uppercase tracking-wide text-subtle">
            <span className="h-px flex-1 bg-line" /> or <span className="h-px flex-1 bg-line" />
          </div>
          <GoogleSignInButton onSuccess={handleGoogle} remember={formData.remember} />
          <p className="mt-2 text-center text-[11px] text-subtle">
            Signed up with Google? Use the button above. Drivers and operators need their approved account.
          </p>
        </div>
      )}

      <div className="mt-6 pt-6 border-t border-line text-center">
        <p className="text-xs text-muted">
          Don't have an account?{' '}
          <Link to="/register" className="font-semibold text-link hover:text-link">
            Register now
          </Link>
        </p>
      </div>

    </AuthShell>
  );
}
