// ─── MOTEUR /genesis ─────────────────────────────────────────────────────────
// Pipeline de raisonnement discipliné en 8 phases, imposé AVANT toute
// génération visuelle, pour sortir l'IA de son « premier réflexe » générique.
//
// Principe (spec Velbaz — « Moteur /genesis ») :
//   La précision du résultat final est proportionnelle à la précision du texte
//   intermédiaire écrit avant la génération. On force donc l'écriture des
//   phases 1→4 (stratégie, sensoriel, saut créatif, scene graph) AVANT le
//   moindre appel d'image, puis on génère en multi-variantes (5), on critique
//   avec un évaluateur STRICTEMENT ISOLÉ (6), on décide le découpage (7) et on
//   compile une spec de précision exécutable par l'agent de code (8).
//
// Règles dures :
//   - Aucune phase sautée, aucun appel visuel avant la fin de la phase 4.
//   - Max 3 cycles de critique, max 4 variantes par élément porteur.
//   - L'évaluateur ne partage JAMAIS le contexte du générateur (nouvel appel,
//     aucune mémoire de conversation, il ne reçoit que rendu + intention).
//   - Journalisation complète de chaque phase pour analyse a posteriori.

import { generateText } from "ai";
import { gateway } from "./agent/gateway";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { generateContentImage } from "./builder/images";
import { runWithAiContext, newRunId } from "./ai-usage/context";

// ── Modèles ────────────────────────────────────────────────────────────────
// Phases de raisonnement : modèle fort. Phase 3 (saut créatif) : température
// haute. Évaluateur : modèle multimodal, appel isolé.
// Textuel = gpt-5.4-mini (choix utilisateur : ~3x plus rapide). La VISION reste
// inchangée : mini n'est pas utilisé pour analyser les images.
const THINK_MODEL = "openai/gpt-5.4-mini";
const CREATIVE_MODEL = "openai/gpt-5.4-mini";
const FAST_MODEL = "openai/gpt-5.4-mini";
const VISION_MODEL = "google/gemini-3-flash";

const PHASE_TIMEOUT_MS = 180_000;

// ── Référence de CALIBRAGE DU JUGEMENT (phases 4bis et 6) ──────────────────
// ATTENTION — RÈGLE ABSOLUE : cette image ne doit JAMAIS être passée au
// générateur d'images, ni citée comme direction artistique à reproduire. Elle
// n'entre que dans les appels d'ÉVALUATION, et seulement pour calibrer UNE
// question : chaque zone du cadre a-t-elle été décidée, ou flotte-t-elle par
// défaut ? Ni sa taille d'éléments, ni sa palette, ni son sujet n'ont de valeur
// d'exemple. Une composition minuscule et discrète peut valoir autant.
const JUDGE_CALIBRATION_REF: string[] = (() => {
  const candidates = [
    `${process.cwd()}/packages/web/public/genesis-refs/intentionality-calibration.png`,
    `${process.cwd()}/public/genesis-refs/intentionality-calibration.png`,
  ];
  for (const f of candidates) {
    try {
      const buf = readFileSync(f);
      return [`data:image/png;base64,${buf.toString("base64")}`];
    } catch { /* fichier absent : on continue sans référence */ }
  }
  console.error("[genesis] référence de calibrage du jugement introuvable — le juge travaille sans étalon d'intentionnalité");
  return [];
})();

/**
 * Encadrement de la référence de calibrage, injecté dans les appels du juge.
 * Il dit explicitement ce qu'il faut en tirer (l'intentionnalité) et ce qu'il
 * est INTERDIT d'en tirer (taille, palette, sujet, mise en page).
 */
const CALIBRATION_NOTE = `IMAGE DE CALIBRAGE (la seconde image fournie) — lis bien son usage :
Ce n'est PAS une direction artistique, PAS un modèle de composition, PAS une palette
à retrouver, PAS une échelle d'éléments à comparer. Son sujet, ses couleurs et la
taille de ses éléments n'ont AUCUNE valeur d'exemple. Ne reproche jamais à la
maquette jugée de ne pas ressembler à cette image.
Le SEUL principe à en tirer, pour étalonner ta sévérité : dans cette image, chaque
partie du cadre semble avoir été DÉCIDÉE — rien n'y flotte sans raison, aucun vide
n'y est un vide par défaut. C'est la question que tu poses à la maquette jugée :
est-ce que chaque zone, y compris chaque zone vide, est habitée par une décision
(tension, alignement, cadrage, rapport d'échelle, respiration voulue), ou est-ce
que des éléments et des vides sont simplement posés là ?
Une composition minimaliste, aux éléments petits et discrets, peut satisfaire ce
principe aussi bien qu'une composition monumentale.`;

export const GENESIS_MAX_CRITIQUE_CYCLES = 3;
export const GENESIS_MAX_VARIANTS = 4;
/** Nombre maximum de retouches SÉQUENTIELLES sur une même base de maquette. */
export const GENESIS_MAX_MOCKUP_TRIES = 2;
/** Nombre maximum de rounds de variantes parallèles pour la maquette. */
export const GENESIS_MAX_MOCKUP_ROUNDS = 1;
/** Plafond dur du nombre d'images de maquette rendues sur un run.
 *  Passé de 11 à 4 : les runs r9-r13 montrent que la meilleure maquette sort
 *  presque toujours du premier round parallèle, les rendus 5 à 11 ne servaient
 *  qu'à confirmer un échec en coûtant une image et deux passes de vision. */
export const GENESIS_MAX_MOCKUP_RENDERS = 4;
/** Nombre de variantes rendues dans le round parallèle de maquette. */
export const GENESIS_MOCKUP_BATCH = 3;

export interface GenesisPhaseLog {
  phase: number;
  title: string;
  output: string;
  ms: number;
}

export interface GenesisCritique {
  cycle: number;
  elementId: string;
  variant: number;
  concept: number;
  coherence: number;
  aiSignature: number;
  sensory: number;
  average: number;
  verdict: "ACCEPTER" | "RÉGÉNÉRER AVEC AJUSTEMENTS" | "RÉGÉNÉRER ENTIÈREMENT";
  fixes: string[];
  raw: string;
}

export interface GenesisAsset {
  elementId: string;
  role: "background" | "element" | "cutout" | "mockup";
  url: string;            // data URI webp
  prompt: string;
  variant: number;
  score?: number;
  segmented?: boolean;
}

/** Une proposition de maquette soumise au choix de l'utilisateur. */
export interface GenesisChoiceOption {
  id: string;
  url: string;
  score: number;
  label: string;
}

/** Réponse de l'utilisateur au choix de maquette. */
export type GenesisChoiceReply =
  | { kind: "pick"; id: string }
  | { kind: "more"; prompt: string };

/** Délai laissé à l'utilisateur pour choisir une maquette. Passé ce délai, le
 *  moteur reprend la main sur le meilleur score plutôt que de rester bloqué. */
export const GENESIS_CHOICE_TIMEOUT_MS = 600_000;
/** Nombre maximum de tours de choix (1 planche + 3 « autre chose »). */
export const GENESIS_MAX_CHOICE_ROUNDS = 4;

const pendingChoices = new Map<string, (r: GenesisChoiceReply) => void>();

/** Vrai si le run attend actuellement un choix de l'utilisateur. */
export function hasPendingGenesisChoice(runId: string): boolean {
  return pendingChoices.has(runId);
}

/** Transmet le choix de l'utilisateur au run en attente. Faux si rien n'attend. */
export function submitGenesisChoice(runId: string, reply: GenesisChoiceReply): boolean {
  const resolve = pendingChoices.get(runId);
  if (!resolve) return false;
  pendingChoices.delete(runId);
  resolve(reply);
  return true;
}

export type GenesisEvent =
  | { type: "start"; runId: string; brief: string }
  | { type: "phase_start"; phase: number; title: string }
  | { type: "phase_done"; phase: number; title: string; output: string; ms: number }
  | { type: "asset"; asset: GenesisAsset }
  | { type: "critique"; critique: GenesisCritique }
  | { type: "note"; text: string }
  | { type: "choice"; runId: string; question: string; options: GenesisChoiceOption[]; canAskMore: boolean; round: number }
  | { type: "choice_done"; runId: string; picked: string | null }
  | { type: "done"; runId: string; result: GenesisResult }
  | { type: "error"; message: string };

export interface GenesisMockup {
  url: string;          // data URI webp de la maquette d'écran complète
  prompt: string;
  attempt: number;
  score: number;        // moyenne du verdict design (0-10)
  accepted: boolean;
  verdict: string;      // texte brut du juge
  fixes: string[];
  /** Sous-scores du juge design. photo = -1 quand le critère est sans objet. */
  subs?: { composition: number; typography: number; photo: number; anti_generic: number; hierarchy: number; interface: number };
  /** Numéro du round de variantes (1 = génération initiale parallèle). */
  round?: number;
  /** Rang de la variante dans son round. */
  variant?: number;
  /** Annotations de travail (px, %, cotes, repères) relevées DANS l'image par
   *  le contrôle automatique du moteur. Non vide = rendu disqualifié. */
  annotations?: string[];
  /** Vrai quand c'est l'utilisateur qui a cliqué cette proposition. */
  chosenByUser?: boolean;
}

export interface GenesisResult {
  runId: string;
  brief: string;
  /** Nom de marque décidé en Phase 1 et verrouillé pour tout le run. */
  brandName: string;
  /** Logotype décidé par le moteur (dessin + règle d'usage), verrouillé. */
  brandIdentity: string;
  /** Corrections du juge restées non appliquées sur la maquette conservée. */
  pendingFixes: string[];
  positioning: string;
  sensory: string;
  association: string;
  interaction: string;    // contrat d'interaction (JSON sérialisé)
  sceneGraph: any;
  assetPlan: string;
  assets: GenesisAsset[];
  critiques: GenesisCritique[];
  segmentation: string;
  /** Systeme de design extrait de la maquette retenue (JSON serialise).
   *  Verrouille et applique a TOUTES les pages du site. */
  designSystem: string;
  spec: string;
  mockups: GenesisMockup[];
  mockup: GenesisMockup | null;   // maquette retenue (meilleur score)
  phases: GenesisPhaseLog[];
  degraded: boolean;      // seuil de qualité non atteint après 3 cycles
  weaknesses: string[];   // note interne (mode debug uniquement)
  durationMs: number;
}

// ── Appel LLM isolé (aucun historique partagé entre phases) ────────────────
async function call(opts: {
  model: string;
  system: string;
  prompt: string;
  maxTokens: number;
  temperature?: number;
}): Promise<string> {
  const run = async (modelId: string) => {
    const res = await generateText({
      model: gateway(modelId),
      system: opts.system,
      prompt: opts.prompt,
      maxOutputTokens: opts.maxTokens,
      ...(opts.temperature !== undefined ? { temperature: opts.temperature } : {}),
      maxRetries: 1,
      abortSignal: AbortSignal.timeout(PHASE_TIMEOUT_MS),
    });
    return (res.text || "").trim();
  };
  try {
    const out = await run(opts.model);
    if (out) return out;
    throw new Error("empty output");
  } catch (e) {
    console.warn("[genesis] modèle", opts.model, "KO →", (e as Error).message, "— repli", FAST_MODEL);
    return await run(FAST_MODEL);
  }
}

// Nettoyage tolérant : virgules traînantes, commentaires, etc.
function softClean(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "")
    .replace(/,(\s*[}\]])/g, "$1");
}

// Referme un JSON tronqué : on coupe après la dernière valeur complète puis on
// referme les accolades/crochets encore ouverts. Indispensable quand le modèle
// atteint la limite de tokens au milieu du Scene Graph.
function closeTruncatedJson(src: string): string {
  const stack: string[] = [];
  let inStr = false, esc = false, lastSafe = -1;
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (inStr) {
      if (esc) esc = false;
      else if (c === "\\") esc = true;
      else if (c === '"') { inStr = false; lastSafe = i; }
      continue;
    }
    if (c === '"') { inStr = true; continue; }
    if (c === "{" || c === "[") stack.push(c === "{" ? "}" : "]");
    else if (c === "}" || c === "]") { stack.pop(); lastSafe = i; }
    else if (c === "," || /[0-9a-z]/i.test(c)) lastSafe = i;
  }
  let out = src.slice(0, lastSafe + 1).replace(/,\s*$/, "");
  // Une clé sans valeur en fin de chaîne : on la supprime.
  out = out.replace(/,?\s*"[^"]*"\s*:\s*$/, "");
  for (let i = stack.length - 1; i >= 0; i--) out += stack[i];
  return out;
}

function extractJson(raw: string): any {
  const fence = raw.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const body = fence ? fence[1] : raw;
  const start = body.indexOf("{");
  if (start === -1) throw new Error("aucun JSON trouvé dans la sortie");
  const end = body.lastIndexOf("}");
  const candidates = [
    end > start ? body.slice(start, end + 1) : "",
    end > start ? softClean(body.slice(start, end + 1)) : "",
    closeTruncatedJson(softClean(body.slice(start))),
  ].filter(Boolean);
  let lastErr: unknown = null;
  for (const c of candidates) {
    try { return JSON.parse(c); } catch (e) { lastErr = e; }
  }
  throw new Error("JSON illisible : " + (lastErr as Error)?.message);
}

// ═══════════════════════════════════════════════════════════════════════════
// PROMPTS SYSTÈME — repris mot pour mot de la spec du moteur /genesis.
// Ne pas « améliorer » ces textes : leur formulation exacte fait le travail
// anti-générique (ex. la question du mot interdit en phase 1).
// ═══════════════════════════════════════════════════════════════════════════

const P1_SYSTEM = `Tu es en train de définir le positionnement stratégique d'une marque à partir
d'une seule phrase fournie par l'utilisateur. Tu dois répondre aux questions
suivantes, dans cet ordre, en 2-4 phrases denses par question. N'invente rien
qui contredit ce que l'utilisateur a dit, mais comble tous les vides avec des
décisions fermes et spécifiques — jamais de formulations vagues du type
"pourrait être" ou "quelque chose comme".

1. QUI est le client de cette marque ? (âge approximatif, style de vie,
   ce qu'il valorise déjà avant de connaître la marque)
2. QUEL problème ou désir cette marque résout-elle, très précisément —
   pas en termes marketing génériques ("qualité", "innovation") mais en
   termes concrets et vécus ?
3. CONTRE quoi cette marque se positionne-t-elle ? Quelle est l'alternative
   ennuyeuse, générique ou dépassée qu'elle refuse d'être ? (Ce point est
   critique : une marque sans opposition claire produit un visuel sans tension,
   donc sans intérêt.)
4. Si cette marque était une personne à une soirée, comment se comporterait-elle ?
   Est-ce qu'elle parle fort ou observe en silence ? Est-elle sérieuse ou joueuse ?
   Est-ce qu'elle cherche à impressionner ou à mettre les autres à l'aise ?
5. Quel est le SEUL mot que cette marque interdirait dans sa propre communication
   si elle pouvait bannir un mot de son vocabulaire (ex : "premium", "innovant",
   "révolutionnaire") — et pourquoi ce mot serait un aveu de faiblesse pour elle ?

Ne produis AUCUNE mention de couleur, de police, de style visuel ou de composition
à ce stade. Cette phase est purement stratégique. Toute intrusion visuelle ici est
une erreur de méthode.

Budget de sortie : 300 mots maximum.

TERMINE ta réponse par cette ligne, seule sur la dernière ligne, sans guillemets :
NOM_DE_MARQUE: <le nom commercial de la marque, 1 à 3 mots>
Ce nom est un ENGAGEMENT DÉFINITIF : il sera utilisé tel quel, à la lettre, dans
toutes les phases suivantes et sur toutes les images. Choisis-le donc maintenant
avec soin (prononçable, cohérent avec le pays et le positionnement) et n'en
propose qu'un seul, sans variante ni alternative.`;

