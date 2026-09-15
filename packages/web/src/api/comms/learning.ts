/**
 * APPRENTISSAGE COMMUNICATION / PUB / MARKETING
 *
 * Il n'y a PAS de fine-tuning ici (le gateway ne le permet pas, et ce serait
 * inutilement coûteux). L'apprentissage est réel mais fonctionne autrement :
 *
 *   1. chaque test lancé depuis la console admin est enregistré
 *      (message étudié → réponse produite) ;
 *   2. l'admin note 1-10 et peut écrire une correction ;
 *   3. la note + la correction sont DISTILLÉES en règles courtes (« leçons ») ;
 *   4. ces leçons + les meilleurs exemples passés sont réinjectés dans le
 *      prompt AVANT chaque nouvelle génération — y compris en production.
 *
 * Résultat : plus l'admin teste et corrige, plus les réponses s'alignent sur
 * ce qu'il attend, et ça profite au vrai système (monitor / pipeline), pas
 * seulement à la console de test.
 */

import { client } from '../database/client';
import { generateText } from 'ai';
import { gateway } from '../agent/gateway';
import { runWithAiContext } from '../ai-usage/context';
import { v4 as uuidv4 } from 'uuid';
import { ensureRuntimeTables } from '../database/runtime-tables';

export type TaskKind = 'reply' | 'ad' | 'schedule' | 'post' | 'outreach';

export const TASKS: TaskKind[] = ['reply', 'ad', 'schedule', 'post', 'outreach'];

export const TASK_LABELS: Record<TaskKind, string> = {
  reply: 'Réponse à un message reçu (DM, commentaire, mention)',
  ad: 'Idée / créa publicitaire',
  schedule: 'Meilleur moment de publication',
  post: 'Post organique (contenu social)',
  outreach: 'Email de prospection',
};

export function isTask(v: string): v is TaskKind {
  return (TASKS as string[]).includes(v);
}

/** Le modèle de raisonnement utilisé pour étudier / juger / distiller. */
export const REASONING_MODEL = process.env.COMMS_REASONING_MODEL || 'openai/gpt-5.4-mini';

const MAX_RULES_IN_PROMPT = 14;
const MAX_EXAMPLES_IN_PROMPT = 4;

function str(v: unknown): string {
  return v === null || v === undefined ? '' : String(v);
}

function numOr(v: unknown, dflt: number): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : dflt;
}

// ─── Écriture des exemples ───────────────────────────────────────────────────

export interface RecordExampleInput {
  companyId?: string | null;
  task: TaskKind;
  input: string;
  context?: string | null;
  lang?: string | null;
  study?: unknown;
  output?: string | null;
  variants?: unknown;
  selfScore?: number | null;
  model?: string | null;
  durationMs?: number | null;
  createdBy?: string | null;
}

