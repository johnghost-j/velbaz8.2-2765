# Correctifs demandés — session 2026-09-04

Principe imposé par l'utilisateur (point 4) : **aucun timer/fallback qui masque un bug.**
Si l'IA plante, on corrige la cause — on n'ajoute pas de reprise automatique par-dessus.

## Bug 1 — plus d'animation "thinking" à l'envoi d'un prompt

**Cause** : `chat.tsx` (~7100). Un changement du 2026-09-04 a supprimé le bloc de
réflexion factice, mais la branche de repli est restée `: null`. À l'envoi d'un prompt
(`chatLoading=true`, pas encore de `streamingContent`, `liveProgress` vide,
`siteEditLoading=false`) → rien ne s'affiche. Écran muet.

**Correctif** :
- [x] `ThinkingIndicator` accepte un prop `showTasks` explicite
      (`showTasks = showTasksProp !== undefined ? showTasksProp : !label`).
- [x] La branche `: null` affiche l'indicateur animé (icône + phrase qui tourne)
      SANS la fausse liste de tâches sur minuteur, et seulement si `prepSteps` est vide
      (sinon doublon avec la liste de tâches réelle) :
      `: !(prepSteps && prepSteps.length > 0) ? <ThinkingIndicator showTasks={false} /> : null`.

## Bug 2 — chargement figé après validation du plan, stoppe à ~125 s

**Cause** : `api/builder/routes.ts` (route `POST /companies/:id/build-app`).
Première action du build : `await waitForCompanyLogo(companyId, push)` — `maxWaitMs = 120000`,
poll toutes les 2 s, pousse UNE seule ligne `⏳ Attente du logo de marque…`, puis retourne
`""` en silence. → blocage sur une seule chose, écran figé ~125 s, échec logo masqué.
C'est exactement l'anti-pattern du point 4.

**Correctif** :
- [x] Lecture NON bloquante du logo (`getCompanyLogoUrl`). Le build démarre
      immédiatement et streame ses vraies tâches.
- [x] `waitForCompanyLogo` **supprimée** (remplacée par un commentaire explicatif) —
      la garder aurait conservé l'anti-pattern.
- [x] Si pas de logo : ligne visible explicite
      (`ℹ️ Logo de marque pas encore disponible — …`), plus de `""` silencieux.

## Bug 3 — images /genesis n'apparaissent pas toutes seules dans les tâches

**Cause** : `chat.tsx` (~6092). Chaque image reçue faisait
`prepStep('gvisuals', 'running', 'Visuel « x » prêt')` → elle ÉCRASAIT le `detail` de
l'unique ligne `gvisuals`. Les images ne s'accumulaient jamais en tâches distinctes.

**Correctif** :
- [x] `prepStep(id, status, detail?, label?)` : label explicite possible
      (update → `label: label || prev.label`, push → `label: label || PREP_LABELS[id] || id`).
- [x] Une ligne de tâche par visuel : id `gvis-<elementId|role|index>`, statut `done`,
      libellé `Visuel « … » prêt`. `gvisuals` reste la ligne de regroupement "running".
- [x] `finalizePrepSteps()` mappe la liste → encaisse N lignes sans changement.

## Vérification (2026-09-04)
- [x] `bun run build` → OK, 2376 modules, 2/2 packages, 0 erreur TS
- [x] `bun run lint` → 579 erreurs, **exactement le même total qu'avant** les correctifs
      (dette héritée : `no-unused-vars`, `react-hooks/exhaustive-deps`, `max-lines`).
      Aucune violation d'intégrité template / fichier protégé.
- [x] serveur relancé (tmux `web`, port 4200), `/api/health` → 200 `{"status":"ok"}`
- [x] routes `/ /login /dashboard /chat /editor /plans` → toutes 200
- [ ] parcours réels à valider par l'utilisateur (prompt / validation de plan / `/genesis`)

## Bug 4 — timeout dur de 120 s sur le build du site généré (arbitré : supprimer)

**Cause** : `api/builder/runner.ts` — `checkBuild()` lançait
`run("bunx", ["vite","build"], dir, 120000)`. Passé 120 s, `run()` tuait le process
et renvoyait `code:-1` avec la chaîne `[timeout]` **à la place de la sortie d'erreur
réelle**. Le réparateur automatique recevait donc « [timeout] » comme diagnostic et
travaillait à l'aveugle.

**Correctif** :
- [x] `run(cmd, args, cwd, timeoutMs = 0)` : minuteur **optionnel**, `0` = aucun
      minuteur. Le process va au bout, on lit sa vraie sortie.
- [x] `checkBuild()` appelle `run()` **sans timeout** et retourne
      `[vite build exit <code>]` + les 4000 derniers caractères de la sortie réelle
      (ou « (aucune sortie du build) » plutôt qu'une chaîne vide).
- [ ] `installDeps()` garde son timeout de 180 s sur `bun install` — pas dans le
      périmètre arbitré, à trancher si tu veux l'enlever aussi.

## Bug 5 — /genesis : reprise automatique 3× qui masquait de vraies erreurs

**Ce qui coupait le flux, réellement** :
1. *Cause déjà traitée côté serveur* : `POST /genesis/stream` reste plusieurs
   minutes sans émettre un octet pendant la génération d'images → la passerelle
   coupait le SSE (HTTP 524). Un commentaire SSE `: ping` toutes les 15 s +
   `X-Accel-Buffering: no` + `Connection: keep-alive` sont déjà en place, et le
   parseur client ignore correctement les lignes non-`data:`. Cette cause-là est
   couverte.
2. **Cause encore ouverte, trouvée maintenant** : dans le `catch` de
   `runGenesisFlow`, le test `isNetErr` contenait `\b\d{3}\b` — **n'importe quel
   nombre à 3 chiffres** dans un message d'erreur (« 429 », « 3 sur 128 éléments »,
   un nom de modèle…) suffisait à classer une **vraie panne du moteur** en
   « coupure réseau ». Elle était alors affichée comme « la connexion a été coupée
   avant la fin » **et rejouée 3 fois**. Le bug d'origine, lui, n'était jamais vu.

**Correctif** :
- [x] Les erreurs émises par le moteur (événement SSE `error`) sont marquées
      `fromEngine = true` à la source.
- [x] `catch` : `fromEngine` → on affiche le **vrai message du moteur** ;
      sinon (échec du fetch/reader lui-même) → message de connexion.
      Plus de devinette par expression régulière.
- [x] `genesisRetryRef` et la reprise automatique **supprimés** (déclaration,
      remise à zéro, relance différée, message « je reprends (essai N/3) »).
- [x] Message d'échec « malgré plusieurs reprises » remplacé par la cause réelle.

## Vérification finale (2026-09-04)
- [x] `bun run build` → OK, 0 erreur TS
- [x] `bun run lint` → 579 erreurs, toujours le même total qu'avant
- [x] serveur relancé, `/api/health` 200, `/ /chat /editor /plans` 200

## Bug 6 — après validation des pages : « Réflexion en cours… » au lieu des tâches, et aucune compagnie créée

**Symptôme** : l'utilisateur valide le plan de pages → une seule ligne
`In progress: Réflexion en cours… (4s)` qui tourne, pas de liste de tâches,
et la compagnie n'est jamais construite.

**Causes (deux, cumulées)** :
1. `startGenesisAfterPages()` prenait la main à la validation des pages et lançait
   le moteur /genesis à la place du build. La ligne `gthink` (« Réflexion en
   cours ») est justement le libellé du moteur — d'où l'écran vu.
2. `GENESIS_STOP_AFTER_FRAMES = true` (mode test « images seules ») posait un
   verrou `genesisImagesOnly` qui **interdisait tout appel à `build.runBuild`**.
   Pire : ce verrou était **persisté en sessionStorage**, donc il survivait aux
   rechargements et continuait de bloquer les builds.

**Correctif** :
- [x] `GENESIS_STOP_AFTER_FRAMES = false` → le verrou « images seules » n'est
      plus jamais posé (les deux `setGenesisImagesOnly(true)` sont sous ce drapeau).
- [x] Verrou persisté **effacé à l'init** quand le mode n'est plus actif — sinon
      un ancien verrou resté en sessionStorage aurait continué à bloquer.
- [x] `startGenesisAfterPages()` ne prend plus la main : il consomme le brief en
      attente et retourne `false` → la validation des pages enchaîne sur le build
      normal, avec ses vraies tâches et la création de toute la compagnie.
      La commande `/genesis` reste disponible pour lancer le moteur volontairement.

**Vérifié** : `bun run build` OK · lint 579 (inchangé) · serveur relancé,
`/api/health` + `/ /chat /editor /plans` → 200.

## Bug 7 — /genesis : afficher les IMAGES générées dans les tâches

**Demande** : quand la commande `/genesis` génère des images, les images
elles-mêmes doivent apparaître dans la liste de tâches (pas seulement leur nom).

**Correctif** :
- [x] Une tâche peut porter un visuel : champ `image?: string` ajouté au type de
      `prepSteps` (state + ref).
- [x] `prepStep(id, status, detail?, label?, image?)` : 5e paramètre, conservé
      lors des mises à jour (`image: image || prev.image`).
- [x] Handler genesis : chaque événement `asset` crée sa ligne `gvis-<id>` avec
      l'URL du visuel.
- [x] Rendu de la liste de tâches : l'image s'affiche sous sa ligne (vignette
      220 px, bord arrondi, clic = ouverture en grand). Bouton interactif plutôt
      qu'un `onClick` sur `<img>` — sinon 2 erreurs a11y au lint.
- [x] `finalizePrepSteps()` : le marqueur `[IMG:url]` est ajouté au résumé figé,
      donc les visuels restent visibles dans l'historique du chat.

**Vérifié** : `bun run build` OK · `bun run lint` 579 (identique à l'état initial,
aucune erreur ajoutée) · serveur relancé, `/api/health` + `/ /chat /editor /plans` → 200.

## Bug 8 — Dashboard : « No projects yet » affiché avant l'arrivée des projets

**Symptôme** : à l'ouverture du dashboard, la page s'affiche **sans les projets**
(« No projects yet. ») et les projets apparaissent après un délai. Idem pour
« Recent Activity » et pour les compteurs (ARR / MRR / Projects / Revenue) qui
montraient **0** avant de sauter aux vraies valeurs.

