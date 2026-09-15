// ─── Actualités crypto RÉELLES + sentiment (aucune donnée inventée) ───
// Sources : flux RSS publics et sans clé — CoinDesk, Cointelegraph (+ tags par
// coin), Decrypt, CryptoSlate, NewsBTC, news.bitcoin.com, Reddit (.rss) et un
// flux macro/finance (WSJ Markets). Le sentiment (bullish/bearish/neutral) est
// calculé ICI, côté serveur, à partir d'un lexique appliqué aux VRAIS titres :
// le modèle ne fabrique jamais une nouvelle, il commente du réel.
//
// Utilisé par : (1) l'analyse crypto du chat (bloc affiché sous le graphique)
// et (2) le contexte du heartbeat de trading autonome (décision achat/vente/
// attente enrichie par l'actu, pas seulement la technique).

import { resolveCoin, type CoinRef } from './market';

export interface NewsItem {
  title: string;
  source: string;
  url: string;
  publishedAt: number; // epoch ms (0 si inconnu)
  snippet: string;
}

export interface NewsBundle {
  symbol: string;       // "BTC"
  coinLabel: string;    // "BTC/USDT"
  sentiment: 'bullish' | 'bearish' | 'neutral';
  score: number;        // -100 (très baissier) … +100 (très haussier)
  confidence: 'faible' | 'moyenne' | 'élevée';
  summary: string;      // résumé FR ancré sur les titres réels
  catalysts: string[];  // catalyseurs détectés (haussiers/baissiers)
  items: NewsItem[];    // actus pertinentes pour le coin (récentes en premier)
  macro: NewsItem[];    // actus macro/finance (Fed, inflation, marchés…)
  fetchedAt: number;
}

// ── Cache court en mémoire (TTL par clé) ──
const cache = new Map<string, { at: number; data: unknown }>();
function cacheGet<T>(key: string, ttlMs: number): T | null {
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < ttlMs) return hit.data as T;
  return null;
}
function cacheSet(key: string, data: unknown) {
  cache.set(key, { at: Date.now(), data });
  if (cache.size > 300) {
    const entries = [...cache.entries()].sort((a, b) => a[1].at - b[1].at);
    for (let i = 0; i < 60; i++) { const e = entries[i]; if (e) cache.delete(e[0]); }
  }
}

const UA = { 'User-Agent': 'Mozilla/5.0 (compatible; Velbaz/1.0; +news)' } as const;

async function fetchText(url: string, timeoutMs = 8000): Promise<string> {
  const ctrl = new AbortController();
  const to = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { headers: UA, signal: ctrl.signal, redirect: 'follow' });
    if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
    return await res.text();
  } finally {
    clearTimeout(to);
  }
}

// ─────────────────────────── Parsing RSS / Atom ───────────────────────────
function decodeEntities(s: string): string {
  return (s || '')
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/<[^>]+>/g, ' ')            // retire d'éventuelles balises HTML
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&#(\d+);/g, (_m, n) => { try { return String.fromCodePoint(Number(n)); } catch { return ''; } })
    .replace(/\s+/g, ' ')
    .trim();
}

function tag(block: string, name: string): string {
  const m = block.match(new RegExp(`<${name}[^>]*>([\\s\\S]*?)</${name}>`, 'i'));
  return m && m[1] != null ? decodeEntities(m[1]) : '';
}

function atomLink(block: string): string {
  // <link href="..."/> ou <link>...</link>
  const href = block.match(/<link[^>]*href=["']([^"']+)["']/i);
  if (href && href[1]) return href[1];
  return tag(block, 'link');
}

function parseDate(s: string): number {
  if (!s) return 0;
  const t = Date.parse(s);
  return Number.isFinite(t) ? t : 0;
}

/** Parse un flux RSS 2.0 (<item>) ou Atom (<entry>) en NewsItem[]. */
function parseFeed(xml: string, source: string, max = 25): NewsItem[] {
  const items: NewsItem[] = [];
  const isAtom = /<feed[\s>]/i.test(xml) && /<entry[\s>]/i.test(xml);
  const blocks = isAtom
    ? xml.match(/<entry[\s\S]*?<\/entry>/gi) || []
    : xml.match(/<item[\s\S]*?<\/item>/gi) || [];
  for (const b of blocks.slice(0, max)) {
    const title = tag(b, 'title');
    if (!title) continue;
    const url = isAtom ? atomLink(b) : tag(b, 'link');
    const dateRaw = isAtom
      ? (tag(b, 'published') || tag(b, 'updated'))
      : (tag(b, 'pubDate') || tag(b, 'dc:date'));
    const snippet = isAtom
      ? (tag(b, 'summary') || tag(b, 'content'))
      : (tag(b, 'description') || tag(b, 'content:encoded'));
    items.push({
      title,
      source,
      url: (url || '').trim(),
      publishedAt: parseDate(dateRaw),
      snippet: (snippet || '').slice(0, 320),
    });
  }
  return items;
}

