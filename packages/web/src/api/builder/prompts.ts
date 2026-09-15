// ─── App Generation Prompts ──────────────────────────────────────────────────
// The prompts that turn a business idea into a real full-stack app.
// Quality bar: reproduce the polish of Lovable / Linear / Stripe / Vercel.

// The model's training data skews old, so left unguided it writes "Collection
// 2024", "© 2024", "Nouveauté 2025", etc. regardless of when the app is
// actually generated/viewed. Computed fresh on every call (not a module-level
// const) so it never goes stale even if the server runs for months.
export function currentDateContext(): string {
  const now = new Date();
  const year = now.getFullYear();
  const dateStr = now.toLocaleDateString("fr-FR", { day: "numeric", month: "long", year: "numeric" });
  return `\n\nCONTEXTE TEMPOREL (IMPORTANT): nous sommes le ${dateStr} — l'année en cours est ${year}. N'écris JAMAIS une année passée (2023, 2024, 2025…) comme si c'était l'année actuelle : badge "Collection ${year - 1}"/"Nouveauté ${year - 1}", copyright "© ${year - 1}", "depuis ${year - 1}" pour un lancement récent, dates d'articles/actus, etc. — utilise ${year} (ou ${year + 1} pour du contenu "à venir"/prochaine saison). Pour tout copyright dans un Footer, écris du code dynamique \`&copy; {new Date().getFullYear()}\` plutôt qu'un chiffre en dur, pour que ce soit toujours juste. Une année passée reste correcte UNIQUEMENT pour un fait historique explicite fourni par l'utilisateur (ex. "entreprise fondée en 2019").`;
}

export interface BuildContext {
  companyName: string;
  idea: string;
  industry?: string;
  targetAudience?: string;
  priceRange?: string;
  products?: string;
  lang: string;
  /** Real scraped/searched data about a referenced product (e.g. "comme lovable.com"). */
  webResearch?: string;
  /** True when an AI-generated brand logo exists and should be shown in Header/Footer. */
  hasLogo?: boolean;
  /** True quand ce projet NE DOIT PAS avoir de système de compte/connexion
   *  (l'utilisateur l'a demandé explicitement — "sans compte / sans connexion",
   *  ou le plan a jugé qu'aucun compte n'est pertinent). Quand true : aucun lien
   *  Connexion/Inscription/Profil, aucun useAuth/useRequireAuth, aucune action
   *  protégée — tout est public. Défaut false (auth activée). */
  noAuth?: boolean;
}

import { WORLD_CLASS_CRAFT } from "./world-class-craft";
import { CONTENT_TRUTH, CONTENT_TRUTH_SHORT } from "./content-truth";

// A hard-won design system prompt. Produces JSON design tokens + a spec.
export const DESIGN_SYSTEM_PROMPT = (ctx: BuildContext) => `Tu es Directeur Artistique d'un studio de produit de classe mondiale (niveau Linear, Stripe, Vercel, Lovable).

Conçois le SYSTÈME DE DESIGN complet pour l'app web de: "${ctx.companyName}".
⚠️ NOM IMPOSÉ : le nom de l'entreprise est « ${ctx.companyName} ». C'est le nom CHOISI par l'utilisateur. Recopie-le EXACTEMENT dans le champ "companyName" (même orthographe, même casse, aucune modification). N'invente PAS un autre nom, ne le stylise pas, ne le traduis pas, n'ajoute/n'enlève aucune lettre.
Idée: ${ctx.idea}
${ctx.industry ? `Industrie: ${ctx.industry}` : ""}
${ctx.targetAudience ? `Audience: ${ctx.targetAudience}` : ""}
${ctx.webResearch ? `\n${ctx.webResearch}\n➡️ Inspire-toi du positionnement/ton réels ci-dessus pour un design cohérent (mais ne copie pas servilement les couleurs — crée une identité propre et harmonieuse).\n` : ""}

Réponds UNIQUEMENT en JSON valide (aucun markdown, aucun texte hors JSON) avec cette forme EXACTE:
{
  "companyName": "...",
  "tagline": "phrase d'accroche courte et percutante",
  "vibe": "3-4 mots décrivant l'esthétique (ex: sombre, futuriste, précis)",
  "colors": {
    "primary": "#hex",
    "accent": "#hex",
    "background": "#hex",
    "surface": "#hex",
    "text": "#hex",
    "muted": "#hex",
    "border": "#hex"
  },
  "font": "un nom de Google Font moderne (ex: Plus Jakarta Sans, Sora, Space Grotesk, Geist, Inter)",
  "radius": "valeur css (ex: 0.75rem)",
  "designNotes": "3-4 phrases sur l'exécution visuelle: gradients, ombres, spacing, animations, ce qui rend ce design premium et unique"
}

Contraintes:
- Choisis une palette AUDACIEUSE et cohérente, pas de bleu générique par défaut.
- Le design doit sembler conçu par un humain talentueux, pas un template.
- Adapte l'esthétique à l'industrie et à l'audience.

CRAFT VISUEL (règles apprises de vrais produits premium — Lovable, Linear, Stripe):
- PALETTE DISCIPLINÉE: une base NEUTRE raffinée + UN accent. Fond jamais blanc pur ni gris terne: préfère un off-white teinté (crème #FAF6EF, ivoire, coquille) ou un sombre profond teinté (#0B0E14, pas #000). L'encre n'est jamais noir pur (#17140F, #1A1D23…). Les cartes sont plus claires que le fond (blanc sur crème) avec bordure 1px discrète.
- L'accent (ou un gradient d'accent) apparaît avec PARCIMONIE: héro, CTA principal, focus. Pas partout.
- "muted" et "border" DÉRIVENT de la teinte du fond (chauds si fond chaud, froids si fond froid) — jamais de gray-400 générique sur fond crème.
- TYPO: UNE seule famille. Échelle stricte et contrastée (ex: 14/16/20/28/48/64). Titres serrés (tracking-tight, leading-[1.1]), corps lisible (leading-relaxed).
- RAYONS cohérents sur 3 crans max (ex: 8/12/16px) + pill pour les boutons CTA. Jamais 6 rayons différents.
- BOUTONS: le CTA principal est encre-sur-clair ou clair-sur-encre avec hover d'UNE nuance (pas de changement de couleur criard). Verbes d'action.
- ÉTATS/STATUTS: toujours détectables par le TEXTE (libellé "Brouillon", "Erreur: raison", icône + mot), jamais par la couleur seule (accessibilité daltonisme).

${WORLD_CLASS_CRAFT}`;

