import { useCallback, useEffect, useRef, useState } from 'react';
import api from '../utils/api';
import { getErrorMessage } from '../utils/errors';

const SEND_EVERY_MS = 8000;
const FATAL_CODES = ['TRACKING_INACTIVE', 'TRIP_ENDED']; // the server says this trip is not being tracked any more

/**
 * Operator / driver side of live tracking: reads the phone's GPS and posts it to
 * POST /coach/operator/schedules/:id/location. The server only accepts positions while the trip is DEPARTED / IN_TRANSIT.
 * Every tick asks the phone for a fresh fix, so a parked bus still reports "I'm here" with a current timestamp.
 */
export default function useTripSharing(scheduleId) {
  const [state, setState] = useState({ sharing: false, starting: false, error: '', lastSentAt: null, accuracy: null, position: null });
  const watchId = useRef(null);
  const timer = useRef(null);
  const wake = useRef(null);
  const sharing = useRef(false);
  const busy = useRef(false);

  const patch = (p) => setState((s) => ({ ...s, ...p }));

  const requestWake = useCallback(async () => {
    try { wake.current = await navigator.wakeLock?.request('screen'); } catch { /* not supported or refused */ }
  }, []);

  const clearLocal = useCallback(() => {
    sharing.current = false;
    if (watchId.current !== null) navigator.geolocation.clearWatch(watchId.current);
    watchId.current = null;
    clearInterval(timer.current); timer.current = null;
    wake.current?.release?.().catch(() => {}); wake.current = null;
  }, []);

  const send = useCallback(async (pos) => {
    const c = pos.coords;
    const body = { latitude: c.latitude, longitude: c.longitude, at: pos.timestamp };
    if (Number.isFinite(c.accuracy)) body.accuracy = c.accuracy;
    if (Number.isFinite(c.speed)) body.speed = c.speed;        // metres per second, as reported by the phone
    if (Number.isFinite(c.heading)) body.heading = c.heading;
    try {
      const r = await api.post(`/coach/operator/schedules/${scheduleId}/location`, body);
      if (r.data?.accepted) patch({ lastSentAt: new Date(), error: '' });
    } catch (err) {
      const d = err?.response?.data;
      if (d?.stale) return; // an older fix than the one the server already has: harmless
      if (FATAL_CODES.includes(d?.code)) { clearLocal(); patch({ sharing: false, error: d.message || 'Tracking is not active for this trip.' }); return; }
      patch({ error: getErrorMessage(err, 'Could not send the location. Retrying...') });
    }
  }, [scheduleId, clearLocal]);

  const tick = useCallback(() => {
    if (!sharing.current || busy.current) return;
    busy.current = true;
    navigator.geolocation.getCurrentPosition(
      async (pos) => { try { await send(pos); } finally { busy.current = false; } },
      (err) => { busy.current = false; patch({ error: err.code === 1 ? 'Location permission was denied. Allow it in the browser settings.' : 'No GPS signal. Move to an open area.' }); },
      { enableHighAccuracy: true, maximumAge: 2000, timeout: 8000 }
    );
  }, [send]);

  const start = useCallback(() => {
    if (!navigator.geolocation) return patch({ error: 'This browser cannot read the location.' });
    if (sharing.current) return;
    sharing.current = true;
    patch({ sharing: true, error: '' });
    // the watch keeps the GPS awake and moves the marker on the operator's own map between sends
    watchId.current = navigator.geolocation.watchPosition(
      (pos) => patch({ accuracy: Math.round(pos.coords.accuracy), position: { latitude: pos.coords.latitude, longitude: pos.coords.longitude } }),
      (err) => patch({ error: err.code === 1 ? 'Location permission was denied. Allow it in the browser settings and try again.' : 'Could not get a GPS fix. Move to an open area.' }),
      { enableHighAccuracy: true, maximumAge: 5000, timeout: 20000 }
    );
    tick();
    timer.current = setInterval(tick, SEND_EVERY_MS);
    requestWake();
  }, [tick, requestWake]);

  const stop = useCallback(() => { clearLocal(); patch({ sharing: false }); }, [clearLocal]);

  // the screen lock is released when the tab is hidden: take it again when the tab comes back
  useEffect(() => {
    const onVisible = () => { if (document.visibilityState === 'visible' && sharing.current) requestWake(); };
    const onLeave = (e) => { if (sharing.current) { e.preventDefault(); e.returnValue = ''; } };
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('beforeunload', onLeave);
    return () => { document.removeEventListener('visibilitychange', onVisible); window.removeEventListener('beforeunload', onLeave); clearLocal(); };
  }, [requestWake, clearLocal]);

  return { ...state, start, stop };
}