async function fetchFeed(url: string, source: string, ttlMs = 10 * 60_000, timeoutMs = 8000): Promise<NewsItem[]> {
  const key = `feed:${url}`;
  const cached = cacheGet<NewsItem[]>(key, ttlMs);
  if (cached) return cached;
  try {
    const xml = await fetchText(url, timeoutMs);
    const items = parseFeed(xml, source);
    if (items.length) cacheSet(key, items);
    return items;
  } catch {
    // en cas d'échec réseau, on renvoie l'ancien cache s'il existe (même périmé)
    const stale = cache.get(key)?.data as NewsItem[] | undefined;
    return stale || [];
  }
}

// ─────────────────────────── Sources ───────────────────────────
const GENERAL_FEEDS: Array<{ url: string; source: string }> = [
  { url: 'https://www.coindesk.com/arc/outboundfeeds/rss/', source: 'CoinDesk' },
  { url: 'https://cointelegraph.com/rss', source: 'Cointelegraph' },
  { url: 'https://decrypt.co/feed', source: 'Decrypt' },
  { url: 'https://cryptoslate.com/feed/', source: 'CryptoSlate' },
  { url: 'https://www.newsbtc.com/feed/', source: 'NewsBTC' },
  { url: 'https://news.bitcoin.com/feed/', source: 'Bitcoin.com' },
];

// Reddit : flux .rss public (sensible au rate-limit → cache long + tolérant).
const COMMUNITY_FEEDS: Array<{ url: string; source: string }> = [
  { url: 'https://www.reddit.com/r/CryptoCurrency/hot/.rss', source: 'r/CryptoCurrency' },
  { url: 'https://www.reddit.com/r/Bitcoin/hot/.rss', source: 'r/Bitcoin' },
];

const MACRO_FEEDS: Array<{ url: string; source: string }> = [
  { url: 'https://feeds.a.dj.com/rss/RSSMarketsMain.xml', source: 'WSJ Markets' },
  { url: 'https://www.investing.com/rss/news_285.rss', source: 'Investing.com' },
];

// Flux par coin chez Cointelegraph (tags fiables pour les grands coins).
const CT_TAG: Record<string, string> = {
  BTC: 'bitcoin', ETH: 'ethereum', SOL: 'solana', XRP: 'ripple', ADA: 'cardano',
  DOGE: 'dogecoin', BNB: 'bnb', DOT: 'polkadot', LTC: 'litecoin', LINK: 'chainlink',
  AVAX: 'avalanche', MATIC: 'polygon',
};

// ── Lexique de sentiment (FR + EN), appliqué aux vrais titres/extraits ──
const BULLISH = [
  'surge', 'soar', 'soars', 'rally', 'rallies', 'jump', 'jumps', 'gain', 'gains', 'rise', 'rises', 'rising',
  'record', 'all-time high', 'ath', 'breakout', 'bullish', 'bull', 'moon', 'pump', 'outperform', 'upgrade',
  'adoption', 'approval', 'approved', 'inflow', 'inflows', 'accumulate', 'buy', 'buying', 'boost', 'top',
  'hausse', 'bond', 'bondit', 'flambe', 'flambée', 'grimpe', 'envolée', "s'envole", 'haussier', 'haussière',
  'record', 'sommet', 'adoption', 'approuvé', 'approbation', 'afflux', 'achat', 'achats', 'accumulation', 'optimiste',
];
const BEARISH = [
  'plunge', 'plunges', 'crash', 'crashes', 'slump', 'drop', 'drops', 'fall', 'falls', 'falling', 'tumble', 'tumbles',
  'sink', 'sinks', 'dip', 'decline', 'declines', 'bearish', 'bear', 'dump', 'selloff', 'sell-off', 'liquidation',
  'liquidations', 'hack', 'hacked', 'exploit', 'lawsuit', 'sued', 'ban', 'banned', 'crackdown', 'fraud', 'scam',
  'outflow', 'outflows', 'warning', 'fear', 'downgrade', 'loss', 'losses', 'fine', 'fined', 'collapse',
  'baisse', 'chute', 'chute', "s'effondre", 'effondrement', 'krach', 'plonge', 'recule', 'recul', 'baissier', 'baissière',
  'vente', 'ventes', 'piratage', 'piraté', 'faille', 'procès', 'interdit', 'interdiction', 'répression', 'fraude',
  'arnaque', 'sortie', 'sorties', 'avertissement', 'peur', 'panique', 'perte', 'pertes', 'amende', 'effondre',
];

