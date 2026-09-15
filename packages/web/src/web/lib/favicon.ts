import { FAVICON_DARK, FAVICON_LIGHT } from './favicon-data';

/**
 * Favicon qui suit le thème du NAVIGATEUR (clair → V noir, sombre → V blanc),
 * et qui bascule tout de suite, même quand l'onglet est en arrière-plan.
 *
 * Pourquoi en JavaScript et pas en CSS :
 *  - `media="(prefers-color-scheme: dark)"` sur <link rel="icon"> est ignoré par
 *    Firefox et appliqué de façon inconstante par Chrome ;
 *  - une règle @media dans un favicon SVG n'est pas réévaluée partout quand le
 *    thème change.
 *
 * Pourquoi des data: URI (voir favicon-data.ts) : avec une URL classique, la
 * bascule devait télécharger le PNG, or un onglet en arrière-plan voit ses
 * requêtes réseau retardées — l'icône ne changeait donc qu'au retour sur le
 * site. Un data: URI est déjà en mémoire, donc aucun réseau, aucun délai.
 *
 * Le logo n'est pas modifié : le même V, une version noire et une blanche.
 */

const SOURCES = {
  light: FAVICON_LIGHT,
  dark: FAVICON_DARK,
} as const;

export type FaviconTheme = keyof typeof SOURCES;

const QUERY = '(prefers-color-scheme: dark)';

/** Thème déclaré par le navigateur. */
export function browserTheme(): FaviconTheme {
  if (typeof window === 'undefined' || !window.matchMedia) return 'light';
  return window.matchMedia(QUERY).matches ? 'dark' : 'light';
}

let current: FaviconTheme | null = null;
let painted: string | null = null;

// [2026-09-15] Icône temporaire posée par-dessus celle du thème (lib/tab-alert.ts :
// pastille « build en cours », coche « build terminé »). Elle a la priorité tant
// qu'elle est posée, et la surveillance du thème continue de tourner derrière :
// dès qu'on la retire, l'icône du thème courant revient sans autre appel.
let override: string | null = null;

/**
 * Pose réellement l'icône. On recrée le <link> à chaque bascule : changer
 * seulement le href ne suffit pas, plusieurs navigateurs continuent d'afficher
 * l'image déjà en cache. `painted` évite de recréer le <link> à chaque battement
 * du ticker (toutes les 250 ms) quand rien n'a changé.
 */
function paint(href: string, force: boolean): void {
  if (!force && href === painted) return;
  painted = href;

  document
    .querySelectorAll<HTMLLinkElement>('link[rel~="icon"]')
    .forEach(el => el.parentNode?.removeChild(el));

  const link = document.createElement('link');
  link.rel = 'icon';
  link.type = 'image/png';
  link.setAttribute('sizes', '32x32');
  link.href = href;
  document.head.appendChild(link);
}

/** Pose l'icône correspondant au thème (ou l'icône temporaire si elle est posée). */
export function setFavicon(theme: FaviconTheme = browserTheme(), force = false): void {
  if (typeof document === 'undefined') return;
  current = theme;
  paint(override ?? SOURCES[theme], force);
}

/**
 * Icône temporaire (data: URI) ou `null` pour revenir à celle du thème.
 * Data: URI uniquement — une URL réseau ne s'appliquerait pas sur un onglet en
 * arrière-plan, qui est justement le seul cas où cette icône sert.
 */
export function setFaviconOverride(href: string | null): void {
  if (typeof document === 'undefined') return;
  if (href === override) return;
  override = href;
  setFavicon(current ?? browserTheme(), true);
}

let started = false;

/**
 * Timer qui continue de tourner à pleine vitesse quand l'onglet est en
 * arrière-plan.
 *
 * `setInterval` sur la page est bridé par les navigateurs dès que l'onglet
 * n'est plus visible : Chrome tombe à un tick par minute. C'était ça, le gros
 * délai. Le timer d'un Web Worker n'est pas soumis à ce bridage, donc on fait
 * battre le worker et on vérifie le thème à chaque message reçu.
 *
 * Renvoie false si le worker n'a pas pu être créé (CSP restrictive, très vieux
 * navigateur) — on retombe alors sur un setInterval classique.
 */
function startWorkerTicker(tick: () => void, everyMs: number): boolean {
  try {
    if (typeof Worker === 'undefined' || typeof Blob === 'undefined') return false;
    const src = `let id; onmessage = e => { clearInterval(id); id = setInterval(() => postMessage(0), e.data); };`;
    const url = URL.createObjectURL(new Blob([src], { type: 'text/javascript' }));
    const worker = new Worker(url);
    URL.revokeObjectURL(url);
    worker.onmessage = tick;
    worker.postMessage(everyMs);
    return true;
  } catch {
    return false;
  }
}

/**
 * Applique l'icône et surveille le thème du navigateur.
 * À appeler une seule fois au démarrage de l'app.
 *
 * Trois filets, parce qu'aucun n'est fiable seul quand l'onglet est inactif :
 *  1. l'évènement `change` de la media query (le chemin normal, instantané) ;
 *  2. un battement toutes les 250 ms porté par un Web Worker, car les
 *     navigateurs retardent parfois cet évènement sur un onglet caché ;
 *  3. un contrôle au retour sur l'onglet (visibilitychange / focus / pageshow),
 *     y compris quand la page revient du cache de navigation.
 */
export function watchBrowserTheme(): void {
  if (started || typeof window === 'undefined') return;
  started = true;

  setFavicon(browserTheme(), true);

  const sync = () => setFavicon();

  const mq = window.matchMedia?.(QUERY);
  if (mq) {
    if (typeof mq.addEventListener === 'function') {
      mq.addEventListener('change', sync);
    } else if (typeof (mq as MediaQueryList & { addListener?: unknown }).addListener === 'function') {
      // Safari < 14
      (mq as MediaQueryList & { addListener: (cb: () => void) => void }).addListener(sync);
    }
  }

  if (!startWorkerTicker(sync, 250)) {
    window.setInterval(sync, 1000);
  }
  document.addEventListener('visibilitychange', sync);
  window.addEventListener('focus', sync);
  window.addEventListener('pageshow', sync);
}
