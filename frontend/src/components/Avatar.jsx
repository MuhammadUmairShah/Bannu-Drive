import { useState } from 'react';

// Real profile picture when available, clean initials fallback otherwise.
export default function Avatar({ user, size = 'md', className = '' }) {
  const [failed, setFailed] = useState(false);

  const sizes = {
    xs: 'h-7 w-7 text-xs',
    sm: 'h-9 w-9 text-sm',
    md: 'h-11 w-11 text-base',
    lg: 'h-20 w-20 text-2xl',
    xl: 'h-28 w-28 text-4xl'
  };

  const name = user?.name || '';
  const initial = name.trim() ? name.trim().charAt(0).toUpperCase() : '?';
  const src = user?.profileImage;

  if (src && !failed) {
    return (
      <img
        src={src}
        alt={name || 'Profile'}
        onError={() => setFailed(true)}
        className={`${sizes[size]} shrink-0 rounded-full border border-line-strong object-cover ${className}`}
      />
    );
  }

  return (
    <div
      aria-label={name || 'Profile'}
      className={`${sizes[size]} flex shrink-0 items-center justify-center rounded-full border border-primary/30 bg-primary-soft font-display font-bold text-link ${className}`}
    >
      {initial}
    </div>
  );
}
