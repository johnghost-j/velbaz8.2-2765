// ─── QA LIVE de fin de build ─────────────────────────────────────────────────
// Le QA statique (qa.ts) analyse le CODE. Ce module teste l'APP QUI TOURNE:
// après le build, on dresse une "carte" de l'app (routes, pages, actions),
// puis un vrai navigateur (Chrome headless via playwright-core) visite chaque
// page via le lien de prévisualisation, clique les boutons, remplit les
// formulaires, et collecte les bugs RÉELS (erreurs JS, pages blanches,
// requêtes HTTP échouées). Les bugs sont ensuite envoyés à l'IA qui les
// corrige TOUS en diffs ciblés (SEARCH/REPLACE), appliqués à chaud (HMR),
// puis on re-teste. Max 2 tours: carte → test → fix → re-test.

import { generateText } from "ai";
import { gateway } from "../agent/gateway";
import { applySearchReplace } from "./qa";
/** Forme structurelle minimale d'un plan, derivee de ce que ce module LIT
 *  reellement (buildAppMap). Pas d'import depuis engine.ts : n'importe quel
 *  producteur de site qui expose ces champs satisfait ce type. Le typage
 *  structurel de TS fait que le plan du planner continue de passer sans
 *  aucune annotation cote appelant. */
export type LiveQAPlan = {
  appType?: string;
  pages?: Array<{
    name: string;
    route: string;
    file: string;
    purpose?: string;
    hasForm?: boolean;
    isCore?: boolean;
  }>;
  entities?: Array<{ collection: string; fields: string }>;
};
import type { ScaffoldFile } from "./scaffold";
import { importOptional } from '../lib/optional-import';

const QA_MODEL = "anthropic/claude-sonnet-4.6";

// ─── Types ───────────────────────────────────────────────────────────────────

export interface AppMapRoute {
  name: string;
  route: string;
  file: string;
  purpose?: string;
  hasForm?: boolean;
  isCore?: boolean;
  /** Route dynamique (:param) → non testable en accès direct. */
  dynamic: boolean;
}

export interface AppMap {
  appType: string;
  routes: AppMapRoute[];
  entities: Array<{ collection: string; fields: string }>;
  builtAt: string;
}

export interface LiveBug {
  route: string;
  page: string; // nom de la page (plan)
  file: string; // fichier source probable
  kind: "pageerror" | "console" | "http" | "blank" | "interaction";
  message: string;
  detail?: string;
}

export interface LiveQAResult {
  routesTested: number;
  bugs: LiveBug[];
  rounds: number;
  fixedFiles: string[];
}

type Progress = (msg: string) => void;

// ─── 1. Carte de l'app ───────────────────────────────────────────────────────

export function buildAppMap(plan: LiveQAPlan | undefined | null, files: ScaffoldFile[]): AppMap {
  const pages = plan?.pages || [];
  const fileSet = new Set(files.map(f => f.path));
  const routes: AppMapRoute[] = pages.map(p => ({
    name: p.name,
    route: p.route,
    file: fileSet.has(`src/pages/${p.file}`) ? `src/pages/${p.file}` : p.file,
    purpose: p.purpose,
    hasForm: p.hasForm,
    isCore: p.isCore,
    dynamic: p.route.includes(":"),
  }));
  return {
    appType: plan?.appType || "app",
    routes,
    entities: (plan?.entities || []).map(e => ({ collection: e.collection, fields: e.fields })),
    builtAt: new Date().toISOString(),
  };
}

// ─── 2. Test live d'une app qui tourne ───────────────────────────────────────

const CHROME_PATHS = ["/usr/bin/google-chrome", "/usr/bin/google-chrome-stable", "/usr/bin/chromium"];

