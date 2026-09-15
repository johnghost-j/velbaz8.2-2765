/**
 * X ALGO — moteur de recommandation « pour toi » avec vraies vidéos X.
 *
 * Deux sources de candidats :
 *   1. DÉCOUVERTE : les timelines publiques de syndication de X
 *      GET https://syndication.twitter.com/srv/timeline-profile/screen-name/<compte>
 *      → on en extrait tous les id_str, on les hydrate par /x-embed (tweet-result)
 *      et on garde ceux qui portent une vidéo. Rotation sur ~60 comptes vidéo.
 *      (X répond 429 quand l'IP est limitée : on tombe alors sur la source 2.)
 *   2. NOYAU VÉRIFIÉ : posts vidéo réels validés à la main (SEED), taggés par sujet.
 *
 * Classement (score décroissant) :
 *   affinité(auteur) * 3 + affinité(sujet) * 2 + fraîcheur + engagement + exploration
 * L'affinité vient du client (likes, reposts, ouvertures, follows, temps de visionnage).
 * `seen` garantit qu'un post déjà servi ne revient jamais → pas de boucle.
 *
 * Routes (app en basePath('api') → déclarées SANS /api) :
 *   GET /x-algo?n=8&seen=id,id&aff=cle:score,cle:score
 *   GET /x-algo-stats
 *
 * Purement additif : aucune route existante n'est touchée.
 */

import { Hono } from 'hono';
import { growPool, poolPosts } from './vid-pool';

const algo = new Hono();

const UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';

/* ═════════════════════ Noyau vérifié (vidéos réelles) ═════════════════════ */

type Seed = { id: string; topic: string };

/** Posts vidéo X validés un par un (mediaDetails contient bien une vidéo). */
export const SEED: Seed[] = [
  { id: '2093372827399311515', topic: 'humour' },
  { id: '2087607645540585686', topic: 'sport' },
  { id: '1925976536533852363', topic: 'sport' },
  { id: '2084892304582885414', topic: 'tech' },
  { id: '2039824473822548033', topic: 'sport' },
  { id: '2061447936563638388', topic: 'sport' },
  { id: '2088913666351525936', topic: 'animaux' },
  { id: '2092284173730144732', topic: 'espace' },
  { id: '2049492378499633469', topic: 'espace' },
  { id: '2057962516282577014', topic: 'espace' },
  { id: '2075621981488033835', topic: 'espace' },
  { id: '1743985067989352827', topic: 'tech' },
  { id: '2091934123019637157', topic: 'tech' },
  { id: '2091366474984390872', topic: 'tech' },
  { id: '2086599411241484495', topic: 'sport' },
  { id: '2077448568789733465', topic: 'sport' },
  { id: '2079253257784840217', topic: 'news' },
];

/** Comptes vidéo interrogés à la découverte (rotation aléatoire). */
const ACCOUNTS: { name: string; topic: string }[] = [
  { name: 'SpaceX', topic: 'espace' },
  { name: 'NASA', topic: 'espace' },
  { name: 'Ballislife', topic: 'sport' },
  { name: 'NBA', topic: 'sport' },
  { name: 'NFL', topic: 'sport' },
  { name: 'TrollFootball', topic: 'sport' },
  { name: 'Eagles', topic: 'sport' },
  { name: 'ESPN', topic: 'sport' },
  { name: 'brfootball', topic: 'sport' },
  { name: 'FabrizioRomano', topic: 'sport' },
  { name: 'Figure_robot', topic: 'tech' },
  { name: 'BostonDynamics', topic: 'tech' },
  { name: 'unitree_robotics', topic: 'tech' },
  { name: 'OpenAI', topic: 'tech' },
  { name: 'GoogleDeepMind', topic: 'tech' },
  { name: 'umesh_ai', topic: 'tech' },
  { name: 'Tesla', topic: 'tech' },
  { name: 'MKBHD', topic: 'tech' },
  { name: 'Rainmaker1973', topic: 'science' },
  { name: 'ScienceGuys_', topic: 'science' },
  { name: 'Interior_Design', topic: 'design' },
  { name: 'ArchitectureAI', topic: 'design' },
  { name: 'AMAZlNGNATURE', topic: 'animaux' },
  { name: 'NatureIsAmazing', topic: 'animaux' },
  { name: 'buitengebieden', topic: 'animaux' },
  { name: 'CuteEmergency', topic: 'animaux' },
  { name: 'HumansNoContext', topic: 'humour' },
  { name: 'FunnyVidsHQ', topic: 'humour' },
  { name: 'MemesOnTheHour', topic: 'humour' },
  { name: 'Yoda4ever', topic: 'humour' },
  { name: 'MrBeast', topic: 'divertissement' },
  { name: 'IGN', topic: 'gaming' },
  { name: 'Xbox', topic: 'gaming' },
  { name: 'PlayStation', topic: 'gaming' },
  { name: 'Rockstargames', topic: 'gaming' },
  { name: 'Reuters', topic: 'news' },
  { name: 'AFP', topic: 'news' },
  { name: 'BFMTV', topic: 'news' },
  { name: 'RMCsport', topic: 'sport' },
  { name: 'Inoxtag', topic: 'divertissement' },
  { name: 'MonsieurDream', topic: 'divertissement' },
  { name: 'Pop_Base', topic: 'musique' },
  { name: 'PopCrave', topic: 'musique' },
  { name: 'Music', topic: 'musique' },
  { name: 'FIFAWorldCup', topic: 'sport' },
  { name: 'UEFA', topic: 'sport' },
  { name: 'F1', topic: 'sport' },
  { name: 'UFC', topic: 'sport' },
  { name: 'WWE', topic: 'sport' },
  { name: 'Cristiano', topic: 'sport' },
];

