import { useEffect, useState } from 'react';
import api from '../utils/api';
import { getErrorMessage } from '../utils/errors';

// Asks the backend for the authoritative fare estimate.
// kind: 'bike' | 'rickshaw' | 'car' | 'delivery'
// Waits for the route to finish loading; if routing failed the backend
// estimates from the straight-line distance instead.
export default function useFareEstimate(pickup, destination, route, routeLoading, kind) {
  const [estimate, setEstimate] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const pLat = pickup?.latitude;
  const pLng = pickup?.longitude;
  const dLat = destination?.latitude;
  const dLng = destination?.longitude;
  const distanceKm = route?.distanceKm;
  const durationMin = route?.durationMin;

  useEffect(() => {
    if ([pLat, pLng, dLat, dLng].some((v) => typeof v !== 'number') || routeLoading) {
      if (!routeLoading) setEstimate(null);
      return undefined;
    }

    let cancelled = false;
    setLoading(true);
    setError('');

    api
      .post('/payment/estimate', {
        kind,
        pickupCoords: { latitude: pLat, longitude: pLng },
        destinationCoords: { latitude: dLat, longitude: dLng },
        distanceKm,
        durationMin
      })
      .then((response) => {
        if (!cancelled) {
          setEstimate(response.data.success ? response.data : null);
          if (!response.data.success) setError(response.data.message);
        }
      })
      .catch((err) => {
        if (!cancelled) {
          setEstimate(null);
          setError(getErrorMessage(err));
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [pLat, pLng, dLat, dLng, distanceKm, durationMin, routeLoading, kind]);

  return { estimate, loading, error };
}
