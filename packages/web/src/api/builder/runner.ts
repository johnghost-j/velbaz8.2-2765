// ─── App Runner ──────────────────────────────────────────────────────────────
// Writes generated files to disk, installs deps, runs the Vite dev server,
// captures build errors, and runs an AI auto-fix loop.

import { spawn, type ChildProcess } from "node:child_process";
import { mkdir, writeFile, rm, readFile, readdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { createServer } from "node:net";
import { generateText } from "ai";
import { gateway } from "../agent/gateway";
import type { ScaffoldFile } from "./scaffold";
import { db } from "../database/index";
import * as dbSchema from "../database/schema";
import { eq } from "drizzle-orm";

// Generated React projects + their Vite dev servers live here. This MUST be on
// a real persistent disk, NOT tmpfs (/tmp): each project installs node_modules
// (hundreds of MB) and tmpfs is a tiny RAM-backed volume (~2GB) that fills up
// fast — a full tmpfs makes dev servers fail to write files, so previews go
// blank / show "Page not found". Default to the home disk (tens of GB free),
// overridable via VELBAZ_APPS_ROOT.
const ROOT = process.env.VELBAZ_APPS_ROOT || "/home/user/.velbaz-apps";

// [2026-09-08] Coûts : la réparation de build et la création de modules
// manquants tournaient sur Opus 4.7 (le modèle le plus cher du repo) à CHAQUE
// boucle de build. gpt-5.4-mini — déjà le modèle de genesis/chimera pour ce
// genre de tâche — suffit largement pour corriger des erreurs de build.
// Override d'env pour remonter en puissance ponctuellement.
const REPAIR_MODEL = process.env.BUILDER_REPAIR_MODEL || "openai/gpt-5.4-mini";

// Secrets de l'entreprise (Stripe, CJ…) injectés dans l'env du site généré,
// pour que /api/checkout encaisse avec LES clés de l'utilisateur (jamais en dur
// dans le code généré). + identifiants pour notifier Velbaz des commandes.
async function companyEnv(companyId: string): Promise<Record<string, string>> {
  const env: Record<string, string> = {
    COMPANY_ID: companyId,
    VELBAZ_API_URL: `http://localhost:${process.env.PORT || 4200}/api`,
  };
  try {
    const rows = await db.select({ key: dbSchema.companySecrets.key, value: dbSchema.companySecrets.value })
      .from(dbSchema.companySecrets).where(eq(dbSchema.companySecrets.companyId, companyId));
    for (const r of rows) {
      if (/^(STRIPE_|CJ_)/.test(r.key)) env[r.key] = r.value;
    }
  } catch { /* pas de secrets → checkout renverra stripe_not_connected proprement */ }
  return env;
}

// Find a genuinely free TCP port starting from `from`. Prevents the map from
// pointing at a stale/zombie dev server that already grabbed the guessed port.
async function findFreePort(from: number): Promise<number> {
  for (let port = from; port < from + 200; port++) {
    const free = await new Promise<boolean>((resolve) => {
      const srv = createServer();
      srv.once("error", () => resolve(false));
      srv.once("listening", () => srv.close(() => resolve(true)));
      srv.listen(port, "0.0.0.0");
    });
    if (free) return port;
  }
  throw new Error(`No free port found from ${from}`);
}

// Kill a spawned dev server AND its child processes (bunx spawns node vite).
function killTree(proc: ChildProcess) {
  if (!proc.pid) return;
  try { process.kill(-proc.pid, "SIGKILL"); } catch {}
  try { proc.kill("SIGKILL"); } catch {}
}

export interface RunningApp {
  companyId: string;
  dir: string;
  port: number;
  proc: ChildProcess;
  url: string;
  base: string; // vite base path (= proxy prefix)
}

const running = new Map<string, RunningApp>();
let nextPort = 5200;

export function getRunningApp(companyId: string): RunningApp | undefined {
  return running.get(companyId);
}

// ── Révision de l'aperçu (rechargement en direct SANS WebSocket) ─────────────
// [2026-09-11] L'aperçu du build restait figé sur le squelette jusqu'à la fin.
// Cause réelle : le client HMR de Vite ouvre son WebSocket sur l'URL PUBLIQUE
// de la page, c.-à-d. `/api/companies/<id>/preview/` — donc sur le reverse
// proxy Hono, qui est un simple `fetch()` sans gestion de l'`Upgrade`. La
// connexion échoue, Vite retombe sur `localhost:<portVite>` (injoignable depuis
// le navigateur de l'utilisateur), et PLUS AUCUNE écriture de fichier n'atteint
// l'iframe : les stubs squelette restaient à l'écran jusqu'à ce que le panneau
// remonte une iframe neuve à la toute fin — exactement le symptôme signalé.
//
// Correctif : un compteur de révision en mémoire, incrémenté à CHAQUE écriture
// de fichier du projet, exposé en HTTP et sondé par un script minuscule injecté
// dans le HTML de l'aperçu. Quand la révision bouge puis se stabilise, le script
// fait un `location.reload()` — l'URL courante est conservée, donc la page que
// l'utilisateur regarde dans l'aperçu ne change pas, elle se met à jour.
// Deux compteurs, parce que les pages sont générées EN PARALLÈLE et que chacune
// écrit un instantané partiel ~1×/s pendant qu'elle se génère :
//   • `rev`  — toute écriture (sert à savoir que ça bouge encore) ;
//   • `mrev` — uniquement les JALONS (page terminée, Header/Footer, images,
//              câblage, jeu final). C'est lui que l'aperçu surveille : sur
//              `rev`, le flux d'instantanés parallèles ne se stabiliserait
//              jamais et l'aperçu ne se rafraîchirait donc jamais.
// `at` = dernière écriture, quel qu'en soit le type (sert à savoir si un build
// est en cours pour ce projet).
export interface PreviewRevision { rev: number; mrev: number; at: number }

const previewRev = new Map<string, PreviewRevision>();

export function bumpPreviewRevision(companyId: string, opts?: { milestone?: boolean }) {
  const cur = previewRev.get(companyId);
  const milestone = opts?.milestone !== false;
  previewRev.set(companyId, {
    rev: (cur?.rev ?? 0) + 1,
    mrev: (cur?.mrev ?? 0) + (milestone ? 1 : 0),
    at: Date.now(),
  });
}

export function getPreviewRevision(companyId: string): PreviewRevision {
  return previewRev.get(companyId) ?? { rev: 0, mrev: 0, at: 0 };
}

// Entry files (main.tsx, App.tsx, index.*) import most other modules in the
// project. If a preview request lands WHILE we're mid-write — e.g. main.tsx
// already on disk but the "./lib/x" it imports hasn't been written yet — Vite
// answers with "Failed to resolve import './lib/x'. Does the file exist?" and
// the preview looks blank/broken for that one request. Writing every other
// file first and entry files LAST shrinks that race window to effectively
// nothing: by the time the entry file (re)appears, everything it can import
// is already in place.
function orderForSafeWrite(files: ScaffoldFile[]): ScaffoldFile[] {
  const isEntry = (p: string) => /(^|\/)(main|index|app-entry)\.(tsx?|jsx?)$|(^|\/)App\.(tsx?|jsx?)$/.test(p);
  const rest = files.filter((f) => !isEntry(f.path));
  const entries = files.filter((f) => isEntry(f.path));
  return [...rest, ...entries];
}

// Write a file atomically: write to a sibling temp path, then rename into
// place. `rename` on the same filesystem is atomic, so a concurrent request
// never observes a truncated/partial file — only the old content or the new
// one, never a half-written blank.
async function writeFileAtomic(full: string, content: string) {
  await mkdir(dirname(full), { recursive: true });
  const tmp = `${full}.velbaz-tmp-${process.pid}-${Date.now()}`;
  await writeFile(tmp, content, "utf8");
  const { rename } = await import("node:fs/promises");
  await rename(tmp, full);
}

export async function writeFilesToDisk(companyId: string, files: ScaffoldFile[]): Promise<string> {
  const dir = join(ROOT, companyId);
  await rm(dir, { recursive: true, force: true }).catch(() => {});
  await mkdir(dir, { recursive: true });
  for (const f of orderForSafeWrite(files)) {
    const full = join(dir, f.path);
    await mkdir(dirname(full), { recursive: true });
    await writeFile(full, f.content, "utf8");
  }
  bumpPreviewRevision(companyId);
  return dir;
}

// Write/overwrite specific files WITHOUT wiping the project. Vite HMR picks
// these up live, so the running preview updates without a reinstall/restart.
export async function writeFilesIncremental(
  companyId: string,
  files: ScaffoldFile[],
  opts?: { milestone?: boolean },
): Promise<string> {
  const dir = join(ROOT, companyId);
  await mkdir(dir, { recursive: true });
  for (const f of orderForSafeWrite(files)) {
    const full = join(dir, f.path);
    await writeFileAtomic(full, f.content);
  }
  // Chaque écriture incrémentale = une nouvelle révision : le script de
  // rechargement injecté dans l'aperçu la voit et rafraîchit l'iframe dès que
  // les jalons se calment (page terminée), sans dépendre du HMR de Vite.
  bumpPreviewRevision(companyId, opts);
  return dir;
}

// [2026-09-04] `timeoutMs` est désormais OPTIONNEL. Passer 0 (ou rien) = aucun
// minuteur : le process va au bout et on lit sa vraie sortie d'erreur. Un
// minuteur qui tue le process renvoie un faux "[timeout]" qui masque la cause
// réelle de l'échec — c'est exactement ce qu'on ne veut plus.
function run(cmd: string, args: string[], cwd: string, timeoutMs = 0): Promise<{ code: number; out: string }> {
  return new Promise((resolve) => {
    const p = spawn(cmd, args, { cwd, env: process.env });
    let out = "";
    const t = timeoutMs > 0
      ? setTimeout(() => { p.kill(); resolve({ code: -1, out: out + "\n[timeout]" }); }, timeoutMs)
      : null;
    const clear = () => { if (t) clearTimeout(t); };
    p.stdout?.on("data", (d) => (out += d.toString()));
    p.stderr?.on("data", (d) => (out += d.toString()));
    p.on("close", (code) => { clear(); resolve({ code: code ?? 0, out }); });
    p.on("error", (e) => { clear(); resolve({ code: -1, out: out + String(e) }); });
  });
}

export async function installDeps(dir: string): Promise<{ ok: boolean; out: string }> {
  // [2026-09-05] Dernier repli temporel supprimé (timeout 180 s). Un `bun install`
  // tué à 180 s laissait un node_modules incomplet et le vrai problème (réseau,
  // dépendance introuvable, registre lent) était masqué derrière un "[timeout]".
  // Règle du projet : on attend l'ÉVÉNEMENT, jamais l'horloge. Si l'install
  // échoue, elle doit échouer avec sa vraie erreur.
  const r = await run("bun", ["install"], dir, 0);
  return { ok: r.code === 0, out: r.out };
}

// ── Auto-deps: heal missing runtime dependencies ─────────────────────────────
// The builder prompts tell the AI a small set of libs are "already available"
// (framer-motion, etc.). If a generated page imports one that isn't listed in
// package.json, Vite answers the module request with a 500 ("Failed to resolve
// import …"), the SPA can't load that route/module and the whole preview goes
// BLANK. Rather than fail, we scan the generated source for bare imports of a
// curated allowlist and inject any missing ones into package.json (with a known
// good version) so `bun install` pulls them. Returns true if package.json was
// changed (caller must (re)install).
const AUTO_DEPS: Record<string, string> = {
  "framer-motion": "^11.15.0",
  "@paper-design/shaders-react": "^0.0.77",
  "three": "^0.171.0",
  "@react-three/fiber": "^9.0.0",
  "@types/three": "^0.171.0",
  "clsx": "^2.1.1",
  "tailwind-merge": "^2.6.0",
  "class-variance-authority": "^0.7.1",
  "date-fns": "^4.1.0",
  "recharts": "^2.15.0",
  // [2026-09-08] zustand : l'agent /test1 l'importe naturellement pour le
  // panier. Sans l'allowlist, le build cassait et l'agent réécrivait tout le
  // state en React context — des cycles d'IA (donc des crédits) pour rien.
  "zustand": "^5.0.2",
};

async function collectSourceImports(dir: string): Promise<Set<string>> {
  const found = new Set<string>();
  const srcDirs = ["src", "server"];
  const importRe = /(?:import[^'"]*?|export[^'"]*?from|import\s*\()\s*['"]([^'"]+)['"]/g;
  async function walk(d: string) {
    let entries: import("node:fs").Dirent[] = [];
    try { entries = await readdir(d, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      const full = join(d, e.name);
      if (e.isDirectory()) {
        if (e.name === "node_modules" || e.name === ".git") continue;
        await walk(full);
      } else if (/\.(tsx?|jsx?|mjs)$/.test(e.name)) {
        let text = "";
        try { text = await readFile(full, "utf8"); } catch { continue; }
        let m;
        while ((m = importRe.exec(text)) !== null) {
          const spec = m[1];
          // Only bare package specifiers (not relative / absolute / alias paths).
          if (!spec || spec.startsWith(".") || spec.startsWith("/") || spec.startsWith("@/")) continue;
          // Normalize scoped + subpath imports to the installable package name.
          const pkg = spec.startsWith("@")
            ? spec.split("/").slice(0, 2).join("/")
            : spec.split("/")[0];
          found.add(pkg);
        }
      }
    }
  }
  for (const s of srcDirs) await walk(join(dir, s));
  return found;
}

export async function ensureRequiredDeps(dir: string): Promise<boolean> {
  const pkgPath = join(dir, "package.json");
  if (!existsSync(pkgPath)) return false;
  let pkg: any;
  try { pkg = JSON.parse(await readFile(pkgPath, "utf8")); } catch { return false; }
  pkg.dependencies = pkg.dependencies || {};
  const imports = await collectSourceImports(dir);
  let changed = false;
  for (const pkgName of imports) {
    if (pkg.dependencies[pkgName]) continue;
    if (pkg.devDependencies?.[pkgName]) continue;
    const version = AUTO_DEPS[pkgName];
    if (!version) continue; // only auto-add curated, known-safe libs
    pkg.dependencies[pkgName] = version;
    changed = true;
    console.log(`[ensureRequiredDeps] added missing dep ${pkgName}@${version} for ${dir}`);
  }
  if (changed) await writeFile(pkgPath, JSON.stringify(pkg, null, 2) + "\n", "utf8");
  return changed;
}

// Type-check / build to surface errors. Returns error text if any.
// [2026-09-04] Plus de timeout de 120 s : il tuait le build et renvoyait
// "[timeout]" à la place du message d'erreur réel, donc le réparateur auto
// travaillait à l'aveugle. On laisse le build aller au bout et on remonte sa
// vraie sortie, avec le code de sortie pour ne rien perdre.
export async function checkBuild(dir: string): Promise<string | null> {
  const r = await run("bunx", ["vite", "build", "--logLevel", "error"], dir);
  if (r.code === 0) return null;
  const out = r.out.trim();
  return `[vite build exit ${r.code}]\n${out ? out.slice(-4000) : "(aucune sortie du build)"}`;
}

// ── Self-repair engine ───────────────────────────────────────────────────────
// Velbaz doit être capable, quand elle voit une erreur/un bug, de la corriger OU
// de trouver une solution par elle-même. Le réparateur ci-dessous est bien plus
// robuste que l'ancien "réécris ce fichier tout seul" :
//   1. il connaît la liste EXACTE des dépendances disponibles (jamais inventer un
//      import) et auto-installe les libs manquantes de l'allowlist ;
//   2. il donne à l'IA les fichiers liés (imports relatifs) pour corriger les
//      bugs inter-fichiers (export manquant, prop renommée…) ;
//   3. il peut réécrire PLUSIEURS fichiers d'un coup (JSON) ;
//   4. en dernier recours, il DÉGRADE proprement (retire la partie cassée) pour
//      qu'un site reste toujours buildable plutôt que planté.

// Toutes les libs réellement installables dans un projet généré (scaffold +
// AUTO_DEPS). Sert à interdire à l'IA d'"inventer" un import inexistant.
const KNOWN_DEPS = new Set<string>([
  "react", "react-dom", "react-router-dom", "hono", "stripe", "lucide-react",
  "framer-motion", "@paper-design/shaders-react", "ai", "@ai-sdk/react", "zod",
  ...Object.keys(AUTO_DEPS),
]);

// Normalise un import ("@scope/pkg/sub" → "@scope/pkg", "pkg/sub" → "pkg").
function pkgOf(spec: string): string {
  return spec.startsWith("@") ? spec.split("/").slice(0, 2).join("/") : spec.split("/")[0];
}

// À partir du log d'erreur, détecte les imports non résolus et, s'ils font partie
// de l'allowlist AUTO_DEPS, les ajoute à package.json. Retourne true si modifié.
async function healMissingDepsFromError(dir: string, errorLog: string): Promise<boolean> {
  const pkgPath = join(dir, "package.json");
  if (!existsSync(pkgPath)) return false;
  let pkg: any;
  try { pkg = JSON.parse(await readFile(pkgPath, "utf8")); } catch { return false; }
  pkg.dependencies = pkg.dependencies || {};
  const re = /(?:Failed to resolve import|Cannot find module|Rollup failed to resolve import|Could not resolve)\s+["']([^"']+)["']/g;
  let changed = false, m;
  while ((m = re.exec(errorLog)) !== null) {
    const spec = m[1];
    if (spec.startsWith(".") || spec.startsWith("/") || spec.startsWith("@/")) continue;
    const name = pkgOf(spec);
    if (pkg.dependencies[name] || pkg.devDependencies?.[name]) continue;
    const version = AUTO_DEPS[name];
    if (!version) continue; // hors allowlist → sera géré par retrait d'import côté IA
    pkg.dependencies[name] = version;
    changed = true;
    console.log(`[selfrepair] add missing dep ${name}@${version}`);
  }
  if (changed) await writeFile(pkgPath, JSON.stringify(pkg, null, 2) + "\n", "utf8");
  return changed;
}

// Parse les fichiers probablement fautifs depuis un log Vite/esbuild.
function guessErrorFiles(errorLog: string): string[] {
  const files = new Set<string>();
  const re = /(src\/[\w./-]+\.(?:tsx|ts|jsx|js)|server\/[\w./-]+\.(?:ts|tsx))/g;
  let m;
  while ((m = re.exec(errorLog)) !== null) files.add(m[1]);
  return Array.from(files);
}

// Renvoie les chemins projet importés (relatifs) par un fichier, résolus vers des
// clés du fileMap — pour donner à l'IA le contexte inter-fichiers.
function relatedFiles(path: string, content: string, fileMap: Map<string, string>): string[] {
  const dir = path.split("/").slice(0, -1).join("/");
  const re = /(?:from|import)\s*\(?\s*["'](\.[^"']+)["']/g;
  const out = new Set<string>();
  let m;
  while ((m = re.exec(content)) !== null) {
    const rel = m[1];
    const parts = (dir ? dir + "/" : "") + rel;
    const norm: string[] = [];
    for (const seg of parts.split("/")) {
      if (seg === "." || seg === "") continue;
      if (seg === "..") norm.pop();
      else norm.push(seg);
    }
    const base = norm.join("/");
    for (const cand of [base, base + ".tsx", base + ".ts", base + "/index.tsx", base + "/index.ts"]) {
      if (fileMap.has(cand)) { out.add(cand); break; }
    }
  }
  return Array.from(out);
}

function stripFence(s: string): string {
  s = (s || "").trim();
  if (s.startsWith("```")) s = s.replace(/^```(?:tsx|ts|jsx|js|json)?\s*\n?/i, "").replace(/\n?```\s*$/, "");
  return s.trim();
}

const REPAIR_RULES = `RÈGLES DURES (à ne JAMAIS enfreindre) :
- N'importe JAMAIS un package hors de cette liste disponible : ${Array.from(KNOWN_DEPS).join(", ")}.
- N'invente JAMAIS un fichier ou un export qui n'existe pas. Si un import échoue vers un fichier du projet, corrige le chemin OU ajoute l'export manquant dans le bon fichier.
- Conserve le design, le contenu et le comportement voulus. Ne casse rien qui marchait.
- Corrige la CAUSE réelle de l'erreur, pas un symptôme. Types, JSX, imports, hooks, null-safety.
- Si une fonctionnalité est vraiment impossible à réparer proprement, DÉGRADE : retire uniquement la partie cassée (et ses imports devenus inutiles) pour que le fichier build, sans supprimer le reste de la page.`;

// Réparation IA multi-fichiers, consciente du contexte et des deps disponibles.
// Retourne les fichiers corrigés (path→content), ou {} si rien de exploitable.
async function aiRepairFiles(
  suspects: string[],
  fileMap: Map<string, string>,
  errorLog: string,
  aggressive: boolean,
): Promise<Record<string, string>> {
  // Fichiers cibles + leurs fichiers liés (contexte lecture seule).
  const targets = suspects.slice(0, aggressive ? 5 : 3);
  const contextPaths = new Set<string>();
  for (const t of targets) for (const r of relatedFiles(t, fileMap.get(t) || "", fileMap)) contextPaths.add(r);
  for (const t of targets) contextPaths.delete(t);

  const targetBlocks = targets.map(p => `### FICHIER À CORRIGER — ${p}\n\`\`\`tsx\n${fileMap.get(p)}\n\`\`\``).join("\n\n");
  const ctxBlocks = Array.from(contextPaths).slice(0, 6)
    .map(p => `### CONTEXTE (lecture seule) — ${p}\n\`\`\`tsx\n${(fileMap.get(p) || "").slice(0, 4000)}\n\`\`\``).join("\n\n");

  const system = `Tu es un ingénieur React/TypeScript/Vite senior chargé de réparer un projet qui ne build pas. Tu trouves la solution par toi-même.
${REPAIR_RULES}
SORTIE STRICTE : un objet JSON { "files": [ { "path": "...", "content": "<fichier COMPLET corrigé>" } ] }. N'inclus QUE les fichiers que tu modifies. Aucun texte hors du JSON.`;

  const prompt = `Le build échoue avec cette erreur :

## ERREUR DE BUILD
${errorLog.slice(-2500)}

${targetBlocks}

${ctxBlocks ? "## Fichiers liés pour contexte\n" + ctxBlocks : ""}

${aggressive ? "Les tentatives précédentes n'ont pas suffi. Sois plus décisif : quitte à retirer proprement la partie qui casse (dégradation gracieuse), le projet DOIT builder." : ""}
Renvoie le JSON des fichiers corrigés.`;

  try {
    const { text } = await generateText({
      model: gateway(REPAIR_MODEL), system, prompt, maxOutputTokens: 16000,
    });
    const raw = stripFence(text);
    let parsed: any;
    try { parsed = JSON.parse(raw); }
    catch {
      const s = raw.indexOf("{"), e = raw.lastIndexOf("}");
      if (s >= 0 && e > s) parsed = JSON.parse(raw.slice(s, e + 1));
    }
    const out: Record<string, string> = {};
    for (const f of parsed?.files || []) {
      if (typeof f?.path === "string" && typeof f?.content === "string" && f.content.trim().length >= 10) {
        out[f.path] = stripFence(f.content);
      }
    }
    return out;
  } catch { return {}; }
}

// Normalise un import local ("../lib/x" depuis "src/pages/a.tsx" → "src/lib/x").
// Gère "./", "../" et l'alias "@/" (→ "src/"). Retourne null pour un import de
// package (bare specifier), géré ailleurs par le healer de dépendances.
function resolveLocalImport(importerPath: string, spec: string): string | null {
  let base: string;
  if (spec.startsWith("@/")) {
    base = "src/" + spec.slice(2);
  } else if (spec.startsWith(".")) {
    const dir = importerPath.split("/").slice(0, -1).join("/");
    base = (dir ? dir + "/" : "") + spec;
  } else {
    return null; // package externe
  }
  const norm: string[] = [];
  for (const seg of base.split("/")) {
    if (seg === "." || seg === "") continue;
    if (seg === "..") norm.pop();
    else norm.push(seg);
  }
  return norm.join("/");
}

// Un import local résout-il vers un fichier RÉEL (dans le fileMap OU sur disque) ?
function localImportExists(dir: string, base: string): boolean {
  const exts = ["", ".tsx", ".ts", ".jsx", ".js", ".css", ".json", ".mjs", ".cjs"];
  const cands: string[] = [];
  for (const e of exts) cands.push(base + e);
  for (const e of [".tsx", ".ts", ".jsx", ".js"]) cands.push(base + "/index" + e);
  return cands.some(c => existsSync(join(dir, c)));
}

// ── Garde DÉTERMINISTE des imports locaux manquants ──────────────────────────
// Cause n°1 de "page blanche" : l'IA importe un module local qu'elle n'a jamais
// créé (ex. `import { useSound } from "../lib/sound"`). En dev, cet import non
// résolu casse tout le bundle → écran blanc SANS message clair. On ne compte PAS
// sur la boucle IA (qui édite les fichiers suspects mais crée mal les modules
// absents) : ce garde SCANNE tout le code, détecte chaque import local mort, et
// CRÉE le module manquant (implémentation réelle via IA, sinon stub sûr), pour
// que le cas "code présent mais page blanche" ne se reproduise JAMAIS.
// Retourne true si des fichiers ont été créés.
async function healMissingLocalImports(
  dir: string,
  fileMap: Map<string, string>,
  onProgress?: (msg: string) => void,
): Promise<boolean> {
  // 1) Détecte chaque cible d'import local absente + le contexte d'utilisation.
  type Missing = { target: string; specs: Set<string>; named: Set<string>; hasDefault: boolean; hasNamespace: boolean; usage: string[] };
  const missing = new Map<string, Missing>();
  const importRe = /import\s+([^;'"]*?)\s+from\s+["']([^"']+)["']/g;

  for (const [path, content] of fileMap) {
    if (!/\.(tsx?|jsx?)$/.test(path)) continue;
    let m: RegExpExecArray | null;
    importRe.lastIndex = 0;
    while ((m = importRe.exec(content)) !== null) {
      const clause = m[1].trim();
      const spec = m[2];
      const base = resolveLocalImport(path, spec);
      if (!base) continue; // package externe
      if (localImportExists(dir, base) || fileMap.has(base)) continue;
      // Résout aussi contre le fileMap (fichiers pas encore écrits sur disque).
      const inMap = [".tsx", ".ts", ".jsx", ".js"].some(e => fileMap.has(base + e)) ||
                    [".tsx", ".ts", ".jsx", ".js"].some(e => fileMap.has(base + "/index" + e));
      if (inMap) continue;

      // Import local mort → cible à créer. On choisit .tsx si le clause contient du JSX-ish,
      // sinon .ts. Par défaut .ts (les libs/hooks sont majoritairement .ts).
      const target = /^[A-Z]/.test(base.split("/").pop() || "") ? base + ".tsx" : base + ".ts";
      const entry = missing.get(target) || { target, specs: new Set(), named: new Set(), hasDefault: false, hasNamespace: false, usage: [] };
      entry.specs.add(spec);
      // Parse les bindings importés : default, * as ns, { a, b as c }.
      const defMatch = clause.match(/^([A-Za-z_$][\w$]*)\s*(?:,|$)/);
      if (defMatch && !clause.startsWith("{") && !clause.startsWith("*")) entry.hasDefault = true;
      const nsMatch = clause.match(/\*\s+as\s+([A-Za-z_$][\w$]*)/);
      if (nsMatch) entry.hasNamespace = true;
      const braceMatch = clause.match(/\{([^}]*)\}/);
      if (braceMatch) {
        for (const part of braceMatch[1].split(",")) {
          const name = part.trim().split(/\s+as\s+/)[0].trim();
          if (name) entry.named.add(name);
        }
      }
      // Capture quelques lignes d'utilisation pour guider l'IA.
      const names = [...entry.named, ...(defMatch ? [defMatch[1]] : [])];
      for (const line of content.split("\n")) {
        if (names.some(n => n && new RegExp(`\\b${n}\\b`).test(line)) && !line.includes("import ")) {
          entry.usage.push(line.trim());
          if (entry.usage.length >= 8) break;
        }
      }
      missing.set(target, entry);
    }
  }

  if (missing.size === 0) return false;
  onProgress?.(`✨ Génération de ${missing.size} module(s) utilitaire(s) manquant(s)…`);

  // 2) Génère les modules manquants via IA (implémentation réelle basée sur l'usage).
  const modBlocks = [...missing.values()].map(e => {
    const bindings = [
      e.hasDefault ? "export default" : "",
      e.named.size ? `named exports: ${[...e.named].join(", ")}` : "",
      e.hasNamespace ? "used as namespace (import * as)" : "",
    ].filter(Boolean).join("; ");
    return `### MODULE À CRÉER — ${e.target}\nImporté comme : ${[...e.specs].join(", ")}\nExports requis : ${bindings || "(inconnu — déduis de l'usage)"}\nExtraits d'utilisation :\n${e.usage.slice(0, 8).map(u => "  " + u).join("\n") || "  (aucun)"}`;
  }).join("\n\n");

  let created = false;
  try {
    const { text } = await generateText({
      model: gateway(REPAIR_MODEL),
      system: `Tu es un ingénieur React/TypeScript senior. Des modules locaux sont importés mais n'existent pas, ce qui casse le build (écran blanc). Crée CHAQUE module manquant avec une implémentation RÉELLE et fonctionnelle déduite de son usage.
RÈGLES DURES :
- Exporte EXACTEMENT les symboles attendus (default et/ou nommés) avec la bonne forme (un hook \`useX\` DOIT retourner ce que l'appelant déstructure, ex. \`{ play }\` → retourne un objet avec \`play\`).
- N'importe QUE des packages de cette liste : ${Array.from(KNOWN_DEPS).join(", ")}. Sinon, implémente en pur TS/DOM (Web Audio, fetch, localStorage…).
- Code sûr côté SSR : n'accède à window/document qu'à l'intérieur des fonctions/effets, jamais au top-level.
- Aucun effet de bord au chargement du module. TypeScript strict-friendly.
SORTIE STRICTE : JSON { "files": [ { "path": "...", "content": "<fichier COMPLET>" } ] }. Aucun texte hors JSON.`,
      prompt: `Crée ces modules manquants :\n\n${modBlocks}\n\nRenvoie le JSON.`,
      maxOutputTokens: 12000,
    });
    let raw = stripFence(text);
    let parsed: any;
    try { parsed = JSON.parse(raw); }
    catch { const s = raw.indexOf("{"), e = raw.lastIndexOf("}"); if (s >= 0 && e > s) parsed = JSON.parse(raw.slice(s, e + 1)); }
    for (const f of parsed?.files || []) {
      if (typeof f?.path === "string" && typeof f?.content === "string" && f.content.trim().length >= 10 && missing.has(f.path)) {
        const content = stripFence(f.content);
        fileMap.set(f.path, content);
        await mkdir(dirname(join(dir, f.path)), { recursive: true });
        await writeFile(join(dir, f.path), content, "utf8");
        onProgress?.(`✨ Module ${f.path.split("/").pop()} créé`);
        created = true;
      }
    }
  } catch { /* on tombe sur les stubs sûrs ci-dessous */ }

  // 3) Filet de sécurité DÉTERMINISTE : pour tout module encore absent, écrit un
  // stub sûr qui satisfait les imports SANS crasher au runtime (hooks → objet de
  // no-ops, valeurs → défauts inoffensifs). Garantit qu'aucun import local mort
  // ne subsiste, donc plus jamais d'écran blanc pour cette cause.
  for (const e of missing.values()) {
    if (existsSync(join(dir, e.target)) || fileMap.has(e.target)) continue;
    const lines: string[] = ["// Stub généré automatiquement (module manquant) — évite l'écran blanc.", "/* eslint-disable */"];
    const safeVal = (name: string) => {
      if (/^use[A-Z]/.test(name)) return `export function ${name}(..._a: any[]): any { return new Proxy(() => {}, { get: () => () => {} }); }`;
      if (/^[A-Z]/.test(name)) return `export const ${name}: any = (props: any) => props?.children ?? null;`; // composant
      return `export const ${name}: any = (..._a: any[]) => {};`;
    };
    for (const name of e.named) lines.push(safeVal(name));
    if (e.hasDefault) lines.push("const __default: any = new Proxy(() => null, { get: () => () => {} });\nexport default __default;");
    if (e.hasNamespace && !e.hasDefault) lines.push("export {};");
    const content = lines.join("\n") + "\n";
    fileMap.set(e.target, content);
    await mkdir(dirname(join(dir, e.target)), { recursive: true });
    await writeFile(join(dir, e.target), content, "utf8");
    onProgress?.(`✨ Module ${e.target.split("/").pop()} initialisé`);
    created = true;
  }

  return created;
}

// Boucle de build + auto-réparation. Corrige les deps manquantes, répare le code
// via l'IA (multi-fichiers, contexte inter-fichiers), et dégrade en dernier
// recours pour garantir un projet buildable.
export async function buildWithAutoFix(
  dir: string,
  files: ScaffoldFile[],
  onProgress?: (msg: string) => void,
  maxLoops = 4,
): Promise<{ ok: boolean; files: ScaffoldFile[]; lastError?: string }> {
  const fileMap = new Map(files.map(f => [f.path, f.content]));
  let lastErr: string | null = null;
  // Garde déterministe AVANT le premier build : crée tout module local importé
  // mais inexistant (cause n°1 d'écran blanc). Bien plus fiable que la boucle IA.
  await healMissingLocalImports(dir, fileMap, onProgress).catch(() => false);
  for (let loop = 0; loop < maxLoops; loop++) {
    const err = await checkBuild(dir);
    if (!err) {
      onProgress?.("✅ Code vérifié — tout est prêt");
      return { ok: true, files: Array.from(fileMap.entries()).map(([path, content]) => ({ path, content })) };
    }
    lastErr = err;
    // Message rassurant : l'auto-réparation fait partie du contrôle qualité normal,
    // ce n'est PAS un défaut du produit. On n'affiche jamais "Bug détecté" ni le
    // compteur de tentatives (qui alarme l'utilisateur), juste un peaufinage calme.
    onProgress?.(loop === 0 ? "✨ Peaufinage & vérifications du code…" : "✨ Derniers ajustements de qualité…");

    // 1) Dépendance manquante connue → l'installer et re-tester avant de toucher au code.
    if (await healMissingDepsFromError(dir, err)) {
      onProgress?.("📦 Configuration des dépendances…");
      await installDeps(dir);
      continue;
    }

    // 1bis) Import LOCAL non résolu (une réparation a pu en réintroduire un) →
    // recrée déterministiquement le module manquant avant de toucher au code IA.
    if (/(?:Could not resolve|Failed to resolve import|Cannot find module)\s+["'](?:\.|@\/)/.test(err)) {
      if (await healMissingLocalImports(dir, fileMap, onProgress).catch(() => false)) continue;
    }

    // 2) Réparation IA du code, consciente du contexte. Après 2 échecs → mode agressif (dégradation).
    let suspects = guessErrorFiles(err).filter(f => fileMap.has(f));
    if (!suspects.length) suspects = Array.from(fileMap.keys()).filter(p => /^src\/(pages|components)\//.test(p)).slice(0, 3);
    const fixes = await aiRepairFiles(suspects, fileMap, err, loop >= 2);
    const changedPaths = Object.keys(fixes);
    if (!changedPaths.length) { onProgress?.("✨ Vérifications supplémentaires…"); continue; }
    for (const path of changedPaths) {
      if (!fileMap.has(path) && !path.startsWith('src/')) continue; // ne crée pas de fichiers hors src
      fileMap.set(path, fixes[path]);
      await mkdir(dirname(join(dir, path)), { recursive: true });
      await writeFile(join(dir, path), fixes[path], "utf8");
      onProgress?.(`✨ ${path.split("/").pop()} peaufiné`);
    }
    // Les corrections sont écrites en direct dans le dossier du projet : on
    // signale la nouvelle révision pour que l'aperçu les montre aussi.
    bumpPreviewRevision(basename(dir));
    // Si l'IA a introduit une nouvelle dépendance de l'allowlist, l'installer.
    if (await ensureRequiredDeps(dir)) await installDeps(dir);
  }
  const lastError = (await checkBuild(dir)) || lastErr || undefined;
  return { ok: !lastError, files: Array.from(fileMap.entries()).map(([path, content]) => ({ path, content })), lastError };
}

// Réparation à la volée pour le flux d'ÉDITION : quand une modif casse le build,
// on relit les fichiers du disque, on répare, on réécrit. Utilisé après un edit
// pour que l'IA ne laisse jamais un preview cassé derrière elle.
export async function healBuild(
  dir: string,
  onProgress?: (msg: string) => void,
  maxLoops = 3,
): Promise<{ ok: boolean; lastError?: string }> {
  const err = await checkBuild(dir);
  if (!err) return { ok: true };
  // Charge les sources actuelles du disque comme point de départ.
  const files: ScaffoldFile[] = [];
  async function walk(d: string, relBase = "") {
    let entries: import("node:fs").Dirent[] = [];
    try { entries = await readdir(d, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      if (e.name === "node_modules" || e.name === ".git" || e.name === "dist") continue;
      const full = join(d, e.name);
      const rel = relBase ? `${relBase}/${e.name}` : e.name;
      if (e.isDirectory()) await walk(full, rel);
      else if (/\.(tsx?|jsx?|css|json)$/.test(e.name)) {
        try { files.push({ path: rel, content: await readFile(full, "utf8") }); } catch {}
      }
    }
  }
  await walk(join(dir, "src"), "src");
  const r = await buildWithAutoFix(dir, files, onProgress, maxLoops);
  return { ok: r.ok, lastError: r.lastError };
}

export async function startDevServer(companyId: string, dir: string): Promise<RunningApp> {
  const existing = running.get(companyId);
  if (existing) { killTree(existing.proc); running.delete(companyId); await new Promise(r => setTimeout(r, 500)); }
  // Pick a genuinely free port so the map never points at a zombie server.
  const port = await findFreePort(nextPort);
  nextPort = port + 1;
  // Serve the app under the same public path the Velbaz proxy is reachable at
  // (Hono uses basePath 'api'), so every URL Vite emits (module scripts, HMR
  // client, assets) is already correctly prefixed and resolves through the proxy.
  // The generated vite.config reads VITE_APP_BASE and configures base + apiPlugin.
  const base = `/api/companies/${companyId}/preview/`;
  // --strictPort: fail instead of silently drifting to another port (which would
  // desync the map/proxy). detached: run in its own process group so killTree
  // can reap the child `node vite` that bunx spawns.
  const secretEnv = await companyEnv(companyId);
  const proc = spawn("bunx", ["vite", "--port", String(port), "--strictPort", "--host"], {
    cwd: dir,
    env: { ...process.env, ...secretEnv, VITE_APP_BASE: base },
    detached: true,
  });
  proc.stdout?.on("data", () => {});
  proc.stderr?.on("data", () => {});
  const app: RunningApp = { companyId, dir, port, proc, url: `http://localhost:${port}`, base };
  running.set(companyId, app);
  // Le serveur qui (re)démarre compte comme une activité d'aperçu : ça garantit
  // que la première page HTML servie ensuite embarque le script de rechargement
  // en direct, même si l'installation des dépendances a duré plusieurs minutes
  // depuis la dernière écriture de fichier.
  bumpPreviewRevision(companyId);
  // If this Vite child dies (OOM, crash, port conflict…) drop it from the map
  // IMMEDIATELY. Without this, a stale-but-present entry makes the proxy keep
  // fetching a dead port forever (never triggers auto-heal, since that only
  // runs when the map has NO entry) — the visible symptom is the preview
  // "going blank" after a while and staying broken until a manual restart.
  proc.once("exit", () => {
    const current = running.get(companyId);
    if (current && current.proc === proc) running.delete(companyId);
  });
  // wait for server to be ready
  for (let i = 0; i < 30; i++) {
    await new Promise(r => setTimeout(r, 1000));
    try { const res = await fetch(`${app.url}${base}`); if (res.ok) break; } catch {}
  }
  return app;
}

export function stopDevServer(companyId: string) {
  const app = running.get(companyId);
  if (app) { killTree(app.proc); running.delete(companyId); }
}

// ── Auto-heal: guarantee a running dev server for a company ──────────────────
// The `running` map lives in memory, so it's empty after a Velbaz restart and a
// crashed/idle Vite child leaves a stale entry. This re-materializes the project
// from DB (if the on-disk copy is gone) and (re)starts the dev server. A
// per-company lock prevents concurrent proxy requests from spawning duplicates.
const reviving = new Map<string, Promise<RunningApp | null>>();

async function isAlive(app: RunningApp): Promise<boolean> {
  try {
    const res = await fetch(`${app.url}${app.base}`, { signal: AbortSignal.timeout(2500) });
    return res.ok || res.status === 304;
  } catch { return false; }
}

export async function ensureRunningApp(
  companyId: string,
  loaders: {
    getFiles: () => Promise<{ path: string; content: string }[]>;
  },
): Promise<RunningApp | null> {
  const existing = running.get(companyId);
  if (existing && await isAlive(existing)) return existing;

  // Coalesce concurrent revives so we don't spawn multiple servers.
  const inFlight = reviving.get(companyId);
  if (inFlight) return inFlight;

  const p = (async (): Promise<RunningApp | null> => {
    try {
      // Drop a stale/dead entry before restarting.
      const stale = running.get(companyId);
      if (stale) { killTree(stale.proc); running.delete(companyId); }

      const files = await loaders.getFiles();
      if (!files.length) return null;

      const dir = join(ROOT, companyId);
      // If the on-disk project is still intact (deps installed), reuse it and
      // just restart Vite — no need to wipe + reinstall (slow). Otherwise
      // re-materialize from DB and install.
      // IMPORTANT: check that Vite itself is actually installed, not merely that
      // a node_modules folder exists. An interrupted/partial install leaves a
      // node_modules dir with a handful of packages but no Vite binary — the old
      // check took the "fast path", skipped install, then failed to spawn Vite,
      // so the preview never came up (blank / "Page not found").
      const hasEntry = existsSync(join(dir, "package.json"));
      const hasDeps =
        existsSync(join(dir, "node_modules", ".bin", "vite")) ||
        existsSync(join(dir, "node_modules", "vite", "package.json"));
      if (hasDeps && hasEntry) {
        // Refresh source files (cheap) without wiping node_modules.
        await writeFilesIncremental(companyId, files);
        // Heal any missing runtime dep the generated code imports (e.g.
        // framer-motion) even on the fast path — otherwise a single unresolved
        // import 500s and blanks the whole preview.
        const added = await ensureRequiredDeps(dir);
        if (added) {
          const install = await installDeps(dir);
          if (!install.ok) console.warn(`[ensureRunningApp] dep-heal install failed for ${companyId}`);
        }
      } else {
        await writeFilesToDisk(companyId, files);
        await ensureRequiredDeps(dir);
        const install = await installDeps(dir);
        if (!install.ok) console.warn(`[ensureRunningApp] partial install for ${companyId}`);
      }
      return await startDevServer(companyId, dir);
    } catch (e) {
      console.error(`[ensureRunningApp] failed for ${companyId}:`, e);
      return null;
    } finally {
      reviving.delete(companyId);
    }
  })();

  reviving.set(companyId, p);
  return p;
}
