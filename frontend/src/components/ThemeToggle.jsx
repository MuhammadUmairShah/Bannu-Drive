import { Moon, Sun } from 'lucide-react';
import { useTheme } from '../context/ThemeContext';

// Sun/moon switch. Drop it in any topbar:  <ThemeToggle />
//   variant="onDark" for bars that are always dark (public navbar over the hero).
export default function ThemeToggle({ variant = 'default', className = '' }) {
  const { isDark, toggleTheme } = useTheme();
  const onDark = variant === 'onDark';

  return (
    <button
      type="button"
      role="switch"
      aria-checked={isDark}
      aria-label={isDark ? 'Switch to light theme' : 'Switch to dark theme'}
      title={isDark ? 'Light theme' : 'Dark theme'}
      onClick={toggleTheme}
      className={`group relative inline-flex h-9 w-[4.25rem] shrink-0 items-center rounded-full border p-1 transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary ${
        onDark
          ? 'border-white/20 bg-white/10 hover:bg-white/15'
          : 'border-line-strong bg-surface-2 hover:border-primary/60'
      } ${className}`}
    >
      <Sun
        className={`absolute left-2.5 h-4 w-4 transition-opacity ${isDark ? 'opacity-50' : 'opacity-0'} ${onDark ? 'text-white' : 'text-muted'}`}
        aria-hidden="true"
      />
      <Moon
        className={`absolute right-2.5 h-4 w-4 transition-opacity ${isDark ? 'opacity-0' : 'opacity-50'} ${onDark ? 'text-white' : 'text-muted'}`}
        aria-hidden="true"
      />
      <span
        className={`flex h-7 w-7 items-center justify-center rounded-full bg-primary text-on-primary shadow-md transition-transform duration-300 ease-out ${
          isDark ? 'translate-x-[2rem]' : 'translate-x-0'
        }`}
      >
        {isDark ? <Moon className="h-4 w-4" aria-hidden="true" /> : <Sun className="h-4 w-4" aria-hidden="true" />}
      </span>
    </button>
  );
}
