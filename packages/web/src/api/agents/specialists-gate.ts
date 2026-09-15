// ─── Gating des spécialités d'agents (builder Velbaz) ─────────────────────────
// L'utilisateur choisit les spécialistes de son équipe au démarrage
// (mode « Continuer une company » — voir web/lib/specialists.ts).
// Quand, DANS LE CHAT, il demande une spécialité qu'il N'A PAS choisie, l'IA ne
// répond PAS à côté : elle lui dit poliment que ce spécialiste n'est pas dans son
// équipe et propose un bouton pour l'ajouter. Le bouton (front) réactive l'agent
// et REJOUE automatiquement la demande initiale.
//
// Ce module est volontairement autonome (aucune dépendance à l'orchestrateur)
// et miroir des IDs de spécialistes du front, pour rester cohérent des deux côtés.

/** IDs de spécialistes — identiques au front (web/lib/specialists.ts). */
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

interface SpecialistDef {
  id: SpecialistId;
  /** Libellé humain (FR) affiché dans le message et sur le bouton. */
  label: string;
  labelEn: string;
  /** Détection : la demande relève de cette spécialité si l'un de ces motifs matche. */
  detect: RegExp;
}

// Spécialités « métier » gatables (jamais 'web'/'all' : le site/app n'est jamais bloqué).
// L'ordre compte : on renvoie la PREMIÈRE spécialité qui matche.
const GATABLE: SpecialistDef[] = [
  {
    id: 'crypto_ta',
    label: 'Analyste technique crypto',
    labelEn: 'Crypto Technical Analyst',
    detect: /(\b(analyse\s*technique|chandelier\w*|candlestick|bougie\w*|rsi\b|macd\b|moyenne\w*\s*mobile\w*|bollinger|fibonacci|support\s*(et|\/)?\s*r[ée]sistance|figure\s*chartiste|breakout|golden\s*cross|death\s*cross|tendance\s*(haussi[èe]re|baissi[èe]re)|timeframe)\b|\b(analys\w*|graphique\w*|cours|prix|acheter|vendre|trad(e|er|ing)\w*|invest\w*|prédi\w*|pr[ée]vision\w*)\b[\s\S]{0,40}\b(bitcoin|btc|ethereum|eth|crypto\w*|altcoin\w*|solana|\bsol\b|dogecoin|doge|token\w*|coin\b|bnb|xrp|cardano|ada\b)\b|\b(bitcoin|btc|ethereum|crypto\w*|altcoin\w*|solana|dogecoin)\b[\s\S]{0,40}\b(analys\w*|graphique\w*|cours|prix|acheter|vendre|trad(e|er|ing)\w*|monter|baisser|pump\w*|dump\w*)\b|\btrading\s*(de\s*)?(crypto|bitcoin|btc|eth|ethereum)\b)/i,
  },
  {
    id: 'crypto_onchain',
    label: 'Analyste on-chain crypto',
    labelEn: 'Crypto On-chain Analyst',
    detect: /\b(on[- ]?chain|flux\s*(des\s*)?exchanges?|exchange\s*(in|out)flows?|funding\s*rate\w*|open\s*interest|adresses?\s*actives?|whale\w*|baleine\w*|offre\s*en\s*circulation|hodl\w*|d[ée]tenteurs?\s*long\s*terme|glassnode|mvrv|sopr\b|hash\s*rate)\b/i,
  },
  {
    id: 'crypto_risk',
    label: 'Gestion du risque trading',
    labelEn: 'Trading Risk Manager',
    detect: /\b(gestion\s*du\s*risque|risk\s*management|position\s*sizing|taille\s*de\s*position|stop[- ]?loss|take[- ]?profit|ratio\s*risque[- /]?rendement|risk[- /]?reward|money\s*management|effet\s*de\s*levier|leverage|liquidation|drawdown|diversification\s*(du\s*)?portefeuille\s*crypto)\b/i,
  },
  {
    id: 'crypto_strategy',
    label: 'Stratège trading crypto',
    labelEn: 'Crypto Trading Strategist',
    detect: /\b(strat[ée]gie\s*(de\s*)?(trading|crypto|d'investissement\s*crypto)|prédi\w*\s*(le\s*)?(cours|prix)|pr[ée]vision\w*\s*(du\s*)?(btc|bitcoin|eth|cours\s*crypto)|scénario\w*\s*(de\s*)?march[ée]\s*crypto|day[- ]?trading|swing\s*trading|scalping|dca\b|dollar\s*cost\s*averaging|portefeuille\s*crypto|acheter\s*ou\s*vendre\s*(du|le)\s*(btc|bitcoin|eth|crypto)|paper\s*trading)\b/i,
  },
  {
    id: 'prediction',
    label: 'Analyste prédictif (marchés)',
    labelEn: 'Predictive Analyst (markets)',
    detect: /\b(polymarket|march[ée]s?\s*de\s*pr[ée]diction|prediction\s*markets?|cote\w*\s*(de\s*)?pari|pronostic\w*|pronostiqu\w*)\b|\b(quelles?\s*(chances?|probabilit[ée]s?)|proba(bilit[ée])?\s*(que|qu'|de)|odds\s*(of|that)|chances?\s*(que|qu'|de))\b|\b(pr[ée]di\w*|pr[ée]vision\w*|pr[ée]voir|estimer?\s*(la\s*)?probabilit[ée])\b[\s\S]{0,40}\b([ée]lection\w*|pr[ée]sidentielle|scrutin|r[ée]f[ée]rendum|match\w*|coupe\s*du\s*monde|championnat|vainqueur|gagnant\w*|r[ée]sultat\w*|\bfed\b|taux\s*(d'int[ée]r[êe]t|directeur\w*)|inflation|\bipo\b|introduction\s*en\s*bourse|oscar\w*|guerre|cessez[- ]le[- ]feu)\b|\b(qui\s*va\s*(gagner|remporter)|va[- ]t[- ]il\s*(gagner|remporter|[êe]tre\s*[ée]lu))\b/i,
  },
  {
    id: 'finance',
    label: 'Directeur financier',
    labelEn: 'CFO (Finance)',
    detect: /\b(financ\w*|budget\w*|pr[ée]vision\w*|comptab\w*|tr[ée]sorerie|cash[- ]?flow|pricing|tarif\w*|marge\w*|p&l|profit\s*(and|et)\s*loss|rentabilit[ée]|break[- ]?even|point mort|lev[ée]e?\s*de\s*fonds|fundrais\w*|investisseur\w*|valorisation|unit\s*economics|cac\b|ltv\b)\b/i,
  },
  {
    id: 'marketing',
    label: 'Directeur marketing',
    labelEn: 'CMO (Marketing)',
    detect: /\b(marketing|pub(licit[ée])?\b|ad\s*copy|campagne\w*|campaign\w*|seo\b|sea\b|r[ée]f[ée]rencement|acquisition|growth\b|r[ée]seaux\s*sociaux|social\s*media|newsletter|e[- ]?mailing|email\s*marketing|tunnel\w*|funnel\w*|positionnement|persona\w*|calendrier\s*(de\s*)?contenu|content\s*plan)\b/i,
  },
  {
    id: 'sales',
    label: 'Directeur commercial',
    labelEn: 'Head of Sales',
    detect: /\b(vente\w*|commercial\w*|prospection|prospect\w*|crm\b|closing|clore\s*(une|des)\s*ventes?|pipeline\s*(commercial|de\s*ventes?)|argumentaire\w*|cold\s*(call|email)|d[ée]marchage|n[ée]gociation\s*commerciale|deal\w*)\b/i,
  },
  {
    id: 'strategy',
    label: 'Stratégie & Business plan',
    labelEn: 'Strategy & Business plan',
    detect: /\b(strat[ée]gie?\w*|business\s*plan|plan\s*d'affaires|mod[èe]le\s*[ée]conomique|business\s*model|roadmap|feuille\s*de\s*route|analyse\s*concurren\w*|concurrent\w*|competitor\w*|[ée]tude\s*de\s*march[ée]|market\s*research|vision\s*(d'entreprise|business)|swot|go[- ]to[- ]market|gtm\b)\b/i,
  },
  {
    id: 'hr',
    label: 'Ressources humaines',
    labelEn: 'HR',
    detect: /\b(rh\b|ressources\s*humaines|recrut\w*|embauch\w*|hiring|fiche\s*de\s*poste|job\s*description|organigramme|onboarding|int[ée]gration\s*(des\s*)?(salari[ée]s|employ[ée]s)|paie\b|r[ée]mun[ée]ration|culture\s*d'entreprise|management\s*(d'|des\s*)[ée]quipe)\b/i,
  },
  {
    id: 'legal',
    label: 'Juridique',
    labelEn: 'Legal',
    detect: /\b(juri\w*|legal|l[ée]gal\w*|contrat\w*|rgpd|gdpr|cgv|cgu|mentions\s*l[ée]gales|statut\w*\s*(juridique|d'entreprise)?|immatricul\w*|conformit[ée]|compliance|propri[ée]t[ée]\s*intellectuelle|marque\s*d[ée]pos[ée]e|licence\w*\s*(d'exploitation)?)\b/i,
  },
  {
    id: 'operations',
    label: 'Opérations',
    labelEn: 'Operations',
    detect: /\b(op[ée]rations?\b|logistique|supply\s*chain|cha[îi]ne\s*d'approvisionnement|fournisseur\w*|stock\w*|inventaire|process\w*\s*(m[ée]tier|interne|op[ée]rationnel)?|productivit[ée]|qualit[ée]\s*(process|op[ée]rationnelle)|exp[ée]dition|entrep[ôo]t)\b/i,
  },
  {
    id: 'product',
    label: 'Produit',
    labelEn: 'Product',
    detect: /\b(product\s*(management|manager|owner)|head\s*of\s*product|roadmap\s*produit|priorisation\s*(des\s*)?features?|d[ée]couverte\s*utilisateur|user\s*research|user\s*stor(y|ies)|backlog|m[ée]triques?\s*produit|product\s*market\s*fit|pmf\b)\b/i,
  },
];

const BY_ID: Record<string, SpecialistDef> = Object.fromEntries(GATABLE.map((s) => [s.id, s]));

/** Normalise une liste de spécialistes (venue du front ou de la DB en JSON). */
export function parseSpecialists(raw: unknown): SpecialistId[] {
  if (!raw) return [];
  let arr: any = raw;
  if (typeof raw === 'string') {
    try { arr = JSON.parse(raw); } catch { return []; }
  }
  if (!Array.isArray(arr)) return [];
  return arr.filter((x): x is SpecialistId => typeof x === 'string');
}

/**
 * L'équipe couvre-t-elle TOUT ? (aucune restriction de gating)
 * - liste vide  → pas de choix explicite → on ne bloque rien (rétro-compat).
 * - 'all'       → toute la company → tout est autorisé.
 */
export function coversEverything(enabled: SpecialistId[]): boolean {
  return !enabled || enabled.length === 0 || enabled.includes('all');
}

/** Détecte la spécialité MÉTIER requise par un message (jamais 'web'/'all'). */
export function detectNeededSpecialist(message: string): SpecialistId | null {
  const m = message || '';
  for (const s of GATABLE) {
    if (s.detect.test(m)) return s.id;
  }
  return null;
}

/**
 * Faut-il bloquer cette demande ? Renvoie la spécialité manquante à proposer,
 * ou null si la demande passe (spécialité présente, équipe complète, ou hors
 * périmètre métier — ex. une demande sur le site/app n'est jamais gatée).
 */
export function specialistToOffer(message: string, enabled: SpecialistId[]): SpecialistId | null {
  if (coversEverything(enabled)) return null;
  const needed = detectNeededSpecialist(message);
  if (!needed) return null;
  if (enabled.includes(needed)) return null;
  return needed;
}

/** Message de refus poli + marqueur `[ADD_SPECIALIST:id]` que le front rend en bouton. */
export function buildGateMessage(id: SpecialistId, lang: 'fr' | 'en'): string {
  const def = BY_ID[id];
  const label = lang === 'fr' ? (def?.label || id) : (def?.labelEn || id);
  const body = lang === 'fr'
    ? `Ça relève du **${label}**, et il ne fait pas encore partie de ton équipe (tu ne l'as pas choisi au démarrage). ` +
      `Je ne veux pas te répondre à moitié sur un domaine qui n'est pas le mien. ` +
      `Ajoute ce spécialiste et je reprends ta demande tout de suite.`
    : `That's a job for the **${label}**, who isn't on your team yet (you didn't pick this specialist at the start). ` +
      `I don't want to half-answer outside my scope. ` +
      `Add this specialist and I'll pick your request right back up.`;
  // Marqueur machine-lisible pour le front : [ADD_SPECIALIST:id|Label]
  return `${body}\n\n[ADD_SPECIALIST:${id}|${label}]`;
}

export function specialistLabel(id: SpecialistId, lang: 'fr' | 'en' = 'fr'): string {
  const def = BY_ID[id];
  return lang === 'fr' ? (def?.label || id) : (def?.labelEn || id);
}
