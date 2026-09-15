// ─── Spécialistes Velbaz (mode « Continuer une company ») ───
// Quand l'utilisateur continue une entreprise existante, il choisit soit TOUTE
// la company (Velbaz pilote tout), soit un ou plusieurs experts spécialisés.
// Seuls les rôles « web » et « all » ont besoin de la preview (site/app) — un
// directeur financier n'a AUCUN rapport avec le site, donc aucun rectangle preview.

export type SpecialistId =
  | 'all'
  | 'web'
  | 'finance'
  | 'marketing'
  | 'sales'
  | 'strategy'
  | 'hr'
  | 'legal'
  | 'operations'
  | 'product'
  | 'crypto_ta'
  | 'crypto_onchain'
  | 'crypto_risk'
  | 'crypto_strategy'
  | 'prediction';

export interface Specialist {
  id: SpecialistId;
  label: string;
  desc: string;
  /** true = ce rôle produit/modifie le site ou l'app → la preview a du sens. */
  hasPreview: boolean;
  /** Brief injecté à l'IA pour qu'elle agisse comme cet expert. */
  brief: string;
}

// Option exclusive : toute l'entreprise (équipe complète).
export const ALL_COMPANY: Specialist = {
  id: 'all',
  label: 'The whole company',
  desc: "Velbaz manages the entire company with all its experts",
  hasPreview: true,
  brief:
    "Take over and grow the ENTIRE company: strategy, website/app, marketing, finance, sales, operations. Coordinate all the experts needed.",
};

// Experts sélectionnables (multi-choix) quand on ne prend pas toute la company.
// NB : « Website & App » (id 'web') n'apparaît PAS ici volontairement — cette
// capacité est incluse automatiquement dans « The whole company » et ne doit pas
// être sélectionnable séparément.
export const SPECIALISTS: Specialist[] = [
  {
    id: 'finance',
    label: 'CFO',
    desc: 'Budget, forecasts, accounting, fundraising',
    hasPreview: false,
    brief:
      "Act as a senior CFO: build budgets, cash-flow forecasts, P&L, margins, pricing, funding plans and concrete quantified scenarios.",
  },
  {
    id: 'marketing',
    label: 'CMO',
    desc: 'Strategy, campaigns, content, SEO, social media',
    hasPreview: false,
    brief:
      "Act as a senior CMO: acquisition strategy, positioning, content calendar, campaigns, SEO, social media, funnels and KPIs.",
  },
  {
    id: 'sales',
    label: 'Sales Director',
    desc: 'Sales, prospecting, CRM, closing',
    hasPreview: false,
    brief:
      "Act as a sales director: sales process, prospecting scripts, CRM management, pipeline, pitches and closing techniques.",
  },
  {
    id: 'strategy',
    label: 'Strategy & Business plan',
    desc: 'Vision, business model, roadmap',
    hasPreview: false,
    brief:
      "Act as a strategy consultant: vision, business model, competitive analysis, positioning, roadmap and priorities.",
  },
  {
    id: 'hr',
    label: 'Human Resources',
    desc: 'Recruitment, organization, culture',
    hasPreview: false,
    brief:
      "Act as an HR director: org chart, job descriptions, recruitment, onboarding, compensation and company culture.",
  },
  {
    id: 'legal',
    label: 'Legal',
    desc: 'Contracts, compliance, GDPR, bylaws',
    hasPreview: false,
    brief:
      "Act as a corporate lawyer: entity choice, contracts, terms of service/sale, GDPR compliance, intellectual property (informational, not official legal advice).",
  },
  {
    id: 'operations',
    label: 'Operations',
    desc: 'Processes, logistics, suppliers',
    hasPreview: false,
    brief:
      "Act as an operations director: process optimization, logistics, suppliers, quality and productivity.",
  },
  {
    id: 'product',
    label: 'Product',
    desc: 'Product roadmap, features, UX',
    hasPreview: false,
    brief:
      "Act as a head of product: user discovery, roadmap, feature prioritization, UX and product metrics.",
  },
  {
    id: 'crypto_ta',
    label: 'Crypto Technical Analyst',
    desc: 'Charts, candlesticks, RSI, MACD, patterns',
    hasPreview: false,
    brief:
      "Act as an expert crypto technical analyst: read candlestick charts, identify trends, chart patterns, support/resistance and indicator signals (RSI, MACD, moving averages, Bollinger). ALWAYS display the chart via the [COIN_CHART:SYMBOL:INTERVAL] directive and NEVER make up market numbers. End every analysis with a disclaimer (not financial advice).",
  },
  {
    id: 'crypto_onchain',
    label: 'Crypto On-chain Analyst',
    desc: 'Exchange flows, funding, network activity',
    hasPreview: false,
    brief:
      "Act as a crypto on-chain analyst: interpret exchange inflows/outflows, funding rates, open interest, address activity and long-term holder behavior as sentiment signals (never certainties). Don't make up data; stay cautious and remind of the risk.",
  },
  {
    id: 'crypto_risk',
    label: 'Trading Risk Management',
    desc: 'Position sizing, stop-loss, risk/reward',
    hasPreview: false,
    brief:
      "Act as a trading risk manager: position sizing, systematic stop-loss, risk/reward ratio ≥ 1:2, leverage management, diversification and emotional discipline. Capital protection comes before gains. Always remind that nothing is guaranteed.",
  },
  {
    id: 'crypto_strategy',
    label: 'Crypto Trading Strategist',
    desc: 'Market scenarios, portfolio, paper/live modes',
    hasPreview: false,
    brief:
      "Act as a crypto trading strategist: synthesize technical, on-chain and risk analysis into clear market scenarios and a plan (DCA, swing, day-trading). Manage the portfolio in analysis/paper/live mode via the trading endpoints. Every prediction stays cautious and ends with a disclaimer: this is not financial advice.",
  },
  {
    id: 'prediction',
    label: 'Predictive Analyst (markets)',
    desc: 'Polymarket, probabilities, elections, economy, sports — grounded in reality',
    hasPreview: false,
    brief:
      "Act as a predictive analyst: when asked to estimate the probability of a future event (election, Fed decision, IPO, sports, price level being crossed, Polymarket market…), emit the [PREDICT:subject] directive (subject preferably in English). The backend fetches the REAL Polymarket odds (real-money probability) and recent real news. You NEVER make up a percentage: you comment on the real odds and news, explain the factors, then conclude cautiously. Always remind that a prediction stays uncertain (not a guarantee).",
  },
];

