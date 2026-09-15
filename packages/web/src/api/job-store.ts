// ─── Durable job store ───────────────────────────────────────────────────────
// Le stack managé n'a pas de Redis. On ne peut pas sérialiser une closure JS,
// donc les jobs continuent de s'exécuter en process (Map live pour l'annulation),
// MAIS leur état est mirroré en table `job_queue`. Au boot, on réconcilie:
//   - tout job resté "running" en DB = orphelin d'un crash → "interrupted"
//   - les types resumables sont ré-enfilés par le caller via getResumableJobs()
// Ça élimine le "perdu silencieusement au redémarrage" sans infra externe.

import { db } from './database/index';
import * as schema from './database/schema';
import { eq, and, inArray } from 'drizzle-orm';

export type JobStatusDb = 'queued' | 'running' | 'completed' | 'failed' | 'interrupted';

// Types de jobs qui peuvent reprendre proprement après un crash.
export const RESUMABLE_TYPES = new Set<string>(['build-website']);

async function safe<T>(fn: () => Promise<T>): Promise<T | null> {
  try { return await fn(); } catch (e: any) {
    console.error('[job-store]', e?.message || e);
    return null;
  }
}

export async function jobCreate(row: {
  id: string; companyId: string; type: string; payload?: any;
}): Promise<void> {
  await safe(() => db.insert(schema.jobQueue).values({
    id: row.id,
    companyId: row.companyId,
    type: row.type,
    status: 'running',
    resumable: RESUMABLE_TYPES.has(row.type),
    payload: row.payload ? JSON.stringify(row.payload) : null,
    startedAt: new Date(),
    updatedAt: new Date(),
  }));
}

export async function jobUpdate(id: string, patch: {
  status?: JobStatusDb; error?: string; completedAt?: Date;
}): Promise<void> {
  await safe(() => db.update(schema.jobQueue).set({
    ...(patch.status ? { status: patch.status } : {}),
    ...(patch.error !== undefined ? { error: patch.error.slice(0, 1000) } : {}),
    ...(patch.completedAt ? { completedAt: patch.completedAt } : {}),
    updatedAt: new Date(),
  }).where(eq(schema.jobQueue.id, id)));
}

/**
 * Réconciliation au démarrage. Marque les jobs "running"/"queued" orphelins
 * comme "interrupted" et renvoie ceux qui sont resumables pour ré-enfilage.
 * À appeler UNE fois au boot (guardé par globalThis).
 */
export async function reconcileJobsOnBoot(): Promise<Array<{ id: string; companyId: string; type: string; payload: any }>> {
  const orphans = await safe(() => db.select().from(schema.jobQueue)
    .where(inArray(schema.jobQueue.status, ['running', 'queued'])).all());
  if (!orphans || orphans.length === 0) return [];

  const resumable: Array<{ id: string; companyId: string; type: string; payload: any }> = [];
  for (const j of orphans) {
    await jobUpdate(j.id, { status: 'interrupted', error: 'Interrupted by server restart', completedAt: new Date() });
    if (j.resumable) {
      let payload: any = null;
      try { payload = j.payload ? JSON.parse(j.payload) : null; } catch {}
      resumable.push({ id: j.id, companyId: j.companyId, type: j.type, payload });
    }
  }
  console.log(`[job-store] boot reconcile: ${orphans.length} orphan job(s) → interrupted, ${resumable.length} resumable`);
  return resumable;
}

export async function getJobsForCompanyDb(companyId: string) {
  return (await safe(() => db.select().from(schema.jobQueue)
    .where(eq(schema.jobQueue.companyId, companyId)).all())) || [];
}