const BRAND_IDENTITY_SYSTEM = `Tu es directeur de l'identité visuelle. On te donne un nom de marque déjà arrêté. Tu décides son LOGOTYPE : le dessin exact du nom, tel qu'il sera reproduit à l'identique sur toutes les pages du site.

Tu réponds en 6 lignes, sans préambule, sans commentaire, format exact :
CARACTERE : la nature du caractère typographique du logotype (par exemple : didone à fort contraste, grotesque industriel très serré, antique à empattements coupés, monospace technique). Jamais un nom de fonte commerciale, une description de dessin.
CASSE : capitales / bas de casse / capitales et bas de casse, et pourquoi ce choix dit quelque chose de la marque.
TRACAGE : serré, normal ou très ouvert, et le rythme entre les lettres.
SIGNE : soit AUCUN (le nom seul fait le logo), soit un signe graphique simple décrit précisément (forme géométrique, position par rapport au nom, taille relative). Si tu hésites, choisis AUCUN — un mot bien dessiné vaut mieux qu'un pictogramme de plus.
USAGE : comment le logotype se pose dans la barre de navigation (alignement, taille relative au reste de la barre) et dans le pied de page.
INTERDITS : deux ou trois choses que ce logotype ne fait jamais (dégradé, ombre, contour, inclinaison, badge autour, etc.).

Contrainte : le logotype doit être dessinable dans une capture d'écran de site, à petite taille, et rester lisible. Rien de décoratif pour le plaisir.`;

const P2_SYSTEM = `À partir du positionnement de marque établi à la phase précédente, traduis-le
en un registre sensoriel concret. Réponds à chaque point avec des mots physiques
et précis — jamais des adjectifs creux comme "beau", "moderne", "élégant" seuls,
sans les ancrer dans quelque chose de concret et vérifiable.

1. LUMIÈRE : D'où vient-elle ? Quelle heure du jour ou quelle absence de jour
   suggère-t-elle ? Est-elle dure ou diffuse ? Une seule source ou plusieurs ?
2. TEMPÉRATURE DE COULEUR : Chaude, froide, ou un contraste délibéré entre les
   deux ? Donne 2-3 couleurs de référence en langage courant (pas de hex encore),
   et explique pourquoi ces couleurs et pas d'autres, en lien avec la Phase 1.
3. MATIÈRE : Si ce site était un objet physique qu'on pourrait toucher, ce
   serait quelle matière ? (verre froid, tissu brossé, pierre polie, papier
   texturé, métal brossé...) Cette matière doit transparaître dans les choix
   de texture, d'ombre, de bordures.
4. RYTHME DE MOUVEMENT : Est-ce que les éléments du site bougent lentement et
   pesamment, ou vite et légèrement ? Y a-t-il une pause dramatique quelque
   part, ou un flux continu sans interruption ?
5. DENSITÉ : Le site est-il aéré avec beaucoup d'espace vide (silence visuel),
   ou dense et chargé d'information (énergie visuelle) ? Ceci doit découler
   directement du "comportement social" défini en Phase 1 point 4.
6. UN SEUL ÉLÉMENT SENSORIEL SIGNATURE : Choisis UNE seule caractéristique
   sensorielle distinctive qui, si un utilisateur voyait juste cet élément
   sans rien d'autre, lui ferait reconnaître cette marque parmi cent autres.
   Ce doit être spécifique, pas générique.

Ne mentionne aucun objet concret de composition (pas de "un casque au centre",
pas de "un logo en haut à gauche") — ceci reste un registre sensoriel abstrait,
la composition concrète arrive à la Phase 4.

Budget de sortie : 250 mots maximum.`;

const P3_SYSTEM = `Tu vas maintenant chercher une métaphore physique ou une association d'idées
éloignée qui va devenir le concept central de l'expérience du site — pas juste
sa décoration, mais littéralement ce que l'utilisateur va FAIRE sur le site.

Étape A — Génère 6 associations éloignées : prends l'objet ou le service au
cœur de cette marque (Phase 1) et associe-le à 6 éléments totalement extérieurs
à son domaine habituel : un élément naturel (météo, matière, animal,
phénomène physique), un mouvement du corps humain, un instrument ou objet du
quotidien sans lien évident, un son, une texture, et un phénomène temporel
(saison, heure, cycle). Pour chaque association, écris une seule phrase qui
relie l'objet à cet élément de façon inattendue mais pas absurde — la connexion
doit être justifiable une fois énoncée, même si elle n'était pas évidente avant.

Étape B — Élimine les 4 associations les plus prévisibles ou déjà vues
(vérifie mentalement : est-ce que cette association existe déjà comme cliché
dans ce secteur ? Si oui, élimine-la). Il doit rester 2 associations.

Étape C — Choisis UNE association finale parmi les 2 restantes, celle qui
peut se traduire en une INTERACTION concrète sur le site (pas juste une image
statique, mais un geste utilisateur — scroll, swipe, clic, hover — qui imite
ou prolonge cette association physique).

Étape D — Décris cette interaction en une séquence physique précise : que se
passe-t-il exactement quand l'utilisateur fait le geste ? Quel élément bouge,
dans quelle direction, avec quelle vitesse relative, et qu'est-ce qui apparaît
ou disparaît en conséquence ?

Contrainte stricte : l'association choisie ne doit JAMAIS être la plus évidente
de la liste de 6. Si en te relisant l'association choisie te semble être ce
qu'un designer débutant aurait proposé en premier réflexe, recommence l'étape C
avec l'autre candidate.

Contrainte anti-repetition : si une BANQUE DES PROJETS DEJA REALISES t'est
fournie, elle est prioritaire sur tout le reste. Aucune association de la meme
famille qu'une entree de la banque ne peut survivre a l'etape B, meme dans un
autre secteur. Ecris explicitement, apres l'etape C, la ligne « ECART A LA
BANQUE : … » qui dit en quoi l'association retenue n'y appartient pas.

Termine ta reponse par cette derniere ligne, exactement dans ce format, sans
rien apres :
ASSOCIATION_RETENUE: <objet de la marque> x <element associe> — <mecanique en 6 mots maximum>

Budget de sortie : 450 mots maximum.`;

const P3B_SYSTEM = `Tu transformes le concept de la phase 3 en CONTRAT D'INTERACTION : le
mécanisme réel par lequel l'utilisateur traverse le site. C'est le cœur du
mode /genesis — on ne dessine pas une page, on invente une MACHINE qu'on
regarde ensuite en image.

Point de départ obligatoire : une landing page qui défile verticalement,
section après section, est le réflexe par défaut. Tu ne peux la choisir QUE si
tu écris explicitement pourquoi aucun autre mécanisme ne sert mieux le concept.
Dans tous les autres cas, choisis un mécanisme porteur dans ce catalogue (ou
invente-en un de même nature, aussi précis) :

- STAGE FIXE / PAS DE SCROLL : le viewport est verrouillé, un objet unique
  flotte au centre, la navigation se fait au geste latéral (swipe, drag,
  flèches, molette horizontale) et l'objet sort du cadre pour être remplacé
  par le suivant. Les informations secondaires vivent dans les marges.
- ORBITE CURSEUR : rien ne défile, tout réagit à la position de la souris —
  parallaxe multi-couches, rotation de l'objet, lumière qui suit le pointeur.
- SCROLL DÉTOURNÉ : le scroll vertical pilote autre chose que le déplacement
  (rotation d'un objet, avancée d'une timeline horizontale, morphing d'une
  matière, zoom continu dans une image).
- CARTE / PLAN LIBRE : la page est un espace 2D qu'on déplace en le tirant,
  les contenus sont posés à des coordonnées, il n'y a ni haut ni bas.
- RÉVÉLATION PAR MASQUE : le curseur ou le geste efface une couche pour
  révéler celle du dessous.
- CHAPITRES PLEIN CADRE VERROUILLÉS : chaque cran de scroll saute d'un plan
  plein écran au suivant, avec transition de matière, jamais de demi-écran.

Tu dois répondre en JSON strict, sans texte autour :

{
  "mechanic_name": "nom court et parlant du mécanisme",
  "navigation_model": "no-scroll-stage | cursor-orbit | hijacked-scroll | free-canvas | mask-reveal | locked-chapters | vertical-scroll",
  "why_this_one": "2 phrases reliant le mécanisme au concept de la phase 3 et au positionnement de la phase 1",
  "resting_state": "ce que l'utilisateur voit AVANT de toucher quoi que ce soit : objet central, échelle, position exacte, ce qu'il y a dans les marges",
  "input_map": [
    { "input": "swipe gauche | drag | mousemove | wheel | click | touch | clavier", "effect": "ce qui bouge exactement, dans quelle direction, sur quelle distance, en combien de ms, avec quel easing" }
  ],
  "state_machine": "les états successifs et ce qui déclenche le passage de l'un à l'autre (ex : repos → sortie de l'objet 380ms → entrée du modèle suivant 420ms → repos)",
  "content_traversal": "comment l'utilisateur accède à TOUT le contenu du site avec ce seul mécanisme (produits, à propos, contact) — aucun contenu ne doit devenir inatteignable",
  "mobile_equivalent": "le même mécanisme adapté au tactile, décrit aussi précisément",
  "fallbacks": "comportement clavier, lecteur d'écran, et prefers-reduced-motion",
  "forbidden": ["3 réflexes de navigation que ce site ne fera PAS"]
}

Exigence de précision : chaque effet doit être chiffré (px, %, ms, easing).
Une réponse du type « animation fluide au survol » est un échec.`;

const P4_SYSTEM = `Tu convertis les phases 1 à 3 en un SCENE GRAPH JSON strictement valide.
C'est la colonne vertébrale technique du reste du pipeline : chaque objet
visuel, sa position, sa profondeur, sa relation aux autres, son comportement
au scroll/swipe y est défini de façon exhaustive et non ambiguë.

Règles de remplissage obligatoires :
- Le CONTRAT D'INTERACTION fourni est la loi : le scene graph doit encoder son
  navigation_model tel quel. Si le modèle est "no-scroll-stage", il n'y a pas
  de succession de sections empilées : il y a UNE scène et des états. Chaque
  input_map du contrat doit se retrouver dans un interaction_behavior.
- AUCUNE valeur vague. Jamais "milieu de la page" : écris "top: 50%; left: 50%; transform: translate(-50%, -50%)".
  Jamais "police moderne" : donne un nom de police réel et sa source (URL Google Fonts ou équivalent).
- TYPOGRAPHIE = DÉCISION DE MARQUE, PAS RÉFLEXE. Interdites sauf justification
  écrite : Inter, Arial, Helvetica, Helvetica Neue, Roboto, system-ui,
  -apple-system, Segoe UI, Open Sans, Poppins, Space Grotesk. Tu ne peux en
  choisir une QUE si le positionnement de la Phase 1 exige explicitement une
  neutralité totale, et alors tu écris pourquoi dans "typography.rationale".
  Dans tous les autres cas : une police display avec un point de vue (dessin,
  époque, fonderie) + une police de texte compatible, chacune avec sa source.
  Le champ "typography.rationale" doit relier le dessin de la police à la
  Phase 1 ou 2 en une phrase — s'il pourrait être recopié pour une autre
  marque, il est faux.
- Chaque element avec occlusion_relationship rempli doit justifier l'occlusion par une référence
  explicite à la Phase 1 ou à la Phase 3. L'occlusion n'est jamais décorative gratuite.
- SITE COMPLET, PAS UNE COUVERTURE : au minimum 5 sections réelles et
  distinctes (l'accueil/scène d'entrée + au moins 4 sections de contenu :
  produits ou travaux détaillés, récit/procédé, preuve ou détail technique,
  contact/passage à l'acte). Chaque section porte du contenu réel, écrit, pas un
  placeholder décoratif. Si le navigation_model n'est pas vertical-scroll, ces
  sections existent comme ÉTATS atteignables par le mécanisme du contrat, pas
  comme empilement — mais elles existent toutes.
- NAVIGATION RÉELLE : ajoute un objet "navigation" avec 4 à 6 entrées, chacune
  avec son libellé exact, sa cible (ancre de section ou route) et son état actif.
  Une navigation décorative dont les mots ne mènent nulle part est un échec.
- TEXTE FONCTIONNEL OBLIGATOIRE dans les elements : titres réels, description de
  produit ou de service (2 à 5 phrases écrites, pas de lorem), prix ou données
  chiffrées quand le secteur en a, libellés d'action exacts, et le pied de page
  avec mentions légales, année et coordonnées. Le texte fusionné dans une image
  générée reste, lui, une option parmi d'autres.
- Chaque generation_prompt de background_layer doit être d'une précision physique maximale :
  position exacte des éléments dans le cadre, direction et qualité de la lumière, palette,
  cadrage, ET exclusions explicites (pas de texte parasite, pas de watermark, pas de flou parasite).
- L'élément porteur du concept doit avoir un interaction_behavior qui correspond EXACTEMENT
  à la séquence physique décrite en Phase 3 Étape D.

Réponds UNIQUEMENT avec le JSON, sans texte autour, selon ce schéma exact :

{
  "concept_summary": "…",
  "sections": [
    {
      "section_id": "hero",
      "viewport_behavior": "full-viewport | scroll-reveal | pinned",
      "background_layer": { "type": "generated_image | generated_video | solid_color | gradient", "generation_prompt": "…", "z_index": 0 },
      "elements": [
        {
          "element_id": "…",
          "type": "image | text | video | shape",
          "content": "…",
          "concept_carrier": true,
          "position": { "desktop": "…", "mobile": "…" },
          "z_index": 1,
          "occlusion_relationship": "…",
          "requires_segmentation": true,
          "parallax_speed": "1.0",
          "entrance_animation": { "type": "fade|rise|scale|slide", "duration_ms": 900, "delay_ms": 200, "easing": "cubic-bezier(0.22, 1, 0.36, 1)" },
          "interaction_behavior": { "trigger": "scroll|swipe|hover|click|none", "response": "…" }
        }
      ]
    }
  ],
  "navigation": [ { "label": "…", "target": "#section_id | /route", "active_state": "…" } ],
  "footer": { "legal_lines": ["…"], "contact": "…", "year": "…" },
  "typography": { "primary_font": "…", "font_source": "…", "body_font": "…", "body_font_source": "…", "rationale": "…", "scale": { "hero_size": "…", "body_size": "…", "letter_spacing": "…" } },
  "color_palette": { "primary": "#…", "secondary": "#…", "accent": "#…", "background": "#…" },
  "motion_global_rules": { "reduced_motion_behavior": "…", "scroll_behavior": "smooth | native | custom physics" }
}`;

