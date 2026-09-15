import { useRef, useId } from 'react';
import { motion } from 'motion/react';
import { useTheme } from '../lib/theme';

/**
 * Icône soleil/lune animée, SANS bouton autour.
 * Extraite d'AnimatedThemeToggler pour pouvoir être réutilisée à l'intérieur
 * d'un bouton existant (ex: l'entrée "Light/Dark Mode" du popup profil de la
 * sidebar) sans imbriquer un <button> dans un <button> ni déclencher deux
 * bascules de thème au clic.
 */
export function AnimatedThemeIcon({ size = 20 }: { size?: number }) {
  // useId doit rester ici : chaque instance a besoin d'un id de mask unique
  // (l'icône peut être montée deux fois, page Settings + popup profil).
  const rawId = useId();
  const maskId = `att${rawId.replace(/:/g, '')}`;
  const isFirst = useRef(true);
  const { resolved } = useTheme();
  const isDark = resolved === 'dark';

  // Après le premier rendu, on active les animations
  if (isFirst.current) {
    requestAnimationFrame(() => { isFirst.current = false; });
  }

  const spring = isFirst.current
    ? { duration: 0 }
    : { type: 'spring' as const, stiffness: 380, damping: 30 };

  return (
    <motion.svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      initial={false}
      animate={{ rotate: isDark ? 270 : 0 }}
      transition={spring}
      style={{ overflow: 'visible' }}
    >
      <mask id={maskId}>
        <rect x="0" y="0" width="100%" height="100%" fill="white" />
        <motion.circle
          initial={false}
          animate={{ cx: isDark ? 17 : 33, cy: isDark ? 8 : 0 }}
          transition={spring}
          r="9"
          fill="black"
        />
      </mask>

      <motion.circle
        cx="12"
        cy="12"
        fill="currentColor"
        stroke="none"
        mask={`url(#${maskId})`}
        initial={false}
        animate={{ r: isDark ? 9 : 5 }}
        transition={spring}
      />

      <motion.g
        initial={false}
        animate={{
          opacity: isDark ? 0 : 1,
          scale: isDark ? 0 : 1,
          rotate: isDark ? -30 : 0,
        }}
        transition={spring}
        style={{ transformOrigin: '12px 12px' }}
      >
        <line x1="12" y1="1" x2="12" y2="3" />
        <line x1="12" y1="21" x2="12" y2="23" />
        <line x1="1" y1="12" x2="3" y2="12" />
        <line x1="21" y1="12" x2="23" y2="12" />
        <line x1="5.64" y1="5.64" x2="4.22" y2="4.22" />
        <line x1="18.36" y1="5.64" x2="19.78" y2="4.22" />
        <line x1="5.64" y1="18.36" x2="4.22" y2="19.78" />
        <line x1="18.36" y1="18.36" x2="19.78" y2="19.78" />
      </motion.g>
    </motion.svg>
  );
}
