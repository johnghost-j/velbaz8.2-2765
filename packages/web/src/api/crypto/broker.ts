// ─── Broker de trading crypto (paper + live) ────────────────────────────────
// ⚠️ ARGENT RÉEL en mode "live". Garde-fous :
//   - mode par défaut = "paper" (portefeuille simulé aux VRAIS prix, 0 risque).
//   - "live" exige des clés exchange fournies par l'utilisateur (popup "secret")
//     et une confirmation explicite côté chat/UI avant chaque ordre réel.
//   - ccxt est importé DYNAMIQUEMENT (uniquement en live) pour ne pas alourdir le boot.
import { db } from '../database/index';
import * as schema from '../database/schema';
import { eq, desc, and } from 'drizzle-orm';
import { v4 as uuidv4 } from 'uuid';
import { getQuote, resolveCoin } from './market';
import { importOptional } from '../lib/optional-import';

export type TradingMode = 'analyse' | 'paper' | 'live';
export interface Holding { qty: number; avgPrice: number }
export type Holdings = Record<string, Holding>;

export interface Portfolio {
  id: string;
  companyId: string;
  mode: TradingMode;
  quoteAsset: string;
  cash: number;
  holdings: Holdings;
  realizedPnl: number;
  exchange: string;
}

const DEFAULT_PAPER_CASH = 10000;

function parseHoldings(raw: string | null | undefined): Holdings {
  if (!raw) return {};
  try { const h = JSON.parse(raw); return h && typeof h === 'object' ? h : {}; } catch { return {}; }
}

/** Récupère (ou crée) le portefeuille d'une entreprise. */
export async function getPortfolio(companyId: string): Promise<Portfolio> {
  const row = await db.select().from(schema.tradingPortfolios)
    .where(eq(schema.tradingPortfolios.companyId, companyId)).get();
  if (row) {
    return {
      id: row.id,
      companyId: row.companyId,
      mode: (row.mode as TradingMode) || 'paper',
      quoteAsset: row.quoteAsset || 'USDT',
      cash: row.cash ?? DEFAULT_PAPER_CASH,
      holdings: parseHoldings(row.holdings),
      realizedPnl: row.realizedPnl ?? 0,
      exchange: row.exchange || 'binance',
    };
  }
  const id = uuidv4();
  await db.insert(schema.tradingPortfolios).values({
    id, companyId, mode: 'paper', quoteAsset: 'USDT',
    cash: DEFAULT_PAPER_CASH, holdings: '{}', realizedPnl: 0, exchange: 'binance',
  });
  return { id, companyId, mode: 'paper', quoteAsset: 'USDT', cash: DEFAULT_PAPER_CASH, holdings: {}, realizedPnl: 0, exchange: 'binance' };
}

/** Lecture seule : renvoie le portfolio SEULEMENT s'il existe déjà (n'en crée
 * jamais). Sert à savoir si le trading autonome est activé pour une entreprise
 * sans forcer la création d'un portefeuille paper par défaut. */
export async function getPortfolioIfExists(companyId: string): Promise<Portfolio | null> {
  const row = await db.select().from(schema.tradingPortfolios)
    .where(eq(schema.tradingPortfolios.companyId, companyId)).get();
  if (!row) return null;
  return {
    id: row.id,
    companyId: row.companyId,
    mode: (row.mode as TradingMode) || 'paper',
    quoteAsset: row.quoteAsset || 'USDT',
    cash: row.cash ?? DEFAULT_PAPER_CASH,
    holdings: parseHoldings(row.holdings),
    realizedPnl: row.realizedPnl ?? 0,
    exchange: row.exchange || 'binance',
  };
}

async function savePortfolio(p: Portfolio) {
  await db.update(schema.tradingPortfolios).set({
    mode: p.mode, quoteAsset: p.quoteAsset, cash: p.cash,
    holdings: JSON.stringify(p.holdings), realizedPnl: p.realizedPnl,
    exchange: p.exchange, updatedAt: new Date(),
  }).where(eq(schema.tradingPortfolios.id, p.id));
}