const P4B_SYSTEM = `Tu écris le PROMPT D'IMAGE d'une MAQUETTE D'ÉCRAN complète : le rendu visuel
de la page d'accueil entière, telle qu'elle sera vue dans un navigateur desktop
16:9, AVANT toute ligne de code. Ce n'est pas une illustration ni un packshot
produit : c'est la capture d'écran plausible d'un site de studio primé.

Aucune image de référence ne t'est fournie, et tu n'en réclames pas : ce sont le
PATRON de composition et le REGISTRE CHROMATIQUE imposés plus bas qui commandent,
plus rien d'autre. N'imite aucune maquette existante.

ANNOTATIONS DE TRAVAIL — INTERDICTION ABSOLUE DANS L'IMAGE :
tu chiffres les positions, les tailles et les proportions dans le TEXTE de ton
prompt, parce que le générateur en a besoin pour placer les éléments. Mais ces
mesures ne doivent JAMAIS être DESSINÉES dans l'image. Le rendu est une capture
d'écran de site fini, pas un plan annoté. Sont donc interdits à l'écran : les
pourcentages (« 3.5% », « 58% »), les cotes en pixels (« 1px », « 12x »), les
repères de coordonnées, les flèches et lignes de cote, les traits de grille de
maquettage, les libellés d'annotation, les légendes de wireframe. Termine
toujours ton prompt par cette phrase, à la lettre : "No measurement annotations
of any kind rendered in the image: no percentage labels, no pixel dimensions, no
coordinate markers, no dimension lines or arrows, no wireframe callouts, no
layout guide overlays. Only real website interface text is visible."
Les chiffres réellement admis à l'écran sont ceux qui appartiennent au SITE lui
même (pagination « 01/06 », prix, date, numéro d'index) — jamais une mesure.

CE QUE L'IMAGE DOIT ÊTRE : LA CAPTURE D'UN SITE, PAS UNE AFFICHE.
Le test : si on montre le rendu à quelqu'un, il doit dire « c'est un site web »,
pas « c'est une affiche » ni « c'est une photo de produit ». Une image qui n'a
qu'un mot géant et un objet est REFUSÉE, même belle.

ANATOMIE OBLIGATOIRE — les cinq zones, toutes présentes dans le cadre :
1. BARRE DE NAVIGATION ancrée en haut, sur toute la largeur : le LOCKUP DE
   MARQUE à gauche (le logo tel qu'il est défini dans l'identité fournie —
   jamais un mot posé au hasard), 4 à 5 entrées de menu réelles à droite avec
   leurs libellés exacts, et UN bouton d'action visible (fond plein, contour
   fin ou lien souligné, coins droits ou légèrement adoucis, pas de pilule
   violette). Un mince filet ou un changement de valeur sépare la barre du reste.
2. ZONE D'ACCROCHE : le titre qui porte le point de vue, une phrase de soutien
   de 1 à 3 lignes en corps courant, et l'action principale avec son libellé
   exact. Décalés, pas centrés-symétriques.
3. PREUVE DE DÉFILEMENT — obligatoire : le bas du cadre montre le DÉBUT de la
   section suivante, coupée par le bord inférieur (une rangée de 3 à 4 blocs de
   contenu réels avec titre court et légende, ou un début de tableau, ou une
   bande de chiffres-clés légendés, ou une amorce de grille de produits). On
   doit sentir qu'il y a une page en dessous.
4. COMPOSANTS D'INTERFACE réels, au moins deux : champ de recherche ou de
   saisie avec son texte indicatif, étiquette/badge, fil d'ariane, sélecteur de
   langue, panier avec compteur, onglets, indicateur de progression de
   défilement. Chacun dessiné comme un vrai composant, pas comme un ornement.
5. MICRO-TEXTES DE SERVICE en bas : mention de lieu, année, index de pagination
   ou amorce de pied de page.

UNE PAGE PARMI PLUSIEURS — le site aura 5 ou 6 pages. Ce que tu dessines ici est
le SYSTÈME qui devra tenir sur toutes : la barre de navigation, l'échelle
typographique, la palette, le rayon des angles, l'épaisseur des filets et le
style des boutons seront REPRIS À L'IDENTIQUE sur les autres pages. Choisis-les
comme un système réutilisable, pas comme un effet valable une seule fois.

QUALITÉ DE FINITION — ce qui sépare un beau site d'un site moche :
- une échelle typographique nette (rapport d'au moins 1 à 6 entre le corps
  courant et le titre), jamais trois tailles voisines qui se disputent ;
- un alignement franc : tout se raccroche à 2 ou 3 lignes verticales, pas plus ;
- un seul accent de couleur, utilisé 2 ou 3 fois maximum, sur ce qui compte ;
- des contrastes tenus : le texte courant doit rester parfaitement lisible sur
  son fond, jamais du gris moyen sur gris moyen ;
- de la matière dans le fond (grain fin, texture, dégradé très long, aplat
  légèrement teinté) plutôt qu'un blanc ou un gris nu.

Donne les LIBELLÉS EXACTS de chacun de ces textes dans le prompt (mots réels,
pas « lorem »). Une image sans navigation, sans bouton ou sans amorce de section
suivante est REFUSÉE d'office.

En revanche, l'occlusion du texte par la photo n'est PAS obligatoire : c'est UNE
option de composition parmi d'autres. Tu dois y avoir pensé, et ne la retenir que
si le sujet la justifie.

STRUCTURE — chaque point chiffré, dans le prompt que tu écris :
1. FOND — teinte plate ou champ de couleur maîtrisé, hex donné. Ni blanc pur, ni
   noir pur, ni beige/écru/crème sauf si le registre imposé le demande.
2. TYPOGRAPHIE PRINCIPALE — un titre qui a un point de vue : soit un mot-titre
   énorme (22-40 % de la hauteur du cadre), soit une phrase composée sur 2-3
   lignes en très gros corps, soit une colonne de texte serrée en contre-emploi.
   Précise corps, casse, letter-spacing (valeur chiffrée), alignement de bord.
3. IMAGE — une, deux au plus, cadrage précisé (plein bord, fenêtre, colonne,
   pleine hauteur), lumière dirigée avec direction et dureté, ombre cohérente.
   Sujet crédible et détaillé : matière, texture, grain, imperfections réelles.
4. DÉTAIL FIN — au moins trois détails qui font vrai : filets d'un pixel, index
   numérotés, ligne d'état, curseur, petite vignette secondaire, tirets de
   grille, indicateur de défilement, chiffre de pagination. Chiffre-les.
5. RESPIRATION — dis où sont les zones vides et quelle proportion du cadre elles
   occupent (au moins 25 %).
6. EXCLUSIONS — pas de cadre de navigateur, pas de mockup de téléphone, pas de
   collage de plusieurs écrans, pas de carte à coins arrondis empilée en grille,
   pas de dégradé violet, pas de watermark, pas de packshot e-commerce centré.

INTERDITS DE COMPOSITION (rendent la maquette inutilisable) : hero centré titre +
sous-titre + deux boutons ; symétrie totale ; objet flottant seul au centre d'un
fond vide ; page découpée en bandes horizontales identiques ; palette beige/écru
sur fond crème si le registre imposé dit autre chose.

Tu reçois aussi le CONTRAT D'INTERACTION : la maquette montre l'ÉTAT DE REPOS
qu'il décrit, jamais un empilement de sections.

PRÉCISION — non négociable. Pour CHAQUE élément que tu décris :
- sa position en pourcentage du cadre (ex : "title baseline at 46% of frame
  height, left edge at 4% margin", "photo occupies x from 52% to 100%") ;
- la lumière : direction en degrés ou en heure d'horloge, dureté, température
  (ex : "single hard key light from upper left at 35°, 4200K, shadow falling to
  the lower right at 1.6x subject length") ;
- la matière : tissage, grain, poussière, usure, reflet — nommés ;
- les valeurs de couleur en hex.
DÉFAUTS À EXCLURE EXPLICITEMENT dans le prompt, à la lettre : no hallucinated or
garbled lettering, no deformed hands or fingers, no extra limbs, no blurry logo,
no watermark, no signature, no JPEG artifacts, no double exposure ghosting, no
lens flare, no browser chrome, no phone mockup, no stock-photo smiling model.

TEST DE SPÉCIFICITÉ — applique-le avant de répondre : si ton prompt pourrait
décrire n'importe quel autre produit ou n'importe quelle autre marque du même
secteur, il est raté. Réécris-le en y mettant ce qui n'appartient qu'à CETTE
marque : l'objet exact, sa couleur exacte, le lieu exact, le geste exact, le
défaut exact qui prouve qu'il est réel.

Un seul prompt en anglais, dense, très concret, 200 à 300 mots. Réponds
UNIQUEMENT avec le prompt, sans guillemets, sans préambule.`;

/**
 * GOÛT VALIDÉ PAR LE CLIENT (planche de références choisie explicitement).
 * Ce n'est pas une image, c'est une règle écrite : trois familles seulement
 * sont considérées comme belles, tout le reste est refusé d'office.
 */
const TASTE_LOCK = `GOÛT IMPOSÉ — le client a validé une planche de références et refusé les autres. Ta composition doit appartenir à L'UNE de ces trois familles, sans mélange :
FAMILLE 1 — SOMBRE LUMINEUX : fond très sombre, une vraie lumière colorée (dégradé profond, halo, matière lumineuse) qui vient d'une zone précise du cadre, typographie blanche nette, interface dense et technique (chiffres, données, badges, petits modules alignés).
FAMILLE 2 — SUISSE STRICT : blanc franc, typographie noire massive en grille rigoureuse, un seul rouge-orange vif en aplats géométriques, filets d'un pixel, aucun arrondi, aucune ombre.
FAMILLE 3 — PHOTO DOMINANTE : une photographie réelle qui occupe la majeure partie du cadre, typographie posée dessus avec un contraste tenu, barre de navigation nette, très peu de mots.
INTERDIT quel que soit le choix : le collage multicolore façon magazine, les fonds pastel ou beiges, le violet doux sur blanc, les cartes arrondies alignées en grille, la typographie décorative, le texte incliné ou déformé, plus d'un accent coloré.
Le rendu doit avoir l'air d'un site primé récent, pas d'une affiche d'école d'art.`;

/** Patrons de composition tirés au sort : empêche le moteur de refaire
 *  éternellement la même page « mot géant + objet au centre ». */
const MOCKUP_PATTERNS: string[] = [
  "PATRON IMPOSÉ — OCCLUSION TYPOGRAPHIQUE : mot-titre géant traversant le cadre, sujet photographié à l'échelle 1:1 qui passe devant une partie des lettres, navigation et micro-typo dans les quatre coins.",
  "PATRON IMPOSÉ — PHOTO PLEIN BORD : l'image occupe 100 % du cadre, la typographie et la navigation posées PAR-DESSUS en blanc ou en teinte extraite de l'image, un seul bloc de texte aligné sur un tiers, aucun aplat de fond.",
  "PATRON IMPOSÉ — CHAMP SCINDÉ ASYMÉTRIQUE : le cadre coupé verticalement en deux zones inégales (par ex. 38 / 62), une teinte pleine d'un côté avec le titre et le texte courant, l'image pleine hauteur de l'autre, la coupe franche sans bordure.",
  "PATRON IMPOSÉ — INDEX ÉDITORIAL DENSE : une liste ou un index numéroté en petit corps occupant une colonne entière, un très grand titre en tête, une seule image de taille modeste placée en contrepoint, beaucoup de filets d'un pixel.",
  "PATRON IMPOSÉ — SCÈNE PROFONDE : une photographie d'espace ou d'environnement avec de la profondeur, la typographie posée dans la perspective ou alignée sur une arête de la scène, navigation en haut sur une seule ligne.",
  "PATRON IMPOSÉ — MODULE FLOTTANT : un grand aplat de couleur saturée, une carte ou fenêtre rectangulaire nette décalée hors centre contenant l'image et le libellé d'action, le titre débordant du module, ombre portée franche.",
  "PATRON IMPOSÉ — TYPOGRAPHIE SEULE : aucune photographie, uniquement de la matière typographique à plusieurs échelles (rapport d'au moins 1 à 12 entre le plus petit et le plus grand texte), une couleur d'accent unique, la navigation traitée comme un élément graphique.",
];

/** Registres chromatiques tirés au sort — le beige n'est qu'un cas sur huit. */
const MOCKUP_PALETTES: string[] = [
  "REGISTRE CHROMATIQUE IMPOSÉ — fond presque noir bleuté (#0A0C14), surfaces gris ardoise (#171B24), un VRAI dégradé profond violet-indigo vers magenta (#3B1E82 -> #C21E8A) sur une seule grande zone, textes blancs, accent cyan (#4FD8E8) sur les liens et les chiffres.",
  "REGISTRE CHROMATIQUE IMPOSÉ — fond noir dense (#08090B), un halo de dégradé chaud saturé (orange #FF5A1F vers rose #FF2D8A) diffusé derrière l'élément principal comme une lumière, tout le reste en blanc et gris très sombre, aucune autre couleur.",
  "REGISTRE CHROMATIQUE IMPOSÉ — blanc pur (#FFFFFF) en dominante, noir franc (#000000) pour toute la typographie, un unique rouge-orange vif (#FF3B14) en aplats géométriques francs (bandes, blocs pleins) — style typographique suisse strict.",
  "REGISTRE CHROMATIQUE IMPOSÉ — blanc cassé (#F7F6F3) et noir encre (#111111) en photographie noir et blanc dominante, un seul accent rouge (#E2231A) sur le bouton et les filets, grille très stricte.",
  "REGISTRE CHROMATIQUE IMPOSÉ — photographie couleur plein cadre dominante (le sujet réel occupe la majorité du cadre), typographie blanche posée dessus, barre de navigation blanche opaque en haut, aucun aplat de couleur inventé.",
  "REGISTRE CHROMATIQUE IMPOSÉ — bleu de nuit dense (#0E1A33) en dominante, dégradé subtil vers bleu électrique (#1F3BE8) dans une zone, textes blanc froid, accent vert acide (#B6FF3C) sur le seul bouton principal.",
];

const pickOne = (arr: string[]) => arr[Math.floor(Math.random() * arr.length)];

// ── Mémoire anti-répétition (règle : zéro formule répétée entre marques) ──
// On garde sur disque ce qui a déjà été servi (patron, palette, mécanique) et
// on l'interdit à la marque suivante tant que le catalogue n'est pas épuisé.
interface GenesisMemoryEntry {
  runId?: string; brief: string; pattern: string; palette: string; navigation: string;
  association?: string;   // « objet x element — mecanique » retenu en phase 3
  font?: string;          // police display reellement choisie
  at: number;
}
const GENESIS_MEMORY_DIR = `${process.cwd()}/data`;
const GENESIS_MEMORY_FILE = `${GENESIS_MEMORY_DIR}/genesis-history.json`;

function readGenesisMemory(): GenesisMemoryEntry[] {
  try { return JSON.parse(readFileSync(GENESIS_MEMORY_FILE, "utf-8")) as GenesisMemoryEntry[]; }
  catch { return []; }
}
function writeGenesisMemory(entry: GenesisMemoryEntry) {
  try {
    const all = readGenesisMemory();
    all.push(entry);
    mkdirSync(GENESIS_MEMORY_DIR, { recursive: true });
    writeFileSync(GENESIS_MEMORY_FILE, JSON.stringify(all.slice(-40), null, 2), "utf-8");
  } catch (e) { console.warn("[genesis] mémoire anti-répétition non écrite:", (e as Error).message); }
}
/** Tire un élément en évitant ceux déjà utilisés récemment. */
/** Cree ou complete l'entree de memoire du run courant (banque d'associations). */
function upsertGenesisMemory(runId: string, patch: Partial<GenesisMemoryEntry>) {
  try {
    const all = readGenesisMemory();
    const i = all.findIndex(e => e.runId === runId);
    if (i >= 0) all[i] = { ...all[i], ...patch, at: Date.now() };
    else all.push({ runId, brief: "", pattern: "", palette: "", navigation: "", at: Date.now(), ...patch });
    mkdirSync(GENESIS_MEMORY_DIR, { recursive: true });
    writeFileSync(GENESIS_MEMORY_FILE, JSON.stringify(all.slice(-60), null, 2), "utf-8");
  } catch (e) { console.warn("[genesis] banque d'associations non ecrite:", (e as Error).message); }
}

/** Polices interdites par defaut : un reflexe, pas un choix. */
const BANNED_FONTS = ["inter", "arial", "helvetica", "roboto", "system-ui", "-apple-system", "segoe ui", "sans-serif seulement"];
const usesBannedFont = (name: string) => {
  const n = name.toLowerCase();
  return BANNED_FONTS.some(b => n.includes(b));
};

