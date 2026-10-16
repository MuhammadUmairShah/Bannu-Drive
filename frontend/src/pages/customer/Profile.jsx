import { useEffect, useState } from 'react';
import Input from '../../components/Input';
import Button from '../../components/Button';
import { User, Mail, Phone, ShieldCheck } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import api from '../../utils/api';
import { getErrorMessage } from '../../utils/errors';
import { toast } from '../../utils/toast';
import ProfilePicture from '../../components/ProfilePicture';
import ChangePasswordForm from '../../components/ChangePasswordForm';

export default function CustomerProfile() {
  const { user, setUser } = useAuth();
  const [formData, setFormData] = useState({ name: '', email: '', phone: '' });
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    if (user) {
      setFormData({ name: user.name || '', email: user.email || '', phone: user.phone || '' });
    }
  }, [user]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setSaving(true);

    try {
      const response = await api.patch('/user/profile', {
        name: formData.name,
        phone: formData.phone
      });

      if (response.data.success) {
        setUser(response.data.user);
        setSaved(true);
        setTimeout(() => setSaved(false), 3000);
      } else {
        toast.error(response.data.message);
      }
    } catch (error) {
      console.log(error);
      toast.error(getErrorMessage(error));
    } finally {
      setSaving(false);
    }
  };

  if (!user) {
    return (
      <div className="max-w-2xl mx-auto py-16 text-center text-sm text-muted">
        Loading profile...
      </div>
    );
  }

  return (
    <div className="max-w-2xl mx-auto space-y-6">
      <div>
        <h1 className="text-xl font-bold text-fg">Customer Profile</h1>
        <p className="text-xs text-muted">Manage your personal details and contact options</p>
      </div>

      <div className="card p-6 space-y-6">
        <div className="pb-4 border-b border-line space-y-3">
          <ProfilePicture />
          <span className="inline-flex items-center space-x-1 text-xs text-link font-semibold">
            <ShieldCheck className="w-3.5 h-3.5" />
            <span>{user.isBlocked ? 'Account Blocked' : 'Active Customer Account'}</span>
          </span>
        </div>

        {saved && (
          <div className="p-3 bg-primary-soft border border-primary/30 text-link text-xs rounded-xl font-semibold">
            Profile changes saved successfully!
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="grid grid-cols-2 gap-3 text-xs">
            <div className="p-3 rounded-xl border border-line bg-surface-2">
              <p className="text-muted  font-semibold text-xs">Role</p>
              <p className="font-bold text-fg capitalize">{user.role}</p>
            </div>
            <div className="p-3 rounded-xl border border-line bg-surface-2">
              <p className="text-muted  font-semibold text-xs">Account Status</p>
              <p className={`font-bold ${user.isBlocked ? 'text-danger' : 'text-link'}`}>
                {user.isBlocked ? 'Blocked' : 'Active'}
              </p>
            </div>
          </div>
          <Input
            label="Full Name"
            name="customer-full-name"
            autoComplete="name"
            value={formData.name}
            onChange={(e) => setFormData({ ...formData, name: e.target.value })}
            icon={User}
            required
          />
          <Input
            label="Email Address"
            name="customer-email"
            type="email"
            autoComplete="off"
            value={formData.email}
            icon={Mail}
            disabled
          />
          {user?.needsPhone && (
            <p className="rounded-xl border border-warning/40 bg-warning-soft px-3 py-2 text-xs text-warning">
              Add your phone number so drivers and coach operators can reach you.
            </p>
          )}
          <Input
            label="Phone Number"
            name="customer-phone"
            type="tel"
            inputMode="tel"
            autoComplete="off"
            placeholder="03001234567"
            value={formData.phone}
            onChange={(e) => setFormData({ ...formData, phone: e.target.value })}
            icon={Phone}
            required
          />

          <Button type="submit" variant="primary" disabled={saving}>
            {saving ? 'Saving...' : 'Save Profile Updates'}
          </Button>
        </form>
      </div>

      <div className="card p-6">
        <ChangePasswordForm />
      </div>
    </div>
  );
}
