// ─── /test — banc d'essai isolé ──────────────────────────────────────────────
// Implémente le protocole générique en 5 phases (bible du monde → cadres avec
// interface → chaîne de découpe à TROIS maillons → composition en vrai HTML →
// livraison). Il produit un PROJET MIBON STANDARD : même dossier que n'importe
// quel projet généré, runner standard, port standard, proxy de preview standard.
//
// ISOLATION — l'isolation porte sur la DÉCISION, pas sur l'exécution.
// Ce module n'importe RIEN de : engine.ts, images.ts, chimera.ts, genesis.ts,
// chimera-assets.ts. Ce qui doit être partagé (modèles, appel image) est
// RECOPIÉ ici volontairement. Ce qui est de l'exécution pure (scaffold, runner,
// preview-routes, qa, live-qa) est IMPORTÉ normalement, jamais recopié.
//
// RÈGLE DURE : aucun timer de secours, aucune reprise automatique, aucun repli
// silencieux. Quand une étape casse, elle jette avec la cause réelle.

import { spawn } from "node:child_process";
import { mkdir, writeFile, readFile, stat } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { generateText } from "ai";
import { importOptional } from "./lib/optional-import";
import { gateway } from "./agent/gateway";
import { buildScaffold, type AppMeta, type ScaffoldFile } from "./builder/scaffold";
import {
  writeFilesToDisk,
  writeFilesIncremental,
  installDeps,
  ensureRequiredDeps,
  buildWithAutoFix,
  startDevServer,
} from "./builder/runner";
import { runLiveQAAndFix, type LiveQAPlan } from "./builder/live-qa";

// ── Modèles — RECOPIÉS depuis chimera.ts l.37-43, jamais importés ────────────
const THINK_MODEL = "openai/gpt-5.4-mini";
const VISION_MODEL = "anthropic/claude-sonnet-4.6";
// [2026-09-09] Nano Banana 2 Lite (~0,034 $/image) au lieu de 3-pro-image
// (0,24 $/image en 4K) — demande explicite du propriétaire.
const IMAGE_MODEL = "google/gemini-3.1-flash-lite-image";

// ── Événements ───────────────────────────────────────────────────────────────
export type TestEvent =
  | { type: "start"; runId: string; category: string }
  | { type: "note"; message: string }
  | { type: "phase_done"; title: string; ms: number }
  | { type: "error"; message: string }
  | {
      type: "done";
      runId: string;
      companyId: string;
      dir: string;
      previewUrl: string;
      port: number;
      durationMs: number;
    };

export type Emit = (e: TestEvent) => void;

// ─────────────────────────────────────────────────────────────────────────────
// Outils bas niveau
// ─────────────────────────────────────────────────────────────────────────────

/** Lance une commande. Rejette avec stderr RÉEL si le code de sortie n'est pas 0.
 *  Pas de timeout de secours : si ça pend, ça se voit. */
function sh(cmd: string, args: string[], cwd?: string): Promise<string> {
  return new Promise((resolve, reject) => {
    // `any` assume : les typings Node de ce depot sont tronques (meme cause que
    // les `process.on` deja en erreur ailleurs), pas un contournement de logique.
    const p: any = spawn(cmd, args, { cwd, stdio: ["ignore", "pipe", "pipe"] });
    let out = "";
    let err = "";
    p.stdout.on("data", (d: Buffer) => (out += d.toString()));
    p.stderr.on("data", (d: Buffer) => (err += d.toString()));
    p.on("error", (e: any) => reject(new Error(`${cmd} introuvable ou non lançable : ${e?.message || e}`)));
    p.on("close", (code: number | null) => {
      if (code === 0) resolve(out);
      else reject(new Error(`${cmd} ${args.join(" ")} → code ${code}\n${err.trim() || out.trim()}`));
    });
  });
}

/** Appel texte. Jette si la réponse est vide — on ne continue jamais sur du vide. */
async function ask(model: string, system: string, prompt: string): Promise<string> {
  const r = await generateText({ model: gateway(model), system, prompt } as any);
  const text = (r.text || "").trim();
  if (!text) throw new Error(`${model} a renvoyé une réponse vide`);
  return text;
}

/** Appel texte attendu en JSON. Jette avec le texte reçu quand ce n'est pas du JSON. */
async function askJson<T>(model: string, system: string, prompt: string): Promise<T> {
  const raw = await ask(model, `${system}\n\nRéponds UNIQUEMENT en JSON valide, sans bloc de code.`, prompt);
  const first = raw.indexOf("{");
  const last = raw.lastIndexOf("}");
  if (first === -1 || last <= first) {
    throw new Error(`Réponse non-JSON de ${model} :\n${raw.slice(0, 800)}`);
  }
  try {
    return JSON.parse(raw.slice(first, last + 1)) as T;
  } catch (e: any) {
    throw new Error(`JSON invalide de ${model} (${e.message}) :\n${raw.slice(first, first + 800)}`);
  }
}

/** Génère une image et l'écrit en PNG. RECOPIE du mécanisme de images.ts l.77-93.
 *  `refs` = images de référence en base64 brut : c'est ce qui rend chaque maillon
 *  de la chaîne de découpe ALIGNÉ AU PIXEL sur le précédent. */
async function genImage(prompt: string, outPng: string, refs: Buffer[] = []): Promise<void> {
  const result = await generateText({
    model: gateway(IMAGE_MODEL),
    ...(refs.length
      ? {
          messages: [
            {
              role: "user" as const,
              content: [
                { type: "text" as const, text: prompt },
                ...refs.map((b) => ({ type: "image" as const, image: b })),
              ],
            },
          ],
        }
      : { prompt }),
    providerOptions: { gateway: { response_modalities: ["IMAGE"] } },
  } as any);
  const file = (result as any).files?.[0];
  if (!file?.base64) {
    throw new Error(
      `Aucune image renvoyée par ${IMAGE_MODEL}. Texte du modèle : ${((result as any).text || "(vide)").slice(0, 400)}`,
    );
  }
  await writeFile(outPng, Buffer.from(file.base64, "base64"));
}

async function sizeOf(file: string): Promise<number> {
  return (await stat(file)).size;
}

// ─────────────────────────────────────────────────────────────────────────────
// PHASE 1 — la bible du monde
// ─────────────────────────────────────────────────────────────────────────────

export interface WorldPage {
  /** identifiant de fichier, ex "01-accueil" */
  id: string;
  name: string;
  route: string;
  /** ce que la page doit contenir, en clair */
  intent: string;
  /** volume de texte attendu dans le cadre (accueil 8, scroll 16-20, produit 12, lookbook 3) */
  textStrings: number;
}

