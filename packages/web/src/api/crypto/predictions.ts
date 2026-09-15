// ─── Marchés de prédiction RÉELS (Polymarket) + actu réelle (aucune invention) ─
// Objectif : donner à l'IA un spécialiste « prédiction » ancré sur des DONNÉES
// réelles, pas sur son imagination. Deux sources publiques et sans clé :
//   1) Polymarket (Gamma API) : les cotes = la probabilité estimée EN TEMPS RÉEL
//      par des milliers de parieurs qui misent de l'argent réel. C'est le signal
//      quantitatif le plus fort qui existe pour prédire un évènement.
//   2) Google Actualités (flux RSS) : les titres récents réels sur le sujet, pour
//      « connecter » la prédiction à l'actualité (élection, crypto, sport, éco…).
//
// Le modèle ne fabrique JAMAIS une probabilité : il commente les cotes réelles du
// marché et les titres réels, puis conclut prudemment. Utilisé par (1) le chat via
// la directive [PREDICT:sujet] et (2) l'endpoint GET /api/crypto/predict.

export interface PredictionOutcome {
  label: string;       // "Oui" / "Non" / nom du candidat…
  probability: number; // 0..1 (part implicite du marché)
}

export interface PredictionMarket {
  question: string;
  outcomes: PredictionOutcome[];
  volume: number;      // volume total en $ (profondeur / fiabilité du signal)
  liquidity: number;
  endDate: string | null;
  url: string;         // lien vers le marché Polymarket
  closed: boolean;
}

export interface PredictionHeadline {
  title: string;
  source: string;
  url: string;
  publishedAt: number; // epoch ms (0 si inconnu)
}

export interface PredictionBundle {
  query: string;
  markets: PredictionMarket[];   // marchés réels, triés par volume décroissant
  headlines: PredictionHeadline[]; // actus réelles récentes sur le sujet
  topProbability: number | null; // proba implicite du marché le plus liquide (0..1)
  topStatement: string | null;   // phrase factuelle sur ce marché principal
  summary: string;               // synthèse FR ancrée sur le réel
  hasData: boolean;
  fetchedAt: number;
}

// ── Cache court en mémoire ──
const cache = new Map<string, { at: number; data: unknown }>();
function cacheGet<T>(key: string, ttlMs: number): T | null {
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < ttlMs) return hit.data as T;
  return null;
}
function cacheSet(key: string, data: unknown) {
  cache.set(key, { at: Date.now(), data });
  if (cache.size > 200) {
    const entries = [...cache.entries()].sort((a, b) => a[1].at - b[1].at);
    for (let i = 0; i < 40; i++) { const e = entries[i]; if (e) cache.delete(e[0]); }
  }
}

const UA = { 'User-Agent': 'Mozilla/5.0 (compatible; Velbaz/1.0; +predict)' } as const;

async function fetchText(url: string, timeoutMs = 9000): Promise<string> {
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
async function fetchJson<T = any>(url: string, timeoutMs = 9000): Promise<T> {
  const ctrl = new AbortController();
  const to = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { headers: UA, signal: ctrl.signal, redirect: 'follow' });
    if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
    return (await res.json()) as T;
  } finally {
    clearTimeout(to);
  }
}

function decodeEntities(s: string): string {
  return (s || '')
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&#(\d+);/g, (_, d) => { try { return String.fromCodePoint(parseInt(d, 10)); } catch { return ' '; } })
    .replace(/\s+/g, ' ')
    .trim();
}

// ─────────────────────────── Polymarket ───────────────────────────
function safeParseArray(raw: unknown): string[] {
  if (Array.isArray(raw)) return raw.map((x) => String(x));
  if (typeof raw === 'string') {
    try { const p = JSON.parse(raw); return Array.isArray(p) ? p.map((x) => String(x)) : []; } catch { return []; }
  }
  return [];
}

function normalizeOutcomeLabel(label: string): string {
  const l = label.trim().toLowerCase();
  if (l === 'yes') return 'Oui';
  if (l === 'no') return 'Non';
  return label.trim();
}

