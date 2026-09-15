/**
 * X EMBED — vrais posts X (texte, photos, VIDÉOS mp4) sans clé API.
 *
 * Utilise l'endpoint public de syndication de X :
 *   GET https://cdn.syndication.twimg.com/tweet-result?id=<id>&lang=en&token=<token>
 * Le token est dérivé de l'id (sinon X renvoie une page HTML d'erreur).
 *
 * Routes (montées sur l'app qui a déjà basePath('api') → déclarées SANS /api) :
 *   GET /x-embed?id=<id>            → 1 post normalisé
 *   GET /x-feed?ids=a,b,c           → plusieurs posts (parallèle, cache mémoire 5 min)
 *   GET /x-media?u=<url>            → proxy des médias pbs.twimg.com / video.twimg.com
 *
 * Purement additif : aucune route existante n'est touchée.
 */

import { Hono } from 'hono';
import { mediaHosts } from './vid-pool';

const x = new Hono();

const UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';

/** IDs de posts vidéo vérifiés (repli / fil par défaut). */
export const X_DEFAULT_IDS = [
  '2093372827399311515', // YourAlphaMom — vidéo 15s
  '2087607645540585686', // russwest44 — vidéo 3:29
  '1925976536533852363', // Eagles — vidéo 13s
  '2084892304582885414', // umesh_ai — vidéo 15s
  '2039824473822548033', // Ballislife — vidéo 1:23
  '1349129669258448897', // elonmusk — photo
  '20', // jack — premier tweet
];

/** Token attendu par la syndication : ((id / 1e15) * PI).toString(36) sans 0 ni point. */
function syndToken(id: string): string {
  return ((Number(id) / 1e15) * Math.PI).toString(36).replace(/(0+|\.)/g, '');
}

type Variant = { url: string; bitrate: number; width: number; height: number };
type XMedia = {
  type: 'photo' | 'video' | 'animated_gif';
  poster: string;
  width: number;
  height: number;
  durationMs: number;
  mp4: string | null;
  variants: Variant[];
};
export type XPost = {
  id: string;
  url: string;
  text: string;
  createdAt: string;
  lang: string;
  author: {
    name: string;
    screenName: string;
    avatar: string;
    verified: boolean;
    verifiedType: string | null;
  };
  stats: { likes: number; replies: number; reposts: number; quotes: number; bookmarks: number; views: number };
  media: XMedia[];
};

function num(v: unknown): number {
  const n = Number(v || 0);
  return Number.isFinite(n) ? n : 0;
}

function normalizeMedia(m: any): XMedia {
  const variants: Variant[] = ((m?.video_info?.variants || []) as any[])
    .filter((v) => v?.content_type === 'video/mp4' && v?.url)
    .map((v) => {
      const dim = String(v.url).match(/\/(\d+)x(\d+)\//);
      return {
        url: String(v.url),
        bitrate: num(v.bitrate),
        width: dim ? num(dim[1]) : 0,
        height: dim ? num(dim[2]) : 0,
      };
    })
    .sort((a, b) => b.bitrate - a.bitrate);

  // On privilégie une variante raisonnable (<= 1280 de large) pour un chargement rapide.
  const playable =
    variants.find((v) => v.width > 0 && v.width <= 1280) || variants[0] || null;

  return {
    type: (m?.type === 'video' || m?.type === 'animated_gif' ? m.type : 'photo') as XMedia['type'],
    poster: String(m?.media_url_https || ''),
    width: num(m?.original_info?.width) || num(m?.sizes?.large?.w),
    height: num(m?.original_info?.height) || num(m?.sizes?.large?.h),
    durationMs: num(m?.video_info?.duration_millis),
    mp4: playable ? playable.url : null,
    variants,
  };
}

function normalize(id: string, d: any): XPost {
  const u = d?.user || {};
  const screen = String(u.screen_name || '');
  return {
    id: String(d?.id_str || id),
    url: `https://x.com/${screen}/status/${d?.id_str || id}`,
    text: String(d?.text || ''),
    createdAt: String(d?.created_at || ''),
    lang: String(d?.lang || 'en'),
    author: {
      name: String(u.name || screen),
      screenName: screen,
      avatar: String(u.profile_image_url_https || '').replace('_normal.', '_x96.'),
      verified: Boolean(u.is_blue_verified || u.verified),
      verifiedType: u.verified_type ? String(u.verified_type) : null,
    },
    stats: {
      likes: num(d?.favorite_count),
      replies: num(d?.conversation_count) || num(d?.reply_count),
      reposts: num(d?.retweet_count),
      quotes: num(d?.quote_count),
      bookmarks: num(d?.bookmark_count),
      views: num(d?.view_count_info?.count) || num(d?.views?.count),
    },
    media: ((d?.mediaDetails || []) as any[]).map(normalizeMedia),
  };
}

/** Cache mémoire (5 min) partagé entre requêtes. */
type CacheEntry = { at: number; post: XPost };
const CACHE_TTL = 5 * 60 * 1000;
const g = globalThis as unknown as { __xEmbedCache?: Map<string, CacheEntry> };
if (!g.__xEmbedCache) g.__xEmbedCache = new Map();
const cache = g.__xEmbedCache;

async function fetchPost(id: string): Promise<XPost | null> {
  const hit = cache.get(id);
  if (hit && Date.now() - hit.at < CACHE_TTL) return hit.post;

  const url = `https://cdn.syndication.twimg.com/tweet-result?id=${encodeURIComponent(
    id,
  )}&lang=en&token=${syndToken(id)}`;

  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': UA, Accept: 'application/json' },
      signal: AbortSignal.timeout(12_000),
    });
    if (!res.ok) return null;
    const body = await res.text();
    if (body.trimStart().startsWith('<')) return null; // page d'erreur X
    const post = normalize(id, JSON.parse(body));
    cache.set(id, { at: Date.now(), post });
    return post;
  } catch {
    return null;
  }
}

