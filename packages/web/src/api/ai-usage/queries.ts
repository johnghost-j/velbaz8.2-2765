// ─── Agrégations de lecture pour le dashboard admin des crédits IA ───────────
//
// Toutes les fonctions sont en LECTURE SEULE : on mesure et on affiche, on ne
// bloque jamais un appel. Chaque agrégat rend le coût en USD *et* en crédits
// (voir pricing.ts / AI_CREDITS_PER_USD) pour être lisible dans les deux unités.

import { and, asc, desc, eq, gte, lte, sql, type SQL } from "drizzle-orm";
import { db } from "../database/index";
import { aiUsageEvents, companies } from "../database/schema";
import { CREDITS_PER_USD } from "./pricing";

export interface UsageFilters {
  /** Début de période (ms epoch). */
  since?: number;
  /** Fin de période (ms epoch). */
  until?: number;
  feature?: string;
  model?: string;
  userId?: string;
  companyId?: string;
  projectId?: string;
  status?: "ok" | "error";
  runId?: string;
}

// ── Colonnes d'agrégat réutilisées partout ──────────────────────────────────
const AGG = {
  calls: sql<number>`count(*)`,
  costUsd: sql<number>`coalesce(sum(${aiUsageEvents.costUsd}), 0)`,
  credits: sql<number>`coalesce(sum(${aiUsageEvents.credits}), 0)`,
  inputTokens: sql<number>`coalesce(sum(${aiUsageEvents.inputTokens}), 0)`,
  outputTokens: sql<number>`coalesce(sum(${aiUsageEvents.outputTokens}), 0)`,
  cacheReadTokens: sql<number>`coalesce(sum(${aiUsageEvents.cacheReadTokens}), 0)`,
  cacheWriteTokens: sql<number>`coalesce(sum(${aiUsageEvents.cacheWriteTokens}), 0)`,
  reasoningTokens: sql<number>`coalesce(sum(${aiUsageEvents.reasoningTokens}), 0)`,
  totalTokens: sql<number>`coalesce(sum(${aiUsageEvents.totalTokens}), 0)`,
  images: sql<number>`coalesce(sum(${aiUsageEvents.images}), 0)`,
  // Temps de travail réel de l'IA (somme des durées d'appel).
  busyMs: sql<number>`coalesce(sum(${aiUsageEvents.durationMs}), 0)`,
  avgMs: sql<number>`coalesce(cast(avg(${aiUsageEvents.durationMs}) as int), 0)`,
  maxMs: sql<number>`coalesce(max(${aiUsageEvents.durationMs}), 0)`,
  errors: sql<number>`coalesce(sum(case when ${aiUsageEvents.status} = 'error' then 1 else 0 end), 0)`,
  wastedUsd: sql<number>`coalesce(sum(case when ${aiUsageEvents.status} = 'error' then ${aiUsageEvents.costUsd} else 0 end), 0)`,
  wastedCredits: sql<number>`coalesce(sum(case when ${aiUsageEvents.status} = 'error' then ${aiUsageEvents.credits} else 0 end), 0)`,
  estimated: sql<number>`coalesce(sum(case when ${aiUsageEvents.priced} = 'fallback' then 1 else 0 end), 0)`,
} as const;

function where(f: UsageFilters): SQL | undefined {
  const parts: (SQL | undefined)[] = [];
  if (f.since != null) parts.push(gte(aiUsageEvents.startedAt, new Date(f.since)));
  if (f.until != null) parts.push(lte(aiUsageEvents.startedAt, new Date(f.until)));
  if (f.feature) parts.push(eq(aiUsageEvents.feature, f.feature));
  if (f.model) parts.push(eq(aiUsageEvents.model, f.model));
  if (f.userId) parts.push(eq(aiUsageEvents.userId, f.userId));
  if (f.companyId) parts.push(eq(aiUsageEvents.companyId, f.companyId));
  if (f.projectId) parts.push(eq(aiUsageEvents.projectId, f.projectId));
  if (f.status) parts.push(eq(aiUsageEvents.status, f.status));
  if (f.runId) parts.push(eq(aiUsageEvents.runId, f.runId));
  const kept = parts.filter(Boolean) as SQL[];
  return kept.length > 0 ? and(...kept) : undefined;
}

