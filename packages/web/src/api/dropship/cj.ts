// ─── CJ Dropshipping API client (v2) ─────────────────────────────────────────
// Docs : https://developers.cjdropshipping.cn
// Base : https://developers.cjdropshipping.com/api2.0/v1
// Auth : POST /authentication/getAccessToken {email, password=API key}
//        → accessToken valable 15 jours (header CJ-Access-Token)
//
// Flux full-auto :
//   1. Recherche produit        → GET  /product/list?productNameEn=...
//   2. Détails + variantes      → GET  /product/query?pid=...  +  /product/variant/query?pid=...
//   3. Calcul frais de port     → POST /logistic/freightCalculate
//   4. Passer commande          → POST /shopping/order/createOrderV2 (payée par le SOLDE CJ)
//   5. Suivi                    → GET  /shopping/order/getOrderDetail?orderId=...
//
// IMPORTANT : createOrder DÉPENSE le solde CJ de l'utilisateur. Le mode dry-run
// (simulation sans dépense) est géré au niveau fulfillment, jamais ici.

export interface CjConfig {
  email: string;    // e-mail du compte CJ
  apiKey: string;   // clé API générée dans CJ → My CJ → Authorization
  baseUrl?: string; // défaut https://developers.cjdropshipping.com/api2.0/v1
}

export interface CjResult<T = any> {
  ok: boolean;
  status: number;
  data: T | null;
  message?: string;
  error?: any;
}

function base(cfg: CjConfig): string {
  return (cfg.baseUrl || 'https://developers.cjdropshipping.com/api2.0/v1').replace(/\/+$/, '');
}

// ─── Token (15 jours) — cache mémoire par e-mail ───
type TokenEntry = { token: string; expiresAt: number };
const tokenCache = new Map<string, TokenEntry>();

export async function getAccessToken(cfg: CjConfig, force = false): Promise<CjResult<string>> {
  if (!cfg.email || !cfg.apiKey) {
    return { ok: false, status: 401, data: null, message: 'Identifiants CJ manquants (CJ_EMAIL + CJ_API_KEY)' };
  }
  const cached = tokenCache.get(cfg.email);
  if (!force && cached && cached.expiresAt > Date.now()) {
    return { ok: true, status: 200, data: cached.token };
  }
  try {
    const res = await fetch(`${base(cfg)}/authentication/getAccessToken`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: cfg.email, password: cfg.apiKey }),
    });
    const json: any = await res.json().catch(() => null);
    const token = json?.data?.accessToken;
    if (!res.ok || !json?.result || !token) {
      return { ok: false, status: res.status, data: null, message: json?.message || 'Authentification CJ refusée', error: json };
    }
    // Marge de sécurité : on renouvelle après 14 jours au lieu de 15.
    tokenCache.set(cfg.email, { token, expiresAt: Date.now() + 14 * 24 * 3600 * 1000 });
    return { ok: true, status: 200, data: token };
  } catch (e: any) {
    return { ok: false, status: 0, data: null, message: e?.message || 'Erreur réseau CJ (auth)', error: e };
  }
}

async function request<T = any>(
  cfg: CjConfig,
  method: 'GET' | 'POST',
  path: string,
  opts?: { query?: Record<string, string | number | undefined>; body?: any; _retried?: boolean },
): Promise<CjResult<T>> {
  const tok = await getAccessToken(cfg);
  if (!tok.ok || !tok.data) return { ok: false, status: tok.status, data: null, message: tok.message, error: tok.error };

  let url = `${base(cfg)}/${path.replace(/^\/+/, '')}`;
  if (opts?.query) {
    const qs = new URLSearchParams();
    for (const [k, v] of Object.entries(opts.query)) if (v !== undefined && v !== null && v !== '') qs.set(k, String(v));
    const s = qs.toString();
    if (s) url += `?${s}`;
  }
  try {
    const res = await fetch(url, {
      method,
      headers: { 'CJ-Access-Token': tok.data, 'Content-Type': 'application/json' },
      body: opts?.body != null ? JSON.stringify(opts.body) : undefined,
    });
    const json: any = await res.json().catch(() => null);
    // Token expiré/invalide → un seul retry avec token neuf.
    if (!opts?._retried && json && (json.code === 1600200 || json.code === 1600201 || /token/i.test(String(json.message || '')) && !json.result)) {
      tokenCache.delete(cfg.email);
      return request<T>(cfg, method, path, { ...opts, _retried: true });
    }
    if (!res.ok || (json && json.result === false)) {
      return { ok: false, status: res.status, data: (json?.data ?? null) as T, message: json?.message || `Erreur CJ HTTP ${res.status}`, error: json };
    }
    return { ok: true, status: res.status, data: (json?.data ?? json ?? null) as T, message: json?.message };
  } catch (e: any) {
    return { ok: false, status: 0, data: null, message: e?.message || 'Erreur réseau CJ', error: e };
  }
}

