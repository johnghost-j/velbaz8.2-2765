// ─── App Generation Engine ───────────────────────────────────────────────────
// Turns a business context into a complete set of full-stack project files.
// Flow: plan → design system → shared components → pages → App.tsx wiring.

import { generateText, streamText } from "ai";
import { createHash } from "node:crypto";
import { gateway } from "../agent/gateway";
import { db } from "../database/index";
import { designSystemCache } from "../database/schema";
import { eq } from "drizzle-orm";
import { gatherWebResearch, formatResearchForPrompt } from "../agents/web-research";
import { isPlaceholderBrandName } from "../agents/website";
import { buildScaffold, IMAGES_TS, LEGAL_CONTENT_TS, type ScaffoldFile, type AppMeta } from "./scaffold";
import { planLegalPack, defaultLegalPack, type LegalPack } from "./legal-compliance";
import { planImageSlots, generateImageManifest, imagesPromptBlock, generateContentImage, chimeraAssetsFromBrief, chimeraImageManifest, chimeraImagesPromptBlock, type ImageAspect, type ImageManifest } from "./images";
import { planAudioSlots, generateAudioManifest, audioPromptBlock, type AudioManifest } from "./audio";
import * as twentyFirst from "./twenty-first";
import { analyzePage, fixPage, analyzeDensity, improvePage, analyzeAdoption, forceComponentAdoption } from "./qa";
import { getLearnedPromptBlock, recordQAOutcome } from "./learning";
import { explainIntent, explainOutcome } from "./reasoning-agent";
import { sanitizeModelCode } from "./code-sanitize";
import {
  DESIGN_SYSTEM_PROMPT, CODE_SYSTEM, currentDateContext, PAGE_PROMPT, HEADER_PROMPT,
  FOOTER_PROMPT, PLAN_PROMPT, PLAN_PROMPT_LIGHT, CLONE_PAGE_PROMPT, CLONE_HEADER_PROMPT, CLONE_FOOTER_PROMPT, CLONE_APP_SCREEN_PROMPT, type BuildContext,
  EDIT_PLAN_SYSTEM, EDIT_PLAN_PROMPT, EDIT_FILE_SYSTEM, EDIT_FILE_PROMPT,
} from "./prompts";

const FALLBACK_CHAIN = ["anthropic/claude-sonnet-4.6", "openai/gpt-5.4", "google/gemini-3-flash"];

// Separator between OLD and NEW file contents inside a [CODE_EDIT] activity payload.
// Unlikely to appear in real source code. The frontend splits on the same token.
export const DIFF_SEP = "⟦⟦VELBAZ_DIFF_SEP⟧⟧";

// ── Récupération d'images pour les clés IMAGES.xxx manquantes ────────────────
// Quand une page utilise `IMAGES.xxx` sans que la clé existe dans le manifeste
// (le "directeur artistique" a prévu moins de visuels que ce que la page en
// réclame, ou la clé a un nom légèrement différent), on ne veut PAS afficher un
// dégradé plat moche. On GÉNÈRE de vraies images à partir du nom de la clé + du
// contexte métier, en parallèle. Le dégradé n'est qu'un ultime filet si même la
// génération échoue (offline, quota…). Retourne un data URI par clé.
function keyToImagePrompt(
  key: string,
  ctx: { companyName?: string; idea?: string; industry?: string },
): { prompt: string; aspect: ImageAspect; width: number } {
  const words = key
    .replace(/^(home|about|contact|shop|product|products|gallery|team|blog|pricing|services?|page)_/i, "")
    .replace(/_(img|image|photo|pic|visual|bg)$/i, "")
    .replace(/_/g, " ")
    .trim() || key.replace(/_/g, " ");
  const k = key.toLowerCase();
  let aspect: ImageAspect = "wide";
  let width = 1600;
  if (/avatar|profil|portrait|team|member|staff|founder|face|person|headshot/.test(k)) {
    aspect = "portrait"; width = 800;
  } else if (/card|gallery|feature|thumb|item|product|about/.test(k)) {
    aspect = "square"; width = 1000;
  } else if (/hero|banner|cover|header/.test(k)) {
    aspect = "wide"; width = 1600;
  }
  const bits = [words];
  if (ctx.companyName) bits.push(`pour « ${ctx.companyName} »`);
  if (ctx.industry) bits.push(`secteur : ${ctx.industry}`);
  if (ctx.idea) bits.push(ctx.idea.slice(0, 200));
  const prompt = `${bits.join(", ")}. Visuel de contenu professionnel, cohérent avec une marque moderne haut de gamme.`;
  return { prompt, aspect, width };
}

// Génère de vraies images pour un lot de clés manquantes (parallélisme borné).
// Retourne { key -> dataURI }. Si la génération échoue pour une clé, on met un
// dégradé SVG de secours pour cette clé précise afin de ne jamais laisser
// `url(undefined)` casser le rendu.
async function generateMissingImages(
  missingKeys: string[],
  ctx: { companyName?: string; idea?: string; industry?: string },
  onProgress?: (msg: string) => void,
  concurrency = 4,
): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  const gradients = [
    "#6366f1,#8b5cf6", "#0ea5e9,#22d3ee", "#f97316,#f43f5e", "#10b981,#84cc16",
  ];
  const gradientFor = (i: number) => {
    const [c1, c2] = gradients[i % gradients.length].split(",");
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="800"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0%" stop-color="${c1}"/><stop offset="100%" stop-color="${c2}"/></linearGradient></defs><rect width="1200" height="800" fill="url(#g)"/></svg>`;
    return `data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}`;
  };
  let done = 0;
  const queue = missingKeys.map((key, i) => ({ key, i }));
  async function worker() {
    for (;;) {
      const job = queue.shift();
      if (!job) return;
      const { prompt, aspect, width } = keyToImagePrompt(job.key, ctx);
      let url: string | null = null;
      try {
        url = await generateContentImage(prompt, aspect, width);
      } catch { /* handled below */ }
      done++;
      if (url) {
        out[job.key] = url;
        onProgress?.(`🖼️ Visuel de secours « ${job.key} » généré (${done}/${missingKeys.length})`);
      } else {
        out[job.key] = gradientFor(job.i);
        onProgress?.(`⚠️ Visuel « ${job.key} » non généré, dégradé utilisé (${done}/${missingKeys.length})`);
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, missingKeys.length) }, worker));
  return out;
}

// Thrown when the caller's isCancelled() reports true mid-build. Distinct from
// a real failure — the caller (index.ts) treats this as a genuine STOP: work
// already produced (checkpointed pages, files written so far) is preserved,
// nothing is deleted, but no further AI calls or page generation happens.
export class JobCancelledDuringGeneration extends Error {
  constructor() { super("Build cancelled by user"); this.name = "JobCancelledDuringGeneration"; }
}

async function ai(system: string, prompt: string, maxTokens = 8000, preferred = "anthropic/claude-sonnet-4.6", images?: string[]): Promise<{ text: string; truncated: boolean }> {
  const chain = [preferred, ...FALLBACK_CHAIN.filter(m => m !== preferred)];
  const imgs = (images || []).filter(Boolean);
  const messages = imgs.length
    ? [{
        role: "user" as const,
        content: [
          { type: "text" as const, text: prompt },
          ...imgs.map((url) => ({ type: "image" as const, image: new URL(url) })),
        ],
      }]
    : undefined;
  let lastErr: any = null;
  for (const model of chain) {
    try {
      const { text, finishReason } = await generateText({
        model: gateway(model), system,
        ...(messages ? { messages } : { prompt }),
        maxOutputTokens: Math.max(maxTokens, 4000),
      });
      const out = (text || "").trim();
      if (out.length > 0) return { text: out, truncated: finishReason === "length" };
    } catch (e: any) { lastErr = e; }
  }
  if (lastErr) throw lastErr;
  return { text: "", truncated: false };
}

async function aiText(system: string, prompt: string, maxTokens = 8000, preferred = "anthropic/claude-sonnet-4.6"): Promise<string> {
  return (await ai(system, prompt, maxTokens, preferred)).text;
}

// [2026-09-05] Partage coût/qualité, calqué sur engine-mobile.ts (l.15-16) où
// il tourne déjà : Sonnet écrit, Opus patche.
//
// ÉCRITURE d'une page NEUVE (fichier vierge, aucun existant à préserver) :
// Sonnet 4.6. C'est le gros du volume d'appels d'un build.
const CODE_MODEL = "anthropic/claude-sonnet-4.6";
// MODIFICATION d'un fichier EXISTANT : Opus 4.7, conservé volontairement.
// La règle qui était écrite ici disait : « Opus est le seul modèle assez fiable
// pour patcher du code React existant sans casser. » Elle vise le patch, pas
// l'écriture neuve — donc elle reste appliquée là où elle a un sens : l'édition
// depuis le chat, qui relit du code déjà livré et doit le préserver.
const EDIT_MODEL = "anthropic/claude-sonnet-4.6";
// Modèle pour les petites tâches JSON (plan, classification): Gemini Flash —
// largement suffisant pour du JSON structuré, ~30x moins cher qu'Opus.
const CHEAP_JSON_MODEL = "google/gemini-3-flash";
// Son : jamais d'initiative de l'IA. Tant que ce drapeau est à true, aucun son
// n'est planifié ni généré si l'utilisateur ne l'a pas explicitement demandé
// (plus de bruit au clic ajouté d'office). Le système de son reste en place et
// se réactive dès que la demande contient « son », « audio », « musique »…
const AUDIO_ONLY_WHEN_REQUESTED = true;

// Generate code and, if the model got cut off (finishReason=length), ask it to
// continue from where it stopped and stitch the parts together.
async function aiCode(system: string, prompt: string, maxTokens = 16000, images?: string[], model: string = CODE_MODEL): Promise<string> {
  let { text, truncated } = await ai(system, prompt, maxTokens, model, images);
  let guard = 0;
  while (truncated && guard < 2) {
    guard++;
    const tail = text.slice(-1200);
    const cont = await ai(
      system,
      `${prompt}\n\n## CONTINUE\nTu avais commencé cette réponse mais elle a été coupée. Voici la fin de ce que tu avais écrit:\n---\n${tail}\n---\nContinue EXACTEMENT à partir de là (ne répète pas ce qui précède, ne remets pas de fence markdown). Termine le fichier proprement.`,
      maxTokens,
      model,
    );
    text += cont.text;
    truncated = cont.truncated;
  }
  return text;
}

// Streaming variant of aiCode: yields the growing text via onDelta so the caller
// can push a live "code being written" view to the UI. Falls back to the first
// working model in the chain; if streaming fails entirely it throws (caller can
// fall back to the blocking aiCode). Continuation-on-truncation is preserved.
async function aiCodeStream(
  system: string,
  prompt: string,
  onDelta: (fullText: string) => void,
  maxTokens = 20000,
  images?: string[],
): Promise<string> {
  const chain = [CODE_MODEL, ...FALLBACK_CHAIN.filter((m) => m !== CODE_MODEL)];
  const imgs = (images || []).filter(Boolean);
  // Message multimodal (texte + captures d'écran de la page réelle) quand des
  // images de référence sont fournies (mode clone). Sinon, prompt texte simple.
  const firstMessages = imgs.length
    ? [{
        role: "user" as const,
        content: [
          { type: "text" as const, text: prompt },
          ...imgs.map((url) => ({ type: "image" as const, image: new URL(url) })),
        ],
      }]
    : undefined;
  let lastErr: any = null;
  for (const model of chain) {
    try {
      let text = "";
      let finishReason: string | undefined;
      const result = streamText({
        model: gateway(model), system,
        ...(firstMessages ? { messages: firstMessages } : { prompt }),
        maxOutputTokens: Math.max(maxTokens, 4000),
      });
      for await (const delta of result.textStream) {
        text += delta;
        onDelta(text);
      }
      finishReason = await result.finishReason;
      let truncated = finishReason === "length";
      let guard = 0;
      // Continue if the model got cut off mid-file.
      while (truncated && guard < 2) {
        guard++;
        const tail = text.slice(-1200);
        const cont = streamText({
          model: gateway(model), system,
          prompt: `${prompt}\n\n## CONTINUE\nTu avais commencé cette réponse mais elle a été coupée. Voici la fin de ce que tu avais écrit:\n---\n${tail}\n---\nContinue EXACTEMENT à partir de là (ne répète pas ce qui précède, ne remets pas de fence markdown). Termine le fichier proprement.`,
          maxOutputTokens: Math.max(maxTokens, 4000),
        });
        for await (const delta of cont.textStream) {
          text += delta;
          onDelta(text);
        }
        truncated = (await cont.finishReason) === "length";
      }
      if (text.trim().length > 0) return text.trim();
    } catch (e: any) { lastErr = e; }
  }
  if (lastErr) throw lastErr;
  return "";
}

// ─── Aperçu en direct : instantané COMPILABLE du code en cours d'écriture ────
// Problème corrigé : pendant qu'une page était générée (streaming), l'aperçu
// gardait le stub SKELETON jusqu'à ce que la page soit 100 % terminée. On voyait
// donc des rectangles gris au lieu du vrai site en train d'être écrit.
// Ici on fabrique, à intervalle régulier, un instantané du VRAI code partiel :
//  1. on tronque à une fin de ligne,
//  2. on referme automatiquement les balises JSX ouvertes puis les
//     parenthèses/accolades/crochets restants,
//  3. on VALIDE la syntaxe avec le transpileur de Bun (loader tsx).
// Si aucun candidat ne compile, on n'écrit RIEN (le dernier instantané valide,
// ou le stub, reste affiché) → jamais d'écran d'erreur Vite dans l'aperçu.
// Ces instantanés ne sont JAMAIS ajoutés aux fichiers finaux : la version finale
// de la page écrase l'instantané dès qu'elle est prête.
function pendingDelimiters(src: string): string[] {
  const stack: string[] = [];
  let i = 0;
  const n = src.length;
  while (i < n) {
    const c = src[i];
    const next = src[i + 1];
    // Commentaires
    if (c === "/" && next === "/") { const nl = src.indexOf("\n", i); if (nl < 0) return []; i = nl + 1; continue; }
    if (c === "/" && next === "*") { const end = src.indexOf("*/", i + 2); if (end < 0) return []; i = end + 2; continue; }
    // Chaînes
    if (c === '"' || c === "'" || c === "`") {
      i++;
      while (i < n) {
        if (src[i] === "\\") { i += 2; continue; }
        if (src[i] === c) { i++; break; }
        i++;
      }
      if (i > n) return [];
      continue;
    }
    if (c === "(" || c === "{" || c === "[") stack.push(c);
    else if (c === ")" || c === "}" || c === "]") stack.pop();
    i++;
  }
  return stack.reverse().map((d) => (d === "(" ? ")" : d === "{" ? "}" : "]"));
}

function pendingJsxTags(src: string): string[] {
  const stack: string[] = [];
  const re = /<\/?([A-Za-z][\w.]*)((?:"[^"]*"|'[^']*'|\{[^{}]*\}|[^>"'])*?)(\/?)>/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src))) {
    const tag = m[1];
    if (m[0].startsWith("</")) { const at = stack.lastIndexOf(tag); if (at >= 0) stack.splice(at, 1); }
    else if (m[3] !== "/") stack.push(tag);
  }
  return stack.reverse();
}

let tsxChecker: any = null;
function syntaxOk(code: string): boolean {
  try {
    if (typeof (globalThis as any).Bun === "undefined") return false;
    if (!tsxChecker) tsxChecker = new (globalThis as any).Bun.Transpiler({ loader: "tsx" });
    tsxChecker.transformSync(code);
    return true;
  } catch { return false; }
}

// Renvoie un instantané compilable du code partiel, ou null si impossible.
function renderablePartial(partial: string): string | null {
  const src = (partial || "").trim();
  if (src.length < 400 || !/export\s+default/.test(src)) return null;
  if (typeof (globalThis as any).Bun === "undefined") return null;
  // On remonte ligne par ligne depuis la fin : le premier candidat qui compile
  // gagne. Plafonné pour rester négligeable en CPU (~40 essais max).
  const lines = src.split("\n");
  const maxTries = Math.min(40, lines.length - 1);
  for (let drop = 1; drop <= maxTries; drop++) {
    const head = lines.slice(0, lines.length - drop).join("\n");
    if (!/export\s+default/.test(head)) return null;
    const jsx = pendingJsxTags(head).map((t) => `</${t}>`).join("");
    const delims = pendingDelimiters(head).join("");
    if (!jsx && !delims) {
      if (syntaxOk(head)) return head;
      continue;
    }
    const candidate = `${head}\n${jsx}${delims}`;
    if (syntaxOk(candidate)) return candidate;
  }
  return null;
}

function extractJSON(raw: string): any {
  let s = raw.trim();
  if (s.startsWith("```")) s = s.replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/, "");
  const start = s.indexOf("{");
  const end = s.lastIndexOf("}");
  if (start !== -1 && end !== -1) s = s.slice(start, end + 1);
  return JSON.parse(s);
}

/**
 * [2026-09-05] Bug 22 — Relevés de pages /genesis.
 *
 * Le run /genesis rend une image PLEINE PAGE de chaque page du site, interface
 * comprise, puis la fait relever par le modèle de vision. Ces relevés sont
 * déposés dans la spec sous des marqueurs posés par le code (jamais par un
 * modèle) : [[CADRE-TRANSCRIT route=/x nom=… cadre=n]] … [[/CADRE-TRANSCRIT]].
 *
 * Ici on les ressort tels quels pour les recoller dans le prompt de code de LA
 * page correspondante. Sans ça, la page était écrite d'après le prompt d'image
 * — le texte qu'on avait DEMANDÉ au générateur — et l'image rendue ne servait
 * que de fond.
 */
export interface GenesisFrameTranscript {
  route: string;
  name: string;
  frame: number;
  text: string;
}

const FRAME_TRANSCRIPT_RE =
  /\[\[CADRE-TRANSCRIT\s+route=(\S*)\s+nom=([^\]]*?)\s+cadre=(\d+)\]\]([\s\S]*?)\[\[\/CADRE-TRANSCRIT\]\]/g;

export function parseFrameTranscripts(spec: string): GenesisFrameTranscript[] {
  const out: GenesisFrameTranscript[] = [];
  for (const m of String(spec || "").matchAll(FRAME_TRANSCRIPT_RE)) {
    const text = (m[4] || "").trim();
    if (text.length < 200) continue;
    out.push({
      route: (m[1] || "/").trim() || "/",
      name: (m[2] || "").trim(),
      frame: parseInt(m[3], 10) || 0,
      text,
    });
  }
  return out;
}

/** Normalise une route pour comparer /Detail-Velo/ et /detail-velo. */
function routeKey(r: string): string {
  return String(r || "/").trim().toLowerCase().replace(/\/+$/, "") || "/";
}

/**
 * Relevé à utiliser pour une page donnée : route d'abord (seul appariement
 * fiable), puis rang du cadre. Aucun appariement approximatif : si rien ne
 * correspond, on renvoie null et l'appelant le dit.
 */
export function transcriptForPage(
  transcripts: GenesisFrameTranscript[],
  page: { route?: string; name?: string },
  index: number,
): GenesisFrameTranscript | null {
  if (!transcripts.length) return null;
  const byRoute = transcripts.find(t => routeKey(t.route) === routeKey(page.route || ""));
  if (byRoute) return byRoute;
  const byName = page.name
    ? transcripts.find(t => t.name && t.name.toLowerCase() === page.name!.toLowerCase())
    : null;
  if (byName) return byName;
  return transcripts[index] ?? null;
}

// Le nettoyage réel vit dans ./code-sanitize : il retire aussi la prose de
// raisonnement que le modèle écrit parfois AVANT le code (sans clôture ```),
// ce que l'ancienne version laissait passer → fichiers .tsx invalides.
function cleanCode(raw: string): string {
  return sanitizeModelCode(raw);
}

