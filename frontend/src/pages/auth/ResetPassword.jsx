import { useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Lock, CheckCircle2 } from 'lucide-react';
import AuthShell from '../../components/AuthShell';
import Input from '../../components/Input';
import Button from '../../components/Button';
import api from '../../utils/api';
import { getErrorMessage } from '../../utils/errors';

export default function ResetPassword() {
  const [params] = useSearchParams();
  const token = params.get('token') || '';

  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [done, setDone] = useState(false);

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');

    if (password.length < 8) return setError('Password must be at least 8 characters.');
    if (password !== confirm) return setError('Passwords do not match.');

    try {
      setSaving(true);
      const response = await api.post('/user/reset-password', { token, password });
      if (response.data.success) setDone(true);
      else setError(response.data.message);
    } catch (err) {
      setError(getErrorMessage(err));
    } finally {
      setSaving(false);
    }
  }

  return (
    <AuthShell title="Choose a new password" subtitle="Pick something you have not used before">
      {!token ? (
        <div className="text-center space-y-4">
          <p className="text-sm text-danger">This reset link is incomplete. Please request a new one.</p>
          <Link to="/forgot-password"><Button variant="outline" fullWidth>Request new link</Button></Link>
        </div>
      ) : done ? (
        <div className="text-center space-y-4">
          <CheckCircle2 className="w-10 h-10 text-link mx-auto" />
          <p className="text-sm text-fg">Your password has been updated.</p>
          <Link to="/login"><Button variant="primary" fullWidth>Go to Login</Button></Link>
        </div>
      ) : (
        <form onSubmit={handleSubmit} className="space-y-4">
          {error && <div className="p-3 bg-danger-soft border border-danger/30 text-danger text-xs rounded-xl font-semibold">{error}</div>}
          <Input label="New Password" type="password" autoComplete="new-password" value={password}
            onChange={(e) => setPassword(e.target.value)} icon={Lock} required />
          <Input label="Confirm Password" type="password" autoComplete="new-password" value={confirm}
            onChange={(e) => setConfirm(e.target.value)} icon={Lock} required />
          <Button type="submit" variant="primary" fullWidth disabled={saving}>
            {saving ? 'Saving...' : 'Update Password'}
          </Button>
          <p className="text-center text-xs text-muted">
            Link expired? <Link to="/forgot-password" className="text-link font-semibold">Request a new one</Link>
          </p>
        </form>
      )}

    </AuthShell>
  );
}
