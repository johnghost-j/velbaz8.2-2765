// ─── Printify API client ─────────────────────────────────────────────────────
// Print-on-demand fulfilment. Docs: https://developers.printify.com
// Auth: Authorization: Bearer <personal_access_token>
// Base: https://api.printify.com/v1
//
// CONTRAIREMENT À CONTRADO, l'API Printify permet un flux 100% automatique :
//   1. Uploader un design           → POST /uploads/images.json (URL ou base64)
//   2. Créer un produit avec design → POST /shops/{shop_id}/products.json
//   3. Publier le produit           → POST /shops/{shop_id}/products/{id}/publish.json
//   4. Passer commande              → POST /shops/{shop_id}/orders.json
//      (peut aussi créer le produit à la volée via blueprint_id + print_areas)
//   5. Suivi fabrication/livraison  → GET /shops/{shop_id}/orders/{id}.json + webhooks
//
// Catalogue = "blueprints" : t-shirts, hoodies, mugs, posters, coques, sacs,
// coussins, cartes... Chaque blueprint a des print_providers, chacun avec ses
// variantes (taille/couleur) et zones imprimables (placeholders).

export interface PrintifyConfig {
  apiToken: string;
  shopId?: string;
  baseUrl?: string; // défaut https://api.printify.com
}

export interface PrintifyResult<T = any> {
  ok: boolean;
  status: number;
  data: T | null;
  message?: string;
  error?: any;
}

function base(cfg: PrintifyConfig): string {
  return (cfg.baseUrl || 'https://api.printify.com').replace(/\/+$/, '');
}

async function request<T = any>(
  cfg: PrintifyConfig,
  method: string,
  path: string,
  body?: any,
): Promise<PrintifyResult<T>> {
  if (!cfg.apiToken) return { ok: false, status: 401, data: null, message: 'Token API Printify manquant' };
  const url = `${base(cfg)}/v1/${path.replace(/^\/+/, '')}`;
  const headers: Record<string, string> = {
    Authorization: `Bearer ${cfg.apiToken}`,
    'Content-Type': 'application/json',
    'User-Agent': 'Velbaz-POD/1.0',
  };
  try {
    const res = await fetch(url, {
      method,
      headers,
      body: body != null ? JSON.stringify(body) : undefined,
    });
    let json: any = null;
    const text = await res.text();
    if (text) { try { json = JSON.parse(text); } catch { json = { raw: text }; } }
    const isErr = json && typeof json === 'object' && json.status === 'error';
    return {
      ok: res.ok && !isErr,
      status: res.status,
      data: (json ?? null) as T,
      message: json?.message,
      error: json?.errors ?? (isErr ? json : undefined),
    };
  } catch (e: any) {
    return { ok: false, status: 0, data: null, message: e?.message || 'Erreur réseau Printify', error: e };
  }
}

function shop(cfg: PrintifyConfig): string {
  return String(cfg.shopId || '').trim();
}

// ─── Shops ───
export const listShops = (cfg: PrintifyConfig) => request(cfg, 'GET', 'shops.json');

// ─── Catalog (blueprints = types de produits) ───
export const listBlueprints = (cfg: PrintifyConfig) => request(cfg, 'GET', 'catalog/blueprints.json');
export const getBlueprint = (cfg: PrintifyConfig, id: string | number) => request(cfg, 'GET', `catalog/blueprints/${id}.json`);
export const getBlueprintProviders = (cfg: PrintifyConfig, id: string | number) => request(cfg, 'GET', `catalog/blueprints/${id}/print_providers.json`);
export const getBlueprintVariants = (cfg: PrintifyConfig, blueprintId: string | number, providerId: string | number) =>
  request(cfg, 'GET', `catalog/blueprints/${blueprintId}/print_providers/${providerId}/variants.json`);
export const getBlueprintShipping = (cfg: PrintifyConfig, blueprintId: string | number, providerId: string | number) =>
  request(cfg, 'GET', `catalog/blueprints/${blueprintId}/print_providers/${providerId}/shipping.json`);
export const listPrintProviders = (cfg: PrintifyConfig) => request(cfg, 'GET', 'catalog/print_providers.json');

// ─── Uploads (design → media library) ───
// Renvoie { id, file_name, width, height, preview_url, ... } ; on garde l'id.
export const uploadImageByUrl = (cfg: PrintifyConfig, fileName: string, url: string) =>
  request(cfg, 'POST', 'uploads/images.json', { file_name: fileName, url });
export const uploadImageByBase64 = (cfg: PrintifyConfig, fileName: string, contents: string) =>
  request(cfg, 'POST', 'uploads/images.json', { file_name: fileName, contents });
export const archiveUpload = (cfg: PrintifyConfig, imageId: string) => request(cfg, 'POST', `uploads/${imageId}/archive.json`);
export const listUploads = (cfg: PrintifyConfig, page = 1, limit = 20) => request(cfg, 'GET', `uploads.json?page=${page}&limit=${limit}`);

