// ─── Mobile App Generation Engine (Expo / React Native) ─────────────────────
// Transforme une idée en VRAIE app mobile : plan des écrans → kit UI partagé →
// écrans en parallèle (streaming live) → assemblage expo-router.
// Règles strictes : composants React Native uniquement, jamais de HTML/Tailwind.
// Modèles : Opus pour le plan + la logique de jeu, Sonnet pour les écrans UI.

import { generateText, streamText } from "ai";
import { gateway } from "../agent/gateway";
import type { ScaffoldFile } from "./scaffold";
import { buildMobileScaffold, MOBILE_IMAGES_TS, type MobileAppMeta } from "./scaffold-mobile";
import { planImageSlots, generateImageManifest, imagesPromptBlock, type ImageManifest } from "./images";
import { currentDateContext } from "./prompts";
import { CONTENT_TRUTH, CONTENT_TRUTH_SHORT } from "./content-truth";
import { isPlaceholderBrandName } from "../agents/website";
import { sanitizeModelCode } from "./code-sanitize";

const FALLBACK_CHAIN = ["anthropic/claude-sonnet-4.6", "openai/gpt-5.4", "google/gemini-3-flash"];
const CODE_MODEL = "anthropic/claude-sonnet-4.6";      // écrans UI
const HEAVY_MODEL = "anthropic/claude-sonnet-4.6";       // plan + logique de jeu
const CHEAP_JSON_MODEL = "google/gemini-3-flash";

// Contexte de l'app WEB déjà construite pour ce projet. Quand il est fourni,
// la génération mobile n'invente PLUS une app à partir de l'idée brute : elle
// REPRODUIT fidèlement le produit web (mêmes écrans, mêmes fonctionnalités,
// même palette). C'est ce qui rend la conversion web→mobile cohérente.
export interface MobileWebContext {
  pages: Array<{ name: string; route?: string; purpose?: string; sections?: string }>;
  colors?: { primary?: string; accent?: string; background?: string; surface?: string; text?: string; muted?: string };
  font?: string;
  tagline?: string;
  features?: string[];
}

export interface MobileEngineInput {
  companyId: string;
  companyName: string;
  idea: string;
  industry?: string;
  preferredLang?: string;
  /** Présent lors d'une conversion web→mobile : l'app mobile doit refléter ce site/app web. */
  webContext?: MobileWebContext;
}

export interface MobilePlan {
  appName: string;
  slug: string;
  tagline: string;
  isGame: boolean;
  colors: { bg: string; surface: string; primary: string; accent: string; text: string; textDim: string };
  screens: Array<{ name: string; file: string; route: string; purpose: string; isGameLoop?: boolean }>;
}

export interface GeneratedMobileApp {
  files: ScaffoldFile[];
  plan: MobilePlan;
}

async function ai(system: string, prompt: string, maxTokens = 8000, preferred = HEAVY_MODEL): Promise<{ text: string; truncated: boolean }> {
  const chain = [preferred, ...FALLBACK_CHAIN.filter(m => m !== preferred)];
  let lastErr: any = null;
  for (const model of chain) {
    try {
      const { text, finishReason } = await generateText({ model: gateway(model), system, prompt, maxOutputTokens: Math.max(maxTokens, 4000) });
      const out = (text || "").trim();
      if (out.length > 0) return { text: out, truncated: finishReason === "length" };
    } catch (e: any) { lastErr = e; }
  }
  if (lastErr) throw lastErr;
  return { text: "", truncated: false };
}

async function aiCodeStream(
  system: string,
  prompt: string,
  onDelta: (fullText: string) => void,
  preferred = CODE_MODEL,
  maxTokens = 20000,
): Promise<string> {
  const chain = [preferred, ...FALLBACK_CHAIN.filter(m => m !== preferred)];
  let lastErr: any = null;
  for (const model of chain) {
    try {
      let text = "";
      const result = streamText({ model: gateway(model), system, prompt, maxOutputTokens: Math.max(maxTokens, 4000) });
      for await (const delta of result.textStream) { text += delta; onDelta(text); }
      let truncated = (await result.finishReason) === "length";
      let guard = 0;
      while (truncated && guard < 2) {
        guard++;
        const tail = text.slice(-1200);
        const cont = await ai(system, `${prompt}\n\n## CONTINUE\nTa réponse a été coupée. Voici la fin de ce que tu avais écrit:\n---\n${tail}\n---\nContinue EXACTEMENT à partir de là (sans répéter, sans fence markdown). Termine le fichier proprement.`, maxTokens, model);
        text += cont.text;
        truncated = cont.truncated;
        onDelta(text);
      }
      if (text.trim().length > 0) return text;
    } catch (e: any) { lastErr = e; }
  }
  if (lastErr) throw lastErr;
  return "";
}

