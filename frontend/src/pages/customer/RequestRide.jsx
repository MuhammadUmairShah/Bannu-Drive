import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Navigation, Bike, Car, DollarSign, CheckCircle2 } from 'lucide-react';
import Input from '../../components/Input';
import Button from '../../components/Button';
import FareSummary from '../../components/FareSummary';
import TripPlanner from '../../components/map/TripPlanner';
import useRoute from '../../hooks/useRoute';
import useFareEstimate from '../../hooks/useFareEstimate';
import api from '../../utils/api';
import { getErrorMessage } from '../../utils/errors';

export default function RequestRide() {
  const navigate = useNavigate();

  const [submitted, setSubmitted] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState('');

  const [pickup, setPickup] = useState(null);
  const [destination, setDestination] = useState(null);
  const [fareTouched, setFareTouched] = useState(false);

  const [formData, setFormData] = useState({
    vehicleType: 'Bike',
    preferredFare: '',
    notes: ''
  });

  const { route, loading: routeLoading, error: routeError, retry: retryRoute } = useRoute(pickup, destination);
  const { estimate, loading: estimateLoading, error: estimateError } = useFareEstimate(
    pickup,
    destination,
    route,
    routeLoading,
    formData.vehicleType.toLowerCase()
  );

  // Pre-fill the offer with the estimate until the customer edits it themselves
  useEffect(() => {
    if (estimate && !fareTouched) {
      setFormData((prev) => ({ ...prev, preferredFare: String(estimate.estimatedFare) }));
    }
  }, [estimate, fareTouched]);

  const handleChange = (e) => {
    if (e.target.name === 'preferredFare') setFareTouched(true);
    setFormData({ ...formData, [e.target.name]: e.target.value });
  };

  async function createRide(e) {
    e.preventDefault();
    setFormError('');

    if (!pickup || !destination) {
      setFormError('Please select both pickup and destination on the map.');
      return;
    }

    if (!(Number(formData.preferredFare) > 0)) {
      setFormError('Please enter a fare greater than zero.');
      return;
    }

    try {
      setSubmitting(true);

      const response = await api.post('/ride/create', {
        pickupLocation: pickup.address,
        destination: destination.address,
        pickupCoords: { latitude: pickup.latitude, longitude: pickup.longitude },
        destinationCoords: { latitude: destination.latitude, longitude: destination.longitude },
        distanceKm: route?.distanceKm,
        durationMin: route?.durationMin,
        vehicleType: formData.vehicleType.toLowerCase(),
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
  }

  function resetForm() {
    setSubmitted(false);
    setPickup(null);
    setDestination(null);
    setFareTouched(false);
    setFormData({ vehicleType: 'Bike', preferredFare: '', notes: '' });
  }

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      <div>
        <h1 className="text-xl font-bold text-fg">Request a Ride</h1>
        <p className="text-xs text-muted">Book quick local transport across Bannu City</p>
      </div>

      {submitted ? (
        <div className="card p-8 text-center space-y-4">
          <CheckCircle2 className="w-12 h-12 text-link mx-auto" />
          <h3 className="text-lg font-bold text-fg">Ride Request Broadcasted!</h3>
          <p className="text-xs text-muted">
            Riders can now see your request from{' '}
            <span className="font-semibold text-fg">{pickup?.address}</span> with your offered fare of PKR{' '}
            {formData.preferredFare}.
          </p>
          <div className="pt-2 flex justify-center space-x-3">
            <Button variant="primary" onClick={() => navigate('/customer/requests')}>
              View My Requests
            </Button>
            <Button variant="outline" onClick={resetForm}>
              Request Another
            </Button>
          </div>
        </div>
      ) : (
        <form onSubmit={createRide} className="card p-4 sm:p-6 space-y-5">
          <TripPlanner
            pickup={pickup}
            destination={destination}
            onPickupChange={setPickup}
            onDestinationChange={setDestination}
            route={route}
            loading={routeLoading}
            error={routeError} onRetryRoute={retryRoute}
          />

          {/* Vehicle */}
          <div>
            <label className="block text-xs font-semibold text-fg  mb-2">Vehicle Category</label>

            <div className="grid grid-cols-3 gap-3">
              {[
                { type: 'Bike', icon: Bike, desc: 'Single Seat' },
                { type: 'Rickshaw', icon: Navigation, desc: 'Up to 3 Seats' },
                { type: 'Car', icon: Car, desc: 'Private Cab' }
              ].map((v) => {
                const Icon = v.icon;

                return (
                  <button
                    type="button"
                    key={v.type}
                    onClick={() => {
                      setFareTouched(false);
                      setFormData({ ...formData, vehicleType: v.type });
                    }}
                    className={`p-3 rounded-xl border text-center transition-all ${
                      formData.vehicleType === v.type
                        ? 'border-primary bg-primary-soft text-link ring-1 ring-primary'
                        : 'border-line text-muted hover:bg-surface-2'
                    }`}
                  >
                    <Icon className="w-5 h-5 mx-auto mb-1 text-link" />
                    <p className="text-xs font-bold">{v.type}</p>
                    <p className="text-xs text-muted">{v.desc}</p>
                  </button>
                );
              })}
            </div>
          </div>

          <FareSummary
            estimate={estimate}
            loading={estimateLoading}
            error={estimateError}
            offered={formData.preferredFare}
            hasPoints={!!(pickup && destination)}
          />

          {/* Fare */}
          <Input
            label="Your Offered Fare (PKR)"
            type="number"
            name="preferredFare"
            min="1"
            value={formData.preferredFare}
            onChange={handleChange}
            placeholder="e.g. 150"
            icon={DollarSign}
            required
            helpText={
              estimate
                ? `Estimated fare is PKR ${estimate.estimatedFare}. Drivers can accept any offer you set.`
                : 'Select pickup and destination to get an estimated fare.'
            }
          />

          {/* Notes */}
          <div>
            <label className="block text-xs font-semibold text-fg  mb-1">Driver Notes (Optional)</label>
            <textarea
              name="notes"
              rows={2}
              maxLength={300}
              value={formData.notes}
              onChange={handleChange}
              placeholder="e.g. Waiting near Main Gate entrance"
              className="w-full text-sm border-field-line rounded-xl p-2.5 border focus:ring-primary bg-field text-fg"
            />
          </div>

          {formError && (
            <div className="p-3 bg-danger-soft border border-danger/30 text-danger text-xs rounded-xl font-semibold">
              {formError}
            </div>
          )}

          <Button type="submit" variant="primary" fullWidth size="lg" disabled={submitting}>
            {submitting ? 'Submitting...' : 'Broadcast Ride Request'}
          </Button>
        </form>
      )}
    </div>
  );
}
