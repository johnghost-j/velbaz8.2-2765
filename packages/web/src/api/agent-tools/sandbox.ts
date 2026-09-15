// ─── Sandbox d'exécution : terminal + code, ISOLÉ du serveur ────────────────
//
// L'IA de Velbaz peut lancer des commandes shell et exécuter du code (Python /
// Node / Bash). Ça ne tourne JAMAIS avec les droits du serveur :
//
//   1. Utilisateur séparé — chaque commande passe par `sudo -n -u nobody`.
//      `nobody` n'a aucun droit sur /home/<user> (mode 0700) : il ne peut donc
//      lire ni la base, ni le `.env`, ni le code du projet. Le réseau, lui,
//      reste ouvert (l'IA doit pouvoir installer un paquet, appeler une API).
//   2. Répertoire jetable — un dossier neuf par session dans /tmp, détruit à la
//      fin. C'est le seul endroit où l'IA peut écrire.
//   3. Environnement vide — aucune variable d'env du serveur n'est transmise :
//      pas de DATABASE_URL, pas de clé API. Juste PATH / HOME / LANG.
//   4. Limites dures — timeout par commande, taille de sortie plafonnée,
//      nombre de commandes plafonné par session.
//
// Si `sudo -u nobody` n'est pas disponible (hébergement restreint), on
// N'EXÉCUTE PAS en se rabattant silencieusement sur les droits du serveur : le
// mode dégradé est explicite dans le résultat (`isolation`), et le shell libre
// est refusé. Mieux vaut une capacité en moins qu'une fuite de secrets.