function extractJSON(raw: string): any {
  const cleaned = raw.replace(/```json/gi, "").replace(/```/g, "").trim();
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  if (start === -1 || end === -1) throw new Error("No JSON found");
  return JSON.parse(cleaned.slice(start, end + 1));
}

// Même nettoyage que côté web (cf. ./code-sanitize) : la prose de raisonnement
// écrite avant le code doit être retirée, pas seulement les clôtures ```.
function cleanCode(raw: string): string {
  return sanitizeModelCode(raw);
}

function slugify(name: string): string {
  return (name || "app").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 30) || "app";
}

// ─── Prompts ─────────────────────────────────────────────────────────────────

const PLAN_SYSTEM = "Tu es un lead mobile product designer. Tu réponds UNIQUEMENT en JSON valide, sans markdown.";

// Portage FIDÈLE d'une app web existante vers le mobile. La palette et les
// fonctionnalités viennent du site déjà construit — on ne réinvente rien.
const CONVERT_PLAN_PROMPT = (input: MobileEngineInput, lang: string, web: MobileWebContext) => {
  const pageList = web.pages
    .filter(p => p?.name)
    .map(p => `- ${p.name}${p.route ? ` (${p.route})` : ""}${p.purpose ? ` : ${p.purpose}` : ""}`)
    .join("\n");
  const c = web.colors || {};
  return `Tu convertis une application WEB DÉJÀ EXISTANTE en sa VERSION MOBILE NATIVE (Expo / React Native).
Ce n'est PAS un nouveau produit : c'est LE MÊME produit, porté sur téléphone.

Nom du produit : ${input.companyName}
Idée / description : "${input.idea}"${input.industry ? `\nIndustrie : ${input.industry}` : ""}
Langue de l'UI : ${lang}
${web.tagline ? `Accroche du produit : ${web.tagline}\n` : ""}
PAGES DU SITE/APP WEB EXISTANT (à refléter fidèlement) :
${pageList || "- (non détaillées — déduis-les de l'idée)"}
${web.features?.length ? `\nFonctionnalités clés du produit :\n${web.features.map(f => `- ${f}`).join("\n")}\n` : ""}
PALETTE DU SITE WEB (à RÉUTILISER telle quelle) :
- primary: ${c.primary || "?"} · accent: ${c.accent || "?"} · fond: ${c.background || "?"} · surface: ${c.surface || "?"} · texte: ${c.text || "?"}

Conçois le plan de l'app mobile native correspondante.
Réponds en JSON strict :
{
  "appName": "${input.companyName}",
  "tagline": "${web.tagline || "accroche courte dans la langue de l'UI"}",
  "isGame": false,
  "colors": { "bg": "${c.background || "#0d0f14"}", "surface": "${c.surface || "#161a22"}", "primary": "${c.primary || "#4f7cff"}", "accent": "${c.accent || "#22c58b"}", "text": "${c.text || "#f5f7fa"}", "textDim": "${c.muted || "#8b93a3"}" },
  "screens": [
    { "name": "…", "file": "app/index.tsx", "route": "/", "purpose": "reprend le rôle et le contenu de la page web correspondante", "isGameLoop": false }
  ]
}

Règles STRICTES de fidélité :
- isGame est TOUJOURS false (c'est le portage d'une app web, pas un jeu).
- CHAQUE écran mobile correspond à une page/fonction RÉELLE du site web ci-dessus — mêmes fonctionnalités, même contenu, adaptés au tactile.
- Écarte uniquement les pages purement marketing/légales (landing d'accroche, mentions légales, CGU) qui n'ont pas de sens en app mobile ; garde tout ce qui est fonctionnel (listes, détails, création, profil, réglages, tableau de bord…).
- 3 à 6 écrans MAX ; le premier est TOUJOURS app/index.tsx route "/" et correspond à l'écran d'accueil/principal du produit.
- Fichiers UNIQUEMENT sous app/, en kebab-case : app/index.tsx, app/detail.tsx, app/profil.tsx…
- "colors" DOIT reprendre exactement la palette du site web fournie ci-dessus (ne l'invente pas).`;
};

