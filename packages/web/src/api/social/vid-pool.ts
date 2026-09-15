/**
 * VID POOL — extracteur automatique d'URLs de vidéos + vivier persistant.
 *
 * Pourquoi : la découverte via les timelines de syndication X répond 429 depuis
 * cette IP, et le noyau vérifié à la main (SEED de x-algo) ne fait que 17 posts
 * → le fil se tarissait. Ici on extrait des vidéos réelles depuis les timelines
 * publiques du fediverse (Mastodon & compatibles) : aucune auth, aucun token,
 * aucun quota, des centaines d'instances en rotation, et surtout des **mp4
 * directs** (pas de HLS) → lisibles tels quels par <video>.
 *
 * Source (mesurée) :
 *   GET https://<instance>/api/v1/timelines/public?limit=40&only_media=true
 *   → tableau de posts ; media_attachments[] avec type 'video'|'gifv',
 *     url (mp4 direct), preview_url (poster), meta.original.{width,height,duration}
 *
 * Les posts sont normalisés vers `AlgoPost` (le type déjà servi par x-algo) :
 * le client XCloneApp.tsx n'a donc rien à changer.
 *
 * Vivier : cache mémoire sur globalThis + persistance disque (/tmp), donc il
 * grossit d'un redémarrage à l'autre.
 *
 * Routes (app en basePath('api') → déclarées SANS /api) :
 *   GET /x-vids?n=6&seen=id,id
 *   GET /x-vids-stats?grow=1
 *
 * Purement additif : aucune route existante n'est touchée.
 */

import { Hono } from 'hono';
import { readFileSync, writeFileSync } from 'node:fs';
import type { AlgoPost } from './x-algo';

const vid = new Hono();

const UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';

/** Instances fediverse interrogées (rotation aléatoire, non-200 toléré). */
const INSTANCES: string[] = [
  'mstdn.social',
  'mas.to',
  'mastodon.world',
  'mastodon.online',
  'fosstodon.org',
  'techhub.social',
  'hachyderm.io',
  'infosec.exchange',
  'mstdn.jp',
  'pawoo.net',
  'social.vivaldi.net',
  'mastodonapp.uk',
  'mastodon.uno',
  'toot.community',
  'universeodon.com',
  'masto.ai',
  'mander.xyz',
  'mstdn.party',
  'ohai.social',
  'sfba.social',
];

const POOL_FILE = '/tmp/velbaz-vidpool.json';
const POOL_MAX = 600;

type G = {
  __vidPool?: Map<string, AlgoPost>;
  __vidHosts?: Set<string>;
  __vidLast?: Map<string, number>;
  __vidLoaded?: boolean;
};
const g = globalThis as unknown as G;
if (!g.__vidPool) g.__vidPool = new Map();
if (!g.__vidHosts) g.__vidHosts = new Set();
if (!g.__vidLast) g.__vidLast = new Map();
const pool = g.__vidPool;
const hosts = g.__vidHosts;
const lastSeen = g.__vidLast;

/* ═════════════════════ Persistance disque ═════════════════════ */

function loadDisk(): void {
  if (g.__vidLoaded) return;
  g.__vidLoaded = true;
  try {
    const raw = readFileSync(POOL_FILE, 'utf8');
    const arr = JSON.parse(raw) as AlgoPost[];
    for (const p of Array.isArray(arr) ? arr : []) {
      if (p && p.id && !pool.has(p.id)) {
        pool.set(p.id, p);
        for (const m of p.media || []) {
          for (const u of [m.mp4, m.poster]) {
            if (!u) continue;
            try {
              hosts.add(new URL(u).hostname);
            } catch {
              /* url douteuse : ignorée */
            }
          }
        }
      }
    }
  } catch {
    /* premier démarrage : pas de fichier, c'est normal */
  }
}

function saveDisk(): void {
  try {
    const arr = [...pool.values()].slice(-POOL_MAX);
    writeFileSync(POOL_FILE, JSON.stringify(arr), 'utf8');
  } catch {
    /* disque en lecture seule : le vivier reste en mémoire */
  }
}

/* ═════════════════════ Normalisation ═════════════════════ */

const ENT: Record<string, string> = {
  '&amp;': '&',
  '&lt;': '<',
  '&gt;': '>',
  '&quot;': '"',
  '&#39;': "'",
  '&apos;': "'",
  '&nbsp;': ' ',
};

