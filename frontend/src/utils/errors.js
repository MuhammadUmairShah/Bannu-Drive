// Turns any axios error into a short message the user can act on.
export function getErrorMessage(error, fallback = 'Something went wrong') {
  if (!error) return fallback;

  if (error.code === 'ERR_NETWORK' || (!error.response && error.request)) {
    return 'Cannot reach the server. Check your connection and that the backend is running.';
  }

  const status = error.response?.status;
  const serverMessage = error.response?.data?.message;

  if (serverMessage) return serverMessage;

  if (status === 401) return 'Your session has expired. Please log in again.';
  if (status === 403) return 'You do not have permission to do that.';
  if (status === 404) return 'The requested item was not found.';
  if (status === 409) return 'This action conflicts with the current state. Refresh and try again.';
  if (status >= 500) return 'The server had a problem. Please try again shortly.';

  return fallback;
}