async function launchBrowser() {
  const { chromium } = await importOptional<typeof import('playwright-core')>('playwright-core');
  const { existsSync } = await import("node:fs");
  const executablePath = CHROME_PATHS.find(p => existsSync(p));
  if (!executablePath) throw new Error("Chrome introuvable pour le QA live");
  return chromium.launch({
    executablePath,
    headless: true,
    args: ["--no-sandbox", "--disable-dev-shm-usage", "--disable-gpu"],
  });
}

/** Filtre le bruit: erreurs qui ne viennent pas de l'app elle-même. */
function isNoise(msg: string): boolean {
  const noise = [
    "favicon", "net::ERR_ABORTED", "Download the React DevTools",
    "was preloaded using link preload", "third-party cookie",
    "[vite] connecting", "[vite] connected", "ResizeObserver loop",
    // Les échecs réseau sont déjà captés proprement (avec l'URL) par le
    // listener "response" — la version console est du bruit dupliqué.
    "Failed to load resource",
  ];
  return noise.some(n => msg.includes(n));
}

/**
 * Visite chaque route de la carte via le navigateur, collecte les erreurs JS,
 * les pages blanches et les requêtes échouées, puis fait une passe
 * d'interaction bornée (clics de boutons, remplissage de formulaires).
 */
export async function runLiveQA(
  baseUrl: string, // ex: http://localhost:5200/api/companies/<id>/preview/
  map: AppMap,
  onProgress?: Progress,
  isCancelled?: () => boolean,
): Promise<LiveBug[]> {
  const bugs: LiveBug[] = [];
  const testable = map.routes.filter(r => !r.dynamic);
  const browser = await launchBrowser();
  try {
    const ctx = await browser.newContext({ viewport: { width: 1366, height: 900 } });
    for (const r of testable) {
      if (isCancelled?.()) break;
      const pageBugs: LiveBug[] = [];
      const page = await ctx.newPage();
      const seen = new Set<string>();
      const add = (kind: LiveBug["kind"], message: string, detail?: string) => {
        const key = `${kind}|${message.slice(0, 160)}`;
        if (seen.has(key) || isNoise(message)) return;
        seen.add(key);
        pageBugs.push({ route: r.route, page: r.name, file: r.file, kind, message: message.slice(0, 500), detail });
      };
      page.on("pageerror", err => add("pageerror", String(err?.message || err)));
      page.on("console", msg => { if (msg.type() === "error") add("console", msg.text()); });
      page.on("response", res => {
        const s = res.status();
        if (s >= 400 && res.url().startsWith(baseUrl.replace(/\/api\/.*/, ""))) {
          const u = res.url();
          if (!u.includes("favicon")) add("http", `HTTP ${s} sur ${u.slice(0, 200)}`);
        }
      });

      const target = baseUrl.replace(/\/$/, "") + r.route;
      try {
        await page.goto(target, { waitUntil: "networkidle", timeout: 15000 });
      } catch (e: any) {
        add("blank", `Navigation échouée vers ${r.route}: ${String(e?.message || e).slice(0, 200)}`);
      }
      await page.waitForTimeout(600);

      // Page blanche = le rendu React a planté (souvent une erreur non catchée).
      try {
        const text = (await page.evaluate(() => document.body?.innerText || "")) as string;
        if (text.trim().length < 20) add("blank", `Page "${r.name}" (${r.route}) quasi vide — rendu React probablement planté`);
      } catch { /* page fermée/crashée */ }

      // ── Passe d'interaction bornée ──
      try {
        // Remplir les champs texte visibles avant de cliquer (les submits testent
        // alors le vrai chemin "création").
        const inputs = page.locator('input:visible:not([type=hidden]):not([type=checkbox]):not([type=radio]):not([type=file]), textarea:visible');
        const nInputs = Math.min(await inputs.count(), 8);
        for (let i = 0; i < nInputs; i++) {
          try {
            const el = inputs.nth(i);
            const type = (await el.getAttribute("type")) || "text";
            const val = type === "email" ? "test@velbaz.app" : type === "number" ? "3" : type === "date" ? "2026-07-14" : "Test";
            await el.fill(val, { timeout: 1500 });
          } catch { /* champ readonly/disabled */ }
        }
        // Cliquer jusqu'à ~12 boutons par page. On reste sur la page (on re-goto
        // si un clic a navigué) pour garder le contexte de test.
        const buttons = page.locator("button:visible");
        const nBtns = Math.min(await buttons.count(), 12);
        for (let i = 0; i < nBtns; i++) {
          if (isCancelled?.()) break;
          try {
            const el = buttons.nth(i);
            const label = ((await el.innerText().catch(() => "")) || "").trim().slice(0, 40);
            // Éviter les actions destructrices en boucle et les déconnexions.
            if (/suppr|delete|logout|déconne/i.test(label)) continue;
            await el.click({ timeout: 2000, force: false });
            await page.waitForTimeout(350);
            if (!page.url().startsWith(target)) {
              await page.goto(target, { waitUntil: "domcontentloaded", timeout: 10000 }).catch(() => {});
              await page.waitForTimeout(300);
            }
          } catch { /* bouton détaché/recouvert — pas un bug en soi */ }
        }
      } catch { /* la page a crashé pendant l'interaction — les listeners ont capté l'erreur */ }

      await page.close().catch(() => {});
      if (pageBugs.length) {
        onProgress?.(`🐛 ${r.name} (${r.route}) — ${pageBugs.length} problème(s) détecté(s)`);
        bugs.push(...pageBugs);
      } else {
        onProgress?.(`✔️ ${r.name} (${r.route}) — OK`);
      }
    }
    await ctx.close().catch(() => {});
  } finally {
    await browser.close().catch(() => {});
  }
  return bugs;
}

