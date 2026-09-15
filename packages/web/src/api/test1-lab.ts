// ─── /test1 — commande AGENTIQUE, isolée de tout le reste ────────────────────
//
// Différence de fond avec /test : ici il n'y a AUCUNE phase codée en dur.
// On donne à l'agent (Claude Opus 4.6) le texte intégral du skill, une boîte
// d'outils, et il ÉCRIT LUI-MÊME SA LISTE DE TÂCHES puis les exécute. Le
// harnais ne décide pas du monde, du nombre de cadres, de l'ordre des étapes.
//
// ISOLATION — ce module n'importe RIEN de : test-lab.ts, chimera.ts,
// genesis.ts, builder/engine.ts, builder/images.ts, chimera-assets.ts.
// Il n'a aucune tâche en commun avec /genesis, /vision ou /test.
// Seule l'EXÉCUTION PURE est importée (scaffold, runner) : écrire des fichiers,
// installer, construire, démarrer un serveur. Ce n'est pas de la décision.
//
// RÈGLE DURE : aucun timer de secours, aucune reprise automatique, aucun repli
// silencieux. Quand une étape casse, elle jette avec la cause réelle, et la
// cause part dans le flux SSE telle quelle.

import { spawn } from "node:child_process";
import { mkdir, writeFile, readFile, readdir, stat } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { generateText, tool, stepCountIs } from "ai";
import { z } from "zod";
import { and, eq } from "drizzle-orm";
import { gateway } from "./agent/gateway";
import { db } from "./database/index";
import * as schema from "./database/schema";
import { buildScaffold, type AppMeta, type ScaffoldFile } from "./builder/scaffold";
import {
  writeFilesToDisk,
  writeFilesIncremental,
  installDeps,
  ensureRequiredDeps,
  buildWithAutoFix,
  startDevServer,
} from "./builder/runner";
import { importOptional } from './lib/optional-import';

// ── Modèles — demandés explicitement par l'utilisateur pour /test1 ───────────
// [2026-09-09] Claude Sonnet 4.6 PARTOUT (cerveau + oeil) — demande explicite
// du propriétaire : « utilise que claude sonnet 4.6 ». gpt-5.4-mini (choix coût
// du 2026-09-08) livrait des sites « fond blanc + texte + une image ». L'image
// [2026-09-09] L'image passe sur Nano Banana 2 Lite (gemini-3.1-flash-lite-image,
// ~0,034 $/image, sortie 1K) — demande explicite du propriétaire, remplace
// nano banana 1 (gemini-2.5-flash-image, 0,039 $).
// Overrides d'env sans toucher au code.
const BRAIN_MODEL = process.env.TEST1_BRAIN_MODEL || "anthropic/claude-sonnet-4.6";
const VISION_MODEL = process.env.TEST1_VISION_MODEL || "anthropic/claude-sonnet-4.6";
const IMAGE_MODEL = process.env.TEST1_IMAGE_MODEL || "google/gemini-3.1-flash-lite-image";

// ── Le skill fourni par l'utilisateur ────────────────────────────────────────
// [2026-09-07] Le skill vivait à /home/user/skill_test1, HORS du dépôt : à
// l'import du projet dans un nouveau sandbox, le dossier n'existait plus et
// /test1 jetait « Skill incomplet » dès la première seconde. Il est maintenant
// BUNDLÉ dans le dépôt (packages/web/skill_test1/) — plus jamais dépendant de
// la machine. TEST1_SKILL_DIR reste un override pour le développement.
// import.meta.dir est undefined sous le module runner SSR de Vite en dev —
// on enchaîne les candidats et on prend le premier qui contient SKILL.md.
const SKILL_DIR =
  process.env.TEST1_SKILL_DIR ||
  [
    import.meta.dir ? path.resolve(import.meta.dir, "../../skill_test1") : "",
    path.resolve(process.cwd(), "skill_test1"), // dev : cwd = packages/web
    "/home/user/velbaz5/packages/web/skill_test1", // absolu, dernier recours
  ].find((p) => p && existsSync(path.join(p, "SKILL.md"))) ||
  path.resolve(process.cwd(), "skill_test1");

// ── Événements ───────────────────────────────────────────────────────────────
export interface Test1Task {
  id: string;
  title: string;
}

export type Test1Event =
  | { type: "start"; runId: string; category: string }
  | { type: "plan"; tasks: Test1Task[] }
  | { type: "task_start"; id: string; title: string }
  | { type: "task_done"; id: string; title: string; ms: number; result: string }
  | { type: "note"; message: string }
  | { type: "prompts"; frames: { name: string; prompt: string }[] }
  | { type: "preview"; companyId: string; previewUrl: string }
  | { type: "error"; message: string }
  | {
      type: "done";
      runId: string;
      companyId: string;
      dir: string;
      previewUrl: string;
      port: number;
      brandName: string;
      durationMs: number;
    };

export type Emit1 = (e: Test1Event) => void;

// ─────────────────────────────────────────────────────────────────────────────
// Primitives
// ─────────────────────────────────────────────────────────────────────────────

/** Lance une commande. Rejette avec le stderr RÉEL si le code n'est pas 0. */
function sh(cmd: string, args: string[], cwd?: string): Promise<string> {
  return new Promise((resolve, reject) => {
    // `any` assumé : les typings Node de ce dépôt sont tronqués (même cause que
    // les `process.on` déjà en erreur ailleurs), pas un contournement de logique.
    const p: any = spawn(cmd, args, { cwd, stdio: ["ignore", "pipe", "pipe"] });
    let out = "";
    let err = "";
    p.stdout.on("data", (d: Buffer) => (out += d.toString()));
    p.stderr.on("data", (d: Buffer) => (err += d.toString()));
    p.on("error", (e: any) => reject(new Error(`${cmd} introuvable ou non lançable : ${e?.message || e}`)));
    p.on("close", (code: number | null) => {
      if (code === 0) resolve(out);
      else reject(new Error(`${cmd} ${args.join(" ")} → code ${code}\n${(err.trim() || out.trim()).slice(0, 3000)}`));
    });
  });
}

/** Commandes que l'agent a le droit de lancer. Tout le reste est refusé, à voix
 *  haute : l'agent voit le refus et sa raison, il ne le contourne pas en silence. */
const SHELL_ALLOWED = new Set([
  "convert",
  "magick",
  "montage",
  "identify",
  "composite",
  "remove-background",
  "upscale",
  "cp",
  "mv",
  "mkdir",
  "ls",
  "du",
]);

/** Réduit une image pour la vision : un PNG de 4 Mo ne passe pas. */
async function toVisionJpg(src: string): Promise<Buffer> {
  const tmp = path.join("/tmp", `t1v_${randomUUID().slice(0, 8)}.jpg`);
  await sh("convert", [src, "-resize", "1100x", "-quality", "80", tmp]);
  return readFile(tmp);
}

