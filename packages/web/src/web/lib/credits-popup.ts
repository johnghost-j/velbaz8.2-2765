/**
 * État partagé de la pop-up « crédits épuisés ».
 *
 * Il vit dans son propre module (et non dans le composant) pour deux raisons :
 *  - les deux emplacements — carte dans /chat et modale sur l'accueil — doivent
 *    lire exactement la même valeur ;
 *  - le réarmement (voir plus bas) doit fonctionner même quand la pop-up n'est
 *    montée nulle part, donc il est déclenché depuis le store d'auth.
 *
 * Règle : une fois fermée, la pop-up ne revient plus… sauf si l'utilisateur
 * regagne des crédits (solde > 0) puis les épuise à nouveau.
 *
 * Ce module n'importe rien : `lib/auth.ts` l'importe, l'inverse créerait un cycle.
 */

const DISMISS_KEY = 'velbaz_credits_empty_dismissed';

let dismissed: boolean = (() => {
  try { return localStorage.getItem(DISMISS_KEY) === '1'; } catch { return false; }
})();

const listeners = new Set<() => void>();

function emit() { listeners.forEach(fn => fn()); }

export function getCreditsPopupDismissed() { return dismissed; }

export function setCreditsPopupDismissed(v: boolean) {
  if (dismissed === v) return;
  dismissed = v;
  try {
    if (v) localStorage.setItem(DISMISS_KEY, '1');
    else localStorage.removeItem(DISMISS_KEY);
  } catch {}
  emit();
}

/**
 * Rappelé dès qu'un solde strictement positif est observé, d'où qu'il vienne
 * (login, /auth/me, recharge, ajustement admin). Le prochain passage à zéro
 * rallume donc la pop-up.
 */
export function rearmCreditsPopup() { setCreditsPopupDismissed(false); }

export function subscribeCreditsPopup(fn: () => void) {
  listeners.add(fn);
  return () => { listeners.delete(fn); };
}

// Synchronisation entre onglets.
if (typeof window !== 'undefined') {
  window.addEventListener('storage', (e) => {
    if (e.key !== DISMISS_KEY) return;
    const next = e.newValue === '1';
    if (next !== dismissed) { dismissed = next; emit(); }
  });
}