/** Bloc injecte au debut de la phase 3 : tout ce qui a deja ete servi. */
function associationBankBlock(): string {
  const bank = readGenesisMemory().filter(m => m.association || m.font || m.navigation);
  if (!bank.length) return "";
  const lines = bank.slice(-20).map(m => {
    const bits = [m.association ? `association : ${m.association}` : "", m.navigation && m.navigation !== "?" ? `mecanique : ${m.navigation}` : "", m.font ? `police : ${m.font}` : "", m.palette ? `registre : ${(m.palette.split(" — ")[1] ?? m.palette).slice(0, 60)}` : ""].filter(Boolean);
    return `- « ${m.brief.slice(0, 60)} » → ${bits.join(" · ")}`;
  });
  return `\n\nBANQUE DES PROJETS DEJA REALISES (tous projets confondus, pas seulement ceux du jour) :\n${lines.join("\n")}\n\nREGLE ANTI-REPETITION INTER-PROJETS : avant l'etape B, compare chacune de tes 6 associations a cette banque. Elimine d'office toute association de la MEME FAMILLE qu'une entree ci-dessus (meme element naturel, meme geste, meme phenomene temporel, meme metaphore d'atelier/forge/rituel/machine si elle y figure), meme si le secteur de la marque est different. Elimine aussi les mecaniques d'interaction et les polices deja listees. Tu dois pouvoir ecrire, en une ligne, en quoi ton association finale n'appartient a aucune famille de cette banque.`;
}

function pickUnused(arr: string[], used: string[]): string {
  const free = arr.filter(x => !used.includes(x));
  return pickOne(free.length ? free : arr);
}

const P4D_SYSTEM = `Tu compares ce que la Phase 4 (Scene Graph) avait PRÉVU avec la
maquette d'écran réellement RETENUE en Phase 5, décrite par son prompt d'image et
le verdict du directeur artistique.

Ton seul travail : dire si la maquette retenue s'écarte du Scene Graph, et si oui
produire la mise à jour minimale du Scene Graph pour que TOUTES les sections
suivantes du site restent cohérentes avec la direction réellement retenue. Une
divergence silencieuse — un hero dans une direction et le reste du site sur
l'ancienne idée — est un défaut grave.

Compare précisément : palette (valeurs hexadécimales), typographie (caractère,
graisse, échelle), patron de composition, rapport entre le mot-titre et le sujet,
présence ou absence de photographie, densité, registre de matière.

Réponds UNIQUEMENT par ce JSON compact, rien avant, rien après :
{"diverge":true|false,
 "ecarts":["écart 1 : prévu … / retenu …"],
 "palette":{"background":"#RRGGBB","ink":"#RRGGBB","accent":"#RRGGBB"},
 "typography":{"primary_font":"nom réel du caractère","body_font":"nom réel","rationale":"une phrase"},
 "hero_composition":"2 phrases décrivant la composition retenue",
 "consignes_sections_suivantes":["consigne concrète pour les sections suivantes","…"]}

Si rien ne diverge, réponds {"diverge":false,"ecarts":[]} seul. N'invente pas de
police : reprends celle réellement décrite dans le prompt retenu, et si le prompt
ne nomme qu'un style (par exemple didone à fort contraste), nomme un caractère
réel de ce style et dis-le dans rationale.`;

const P4C_SYSTEM = `Tu es directeur artistique dans un studio de design primé. Tu reçois la
MAQUETTE D'ÉCRAN d'une page d'accueil et l'intention écrite. Tu juges le DESIGN,
pas la technique. Sois dur : la moyenne d'un site correct mais oubliable est 5.

Note de 0 à 10, en une phrase de justification chacun :
1. COMPOSITION — patron éditorial affirmé, tension, asymétrie maîtrisée,
   alignements de bord francs. Un hero centré titre + sous-titre + deux boutons
   ne peut pas dépasser 3.
2. TYPOGRAPHIE — échelle réellement grande, contraste de corps, letter-spacing
   travaillé, choix de caractère qui a un point de vue.
3. PHOTOGRAPHIE / MATIÈRE — si la composition est volontairement SANS
   photographie (patron typographique pur), ce critère est SANS OBJET : réponds
   -1 et juge la matière typographique dans le critère 2. Sinon :
   lumière dirigée, sujet crédible, intégration
   (ombre portée cohérente, matière et grain lisibles), aucun artefact visible.
   L'occlusion du texte par l'image est un bonus, jamais une obligation.
4. ANTI-GÉNÉRIQUE — cette page ressemble-t-elle aux milliers de landing pages
   déjà vues dans ce secteur ? 10 = on ne l'a jamais vue, 0 = template.
5. HIÉRARCHIE / INTENTIONNALITÉ — le regard sait où aller en une seconde, un seul
   point d'entrée, ET chaque zone du cadre est habitée par une décision. C'est le
   critère le plus important : un vide qui n'est pas un parti pris est un défaut,
   même quand tout le reste est techniquement propre. Demande-toi, zone par zone :
   pourquoi cet élément est-il exactement là, et pourquoi ce vide est-il vide ?
   Si la réponse est « rien ne l'a décidé », ce critère ne peut pas dépasser 4.
   Attention : petit et discret n'est PAS un défaut. Une composition minimaliste
   aux éléments modestes peut valoir 10 si chaque position est décidée ; une
   composition spectaculaire peut valoir 3 si son espace n'est pas habité.
6. CRÉDIBILITÉ D'INTERFACE — c'est un SITE : navigation lisible, libellé
   d'action, micro-textes de service, un vrai bloc de texte courant, détails
   fins (filets, index, numérotation). S'il manque la navigation ou tout libellé
   d'action, ce critère ne peut pas dépasser 3.

ANNOTATIONS DE TRAVAIL VISIBLES — DISQUALIFIANT : si l'image contient des
pourcentages, des cotes en pixels, des repères de coordonnées, des lignes de cote,
des traits de grille de maquettage ou tout libellé d'annotation superposé, le
verdict est REGENERER quels que soient les autres scores, le critère 6 est
plafonné à 3, et ta première correction est : « supprimer toute annotation de
mesure superposée : l'image doit être une capture d'écran de site fini ». Les
chiffres qui appartiennent au site (pagination, prix, date, index) sont admis.

Seuil d'acceptation : moyenne ≥ 8 ET aucun critère < 6.

Si le seuil n'est pas atteint, écris des corrections CONCRÈTES et directement
applicables au prompt d'image (géométrie, cadrage, échelle, lumière, palette) —
jamais de commentaire vague type « rendre plus premium ».

COMMENCE ta réponse par la ligne JSON compacte, exactement, sur la première
ligne et rien d'autre sur cette ligne :
{"composition":N,"typography":N,"photo":N ou -1 si sans objet,"anti_generic":N,"hierarchy":N,"interface":N,"verdict":"ACCEPTER|REGENERER","fixes":["…"]}
Écris les justifications APRÈS cette ligne. Sans cette première ligne, ta
réponse est inutilisable.

Budget de sortie : 250 mots maximum.`;

const P5_SYSTEM = `Tu appliques l'arbre de décision d'assets du moteur /genesis à CHAQUE élément
visuel du Scene Graph, dans cet ordre strict :

1) Est-ce un élément d'INTERFACE FONCTIONNEL générique et récurrent (navigation,
   formulaire, carte produit, menu, drawer, bouton, champ) dont la valeur est le
   comportement et l'ergonomie, pas l'originalité visuelle ?
   → OUI : "component" — importer un composant réel de bibliothèque (21st.dev /
     shadcn), jamais régénérer en image. Un formulaire généré comme image ne
     collecte aucune donnée.
   → NON : question suivante.
2) Sa valeur créative dépend-elle d'un MOUVEMENT continu et atmosphérique
   (ciel, eau, particules, fumée) ? → OUI : "video" (boucle sans coupure,
   mouvement lent, pas de sujet central, 8-15 s).
   → NON : question suivante.
3) Sa valeur créative dépend-elle d'une COMPOSITION statique précise
   (sujet détouré, scène complète, élément décoratif unique) ?
   → OUI : "image". → NON : "recheck" (élément mal catégorisé en Phase 4).

Règle de priorité en cas de doute : préférer TOUJOURS un composant existant pour
tout ce qui est fonctionnel/interactif standard. La génération est réservée à ce
qui porte réellement l'identité visuelle et le concept de la Phase 3.

Multi-variantes : pour chaque élément porteur du concept, prévoir 3 à 4 variantes
qui font varier UN SEUL paramètre à la fois (angle de caméra, intensité lumineuse,
ou position de l'élément central) — jamais une variation non contrôlée sur tous
les paramètres. Un seul rendu suffit pour les éléments secondaires ou décoratifs.

PRÉCISION DES base_prompt ET DES variants — obligatoire, sinon la décision est
invalide : position des éléments en % du cadre, direction/dureté/température de
la lumière, matière et défauts réels du sujet, hex des couleurs, ET la liste
d'exclusions recopiée telle quelle : no hallucinated or garbled lettering, no
deformed hands or fingers, no blurry logo, no watermark, no signature, no JPEG
artifacts, no lens flare, no stock-photo smiling model.
Test de spécificité : un prompt qui conviendrait à n'importe quelle autre marque
du même secteur doit être réécrit avec les détails propres à celle-ci.

Réponds UNIQUEMENT en JSON :
{
  "decisions": [
    { "element_id": "…", "asset_type": "component|video|image|recheck", "reason": "…",
      "component_query": "…",
      "base_prompt": "prompt de génération ultra précis, exclusions comprises",
      "variants": [ { "label": "…", "changed_parameter": "camera_angle|light_intensity|subject_position", "prompt": "…" } ] }
  ]
}
Maximum ${GENESIS_MAX_VARIANTS} variantes par élément, et uniquement pour les porteurs de concept.`;

const P6_SYSTEM = `Tu es un évaluateur visuel strict et indépendant. Tu reçois une image (le rendu
généré) et une intention écrite (le Scene Graph et le résumé de concept). Tu n'as
PAS participé à la création de cette image — évalue-la comme si tu la voyais
pour la première fois, sans indulgence envers l'intention initiale.

Réponds selon cette structure exacte :

1. CORRESPONDANCE AU CONCEPT (0-10) : Est-ce que cette image traduit fidèlement
   le concept central décrit ? Justifie en une phrase.
2. COHÉRENCE VISUELLE (0-10) : Y a-t-il des éléments qui se chevauchent de façon
   non intentionnelle, des proportions incohérentes, des artefacts de génération
   visibles (mains déformées, texte illisible, symétrie cassée) ?
3. SIGNATURE "GÉNÉRIQUE IA" (0-10, 10 = aucune trace, 0 = trahit immédiatement
   une génération IA) : Cette image ressemble-t-elle à des milliers d'autres
   images générées par IA sur ce même sujet (mêmes poses, mêmes compositions
   surexploitées, mêmes palettes "IA typiques" comme le violet néon systématique) ?
4. RESPECT DU REGISTRE SENSORIEL (0-10) : Est-ce que la lumière, la température
   de couleur et la matière correspondent à ce qui a été défini en Phase 2 ?
5. VERDICT : ACCEPTER | RÉGÉNÉRER AVEC AJUSTEMENTS | RÉGÉNÉRER ENTIÈREMENT
6. SI RÉGÉNÉRER : liste précise et actionnable de ce qui doit changer dans le
   prompt de génération (pas de commentaire vague type "améliore la qualité" —
   chaque point doit être une instruction concrète modifiable).

Seuil d'acceptation : le score moyen des 4 critères doit être supérieur ou égal
à 7/10, ET aucun critère individuel ne doit être en dessous de 5/10.

Termine ta réponse par une dernière ligne JSON compacte, exactement :
{"concept":N,"coherence":N,"ai_signature":N,"sensory":N,"verdict":"ACCEPTER|RÉGÉNÉRER AVEC AJUSTEMENTS|RÉGÉNÉRER ENTIÈREMENT","fixes":["…"]}

Budget de sortie : 300 mots maximum.`;

const P7_SYSTEM = `Tu appliques l'arbre de décision de segmentation du moteur /genesis à chaque
élément visuel généré :

  Le Scene Graph indique-t-il un occlusion_relationship impliquant cet élément ?
    → OUI : segmentation nécessaire (PNG à fond transparent).
    → NON : question suivante.
  Le Scene Graph indique-t-il un interaction_behavior qui déplace cet élément
  indépendamment du fond ? → OUI : segmentation nécessaire. → NON : suivante.
  Cet élément doit-il avoir une vitesse de parallax différente du reste ?
    → OUI : segmentation nécessaire.
    → NON : aucune segmentation, l'image générée sert telle quelle comme fond.

Ne découpe QUE si nécessaire. Pour chaque découpe, écris le prompt de détourage
au format : « Isole [élément précis] de cette image. Fond entièrement transparent
(canal alpha). Conserve tous les détails de bordure de l'élément. Sortie en PNG. »
Précise aussi la position de réinjection (coordonnées exactes) et le z_index.

Réponds UNIQUEMENT en JSON :
{ "cutouts": [ { "element_id": "…", "reason": "occlusion|interaction|parallax", "segmentation_prompt": "…", "reinject_position": "…", "z_index": N } ], "skipped": [ { "element_id": "…", "reason": "…" } ] }`;

