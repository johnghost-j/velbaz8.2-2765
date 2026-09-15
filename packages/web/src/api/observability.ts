// ─── Observabilité: logs structurés + snapshot santé ────────────────────────
// Pas de Sentry externe dans le stack managé → on log en JSON structuré sur stdout
// (parsable par n'importe quel collecteur) et on expose un snapshot santé agrégé
// depuis la DB pour un dashboard admin.

import { db } from './database/index';
import * as schema from './database/schema';
import { sql, gte, inArray } from 'drizzle-orm';

/** Log structuré JSON — une ligne = un event, parsable par un collecteur. */
export function slog(level: 'info' | 'warn' | 'error', event: string, fields: Record<string, any> = {}) {
  const line = JSON.stringify({ t: new Date().toISOString(), level, event, ...fields });
  if (level === 'error') console.error(line);
  else if (level === 'warn') console.warn(line);
  else console.log(line);
}

export interface HealthSnapshot {
  ts: string;
  uptimeSec: number;
  memory: { rssMB: number; heapUsedMB: number };
  jobs: { running: number; failed24h: number; interrupted24h: number; completed24h: number };
  agents: { total: number; active: number };
  errors: { last24h: number; last1h: number; byLevel: Record<string, number> };
  autopilot: { enabledCompanies: number };
}

export async function getHealthSnapshot(): Promise<HealthSnapshot> {
  const now = Date.now();
  const day = new Date(now - 24 * 3600_000);
  const hour = new Date(now - 3600_000);
  const mem = process.memoryUsage();

  const count = async (fn: () => Promise<any>): Promise<number> => {
    try { const r = await fn(); return Number(r?.[0]?.c ?? r?.c ?? 0); } catch { return 0; }
  };

  const [
    jobsRunning, jobsFailed, jobsInterrupted, jobsCompleted,
    agentsTotal, agentsActive, err24, err1h, autopilotEnabled,
  ] = await Promise.all([
    count(() => db.select({ c: sql<number>`count(*)` }).from(schema.jobQueue).where(sql`status = 'running'`).all()),
    count(() => db.select({ c: sql<number>`count(*)` }).from(schema.jobQueue).where(sql`status = 'failed' AND completed_at >= ${Math.floor(day.getTime() / 1000)}`).all()),
    count(() => db.select({ c: sql<number>`count(*)` }).from(schema.jobQueue).where(sql`status = 'interrupted' AND completed_at >= ${Math.floor(day.getTime() / 1000)}`).all()),
    count(() => db.select({ c: sql<number>`count(*)` }).from(schema.jobQueue).where(sql`status = 'completed' AND completed_at >= ${Math.floor(day.getTime() / 1000)}`).all()),
    count(() => db.select({ c: sql<number>`count(*)` }).from(schema.agents).all()),
    count(() => db.select({ c: sql<number>`count(*)` }).from(schema.agents).where(sql`status = 'active'`).all()),
    count(() => db.select({ c: sql<number>`count(*)` }).from(schema.errorLogs).where(gte(schema.errorLogs.createdAt, day)).all()),
    count(() => db.select({ c: sql<number>`count(*)` }).from(schema.errorLogs).where(gte(schema.errorLogs.createdAt, hour)).all()),
    count(() => db.select({ c: sql<number>`count(*)` }).from(schema.autopilotConfig).where(sql`enabled = 1`).all()),
  ]);

  // Erreurs par niveau sur 24h
  const byLevel: Record<string, number> = {};
  try {
    const rows = await db.select({ level: schema.errorLogs.level, c: sql<number>`count(*)` })
      .from(schema.errorLogs).where(gte(schema.errorLogs.createdAt, day))
      .groupBy(schema.errorLogs.level).all();
    for (const r of rows) byLevel[r.level] = Number(r.c);
  } catch {}

  return {
    ts: new Date().toISOString(),
    uptimeSec: Math.round(process.uptime()),
    memory: { rssMB: Math.round(mem.rss / 1048576), heapUsedMB: Math.round(mem.heapUsed / 1048576) },
    jobs: { running: jobsRunning, failed24h: jobsFailed, interrupted24h: jobsInterrupted, completed24h: jobsCompleted },
    agents: { total: agentsTotal, active: agentsActive },
    errors: { last24h: err24, last1h: err1h, byLevel },
    autopilot: { enabledCompanies: autopilotEnabled },
  };
}
