// Source unique du token d'authentification côté navigateur.
//
// Deux cas :
//  1. Session normale → localStorage['velbaz_token'] (persiste entre onglets).
//  2. Session d'emprunt admin ("login-as", panneau admin) → gardée EN MÉMOIRE,
//     dans ce frame/onglet uniquement. Jamais écrite dans localStorage : l'onglet
//     admin garde donc sa propre session, et fermer la fenêtre d'emprunt suffit
//     à l'oublier. Le token n'apparaît jamais dans l'URL (échange par code à
//     usage unique côté serveur).
//
// Tout le front doit lire le token via getAuthToken() — jamais localStorage
// directement, sinon la fenêtre d'emprunt lirait la session admin.

const KEY = 'velbaz_token';

let impersonationToken: string | null = null;
let impersonatedEmail: string | null = null;

export function setImpersonation(token: string | null, email?: string | null) {
  impersonationToken = token;
  impersonatedEmail = token ? (email ?? null) : null;
}

export function isImpersonating(): boolean {
  return !!impersonationToken;
}

export function impersonatedAs(): string | null {
  return impersonatedEmail;
}

// Fenêtre "login-as" ouverte dans CET onglet. Tant qu'elle l'est, l'onglet
// parent doit se comporter comme s'il n'était pas utilisé : les reprises au
// retour au premier plan (re-sync du chat, relance vidéo) sont neutralisées,
// sinon l'iframe et l'onglet se marchent dessus (chats dupliqués, bugs).
let loginAsOpen = false;

export function setLoginAsOpen(v: boolean) {
  loginAsOpen = v;
}

export function isLoginAsOpen(): boolean {
  return loginAsOpen;
}

// Vrai quand l'app ne doit PAS réagir au retour au premier plan : soit on est
// dans le frame d'emprunt, soit la fenêtre d'emprunt est ouverte par-dessus.
export function isBackgroundedByLoginAs(): boolean {
  return loginAsOpen || !!impersonationToken;
}

export function getAuthToken(): string | null {
  if (impersonationToken) return impersonationToken;
  try { return localStorage.getItem(KEY); } catch { return null; }
}

export function setAuthToken(token: string) {
  try { localStorage.setItem(KEY, token); } catch { /* mode privé */ }
}

export function clearAuthToken() {
  // En emprunt : on oublie seulement le token d'emprunt, pas la session admin.
  if (impersonationToken) { setImpersonation(null); return; }
  try { localStorage.removeItem(KEY); } catch { /* mode privé */ }
}