function marketFromRaw(m: any, eventSlug: string | null): PredictionMarket | null {
  const outcomes = safeParseArray(m?.outcomes);
  const prices = safeParseArray(m?.outcomePrices).map((p) => Number(p));
  if (!outcomes.length || outcomes.length !== prices.length) return null;
  const pairs: PredictionOutcome[] = outcomes
    .map((label, i) => ({ label: normalizeOutcomeLabel(label), probability: Number.isFinite(prices[i]) ? Math.max(0, Math.min(1, prices[i])) : 0 }))
    .sort((a, b) => b.probability - a.probability);
  const volume = Number(m?.volume) || Number(m?.volume24hr) || 0;
  const slug = m?.slug || eventSlug;
  return {
    question: String(m?.question || m?.groupItemTitle || '').trim() || 'Marché',
    outcomes: pairs,
    volume,
    liquidity: Number(m?.liquidity) || 0,
    endDate: m?.endDate || null,
    url: slug ? `https://polymarket.com/event/${eventSlug || slug}` : 'https://polymarket.com',
    closed: !!m?.closed,
  };
}

/** Recherche des marchés Polymarket réels correspondant au sujet. */
export async function getPredictionMarkets(query: string, limit = 8): Promise<PredictionMarket[]> {
  const q = query.trim();
  if (!q) return [];
  const key = `pm:${q.toLowerCase()}`;
  const cached = cacheGet<PredictionMarket[]>(key, 3 * 60_000);
  if (cached) return cached;

  const url = `https://gamma-api.polymarket.com/public-search?q=${encodeURIComponent(q)}&limit_per_type=12&events_status=active`;
  let events: any[] = [];
  try {
    const data = await fetchJson<any>(url);
    events = Array.isArray(data?.events) ? data.events : [];
  } catch {
    events = [];
  }

  const markets: PredictionMarket[] = [];
  for (const ev of events) {
    const slug = ev?.slug || null;
    const evMarkets = Array.isArray(ev?.markets) ? ev.markets : [];
    for (const m of evMarkets) {
      if (m?.closed || m?.archived) continue;
      const pm = marketFromRaw(m, slug);
      if (pm && pm.outcomes.length) markets.push(pm);
    }
  }
  // Pertinence : nombre de mots du sujet présents dans la question (min 3 lettres),
  // puis volume. Évite qu'un marché à gros volume mais hors-sujet passe en tête.
  const terms = q.toLowerCase().split(/[^a-z0-9]+/).filter((t) => t.length >= 3);
  const relevance = (m: PredictionMarket): number => {
    const hay = m.question.toLowerCase();
    return terms.reduce((n, t) => (hay.includes(t) ? n + 1 : n), 0);
  };
  // dédup par question + tri (pertinence desc, puis volume desc)
  const seen = new Set<string>();
  const out: PredictionMarket[] = [];
  for (const m of markets.sort((a, b) => (relevance(b) - relevance(a)) || (b.volume - a.volume))) {
    const k = m.question.toLowerCase().slice(0, 90);
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(m);
    if (out.length >= limit) break;
  }
  cacheSet(key, out);
  return out;
}

// ─────────────────────────── Actu (Google News RSS) ───────────────────────────
export async function getTopicNews(query: string, limit = 6): Promise<PredictionHeadline[]> {
  const q = query.trim();
  if (!q) return [];
  const key = `gn:${q.toLowerCase()}`;
  const cached = cacheGet<PredictionHeadline[]>(key, 10 * 60_000);
  if (cached) return cached;

  const url = `https://news.google.com/rss/search?q=${encodeURIComponent(q)}&hl=fr&gl=FR&ceid=FR:fr`;
  let xml = '';
  try { xml = await fetchText(url); } catch { xml = ''; }
  const items: PredictionHeadline[] = [];
  const re = /<item>([\s\S]*?)<\/item>/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml)) !== null && items.length < 40) {
    const block = m[1];
    const titleRaw = /<title>([\s\S]*?)<\/title>/.exec(block)?.[1] || '';
    const link = /<link>([\s\S]*?)<\/link>/.exec(block)?.[1] || '';
    const pub = /<pubDate>([\s\S]*?)<\/pubDate>/.exec(block)?.[1] || '';
    const src = /<source[^>]*>([\s\S]*?)<\/source>/.exec(block)?.[1] || '';
    let title = decodeEntities(titleRaw);
    let source = decodeEntities(src);
    // Google News suffixe souvent le titre par " - Source"
    if (!source && title.includes(' - ')) {
      const idx = title.lastIndexOf(' - ');
      source = title.slice(idx + 3).trim();
      title = title.slice(0, idx).trim();
    } else if (source && title.endsWith(` - ${source}`)) {
      title = title.slice(0, title.length - source.length - 3).trim();
    }
    const publishedAt = pub ? Date.parse(pub) || 0 : 0;
    if (title) items.push({ title, source: source || 'Google Actualités', url: decodeEntities(link), publishedAt });
  }
  const sorted = items.sort((a, b) => b.publishedAt - a.publishedAt).slice(0, limit);
  cacheSet(key, sorted);
  return sorted;
}

