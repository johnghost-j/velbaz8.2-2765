// ─── Passe de Contrôle Qualité Fonctionnel ───────────────────────────────────
// Le build (`vite build`) ne vérifie QUE la compilation. Or un bouton mort, un
// lien cassé, une liste statique en dur, une feature IA débranchée ou un
// console.log oublié COMPILENT parfaitement — et donnent un site qui "a l'air
// fini" mais dont la moitié ne fonctionne pas.
//
// Ce module scanne le code généré à la recherche de ces anti-patterns
// FONCTIONNELS, puis demande à l'IA de RÉÉCRIRE la page pour tout brancher
// pour de vrai. C'est le levier #1 de la qualité "tout est fonctionnel et
// perfectionné".

import { generateText } from "ai";
import { gateway } from "../agent/gateway";

// Sonnet 4.6 pour toutes les passes de correction/enrichissement: qualité
// quasi identique à Opus sur du code React, ~5x moins cher. (Optimisation
// crédits — les réécritures QA/densité représentaient la majorité du coût.)
const QA_MODEL = "anthropic/claude-sonnet-4.6";

// ─── Application de blocs SEARCH/REPLACE (fixes en diff, pas en réécriture) ──
// Au lieu de régénérer TOUTE la page pour corriger 2-3 handlers morts (20k
// tokens de sortie), le modèle renvoie uniquement des blocs ciblés:
//   <<<<<<< SEARCH … ======= … >>>>>>> REPLACE
// qu'on applique localement. ~70% de tokens de sortie en moins sur les fixes,
// et moins de risque de casser ce qui marchait déjà.
export function applySearchReplace(code: string, response: string): { code: string; applied: number } {
  let out = code;
  let applied = 0;
  const re = /<{7}\s*SEARCH\n([\s\S]*?)\n={7}\n([\s\S]*?)\n>{7}\s*REPLACE/g;
  for (const m of response.matchAll(re)) {
    const search = m[1];
    const replace = m[2];
    if (!search.trim()) continue;
    if (out.includes(search)) {
      out = out.replace(search, replace);
      applied++;
    } else {
      // Tolérance aux espaces de fin de ligne (divergence fréquente).
      const relaxed = search.replace(/[ \t]+\n/g, "\n");
      const outRelaxedIdx = out.replace(/[ \t]+\n/g, "\n").indexOf(relaxed);
      if (outRelaxedIdx !== -1 && out.includes(search.trim())) {
        out = out.replace(search.trim(), replace.trim());
        applied++;
      }
    }
  }
  return { code: out, applied };
}

export interface QAIssue {
  severity: "high" | "medium" | "low";
  code: string;
  message: string;
  count: number;
}

export interface QAReport {
  file: string;
  issues: QAIssue[];
  score: number; // 0-100, 100 = parfait
}

