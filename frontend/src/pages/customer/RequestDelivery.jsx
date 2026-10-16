import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { User, DollarSign, CheckCircle2 } from 'lucide-react';
import Input from '../../components/Input';
import Button from '../../components/Button';
import FareSummary from '../../components/FareSummary';
import TripPlanner from '../../components/map/TripPlanner';
import useRoute from '../../hooks/useRoute';
import useFareEstimate from '../../hooks/useFareEstimate';
import api from '../../utils/api';
import { getErrorMessage } from '../../utils/errors';

export default function RequestDelivery() {
  const navigate = useNavigate();
  const [submitted, setSubmitted] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState('');

  const [pickup, setPickup] = useState(null);
  const [destination, setDestination] = useState(null);
  const [fareTouched, setFareTouched] = useState(false);

  const [formData, setFormData] = useState({
    receiverName: '',
    receiverPhone: '',
    packageDescription: '',
    parcelType: 'other',
    parcelSize: 'small',
    preferredFare: '',
    notes: ''
  });

  const { route, loading: routeLoading, error: routeError, retry: retryRoute } = useRoute(pickup, destination);
  const { estimate, loading: estimateLoading, error: estimateError } = useFareEstimate(
    pickup,
    destination,
    route,
    routeLoading,
    'delivery'
  );

  useEffect(() => {
    if (estimate && !fareTouched) {
      setFormData((prev) => ({ ...prev, preferredFare: String(estimate.estimatedFare) }));
    }
  }, [estimate, fareTouched]);

  const handleChange = (e) => {
    if (e.target.name === 'preferredFare') setFareTouched(true);
    setFormData({ ...formData, [e.target.name]: e.target.value });
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setFormError('');

    if (!pickup || !destination) {
      setFormError('Please select both pickup and delivery locations on the map.');
      return;
    }

    if (!(Number(formData.preferredFare) > 0)) {
      setFormError('Please enter a fare greater than zero.');
      return;
    }

    setSubmitting(true);

    try {
      const response = await api.post('/delivery/create', {
        pickupLocation: pickup.address,
        destination: destination.address,
        pickupCoords: { latitude: pickup.latitude, longitude: pickup.longitude },
        destinationCoords: { latitude: destination.latitude, longitude: destination.longitude },
        distanceKm: route?.distanceKm,
        durationMin: route?.durationMin,
        receiverName: formData.receiverName,
        receiverPhone: formData.receiverPhone,
        packageDescription: formData.packageDescription,
        parcelType: formData.parcelType,
        parcelSize: formData.parcelSize,
        offeredFare: Number(formData.preferredFare),
        notes: formData.notes
      });

      if (response.data.success) {
        setSubmitted(true);
      } else {
        setFormError(response.data.message);
      }
    } catch (error) {
      setFormError(getErrorMessage(error));
    } finally {
      setSubmitting(false);
    }
  };

  function resetForm() {
    setSubmitted(false);
    setPickup(null);
    setDestination(null);
    setFareTouched(false);
    setFormData({ receiverName: '', receiverPhone: '', packageDescription: '', parcelType: 'other', parcelSize: 'small', preferredFare: '', notes: '' });
  }

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      <div>
        <h1 className="text-xl font-bold text-fg">Request Parcel Delivery</h1>
        <p className="text-xs text-muted">Send packages, food, or documents anywhere in Bannu</p>
      </div>

      {submitted ? (
        <div className="card p-8 text-center space-y-4">
          <CheckCircle2 className="w-12 h-12 text-link mx-auto" />
          <h3 className="text-lg font-bold text-fg">Delivery Request Live!</h3>
          <p className="text-xs text-muted">
            A rider will pick up your parcel from <span className="font-semibold text-fg">{pickup?.address}</span> and
            deliver to <span className="font-semibold text-fg">{formData.receiverName}</span>.
          </p>
          <div className="pt-2 flex justify-center space-x-3">
            <Button variant="primary" onClick={() => navigate('/customer/requests')}>
              Track Delivery
            </Button>
            <Button variant="outline" onClick={resetForm}>
              Send Another Parcel
            </Button>
          </div>
        </div>
      ) : (
        <form onSubmit={handleSubmit} className="card p-4 sm:p-6 space-y-5">
          <TripPlanner
            pickup={pickup}
            destination={destination}
            onPickupChange={setPickup}
            onDestinationChange={setDestination}
            route={route}
            loading={routeLoading}
            error={routeError} onRetryRoute={retryRoute}
          />

          <div className="p-4 bg-surface-2 border border-line rounded-xl space-y-3">
            <p className="text-xs font-bold text-fg flex items-center space-x-1">
              <User className="w-4 h-4 text-link" />
              <span>Receiver Details</span>
            </p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <Input
                label="Receiver Name"
                name="receiverName"
                autoComplete="off"
                value={formData.receiverName}
                onChange={handleChange}
                placeholder="Receiver full name"
                required
              />
              <Input
                label="Receiver Phone"
                name="receiverPhone"
                type="tel"
                inputMode="tel"
                autoComplete="off"
                value={formData.receiverPhone}
                onChange={handleChange}
                placeholder="03XXXXXXXXX"
                required
              />
            </div>
          </div>

          <div>
            <label className="block text-xs font-semibold text-fg  mb-1">Package Description</label>
            <textarea
              name="packageDescription"
              rows={2}
              value={formData.packageDescription}
              onChange={handleChange}
              placeholder="e.g. Small box containing electronics or documents"
              className="w-full text-sm border-field-line rounded-xl p-2.5 border focus:ring-primary bg-field text-fg"
              required
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-semibold text-fg  mb-1">Parcel Type</label>
              <select
                name="parcelType"
                value={formData.parcelType}
                onChange={handleChange}
                className="w-full text-sm border-field-line rounded-xl p-2.5 border bg-field focus:ring-primary text-fg"
              >
                <option value="document">Documents</option>
                <option value="food">Food</option>
                <option value="clothes">Clothes</option>
                <option value="electronics">Electronics</option>
                <option value="grocery">Grocery</option>
                <option value="other">Other</option>
              </select>
            </div>
            <div>
              <label className="block text-xs font-semibold text-fg  mb-1">Parcel Size</label>
              <select
                name="parcelSize"
                value={formData.parcelSize}
                onChange={handleChange}
                className="w-full text-sm border-field-line rounded-xl p-2.5 border bg-field focus:ring-primary text-fg"
              >
                <option value="small">Small (fits in a bag)</option>
                <option value="medium">Medium (box)</option>
                <option value="large">Large (bulky)</option>
              </select>
            </div>
          </div>

          <FareSummary
            estimate={estimate}
            loading={estimateLoading}
            error={estimateError}
            offered={formData.preferredFare}
            hasPoints={!!(pickup && destination)}
          />

          <Input
            label="Delivery Fare Offer (PKR)"
            type="number"
            name="preferredFare"
            min="1"
            value={formData.preferredFare}
            onChange={handleChange}
            icon={DollarSign}
            required
            helpText={
              estimate
                ? `Estimated fare is PKR ${estimate.estimatedFare}. Riders can accept any offer you set.`
                : 'Select pickup and delivery locations to get an estimated fare.'
            }
          />

          <div>
            <label className="block text-xs font-semibold text-fg  mb-1">Rider Notes (Optional)</label>
            <textarea
              name="notes"
              rows={2}
              maxLength={300}
              value={formData.notes}
              onChange={handleChange}
              placeholder="e.g. Fragile, call on arrival"
              className="w-full text-sm border-field-line rounded-xl p-2.5 border focus:ring-primary bg-field text-fg"
            />
          </div>

          {formError && (
            <div className="p-3 bg-danger-soft border border-danger/30 text-danger text-xs rounded-xl font-semibold">
              {formError}
            </div>
          )}

          <Button type="submit" variant="primary" fullWidth size="lg" disabled={submitting}>
            {submitting ? 'Submitting...' : 'Request Delivery Dispatch'}
          </Button>
        </form>
      )}
    </div>
  );
}