/** Enregistre un test (avant notation). Renvoie l'id de l'exemple. */
export async function recordExample(inp: RecordExampleInput): Promise<string> {
  await ensureRuntimeTables();
  const id = uuidv4();
  await client.execute({
    sql: `INSERT INTO comms_training_examples
      (id, company_id, task, input, context, lang, study, output, variants, self_score, model, duration_ms, created_by)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    args: [
      id,
      inp.companyId || null,
      inp.task,
      inp.input,
      inp.context || null,
      inp.lang || null,
      inp.study === undefined ? null : JSON.stringify(inp.study),
      inp.output || null,
      inp.variants === undefined ? null : JSON.stringify(inp.variants),
      inp.selfScore ?? null,
      inp.model || null,
      inp.durationMs ?? null,
      inp.createdBy || null,
    ],
  });
  return id;
}

/** Le dernier exemple non noté (pour que « score 8 » sache quoi noter). */
export async function lastUnratedExample(createdBy?: string | null): Promise<any | null> {
  await ensureRuntimeTables();
  const r = await client.execute({
    sql: `SELECT * FROM comms_training_examples
          WHERE score IS NULL ${createdBy ? 'AND created_by = ?' : ''}
          ORDER BY created_at DESC, rowid DESC LIMIT 1`,
    args: createdBy ? [createdBy] : [],
  });
  return r.rows[0] || null;
}

export async function getExample(id: string): Promise<any | null> {
  await ensureRuntimeTables();
  const r = await client.execute({ sql: `SELECT * FROM comms_training_examples WHERE id = ?`, args: [id] });
  return r.rows[0] || null;
}

/** Historique des tests, pour la commande `examples` de la console. */
export async function listExamples(task?: TaskKind, limit = 20): Promise<any[]> {
  await ensureRuntimeTables();
  const r = await client.execute({
    sql: `SELECT id, task, lang, input, output, self_score, score, correction, duration_ms, created_at
          FROM comms_training_examples ${task ? 'WHERE task = ?' : ''}
          ORDER BY created_at DESC, rowid DESC LIMIT ?`,
    args: task ? [task, limit] : [limit],
  });
  return r.rows as any[];
}

// ─── Notation + distillation en leçons ──────────────────────────────────────

/**
 * Note un exemple et en tire des leçons réutilisables.
 * `score` 1-10, `correction` optionnelle (texte libre de l'admin).
 */
export async function rateExample(
  id: string,
  score: number,
  correction?: string | null,
): Promise<{ ok: boolean; lessons: string[] }> {
  await ensureRuntimeTables();
  const ex = await getExample(id);
  if (!ex) return { ok: false, lessons: [] };

  const clamped = Math.max(1, Math.min(10, Math.round(score)));
  await client.execute({
    sql: `UPDATE comms_training_examples SET score = ?, correction = ?, rated_at = unixepoch() WHERE id = ?`,
    args: [clamped, correction || null, id],
  });

  // Une note franche (bonne ou mauvaise) ou une correction écrite = matière à
  // apprendre. Une note tiède sans correction n'apprend rien d'utile.
  const worthLearning = clamped >= 8 || clamped <= 5 || !!(correction && correction.trim());
  if (!worthLearning) return { ok: true, lessons: [] };

  const lessons = await distillLessons(ex, clamped, correction || '');
  for (const l of lessons) {
    await addPlaybookRule({
      companyId: ex.company_id ? String(ex.company_id) : null,
      task: String(ex.task) as TaskKind,
      rule: l.rule,
      kind: l.kind,
      weight: clamped >= 8 ? 1.5 : 2, // une correction pèse plus qu'un compliment
      sourceExampleId: id,
    });
  }
  return { ok: true, lessons: lessons.map(l => `${l.kind === 'dont' ? '✗' : '✓'} ${l.rule}`) };
}

/** Transforme une note + une correction en 1 à 3 règles courtes et réutilisables. */
async function distillLessons(
  ex: any,
  score: number,
  correction: string,
): Promise<{ rule: string; kind: 'do' | 'dont' }[]> {
  const sys = `Tu es un coach en communication marketing. On te donne une réponse produite par une IA, la note que l'humain lui a mise, et éventuellement sa correction.
Ta mission : en tirer 1 à 3 RÈGLES GÉNÉRALES réutilisables pour les prochaines fois.

Contraintes ABSOLUES :
- Chaque règle est une consigne actionnable de 4 à 18 mots, au présent, à l'impératif.
- Une règle NE DOIT PAS mentionner ce cas précis (pas de nom de client, pas de produit précis) : elle doit servir à d'autres messages.
- kind = "do" si c'est à reproduire, "dont" si c'est à éviter.
- Si la correction de l'humain contredit la réponse de l'IA, la règle doit refléter CE QUE VEUT L'HUMAIN.
- Réponds UNIQUEMENT par un tableau JSON : [{"rule":"...","kind":"do"}]. Aucun texte autour.`;

  const user = `TÂCHE : ${TASK_LABELS[String(ex.task) as TaskKind] || ex.task}
MESSAGE / BRIEF REÇU :
${str(ex.input).slice(0, 1200)}

RÉPONSE PRODUITE PAR L'IA :
${str(ex.output).slice(0, 1500)}

NOTE DE L'HUMAIN : ${score}/10
${correction.trim() ? `CORRECTION ÉCRITE PAR L'HUMAIN :\n${correction.slice(0, 1200)}` : '(aucune correction écrite)'}

Tire-en les règles.`;

  try {
    const { text } = await runWithAiContext(
      { feature: 'comms-training-distill', companyId: ex.company_id ? String(ex.company_id) : undefined },
      () => generateText({
        model: gateway(REASONING_MODEL),
        system: sys,
        prompt: user,
        temperature: 0.3,
      }),
    );
    const m = text.match(/\[[\s\S]*\]/);
    if (!m) return [];
    const arr = JSON.parse(m[0]);
    return (Array.isArray(arr) ? arr : [])
      .map((x: any) => ({
        rule: String(x?.rule || '').trim(),
        kind: (String(x?.kind || 'do').toLowerCase() === 'dont' ? 'dont' : 'do') as 'do' | 'dont',
      }))
      .filter(x => x.rule.length >= 8 && x.rule.length <= 200)
      .slice(0, 3);
  } catch (e: any) {
    console.error('[comms/learning] distillation échouée (non bloquant):', e?.message);
    return [];
  }
}

// ─── Playbook (les leçons apprises) ─────────────────────────────────────────

export interface PlaybookRule {
  id: string;
  task: string;
  rule: string;
  kind: 'do' | 'dont';
  weight: number;
  hits: number;
  active: number;
  createdAt: number;
}

/**
 * Ajoute une règle. Si une règle quasi identique existe déjà pour la même
 * tâche, on renforce son poids au lieu de créer un doublon — c'est ce qui fait
 * qu'une consigne répétée par l'admin devient dominante.
 */
export async function addPlaybookRule(inp: {
  companyId?: string | null;
  task: TaskKind;
  rule: string;
  kind?: 'do' | 'dont';
  weight?: number;
  sourceExampleId?: string | null;
}): Promise<string> {
  await ensureRuntimeTables();
  const rule = inp.rule.trim();
  const kind = inp.kind || 'do';
  const norm = normalizeRule(rule);

  const existing = await client.execute({
    sql: `SELECT id, rule, weight FROM comms_playbook WHERE task = ? AND active = 1`,
    args: [inp.task],
  });
  for (const row of existing.rows) {
    if (similar(norm, normalizeRule(str(row.rule)))) {
      const id = str(row.id);
      await client.execute({
        sql: `UPDATE comms_playbook SET weight = weight + ?, updated_at = unixepoch() WHERE id = ?`,
        args: [inp.weight ?? 1, id],
      });
      return id;
    }
  }

  const id = uuidv4();
  await client.execute({
    sql: `INSERT INTO comms_playbook (id, company_id, task, rule, kind, weight, source_example_id)
          VALUES (?,?,?,?,?,?,?)`,
    args: [id, inp.companyId || null, inp.task, rule, kind, inp.weight ?? 1, inp.sourceExampleId || null],
  });
  return id;
}

function normalizeRule(s: string): string {
  return s.toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

/** Deux règles disent-elles la même chose ? (recouvrement de mots signifiants) */
function similar(a: string, b: string): boolean {
  if (!a || !b) return false;
  if (a === b) return true;
  const wa = new Set(a.split(' ').filter(w => w.length > 3));
  const wb = new Set(b.split(' ').filter(w => w.length > 3));
  if (!wa.size || !wb.size) return false;
  let common = 0;
  for (const w of wa) if (wb.has(w)) common++;
  return common / Math.min(wa.size, wb.size) >= 0.7;
}

export async function getPlaybook(task?: TaskKind, limit = 100): Promise<PlaybookRule[]> {
  await ensureRuntimeTables();
  const r = await client.execute({
    sql: `SELECT * FROM comms_playbook WHERE active = 1 ${task ? 'AND task = ?' : ''}
          ORDER BY weight DESC, created_at DESC LIMIT ?`,
    args: task ? [task, limit] : [limit],
  });
  return r.rows.map((x: any) => ({
    id: str(x.id),
    task: str(x.task),
    rule: str(x.rule),
    kind: str(x.kind) === 'dont' ? 'dont' : 'do',
    weight: numOr(x.weight, 1),
    hits: numOr(x.hits, 0),
    active: numOr(x.active, 1),
    createdAt: numOr(x.created_at, 0),
  }));
}

export async function forgetRule(id: string): Promise<boolean> {
  await ensureRuntimeTables();
  const r = await client.execute({
    sql: `UPDATE comms_playbook SET active = 0, updated_at = unixepoch() WHERE id = ? AND active = 1`,
    args: [id],
  });
  return r.rowsAffected === 1;
}

// ─── Le bloc réinjecté dans les prompts ─────────────────────────────────────

/**
 * Construit le bloc de texte « ce que j'ai appris » à injecter dans le system
 * prompt. Utilisé par la console de test ET par la production (monitor).
 * Renvoie '' si l'IA n'a rien encore appris — dans ce cas rien n'est injecté.
 */
export async function buildLearningBlock(task: TaskKind, companyId?: string | null): Promise<string> {
  try {
    await ensureRuntimeTables();
    const rules = (await getPlaybook(task, MAX_RULES_IN_PROMPT * 2)).slice(0, MAX_RULES_IN_PROMPT);

    const exRes = await client.execute({
      sql: `SELECT input, output, correction, score FROM comms_training_examples
            WHERE task = ? AND score IS NOT NULL
            ORDER BY score DESC, rated_at DESC LIMIT ?`,
      args: [task, MAX_EXAMPLES_IN_PROMPT],
    });

    const dos = rules.filter(r => r.kind === 'do');
    const donts = rules.filter(r => r.kind === 'dont');

    const parts: string[] = [];
    if (dos.length || donts.length) {
      parts.push(`═══ CE QUE L'ADMIN T'A APPRIS (règles prioritaires, elles PRIMENT sur tes habitudes) ═══`);
      if (dos.length) parts.push(`À FAIRE :\n${dos.map(r => `- ${r.rule}`).join('\n')}`);
      if (donts.length) parts.push(`À NE JAMAIS FAIRE :\n${donts.map(r => `- ${r.rule}`).join('\n')}`);
    }

    const good = exRes.rows.filter((r: any) => numOr(r.score, 0) >= 8);
    const bad = exRes.rows.filter((r: any) => numOr(r.score, 0) <= 5);

    if (good.length) {
      parts.push(`EXEMPLES VALIDÉS (reproduis ce style, jamais le texte mot pour mot) :\n` +
        good.map((r: any) => `• Reçu : ${str(r.input).slice(0, 220)}\n  Bonne réponse (${r.score}/10) : ${str(r.output).slice(0, 320)}`).join('\n'));
    }
    if (bad.length) {
      parts.push(`ERREURS DÉJÀ COMMISES (ne les refais pas) :\n` +
        bad.map((r: any) => {
          const fix = str(r.correction).trim();
          return `• Reçu : ${str(r.input).slice(0, 180)}\n  Mauvaise réponse (${r.score}/10) : ${str(r.output).slice(0, 240)}` +
            (fix ? `\n  Ce qu'il fallait faire : ${fix.slice(0, 300)}` : '');
        }).join('\n'));
    }

    if (!parts.length) return '';
    return parts.join('\n\n');
  } catch (e: any) {
    // L'apprentissage ne doit JAMAIS casser une génération.
    console.error('[comms/learning] buildLearningBlock échoué (non bloquant):', e?.message);
    return '';
  }
}