// ─── 3. Correction automatique des bugs détectés ─────────────────────────────

/**
 * Regroupe les bugs par fichier source, envoie code + bugs au modèle QA qui
 * renvoie des diffs SEARCH/REPLACE, applique localement. Retourne les fichiers
 * modifiés (à réécrire sur disque + re-persister en DB).
 */
export async function fixBugsLive(
  bugs: LiveBug[],
  files: ScaffoldFile[],
  onProgress?: Progress,
): Promise<ScaffoldFile[]> {
  const byFile = new Map<string, LiveBug[]>();
  for (const b of bugs) {
    const key = b.file;
    if (!byFile.has(key)) byFile.set(key, []);
    byFile.get(key)!.push(b);
  }
  const changed: ScaffoldFile[] = [];
  for (const [filePath, fileBugs] of byFile) {
    const file = files.find(f => f.path === filePath || f.path.endsWith(`/${filePath}`));
    if (!file) continue;
    onProgress?.(`🔧 Correction de ${filePath} (${fileBugs.length} bug(s))…`);
    const bugList = fileBugs.map((b, i) =>
      `${i + 1}. [${b.kind}] sur ${b.route}: ${b.message}${b.detail ? `\n   Détail: ${b.detail}` : ""}`).join("\n");
    const prompt = `Un test AUTOMATISÉ dans un vrai navigateur (Chrome) a détecté ces bugs RÉELS à l'exécution sur la page "${fileBugs[0].page}":

## BUGS DÉTECTÉS EN LIVE
${bugList}

## CODE ACTUEL (${filePath})
\`\`\`tsx
${file.content}
\`\`\`

## MISSION
Corrige TOUS ces bugs. Causes fréquentes: accès à une propriété d'un objet undefined/null (ajouter des gardes ?. et des états de chargement), .map sur non-tableau, appel API vers une route inexistante (corriger l'URL ou gérer l'erreur), handler qui throw, état initial incorrect.

## FORMAT DE RÉPONSE — DIFFS CIBLÉS UNIQUEMENT
<<<<<<< SEARCH
(extrait EXACT du code actuel, copié caractère pour caractère, assez long pour être unique)
=======
(le remplacement corrigé)
>>>>>>> REPLACE

Règles: le SEARCH doit exister TEL QUEL dans le code. Un bloc par bug. Aucun texte hors des blocs.`;
    try {
      const { text } = await generateText({
        model: gateway(QA_MODEL),
        system: "Tu es un expert React/TypeScript qui corrige des bugs d'exécution détectés par des tests navigateur automatisés. Tu réponds UNIQUEMENT en blocs SEARCH/REPLACE.",
        prompt,
        maxOutputTokens: 8000,
      });
      const { code, applied } = applySearchReplace(file.content, text || "");
      if (applied > 0 && code !== file.content) {
        file.content = code; // mutation en place: le tableau `files` reste la source de vérité
        changed.push({ path: file.path, content: code });
        onProgress?.(`✅ ${filePath} — ${applied} correction(s) appliquée(s)`);
      } else {
        onProgress?.(`⚠️ ${filePath} — aucun diff applicable renvoyé`);
      }
    } catch (e: any) {
      onProgress?.(`⚠️ Correction de ${filePath} échouée: ${String(e?.message || e).slice(0, 120)}`);
    }
  }
  return changed;
}

