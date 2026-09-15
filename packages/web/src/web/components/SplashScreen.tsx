import { useEffect, useState } from 'react';

export function SplashScreen() {
  const [visible, setVisible] = useState(true);
  const [fading, setFading] = useState(false);

  useEffect(() => {
    const timer = setTimeout(() => {
      setFading(true);
      setTimeout(() => setVisible(false), 300);
    }, 900);
    return () => clearTimeout(timer);
  }, []);

  if (!visible) return null;

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 9999,
        background: 'var(--surface-0)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        opacity: fading ? 0 : 1,
        transition: 'opacity 0.3s ease',
        pointerEvents: fading ? 'none' : 'all',
      }}
    >
      <span
        style={{
          fontSize: 28,
          fontWeight: 600,
          letterSpacing: '-0.03em',
          color: 'var(--text-primary)',
          opacity: fading ? 0 : 1,
          transition: 'opacity 0.3s ease',
        }}
      >
        velbaz
      </span>
    </div>
  );
}
