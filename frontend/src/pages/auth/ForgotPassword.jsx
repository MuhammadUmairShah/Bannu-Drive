import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Mail, CheckCircle2 } from 'lucide-react';
import AuthShell from '../../components/AuthShell';
import Input from '../../components/Input';
import Button from '../../components/Button';
import { validateEmail } from '../../utils/validators';
import api from '../../utils/api';
import { getErrorMessage } from '../../utils/errors';

export default function ForgotPassword() {
  const [email, setEmail] = useState('');
  const [error, setError] = useState('');
  const [submitted, setSubmitted] = useState(false);

  const [sending, setSending] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!validateEmail(email)) {
      setError('Please enter a valid registered email');
      return;
    }
    setError('');

    try {
      setSending(true);
      const response = await api.post('/user/forgot-password', { email: email.trim() });
      if (response.data.success) setSubmitted(true);
      else setError(response.data.message);
    } catch (err) {
      setError(getErrorMessage(err));
    } finally {
      setSending(false);
    }
  };

  return (
    <AuthShell title="Reset your password" subtitle="We'll email you a link to choose a new one">
      {submitted ? (
        <div className="text-center py-4">
          <CheckCircle2 className="w-12 h-12 text-link mx-auto mb-3" />
          <h3 className="text-base font-bold text-fg">Instructions Sent!</h3>
          <p className="mt-2 text-xs text-muted">
            If an account exists for <span className="font-semibold text-fg">{email}</span>, password reset link has been dispatched.
          </p>
          <div className="mt-6">
            <Link to="/login">
              <Button variant="outline" fullWidth>Back to Login</Button>
            </Link>
          </div>
        </div>
      ) : (
        <form onSubmit={handleSubmit} className="space-y-4">
          <p className="text-xs text-muted mb-2">
            Enter your account's email address and we will send password reset instructions.
          </p>
          <Input
            label="Email Address"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@example.com"
            icon={Mail}
            error={error}
            required
          />
          <Button type="submit" variant="primary" fullWidth disabled={sending}>
            {sending ? 'Sending...' : 'Send Reset Link'}
          </Button>
        </form>
      )}

    </AuthShell>
  );
}