export interface WorldBible {
  brandName: string;
  tagline: string;
  currency: string;
  brokenLaw: string;
  lightName: string;
  placeName: string;
  register: string;
  palette: string[];
  /** LA phrase de direction artistique, réutilisée MOT POUR MOT dans tous les prompts. */
  artDirection: string;
  productNoun: string;
  copyDeck: Record<string, string[]>;
  pages: WorldPage[];
  /** les six produits de la planche de collection */
  products: Array<{ name: string; price: number; blurb: string }>;
  /** déclinaisons vendues — déclarées UNE FOIS ici, jamais réinventées par page */
  sizes: string[];
  shades: Array<{ name: string; hex: string }>;
}

const FORBIDDEN = ["Lumina", "Aether", "Nova", "Elysian", "Zenith", "Vertex", "Solace", "Eldoria", "Arcanum"];

const BIBLE_SYSTEM = `Tu es directeur de création. Tu inventes un MONDE, pas une charte graphique.

RÈGLES NON NÉGOCIABLES
1. Nom de marque INVENTÉ. Interdits absolus : ${FORBIDDEN.join(", ")}. Aucun mot anglais générique de startup.
2. UNE SEULE loi physique/sociale brisée, construite À REBOURS du métier banal du produit.
   Elle doit rendre le métier étrange, pas décorer autour.
3. La lumière est NOMMÉE (un nom propre inventé). Jamais "le soleil", jamais "la lumière naturelle".
4. Le lieu est BÂTI par quelqu'un (atelier, halle, arche, fonderie...). Jamais un paysage naturel.
5. Registre de langue choisi et tenu, qui ARGUMENTE CONTRE la catégorie
   (ex: pour du sport, un registre liturgique ; pour du luxe, un registre d'ingénieur).
6. Palette de 4 à 5 couleurs hex CLAIRES ET SATURÉES. Test : si elle survit en noir et blanc, elle est morte.
7. artDirection = UNE phrase de direction artistique, dense, qui sera recopiée MOT POUR MOT
   dans absolument tous les prompts d'image. Elle fixe le rendu, pas le sujet.
8. Le copy deck est écrit MAINTENANT, avant toute image.
9. Prix en nombres entiers, dans la devise inventée du monde (champ currency = son symbole ou son nom court).
10. Les déclinaisons vendues (tailles, teintes) sont déclarées UNE SEULE FOIS, ici, dans le registre du monde.
    Les teintes portent un nom du monde et un hex PRIS DANS LA PALETTE. Elles sont le seul vocabulaire de vente du site.`;

async function phase1Bible(category: string, emit: Emit): Promise<WorldBible> {
  const bible = await askJson<WorldBible>(
    THINK_MODEL,
    BIBLE_SYSTEM,
    `Catégorie de produit : « ${category} ».

Construis la bible du monde et rends exactement cette forme JSON :
{
  "brandName": string,
  "tagline": string,
  "currency": string,
  "brokenLaw": string,
  "lightName": string,
  "placeName": string,
  "register": string,
  "palette": [string, string, string, string],
  "artDirection": string,
  "productNoun": string,
  "copyDeck": { "accueil": string[], "produit": string[], "collection": string[], "commande": string[] },
  "pages": [
    { "id": "01-accueil",    "name": string, "route": "/",            "intent": string, "textStrings": 8 },
    { "id": "02-collection", "name": string, "route": "/collection",  "intent": "planche de six ${category} différents, grille régulière 3 colonnes x 2 rangées", "textStrings": 16 },
    { "id": "03-produit",    "name": string, "route": "/produit",     "intent": string, "textStrings": 12 },
    { "id": "04-commande",   "name": string, "route": "/commande",    "intent": "tunnel d'achat : récapitulatif, coordonnées, paiement, numéro de commande", "textStrings": 12 }
  ],
  "products": [ six objets { "name": string, "price": number, "blurb": string } ],
  "sizes": [ 3 à 5 tailles, chaînes courtes, dans le registre du monde ],
  "shades": [ 3 à 5 objets { "name": string, "hex": string } — hex pris dans la palette ]
}`,
  );

  // Garde-fous vérifiables — on jette plutôt que de livrer un monde mort.
  const hit = FORBIDDEN.find((f) => bible.brandName?.toLowerCase().includes(f.toLowerCase()));
  if (hit) throw new Error(`Nom de marque interdit renvoyé par le modèle : « ${bible.brandName} » contient « ${hit} »`);
  if (!bible.palette || bible.palette.length < 4) {
    throw new Error(`Palette insuffisante : ${JSON.stringify(bible.palette)} (4 minimum)`);
  }
  if (!bible.artDirection) throw new Error("artDirection manquante : les prompts ne seraient pas cohérents entre eux");
  if (!bible.products || bible.products.length !== 6) {
    throw new Error(`Il faut exactement 6 produits pour la planche 3x2, reçu ${bible.products?.length ?? 0}`);
  }
  if (!bible.pages || bible.pages.length !== 4) {
    throw new Error(`Il faut exactement 4 pages, reçu ${bible.pages?.length ?? 0}`);
  }
  // Le catalogue est l'ancre de réalité du commerce : sans déclinaisons déclarées
  // ici, chaque page réinventerait ses tailles et ses teintes dans son coin.
  if (!bible.sizes || bible.sizes.length < 3) {
    throw new Error(`Tailles manquantes ou insuffisantes : ${JSON.stringify(bible.sizes)} (3 minimum)`);
  }
  if (!bible.shades || bible.shades.length < 3 || bible.shades.some((t) => !t?.name || !t?.hex)) {
    throw new Error(`Teintes manquantes ou incomplètes : ${JSON.stringify(bible.shades)} (3 minimum, name + hex)`);
  }
  if (bible.products.some((p) => typeof p?.price !== "number" || !(p.price > 0))) {
    throw new Error(`Prix produit invalide : ${JSON.stringify(bible.products.map((p) => p?.price))}`);
  }

  emit({
    type: "note",
    message: `Monde « ${bible.brandName} » — loi brisée : ${bible.brokenLaw} · lumière « ${bible.lightName} » · lieu « ${bible.placeName} » · palette ${bible.palette.join(" ")}`,
  });
  return bible;
}

// ─────────────────────────────────────────────────────────────────────────────
// PHASE 2 — les cadres, INTERFACE COMPRISE
// ─────────────────────────────────────────────────────────────────────────────
// Une image par page, 16:9, avec nav / boutons / prix / textes DÉJÀ DEDANS.
// Jamais une illustration nue qu'on légenderait après.

