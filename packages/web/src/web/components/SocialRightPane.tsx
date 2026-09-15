/**
 * SocialRightPane — le panneau à droite de la ligne verticale.
 *
 * - Aucun réseau sélectionné → petit texte d'invite.
 * - Réseau sélectionné mais PAS connecté → titre en haut + bouton de connexion.
 * - X (Twitter) connecté → le vrai site X, DANS l'app (XLiveViewer).
 * - Autre réseau connecté → état connecté (le live arrive après X).
 *
 * Purement additif : aucun composant existant n'est supprimé.
 */

import { useEffect, useState } from 'react';
import { XLiveViewer } from './XLiveViewer';
import { AiCommsPanel } from './AiCommsPanel';
import { XCloneLogin } from './XCloneLogin';
import { XCloneApp } from './XCloneApp';

/** Bouton « Communications IA » au-dessus de la vue réseau. */
const SOCIAL_AI_COMMS = true;

/**
 * X Live (Chrome piloté côté serveur) — mis EN VEILLE.
 * false → écran de connexion maison puis fil 3 colonnes intégré.
 * true  → ancien comportement (XLiveViewer), conservé intact plus bas.
 */
const X_LIVE_ACTIVE = false;

/**
 * true → quand un réseau est choisi, on n'affiche QUE « Communications IA »,
 * pour TOUS les réseaux. Plus d'app Twitter intégrée (XCloneLogin/XCloneApp),
 * plus de X en direct (XLiveViewer), plus de bouton de connexion OAuth, et
 * plus de barre de bascule (il n'y a plus qu'une seule vue).
 * false → ancien comportement complet, conservé intact plus bas.
 */
const SOCIAL_ONLY_AI_COMMS = true;

export interface PanedPlatform {
  id: string;
  name: string;
  desc: string;
  color: string;
  darkColor: string;
  icon: React.ReactNode;
}

interface Props {
  platform: PanedPlatform | null;
  companyId: string;
  isConnected: boolean;
  isConnecting: boolean;
  error?: string;
  /** Connexion classique (OAuth) pour les réseaux autres que X. */
  onConnect: () => void;
  /** Pseudo renvoyé par la plateforme, quand la connexion est réelle. */
  username?: string | null;
  /** true = connexion simulée (aucune clé API configurée). */
  isDemo?: boolean;
  /** Délie le réseau. Absent = barre de statut masquée. */
  onDisconnect?: () => void;
  /** true = déconnexion en cours. */
  isDisconnecting?: boolean;
  /**
   * [2026-09-13] Barre de prompte, rendue DANS ce panneau, sous le fil des
   * messages. Avant, elle était rendue en dehors, sous la colonne de logos ET
   * le panneau : elle dépassait donc du rectangle des messages. En la passant
   * ici, elle est bornée par la même colonne que le fil.
   */
  footer?: React.ReactNode;
}

