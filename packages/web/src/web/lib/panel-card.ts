// Style commun des « cartes » du panneau Context (home + chat).
// Le panneau n'est plus un seul grand rectangle : chaque section est une carte
// arrondie séparée, sans ombre portée.
import type { CSSProperties } from 'react';

export const PANEL_CARD: CSSProperties = {
  background: 'var(--surface-2)',
  border: '1px solid var(--border-subtle)',
  borderRadius: 14,
  padding: '12px 14px',
  flexShrink: 0,
};
