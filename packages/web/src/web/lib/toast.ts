/**
 * Toasts — confirmations courtes et non bloquantes.
 *
 * [2026-09-15] Avant, l'app n'avait AUCUN système de ce genre : chaque
 * composant refaisait son propre état local éphémère (le `copiedMsgId` du chat
 * remis à zéro après 1500 ms, par exemple), et la plupart des actions
 * (sauvegarde, copie, suppression) ne confirmaient donc rien du tout. Le reste
 * passait par `window.alert()`, bloquant et hors charte.
 *
 * Un émetteur volontairement minuscule, hors React : `toast('Copié')`
 * s'appelle depuis n'importe où — composant, handler, module utilitaire — sans
 * contexte à traverser ni provider à brancher. `ToastHost` (monté une fois
 * dans app.tsx) est le seul abonné.
 */

export type ToastKind = 'info' | 'success' | 'error';

export interface ToastItem {
  id: number;
  message: string;
  kind: ToastKind;
  /** Durée d'affichage en ms. */
  duration: number;
}

type Listener = (t: ToastItem) => void;

const listeners = new Set<Listener>();
let seq = 0;

/** Dernier message affiché, pour ne pas empiler deux fois le même clic. */
let last: { message: string; at: number } | null = null;
const DEDUPE_MS = 400;

export function onToast(fn: Listener): () => void {
  listeners.add(fn);
  return () => { listeners.delete(fn); };
}

/**
 * Affiche un toast. `kind` 'error' reste un peu plus longtemps à l'écran :
 * un message d'échec doit être lisible, une confirmation peut filer.
 */
export function toast(
  message: string,
  kind: ToastKind = 'info',
  duration?: number,
): void {
  const text = message.trim();
  if (!text) return;

  const now = Date.now();
  if (last && last.message === text && now - last.at < DEDUPE_MS) return;
  last = { message: text, at: now };

  const item: ToastItem = {
    id: ++seq,
    message: text,
    kind,
    duration: duration ?? (kind === 'error' ? 5000 : 2600),
  };
  listeners.forEach(fn => {
    try { fn(item); } catch { /* un abonné cassé ne doit pas bloquer les autres */ }
  });
}

export const toastSuccess = (m: string, d?: number) => toast(m, 'success', d);
export const toastError = (m: string, d?: number) => toast(m, 'error', d);
