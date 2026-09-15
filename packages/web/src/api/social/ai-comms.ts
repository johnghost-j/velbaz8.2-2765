/**
 * AI COMMS — ce que l'IA a réellement envoyé, et ce que ça a fait.
 *
 * Alimente le bouton « Communications IA » du panneau réseaux : la liste des
 * posts publiés par l'IA (contenu, date, lien, vues, engagements, clics,
 * réponses) + les réponses que l'IA a envoyées aux interactions (mentions,
 * commentaires, DM), et les totaux.
 *
 * Purement additif : aucune route existante n'est touchée. Ce routeur est monté
 * sur l'app qui a déjà basePath('api') → les chemins sont déclarés SANS /api.
 */

import { Hono } from 'hono';
import { db } from '../database/index';
import { and, desc, eq } from 'drizzle-orm';
import * as schema from '../database/schema';

const comms = new Hono();

type Row = typeof schema.socialPosts.$inferSelect;

function num(v: unknown): number {
  const n = Number(v || 0);
  return Number.isFinite(n) ? n : 0;
}

/** Liste des communications envoyées par l'IA + totaux. */
comms.get('/ai-comms', async (c) => {
  const companyId = String(c.req.query('companyId') || '');
  const platform = String(c.req.query('platform') || '');
  const limit = Math.min(Number(c.req.query('limit') || 100) || 100, 300);

  if (!companyId) return c.json({ error: 'companyId requis' }, 400);

  let posts: Row[] = [];
  let interactions: (typeof schema.socialInteractions.$inferSelect)[] = [];

  try {
    const wherePosts = platform
      ? and(eq(schema.socialPosts.companyId, companyId), eq(schema.socialPosts.platform, platform))
      : eq(schema.socialPosts.companyId, companyId);

    posts = await db.select().from(schema.socialPosts)
      .where(wherePosts)
      .orderBy(desc(schema.socialPosts.createdAt))
      .limit(limit);

    // [2026-09-13] Les anciens runs « learn-style » avaient enregistré le guide
    // de communication interne comme un post (« 1/10 … ---TWEET--- … Lis le
    // guide »). Ce n'est pas un message à envoyer : on ne le sert plus au fil.
    // (Le pipeline ne les crée plus ; ce filtre couvre les lignes déjà en base.)
    posts = posts.filter(p => p.contentType !== 'communication_style');

    const whereInter = platform
      ? and(eq(schema.socialInteractions.companyId, companyId), eq(schema.socialInteractions.platform, platform))
      : eq(schema.socialInteractions.companyId, companyId);

    interactions = await db.select().from(schema.socialInteractions)
      .where(whereInter)
      .orderBy(desc(schema.socialInteractions.createdAt))
      .limit(limit);
  } catch (e: any) {
    return c.json({ error: e?.message || 'Lecture impossible' }, 500);
  }

  const sent = posts.filter(p => p.status === 'published');
  const replies = interactions.filter(i => i.aiResponse && i.aiResponseStatus === 'sent');

  const totals = {
    envoyes: sent.length,
    programmes: posts.filter(p => p.status === 'scheduled').length,
    enAttente: posts.filter(p => p.status === 'draft' || p.status === 'approved').length,
    echecs: posts.filter(p => p.status === 'failed').length,
    vues: sent.reduce((s, p) => s + num(p.impressions), 0),
    engagements: sent.reduce((s, p) => s + num(p.engagements), 0),
    clics: sent.reduce((s, p) => s + num(p.clicks), 0),
    reponsesIA: replies.length,
  };

  return c.json({
    totals,
    posts: posts.map(p => ({
      id: p.id,
      platform: p.platform,
      type: p.contentType,
      content: p.content,
      status: p.status,
      url: p.platformPostUrl,
      score: p.finalScore,
      vues: num(p.impressions),
      engagements: num(p.engagements),
      clics: num(p.clicks),
      reponses: num(p.replies),
      publishedAt: p.publishedAt,
      scheduledFor: p.scheduledFor,
      createdAt: p.createdAt,
    })),
    interactions: interactions.map(i => ({
      id: i.id,
      platform: i.platform,
      type: i.type,
      auteur: i.authorUsername,
      message: i.content,
      reponseIA: i.aiResponse,
      statut: i.aiResponseStatus,
      sentiment: i.sentiment,
      createdAt: i.createdAt,
    })),
  });
});

export default comms;