function scoreText(text: string): { s: number; hitsPos: string[]; hitsNeg: string[] } {
  const t = ` ${text.toLowerCase()} `;
  let s = 0;
  const hitsPos: string[] = [];
  const hitsNeg: string[] = [];
  for (const w of BULLISH) { if (t.includes(w)) { s += 1; hitsPos.push(w); } }
  for (const w of BEARISH) { if (t.includes(w)) { s -= 1; hitsNeg.push(w); } }
  return { s, hitsPos, hitsNeg };
}

// Construit l'ensemble d'alias (nom + ticker) pour filtrer les actus du coin.
function aliasesFor(ref: CoinRef | null, symbol: string): string[] {
  const set = new Set<string>();
  const sym = (symbol || '').toLowerCase().replace(/[^a-z0-9]/g, '');
  if (sym) set.add(sym);
  if (ref) {
    const ticker = ref.binance.replace(/usdt$/i, '').toLowerCase();
    if (ticker) set.add(ticker);
    if (ref.cg) set.add(ref.cg.toLowerCase().replace(/-/g, ' '));
    const lbl = ref.label.split('/')[0]?.toLowerCase();
    if (lbl) set.add(lbl);
  }
  // Noms longs fréquents
  const LONG: Record<string, string[]> = {
    btc: ['bitcoin'], eth: ['ethereum', 'ether'], sol: ['solana'], xrp: ['ripple', 'xrp'],
    ada: ['cardano'], doge: ['dogecoin'], bnb: ['binance coin', 'bnb'], dot: ['polkadot'],
    ltc: ['litecoin'], link: ['chainlink'], avax: ['avalanche'], matic: ['polygon', 'matic'],
  };
  for (const a of Array.from(set)) if (LONG[a]) LONG[a].forEach(x => set.add(x));
  return Array.from(set).filter(a => a.length >= 2);
}

function itemMatchesCoin(it: NewsItem, aliases: string[]): boolean {
  const hay = ` ${(it.title + ' ' + it.snippet).toLowerCase()} `;
  return aliases.some(a => {
    if (a.length <= 4) {
      // ticker court : exige des limites de mot pour éviter les faux positifs
      return new RegExp(`(^|[^a-z0-9])${a.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}([^a-z0-9]|$)`, 'i').test(hay);
    }
    return hay.includes(a);
  });
}

function dedupe(items: NewsItem[]): NewsItem[] {
  const seen = new Set<string>();
  const out: NewsItem[] = [];
  for (const it of items) {
    const k = it.title.toLowerCase().slice(0, 80);
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(it);
  }
  return out;
}

// ─────────────────────────── API principale ───────────────────────────
/**
 * Récupère les actus réelles pour un symbole crypto + calcule un sentiment
 * ancré sur les vrais titres. Résultat mis en cache ~5 min par symbole.
 */
