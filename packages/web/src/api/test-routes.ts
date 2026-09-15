/**
 * Routes du banc d'essai /test
 * ----------------------------
 *   POST /test/stream  → lance le protocole en 5 phases, streamé en SSE
 *
 * Calquées sur POST /genesis/stream (index.ts) : même forme d'événements, même
 * battement de coeur toutes les 15 s (une phase d'images passe plusieurs minutes
 * sans émettre un octet, et un flux SSE muet aussi longtemps est coupé par le
 * proxy en 524), même annulation propre quand le client s'en va.
 *
 * Le run produit un PROJET MIBON STANDARD : company réelle en base, fichiers
 * écrits par le runner standard, port standard, et donc prévisualisable par le
 * proxy habituel GET /companies/:id/preview/* (builder/routes.ts).
 *
 * AUCUNE GATE : /test <catégorie> va jusqu'au site livré sans jamais rendre la main.
 */

import { Hono } from "hono";
import { eq } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { db } from "./database/index";
import * as schema from "./database/schema";
import { runTest, parseTestCommand, type TestEvent } from "./test-lab";

const testRoutes = new Hono();

/** Même résolution de session que getUser() dans index.ts (non exporté là-bas). */
async function currentUser(c: any) {
  const token = c.req.header("Authorization")?.replace("Bearer ", "");
  if (!token) return null;
  const session = await db.select().from(schema.sessions).where(eq(schema.sessions.id, token)).get();
  if (!session || session.expiresAt < new Date()) return null;
  return (await db.select().from(schema.users).where(eq(schema.users.id, session.userId)).get()) || null;
}

testRoutes.post("/test/stream", async (c) => {
  const body = await c.req.json().catch(() => ({}) as any);
  const raw = String(body?.message || "");
  const parsed = parseTestCommand(raw);
  const category = (parsed.active ? parsed.category : raw).trim();
  if (!category) return c.json({ error: "Catégorie requise, ex: /test vélos" }, 400);

  const user = await currentUser(c);
  if (!user) return c.json({ error: "Unauthorized" }, 401);

  // La company est créée AVANT le run : le runner écrit dedans et le proxy de
  // preview standard sait déjà la servir. Le nom définitif (marque inventée en
  // phase 1) est réécrit à la fin.
  const companyId = randomUUID();
  await db.insert(schema.companies).values({
    id: companyId,
    userId: user.id,
    name: category,
    idea: `Banc d'essai /test — ${category}`,
    industry: category,
    projectType: "web",
  });

  const encoder = new TextEncoder();
  const abort = new AbortController();

  const stream = new ReadableStream({
    async start(controller) {
      const send = (e: TestEvent) => {
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
        const result = await runTest({
          category,
          userId: user.id,
          companyId,
          signal: abort.signal,
          emit: (e) => {
            if (e.type === "phase_done") console.log(`[test] ${e.title} ok en ${e.ms}ms`);
            send(e);
          },
        });
        await db
          .update(schema.companies)
          .set({ name: result.brandName, website: `/api/companies/${companyId}/preview` })
          .where(eq(schema.companies.id, companyId))
          .catch(() => {});
      } catch (err: any) {
        // La vraie cause remonte telle quelle : pas de message maison qui la masque.
        const message = err?.message || "run /test échoué";
        console.error("[test] run failed:", message);
        send({ type: "error", message });
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

export default testRoutes;
