// ─── Mobile App Runner (Expo) ────────────────────────────────────────────────
// Écrit le projet Expo sur disque, installe les deps, exporte la preview web
// statique (servie dans le cadre iPhone), et lance `expo start --tunnel` pour
// obtenir l'URL exp://… (QR code Expo Go). Auto-fix IA sur échec d'export.

import { spawn, type ChildProcess } from "node:child_process";
import { mkdir, writeFile, readFile, rm } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname, join, normalize } from "node:path";
import { createServer } from "node:net";
import type { ScaffoldFile } from "./scaffold";
import { fixMobileFile } from "./engine-mobile";

// Keep in sync with runner.ts — persistent disk, never tmpfs (see note there).
const ROOT = process.env.VELBAZ_APPS_ROOT || "/home/user/.velbaz-apps";

export interface RunningMobileApp {
  companyId: string;
  dir: string;
  port: number;
  proc: ChildProcess;
  expoUrl: string; // exp://…
}

const runningMobile = new Map<string, RunningMobileApp>();

// ── Reconstruction auto de l'app mobile ─────────────────────────────────────
// Enregistré par index.ts (qui possède runBuildMobileWork + la file de jobs).
// Utilisé par POST /mobile/start quand le projet est marqué web+mobile mais
// qu'AUCUN fichier mobile n'existe en DB (conversion interrompue) : au lieu
// d'une erreur « no_mobile_files », on relance la construction tout seul.
let mobileRebuilder: ((companyId: string) => Promise<string>) | null = null;
export function setMobileRebuilder(fn: (companyId: string) => Promise<string>) { mobileRebuilder = fn; }
export function getMobileRebuilder() { return mobileRebuilder; }

export function getRunningMobile(companyId: string): RunningMobileApp | undefined {
  const app = runningMobile.get(companyId);
  if (app && app.proc.exitCode !== null) { runningMobile.delete(companyId); return undefined; }
  return app;
}

export function mobileDir(companyId: string): string {
  return join(ROOT, `${companyId}-mobile`);
}

export function mobileDistDir(companyId: string): string {
  return join(mobileDir(companyId), "dist");
}

function killTree(proc: ChildProcess) {
  if (!proc.pid) return;
  try { process.kill(-proc.pid, "SIGKILL"); } catch {}
  try { proc.kill("SIGKILL"); } catch {}
}

export function stopMobileApp(companyId: string) {
  const app = runningMobile.get(companyId);
  if (app) { killTree(app.proc); runningMobile.delete(companyId); }
}

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

export async function writeMobileFilesToDisk(companyId: string, files: ScaffoldFile[], wipe = true): Promise<string> {
  const dir = mobileDir(companyId);
  if (wipe) await rm(dir, { recursive: true, force: true }).catch(() => {});
  await mkdir(dir, { recursive: true });
  for (const f of files) {
    const full = join(dir, f.path);
    await mkdir(dirname(full), { recursive: true });
    await writeFile(full, f.content, "utf8");
  }
  return dir;
}

