import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';

// Light is the default for first-time visitors (we deliberately do NOT follow the OS setting).
const STORAGE_KEY = 'bd-theme';
const THEMES = ['light', 'dark'];

function readStored() {
  try {
    const value = localStorage.getItem(STORAGE_KEY);
    return THEMES.includes(value) ? value : 'light';
  } catch {
    return 'light';
  }
}

// Runs when this module is first imported, i.e. before React renders, so a returning
// dark-mode user never sees a flash of the light theme.
if (typeof document !== 'undefined') {
  document.documentElement.dataset.theme = readStored();
}

const ThemeContext = createContext({
  theme: 'light',
  isDark: false,
  setTheme: () => {},
  toggleTheme: () => {}
});

export function ThemeProvider({ children }) {
  const [theme, setThemeState] = useState(readStored);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    try {
      localStorage.setItem(STORAGE_KEY, theme);
    } catch {
      // storage unavailable (private mode) - theme still works for this session
    }
  }, [theme]);

  // Keep several open tabs in sync
  useEffect(() => {
    function onStorage(event) {
      if (event.key === STORAGE_KEY && THEMES.includes(event.newValue)) setThemeState(event.newValue);
    }
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, []);

  const setTheme = useCallback((next) => {
    if (THEMES.includes(next)) setThemeState(next);
  }, []);
  const toggleTheme = useCallback(() => setThemeState((t) => (t === 'dark' ? 'light' : 'dark')), []);

  const value = useMemo(
    () => ({ theme, isDark: theme === 'dark', setTheme, toggleTheme }),
    [theme, setTheme, toggleTheme]
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme() {
  return useContext(ThemeContext);
}