import { spawn } from 'node:child_process';
import { mkdtemp, rm, writeFile, readdir, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

const CMD_TIMEOUT_MS = 120_000;      // 2 min par commande
const MAX_OUTPUT_CHARS = 20_000;     // sortie renvoyée à l'IA
const MAX_CMDS_PER_SESSION = 200;
const SBX_IDLE_MS = 30 * 60 * 1000;  // bac à sable effacé après 30 min sans usage

export type Isolation = 'nobody' | 'degraded';

export interface SandboxResult {
  ok: boolean;
  exitCode: number | null;
  stdout: string;
  stderr: string;
  truncated: boolean;
  timedOut: boolean;
  durationMs: number;
  /** Fichiers présents dans le sandbox après la commande (chemins relatifs). */
  files?: string[];
}

export interface Sandbox {
  id: string;
  dir: string;
  isolation: Isolation;
  cmdCount: number;
  /** Dernier usage : sert au balayage des bacs à sable abandonnés. */
  lastUsed: number;
}

// ── Détection de la capacité d'isolation (une seule fois par processus) ──────
let isolationProbe: Promise<Isolation> | null = null;

function probe(): Promise<Isolation> {
  isolationProbe ??= new Promise<Isolation>((resolve) => {
    const p = spawn('sudo', ['-n', '-u', 'nobody', '/bin/sh', '-c', 'echo ok'], {
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let out = '';
    p.stdout.on('data', (d) => { out += d.toString(); });
    const t = setTimeout(() => { try { p.kill('SIGKILL'); } catch { /* déjà mort */ } }, 5000);
    p.on('error', () => { clearTimeout(t); resolve('degraded'); });
    p.on('close', (code) => {
      clearTimeout(t);
      resolve(code === 0 && out.trim() === 'ok' ? 'nobody' : 'degraded');
    });
  });
  return isolationProbe;
}

/** Niveau d'isolation disponible sur cette machine. */
export async function isolationLevel(): Promise<Isolation> {
  return probe();
}

// ── Cycle de vie ─────────────────────────────────────────────────────────────

const sandboxes = new Map<string, Sandbox>();

// Un redémarrage du serveur perd la Map : les dossiers du processus précédent
// resteraient dans /tmp pour toujours. On efface au boot ceux de plus de 2 h
// (aucune session vivante ne peut être aussi vieille : 30 min d'inactivité max).
void (async () => {
  try {
    const base = tmpdir();
    const entries = await readdir(base).catch(() => [] as string[]);
    const cutoff = Date.now() - 2 * 3600 * 1000;
    for (const name of entries) {
      if (!name.startsWith('velbaz-sbx-')) continue;
      const full = path.join(base, name);
      const st = await stat(full).catch(() => null);
      if (!st || st.mtimeMs > cutoff) continue;
      await new Promise<void>((resolve) => {
        const p2 = spawn('sudo', ['-n', '-u', 'nobody', 'rm', '-rf', full]);
        p2.on('close', () => resolve());
        p2.on('error', () => resolve());
      });
      await rm(full, { recursive: true, force: true }).catch(() => { /* déjà parti */ });
    }
  } catch { /* nettoyage opportuniste, jamais bloquant */ }
})();

/** Crée (ou retrouve) le sandbox d'une session de chat. */
export async function getSandbox(sessionId: string): Promise<Sandbox> {
  sweepIdleSandboxes();
  const existing = sandboxes.get(sessionId);
  if (existing) {
    existing.lastUsed = Date.now();
    return existing;
  }

  const dir = await mkdtemp(path.join(tmpdir(), 'velbaz-sbx-'));
  const isolation = await probe();
  // `nobody` doit pouvoir écrire dans son bac à sable.
  if (isolation === 'nobody') {
    await new Promise<void>((resolve) => {
      const p = spawn('chmod', ['0777', dir]);
      p.on('close', () => resolve());
      p.on('error', () => resolve());
    });
  }
  const sbx: Sandbox = { id: sessionId, dir, isolation, cmdCount: 0, lastUsed: Date.now() };
  sandboxes.set(sessionId, sbx);
  return sbx;
}

/** Détruit le sandbox et tout son contenu. */
export async function destroySandbox(sessionId: string): Promise<void> {
  const sbx = sandboxes.get(sessionId);
  if (!sbx) return;
  sandboxes.delete(sessionId);
  // Les fichiers créés par `nobody` n'appartiennent pas au serveur : on passe
  // par le même sudo pour pouvoir les effacer.
  if (sbx.isolation === 'nobody') {
    await new Promise<void>((resolve) => {
      const p = spawn('sudo', ['-n', '-u', 'nobody', 'rm', '-rf', sbx.dir]);
      p.on('close', () => resolve());
      p.on('error', () => resolve());
    });
  }
  await rm(sbx.dir, { recursive: true, force: true }).catch(() => { /* déjà parti */ });
}

/** Efface les bacs à sable abandonnés (sinon chaque chat laisse un dossier). */
function sweepIdleSandboxes() {
  const now = Date.now();
  for (const [id, s] of sandboxes) {
    if (now - s.lastUsed > SBX_IDLE_MS) void destroySandbox(id);
  }
}

// ── Exécution ────────────────────────────────────────────────────────────────

function clamp(s: string): { text: string; truncated: boolean } {
  if (s.length <= MAX_OUTPUT_CHARS) return { text: s, truncated: false };
  return {
    text: `${s.slice(0, MAX_OUTPUT_CHARS)}\n… [sortie tronquée, ${s.length - MAX_OUTPUT_CHARS} caractères en plus]`,
    truncated: true,
  };
}

async function listFiles(dir: string): Promise<string[]> {
  const out: string[] = [];
  async function walk(d: string, prefix: string, depth: number) {
    if (depth > 3 || out.length > 60) return;
    let entries: string[];
    try { entries = await readdir(d); } catch { return; }
    for (const e of entries) {
      if (out.length > 60) return;
      if (e === 'node_modules' || e === '.git' || e.startsWith('.cache')) continue;
      const full = path.join(d, e);
      const rel = prefix ? `${prefix}/${e}` : e;
      let s;
      try { s = await stat(full); } catch { continue; }
      if (s.isDirectory()) await walk(full, rel, depth + 1);
      else out.push(rel);
    }
  }
  await walk(dir, '', 0);
  return out;
}

/**
 * Lance une commande shell dans le sandbox.
 * En isolation dégradée, l'exécution est REFUSÉE (jamais de repli silencieux
 * avec les droits du serveur).
 */
export async function runShell(
  sbx: Sandbox,
  command: string,
  opts: { timeoutMs?: number; withFiles?: boolean } = {},
): Promise<SandboxResult> {
  const started = Date.now();
  sbx.lastUsed = started;
  const fail = (stderr: string): SandboxResult => ({
    ok: false, exitCode: null, stdout: '', stderr, truncated: false,
    timedOut: false, durationMs: Date.now() - started,
  });

  if (sbx.isolation !== 'nobody') {
    return fail(
      "Exécution refusée : cette machine ne fournit pas d'utilisateur isolé " +
      "(`sudo -n -u nobody` indisponible). Lancer la commande avec les droits du " +
      'serveur exposerait la base et les clés API — la capacité est donc coupée ' +
      "tant que l'isolation n'est pas configurée.",
    );
  }
  if (sbx.cmdCount >= MAX_CMDS_PER_SESSION) {
    return fail(`Limite atteinte : ${MAX_CMDS_PER_SESSION} commandes pour cette session.`);
  }
  sbx.cmdCount++;

  const timeoutMs = Math.min(opts.timeoutMs ?? CMD_TIMEOUT_MS, 300_000);

  const result = await new Promise<SandboxResult>((resolve) => {
    // `env -i` en tête : même si sudo laissait passer quelque chose, le shell
    // démarre avec un environnement vide, reconstruit à la main.
    const inner = `cd ${JSON.stringify(sbx.dir)} && ${command}`;
    // Le `timeout` tourne DANS le sandbox, en `nobody` : c'est lui qui coupe
    // vraiment le processus. Un kill depuis le serveur ne marcherait pas — le
    // processus `sudo` appartient à root et n'accepte pas nos signaux.
    const secs = Math.max(1, Math.ceil(timeoutMs / 1000));
    const child = spawn(
      'sudo',
      [
        '-n', '-u', 'nobody',
        'env', '-i',
        `HOME=${sbx.dir}`, `TMPDIR=${sbx.dir}`,
        'PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin',
        'LANG=C.UTF-8', 'LC_ALL=C.UTF-8',
        'timeout', '-k', '5', String(secs),
        '/bin/bash', '-c', inner,
      ],
      { stdio: ['ignore', 'pipe', 'pipe'], cwd: '/tmp' },
    );

    let stdout = '';
    let stderr = '';
    let timedOut = false;
    // On coupe la lecture bien avant de saturer la mémoire du serveur.
    const HARD_CAP = MAX_OUTPUT_CHARS * 4;
    child.stdout.on('data', (d) => { if (stdout.length < HARD_CAP) stdout += d.toString(); });
    child.stderr.on('data', (d) => { if (stderr.length < HARD_CAP) stderr += d.toString(); });

    // Filet de sécurité : si `timeout` lui-même ne rendait pas la main, on
    // rend quand même la réponse au lieu de bloquer le chat indéfiniment.
    let settled = false;
    const done = (r: SandboxResult) => { if (!settled) { settled = true; resolve(r); } };
    const timer = setTimeout(() => {
      timedOut = true;
      try { child.kill('SIGKILL'); } catch { /* déjà mort */ }
      const o = clamp(stdout);
      const e = clamp(stderr);
      done({
        ok: false, exitCode: null, stdout: o.text,
        stderr: `${e.text}\n[interrompu : dépassement de ${timeoutMs} ms]`.trim(),
        truncated: o.truncated || e.truncated, timedOut: true,
        durationMs: Date.now() - started,
      });
    }, timeoutMs + 8000);

    child.on('error', (err) => {
      clearTimeout(timer);
      done({
        ok: false, exitCode: null, stdout: '', stderr: `Lancement impossible : ${err.message}`,
        truncated: false, timedOut: false, durationMs: Date.now() - started,
      });
    });

    child.on('close', (code) => {
      clearTimeout(timer);
      const o = clamp(stdout);
      const e = clamp(stderr);
      // 124 = coupé par `timeout` dans le sandbox.
      if (code === 124 || code === 137) timedOut = true;
      done({
        ok: !timedOut && code === 0,
        exitCode: code,
        stdout: o.text,
        stderr: timedOut ? `${e.text}\n[interrompu : dépassement de ${timeoutMs} ms]`.trim() : e.text,
        truncated: o.truncated || e.truncated,
        timedOut,
        durationMs: Date.now() - started,
      });
    });
  });

  if (opts.withFiles) result.files = await listFiles(sbx.dir);
  return result;
}

/** Écrit un fichier de code dans le sandbox puis l'exécute. */
export async function runCode(
  sbx: Sandbox,
  language: 'python' | 'javascript' | 'bash',
  code: string,
  opts: { timeoutMs?: number } = {},
): Promise<SandboxResult> {
  const ext = language === 'python' ? 'py' : language === 'javascript' ? 'js' : 'sh';
  const file = path.join(sbx.dir, `run_${Date.now()}.${ext}`);
  try {
    await writeFile(file, code, 'utf-8');
    // Le fichier est créé par le serveur : `nobody` doit pouvoir le lire.
    await new Promise<void>((resolve) => {
      const p = spawn('chmod', ['0644', file]);
      p.on('close', () => resolve());
      p.on('error', () => resolve());
    });
  } catch (err: any) {
    return {
      ok: false, exitCode: null, stdout: '', stderr: `Écriture impossible : ${err?.message}`,
      truncated: false, timedOut: false, durationMs: 0,
    };
  }
  const runner = language === 'python' ? 'python3' : language === 'javascript' ? 'node' : 'bash';
  return runShell(sbx, `${runner} ${JSON.stringify(file)}`, { ...opts, withFiles: true });
}