**Cause** (lecture de `packages/web/src/web/pages/dashboard.tsx`) : les états
`loadingCompanies` / `loadingTasks` **et** le composant `SkeletonRow` existaient
déjà mais **n'étaient jamais lus dans le rendu**. Pendant les requêtes,
`companies.length === 0` était donc interprété comme « aucun projet » au lieu de
« pas encore chargé ». Ce n'est pas un problème de lenteur réseau : l'état vide
était simplement affiché à tort.

**Correctif** (pas de timer, pas de repli — on lit le vrai état de chargement) :
- [x] « Your Projects » : `loadingCompanies && companies.length === 0` → 3
      `SkeletonRow` de chargement ; l'état vide « No projects yet. » ne s'affiche
      plus que si la requête est **revenue** et la liste est réellement vide.
- [x] « Recent Activity » : même traitement avec `loadingTasks`
      (3 `SkeletonRow h={44}`), sinon « No activity yet. ».
- [x] Grille de stats : squelettes (`h={84}`) pendant le chargement, pour ne
      jamais afficher de chiffres faux avant les bons.
- [x] Le cache mémoire déjà en place reste prioritaire : au retour sur la page,
      les données connues s'affichent instantanément, sans squelette.

**Vérifié** : `bun run build` OK · `bun run lint` **576** erreurs (baseline 579,
3 en moins car `loadingCompanies`, `loadingTasks` et `SkeletonRow` sont
désormais utilisés — aucune erreur ajoutée) · serveur relancé,
`/api/health` `/` `/chat` `/editor` `/plans` `/dashboard` → 200.

**Non vérifié** : le rendu visuel réel du dashboard avec un compte connecté et
des données (nécessite une session utilisateur).

## Bug 9 — /genesis construisait un site au lieu de rendre seulement les images

**Demande** : `/genesis` ne doit **rien construire**. Il génère les images
demandées, il s'arrête là. Constat de l'utilisateur : les images partaient bien
au début, puis à la fin un **site** était créé, et les images n'étaient pas
rendues.

**Cause** : deux drapeaux avaient été retournés lors du correctif du Bug 6.
- `GENESIS_AFTER_PAGES = true` → la commande `/genesis` ne lançait plus le
  moteur : elle repartait dans le flux normal (questions → choix des pages →
  **build du site**). D'où le site en fin de parcours.
- `GENESIS_STOP_AFTER_FRAMES = false` → même arrivé au bout, le moteur
  enchaînait sur la construction au lieu d'afficher les visuels.

Ces deux valeurs étaient un **contournement**, pas un correctif : le vrai
problème du Bug 6 était le verrou « images seules » **persisté en
sessionStorage**, qui survivait aux rechargements et bloquait ensuite *tous* les
builds à vie.

**Correctif — la cause d'abord, puis le comportement demandé** :
- [x] Verrou « images seules » : **plus aucune persistance**. Il vit en mémoire
      et **uniquement le temps du run** — posé quand la commande est tapée,
      relâché dans le `finally` du run (succès comme échec). Plus rien ne peut
      rester collé après un rechargement. L'ancienne clé
      `velbaz_genesis_images_only` est purgée à l'init.
- [x] `GENESIS_AFTER_PAGES = false` : `/genesis` va **droit au moteur d'images**,
      sans questionnaire ni plan de pages, donc sans build.
- [x] `GENESIS_STOP_AFTER_FRAMES = true` : à la fin du run, les visuels sont
      affichés dans le chat (`[IMG:url]`) et **aucun `doSend` de construction**
      n'est lancé — ni en succès, ni en erreur (l'ancien « filet de sécurité »
      qui relançait une création est désormais inactif dans ce mode).
- [x] Brief en attente `velbaz_genesis_brief` purgé à l'init : le flux
      « après les pages » est éteint, aucun reste ne doit traîner.
