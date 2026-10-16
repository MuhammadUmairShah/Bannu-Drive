import { io } from 'socket.io-client';
import { refreshSession } from './api';

// One shared connection, authenticated by the same httpOnly access cookie as the REST API.
// The URL comes from VITE_API_URL (never hardcoded).
let socket = null;
let refreshingForSocket = false;

export function getSocket() {
  if (!socket) {
    socket = io(import.meta.env.VITE_API_URL, {
      withCredentials: true,
      autoConnect: false,
      reconnectionDelayMax: 10000
    });

    // The access cookie lives only 15 minutes. If the server says it is expired, silently refresh the
    // session and reconnect instead of leaving the app without realtime.
    socket.on('connect_error', async (err) => {
      const code = err?.data?.code;
      if (!['AUTH_EXPIRED', 'AUTH_REQUIRED'].includes(code) || refreshingForSocket) return;

      refreshingForSocket = true;
      try {
        await refreshSession();
        socket?.connect();
      } catch {
        // session is really over: AuthContext (via the API client) takes care of the redirect
      } finally {
        setTimeout(() => { refreshingForSocket = false; }, 3000);
      }
    });
  }
  return socket;
}

export function disconnectSocket() {
  if (socket) {
    socket.removeAllListeners();
    socket.disconnect();
    socket = null;
  }
}