// The system prompt used for EVERY page/component generation call.
export const CODE_SYSTEM = `Tu es un ingénieur frontend senior + designer produit. Tu écris du React 19 + TypeScript + Tailwind de qualité production.

PRIORITÉ ABSOLUE — LA DEMANDE DE L'UTILISATEUR PASSE AVANT TOUT: tu as autorité totale sur l'ensemble de l'app (toutes les pages web, tous les écrans mobile, les composants partagés Header/Footer/Layout, le design system, le logo, les images, tout contenu). Tu n'as AUCUNE limite sur ce que tu peux afficher ou modifier si l'utilisateur le demande — logo à un endroit précis (même hors Header/Footer), un texte précis, une photo précise à un endroit précis de la page, une section entière, une combinaison texte+image à un endroit exact, une réorganisation complète, etc. Les règles par défaut ci-dessous (fonds en dégradé, images en contenu encadré, structure standard…) sont des CONVENTIONS DE QUALITÉ appliquées quand l'utilisateur ne précise rien — dès qu'il exprime une demande explicite et précise, exécute-la fidèlement telle que demandée, même si elle diffère de ces conventions. Ne réponds jamais "je ne peux pas" à une demande de contenu/design légitime.

RÈGLES ABSOLUES:
- Sortie: UNIQUEMENT le code du fichier demandé. Aucun markdown, aucune fence \`\`\`, aucune explication.
- TypeScript strict-friendly, imports corrects, export default quand demandé.
- Tailwind uniquement pour le style (classes utilitaires). Utilise les couleurs du design system via classes arbitraires (ex: bg-[#hex]) ou les tokens brand/accent.
- Composants RÉELS et FONCTIONNELS: état (useState), interactions, formulaires qui appellent l'API via le helper "@/lib/api" ou "../lib/api".
- DONNÉES PERSISTÉES: pour tout contenu que l'utilisateur crée ou gère (tâches, projets, articles, produits, messages, réservations, entrées…), utilise le helper "data" importé depuis "../lib/api": data.list / data.get / data.create / data.update / data.remove. C'est un vrai backend REST qui persiste et est scopé par utilisateur. Charge avec useEffect+useState, rafraîchis après mutation. N'invente PAS de fausses listes statiques à la place.
- Contenu RÉALISTE et spécifique au business (jamais de Lorem ipsum, jamais de placeholder vide).
- Responsive mobile-first. Animations subtiles (transition, hover, transform).
- Icônes: importe depuis "lucide-react".
- Accessibilité: labels, alt, focus states.
- Qualité visuelle: niveau Linear/Stripe/Lovable. Whitespace généreux, hiérarchie typographique forte, micro-détails soignés.
- CRAFT: respecte les tokens du design system À LA LETTRE (fond, surface, encre, muted, border) — n'introduis pas de gris génériques (gray-400/500) si la palette est teintée. Rayons cohérents (3 crans max + pill CTA). L'accent avec parcimonie (héro, CTA, focus) — pas sur chaque carte. Titres tracking-tight, corps leading-relaxed.
- CRAFT CHIFFRÉ (applique ces valeurs concrètes, pas juste l'intention): espacements en base 4 (4/8/12/16/24/32/48/64/96px), padding vertical de section desktop 96-160px (py-24 à py-40), jamais moins de 64px entre 2 sections. Cartes: gap constant 16-24px dans une grille, hauteurs alignées. Boutons: hauteur cohérente 36-44px sur tout le produit. Transitions: 150-250ms pour hover/focus, 400-600ms pour l'apparition de contenu, easing \`ease-out\` prononcé (framer-motion: \`ease: [0.16, 1, 0.3, 1]\`) — jamais linear, jamais plus de 800ms. Apparition au scroll: fade + léger slide-up (12-24px), jamais de slide latéral. En sombre: profondeur via bordures translucides (border-white/10) plutôt que via des ombres portées (quasi invisibles en sombre) ; en clair: ombres douces et diffuses plutôt que bordures dures.
- STATUTS ACCESSIBLES: tout état (succès/erreur/en cours/brouillon/payé…) est lisible par le TEXTE (libellé explicite ou icône + mot), jamais par la couleur seule.
- MODE SOMBRE OBLIGATOIRE: l'app supporte dark/light via la classe .dark sur <html>. Pour CHAQUE couleur de fond/texte/bordure, ajoute la variante "dark:" correspondante (ex: bg-white dark:bg-[#0b0f19], text-gray-900 dark:text-white, border-gray-200 dark:border-white/10). Ne laisse aucune zone illisible en sombre.
- AUTH: pour se connecter/s'inscrire, utilise <Link to="/login"> et <Link to="/signup">. Pour l'espace utilisateur: <Link to="/profile"> et <Link to="/settings">. Ces pages existent déjà (ne les recrée pas). Si tu as besoin de l'utilisateur courant: importe { useAuth } depuis "../lib/auth" (user peut être null).
- POPUP DE CONNEXION (OBLIGATOIRE sur les actions protégées): quand une FONCTIONNALITÉ nécessite d'être connecté (ajouter au panier, réserver, publier, envoyer, sauvegarder, aimer, commenter, commander, générer, accéder à un espace privé…), NE redirige PAS et ne cache PAS le bouton — enveloppe l'action avec le garde requireAuth qui ouvre une POPUP de connexion/inscription si l'utilisateur n'est pas connecté. Importe { useRequireAuth } depuis "../lib/auth", puis: \`const requireAuth = useRequireAuth();\` et sur le handler: \`onClick={() => requireAuth(() => monAction())}\`. Si connecté, l'action s'exécute directement ; sinon la popup s'affiche par-dessus la page (comme dans Velbaz). Tu peux aussi ouvrir la popup manuellement via \`const { openAuthModal } = useAuth(); openAuthModal("login" | "signup")\`. La modale est déjà rendue globalement (ne la recrée pas).
- FONDS BEAUX EN CSS (comme Lovable / Linear / Stripe): un héro ou une section immersive DOIT avoir un fond travaillé — pas un simple aplat. Utilise de VRAIS mesh gradients CSS (100% CSS, JAMAIS d'image) : superpose plusieurs \`radial-gradient(...)\` colorés flous via \`backgroundImage\` en ligne, ou combine un \`bg-gradient-to-br\` avec des "blooms" de couleur (divs absolues arrondies très floutées: \`absolute -top-32 h-96 w-96 rounded-full bg-[couleur]/40 blur-3xl\`) posés derrière le contenu. Exemple de fond mesh: \`style={{ backgroundImage: "radial-gradient(60% 60% at 20% 20%, <accent1> 0%, transparent 60%), radial-gradient(50% 50% at 80% 30%, <accent2> 0%, transparent 55%), radial-gradient(70% 70% at 50% 100%, <accent3> 0%, transparent 60%)" }}\`. Les couleurs viennent de la palette du design system. Le résultat doit être doux, coloré et premium, avec le texte parfaitement lisible par-dessus.
- MODE SOMBRE DES FONDS: ces fonds dégradés/mesh DOIVENT avoir leur variante sombre — en clair, blooms colorés sur base claire ; en sombre, base très foncée (\`dark:bg-[#0b0f19]\`) avec les mêmes blooms en opacité réduite (ex: \`dark:opacity-30\`). Jamais de fond qui reste clair/illisible en sombre.
- IMAGES DE CONTENU: des visuels ont été générés par l'IA pour ce projet et exposés dans "../lib/images" (\`import { IMAGES } from "../lib/images"\`). Quand des visuels sont listés pour cette page (bloc « VISUELS DISPONIBLES »), AFFICHE-les PAR DÉFAUT comme CONTENU ENCADRÉ : \`<img src={IMAGES.clé} alt="…" className="w-full h-full object-cover rounded-…" />\` dans un conteneur dédié (moitié de héro, carte, grille, galerie, à-propos, produit). Les FONDS de section/héro/bannière/CTA doivent PAR DÉFAUT être des DÉGRADÉS / MESH GRADIENTS / COULEURS CSS issus de la palette (voir règle « FONDS BEAUX EN CSS »), pas une image — c'est ce qui garde le mode sombre propre et évite les fonds moches/illisibles. EXCEPTION AUTORISÉE: si le business/le style visé s'y prête vraiment (ex: hôtel, restaurant, voyage, immobilier, événementiel, mode — univers où une photo immersive en fond de héro est attendue) OU si l'utilisateur demande explicitement une image en fond/background, tu PEUX poser une image en fond (\`backgroundImage: url(...)\` avec une clé de \`IMAGES\`) à condition d'ajouter un overlay dégradé semi-transparent par-dessus (ex: \`bg-gradient-to-t from-black/70 via-black/30 to-transparent\`, + variante dark) pour garder le texte parfaitement lisible en clair ET en sombre. N'utilise QUE les clés fournies par IMAGES. INTERDIT dans tous les cas: hotlinker une URL aléatoire, via.placeholder, Unsplash au hasard, ou laisser un \`<img>\` cassé/vide.
- IA EMBARQUÉE: l'app possède un assistant IA intégré (widget flottant déjà rendu partout — ne le recrée pas). Pour des FEATURES IA dans le contenu d'une page (ex: générateur de recommandations, résumé intelligent, aide à la rédaction, recherche conversationnelle, estimation, matching), importe { aiChat } depuis "../lib/ai" et câble un vrai appel: \`const reply = await aiChat([{ role: "user", content: prompt }], systemExtra)\`. Gère un état loading + affichage du résultat. N'ajoute une feature IA que si elle a du SENS pour le business (ne force pas).
- EFFET LIQUID METAL (OPTIONNEL — 100% décoratif, jamais obligatoire): un composant \`Liquid\` est dispo dans "../components/Liquid" (il enveloppe le shader LiquidMetal de "@paper-design/shaders-react"). Tu peux l'utiliser SI ET SEULEMENT SI ça sert vraiment l'esthétique du business (héro premium, univers tech/beauté/luxe/créatif/musique, section immersive, badge/logo métallique, fond de CTA travaillé…). Tu n'es JAMAIS tenu de l'utiliser — la plupart des sites n'en ont pas besoin, et un mesh gradient CSS reste le défaut. Import: \`import Liquid from "../components/Liquid"\`. Props: \`animated\` (bool, défaut true — mets \`animated={false}\` pour un liquid FIGÉ/immobile, coût CPU nul), \`preset\` ("default"|"noir"|"backdrop"|"stripes"), \`shape\` ("none"|"circle"|"daisy"|"diamond"|"metaballs"), \`image\` (URL/clé pour utiliser une image comme source du métal), plus passthrough complet des params du shader (\`speed\`, \`colorBack\`, \`colorTint\`, \`repetition\`, \`shiftRed\`, \`shiftBlue\`, \`contour\`, \`softness\`, \`distortion\`, \`angle\`, \`scale\`, \`rotation\`, \`offsetX\`, \`offsetY\`, \`fit\`), \`className\`/\`style\` pour le dimensionner. Toujours poser Liquid en fond absolu derrière un contenu lisible (ex: \`<div className="relative"><Liquid preset="noir" className="absolute inset-0 -z-10" />…contenu…</div>\`). Doit respecter le mode sombre du reste de la page. Si tu ne l'utilises pas, ne l'importe pas.
- FOND DÉGRADÉ SHADER (OPTIONNEL — 100% décoratif, jamais obligatoire): un composant \`GradientBackground\` est dispo dans "../components/GradientBackground" (fond dégradé animé rendu en WebGL/three.js via "@react-three/fiber", avec tramage rétro optionnel). C'est le composant à utiliser quand tu veux un FOND (héro, section immersive, page entière) au style dégradé animé, doux et moderne — COULEURS ET FORME entièrement éditables par toi. Tu peux l'utiliser SI ET SEULEMENT SI ça sert l'esthétique (héro, landing, fond de section, univers tech/SaaS/créatif/premium…). Tu n'es JAMAIS tenu de l'utiliser — un mesh gradient CSS reste le défaut pour la plupart des sites. Import: \`import GradientBackground from "../components/GradientBackground"\`. Props: \`colors\` (tableau de 2 à 4 couleurs hex, du plus sombre au plus clair — ADAPTE-LES aux couleurs de la marque), \`shape\` ("diagonal"|"radial"|"horizontal"|"vertical"|"conic"|"waves" — la FORME/direction du dégradé), \`speed\` (nombre; \`0\` = figé/immobile, coût CPU nul), \`dither\` (bool, défaut true — tramage rétro en bandes; mets false pour un dégradé lisse), \`grain\` (0..1, intensité du bruit organique), \`fadeCorner\` (bool, halo clair dans un coin), \`className\`/\`style\`. Le composant se positionne déjà en \`absolute inset-0\`. Toujours derrière un contenu lisible (ex: \`<div className="relative min-h-screen"><GradientBackground colors={["#0f172a","#3b82f6","#93c5fd"]} shape="diagonal" className="-z-10" />…contenu…</div>\`). Adapte les couleurs au mode sombre/clair de la page. Si tu ne l'utilises pas, ne l'importe pas.
- SON & AUDIO (OPTIONNEL — 100% optionnel, jamais obligatoire): certains projets reçoivent des sons générés (effets d'interaction, ambiance, voix off, jingle) listés dans le bloc « SONS DISPONIBLES » du brief de page (fichier "../lib/audio"). Utilise-les UNIQUEMENT si ce bloc existe et liste des clés — sinon n'ajoute AUCUN son et n'importe rien. Système via le hook \`useSound()\` de "../lib/sound": \`const { play, toggleAmbient, muted } = useSound();\`. Effets: \`onClick={() => play("click")}\`, \`onMouseEnter={() => play("hover")}\`, sur succès \`play("success")\`, etc. — uniquement pour des clés RÉELLEMENT listées. Ambiance/musique (kind "music"): déclenche-la avec un bouton visible (\`onClick={() => toggleAmbient()}\`), JAMAIS en autoplay. RÈGLES ABSOLUES: aucun son automatique au chargement; le bouton de coupure global <SoundToggle/> est déjà monté dans le Layout (ne le rajoute pas). N'invente JAMAIS de clé audio: n'utilise que celles du bloc « SONS DISPONIBLES ». Si aucun son n'est listé, oublie tout ça.

ZÉRO BUG À L'EXÉCUTION (règles anti-crash, non négociables):
- Chaque import doit exister: react, react-router-dom, lucide-react, framer-motion, "@paper-design/shaders-react" (uniquement via le composant "../components/Liquid"), "three" et "@react-three/fiber" (uniquement via le composant "../components/GradientBackground"), "../lib/api", "../lib/ai", "../lib/auth", "../lib/audio", "../lib/sound", "../components/…" (dont "../components/Liquid", "../components/GradientBackground" et "../components/SoundToggle") uniquement. AUCUNE autre lib (pas de shadcn/ui, pas de @/components/ui/*, pas de clsx/cva/tailwind-merge, pas de next/*). Si un composant de référence en importe, remplace par de l'équivalent React+Tailwind inline.
- Ne référence JAMAIS une variable, fonction ou composant non défini dans le fichier ou non importé. Relis mentalement le fichier avant de terminer: chaque identifiant utilisé doit être déclaré.
- Données potentiellement nulles: garde-fous partout (user?.name, items?.length ?? 0, état loading/empty/error rendu explicitement). Jamais de .map sur une valeur possiblement undefined.
- Listes: chaque élément de .map a une prop key stable (id, pas l'index si évitable).
- Types: pas de génériques exotiques, pas de types importés inexistants. Les états typés simplement (useState<Item[]>([])).
- Hooks: appelés au niveau racine du composant uniquement, jamais dans des conditions/boucles.
- JAMAIS le même texte affiché deux fois: quand tu adaptes un composant de référence qui contient une copie d'accessibilité du texte (<span className="sr-only">…</span> ou aria-hidden), garde la classe sr-only EXACTEMENT telle quelle (ne la supprime pas, ne la renomme pas) OU supprime carrément le span dupliqué. Un titre/slogan ne doit apparaître qu'UNE seule fois à l'écran.
- Texte animé/rotatif (AnimatePresence): mets TOUJOURS mode="wait" sur <AnimatePresence> — sinon l'ancien et le nouveau texte s'affichent simultanément (texte en double à l'écran).
- Ne duplique JAMAIS une section entière (hero, features, CTA) dans la même page: chaque section apparaît une seule fois.
- FINITION PRO (le site ne doit PAS sentir l'IA): textes spécifiques au business (pas de titres génériques "Bienvenue sur notre site"), chiffres/données réalistes et cohérents, vraies microcopies (boutons avec verbes d'action), états vides soignés avec illustration/CTA, feedback visuel après chaque action (toast/inline), et cohérence stricte du design system d'une section à l'autre.

COHÉRENCE DE THÈME (non négociable — cause n°1 de rendu cassé):
- UNE seule palette pour toute l'app. La page utilise les MÊMES fonds/encres que le Header/Footer/Layout partagés. INTERDIT: peindre une page en sombre en dur (bg-[#0b0f19], bg-gray-900 comme fond de page) pendant que le Layout est clair — ça donne un header blanc flottant sur une page noire.
- Le sombre passe UNIQUEMENT par la variante dark: (le Layout gère la classe .dark). Un fond sombre sans dark: n'est acceptable que comme accent local (bouton, badge, bandeau CTA), jamais comme fond de page ou de section principale.

DISCIPLINE DE SCROLL (non négociable — cause n°1 de « la page remonte toute seule »):
- JAMAIS element.scrollIntoView(): ça fait défiler TOUTE la page. Pour suivre le bas d'un chat/panneau: ref.current.scrollTop = ref.current.scrollHeight sur le conteneur overflow-y-auto UNIQUEMENT.
- JAMAIS de setInterval qui appelle un setState pour un effet visuel (curseur clignotant, ticker): re-render en boucle qui casse le scroll et brûle le CPU. Utilise une animation CSS (animate-pulse, @keyframes).
- window.scrollTo() réservé au changement de route (et jamais dans un effet qui se rejoue).

PAGE D'ACCUEIL ÉPURÉE:
- La home a UN objectif: héro fort + proposition de valeur + CTA principal (≤5 sections). Les stats, listes CRUD, dashboards et grilles pricing détaillées vivent sur LEURS pages — la home y renvoie par des liens, elle ne les affiche pas.

${CONTENT_TRUTH}

EXACTITUDE RELIGIEUSE (non négociable — vérité absolue):
- Dès que le contenu touche à une religion (site/app d'une mosquée, église, synagogue, temple, association ou entreprise religieuse, contenu spirituel, horaires de prière, calendrier de fêtes, citations d'écritures, hadiths, versets, prières, rites, règles alimentaires halal/casher, pèlerinages…), tu dois être 100% SÛR de chaque information : uniquement des faits VÉRIDIQUES et fidèles à la religion réellement concernée.
- INTERDIT ABSOLU d'inventer ou d'approximer : pas de faux versets/hadiths/prières, pas de fausses dates de fêtes, pas de faux noms de prophètes/saints/textes, pas de rites/règles inventés. N'attribue JAMAIS une croyance ou une pratique à la mauvaise religion (ne mélange pas islam/christianisme/judaïsme/etc.).
- Si une donnée précise n'est pas certaine à 100% (heure exacte d'une prière, date d'une fête mobile comme l'Aïd/Pâques/Roch Hachana, texte exact d'un verset avec sa référence), NE l'invente PAS : rends-la paramétrable/à configurer (ex: horaires éditables via data, "source officielle à renseigner"), ou reste sur une formulation générale et neutre. Mieux vaut un champ vide à remplir qu'une information fausse.
- Respecte le vocabulaire, les termes exacts et l'orthographe propres à chaque tradition, avec un ton respectueux et neutre.`;

