import React from 'react';

/**
 * Bouton flottant d'ouverture du panneau latéral (à droite).
 * Style clair (pas de bleu) : carré arrondi sur fond de surface, icône « panneau »
 * noire avec la barre verticale qui glisse quand le panneau s'ouvre.
 */
export function PanelToggleButton({
  open,
  onClick,
  style,
}: {
  open: boolean;
  onClick: () => void;
  style?: React.CSSProperties;
}) {
  return (
    <button
      onClick={onClick}
      title={open ? 'Fermer le panneau' : 'Ouvrir le panneau'}
      className="active:scale-90"
      style={{
        // [2026-09-15] 36 -> 42 px : aligné sur les autres commandes du chat,
        // qui ont toutes été agrandies pour être plus faciles à viser.
        width: 42,
        height: 42,
        borderRadius: 13,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: 'var(--surface-1)',
        border: '1px solid var(--border-subtle)',
        color: 'var(--text-primary)',
        cursor: 'pointer',
        boxShadow: 'none',
        ...style,
      }}
      onMouseEnter={e => { e.currentTarget.style.background = 'var(--surface-3)'; }}
      onMouseLeave={e => { e.currentTarget.style.background = 'var(--surface-1)'; }}
    >
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
        <rect x="3.5" y="4.5" width="17" height="15" rx="3.5" />
        <line
          x1="15.5" y1="7.5" x2="15.5" y2="16.5"
          style={{
            transition: 'transform 0.34s cubic-bezier(0.22,1,0.36,1)',
            transform: open ? 'translateX(-7px)' : 'none',
          }}
        />
      </svg>
    </button>
  );
}

export default PanelToggleButton;