const PLAN_PROMPT = (input: MobileEngineInput, lang: string) => `Idée de l'utilisateur : "${input.idea}"
Nom de l'entreprise : ${input.companyName}${input.industry ? `\nIndustrie : ${input.industry}` : ""}
Langue de l'UI : ${lang}

Conçois le plan d'une VRAIE application mobile native (Expo / React Native, expo-router en navigation Stack).
Si l'idée est un JEU mobile, conçois un vrai jeu jouable au toucher (boucle de jeu, score, game over, rejouer).

Réponds en JSON strict :
{
  "appName": "nom court de l'app",
  "tagline": "une phrase d'accroche dans la langue de l'UI",
  "isGame": true|false,
  "colors": { "bg": "#0d0f14", "surface": "#161a22", "primary": "#…", "accent": "#…", "text": "#f5f7fa", "textDim": "#8b93a3" },
  "screens": [
    { "name": "Accueil", "file": "app/index.tsx", "route": "/", "purpose": "description précise de l'écran (contenu, interactions, données)", "isGameLoop": false }
  ]
}

${CONTENT_TRUTH_SHORT}

⚠️ EXACTITUDE RELIGIEUSE : si l'idée touche une religion (mosquée, église, synagogue, temple, contenu spirituel, horaires de prière, fêtes, versets/hadiths, rites, règles halal/casher…), le plan ne doit décrire QUE des faits véridiques et fidèles à la religion réellement concernée. N'invente jamais de dates, versets, prières ou rites, ne mélange pas les religions, et prévois toute donnée non certaine à 100% (horaires, dates de fêtes mobiles, textes exacts) comme paramétrable/éditable plutôt que codée en dur.

Règles :
- 3 à 6 écrans MAX, le premier est TOUJOURS app/index.tsx route "/".
- Fichiers UNIQUEMENT sous app/, en kebab-case : app/index.tsx, app/game.tsx, app/settings.tsx…
- Pour un jeu : index = menu (titre, meilleur score, bouton Jouer), un écran isGameLoop:true = le jeu lui-même, + éventuellement scores/réglages.
- Pour une app : écrans concrets et utiles (liste, détail, création, profil…), pas de pages marketing.
- Couleurs : thème sombre élégant adapté au sujet, contrastes AA.`;

