## 2026-09-11 — Ré-import depuis GitHub sur infra managée neuve (template 0.8.0)

Le dépôt `velbaz7-1022` (template 0.7.0) a été recloné et porté tel quel sur un scaffold managé
fraîchement provisionné (Turso, Tigris S3, AI gateway, auth, Autumn). 524/524 fichiers repris,
aucun fichier perdu. Seuls `__ports.cjs` (lit désormais `.runable/ports.json`) et
`.template-version` viennent du nouveau scaffold ; les 13 autres fichiers protégés étaient déjà
identiques entre 0.7.0 et 0.8.0.

Vérifié : `bun install`, `db:push` (Changes applied), `bun run build` (tsc + vite, 2/2 packages),
dev sur 4200, routes / /login /dashboard /chat /editor /plans en 200, `/api/health` ok,
register + login réels en 200 (utilisateur de test supprimé ensuite), gateway IA ok.
Détail complet dans MIGRATION.md.

## 2026-09-11 — Pop-up « crédits épuisés » : itération 3 (taille + style visuel)

- `packages/web/src/web/components/CreditsEmptyPopup.tsx` restructuré :
  - sous-composants extraits : `CloseButton`, `Illustration`, `Actions`.
  - `BodyInline` (variante chat) : disposition **en ligne** (vignette 56 px à gauche,
    titre + texte + boutons compacts à droite). Hauteur de carte : **220 px → 115 px**.
  - `BodyCenter` (variante accueil) : mise en page verticale inchangée, juste extraite.
  - `Illustration` rend maintenant l'image dans une **vignette arrondie**
    (`data-testid="credits-empty-thumb"` : fond `--surface-3`, bordure `--border-subtle`,
    `border-radius` = 30 % de la taille, padding 13 %). L'image est un PNG détouré
    à fond transparent, elle ne flotte donc plus nue sur le fond de la carte.
- `packages/web/public/images/credits-empty.png` remplacée : carte de verre dépoli /
  dégradé iridescent (560×560 RGBA, détourée). **Choix provisoire** — l'utilisateur
  fournira l'image définitive plus tard ; il suffira d'écraser ce fichier, aucun code à toucher.
- 12 styles proposés en comparatif avant arbitrage (planches `candidates/comparatif-styles*.png`,
  hors build). Dossier de brouillons `public/images/candidates/` supprimé avant livraison.
- Vérifié : `tsc --noEmit` OK, `vite build` OK, **32/32 tests Playwright** (affichage
  chat + accueil en thèmes sombre et clair, hit-test et clic réel des 3 boutons,
  navigation vers `/plans`, persistance du dismiss, et cycle complet
  fermeture → recharge 500 → ré-épuisement → réapparition).

## 2026-09-11 — Pop-up « crédits épuisés » : clics + réapparition + nouvelle image

- **Réarmement déplacé hors du composant.** L'état « déjà fermée » vit maintenant dans `packages/web/src/web/lib/credits-popup.ts` (store de module + `localStorage`), et c'est `lib/auth.ts` qui l'efface via `useAuth.subscribe` dès qu'un solde > 0 est observé. Avant, la remise à zéro du flag était faite dans un effet de la pop-up : si les crédits remontaient pendant que l'utilisateur était ailleurs (page /plans, ajustement admin), personne ne voyait le solde repasser au-dessus de zéro et la pop-up ne revenait jamais après un cycle recharge → ré-épuisement. Vérifié : tokens 0 → fermeture → tokens 500 → tokens 0 rallume bien la pop-up, sur l'accueil ET dans le chat.
- **Clics.** La modale centrée est rendue dans `<body>` via `createPortal` (z-index 2147483000) au lieu d'être imbriquée dans l'arbre de l'accueil, et `pointer-events: auto` est posé explicitement sur l'overlay, la carte et chaque bouton. Hit-test Playwright : `elementFromPoint` renvoie bien `credits-empty-later` / `credits-empty-buy`, et « Get credits » navigue vers `/plans`.
- **Nouvelle image** `public/images/credits-empty.png` : sablier vidé avec un tas de pièces teal au fond, verre gris translucide (pas de grandes surfaces blanches) — lisible en thème sombre comme en thème clair. 560×560 RGBA détouré.

## [2026-09-11] Pop-up « crédits épuisés » (chat + accueil)

Nouveau composant `packages/web/src/web/components/CreditsEmptyPopup.tsx`, un seul contenu, deux rendus :
- `variant="inline"` → carte juste au-dessus de la barre de prompt dans `pages/chat.tsx`
- `variant="center"` → overlay modal centré dans `pages/index.tsx` (page d'accueil)

Déclenchement : `useAuth()` → utilisateur connecté, `loading === false` et `tokens <= 0`.
Le solde est déjà auto-synchronisé par `api.ts` (`notifyTokenUpdate`) → `auth.ts` (`updateTokens`),
donc aucun polling supplémentaire n'a été ajouté.

Règle de réapparition : clé `localStorage` `velbaz_credits_empty_dismissed`.
- Fermer la pop-up pose le drapeau → elle ne revient plus (même après reload).
- Dès qu'un solde `> 0` est observé, le drapeau est effacé → au prochain passage à zéro
  (cycle recharge → ré-épuisement) la pop-up réapparaît, comme demandé.
- Un listener `storage` synchronise l'état entre onglets / entre les deux emplacements.

Image centrale : `packages/web/public/images/credits-empty.png` (bocal vide + dernière pièce,
PNG RGBA détouré, 560×560) — lisible en thème sombre comme en clair.

Boutons : « Get credits » → `/plans` (ferme la pop-up), « Not now » → ferme. Échap ferme la
version centrée, clic sur le fond aussi.

Vérifié en Playwright (solde forcé à 0 via interception des réponses `/api`) : overlay présent
sur l'accueil (sombre + clair), carte inline présente dans le chat au-dessus de la barre de prompt,
dismiss persistant après reload. `tsc --noEmit` et `vite build` OK.

## [2026-09-10] Bouton X pour fermer le rectangle d'aperçu

- `packages/web/src/web/pages/chat.tsx` — barre de titre du rectangle d'aperçu
  (site / code / commandes / aperçu téléphone) : ajout d'une croix en haut à
  droite, juste après « Publish », dans un groupe `.preview-titlebar-actions`.
  Clic → `setPanelCollapsed(true)` ; on rouvre avec l'onglet du bord droit
  (`.preview-restore-tab`). L'aperçu de document (`DocPreviewPane`) avait déjà
  sa propre croix en haut à droite — inchangé. Le plein écran mobile garde sa
  croix en haut à gauche (à droite elle se cognerait avec celle du document).
- `packages/web/src/web/styles.css` — nouveaux `.preview-titlebar-actions`
  (marge auto à droite) et `.preview-close-btn` (26×26, même gabarit que la
  flèche d'élargissement, tokens neutres, pas de bleu). `.preview-publish-btn`
  perd son `margin-left: auto`, désormais porté par le groupe.
- Vérifié en navigateur réel (Playwright) : la croix ferme le rectangle,
  l'onglet du bord droit le rouvre. `tsc --noEmit` OK, `vite build` OK.

# [2026-09-10] Nouveau design de la carte d'apercu dans le chat

## Demande
« change le design du rectangle de preview (petit) dans le chat » — reprendre le
design envoye en image (carte avec icone globe, nom du projet et bouton
« Open », apercu arrondi en retrait).

## Choix valides par l'utilisateur
- Couleur : neutre velbaz (`var(--surface-3)`), pas le brun/prune #3D2929 de la
  maquette — seule la mise en page est reprise.
- Epingle de la maquette : retiree, seul « Open » reste. Le menu options
  (⋯ Branch / Rollback) reste sous la carte comme avant.
- Titre : nom du projet, comme sur la maquette (avant : libelle du checkpoint).

## Gabarit releve au pixel sur la maquette (446x311)
carte rayon 20 · en-tete 61 de haut · globe 18 a 13px du bord · titre 17px/500 a
15px du globe · bouton 65x35, rayon 12, texte 15px, bord droit aligne sur
l'apercu · apercu en retrait de 10px, rayon 8.

## Fait — `src/web/pages/chat.tsx` (`WorkResultCard`)
- En-tete refait : globe (`var(--text-dim)`) + nom du projet (17px, 500,
  tronque) + bouton « Open » a droite. L'ancien en-tete (coche + libelle du
  checkpoint) est supprime.
- La carte a un padding de 10 et l'apercu son propre rayon de 8 : il flotte en
  retrait au lieu d'etre a fleur des bords.
- Le bouton « Open » et l'apercu pointent sur la meme URL en nouvel onglet, avec
  le meme `onOpenPreview()`.
- Nouvelle prop `projectName`, alimentee par un state `projectName` rempli dans
  l'effet `api.companies.get(projectId)` deja present — aucune requete en plus.
- Repli si le nom manque : libelle du checkpoint, puis « Work done ».

## `src/web/styles.css`
- `.work-card-open` : fond transparent, survol `var(--surface-4)` + bord
  `var(--surface-5)`, sans changement de taille.

## Verifications (Playwright, projet AtelierNova, 6 checkpoints)
- Geometrie mesuree dans le DOM : carte rayon 20, en-tete 61, bouton 35 de haut
  / rayon 12 / aligne a droite sur l'apercu (ecart 0), apercu en retrait de 11
  (10 + la bordure) rayon 8, titre 17px = « AtelierNova ». Conforme a la maquette.
- Theme sombre et theme clair : rendu verifie en capture, les deux corrects.
- Variante mobile (mockup iPhone, `projectType` force a `mobile` par
  interception de la reponse API) : s'insere correctement dans le nouveau cadre.
- `Open` et l'apercu ont bien le meme href + `target=_blank` ; le menu ⋯ est
  toujours present sous la carte.
- `bun x tsc --noEmit` : 0 erreur. `bun x vite build` relance.

# [2026-09-10] Micro-gel de la video de fond au rebouclage (page d'accueil)

## Demande
« corrige que dnas la page home la vidoe au backgroinde je croei quand la vidoe
se recomance la vidoe freeze un tout petit momant »
-> la video de fond de l'accueil se figeait un instant chaque fois qu'elle
   repartait au debut.

## Cause
`src/web/components/GlobalVideo.tsx` n'avait qu'une seule balise `<video>` avec
`loop = true`. Le rebouclage natif du navigateur est un saut de la fin vers le
debut : le decodeur doit se re-amorcer, ce qui se voit comme un micro-gel pile
au raccord de la boucle.

Mesure du temoin (une couche, loop natif) : gel de ~21 ms a chaque bouclage,
repete periodiquement.

## Correctif : deux couches video en relais
- Deux `<video>` sur la meme source, superposees. Celle du dessous reste dans
  le flux (`position: relative`) et donne sa hauteur au conteneur, exactement
  comme la video unique d'avant ; celle du dessus est en `position: absolute`.
  (Passer les deux en absolute effondrait le conteneur a `height: 0` — piege
  rencontre et corrige.)
- `HANDOFF_SECONDS = 0.4` : 0,4 s avant la fin de la couche active, la couche en
  attente est remise a `currentTime = 0`, passee au-dessus et lancee, puis
  fond en opacite pendant que la sortante reste pleinement visible dessous —
  jamais d'image vide entre les deux.
- Surveillance image par image via `requestVideoFrameCallback` (repli sur
  `requestAnimationFrame`) : `timeupdate` ne se declenche que ~4x/s, trop grossier
  pour armer le relais.
- La couche sortante est ensuite mise en pause, rembobinee et masquee : son seek
  se fait hors ecran, la video visible ne se figera jamais.
- `loop` natif conserve sur chaque couche comme filet de securite : si le `play()`
  de la couche entrante est refuse, `abort()` annule le relais proprement et le
  loop natif reprend la main (au pire la micro-saccade revient, jamais d'image
  bloquee).
- Correction annexe : le filet de securite a 6000 ms reimposait l'opacite et
  pouvait rallumer une couche censee etre en attente — desormais conditionne a
  `if (!mainReady)`.

## Verifications
- `bun x tsc --noEmit` : 0 erreur.
- Gels mesures sur ~12 s (plusieurs bouclages), pire cas :
  - temoin loop natif : **20,8 ms**
  - accueil apres correctif (desktop) : **0,2 ms** (= bruit de mesure)
  - accueil apres correctif (mobile 390x844) : **0,7 ms**, couches bien
    dimensionnees (390x226, relative + absolute superposees)
- Theme clair : `filter: invert(1)` bien applique aux deux couches, rendu verifie
  en capture apres un relais.
- Cas de repli provoque (play() de la couche 2 rejete de force) : la couche
  visible continue en loop natif, aucune erreur console, rien de fige.
- `bun x vite build` relance pour que `dist/` ne serve pas l'ancien bundle.

# [2026-09-10] Duree d'abonnement + commande admin pour offrir un plan

## Demande
« Je sais pas si ca existe, mais si ca n'existe pas fais que depuis le panel
admin, grace a une commande, je puisse donner a quelqu'un un des abonnements,
et je peux decrire la duree si besoin, sinon ca met la date normale. »

## Ce qui a ete fait

### 1. Notion de duree d'abonnement — `src/api/plans.ts`
- `DEFAULT_DURATION_DAYS` : 30 jours en mensuel, 365 en annuel.
- `addDays` / `addMonths` (gere les mois plus courts : 31 janvier + 1 mois
  tombe fin fevrier, pas le 3 mars).
- `parsePlanDuration(input)` comprend :
  - une duree relative : `30d`, `3m`, `3 mois`, `1y`, `1 an`
  - une date absolue : `2026-12-31`, `31/12/2026`, `31-12-2026`
  - un mot-cle illimite : `forever`, `infini`, `illimite`, `permanent`,
    `jamais`, `lifetime`, `a vie`
  Une saisie incomprise renvoie une erreur explicite avec des exemples —
  on ne devine jamais une date.
- `isPlanExpired`, `activePlan(plan, expiresAt)` (retombe sur `free` si la
  date est passee), `formatPlanDate` (date lisible en francais).

### 2. La date de fin est stockee en base
Nouvelle colonne `users.plan_expires_at` (`schema.ts` +
`runtime-tables.ts`, migration automatique au demarrage).

### 3. Un abonnement expire ne compte plus
`effectivePlan()` passe par `activePlan()` : des que la date est passee,
tous les blocages retombent au niveau Free, meme si la colonne `plan` dit
encore « business ». `syncExpiredPlan()` remet proprement le compte en Free
en base a la premiere lecture (`/plans/me`, `/plans/subscribe`, `/auth/me`) —
pas besoin de tache planifiee.
Verifie : un compte force a « business expire depuis 100 secondes » se fait
refuser `/documents/generate` avec le message Business, et `/plans/me`
renvoie bien `free` juste apres.

### 4. Achat self-service : une date de fin est posee
`POST /plans/subscribe` ecrit `plan_expires_at` a +30 jours (mensuel) ou
+12 mois (annuel). `free` n'a jamais de date de fin.

### 5. Commande admin (le coeur de la demande)
`set-plan <username|email> <free|business|enterprise|banned> [duree|date]`
(alias : `plan`, `upgrade`, `give-plan`, `gift`)

Exemples :
- `set-plan jean@x.com business` → date normale, +30 jours
- `set-plan jean@x.com business 2m` → 2 mois
- `set-plan jean@x.com enterprise 1y` → 1 an
- `set-plan jean@x.com business 2026-12-31` → date precise
- `set-plan jean@x.com business forever` → sans date de fin
- `set-plan jean@x.com banned` → comportement de bannissement inchange

Le terminal affiche `ancien plan → nouveau plan`, la date de validite, et
les credits offerts. Les credits mensuels du plan sont accordes
automatiquement en cas de montee de plan (comme pour un achat normal),
jamais sur une descente.
Refus explicites : plan inconnu, duree incomprehensible, date deja passee.

### 6. La date est visible partout
- `whois <user>` dans le panel admin : `Plan: business (jusqu'au 10/11/2026)`
  ou `(sans date de fin)`.
- Page `/plans` cote utilisateur : « Active until … » sous le plan en cours.
- `GET /admin/users` et `GET /admin/users/:id/full-profile` renvoient
  `planExpiresAt` (+ `effectivePlan` pour le full-profile).

## Verifications
`bun x tsc --noEmit` : 0 erreur.
Tests API reels sur comptes jetables : sans duree (+30j), `1y`, `3 mois`,
date absolue, `forever`, duree invalide (400), date passee (400),
expiration reelle simulee en base (retour a Free confirme cote blocages,
cote `/plans/me` et cote `/auth/me`).
Test UI reel dans le terminal admin (F8) : `set-plan … business 2m` puis
`whois` affichent bien la meme date. Comptes de test supprimes.

# [2026-09-10] Abonnements reels + achat de plan en un clic

## Demande
« Fais fonctionner les abonnements. Pour l'instant la puissance qui est
mise est en Business ; maintenant fais que si la personne n'est pas en
Business ce soit un peu moins fort et sans acces a certaines choses, pour
que ce soit vrai. Et fais qu'on puisse acheter les abonnements (j'integrerai
Stripe apres) : pour l'instant, quand je clique, ca achete. »

## Ce qui a ete fait

### 1. Source unique de verite des plans — `src/api/plans.ts` (nouveau)
`free` / `business` / `enterprise` : prix, nombre de projets, credits inclus,
palier IA max (`maxTier`) et 12 droits (`mobileApp`, `autopilot`, `reports`,
`advancedModels`, `team`, `buyCredits`, `removeBadge`, `prioritySupport`,
`apiAccess`, `integrations`, `sso`, `dedicatedSupport`).
Helpers : `normalizePlan` (absorbe les anciennes valeurs `pro`/`biz`/`ent`
sans reecrire la base), `can`, `featureGate` (message FR pret a afficher),
`projectLimitError`, `capTier`.

### 2. Blocages REELS cote serveur (403 avec message + plan requis)
`/tokens/purchase` (buyCredits), `/documents/generate` (reports),
`/companies` + `/companies/quick` (quota projets : 1 en Free, 10 en Business,
illimite en Enterprise), `/companies/:id/collaborators` (team),
`/companies/:id/project-type` en mobile/both (mobileApp), conversion vers
mobile depuis le chat (reponse conviviale dans le chat, pas un 403 sec),
`/companies/:id/autopilot/enable` et `/autopilot/trigger` (autopilot),
badge « Made with Velbaz » retire uniquement si le plan y donne droit.

### 3. Puissance IA reellement plafonnee
`/chat` et `/chat/stream` passent le palier demande par `capTier(tier, plan)`
et ignorent le choix de modele explicite sans le droit `advancedModels`.
Verifie : un compte Free qui force `tier: "max"` est servi en
`gpt-5.4-nano` ; le meme compte en Business obtient `gpt-5.4`.

### 4. Achat de plan fonctionnel sans Stripe
`POST /plans/subscribe` : change `users.plan` immediatement, credite les
credits inclus en montee de plan (x12 en annuel), renvoie plan precedent,
credits accordes, droits et limites. Refuse les plans inconnus (400), refuse
un compte suspendu (403), repond `alreadyActive` si le plan est deja actif.
`GET /plans/me` renvoie le plan affiche, le plan effectif, les limites, les
droits et l'usage. Page `/plans` : chaque bouton achete vraiment (etat
« Activating… », message de resultat, carte qui passe a « Current Plan »),
Enterprise achetable en un clic comme Business.
Stripe se branchera autour de `/plans/subscribe` sans toucher au reste.

### 5. Comptes admin
Aucun blocage de plan (droits Enterprise), sans modifier ni masquer le plan
reellement enregistre en base.

## Bug corrige au passage — suppression de compte (RGPD + admin)
`DELETE /admin/users/:id` et la suppression de compte self-service
echouaient en 500 (`delete from companies` en violation de cle etrangere) :
la cascade listait ~22 tables ecrites a la main, alors que ~70 tables portent
un `company_id`/`user_id` (autopilot_config, autopilot_logs, project_files,
social_posts, ...). `src/api/gdpr.ts` decouvre desormais les tables a vider
dans le schema SQLite et repasse tant que des suppressions progressent — les
tables ajoutees plus tard sont couvertes automatiquement.

## Verifications
`bun x tsc --noEmit` : 0 erreur. Comptes de test jetables (crees puis
supprimes) : les 7 blocages Free renvoient bien 403, achat Business puis
Enterprise annuel (6 000 000 credits) OK, actions debloquees apres achat,
plan invalide -> 400, meme plan -> `alreadyActive`. Parcours UI Playwright
sur /plans : clic sur Business -> « Business plan active! 75,000 credits
added. », carte en « Current Plan », solde 80 000 credits, zero erreur
console. Suppression de compte re-testee : `ok: true`.

# [2026-09-10] Chasse aux bugs de l'app

## Demande
« Cherche s'il y a des bugs dans l'app et corrige-les tous sans rien casser. »

## Methode
Lecture des logs serveur + agregation de la table `error_logs` (erreurs
reellement remontees en prod), relecture du code des zones fautives, puis
verification apres CHAQUE lot : `bun run typecheck`, `bun run test`,
`bun run build`, balayage Playwright (console + reseau) sur /dashboard,
/profile, /settings, /inbox, /orders, /company/:id, et ~45 routes API en curl.

## Bugs corriges

1. **SSE « Invalid state: Controller is already closed » (45 occurrences)**
   Quand le client fermait l'onglet pendant une edition d'app, le premier
   `controller.enqueue()` suivant levait — et cassait la suite du traitement :
   message assistant jamais persiste, checkpoint jamais ecrit.
   - `src/api/index.ts` : nouvelle fabrique `sseChannel(controller, encoder)`
     (`send` no-op apres fermeture, `close` idempotent) utilisee par
     `streamAppEdit` / `streamMobileAppEdit` ; `startHeartbeat` coupe son timer
     des que l'envoi echoue ; `sseSingleReply`, les deux flux « je reprends la
     construction », `has-mobile/has-web` et « plan annule » sont protejes —
     dans ces deux derniers cas l'insertion en base du message assistant se
     faisait APRES un enqueue non protege, donc le message etait perdu.
   - `src/api/builder/scaffold.ts` : meme protection dans le flux `/ai/chat`
     genere pour les apps des utilisateurs.

2. **`Aucun fichier modifie` sans cause (17 occurrences)**
   `src/api/builder/engine.ts` avalait l'exception de chaque fichier. La cause
   reelle (panne fournisseur, quota, timeout) est desormais conservee
   (`lastFileError`) et jointe au message d'erreur.

3. **401 sur les appels autopilot / profil**
   `src/web/pages/company.tsx` (9 appels) et `AppBuilderTab.tsx` (1) lisaient
   `localStorage.getItem('token')` — mauvaise cle, toujours `null`. La cle est
   `velbaz_token` et doit passer par `getAuthToken()` (qui gere aussi l'emprunt
   de session admin). Verifie : plus aucune requete 4xx au balayage navigateur.

4. **Compteur « terminees aujourd'hui » jamais remis a zero**
   `src/api/autopilot.ts` comptait toutes les taches `completed` depuis la
   creation de l'entreprise. Ajout du filtre `completedAt >= minuit`.

5. **Statut autopilot en 500 sur coupure reseau Turso (39 occurrences)**
   `getAutopilotStatus` est pollee en boucle par l'UI et ne retentait rien.
   `dbRetry` a ete extrait de `index.ts` vers `src/api/db-retry.ts` (sans
   import circulaire) et applique aux 7 lectures de cette fonction.

6. **`bun run test` sortait en erreur (17/20 tests)**
   `vitest` ne chargeait pas le `.env` du monorepo → `DATABASE_URL` undefined →
   `LibsqlError: URL_INVALID`. Ajout de `envDir: '../../'` et d'un
   `vitest.setup.ts` qui charge le `.env` racine. Resultat : 20/20.

