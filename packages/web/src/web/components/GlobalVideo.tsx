import { useEffect, useRef, type CSSProperties } from 'react';
import { isBackgroundedByLoginAs } from '../lib/token';

const VIDEO_MAIN = 'https://storage.googleapis.com/runable-templates/cli-uploads%2Fakml8BZagPXLqtY8WBfg4mvZMy0Co8eL%2Fmrw0XTryKvOlmMP7taZoY%2Fsynaps-bg.mp4';

// Dark: white dunes → warm beige dunes
const DARK_FILTER = 'none';
const DARK_OPACITY = '1';

// ── Bouclage sans micro-gel ──
// Un `loop` natif rembobine l'élément vidéo : le navigateur refait un seek en
// début de fichier, redécode une image clé et parfois rappelle le réseau si le
// début du flux a été évincé du buffer. Résultat : une saccade d'une fraction
// de seconde, exactement au raccord de la boucle.
// On garde donc DEUX couches vidéo identiques : pendant que la première finit,
// la seconde redémarre depuis zéro et prend le relais en fondu par-dessus. Le
// seek coûteux se produit sur une couche cachée, jamais sur celle qu'on voit.
const HANDOFF_SECONDS = 0.4; // durée du relais, juste avant la fin

function applyTheme(v: HTMLVideoElement) {
  const isLight = document.documentElement.getAttribute('data-theme') === 'light';
  v.style.filter = isLight ? 'invert(1)' : DARK_FILTER;
}

// `overlay` = couche de dessus. La couche de dessous reste dans le flux : c'est
// elle qui donne sa hauteur au conteneur (exactement comme la vidéo unique
// d'avant), la couche de dessus vient se superposer à ce même cadrage. Les deux
// gardent `position` non statique pour que leur `z-index` compte lors du relais.
function createVideo(src: string, overlay: boolean): HTMLVideoElement {
  const v = document.createElement('video');
  v.src = src;
  // Filet de sécurité : si le relais entre les deux couches échoue (iOS qui
  // refuse une seconde lecture simultanée, durée inconnue…), la vidéo boucle
  // toute seule comme avant au lieu de s'arrêter net.
  v.loop = true;
  v.muted = true;
  v.playsInline = true;
  // Seule la couche de dessous démarre d'elle-même : la doublure reste en
  // attente sur sa première image jusqu'au relais.
  v.autoplay = !overlay;
  v.preload = 'auto';
  v.setAttribute('playsinline', '');
  v.setAttribute('webkit-playsinline', '');
  v.setAttribute('muted', '');
  // Purely decorative background — must never be selectable, draggable, or
  // clickable (no text-selection highlight, no "save video as" drag-out, no
  // right-click-and-drag selection box around it).
  v.setAttribute('disablePictureInPicture', '');
  v.setAttribute('controlsList', 'nodownload noplaybackrate nofullscreen');
  v.draggable = false;
  Object.assign(v.style, {
    position: overlay ? 'absolute' : 'relative',
    top: overlay ? '0' : undefined,
    left: overlay ? '0' : undefined,
    width: '100%',
    height: '100%',
    objectFit: 'cover',
    willChange: 'transform, opacity',
    transform: 'translateZ(0)',
    backfaceVisibility: 'hidden',
    transition: 'none',
    pointerEvents: 'none',
    userSelect: 'none',
    WebkitUserSelect: 'none',
    WebkitUserDrag: 'none',
  } as CSSStyleDeclaration);
  return v;
}

// Les deux couches : [0] et [1] jouent la même source, à tour de rôle.
let layers: HTMLVideoElement[] | null = null;
let activeIdx = 0;
let handingOff = false;
let mainReady = false;

function activeLayer(): HTMLVideoElement | null {
  return layers ? layers[activeIdx] : null;
}

// ── Readiness subscription ──
// Lets React components reveal the page only once the background video is
// actually ready to play, so the site never appears "loaded" before the video.
const readySubscribers = new Set<() => void>();