const MOBILE_CODE_SYSTEM = `Tu écris des écrans React Native (Expo SDK 54, TypeScript strict, expo-router v6).

PRIORITÉ ABSOLUE — LA DEMANDE DE L'UTILISATEUR PASSE AVANT TOUT : tu as autorité totale sur toute l'app mobile (tous les écrans, composants partagés, thème, logo, images). Aucune limite sur ce que tu peux afficher/modifier si l'utilisateur le demande explicitement (logo à un endroit précis, texte précis, image précise à un endroit précis, etc.). Les règles ci-dessous sont des conventions par défaut quand rien n'est précisé — une demande explicite de l'utilisateur les prime toujours.

RÈGLES ABSOLUES :
- UNIQUEMENT des composants React Native importés de "react-native" : View, Text, Pressable, TouchableOpacity, ScrollView, FlatList, TextInput, Image, Animated, PanResponder, Dimensions, StyleSheet, Alert, Platform.
- IMAGES DE CONTENU : des visuels générés par l'IA sont exposés dans "../lib/images" (import { IMAGES } from "../lib/images"). Quand des visuels sont listés pour cet écran, AFFICHE-les PAR DÉFAUT comme CONTENU ENCADRÉ : <Image source={{ uri: IMAGES.clé }} style={…} resizeMode="cover" /> dans un conteneur dédié (carte, vignette, en-tête, galerie). Les FONDS d'écran/section/bannière restent PAR DÉFAUT des COULEURS ou DÉGRADÉS du thème (pas une image) pour rester propres en mode sombre. EXCEPTION AUTORISÉE : si le business/style s'y prête vraiment (hôtel, voyage, restaurant, immobilier, mode…) ou si l'utilisateur demande explicitement une image en fond, tu peux utiliser <ImageBackground> avec un overlay dégradé semi-transparent par-dessus (pour garder le texte lisible en clair et sombre). N'utilise QUE les clés fournies, n'invente aucune URL, ne laisse aucune image cassée.
- INSCRIPTION / CONSENTEMENT LÉGAL : si tu génères un écran d'inscription/création de compte, ajoute AU-DESSUS du bouton "Créer un compte" une case à cocher OBLIGATOIRE (Pressable + icône check) avec le texte « J'accepte la Politique de confidentialité et les Conditions d'utilisation » (liens/Pressable qui ouvrent les écrans /privacy et /terms). Le bouton d'inscription reste DÉSACTIVÉ tant que la case n'est pas cochée. Génère aussi des écrans Privacy et Terms lisibles (texte juridique) accessibles avant la finalisation du compte.
- INTERDIT : balises HTML (div, span, button…), Tailwind, className, styled-components, toute lib externe non listée.
- Styles : StyleSheet.create en bas du fichier. Thème : import { theme } from "../lib/theme"; (couleurs theme.bg, theme.surface, theme.primary, theme.accent, theme.text, theme.textDim, theme.radius, theme.spacing(n)).
- Navigation : import { Link, useRouter } from "expo-router"; → router.push("/route") ou <Link href="/route">.
- Composants partagés : import { … } from "../components/ui"; (uniquement ceux fournis dans le contexte).
- Chaque fichier est COMPLET et autonome : export default function NomEcran().
- Zone tactile min 44px, safe areas gérées (paddingTop généreux en haut d'écran, pas de contenu sous la barre système).
- Persistance légère : état React en mémoire uniquement (pas d'AsyncStorage — non installé).
- JEUX : boucle via requestAnimationFrame dans useEffect (cleanup au démontage), contrôles tactiles Pressable/PanResponder, Animated pour les transitions, score + game over + bouton rejouer. Le jeu doit être RÉELLEMENT jouable et fluide.
- Doit fonctionner AUSSI en react-native-web (pas d'API native exotique ; Dimensions.get("window") pour la taille).
- Texte de l'UI dans la langue demandée. AUCUN texte placeholder/lorem.

${CONTENT_TRUTH}

EXACTITUDE RELIGIEUSE (non négociable — vérité absolue) :
- Dès que l'écran touche à une religion (app d'une mosquée/église/synagogue/temple, contenu spirituel, horaires de prière, calendrier de fêtes, versets/hadiths/prières, rites, règles halal/casher, pèlerinages…), sois 100% SÛR de chaque information : uniquement des faits VÉRIDIQUES et fidèles à la religion réellement concernée.
- INTERDIT d'inventer : pas de faux versets/hadiths/prières, pas de fausses dates de fêtes, pas de faux noms de textes/prophètes/saints, pas de rites inventés. Ne mélange JAMAIS les religions entre elles.
- Donnée pas certaine à 100% (heure de prière, date d'une fête mobile, texte exact d'un verset) → NE l'invente PAS : rends-la paramétrable (état/config éditable) ou reste général et neutre. Un champ à remplir vaut mieux qu'une info fausse.
- Vocabulaire, termes et orthographe exacts de chaque tradition, ton respectueux et neutre.

SORTIE : uniquement le code du fichier, sans fence markdown, sans explication.${currentDateContext()}`;

const UI_KIT_PROMPT = (plan: MobilePlan, lang: string) => `App : "${plan.appName}" — ${plan.tagline}
Type : ${plan.isGame ? "JEU mobile" : "application mobile"}
Écrans prévus : ${plan.screens.map(s => `${s.name} (${s.route})`).join(", ")}
Langue UI : ${lang}

Écris le fichier components/ui.tsx : le kit UI partagé de l'app.
Exporte 4 à 7 composants réutilisables et cohérents avec le thème, par exemple :
- Screen (wrapper avec fond theme.bg + safe padding)
- AppButton (variantes primary/ghost, état pressed, disabled)
- Card (surface arrondie)
- Title / Subtitle (typographie)
- éventuellement Badge, EmptyState, StatRow selon les besoins des écrans.
Import du thème : import { theme } from "../lib/theme";
Chaque composant est typé (props TypeScript) et stylé avec StyleSheet.create.`;

