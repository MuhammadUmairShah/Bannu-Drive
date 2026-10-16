import axios from 'axios';

const api = axios.create({
  baseURL: import.meta.env.VITE_API_URL,
  withCredentials: true
});

// Fired when the login can no longer be restored (refresh token expired/revoked). AuthContext listens and
// clears the user, so ProtectedRoute sends the person to /login without a full page reload.
export const SESSION_ENDED_EVENT = 'bd:session-ended';

// A driver's booking changed (accepted / started / completed / cancelled).
// The driver layout listens to this to start / stop GPS sharing without every page wiring it up.
export const JOB_CHANGED_EVENT = 'safarx:job-changed';
const JOB_URL = /^\/(ride|delivery)\/(accept|start|complete|cancel)\//;

// Endpoints that must never trigger a silent refresh
const NO_REFRESH = ['/user/login', '/user/registration', '/user/google', '/user/refresh', '/user/logout', '/user/forgot-password', '/user/reset-password'];
const REFRESHABLE_CODES = ['AUTH_REQUIRED', 'AUTH_EXPIRED'];

// ---- single-flight refresh: ten parallel requests that all hit an expired access cookie share ONE refresh ----
let refreshing = null;

export function refreshSession() {
  if (!refreshing) {
    refreshing = api
      .post('/user/refresh')
      .then((res) => res.data)
      .finally(() => {
        // keep the resolved promise for a moment so late arrivals reuse it instead of rotating again
        setTimeout(() => { refreshing = null; }, 1000);
      });
  }
  return refreshing;
}

api.interceptors.response.use(
  (response) => {
    if (JOB_URL.test(response.config?.url || '')) {
      window.dispatchEvent(new Event(JOB_CHANGED_EVENT));
    }
    return response;
  },
  async (error) => {
    const { response, config } = error;
    const url = config?.url || '';
    const code = response?.data?.code;

    const canRefresh =
      response?.status === 401 &&
      REFRESHABLE_CODES.includes(code) &&
      !config?._retried &&
      !NO_REFRESH.some((p) => url.startsWith(p));

    if (canRefresh) {
      try {
        await refreshSession();
        config._retried = true;
        return api(config); // replay the original request with the fresh cookie
      } catch (refreshError) {
        // Only a definite "your login is over" answer ends the session; a network blip must not log anyone out
        if (refreshError.response?.status === 401) {
          window.dispatchEvent(new Event(SESSION_ENDED_EVENT));
        }
        return Promise.reject(error);
      }
    }

    // Any other 401 on a private call: the session ended for a reason that cannot be refreshed (e.g. blocked)
    if (response?.status === 401 && ['SESSION_ENDED', 'AUTH_INVALID'].includes(code) && !NO_REFRESH.some((p) => url.startsWith(p))) {
      window.dispatchEvent(new Event(SESSION_ENDED_EVENT));
    }

    return Promise.reject(error);
  }
);

export default api;