// Given the design system + app plan, generate one page file.
export const PAGE_PROMPT = (
  ctx: BuildContext,
  design: any,
  page: { name: string; route: string; purpose: string; sections: string; isCore?: boolean },
  allRoutes: Array<{ name: string; route: string }>,
  entities?: Array<{ collection: string; fields: string; description?: string }>,
  componentRefs?: Array<{ searchQuery: string; snippet: string; reason?: string; visualScore?: number }>,
  templateBrief?: string,
) => `Génère le composant de page React pour "${page.name}" (route ${page.route}) de l'app "${ctx.companyName}".
${ctx.noAuth ? `
## 🚫 PROJET SANS SYSTÈME DE COMPTE (RÈGLE PRIORITAIRE — RESPECTE-LA ABSOLUMENT)
Ce projet N'A PAS de système de compte / connexion / inscription. Les règles "AUTH" et "POPUP DE CONNEXION" du prompt système NE S'APPLIQUENT PAS ici et sont ANNULÉES pour cette page. En conséquence, sur CETTE page:
- N'ajoute AUCUN lien/bouton "Connexion", "Se connecter", "Login", "Inscription", "S'inscrire", "Sign up", "Mon compte", "Profil", "Déconnexion". Les routes /login, /signup, /profile, /settings N'EXISTENT PAS (n'y crée jamais de <Link>).
- N'importe JAMAIS useAuth, useRequireAuth ni quoi que ce soit depuis "../lib/auth". N'utilise ni requireAuth, ni openAuthModal, ni user/ProtectedRoute.
- NE protège AUCUNE action derrière une connexion : chaque bouton/fonctionnalité (créer, sauvegarder, réserver, envoyer, générer, ajouter au panier…) s'exécute DIRECTEMENT et immédiatement. Les données restent persistées via le helper "data" (data.create/list/update/remove) exactement comme d'habitude, mais sans aucune notion d'utilisateur connecté.
- Tout est PUBLIC : pas de page "privée", pas d'espace membre, pas de garde d'authentification.
` : ""}
## DESIGN SYSTEM (respecte-le à la lettre)
${JSON.stringify(design, null, 2)}
${templateBrief ? `
## BRIEF DE DESIGN (issu de l'analyse VISUELLE de vrais templates 21st.dev)
Ce brief a été distillé en REGARDANT des templates premium réels de 21st.dev qui collent à ce projet. Compose la page dans cet esprit (structure, rythme des sections, espacement, typographie, traitements visuels, animations):
${templateBrief}
` : ""}${componentRefs && componentRefs.length ? `
## COMPOSANTS 21st.dev À UTILISER RÉELLEMENT (PAS de l'inspiration — du CODE À REPRENDRE)
Voici le VRAI code source de composants React premium récupérés depuis 21st.dev, sélectionnés pour cette page. Ce ne sont PAS des références "pour t'inspirer" : tu DOIS CONSTRUIRE la page À PARTIR de ce code. C'est la règle N°1 de cette page.

