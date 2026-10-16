import { useEffect, useRef, useState } from 'react';
import api from '../utils/api';
import { getErrorMessage } from '../utils/errors';
import { toast } from '../utils/toast';

const CLIENT_ID = import.meta.env.VITE_GOOGLE_CLIENT_ID;
const GSI_SRC = 'https://accounts.google.com/gsi/client';

let scriptPromise = null;
function loadGoogleScript() {
  if (window.google?.accounts?.id) return Promise.resolve();
  if (!scriptPromise) {
    scriptPromise = new Promise((resolve, reject) => {
      const el = document.createElement('script');
      el.src = GSI_SRC;
      el.async = true;
      el.defer = true;
      el.onload = resolve;
      el.onerror = () => { scriptPromise = null; reject(new Error('Google script failed to load')); };
      document.head.appendChild(el);
    });
  }
  return scriptPromise;
}

// Official "Continue with Google" button (Google Identity Services).
// Google gives the browser a signed ID token; we send ONLY that token to our backend, which verifies it
// with Google. Nothing the browser says about the profile is trusted, and no secret lives in the frontend.
export default function GoogleSignInButton({ onSuccess, remember = true, text = 'continue_with' }) {
  const holder = useRef(null);
  const rememberRef = useRef(remember);
  const onSuccessRef = useRef(onSuccess);
  const [failed, setFailed] = useState(false);
  rememberRef.current = remember;
  onSuccessRef.current = onSuccess;

  useEffect(() => {
    if (!CLIENT_ID) return undefined;
    let cancelled = false;

    loadGoogleScript()
      .then(() => {
        if (cancelled || !holder.current) return;

        window.google.accounts.id.initialize({
          client_id: CLIENT_ID,
          ux_mode: 'popup',
          callback: async ({ credential }) => {
            try {
              const response = await api.post('/user/google', { credential, remember: rememberRef.current });
              if (response.data.created) toast.success('Welcome! Your customer account was created with Google.');
              onSuccessRef.current?.(response.data);
            } catch (error) {
              toast.error(getErrorMessage(error, 'Google sign-in failed. Please try again.'));
            }
          }
        });

        window.google.accounts.id.renderButton(holder.current, {
          type: 'standard',
          theme: 'outline',
          size: 'large',
          shape: 'pill',
          text,
          logo_alignment: 'left',
          width: Math.min(400, Math.max(200, holder.current.offsetWidth || 320))
        });
      })
      .catch(() => !cancelled && setFailed(true));

    return () => { cancelled = true; };
  }, [text]);

  if (!CLIENT_ID) return null; // not configured: the page simply has no Google button

  return (
    <div className="w-full">
      <div ref={holder} className="flex min-h-[44px] w-full justify-center" />
      {failed && <p className="mt-2 text-center text-xs text-muted">Google sign-in is unavailable right now. Use your email and password.</p>}
    </div>
  );
}

export const googleEnabled = Boolean(CLIENT_ID);
