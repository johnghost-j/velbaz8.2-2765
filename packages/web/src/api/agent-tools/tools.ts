// ─── Les vrais pouvoirs de l'IA Velbaz ───────────────────────────────────────
//
// Chaque fonction ici est un OUTIL que le modèle appelle lui-même pendant la
// conversation (boucle dans ./loop.ts). Rien n'est simulé : le navigateur est
// un vrai Chrome, le terminal une vraie machine, les requêtes HTTP partent
// vraiment.
//
// Trois règles tenues partout :
//   1. Chaque appel émet une étape `progress` → l'utilisateur voit l'action en
//      direct (et la capture d'écran quand il y en a une).
//   2. Un échec est renvoyé TEL QUEL au modèle (« bloqué par Cloudflare »,
//      « commande refusée »…). Jamais de faux succès.
//   3. Le shell et le code tournent dans un utilisateur isolé sans accès à la
//      base ni aux clés (voir ./sandbox.ts). Les clés d'API ne sont jamais
//      montrées au modèle : il écrit `{{NOM_DE_LA_CLE}}`, le serveur substitue.

import { tool } from 'ai';
import { z } from 'zod';
import { eq, and } from 'drizzle-orm';
import { db } from '../database/index';
import * as schema from '../database/schema';
import { webSearchResults } from '../web-tools';
import type { AgentProgress, ToolContext } from './types';
import {
  getBrowserSession, navigate, snapshot, click, type as typeText, scroll, screenshot,
  type PageSnapshot,
} from './browser';
import { getSandbox, runShell, runCode, isolationLevel } from './sandbox';

// ── Capture d'écran → URL publique (même mécanisme que le scraper de sites) ──
async function uploadShot(buffer: Buffer, label: string): Promise<string> {
  try {
    const { execFileSync } = await import('node:child_process');
    const fs = await import('node:fs');
    const os = await import('node:os');
    const path = await import('node:path');
    const tmp = path.join(os.tmpdir(), `velbaz_agent_${label}_${Date.now()}.jpg`);
    fs.writeFileSync(tmp, buffer);
    const url = execFileSync('upload', [tmp], { encoding: 'utf-8', timeout: 30000 }).trim();
    try { fs.unlinkSync(tmp); } catch { /* déjà nettoyé */ }
    return url.startsWith('http') ? url : '';
  } catch (e: any) {
    console.error('[agent-tools] upload capture échoué:', e?.message);
    return '';
  }
}

function fmtSnapshot(s: PageSnapshot): string {
  const lines = [`URL: ${s.url}`, `Titre: ${s.title}`];
  if (s.status) lines.push(`Statut HTTP: ${s.status}`);
  if (s.blocked) lines.push(`⚠️ BLOCAGE DÉTECTÉ: ${s.blocked}`);
  lines.push('', '--- Texte de la page ---', s.text || '(aucun texte lisible)');
  if (s.elements?.length) {
    lines.push('', '--- Éléments interactifs (utilise le "selector" avec web_act) ---');
    for (const el of s.elements.slice(0, 40)) {
      lines.push(`[${el.kind}] ${el.label || '(sans libellé)'} → selector: ${el.selector}`);
    }
  }
  return lines.join('\n');
}