const P8_SYSTEM = `Tu compiles la SPEC DE PRÉCISION FINALE — le document réellement transmis à
l'agent de code. Niveau d'exigence : valeurs exactes partout, jamais approximatives.

| Catégorie | Précision requise |
| Position | px/vh/vw/% exacts, jamais "centré" seul : top: 80px; left: 50%; transform: translateX(-50%) |
| Typographie | famille exacte + URL source + poids + letter-spacing au dixième de px (ex : -24.6459px) |
| Couleur / gradient | hex/RGB exacts, angle au centième de degré (ex : linear-gradient(247.3282658084845deg, …)) |
| Z-index | tableau explicite de TOUTES les couches dans l'ordre |
| Timing | durée ms exacte, delay ms exact, easing nommé (ex : 1.4s cubic-bezier(0.22, 1, 0.36, 1), delay 300ms) |
| Copie | chaîne exacte, caractères spéciaux compris (tirets cadratins, espaces insécables) |
| Responsive | breakpoints exacts + comportement point par point, jamais "s'adapte au mobile" |

Structure obligatoire, dans cet ordre exact, en Markdown :
1. **Stack & page chrome** — technologies, titre de page, police de base, structure racine.
2. **Assets exacts** — chemin/identifiant de chaque asset généré ou détouré, jamais de placeholder.
3. **Ordre des couches (z-index)** — tableau complet.
4. **Copie et liens exacts** — chaque chaîne du site, mot pour mot.
5. **Layout desktop** — position exacte de chaque section/élément.
6. **Layout mobile / responsive** — comportement à chaque breakpoint, valeurs exactes.
7. **Animations d'entrée** — tableau : élément, classe, durée, delay, easing.
8. **Machine d'interaction** — section la plus importante du document. Recopie
   le CONTRAT D'INTERACTION et rends-le implémentable :
   - le navigation_model exact et ce qu'il implique sur le squelette de la page
     (ex : overflow hidden sur html et body, hauteur 100dvh, aucune section
     empilée, un conteneur d'état unique) ;
   - la table complète des entrées → effets, chiffrée (px/%/ms/easing) ;
   - la machine à états : chaque état, sa durée, sa transition, l'état suivant ;
   - le parcours du contenu : comment on atteint chaque page/produit/section
     avec ce seul mécanisme, et ce qui se passe au bout de la liste ;
   - l'équivalent tactile mobile, geste par geste, avec seuils en px ;
   - clavier (flèches, Tab), focus visible, et comportement prefers-reduced-motion ;
   - les 3 réflexes de navigation explicitement refusés.
   Si le contrat n'est pas vertical-scroll, écris noir sur blanc : « cette page
   n'est PAS une landing page qui défile — toute section empilée est un échec ».
9. **Checklist d'implémentation** — étapes de construction ordonnées.

CONTRAT DE DESIGN — non négociable, à écrire explicitement dans la section 5
et à faire respecter par l'agent de code. Le but du moteur est le DESIGN : une
page correcte mais banale est un échec, au même titre qu'une page cassée.

A. Composition — choisis UN patron éditorial fort pour le hero et nomme-le dans
   la spec : (a) titre display géant traversant tout le viewport avec le sujet
   détouré posé DEVANT une partie des lettres (occlusion typographique),
   (b) split asymétrique 1/3 – 2/3 avec image pleine hauteur bord à bord,
   (c) plein cadre photographique avec micro-typographie ancrée dans les coins,
   (d) grille éditoriale décalée où l'image déborde volontairement de la colonne.
   Interdit : hero centré titre + sous-titre + deux boutons.
B. Typographie — une police display réelle (nom + URL de source), taille de hero
   d'au moins 12vw en desktop, letter-spacing négatif exact, casse assumée.
   Interdits : Inter, Arial, Helvetica, Roboto, system-ui, -apple-system,
   Segoe UI, Space Grotesk, Open Sans, Poppins — sauf neutralité totale
   explicitement exigée par la Phase 1, et alors la spec doit le justifier.
   Reprends la police et la justification du scene graph, ne les réinvente pas.
C. Couleur — 2 couleurs dominantes maximum + 1 accent, hex exacts. Le fond n'est
   jamais blanc pur ni noir pur sauf décision justifiée par la Phase 2.
   Interdits : dégradés violets sur blanc, ombres portées molles génériques.
D. Photographie — chaque image de personne ou de produit vient des assets réels
   listés plus haut, détourée quand la couche l'exige. Jamais de placeholder,
   jamais d'illustration vectorielle de remplacement, jamais de stock générique.
E. Densité et vide — au moins une zone de silence visuel volontaire (≥ 25 % du
   viewport) et un alignement de bord franc (texte collé à une marge exacte).
F. Micro-détails obligatoires : ligne de filet ou séparateur fin, un bloc de
   méta-informations en petit corps (année, liens, mention), et un état hover
   qui déplace ou révèle réellement quelque chose.
G. Anti-générique — la spec doit citer nommément 3 choses que le site NE fera
   PAS parce qu'elles sont le réflexe par défaut du secteur.
H. Site complet — au minimum 5 sections réelles (entrée + 4 de contenu), chacune
   avec sa copie intégrale écrite mot pour mot : titres, 2 à 5 phrases de
   description réelle par section, données chiffrées du secteur, libellés
   d'action. Une seule section « couverture » est un échec.
I. Navigation fonctionnelle — 4 à 6 entrées, chacune avec son libellé exact et
   sa cible réelle (ancre de section avec scroll doux, ou route), un état actif
   visible, un état hover, et le comportement mobile. Des mots décoratifs qui ne
   mènent nulle part sont un échec.
J. Textes de service obligatoires — pied de page avec mentions légales, année,
   coordonnées, et les liens utiles du secteur. Jamais de lorem, jamais de
   « texte à venir ».

Instruction finale de non-dérive à recopier telle quelle en fin de document :
« Ne t'écarte JAMAIS des valeurs numériques données dans ce document lors de la
génération du code. Si une valeur semble étrange ou non ronde, conserve-la
exactement telle quelle — une valeur arrondie par simplicité cassera l'alignement
visuel prévu. »`;

// ── Parsing de la critique ─────────────────────────────────────────────────
function parseCritique(raw: string, cycle: number, elementId: string, variant: number): GenesisCritique {
  let concept = 0, coherence = 0, aiSignature = 0, sensory = 0;
  let verdict: GenesisCritique["verdict"] = "RÉGÉNÉRER AVEC AJUSTEMENTS";
  let fixes: string[] = [];
  try {
    const line = raw.match(/\{[^{}]*"concept"[\s\S]*?\}\s*$/);
    if (line) {
      const j = JSON.parse(line[0]);
      concept = Number(j.concept) || 0;
      coherence = Number(j.coherence) || 0;
      aiSignature = Number(j.ai_signature) || 0;
      sensory = Number(j.sensory) || 0;
      if (typeof j.verdict === "string") verdict = j.verdict as GenesisCritique["verdict"];
      if (Array.isArray(j.fixes)) fixes = j.fixes.map(String);
    }
  } catch { /* parsing best-effort : on retombe sur le scan texte ci-dessous */ }
  if (!concept) {
    const nums = [...raw.matchAll(/\((\d{1,2})\s*\/\s*10\)|\b(\d{1,2})\s*\/\s*10/g)]
      .map(m => Number(m[1] ?? m[2])).filter(n => n >= 0 && n <= 10);
    [concept, coherence, aiSignature, sensory] = [nums[0] ?? 6, nums[1] ?? 6, nums[2] ?? 6, nums[3] ?? 6];
    if (/VERDICT\s*:?\s*ACCEPTER/i.test(raw)) verdict = "ACCEPTER";
    else if (/RÉGÉNÉRER ENTIÈREMENT|REGENERER ENTIEREMENT/i.test(raw)) verdict = "RÉGÉNÉRER ENTIÈREMENT";
  }
  const average = Math.round(((concept + coherence + aiSignature + sensory) / 4) * 10) / 10;
  return { cycle, elementId, variant, concept, coherence, aiSignature, sensory, average, verdict, fixes, raw };
}

/** Seuil de la spec : moyenne ≥ 7 ET aucun critère < 5. */
export function critiqueAccepted(c: GenesisCritique): boolean {
  return c.average >= 7 && Math.min(c.concept, c.coherence, c.aiSignature, c.sensory) >= 5;
}

// ── Évaluateur ISOLÉ : nouvel appel, aucune mémoire du générateur ──────────
async function evaluateVisual(dataUrl: string, intent: string, cycle: number, elementId: string, variant: number): Promise<GenesisCritique> {
  try {
    const res = await generateText({
      model: gateway(VISION_MODEL),
      system: P6_SYSTEM,
      messages: [{
        role: "user",
        content: [
          { type: "text", text: `INTENTION ÉCRITE (Scene Graph + concept) :\n${intent}\n\nÉvalue la PREMIÈRE image fournie.\n\n${CALIBRATION_NOTE}` },
          { type: "image", image: dataUrl },
          ...JUDGE_CALIBRATION_REF.map(image => ({ type: "image" as const, image })),
        ],
      }] as any,
      maxOutputTokens: 700,
      maxRetries: 1,
      abortSignal: AbortSignal.timeout(PHASE_TIMEOUT_MS),
    });
    return parseCritique(res.text || "", cycle, elementId, variant);
  } catch (e) {
    console.warn("[genesis] évaluateur KO:", (e as Error).message);
    return parseCritique("", cycle, elementId, variant);
  }
}

// ── Juge DESIGN de la maquette d'écran (phase 4bis) ────────────────────────
// Appel isolé, modèle multimodal. Il ne voit que l'image et l'intention : il
// n'a aucune mémoire du prompt qui a produit l'image.
/**
 * CONTRÔLE AUTOMATIQUE D'ANNOTATIONS — fait par le moteur, pas par un humain.
 * Une passe de vision dédiée, indépendante du juge design, dont le seul travail
 * est de dire si l'image contient des marques de travail (cotes en px, valeurs
 * em, pourcentages, codes hex, repères de coordonnées, lignes de mesure,
 * annotations de wireframe). Tout rendu qui en contient est disqualifié
 * automatiquement : il ne peut plus être retenu ni propagé.
 */
async function detectWorkAnnotations(dataUrl: string): Promise<string[]> {
  try {
    const res = await generateText({
      model: gateway(VISION_MODEL),
      system: "Tu es un contrôleur qualité. Tu regardes une capture de page web et tu cherches UNIQUEMENT les marques de travail qui ne devraient jamais apparaître sur un site fini : cotes en pixels (12px, 24 px), valeurs em/rem (0.02em), pourcentages de mise en page ou d'opacité (58%, 3.5%), codes couleur hex (#F4F4F4), repères de coordonnées, croix de repère, lignes ou fleches de mesure, encadrés de wireframe, textes de specification typographique (weight 400, letter-spacing). Les chiffres qui appartiennent au site sont NORMAUX et ne doivent PAS être signalés : pagination (01 / 04), prix, dates, heures, numéros d'édition, index. Réponds STRICTEMENT par une ligne JSON : {\"annotations\":[\"texte relevé\", ...]} — tableau vide si l'image est propre. Rien d'autre.",
      messages: [{
        role: "user",
        content: [
          { type: "text", text: "Relève les marques de travail visibles dans cette capture." },
          { type: "image", image: dataUrl },
        ],
      }] as any,
      maxOutputTokens: 600,
      maxRetries: 1,
      abortSignal: AbortSignal.timeout(PHASE_TIMEOUT_MS),
    });
    const raw = res.text || "";
    const arr = raw.match(/"annotations"\s*:\s*\[([\s\S]*?)\]/);
    if (!arr) return [];
    return [...arr[1].matchAll(/"([^"]{1,80})"/g)].map(m => m[1]).slice(0, 12);
  } catch (e) {
    console.warn("[genesis] contrôle d'annotations KO:", (e as Error).message);
    return [];
  }
}

/**
 * Un code hex écrit dans le prompt finissait DESSINÉ dans l'image (« #F4F4F4 »
 * imprimé en légende). Mais l'effacer purement et simplement privait le
 * générateur de tout contrôle chromatique : les rendus sortaient gris et ternes.
 * On traduit donc chaque hex en nom de couleur précis : la palette survit, le
 * code ne peut plus être recopié à l'écran.
 */
function hexToColourName(hex: string): string {
  const r = parseInt(hex.slice(0, 2), 16), g = parseInt(hex.slice(2, 4), 16), b = parseInt(hex.slice(4, 6), 16);
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  const l = (max + min) / 2 / 255;
  const sat = max === min ? 0 : (max - min) / (255 - Math.abs(max + min - 255));
  const light = l < 0.16 ? "near-black" : l < 0.32 ? "very dark" : l < 0.48 ? "dark" : l < 0.62 ? "mid-tone" : l < 0.8 ? "light" : "very light";
  if (sat < 0.1) return `${light} neutral grey`;
  let h = 0;
  if (max === r) h = ((g - b) / (max - min) + (g < b ? 6 : 0)) * 60;
  else if (max === g) h = ((b - r) / (max - min) + 2) * 60;
  else h = ((r - g) / (max - min) + 4) * 60;
  const hue = h < 12 ? "red" : h < 38 ? "orange-terracotta" : h < 62 ? "amber-yellow" : h < 95 ? "acid yellow-green" : h < 155 ? "green" : h < 185 ? "teal" : h < 205 ? "cyan-blue" : h < 250 ? "blue" : h < 285 ? "indigo-violet" : h < 320 ? "magenta" : h < 345 ? "pink" : "crimson";
  const chroma = sat < 0.3 ? "muted desaturated" : sat < 0.6 ? "" : "saturated";
  return `${light} ${chroma} ${hue}`.replace(/\s+/g, " ").trim();
}

/**
 * Le générateur d'images RECOPIE les mesures présentes dans le prompt : « 96px
 * -0.02em » s'est retrouvé écrit en plein titre, « 12px, letter-spacing 0.22em,
 * 51% height » collé en légende. Interdire par consigne n'a pas suffi (r11).
 * On retire donc les mesures du prompt lui-même et on les remplace par leur
 * équivalent qualitatif : le modèle ne peut plus dessiner ce qu'il ne lit plus.
 */