// Retire les commentaires et chaînes pour éviter les faux positifs quand on
// cherche des patterns de code réels (ex: "href=\"#\"" dans un commentaire).
function stripNoise(code: string): string {
  return code
    .replace(/\/\/[^\n]*/g, "")
    .replace(/\/\*[\s\S]*?\*\//g, "");
}

// Analyse statique d'une page générée. Retourne les problèmes FONCTIONNELS
// détectés (pas de style, pas de compilation — ça, le build s'en charge).
export function analyzePage(
  file: string,
  code: string,
  ctx: { isCore?: boolean; hasPayment?: boolean; hasForm?: boolean; isHome?: boolean } = {},
): QAReport {
  const issues: QAIssue[] = [];
  const src = stripNoise(code);
  const add = (severity: QAIssue["severity"], code: string, message: string, count: number) => {
    if (count > 0) issues.push({ severity, code, message, count });
  };

  // 1) Boutons/handlers morts
  const emptyHandlers = (src.match(/on[A-Z]\w+\s*=\s*\{\s*\(\s*\)\s*=>\s*\{\s*\}\s*\}/g) || []).length;
  add("high", "DEAD_HANDLER", "Handlers vides (onClick={() => {}}) — boutons qui ne font rien.", emptyHandlers);

  const consoleLogs = (src.match(/console\.(log|warn|debug)\s*\(/g) || []).length;
  add("medium", "CONSOLE_LOG", "console.log laissés dans le code (souvent un vrai comportement manquant).", consoleLogs);

  // 2) Liens cassés / placeholders
  const deadLinks = (src.match(/href\s*=\s*["'`]#["'`]/g) || []).length;
  add("high", "DEAD_LINK", 'Liens morts (href="#") — devraient être des <Link to="/…"> ou une vraie action.', deadLinks);

  // On ne compte que les VRAIS marqueurs de contenu/logique non terminé.
  // On ignore les faux positifs légitimes: l'attribut `placeholder="…"` (bon
  // UX), les classes Tailwind (`placeholder-gray-400`, `placeholder:text-…`),
  // les identifiants (`placeholderData`, `usePlaceholder`) et les composants
  // (`<Placeholder />`). Seul le mot isolé "placeholder" comme contenu compte.
  const todos = (src.match(/\bTODO\b|\bFIXME\b|lorem ipsum|(?<![<\w])placeholder(?![-:=\w])/gi) || []).length;
  add("medium", "PLACEHOLDER", "TODO/placeholder/lorem ipsum — contenu ou logique non terminé.", todos);

  // 3) alert() au lieu d'un vrai flux
  const alerts = (src.match(/\balert\s*\(/g) || []).length;
  add("medium", "ALERT", "alert() utilisé au lieu d'un vrai retour UI (toast, état, navigation).", alerts);

  // 4) Interactivité réelle
  const hasState = /\buseState\s*\(/.test(src);
  const hasEffect = /\buseEffect\s*\(/.test(src);
  const usesData = /\bdata\.(list|get|create|update|remove)\s*\(/.test(src);
  const usesApi = /\bapi\s*\(/.test(src);
  const usesAi = /\baiChat\s*\(/.test(src);
  const usesCheckout = /\bcheckout\s*\(/.test(src);
  const hasForm = /<form\b/.test(src) || /<input\b/.test(src) || /<textarea\b/.test(src);

  // Page cœur : DOIT lire/écrire des données réelles.
  if (ctx.isCore && !usesData) {
    add("high", "CORE_NO_DATA", "Page CŒUR sans data.* — ce doit être un vrai espace de travail (CRUD persisté), pas du contenu statique.", 1);
  }
  // Page cœur sans état ni effet = statique.
  if (ctx.isCore && !hasState && !hasEffect) {
    add("high", "CORE_STATIC", "Page CŒUR sans useState/useEffect — aucune interactivité réelle.", 1);
  }

  // 5) Grosses listes statiques codées en dur (au lieu de data.*)
  //    Un tableau littéral de plusieurs objets qui ressemble à des données.
  const bigArrays = (src.match(/=\s*\[\s*\{[\s\S]{200,}?\}\s*\]/g) || []).length;
  if (bigArrays > 0 && ctx.isCore && !usesData) {
    add("high", "STATIC_DATA", "Données codées en dur (gros tableau d'objets) sur la page cœur au lieu de data.*.", bigArrays);
  }

  // 6) Paiement déclaré mais pas branché
  if (ctx.hasPayment && !usesCheckout) {
    add("high", "PAY_NO_CHECKOUT", "Page marquée payante mais aucun appel checkout() — bouton d'achat mort.", 1);
  }

  // 7) Formulaire déclaré mais pas contrôlé/branché
  if (ctx.hasForm && !hasForm) {
    add("medium", "FORM_MISSING", "Formulaire attendu mais aucun <form>/<input>/<textarea> trouvé.", 1);
  }
  if (hasForm && !hasState) {
    add("medium", "UNCONTROLLED_FORM", "Champs de formulaire sans useState — inputs probablement non contrôlés.", 1);
  }

  // 8) TEXTE DUPLIQUÉ À L'ÉCRAN — le même texte visible affiché 2+ fois.
  //    Cause typique: un composant de référence (21st.dev) adapté en perdant la
  //    classe sr-only de sa copie d'accessibilité, ou une section régénérée qui
  //    a été AJOUTÉE au lieu de remplacer. On ne compte que les textes LONGS
  //    (≥25 caractères): un titre/slogan/paragraphe dupliqué n'est jamais
  //    intentionnel, contrairement à un petit label répété ("En savoir plus").
  {
    const textNodes = Array.from(code.matchAll(/>([^<>{}\n]{25,}?)</g), (m) => m[1].trim()).filter((t) => t.length >= 25 && /[a-zA-ZÀ-ÿ]/.test(t));
    const counts = new Map<string, number>();
    for (const t of textNodes) counts.set(t, (counts.get(t) || 0) + 1);
    // Un texte dupliqué est OK si UNE des copies est en sr-only (accessibilité).
    const dupes = Array.from(counts.entries()).filter(([t, n]) => {
      if (n < 2) return false;
      const esc = t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const srOnlyCopies = (code.match(new RegExp(`sr-only[^>]*>\\s*${esc}`, "g")) || []).length;
      return n - srOnlyCopies >= 2;
    });
    add("high", "DUPLICATE_TEXT", `Même texte affiché plusieurs fois à l'écran (ex: "${dupes[0]?.[0]?.slice(0, 50) || ""}…") — garde UNE seule occurrence visible (si c'est une copie d'accessibilité, remets className="sr-only" dessus).`, dupes.length);
  }

  // 9) AnimatePresence sans mode="wait" — l'ancien et le nouveau contenu
  //    s'affichent SIMULTANÉMENT pendant la transition (texte en double).
  {
    const apTags = Array.from(src.matchAll(/<AnimatePresence\b([^>]*)>/g));
    const noWait = apTags.filter((m) => !/mode\s*=/.test(m[1])).length;
    add("medium", "ANIM_NO_WAIT", 'AnimatePresence sans mode="wait" — ancien + nouveau contenu affichés en même temps (texte dupliqué pendant les transitions). Ajoute mode="wait".', noWait);
  }

  // 10) Boutons qui n'appellent rien du tout (heuristique: beaucoup de <button>
  //    mais aucune primitive d'action utilisée).
  const buttonCount = (src.match(/<button\b/g) || []).length;
  const anyAction = usesData || usesApi || usesAi || usesCheckout || /\bnavigate\s*\(/.test(src) || /<Link\b/.test(src) || /set[A-Z]\w+\s*\(/.test(src);
  if (buttonCount >= 2 && !anyAction) {
    add("high", "INERT_BUTTONS", `${buttonCount} boutons mais aucune action réelle (data/api/ai/checkout/navigation/état) dans la page.`, buttonCount);
  }

  // 11) THEME_MISMATCH — fonds sombres codés en dur SANS variante dark: à côté
  //     de fonds clairs. Cause typique du bug "header blanc sur page sombre":
  //     une page peinte en sombre en dur pendant que le Layout/Header restent
  //     clairs. Un fond sombre n'est acceptable QUE derrière un préfixe dark:
  //     ou comme accent local (bouton, badge) — pas comme fond de page/section.
  {
    const hardDarkBg = (src.match(/(?<!dark:)bg-\[#0[0-9a-fA-F]{2,5}\]|(?<!dark:)bg-(?:gray|slate|zinc|neutral|stone)-9\d\d(?![\d])/g) || []).length;
    const lightBg = /(?<!dark:)bg-white\b|(?<!dark:)bg-(?:gray|slate|zinc|neutral|stone)-50\b/.test(src);
    if (hardDarkBg >= 2 && lightBg) {
      add("high", "THEME_MISMATCH", "Fonds sombres codés en dur (sans dark:) mélangés à des fonds clairs — thème incohérent (ex: header clair sur page sombre). Choisis UNE palette et applique-la partout ; le sombre passe par la variante dark: uniquement.", hardDarkBg);
    }
  }

  // 12) SCROLL_RESET — code qui fait remonter/défiler la page tout seul.
  //     scrollIntoView remonte TOUTE la page (pas seulement le panneau) ; un
  //     setInterval qui appelle un setState re-rend en boucle et casse le
  //     scroll. Le scroll d'un chat/panneau se fait via el.scrollTop.
  {
    const intoView = (src.match(/\.scrollIntoView\s*\(/g) || []).length;
    add("high", "SCROLL_RESET", "scrollIntoView() détecté — fait défiler TOUTE la page (bug « la page remonte toute seule »). Scrolle le panneau conteneur via ref.current.scrollTop = ref.current.scrollHeight.", intoView);
    const intervalSetState = Array.from(src.matchAll(/setInterval\s*\(\s*(?:\(\s*\)\s*=>|function)[\s\S]{0,200}?set[A-Z]\w*\s*\(/g)).length;
    add("high", "SCROLL_RESET", "setInterval qui appelle un setState — re-render en boucle (curseur clignotant, scroll qui saute). Utilise une animation CSS (animate-pulse / @keyframes) à la place.", intervalSetState);
    const winScroll = (src.match(/window\.scrollTo\s*\(/g) || []).length;
    add("medium", "SCROLL_RESET", "window.scrollTo() dans une page — risque de remontée intempestive. Réserve-le à un vrai changement de route.", winScroll);
  }

  // 13) OVERLOADED_HOME — accueil fourre-tout. La home d'un produit a UN
  //     objectif (héro + proposition de valeur + CTA). Stats, listes CRUD,
  //     tableaux de bord et grilles pricing vivent sur leurs propres pages.
  if (ctx.isHome) {
    const sections = (src.match(/<section\b/g) || []).length;
    if (sections > 6) add("medium", "OVERLOADED_HOME", `${sections} <section> sur la page d'accueil — trop chargée. Vise ≤5 sections (héro, valeur, social proof, CTA) et déplace le reste (stats/listes/pricing détaillé) vers leurs pages dédiées.`, 1);
    const hasCrud = /\bdata\.(create|update|remove)\s*\(/.test(src);
    const hasStatsGrid = /grid[^"']*\bgrid-cols-[34]\b[\s\S]{0,400}?(statisti|Stats|compteur|total|restant)/i.test(src);
    if (hasCrud && hasStatsGrid) add("medium", "OVERLOADED_HOME", "La home mélange CRUD + tableaux de stats — c'est un dashboard, pas un accueil. Garde le héro + point d'entrée, déplace la gestion vers la page cœur.", 1);
  }

  // 14) BROKEN_LAYOUT — la page rend son propre <nav>/<footer> global alors
  //     que le Layout partagé les fournit déjà (double header/footer à l'écran).
  {
    const ownNav = (src.match(/<nav\b[^>]*(?:fixed|sticky)/g) || []).length;
    add("high", "BROKEN_LAYOUT", "La page rend son propre <nav> fixed/sticky — le Header global existe déjà (double barre à l'écran). Supprime-le, garde uniquement le contenu de page.", ownNav);
    const ownFooter = (src.match(/<footer\b[^>]*>[\s\S]{300,}?<\/footer>/g) || []).length;
    add("high", "BROKEN_LAYOUT", "La page rend un gros <footer> global — le Footer partagé existe déjà. Supprime-le.", ownFooter);
  }

  // Score: 100 - pénalités pondérées.
  let penalty = 0;
  for (const i of issues) {
    const w = i.severity === "high" ? 25 : i.severity === "medium" ? 8 : 3;
    penalty += w * Math.min(i.count, 3);
  }
  const score = Math.max(0, 100 - penalty);
  return { file, issues, score };
}

// ─── Passe Densité / Richesse ────────────────────────────────────────────────
// Une page peut être 100% fonctionnelle (tous les boutons marchent) mais
// PAUVRE: peu de sections, peu d'états, pas de recherche/filtre/tri, pas d'états
// vides/chargement, peu de contenu. Un vrai clone premium (type Linear, Notion,
// Velbaz) est DENSE: plusieurs sections, beaucoup d'interactions, du contenu
// réaliste et abondant. Cette passe mesure la richesse et signale les pages
// trop maigres pour qu'on les ré-étoffe.

export interface DensityReport {
  file: string;
  score: number; // 0-100, 100 = très riche
  signals: Record<string, number>;
  thin: boolean; // vrai si la page est trop pauvre et doit être enrichie
}

export function analyzeDensity(
  file: string,
  code: string,
  ctx: { isCore?: boolean } = {},
): DensityReport {
  const src = stripNoise(code);
  const signals: Record<string, number> = {};

  // Volume brut (proxy de la quantité de contenu/structure).
  const chars = code.length;
  signals.kb = Math.round(chars / 1024);

  // Richesse d'état & de logique.
  signals.useState = (src.match(/\buseState\s*\(/g) || []).length;
  signals.useEffect = (src.match(/\buseEffect\s*\(/g) || []).length;
  signals.handlers = (src.match(/\b(const|function)\s+\w*(handle|on)[A-Z]\w*/g) || []).length;

  // Opérations data réelles (CRUD).
  signals.dataOps = (src.match(/\bdata\.(list|get|create|update|remove)\s*\(/g) || []).length;

  // Variété/quantité d'UI.
  signals.sections = (src.match(/<(section|header|main|aside|footer)\b/g) || []).length;
  signals.cards = (src.match(/\brounded-(lg|xl|2xl|3xl)\b/g) || []).length;
  signals.icons = new Set(src.match(/\b[A-Z][a-zA-Z]+(?=\s*\/?>)/g) || []).size; // approx composants/icônes distincts
  signals.maps = (src.match(/\.map\s*\(/g) || []).length;
  signals.conditionals = (src.match(/&&\s*</g) || []).length + (src.match(/\?\s*</g) || []).length;

  // Fonctionnalités « produit » attendues sur une vraie page dense.
  const hasSearch = /\b(search|recherche|filter|filtre|query)\b/i.test(src) ? 1 : 0;
  const hasSort = /\b(sort|trier|orderBy|ordre)\b/i.test(src) ? 1 : 0;
  const hasEmptyState = /(aucun|vide|empty|no .*(yet|found)|commenc)/i.test(src) ? 1 : 0;
  const hasLoading = /\b(loading|chargement|isLoading|Loader|Spinner|Skeleton)\b/i.test(src) ? 1 : 0;
  signals.features = hasSearch + hasSort + hasEmptyState + hasLoading;

  // Score pondéré, plafonné par signal pour éviter qu'un seul signal gonflé
  // masque une page pauvre ailleurs.
  const cap = (n: number, max: number) => Math.min(n, max);
  let score = 0;
  score += cap(signals.kb, 12) * 1.5;        // jusqu'à 18 (≈ 12KB+)
  score += cap(signals.useState, 6) * 3;      // jusqu'à 18
  score += cap(signals.useEffect, 3) * 2;     // jusqu'à 6
  score += cap(signals.handlers, 6) * 2;      // jusqu'à 12
  score += cap(signals.dataOps, 5) * 2;       // jusqu'à 10
  score += cap(signals.sections, 5) * 2;      // jusqu'à 10
  score += cap(signals.maps, 4) * 1.5;        // jusqu'à 6
  score += cap(signals.conditionals, 6) * 1;  // jusqu'à 6
  score += cap(signals.icons, 8) * 0.5;       // jusqu'à 4
  score += signals.features * 2.5;            // jusqu'à 10
  score = Math.min(100, Math.round(score));

  // Seuil de « maigreur »: plus exigeant pour les pages cœur (vrais espaces de
  // travail) que pour les pages secondaires.
  const threshold = ctx.isCore ? 70 : 55;
  return { file, score, signals, thin: score < threshold };
}

// Instruction pour ENRICHIR une page trop maigre (garde le câblage, ajoute de
// la matière: sections, états, contenu, interactions).
export function buildDensityInstruction(report: DensityReport): string {
  const weak: string[] = [];
  if (report.signals.dataOps < 3) weak.push("peu/pas d'opérations data.* (ajoute list + create + update + remove réels)");
  if (report.signals.useState < 3) weak.push("peu d'état local (ajoute recherche, filtres, tri, sélection, modales)");
  if (report.signals.sections < 3) weak.push("peu de sections structurantes (ajoute en-tête, stats/résumé, contenu principal, panneau latéral)");
  if (report.signals.features < 2) weak.push("manque recherche/filtre/tri, états de chargement et états vides");
  if (report.signals.kb < 10) weak.push("page trop courte: densifie le contenu et les interactions");
  const lines = weak.length ? weak.map((w) => `- ${w}`).join("\n") : "- densifie globalement le contenu et les interactions";
  return `Cette page est FONCTIONNELLE mais trop PAUVRE (score de richesse ${report.score}/100). Un vrai produit premium (type Linear/Notion/Velbaz) est DENSE et complet.
ENRICHIS-la nettement sans casser ce qui marche:
${lines}

Exigences:
- Plusieurs sections claires (en-tête avec titre + actions, bande de statistiques/résumé, zone principale, et au moins un panneau/section secondaire pertinent).
- Recherche + filtres + tri réels (contrôlés par useState, appliqués aux données affichées).
- États soignés: chargement (skeleton/spinner), vide (message + CTA), et erreur.
- Contenu réaliste, spécifique et ABONDANT (pas 2 items de démo: des données seed crédibles et variées si data est vide).
- Micro-interactions et détails premium (hover, transitions, badges, compteurs, formatage de dates/nombres).
- Garde EXACTEMENT le même style, la même palette, la même langue et le même câblage fonctionnel. On ajoute de la matière, on ne régresse pas.`;
}

// Ré-étoffe une page maigre en réinjectant le contexte d'origine + l'instruction
// de densité + le code actuel.
export async function densifyPage(
  originalPrompt: string,
  currentCode: string,
  report: DensityReport,
  system: string,
): Promise<string> {
  const prompt = `${originalPrompt}

## ⚠️ ENRICHISSEMENT — VERSION ACTUELLE TROP PAUVRE
Voici la page déjà générée. Elle fonctionne mais manque de densité/richesse.
${buildDensityInstruction(report)}

## CODE ACTUEL À ENRICHIR
\`\`\`tsx
${currentCode}
\`\`\`

Renvoie la page ENTIÈRE enrichie (UNIQUEMENT le code .tsx, aucune fence, aucune explication).`;
  try {
    const { text } = await generateText({
      model: gateway(QA_MODEL),
      system,
      prompt,
      maxOutputTokens: 28000,
    });
    let s = (text || "").trim();
    if (s.startsWith("```")) s = s.replace(/^```(?:tsx|ts|jsx|js)?\s*\n?/i, "").replace(/\n?```\s*$/, "");
    return s.trim() || currentCode;
  } catch {
    return currentCode;
  }
}

// Construit une instruction de correction ciblée à partir des problèmes.
export function buildFixInstruction(report: QAReport): string {
  const lines = report.issues.map(
    (i) => `- [${i.severity.toUpperCase()}] ${i.message}${i.count > 1 ? ` (×${i.count})` : ""}`,
  );
  return `Cette page a des DÉFAUTS FONCTIONNELS à corriger (elle compile mais tout ne marche pas vraiment):
${lines.join("\n")}

CORRIGE la page pour que TOUT soit réellement fonctionnel:
- Chaque bouton/onClick fait une VRAIE action: navigation (<Link>/navigate), mutation data.* (create/update/remove), appel api(), appel IA aiChat(), checkout(), ou changement d'état useState UTILISÉ. Aucun handler vide, aucun console.log, aucun alert().
- Chaque lien pointe vers une vraie route (<Link to="/…">), jamais href="#".
- Les données affichées viennent de data.* (chargées via useEffect+useState, rafraîchies après mutation), pas de tableaux statiques codés en dur (sauf seed d'illustration minime).
- Chaque champ de formulaire est contrôlé (value + onChange sur un useState) et sa valeur est réellement utilisée.
- Aucun TODO, placeholder, ni lorem ipsum: du contenu réaliste et spécifique au business.
- Aucun texte visible en double: si un texte apparaît 2 fois, supprime la copie superflue (ou remets className="sr-only" si c'était une copie d'accessibilité). Ajoute mode="wait" à tout <AnimatePresence> qui n'en a pas.
- Garde le même design, la même structure visuelle et la langue. Améliore seulement le CÂBLAGE fonctionnel.`;
}

// Corrige une page défectueuse en DIFF CIBLÉ (blocs SEARCH/REPLACE) au lieu de
// réécrire toute la page: beaucoup moins cher, et les sections qui marchaient
// déjà ne sont jamais touchées. Fallback: si aucun bloc ne s'applique, on
// retourne le code inchangé (l'engine gère "correction non retenue").
export async function fixPage(
  originalPrompt: string,
  currentCode: string,
  report: QAReport,
  system: string,
): Promise<string> {
  const prompt = `## CONTEXTE (résumé)
${originalPrompt.slice(0, 3000)}

## ⚠️ CORRECTION QUALITÉ — DÉFAUTS FONCTIONNELS À CORRIGER
${buildFixInstruction(report)}

## CODE ACTUEL
\`\`\`tsx
${currentCode}
\`\`\`

## FORMAT DE RÉPONSE — DIFFS CIBLÉS UNIQUEMENT
Ne réécris PAS toute la page. Renvoie UNIQUEMENT des blocs de remplacement ciblés, un par défaut à corriger:

<<<<<<< SEARCH
(extrait EXACT du code actuel, copié caractère pour caractère, assez long pour être unique)
=======
(le remplacement corrigé)
>>>>>>> REPLACE

Règles:
- Le texte SEARCH doit exister TEL QUEL dans le code actuel (copie exacte, avec l'indentation).
- Chaque bloc corrige UN défaut. Plusieurs blocs si plusieurs défauts.
- Ne touche à rien d'autre: pas de reformatage, pas de renommage, pas de "pendant que j'y suis".
- Aucune explication, aucun texte hors des blocs.`;
  try {
    const { text } = await generateText({
      model: gateway(QA_MODEL),
      system,
      prompt,
      maxOutputTokens: 8000,
    });
    const { code, applied } = applySearchReplace(currentCode, text || "");
    return applied > 0 ? code : currentCode;
  } catch {
    return currentCode;
  }
}

// ─── Passe COMBINÉE correction + enrichissement (1 seul appel IA) ────────────
// Avant: une page maigre ET défectueuse subissait 2 réécritures complètes
// successives (fix puis densify) = 2x ~20k tokens de sortie. Maintenant: UNE
// seule réécriture qui corrige le câblage ET densifie en même temps.
export async function improvePage(
  originalPrompt: string,
  currentCode: string,
  qaReport: QAReport | null,
  densityReport: DensityReport,
  system: string,
): Promise<string> {
  const fixBlock = qaReport && qaReport.issues.length
    ? `\n## ⚠️ DÉFAUTS FONCTIONNELS À CORRIGER EN MÊME TEMPS\n${buildFixInstruction(qaReport)}\n`
    : "";
  const prompt = `${originalPrompt}

## ⚠️ AMÉLIORATION — VERSION ACTUELLE TROP PAUVRE
Voici la page déjà générée. Elle manque de densité/richesse.
${buildDensityInstruction(densityReport)}
${fixBlock}
## CODE ACTUEL À AMÉLIORER
\`\`\`tsx
${currentCode}
\`\`\`

Renvoie la page ENTIÈRE améliorée — enrichie${fixBlock ? " ET corrigée" : ""} (UNIQUEMENT le code .tsx, aucune fence, aucune explication).`;
  try {
    const { text } = await generateText({
      model: gateway(QA_MODEL),
      system,
      prompt,
      maxOutputTokens: 28000,
    });
    let s = (text || "").trim();
    if (s.startsWith("```")) s = s.replace(/^```(?:tsx|ts|jsx|js)?\s*\n?/i, "").replace(/\n?```\s*$/, "");
    return s.trim() || currentCode;
  } catch {
    return currentCode;
  }
}

// ─── Passe d'ADOPTION des composants 21st.dev ────────────────────────────────
// Le pipeline SÉLECTIONNE de vrais composants 21st.dev (analyse visuelle,
// scoring) et injecte leur code source dans le prompt de page. Mais rien ne
// GARANTIT que le modèle les a réellement repris : il génère souvent une page
// générique qui IGNORE le code fourni. Résultat: des "assets choisis" qui
// n'apparaissent jamais dans le site.
//
// Cette passe mesure, par empreintes structurelles, à quel point le code final
// a réellement réutilisé les composants fournis. Si l'adoption est trop faible,
// l'engine régénère la page en FORÇANT la construction à partir du vrai code.

export interface AdoptionReport {
  /** Nombre de composants de réf. dont on retrouve une empreinte dans la page. */
  adopted: number;
  /** Nombre total de composants de réf. fournis. */
  total: number;
  /** Ratio 0-1 d'adoption. */
  ratio: number;
  /** Vrai si l'adoption est trop faible → régénération forcée recommandée. */
  weak: boolean;
  /** Requêtes des réf. NON retrouvées dans la page. */
  missing: string[];
}

// Extrait des "empreintes" distinctives d'un snippet de composant: identifiants
// peu communs (noms de composants exportés/déclarés, classes utilitaires rares,
// data-attributes, textes/labels signature). On ignore le bruit ultra-fréquent
// (div, flex, className générique) pour ne garder que ce qui prouve une reprise.
function componentFingerprints(snippet: string): string[] {
  const fps = new Set<string>();
  const code = snippet.replace(/^\/\/[^\n]*\n/, ""); // retire l'en-tête "// 21st.dev FEATURED:"

  // 1) Noms de composants/fonctions déclarés ou exportés (PascalCase).
  for (const m of code.matchAll(/(?:function|const|class)\s+([A-Z][A-Za-z0-9]{3,})/g)) fps.add(m[1]);
  // 2) Composants JSX personnalisés utilisés (<PascalCase ...>).
  for (const m of code.matchAll(/<([A-Z][A-Za-z0-9]{3,})[\s/>]/g)) fps.add(m[1]);
  // 3) data-* attributes (souvent signature d'un composant précis).
  for (const m of code.matchAll(/data-[a-z-]{4,}=/g)) fps.add(m[0]);
  // 4) Classes Tailwind rares/spécifiques (valeurs arbitraires, animations, gradients).
  for (const m of code.matchAll(/\b(?:bg-gradient-to-\w+|animate-[a-z-]+|backdrop-blur-\w+|shadow-\[[^\]]+\]|\[[a-z-]+:[^\]]+\]|(?:from|via|to)-\[?#?[a-z0-9]+\]?)/gi)) {
    if (m[0].length >= 6) fps.add(m[0]);
  }
  // 5) Clés d'objet uniques (variants, style maps).
  for (const m of code.matchAll(/["'`]([a-z][a-z0-9-]{5,})["'`]\s*:/gi)) fps.add(m[1]);

  const NOISE = new Set([
    "className", "children", "Component", "Props", "React", "Fragment",
    "Button", "Input", "Card", "Container", "Wrapper", "Section", "Header",
    "Footer", "default",
  ]);
  return Array.from(fps).filter((f) => !NOISE.has(f) && f.length >= 4).slice(0, 40);
}

// Mesure l'adoption réelle des composants de référence dans le code généré.
export function analyzeAdoption(
  code: string,
  refs: Array<{ searchQuery: string; snippet: string }> | undefined,
): AdoptionReport {
  const total = refs?.length || 0;
  if (!refs || total === 0) return { adopted: 0, total: 0, ratio: 1, weak: false, missing: [] };

  let adopted = 0;
  const missing: string[] = [];
  for (const ref of refs) {
    const fps = componentFingerprints(ref.snippet);
    if (fps.length === 0) { adopted++; continue; } // pas jugeable → on ne pénalise pas
    let hits = 0;
    for (const fp of fps) if (code.includes(fp)) hits++;
    // Adopté si au moins ~20% des empreintes distinctives (min 2) sont présentes.
    const need = Math.max(2, Math.ceil(fps.length * 0.2));
    if (hits >= need) adopted++;
    else missing.push(ref.searchQuery);
  }
  const ratio = adopted / total;
  return { adopted, total, ratio, weak: ratio < 0.5, missing };
}

// Instruction de RÉGÉNÉRATION FORCÉE quand le modèle a ignoré les composants
// 21st.dev fournis. Beaucoup plus contraignant que le prompt initial.
export function buildAdoptionInstruction(report: AdoptionReport): string {
  return `⛔ ÉCHEC D'INTÉGRATION 21st.dev — À CORRIGER MAINTENANT
Tu as généré une page qui N'UTILISE PAS le code des composants 21st.dev fournis plus haut (${report.adopted}/${report.total} réellement repris).
Composants IGNORÉS: ${report.missing.join(", ") || "—"}.

C'est la faute la plus grave possible ici. Ces composants ont été SÉLECTIONNÉS exprès pour cette page. Tu DOIS reconstruire la page EN PARTANT de leur code source réel:
- COPIE leur markup JSX (structure des <div>/<section>, hiérarchie, className Tailwind exactes, gradients, ombres, arrondis, glassmorphism, animations framer-motion).
- ASSEMBLE-les pour composer chaque section visible de la page (hero, features, CTA, listes, formulaires…). Chaque bloc visible doit provenir d'un de ces composants.
- Adapte UNIQUEMENT: couleurs → design system, textes → business, données de démo → data.* réelles. Tu ne SIMPLIFIES PAS, tu ne "réécris pas à ta façon".
- Si un composant importe une lib non installée, réécris seulement ses imports en React 19 + Tailwind + lucide-react + framer-motion, en gardant EXACTEMENT le même rendu.
Une page qui reste visuellement plus pauvre que ces composants = échec. Repars de LEUR code.`;
}

// Régénère une page en RÉINJECTANT le prompt d'origine (qui contient déjà le
// code des composants) + une directive d'adoption stricte + le code raté.
export async function forceComponentAdoption(
  originalPrompt: string,
  currentCode: string,
  report: AdoptionReport,
  system: string,
): Promise<string> {
  const prompt = `${originalPrompt}

## ${buildAdoptionInstruction(report)}

## CODE ACTUEL (à REMPLACER — il ignore les composants 21st.dev)
\`\`\`tsx
${currentCode}
\`\`\`

Renvoie la page ENTIÈRE reconstruite À PARTIR des composants 21st.dev fournis plus haut (UNIQUEMENT le code .tsx, aucune fence, aucune explication).`;
  try {
    const { text } = await generateText({
      model: gateway(QA_MODEL),
      system,
      prompt,
      maxOutputTokens: 28000,
    });
    let s = (text || "").trim();
    if (s.startsWith("```")) s = s.replace(/^```(?:tsx|ts|jsx|js)?\s*\n?/i, "").replace(/\n?```\s*$/, "");
    return s.trim() || currentCode;
  } catch {
    return currentCode;
  }
}