// ─── Products ───
// Motif répété (pattern) appliqué à un calque image — doc officielle Printify.
export interface PrintifyImagePattern {
  spacing_x: number;     // relatif à la largeur (1 = pas d'espacement)
  spacing_y: number;     // relatif à la hauteur
  angle: number;         // -45..45
  offset: number;        // -1..1 (0.5 = motif "brique")
}
export interface PrintifyPlaceholderImage {
  id: string;            // image_id renvoyé par uploadImage*
  x?: number;            // 0..1 (centre par défaut 0.5)
  y?: number;
  scale?: number;
  angle?: number;
  pattern?: PrintifyImagePattern;
}
export interface PrintifyPlaceholder {
  position: string;      // ex "front", "back"
  images: PrintifyPlaceholderImage[];
}
export interface PrintifyPrintArea {
  variant_ids: number[];
  placeholders: PrintifyPlaceholder[];
}
export interface PrintifyVariantInput {
  id: number;
  price: number;         // en centimes (ex 2500 = 25.00)
  is_enabled?: boolean;
}
export interface PrintifyProductInput {
  title: string;
  description: string;
  blueprint_id: number;
  print_provider_id: number;
  variants: PrintifyVariantInput[];
  print_areas: PrintifyPrintArea[];
  safety_information?: string;
}
export const listProducts = (cfg: PrintifyConfig, page = 1, limit = 20) =>
  request(cfg, 'GET', `shops/${shop(cfg)}/products.json?page=${page}&limit=${limit}`);
export const getProduct = (cfg: PrintifyConfig, productId: string) =>
  request(cfg, 'GET', `shops/${shop(cfg)}/products/${productId}.json`);
export const createProduct = (cfg: PrintifyConfig, product: PrintifyProductInput) =>
  request(cfg, 'POST', `shops/${shop(cfg)}/products.json`, product);
export const updateProduct = (cfg: PrintifyConfig, productId: string, patch: Partial<PrintifyProductInput>) =>
  request(cfg, 'PUT', `shops/${shop(cfg)}/products/${productId}.json`, patch);
export const deleteProduct = (cfg: PrintifyConfig, productId: string) =>
  request(cfg, 'DELETE', `shops/${shop(cfg)}/products/${productId}.json`);
export const publishProduct = (cfg: PrintifyConfig, productId: string, external?: Record<string, boolean>) =>
  request(cfg, 'POST', `shops/${shop(cfg)}/products/${productId}/publish.json`, external ?? {
    title: true, description: true, images: true, variants: true, tags: true, keyFeatures: true, shipping_template: true,
  });

// ─── Orders ───
export interface PrintifyAddress {
  first_name?: string; last_name?: string; email?: string; phone?: string;
  country?: string;     // code ISO-2, ex "BE"
  region?: string; address1?: string; address2?: string; city?: string; zip?: string;
}
// Ligne pour un produit EXISTANT.
export interface PrintifyLineItemExisting {
  product_id: string;
  variant_id: number;
  quantity: number;
  external_id?: string;
}
// Ligne qui CRÉE le produit à la volée (design fourni par URL).
export interface PrintifyLineItemNew {
  print_provider_id: number;
  blueprint_id: number;
  variant_id: number;
  print_areas: Record<string, string>; // ex { front: "https://.../design.png" }
  quantity: number;
  external_id?: string;
}
// Ligne par SKU.
export interface PrintifyLineItemSku {
  sku: string;
  quantity: number;
  external_id?: string;
}
export type PrintifyLineItem = PrintifyLineItemExisting | PrintifyLineItemNew | PrintifyLineItemSku;
export interface PrintifyOrderRequest {
  external_id: string;
  label?: string;
  line_items: PrintifyLineItem[];
  shipping_method: number;             // 1 standard, 2 priority, 3 express, 4 economy
  send_shipping_notification?: boolean;
  address_to: PrintifyAddress;
}
export const submitOrder = (cfg: PrintifyConfig, order: PrintifyOrderRequest) =>
  request(cfg, 'POST', `shops/${shop(cfg)}/orders.json`, order);
export const listOrders = (cfg: PrintifyConfig, page = 1, limit = 20) =>
  request(cfg, 'GET', `shops/${shop(cfg)}/orders.json?page=${page}&limit=${limit}`);
export const getOrder = (cfg: PrintifyConfig, orderId: string) =>
  request(cfg, 'GET', `shops/${shop(cfg)}/orders/${orderId}.json`);
export const sendOrderToProduction = (cfg: PrintifyConfig, orderId: string) =>
  request(cfg, 'POST', `shops/${shop(cfg)}/orders/${orderId}/send_to_production.json`);
export const calculateShipping = (cfg: PrintifyConfig, payload: { line_items: any[]; address_to: PrintifyAddress }) =>
  request(cfg, 'POST', `shops/${shop(cfg)}/orders/shipping.json`, payload);
export const cancelOrder = (cfg: PrintifyConfig, orderId: string) =>
  request(cfg, 'POST', `shops/${shop(cfg)}/orders/${orderId}/cancel.json`);

// Test de connexion (utilisé par /printify/status) : liste les shops.
export async function ping(cfg: PrintifyConfig): Promise<PrintifyResult> {
  return listShops(cfg);
}

// Résout un shopId : si absent dans la config, prend le premier shop du compte.
export async function resolveShopId(cfg: PrintifyConfig): Promise<string | null> {
  if (cfg.shopId) return String(cfg.shopId);
  const res = await listShops(cfg);
  if (res.ok && Array.isArray(res.data) && res.data.length > 0) return String((res.data[0] as any).id);
  return null;
}