export function isMainVideoReady(): boolean {
  return mainReady;
}

export function subscribeMainVideoReady(cb: () => void): () => void {
  if (mainReady) {
    // Fire on next tick so callers can rely on unsubscribe being returned first.
    Promise.resolve().then(cb);
    return () => {};
  }
  readySubscribers.add(cb);
  return () => readySubscribers.delete(cb);
}

function markReady(v: HTMLVideoElement) {
  if (mainReady) return;
  mainReady = true;
  applyTheme(v);
  readySubscribers.forEach((cb) => cb());
  readySubscribers.clear();
}

// ── Keep-alive ──
// iOS/Safari pauses background videos when the tab is backgrounded, when the
// device enters Low Power Mode, after a DOM move, or when the element scrolls
// off-screen — and never resumes on its own. This watchdog resumes playback
// whenever the video is unexpectedly paused/stalled so it never stays frozen.
let keepAliveStarted = false;

function tryResume() {
  if (document.hidden) return;
  // Pendant un relais, la couche sortante est volontairement arrêtée : on ne
  // réveille que celle qui est réellement à l'écran.
  const v = activeLayer();
  if (!v) return;
  if (v.paused || v.ended) {
    if (v.ended) { try { v.currentTime = 0; } catch { /* noop */ } }
    v.play().catch(() => {});
  }
}

function startKeepAlive(vs: HTMLVideoElement[]) {
  if (keepAliveStarted) return;
  keepAliveStarted = true;

  // Fenêtre "login-as" ouverte (ou frame d'emprunt) : on ne relance rien, l'app
  // reste en veille comme si elle n'était pas utilisée.
  const resume = () => { if (isBackgroundedByLoginAs()) return; tryResume(); };

  // The video itself signalling it stopped or stalled.
  for (const v of vs) {
    v.addEventListener('pause', resume);
    v.addEventListener('stalled', resume);
    v.addEventListener('waiting', resume);
    v.addEventListener('suspend', resume);
    v.addEventListener('ended', resume);
  }

  // App/tab returns to foreground (very common cause on mobile).
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) resume();
  });
  window.addEventListener('focus', resume);
  window.addEventListener('pageshow', resume);

  // Any user interaction is a valid gesture to re-kick playback on iOS.
  window.addEventListener('touchstart', resume, { passive: true });
  window.addEventListener('scroll', resume, { passive: true });

  // Periodic safety net for cases with no event at all (Low Power Mode).
  window.setInterval(resume, 1500);
}

// ── Surveillance du raccord ──
// On lit `currentTime` à chaque image affichée (`requestVideoFrameCallback`
// quand il existe, sinon `requestAnimationFrame`) : `timeupdate` ne se déclenche
// que 4 fois par seconde, bien trop grossier pour armer un relais de 0,4 s.
function startHandoffWatcher(vs: HTMLVideoElement[]) {
  const rvfc = (v: HTMLVideoElement) =>
    (v as any).requestVideoFrameCallback?.bind(v) as ((cb: () => void) => number) | undefined;

  const tick = () => {
    if (!document.hidden) checkHandoff();
    schedule();
  };

  const schedule = () => {
    const v = activeLayer() ?? vs[0];
    const req = rvfc(v);
    if (req) req(tick);
    else requestAnimationFrame(tick);
  };

  schedule();
}

