/**
 * Détection de secousse de l'appareil (easter egg mobile).
 *
 * [2026-09-15] Trois secousses franches du téléphone pendant l'aperçu et le
 * rectangle « tombe » un instant avant de se remettre (classe `.preview-shake`,
 * styles.css). Rien de fonctionnel ne dépend de ça : le geste n'existe nulle
 * part ailleurs dans l'app, donc personne ne peut le déclencher par accident.
 *
 * Détails qui comptent :
 *  - iOS 13+ exige `DeviceMotionEvent.requestPermission()` sur un geste
 *    utilisateur. On ne la DEMANDE JAMAIS : demander la permission au
 *    chargement pour un easter egg serait indéfendable. Sur iOS l'œuf ne se
 *    déclenche donc que si la permission a déjà été accordée par ailleurs —
 *    accepté, l'œuf est un bonus, pas une fonctionnalité.
 *  - fenêtre de 1,2 s : les trois secousses doivent former UN geste, pas trois
 *    chocs étalés sur une minute de marche avec le téléphone en main.
 *  - `prefers-reduced-motion` respecté : on n'arme rien du tout.
 *  - listener passif, retiré au démontage, et désarmé quand `enabled` est faux
 *    (donc aucun accéléromètre écouté sur ordinateur ni aperçu fermé).
 */

import { useEffect, useRef, useState } from 'react';

/** Accélération (hors gravité) au-delà de laquelle on compte une secousse. */
const THRESHOLD = 16;
/** Les secousses doivent tenir dans cette fenêtre pour compter comme un geste. */
const WINDOW_MS = 1200;
/** Nombre de secousses à enchaîner. */
const NEEDED = 3;
/** Repos minimum entre deux secousses comptées (un choc = un pic, pas dix). */
const COOLDOWN_MS = 180;

export function useShake(enabled: boolean, onShake: () => void): void {
  const cb = useRef(onShake);
  cb.current = onShake;

  useEffect(() => {
    if (!enabled || typeof window === 'undefined') return;
    if (typeof DeviceMotionEvent === 'undefined') return;
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return;

    // iOS : sans permission déjà accordée, l'événement n'arrive jamais — on
    // branche quand même, ça ne coûte rien et ça marche sur Android.
    let hits: number[] = [];
    let lastHit = 0;

    const onMotion = (e: DeviceMotionEvent) => {
      const a = e.acceleration;
      // `acceleration` est null sur les appareils sans gyroscope réel : on ne
      // retombe pas sur `accelerationIncludingGravity`, dont la norme vaut
      // ~9,8 au repos et déclencherait des faux positifs.
      if (!a || a.x == null || a.y == null || a.z == null) return;

      const force = Math.sqrt(a.x * a.x + a.y * a.y + a.z * a.z);
      if (force < THRESHOLD) return;

      const now = Date.now();
      if (now - lastHit < COOLDOWN_MS) return;
      lastHit = now;

      hits = [...hits.filter(t => now - t < WINDOW_MS), now];
      if (hits.length >= NEEDED) {
        hits = [];
        cb.current();
      }
    };

    window.addEventListener('devicemotion', onMotion, { passive: true } as AddEventListenerOptions);
    return () => window.removeEventListener('devicemotion', onMotion);
  }, [enabled]);
}

/**
 * Variante prête à brancher sur du CSS : renvoie `true` pendant la durée de
 * l'animation, puis repasse à `false` tout seul.
 */
export function useShakeFlag(enabled: boolean, durationMs = 450): boolean {
  const [on, setOn] = useState(false);
  const timer = useRef<number | null>(null);

  useShake(enabled, () => {
    if (timer.current) window.clearTimeout(timer.current);
    setOn(true);
    timer.current = window.setTimeout(() => setOn(false), durationMs);
  });

  useEffect(() => () => { if (timer.current) window.clearTimeout(timer.current); }, []);

  return on;
}
