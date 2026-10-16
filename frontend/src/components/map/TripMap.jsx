import { Route as RouteIcon, Clock, MapPinOff } from 'lucide-react';
import MapView from './MapView';
import useRoute from '../../hooks/useRoute';
import { formatCurrency } from '../../utils/formatters';

const hasCoords = (c) => c && typeof c.latitude === 'number' && typeof c.longitude === 'number';

// Read-only map for an existing ride/delivery (driver + customer views).
// job: the ride/delivery document; driverPoint: optional { latitude, longitude }
export default function TripMap({ job, driverPoint, height = 300 }) {
  const pickup = hasCoords(job?.pickupCoords) ? job.pickupCoords : null;
  const destination = hasCoords(job?.destinationCoords) ? job.destinationCoords : null;

  const { route } = useRoute(pickup, destination);

  // Older requests created before maps existed have no coordinates
  if (!pickup || !destination) {
    return (
      <div className="p-4 rounded-xl border border-line bg-surface-2 text-xs text-muted flex items-center gap-2">
        <MapPinOff className="w-4 h-4" />
        This request has no map coordinates (created before map support).
      </div>
    );
  }

  const distance = job.distanceKm ?? route?.distanceKm;
  const duration = job.durationMin ?? route?.durationMin;

  return (
    <div className="space-y-2">
      <MapView
        pickup={pickup}
        destination={destination}
        driver={hasCoords(driverPoint) ? driverPoint : null}
        path={route?.path}
        height={height}
      />

      <div className="flex flex-wrap gap-x-6 gap-y-1 text-xs text-fg">
        {distance != null && (
          <span className="flex items-center gap-1.5">
            <RouteIcon className="w-3.5 h-3.5 text-info" />
            <b>{distance} km</b>
          </span>
        )}
        {duration != null && (
          <span className="flex items-center gap-1.5">
            <Clock className="w-3.5 h-3.5 text-info" />
            <b>~{duration} min</b>
          </span>
        )}
        {job.estimatedFare != null && (
          <span className="text-muted">
            System estimate: <b className="text-fg">{formatCurrency(job.estimatedFare)}</b>
          </span>
        )}
      </div>
    </div>
  );
}
