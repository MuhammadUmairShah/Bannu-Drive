import { useEffect, useRef, useState } from 'react';
import api from '../utils/api';

const SEND_INTERVAL_MS = 10000; // at most one update every 10 seconds
const MIN_MOVE_METERS = 15; // ...unless the driver has barely moved

function distanceMeters(a, b) {
  const R = 6371000;
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(b.latitude - a.latitude);
  const dLon = toRad(b.longitude - a.longitude);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.latitude)) * Math.cos(toRad(b.latitude)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

// Shares the driver's real GPS position with the backend while `enabled`.
// state: 'off' | 'starting' | 'sharing' | 'denied' | 'unavailable' | 'timeout' | 'unsupported'
export default function useDriverLocation(enabled) {
  const [state, setState] = useState('off');
  const [lastSentAt, setLastSentAt] = useState(null);
  const lastSent = useRef({ time: 0, point: null });

  useEffect(() => {
    if (!enabled) {
      setState('off');
      lastSent.current = { time: 0, point: null };
      return undefined;
    }

    if (!navigator.geolocation) {
      setState('unsupported');
      return undefined;
    }

    setState('starting');

    async function send(position) {
      const point = {
        latitude: position.coords.latitude,
        longitude: position.coords.longitude
      };

      const now = Date.now();
      const elapsed = now - lastSent.current.time;
      const moved = lastSent.current.point ? distanceMeters(lastSent.current.point, point) : Infinity;

      // Throttle: skip if we sent recently and have not really moved
      if (elapsed < SEND_INTERVAL_MS && moved < MIN_MOVE_METERS * 4) return;
      if (elapsed < 3000) return;

      lastSent.current = { time: now, point };

      try {
        await api.patch('/user/location', {
          ...point,
          accuracy: position.coords.accuracy
        });
        setLastSentAt(new Date());
        setState('sharing');
      } catch (error) {
        // 409 means the driver went offline meanwhile; anything else is retried on the next fix
        if (error.response?.status !== 409) {
          console.log('Location update failed:', error.message);
        }
      }
    }

    function onError(error) {
      if (error.code === error.PERMISSION_DENIED) setState('denied');
      else if (error.code === error.TIMEOUT) setState('timeout');
      else setState('unavailable');
    }

    const watchId = navigator.geolocation.watchPosition(send, onError, {
      enableHighAccuracy: true,
      maximumAge: 5000,
      timeout: 20000
    });

    return () => navigator.geolocation.clearWatch(watchId);
  }, [enabled]);

  return { state, lastSentAt };
}

export const LOCATION_STATE_TEXT = {
  off: 'Location sharing off',
  starting: 'Getting your location...',
  sharing: 'Sharing live location',
  denied: 'Location permission denied',
  unavailable: 'Location unavailable',
  timeout: 'Location timed out',
  unsupported: 'Location not supported'
};