/** Construit l'ensemble d'outils disponibles pour une requête de chat. */
export function buildAgentTools(ctx: ToolContext) {
  const emit = (step: AgentProgress) => { try { ctx.onProgress?.(step); } catch { /* le chat continue */ } };
  const note = (tool: string, input: any, ok: boolean, summary: string, ms: number) => {
    ctx.log?.push({ tool, input, ok, summary, ms });
  };
  let n = 0;
  const nextId = (p: string) => `tool-${p}-${++n}`;

  // Renvoie au modèle le texte de la page + la capture (il VOIT la page).
  const pageResult = async (label: string, snap: PageSnapshot, shot: Buffer | null) => {
    const imageUrl = shot ? await uploadShot(shot, label) : '';
    emit({
      id: nextId(label),
      label: snap.blocked ? `Page bloquée : ${snap.url}` : `${label} — ${snap.title || snap.url}`,
      preview: { kind: shot ? 'screenshot' : 'browse', url: snap.url, imageUrl: imageUrl || undefined, caption: snap.title },
    });
    return { text: fmtSnapshot(snap), imageBase64: shot ? shot.toString('base64') : '', imageUrl };
  };

  const tools: Record<string, any> = {
    // ── 1. Navigateur réel ───────────────────────────────────────────────────
    web_open: tool({
      description:
        "Ouvre une URL dans un VRAI navigateur Chrome (JavaScript exécuté, session conservée entre les appels, connexion possible). " +
        "Renvoie le texte de la page, la liste des éléments cliquables et une capture d'écran que tu vois. " +
        "À utiliser dès qu'il faut lire une vraie page, un site dynamique, un espace connecté ou vérifier quelque chose en ligne.",
      inputSchema: z.object({ url: z.string().describe("URL complète, ex: https://exemple.com") }),
      execute: async ({ url }: { url: string }) => {
        const t0 = Date.now();
        emit({ id: nextId('open'), label: `Ouverture de ${url}`, preview: { kind: 'browse', url } });
        try {
          const s = await getBrowserSession(ctx.sessionId);
          const status = await navigate(s.page, url);
          const snap = await snapshot(s.page, status);
          const shot = await screenshot(s.page).catch(() => null);
          const out = await pageResult('Page ouverte', snap, shot);
          note('web_open', { url }, !snap.blocked, snap.blocked || snap.title, Date.now() - t0);
          return out;
        } catch (e: any) {
          note('web_open', { url }, false, e?.message || 'échec', Date.now() - t0);
          return { text: `Impossible d'ouvrir ${url} : ${e?.message || e}`, imageBase64: '', imageUrl: '' };
        }
      },
      toModelOutput: ({ output }: any) => ({
        type: 'content' as const,
        value: output.imageBase64
          ? [{ type: 'text' as const, text: output.text }, { type: 'image-data' as const, data: output.imageBase64, mediaType: 'image/jpeg' }]
          : [{ type: 'text' as const, text: output.text }],
      }),
    }),

    web_act: tool({
      description:
        "Agit sur la page actuellement ouverte : cliquer, remplir un champ, faire défiler. " +
        "Utilise le 'selector' donné par web_open, ou simplement le texte visible du bouton/lien. " +
        "Renvoie l'état de la page après l'action, avec capture.",
      inputSchema: z.object({
        action: z.enum(['click', 'type', 'scroll']),
        target: z.string().optional().describe("Sélecteur CSS ou texte visible (click/type). Pour scroll: 'bottom', 'top' ou un nombre de pixels."),
        text: z.string().optional().describe("Texte à saisir (action 'type')."),
        submit: z.boolean().optional().describe("Appuyer sur Entrée après la saisie (action 'type')."),
      }),
      execute: async (input: { action: 'click' | 'type' | 'scroll'; target?: string; text?: string; submit?: boolean }) => {
        const t0 = Date.now();
        const { action, target, text, submit } = input;
        const labelFr = action === 'click' ? `Clic sur « ${target} »` : action === 'type' ? `Saisie dans « ${target} »` : `Défilement (${target || 'bottom'})`;
        emit({ id: nextId('act'), label: labelFr, preview: { kind: 'browse', caption: labelFr } });
        try {
          const s = await getBrowserSession(ctx.sessionId);
          if (action === 'click') {
            if (!target) throw new Error("'target' est requis pour un clic");
            await click(s.page, target);
          } else if (action === 'type') {
            if (!target || text === undefined) throw new Error("'target' et 'text' sont requis pour une saisie");
            await typeText(s.page, target, text, !!submit);
          } else {
            const to = target === 'top' ? 'top' : target && /^\d+$/.test(target) ? Number(target) : 'bottom';
            await scroll(s.page, to as any);
          }
          const snap = await snapshot(s.page, null);
          const shot = await screenshot(s.page).catch(() => null);
          const out = await pageResult(labelFr, snap, shot);
          note('web_act', input, true, snap.title, Date.now() - t0);
          return out;
        } catch (e: any) {
          note('web_act', input, false, e?.message || 'échec', Date.now() - t0);
          return { text: `Action impossible : ${e?.message || e}`, imageBase64: '', imageUrl: '' };
        }
      },
      toModelOutput: ({ output }: any) => ({
        type: 'content' as const,
        value: output.imageBase64
          ? [{ type: 'text' as const, text: output.text }, { type: 'image-data' as const, data: output.imageBase64, mediaType: 'image/jpeg' }]
          : [{ type: 'text' as const, text: output.text }],
      }),
    }),

    web_search: tool({
      description: "Recherche sur le web et renvoie les meilleurs résultats (titre, URL, extrait). Enchaîne avec web_open pour lire une page en entier.",
      inputSchema: z.object({ query: z.string() }),
      execute: async ({ query }: { query: string }) => {
        const t0 = Date.now();
        emit({ id: nextId('search'), label: `Recherche : ${query}`, preview: { kind: 'search', caption: query } });
        const results = await webSearchResults(query, 6).catch(() => []);
        note('web_search', { query }, results.length > 0, `${results.length} résultats`, Date.now() - t0);
        if (!results.length) return "Aucun résultat (moteur indisponible ou requête sans réponse).";
        return results.map((r, i) => `${i + 1}. ${r.title}\n   ${r.url}\n   ${r.snippet}`).join('\n');
      },
    }),
  };

  // ── 2. Terminal + exécution de code (sandbox isolé) ───────────────────────
  tools.run_command = tool({
    description:
      "Exécute une commande shell dans un bac à sable Linux jetable (utilisateur isolé, dossier temporaire, accès Internet, aucune donnée Velbaz). " +
      "Sert à installer un paquet, manipuler des fichiers de travail, appeler curl, etc. Ce n'est PAS le serveur de production.",
    inputSchema: z.object({
      command: z.string().describe("Commande bash, ex: pip install requests && python script.py"),
      timeoutSec: z.number().optional().describe("Délai maximum en secondes (défaut 120, max 300)."),
    }),
    execute: async ({ command, timeoutSec }: { command: string; timeoutSec?: number }) => {
      const t0 = Date.now();
      emit({ id: nextId('cmd'), label: `Terminal : ${command.slice(0, 70)}`, preview: { kind: 'code', caption: command.slice(0, 160) } });
      const sbx = await getSandbox(ctx.sessionId);
      const r = await runShell(sbx, command, { timeoutMs: timeoutSec ? timeoutSec * 1000 : undefined, withFiles: true });
      note('run_command', { command }, r.ok, r.ok ? 'ok' : r.stderr.slice(0, 120), Date.now() - t0);
      return [
        `exit=${r.exitCode}${r.timedOut ? ' (interrompu : délai dépassé)' : ''}`,
        r.stdout ? `--- sortie ---\n${r.stdout}` : '(aucune sortie)',
        r.stderr ? `--- erreurs ---\n${r.stderr}` : '',
        r.files?.length ? `--- fichiers du bac à sable ---\n${r.files.join('\n')}` : '',
      ].filter(Boolean).join('\n');
    },
  });

  tools.run_code = tool({
    description:
      "Exécute du code Python, JavaScript (Node) ou Bash dans le bac à sable isolé et renvoie la sortie réelle. " +
      "À utiliser pour calculer, traiter des données, tester un algorithme — plutôt que de deviner un résultat de tête.",
    inputSchema: z.object({
      language: z.enum(['python', 'javascript', 'bash']),
      code: z.string(),
      timeoutSec: z.number().optional(),
    }),
    execute: async ({ language, code, timeoutSec }: { language: 'python' | 'javascript' | 'bash'; code: string; timeoutSec?: number }) => {
      const t0 = Date.now();
      emit({ id: nextId('code'), label: `Exécution ${language}`, preview: { kind: 'code', caption: code.slice(0, 200) } });
      const sbx = await getSandbox(ctx.sessionId);
      const r = await runCode(sbx, language, code, { timeoutMs: timeoutSec ? timeoutSec * 1000 : undefined });
      note('run_code', { language }, r.ok, r.ok ? 'ok' : r.stderr.slice(0, 120), Date.now() - t0);
      return [
        `exit=${r.exitCode}${r.timedOut ? ' (interrompu : délai dépassé)' : ''}`,
        r.stdout ? `--- sortie ---\n${r.stdout}` : '(aucune sortie)',
        r.stderr ? `--- erreurs ---\n${r.stderr}` : '',
      ].filter(Boolean).join('\n');
    },
  });

  // ── 3. Fichiers du projet (uniquement dans une company) ───────────────────
  if (ctx.companyId) {
    const companyId = ctx.companyId;

    tools.list_project_files = tool({
      description: "Liste les fichiers du projet en cours (code généré) et les pages du site.",
      inputSchema: z.object({}),
      execute: async () => {
        const t0 = Date.now();
        emit({ id: nextId('ls'), label: 'Lecture des fichiers du projet', preview: { kind: 'analyze' } });
        const files = await db.select({ p: schema.projectFiles.filePath, t: schema.projectFiles.fileType })
          .from(schema.projectFiles).where(eq(schema.projectFiles.companyId, companyId));
        const pages = await db.select({ slug: schema.websitePages.slug, title: schema.websitePages.title })
          .from(schema.websitePages).where(eq(schema.websitePages.companyId, companyId));
        note('list_project_files', {}, true, `${files.length} fichiers / ${pages.length} pages`, Date.now() - t0);
        return [
          files.length ? `Fichiers (${files.length}) :\n${files.map((f) => `- ${f.p} [${f.t}]`).join('\n')}` : 'Aucun fichier de code.',
          pages.length ? `\nPages du site (${pages.length}) :\n${pages.map((p) => `- page:${p.slug} — ${p.title}`).join('\n')}` : '\nAucune page.',
        ].join('\n');
      },
    });

    tools.read_project_file = tool({
      description: "Lit un fichier du projet. Pour une page du site, utilise le chemin 'page:<slug>' (ex: page:index).",
      inputSchema: z.object({ path: z.string() }),
      execute: async ({ path }: { path: string }) => {
        const t0 = Date.now();
        emit({ id: nextId('read'), label: `Lecture de ${path}`, preview: { kind: 'analyze', caption: path } });
        if (path.startsWith('page:')) {
          const slug = path.slice(5);
          const [row] = await db.select().from(schema.websitePages)
            .where(and(eq(schema.websitePages.companyId, companyId), eq(schema.websitePages.slug, slug))).limit(1);
          note('read_project_file', { path }, !!row, row ? 'ok' : 'introuvable', Date.now() - t0);
          if (!row) return `Page « ${slug} » introuvable.`;
          return (row.htmlContent || '').slice(0, 30000);
        }
        const [row] = await db.select().from(schema.projectFiles)
          .where(and(eq(schema.projectFiles.companyId, companyId), eq(schema.projectFiles.filePath, path))).limit(1);
        note('read_project_file', { path }, !!row, row ? 'ok' : 'introuvable', Date.now() - t0);
        if (!row) return `Fichier « ${path} » introuvable. Utilise list_project_files pour voir ce qui existe.`;
        return row.content.slice(0, 30000);
      },
    });

    tools.write_project_file = tool({
      description:
        "Écrit (crée ou remplace) un fichier du projet. Pour une page du site : 'page:<slug>'. " +
        "Écris le contenu COMPLET du fichier, jamais un extrait. L'utilisateur voit le changement immédiatement.",
      inputSchema: z.object({
        path: z.string(),
        content: z.string(),
        fileType: z.string().optional().describe('component | page | style | config | lib | route'),
      }),
      execute: async ({ path, content, fileType }: { path: string; content: string; fileType?: string }) => {
        const t0 = Date.now();
        emit({ id: nextId('write'), label: `Écriture de ${path}`, preview: { kind: 'code', caption: path } });
        const now = new Date().toISOString();
        try {
          if (path.startsWith('page:')) {
            const slug = path.slice(5);
            const [row] = await db.select().from(schema.websitePages)
              .where(and(eq(schema.websitePages.companyId, companyId), eq(schema.websitePages.slug, slug))).limit(1);
            if (row) {
              await db.update(schema.websitePages).set({ htmlContent: content, updatedAt: now })
                .where(eq(schema.websitePages.id, row.id));
            } else {
              const { v4: uuidv4 } = await import('uuid');
              await db.insert(schema.websitePages).values({
                id: uuidv4(), companyId, slug, title: slug, htmlContent: content, pageType: 'custom',
              } as any);
            }
            note('write_project_file', { path }, true, 'page enregistrée', Date.now() - t0);
            return `Page « ${slug} » enregistrée (${content.length} caractères).`;
          }
          const [row] = await db.select().from(schema.projectFiles)
            .where(and(eq(schema.projectFiles.companyId, companyId), eq(schema.projectFiles.filePath, path))).limit(1);
          if (row) {
            await db.update(schema.projectFiles).set({ content, version: (row.version || 1) + 1, updatedAt: now })
              .where(eq(schema.projectFiles.id, row.id));
          } else {
            const { v4: uuidv4 } = await import('uuid');
            await db.insert(schema.projectFiles).values({
              id: uuidv4(), companyId, filePath: path, content,
              fileType: fileType || 'component', version: 1, createdAt: now, updatedAt: now,
            });
          }
          note('write_project_file', { path }, true, 'fichier enregistré', Date.now() - t0);
          return `Fichier « ${path} » enregistré (${content.length} caractères).`;
        } catch (e: any) {
          note('write_project_file', { path }, false, e?.message || 'échec', Date.now() - t0);
          return `Écriture impossible : ${e?.message || e}`;
        }
      },
    });

    // ── 4. Appel d'API externe avec les clés DE CETTE COMPANY ───────────────
    // Le modèle ne voit JAMAIS la valeur d'une clé : il écrit {{NOM}} et le
    // serveur substitue juste avant l'envoi. La réponse est re-masquée.
    tools.http_request = tool({
      description:
        "Appelle une API externe en HTTP. Pour utiliser une clé d'API enregistrée par l'utilisateur, écris le marqueur {{NOM_DE_LA_CLE}} " +
        "dans l'URL, les en-têtes ou le corps : le serveur le remplace par la vraie valeur au moment de l'envoi (tu ne la vois jamais). " +
        "Utilise list_api_keys pour connaître les clés disponibles.",
      inputSchema: z.object({
        method: z.enum(['GET', 'POST', 'PUT', 'PATCH', 'DELETE']),
        url: z.string(),
        headers: z.record(z.string(), z.string()).optional(),
        body: z.string().optional().describe('Corps brut (JSON sérialisé le plus souvent).'),
      }),
      execute: async (input: { method: string; url: string; headers?: Record<string, string>; body?: string }) => {
        const t0 = Date.now();
        const { method, url, headers, body } = input;
        emit({ id: nextId('http'), label: `Appel API : ${method} ${url.replace(/\{\{\w+\}\}/g, '***').slice(0, 80)}`, preview: { kind: 'browse', caption: `${method} ${url.split('?')[0]}` } });
        const rows = await db.select({ key: schema.companySecrets.key, value: schema.companySecrets.value })
          .from(schema.companySecrets).where(eq(schema.companySecrets.companyId, companyId));
        const secrets: Record<string, string> = {};
        for (const r of rows) secrets[r.key] = r.value;
        const missing: string[] = [];
        const fill = (s: string) => s.replace(/\{\{(\w+)\}\}/g, (_m, k: string) => {
          if (secrets[k]) return secrets[k];
          missing.push(k);
          return `{{${k}}}`;
        });
        const finalUrl = fill(url);
        const finalHeaders: Record<string, string> = {};
        for (const [k, v] of Object.entries(headers || {})) finalHeaders[k] = fill(v);
        const finalBody = body ? fill(body) : undefined;
        if (missing.length) {
          note('http_request', { url }, false, `clés manquantes: ${missing.join(',')}`, Date.now() - t0);
          return `Appel non envoyé : aucune clé enregistrée pour ${[...new Set(missing)].map((m) => `{{${m}}}`).join(', ')}. ` +
            `Demande à l'utilisateur de l'ajouter dans les réglages du projet — je n'invente pas de clé.`;
        }
        try {
          const res = await fetch(finalUrl, {
            method, headers: finalHeaders, body: finalBody,
            signal: AbortSignal.timeout(30000),
          });
          let text = await res.text();
          // Une clé renvoyée en écho par l'API ne doit pas atterrir dans le chat.
          for (const v of Object.values(secrets)) if (v.length > 6) text = text.split(v).join('***');
          note('http_request', { url, status: res.status }, res.ok, `HTTP ${res.status}`, Date.now() - t0);
          return `HTTP ${res.status} ${res.statusText}\n${text.slice(0, 12000)}`;
        } catch (e: any) {
          note('http_request', { url }, false, e?.message || 'échec', Date.now() - t0);
          return `Appel échoué : ${e?.message || e}`;
        }
      },
    });

    tools.list_api_keys = tool({
      description: "Liste les NOMS des clés d'API que l'utilisateur a enregistrées pour ce projet (les valeurs restent secrètes).",
      inputSchema: z.object({}),
      execute: async () => {
        const rows = await db.select({ key: schema.companySecrets.key })
          .from(schema.companySecrets).where(eq(schema.companySecrets.companyId, companyId));
        if (!rows.length) return "Aucune clé enregistrée pour ce projet.";
        return `Clés disponibles (à écrire sous la forme {{NOM}}) :\n${rows.map((r) => `- ${r.key}`).join('\n')}`;
      },
    });
  }

  return tools;
}

