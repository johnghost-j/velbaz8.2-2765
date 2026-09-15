/**
 * Route de l'étape de visualisation /test2
 * ----------------------------------------
 *   POST /test2/visualize  → une image par page validée, relevé de chaque
 *                            image, spec de reconstruction, streamé en SSE.
 *
 * Isolée : n'importe que `test2-visual`. Aucune route, aucun moteur ni aucun
 * état de /genesis, /chimera ou /test1 n'est touché. La compagnie, elle, a déjà
 * été créée par le flux NORMAL — cette route ne crée rien et ne lance aucun
 * build : le chat enchaîne sur le build habituel quand le flux se termine.
 *
 * Battement de coeur toutes les 15 s comme les autres flux SSE du projet : la
 * génération d'images passe plusieurs minutes sans émettre un octet et un flux
 * muet aussi longtemps est coupé en 524 par le proxy.
 */

import { Hono } from "hono";
import { eq } from "drizzle-orm";
import { db } from "./database/index";
import * as schema from "./database/schema";
import { runTest2Visual, type Test2Event } from "./test2-visual";

const test2Routes = new Hono();

/** Même résolution de session que getUser() dans index.ts (non exporté là-bas). */
async function currentUser(c: any) {
  const token = c.req.header("Authorization")?.replace("Bearer ", "");
  if (!token) return null;
  const session = await db.select().from(schema.sessions).where(eq(schema.sessions.id, token)).get();
  if (!session || session.expiresAt < new Date()) return null;
  return (await db.select().from(schema.users).where(eq(schema.users.id, session.userId)).get()) || null;
}

test2Routes.post("/test2/visualize", async (c) => {
  const body = await c.req.json().catch(() => ({}) as any);
  const companyId = String(body?.companyId || "").trim();
  const pages = Array.isArray(body?.pages) ? body.pages : [];
  if (!companyId) return c.json({ error: "companyId requis" }, 400);
  if (!pages.length) return c.json({ error: "pages requises" }, 400);

  const user = await currentUser(c);
  if (!user) return c.json({ error: "Unauthorized" }, 401);

  const company = await db.select().from(schema.companies)
    .where(eq(schema.companies.id, companyId)).get();
  if (!company) return c.json({ error: "Compagnie introuvable" }, 404);
  if (company.userId !== user.id) return c.json({ error: "Forbidden" }, 403);

  const brief = String(body?.brief || company.idea || company.name || "").trim();
  const encoder = new TextEncoder();
  const abort = new AbortController();

  const stream = new ReadableStream({
    async start(controller) {
      let closed = false;
      const send = (e: Test2Event) => {
        if (closed) return;
        try { controller.enqueue(encoder.encode(`data: ${JSON.stringify(e)}\n\n`)); } catch { /* client parti */ }
      };
      const heartbeat = setInterval(() => {
        if (closed) return;
        try { controller.enqueue(encoder.encode(`: ping ${Date.now()}\n\n`)); } catch { /* client parti */ }
      }, 15000);

      try {
        await runTest2Visual({
          companyId,
          userId: user.id,
          brandName: String(company.name || "").trim() || "Marque",
          brief,
          industry: company.industry || undefined,
          pages: pages.map((p: any) => ({ name: String(p?.name || ""), purpose: p?.purpose ? String(p.purpose) : "" })),
          signal: abort.signal,
          emit: (e) => {
            if (e.type === "frame") console.log(`[test2] page ${e.n} « ${e.name} » visualisée`);
            if (e.type === "error") console.error(`[test2] ${e.message}`);
            send(e);
          },
        });
      } catch (err: any) {
        // La vraie cause remonte telle quelle : pas de message maison qui la masque.
        const message = err?.message || "visualisation /test2 échouée";
        console.error("[test2] visualisation KO:", message);
        send({ type: "error", message });
        await db.update(schema.genesisRuns)
          .set({ status: "error", error: String(message).slice(0, 500) } as any)
          .where(eq(schema.genesisRuns.sessionId, companyId))
          .catch(() => {});
      } finally {
        clearInterval(heartbeat);
        closed = true;
        try { controller.close(); } catch { /* déjà fermé */ }
      }
    },
    // [2026-09-10] Le départ du client N'ANNULE PLUS le run. Constaté en test
    // réel : un onglet fermé / un flux coupé pendant la génération des images
    // déclenchait `abort` → la ligne genesis_runs restait en « error: run
    // annulé » AVEC UNE SPEC VIDE, et le site se construisait sans les images.
    // Le pipeline continue donc jusqu'à écrire sa spec ; seuls les envois SSE
    // s'arrêtent (le contrôleur est fermé, `send` est déjà protégé).
    cancel() { /* client parti : le run finit et persiste sa spec */ },
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

export default test2Routes;
