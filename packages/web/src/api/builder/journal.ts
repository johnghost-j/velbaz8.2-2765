// ─── Journal de bord partagé de TOUTES les IA (Velbaz) ────────────────────────
// Mémoire DURABLE, par projet, de ce que les IA font (builder, chat, QA, agents).
// Survit au rechargement de page ET au redémarrage du serveur (table SQLite).
//
// Objectif: l'IA doit être VRAIMENT « au courant de tout ce qu'elle a fait ».
//   1) Chaque action/décision/bug/occasion est enregistrée automatiquement.
//   2) À la reprise (pause, rechargement, redémarrage), l'IA relit ce journal
//      et récapitule où elle en est — puis continue là où elle s'était arrêtée.
//   3) Un BUG enregistré (kind='issue', non résolu) est re-corrigé AUTOMATIQUEMENT.
//   4) Une OCCASION d'amélioration (kind='opportunity') est seulement PROPOSÉE.
//
// Ce module n'échoue JAMAIS: toute erreur DB est avalée — le journal ne doit
// jamais casser un build ou une réponse de chat.

import { randomUUID } from "crypto";
import { and, desc, eq } from "drizzle-orm";
import { db } from "../database";
import { buildJournal } from "../database/schema";

export type JournalActor = "builder" | "chat" | "qa" | "legal" | "marketing" | "system";
export type JournalKind = "action" | "decision" | "issue" | "fix" | "opportunity" | "resume";

export interface JournalEntry {
  actor: JournalActor;
  kind: JournalKind;
  phase?: string;
  summary: string;
  detail?: string;
}

export interface JournalRow extends JournalEntry {
  id: string;
  resolved: boolean;
  createdAt: number | null;
}

/**
 * Enregistre une entrée dans le journal de bord. Fire-and-forget: n'attend pas,
 * n'échoue jamais. À utiliser depuis n'importe quelle IA (builder, chat, agents).
 */
export async function logJournal(companyId: string, entry: JournalEntry): Promise<void> {
  if (!companyId || !entry?.summary) return;
  try {
    await db.insert(buildJournal).values({
      id: randomUUID(),
      companyId,
      actor: entry.actor,
      kind: entry.kind,
      phase: entry.phase ?? null,
      summary: entry.summary.slice(0, 500),
      detail: entry.detail ? entry.detail.slice(0, 2000) : null,
      resolved: 0,
    });
  } catch (e) {
    console.warn("[journal] logJournal failed:", (e as any)?.message || e);
  }
}