function framePrompt(bible: WorldBible, page: WorldPage): string {
  const copy = bible.copyDeck[page.id.replace(/^\d+-/, "")] || [];
  return [
    `Frame: full-bleed 16:9 web page screenshot, edge to edge, no browser chrome, no device mockup.`,
    `Direction artistique: ${bible.artDirection}`,
    `Loi du monde: ${bible.brokenLaw}. Cette loi doit être VISIBLE dans l'image, pas suggérée.`,
    `Produit & matière: ${bible.productNoun}, rendu avec sa matière réelle, net et lisible.`,
    `Lumière: « ${bible.lightName} », lumière nommée propre à ce monde. Jamais de soleil, jamais de lumière naturelle générique.`,
    `Lieu: « ${bible.placeName} », un lieu BÂTI, jamais un paysage naturel.`,
    `Réserve de composition: garde des zones calmes et unies où du texte pourra être posé.`,
    `Palette stricte, uniquement ces couleurs: ${bible.palette.join(", ")}. Couleurs claires et saturées.`,
    `Interface: la page contient DÉJÀ son interface — barre de navigation en haut, boutons, prix, étiquettes, titres.`,
    `Environ ${page.textStrings} chaînes de texte lisibles au total.`,
    copy.length ? `Textes à faire figurer: ${copy.join(" · ")}` : "",
    `Contenu de la page: ${page.intent}`,
    `Registre de langue: ${bible.register}. Prix affichés en ${bible.currency}.`,
    `Rendu: photoréaliste, éclairage cohérent, très haute qualité éditoriale.`,
  ]
    .filter(Boolean)
    .join("\n");
}

async function phase2Frames(bible: WorldBible, dir: string, emit: Emit): Promise<Record<string, string>> {
  const frames: Record<string, string> = {};
  for (const page of bible.pages) {
    const out = path.join(dir, `${page.id}-ui.png`);
    await genImage(framePrompt(bible, page), out);
    frames[page.id] = out;
    emit({ type: "note", message: `cadre ${page.id}-ui.png — ${(await sizeOf(out) / 1024).toFixed(0)} Ko` });
  }
  return frames;
}

// ─────────────────────────────────────────────────────────────────────────────
// PHASE 3 — découper. LA CHAÎNE FAIT TROIS MAILLONS.
// ─────────────────────────────────────────────────────────────────────────────
//   -ui  →  (retirer l'interface)  →  -clean  →  (retirer le produit)  →  background
// Chaque maillon dérive du PRÉCÉDENT (passé en image de référence) : les trois
// restent alignés au pixel, donc le détourage se repose exactement où il était.
// C'est précisément le maillon manquant qui a tout cassé les fois d'avant :
// une plaque `-clean` n'est PAS une plaque de fond, le produit est encore dedans.

async function chainToBackground(bible: WorldBible, uiPng: string, base: string, emit: Emit): Promise<{ clean: string; background: string }> {
  const uiBuf = await readFile(uiPng);

  // Maillon 2 : on retire l'interface, on garde la scène ET le produit.
  const clean = `${base}-clean.png`;
  await genImage(
    [
      `Reprends EXACTEMENT cette image, au pixel près : même cadrage, même perspective, même lumière, même position du produit.`,
      `Direction artistique: ${bible.artDirection}`,
      `SEUL changement: retire toute l'interface — barre de navigation, boutons, prix, étiquettes, tout le texte.`,
      `Répare proprement la scène là où l'interface se trouvait. Ne déplace rien d'autre. Ne recadre pas.`,
    ].join("\n"),
    clean,
    [uiBuf],
  );

  // Maillon 3 : on EFFACE le produit et on répare la scène derrière lui.
  // C'est ça, la vraie plaque de fond : elle ne contient plus aucune tache en
  // forme de produit, puisque le détourage viendra se reposer par-dessus.
  const background = `${base}-background.png`;
  await genImage(
    [
      `Reprends EXACTEMENT cette image, au pixel près : même cadrage, même perspective, même lumière.`,
      `Direction artistique: ${bible.artDirection}`,
      `SEUL changement: EFFACE complètement ${bible.productNoun} de la scène.`,
      `Reconstruis ce qui se trouvait DERRIÈRE lui : le sol, le mur, les reflets, les ombres portées disparaissent avec lui.`,
      `Le résultat doit être une scène vide, plausible, sans aucune trace ni silhouette ni tache en forme de produit.`,
      `Ne recadre pas, ne change pas la lumière.`,
    ].join("\n"),
    background,
    [await readFile(clean)],
  );

  emit({
    type: "note",
    message: `chaîne 3 maillons ${path.basename(base)} : ui → clean (${(await sizeOf(clean) / 1024).toFixed(0)} Ko) → background (${(await sizeOf(background) / 1024).toFixed(0)} Ko)`,
  });
  return { clean, background };
}

/** UNE génération → SIX assets.
 *  La planche de collection est prompteée exprès en grille régulière 3x2. On la
 *  lit avec le modèle de vision pour obtenir les VRAIES coordonnées (jamais une
 *  devinette), on recadre, puis on détoure chaque case. */
async function sliceSixProducts(gridPng: string, dir: string, emit: Emit): Promise<string[]> {
  const dims = (await sh("identify", ["-format", "%w %h", gridPng])).trim().split(/\s+/).map(Number);
  const [W, H] = dims;
  if (!W || !H) throw new Error(`Dimensions illisibles pour ${gridPng} : « ${dims.join(" ")} »`);

  const boxes = await askJson<{ boxes: Array<{ x: number; y: number; w: number; h: number }> }>(
    VISION_MODEL,
    "Tu lis une planche produit et tu rends des coordonnées de recadrage exactes.",
    `Cette planche fait ${W}x${H} pixels et contient six produits disposés en grille 3 colonnes x 2 rangées.
Rends les six boîtes englobantes, dans l'ordre de lecture (gauche→droite, haut→bas), chacune serrée autour d'un produit
mais SANS le couper. Forme : {"boxes":[{"x":0,"y":0,"w":0,"h":0}, ... six au total]} en pixels entiers.`,
  );
  if (boxes.boxes?.length !== 6) {
    throw new Error(`La lecture de la planche a rendu ${boxes.boxes?.length ?? 0} boîtes au lieu de 6`);
  }

  const cutouts: string[] = [];
  for (let i = 0; i < 6; i++) {
    const b = boxes.boxes[i];
    if (b.x < 0 || b.y < 0 || b.x + b.w > W || b.y + b.h > H || b.w <= 0 || b.h <= 0) {
      throw new Error(`Boîte ${i + 1} hors de la planche ${W}x${H} : ${JSON.stringify(b)}`);
    }
    const tile = path.join(dir, `tile-${i + 1}.png`);
    const cut = path.join(dir, `product-${i + 1}.png`);
    await sh("convert", [gridPng, "-crop", `${b.w}x${b.h}+${b.x}+${b.y}`, "+repage", tile]);
    await sh("remove-background", [tile, "-o", cut]);
    await sh("convert", [cut, "-trim", "+repage", cut]);
    cutouts.push(cut);
  }

  // Planche de contrôle sur fond GRIS : sur blanc un halo blanc est invisible.
  await sh("montage", [...cutouts, "-tile", "3x2", "-geometry", "+6+6", "-background", "#dddddd", path.join(dir, "check-cutouts.png")]);
  emit({ type: "note", message: `six détourages issus d'UNE seule génération + planche de contrôle sur fond gris` });
  return cutouts;
}

