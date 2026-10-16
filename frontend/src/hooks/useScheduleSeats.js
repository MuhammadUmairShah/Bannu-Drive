import { useCallback, useEffect, useRef, useState } from 'react';
import api from '../utils/api';
import { getErrorMessage } from '../utils/errors';
import { getSocket } from '../utils/socket';
import { applySeatEvent } from '../utils/seatSync';

const POLL_WHEN_OFFLINE_MS = 15000;

// One schedule's seat map, kept live.
//   - REST is the source of truth; the socket only makes it faster.
//   - Events carry a version: a gap or a (re)connect triggers a full re-fetch, never a guess.
//   - While the socket is down the map is polled and flagged "reconnecting", so it never pretends to be live.
//   - Everything is cleaned up on unmount (no duplicate listeners, no leaked room membership).
// options: { path, ops, onEvent }   ops=true -> operator/admin map (updates arrive as refresh hints)
export default function useScheduleSeats(scheduleId, { path, ops = false, onEvent } = {}) {
  const url = path || `/coach/schedules/${scheduleId}`;
  const [state, setState] = useState({ data: null, loading: true, error: '' });
  const [conn, setConn] = useState('connecting'); // connecting | live | reconnecting
  const [lastSync, setLastSync] = useState(0);
  const dataRef = useRef(null);
  const reqId = useRef(0);
  const onEventRef = useRef(onEvent);
  onEventRef.current = onEvent;

  const load = useCallback(async (silent = false) => {
    const id = ++reqId.current; // an older response must never overwrite a newer one
    try {
      if (!silent) setState((s) => ({ ...s, loading: !s.data, error: '' }));
      const res = await api.get(url);
      if (id !== reqId.current) return null;
      dataRef.current = res.data;
      setState({ data: res.data, loading: false, error: '' });
      setLastSync(Date.now());
      return res.data;
    } catch (err) {
      if (id !== reqId.current) return null;
      if (!silent || !dataRef.current) setState((s) => ({ ...s, loading: false, error: getErrorMessage(err, 'Could not load this trip') }));
      return null;
    }
  }, [url]);

  useEffect(() => {
    dataRef.current = null;
    setState({ data: null, loading: true, error: '' });
    load();

    const socket = getSocket();
    let alive = true;
    let wasConnected = false;
    let debounce = null;

    const watch = () => {
      socket.emit('coach:watch', scheduleId, (res) => {
        if (!alive) return;
        if (res?.ok) {
          setConn('live');
          if (wasConnected) load(true); // RE-connected: anything may have changed while we were away
          wasConnected = true;
        } else {
          setConn('reconnecting');
        }
      });
    };
    const onDisconnect = () => alive && setConn('reconnecting');

    const onSeats = (p) => {
      if (!alive) return;
      const { next, resync, changed } = applySeatEvent(dataRef.current, p);
      if (resync) return void load(true);
      if (changed) {
        dataRef.current = next;
        setState((s) => ({ ...s, data: next }));
        setLastSync(Date.now());
      }
      onEventRef.current?.(p, { changed });
    };
    const onOps = (p) => {
      if (!alive || String(p.scheduleId) !== String(scheduleId)) return;
      clearTimeout(debounce);
      debounce = setTimeout(() => load(true), 200); // coalesce bursts
      onEventRef.current?.(p, { changed: true });
    };

    socket.on('connect', watch);
    socket.on('disconnect', onDisconnect);
    socket.on('connect_error', onDisconnect);
    socket.on(ops ? 'coach:ops-update' : 'coach:seats', ops ? onOps : onSeats);
    if (socket.connected) watch(); else setConn(socket.active ? 'connecting' : 'reconnecting');

    // Safety nets: poll while offline, and re-sync when the tab comes back to the foreground
    const poll = setInterval(() => { if (!socket.connected) load(true); }, POLL_WHEN_OFFLINE_MS);
    const onVisible = () => { if (document.visibilityState === 'visible') load(true); };
    document.addEventListener('visibilitychange', onVisible);

    return () => {
      alive = false;
      clearTimeout(debounce);
      clearInterval(poll);
      document.removeEventListener('visibilitychange', onVisible);
      socket.emit('coach:unwatch', scheduleId);
      socket.off('connect', watch);
      socket.off('disconnect', onDisconnect);
      socket.off('connect_error', onDisconnect);
      socket.off(ops ? 'coach:ops-update' : 'coach:seats', ops ? onOps : onSeats);
    };
  }, [scheduleId, ops, load]);

  return {
    ...state,
    conn,
    live: conn === 'live',
    lastSync,
    reload: () => load(false),
    refresh: () => load(true)
  };
}
