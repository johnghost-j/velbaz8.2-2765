/**
 * /test2 — VISUALISATION DU PLAN DE PAGES, PUIS SITE RECONSTRUIT D'APRÈS ELLE
 * ---------------------------------------------------------------------------
 * Ce module N'EST PAS un moteur de création. Le flux /test2 est le flux NORMAL
 * de l'app (questions → plan de pages → construction de la compagnie, mêmes
 * tâches, même design de liste) avec UNE seule chose en plus, insérée entre la
 * validation du plan de pages et le départ du build :
 *
 *   1. une image par page validée (maquette d'écran complète, interface et
 *      texte DANS l'image) — c'est la « visualisation du site » ;
 *   2. le relevé exact de chaque image (sections, chaînes au mot près,
 *      couleurs, positions) ;
 *   3. une plaque propre par page (même image, interface effacée) pour servir
 *      de fond bord à bord dans le site réel ;
 *   4. une spec écrite de façon DÉTERMINISTE (aucun modèle ne la résume) et
 *      enregistrée dans `genesis_runs.spec` pour la company : c'est le canal
 *      que le constructeur de site lit déjà (`chimeraAssetsFromBrief` +
 *      marqueurs [[CADRE-TRANSCRIT]] dans builder/engine.ts). Le build normal
 *      la récupère donc sans être modifié d'une ligne.
 *
 * Ce qui n'est PAS fait ici, volontairement (demande explicite de
 * l'utilisateur) : aucun appel à /genesis, /chimera ou /test1 — ni
 * `runChimera`, ni `runGenesisFlow`, ni `runTest1`. Pas de monde inventé, pas
 * de liste de pages décidée par un modèle, pas de tâches différentes. Seules
 * deux techniques bas niveau sont réutilisées (autorisation explicite de
 * l'utilisateur) : `transcribeFrame` (relevé d'une image rendue) et la
 * persistance d'assets sur disque.
 */

import { generateText } from "ai";
import { eq } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { gateway } from "./agent/gateway";
import { generateContentImage } from "./builder/images";
import { transcribeFrame } from "./chimera";
import { persistChimeraAsset } from "./chimera-assets";
import { db } from "./database/index";
import * as schema from "./database/schema";

const PLAN_MODEL = "openai/gpt-5.4-mini";
const CALL_TIMEOUT_MS = 180_000;

/** Pages visualisées au maximum sur un run (garde-fou de coût). */
export const TEST2_MAX_PAGES = 8;
/** Pages traitées en parallèle. */
const TEST2_CONCURRENCY = 3;

export interface Test2Page {
  name: string;
  purpose?: string;
}

export type Test2Event =
  | { type: "start"; runId: string; pages: number }
  | { type: "note"; text: string }
  | { type: "direction"; text: string }
  | { type: "frame"; n: number; name: string; url: string; relUrl: string }
  | { type: "transcribed"; n: number; name: string; chars: number }
  | { type: "done"; runId: string; images: { n: number; name: string; url: string; relUrl: string }[]; degraded: boolean; weaknesses: string[] }
  | { type: "error"; message: string };

export interface RunTest2VisualOptions {
  companyId: string;
  userId?: string;
  brandName: string;
  brief: string;
  industry?: string;
  pages: Test2Page[];
  emit: (e: Test2Event) => void;
  signal?: AbortSignal;
}

export interface Test2VisualResult {
  runId: string;
  spec: string;
  images: { n: number; name: string; url: string; relUrl: string }[];
  degraded: boolean;
  weaknesses: string[];
}

/** `/test2 mon idée` → { active: true, brief: "mon idée" } */
export function parseTest2Command(message: string): { active: boolean; brief: string } {
  const m = /^\s*\/test2\b[\s:]*/i.exec(String(message || ""));
  if (!m) return { active: false, brief: String(message || "").trim() };
  return { active: true, brief: String(message || "").slice(m[0].length).trim() };
}

export function stripTest2Prefix(message: string): string {
  return String(message || "").replace(/^\s*\/test2\b[\s:]*/i, "").trim();
}

function slugify(s: string): string {
  return String(s || "")
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "")
    .slice(0, 32) || "page";
}

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

