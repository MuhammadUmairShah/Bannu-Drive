import { useCallback, useEffect, useState } from 'react';
import { fetchRoute } from '../utils/geo';

// Loads the road route whenever both points are set. Returns { route, loading, error, retry }.
export default function useRoute(pickup, destination) {
  const [route, setRoute] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [attempt, setAttempt] = useState(0);

  const pLat = pickup?.latitude, pLng = pickup?.longitude, dLat = destination?.latitude, dLng = destination?.longitude;

  useEffect(() => {
    if ([pLat, pLng, dLat, dLng].some((v) => typeof v !== 'number')) { setRoute(null); setError(''); return undefined; }
    const controller = new AbortController();
    setLoading(true); setError('');
    fetchRoute({ latitude: pLat, longitude: pLng }, { latitude: dLat, longitude: dLng }, { signal: controller.signal })
      .then((r) => setRoute(r))
      .catch((err) => { if (err.name !== 'CanceledError' && err.code !== 'ERR_CANCELED') { setRoute(null); setError(err.message); } })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [pLat, pLng, dLat, dLng, attempt]);

  return { route, loading, error, retry: useCallback(() => setAttempt((n) => n + 1), []) };
}
