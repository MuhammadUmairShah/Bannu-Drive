import { useState } from 'react';
import { Lock } from 'lucide-react';
import Input from './Input';
import Button from './Button';
import api from '../utils/api';
import { getErrorMessage } from '../utils/errors';
import { toast } from '../utils/toast';

export default function ChangePasswordForm() {
  const [form, setForm] = useState({ currentPassword: '', newPassword: '', confirmPassword: '' });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');

    if (form.newPassword.length < 8) {
      setError('New password must be at least 8 characters.');
      return;
    }
    if (form.newPassword !== form.confirmPassword) {
      setError('New password and confirmation do not match.');
      return;
    }

    try {
      setSaving(true);
      const response = await api.patch('/user/password', {
        currentPassword: form.currentPassword,
        newPassword: form.newPassword
      });

      if (response.data.success) {
        toast.success('Password changed successfully.');
        setForm({ currentPassword: '', newPassword: '', confirmPassword: '' });
      } else {
        setError(response.data.message);
      }
    } catch (err) {
      setError(getErrorMessage(err));
    } finally {
      setSaving(false);
    }
  }

  const set = (key) => (e) => setForm({ ...form, [key]: e.target.value });

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <h3 className="text-sm font-bold text-fg">Change Password</h3>

      {error && (
        <div className="p-3 bg-danger-soft border border-danger/30 text-danger text-xs rounded-xl font-semibold">{error}</div>
      )}

      <Input label="Current Password" name="current-password" type="password" autoComplete="current-password"
        value={form.currentPassword} onChange={set('currentPassword')} icon={Lock} required />
      <Input label="New Password" name="new-password" type="password" autoComplete="new-password"
        value={form.newPassword} onChange={set('newPassword')} icon={Lock} required />
      <Input label="Confirm New Password" name="confirm-password" type="password" autoComplete="new-password"
        value={form.confirmPassword} onChange={set('confirmPassword')} icon={Lock} required />

      <Button type="submit" variant="secondary" disabled={saving}>
        {saving ? 'Updating...' : 'Update Password'}
      </Button>
    </form>
  );
}