/** Change le mode (analyse/paper/live). live nécessite des clés (vérifié à l'ordre). */
export async function setMode(companyId: string, mode: TradingMode): Promise<Portfolio> {
  const p = await getPortfolio(companyId);
  p.mode = mode;
  await savePortfolio(p);
  return p;
}

export interface OrderResult {
  ok: boolean;
  status: 'filled' | 'rejected' | 'error';
  side: 'buy' | 'sell';
  symbol: string;
  qty: number;
  price: number;
  cost: number;
  note?: string;
  orderId?: string;
  portfolio?: Portfolio;
}

interface PlaceOrderInput {
  companyId: string;
  side: 'buy' | 'sell';
  symbol: string;         // "BTC" ou "BTC/USDT"
  // Un seul des deux : qty (base asset) ou quoteAmount (montant en USDT à dépenser).
  qty?: number;
  quoteAmount?: number;
}

/** Récupère les secrets exchange (mode live) sans les exposer. */
async function getExchangeKeys(companyId: string, exchange: string): Promise<{ apiKey: string; secret: string } | null> {
  const rows = await db.select({ key: schema.companySecrets.key, value: schema.companySecrets.value })
    .from(schema.companySecrets).where(eq(schema.companySecrets.companyId, companyId));
  const map: Record<string, string> = {};
  for (const r of rows) map[r.key] = r.value;
  const ex = exchange.toUpperCase();
  const apiKey = map[`${ex}_API_KEY`] || map['EXCHANGE_API_KEY'];
  const secret = map[`${ex}_API_SECRET`] || map['EXCHANGE_API_SECRET'];
  if (apiKey && secret) return { apiKey, secret };
  return null;
}