/** Compression aux budgets du manuel : < 400 Ko par fond, < 250 Ko par détourage. */
async function toWebp(src: string, dest: string, kind: "background" | "cutout"): Promise<number> {
  if (kind === "background") await sh("convert", [src, "-resize", "2400x", "-quality", "82", dest]);
  else await sh("convert", [src, "-resize", "1600x", "-quality", "86", "-define", "webp:alpha-quality=100", dest]);
  const budget = kind === "background" ? 400 * 1024 : 250 * 1024;
  const size = await sizeOf(dest);
  if (size > budget) {
    const q = kind === "background" ? "72" : "78";
    await sh("convert", [src, "-resize", kind === "background" ? "2000x" : "1400x", "-quality", q, dest]);
  }
  return sizeOf(dest);
}

// ─────────────────────────────────────────────────────────────────────────────
// PHASE 4 — construire en VRAI HTML
// ─────────────────────────────────────────────────────────────────────────────
// On relit chaque cadre -ui et on le TRANSCRIT. Chaque section se compose :
// background-<n> plein cadre + product-<n> par-dessus + vrai texte HTML et
// vrais contrôles. Jamais une image d'interface livrée comme photo d'interface.

async function transcribeFrame(uiPng: string, page: WorldPage): Promise<string> {
  const b64 = (await readFile(uiPng)).toString("base64");
  const r = await generateText({
    model: gateway(VISION_MODEL),
    messages: [
      {
        role: "user" as const,
        content: [
          {
            type: "text" as const,
            text: `Transcris cette maquette de la page « ${page.name} ». Relève, dans l'ordre d'apparition :
la nav (chaque libellé), chaque titre, chaque paragraphe, chaque bouton (libellé exact), chaque prix, chaque étiquette.
Puis décris la mise en page : combien de sections, ce que contient chacune, où le produit est posé.
Texte brut, dense, pas de commentaire.`,
          },
          { type: "image" as const, image: b64 },
        ],
      },
    ],
  } as any);
  const t = ((r as any).text || "").trim();
  if (!t) throw new Error(`Transcription vide pour ${path.basename(uiPng)}`);
  return t;
}

const BUILD_SYSTEM = `Tu écris des pages React (TypeScript, Tailwind) pour un site déjà scaffoldé.

CONTRAINTES DURES
- Chaque section pose son fond en PLEIN CADRE via l'image background fournie (background-size: cover, pas de bande blanche),
  et pose PAR-DESSUS, en calque séparé, le détourage du produit (<img> à fond transparent).
- Le texte et les contrôles sont du VRAI HTML : <h1>, <p>, <button>, <input>, <select>. Jamais une image d'interface.
- Rien de non fonctionnel à l'écran : si un lien ne mène nulle part, tu ne l'affiches pas.
- Les variantes de couleur sont des assets pré-rendus, JAMAIS un filtre CSS hue-rotate.
- html et body portent overflow-x: clip. Aucune animation ne doit créer de débordement horizontal.
- Les prix sont affichés dans la devise du monde.
- Le tunnel d'achat va JUSQU'AU BOUT : choix taille → choix teinte → ajout au panier → page commande →
  bouton de validation → NUMÉRO DE COMMANDE affiché à l'écran. L'état passe par localStorage, pas de backend requis.
- Le numéro de commande est rendu dans un élément portant data-testid="order-number".

SOURCE UNIQUE DU CATALOGUE — RÈGLE LA PLUS STRICTE
- src/lib/catalog.ts existe déjà. Tu l'IMPORTES : import { PRODUCTS, SIZES, SHADES, formatPrice, getSelection,
  setSelection, selectedProduct, orderTotal, cartCount, addToCart, placeOrder, getOrder } from "../lib/catalog";
- INTERDIT d'écrire dans une page un nom de produit, un prix, une taille ou une teinte en dur.
  Pas de tableau de tailles, pas de tableau de teintes, pas de nombre suivi de la devise : tout vient du catalogue.
- Tout prix affiché passe par formatPrice(...). Le prix du bouton de validation, celui du récapitulatif et
  celui de la fiche produit sont LE MÊME appel : formatPrice(orderTotal()). Trois prix différents = page refusée.
- La page commande NE REDÉCLARE RIEN : elle lit SIZES, SHADES et la sélection courante via getSelection().
  Ce que l'utilisateur a choisi sur la fiche produit doit se retrouver tel quel dans le récapitulatif.
- La validation appelle placeOrder() et affiche order.number dans data-testid="order-number".

IMAGES — LISTE FERMÉE ET RÉSOLUTION OBLIGATOIRE PAR asset()
- Le site est servi sous une base (/api/companies/<id>/preview/) : un chemin d'image écrit en absolu
  (« /images/x.webp » dans un src ou un url(...)) part en 404. INTERDIT.
- src/lib/assets.ts existe déjà. Tu l'importes : import { asset } from "../lib/assets";
  Toute image de public/ s'écrit asset("/images/....webp"), y compris dans un fond CSS :
  style={{ backgroundImage: "url(" + asset("/images/background-xx.webp") + ")" }}
- L'image d'un produit est DÉJÀ résolue par le catalogue : tu affiches product.image tel quel,
  sans le repasser dans asset().
- Les SEULES images qui existent sont celles listées plus bas, au chemin EXACT, caractère pour caractère.
  Tu ne raccourcis pas un nom, tu n'en inventes pas, tu ne devines pas : « /images/background-commande.webp »
  quand le fichier s'appelle « /images/background-04-commande.webp » est une page refusée.
- INTERDIT de construire un chemin d'image par concaténation ou template (« /images/product-" + i + ".webp ») :
  l'image d'un produit se lit UNIQUEMENT sur l'objet du catalogue (product.image).
- INTERDIT d'utiliser une image venue d'ailleurs : aucune URL http:// ou https:// vers une image,
  aucun placeholder (placehold.co, unsplash, picsum, pexels, via.placeholder), aucun data:image inventé.
  Le monde est clos : tout ce qui s'affiche vient des fichiers listés.

VÉRIFIABILITÉ
- La racine de chaque page porte data-testid="page-<id>" avec l'id exact donné plus bas.

Rends UNIQUEMENT du JSON : {"files":[{"path":"src/pages/Xxx.tsx","content":"..."}]}`;