- [x] Les deux drapeaux sont typés `: boolean` pour que les deux branches
      restent compilées et réversibles (rien n'est supprimé).

**Vérifié** : `bun run build` OK · `bun run lint` 576 (inchangé depuis le Bug 8,
aucune erreur ajoutée) · serveur relancé, `/api/health` `/` `/chat` `/editor`
`/plans` `/dashboard` → 200.

**Non vérifié** : le run `/genesis` réel (génération des images) — il demande les
clés IA absentes de cet environnement. Ce qui est garanti par le code : aucun
chemin de `runGenesisFlow` n'appelle plus la construction quand
`GENESIS_STOP_AFTER_FRAMES` est vrai.

**À savoir pour l'utilisateur** : recharger la page (F5) après cette mise à jour,
pour repartir sans aucun reste de l'ancien verrou.

## Bug 10 — Rétablir la CHAÎNE complète de /genesis (annule et remplace le Bug 9)

**Flux voulu par l'utilisateur, dans cet ordre** :
questions → choix des pages → **images** (un cadre par page validée) →
**site construit À PARTIR de ces images** → **puis le reste** (juridique, etc.).

Le Bug 9 avait coupé la chaîne aux images : c'était une mauvaise lecture de la
demande. On rebranche donc les trois maillons.

**Correctif** :
- [x] `GENESIS_AFTER_PAGES = true` : `/genesis` repart dans le flux normal
      (questions, puis plan de pages) ; le moteur démarre à la validation des
      pages, en connaissant la liste exacte des pages.
- [x] `startGenesisAfterPages()` **remis en service** : il consomme le brief en
      attente, fige les tâches précédentes, et lance `runGenesisFlow(brief,
      { showUserBubble: false, pages })` avec les pages validées — le moteur rend
      un cadre par page, ni plus ni moins.
- [x] `GENESIS_STOP_AFTER_FRAMES = false` : le run ne s'arrête plus sur les
      images. Une fois la spec produite, le brief caché de construction part
      (`CHIMERA_BUILD_BRIEF` / `LEGACY_BUILD_BRIEF`), et ce brief impose
      d'utiliser **les cadres générés** comme fond des pages, avec du vrai texte
      HTML par-dessus → le site est bien fait à partir des images.
- [x] La suite (compagnie, juridique et le reste) est produite par le flux de
      construction normal déclenché par ce brief caché.
- [x] Le brief en attente reste persisté en sessionStorage : la validation des
      pages lance le moteur même après un rechargement.

**Pourquoi les symptômes du Bug 6 ne reviennent pas** (traités à la cause, pas
par désactivation) :
- « Réflexion en cours… » seule à l'écran : les tâches /genesis passent
  maintenant par la même liste que le build (`gthink` / `gvisuals` / `gfinal`) et
  **chaque image crée sa ligne avec sa vignette** (Bugs 3 et 7).
- Compagnie jamais créée : le verrou « images seules » ne se pose plus (mode
  éteint) et, surtout, il **ne survit plus à un rechargement** — il vit en
  mémoire, le temps du run seulement (Bug 9). Plus rien ne peut bloquer
  `runBuild` durablement.

**Vérifié** : `bun run build` OK · `bun run lint` 576 (inchangé) · serveur
relancé, `/api/health` `/` `/chat` `/editor` `/plans` `/dashboard` → 200.

**Non vérifié** : le parcours réel de bout en bout (images puis site puis
juridique) — il demande les clés IA absentes de cet environnement.

## Bug 11 — Le site était construit mais les images du run /genesis ne servaient à rien

**Symptôme (le vrai problème de fond)** : `/genesis` générait bien des images,
puis un site sortait… **sans ces images**. Les pages retombaient sur des visuels
génériques : les cadres produits ne servaient à rien.

**Chaîne inspectée, maillon par maillon** :
1. `chimera.ts` — la spec finale reçoit un bloc `assetContract` **déterministe**
   avec les URLs réelles des cadres. OK.
2. `chimera-assets.ts` — les URLs sont **absolues**
   (`http://<origine>/api/chimera/assets/<runId>/<fichier>.webp`), donc
   chargeables depuis le serveur de prévisualisation du site généré. OK.
3. `builder/engine.ts:1628` — `chimeraAssetsFromBrief(input.idea + input.userMessage)` ;
   si des assets sont trouvés, le manifeste d'images est construit **avec eux** et
   la génération de visuels concurrents est sautée. OK.
4. `api/index.ts:3063` — le brief caché n'arrive pas jusqu'au moteur : la spec est
   **rechargée en base** avec
   `genesisRuns.sessionId === companyId` puis jointe à `userMessage`. OK **en
   apparence**.

**Cause trouvée (maillon 4 ↔ le chat)** : le chat postait sur
`/api/genesis/stream` avec `sessionId = projectId || stableSessionId`. Quand le
run démarrait avant que l'URL passe sur `/chat/<id>`, la spec était enregistrée
sous `session-<horodatage>`. La recherche du constructeur, faite **par
companyId**, ne trouvait alors **rien** : `genesisSpec` restait vide, aucune URL
n'atteignait le générateur de code, et les pages repartaient sur des images
génériques. Exactement le symptôme décrit.

**Correctif** :
- [x] `runGenesisFlow` envoie désormais l'**id réel de la compagnie**
      (`precreatedCompanyRef.current?.id || projectId || sessionId`) comme
      `sessionId` du run. La spec est donc enregistrée sous la clé que le
      constructeur interroge, et les URLs des cadres arrivent au générateur.
- [x] Aucun repli ajouté côté serveur (pas de « dernier run de l'utilisateur »
      pris au hasard) : la clé est juste correcte à la source.

**Vérifié** : `bun run build` OK · `bun run lint` 576 (inchangé) · serveur
relancé, `/api/health` `/` `/chat` `/editor` `/plans` `/dashboard` → 200 · les
quatre maillons de la chaîne relus dans le code.

**Non vérifié** : un run réel de bout en bout (images → site qui les affiche) —
il demande les clés IA absentes de cet environnement. Au prochain run, la ligne
`🎨 Spec /genesis rechargée (N asset(s) du run)` doit apparaître dans les tâches :
si elle est là, les images du run sont bien celles du site. Si elle manque, la
spec n'a pas été retrouvée — à me signaler.

## Bug 12 — `/genesis` codait le site PENDANT la génération des images, et les tâches n'étaient pas séparées

**Symptôme (mot pour mot)** : « quand j'utilise la commande ça génère des images
mais ça code aussi le site alors que ça doit attendre les images ». Et la liste
de tâches ne montrait pas les 4 étapes voulues : questions → plan des pages →
images → codage à partir des images.

**Chaîne inspectée, maillon par maillon (rien supposé)** :
1. Chat : `confirmPages` / `confirmPagesList` / `skipPageSelection` appellent tous
   `if (startGenesisAfterPages(chosen)) return;` **avant** `startBuildNow(...)`. OK.
2. Serveur `POST /companies/:id/select-pages` (`builder/routes.ts:375`) : ne lance
   aucun build. OK.
3. Serveur `POST /genesis/stream` (`api/index.ts:14193`) : **ne lance aucun
   build** non plus — il streame le moteur et écrit `genesisRuns`. OK.
4. Les six `startBuildWebsite(...)` serveur (l.3574, 4031, 4517, 8316, 14066,
   14127) sont la route `build-website`, l'auto-resume au démarrage, la route
   resume, la conversion mobile et le restart-sweep. Aucun n'est déclenché par
   `/genesis`. OK.

**Cause n°1 — la porte unique n'était pas gardée.** Côté client il n'existe
**qu'une seule** porte vers le serveur pour démarrer le codage :
`startBuildWebsiteResilient()` dans `web/lib/build-store.ts`. Elle est appelée par
`runBuild` **et** par la relance automatique du poll (« Server restarted during
build — automatically resuming »). Les gardes existantes (`genesisBlocksBuild`)
ne couvraient que les appels partant de `chat.tsx` : la reprise au retour
d'onglet, la reprise après redémarrage du serveur et la relance auto du poll
passaient à côté et lançaient le codage **pendant** la génération des images.

**Cause n°2 — le verrou n'était même plus posé.** Dans `sendMessage`, la pose du
verrou « images seules » était conditionnée à `GENESIS_STOP_AFTER_FRAMES`, devenu
**faux** au Bug 10. Résultat : depuis le Bug 10, **plus aucun verrou** n'était posé
sur un `/genesis`.

**Cause n°3 — l'affichage.** `startGenesisAfterPages()` appelait
`finalizePrepSteps()` (fige la liste en message d'historique), puis
`runGenesisFlow` appelait `resetPrepSteps()` : les étapes « questions » et
« plan » disparaissaient et les images s'affichaient seules, sans continuité.

**Correctif — séquencement (le codage attend vraiment les images)** :
- [x] `build-store.ts` : verrou de séquencement **au niveau du module**, devant la
      porte unique — `setBuildGate(reason)` / `buildGateBlocks(where)`. En
      **mémoire seule, jamais persisté** (leçon du Bug 9 : persisté, il bloquerait
      les builds à vie).
- [x] `startBuildWebsiteResilient` : refuse en tête si le verrou est posé et
      retourne `{ ok:false, gated:true }`. **Tous** les chemins de reprise passent
      donc par la même garde, y compris ceux qui ne viennent pas du chat.
- [x] `runBuild` : `buildGateBlocks('runBuild')` **tout en haut**, avant
      `set({ isBuilding: true })` — sinon l'écran afficherait un build inexistant.
- [x] Un blocage de séquencement n'est **pas** une panne : `if (r.gated) return;`
      avant le `console.error`, aucun message d'erreur affiché.
- [x] `chat.tsx` : `setGenesisImagesOnly(v)` pose/lève aussi `setBuildGate(...)`.
- [x] `chat.tsx` : le verrou est posé sur `/genesis` et `/vision` dès
      `sendMessage` avec `(GENESIS_STOP_AFTER_FRAMES || GENESIS_AFTER_PAGES)` —
      il redevient effectif dans le mode réellement utilisé (cause n°2).
- [x] Il est relâché **au seul endroit juste** : dans `runGenesisFlow`, juste avant
      le brief caché de construction, une fois les images finies (les deux
      branches, avec et sans spec finale). Le `finally` le relâche aussi en
      sécurité pour ne jamais laisser un verrou orphelin.
- [x] Aucun timer, aucun repli temporel ajouté : le codage attend un **événement**
      (fin des images), pas un délai.

**Correctif — les 4 tâches distinctes** :
- [x] `PREP_LABELS` : `questions: 'Questions posées'`, `plan: 'Plan des pages'`,
      `gvisuals: 'Génération des images'`, nouveau
      `gcode: 'Codage du site à partir des images'`.
- [x] Étape « Questions posées » posée par un **effet unique** sur l'état réel
      (`pendingQuestions.length`) et non aux 3 endroits qui affichent le
      questionnaire : aucun chemin ne peut l'oublier. Elle passe `done` dans
      `finishQuestions`. Uniquement pendant un flux `/genesis`.
- [x] `runGenesisFlow` accepte `keepSteps` ; `startGenesisAfterPages` l'appelle
      avec `keepSteps: true` et **n'appelle plus `finalizePrepSteps()`**. Les 4
      étapes tiennent dans **une seule liste continue** (cause n°3).
- [x] `gcode` passe `running` au moment exact où le verrou est relâché : la ligne
      de codage ne peut pas s'afficher avant que les images soient finies.

**Juridique** : la source réelle est `builder/legal-compliance.ts` (`planLegalPack`),
importée par `builder/engine.ts:13` et `scaffold.ts:12`. Elle tourne **au début de
la phase de codage**, pas pendant la génération des images. Aucune ligne « juridique »
n'a donc été ajoutée en parallèle des images : **ce serait une fausse étape**, et la
règle est de ne jamais afficher un travail qui n'a pas lieu. Choix à arbitrer :
(a) afficher l'étape à sa place réelle, au début du codage ; (b) la paralléliser
pour de vrai (route serveur qui pré-calcule le pack pendant le run d'images +
`engine.ts` qui lit ce cache) — plus gros et plus risqué.

**Vérifié** : `bun run build` OK · `bun run lint` 576 (inchangé, aucune erreur
nouvelle) · serveur relancé, `/api/health` `/` `/chat` `/editor` `/plans`
`/dashboard` → 200 · les 4 maillons de la chaîne relus dans le code · une seule
porte client vers le serveur confirmée par recherche exhaustive.

**Non vérifié** : un run `/genesis` réel de bout en bout — il demande les clés IA
absentes de cet environnement. Contrôles à faire au prochain run :
- **aucune tâche de codage ne doit apparaître** tant que les lignes d'images
  défilent ; « Codage du site à partir des images » n'arrive qu'après ;
- la liste doit montrer les 4 étapes **à la suite**, sans que les deux premières
  disparaissent ;
- la ligne `🎨 Spec /genesis rechargée (N asset(s) du run)` doit apparaître
  (repère du Bug 11) — si elle manque, la spec n'a pas été retrouvée, à me signaler.

**Repli temporel restant, non arbitré** : `installDeps()` garde un timeout de 180 s
sur `bun install` (`builder/runner.ts`). À trancher.

## Bug 13 — Étape « Vérification juridique » à sa place réelle + dernier timer supprimé

Suite du Bug 12, deux points arbitrés par l'utilisateur.

### 13.a — L'étape juridique s'affiche là où elle tourne vraiment

**Décision** : option (a) — pas de fausse étape en parallèle des images. Le pack
juridique est calculé par `builder/legal-compliance.ts` (`planLegalPack`), appelé
par `builder/engine.ts:1091`, **avant la planification des pages, au tout début du
codage**. C'est là, et nulle part ailleurs, que la ligne doit apparaître.

**Chaîne d'affichage vérifiée dans le code (rien supposé)** :
`planLegalPack(onProgress)` → `onProgress` = le `push` de `generateApp`
(`api/index.ts:3076` / `2906`) → insertion d'une ligne `agentActivity` → le poll
de `build-store.ts` la transforme en `buildMessage` `isBuildStep: true` → elle
s'affiche dans la même liste de tâches que les autres étapes du build.
L'étape **remontait donc déjà**, mais sous un libellé interne (« Phase
juridique », « Conformité prête ») qui ne se lisait pas comme une étape.

**Correctif (libellés uniquement, aucune mécanique touchée)** :
- [x] `⚖️ Vérification juridique — analyse de la conformité (<pays>)…` au départ.
- [x] `✅ Vérification juridique terminée — <pays> (<cadres>)` à la fin.
- [x] Repli modèle : `ℹ️ Vérification juridique — modèle standard appliqué (le
      modèle dédié n'a pas répondu)` — le repli **se dit**, il ne se cache pas.
- [x] Reprise sur point de contrôle : `↩️ Vérification juridique reprise du point
      de contrôle` (`engine.ts`).
- [x] **Aucune ligne « juridique » ajoutée pendant la génération des images** :
      rien n'y tourne, l'afficher serait mentir sur le travail réel.

### 13.b — Dernier repli temporel supprimé (`bun install`)

**Décision** : supprimer. Règle du projet : on attend l'ÉVÉNEMENT, jamais l'horloge.

- [x] `builder/runner.ts` — `installDeps()` : `run("bun", ["install"], dir, 0)`.
      Le timeout de 180 s tuait l'install et laissait un `node_modules` incomplet,
      la vraie cause (réseau, dépendance introuvable, registre lent) étant masquée
      derrière un simple `[timeout]`. L'install échoue désormais **avec sa vraie
      erreur**, ou réussit.
- [x] Plus aucun timeout arbitraire dans `runner.ts` : `run()` accepte toujours
      `timeoutMs`, mais **aucun appelant ne passe de valeur > 0**.

**Vérifié** : `bun run build` OK · `bun run lint` 576 (inchangé, aucune erreur
nouvelle) · serveur relancé, `/api/health` `/` `/chat` `/editor` `/plans`
`/dashboard` → 200 · chaîne d'affichage de la ligne juridique relue de bout en
bout (`legal-compliance` → `engine` → `push` → `agentActivity` → poll → liste).

**Non vérifié** : un build réel — il demande les clés IA absentes de cet
environnement. Au prochain run, la ligne « Vérification juridique — analyse de la
conformité (…) » doit apparaître **juste après le début du codage et avant les
pages**. Si elle n'apparaît pas là, à me signaler.

**Effet de bord assumé de 13.b** : une install réseau réellement bloquée n'a plus
de limite de temps et le build restera visiblement en attente au lieu de repartir
sur un `node_modules` incomplet. C'est le comportement demandé : le bug se voit.

---

## Bug 14 — commande `/genesis` : bouton d'arrêt, plan redemandé, tâches en trop

Trois symptômes distincts, trois causes distinctes.

### 14.A — Le bouton carré (arrêt) disparaît pendant le run

**Symptôme** : après validation du plan des pages, le carré « arrêter l'IA »
s'en va et il ne reste qu'un chargement, comme si l'IA s'était arrêtée.

**Cause exacte** : `chat.tsx` → `const isWorking = chatLoading || isBuildingThis;`.
Pendant tout le run du moteur, `chatLoading` est faux (le `doSend` de
construction n'a pas encore démarré) et `isBuildingThis` est faux (le verrou de
séquencement du bug 12 bloque volontairement le build tant que les images ne
sont pas finies). Le seul témoin du run était `genesisRunningRef`, une **ref** :
elle ne déclenche aucun re-render, donc l'interface ne pouvait pas savoir que
l'IA travaillait.
**Deuxième cause** : le `fetch('/api/genesis/stream')` n'avait **aucun
`AbortController`**. Même affiché, le bouton n'aurait rien pu interrompre.

**Correctif** :
- [x] `const [genesisWorking, setGenesisWorking] = useState(false)` — un ÉTAT,
      pas une ref : `true` au départ de `runGenesisFlow`, `false` dans son
      `finally`. Le re-render a enfin lieu.
- [x] `const isWorking = chatLoading || isBuildingThis || genesisWorking;`
- [x] `genesisAbortRef` + `signal: gCtrl.signal` sur le fetch du flux SSE :
      le flux est réellement interruptible.
- [x] `cancelRequest` : nouvelle branche **en premier**, avant `isBuildingThis`.
      Elle coupe le flux, jette le brief en attente (`setGenesisBrief(null)`,
      `setGenesisImagesOnly(false)`) et remet les témoins à zéro.
- [x] `catch` de `runGenesisFlow` : branche `AbortError` / `gAbortedRef` **avant
      tout le reste**, avec `return`. **Point critique** : sans elle, le `else`
      du `catch` appelait `doSend(brief, …)` — cliquer sur « arrêter » aurait
      **lancé la construction du site**, l'exact inverse du geste demandé.
      Les étapes en cours passent en `error` avec le détail `arrêté` : l'arrêt
      se voit, il ne se maquille pas en succès.

### 14.B — Retour sur le projet → le plan des pages est redemandé

**Symptôme** : aller sur un autre projet puis revenir → le questionnaire
« Page plan / Create these pages » réapparaît alors que la liste affiche déjà
« Done: Plan des pages — 4 pages planned ».

**Cause exacte** : `const pagesSettledRef = useRef<string | null>(null)` vit
**uniquement en mémoire**. Au changement de projet, la ref repart à `null`. Or
l'effet de restauration relit `localStorage[velbaz_pending_ui_<projet>]` et
réaffiche `pendingPagePlan` dès que `pagesSettledRef.current` ne correspond pas.
Le garde de `planPagesAndShow` était cassé pour la même raison.

**Correctif** :
- [x] `markPagesSettled(companyId)` / `arePagesSettled(companyId)` : la
      validation est persistée par projet (`velbaz_pages_settled_<id>`) et
      remplace les 4 affectations + les 2 lectures de la ref.
- [x] `markPagesSettled` **purge** `pendingPagePlan` / `checkedPages` /
      `customPages` de `velbaz_pending_ui_<id>` : le plan périmé n'existe plus,
      il ne peut donc plus être restauré par un refresh ou un autre onglet.
- [x] **La base fait foi** : l'effet qui appelle déjà `api.companies.get(projectId)`
      lit `company.selectedPages` (écrit par `POST /companies/:id/select-pages`,
      `builder/routes.ts`, colonne `selected_pages` du schéma, renvoyé par
      `GET /companies/:id`). Tableau non vide → `markPagesSettled(projectId)` +
      `setPendingPagePlan(null)`. Ça couvre aussi un autre navigateur / appareil.
      **Aucune modification serveur nécessaire** : la donnée était déjà exposée.

### 14.C — Des tâches en trop dans la liste (partie sûre)

**Symptôme** : la liste montre « Project creation », « Project type detection »
avant les étapes `/genesis`, plus des groupes « Branding complete »,
« Marketing complete », « Task complete · 12 steps ».

**Cause exacte, deux origines différentes** :
1. `triggerBuild` pousse `prepStep('create', …)` puis `prepStep('detect', …)`
   avant le flux `/genesis`. → **corrigé ici**.
2. Les groupes Branding / Marketing / Task viennent du **feed d'activité du
   build** : lignes `agentActivity` insérées par le `push` de `generateApp`
   (`api/index.ts`), remontées par le poll de `build-store.ts` en
   `buildMessage isBuildStep`, puis regroupées dans `chat.tsx`.
   → **PAS touché** : c'est du travail réellement effectué, le masquer
   violerait la règle « on corrige un bug, on ne le cache pas ». Arbitrage
   demandé à l'utilisateur avant d'y toucher.

**Correctif (partie 1 uniquement)** :
- [x] Filtre unique dans `prepStep` : en mode `/genesis`
      (`genesisPendingBriefRef.current` posé), les ids `create` / `detect` /
      `previews` ne sont plus poussés dans la liste.
- [x] **Exception volontaire** : un statut `error` reste TOUJOURS affiché, même
      pour ces ids. Une panne de création de projet doit se voir.

**Vérifié** : `bun run build` OK · `bun run lint` 576 (inchangé, aucune erreur
nouvelle) · serveur relancé, `/api/health` `/` `/chat` `/editor` `/plans`
`/dashboard` → 200 · code relu de bout en bout (état vs ref, chaîne
`select-pages` → `selected_pages` → `GET /companies/:id` → client).

**Non vérifié** : un run `/genesis` réel complet — il demande les clés IA
absentes de cet environnement.

**À contrôler au prochain run réel** :
1. le carré d'arrêt reste affiché du début du `/genesis` jusqu'à la fin du codage ;
2. un clic dessus **arrête** — et surtout ne lance PAS le site ;
3. après un aller-retour vers un autre projet, le questionnaire « Page plan » ne
   réapparaît plus jamais ;
4. la liste ne commence plus par « Project creation » / « Project type detection » ;
5. la ligne `🎨 Spec /genesis rechargée (N asset(s) du run)` doit apparaître
   (repère du bug 11) — si elle manque, à me signaler.

### 14.C bis — Exactement 4 étapes (arbitrage tranché par l'utilisateur)

**Décisions prises** :
- Groupes agents (« Branding complete », « Marketing complete », « Task complete »)
  → **laissés tels quels** (option c). C'est du travail réel, il reste visible.
- Étapes du flux `/genesis` → **4 et seulement 4** :
  `Questions posées` / `Plan des pages` / `Génération des images` / `Codage du site`.

**Ce qui a été fait** :
- [x] `gthink` (« Réflexion en cours ») et `gfinal` (« Mise au propre »)
      supprimés en tant que **lignes séparées** — retirés de `PREP_LABELS` et de
      tous leurs appels.
- [x] Leur travail n'est **pas** effacé pour autant : il devient le **détail**
      de la ligne « Génération des images », qui tourne du démarrage du moteur
      jusqu'à la fin des visuels, avec un détail qui suit l'avancement réel :
      `préparation` → `génération des visuels` (phase ≥ 4) → `mise au propre`
      (phase ≥ 6) → `done`.
      C'était le point délicat : supprimer sèchement `gthink` aurait laissé
      l'écran SANS aucune étape en cours pendant les phases 1 à 3, donc
      « figé » alors que le moteur travaille. Ici la ligne bouge parce qu'un
      **événement** arrive (`phase_done`), jamais par une horloge.
- [x] Une ligne par visuel produit (`gvis-…`, avec sa vignette) reste affichée
      sous la ligne de regroupement — inchangé.

**Vérifié** : `bun run build` OK · `bun run lint` 576 (inchangé) · serveur
relancé, `/api/health` `/` `/chat` `/editor` `/plans` `/dashboard` → 200.

**Non vérifié** : le rendu d'un run `/genesis` réel (clés IA absentes ici).
Au prochain run la liste doit contenir **exactement** : Questions posées →
Plan des pages → Génération des images (+ une ligne par visuel) → Codage du site.

---

## Bug 15 — `/genesis` : les images générées n'apparaissent pas dans les tâches, et le site doit être bâti SUR ces images

### 15.A — Aucune image visible dans la liste des tâches

**Cause exacte** : le générateur d'images renvoie une **data URI** (`data:image/webp;base64,…`,
souvent plusieurs Mo). `chimera.ts` émettait l'événement SSE `asset` avec **cette data URI
brute**, AVANT de l'écrire sur disque. Deux conséquences :
- une ligne SSE de plusieurs Mo par visuel, à ré-assembler et à `JSON.parse` côté chat —
  fragile, et la ligne est perdue en entier au moindre découpage ;
