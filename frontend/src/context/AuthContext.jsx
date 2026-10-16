import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import api, { SESSION_ENDED_EVENT } from '../utils/api';
import { toast } from '../utils/toast';

const AuthContext = createContext(null);

// A small hint saved in this browser: "this person has logged in here before".
// It is NOT used for security (the server cookies decide that). It only tells us whether it is worth asking the
// server "who am I?" on page load. A first-time visitor on a public page makes no request, so no 401 in the console.
const HINT_KEY = 'bd:hasSession';
const readHint = () => {
  try { return localStorage.getItem(HINT_KEY) === '1'; } catch { return false; }
};
const writeHint = (on) => {
  try { on ? localStorage.setItem(HINT_KEY, '1') : localStorage.removeItem(HINT_KEY); } catch { /* storage blocked */ }
};

export function AuthProvider({ children }) {
  const [user, setUserState] = useState(null);
  // true until the first session check finishes, so a logged-in person never sees a flash of the login page
  const [loading, setLoading] = useState(true);
  const userRef = useRef(null);
  userRef.current = user;

  // Same as a normal setState (value or updater function), and keeps the hint in sync with the login state
  const setUser = useCallback((next) => {
    if (typeof next === 'function') {
      setUserState((prev) => {
        const value = next(prev);
        writeHint(Boolean(value));
        return value;
      });
    } else {
      setUserState(next);
      writeHint(Boolean(next));
    }
  }, []);

  // Restores the login from the refresh cookie if needed (the API client refreshes + retries on 401 by itself)
  const refreshUser = useCallback(async () => {
    try {
      const response = await api.get('/user/profile');
      setUser(response.data.success ? response.data.user : null);
    } catch {
      setUser(null);
    } finally {
      setLoading(false);
    }
  }, [setUser]);

  useEffect(() => {
    // Never logged in on this browser (or logged out): nothing to restore, skip the request
    if (readHint()) refreshUser();
    else setLoading(false);
  }, [refreshUser]);

  // Login can no longer be restored (refresh token expired, revoked, account blocked...)
  useEffect(() => {
    const onEnded = () => {
      if (userRef.current) toast.error('Your session has ended. Please sign in again.');
      setUser(null);
      setLoading(false);
    };
    window.addEventListener(SESSION_ENDED_EVENT, onEnded);
    return () => window.removeEventListener(SESSION_ENDED_EVENT, onEnded);
  }, [setUser]);

  async function logout() {
    try {
      await api.post('/user/logout');
    } catch (error) {
      console.log(error);
    } finally {
      setUser(null);
    }
  }

  async function logoutEverywhere() {
    try {
      await api.post('/user/logout-all');
    } finally {
      setUser(null);
    }
  }

  const value = { user, setUser, loading, refreshUser, logout, logoutEverywhere };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  return useContext(AuthContext);
}