function scrubMeasurements(prompt: string): string {
  const pxWord = (n: number) => (n <= 14 ? "very small" : n <= 22 ? "small" : n <= 40 ? "medium-sized" : n <= 90 ? "large" : "very large");
  return prompt
    .replace(/(-?\d+(?:\.\d+)?)\s*px\b/gi, (_m, d) => pxWord(Math.abs(Number(d))))
    .replace(/(-?\d+(?:\.\d+)?)\s*(?:em|rem|pt|vw|vh)\b/gi, (_m, d) => (Number(d) < 0 ? "tight" : "open"))
    .replace(/letter[-\s]?spacing\s*:?\s*(tight|open)/gi, (_m, k) => (k === "tight" ? "tightly tracked" : "openly tracked"))
    .replace(/\b\d+(?:\.\d+)?\s*%/g, "roughly")
    .replace(/#([0-9a-fA-F]{6})\b/g, (_m, h) => hexToColourName(h))
    .replace(/[ \t]{2,}/g, " ");
}

/**
 * Lit les sous-scores du juge même quand sa réponse est TRONQUÉE. Le bug
 * observé sur r8/r10 : la ligne JSON commence mais n'est jamais fermée, la
 * regex exigeait l'accolade fermante, et le rendu se retrouvait noté 0/10 avec
 * tous ses sous-scores à 0 — ce n'était pas une maquette nulle, c'était le juge
 * illisible. On lit donc clé par clé, sans exiger un JSON valide.
 */
function parseJudgeScores(raw: string): { composition: number; typography: number; photo: number; anti_generic: number; hierarchy: number; interface: number } | null {
  const keys = ["composition", "typography", "photo", "anti_generic", "hierarchy", "interface"] as const;
  const out: any = {};
  let found = 0;
  for (const k of keys) {
    const m = new RegExp(`"${k}"\\s*:\\s*(-?\\d{1,2})`).exec(raw);
    if (m) { out[k] = Number(m[1]); found++; } else { out[k] = k === "interface" ? 0 : -1; }
  }
  if (found >= 4) return out;
  const slash = [...raw.matchAll(/\b(\d{1,2})\s*\/\s*10/g)].map(m => Number(m[1])).filter(n => n >= 0 && n <= 10);
  if (slash.length >= 5) {
    return { composition: slash[0], typography: slash[1], photo: slash[2], anti_generic: slash[3], hierarchy: slash[4], interface: slash[5] ?? 0 };
  }
  return null;
}

/** Affichage humain d'un score : -1 = rendu non jugé, pas un 0/10. */
function scoreLabel(n: number | undefined | null): string {
  if (n === undefined || n === null) return "non jugé";
  return n < 0 ? "non jugé" : `${n}/10`;
}

// ── Extraction du DESIGN SYSTEM depuis la maquette retenue ────────────────
// Une seule passe de vision sur l'image que l'utilisateur a cliquée (ou que le
// juge a retenue). Le JSON produit est verrouillé et redescendu à TOUTES les
// pages du site : c'est ce qui empêche la page 2 de dériver de la page 1.
const DESIGN_SYSTEM_SYSTEM = "Tu es directeur artistique. Tu regardes UNE maquette d'ecran finie et tu en releves le systeme de design, avec des valeurs exactes, mesurables, utilisables telles quelles par un agent de code. Tu n'inventes rien : tu decris ce que tu VOIS. Reponds STRICTEMENT en JSON, sans texte autour, avec ce schema : {\"palette\":{\"background\":\"#hex\",\"surface\":\"#hex\",\"ink\":\"#hex\",\"ink_muted\":\"#hex\",\"accent\":\"#hex\",\"accent_usage\":\"ou et comment l'accent est utilise\"},\"typography\":{\"display_family\":\"nom de police reelle proche de ce qui est vu\",\"display_source\":\"URL Google Fonts ou fontshare\",\"display_weight\":700,\"display_case\":\"uppercase|sentence\",\"display_tracking\":\"-2.4px\",\"hero_size\":\"14vw\",\"text_family\":\"...\",\"text_source\":\"URL\",\"text_weight\":400,\"text_size\":\"17px\",\"line_height\":1.5,\"scale\":[\"h1 14vw\",\"h2 48px\",\"h3 24px\",\"body 17px\",\"caption 12px\"]},\"layout\":{\"grid\":\"12 colonnes, gouttiere 24px\",\"max_width\":\"1440px\",\"page_padding\":\"48px\",\"section_rhythm\":\"160px\",\"density\":\"aere|dense\"},\"components\":{\"nav\":\"anatomie exacte de la barre de navigation : hauteur, position, contenu, alignement\",\"button_primary\":\"fond, encre, padding, rayon, casse, taille\",\"button_secondary\":\"...\",\"radius\":\"0px\",\"border\":\"1px solid #hex\",\"card\":\"... ou 'aucune carte'\",\"footer\":\"...\",\"present\":[\"liste des composants d'UI visibles dans la maquette\"]},\"imagery\":{\"treatment\":\"photo pleine bord a bord, N&B, grain, etc.\",\"ratio\":\"3:4\",\"placement\":\"...\"},\"motion\":{\"entry\":\"nature de l'animation d'entree\",\"duration_ms\":900,\"easing\":\"cubic-bezier(0.22, 1, 0.36, 1)\",\"stagger_ms\":90},\"forbidden\":[\"ce qui casserait ce systeme si une autre page le faisait\"]}";

export async function extractDesignSystem(dataUrl: string, brandName: string): Promise<string> {
  try {
    const res = await generateText({
      model: gateway(VISION_MODEL),
      system: DESIGN_SYSTEM_SYSTEM,
      messages: [{
        role: "user",
        content: [
          { type: "text", text: `Marque : ${brandName}. Releve le systeme de design de cette maquette. Valeurs exactes, JSON strict.` },
          { type: "image", image: dataUrl },
        ],
      }] as any,
      maxOutputTokens: 2500,
      maxRetries: 1,
      abortSignal: AbortSignal.timeout(PHASE_TIMEOUT_MS),
    });
    const raw = (res.text || "").trim();
    if (!raw) return "";
    try { return JSON.stringify(extractJson(raw), null, 2); } catch { return raw.slice(0, 6000); }
  } catch (e) {
    console.warn("[genesis] extraction du design system KO:", (e as Error).message);
    return "";
  }
}

export async function judgeMockup(dataUrl: string, intent: string): Promise<{ score: number; accepted: boolean; verdict: string; fixes: string[]; subs: { composition: number; typography: number; photo: number; anti_generic: number; hierarchy: number; interface: number } }> {
  try {
    const res = await generateText({
      model: gateway(VISION_MODEL),
      system: P4C_SYSTEM,
      messages: [{
        role: "user",
        content: [
          { type: "text", text: `INTENTION ÉCRITE :\n${intent}\n\nJuge la PREMIÈRE image fournie (la maquette d'écran).\n\n${CALIBRATION_NOTE}` },
          { type: "image", image: dataUrl },
          ...JUDGE_CALIBRATION_REF.map(image => ({ type: "image" as const, image })),
        ],
      }] as any,
      maxOutputTokens: 3000,
      maxRetries: 1,
      abortSignal: AbortSignal.timeout(PHASE_TIMEOUT_MS),
    });
    const raw = res.text || "";
    let fixes: string[] = [];
    const fixesLine = raw.match(/"fixes"\s*:\s*\[([\s\S]*?)\]/);
    if (fixesLine) fixes = [...fixesLine[1].matchAll(/"([^"]{4,})"/g)].map(m => m[1]);
    let nums = parseJudgeScores(raw);
    if (!nums) {
      // Réponse illisible : on ne fabrique pas un 0/10. Le rendu est marqué NON
      // JUGÉ (score -1) et exclu des comparaisons de progression.
      console.warn("[genesis] juge illisible (réponse tronquée ou hors format) — rendu marqué NON JUGÉ");
      return { score: -1, accepted: false, verdict: raw, fixes, subs: { composition: -1, typography: -1, photo: -1, anti_generic: -1, hierarchy: -1, interface: -1 } };
    }
    // Le critère « interface » peut manquer sur une réponse tronquée : on ne
    // pénalise alors pas la maquette, on l'ignore simplement dans la moyenne.
    // « photo » à -1 = maquette sans photographie assumée : critère sans objet,
    // exclu de la moyenne au lieu de plomber mécaniquement la note à 0.
    const all = [
      ...(nums.composition >= 0 ? [nums.composition] : []),
      ...(nums.typography >= 0 ? [nums.typography] : []),
      ...(nums.anti_generic >= 0 ? [nums.anti_generic] : []),
      ...(nums.hierarchy >= 0 ? [nums.hierarchy] : []),
      ...(nums.photo >= 0 ? [nums.photo] : []),
      ...(nums.interface > 0 ? [nums.interface] : []),
    ];
    if (!all.length) {
      return { score: -1, accepted: false, verdict: raw, fixes, subs: nums };
    }
    const score = Math.round((all.reduce((a, b) => a + b, 0) / all.length) * 10) / 10;
    const accepted = score >= 8 && Math.min(...all) >= 6;
    return { score, accepted, verdict: raw, fixes, subs: nums };
  } catch (e) {
    console.warn("[genesis] juge de maquette KO:", (e as Error).message);
    // Panne du juge : rendu NON JUGÉ (score -1). On ne le fait plus passer
    // pour validé, et on ne le note pas 0 non plus : il n'a pas été évalué.
    return { score: -1, accepted: false, verdict: "", fixes: [], subs: { composition: -1, typography: -1, photo: -1, anti_generic: -1, hierarchy: -1, interface: -1 } };
  }
}

function collectVisualElements(sceneGraph: any): { id: string; carrier: boolean; prompt: string; role: "background" | "element" }[] {
  const out: { id: string; carrier: boolean; prompt: string; role: "background" | "element" }[] = [];
  for (const s of sceneGraph?.sections ?? []) {
    const bg = s.background_layer;
    if (bg && (bg.type === "generated_image" || bg.type === "generated_video") && bg.generation_prompt) {
      out.push({ id: `${s.section_id}__bg`, carrier: false, prompt: String(bg.generation_prompt), role: "background" });
    }
    for (const el of s.elements ?? []) {
      if (el.type === "image" || el.type === "video") {
        out.push({
          id: String(el.element_id || `${s.section_id}__el${out.length}`),
          carrier: Boolean(el.concept_carrier),
          prompt: String(el.content || el.element_id || ""),
          role: "element",
        });
      }
    }
  }
  return out;
}

export interface RunGenesisOptions {
  brief: string;
  emit: (e: GenesisEvent) => void;
  /** Coupe la génération d'images (phases 5-7 en mode raisonnement seul). */
  skipVisuals?: boolean;
  /**
   * Mode « entraînement » : on s'arrête juste après la maquette d'écran validée
   * (phases 1 → 4bis). Aucun asset, aucune segmentation, aucune spec, aucun code.
   * Sert à observer la réflexion du moteur sans payer un run complet.
   */
  mockupOnly?: boolean;
  /**
   * Mode interactif : après chaque planche de maquettes, le moteur s'arrête et
   * demande à l'utilisateur de cliquer la proposition qu'il préfère, ou de
   * décrire en une phrase ce qu'il veut voir à la place. Le choix de
   * l'utilisateur fait autorité sur le verdict du juge.
   */
  interactive?: boolean;
  signal?: AbortSignal;
}

/**
 * Exécute le pipeline complet. Chaque phase est un appel LLM indépendant :
 * aucune continuité de conversation, donc l'évaluateur (phase 6) ne peut pas
 * « se donner raison » sur sa propre génération.
 */
// Étiquette tous les appels IA du run pour le suivi des crédits (ai-usage/).
export function runGenesis(opts: RunGenesisOptions): Promise<GenesisResult> {
  return runWithAiContext(
    { feature: "genesis", label: opts.brief.trim().slice(0, 80), runId: newRunId() },
    () => runGenesisInner(opts),
  );
}

async function runGenesisInner(opts: RunGenesisOptions): Promise<GenesisResult> {
  const t0 = Date.now();
  const runId = `gen_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
  const phases: GenesisPhaseLog[] = [];
  const emit = opts.emit;
  const brief = opts.brief.trim();

  emit({ type: "start", runId, brief });

  const phase = async (n: number, title: string, fn: () => Promise<string>): Promise<string> => {
    if (opts.signal?.aborted) throw new Error("aborted");
    emit({ type: "phase_start", phase: n, title });
    const s = Date.now();
    const output = await fn();
    const ms = Date.now() - s;
    phases.push({ phase: n, title, output, ms });
    emit({ type: "phase_done", phase: n, title, output, ms });
    return output;
  };

  // ── PHASE 1 — Positionnement de marque (texte pur) ───────────────────────
  const positioning = await phase(1, "Positionnement de marque", () =>
    call({ model: THINK_MODEL, system: P1_SYSTEM, prompt: `Demande de l'utilisateur : « ${brief} »`, maxTokens: 900, temperature: 0.7 }));

  // Le nom de marque est ARRÊTÉ ici et VERROUILLÉ pour tout le reste du run.
  // Bug observé avant ce verrou : le même run sortait VELOSTAAL sur la plupart
  // des variantes puis MAISON KRUIT sur la dernière, chaque prompt d'image
  // réinventant un nom à la volée.
  let brandName = (/NOM[_ ]DE[_ ]MARQUE\s*:\s*(.+)/i.exec(positioning)?.[1] ?? "")
    .replace(/["'«»*_.]/g, "").split("\n")[0].trim().slice(0, 40);
  if (!brandName) {
    try {
      brandName = (await call({
        model: FAST_MODEL,
        system: "Tu donnes UNIQUEMENT un nom commercial de marque, 1 à 3 mots, sans guillemets, sans explication, sans ponctuation finale.",
        prompt: `Demande : « ${brief} »\n\nPOSITIONNEMENT :\n${positioning.slice(0, 1500)}`,
        maxTokens: 24, temperature: 0.6,
      })).replace(/["'«».]/g, "").split("\n")[0].trim().slice(0, 40);
    } catch { brandName = ""; }
  }
  if (!brandName) brandName = "Atelier";
  // ── IDENTITÉ DE MARQUE (lockup) ──────────────────────────────────────────
  // Le nom ne suffisait pas : le générateur dessinait le mot dans une police
  // arbitraire, différente d'une variante à l'autre. On fait DÉCIDER un vrai
  // lockup (dessin du logotype + règle d'usage) et on le verrouille avec le nom.
  let brandIdentity = "";
  try {
    brandIdentity = (await call({
      model: CREATIVE_MODEL,
      system: BRAND_IDENTITY_SYSTEM,
      prompt: `Demande de l'utilisateur : « ${brief} »\n\nNOM DE MARQUE ARRÊTÉ : ${brandName}\n\nPOSITIONNEMENT (Phase 1) :\n${positioning.slice(0, 2000)}`,
      maxTokens: 700, temperature: 0.85,
    })).trim();
  } catch (e) {
    console.warn("[genesis] identité de marque indisponible :", (e as Error).message);
  }
  const identityLock = brandIdentity
    ? `\n\nIDENTITÉ DE MARQUE VERROUILLÉE (le logotype, décidé une fois pour tout le site) :\n${brandIdentity}\n\nCe logotype est le SEUL logo du site. Il est dessiné exactement de la même façon sur toutes les pages, dans la barre de navigation et dans le pied de page. Il est INTERDIT d'inventer un autre signe, une autre police de logotype, un monogramme différent ou un badge décoratif à côté.`
    : "";
  const nameLock = `NOM DE MARQUE VERROUILLÉ (décidé en Phase 1) : ${brandName}\nC'est le SEUL nom autorisé. Écris-le exactement ainsi partout où un nom de marque apparaît — dans le mot-titre, la navigation, le pied de page, les micro-textes. Il est INTERDIT d'inventer, de traduire, d'abréger ou de remplacer ce nom, y compris dans une variante ou une retouche.${identityLock}`;
  console.info(`[genesis] nom de marque verrouillé : ${brandName}`);
  if (brandIdentity) console.info(`[genesis] logotype arrêté : ${brandIdentity.replace(/\s+/g, " ").slice(0, 160)}`);
  emit({ type: "note", text: `Nom de marque arrêté : ${brandName}.` });

  // ── PHASE 2 — Traduction sensorielle (texte pur) ─────────────────────────
  const sensory = await phase(2, "Traduction sensorielle", () =>
    call({ model: THINK_MODEL, system: P2_SYSTEM, prompt: `Demande initiale : « ${brief} »\n\nPOSITIONNEMENT (Phase 1) :\n${positioning}`, maxTokens: 800, temperature: 0.7 }));

  // ── PHASE 3 — Association forcée / saut créatif (température haute) ──────
  // La phase 3 fait DEUX choses : le saut créatif, puis sa conversion en
  // mécanisme d'interaction chiffré (le « contrat d'interaction »). C'est ce
  // contrat qui fait que /genesis ne produit pas une landing page de plus :
  // le site est d'abord une machine, la page n'en est que le rendu au repos.
  let interaction = "";
  const association = await phase(3, "Association forcée — saut créatif", async () => {
    // Banque inter-projets : on relit tout ce qui a déjà été servi (associations,
    // mécaniques, polices, registres) et on l'interdit AVANT le saut créatif.
    const bankBlock = associationBankBlock();
    if (bankBlock) emit({ type: "note", text: "Idées déjà utilisées écartées avant la recherche." });
    const jump = await call({
      model: CREATIVE_MODEL, system: P3_SYSTEM,
      prompt: `Demande initiale : « ${brief} »\n\nPHASE 1 :\n${positioning}\n\nPHASE 2 :\n${sensory}${bankBlock}`,
      maxTokens: 1400, temperature: 1,
    });
    const retenue = /ASSOCIATION_RETENUE\s*:\s*(.+)/i.exec(jump)?.[1]?.trim().slice(0, 160) ?? "";
    upsertGenesisMemory(runId, { brief, association: retenue });
    const contractRaw = await call({
      model: CREATIVE_MODEL, system: P3B_SYSTEM,
      prompt: `Demande initiale : « ${brief} »\n\nPHASE 1 :\n${positioning}\n\nPHASE 2 :\n${sensory}\n\nPHASE 3 — SAUT CRÉATIF :\n${jump}`,
      maxTokens: 2500, temperature: 0.9,
    });
    try { interaction = JSON.stringify(extractJson(contractRaw), null, 2); }
    catch { interaction = contractRaw.trim(); }
    upsertGenesisMemory(runId, { navigation: String(interaction.match(/navigation_model"?\s*:?\s*"?([a-z-]+)/)?.[1] ?? "?") });
    return `${jump}\n\n── CONTRAT D'INTERACTION ──\n${interaction}`;
  });

  // ── PHASE 4 — Scene Graph structuré (JSON, toujours aucun visuel) ────────
  let sceneGraph: any = null;
  let sceneGraphRaw = await phase(4, "Scene Graph structuré", async () => {
    const raw = await call({
      model: THINK_MODEL, system: P4_SYSTEM,
      prompt: `Demande initiale : « ${brief} »\n\n${nameLock}\n\nPHASE 1 :\n${positioning}\n\nPHASE 2 :\n${sensory}\n\nPHASE 3 :\n${association}`,
      // En entraînement (maquette seule) on n'a pas besoin du scene graph
      // complet : on coupe le budget de tokens, ce qui divise la phase par ~3.
      maxTokens: opts.mockupOnly ? 3000 : 14000, temperature: 0.4,
    });
    try { sceneGraph = extractJson(raw); } catch {
      try {
        const repaired = await call({
          model: FAST_MODEL,
          system: "Tu répares du JSON invalide et tronqué. Réponds UNIQUEMENT avec le JSON corrigé et complet, sans texte autour, sans commentaire.",
          prompt: raw, maxTokens: 14000, temperature: 0,
        });
        sceneGraph = extractJson(repaired);
      } catch (e) {
        // Dernier recours : jamais d'échec total du run à cause du JSON. On
        // repart d'un graphe minimal construit sur le texte des phases 1-3.
        console.warn("[genesis] scene graph illisible → repli texte :", (e as Error).message);
        sceneGraph = {
          concept_summary: association.slice(0, 1200),
          elements: [],
          _fallback: true,
        };
      }
    }
    return JSON.stringify(sceneGraph, null, 2);
  });

  const conceptSummary = String(sceneGraph?.concept_summary || "");
  const intent = `${nameLock}\n\nCONCEPT : ${conceptSummary}\n\nREGISTRE SENSORIEL (Phase 2) :\n${sensory}\n\nSCENE GRAPH :\n${sceneGraphRaw.slice(0, 6000)}`;

  // ── PHASE 5 — Décision d'assets + génération multi-variantes ─────────────
  const assets: GenesisAsset[] = [];
  const critiques: GenesisCritique[] = [];
  const mockups: GenesisMockup[] = [];
  // État partagé : `mockup` est réaffecté depuis des closures imbriquées (juge,
  // porte de choix). Un `let` verrait son type réduit à `null` par l'analyse de
  // flux hors de ces closures ; un conteneur garde le vrai type partout.
  const mockupRef: { current: GenesisMockup | null } = { current: null };
  let degraded = false;
  const weaknesses: string[] = [];
  /** Corrections du juge restées non appliquées sur la maquette conservée. */
  let pendingFixes: string[] = [];

  const assetPlan = await phase(5, "Décision d'assets + variantes", async () => {
    const raw = await call({
      model: THINK_MODEL, system: P5_SYSTEM,
      prompt: `${nameLock}\n\nSCENE GRAPH :\n${sceneGraphRaw}\n\nCONCEPT (Phase 3) :\n${association.slice(0, 2000)}`,
      maxTokens: 4000, temperature: 0.4,
    });
    let plan: any = null;
    try { plan = extractJson(raw); } catch { plan = { decisions: [] }; }

    if (!opts.skipVisuals) {
      // ── PHASE 4bis — MAQUETTE D'ÉCRAN + VERDICT DESIGN ──────────────────
      // On dessine la page entière AVANT d'écrire la moindre ligne de code :
      // rater ici ne coûte qu'une image, rater après coûte un build complet.
      // Tant que le juge design ne valide pas, on régénère LA MAQUETTE.
      // Patron de composition + registre chromatique tirés au sort : deux
      // idées voisines ne peuvent plus sortir la même page beige.
      const memory = readGenesisMemory().slice(-6);
      const pattern = pickUnused(MOCKUP_PATTERNS, memory.map(m => m.pattern));
      const palette = pickUnused(MOCKUP_PALETTES, memory.map(m => m.palette));
      const banned = memory.length
        ? `\n\nDÉJÀ SERVI AUX MARQUES PRÉCÉDENTES DE CETTE SESSION — INTERDIT DE RECOMMENCER :\n${memory.map(m => `- « ${m.brief.slice(0, 70)} » : ${m.pattern.split(" : ")[0]} / ${m.palette.split(" — ")[1] ?? m.palette} / ${m.navigation}`).join("\n")}\n\nCompare ta composition à cette liste avant de répondre. Si elle ressemble à l'une d'elles (même famille chromatique, même mise en page, même mécanique), change de parti pris.`
        : "";
      writeGenesisMemory({ brief, pattern, palette, navigation: String(interaction.match(/navigation_model"?\s*:?\s*"?([a-z-]+)/)?.[1] ?? "?"), at: Date.now() });
      emit({ type: "note", text: "Direction artistique tirée pour cette page." });
      const basePrompt = await call({
        model: CREATIVE_MODEL, system: P4B_SYSTEM,
        prompt: `${nameLock}\n\n${TASTE_LOCK}\n\n${pattern}\n\n${palette}${banned}\n\nSCENE GRAPH :\n${sceneGraphRaw.slice(0, 8000)}\n\nREGISTRE SENSORIEL :\n${sensory}\n\nCONCEPT :\n${association.slice(0, 1500)}\n\nCONTRAT D'INTERACTION (l'état de repos à représenter) :\n${interaction.slice(0, 3000)}`,
        maxTokens: 900, temperature: 0.9,
      });

      // En mode interactif c'est l'utilisateur qui arrête le moteur en cliquant
      // une proposition : on l'autorise donc à redemander plusieurs planches.
      const interactive = opts.interactive === true;
      const maxRounds = interactive ? GENESIS_MAX_CHOICE_ROUNDS : GENESIS_MAX_MOCKUP_ROUNDS;
      const maxRenders = interactive ? GENESIS_MOCKUP_BATCH * GENESIS_MAX_CHOICE_ROUNDS : GENESIS_MAX_MOCKUP_RENDERS;
      /** Direction donnée à l'écrit par l'utilisateur au tour précédent. */
      let userDirection = "";
      /** Attend le clic de l'utilisateur sur une proposition. */
      const askChoice = (batch: GenesisMockup[], round: number): Promise<GenesisChoiceReply | null> => {
        const options: GenesisChoiceOption[] = batch.map((m, i) => ({
          id: `${m.round ?? round}-${m.variant ?? i + 1}-${m.attempt}`,
          url: m.url,
          score: m.score,
          label: `Proposition ${i + 1}`,
        }));
        emit({
          type: "choice", runId, round, options, canAskMore: round < maxRounds,
          question: round < maxRounds
            ? "Clique la proposition que tu préfères. Si aucune ne te plaît, écris en une phrase ce que tu veux voir à la place et je regénère une nouvelle planche."
            : "Dernière planche. Clique la proposition que tu préfères.",
        });
        return new Promise<GenesisChoiceReply | null>((resolve) => {
          const timer = setTimeout(() => { pendingChoices.delete(runId); resolve(null); }, GENESIS_CHOICE_TIMEOUT_MS);
          pendingChoices.set(runId, (r) => { clearTimeout(timer); resolve(r); });
        });
      };

      let renders = 0;
      const renderAndJudge = async (prompt: string, round: number, variant: number): Promise<GenesisMockup | null> => {
        if (renders >= maxRenders) return null;
        renders++;
        const attempt = renders;
        // Le prompt effectivement envoyé au générateur est débarrassé de toute
        // mesure chiffrée (px/em/%/hex) : c'était la source des annotations.
        const drawPrompt = scrubMeasurements(prompt);
        const url = await generateContentImage(
          `Full-screen desktop website homepage screenshot, 16:9, edge to edge, no browser chrome. `
          + `MANDATORY: the only brand name that may appear anywhere in this image is "${brandName}", spelled exactly like that. `
          + `Never invent, translate, abbreviate or replace it with any other name, in the logo, the navigation, the display word or any small text. `
          + `MANDATORY: this is a finished website screenshot, never an annotated design plan. Do NOT render any measurement annotation: no percentage labels, `
          + `no pixel dimensions, no coordinate markers, no dimension lines or arrows, no wireframe callouts, no layout guide overlays, no ruler marks. `
          + `The only text visible is real website interface text. `
          + drawPrompt
          + ` FINAL CONSTRAINT, overrides anything above: this is a finished website screenshot. No measurement annotations of any kind rendered in the image:`
          + ` no percentage labels, no pixel dimensions, no opacity labels, no coordinate markers, no dimension lines or arrows, no wireframe callouts, no layout guide overlays, no ruler ticks.`
          + ` Numbers may appear only when they belong to the website itself (pagination, price, date, index).`,
          "wide", 1920,
          // Aucune refImages : la référence de goût ne doit jamais entrer dans
          // le générateur, sinon toutes les pages se mettent à lui ressembler.
          { allowText: true },
        );
        if (!url) return null;
        // Le moteur juge l'image lui-même. Le contrôle d'annotations est une
        // SECONDE passe de vision : on ne la paie que sur les rendus qui
        // peuvent encore gagner (score >= 6). Un rendu à 4/10 est de toute
        // façon refusé, inutile de vérifier ses cotes.
        const j = await judgeMockup(url, intent);
        const annotations = j.score >= 6 ? await detectWorkAnnotations(url) : [];
        const dirty = annotations.length > 0;
        const m: GenesisMockup = {
          url, prompt, attempt,
          // Un rendu annoté est disqualifié : plafonné à 2/10 (jamais en dessous
          // du -1 « non jugé », qui a un autre sens) et jamais accepté.
          score: dirty && j.score >= 0 ? Math.min(j.score, 2) : j.score,
          accepted: dirty ? false : j.accepted,
          verdict: dirty ? `ANNOTATIONS DE TRAVAIL VISIBLES DANS L'IMAGE (disqualifiant) : ${annotations.join(" | ")}\n\n${j.verdict}` : j.verdict,
          fixes: dirty ? ["Supprimer toute mesure chiffrée dessinée dans l'image (px, em, %, hex, repères) : ce doit être une capture de site fini.", ...j.fixes] : j.fixes,
          subs: j.subs, round, variant, annotations,
        };
        if (dirty) console.info(`[genesis] rendu ${attempt} disqualifié — annotations détectées : ${annotations.join(" | ")}`);
        mockups.push(m);
        if (!mockupRef.current || m.score > mockupRef.current.score) mockupRef.current = m;   // -1 (non jugé) ne peut jamais battre un rendu jugé
        emit({ type: "asset", asset: { elementId: "__mockup", role: "mockup", url, prompt, variant: attempt, score: j.score } });
        return m;
      };

      // ── RÈGLE 1 — la génération initiale est TOUJOURS parallèle ──────────
      // Un round = 4 variantes rendues dans le même tour, chacune ne faisant
      // varier QU'UN SEUL paramètre par rapport à la base. Jamais une variante
      // unique testée isolément au départ.
      const runRound = async (prompt: string, round: number): Promise<GenesisMockup[]> => {
        const axes = [
          "",
          "SEULE VARIATION PAR RAPPORT A LA BASE — ANGLE DE CAMERA : shoot the same scene from a slightly lower camera, a few degrees below the subject axis. Everything else (framing of the display word, palette, lighting, position of every element) stays strictly identical.",
          "SEULE VARIATION PAR RAPPORT A LA BASE — INTENSITE LUMINEUSE : same scene with the light one stop harder and more directional, deeper shadows. Everything else (camera angle, palette, typography, position of every element) stays strictly identical.",
          "SEULE VARIATION PAR RAPPORT A LA BASE — POSITION DE L'ELEMENT CENTRAL : shift the photographed subject clearly off-axis so it crops different letters of the display word. Everything else (camera angle, lighting, palette, type size) stays strictly identical.",
        ];
        emit({ type: "note", text: round === 1 ? "Plusieurs pistes explorées en parallèle." : "Nouvelles pistes explorées en parallèle." });
        const outs = await Promise.all(axes.slice(0, GENESIS_MOCKUP_BATCH).map((axe, k) => renderAndJudge(axe ? `${prompt}\n\n${axe}` : prompt, round, k + 1)));
        return outs.filter(Boolean) as GenesisMockup[];
      };

      // ── RÈGLE 2 — une correction n'est poursuivie que si elle PROGRESSE ──
      // Progression = score global en hausse ET majorité des sous-scores en
      // hausse. Un score global qui monte grâce à un seul critère pendant que
      // les autres baissent n'est pas une progression : on repart sur un
      // nouveau round de variantes au lieu de retoucher la même base.
      const progressed = (prev: GenesisMockup, cur: GenesisMockup): { ok: boolean; why: string } => {
        if (cur.score < 0 || prev.score < 0) return { ok: false, why: "rendu non jugé (juge illisible) — pas de comparaison possible" };
        if (!prev.subs || !cur.subs) return { ok: cur.score > prev.score, why: "sous-scores indisponibles" };
        if (cur.score <= prev.score) return { ok: false, why: `score global ${cur.score} <= ${prev.score}` };
        const keys: (keyof NonNullable<GenesisMockup["subs"]>)[] = ["composition", "typography", "photo", "anti_generic", "hierarchy", "interface"];
        let up = 0, total = 0;
        for (const k of keys) {
          const a = prev.subs[k], b = cur.subs[k];
          if (a < 0 || b < 0) continue;   // critère sans objet : hors comptage
          total++;
          if (b > a) up++;
        }
        if (!total) return { ok: true, why: "aucun sous-score comparable" };
        return { ok: up * 2 > total, why: `${up}/${total} sous-scores en hausse` };
      };

      let accepted: GenesisMockup | null = null;
      for (let round = 1; round <= maxRounds && !accepted && renders < maxRenders; round++) {
        const roundBase = round === 1
          ? basePrompt
          : await call({
              model: THINK_MODEL, system: P4B_SYSTEM,
              prompt: `${nameLock}\n\n${TASTE_LOCK}\n\n${pattern}\n\n${palette}${banned}${userDirection ? `\n\nDEMANDE EXPLICITE DU CLIENT — ELLE PRIME SUR TOUT LE RESTE, APPLIQUE-LA LITTÉRALEMENT :\n${userDirection}` : ""}\n\nLes compositions précédentes ont été REFUSÉES par le directeur artistique et les retouches successives ne progressaient plus. Il faut CHANGER DE PISTE, pas retoucher.\n\nPISTES DÉJÀ REFUSÉES (à ne pas reproduire) :\n${mockups.map(m => `- (${m.score}/10) ${m.prompt.slice(0, 220)}`).join("\n")}\n\nDERNIER VERDICT :\n${mockupRef.current?.verdict?.slice(0, 1200) ?? ""}\n\nSCENE GRAPH :\n${sceneGraphRaw.slice(0, 5000)}\n\nÉCRIS UN NOUVEAU PROMPT COMPLET, autoportant, structure 1→7, sur une piste visuellement DIFFÉRENTE des précédentes (autre mise en page, autre rapport entre le mot-titre et le sujet photographié).`,
              maxTokens: 900, temperature: 0.95,
            }).then(t => t.trim() || basePrompt);

        const batch = await runRound(roundBase, round);
        if (!batch.length) break;

        // ── PORTE DE CHOIX (mode interactif) ──────────────────────────────
        // Le moteur ne tranche plus seul : il montre la planche et attend le
        // clic. Le choix de l'utilisateur vaut validation, même si le juge
        // avait mis une note basse — c'est son goût qui décide, pas le score.
        if (interactive) {
          const reply = await askChoice(batch, round);
          if (reply && reply.kind === "pick") {
            const picked = batch.find((m, i) => `${m.round ?? round}-${m.variant ?? i + 1}-${m.attempt}` === reply.id) ?? null;
            if (picked) {
              picked.accepted = true;
              picked.chosenByUser = true;
              accepted = picked;
              mockupRef.current = picked;
              emit({ type: "choice_done", runId, picked: reply.id });
              emit({ type: "note", text: "Proposition retenue par toi — je continue sur celle-là." });
              break;
            }
          }
          if (reply && reply.kind === "more") {
            userDirection = reply.prompt.trim().slice(0, 1200);
            emit({ type: "choice_done", runId, picked: null });
            emit({ type: "note", text: userDirection ? `Nouvelle piste demandée : ${userDirection}` : "Nouvelle planche demandée." });
            continue;   // on repart sur un round complet, pas sur des retouches
          }
          // Pas de réponse (délai dépassé) : le moteur reprend la main.
          emit({ type: "choice_done", runId, picked: null });
          emit({ type: "note", text: "Aucun choix reçu — je continue sur la proposition la mieux notée." });
        }

        accepted = batch.find(m => m.accepted) ?? null;
        if (accepted) break;

        // Correction séquentielle sur la meilleure base du round, 3 essais max.
        const judged = batch.filter(b => b.score >= 0);
        let base = (judged.length ? judged : batch).slice().sort((a, b) => b.score - a.score)[0];
        for (let tryNo = 1; tryNo <= GENESIS_MAX_MOCKUP_TRIES && renders < maxRenders; tryNo++) {
          const rewritten = await call({
            model: THINK_MODEL, system: P4B_SYSTEM,
            prompt: `${nameLock}\n\n${TASTE_LOCK}\n\n${pattern}\n\n${palette}${banned}\n\nVoici un prompt de maquette et le verdict du directeur artistique qui l'a REFUSÉ.\n\nPROMPT REFUSÉ :\n${base.prompt}\n\nVERDICT (${base.score}/10) :\n${base.verdict}\n\nCORRECTIONS EXIGÉES :\n- ${base.fixes.join("\n- ")}\n\nSCENE GRAPH :\n${sceneGraphRaw.slice(0, 5000)}\n\nRÉÉCRIS INTÉGRALEMENT le prompt (pas une liste de corrections : un nouveau prompt complet, autoportant, respectant la structure 1→7) en corrigeant chaque reproche. Change concrètement la composition, pas seulement les adjectifs.`,
            maxTokens: 900, temperature: 0.95,
          });
          const cur = await renderAndJudge(rewritten.trim() || base.prompt, round, base.variant ?? 1);
          if (!cur) break;
          if (cur.accepted) { accepted = cur; break; }
          const p = progressed(base, cur);
          console.info(`[genesis] retouche ${tryNo} round ${round} : ${base.score} -> ${cur.score} (${p.why}) — ${p.ok ? "progression" : "stagnation, changement de piste"}`);
          if (!p.ok) {
            emit({ type: "note", text: "Cette piste ne progresse plus — exploration d'autres pistes." });
            break;
          }
          base = cur;
        }
      }

      if (!accepted) {
        degraded = true;
        weaknesses.push(`maquette d'écran : seuil design non atteint après ${mockups.length} rendus (meilleur ${scoreLabel(mockupRef.current?.score)}). ${(mockupRef.current?.fixes ?? []).join(" · ")}`);
        emit({ type: "note", text: "Composition d'ensemble retenue parmi les pistes explorées." });
      }

      // ── RÈGLE 3 — cohérence Phase 4 / Phase 5 ───────────────────────────
      // La maquette retenue n'est presque jamais celle prévue par le Scene
      // Graph : on reporte la direction réellement retenue DANS le Scene Graph
      // pour que les sections suivantes ne continuent pas sur l'ancienne idée.
      const kept = mockupRef.current;
      if (kept && !kept.accepted) {
        // La maquette conservée porte le verdict REGENERER : ce n'est PAS une
        // direction validée. On ne réécrit pas le Scene Graph dessus (sinon le
        // concept de la Phase 3 dérive vers une composition refusée), on note
        // les corrections restées en attente et on le dit explicitement.
        degraded = true;
        pendingFixes = kept.fixes.slice();
        weaknesses.push(`maquette non validée (${kept.score}/10, verdict REGENERER) — direction NON propagée vers la Phase 4. Corrections en attente : ${kept.fixes.join(" · ") || "non détaillées"}`);
        sceneGraph.direction_non_validee = {
          score: kept.score,
          corrections_en_attente: kept.fixes,
          note: "Le Scene Graph de la Phase 4 n'a PAS été modifié : la maquette la mieux notée n'a pas été validée par le directeur artistique.",
        };
        sceneGraphRaw = JSON.stringify(sceneGraph, null, 2);
        emit({ type: "note", text: "Meilleure composition conservée sans validation — le parti pris d'origine est maintenu." });
        console.info(`[genesis] maquette non validée (${kept.score}/10) — scene graph NON patché. Corrections en attente : ${kept.fixes.join(" | ")}`);
        const font0 = String(sceneGraph?.typography?.primary_font ?? "");
        if (font0) {
          upsertGenesisMemory(runId, { font: font0 });
          if (usesBannedFont(font0)) {
            weaknesses.push(`typographie : police réflexe « ${font0} » retenue malgré l'interdiction.`);
            console.warn(`[genesis] police interdite retenue : ${font0}`);
          }
        }
      } else if (kept) {
        try {
          const patchRaw = await call({
            model: THINK_MODEL, system: P4D_SYSTEM,
            prompt: `SCENE GRAPH PRÉVU (Phase 4) :\n${sceneGraphRaw.slice(0, 9000)}\n\nPROMPT DE LA MAQUETTE RETENUE (Phase 5, ${kept.score}/10) :\n${kept.prompt}\n\nVERDICT DU DIRECTEUR ARTISTIQUE SUR CETTE MAQUETTE :\n${kept.verdict.slice(0, 1500)}`,
            maxTokens: 1200, temperature: 0.2,
          });
          const patch = extractJson(patchRaw);
          if (patch && patch.diverge) {
            sceneGraph.direction_retenue = {
              source: "maquette Phase 5",
              score: kept.score,
              ecarts: patch.ecarts ?? [],
              hero_composition: patch.hero_composition ?? "",
              consignes_sections_suivantes: patch.consignes_sections_suivantes ?? [],
            };
            if (patch.palette) sceneGraph.palette = { ...(sceneGraph.palette ?? {}), ...patch.palette };
            if (patch.typography) sceneGraph.typography = { ...(sceneGraph.typography ?? {}), ...patch.typography };
            sceneGraphRaw = JSON.stringify(sceneGraph, null, 2);
            emit({ type: "note", text: "Direction retenue reportée sur l'ensemble de la page." });
            console.info(`[genesis] scene graph resynchronisé — écarts : ${(patch.ecarts ?? []).join(" | ")}`);
          } else {
            console.info("[genesis] scene graph déjà cohérent avec la maquette retenue");
          }
          const font = String(patch?.typography?.primary_font ?? sceneGraph?.typography?.primary_font ?? "");
          if (font) {
            upsertGenesisMemory(runId, { font });
            if (usesBannedFont(font)) {
              weaknesses.push(`typographie : police réflexe « ${font} » retenue malgré l'interdiction.`);
              console.warn(`[genesis] police interdite retenue : ${font}`);
            }
          }
        } catch (e) {
          console.warn("[genesis] resynchronisation du scene graph KO:", (e as Error).message);
        }
      }

      if (opts.mockupOnly) return JSON.stringify(plan, null, 2);

      const visual = collectVisualElements(sceneGraph);
      const carriers = visual.filter(v => v.carrier).slice(0, 2);
      const targets = carriers.length ? carriers : visual.slice(0, 1);

      for (const target of targets) {
        const decision = (plan.decisions ?? []).find((d: any) => d.element_id === target.id);
        const basePrompt = String(decision?.base_prompt || target.prompt);
        const variantPrompts: string[] = Array.isArray(decision?.variants) && decision.variants.length
          ? decision.variants.slice(0, GENESIS_MAX_VARIANTS).map((v: any) => String(v.prompt || basePrompt))
          : [
              basePrompt,
              `${basePrompt}. Variante : angle de caméra légèrement plus bas, tout le reste identique.`,
              `${basePrompt}. Variante : intensité lumineuse réduite d'un cran, tout le reste identique.`,
            ];

        const results = await Promise.all(variantPrompts.map(p => generateContentImage(p, "wide", 1600)));
        results.forEach((url, i) => {
          if (!url) return;
          const asset: GenesisAsset = { elementId: target.id, role: target.role, url, prompt: variantPrompts[i], variant: i + 1 };
          assets.push(asset);
          emit({ type: "asset", asset });
        });
      }

      // ── PHASE 6 — Boucle d'auto-critique visuelle (évaluateur isolé) ─────
      for (const target of targets) {
        let pool = assets.filter(a => a.elementId === target.id);
        if (!pool.length) continue;
        let best: { asset: GenesisAsset; c: GenesisCritique } | null = null;

        for (let cycle = 1; cycle <= GENESIS_MAX_CRITIQUE_CYCLES; cycle++) {
          const evals = await Promise.all(pool.map(a => evaluateVisual(a.url, intent, cycle, a.elementId, a.variant)));
          evals.forEach((c, i) => { pool[i].score = c.average; critiques.push(c); emit({ type: "critique", critique: c }); });

          const ranked = evals.map((c, i) => ({ c, asset: pool[i] })).sort((a, b) => b.c.average - a.c.average);
          if (!best || ranked[0].c.average > best.c.average) best = ranked[0];
          if (critiqueAccepted(ranked[0].c)) break;
          if (cycle === GENESIS_MAX_CRITIQUE_CYCLES) {
            degraded = true;
            weaknesses.push(`${target.id} : seuil non atteint après ${GENESIS_MAX_CRITIQUE_CYCLES} cycles (meilleur score ${best.c.average}/10). Points faibles : ${best.c.fixes.join(" · ") || "non détaillés"}`);
            emit({ type: "note", text: `Seuil non atteint sur ${target.id} — livraison de la meilleure variante (${best.c.average}/10).` });
            break;
          }
          // Régénération ciblée à partir des correctifs demandés par l'évaluateur.
          const fixes = ranked[0].c.fixes.join("\n- ");
          const correctedPrompt = `${ranked[0].asset.prompt}\n\nCorrections obligatoires demandées par l'évaluateur :\n- ${fixes}`;
          const regen = await generateContentImage(correctedPrompt, "wide", 1600);
          if (!regen) break;
          const asset: GenesisAsset = { elementId: target.id, role: target.role, url: regen, prompt: correctedPrompt, variant: (pool.at(-1)?.variant ?? 0) + 1 };
          assets.push(asset);
          emit({ type: "asset", asset });
          pool = [asset];
        }
      }
    }
    return JSON.stringify(plan, null, 2);
  });

  if (opts.mockupOnly) {
    const partial: GenesisResult = {
      runId, brief, brandName, brandIdentity, pendingFixes, positioning, sensory, association, interaction, sceneGraph,
      assetPlan, assets, critiques, segmentation: "", designSystem: "", spec: "", mockups, mockup: mockupRef.current, phases,
      degraded, weaknesses, durationMs: Date.now() - t0,
    };
    emit({ type: "done", runId, result: partial });
    return partial;
  }

  // La phase maquette est terminée : on figé la maquette retenue dans une
  // constante locale, la suite ne fait plus que la lire.
  const keptMockup = mockupRef.current;

  // ── Design system verrouillé, relevé sur la maquette retenue ─────────────
  // Une passe de vision sur l'image que l'utilisateur a cliquée (ou que le juge
  // a retenue). Le résultat redescend en Phase 8 et dans le brief de
  // construction : c'est ce qui fait que TOUTES les pages partagent la même
  // palette, la même typo et les mêmes composants que l'image choisie.
  let designSystem = "";
  if (keptMockup?.url) {
    designSystem = await extractDesignSystem(keptMockup.url, brandName);
    if (designSystem) {
      emit({ type: "note", text: `Design system relevé sur la maquette retenue${keptMockup.chosenByUser ? " (celle que tu as choisie)" : ""} — il s'applique à chaque page du site.` });
    } else {
      emit({ type: "note", text: "Design system non relevé sur la maquette (passe de vision en échec) — la spec reste guidée par la description de la maquette." });
    }
  }
  const designLock = designSystem
    ? `DESIGN SYSTEM VERROUILLÉ — S'APPLIQUE À CHAQUE PAGE DU SITE, AUCUNE DÉRIVE
Relevé directement sur la maquette retenue. Ces valeurs sont la loi : la home, les pages internes, les listes, les fiches, les formulaires, la 404 et le pied de page utilisent exactement la même palette, les mêmes polices, la même échelle typographique, les mêmes composants, le même rayon, les mêmes filets et les mêmes durées d'animation. Une page qui introduit une autre couleur d'accent, une autre police, des cartes arrondies ou un autre style de bouton est un ÉCHEC.

${designSystem}`
    : "";

  // ── PHASE 7 — Décision de découpage / segmentation ───────────────────────
  const segmentation = await phase(7, "Décision de découpage", async () => {
    const raw = await call({
      model: THINK_MODEL, system: P7_SYSTEM,
      prompt: `SCENE GRAPH :\n${sceneGraphRaw}${keptMockup ? `\n\nUne maquette d'écran validée existe : chaque découpe doit produire un élément cohérent avec elle (même lumière, même angle, même échelle relative).` : ""}`,
      maxTokens: 2000, temperature: 0.3,
    });
    let cut: any = null;
    try { cut = extractJson(raw); } catch { return raw; }
    if (!opts.skipVisuals) {
      for (const c of (cut.cutouts ?? []).slice(0, 2)) {
        const url = await generateContentImage(
          `${c.segmentation_prompt}. Sujet seul, fond entièrement transparent, aucun décor, aucune ombre portée sur le fond.`,
          "square", 1200,
        );
        if (url) {
          const asset: GenesisAsset = { elementId: String(c.element_id), role: "cutout", url, prompt: String(c.segmentation_prompt), variant: 1, segmented: true };
          assets.push(asset);
          emit({ type: "asset", asset });
        }
      }
    }
    return JSON.stringify(cut, null, 2);
  });

  // ── PHASE 8 — Spec de précision finale ───────────────────────────────────
  const assetIndex = assets.map(a => `- ${a.elementId} (${a.role}${a.segmented ? ", détouré" : ""}, variante ${a.variant}${a.score !== undefined ? `, score ${a.score}/10` : ""}) → asset://${runId}/${a.elementId}/${a.variant}`).join("\n") || "- (aucun asset généré : mode raisonnement seul)";

  const spec = await phase(8, "Spec de précision finale", () =>
    call({
      model: THINK_MODEL, system: P8_SYSTEM,
      prompt: `Demande initiale : « ${brief} »

${nameLock}

${designLock}

PHASE 1 — POSITIONNEMENT :
${positioning}

PHASE 2 — SENSORIEL :
${sensory}

PHASE 3 — CONCEPT / INTERACTION :
${association}

CONTRAT D'INTERACTION (à recopier et rendre implémentable en section 8) :
${interaction}

PHASE 4 — SCENE GRAPH :
${sceneGraphRaw}

PHASE 5 — PLAN D'ASSETS :
${assetPlan}

ASSETS RÉELLEMENT DISPONIBLES :
${assetIndex}

PHASE 7 — DÉCOUPAGE :
${segmentation}

${keptMockup ? `MAQUETTE D'ÉCRAN DE RÉFÉRENCE (déjà validée par le directeur artistique, score ${keptMockup.score}/10) :
Identifiant : asset://${runId}/__mockup/${keptMockup.attempt}
Description de la composition rendue :
${keptMockup.prompt}

Verdict du directeur artistique :
${keptMockup.verdict.slice(0, 1500)}

RÈGLE ABSOLUE : la page construite doit REPRODUIRE cette maquette — même patron
de composition, même géométrie, même cadrage, même palette, même échelle
typographique, mêmes zones de vide, même ordre de superposition. Seule exception :
tout le TEXTE est recomposé en vraie typographie HTML (la maquette contient du
faux texte, il ne doit jamais être repris tel quel ni intégré comme image).
Décris dans les sections 5 et 6 chaque écart autorisé, et aucun autre.` : ""}

${designLock ? `\n\nRÈGLE MULTI-PAGES : recopie le DESIGN SYSTEM VERROUILLÉ tel quel dans la section 1 de la spec, puis ajoute une section « Application multi-pages » qui liste chaque page prévue du site et, pour chacune, les composants du système réutilisés. Aucune page ne redéfinit une couleur, une police, un rayon ou un style de bouton.` : ""}

Compile maintenant la spec de précision finale.`,
      maxTokens: 8000, temperature: 0.3,
    }));

  const specFull = designLock ? `${designLock}\n\n---\n\n${spec}` : spec;

  const result: GenesisResult = {
    runId, brief, brandName, brandIdentity, pendingFixes, positioning, sensory, association, interaction, sceneGraph,
    assetPlan, assets, critiques, segmentation, designSystem, spec: specFull, mockups, mockup: keptMockup, phases,
    degraded, weaknesses, durationMs: Date.now() - t0,
  };
  emit({ type: "done", runId, result });
  return result;
}

/** Détecte la commande d'activation en tête de message : « /genesis <brief> ». */
export function parseGenesisCommand(message: string): { active: boolean; brief: string } {
  const m = (message || "").trim();
  const hit = m.match(/^\/(genesis|vision)\b[\s:]*([\s\S]*)$/i);
  if (!hit) return { active: false, brief: m };
  return { active: true, brief: (hit[2] || "").trim() };
}