function extractJson(raw: string): any {
  const fence = raw.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const body = fence ? fence[1] : raw;
  const start = body.indexOf("{");
  const end = body.lastIndexOf("}");
  if (start === -1 || end <= start) throw new Error("aucun JSON dans la sortie du modèle");
  const slice = body.slice(start, end + 1);
  try { return JSON.parse(slice); } catch { /* seconde chance */ }
  return JSON.parse(slice.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "").replace(/,(\s*[}\]])/g, "$1"));
}

// ── Direction visuelle + un prompt de maquette par page ─────────────────────
// Un SEUL appel texte : la direction (palette, typographie, registre) est
// commune à toutes les pages, sinon chaque image partirait dans son style et le
// site final serait incohérent.
const DIRECTION_SYSTEM = `Tu es directeur artistique de sites marchands haut de gamme. On te donne une
marque, son idée, et la LISTE EXACTE des pages de son site (déjà validée par le client : tu ne
l'ajoutes pas, tu ne l'enlèves pas, tu ne la réordonnes pas).

Tu produis (a) une direction visuelle unique, (b) UN prompt de génération d'image par page. Chaque
prompt décrit une CAPTURE D'ÉCRAN complète de cette page, vue de dessus, à plat, comme si le site
existait déjà : interface et texte DESSINÉS DANS L'IMAGE.

NIVEAU ATTENDU : site primé, éditorial, luxueux et sobre. Grande typographie, beaucoup d'air,
grille nette, photographie réelle et léchée, contraste maîtrisé. Rien de générique, rien de
« template bootstrap », aucun dégradé violet SaaS, aucune illustration plate corporate, aucune
mascotte, aucun emoji, aucun texte pseudo-latin.

RÈGLES DURES POUR CHAQUE PROMPT :
- Écris-le en ANGLAIS (le générateur d'images travaille mieux), 120 à 200 mots, en une seule
  chaîne, sans retour à la ligne.
- Commence par « Full-page website screenshot of ... », précise la page et son rôle.
- Décris de haut en bas : barre de navigation (avec les libellés réels), section principale,
  sections suivantes, pied de page. Nomme les vraies chaînes de texte, courtes et crédibles,
  écrites dans la langue de la marque.
- Impose la MÊME palette (#hex), la MÊME famille typographique, les MÊMES rayons et le MÊME style
  de bouton que la direction, sur toutes les pages.
- Limite le texte : 12 à 22 chaînes courtes par page maximum, sinon les lettres se déforment.
- Lumineux, de jour, lisible. Pas de fond quasi noir, pas de scène nocturne.
- Interface bord à bord : elle remplit le cadre, elle n'est pas une fenêtre de navigateur posée sur
  un bureau, pas de mockup de MacBook, pas de main qui tient un téléphone, pas d'ombre de maquette.

SORTIE : JSON strict, rien autour.
{
  "direction": {
    "summary": "3-4 phrases de direction artistique, en français",
    "palette": [{"hex": "#…", "role": "fond | encre | accent | secondaire"}],
    "typography": {"display": "famille apparente", "body": "famille apparente", "scale": "rapport titre/corps"},
    "radius_px": 0,
    "button": "description courte du bouton (forme, remplissage, couleur)",
    "photography": "sujet et traitement des photos"
  },
  "pages": [
    {"name": "nom EXACT de la page reçue", "role": "hero | liste | fiche | éditorial | contact | légal | autre", "prompt": "…", "text_budget": 18}
  ]
}`;

const RENDER_GUARD =
  " Rendered as a flat full-bleed web page screenshot, edge to edge, no browser window, no device" +
  " frame, no desktop background, no drop shadow around the page, no watermark, no annotation," +
  " no cursor. Text must be crisp, correctly spelled and horizontally aligned.";

const STRIP_UI_PROMPT =
  "Remove every text, button, navigation bar, logo, chip, price label and interface element from" +
  " this image. Keep everything else strictly unchanged — same subject, same framing, same light," +
  " same colours, same composition. Fill where the interface was with a plausible continuation of" +
  " the scene. No text anywhere, no letter, no number, no watermark.";

interface Frame {
  n: number;
  name: string;
  purpose: string;
  slug: string;
  role: string;
  prompt: string;
  budget: number;
  uiDataUrl?: string;
  uiUrl?: string;
  uiRelUrl?: string;
  cleanUrl?: string;
  transcript?: string;
}