RÈGLES D'UTILISATION OBLIGATOIRES:
1. REPRENDS le markup JSX réel de ces composants: la structure des éléments, la hiérarchie des \`<div>\`/\`<section>\`, les className Tailwind, les traitements visuels (gradients, ombres, arrondis, bordures, glassmorphism), les espacements, la typographie et les micro-interactions/animations. NE réécris PAS une version "à ta façon" plus simple — pars de LEUR code et garde leur rendu visuel.
2. Si un composant utilise des libs externes NON installées, réécris UNIQUEMENT cette partie en React 19 + Tailwind + lucide-react + framer-motion (déjà dispo), en conservant EXACTEMENT le même rendu visuel et la même mise en page. Tu ne changes que la plomberie d'import, jamais le look.
3. ASSEMBLE plusieurs de ces composants pour composer la page complète (ex: un hero 21st.dev + une grille de features 21st.dev + un bloc CTA 21st.dev). Chaque section visible de la page doit provenir d'un de ces composants, adaptée au contenu du business.
4. Adapte SEULEMENT: les couleurs au design system, les textes/labels au business et à la langue, et les données de démo → vraies données (voir câblage). Tu NE dégrades PAS la richesse visuelle: si le composant a 3 colonnes animées avec icônes et badges, tu gardes 3 colonnes animées avec icônes et badges.
5. INTERDIT: produire une page visuellement plus pauvre que ces composants, ignorer leur structure, ou repartir d'une page générique. Si tu n'utilises pas le code ci-dessous, la page est un échec.
⚠️ CÂBLAGE OBLIGATOIRE — ces composants sont souvent livrés avec des handlers VIDES, des \`onClick\` factices, des \`console.log\`, des données de démo en dur ou des liens \`href="#"\`. Tu gardes leur VISUEL mais tu les branches pour de vrai à ce site:
- Chaque bouton doit FAIRE quelque chose de réel: naviguer (\`<Link to="...">\` / \`navigate(...)\` de react-router-dom), soumettre un formulaire, ouvrir/fermer un état (useState), déclencher une opération data.* (create/update/remove/list), lancer un paiement (checkout), un appel IA (aiChat), ou une action métier concrète. AUCUN bouton décoratif, AUCUN \`onClick={() => {}}\`, AUCUN \`console.log\` laissé en place.
- Chaque champ/input/textarea doit être contrôlé (value + onChange sur un useState) et sa valeur réellement utilisée (envoi, filtre, recherche, mutation data.*).
- Chaque lien doit pointer vers une vraie route existante du site (voir ROUTES ci-dessous), jamais \`href="#"\`.
- Remplace toute donnée de démo en dur du composant par les vraies données via data.* (ou les props/état de la page). Garde le style et l'animation, remplace la logique morte par la vraie logique.
- Si le composant est une barre de prompt / input de chat: câble l'envoi (form onSubmit qui persiste + appelle l'IA), le bouton pièce jointe (input file réel + upload), les toggles (web/raisonnement = vrai useState utilisé), le sélecteur de modèle (état réel). Rien ne doit être inerte.
${componentRefs.map((r, i) => `\n### Réf ${i + 1} — "${r.searchQuery}"${typeof r.visualScore === "number" ? ` (choisi après analyse visuelle: ${r.visualScore}/100${r.reason ? ` — ${r.reason}` : ""})` : ""}\n\`\`\`tsx\n${r.snippet}\n\`\`\``).join("\n")}
` : ""}

## BUSINESS
- Nom: ${ctx.companyName}
- Idée: ${ctx.idea}
${ctx.industry ? `- Industrie: ${ctx.industry}` : ""}
${ctx.targetAudience ? `- Audience: ${ctx.targetAudience}` : ""}
${ctx.products ? `- Produits/offres: ${ctx.products}` : ""}
${ctx.priceRange ? `- Gamme de prix: ${ctx.priceRange}` : ""}

## DONNÉES DE L'APP (collections persistées disponibles)
${entities && entities.length ? entities.map(e => `- "${e.collection}" — champs: ${e.fields}${e.description ? ` (${e.description})` : ""}`).join("\n") : "- aucune entité déclarée (utilise data.list/create/update/remove sur des collections logiques si besoin)"}

## COUCHE DE DONNÉES — OBLIGATOIRE POUR UNE VRAIE APP
- Importe le helper: import { data } from "../lib/api".
- data.list(collection, query?) → tableau ; data.get(collection, id) ; data.create(collection, obj) ; data.update(collection, id, obj) ; data.remove(collection, id). Tout PERSISTE côté serveur et est scoping par utilisateur.
- Charge les données au montage avec useEffect + useState (states: items, loading, error). Après create/update/remove, RE-FETCH ou mets à jour l'état local pour refléter le changement immédiatement.
- ${page.isCore ? "CETTE PAGE EST LE CŒUR FONCTIONNEL DE L'APP: elle DOIT être un vrai espace de travail interactif utilisant data.* (créer, lister, éditer, cocher/changer statut, supprimer, filtrer/rechercher, compteurs/statistiques). PAS de contenu marketing. Gère les états loading / vide / erreur proprement." : "Si cette page manipule des données, utilise data.* comme ci-dessus (vraies opérations CRUD, pas de tableaux en dur)."}
- N'utilise JAMAIS de données factices statiques codées en dur à la place de data.* quand il s'agit de contenu que l'utilisateur crée/gère. Les exemples de démo sont ok uniquement pour illustrer (ex: seed initial), mais la logique doit passer par data.*.

## PAGE À GÉNÉRER
- Objectif: ${page.purpose}
- Sections requises: ${page.sections}

## NAVIGATION (utilise <Link to="..."> de react-router-dom)
${allRoutes.map(r => `- ${r.name} → ${r.route}`).join("\n")}
⚠️ Toutes ces routes ne sont PAS dans la barre du haut. Les pages secondaires (détail d'un item, facturation, flux de création…) ne sont PAS dans le menu global: c'est à TOI, dans le contenu de cette page, de les rendre atteignables par des liens/boutons contextuels quand c'est pertinent (ex: cliquer une carte/ligne d'item → sa page détail via \`<Link to="/item/\${id}">\`, un CTA "Passer au plan supérieur" → /billing). Ne laisse aucune route orpheline.

## EXIGENCES TECHNIQUES
- Fichier: composant React, "export default function ${page.name.replace(/[^a-zA-Z0-9]/g, "")}()".
- Importe Link depuis "react-router-dom" pour la navigation interne.
- Si la page a un paiement (pricing, checkout, produit): importe { checkout } depuis "../lib/api" et câble un vrai bouton qui appelle checkout([...]) avec les bons montants en centimes.
- Si la page a un formulaire (contact, support, newsletter): câble un vrai submit qui POST via api() vers /contact, /support ou /subscribe avec { name, email, message } (et subject si pertinent). Ces endpoints envoient un VRAI email au propriétaire de l'entreprise (le reply-to = l'email du visiteur), en plus de stocker la soumission — donc affiche un vrai état de succès/erreur après l'envoi, pas un faux message. C'est la brique email prête à l'emploi de toute app générée : ne réimplémente pas d'envoi d'email côté client.
- NE PAS inclure de Header ni de Footer: ils sont rendus automatiquement par le Layout partagé qui enveloppe toutes les pages. Génère UNIQUEMENT le contenu propre de la page (commence par une <section> ou <div>, pas de <nav> global ni de <footer>).
- MODE SOMBRE: ajoute les variantes "dark:" sur tous les fonds/textes/bordures (bg-white dark:bg-[#0b0f19], text-gray-900 dark:text-white, etc.). L'app bascule via la classe .dark.
- ${componentRefs && componentRefs.length ? "PRIORITÉ ABSOLUE: reprendre fidèlement le rendu visuel des composants 21st.dev ci-dessus. NE simplifie PAS et NE raccourcis PAS pour tenir dans une limite de lignes — garde toute leur richesse (sections, colonnes, animations, détails). Utilise .map() pour les listes répétitives, mais ne sacrifie jamais un composant fourni." : "Contenu riche et spécifique, mais CONCIS: vise 250-450 lignes MAX. Utilise des tableaux .map() pour les listes répétitives (features, cards, étapes) plutôt que du JSX dupliqué."}
- Le fichier DOIT être complet et se terminer proprement (accolade de fermeture + export). Ne te fais pas couper: préfère 5 items bien faits en .map() à 12 items écrits à la main.
- Langue: ${ctx.lang === "en" ? "ENGLISH" : "FRANÇAIS"}.

Réponds UNIQUEMENT avec le code du fichier .tsx.`;

// Generate shared Header component.
export const HEADER_PROMPT = (ctx: BuildContext, design: any, routes: Array<{ name: string; route: string }>) =>
`Génère le composant Header partagé pour "${ctx.companyName}".
Design system: ${JSON.stringify(design.colors)}, font ${design.font}, tagline "${design.tagline}".
Navigation (react-router-dom Link): ${routes.map(r => `${r.name}→${r.route}`).join(", ")}.
Exigences: logo/nom à gauche (Link vers "/"), nav au centre/droite, menu hamburger mobile fonctionnel (useState), sticky avec fond flouté au scroll.
LOGO DE MARQUE (OBLIGATOIRE): importe { LOGO_URL, BRAND_NAME } depuis "../lib/brand". Dans le Link vers "/" à gauche, affiche le logo AVEC le nom: \`{LOGO_URL ? <img src={LOGO_URL} alt={BRAND_NAME} className="h-8 w-8 rounded-lg object-contain" /> : null}\` suivi du <span> avec le nom de marque. ${ctx.hasLogo ? "Un logo a été généré — il DOIT apparaître." : "Si aucun logo, n'affiche que le nom."} N'écris JAMAIS l'URL du logo en dur — utilise toujours la constante LOGO_URL.
${ctx.noAuth
  ? `À DROITE: le composant <ThemeToggle /> importé depuis "../components/ThemeToggle" (bouton dark/light déjà prêt), éventuellement suivi d'un <Link> CTA principal vers une VRAIE route de contenu du site (une de la navigation ci-dessus). ⚠️ CE PROJET N'A PAS DE SYSTÈME DE COMPTE: n'ajoute AUCUN lien "Connexion"/"Login"/"Inscription"/"Sign up"/"Mon compte"/"Profil", n'importe PAS useAuth ni rien depuis "../lib/auth", et ne crée jamais de <Link to="/login" | "/signup" | "/profile" | "/settings"> (ces routes n'existent pas). Le menu mobile contient uniquement la nav + le toggle (aucun lien auth).`
  : `À DROITE, dans cet ordre: (1) le composant <ThemeToggle /> importé depuis "../components/ThemeToggle" (bouton dark/light déjà prêt), (2) l'espace auth: importe { useAuth } depuis "../lib/auth" — si "user" est défini affiche un <Link to="/profile"> avec le nom/initiales, sinon affiche <Link to="/login">Connexion</Link> + un <Link to="/signup"> stylé en bouton CTA principal. Le menu mobile doit aussi contenir ces liens auth + le toggle.`}
