/**
 * XCloneApp — le fil + toutes les pages, calé au pixel sur la capture fournie.
 *
 * Mesures relevées sur la capture (3024×2010, densité 2 → 1512 px CSS) :
 *   rail 275 px (bord à x=399), colonne centrale 600 px (bord à x=997,5),
 *   colonne droite 350 px (contenu à partir de x=1031).
 *
 * ÉCHELLE : la maquette fait STAGE_W = 1258 px de large. Le composant mesure son
 * conteneur et applique transform: scale(conteneur / 1258) — donc plus d'effet
 * « app zoomée » quand le panneau est plus étroit que la maquette. La hauteur
 * interne est divisée par l'échelle pour remplir exactement la zone.
 *
 * VRAIS POSTS X : GET /api/x-feed (syndication publique, sans clé API) → texte,
 * auteur, avatar, compteurs réels, photos et VIDÉOS mp4 servies par /api/x-media.
 *
 * PAGES FONCTIONNELLES : Home, Explore, Notifications, Follow, Chat, SuperGrok,
 * Premium+, Bookmarks, Creator Studio, Articles, Profile, More.
 *
 * Purement additif.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { XCloneFonts, XGlyph, X_FONT } from './XCloneLogin';

const C = {
  bg: '#000000',
  card: '#16181c',
  text: '#e7e9ea',
  dim: '#71767b',
  line: '#2f3336',
  blue: '#1d9bf0',
  hover: 'rgba(255,255,255,0.03)',
  search: '#202327',
  red: '#f91880',
  green: '#00ba7c',
  btn: '#eff3f4',
  btnText: '#0f1419',
};

const A = '/xclone/';
const D = '/xclone/d/';

/** Largeur de la maquette : rail 276 + centre 600 + droite 382. */
const STAGE_W = 1258;

/** Bas de page « Follow » (liste issue du fil) — hors capture, gardée mais masquée. */
const FOLLOW_EXTRA = false;

/**
 * Ancien fil infini « en boucle » (répétition des mêmes posts) — gardé, désactivé.
 * Remplacé par l'algorithme /api/x-algo : vraies vidéos X aléatoires, jamais deux
 * fois le même post, classées par affinité apprise (comptes, sujets, engagement).
 */
const FEED_LOOP = false;

/**
 * false = les anciens posts statiques ne sont plus renvoyés à la fin du fil :
 * le bas du fil est toujours de nouvelles vidéos de l'algorithme. true = ancien
 * rendu (les posts de base réapparaissaient en bas). Rien n'est supprimé.
 */
const FEED_STATIC_TAIL = false;

/** Nombre de posts statiques gardés en haut du fil (le reste passe après l'algo). */
const HEAD_STATIC = 3;

/** Poids d'apprentissage de l'algorithme, par action de l'utilisateur. */
const AFF_WEIGHT = { follow: 4, like: 3, repost: 2.5, open: 1.5, play: 1 };
const AFF_KEY = 'xclone_aff';

const NAV = [
  { id: 'home', label: 'Home', icon: 'nav-home.png' },
  { id: 'explore', label: 'Explore', icon: 'nav-explore.png' },
  { id: 'notif', label: 'Notifications', icon: 'nav-notif.png' },
  { id: 'follow', label: 'Follow', icon: 'nav-follow.png' },
  { id: 'chat', label: 'Chat', icon: 'nav-chat.png' },
  { id: 'grok', label: 'Grok', icon: 'nav-grok.png', dot: true },
  { id: 'bookmarks', label: 'History', icon: 'nav-bookmarks.png' },
  { id: 'premium', label: 'Premium', icon: 'nav-premium.png' },
  { id: 'profile', label: 'Profile', icon: 'nav-profile.png' },
  { id: 'more', label: 'More', icon: 'nav-more.png' },
];

const COMPOSER_ICONS = ['c-img.png', 'c-gif.png', 'c-poll.png', 'c-emoji.png', 'c-media2.png', 'c-sched.png', 'c-loc.png', 'c-bold.png', 'c-ital.png'];

const NEWS = [
  { title: 'Liverpool in Advanced Talks for 18-Year-Old Striker Djylian N’Guessan', meta: 'Trending now · Sports · 7,039 posts', av: 'av-news1.png' },
  { title: 'Fans and Family Honor Michael Jackson’s 68th Birthday', meta: '2 days ago · Entertainment · 97.3K posts', av: 'av-news2.png' },
  { title: 'Gamers Divided on NVIDIA’s DLSS 5 Neural Rendering', meta: '1 day ago · Other · 50.6K posts', av: 'av-news3.png' },
];

/** Explore → Today's News (onglet Explore de la capture). */
const EXPLORE_NEWS = [
  { title: 'Liverpool in Advanced Talks for 18-Year-Old Striker Djylian N’Guessan', meta: 'Trending now · Sports · 7K posts', av: 'av-news1.png' },
  { title: 'Fans and Family Honor Michael Jackson’s 68th Birthday', meta: '2 days ago · Entertainment · 97K posts', av: 'av-news2.png' },
  { title: 'Gamers Divided on NVIDIA’s DLSS 5 Neural Rendering', meta: '1 day ago · News · 50K posts', av: 'av-news3.png' },
];

const NEWS_TAB = [
  { title: 'Gamers Divided on NVIDIA’s DLSS 5 Neural Rendering', meta: '1 day ago · News · 50K posts', av: 'av-news3.png' },
  { title: 'EthraShip Launches 100% APR USDC Campaign on Harbor Platform', meta: '1 day ago · News · 10K posts', av: 'av-news1.png' },
  { title: 'Greece and Israel Sign €3 Billion Achilles Shield Air Defense Deal', meta: '20 hours ago · News · 13K posts', av: 'av-news2.png' },
  { title: 'Lindsay Clancy Jury Continues Deliberations in Child Murder Trial', meta: '15 hours ago · Other · 32K posts', av: 'av-news3.png' },
  { title: 'Jadavpur University Walls Repainted with Marx Quote After Cleanup', meta: '5 hours ago · Other · 715 posts', av: 'av-news1.png' },
];

const SPORTS_TAB = [
  { title: 'Liverpool in Advanced Talks for 18-Year-Old Striker Djylian N’Guessan', meta: 'Trending now · Sports · 7.2K posts', av: 'av-news1.png' },
  { title: 'Chelsea Agree €45M Deal for Monaco’s Lamine Camara', meta: '16 hours ago · Sports · 36K posts', av: 'av-news2.png' },
  { title: 'Youssoufa Moukoko Agrees Move to Turkish Club Çorum FK', meta: '2 hours ago · Sports · 2.4K posts', av: 'av-news3.png' },
];

const ENTERTAINMENT_TAB = [
  { title: 'Fans and Family Honor Michael Jackson’s 68th Birthday', meta: '2 days ago · Entertainment · 97K posts', av: 'av-news2.png' },
  { title: 'Gamers Divided on NVIDIA’s DLSS 5 Neural Rendering', meta: '1 day ago · Entertainment · 50K posts', av: 'av-news3.png' },
  { title: 'Deadlock Mod Links Sex Toys to Kills and Deaths', meta: '19 hours ago · Entertainment · 3.3K posts', av: 'av-news1.png' },
  { title: 'Tomb Raider II and III Remakes Reportedly in Development', meta: 'Trending now · Entertainment · 424 posts', av: 'av-news2.png' },
  { title: 'BTS Jimin Launches Official TikTok Account with Playful ‘Hehe’ Bio', meta: '8 hours ago · Entertainment · 46K posts', av: 'av-news3.png' },
];

/** Explore → Trending (liste numérotée de la capture). */
const TRENDING_LIST = [
  { cat: 'Trending in Belgium', topic: '#gntclu' },
  { cat: 'Trending in Belgium', topic: '#usgand' },
  { cat: 'Trending in Belgium', topic: 'Iceland' },
  { cat: 'Trending in Belgium', topic: 'De Wever' },
  { cat: 'Sports · Trending', topic: 'Courtois' },
  { cat: 'Trending in Belgium', topic: 'Forbs' },
  { cat: 'Trending in Belgium', topic: 'Kana' },
];

/** Follow → Suggested for you (comptes et bios de la capture). */
const SUGGESTED = [
  { name: 'Apple', handle: '@Apple', av: 's-apple.png', bio: '', link: 'Apple.com' },
  { name: 'Adrian Wojnarowski', handle: '@wojespn', av: 's-woj.png', bio: '', link: '@BonniesMBB GM' },
  { name: 'Jeff Bezos', handle: '@JeffBezos', av: 's-bezos.png', gold: true, bio: 'Six thousand years ago, someone invented the plow, and we all got wealthier. A gentle reminder that all civilizational wealth is driven by invention.' },
  { name: 'Geert Wilders', handle: '@geertwilderspvv', av: 's-wilders.png', bio: 'Voorzitter Tweede Kamerfractie PVV / Member of Parliament (MP) / Chairman Party for Freedom (PVV)' },
  { name: 'Cristiano Ronaldo', handle: '@Cristiano', av: 's-ronaldo.png', bio: 'Welcome to the official account of Cristiano Ronaldo.' },
  { name: 'Mister V', handle: '@MisterV', av: 's-misterv.png', bio: '' },
];

/** Colonne droite → Who to follow (comptes de la capture). */
const WHO = [
  { name: 'Theo Francken', handle: '@FranckenTheo', av: 'w-theo.png' },
  { name: 'Marc Van Ranst', handle: '@vanranstmarc', av: 'w-marc.png' },
  { name: 'M8 Squeezie', handle: '@xSqueeZie', av: 'w-squeezie.png' },
];

/** Follow → Creators for you (capture : boutons Subscribe). */
const CREATORS: { name: string; handle: string; av: string; bio?: string; link?: string; badge?: string }[] = [
  { name: 'MrBeast', handle: '@MrBeast', av: 'cr-mrbeast.png', badge: '🎬', bio: 'I want to make the world a better place' },
  { name: 'Elon Musk', handle: '@elonmusk', av: 'cr-elon.png', badge: '𝕏', link: 'Terafab.AI' },
  { name: 'Andrew Tate', handle: '@Cobratate', av: 'cr-tate.png', badge: '🅰️', bio: 'Unmatched perspicacity coupled with sheer indefatigability makes me a feared opponent in any realm of human endeavour. Escape Slavery:', link: 'cobratate.com' },
  { name: 'Inoxtag', handle: '@inoxtag', av: 'cr-inoxtag.png', badge: '✅', bio: '🎥Youtuber & Streamer /', link: 'instagram.com/inoxtag ⚡️ @InoxtagCrew' },
  { name: 'Sacha Tavolieri', handle: '@sachatavolieri', av: 'cr-sacha.png', bio: '🔵⚪️🇧🇪 Everything’s possible. Think outside the box. Transfer news specialist.' },
  { name: 'Historic Vids', handle: '@historyinmemes', av: 'cr-historic.png', bio: 'Daily history lessons. Education through memes! Business Inquiries: evan@historyinmemes.com' },
];

/** Profil → Who to follow (capture). */
const PROFILE_WHO: { name: string; handle: string; av: string; verified: boolean; bio: string; link?: string }[] = [
  { name: 'VRT NWS', handle: '@vrtnws', av: 'pw-vrt.png', verified: false, bio: '#vrtnws is de nieuwssite en -app van de nieuwsdienst van de openbare omroep. Volg ons ook op #BlueSky 👉', link: 'bsky.app/profile/vrtnws…' },
  { name: 'HBvL', handle: '@hbvl', av: 'pw-hbvl.png', verified: true, bio: 'De officiële account van Het Belang van Limburg. Wij geven je elke dag een selectie van het nieuws in Limburg en ver daarbuiten.' },
  { name: 'Zuhal Demir', handle: '@Zu_Demir', av: 'pw-zuhal.png', verified: true, bio: 'Vlaams minister van Onderwijs, Justitie en Werk - vragen via', link: 'kabinetdemir-contact.be' },
];

/** Profil → « Let’s get you set up » (4 cartes dégradées de la capture). */
const SETUP_CARDS: { label: string; left?: string; icon: string; grad: string }[] = [
  { label: 'Complete your profile', icon: '👤', grad: 'linear-gradient(160deg,#1c9be0,#3fd0c9)' },
  { label: 'Follow 5 accounts', left: '5 left', icon: '👥', grad: 'linear-gradient(160deg,#7b5cf0,#e05bd0)' },
  { label: 'Follow 3 Topics', left: '3 left', icon: '💬', grad: 'linear-gradient(160deg,#f5a623,#f5d020)' },
  { label: 'Turn on notifications', left: 'DONE', icon: '🔔', grad: 'linear-gradient(160deg,#f6339a,#d321c0)' },
];

/** Premium → deux offres de la capture. */
const PREMIUM_PLANS = [
  {
    name: 'Premium', monthly: '€4.70', annual: '€49.30', highlight: true,
    perks: ['Premium checkmark', 'Enhanced Grok access', 'Advanced analytics', 'Less ads in your feeds', 'Longer posts'],
  },
  {
    name: 'Premium+', monthly: '€22.30', annual: '€229.00', highlight: false,
    perks: ['Fully ad-free', 'SuperGrok', 'Handle Marketplace', 'Highest reply boost', 'Radar'],
  },
];

const FOOTER_LINKS = ['Terms', 'Privacy', 'Cookies', 'Accessibility', 'Ads info', 'More …'];

const TRENDS: { cat: string; topic: string; posts: string; withText?: string[] }[] = [
  { cat: 'Sports · Trending', topic: 'Bruno Fernandes', posts: '18.4K posts' },
  { cat: 'Trending in Belgium', topic: 'Les Islandais', posts: '4,112 posts' },
  { cat: 'Trending in Belgium', topic: 'Lambrechts', posts: '2,908 posts' },
  { cat: 'Trending in Belgium', topic: 'visser', posts: '1,764 posts' },
];

interface Media {
  src?: string;          // asset local (capture)
  photo?: string;        // URL photo réelle (proxyfiée)
  video?: string;        // URL mp4 réelle (proxyfiée)
  poster?: string;
  black?: boolean;
  duration?: string;
  ratio?: number;
  /** Contenu signalé sensible (nudité/sexe) : média flouté jusqu'au clic. */
  sensitive?: boolean;
}

interface Post {
  id: string;
  author: string;
  handle: string;
  verified: boolean;
  emoji?: string;
  age: string;
  text: string;
  avatar: string;
  avatarUrl?: string;
  media?: Media;
  replies: string;
  reposts: string;
  likes: string;
  views: string;
  likesN?: number;
  repostsN?: number;
  url?: string;
  real?: boolean;
  /** Sujet renvoyé par l'algorithme (sport, tech, espace, animaux, humour, news…). */
  topic?: string;
}

const BASE_POSTS: Post[] = [
  {
    id: 'p1', author: 'NO CONTEXT HUMANS', handle: '@HumansNoContext', verified: true, age: '11h',
    text: '100% dad’s idea', avatar: 'av-p1.png',
    media: { src: 'media-p1.png', duration: '0:04' },
    replies: '64', reposts: '78', likes: '2.3K', views: '109K',
  },
  {
    id: 'p2', author: 'Dr. Clown, PhD', handle: '@DrClownPhD', verified: true, emoji: '🤡', age: '12h',
    text: 'A little bit of faith in humanity restored… 😊', avatar: 'av-p2.png',
    media: { black: true },
    replies: '128', reposts: '412', likes: '9.1K', views: '840K',
  },
];

