// ── L'app ne se recharge JAMAIS toute seule ───────────────────────────────
// Demande de l'utilisateur : « corrige que le site s'actualise tout seul ».
//
// En développement, c'est le client HMR de Vite qui recharge la page de son
// propre chef, dans deux cas — et les deux paraissent parfaitement aléatoires
// côté utilisateur :
//
//   1. `vite:ws:disconnect` — dès que la websocket HMR se coupe (serveur qui
//      redémarre, tunnel de preview qui coupe, veille de l'onglet, réseau qui
//      hoquette), le client attend que le serveur réponde puis appelle
//      `location.reload()`.
//   2. `full-reload` — le watcher de fichiers voit changer un fichier qu'il ne
//      sait pas mettre à jour à chaud (fichier écrit par le serveur pendant une
//      génération, asset dans public/, .html…) et demande un rechargement
//      complet.
//
// Vite n'expose pas d'option pour désactiver ces deux comportements. En
// revanche, il `await` les écouteurs de l'évènement AVANT de recharger : une
// exception levée dans l'écouteur interrompt le traitement du message et le
// `location.reload()` n'est jamais atteint. C'est la parade utilisée ici.
//
// Ce que ça change : les mises à jour à chaud (HMR normal, CSS, composants)
// continuent de fonctionner. Seul le rechargement COMPLET automatique est
// supprimé — l'utilisateur garde son scroll, son texte en cours et l'état de
// l'app. Si le serveur de dev redémarre vraiment, il suffit de rafraîchir
// manuellement (F5).
//
// En production, `import.meta.hot` n'existe pas : ce fichier ne fait rien.

if (import.meta.hot) {
  const hot = import.meta.hot;

  // 1. Coupure/reprise de la websocket HMR → pas de reload.
  hot.on('vite:ws:disconnect', () => {
    // Le message est volontairement discret : il ne doit pas ressembler à une
    // erreur dans la console de l'utilisateur.
    console.debug('[velbaz] connexion HMR perdue — rechargement automatique bloqué');
    throw new Error('velbaz: auto-reload disabled');
  });

  // 2. Demande de rechargement complet du watcher → pas de reload.
  hot.on('vite:beforeFullReload', () => {
    console.debug('[velbaz] full-reload demandé par Vite — bloqué');
    throw new Error('velbaz: auto-reload disabled');
  });
}

export {};
