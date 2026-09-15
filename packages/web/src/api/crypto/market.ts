// ─── Données de marché crypto RÉELLES + indicateurs (aucune donnée simulée) ───
// Source primaire : Binance API publique (klines OHLCV, sans clé).
// Repli / résolution des coins : CoinGecko API publique (sans clé).
// Les indicateurs (RSI, MACD, MA, Bollinger, supports/résistances) sont calculés
// ICI, côté serveur — le modèle ne devine JAMAIS un chiffre, il commente du réel.

export interface Candle {
  o: number;
  h: number;
  l: number;
  c: number;
  v: number;
  t: number; // epoch ms (temps d'ouverture de la bougie)
}

export interface Quote {
  symbol: string;      // ex. "BTC/USDT"
  price: number;
  changePct24h: number;
  high24h: number;
  low24h: number;
  volume24h: number;   // volume en quote asset (USDT)
  source: 'binance' | 'coingecko';
}

export interface Indicators {
  trend: 'bullish' | 'bearish' | 'neutral';
  rsi14: number | null;
  macd: { macd: number; signal: number; histogram: number } | null;
  sma20: number | null;
  sma50: number | null;
  sma200: number | null;
  ema20: number | null;
  bollinger: { upper: number; middle: number; lower: number } | null;
  support: number | null;
  resistance: number | null;
}

export interface MarketData {
  symbol: string;      // "BTC/USDT"
  pair: string;        // "BTCUSDT" (binance)
  interval: string;    // "1d"
  candles: Candle[];
  indicators: Indicators;
  quote: Quote | null;
  source: 'binance' | 'coingecko';
}

// ── Cache court en mémoire pour respecter les limites de débit (TTL par clé) ──
const cache = new Map<string, { at: number; data: unknown }>();
function cacheGet<T>(key: string, ttlMs: number): T | null {
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < ttlMs) return hit.data as T;
  return null;
}
function cacheSet(key: string, data: unknown) {
  cache.set(key, { at: Date.now(), data });
  if (cache.size > 500) {
    // purge grossière : on vide les plus vieux
    const entries = [...cache.entries()].sort((a, b) => a[1].at - b[1].at);
    for (let i = 0; i < 100; i++) cache.delete(entries[i][0]);
  }
}

// ── Intervalles supportés (mappe timeframe UI → interval Binance + jours CoinGecko) ──
const INTERVAL_MAP: Record<string, { binance: string; cgDays: number; ms: number }> = {
  '1h': { binance: '1h', cgDays: 2, ms: 3600_000 },
  '4h': { binance: '4h', cgDays: 14, ms: 4 * 3600_000 },
  '1d': { binance: '1d', cgDays: 90, ms: 86400_000 },
  '1w': { binance: '1w', cgDays: 365, ms: 7 * 86400_000 },
};
export function normalizeInterval(raw?: string): keyof typeof INTERVAL_MAP {
  const k = (raw || '1d').toLowerCase();
  if (k === '1d' || k === 'day' || k === 'daily' || k === '1j') return '1d';
  if (k === '1h' || k === 'hour' || k === '60m') return '1h';
  if (k === '4h') return '4h';
  if (k === '1w' || k === 'week' || k === 'weekly' || k === '1s') return '1w';
  return (INTERVAL_MAP[k] ? (k as keyof typeof INTERVAL_MAP) : '1d');
}

const UA = { 'User-Agent': 'Velbaz/1.0 (+market)' } as const;

async function fetchJson(url: string, timeoutMs = 8000): Promise<any> {
  const ctrl = new AbortController();
  const to = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { headers: UA, signal: ctrl.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
    return await res.json();
  } finally {
    clearTimeout(to);
  }
}

