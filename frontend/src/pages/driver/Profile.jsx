import { useEffect, useState } from 'react';
import Input from '../../components/Input';
import Button from '../../components/Button';
import { Car, Star, ShieldCheck, ShieldAlert } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import api from '../../utils/api';
import { getErrorMessage } from '../../utils/errors';
import { toast } from '../../utils/toast';
import { formatCurrency } from '../../utils/formatters';
import ProfilePicture from '../../components/ProfilePicture';
import ChangePasswordForm from '../../components/ChangePasswordForm';
import VerificationPanel from '../../components/verification/VerificationPanel';

export default function DriverProfile() {
  const { user, setUser } = useAuth();
  const [formData, setFormData] = useState({
    name: '',
    email: '',
    phone: '',
    vehicleType: 'bike',
    vehicleModel: '',
    vehicleNumber: '',
    licenseNumber: ''
  });
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [earnings, setEarnings] = useState({ totalFare: 0, totalCommission: 0, totalEarning: 0 });
  const [ratingsSummary, setRatingsSummary] = useState({ average: 0, count: 0, ratings: [] });

  useEffect(() => {
    async function loadRatings() {
      try {
        const response = await api.get('/rating/received');
        if (response.data.success) {
          setRatingsSummary({
            average: response.data.average,
            count: response.data.count,
            ratings: response.data.ratings.slice(0, 5)
          });
        }
      } catch (error) {
        console.log(error);
      }
    }
    async function loadEarnings() {
      try {
        const response = await api.get('/payment/my-transactions');
        if (response.data.success) {
          setEarnings({
            totalFare: response.data.totalFare || 0,
            totalCommission: response.data.totalCommission || 0,
            totalEarning: response.data.totalEarning || 0
          });
        }
      } catch (error) {
        console.log(error);
      }
    }
    loadRatings();
    loadEarnings();
  }, []);

  useEffect(() => {
    if (user) {
      setFormData({
        name: user.name || '',
        email: user.email || '',
        phone: user.phone || '',
        vehicleType: (user.vehicleType || 'bike').toLowerCase(),
        vehicleModel: user.vehicleModel || '',
        vehicleNumber: user.vehicleNumber || '',
        licenseNumber: user.licenseNumber || ''
      });
    }
  }, [user]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setSaving(true);

    try {
      const response = await api.patch('/user/profile', {
        name: formData.name,
        phone: formData.phone,
        vehicleType: formData.vehicleType,
        vehicleModel: formData.vehicleModel,
        vehicleNumber: formData.vehicleNumber,
        licenseNumber: formData.licenseNumber
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
        <h1 className="text-xl font-bold text-fg">Driver Profile & Credentials</h1>
        <p className="text-xs text-muted">Manage vehicle details and verified rider information</p>
      </div>

      <div className="card p-6 space-y-6">
        <ProfilePicture />

        {saved && (
          <div className="p-3 bg-primary-soft border border-primary/30 text-link text-xs rounded-xl font-semibold">
            Driver info updated!
          </div>
        )}

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-xs">
          <div className="p-3 rounded-xl border border-line bg-surface-2">
            <p className="text-muted  font-semibold text-xs">Role</p>
            <p className="font-bold text-fg capitalize">{user.role}</p>
          </div>
          <div className="p-3 rounded-xl border border-line bg-surface-2">
            <p className="text-muted  font-semibold text-xs">Verification</p>
            <p className={`font-bold flex items-center gap-1 ${user.isVerified ? 'text-link' : 'text-warning'}`}>
              {user.isVerified ? <ShieldCheck className="w-3.5 h-3.5" /> : <ShieldAlert className="w-3.5 h-3.5" />}
              {user.isVerified ? 'Verified by Admin' : 'Pending Admin Verification'}
            </p>
          </div>
          <div className="p-3 rounded-xl border border-line bg-surface-2">
            <p className="text-muted  font-semibold text-xs">Availability</p>
            <p className={`font-bold capitalize ${user.driverStatus === 'online' ? 'text-link' : 'text-fg'}`}>
              {user.driverStatus || 'offline'}
            </p>
          </div>
        </div>

        {user.isBlocked && (
          <div className="p-3 bg-danger-soft border border-danger/30 text-danger text-xs rounded-xl font-semibold">
            Your account is blocked. Please contact support.
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4" autoComplete="off">
          <Input label="Full Name" name="driver-full-name" autoComplete="name" value={formData.name} onChange={(e) => setFormData({ ...formData, name: e.target.value })} required />
          <Input label="Email" name="driver-email" type="email" autoComplete="off" value={formData.email} disabled />
          <Input label="Phone Number" name="driver-phone" type="tel" inputMode="tel" autoComplete="off" placeholder="03001234567" value={formData.phone} onChange={(e) => setFormData({ ...formData, phone: e.target.value })} required />

          <div className="p-4 bg-surface-2 rounded-xl border border-line space-y-3">
            <p className="text-xs font-bold text-fg flex items-center space-x-1">
              <Car className="w-4 h-4 text-link" />
              <span>Vehicle Details</span>
            </p>

            <div>
              <label className="block text-xs font-semibold text-fg  mb-1">Vehicle Type</label>
              <select
                value={formData.vehicleType}
                onChange={(e) => setFormData({ ...formData, vehicleType: e.target.value })}
                className="w-full text-sm border-field-line rounded-xl focus:ring-primary focus:border-primary py-2 px-3 border bg-field text-fg"
              >
                <option value="bike">Motorbike</option>
                <option value="rickshaw">Auto Rickshaw</option>
                <option value="car">Car / Cab</option>
              </select>
            </div>

            <Input label="Vehicle Model (optional)" name="driver-vehicle-model" autoComplete="off" placeholder="e.g. Honda CD 70" value={formData.vehicleModel} onChange={(e) => setFormData({ ...formData, vehicleModel: e.target.value })} />

            <div className="grid grid-cols-2 gap-3">
              <Input label="Vehicle Plate Number" name="driver-vehicle-number" autoComplete="off" value={formData.vehicleNumber} onChange={(e) => setFormData({ ...formData, vehicleNumber: e.target.value })} required />
              <Input label="License Number" name="driver-license-number" autoComplete="off" value={formData.licenseNumber} onChange={(e) => setFormData({ ...formData, licenseNumber: e.target.value })} required />
            </div>
          </div>

          <Button type="submit" variant="primary" disabled={saving}>
            {saving ? 'Saving...' : 'Update Driver Account'}
          </Button>
        </form>
      </div>

      <div className="card p-6 space-y-3">
        <h3 className="text-sm font-bold text-fg">Earnings Summary</h3>
        <div className="grid grid-cols-3 gap-2 sm:gap-3 text-xs break-words">
          <div className="p-3 rounded-xl border border-line bg-surface-2">
            <p className="text-muted  font-semibold text-xs">Total Fare</p>
            <p className="font-bold text-fg">{formatCurrency(earnings.totalFare)}</p>
          </div>
          <div className="p-3 rounded-xl border border-line bg-surface-2">
            <p className="text-muted  font-semibold text-xs">Commission</p>
            <p className="font-bold text-fg">{formatCurrency(earnings.totalCommission)}</p>
          </div>
          <div className="p-3 rounded-xl border border-primary/30 bg-primary-soft">
            <p className="text-link  font-semibold text-xs">Net Earnings</p>
            <p className="font-bold text-link">{formatCurrency(earnings.totalEarning)}</p>
          </div>
        </div>
      </div>

      <VerificationPanel />

      <div className="card p-6">
        <ChangePasswordForm />
      </div>

      <div className="card p-6 space-y-4">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-bold text-fg flex items-center gap-2">
            <Star className="w-4 h-4 text-warning fill-warning" />
            Received Ratings
          </h3>
          <span className="text-xs font-semibold text-muted">
            {ratingsSummary.average > 0 ? `${ratingsSummary.average} / 5` : 'No ratings yet'} ({ratingsSummary.count})
          </span>
        </div>

        {ratingsSummary.ratings.length === 0 ? (
          <p className="text-xs text-subtle">No customer feedback yet.</p>
        ) : (
          <div className="space-y-3">
            {ratingsSummary.ratings.map((r) => (
              <div key={r._id} className="p-3 bg-surface-2 rounded-xl border border-line text-xs space-y-1">
                <div className="flex items-center justify-between">
                  <span className="font-semibold text-fg">{r.customer?.name || 'Customer'}</span>
                  <span className="flex items-center gap-0.5 text-warning font-bold">
                    {r.rating} <Star className="w-3 h-3 fill-warning" />
                  </span>
                </div>
                {r.review && <p className="text-muted">{r.review}</p>}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
