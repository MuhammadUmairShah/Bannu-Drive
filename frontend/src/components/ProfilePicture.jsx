import { useRef, useState } from 'react';
import { Camera, Loader2, Trash2 } from 'lucide-react';
import api from '../utils/api';
import { getErrorMessage } from '../utils/errors';
import { toast, confirmDialog } from '../utils/toast';
import { useAuth } from '../context/AuthContext';
import Avatar from './Avatar';

const MAX_BYTES = 3 * 1024 * 1024;
const TYPES = ['image/jpeg', 'image/png', 'image/webp'];

// Upload / replace / remove the logged-in user's profile picture (stored on Cloudinary by the backend).
export default function ProfilePicture() {
  const { user, setUser } = useAuth();
  const inputRef = useRef(null);
  const [preview, setPreview] = useState('');
  const [busy, setBusy] = useState(false);

  async function onFileChosen(event) {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;

    if (!TYPES.includes(file.type)) {
      toast.error('Please choose a JPG, PNG or WEBP image.');
      return;
    }

    if (file.size > MAX_BYTES) {
      toast.error('Image is too large. Maximum size is 3 MB.');
      return;
    }

    const localUrl = URL.createObjectURL(file);
    setPreview(localUrl);
    setBusy(true);

    try {
      const body = new FormData();
      body.append('image', file);

      const response = await api.post('/user/profile-image', body);

      if (response.data.success) {
        setUser((current) => ({ ...current, ...response.data.user }));
        toast.success('Profile picture updated.');
      } else {
        toast.error(response.data.message);
      }
    } catch (error) {
      toast.error(getErrorMessage(error, 'Could not upload the picture'));
    } finally {
      setBusy(false);
      setPreview('');
      URL.revokeObjectURL(localUrl);
    }
  }

  async function onRemove() {
    const ok = await confirmDialog({
      title: 'Remove profile picture?',
      message: 'Your picture will be deleted and replaced by your initial.',
      confirmText: 'Remove',
      danger: true
    });
    if (!ok) return;

    setBusy(true);

    try {
      const response = await api.delete('/user/profile-image');

      if (response.data.success) {
        setUser((current) => ({ ...current, ...response.data.user }));
        toast.success('Profile picture removed.');
      } else {
        toast.error(response.data.message);
      }
    } catch (error) {
      toast.error(getErrorMessage(error, 'Could not remove the picture'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex items-center gap-4">
      <div className="relative">
        <Avatar user={preview ? { ...user, profileImage: preview } : user} size="xl" />
        {busy && (
          <div className="absolute inset-0 flex items-center justify-center rounded-full bg-surface/70">
            <Loader2 className="h-6 w-6 animate-spin text-link" />
          </div>
        )}
      </div>

      <div className="space-y-2">
        <input ref={inputRef} type="file" accept="image/jpeg,image/png,image/webp" className="hidden" onChange={onFileChosen} />

        <button
          type="button"
          disabled={busy}
          onClick={() => inputRef.current?.click()}
          className="inline-flex items-center gap-2 rounded-xl bg-fg px-3 py-2 text-xs font-semibold text-bg transition-colors hover:bg-primary hover:text-on-primary disabled:opacity-60"
        >
          <Camera className="h-4 w-4" />
          {user?.profileImage ? 'Change Profile Picture' : 'Upload Profile Picture'}
        </button>

        {user?.profileImage && (
          <button
            type="button"
            disabled={busy}
            onClick={onRemove}
            className="flex items-center gap-1 text-xs font-semibold text-danger hover:text-danger disabled:opacity-60"
          >
            <Trash2 className="h-3.5 w-3.5" /> Remove picture
          </button>
        )}

        <p className="text-xs text-muted">JPG, PNG or WEBP, up to 3 MB.</p>
      </div>
    </div>
  );
}