/** Compte les règles/exemples pour l'affichage « stats » de la console. */
export async function learningStats(): Promise<any> {
  await ensureRuntimeTables();
  const byTask = await client.execute(
    `SELECT task,
            COUNT(*) tests,
            SUM(CASE WHEN score IS NOT NULL THEN 1 ELSE 0 END) notes,
            ROUND(AVG(score), 2) moyenne,
            ROUND(AVG(self_score), 2) auto
     FROM comms_training_examples GROUP BY task`);
  const rules = await client.execute(
    `SELECT task, kind, COUNT(*) n, ROUND(SUM(weight),1) poids
     FROM comms_playbook WHERE active = 1 GROUP BY task, kind`);
  const recent = await client.execute(
    `SELECT ROUND(AVG(score),2) m FROM (
       SELECT score FROM comms_training_examples WHERE score IS NOT NULL ORDER BY rated_at DESC LIMIT 10)`);
  const first = await client.execute(
    `SELECT ROUND(AVG(score),2) m FROM (
       SELECT score FROM comms_training_examples WHERE score IS NOT NULL ORDER BY rated_at ASC LIMIT 10)`);
  return {
    byTask: byTask.rows,
    rules: rules.rows,
    moyenne10Derniers: recent.rows[0]?.m ?? null,
    moyenne10Premiers: first.rows[0]?.m ?? null,
  };
}