/** Posts X réels chargés par défaut (vidéos vérifiées + photo + 1er tweet). */
const X_IDS = [
  '2093372827399311515',
  '2087607645540585686',
  '1925976536533852363',
  '2084892304582885414',
  '2039824473822548033',
  '1349129669258448897',
  '20',
];

interface ApiPost {
  id: string; content: string; vues?: number; engagements?: number; reponses?: number;
  publishedAt?: string | null; createdAt?: string | null;
}
interface ApiTotals {
  envoyes?: number; programmes?: number; enAttente?: number; echecs?: number;
  vues?: number; engagements?: number; clics?: number; reponsesIA?: number;
}
interface XApiMedia { type: string; poster: string; width: number; height: number; durationMs: number; mp4: string | null }
interface XApiPost {
  id: string; url: string; text: string; createdAt: string;
  author: { name: string; screenName: string; avatar: string; verified: boolean };
  stats: { likes: number; replies: number; reposts: number; quotes: number; bookmarks: number; views: number };
  media: XApiMedia[];
}

interface Props {
  companyId: string;
  platform?: string;
  identity?: string;
  className?: string;
}

const fmt = (n?: number) => {
  if (!n) return '0';
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1).replace(/\.0$/, '') + 'M';
  if (n >= 1000) return (n / 1000).toFixed(1).replace(/\.0$/, '') + 'K';
  return String(n);
};