// Défini mais masqué de la liste visible : sert uniquement à résoudre label/brief
// si une ancienne session contenait 'web' (la capacité est incluse dans 'all').
const WEB_EXPERT: Specialist = {
  id: 'web',
  label: 'Website & App',
  desc: 'Creation and improvement of the website / application',
  hasPreview: true,
  brief:
    "Act as a product lead & engineer: analyze the existing site, propose and apply improvements to the site/app (design, pages, content, conversion).",
};

export function getSpecialist(id: SpecialistId): Specialist | undefined {
  if (id === 'all') return ALL_COMPANY;
  if (id === 'web') return WEB_EXPERT;
  return SPECIALISTS.find((s) => s.id === id);
}

/** La preview (site/app) n'a de sens que si un rôle « web »/« all » est choisi. */
export function needsPreview(ids: SpecialistId[]): boolean {
  if (!ids || ids.length === 0) return false;
  if (ids.includes('all')) return true;
  return ids.some((id) => getSpecialist(id)?.hasPreview);
}

export function specialistLabels(ids: SpecialistId[]): string[] {
  return ids.map((id) => getSpecialist(id)?.label || id);
}

/** Config transmise du home au chat via sessionStorage. */
export interface ContinueConfig {
  url: string;
  description: string;
  specialists: SpecialistId[];
}

export const CONTINUE_STORAGE_KEY = 'velbaz_continue';

/**
 * Compose le message initial (visible, naturel) envoyé au chat depuis le
 * mode « Continuer une company ». Donne à l'IA l'URL à analyser, les experts
 * demandés et la description — sans jargon technique visible.
 */
/**
 * Normalise une URL saisie à la main : ajoute `https://` si le protocole
 * manque (ex. « base44.com » → « https://base44.com »). Indispensable pour que
 * la détection du clone (extractUrls → wantsDeepClone) ET le scraping Firecrawl
 * fonctionnent, car tous deux exigent un préfixe http(s)://.
 */
export function normalizeUrl(raw: string): string {
  const u = raw.trim();
  if (!u) return u;
  if (/^https?:\/\//i.test(u)) return u;
  return `https://${u.replace(/^\/+/, '')}`;
}

export function buildContinueMessage(cfg: ContinueConfig): string {
  const isAll = cfg.specialists.includes('all');
  const url = normalizeUrl(cfg.url);
  const lines: string[] = [];
  lines.push(
    isAll
      ? "I want to continue and grow my existing business."
      : "I want help with my existing business."
  );
  if (url) {
    lines.push(
      `Here is my company's website: ${url}\n` +
      `Analyze it thoroughly and gather all the information: clone it identically (design, colors, fonts, layout, all pages, navigation and all assets). Reproduce the site faithfully.`
    );
  }
  // ── Détection du VRAI type d'entreprise (règle stricte, évite les hallucinations) ──
  // L'IA doit d'abord comprendre ce que fait réellement l'entreprise à partir du
  // site, et NE PAS supposer qu'elle vend des produits physiques. Beaucoup de
  // projets sont des apps / SaaS / outils IA SANS aucun produit à vendre.
  lines.push(
    "IMPORTANT — first understand what this business REALLY is before acting: " +
    "analyze the site to determine its true nature (app / SaaS / AI tool, service, or physical-products brand). " +
    "NEVER make up products, a catalog, product pages or product campaigns if the business doesn't sell any. " +
    "If it's an app or an AI tool without a physical product, do NOT talk about \"product generation\" or product marketing — work on what actually makes sense for this type of business (the app itself, its features, user acquisition, etc.)."
  );
  const briefs = cfg.specialists.map((id) => getSpecialist(id)?.brief).filter(Boolean);
  if (isAll) {
    lines.push(ALL_COMPANY.brief);
  } else if (briefs.length > 0) {
    const labels = specialistLabels(cfg.specialists).join(', ');
    lines.push(`I need these experts: ${labels}.`);
    lines.push(briefs.join(' '));
    lines.push(
      "Focus ONLY on these areas. Do NOT build a website unless I explicitly ask for it."
    );
  }
  if (cfg.description.trim()) {
    lines.push(`Context / what I want: ${cfg.description.trim()}`);
  }
  // ── Autonomie totale au démarrage (règle stricte) ──
  // Bug corrigé : l'IA s'arrêtait au début et attendait que l'utilisateur dise
  // « continue ». Elle doit démarrer IMMÉDIATEMENT et enchaîner seule jusqu'au
  // bout, sans pause ni demande de confirmation superflue.
  lines.push(
    "START IMMEDIATELY and work with FULL AUTONOMY until the end, without stopping and without asking me to say \"continue\". " +
    "Chain all the steps yourself (analysis → site clone → work on the business). " +
    "Do NOT ask questions and do NOT show any confirmation pop-up at startup: act directly. " +
    "Only ask me for help if some information is truly essential and cannot be found on the site."
  );
  return lines.join('\n');
}
