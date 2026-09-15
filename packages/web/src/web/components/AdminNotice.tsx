import { useEffect, useState } from "react";
import { getAuthToken } from '../lib/token';
import { armNotificationSound, markSoundedAndCheck, playNotificationSound } from '../lib/notification-sound';
import { VerifiedBadge } from "./ui/verified-badge";

// Notifications admin ancrées en haut au centre (table `notifications`,
// route GET /api/notifications). Plusieurs messages s'EMPILENT les uns sous
// les autres : un nouveau message ne remplace jamais celui déjà affiché.
// Chaque message a son X → POST /api/notifications/:id/read puis retrait local.
// Monté pour TOUT utilisateur connecté : c'est le destinataire qui doit le voir.

interface Notif {
  id: string;
  title?: string | null;
  message: string;
  type?: string | null;
  read?: number;
  createdAt?: number;
}

// Rythme de vérification. Avant : 30 s → un message pouvait mettre une demi
// minute à apparaître chez le destinataire. Maintenant 1,2 s quand l'onglet est
// visible (perçu comme instantané), 15 s quand il est caché (inutile de marteler
// l'API en arrière-plan), plus une vérification immédiate au retour sur l'onglet.
//
// Pourquoi pas du SSE (serveur qui pousse, vrai 0 délai) : le plugin de dev du
// template bufferise toute la réponse avant de l'envoyer, donc un flux qui ne se
// termine jamais reste bloqué. Ce fichier est template-managed, interdit d'y
// toucher — le sondage court est la seule option fiable ici.
const POLL_VISIBLE_MS = 1_200;
const POLL_HIDDEN_MS = 15_000;
const MAX_VISIBLE = 5;
// Durée du repli/fondu d'un message fermé : les autres glissent pendant ce temps.
const EXIT_MS = 200;

// Expéditeur : le compte admin (miroir de ADMIN_EMAILS dans lib/auth.ts).
// Le rond de profil affiché à droite du texte est celui de ce compte.
const SENDER_EMAIL = 'johnemadmansour1@gmail.com';
const SENDER_INITIAL = (SENDER_EMAIL[0] || 'V').toUpperCase();

function authHeaders(): Record<string, string> {
  const token = getAuthToken();
  return token ? { Authorization: `Bearer ${token}` } : {};
}

function accentOf(type?: string | null) {
  if (type === 'error' || type === 'warning') return 'var(--danger, #ef4444)';
  if (type === 'success') return 'var(--success, #22c55e)';
  return 'var(--accent, #3b82f6)';
}