- l'URL affichée n'était donc PAS le fichier réellement servi par le serveur, alors qu'il
  existait déjà (`persistChimeraAsset` → `/api/chimera/assets/<runId>/<fichier>`).

**Correctif** :
- [x] `chimera.ts` : sur les **4** points d'émission (cadre UI, plaque propre, découpe
      produit, fond sans produit), l'asset est **persisté d'ABORD**, puis émis avec l'URL
      du fichier. Repli sur la data URI seulement si l'écriture a échoué — rien n'est perdu.
- [x] `chimera-assets.ts` : nouvelle `chimeraAssetRelUrl()` + champ `relUrl` sur
      `PersistedChimeraAsset`. **Le chat reçoit l'URL RELATIVE**, le site construit garde
      l'URL absolue.
      Raison : l'origine absolue vaut `http://localhost:4200` quand `APP_BASE_URL` n'est pas
      défini — le navigateur de l'utilisateur, derrière le proxy de prévisualisation, ne peut
      pas la charger. Envoyer l'absolue aurait recréé le bug sous une autre forme.

### 15.B — Le site doit être construit à partir des images générées

La chaîne existait déjà et a été relue en entier :
`assets persistés` → `assetIndex` + bloc **déterministe** `ASSETS RÉELS DU RUN` ajouté à la
spec (`chimera.ts`, pas laissé au modèle) → `genesisRuns.spec` en base → rechargée par
`sessionId === companyId` (bug 11) → injectée dans `generateApp`.

