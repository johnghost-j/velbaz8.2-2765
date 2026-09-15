/**
 * Routes admin de la console COMMUNICATION / PUB / MARKETING
 * ----------------------------------------------------------
 *   POST   /admin/comms/run           → étudie + génère 3 pistes + juge
 *   POST   /admin/comms/rate          → note 1-10 (+ correction) et apprend
 *   GET    /admin/comms/playbook      → les règles apprises
 *   DELETE /admin/comms/playbook/:id  → oublier une règle
 *   GET    /admin/comms/stats         → progression de l'entraînement
 *   GET    /admin/comms/examples      → historique des tests
 *
 * SIMULATION UNIQUEMENT : rien n'est publié ni envoyé par ces routes. Elles
 * produisent du texte, l'enregistrent pour l'apprentissage, et c'est tout.
 */

import { Hono } from "hono";
import { rateLimit } from "../security";
import { runCommsTask } from "./engine";
import {
  forgetRule,
  getPlaybook,
  isTask,
  lastUnratedExample,
  learningStats,
  listExamples,
  rateExample,
  TASK_LABELS,
  TASKS,
  type TaskKind,
} from "./learning";

/** Auth injectée par index.ts. */
export interface CommsRouteDeps {
  requireAdmin: (c: any) => Promise<any>;
}

function taskParam(v?: string | null): TaskKind | undefined {
  return v && isTask(v) ? v : undefined;
}

export function createCommsRoutes(deps: CommsRouteDeps) {
  const r = new Hono();

  // Un run = 3 appels IA. On plafonne pour éviter qu'une console laissée
  // ouverte (ou un script) ne brûle des crédits en boucle.
  r.use("/admin/comms/*", rateLimit({ windowMs: 60_000, max: 60 }));

  r.use("/admin/comms/*", async (c, next) => {
    const admin = await deps.requireAdmin(c);
    if (!admin) return c.json({ error: "Forbidden" }, 403);
    c.set("adminUser" as never, admin as never);
    await next();
  });

  r.get("/admin/comms/tasks", (c) =>
    c.json({ tasks: TASKS.map((t) => ({ task: t, label: TASK_LABELS[t] })) }, 200),
  );

  r.post("/admin/comms/run", async (c) => {
    const body = await c.req.json().catch(() => ({} as any));
    const task = taskParam(body?.task);
    const input = String(body?.input || "").trim();
    if (!task) return c.json({ error: `task invalide (attendu: ${TASKS.join(", ")})` }, 400);
    if (!input) return c.json({ error: "input vide" }, 400);
    if (input.length > 6000) return c.json({ error: "input trop long (max 6000 caractères)" }, 400);

    const admin: any = c.get("adminUser" as never);
    try {
      const result = await runCommsTask({
        task,
        input,
        // Par défaut : mode production — UNE seule réponse, la meilleure,
        // du premier coup. Le mode 'train' (3 pistes + juge) ne sert qu'à
        // faire progresser l'IA depuis la console, jamais à répondre en vrai.
        mode: body?.mode === 'train' ? 'train' : 'direct',
        context: body?.context ? String(body.context).slice(0, 4000) : undefined,
        companyId: body?.companyId ? String(body.companyId) : null,
        createdBy: admin?.id ? String(admin.id) : null,
      });
      return c.json(result, 200);
    } catch (e: any) {
      console.error("[admin/comms/run] échec:", e?.message);
      return c.json({ error: e?.message || "échec du moteur" }, 500);
    }
  });

  r.post("/admin/comms/rate", async (c) => {
    const body = await c.req.json().catch(() => ({} as any));
    const score = Number(body?.score);
    const correction = body?.correction ? String(body.correction).slice(0, 4000) : null;
    if (!Number.isFinite(score) || score < 1 || score > 10) {
      return c.json({ error: "score attendu entre 1 et 10" }, 400);
    }

    const admin: any = c.get("adminUser" as never);
    let exampleId = body?.exampleId ? String(body.exampleId) : "";
    if (!exampleId) {
      // Pas d'id fourni : on note le dernier test non noté de cet admin.
      const last = await lastUnratedExample(admin?.id ? String(admin.id) : null);
      if (!last) return c.json({ error: "aucun test en attente de note" }, 404);
      exampleId = String(last.id);
    }

    try {
      const out = await rateExample(exampleId, score, correction);
      if (!out.ok) return c.json({ error: "exemple introuvable" }, 404);
      return c.json({ ...out, exampleId }, 200);
    } catch (e: any) {
      console.error("[admin/comms/rate] échec:", e?.message);
      return c.json({ error: e?.message || "échec de la notation" }, 500);
    }
  });

  r.get("/admin/comms/playbook", async (c) => {
    const task = taskParam(c.req.query("task"));
    const limit = Math.min(Number(c.req.query("limit")) || 100, 300);
    return c.json({ rules: await getPlaybook(task, limit) }, 200);
  });

  r.delete("/admin/comms/playbook/:id", async (c) => {
    const ok = await forgetRule(c.req.param("id"));
    if (!ok) return c.json({ error: "règle introuvable ou déjà oubliée" }, 404);
    return c.json({ ok: true }, 200);
  });

  r.get("/admin/comms/stats", async (c) => c.json(await learningStats(), 200));

  r.get("/admin/comms/examples", async (c) => {
    const task = taskParam(c.req.query("task"));
    const limit = Math.min(Number(c.req.query("limit")) || 20, 100);
    return c.json({ examples: await listExamples(task, limit) }, 200);
  });

  return r;
}