// ─── Résolution d'un coin : texte utilisateur → symbole Binance + id CoinGecko ───
// On maintient une petite table statique pour les cas fréquents (rapide, hors-ligne),
// puis on complète via la liste CoinGecko (couvre TOUTES les cryptos).
const COMMON: Record<string, { binance: string; cg: string; label: string }> = {
  btc: { binance: 'BTCUSDT', cg: 'bitcoin', label: 'BTC/USDT' },
  bitcoin: { binance: 'BTCUSDT', cg: 'bitcoin', label: 'BTC/USDT' },
  eth: { binance: 'ETHUSDT', cg: 'ethereum', label: 'ETH/USDT' },
  ethereum: { binance: 'ETHUSDT', cg: 'ethereum', label: 'ETH/USDT' },
  sol: { binance: 'SOLUSDT', cg: 'solana', label: 'SOL/USDT' },
  solana: { binance: 'SOLUSDT', cg: 'solana', label: 'SOL/USDT' },
  bnb: { binance: 'BNBUSDT', cg: 'binancecoin', label: 'BNB/USDT' },
  xrp: { binance: 'XRPUSDT', cg: 'ripple', label: 'XRP/USDT' },
  ada: { binance: 'ADAUSDT', cg: 'cardano', label: 'ADA/USDT' },
  cardano: { binance: 'ADAUSDT', cg: 'cardano', label: 'ADA/USDT' },
  doge: { binance: 'DOGEUSDT', cg: 'dogecoin', label: 'DOGE/USDT' },
  dogecoin: { binance: 'DOGEUSDT', cg: 'dogecoin', label: 'DOGE/USDT' },
  avax: { binance: 'AVAXUSDT', cg: 'avalanche-2', label: 'AVAX/USDT' },
  matic: { binance: 'MATICUSDT', cg: 'matic-network', label: 'MATIC/USDT' },
  polygon: { binance: 'MATICUSDT', cg: 'matic-network', label: 'MATIC/USDT' },
  link: { binance: 'LINKUSDT', cg: 'chainlink', label: 'LINK/USDT' },
  dot: { binance: 'DOTUSDT', cg: 'polkadot', label: 'DOT/USDT' },
  ltc: { binance: 'LTCUSDT', cg: 'litecoin', label: 'LTC/USDT' },
  litecoin: { binance: 'LTCUSDT', cg: 'litecoin', label: 'LTC/USDT' },
};

export interface CoinRef {
  binance: string; // "BTCUSDT"
  cg: string;      // "bitcoin"
  label: string;   // "BTC/USDT"
}

let cgListCache: { at: number; list: Array<{ id: string; symbol: string; name: string }> } | null = null;
async function getCoinGeckoList(): Promise<Array<{ id: string; symbol: string; name: string }>> {
  if (cgListCache && Date.now() - cgListCache.at < 6 * 3600_000) return cgListCache.list;
  try {
    const list = await fetchJson('https://api.coingecko.com/api/v3/coins/list');
    if (Array.isArray(list)) {
      cgListCache = { at: Date.now(), list };
      return list;
    }
  } catch { /* réseau : on garde l'ancien cache si présent */ }
  return cgListCache?.list ?? [];
}

/** Résout une requête libre ("bitcoin", "$eth", "SOL/USDT") vers un CoinRef. */
export async function resolveCoin(query: string): Promise<CoinRef | null> {
  const raw = (query || '').trim().toLowerCase().replace(/[$]/g, '');
  if (!raw) return null;

  // "btc/usdt" ou "btcusdt"
  const pairMatch = raw.replace(/[^a-z0-9]/g, '');
  if (COMMON[raw]) return COMMON[raw];

  // clé directe par symbole court
  const short = raw.split(/[/\-\s]/)[0];
  if (COMMON[short]) return COMMON[short];

  // Recherche CoinGecko (couvre toutes les cryptos)
  const list = await getCoinGeckoList();
  let found = list.find((c) => c.symbol.toLowerCase() === short || c.id === raw || c.name.toLowerCase() === raw);
  if (!found) found = list.find((c) => c.name.toLowerCase().includes(raw) && raw.length > 2);
  if (found) {
    const sym = found.symbol.toUpperCase();
    return { binance: `${sym}USDT`, cg: found.id, label: `${sym}/USDT` };
  }

  // Dernier recours : suppose une paire USDT si ça ressemble à un ticker
  if (/^[a-z0-9]{2,10}$/.test(pairMatch)) {
    const sym = pairMatch.toUpperCase();
    return { binance: `${sym}USDT`, cg: '', label: `${sym}/USDT` };
  }
  return null;
}

// ─────────────────────────── Bougies (OHLCV) ───────────────────────────
async function fetchBinanceKlines(pair: string, interval: string, limit: number): Promise<Candle[]> {
  const url = `https://api.binance.com/api/v3/klines?symbol=${encodeURIComponent(pair)}&interval=${interval}&limit=${limit}`;
  const rows = await fetchJson(url);
  if (!Array.isArray(rows)) throw new Error('binance: réponse invalide');
  // [ openTime, open, high, low, close, volume, closeTime, quoteVolume, ... ]
  return rows.map((r: any[]) => ({
    t: Number(r[0]),
    o: Number(r[1]),
    h: Number(r[2]),
    l: Number(r[3]),
    c: Number(r[4]),
    v: Number(r[7] ?? r[5]), // volume en quote asset (USDT) si dispo, sinon base
  }));
}