/** Un post. */
x.get('/x-embed', async (c) => {
  const id = String(c.req.query('id') || '').replace(/\D/g, '');
  if (!id) return c.json({ error: 'id requis' }, 400);
  const post = await fetchPost(id);
  if (!post) return c.json({ error: 'post indisponible', id }, 404);
  return c.json({ post }, 200);
});

/** Plusieurs posts. */
x.get('/x-feed', async (c) => {
  const raw = String(c.req.query('ids') || '');
  const ids = (raw ? raw.split(',') : X_DEFAULT_IDS)
    .map((s) => s.trim().replace(/\D/g, ''))
    .filter(Boolean)
    .slice(0, 25);

  const settled = await Promise.all(ids.map((id) => fetchPost(id)));
  const posts = settled.filter((p): p is XPost => Boolean(p));
  return c.json({ posts, count: posts.length, requested: ids.length }, 200);
});

/** Proxy média (même origine → <video> et <img> jouent sans blocage referrer). */
x.get('/x-media', async (c) => {
  const u = String(c.req.query('u') || '');
  let target: URL;
  try {
    target = new URL(u);
  } catch {
    return c.json({ error: 'url invalide' }, 400);
  }
  const okHost =
    /(^|\.)twimg\.com$/.test(target.hostname) ||
    /(^|\.)twitter\.com$/.test(target.hostname) ||
    // hôtes média du vivier fediverse (extracteur vid-pool) : allowlist dynamique
    mediaHosts().has(target.hostname) ||
    /^(media|cdn|files|assets)\./.test(target.hostname);
  if (target.protocol !== 'https:' || !okHost) return c.json({ error: 'hôte non autorisé' }, 403);

  const range = c.req.header('range');
  try {
    const res = await fetch(target.toString(), {
      headers: {
        'User-Agent': UA,
        Referer: 'https://x.com/',
        ...(range ? { Range: range } : {}),
      },
      signal: AbortSignal.timeout(30_000),
    });
    // Réponse complète en mémoire : le plugin Hono de dev tamponne les flux,
    // un ReadableStream ressortirait vide côté navigateur.
    const buf = await res.arrayBuffer();
    const headers = new Headers();
    headers.set('Content-Type', res.headers.get('content-type') || 'application/octet-stream');
    headers.set('Cache-Control', 'public, max-age=86400');
    headers.set('Accept-Ranges', 'bytes');
    const cr = res.headers.get('content-range');
    if (cr) headers.set('Content-Range', cr);
    headers.set('Content-Length', String(buf.byteLength));
    return new Response(buf, { status: res.status === 206 ? 206 : res.ok ? 200 : res.status, headers });
  } catch {
    return c.json({ error: 'média indisponible' }, 502);
  }
});

export default x;
