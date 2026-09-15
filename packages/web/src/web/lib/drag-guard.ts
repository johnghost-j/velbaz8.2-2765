/**
 * [2026-09-13] Garde anti-gel du glissement natif (drag) — correctif du bug
 * « à un moment le site freeze, je ne peux plus rien cliquer ».
 *
 * Cause exacte, reproduite : quand on sélectionne un mot puis qu'on bouge la
 * souris en gardant le bouton appuyé, le navigateur démarre un GLISSEMENT NATIF
 * du texte sélectionné (dragstart). Si le nœud d'origine disparaît pendant ce
 * glissement — ce qui arrive tout le temps ici, parce que le chat se re-rend en
 * continu (message en cours d'écriture, étapes de build, polling) — Chrome
 * n'envoie JAMAIS le `dragend` correspondant : la session de glissement reste
 * ouverte côté navigateur. À partir de là, la souris appartient au glissement :
 * plus aucun clic n'atteint la page, la sélection de texte ne répond plus, et
 * seul un F5 remet tout d'aplomb. Vérifié : avec le nœud source retiré en
 * pleine glissade, `dragend` ne se déclenche pas (end=False) alors qu'il se
 * déclenche bien (end=True) quand le nœud reste en place.
 *
 * Correctif, en trois couches :
 *  1. On interdit le glissement natif de tout ce qui n'est pas explicitement
 *     déclaré déplaçable (`[draggable="true"]` : cartes CRM, tâches Autopilot).
 *     Sélectionner du texte continue de fonctionner normalement — c'est
 *     seulement le GLISSEMENT du texte/image/lien qui est coupé, et c'est lui
 *     qui gelait l'interface.
 *  2. Filet de sécurité : si un glissement démarre quand même (élément
 *     légitimement déplaçable) et que son nœud d'origine quitte le document, on
 *     annule la session au lieu de la laisser ouverte.
 *  3. Déverrouillage d'urgence : Échap, perte de focus ou onglet caché
 *     réinitialisent l'état de glissement de l'application.
 */

let installed = false;

/** Événement personnalisé émis quand il faut réinitialiser les surcouches de dépôt. */
export const DRAG_RESET_EVENT = 'velbaz:drag-reset';

function emitReset() {
  window.dispatchEvent(new CustomEvent(DRAG_RESET_EVENT));
}

/** true si l'élément (ou un parent) est explicitement déclaré déplaçable. */
function isAllowedDragSource(target: EventTarget | null): boolean {
  let el = target instanceof Element ? target : null;
  while (el) {
    if (el.getAttribute('draggable') === 'true') return true;
    // Les champs de fichier et les liens/images explicitement autorisés.
    if (el.hasAttribute('data-allow-drag')) return true;
    el = el.parentElement;
  }
  return false;
}

export function installDragGuard(): () => void {
  if (installed) return () => {};
  installed = true;

  let sourceNode: Node | null = null;

  const onDragStart = (e: DragEvent) => {
    if (!isAllowedDragSource(e.target)) {
      // Couche 1 : pas de glissement natif du texte / des images / des liens.
      e.preventDefault();
      sourceNode = null;
      return;
    }
    sourceNode = e.target instanceof Node ? e.target : null;
  };

  const onDrag = (e: DragEvent) => {
    // Couche 2 : le nœud d'origine a été retiré du document (re-render) →
    // le navigateur n'enverra pas de `dragend`. On coupe la session ici.
    if (sourceNode && !sourceNode.isConnected) {
      sourceNode = null;
      e.preventDefault();
      e.stopPropagation();
      emitReset();
    }
  };

  const onDragEnd = () => { sourceNode = null; emitReset(); };
  const onDrop = () => { sourceNode = null; emitReset(); };

  /**
   * Couche 3 — déverrouillage d'urgence. Échap remet l'interface dans un état
   * cliquable quoi qu'il arrive : plus besoin de recharger la page (F5) si un
   * état d'interaction reste coincé (glissement en cours, redimensionnement du
   * rectangle de preview, sélection de texte coupée, curseur figé).
   */
  const unlockAll = () => {
    sourceNode = null;
    document.body.classList.remove('resizing-preview');
    document.body.style.cursor = '';
    document.body.style.userSelect = '';
    try { window.getSelection()?.removeAllRanges(); } catch { /* ignore */ }
    emitReset();
  };

  const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') unlockAll(); };
  const onBlur = () => { sourceNode = null; emitReset(); };
  const onVisibility = () => { if (document.hidden) { sourceNode = null; emitReset(); } };

  document.addEventListener('dragstart', onDragStart, true);
  document.addEventListener('drag', onDrag, true);
  document.addEventListener('dragend', onDragEnd, true);
  document.addEventListener('drop', onDrop, true);
  window.addEventListener('keydown', onKey, true);
  window.addEventListener('blur', onBlur);
  document.addEventListener('visibilitychange', onVisibility);

  return () => {
    installed = false;
    document.removeEventListener('dragstart', onDragStart, true);
    document.removeEventListener('drag', onDrag, true);
    document.removeEventListener('dragend', onDragEnd, true);
    document.removeEventListener('drop', onDrop, true);
    window.removeEventListener('keydown', onKey, true);
    window.removeEventListener('blur', onBlur);
    document.removeEventListener('visibilitychange', onVisibility);
  };
}

/**
 * Abonne une surcouche « déposez vos fichiers ici » à la réinitialisation
 * globale, pour qu'elle ne puisse jamais rester affichée et bloquer les clics.
 */
export function onDragReset(fn: () => void): () => void {
  const h = () => fn();
  window.addEventListener(DRAG_RESET_EVENT, h);
  window.addEventListener('blur', h);
  document.addEventListener('dragend', h, true);
  document.addEventListener('drop', h, true);
  return () => {
    window.removeEventListener(DRAG_RESET_EVENT, h);
    window.removeEventListener('blur', h);
    document.removeEventListener('dragend', h, true);
    document.removeEventListener('drop', h, true);
  };
}
