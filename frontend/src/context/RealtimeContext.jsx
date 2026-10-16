import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import api from '../utils/api';
import { getSocket, disconnectSocket } from '../utils/socket';
import { toast } from '../utils/toast';
import { useAuth } from './AuthContext';

const RealtimeContext = createContext(null);

const FALLBACK_POLL_MS = 30000; // used only while the socket is disconnected

export function RealtimeProvider({ children }) {
  const { user } = useAuth();
  const [notifications, setNotifications] = useState([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [connected, setConnected] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const connectedRef = useRef(false);

  const userId = user?.id || user?._id || null;

  const reload = useCallback(async () => {
    if (!userId) return;

    try {
      setLoading(true);
      const response = await api.get('/notification');

      if (response.data.success) {
        setNotifications(response.data.notifications);
        setUnreadCount(response.data.unreadCount);
        setError('');
      }
    } catch (err) {
      setError('Could not load notifications');
    } finally {
      setLoading(false);
    }
  }, [userId]);

  useEffect(() => {
    if (!userId) {
      setNotifications([]);
      setUnreadCount(0);
      setConnected(false);
      disconnectSocket();
      return undefined;
    }

    reload();

    const socket = getSocket();

    const onConnect = () => {
      connectedRef.current = true;
      setConnected(true);
      reload(); // catch up on anything missed while offline
    };
    const onDisconnect = () => {
      connectedRef.current = false;
      setConnected(false);
    };
    const onNew = (notification) => {
      setNotifications((current) => [notification, ...current.filter((n) => n._id !== notification._id)].slice(0, 50));
      setUnreadCount((count) => count + 1);
      toast.info(`${notification.title}: ${notification.message}`);
    };

    socket.on('connect', onConnect);
    socket.on('disconnect', onDisconnect);
    socket.on('notification:new', onNew);
    socket.connect();

    const timer = setInterval(() => {
      if (!connectedRef.current) reload();
    }, FALLBACK_POLL_MS);

    return () => {
      clearInterval(timer);
      socket.off('connect', onConnect);
      socket.off('disconnect', onDisconnect);
      socket.off('notification:new', onNew);
    };
  }, [userId, reload]);

  const markRead = useCallback(async (id) => {
    setNotifications((current) => current.map((n) => (n._id === id ? { ...n, read: true } : n)));
    setUnreadCount((count) => Math.max(0, count - 1));

    try {
      await api.patch(`/notification/${id}/read`);
    } catch (err) {
      reload();
    }
  }, [reload]);

  const markAllRead = useCallback(async () => {
    setNotifications((current) => current.map((n) => ({ ...n, read: true })));
    setUnreadCount(0);

    try {
      await api.patch('/notification/read-all');
    } catch (err) {
      reload();
    }
  }, [reload]);

  const value = useMemo(
    () => ({ notifications, unreadCount, connected, loading, error, reload, markRead, markAllRead }),
    [notifications, unreadCount, connected, loading, error, reload, markRead, markAllRead]
  );

  return <RealtimeContext.Provider value={value}>{children}</RealtimeContext.Provider>;
}

export function useRealtime() {
  return useContext(RealtimeContext);
}

// Subscribe a component to a socket event; safe when the socket is not connected yet.
export function useSocketEvent(event, handler) {
  const saved = useRef(handler);
  saved.current = handler;

  useEffect(() => {
    const socket = getSocket();
    const listener = (payload) => saved.current(payload);
    socket.on(event, listener);
    return () => socket.off(event, listener);
  }, [event]);
}