/** Description des pouvoirs, à coller dans le prompt système. */
export async function toolsInstructions(hasProject: boolean): Promise<string> {
  const iso = await isolationLevel();
  const sandboxLine = iso === 'nobody'
    ? "- run_command / run_code : un vrai terminal Linux et l'exécution de Python, Node ou Bash dans un bac à sable jetable (Internet dispo). Calcule et vérifie au lieu de deviner."
    : "- (terminal et exécution de code indisponibles sur cette machine : dis-le franchement si on te les demande, ne fais pas semblant d'exécuter)";
  return `

OUTILS RÉELS À TA DISPOSITION (utilise-les de toi-même, sans demander la permission) :
- web_search : chercher sur le web.
- web_open : ouvrir une VRAIE page dans Chrome (JS exécuté). Tu reçois le texte ET une capture que tu vois.
- web_act : cliquer, remplir un formulaire, faire défiler sur la page ouverte. La session reste ouverte entre les appels.
${sandboxLine}${hasProject ? `
- list_project_files / read_project_file / write_project_file : lire et modifier les fichiers et pages du projet en cours.
- list_api_keys / http_request : appeler une API externe. Écris {{NOM_DE_LA_CLE}}, le serveur substitue la vraie clé (tu ne la vois jamais).` : ''}

RÈGLES :
- Conversation normale, question de culture générale, avis : réponds DIRECTEMENT, sans outil.
- Quand la réponse dépend d'une information réelle, actuelle ou vérifiable (page web, chiffre exact, actualité, contenu d'un fichier du projet), VÉRIFIE avec un outil au lieu de répondre de mémoire.
- Si un outil échoue ou qu'une page te bloque, dis-le clairement à l'utilisateur. N'invente JAMAIS un résultat que tu n'as pas obtenu.
- N'annonce pas ce que tu vas faire : fais-le, puis raconte ce que tu as trouvé.`;
}