function run(cmd: string, args: string[], cwd: string, timeoutMs: number, extraEnv: Record<string, string> = {}): Promise<{ code: number; out: string }> {
  return new Promise((resolve) => {
    const proc = spawn(cmd, args, {
      cwd, detached: true,
      env: { ...process.env, EXPO_NO_TELEMETRY: "1", CI: "1", ...extraEnv },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let out = "";
    const timer = setTimeout(() => { killTree(proc); resolve({ code: 124, out: out + "\n[timeout]" }); }, timeoutMs);
    proc.stdout?.on("data", (d) => { out += d.toString(); });
    proc.stderr?.on("data", (d) => { out += d.toString(); });
    proc.on("close", (code) => { clearTimeout(timer); resolve({ code: code ?? 1, out }); });
    proc.on("error", (e) => { clearTimeout(timer); resolve({ code: 1, out: out + "\n" + String(e) }); });
  });
}

export async function installMobileDeps(dir: string, push?: (msg: string) => void): Promise<void> {
  push?.("📦 Installation de ce qu'il faut pour l'app…");
  const res = await run("bun", ["install"], dir, 8 * 60 * 1000);
  if (res.code !== 0) throw new Error(`bun install a échoué: ${res.out.slice(-1500)}`);
  push?.("✓ Installation terminée");
}

const ANSI_RE = /\u001b\[[0-9;]*m/g;

// Extrait le chemin du fichier fautif depuis la sortie du bundler Metro.
function extractFailingFile(out: string, dir: string): string | null {
  const clean = out.replace(ANSI_RE, "");
  const patterns = [
    new RegExp(`${dir.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}/((?:app|components|lib)/[\\w./-]+\\.tsx?)`),
    /((?:app|components|lib)\/[\w./-]+\.tsx?)/,
  ];
  for (const re of patterns) {
    const m = clean.match(re);
    if (m) return m[1];
  }
  return null;
}

/** Export web statique (dist/) avec boucle d'auto-fix IA (max 2 passes). */
export async function exportMobileWeb(companyId: string, push?: (msg: string) => void): Promise<{ ok: boolean; error?: string }> {
  const dir = mobileDir(companyId);
  for (let attempt = 0; attempt <= 2; attempt++) {
    push?.(attempt === 0 ? "🛠️ Export de la preview web de l'app…" : `🛠️ Export web — tentative ${attempt + 1}…`);
    const res = await run("bunx", ["expo", "export", "-p", "web"], dir, 6 * 60 * 1000);
    if (res.code === 0 && existsSync(join(dir, "dist", "index.html"))) {
      push?.("✓ [TERMINÉ] Preview web de l'app prête");
      return { ok: true };
    }
    const errOut = res.out.replace(ANSI_RE, "").slice(-4000);
    if (attempt === 2) return { ok: false, error: errOut };
    const failing = extractFailingFile(res.out, dir);
    if (!failing) return { ok: false, error: errOut };
    push?.(`▶ Auto-correction IA du fichier ${failing}…`);
    try {
      const full = join(dir, failing);
      const content = await readFile(full, "utf8");
      const fixed = await fixMobileFile(failing, content, errOut);
      if (!fixed) return { ok: false, error: errOut };
      await writeFile(full, fixed, "utf8");
      push?.(`✓ Fichier ${failing} corrigé — nouvel essai`);
    } catch (e: any) {
      return { ok: false, error: `${errOut}\n[auto-fix failed: ${e?.message || e}]` };
    }
  }
  return { ok: false, error: "unreachable" };
}

/**
 * Lance `expo start --tunnel` et attend l'URL exp://… (QR Expo Go).
 * Le process reste vivant en arrière-plan (Expo Go s'y connecte).
 */
export async function startExpoTunnel(companyId: string, push?: (msg: string) => void): Promise<RunningMobileApp> {
  const existing = getRunningMobile(companyId);
  if (existing) return existing;
  const dir = mobileDir(companyId);
  if (!existsSync(join(dir, "package.json"))) throw new Error("Projet mobile introuvable sur le disque");

  const port = await findFreePort(8100);
  push?.("▶ [EN COURS] Préparation du QR code pour ton téléphone…");
  const proc = spawn("bunx", ["expo", "start", "--tunnel", "--port", String(port)], {
    cwd: dir, detached: true,
    env: { ...process.env, EXPO_NO_TELEMETRY: "1", CI: "1", EXPO_NO_REDIRECT_PAGE: "1" },
    stdio: ["ignore", "pipe", "pipe"],
  });

  let buffer = "";
  const expoUrl = await new Promise<string>((resolve, reject) => {
    let done = false;
    const finish = (fn: () => void) => { if (!done) { done = true; clearInterval(poller); clearTimeout(timer); fn(); } };
    const timer = setTimeout(() => {
      finish(() => {
        killTree(proc);
        reject(new Error(`Tunnel Expo indisponible (120s) — sortie: ${buffer.replace(ANSI_RE, "").slice(-800)}`));
      });
    }, 120 * 1000);
    // Voie principale : le CLI Expo n'imprime PAS l'URL exp:// en mode non-interactif.
    // On interroge le manifeste local — launchAsset.url contient le host tunnel *.exp.direct.
    const poller = setInterval(async () => {
      try {
        const res = await fetch(`http://localhost:${port}`, {
          headers: { "expo-platform": "ios" },
          signal: AbortSignal.timeout(2500),
        });
        const text = await res.text();
        const m = text.match(/https?:\/\/([a-z0-9-]+\.exp\.direct)/i);
        if (m) finish(() => resolve(`exp://${m[1]}`));
      } catch { /* Metro pas encore prêt — on réessaie */ }
    }, 3000);
    // Voie secondaire : si une version du CLI imprime quand même l'URL dans le stdout.
    const onData = (d: Buffer) => {
      buffer += d.toString();
      const clean = buffer.replace(ANSI_RE, "");
      const m = clean.match(/exp:\/\/[a-z0-9-]+\.exp\.direct[^\s"']*/i);
      if (m) finish(() => resolve(m![0]));
    };
    proc.stdout?.on("data", onData);
    proc.stderr?.on("data", onData);
    proc.on("close", (code) => finish(() => reject(new Error(`expo start terminé prématurément (code ${code}): ${buffer.replace(ANSI_RE, "").slice(-800)}`))));
    proc.on("error", (e) => finish(() => reject(e)));
  });

  const app: RunningMobileApp = { companyId, dir, port, proc, expoUrl };
  runningMobile.set(companyId, app);
  proc.on("close", () => { if (runningMobile.get(companyId)?.proc === proc) runningMobile.delete(companyId); });
  push?.(`✓ [TERMINÉ] QR code prêt — scanne-le avec ton téléphone`);
  return app;
}

// ─── Static serving de dist/ (preview web dans le cadre iPhone) ─────────────

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".mjs": "application/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".gif": "image/gif",
  ".svg": "image/svg+xml", ".ico": "image/x-icon", ".webp": "image/webp",
  ".woff": "font/woff", ".woff2": "font/woff2", ".ttf": "font/ttf", ".otf": "font/otf",
  ".map": "application/json",
};

/** Résout un chemin d'URL vers un fichier de dist/ (SPA fallback sur index.html). */
// `Uint8Array<ArrayBuffer>` (et non `Uint8Array` générique) : seul ce type est
// un BodyInit valide pour `new Response(...)`.
export async function readMobileDistFile(companyId: string, urlPath: string): Promise<{ body: Uint8Array<ArrayBuffer>; mime: string } | null> {
  const dist = mobileDistDir(companyId);
  if (!existsSync(dist)) return null;
  let rel = decodeURIComponent(urlPath || "/").split("?")[0];
  if (!rel || rel === "/") rel = "/index.html";
  const safe = normalize(rel).replace(/^(\.\.[/\\])+/, "");
  let full = join(dist, safe);
  if (!full.startsWith(dist)) return null;
  if (!existsSync(full)) {
    // SPA fallback (routes expo-router → index.html)
    if (!/\.[a-z0-9]+$/i.test(safe)) full = join(dist, "index.html");
    if (!existsSync(full)) return null;
  }
  try {
    const body = await readFile(full);
    const ext = full.slice(full.lastIndexOf(".")).toLowerCase();
    return { body: new Uint8Array(body), mime: MIME[ext] || "application/octet-stream" };
  } catch {
    return null;
  }
}