// ── 1. Résumé global ────────────────────────────────────────────────────────
export async function getSummary(f: UsageFilters) {
  const [row] = await db
    .select({
      calls: AGG.calls,
      costUsd: AGG.costUsd,
      credits: AGG.credits,
      inputTokens: AGG.inputTokens,
      outputTokens: AGG.outputTokens,
      cacheReadTokens: AGG.cacheReadTokens,
      cacheWriteTokens: AGG.cacheWriteTokens,
      reasoningTokens: AGG.reasoningTokens,
      totalTokens: AGG.totalTokens,
      images: AGG.images,
      busyMs: AGG.busyMs,
      avgMs: AGG.avgMs,
      maxMs: AGG.maxMs,
      errors: AGG.errors,
      wastedUsd: AGG.wastedUsd,
      wastedCredits: AGG.wastedCredits,
      estimated: AGG.estimated,
      firstAt: sql<number | null>`min(${aiUsageEvents.startedAt})`,
      lastAt: sql<number | null>`max(${aiUsageEvents.startedAt})`,
      users: sql<number>`count(distinct ${aiUsageEvents.userId})`,
      companiesCount: sql<number>`count(distinct ${aiUsageEvents.companyId})`,
      models: sql<number>`count(distinct ${aiUsageEvents.model})`,
      runs: sql<number>`count(distinct ${aiUsageEvents.runId})`,
    })
    .from(aiUsageEvents)
    .where(where(f));

  const calls = row?.calls ?? 0;
  return {
    ...row,
    creditsPerUsd: CREDITS_PER_USD,
    errorRate: calls > 0 ? (row?.errors ?? 0) / calls : 0,
    avgCostUsd: calls > 0 ? (row?.costUsd ?? 0) / calls : 0,
  };
}

// ── 2. Timeline : « quand l'IA a bossé » ────────────────────────────────────
/** `bucket`: 'hour' | 'day'. Rend appels, coût et temps occupé par tranche. */
export async function getTimeline(f: UsageFilters, bucket: "hour" | "day" = "day") {
  // startedAt est stocké en ms → conversion en secondes pour strftime.
  const fmt = bucket === "hour" ? "%Y-%m-%dT%H:00" : "%Y-%m-%d";
  const slot = sql<string>`strftime(${fmt}, ${aiUsageEvents.startedAt} / 1000, 'unixepoch')`;
  return db
    .select({
      slot,
      calls: AGG.calls,
      costUsd: AGG.costUsd,
      credits: AGG.credits,
      totalTokens: AGG.totalTokens,
      busyMs: AGG.busyMs,
      avgMs: AGG.avgMs,
      errors: AGG.errors,
    })
    .from(aiUsageEvents)
    .where(where(f))
    .groupBy(slot)
    .orderBy(asc(slot));
}

// ── 3. Répartition par feature (« c'était pour quoi ») ──────────────────────
export async function getByFeature(f: UsageFilters) {
  return db
    .select({
      feature: aiUsageEvents.feature,
      calls: AGG.calls,
      costUsd: AGG.costUsd,
      credits: AGG.credits,
      totalTokens: AGG.totalTokens,
      images: AGG.images,
      busyMs: AGG.busyMs,
      avgMs: AGG.avgMs,
      errors: AGG.errors,
      wastedUsd: AGG.wastedUsd,
    })
    .from(aiUsageEvents)
    .where(where(f))
    .groupBy(aiUsageEvents.feature)
    .orderBy(desc(AGG.costUsd));
}

// ── 4. Répartition par modèle ───────────────────────────────────────────────
export async function getByModel(f: UsageFilters) {
  return db
    .select({
      model: aiUsageEvents.model,
      provider: aiUsageEvents.provider,
      routedVia: aiUsageEvents.routedVia,
      calls: AGG.calls,
      costUsd: AGG.costUsd,
      credits: AGG.credits,
      inputTokens: AGG.inputTokens,
      outputTokens: AGG.outputTokens,
      cacheReadTokens: AGG.cacheReadTokens,
      images: AGG.images,
      avgMs: AGG.avgMs,
      errors: AGG.errors,
      estimated: AGG.estimated,
    })
    .from(aiUsageEvents)
    .where(where(f))
    .groupBy(aiUsageEvents.model, aiUsageEvents.provider, aiUsageEvents.routedVia)
    .orderBy(desc(AGG.costUsd));
}

// ── 5. Top consommateurs : utilisateurs ─────────────────────────────────────
export async function getByUser(f: UsageFilters, limit = 50) {
  return db
    .select({
      userId: aiUsageEvents.userId,
      userEmail: aiUsageEvents.userEmail,
      calls: AGG.calls,
      costUsd: AGG.costUsd,
      credits: AGG.credits,
      totalTokens: AGG.totalTokens,
      images: AGG.images,
      busyMs: AGG.busyMs,
      errors: AGG.errors,
      wastedUsd: AGG.wastedUsd,
      features: sql<number>`count(distinct ${aiUsageEvents.feature})`,
      lastAt: sql<number | null>`max(${aiUsageEvents.startedAt})`,
    })
    .from(aiUsageEvents)
    .where(where(f))
    .groupBy(aiUsageEvents.userId, aiUsageEvents.userEmail)
    .orderBy(desc(AGG.costUsd))
    .limit(limit);
}

// ── 6. Top consommateurs : sociétés / projets ───────────────────────────────
export async function getByCompany(f: UsageFilters, limit = 50) {
  return db
    .select({
      companyId: aiUsageEvents.companyId,
      companyName: companies.name,
      calls: AGG.calls,
      costUsd: AGG.costUsd,
      credits: AGG.credits,
      totalTokens: AGG.totalTokens,
      images: AGG.images,
      busyMs: AGG.busyMs,
      errors: AGG.errors,
      wastedUsd: AGG.wastedUsd,
      lastAt: sql<number | null>`max(${aiUsageEvents.startedAt})`,
    })
    .from(aiUsageEvents)
    // leftJoin : on garde les évènements sans société rattachée (jobs globaux).
    .leftJoin(companies, eq(companies.id, aiUsageEvents.companyId))
    .where(where(f))
    .groupBy(aiUsageEvents.companyId, companies.name)
    .orderBy(desc(AGG.costUsd))
    .limit(limit);
}