// ─── Recherche produits ───
// productNameEn : mots-clés ANGLAIS. countryCode (ex. 'US') filtre les entrepôts.
export interface CjSearchParams {
  keywords: string;
  pageNum?: number;
  pageSize?: number;       // max 200, défaut 20
  categoryId?: string;
  countryCode?: string;    // entrepôt : US, DE, FR...
  minPrice?: number;
  maxPrice?: number;
}
export const searchProducts = (cfg: CjConfig, p: CjSearchParams) =>
  request(cfg, 'GET', 'product/list', {
    query: {
      productNameEn: p.keywords,
      pageNum: p.pageNum ?? 1,
      pageSize: p.pageSize ?? 20,
      categoryId: p.categoryId,
      countryCode: p.countryCode,
      minPrice: p.minPrice,
      maxPrice: p.maxPrice,
    },
  });

// ─── Détails d'un produit (description, images, poids...) ───
export const getProduct = (cfg: CjConfig, pid: string) =>
  request(cfg, 'GET', 'product/query', { query: { pid } });

// ─── Variantes (vid = identifiant à envoyer dans createOrder) ───
export const getVariants = (cfg: CjConfig, pid: string) =>
  request(cfg, 'GET', 'product/variant/query', { query: { pid } });

// ─── Stock par variante et par entrepôt ───
export const getVariantStock = (cfg: CjConfig, vid: string) =>
  request(cfg, 'GET', 'product/stock/queryByVid', { query: { vid } });

// ─── Frais + délais de livraison (choix de la logistique) ───
export interface CjFreightParams {
  startCountryCode: string; // ex. 'CN' ou entrepôt 'US'
  endCountryCode: string;   // pays du client
  products: { quantity: number; vid: string }[];
}
export const freightCalculate = (cfg: CjConfig, p: CjFreightParams) =>
  request(cfg, 'POST', 'logistic/freightCalculate', { body: p });

// ─── Créer une commande (DÉPENSE LE SOLDE CJ) ───
export interface CjOrderInput {
  orderNumber: string;      // notre référence (id de la table orders)
  shippingCountryCode: string;
  shippingCountry?: string;
  shippingProvince: string;
  shippingCity: string;
  shippingAddress: string;
  shippingAddress2?: string;
  shippingCustomerName: string;
  shippingZip: string;
  shippingPhone: string;
  logisticName: string;     // ex. 'CJPacket Ordinary' (issu de freightCalculate)
  fromCountryCode?: string; // entrepôt d'expédition, ex. 'CN' / 'US'
  houseNumber?: string;
  email?: string;
  remark?: string;
  products: { quantity: number; vid: string }[];
  payType?: number;         // 2 = payer avec le solde (balance) → full-auto
}
export const createOrder = (cfg: CjConfig, order: CjOrderInput) =>
  request(cfg, 'POST', 'shopping/order/createOrderV2', { body: { ...order, payType: order.payType ?? 2 } });

// ─── Payer une commande créée non payée (si payType différé) ───
export const payOrderByBalance = (cfg: CjConfig, orderId: string) =>
  request(cfg, 'POST', 'shopping/pay/payBalance', { body: { orderId } });

// ─── Suivi d'une commande ───
export const getOrderDetail = (cfg: CjConfig, orderId: string) =>
  request(cfg, 'GET', 'shopping/order/getOrderDetail', { query: { orderId } });

// ─── Solde du compte (garde-fou avant createOrder) ───
export const getBalance = (cfg: CjConfig) =>
  request(cfg, 'GET', 'shopping/pay/getBalance');

// ─── Suivi logistique par numéro de tracking ───
export const getTrackInfo = (cfg: CjConfig, trackNumber: string) =>
  request(cfg, 'GET', 'logistic/getTrackInfo', { query: { trackNumber } });

// ─── Helpers métier ───────────────────────────────────────────────────────────

// Prix de vente conseillé : marge cible ×2.5-3, arrondi psychologique .99
export function suggestedRetail(costUsd: number): number {
  const raw = costUsd < 5 ? costUsd * 3 : costUsd < 20 ? costUsd * 2.8 : costUsd * 2.5;
  return Math.max(4.99, Math.floor(raw) + 0.99);
}

// Normalise un produit de la réponse product/list en candidat de sourcing.
export interface CjCandidate {
  pid: string;
  name: string;
  imageUrl: string | null;
  costPrice: number | null;      // USD (sellPrice CJ = notre coût)
  suggestedRetail: number | null;
  categoryName: string | null;
  listedNum: number | null;      // popularité (nb de fois listé par des vendeurs)
  raw: any;
}
export function toCandidate(item: any): CjCandidate {
  // sellPrice peut être "3.50" ou "3.50 -- 7.20" (fourchette variantes) → on prend le min.
  const priceStr = String(item?.sellPrice ?? '').split('--')[0].trim();
  const cost = priceStr ? Number.parseFloat(priceStr) : NaN;
  const costPrice = Number.isFinite(cost) ? cost : null;
  return {
    pid: String(item?.pid ?? ''),
    name: String(item?.productNameEn ?? item?.productName ?? 'Produit sans nom'),
    imageUrl: item?.productImage ? String(item.productImage) : null,
    costPrice,
    suggestedRetail: costPrice != null ? suggestedRetail(costPrice) : null,
    categoryName: item?.categoryName ? String(item.categoryName) : null,
    listedNum: item?.listedNum != null ? Number(item.listedNum) : null,
    raw: item,
  };
}