const SCREEN_PROMPT = (plan: MobilePlan, screen: MobilePlan["screens"][number], uiKitCode: string, lang: string, imagesBlock = "") => `App : "${plan.appName}" — ${plan.tagline}
Type : ${plan.isGame ? "JEU mobile" : "application mobile"}
Écrans de l'app : ${plan.screens.map(s => `${s.name} → ${s.route}`).join(" · ")}
Langue UI : ${lang}

Kit UI partagé disponible (components/ui.tsx) — utilise ces composants :
---
${uiKitCode.slice(0, 6000)}
---

Écris le fichier ${screen.file} (route ${screen.route}) : écran "${screen.name}".
Objectif de l'écran : ${screen.purpose}
${screen.isGameLoop ? `C'EST L'ÉCRAN DE JEU : implémente la boucle de jeu complète (requestAnimationFrame), les contrôles tactiles, le score en direct, la détection de fin de partie, un overlay game-over avec bouton Rejouer et retour menu. La logique doit être correcte et le jeu réellement jouable.` : `Écran riche et fonctionnel : vraies interactions (état local, listes dynamiques, feedback visuel au toucher), design soigné, pas de contenu placeholder.`}
Import relatifs depuis app/ : ../lib/theme, ../components/ui.${imagesBlock}`;

// ─── Plan ────────────────────────────────────────────────────────────────────

export async function planMobileApp(input: MobileEngineInput, onProgress?: (msg: string) => void): Promise<MobilePlan> {
  const lang = (input.preferredLang || "fr").toLowerCase();
  const web = input.webContext;
  const isConversion = !!web && Array.isArray(web.pages);
  const promptText = isConversion ? CONVERT_PLAN_PROMPT(input, lang, web!) : PLAN_PROMPT(input, lang);
  onProgress?.(isConversion
    ? "🧠 Portage du site/app web vers le mobile (mêmes écrans, même identité)…"
    : "🧠 Planification des écrans de l'app mobile…");
  let plan: MobilePlan;
  try {
    plan = extractJSON((await ai(PLAN_SYSTEM, promptText, 4000, HEAVY_MODEL)).text);
  } catch {
    try {
      plan = extractJSON((await ai(PLAN_SYSTEM, promptText, 4000, CHEAP_JSON_MODEL)).text);
    } catch {
      plan = {
        appName: input.companyName || "Mon App", slug: "", tagline: "", isGame: false,
        colors: { bg: "#0d0f14", surface: "#161a22", primary: "#4f7cff", accent: "#22c58b", text: "#f5f7fa", textDim: "#8b93a3" },
        screens: [{ name: "Accueil", file: "app/index.tsx", route: "/", purpose: `Écran principal de l'app : ${input.idea}` }],
      };
    }
  }
  if (!plan.screens?.length) {
    plan.screens = [{ name: "Accueil", file: "app/index.tsx", route: "/", purpose: `Écran principal : ${input.idea}` }];
  }
  // Garanties : index présent, fichiers sous app/, pas de doublons.
  plan.screens = plan.screens
    .filter(s => s?.file && s.file.startsWith("app/") && s.file.endsWith(".tsx") && s.file !== "app/_layout.tsx")
    .filter((s, i, arr) => arr.findIndex(x => x.file === s.file) === i)
    .slice(0, 6);
  if (!plan.screens.some(s => s.file === "app/index.tsx")) {
    plan.screens.unshift({ name: "Accueil", file: "app/index.tsx", route: "/", purpose: `Écran principal : ${input.idea}` });
  }
  if (!plan.colors?.bg) plan.colors = { bg: "#0d0f14", surface: "#161a22", primary: "#4f7cff", accent: "#22c58b", text: "#f5f7fa", textDim: "#8b93a3" };

  // ── Conversion web→mobile : on force la fidélité au produit web ──
  if (isConversion && web) {
    // Jamais un jeu : c'est le portage d'une app web.
    plan.isGame = false;
    plan.screens.forEach(s => { s.isGameLoop = false; });
    // Réutilise EXACTEMENT la palette du site web (le modèle a pu dériver).
    const c = web.colors || {};
    plan.colors = {
      bg: c.background || plan.colors.bg,
      surface: c.surface || plan.colors.surface,
      primary: c.primary || plan.colors.primary,
      accent: c.accent || plan.colors.accent,
      text: c.text || plan.colors.text,
      textDim: c.muted || plan.colors.textDim,
    };
    // Nom + accroche cohérents avec le produit.
    plan.appName = plan.appName || input.companyName;
    if (web.tagline && !plan.tagline) plan.tagline = web.tagline;
    // Enrichit l'objectif de chaque écran avec les sections de la page web
    // correspondante (matching par similarité de nom) → l'écran mobile
    // reproduit vraiment les fonctionnalités de la page.
    const norm = (s: string) => (s || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]/g, "");
    for (const screen of plan.screens) {
      const sn = norm(screen.name);
      const match = web.pages.find(p => {
        const pn = norm(p.name);
        return pn && sn && (pn === sn || pn.includes(sn) || sn.includes(pn));
      });
      if (match?.sections && !screen.purpose.includes(match.sections.slice(0, 20))) {
        screen.purpose = `${screen.purpose}\nFonctionnalités à reproduire (issues de la page web "${match.name}") : ${match.sections}`.slice(0, 900);
      }
    }
  }

  // Le nom du projet fait FOI : si un vrai nom a été fixé (donné explicitement
  // par l'utilisateur ou déjà calculé dans la meta), l'IA ne doit PAS le
  // renommer/styliser (ex: « Dimention » ne doit jamais devenir « DimenGame »).
  // On réimpose le nom tel quel et on saute la partie « nommage » du plan.
  const forcedName = (input.companyName || "").trim();
  if (!isPlaceholderBrandName(forcedName)) {
    plan.appName = forcedName;
  }
  plan.slug = slugify(plan.appName || input.companyName);
  return plan;
}