// Ask the AI to pick the BEST 21st.dev component searches for this specific
// site/app, page by page. Returns a map: page.file -> array of search queries.
// This replaces hardcoded keyword guessing — the model understands the business
// and design intent and requests exactly the components that fit.
async function plan21stQueries(
  ctx: BuildContext,
  design: any,
  plan: AppPlan,
): Promise<Map<string, string[]>> {
  const result = new Map<string, string[]>();
  const pagesForPrompt = plan.pages.map((p) => ({
    file: p.file, name: p.name, route: p.route,
    purpose: p.purpose, sections: p.sections, isCore: !!p.isCore,
  }));

  const system = `Tu es un DIRECTEUR DE PRODUIT + designer UI qui connaît parfaitement la bibliothèque 21st.dev (composants React premium). Ton rôle: pour chaque page, choisir les MEILLEURES recherches de composants à faire sur 21st.dev.

⚠️ RAISONNE PAR RÔLE FONCTIONNEL, PAS PAR MOTS-CLÉS AU HASARD.
Avant de proposer une requête, demande-toi: "De quelles PIÈCES cette page a-t-elle réellement besoin pour fonctionner et être belle ?" Puis une requête ciblée par pièce. N'invente pas de requêtes décoratives sans rôle (ex: "text rotate", "marquee", "dotted background" sur une page qui n'en a pas besoin = INTERDIT).

RÈGLES ANTI-BRUIT (très important):
- ZÉRO DOUBLON FONCTIONNEL. Si une pièce en contient déjà une autre, ne demande PAS la seconde séparément. Exemple: une "AI prompt box" moderne intègre déjà le champ de saisie, le bouton d'envoi, l'upload de fichier et le micro → NE demande PAS "send button", "file upload" ni "voice input" en plus, ils sont DEDANS.
- Chaque requête doit avoir un rôle CLAIR et DISTINCT sur la page. Si tu ne peux pas justifier son rôle en une phrase, supprime-la.
- Choisis la pièce qui COUVRE LE PLUS. Préfère un composant riche et complet à plusieurs petits.

FORMAT REQUÊTE:
- 2 à 5 mots en anglais (l'API 21st.dev attend de l'anglais), ex: "AI prompt input box", "chat message list", "streaming markdown response", "reasoning thinking steps".
- Privilégie les composants RICHES et PREMIUM: animés (framer-motion), interactifs, micro-interactions. Ajoute "animated", "interactive", "modern", "premium" quand pertinent.

🧠 ANATOMIE D'UNE INTERFACE DE CHAT IA (quand la page est un chat/assistant/conversation avec l'IA, couvre TOUTES ces pièces, une requête par pièce, sans doublon):
1. Zone de saisie tout-en-un → "AI prompt input box" (contient déjà champ + envoi + upload + micro).
2. Fil de messages / bulles conversation → "chat message list bubbles".
3. Rendu de la RÉPONSE de l'IA (texte formaté) → "streaming markdown chat response" (markdown, code blocks, texte qui s'écrit).
4. Bloc de raisonnement / THINKING de l'IA → "AI reasoning thinking steps" (le panneau qui montre la réflexion + la liste des tâches/étapes que l'IA exécute).
5. Indicateur de génération → "AI typing loading indicator".
6. Historique des conversations (barre latérale) → "chat history sidebar".
Ne demande une pièce que si la page en a besoin. Pour un chat, les pièces 1 à 4 sont quasi obligatoires; 5 et 6 selon les sections de la page.

AUTRES:
- 1 à 5 requêtes par page selon sa complexité (un chat complet = jusqu'à 5), uniquement les pièces qui comptent VRAIMENT.
- Choisis selon le business, l'industrie et le design/vibe donnés.
- Réponds UNIQUEMENT en JSON valide.`;

  const prompt = `## PROJET
- Nom: ${ctx.companyName}
- Idée: ${ctx.idea}
${ctx.industry ? `- Industrie: ${ctx.industry}` : ""}
${ctx.targetAudience ? `- Audience: ${ctx.targetAudience}` : ""}
- Type d'app: ${plan.appType}
- Design/vibe: ${design?.vibe || ""} — ${design?.designNotes || ""}

## PAGES
${JSON.stringify(pagesForPrompt, null, 2)}

Pour chaque page, donne les meilleures recherches de composants 21st.dev.
Réponds EXACTEMENT sous cette forme JSON:
{
  "pages": [
    { "file": "<file exact de la page>", "queries": ["hero section", "pricing table"] }
  ]
}`;

  try {
    // Planning de requêtes = tâche courte et structurée → Sonnet (rapide) suffit,
    // Opus reste dans la chaîne de secours via aiText.
    const raw = await aiText(system, prompt, 2000, "anthropic/claude-sonnet-4.6");
    const parsed = extractJSON(raw);
    const arr: any[] = Array.isArray(parsed?.pages) ? parsed.pages : [];
    for (const entry of arr) {
      const file = String(entry?.file || "").trim();
      if (!file) continue;
      const queries = Array.isArray(entry?.queries)
        ? entry.queries.map((q: any) => String(q || "").trim()).filter(Boolean).slice(0, 5)
        : [];
      if (queries.length) result.set(file, queries);
    }
  } catch {
    // If the planning call fails, return empty — generation still proceeds
    // without 21st.dev refs rather than falling back to random keywords.
  }
  return result;
}