// ─────────────────────────── Prédiction combinée ───────────────────────────
function pct(x: number): string { return `${Math.round(x * 100)}%`; }

export async function buildPrediction(query: string): Promise<PredictionBundle> {
  const q = query.trim();
  const key = `pred:${q.toLowerCase()}`;
  const cached = cacheGet<PredictionBundle>(key, 3 * 60_000);
  if (cached) return cached;

  const [markets, headlines] = await Promise.all([
    getPredictionMarkets(q).catch(() => [] as PredictionMarket[]),
    getTopicNews(q).catch(() => [] as PredictionHeadline[]),
  ]);

  // Marché principal = le plus liquide (signal le plus fiable)
  const top = markets[0] || null;
  let topProbability: number | null = null;
  let topStatement: string | null = null;
  if (top && top.outcomes.length) {
    const lead = top.outcomes[0];
    topProbability = lead.probability;
    topStatement = `Marché « ${top.question} » : le résultat le plus probable est « ${lead.label} » à ${pct(lead.probability)} (volume ${Math.round(top.volume).toLocaleString('fr-FR')} $).`;
  }

  let summary: string;
  if (top) {
    summary = `Polymarket recense ${markets.length} marché(s) réel(s) sur ce sujet. ${topStatement} Ces probabilités reflètent des paris en argent réel, pas une opinion. `
      + (headlines.length ? `${headlines.length} actus récentes ont été rattachées au sujet pour contextualiser.` : `Aucune actualité récente n'a pu être rattachée automatiquement.`);
  } else if (headlines.length) {
    summary = `Aucun marché de prédiction Polymarket trouvé pour « ${q} ». Analyse fondée uniquement sur ${headlines.length} actus récentes réelles — probabilité qualitative, à interpréter avec prudence.`;
  } else {
    summary = `Aucun marché de prédiction ni actualité récente n'a été trouvé pour « ${q} ». Impossible de fonder une prédiction sur des données réelles.`;
  }

  const bundle: PredictionBundle = {
    query: q,
    markets,
    headlines,
    topProbability,
    topStatement,
    summary,
    hasData: markets.length > 0 || headlines.length > 0,
    fetchedAt: Date.now(),
  };
  cacheSet(key, bundle);
  return bundle;
}

/** Rend le bundle en bloc Markdown compact pour le contexte d'un agent IA. */
export function predictionToContext(b: PredictionBundle): string {
  const lines: string[] = [];
  lines.push(`### Prédiction — « ${b.query} » (données réelles)`);
  if (b.markets.length) {
    lines.push(`- Marchés Polymarket (cotes = probabilité en argent réel) :`);
    for (const m of b.markets.slice(0, 6)) {
      const o = m.outcomes.slice(0, 3).map((x) => `${x.label} ${pct(x.probability)}`).join(' · ');
      lines.push(`  • ${m.question} → ${o} (vol ${Math.round(m.volume).toLocaleString('fr-FR')} $)`);
    }
  } else {
    lines.push(`- Aucun marché Polymarket trouvé pour ce sujet.`);
  }
  if (b.headlines.length) {
    lines.push(`- Actus récentes réelles :`);
    for (const h of b.headlines.slice(0, 5)) lines.push(`  • [${h.source}] ${h.title}`);
  }
  lines.push(`- Règle : commente ces probabilités réelles et ces titres, ne fabrique AUCUN chiffre, conclus prudemment (pas une certitude).`);
  return lines.join('\n');
}
