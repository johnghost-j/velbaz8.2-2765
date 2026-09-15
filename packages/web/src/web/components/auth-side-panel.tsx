import { useState } from 'react';

/**
 * Panneau image latéral des pages connexion / inscription.
 * Remplit toute la hauteur de son conteneur. Affiche l'image `src`
 * (déposée dans packages/web/public/images/) en plein cadre.
 * Tant qu'aucune image n'est fournie (404), un placeholder discret s'affiche.
 */
export default function AuthSidePanel({ src, label }: { src: string; label: string }) {
  const [failed, setFailed] = useState(false);

  return (
    <div
      className="relative w-full h-full min-h-[480px] overflow-hidden rounded-xl"
      style={{
        background: 'var(--surface-3)',
        border: '1px dashed var(--border-default)',
      }}
    >
      {!failed && (
        <img
          src={src}
          alt={label}
          onError={() => setFailed(true)}
          className="absolute inset-0 w-full h-full object-cover"
        />
      )}
      {failed && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-2.5 px-6 text-center">
          <svg
            width="28"
            height="28"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
            style={{ color: 'var(--text-ghost)' }}
          >
            <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
            <circle cx="8.5" cy="8.5" r="1.5" />
            <polyline points="21 15 16 10 5 21" />
          </svg>
          <span className="text-[11px] leading-relaxed" style={{ color: 'var(--text-ghost)' }}>
            {label}
          </span>
        </div>
      )}
    </div>
  );
}