async function fetchCoinGeckoOHLC(cgId: string, days: number): Promise<Candle[]> {
  if (!cgId) throw new Error('coingecko: id manquant');
  const url = `https://api.coingecko.com/api/v3/coins/${encodeURIComponent(cgId)}/ohlc?vs_currency=usd&days=${days}`;
  const rows = await fetchJson(url);
  if (!Array.isArray(rows)) throw new Error('coingecko: réponse invalide');
  // [ time, open, high, low, close ] — pas de volume → 0
  return rows.map((r: any[]) => ({ t: Number(r[0]), o: Number(r[1]), h: Number(r[2]), l: Number(r[3]), c: Number(r[4]), v: 0 }));
}

// ─────────────────────────── Cotation spot ───────────────────────────
async function fetchBinanceQuote(pair: string): Promise<Quote> {
  const url = `https://api.binance.com/api/v3/ticker/24hr?symbol=${encodeURIComponent(pair)}`;
  const d = await fetchJson(url);
  return {
    symbol: pair.replace(/USDT$/, '/USDT'),
    price: Number(d.lastPrice),
    changePct24h: Number(d.priceChangePercent),
    high24h: Number(d.highPrice),
    low24h: Number(d.lowPrice),
    volume24h: Number(d.quoteVolume),
    source: 'binance',
  };
}

async function fetchCoinGeckoQuote(cgId: string, label: string): Promise<Quote> {
  const url = `https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&ids=${encodeURIComponent(cgId)}`;
  const arr = await fetchJson(url);
  const d = Array.isArray(arr) ? arr[0] : null;
  if (!d) throw new Error('coingecko: cotation vide');
  return {
    symbol: label,
    price: Number(d.current_price),
    changePct24h: Number(d.price_change_percentage_24h),
    high24h: Number(d.high_24h),
    low24h: Number(d.low_24h),
    volume24h: Number(d.total_volume),
    source: 'coingecko',
  };
}

// ─────────────────────────── Indicateurs ───────────────────────────
function sma(vals: number[], period: number): number | null {
  if (vals.length < period) return null;
  const slice = vals.slice(-period);
  return slice.reduce((a, b) => a + b, 0) / period;
}

function emaSeries(vals: number[], period: number): number[] {
  if (vals.length === 0) return [];
  const k = 2 / (period + 1);
  const out: number[] = [];
  let prev = vals[0];
  out.push(prev);
  for (let i = 1; i < vals.length; i++) {
    prev = vals[i] * k + prev * (1 - k);
    out.push(prev);
  }
  return out;
}

function ema(vals: number[], period: number): number | null {
  if (vals.length < period) return null;
  const s = emaSeries(vals, period);
  return s[s.length - 1] ?? null;
}

function rsi(vals: number[], period = 14): number | null {
  if (vals.length < period + 1) return null;
  let gains = 0;
  let losses = 0;
  for (let i = vals.length - period; i < vals.length; i++) {
    const diff = vals[i] - vals[i - 1];
    if (diff >= 0) gains += diff;
    else losses -= diff;
  }
  const avgGain = gains / period;
  const avgLoss = losses / period;
  if (avgLoss === 0) return 100;
  const rs = avgGain / avgLoss;
  return 100 - 100 / (1 + rs);
}

function macd(vals: number[]): { macd: number; signal: number; histogram: number } | null {
  if (vals.length < 35) return null;
  const ema12 = emaSeries(vals, 12);
  const ema26 = emaSeries(vals, 26);
  const macdLine: number[] = [];
  for (let i = 0; i < vals.length; i++) macdLine.push(ema12[i] - ema26[i]);
  const signalLine = emaSeries(macdLine, 9);
  const m = macdLine[macdLine.length - 1];
  const s = signalLine[signalLine.length - 1];
  return { macd: m, signal: s, histogram: m - s };
}

function bollinger(vals: number[], period = 20, mult = 2): { upper: number; middle: number; lower: number } | null {
  if (vals.length < period) return null;
  const slice = vals.slice(-period);
  const mean = slice.reduce((a, b) => a + b, 0) / period;
  const variance = slice.reduce((a, b) => a + (b - mean) ** 2, 0) / period;
  const sd = Math.sqrt(variance);
  return { upper: mean + mult * sd, middle: mean, lower: mean - mult * sd };
}

// Supports / résistances via pivots swing (fractals simples sur high/low)
function supportResistance(candles: Candle[]): { support: number | null; resistance: number | null } {
  if (candles.length < 5) return { support: null, resistance: null };
  const price = candles[candles.length - 1].c;
  const highs: number[] = [];
  const lows: number[] = [];
  for (let i = 2; i < candles.length - 2; i++) {
    const h = candles[i].h;
    const l = candles[i].l;
    if (h > candles[i - 1].h && h > candles[i - 2].h && h > candles[i + 1].h && h > candles[i + 2].h) highs.push(h);
    if (l < candles[i - 1].l && l < candles[i - 2].l && l < candles[i + 1].l && l < candles[i + 2].l) lows.push(l);
  }
  // résistance = pivot haut le plus proche AU-DESSUS du prix ; support = pivot bas le plus proche EN-DESSOUS
  const resAbove = highs.filter((h) => h >= price).sort((a, b) => a - b)[0];
  const supBelow = lows.filter((l) => l <= price).sort((a, b) => b - a)[0];
  return {
    resistance: resAbove ?? (highs.length ? Math.max(...highs) : null),
    support: supBelow ?? (lows.length ? Math.min(...lows) : null),
  };
}

