import { useEffect, useState, useCallback } from 'react';
import Input from '../../components/Input';
import Button from '../../components/Button';
import api from '../../utils/api';
import { getErrorMessage } from '../../utils/errors';
import { toast, confirmDialog } from '../../utils/toast';

const EMPTY = {
  commissionPercentage: '',
  baseFare: '',
  perKmRate: '',
  minimumFare: '',
  bike: '',
  rickshaw: '',
  car: '',
  delivery: ''
};

function toForm(data) {
  return {
    commissionPercentage: String(data.commissionPercentage),
    baseFare: String(data.fare.baseFare),
    perKmRate: String(data.fare.perKmRate),
    minimumFare: String(data.fare.minimumFare),
    bike: String(data.fare.multipliers.bike),
    rickshaw: String(data.fare.multipliers.rickshaw),
    car: String(data.fare.multipliers.car),
    delivery: String(data.fare.multipliers.delivery)
  };
}

export default function Settings() {
  const [form, setForm] = useState(EMPTY);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const [loadError, setLoadError] = useState('');
  const [original, setOriginal] = useState(null);

  const loadSettings = useCallback(async () => {
    try {
      setLoading(true);
      setLoadError('');
      const response = await api.get('/payment/settings');
      if (response.data.success) {
        const next = toForm(response.data);
        setForm(next);
        setOriginal(next);
      } else {
        setLoadError(response.data.message);
      }
    } catch (err) {
      setLoadError(getErrorMessage(err, 'Could not load settings'));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadSettings();
  }, [loadSettings]);

  const handleChange = (e) => setForm({ ...form, [e.target.name]: e.target.value });

  function validate() {
    for (const [key, value] of Object.entries(form)) {
      if (value === '' || !Number.isFinite(Number(value))) return 'Please fill in every field with a valid number.';
    }
    const commission = Number(form.commissionPercentage);
    if (commission < 0 || commission > 100) return 'Commission must be between 0 and 100.';
    for (const key of ['baseFare', 'perKmRate', 'minimumFare']) {
      if (Number(form[key]) < 0) return 'Fares cannot be negative.';
    }
    for (const key of ['bike', 'rickshaw', 'car', 'delivery']) {
      const m = Number(form[key]);
      if (m < 0.1 || m > 10) return 'Vehicle multipliers must be between 0.1 and 10.';
    }
    return '';
  }

  const handleSave = async (e) => {
    e.preventDefault();
    setError('');

    const problem = validate();
    if (problem) {
      setError(problem);
      return;
    }

    if (original && form.commissionPercentage !== original.commissionPercentage) {
      const ok = await confirmDialog({
        title: 'Change platform commission?',
        message: `Commission will change from ${original.commissionPercentage}% to ${form.commissionPercentage}% for all trips completed from now on.`,
        confirmText: 'Yes, save'
      });
      if (!ok) return;
    }

    setSaving(true);

    try {
      const response = await api.patch('/payment/settings', {
        commissionPercentage: Number(form.commissionPercentage),
        baseFare: Number(form.baseFare),
        perKmRate: Number(form.perKmRate),
        minimumFare: Number(form.minimumFare),
        multipliers: {
          bike: Number(form.bike),
          rickshaw: Number(form.rickshaw),
          car: Number(form.car),
          delivery: Number(form.delivery)
        }
      });

      if (response.data.success) {
        const next = toForm(response.data);
        setForm(next);
        setOriginal(next);
        toast.success('Settings updated.');
      } else {
        setError(response.data.message);
      }
    } catch (err) {
      setError(getErrorMessage(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="w-full max-w-2xl space-y-6">
      <div>
        <h1 className="text-xl font-bold text-fg">Platform Settings</h1>
        <p className="text-xs text-muted">Manage commission and fare estimation for all future trips</p>
      </div>

      {error && (
        <div className="p-3 bg-danger-soft border border-danger/30 text-danger text-xs rounded-xl font-semibold">{error}</div>
      )}

      {loading ? (
        <p className="text-sm text-muted">Loading settings...</p>
      ) : loadError ? (
        <div className="card p-8 text-center space-y-3">
          <p className="text-sm text-danger">{loadError}</p>
          <Button type="button" variant="secondary" onClick={loadSettings}>Try again</Button>
        </div>
      ) : (
        <form onSubmit={handleSave} className="space-y-6">
          <div className="card p-6 space-y-4">
            <h3 className="text-sm font-bold text-fg">Commission</h3>
            <Input
              label="Platform Commission Rate (%)"
              type="number"
              name="commissionPercentage"
              min="0"
              max="100"
              step="0.5"
              value={form.commissionPercentage}
              onChange={handleChange}
              required
              helpText="Applies to trips completed after you save. Existing transactions keep their original rate."
            />
          </div>

          <div className="card p-6 space-y-4">
            <h3 className="text-sm font-bold text-fg">Fare Estimation</h3>
            <p className="text-xs text-muted">
              Estimated fare = (base fare + per-km rate × distance) × vehicle multiplier, rounded to the nearest PKR 10
              and never below the minimum fare. Customers can still offer their own fare.
            </p>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <Input label="Base Fare (PKR)" type="number" name="baseFare" min="0" value={form.baseFare} onChange={handleChange} required />
              <Input label="Per Km (PKR)" type="number" name="perKmRate" min="0" value={form.perKmRate} onChange={handleChange} required />
              <Input label="Minimum Fare (PKR)" type="number" name="minimumFare" min="0" value={form.minimumFare} onChange={handleChange} required />
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
              <Input label="Bike ×" type="number" name="bike" min="0.1" max="10" step="0.05" value={form.bike} onChange={handleChange} required />
              <Input label="Rickshaw ×" type="number" name="rickshaw" min="0.1" max="10" step="0.05" value={form.rickshaw} onChange={handleChange} required />
              <Input label="Car ×" type="number" name="car" min="0.1" max="10" step="0.05" value={form.car} onChange={handleChange} required />
              <Input label="Delivery ×" type="number" name="delivery" min="0.1" max="10" step="0.05" value={form.delivery} onChange={handleChange} required />
            </div>
          </div>

          <Button type="submit" variant="primary" disabled={saving}>
            {saving ? 'Saving...' : 'Save System Configuration'}
          </Button>
        </form>
      )}
    </div>
  );
}
