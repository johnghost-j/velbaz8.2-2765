import { motion } from 'motion/react';
import { useTheme } from '../lib/theme';
import { AnimatedThemeIcon } from './AnimatedThemeIcon';

export function AnimatedThemeToggler() {
  const { toggle } = useTheme();

  return (
    <motion.button
      onClick={toggle}
      whileHover={{ scale: 1.1 }}
      whileTap={{ scale: 0.86 }}
      transition={{ type: 'spring', stiffness: 400, damping: 25 }}
      style={{
        background: 'none',
        border: 'none',
        cursor: 'pointer',
        padding: 6,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        color: 'var(--text-muted)',
        borderRadius: 8,
        outline: 'none',
        WebkitTapHighlightColor: 'transparent',
      }}
      aria-label="Toggle theme"
    >
      {/* L'icône animée vit dans AnimatedThemeIcon pour être réutilisable ailleurs (popup profil) */}
      <AnimatedThemeIcon size={20} />
    </motion.button>
  );
}