// ─── 4. Boucle complète: carte → test → fix → re-test ────────────────────────

export async function runLiveQAAndFix(opts: {
  baseUrl: string;
  plan: LiveQAPlan | undefined | null;
  files: ScaffoldFile[];
  /** Réécrit les fichiers modifiés sur disque (HMR Vite les recharge). */
  writeChanged: (changed: ScaffoldFile[]) => Promise<void>;
  onProgress?: Progress;
  isCancelled?: () => boolean;
  maxRounds?: number;
}): Promise<LiveQAResult> {
  const { baseUrl, plan, files, writeChanged, onProgress, isCancelled } = opts;
  const maxRounds = opts.maxRounds ?? 2;
  const map = buildAppMap(plan, files);

  // La carte est persistée dans les fichiers du projet (visible dans l'éditeur).
  const mapJson = JSON.stringify(map, null, 2);
  const existing = files.find(f => f.path === ".velbaz/app-map.json");
  if (existing) existing.content = mapJson;
  else files.push({ path: ".velbaz/app-map.json", content: mapJson });

  const testable = map.routes.filter(r => !r.dynamic).length;
  onProgress?.(`🗺️ Carte de l'app dressée — ${map.routes.length} pages, ${testable} testables en direct`);

  const fixedFiles = new Set<string>();
  let lastBugs: LiveBug[] = [];
  let round = 0;

  for (round = 1; round <= maxRounds; round++) {
    if (isCancelled?.()) break;
    onProgress?.(`🧪 QA live — tour ${round}/${maxRounds}: visite de chaque page dans un vrai navigateur…`);
    lastBugs = await runLiveQA(baseUrl, map, onProgress, isCancelled);
    if (!lastBugs.length) {
      onProgress?.(`🎉 QA live: toutes les pages fonctionnent — aucun bug détecté`);
      break;
    }
    onProgress?.(`🐞 QA live: ${lastBugs.length} bug(s) détecté(s) sur ${new Set(lastBugs.map(b => b.route)).size} page(s)`);
    if (round === maxRounds) {
      onProgress?.(`⚠️ QA live: ${lastBugs.length} bug(s) restant(s) après ${maxRounds} tours`);
      break;
    }
    if (isCancelled?.()) break;
    const changed = await fixBugsLive(lastBugs, files, onProgress);
    if (!changed.length) { onProgress?.(`⚠️ QA live: aucun correctif applicable — arrêt`); break; }
    changed.forEach(f => fixedFiles.add(f.path));
    await writeChanged(changed);
    // Laisser le HMR de Vite recharger les modules avant le re-test.
    await new Promise(res => setTimeout(res, 2500));
  }

  return { routesTested: testable, bugs: lastBugs, rounds: round, fixedFiles: [...fixedFiles] };
}
