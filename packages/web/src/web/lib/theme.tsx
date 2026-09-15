import { createContext, useContext, useEffect, useState, useCallback } from 'react';

type Theme = 'light' | 'dark' | 'system';
type ResolvedTheme = 'light' | 'dark';

interface ThemeCtx {
  theme: Theme;
  resolved: ResolvedTheme;
  setTheme: (t: Theme) => void;
  toggle: () => void;
}

const ThemeContext = createContext<ThemeCtx>({
  theme: 'dark',
  resolved: 'dark',
  setTheme: () => {},
  toggle: () => {},
});

function getSystemTheme(): ResolvedTheme {
  if (typeof window === 'undefined') return 'dark';
  return window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
}

function resolve(theme: Theme): ResolvedTheme {
  return theme === 'system' ? getSystemTheme() : theme;
}

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [theme, setThemeState] = useState<Theme>(() => {
    if (typeof window === 'undefined') return 'dark';
    const saved = localStorage.getItem('velbaz-theme') as Theme | null;
    // Never auto-follow the OS: default is dark, only an explicit user
    // choice (stored in localStorage) can switch to light.
    return saved === 'light' || saved === 'dark' ? saved : 'dark';
  });
  const [resolved, setResolved] = useState<ResolvedTheme>(() => resolve(theme));

  const apply = useCallback((t: Theme) => {
    const r = resolve(t);
    setResolved(r);
    // Disable all transitions instantly during theme switch
    const style = document.createElement('style');
    style.textContent = '*, *::before, *::after { transition: none !important; }';
    document.head.appendChild(style);
    document.documentElement.setAttribute('data-theme', r);
    document.documentElement.classList.toggle('light', r === 'light');
    document.documentElement.classList.toggle('dark', r === 'dark');
    // Re-enable transitions on next frame
    requestAnimationFrame(() => document.head.removeChild(style));
  }, []);

  const setTheme = useCallback((t: Theme) => {
    setThemeState(t);
    localStorage.setItem('velbaz-theme', t);
    apply(t);
  }, [apply]);

  const toggle = useCallback(() => {
    const next = resolved === 'dark' ? 'light' : 'dark';
    setTheme(next);
  }, [resolved, setTheme]);

  // Apply on mount
  useEffect(() => {
    apply(theme);
  }, []);

  return (
    <ThemeContext.Provider value={{ theme, resolved, setTheme, toggle }}>
      {children}
    </ThemeContext.Provider>
  );
}

export const useTheme = () => useContext(ThemeContext);
