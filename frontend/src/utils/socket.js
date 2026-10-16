import { io } from 'socket.io-client';
import { refreshSession } from './api';

// One shared Socket.IO connection.
let socket = null;
let refreshingForSocket = false;

export function getSocket() {
  if (!socket) {
    socket = io(import.meta.env.VITE_API_URL, {
      withCredentials: true,

      // Use WebSocket directly.
      // This avoids the polling 400 issue we were seeing on Vercel.
      transports: ['websocket'],

      autoConnect: false,

      reconnection: true,
      reconnectionAttempts: Infinity,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 10000,

      timeout: 10000,
    });

    // =========================================================
    // SOCKET CONNECTED
    // =========================================================
    socket.on('connect', () => {
      console.log('🔥 SOCKET CONNECTED:', socket.id);
    });

    // =========================================================
    // SOCKET CONNECTION ERROR
    // =========================================================
    socket.on('connect_error', async (err) => {
      console.error('🔥 SOCKET CONNECT ERROR:', {
        message: err?.message,
        description: err?.description,
        context: err?.context,
        data: err?.data,
      });

      const code = err?.data?.code;

      // Only refresh session for authentication-related errors.
      if (
        !['AUTH_EXPIRED', 'AUTH_REQUIRED'].includes(code) ||
        refreshingForSocket
      ) {
        return;
      }

      refreshingForSocket = true;

      try {
        await refreshSession();

        if (socket && !socket.connected) {
          socket.connect();
        }
      } catch (error) {
        console.warn(
          '⚠️ Socket session refresh failed:',
          error?.message
        );
      } finally {
        setTimeout(() => {
          refreshingForSocket = false;
        }, 3000);
      }
    });

    // =========================================================
    // SOCKET DISCONNECTED
    // =========================================================
    socket.on('disconnect', (reason, details) => {
      console.warn('🔥 SOCKET DISCONNECTED:', {
        reason,
        details,
      });
    });
  }

  return socket;
}

// =============================================================
// DISCONNECT SOCKET
// =============================================================
export function disconnectSocket() {
  if (socket) {
    console.log('🔌 Closing Socket.IO connection');

    socket.removeAllListeners();
    socket.disconnect();
    socket = null;
  }

  refreshingForSocket = false;
}