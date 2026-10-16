import { io } from 'socket.io-client';
import { refreshSession } from './api';

// One shared Socket.IO connection.
let socket = null;
let refreshingForSocket = false;

export function getSocket() {
  if (!socket) {
    socket = io(import.meta.env.VITE_API_URL, {
      withCredentials: true,

      // IMPORTANT:
      // Vercel was successfully answering the initial polling request,
      // but subsequent polling requests were returning 400.
      // Use WebSocket directly instead of Engine.IO polling.
      transports: ['websocket'],

      autoConnect: false,

      reconnection: true,
      reconnectionAttempts: Infinity,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 10000,

      timeout: 10000,
    });

    // Connection established
    socket.on('connect', () => {
      console.log('Socket.IO connected:', socket.id);
    });

    // Connection error
    socket.on('connect_error', async (err) => {
      console.warn(
        'Socket.IO connection error:',
        err?.message,
        err?.data
      );

      const code = err?.data?.code;

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
          'Socket session refresh failed:',
          error?.message
        );
      } finally {
        setTimeout(() => {
          refreshingForSocket = false;
        }, 3000);
      }
    });

    socket.on('disconnect', (reason) => {
      console.log(
        'Socket.IO disconnected:',
        reason
      );
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