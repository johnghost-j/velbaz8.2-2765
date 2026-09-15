// ─── Team Bus — communication inter-agents ───────────────────────────────────
// Chaque message entre agents est :
//   1. persisté dans `agent_messages` (conversation liée à un taskId)
//   2. copié dans `agent_activity` (→ apparaît automatiquement dans le flux SSE
//      temps réel du panneau « Activité IA en direct » déjà en place)
//   3. poussé en direct via le callback onEvent (→ événement SSE `teamMsg` dans le chat)
//
// Statuts détectables SANS couleur (accessibilité protanopie) : chaque type a
// une étiquette texte [DEMANDE]/[RÉPONSE]/... + un symbole ▶ ✓ ✗.

import { eq, asc } from "drizzle-orm";
import { db } from "../database/index";
import * as schema from "../database/schema";

export type TeamMsgType =
  | "demande"
  | "reponse"
  | "remise"
  | "critique"
  | "validation"
  | "info"
  | "synthese"
  | "erreur";

export interface TeamEvent {
  id: string;
  taskId: string;
  from: string; // nom affichable de l'agent émetteur (ex: "Recherche")
  to: string; // nom affichable du destinataire (ex: "Branding" ou "Équipe")
  type: TeamMsgType;
  label: string; // étiquette texte lisible sans couleur, ex: "[DEMANDE]"
  symbol: string; // ▶ ✓ ✗ …
  content: string;
  ts: number; // epoch ms
}

export const TEAM_LABELS: Record<TeamMsgType, { label: string; symbol: string; action: string }> = {
  demande: { label: "[DEMANDE]", symbol: "▶", action: "executing" },
  reponse: { label: "[RÉPONSE]", symbol: "✓", action: "completed" },
  remise: { label: "[TERMINÉ]", symbol: "✓", action: "completed" },
  critique: { label: "[CRITIQUE]", symbol: "▶", action: "executing" },
  validation: { label: "[VALIDÉ]", symbol: "✓", action: "completed" },
  info: { label: "[EN COURS]", symbol: "▶", action: "executing" },
  synthese: { label: "[TERMINÉ]", symbol: "✓", action: "completed" },
  erreur: { label: "[ERREUR]", symbol: "✗", action: "error" },
};

export interface SendAgentMessageOpts {
  companyId?: string | null;
  taskId: string;
  fromRole: string; // rôle technique (research, marketing…)
  toRole: string;
  fromName: string; // nom affichable (Recherche, Marketing…)
  toName: string;
  type: TeamMsgType;
  content: string;
  onEvent?: (evt: TeamEvent) => void;
}

/** Envoie un message sur le bus : DB agent_messages + copie agent_activity + event SSE live. */
export async function sendAgentMessage(opts: SendAgentMessageOpts): Promise<TeamEvent> {
  const id = crypto.randomUUID();
  const meta = TEAM_LABELS[opts.type];
  const evt: TeamEvent = {
    id,
    taskId: opts.taskId,
    from: opts.fromName,
    to: opts.toName,
    type: opts.type,
    label: meta.label,
    symbol: meta.symbol,
    content: opts.content,
    ts: Date.now(),
  };

  // 3. Push temps réel d'abord (jamais bloqué par la DB)
  try {
    opts.onEvent?.(evt);
  } catch (e: any) {
    console.error("[team-bus] onEvent failed (non-blocking):", e?.message);
  }

  // 1. Persistance de la conversation d'équipe
  try {
    await db.insert(schema.agentMessages).values({
      id,
      companyId: opts.companyId || null,
      taskId: opts.taskId,
      fromRole: opts.fromRole,
      toRole: opts.toRole,
      type: opts.type,
      content: opts.content,
    });
  } catch (e: any) {
    console.error("[team-bus] agent_messages insert failed:", e?.message);
  }

  // 2. Copie dans le flux d'activité (panneau temps réel) — nécessite un companyId
  if (opts.companyId) {
    try {
      await db.insert(schema.agentActivity).values({
        id: crypto.randomUUID(),
        companyId: opts.companyId,
        agentRole: opts.fromRole,
        action: meta.action,
        message: `${meta.symbol} ${meta.label} ${opts.fromName} → ${opts.toName} : ${opts.content.slice(0, 220)}${opts.content.length > 220 ? "…" : ""}`,
        metadata: JSON.stringify({ team: true, taskId: opts.taskId, from: opts.fromName, to: opts.toName, type: opts.type }),
      });
    } catch (e: any) {
      console.error("[team-bus] agent_activity copy failed:", e?.message);
    }
  }

  return evt;
}

/** Récupère toute la conversation d'équipe d'un taskId (ordre chronologique). */
export async function getConversation(taskId: string) {
  return db
    .select()
    .from(schema.agentMessages)
    .where(eq(schema.agentMessages.taskId, taskId))
    .orderBy(asc(schema.agentMessages.createdAt));
}
