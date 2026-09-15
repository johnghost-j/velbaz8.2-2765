import { useEffect, useSyncExternalStore } from 'react';
import { createPortal } from 'react-dom';
import { useLocation } from 'wouter';
import { useAuth } from '../lib/auth';
import {
  getCreditsPopupDismissed,
  setCreditsPopupDismissed,
  subscribeCreditsPopup,
} from '../lib/credits-popup';

/**
 * Pop-up « crédits épuisés ».
 *
 * Deux rendus pour un seul et même contenu :
 *  - variant="inline"  → carte ancrée juste AU-DESSUS de la barre de prompt (page /chat)
 *  - variant="center"  → modale centrée au milieu de la page (page d'accueil)
 *
 * Règle de réapparition demandée : une fois fermée, la pop-up ne revient plus…
 * SAUF si l'utilisateur regagne des crédits (solde > 0) puis les épuise à
 * nouveau. Ce réarmement est déclenché depuis le store d'auth (lib/auth.ts),
 * donc il marche même si aucune des deux instances n'est montée à ce moment-là.
 */

/** Vrai quand l'utilisateur est connecté et que son solde de crédits est à zéro. */
export function useCreditsEmpty() {
  const { user, loading } = useAuth();
  const tokens = user?.tokens ?? 0;
  const isEmpty = !!user && !loading && tokens <= 0;

  const isDismissed = useSyncExternalStore(
    subscribeCreditsPopup,
    getCreditsPopupDismissed,
    () => false,
  );

  const show = isEmpty && !isDismissed;

  return { show, dismiss: () => setCreditsPopupDismissed(true) };
}

function CloseButton({ onClose }: { onClose: () => void }) {
  return (
    <button
      type="button"
      onClick={onClose}
      aria-label="Close"
      data-testid="credits-empty-close"
      className="absolute top-2 right-2 w-6 h-6 rounded-md flex items-center justify-center transition-colors"
      style={{ background: 'transparent', border: '1px solid var(--border-subtle)', color: 'var(--text-secondary)', cursor: 'pointer', pointerEvents: 'auto', zIndex: 2 }}
      onMouseEnter={e => { e.currentTarget.style.background = 'var(--surface-3)'; }}
      onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; }}
    >
      <svg width="10" height="10" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" style={{ pointerEvents: 'none' }}>
        <path d="M2.5 2.5L9.5 9.5M9.5 2.5L2.5 9.5" />
      </svg>
    </button>
  );
}

/**
 * Vignette arrondie : l'illustration est un PNG détouré (fond transparent), on
 * la pose donc dans un badge arrondi discret pour qu'elle ne flotte pas nue sur
 * le fond de la carte.
 */
function Illustration({ size }: { size: number }) {
  return (
    <div
      data-testid="credits-empty-thumb"
      style={{
        width: size,
        height: size,
        flexShrink: 0,
        boxSizing: 'border-box',
        padding: Math.round(size * 0.13),
        borderRadius: Math.round(size * 0.3),
        background: 'var(--surface-3)',
        border: '1px solid var(--border-subtle)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        overflow: 'hidden',
        pointerEvents: 'none',
      }}
    >
      <img
        src="/images/credits-empty.png"
        alt=""
        draggable={false}
        data-testid="credits-empty-image"
        style={{ width: '100%', height: '100%', objectFit: 'contain', userSelect: 'none', pointerEvents: 'none' }}
      />
    </div>
  );
}

function Actions({ onClose, onBuy, compact }: { onClose: () => void; onBuy: () => void; compact?: boolean }) {
  const h = compact ? 'h-7 px-3 text-[11.5px]' : 'h-8 px-4 text-[12px]';
  return (
    <div
      className={`flex items-center gap-2 ${compact ? 'mt-2' : 'mt-4'}`}
      style={{ pointerEvents: 'auto', position: 'relative', zIndex: 2 }}
    >
      <button
        type="button"
        onClick={onBuy}
        data-testid="credits-empty-buy"
        className={`${h} rounded-lg font-medium transition-opacity`}
        style={{ background: 'var(--btn-primary-bg)', color: 'var(--btn-primary-fg)', border: 'none', cursor: 'pointer', pointerEvents: 'auto' }}
        onMouseEnter={e => { e.currentTarget.style.opacity = '0.85'; }}
        onMouseLeave={e => { e.currentTarget.style.opacity = '1'; }}
      >
        Get credits
      </button>
      <button
        type="button"
        onClick={onClose}
        data-testid="credits-empty-later"
        className={`${h} rounded-lg font-medium transition-colors`}
        style={{ background: 'var(--surface-4)', color: 'var(--text-dim)', border: '1px solid var(--border-default)', cursor: 'pointer', pointerEvents: 'auto' }}
        onMouseEnter={e => { e.currentTarget.style.color = 'var(--text-secondary)'; }}
        onMouseLeave={e => { e.currentTarget.style.color = 'var(--text-dim)'; }}
      >
        Not now
      </button>
    </div>
  );
}