## Verifie mais non modifie (faux positifs)
- `test2-routes.ts` « run annule » : deja corrige (le depart du client
  n'annule plus le run) ; les 29 lignes en base sont anterieures.
- `GlobalVideo.tsx` : `setInterval(resume, 1500)` sans `clearInterval` est
  volontaire (filet anti Low Power Mode iOS), protege par un singleton
  `keepAliveStarted` — un seul timer pour toute la vie de la page.
- Routes qui repondent 400/302 (`/admin/notify/history`, `/crypto/news`,
  `/companies/:id/website`) : comportement attendu, pas des bugs.

## Verification finale
`typecheck` OK · `test` 20/20 · `build` OK · balayage Playwright : 0 erreur
console, 0 requete en echec.

# [2026-09-10] L'app ne se recharge plus toute seule

## Demande
« Corrige que le site s'actualise tout seul » — dans l'app Velbaz (pas
l'apercu du site genere), la page entiere se rechargeait de facon aleatoire.

## Cause
Le client HMR de Vite recharge la page de lui-meme dans deux cas :
- `vite:ws:disconnect` : des que la websocket HMR se coupe (serveur de dev qui
  redemarre, tunnel de preview, onglet en veille, reseau qui hoquette), il
  attend le retour du serveur puis appelle `location.reload()`. C'est ce cas
  qui donnait l'impression d'un rechargement aleatoire.
- `full-reload` : le watcher voit changer un fichier qu'il ne sait pas mettre a
  jour a chaud (assets ecrits par le serveur pendant une generation, public/,
  .html). Une partie etait deja neutralisee par `server.watch.ignored`.

## Correctif
- `src/web/lib/no-auto-reload.ts` (nouveau) : bloque les deux rechargements en
  levant une exception dans les ecouteurs `vite:ws:disconnect` et
  `vite:beforeFullReload` — Vite `await` ces ecouteurs avant de recharger, donc
  le `location.reload()` n'est jamais atteint. Le HMR normal (composants, CSS)
  continue de s'appliquer. Inerte en production (`import.meta.hot` absent).
- `src/web/main.tsx` : import du module en premier.
- `vite.config.ts` : `server.watch.ignored` etendu a `skill_test1/**` et
  `dist/**` (assets ecrits par l'IA pendant un run + sorties de build).

## Verifications
- Redemarrage du serveur de dev avec la page ouverte : plus aucun rechargement,
  l'etat de la page est conserve (temoin `window.__mark` intact, aucun event de
  navigation). La console affiche seulement le message de blocage.
- `touch` d'un fichier de public/ et ecriture dans data/ : aucun rechargement.
- `touch src/web/styles.css` : `[vite] hot updated` — le HMR marche toujours.
- `bun run typecheck` et `bun run build` : OK.

# [2026-09-10] Suppression du bleu sur les boutons et les icônes

## Demande
Plus aucun bouton bleu ni icône bleue dans l'app. Le bleu reste autorisé
uniquement pour le texte (liens, libellés).

## Décisions actées avec l'utilisateur
- Les boutons bleus passent au bouton neutre déjà présent dans le thème
  (`--btn-primary-bg` / `--btn-primary-fg`), pas de nouvelle couleur.
- Côté icônes, seule la catégorie « bordures et contours bleus (cadre de
  sélection, zone de dépôt) » est concernée.
- Restent volontairement bleus : badges/pastilles, avatars, couleurs de
  graphiques, points d'état animés, spinners, barres de progression,
  curseur/sélection de texte, et tout le texte.

## Ce qui a été fait
- Cause principale trouvée : le token `--teal` (`#4EAADC`) — même bleu que
  `--blue-accent` — utilisé sur ~214 emplacements, invisible aux greps
  précédents. C'est lui qui gardait le bouton **Publish** du preview en bleu.
- `styles.css` : `.preview-publish-btn` → `--btn-primary-bg`.
- ~90 remplacements ciblés (boutons, icônes SVG, onglets actifs, bordures de
  sélection et de zone de dépôt) dans settings, plans, chat, index, company,
  community, money-maker, editor, reset/forgot-password, et les composants
  DomainsPanel, TemplateMarketplace, SupportPanel, SocialRightPane,
  SocialConnectPopup/Panel, ProductVisualizer, InventionVisualizer,
  BrandPreview, CrmTab, CommunityDashboard, AppBuilderTab, AIApprovalPopup,
  AIPopup, AiCommsPanel, ProjectTabs, Sidebar.
- Toggles (`#6B97FF`/`#5C89F2`) de settings et money-maker → neutres.
- Thème de l'éditeur visuel (`FG.accent = #0d99ff`, sélection, poignées,
  overlays injectés dans l'iframe) → gris/blanc, textes repassés en sombre
  pour garder le contraste.
- Sidebar : icône de nav active et icône de projet actif → `--text-primary`.
- SupportPanel : avatar d'en-tête et bulle utilisateur → neutres.

## Vérifications
- `bun run typecheck` : exit 0.
- Captures Playwright inspectées : `/`, `/chat/:id`, `/settings`, `/plans`,
  `/company/:id`, `/company/:id/editor`, `/money-maker`, `/community`,
  `/dashboard`, `/profile` — plus aucun bouton ni icône bleus.
- Le timeout observé une fois sur `/dashboard` était transitoire (la page
  charge normalement avec `wait_until="domcontentloaded"`).

# [2026-09-10] Vrais pouvoirs de l'IA : navigateur, terminal, code, fichiers, API

## Demande
Donner à l'IA du chat de VRAIS pouvoirs, pas des simulations :
navigation web réelle (clic, formulaire, login, scroll), captures d'écran
qu'elle VOIT, terminal shell, exécution de code JS/Python, lecture/écriture des
fichiers du projet, appels d'API externes avec les clés de l'utilisateur.
Décisions actées avec l'utilisateur :
- Terminal et code dans un **bac à sable isolé et jetable**, sans accès à la
  base ni aux clés.
- Anti-détection **niveau basique gratuit** seulement (vrai Chrome, empreinte
  réaliste, délais humains, en-têtes corrects). Pas de proxy ni de service
  anti-CAPTCHA payant.
- **L'IA décide seule** quand utiliser un outil, pendant la conversation, et
  l'utilisateur voit chaque action en direct.

## Ce qui a été fait
- `src/api/agent-tools/sandbox.ts` — terminal/code isolé.
  - `isolationLevel()` détecte `sudo -n -u nobody` (mémoïsé). Si l'isolation
    n'est pas disponible, `runShell` **refuse d'exécuter** au lieu de retomber
    sur les droits du serveur (mieux une capacité en moins qu'une fuite).
  - Bac à sable = dossier `mkdtemp` jetable, un par session de chat.
    Timeout imposé par `timeout` DANS le sandbox (le kill depuis le serveur ne
    marche pas : le process appartient à root via sudo) + filet `setTimeout`.
  - Recyclage : `lastUsed` sur chaque bac à sable, balayage des abandonnés
    (> 30 min) à chaque `getSandbox`, et balayage au chargement du module des
    dossiers `/tmp/velbaz-sbx-*` de plus de 2 h (un redémarrage serveur perd la
    Map en mémoire, les dossiers resteraient sinon pour toujours).
  - Garde-fous : 120 s par commande, 20 000 caractères de sortie,
    200 commandes par session.
- `src/api/agent-tools/browser.ts` — vrai Chrome persistant par session.
  - `playwright-core` sur `/opt/google/chrome/chrome`,
    `--disable-blink-features=AutomationControlled`, UA Chrome 126,
    locale `fr-BE`, géoloc Bruxelles.
  - `STEALTH_INIT` : `navigator.webdriver`, `window.chrome.runtime`,
    `permissions.query`, vendor/renderer WebGL, `hardwareConcurrency`,
    `deviceMemory`, et `navigator.plugins` reconstruit avec de VRAIS objets
    `Plugin`/`PluginArray` (un simple tableau d'objets était détecté).
  - `detectBlock()` : un blocage (Cloudflare, 403…) est DIT au modèle au lieu de
    lui renvoyer une page vide qu'il prendrait pour du contenu.
  - Sessions Chrome fermées après 10 min d'inactivité.
- `src/api/agent-tools/tools.ts` — les outils exposés au modèle :
  `web_search`, `web_open`, `web_act` (click/type/scroll), `run_command`,
  `run_code`, `list_project_files`, `read_project_file`, `write_project_file`,
  `http_request`, `list_api_keys`.
  - Les captures sont uploadées et renvoyées au modèle en base64 via
    `toModelOutput` : il VOIT réellement la page.
  - Clés d'API : le modèle écrit `{{NOM_DE_LA_CLE}}`, le serveur substitue
    depuis `companySecrets`. Il ne voit jamais une valeur, et toute clé
    renvoyée en écho par l'API est re-masquée avant d'arriver dans le chat.
    Clé référencée mais absente → appel NON envoyé, message explicite.
  - Outils fichiers/API actifs seulement si une company est en contexte.
- `src/api/agent-tools/loop.ts` — boucle de tool-calling (`generateText`,
  `stopWhen: stepCountIs(12)`, timeout global 600 s, repli sur d'autres
  modèles). Renvoie `null` si rien n'aboutit → l'appelant repasse par la
  génération classique, le chat n'est jamais cassé.
- `src/api/agents/orchestrator.ts` : `tryAgentTools()` branché en tête de
  `handleQuestion` et `handleProjectChat`, avant l'ancien chemin.
- `src/web/pages/chat.tsx` : la « caméra live » n'affiche plus un faux
  « Preview loading… » pour une étape de code (aucune image n'arrivera jamais) —
  elle montre le code réellement exécuté, en monospace. Une étape de code
  n'hérite plus non plus de la capture du site précédente (ça laissait croire
  que le code tournait sur cette page).

## Vérifications réellement exécutées
- Isolation : `run_command` → `uid=65534(nobody)` ; lecture de
  `/home/user/velbaz-app/.env` depuis le sandbox → `Permission denied`.
- Sandbox : Python 3.13.5 et Node v26.7.0 exécutés, réseau OK (curl 200),
  timeout à 2 s effectif (`timedOut:true` en ~2012 ms), code de sortie
  personnalisé propagé, dossier supprimé à la destruction.
- Recyclage : bac à sable inactif 31 min → effacé au `getSandbox` suivant ;
  bac à sable récent conservé ET toujours utilisable après balayage ;
  dossier `/tmp` de 3 h contenant un fichier appartenant à `nobody` → supprimé
  au chargement du module, les récents intacts.
- Anti-détection : https://bot.sannysoft.com/ → tous les indicateurs
  « passed », y compris « Plugins is of type PluginArray ».
- Navigateur : navigation réelle sur example.com et vercel.com/pricing
  (capture téléchargée et regardée : bien la vraie page, prix Pro à 20 $).
- Interaction réelle : DuckDuckGo HTML — saisie dans le champ, validation,
  lecture du premier résultat (« THE 10 BEST Pizza Places in Brussels… »).
- Fichiers projet (company AtelierNova, réelle) : `list_project_files`
  (62 fichiers / 5 pages), création, relecture conforme, réécriture
  (`version` passée à 2 en base), fichier inexistant → message honnête,
  lecture d'une page réelle. Fichier de test supprimé après coup.
- Clés d'API (secret de test inséré puis supprimé) : substitution confirmée
  côté serveur distant (httpbin a bien reçu l'en-tête), valeur re-masquée dans
  la réponse, aucune fuite dans `list_api_keys` ni dans les étapes `progress`,
  refus propre sur clé manquante, erreur DNS et HTTP 403 remontées telles quelles.
- Bout en bout sur le VRAI endpoint `/api/chat/stream` (4 scénarios) :
  calcul par code (329 011 283 et 21 171 191, tous deux revérifiés à part),
  `web_search` + `web_open`, enchaînement navigateur multi-étapes + shell,
  et « sous quel utilisateur » → `nobody`.
- Affichage : test navigateur réel (Playwright) sur `/chat` — badges
  « CODING » (avec le code affiché) et « BROWSING » (avec la capture) vus en
  direct, réponse finale correcte rendue, aucune erreur console.
- `bun run typecheck` (web) : 0 erreur. `bun run typecheck:api` : 79 erreurs,
  identique à la baseline connue (une régression introduite dans `tools.ts` a
  été trouvée et corrigée).

## État connu / points ouverts
- `MAX_STEPS = 12` dans `loop.ts` : validé jusqu'à 4 allers-retours réels.
  Un login multi-étapes long n'a pas été testé faute de compte de test.
- Anti-détection basique par choix : un site protégé par Cloudflare
  « managed challenge » restera bloqué — le modèle le dit au lieu d'inventer.
- `write_project_file` sur une page (`page:<slug>`) écrit `htmlContent` ;
  pour une company de type projet React, les pages ne contiennent qu'un
  pointeur vers `/project-files` (comportement existant, non modifié).
- Le second appelant d'`orchestrate()` (chemin non streamé, `src/api/index.ts`)
  ne passe pas `onProgress` : les outils fonctionnent, mais sans retour live.

---

# [2026-09-10] Publish : bouton + popup, et onglet « Domains » dans le Dashboard

## Demande
Bouton « Publish » en haut à droite du rectangle de preview ; clic → popup
(édition du sous-domaine, « More Settings » qui agrandit la popup avec une
animation) ; « Custom domain » → pas une page à part, mais un ONGLET dans la
page Dashboard du projet.

## Ce qui a été fait
- `src/web/pages/chat.tsx` : bouton « Publish » dans `.preview-titlebar`
  (state `publishOpen`) qui monte `<PublishModal>`. Style `.preview-publish-btn`
  dans `src/web/styles.css`.
- `src/web/components/PublishModal.tsx` : réécrit — auth via `getAuthToken()`,
  sous-domaine éditable avec vérif de disponibilité, « More Settings » animé
  (hauteur en transition), Availability (Wake on Active / Always On) avec les
  coûts réels venant du backend. « Add custom domain » renvoie vers
  `/company/:id?tab=domains`.
- `src/web/components/DomainsPanel.tsx` : ancien `pages/domains.tsx` transformé
  en panneau réutilisable `DomainsPanel({ companyId })` (plus de route ni
  d'onglet ProjectTabs séparés — la route `/company/:id/domains` a été retirée
  de `app.tsx`).
- `src/web/pages/company.tsx` : onglet « Domains » ajouté (type `Tab`,
  `TAB_DESCRIPTIONS`, liste des onglets, rendu `<DomainsPanel companyId={id!} />`).
  L'onglet actif s'initialise depuis `?tab=…` pour que la popup Publish ouvre
  directement Domains.
- `src/api/index.ts` :
  - Hébergement facturé pour de vrai à la publication (`HOSTING_COST`,
    `hostingCovered()`, `chargeHosting()`, colonnes `hostingBilledAt` /
    `hostingBilledMode` sur `companies`) : 500 crédits/mois en Wake on Active,
    5000 en Always On, une seule fois par période de 30 jours.
  - `GET /companies/:id/domains/search` : disponibilité RÉELLE via RDAP.
    Correctif : on interroge le serveur RDAP officiel du TLD (bootstrap IANA
    `data.iana.org/rdap/dns.json`, mis en cache 24 h) au lieu du proxy
    `rdap.org`, qui renvoyait des 403 en rafale et faisait afficher « inconnu »
    partout. `rdap.org` reste en second recours.
  - `POST /companies/:id/domains/buy` : achat réel via Namecheap, et 501
    explicite (`needsApiKey`) tant que les clés registrar manquent.
  - `publicOrigin()` : `http://` en local (localhost / 127.0.0.1 / [::1]),
    sinon le lien « En ligne » était cassé en dev.

## Vérifications réellement exécutées
- `typecheck` web : 0 erreur. `typecheck:api` : 79 erreurs = baseline inchangée.
- Navigateur (Chrome + Playwright, session de test) :
  - Dashboard → onglet « Domains » présent et rendu correct (capture).
  - `/company/:id?tab=domains` ouvre directement l'onglet.
  - Chat → « Publish » → popup → « Add custom domain » → arrive sur le
    dashboard avec l'onglet Domains actif.
  - Recherche : `velbaztestxyz9182.*` → « disponible » sur les 8 TLD,
    `google.com` → « déjà pris ». Clic « Buy » → message honnête listant les
    clés Namecheap manquantes (aucun faux succès).
  - Connexion d'un domaine existant → enregistré + CNAME affiché.
  - Publication réelle : 500 crédits débités une seule fois (vérifié en base :
    `users.tokens` et `token_transactions`), republication dans les 30 j → pas
    de nouveau débit ; `curl /s/ateliernova` → 200.

## État connu / points ouverts
- Aucune clé Namecheap configurée → l'achat de domaine reste bloqué (501) tant
  que l'admin ne les ajoute pas.
- Projet de test `AtelierNova` laissé publié (sous-domaine `ateliernova`) ;
  le domaine de test `test-velbaz.example.com` a été déconnecté après les tests.
  500 crédits de test débités sur le compte admin (solde ~999,99 M, négligeable).

# [2026-09-10] Bouton « Précédent » dans le questionnaire de l'IA

## Demande
« quand l ai posse des question je veux que en bas a guache il y a un bouton
prevews question pour aller a la question précédente »

## Ce qui a été fait
- `src/web/components/QuestionTool.tsx` :
  - `QuestionPrompt` accepte `onBack` et `initialAnswer` ; la barre d'actions
    passe en `justify-between` : « ‹ Précédent » en bas à GAUCHE, Skip/Next à
    droite. Pas de bouton sur la 1re question.
  - L'effet de reset ne vide plus le formulaire quand une réponse existe déjà
    pour cette question : options re-cochées (libellés retrouvés dans la réponse
    enregistrée, le reste retourne dans le champ libre) et texte réaffiché.
  - `QuestionTool` relaie `onBack(index)` et `answers` (index → réponse).
- `src/web/pages/chat.tsx` : le questionnaire passe `onBack={(idx) =>
  setQuestionIndex(Math.max(0, idx - 1))}` et `answers={questionAnswers}`.

## Vérifications réellement exécutées
- `typecheck` web : 0 erreur. `bun run build` racine : OK.
- Navigateur réel, questionnaire réel de l'IA (6 questions) :
  - Q2 : bouton « ‹ Précédent » visible en bas à gauche (x=507) face à Next
    (x=1101) ; absent sur la Q1.
  - Retour depuis Q2 → Q1 : l'option « France » est re-cochée (badge bleu).
  - Question à texte libre (« Quel nom veux-tu donner à ton projet ? ») :
    « Le Levain Vert » saisi, Next, puis Précédent → le texte est bien réaffiché.
- Données de test supprimées (session, companies vides, messages).

# [2026-09-10] Commande /test2 — visualisation image par page puis site bâti dessus

## Demande
« /test2 ... des entreprises plus belles » : même flux de création que
d'habitude (questions, plan de pages), avec DEUX ajouts seulement — après
validation du plan, une image de maquette PAR page s'affiche dans le chat, puis
le code du site est généré en reproduisant fidèlement ces images.
Contrainte répétée : INTERDIT de réutiliser /genesis, /chimera ou /test1 comme
moteur (design différent, tâches différentes, lent, buggé). Autorisé : réutiliser
la TECHNIQUE de relevé/découpe de /chimera.
Clarifié via questions : une image par page (pas une planche unique) ; le build
enchaîne tout seul après les images, sans validation supplémentaire.

## Ce qui a été fait
- `src/api/test2-visual.ts` (nouveau) : pipeline autonome. 1 appel LLM →
  direction visuelle + un prompt d'image par page ; `generateContentImage` par
  page ; relevé par `transcribeFrame` ; plaque propre par page ; spec
  déterministe à marqueurs `[[CADRE-TRANSCRIT ...]]` + bloc d'URLs, écrite en
  base (`genesis_runs`, id préfixé `test2-`, sessionId = companyId). N'importe
  QUE `transcribeFrame`/`persistChimeraAsset`/`generateContentImage` — aucun
  appel à `runChimera`, `runGenesisFlow`, `runTest1Flow`.
- `src/api/test2-routes.ts` (nouveau) : `POST /test2/visualize`, auth + contrôle
  de propriété de la company, stream SSE. Ne crée aucune company.
- `src/api/index.ts` : route montée ; le journal du build distingue désormais
  « Spec /test2 rechargée » de « /genesis » (`srcLabel`). Aucune autre
  modification du pipeline de build.
- `src/web/pages/chat.tsx` : interception `/test2` (barre de chat + home),
  drapeau persisté en `sessionStorage`, `startTest2AfterPages`,
  `runTest2Visualization` (SSE → une tâche + une image par page), puis
  `startBuildNow` classique. Verrou `test2Gate` (via `setBuildGate`) pour
  empêcher le build de partir AVANT l'écriture de la spec.
- `src/web/components/SlashMenu.tsx` : entrée `/test2`.

## Bugs trouvés en test réel puis corrigés
1. Build lancé EN PARALLÈLE de la visualisation → le site se construisait sans
   les images (log : « le run ne s'est pas terminé (statut running) »). Corrigé
   par le verrou `test2Gate`, relâché juste avant `startBuildNow`.
2. `cancel()` du ReadableStream déclenchait l'`AbortController` → run tué avec
   « run annulé » et spec vide dès que le client fermait le flux. `cancel()` ne
   coupe plus le run : il finit et persiste sa spec.
3. `slugify()` : diacritiques mal retirés → `normalize("NFD")` + suppression des
   combining marks.

## Vérifications réellement exécutées
- `typecheck` web : 0 erreur. `typecheck:api` : 79 erreurs = baseline exacte
  d'avant la tâche, aucune dans les fichiers test2.
- `bun run build` racine : OK (2 tâches réussies).
- Test navigateur réel bout en bout (Chrome headless, session réelle, company
  créée par le flux normal) : 6 pages validées → 6 maquettes générées et
  affichées, aucune erreur ; log « build refusé — commande /test2 : le site
  attend les images » puis « [build-gate] relâché » ; puis « 🎨 Spec /test2
  rechargée (12 asset(s) du run) — le code des pages utilisera CES images » ;
  6 pages construites OK + QA live 0 bug.
- Fidélité maquette ↔ site, comparée image par image sur les 6 pages
  (captures Playwright du site servi contre les `*-ui.webp`) : structure, titres,
  sections, libellés, palette et typographie reproduits fidèlement sur les 6.
  Le site est plus riche que la maquette (nav complète, footer détaillé,
  bandeau cookies, sections en plus) mais dans la même direction artistique.
- Flux SANS /test2 inchangé : vérifié dans le code — `startTest2AfterPages`
  rend `false` immédiatement sans le drapeau, et le pipeline de build n'a reçu
  aucune modification hors le libellé de journal.

## État connu / points ouverts
- Page « Personnalisation Coffret » : la mise en page est fidèle mais la grille
  de tablettes est vide côté site (« Aucune tablette disponible ») — données
  produits non semées, pas un défaut de reproduction.
- Relâchement du verrou sur la voie d'erreur de visualisation : `test2Gate(false)`
  est bien hors du try/catch, donc le build repart après un échec. Vérifié par
  lecture du code, pas par un échec provoqué en navigateur.
- `⚠️ Pack visibilité — repli sur le modèle intégré (visibility: unparseable
  JSON)` observé en fin de build : pré-existant, sans lien avec /test2.
- Les tests ont consommé des tokens du compte admin (remis à 5000 pour pouvoir
  tester alors qu'il était à 0 ; il reste 1018). Données de test supprimées :
  companies, genesis_runs, sessions, sites sur disque, maquettes, scripts.

# [2026-09-10] Édition de texte quasi instantanée (voie rapide sans IA)

## Demande
« corrige j ai die a l ai change le mot La mode que tu crées. L'atelier qui la
fait naître. par La mode que tu crées. L'atelier qui la fait naître test . et
elle rpend tros de tend vraiment beacoup just epour ajour un mot rend l ai plus
puissant et rapide »
→ Changer UN mot prenait des dizaines de secondes. Rendre ça rapide.

## Cause réelle
Pour la moindre retouche, `streamAppEdit` enchaînait :
1. `planPhases()` — un appel modèle juste pour juger si la demande est complexe ;
2. `editApp()` — un planificateur IA (choix du fichier) PUIS une réécriture
   COMPLÈTE du fichier par Claude Sonnet (Showroom.tsx = 17 872 caractères
   régénérés pour ajouter un mot) ;
3. `startDevServer()` systématique — le serveur d'aperçu était tué et relancé
   alors que le HMR de Vite suffisait.

## Ce qui a été fait
- `src/api/builder/engine.ts` : nouveau `microEdit()` DÉTERMINISTE, zéro appel
  modèle. Il lit « change/remplace A par B » (FR+EN), retrouve A dans le code en
  tolérant les retours à la ligne JSX et les apostrophes typographiques, et
  écrit B. Garde-fous : cible limitée à `src/**`, `public/**`, `index.html`
  (jamais `.velbaz/*` ni `marketing/*` qui contiennent les mêmes phrases) ;
  exige UNE seule occurrence dans UN seul fichier ; refuse ce qui ressemble à du
  code (`<>{}`=\`) ; vérifie que ≥60 % des mots du texte source sont dans le
  fichier. Au moindre doute → `null` et le chemin IA complet reprend la main.
- `src/api/index.ts` :
  - voie rapide en tête de `streamAppEdit` (patch + écriture disque + DB +
    diff `[CODE_EDIT]` + checkpoint, puis `return`) ; le serveur n'est démarré
    que s'il ne tourne pas déjà — sinon le HMR fait le travail ;
  - `planPhases()` n'est plus appelé pour les retouches manifestement minuscules
    (`looksSmallTweak` : ≤160 caractères, sans liste, sans verbe de création ni
    vocabulaire de fonctionnalité) — au moindre doute, comportement d'avant ;
  - `hmrEnough` : plus de redémarrage du serveur quand tous les fichiers
    changés sont des sources `src/**` et que le serveur tourne déjà.

## Vérifications réellement exécutées
- `bun run typecheck` (web) : 0 erreur. `bun run typecheck:api` : 79 erreurs
  = baseline inchangée. `bun run build` racine : OK.
- Tests unitaires de `parseTextReplacement`/`microEdit` sur les 62 fichiers
  réels d'AtelierNova : 5 formulations reconnues et remplacées au bon endroit ;
  « ajoute une page contact », « refais tout le site en bleu », « change la
  couleur du header », un remplacement de balise JSX et « change la couleur de
  fond par du rouge » retournent bien `null` (→ chemin IA).
  Défaut trouvé et corrigé au passage : l'article initial du texte (« La mode… »)
  était avalé par le regex, ce qui faisait rater la cible.
- Bout en bout sur le vrai endpoint `POST /api/chat/stream` (AtelierNova) :
  micro-édition traitée en **2 secondes** (contre ~85 s pour le chemin IA
  mesuré juste après sur la même société), DB en version+1, fichier disque à
  jour, serveur d'aperçu NON redémarré (uptime conservé), et le module servi
  par le serveur d'aperçu contenait bien le nouveau texte.
- Non-régression : « mets le titre principal du showroom en italique » (non
  reconnu par microEdit) passe toujours par `editApp` → 1 fichier modifié,
  « ⚡ Changements appliqués à chaud », sans plan en phases.
- Navigateur réel (Chrome headless, 1500×900, chat d'AtelierNova) : la ligne
  « ⚡ Texte remplacé : … » apparaît en ~1 s, le message final est correct, et
  l'iframe d'aperçu affiche le texte modifié sans rechargement complet.
- Données de test restaurées : Showroom.tsx remis à l'identique (17 872 car.,
  version 2), messages/activités de test purgés, 2 « Nouveau projet » créés par
  les essais supprimés, session d'auth de test supprimée, scripts `scratch-*`
  effacés.

## État connu / points ouverts
- Le regex ne couvre que « change/remplace/modifie/renomme/corrige A par B ».
  Une demande formulée autrement (« enlève le mot test ») passe par l'IA.
- Sur une cible présente plusieurs fois, on laisse volontairement l'IA choisir.

# [2026-09-10] Rectangle de preview : sommets arrondis + flèche plein largeur

## Demande
« je veux changer un trcuk je veux que la prevex a droite le rectangle sois pas
un rectangle qui vas tout en haut moi je vexu que sa sosi un rectangle et les
somet en haut sont arondie et pas ua max parce que apres en haut il y a le titre
du trcuk ( sois fichier ou sois app ou si te ou autre) et la fleche en haut elle
permet que la prevew prenx le scale de l ax x de tout le tchat et le fleche
change de direction pour que quan dje réapui sa remet comme avant et aussi si j
evexu je peux skale aussi comme si qu il existe déjà »

## Cause réelle
Le panneau de preview de droite collait au bord haut (aucun retrait, aucun
sommet arrondi), et seul l'aperçu document avait une barre de titre : le site,
le code et les commandes n'affichaient aucun titre. Aucun mécanisme de
« plein largeur » n'existait : la largeur venait uniquement de --preview-w
(poignée de redimensionnement).

## Ce qui a été fait
- `packages/web/src/web/components/PreviewWideButton.tsx` (nouveau) : la flèche.
  Une seule icône (double chevron) qui pivote de 180° selon l'état → change de
  direction, avec transition.
- `packages/web/src/web/pages/chat.tsx` :
  - state `previewWide` + dérivé `previewWideActive` (= previewWide && !isMobile
    && !phoneZone && effectiveShowPreview) et `previewTitle`
    (Communications IA / Commandes / Code / Application / Site web).
  - conteneur du panneau : `marginTop: 8`, `borderTopLeftRadius/RightRadius: 14`
    (arrondi modéré, pas au max), `borderTop` ajouté ; largeur `100%` quand
    `previewWideActive`, sinon `var(--preview-w)` comme avant.
  - colonne de chat : `width: 0` + `minWidth: 0` en mode plein largeur
    (transition width existante conservée).
  - poignée `.resize-handle` masquée en plein largeur, intacte sinon.
  - nouvelle barre de titre `.preview-titlebar` (flèche + titre) pour tout ce
    qui n'est pas un document ; l'aperçu document reçoit `wide`/`onToggleWide`
    et affiche la flèche dans sa propre barre du haut.
- `packages/web/src/web/components/DocPreviewPane.tsx` : props optionnelles
  `wide` / `onToggleWide`, flèche rendue en tête de `.doc-preview-topbar`.
- `packages/web/src/web/styles.css` : `.preview-titlebar` (+ padding-right 56px
  en desktop pour ne pas passer sous le bouton flottant « Ouvrir le panneau »),
  `.preview-titlebar-label`, `.preview-wide-btn`.

## Vérifications réellement exécutées
- `bun run typecheck` (web) : 0 erreur. `bun run typecheck:api` : 79 (baseline).
- `bun run build` racine : OK.
- Chrome headless réel, société AtelierNova, viewport 1500x900 :
  - Site web : panneau x=785 w=715, top=8, border-top-radius 14px, titre
    « Site web » affiché, poignée présente.
  - Clic flèche → panneau x=260 w=1240 (= toute la largeur du chat), flèche
    `matrix(-1,0,0,-1,0,0)` (180°), poignée masquée.
  - 2e clic → retour exact à x=785 w=715, flèche remise droite.
  - Drag de la poignée après retour → w=917 : le scale fonctionne toujours.
  - Aperçu document (Stratégie Marketing.pdf) : flèche dans la barre du doc,
    plein largeur w=1240, contenu toujours éditable, croix de fermeture
    toujours atteignable (`elementFromPoint`) en plein largeur, retour OK.
- Session et scripts de test supprimés (vérifié : 0 ligne restante).

## État connu / points ouverts
- Sur téléphone : rien ne change (preview déjà plein écran, flèche non rendue).
- Zone Téléphone (preview mobile à largeur fixe 640) : pas de flèche non plus,
  ce panneau reste hors du rectangle scalable.

# ── APERÇU ÉDITABLE DES FICHIERS DU CHAT DANS LE RECTANGLE DE PREVIEW (2026-09-10) ──

## Demande
« je veux qeu dnas le tcaht quand l ai a fini et met les ficheir par exemple Stratégie
Marketing.pdf quand je click sa telecharge totu de suit emoi je veux que uqand je click
l aperson du conteneue dedant se met dnas le rectangle pervex a la place du site et en
haut a droite je pexu telecharger le fichier et dnas la prevew je peux modifier le
contenue mais quan dl ai travail je peux pas modifier le contenue sa die un message . »

Choix confirmés au formulaire : rendu MIS EN FORME et éditable directement dedans ·
sauvegarde auto + bouton · téléchargement au choix PDF ou fichier source · message de
blocage laissé au choix du système.

## Cause réelle
Le chip `[FILE:chemin|libellé]` du chat était un simple `<a href download>` vers
`/companies/:id/file-download`, qui convertit en PDF côté serveur : le clic déclenchait
donc le téléchargement immédiat. Aucune route ne servait la source en JSON, aucune ne
permettait de la réécrire, et le rectangle de preview ne connaissait que le site, le
code, les commandes et le téléphone.

## Ce qui a été fait
- **API** (`src/api/index.ts`, après `file-download`) : helper `fileRouteUser(c)` (auth
  header OU `?token=`, comme le téléchargement) + `GET /companies/:id/file-content?path=`
  (source brute en JSON, pas de conversion PDF) + `PUT /companies/:id/file-content`
  (`{path, content}` → `content`, `updatedAt`, `version+1`). Même contrôle d'accès que
  `file-download` (propriétaire ou admin). `updated_at` est une colonne TEXT : on y écrit
  une chaîne ISO (une `Date` faisait +1 erreur au typecheck API).
- **`src/web/lib/doc-markdown.ts`** (nouveau) : `markdownToHtml` / `htmlToMarkdown`,
  écrits à la main, **aucune dépendance ajoutée** (`marked`/`turndown` absents du projet ;
  `api/chat-file-pdf.ts` n'est pas importable côté client, il tire `playwright-core`).
  Couvre titres, gras/italique/code, liens, listes, tableaux, citations, blocs de code, hr.
- **`src/web/components/DocPreviewPane.tsx`** (nouveau) : charge la source, l'injecte en
  HTML mis en forme dans un `contentEditable`, sauvegarde 1,2 s après la dernière frappe
  + bouton « Enregistrer » + au `blur`, statut (Modifié / Enregistrement… / Enregistré /
  Échec). Barre du haut à droite : menu Télécharger (PDF via `file-download`, source via
  `&raw=1`) et fermeture. Verrouillé (`locked`) → bandeau ambre `AI_BUSY_MESSAGE`
  « L'IA travaille sur ce projet — édition bloquée le temps qu'elle termine. », lecture
  seule, bouton Enregistrer masqué.
- **`src/web/pages/chat.tsx`** : le chip fait `preventDefault()` et ouvre
  `setDocPreview({path,label})` (le `href`/`download` restent pour le clic droit) ;
  `aiBusy = chatLoading || streamingContent || isBuildingThis || isBuildingWebsiteThis` ;
  `effectiveShowPreview` inclut `!!docPreview` (un fichier ouvre le rectangle même sans
  site) ; branche `DocPreviewPane` prioritaire dans la zone de contenu ; les boutons
  Preview / Code / Orders et `onOpenPreview` font `setDocPreview(null)` (sinon changer
  d'onglet n'aurait rien changé à l'écran) ; le bouton flottant « Next » est masqué
  pendant l'aperçu d'un document.
- **`src/web/styles.css`** : styles `.doc-preview-body` (h1-h6, p, listes, tableaux,
  code, citations, hr) — sans eux le contentEditable rendait tout à la même taille.

## Vérifications réellement exécutées
- `bun run typecheck` (front) : **0 erreur**. `bun run typecheck:api` : **79**, la
  baseline exacte (80 au premier passage à cause du `Date` sur `updated_at`, corrigé).
- Test navigateur réel (Chrome headless, session admin temporaire) sur AtelierNova :
  clic sur « Stratégie Marketing.pdf » → `GET file-content` 200, pane affiché à la place
  du site, contenu rendu mis en forme (1 h1, 9 h2, 37 gras, 2 tableaux, 84 puces ;
  h1 26,8 px vs p 14,5 px), `contentEditable=true`, frappe → statut « Modifié » puis
  « Enregistré », `PUT file-content` 200 et contenu bien modifié en base.
- Menu de téléchargement : « PDF — Stratégie Marketing.pdf » et « Fichier source —
  Strategie-Marketing.md » (le nom source vient du chemin, pas du libellé `.pdf`).
  Vérifié en curl : sans `raw` → `%PDF-1.4` + `filename="Test-Doc.pdf"` ; avec `&raw=1`
  → Markdown + `filename="Test-Doc.md"`.
- État verrouillé testé en forçant temporairement `aiBusy = true` (patch retiré ensuite,
  vérifié par `rg`) : bandeau affiché, `contentEditable=false`, bouton Enregistrer absent,
  frappe ignorée, aucun `PUT` émis, téléchargement toujours possible.
- Aller-retour Markdown → HTML → Markdown contrôlé sur un document de test : gras,
  italique, lien, listes et tableaux conservés, et **stable** au second enregistrement.
- `bun run build` : OK (2 tasks successful).
- Données de test supprimées (société `zztest-docprev-company`, ses `project_files` et
  messages, session temporaire) ; fichier AtelierNova restauré à l'identique (8138
  caractères, version 1) ; scripts jetables supprimés.

## Correctif de suivi (même jour)
« quand je ouvre un fichier dans la preview c'est plus le site du coup ça devrait pas
avoir le bouton next en bas à droite » → le bouton flottant « Next » est masqué dès
qu'un document est ouvert (garde `!docPreview`), vérifié en navigateur : 1 bouton Next
avant le clic, 0 pendant l'aperçu, de retour après fermeture. Bug voisin trouvé au
passage et corrigé : le bouton flottant « Ouvrir le panneau » (position absolue,
top 12 / right 12, z-index 90) recouvrait la croix de fermeture de l'aperçu et rendait
le clic impossible → la barre du haut de l'aperçu réserve maintenant 56 px à droite sur
ordinateur (classe `.doc-preview-topbar`, 10 px seulement sous 769 px de large).

## État connu / points ouverts
- L'aller-retour d'édition **reformate légèrement** le Markdown : une ligne vide est
  ajoutée après les titres et l'alignement des colonnes de tableau (`|---:|`) est perdu
  (devient `| --- |`). Aucun contenu perdu, et le résultat est stable ensuite.
- L'erreur console React « An empty string ("") was passed to the %s attribute » est
  **préexistante** : elle apparaît sur la page de chat sans ouvrir aucun fichier.
- Le PDF téléchargé est celui produit par `chat-file-pdf.ts` à partir de la source
  enregistrée : les modifications faites dans l'aperçu s'y retrouvent bien.

# ── DÉBIT AU COÛT IA RÉEL : 1 $ CONSOMMÉ = 3000 CRÉDITS (2026-09-10) ──

## Demande
« enfaite quand l ai utilsue environ 1 dollar de credit sa doie débiter 3000 credits
du compte » (+ « Oui, on garde 5000 » pour le solde de départ)

→ le débit du solde doit suivre le coût IA RÉELLEMENT consommé, pas un forfait par
action. Chaque appel IA débite `coût_réel_$ x 3000`.

## Cause réelle
Les deux tâches précédentes n'avaient touché que le **reporting** (`CREDITS_PER_USD`
= 3000 dans `ai-usage/pricing.ts`) et le **forfait** (`TOKEN_COSTS` x3). Le débit réel
du solde restait forfaitaire : `deductTokens(userId, action)` retirait un montant fixe
par action, sans aucun lien avec le coût dollar de l'appel. Un chat court et un chat
énorme coûtaient tous les deux 15 crédits.

Le coût réel était pourtant déjà calculé partout : le middleware du gateway
(`ai-usage/middleware.ts`, branché par `wrapLanguageModel` dans `agent/gateway.ts`)
capture 100 % des appels IA (texte, stream, images) et `ai-usage/recorder.ts` calcule
déjà `credits = usdToCredits(costUsd)`. Il n'était simplement jamais débité.

## Ce qui a été fait
Difficulté centrale : le coût n'est connu qu'**après** l'appel, alors que
`deductTokens` est un **pré-débit**. Architecture retenue : **garde a priori +
post-débit au coût réel**.

1. Nouveau `packages/web/src/api/ai-usage/billing.ts` :
   - `chargeRealUsage({userId, credits, costUsd, feature})` — débite `users.tokens`,
     insère une ligne `token_transactions` (`type: usage`, `action: ai:<feature>`,
     note = coût $ et crédits exacts). Solde **jamais négatif** (clamp à 0).
   - `chargeBatch(rows)` — regroupe un lot par utilisateur, un seul débit par usager.
   - Les crédits réels sont fractionnaires alors que le solde est entier : le **reste
     est reporté** par utilisateur (`Map` sur `globalThis`, survit au HMR SSR) — rien
     n'est perdu ni surfacturé.
   - Respecte la règle du recorder : **ne throw jamais, ne bloque jamais**.
2. `ai-usage/recorder.ts` : `flush()` appelle `await chargeBatch(batch)` après
   l'insertion des évènements. Un seul point de branchement couvre tous les appels IA.
3. `api/index.ts` — `deductTokens` passe en **deux régimes** :
   - action normale → **GARDE SEULE** : vérifie que le solde couvre l'estimation
     `TOKEN_COSTS[action]`, **ne débite rien** (le vrai débit arrive après coup) ;
   - action de `EXTERNAL_FLAT_ACTIONS` (nouveau : `hf_image`, `hf_video`, `ad_video`)
     → **débit forfaitaire immédiat, comme avant**. Higgsfield ne passe pas par le
     gateway IA, son coût n'est jamais mesuré : sans ça il deviendrait gratuit.
     Les remboursements `addTokens(..., 'refund', TOKEN_COSTS[...])` restent donc
     cohérents avec ce qui a été débité.
4. Commentaire d'en-tête de `TOKEN_COSTS` réécrit : ce n'est plus un prix mais un
   **seuil de garde**, sauf pour les actions externes.

Non touchés volontairement : `TOKEN_PACKAGES` (vente 1000 cr = 1 €), `CREDITS_PER_USD`
(3000), solde de départ (5000, confirmé par l'utilisateur), les 18 call sites de
`deductTokens` (inchangés — le changement de régime est interne à la fonction).

## Vérifications réellement exécutées
- `bun run typecheck:api` → **79 erreurs**, exactement la baseline (aucune régression).
- Serveur dev rechargé (`(ssr) page reload src/api/index.ts`), `/api/health` → 200,
  `/api/tokens/packages` → 200.
- **Test bout-en-bout du débit réel** (script jetable, supprimé depuis) : vrai appel
  `generateText` sur `google/gemini-3-flash` avec `userId` admin dans le contexte IA.
  - petit appel : coût 0,0002 $ → 0,6 crédit → solde inchangé, reste reporté (correct,
    < 1 crédit) ;
  - gros appel : coût **0,004221 $ → 12,66 crédits** → solde **4780 → 4768**
    (12 débités, 0,66 reporté) + ligne `token_transactions` `ai:billing_test`,
    `amount -12`, `balance 4768`. **Le ratio 3000 crédits / $ est vérifié en réel.**
- Données de test nettoyées : 3 `ai_usage_events` et 1 `token_transactions` supprimés,
  solde admin restauré à 4780. Scripts jetables supprimés.
- `bun run build` → OK (2/2 tasks).

## État connu / points ouverts
- **Solde négatif impossible**, mais un dépassement reste possible sur un seul gros
  appel : la garde vérifie une estimation, pas le coût final. Le surplus est absorbé
  (clamp à 0), il n'est pas facturé.
- **Dévaluation x3 des soldes existants** : les crédits déjà détenus achètent 3x moins
  d'IA qu'avant. Non compensé (signalé, jamais tranché).
- **Mélange € / $** : packs vendus en euros, coût IA en dollars. Le x3 n'est exact que
  si 1 € ≈ 1 $.
- Le report fractionnaire vit en mémoire du process : un redémarrage perd au maximum
  < 1 crédit par utilisateur. Négligeable, assumé.
- Higgsfield reste au forfait tant que son coût réel n'est pas remonté par une API.

# ── MARGE x3 SUR LES CRÉDITS : BARÈME TOKEN_COSTS x3 (2026-09-10) ──

## Demande
« revenon en arrier moi pour mile credits sa me couet 1 dollar moi je veux que sa leur
coute 3 dollard ducoup quand il commance leur compte il son 5000 k et 3k = a 1 dollard
et fait les calculle »

→ ce qui lui coûte 1 $ doit être facturé 3 $ à l'usager ; solde de départ 5000 crédits ;
3000 crédits = 1 $ ; et fournir les calculs.

## Cause réelle
Le taux de reporting `CREDITS_PER_USD = 3000` était déjà en place (tâche précédente),
et le solde de départ était **déjà** à 5000 crédits. Le vrai problème était ailleurs :
`TOKEN_COSTS` (`api/index.ts:1345`), le barème qui débite réellement le solde, était
calibré « coût réel x 1000 » alors que les crédits sont **vendus** à 1000 crédits = 1 €
(`TOKEN_PACKAGES`). Résultat : revente à **prix coûtant, marge nulle**. Ce n'est donc
pas le taux qu'il fallait toucher mais le barème de débit.

## Ce qui a été fait
`TOKEN_COSTS` multiplié par 3 (coût réel x 3000 au lieu de x1000), + commentaire d'en-tête
réécrit pour documenter la marge x3 et le lien avec `CREDITS_PER_USD` :
chat 5→15, company_create 20→60, heartbeat 3→9, website_build 50→150, site_ai_call 5→15,
image_gen 30→90, doc_gen 10→30, email_gen 5→15, ad_gen 10→30, hf_image 30→90,
hf_video 300→900, ad_video 500→1500, browser_task 10→30, orchestrate 20→60,
autopilot_tick 5→15.

Non touchés (volontairement) : `TOKEN_PACKAGES` (prix de vente inchangés),
`CREDITS_PER_USD` (déjà à 3000), solde de départ (déjà à 5000).

## Les calculs
Modèle : vente 1000 crédits = 1 € · débit 3000 crédits par 1 $ de coût IA réel
→ l'usager paie **3x** le coût. Marge brute **66,7 %**.

Solde de départ 5000 crédits :
- valeur au prix de vente : **5 €** offerts
- coût IA réel maximum qu'il peut consommer : 5000 / 3000 = **~1,67 $**
- soit, par action : 333 chats, ou 33 sites, ou 55 images, ou 3 pubs vidéo

Packs (coût IA réel maximum couvert = crédits / 3000) :
- 4 990 cr / 4,99 € → ~1,66 $ de coût → marge ~3,33 €
- 9 990 cr / 9,99 € → ~3,33 $ → marge ~6,66 €
- 24 990 cr / 24,99 € → ~8,33 $ → marge ~16,66 €
- 49 990 cr / 49,99 € → ~16,66 $ → marge ~33,33 €

## Vérifications réellement exécutées
- `bun run typecheck:api` → **79** erreurs = baseline inchangée. `bun run build` → OK.
- **Live** `GET /api/tokens/packages` → `costs` renvoie bien chat:15, website_build:150,
  ad_video:1500, hf_video:900, etc. (barème x3 actif en runtime, pas seulement en source).

## État connu / points ouverts
- ⚠️ **Dévaluation des soldes existants** : les utilisateurs gardent leur nombre de
  crédits, mais ces crédits achètent désormais 3x moins d'IA. Non compensé.
- ⚠️ **Mélange € / $** : les packs sont en euros, le coût IA en dollars. La marge réelle
  x3 n'est exacte que si 1 € ≈ 1 $. À trancher (indexer les packs en $, ou ajuster).
- ⚠️ **Faiblesse structurelle** : `TOKEN_COSTS` reste un barème *forfaitaire estimé*, pas
  le coût réel mesuré. Si une action coûte réellement plus que l'estimation (ex. un chat
  à 0,02 $ au lieu de 0,005 $), la marge x3 n'est pas tenue sur cette action. Le coût réel
  est déjà mesuré dans `ai_usage_events` : brancher le débit sur
  `usdToCredits(coût réel)` garantirait le x3 sur chaque appel. Non fait — demande
  explicite requise, c'est un changement de modèle de facturation.

# ── PANNEAU RÉSEAUX : PLUS QUE « COMMUNICATIONS IA », TOUS RÉSEAUX (2026-09-10) ──

## Demande
« je vexu que uqan dje chois une platforme pour twetteur enlaive l application twetter
enlaive tout laisse juste pour totu les platfrome la partit comunication ai »

→ quand on choisit un réseau, retirer l'app Twitter intégrée et tout le reste ; ne laisser
que la partie « Communications IA », pour tous les réseaux.

## Cause réelle
Pas un bug : le dispatcher `packages/web/src/web/components/SocialRightPane.tsx` affichait,
par réseau sélectionné, une barre de bascule à deux vues :
- vue « live » → Twitter : `XCloneLogin` puis `XCloneApp` (clone Twitter, 2145 l.) ;
  `XLiveViewer` (vrai X dans un Chrome piloté) déjà en veille via `X_LIVE_ACTIVE = false` ;
  autres réseaux : écran « Se connecter à … » (OAuth).
- vue « Communications IA » → `AiCommsPanel`.

Ce composant est partagé par les deux points d'entrée (`SocialConnectPanel` monté dans
`chat.tsx`, et `SocialSandboxOverlay` côté admin), donc un seul correctif couvre les deux.

## Ce qui a été fait
Tout est dans `SocialRightPane.tsx`, en suivant la convention du fichier (drapeau,
**rien de supprimé sur le disque**, anciennes branches conservées inertes) :
1. Nouveau drapeau `SOCIAL_ONLY_AI_COMMS = true`.
2. Court-circuit : dès qu'un réseau est choisi → `AiCommsPanel` seul, plein cadre.
   Court-circuite l'app Twitter intégrée, X en direct, le bouton OAuth et la barre de
   bascule (inutile : il ne reste qu'une vue). Placé après les hooks → ordre des hooks
   inchangé. Pas de wrapper : `AiCommsPanel` porte déjà `h-full flex flex-col min-h-0`.
3. L'effet qui appelait `/api/x-live/status` sort immédiatement sous le drapeau
   (plus aucune requête x-live inutile).

Repasser `SOCIAL_ONLY_AI_COMMS` à `false` restaure l'ancien comportement complet.

## Vérifications réellement exécutées
- `bun run typecheck` (front) → **0** erreur. `bun run build` → OK. HMR pris (log vite).
- **Test navigateur** (Chrome piloté, session admin temporaire, sandbox social) :
  - Twitter sélectionné → uniquement `AiCommsPanel` : compteurs ENVOYÉS / VUES /
    ENGAGEMENTS / RÉPONSES IA, onglets Publications/Réponses, « L'IA n'a encore rien
    envoyé sur ce réseau. » — **confirmé sur capture d'écran**.
  - Absents comme voulu : « Se connecter à », barre « Communications IA »,
    `XCloneLogin`, pitch « vraie session ».
  - **Aucune requête `/api/x-live`** observée.
  - Instagram sélectionné → même panneau (le « tous réseaux » est vérifié, pas supposé).
- Piège de test à retenir : les libellés des compteurs ont la classe `uppercase`, donc
  `inner_text` renvoie « ENVOYÉS » — une recherche sensible à la casse donne un faux
  négatif. Autre piège : `page.fill('textarea')` tape dans le composer du chat (premier
  match du DOM), il faut cibler le placeholder du formulaire sandbox.
- Nettoyé : société sandbox de test (`ZZ Verif OnlyComms`) supprimée, session de test
  supprimée (vérifié : 0 ligne restante), scripts et captures jetables supprimés.

## État connu / points ouverts
- ⚠️ **Il reste un bouton de connexion, hors panneau de droite** : le pied de cadre
  « Connect N Platform(s) » (`SocialConnectPanel.tsx:459-470`, même chose dans
  `SocialSandboxOverlay`), plus l'en-tête « Connect Your Platforms »
  (`SocialConnectPanel.tsx:320`). Non touchés : ils sont en dehors du panneau réseau
  lui-même et les retirer casserait le flux de connexion du sandbox admin. À confirmer
  avec l'utilisateur s'il veut aussi les enlever.
- Code mort désormais inatteignable mais **conservé volontairement** :
  `XCloneApp.tsx` (2145 l.), `XCloneLogin.tsx`, `XLiveViewer.tsx`, et côté API
  `social/x-live.ts`, `x-embed.ts`, `x-algo.ts`. Pas de git sur ce dépôt → une
  suppression disque serait irréversible ; à ne faire que sur demande explicite.

# ── TAUX DE CONVERSION : 1 $ D'IA = 3 000 CRÉDITS VELBAZ (2026-09-10) ──

## Demande
« corrige que moi j eveux que 1 dollard utiliser par l ai doie prendre 3 k credits de velbaz . »

## Cause réelle
Pas un bug : une valeur de configuration. Le taux de conversion coût-IA → crédits vit à un
seul endroit, `packages/web/src/api/ai-usage/pricing.ts` :

    export const CREDITS_PER_USD = Number(process.env.AI_CREDITS_PER_USD) || 1000;

`AI_CREDITS_PER_USD` est absente du `.env`, donc c'était le défaut codé `1000` qui
s'appliquait. Le front (`AiCreditsPanel.tsx`) ne code aucune valeur en dur : il lit
`creditsPerUsd` renvoyé par l'API, donc il suit automatiquement.

## Ce qui a été fait
1. `pricing.ts` : défaut `1000` → `3000`, commentaire mis à jour
   (`3000 => 1 crédit = 0,000333 $`). L'override par env `AI_CREDITS_PER_USD` est conservé.
   Choix du code plutôt que du `.env` : c'est une règle métier permanente, une variable
   d'env se perd au moindre déploiement ailleurs.
2. Historique recalculé : `UPDATE ai_usage_events SET credits = round(cost_usd * 3000, 2)`
   sur les 235 lignes existantes (elles étaient calculées à 1 000/$, ce qui aurait donné un
   historique à taux mixte et des totaux admin incohérents). Opération réversible :
   `credits` est entièrement dérivée de `cost_usd`.
   Total crédits : 3 894,06 → 11 681,91 pour 3,893972 $ inchangés.

## Vérifications réellement exécutées
- `bun run typecheck:api` → **79** erreurs = baseline inchangée (dette pré-existante).
- `bun run typecheck` (front) → **0** erreur.
- **Live** `GET /api/admin/ai-usage/summary` (session admin temporaire, supprimée depuis) :
  `"credits":11681.91` / `"costUsd":3.893972` / **`"creditsPerUsd":3000`**.
  11 681,91 = 3,893972 × 3 000 → le taux est bien appliqué en runtime, pas seulement en source.
- `bun run build` → OK (2 tâches réussies).
- Session de test `verif-credits-3k-tmp` supprimée (vérifié : 0 ligne restante), scripts
  jetables supprimés.

## État connu / points ouverts
- ⚠️ **Deux systèmes de crédits distincts, un seul a été touché.**
  - `CREDITS_PER_USD` (modifié) = comptabilité/reporting du **coût IA réel**, panneau admin
    « AI Credits ». C'est le sens littéral de la demande.
  - `TOKEN_COSTS` / `deductTokens()` (`api/index.ts` ~1348-1382, table `token_transactions`)
    = **débit réel du solde utilisateur**, sur des **coûts fixes par action**, pas au dollar.
    NON modifié.
- Question à trancher avec l'utilisateur : veut-il aussi que le débit réel du solde suive le
  coût dollar (3 000 crédits par $ consommé) au lieu des coûts fixes par action ? Attention :
  `TOKEN_PACKAGES` vend à « 1 € = 1000 crédits » (4 990 crédits pour 4,99 €) — brancher le
  débit sur le coût dollar change la marge. Ne rien toucher là sans accord explicite.

# ── LE TRAVAIL DE L'IA S'ARRÊTAIT AU RETOUR SUR L'ONGLET (2026-09-10) ──

## Demande
« corrige que quand j ai une entrpries et je deande a l ai de faire des modification quand l ai
travaul et he change d onglet google et je revien sa continue pas sa a buguer et sa sais arreter »

## Cause réelle
`pages/chat.tsx`, effet « Mobile resilience » (~ligne 3983) : au retour sur l'onglet, si un envoi
était en cours (`sendingRef.current`), le code appelait SYSTÉMATIQUEMENT `abortRef.current.abort()`,
puis allait chercher côté serveur la réponse « déjà terminée et enregistrée ».
Ce raisonnement est juste sur mobile (l'OS suspend l'onglet et tue vraiment la connexion), mais
FAUX sur ordinateur : changer d'onglet Chrome ne coupe pas le flux, l'IA continue de travailler.
On tuait donc un flux parfaitement vivant, et la réponse cherchée en base n'existait pas encore
puisque l'IA était toujours en train de travailler. Résultat exact décrit par l'utilisateur :
au retour sur l'onglet, le travail s'arrête net et rien ne reprend.

## Ce qui a été fait
`packages/web/src/web/pages/chat.tsx` :
- Nouveau `streamActivityRef` : horodatage du dernier octet reçu sur le flux de chat, initialisé
  au démarrage de l'envoi et rafraîchi à chaque lecture du flux (tokens ET heartbeats serveur).
- L'effet de retour d'onglet ne coupe plus à l'aveugle. Il ne coupe que si le flux est réellement
  mort, c'est-à-dire plus aucun octet depuis 30 s (le serveur envoie un heartbeat toutes les 10 s,
  donc 30 s de silence = connexion morte). Sinon il laisse travailler et re-vérifie une seule fois
  12 s plus tard, au cas où la connexion serait morte juste avant le retour.
- La récupération mobile (abort + `syncMissedReplies`) est conservée à l'identique : elle ne se
  déclenche plus que dans le cas où elle est justifiée.

## Vérifications réellement exécutées
- Preuve A/B au navigateur (Chrome headless, vrai serveur, vraie requête `/api/chat/stream`,
  bascule onglet caché → visible pendant que l'IA rédige) :
  * ANCIEN code remis temporairement en place → `REQ` puis `ANNULEE: net::ERR_ABORTED`
    au retour sur l'onglet. Bug reproduit.
  * Code CORRIGÉ → `REQ` seul, la requête reste ouverte, aucune annulation. Bug corrigé.
- Deux tentatives de test antérieures ont été jugées NON concluantes et refaites : la première
  parce que Chrome headless ne bascule pas `visibilityState` avec `bring_to_front`, la seconde
  parce que la réponse était trop courte et se terminait avant la bascule.
- `bun run typecheck` (front) : 0 erreur. `bun run build` racine : succès. `/api/health` : 200.

## État connu / points ouverts
- Constaté dans les logs pendant les tests, SANS RAPPORT avec ce correctif et NON traité :
  `[streamAppEdit] error: Aucun fichier modifié` quand une demande de modification n'aboutit à
  aucun changement de fichier. À regarder si l'utilisateur signale des modifications sans effet.
- Nettoyage effectué : session de test supprimée, 9 messages de test retirés du chat Atelier Noir,
  scripts jetables et captures supprimés.

# ── GROS TROU VIDE AU MILIEU DES MESSAGES DU CHAT (2026-09-10) ──

## Demande
« corrige que des foie dnas le tcah il y a un tres gors espace vide » + capture montrant un
message coupé en deux par ~600 px de vide, juste après « Tout est téléchargeable ci-dessous. ».

## Cause réelle
Le texte des messages est rendu avec la classe `whitespace-pre-line`
(`pages/chat.tsx` lignes ~7512 et ~7572) : chaque saut de ligne du texte est donc affiché tel quel.
Or le flux retire du texte, avant affichage, des balises qui occupent chacune une ligne entière :
`[FILE:…]`, `[IMG:…]`, `[VIDEO:…]`, `[AUDIO:…]` dans `renderContent`, et plus haut dans le flux
`[QUESTIONS]`, `[POPUP]`, `[PLAN_DATA]`, `[BUILD_COMPANY]`, `[CODE_*]`.
Chaque `replace(..., '')` supprimait la balise mais laissait sa ligne vide derrière elle.
Le `.trim()` final ne nettoie que le début et la fin, jamais l'intérieur : 5 fichiers déposés
= 5 lignes vides d'affilée = le gros trou. C'est exactement le cas de la capture (articles de
blog + newsletter + calendrier déposés d'un coup).

## Ce qui a été fait
`packages/web/src/web/pages/chat.tsx`, calcul de `cleanText` dans `renderContent` : après les
suppressions de balises, on vide les lignes ne contenant que des espaces/tabulations puis on
réduit toute suite de 3 sauts de ligne ou plus à un seul saut double. Une ligne vide de
séparation reste possible entre deux paragraphes ; les trous multiples disparaissent.
Correctif placé au point de rendu final, donc il couvre aussi les balises retirées en amont
du flux, pas seulement les balises fichier.

## Vérifications réellement exécutées
- `bun run typecheck` (front) : 0 erreur.
- `bun run build` racine : succès.
- Test de la transformation sur un message reproduisant la capture (5 balises `[FILE:]` +
  1 `[IMG:]` entre deux paragraphes) : AVANT 11 lignes dont 9 vides → APRÈS 3 lignes dont 1 vide.
  Le texte utile et la séparation entre paragraphes sont intacts.
- Serveur dev 4200 : `/api/health` répond 200.

## État connu / points ouverts
- Les liens de téléchargement eux-mêmes sont inchangés : ils s'affichent sous le texte
  (`fileChips`), à condition que `projectId` soit présent. Si un message montre le texte mais
  aucun lien, c'est un autre sujet (projectId absent) — à signaler si ça se reproduit.

# ── SYSTÈME COMMUNICATION / PUB / MARKETING ENTRAÎNABLE + CONSOLE CMD (2026-09-10) ──

## Demande
« mintenant je veux travailer sur un tres gros system ( il existe déja mais je veu xl entrainer )
sias le system de communication et pub et totu se qui est marketing je vexu que quand il ressoi
une message ou progrmae une message sa doei etre étudier et la meyeur reponse se fiat et pour le
spub sa doei avori le smeyeur idé . entraine l ai en lui parlent et testant et aussi je veux que
moi je la teste depui une commande que je met dans admi et quan dje met sa ouvre une pop up comme
si sias le cmd ( meme visuele ) et j envoie des message et il me rement avec son systel »

Précision capitale ajoutée ensuite :
« continue masi le btu sias que l ai donen tout de suite la bonen réponse la meyeu rpas que sa
fai tplusieur réponse et sa choisie la meyeur saufe pour ameliroer l ai »

Décisions arrêtées : commande `comms` ; simulation uniquement (rien n'est publié/envoyé) ;
les 5 domaines (réponses, idées de pub, meilleur moment, posts organiques, emails de prospection) ;
notation 1-10 + correction écrite ; langue auto-détectée, n'importe quelle société.

## Cause réelle
Le système social existant (pipeline.ts) générait posts et réponses avec des prompts figés :
aucune mémoire de ce que l'admin jugeait bon ou mauvais, donc les mêmes défauts revenaient
à chaque génération. Un vrai fine-tuning est impossible (gateway + coût) — la solution est une
boucle d'apprentissage : test → note → correction → distillation en règles → réinjection dans
les prompts, y compris en production.

## Ce qui a été fait
- `api/database/runtime-tables.ts` : 2 tables créées au chargement (`comms_training_examples`,
  `comms_playbook`) + index. Pas de `db:push`, pas de `schema.ts`.
- `api/comms/learning.ts` (nouveau) : enregistrement des exemples, notation, distillation en
  règles do/dont avec déduplication par recouvrement de mots (une règle similaire renforce le
  poids au lieu de dupliquer), poids 2 pour une correction contre 1.5 pour une bonne note,
  `buildLearningBlock()` (ne throw jamais, renvoie '' si rien d'appris), `learningStats()`
  (moyenne des 10 premiers vs 10 derniers = preuve chiffrée de progression).
- `api/comms/engine.ts` (nouveau) : `runCommsTask` à deux modes.
  * `direct` (DÉFAUT, = production) : ÉTUDE puis UNE SEULE rédaction finale. Jamais plusieurs
    propositions. C'est la demande explicite de l'utilisateur.
  * `train` (console seulement) : ÉTUDE → 3 pistes → juge qui note et choisit. Sert uniquement
    à comprendre et corriger l'IA, jamais à répondre en vrai.
  Spécifications métier (focus d'étude, rôle de rédacteur, critères de qualité) pour les 5 tâches.
- `api/comms/admin-routes.ts` (nouveau) : `/admin/comms/{tasks,run,rate,playbook,stats,examples}`,
  garde admin + rate limit 60/min, `mode` par défaut à `direct`.
- `api/index.ts` : montage des routes comms.
- `web/components/CommsConsole.tsx` (nouveau) : popup au visuel CMD identique au terminal admin
  (mêmes couleurs, même police, même prompt), badge PRODUCTION / ENTRAÎNEMENT, commandes
  help / reply|ad|post|email|when / context / score / fix / playbook / forget / stats / examples /
  mode / clear / exit, historique flèches et autocomplétion Tab.
- `web/components/AdminPanel.tsx` : commande `comms` (alias `marketing`, `pub`) qui ouvre la popup.
- `api/social/pipeline.ts` : BRANCHEMENT PRODUCTION. `buildLearningBlock` préfixe désormais
  `BRAIN_WRITER` (posts) et les deux appels `BRAIN_ENGAGEMENT` (réponses). `monitor.ts` passe
  par `runEngagementBrain` et hérite donc de l'apprentissage (aucun `generateText` direct vérifié).

## Vérifications réellement exécutées
- `bun run typecheck:api` : 79 erreurs = baseline exacte, aucune sur `src/api/comms`, aucune
  nouvelle sur `pipeline.ts` (seule la ligne 293 `maxTokens` préexistante).
- `bun run typecheck` (front) : aucune erreur sur CommsConsole / AdminPanel.
- `bun run build` racine : succès.
- Live API : `POST /api/admin/comms/run` en mode direct → 1 seule variante, langue fr, ~6 s.
- Preuve d'apprentissage : note 4 + correction sur une réponse client → 3 règles distillées →
  même message rejoué → nouvelle réponse intégrant les 3 corrections.
- Preuve du chemin PRODUCTION : appel réel de `runEngagementBrain` (hors console) sur Atelier
  Noir → la réponse contient le délai chiffré « avant 18h », un geste commercial concret et la
  signature « Camille », c'est-à-dire exactement les règles apprises via la console.
- `rg` sur `src/api/comms/` : aucun appel d'envoi réel (pas de token plateforme, pas d'écriture
  dans `social_posts`, pas d'email). Simulation stricte.
- Test navigateur (Playwright) : F8 → `comms` → popup indiscernable du terminal, étude + réponse
  unique, puis `ad` + `score 3 <correction>` → règles apprises affichées.

## État connu / points ouverts
- Bug corrigé en cours de route : réponse en anglais sur message français. `guessLang()`
  tokenisait sur les espaces (« Bonjour, » ne matchait pas). Corrigé + la langue détectée par
  l'étude prime désormais sur l'heuristique.
- Bug corrigé : cadre ASCII du bandeau désaligné (caractères non monospace), remplacé par un
  en-tête à filet simple.
- Données conservées volontairement : 8 exemples notés et 6 règles actives issues des tests.
  Elles sont déjà utiles ; à purger avec `forget <id>` si l'utilisateur veut repartir de zéro.
- Session de test `scratch-comms-test-session` supprimée, scripts jetables supprimés.
- Ce n'est PAS du fine-tuning : les règles sont réinjectées dans les prompts à chaque
  génération. Annoncé et validé par l'utilisateur.

# ── L'IA NE CRÉE PLUS UNE ENTREPRISE SANS SAVOIR LAQUELLE (2026-09-10) ──

## Demande
« corrige rend l ai plus intelegigente et logique parce que j ai die cret moi une entreprise et
ma repondue super et sa allais commencer uen entreprise snas savori l idé l ai devria proposer
des idé ou demande rune idé sois que elel sois noramle »

→ « crée-moi une entreprise » (sans dire laquelle) : l'IA répondait « Super ! » et partait
construire une entreprise au hasard. Elle doit DEMANDER l'idée ou en PROPOSER.

## Cause réelle
Trois tests distincts confondaient « message long » et « idée connue » :
- le regex `EXPLICIT_CREATE` forçait `intent = 'BUSINESS_IDEA'` dès qu'un verbe de création
  était suivi d'un mot générique (« entreprise », « app », « site ») — même sans AUCUNE
  matière métier ;
- les gardes GO/SKIP (`orchestrator.ts` ×2) et le backstop GO du `/chat/stream`
  (`index.ts`) testaient `content.trim().length >= 12`. Or « crée-moi une entreprise » fait
  24 caractères → un « go » suivant lançait un build à l'aveugle ;
- surtout : le classifieur IA route « go » en `intent = 'BUILD_COMMAND'`, une branche qui
  retournait `shouldBuild: true` AVANT tous ces gardes et les court-circuitait donc tous.
  (C'est ce chemin qui a fait échouer le premier jet du correctif — détecté au test live.)

## Ce qui a été fait
1. **Mesure de SUBSTANCE au lieu de longueur** — `hasIdeaSubstance(text)` : retire accents,
   verbes de création, objets génériques, politesse et mots-outils (`IDEA_FILLER_WORDS`,
   FR + EN) ; un seul mot concret restant suffit. Une URL / un nom de domaine compte comme
   matière (cas « clone ce site »). `conversationHasIdea(history, message, ctxIdea)` cumule
   l'idée déjà enregistrée + tout ce que l'utilisateur a écrit.
2. **Réponse unique factorisée** `askForIdeaResult(...)` : 1 phrase d'intro + un bloc
   `[QUESTIONS]` que le front affiche en options cliquables — 5 idées CONCRÈTES générées par
   l'IA dans la langue de l'utilisateur (`proposeBusinessIdeas`, avec repli déterministe
   codé en dur 5 FR / 5 EN si l'appel ou le parsing échoue), + « J'ai déjà mon idée — je la
   décris » et `allowCustom: true`. Toujours `shouldBuild: false`.
3. **Deux gardes** appellent ce helper : la demande de création sans matière
   (`CREATE_INTENT_RE`) et **la branche `BUILD_COMMAND`** (le « go » à l'aveugle).
4. **Trois tests de longueur remplacés** par `conversationHasIdea` : garde GO/SKIP et
   `hasPriorUserIdea` dans `orchestrator.ts`, `priorIdea` du `/chat/stream` dans `index.ts`
   (`conversationHasIdea` y est désormais importée).
5. **Prompt de découverte durci** : interdiction absolue d'émettre `[BUILD_COMPANY]` sans
   savoir quelle entreprise créer ; obligation de poser un `[QUESTIONS]` avec 5 idées variées.

## Vérifications réellement exécutées
- Test unitaire jetable de `hasIdeaSubstance` : **20/20 cas** — `false` pour « crée-moi une
  entreprise », « fais moi un site stp », « je veux une app », « go », « make a website » ;
  `true` pour « une boutique de café en ligne », « crée-moi une app de fitness »,
  « clone https://stripe.com », « je veux vendre des chaussures ». Script supprimé ensuite.
- `typecheck:api` = **79 erreurs = baseline** (aucune nouvelle) ; `bun run build` OK.
- **Comportement en live** (POST `/api/chat/stream`, logs tmux `website_4200`) :
  - « crée moi une entreprise » → log `[orchestrator] ⛔ Création demandée SANS idée`,
    `shouldBuild=false`, réponse contenant 5 idées + `allowCustom` ;
  - puis « go » dans la même session → **`shouldBuild=false`** (avant le correctif :
    `true`, build à l'aveugle) ;
  - non-régression « crée-moi une boutique de café en ligne » → flux de découverte NORMAL
    (vraies questions métier, pas de propositions d'idées), puis « go » → `shouldBuild=true`.
- Piège corrigé en cours de route : un patch python via `unicode_escape` avait injecté du
  mojibake (`RÃ©ponse`) et écrasé un `\n\n` ; helper réécrit proprement et relu.
- Base après tests : 3 sessions de chat de test supprimées (12 lignes), **0 exécution
  `running`**, aucun build parasite déclenché.

## État connu / points ouverts
- Société `5f9d0205… « Nouveau projet »` (0 fichier) présente en base ; créée AVANT mes tests
  de chat, donc **pas** issue de ceux-ci — laissée en place, à supprimer si elle est inutile.
- Dette pré-existante inchangée : `typecheck` mobile KO, `lint` 577 erreurs héritées, clés
  tierces absentes du `.env`, branches « clé perso directe » anthropic/google cassées.

# ── ANTI-RECRÉATION : LE BUILD NE REPART PLUS DE ZÉRO TOUT SEUL (2026-09-10) ──

## Demande
« j ai constater que l ai je croie a des momant elle bug et recomance a tout recrer parce que
elle a dit plusieurs fois "je commence a créer ton projet". corrige le problème pour que ça se
passe plus jamais »

## Cause réelle
Le « resume » d'un build n'est pas une reprise : c'est une RECONSTRUCTION COMPLÈTE
(`startBuildWebsite` efface `project_files` + `website_pages` puis régénère tout depuis
`company.idea`). Cinq chemins pouvaient le déclencher SANS action utilisateur, dont le
**GET `/companies/:id/jobs`** — un endpoint de LECTURE sondé toutes les 3 s par le front.
Les garde-fous existants ne protégeaient pas :
- `companyHasBuiltOutput()` exige le marqueur FINAL `.velbaz/plan.json` → répond `false`
  pendant toute la durée d'un build inachevé, donc autorise l'effacement + rebuild ;
- le dédoublonnage de `runInBackground` se base sur les jobs EN MÉMOIRE, or la condition de
  déclenchement de l'auto-resume est justement qu'il n'y a plus de job en mémoire ;
- la péremption utilisait `startedAt` (> 10 min) et non un signe de vie → un build long mais
  VIVANT était déclaré mort et relancé de zéro.

## Ce qui a été fait (option choisie par l'utilisateur : « reprend tout seule », mais bornée)
1. **Plafond de relances automatiques** : `MAX_AUTO_RELAUNCH_PER_BOOT` (défaut 1, réglable par
   variable d'env, 0 = plus aucune relance auto) — 1 relance par société et par démarrage du
   process. Compteur en mémoire persistant aux re-évaluations HMR.
2. **Helper unique `autoRelaunchBuild(company, styleRef, resumeBlob, reason)`** : seul point
   d'entrée des chemins automatiques. Retourne `null` si le quota est atteint (log
   `[auto-relaunch] REFUSÉ`) → l'appelant clôt la ligne SANS rien reconstruire.
3. **Signe de vie** : le build rafraîchit `executionState.updatedAt` toutes les ~60 s.
4. **Péremption sur `updatedAt` (15 min)** au lieu de `startedAt` (10 min) dans le poll `/jobs`.
5. **Claim atomique** `claimStaleExecution()` : `UPDATE … WHERE id = ? AND status = 'running'`,
   on ne poursuit que si `rowsAffected === 1` → deux onglets qui pollent en même temps ne
   peuvent pas relancer deux builds parallèles.
6. Les 3 chemins AUTOMATIQUES (poll `GET /jobs`, restart-sweep, self-heal squelettes) passent
   désormais par le helper borné. Les chemins EXPLICITES (bouton « Construire », `POST /resume`,
   « continue » tapé dans le chat) sont inchangés : l'utilisateur garde la main.
   Quand la relance auto est refusée, la ligne passe en `failed` / `aborted` avec le message
   « Construction interrompue — cliquez sur "Reprendre" pour continuer. »

## Vérifications réellement exécutées
- `typecheck:api` = **79 erreurs = baseline** (aucune nouvelle) ; `bun run build` OK ; serveur
  4200 relancé, `/api/health` et `/` en 200.
- Test comportemental live, ligne `executionState` périmée seedée en base :
  - boot avec `MAX_AUTO_RELAUNCH_PER_BOOT=0` → `[auto-relaunch] REFUSÉ (restart-sweep) …
    quota 0/0` et ligne close en `failed`/`aborted` — **aucune reconstruction** ;
  - boot avec `=1` → `[auto-relaunch] restart-sweep → relance 1/1` puis build effectivement
    relancé (chemin autorisé fonctionnel).
  - Société de test + toutes ses lignes supprimées ensuite, base propre (0 ligne `running`).

## État connu / points ouverts
- Le build reste intrinsèquement DESTRUCTIF quand il repart (il efface avant de régénérer).
  Le correctif borne QUI peut le déclencher, il ne rend pas le build incrémental. Un vrai
  resume incrémental (ne régénérer que les pages manquantes) est le chantier suivant si voulu.
- Dette pré-existante inchangée : mobile `typecheck` KO, `lint` 577 erreurs héritées, 79
  erreurs TS API de baseline (dont l'appel à `startBuildWebsite(..., { skipMobile: true })`
  avec un 4e argument non déclaré — laissé tel quel pour ne pas changer le comportement).

# ── IMAGES : NANO BANANA 2 LITE + CORRECTION DU FORFAIT IMAGE (2026-09-09) ──

## Demande
« pour la generation de image utilsie Nano Banana Lite (1K) et sais pas normale que depuis
l'analyse ça a fait 2 dollars d'image »

## Enquête sur les « 2 $ »
Relevé en base (`ai_usage_events`) : 15 évènements / 16 images, tous en `feature: company-build`
sur `/api/companies/…/build-website`, modèle `google/gemini-2.5-flash-image`, chacun facturé
**0,130 $** → **2,08 $**. Ces appels ont eu lieu APRÈS le nettoyage de la table, donc ce sont de
vrais builds lancés depuis l'app, pas des résidus de test.

**Mais le prix appliqué était faux.** `IMAGE_FLAT_USD` portait `gemini-2.5-flash-image: 0,13 
— c'est le tarif de Nano Banana **Pro**, pas de Nano Banana 1. Tarif public Google réel :
**0,039 $/image**. Le dashboard surévaluait donc les images d'un facteur ~3,3.
Coût réel de ces 16 images : **0,62 $**. Total global corrigé : 3,20 $ → **1,74 $**.
Les 15 lignes concernées ont été recalculées en base (`cost_usd` et `credits`), la part tokens
d'entrée préservée telle quelle.

## Ce qui a été fait
- **`ai-usage/pricing.ts`** — `IMAGE_FLAT_USD` corrigé et complété, tarifs vérifiés le
  2026-09-09 : `2.5-flash-image` 0,039 · `3.1-flash-lite-image` **0,034** · `3.1-flash-image`
  0,067 · `3-pro-image` 0,24 (pire cas 4K, volontairement prudent). Ajout de
  `google/gemini-3.1-flash-lite-image` (0,25/1,5) et `google/gemini-3.1-flash-image` (0,3/2,5)
  dans `MODEL_PRICES` — sinon `priced: "fallback"` et bandeau d'avertissement dans l'UI.
- **`agent/gateway.ts`** — nouvelle constante exportée
  `IMAGE_MODEL = process.env.IMAGE_MODEL || "google/gemini-3.1-flash-lite-image"`.
  Un seul endroit à changer pour rebasculer toute l'app sur un autre modèle image.
- **`index.ts`** — les 2 `gateway('google/gemini-2.5-flash-image')` (`generateImage` et
  `generateImageWithRefs`) → `gateway(IMAGE_MODEL)` ; les 8 étiquettes
  `generatedBy: 'google/gemini-2.5-flash-image'` → `generatedBy: IMAGE_MODEL` ; la liste
  « Available models » du prompt système mise à jour. 11 occurrences → 0.
- **`builder/images.ts`** — `generateContentImage` → `gateway(IMAGE_MODEL)`.
- **`test-lab.ts`** — passait sur `google/gemini-3-pro-image` (0,24 $/image, le plus cher) →
  `gemini-3.1-flash-lite-image`.
- **`test1-lab.ts`** — défaut `TEST1_IMAGE_MODEL` : nano banana 1 → `gemini-3.1-flash-lite-image`
  (annule et remplace la consigne « nano banana 1 » du propriétaire, datée dans le commentaire).

## Vérifié
- Vrai appel au gateway sur `google/gemini-3.1-flash-lite-image` : **OK**, 1 fichier image/jpeg
  63 ko, 1120 tokens de sortie modality IMAGE → l'id est bien exposé par le Runable AI Gateway.
- `bun run typecheck:api` = **79 = baseline exacte** · `typecheck` web+desktop OK (mobile KO,
  dette pré-existante) · `bun run build` OK · dev server 4200 relancé, `/api/health` et `/` 200.
- Scripts scratch supprimés.

## Points ouverts
- Nano Banana 2 Lite sort en **1K uniquement**. Si un visuel demande du 2K/4K, il faut repasser
  explicitement sur `gemini-3.1-flash-image` ou `gemini-3-pro-image` pour ce site d'appel.
- La grille de prix est manuelle : tout nouveau modèle absent de `MODEL_PRICES` retombe sur
  `DEFAULT_PRICE` et s'affiche `priced: "fallback"` dans le dashboard — c'est le signal qu'il
  faut l'ajouter.

# ── SUIVI DES CRÉDITS IA (2026-09-09) ──

## Demande
« créer un système qui analyse tous les crédits utilisés pour les AI, savoir c'était pour quoi
et quand, et si/quand l'AI travaille »

Cadrage validé : vue admin globale + par utilisateur/société + par projet ; USD ET crédits côte
à côte ; 6 vues (détail brut cliquable, top consommateurs, taux d'échec + coût gaspillé, par
feature, par modèle, timeline « quand l'IA a bossé ») ; intégré dans l'AdminPanel existant ;
LECTURE SEULE (mesurer et afficher, ne rien bloquer).

## Architecture (et pourquoi)
- **Capture au niveau du gateway** : `wrapLanguageModel` + middleware dans `agent/gateway.ts`.
  C'est le point d'étranglement unique → les ~500 sites d'appel sont couverts sans en toucher un
  seul.
- **Attribution par `AsyncLocalStorage`** (`runWithAiContext`) : le « pour quoi / pour qui / quel
  projet » se propage dans toute la pile async sans changer aucune signature. Hors contexte →
  `feature: "unknown"`, affiché tel quel pour signaler ce qu'il reste à taguer.
- **Persistance Turso** (table `ai_usage_events`, 7 index), écriture **bufferisée non bloquante**
  (flush à 40 évènements ou 1500 ms) + repli JSONL. Journaliser ne doit jamais casser ni ralentir
  un appel IA.
- **Routes admin en Hono** (`/api/admin/ai-usage/*` + `requireAdmin` + rate-limit 120/min), PAS en
  oRPC : toute l'app est Hono, la couche oRPC est vestigiale (`ping` seul) et son `RpcContext` n'a
  aucune résolution d'utilisateur. Écart assumé vs la règle « API = oRPC » du template.
- **Crédits** : `AI_CREDITS_PER_USD` (env, défaut 1000 → 1 crédit = 0,001 $).
- **Images** : forfait par image (`IMAGE_FLAT_USD`), le middleware compte les parts `file`.
- **Erreurs enregistrées** (`status: 'error'`) pour mesurer le coût gaspillé.

## Fichiers
Créés — `src/api/ai-usage/` : `pricing.ts` (table de prix des 13 modèles du code + conversion
crédits), `context.ts` (AsyncLocalStorage), `recorder.ts` (buffer + flush), `middleware.ts`
(wrapGenerate + wrapStream), `queries.ts` (11 agrégats), `admin-routes.ts` (12 routes dont
`/overview` qui sert tout le dashboard en 1 requête).
Créé — `src/web/components/AiCreditsPanel.tsx` (le dashboard, composant séparé pour ne pas
gonfler AdminPanel.tsx qui fait déjà 3450 lignes).
Modifiés — `database/schema.ts` (table `aiUsageEvents`), `agent/gateway.ts` (helper `meter()` sur
les 6 `return`), `index.ts` (middleware d'attribution + `patchAiContext` dans `getUser` + montage
des routes), `agents/orchestrator.ts`, `chimera.ts`, `genesis.ts`, `autopilot.ts` (wrappers
`runWithAiContext`), `ai-usage-log.ts` (réécrit en shim no-op déprécié : le middleware couvre
déjà tout, évite le double comptage).

## Vérifié
- Capture testée **de bout en bout sur les 3 chemins** : `generateText` (ligne écrite, tokens,
  coût, attribution, run_id corrects), `streamText`, et un appel en erreur (bien enregistré
  `status=error` avec le message).
- Table `ai_usage_events` + ses 7 index confirmés en base.
- Les 12 routes admin testées avec un vrai token admin → 200 avec données cohérentes ;
  sans token → 403.
- `typecheck` front = 0 erreur ; `typecheck:api` = 79 = **baseline exacte** (aucune régression).
- `bun run build` OK. Rendu du dashboard vérifié au navigateur (screenshot).
- **Nettoyage** : user/session de test et évènements de test supprimés (base à 0 ligne),
  fichiers scratch supprimés.

## État connu / points ouverts
- **Dette découverte (pré-existante, pas causée ici)** : `@ai-sdk/anthropic@4` et
  `@ai-sdk/google@4` émettent la spec **V4** alors que `ai@6` consomme la **V3**. Les branches
  « clé perso directe » anthropic/google étaient donc **déjà cassées à l'exécution** avant ce
  travail. `meter()` ne les enveloppe pas (garde `specificationVersion === "v3"`) et loggue un
  warn → ces appels ne sont pas comptés. À corriger en alignant les versions de providers.
- Les appels IA pas encore instrumentés apparaissent en `feature: "unknown"` — c'est voulu, ça
  montre ce qu'il reste à taguer avec `runWithAiContext`.
- Un modèle absent de `pricing.ts` est facturé au tarif par défaut et marqué `priced: "fallback"`
  (bandeau d'avertissement dans l'UI). Les 13 modèles réellement utilisés dans le code sont tous
  couverts.
- `bun run lint` : 577 erreurs héritées pré-existantes, non bloquant.

# ── MIGRATION / RE-HOSTING RUNABLE (2026-09-09) ──

## Demande
« voici un ancien projet continue dessus https://github.com/johnghost-j/velbaz6-5648.git
exporte-le bien et héberge-le avec tous les systèmes de Runable, sans rien rater »

## Ce qui a été fait
- Clone du repo (452 fichiers, template Runable 0.7.0, 1 commit « Update from Runable »).
- `app_init` d'un projet managé neuf (même version de template 0.7.0) → infra fraîche :
  Turso DB, S3/Tigris storage, AI Gateway, Better Auth, Autumn (paiements), APPLICATION_ID.
- Copie de tout le code par-dessus le squelette managé, en excluant : `.env`, `.runable/`,
  `.template-version`, `bun.lock`, `.git/`, et TOUS les fichiers `__*` (template-managed,
  vérifiés par `bun run lint` — intégrité OK, 0 violation).
- `bun install` → 206 paquets. `bun run db:push` → schéma (1478 lignes) appliqué sur la
  nouvelle base Turso.
- `bun run build` → OK (web + desktop). Assets optimisés automatiquement (og-image 6.2→2.1 Mo,
  login-right 4.7→1.3 Mo, demo-ad mp4 4.5→0.4 Mo).
- `bun run dev` sur le port fixe 4200. /api/health 200, oRPC /api/rpc/ping OK,
  16 pages testées → toutes 200 (index, login, register, dashboard, chat, plans, community,
  guide, legal, company, profile, settings, track, editor, money-maker).

## État connu / points ouverts
- `bun run typecheck` : web + desktop OK. **mobile KO** — le tsconfig Expo typecheck les
  sources de `@template/web` sans les types Node (`process.memoryUsage`, `process.cwd`…),
  + qq erreurs réelles (money-maker.ts:1205, stripe-connect.ts:172, test1-lab.ts:1009,
  social/pipeline.ts:292 maxTokens). N'affecte ni le build ni le web. À traiter si mobile utilisé.
- `bun run lint` : 577 erreurs pré-existantes héritées (154 no-unused-vars, 43 exhaustive-deps,
  5 max-lines, reste unicorn). Aucune violation template/asset/env.
- Clés tierces absentes du nouveau `.env` (intégrations optionnelles, à refournir si utilisées) :
  STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET, FIRECRAWL_API_KEY, OPENROUTER_API_KEY,
  HIGGSFIELD_KEY_ID/SECRET (HF_*), TWENTY_FIRST_API_KEY, DISCORD_*, TWITTER_*, REDDIT_*,
  INSTAGRAM_*, SECRET_STORE_KEY, ADMIN_EMAILS, BETA_*, EMAIL_WEBHOOK_SECRET.
  Les clés cœur (DB, AI Gateway, auth, storage, Autumn) sont fournies par l'infra managée.
- Base de données NEUVE : aucune donnée de l'ancienne instance n'a été reprise (l'ancien
  `.env` n'est pas dans le repo). Schéma identique, tables vides.

# ── NOUVELLE DEMANDE (2026-09-09, 6e vague) : Sonnet 4.6 partout + /chimera ──

## Demande (FR, verbatim)
« nan 1) utilise que claude sonnet 4.6. et corrige aussi que les étapes et tout
du coup je vais te donner une demande avec la skill et tout ce que tu vas faire
et résultat doit être le même dans mon app /chimera crée une marque de vélo »

## Travail fait
- test1-lab.ts : BRAIN_MODEL → anthropic/claude-sonnet-4.6 (Opus retiré, demande
  explicite « QUE claude sonnet 4.6 »). VISION_MODEL déjà sonnet-4.6. Image
  reste gemini-2.5-flash-image.
- Étapes : le prompt impose que plan_tasks suive les 5 PHASES du skill, dans
  l'ordre (MONDE → CADRES → DÉCOUPE → SITE → VÉRIFICATION), une ou plusieurs
  tâches par phase.
- Commande /chimera : parseTest1Command accepte /^\/(chimera|test1)/ (alias,
  même pipeline). Front chat.tsx : 3 regex élargies (interception doSend,
  interception depuis la home via sessionStorage, extraction de catégorie dans
  runTest1Flow). Route : message d'erreur exemple → « /chimera vélos ».
- typecheck exit 0 ; vite ssr reload test1-lab.ts + test1-routes.ts confirmé ;
  hmr client chat.tsx confirmé.

## État
- [x] Sonnet 4.6 partout (cerveau + oeil)
- [x] plan_tasks aligné sur les 5 phases du skill
- [x] /chimera acceptée (alias de /test1, même pipeline)
- [x] typecheck + reload
- [x] rapport FR
- NB : nouveaux runs uniquement.

## TERMINÉ le 2026-09-09 (6e vague)

# ── NOUVELLE DEMANDE (2026-09-09, 5e vague) : modèle Claude + site pas ressemblant ──

## Demande (FR, verbatim)
« nan corrige tout est mal fait et mauvais. utilise claude opus 4.6 sonnet et
fait que ça crée un vrai site parce que c'est pas un vrai site c'est un
background blanc avec du texte et une image c'est pas du tout ce que le skill
dit »

## Diagnostic
- Cerveau gpt-5.4-mini (choix coût 2026-09-08) ne suivait pas le pipeline de
  reconstruction → sites « fond blanc + texte + une image ».
- verify_browser ne contrôlait que la TECHNIQUE (200, testid, erreurs console).
  Un site blanc non ressemblant passait → finish accepté.

## Travail fait (test1-lab.ts + ai-usage-log.ts)
- BRAIN_MODEL → anthropic/claude-opus-4.6, VISION_MODEL → anthropic/claude-sonnet-4.6
  (demande explicite). Image reste gemini-2.5-flash-image. Prix opus-4.6 ajouté
  à ai-usage-log.
- verify_browser : capture PNG de chaque page rendue + comparaison VISION avec
  la maquette -ui.png (mockup requis par route dans le schéma). Verdict
  FIDÈLE/ÉCART + écarts précis renvoyés à l'agent.
- finish VERROUILLÉ : refuse tant que verifiedClean=false (aucun échec
  technique NI écart visuel). Tout nouveau build_and_serve réinitialise
  verifiedClean → ré-vérification obligatoire.
- Prompt : verify_browser doit recevoir la maquette par route ; « fond blanc +
  texte + une image » nommé explicitement comme ÉCHEC.
- typecheck exit 0, vite ssr reload confirmé (12:06).

## État
- [x] Modèles Claude (opus-4.6 + sonnet-4.6)
- [x] Comparaison visuelle maquette↔page dans verify_browser
- [x] Verrou finish sur vérification propre
- [x] typecheck + reload
- [x] rapport FR
- NB : nouveaux runs /test1 uniquement.

## TERMINÉ le 2026-09-09 (5e vague)

# ── NOUVELLE DEMANDE (2026-09-09, 4e vague) : le skill Chimera à 100 % ────────

## Demande (FR)
« le but c'est comme ce skill à 100% — ça génère les visualisations du site puis
ça les recrée à perfection. » Zip joint = version ORIGINALE complète du skill
Chimera (anglais, ~339 lignes, 5 phases). Le SKILL.md injecté jusqu'ici était un
résumé français de 60 lignes qui avait PERDU les deux phases cœur de la demande :
Phase 3 (découpe des plaques en assets propres) et Phase 4 (transcription +
reconstruction pixel-fidèle).

## Comparaison zip vs skill bundlé (faite)
- references/looks/01-10.png : IDENTIQUES (md5).
- SKILL.md : très différent — le résumé FR avait perdu : strip UI→clean plate,
  découpe product/background/detail, relecture des découpes, transcription des
  -ui.png avant code, composition « fond plein cadre + découpe + HTML vivant »,
  table des 7 cadres types, budget d'optimisation (WebP q82, ≤2400/1600/900px,
  LQIP 24px base64), loading gate (preload + img.decode + rite de marque),
  règles de motion « fantasy dressing », Quality Bar et Kill-on-sight complets.
- storefront.md : zip EN avec table « what to steal » par look ; FR sans la table.
- worldsmith.md : FR plus complet (section « Tenue professionnelle ») → CONSERVÉ.

## Travail fait
- SKILL.md : RÉÉCRIT en français avec le pipeline 5 phases COMPLET du zip
  (monde → cadres UI → strip clean → découpe → transcription → reconstruction →
  optimisation → loading gate → livraison), table des cadres 01-07, gabarit de
  prompt complet, Quality Bar + Kill-on-sight complets. Adaptations harnais :
  image_generate→generate_image, image_refine→generate_image avec refs,
  read→look, remove-background/convert→shell, livraison→publish_image +
  build_and_serve + verify_browser + finish.
- storefront.md : table des 10 looks (« quoi en voler ») ajoutée en tête.
- worldsmith.md : inchangé (version FR supérieure).
- test1-lab.ts :
  - systemPrompt : section « LA MAQUETTE N'EST PAS LE SITE » réécrite en
    4 étapes alignées sur le pipeline (CADRE → DÉCOUPE → TRANSCRIPTION →
    RECONSTRUCTION), dont l'exigence « copy deck au caractère près ».
  - build_and_serve : NOUVEAU refus — la matière de reconstruction doit
    exister : au moins un kind=background ET un kind=cutout publiés
    (imageKinds tracké dans publish_image). Sans ça, la seule façon de
    ressembler aux cadres est de plaquer la maquette.
  - Garde-fous existants conservés : internalRoutes (liens→pages déclarées),
    refus page sans image, vision gate publish_image (interface cuite).
- typecheck : bunx tsc --noEmit exit 0. Vite ssr reload confirmé.

## État
- [x] Comparaison zip vs bundlé
- [x] SKILL.md réécrit (pipeline complet, FR)
- [x] storefront.md : table des looks
- [x] test1-lab.ts : prompt 4 étapes + refus matière incomplète
- [x] typecheck exit 0 + reload dev server
- [x] rapport FR — fait dans le chat
- NB : s'applique aux NOUVEAUX runs /test1 uniquement.

## TERMINÉ le 2026-09-09 (4e vague)

# ── NOUVELLE DEMANDE (2026-09-09, 2e vague) : sites /test1 « bizarres » + historique perdu ──

## Demandes utilisateur (FR)
A. Les sites générés par /test1 sont « bizarres » : n'utilisent pas les images
   générées correctement. Exemple : company 26a831ef (Vélo Mëm, vélo).
B. Quand on quitte l'app Velbaz et qu'on revient, l'historique du chat a disparu.

## Investigation (faite, vérifiée navigateur + disque)
- Site 26a831ef chargé en vrai Chrome (playwright, google-chrome sandbox) :
  - `/` : 1 image (bicycle-hero.webp) plaquée brute, mise en page étrange.
  - `/produit`, `/lookbook` : 1 image chacune. `/collection`, `/services` :
    PAGE BLANCHE (root html len=0, aucune erreur console remontée).
  - 5 liens nav dans Home.tsx (/produit /collection /lookbook /services) mais
    src/pages/ n'a PAS Collection.tsx ni Services.tsx, et App.tsx (généré par
    buildRouter) ne route que /, /produit, /lookbook, /checkout.
  → CAUSE RACINE A : l'agent écrit des liens vers des pages qu'il n'a ni
    écrites ni déclarées à build_and_serve → routes blanches. Et seulement
    3 images pour 5 pages → site « bizarre » pauvre en visuels.
  - Garde-fous existants : assetFaults vérifie images connues/absolues/
    externes/placeholders/BrowserRouter — MAIS PAS les liens internes vers
    des routes inexistantes, ni la cohérence nav ↔ pages déclarées.
  - build_and_serve refuse déjà une page déclarée sans fichier. Mais
    l'inverse (fichier écrit mais non déclaré, ou lien vers route absente)
    n'est PAS vérifié.
- Historique : useEffect sur projectId (~3644) recharge via api.chat.history.
  skipHistoryLoad si (prev null/undefined && messages.length>0) ||
  buildTriggeredRef || continueFlowRef. À creuser : pourquoi au retour
  l'historique est vide (api.chat.history renvoie [] ? projectId null ?
  messages non persistés côté serveur pour les runs /test1 ?).

## Plan
### FIX D — sites /test1 cohérents
- test1-lab.ts : étendre la validation. Dans build_and_serve, après assemblage,
  extraire toutes les routes internes référencées (Link to=, href=, navigate()
  dans les fichiers écrits) et REFUSER si une route n'est pas dans a.pages
  (« Refusé : Home.tsx pointe vers /collection mais aucune page n'est déclarée
  pour cette route »). Même traitement pour les routes déclarées sans fichier
  (déjà fait) ET fichiers écrits jamais routés (avertissement).
- Prompt : exiger que chaque page ait AU MOINS une image produite par le run
  (fond ou découpe), et que la nav ne pointe que vers des pages déclarées.
### FIX E — historique perdu
- Reproduire/comprendre d'abord : tester api.chat.history sur une company
  après navigation. Vérifier que les messages /test1 sont persistés (ou pas)
  côté serveur — test1-routes.ts ne semble PAS écrire dans l'historique chat.

## Investigation B (FAITE — cause racine trouvée)
- DB (Turso, via bun + .env) : les chats NORMAUX persistent (Véloria 04dc34de
  a 4 msgs du 2026-09-08). Les 2 companies /test1 (f1436207, 26a831ef) ont
  ZÉRO message dans chat_messages.
- CAUSE RACINE B : test1-routes.ts n'écrit JAMAIS dans chatMessages. Tout le
  run /test1 vit en state React local (test1Run) → perdu dès qu'on quitte
  l'app. GET /chat/:sessionId lit chatMessages par sessionId (= companyId).

## Plan
### FIX D — sites /test1 cohérents [CODÉ]
- test1-lab.ts : helper internalRoutes() (Link to=, href=, navigate()).
  build_and_serve REFUSE si : (a) un lien interne pointe vers une route non
  déclarée dans a.pages (page blanche sans erreur) ; (b) une page déclarée
  n'utilise aucun asset("/images/…") (site sans visuels). Prompt : contraintes
  7 (nav ↔ pages déclarées) et 8 (≥1 image produite par page).
### FIX E — historique /test1 persisté [À CODER]
- test1-routes.ts : persister le run dans chatMessages (sessionId = companyId)
  — message user (la commande) + résumé assistant à la fin (marque, durée,
  lien preview). Ainsi rouvrir /chat/<companyId> recharge l'historique.
- Le panneau vivant (Test1Panel) reste du live-only : on persiste un RÉSUMÉ
  lisible, pas l'état tâche par tâche.

## État
- [x] Investigation A (cause racine trouvée)
- [x] Investigation B (cause racine trouvée : /test1 ne persiste rien)
- [x] FIX D cohérence routes/images — internalRoutes() + 2 refus dans
      build_and_serve (route liée non déclarée ; page sans asset image) +
      contraintes 7/8 du prompt. Testé sur le vrai cas Vélo Mëm : détecte
      /collection et /services manquantes, ignore URLs externes et assets.
- [x] FIX E historique — test1-routes.ts persiste dans chatMessages
      (sessionId = companyId) : message user à la création, résumé assistant
      (succès avec lien /chat/<id>, ou échec avec la cause). t0 ajouté.
- [x] typecheck — bunx tsc --noEmit exit 0
- [x] dev server rechargé (vite ssr page reload confirmé dans le log)
- [x] rapport FR — fait dans le chat

## TERMINÉ le 2026-09-09 (2e vague)

# ── NOUVELLE DEMANDE (2026-09-09, 3e vague) : maquette plaquée au lieu d'être reconstruite ──

## Demande (FR) + capture jointe
Le site généré ne RECONSTRUIT pas l'image : l'image REPRÉSENTE le site, elle ne
doit pas ÊTRE dans le site. Capture : une maquette complète (menu, titre,
produit, sections cuits dans l'image) plaquée telle quelle. Nouveau lien :
company f946fb96.

## Investigation (faite)
- f946fb96 : Home.tsx a une VRAIE nav HTML (topbar, nav-links, chips, buttons)
  MAIS pose AUSSI home-hero.webp (2400×2400) = maquette avec interface cuite
  dedans → interface en DOUBLE (cuite + réelle). Cause : le skill demande des
  cadres « interface déjà dans l'image » (storefront.md) mais rien n'obligeait
  l'agent à RECONSTRUIRE au lieu de plaquer.

## FIX F — maquette → assets propres → reconstruction [CODÉ]
- test1-lab.ts publish_image : garde-fou VISION (toVisionJpg + VISION_MODEL
  flash, coût faible). Refuse toute image contenant une interface de site
  cuite (menu/titre/boutons/prix) ; le texte SUR le produit ne compte pas.
  Message de refus = instruction de correction (fond seul / produit détouré /
  reconstruire en HTML).
- systemPrompt : section « LA MAQUETTE N'EST PAS LE SITE » — workflow en
  3 étapes (maquette = référence design ; extraire fond seul + produit
  détouré ; reconstruire en vrai code cliquable).

## État
- [x] Investigation
- [x] FIX F codé
- [x] typecheck — bunx tsc --noEmit exit 0
- [x] dev server rechargé (vite ssr page reload test1-lab.ts confirmé)
- [x] rapport FR — fait dans le chat

## TERMINÉ le 2026-09-09 (3e vague)

# ── Historique : 3 bugs /test1 [TERMINÉ 2026-09-09] ──
(voir section « TERMINÉ le 2026-09-09 » plus bas : cancel, preview live,
abandon finish — typecheck exit 0)

# Véloria bug — build relancé + logo en double [TERMINÉ]

# ── NOUVELLE DEMANDE (2026-09-09) : 3 bugs /test1 ─────────────────────────

## Demande utilisateur (FR)
1. `/test1` n'est pas connecté au visuel de l'app : le run n'affiche que du
   texte dans le chat, pas la preview live du site qui se construit. L'IA doit
   interagir avec le vrai système visuel (aperçu à droite), pas un panneau
   texte isolé.
2. Bouton envoyer ne se transforme PAS en bouton cancel pendant un run /test1
   → impossible d'arrêter. Veut : cancel visible + cancel qui annule VRAIMENT.
3. Bug run « cret une mark e vélo » : l'agent s'est arrêté sans appeler finish
   (« Blocage technique sur la déclaration des images ») → le harnais jette
   « L'agent s'est arrêté sans appeler finish ». L'agent abandonne au lieu de
   corriger.

## Investigation (faite)
- SKILL : packages/web/skill_test1/SKILL.md (+ references/worldsmith.md,
  storefront.md, looks/01-10.png). Chimera = marque d'un monde impossible.
- test1-routes.ts : POST /test1/stream → SSE, crée company AVANT run,
  abort controller via stream cancel. runTest1({category,userId,companyId,
  signal,emit}). Met à jour company.name à la fin.
- test1-lab.ts (877 lignes) : agent autonome (BRAIN=gpt-5.4-mini,
  VISION=gemini-3-flash, IMAGE=gemini-2.5-flash-image). Outils : plan_tasks,
  start_task, finish_task, note, read_skill, look, announce_frame_prompts,
  generate_image, shell, publish_image, write_project_file, read_project_file,
  list_state, build_and_serve, verify_browser, finish.
  - build_and_serve : scaffold + fichiers agent + assets.ts + App.tsx →
    writeFilesToDisk(companyId) → installDeps → buildWithAutoFix →
    persistProjectFiles → startDevServer(companyId) → devPort/devBase/devUrl.
    LE SERVEUR VITE TOURNE pendant le run → la preview standard PEUT l'afficher.
  - Bug finish : `if (!finished) throw` après generateText. L'agent a bloqué
    sur « déclaration d'assets » (publish_image refusé ? write_project_file
    refusé par assetFaults ?) puis s'est arrêté. stopWhen=stepCountIs(120).
- chat.tsx :
  - runTest1Flow (~6229) : fetch /api/test1/stream avec test1AbortRef,
    remplit run (Test1RunState) : tasks/notes/status. À la fin : lien
    « Ouvrir le projet » → /chat/<companyId>. NE touche PAS la preview.
  - Branche (~6649) : if /^\/test1\b/ → runTest1Flow(msg).
  - Test1Panel (components/Test1Panel.tsx, 164 lignes) : panneau tâches+notes
    + horloge. Rendu à ~7633 si test1Run.
  - cancelRequest (~4110) : gère genesis (genesisRunningRef), isBuildingThis
    (build.cancelBuild), chat (abortRef). NE gère PAS test1.
  - isWorking (~7291) = chatLoading || isBuildingThis || genesisWorking.
    showCancel = isWorking. NE contient PAS test1Running → bouton cancel
    invisible pendant /test1. BUG 2 CONFIRMÉ.
  - showPreview (~2721) = ... || hasExistingWebsite. hasExistingWebsite setté
    (~3615) si projectId && (projectFiles>3 || pages>0). projectId = params?.id
    (~2630) — pendant /test1, l'URL n'est PAS /chat/<companyId> → projectId
    null → hasExistingWebsite false → pas de preview. BUG 1 CONFIRMÉ.

## Plan de fix
### FIX A — cancel (bug 2)
- isWorking += test1Running (état React, pas ref — le ref ne re-render pas).
  Ajouter `const [test1Running, setTest1Running] = useState(false)` ou lire
  test1Run?.status === 'running'. Le plus simple : dériver de test1Run.
- cancelRequest : branche test1 en premier : test1AbortRef.current?.abort(),
  test1RunningRef.current = false, setTest1Run(statut error « arrêté »).
  Le abort fetch → stream cancel côté serveur → abort.signal → halt() jette
  dans les outils. Vérifier que halt() est bien appelé dans generate_image,
  shell, build_and_serve, verify_browser (oui, halt() présent).

### FIX B — preview live (bug 1)
- Au premier événement serveur qui donne l'URL de preview (build_and_serve ok),
  afficher la preview standard. Options :
  a) navigate(`/chat/${companyId}`) dès que le serveur tourne → la page recharge
     avec projectId=companyId, hasExistingWebsite détecte projectFiles>3 →
     preview live. Mais ça coupe le flux SSE (changements de page).
  b) Rester sur la page, ajouter un état test1PreviewUrl et l'inclure dans
     showPreview + passer companyId au panneau preview. Moins invasif pour le
     flux mais touche la logique preview.
  - Le serveur émet déjà note « build ok — serveur sur le port N » mais pas
    l'URL de preview. Ajouter un événement dédié { type:'preview', companyId,
    previewUrl } dans build_and_serve après startDevServer.
  - Front : sur ev preview → setTest1Preview({companyId, url}) et l'intégrer
    à showPreview / au composant de preview. REGARDER comment le panneau
    preview reçoit sa company (props projectId ?) avant de coder.

### FIX C — abandon sans finish (bug 3)
- Le vrai souci : l'agent se dit « bloqué » et s'arrête. Renforcer :
  1. systemPrompt : interdiction d'abandonner — si un outil refuse, corriger
     et réessayer ; n'arrêter qu'après finish. Expliciter que « je m'arrête »
     est un échec du run.
  2. publish_image/write_project_file : les refus renvoient déjà la cause ;
     vérifier que le message pousse à corriger (il le fait).
  3. Filet harnais : si !finished, relancer UNE fois l'agent avec le dernier
     état (list_state) et l'ordre « termine : build_and_serve, verify_browser,
     finish » au lieu de jeter direct. Mais règle dure du module : « aucune
     reprise automatique ». → Préférer renforcer le prompt + message d'erreur
     plus clair. À discuter : la règle « pas de reprise » est dans le code,
     la casser = changer la philosophie. Le plus sûr : durcir le prompt et
     faire que l'erreur finale inclue list_state pour debug.

## État
- [x] Investigation
- [x] FIX A cancel — isWorking += test1Run?.status==='running' (~7300) ;
      cancelRequest : branche test1 en premier (abort → stream.cancel →
      halt() jette dans l'outil en cours). halt() ajouté à look,
      publish_image, write_project_file pour un arrêt réactif.
- [x] FIX B preview live — serveur : événement {type:'preview'} émis dans
      build_and_serve après startDevServer. Front : state test1PreviewId
      (déclaré AVANT showPreview, sinon TDZ), showPreview/websiteViewable
      += !!test1PreviewId, previewCompanyId = projectId || test1PreviewId
      utilisé dans le rendu du panneau (WebsitePreview lit build-status →
      'completed' → iframe directe, pas de double démarrage). Purge sur
      navigation (projectId change) et au début de chaque nouveau run.
      PAS de navigate('/chat/<id>') : couperait le flux SSE.
- [x] FIX C abandon finish — systemPrompt : section « INTERDICTION
      D'ABANDONNER » (refus d'outil = instruction de correction, list_state
      pour se repérer, seul finish termine). Erreur finale !finished enrichie
      de l'état du run (images publiées, fichiers écrits, serveur).
      PAS de reprise automatique (règle dure du module respectée).
- [x] typecheck — bunx tsc --noEmit exit 0
- [x] rapport FR — fait dans le chat

## TERMINÉ le 2026-09-09

# ── Historique : Véloria (terminé) ─────────────────────────────────────────


## Diagnostic COMPLET (vérifié DB + code)

**Timeline réelle** :
- 20:33:59 company Véloria créée
- 20:35:09 init + build-website démarrent
- 20:35:23 init Step 5 : pas de logo → lance IIFE async (génération ~40 s)
- 20:35:26-27 user APPROUVE l'aperçu de marque → logo 1 + guidelines écrits (approve)
- 20:36:13-14 l'IIFE init termine SA génération → logo 2 écrit SANS re-vérifier → **DOUBLE LOGO**
- 20:37:20 user clique STOP → `/cancel-build` → executionState 'cancelled' ("Cancelled by user")
- 20:38:21 job meurt au prochain assertJobNotCancelled ("✅ 4 pages terminées" = dernier event)
- Résultat : 46 project_files (vrai code) mais 0 websitePages, pas de `.velbaz/plan.json`
- 20:51 user tape `/test1 cret une mark e vélo` → test1-routes.ts:47 crée company f1436207 (**par design**, commande isolée — PAS le bug)

**Qui a annulé** : appel explicite à `/cancel-build` (error "Cancelled by user") = clic stop de l'utilisateur. Le self-heal (14158) respecte déjà 'cancelled' → ne relance pas. OK.

**Pourquoi "l'IA redemande de commencer"** :
- chat/stream ~9600 : `projectHasBuilt = !!websitePages` → 0 pages → `isInProject = false`
- → le message retombe dans le flux DÉCOUVERTE (handleBusinessIdea / questions) comme si rien n'existait
- le checkpoint build (plan + 4 pages dans executionState.checkpoint.build) est IGNORÉ car personne ne relance avec resumeBlob

## FIXES à écrire (index.ts)

### FIX 1 — course logo (init Step 5, ~2332-2366)
Dans l'IIFE : après `generateLogoImage` réussi, RE-vérifier designAssets logo ; si présent (approve a gagné), NE PAS insérer, message "Logo validé conservé".

### FIX 2 — approve idempotent (~10776)
Avant d'insérer, vérifier si un logo existe déjà → si oui, ne pas doubler (update ou skip).

### FIX 3 — "repartir de zéro" (chat/stream ~9600)
Étendre la détection : si 0 websitePages MAIS (project_files > 3 OU checkpoint build avec pages) ET dernier exec build-website = 'cancelled'/'failed' → traiter comme projet existant interrompu : NE PAS renvoyer en découverte. Le front a déjà hasExistingWebsite (projectFiles > 3) → triggerBuild réutilise la company et runBuild relance. Côté serveur, faire que le build reprenne le checkpoint (resumeBlob) au lieu de régénérer.

## Fichiers
- packages/web/src/api/index.ts (14412 lignes)
- packages/web/src/api/agents/orchestrator.ts (1738 lignes, lu)
- packages/web/src/web/pages/chat.tsx, build-store.ts (lus)

## État
- [x] Investigation
- [x] FIX 1 logo — DÉJÀ en place (index.ts ~2348 : re-vérif logoNow avant insert)
- [x] FIX 2 approve — DÉJÀ en place (index.ts ~10797 : update prevLogo + delete doublons)
- [ ] FIX 3 reprise — À ÉCRIRE. Plan validé après lecture :
  - 3a) POST /build-website (~3611) : si !force et dernier exec build-website
    'cancelled'/'failed' avec checkpoint.build (plan/design/pages) → passer
    resumeBlob + styleRef à startBuildWebsite, fermer l'ancienne ligne
    (superseded_by_resume). Central : front triggerBuild, self-heal, chat
    passent tous par cet endpoint.
  - 3b) chat/stream bloc isContinue (~9548) : getResumableExecution ignore
    'cancelled' → ajouter un else : si dernier build-website cancelled/failed
    et !companyHasBuiltOutput → relancer avec resumeBlob + stream resumeMsg.
  - 3c) détection (~9610) : flag projectInterrupted (0 pages MAIS exec build
    cancelled/failed avec checkpoint) → passer companyContext à l'orchestrateur
    même si isInProject=false (évite le flux découverte à froid).
  - NOTE : GO_COMMAND_RE (orchestrator ~882) force déjà shouldBuild sur
    "continue/commence" → avec 3a, triggerBuild reprendra le checkpoint.
- [x] typecheck — `bunx tsc --noEmit` exit 0 (14443→14536 lignes)
- [x] rapport FR — fait dans le chat

## TERMINÉ le 2026-09-09
- 3a) /build-website : reprise checkpoint sur exec cancelled/failed (~3640)
- 3b) chat/stream « continue » : branche cancelled/failed + resumeBlob (~9597)
- 3c) flag projectInterrupted → companyContext + skipQuestions à l'orchestrateur
      (~9683 détection, ~10050 appel)
- Bonus : TDZ chatTokenBalance corrigé (déclaration déplacée avant le bloc
  « continue » qui la lisait — ReferenceError latent à l'exécution)

## Vague 7 (2026-09-09) — changement global des modèles par défaut
- `claude-opus-4.7` → `claude-sonnet-4.6` partout : builder/engine.ts (FALLBACK_CHAIN, ai/aiText defaults, EDIT_MODEL), engine-mobile.ts (FALLBACK_CHAIN, HEAVY_MODEL), scaffold.ts (MODEL), agents/website.ts, index.ts (pickModel code/design + texte système), chat.tsx + build-store.ts (labels UI).
- Entrée de prix opus-4.7 conservée dans ai-usage-log.ts, marquée legacy.
- Images du flux company sans commande : `gemini-3-pro-image` → `gemini-2.5-flash-image` (nano banana 1) dans index.ts + builder/images.ts. test-lab.ts (legacy) et test1-lab.ts (déjà nano banana) inchangés.
- Vérifié : `bunx tsc --noEmit` exit 0, reload SSR vite confirmé dans /tmp/velbaz-dev.log.

## Vague 8 (2026-09-11) — correctif « l'aperçu reste un squelette pendant tout le build »
- CAUSE RACINE : le HMR de Vite ne fonctionne JAMAIS dans l'aperçu. Le client
  Vite ouvre son WebSocket sur l'URL publique de la page
  (`/api/companies/<id>/preview/`), donc sur le reverse proxy de
  `builder/routes.ts`, qui est un simple `fetch()` HTTP sans gestion de
  l'`Upgrade: websocket`. Vérifié en servant `@vite/client` à travers le proxy :
  `hmrPort=null`, `directSocketHost="localhost:<portVite>"` (injoignable depuis
  le navigateur). Conséquence : les stubs squelette écrits au démarrage
  restaient à l'écran pendant TOUT le build ; le vrai site n'apparaissait qu'à
  la fin, au remontage de l'iframe.
- CORRECTIF : canal de rechargement piloté par révision, sans WebSocket.
  - `builder/runner.ts` : registre mémoire `previewRev` (`rev` = toute écriture,
    `mrev` = jalons seulement) + `bumpPreviewRevision()` / `getPreviewRevision()`.
    Appelé par `writeFilesToDisk`, `writeFilesIncremental(…, opts)`,
    `startDevServer` et `buildWithAutoFix` (corrections auto-fix incluses).
  - `builder/engine.ts` : nouveau `FileReadyKind` « page-partial » ; les
    snapshots de streaming d'une page en cours passent en « page-partial »
    (écrits sur disque mais NON considérés comme jalons).
  - `builder/routes.ts` : route publique `GET /companies/:id/preview-revision`
    + script `data-velbaz-live` injecté dans le HTML proxifié UNIQUEMENT quand
    une écriture date de moins de 5 min (`PREVIEW_ACTIVE_MS`). Le script sonde
    toutes les 1,2 s et recharge quand `mrev` a bougé PUIS que `rev` est stable
    depuis 1,5 s (jamais de code à moitié écrit à l'écran).
  - `api/index.ts` (2e flux onFileReady) + `builder/routes.ts` (build-app) :
    `kind` transmis à `writeFilesIncremental` → `{ milestone: kind !== 'page-partial' }`.
  - `location.reload()` (pas de remontage d'iframe) → l'URL de la page où
    l'utilisateur a navigué est conservée ; la position de défilement est
    restituée via sessionStorage.
- TESTS : `packages/web/scripts/test-live-preview.ts` (+ `.py`, navigateur réel)
  rejouent la chronologie d'un build. Résultat : script injecté ✅, 0
  rechargement sur snapshot partiel ✅, exactement 1 rechargement après le jalon
  ✅, nouveau contenu réel visible ✅. `bun run build` exit 0.

## [2026-09-11] Connexion X (Twitter) réelle — fin du mode démo

**Problème.** Cliquer « Connecter X » ne connectait rien de réel : sans clés API,
`hasRealKeys('twitter')` renvoyait `false` et la route `POST
/companies/:id/social/connect` fabriquait une connexion factice
(`demo_token_…`, pseudo `twitter_user`) sans jamais ouvrir X. Trois autres
faiblesses rendaient le vrai flux fragile même avec des clés.

**Corrections.**
- `.env` : `TWITTER_CLIENT_ID` / `TWITTER_CLIENT_SECRET` réels,
  `PUBLIC_URL=https://velbaz.com` (construit les `redirect_uri`) et
  `OAUTH_STATE_SECRET` dédié.
- `platforms.ts` : autorisation sur `x.com/i/oauth2/authorize` (au lieu de
  `twitter.com`, qui redirige), helper `twitterTokenRequest()` partagé par
  `exchangeCode`/`refreshAccessToken` — Basic auth si secret présent, sinon
  client public — avec messages d'erreur explicites (401 → identifiants ou type
  d'app, `redirect_uri` → callback non conforme, `invalid_grant` → code expiré).
- `routes.ts` : le `code_verifier` PKCE n'est plus dans une Map en mémoire
  (perdue à chaque redémarrage) mais chiffré AES-256-GCM dans le `state`
  (`v2.iv.ct.tag`, TTL 15 min), avec contrôle d'intégrité et refus d'un `state`
  destiné à une autre plateforme. Nouvelle route de diagnostic
  `GET /api/social/config`. `GET …/social/connections` expose `isDemo` et ne
  renvoie plus jamais de jeton au navigateur.
- `SocialConnectPopup.tsx` / `SocialConnectPanel.tsx` : la fermeture de la popup
  n'est plus interprétée comme un succès. Sans message `oauth-success`, le front
  interroge le serveur (`connections`) et n'affiche « connecté » que si une
  connexion active et non-démo existe ; sinon erreur explicite (annulation,
  délai dépassé, popup bloquée).

**Vérifié.** `bun run build` exit 0. `/api/social/config` → twitter `real:true`,
`mode:"oauth"`. Le `connect` renvoie une URL `x.com` complète (S256,
scopes `tweet.read tweet.write users.read offline.access`, `state` `v2.` 206
car.). Callback : `state` valide → échange réellement tenté auprès de X (rejet
400 attendu sur code factice) ; `state` corrompu → « État OAuth invalide ou
expiré » ; `state` d'une autre plateforme → « État OAuth incohérent ».

## [2026-09-11] Plus de blocage dans un réseau : connexion/déconnexion libres

**Problème.** Une fois un réseau choisi, l'utilisateur était enfermé : (1) le
panneau de droite était court-circuité par `SOCIAL_ONLY_AI_COMMS`, donc plus
aucun bouton de connexion ni de déconnexion n'était affiché ; (2) après une
connexion, `socialPhase` passait à `active` et cet écran n'offrait aucun retour
vers le choix des réseaux ; (3) `setConnectedPlatforms(successfullyConnected)`
écrasait la liste, donc lier un 2e réseau effaçait le 1er ; (4) le bouton
« Continue » appelait `startConnecting()` qui sortait immédiatement quand rien
n'était sélectionné — bouton mort.

**Corrections.**
- `SocialRightPane` : nouvelle barre de statut permanente au-dessus de la vue du
  réseau — état réel (« Connecté — @pseudo », « Connexion simulée (démo) », « Non
  connecté ») + bouton **Se connecter** ou **Déconnecter**. Affichée aussi dans
  la branche `SOCIAL_ONLY_AI_COMMS`, avec les erreurs de connexion.
- `SocialConnectPanel` : `refreshConnections()` interroge
  `GET …/social/connections` (serveur = source de vérité) au montage et après
  chaque connexion/déconnexion ; `disconnectPlatform()` appelle
  `DELETE …/social/:platform` puis rouvre l'écran de choix s'il ne reste aucun
  réseau ; la liste des réseaux liés est désormais une **union** (lier un 2e
  réseau ne supprime plus le 1er) ; pastille verte (ou orange si démo) sur les
  logos réellement liés ; bouton **Gérer les réseaux** dans l'en-tête de la
  phase active pour revenir au choix ; « Continue » sans sélection renvoie
  maintenant au tableau de bord au lieu de ne rien faire.

**Vérifié.** `bun run build` exit 0. Sur une vraie société : connexion d'un 2e
réseau → les deux apparaissent actifs ; `DELETE` → `isActive` passe à 0 et la
ligne disparaît de la liste côté UI (`Boolean(isActive) && !isDemo`).

**À noter.** La société de test portait encore une connexion Twitter **démo**
(`demo_twitter_…`, pseudo `twitter_user`) créée avant l'ajout des clés : d'où les
403 « Unsupported Authentication » du moniteur (jeton application-only au lieu
d'un jeton utilisateur). Il faut la **déconnecter puis reconnecter** pour obtenir
un vrai jeton OAuth utilisateur.

---

## [2026-09-11] Popup OAuth qui retombait sur la page 404 Runable

**Symptôme.** Après avoir autorisé l'app sur X, la popup affichait « This site
doesn't exist yet » (404 Runable) : aucune connexion enregistrée.

**Cause.** `getPublicBaseUrl()` utilisait toujours `PUBLIC_URL=https://velbaz.com`
pour construire le `redirect_uri`. Or rien n'est publié sur ce domaine
(`curl https://velbaz.com/api/health` → 404) : X renvoyait donc l'utilisateur sur
une URL morte, et la route de callback n'était jamais exécutée.

**Correction.**
- `getPublicBaseUrl(c, clientOrigin)` : nouvelle priorité →
  `OAUTH_REDIRECT_BASE` (override) → origine envoyée par le navigateur →
  `Referer` → en-tête `Host` (hors localhost) → `PUBLIC_URL` en dernier recours.
- Le proxy Runable réécrit `Host`/`Origin` vers l'hôte interne du bac à sable
  (`…e2b.app`), donc le front envoie explicitement `window.location.origin` dans
  le POST `…/social/connect` (4 appelants : `SocialConnectPanel`,
  `SocialConnectPopup`, `SocialSandboxOverlay`, `CommunityDashboard`).
- Le `redirect_uri` exact est mémorisé **chiffré dans le `state`** (champ `r`) et
  relu à l'échange du jeton : X exige des valeurs strictement identiques entre
  l'autorisation et l'échange, et l'en-tête `Host` du callback ne permet pas de
  le reconstruire.
- `GET /api/social/config?origin=…` permet de vérifier l'URL de callback exacte.

**Vérifié.** `bun run build` exit 0. `POST …/social/connect` depuis l'URL
d'aperçu renvoie désormais
`redirect_uri=https://velbaz7-99g2ilz-preview-4200.runable.site/api/social/callback/twitter`,
et cette URL répond 200 (page de résultat OAuth) au lieu du 404 Runable.

**Reste à faire côté utilisateur.** Enregistrer cette URL exacte dans la
« Callback URI » de l'app X (Developer Portal), ou publier velbaz.com puis y
enregistrer `https://velbaz.com/api/social/callback/twitter`.

---

## [2026-09-11] `bundle-server failed` à la publication

**Symptôme.** La publication s'arrêtait sur
`Could not resolve: "protobufjs/minimal.js"` (via `ccxt`) puis
`Could not resolve: "chromium-bidi/..."` (via `playwright-core`).

**Cause.** Le bundler serveur suivait les imports dynamiques
`await import('ccxt')` / `await import('playwright-core')` et tentait d'inliner
ces paquets ; leurs dépendances optionnelles ne sont pas installées, d'où l'échec.

**Correction.**
- `packages/web/src/api/lib/optional-import.ts` : helper `importOptional(name)`
  qui passe le nom du module par une **variable** → le bundler ne peut plus le
  résoudre statiquement et laisse l'import au runtime.
- Les 8 appels concernés utilisent ce helper (`test-lab`, `test1-lab`,
  `genesis-verify`, `site-scraper`, `chat-file-pdf`, `agent-tools/browser`,
  `builder/live-qa`, `crypto/broker`).
- `protobufjs` ajouté aux dépendances (réclamé par `ccxt` en runtime).

**Vérifié.** `bun build packages/web/src/api/index.ts --target=bun` → 0 erreur
(bundle de 8,8 Mo produit). `bun run build` exit 0. Chargement runtime testé :
`importOptional('playwright-core')` et `importOptional('ccxt')` renvoient bien
les modules. Serveur de dev toujours 200 sur `/api/health`.

**Suite [2026-09-11] — health check en échec au déploiement.** Le bundle serveur
démarrait puis mourait aussitôt (`TypeError: undefined is not an object
(evaluating 'format.jp2k.output')`) : `sharp` est une bibliothèque **native**
(libvips) et ne survit pas à l'inlining dans le bundle. Elle est désormais
chargée au runtime via `getSharp()` (cache module) dans `chimera.ts`,
`printify-design.ts`, `builder/images.ts` et `upscale.ts`.
**Vérifié.** Bundle relancé : le serveur démarre (`Started server`), moniteurs et
schedulers OK, `GET /api/health` → 200 sur le bundle de production lui-même.

## [2026-09-12] — Connexion sociale : navigation + honnêteté du statut de publication

**Problèmes signalés**
1. Cliquer sur « Connecter » faisait quitter l'écran de connexion (passage automatique en phase `learning` plein écran).
2. L'UI affichait « Published to X » même quand rien n'avait été envoyé.
3. Recliquer « Connecter » sur un réseau **déjà connecté** relançait l'OAuth → X répond « Something went wrong ».

**Corrections**
- `SocialConnectPanel.tsx`
  - `startConnecting()` ne relance plus l'OAuth pour les plateformes déjà dans `connected` (guard `toConnect`). Si tout est déjà connecté → passage direct en `active`, aucun appel `/social/connect`.
  - Suppression de la transition automatique vers la phase `learning` : l'utilisateur reste sur l'écran qui porte le bouton Connecter ; le pipeline (`learn-style` + `generate`) tourne en arrière-plan.
  - `lastPost` porte désormais `published: boolean` et `error?: string`, lus depuis `data.published` / `data.publishError`.
  - Bandeau de statut vert « Publié sur X » **uniquement** si `published === true`, sinon bandeau rouge « NON publié sur X — texte généré uniquement » + message d'erreur réel.
  - Bandeau de statut dupliqué sur l'écran `connecting` pour que le résultat soit visible sans changer d'écran.
  - Libellé du bouton recalculé : « Connecter N réseau(x) » / « Continuer » / « Sélectionne un réseau ».
- `SocialSandboxOverlay.tsx` — mêmes corrections (guard `toConnect`, `published`/`error` sur `lastPost`, bandeau conditionnel vert/rouge, lien « Voir la publication » seulement si réellement publié).
- `SocialConnectPopup.tsx` — `startConnecting()` vérifie d'abord `verifyConnection(platform)` côté serveur et saute l'OAuth pour les comptes déjà liés.
- Quand le pipeline n'a même pas tenté de publier (`status !== 'approved'`), le message affiché est « Contenu non approuvé par l'IA (statut : …, score …) » au lieu d'un faux succès.

**Vérifié** : `tsc --noEmit` 0 erreur, `bun run build` exit 0, `GET localhost:4200/api/health` → 200.
**Source serveur confirmée** : `runContentPipeline` (`packages/web/src/api/social/pipeline.ts:487-502`) pose `result.published = true/false` et `result.publishError`, renvoyés tels quels par `POST /companies/:id/social/generate`.

## [2026-09-13] — L'IA annonçait un post envoyé alors que X l'avait refusé

**Cause racine (2 mensonges distincts, tous les deux dans `autopilot.ts`)**
1. `executeCreatePost` renvoyait `{ posted: true }` dès que `runContentPipeline` ne levait pas
   d'exception. Or le pipeline attrape l'échec de publication en interne et le remonte dans
   `result.published` / `result.publishError` : l'autopilote annonçait donc « posté » alors que
   X avait renvoyé 402 `credits-depleted`.
2. `executeTask` marquait la tâche `completed` et loguait « ✅ Completed » sans jamais regarder
   le contenu de `output` — donc même un `posted: false` s'affichait comme une réussite dans
   le flux d'activité, et `completedTasks` du plan était incrémenté.

**Corrections**
- `executeCreatePost` se fie uniquement à `result.published === true`. Sinon : retour
  `posted: false` + `error` + `errorCode`, et création d'un insight `warning` « Post {platform}
  NON publié » avec le lien de déblocage.
- `executeTask` lit le résultat : `posted: false` / `published: false` / `error` présent →
  statut `failed`, log « ❌ Échec : … », `completedTasks` non incrémenté. `skipped: true` →
  log « ⏭️ Ignoré : … ». Seul un vrai succès garde « ✅ Completed ».
- Nouveau `packages/web/src/api/social/publish-errors.ts` : `explainPublishError(raw, platform)`
  traduit le JSON brut de la plateforme en message actionnable + `code` stable + `fixUrl`.
  Cas couverts : `credits_depleted` (402), `rate_limited` (429), `token_invalid` (401 /
  Unsupported Authentication / demo_token), `duplicate`, `forbidden` (403), `too_long`,
  `not_connected`, `unknown`. L'ordre des tests met `duplicate` avant le 403 générique.
- `pipeline.ts` : le bloc catch d'auto-publish passe par `explainPublishError`. `PipelineResult`
  porte désormais `publishErrorCode`, `publishErrorRaw` (brut, pour les logs) et `publishFixUrl`.
- `SocialConnectPanel.tsx` / `SocialSandboxOverlay.tsx` : le bandeau rouge affiche le message
  actionnable et un lien « Débloquer le compte → » quand `publishFixUrl` est fourni.
- `SocialConnectPanel.tsx` : bouton « Connecter N réseau(x) » retiré du footer à la demande de
  l'utilisateur (il relançait l'OAuth X) — le footer ne fait plus qu'avancer vers la phase active.

**Vérifié** : `tsc --noEmit` 0 erreur ; `bun run build` exit 0 ; `GET /api/health` → 200 ;
`explainPublishError` testé sur 7 cas dont le JSON 402 exact remonté par l'utilisateur (7/7 OK).

**Hors code** : le 402 `credits-depleted` vient du compte développeur X. L'API X est facturée à
l'usage depuis 2025 ; un projet à 0 crédit refuse `POST /2/tweets` même sur le palier gratuit et
même sans aucun post envoyé. Seul le rechargement dans la console X (Billing → Purchase Credits)
débloque l'envoi réel.

## [2026-09-13] — Créer/envoyer un post depuis l'écran de connexion (plus de « Continuer »)

**Demande** : pouvoir écrire et envoyer un post directement dans la partie « se connecter »,
sans devoir cliquer « Continuer » ni atterrir sur une autre page.

**Avant** : le bouton « Generate & Post Now » n'existait que dans la phase `active`. L'écran de
connexion n'offrait aucun moyen de publier → il fallait changer d'écran.

**Corrections dans `SocialConnectPanel.tsx`**
- Nouvelle fonction partagée `generateAndPost(targets, prompt?)` : extraite du bouton de la phase
  active, appelable depuis n'importe quel écran. Gère aussi les réponses HTTP non-OK (le cas
  `connection_required` 400 était avalé avant) et remplit `lastPost` avec le statut réel.
- Nouveau bloc `composer` : zone de texte libre + bouton d'envoi + rappel des 8 cerveaux.
  Texte vide → l'IA choisit le sujet ; texte saisi → envoyé comme `prompt` au pipeline.
  Désactivé avec un message explicite quand aucun réseau n'est lié.
- `publishTargets` = union de `connected` (local) et `connectedPlatforms` (store) → les cibles
  de publication sont les réseaux réellement liés, quel que soit l'écran.
- Le `composer` est rendu **aux deux endroits** : sur l'écran de connexion (juste au-dessus du
  bandeau de statut) et sur l'écran actif, où il remplace l'ancien bouton isolé.
- Nouvel état `composeText`.

**Vérifié** : `tsc --noEmit` 0 erreur ; `bun run build` exit 0 ; `GET /api/health` → 200 ;
chaîne « Créer et envoyer un post » présente dans le bundle compilé (`dist/assets/chat-*.js`).

## [2026-09-13] — Écran de connexion : « Continuer » retiré, bouton d'envoi compacté
- Le bouton « Continuer / Connecter N réseau(x) » du pied de l'écran de connexion est
  supprimé : il ne reste que « Skip for now ». Tout (connexion + rédaction + envoi) se
  fait sur ce même écran, il n'y a plus d'écran suivant vers lequel avancer.
- Le bouton du compositeur prenait toute la largeur du panneau. Il est désormais
  auto-dimensionné (px-3 py-1.5, texte 10px), aligné à droite sur la même ligne que la
  note « vérifié par les 8 cerveaux », avec des libellés plus courts
  (« Envoyer » / « Générer et envoyer » / « Envoi… »).
- Vérifié : tsc 0 erreur, `bun run build` OK, /api/health 200.

## [2026-09-13] — Compositeur : une ligne par plateforme, format compact
- Avant : une seule grande zone de texte (2 lignes) commune à tous les réseaux, qui
  publiait le même prompt sur toutes les plateformes connectées d'un coup.
- Maintenant : une ligne compacte PAR plateforme connectée — icône 20px + champ
  `input` d'une seule ligne (texte 10px) + petit bouton « Envoyer » (9px).
  Entrée au clavier envoie aussi. Chaque envoi ne cible que sa propre plateforme.
- `composeText: string` remplacé par `composeTexts: Record<string, string>` (clé =
  id de plateforme) ; nouvel état `sendingTo` pour n'afficher « … » que sur la ligne
  en cours d'envoi et geler les autres champs pendant ce temps.
- `generateAndPost(targets, prompt, marker?)` : 3e paramètre facultatif pour marquer
  la ligne active.
- Vérifié : tsc 0 erreur, `bun run build` OK, /api/health 200, chaîne « Envoyer un
  post » présente dans le bundle compilé.

## [2026-09-13] — Compositeur remplacé par une barre de prompte (style page d'accueil)
- Les 4 champs « une ligne par plateforme » sont supprimés : trop d'éléments, et ça
  débordait du rectangle.
- À la place : UNE barre de prompte calquée sur celle de `pages/index.tsx` — boîte
  `rounded-2xl` sur `--surface-3` avec `--border-default`, textarea transparent qui
  grandit (max 80px), rangée du bas avec le bouton rond d'envoi (flèche droite,
  spinner pendant l'envoi).
- Le choix du réseau se fait par des pastilles rondes (24px) dans la barre : UNE
  plateforme à la fois (pas d'envoi groupé). `composeTarget` est recalé
  automatiquement sur un réseau réellement connecté via un `useEffect`.
- Contrainte de largeur : `w-full` + `maxWidth: 100%` + `boxSizing: border-box` +
  `overflow: hidden` sur la boîte, `min-w-0` sur le textarea et la rangée du bas →
  ne peut plus dépasser sur l'axe X.
- Entrée = envoi, Shift+Entrée = nouvelle ligne (même comportement que l'accueil).
- Vérifié : tsc 0 erreur, `bun run build` OK, /api/health 200.

## [2026-09-13] — La barre de prompte visait toujours X, même sur Discord
Cause : deux bugs cumulés dans `SocialConnectPanel.tsx`.
1. Un `useEffect` recalait `composeTarget` sur `publishTargets[0]` — comme X est le
   premier réseau lié, la cible revenait systématiquement sur Twitter/X.
2. Les pastilles de la barre ne listaient QUE les réseaux déjà liés : impossible de
   cliquer Discord, donc la cible restait X sans moyen de la changer.
Corrections :
- La cible suit désormais `activeId`, c.-à-d. le réseau sélectionné dans la liste
  au-dessus : être « sur Discord » vise Discord.
- Les 4 plateformes sont affichées dans la barre ; un réseau non lié reste visible
  (grisé), un point vert marque les réseaux liés.
- Plus aucun repli silencieux : `generateAndPost` refuse une cible non liée et
  affiche « X n'est pas connecté — lie ce réseau avant de publier » au lieu de
  publier ailleurs. Bouton d'envoi et touche Entrée désactivés dans ce cas.
- La barre affiche la destination réelle (`→ Discord`) à côté du bouton d'envoi.
- Vérifié : tsc 0 erreur, `bun run build` OK, /api/health 200.

## [2026-09-13]
- Barre de prompt (SocialConnectPanel) : suppression des pastilles de choix de réseau
  dans la barre. La cible suit uniquement la page réseau ouverte (`activeId`) — on clique
  le réseau dans la liste de gauche, la barre se cale dessus. Il ne reste qu'une petite
  icône statique (badge) qui confirme la cible + le label `→ Nom` / `non connecté`.
- AiCommsPanel (page Communications IA) : réécrit. N'affiche plus que le texte écrit par
  l'IA (posts + `reponseIA` des interactions), en bulles de chat, ordre ancien → récent.
  Supprimé : scores, grille de stats (vues/engagements/clics/réponses), onglets
  Publications/Réponses, message entrant brut. Conservé : heure, lien "voir",
  marqueur rouge "non envoyé" si status failed/rejected (exigence de véracité du statut).
- Scroll : snap en bas à l'ouverture (et au changement de réseau), puis scroll libre vers
  le haut ; les refresh (poll 20s) ne recalent en bas que si l'utilisateur y était déjà.

### [2026-09-13] correctifs suite retour
- AiCommsPanel : plus de bulles ni d'alignement à droite. Chaque message prend toute la
  largeur, aligné à gauche, séparé par un filet ; heure + "non envoyé" + "voir" en en-tête.
- Le texte affiché est désormais le message tel qu'il part : découpe sur `---TWEET---`
  (comme platforms.ts à l'envoi), un bloc par tweet avec repère `i/n`. Le délimiteur
  n'apparaît plus jamais dans le texte.
- Cause du mauvais contenu ("1/10 … guide de ton … Lis le guide") : la route
  `learn-style` (skipPublish) passait par BRAIN_WRITER, qui écrit des posts/threads,
  et le pipeline enregistrait quand même une ligne socialPosts → le guide interne
  apparaissait comme un message à envoyer.
  Corrigé : nouveau prompt BRAIN_STYLE_DOC (document interne, interdiction de
  `---TWEET---` et de la numérotation), nettoyage post-génération, et plus d'insertion
  dans socialPosts quand skipPublish. `ai-comms` filtre aussi
  `contentType === 'communication_style'` pour les lignes déjà en base.
- BRAIN_WRITER renforcé : le post doit être écrit AU NOM de l'entreprise, à SON audience,
  sur SON offre (nom + identité de marque du contexte). Interdit : guides de ton, listes
  de vocabulaire, règles, checklists, consignes, contenu adressé à l'équipe.
- Barre de prompte : elle était rendue SOUS la vue scindée (colonne de logos + panneau),
  donc elle dépassait du rectangle des messages. Elle est maintenant passée à
  SocialRightPane via la prop `footer` et rendue à l'intérieur, sous le fil ;
  `min-w-0` ajouté sur les conteneurs pour éviter tout débordement horizontal.
  Hors vue scindée, l'ancien rendu (`!SOCIAL_SPLIT_VIEW && composer`) est conservé.
- Bouton Publish du rectangle d'aperçu : masqué quand l'aperçu affiche
  « Communications IA » (messages / posts en direct), condition
  `projectId && !showSocialPanel` dans chat.tsx. Ce n'est pas le site, donc rien
  à publier ; la croix de fermeture reste.
- Vignette d'aperçu dans le chat (WorkResultCard) : c'était un <a target="_blank">,
  donc le clic ouvrait le site dans un nouvel onglet. Remplacée par un <button> qui
  n'appelle que `onOpenPreview` → l'aperçu s'ouvre dans le rectangle de droite.
  `onOpenPreview` remet aussi `showSocialPanel` à false pour que le rectangle affiche
  bien le site et pas « Communications IA ». Le bouton « Open » de l'en-tête de la
  carte garde volontairement l'ouverture en nouvel onglet.
- Bouton « Next » de l'aperçu du site : collé dans le coin bas-droit du rectangle
  (bottom 0 / right 0) au lieu de flotter à 16px. Un seul arrondi, sur le coin
  haut-gauche (18px) ; les deux côtés qui touchent le bord du rectangle restent
  droits. Ombre orientée vers l'intérieur (-2px -2px) pour le détacher du contenu.

## [2026-09-13] Bouton « Next » — raccords concaves dans le coin (corrigé)
- Le premier essai (bouton collé dans le coin avec un seul `border-top-left-radius`
  + ombre) a été refusé : « moche ». Demande réelle : l'arrondi doit PARTIR du bord
  du rectangle, tourner, et venir rejoindre le bouton → congés **concaves**.
- Forme déplacée du style inline vers `.preview-next-btn` dans `styles.css`
  (nécessite `::before` / `::after`, impossible en inline) :
  - `border-radius: 18px 0 0 0` → la « pointe » convexe en haut à gauche ;
  - `::before` (au-dessus, contre le bord droit) et `::after` (à gauche, contre le
    bord bas) : carré 16px `background: inherit` + `mask-image: radial-gradient(circle at 0 0, transparent 0 16px, #000 16.5px)`
    → un quart de disque évidé, donc un congé concave qui s'affine jusqu'à zéro sur
    le bord du rectangle ;
  - plus d'ombre (elle cassait la continuité avec le bord).
- `chat.tsx` : le `<button onClick={goToSocialPanel}>` utilise `className="preview-next-btn"`
  (style inline supprimé), icône + libellé inchangés.
- Vérifié : forme contrôlée sur capture headless Chrome, `tsc --noEmit` 0 erreur,
  `bun run build` OK, `/api/health` 200.

### [2026-09-13] Next — plus arrondi + liseré corrigé
- Retour : « trop plat, ça ressemble a une ligne ». Bouton passé a `height: 46px`
  (au lieu d'un padding vertical), libellé 13.5px.
- Rayons parametres en vars : `--next-r: 22px` (arrondi convexe) et `--next-f: 22px`
  (congés concaves). **Contrainte a respecter : `height >= --next-r + --next-f`** —
  sinon le congé de gauche mord sur l'arrondi convexe et un fin liseré de fond
  apparait a la jonction (c'était le bug avec r=26 / f=30 sur ~39px de haut).
- Chevauchement de 0.5px des pseudo-elements sur le bouton (`calc(100% - 0.5px)`)
  pour tuer le liseré d'anti-aliasing du masque.
- Vérifié sur capture headless (silhouette continue, aucune couture), tsc 0 erreur,
  build OK, /api/health 200.

### [2026-09-13] Next — arrondi COMPLET en S sur le cote
- Retour : « il doit y avoir un arrondi complet qui suit un cote vers le bouton ».
- Le cote gauche est maintenant UNE seule courbe continue : conge concave qui part du
  bord bas, le longe, remonte, puis se retourne en arrondi convexe pour former le haut
  du bouton. Plus aucune portion droite entre les deux arcs.
- **Regle geometrique a respecter** : `--next-r + --next-f-side == height`
  (ici 30 + 30 == 60). Si la somme est < height il reste un segment droit ; si elle est
  > height les arcs se chevauchent et une couture apparait (bug des 2 versions d'avant,
  ou le bord gauche en 999px laissait un cran visible).
- height 60px, padding 0 24px 0 34px, conge du cote droit --next-f-top 20px.
- Verifie sur capture headless (courbe continue, aucune couture), tsc 0 erreur,
  build OK, /api/health 200.

## [2026-09-13] Mini-apercu du chat : la page ENTIERE, plus un bout coupe
- Demande : le petit rectangle d'apercu dans le chat doit montrer toute la page,
  pas seulement le haut.
- Pourquoi pas une iframe : pour tout montrer il faudrait lui donner la hauteur du
  document, ce qui fait exploser les sections min-h-screen/100vh (elles prendraient
  la hauteur de la page entiere, qui grandit a chaque mesure -> boucle).
- Nouveau : packages/web/src/api/builder/preview-shot.ts — capture pleine page dans
  un Chrome headless (playwright-core + chrome systeme, comme genesis-verify) :
  viewport 1280x800, clic sur « Tout accepter » du bandeau cookies, liberation des
  conteneurs de defilement interne (h-screen overflow-y-auto -> height auto, sinon
  le document ne fait qu'un viewport), parcours de defilement pour declencher les
  reveals, animations figees, puis fullPage: true (garde le viewport de mise en
  page, donc 100vh juste et header fixe dessine une seule fois). Borne a 9000px.
  Cache memoire par (projet + revision d'apercu), TTL 3 min, single-flight.
- Nouvelle route publique GET /api/companies/:id/preview-shot (routes.ts, meme
  auto-heal ensureRunningApp que le proxy /preview/*). 503 si pas encore servi.
- WorkResultCard (chat.tsx) : l'iframe 340px du cas desktop est remplacee par une
  <img> largeur 100% / hauteur auto -> la carte prend la hauteur de la page. Voile
  de chargement tant que l'image n'est pas la, 8 reessais espaces de 2,5 s sur 503.
  Le cas mobile garde son iframe dans le mockup iPhone (format device voulu).
- Verifie en reel : route 200, image 1280x2865 (hero + showroom + CTA + footer,
  bandeau cookies absent), ~6 s a froid puis cache. tsc 0 erreur, build OK, health 200.

## [2026-09-13] Correction : mini-apercu = PREMIER ECRAN seul + bouton Next sans arrondi
- Demande : dans le petit rectangle, ne montrer que ce qu'on voit en arrivant sur
  le site (pas la partie a derouler) — ceci annule l'entree precedente « page
  ENTIERE ». Et remettre le bouton « Next » comme avant, sans aucun arrondi.
- preview-shot.ts : capture d'UN viewport desktop (1280x800), fullPage: false.
  Supprime : la constante MAX_SHOT_HEIGHT, la liberation des conteneurs de
  defilement interne, et le parcours de defilement qui declenchait les reveals
  (inutiles quand on ne capture que l'ecran d'accueil). Conserve : clic
  « Tout accepter » sur le bandeau cookies, animations figees, cache + single-flight.
  Ajoute : masquage des calques flottants (position fixed/sticky) dont le texte
  parle de cookies/consentement — apres l'acceptation certains sites laissent un
  toast « Vos preferences sont enregistrees… » qui polluait la vignette.
- routes.ts : commentaire de la route GET /companies/:id/preview-shot mis a jour
  (1er ecran, pas la page deroulee). Logique de route inchangee.
- chat.tsx (WorkResultCard, cas desktop) : le conteneur de l'<img> passe en
  aspectRatio 8/5 (ratio du viewport 1280x800) avec object-fit: cover et
  object-position: top center. La carte garde donc une hauteur constante et petite
  au lieu de grandir a la hauteur de la page.
- styles.css : .preview-next-btn revient au bouton plat — border-radius: 0,
  position absolute bottom/right 0, plus aucun ::before/::after. Les essais
  d'arrondis (coin unique, conges concaves, courbe en S) sont refuses : ne pas les
  reintroduire sans demande explicite.
- Verifie : route 200, image 1280x800 (hero seul, aucun bandeau ni toast cookies),
  forme du bouton controlee sur capture headless (angles droits), tsc 0 erreur,
  build OK, /api/health 200.

## [2026-09-13] Barre de prompt etroite : plus aucun bouton coupe
- Symptome : en rétrécissant la barre (aperçu ouvert / élargi), les boutons de
  droite disparaissaient. Cause : la boîte de prompt est en overflow:hidden et la
  rangée d'actions débordait — les boutons n'étaient pas cachés par une règle,
  ils étaient simplement coupés par la boîte.
- chat.tsx : largeur réelle de la boîte mesurée au ResizeObserver (promptW) —
  pas un media query, car c'est la largeur de la BARRE qui compte, l'aperçu se
  redimensionnant à la souris. `promptTight` (< 430 px) compacte la rangée :
  - rangée en flex-nowrap, tous les éléments flexShrink: 0 (plus d'ovales écrasés),
  - bouton Media en icône seule,
  - palier de modèle « Velbaz Lite » -> « Lite » (le nom de marque est redondant),
  - paddings/gaps réduits (16->10 px de marge, 8->6 px d'écart ; boutons resserrés),
  - astuce du bas raccourcie (sans « Drag & drop files ») pour rester sur une ligne.
- VoiceMic.tsx : flexShrink: 0 sur le bouton micro (il devenait un ovale).
- Corrige aussi un avertissement console : <img src=""> dans WorkResultCard quand
  la capture n'est pas encore là -> `src={shotSrc || undefined}`.
- Verifie au navigateur reel (Chrome headless, session temporaire supprimee depuis,
  chat d'AtelierNova) : barre a 469 px puis aperçu élargi à la souris -> barre à
  252 px. Aux deux largeurs : overflow de la rangée négatif, scrollWidth ==
  clientWidth (donc rien qui déborde), et sur capture les 5 contrôles (+, Media,
  Lite, Plan, micro) sont tous visibles et entiers. 0 erreur console.
- tsc 0 erreur, build OK, /api/health 200.

## [2026-09-13] Mobile : suppression du wordmark "velbaz" de la barre du haut
- `Sidebar.tsx` / `mobileTopBar` : le `<Link href="/">velbaz</Link>` et le spacer de 40px ont ete retires.
- La barre (52px, fixed, z-60) reste en place avec uniquement le bouton menu (hamburger) aligne a gauche (`justify-between` -> `items-center`), afin de garder l acces au drawer sur mobile.
- Ne pas reintroduire le logo/texte dans cette barre sans demande explicite.
- Verifie : tsc 0 erreur, bun run build OK, /api/health 200, Chrome headless 390x844 (wordmark absent, drawer s ouvre, 0 erreur console).

## [2026-09-13] Mobile : suppression complete du bandeau du haut
- `Sidebar.tsx` : `mobileTopBar` (bandeau fixe 52px plein largeur) supprime, remplace par `mobileMenuButton` : un bouton menu flottant rond de 36px (top 10 / left 10, z-60, fond translucide + blur) masque quand le drawer est ouvert.
- `app.tsx` : `topOffset` passe a 0 (plus aucun decalage vertical du contenu sur mobile).
- Le drawer reste accessible : bouton flottant partout + swipe depuis le bord gauche sur la home.
- Ne pas reintroduire de bandeau ni de wordmark en haut sur mobile sans demande explicite.
- Verifie : tsc 0 erreur, build OK, /api/health 200, Chrome headless 390x844 sur /, /chat, /company/:id, /plans -> aucun bandeau 52px, aucun "velbaz" en haut, bouton cliquable (pas recouvert), ouverture/fermeture du drawer OK, 0 erreur console (hors 401 attendus non authentifie).

## [2026-09-13] Publish : popup ancree SOUS le bouton (plus de modale centree)
- `PublishModal.tsx` : nouvelle prop optionnelle `anchorRef` (ref du bouton Publish).
  Fournie -> le panneau est `position: fixed` place a `bouton.bottom + 8px`, bord
  droit aligne sur le bouton, borne dans la fenetre (marge 8px) avec `maxHeight`
  = place dispo en dessous + scroll interne. Le voile sombre + blur est remplace
  par une couche transparente qui sert seulement a fermer au clic exterieur.
  Replacement automatique sur resize/scroll (capture) et via ResizeObserver.
- Branche sur les 3 boutons Publish : `chat.tsx` (titlebar de l apercu),
  `editor.tsx` (barre du haut), `AppBuilderTab.tsx`.
- Ne pas revenir a une popup centree au milieu de l ecran sans demande explicite.
- Verifie (Chrome headless, compte + projet de test crees puis supprimes) sur
  /company/:id/editor en 1440x900, 1440x520 et 390x844 : panneau toujours sous le
  bouton (y >= bouton.bottom), entierement dans la fenetre, "More Settings" qui
  deplie sans sortir de l ecran (scroll interne en 520px de haut), fermeture au
  clic exterieur, 0 erreur console. tsc 0 erreur, build OK, /api/health 200.
  Le bouton de la titlebar du chat n a pas pu etre teste en direct (aucun site
  construit sur le projet de test) : meme prop/branchement que les deux autres.

## [2026-09-13] Publish : panneau compact (menu deroulant, plus une grosse modale)
- `PublishModal.tsx` : largeur 460 -> 320 (`maxWidth: min(92vw, 320px)`), radius
  20 -> 12, padding 26 -> 15, ombre adoucie. Toutes les tailles internes reduites
  (~30%) : titre 21 -> 15, sous-titre 14 -> 11.5, labels 15 -> 12, champ
  sous-domaine h52 -> h36, bouton Publish h56 -> h40 / 17 -> 13.5, cartes
  Availability padding 16 -> 10, segments Visibility 15 -> 12, bloc "site publie"
  et `IconBtn` 52 -> 36. Defauts de mesure du placement : 460x420 -> 320x300.
- Correctif : la pastille "5000 credits/month" passait a la ligne dans la carte
  plus etroite -> padding/font reduits + `whiteSpace: 'nowrap'`.
- Ne pas regrossir le panneau sans demande explicite.
- Verifie (Chrome headless 1440x900, 1440x520, 390x844) : panneau 320x291 ferme,
  320x560 avec "More Settings" deplie, toujours sous le bouton et dans la
  fenetre, pastille sur une seule ligne (capture relue), 0 erreur console.
  tsc 0 erreur, build OK, /api/health 200. Donnees de test supprimees de la DB.

## [2026-09-13] Publish instantane + fond gris, et refonte de la barre du haut de l apercu
- `PublishModal.tsx` :
  - plus AUCUN ecran "Chargement..." : le formulaire complet s affiche des le
    clic, les reglages du serveur se remplissent derriere quand ils arrivent.
  - palette GRISE au lieu du quasi noir (demande : "fait que elle soit gris et
    pas noire") : carte #2c2c30, bordure #46464d, champs #3a3a40.
  - Ne pas remettre d ecran de chargement ni un fond quasi noir sans demande.
- NOUVEAU `components/PreviewTopBar.tsx` : une SEULE barre en haut du rectangle
  d apercu, calquee sur les deux captures de reference fournies :
  `<<  [Preview | Dashboard]  punaise   ( appareil | /chemin   recharger  ouvrir )
   avatars  github  Edit  Publish  X`
  - Appareil (menu Mobile / Tablet / Desktop) : le site RETRECIT a la largeur
    choisie DANS le rectangle (390 / 834 / pleine largeur), centre, transition.
  - /chemin : menu des pages quand il y en a plusieurs -> navigue dans l apercu.
  - fleche ↗ = ouvre le vrai site dans un onglet du navigateur (target=_blank).
  - punaise : epingle l apercu -> le bouton X est desactive.
  - "Edit" : present dans la maquette mais pas encore branche cote produit ->
    affiche "Bientot disponible" 1,8 s (l utilisateur a dit "edit pour l instant
    sa marche pas"). A brancher quand le mode edition visuelle existera.
  - "Publish" : pastille blanche, reste l ancre de la popup Publish (GAP 8).
- `chat.tsx` : `WebsitePreview` gagne `viewport`, `chromeless` et `onApi`
  (remonte { refresh, url, path, pages, navigate }) -> l ancienne barre d adresse
  interne est masquee, tout vit dans la barre du haut. `GithubExportButton`
  gagne `iconOnly`, `CollaboratorsButton` gagne `compact` (avatars 22px, sans
  chevauchement pour que les initiales restent lisibles).
- Ancienne `.preview-titlebar` (titre + Publish + croix) remplacee. Les boutons
  Preview/Code/Orders du panneau de droite sont conserves : ils restent le seul
  acces au mode Code.
- Verifie (Chrome headless 1600x950, projet de test avec 3 pages reelles) :
  barre presente avec les 7 controles, menu appareils (Mobile/Tablet/Desktop),
  largeur iframe 750 -> 388 (mobile) -> 748 (tablet) -> 750 (desktop), menu des
  pages (/ Home, /pricing Pricing, /about About) + navigation OK, href de la
  fleche = URL du site avec target=_blank, recharge OK, "Bientot disponible" OK,
  X desactive quand epingle et actif apres desepinglage, popup Publish sans
  "Chargement", fond rgb(44,44,48), 320x291 ancree sous le bouton, 0 erreur
  console. tsc 0 erreur, build OK. Donnees de test supprimees de la DB.

## [2026-09-13] Bouton de barre droite + exclusion animee avec le rectangle
- `chat.tsx` : le bouton flottant `PanelToggleButton` n'est plus colle au bord
  droit global du chat quand le rectangle est ouvert. Il suit maintenant le bord
  GAUCHE du rectangle via `right: calc(var(--preview-w) + 6px)` (fallback pour
  zone telephone / auto panel / aucun rectangle), avec la meme transition `right`
  deja utilisee.
- La barre droite `Context` et le rectangle de preview sont maintenant exclusifs :
  ouvrir `Context` ferme le rectangle, et refermer `Context` rouvre le rectangle
  qu'elle avait replie. Toute ouverture explicite du rectangle (`restorePanel`,
  clic fichier, checkpoint, bouton Preview) ferme aussi `Context`.
- Ajout de `previewClosing` + timer court : le rectangle joue `preview-panel-exit`
  avant d'etre demonte, pour eviter une fermeture instantanee. Pendant cette
  sortie, le `paddingRight` du conteneur attend la fin afin que le rectangle ne se
  retrecisse pas brutalement sous l'animation.
- `styles.css` : nouvelle animation `preview-exit`, symetrique de l'entree
  existante (`preview-enter`) : slide/fade vers la droite, pointer-events none.
- Verifie : `npx tsc --noEmit -p tsconfig.json` OK, `bun run build` OK. Chrome
  headless 1600x950 sur projet QA : bouton a gauche du rectangle (gap ~10px),
  clic bouton -> rectangle passe en `preview-panel-exit` puis disparait pendant
  que `Context` s'ouvre, clic suivant -> `Context` se ferme et rectangle revient,
  0 erreur console.

## [2026-09-13] Fix: le nom du site genere differait du nom du projet

Bug rapporte : l'IA fixe un nom au projet, puis le site genere porte une AUTRE
marque (sidebar « X », site « Y »). Cause : plusieurs chemins deriv(ai)ent chacun
leur propre nom depuis la meme idee, via des appels IA independants, et deux
appels sur la meme idee ne renvoient pas le meme nom. En plus,
`regenerateCompanyMeta` (tache de fond) ecrasait le nom APRES coup, une fois le
site deja genere avec l'ancien nom.

- `api/index.ts` : nouveaux helpers partages `PLACEHOLDER_PROJECT_NAMES` /
  `isPlaceholderProjectName()`, prompts `NAME_PROMPT_CONVO` / `NAME_PROMPT_SHORT`
  extraits (ils etaient dupliques), et `resolveProjectBrandName(companyId,
  fallbackName, idea)` : source UNIQUE de verite. Relit le nom frais en base, ne
  remplace JAMAIS un vrai nom, et si c'est encore un placeholder derive le nom
  MAINTENANT (extraction explicite d'abord, puis IA avec timeout 12s) et le
  PERSISTE avant toute generation.
- `api/index.ts` : `regenerateCompanyMeta` ne reecrit plus le nom si la base porte
  deja un vrai nom (`keepName`) — le PREMIER vrai nom gagne definitivement.
  Industrie / pays / langues / description continuent de se mettre a jour.
- `api/index.ts` : `runBuildWebsiteWork` et `runBuildMobileWork` verrouillent le
  nom via `resolveProjectBrandName` AVANT `generateApp` /
  `generateMultiPageWebsite` / `generateMobileApp`. Le handler `/brand-preview`
  delegue au meme helper au lieu de sa propre derivation inline (le pop-up de
  marque et le build ne peuvent plus diverger).
- `agents/website.ts` : nouveau `isPlaceholderBrandName()` exporte. Le nom du
  projet est IMPOSE dans le prompt du design system ET dans le prompt de chaque
  page (regle absolue : titre, wordmark, footer, copyright), et apres parsing du
  JSON `designSystem.companyName` est ECRASE par le nom du projet (log
  `[website] brand name forced`). C'est ce chemin (site multi-pages statique) qui
  laissait l'IA inventer sa propre marque.
- `agents/orchestrator.ts` : le branding ne peut plus ecraser un vrai
  `enrichedCtx.name` (avant : `!enrichedCtx.name`, donc un placeholder passait).
- `builder/engine.ts` + `builder/engine-mobile.ts` : leurs tests placeholder
  locaux (`/^nouveau projet$/`, `/^(mon app|nouveau projet)$/`) utilisent
  maintenant le helper partage, donc la meme liste de placeholders partout.

Verifie : `npx tsc --noEmit -p tsconfig.json` OK (exit 0). Test de course sur
projet QA : `refresh-meta` lance, nom verrouille a « Torrelyon » pendant que la
tache de fond tourne -> nom inchange sur 42s, log `[meta] Name kept ... (generated
"..." ignored — already named)`. Build reel depuis « Nouveau projet » :
log `[name] brand locked ... "Nouveau projet" -> LyonGrains`, puis nom identique
partout (projet = LyonGrains, `<title>LyonGrains`, `package.json` name
"lyongrains", `BRAND_NAME`, pages, docs legaux — 49 occurrences, aucune autre
marque). `isPlaceholderBrandName` : 14/14 cas OK. Donnees de test supprimees.

## [2026-09-13] Basculement rectangle preview <-> barre « Context » INSTANTANE

Demande : « enleve l'animation de changement entre le rectangle preview et la
barre a gauche ». La mutuelle exclusion reste (ouvrir l'un ferme l'autre), mais
l'echange ne doit plus etre anime du tout.

`web/pages/chat.tsx` :
- `previewClosing` + `previewCloseTimer` + `PREVIEW_EXIT_MS` (340 ms) supprimes.
  `closePreviewAnimated()` -> `closePreviewInstant()` : `setPanelCollapsed(true)`
  synchrone, plus d'unmount differe.
- nouveau `previewAnim` (defaut true) : la classe `preview-panel-enter` n'est
  posee que quand il vaut true. Le retour du rectangle apres fermeture de la
  barre passe `previewAnim=false` -> aucune animation d'entree.
- transitions supprimees : `padding-right` du conteneur, `right` du bouton
  flottant (`transform/box-shadow/background` seulement), `transform` de la
  barre « Context » (elle claque en place).
- nouveau `layoutAnim` + `freezeLayoutAnim()` : la colonne de chat et le
  rectangle gardent leur `transition: width 0.4s` (drag / mode large), mais elle
  est coupee le temps du basculement puis retablie apres deux frames — sinon la
  mise en page continuait de glisser 400 ms apres la disparition du rectangle.

`web/styles.css` : `@keyframes preview-exit` et `.preview-panel-exit` supprimes.
`.preview-panel-enter` conserve (premiere ouverture reelle de la preview).

Verifie : `npx tsc --noEmit` OK (exit 0). Playwright sur projet QA, 1600x950 :
a +20 ms du clic le rectangle est deja demonte, la colonne de chat passe de 559
a 1060 px, la barre est a `matrix(1,0,0,1,0,0)` (`transition: all 0s`) et le
bouton de 783 px a 292 px — aucune valeur ne bouge plus a +60/+150/+420 ms. Au
retour : iframe a 750 px des +16 ms, zero noeud `.preview-panel-enter`. La
transition `width 0.4s` de la colonne est bien restauree apres le basculement.
Aucune erreur console. Donnees de test supprimees.

## [2026-09-13] Verite du contenu — interdiction d'inventer (enjeu JURIDIQUE)

Demande : « l ai a pas le droie de faire de faux chose (faux commentaire, faux
endroit, faux tout) parce que apres avoir tout connecter ca va faire de vrai
marque a vendre et il y aura de vrais produits ». Les sites/apps generes ne sont
pas des maquettes : des que paiements + domaine + reseaux sont branches, c'est
une vraie marque qui vend a de vrais clients. Un faux avis / faux label / fausse
adresse / faux prix = publicite mensongere opposable au proprietaire.

Reperes legaux cites aux modeles (verifies) :
- UE : directive 2005/29/CE (pratiques commerciales deloyales), modifiee par la
  directive « Omnibus » (UE) 2019/2161 — faux avis explicitement interdits.
- US : regle FTC « Use of Consumer Reviews and Testimonials », 16 CFR Part 465,
  en vigueur depuis le 21 octobre 2024 — amendes civiles par infraction, couvre
  explicitement les avis generes par IA.

Nouveau module unique `api/builder/content-truth.ts` (source unique, ne pas
dupliquer le texte ailleurs) :
- `CONTENT_TRUTH` (bloc complet) : liste exhaustive de ce qu'il est INTERDIT
  d'inventer (avis/temoignages/notes/etoiles, preuve sociale chiffree, logos
  clients/presse, prix et recompenses, labels et certifications, adresse /
  telephone / horaires / SIRET, equipe, prix / promos / stocks / delais /
  garanties, specs et composition produit, allegations sante/ecologie/finance,
  comparatif concurrent nomme, textes legaux) + les 3 issues autorisees, dans
  l'ordre : (1) supprimer la section, (2) la brancher sur de vraies donnees
  persistees avec etat vide honnete, (3) marqueur visible « [A completer : x] »
  — jamais une valeur plausible. Clot sur « DOUTE = ABSTENTION ».
- `CONTENT_TRUTH_SHORT` : meme regle condensee pour les prompts de plan.

Cable dans tous les chemins de generation (les blocs EXACTITUDE RELIGIEUSE
existants sont conserves intacts, la nouvelle regle est additive) :
- `builder/prompts.ts` : `CONTENT_TRUTH` dans `CODE_SYSTEM` (donc aussi
  `EDIT_FILE_SYSTEM` qui l'aliase), `CONTENT_TRUTH_SHORT` dans `PLAN_PROMPT` et
  `PLAN_PROMPT_LIGHT`. `PAGE_PROMPT` : exemple de liste `.map()` « temoignages »
  -> « etapes ».
- `builder/engine-mobile.ts` : `CONTENT_TRUTH` dans `MOBILE_CODE_SYSTEM`,
  `CONTENT_TRUTH_SHORT` dans le prompt de plan d'ecrans.
- `agents/website.ts` : `CONTENT_TRUTH` dans `buildPagePrompt` (regle 7 « contenu
  REALISTE » -> « VERIDIQUE »), `CONTENT_TRUTH_SHORT` dans le prompt d'index. Et
  surtout la table `SITE_PAGES` elle-meme : « Temoignages (3 cards) », « Avis
  clients », « Logo bar (social proof) » et « Comparaison avec concurrents »
  remplaces par FAQ / bandeau de benefices / horaires-adresse « [A completer] »
  — le plan ne commande plus une section qu'on ne peut remplir qu'en inventant.
- `agents/industry-playbooks.ts` : garde-fou ajoute dans
  `formatIndustryPlaybook()` (le playbook decrit des STRUCTURES, pas une
  autorisation d'inventer) + patterns SaaS « bandeau de logos clients » et
  « temoignages avec photo+nom+poste » conditionnes a du reel fourni.
- `builder/world-class-craft.ts` : structure SaaS B2B — logos clients et
  preuve sociale/stats seulement si reels, sinon FAQ/demonstration a la place.
- `agents/content.ts` (redacteur du copy du site) : `CONTENT_TRUTH` + rappel
  applique a son JSON de sortie (aboutPage sans date de creation/fondateur/
  effectif inventes, productDescriptions sans specs/matiere/origine/prix non
  fournis, FAQ qui n'affirme aucune garantie/delai/certification hors brief).
- `templates-seed.ts` : descriptions de pages des templates du marketplace
  nettoyees (Testimonials / Social proof (logos) / Market stats / Aggregate
  rating supprimes ; la page Reviews du template local-business est desormais
  decrite comme branchee sur de vrais avis persistes avec etat vide honnete).
- `api/index.ts` : bloc de chat `[REVIEW_VIEW]` — interdiction explicite
  d'inventer avis/auteur/note/nombre d'avis (afficher seulement de vraies
  donnees, sinon ne pas afficher le bloc).
- `builder/marketing-strategy.ts` : les « 1 temoignage » / « 1 case study » /
  « 1 chiffre » des plans marketing sont precises comme reels et a recueillir.

Verifie : `npx tsc -p packages/web/tsconfig.api.json --noEmit` — les erreurs de
syntaxe introduites (apostrophe dans une chaine simple de `SITE_PAGES`) sont
corrigees ; 117 erreurs restantes, identiques avant/apres (pre-existantes, dans
des fichiers non touches). Rendu des prompts controle a l'execution (bun) :
`CODE_SYSTEM`, `PLAN_PROMPT`, `PLAN_PROMPT_LIGHT` et le playbook contiennent
bien le bloc « VERITE DU CONTENU » + la citation 16 CFR Part 465, sans `${`
casse ni `undefined` d'interpolation, et les blocs EXACTITUDE RELIGIEUSE sont
toujours presents. Serveur : hot-reload OK, `/api/health` 200.
NB : c'est un changement de prompt (il contraint la sortie du LLM) — non
verifie par une generation de site reelle de bout en bout.

## [2026-09-13] Mode « Edit » visuel de l'apercu (picker d'element + bulle de prompt)

Demande : « quand j'active Edit le bouton devient "Exit edit" ; quand je passe
la souris sur un objet du site son contour devient bleu ; quand je clique, un
rectangle s'ouvre ou j'ecris ma modification ; a l'envoi l'IA sait PRECISEMENT
quoi changer, donc c'est beaucoup plus rapide. »

Fait — 100 % dans le panneau d'apercu existant (`WebsitePreview`), pas dans
l'editeur autonome `editor.tsx` :
- `web/lib/edit-picker.ts` (nouveau) : script injecte DANS l'iframe (meme
  origine). Curseur crosshair, overlay bleu au survol (pointille) + a la
  selection (plein) + etiquette du selecteur, tous les clics du site avales
  pendant le mode, `postMessage` vers le parent (`velbaz-edit-pick` /
  `-rect` / `-cancel`), messages recus (`-clear` / `-parent` / `-stop`).
  `stop()` demonte tout : zero trace. Contient aussi `buildEditInstruction()`
  (page + selecteur DOM + balise + id/class + texte + attributs + la demande).
- `web/pages/chat.tsx` : etat du mode Edit, injection/reinjection du picker
  (retries 0/300/900/2000 ms + a chaque `load` de l'iframe), bandeau d'aide,
  bulle `.preview-edit-pop` ancree sur l'element (bascule au-dessus/en dessous
  selon la place), bouton « selectionner le parent », etat occupe avec la
  progression SSE, rechargement de l'iframe apres succes.
- `components/PreviewTopBar.tsx` : le bouton Edit est branche (label
  Edit ⇄ Exit edit, icone crayon ⇄ croix, `data-on`). L'infobulle
  « Bientot disponible » (`.preview-tb-soon`) est supprimee.
- `web/styles.css` : styles du bouton actif, du bandeau et de la bulle.

Ciblage precis (le point qui rend l'edition rapide ET juste) :
- `POST /companies/:id/project-edit` accepte un champ OPTIONNEL `element`
  (`{ path, text, tagName }`). Purement additif : sans lui (ancien
  `editor.tsx`), le comportement ne change pas d'un poil.
- La resolution ne mappait que PAGE → fichier. Bug constate en vrai : clic sur
  le logo du header (page « / » → `src/pages/Showroom.tsx`) ⇒ on ordonnait a
  l'IA de modifier Showroom.tsx alors que l'element est rendu par
  `src/components/Header.tsx` ⇒ elle n'y arrivait pas et ecrivait son
  raisonnement (« le selecteur pointe vers le Header, pas vers Showroom.tsx »)
  dans le fichier. Ajout d'un affinage element-aware : repere structurel du
  chemin DOM (`header`/`footer`/`nav`/`aside` → le fichier source unique qui
  rend cette balise, departage par le texte visible puis en preferant un
  composant a une page), sinon fichier source unique contenant litteralement le
  texte visible. Sinon on garde la resolution par page.

Verifie pour de vrai (projet reel « CoutureNova », 63 fichiers) :
- Playwright/Chrome sur l'apercu (`scripts/verify_edit_picker.py`) : overlay
  `rgb(47,125,255)` aligne sur le `getBoundingClientRect()` de la cible,
  `tagPath` renvoye resolvable par `querySelector`, maj du rect au scroll
  (dedupliquee), Echap annule, « parent » elargit `<span>` → `<a>`, et apres
  `stop()` : plus de marqueur global, zero overlay, curseur `auto`, clics du
  site a nouveau fonctionnels.
- Aller-retour serveur (`scripts/verify_visual_edit_roundtrip.ts`) : avant le
  correctif, 103 s et fichier ERRONE (Showroom.tsx, contenu pollue par le
  raisonnement du modele) ; apres, `🎯 Element localise dans
  src/components/Header.tsx`, **48,6 s**, 1 seul fichier change et diff
  minimal et correct (`aria-label`, `alt`, `{BRAND_NAME}` → « AtelierVogue
  Paris »). Etat d'origine RESTAURE dans les deux cas (projet d'un vrai
  utilisateur : aucune trace laissee).
- UI reelle dans `/chat/:id` (`scripts/verify_edit_ui.py`) : « Edit » →
  « Exit edit » + `data-on=true`, bandeau affiche, picker monte dans l'iframe,
  survol bleu + curseur crosshair, clic → bulle ancree dans l'apercu avec
  l'etiquette `<span> .text-[#1C1410].dark:text-white — AtelierVogue`, focus
  automatique dans le champ, bouton « Modifier » actif ; sortie du mode → plus
  de bulle, plus de bandeau, plus de picker, plus d'overlay, curseur `auto`,
  0 erreur console.
- Types : `tsconfig.api.json` 117 erreurs (identique a la baseline),
  `tsconfig.app.json` 334 erreurs (identique avant/apres) — aucune nouvelle
  erreur imputable a ce travail.
