/**
 * Alerte d'onglet : prévenir quand un build est terminé alors que
 * l'utilisateur ne regarde pas l'onglet.
 *
 * [2026-09-15] Avant, rien ne prévenait : `playNotificationSound()` n'était
 * appelé que par AdminNotice, `document.title` n'était jamais touché en dehors
 * du guide, et `showNotification()` de lib/desktop.ts n'était appelé par
 * personne. Un build de quatre minutes se terminait donc dans le silence
 * complet : on changeait d'onglet et on revenait vingt minutes plus tard par
 * hasard.
 *
 * Trois canaux, parce qu'aucun n'est fiable seul :
 *  1. le TITRE de l'onglet — le seul signal visible quand l'onglet est réduit
 *     dans une barre pleine d'onglets ;
 *  2. le FAVICON — pastille pendant le build, coche à la fin ; composé au
 *     canvas à partir des data: URI déjà en mémoire (aucun réseau, donc ça
 *     s'applique même sur un onglet en arrière-plan, cf. lib/favicon.ts) ;
 *  3. le SON + la notification système (Electron, sinon l'API Notification du
 *     navigateur si la permission est déjà accordée — on ne la DEMANDE jamais
 *     de nous-mêmes, une popup de permission surgissant pendant un build est
 *     pire que pas de notification).
 *
 * Règle de fond : on n'alerte que si l'onglet est réellement caché au moment
 * où le build se termine. Quelqu'un qui regarde l'écran voit déjà le résultat
 * et n'a pas besoin qu'on lui fasse du bruit.
 */

import { browserTheme, setFaviconOverride, type FaviconTheme } from './favicon';
import { FAVICON_DARK, FAVICON_LIGHT } from './favicon-data';
import { playNotificationSound } from './notification-sound';
import { getDesktopAPI } from './desktop';

/** Titre d'origine de la page, relevé une seule fois avant toute modification. */
let baseTitle: string | null = null;

function readBaseTitle(): string {
  if (baseTitle === null) baseTitle = document.title;
  return baseTitle;
}

function setTitle(prefix: string | null): void {
  if (typeof document === 'undefined') return;
  const base = readBaseTitle();
  const next = prefix ? `${prefix} ${base}` : base;
  if (document.title !== next) document.title = next;
}

// ── Favicon badgé ────────────────────────────────────────────────────────────

type Badge = 'building' | 'done';

const BADGE_COLOR: Record<Badge, string> = {
  building: '#f5a524', // ambre : ça travaille
  done: '#22c55e',     // vert : c'est prêt
};

const cache = new Map<string, string>();

/**
 * Compose l'icône de l'onglet + une pastille en bas à droite, au canvas.
 *
 * Pourquoi le canvas et pas un SVG : un favicon SVG n'est pas supporté
 * partout (et une <image> data: imbriquée dedans est souvent bloquée), alors
 * qu'un PNG produit par canvas marche dans tous les navigateurs visés.
 *
 * Asynchrone (l'image doit être décodée), donc on préchauffe dès le début du
 * build : quand la fin arrive, la coche est déjà prête en cache.
 */
function badgedFavicon(theme: FaviconTheme, badge: Badge): Promise<string | null> {
  const key = `${theme}:${badge}`;
  const hit = cache.get(key);
  if (hit) return Promise.resolve(hit);

  return new Promise(resolve => {
    try {
      const img = new Image();
      img.onload = () => {
        try {
          const S = 32;
          const canvas = document.createElement('canvas');
          canvas.width = S;
          canvas.height = S;
          const ctx = canvas.getContext('2d');
          if (!ctx) { resolve(null); return; }

          ctx.drawImage(img, 0, 0, S, S);

          // Le "V" est décalé vers le haut à gauche pour laisser la pastille
          // lisible : on creuse un disque transparent un peu plus grand que la
          // pastille, sinon le glyphe passe dessous et tout devient illisible.
          const r = 10;
          const cx = S - r + 1;
          const cy = S - r + 1;
          ctx.globalCompositeOperation = 'destination-out';
          ctx.beginPath();
          ctx.arc(cx, cy, r + 1.5, 0, Math.PI * 2);
          ctx.fill();

          ctx.globalCompositeOperation = 'source-over';
          ctx.fillStyle = BADGE_COLOR[badge];
          ctx.beginPath();
          ctx.arc(cx, cy, r, 0, Math.PI * 2);
          ctx.fill();

          if (badge === 'done') {
            ctx.strokeStyle = '#ffffff';
            ctx.lineWidth = 3;
            ctx.lineCap = 'round';
            ctx.lineJoin = 'round';
            ctx.beginPath();
            ctx.moveTo(cx - 4.5, cy);
            ctx.lineTo(cx - 1, cy + 3.5);
            ctx.lineTo(cx + 4.5, cy - 3.5);
            ctx.stroke();
          }

          const url = canvas.toDataURL('image/png');
          cache.set(key, url);
          resolve(url);
        } catch {
          resolve(null);
        }
      };
      img.onerror = () => resolve(null);
      img.src = theme === 'dark' ? FAVICON_DARK : FAVICON_LIGHT;
    } catch {
      resolve(null);
    }
  });
}