/**
 * Variante chat : disposition en LIGNE (vignette à gauche, texte et boutons à
 * droite). Empilée verticalement la carte mangeait presque toute la hauteur
 * au-dessus de la barre de prompt ; en ligne elle tient sur ~92 px.
 */
function BodyInline({ onClose, onBuy }: { onClose: () => void; onBuy: () => void }) {
  return (
    <>
      <CloseButton onClose={onClose} />
      <div className="flex items-center gap-3 pl-3 pr-9 py-3">
        <Illustration size={56} />
        <div className="min-w-0 flex-1">
          <h3 className="text-[13px] font-semibold tracking-tight" style={{ color: 'var(--text-primary)' }}>
            You're out of credits
          </h3>
          <p className="text-[11.5px] mt-0.5 leading-snug" style={{ color: 'var(--text-dim)' }}>
            Top up to keep building — your projects stay where you left them.
          </p>
          <Actions onClose={onClose} onBuy={onBuy} compact />
        </div>
      </div>
    </>
  );
}

function BodyCenter({ onClose, onBuy }: { onClose: () => void; onBuy: () => void }) {
  return (
    <>
      <CloseButton onClose={onClose} />
      <div className="flex flex-col items-center text-center px-8 py-8">
        <Illustration size={150} />
        <h3 className="text-[18px] mt-3 font-semibold tracking-tight" style={{ color: 'var(--text-primary)' }}>
          You're out of credits
        </h3>
        <p className="text-[13px] max-w-[340px] mt-1.5 leading-relaxed" style={{ color: 'var(--text-dim)' }}>
          Your credit balance has reached zero. Top up to keep building — your projects stay exactly where you left them.
        </p>
        <Actions onClose={onClose} onBuy={onBuy} />
      </div>
    </>
  );
}

export function CreditsEmptyPopup({ variant }: { variant: 'inline' | 'center' }) {
  const { show, dismiss } = useCreditsEmpty();
  const [, navigate] = useLocation();

  // Échap ferme la modale centrée.
  useEffect(() => {
    if (!show || variant !== 'center') return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') dismiss(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [show, variant, dismiss]);

  if (!show) return null;

  const goBuy = () => { dismiss(); navigate('/plans'); };

  if (variant === 'inline') {
    return (
      <div
        data-testid="credits-empty-popup"
        className="relative mb-3 rounded-xl overflow-hidden question-popup-enter"
        style={{
          background: 'var(--surface-2)',
          border: '1px solid var(--border-default)',
          boxShadow: '0 -4px 24px rgba(0,0,0,0.15)',
          zIndex: 40,
          pointerEvents: 'auto',
        }}
      >
        <BodyInline onClose={dismiss} onBuy={goBuy} />
      </div>
    );
  }

  // Modale centrée : rendue dans <body> via un portail, au-dessus de tout le
  // reste de l'app (certains panneaux de la page d'accueil montent très haut
  // en z-index et interceptaient les clics de la pop-up).
  const overlay = (
    <div
      data-testid="credits-empty-overlay"
      className="fixed inset-0 flex items-center justify-center px-5"
      style={{ background: 'rgba(0,0,0,0.45)', backdropFilter: 'blur(3px)', zIndex: 2147483000, pointerEvents: 'auto' }}
      onMouseDown={e => { if (e.target === e.currentTarget) dismiss(); }}
    >
      <div
        data-testid="credits-empty-popup"
        className="relative rounded-2xl overflow-hidden question-popup-enter w-full"
        style={{
          maxWidth: 400,
          background: 'var(--surface-2)',
          border: '1px solid var(--border-default)',
          boxShadow: '0 24px 60px rgba(0,0,0,0.35)',
          pointerEvents: 'auto',
        }}
      >
        <BodyCenter onClose={dismiss} onBuy={goBuy} />
      </div>
    </div>
  );

  return typeof document !== 'undefined' ? createPortal(overlay, document.body) : overlay;
}
