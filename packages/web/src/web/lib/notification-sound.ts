/**
 * Son de notification.
 *
 * Trois pièges, corrigés ici :
 *
 *  1. **Autoplay policy** — un navigateur refuse tout son avant la première
 *     interaction de l'utilisateur sur la page. Si la notification arrive
 *     pendant ce laps de temps, `play()` est rejeté et rien ne sort. On garde
 *     donc le son "en attente" et on le rejoue au premier clic / touche.
 *  2. **Ne jamais marquer une notif comme sonnée si le son n'est pas sorti** —
 *     sinon elle est perdue pour toujours (c'était le bug : le son bloqué par
 *     le navigateur était quand même marqué comme joué).
 *  3. **AudioContext suspendu** — Chrome crée le contexte en état `suspended`
 *     jusqu'à une interaction ; on appelle `resume()` à chaque interaction.
 *
 * Lecture via Web Audio (buffer décodé, en mémoire) avec repli sur un simple
 * <audio> si Web Audio n'est pas disponible.
 */

const SRC = '/sounds/notification.mp3';
const SEEN_KEY = 'velbaz-notif-sounded';
const MAX_SEEN = 200;
const VOLUME = 0.6;

type Ctx = AudioContext & { resume: () => Promise<void> };

let ctx: Ctx | null = null;
let buffer: AudioBuffer | null = null;
let loading: Promise<void> | null = null;
let el: HTMLAudioElement | null = null;
let armed = false;
let pending = false;

function audioContext(): Ctx | null {
  if (typeof window === 'undefined') return null;
  const Ctor =
    window.AudioContext ||
    (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Ctor) return null;
  if (!ctx) {
    try {
      ctx = new Ctor() as Ctx;
    } catch {
      return null;
    }
  }
  return ctx;
}

/** Télécharge et décode le fichier une seule fois. */
function preload(): Promise<void> {
  if (buffer) return Promise.resolve();
  if (loading) return loading;
  const c = audioContext();
  if (!c) return Promise.resolve();
  loading = fetch(SRC)
    .then(r => r.arrayBuffer())
    .then(b => c.decodeAudioData(b))
    .then(decoded => {
      buffer = decoded;
    })
    .catch(() => {
      /* on retombera sur <audio> */
    });
  return loading;
}

function fallbackEl(): HTMLAudioElement | null {
  if (typeof document === 'undefined') return null;
  if (!el) {
    el = new Audio(SRC);
    el.preload = 'auto';
    el.volume = VOLUME;
  }
  return el;
}

/** Tente de jouer tout de suite. Renvoie true si le son est bien parti. */
function tryPlay(): boolean {
  const c = audioContext();
  if (c && buffer) {
    if (c.state === 'suspended') {
      void c.resume().catch(() => {});
      // Contexte encore bloqué : on rejouera à la prochaine interaction.
      if (c.state === 'suspended') return false;
    }
    try {
      const src = c.createBufferSource();
      src.buffer = buffer;
      const gain = c.createGain();
      gain.gain.value = VOLUME;
      src.connect(gain).connect(c.destination);
      src.start(0);
      return true;
    } catch {
      /* on tente le repli */
    }
  }

  const a = fallbackEl();
  if (!a) return false;
  try {
    a.currentTime = 0;
    const p = a.play();
    if (p && typeof p.then === 'function') {
      // On ne sait pas encore : optimiste, mais on repasse en attente si rejeté.
      p.catch(() => {
        pending = true;
      });
    }
    return true;
  } catch {
    return false;
  }
}

/**
 * Prépare le son et branche le déverrouillage sur la première interaction.
 * À appeler une fois au montage.
 */
export function armNotificationSound(): void {
  if (armed || typeof window === 'undefined') return;
  armed = true;
  void preload();

  const unlock = () => {
    const c = audioContext();
    if (c && c.state === 'suspended') void c.resume().catch(() => {});
    void preload().then(() => {
      // Une notif est arrivée pendant que le navigateur nous bloquait : on la joue.
      if (pending) {
        pending = false;
        tryPlay();
      }
    });
  };

  window.addEventListener('pointerdown', unlock);
  window.addEventListener('keydown', unlock);
  window.addEventListener('touchstart', unlock);
  document.addEventListener('visibilitychange', unlock);
}

/**
 * Joue le son. Si le navigateur refuse (pas encore d'interaction), le son est
 * mis en attente et sortira à la première interaction.
 */
export function playNotificationSound(): void {
  if (!buffer) {
    // Pas encore décodé : on charge puis on joue dès que possible.
    void preload().then(() => {
      if (!tryPlay()) pending = true;
    });
    pending = true;
    return;
  }
  if (!tryPlay()) pending = true;
  else pending = false;
}

function readSeen(): string[] {
  try {
    const raw = localStorage.getItem(SEEN_KEY);
    const list = raw ? JSON.parse(raw) : [];
    return Array.isArray(list) ? list.filter(x => typeof x === 'string') : [];
  } catch {
    return [];
  }
}

/**
 * Filtre les ids qui n'ont jamais fait sonner le son, et les marque comme
 * sonnés. Renvoie true s'il y en avait au moins un (→ il faut jouer le son).
 */
export function markSoundedAndCheck(ids: string[]): boolean {
  if (ids.length === 0) return false;
  const seen = readSeen();
  const set = new Set(seen);
  const fresh = ids.filter(id => !set.has(id));
  if (fresh.length === 0) return false;
  const next = [...seen, ...fresh].slice(-MAX_SEEN);
  try {
    localStorage.setItem(SEEN_KEY, JSON.stringify(next));
  } catch { /* quota / mode privé : on jouera peut-être deux fois, pas grave */ }
  return true;
}

/** Bouton "tester le son" : joue sans passer par la mémoire des ids. */
export function testNotificationSound(): void {
  playNotificationSound();
}