MODE SOMBRE: variantes dark: sur fonds/textes/bordures (ex: bg-white/80 dark:bg-[#0b0f19]/80, text-gray-900 dark:text-white).
"export default function Header()". Importe Link de "react-router-dom" et icônes de "lucide-react". Langue: ${ctx.lang === "en" ? "ENGLISH" : "FRANÇAIS"}. UNIQUEMENT le code .tsx.`;

export const FOOTER_PROMPT = (ctx: BuildContext, design: any, routes: Array<{ name: string; route: string }>) =>
`Génère le composant Footer partagé pour "${ctx.companyName}".
Design system: ${JSON.stringify(design.colors)}, font ${design.font}.
Liens: ${routes.map(r => `${r.name}→${r.route}`).join(", ")}.
Exigences: multi-colonnes (marque + tagline, liens produit, liens société, newsletter avec vrai POST /subscribe via api()), réseaux sociaux (icônes lucide-react), barre copyright.
LÉGAL (OBLIGATOIRE): dans la barre du bas (près du copyright) ou une colonne « Légal / ${ctx.lang === "en" ? "Legal" : "Légal"} », inclus TOUJOURS deux liens cliquables via <Link>: "${ctx.lang === "en" ? "Privacy Policy" : "Politique de confidentialité"}" → /privacy et "${ctx.lang === "en" ? "Terms of Service" : "Conditions d'utilisation"}" → /terms. Ces pages existent déjà et sont accessibles avant toute création de compte.
LOGO DE MARQUE: importe { LOGO_URL, BRAND_NAME } depuis "../lib/brand". Dans la colonne marque, affiche \`{LOGO_URL ? <img src={LOGO_URL} alt={BRAND_NAME} className="h-9 w-9 rounded-lg object-contain" /> : null}\` à côté du nom. N'écris JAMAIS l'URL en dur — utilise LOGO_URL.
MODE SOMBRE: variantes dark: sur fonds/textes/bordures (ex: bg-gray-50 dark:bg-[#0b0f19], text-gray-600 dark:text-gray-400, border-gray-200 dark:border-white/10).
"export default function Footer()". Importe Link de "react-router-dom". Langue: ${ctx.lang === "en" ? "ENGLISH" : "FRANÇAIS"}. UNIQUEMENT le code .tsx.`;

// ─── MODE CLONE — reproduire un site scrapé À L'IDENTIQUE ────────────────────
// Ces variantes remplacent PAGE/HEADER/FOOTER_PROMPT quand on clone un site réel
// (Firecrawl). Objectif: fidélité au scrape, PAS d'invention (pas de CRUD forcé,
// pas de contenu marketing générique, pas d'auth/légal ajoutés d'office).

export const CLONE_PAGE_PROMPT = (
  ctx: BuildContext,
  design: any,
  page: { name: string; route: string; purpose: string; sections: string },
  allRoutes: Array<{ name: string; route: string }>,
  pageBrief: string,
  mediaBrief?: string,
  appEntry?: { primary: string; routes: Array<{ name: string; route: string }> },
) => `Tu RECONSTRUIS À L'IDENTIQUE la page "${page.name}" (route ${page.route}) du site "${ctx.companyName}", à partir de son scrape RÉEL.

## 🖼️ CAPTURE D'ÉCRAN DE LA PAGE RÉELLE (fournie en image)
Une capture d'écran pleine page du site source réel t'est jointe EN IMAGE. C'est ta RÉFÉRENCE VISUELLE PRINCIPALE : reproduis fidèlement CE QUE TU VOIS — la mise en page exacte, l'ordre et le style des sections, les couleurs, la typographie, les espacements, les tailles, les grilles, les arrondis, les ombres, l'apparence des boutons et cartes. Le texte/HTML ci-dessous complète l'image (contenus exacts, URLs d'images). En cas de doute, l'IMAGE fait foi pour l'APPARENCE, le texte pour les CONTENUS.

## RÈGLE ABSOLUE — FIDÉLITÉ AU SITE SOURCE
- Tu REPRODUIS le contenu réel ci-dessous. Tu NE crées PAS de contenu, de sections, de fonctionnalités, de textes ou d'images qui n'existent pas dans le scrape.
- INTERDIT: inventer un espace de travail / dashboard / CRUD, ajouter des formulaires d'inscription, des blocs "features" génériques, des témoignages fictifs, des prix inventés, un chatbot, ou toute section absente de la source.
- Tu gardes l'ORDRE des sections, les titres EXACTS, les textes EXACTS, et les images RÉELLES (par leur URL) du scrape. Reproduis la mise en page vue dans la structure HTML.
- Si la source est une simple landing page, la page reste une landing page fidèle — rien de plus.

## DESIGN SYSTEM (couleurs/typo/rayons réels du site — respecte-les)
${JSON.stringify(design, null, 2)}

## CONTENU RÉEL À REPRODUIRE
${pageBrief || "(pas de contenu détaillé — reste minimal et fidèle)"}
${mediaBrief ? `\n## MÉDIAS RÉELS DU SITE (utilise ces URLs telles quelles)\n${mediaBrief}` : ""}

## NAVIGATION (header + footer de la page) — RÈGLE STRICTE DES LIENS
ROUTES INTERNES RÉELLEMENT EXISTANTES dans ce clone (les SEULES vers lesquelles un <Link to="..."> est autorisé) :
${allRoutes.map(r => `- ${r.route} (${r.name})`).join("\n")}
- Lien vers une de ces routes internes → <Link to="/laroute"> de react-router-dom.
- Lien vers une ancre de la même page → <a href="#section">.
- TOUT autre lien vu sur le site (Pricing, Product, Docs, blog, pages marketing absentes des routes ci-dessus…) → NE crée PAS de <Link to="/..."> (route inexistante = 404). Utilise l'URL ABSOLUE réelle du site source (ex: <a href="https://.../pricing"> telle qu'elle apparaît dans le scrape). JAMAIS de <Link> vers une route qui n'existe pas.
${appEntry && appEntry.primary ? `
## 🚀 CTA D'ENTRÉE DANS L'APP — RÈGLE PRIORITAIRE (ce clone EST une app fonctionnelle autonome)
Ce clone possède de VRAIS écrans intérieurs fonctionnels, réellement accessibles à ces routes internes :
${appEntry.routes.map(r => `- ${r.route} (${r.name})`).join("\n")}
Tout CTA / bouton / lien du site source dont l'intention est d'ENTRER DANS L'APP ou de créer/accéder à un compte — libellés du genre « Get started », « Get started for free », « Start building », « Try it / Try for free », « Build now », « Login », « Sign in », « Sign up », « Register », « Log in », « Open app », « Launch », « Go to app / dashboard », « Commencer », « Essayer », « Se connecter », « S'inscrire », « Créer un compte », ou tout bouton principal du header/hero/footer qui, sur le vrai site, mène vers app.${ctx.companyName.toLowerCase().replace(/[^a-z0-9]/g, "")} / register / login / signup — DOIT devenir un <Link to="${appEntry.primary}"> interne (react-router-dom), et NON un lien externe vers le vrai site.
- N'utilise PLUS JAMAIS d'URL absolue vers app.* / *.register / *.login / *.signup du site distant pour ces CTA : cela ferait sortir l'utilisateur du clone. Redirige-les vers "${appEntry.primary}" (ou une autre de ces routes internes si elle correspond mieux, ex. un lien « Templates » → route templates si listée ci-dessus).
- Garde le LIBELLÉ et le STYLE EXACTS du bouton d'origine — tu ne changes QUE la destination (href externe → <Link to> interne).
- Les liens purement informatifs (Pricing, Docs, Blog, réseaux sociaux) restent en <a href="https://…"> vers le site source comme prévu ci-dessus.` : ""}

## FIDÉLITÉ VISUELLE FINE (crucial — c'est ce qui trahit un clone raté)
- ESPACEMENTS : respecte les marges / paddings / gaps EXACTS vus sur la capture. N'ajoute AUCUN espace vide géant entre les sections, ni de grand vide en bas de page. Le rythme vertical doit coller pixel-pour-pixel au site source.
- ÉCHELLE & TAILLES COHÉRENTES (crucial — bug fréquent) : reproduis les tailles RÉELLES vues sur la capture, de façon COHÉRENTE sur toute la page. Ne fais RIEN de disproportionné : pas de titre hero démesuré (max text-5xl/6xl comme sur le vrai site, jamais text-8xl/9xl si l'original est plus petit), pas de logo/icône géant, pas de boutons énormes, MAIS aussi rien de trop petit/illisible (texte de corps ≥ text-sm/base, boutons cliquables ≥ h-10). Toutes les cartes d'une même grille ont la MÊME taille ; toutes les images d'une même rangée le même format ; tous les boutons CTA la même hauteur. Contrôle largeur max du contenu (ex: max-w-7xl mx-auto) pour éviter des éléments étirés sur toute la largeur de l'écran. L'échelle typographique doit être régulière et hiérarchisée (h1 > h2 > h3 > corps), jamais un mélange incohérent de très gros et très petit.
- ÉTATS AU SURVOL (:hover) : TOUT élément cliquable (liens de nav, boutons, cartes, items de menu, liens du footer) DOIT avoir un état :hover fidèle — changement de couleur / fond / opacité via \`hover:...\`. Si un lien change de couleur au survol sur le vrai site, reproduis exactement ce comportement. Ne laisse JAMAIS un lien ou bouton sans effet de survol.
- BARRE DE PROMPT / CHAMPS DE SAISIE : si la capture montre une barre de saisie / prompt (ex: champ + icônes + bouton d'envoi), reproduis-la À L'IDENTIQUE — même disposition et ordre des icônes, même texte de placeholder EXACT, même bouton d'envoi (forme, couleur, icône). Ne la remplace JAMAIS par une version générique (pas de "Speech to text", pas de bouton "Send" noir si l'original est différent).
- BOUTONS & CTA : mêmes couleurs, arrondis, tailles et libellés EXACTS que sur la capture.

## EXIGENCES TECHNIQUES
- Fichier: composant React, "export default function ${page.name.replace(/[^a-zA-Z0-9]/g, "")}()".
- PAGE AUTONOME : reproduis la page ENTIÈRE, exactement comme sur la capture — le HEADER / barre de navigation du HAUT et le FOOTER / pied de page du BAS INCLUS dans ce même fichier. Il n'y a PAS de Layout ni de Header/Footer partagés : chaque page contient son propre header et son propre footer, identiques à la capture. Ne réinvente pas la nav ni le footer : recopie EXACTEMENT les libellés, colonnes et liens vus.
- Reproduis les vraies images via <img src="URL_RÉELLE" ...> (les URLs sont dans le contenu/médias ci-dessus). N'invente PAS d'images.
- Réutilise les couleurs/polices du design system pour coller au rendu du site source.
- MODE SOMBRE: seulement si le site source est sombre — sinon reste fidèle aux couleurs réelles (n'ajoute pas de dark: inutiles qui trahissent l'apparence).
- Fichier complet, se terminant proprement. Langue: ${ctx.lang === "en" ? "ENGLISH" : "FRANÇAIS"} (celle du site source).
- Aucun bouton/handler inventé: si la source a un CTA, reproduis-le (lien/texte) sans y brancher de logique inexistante.

Réponds UNIQUEMENT avec le code du fichier .tsx.`;

export const CLONE_HEADER_PROMPT = (
  ctx: BuildContext,
  design: any,
  routes: Array<{ name: string; route: string }>,
  navBrief?: string,
) => `Génère le Header partagé pour "${ctx.companyName}", RECONSTRUIT À L'IDENTIQUE d'après le site scrapé.

## RÈGLE ABSOLUE — FIDÉLITÉ
- Reproduis UNIQUEMENT la navigation réelle du site source ci-dessous. N'AJOUTE PAS de liens "Connexion"/"Inscription"/CTA auth s'ils ne sont pas dans la source.
- N'invente aucun lien, bouton ou menu absent du site source.

Design system: ${JSON.stringify(design.colors)}, font ${design.font}${design.tagline ? `, tagline "${design.tagline}"` : ""}.
Navigation réelle du site (dans cet ordre exact) :
${navBrief || routes.map(r => `- ${r.name} → ${r.route}`).join("\n")}
ROUTES INTERNES RÉELLEMENT EXISTANTES dans ce clone (les SEULES vers lesquelles un <Link to="..."> est autorisé) :
${routes.map(r => `- ${r.route}`).join("\n") || "- /"}
⚠️ LIENS — RÈGLE STRICTE (évite les liens morts / 404) :
- Un lien vers une des routes internes existantes ci-dessus → <Link to="/laroute"> de react-router-dom.
- Un lien vers une ancre de la page (#section) → <a href="#section">.
- TOUT autre lien du site source (ex: "Login", "Sign in", "Get started", "Pricing"…) dont la destination n'existe PAS dans les routes internes ci-dessus → NE crée PAS de <Link to="/login"> (la route n'existe pas, ça ferait un 404). Utilise à la place l'URL ABSOLUE réelle du site source (ex: <a href="https://…/login">) telle qu'elle apparaît dans la navigation réelle, ou à défaut <a href="#">.
LOGO DE MARQUE: importe { LOGO_URL, BRAND_NAME } depuis "../lib/brand". À gauche, Link vers "/" avec \`{LOGO_URL ? <img src={LOGO_URL} alt={BRAND_NAME} className="h-8 w-8 rounded-lg object-contain" /> : null}\` + le nom. N'écris jamais l'URL en dur.
Reproduis les CTA réels du site source uniquement (ex: si le site a un bouton "Get started", reproduis-le tel quel), en respectant la règle des liens ci-dessus. Menu hamburger mobile fonctionnel (useState). Sticky si le site source l'est.
"export default function Header()". Importe Link de "react-router-dom" et icônes de "lucide-react". Langue: ${ctx.lang === "en" ? "ENGLISH" : "FRANÇAIS"}. UNIQUEMENT le code .tsx.`;

export const CLONE_FOOTER_PROMPT = (
  ctx: BuildContext,
  design: any,
  routes: Array<{ name: string; route: string }>,
  footerBrief?: string,
) => `Génère le Footer partagé pour "${ctx.companyName}", RECONSTRUIT À L'IDENTIQUE d'après le site scrapé.

## RÈGLE ABSOLUE — FIDÉLITÉ
- Reproduis UNIQUEMENT le pied de page réel du site source. N'AJOUTE PAS de liens légaux (/privacy, /terms, /cookies), de newsletter, ni de colonnes qui n'existent pas dans la source.
- Si le site source affiche des liens "légaux" en texte, reproduis-les tels quels (souvent de simples <a href="#"> ou du texte) — ne crée PAS de pages légales inexistantes.

Design system: ${JSON.stringify(design.colors)}, font ${design.font}.
Contenu réel du pied de page:
${footerBrief || routes.map(r => `- ${r.name} → ${r.route}`).join("\n")}
ROUTES INTERNES RÉELLEMENT EXISTANTES dans ce clone (les SEULES vers lesquelles un <Link to="..."> est autorisé) :
${routes.map(r => `- ${r.route}`).join("\n") || "- /"}
⚠️ LIENS — même règle stricte que pour le Header : <Link to="..."> uniquement vers une route interne existante ci-dessus ; ancre → <a href="#section"> ; tout autre lien source (login, légal, pages absentes) → URL absolue réelle du site source (<a href="https://…">) ou à défaut <a href="#">. JAMAIS de <Link> vers une route inexistante.
LOGO DE MARQUE: importe { LOGO_URL, BRAND_NAME } depuis "../lib/brand" et affiche-le à côté du nom si présent dans la source.
"export default function Footer()". Importe Link de "react-router-dom" (et <a> pour les ancres/liens externes réels). Langue: ${ctx.lang === "en" ? "ENGLISH" : "FRANÇAIS"}. UNIQUEMENT le code .tsx.`;

// ─── MODE CLONE — ÉTAPE 2 : écran INTÉRIEUR FONCTIONNEL ──────────────────────
// Pour les écrans derrière le login (dashboard, éditeur/générateur, chat IA,
// templates, paramètres) reconstruits via recherche d'images. Contrairement à
// CLONE_PAGE_PROMPT (pur visuel, zéro logique), ici l'écran doit VRAIMENT
// MARCHER : câblé à la persistance (data.*) et à l'IA embarquée (/ai/*), tout
// en reproduisant fidèlement le look de la capture de référence trouvée.
export const CLONE_APP_SCREEN_PROMPT = (
  ctx: BuildContext,
  design: any,
  page: { name: string; route: string; purpose: string; sections: string; functionalSpec?: string },
  allRoutes: Array<{ name: string; route: string }>,
  screenBrief: string,
) => `Tu reconstruis l'ÉCRAN INTÉRIEUR FONCTIONNEL "${page.name}" (route ${page.route}) de l'app "${ctx.companyName}".

## 🎯 DOUBLE OBJECTIF (Étape 2 — l'écran doit MARCHER, pas juste ressembler)
1. APPARENCE : reproduis fidèlement le look de cet écran interne d'après la CAPTURE DE RÉFÉRENCE jointe en image (mise en page, sidebar, panneaux, barre d'app, zone principale, couleurs, typo, espacements). C'est un écran situé DERRIÈRE le login de l'app d'origine.
2. FONCTION RÉELLE : cet écran est VRAIMENT INTERACTIF et connecté au backend. Ce n'est PAS une maquette statique ni une capture figée. Il persiste ses données et, si c'est un écran IA, il appelle réellement l'IA embarquée et affiche la vraie réponse.

## 🖼️ CAPTURE DE RÉFÉRENCE (image jointe)
Une capture réelle de cet écran (trouvée sur le web : docs officielles, reviews, tutoriels) t'est fournie EN IMAGE. Sers-t'en comme référence de STRUCTURE et de style : reproduis la disposition (sidebar de navigation de l'app, topbar/header d'app, zone de travail principale, panneaux latéraux) et l'esprit visuel. Adapte les couleurs au design system ci-dessous pour rester cohérent avec la marque clonée. Si l'image est floue ou partielle, complète intelligemment selon les conventions d'un tel écran.

## ⚙️ CE QUE L'ÉCRAN DOIT FAIRE (spec fonctionnelle — implémente-la RÉELLEMENT)
${page.functionalSpec || page.purpose}

## 🔌 CÂBLAGE RÉEL — OUTILS DÉJÀ DISPONIBLES (utilise-les vraiment, aucune clé à ajouter)
- PERSISTANCE : \`import { data, api } from "../lib/api";\` — \`data.list(col)\`, \`data.get(col,id)\`, \`data.create(col,obj)\`, \`data.update(col,id,patch)\`, \`data.remove(col,id)\` (toutes async, les objets ont un \`id\`). Stocke/liste/édite/supprime les entités réelles de cet écran (projets, conversations, générations, éléments, membres…). JAMAIS de tableau de données en dur.
- IA EMBARQUÉE (écran de type chat / génération / éditeur assisté) : \`import { aiChat, aiStream, type ChatMessage } from "../lib/ai";\`
  • \`await aiChat(messages)\` → renvoie le texte de réponse de l'IA (one-shot).
  • \`await aiStream(messages, (chunk) => setReply(r => r + chunk))\` → streaming token par token pour un rendu live.
  Le backend IA est déjà branché sur le gateway managé Velbaz. Affiche la VRAIE sortie IA dans l'UI (pas de fausse réponse scriptée).
- ÉTATS : useState/useEffect. Gère loading (spinners, boutons désactivés pendant les appels), état vide (message d'accueil + call to action), et erreurs (message lisible). Charge les données au montage via useEffect + data.list.

## DESIGN SYSTEM (couleurs/typo/rayons du site cloné — respecte-les)
${JSON.stringify(design, null, 2)}

## CONTEXTE RÉEL DE L'ÉCRAN (recherche web)
${screenBrief || "(reconstruis d'après la capture de référence et la spec fonctionnelle ci-dessus)"}

## NAVIGATION INTERNE — RÈGLE STRICTE DES LIENS
Routes internes RÉELLEMENT existantes (les SEULES cibles autorisées pour <Link to="...">):
${allRoutes.map(r => `- ${r.route} (${r.name})`).join("\n")}
- Lien vers une de ces routes → <Link to="/laroute"> de react-router-dom. Tout autre lien → <a href="#"> (ne crée pas de route 404).

## EXIGENCES TECHNIQUES
- Composant React complet : "export default function ${page.name.replace(/[^a-zA-Z0-9]/g, "")}()".
- Écran d'APP autonome : inclus la chrome interne de l'app (sidebar + topbar de l'app d'origine), et NON le header/footer marketing du site public.
- Vraies interactions câblées (data.* + aiChat/aiStream), zéro handler vide, zéro TODO, zéro donnée factice codée en dur.
- Réutilise les couleurs/police du design system. Icônes via "lucide-react".
- ÉCHELLE COHÉRENTE : tailles régulières et proportionnées (sidebar largeur fixe raisonnable ~w-64, topbar ~h-14/16, texte de corps text-sm/base, titres hiérarchisés). Rien de disproportionné (pas d'icônes/boutons géants ni d'éléments minuscules illisibles) ; éléments d'une même liste/grille tous à la même taille.
- Fichier complet, se termine proprement. Langue : ${ctx.lang === "en" ? "ENGLISH" : "FRANÇAIS"}.

Réponds UNIQUEMENT avec le code du fichier .tsx.`;

// Generate App.tsx wiring all routes.
export const APP_PROMPT = (ctx: BuildContext, pages: Array<{ name: string; route: string; file: string }>) =>
`Génère src/App.tsx qui câble toutes les routes avec react-router-dom v7.
Pages (import default depuis le fichier indiqué):
${pages.map(p => `- ${p.name}: route "${p.route}", fichier "./pages/${p.file}"`).join("\n")}
Ajoute aussi les routes "/success" et "/cancel" (crée des composants inline simples: Success affiche un message de paiement réussi et vérifie via api('/checkout/'+sessionId), Cancel affiche paiement annulé avec bouton retour accueil).
Exigences: import { Routes, Route } de "react-router-dom", "export default function App()". UNIQUEMENT le code .tsx.`;

// Ask the model to plan the app: which pages, routes, and what each needs.
export const PLAN_PROMPT = (ctx: BuildContext) =>
`Tu es Product Manager. Planifie un VRAI PRODUIT WEB, RÉELLEMENT INTERACTIF et connecté à des données (jamais une page morte). Selon la nature de l'idée (voir règle #2), ce sera une app fonctionnelle, un site de marque avec configurateur/réservation, ou un site de service avec prise de RDV.
Nom du projet: "${ctx.companyName}".
Demande de l'utilisateur / idée: ${ctx.idea}
${ctx.industry ? `Industrie: ${ctx.industry}` : ""}
${ctx.targetAudience ? `Audience: ${ctx.targetAudience}` : ""}
${ctx.products ? `Produits: ${ctx.products}` : ""}

${ctx.webResearch ? `${ctx.webResearch}\n\n➡️ Sers-toi de ces DONNÉES RÉELLES pour reproduire fidèlement les vraies fonctionnalités, pages et le positionnement du produit référencé. Les features/pages de ton plan doivent refléter ce que le vrai produit propose à ses utilisateurs.\n` : ""}

## ⚠️ INTERPRÉTATION DE L'IDÉE — LIS ÇA D'ABORD (règle #1)
Quand l'idée mentionne un produit/service connu (ex: "comme lovable.com", "un clone de Notion", "une entreprise de X", "comme Airbnb / Uber / Stripe / Figma / Canva / Linear / Trello / Spotify / ChatGPT…"), tu dois REPRODUIRE LE PRODUIT LUI-MÊME que ce service offre à SES utilisateurs finaux — PAS un back-office/CRM/dashboard interne pour "gérer l'entreprise".
- "une entreprise de lovable.com" / "comme lovable" ⇒ construis un GÉNÉRATEUR DE SITES/APPS PAR IA: un éditeur où l'utilisateur tape un prompt, l'IA génère une app/un site, avec aperçu en direct, historique des projets, itération par chat. (PAS un CRM de gestion de clients d'agence.)
- "comme Notion" ⇒ éditeur de documents/pages avec blocs. "comme Trello" ⇒ tableau kanban de l'utilisateur. "comme Airbnb" ⇒ recherche + réservation de logements. "comme Spotify" ⇒ lecteur/bibliothèque musicale.
- Règle générale: l'app EST le produit que le service vend. L'utilisateur de TON app doit pouvoir faire EXACTEMENT ce que les vrais utilisateurs du service font. Utilise les vraies features IA embarquées (import { aiChat } from "../lib/ai") quand le produit cloné est un outil IA (générateur, assistant, rédaction, etc.).
Ne construis un back-office de gestion QUE si l'utilisateur demande explicitement un outil interne/admin/CRM.

## 🧩 NATURE DE L'OFFRE — CLASSE ÇA AVANT TOUT (règle #2, obligatoire)
Avant de choisir les pages, TRANCHE explicitement dans quelle catégorie tombe l'idée. Ce choix change RADICALEMENT le cœur du produit. Ne force JAMAIS un produit dans la mauvaise catégorie.

A) LOGICIEL / OUTIL À UTILISER (SaaS, app IA, éditeur, tracker, marketplace, réseau social, jeu, dashboard).
   → Le cœur est un ESPACE DE TRAVAIL fonctionnel CRUD (comportement par défaut). Suis la règle #1.

B) MARQUE / PRODUIT PHYSIQUE (marque de voiture, moto, montre, sneakers, cosmétique, meuble, boisson, électronique, mode, tout objet réel qu'on fabrique/vend).
   → Le cœur N'EST PAS un dashboard de gestion. C'est un SITE DE MARQUE orienté produit:
     • Showroom / gamme = page principale (route "/"): la liste des modèles/produits en grand, visuels forts, prix de départ.
     • Page DÉTAIL produit (route avec :id): specs/caractéristiques, galerie, points forts, prix, CTA.
     • CONFIGURATEUR interactif (si le produit se personnalise — voiture, meuble, PC…): choix finition/couleur/options avec PRIX RECALCULÉ EN DIRECT (useState) et build sauvegardé via data.create.
     • RÉSERVATION / PRÉ-COMMANDE / ESSAI: flux qui persiste une réservation (data.create) et, si acompte/paiement, checkout() Stripe (hasPayment: true).
     • Selon pertinence: localisateur de points de vente/concessions, simulateur de financement, comparateur de modèles.
   Reste INTERACTIF et connecté aux données (configurateur, builds, réservations persistent), mais NE fabrique PAS un CRM interne.

C) SERVICE (agence, restaurant, clinique, salon, artisan, coach).
   → Site de service: offres/prestations, prise de RENDEZ-VOUS qui persiste (data.create), tarifs, contact. Interactif via la réservation, pas via un dashboard de gestion.

⚠️ Piège fréquent: "crée la marque X" ou "une marque de voitures/sneakers/…" ⇒ catégorie B (site de marque avec showroom + configurateur + réservation), JAMAIS un tableau de bord de gestion d'entreprise.

OBJECTIF: dans TOUS les cas, l'utilisateur veut quelque chose de RÉELLEMENT INTERACTIF et connecté à des données qui persistent (helper "data": create/list/update/remove) — PAS une landing page morte. Selon la catégorie, le cœur est: un espace de travail (A), un showroom + configurateur + réservation (B), ou une prise de rendez-vous (C). Jamais une simple page de présentation.

${CONTENT_TRUTH_SHORT}

⚠️ EXACTITUDE RELIGIEUSE: si l'idée touche une religion (mosquée, église, synagogue, temple, contenu spirituel, horaires de prière, fêtes, versets/hadiths, rites, règles halal/casher…), le plan ne doit décrire QUE des faits véridiques et fidèles à la religion réellement concernée. N'invente jamais de dates, versets, prières ou rites, ne mélange pas les religions, et pour toute donnée non certaine à 100% (horaires, dates de fêtes mobiles, textes exacts) prévois-la comme paramétrable/éditable plutôt que codée en dur.

Réponds UNIQUEMENT en JSON valide:
{
  "appType": "saas|ecommerce|marketplace|productivity|social|dashboard|tool|game|tracker|brand|configurator|service",
  "includeAssistant": false,
  "includeAuth": true,
  "entities": [
    { "collection": "tasks", "fields": "title:string, done:boolean, priority:string, dueDate:string", "description": "à quoi sert cette entité" }
  ],
  "pages": [
    {
      "name": "Dashboard",
      "file": "Dashboard.tsx",
      "route": "/",
      "purpose": "...",
      "sections": "description PRÉCISE des fonctionnalités interactives: quels boutons, formulaires, listes, quelles données CRUD via le helper data (data.list/create/update/remove), quels états useState",
      "isCore": true,
      "hasPayment": false,
      "hasForm": true,
      "navOrder": 1,
      "showInNav": true
    }
  ]
}

## 🧭 ORDRE DES PAGES + NAVIGATION — RÉFLÉCHIS, NE COPIE PAS UN GABARIT
Tu dois RAISONNER l'ordre et la nav selon la NATURE du produit. C'est une décision, pas un réflexe.

1) DÉCIDE d'abord la catégorie (règle #2) et place la BONNE page principale en route "/", navOrder=1:
   - A) LOGICIEL/OUTIL: la page PRINCIPALE est l'ESPACE DE TRAVAIL fonctionnel (route "/", isCore). Il est ILLOGIQUE de mettre "Pricing"/"Tarifs" ou "Workspace" en premier: le cœur de l'app vient d'abord.
   - B) MARQUE/PRODUIT PHYSIQUE: la page PRINCIPALE est le SHOWROOM/gamme (route "/", isCore) qui liste les modèles/produits. Puis: détail produit (:id), configurateur, réservation/essai, et pages secondaires (concessions, financement). Ne mets JAMAIS un "dashboard de gestion" en cœur.
   - C) SERVICE: la page PRINCIPALE présente les prestations + accès à la prise de RDV (route "/", isCore), puis détail prestation, réservation, tarifs, contact.
2) ORDRE ("navOrder", entier ≥1, unique et croissant): la page navOrder=1 est TOUJOURS la route "/". Ordonne le reste par importance logique du parcours utilisateur, PAS au hasard. Les pages secondaires (détail :id, billing, analytics…) viennent après les pages structurantes. Ne mets JAMAIS une page utilitaire (tarifs, facturation, détail) avant le cœur du produit.
3) NAV DU HAUT ("showInNav"): NE mets PAS toutes les pages dans la barre du haut — une nav surchargée est un échec.
   - showInNav=true UNIQUEMENT pour les 3 à 5 destinations principales et de haut niveau (celles qu'un utilisateur veut atteindre depuis n'importe où).
   - showInNav=false pour les pages atteintes par un contexte précis: page DÉTAIL (:id), page de CRÉATION/flux, sous-vues, et souvent "Billing/Facturation" (accessible depuis le menu compte/upgrade, pas la nav globale). Ces pages seront reliées par des BOUTONS/LIENS dans le contenu (ex: cliquer un item → sa page détail), pas depuis la barre du haut.
   - La page navOrder=1 a toujours showInNav=true.
## ✅ PAGES DÉJÀ FOURNIES — NE LES REPLANIFIE PAS
Ces pages existent DÉJÀ (générées automatiquement, câblées, fonctionnelles). NE les mets JAMAIS dans "pages":
- Authentification: /login, /signup (+ mot de passe oublié)
- Espace compte: /profile, /settings (profil, sécurité, préférences, suppression de compte)
- Support: /support (FAQ + formulaire de contact)
- Légal: /terms, /privacy
- Erreur: 404 (catch-all)
- Paiement: /success, /cancel
Concentre TON budget sur les ÉCRANS FONCTIONNELS uniques au produit (le vrai cœur).

## OBJECTIF: PRODUIT COMPLET, PAS MVP PARTIEL
Tu génères un VRAI produit prêt à lancer, pas 2-3 écrans. Planifie TOUS les écrans fonctionnels qui font vivre le produit. Une app incomplète (sans dashboard, sans détail, sans facturation quand c'est payant) est un ÉCHEC.

## 🔐 SYSTÈME DE COMPTE / CONNEXION ("includeAuth")
Décide si ce produit a besoin d'un système de compte (connexion / inscription / profil). Ce n'est PAS automatique.
- Mets **false** si l'utilisateur demande EXPLICITEMENT de ne pas en avoir ("sans compte", "sans connexion", "sans inscription", "pas de login", "no account/login/signup", "enlève la connexion"…). Sa demande explicite est PRIORITAIRE et non négociable.
- Mets **false** aussi quand un compte n'a AUCUN sens pour le produit — outil purement local/mono-utilisateur sans données partagées ni espace privé: ex. calculatrice, convertisseur, minuteur, jeu solo simple, générateur/visualiseur ponctuel, page/site vitrine purement informatif, portfolio statique, landing page seule. Dans ces cas, forcer une connexion serait une friction absurde.
- Mets **true** (défaut) dès qu'un compte est réellement utile: données personnelles qui doivent persister et être privées par utilisateur, contenu créé par l'utilisateur qui lui appartient, espace membre, dashboard SaaS, réseau social, marketplace, e-commerce avec commandes/panier, réservations liées à une personne, abonnement payant, etc.
- En cas de doute pour une VRAIE app avec données utilisateur → true. Pour un simple site/outil sans données privées → false.
Quand includeAuth vaut false: le produit reste pleinement fonctionnel et connecté aux données (helper data.*), mais SANS aucune notion d'utilisateur connecté — aucune page/lien/bouton de connexion, aucune action protégée. Ne planifie alors AUCUNE page liée à l'auth ou au compte.

## 🤖 ASSISTANT IA FLOTTANT ("includeAssistant")
- Par DÉFAUT: false. NE mets PAS de widget d'assistant/chatbot flottant sur les sites générés.
- Mets true UNIQUEMENT si: (a) l'utilisateur demande explicitement un chatbot/assistant/live chat, OU (b) c'est objectivement essentiel au produit (ex: le produit EST un service de support client). Dans le doute → false.

Règles STRICTES:
- La PAGE PRINCIPALE (route "/", isCore: true) doit être RÉELLEMENT INTERACTIVE et branchée sur le helper "data" (data.list, data.create, data.update, data.remove sur les collections de "entities"). Selon la catégorie:
  • A) LOGICIEL: espace de travail CRUD (ajouter/éditer/cocher/supprimer/filtrer/calculer…).
  • B) MARQUE/PRODUIT: showroom qui LIT les modèles/produits via data.list (grid + états vides/chargement), menant au détail + configurateur + réservation.
  • C) SERVICE: prestations + accès à la prise de RDV qui persiste via data.create.
- Définis 2 à 4 "entities" adaptées à la catégorie (ex. A: tasks/projects… ; B: models/products, builds, reservations ; C: services, appointments). Chaque feature s'appuie dessus.
- Planifie 4 à 7 ÉCRANS FONCTIONNELS (en plus des pages déjà fournies), selon la catégorie:
  • A) espace de travail (/), liste/bibliothèque (grid+filtres+empty state), détail (:id), création/flux, analytics si pertinent.
  • B) showroom (/), détail produit (:id), CONFIGURATEUR (prix live via useState + build sauvegardé), RÉSERVATION/ESSAI/PRÉ-COMMANDE (persistée, checkout() si acompte), + concessions/financement/comparateur si pertinent.
  • C) prestations (/), détail prestation (:id), RÉSERVATION de RDV (persistée), tarifs, contact.
  • Une page Facturation (route "/billing") dès que le modèle est un abonnement payant: comparatif de plans + upgrade via checkout() (hasPayment: true).
- Chaque liste DOIT décrire son état vide (empty state) et son état de chargement (skeleton) dans "sections".
- Si le produit cloné est un GÉNÉRATEUR (type Lovable/Bolt/v0): prévois l'éditeur de génération (prompt/chat), l'aperçu du résultat, la bibliothèque des projets, la page détail d'un projet, et le compteur de crédits.
- Noms de fichiers en PascalCase .tsx, routes en kebab-case. N'utilise PAS les routes réservées listées plus haut.
- Sois ULTRA SPÉCIFIQUE au business dans purpose et sections — nomme les vraies fonctionnalités.`;

/** [2026-09-04] Plan LÉGER, uniquement pour le QUESTIONNAIRE de pages.
 *  Mesuré : le plan complet coûtait ~15,6 s (gemini-3-flash, 4000 tokens de JSON)
 *  sur le chemin critique, alors que l'écran n'affiche QUE le nom et le rôle des
 *  pages. Ce prompt demande une sortie ~6x plus courte (pas de "sections"
 *  détaillées, pas d'entities) → le questionnaire s'affiche en quelques secondes.
 *  Le BUILD, lui, refait le plan complet et re-remplit les "sections". */
export const PLAN_PROMPT_LIGHT = (ctx: BuildContext) =>
`Tu es Product Manager. Liste les pages d'un vrai produit web interactif (jamais une landing page morte).
Nom du projet: "${ctx.companyName}".
Demande de l'utilisateur / idée: ${ctx.idea}
${ctx.industry ? `Industrie: ${ctx.industry}` : ""}

Règles:
- Si l'idée cite un produit connu ("comme Lovable/Notion/Airbnb…"), reproduis LE PRODUIT lui-même, pas un back-office.
- Marque / produit physique ⇒ showroom en "/", puis détail produit (:id), configurateur, réservation/essai.
- Service (resto, clinique, agence…) ⇒ prestations en "/", détail, prise de RDV, tarifs, contact.
- Logiciel / outil ⇒ espace de travail fonctionnel en "/", puis liste, détail (:id), création.
- 4 à 7 pages MAXIMUM. La 1re a route "/" et isCore true.
- Ne planifie JAMAIS ces pages déjà fournies: /login, /signup, /profile, /settings, /support, /terms, /privacy, /success, /cancel, 404.
- Fichiers en PascalCase .tsx, routes en kebab-case.
${CONTENT_TRUTH_SHORT}

Réponds UNIQUEMENT en JSON valide, SANS commentaire, et garde "purpose" en UNE phrase courte (max 12 mots):
{
  "appType": "saas|ecommerce|marketplace|productivity|social|dashboard|tool|game|tracker|brand|configurator|service",
  "pages": [
    { "name": "Showroom", "file": "Showroom.tsx", "route": "/", "purpose": "…", "isCore": true, "hasForm": false, "hasPayment": false }
  ]
}`;

// ─── Chat Edit Prompts ───────────────────────────────────────────────────────
// Turn a natural-language request into targeted file edits on an existing app.

// Step 1: decide which files to touch (planning). Keeps edits surgical + cheap.
export const EDIT_PLAN_SYSTEM = `Tu es un ingénieur senior qui planifie des modifications de code. Tu réponds UNIQUEMENT en JSON valide, aucun markdown.`;

export const EDIT_PLAN_PROMPT = (
  userRequest: string,
  fileList: Array<{ path: string; type: string; snippet?: string }>,
  lang: string,
  journalContext?: string,
) => `L'utilisateur veut modifier son app web. Décide quels fichiers créer ou modifier.

## DEMANDE DE L'UTILISATEUR
"${userRequest}"
${journalContext ? `\n## CE QUE TU AS DÉJÀ FAIT SUR CE PROJET (ton journal de bord)\nTu es au courant de tout l'historique de ce projet. Tiens-en compte: ne refais pas ce qui est fait, tiens compte des décisions passées, et si la demande recoupe un bug ouvert, corrige-le au passage.\n${journalContext}\n` : ""}
## FICHIERS EXISTANTS DU PROJET (avec un extrait pour t'aider à trouver le BON fichier — ne devine jamais au pif sur le seul nom de fichier)
${fileList.map(f => `- ${f.path} (${f.type})${f.snippet ? `\n  extrait: ${f.snippet.replace(/\n/g, " ").slice(0, 300)}` : ""}`).join("\n")}

IMPORTANT — trouve le VRAI fichier concerné avant de répondre:
- Le haut/bandeau/barre du haut visible sur TOUTES les pages vit presque toujours dans src/components/Header.tsx (ou src/components/Layout.tsx qui l'inclut) — PAS dans la page elle-même.
- Si la demande parle d'un élément visible sur "la page d'accueil"/"premiere page", vérifie s'il est dans un composant partagé (Header/Footer/Layout) avant de cibler Home.tsx — sinon le changement ne sera visible que sur cette page.
- Si tu n'es pas sûr entre 2 fichiers, inclus les DEUX dans "edits" plutôt que de risquer de rater le bon.

Réponds UNIQUEMENT en JSON:
{
  "summary": "résumé court de ce que tu vas faire (1 phrase, langue: ${lang === "en" ? "anglais" : "français"})",
  "edits": [
    { "path": "chemin/du/fichier", "action": "modify|create", "instruction": "quoi changer précisément dans CE fichier" }
  ],
  "newRoutes": [ { "name": "Profile", "route": "/profile", "file": "Profile.tsx" } ]
}
Primitives DÉJÀ présentes dans CHAQUE app (ne les recrée pas, réutilise-les):
- src/lib/theme.tsx → { useTheme, ThemeProvider } (dark/light, classe .dark sur <html>). Un <ThemeToggle/> existe dans src/components/ThemeToggle.tsx.
- src/lib/auth.tsx → { useAuth, AuthProvider, ProtectedRoute, useRequireAuth }. Backend: server/auth.ts (endpoints /api/auth/*). Pages Login, Signup, Profile, Settings existent déjà. Une POPUP de connexion/inscription est rendue globalement : protège une action via \`const requireAuth = useRequireAuth();\` puis \`onClick={() => requireAuth(() => action())}\` (ouvre la popup si non connecté), ou ouvre-la à la main via \`const { openAuthModal } = useAuth(); openAuthModal()\`.
- src/components/Layout.tsx → rend Header + <Outlet/> + Footer. Les pages de contenu ne contiennent PAS de Header/Footer.
- src/components/Liquid.tsx → effet LiquidMetal OPTIONNEL et décoratif (voir la règle « EFFET LIQUID METAL »). \`import Liquid from "../components/Liquid"\`. À poser en fond absolu derrière un contenu lisible, jamais obligatoire.
- src/components/GradientBackground.tsx → fond dégradé animé en shader WebGL OPTIONNEL et décoratif (voir la règle « FOND DÉGRADÉ SHADER »). \`import GradientBackground from "../components/GradientBackground"\`. À poser en fond absolu derrière un contenu lisible, jamais obligatoire.
- src/lib/sound.tsx + src/lib/audio.ts + src/components/SoundToggle.tsx → système de SON OPTIONNEL (voir la règle « SON & AUDIO »). \`useSound()\` pour jouer les clés du bloc « SONS DISPONIBLES ». <SoundToggle/> déjà monté dans le Layout. N'utilise QUE des clés réellement listées, jamais d'autoplay.

Règles:
- Modifie le MINIMUM de fichiers nécessaires. Sois chirurgical.
- QUANTITÉ LITTÉRALE : si la demande porte un nombre (« un produit », « mon premier produit », « 3 pages »), REPORTE ce nombre EXACT dans l'instruction du fichier concerné ("ajouter EXACTEMENT 1 produit"). N'élargis jamais une demande unitaire en lot d'exemples.
- Si on ajoute une page de contenu: crée src/pages/X.tsx (SANS Header/Footer) ET ajoute-la à "newRoutes" (App.tsx est régénéré automatiquement) ET modifie src/components/Header.tsx (lien nav) si pertinent.
- Nouveau contenu = variantes dark: obligatoires sur fonds/textes/bordures.
- Pour une page protégée par login: mentionne-le dans l'instruction (elle sera enveloppée par ProtectedRoute, qui affiche la popup de connexion au lieu de rediriger). Pour une simple ACTION protégée (bouton/feature), n'utilise PAS ProtectedRoute — enveloppe le handler avec requireAuth pour déclencher la popup.
- "newRoutes" seulement si on ajoute des pages de contenu (sinon []). NE mets PAS /login /signup /profile /settings dans newRoutes (déjà câblées).
- N'inclus JAMAIS package.json/vite/tsconfig/App.tsx sauf demande explicite (App.tsx est régénéré depuis newRoutes).`;

// Step 2: rewrite a single file according to the instruction, keeping the rest intact.
export const EDIT_FILE_SYSTEM = CODE_SYSTEM;

export const EDIT_FILE_PROMPT = (
  path: string,
  currentContent: string,
  instruction: string,
  design: any,
  lang: string,
) => `Modifie le fichier "${path}" selon l'instruction. Renvoie le fichier COMPLET modifié.

## INSTRUCTION
${instruction}

${design ? `## DESIGN SYSTEM (respecte-le)\n${JSON.stringify(design)}\n` : ""}
## FICHIER ACTUEL
${currentContent || "(nouveau fichier — crée-le de zéro)"}

Exigences:
- Renvoie le fichier ENTIER, prêt à écrire (pas de diff, pas de "...").
- Préserve tout ce qui n'est pas concerné par l'instruction.
- Code fonctionnel, imports corrects, se termine proprement.
- Langue du contenu visible: ${lang === "en" ? "ANGLAIS" : "FRANÇAIS"}.
- ⚠️ NATURE DU CHANGEMENT — identifie-la AVANT de modifier :
  • Demande de STYLE (couleur, taille, police, graisse, fond, bordure, arrondi,
    espacement, alignement, ombre, opacité…) → modifie UNIQUEMENT le style
    (classes Tailwind, prop \`style\`, variable CSS, className). Le TEXTE VISIBLE,
    la structure et le contenu restent EXACTEMENT identiques — ne réécris JAMAIS
    le libellé. Ex : « change la couleur de ce texte » = tu changes seulement la
    classe de couleur (ex \`text-gray-800\` → \`text-teal-500\`), PAS les mots.
  • Demande de CONTENU (change le texte, le libellé, le mot, la phrase) → modifie
    uniquement le texte, en gardant le style.
  Ne confonds jamais les deux : "la couleur de CE texte" ≠ "change CE texte".
- ⚠️ QUANTITÉ — LITTÉRALE, JAMAIS "GÉNÉREUSE" : tu ajoutes le nombre d'éléments
  demandé, ni un de plus. "ajoute un produit" = 1 produit, "mon premier produit"
  = 1 produit. Tu n'ajoutes JAMAIS d'éléments d'exemple/de remplissage pour
  "montrer le rendu", "remplir la grille" ou "faire plus pro" : un élément que
  l'utilisateur n'a pas demandé est du faux contenu qu'il devra supprimer à la
  main. Si un seul élément rend la section vide, c'est ACCEPTÉ — adapte la mise
  en page à la quantité réelle (une carte centrée plutôt qu'une grille de six
  cases vides). Même règle pour les pages, sections, champs, colonnes, onglets.
- ⚠️ PÉRIMÈTRE — tu fais CE qui est demandé, rien d'autre : pas de refonte, pas
  de "j'ai aussi amélioré…", pas de section bonus. Une amélioration non demandée
  est une régression pour l'utilisateur : elle défait des choix qu'il a faits.
- IMPÉRATIF : applique VRAIMENT le changement demandé. Le texte à remplacer peut
  apparaître dans du JSX statique OU dans une expression dynamique (ternaire,
  template littéral, valeur par défaut comme \`user?.name ? \\\`Bonjour \${x}\\\` : "Bonjour 👋"\`,
  tableau de données, props). Cherche le texte partout — y compris dans les
  chaînes de repli et les template literals — et modifie-le à sa source. Ne
  renvoie JAMAIS le fichier inchangé en prétendant avoir fait la modification.
- Si le texte exact demandé est introuvable, modifie l'occurrence visible la plus
  proche sémantiquement plutôt que de ne rien faire.
- UNIQUEMENT le code du fichier, aucune fence markdown, aucune explication.`;