export async function runTest2Visual(opts: RunTest2VisualOptions): Promise<Test2VisualResult> {
  const runId = `test2-${randomUUID().slice(0, 8)}`;
  const { emit } = opts;
  const weaknesses: string[] = [];
  let degraded = false;
  const t0 = Date.now();

  const pages = (opts.pages || [])
    .map(p => ({ name: String(p?.name || "").trim(), purpose: String(p?.purpose || "").trim() }))
    .filter(p => p.name.length > 0)
    .slice(0, TEST2_MAX_PAGES);
  if (!pages.length) throw new Error("aucune page à visualiser");

  emit({ type: "start", runId, pages: pages.length });

  const runRow = {
    id: runId,
    userId: opts.userId || null,
    sessionId: opts.companyId,
    brief: `/test2 — ${opts.brief}`.slice(0, 2000),
    status: "running",
  };
  await db.insert(schema.genesisRuns).values(runRow as any).catch((e: any) =>
    console.warn("[test2] insert genesis_runs KO (non bloquant):", String(e?.message || e).slice(0, 160)));

  // ── 1. Direction visuelle + prompts ───────────────────────────────────────
  emit({ type: "note", text: `Direction visuelle et cadrage des ${pages.length} page(s).` });
  const raw = await generateText({
    model: gateway(PLAN_MODEL),
    system: DIRECTION_SYSTEM,
    prompt: `MARQUE : ${opts.brandName}
IDÉE : ${opts.brief}${opts.industry ? `\nSECTEUR : ${opts.industry}` : ""}

PAGES VALIDÉES PAR LE CLIENT (${pages.length}) — liste exacte, dans cet ordre :
${pages.map((p, i) => `${i + 1}. ${p.name}${p.purpose ? ` — ${p.purpose}` : ""}`).join("\n")}

Donne la direction et un prompt par page, dans le même ordre.`,
    maxOutputTokens: 6000,
    temperature: 0.6,
    maxRetries: 1,
    abortSignal: AbortSignal.timeout(CALL_TIMEOUT_MS),
  }).then(r => (r.text || "").trim());

  let plan: any;
  try { plan = extractJson(raw); } catch (e) {
    throw new Error(`la direction visuelle est illisible : ${(e as Error).message}`);
  }
  const direction = plan?.direction || {};
  const planPages: any[] = Array.isArray(plan?.pages) ? plan.pages : [];
  if (!planPages.length) throw new Error("le modèle n'a renvoyé aucun prompt de page");

  const norm = (s: string) => String(s || "").toLowerCase().trim();
  const frames: Frame[] = pages.map((p, i) => {
    const match = planPages.find(pp => norm(pp?.name) === norm(p.name)) || planPages[i] || {};
    return {
      n: i + 1,
      name: p.name,
      purpose: p.purpose,
      slug: slugify(p.name),
      role: String(match?.role || (i === 0 ? "hero" : "autre")),
      prompt: String(match?.prompt || "").trim(),
      budget: Number.isFinite(Number(match?.text_budget)) ? Number(match.text_budget) : 18,
    };
  });
  const missing = frames.filter(f => f.prompt.length < 60);
  if (missing.length) {
    degraded = true;
    weaknesses.push(`prompt de maquette manquant pour : ${missing.map(f => f.name).join(", ")} — ces pages ne seront pas visualisées.`);
  }
  const directionText = [
    direction?.summary ? String(direction.summary) : "",
    Array.isArray(direction?.palette) ? `Palette : ${direction.palette.map((c: any) => `${c?.hex} (${c?.role})`).join(", ")}` : "",
    direction?.typography ? `Typographie : ${direction.typography.display} / ${direction.typography.body} — ${direction.typography.scale}` : "",
    direction?.radius_px !== undefined ? `Rayons : ${direction.radius_px} px` : "",
    direction?.button ? `Boutons : ${direction.button}` : "",
    direction?.photography ? `Photographie : ${direction.photography}` : "",
  ].filter(Boolean).join("\n");
  if (directionText) emit({ type: "direction", text: directionText });

  // ── 2. Une maquette d'écran par page ──────────────────────────────────────
  const targets = frames.filter(f => f.prompt.length >= 60);
  const renderOne = async (f: Frame) => {
    if (opts.signal?.aborted) throw new Error("run annulé");
    try {
      const url = await generateContentImage(f.prompt + RENDER_GUARD, "wide", 1920, { allowText: true });
      if (!url) throw new Error("le générateur n'a renvoyé aucune image");
      f.uiDataUrl = url;
      const saved = await persistChimeraAsset(runId, `${pad(f.n)}-${f.slug}-ui`, url);
      if (!saved) throw new Error("image non enregistrée sur le serveur");
      f.uiUrl = saved.url;
      f.uiRelUrl = saved.relUrl;
      emit({ type: "frame", n: f.n, name: f.name, url: saved.url, relUrl: saved.relUrl });
    } catch (e) {
      degraded = true;
      weaknesses.push(`page « ${f.name} » : visualisation impossible (${(e as Error).message}).`);
      emit({ type: "note", text: `⚠️ Page « ${f.name} » : visualisation impossible — ${(e as Error).message}` });
    }
  };
  for (let i = 0; i < targets.length; i += TEST2_CONCURRENCY) {
    const wave = targets.slice(i, i + TEST2_CONCURRENCY);
    emit({ type: "note", text: `Visualisation des pages ${wave.map(f => f.name).join(", ")}.` });
    await Promise.all(wave.map(renderOne));
  }

  const rendered = frames.filter(f => f.uiDataUrl && f.uiUrl);
  if (!rendered.length) throw new Error("aucune page n'a pu être visualisée");

  // ── 3. Relevé exact de chaque image rendue (le code se écrit d'après ça) ──
  // C'est cette étape qui « décompose » les images : sections, chaînes au mot
  // près, positions, couleurs. Elle fait loi devant le prompt.
  const transcribeOne = async (f: Frame) => {
    if (opts.signal?.aborted) throw new Error("run annulé");
    const t = await transcribeFrame(f.uiDataUrl!, { brandName: opts.brandName, pageName: f.name, role: f.role });
    if (t && t.length > 400) {
      f.transcript = t;
      emit({ type: "transcribed", n: f.n, name: f.name, chars: t.length });
    } else {
      degraded = true;
      weaknesses.push(`page « ${f.name} » : relevé de l'image ${t ? "trop court" : "impossible"} — elle sera écrite d'après le prompt, pas d'après son image.`);
      emit({ type: "note", text: `⚠️ Page « ${f.name} » : impossible de relever l'image — reconstruction non garantie.` });
    }
  };
  emit({ type: "note", text: `Décomposition des ${rendered.length} image(s) — le code sera écrit d'après l'image, pas d'après le texte.` });
  for (let i = 0; i < rendered.length; i += TEST2_CONCURRENCY) {
    await Promise.all(rendered.slice(i, i + TEST2_CONCURRENCY).map(transcribeOne));
  }

  // ── 4. Plaque propre par page (interface effacée) = fond bord à bord ──────
  const stripOne = async (f: Frame) => {
    if (opts.signal?.aborted) throw new Error("run annulé");
    try {
      const clean = await generateContentImage(STRIP_UI_PROMPT, "wide", 1920, { refImages: [f.uiDataUrl!] });
      if (!clean) throw new Error("plaque non produite");
      const saved = await persistChimeraAsset(runId, `${pad(f.n)}-${f.slug}-clean`, clean);
      if (!saved) throw new Error("plaque non enregistrée");
      f.cleanUrl = saved.url;
    } catch (e) {
      degraded = true;
      weaknesses.push(`page « ${f.name} » : pas de plaque de fond (${(e as Error).message}) — la section utilisera les couleurs relevées au lieu de l'image.`);
    }
  };
  emit({ type: "note", text: "Extraction des fonds des images (interface retirée)." });
  for (let i = 0; i < rendered.length; i += TEST2_CONCURRENCY) {
    await Promise.all(rendered.slice(i, i + TEST2_CONCURRENCY).map(stripOne));
  }

  // ── 5. Spec DÉTERMINISTE (aucun modèle ne la résume) ─────────────────────
  const assetIndex = rendered.flatMap(f => [
    f.uiUrl ? `- référence d'écran de la page « ${f.name} » (à reproduire, JAMAIS à afficher) → ${f.uiUrl}` : "",
    f.cleanUrl ? `- plaque de fond de la page « ${f.name} » (fond bord à bord) → ${f.cleanUrl}` : "",
  ].filter(Boolean)).join("\n");

  const routeOf = (f: Frame) => (f.n === 1 || f.role === "hero" ? "/" : `/${f.slug}`);

  const spec = `SITE CONSTRUIT D'APRÈS SES PROPRES MAQUETTES (/test2)
Chaque page du plan validé a été visualisée : une maquette d'écran complète a été rendue, puis
relevée au mot près. Le site doit reproduire ces maquettes à l'identique en VRAI HTML/React —
mêmes sections dans le même ordre, mêmes chaînes, mêmes positions, mêmes couleurs, même échelle
typographique. Ce n'est pas une inspiration : c'est un plan de reconstruction.

MARQUE : ${opts.brandName}
IDÉE : ${opts.brief}

DIRECTION VISUELLE VERROUILLÉE — S'APPLIQUE À TOUTES LES PAGES, AUCUNE DÉRIVE
${directionText || "(direction non relevée — s'aligner sur le relevé de la première page)"}

PAGES ET ROUTES
${rendered.map(f => `- ${f.name} → ${routeOf(f)}${f.purpose ? ` (${f.purpose})` : ""}`).join("\n")}

RÈGLE DE COMPOSITION NON NÉGOCIABLE
Une section se compose de sa plaque de fond posée bord à bord (\`absolute inset-0 w-full h-full
object-cover\`), puis de VRAI texte et de VRAIS contrôles HTML par-dessus. Une maquette n'est
JAMAIS livrée comme une capture affichée : tout ce qui est dessiné dedans (lien, chip, prix,
bouton, compteur) existe comme élément vivant, cliquable, en HTML.

---

ASSETS RÉELS DU RUN — URLS À UTILISER TELLES QUELLES (aucune autre image n'est autorisée)
Ces fichiers existent sur le serveur et se chargent en HTTP. Recopie les chemins exactement.

${assetIndex || "- (aucun asset enregistré)"}

RÈGLES D'EMPLOI :
- Une « plaque de fond » se pose en fond bord à bord (full-bleed) de sa section.
- Une « référence d'écran » (…-ui) ne s'affiche JAMAIS dans le site : elle sert uniquement à
  reproduire la mise en page, les textes et les positions en vrai HTML.
- Aucun placeholder, aucune image de stock, aucune URL inventée.

---

RELEVÉS DES PAGES RENDUES — LE SITE SE RECONSTRUIT D'APRÈS EUX
Chaque bloc ci-dessous décrit ce qui est RÉELLEMENT dessiné sur la page correspondante.
C'est la référence : mêmes sections dans le même ordre, mêmes chaînes au mot près, mêmes
positions, mêmes couleurs.

${rendered.filter(f => f.transcript).map(f =>
    `[[CADRE-TRANSCRIT route=${routeOf(f)} nom=${f.name} cadre=${f.n}]]\n${f.transcript}\n[[/CADRE-TRANSCRIT]]`,
  ).join("\n\n")}
${degraded ? `\n---\n\nRÉSERVES DU RUN (à compenser dans le code, pas à ignorer) :\n- ${weaknesses.join("\n- ")}\n` : ""}`;

  const images = rendered.map(f => ({
    n: f.n,
    name: f.name,
    url: f.uiUrl!,
    relUrl: f.uiRelUrl || f.uiUrl!.replace(/^https?:\/\/[^/]+/, ""),
  }));

  await db.update(schema.genesisRuns)
    .set({
      status: "done",
      spec,
      degraded,
      weaknesses: weaknesses.length ? JSON.stringify(weaknesses) : null,
      durationMs: Date.now() - t0,
    } as any)
    .where(eq(schema.genesisRuns.id, runId))
    .catch((e: any) => console.warn("[test2] update genesis_runs KO:", String(e?.message || e).slice(0, 160)));

  emit({ type: "done", runId, images, degraded, weaknesses });
  return { runId, spec, images, degraded, weaknesses };
}