export function AdminNotice() {
  // Pile affichée : plus ancien en haut, nouveau ajouté en dessous.
  const [stack, setStack] = useState<Notif[]>([]);
  // Ids déjà fermés localement : le polling ne doit pas les faire revenir.
  const [dismissed, setDismissed] = useState<string[]>([]);
  // Ids en cours de sortie : repli de hauteur + fondu avant retrait réel.
  const [exiting, setExiting] = useState<string[]>([]);

  // Prépare le son et branche le déverrouillage sur la première interaction :
  // sans ça, le navigateur refuse de jouer quoi que ce soit (autoplay policy).
  useEffect(() => {
    armNotificationSound();
  }, []);

  useEffect(() => {
    let alive = true;
    const load = async () => {
      try {
        const res = await fetch('/api/notifications', { headers: authHeaders() });
        if (!res.ok) return;
        const data = await res.json();
        if (!alive) return;
        const list: Notif[] = Array.isArray(data?.notifications) ? data.notifications : [];
        // L'API renvoie du plus RÉCENT au plus ancien : on inverse d'abord pour
        // que l'ordre de base soit plus ancien → plus récent, même quand deux
        // messages ont le même createdAt (le tri seul ne suffisait pas).
        const unread = [...list]
          .reverse()
          .filter(n => (n.read ?? 0) === 0)
          .sort((a, b) => (a.createdAt ?? 0) - (b.createdAt ?? 0)); // plus ancien en haut
        setStack(prev => {
          const known = new Set(prev.map(n => n.id));
          // On garde l'existant tel quel et on ajoute seulement les nouveaux.
          const added = unread.filter(n => !known.has(n.id) && !dismissed.includes(n.id));
          // Son : seulement pour les notifications jamais entendues (les ids
          // déjà sonnés sont mémorisés), donc pas de bip à chaque rechargement.
          if (added.length && markSoundedAndCheck(added.map(n => n.id))) {
            playNotificationSound();
          }
          return added.length ? [...prev, ...added] : prev;
        });
      } catch { /* silencieux : pas d'écran d'erreur pour une notif */ }
    };
    load();

    // Intervalle adaptatif : recréé quand l'onglet ou le flux change d'état.
    let t: number | undefined;
    const schedule = () => {
      if (t) window.clearInterval(t);
      const every = document.hidden ? POLL_HIDDEN_MS : POLL_VISIBLE_MS;
      t = window.setInterval(load, every);
    };
    schedule();

    // Retour sur l'onglet : on vérifie tout de suite, sans attendre le tick.
    const onWake = () => { load(); schedule(); };
    document.addEventListener('visibilitychange', onWake);
    window.addEventListener('focus', onWake);
    window.addEventListener('online', onWake);

    return () => {
      alive = false;
      if (t) window.clearInterval(t);
      document.removeEventListener('visibilitychange', onWake);
      window.removeEventListener('focus', onWake);
      window.removeEventListener('online', onWake);
    };
  }, [dismissed]);

  // Fermeture animée : le message part en fondu et sa hauteur se replie, donc
  // les messages restants GLISSENT jusqu'à leur nouvelle place au lieu de sauter
  // (aucun message ne se transforme en un autre à l'écran).
  const dismiss = async (id: string) => {
    if (exiting.includes(id)) return;
    setExiting(prev => [...prev, id]);
    setDismissed(prev => (prev.includes(id) ? prev : [...prev, id]));
    setTimeout(() => {
      setStack(prev => prev.filter(n => n.id !== id));
      setExiting(prev => prev.filter(x => x !== id));
    }, EXIT_MS);
    try {
      await fetch(`/api/notifications/${id}/read`, { method: 'POST', headers: authHeaders() });
    } catch { /* déjà retiré côté UI */ }
  };

  if (stack.length === 0) return null;

  const visible = stack.slice(0, MAX_VISIBLE);

  return (
    <div
      style={{
        position: 'fixed',
        top: 16,
        left: '50%',
        transform: 'translateX(-50%)',
        zIndex: 90,
        maxWidth: 'min(560px, calc(100vw - 24px))',
        width: 'max-content',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        pointerEvents: 'auto',
      }}
      role="status"
    >
      {visible.map((n, i) => {
        const isExiting = exiting.includes(n.id);
        return (
        // Enveloppe qui replie sa hauteur (1fr → 0fr) quand le message sort :
        // les messages en dessous remontent en glissant, sans saut ni échange
        // de texte d'une ligne à l'autre.
        <div
          key={n.id}
          style={{
            display: 'grid',
            gridTemplateRows: isExiting ? '0fr' : '1fr',
            opacity: isExiting ? 0 : 1,
            marginBottom: isExiting ? 0 : 8,
            transform: isExiting ? 'translateY(6px)' : 'translateY(0)',
            transition: `grid-template-rows ${EXIT_MS}ms cubic-bezier(0.22, 1, 0.36, 1), opacity 150ms ease, margin-bottom ${EXIT_MS}ms cubic-bezier(0.22, 1, 0.36, 1), transform ${EXIT_MS}ms ease`,
          }}
        >
        <div style={{ overflow: 'hidden' }}>
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 10,
            // Marge intérieure indispensable : l'enveloppe au-dessus est en
            // overflow:hidden (repli de hauteur à la fermeture), donc le badge
            // vérifié, positionné en absolu hors du rond, se faisait rogner.
            padding: '6px 8px',
            animation: 'notice-in 160ms ease both',
            animationDelay: `${Math.min(i, 4) * 30}ms`,
          }}
        >
          {/* Texte nu : aucun rectangle derrière. */}
          <div style={{ minWidth: 0 }}>
            <div style={{
              fontSize: 14,
              lineHeight: 1.45,
              whiteSpace: 'pre-wrap',
              wordBreak: 'break-word',
              color: 'var(--text-secondary)',
              textShadow: '0 1px 8px rgba(0,0,0,0.55)',
            }}>
              {n.message}
            </div>
          </div>

          {/* À droite du texte : rond de profil du compte admin + badge vérifié. */}
          <div style={{ position: 'relative', flexShrink: 0 }}>
            <div
              style={{
                width: 26,
                height: 26,
                borderRadius: '50%',
                display: 'grid',
                placeItems: 'center',
                fontSize: 11,
                fontWeight: 600,
                background: accentOf(n.type),
                color: 'var(--text-inverse, #fff)',
              }}
            >
              {SENDER_INITIAL}
            </div>
            <span style={{ position: 'absolute', top: -3, right: -3, lineHeight: 0 }}>
              <VerifiedBadge size={12} ringColor="var(--bg, #0b0f19)" />
            </span>
          </div>

          <button
            onClick={() => dismiss(n.id)}
            aria-label="Fermer"
            style={{
              flexShrink: 0,
              width: 24,
              height: 24,
              display: 'grid',
              placeItems: 'center',
              borderRadius: 6,
              border: 'none',
              background: 'transparent',
              color: 'inherit',
              opacity: 0.55,
              cursor: 'pointer',
            }}
            onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.opacity = '1'; }}
            onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.opacity = '0.55'; }}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
              <path d="M18 6 6 18M6 6l12 12" />
            </svg>
          </button>
        </div>
        </div>
        </div>
        );
      })}
    </div>
  );
}

export default AdminNotice;