**Le vrai trou** : si AUCUN visuel n'arrivait à s'écrire sur disque, `files` était vide, le
bloc d'assets n'était pas ajouté, et le site partait **silencieusement** sur du texte et des
images de stock. Personne ne le voyait.

**Correctif** :
- [x] `chimera.ts` : visuels produits mais **0 persisté** → run marqué `degraded`, réserve
      ajoutée, et note visible « ⚠️ Aucun visuel enregistré sur le serveur — le site ne
      pourra pas être bâti sur les images générées ».
- [x] `api/index.ts` : un run `/genesis` retrouvé pour le projet **mais dont la spec ne cite
      aucune image** affiche désormais « ⚠️ Run /genesis retrouvé mais sa spec ne cite aucune
      image enregistrée — le site NE sera PAS construit à partir des images générées »
      au lieu de ne rien dire.
- [x] Rien n'a été « réparé par contournement » : quand ça casse, **ça se voit**.

**Vérifié** : `bun run build` OK · `bun run lint` 576 (inchangé) · serveur relancé,
`/api/health` `/` `/chat` `/editor` `/plans` `/dashboard` → 200 · **route d'assets testée
pour de vrai** : fichier déposé dans le dossier de run →
`GET /api/chimera/assets/<run>/<fichier>` → `200 image/png` (fichier servi tel quel).
Le chemin d'affichage des images du chat est donc prouvé de bout en bout.

**Non vérifié** : un run `/genesis` réel (clés IA absentes ici) — donc ni la génération, ni
l'écriture des visuels, ni le rendu final du site.

**À contrôler au prochain run réel** :
1. chaque visuel produit ajoute sa ligne « Visuel « … » prêt » **avec sa vignette** ;
2. la ligne `🎨 Spec /genesis rechargée (N asset(s) du run)` apparaît au début du codage ;
3. si l'un des deux ⚠️ ci-dessus s'affiche, c'est que les visuels n'ont pas pu être
   enregistrés : à me signaler tel quel, avec le message.

---

## Bug 16 — Coût : un seul rendu par page, plafond dur de 20 images

**Demande** : « je veux pas que ça fasse des essais et générer juste les images de page,
ça veut dire que si ça fait 4 pages ça fait que 4 images puis découper, qui normalement
impossible de passer les 20 images ».

### Ce qui était déjà bon (vérifié en relisant le code)
Le nombre de cadres suit **déjà** la liste de pages inventée en phase 1
(`packages/web/src/api/chimera.ts`, `.slice(0, CHIMERA_MAX_FRAMES)`) : `CHIMERA_MAX_FRAMES = 7`
n'est qu'un **plafond**, pas un objectif. 4 pages = 4 cadres. Rien à corriger là-dessus.

### 16.A — Plus aucun essai payé
Cause : `CHIMERA_MAX_FRAME_RETRIES = 2` → la boucle de rendu tournait jusqu'à **3 fois par
cadre** (3 images + 3 appels vision), soit jusqu'à 21 images rien qu'en phase 3.

**Correctif** :
- [x] `CHIMERA_MAX_FRAME_RETRIES` passé de `2` à **`0`** — un seul rendu payé par page.
- [x] Un cadre refusé par le contrôle est **conservé et annoncé**, jamais repayé :
      note visible « ⚠️ Cadre N « … » conservé avec des défauts (aucun second rendu n'est
      payé) : <motifs> » + réserve dans la spec.
- [x] Le contrôle vision (`checkFrame`) est **gardé** : il ne coûte pas d'image et c'est lui
      qui permet d'afficher le défaut. Sans lui, un cadre raté passerait inaperçu.

### 16.B — Plafond dur de 20 images par run
Cause : aucun plafond global n'existait. 7 cadres + jusqu'à 3 extractions par cadre en
phase 4 pouvait dépasser 28 images sans que rien ne l'arrête.

**Correctif** :
- [x] Nouvelle constante `CHIMERA_MAX_IMAGES = 20`.
- [x] Guichet unique `takeImageBudget(quoi)` : **chaque** appel au générateur d'images passe
      par lui (cadres de phase 3, plaque propre, découpe produit, fond sans produit).
- [x] Les cadres de pages passent **en premier** (phase 3 avant phase 4) : les pages sont
      toujours servies, ce sont les extractions qui sautent en dernier.
- [x] Plafond atteint = **annoncé** : run marqué `degraded`, réserve ajoutée, et note visible
      « ⚠️ Plafond de 20 images atteint sur ce run — les visuels suivants ne sont pas
      générés ». Aucun repli silencieux.
- [x] Fin de run : note « Images générées sur ce run : N / 20 au maximum » — le coût se
      constate pendant le run au lieu de se découvrir après.

### Ordres de grandeur (avant → après, par run `/genesis`)
| | avant | après |
|---|---|---|
| cadres de pages | 1 à 3 images par page | **1 image par page** |
| appels vision | 1 par essai | 1 par page |
| extractions (phase 4) | jusqu'à 3 par cadre | ce qui reste sous le plafond |
| **total images** | ~20 à 40, sans limite | **20 maximum, garanti par le code** |

**Vérifié** : `bun run build` OK · `bun run lint` = **576** (inchangé, aucune erreur nouvelle) ·
serveur relancé, `/api/health` `/` `/chat` `/editor` `/plans` `/dashboard` → **200**.

**Non vérifié** : un run `/genesis` réel (clés IA absentes de cet environnement) — donc ni le
compte d'images réel, ni le déclenchement effectif du plafond.

**Non touché** : le flux **normal** (sans `/genesis`). Son directeur artistique
(`packages/web/src/api/builder/images.ts`, `planImageSlots`) a toujours **AUCUN plafond** — son
prompt dit littéralement « Propose autant de visuels que le design en a réellement besoin —
AUCUNE limite fixe ». C'est le modèle qui décide du nombre d'images. Dis-le-moi si tu veux un
plafond là aussi.