/* ═════════════════════ Hydratation (tweet-result) ═════════════════════ */

function syndToken(id: string): string {
  return ((Number(id) / 1e15) * Math.PI).toString(36).replace(/(0+|\.)/g, '');
}

type Variant = { url: string; bitrate: number; width: number; height: number };
type AMedia = {
  type: 'photo' | 'video' | 'animated_gif';
  poster: string;
  width: number;
  height: number;
  durationMs: number;
  mp4: string | null;
};
export type AlgoPost = {
  id: string;
  url: string;
  text: string;
  createdAt: string;
  topic: string;
  score: number;
  /** true = contenu signalé sensible (nudité/sexe) → le client floute avant lecture. */
  sensitive?: boolean;
  author: { name: string; screenName: string; avatar: string; verified: boolean };
  stats: { likes: number; replies: number; reposts: number; quotes: number; bookmarks: number; views: number };
  media: AMedia[];
};

function num(v: unknown): number {
  const n = Number(v || 0);
  return Number.isFinite(n) ? n : 0;
}

function media(m: any): AMedia {
  const variants: Variant[] = ((m?.video_info?.variants || []) as any[])
    .filter((v) => v?.content_type === 'video/mp4' && v?.url)
    .map((v) => {
      const dim = String(v.url).match(/\/(\d+)x(\d+)\//);
      return { url: String(v.url), bitrate: num(v.bitrate), width: dim ? num(dim[1]) : 0, height: dim ? num(dim[2]) : 0 };
    })
    .sort((a, b) => b.bitrate - a.bitrate);
  const playable = variants.find((v) => v.width > 0 && v.width <= 1280) || variants[0] || null;
  return {
    type: (m?.type === 'video' || m?.type === 'animated_gif' ? m.type : 'photo') as AMedia['type'],
    poster: String(m?.media_url_https || ''),
    width: num(m?.original_info?.width) || num(m?.sizes?.large?.w),
    height: num(m?.original_info?.height) || num(m?.sizes?.large?.h),
    durationMs: num(m?.video_info?.duration_millis),
    mp4: playable ? playable.url : null,
  };
}

/** Cache d'hydratation : 30 min, partagé entre requêtes. */
type Hit = { at: number; post: AlgoPost | null };
const HYDRATE_TTL = 30 * 60 * 1000;
const gh = globalThis as unknown as { __xAlgoHydrate?: Map<string, Hit>; __xAlgoIds?: Map<string, string>; __xAlgoDisc?: Map<string, number> };
if (!gh.__xAlgoHydrate) gh.__xAlgoHydrate = new Map();
if (!gh.__xAlgoIds) gh.__xAlgoIds = new Map(); // id → sujet (candidats connus)
if (!gh.__xAlgoDisc) gh.__xAlgoDisc = new Map(); // compte → dernier passage
const hydrateCache = gh.__xAlgoHydrate;
const known = gh.__xAlgoIds;
const discovered = gh.__xAlgoDisc;

for (const s of SEED) if (!known.has(s.id)) known.set(s.id, s.topic);

async function hydrate(id: string, topic: string): Promise<AlgoPost | null> {
  const hit = hydrateCache.get(id);
  if (hit && Date.now() - hit.at < HYDRATE_TTL) return hit.post;
  const url = `https://cdn.syndication.twimg.com/tweet-result?id=${encodeURIComponent(id)}&lang=en&token=${syndToken(id)}`;
  try {
    const res = await fetch(url, { headers: { 'User-Agent': UA, Accept: 'application/json' }, signal: AbortSignal.timeout(12_000) });
    if (!res.ok) {
      hydrateCache.set(id, { at: Date.now(), post: null });
      return null;
    }
    const body = await res.text();
    if (body.trimStart().startsWith('<')) {
      hydrateCache.set(id, { at: Date.now(), post: null });
      return null;
    }
    const d = JSON.parse(body);
    const u = d?.user || {};
    const screen = String(u.screen_name || '');
    const post: AlgoPost = {
      id: String(d?.id_str || id),
      url: `https://x.com/${screen}/status/${d?.id_str || id}`,
      text: String(d?.text || ''),
      createdAt: String(d?.created_at || ''),
      topic,
      score: 0,
      author: {
        name: String(u.name || screen),
        screenName: screen,
        avatar: String(u.profile_image_url_https || '').replace('_normal.', '_x96.'),
        verified: Boolean(u.is_blue_verified || u.verified),
      },
      stats: {
        likes: num(d?.favorite_count),
        replies: num(d?.conversation_count) || num(d?.reply_count),
        reposts: num(d?.retweet_count),
        quotes: num(d?.quote_count),
        bookmarks: num(d?.bookmark_count),
        views: num(d?.view_count_info?.count) || num(d?.views?.count),
      },
      media: ((d?.mediaDetails || []) as any[]).map(media),
    };
    hydrateCache.set(id, { at: Date.now(), post });
    return post;
  } catch {
    hydrateCache.set(id, { at: Date.now(), post: null });
    return null;
  }
}

/* ═════════════════════ Découverte (timelines publiques) ═════════════════════ */

const DISCOVER_TTL = 20 * 60 * 1000;

/** Récupère de nouveaux ids depuis la timeline publique d'un compte. */
async function discover(account: string): Promise<string[]> {
  const last = discovered.get(account) || 0;
  if (Date.now() - last < DISCOVER_TTL) return [];
  discovered.set(account, Date.now());
  const url = `https://syndication.twitter.com/srv/timeline-profile/screen-name/${encodeURIComponent(account)}`;
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': UA, Accept: 'text/html', 'Accept-Language': 'en-US,en;q=0.9', Referer: 'https://x.com/' },
      signal: AbortSignal.timeout(12_000),
    });
    if (!res.ok) return [];
    const html = await res.text();
    const ids = new Set<string>();
    for (const m of html.matchAll(/"id_str":"(\d{15,25})"/g)) ids.add(m[1]);
    for (const m of html.matchAll(/status\/(\d{15,25})/g)) ids.add(m[1]);
    return [...ids].slice(0, 40);
  } catch {
    return [];
  }
}