async function phase4Pages(
  bible: WorldBible,
  transcripts: Record<string, string>,
  assets: Record<string, { background: string; products: string[] }>,
  allImages: string[],
  emit: Emit,
): Promise<ScaffoldFile[]> {
  const out: ScaffoldFile[] = [];
  for (const page of bible.pages) {
    const a = assets[page.id];
    const file = page.id.replace(/^\d+-/, "").replace(/(^\w)/, (m) => m.toUpperCase()) + ".tsx";
    const basePrompt = `Monde: ${JSON.stringify({
        brandName: bible.brandName,
        currency: bible.currency,
        register: bible.register,
        palette: bible.palette,
        brokenLaw: bible.brokenLaw,
      })}

Produits: ${JSON.stringify(bible.products)}

Page à écrire: « ${page.name} » (route ${page.route}), fichier src/pages/${file}
Racine de la page: data-testid="page-${page.id}"
Déclinaisons vendues (lues depuis src/lib/catalog.ts, à NE PAS recopier en dur):
  SIZES = ${JSON.stringify(bible.sizes)}
  SHADES = ${JSON.stringify(bible.shades.map((t) => t.name))}

Transcription du cadre de référence (à respecter fidèlement) :
${transcripts[page.id]}

Fond plein cadre de CETTE page (chemin exact) : ${a.background}

LISTE FERMÉE des images existantes — aucun autre chemin n'existe, aucune URL externe n'est permise :
${allImages.map((x) => "  " + x).join("\n")}`;

    // La page est contrôlée DÈS SA SORTIE, pas dix minutes plus tard : prix en dur,
    // tailles redéclarées, image inventée ou chemin absolu non résolu. Le refus est
    // dit à voix haute et le motif exact est renvoyé au modèle. Rien n'est réparé en
    // douce : après trois tentatives, on jette avec les motifs.
    let produced: Array<{ path: string; content: string }> = [];
    let faults: string[] = [];
    for (let attempt = 1; attempt <= 3; attempt++) {
      const prompt = attempt === 1
        ? basePrompt
        : basePrompt + `\n\nTA VERSION PRÉCÉDENTE EST REFUSÉE. Motifs, à corriger tous :\n` +
          faults.map((x) => "  - " + x).join("\n") +
          `\nRéécris le fichier en entier en respectant ces motifs.`;
      const res = await askJson<{ files: Array<{ path: string; content: string }> }>(THINK_MODEL, BUILD_SYSTEM, prompt);
      if (!res.files?.length) throw new Error(`Aucun fichier renvoyé pour la page ${page.name}`);
      produced = res.files.map((f) => ({ path: f.path, content: f.content }));
      faults = [...catalogFaults(produced, bible), ...assetFaults(produced, allImages)];
      if (!faults.length) break;
      emit({
        type: "note",
        message: `page ${page.name} REFUSÉE (essai ${attempt}/3) : ${faults.join(" · ")}`,
      });
    }
    if (faults.length) {
      throw new Error(
        `Page ${page.name} refusée après 3 essais :\n` + faults.map((x) => "  - " + x).join("\n"),
      );
    }
    for (const f of produced) out.push(f);
    emit({ type: "note", message: `page ${page.name} écrite en vrai HTML (${produced.length} fichier(s))` });
  }
  return out;
}

/**
 * Garde-fou statique de la discipline catalogue.
 * Le modèle a tendance à recopier tailles, teintes et prix dans chaque page :
 * c'est exactement ce qui a produit « Drossel à 2 160 » d'un côté et
 * « La Varenne à 4 500 » de l'autre. On jette, on ne rattrape pas en silence.
 */
function catalogFaults(pages: ScaffoldFile[], bible: WorldBible): string[] {
  const faults: string[] = [];
  const cur = bible.currency.trim();
  const priceLike = cur
    ? new RegExp(String.raw`\d[\d\s.,]*\s*` + cur.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "u")
    : null;

  for (const f of pages) {
    if (!f.path.startsWith("src/pages/")) continue;
    const c = f.content;
    if (!/from\s+["'][^"']*lib\/catalog["']/.test(c)) {
      faults.push(`${f.path} n'importe pas src/lib/catalog — la page invente donc ses propres données`);
    }
    const redecl = /(?:const|let|var)\s+(SIZES|SHADES|TAILLES|TEINTES|sizes|shades|tailles|teintes|PRODUCTS|products)\s*(?::[^=]+)?=/.exec(c);
    if (redecl) {
      faults.push(`${f.path} redéclare « ${redecl[1]} » au lieu de lire le catalogue`);
    }
    const hard = priceLike?.exec(c);
    if (hard) {
      faults.push(`${f.path} écrit un prix en dur (« ${hard[0].trim()} ») au lieu de formatPrice(orderTotal())`);
    }
  }
  return faults;
}

function assertCatalogDiscipline(pages: ScaffoldFile[], bible: WorldBible): void {
  const faults = catalogFaults(pages, bible);
  if (faults.length) {
    throw new Error(
      "Discipline catalogue violée — la source unique n'est pas respectée :\n" + faults.map((x) => "  - " + x).join("\n"),
    );
  }
}

/**
 * Garde-fou statique des images.
 * Le modèle raccourcit les noms de fichiers (« background-commande.webp » pour
 * « background-04-commande.webp ») et va chercher des placeholders externes
 * (placehold.co) : deux 404 / deux violations que le build ne voit pas et que
 * le QA live ne sait pas réparer. On jette AVANT le build, pas après dix
 * minutes de génération.
 */