function checkHandoff() {
  if (!layers || handingOff) return;
  const current = layers[activeIdx];
  const next = layers[1 - activeIdx];
  const duration = current.duration;

  // Durée inconnue (flux non encore analysé) → on laisse le `loop` natif faire.
  if (!Number.isFinite(duration) || duration <= HANDOFF_SECONDS * 2) return;
  if (current.paused) return;
  if (current.currentTime < duration - HANDOFF_SECONDS) return;

  handingOff = true;
  const fadeMs = Math.max(120, (duration - current.currentTime) * 1000);

  // La couche entrante repart du début et passe AU-DESSUS de la sortante.
  // La sortante reste à pleine opacité pendant tout le fondu : à aucun moment
  // le fond de page ne peut apparaître entre les deux.
  try { next.currentTime = 0; } catch { /* noop */ }
  next.style.transition = 'none';
  next.style.opacity = '0';
  next.style.zIndex = '2';
  current.style.zIndex = '1';
  applyTheme(next);

  const started = next.play();

  const runFade = () => {
    // Deux images de la couche entrante suffisent à garantir qu'elle décode
    // vraiment avant qu'on la révèle.
    requestAnimationFrame(() => requestAnimationFrame(() => {
      next.style.transition = `opacity ${Math.round(fadeMs)}ms linear`;
      next.style.opacity = DARK_OPACITY;
    }));
  };

  const abort = () => {
    // La seconde lecture a été refusée : on annule proprement et le `loop`
    // natif reprend la main (micro-saccade, mais jamais d'image figée).
    next.style.transition = 'none';
    next.style.opacity = '0';
    next.style.zIndex = '1';
    current.style.zIndex = '2';
    handingOff = false;
  };

  if (started && typeof started.then === 'function') started.then(runFade).catch(abort);
  else runFade();

  window.setTimeout(() => {
    if (!layers) return;
    // Le relais est terminé : la sortante est masquée, remise à zéro et mise en
    // attente. Son prochain seek se fera donc hors écran, sans rien geler.
    if (next.style.opacity !== '0') {
      activeIdx = 1 - activeIdx;
      current.style.transition = 'none';
      current.style.opacity = '0';
      current.pause();
      try { current.currentTime = 0; } catch { /* noop */ }
    }
    handingOff = false;
  }, Math.round(fadeMs) + 120);
}

function getLayers(): HTMLVideoElement[] {
  if (layers) return layers;

  const a = createVideo(VIDEO_MAIN, false);
  const b = createVideo(VIDEO_MAIN, true);
  a.style.opacity = '0';
  b.style.opacity = '0';
  a.style.zIndex = '2';
  b.style.zIndex = '1';

  a.addEventListener('canplaythrough', () => {
    if (!mainReady) a.style.opacity = DARK_OPACITY;
    markReady(a);
  }, { once: true });

  const fallback = () => {
    if (a.currentTime > 0.05) {
      if (!mainReady) a.style.opacity = DARK_OPACITY;
      markReady(a);
      a.removeEventListener('timeupdate', fallback);
    }
  };
  a.addEventListener('timeupdate', fallback);

  // Safety net: never block the page reveal forever if the video stalls.
  // Attention : ne jamais réimposer l'opacité une fois la page révélée, sinon on
  // rallume la couche mise en attente derrière celle qui joue.
  window.setTimeout(() => {
    if (!mainReady) a.style.opacity = DARK_OPACITY;
    markReady(a);
  }, 6000);

  const observer = new MutationObserver(() => {
    if (mainReady) { applyTheme(a); applyTheme(b); }
  });
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });

  layers = [a, b];
  activeIdx = 0;

  a.load();
  a.play().catch(() => {});
  // La doublure est chargée et amorcée sur sa première image, puis laissée en
  // attente : au moment du relais elle n'a plus rien à décoder.
  b.load();
  b.pause();
  try { b.currentTime = 0; } catch { /* noop */ }

  startKeepAlive(layers);
  startHandoffWatcher(layers);
  return layers;
}

export function GlobalVideoSlot({ visible }: { visible: boolean }) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const vs = getLayers();
    for (const v of vs) {
      if (v.parentElement !== el) el.appendChild(v);
      if (mainReady) applyTheme(v);
    }
    const v = vs[activeIdx];
    if (v.paused) v.play().catch(() => {});
  }, [visible]);

  return (
    <div
      ref={ref}
      className="absolute inset-0"
      style={{
        zIndex: 1,
        position: 'relative',
        pointerEvents: 'none',
        userSelect: 'none',
        WebkitUserSelect: 'none',
      } as CSSProperties}
    />
  );
}