export function computeIndicators(candles: Candle[]): Indicators {
  const closes = candles.map((k) => k.c);
  const _sma20 = sma(closes, 20);
  const _sma50 = sma(closes, 50);
  const _sma200 = sma(closes, 200);
  const _ema20 = ema(closes, 20);
  const price = closes[closes.length - 1] ?? 0;
  const { support, resistance } = supportResistance(candles);

  // Tendance : combinaison prix vs SMA50/200 + pente SMA20
  let trend: Indicators['trend'] = 'neutral';
  if (_sma50 != null && _sma200 != null) {
    if (price > _sma50 && _sma50 > _sma200) trend = 'bullish';
    else if (price < _sma50 && _sma50 < _sma200) trend = 'bearish';
  } else if (_sma20 != null) {
    trend = price > _sma20 ? 'bullish' : 'bearish';
  }

  return {
    trend,
    rsi14: rsi(closes, 14),
    macd: macd(closes),
    sma20: _sma20,
    sma50: _sma50,
    sma200: _sma200,
    ema20: _ema20,
    bollinger: bollinger(closes, 20, 2),
    support,
    resistance,
  };
}

// ─────────────────────── Point d'entrée principal ───────────────────────
/** Récupère bougies réelles + cotation + indicateurs pour un coin/timeframe. */
export async function getMarketData(query: string, intervalRaw?: string, limit = 120): Promise<MarketData | null> {
  const ref = await resolveCoin(query);
  if (!ref) return null;
  const interval = normalizeInterval(intervalRaw);
  const conf = INTERVAL_MAP[interval];
  const lim = Math.max(30, Math.min(500, limit));
  const cacheKey = `md:${ref.binance}:${interval}:${lim}`;
  const cached = cacheGet<MarketData>(cacheKey, 45_000);
  if (cached) return cached;

  let candles: Candle[] = [];
  let source: 'binance' | 'coingecko' = 'binance';
  try {
    candles = await fetchBinanceKlines(ref.binance, conf.binance, lim);
  } catch {
    // Repli CoinGecko (coin exotique ou Binance indisponible)
    try {
      candles = await fetchCoinGeckoOHLC(ref.cg, conf.cgDays);
      source = 'coingecko';
    } catch {
      return null;
    }
  }
  if (!candles.length) return null;

  let quote: Quote | null = null;
  try {
    quote = source === 'binance' ? await fetchBinanceQuote(ref.binance) : await fetchCoinGeckoQuote(ref.cg, ref.label);
  } catch { /* cotation optionnelle */ }

  const data: MarketData = {
    symbol: ref.label,
    pair: ref.binance,
    interval,
    candles,
    indicators: computeIndicators(candles),
    quote,
    source,
  };
  cacheSet(cacheKey, data);
  return data;
}

/** Cotation seule (prix + stats 24 h). */
export async function getQuote(query: string): Promise<Quote | null> {
  const ref = await resolveCoin(query);
  if (!ref) return null;
  const cacheKey = `q:${ref.binance}`;
  const cached = cacheGet<Quote>(cacheKey, 20_000);
  if (cached) return cached;
  let q: Quote | null = null;
  try { q = await fetchBinanceQuote(ref.binance); }
  catch { try { q = await fetchCoinGeckoQuote(ref.cg, ref.label); } catch { q = null; } }
  if (q) cacheSet(cacheKey, q);
  return q;
}

/** Recherche de coins (autocomplete / désambiguïsation). */
export async function searchCoins(q: string, max = 8): Promise<Array<{ id: string; symbol: string; name: string }>> {
  const raw = (q || '').trim().toLowerCase();
  if (!raw) return [];
  const list = await getCoinGeckoList();
  const starts = list.filter((c) => c.symbol.toLowerCase() === raw || c.name.toLowerCase().startsWith(raw));
  const includes = list.filter((c) => c.name.toLowerCase().includes(raw) || c.symbol.toLowerCase().includes(raw));
  const merged = [...starts, ...includes].filter((c, i, a) => a.findIndex((x) => x.id === c.id) === i);
  return merged.slice(0, max);
}
