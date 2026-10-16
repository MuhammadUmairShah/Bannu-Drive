import { useState } from 'react';
import { Route as RouteIcon, Clock, Loader2, AlertTriangle } from 'lucide-react';
import MapView from './MapView';
import LocationPicker from './LocationPicker';
import { reverseGeocode } from '../../utils/geo';

// Shared by Request Ride and Request Delivery:
// two location pickers, a map, the routed line, distance and duration.
// Route / loading / error come from useRoute() in the parent so it can also price the trip.
export default function TripPlanner({ pickup, destination, onPickupChange, onDestinationChange, route, loading, error, onRetryRoute }) {
  const [activeField, setActiveField] = useState('pickup');

  async function handleMapClick(latitude, longitude) {
    const setter = activeField === 'pickup' ? onPickupChange : onDestinationChange;

    // The coordinates are the truth: set them at once, then fill in a label when it arrives
    setter({ address: 'Looking up address...', latitude, longitude });
    const address = await reverseGeocode(latitude, longitude);
    setter({ address, latitude, longitude });

    if (activeField === 'pickup' && !destination) {
      setActiveField('destination');
    }
  }

  // Dragging a marker moves that point; the address follows
  async function handleDrag(name, latitude, longitude) {
    const setter = name === 'pickup' ? onPickupChange : onDestinationChange;
    setter({ address: 'Looking up address...', latitude, longitude });
    setter({ address: await reverseGeocode(latitude, longitude), latitude, longitude });
  }

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <LocationPicker
          label="Pickup Location"
          color="emerald"
          value={pickup}
          onChange={(loc) => {
            onPickupChange(loc);
            if (!destination) setActiveField('destination');
          }}
          active={activeField === 'pickup'}
          onActivate={() => setActiveField('pickup')}
        />
        <LocationPicker
          label="Destination"
          color="rose"
          value={destination}
          onChange={onDestinationChange}
          active={activeField === 'destination'}
          onActivate={() => setActiveField('destination')}
        />
      </div>

      <p className="text-xs text-muted">
        Click the map to set the highlighted point ({activeField === 'pickup' ? 'pickup' : 'destination'}), drag a marker to fine-tune it, or search above.
      </p>

      <MapView
        pickup={pickup}
        destination={destination}
        path={route?.path}
        onMapClick={handleMapClick}
        onMarkerDrag={handleDrag}
        height={340}
      />

      {pickup && destination && (
        <div className="p-3 rounded-xl border border-line bg-surface-2 text-xs">
          {loading ? (
            <p className="flex items-center gap-2 text-muted">
              <Loader2 className="w-4 h-4 animate-spin" /> Calculating route...
            </p>
          ) : route ? (
            <div className="flex flex-wrap gap-6">
              <p className="flex items-center gap-2 text-fg">
                <RouteIcon className="w-4 h-4 text-info" />
                <span className="font-bold">{route.distanceKm} km</span> road distance
              </p>
              <p className="flex items-center gap-2 text-fg">
                <Clock className="w-4 h-4 text-info" />
                <span className="font-bold">~{route.durationMin} min</span> estimated travel
              </p>
            </div>
          ) : (
            <p className="flex flex-wrap items-center gap-2 text-warning" role="alert">
              <AlertTriangle className="w-4 h-4 shrink-0" />
              <span>{error || 'Route unavailable. Please try again.'}</span>
              {onRetryRoute && <button type="button" onClick={onRetryRoute} className="font-semibold underline">Try again</button>}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