/** Complète le vivier avec quelques comptes tirés au hasard. */
async function grow(rounds = 3): Promise<number> {
  const picks: { name: string; topic: string }[] = [];
  const pool = [...ACCOUNTS].sort(() => Math.random() - 0.5);
  for (const a of pool) {
    if (picks.length >= rounds) break;
    if (Date.now() - (discovered.get(a.name) || 0) < DISCOVER_TTL) continue;
    picks.push(a);
  }
  let added = 0;
  const lists = await Promise.all(picks.map((p) => discover(p.name).then((ids) => ({ topic: p.topic, ids }))));
  for (const l of lists) {
    for (const id of l.ids) {
      if (!known.has(id)) {
        known.set(id, l.topic);
        added++;
      }
    }
  }
  return added;
}

/* ═════════════════════ Classement ═════════════════════ */

/** `aff` : "auteur:score,sujet:score" envoyé par le client (affinités apprises). */
function parseAff(raw: string): Record<string, number> {
  const out: Record<string, number> = {};
  for (const part of raw.split(',')) {
    const [k, v] = part.split(':');
    if (!k) continue;
    const n = Number(v);
    if (Number.isFinite(n)) out[k.toLowerCase()] = Math.max(-5, Math.min(20, n));
  }
  return out;
}

function ageHours(createdAt: string): number {
  const t = Date.parse(createdAt);
  if (!Number.isFinite(t)) return 999;
  return Math.max(0, (Date.now() - t) / 3_600_000);
}