// Marqueurs de progression internes qu'on ne journalise PAS (bruit / flux code).
const NOISE = /^\[(CODE_START|CODE_STREAM|CODE_DONE|CODE_EDIT|REASONING|IMG|QUESTIONS|BUILD_COMPANY)/;

/**
 * Classe un message de progression (onProgress/push) en entrée de journal.
 * Ignore le flux de code brut et les marqueurs internes. Détecte:
 *   - ⚠️ / échec / erreur           → issue (bug ouvert)
 *   - 🔧 corrigé / ✅ QA fixé         → fix
 *   - 💡 / occasion / pourrait       → opportunity
 *   - 📋 plan / 🎨 design / ✅ page   → action
 * Renvoie l'entrée créée (ou null si ignoré) — utile pour tests/chaînage.
 */
export function classifyMarker(actor: JournalActor, msg: string): JournalEntry | null {
  if (!msg || NOISE.test(msg)) return null;
  const m = msg.trim();
  // Phase heuristique.
  let phase: string | undefined;
  if (/plan/i.test(m)) phase = "plan";
  else if (/design/i.test(m)) phase = "design";
  else if (/page/i.test(m)) phase = "pages";
  else if (/conformit|juridi|legal/i.test(m)) phase = "legal";
  else if (/marketing/i.test(m)) phase = "marketing";

  // Bug / échec.
  if (/^⚠️|❌|échec|erreur|failed|error/i.test(m)) {
    return { actor, kind: "issue", phase, summary: m };
  }
  // Occasion d'amélioration (proposée, pas appliquée).
  if (/^💡|occasion|pourrait être|amélioration possible|à renforcer/i.test(m)) {
    return { actor, kind: "opportunity", phase, summary: m };
  }
  // Correction appliquée.
  if (/^🔧|corrigé|fixé|réparé|reconstruction/i.test(m)) {
    return { actor, kind: "fix", phase, summary: m };
  }
  // Décisions structurantes (plan/design retenus).
  if (/^📋|^🎨|retenu|planifié/i.test(m)) {
    return { actor, kind: "decision", phase, summary: m };
  }
  // Accomplissement concret (page finie, étape faite).
  if (/^✅|^💾|^📦|terminé|généré|fait\b/i.test(m)) {
    return { actor, kind: "action", phase, summary: m };
  }
  // Le reste (↩️ reprise, 🔎 recherche, 🧠 planification en cours…): trop verbeux
  // pour être conservé — on ne garde que les jalons ci-dessus.
  return null;
}

/**
 * Journalise un message de progression s'il est jugé significatif. Fire-and-forget.
 * À brancher dans le `push`/`onProgress` du build et du chat.
 */
export function journalMarker(companyId: string, actor: JournalActor, msg: string): void {
  const entry = classifyMarker(actor, msg);
  if (entry) void logJournal(companyId, entry);
}

/** Toutes les entrées d'un projet (les plus récentes d'abord). */
export async function getJournal(companyId: string, limit = 200): Promise<JournalRow[]> {
  try {
    const rows = await db.select().from(buildJournal)
      .where(eq(buildJournal.companyId, companyId))
      .orderBy(desc(buildJournal.createdAt))
      .limit(limit);
    return rows.map(toRow);
  } catch (e) {
    console.warn("[journal] getJournal failed:", (e as any)?.message || e);
    return [];
  }
}

/** Bugs ouverts (kind='issue', non résolus) — à re-corriger automatiquement. */
export async function getOpenIssues(companyId: string): Promise<JournalRow[]> {
  return getOpenByKind(companyId, "issue");
}

/** Occasions d'amélioration ouvertes — à PROPOSER (jamais appliquer d'office). */
export async function getOpenOpportunities(companyId: string): Promise<JournalRow[]> {
  return getOpenByKind(companyId, "opportunity");
}

async function getOpenByKind(companyId: string, kind: JournalKind): Promise<JournalRow[]> {
  try {
    const rows = await db.select().from(buildJournal)
      .where(and(
        eq(buildJournal.companyId, companyId),
        eq(buildJournal.kind, kind),
        eq(buildJournal.resolved, 0),
      ))
      .orderBy(desc(buildJournal.createdAt))
      .limit(100);
    return rows.map(toRow);
  } catch (e) {
    console.warn("[journal] getOpenByKind failed:", (e as any)?.message || e);
    return [];
  }
}

/** Marque une entrée (bug/occasion) comme traitée. */
export async function resolveEntry(id: string): Promise<void> {
  try {
    await db.update(buildJournal).set({ resolved: 1 }).where(eq(buildJournal.id, id));
  } catch (e) {
    console.warn("[journal] resolveEntry failed:", (e as any)?.message || e);
  }
}

/** Marque tous les bugs ouverts d'un projet comme traités (après reconstruction). */
export async function resolveAllIssues(companyId: string): Promise<void> {
  try {
    await db.update(buildJournal).set({ resolved: 1 })
      .where(and(
        eq(buildJournal.companyId, companyId),
        eq(buildJournal.kind, "issue"),
        eq(buildJournal.resolved, 0),
      ));
  } catch (e) {
    console.warn("[journal] resolveAllIssues failed:", (e as any)?.message || e);
  }
}

/**
 * Récapitulatif COMPACT en français de ce que l'IA a déjà fait sur ce projet.
 * Injecté au prompt / affiché à la reprise pour que l'IA soit « au courant ».
 * Vide si le projet n'a pas encore de journal.
 */
export async function summarizeJournal(companyId: string): Promise<string> {
  const rows = await getJournal(companyId, 300);
  if (!rows.length) return "";

  const actions = rows.filter((r) => r.kind === "action" || r.kind === "decision");
  const openIssues = rows.filter((r) => r.kind === "issue" && !r.resolved);
  const openOpps = rows.filter((r) => r.kind === "opportunity" && !r.resolved);

  const parts: string[] = [];
  if (actions.length) {
    // Les plus récentes d'abord: on en garde une dizaine pour rester compact.
    const recent = actions.slice(0, 10).map((r) => `- ${r.summary}`).reverse().join("\n");
    parts.push(`DÉJÀ ACCOMPLI (le plus récent en bas):\n${recent}`);
  }
  if (openIssues.length) {
    const list = openIssues.slice(0, 10).map((r) => `- ${r.summary}`).join("\n");
    parts.push(`BUGS OUVERTS (à corriger automatiquement):\n${list}`);
  }
  if (openOpps.length) {
    const list = openOpps.slice(0, 8).map((r) => `- ${r.summary}`).join("\n");
    parts.push(`OCCASIONS D'AMÉLIORATION (à proposer, pas à appliquer d'office):\n${list}`);
  }
  return parts.join("\n\n");
}

function toRow(r: any): JournalRow {
  return {
    id: r.id,
    actor: r.actor,
    kind: r.kind,
    phase: r.phase ?? undefined,
    summary: r.summary,
    detail: r.detail ?? undefined,
    resolved: !!r.resolved,
    createdAt: r.createdAt ?? null,
  };
}