/** Répartition par projet builder (projectId), quand il diffère de la société. */
export async function getByProject(f: UsageFilters, limit = 50) {
  return db
    .select({
      projectId: aiUsageEvents.projectId,
      calls: AGG.calls,
      costUsd: AGG.costUsd,
      credits: AGG.credits,
      totalTokens: AGG.totalTokens,
      busyMs: AGG.busyMs,
      errors: AGG.errors,
      lastAt: sql<number | null>`max(${aiUsageEvents.startedAt})`,
    })
    .from(aiUsageEvents)
    .where(where(f))
    .groupBy(aiUsageEvents.projectId)
    .orderBy(desc(AGG.costUsd))
    .limit(limit);
}

// ── 7. Échecs : taux + coût gaspillé, détaillé par cause ────────────────────
export async function getFailures(f: UsageFilters, limit = 30) {
  const byFeature = await db
    .select({
      feature: aiUsageEvents.feature,
      model: aiUsageEvents.model,
      errors: AGG.calls,
      wastedUsd: AGG.costUsd,
      wastedCredits: AGG.credits,
      lastAt: sql<number | null>`max(${aiUsageEvents.startedAt})`,
      sampleError: sql<string | null>`max(${aiUsageEvents.errorMessage})`,
    })
    .from(aiUsageEvents)
    .where(and(where({ ...f, status: undefined }) ?? sql`1=1`, eq(aiUsageEvents.status, "error")))
    .groupBy(aiUsageEvents.feature, aiUsageEvents.model)
    .orderBy(desc(AGG.calls))
    .limit(limit);

  const [totals] = await db
    .select({ calls: AGG.calls, errors: AGG.errors, wastedUsd: AGG.wastedUsd, wastedCredits: AGG.wastedCredits })
    .from(aiUsageEvents)
    .where(where({ ...f, status: undefined }));

  const calls = totals?.calls ?? 0;
  return {
    calls,
    errors: totals?.errors ?? 0,
    errorRate: calls > 0 ? (totals?.errors ?? 0) / calls : 0,
    wastedUsd: totals?.wastedUsd ?? 0,
    wastedCredits: totals?.wastedCredits ?? 0,
    byFeature,
  };
}

// ── 8. Détail brut : liste paginée des appels ───────────────────────────────
export async function getEvents(f: UsageFilters, limit = 100, offset = 0) {
  const rows = await db
    .select()
    .from(aiUsageEvents)
    .where(where(f))
    .orderBy(desc(aiUsageEvents.startedAt))
    .limit(Math.min(limit, 500))
    .offset(offset);

  const [count] = await db
    .select({ total: sql<number>`count(*)` })
    .from(aiUsageEvents)
    .where(where(f));

  return { rows, total: count?.total ?? 0, limit, offset };
}

/** Un appel précis, pour le panneau de détail cliquable. */
export async function getEvent(id: string) {
  const [row] = await db.select().from(aiUsageEvents).where(eq(aiUsageEvents.id, id)).limit(1);
  return row ?? null;
}

// ── 9. Runs : regroupe les appels d'un même travail IA ──────────────────────
/**
 * Un « run » = un pipeline (un build, un chat, un tick autopilot). Donne le
 * début, la fin, la durée d'horloge, le temps IA cumulé et le nombre d'appels.
 * `concurrency` = temps IA cumulé / durée d'horloge : > 1 signifie que plusieurs
 * appels tournaient en parallèle (l'IA travaillait sur plusieurs fronts).
 */
export async function getRuns(f: UsageFilters, limit = 60) {
  const rows = await db
    .select({
      runId: aiUsageEvents.runId,
      feature: aiUsageEvents.feature,
      label: sql<string | null>`max(${aiUsageEvents.label})`,
      userEmail: sql<string | null>`max(${aiUsageEvents.userEmail})`,
      companyId: sql<string | null>`max(${aiUsageEvents.companyId})`,
      calls: AGG.calls,
      costUsd: AGG.costUsd,
      credits: AGG.credits,
      totalTokens: AGG.totalTokens,
      busyMs: AGG.busyMs,
      errors: AGG.errors,
      startedAt: sql<number>`min(${aiUsageEvents.startedAt})`,
      endedAt: sql<number>`max(${aiUsageEvents.endedAt})`,
    })
    .from(aiUsageEvents)
    .where(where(f))
    .groupBy(aiUsageEvents.runId, aiUsageEvents.feature)
    .orderBy(desc(sql`min(${aiUsageEvents.startedAt})`))
    .limit(limit);

  return rows.map((r) => {
    const wallMs = Math.max(1, Number(r.endedAt) - Number(r.startedAt));
    return { ...r, wallMs, concurrency: Number((Number(r.busyMs) / wallMs).toFixed(2)) };
  });
}