function assetFaults(pages: ScaffoldFile[], allImages: string[]): string[] {
  const allowed = new Set(allImages);
  const faults: string[] = [];

  for (const f of pages) {
    if (!f.path.startsWith("src/pages/")) continue;
    const c = f.content;

    // a. chemin d'image construit dynamiquement : invérifiable, donc interdit
    for (const m of c.matchAll(/\/images\/[A-Za-z0-9._-]*(?:\$\{|["'`]\s*\+)/g)) {
      faults.push(`${f.path} construit un chemin d'image à la volée (« ${m[0]} ») au lieu de lire product.image du catalogue`);
    }
    // b. chemin littéral absent de public/images
    for (const m of c.matchAll(/\/images\/[A-Za-z0-9._-]+\.(?:webp|png|jpg|jpeg|svg|avif)/g)) {
      if (!allowed.has(m[0])) faults.push(`${f.path} référence « ${m[0]} » qui n'existe pas dans public/images`);
      // c. chemin absolu non résolu : 404 garanti sous la base du proxy de preview
      const before = c.slice(Math.max(0, (m.index ?? 0) - 8), m.index ?? 0);
      if (!/asset\(\s*["'`]$/.test(before)) {
        faults.push(`${f.path} écrit « ${m[0]} » en absolu au lieu de asset("${m[0]}") — 404 sous la base du proxy`);
      }
    }
    // c. tout ce qui vient d'ailleurs que du monde généré
    for (const m of c.matchAll(/https?:\/\/[^"'`)\s]+/g)) {
      const u = m[0];
      if (/w3\.org/.test(u)) continue; // xmlns d'un <svg> inline, pas un asset
      if (/placehold|placeholder|unsplash|picsum|pexels|cloudinary|imgur|googleusercontent/i.test(u)
        || /\.(?:webp|png|jpg|jpeg|svg|avif|gif)(?:[?#]|$)/i.test(u)) {
        faults.push(`${f.path} charge une image externe (« ${u} ») : le monde doit être clos`);
      }
    }
  }
  return faults;
}

function assertAssetDiscipline(pages: ScaffoldFile[], allImages: string[]): void {
  const faults = assetFaults(pages, allImages);
  if (faults.length) {
    throw new Error(
      "Discipline des images violée — 404 assurés ou asset étranger au monde :\n" + faults.map((x) => "  - " + x).join("\n"),
    );
  }
}

/**
 * RÉSOLVEUR D'ASSETS.
 * Le serveur de preview tourne avec base = /api/companies/<id>/preview/ :
 * les fichiers de public/ sont donc servis SOUS cette base, et un « /images/x.webp »
 * écrit en absolu part en 404. C'est la cause racine du run #3 — et le QA live,
 * voyant ces 404, « réparait » en inventant des noms de fichiers.
 * Toute image passe par asset().
 */
function buildAssets(): ScaffoldFile {
  return {
    path: "src/lib/assets.ts",
    content: `// Généré par /test. BASE_URL vaut "/" en autonome, et le chemin du proxy
// en preview. Toute image de public/ DOIT passer par asset().
export function asset(p: string): string {
  const base = (import.meta.env.BASE_URL || "/").replace(/\\/$/, "");
  return base + "/" + String(p).replace(/^\\//, "");
}
`,
  };
}

/**
 * SOURCE UNIQUE DU CATALOGUE.
 * Écrit par le générateur, jamais par le modèle : produits, tailles, teintes et
 * prix n'existent qu'ici. Le panier et la commande lisent cet objet et rien
 * d'autre — c'est ce qui empêche trois prix différents de cohabiter à l'écran
 * (invariant 19 : le commerce est l'ancre de réalité).
 * Le code émis n'utilise AUCUN backtick : il est produit depuis un template
 * literal, un backtick le couperait en deux.
 */
function buildCatalog(bible: WorldBible): ScaffoldFile {
  const slug = (n: string) => n.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  const products = bible.products.map((p, i) => ({
    slug: slug(p.name) || "produit-" + (i + 1),
    name: p.name,
    price: p.price,
    blurb: p.blurb,
    image: "/images/product-" + (i + 1) + ".webp",
  }));
  const ns = slug(bible.brandName) || "monde";

  return {
    path: "src/lib/catalog.ts",
    content: `// Généré par /test — SOURCE UNIQUE. Ne pas redéclarer produits, tailles,
// teintes ou prix ailleurs : toute page qui affiche un prix le lit ici.

import { asset } from "./assets";
import { importOptional } from './lib/optional-import';

export const CURRENCY = ${JSON.stringify(bible.currency)};

export type Product = { slug: string; name: string; price: number; blurb: string; image: string };
export type Shade = { name: string; hex: string };
export type Selection = { slug: string; size: string; shade: string };
export type Order = { number: string; product: Product; size: string; shade: string; total: number; placedAt: string };

// image déjà résolue sous la base du serveur : la page affiche product.image tel quel.
export const PRODUCTS: Product[] = ${JSON.stringify(products, null, 2)}.map(function (p) {
  return { ...p, image: asset(p.image) };
});
export const SIZES: string[] = ${JSON.stringify(bible.sizes)};
export const SHADES: Shade[] = ${JSON.stringify(bible.shades, null, 2)};

/** Le SEUL formateur de prix du site. */
export function formatPrice(n: number): string {
  return n.toLocaleString("fr-FR") + " " + CURRENCY;
}

export function productBySlug(s: string): Product {
  return PRODUCTS.find((p) => p.slug === s) || PRODUCTS[0];
}

const SEL_KEY = ${JSON.stringify(ns + "-selection")};
const ORDER_KEY = ${JSON.stringify(ns + "-order")};

export function defaultSelection(): Selection {
  return { slug: PRODUCTS[0].slug, size: SIZES[0], shade: SHADES[0].name };
}

export function getSelection(): Selection {
  if (typeof localStorage === "undefined") return defaultSelection();
  try {
    const raw = localStorage.getItem(SEL_KEY);
    if (!raw) return defaultSelection();
    const parsed = JSON.parse(raw) as Partial<Selection>;
    const d = defaultSelection();
    return {
      slug: PRODUCTS.some((p) => p.slug === parsed.slug) ? (parsed.slug as string) : d.slug,
      size: SIZES.includes(parsed.size as string) ? (parsed.size as string) : d.size,
      shade: SHADES.some((t) => t.name === parsed.shade) ? (parsed.shade as string) : d.shade,
    };
  } catch {
    return defaultSelection();
  }
}

export function setSelection(patch: Partial<Selection>): Selection {
  const next = { ...getSelection(), ...patch };
  if (typeof localStorage !== "undefined") localStorage.setItem(SEL_KEY, JSON.stringify(next));
  return next;
}

export function selectedProduct(): Product {
  return productBySlug(getSelection().slug);
}

/** Le total, calculé une seule fois, affiché partout tel quel. */
export function orderTotal(sel?: Selection): number {
  const s = sel || getSelection();
  return productBySlug(s.slug).price;
}

export function cartCount(): number {
  if (typeof localStorage === "undefined") return 0;
  return localStorage.getItem(SEL_KEY) ? 1 : 0;
}

export function addToCart(patch?: Partial<Selection>): Selection {
  return setSelection(patch || {});
}

export function placeOrder(): Order {
  const sel = getSelection();
  const order: Order = {
    number: "ODR-" + Date.now().toString(36).toUpperCase() + "-" + Math.random().toString(36).slice(2, 7).toUpperCase(),
    product: productBySlug(sel.slug),
    size: sel.size,
    shade: sel.shade,
    total: orderTotal(sel),
    placedAt: new Date().toISOString(),
  };
  if (typeof localStorage !== "undefined") localStorage.setItem(ORDER_KEY, JSON.stringify(order));
  return order;
}

export function getOrder(): Order | null {
  if (typeof localStorage === "undefined") return null;
  try {
    const raw = localStorage.getItem(ORDER_KEY);
    return raw ? (JSON.parse(raw) as Order) : null;
  } catch {
    return null;
  }
}
`,
  };
}

/** Router déterministe : on ne laisse pas l'IA décider des routes. */
function buildRouter(bible: WorldBible): ScaffoldFile {
  const comp = (p: WorldPage) => p.id.replace(/^\d+-/, "").replace(/(^\w)/, (m) => m.toUpperCase());
  const imports = bible.pages.map((p) => `import ${comp(p)} from "./pages/${comp(p)}";`).join("\n");
  const routes = bible.pages.map((p) => `        <Route path="${p.route}" element={<${comp(p)} />} />`).join("\n");
  return {
    path: "src/App.tsx",
    // Le scaffold monte déjà <BrowserRouter> dans app-entry.tsx :
    // en remettre un ici casse l'app au runtime ("Router inside another Router").
    content: `import { Routes, Route } from "react-router-dom";
${imports}

export default function App() {
  return (
    <Routes>
${routes}
    </Routes>
  );
}
`,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// VÉRIFICATION RÉELLE — remplace le contrôle « 200 HTTP », qui mentait.
// ─────────────────────────────────────────────────────────────────────────────
// Un 200 dit seulement que Vite a servi du HTML. Le double <BrowserRouter> a
// traversé ce contrôle sans être vu : la page répondait 200 et React mourait
// juste après. On ouvre donc un vrai navigateur et on exige, PAR PAGE :
//   - zéro erreur console / zéro exception non catchée
//   - le sélecteur attendu présent dans le DOM (preuve que le rendu a abouti)
//   - la largeur du document mesurée (débordement horizontal)
// Toute page qui échoue fait jeter le run, avec la cause réelle.

const CHROME_PATHS = ["/usr/bin/google-chrome", "/usr/bin/google-chrome-stable", "/usr/bin/chromium", "/opt/google/chrome/chrome"];

export interface PageVerdict {
  route: string;
  selector: string;
  found: boolean;
  errors: string[];
  docW: number;
  scrollW: number;
  overflow: number;
}

function isBrowserNoise(m: string): boolean {
  // « Failed to load resource » est le doublon console d'une réponse HTTP en
  // échec, SANS l'URL : inutilisable pour diagnostiquer. On l'ignore ici et on
  // relève la vraie requête via le listener « response » ci-dessous, qui donne
  // le statut ET l'URL. Même logique que live-qa.ts.
  return ["favicon", "Download the React DevTools", "[vite] connect", "ResizeObserver loop",
    "was preloaded using link preload", "Failed to load resource"]
    .some((n) => m.includes(n));
}

async function verifyPages(baseUrl: string, bible: WorldBible, emit: Emit): Promise<PageVerdict[]> {
  const { chromium } = await importOptional<typeof import('playwright-core')>('playwright-core');
  const { existsSync } = await import("node:fs");
  const exe = CHROME_PATHS.find((c) => existsSync(c));
  if (!exe) throw new Error("Chrome introuvable : la vérification réelle ne peut pas tourner (pas de repli sur un contrôle HTTP)");

  const browser = await chromium.launch({ executablePath: exe, headless: true, args: ["--no-sandbox", "--disable-dev-shm-usage", "--disable-gpu"] });
  const verdicts: PageVerdict[] = [];
  try {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    for (const page of bible.pages) {
      const selector = `[data-testid="page-${page.id}"]`;
      const errors: string[] = [];
      const tab = await ctx.newPage();
      tab.on("pageerror", (e: any) => { const m = String(e?.message || e); if (!isBrowserNoise(m)) errors.push("exception: " + m); });
      tab.on("console", (m: any) => { if (m.type() === "error" && !isBrowserNoise(m.text())) errors.push("console: " + m.text()); });
      tab.on("response", (r: any) => {
        const st = r.status();
        if (st >= 400) errors.push("requête " + st + " : " + r.url());
      });
      tab.on("requestfailed", (r: any) => {
        errors.push("requête échouée : " + r.url() + " (" + (r.failure()?.errorText || "cause inconnue") + ")");
      });

      const target = baseUrl.replace(/\/$/, "") + page.route;
      await tab.goto(target, { waitUntil: "networkidle", timeout: 20000 });
      await tab.waitForTimeout(700);

      const found = await tab.locator(selector).count().then((n: number) => n > 0).catch(() => false);
      const dims = (await tab.evaluate(() => ({
        docW: document.documentElement.clientWidth,
        scrollW: document.documentElement.scrollWidth,
      }))) as { docW: number; scrollW: number };

      verdicts.push({ route: page.route, selector, found, errors, docW: dims.docW, scrollW: dims.scrollW, overflow: dims.scrollW - dims.docW });
      await tab.close().catch(() => {});
      emit({
        type: "note",
        message: `vérif ${page.route} — sélecteur ${found ? "présent" : "ABSENT"} · ${errors.length} erreur(s) console · docW ${dims.docW} / scrollW ${dims.scrollW}`,
      });
    }
    await ctx.close().catch(() => {});
  } finally {
    await browser.close().catch(() => {});
  }

  const bad = verdicts.filter((v) => !v.found || v.errors.length > 0);
  if (bad.length) {
    throw new Error(
      "Vérification réelle échouée (un 200 HTTP n'aurait rien vu) :\n" +
        bad.map((v) => `  - ${v.route} : ${v.found ? "sélecteur ok" : "sélecteur " + v.selector + " ABSENT"}` +
          (v.errors.length ? `\n      ${v.errors.slice(0, 4).join("\n      ")}` : "")).join("\n"),
    );
  }
  return verdicts;
}

// ─────────────────────────────────────────────────────────────────────────────
// Orchestration
// ─────────────────────────────────────────────────────────────────────────────

export function parseTestCommand(message: string): { active: boolean; category: string } {
  const m = /^\/test\b[\s:]*/i.exec(message || "");
  if (!m) return { active: false, category: "" };
  return { active: true, category: message.slice(m[0].length).trim() };
}

export interface RunTestOpts {
  category: string;
  userId: string;
  companyId: string;
  /** Annulation quand le client s'en va. Verifie entre les phases : on ne
   *  poursuit pas un run que plus personne n'ecoute. */
  signal?: AbortSignal;
  emit: Emit;
}

export async function runTest(
  opts: RunTestOpts,
): Promise<{ runId: string; dir: string; port: number; brandName: string }> {
  const { category, companyId, emit, signal } = opts;
  const halt = (where: string) => {
    if (signal?.aborted) throw new Error(`Run interrompu (client parti) avant : ${where}`);
  };
  const runId = `test_${Date.now().toString(36)}_${randomUUID().slice(0, 6)}`;
  const t0 = Date.now();
  emit({ type: "start", runId, category });

  const work = path.join(process.env.HOME || "/home/user", ".velbaz-apps", "test-frames", runId);
  await mkdir(work, { recursive: true });

  // ── Phase 1 ────────────────────────────────────────────────────────────────
  let t = Date.now();
  const bible = await phase1Bible(category, emit);
  emit({ type: "phase_done", title: "bible du monde", ms: Date.now() - t });

  // ── Phase 2 ────────────────────────────────────────────────────────────────
  t = Date.now();
  halt("cadres");
  const frames = await phase2Frames(bible, work, emit);
  emit({ type: "phase_done", title: "cadres avec interface", ms: Date.now() - t });

  // ── Phase 3 ────────────────────────────────────────────────────────────────
  t = Date.now();
  const publicDir = path.join(work, "public", "images");
  await mkdir(publicDir, { recursive: true });
  const assets: Record<string, { background: string; products: string[] }> = {};
  let sixCutouts: string[] = [];

  for (const page of bible.pages) {
    const { background } = await chainToBackground(bible, frames[page.id], path.join(work, page.id), emit);
    const bgWebp = path.join(publicDir, `background-${page.id}.webp`);
    await toWebp(background, bgWebp, "background");
    assets[page.id] = { background: `/images/background-${page.id}.webp`, products: [] };

    // La planche de collection donne les six détourages, en UNE génération.
    if (page.id === "02-collection") {
      const cuts = await sliceSixProducts(frames[page.id], work, emit);
      sixCutouts = [];
      for (let i = 0; i < cuts.length; i++) {
        const dest = path.join(publicDir, `product-${i + 1}.webp`);
        await toWebp(cuts[i], dest, "cutout");
        sixCutouts.push(`/images/product-${i + 1}.webp`);
      }
    }
  }
  if (sixCutouts.length !== 6) {
    throw new Error(`Six détourages attendus, ${sixCutouts.length} produits — la planche 3x2 n'a pas donné ses six cases`);
  }
  for (const page of bible.pages) assets[page.id].products = sixCutouts;
  emit({ type: "phase_done", title: "découpe 3 maillons + six détourages", ms: Date.now() - t });

  // ── Phase 4 ────────────────────────────────────────────────────────────────
  t = Date.now();
  halt("composition");
  const transcripts: Record<string, string> = {};
  for (const page of bible.pages) transcripts[page.id] = await transcribeFrame(frames[page.id], page);

  const meta: AppMeta = {
    companyName: bible.brandName,
    slug: bible.brandName.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, ""),
    primaryColor: bible.palette[0],
    accentColor: bible.palette[1] || bible.palette[0],
    font: "Plus Jakarta Sans",
    idea: `${category} — ${bible.tagline}`,
    tagline: bible.tagline,
    lang: "fr",
    withAssistant: false,
    withAuth: false,
  };
  const files = buildScaffold(meta);
  const allImages = [
    ...bible.pages.map((pg) => `/images/background-${pg.id}.webp`),
    ...sixCutouts,
  ];
  const pages = await phase4Pages(bible, transcripts, assets, allImages, emit);
  assertCatalogDiscipline(pages, bible);
  assertAssetDiscipline(pages, allImages);
  const byPath = new Map<string, ScaffoldFile>();
  for (const f of [...files, ...pages, buildAssets(), buildCatalog(bible), buildRouter(bible)]) byPath.set(f.path, f);
  emit({ type: "phase_done", title: "composition en vrai HTML", ms: Date.now() - t });

  // ── Phase 5 — livrer : projet Mibon standard, runner standard ─────────────
  t = Date.now();
  halt("livraison");
  const dir = await writeFilesToDisk(companyId, [...byPath.values()]);
  await mkdir(path.join(dir, "public"), { recursive: true });
  await sh("cp", ["-a", path.join(work, "public", "images"), path.join(dir, "public", "images")]);

  const dep = await installDeps(dir);
  if (!dep.ok) throw new Error(`bun install a echoue dans ${dir} :\n${dep.out.slice(-2000)}`);
  await ensureRequiredDeps(dir);

  // Pas de site casse servi en silence : si le build ne passe pas, on jette la
  // vraie erreur de build plutot que de demarrer un serveur sur du code mort.
  const built = await buildWithAutoFix(dir, [...byPath.values()], (m: string) => emit({ type: "note", message: m }));
  if (!built.ok) throw new Error(`Le build ne passe pas apres auto-fix :\n${built.lastError || "(pas d erreur remontee)"}`);
  const app = await startDevServer(companyId, dir);
  emit({ type: "phase_done", title: "livraison", ms: Date.now() - t });

  // ── QA live : le type LiveQAPlan sans l'appel, c'était du code mort ────────
  // Un vrai Chrome visite chaque page, clique les boutons, remplit les champs,
  // et l'IA corrige à chaud. C'est très probablement lui qui aurait attrapé le
  // double <BrowserRouter> que le contrôle « 200 HTTP » avait laissé passer.
  t = Date.now();
  halt("QA live");
  const baseUrl = `${app.url}${app.base}`;
  const qaPlan: LiveQAPlan = {
    appType: "storefront",
    pages: bible.pages.map((pg) => ({
      name: pg.name,
      route: pg.route,
      file: pg.id.replace(/^\d+-/, "").replace(/(^\w)/, (m) => m.toUpperCase()) + ".tsx",
      purpose: pg.intent,
      hasForm: pg.id === "04-commande",
      isCore: true,
    })),
    entities: [],
  };
  const qa = await runLiveQAAndFix({
    baseUrl,
    plan: qaPlan,
    files: [...byPath.values()],
    writeChanged: async (changed) => {
      for (const f of changed) byPath.set(f.path, f);
      await writeFilesIncremental(companyId, changed);
    },
    onProgress: (m: string) => emit({ type: "note", message: m }),
    isCancelled: () => !!signal?.aborted,
  });
  emit({
    type: "note",
    message: `QA live — ${qa.routesTested} route(s) testée(s), ${qa.rounds} tour(s), ${qa.fixedFiles.length} fichier(s) corrigé(s), ${qa.bugs.length} bug(s) restant(s)`,
  });
  // Le QA live réécrit des pages entières. Au run #3 il a « réparé » des 404 en
  // inventant des noms de fichiers (background-01-accueil.jpg). On repasse donc
  // le même garde-fou sur les fichiers d'APRÈS correction : s'il a cassé la
  // discipline, on le nomme, on ne le découvre pas au navigateur.
  assertAssetDiscipline([...byPath.values()], allImages);
  emit({ type: "phase_done", title: "QA live", ms: Date.now() - t });

  // ── Vérification réelle — le contrôle « 200 HTTP » est mort ────────────────
  t = Date.now();
  halt("vérification");
  const verdicts = await verifyPages(baseUrl, bible, emit);
  emit({
    type: "note",
    message: `vérification réelle OK — ${verdicts.length} page(s), 0 erreur console, sélecteur présent partout, débordement max ${Math.max(...verdicts.map((v) => v.overflow))} px`,
  });
  emit({ type: "phase_done", title: "vérification réelle", ms: Date.now() - t });

  emit({
    type: "done",
    runId,
    companyId,
    dir,
    previewUrl: `/api/companies/${companyId}/preview`,
    port: app.port,
    durationMs: Date.now() - t0,
  });
  return { runId, dir, port: app.port, brandName: bible.brandName };
}