export function SocialRightPane({
  platform, companyId, isConnected, isConnecting, error, onConnect,
  username, isDemo, onDisconnect, isDisconnecting, footer,
}: Props) {
  const [xProfile, setXProfile] = useState<boolean | null>(null);
  const [xOpen, setXOpen] = useState(false);
  /** Vue affichée : le réseau en direct, ou ce que l'IA a envoyé. */
  const [view, setView] = useState<'live' | 'comms'>('live');
  /** Identité saisie sur l'écran de connexion intégré (null = pas encore connecté). */
  const [identity, setIdentity] = useState<string | null>(null);

  const isX = platform?.id === 'twitter';

  // X : le profil Chrome garde la session → on sait s'il est déjà connecté.
  useEffect(() => {
    if (SOCIAL_ONLY_AI_COMMS) return;
    if (!isX || !companyId) return;
    let cancelled = false;
    fetch(`/api/x-live/status?companyId=${encodeURIComponent(companyId)}`)
      .then(r => r.json())
      .then((d: any) => { if (!cancelled) setXProfile(!!d.hasProfile); })
      .catch(() => { if (!cancelled) setXProfile(false); });
    return () => { cancelled = true; };
  }, [isX, companyId]);

  useEffect(() => { setXOpen(false); }, [platform?.id]);

  if (!platform) {
    return (
      <div className="h-full min-w-0 flex flex-col">
        <div className="flex-1 min-h-0 flex items-center justify-center px-6 text-center">
          <p className="text-[11px]" style={{ color: 'var(--text-ghost)' }}>
            Choisis un réseau à gauche
          </p>
        </div>
        {footer ? <div className="shrink-0 min-w-0">{footer}</div> : null}
      </div>
    );
  }

  // ─── Barre de statut de connexion ─────────────────────────────────────────
  // [2026-09-11] Toujours visible au-dessus de la vue du réseau : elle dit si
  // le compte est réellement lié et permet de se connecter OU de se déconnecter
  // sans quitter l'écran. Avant, `SOCIAL_ONLY_AI_COMMS` masquait tout contrôle :
  // une fois un réseau choisi, on était coincé dedans.
  const statusBar = onDisconnect ? (
    <div
      className="flex items-center gap-2 px-3 py-2 shrink-0"
      style={{ borderBottom: '1px solid var(--border-subtle)' }}
    >
      <span style={{ color: platform.darkColor }}>{platform.icon}</span>
      <div className="min-w-0 flex-1">
        <div className="text-[11px] font-medium truncate" style={{ color: 'var(--text-primary)' }}>
          {platform.name}
        </div>
        <div className="text-[10px] truncate" style={{ color: isConnected ? '#10b981' : 'var(--text-ghost)' }}>
          {isConnected
            ? (isDemo
              ? 'Connexion simulée (démo) — aucune clé API'
              : `Connecté${username ? ` — @${username}` : ''}`)
            : 'Non connecté'}
        </div>
      </div>
      {isConnected ? (
        <button
          onClick={onDisconnect}
          disabled={isDisconnecting}
          className="text-[10px] font-medium px-2.5 py-1.5 rounded-lg transition-all shrink-0"
          style={{
            background: 'rgba(239,68,68,0.1)',
            color: '#ef4444',
            border: '1px solid rgba(239,68,68,0.25)',
            cursor: isDisconnecting ? 'default' : 'pointer',
            opacity: isDisconnecting ? 0.6 : 1,
          }}
        >
          {isDisconnecting ? 'Déconnexion…' : 'Déconnecter'}
        </button>
      ) : (
        <button
          onClick={onConnect}
          disabled={isConnecting}
          className="text-[10px] font-medium px-2.5 py-1.5 rounded-lg transition-all shrink-0"
          style={{
            background: isConnecting ? 'var(--surface-4)' : 'var(--btn-primary-bg)',
            color: isConnecting ? 'var(--text-ghost)' : 'var(--btn-primary-fg)',
            cursor: isConnecting ? 'default' : 'pointer',
          }}
        >
          {isConnecting ? 'Connexion…' : 'Se connecter'}
        </button>
      )}
    </div>
  ) : null;

  // ─── Réseau choisi : uniquement « Communications IA », tous réseaux ───
  // Court-circuite tout ce qui suit (app Twitter intégrée, X en direct,
  // bouton de connexion). Les branches restent en dessous, inertes.
  if (SOCIAL_ONLY_AI_COMMS) {
    return (
      <div className="h-full flex flex-col min-h-0 min-w-0">
        {statusBar}
        {error && (
          <p className="px-3 py-1.5 text-[10px] shrink-0" style={{ color: '#ef4444', background: 'rgba(239,68,68,0.06)' }}>
            {error}
          </p>
        )}
        <div className="flex-1 min-h-0 min-w-0">
          <AiCommsPanel companyId={companyId || 'sandbox'} platform={platform.id} />
        </div>
        {/* La barre de prompte reste dans la largeur du fil. */}
        {footer ? <div className="shrink-0 min-w-0">{footer}</div> : null}
      </div>
    );
  }

  // ─── Barre de bascule : le réseau en direct ⟷ ce que l'IA a envoyé ───
  const switcher = SOCIAL_AI_COMMS ? (
    <div className="flex items-center gap-1 px-2 py-1 shrink-0" style={{ borderBottom: '1px solid var(--border-subtle)' }}>
      {([['live', platform.name], ['comms', 'Communications IA']] as const).map(([id, label]) => (
        <button
          key={id}
          onClick={() => setView(id as 'live' | 'comms')}
          className="text-[11px] px-2 py-1 rounded-md transition-colors"
          style={{
            background: view === id ? 'var(--surface-3)' : 'transparent',
            color: view === id ? 'var(--text-primary)' : 'var(--text-ghost)',
          }}
        >
          {label}
        </button>
      ))}
    </div>
  ) : null;

  // ─── Page « Communications IA » (ce que l'IA a envoyé + vues) ───
  if (SOCIAL_AI_COMMS && view === 'comms') {
    return (
      <div className="h-full flex flex-col min-h-0 min-w-0">
        {switcher}
        <div className="flex-1 min-h-0 min-w-0">
          <AiCommsPanel companyId={companyId || 'sandbox'} platform={platform.id} />
        </div>
        {footer ? <div className="shrink-0 min-w-0">{footer}</div> : null}
      </div>
    );
  }

  // ─── Fil intégré (X Live en veille) : connexion puis fil 3 colonnes ───
  if (isX && !X_LIVE_ACTIVE) {
    return (
      <div className="h-full flex flex-col min-h-0">
        {switcher}
        <div className="flex-1 min-h-0">
          {identity ? (
            <XCloneApp
              companyId={companyId || 'sandbox'}
              platform={platform.id}
              identity={identity}
              className="h-full"
            />
          ) : (
            <XCloneLogin onSignedIn={setIdentity} className="h-full" />
          )}
        </div>
      </div>
    );
  }

  // ─── X en direct dans l'app (ancien rendu, conservé) ───
  if (isX && (xOpen || isConnected || xProfile)) {
    return (
      <div className="h-full flex flex-col min-h-0">
        {switcher}
        <div className="flex-1 min-h-0">
          <XLiveViewer
            companyId={companyId || 'sandbox'}
            startUrl={xProfile || isConnected ? 'https://x.com/home' : 'https://x.com/i/flow/login'}
            className="h-full"
          />
        </div>
      </div>
    );
  }

  // ─── Non connecté : titre en haut + bouton ───
  return (
    <div className="h-full flex flex-col">
      <div className="px-5 pt-5">
        <div className="flex items-center gap-2">
          <span style={{ color: platform.darkColor }}>{platform.icon}</span>
          <h4 className="text-[13px] font-semibold" style={{ color: 'var(--text-primary)' }}>{platform.name}</h4>
        </div>
        <p className="text-[11px] mt-1" style={{ color: 'var(--text-ghost)' }}>
          {isConnected ? 'Connecté — pilotage IA actif.' : platform.desc}
        </p>
      </div>

      <div className="flex-1 flex flex-col items-center justify-center px-5 gap-2">
        <button
          onClick={() => { if (isX) setXOpen(true); else onConnect(); }}
          disabled={isConnecting}
          className="text-[12px] font-medium px-4 py-2 rounded-xl transition-all"
          style={{
            background: isConnecting ? 'var(--surface-4)' : 'var(--btn-primary-bg)',
            color: isConnecting ? 'var(--text-ghost)' : 'var(--btn-primary-fg)',
            cursor: isConnecting ? 'default' : 'pointer',
          }}
        >
          {isConnecting ? 'Connexion…' : isConnected ? 'Ouvrir' : `Se connecter à ${platform.name}`}
        </button>
        {isX && (
          <p className="text-[10px] text-center max-w-[240px]" style={{ color: 'var(--text-ghost)' }}>
            X s'ouvre directement ici : vraie session, fil, vidéos, publication.
          </p>
        )}
        {error && (
          <p className="text-[10px]" style={{ color: '#ef4444' }}>{error}</p>
        )}
      </div>
    </div>
  );
}

export default SocialRightPane;