/** Passe un ordre (paper simulé aux vrais prix, ou live via ccxt). */
export async function placeOrder(input: PlaceOrderInput): Promise<OrderResult> {
  const p = await getPortfolio(input.companyId);
  const ref = await resolveCoin(input.symbol);
  if (!ref) return { ok: false, status: 'rejected', side: input.side, symbol: input.symbol, qty: 0, price: 0, cost: 0, note: `Crypto introuvable : ${input.symbol}` };
  const base = ref.label.split('/')[0];

  const quote = await getQuote(input.symbol);
  if (!quote || !quote.price) return { ok: false, status: 'error', side: input.side, symbol: ref.label, qty: 0, price: 0, cost: 0, note: 'Prix marché indisponible' };
  const price = quote.price;

  // Quantité à traiter (base asset)
  let qty = input.qty ?? 0;
  if (!qty && input.quoteAmount) qty = input.quoteAmount / price;
  if (!qty || qty <= 0) return { ok: false, status: 'rejected', side: input.side, symbol: ref.label, qty: 0, price, cost: 0, note: 'Quantité invalide' };
  const cost = qty * price;

  // ── Mode LIVE : ordres réels via ccxt ──
  if (p.mode === 'live') {
    const keys = await getExchangeKeys(input.companyId, p.exchange);
    if (!keys) {
      return { ok: false, status: 'rejected', side: input.side, symbol: ref.label, qty, price, cost, note: `Clés ${p.exchange} manquantes — connecte ${p.exchange.toUpperCase()}_API_KEY / _API_SECRET via le popup sécurisé avant de trader en réel.` };
    }
    try {
      const ccxtMod: any = await importOptional('ccxt');
      const ccxt = ccxtMod.default ?? ccxtMod;
      const ExClass = ccxt[p.exchange];
      if (!ExClass) throw new Error(`Exchange non supporté : ${p.exchange}`);
      const ex = new ExClass({ apiKey: keys.apiKey, secret: keys.secret, enableRateLimit: true });
      const order = await ex.createOrder(ref.label, 'market', input.side, qty);
      const filledPrice = Number(order.average || order.price || price);
      const filledCost = Number(order.cost || filledPrice * qty);
      await recordOrder(input.companyId, 'live', ref.label, input.side, qty, filledPrice, filledCost, 'filled', String(order.id || ''), 'Ordre réel exécuté');
      return { ok: true, status: 'filled', side: input.side, symbol: ref.label, qty, price: filledPrice, cost: filledCost, note: 'Ordre réel exécuté', orderId: String(order.id || '') };
    } catch (e: any) {
      const msg = e?.message || 'Erreur exchange';
      await recordOrder(input.companyId, 'live', ref.label, input.side, qty, price, cost, 'error', undefined, msg);
      return { ok: false, status: 'error', side: input.side, symbol: ref.label, qty, price, cost, note: msg };
    }
  }

  // ── Mode PAPER : portefeuille simulé aux VRAIS prix ──
  if (input.side === 'buy') {
    if (cost > p.cash + 1e-9) {
      return { ok: false, status: 'rejected', side: 'buy', symbol: ref.label, qty, price, cost, note: `Solde insuffisant (dispo ${p.cash.toFixed(2)} ${p.quoteAsset}, requis ${cost.toFixed(2)})` };
    }
    p.cash -= cost;
    const h = p.holdings[base] || { qty: 0, avgPrice: 0 };
    const newQty = h.qty + qty;
    h.avgPrice = newQty > 0 ? (h.avgPrice * h.qty + cost) / newQty : price;
    h.qty = newQty;
    p.holdings[base] = h;
  } else {
    const h = p.holdings[base];
    if (!h || h.qty < qty - 1e-9) {
      return { ok: false, status: 'rejected', side: 'sell', symbol: ref.label, qty, price, cost, note: `Position insuffisante (détenu ${h?.qty ?? 0} ${base})` };
    }
    p.cash += cost;
    p.realizedPnl += (price - h.avgPrice) * qty;
    h.qty -= qty;
    if (h.qty <= 1e-9) delete p.holdings[base];
    else p.holdings[base] = h;
  }
  await savePortfolio(p);
  await recordOrder(input.companyId, 'paper', ref.label, input.side, qty, price, cost, 'filled', undefined, 'Ordre simulé (paper) au prix réel');
  return { ok: true, status: 'filled', side: input.side, symbol: ref.label, qty, price, cost, note: 'Ordre simulé (paper) au prix réel', portfolio: p };
}

async function recordOrder(companyId: string, mode: string, symbol: string, side: string, qty: number, price: number, cost: number, status: string, exchangeOrderId?: string, note?: string) {
  await db.insert(schema.tradingOrders).values({
    id: uuidv4(), companyId, mode, symbol, side, qty, price, cost, status,
    note: note ?? null, exchangeOrderId: exchangeOrderId ?? null,
  });
}

export async function getOrders(companyId: string, limit = 50) {
  return db.select().from(schema.tradingOrders)
    .where(eq(schema.tradingOrders.companyId, companyId))
    .orderBy(desc(schema.tradingOrders.createdAt)).limit(limit);
}

/** Valeur du portefeuille au marché (marque les positions aux vrais prix). */
export async function getPortfolioValue(companyId: string): Promise<{ portfolio: Portfolio; marketValue: number; totalEquity: number; positions: Array<{ base: string; qty: number; avgPrice: number; price: number; value: number; unrealizedPnl: number }> }> {
  const p = await getPortfolio(companyId);
  const positions: Array<{ base: string; qty: number; avgPrice: number; price: number; value: number; unrealizedPnl: number }> = [];
  let marketValue = 0;
  for (const [base, h] of Object.entries(p.holdings)) {
    const q = await getQuote(base);
    const price = q?.price ?? h.avgPrice;
    const value = h.qty * price;
    marketValue += value;
    positions.push({ base, qty: h.qty, avgPrice: h.avgPrice, price, value, unrealizedPnl: (price - h.avgPrice) * h.qty });
  }
  return { portfolio: p, marketValue, totalEquity: p.cash + marketValue, positions };
}
