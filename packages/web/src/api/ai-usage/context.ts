// ─── Contexte d'attribution des appels IA (AsyncLocalStorage) ────────────────
//
// Problème : ~500 appels IA dans le code passent tous par `gateway(model)`, mais
// aucun ne sait "pour qui" ni "pour quoi" il tourne. Plutôt que de modifier
// chaque site d'appel, on propage un contexte ambiant par AsyncLocalStorage :
//
//   runWithAiContext({ feature: "chimera", companyId }, () => runChimera(...))
//
// Tout appel IA déclenché à l'intérieur (même 10 niveaux plus bas, même dans un
// await) hérite automatiquement de feature/user/projet/run. Le middleware du
// gateway lit ce contexte au moment d'enregistrer l'évènement.
//
// Hors contexte (job de fond non instrumenté), on retombe sur feature "unknown"
// — visible tel quel dans le dashboard, ce qui signale ce qu'il reste à taguer.

import { AsyncLocalStorage } from "node:async_hooks";
import { randomUUID } from "node:crypto";

export interface AiContext {
  /** À quoi sert l'appel : "chat", "chimera", "builder", "money-maker"… */
  feature: string;
  /** Détail libre : nom d'agent, étape du pipeline, commande. */
  label?: string;
  /** Route HTTP d'origine si l'appel vient d'une requête. */
  route?: string;
  /** Identifiant de run : regroupe tous les appels d'un même travail IA. */
  runId: string;
  userId?: string;
  userEmail?: string;
  /** Projet / société ciblée (companies.id). */
  companyId?: string;
  /** Projet builder (site/app généré) si différent de la société. */
  projectId?: string;
}

const storage = new AsyncLocalStorage<AiContext>();

/** Contexte courant, ou undefined si l'appel tourne hors instrumentation. */
export function getAiContext(): AiContext | undefined {
  return storage.getStore();
}

/**
 * Exécute `fn` avec un contexte d'attribution. Hérite du contexte parent :
 * un sous-pipeline peut préciser `label` sans reperdre user/companyId.
 */
export function runWithAiContext<T>(ctx: Partial<AiContext> & { feature: string }, fn: () => T): T {
  const parent = storage.getStore();
  const merged: AiContext = {
    ...parent,
    ...ctx,
    runId: ctx.runId ?? parent?.runId ?? randomUUID(),
  };
  return storage.run(merged, fn);
}

/**
 * Complète le contexte courant en place (sans nouveau scope).
 * Utilisé par getUser() : l'identité n'est connue qu'après résolution du token,
 * alors que le contexte a été ouvert au début de la requête.
 */
export function patchAiContext(patch: Partial<AiContext>): void {
  const current = storage.getStore();
  if (!current) return;
  Object.assign(current, patch);
}

/** Nouveau runId (ex. relance d'un pipeline dans la même requête). */
export function newRunId(): string {
  return randomUUID();
}

/**
 * Devine la feature depuis un chemin HTTP quand rien de plus précis n'est posé.
 * Garde des noms stables et lisibles dans le dashboard.
 */
export function featureFromPath(path: string): string {
  const p = path.replace(/^\/api/, "");
  if (p.startsWith("/chat")) return "chat";
  if (p.startsWith("/chimera")) return "chimera";
  if (p.startsWith("/genesis")) return "genesis";
  if (p.startsWith("/builder")) return "builder";
  if (p.startsWith("/test1") || p.startsWith("/test")) return "test-lab";
  if (p.startsWith("/money-maker")) return "money-maker";
  if (p.startsWith("/autopilot")) return "autopilot";
  if (p.startsWith("/social") || p.startsWith("/ai-comms")) return "social";
  if (p.startsWith("/crypto")) return "crypto";
  if (p.startsWith("/printify") || p.startsWith("/dropship")) return "commerce";
  if (p.startsWith("/higgsfield")) return "higgsfield";
  if (p.startsWith("/admin")) return "admin";
  if (p.startsWith("/companies")) {
    if (p.includes("/build")) return "company-build";
    if (p.includes("/generate")) return "company-generate";
    if (p.includes("/crm")) return "crm";
    return "company";
  }
  return `api${p.split("/").slice(0, 2).join("/")}` || "api";
}

/** Extrait un companyId d'un chemin type /api/companies/<id>/... */
export function companyIdFromPath(path: string): string | undefined {
  const m = /\/companies\/([^/?]+)/.exec(path);
  return m?.[1];
}
