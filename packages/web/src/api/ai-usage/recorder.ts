// ─── Enregistreur d'évènements IA (buffer + écriture DB non bloquante) ───────
//
// Règle absolue : journaliser ne doit JAMAIS ralentir ni casser un appel IA.
// D'où : mise en file mémoire, flush groupé (batch) toutes les FLUSH_MS ou dès
// MAX_BATCH évènements, et repli fichier JSONL si la DB est indisponible.

import { randomUUID } from "node:crypto";
import { appendFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { db } from "../database/index";
import { aiUsageEvents } from "../database/schema";
import { usdToCredits } from "./pricing";
import { chargeBatch } from "./billing";

export interface AiUsageRecord {
  startedAt: number;
  endedAt: number;
  model: string;
  provider?: string;
  routedVia?: string;
  kind?: string;
  feature?: string;
  label?: string | null;
  route?: string | null;
  runId?: string | null;
  userId?: string | null;
  userEmail?: string | null;
  companyId?: string | null;
  projectId?: string | null;
  inputTokens?: number;
  outputTokens?: number;
  cacheReadTokens?: number;
  cacheWriteTokens?: number;
  reasoningTokens?: number;
  images?: number;
  costUsd: number;
  priced?: "table" | "fallback";
  status?: "ok" | "error";
  errorMessage?: string | null;
  finishReason?: string | null;
  meta?: unknown;
}

type Row = typeof aiUsageEvents.$inferInsert;

const FLUSH_MS = 1500;
const MAX_BATCH = 40;
const FALLBACK_FILE = join(process.cwd(), "data", "ai-usage.jsonl");

// Persisté sur globalThis : survit au re-eval SSR de Vite (sinon on perdrait
// la file en cours à chaque HMR).
const state: { queue: Row[]; timer: NodeJS.Timeout | null } = ((globalThis as any).__velbaz_ai_usage_state ??= {
  queue: [],
  timer: null,
});

function toRow(r: AiUsageRecord): Row {
  const input = Math.max(0, Math.round(r.inputTokens ?? 0));
  const output = Math.max(0, Math.round(r.outputTokens ?? 0));
  const cacheRead = Math.max(0, Math.round(r.cacheReadTokens ?? 0));
  const cacheWrite = Math.max(0, Math.round(r.cacheWriteTokens ?? 0));
  const reasoning = Math.max(0, Math.round(r.reasoningTokens ?? 0));
  const costUsd = Number.isFinite(r.costUsd) ? Number(r.costUsd) : 0;
  const slash = r.model.indexOf("/");

  return {
    id: randomUUID(),
    startedAt: new Date(r.startedAt),
    endedAt: new Date(r.endedAt),
    durationMs: Math.max(0, Math.round(r.endedAt - r.startedAt)),
    model: r.model,
    provider: r.provider ?? (slash > 0 ? r.model.slice(0, slash) : "unknown"),
    routedVia: r.routedVia ?? "gateway",
    kind: r.kind ?? "text",
    feature: r.feature ?? "unknown",
    label: r.label ?? null,
    route: r.route ?? null,
    runId: r.runId ?? null,
    userId: r.userId ?? null,
    userEmail: r.userEmail ?? null,
    companyId: r.companyId ?? null,
    projectId: r.projectId ?? null,
    inputTokens: input,
    outputTokens: output,
    cacheReadTokens: cacheRead,
    cacheWriteTokens: cacheWrite,
    reasoningTokens: reasoning,
    totalTokens: input + output + cacheRead + cacheWrite,
    images: Math.max(0, Math.round(r.images ?? 0)),
    costUsd,
    credits: usdToCredits(costUsd),
    priced: r.priced ?? "table",
    status: r.status ?? "ok",
    errorMessage: r.errorMessage ? String(r.errorMessage).slice(0, 500) : null,
    finishReason: r.finishReason ?? null,
    meta: r.meta ? JSON.stringify(r.meta).slice(0, 2000) : null,
  };
}

async function writeFallback(rows: Row[]): Promise<void> {
  try {
    await mkdir(join(process.cwd(), "data"), { recursive: true });
    await appendFile(FALLBACK_FILE, rows.map((r) => JSON.stringify(r)).join("\n") + "\n");
  } catch {
    /* dernier recours : on abandonne silencieusement plutôt que de casser l'appel IA */
  }
}

async function flush(): Promise<void> {
  if (state.timer) {
    clearTimeout(state.timer);
    state.timer = null;
  }
  if (state.queue.length === 0) return;
  const batch = state.queue.splice(0, state.queue.length);
  try {
    await db.insert(aiUsageEvents).values(batch);
  } catch (e) {
    console.warn("[ai-usage] écriture DB KO, repli JSONL :", (e as Error).message);
    await writeFallback(batch);
  }
  // Débit réel du solde : 1 $ de coût IA = CREDITS_PER_USD crédits (3000).
  // Se fait après coup — le coût n'est connu qu'une fois l'appel terminé.
  // chargeBatch ne throw jamais : un échec de facturation ne casse rien.
  await chargeBatch(batch);
}

function schedule(): void {
  if (state.queue.length >= MAX_BATCH) {
    void flush();
    return;
  }
  if (state.timer) return;
  state.timer = setTimeout(() => void flush(), FLUSH_MS);
  // Ne pas retenir le process pour un flush en attente.
  state.timer.unref?.();
}

/** Enregistre un appel IA. Ne throw jamais, ne bloque jamais. */
export function recordAiUsage(record: AiUsageRecord): void {
  try {
    state.queue.push(toRow(record));
    schedule();
  } catch (e) {
    console.warn("[ai-usage] record KO :", (e as Error).message);
  }
}

/** Vide la file immédiatement (arrêt du process, tests, lecture cohérente). */
export async function flushAiUsage(): Promise<void> {
  await flush();
}
