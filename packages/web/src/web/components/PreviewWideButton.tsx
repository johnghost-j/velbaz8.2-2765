// ─── Flèche « la preview prend toute la largeur du chat » ────────────────────
//
// [2026-09-10] Demande utilisateur : « la flèche en haut permet que la preview
// prenne le scale de l'axe X de tout le chat, et la flèche change de direction
// pour que quand je réappuie ça remette comme avant ».
//
// Un seul bouton, une seule icône : elle pivote de 180° selon l'état, donc la
// flèche « change de direction » avec une transition douce.

interface Props {
  /** true = la preview occupe déjà toute la largeur. */
  wide: boolean;
  onClick: () => void;
}

export default function PreviewWideButton({ wide, onClick }: Props) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="preview-wide-btn"
      title={wide ? 'Réduire la preview' : 'Élargir la preview sur tout le chat'}
      aria-label={wide ? 'Réduire la preview' : 'Élargir la preview sur tout le chat'}
    >
      <svg
        width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor"
        strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
        style={{ transform: wide ? 'rotate(180deg)' : 'none', transition: 'transform 0.28s cubic-bezier(0.22, 1, 0.36, 1)' }}
      >
        <polyline points="11 17 6 12 11 7" />
        <polyline points="18 17 13 12 18 7" />
      </svg>
    </button>
  );
}