// ─── Génération complète ─────────────────────────────────────────────────────

export async function generateMobileApp(
  input: MobileEngineInput,
  onProgress?: (msg: string) => void,
  isCancelled?: () => boolean,
): Promise<GeneratedMobileApp> {
  const throwIfCancelled = () => { if (isCancelled?.()) throw new Error("Build cancelled by user"); };
  const lang = (input.preferredLang || "fr").toLowerCase();

  // 1. Plan
  const plan = await planMobileApp(input, onProgress);
  throwIfCancelled();
  onProgress?.(`📋 Plan: mobile-app, ${plan.screens.length} pages · écrans: ${plan.screens.map(s => s.name).join(", ")}`);

  const meta: MobileAppMeta = {
    companyId: input.companyId,
    appName: plan.appName,
    slug: plan.slug,
    tagline: plan.tagline,
    colors: plan.colors,
    screens: plan.screens,
  };
  const files: ScaffoldFile[] = buildMobileScaffold(meta);

  // 1.5 Direction artistique — visuels des écrans (héro, cartes, galerie…),
  // SANS plafond. Générés en parallèle puis écrits dans lib/images.ts.
  let imageManifest: ImageManifest = { urls: {}, meta: {} };
  try {
    const slots = await planImageSlots({
      companyName: plan.appName,
      idea: input.idea || plan.tagline || "",
      industry: (input as any).industry,
      lang,
      design: { colors: plan.colors },
      pages: plan.screens.map((s) => ({ name: s.name, file: s.file, purpose: s.purpose, route: s.route })),
    });
    imageManifest = await generateImageManifest(slots, onProgress);
  } catch (e: any) {
    onProgress?.(`⚠️ Génération des visuels ignorée: ${e?.message || e}`);
  }
  {
    const imgFile = files.find((f) => f.path === "lib/images.ts");
    if (imgFile) imgFile.content = MOBILE_IMAGES_TS(imageManifest.urls);
    else files.push({ path: "lib/images.ts", content: MOBILE_IMAGES_TS(imageManifest.urls) });
  }
  throwIfCancelled();

  // 2. Kit UI partagé
  onProgress?.("🎨 Kit UI mobile partagé…");
  const cap = (s: string) => (s.length > 4000 ? s.slice(0, 4000) : s);
  onProgress?.(`[CODE_START:components/ui.tsx]`);
  let uiKit = "";
  try {
    uiKit = cleanCode(await aiCodeStream(
      MOBILE_CODE_SYSTEM,
      UI_KIT_PROMPT(plan, lang),
      (partial) => onProgress?.(`[CODE_STREAM:components/ui.tsx:${partial.split("\n").length}:${partial.length}]${cap(partial)}`),
      CODE_MODEL,
    ));
  } catch (e: any) {
    onProgress?.(`[ERREUR] Kit UI: ${e?.message || e} — écrans générés sans kit partagé`);
  }
  if (uiKit) {
    files.push({ path: "components/ui.tsx", content: uiKit });
    onProgress?.(`[CODE_DONE:components/ui.tsx:${uiKit.split("\n").length}:${uiKit.length}]${cap(uiKit)}`);
  }
  throwIfCancelled();

  // 3. Écrans en parallèle (streaming live). Logique de jeu → modèle lourd.
  onProgress?.(`📄 Génération de ${plan.screens.length} pages…`);
  let done = 0;
  const total = plan.screens.length;
  const results = await Promise.allSettled(plan.screens.map(async (screen) => {
    throwIfCancelled();
    onProgress?.(`[CODE_START:${screen.file}]`);
    const model = screen.isGameLoop ? HEAVY_MODEL : CODE_MODEL;
    const code = cleanCode(await aiCodeStream(
      MOBILE_CODE_SYSTEM,
      SCREEN_PROMPT(plan, screen, uiKit, lang, imagesPromptBlock(imageManifest, screen.file, "mobile")),
      (partial) => onProgress?.(`[CODE_STREAM:${screen.file}:${partial.split("\n").length}:${partial.length}]${cap(partial)}`),
      model,
      screen.isGameLoop ? 28000 : 20000,
    ));
    if (!code || code.length < 100) throw new Error(`Écran ${screen.name} vide`);
    files.push({ path: screen.file, content: code });
    done++;
    onProgress?.(`[CODE_DONE:${screen.file}:${code.split("\n").length}:${code.length}]${cap(code)}`);
    onProgress?.(`✓ [${done}/${total}] Écran ${screen.name} terminé`);
  }));

  const failed = results
    .map((r, i) => (r.status === "rejected" ? plan.screens[i] : null))
    .filter(Boolean) as MobilePlan["screens"];
  // Retry séquentiel une fois pour les écrans échoués.
  for (const screen of failed) {
    throwIfCancelled();
    onProgress?.(`▶ Nouvelle tentative pour l'écran ${screen.name}…`);
    try {
      const code = cleanCode(await aiCodeStream(
        MOBILE_CODE_SYSTEM,
        SCREEN_PROMPT(plan, screen, uiKit, lang, imagesPromptBlock(imageManifest, screen.file, "mobile")),
        () => {},
        screen.isGameLoop ? HEAVY_MODEL : CODE_MODEL,
      ));
      if (!code || code.length < 100) throw new Error("vide");
      files.push({ path: screen.file, content: code });
      done++;
      onProgress?.(`✓ [${done}/${total}] Écran ${screen.name} terminé (2e tentative)`);
    } catch (e: any) {
      onProgress?.(`✗ [ERREUR] Écran ${screen.name} abandonné: ${e?.message || e}`);
    }
  }

  // L'app doit au minimum avoir un index.
  if (!files.some(f => f.path === "app/index.tsx")) {
    files.push({
      path: "app/index.tsx",
      content: `import { View, Text, StyleSheet } from "react-native";\nimport { theme } from "../lib/theme";\n\nexport default function Home() {\n  return (\n    <View style={styles.root}>\n      <Text style={styles.title}>${plan.appName.replace(/[\\"`]/g, "")}</Text>\n      <Text style={styles.sub}>${(plan.tagline || "Bienvenue").replace(/[\\"`]/g, "")}</Text>\n    </View>\n  );\n}\n\nconst styles = StyleSheet.create({\n  root: { flex: 1, backgroundColor: theme.bg, alignItems: "center", justifyContent: "center", padding: 24 },\n  title: { color: theme.text, fontSize: 32, fontWeight: "800" },\n  sub: { color: theme.textDim, fontSize: 16, marginTop: 8, textAlign: "center" },\n});\n`,
    });
  }

  onProgress?.(`✓ [TERMINÉ] App mobile générée : ${files.length} fichiers, ${plan.screens.length} écrans`);
  return { files, plan };
}