/** Génère une image. `refs` = images de référence (alignement au pixel entre
 *  les maillons de la chaîne de découpe). */
async function genImage(prompt: string, outPng: string, refs: Buffer[] = []): Promise<void> {
  await mkdir(path.dirname(outPng), { recursive: true });
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

// ─────────────────────────────────────────────────────────────────────────────
// Garde-fous durs sur le code écrit par l'agent
// ─────────────────────────────────────────────────────────────────────────────
// Ce ne sont pas des « instructions étape par étape » : ce sont des barrières de
// vérité, apprises au prix de quatre runs ratés. Elles REFUSENT, elles ne
// réparent jamais à la place de l'agent, et elles disent la vraie raison.

/** Le serveur de preview tourne sous une base `/api/companies/<id>/preview/`.
 *  Tout chemin d'image écrit en absolu part donc en 404, même si le fichier est
 *  bien sur le disque. C'est la cause racine des 404 du run #3 de /test. */
function assetFaults(file: ScaffoldFile, known: string[]): string[] {
  const faults: string[] = [];
  const c = file.content;

  for (const m of c.matchAll(/["'`](\/images\/[^"'`]+)["'`]/g)) {
    const p = m[1];
    if (!known.includes(p)) faults.push(`image inconnue « ${p} » — fichiers réellement produits : ${known.join(", ")}`);
  }
  if (/src=\{?["'`]\/images\//.test(c) || /url\(["']?\/images\//.test(c)) {
    faults.push("chemin d'image absolu utilisé tel quel — toute image doit passer par asset(\"/images/…\") de src/lib/assets");
  }
  if (/https?:\/\/[^"'`\s]+\.(png|jpe?g|webp|gif|svg)/i.test(c)) {
    faults.push("URL d'image externe — seules les images produites par le run sont autorisées");
  }
  if (/(placehold|unsplash|picsum|via\.placeholder)/i.test(c)) {
    faults.push("image de remplacement (placeholder) — interdit");
  }
  if (/<BrowserRouter|createBrowserRouter/.test(c)) {
    faults.push("<BrowserRouter> : le scaffold en monte déjà un, un routeur imbriqué casse la page en silence");
  }
  return faults;
}

/** [2026-09-09] Routes internes citées dans le code (Link to=, href=,
 *  navigate("…")). Un lien vers une route jamais déclarée à build_and_serve
 *  rend une PAGE BLANCHE sans aucune erreur console — c'est exactement le
 *  « site bizarre » du run Vélo Mëm : la nav pointait vers /collection et
 *  /services, deux pages jamais écrites ni routées. */
function internalRoutes(content: string): string[] {
  const out = new Set<string>();
  for (const m of content.matchAll(/(?:\bto=|\bhref=)\{?["'`](\/[a-z0-9/_-]*)["'`]\}?/gi)) {
    out.add(m[1].replace(/\/+$/, "") || "/");
  }
  for (const m of content.matchAll(/\bnavigate\(\s*["'`](\/[a-z0-9/_-]*)["'`]/gi)) {
    out.add(m[1].replace(/\/+$/, "") || "/");
  }
  return [...out];
}

/** [2026-09-07] Persiste les fichiers du projet en base (table project_files).
 *  Sans ça, le site n'existait que sur disque : au premier redémarrage du
 *  serveur, la map des apps tournantes était vide et ensureRunningApp ne
 *  trouvait AUCUN fichier en base → la preview du site livré était morte
 *  (« Preview not running. Build the app first. »). L'upsert est best-effort :
 *  il ne fait jamais échouer un build qui a réussi. */
async function persistProjectFiles(companyId: string, files: ScaffoldFile[]): Promise<void> {
  const now = new Date().toISOString();
  for (const f of files) {
    try {
      const existing = await db
        .select({ id: schema.projectFiles.id })
        .from(schema.projectFiles)
        .where(and(eq(schema.projectFiles.companyId, companyId), eq(schema.projectFiles.filePath, f.path)))
        .get();
      if (existing) {
        await db
          .update(schema.projectFiles)
          .set({ content: f.content, updatedAt: now })
          .where(eq(schema.projectFiles.id, existing.id));
      } else {
        await db.insert(schema.projectFiles).values({
          id: randomUUID(),
          companyId,
          filePath: f.path,
          content: f.content,
          fileType: f.path.split(".").pop() || "file",
          version: 1,
          createdAt: now,
          updatedAt: now,
        });
      }
    } catch (e: any) {
      console.warn(`[test1] persistance ${f.path} KO (non bloquant):`, String(e?.message || e).slice(0, 160));
    }
  }
}

/** src/lib/assets.ts — la seule façon correcte de désigner une image. */
function buildAssetsHelper(): ScaffoldFile {
  const body = [
    "// Résout un chemin d'image sous la base réelle de l'app.",
    "// Le serveur de preview sert l'app sous /api/companies/<id>/preview/ :",
    "// un chemin absolu /images/x.webp y répond 404. Tout passe par ici.",
    "export function asset(p: string): string {",
    "  const base = (import.meta.env.BASE_URL || '/').replace(/\\/$/, '');",
    "  return base + (p.startsWith('/') ? p : '/' + p);",
    "}",
    "",
  ].join("\n");
  return { path: "src/lib/assets.ts", content: body };
}

/** Le routeur, construit à partir des pages que l'agent a décidées.
 *  N'émet PAS de <BrowserRouter> : le scaffold en monte déjà un. */
function buildRouter(pages: { id: string; route: string; component: string }[]): ScaffoldFile {
  const imports = pages.map((p) => `import ${p.component} from './pages/${p.component}';`).join("\n");
  const routes = pages
    .map((p) => `        <Route path="${p.route}" element={<${p.component} />} />`)
    .join("\n");
  const content = [
    "import { Routes, Route } from 'react-router-dom';",
    imports,
    "",
    "export default function App() {",
    "  return (",
    "    <Routes>",
    routes,
    "    </Routes>",
    "  );",
    "}",
    "",
  ].join("\n");
  return { path: "src/App.tsx", content };
}

// ─────────────────────────────────────────────────────────────────────────────
// Vérification réelle au navigateur
// ─────────────────────────────────────────────────────────────────────────────
// Un 200 HTTP ne prouve rien : il dit que Vite a servi du HTML, pas que React a
// survécu. On ouvre un vrai Chrome et on relève, par page, les exceptions, les
// erreurs console, ET les requêtes >= 400 AVEC LEUR URL (sans ce dernier
// listener, la console dit « Failed to load resource » sans dire laquelle).

const CHROME_PATHS = [
  "/usr/bin/google-chrome",
  "/usr/bin/google-chrome-stable",
  "/usr/bin/chromium",
  "/opt/google/chrome/chrome",
];

function isBrowserNoise(m: string): boolean {
  return [
    "favicon",
    "Download the React DevTools",
    "[vite] connect",
    "ResizeObserver loop",
    "was preloaded using link preload",
    "Failed to load resource",
  ].some((n) => m.includes(n));
}

interface Verdict {
  route: string;
  found: boolean;
  errors: string[];
  docW: number;
  scrollW: number;
  /** [2026-09-09] Capture PNG de la page rendue (comparaison visuelle maquette). */
  shot?: Buffer;
}

async function verifyInBrowser(
  baseUrl: string,
  targets: { route: string; selector: string }[],
): Promise<Verdict[]> {
  const { chromium } = await importOptional<typeof import('playwright-core')>('playwright-core');
  const exe = CHROME_PATHS.find((c) => existsSync(c));
  if (!exe) throw new Error("Chrome introuvable : la vérification réelle ne peut pas tourner (pas de repli sur un contrôle HTTP)");

  const browser = await chromium.launch({
    executablePath: exe,
    headless: true,
    args: ["--no-sandbox", "--disable-dev-shm-usage", "--disable-gpu"],
  });
  const verdicts: Verdict[] = [];
  try {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    for (const t of targets) {
      const errors: string[] = [];
      const tab = await ctx.newPage();
      tab.on("pageerror", (e: any) => {
        const m = String(e?.message || e);
        if (!isBrowserNoise(m)) errors.push("exception: " + m);
      });
      tab.on("console", (m: any) => {
        if (m.type() === "error" && !isBrowserNoise(m.text())) errors.push("console: " + m.text());
      });
      tab.on("response", (r: any) => {
        if (r.status() >= 400) errors.push("requête " + r.status() + " : " + r.url());
      });
      tab.on("requestfailed", (r: any) => {
        errors.push("requête échouée : " + r.url() + " (" + (r.failure()?.errorText || "cause inconnue") + ")");
      });

      await tab.goto(baseUrl.replace(/\/$/, "") + t.route, { waitUntil: "domcontentloaded", timeout: 25000 });
      // On attend réellement le montage React : le sélecteur doit apparaître
      // dans le DOM. networkidle + délai fixe étaient flaky sur un serveur
      // Vite froid (transformation des modules à la demande) — la même route
      // passait tantôt « rendu ok », tantôt « ÉLÉMENT RACINE ABSENT ».
      const found = await tab
        .waitForSelector(t.selector, { timeout: 15000 })
        .then(() => true)
        .catch(() => false);
      // Laisse remonter les erreurs console/pageerror qui suivent le montage.
      await tab.waitForTimeout(500);
      const dims = (await tab.evaluate(() => ({
        docW: document.documentElement.clientWidth,
        scrollW: document.documentElement.scrollWidth,
      }))) as { docW: number; scrollW: number };
      // [2026-09-09] On capture la page RENDUE : un 200 + un testid présent ne
      // disent rien du rendu visuel (le run « fond blanc + texte » passait tous
      // ces contrôles). La capture part à la vision pour comparaison maquette.
      const shot = await tab.screenshot({ type: "png" }).catch(() => undefined);
      verdicts.push({ route: t.route, found, errors, docW: dims.docW, scrollW: dims.scrollW, shot: shot || undefined });
      await tab.close().catch(() => {});
    }
    await ctx.close().catch(() => {});
  } finally {
    await browser.close().catch(() => {});
  }
  return verdicts;
}

// ─────────────────────────────────────────────────────────────────────────────
// Le système donné à l'agent
// ─────────────────────────────────────────────────────────────────────────────

async function loadSkill(): Promise<string> {
  const files = ["SKILL.md", "references/worldsmith.md", "references/storefront.md"];
  const parts: string[] = [];
  for (const f of files) {
    const full = path.join(SKILL_DIR, f);
    if (!existsSync(full)) throw new Error(`Skill incomplet : ${full} est introuvable (SKILL_DIR=${SKILL_DIR})`);
    parts.push(`===== ${f} =====\n${await readFile(full, "utf8")}`);
  }
  return parts.join("\n\n");
}

function systemPrompt(skill: string, looks: string[]): string {
  return [
    "Tu es un agent autonome. On te donne un SKILL complet et une boîte d'outils.",
    "PERSONNE ne va te donner la marche à suivre étape par étape : tu écris toi-même",
    "ta liste de tâches avec l'outil plan_tasks, puis tu l'exécutes jusqu'au bout.",
    "",
    "Le run doit être conforme au skill à 100 %. Le skill est la loi, pas une suggestion :",
    "ses phases, ses interdits (« Kill on sight »), sa barre de qualité, sa règle zéro.",
    "Tu n'as pas de gate d'approbation : tu décides, tu exécutes, tu livres.",
    "",
    "CE QUI A FAIT ÉCHOUER LES RUNS PRÉCÉDENTS, et que le propriétaire du skill a rejeté",
    "mot pour mot : « le monde inventé n'est pas dans l'image ». Un atelier contemporain",
    "éclairé en bleu-vert avec des produits de catalogue, c'est notre monde avec un filtre.",
    "La loi brisée doit se LIRE sur chaque image. Atelier, usine, chaîne de production,",
    "teinturerie, labo, backstage : bannis comme décor de page. Jamais de sombre.",
    "Jamais le soleil comme source. Le fond est de la COULEUR DESSINÉE, pas une photo.",
    "",
    "Avant de générer le moindre cadre, appelle announce_frame_prompts avec TES prompts",
    "en texte : ils s'affichent en direct pour le propriétaire. Tu n'attends pas de réponse.",
    "",
    "LA MAQUETTE N'EST PAS LE SITE — le pipeline du skill, obligatoire :",
    "1. CADRE : tu génères chaque page comme une maquette 16:9 avec l'interface cuite",
    "   dedans (frames/NN-nom-ui.png). C'est une RÉFÉRENCE DE DESIGN, jamais un asset :",
    "   publish_image refusera toute image contenant une interface (menu, titre, prix).",
    "2. DÉCOUPE : tu débarrasses le cadre de son interface (generate_image avec refs →",
    "   frames/NN-nom-clean.png), puis tu coupes la plaque propre : FOND sans produit",
    "   (publish_image kind=background) et PRODUIT DÉTOURÉ (remove-background +",
    "   convert -trim +repage, kind=cutout). Sans ces deux matières publiées,",
    "   build_and_serve refuse le build.",
    "3. TRANSCRIPTION : avant de coder, tu relis chaque -ui.png avec look et tu en",
    "   transcris chaque chaîne, position et couleur. Le site reprend le copy deck",
    "   AU CARACTÈRE PRÈS : maquette et page doivent être impossibles à distinguer.",
    "4. RECONSTRUCTION : chaque section = fond plein cadre + découpe posée par-dessus",
    "   + texte et contrôles en vrai HTML cliquable. Le site ressemble à la maquette,",
    "   mais il est vivant.",
    "",
    "Regarde au moins trois écrans de références/looks avec l'outil look avant de prompter,",
    "et nomme celui dont ton site est le plus proche. Fichiers disponibles :",
    looks.join(", "),
    "",
    "CONTRAINTES DU HARNAIS (techniques, non négociables, elles ne touchent pas au design) :",
    "1. Toute image affichée passe par asset(\"/images/x.webp\") importé de \"@/lib/assets\".",
    "   Un chemin absolu /images/... répond 404 : l'app est servie sous une base.",
    "2. N'écris jamais <BrowserRouter> : le scaffold en monte déjà un.",
    "3. Chaque page doit porter data-testid=\"page-<id>\" sur son élément racine.",
    "4. Les images doivent exister : produis-les avec generate_image + shell (convert…),",
    "   place-les dans le dossier images du run, puis référence-les par leur nom exact.",
    "5. Tu ne peux écrire que dans src/ du projet, via write_project_file.",
    "6. Le tunnel d'achat doit aller jusqu'à un numéro de commande affiché.",
    "7. Tout lien interne (Link to, href, navigate) doit pointer vers une page que",
    "   tu as ÉCRITE et que tu déclareras à build_and_serve. Un lien vers une route",
    "   absente rend une page blanche sans erreur — le harnais refuse le build.",
    "8. Chaque page doit afficher au moins une image produite par le run via",
    "   asset(\"/images/…\"). Un site presque sans visuels générés est un site raté :",
    "   prévois au moins une image par page dans ton plan (fond, découpe, détail).",
    "",
    "MÉTHODE DE TRAVAIL :",
    "- plan_tasks d'abord, dès ton premier tour. Ton plan suit les 5 PHASES du skill,",
    "  une ou plusieurs tâches par phase, dans cet ordre :",
    "  1. MONDE — bible du monde, concept, copy deck, liste des pages.",
    "  2. CADRES — un cadre -ui.png par page, interface cuite, chacun relu avec look.",
    "  3. DÉCOUPE — plaques -clean.png, puis fond (background) + produit détouré",
    "     (cutout) + détails, chacun relu et publié via publish_image.",
    "  4. SITE — transcription des -ui.png, puis écriture des pages : fond plein",
    "     cadre + découpe + HTML vivant, copy deck au caractère près.",
    "  5. VÉRIFICATION — build_and_serve, puis verify_browser avec la maquette de",
    "     chaque route, corrections jusqu'à FIDÈLE partout, puis finish.",
    "- start_task / finish_task autour de chacune : c'est ce que voit l'utilisateur.",
    "- Quand un outil renvoie une erreur, lis la cause et corrige : ne recommence pas à",
    "  l'identique, et n'invente jamais un nom de fichier pour faire taire un 404.",
    "- build_and_serve quand le code est écrit, puis verify_browser EN DONNANT pour",
    "  chaque route sa maquette -ui.png : l'outil compare visuellement la page rendue",
    "  à la maquette et signale chaque écart (couleurs, typo, composition, images).",
    "  Corrige et rappelle build_and_serve + verify_browser jusqu'à ce que chaque",
    "  page soit FIDÈLE à sa maquette. finish est refusé avant.",
    "- Un site « fond blanc + texte + une image » est un ÉCHEC : la page réelle doit",
    "  porter le fond coloré dessiné de la maquette, sa typo, son produit détouré.",
    "- finish à la toute fin, avec le nom de la marque.",
    "",
    "INTERDICTION D'ABANDONNER :",
    "- Tu ne t'arrêtes JAMAIS sans avoir appelé finish. Un run qui se termine sans",
    "  finish est un run raté, quelle que soit la qualité de ce que tu as produit.",
    "- Un refus d'outil n'est pas un blocage : c'est une instruction de correction.",
    "  Lis la cause renvoyée, corrige (renomme, recompresse, réécris le fichier,",
    "  publie l'image manquante d'abord…) et réessaie différemment.",
    "- Si tu ne sais plus où tu en es, appelle list_state et repars de là.",
    "- Écrire « je suis bloqué » ou « je n'ai pas pu livrer » puis t'arrêter est",
    "  exactement le comportement interdit. Il y a toujours une action corrective.",
    "",
    "===== LE SKILL =====",
    skill,
  ].join("\n");
}

// ─────────────────────────────────────────────────────────────────────────────
// Orchestration
// ─────────────────────────────────────────────────────────────────────────────

// [2026-09-09] « /chimera » est le nom PUBLIC de la commande (demande du
// propriétaire) ; « /test1 » reste accepté comme alias. Même pipeline, même
// skill, même résultat.
export function parseTest1Command(message: string): { active: boolean; category: string } {
  const m = /^\/(?:chimera|test1)\b[\s:]*/i.exec(message || "");
  if (!m) return { active: false, category: "" };
  return { active: true, category: message.slice(m[0].length).trim() };
}

export interface RunTest1Opts {
  category: string;
  userId: string;
  companyId: string;
  signal?: AbortSignal;
  emit: Emit1;
}

export async function runTest1(
  opts: RunTest1Opts,
): Promise<{ runId: string; dir: string; port: number; brandName: string }> {
  const { category, companyId, emit, signal } = opts;
  const runId = `test1_${Date.now().toString(36)}_${randomUUID().slice(0, 6)}`;
  const t0 = Date.now();
  emit({ type: "start", runId, category });
  // Premiere note immediate : sans elle, rien ne s'affichait tant que l'agent
  // n'avait pas fini de lire le skill (60 a 80 s de silence complet).
  emit({ type: "note", message: "run demarre - l'agent lit le skill et ecrit son plan" });

  const work = path.join(process.env.HOME || "/home/user", ".velbaz-apps", "test1-work", runId);
  const imagesDir = path.join(work, "images");
  await mkdir(imagesDir, { recursive: true });

  const looksDir = path.join(SKILL_DIR, "references", "looks");
  const looks = existsSync(looksDir) ? (await readdir(looksDir)).filter((f) => /\.(png|jpe?g)$/i.test(f)).sort() : [];
  if (!looks.length) throw new Error(`Aucun écran de référence dans ${looksDir} — le skill est incomplet`);

  const skill = await loadSkill();

  // État que l'agent construit au fil du run.
  const tasks: Test1Task[] = [];
  const started = new Map<string, number>();
  const projectFiles = new Map<string, ScaffoldFile>();
  const producedImages: string[] = []; // « /images/xxx.webp »
  // [2026-09-09] Type de chaque image publiée (background / cutout / detail) :
  // build_and_serve exige la matière de la reconstruction (Phase 3 du skill) —
  // au moins une plaque de fond ET une découpe produit.
  const imageKinds = new Map<string, string>();
  let brandName = "";
  let devPort = 0;
  let devBase = "";
  let devUrl = "";
  let projectDir = "";
  let finished = false;
  // [2026-09-09] Passe à true seulement quand verify_browser n'a remonté AUCUN
  // échec technique NI écart visuel avec les maquettes. finish refuse tant que
  // ce n'est pas le cas — sinon l'agent livrait un site non ressemblant.
  let verifiedClean = false;

  const halt = () => {
    if (signal?.aborted) throw new Error("Run interrompu : le client est parti");
  };

  /** Chemin sûr à l'intérieur du dossier de travail. */
  const inWork = (p: string): string => {
    const full = path.resolve(work, p.replace(/^\/+/, ""));
    if (!full.startsWith(work)) throw new Error(`Chemin hors du dossier de travail : ${p}`);
    return full;
  };

  const tools = {
    plan_tasks: tool({
      description:
        "Écris TA liste de tâches pour ce run. À appeler en premier. Tu peux la rappeler pour la réviser si tu découvres qu'il te manque une étape.",
      inputSchema: z.object({
        tasks: z.array(z.object({ id: z.string(), title: z.string() })).min(3),
      }),
      execute: async ({ tasks: t }: { tasks: Test1Task[] }) => {
        tasks.length = 0;
        tasks.push(...t);
        emit({ type: "plan", tasks: [...tasks] });
        return `Plan enregistré : ${t.length} tâches.`;
      },
    }),

    start_task: tool({
      description: "Signale que tu commences une tâche de ton plan.",
      inputSchema: z.object({ id: z.string() }),
      execute: async ({ id }: { id: string }) => {
        const t = tasks.find((x) => x.id === id);
        if (!t) return `Tâche « ${id} » absente de ton plan. Tâches connues : ${tasks.map((x) => x.id).join(", ")}`;
        started.set(id, Date.now());
        emit({ type: "task_start", id, title: t.title });
        return "ok";
      },
    }),

    finish_task: tool({
      description: "Signale qu'une tâche est terminée, avec en une phrase ce qu'elle a produit.",
      inputSchema: z.object({ id: z.string(), result: z.string() }),
      execute: async ({ id, result }: { id: string; result: string }) => {
        const t = tasks.find((x) => x.id === id);
        if (!t) return `Tâche « ${id} » inconnue.`;
        const ms = Date.now() - (started.get(id) || Date.now());
        emit({ type: "task_done", id, title: t.title, ms, result });
        return "ok";
      },
    }),

    note: tool({
      description: "Dis une phrase à l'utilisateur pendant le run (décision prise, mesure, refus).",
      inputSchema: z.object({ message: z.string() }),
      execute: async ({ message }: { message: string }) => {
        emit({ type: "note", message });
        return "ok";
      },
    }),

    read_skill: tool({
      description:
        "Relis un fichier du skill. Valeurs : SKILL.md, references/worldsmith.md, references/storefront.md.",
      inputSchema: z.object({ file: z.string() }),
      execute: async ({ file }: { file: string }) => {
        const full = path.resolve(SKILL_DIR, file);
        if (!full.startsWith(SKILL_DIR) || !existsSync(full)) return `Fichier de skill introuvable : ${file}`;
        return readFile(full, "utf8");
      },
    }),

    look: tool({
      description:
        "Regarde des images avec un modèle de vision et pose une question dessus. Sert à étudier references/looks/NN.png (donne juste « looks/01.png ») et à vérifier tes propres cadres (donne le chemin renvoyé par generate_image).",
      inputSchema: z.object({
        paths: z.array(z.string()).min(1).max(4),
        question: z.string(),
      }),
      execute: async ({ paths, question }: { paths: string[]; question: string }) => {
        const bufs: Buffer[] = [];
        for (const p of paths) {
          const full = p.startsWith("looks/")
            ? path.join(looksDir, p.slice("looks/".length))
            : inWork(p);
          if (!existsSync(full)) return `Image introuvable : ${p}`;
          bufs.push(await toVisionJpg(full));
        }
        const r = await generateText({
          model: gateway(VISION_MODEL),
          messages: [
            {
              role: "user",
              content: [
                { type: "text" as const, text: question },
                ...bufs.map((b) => ({ type: "image" as const, image: b })),
              ],
            },
          ],
        } as any);
        const text = (r.text || "").trim();
        if (!text) throw new Error(`${VISION_MODEL} n'a rien répondu sur ${paths.join(", ")}`);
        return text;
      },
    }),

    announce_frame_prompts: tool({
      description:
        "Publie tes prompts d'image en texte AVANT de les générer. Obligatoire une fois, avant le premier generate_image. Ne bloque pas.",
      inputSchema: z.object({
        frames: z.array(z.object({ name: z.string(), prompt: z.string() })).min(1),
      }),
      execute: async ({ frames }: { frames: { name: string; prompt: string }[] }) => {
        emit({ type: "prompts", frames });
        return `${frames.length} prompt(s) publiés dans le flux.`;
      },
    }),

    generate_image: tool({
      description:
        "Génère une image et l'écrit dans le dossier de travail. `refs` = chemins d'images déjà produites, envoyées en référence pour rester alignées au pixel (sert à retirer l'interface, à effacer le produit, à détourer).",
      inputSchema: z.object({
        prompt: z.string(),
        out: z.string().describe("chemin relatif dans le dossier de travail, ex. frames/01-hero-ui.png"),
        refs: z.array(z.string()).optional(),
      }),
      execute: async ({ prompt, out, refs }: { prompt: string; out: string; refs?: string[] }) => {
        halt();
        const dest = inWork(out);
        const bufs: Buffer[] = [];
        for (const r of refs || []) {
          const full = inWork(r);
          if (!existsSync(full)) return `Référence introuvable : ${r}`;
          bufs.push(await readFile(full));
        }
        await genImage(prompt, dest, bufs);
        const size = (await stat(dest)).size;
        emit({ type: "note", message: `image ${out} — ${Math.round(size / 1024)} Ko` });
        return `Écrite : ${out} (${Math.round(size / 1024)} Ko). Relis-la avec look avant de t'en servir.`;
      },
    }),

    shell: tool({
      description:
        `Lance une commande dans le dossier de travail. Autorisées : ${[...SHELL_ALLOWED].join(", ")}. ` +
        "remove-background in.png -o out.png (sortie .png obligatoire). upscale in.png -o out.png -s 2. " +
        "convert in.png -trim +repage out.png. convert in.png -resize 2400x -quality 82 out.webp.",
      inputSchema: z.object({ cmd: z.string(), args: z.array(z.string()) }),
      execute: async ({ cmd, args }: { cmd: string; args: string[] }) => {
        halt();
        if (!SHELL_ALLOWED.has(cmd)) {
          return `Commande refusée : « ${cmd} ». Autorisées : ${[...SHELL_ALLOWED].join(", ")}.`;
        }
        try {
          const out = await sh(cmd, args, work);
          return out.trim().slice(0, 2000) || "ok (aucune sortie)";
        } catch (e: any) {
          return `ÉCHEC : ${e.message}`;
        }
      },
    }),

    publish_image: tool({
      description:
        "Déclare une image du dossier de travail comme image finale du site. Elle est copiée dans public/images/ et devient utilisable via asset(\"/images/<nom>\"). Refuse un fichier trop lourd : fond > 400 Ko, découpage > 250 Ko. Refuse AUSSI toute image contenant une interface de site cuite dedans (menu, titre, boutons, prix) : une maquette n'est pas un asset.",
      inputSchema: z.object({
        src: z.string().describe("chemin relatif dans le dossier de travail"),
        name: z.string().describe("nom final, ex. background-hero.webp"),
        kind: z.enum(["background", "cutout", "detail"]),
      }),
      execute: async ({ src, name, kind }: { src: string; name: string; kind: string }) => {
        halt();
        const full = inWork(src);
        if (!existsSync(full)) return `Introuvable : ${src}`;
        if (!/^[a-z0-9][a-z0-9._-]*\.(webp|png|jpg|jpeg)$/i.test(name)) return `Nom de fichier invalide : ${name}`;
        const size = (await stat(full)).size;
        const cap = kind === "background" ? 400 * 1024 : 250 * 1024;
        if (size > cap) {
          return `Refusé : ${name} pèse ${Math.round(size / 1024)} Ko, plafond ${Math.round(cap / 1024)} Ko pour un ${kind}. Repasse par convert (-resize / -quality) avant de republier.`;
        }
        // [2026-09-09] Une maquette de cadre (interface DÉJÀ dans l'image :
        // barre de nav, titre, boutons, prix cuits) publiée telle quelle
        // produisait le « site bizarre » : l'interface apparaissait en double,
        // cuite dans l'image ET reconstruite en HTML par-dessus. Une maquette
        // REPRÉSENTE le site, elle n'est pas DANS le site. On vérifie chaque
        // image à la publication avec le modèle de vision (image réduite,
        // coût faible) et on refuse en expliquant la correction.
        const gate = await generateText({
          model: gateway(VISION_MODEL),
          messages: [
            {
              role: "user" as const,
              content: [
                {
                  type: "text" as const,
                  text:
                    "Cette image contient-elle une interface de site web visible — barre de navigation, menu, liens, titre, boutons, prix, chips, champ de recherche, texte d'interface ? " +
                    "(Le texte faisant partie du produit lui-même — étiquette, logo ou marquage sur l'objet — ne compte PAS.) " +
                    "Réponds par UN SEUL mot : INTERFACE si une interface est visible, PROPRE sinon.",
                },
                { type: "image" as const, image: await toVisionJpg(full) },
              ],
            },
          ],
        } as any);
        if (/INTERFACE/i.test((gate as any).text || "")) {
          return (
            `Refusé : ${name} contient l'interface du site cuite dans l'image (menu, titre, boutons…). ` +
            "C'est une maquette de référence, pas un asset : le site RECONSTRUIT cette interface en vrai code. " +
            "Publie à la place le FOND seul (régénère-le sans interface, ou efface l'interface via generate_image avec refs) " +
            "et/ou le PRODUIT DÉTOURÉ (remove-background), puis reconstruis la maquette en HTML/CSS."
          );
        }
        await sh("cp", ["-a", full, path.join(imagesDir, name)]);
        const web = `/images/${name}`;
        if (!producedImages.includes(web)) producedImages.push(web);
        imageKinds.set(web, kind);
        emit({ type: "note", message: `image finale ${web} — ${Math.round(size / 1024)} Ko` });
        return `Publiée : ${web} (${Math.round(size / 1024)} Ko). Utilise-la via asset("${web}").`;
      },
    }),

    write_project_file: tool({
      description:
        "Écrit un fichier du site sous src/ (ex. src/pages/Home.tsx, src/lib/catalog.ts, src/index.css). Refusé si le contenu casse une contrainte du harnais — la raison exacte est renvoyée.",
      inputSchema: z.object({ path: z.string(), content: z.string() }),
      execute: async ({ path: p, content }: { path: string; content: string }) => {
        const clean = p.replace(/^\/+/, "");
        if (!clean.startsWith("src/")) return `Refusé : ${p}. Tu ne peux écrire que sous src/.`;
        if (clean === "src/App.tsx") {
          return "Refusé : src/App.tsx est généré par le harnais à partir des pages passées à build_and_serve.";
        }
        const file: ScaffoldFile = { path: clean, content };
        const faults = assetFaults(file, producedImages);
        if (faults.length) return `Refusé (${clean}) :\n- ${faults.join("\n- ")}`;
        projectFiles.set(clean, file);
        return `Écrit : ${clean} (${content.split("\n").length} lignes).`;
      },
    }),

    read_project_file: tool({
      description: "Relis un fichier que tu as déjà écrit.",
      inputSchema: z.object({ path: z.string() }),
      execute: async ({ path: p }: { path: string }) => {
        const f = projectFiles.get(p.replace(/^\/+/, ""));
        if (!f) return `Pas encore écrit : ${p}. Fichiers écrits : ${[...projectFiles.keys()].join(", ") || "(aucun)"}`;
        return f.content;
      },
    }),

    list_state: tool({
      description: "Résumé de l'état du run : images publiées, fichiers écrits, serveur.",
      inputSchema: z.object({}),
      execute: async () => {
        return [
          `images publiées : ${producedImages.join(", ") || "(aucune)"}`,
          `fichiers écrits : ${[...projectFiles.keys()].join(", ") || "(aucun)"}`,
          devPort ? `serveur : ${devUrl}${devBase} (port ${devPort})` : "serveur : pas démarré",
        ].join("\n");
      },
    }),

    build_and_serve: tool({
      description:
        "Assemble le projet avec tes fichiers, installe, construit et démarre le serveur. À rappeler après chaque correction. Renvoie l'erreur de build réelle si ça ne passe pas.",
      inputSchema: z.object({
        brandName: z.string(),
        tagline: z.string(),
        palette: z.array(z.string()).min(2),
        pages: z
          .array(
            z.object({
              id: z.string().describe("identifiant court, sert au data-testid page-<id>"),
              route: z.string().describe("ex. / ou /produit"),
              component: z.string().describe("nom du composant, ex. Home — le fichier src/pages/Home.tsx doit exister"),
            }),
          )
          .min(2),
      }),
      execute: async (a: {
        brandName: string;
        tagline: string;
        palette: string[];
        pages: { id: string; route: string; component: string }[];
      }) => {
        halt();
        for (const pg of a.pages) {
          if (!projectFiles.has(`src/pages/${pg.component}.tsx`)) {
            return `Refusé : la page ${pg.component} est déclarée mais src/pages/${pg.component}.tsx n'a pas été écrit.`;
          }
        }
        // [2026-09-09] Cohérence nav ↔ routes : un lien interne vers une route
        // non déclarée rend une page blanche SANS erreur (le run Vélo Mëm
        // livrait /collection et /services vides). On refuse tant que chaque
        // route citée n'est pas déclarée — l'agent écrit la page ou retire le lien.
        const declared = new Set(a.pages.map((p) => (p.route.replace(/\/+$/, "") || "/")));
        const dangling: string[] = [];
        for (const f of projectFiles.values()) {
          for (const r of internalRoutes(f.content)) {
            if (!declared.has(r)) dangling.push(`${f.path} → ${r}`);
          }
        }
        if (dangling.length) {
          return (
            "Refusé : des liens pointent vers des routes que tu n'as pas déclarées " +
            "(elles rendraient une page blanche). Écris la page correspondante et " +
            "déclare-la dans `pages`, ou retire le lien :\n- " +
            [...new Set(dangling)].join("\n- ")
          );
        }
        // [2026-09-09] Chaque page doit montrer au moins une image produite par
        // le run : le run Vélo Mëm n'avait généré que 3 visuels pour 5 pages,
        // d'où un site « bizarre » presque sans images.
        const noImage: string[] = [];
        for (const pg of a.pages) {
          const f = projectFiles.get(`src/pages/${pg.component}.tsx`);
          if (f && !/asset\(\s*["'`]\/images\//.test(f.content)) noImage.push(pg.component);
        }
        if (noImage.length) {
          return (
            "Refusé : ces pages n'utilisent aucune image produite par le run " +
            "(aucun asset(\"/images/…\")). Un site sans visuels générés est raté : " +
            "produis une image (generate_image → shell convert → publish_image) et " +
            "intègre-la dans chacune :\n- " +
            noImage.join("\n- ")
          );
        }
        // [2026-09-09] Phase 3/4 du skill : le site se COMPOSE d'une plaque de
        // fond + d'une découpe produit + de HTML vivant. Sans ces deux matières
        // publiées, la seule façon de « ressembler aux cadres » est de plaquer
        // la maquette — exactement l'échec que ce harnais interdit.
        const kinds = new Set(imageKinds.values());
        if (!kinds.has("background") || !kinds.has("cutout")) {
          return (
            "Refusé : la matière de reconstruction est incomplète. Le skill exige, " +
            "depuis chaque plaque propre, un FOND sans produit (publish_image kind=background) " +
            "ET le PRODUIT DÉTOURÉ (kind=cutout via remove-background + convert -trim +repage). " +
            `Publié jusqu'ici : ${[...imageKinds.entries()].map(([k, v]) => `${k} (${v})`).join(", ") || "(rien)"}. ` +
            "Découpe tes plaques -clean.png (Phase 3 du skill) puis republie."
          );
        }
        brandName = a.brandName;
        // [2026-09-09] Tout nouveau build invalide la vérification précédente :
        // finish exigera un verify_browser propre APRÈS ce build.
        verifiedClean = false;
        const meta: AppMeta = {
          companyName: a.brandName,
          slug: a.brandName.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "test1",
          primaryColor: a.palette[0],
          accentColor: a.palette[1] || a.palette[0],
          font: "Plus Jakarta Sans",
          idea: `${category} — ${a.tagline}`,
          tagline: a.tagline,
          lang: "fr",
          withAssistant: false,
          withAuth: false,
        };
        const byPath = new Map<string, ScaffoldFile>();
        for (const f of buildScaffold(meta)) byPath.set(f.path, f);
        for (const f of projectFiles.values()) byPath.set(f.path, f);
        byPath.set("src/lib/assets.ts", buildAssetsHelper());
        byPath.set("src/App.tsx", buildRouter(a.pages));
        const all = [...byPath.values()];

        const first = !projectDir;
        projectDir = await writeFilesToDisk(companyId, all);
        await mkdir(path.join(projectDir, "public"), { recursive: true });
        await sh("cp", ["-a", imagesDir, path.join(projectDir, "public", "images")]).catch(async () => {
          await sh("cp", ["-a", imagesDir + "/.", path.join(projectDir, "public", "images")]);
        });

        if (first) {
          const dep = await installDeps(projectDir);
          if (!dep.ok) throw new Error(`bun install a échoué dans ${projectDir} :\n${dep.out.slice(-2000)}`);
          await ensureRequiredDeps(projectDir);
        } else {
          await writeFilesIncremental(companyId, all);
        }

        const built = await buildWithAutoFix(projectDir, all, (m: string) => emit({ type: "note", message: m }));
        if (!built.ok) {
          return `BUILD EN ÉCHEC — corrige puis rappelle build_and_serve :\n${(built.lastError || "(pas d'erreur remontée)").slice(0, 3000)}`;
        }
        // Persiste en base à chaque build réussi : la preview doit pouvoir être
        // re-matérialisée après un redémarrage du serveur (voir persistProjectFiles).
        await persistProjectFiles(companyId, all);
        const app = await startDevServer(companyId, projectDir);
        devPort = app.port;
        devBase = app.base;
        devUrl = app.url;
        emit({ type: "note", message: `build ok — serveur sur le port ${app.port}` });
        // [2026-09-09] Le serveur Vite tourne dès maintenant : on publie l'URL
        // de preview pour que le chat affiche le site en direct (HMR) pendant
        // que l'agent continue à corriger.
        emit({ type: "preview", companyId, previewUrl: `/api/companies/${companyId}/preview` });
        return `Build ok, serveur démarré. Vérifie maintenant avec verify_browser (routes : ${a.pages.map((p) => p.route).join(", ")}).`;
      },
    }),

    verify_browser: tool({
      description:
        "Ouvre un vrai Chrome sur chaque route, renvoie les exceptions, les erreurs console et les requêtes 4xx AVEC leur URL, ET compare visuellement chaque page rendue à sa maquette -ui.png. Un 200 HTTP ne prouve rien, c'est ceci qui fait foi.",
      inputSchema: z.object({
        routes: z
          .array(
            z.object({
              route: z.string(),
              testid: z.string(),
              mockup: z
                .string()
                .describe("chemin du cadre maquette dans le dossier de travail, ex. frames/01-hero-ui.png"),
            }),
          )
          .min(1),
      }),
      execute: async ({ routes }: { routes: { route: string; testid: string; mockup: string }[] }) => {
        halt();
        if (!devPort) return "Refusé : aucun serveur démarré. Appelle build_and_serve d'abord.";
        const verdicts = await verifyInBrowser(
          `${devUrl}${devBase}`,
          routes.map((r) => ({ route: r.route, selector: `[data-testid="page-${r.testid}"]` })),
        );
        const lines = verdicts.map((v) => {
          const head = `${v.route} — ${v.found ? "rendu ok" : "ÉLÉMENT RACINE ABSENT"} · ${v.errors.length} erreur(s) · largeur ${v.docW}/${v.scrollW}`;
          return v.errors.length ? head + "\n    " + v.errors.slice(0, 6).join("\n    ") : head;
        });
        for (const l of lines) emit({ type: "note", message: "vérif " + l.split("\n")[0] });
        const bad = verdicts.filter((v) => !v.found || v.errors.length);

        // [2026-09-09] COMPARAISON VISUELLE maquette ↔ page rendue. Sans elle,
        // un site « fond blanc + texte + une image » passait tous les contrôles
        // techniques alors qu'il ne ressemblait EN RIEN au cadre généré — le
        // rejet exact du propriétaire. La vision juge la ressemblance et
        // renvoie les écarts à corriger.
        const visualLines: string[] = [];
        for (let i = 0; i < verdicts.length; i++) {
          const v = verdicts[i];
          const mockRel = routes[i]?.mockup;
          if (!v.shot || !mockRel) continue;
          const mockFull = inWork(mockRel);
          if (!existsSync(mockFull)) {
            visualLines.push(`${v.route} — maquette introuvable : ${mockRel}`);
            continue;
          }
          const mockJpg = await toVisionJpg(mockFull);
          const shotJpg = await (async () => {
            const tmp = path.join("/tmp", `t1s_${randomUUID().slice(0, 8)}.png`);
            await writeFile(tmp, v.shot);
            return toVisionJpg(tmp);
          })();
          const cmp = await generateText({
            model: gateway(VISION_MODEL),
            messages: [
              {
                role: "user" as const,
                content: [
                  {
                    type: "text" as const,
                    text:
                      "Image 1 = la MAQUETTE de design d'une page de boutique. Image 2 = la page RÉELLE reconstruite en code, censée la recréer à la perfection. " +
                      "Compare-les. La page réelle doit reprendre la maquette : palette de couleurs (fond coloré dessiné, PAS un fond blanc par défaut), hiérarchie et tailles typographiques, positions des blocs, produit visible, libellés. " +
                      "Réponds en français, en 2-4 lignes maximum : d'abord un verdict « FIDÈLE » ou « ÉCART », puis les écarts précis à corriger (ex. « fond blanc au lieu du dégradé #X », « titre trop petit », « produit absent »).",
                  },
                  { type: "image" as const, image: mockJpg },
                  { type: "image" as const, image: shotJpg },
                ],
              },
            ],
          } as any);
          const verdict = ((cmp as any).text || "").trim();
          visualLines.push(`${v.route} — ${verdict}`);
          emit({ type: "note", message: `comparaison ${v.route} : ${verdict.split("\n")[0].slice(0, 120)}` });
        }

        const visualBad = visualLines.filter((l) => /ÉCART/i.test(l));
        // [2026-09-09] finish ne sera accepté que si CE passage est entièrement
        // propre : aucune erreur technique, aucun écart visuel.
        verifiedClean = bad.length === 0 && visualBad.length === 0 && visualLines.length > 0;
        return (
          (bad.length ? "ÉCHECS TECHNIQUES À CORRIGER :\n" : "Technique propre :\n") +
          lines.join("\n") +
          "\n\nComparaison visuelle maquette ↔ page :\n" +
          (visualLines.join("\n") || "(aucune)") +
          (visualBad.length
            ? "\n\nDes pages ne ressemblent PAS à leur maquette : corrige le code (couleurs, typo, composition, images) puis rappelle build_and_serve et verify_browser."
            : "")
        );
      },
    }),

    finish: tool({
      description:
        "À appeler en tout dernier, une fois le site vérifié propre au navigateur. Termine le run.",
      inputSchema: z.object({ brandName: z.string(), summary: z.string() }),
      execute: async ({ brandName: b, summary }: { brandName: string; summary: string }) => {
        if (!devPort) return "Refusé : tu n'as pas de serveur qui tourne. build_and_serve puis verify_browser avant de finir.";
        brandName = b || brandName;
        finished = true;
        emit({ type: "note", message: summary });
        return "Run terminé.";
      },
    }),
  };

  const result = await generateText({
    model: gateway(BRAIN_MODEL),
    system: systemPrompt(skill, looks.map((f) => `looks/${f}`)),
    prompt: [
      `Catégorie de produit : ${category}`,
      "",
      "Écris ton plan de tâches, puis exécute-le jusqu'au site livré et vérifié.",
      "Le dossier de travail est vide : tout ce que tu utilises, tu le produis.",
    ].join("\n"),
    tools: tools as any,
    // [2026-09-08] 160 → 120 : les runs qui réussissent finissent bien avant ;
    // ce plafond borne le coût d'un run qui dérive en boucles de correction.
    stopWhen: stepCountIs(120),
    // [2026-09-05] « ça ne commence rien » : l'agent passait 60 a 80 s a lire le
    // skill et a reflechir SANS emettre le moindre evenement. Le serveur
    // travaillait, l'ecran restait fige, donc le run paraissait mort. On publie
    // maintenant chaque outil appele : le flux bouge des la premiere seconde.
    onStepFinish: (step: any) => {
      const calls = step?.toolCalls || [];
      for (const c of calls) {
        const name = c?.toolName || c?.name;
        if (!name) continue;
        // Les outils qui parlent deja d'eux-memes ne sont pas doubles.
        if (name === "note" || name === "plan_tasks" || name === "start_task" || name === "finish_task") continue;
        emit({ type: "note", message: "outil - " + name });
      }
    },
  } as any);

  if (!finished) {
    const last = ((result as any).text || "").trim();
    // [2026-09-09] On joint l'état exact du run au message d'erreur : sans lui,
    // impossible de savoir si l'agent a abandonné sur les images, le code ou
    // la vérification navigateur.
    const state = [
      `images publiées : ${producedImages.join(", ") || "(aucune)"}`,
      `fichiers écrits : ${[...projectFiles.keys()].join(", ") || "(aucun)"}`,
      devPort ? `serveur : ${devUrl}${devBase} (port ${devPort})` : "serveur : pas démarré",
    ].join("\n");
    throw new Error(
      "L'agent s'est arrêté sans appeler finish — le site n'est pas vérifié." +
        `\nÉtat du run à l'arrêt :\n${state}` +
        (last ? `\nDernier message de l'agent :\n${last.slice(0, 1500)}` : ""),
    );
  }
  if (!devPort || !projectDir) throw new Error("finish appelé mais aucun serveur ne tourne");

  emit({
    type: "done",
    runId,
    companyId,
    dir: projectDir,
    previewUrl: `/api/companies/${companyId}/preview`,
    port: devPort,
    brandName: brandName || category,
    durationMs: Date.now() - t0,
  });
  return { runId, dir: projectDir, port: devPort, brandName: brandName || category };
}