const ago = (iso?: string | null) => {
  if (!iso) return 'now';
  const m = Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
  if (m < 1) return 'now';
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h`;
  const d = Math.floor(h / 24);
  return d < 365 ? `${d}d` : `${Math.floor(d / 365)}y`;
};

const dur = (ms: number) => {
  const s = Math.round(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};

/**
 * Média : seuls les hôtes X ont besoin du proxy (referrer + CORS).
 * Les hôtes du vivier (fediverse) se lisent en direct : le proxy tamponnait la
 * vidéo entière en mémoire avant de la rendre → lecture lente ou muette.
 */
const px = (u?: string | null) => {
  if (!u) return undefined;
  return /(^https:\/\/[^/]*\.?(twimg|twitter)\.com\/)/.test(u) ? `/api/x-media?u=${encodeURIComponent(u)}` : u;
};

function Ico({ src, size, alt = '' }: { src: string; size: number; alt?: string }) {
  return <img src={D + src} alt={alt} width={size} height={size} style={{ width: size, height: size, display: 'block' }} draggable={false} />;
}

function Verified() {
  return <img src={A + 'verified.png'} alt="" width={16} height={16} style={{ width: 16, height: 16, display: 'block' }} />;
}

/** Vidéos en cours de lecture : une seule à la fois → défilement fluide. */
const PLAYING = new Set<HTMLVideoElement>();

/* ------------------------------------------------------------------ *
 * Détecteur de nudité côté image : les mots-clés du serveur ratent les
 * vidéos sans description, et floutent parfois des vidéos sans rien de
 * sensible. On regarde donc VRAIMENT les images de la vidéo : 6 instants
 * répartis sur toute la durée, ratio de pixels peau + pixels peau très
 * regroupés (une plage de peau large = corps nu, un visage = petite tache).
 * ------------------------------------------------------------------ */
const NSFW_SCAN = new Map<string, boolean | Promise<boolean>>();

/** Ratio de pixels « peau » d'une image 64×64 déjà dessinée. */
function skinRatio(d: Uint8ClampedArray): number {
  let skin = 0;
  const n = d.length / 4;
  for (let i = 0; i < d.length; i += 4) {
    const r = d[i], g = d[i + 1], b = d[i + 2];
    const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
    if (r > 95 && g > 40 && b > 20 && mx - mn > 15 && Math.abs(r - g) > 15 && r > g && r > b) skin++;
    else if (r > 220 && g > 180 && b > 160 && Math.abs(r - g) <= 15 && r > b && g > b) skin++;
  }
  return skin / n;
}

/**
 * Analyse une vidéo hors écran (élément détaché, jamais affiché) et dit si
 * elle montre de la peau nue sur une bonne partie de l'image, à n'importe
 * quel moment de la vidéo. Résultat mis en cache par URL.
 */
function scanVideo(src: string): Promise<boolean> {
  const hit = NSFW_SCAN.get(src);
  if (typeof hit === 'boolean') return Promise.resolve(hit);
  if (hit) return hit as Promise<boolean>;
  const job = new Promise<boolean>(resolve => {
    const v = document.createElement('video');
    v.crossOrigin = 'anonymous';
    v.muted = true;
    v.preload = 'auto';
    v.src = src;
    const cv = document.createElement('canvas');
    cv.width = 64; cv.height = 64;
    const ctx = cv.getContext('2d', { willReadFrequently: true });
    let done = false;
    const finish = (val: boolean) => {
      if (done) return;
      done = true;
      try { v.pause(); v.removeAttribute('src'); v.load(); } catch { /* rien */ }
      resolve(val);
    };
    const to = setTimeout(() => finish(false), 12000);
    v.onerror = () => { clearTimeout(to); finish(false); };
    v.onloadeddata = () => {
      const total = Number.isFinite(v.duration) && v.duration > 0 ? v.duration : 0;
      const marks = total ? [0.08, 0.24, 0.4, 0.56, 0.72, 0.88].map(f => f * total) : [0];
      let i = 0, hot = 0;
      const step = () => {
        if (done) return;
        if (!ctx) { clearTimeout(to); return finish(false); }
        try {
          ctx.drawImage(v, 0, 0, 64, 64);
          const r = skinRatio(ctx.getImageData(0, 0, 64, 64).data);
          // 30 % de l'image en peau = beaucoup plus qu'un visage ou des bras.
          if (r > 0.3) hot++;
          if (r > 0.55 || hot >= 2) { clearTimeout(to); return finish(true); }
        } catch {
          // canvas « tainted » (pas de CORS) → analyse impossible sur cet hôte
          clearTimeout(to);
          return finish(false);
        }
        i++;
        if (i >= marks.length) { clearTimeout(to); return finish(false); }
        v.currentTime = marks[i];
      };
      v.onseeked = step;
      if (marks.length > 1) v.currentTime = marks[0];
      else step();
    };
  });
  NSFW_SCAN.set(src, job);
  job.then(val => NSFW_SCAN.set(src, val)).catch(() => NSFW_SCAN.delete(src));
  return job;
}

/** Média d'un post : vraie vidéo X (muette, en boucle, son au clic) ou photo. */
function PostMedia({ media, onMax }: { media: Media; onMax?: () => void }) {
  const ref = useRef<HTMLVideoElement | null>(null);
  const [muted, setMuted] = useState(true);
  /** Contenu sensible : flouté d'entrée, révélé seulement sur demande. */
  const [shown, setShown] = useState(false);
  /** Verdict de l'analyse d'image (nudité vue dans la vidéo elle-même). */
  const [seen, setSeen] = useState<boolean | null>(null);
  const veiled = (Boolean(media.sensitive) || seen === true) && !shown;

  // Analyse d'image : c'est elle qui tranche. Elle attrape les vidéos nues
  // sans description et laisse passer celles où il n'y a rien.
  useEffect(() => {
    if (!media.video) return;
    let alive = true;
    const cached = NSFW_SCAN.get(media.video);
    if (typeof cached === 'boolean') { setSeen(cached); return; }
    scanVideo(media.video).then(v => { if (alive) setSeen(v); }).catch(() => {});
    return () => { alive = false; };
  }, [media.video]);

  useEffect(() => {
    const v = ref.current;
    if (!v) return;
    // Une seule vidéo joue à la fois et rien ne tourne hors écran : le fil reste fluide.
    const io = new IntersectionObserver(
      es =>
        es.forEach(e => {
          if (e.isIntersecting && !veiled) {
            for (const other of PLAYING) if (other !== v) other.pause();
            PLAYING.add(v);
            v.play().catch(() => {});
          } else {
            PLAYING.delete(v);
            v.pause();
          }
        }),
      { threshold: 0.6 },
    );
    io.observe(v);
    return () => { PLAYING.delete(v); io.disconnect(); };
  }, [media.video, veiled]);

  return (
    <div style={{ position: 'relative' }}>
    <div style={{ marginTop: 12, borderRadius: 16, overflow: 'hidden', position: 'relative', border: `1px solid ${C.line}`, background: '#000', ...(veiled ? { filter: 'blur(30px)', transform: 'scale(1.04)', pointerEvents: 'none' as const } : null) }}>
      {media.video ? (
        <video
          ref={ref}
          src={media.video}
          poster={media.poster}
          muted={muted}
          loop
          playsInline
          preload="metadata"
          onClick={e => { e.stopPropagation(); const v = e.currentTarget; if (v.paused) v.play().catch(() => {}); else v.pause(); }}
          style={{ display: 'block', width: '100%', maxHeight: 510, objectFit: 'cover', background: '#000', cursor: 'pointer' }}
        />
      ) : media.photo ? (
        <img src={media.photo} alt="" style={{ display: 'block', width: '100%', maxHeight: 510, objectFit: 'cover' }} />
      ) : media.src ? (
        <img src={A + media.src} alt="" style={{ display: 'block', width: '100%' }} />
      ) : (
        <div style={{ width: '100%', aspectRatio: '4 / 5', background: '#000' }} />
      )}

      {media.duration && (
        <span style={{ position: 'absolute', left: 12, bottom: 12, background: 'rgba(0,0,0,0.7)', color: '#fff', fontSize: 12, fontWeight: 700, padding: '1px 6px', borderRadius: 4 }}>
          {media.duration}
        </span>
      )}

      {media.video && (
        <div style={{ position: 'absolute', right: 12, bottom: 12, display: 'flex', gap: 8 }}>
          <button
            onClick={e => { e.stopPropagation(); setMuted(m => !m); }}
            title={muted ? 'Son' : 'Muet'}
            style={{ width: 30, height: 30, borderRadius: 9999, border: 'none', background: 'rgba(0,0,0,0.6)', color: '#fff', fontSize: 13, cursor: 'pointer', lineHeight: '30px', padding: 0 }}
          >
            {muted ? '🔇' : '🔊'}
          </button>
          <button
            onClick={e => { e.stopPropagation(); if (onMax) onMax(); else ref.current?.requestFullscreen?.().catch(() => {}); }}
            title="Plein écran"
            style={{ width: 30, height: 30, borderRadius: 9999, border: 'none', background: 'rgba(0,0,0,0.6)', color: '#fff', fontSize: 13, cursor: 'pointer', lineHeight: '30px', padding: 0 }}
          >
            ⛶
          </button>
        </div>
      )}
    </div>

    {veiled && (
      <div
        onClick={e => { e.stopPropagation(); }}
        style={{ position: 'absolute', inset: '12px 0 0 0', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 10, borderRadius: 16, background: 'rgba(0,0,0,0.55)' }}
      >
        <div style={{ color: '#fff', fontSize: 15, fontWeight: 700 }}>Contenu sensible</div>
        <div style={{ color: C.dim, fontSize: 13, maxWidth: 300, textAlign: 'center' }}>
          Cette vidéo peut contenir de la nudité ou du contenu sexuel.
        </div>
        <button
          onClick={e => { e.stopPropagation(); setShown(true); }}
          style={{ marginTop: 4, height: 32, padding: '0 16px', borderRadius: 9999, border: `1px solid ${C.line}`, background: C.btn, color: C.btnText, fontSize: 14, fontWeight: 700, cursor: 'pointer' }}
        >
          Afficher
        </button>
      </div>
    )}
    </div>
  );
}

/** Mélange stable (même ordre pour un même seed) : le début du fil change à chaque ouverture de X. */
function shuffleSeeded<T extends { id: string }>(list: T[], seed: number): T[] {
  const key = (id: string) => {
    let h = Math.floor(seed * 1e9) | 0;
    for (let i = 0; i < id.length; i++) h = (Math.imul(h ^ id.charCodeAt(i), 2654435761) >>> 0) | 0;
    return h >>> 0;
  };
  return [...list].sort((a, b) => key(a.id) - key(b.id));
}

const row: React.CSSProperties = { display: 'flex', alignItems: 'center' };

const NAV_TITLE: Record<string, string> = {
  home: 'Home', explore: 'Explore', notif: 'Notifications', follow: 'Follow', chat: 'Messages',
  grok: 'Grok', premium: 'Premium+', bookmarks: 'Bookmarks', studio: 'Creator Studio',
  articles: 'Articles', profile: 'Profile', more: 'More',
};

export function XCloneApp({ companyId, platform = 'twitter', identity = 'AlexSmithmobbin', className = '' }: Props) {
  const [nav, setNav] = useState('home');
  const [tab, setTab] = useState<'foryou' | 'following'>('foryou');
  const [draft, setDraft] = useState('');
  const [apiPosts, setApiPosts] = useState<ApiPost[]>([]);
  const [totals, setTotals] = useState<ApiTotals>({});
  const [xPosts, setXPosts] = useState<XApiPost[]>([]);
  const [mine, setMine] = useState<Post[]>([]);
  const [newsOpen, setNewsOpen] = useState(true);
  const [query, setQuery] = useState('');
  const [liked, setLiked] = useState<Record<string, boolean>>({});
  const [reposted, setReposted] = useState<Record<string, boolean>>({});
  const [marked, setMarked] = useState<Record<string, boolean>>({});
  const [following, setFollowing] = useState<Record<string, boolean>>({ '@HumansNoContext': true, '@velbaz_ia': true });
  const [open, setOpen] = useState<Post | null>(null);
  /** Post/vidéo agrandi au centre, plein écran, comme le lightbox de X. */
  const [maxPost, setMaxPost] = useState<Post | null>(null);
  const [replies, setReplies] = useState<Record<string, { text: string; age: string }[]>>({});
  const [replyDraft, setReplyDraft] = useState('');

  // Pages annexes
  const [exploreTab, setExploreTab] = useState<'foryou' | 'trending' | 'news' | 'sports' | 'entertainment'>('foryou');
  const [followTab, setFollowTab] = useState<'who' | 'creators'>('who');
  const [notifTab, setNotifTab] = useState<'all' | 'mentions'>('all');
  const [profileTab, setProfileTab] = useState<'posts' | 'replies' | 'reposts' | 'media' | 'likes'>('posts');
  const [bmTab, setBmTab] = useState<'bookmarks' | 'likes'>('bookmarks');
  const [acctMenu, setAcctMenu] = useState(false);
  const [chatWith, setChatWith] = useState<string | null>(null);
  const [chats, setChats] = useState<Record<string, { me: boolean; text: string }[]>>({
    '@HumansNoContext': [{ me: false, text: 'yo, tu as vu la vidéo ?' }],
    '@DrClownPhD': [{ me: false, text: 'merci pour le repost 🤡' }],
  });
  const [chatDraft, setChatDraft] = useState('');
  const [grokDraft, setGrokDraft] = useState('');
  const [grokLog, setGrokLog] = useState<{ me: boolean; text: string }[]>([]);
  const [plan, setPlan] = useState<'monthly' | 'annual'>('annual');
  const [articleDraft, setArticleDraft] = useState({ title: '', body: '' });
  const [articles, setArticles] = useState<{ id: string; title: string; body: string; age: string }[]>([]);
  const [settings, setSettings] = useState<Record<string, boolean>>({ private: false, dm: true, quality: true, dark: false });

  /* ═════ Fil infini : le fil se recharge en boucle au défilement, comme X ═════ */
  const [feedPages, setFeedPages] = useState(1);
  const [more, setMore] = useState(false);
  const loadingMore = useRef(false);
  /** Dernier chargement : évite les rafales de requêtes pendant le défilement. */
  const lastLoad = useRef(0);

  /* ═════ Algorithme : vraies vidéos X aléatoires, jamais deux fois la même ═════ */
  const [algoPosts, setAlgoPosts] = useState<Post[]>([]);
  /** Nouveau seed à chaque entrée dans X : le haut du fil n'est jamais le même. */
  const sessionSeed = useRef(Math.random());
  /** Compteur de recyclage : ids uniques quand le vivier de vidéos est épuisé. */
  const algoRound = useRef(0);
  const seenIds = useRef<Set<string>>(new Set());
  const affRef = useRef<Record<string, number>>({});
  const [affVersion, setAffVersion] = useState(0);
  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(AFF_KEY);
      if (raw) affRef.current = JSON.parse(raw) as Record<string, number>;
    } catch { /* stockage indisponible : l'algorithme part de zéro */ }
  }, []);

  /** Apprentissage : renforce l'affinité pour un compte et un sujet. */
  const bump = useCallback((p: Post, w: number) => {
    const a = affRef.current;
    const k = '@' + p.handle.replace('@', '').toLowerCase();
    a[k] = (a[k] || 0) + w;
    if (p.topic) a[p.topic] = (a[p.topic] || 0) + w;
    try { window.localStorage.setItem(AFF_KEY, JSON.stringify(a)); } catch { /* ignoré */ }
    setAffVersion(v => v + 1);
  }, []);

  /* ═════ Échelle : la maquette (1258 px) s'ajuste au conteneur ═════ */
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const [box, setBox] = useState({ w: 0, h: 0 });
  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const read = () => setBox({ w: el.clientWidth, h: el.clientHeight });
    read();
    const ro = new ResizeObserver(read);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const scale = box.w ? Math.min(1, box.w / STAGE_W) : 1;

  /** Communications IA de l'entreprise. */
  useEffect(() => {
    let dead = false;
    const load = () => {
      fetch(`/api/ai-comms?companyId=${encodeURIComponent(companyId)}&platform=${encodeURIComponent(platform)}&limit=50`)
        .then(r => r.json())
        .then((d: any) => {
          if (dead) return;
          setApiPosts(Array.isArray(d?.posts) ? d.posts : []);
          setTotals(d?.totals && typeof d.totals === 'object' ? d.totals : {});
        })
        .catch(() => {});
    };
    load();
    const t = setInterval(load, 30000);
    return () => { dead = true; clearInterval(t); };
  }, [companyId, platform]);

  /** Vrais posts X (vidéos incluses). */
  useEffect(() => {
    let dead = false;
    fetch(`/api/x-feed?ids=${X_IDS.join(',')}`)
      .then(r => r.json())
      .then((d: any) => { if (!dead) setXPosts(Array.isArray(d?.posts) ? d.posts : []); })
      .catch(() => {});
    return () => { dead = true; };
  }, []);

  const real = useMemo<Post[]>(() => xPosts.map(p => {
    const m = p.media[0];
    const media: Media | undefined = m
      ? m.type === 'photo'
        ? { photo: px(m.poster), ratio: m.width && m.height ? m.width / m.height : undefined }
        : { video: px(m.mp4 || undefined), poster: px(m.poster), duration: m.durationMs ? dur(m.durationMs) : undefined }
      : undefined;
    return {
      id: 'x' + p.id,
      author: p.author.name,
      handle: '@' + p.author.screenName,
      verified: p.author.verified,
      age: ago(p.createdAt),
      text: p.text,
      avatar: 'av-p1.png',
      avatarUrl: px(p.author.avatar),
      media,
      replies: fmt(p.stats.replies),
      reposts: fmt(p.stats.reposts),
      likes: fmt(p.stats.likes),
      views: fmt(p.stats.views || p.stats.likes * 40),
      likesN: p.stats.likes,
      repostsN: p.stats.reposts,
      url: p.url,
      real: true,
    };
  }), [xPosts]);

  const all = useMemo<Post[]>(() => {
    const ai: Post[] = apiPosts.filter(p => p.content).map(p => ({
      id: p.id, author: 'Velbaz', handle: '@velbaz_ia', verified: true, age: ago(p.publishedAt || p.createdAt),
      text: p.content, avatar: 'av-me.png',
      replies: fmt(p.reponses), reposts: fmt(Math.round((p.engagements || 0) / 3)), likes: fmt(p.engagements), views: fmt(p.vues),
    }));
    return [...mine, ...ai, ...real, ...BASE_POSTS];
  }, [apiPosts, mine, real]);

  const searched = useCallback((list: Post[]) => {
    const q = query.trim().toLowerCase();
    if (!q) return list;
    return list.filter(p => (p.text + ' ' + p.author + ' ' + p.handle).toLowerCase().includes(q));
  }, [query]);

  const homePosts = useMemo<Post[]>(() => {
    const list = tab === 'following'
      ? all.filter(p => following[p.handle] || p.handle === '@' + identity)
      : all;
    return searched(list);
  }, [all, tab, following, identity, searched]);

  /** Le fil se répète en boucle (ids uniques) : défilement infini comme X. */
  const feed = useMemo<Post[]>(() => {
    if (!homePosts.length) return homePosts;
    const out: Post[] = [];
    for (let i = 0; i < feedPages; i++) {
      for (const p of homePosts) out.push(i === 0 ? p : { ...p, id: `${p.id}~${i}` });
    }
    return out;
  }, [homePosts, feedPages]);

  /**
   * Ordre affiché du fil : mes posts en tête, puis les vidéos de l'algorithme,
   * puis le reste mélangé avec le seed de la session — le début du fil n'est
   * donc jamais deux fois le même quand on entre dans X.
   */
  const feedOrder = useMemo<Post[]>(() => {
    const me = '@' + identity;
    const mineFirst = homePosts.filter(p => p.handle === me);
    const rest = shuffleSeeded(homePosts.filter(p => p.handle !== me), sessionSeed.current);
    const head = rest.slice(0, HEAD_STATIC);
    const tail = rest.slice(HEAD_STATIC);
    // Les nouvelles vidéos de l'algorithme s'ajoutent TOUJOURS à la fin : en bas
    // du fil on ne retombe plus sur les anciens posts, on charge la suite.
    return [...mineFirst, ...head, ...algoPosts, ...(FEED_STATIC_TAIL ? tail : [])];
  }, [homePosts, algoPosts, identity]);

  /** Retour au début du fil quand on change d'onglet, de recherche ou de page. */
  useEffect(() => { setFeedPages(1); setMore(false); loadingMore.current = false; }, [tab, query, nav]);

  /**
   * Charge la suite du fil auprès de l'algorithme : de vraies vidéos X choisies
   * au hasard dans le vivier, classées par affinité, jamais déjà vues (seen).
   */
  const loadMore = useCallback(async () => {
    const aff = Object.entries(affRef.current)
      .sort((a, b) => b[1] - a[1]).slice(0, 40)
      .map(([k, v]) => `${k}:${Math.round(v * 100) / 100}`).join(',');
    const ask = async () => {
      // TOUS les ids déjà affichés partent au serveur : aucun post, aucune
      // vidéo ne peut revenir une seconde fois dans le fil.
      const seen = [...seenIds.current].join(',');
      const u = `/api/x-algo?n=6&video=1${seen ? `&seen=${encodeURIComponent(seen)}` : ''}${aff ? `&aff=${encodeURIComponent(aff)}` : ''}`;
      const r = await fetch(u);
      const d: any = await r.json();
      return Array.isArray(d?.posts) ? (d.posts as any[]) : [];
    };
    let list = await ask();
    if (!list.length) {
      // Vivier épuisé : on va chercher de VRAIES nouvelles vidéos sur le
      // fediverse, puis on redemande. Jamais de recyclage.
      try { await fetch('/api/x-vids-stats?grow=1'); } catch { /* réseau */ }
      list = await ask();
    }
    const mapped: Post[] = [];
    for (const p of list) {
      if (seenIds.current.has(p.id)) continue;
      seenIds.current.add(p.id);
      const m = p.media?.[0];
      const media: Media | undefined = m
        ? m.type === 'photo'
          ? { photo: px(m.poster), ratio: m.width && m.height ? m.width / m.height : undefined }
          : { video: px(m.mp4 || undefined), poster: px(m.poster), duration: m.durationMs ? dur(m.durationMs) : undefined, sensitive: !!p.sensitive }
        : undefined;
      mapped.push({
        id: 'a' + p.id,
        author: p.author?.name || p.author?.screenName || 'X',
        handle: '@' + (p.author?.screenName || 'x'),
        verified: !!p.author?.verified,
        age: ago(p.createdAt),
        text: p.text || '',
        avatar: 'av-p1.png',
        avatarUrl: px(p.author?.avatar),
        media,
        replies: fmt(p.stats?.replies || 0),
        reposts: fmt(p.stats?.reposts || 0),
        likes: fmt(p.stats?.likes || 0),
        views: fmt(p.stats?.views || (p.stats?.likes || 0) * 40),
        likesN: p.stats?.likes || 0,
        repostsN: p.stats?.reposts || 0,
        url: p.url,
        real: true,
        topic: p.topic,
      });
    }
    // Filet de sécurité : `seen` n'emporte que les 150 derniers ids, le serveur
    // peut donc renvoyer des posts déjà affichés → mapped vide → le fil restait
    // bloqué sur le chargement à l'infini. On rejoue alors la liste avec des ids
    // neufs pour que le fil avance TOUJOURS.
    if (!mapped.length && list.length) {
      const round = ++algoRound.current;
      for (const p of list) {
        const m = p.media?.[0];
        const media: Media | undefined = m
          ? m.type === 'photo'
            ? { photo: px(m.poster), ratio: m.width && m.height ? m.width / m.height : undefined }
            : { video: px(m.mp4 || undefined), poster: px(m.poster), duration: m.durationMs ? dur(m.durationMs) : undefined, sensitive: !!p.sensitive }
          : undefined;
        mapped.push({
          id: 'a' + p.id + '~' + round,
          author: p.author?.name || p.author?.screenName || 'X',
          handle: '@' + (p.author?.screenName || 'x'),
          verified: !!p.author?.verified,
          age: ago(p.createdAt),
          text: p.text || '',
          avatar: 'av-p1.png',
          avatarUrl: px(p.author?.avatar),
          media,
          replies: fmt(p.stats?.replies || 0),
          reposts: fmt(p.stats?.reposts || 0),
          likes: fmt(p.stats?.likes || 0),
          views: fmt(p.stats?.views || (p.stats?.likes || 0) * 40),
          likesN: p.stats?.likes || 0,
          repostsN: p.stats?.reposts || 0,
          url: p.url,
          real: true,
          topic: p.topic,
        });
      }
    }
    if (mapped.length) setAlgoPosts(a => [...a, ...mapped]);
    return mapped.length;
  }, []);

  /** Premier lot dès l'ouverture du fil. */
  useEffect(() => {
    if (nav !== 'home' || algoPosts.length) return;
    loadMore().catch(() => {});
  }, [nav, algoPosts.length, loadMore]);

  /**
   * Défilement de la colonne centrale : à 2200 px du bas on précharge la suite,
   * donc le fil a déjà grandi avant que l'utilisateur touche la zone de
   * chargement → plus d'arrêt sur le spinner, et le défilement reste fluide.
   */
  const onFeedScroll = useCallback((el: HTMLDivElement) => {
    if (loadingMore.current) return;
    if (el.scrollHeight - el.scrollTop - el.clientHeight > 2200) return;
    if (Date.now() - lastLoad.current < 600) return; // anti-rafale
    loadingMore.current = true;
    lastLoad.current = Date.now();
    setMore(true);
    (FEED_LOOP
      ? Promise.resolve(setFeedPages(n => n + 1))
      : loadMore()
    ).catch(() => {}).finally(() => {
      setMore(false);
      lastLoad.current = Date.now();
      loadingMore.current = false;
    });
  }, [loadMore]);

  const publish = useCallback(() => {
    const t = draft.trim();
    if (!t) return;
    setMine(p => [{
      id: 'm' + Date.now(), author: 'Alex Smith', handle: '@' + identity, verified: false, age: 'now',
      text: t, avatar: 'av-account.png', replies: '0', reposts: '0', likes: '0', views: '1',
    }, ...p]);
    setDraft('');
    setNav('home');
    setTab('foryou');
    setOpen(null);
  }, [draft, identity]);

  const count = (p: Post, kind: 'likes' | 'reposts') => {
    const on = kind === 'likes' ? liked[p.id] : reposted[p.id];
    const base = kind === 'likes' ? p.likesN : p.repostsN;
    if (base != null) return fmt(base + (on ? 1 : 0));
    const raw = Number(kind === 'likes' ? p.likes : p.reposts);
    return Number.isFinite(raw) ? fmt(raw + (on ? 1 : 0)) : (kind === 'likes' ? p.likes : p.reposts);
  };

  const go = (id: string) => { setNav(id); setOpen(null); };

  /* ═════ Briques de rendu ═════ */

  const Avatar = ({ p, size = 40 }: { p: Post; size?: number }) => (
    <img
      src={p.avatarUrl || A + p.avatar}
      alt=""
      width={size}
      height={size}
      style={{ width: size, height: size, borderRadius: 9999, flexShrink: 0, objectFit: 'cover', background: C.line }}
      onError={e => { (e.currentTarget as HTMLImageElement).src = A + p.avatar; }}
    />
  );

  const Action = ({ p, detail = false }: { p: Post; detail?: boolean }) => (
    <div style={{ ...row, justifyContent: 'space-between', maxWidth: detail ? '100%' : 425, marginTop: 12 }}>
      <button
        onClick={e => { e.stopPropagation(); setOpen(p); }}
        style={{ ...row, gap: 4, color: C.dim, fontSize: 13, border: 'none', background: 'transparent', cursor: 'pointer', padding: 0, fontFamily: X_FONT }}
      >
        <Ico src="a-reply.png" size={18.75} /><span>{p.replies}</span>
      </button>
      <button
        onClick={e => { e.stopPropagation(); bump(p, AFF_WEIGHT.repost); setReposted(s => ({ ...s, [p.id]: !s[p.id] })); }}
        style={{ ...row, gap: 4, color: reposted[p.id] ? C.green : C.dim, fontSize: 13, border: 'none', background: 'transparent', cursor: 'pointer', padding: 0, fontFamily: X_FONT }}
      >
        <Ico src="a-repost.png" size={18.75} /><span>{count(p, 'reposts')}</span>
      </button>
      <button
        onClick={e => { e.stopPropagation(); bump(p, AFF_WEIGHT.like); setLiked(s => ({ ...s, [p.id]: !s[p.id] })); }}
        style={{ ...row, gap: 4, color: liked[p.id] ? C.red : C.dim, fontSize: 13, border: 'none', background: 'transparent', cursor: 'pointer', padding: 0, fontFamily: X_FONT }}
      >
        {liked[p.id] ? <span style={{ fontSize: 17, lineHeight: '18px' }}>♥</span> : <Ico src="a-like.png" size={18.75} />}
        <span>{count(p, 'likes')}</span>
      </button>
      <span style={{ ...row, gap: 4, color: C.dim, fontSize: 13 }}>
        <Ico src="a-views.png" size={18.75} /><span>{p.views}</span>
      </span>
      <span style={{ ...row, gap: 12 }}>
        <button
          onClick={e => { e.stopPropagation(); setMarked(s => ({ ...s, [p.id]: !s[p.id] })); }}
          style={{ border: 'none', background: 'transparent', cursor: 'pointer', padding: 0, filter: marked[p.id] ? 'none' : 'grayscale(1)' }}
        >
          <Ico src="a-bookmark.png" size={18.75} />
        </button>
        <button
          onClick={e => { e.stopPropagation(); if (p.url) window.open(p.url, '_blank', 'noopener'); }}
          style={{ border: 'none', background: 'transparent', cursor: 'pointer', padding: 0 }}
        >
          <Ico src="a-share.png" size={18.75} />
        </button>
      </span>
    </div>
  );

  const Row = ({ p }: { p: Post }) => (
    <article
      onClick={() => { bump(p, AFF_WEIGHT.open); setOpen(p); }}
      style={{ display: 'flex', gap: 12, padding: '12px 16px', borderBottom: `1px solid ${C.line}`, cursor: 'pointer' }}
      onMouseEnter={e => (e.currentTarget.style.background = C.hover)}
      onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
    >
      <Avatar p={p} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ ...row, gap: 4 }}>
          <span style={{ fontSize: 15, fontWeight: 700, lineHeight: '20px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: 260 }}>{p.author}</span>
          {p.verified && <Verified />}
          {p.emoji && <span style={{ fontSize: 15 }}>{p.emoji}</span>}
          <span style={{ fontSize: 15, color: C.dim, lineHeight: '20px' }}>{p.handle}</span>
          <span style={{ fontSize: 15, color: C.dim, lineHeight: '20px' }}>· {p.age}</span>
          <span style={{ marginLeft: 'auto', ...row, gap: 12 }}>
            <Ico src="p-analytics.png" size={18.75} />
            <Ico src="p-dots.png" size={18.75} />
          </span>
        </div>
        <p style={{ margin: '2px 0 0', fontSize: 15, lineHeight: '20px', whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>{p.text}</p>
        {p.media && <PostMedia media={p.media} onMax={() => setMaxPost(p)} />}
        <Action p={p} />
      </div>
    </article>
  );

  const Header = ({ title, sub, back = true }: { title: string; sub?: string; back?: boolean }) => (
    <div style={{ ...row, gap: 20, minHeight: 53, padding: '0 16px', position: 'sticky', top: 0, zIndex: 3, background: 'rgba(0,0,0,0.65)', backdropFilter: 'blur(12px)', borderBottom: `1px solid ${C.line}` }}>
      {back && (
        <button onClick={() => go('home')} style={{ border: 'none', background: 'transparent', cursor: 'pointer', fontSize: 19, color: C.text, padding: 0, fontFamily: X_FONT }}>←</button>
      )}
      <div>
        <p style={{ margin: 0, fontSize: 20, fontWeight: 800, lineHeight: '24px' }}>{title}</p>
        {sub && <p style={{ margin: 0, fontSize: 13, color: C.dim, lineHeight: '16px' }}>{sub}</p>}
      </div>
    </div>
  );

  const Tabs = <T extends string>({ items, value, onChange }: { items: [T, string][]; value: T; onChange: (v: T) => void }) => (
    <div style={{ display: 'flex', borderBottom: `1px solid ${C.line}`, position: 'sticky', top: 53, zIndex: 2, background: C.bg }}>
      {items.map(([id, label]) => (
        <button
          key={id}
          onClick={() => onChange(id)}
          style={{ flex: 1, height: 53, border: 'none', background: 'transparent', cursor: 'pointer', position: 'relative', fontFamily: X_FONT }}
          onMouseEnter={e => (e.currentTarget.style.background = C.hover)}
          onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
        >
          <span style={{ fontSize: 15, fontWeight: 700, color: value === id ? C.text : C.dim }}>{label}</span>
          {value === id && <span style={{ position: 'absolute', bottom: 0, left: '50%', transform: 'translateX(-50%)', width: 56, height: 4, borderRadius: 9999, background: C.blue }} />}
        </button>
      ))}
    </div>
  );

  const Empty = ({ text }: { text: string }) => (
    <div style={{ padding: '32px 16px', color: C.dim, fontSize: 15 }}>{text}</div>
  );

  const Stat = ({ label, value }: { label: string; value: string }) => (
    <div style={{ flex: 1, padding: '12px 16px', borderRight: `1px solid ${C.line}` }}>
      <p style={{ margin: 0, fontSize: 13, color: C.dim }}>{label}</p>
      <p style={{ margin: '2px 0 0', fontSize: 24, fontWeight: 800, lineHeight: '28px' }}>{value}</p>
    </div>
  );

  /* ═════ Pages ═════ */

  const pageHome = (
    <>
      <div style={{ display: 'flex', position: 'sticky', top: 0, zIndex: 3, background: 'rgba(0,0,0,0.65)', backdropFilter: 'blur(12px)', borderBottom: `1px solid ${C.line}` }}>
        {([['foryou', 'For you'], ['following', 'Following']] as const).map(([id, label]) => (
          <button
            key={id}
            onClick={() => setTab(id)}
            style={{ flex: 1, height: 53, border: 'none', background: 'transparent', cursor: 'pointer', position: 'relative', fontFamily: X_FONT }}
            onMouseEnter={e => (e.currentTarget.style.background = C.hover)}
            onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
          >
            <span style={{ fontSize: 15, fontWeight: 700, color: tab === id ? C.text : C.dim }}>{label}</span>
            {tab === id && <span style={{ position: 'absolute', bottom: 0, left: '50%', transform: 'translateX(-50%)', width: 56, height: 4, borderRadius: 9999, background: C.blue }} />}
          </button>
        ))}
      </div>

      <div style={{ display: 'flex', gap: 12, padding: '4px 16px 12px', borderBottom: `1px solid ${C.line}` }}>
        <img src={A + 'av-account.png'} alt="" width={40} height={40} style={{ width: 40, height: 40, borderRadius: 9999, marginTop: 12 }} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <textarea
            value={draft}
            onChange={e => setDraft(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) publish(); }}
            placeholder="What’s happening?"
            rows={1}
            style={{
              width: '100%', border: 'none', outline: 'none', resize: 'none', background: 'transparent',
              fontSize: 20, lineHeight: '24px', color: C.text, padding: '20px 0 12px', fontFamily: X_FONT,
              height: draft.length > 70 ? 72 : 64,
            }}
          />
          <div style={{ ...row, justifyContent: 'space-between' }}>
            <div style={{ ...row, gap: 4 }}>
              {COMPOSER_ICONS.map(ic => (
                <span key={ic} style={{ width: 34, height: 34, borderRadius: 9999, display: 'grid', placeItems: 'center', cursor: 'pointer' }}
                  onMouseEnter={e => (e.currentTarget.style.background = 'rgba(29,155,240,0.1)')}
                  onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
                >
                  <Ico src={ic} size={20} />
                </span>
              ))}
            </div>
            <button
              onClick={publish}
              disabled={!draft.trim()}
              style={{
                height: 36, padding: '0 16px', borderRadius: 9999, border: 'none', fontSize: 15, fontWeight: 700, fontFamily: X_FONT,
                background: draft.trim() ? C.btn : '#3e4144', color: draft.trim() ? C.btnText : '#0f1419',
                cursor: draft.trim() ? 'pointer' : 'default',
              }}
            >
              Post
            </button>
          </div>
        </div>
      </div>

      {tab === 'following' && homePosts.length === 0 && !query ? (
        <div style={{ padding: '32px 32px 0', maxWidth: 420 }}>
          <h2 style={{ margin: 0, fontSize: 31, fontWeight: 800, lineHeight: '36px' }}>Welcome to X!</h2>
          <p style={{ margin: '8px 0 28px', fontSize: 15, lineHeight: '20px', color: C.dim }}>
            This is the best place to see what’s happening in your world. Find some people and topics to follow now.
          </p>
          <button
            onClick={() => go('follow')}
            style={{ height: 40, padding: '0 24px', borderRadius: 9999, border: 'none', background: C.blue, color: '#fff', fontSize: 15, fontWeight: 700, cursor: 'pointer', fontFamily: X_FONT }}
          >
            Let’s go!
          </button>
        </div>
      ) : (
        <>
          {(FEED_LOOP ? feed : feedOrder).map(p => <Row key={p.id} p={p} />)}
          {homePosts.length + algoPosts.length === 0 && <Empty text={query ? `Aucun résultat pour « ${query} »` : 'Rien à afficher ici pour l’instant.'} />}
          {homePosts.length + algoPosts.length > 0 && (
            <div style={{ display: 'grid', placeItems: 'center', padding: '20px 0 28px', borderTop: `1px solid ${C.line}` }}>
              <span style={{ width: 26, height: 26, borderRadius: 9999, border: `3px solid ${C.blue}`, borderTopColor: 'transparent', display: 'block', animation: 'xclspin 0.8s linear infinite', opacity: more ? 1 : 0.55 }} />
            </div>
          )}
        </>
      )}
    </>
  );

  const mediaPosts = all.filter(p => p.media);

  const NewsList = ({ items }: { items: { title: string; meta: string; av: string }[] }) => (
    <>
      {items.map(n => (
        <div key={n.title} style={{ padding: '12px 16px', cursor: 'pointer' }}
          onClick={() => { setQuery(n.title.split(' ').slice(0, 2).join(' ')); go('home'); }}
          onMouseEnter={e => (e.currentTarget.style.background = C.hover)}
          onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
        >
          <p style={{ margin: 0, fontSize: 15, fontWeight: 700, lineHeight: '20px' }}>{n.title}</p>
          <div style={{ ...row, gap: 6, marginTop: 6 }}>
            <img src={A + n.av} alt="" style={{ height: 20, display: 'block' }} />
            <span style={{ fontSize: 13, color: C.dim }}>{n.meta}</span>
          </div>
        </div>
      ))}
    </>
  );

  const TrendRow = ({ n, cat, topic }: { n?: number; cat: string; topic: string }) => (
    <div style={{ padding: '12px 16px', cursor: 'pointer', position: 'relative' }}
      onClick={() => { setQuery(topic.replace('#', '')); go('home'); }}
      onMouseEnter={e => (e.currentTarget.style.background = C.hover)}
      onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
    >
      <p style={{ margin: 0, fontSize: 13, color: C.dim, lineHeight: '16px' }}>{n ? `${n} · ` : ''}{cat}</p>
      <p style={{ margin: '2px 0 0', fontSize: 15, fontWeight: 700, lineHeight: '20px' }}>{topic}</p>
      <span style={{ position: 'absolute', right: 16, top: 16 }}><Ico src="r-dots.png" size={18.75} /></span>
    </div>
  );

  const pageExplore = (
    <>
      <div style={{ ...row, gap: 12, minHeight: 53, padding: '0 16px', position: 'sticky', top: 0, zIndex: 3, background: 'rgba(0,0,0,0.65)', backdropFilter: 'blur(12px)' }}>
        <div style={{ ...row, gap: 12, flex: 1, height: 42, borderRadius: 9999, background: C.search, padding: '0 16px' }}>
          <Ico src="r-search.png" size={16} />
          <input
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder="Search"
            style={{ flex: 1, border: 'none', outline: 'none', background: 'transparent', fontSize: 15, color: C.text, fontFamily: X_FONT }}
          />
        </div>
        <Ico src="gear.png" size={20} />
      </div>
      <div style={{ display: 'flex', borderBottom: `1px solid ${C.line}`, position: 'sticky', top: 53, zIndex: 2, background: C.bg }}>
        {([['foryou', 'Explore'], ['trending', 'Trending'], ['news', 'News'], ['sports', 'Sports'], ['entertainment', 'Entertainment']] as const).map(([id, label]) => (
          <button key={id} onClick={() => setExploreTab(id)}
            style={{ flex: 1, height: 53, border: 'none', background: 'transparent', cursor: 'pointer', position: 'relative', fontFamily: X_FONT }}
            onMouseEnter={e => (e.currentTarget.style.background = C.hover)}
            onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
          >
            <span style={{ fontSize: 15, fontWeight: 700, color: exploreTab === id ? C.text : C.dim }}>{label}</span>
            {exploreTab === id && <span style={{ position: 'absolute', bottom: 0, left: '50%', transform: 'translateX(-50%)', width: 56, height: 4, borderRadius: 9999, background: C.blue }} />}
          </button>
        ))}
      </div>

      {exploreTab === 'foryou' && (
        <>
          <h2 style={{ margin: 0, padding: '12px 16px 4px', fontSize: 20, fontWeight: 800, lineHeight: '24px' }}>Today’s News</h2>
          <NewsList items={EXPLORE_NEWS} />
          <div style={{ borderTop: `1px solid ${C.line}`, marginTop: 4 }} />
          {TRENDING_LIST.map(t => <TrendRow key={t.topic} cat={t.cat} topic={t.topic} />)}
        </>
      )}

      {exploreTab === 'trending' && (
        <>
          <div style={{ margin: 12, borderRadius: 16, overflow: 'hidden', position: 'relative', cursor: 'pointer' }} onClick={() => setExploreTab('foryou')}>
            <img src={D + 'banner-global.png'} alt="" style={{ display: 'block', width: '100%' }} />
          </div>
          {TRENDING_LIST.map((t, i) => <TrendRow key={t.topic} n={i + 1} cat={t.cat} topic={t.topic} />)}
        </>
      )}

      {exploreTab === 'news' && <NewsList items={NEWS_TAB} />}

      {exploreTab === 'sports' && (
        <>
          <div style={{ ...row, gap: 12, margin: 12, padding: 12, borderRadius: 12, background: C.card, cursor: 'pointer' }}>
            <img src={D + 'nfl-logo.png'} alt="" style={{ height: 26, display: 'block' }} />
            <div style={{ flex: 1 }}>
              <p style={{ margin: 0, fontSize: 15, fontWeight: 700, lineHeight: '20px' }}>NFL</p>
              <p style={{ margin: 0, fontSize: 13, color: C.dim }}>Scores, players, and highlights</p>
            </div>
            <span style={{ color: C.dim, fontSize: 17 }}>›</span>
          </div>
          <div style={{ margin: '0 12px', borderRadius: 16, overflow: 'hidden', position: 'relative' }}>
            <img src={D + 'banner-nfl.png'} alt="" style={{ display: 'block', width: '100%' }} />
          </div>
          <div style={{ height: 12 }} />
          <NewsList items={SPORTS_TAB} />
        </>
      )}

      {exploreTab === 'entertainment' && <NewsList items={ENTERTAINMENT_TAB} />}
    </>
  );

  const notifs = useMemo(() => {
    const items: { id: string; icon: string; text: string; post?: Post; who: Post }[] = [];
    all.forEach(p => {
      if (liked[p.id]) items.push({ id: 'l' + p.id, icon: '♥', text: 'Tu as aimé ce post', post: p, who: p });
      if (reposted[p.id]) items.push({ id: 'r' + p.id, icon: '⇄', text: 'Tu as reposté ce post', post: p, who: p });
      if (marked[p.id]) items.push({ id: 'b' + p.id, icon: '🔖', text: 'Ajouté à tes signets', post: p, who: p });
    });
    real.slice(0, 4).forEach(p => items.push({ id: 'f' + p.id, icon: '👤', text: `${p.author} a un nouveau post qui monte`, post: p, who: p }));
    return items;
  }, [all, real, liked, reposted, marked]);

  const notifShown = notifs.filter(n => (notifTab === 'mentions' ? !!n.post?.text.includes('@') : true));
  const pageNotif = (
    <>
      <div style={{ ...row, justifyContent: 'space-between', minHeight: 53, padding: '0 16px', position: 'sticky', top: 0, zIndex: 3, background: 'rgba(0,0,0,0.65)', backdropFilter: 'blur(12px)' }}>
        <p style={{ margin: 0, fontSize: 20, fontWeight: 800, lineHeight: '24px' }}>Notifications</p>
        <Ico src="gear.png" size={20} />
      </div>
      <div style={{ display: 'flex', borderBottom: `1px solid ${C.line}`, position: 'sticky', top: 53, zIndex: 2, background: C.bg }}>
        {([['all', 'All'], ['mentions', 'Mentions']] as const).map(([id, label]) => (
          <button key={id} onClick={() => setNotifTab(id)}
            style={{ flex: 1, height: 53, border: 'none', background: 'transparent', cursor: 'pointer', position: 'relative', fontFamily: X_FONT }}
            onMouseEnter={e => (e.currentTarget.style.background = C.hover)}
            onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
          >
            <span style={{ fontSize: 15, fontWeight: 700, color: notifTab === id ? C.text : C.dim }}>{label}</span>
            {notifTab === id && <span style={{ position: 'absolute', bottom: 0, left: '50%', transform: 'translateX(-50%)', width: 56, height: 4, borderRadius: 9999, background: C.blue }} />}
          </button>
        ))}
      </div>
      {notifShown.map(n => (
        <div key={n.id} onClick={() => n.post && setOpen(n.post)} style={{ display: 'flex', gap: 12, padding: '12px 16px', borderBottom: `1px solid ${C.line}`, cursor: 'pointer' }}
          onMouseEnter={e => (e.currentTarget.style.background = C.hover)}
          onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
        >
          <span style={{ fontSize: 20, width: 26, textAlign: 'center' }}>{n.icon}</span>
          <div style={{ minWidth: 0, flex: 1 }}>
            <Avatar p={n.who} size={32} />
            <p style={{ margin: '6px 0 0', fontSize: 15, fontWeight: 700 }}>{n.text}</p>
            {n.post && <p style={{ margin: '2px 0 0', fontSize: 15, color: C.dim, lineHeight: '20px', maxHeight: 40, overflow: 'hidden' }}>{n.post.text}</p>}
          </div>
        </div>
      ))}
      {notifShown.length === 0 && (
        <div style={{ padding: '48px 32px 0' }}>
          <h2 style={{ margin: 0, fontSize: 31, fontWeight: 800, lineHeight: '36px', maxWidth: 340 }}>Nothing to see here — yet</h2>
          <p style={{ margin: '12px 0 0', fontSize: 15, color: C.dim, lineHeight: '20px', maxWidth: 380 }}>
            {notifTab === 'mentions' ? 'When someone mentions you, you’ll find it here.' : 'From likes to reposts and a whole lot more, this is where all the action happens.'}
          </p>
        </div>
      )}
    </>
  );

  const suggestions = useMemo(() => {
    const seen = new Set<string>();
    const out: Post[] = [];
    [...real, ...BASE_POSTS].forEach(p => { if (!seen.has(p.handle)) { seen.add(p.handle); out.push(p); } });
    return out;
  }, [real]);

  const pageFollow = (
    <>
      <div style={{ ...row, gap: 20, minHeight: 53, padding: '0 16px', position: 'sticky', top: 0, zIndex: 3, background: 'rgba(0,0,0,0.65)', backdropFilter: 'blur(12px)' }}>
        <button onClick={() => go('home')} style={{ border: 'none', background: 'transparent', cursor: 'pointer', fontSize: 19, color: C.text, padding: 0, fontFamily: X_FONT }}>←</button>
        <p style={{ margin: 0, fontSize: 20, fontWeight: 800, lineHeight: '24px', flex: 1 }}>Follow</p>
        <Ico src="gear.png" size={20} />
      </div>
      <div style={{ display: 'flex', borderBottom: `1px solid ${C.line}`, position: 'sticky', top: 53, zIndex: 2, background: C.bg }}>
        {([['who', 'Who to follow'], ['creators', 'Creators for you']] as const).map(([id, label]) => (
          <button key={id} onClick={() => setFollowTab(id)}
            style={{ flex: 1, height: 53, border: 'none', background: 'transparent', cursor: 'pointer', position: 'relative', fontFamily: X_FONT }}
            onMouseEnter={e => (e.currentTarget.style.background = C.hover)}
            onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
          >
            <span style={{ fontSize: 15, fontWeight: 700, color: followTab === id ? C.text : C.dim }}>{label}</span>
            {followTab === id && <span style={{ position: 'absolute', bottom: 0, left: '50%', transform: 'translateX(-50%)', width: 56, height: 4, borderRadius: 9999, background: C.blue }} />}
          </button>
        ))}
      </div>
      {followTab === 'creators' && CREATORS.map(cr => (
        <div key={cr.handle} style={{ display: 'flex', gap: 12, padding: '12px 16px' }}
          onMouseEnter={e => (e.currentTarget.style.background = C.hover)}
          onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
        >
          <img src={D + cr.av} alt="" width={40} height={40} style={{ width: 40, height: 40, borderRadius: 9999, objectFit: 'cover', background: C.card, flexShrink: 0 }} />
          <div style={{ flex: 1, minWidth: 0 }}>
            <p style={{ margin: 0, ...row, gap: 4, fontSize: 15, fontWeight: 700, lineHeight: '20px' }}>
              {cr.name}<Verified />{cr.badge && <span style={{ fontSize: 12, background: C.card, borderRadius: 4, padding: '0 3px' }}>{cr.badge}</span>}
            </p>
            <p style={{ margin: 0, fontSize: 15, color: C.dim, lineHeight: '20px' }}>{cr.handle}</p>
            {cr.bio && <p style={{ margin: '4px 0 0', fontSize: 15, lineHeight: '20px' }}>{cr.bio}</p>}
            {cr.link && <p style={{ margin: '2px 0 0', fontSize: 15, color: C.blue, lineHeight: '20px' }}>{cr.link}</p>}
          </div>
          <button
            onClick={() => setFollowing(f => ({ ...f, [cr.handle]: !f[cr.handle] }))}
            style={{ height: 32, alignSelf: 'flex-start', padding: '0 16px', borderRadius: 9999, border: following[cr.handle] ? `1px solid ${C.line}` : 'none', background: following[cr.handle] ? 'transparent' : C.btn, color: following[cr.handle] ? C.text : C.btnText, fontSize: 14, fontWeight: 700, cursor: 'pointer', fontFamily: X_FONT, whiteSpace: 'nowrap' }}
          >
            {following[cr.handle] ? 'Subscribed' : 'Subscribe'}
          </button>
        </div>
      ))}
      {followTab === 'who' && <h2 style={{ margin: 0, padding: '12px 16px 4px', fontSize: 20, fontWeight: 800, lineHeight: '24px' }}>Suggested for you</h2>}
      {followTab === 'who' && SUGGESTED.map(sg => (
        <div key={sg.handle} style={{ display: 'flex', gap: 12, padding: '12px 16px' }}
          onMouseEnter={e => (e.currentTarget.style.background = C.hover)}
          onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
        >
          <img src={D + sg.av} alt="" width={40} height={40} style={{ width: 40, height: 40, borderRadius: 9999, objectFit: 'cover', background: C.card, flexShrink: 0 }} />
          <div style={{ flex: 1, minWidth: 0 }}>
            <p style={{ margin: 0, ...row, gap: 4, fontSize: 15, fontWeight: 700, lineHeight: '20px' }}>
              {sg.name}<Verified />{sg.gold && <span style={{ fontSize: 13 }}>🟧</span>}
            </p>
            <p style={{ margin: 0, fontSize: 15, color: C.dim, lineHeight: '20px' }}>{sg.handle}</p>
            {sg.link && <p style={{ margin: '2px 0 0', fontSize: 15, color: C.blue, lineHeight: '20px' }}>{sg.link}</p>}
            {sg.bio && <p style={{ margin: '4px 0 0', fontSize: 15, lineHeight: '20px' }}>{sg.bio}</p>}
          </div>
          <button
            onClick={() => setFollowing(f => ({ ...f, [sg.handle]: !f[sg.handle] }))}
            style={{ height: 32, alignSelf: 'flex-start', padding: '0 16px', borderRadius: 9999, border: following[sg.handle] ? `1px solid ${C.line}` : 'none', background: following[sg.handle] ? 'transparent' : C.btn, color: following[sg.handle] ? C.text : C.btnText, fontSize: 14, fontWeight: 700, cursor: 'pointer', fontFamily: X_FONT }}
          >
            {following[sg.handle] ? 'Following' : 'Follow'}
          </button>
        </div>
      ))}
      <div style={{ borderTop: `1px solid ${C.line}` }} />
      {FOLLOW_EXTRA && suggestions.map(pp => (
        <div key={pp.handle} style={{ display: 'flex', gap: 12, padding: '12px 16px' }}>
          <Avatar p={pp} />
          <div style={{ flex: 1, minWidth: 0 }}>
            <p style={{ margin: 0, ...row, gap: 4, fontSize: 15, fontWeight: 700, lineHeight: '20px' }}>{pp.author}{pp.verified && <Verified />}</p>
            <p style={{ margin: 0, fontSize: 15, color: C.dim, lineHeight: '20px' }}>{pp.handle}</p>
            <p style={{ margin: '4px 0 0', fontSize: 15, lineHeight: '20px', maxHeight: 40, overflow: 'hidden' }}>{pp.text}</p>
          </div>
          <button
            onClick={() => setFollowing(f => ({ ...f, [pp.handle]: !f[pp.handle] }))}
            style={{ height: 32, alignSelf: 'flex-start', padding: '0 16px', borderRadius: 9999, border: following[pp.handle] ? `1px solid ${C.line}` : 'none', background: following[pp.handle] ? 'transparent' : C.btn, color: following[pp.handle] ? C.text : C.btnText, fontSize: 14, fontWeight: 700, cursor: 'pointer', fontFamily: X_FONT }}
          >
            {following[pp.handle] ? 'Following' : 'Follow'}
          </button>
        </div>
      ))}
    </>
  );

  const chatKeys = Object.keys(chats);
  const pageChat = (
    <>
      <Header title={chatWith ? chatWith : 'Messages'} sub={chatWith ? undefined : `${chatKeys.length} conversations`} />
      {!chatWith ? (
        chatKeys.map(k => {
          const who = all.find(p => p.handle === k) || BASE_POSTS[0];
          const last = chats[k][chats[k].length - 1];
          return (
            <div key={k} onClick={() => setChatWith(k)} style={{ display: 'flex', gap: 12, padding: '12px 16px', borderBottom: `1px solid ${C.line}`, cursor: 'pointer' }}
              onMouseEnter={e => (e.currentTarget.style.background = C.hover)}
              onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
            >
              <Avatar p={who} />
              <div style={{ minWidth: 0, flex: 1 }}>
                <p style={{ margin: 0, fontSize: 15, fontWeight: 700 }}>{who.author} <span style={{ color: C.dim, fontWeight: 400 }}>{k}</span></p>
                <p style={{ margin: 0, fontSize: 15, color: C.dim, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{last?.me ? 'Toi : ' : ''}{last?.text}</p>
              </div>
            </div>
          );
        })
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', minHeight: 400 }}>
          <button onClick={() => setChatWith(null)} style={{ alignSelf: 'flex-start', margin: 12, border: 'none', background: 'transparent', color: C.blue, fontSize: 15, cursor: 'pointer', fontFamily: X_FONT }}>← Toutes les conversations</button>
          <div style={{ flex: 1, padding: '0 16px', display: 'flex', flexDirection: 'column', gap: 8 }}>
            {chats[chatWith].map((m, i) => (
              <div key={i} style={{ alignSelf: m.me ? 'flex-end' : 'flex-start', maxWidth: 380, background: m.me ? C.blue : '#2f3336', color: '#fff', padding: '10px 14px', borderRadius: 18, fontSize: 15, lineHeight: '20px' }}>
                {m.text}
              </div>
            ))}
          </div>
          <div style={{ ...row, gap: 8, borderTop: `1px solid ${C.line}`, padding: 12, marginTop: 12 }}>
            <input
              value={chatDraft}
              onChange={e => setChatDraft(e.target.value)}
              onKeyDown={e => {
                if (e.key !== 'Enter' || !chatDraft.trim() || !chatWith) return;
                const t = chatDraft.trim();
                setChats(c => ({ ...c, [chatWith]: [...c[chatWith], { me: true, text: t }] }));
                setChatDraft('');
              }}
              placeholder="Start a new message"
              style={{ flex: 1, height: 40, borderRadius: 9999, border: 'none', background: C.search, color: C.text, padding: '0 16px', fontSize: 15, outline: 'none', fontFamily: X_FONT }}
            />
            <button
              onClick={() => {
                const t = chatDraft.trim();
                if (!t || !chatWith) return;
                setChats(c => ({ ...c, [chatWith]: [...c[chatWith], { me: true, text: t }] }));
                setChatDraft('');
              }}
              style={{ height: 36, padding: '0 16px', borderRadius: 9999, border: 'none', background: C.btn, color: C.btnText, fontSize: 15, fontWeight: 700, cursor: 'pointer', fontFamily: X_FONT }}
            >
              Send
            </button>
          </div>
        </div>
      )}
    </>
  );

  const grokAsk = () => {
    const q = grokDraft.trim();
    if (!q) return;
    const stats = `${all.length} posts chargés, ${real.length} venant réellement de X, ${Object.values(liked).filter(Boolean).length} likés.`;
    const answer = /vid[eé]o/i.test(q)
      ? `Les vidéos du fil viennent de l'endpoint public de syndication de X et passent par le proxy /api/x-media. ${stats}`
      : /trend|tendance/i.test(q)
        ? `Tendances actuelles : ${TRENDS.map(t => t.topic).join(', ')}.`
        : /post|publi/i.test(q)
          ? `Écris dans le composeur du fil puis Post (⌘/Ctrl+Entrée). ${stats}`
          : `Voici ce que je vois sur ton fil : ${stats}`;
    setGrokLog(l => [...l, { me: true, text: q }, { me: false, text: answer }]);
    setGrokDraft('');
  };

  const grokBar = (
    <div style={{ width: 500, maxWidth: '100%' }}>
      <div style={{ ...row, gap: 10, height: 44, borderRadius: 9999, background: '#1c1f23', padding: '0 8px 0 14px' }}>
        <span style={{ fontSize: 15, color: C.dim }}>🔗</span>
        <input
          value={grokDraft}
          onChange={e => setGrokDraft(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') grokAsk(); }}
          placeholder="Ask Grok (AI agent)"
          style={{ flex: 1, border: 'none', outline: 'none', background: 'transparent', fontSize: 15, color: C.text, fontFamily: X_FONT }}
        />
        <span style={{ ...row, gap: 4, fontSize: 13, color: C.text, whiteSpace: 'nowrap' }}>✦ Fast ⌄</span>
        <button onClick={grokAsk} style={{ width: 32, height: 32, borderRadius: 9999, border: 'none', background: C.btn, color: C.btnText, cursor: 'pointer', fontSize: 13, display: 'grid', placeItems: 'center', padding: 0 }}>⁝⁝⁝</button>
      </div>
    </div>
  );

  const pageGrok = (
    <div style={{ minHeight: 700, display: 'flex', flexDirection: 'column' }}>
      <div style={{ ...row, justifyContent: 'space-between', padding: '12px 16px' }}>
        <span style={{ fontSize: 15, color: C.text, cursor: 'pointer' }}>⛶</span>
        <div style={{ ...row, gap: 20, fontSize: 13, color: C.text }}>
          <span style={{ ...row, gap: 6, cursor: 'pointer' }}>↺ History</span>
          <span style={{ ...row, gap: 6, cursor: 'pointer' }}>🔒 Private</span>
        </div>
      </div>

      {grokLog.length === 0 ? (
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 26, padding: '0 24px 80px' }}>
          <img src={D + 'grok-title.png'} alt="Grok" style={{ height: 34, display: 'block' }} />
          {grokBar}
          <div style={{ ...row, gap: 14, width: 500, maxWidth: '100%', background: '#111316', border: `1px solid ${C.line}`, borderRadius: 16, padding: '14px 16px' }}>
            <img src={D + 'grok-bot.png'} alt="" width={40} height={40} style={{ width: 40, height: 40, borderRadius: 9999, background: '#fff', flexShrink: 0 }} />
            <div style={{ flex: 1, minWidth: 0 }}>
              <p style={{ margin: 0, fontSize: 15, fontWeight: 700, lineHeight: '20px' }}>Meet Grok Bot</p>
              <p style={{ margin: '2px 0 0', fontSize: 13, color: C.dim, lineHeight: '17px' }}>
                AI teammates you can give real work to. Bots sign in to your tools, use them just like you do, and come back with finished work.
              </p>
            </div>
            <button style={{ height: 32, padding: '0 16px', borderRadius: 9999, border: 'none', background: C.btn, color: C.btnText, fontSize: 14, fontWeight: 700, cursor: 'pointer', fontFamily: X_FONT, whiteSpace: 'nowrap' }}>Learn more</button>
          </div>
        </div>
      ) : (
        <>
          <div style={{ flex: 1, padding: '16px 24px', display: 'flex', flexDirection: 'column', gap: 10 }}>
            {grokLog.map((m, i) => (
              <div key={i} style={{ alignSelf: m.me ? 'flex-end' : 'flex-start', maxWidth: 460, background: m.me ? '#2f3336' : 'transparent', color: C.text, padding: m.me ? '10px 14px' : '2px 0', borderRadius: 18, fontSize: 15, lineHeight: '22px', whiteSpace: 'pre-wrap' }}>
                {m.text}
              </div>
            ))}
          </div>
          <div style={{ display: 'flex', justifyContent: 'center', padding: '0 24px 24px' }}>{grokBar}</div>
        </>
      )}
    </div>
  );

  const PLANS = [
    { name: 'Basic', monthly: '3 €', annual: '32 €', perks: ['Modifier ses posts', 'Posts plus longs', 'Moins de pubs'] },
    { name: 'Premium', monthly: '8 €', annual: '84 €', perks: ['Badge bleu', 'Grok 3', 'Partage de revenus', 'Analytics'] },
    { name: 'Premium+', monthly: '16 €', annual: '168 €', perks: ['Zéro pub dans le fil', 'Grok illimité', 'Radar', 'Boost maximal'] },
  ];

  void PLANS;
  const premiumOverlay = (
    <div style={{ position: 'absolute', inset: 0, zIndex: 40, background: C.bg, display: 'flex', flexDirection: 'column' }}>
      <button onClick={() => go('home')} style={{ position: 'absolute', top: 12, left: 12, width: 34, height: 34, borderRadius: 9999, border: 'none', background: '#181a1d', color: C.text, fontSize: 15, cursor: 'pointer', zIndex: 2 }}>✕</button>

      <div className="xcl-scroll" style={{ flex: 1, overflowY: 'auto', paddingBottom: 8 }}>
        <div style={{ display: 'flex', justifyContent: 'center' }}>
          <img src={D + 'premium-hero.png'} alt="" style={{ height: 140, display: 'block' }} />
        </div>
        <h1 style={{ margin: '10px 0 0', textAlign: 'center', fontSize: 28, fontWeight: 800, lineHeight: '34px' }}>
          Don’t lose <span style={{ color: C.blue }}>50% off</span> your first 2 months
        </h1>

        <div style={{ display: 'flex', justifyContent: 'center', marginTop: 22 }}>
          <div style={{ ...row, background: '#202327', borderRadius: 9999, padding: 3 }}>
            {(['monthly', 'annual'] as const).map(p => (
              <button key={p} onClick={() => setPlan(p)}
                style={{ height: 34, width: 100, borderRadius: 9999, border: 'none', background: plan === p ? C.btn : 'transparent', color: plan === p ? C.btnText : C.dim, fontSize: 14, fontWeight: 700, cursor: 'pointer', fontFamily: X_FONT }}
              >
                {p === 'monthly' ? 'Monthly' : 'Annual'}
              </button>
            ))}
          </div>
        </div>

        <div style={{ display: 'flex', gap: 0, justifyContent: 'center', marginTop: 22, padding: '0 24px' }}>
          {PREMIUM_PLANS.map(pl => (
            <div key={pl.name} style={{ width: 300, background: '#16181c', border: `1px solid ${pl.highlight ? C.blue : 'transparent'}`, borderRadius: 12, padding: '16px 18px 20px' }}>
              <div style={{ ...row, justifyContent: 'space-between' }}>
                <p style={{ margin: 0, fontSize: 18, fontWeight: 800 }}>{pl.name}</p>
                <p style={{ margin: 0, fontSize: 12, color: C.blue, fontWeight: 500 }}>50% off for 2 months</p>
              </div>
              <p style={{ margin: '10px 0 0', fontSize: 26, fontWeight: 700 }}>
                {plan === 'monthly' ? pl.monthly : pl.annual}
                <span style={{ fontSize: 13, color: C.dim, fontWeight: 400 }}>{plan === 'monthly' ? ' / month' : ' / year'}</span>
              </p>
              <div style={{ marginTop: 14, display: 'flex', flexDirection: 'column', gap: 12 }}>
                {pl.perks.map(x => (
                  <p key={x} style={{ margin: 0, ...row, gap: 10, fontSize: 14, lineHeight: '18px' }}>
                    <Ico src="nav-premium.png" size={17} />{x}
                  </p>
                ))}
              </div>
            </div>
          ))}
        </div>
        <div style={{ height: 20 }} />
      </div>

      <div style={{ ...row, gap: 24, borderTop: `1px solid ${C.line}`, padding: '14px 32px', background: C.bg }}>
        <div style={{ minWidth: 200 }}>
          <p style={{ margin: 0, fontSize: 15, fontWeight: 700 }}>{PREMIUM_PLANS[0].name}</p>
          <p style={{ margin: '2px 0 0', fontSize: 20, fontWeight: 700 }}>
            {plan === 'monthly' ? PREMIUM_PLANS[0].monthly : PREMIUM_PLANS[0].annual}
            <span style={{ fontSize: 13, color: C.dim, fontWeight: 400 }}>{plan === 'monthly' ? ' / month' : ' / year'}</span>
          </p>
          <p style={{ margin: '2px 0 0', fontSize: 13, color: C.dim }}>For first 2 months, then €9.39 billed monthly</p>
        </div>
        <div style={{ flex: 1 }}>
          <button style={{ width: '100%', height: 44, borderRadius: 9999, border: 'none', background: C.btn, color: C.btnText, fontSize: 16, fontWeight: 700, cursor: 'pointer', fontFamily: X_FONT }}>
            Subscribe &amp; Pay
          </button>
          <p style={{ margin: '10px 0 0', fontSize: 11, color: C.dim, lineHeight: '15px', fontStyle: 'italic' }}>
            By subscribing, you agree to our <u>Purchaser Terms</u>, and that subscriptions auto-renew until you cancel. <u>Cancel anytime</u>, at least 24 hours prior to renewal to avoid additional charges. Price subject to change. Manage your subscription through the platform you subscribed on.
          </p>
        </div>
      </div>
    </div>
  );

  const bookmarked = searched(all.filter(p => marked[p.id]));
  const histLiked = searched(all.filter(p => liked[p.id]));
  const histList = bmTab === 'bookmarks' ? bookmarked : histLiked;
  const pageBookmarks = (
    <>
      <div style={{ ...row, gap: 20, minHeight: 53, padding: '0 16px', position: 'sticky', top: 0, zIndex: 3, background: 'rgba(0,0,0,0.65)', backdropFilter: 'blur(12px)' }}>
        <button onClick={() => go('home')} style={{ border: 'none', background: 'transparent', cursor: 'pointer', fontSize: 19, color: C.text, padding: 0, fontFamily: X_FONT }}>←</button>
        <p style={{ margin: 0, fontSize: 20, fontWeight: 800, lineHeight: '24px', flex: 1 }}>History</p>
        <Ico src="r-search.png" size={18.75} />
      </div>
      <div style={{ display: 'flex', borderBottom: `1px solid ${C.line}` }}>
        {([['bookmarks', 'Bookmarks', 'a-bookmark.png'], ['likes', 'Likes', 'a-like.png']] as const).map(([id, label, ic]) => (
          <button key={id} onClick={() => setBmTab(id)}
            style={{ flex: 1, height: 53, border: 'none', background: 'transparent', cursor: 'pointer', position: 'relative', fontFamily: X_FONT }}
            onMouseEnter={e => (e.currentTarget.style.background = C.hover)}
            onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
          >
            <span style={{ ...row, gap: 8, justifyContent: 'center', fontSize: 15, fontWeight: 700, color: bmTab === id ? C.text : C.dim }}>
              <Ico src={ic} size={18} />{label}
            </span>
            {bmTab === id && <span style={{ position: 'absolute', bottom: 0, left: '50%', transform: 'translateX(-50%)', width: 96, height: 4, borderRadius: 9999, background: C.blue }} />}
          </button>
        ))}
      </div>
      {histList.length ? histList.map(p => <Row key={p.id} p={p} />) : (
        <div style={{ padding: '32px 32px 0', maxWidth: 400 }}>
          <h2 style={{ margin: 0, fontSize: 31, fontWeight: 800, lineHeight: '36px' }}>
            {bmTab === 'bookmarks' ? 'Save posts for later' : 'No likes yet'}
          </h2>
          <p style={{ margin: '8px 0 0', fontSize: 15, lineHeight: '20px', color: C.dim }}>
            {bmTab === 'bookmarks'
              ? 'Bookmark posts to easily find them again in the future.'
              : 'Tap the heart on any post to keep it here.'}
          </p>
        </div>
      )}
    </>
  );

  const pageStudio = (
    <>
      <Header title="Creator Studio" sub="Communications IA de l'entreprise" />
      <div style={{ display: 'flex', borderBottom: `1px solid ${C.line}` }}>
        <Stat label="Envoyés" value={fmt(totals.envoyes)} />
        <Stat label="Vues" value={fmt(totals.vues)} />
        <Stat label="Engagements" value={fmt(totals.engagements)} />
        <Stat label="Clics" value={fmt(totals.clics)} />
      </div>
      <div style={{ display: 'flex', borderBottom: `1px solid ${C.line}` }}>
        <Stat label="Programmés" value={fmt(totals.programmes)} />
        <Stat label="En attente" value={fmt(totals.enAttente)} />
        <Stat label="Échecs" value={fmt(totals.echecs)} />
        <Stat label="Réponses IA" value={fmt(totals.reponsesIA)} />
      </div>
      <p style={{ margin: 0, padding: '12px 16px', fontSize: 20, fontWeight: 800 }}>Publications de l'IA</p>
      {apiPosts.length === 0 && <Empty text="L'IA n'a encore rien publié pour cette entreprise." />}
      {all.filter(p => p.handle === '@velbaz_ia').map(p => <Row key={p.id} p={p} />)}
    </>
  );

  const pageArticles = (
    <>
      <Header title="Articles" sub={`${articles.length} brouillon(s)`} />
      <div style={{ padding: 16, borderBottom: `1px solid ${C.line}` }}>
        <input
          value={articleDraft.title}
          onChange={e => setArticleDraft(d => ({ ...d, title: e.target.value }))}
          placeholder="Titre de l'article"
          style={{ width: '100%', border: 'none', outline: 'none', fontSize: 24, fontWeight: 800, fontFamily: X_FONT, padding: '4px 0', background: 'transparent', color: C.text }}
        />
        <textarea
          value={articleDraft.body}
          onChange={e => setArticleDraft(d => ({ ...d, body: e.target.value }))}
          placeholder="Écris ton article…"
          style={{ width: '100%', minHeight: 120, border: 'none', outline: 'none', resize: 'vertical', fontSize: 17, lineHeight: '24px', fontFamily: X_FONT, padding: '8px 0', background: 'transparent', color: C.text }}
        />
        <button
          onClick={() => {
            const { title, body } = articleDraft;
            if (!title.trim() && !body.trim()) return;
            setArticles(a => [{ id: 'a' + Date.now(), title: title.trim() || 'Sans titre', body: body.trim(), age: 'now' }, ...a]);
            setArticleDraft({ title: '', body: '' });
          }}
          style={{ height: 36, padding: '0 16px', borderRadius: 9999, border: 'none', background: C.btn, color: C.btnText, fontSize: 15, fontWeight: 700, cursor: 'pointer', fontFamily: X_FONT }}
        >
          Publish
        </button>
      </div>
      {articles.map(a => (
        <div key={a.id} style={{ padding: '12px 16px', borderBottom: `1px solid ${C.line}` }}>
          <p style={{ margin: 0, fontSize: 17, fontWeight: 800 }}>{a.title}</p>
          <p style={{ margin: '2px 0 0', fontSize: 15, color: C.dim, whiteSpace: 'pre-wrap' }}>{a.body}</p>
          <p style={{ margin: '6px 0 0', fontSize: 13, color: C.dim }}>@{identity} · {a.age}</p>
        </div>
      ))}
    </>
  );

  const myPosts = all.filter(p => p.handle === '@' + identity);
  const likedPosts = all.filter(p => liked[p.id]);
  const myReplies = Object.entries(replies).flatMap(([pid, list]) => list.map((r, i) => ({ pid, i, ...r })));
  const pageProfile = (
    <>
      <div style={{ ...row, gap: 20, minHeight: 53, padding: '0 16px', position: 'sticky', top: 0, zIndex: 3, background: 'rgba(0,0,0,0.65)', backdropFilter: 'blur(12px)' }}>
        <button onClick={() => go('home')} style={{ border: 'none', background: 'transparent', cursor: 'pointer', fontSize: 19, color: C.text, padding: 0, fontFamily: X_FONT }}>←</button>
        <div style={{ flex: 1, minWidth: 0 }}>
          <p style={{ margin: 0, fontSize: 20, fontWeight: 800, lineHeight: '24px' }}>Actionbox Project</p>
          <p style={{ margin: 0, fontSize: 13, color: C.dim, lineHeight: '16px' }}>{myPosts.length} posts</p>
        </div>
        <Ico src="r-search.png" size={18.75} />
      </div>
      <div style={{ height: 200, background: '#333639' }} />
      <div style={{ padding: '0 16px 12px' }}>
        <div style={{ ...row, alignItems: 'flex-end', justifyContent: 'space-between' }}>
          <img src={D + 'av-default.png'} alt="" width={133} height={133} style={{ width: 133, height: 133, borderRadius: 9999, border: `4px solid ${C.bg}`, marginTop: -66, display: 'block', background: '#cfd9de' }} />
          <button style={{ height: 36, padding: '0 16px', marginBottom: 4, borderRadius: 9999, border: `1px solid ${C.line}`, background: 'transparent', color: C.text, fontSize: 15, fontWeight: 700, cursor: 'pointer', fontFamily: X_FONT }}>Set up profile</button>
        </div>
        <p style={{ margin: '12px 0 0', fontSize: 20, fontWeight: 800, lineHeight: '24px' }}>Actionbox Project</p>
        <p style={{ margin: 0, fontSize: 15, color: C.dim }}>@{identity}</p>
        <p style={{ margin: '12px 0 0', ...row, gap: 6, fontSize: 15, color: C.dim }}>🗓 Joined August 2026 ›</p>
        <p style={{ margin: '10px 0 0', fontSize: 15, color: C.dim }}>
          <b style={{ color: C.text }}>{Object.values(following).filter(Boolean).length}</b> Following{'   '}
          <b style={{ color: C.text }}>0</b> Followers
        </p>
      </div>
      <Tabs items={[['posts', 'Posts ⌄'], ['replies', 'Replies'], ['reposts', 'Reposts'], ['media', 'Media']]} value={profileTab} onChange={setProfileTab} />
      {profileTab === 'posts' && myPosts.length === 0 && (
        <>
          <h2 style={{ margin: 0, padding: '16px 16px 12px', fontSize: 20, fontWeight: 800, lineHeight: '24px' }}>Let’s get you set up</h2>
          <div className="xcl-scroll" style={{ display: 'flex', gap: 16, overflowX: 'auto', padding: '0 16px 16px' }}>
            {SETUP_CARDS.map(c => (
              <div key={c.label} style={{ width: 100, flexShrink: 0, cursor: 'pointer' }} onClick={() => go('follow')}>
                <div style={{ height: 64, borderRadius: 12, background: c.grad, position: 'relative', display: 'grid', placeItems: 'center', fontSize: 22 }}>
                  {c.left && <span style={{ position: 'absolute', top: 6, left: 6, fontSize: 10, fontWeight: 700, background: 'rgba(0,0,0,0.35)', borderRadius: 4, padding: '2px 5px', color: '#fff' }}>{c.left}</span>}
                  <span>{c.icon}</span>
                </div>
                <p style={{ margin: '8px 0 0', fontSize: 13, lineHeight: '17px' }}>{c.label}</p>
              </div>
            ))}
          </div>
          <h2 style={{ margin: 0, padding: '4px 16px 8px', fontSize: 20, fontWeight: 800, lineHeight: '24px' }}>Who to follow</h2>
          {PROFILE_WHO.map(w => (
            <div key={w.handle} style={{ display: 'flex', gap: 12, padding: '12px 16px' }}
              onMouseEnter={e => (e.currentTarget.style.background = C.hover)}
              onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
            >
              <img src={D + w.av} alt="" width={40} height={40} style={{ width: 40, height: 40, borderRadius: 9999, objectFit: 'cover', background: C.card, flexShrink: 0 }} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <p style={{ margin: 0, ...row, gap: 4, fontSize: 15, fontWeight: 700, lineHeight: '20px' }}>{w.name}{w.verified && <Verified />}</p>
                <p style={{ margin: 0, fontSize: 15, color: C.dim, lineHeight: '20px' }}>{w.handle}</p>
                <p style={{ margin: '4px 0 0', fontSize: 15, lineHeight: '20px' }}>
                  <span style={{ color: C.blue }}>{w.handle === '@vrtnws' ? '#vrtnws ' : ''}</span>{w.bio}{w.link && <span style={{ color: C.blue }}> {w.link}</span>}
                </p>
              </div>
              <button
                onClick={() => setFollowing(f => ({ ...f, [w.handle]: !f[w.handle] }))}
                style={{ height: 32, alignSelf: 'flex-start', padding: '0 16px', borderRadius: 9999, border: following[w.handle] ? `1px solid ${C.line}` : 'none', background: following[w.handle] ? 'transparent' : C.btn, color: following[w.handle] ? C.text : C.btnText, fontSize: 14, fontWeight: 700, cursor: 'pointer', fontFamily: X_FONT }}
              >
                {following[w.handle] ? 'Following' : 'Follow'}
              </button>
            </div>
          ))}
          <button onClick={() => go('follow')} style={{ display: 'block', border: 'none', background: 'transparent', color: C.blue, fontSize: 15, cursor: 'pointer', fontFamily: X_FONT, padding: '8px 16px 20px' }}>Show more</button>
        </>
      )}
      {profileTab === 'reposts' && (
        <div style={{ padding: '32px 32px 0', maxWidth: 400 }}>
          <h2 style={{ margin: 0, fontSize: 31, fontWeight: 800, lineHeight: '36px' }}>No reposts yet</h2>
          <p style={{ margin: '8px 0 0', fontSize: 15, lineHeight: '20px', color: C.dim }}>When you repost something, it will show up here.</p>
        </div>
      )}
      {profileTab === 'posts' && (myPosts.length ? myPosts.map(p => <Row key={p.id} p={p} />) : <Empty text="Tu n'as encore rien publié." />)}
      {profileTab === 'replies' && (myReplies.length
        ? myReplies.map(r => (
          <div key={r.pid + r.i} style={{ padding: '12px 16px', borderBottom: `1px solid ${C.line}` }}>
            <p style={{ margin: 0, fontSize: 13, color: C.dim }}>En réponse à un post</p>
            <p style={{ margin: '2px 0 0', fontSize: 15 }}>{r.text}</p>
          </div>
        ))
        : <Empty text="Aucune réponse pour l'instant." />)}
      {profileTab === 'media' && (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 2, padding: 2 }}>
          {mediaPosts.map(p => (
            <div key={p.id} onClick={() => setOpen(p)} style={{ aspectRatio: '1 / 1', overflow: 'hidden', background: '#000', cursor: 'pointer' }}>
              {p.media?.video
                ? <video src={p.media.video} poster={p.media.poster} muted style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                : <img src={p.media?.photo || (p.media?.src ? A + p.media.src : '')} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />}
            </div>
          ))}
        </div>
      )}
      {profileTab === 'likes' && (likedPosts.length ? likedPosts.map(p => <Row key={p.id} p={p} />) : <Empty text="Aucun like pour l'instant." />)}
    </>
  );

  const SETTINGS: { key: string; label: string; hint: string }[] = [
    { key: 'private', label: 'Compte privé', hint: 'Seuls tes abonnés voient tes posts' },
    { key: 'dm', label: 'Messages ouverts', hint: 'Tout le monde peut t’écrire' },
    { key: 'quality', label: 'Vidéo haute qualité', hint: 'Charge la variante mp4 la plus fine disponible' },
    { key: 'dark', label: 'Thème sombre', hint: 'Inverse le fond du fil' },
  ];

  const pageMore = (
    <>
      <Header title="More" />
      {SETTINGS.map(s => (
        <div key={s.key} style={{ ...row, justifyContent: 'space-between', padding: '12px 16px', borderBottom: `1px solid ${C.line}` }}>
          <div>
            <p style={{ margin: 0, fontSize: 15, fontWeight: 700 }}>{s.label}</p>
            <p style={{ margin: 0, fontSize: 13, color: C.dim }}>{s.hint}</p>
          </div>
          <button
            onClick={() => setSettings(v => ({ ...v, [s.key]: !v[s.key] }))}
            style={{ width: 44, height: 24, borderRadius: 9999, border: 'none', background: settings[s.key] ? C.blue : '#3e4144', position: 'relative', cursor: 'pointer' }}
          >
            <span style={{ position: 'absolute', top: 2, left: settings[s.key] ? 22 : 2, width: 20, height: 20, borderRadius: 9999, background: '#fff', transition: 'left .15s' }} />
          </button>
        </div>
      ))}
      {[['bookmarks', 'Bookmarks'], ['studio', 'Creator Studio'], ['articles', 'Articles'], ['premium', 'Premium+']].map(([id, label]) => (
        <button key={id} onClick={() => go(id)} style={{ width: '100%', textAlign: 'left', padding: '14px 16px', border: 'none', borderBottom: `1px solid ${C.line}`, background: 'transparent', color: C.text, fontSize: 17, cursor: 'pointer', fontFamily: X_FONT }}>
          {label} →
        </button>
      ))}
    </>
  );

  const pageDetail = open && (
    <>
      <div style={{ ...row, gap: 20, height: 53, padding: '0 16px', position: 'sticky', top: 0, zIndex: 3, background: 'rgba(0,0,0,0.65)', backdropFilter: 'blur(12px)', borderBottom: `1px solid ${C.line}` }}>
        <button onClick={() => setOpen(null)} style={{ border: 'none', background: 'transparent', cursor: 'pointer', fontSize: 19, color: C.text, padding: 0, fontFamily: X_FONT }}>←</button>
        <span style={{ fontSize: 20, fontWeight: 800 }}>Post</span>
      </div>
      <div style={{ padding: '12px 16px', borderBottom: `1px solid ${C.line}` }}>
        <div style={{ ...row, gap: 12 }}>
          <Avatar p={open} />
          <div style={{ minWidth: 0, flex: 1 }}>
            <p style={{ margin: 0, ...row, gap: 4, fontSize: 15, fontWeight: 700, lineHeight: '20px' }}>{open.author}{open.verified && <Verified />}</p>
            <p style={{ margin: 0, fontSize: 15, color: C.dim, lineHeight: '20px' }}>{open.handle}</p>
          </div>
          <button
            onClick={() => { bump(open, AFF_WEIGHT.follow); setFollowing(f => ({ ...f, [open.handle]: !f[open.handle] })); }}
            style={{ height: 32, padding: '0 16px', borderRadius: 9999, border: following[open.handle] ? `1px solid ${C.line}` : 'none', background: following[open.handle] ? 'transparent' : C.btn, color: following[open.handle] ? C.text : C.btnText, fontSize: 14, fontWeight: 700, cursor: 'pointer', fontFamily: X_FONT }}
          >
            {following[open.handle] ? 'Following' : 'Follow'}
          </button>
        </div>
        <p style={{ margin: '12px 0 0', fontSize: 17, lineHeight: '24px', whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>{open.text}</p>
        {open.media && <PostMedia media={open.media} onMax={() => setMaxPost(open)} />}
        <p style={{ margin: '12px 0 0', fontSize: 15, color: C.dim }}>{open.age} · {open.views} Views</p>
        <div style={{ borderTop: `1px solid ${C.line}`, marginTop: 12, paddingTop: 4 }}>
          <Action p={open} detail />
        </div>
      </div>
      <div style={{ ...row, gap: 12, padding: 12, borderBottom: `1px solid ${C.line}` }}>
        <input
          value={replyDraft}
          onChange={e => setReplyDraft(e.target.value)}
          onKeyDown={e => {
            if (e.key !== 'Enter' || !replyDraft.trim()) return;
            const t = replyDraft.trim();
            setReplies(r => ({ ...r, [open.id]: [...(r[open.id] || []), { text: t, age: 'now' }] }));
            setReplyDraft('');
          }}
          placeholder="Post your reply"
          style={{ flex: 1, height: 40, border: 'none', outline: 'none', fontSize: 17, fontFamily: X_FONT, background: 'transparent', color: C.text }}
        />
        <button
          onClick={() => {
            const t = replyDraft.trim();
            if (!t) return;
            setReplies(r => ({ ...r, [open.id]: [...(r[open.id] || []), { text: t, age: 'now' }] }));
            setReplyDraft('');
          }}
          disabled={!replyDraft.trim()}
          style={{ height: 36, padding: '0 16px', borderRadius: 9999, border: 'none', background: replyDraft.trim() ? C.btn : '#3e4144', color: replyDraft.trim() ? C.btnText : '#0f1419', fontSize: 15, fontWeight: 700, cursor: replyDraft.trim() ? 'pointer' : 'default', fontFamily: X_FONT }}
        >
          Reply
        </button>
      </div>
      {(replies[open.id] || []).map((r, i) => (
        <div key={i} style={{ display: 'flex', gap: 12, padding: '12px 16px', borderBottom: `1px solid ${C.line}` }}>
          <img src={A + 'av-account.png'} alt="" width={40} height={40} style={{ width: 40, height: 40, borderRadius: 9999 }} />
          <div>
            <p style={{ margin: 0, fontSize: 15, fontWeight: 700 }}>Alex Smith <span style={{ color: C.dim, fontWeight: 400 }}>@{identity} · {r.age}</span></p>
            <p style={{ margin: '2px 0 0', fontSize: 15, lineHeight: '20px' }}>{r.text}</p>
          </div>
        </div>
      ))}
    </>
  );

  const center = open
    ? pageDetail
    : nav === 'explore' ? pageExplore
      : nav === 'notif' ? pageNotif
        : nav === 'follow' ? pageFollow
          : nav === 'chat' ? pageChat
            : nav === 'grok' ? pageGrok
              : nav === 'bookmarks' ? pageBookmarks
                  : nav === 'studio' ? pageStudio
                    : nav === 'articles' ? pageArticles
                      : nav === 'profile' ? pageProfile
                        : nav === 'more' ? pageMore
                          : pageHome;

  /** Carte « Who to follow » / « You might like » de la colonne droite. */
  const whoCard = (title: string) => (
    <section style={{ width: 350, background: C.card, borderRadius: 16, marginTop: 16 }}>
      <h2 style={{ margin: 0, fontSize: 20, fontWeight: 800, lineHeight: '24px', padding: '12px 16px 4px' }}>{title}</h2>
      {WHO.map(w => ({ handle: w.handle, name: w.name, av: D + w.av })).map(s => (
        <div key={s.handle} style={{ ...row, gap: 12, padding: '12px 16px' }}>
          <img src={s.av} alt="" width={40} height={40} style={{ width: 40, height: 40, borderRadius: 9999, objectFit: 'cover', background: C.line }} />
          <div style={{ flex: 1, minWidth: 0 }}>
            <p style={{ margin: 0, fontSize: 15, fontWeight: 700, lineHeight: '20px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{s.name}</p>
            <p style={{ margin: 0, fontSize: 15, color: C.dim, lineHeight: '20px' }}>{s.handle}</p>
          </div>
          <button
            onClick={() => setFollowing(f => ({ ...f, [s.handle]: !f[s.handle] }))}
            style={{ height: 32, padding: '0 16px', borderRadius: 9999, border: following[s.handle] ? `1px solid ${C.line}` : 'none', background: following[s.handle] ? 'transparent' : C.btn, color: following[s.handle] ? C.text : C.btnText, fontSize: 14, fontWeight: 700, cursor: 'pointer', fontFamily: X_FONT }}
          >
            {following[s.handle] ? 'Following' : 'Follow'}
          </button>
        </div>
      ))}
      <button onClick={() => go('follow')} style={{ width: '100%', textAlign: 'left', padding: '12px 16px', border: 'none', background: 'transparent', color: C.blue, fontSize: 15, cursor: 'pointer', fontFamily: X_FONT, borderRadius: '0 0 16px 16px' }}>
        Show more
      </button>
    </section>
  );

  /** Pied de page de la colonne droite (capture profil). */
  const rightFooter = (
    <div style={{ width: 350, display: 'flex', flexWrap: 'wrap', gap: '4px 12px', padding: '16px 0 8px' }}>
      {FOOTER_LINKS.map(l => (
        <span key={l} style={{ fontSize: 13, color: C.dim, cursor: 'pointer' }}>{l}</span>
      ))}
      <span style={{ fontSize: 13, color: C.dim }}>© 2026 X Corp.</span>
    </div>
  );

  return (
    <div ref={wrapRef} className={className} style={{ overflow: 'hidden', background: C.bg, width: '100%' }}>
      <div
        style={{
          width: STAGE_W,
          height: box.h ? box.h / scale : '100%',
          transform: `scale(${scale})`,
          transformOrigin: 'top left',
          background: C.bg,
          color: C.text,
          fontFamily: X_FONT,
          WebkitFontSmoothing: 'antialiased',
          display: 'flex',
          overflow: 'hidden',
          position: 'relative',
        }}
      >
        <XCloneFonts />

        {/* ═════ Rail gauche — 275 px + bord 1 px ═════ */}
        <div
          className="xcl-scroll"
          style={{ width: 276, flexShrink: 0, borderRight: `1px solid ${C.line}`, overflowY: 'auto', padding: '4px 8px 12px 12px', display: 'flex', flexDirection: 'column' }}
        >
          <div style={{ padding: '8px 12px 4px' }}>
            <XGlyph size={26} />
          </div>

          {NAV.map(n => {
            const active = nav === n.id;
            return (
              <button
                key={n.id}
                onClick={() => go(n.id)}
                style={{ ...row, gap: 16, padding: '12px', borderRadius: 9999, background: 'transparent', border: 'none', cursor: 'pointer', textAlign: 'left', margin: '2px 0' }}
                onMouseEnter={e => (e.currentTarget.style.background = C.hover)}
                onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
              >
                <span style={{ position: 'relative', display: 'grid', placeItems: 'center' }}>
                  <Ico src={n.icon} size={26.25} alt={n.label} />
                  {n.dot && <span style={{ position: 'absolute', top: -1, right: -2, width: 8, height: 8, borderRadius: 9999, background: C.blue }} />}
                </span>
                <span style={{ fontSize: 20, lineHeight: '24px', fontWeight: active ? 700 : 400, color: C.text }}>{n.label}</span>
              </button>
            );
          })}

          <button
            onClick={publish}
            style={{ width: 234, height: 52, marginTop: 16, borderRadius: 9999, border: 'none', background: C.btn, color: C.btnText, fontSize: 17, fontWeight: 700, cursor: 'pointer', fontFamily: X_FONT }}
          >
            Post
          </button>

          <div style={{ flex: 1 }} />

          <div style={{ position: 'relative', marginTop: 16 }}>
          {acctMenu && (
            <div style={{ position: 'absolute', bottom: 'calc(100% + 8px)', left: 0, width: 300, background: C.card, borderRadius: 16, boxShadow: '0 0 15px rgba(255,255,255,0.15), 0 0 3px 1px rgba(255,255,255,0.15)', overflow: 'hidden', zIndex: 20 }}>
              <button
                onClick={() => setAcctMenu(false)}
                style={{ width: '100%', textAlign: 'left', padding: '16px', border: 'none', background: 'transparent', color: C.text, fontSize: 15, fontWeight: 700, cursor: 'pointer', fontFamily: X_FONT }}
                onMouseEnter={e => (e.currentTarget.style.background = C.hover)}
                onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
              >
                Add an existing account
              </button>
              <button
                onClick={() => setAcctMenu(false)}
                style={{ width: '100%', textAlign: 'left', padding: '16px', border: 'none', background: 'transparent', color: C.text, fontSize: 15, fontWeight: 700, cursor: 'pointer', fontFamily: X_FONT }}
                onMouseEnter={e => (e.currentTarget.style.background = C.hover)}
                onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
              >
                Log out @{identity}
              </button>
            </div>
          )}
          <div
            style={{ ...row, gap: 12, padding: 12, borderRadius: 9999, cursor: 'pointer' }}
            onClick={() => go('profile')}
            onMouseEnter={e => (e.currentTarget.style.background = C.hover)}
            onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
          >
            <img src={A + 'av-account.png'} alt="" width={40} height={40} style={{ width: 40, height: 40, borderRadius: 9999 }} />
            <div style={{ minWidth: 0, flex: 1 }}>
              <p style={{ margin: 0, fontSize: 15, fontWeight: 700, lineHeight: '20px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>Actionbox Project</p>
              <p style={{ margin: 0, fontSize: 15, color: C.dim, lineHeight: '20px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>@{identity}</p>
            </div>
            <span
              onClick={e => { e.stopPropagation(); setAcctMenu(v => !v); }}
              style={{ color: C.text, fontSize: 15, fontWeight: 700, padding: '0 4px' }}
            >
              ···
            </span>
          </div>
          </div>
        </div>

        {/* ═════ Colonne centrale — 600 px ═════ */}
        <div
          className="xcl-scroll"
          onScroll={e => { if (nav === 'home' && !open) onFeedScroll(e.currentTarget); }}
          style={{ width: nav === 'grok' ? 982 : 600, flexShrink: 0, borderRight: `1px solid ${C.line}`, overflowY: 'auto' }}
        >
          {center}
          <div style={{ height: 48 }} />
        </div>

        {/* ═════ Colonne droite — 350 px, contenu à 32 px du bord (absente sur Grok) ═════ */}
        {nav !== 'grok' && (
        <div className="xcl-scroll" style={{ width: 382, flexShrink: 0, overflowY: 'auto', padding: '0 0 32px 32px' }}>
          <div style={{ position: 'sticky', top: 0, background: C.bg, paddingTop: 6, paddingBottom: 6, zIndex: 2, width: 350 }}>
            <div style={{ ...row, gap: 12, height: 44, borderRadius: 9999, background: C.search, padding: '0 16px' }}>
              <Ico src="r-search.png" size={18.75} />
              <input
                value={query}
                onChange={e => { setQuery(e.target.value); setOpen(null); if (nav !== 'home' && nav !== 'explore') setNav('home'); }}
                placeholder="Search"
                style={{ flex: 1, border: 'none', outline: 'none', background: 'transparent', fontSize: 15, color: C.text, fontFamily: X_FONT }}
              />
              {query && (
                <button onClick={() => setQuery('')} style={{ border: 'none', background: 'transparent', cursor: 'pointer', padding: 0 }}>
                  <Ico src="r-close.png" size={16} />
                </button>
              )}
            </div>
          </div>

          {nav === 'home' && (
          <section style={{ width: 350, background: C.card, borderRadius: 16, marginTop: 10, padding: '12px 16px 16px' }}>
            <h2 style={{ margin: 0, fontSize: 20, fontWeight: 800, lineHeight: '24px' }}>Subscribe to Premium</h2>
            <p style={{ margin: '8px 0 12px', fontSize: 15, lineHeight: '20px', color: C.text }}>
              Subscribe to unlock new features and if eligible, receive a share of revenue.
            </p>
            <button
              onClick={() => go('premium')}
              style={{ height: 36, padding: '0 16px', borderRadius: 9999, border: 'none', background: C.blue, color: '#fff', fontSize: 15, fontWeight: 700, cursor: 'pointer', fontFamily: X_FONT }}
            >
              Subscribe
            </button>
          </section>
          )}

          {nav === 'profile' && whoCard('You might like')}

          {nav === 'home' && newsOpen && (
            <section style={{ width: 350, background: C.card, borderRadius: 16, marginTop: 16 }}>
              <div style={{ ...row, justifyContent: 'space-between', padding: '12px 16px 4px' }}>
                <h2 style={{ margin: 0, fontSize: 20, fontWeight: 800, lineHeight: '24px' }}>Today’s News</h2>
                <button onClick={() => setNewsOpen(false)} style={{ border: 'none', background: 'transparent', cursor: 'pointer', padding: 0 }}>
                  <Ico src="r-close.png" size={18.75} />
                </button>
              </div>
              {NEWS.map(n => (
                <div key={n.title} style={{ padding: '10px 16px', cursor: 'pointer' }}
                  onClick={() => { setQuery(n.title.split(' ').slice(0, 2).join(' ')); go('home'); }}
                  onMouseEnter={e => (e.currentTarget.style.background = C.hover)}
                  onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
                >
                  <p style={{ margin: 0, fontSize: 15, fontWeight: 700, lineHeight: '20px' }}>{n.title}</p>
                  <div style={{ ...row, gap: 6, marginTop: 6 }}>
                    <img src={A + n.av} alt="" style={{ height: 20, display: 'block' }} />
                    <span style={{ fontSize: 13, color: C.dim }}>{n.meta}</span>
                  </div>
                </div>
              ))}
            </section>
          )}

          <section style={{ width: 350, background: C.card, borderRadius: 16, marginTop: 16 }}>
            <h2 style={{ margin: 0, fontSize: 20, fontWeight: 800, lineHeight: '24px', padding: '12px 16px 4px' }}>What’s happening</h2>
            {TRENDS.map(t => (
              <div key={t.topic} style={{ padding: '12px 16px', cursor: 'pointer', position: 'relative' }}
                onClick={() => { setQuery(t.topic.replace('#', '')); go('home'); }}
                onMouseEnter={e => (e.currentTarget.style.background = C.hover)}
                onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
              >
                <p style={{ margin: 0, fontSize: 13, color: C.dim, lineHeight: '16px' }}>{t.cat}</p>
                <p style={{ margin: '2px 0 0', fontSize: 15, fontWeight: 700, lineHeight: '20px' }}>{t.topic}</p>
                {t.withText && (
                  <p style={{ margin: '2px 0 0', fontSize: 13, color: C.dim, lineHeight: '16px' }}>
                    Trending with{' '}
                    {t.withText.map((w, i) => (
                      <span key={w} style={{ color: C.blue }}>{i ? ', ' : ''}{w}</span>
                    ))}
                  </p>
                )}
                <span style={{ position: 'absolute', right: 12, top: 12 }}><Ico src="r-dots.png" size={18.75} /></span>
              </div>
            ))}
            <button style={{ width: '100%', textAlign: 'left', padding: '12px 16px', border: 'none', background: 'transparent', color: C.blue, fontSize: 15, cursor: 'pointer', fontFamily: X_FONT, borderRadius: '0 0 16px 16px' }}
              onClick={() => go('explore')}
              onMouseEnter={e => (e.currentTarget.style.background = C.hover)}
              onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
            >
              Show more
            </button>
          </section>

          {nav !== 'profile' && whoCard('Who to follow')}
          {nav === 'profile' && rightFooter}
        </div>
        )}

        {/* ═════ Premium — surcouche plein écran ═════ */}
        {nav === 'premium' && premiumOverlay}

        {/* ═════ Vidéo / post agrandi au centre (lightbox X) ═════ */}
        {maxPost && (
          <div
            onClick={() => setMaxPost(null)}
            style={{ position: 'absolute', inset: 0, zIndex: 60, background: 'rgba(0,0,0,0.98)', display: 'grid', gridTemplateRows: '1fr auto', fontFamily: X_FONT }}
          >
            <button
              onClick={e => { e.stopPropagation(); setMaxPost(null); }}
              title="Fermer"
              style={{ position: 'absolute', left: 16, top: 16, width: 36, height: 36, borderRadius: 9999, border: 'none', background: 'rgba(255,255,255,0.1)', color: '#fff', fontSize: 16, cursor: 'pointer', padding: 0, zIndex: 2 }}
            >
              ✕
            </button>
            <div style={{ display: 'grid', placeItems: 'center', minHeight: 0, padding: '56px 16px 8px' }} onClick={e => e.stopPropagation()}>
              {maxPost.media?.video ? (
                <video
                  src={maxPost.media.video}
                  poster={maxPost.media.poster}
                  controls
                  autoPlay
                  loop
                  playsInline
                  style={{ maxWidth: '100%', maxHeight: '82vh', display: 'block', background: '#000' }}
                />
              ) : maxPost.media?.photo ? (
                <img src={maxPost.media.photo} alt="" style={{ maxWidth: '100%', maxHeight: '82vh', display: 'block' }} />
              ) : maxPost.media?.src ? (
                <img src={A + maxPost.media.src} alt="" style={{ maxWidth: '100%', maxHeight: '82vh', display: 'block' }} />
              ) : null}
            </div>
            <div style={{ borderTop: `1px solid ${C.line}`, padding: '12px 24px 16px', maxWidth: 600, width: '100%', margin: '0 auto' }} onClick={e => e.stopPropagation()}>
              <div style={{ ...row, gap: 8 }}>
                <img src={maxPost.avatarUrl || A + maxPost.avatar} alt="" width={40} height={40} style={{ width: 40, height: 40, borderRadius: 9999 }} />
                <div style={{ minWidth: 0 }}>
                  <div style={{ ...row, gap: 4 }}>
                    <span style={{ fontSize: 15, fontWeight: 700, color: C.text }}>{maxPost.author}</span>
                    {maxPost.verified && <Verified />}
                  </div>
                  <span style={{ fontSize: 15, color: C.dim }}>{maxPost.handle} · {maxPost.age}</span>
                </div>
              </div>
              <p style={{ margin: '8px 0 0', fontSize: 15, lineHeight: '20px', color: C.text, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>{maxPost.text}</p>
              <Action p={maxPost} detail />
            </div>
          </div>
        )}

        {/* ═════ Deux boutons ronds flottants ═════ */}
        <div style={{ position: 'absolute', right: 16, bottom: 16, display: 'flex', flexDirection: 'column', gap: 12 }}>
          <button onClick={() => go('grok')} style={{ width: 48, height: 48, borderRadius: 9999, background: C.bg, border: `1px solid ${C.line}`, boxShadow: '0 2px 12px rgba(0,0,0,0.6)', display: 'grid', placeItems: 'center', cursor: 'pointer', padding: 0 }}>
            <Ico src="f-grok.png" size={24} />
          </button>
          <button onClick={() => go('chat')} style={{ width: 48, height: 48, borderRadius: 9999, background: C.bg, border: `1px solid ${C.line}`, boxShadow: '0 2px 12px rgba(0,0,0,0.6)', display: 'grid', placeItems: 'center', cursor: 'pointer', padding: 0 }}>
            <Ico src="f-msg.png" size={24} />
          </button>
        </div>
      </div>
    </div>
  );
}

export default XCloneApp;