function scoreOf(p: AlgoPost, aff: Record<string, number>): number {
  const a = aff['@' + p.author.screenName.toLowerCase()] || 0;
  const t = aff[p.topic.toLowerCase()] || 0;
  const eng = Math.log10(1 + p.stats.likes + p.stats.reposts * 3 + p.stats.views / 100);
  const fresh = 6 / (1 + ageHours(p.createdAt) / 24); // décroît sur quelques jours
  const vid = p.media.some((m) => m.type !== 'photo') ? 3 : 0;
  const explore = Math.random() * 4; // part d'exploration : le fil ne se figera jamais
  return a * 3 + t * 2 + eng + fresh + vid + explore;
}

/* ═════════════════════ Routes ═════════════════════ */

/** Lot suivant du fil « pour toi ». */
algo.get('/x-algo', async (c) => {
  const n = Math.max(1, Math.min(12, Number(c.req.query('n')) || 6));
  const seen = new Set(
    String(c.req.query('seen') || '')
      .split(',')
      .map((s) => s.trim().replace(/\D/g, ''))
      .filter(Boolean),
  );
  const aff = parseAff(String(c.req.query('aff') || ''));
  const videoOnly = String(c.req.query('video') || '') === '1';

  // Vivier trop maigre par rapport à ce qui reste à servir → on va chercher du neuf.
  let fresh = [...known.keys()].filter((id) => !seen.has(id));
  if (fresh.length < n * 4) {
    await grow(4);
    fresh = [...known.keys()].filter((id) => !seen.has(id));
  }

  // On hydrate un échantillon aléatoire (les ids inconnus peuvent être du texte pur).
  const sample = fresh.sort(() => Math.random() - 0.5).slice(0, Math.max(n * 4, 24));
  const hydrated = (await Promise.all(sample.map((id) => hydrate(id, known.get(id) || 'divers')))).filter(
    (p): p is AlgoPost => Boolean(p),
  );

  // On purge les ids morts pour ne pas les retenter en boucle.
  for (const id of sample) {
    const h = hydrateCache.get(id);
    if (h && h.post === null) known.delete(id);
  }

  const wanted = hydrated.filter((p) => (videoOnly ? p.media.some((m) => m.type !== 'photo') : p.media.length > 0 || p.text));

  // Remplissage par l'extracteur (vid-pool) : X répond souvent 429 à la découverte,
  // le vivier fediverse fournit alors des vidéos mp4 fraîches → le fil ne se tarit plus.
  // On mélange TOUJOURS des vidéos du vivier aux candidats : sinon les 17 posts
  // X vérifiés remplissaient chaque lot et le fil tournait en rond.
  {
    const all = poolPosts();
    const extra = all
      .filter((p) => !seen.has(p.id.replace(/\D/g, '')) && !seen.has(p.id) && p.media.some((m) => m.mp4))
      .sort(() => Math.random() - 0.5)
      .slice(0, Math.max(n * 3, 12));
    for (const p of extra) wanted.push(p);
    if (all.length < 200) void growPool(4).catch(() => {});
  }

  for (const p of wanted) p.score = scoreOf(p, aff);
  const posts = wanted.sort((a, b) => b.score - a.score).slice(0, n);

  return c.json(
    {
      posts,
      count: posts.length,
      pool: known.size,
      seen: seen.size,
      affinities: Object.keys(aff).length,
    },
    200,
  );
});

/** État du moteur (diagnostic). */
algo.get('/x-algo-stats', async (c) => {
  const grew = String(c.req.query('grow') || '') === '1' ? await grow(3) : 0;
  return c.json(
    {
      pool: known.size,
      seed: SEED.length,
      accounts: ACCOUNTS.length,
      hydrated: hydrateCache.size,
      discoveredAccounts: discovered.size,
      grew,
    },
    200,
  );
});

export default algo;