function applyBadge(badge: Badge | null): void {
  if (typeof document === 'undefined') return;
  if (!badge) { setFaviconOverride(null); return; }
  void badgedFavicon(browserTheme(), badge).then(href => {
    // Entre-temps l'alerte peut avoir été effacée (retour sur l'onglet) :
    // on ne repose pas une icône périmée.
    if (href && state.badge === badge) setFaviconOverride(href);
  });
}

// ── État de l'alerte ─────────────────────────────────────────────────────────

const state: { badge: Badge | null; alerting: boolean } = { badge: null, alerting: false };
let listening = false;

/** Efface le titre et l'icône d'alerte. Appelé au retour sur l'onglet. */
export function clearTabAlert(): void {
  if (!state.alerting && state.badge === null) return;
  state.alerting = false;
  state.badge = null;
  setTitle(null);
  setFaviconOverride(null);
}

/**
 * Efface l'alerte dès que l'utilisateur revient. `focus` en plus de
 * `visibilitychange` parce qu'une fenêtre visible mais pas au premier plan ne
 * déclenche pas le second.
 */
function listen(): void {
  if (listening || typeof window === 'undefined') return;
  listening = true;
  const onBack = () => { if (!document.hidden) clearTabAlert(); };
  document.addEventListener('visibilitychange', onBack);
  window.addEventListener('focus', onBack);
  window.addEventListener('pointerdown', onBack);
}

/**
 * Un build démarre : on préchauffe les icônes badgées et, si l'onglet est déjà
 * caché, on signale « ça travaille » dans le titre et l'icône.
 */
export function markBuildRunning(label?: string): void {
  if (typeof document === 'undefined') return;
  readBaseTitle();
  listen();

  const theme = browserTheme();
  void badgedFavicon(theme, 'building');
  void badgedFavicon(theme, 'done');

  if (!document.hidden) return;
  state.badge = 'building';
  state.alerting = false;
  setTitle(label ? `● ${label} —` : '●');
  applyBadge('building');
}

/**
 * Un build est terminé. N'alerte que si l'onglet est caché : titre, icône,
 * son, notification système.
 */
export function markBuildDone(opts?: { tab?: string; title?: string; body?: string }): void {
  if (typeof document === 'undefined') return;
  readBaseTitle();
  listen();

  if (!document.hidden) { clearTabAlert(); return; }

  state.badge = 'done';
  state.alerting = true;
  // Les textes viennent de l'appelant (qui a accès à `t()`) : ce module est un
  // simple utilitaire, il n'a pas de contexte React pour traduire lui-même.
  setTitle(`✓ ${opts?.tab ?? 'Done'} —`);
  applyBadge('done');
  playNotificationSound();

  const title = opts?.title ?? 'Build done';
  const body = opts?.body ?? 'Your site is ready.';

  const desktop = getDesktopAPI();
  if (desktop) {
    void desktop.showNotification(title, body).catch(() => {});
    return;
  }

  // Navigateur : uniquement si la permission est DÉJÀ accordée. On ne déclenche
  // jamais la demande de permission ici (popup surprise = mauvaise surprise).
  try {
    if (typeof Notification !== 'undefined' && Notification.permission === 'granted') {
      new Notification(title, { body });
    }
  } catch { /* certains navigateurs jettent hors contexte sécurisé */ }
}

/** Le build a échoué : même logique, autre message, pas de coche verte. */
export function markBuildFailed(opts?: { tab?: string; title?: string; body?: string }): void {
  if (typeof document === 'undefined') return;
  readBaseTitle();
  listen();
  if (!document.hidden) { clearTabAlert(); return; }

  state.badge = 'building';
  state.alerting = true;
  setTitle(`⚠ ${opts?.tab ?? 'Failed'} —`);
  applyBadge('building');
  playNotificationSound();

  const desktop = getDesktopAPI();
  const title = opts?.title ?? 'Build interrupted';
  const text = opts?.body ?? 'The build stopped before the end.';
  if (desktop) { void desktop.showNotification(title, text).catch(() => {}); return; }
  try {
    if (typeof Notification !== 'undefined' && Notification.permission === 'granted') {
      new Notification(title, { body: text });
    }
  } catch { /* ignoré */ }
}