// ─── Détection du type de projet (web / mobile / both / unknown) ─────────────
// 1re passe : regex à coût zéro sur l'idée. 2e passe : modèle rapide JSON.
// 'unknown' → le chat pose la question à l'utilisateur (3 options).
export type ProjectType = "web" | "mobile" | "both" | "unknown";

const MOBILE_RE = /\b(app(?:li(?:cation)?)?\s+mobile|mobile\s+app|application\s+(?:ios|android)|app\s+(?:ios|android)|ios\s+app|android\s+app|jeu\s+mobile|mobile\s+game|expo\b|react\s*native|app\s+(?:téléphone|telephone|smartphone)|play\s*store|app\s*store)\b/i;
const WEB_RE = /\b(site\s+(?:web|internet|vitrine)|website|web\s*site|landing\s*page|page\s+web|blog\b|e-?commerce|boutique\s+en\s+ligne|portfolio\s+en\s+ligne|web\s+app|application\s+web)\b/i;
const BOTH_RE = /\b(site\s+et\s+(?:une\s+)?app|app\s+et\s+(?:un\s+)?site|web\s+(?:et|\+)\s+mobile|mobile\s+(?:et|\+)\s+web|les\s+deux|both)\b/i;

export async function detectProjectType(idea: string): Promise<ProjectType> {
  const text = (idea || "").slice(0, 2000);
  // Idée vide ou aucune plateforme mentionnée → web par défaut (ne JAMAIS
  // redemander "site ou app mobile ?" pour une idée générale d'entreprise/
  // marque/produit — seule une demande mobile explicite doit dévier de web).
  if (!text.trim()) return "web";
  // Regex d'abord (0 coût, 0 latence).
  const hasMobile = MOBILE_RE.test(text);
  const hasWeb = WEB_RE.test(text);
  if (BOTH_RE.test(text) || (hasMobile && hasWeb)) return "both";
  if (hasMobile) return "mobile";
  if (hasWeb) return "web";
  // Modèle rapide en secours.
  try {
    const res = await ai(
      `Tu classifies une idée de projet. Réponds UNIQUEMENT un JSON: {"type":"web"|"mobile"|"both"}. "mobile" = l'utilisateur veut CLAIREMENT une app mobile/jeu mobile (téléphone), mentionne explicitement mobile/iOS/Android/app store. "both" = les deux sont clairement demandés. Pour TOUTE AUTRE idée (entreprise, marque, produit, service, boutique, etc. sans plateforme précisée), réponds "web" — c'est le défaut, ne jamais répondre autre chose que ces 3 valeurs.`,
      `Idée du projet : ${text}`,
      100,
      CHEAP_JSON_MODEL,
    );
    const parsed = extractJSON(res.text);
    if (parsed?.type === "web" || parsed?.type === "mobile" || parsed?.type === "both") return parsed.type;
  } catch { /* fallthrough */ }
  // Par défaut : web (jamais de question à l'utilisateur pour une idée générale).
  return "web";
}

// ─── Auto-fix après échec d'export web ───────────────────────────────────────
// Envoie l'erreur du bundler + le fichier suspect au modèle code, récupère le
// fichier corrigé. Utilisé par le runner mobile (max 2 passes).
export async function fixMobileFile(
  filePath: string,
  fileContent: string,
  buildError: string,
): Promise<string | null> {
  try {
    const raw = (await ai(
      MOBILE_CODE_SYSTEM,
      `Le build Expo (export web) a échoué avec cette erreur :\n---\n${buildError.slice(0, 3000)}\n---\n\nFichier ${filePath} actuel :\n---\n${fileContent.slice(0, 24000)}\n---\n\nCorrige le fichier pour que le build passe, en gardant TOUTES les fonctionnalités. Renvoie le fichier complet corrigé, sans fence markdown.`,
      24000,
      CODE_MODEL,
    )).text;
    const code = cleanCode(raw);
    return code && code.length > 50 ? code : null;
  } catch {
    return null;
  }
}
