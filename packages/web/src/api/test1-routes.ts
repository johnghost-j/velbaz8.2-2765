/**
 * Routes de la commande /test1
 * ----------------------------
 *   POST /test1/stream  → lance le run agentique, streamé en SSE
 *
 * Isolée : n'importe QUE test1-lab. Rien de /genesis, /vision ou /test.
 * Même forme de flux que les autres routes SSE du projet (battement de coeur
 * toutes les 15 s : l'agent passe plusieurs minutes sur une image sans émettre
 * un octet, et un flux muet aussi longtemps est coupé en 524 par le proxy).
 *
 * AUCUNE GATE : le skill l'interdit. Les prompts d'image sont publiés dans le
 * flux avant génération (événement « prompts »), mais le run ne rend pas la main.
 */

import { Hono } from "hono";
import { eq } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { db } from "./database/index";
import * as schema from "./database/schema";
import { runTest1, parseTest1Command, type Test1Event } from "./test1-lab";

const test1Routes = new Hono();

/** Même résolution de session que getUser() dans index.ts (non exporté là-bas). */
async function currentUser(c: any) {
  const token = c.req.header("Authorization")?.replace("Bearer ", "");
  if (!token) return null;
  const session = await db.select().from(schema.sessions).where(eq(schema.sessions.id, token)).get();
  if (!session || session.expiresAt < new Date()) return null;
  return (await db.select().from(schema.users).where(eq(schema.users.id, session.userId)).get()) || null;
}

test1Routes.post("/test1/stream", async (c) => {
  const body = await c.req.json().catch(() => ({}) as any);
  const raw = String(body?.message || "");
  const parsed = parseTest1Command(raw);
  const category = (parsed.active ? parsed.category : raw).trim();
  if (!category) return c.json({ error: "Catégorie requise, ex: /chimera vélos" }, 400);

  const user = await currentUser(c);
  if (!user) return c.json({ error: "Unauthorized" }, 401);

  // La company est créée AVANT le run : le runner écrit dedans et le proxy de
  // preview standard sait déjà la servir. Le nom définitif (la marque inventée
  // par l'agent) est réécrit à la fin.
  const companyId = randomUUID();
  await db.insert(schema.companies).values({
    id: companyId,
    userId: user.id,
    name: category,
    idea: `/test1 — ${category}`,
    industry: category,
    projectType: "web",
  });

  // [2026-09-09] Le run /test1 n'écrivait RIEN dans chat_messages : tout
  // l'historique vivait en state React côté front, donc quitter l'app et
  // revenir faisait tout disparaître. On persiste la commande tout de suite,
  // puis un résumé à la fin (succès ou échec) — rouvrir /chat/<companyId>
  // recharge l'historique via GET /chat/:sessionId.
  const saveMsg = (role: string, content: string) =>
    db
      .insert(schema.chatMessages)
      .values({ id: randomUUID(), sessionId: companyId, role, content })
      .catch((e: any) => console.warn("[test1] persistance message KO (non bloquant):", String(e?.message || e).slice(0, 160)));
  await saveMsg("user", raw);

  const encoder = new TextEncoder();
  const abort = new AbortController();
  const t0 = Date.now();

  const stream = new ReadableStream({
    async start(controller) {
      const send = (e: Test1Event) => {
        try {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(e)}\n\n`));
        } catch {
          /* client parti */
        }
      };
      const heartbeat = setInterval(() => {
        try {
          controller.enqueue(encoder.encode(`: ping ${Date.now()}\n\n`));
        } catch {
          /* client parti */
        }
      }, 15000);

      try {
        const result = await runTest1({
          category,
          userId: user.id,
          companyId,
          signal: abort.signal,
          emit: (e) => {
            if (e.type === "task_done") console.log(`[test1] ${e.title} ok en ${e.ms}ms`);
            if (e.type === "plan") console.log(`[test1] plan écrit par l'agent : ${e.tasks.length} tâches`);
            send(e);
          },
        });
        await db
          .update(schema.companies)
          .set({ name: result.brandName, website: `/api/companies/${companyId}/preview` })
          .where(eq(schema.companies.id, companyId))
          .catch(() => {});
        await saveMsg(
          "assistant",
          `✅ Site « ${result.brandName} » livré et vérifié au navigateur en ${Math.round((Date.now() - t0) / 1000)} s.\n\n[Ouvrir le projet →](/chat/${companyId})`,
        );
      } catch (err: any) {
        // La vraie cause remonte telle quelle : pas de message maison qui la masque.
        const message = err?.message || "run /test1 échoué";
        console.error("[test1] run failed:", message);
        send({ type: "error", message });
        await saveMsg("assistant", `❌ Run /test1 interrompu :\n${message}`);
      } finally {
        clearInterval(heartbeat);
        try {
          controller.close();
        } catch {
          /* déjà fermé */
        }
      }
    },
    cancel() {
      abort.abort();
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
      "Access-Control-Allow-Origin": "*",
      "X-Accel-Buffering": "no",
    },
  });
});

export default test1Routes;