/** HTML Mastodon → texte brut (le client affiche du texte, pas du HTML). */
function plain(html: string): string {
  return String(html || '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n\n')
    .replace(/<[^>]*>/g, '')
    .replace(/&#(\d+);/g, (_, d) => String.fromCharCode(Number(d)))
    .replace(/&[a-z#0-9]+;/gi, (e) => ENT[e.toLowerCase()] ?? ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
    .slice(0, 400);
}

const TOPICS: { topic: string; re: RegExp }[] = [
  { topic: 'sport', re: /\b(football|soccer|nba|nfl|goal|match|player|boxing|ufc|f1|racing|basket|tennis|hockey)\b/i },
  { topic: 'tech', re: /\b(ai|robot|gpu|linux|code|software|dev|opensource|iphone|android|chip|model|llm|python)\b/i },
  { topic: 'espace', re: /\b(space|rocket|nasa|spacex|launch|orbit|moon|mars|satellite|astronom)/i },
  { topic: 'animaux', re: /\b(cat|dog|bird|animal|puppy|kitten|wildlife|fox|horse|whale|shark)\b/i },
  { topic: 'humour', re: /\b(lol|funny|meme|haha|joke|comedy)\b/i },
  { topic: 'musique', re: /\b(music|song|guitar|band|album|concert|dj|piano)\b/i },
  { topic: 'news', re: /\b(news|police|government|election|protest|war|breaking|court|minister)\b/i },
  { topic: 'nature', re: /\b(nature|forest|ocean|mountain|sunset|storm|river|volcano|weather)\b/i },
];

/**
 * Filtre de contenu sensible (nudité, sexe, seins…). Sert à FLOUTER, pas à
 * supprimer : le post reste dans le fil, son média est masqué jusqu'au clic.
 */
const NSFW_RE =
  /\b(nsfw|porn|porno|pornhub|xxx|nude|nudes|nudity|naked|nu|nue|boobs|tits|titties|seins|nipple|nipples|teton|tetons|areola|dick|cock|penis|pussy|vagina|anal|blowjob|handjob|cumshot|masturb|bdsm|bondage|hentai|rule34|r34|onlyfans|camgirl|erotic|erotique|lewd|creampie|deepthroat|stripper|topless|gangbang|hardcore|smut|futa|18\+|adultcontent|adultonly)\b/i;

/**
 * Instances entièrement dédiées au contenu adulte / artistique nu : tout média
 * qui en vient est flouté par défaut, même sans drapeau ni mot-clé.
 */
const NSFW_INSTANCES = new Set([
  'pawoo.net',
  'baraag.net',
  'mastodon.art',
  'sinblr.com',
  'switter.at',
  'humblr.social',
  'kinkyelephant.com',
  'kinky.business',
  'bear.community',
  'rrr.tokyo',
  'best-mastodon.com',
]);

function topicOf(text: string): string {
  for (const t of TOPICS) if (t.re.test(text)) return t.topic;
  return 'divers';
}

function num(v: unknown): number {
  const n = Number(v || 0);
  return Number.isFinite(n) ? n : 0;
}

function noteHost(u: string): void {
  try {
    hosts.add(new URL(u).hostname);
  } catch {
    /* ignoré */
  }
}

/** Post Mastodon → AlgoPost, ou null si pas de vidéo mp4 exploitable. */
function toAlgoPost(raw: any, instance: string): AlgoPost | null {
  const src = raw?.reblog && raw.reblog.media_attachments?.length ? raw.reblog : raw;
  const atts: any[] = Array.isArray(src?.media_attachments) ? src.media_attachments : [];
  const vids = atts.filter(
    (m) => (m?.type === 'video' || m?.type === 'gifv') && typeof m?.url === 'string' && /^https:\/\//.test(m.url),
  );
  if (!vids.length) return null;
  const acct = src?.account || {};
  if (acct?.bot === true && !/twitter|sportsbots|mirror/i.test(String(acct?.acct || ''))) {
    // les bots purement automatiques sont sans intérêt, sauf les miroirs de médias
    return null;
  }
  const text = plain(src?.content || '');
  // Détection du contenu sensible (nudité / sexe) : trois signaux cumulés.
  //  1. le drapeau `sensitive` de l'auteur ou de l'instance (Mastodon l'impose aux comptes NSFW)
  //  2. l'avertissement de contenu `spoiler_text`
  //  3. les mots-clés et hashtags explicites du post, du profil et des tags
  const tags = (Array.isArray(src?.tags) ? src.tags : []).map((t: any) => String(t?.name || '')).join(' ');
  const spoiler = String(src?.spoiler_text || '').trim();
  const words = `${text} ${tags} ${spoiler} ${acct?.note || ''} ${acct?.display_name || ''} ${acct?.acct || ''}`;
  const nsfwHost =
    NSFW_INSTANCES.has(instance) || NSFW_INSTANCES.has(String(acct?.acct || '').split('@')[1] || '');
  // Un avertissement de contenu Mastodon seul ne veut RIEN dire (spoilers de
  // série, politique, photo d'araignée…). On exige un mot explicite, ou un
  // avertissement DOUBLÉ du drapeau `sensitive`, ou une instance adulte.
  const sensitive = NSFW_RE.test(words) || nsfwHost || (src?.sensitive === true && Boolean(spoiler));
  const media = vids.slice(0, 4).map((m) => {
    const o = m?.meta?.original || {};
    noteHost(m.url);
    if (m.preview_url) noteHost(m.preview_url);
    return {
      type: (m.type === 'gifv' ? 'animated_gif' : 'video') as AlgoPost['media'][number]['type'],
      poster: String(m.preview_url || ''),
      width: num(o.width),
      height: num(o.height),
      durationMs: Math.round(num(o.duration) * 1000),
      mp4: String(m.url),
    };
  });
  const screen = String(acct?.acct || 'fediverse').split('@')[0] || 'fediverse';
  const likes = num(src?.favourites_count);
  const reposts = num(src?.reblogs_count);
  if (acct?.avatar) noteHost(String(acct.avatar));
  return {
    id: 'v' + instance.replace(/\W/g, '') + String(src?.id || Math.random().toString(36).slice(2)),
    url: String(src?.url || `https://${instance}`),
    text,
    createdAt: String(src?.created_at || new Date().toISOString()),
    topic: topicOf(text),
    score: 0,
    sensitive,
    author: {
      name: String(acct?.display_name || screen).slice(0, 60) || screen,
      screenName: screen,
      avatar: String(acct?.avatar || ''),
      verified: Boolean(acct?.fields?.some?.((f: any) => f?.verified_at)),
    },
    stats: {
      likes,
      replies: num(src?.replies_count),
      reposts,
      quotes: 0,
      bookmarks: 0,
      views: likes * 40 + reposts * 120,
    },
    media,
  };
}

/* ═════════════════════ Extraction ═════════════════════ */

const INST_TTL = 5 * 60 * 1000;

/** Interroge une instance. Retourne les posts vidéo (jamais d'exception). */
async function fetchInstance(instance: string): Promise<AlgoPost[]> {
  const urls = [
    `https://${instance}/api/v1/timelines/public?limit=40&only_media=true`,
    `https://${instance}/api/v1/timelines/public?limit=40&only_media=true&local=true`,
  ];
  for (const url of urls) {
    try {
      const res = await fetch(url, {
        headers: { 'User-Agent': UA, Accept: 'application/json' },
        signal: AbortSignal.timeout(12_000),
      });
      if (!res.ok) continue;
      const body = (await res.json()) as any;
      if (!Array.isArray(body)) continue;
      const out: AlgoPost[] = [];
      for (const raw of body) {
        const p = toAlgoPost(raw, instance);
        if (p) out.push(p);
      }
      if (out.length) return out;
    } catch {
      /* instance injoignable : on passe à la suivante */
    }
  }
  return [];
}

/** Complète le vivier depuis quelques instances tirées au hasard. */
export async function growPool(rounds = 4): Promise<number> {
  loadDisk();
  const picks: string[] = [];
  const shuffled = [...INSTANCES].sort(() => Math.random() - 0.5);
  for (const i of shuffled) {
    if (picks.length >= rounds) break;
    if (Date.now() - (lastSeen.get(i) || 0) < INST_TTL) continue;
    picks.push(i);
  }
  if (!picks.length) picks.push(shuffled[0]);
  for (const i of picks) lastSeen.set(i, Date.now());
  const lists = await Promise.all(picks.map((i) => fetchInstance(i)));
  let added = 0;
  for (const list of lists) {
    for (const p of list) {
      if (pool.has(p.id)) continue;
      pool.set(p.id, p);
      added++;
    }
  }
  // borne haute : on garde les plus récents entrés
  while (pool.size > POOL_MAX) {
    const first = pool.keys().next().value as string | undefined;
    if (!first) break;
    pool.delete(first);
  }
  if (added) saveDisk();
  return added;
}

/** Vivier courant (posts déjà normalisés, prêts à servir). */
export function poolPosts(): AlgoPost[] {
  loadDisk();
  return [...pool.values()];
}

/** Hôtes média rencontrés → allowlist du proxy /x-media. */
export function mediaHosts(): Set<string> {
  loadDisk();
  return hosts;
}

/* ═════════════════════ Routes ═════════════════════ */

/** Lot de vidéos extraites (diagnostic + secours direct pour le client). */
vid.get('/x-vids', async (c) => {
  const n = Math.max(1, Math.min(20, Number(c.req.query('n')) || 6));
  const seen = new Set(
    String(c.req.query('seen') || '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean),
  );
  if (poolPosts().length < n * 3) await growPool(4);
  const posts = poolPosts()
    .filter((p) => !seen.has(p.id) && p.media.some((m) => m.mp4))
    .sort(() => Math.random() - 0.5)
    .slice(0, n);
  return c.json({ posts, count: posts.length, pool: pool.size, hosts: [...hosts] }, 200);
});

/** État de l'extracteur. */
vid.get('/x-vids-stats', async (c) => {
  const grew = String(c.req.query('grow') || '') === '1' ? await growPool(6) : 0;
  return c.json(
    {
      pool: pool.size,
      instances: INSTANCES.length,
      polled: lastSeen.size,
      hosts: [...hosts],
      grew,
      file: POOL_FILE,
    },
    200,
  );
});

export default vid;