function detectLang(text: string): string {
  // [2026-09-13] L'ancienne liste ratait les demandes FR COURTES : « ajoute mon
  // premier produit » ne contenait aucun de ses mots → "en", et l'IA écrivait
  // du contenu ANGLAIS dans un site français. On ajoute les mots-outils et les
  // verbes d'édition FR les plus fréquents, et un accent/une élision suffit :
  // ce sont des marqueurs qui n'existent pas en anglais.
  if (/[àâäçéèêëîïôöùûü]/i.test(text)) return "fr";
  if (/\b(l|d|j|n|s|qu|c)['’]/i.test(text)) return "fr"; // l'image, d'accord, qu'il…
  const fr = /\b(je|tu|mon|ma|mes|ton|ta|tes|une?|les?|des?|du|au|aux|ce|cet|cette|est|sont|avec|sans|pour|dans|sur|mais|aussi|plus|moins|que|qui|pas|tr[èe]s|premi[èe]re?|deuxi[èe]me|produit|produits|bouton|couleur|texte|titre|image|prix|panier|accueil|ajoute[rz]?|rajoute[rz]?|mets?|mettre|change[rz]?|supprime[rz]?|enl[èe]ve|corrige|cr[ée]e[rz]?|fais|faire|entreprise|boutique|comme|site|application)\b/gi;
  const m = text.match(fr);
  return m && m.length >= 2 ? "fr" : "en";
}

export interface AppPlan {
  appType: string;
  /** Widget d'assistant IA flottant. false par défaut — true seulement si
   *  l'utilisateur le demande ou si c'est vraiment pertinent pour le produit. */
  includeAssistant?: boolean;
  /** Système de compte/connexion. true par défaut. false quand l'utilisateur
   *  demande explicitement de ne pas en avoir, ou quand aucun compte n'a de sens
   *  pour le produit (outil local/vitrine sans données privées). */
  includeAuth?: boolean;
  entities?: Array<{ collection: string; fields: string; description?: string }>;
  pages: Array<{
    name: string; file: string; route: string;
    purpose: string; sections: string;
    isCore?: boolean; hasPayment?: boolean; hasForm?: boolean;
    /** Position dans l'ordre logique de navigation (1 = page principale). */
    navOrder?: number;
    /** true = lien visible dans la nav du haut. false = accessible via boutons in-page uniquement. */
    showInNav?: boolean;
    /** MODE CLONE — ÉTAPE 2 : écran intérieur FONCTIONNEL (dashboard, éditeur,
     *  chat IA, templates, paramètres) reconstruit via recherche d'images et
     *  câblé au backend réel (data.* + IA embarquée), pas un pur clone visuel. */
    isAppScreen?: boolean;
    /** URL de la capture de référence (recherche web) de cet écran interne. */
    screenRefImage?: string;
    /** Spécification fonctionnelle : ce que l'écran doit RÉELLEMENT faire. */
    functionalSpec?: string;
  }>;
}

export interface GeneratedApp {
  files: ScaffoldFile[];
  design: any;
  plan: AppPlan;
  meta: AppMeta;
}

/**
 * Durable resume blob for a build. Persisted to executionState.checkpoint.build
 * as each artifact is produced, so a server restart mid-build CONTINUES from the
 * last checkpoint instead of regenerating everything from scratch (which was the
 * source of duplicated steps/pages). All fields optional — the build fills them in.
 */
export interface BuildResume {
  /** Coarse progress marker: which phase was reached before the interruption. */
  phase?: "plan" | "design" | "pages" | "polish" | "done";
  plan?: AppPlan;
  design?: any;
  meta?: AppMeta;
  /** Shared components already generated (skip re-generating on resume). */
  header?: string;
  footer?: string;
  /**
   * Per-page work already done, keyed by page file name.
   *  - stage "draft"  → code generated but QA/densify not yet finalised.
   *  - stage "final"  → page fully processed (generate + QA + densify done).
   */
  pages?: Record<string, { code: string; stage: "draft" | "final" }>;
  /** AI-generated content images (data-URI manifest) — reused on resume. */
  images?: ImageManifest;
  /** AI-generated audio (data-URI manifest) — reused on resume. Optional. */
  audio?: AudioManifest;
  /** Country-adapted legal pack from the dedicated legal AI (produced FIRST,
   *  before page planning) — reused on resume so it's never regenerated. */
  legal?: LegalPack;
}

/** Patch emitted whenever a durable build artifact is produced (merged by caller). */
export type BuildCheckpointPatch = Partial<BuildResume> & {
  /** When set, upserts a single page into the resume blob (merge, don't replace). */
  page?: { file: string; code: string; stage: "draft" | "final" };
};

export type OnCheckpoint = (patch: BuildCheckpointPatch) => void | Promise<void>;

export interface EngineInput {
  companyName: string;
  idea: string;
  industry?: string;
  targetAudience?: string;
  priceRange?: string;
  products?: string;
  userMessage?: string;
  /**
   * [2026-09-05] Bug 20 — Spec du run `/genesis` (chimera), telle qu'elle est
   * aussi collée dans `userMessage` pour servir de contexte au design et au
   * code. Elle est répétée ICI pour pouvoir être RETIRÉE du texte lu par les
   * détecteurs d'INTENTION (voir `userIntentText`). Rien n'est supprimé :
   * `userMessage` continue de contenir la spec exactement comme avant.
   */
  genesisSpec?: string;
  /** AI-generated brand logo (data URI or CDN URL) — shown in Header/Footer. */
  logoUrl?: string;
  /**
   * When provided, the engine SKIPS the AI planning step and builds exactly
   * these pages (from the user's page-selection questionnaire). Standard pages
   * (login/settings/terms/…) are always added deterministically regardless.
   */
  selectedPages?: AppPlan["pages"];
  /**
   * Company's configured primary language (from companies.languages). When set,
   * it OVERRIDES text-based language detection so the generated site matches the
   * i18n config the user chose, not just the language they happened to type in.
   */
  preferredLang?: string;
  /**
   * Country / jurisdiction captured from the discovery questionnaire. Feeds the
   * dedicated legal AI so the legal pack (privacy, terms, legal notice, cookies)
   * is adapted to the right legal framework. May be a country name or ISO code;
   * when empty the legal AI infers the most likely jurisdiction from the idea.
   */
  country?: string;
  /**
   * Référence de CLONAGE : résultat de scraping (SiteCloneResult) d'un site que
   * l'utilisateur veut recréer À L'IDENTIQUE. Quand présent, le moteur SAUTE la
   * recherche marché générique et injecte le brief du site réel (JSON + images)
   * comme référence absolue → il reconstruit fidèlement le site source.
   */
  cloneReference?: import('../site-scraper').SiteCloneResult;
}

/**
 * Normalise l'ORDRE et la NAVIGATION des pages de façon déterministe, en
 * respectant le raisonnement de l'AI (navOrder/showInNav) tout en garantissant
 * une logique cohérente:
 *  - la page principale (route "/") est TOUJOURS première et dans la nav;
 *  - le reste est trié par navOrder puis par ordre d'origine (stable);
 *  - showInNav manquant → défaut sensé (les pages détail ":id" et facturation
 *    ne polluent PAS la nav du haut; les autres pages de contenu y sont).
 */
function orderPages(pages: AppPlan["pages"]): AppPlan["pages"] {
  const isDetail = (r: string) => /:/.test(r);
  const isBilling = (r: string, n: string) =>
    /billing|factur|abonnement|subscription/i.test(`${r} ${n}`);
  const withDefaults = pages.map((p, i) => {
    const isHome = p.route === "/";
    const showInNav =
      typeof p.showInNav === "boolean"
        ? p.showInNav
        : isHome
          ? true
          : isDetail(p.route) || isBilling(p.route, p.name)
            ? false
            : true;
    return { ...p, showInNav: isHome ? true : showInNav, _idx: i };
  });
  withDefaults.sort((a, b) => {
    // La page principale d'abord, quoi qu'il arrive.
    if (a.route === "/" && b.route !== "/") return -1;
    if (b.route === "/" && a.route !== "/") return 1;
    const ao = typeof a.navOrder === "number" ? a.navOrder : 1e9;
    const bo = typeof b.navOrder === "number" ? b.navOrder : 1e9;
    if (ao !== bo) return ao - bo;
    return a._idx - b._idx;
  });
  return withDefaults.map(({ _idx, ...p }) => p);
}

// Turn a finished page's REAL code into concrete, PAST-TENSE accomplishments
// (what actually got built), derived from the code — not guesses. Used to emit
// granular per-page progress ("Page 2 — 4 sections, ajout/édition/suppression
// câblés, recherche + état vide") instead of a flat "generating pages".
function describePageWork(code: string): string[] {
  const done: string[] = [];
  const count = (re: RegExp) => (code.match(re) || []).length;
  const sections = count(/<(section|header|main|aside)\b/g);
  if (sections) done.push(`${sections} section${sections > 1 ? "s" : ""} structurée${sections > 1 ? "s" : ""}`);
  const crud: string[] = [];
  if (/\bdata\.create\s*\(/.test(code)) crud.push("ajout");
  if (/\bdata\.update\s*\(/.test(code)) crud.push("édition");
  if (/\bdata\.remove\s*\(/.test(code)) crud.push("suppression");
  if (/\bdata\.(list|get)\s*\(/.test(code)) crud.push("chargement");
  if (crud.length) done.push(`données câblées (${crud.join(", ")})`);
  const buttons = count(/<button\b/g);
  const links = count(/<Link\b/g);
  if (buttons) done.push(`${buttons} bouton${buttons > 1 ? "s" : ""} actif${buttons > 1 ? "s" : ""}`);
  if (links) done.push(`${links} lien${links > 1 ? "s" : ""} de navigation`);
  const forms = count(/<form\b/g);
  if (forms) done.push(`${forms} formulaire${forms > 1 ? "s" : ""} contrôlé${forms > 1 ? "s" : ""}`);
  if (/\baiChat\s*\(/.test(code)) done.push("IA embarquée branchée");
  if (/\bcheckout\s*\(/.test(code)) done.push("paiement Stripe câblé");
  if (/\b(search|recherche|filter|filtre)\b/i.test(code)) done.push("recherche/filtres");
  if (/(aucun|vide|empty|no .*(yet|found))/i.test(code)) done.push("état vide");
  if (/\b(loading|chargement|isLoading|Skeleton|Spinner)\b/.test(code)) done.push("état de chargement");
  const states = count(/\buseState\s*\(/g);
  if (states) done.push(`${states} état${states > 1 ? "s" : ""} React`);
  return done;
}

// ── Demande "UNE page" (page blanche / vide / une seule page) ────────────────
// Quand l'utilisateur dit "crée une page blanche", il parle d'UNE page : le
// builder ne doit PAS proposer un plan multi-pages ni un questionnaire de
// sélection — il construit exactement une page, sans recherche web ni IA de
// planification.
/**
 * [2026-09-05] Bug 20 — TEXTE D'INTENTION DE L'UTILISATEUR.
 *
 * Symptôme observé sur un vrai build : 4 pages choisies par l'utilisateur, et
 * le moteur annonçait « Demande d'une page unique — construction d'UNE seule
 * page (vide) » puis produisait une page VIDE.
 *
 * Cause : la spec `/genesis` (~27 000 caractères) est injectée dans
 * `userMessage`. Cette spec DÉCRIT un site, donc elle contient des phrases
 * comme « Une page qui introduit une autre couleur d'accent… ». Les détecteurs
 * d'intention (`isSinglePageRequest`, `wantsAssistant`, `wantsNoAuth`, la
 * requête de recherche web, la détection de demande de son) lisaient ce texte
 * et prenaient une phrase de la spec pour une demande de l'utilisateur.
 *
 * Correctif : l'intention n'est lue QUE dans ce que l'utilisateur a écrit. La
 * spec est retirée du texte — et uniquement pour ces détecteurs : les prompts
 * de design et de code, eux, reçoivent toujours `userMessage` complet.
 */
function userIntentText(input: EngineInput): string {
  let msg = input.userMessage || "";
  const spec = (input.genesisSpec || "").trim();
  if (spec && msg.includes(spec)) msg = msg.replace(spec, " ");
  return `${input.idea || ""} ${msg}`;
}

export function isSinglePageRequest(text: string): boolean {
  const t = (text || "").toLowerCase();
  return /\b(page|site|landing)\b[\s\S]{0,25}?\b(blanche?|vide|vierge|blank|empty)\b/.test(t)
    || /\b(blank|empty)\s+(page|site|landing)\b/.test(t)
    || /\b(une|1)\s+(seule\s+)?page\b/.test(t)
    || /\bjuste\s+(une|1)\s+page\b/.test(t)
    || /\b(single|one)\s+page\b/.test(t);
}

// Détecte si l'utilisateur a EXPLICITEMENT demandé un assistant/chatbot flottant.
// "chat" seul ne suffit pas (trop ambigu: "comme ChatGPT" = produit chat, pas widget).
export function wantsAssistant(text: string): boolean {
  const t = (text || "").toLowerCase();
  return [
    /\bassistants?\b/,
    /\bchat ?bots?\b/,
    /\blive ?chat\b/,
    /\bchat\s+(en\s+direct|de\s+support|d'aide|ia|ai)\b/,
    /\b(widget|bulle|bouton)\s+de\s+chat\b/,
    /\bsupport\s+chat\b/,
  ].some((re) => re.test(t));
}

// L'utilisateur demande-t-il EXPLICITEMENT de NE PAS avoir de système de
// compte / connexion / inscription ? (FR + EN). Priorité absolue sur tout le
// reste : si détecté, l'app est générée sans aucune auth.
export function wantsNoAuth(text: string): boolean {
  const t = (text || "").toLowerCase();
  return [
    /\b(sans|aucun[e]?|pas\s+d[e']|ni\s+d[e']?)\s+(compte|connexion|connection|inscription|login|authentification|auth)\b/,
    /\b(enl[eè]ve|enleve|retire|supprime|vire|pas\s+besoin\s+d[e'])\s+(le\s+|la\s+|les\s+|de\s+|du\s+|un\s+)?(syst[eè]me\s+de\s+)?(compte|connexion|connection|inscription|login|auth)/,
    /\bpas\s+de\s+(syst[eè]me\s+de\s+)?(compte|connexion|connection|inscription|login|auth)/,
    /\bno\s+(user\s+)?(account|accounts|login|log-?in|signup|sign-?up|sign\s+in|auth|authentication)\b/,
    /\bwithout\s+(a\s+)?(account|accounts|login|log-?in|signup|sign-?up|auth|authentication)\b/,
    /\b(remove|disable|drop)\s+(the\s+)?(account|accounts|login|log-?in|signup|sign-?up|auth|authentication)\b/,
  ].some((re) => re.test(t));
}

// L'utilisateur demande-t-il EXPLICITEMENT d'AJOUTER un système de compte /
// connexion ? (FR + EN). Utilisé pour ré-activer l'auth si le plan l'avait
// désactivée, ou pour lever un doute.
export function wantsExplicitAuth(text: string): boolean {
  const t = (text || "").toLowerCase();
  return [
    /\b(ajoute|met[s]?|mettre|active|rajoute|avec)\s+(un\s+|le\s+|la\s+|les\s+|de\s+la\s+)?(syst[eè]me\s+de\s+)?(compte|connexion|connection|inscription|login|authentification|auth)/,
    /\b(add|enable|with)\s+(a\s+|the\s+|user\s+)?(account|accounts|login|log-?in|signup|sign-?up|sign\s+in|auth|authentication)\b/,
  ].some((re) => re.test(t));
}

function singleBlankPagePlan(): AppPlan {
  return {
    appType: "static",
    entities: [],
    pages: [
      {
        name: "Page",
        file: "Page.tsx",
        route: "/",
        purpose: "Page unique volontairement vide (page blanche demandée par l'utilisateur)",
        sections: "PAGE BLANCHE VOLONTAIRE : rends uniquement un conteneur plein écran avec fond blanc (min-h-screen bg-white), AUCUN texte, AUCUNE section marketing, AUCUN header/footer, AUCUN contenu. Le composant retourne juste une div vide pleine page. L'utilisateur ajoutera le contenu lui-même ensuite.",
        isCore: true,
        showInNav: false,
      } as any,
    ],
  };
}

// Deterministic fallback plan when the AI planning step fails.
function fallbackPlan(): AppPlan {
  return {
    appType: "productivity",
    entities: [
      { collection: "items", fields: "title:string, notes:string, status:string, createdAt:number", description: "élément principal géré par l'app" },
    ],
    pages: [
      { name: "Dashboard", file: "Dashboard.tsx", route: "/", purpose: "Espace de travail principal", sections: "Liste des éléments via data.list('items'); formulaire d'ajout (data.create); édition inline et changement de statut (data.update); suppression (data.remove); filtres et compteurs. Vrais useState, loading, état vide.", isCore: true, hasForm: true },
      { name: "Detail", file: "Detail.tsx", route: "/item/:id", purpose: "Détail d'un élément", sections: "Charge l'élément via data.get, permet l'édition complète et la sauvegarde (data.update).", hasForm: true },
      { name: "Settings", file: "Settings.tsx", route: "/settings", purpose: "Paramètres", sections: "Préférences utilisateur persistées via data (collection 'settings'), thème, profil.", hasForm: true },
    ],
  };
}

/**
 * Plan-only pass: runs web research + AI planning and returns the proposed app
 * plan (page list + entities) WITHOUT generating any code. Used by the
 * page-selection questionnaire so the user can pick which pages to keep/add
 * before the (expensive) full build starts.
 */
export async function planApp(
  input: EngineInput,
  onProgress?: (msg: string) => void,
  /** [2026-09-04] `skipResearch` : le questionnaire de pages n'a besoin que des
   *  NOMS et des rôles de pages. La recherche web coûtait ~14 s sur le chemin
   *  critique (mesuré : plan-pages 17,9 s au total) alors que le build refait
   *  sa propre recherche approfondie juste après. On la saute donc pour le
   *  questionnaire uniquement — le build, lui, la garde. */
  opts?: { skipResearch?: boolean },
): Promise<AppPlan> {
  const lang = (input.preferredLang && input.preferredLang.trim()) ? input.preferredLang.trim().toLowerCase() : detectLang(`${input.userMessage || ""} ${input.idea || ""}`);
  const ctx: BuildContext = { ...input, lang };

  // "Une page blanche" = UNE page : pas de plan multi-pages, pas d'IA.
  if (isSinglePageRequest(userIntentText(input))) {
    onProgress?.("📄 Demande d'une page unique — plan d'une seule page, sans proposition multi-pages.");
    return singleBlankPagePlan();
  }

  // Web research (reference/competitor scraping) to inform the plan.
  if (!opts?.skipResearch) {
    try {
      onProgress?.("🔎 Recherche web (analyse de la référence)…");
      const bundle = await gatherWebResearch(
        userIntentText(input).trim(),
        input.industry,
        (msg) => onProgress?.(msg),
      );
      if (bundle.hasRealData) ctx.webResearch = formatResearchForPrompt(bundle);
    } catch (e: any) {
      onProgress?.(`⚠️ Recherche web ignorée: ${e?.message || e}`);
    }
  }

  onProgress?.("🧠 Planification des pages…");
  let plan: AppPlan;
  const __tAi = Date.now();
  // Questionnaire (skipResearch) → prompt léger + sortie courte : l'écran
  // n'affiche que le nom et le rôle des pages, le build refait le plan complet.
  const __light = !!opts?.skipResearch;
  try {
    plan = extractJSON(await aiText(
      "Tu réponds uniquement en JSON valide.",
      __light ? PLAN_PROMPT_LIGHT(ctx) : PLAN_PROMPT(ctx),
      __light ? 1200 : 4000,
      // Mesuré : gemini-3-flash met ~10,7 s même sur une sortie courte ; le
      // mini d'OpenAI répond en ~3 s. Le questionnaire est sur le chemin
      // critique (l'utilisateur attend devant un écran vide) → modèle rapide.
      __light ? "openai/gpt-5.4-mini" : CHEAP_JSON_MODEL,
    ));
  } catch {
    plan = fallbackPlan();
  }
  console.log(`[timing][planApp] aiText plan: ${Date.now() - __tAi} ms (light=${__light})`);
  if (!plan.pages?.length) plan = fallbackPlan();
  return plan;
}

/** Kinds of incremental file emission for the live-updating preview.
 *  `page-partial` = instantané compilable d'une page ENCORE en cours d'écriture
 *  (émis ~1×/s pendant le streaming). Il est écrit sur disque comme les autres,
 *  mais il ne compte PAS comme un jalon : les pages étant générées en parallèle,
 *  ces instantanés forment un flux continu et un aperçu qui se rafraîchirait
 *  dessus ne se stabiliserait jamais. */
export type FileReadyKind = "scaffold" | "shared" | "images" | "page" | "page-partial" | "wiring";
/** Called as soon as a bootable file set / individual file is produced, so the
 *  caller can write it to disk and start / hot-update the live preview server
 *  BEFORE the whole build finishes. Best-effort: never blocks/breaks the build. */
export type OnFileReady = (files: ScaffoldFile[], kind: FileReadyKind) => void | Promise<void>;

/** Extrait le LOGO RÉEL d'un site cloné (mode « Continuer une company »).
 *  On NE génère PAS de nouveau logo quand on continue un projet complet : on
 *  réutilise le logo du site source récupéré au scraping. Ordre de préférence :
 *    1) branding.logo renvoyé par Firecrawl (URL ou data URI haute fidélité)
 *    2) un asset dont le rôle (note) contient « logo » (ex. "logo/header")
 *    3) à défaut, le favicon/icône du site (mieux qu'un monogramme inventé)
 *  Retourne "" si rien d'exploitable — le build retombe alors sur le wordmark. */
function pickCloneLogo(clone: import('../site-scraper').SiteCloneResult | undefined): string {
  if (!clone) return "";
  const isUsable = (u?: string) =>
    !!u && (u.startsWith("data:image") || /^https?:\/\//i.test(u));
  // 1) Logo de marque Firecrawl.
  const branded = clone.branding?.logo?.trim();
  if (isUsable(branded)) return branded!;
  // 2) Asset explicitement marqué comme logo (alt/rôle « logo »).
  const assets = clone.allAssets || [];
  const logoAsset = assets.find(
    (a) => /logo/i.test(a.note || "") && isUsable(a.url),
  );
  if (logoAsset) return logoAsset.url;
  // 3) Favicon / icône du site en dernier recours.
  const icon = assets.find(
    (a) => (a.type === "icon" || /favicon|icon/i.test(a.note || "")) && isUsable(a.url),
  );
  if (icon) return icon.url;
  return "";
}

/** Construit le design system d'un CLONE directement à partir des tokens
 *  détectés par Firecrawl sur le vrai site (couleurs dominantes, police,
 *  radius). AUCUN appel IA / 21st.dev : on ne veut pas de look générique,
 *  juste refléter le site source. La reconstruction du code (étape ③) rétablit
 *  ensuite l'apparence exacte page par page. */
function buildCloneDesign(
  clone: import('../site-scraper').SiteCloneResult,
  input: EngineInput,
): any {
  const d = clone.design || ({} as any);
  const brand = clone.branding?.colors || {};
  const isHexLike = (c?: string) =>
    !!c && /^(#|rgb|hsl)/i.test(c.trim()) && !/rgba?\([^)]*,\s*0\s*\)/i.test(c);
  const pick = (...cands: (string | undefined)[]) =>
    cands.map((c) => c?.trim()).find((c) => isHexLike(c)) || "";
  const domColors = (d.colors || []).filter(isHexLike);
  const textColors = (d.textColors || []).filter(isHexLike);
  const backgrounds = (d.backgrounds || []).filter(isHexLike);
  const primary = pick(brand.primary, brand.brand, brand.accent, domColors[0]) || "#111827";
  const accent =
    pick(brand.accent, brand.secondary, domColors.find((c: string) => c !== primary)) ||
    domColors[1] ||
    "#6366F1";
  const background = pick(brand.background, backgrounds[0]) || "#FFFFFF";
  const text = pick(brand.text, textColors[0]) || "#111827";
  const font = (d.fonts && d.fonts[0]) || "Plus Jakarta Sans";
  const radius = (d.radii && d.radii[0]) || "0.75rem";
  return {
    companyName: clone.siteName || input.companyName,
    tagline: "",
    colors: {
      primary,
      accent,
      background,
      surface: pick(brand.surface, backgrounds[1]) || "#F9FAFB",
      text,
      muted: pick(brand.muted, textColors[1]) || "#6B7280",
      border: pick(brand.border) || "#E5E7EB",
    },
    font,
    radius,
    designNotes: `Design repris fidèlement du site source (${clone.rootUrl}).`,
    fromClone: true,
  };
}

/** Construit le PLAN d'un CLONE directement à partir des pages RÉELLEMENT
 *  scrapées par Firecrawl — PAS via l'IA de planification (qui invente une app
 *  SaaS). Une page scrapée = une page à reconstruire à l'identique. Aucune
 *  entité CRUD inventée, aucune page produit fabriquée. C'est LE correctif du
 *  bug « le clone n'utilise pas ce que Firecrawl donne ». */
function buildClonePlan(
  clone: import('../site-scraper').SiteCloneResult,
): AppPlan {
  const usedFiles = new Set<string>();
  const usedRoutes = new Set<string>();
  const toRoute = (path: string): string => {
    let r = (path || "/").trim();
    if (!r.startsWith("/")) r = "/" + r;
    r = r.replace(/\/+$/, "") || "/";
    return r.toLowerCase();
  };
  const toFile = (route: string, title: string): string => {
    if (route === "/") return "Home.tsx";
    const base = route.replace(/^\//, "").split("/").filter(Boolean).map(
      (seg) => seg.replace(/[^a-zA-Z0-9]+/g, " ").trim().split(/\s+/)
        .map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(""),
    ).join("") || (title || "Page").replace(/[^a-zA-Z0-9]+/g, "");
    let name = base.charAt(0).toUpperCase() + base.slice(1) || "Page";
    let file = `${name}.tsx`;
    let i = 2;
    while (usedFiles.has(file)) { file = `${name}${i}.tsx`; i++; }
    return file;
  };
  const navHrefs = new Set((clone.navigation || []).map((n) => toRoute((n.href || "").replace(clone.rootUrl || "", "") || "/")));
  const pages: AppPlan["pages"] = [];
  let order = 1;
  for (const p of clone.pages || []) {
    const route = toRoute(p.path || "/");
    if (usedRoutes.has(route)) continue;
    usedRoutes.add(route);
    const file = toFile(route, p.title || "");
    usedFiles.add(file);
    const name = route === "/"
      ? "Home"
      : (p.title?.split(/[|\-–—·]/)[0].trim().slice(0, 40) || file.replace(/\.tsx$/, ""));
    pages.push({
      name,
      file,
      route,
      purpose: `Reproduction FIDÈLE de la page « ${p.path || "/"} » du site source ${clone.rootUrl}. Recrée exactement son contenu, ses sections et sa mise en page — n'invente rien.`,
      sections: (p.headings && p.headings.length)
        ? `Sections réelles de la page (à recréer dans l'ordre): ${p.headings.slice(0, 30).join(" · ")}`
        : "Recrée toutes les sections de la page source dans l'ordre exact (voir le brief de clonage injecté).",
      isCore: route === "/",
      hasPayment: false,
      hasForm: false,
      navOrder: route === "/" ? 1 : ++order,
      showInNav: route === "/" ? true : navHrefs.has(route),
    });
  }
  if (!pages.length) {
    pages.push({
      name: "Home", file: "Home.tsx", route: "/",
      purpose: `Reproduction fidèle de la page d'accueil de ${clone.rootUrl}.`,
      sections: "Recrée la landing page source à l'identique (voir brief de clonage).",
      isCore: true, hasPayment: false, hasForm: false, navOrder: 1, showInNav: true,
    });
  }

  // ── ÉTAPE 2 — écrans INTÉRIEURS FONCTIONNELS ───────────────────────────────
  // Le public (landing, pricing…) est cloné à l'identique ci-dessus. L'intérieur
  // (derrière le login) a été reconstruit par recherche d'images web
  // (clone.appResearch). On transforme chaque écran trouvé en VRAIE page
  // fonctionnelle, câblée au backend (data.* + IA embarquée) — pas un clone figé.
  addAppScreens(clone, pages, { toRoute, toFile, usedRoutes, usedFiles, order });

  return { appType: "clone", includeAssistant: pages.some((p) => p.isAppScreen), entities: [], pages };
}

/** Décide route + spec fonctionnelle d'un écran interne d'après son nom, puis
 *  l'ajoute au plan comme page fonctionnelle (isAppScreen) avec sa capture de
 *  référence. Best-effort : ne throw jamais, ignore les écrans sans image. */
function addAppScreens(
  clone: import('../site-scraper').SiteCloneResult,
  pages: AppPlan["pages"],
  ctx: {
    toRoute: (p: string) => string;
    toFile: (route: string, title: string) => string;
    usedRoutes: Set<string>;
    usedFiles: Set<string>;
    order: number;
  },
): void {
  const research = clone.appResearch;
  if (!research || !Array.isArray(research.screens) || !research.screens.length) return;

  // nom d'écran → (route préférée, spec fonctionnelle réelle à implémenter).
  const specFor = (name: string): { route: string; spec: string } => {
    const n = name.toLowerCase();
    if (/dashboard|tableau|workspace|espace/.test(n))
      return { route: "/dashboard", spec: "Tableau de bord de l'utilisateur connecté. Charge et liste les projets/éléments de l'utilisateur via data.list('projects') au montage. Affiche des cartes cliquables (nom, date, statut) menant à l'éditeur. Bouton « Nouveau » qui crée un projet (data.create) puis navigue vers l'éditeur. Compteurs/statistiques réels calculés depuis les données. Gère état vide (aucun projet) et loading." };
    if (/éditeur|editor|générateur|generator|builder|studio|canvas/.test(n))
      return { route: "/editor", spec: "Éditeur / générateur — le CŒUR du produit. Zone de prompt où l'utilisateur décrit ce qu'il veut ; à l'envoi, appelle aiStream(messages, onDelta) pour générer la sortie EN LIVE (token par token) et l'affiche dans un panneau de prévisualisation/résultat. Persiste chaque génération via data.create('generations', {...}) et l'historique via data.list. Sidebar listant les projets/fichiers. Boutons d'action réels (régénérer, sauvegarder). Gère loading pendant la génération IA." };
    if (/chat|prompt|assistant|conversation/.test(n))
      return { route: "/chat", spec: "Interface de chat IA. Liste de conversations (data.list('conversations')) dans une sidebar ; zone de messages ; champ de saisie. À l'envoi, ajoute le message user, appelle aiStream pour la réponse de l'assistant en streaming, et persiste la conversation (data.create/update). Auto-scroll, bulles user/assistant distinctes, indicateur de frappe pendant la génération." };
    if (/template|gallery|galerie|modèle|explore/.test(n))
      return { route: "/templates", spec: "Galerie de templates. Charge les templates via data.list('templates') (seed quelques-uns via data.create au 1er montage s'il n'y en a aucun). Grille de cartes avec aperçu, titre, catégorie ; filtres/recherche fonctionnels (useState) ; bouton « Utiliser ce template » qui crée un projet (data.create('projects')) et navigue vers l'éditeur." };
    if (/setting|paramètre|réglage|billing|facturation|compte|account|profil/.test(n))
      return { route: "/workspace-settings", spec: "Paramètres de l'espace de travail. Formulaires réels (nom du workspace, préférences) persistés via data.* (charge au montage, sauvegarde sur submit avec confirmation). Section facturation/abonnement affichant le plan et un bouton d'upgrade réel via checkout(). Gestion des membres (liste + invitation) via data.list/create. Boutons désactivés pendant sauvegarde." };
    return { route: "", spec: `Écran interne « ${name} » de l'app, reconstruit fonctionnel : charge ses données via data.list, permet les actions réelles (créer/éditer/supprimer via data.*), et utilise l'IA embarquée (aiChat/aiStream) si l'écran l'implique. Gère loading/vide/erreur.` };
  };

  let ord = ctx.order + 10; // les écrans d'app viennent après les pages publiques
  for (const screen of research.screens) {
    if (!screen || !Array.isArray(screen.images) || !screen.images.length) continue; // pas de référence visuelle → on n'invente pas
    const { route: pref, spec } = specFor(screen.name);
    let route = ctx.toRoute(pref || screen.name.replace(/[^a-zA-Z0-9]+/g, "-"));
    // Dédup : si la route existe déjà (collision avec une page publique), suffixe.
    if (ctx.usedRoutes.has(route)) {
      let i = 2;
      while (ctx.usedRoutes.has(`${route}-${i}`)) i++;
      route = `${route}-${i}`;
    }
    ctx.usedRoutes.add(route);
    const file = ctx.toFile(route, screen.name);
    ctx.usedFiles.add(file);
    const refImage = screen.images.find((im) => im && im.url)?.url;
    const briefLines = screen.images
      .slice(0, 4)
      .map((im, i) => `- Réf ${i + 1}: ${im.url}${im.caption ? ` — ${im.caption}` : ""}${im.source ? ` (source: ${im.source})` : ""}`)
      .join("\n");
    pages.push({
      name: screen.name.replace(/[|\-–—·].*$/, "").trim().slice(0, 40) || file.replace(/\.tsx$/, ""),
      file,
      route,
      purpose: `Écran intérieur fonctionnel « ${screen.name} » de l'app clonée ${clone.rootUrl}, reconstruit d'après des captures réelles trouvées sur le web et câblé au backend (persistance + IA embarquée).`,
      sections: `Références visuelles réelles de l'écran :\n${briefLines}`,
      isCore: false,
      hasPayment: /billing|facturation|setting|paramètre/.test(screen.name.toLowerCase()),
      hasForm: true,
      navOrder: ++ord,
      showInNav: false,
      isAppScreen: true,
      screenRefImage: refImage,
      functionalSpec: spec,
    });
  }
}

export async function generateApp(
  input: EngineInput,
  onProgress?: (msg: string) => void,
  resume?: BuildResume,
  onCheckpoint?: OnCheckpoint,
  isCancelled?: () => boolean,
  onFileReady?: OnFileReady,
): Promise<GeneratedApp> {
  // Checked between every major step AND inside the per-page loop, so a user
  // cancellation actually stops in-flight work (not just the UI) instead of
  // only being noticed after the whole (multi-minute) build finishes.
  const throwIfCancelled = () => {
    if (isCancelled?.()) throw new JobCancelledDuringGeneration();
  };
  const lang = (input.preferredLang && input.preferredLang.trim()) ? input.preferredLang.trim().toLowerCase() : detectLang(`${input.userMessage || ""} ${input.idea || ""}`);
  const ctx: BuildContext = { ...input, lang, hasLogo: !!input.logoUrl };
  // Live-preview file emission — best-effort, never blocks/breaks the build.
  const emitFiles = (files: ScaffoldFile[], kind: FileReadyKind) => {
    if (!onFileReady || !files.length) return;
    try { void onFileReady(files, kind); } catch { /* preview best-effort */ }
  };
  // Fire-and-forget checkpoint helper — never blocks or throws the build.
  // Also mirrors each produced page to disk (via emitFiles) so the live preview
  // fills in page-by-page as drafts/finals land, without changing final output.
  const checkpoint = (patch: BuildCheckpointPatch) => {
    try { void onCheckpoint?.(patch); } catch { /* checkpoint best-effort */ }
    if (patch.page && patch.page.code && patch.page.code.length > 100) {
      emitFiles([{ path: `src/pages/${patch.page.file}`, content: patch.page.code }], "page");
    }
  };
  const resumed = !!resume && (!!resume.plan || !!resume.pages);
  if (resumed) onProgress?.("↩️ Reprise de la construction au dernier point de contrôle (aucune étape refaite)…");

  // ── MODE CLONAGE ──────────────────────────────────────────────────────────
  // Un lien a été fourni : le site a déjà été scrapé (JSON + images). On bascule
  // dans un flux DÉDIÉ à la recréation fidèle — étapes explicites + brief du vrai
  // site injecté comme référence absolue. On NE lance PAS la recherche marché
  // générique (on a déjà le vrai site) et on NE génère PAS de nouvelle marque.
  const cloneRef = input.cloneReference && input.cloneReference.ok ? input.cloneReference : undefined;
  let cloneBrief = "";
  if (cloneRef && !resumed) {
    try {
      const { formatCloneBrief } = await import("../site-scraper");
      // ── ÉTAPE 1 — Firecrawl a renvoyé le JSON du site ──
      onProgress?.(`① Firecrawl — JSON du site récupéré (${cloneRef.pages?.length || 0} page(s), ${cloneRef.allAssets?.length || 0} éléments${cloneRef.source ? `, source : ${cloneRef.source}` : ""})`);
      cloneBrief = formatCloneBrief(cloneRef);
      // Le brief du VRAI site devient la référence de recherche/design/code.
      // Les ÉTAPES 2 (images réelles du site) et 3 (reconstruction du code à
      // l'identique) sont exécutées plus bas, dans l'ordre, par imagesTask puis
      // par la génération des pages — pas de fausse annonce « 100 % » ici.
      ctx.webResearch = cloneBrief;
    } catch (e: any) {
      onProgress?.(`⚠️ Lecture du site échouée (${e?.message || e}) — reconstruction depuis le contexte disponible`);
    }
  }

  // ── Mémoire d'apprentissage globale ──
  // Relit les leçons accumulées sur TOUTE la plateforme (score QA avant/après
  // de générations précédentes, tous utilisateurs confondus) et les injecte
  // dans le prompt système de génération de code — l'IA évite ainsi de refaire
  // les erreurs fonctionnelles déjà identifiées et corrigées par le passé.
  const learnedBlock = await getLearnedPromptBlock();
  // currentDateContext() is computed fresh (not baked into the static CODE_SYSTEM
  // const) so the model always knows the real current year — left unguided it
  // writes stale training-data years like "Collection 2024"/"© 2025".
  const CODE_SYSTEM_LEARNED = `${CODE_SYSTEM}${currentDateContext()}${learnedBlock || ""}`;

  // ── 0. PHASE JURIDIQUE (BLOQUANTE, EN PREMIER) ──
  // Une IA juridique DÉDIÉE tourne AVANT toute planification de pages. Elle
  // adapte le pack juridique (confidentialité, CGU, mentions légales, cookies) +
  // la bannière de consentement au PAYS / à la juridiction du projet. Marche pour
  // TOUS les pays (l'IA déduit le cadre applicable). NE LANCE JAMAIS d'exception :
  // en cas d'échec du modèle, un pack générique RGPD/GDPR est appliqué. La
  // planification des pages ne démarre qu'après cette étape.
  let legal: LegalPack;
  if (resume?.legal) {
    legal = resume.legal;
    onProgress?.("↩️ Vérification juridique reprise du point de contrôle");
  } else if (cloneRef) {
    // ── MODE CLONE / « Continuer un projet » : PAS de phase juridique ──
    // Un clone ne fait QUE les 3 tâches (① Firecrawl→JSON, ② images Velbaz,
    // ③ reconstruction fidèle du code). On NE lance PAS l'IA juridique et on
    // n'affiche AUCUN message « Phase juridique ». On fournit silencieusement
    // un pack par défaut (sans appel IA) uniquement pour satisfaire le scaffold ;
    // les vraies pages légales du site source sont reconstruites par le clone.
    legal = defaultLegalPack({
      companyName: input.companyName,
      idea: input.idea || "",
      industry: input.industry,
      country: input.country,
      lang,
    });
    checkpoint({ legal });
  } else {
    legal = await planLegalPack(
      {
        companyName: input.companyName,
        idea: input.idea || "",
        industry: input.industry,
        country: input.country,
        lang,
      },
      (msg) => onProgress?.(msg),
    );
    checkpoint({ legal });
  }
  throwIfCancelled();

  // ── 1. Plan the app (skip web research + planning if already checkpointed) ──
  let plan: AppPlan;
  if (resume?.plan?.pages?.length) {
    plan = resume.plan;
    // Keep research context available for any page still to build.
    if ((resume as any).webResearch) ctx.webResearch = (resume as any).webResearch;
  } else if (isSinglePageRequest(userIntentText(input))) {
    // "Une page blanche" = UNE page. Pas de recherche web, pas de planification
    // IA, pas de multi-pages : exactement une page vide.
    onProgress?.("📄 Demande d'une page unique — construction d'UNE seule page (vide), sans plan multi-pages.");
    plan = singleBlankPagePlan();
    plan.pages = orderPages(plan.pages);
    checkpoint({ phase: "plan", plan });
  } else if (cloneRef && !input.selectedPages?.length) {
    // ── MODE CLONE : le plan = les pages RÉELLEMENT scrapées (Firecrawl) ──
    // On NE lance PAS l'IA de planification (qui invente une app SaaS multi-
    // pages). Une page scrapée = une page à reconstruire à l'identique. Pour un
    // site à une seule page (ex. base44), le plan a exactement 1 page (route "/").
    plan = buildClonePlan(cloneRef);
    plan.pages = orderPages(plan.pages);
    onProgress?.(`🗺️ Pages réelles du site source: ${plan.pages.length} → ${plan.pages.map((p) => p.route).join(", ")} (aucune page inventée)`);
    checkpoint({ phase: "plan", plan, ...(ctx.webResearch ? ({ webResearch: ctx.webResearch } as any) : {}) });
  } else {
    // ── 0. VRAIE recherche web (scraping référence + concurrents) ──
    // "comme lovable.com" → on scrape réellement lovable + on cherche ses concurrents,
    // puis on injecte ces données dans le plan et le design pour un clone fidèle.
    // MODE CLONAGE : on a déjà le VRAI site (brief injecté dans ctx.webResearch),
    // on saute donc la recherche marché générique.
    if (cloneRef && cloneBrief) {
      onProgress?.("✅ Site source analysé — reconstruction fidèle (pas de recherche marché générique)");
    } else try {
      onProgress?.("🔎 Recherche web (analyse de la référence)…");
      const bundle = await gatherWebResearch(
        userIntentText(input).trim(),
        input.industry,
        (msg) => onProgress?.(msg),
      );
      if (bundle.hasRealData) {
        ctx.webResearch = formatResearchForPrompt(bundle);
        const refCount = bundle.referenceSummaries.length;
        onProgress?.(
          refCount
            ? `✅ ${refCount} référence(s) analysée(s) en direct`
            : `✅ Recherche marché terminée`,
        );
      } else {
        onProgress?.("ℹ️ Pas de référence externe détectée — génération depuis les connaissances");
      }
    } catch (e: any) {
      onProgress?.(`⚠️ Recherche web ignorée: ${e?.message || e}`);
    }

    if (input.selectedPages?.length) {
      // User already picked pages via the questionnaire — skip AI planning and
      // build exactly what they chose. We still infer appType/entities via a
      // quick plan pass so the backend (data layer) stays coherent, but the page
      // list is authoritative from the user's selection.
      onProgress?.(`📋 Pages sélectionnées par l'utilisateur: ${input.selectedPages.length}`);
      void explainIntent(
        { key: "plan", label: "Planification de l'app", context: `Idée: "${input.idea}". L'utilisateur a déjà choisi ${input.selectedPages.length} pages via le questionnaire.`, complexity: "medium" },
        onProgress,
      );
      let base: AppPlan;
      try {
        base = extractJSON(await aiText("Tu réponds uniquement en JSON valide.", PLAN_PROMPT(ctx), 4000, CHEAP_JSON_MODEL));
      } catch {
        base = fallbackPlan();
      }
      // [2026-09-04] Le questionnaire utilise un plan LÉGER (sans "sections",
      // pour s'afficher en ~4 s au lieu de 17 s). On re-remplit donc ici la
      // description détaillée de chaque page depuis le plan complet `base`
      // (match par route, puis par fichier, puis par nom) — sinon les pages
      // seraient générées sans spécification et perdraient en qualité.
      const norm = (s?: string) => (s || "").toLowerCase().replace(/[^a-z0-9]/g, "");
      const enriched = input.selectedPages.map((p) => {
        if (p.sections && p.sections.trim()) return p;
        const m = base.pages?.find((b) =>
          (p.route && b.route && norm(b.route) === norm(p.route)) ||
          (p.file && b.file && norm(b.file) === norm(p.file)) ||
          (p.name && b.name && norm(b.name) === norm(p.name)),
        );
        return m?.sections
          ? { ...p, sections: m.sections, ...(p.purpose ? {} : { purpose: m.purpose }) }
          : p;
      });
      plan = {
        appType: base.appType || "productivity",
        entities: base.entities?.length ? base.entities : fallbackPlan().entities,
        pages: enriched,
      };
    } else {
      // MODE CLONE : la « planification » ne fait qu'inventorier les VRAIES
      // pages du site source (issues du JSON Firecrawl) à reconstruire — ce
      // n'est pas une planification d'app from scratch.
      if (cloneRef) {
        onProgress?.("🗺️ Inventaire des pages réelles du site source (à reconstruire)…");
      } else {
        onProgress?.("🧠 Planification de l'app…");
        void explainIntent(
          { key: "plan", label: "Planification de l'app", context: `Idée: "${input.idea}". Industrie: ${input.industry || "non précisée"}.`, complexity: "medium" },
          onProgress,
        );
      }
      try {
        plan = extractJSON(await aiText("Tu réponds uniquement en JSON valide.", PLAN_PROMPT(ctx), 4000, CHEAP_JSON_MODEL));
      } catch {
        plan = fallbackPlan();
      }
    }
    if (!plan.pages?.length) throw new Error("Plan sans pages");
    plan.pages = orderPages(plan.pages);
    onProgress?.(`📋 Plan: ${plan.appType}, ${plan.pages.length} pages · nav: ${plan.pages.filter(p => p.showInNav).map(p => p.name).join(", ")}`);
    void explainOutcome(
      { key: "plan", label: "Planification de l'app", context: `Idée: "${input.idea}".`, complexity: "medium" },
      `Type d'app retenu: ${plan.appType}. ${plan.pages.length} pages planifiées: ${plan.pages.map(p => p.name).join(", ")}.`,
      onProgress,
    );
    // Persist plan (+ research) so a restart continues from here.
    checkpoint({ phase: "plan", plan, ...(ctx.webResearch ? ({ webResearch: ctx.webResearch } as any) : {}) });
  }
  throwIfCancelled();

  // ── 2. Design system (skip if already checkpointed) ──
  let design: any;
  let meta: AppMeta;
  if (resume?.design && resume?.meta) {
    design = resume.design;
    meta = resume.meta;
    // Reprise d'un clone dont le checkpoint n'avait pas encore le logo source :
    // on le complète pour ne jamais retomber sur un wordmark générique.
    if (cloneRef && !meta.logoUrl) {
      const cloneLogo = pickCloneLogo(cloneRef);
      if (cloneLogo) {
        meta.logoUrl = cloneLogo;
        onProgress?.("🔖 Logo du site source extrait et réutilisé (aucun logo généré)");
      }
    }
  } else if (cloneRef) {
    // ── MODE CLONE / « Continuer un projet » : design tiré du SITE SOURCE ──
    // Un clone ne fait QUE les 3 tâches. On N'INVENTE PAS de design (pas
    // d'appel Opus, pas de « recherche d'idées de design » 21st.dev qui
    // introduit un look générique). Les couleurs / police / radius viennent
    // directement des tokens détectés par Firecrawl sur le vrai site ; la
    // reconstruction du code (étape ③) reproduit ensuite l'apparence à
    // l'identique. Aucun message « Système de design » n'est affiché.
    design = buildCloneDesign(cloneRef, input);
    meta = {
      companyName: cloneRef.siteName || input.companyName,
      slug: (input.companyName || "app").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "app",
      primaryColor: design.colors?.primary || "#111827",
      accentColor: design.colors?.accent || "#6366F1",
      font: design.font || "Plus Jakarta Sans",
      idea: input.idea || "",
      tagline: design.tagline || "",
      lang,
      logoUrl: input.logoUrl || pickCloneLogo(cloneRef) || "",
    };
    if (meta.logoUrl) {
      onProgress?.("🔖 Logo du site source extrait et réutilisé (aucun logo généré)");
    }
    checkpoint({ phase: "design", design, meta });
  } else {
    onProgress?.("🎨 Système de design…");
    void explainIntent(
      { key: "design", label: "Système de design", context: `Entreprise: "${input.companyName}". Industrie: ${input.industry || "non précisée"}. Idée: "${input.idea}".`, complexity: "medium" },
      onProgress,
    );
    // STEP 1 — the AI produces the brand-specific fields (companyName, tagline)
    // and a first-pass spec. This never dictates the final visual identity.
    // Cache: même contexte business → même design system. Évite de repayer
    // l'appel Opus (le plus cher du pipeline) sur les rebuilds/retries.
    const designPromptText = `${DESIGN_SYSTEM_PROMPT(ctx)}${currentDateContext()}`;
    const designCacheKey = createHash("sha1").update(designPromptText).digest("hex");
    const DESIGN_CACHE_TTL_MS = 14 * 24 * 60 * 60 * 1000; // 14 jours
    try {
      const cached = await db.select().from(designSystemCache)
        .where(eq(designSystemCache.key, designCacheKey)).limit(1).then((r) => r[0]);
      if (cached && Date.now() - (cached.createdAt?.getTime() ?? 0) < DESIGN_CACHE_TTL_MS) {
        design = JSON.parse(cached.json);
        onProgress?.("♻️ Design system repris du cache (même contexte)");
      }
    } catch { /* cache miss → génération normale */ }
    try {
      if (!design) {
        design = extractJSON(await aiText("Tu réponds uniquement en JSON valide.", designPromptText, 3000, "anthropic/claude-sonnet-4.6"));
        try {
          await db.insert(designSystemCache)
            .values({ key: designCacheKey, json: JSON.stringify(design), createdAt: new Date() })
            .onConflictDoUpdate({ target: designSystemCache.key, set: { json: JSON.stringify(design), createdAt: new Date() } });
        } catch { /* l'échec du cache ne casse jamais le build */ }
      }
    } catch {
      design = {
        companyName: input.companyName, tagline: input.idea?.slice(0, 60) || "",
        colors: { primary: "#111827", accent: "#6366F1", background: "#FFFFFF", surface: "#F9FAFB", text: "#111827", muted: "#6B7280", border: "#E5E7EB" },
        font: "Plus Jakarta Sans", radius: "0.75rem", designNotes: "Clean modern SaaS.",
      };
    }
    // STEP 2 — 21st.dev is THE source of the visual identity. Look at real,
    // on-topic 21st.dev template previews and EXTRACT the actual palette,
    // typography, radius and treatments from them. When found, these OVERRIDE
    // the AI-invented tokens so colors/typography genuinely originate from
    // 21st.dev (kills the generic "AI look"). Brand text fields are preserved.
    if (twentyFirst.isEnabled()) {
      onProgress?.("🎨 Recherche d'idées de design…");
      try {
        const tokens = await twentyFirst.fetchDesignTokens({
          companyName: input.companyName || design.companyName,
          industry: input.industry,
          vibe: design.vibe || design.designNotes || "",
          designNotes: design.designNotes || "",
        });
        if (tokens) {
          design = {
            ...design,
            colors: tokens.colors,
            font: tokens.font,
            radius: tokens.radius,
            vibe: tokens.vibe || design.vibe,
            designNotes: tokens.designNotes || design.designNotes,
            twentyFirstSources: tokens.sources,
          };
          onProgress?.(`✅ Design: ${tokens.font}, ${tokens.colors.primary}/${tokens.colors.accent}`);
        } else {
          onProgress?.("ℹ️ Idées de design indisponibles — design de secours conservé");
        }
      } catch (e: any) {
        onProgress?.(`⚠️ Recherche de design ignorée: ${e?.message || e}`);
      }
    }
    // Le nom du projet (input.companyName) fait FOI : il provient soit d'un nom
    // explicitement donné par l'utilisateur, soit de la meta déjà calculée. On
    // n'utilise le nom INVENTÉ par l'IA (design.companyName) QUE si aucun vrai
    // nom n'existe encore (placeholder « Nouveau projet » ou vide). L'IA ne doit
    // jamais écraser un nom déjà choisi par l'utilisateur.
    const providedName = (input.companyName || "").trim();
    const hasRealName = !isPlaceholderBrandName(providedName);
    const finalCompanyName = hasRealName ? providedName : (design.companyName || providedName || "App");
    meta = {
      companyName: finalCompanyName,
      slug: (finalCompanyName || "app").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "app",
      primaryColor: design.colors?.primary || "#111827",
      accentColor: design.colors?.accent || "#6366F1",
      font: design.font || "Plus Jakarta Sans",
      idea: input.idea || "",
      tagline: design.tagline || "",
      lang,
      // Mode CLONE : on N'INVENTE PAS de logo. On réutilise le vrai logo du site
      // source (branding Firecrawl / asset « logo » / favicon). En dehors du
      // clonage on garde le logo fourni en entrée (marque validée par l'user).
      logoUrl: input.logoUrl || (cloneRef ? pickCloneLogo(cloneRef) : "") || "",
    };
    if (cloneRef && meta.logoUrl) {
      onProgress?.("🔖 Logo du site source extrait et réutilisé (aucun logo généré)");
    }
    onProgress?.(`✅ Design: ${meta.font}, ${meta.primaryColor}`);
    void explainOutcome(
      { key: "design", label: "Système de design", context: `Entreprise: "${input.companyName}".`, complexity: "medium" },
      `Police retenue: ${meta.font}. Couleurs: primaire ${meta.primaryColor}, accent ${meta.accentColor}.${design?.twentyFirstSources ? " Identité inspirée d'idées de design trouvées." : ""}`,
      onProgress,
    );
    checkpoint({ phase: "design", design, meta });
  }
  // MODE CLONE : marque le meta pour que le scaffold NE génère PAS les pages
  // inventées (auth/légal/support) ni la bannière cookies — fidélité stricte au
  // site source. Le build ne reproduit QUE les vraies pages scrapées.
  if (cloneRef) meta.cloneMode = true;
  // Le header/footer doivent afficher le logo dès qu'on en a un — y compris le
  // logo EXTRAIT d'un site cloné (pas seulement un logo fourni en entrée).
  ctx.hasLogo = !!meta.logoUrl;
  // Attach the country-adapted legal pack so the scaffold renders the legal
  // pages + cookie banner from it (buildScaffold → resolveLegal(meta)).
  meta.legal = legal;
  throwIfCancelled();

  // Visual context shared by ALL 21st.dev vision steps (component judging +
  // template inspiration). Carries the brand palette + vibe so the vision model
  // judges fit with THIS project, not in the abstract.
  const brandColors = design?.colors
    ? Object.values(design.colors).filter((c): c is string => typeof c === "string")
    : [meta.primaryColor, meta.accentColor];
  const baseVctx = {
    companyName: meta.companyName,
    industry: input.industry,
    vibe: design?.vibe || design?.designNotes || "",
    designNotes: design?.designNotes || "",
    colors: brandColors,
  };

  // ── 2.5 Template inspiration (vision) — TARGETED PER PAGE ──
  // For EACH page, Velbaz looks at real, polished 21st.dev templates that match
  // THAT page's archetype (a chat page → chat UIs, a dashboard → dashboards, a
  // landing → hero/features…) and distils a concrete layout/style brief for it.
  // Each page then gets its own brief injected — no more one generic brief.
  const pageTemplateBriefs = new Map<string, string>();
  // ── Resume bookkeeping (must be defined before first use of isFinal) ──
  // Pages already fully processed (generate + QA + densify) are NEVER touched
  // again — no regeneration, no re-emitted progress → no duplicated work.
  const resumePages = resume?.pages || {};
  const finalPages = new Set(
    Object.entries(resumePages).filter(([, v]) => v.stage === "final").map(([f]) => f),
  );
  const isFinal = (file: string) => finalPages.has(file);

  // Only pages still to build need fresh inspiration — pages already finalised
  // on a previous run are kept as-is (no re-fetch, no re-emitted progress).
  const pagesToBuild = plan.pages.filter((p) => !isFinal(p.file));

  // ── 3. Scaffold ──
  // Assistant IA flottant : PAS par défaut. Seulement si l'utilisateur l'a
  // demandé explicitement ou si le plan IA a décidé qu'il était pertinent.
  meta.withAssistant = meta.withAssistant
    ?? (plan.includeAssistant === true || wantsAssistant(userIntentText(input)));
  // ── Système de compte / connexion (auth) : OPTIONNEL ──────────────────────
  // Priorité: (1) demande EXPLICITE de l'utilisateur (sans compte / avec compte)
  // gagne toujours ; (2) sinon la décision du plan IA (includeAuth) ; (3) sinon
  // auth activée par défaut. Un clone (cloneMode) n'a de toute façon pas d'auth.
  {
    const userText = userIntentText(input);
    let withAuth: boolean;
    if (wantsNoAuth(userText)) withAuth = false;
    else if (wantsExplicitAuth(userText)) withAuth = true;
    else if (plan.includeAuth === false) withAuth = false;
    else withAuth = true;
    if (meta.cloneMode) withAuth = false; // un clone ne génère jamais d'auth inventée
    meta.withAuth = withAuth;
    ctx.noAuth = !withAuth;
    if (!withAuth) onProgress?.("🔓 Projet sans système de compte (aucune connexion/inscription)");
  }
  const fileMap = new Map<string, string>();
  for (const f of buildScaffold(meta)) fileMap.set(f.path, f.content);
  // Écrit le pack juridique adapté au pays dans l'app (écrase le fichier du
  // scaffold pour garantir la version produite par l'IA juridique).
  fileMap.set("src/lib/legal-content.ts", LEGAL_CONTENT_TS(legal));
  // Restore any page code already produced before the interruption.
  for (const [file, v] of Object.entries(resumePages)) {
    if (v.code && v.code.length > 200) fileMap.set(`src/pages/${file}`, v.code);
  }

  // Nav du HAUT: seulement les destinations principales (showInNav). Les pages
  // secondaires (détail :id, billing, flux…) restent atteignables via des
  // boutons/liens dans le contenu — on ne surcharge pas le Header.
  const navRoutes = plan.pages
    .filter(p => p.showInNav !== false)
    .map(p => ({ name: p.name, route: p.route }));
  // Le Footer, lui, peut lister toutes les pages (plan complet) + standard.
  const allRoutes = plan.pages.map(p => ({ name: p.name, route: p.route }));
  // Écrans intérieurs FONCTIONNELS du clone (Étape 2). Les CTA d'entrée dans
  // l'app ("Get started", "Login", "Try it"…) des pages publiques doivent
  // pointer vers CES routes internes réelles, pas vers le vrai site distant.
  const appScreenRoutes = plan.pages
    .filter(p => p.isAppScreen)
    .map(p => ({ name: p.name, route: p.route }));
  const primaryAppRoute =
    appScreenRoutes.find(r => r.route === "/dashboard")?.route ||
    appScreenRoutes.find(r => r.route === "/editor")?.route ||
    appScreenRoutes[0]?.route ||
    "";
  const isEn = lang === "en";
  const footerRoutes = [
    ...allRoutes,
    { name: isEn ? "Support" : "Aide & Support", route: "/support" },
    { name: isEn ? "Terms" : "Conditions", route: "/terms" },
    { name: isEn ? "Privacy" : "Confidentialité", route: "/privacy" },
    { name: isEn ? "Legal Notice" : "Mentions légales", route: "/legal-notice" },
    { name: isEn ? "Cookies" : "Cookies", route: "/cookies" },
  ];

  // ── Live preview: boot set ────────────────────────────────────────────────
  // As soon as the scaffold + deterministic router (App.tsx) are known, emit a
  // COMPLETE bootable file set with skeleton stubs for every page still to be
  // generated and placeholder Header/Footer (so Layout's imports resolve). The
  // caller writes these to disk and starts Vite IMMEDIATELY — the user sees the
  // real running app (skeleton) within seconds instead of a blank screen for
  // minutes. Each real page/Header/Footer then overwrites its stub via the
  // checkpoint/emitFiles hooks → Vite HMR → the preview visibly fills in page by
  // page. Stubs are NEVER added to the engine's returned `files`, so the final
  // persisted output is byte-identical to a non-live build.
  if (onFileReady) {
    const boot = new Map(fileMap); // scaffold + legal + any restored resume pages
    boot.set("src/App.tsx", buildAppTsx(plan.pages, meta.cloneMode, meta.withAuth));
    if (!boot.has("src/components/Header.tsx")) boot.set("src/components/Header.tsx", STUB_HEADER(meta, navRoutes));
    if (!boot.has("src/components/Footer.tsx")) boot.set("src/components/Footer.tsx", STUB_FOOTER(meta));
    const reservedRoutes = new Set(["/login", "/signup", "/profile", "/settings", "/success", "/cancel", "/terms", "/privacy", "/legal-notice", "/cookies", "/support"]);
    for (const p of plan.pages) {
      if (reservedRoutes.has(p.route)) continue;
      const key = `src/pages/${p.file}`;
      const comp = p.file.replace(/\.tsx?$/, "").replace(/[^a-zA-Z0-9]/g, "");
      const existing = boot.get(key);
      if (!existing || existing.length < 200) boot.set(key, STUB_PAGE(comp, p.name));
    }
    emitFiles(Array.from(boot.entries()).map(([path, content]) => ({ path, content })), "scaffold");
  }

  // ── 2.5 + 4 + 4.5 : trois pistes INDÉPENDANTES exécutées EN PARALLÈLE ──
  // Avant, ces trois étapes s'enchaînaient en série (inspiration → Header/Footer
  // → plan des requêtes → fetch des composants), ce qui additionnait leurs
  // latences. Elles ne dépendent que du design déjà calculé → on les lance
  // toutes en même temps et on n'attend qu'une fois, juste avant les pages.

  // Piste A — inspiration visuelle par page (vision sur templates 21st.dev).
  const inspirationTask = (async () => {
    // Mode clone: PAS d'inspiration 21st.dev — on reproduit le vrai site, pas
    // des composants premium génériques qui trahiraient la fidélité au scrape.
    if (cloneRef) return;
    if (!twentyFirst.isEnabled() || !pagesToBuild.length) return;
    onProgress?.("🖼️ Recherche d'idées visuelles par page…");
    await Promise.all(
      pagesToBuild.map(async (page: any) => {
        try {
          const insp = await twentyFirst.fetchTemplateInspiration(baseVctx, {
            name: page.name, route: page.route, purpose: page.purpose,
            sections: page.sections, isCore: !!page.isCore,
          });
          if (insp?.brief) {
            pageTemplateBriefs.set(page.file, insp.brief);
            onProgress?.(`✅ ${page.name} — idées de design trouvées`);
          } else {
            onProgress?.(`ℹ️ ${page.name} — pas d'idée exploitable trouvée`);
          }
        } catch (e: any) {
          onProgress?.(`⚠️ ${page.name} — recherche d'idées ignorée: ${e?.message || e}`);
        }
      }),
    );
  })();

  // Piste B — composants partagés (Header, Footer), repris du checkpoint si présents.
  const sharedTask = (async () => {
    let headerCode = resume?.header;
    let footerCode = resume?.footer;
    // ── MODE CLONE : pages AUTONOMES ──
    // Chaque page reproduit elle-même le header et le footer réels (depuis sa
    // capture pleine page en vision). On NE génère PAS de Header/Footer partagés
    // par IA : c'était la source du DOUBLE footer et du contenu inventé (footer
    // "Vibe Coding", nav "Accueil", liens /terms /cookies inexistants…). On pose
    // des stubs neutres non importés par le clone (App.tsx ne wrap plus en Layout).
    if (cloneRef) {
      return { headerCode: STUB_HEADER(meta, navRoutes), footerCode: STUB_FOOTER(meta) };
    }
    if (!headerCode || !footerCode) {
      onProgress?.("🧩 Composants partagés (Header, Footer)…");
      // Mode clone: on reproduit la navigation RÉELLE du site source (sans
      // ajouter auth/légal). Sinon, prompts standard.
      const cloneNavBrief = cloneRef?.navigation?.length
        ? cloneRef.navigation.map((n) => `- ${n.label} → ${n.href}`).join("\n")
        : "";
      const headerPrompt = cloneRef
        ? CLONE_HEADER_PROMPT(ctx, design, navRoutes, cloneNavBrief)
        : HEADER_PROMPT(ctx, design, navRoutes);
      const footerPrompt = cloneRef
        ? CLONE_FOOTER_PROMPT(ctx, design, footerRoutes, cloneNavBrief)
        : FOOTER_PROMPT(ctx, design, footerRoutes);
      const [header, footer] = await Promise.all([
        headerCode ? Promise.resolve(headerCode) : aiCode(CODE_SYSTEM_LEARNED, headerPrompt, 8000).then(cleanCode),
        footerCode ? Promise.resolve(footerCode) : aiCode(CODE_SYSTEM_LEARNED, footerPrompt, 8000).then(cleanCode),
      ]);
      headerCode = header;
      footerCode = footer;
      checkpoint({ phase: "pages", header: headerCode, footer: footerCode });
    }
    return { headerCode, footerCode };
  })();

  // Piste C — plan des requêtes 21st.dev + fetch des composants par page.
  const twentyFirstOn = twentyFirst.isEnabled();
  const refsTask = (async () => {
    const map = new Map<string, Array<{ searchQuery: string; snippet: string }>>();
    // Mode clone: aucun composant 21st.dev injecté — fidélité au site scrapé.
    if (cloneRef) return map;
    if (!twentyFirstOn || !pagesToBuild.length) return map;
    onProgress?.("🔎 Création des assets pour ce projet…");
    try {
      // 1. Let the AI plan the best component searches per page.
      const queryPlan = await plan21stQueries(ctx, design, plan);
      // 2. Fetch the planned components in parallel per page (only pages to build).
      await Promise.all(
        pagesToBuild.map(async (page) => {
          const planned = queryPlan.get(page.file) || [];
          if (!planned.length) return;
          const refs = await twentyFirst.fetchComponents(
            planned.map((searchQuery) => ({
              searchQuery,
              message: `Page "${page.name}" du site/app "${ctx.companyName}" (${ctx.industry || "app"}). Objectif: ${page.purpose}.`,
              // Vision context → turns on the "look at the preview, like/don't-like,
              // re-search" loop for this specific query, judged for THIS project.
              vctx: {
                ...baseVctx,
                role: `Sur la page "${page.name}" (${page.purpose}). Sections: ${page.sections}. Requête: "${searchQuery}".`,
              },
            })),
            5,
          );
          if (refs.length) {
            map.set(page.file, refs);
            // Surface the vision verdict so the user SEES that Velbaz looked at
            // each preview and chose (score + reason).
            for (const r of refs) {
              if (typeof r.visualScore === "number") {
                onProgress?.(`👁️ ${page.name} — "${r.searchQuery}" → ${r.visualScore}/100 ${r.reason ? `· ${r.reason}` : ""}`);
              }
            }
          }
        }),
      );
      const total = Array.from(map.values()).reduce((n, r) => n + r.length, 0);
      onProgress?.(total ? `✅ ${total} asset(s) créé(s) sur mesure` : "ℹ️ Aucun asset supplémentaire nécessaire");
    } catch (e: any) {
      onProgress?.(`⚠️ Création des assets ignorée: ${e?.message || e}`);
    }
    return map;
  })();

  // Piste D — direction artistique: l'IA décide des visuels de chaque page
  // (héro, sections, galerie, à-propos…) SANS plafond, puis on les génère en
  // parallèle et on les compresse. Le manifeste (data URIs) est écrit dans
  // src/lib/images.ts et injecté dans le prompt de chaque page.
  // Génération RÉELLE des visuels (octets), lancée EN ARRIÈRE-PLAN par le slots
  // task ci-dessous. Awaited une seule fois après la boucle des pages (elles se
  // sont générées en parallèle) → sortie finale identique, mais l'aperçu se
  // remplit de vraies pages sans attendre les images.
  // Assets déjà produits par un run /genesis et cités dans le brief reçu.
  // S'ils existent, ils font loi : le builder ne génère aucun visuel concurrent.
  const chimeraBriefText = `${input.idea || ""}\n${input.userMessage || ""}`;
  const chimeraAssets = (() => {
    try {
      return chimeraAssetsFromBrief(chimeraBriefText);
    } catch {
      return [];
    }
  })();
  // [2026-09-05] Le brief cite des images /genesis mais AUCUNE n'a pu être
  // reconnue : le site partirait sur des images génériques sans que personne ne
  // le voie. On l'annonce au lieu de le cacher (règle : quand ça casse, ça se
  // voit — pas de repli silencieux).
  if (chimeraAssets.length === 0 && chimeraBriefText.includes("/api/chimera/assets/")) {
    onProgress?.("⚠️ Le brief cite des images /genesis mais aucune URL d'asset n'a été reconnue — le site NE sera PAS construit à partir de ces images.");
  }

  // [2026-09-05] Bug 22 — Relevés des pages rendues par /genesis. Le site se
  // reconstruit d'après l'image de chaque page, pas d'après le prompt qui a
  // servi à la générer. Cherchés dans la spec du run ET dans le message reçu
  // (les deux formes circulent selon le chemin d'appel).
  const frameTranscripts = (() => {
    try {
      const found = parseFrameTranscripts(`${input.genesisSpec || ""}\n${chimeraBriefText}`);
      // Dédoublonnage : la spec peut arriver deux fois par deux chemins.
      const seen = new Set<string>();
      return found.filter(t => {
        const k = `${t.frame}:${t.route}`;
        if (seen.has(k)) return false;
        seen.add(k);
        return true;
      });
    } catch {
      return [];
    }
  })();
  if (frameTranscripts.length) {
    onProgress?.(`② ${frameTranscripts.length} page(s) rendues par /genesis relevées — chaque page est reconstruite d'après SON image`);
  } else if (chimeraAssets.length) {
    // Des images /genesis sont là mais aucun relevé : le site retomberait sur
    // du texte + un fond. Ça se voit, ça ne se tait pas.
    onProgress?.("⚠️ Images /genesis présentes mais AUCUN relevé de page — les pages seront écrites d'après le brief, pas reconstruites d'après les images.");
  }

  let imageGenBg: Promise<void> = Promise.resolve();
  const imagesTask: Promise<ImageManifest> = (async () => {
    if (resume?.images && Object.keys(resume.images.urls || {}).length) {
      onProgress?.("↩️ Visuels repris du checkpoint");
      return resume.images;
    }
    // ── MODE CLONAGE : étape « Velbaz fait les images du site » ──────────────
    // On N'INVENTE PAS d'images génériques (stock IA) — ça casse la fidélité du
    // clone. On RÉUTILISE les VRAIES images du site récupérées par Firecrawl
    // (assets + captures), pour que la reconstruction du code soit à l'identique.
    if (cloneRef) {
      onProgress?.("② Velbaz — images RÉELLES du site (récupérées via Firecrawl, aucune image générique inventée)…");
      const manifest: ImageManifest = { urls: {}, meta: {} };
      const seen = new Set<string>();
      const realImgs = (cloneRef.allAssets || []).filter(
        (a) => (a.type === "image" || a.type === "background") && /^https?:\/\//i.test(a.url),
      );
      let i = 0;
      for (const a of realImgs) {
        if (seen.has(a.url)) continue;
        seen.add(a.url);
        i += 1;
        const key = `site_img_${i}`;
        manifest.urls[key] = a.url;
        manifest.meta[key] = { alt: a.note || `Image du site (${i})`, role: a.type === "background" ? "background" : "gallery", page: "" };
        if (i >= 40) break;
      }
      checkpoint({ images: manifest });
      onProgress?.(`✅ ${i} image(s) réelle(s) du site prêtes — Velbaz code va reconstruire le site à l'identique (étape ③)`);
      return manifest;
    }
    // ── MODE /genesis (chimera) : les cadres du run SONT les images du site ──
    // Le brief contient déjà les URLs HTTP des plaques et découpes produites par
    // /genesis. On amorce le manifeste avec ELLES et on saute la génération de
    // visuels concurrents (planImageSlots/generateImageManifest) — sinon les
    // images du run n'arrivent jamais dans le site. Rien n'est supprimé : le
    // chemin habituel reste actif dès qu'aucun asset chimera n'est présent.
    if (chimeraAssets.length) {
      onProgress?.(`② Images du run /genesis réutilisées telles quelles (${chimeraAssets.length} fichier(s) — aucun visuel générique généré)`);
      const manifest = chimeraImageManifest(
        chimeraAssets,
        pagesToBuild.map((p) => ({ file: p.file, name: p.name })),
      );
      checkpoint({ images: manifest });
      onProgress?.(`✅ ${Object.keys(manifest.urls).length} asset(s) /genesis prêt(s) pour le code des pages`);
      return manifest;
    }
    try {
      const slots = await planImageSlots({
        companyName: meta.companyName,
        idea: input.idea || "",
        industry: input.industry,
        lang,
        design,
        pages: pagesToBuild.map((p) => ({ name: p.name, file: p.file, purpose: p.purpose, sections: p.sections, route: p.route })),
      });
      // ── Découplage images ↔ pages (aperçu en direct vraiment vivant) ───────
      // Les pages n'ont besoin QUE des clés/rôles des visuels (via
      // imagesPromptBlock) pour écrire `IMAGES.clé` — PAS des octets. On renvoie
      // donc un manifeste META-SEUL immédiatement (chaque clé pointe vers un
      // placeholder dégradé on-brand), ce qui débloque la génération des pages
      // RÉELLES tout de suite. Les vraies images sont produites EN ARRIÈRE-PLAN
      // et remplacent les placeholders dans images.ts via HMR → l'utilisateur
      // voit les pages se remplir puis les photos « apparaître » dans l'aperçu,
      // au lieu de fixer un squelette gris pendant toute la phase d'images.
      const c1 = (design as any)?.colors?.primary || "#6366f1";
      const c2 = (design as any)?.colors?.accent || "#8b5cf6";
      const liveManifest: ImageManifest = { urls: {}, meta: {} };
      for (const s of slots) {
        liveManifest.meta[s.key] = { alt: s.alt, role: s.role, page: s.page };
        liveManifest.urls[s.key] = loadingPlaceholder(c1, c2);
      }
      imageGenBg = (async () => {
        try {
          const full = await generateImageManifest(slots, onProgress);
          for (const [k, v] of Object.entries(full.urls)) liveManifest.urls[k] = v;
          for (const [k, m] of Object.entries(full.meta)) liveManifest.meta[k] = m;
          fileMap.set("src/lib/images.ts", IMAGES_TS(liveManifest.urls));
          emitFiles([{ path: "src/lib/images.ts", content: IMAGES_TS(liveManifest.urls) }], "images");
          checkpoint({ images: liveManifest });
        } catch (e: any) {
          onProgress?.(`⚠️ Génération des visuels ignorée: ${e?.message || e}`);
        }
      })();
      return liveManifest;
    } catch (e: any) {
      onProgress?.(`⚠️ Planification des visuels ignorée: ${e?.message || e}`);
      return { urls: {}, meta: {} } as ImageManifest;
    }
  })();

  // Piste E — sound design (OPTIONNEL): l'IA décide si le projet mérite du son
  // (sfx d'interaction, ambiance, voix off, jingle). La plupart du temps: aucun.
  // On force au moins un petit set si l'utilisateur l'a explicitement demandé.
  const soundRequested = /\b(son|sons|sonore|audio|musique|music|bruitage|sound|jingle|voix off|voice[- ]?over|ambiance sonore)\b/i.test(
    userIntentText(input),
  );
  const audioTask: Promise<AudioManifest> = (async () => {
    // Mode clone: PAS de sons. Le site source n'en a pas → on n'invente rien.
    if (cloneRef) return { urls: {}, meta: {} } as AudioManifest;
    // Le son n'est JAMAIS ajouté d'office : sans demande explicite de
    // l'utilisateur, aucun clip n'est planifié ni généré (pas de son au clic).
    if (AUDIO_ONLY_WHEN_REQUESTED && !soundRequested) {
      return { urls: {}, meta: {} } as AudioManifest;
    }
    if (resume?.audio && Object.keys(resume.audio.urls || {}).length) {
      onProgress?.("↩️ Sons repris du checkpoint");
      return resume.audio;
    }
    try {
      const slots = await planAudioSlots({
        companyName: meta.companyName,
        idea: input.idea || "",
        industry: input.industry,
        lang,
        design,
        requested: soundRequested,
        requestNote: soundRequested ? (input.userMessage || input.idea || "") : "",
      });
      if (!slots.length) return { urls: {}, meta: {} } as AudioManifest;
      const manifest = await generateAudioManifest(slots, onProgress);
      checkpoint({ audio: manifest });
      return manifest;
    } catch (e: any) {
      onProgress?.(`⚠️ Génération des sons ignorée: ${e?.message || e}`);
      return { urls: {}, meta: {} } as AudioManifest;
    }
  })();

  // Attente unique: les pistes avancent ensemble.
  const [, shared, pageComponentRefs, imageManifest, audioManifest] = await Promise.all([inspirationTask, sharedTask, refsTask, imagesTask, audioTask]);
  fileMap.set("src/components/Header.tsx", shared.headerCode);
  fileMap.set("src/components/Footer.tsx", shared.footerCode);
  // Écrit le manifeste des visuels dans l'app (écrase le fichier vide du scaffold).
  fileMap.set("src/lib/images.ts", IMAGES_TS(imageManifest.urls));
  // Live preview: swap the placeholder Header/Footer + empty images for the real
  // ones (fires on fresh AND resume builds) → HMR updates the running preview.
  emitFiles([
    { path: "src/components/Header.tsx", content: shared.headerCode },
    { path: "src/components/Footer.tsx", content: shared.footerCode },
    { path: "src/lib/images.ts", content: IMAGES_TS(imageManifest.urls) },
  ], "shared");

  // ── 5. Pages — UNIFIED per-page pipeline (generate → QA → densify) ──
  // Each page runs its whole pipeline in ONE async unit so it reaches its final
  // state atomically, then is checkpointed as "final". A server restart resumes
  // with those final pages already done — they are NOT regenerated and emit NO
  // progress, so no step/page is ever duplicated. Pages still pending resume
  // exactly where they left off. We report progress in PLAN ORDER with concrete
  // PAST-TENSE accomplishments derived from each page's real code.
  const QA_THRESHOLD = 85; // en dessous → on corrige la page
  const totalPages = plan.pages.length;
  const pageIndex = new Map(plan.pages.map((p, i) => [p.file, i + 1]));
  // Pages already finalised on a previous run count as done immediately.
  let pagesDone = plan.pages.filter((p) => isFinal(p.file)).length;
  if (pagesDone > 0) onProgress?.(`↩️ ${pagesDone}/${totalPages} pages déjà terminées (conservées)`);
  if (cloneRef) onProgress?.("③ Velbaz code — reconstruction du site à l'identique d'après le JSON Firecrawl et les images réelles récupérées…");
  onProgress?.(`📄 Construction des ${totalPages - pagesDone} page(s) restante(s) sur ${totalPages}…`);

  // Bloc audio calculé UNE seule fois, de façon DÉFENSIVE. C'est une étape
  // optionnelle de toute fin de build: une erreur ici (helper indisponible,
  // manifeste vide/corrompu…) ne doit JAMAIS faire échouer toute la génération
  // du site. On dégrade en silence (brief vide) plutôt que de tout casser.
  const audioBrief = (() => {
    try { return audioPromptBlock(audioManifest) || ""; }
    catch (e: any) { onProgress?.(`⚠️ Brief audio ignoré (non bloquant): ${e?.message || e}`); return ""; }
  })();

  // Mode clone: brief par page (contenu RÉEL scrapé) indexé par route, pour
  // reproduire chaque page à l'identique au lieu d'inventer du contenu.
  const clonePageBriefs = new Map<string, string>();
  if (cloneRef) {
    try {
      const { formatClonePageBrief } = await import("../site-scraper");
      for (const p of plan.pages) {
        clonePageBriefs.set(p.file, formatClonePageBrief(cloneRef, p.route) || "");
      }
    } catch (e: any) {
      onProgress?.(`⚠️ Brief clone par page ignoré: ${e?.message || e}`);
    }
  }

  // Mode clone: capture visuelle par page (route → URL screenshot pleine page).
  // Passée à Claude EN VISION pour reproduire l'apparence réelle, pas juste le texte.
  const cloneShots = new Map<string, string>();
  if (cloneRef) {
    const norm = (s: string) => (s || "/").replace(/\/+$/, "") || "/";
    for (const p of plan.pages) {
      const target = norm(p.route);
      const match =
        cloneRef.pages.find((pg) => norm(pg.path) === target) ||
        (target === "/" ? cloneRef.pages[0] : undefined);
      if (match?.screenshot) cloneShots.set(p.file, match.screenshot);
    }
    const withShots = Array.from(cloneShots.values()).filter(Boolean).length;
    if (withShots) onProgress?.(`🖼️ ${withShots} capture(s) visuelle(s) du site → données à l'IA de code (vision) pour un rendu identique`);
  }

  const pageResults = await Promise.all(
    plan.pages.map(async (page) => {
      const key = `src/pages/${page.file}`;
      const n = `Page ${pageIndex.get(page.file)}/${totalPages}`;
      // Already fully processed on a previous run → keep as-is, no work, no noise.
      if (isFinal(page.file)) {
        const kept = resumePages[page.file]?.code || fileMap.get(key) || "";
        return { file: page.file, code: kept, ok: kept.length > 200 };
      }

      // Cancellation check BEFORE starting a new page's work: any page already
      // finalised above (checkpointed as "final") is NEVER touched — cancelling
      // stops future pages from starting, it does not undo past work.
      if (isCancelled?.()) {
        return { file: page.file, code: "", ok: false, err: "cancelled" };
      }

      const refs = pageComponentRefs.get(page.file);

      try {
        // Préparation du prompt de page — DANS le try: si un helper jette, on
        // rate CETTE page (ok:false) sans faire crasher tout le Promise.all.
        let imagesBrief = "";
        try {
          // Avec des assets /genesis, les règles s'inversent (plaques de fond
          // bord à bord imposées) → bloc dédié. Sinon, bloc habituel intact.
          imagesBrief = (chimeraAssets.length
            ? chimeraImagesPromptBlock(imageManifest, page.file)
            : imagesPromptBlock(imageManifest, page.file)) || "";
        } catch { imagesBrief = ""; }
        // [2026-09-05] Bug 22 — le relevé de l'image rendue de CETTE page est
        // recollé dans son prompt. C'est la pièce qui manquait : sans elle, la
        // page était écrite d'après le prompt d'image et l'image ne servait
        // que de fond.
        let frameBrief = "";
        try {
          const t = frameTranscripts.length
            ? transcriptForPage(frameTranscripts, page, (pageIndex.get(page.file) || 1) - 1)
            : null;
          if (t) {
            frameBrief =
              "\n\nRELEVÉ DE L'IMAGE RENDUE DE CETTE PAGE — RECONSTRUIS-LA À L'IDENTIQUE\n"
              + "Cette page a été dessinée en entier (interface comprise) avant d'être codée. Le relevé\n"
              + "ci-dessous décrit ce qui est RÉELLEMENT sur l'image. Reconstruis-la en vrai HTML/React :\n"
              + "mêmes sections dans le même ordre de haut en bas, mêmes chaînes de texte AU MOT PRÈS,\n"
              + "mêmes positions, mêmes couleurs #hex, même échelle typographique, mêmes rayons.\n"
              + "Chaque lien, chip, prix, pastille et bouton dessiné existe comme élément vivant et\n"
              + "cliquable — jamais une capture affichée en image. Les plaques de fond fournies se\n"
              + "posent bord à bord SOUS ce vrai contenu.\n"
              + "N'ajoute pas de section absente du relevé, n'en supprime aucune.\n\n"
              + t.text;
          }
        } catch { frameBrief = ""; }
        const templateBrief = (pageTemplateBriefs.get(page.file) || "") + imagesBrief + audioBrief + frameBrief;
        const original = cloneRef
          ? (page.isAppScreen
              // ÉTAPE 2 — écran intérieur FONCTIONNEL (câblé data.* + IA embarquée)
              ? CLONE_APP_SCREEN_PROMPT(ctx, design, page, allRoutes, page.sections || "")
              // Étape 1 — clone visuel fidèle de la page publique
              : CLONE_PAGE_PROMPT(ctx, design, page, allRoutes, clonePageBriefs.get(page.file) || "", imagesBrief, { primary: primaryAppRoute, routes: appScreenRoutes }))
          : PAGE_PROMPT(ctx, design, page, allRoutes, plan.entities, refs, templateBrief);
        const qaOpts = { isCore: !!page.isCore, hasPayment: !!page.hasPayment, hasForm: !!page.hasForm, isHome: page.route === "/" };

        // 5a. Generate (or reuse an in-progress draft from the checkpoint).
        let clean = resumePages[page.file]?.stage === "draft" ? resumePages[page.file].code : "";
        if (clean && clean.length > 200) {
          onProgress?.(`↩️ ${n} · ${page.name} — brouillon repris, finalisation…`);
        } else {
          const pagePath = `src/pages/${page.file}`;
          void explainIntent(
            {
              key: `page:${page.file}`,
              label: `Génération de la page ${page.name}`,
              context: `Route ${page.route}. But: ${page.purpose}. Sections prévues: ${page.sections}.${page.isCore ? " Page CŒUR (espace de travail principal, doit être un vrai CRUD)." : ""}${refs?.length ? ` ${refs.length} asset(s) créé(s) comme référence visuelle.` : ""}`,
              complexity: page.isCore ? "high" : "medium",
            },
            onProgress,
          );
          onProgress?.(`[CODE_START:${pagePath}]`);
          // Stream the code so the UI fills the scrolling rectangle in real time.
          // Throttle emissions so we don't flood the activity log / DB.
          let lastEmit = 0;
          let raw = "";
          // APERÇU EN DIRECT : on écrit aussi le VRAI code partiel sur disque
          // (instantané validé syntaxiquement) pour que l'aperçu montre la page
          // en train de se construire au lieu du stub skeleton. ~1 instantané/s
          // max, et seulement s'il a grossi depuis le précédent.
          let lastSnap = 0;
          let lastSnapLen = 0;
          let pageDone = false;
          const trySnapshot = (partial: string) => {
            if (!onFileReady || pageDone) return;
            const now = Date.now();
            if (now - lastSnap < 1000) return;
            if (partial.length < lastSnapLen + 400) return;
            lastSnap = now;
            const snap = renderablePartial(partial);
            if (!snap || pageDone) return;
            lastSnapLen = partial.length;
            emitFiles([{ path: `src/pages/${page.file}`, content: snap }], "page-partial");
          };
          // Mode clone: on fournit une image de référence en vision.
          // - Page publique → capture RÉELLE de la page scrapée (cloneShots).
          // - Écran intérieur (Étape 2) → capture trouvée par recherche web.
          const shot = cloneRef
            ? (page.isAppScreen ? page.screenRefImage : cloneShots.get(page.file))
            : undefined;
          const visionImgs = shot ? [shot] : undefined;
          try {
            raw = await aiCodeStream(CODE_SYSTEM_LEARNED, original, (full) => {
              const now = Date.now();
              if (now - lastEmit < 350) return; // ~3 updates/sec max
              lastEmit = now;
              const partial = cleanCode(full);
              if (!partial) return;
              const cap = partial.length > 6000 ? partial.slice(0, 6000) : partial;
              onProgress?.(`[CODE_STREAM:${pagePath}:${partial.split("\n").length}:${partial.length}]${cap}`);
              trySnapshot(partial);
            }, 20000, visionImgs);
          } catch {
            raw = await aiCode(CODE_SYSTEM_LEARNED, original, 20000, visionImgs); // fallback: blocking
          }
          // Plus aucun instantané partiel après ce point : la version finale de
          // la page ne doit jamais être écrasée par une écriture en retard.
          pageDone = true;
          clean = cleanCode(raw);
          const snippet = clean.length > 6000 ? clean.slice(0, 6000) : clean;
          const totalLines = clean.split("\n").length;
          onProgress?.(`[CODE_DONE:${pagePath}:${totalLines}:${clean.length}]${snippet}`);
          // Checkpoint the DRAFT so a restart doesn't re-generate this page.
          fileMap.set(key, clean);
          checkpoint({ page: { file: page.file, code: clean, stage: "draft" } });
        }
        if (!clean || clean.length < 200) throw new Error("page vide");

        // Cancellation check: the draft is already checkpointed above (fileMap +
        // checkpoint stage:"draft"), so stopping here loses NOTHING — a future
        // run resumes straight from this draft instead of regenerating it.
        if (isCancelled?.()) return { file: page.file, code: clean, ok: true };

        // 5a-bis. ADOPTION 21st.dev — vérifie que le modèle a RÉELLEMENT repris
        // le code des composants sélectionnés. Sinon (assets ignorés), on force
        // une reconstruction À PARTIR de leur code source, jusqu'à 2 tentatives.
        if (refs && refs.length) {
          let adopt = analyzeAdoption(clean, refs);
          let tries = 0;
          while (adopt.weak && tries < 2) {
            tries++;
            onProgress?.(`🧩 ${n} · ${page.name} — assets peu intégrés (${adopt.adopted}/${adopt.total}), reconstruction forcée…`);
            try {
              const rebuilt = cleanCode(await forceComponentAdoption(original, clean, adopt, CODE_SYSTEM_LEARNED));
              if (rebuilt && rebuilt.length > 200) {
                const after = analyzeAdoption(rebuilt, refs);
                if (after.adopted >= adopt.adopted) { clean = rebuilt; adopt = after; }
                else break; // pas d'amélioration → on garde la meilleure version
              } else break;
            } catch (e: any) { onProgress?.(`⚠️ ${n} · intégration des assets: ${e?.message || e}`); break; }
          }
          if (adopt.total) {
            onProgress?.(
              adopt.weak
                ? `⚠️ ${page.name} — ${adopt.adopted}/${adopt.total} assets intégrés (partiel)`
                : `✅ ${page.name} — ${adopt.adopted}/${adopt.total} assets intégrés`,
            );
          }
          // Re-checkpoint le brouillon consolidé (évite de re-générer au restart).
          fileMap.set(key, clean);
          checkpoint({ page: { file: page.file, code: clean, stage: "draft" } });
        }

        // 5b+5c. QA + Densité — fusionnées en UNE seule passe IA maximum par
        // page (optimisation crédits: avant, une page maigre ET défectueuse
        // subissait 2 réécritures complètes; maintenant 1 seule, et un simple
        // défaut de câblage se corrige en DIFF ciblé, pas en réécriture).
        let qa = analyzePage(page.file, clean, qaOpts);
        let dens = analyzeDensity(page.file, clean, { isCore: !!page.isCore });

        // Mode clone (page PUBLIQUE): AUCUNE réécriture QA/densité. On reproduit
        // le site source à l'identique — on ne "densifie" ni ne "corrige" une page
        // fidèle, sinon l'IA réinvente du contenu absent de la source. On garde
        // EXACTEMENT ce que CLONE_PAGE_PROMPT a produit depuis le brief Firecrawl.
        // EXCEPTION — Étape 2: un écran INTÉRIEUR fonctionnel (isAppScreen) DOIT
        // passer la QA fonctionnelle (câblage data.*/IA réel, états loading/vide/
        // erreur), donc il suit le chemin normal ci-dessous.
        if (cloneRef && !page.isAppScreen) {
          onProgress?.(`✅ ${page.file}: clone fidèle du site source (aucune retouche IA)`);
        } else if (dens.thin) {
          // Page trop maigre → UNE passe combinée: enrichit ET corrige le câblage.
          const needsFix = qa.score < QA_THRESHOLD;
          onProgress?.(`🔧 ${page.file}: densité ${dens.score}/100${needsFix ? `, QA ${qa.score}/100` : ""} — amélioration combinée…`);
          let qaAfterFix: typeof qa | undefined;
          try {
            const improved = cleanCode(await improvePage(original, clean, needsFix ? qa : null, dens, CODE_SYSTEM_LEARNED));
            if (improved && improved.length > 200) {
              const afterD = analyzeDensity(page.file, improved, { isCore: !!page.isCore });
              const afterQ = analyzePage(page.file, improved, qaOpts);
              qaAfterFix = afterQ;
              // Ne pas retenir une version qui jette les composants 21st.dev intégrés.
              const keepsRefs = !refs?.length ||
                analyzeAdoption(improved, refs).adopted >= analyzeAdoption(clean, refs).adopted;
              if (afterD.score > dens.score && afterQ.score >= qa.score - 5 && keepsRefs) {
                clean = improved; const prevD = dens.score; qa = afterQ; dens = afterD;
                onProgress?.(`✅ ${page.file}: densité ${prevD}→${afterD.score}/100, QA ${afterQ.score}/100`);
              } else {
                onProgress?.(`↩️ ${page.file}: amélioration non retenue (densité ${afterD.score}, QA ${qa.score}→${afterQ.score}${keepsRefs ? "" : ", perd des assets"})`);
              }
            }
          } catch (e: any) { onProgress?.(`⚠️ Amélioration ${page.file}: ${e?.message || e}`); }
          if (needsFix) void recordQAOutcome(qa, qaAfterFix);
        } else if (qa.score < QA_THRESHOLD) {
          // Page riche mais câblage défectueux → correction en DIFF ciblé
          // (blocs SEARCH/REPLACE), beaucoup moins cher qu'une réécriture.
          onProgress?.(`🔧 QA ${page.file}: ${qa.score}/100 — correction ciblée (${qa.issues.map(i => i.code).join(", ")})…`);
          let qaAfterFix: typeof qa | undefined;
          try {
            const fixed = cleanCode(await fixPage(original, clean, qa, CODE_SYSTEM_LEARNED));
            if (fixed && fixed.length > 200 && fixed !== clean) {
              const after = analyzePage(page.file, fixed, qaOpts);
              qaAfterFix = after;
              // Ne pas retenir une correction qui, au passage, JETTE les
              // composants 21st.dev déjà intégrés (régression visuelle).
              const keepsRefs = !refs?.length ||
                analyzeAdoption(fixed, refs).adopted >= analyzeAdoption(clean, refs).adopted;
              if (after.score >= qa.score && keepsRefs) { clean = fixed; qa = after; onProgress?.(`✅ QA ${page.file}: ${after.score}/100`); }
              else onProgress?.(`↩️ QA ${page.file}: correction non retenue (${after.score}<${qa.score}${keepsRefs ? "" : ", perd des assets"})`);
            }
          } catch (e: any) { onProgress?.(`⚠️ QA ${page.file}: ${e?.message || e}`); }
          // Apprentissage global — purement automatique, à partir du score QA
          // avant/après, indépendant de l'utilisateur/de l'entreprise.
          void recordQAOutcome(qa, qaAfterFix);
        } else {
          onProgress?.(`✅ QA ${page.file}: ${qa.score}/100 · densité ${dens.score}/100`);
        }

        // Page fully processed → persist final code + checkpoint as "final".
        fileMap.set(key, clean);
        pagesDone++;
        const work = describePageWork(clean);
        onProgress?.(
          `✅ ${n} · ${page.name} — ${work.length ? work.join(", ") : `${clean.split("\n").length} lignes générées`} (${pagesDone}/${totalPages} faites)`,
        );
        void explainOutcome(
          { key: `page:${page.file}`, label: `Génération de la page ${page.name}`, context: `Route ${page.route}.`, complexity: page.isCore ? "high" : "medium" },
          `${work.length ? work.join(", ") : `${clean.split("\n").length} lignes générées`}. Score qualité fonctionnelle final: ${qa.score}/100. Score richesse: ${dens.score}/100.`,
          onProgress,
        );
        checkpoint({ page: { file: page.file, code: clean, stage: "final" } });
        return { file: page.file, code: clean, ok: true };
      } catch (e: any) {
        onProgress?.(`⚠️ ${n} · ${page.name} — échec: ${e?.message || e}`);
        void explainOutcome(
          { key: `page:${page.file}`, label: `Génération de la page ${page.name}`, context: `Route ${page.route}.`, complexity: "low" },
          `Échec: ${e?.message || e}. La page reste vide ou incomplète pour cette tentative.`,
          onProgress,
        );
        return { file: page.file, code: "", ok: false, err: e?.message };
      }
    })
  );
  for (const r of pageResults) {
    if (r.ok && r.code.length > 200) fileMap.set(`src/pages/${r.file}`, r.code);
  }
  onProgress?.(`✅ ${totalPages} pages terminées`);

  // Les visuels réels ont été générés EN ARRIÈRE-PLAN pendant la construction
  // des pages (elles ont largement eu le temps de finir). On attend ici leur
  // fin pour que images.ts contienne les VRAIES URLs avant le filet de sécurité
  // et la sortie finale → résultat persisté identique à un build non-live.
  await imageGenBg.catch(() => {});

  // ── 5b. Filet de sécurité IMAGES ──────────────────────────────────────────
  // Une page peut halluciner une clé IMAGES.xxx qui n'existe pas dans le
  // manifeste réellement généré (nom légèrement différent, page écrite avant
  // que le manifeste ne soit prêt, etc.). Dans ce cas `IMAGES.xxx` vaut
  // `undefined` → `url(undefined)`/`src={undefined}` → AUCUNE image ne
  // s'affiche, juste un fond plat (souvent perçu comme "gris" par
  // l'utilisateur) sans que rien ne signale l'erreur. On scanne tout le code
  // généré, on repère les clés utilisées mais absentes du manifeste, et on
  // leur ajoute un dégradé de secours dans images.ts pour qu'il y ait TOUJOURS
  // un visuel affiché, même si ce n'est pas l'image idéale.
  {
    const usedKeys = new Set<string>();
    const keyRe = /\bIMAGES\.(\w+)\b/g;
    for (const [path, content] of fileMap) {
      if (!/^src\/(pages|components)\//.test(path)) continue;
      let km: RegExpExecArray | null;
      while ((km = keyRe.exec(content))) usedKeys.add(km[1]);
    }
    const missingKeys = [...usedKeys].filter(k => !(k in imageManifest.urls));
    if (missingKeys.length) {
      onProgress?.(`🎨 ${missingKeys.length} visuel(s) supplémentaire(s) réclamé(s) par les pages, génération…`);
      // On GÉNÈRE de vraies images pour ces clés (le dégradé n'est qu'un ultime
      // filet si la génération échoue) — plus de cartes à fond plat moche.
      const generated = await generateMissingImages(
        missingKeys,
        { companyName: meta.companyName, idea: input.idea || "", industry: input.industry },
        onProgress,
      );
      const fallbackUrls = { ...imageManifest.urls, ...generated };
      // Garde le manifeste en mémoire à jour pour la suite (édition, checkpoint).
      Object.assign(imageManifest.urls, generated);
      fileMap.set("src/lib/images.ts", IMAGES_TS(fallbackUrls));
      emitFiles([{ path: "src/lib/images.ts", content: IMAGES_TS(fallbackUrls) }], "images");
    }
  }

  // ── 6. App.tsx wiring (DETERMINISTIC) ──
  // Built by code, not the model, so routing/Layout/auth wiring always compiles
  // and stays consistent. Content pages render inside <Layout> (Header+Footer once).
  onProgress?.("🔗 Routage (App.tsx)…");
  fileMap.set("src/App.tsx", buildAppTsx(plan.pages, meta.cloneMode, meta.withAuth));

  checkpoint({ phase: "done" });
  const files: ScaffoldFile[] = Array.from(fileMap.entries()).map(([path, content]) => ({ path, content }));
  return { files, design, plan, meta };
}

// ─── Live-preview skeleton stubs ─────────────────────────────────────────────
// Lightweight, dependency-free placeholders written to disk so the Vite dev
// server can boot and render a real (skeleton) app immediately, before the AI
// has produced the real Header/Footer/pages. Each is overwritten in place as
// the real code lands (HMR). They are NEVER added to the engine's returned
// files → final output is unaffected.
// Placeholder « photo en cours de chargement » on-brand : un dégradé doux aux
// couleurs de la marque, servi dans images.ts tant que la vraie image générée
// n'est pas arrivée. Remplacé en place par la vraie URL via HMR → la photo
// « apparaît » dans l'aperçu en direct sans jamais laisser d'image cassée.
function loadingPlaceholder(c1: string, c2: string): string {
  const safe = (c: string) => (/^#?[0-9a-fA-F]{3,8}$/.test(c) ? (c.startsWith("#") ? c : `#${c}`) : "#6366f1");
  const a = safe(c1), b = safe(c2);
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="800"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0%" stop-color="${a}" stop-opacity="0.30"/><stop offset="100%" stop-color="${b}" stop-opacity="0.12"/></linearGradient></defs><rect width="1200" height="800" fill="url(#g)"/></svg>`;
  return `data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}`;
}

function STUB_HEADER(meta: AppMeta, navRoutes: Array<{ name: string; route: string }>): string {
  const name = (meta.companyName || "").replace(/[<>{}"`]/g, "");
  const links = navRoutes.slice(0, 6).map(r => `        <Link to="${r.route}" className="text-sm text-gray-500 hover:text-gray-900 dark:text-gray-400 dark:hover:text-white transition">${(r.name || "").replace(/[<>{}"`]/g, "")}</Link>`).join("\n");
  return `import { Link } from "react-router-dom";

export default function Header() {
  return (
    <header className="sticky top-0 z-40 w-full backdrop-blur border-b border-gray-100 dark:border-gray-800 bg-white/80 dark:bg-gray-950/80">
      <div className="mx-auto max-w-7xl px-4 h-16 flex items-center justify-between">
        <Link to="/" className="font-semibold text-gray-900 dark:text-white">${name || "App"}</Link>
        <nav className="hidden md:flex items-center gap-6">
${links}
        </nav>
        <div className="h-9 w-24 rounded-full bg-gray-100 dark:bg-gray-800 animate-pulse" />
      </div>
    </header>
  );
}
`;
}

function STUB_FOOTER(meta: AppMeta): string {
  const name = (meta.companyName || "").replace(/[<>{}"`]/g, "");
  return `export default function Footer() {
  return (
    <footer className="border-t border-gray-100 dark:border-gray-800 mt-16">
      <div className="mx-auto max-w-7xl px-4 py-10 text-sm text-gray-400">
        © ${new Date().getFullYear()} ${name || "App"}
      </div>
    </footer>
  );
}
`;
}

function STUB_PAGE(comp: string, name: string): string {
  const label = (name || comp).replace(/[<>{}"`]/g, "");
  return `export default function ${comp}() {
  return (
    <div className="mx-auto max-w-6xl px-4 py-16">
      <div className="flex items-center gap-3 mb-8">
        <span className="inline-flex h-5 w-5 items-center justify-center">
          <span className="h-4 w-4 rounded-full border-2 border-brand/40 border-t-brand animate-spin" />
        </span>
        <span className="text-sm font-medium text-gray-500 dark:text-gray-400">Construction de « ${label} »…</span>
      </div>
      <div className="animate-pulse">
        <div className="h-10 w-1/3 rounded-xl bg-gray-100 dark:bg-gray-800 mb-6" />
        <div className="h-64 w-full rounded-3xl bg-gray-100 dark:bg-gray-800 mb-8" />
        <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
          <div className="h-40 rounded-2xl bg-gray-100 dark:bg-gray-800" />
          <div className="h-40 rounded-2xl bg-gray-100 dark:bg-gray-800" />
          <div className="h-40 rounded-2xl bg-gray-100 dark:bg-gray-800" />
        </div>
      </div>
      <span className="sr-only">${label} — chargement…</span>
    </div>
  );
}
`;
}

// Deterministically wire App.tsx: content pages inside a shared <Layout>, plus
// the built-in auth (login/signup) + protected (profile/settings) + Stripe
// success/cancel routes. Never AI-generated → never truncated, always compiles.
export function buildAppTsx(pages: Array<{ name: string; file: string; route: string }>, cloneMode?: boolean, withAuth: boolean = true): string {
  const reserved = new Set([
    "/login", "/signup", "/profile", "/settings", "/success", "/cancel",
    "/terms", "/privacy", "/legal-notice", "/cookies", "/support", // deterministic standard pages
  ]);
  const content = pages.filter(p => !reserved.has(p.route));
  const comp = (file: string) => file.replace(/\.tsx?$/, "").replace(/[^a-zA-Z0-9]/g, "");
  const imports = content.map(p => `import ${comp(p.file)} from "./pages/${comp(p.file)}";`).join("\n");
  const contentRoutes = content.map(p => `        <Route path="${p.route}" element={<${comp(p.file)} />} />`).join("\n");
  // ── MODE CLONE : router MINIMAL, fidèle au site source ──
  // Aucune route auth/légale/paiement inventée : uniquement les vraies pages
  // scrapées + un catch-all NotFound. Les pages standard n'existent pas dans un
  // clone (scaffold réduit) — on ne les importe donc jamais.
  if (cloneMode) {
    // Pages AUTONOMES : chaque page reproduit le site entier (header + corps +
    // footer) fidèle à sa capture. Pas de Layout/Header/Footer partagés (source
    // de double footer et d'invention). ScrollToTop conservé pour la nav.
    return `import { Routes, Route, useLocation } from "react-router-dom";
import { useEffect } from "react";
import NotFound from "./pages/NotFound";
${imports}

function ScrollToTop() {
  const { pathname, hash } = useLocation();
  useEffect(() => { if (!hash) window.scrollTo({ top: 0, left: 0, behavior: "auto" }); }, [pathname, hash]);
  return null;
}

export default function App() {
  return (
    <>
      <ScrollToTop />
      <Routes>
${contentRoutes}
        <Route path="*" element={<NotFound />} />
      </Routes>
    </>
  );
}
`;
  }
  // Auth OFF: on n'importe/route PAS Login/Signup/Profile/Settings (ces pages ne
  // sont pas générées par le scaffold) — sinon imports cassés + routes /login
  // fantômes. Le reste (légal, support, paiement) reste identique.
  const authImports = withAuth
    ? `import { ProtectedRoute } from "./lib/auth";
import Login from "./pages/Login";
import Signup from "./pages/Signup";
import Profile from "./pages/Profile";
import Settings from "./pages/Settings";
`
    : "";
  const authRoutes = withAuth
    ? `        <Route path="/login" element={<Login />} />
        <Route path="/signup" element={<Signup />} />
        <Route path="/profile" element={<ProtectedRoute><Profile /></ProtectedRoute>} />
        <Route path="/settings" element={<ProtectedRoute><Settings /></ProtectedRoute>} />
`
    : "";
  return `import { Routes, Route, useSearchParams, useNavigate, Link } from "react-router-dom";
import { useEffect, useState } from "react";
import { CheckCircle, XCircle, Loader2 } from "lucide-react";
import Layout from "./components/Layout";
import { api } from "./lib/api";
${authImports}import Terms from "./pages/Terms";
import Privacy from "./pages/Privacy";
import LegalNotice from "./pages/LegalNotice";
import Cookies from "./pages/Cookies";
import Support from "./pages/Support";
import NotFound from "./pages/NotFound";
${imports}

function Success() {
  const [params] = useSearchParams();
  const sessionId = params.get("session_id");
  const [status, setStatus] = useState<"loading" | "ok" | "error">("loading");
  const navigate = useNavigate();
  useEffect(() => {
    if (!sessionId) { setStatus("error"); return; }
    api("/checkout/" + sessionId).then(() => setStatus("ok")).catch(() => setStatus("error"));
  }, [sessionId]);
  return (
    <div className="min-h-[70vh] flex items-center justify-center px-4">
      <div className="text-center max-w-md">
        {status === "loading" && <Loader2 className="mx-auto h-12 w-12 animate-spin text-brand" />}
        {status === "ok" && <CheckCircle className="mx-auto h-14 w-14 text-green-500" />}
        {status === "error" && <XCircle className="mx-auto h-14 w-14 text-red-500" />}
        <h1 className="mt-4 text-2xl font-bold text-gray-900 dark:text-white">
          {status === "ok" ? "Paiement réussi !" : status === "loading" ? "Vérification…" : "Vérification impossible"}
        </h1>
        <p className="mt-2 text-gray-500 dark:text-gray-400">
          {status === "ok" ? "Merci pour ta confiance. Un e-mail de confirmation arrive." : "Reviens à l'accueil et réessaie si besoin."}
        </p>
        <Link to="/" className="mt-6 inline-block rounded-lg bg-brand px-5 py-2.5 font-semibold text-white hover:opacity-90 transition">Retour à l'accueil</Link>
      </div>
    </div>
  );
}

function Cancel() {
  return (
    <div className="min-h-[70vh] flex items-center justify-center px-4">
      <div className="text-center max-w-md">
        <XCircle className="mx-auto h-14 w-14 text-amber-500" />
        <h1 className="mt-4 text-2xl font-bold text-gray-900 dark:text-white">Paiement annulé</h1>
        <p className="mt-2 text-gray-500 dark:text-gray-400">Aucun montant n'a été débité.</p>
        <Link to="/" className="mt-6 inline-block rounded-lg bg-brand px-5 py-2.5 font-semibold text-white hover:opacity-90 transition">Retour à l'accueil</Link>
      </div>
    </div>
  );
}

export default function App() {
  return (
    <Routes>
      <Route element={<Layout />}>
${contentRoutes}
${authRoutes}        <Route path="/terms" element={<Terms />} />
        <Route path="/privacy" element={<Privacy />} />
        <Route path="/legal-notice" element={<LegalNotice />} />
        <Route path="/cookies" element={<Cookies />} />
        <Route path="/support" element={<Support />} />
        <Route path="/success" element={<Success />} />
        <Route path="/cancel" element={<Cancel />} />
        <Route path="*" element={<NotFound />} />
      </Route>
    </Routes>
  );
}
`;
}

// ─── Chat Edit: apply a natural-language change to an existing app ────────────

export interface ExistingFile { path: string; content: string; type?: string }

export interface EditResult {
  summary: string;
  changed: ScaffoldFile[];      // files to (over)write on disk + persist
  newRoutes: Array<{ name: string; route: string; file: string }>;
}

// Given the current project files and a user request, plan targeted edits,
// rewrite each affected file, and return only the changed files.
// Parse src/App.tsx to know which src/pages/*.tsx files are ACTUALLY reachable
// (imported + wired into a <Route>) and under which route. Pages generated at
// some point but never routed (orphans) must never be silently targeted by an
// edit — the model would report "success" while nothing visible changes.
// Returns a map: "src/pages/Foo.tsx" -> "/route" (or "" if imported but not
// matched to a specific <Route path>, still considered reachable/used).
function getRoutedPages(appTsxContent: string): Map<string, string> {
  const routed = new Map<string, string>();
  if (!appTsxContent) return routed;
  // 1. import Foo from "./pages/Foo" (or "../pages/Foo", any case) → comp→file
  const compToFile = new Map<string, string>();
  const importRe = /import\s+(\w+)\s+from\s+["'](?:\.\/|\.\.\/)*pages\/(\w+)["']/g;
  let m: RegExpExecArray | null;
  while ((m = importRe.exec(appTsxContent))) compToFile.set(m[1], m[2]);
  // 2. <Route path="/x" ... element={<Foo ...>} → file→route
  const routeRe = /<Route\s+path=["']([^"']+)["'][^>]*element=\{<(\w+)/g;
  while ((m = routeRe.exec(appTsxContent))) {
    const file = compToFile.get(m[2]);
    if (file) routed.set(`src/pages/${file}.tsx`, m[1]);
  }
  // Any imported page component not caught by the <Route> regex above (e.g.
  // wrapped in ProtectedRoute) is still reachable — mark it used with a blank
  // route rather than treating it as orphan.
  for (const [comp, file] of compToFile) {
    const path = `src/pages/${file}.tsx`;
    if (!routed.has(path) && appTsxContent.includes(`<${comp}`)) routed.set(path, "");
  }
  return routed;
}

// ─── PLANIFICATION EN PHASES (grosses demandes) ──────────────────────────
// Quand l'utilisateur envoie une demande LOURDE ou COMPLEXE (plusieurs
// fonctionnalités, un système entier, un gros refactor, « fais tout ça »…),
// l'IA ne doit PAS foncer tête baissée : elle propose d'abord un plan découpé
// en PHASES et en TÂCHES concrètes, attend la validation de l'utilisateur, puis
// exécute phase par phase, tâche par tâche. Cette fonction JUGE elle-même si la
// demande est complexe (pas de seuil fixe) et, si oui, produit le plan.
export interface PhasePlan {
  complex: boolean;
  summary: string;
  phases: Array<{ title: string; tasks: string[] }>;
}

const PLAN_PHASES_SYSTEM = `Tu es un lead engineer qui reçoit une demande de modification sur une app React/Tailwind existante.
Ta seule mission : décider si la demande est GROSSE/COMPLEXE, et si oui la découper en un plan clair.

Une demande est COMPLEXE (complex=true) si elle implique PLUSIEURS de ces éléments :
- plusieurs fonctionnalités ou pages à créer/modifier
- un système entier (auth, dashboard, paiement, chat, panier, etc.)
- un gros refactor ou une refonte visuelle globale
- des mots comme « tout », « complet », « système », « plusieurs », « et aussi », une longue liste
Une demande est SIMPLE (complex=false) si c'est UN seul petit changement ciblé
(changer une couleur, un texte, un bouton, déplacer un élément, corriger un bug précis).

Si COMPLEXE : découpe en 2 à 5 PHASES logiques et ordonnées. Chaque phase a un titre court
et 1 à 5 TÂCHES concrètes et actionnables (chaque tâche = une modification précise et autonome
qu'un dev peut exécuter en une passe). Sois exhaustif mais sans inventer de features non demandées.
Si SIMPLE : complex=false et phases=[].

Réponds UNIQUEMENT en JSON valide, dans la langue de l'utilisateur :
{"complex": boolean, "summary": "résumé en une phrase de ce qui va être fait", "phases": [{"title": "...", "tasks": ["...", "..."]}]}`;

export async function planPhases(
  userRequest: string,
  files: ExistingFile[],
  _design: any | undefined,
  journalContext?: string,
): Promise<PhasePlan> {
  const lang = detectLang(userRequest);
  const fileList = files
    .filter(f => /\.(tsx|jsx|ts|css)$/.test(f.path))
    .map(f => f.path)
    .slice(0, 80)
    .join("\n");
  const prompt = `LANGUE DE RÉPONSE : ${lang}

DEMANDE DE L'UTILISATEUR :
${userRequest}

FICHIERS DU PROJET (pour évaluer l'ampleur) :
${fileList}
${journalContext ? `\nCONTEXTE / HISTORIQUE DU PROJET :\n${journalContext.slice(0, 1500)}` : ""}

Décide si c'est complexe et, si oui, propose le plan. JSON uniquement.`;
  try {
    const parsed = extractJSON(await aiText(PLAN_PHASES_SYSTEM, prompt, 4000, CHEAP_JSON_MODEL));
    const phases = Array.isArray(parsed?.phases)
      ? parsed.phases
          .map((p: any) => ({
            title: String(p?.title || "").trim(),
            tasks: Array.isArray(p?.tasks)
              ? p.tasks.map((t: any) => String(t || "").trim()).filter(Boolean)
              : [],
          }))
          .filter((p: any) => p.title && p.tasks.length > 0)
      : [];
    return {
      complex: !!parsed?.complex && phases.length > 0,
      summary: String(parsed?.summary || userRequest).trim(),
      phases,
    };
  } catch {
    // En cas d'échec du classifieur, on ne bloque pas : on traite comme simple.
    return { complex: false, summary: userRequest, phases: [] };
  }
}

// ─── VOIE RAPIDE : micro-édition de texte, SANS aucun appel IA ───────────────
//
// [2026-09-10] Demande utilisateur : « j'ai dit à l'IA de changer le mot X par
// X test et elle prend vraiment beaucoup de temps juste pour ajouter un mot —
// rends l'IA plus puissante et rapide ».
//
// Un simple remplacement de texte n'a pas besoin de : classifieur de phases +
// planificateur de fichiers + réécriture COMPLÈTE du fichier par Sonnet +
// redémarrage du serveur + build de vérification. Tout ça pour un mot.
// Ici on résout la demande de façon DÉTERMINISTE :
//   1. on lit « change A par B » dans la phrase ;
//   2. on retrouve A dans les fichiers (tolérant aux retours à la ligne JSX) ;
//   3. on écrit B à la place — le HMR de Vite fait le reste.
// Aucun modèle appelé → réponse quasi instantanée. Si le texte n'est pas
// trouvé de façon SÛRE (une seule occurrence, un seul fichier), on retourne
// null et le chemin IA complet reprend la main : jamais de fausse réussite.

export interface MicroEditResult {
  changed: ScaffoldFile[];
  summary: string;
  path: string;
  before: string;
  after: string;
}

// Le remplacement rapide ne vise QUE le code du site (src/, index.html,
// public/). Les métadonnées .velbaz/* et les docs marketing/* contiennent
// souvent les mêmes phrases : les éditer silencieusement au lieu de la page
// serait une erreur invisible pour l'utilisateur.
const MICRO_EDIT_FILE = /^(src\/.+\.(tsx|jsx|ts|js|css)|public\/.+\.(css|html|js)|index\.html)$/;

/** « change/remplace A par B » → { from: A, to: B }. */
export function parseTextReplacement(request: string): { from: string; to: string } | null {
  const req = request.replace(/\s+/g, " ").trim();
  if (req.length > 600) return null;
  let m = req.match(
    /(?:change|changer|changez|remplace|remplacer|remplacez|modifie|modifier|renomme|renommer|corrige|replace|rename|swap)\s+(?:moi\s+)?(?:(?:le|la|les|l['’]\s*|ce|cette|mon|ma|the)\s*)?(?:mot|texte|titre|phrase|libell[eé]|slogan|paragraphe|bouton|lien|label|word|text|title)\s*:?\s+(.+?)\s+(?:par|pour|en|avec|->|→|=>|to|by|with|into)\s+(.+?)\s*$/i,
  );
  const m2 = m ? null : req.match(
    /(?:change|changer|changez|remplace|remplacer|remplacez|modifie|modifier|renomme|renommer|corrige|replace|rename|swap)\s+(?:moi\s+)?:?\s*(.+?)\s+(?:par|pour|->|→|=>|to|by|into)\s+(.+?)\s*$/i,
  );
  m = m || m2;
  if (!m) return null;
  const strip = (v: string) =>
    v.trim().replace(/^[«"“”'‘’`]+/, "").replace(/[»"“”'‘’`]+$/, "").trim();
  const from = strip(m[1]);
  const to = strip(m[2]);
  if (!from || !to || from === to) return null;
  if (from.length < 3 || from.length > 400 || to.length > 400) return null;
  // Du code (balises, accolades, expressions) n'est PAS du texte : on laisse
  // ces demandes au chemin IA complet.
  if (/[<>{}`=\\]/.test(from) || /[<>{}`=\\]/.test(to)) return null;
  return { from, to };
}

/** Motif tolérant : les espaces du texte peuvent être des retours à la ligne /
 *  de l'indentation JSX, et les apostrophes typographiques valent l'apostrophe
 *  droite. Aucune balise n'est jamais avalée (les trous ne matchent que du
 *  blanc), donc le remplacement ne peut pas supprimer de markup. */
function flexiblePattern(text: string): RegExp {
  const parts = text.split(/\s+/).filter(Boolean).map(w =>
    w
      .split("")
      .map(ch => {
        if (/['‘’]/.test(ch)) return "['‘’]";
        return ch.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      })
      .join(""),
  );
  return new RegExp(parts.join("\\s+"), "g");
}

function countMatches(content: string, re: RegExp): number {
  let n = 0;
  re.lastIndex = 0;
  while (re.exec(content)) { n++; if (n > 2) break; }
  re.lastIndex = 0;
  return n;
}

/** Paires (chercher, écrire) candidates, de la plus précise à la plus tolérante. */
function replacementCandidates(from: string, to: string): Array<{ find: string; write: string }> {
  const out: Array<{ find: string; write: string }> = [{ find: from, write: to }];
  const fw = from.split(/\s+/).filter(Boolean);
  const tw = to.split(/\s+/).filter(Boolean);
  let pre = 0;
  while (pre < fw.length && pre < tw.length && fw[pre] === tw[pre]) pre++;
  let suf = 0;
  while (suf < fw.length - pre && suf < tw.length - pre && fw[fw.length - 1 - suf] === tw[tw.length - 1 - suf]) suf++;
  const coreF = fw.slice(pre, fw.length - suf);
  const coreT = tw.slice(pre, tw.length - suf);
  // Ancre AVANT le changement (le plus courant : on ajoute/retire un mot à la fin).
  for (const k of [3, 2, 1]) {
    if (pre >= k) {
      const anchor = fw.slice(pre - k, pre);
      const find = [...anchor, ...coreF].join(" ");
      const write = [...anchor, ...coreT].join(" ");
      if (find.length >= 4 && find !== write) out.push({ find, write });
    }
  }
  // Sinon ancre APRÈS le changement (mot ajouté/changé au début).
  for (const k of [3, 2, 1]) {
    if (suf >= k) {
      const anchor = fw.slice(fw.length - suf, fw.length - suf + k);
      const find = [...coreF, ...anchor].join(" ");
      const write = [...coreT, ...anchor].join(" ");
      if (find.length >= 4 && find !== write) out.push({ find, write });
    }
  }
  return out;
}

/** Combien des mots du texte d'origine sont réellement présents dans ce
 *  fichier — garde-fou contre un remplacement dans un fichier sans rapport. */
function wordCoverage(content: string, from: string): number {
  const words = from.split(/\s+/).filter(w => w.replace(/[^\p{L}\p{N}]/gu, "").length >= 3);
  if (!words.length) return 1;
  const flat = content.replace(/\s+/g, " ");
  const hit = words.filter(w => flexiblePattern(w).test(flat)).length;
  return hit / words.length;
}

export function microEdit(userRequest: string, files: ExistingFile[]): MicroEditResult | null {
  const parsed = parseTextReplacement(userRequest);
  if (!parsed) return null;
  const { from, to } = parsed;
  const candidates = files.filter(f => MICRO_EDIT_FILE.test(f.path) && typeof f.content === "string" && f.content.length < 400_000);
  if (!candidates.length) return null;

  for (const cand of replacementCandidates(from, to)) {
    const re = flexiblePattern(cand.find);
    const hits = candidates
      .map(f => ({ file: f, n: countMatches(f.content, re) }))
      .filter(h => h.n > 0);
    // Une SEULE occurrence dans un SEUL fichier : sinon on ne devine pas, on
    // repasse à l'IA (qui, elle, a le contexte pour choisir).
    if (hits.length !== 1 || hits[0].n !== 1) continue;
    const target = hits[0].file;
    if (wordCoverage(target.content, from) < 0.6) continue;
    const before = target.content;
    const after = before.replace(flexiblePattern(cand.find), () => cand.write);
    if (after === before) continue;
    return {
      changed: [{ path: target.path, content: after }],
      summary: `Texte remplacé : « ${from.slice(0, 60)} » → « ${to.slice(0, 60)} »`,
      path: target.path,
      before,
      after,
    };
  }
  return null;
}

export async function editApp(
  userRequest: string,
  files: ExistingFile[],
  design: any | undefined,
  onProgress?: (msg: string) => void,
  journalContext?: string,
  hint?: { targetFiles?: string[] },
): Promise<EditResult> {
  const lang = detectLang(userRequest);
  const fileMap = new Map(files.map(f => [f.path, f.content]));
  // Route map derived from the REAL src/App.tsx: tells us which src/pages/*.tsx
  // files are actually reachable and under which route, vs orphan pages that
  // exist on disk but are wired into nothing (see getRoutedPages() above).
  const routedPages = getRoutedPages(fileMap.get("src/App.tsx") || "");
  const homeFile = [...routedPages.entries()].find(([, route]) => route === "/")?.[0] || "src/pages/Home.tsx";
  // Même mémoire globale que la génération initiale — les leçons apprises sur
  // toute la plateforme s'appliquent aussi aux éditions/corrections de code.
  const learnedBlockEdit = await getLearnedPromptBlock();
  const EDIT_FILE_SYSTEM_LEARNED = learnedBlockEdit ? `${EDIT_FILE_SYSTEM}${learnedBlockEdit}` : EDIT_FILE_SYSTEM;

  // ── [2026-09-13] Fidélité à la QUANTITÉ demandée ───────────────────────────
  // Bug SIGNALÉ : « ajoute mon premier produit » → l'IA en ajoutait plusieurs.
  // Un modèle de code laissé libre « remplit » toujours (une grille de six fait
  // plus joli qu'un produit seul), mais ce n'est PAS ce qui a été demandé.
  // On lit donc la quantité réelle de la phrase et on l'impose dans le plan ET
  // dans chaque réécriture de fichier. Muet si la demande ne porte aucune
  // quantité (« change la couleur ») : on n'invente pas de contrainte.
  const { countConstraint, parseRequestedCount, countListItems, addedItems, overshootFeedback, targetTotalHint } =
    await import("./requested-count");
  const qtyConstraint = countConstraint(userRequest, lang);
  const qtyAsked = parseRequestedCount(userRequest).count;
  if (qtyConstraint) onProgress?.(`[REASONING:quantité] ${qtyConstraint.split("\n")[1] || ""}`);
  // La contrainte est collée à l'instruction : c'est elle que le modèle de
  // réécriture lit, le userRequest d'origine ne lui parvient pas toujours.
  // `current` (facultatif) permet d'ajouter le COMPTE CIBLE du fichier, seule
  // formulation que le modèle respecte réellement (cf. requested-count.ts).
  const withQty = (instruction: string, current?: string) => {
    if (!qtyConstraint) return instruction;
    const hint = qtyAsked !== null && current !== undefined
      ? `\n\n${targetTotalHint(countListItems(current), qtyAsked, lang)}`
      : "";
    return `${instruction}\n\n${qtyConstraint}${hint}`;
  };

  // 1. Plan which files to touch
  let plan: { summary: string; edits: Array<{ path: string; action: string; instruction: string }>; newRoutes?: any[] };
  // ─── Édition VISUELLE ciblée ─────────────────────────────────────────────
  // Quand l'éditeur visuel nous donne déjà le(s) fichier(s) exact(s) à modifier
  // (résolus de façon DÉTERMINISTE via app-map.json côté serveur), on SAUTE
  // complètement le planificateur IA. Avant, un petit modèle devinait le fichier
  // et se trompait (il éditait Home.tsx alors que la page « / » = Workspace.tsx)
  // → l'IA renvoyait « succès » sans jamais toucher le bon fichier, donc rien ne
  // changeait à l'écran. La résolution déterministe supprime ce bug ET accélère
  // la sauvegarde (une étape IA en moins).
  const validTargets = (hint?.targetFiles || []).filter(p => fileMap.has(p));
  if (validTargets.length > 0) {
    plan = {
      summary: userRequest,
      edits: validTargets.map(path => ({ path, action: "modify", instruction: userRequest })),
      newRoutes: [],
    };
  } else {
    onProgress?.("🧠 Analyse de ta demande…");
    try {
      plan = extractJSON(
        await aiText(
          EDIT_PLAN_SYSTEM,
          EDIT_PLAN_PROMPT(
            withQty(userRequest),
            files.map(f => {
              const isPage = /^src\/pages\/.+\.(tsx|jsx)$/.test(f.path);
              const route = routedPages.get(f.path);
              // Marque explicitement chaque page comme ROUTÉE (avec sa route
              // réelle) ou ORPHELINE (présente sur le disque mais jamais câblée
              // dans App.tsx → invisible pour l'utilisateur). Sans ce marqueur,
              // le planificateur devine au nom du fichier et peut cibler une
              // page orpheline (ex: Home.tsx) alors que la page vraiment
              // affichée à "/" est une autre (ex: Workspace.tsx) → l'édition
              // "réussit" côté IA mais reste invisible à l'écran.
              const routeTag = isPage
                ? (route !== undefined
                    ? `[ROUTE RÉELLE: "${route || "(reachable, no exact path match)"}"] `
                    : `[⚠️ ORPHELINE — AUCUNE route dans App.tsx ne pointe vers ce fichier, il n'est JAMAIS affiché à l'utilisateur. Ne le choisis QUE si l'utilisateur nomme ce fichier explicitement] `)
                : "";
              return {
                path: f.path,
                type: f.type || "file",
                // Petit extrait du contenu réel: sans ça le planificateur ne peut
                // que deviner le bon fichier d'après son NOM, et se trompe souvent
                // (ex: édite Home.tsx alors que l'élément visé est dans Header.tsx)
                // → l'IA "réussit" une édition qui ne change rien à l'écran.
                snippet: /\.(tsx|jsx)$/.test(f.path) ? `${routeTag}${String(f.content || "").slice(0, 400)}` : undefined,
              };
            }),
            lang,
            journalContext,
          ),
          3000,
          CHEAP_JSON_MODEL,
        ),
      );
    } catch {
      // Fallback: guess it's a whole-app tweak on the page ACTUALLY routed to
      // "/" (never blindly "Home.tsx" — that file may be an orphan never
      // wired into App.tsx, in which case the edit would be invisible).
      plan = { summary: userRequest, edits: [{ path: homeFile, action: "modify", instruction: userRequest }], newRoutes: [] };
    }
  }
  if (!plan.edits?.length) throw new Error("Aucune modification planifiée");
  // Safety net: if the planner (despite the ROUTE/ORPHELINE markers above)
  // still targeted a src/pages/*.tsx file that isn't wired into any route,
  // redirect that edit to the page actually routed to "/" instead of letting
  // it silently modify a file the user will never see.
  plan.edits = plan.edits.map(e => {
    const isPage = /^src\/pages\/.+\.(tsx|jsx)$/.test(e.path);
    const isOrphan = isPage && !routedPages.has(e.path) && fileMap.has(e.path);
    if (isOrphan && e.path !== homeFile) {
      return { ...e, path: homeFile };
    }
    return e;
  });
  // De-dup in case the redirect above created two edits for the same file.
  {
    const seen = new Set<string>();
    plan.edits = plan.edits.filter(e => (seen.has(e.path) ? false : (seen.add(e.path), true)));
  }
  onProgress?.(`📝 ${plan.summary}`);

  // 2. Rewrite each file SÉQUENTIELLEMENT (capé) pour que chaque tâche/étape
  //    apparaisse en TEMPS RÉEL dans le chat. En parallèle (Promise.all), tous
  //    les [CODE_START] partaient d'un coup puis tous les résultats retombaient
  //    quasi simultanément → l'utilisateur voyait tout arriver en rafale à la
  //    fin. En séquentiel, chaque fichier émet start → edit/done l'un après
  //    l'autre, ce qui reflète la progression réelle.
  const edits = plan.edits.slice(0, 8);
  const changed: ScaffoldFile[] = [];
  let lastFileError = "";
  for (let i = 0; i < edits.length; i++) {
    const e = edits[i];
    // Reveal the live code panel for this file in the chat UI.
    onProgress?.(`[CODE_START:${e.path}]`);
    onProgress?.(`✏️ Modification (${i + 1}/${edits.length}) : ${e.path}`);
    const current = fileMap.get(e.path) || "";
    const isModify = current.trim().length > 0 && e.action !== "create";
    // Normalized comparison used to detect a "false success": the model claims
    // it edited the file but actually returned the same content back (it didn't
    // find the target element, gave up silently, or hallucinated the change).
    const norm = (s: string) => s.replace(/\s+/g, " ").trim();
    try {
      let code = cleanCode(
        await aiCode(EDIT_FILE_SYSTEM_LEARNED, EDIT_FILE_PROMPT(e.path, current, withQty(e.instruction, current), design, lang), 16000, undefined, EDIT_MODEL),
      );
      if (code.length < 20) continue;

      // ── Garde-fou QUANTITÉ : on vérifie, on ne croit pas le modèle ────────
      // Il ajoute spontanément des éléments « pour faire joli ». On compte le
      // delta réel et on lui renvoie son dépassement chiffré. Une seule reprise
      // suffit en pratique ; si elle échoue aussi, on garde la MEILLEURE des
      // deux (celle qui dépasse le moins) plutôt qu'un lot inventé.
      if (qtyAsked !== null && isModify) {
        const over = addedItems(current, code);
        if (over > qtyAsked) {
          onProgress?.(`🔁 ${over} éléments ajoutés au lieu de ${qtyAsked} — je corrige.`);
          try {
            const fixInstruction = `${e.instruction}\n\n${overshootFeedback(over, qtyAsked, countListItems(current), lang)}`;
            const fixed = cleanCode(
              await aiCode(EDIT_FILE_SYSTEM_LEARNED, EDIT_FILE_PROMPT(e.path, current, withQty(fixInstruction, current), design, lang), 16000, undefined, EDIT_MODEL),
            );
            const fixedOver = addedItems(current, fixed);
            if (fixed.length >= 20 && fixedOver >= 1 && fixedOver < over) {
              code = fixed;
              if (fixedOver === qtyAsked) onProgress?.(`✅ Quantité respectée : ${qtyAsked} ajouté(s).`);
              else onProgress?.(`⚠️ ${fixedOver} ajouté(s) au lieu de ${qtyAsked} — dis-moi si tu veux que je supprime le surplus.`);
            } else {
              onProgress?.(`⚠️ ${over} éléments ajoutés alors que tu en demandais ${qtyAsked} — dis-moi si tu veux que je supprime le surplus.`);
            }
          } catch { /* on garde la première tentative */ }
        }
      }
      if (isModify && norm(code) === norm(current)) {
        // First attempt returned the file unchanged → this would be a false
        // "success" (chat says "done", preview shows nothing new). Retry once
        // with an explicit push to actually locate and change something.
        onProgress?.(`🔁 Aucun changement détecté dans ${e.path}, nouvelle tentative plus précise…`);
        const retryInstruction = `${e.instruction}\n\nATTENTION: ta tentative précédente a renvoyé le fichier EXACTEMENT identique — ce n'est PAS acceptable, l'utilisateur ne verrait AUCUN changement. Cherche plus loin (classes CSS, couleurs, images, composants importés) et modifie RÉELLEMENT quelque chose de visible qui correspond à la demande, même si ce n'est pas l'endroit exact attendu.`;
        try {
          const retryCode = cleanCode(
            await aiCode(EDIT_FILE_SYSTEM_LEARNED, EDIT_FILE_PROMPT(e.path, current, withQty(retryInstruction, current), design, lang), 16000, undefined, EDIT_MODEL),
          );
          if (retryCode.length >= 20 && norm(retryCode) !== norm(current)) code = retryCode;
        } catch { /* keep original (still identical) attempt below */ }
      }
      if (isModify && norm(code) === norm(current)) {
        // Still identical after retry → don't count this as a real change.
        // Better to report an honest failure than to claim success falsely.
        onProgress?.(`⚠️ Aucune modification réelle appliquée sur ${e.path}, fichier laissé inchangé.`);
        continue;
      }
      const cap = (s: string) => (s.length > 6000 ? s.slice(0, 6000) : s);
      const totalLines = code.split("\n").length;
      if (isModify) {
        // Modification of an existing file → emit OLD + NEW so the UI renders a
        // red/green line diff (removed lines red, added lines green below).
        onProgress?.(`[CODE_EDIT:${e.path}:${totalLines}:${code.length}]${cap(current)}${DIFF_SEP}${cap(code)}`);
      } else {
        // Brand-new file → scrolling all-green "write" reveal.
        onProgress?.(`[CODE_DONE:${e.path}:${totalLines}:${code.length}]${cap(code)}`);
      }
      // Apprentissage global sur l'édition aussi: on mesure l'état QA du
      // fichier réécrit pour continuer à renforcer les leçons.
      try {
        const editQA = analyzePage(e.path, code, {});
        void recordQAOutcome(editQA);
      } catch { /* best-effort */ }
      changed.push({ path: e.path, content: code });
    } catch (fileErr: any) {
      // [2026-09-10] On retient la dernière erreur réelle : si AUCUN fichier ne
      // passe (fournisseur IA en panne, quota, timeout), l'utilisateur voyait
      // seulement « Aucun fichier modifié », message qui l'envoyait reformuler
      // sa demande alors que le problème était ailleurs.
      lastFileError = fileErr?.message ? String(fileErr.message) : lastFileError;
    }
  }

  if (!changed.length) {
    throw new Error(lastFileError ? `Aucun fichier modifié (${lastFileError.slice(0, 200)})` : "Aucun fichier modifié");
  }

  // Même filet de sécurité IMAGES que generateApp(): une édition peut
  // introduire une clé IMAGES.xxx qui n'existe pas encore dans images.ts
  // (l'IA d'édition n'a pas de manifeste à sa disposition) → url(undefined),
  // rien ne s'affiche. On GÉNÈRE de vraies images pour ces clés (le dégradé
  // n'est qu'un ultime filet) plutôt que de laisser l'édition « réussir » avec
  // des cartes à fond plat.
  try {
    const existingImagesContent =
      changed.find(c => c.path === "src/lib/images.ts")?.content ?? fileMap.get("src/lib/images.ts") ?? "";
    const existingKeys = new Set<string>();
    const defRe = /"(\w+)":\s*"data:/g;
    let dm: RegExpExecArray | null;
    while ((dm = defRe.exec(existingImagesContent))) existingKeys.add(dm[1]);
    const usedKeys = new Set<string>();
    const useRe = /\bIMAGES\.(\w+)\b/g;
    for (const c of changed) {
      if (c.path === "src/lib/images.ts") continue;
      let um: RegExpExecArray | null;
      while ((um = useRe.exec(c.content))) usedKeys.add(um[1]);
    }
    const missingKeys = [...usedKeys].filter(k => !existingKeys.has(k));
    if (missingKeys.length) {
      onProgress?.(`🎨 ${missingKeys.length} visuel(s) manquant(s) après édition, génération…`);
      const extra = await generateMissingImages(
        missingKeys,
        { idea: userRequest },
        onProgress,
      );
      // Rebuild images.ts by inserting the new keys into the existing object
      // literal (cheap textual patch — avoids re-parsing/re-serializing the
      // whole, possibly huge, base64 manifest).
      const insertion = Object.entries(extra).map(([k, v]) => `  "${k}": ${JSON.stringify(v)},`).join("\n");
      let newImagesContent: string;
      if (/export const IMAGES: Record<string, string> = \{/.test(existingImagesContent)) {
        newImagesContent = existingImagesContent.replace(
          /export const IMAGES: Record<string, string> = \{/,
          `export const IMAGES: Record<string, string> = {\n${insertion}`,
        );
      } else {
        newImagesContent = IMAGES_TS(extra);
      }
      const idx = changed.findIndex(c => c.path === "src/lib/images.ts");
      if (idx >= 0) changed[idx] = { path: "src/lib/images.ts", content: newImagesContent };
      else changed.push({ path: "src/lib/images.ts", content: newImagesContent });
    }
  } catch { /* best-effort safety net, never block a successful edit on this */ }

  onProgress?.(`✅ ${changed.length} fichier(s) mis à jour`);

  return {
    summary: plan.summary || userRequest,
    changed,
    newRoutes: Array.isArray(plan.newRoutes) ? plan.newRoutes : [],
  };
}