export async function getCryptoNews(symbolOrName: string): Promise<NewsBundle> {
  const ref = await resolveCoin(symbolOrName).catch(() => null);
  const symbol = (ref ? ref.binance.replace(/usdt$/i, '') : symbolOrName).toUpperCase().replace(/[^A-Z0-9]/g, '') || symbolOrName.toUpperCase();
  const coinLabel = ref?.label || `${symbol}/USDT`;

  const cacheKey = `bundle:${symbol}`;
  const cached = cacheGet<NewsBundle>(cacheKey, 5 * 60_000);
  if (cached) return cached;

  const feedJobs: Array<Promise<NewsItem[]>> = [];
  // Flux général
  for (const f of GENERAL_FEEDS) feedJobs.push(fetchFeed(f.url, f.source));
  // Flux par coin (Cointelegraph tag) si dispo
  const ctTag = CT_TAG[symbol];
  if (ctTag) feedJobs.push(fetchFeed(`https://cointelegraph.com/rss/tag/${ctTag}`, 'Cointelegraph'));
  // Communauté (Reddit) — cache long pour ménager le rate-limit
  const communityJobs = COMMUNITY_FEEDS.map(f => fetchFeed(f.url, f.source, 20 * 60_000, 6000));
  const macroJobs = MACRO_FEEDS.map(f => fetchFeed(f.url, f.source, 15 * 60_000));

  const [general, community, macroAll] = await Promise.all([
    Promise.allSettled(feedJobs).then(rs => rs.flatMap(r => (r.status === 'fulfilled' ? r.value : []))),
    Promise.allSettled(communityJobs).then(rs => rs.flatMap(r => (r.status === 'fulfilled' ? r.value : []))),
    Promise.allSettled(macroJobs).then(rs => rs.flatMap(r => (r.status === 'fulfilled' ? r.value : []))),
  ]);

  const aliases = aliasesFor(ref, symbol);
  const pool = dedupe([...general, ...community]).sort((a, b) => b.publishedAt - a.publishedAt);

  // Actus pertinentes pour le coin
  let relevant = pool.filter(it => itemMatchesCoin(it, aliases));
  // Repli : si trop peu d'actus ciblées, on garde le marché crypto général récent
  if (relevant.length < 3) {
    const extra = pool.filter(it => !relevant.includes(it)).slice(0, 6 - relevant.length);
    relevant = [...relevant, ...extra];
  }
  relevant = relevant.slice(0, 12);

  const macro = dedupe(macroAll).sort((a, b) => b.publishedAt - a.publishedAt).slice(0, 5);

  // ── Sentiment : score sur titres + extraits des actus pertinentes ──
  let raw = 0;
  const posCat = new Set<string>();
  const negCat = new Set<string>();
  for (const it of relevant) {
    const { s, hitsPos, hitsNeg } = scoreText(`${it.title} ${it.snippet}`);
    // le titre pèse plus : on re-score le titre seul et on l'ajoute
    const th = scoreText(it.title);
    raw += s + th.s;
    hitsPos.forEach(w => posCat.add(w));
    hitsNeg.forEach(w => negCat.add(w));
  }
  const n = Math.max(relevant.length, 1);
  // normalise en -100..100 (borne douce)
  const score = Math.max(-100, Math.min(100, Math.round((raw / n) * 40)));
  const sentiment: NewsBundle['sentiment'] = score >= 12 ? 'bullish' : score <= -12 ? 'bearish' : 'neutral';
  const totalHits = posCat.size + negCat.size;
  const confidence: NewsBundle['confidence'] = relevant.length >= 6 && totalHits >= 5 ? 'élevée' : relevant.length >= 3 && totalHits >= 2 ? 'moyenne' : 'faible';

  const catalysts: string[] = [];
  if (posCat.size) catalysts.push(`Signaux haussiers : ${Array.from(posCat).slice(0, 5).join(', ')}`);
  if (negCat.size) catalysts.push(`Signaux baissiers : ${Array.from(negCat).slice(0, 5).join(', ')}`);

  const label = sentiment === 'bullish' ? 'plutôt haussier' : sentiment === 'bearish' ? 'plutôt baissier' : 'neutre / mitigé';
  const summary = relevant.length
    ? `Sur ${relevant.length} actus récentes concernant ${symbol}, le ton médiatique ressort ${label} (score ${score >= 0 ? '+' : ''}${score}, confiance ${confidence}).`
    : `Aucune actualité récente clairement rattachée à ${symbol} n'a été trouvée dans les flux publics.`;

  const bundle: NewsBundle = {
    symbol, coinLabel, sentiment, score, confidence, summary, catalysts,
    items: relevant, macro, fetchedAt: Date.now(),
  };
  cacheSet(cacheKey, bundle);
  return bundle;
}

/** Rend le bundle en bloc Markdown compact pour le contexte d'un agent IA. */
export function newsBundleToContext(b: NewsBundle): string {
  const lines: string[] = [];
  lines.push(`### Actu & sentiment — ${b.symbol}`);
  lines.push(`- Sentiment médiatique: ${b.sentiment} (score ${b.score >= 0 ? '+' : ''}${b.score}/100, confiance ${b.confidence})`);
  if (b.catalysts.length) lines.push(`- Catalyseurs: ${b.catalysts.join(' | ')}`);
  const heads = b.items.slice(0, 6).map(it => `  • [${it.source}] ${it.title}`);
  if (heads.length) lines.push(`- Titres récents:\n${heads.join('\n')}`);
  if (b.macro.length) {
    const m = b.macro.slice(0, 3).map(it => `  • [${it.source}] ${it.title}`);
    lines.push(`- Contexte macro/marché:\n${m.join('\n')}`);
  }
  return lines.join('\n');
}