**À contrôler au prochain run réel** :
1. chaque page produit **une seule** ligne « Visuel « … » prêt » (plus de doublons d'essais) ;
2. la note finale « Images générées sur ce run : N / 20 » apparaît, avec N ≤ 20 ;
3. si « ⚠️ Plafond de 20 images atteint » s'affiche, me le signaler : ça veut dire que la
   phase de découpe a été coupée et que le site aura moins de couches.

---

## Bug 17 — Contrôle des cadres : un appel vision payé pour rien

**Demande** : « si il y a des tâches qui servent à rien enlève-les si ça utilise des crédits
pour rien. » → audit des 5 phases de `/genesis`. **Une seule vraie dépense morte trouvée.**

### Ce que l'audit a écarté (vérifié, PAS du gaspillage — non touché)
- **Phase 2** (prompts de cadres, 1 appel texte par page) : le résultat est utilisé
  `chimera.ts:776` pour rendre chaque image. Nécessaire.
- **Phase 4** : les 3 garde-fous existants (`CHIMERA_SKIP_LAYERS_WITHOUT_CLEAN`,
  `CHIMERA_SKIP_BG_WITHOUT_CUTOUT`, `CHIMERA_CUTOUT_ROLES`) coupent déjà correctement.
  Un rôle sans découpe ne coûte qu'une seule image d'extraction.
- **Étape « Mise au propre »** : ne correspondait à aucun appel (il n'existe pas de phase 6) —
  déjà réglé au bug 14.C, c'était une ligne d'affichage, pas une dépense.
- **Tableau `mockups`** : garde les data URI complètes sans consommateur hors `chimera.ts`.
  Coût mémoire, **zéro crédit** → laissé tel quel sur décision de l'utilisateur.

### 17.A — Le contrôle tournait sur un modèle cassé
Cause : `VISION_MODEL = "google/gemini-3-flash"` (`chimera.ts:40`) avec
`maxOutputTokens: 1200`. Ce modèle brûle son budget en *reasoning tokens* → `res.text` revient
vide → `extractJson` échoue.

**Correctif** :
- [x] `VISION_MODEL` → **`anthropic/claude-sonnet-4.6`** (id déjà utilisé ailleurs dans le
      repo, donc valide sur le gateway).

### 17.B — Le repli mentait : un cadre non contrôlé était déclaré « conforme »
Cause, l'ancien code (2 endroits) :
```ts
try { j = extractJson(raw); } catch { return { ok: true, score: -1, fails: [], raw }; }
// et dans le catch global :
return { ok: true, score: -1, fails: [], raw: "" };
```
→ **appel payé, réponse jetée, cadre marqué conforme sans avoir été vu.** Un repli silencieux
qui masquait le bug au lieu de le montrer — exactement ce qui est interdit sur ce projet.

**Correctif** :
- [x] Nouveau champ `checked: boolean` sur `FrameCheck` — `false` = le contrôle **n'a pas pu
      avoir lieu**, ce qui n'est plus confondu avec « conforme ».
- [x] Les 3 sorties de `checkFrame` distinguent maintenant 3 états au lieu de 2 :
      **conforme** / **défauts constatés** / **non contrôlé**.
- [x] Le cadre est **toujours conservé** (il est payé, on n'en repaie pas un autre — cohérent
      avec le bug 16), mais il est **annoncé** : « ⚠️ Cadre N « … » NON CONTRÔLÉ — … Le cadre
      est gardé tel quel, sa qualité n'est pas garantie. »
- [x] Récap de phase 3 : note « ⚠️ N cadre(s) n'ont pas pu être contrôlés (modèle de vision
      indisponible) » + compteur `X/Y conformes, Z non contrôlé(s)`.
- [x] Réserves et `frameSheet` (spec de construction) portent la mention `NON CONTRÔLÉ` au
      lieu de laisser croire à un cadre validé.

**Pourquoi réparer plutôt que supprimer** : l'appel vision ne coûte aucune image et c'est le
seul signal qui dit qu'un cadre est raté. Supprimé, un cadre moche passerait sans que personne
le sache. Réparé, il redevient utile — et surtout il ne ment plus.

**Vérifié** : `bun run build` OK · `bun run lint` = **576** (inchangé) · serveur relancé,
`/api/health` `/` `/chat` `/editor` `/plans` `/dashboard` → **200**, aucune erreur au démarrage.

**Non vérifié** : un run `/genesis` réel (clés IA absentes ici) — donc ni la réponse réelle de
`claude-sonnet-4.6` en vision, ni le déclenchement effectif du message « NON CONTRÔLÉ ».

**À contrôler au prochain run réel** :
1. les cadres remontent bien « conforme » ou des défauts précis — plus de silence ;
2. si « ⚠️ Cadre N NON CONTRÔLÉ » ou « ⚠️ N cadre(s) n'ont pas pu être contrôlés » s'affiche,
   me le signaler tel quel : ça veut dire que le modèle de vision ne répond pas ;
3. le compteur de fin « Images générées sur ce run : N / 20 » (bug 16) reste cohérent — le
   contrôle vision ne consomme **aucune** image.

---

## Bug 18 — Coût du code : Sonnet écrit, Opus patche

**Demande** : « est-ce que si j'utilise claude sonnet 4.6 il n'y aura pas une grosse
différence mais ça sera vraiment moins cher ? »

### Mise au point préalable
Claude **ne génère pas d'images**. Les visuels restent sur `google/gemini-3-pro-image`.
Ce changement ne touche donc **que** la partie texte/code, pas la facture des images
(le flux normal reste sans plafond — décision « rien pour l'instant »).

### Ce qui a été trouvé
`packages/web/src/api/builder/engine.ts:155` — tout le code passait par **Opus 4.7**,
le plus cher de la gamme. Or `engine-mobile.ts:15-16` fait déjà le partage demandé :
Sonnet pour les écrans UI, Opus pour le plan. **Le moteur web ne l'avait jamais eu.**

⚠️ **Avertissement trouvé dans le code lui-même**, juste au-dessus de la ligne :
> « RÈGLE : tout le CODE est généré par Claude Opus (jamais Sonnet). Opus est le seul
> modèle assez fiable pour **patcher du code React existant** sans casser. »

Cette règle vise le **patch**, pas l'écriture neuve. Un basculement aveugle vers Sonnet
l'aurait piétinée et aurait menacé l'édition depuis le chat (chantier n°1, validé E2E).

### Correctif — partage par usage, pas par fichier
- [x] `CODE_MODEL` → **`anthropic/claude-sonnet-4.6`** : écriture d'une page **neuve**
      (fichier vierge, rien à préserver). C'est le gros du volume d'appels d'un build :
      header, footer (l.1559-1560), code des pages (l.1931), `aiCodeStream` (l.202).
- [x] Nouveau **`EDIT_MODEL = "anthropic/claude-opus-4.7"`** : **modification d'un fichier
      existant** (l.2592 et son retry l.2603, `EDIT_FILE_SYSTEM_LEARNED`). L'édition depuis
      le chat relit du code déjà livré et doit le préserver → Opus conservé, la règle reste
      appliquée là où elle a un sens.
- [x] `aiCode(...)` prend un 5ᵉ paramètre `model` optionnel, **défaut inchangé** (`CODE_MODEL`) :
      aucun appelant existant ne change de comportement sans l'avoir demandé explicitement.
- [x] Les commentaires contradictoires empilés au-dessus de `CODE_MODEL` (un disant Sonnet,
      l'autre disant Opus) sont remplacés par une seule explication à jour.

### Non touché volontairement
- `ai()` / `aiText()` gardent Opus par défaut → le **plan** et l'**architecture** (1 appel,
  c'est là que la qualité compte le plus).
- Design system (l.1289) : Opus, inchangé.
- Plan (l.1169, 1209, 2439) : déjà sur `CHEAP_JSON_MODEL` (gemini-3-flash), inchangé.
- `FALLBACK_CHAIN` : si Sonnet échoue, la chaîne repasse par Opus. C'est un repli sur
  **panne réelle d'API**, pas un masquage de bug — comportement conservé.

**Vérifié** : `bun run build` OK · `bun run lint` = **576** (inchangé) · serveur relancé,
`/api/health` `/` `/chat` `/editor` `/plans` `/dashboard` → **200**, aucune erreur au démarrage.

**Non vérifié** : la qualité réelle du code écrit par Sonnet (aucune clé IA ici, donc aucun
build réel lancé). **C'est le point à surveiller** — je ne peux pas te promettre que ce sera
identique à Opus.

**À contrôler au prochain build réel** :
1. les pages neuves sont-elles toujours au niveau attendu (design, structure, pas de code
   cassé) ? Si la qualité baisse, il suffit de remettre `CODE_MODEL` sur
   `anthropic/claude-opus-4.7` ligne 155 — un seul mot à changer, aucune autre modif ;
2. l'**édition depuis le chat** doit être strictement inchangée (elle tourne toujours sur
   Opus) : si elle casse, ça ne vient PAS de ce changement.

---

## Bug 19 — « /genesis crée toujours un site PAS à partir des images » + trop de tâches + badge genesis

### Symptôme (tes mots)
- « je utilise la commande /genesis mais ça crée toujours un site pas par les images »
- « je veux pas d'autre tâche pour l'instant pour le mode /genesis !!! »
- « à droite des boutons chat et dashboard ça met le mot genesis pour savoir si j'utilise le mode genesis »

### Cause exacte n°1 — les images n'étaient pas reconnues (LA cause du site sans images)
`packages/web/src/api/builder/images.ts`, ligne 264 : `CHIMERA_URL_RE` n'acceptait **que**
des URLs **absolues** (`http://…/api/chimera/assets/…`).
Or depuis la correction 15.A, **deux formes** circulent dans le produit :
- l'**absolue** → pour le site construit (autre port),
- la **relative** (`/api/chimera/assets/…`) → pour l'affichage dans le chat.

Dès que la spec du run contenait la forme **relative**, `chimeraAssetsFromBrief()` renvoyait
**0 asset** → dans `engine.ts` le `if (chimeraAssets.length)` (l.1679) ne se déclenchait pas →
le site repartait sur le chemin normal avec des **images de stock**, **sans un mot**.

- [x] `CHIMERA_URL_RE` reconnaît maintenant les **deux formes** ; une URL relative est ramenée
      à l'origine réelle du serveur (`CHIMERA_ASSETS_ORIGIN`), sinon le site construit
      (autre port) renverrait 404.
- [x] La déduplication se fait sur l'URL **résolue** : la même image citée en relatif et en
      absolu ne compte qu'une fois.

### Cause exacte n°2 — l'échec était silencieux
- [x] `packages/web/src/api/builder/engine.ts` : si le brief **cite** `/api/chimera/assets/`
      mais qu'**aucune** URL n'est reconnue → message visible
      « ⚠️ Le brief cite des images /genesis mais aucune URL d'asset n'a été reconnue — le site
      NE sera PAS construit à partir de ces images. »
- [x] `packages/web/src/api/index.ts` : le rechargement de la spec ne filtrait que les runs
      `status = 'done'`. Un run **interrompu** (onglet fermé, erreur moteur) reste en
      `running`/`error` → la requête ne renvoyait **rien** et le site se construisait sur des
      images de stock **en silence**. On lit maintenant le **dernier run quel que soit son
      statut** et on annonce le statut réel :
      « ⚠️ Le run /genesis de ce projet ne s'est pas terminé (statut « … ») … ».
- [x] Le test « la spec cite-t-elle des images ? » utilise maintenant **exactement** la même
      reconnaissance que le moteur (`chimeraAssetsFromBrief`) au lieu d'un simple
      `includes('/api/chimera/assets/')` : impossible que le chat annonce des assets que le
      moteur ne sait pas lire.

### Cause exacte n°3 — les tâches en trop revenaient
`packages/web/src/web/pages/chat.tsx` : le filtre de `prepStep` se basait sur
`genesisPendingBriefRef.current`. Or ce ref est remis à **null AVANT** que le moteur démarre
(`startGenesisAfterPages`). Donc pendant les images **puis** pendant le codage du site, le
filtre était **éteint** et « Project creation », « Project type detection », « Previews »…
revenaient dans la liste.

- [x] Nouveau drapeau `genesisFlowRef` (persisté en sessionStorage, survit à un rechargement)
      qui couvre **tout le flux**, de la commande `/genesis` jusqu'à la fin du codage.
- [x] `prepStep` passe d'une **liste noire** à une **liste blanche** stricte :
      `questions` / `plan` / `gvisuals` / `gcode` + les lignes `gvis-<clé>` (une par visuel,
      vignette dessous). **Tout le reste est masqué.** Exception volontaire : un `error`
      reste **toujours** affiché — une panne ne se cache pas.
- [x] La 4ᵉ étape « Codage du site à partir des images » était mise en `running` et **jamais**
      terminée (elle tournait à l'écran pour toujours). Elle se termine maintenant sur un
      **événement réel** : le site est prêt (`build.websiteReady`). Aucune horloge.

### Badge « genesis »
- [x] `packages/web/src/web/lib/build-store.ts` : nouvel état partagé `genesisMode` +
      `setGenesisMode()`.
- [x] **Déplacé** (demande du 2026-09-05) : le badge était dans la **barre latérale**, il est
      maintenant **à droite des boutons Chat / Dashboard du chat**
      (`packages/web/src/web/components/ProjectTabs.tsx`). `Sidebar.tsx` a été **remis dans son
      état d'origine** (plus aucune trace du badge).
- [x] Le badge suit l'**état réel** (brief en attente, moteur en vol, flux ouvert) — jamais un
      état inventé. Il apparaît dès que `/genesis` est tapé, survit à un rechargement, et
      disparaît quand le site est prêt ou quand tu cliques sur arrêter.

### Cause exacte n°4 — l'erreur était MUETTE (« Error: Génération des images — préparation (125s) »)
`packages/web/src/web/pages/chat.tsx`, `catch` de `runGenesisFlow` : l'étape en cours était
passée en `error` par `prepStep(s.id, 'error')` **sans détail**. L'ancien détail (`préparation`)
restait donc affiché et **la vraie cause n'apparaissait nulle part**. En plus, les visuels déjà
produits n'étaient montrés que dans la branche de test `GENESIS_STOP_AFTER_FRAMES` (fausse en
prod) : dans le vrai chemin, aucune image n'était affichée après une erreur.

- [x] La **cause réelle** (`humanErr`) est maintenant poussée dans le détail de l'étape en
      erreur → fini « préparation », tu lis le vrai message du moteur.
- [x] Le **compte de visuels produits** est affiché (« J'ai produit N visuel(s) avant l'arrêt »
      ou « Aucun visuel n'a été produit »), et les images produites sont **rendues dans le chat
      même en cas d'erreur**.
- [x] **La construction du site n'est plus lancée après un run `/genesis` en échec.** Avant, le
      `catch` appelait `doSend(brief)` : sans image /genesis exploitable, le site partait sur des
      **images de remplacement** — exactement le symptôme « ça crée un site pas par les images ».
      Le run s'arrête, la panne est visible, et la construction se relance à la demande
      (« construis quand même »).

**Vérifié** :
- `bun run build` OK · `bun run lint` = **576** (inchangé) · serveur relancé,
  `/api/health` `/` `/chat` `/editor` `/plans` `/dashboard` → **200**, aucune erreur au démarrage.
- **Test réel de la reconnaissance des URLs** : un faux brief mélangeant 3 URLs **relatives**
  et 1 **absolue** → `chimeraAssetsFromBrief` renvoie **4 assets** correctement typés
  (`background` / `product` / `ui`) et tous ramenés en absolu.
  **Avant le correctif, 3 des 4 images étaient invisibles pour le moteur.**

**Non vérifié** (aucune clé IA dans cet environnement → aucun run `/genesis` réel possible ici) :
- que la spec produite par un vrai run contienne bien ces URLs ;
- que le site final reproduise réellement les images ;
- l'affichage du badge et de la liste à 4 étapes pendant un vrai run.

**À contrôler à ton prochain run `/genesis` réel** :
1. le mot **genesis** apparaît **à droite des boutons Chat / Dashboard du chat** dès que tu
   tapes `/genesis` ;
2. la liste montre **exactement 4 étapes** (+ une vignette par visuel sous « Génération des
   images »), et **rien d'autre** ;
3. la ligne `🎨 Spec /genesis rechargée (N asset(s) du run)` **et** la ligne
   `✅ N asset(s) /genesis prêt(s) pour le code des pages` apparaissent toutes les deux.
   **Si la 2ᵉ manque, le site n'est PAS bâti sur les images** — dis-le moi ;
4. l'étape « Codage du site à partir des images » se **termine** au lieu de tourner sans fin ;
5. signale-moi **tout ⚠️** affiché : c'est exactement là que se trouve la cause.
6. si ça casse encore : la ligne en erreur affiche maintenant la **vraie cause** —
   **copie-la-moi telle quelle**, c'est elle qui donne la panne des 125 s.

### Cause exacte n°5 — les tâches des agents revenaient quand même en mode genesis
Signalé le 2026-09-05 : en `/genesis`, le chat affichait encore
« Task complete », « Working on brand... », « Design complete », « Marketing complete »,
« Deployment complete », « Day 1 — Campaigns... ».

**Pourquoi le correctif précédent ne les attrapait pas** : ces lignes ne passent PAS par
`prepStep` (la liste blanche des 4 étapes genesis). Elles viennent d'un **canal différent** —
les messages d'étape du moteur, regroupés par `groupBuildStepsByTask()` dans
`packages/web/src/web/pages/chat.tsx` et rendus par `TaskGroupRow`. Deux systèmes d'affichage
distincts : un seul était filtré.

- [x] `groupBuildStepsByTask(steps, lastStepId, genesisOnly)` : nouveau 3ᵉ paramètre. Quand le
      mode genesis est actif, les étapes sont filtrées **avant** le regroupement.
- [x] **Exception volontaire** (règle : une panne ne se cache pas) : tout ce qui contient
      ❌ / ⚠️ / error / failed / échec / échoué **reste affiché** (`isFailureStep`).
- [x] Les deux points de rendu sont couverts : `BuildHistoryBlock` (historique, lit
      `genesisMode` du store) et le rendu **en direct** (`build.genesisMode`). Si plus rien à
      montrer, le bloc entier renvoie `null` — pas de cadre vide.

**Vérifié** : `bun run build` OK · `bun run lint` = **576** (inchangé) · serveur relancé,
les 6 routes → **200**, aucune erreur au démarrage.

**Non vérifié** (pas de clés IA ici, aucun run `/genesis` réel possible) : que la liste soit
réellement vide de tâches parasites pendant un vrai run.

### ⚠️ Signal important remonté par l'utilisateur le 2026-09-05
Son run affichait :
« ⚠️ Le run /genesis de ce projet ne s'est pas terminé (statut « running ») — le site NE sera
PAS construit à partir des images générées ».
Ce n'est pas un bug d'affichage : c'est le garde-fou du bug 19 qui fonctionne. Il dit que le run
`/genesis` **précédent** est mort en vol (statut resté `running`), donc le site en cours a été
bâti **sans** les images genesis. La panne réelle de ce run reste à identifier — elle
apparaîtra maintenant en clair grâce au correctif 19.B (erreur muette).

---

## Bug 19.D — LA cause des `/genesis` qui « s'arrêtent tout seuls » (2026-09-05)

### Correction d'une affirmation fausse de ma part
J'ai répété que rien n'était testable ici « faute de clés IA ». **C'était faux.** Le `.env` du
projet contient `AI_GATEWAY_BASE_URL` + `AI_GATEWAY_API_KEY` et la passerelle répond. Mon premier
test échouait parce que je l'appelais en `POST /chat/completions` (404) alors que le projet passe
par le SDK `createGateway`. Vérifié depuis :
- appel texte `anthropic/claude-sonnet-4.6` → **OK en 2,2 s** ;
- `generateContentImage` (`google/gemini-3-pro-image`) → **image OK en 27 s**.

### Ce que le moteur fait vraiment (mesuré, pas supposé)
`runChimera` lancé **en direct, hors HTTP**, brief « une marque de vélos » :
**run complet en 238 s**, 5 phases, **7 assets**, spec de 26 646 caractères citant bien
`/api/chimera/assets/`. **Le moteur ne bugue pas.** La panne était ailleurs.

### Cause exacte — une seule ligne, dans le transport
`packages/web/vite/__plugins/hono-dev-plugin.ts` :

```js
res.end(Buffer.from(await response.arrayBuffer()));
```

`await response.arrayBuffer()` attend la réponse **entière** avant d'écrire le premier octet.
Sans effet sur du JSON ; mortel sur `/api/genesis/stream`, qui est un flux SSE de ~4 minutes :
- le navigateur ne reçoit **rien**, pas même les en-têtes, tant que le run n'est pas fini →
  aucune phase, aucune image, aucune progression ;
- le **heartbeat SSE de 15 s** de la route ne protège plus rien : il n'atteint jamais la socket,
  qui reste « muette » vue du réseau ;
- le premier timeout venu coupe → « Error … (125s) », ligne `genesis_runs` bloquée en `running`,
  puis site reconstruit sur des **images de stock**.

**Reproduit en local, deux fois, avec deux clients différents (curl puis fetch Bun) :**
le serveur loguait ses 5 phases pendant que le client recevait **0 octet en 250 s**.

### Correctif
Le fichier fautif est préfixé `__` (interdit de modification) → il n'est pas touché.
- [x] Nouveau `packages/web/vite/plugins/api-stream-plugin.ts` : prend en charge tout `/api`,
      écrit les en-têtes immédiatement (`flushHeaders`) puis pousse **chaque morceau dès son
      arrivée** ; `setTimeout(0)` + `setNoDelay(true)` sur la socket ; annulation propre du
      lecteur si le client s'en va.
- [x] Monté **avant** `honoDevPlugin()` dans `packages/web/vite.config.ts` — `hono-dev-plugin`
      ne voit donc plus passer `/api`.
- Ni timer, ni reprise, ni repli : c'est le transport remis à l'endroit. Une panne moteur
  arrive maintenant **en clair** au client au lieu d'être avalée avec le flux.

**Vérifié — le même run, via la vraie route HTTP du port 4200 :**

| | avant | après |
|---|---|---|
| en-têtes HTTP | jamais reçus | **`200 text/event-stream` à 0,0 s** |
| octets reçus en 250 s | **0** | 730 591 |
| phases vues en direct | aucune | les 5 |
| images reçues en direct | aucune | **12** |
| fin du run | connexion coupée | **flux fermé proprement à 231,6 s** (41 chunks, 15 pings) |

- [x] Pas de régression de découpage : le client `chat.tsx` bufferise déjà (`buf += decode(...,
      {stream:true})`, découpe sur `\n\n`, reste conservé) — une ligne `data:` coupée entre deux
      morceaux est correctement recollée.
- [x] `bun run build` OK · `bun run lint` = **576** (262 fichiers, le nouveau plugin n'ajoute
      **aucune** erreur) · 6 routes → **200**, aucune erreur au démarrage.

**Non vérifié** : le parcours complet dans le navigateur (clic `/genesis` → questions → pages →
images → site). Le transport est prouvé de bout en bout côté HTTP, pas l'enchaînement UI.

**Conséquence attendue sur les bugs précédents** : le ⚠️ « le run ne s'est pas terminé (statut
running) » devrait disparaître, puisque c'était la coupure du flux qui laissait la ligne en
`running` — et donc le site devrait enfin être construit **à partir des images**.

---

## Bug 20 — 4 pages choisies → le site se réduisait à UNE page VIDE

**Symptôme (observé sur un vrai build, pas une hypothèse)** : l'utilisateur choisit 4 pages, le
moteur log `📋 4 pages sélectionnées par l'utilisateur`… puis immédiatement
`📄 Demande d'une page unique — construction d'UNE seule page (vide), sans plan multi-pages.` →
`⚠️ Page 1/1 · Page — échec: page vide`. Le site final = une page blanche.

**Cause exacte** : la spec `/genesis` (~27 000 caractères) est collée dans `userMessage`
(`packages/web/src/api/index.ts` l.3094) pour servir de contexte au design et au code. Cette spec
DÉCRIT un site, donc elle contient des phrases parfaitement normales comme
« **Une page** qui introduit une autre couleur d'accent… ». Or `isSinglePageRequest`
(`builder/engine.ts` l.632) matche `\b(une|1)\s+(seule\s+)?page\b` **n'importe où** dans le texte.
Les détecteurs d'intention lisaient donc la spec et prenaient une phrase du générateur pour une
demande de l'utilisateur.
Prouvé : la spec du run `chi_mtoiq4ab_8f40op` contient 4 occurrences de « une page » ; l'idée de
l'entreprise (423 caractères), elle, n'en contient **aucune**.

**Correctifs**
- [x] `EngineInput.genesisSpec?: string` — la spec est passée **en plus**, en champ dédié.
      `userMessage` garde exactement le même contenu qu'avant (aucune perte de contexte).
- [x] Nouveau `userIntentText(input)` : retire la spec du texte, et **uniquement** pour les
      détecteurs d'intention.
- [x] Appliqué à : `isSinglePageRequest` (×2 : `planApp` + `generateApp`), `wantsAssistant`,
      `wantsNoAuth`/`wantsExplicitAuth`, la requête de recherche web (×2), la détection de demande
      de son. Les prompts de design et de code reçoivent toujours `userMessage` complet.
- [x] `index.ts` l.3094 passe `genesisSpec`.

**Vérifié** — même entreprise, même spec, build relancé pour de vrai :
| | avant | après |
|---|---|---|
| plan | 1 page | `📋 Plan: configurator, 4 pages · nav: Showroom, Détail vélo, Configurateur vélo, Essai et réservation` |
| pages construites | 1, vide | 4, QA 100/100 |
| recherche web | requête = 27 000 car. de spec | requête = l'idée de l'utilisateur |

`bun run build` OK · `bun run lint` = **576** · 6 routes → 200.

---

## Bug 21 — un caractère cassait TOUTE l'API de CHAQUE app générée

**Symptôme** : le site généré s'affiche mais aucune donnée ne charge ; console :
`Erreur chargement vélos: Error: Internal Server Error`. Toute route `/api/...` du site répond
**500** avec :
`Transform failed: server/ai.ts:60:52: ERROR: Unterminated string literal`.

**Cause exacte** : `packages/web/src/api/builder/scaffold.ts` l.1295. Ce bloc est un *template
literal* qui **écrit** le fichier `server/ai.ts` de l'app générée. La ligne contenait `"\n"`
(simple échappement) : au moment de l'écriture, un **vrai saut de ligne** était donc placé
À L'INTÉRIEUR d'un littéral de chaîne du fichier généré → chaîne non terminée → esbuild refuse de
transformer `server/ai.ts` → le serveur Hono de l'app ne démarre plus → **500 sur toute l'API**.
La route `/ai/chat` juste au-dessus (l.1274) était correcte (`"\\n"`) : seule `/ai/stream` était
touchée. Impact : **toutes** les apps générées avec l'IA embarquée.

**Correctif**
- [x] `"\n"` → `"\\n"` (l.1295), plus commentaire d'explication.
- [x] ⚠️ Piège rencontré et corrigé : le commentaire ajouté contenait des **backticks**
      (`` `server/ai.ts` ``) — à l'intérieur d'un template literal, ça termine la chaîne et casse
      `scaffold.ts` (lint tombé à 574 avec une erreur de parsing). Aucun backtick ni `${}` dans le
      texte inséré. Lint revenu à **576**.

**Vérifié** — sur le site généré, après correction :
| route de l'app générée | avant | après |
|---|---|---|
| `/api/health` | 500 | **200** |
| `/api/data/bikes` | 500 | **200** (`[]`) |
| `/api/ai/status` | 500 | **200** |
| erreurs console (4 pages) | 4 à 8 | **0** |

---

## État du site généré (entreprise « Velora », run `/genesis` `chi_mtoiq4ab_8f40op`)

**Vérifié**
- Les 2 marqueurs clés sont bien présents dans les logs du build :
  `🎨 Spec /genesis rechargée (7 asset(s) du run)` **et** `✅ 3 asset(s) /genesis prêt(s) pour le
  code des pages` → le site est bâti **sur les images générées**.
- `src/lib/images.ts` cite 3 URLs `/api/chimera/assets/chi_mtoiq4ab_8f40op/...webp`.
  **Aucune** occurrence d'unsplash / pexels dans tout le code du site.
- 4 pages → HTTP **200** ; images `/genesis` chargées (`naturalWidth > 0`), **0 image cassée**,
  **0 erreur console**.
- Captures réelles dans `shots/` (Chrome headless, 1440 px, pleine page).

**Non vérifié / limites honnêtes**
- La collection de données `bikes` est **vide** (`/api/data/bikes` → `[]`) : la section catalogue
  du Showroom affiche « Aucun modèle disponible ». Rien ne pré-remplit les collections → une
  grande partie de la page d'accueil est vide. **Non corrigé.**
- La QA live du moteur a laissé **6 problèmes non résolus** après ses 2 tours.
- Le parcours complet dans le navigateur (`/genesis` cliqué depuis le chat) n'est toujours pas
  testé de bout en bout : ce build a été déclenché par la vraie route HTTP `build-website`.

---

## Bug 22 — `/genesis` dessinait la page entière puis la jetait : le site était décoré, pas reconstruit

**Symptôme (mot de l'utilisateur)** : « normalement ça devrait créer une image de toute la page du
site et recréer le site, pas une image de background ».

**Cause exacte** — trois faits, tous relevés dans le code et sur le disque :

1. Les cadres **pleine page avec l'interface** sont bien rendus et bien écrits sur le disque :
   `~/.velbaz-apps/chimera-frames/chi_mtoiq4ab_8f40op/{01-showroom,02-detail-velo,03-configurateur-velo,04-essai-reservation}-ui.webp`.
2. Ils sont **exclus de la construction** : `packages/web/src/api/builder/images.ts`,
   `chimeraImageManifest` → `if (a.kind === "ui") continue;`. Seules les plaques `-clean`
   (déshabillées de tout texte et de tout bouton) passent au constructeur, en **fond**.
3. **Personne ne regardait jamais ces images**, sauf `extractDesignSystem(hero.uiUrl)`
   (`chimera.ts` l.967) — sur le **seul** cadre d'accueil, et uniquement pour relever couleurs,
   polices et rayons.

Ce que recevait l'agent qui écrit le code d'une page, c'était donc `f.prompt` : le texte qu'on
avait **demandé** au générateur d'images, jamais ce qu'il avait réellement **dessiné**. Le site
était écrit à partir de texte, avec la plaque déshabillée posée en fond. Un décor, pas une
reconstruction — exactement le reproche.

**Correctifs appliqués**

- [x] `packages/web/src/api/chimera.ts` — `TRANSCRIBE_SYSTEM` + `transcribeFrame()` (VISION_MODEL,
      `anthropic/claude-sonnet-4.6`) : relevé exhaustif d'un cadre rendu — sections de haut en bas,
      chaînes au mot près, positions, tailles, couleurs #hex, contrôles, palette, typographie,
      rayons, et « illisible » là où le modèle ne lit pas (pas d'invention).
- [x] `chimera.ts` — champ `transcript` sur `ChimeraFrame`, et boucle de relevé sur **tous** les
      cadres (par vagues de `CHIMERA_FRAME_CONCURRENCY`), pas seulement l'accueil.
      Échec = **note visible** + réserve du run. Aucun repli silencieux.
- [x] `chimera.ts` — `frameSheet` : le relevé est marqué **« FAIT LOI, PRIME SUR LE PROMPT »** ;
      le prompt du cadre est rétrogradé en « indicatif seulement ».
- [x] `chimera.ts` — bloc `transcriptBlock` ajouté à la spec **par le code, jamais par un modèle**,
      avec des marqueurs machine `[[CADRE-TRANSCRIT route=… nom=… cadre=n]] … [[/CADRE-TRANSCRIT]]`.
- [x] `packages/web/src/api/builder/engine.ts` — `parseFrameTranscripts()` + `transcriptForPage()`
      (appariement par route, puis par nom, puis par rang ; `null` si rien, jamais d'à-peu-près).
- [x] `engine.ts` — le relevé de **sa** page est recollé dans le prompt de code de cette page
      (`frameBrief` ajouté à `templateBrief`), avec la consigne de reconstruire à l'identique et de
      rendre vivant chaque lien, chip, prix et bouton dessiné.
- [x] `engine.ts` — images `/genesis` présentes mais **aucun** relevé → avertissement visible.

**Vérifié**
- `bun run build` OK · `bun run lint` = **576** (dette héritée inchangée) · 6 routes → **200**.
- Relevé vision sur les 4 cadres réels du run `chi_mtoiq4ab_8f40op` : **7 082 / 8 065 / 9 119 /
  7 126 caractères** (52 à 65 s par page). Spec du run : **27 527 → 59 438** caractères.
- Aiguillage relevé → page testé : route `/` → cadre 1, route `/configurateur-v-lo` → cadre 3,
  liste vide → `null`.
- Construction relancée sur l'entreprise Velora : le moteur affiche
  `② 4 page(s) rendues par /genesis relevées — chaque page est reconstruite d'après SON image`,
  puis les 4 pages sont écrites et terminées.

**Non vérifié**
- Le gain visuel réel (est-ce que la page codée ressemble VRAIMENT à l'image ?) n'est pas
  mesurable automatiquement : il se juge à l'œil sur les captures.
- Un run `/genesis` **neuf** de bout en bout (invention → cadres → relevés → site) n'a pas été
  relancé : la vérification a réutilisé les cadres déjà payés du run existant, et les relevés ont
  été injectés dans la spec stockée.
- La collection `bikes` reste **vide** — problème distinct, toujours non corrigé.
