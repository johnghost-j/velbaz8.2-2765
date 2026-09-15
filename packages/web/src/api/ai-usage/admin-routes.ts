/**
 * Routes admin du suivi des crédits IA — LECTURE SEULE
 * ----------------------------------------------------
 *   GET /admin/ai-usage/summary     → totaux (USD + crédits + tokens + appels)
 *   GET /admin/ai-usage/timeline    → série temporelle (« quand l'IA a bossé »)
 *   GET /admin/ai-usage/by-feature  → répartition par fonctionnalité
 *   GET /admin/ai-usage/by-model    → répartition par modèle
 *   GET /admin/ai-usage/by-user     → top consommateurs (utilisateurs)
 *   GET /admin/ai-usage/by-company  → top consommateurs (sociétés)
 *   GET /admin/ai-usage/by-project  → répartition par projet builder
 *   GET /admin/ai-usage/failures    → taux d'échec + coût gaspillé
 *   GET /admin/ai-usage/events      → détail brut paginé (filtrable)
 *   GET /admin/ai-usage/events/:id  → un appel précis
 *   GET /admin/ai-usage/runs        → runs agrégés (durées, concurrence)
 *   GET /admin/ai-usage/overview    → tout d'un coup (1 requête pour l'UI)
 *
 * Aucune écriture, aucun blocage : ce module mesure et affiche, rien d'autre.
 * Toutes les routes sont derrière requireAdmin (403 sinon) + rate-limit.
 */

import { Hono } from "hono";
import { rateLimit } from "../security";
import { flushAiUsage } from "./recorder";
import {
  getByCompany,
  getByFeature,
  getByModel,
  getByProject,
  getByUser,
  getEvent,
  getEvents,
  getFailures,
  getRuns,
  getSummary,
  getTimeline,
  type UsageFilters,
} from "./queries";

/** Auth injectée par index.ts (requireAdmin y est défini). */
export interface AiUsageRouteDeps {
  requireAdmin: (c: any) => Promise<unknown>;
}

const DAY_MS = 86_400_000;

/** Lit la période et les filtres depuis la query string. Défaut : 30 jours. */
function parseFilters(c: any): UsageFilters {
  const q = c.req.query();
  const days = Number(q.days);
  const now = Date.now();
  const since = q.since ? Number(q.since) : Number.isFinite(days) && days > 0 ? now - days * DAY_MS : now - 30 * DAY_MS;
  return {
    since: Number.isFinite(since) ? since : now - 30 * DAY_MS,
    until: q.until ? Number(q.until) : undefined,
    feature: q.feature || undefined,
    model: q.model || undefined,
    userId: q.userId || undefined,
    companyId: q.companyId || undefined,
    projectId: q.projectId || undefined,
    status: q.status === "ok" || q.status === "error" ? q.status : undefined,
    runId: q.runId || undefined,
  };
}

export function createAiUsageRoutes(deps: AiUsageRouteDeps) {
  const r = new Hono();

  // Les agrégats tapent la DB : on plafonne pour éviter qu'un rafraîchissement
  // en boucle du dashboard ne pèse sur la prod.
  r.use("/admin/ai-usage/*", rateLimit({ windowMs: 60_000, max: 120 }));

  // Garde admin sur tout le préfixe — un seul point de contrôle.
  r.use("/admin/ai-usage/*", async (c, next) => {
    const admin = await deps.requireAdmin(c);
    if (!admin) return c.json({ error: "Forbidden" }, 403);
    await next();
  });

  r.get("/admin/ai-usage/summary", async (c) => {
    // Vide la file d'écriture pour que les chiffres incluent les appels qui
    // viennent de finir (sinon jusqu'à 1,5 s de retard).
    await flushAiUsage();
    return c.json(await getSummary(parseFilters(c)), 200);
  });

  r.get("/admin/ai-usage/timeline", async (c) => {
    const bucket = c.req.query("bucket") === "hour" ? "hour" : "day";
    return c.json(await getTimeline(parseFilters(c), bucket), 200);
  });

  r.get("/admin/ai-usage/by-feature", async (c) => c.json(await getByFeature(parseFilters(c)), 200));
  r.get("/admin/ai-usage/by-model", async (c) => c.json(await getByModel(parseFilters(c)), 200));

  r.get("/admin/ai-usage/by-user", async (c) => {
    const limit = Number(c.req.query("limit")) || 50;
    return c.json(await getByUser(parseFilters(c), Math.min(limit, 200)), 200);
  });

  r.get("/admin/ai-usage/by-company", async (c) => {
    const limit = Number(c.req.query("limit")) || 50;
    return c.json(await getByCompany(parseFilters(c), Math.min(limit, 200)), 200);
  });

  r.get("/admin/ai-usage/by-project", async (c) => {
    const limit = Number(c.req.query("limit")) || 50;
    return c.json(await getByProject(parseFilters(c), Math.min(limit, 200)), 200);
  });

  r.get("/admin/ai-usage/failures", async (c) => c.json(await getFailures(parseFilters(c)), 200));

  r.get("/admin/ai-usage/events", async (c) => {
    await flushAiUsage();
    const limit = Number(c.req.query("limit")) || 100;
    const offset = Number(c.req.query("offset")) || 0;
    return c.json(await getEvents(parseFilters(c), Math.min(limit, 500), Math.max(offset, 0)), 200);
  });

  r.get("/admin/ai-usage/events/:id", async (c) => {
    const row = await getEvent(c.req.param("id"));
    if (!row) return c.json({ error: "Not found" }, 404);
    return c.json(row, 200);
  });

  r.get("/admin/ai-usage/runs", async (c) => {
    const limit = Number(c.req.query("limit")) || 60;
    return c.json(await getRuns(parseFilters(c), Math.min(limit, 200)), 200);
  });

  // Vue d'ensemble : tout ce que le dashboard affiche au premier rendu, en une
  // seule requête (évite 8 allers-retours au chargement de l'onglet).
  r.get("/admin/ai-usage/overview", async (c) => {
    await flushAiUsage();
    const f = parseFilters(c);
    const bucket = c.req.query("bucket") === "hour" ? "hour" : "day";
    const [summary, timeline, byFeature, byModel, byUser, byCompany, failures, runs] = await Promise.all([
      getSummary(f),
      getTimeline(f, bucket),
      getByFeature(f),
      getByModel(f),
      getByUser(f, 20),
      getByCompany(f, 20),
      getFailures(f, 15),
      getRuns(f, 30),
    ]);
    return c.json({ summary, timeline, byFeature, byModel, byUser, byCompany, failures, runs }, 200);
  });

  return r;
}
