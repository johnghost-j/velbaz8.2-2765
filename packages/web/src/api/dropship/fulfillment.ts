// ─── Moteur de fulfillment dropshipping ──────────────────────────────────────
// Commande client [PAYÉE] → commande fournisseur :
//   - produits CJ  → createOrder API (payée par le SOLDE CJ) → [ENVOYÉE FOURNISSEUR]
//   - AliExpress / services → [À TRAITER] (semi-auto, dashboard)
// Garde-fous full-auto (JAMAIS d'échec silencieux) :
//   - dry-run : CJ_DRY_RUN=1 (secret) ou opts.dryRun → simulation, zéro dépense
//   - plafond de dépense/jour : CJ_DAILY_CAP_USD (défaut 50 $)
//   - vérification du solde CJ avant chaque commande
//   - échec → statut [ERREUR: raison] + activité + relance possible (bouton Réessayer)
// Suivi : syncTracking → numéro de suivi → e-mail client → [LIVRÉE].

import { db } from "../database/index";
import * as schema from "../database/schema";
import { and, eq, gte, isNotNull } from "drizzle-orm";
import { v4 as uuidv4 } from "uuid";
import * as cj from "./cj";
import * as printify from "../printify";
import { sendEmail } from "../email-provider";
import { isSelfFulfillment, startSelfFulfillment } from "./self-fulfillment";

// ── Helpers statut (texte, auditable, sans couleur) ──
async function setStatus(orderId: string, status: string, detail: string, extra?: Partial<typeof schema.orders.$inferInsert>) {
  const row = await db.select().from(schema.orders).where(eq(schema.orders.id, orderId)).get();
  let log: any[] = [];
  try { log = JSON.parse(row?.statusLog || "[]"); } catch { /* journal illisible → on repart */ }
  log.push({ at: new Date().toISOString(), status, detail });
  await db.update(schema.orders).set({
    status, statusLog: JSON.stringify(log),
    errorDetail: status.startsWith("[ERREUR") ? detail : null,
    updatedAt: new Date(), ...extra,
  }).where(eq(schema.orders.id, orderId));
}

async function logActivity(companyId: string, message: string) {
  await db.insert(schema.agentActivity).values({ id: uuidv4(), companyId, agentRole: "operations", action: "completed", message });
}

async function secretMap(companyId: string): Promise<Record<string, string>> {
  const rows = await db.select({ key: schema.companySecrets.key, value: schema.companySecrets.value })
    .from(schema.companySecrets).where(eq(schema.companySecrets.companyId, companyId));
  const m: Record<string, string> = {};
  for (const r of rows) m[r.key] = r.value;
  return m;
}

function cjConfigFrom(s: Record<string, string>): cj.CjConfig | null {
  return s["CJ_EMAIL"] && s["CJ_API_KEY"] ? { email: s["CJ_EMAIL"], apiKey: s["CJ_API_KEY"] } : null;
}

function printifyConfigFrom(s: Record<string, string>): printify.PrintifyConfig | null {
  const apiToken = s["PRINTIFY_API_TOKEN"];
  if (!apiToken) return null;
  return { apiToken, shopId: s["PRINTIFY_SHOP_ID"] || undefined, baseUrl: s["PRINTIFY_BASE_URL"] || undefined };
}

// Convertit une adresse Velbaz ({name,line1,...}) en adresse Printify.
function toPrintifyAddress(addr: any, order: any): printify.PrintifyAddress {
  const fullName = String(addr?.name || order?.customerName || "Client").trim();
  const parts = fullName.split(/\s+/);
  const firstName = parts.slice(0, -1).join(" ") || parts[0] || "Client";
  const lastName = parts.length > 1 ? parts[parts.length - 1] : "-";
  return {
    first_name: firstName,
    last_name: lastName,
    email: order?.customerEmail || addr?.email || undefined,
    phone: String(addr?.phone || "0000000000"),
    country: String(addr?.country || "US"),
    region: String(addr?.state || addr?.city || ""),
    address1: String(addr?.line1 || ""),
    address2: addr?.line2 ? String(addr.line2) : undefined,
    city: String(addr?.city || ""),
    zip: String(addr?.zip || ""),
  };
}

// ── Fulfillment Printify (print-on-demand) ──
// Commande client [PAYÉE] → commande Printify (Printify fabrique + expédie).
// Le coût de production est débité du moyen de paiement Printify de l'utilisateur.
async function fulfillPrintify(
  companyId: string,
  order: any,
  items: any[],
  cfg: printify.PrintifyConfig,
): Promise<FulfillResult> {
  const shopId = await printify.resolveShopId(cfg);
  if (!shopId) {
    await setStatus(order.id, "[ERREUR]", "Aucun shop Printify trouvé (vérifie le token API)");
    await logActivity(companyId, `✗ [ERREUR] Commande ${order.id.slice(0, 8)} : aucun shop Printify`);
    return { ok: false, status: "[ERREUR]", detail: "Aucun shop Printify" };
  }
  cfg = { ...cfg, shopId };

  // Adresse de livraison obligatoire.
  let addr: any = null;
  try { addr = JSON.parse(order.shippingAddress || "null"); } catch { /* illisible */ }
  if (!addr?.line1 || !addr?.city || !addr?.country) {
    await setStatus(order.id, "[ERREUR]", "Adresse de livraison incomplète (line1/ville/pays manquant)");
    await logActivity(companyId, `✗ [ERREUR] Commande ${order.id.slice(0, 8)} : adresse de livraison incomplète`);
    return { ok: false, status: "[ERREUR]", detail: "Adresse incomplète" };
  }

  // Construction des line_items Printify depuis les produits liés.
  const lineItems: printify.PrintifyLineItem[] = [];
  for (const it of items) {
    if (!it.productId) continue;
    const product = await db.select().from(schema.products).where(eq(schema.products.id, it.productId)).get();
    if (!product?.printifyProductId) continue;
    // Variante : celle choisie par le client si valide, sinon la 1re variante Printify.
    let variantId = Number(it.supplierVariantId);
    if (!Number.isFinite(variantId) || variantId <= 0) {
      try {
        const v = JSON.parse(product.variants || "{}");
        const first = Array.isArray(v?.printifyVariants) ? v.printifyVariants[0] : null;
        if (first?.vid) variantId = Number(first.vid);
      } catch { /* pas de variantes stockées */ }
    }
    if (!Number.isFinite(variantId) || variantId <= 0) continue;
    lineItems.push({
      product_id: String(product.printifyProductId),
      variant_id: variantId,
      quantity: it.quantity || 1,
    });
  }

  if (!lineItems.length) {
    await setStatus(order.id, "[ERREUR]", "Aucun produit Printify valide dans la commande (produit non créé sur Printify ou variante manquante)");
    await logActivity(companyId, `✗ [ERREUR] Commande ${order.id.slice(0, 8)} : aucun produit Printify valide — relance le build pour créer les produits sur Printify`);
    return { ok: false, status: "[ERREUR]", detail: "Aucun produit Printify valide" };
  }

  const orderReq: printify.PrintifyOrderRequest = {
    external_id: order.id,
    label: `Velbaz ${order.id.slice(0, 8)}`,
    line_items: lineItems,
    shipping_method: 1,
    send_shipping_notification: true,
    address_to: toPrintifyAddress(addr, order),
  };
  const res = await printify.submitOrder(cfg, orderReq);
  if (!res.ok) {
    const d = `Printify a refusé la commande : ${res.message || "raison inconnue"}`;
    await setStatus(order.id, "[ERREUR]", d);
    await logActivity(companyId, `✗ [ERREUR] Commande ${order.id.slice(0, 8)} : ${d} — clique Réessayer après correction`);
    return { ok: false, status: "[ERREUR]", detail: d };
  }
  const printifyOrderId = String((res.data as any)?.id || "");

  // Enregistre le suivi Printify dans printifyOrders.
  await db.insert(schema.printifyOrders).values({
    id: uuidv4(), companyId, referenceId: order.id,
    printifyOrderId: printifyOrderId || null,
    status: "submitted",
    customerEmail: order.customerEmail || null,
    payload: JSON.stringify(orderReq),
    lastEvent: JSON.stringify({ response: res.data }),
  }).catch(() => { /* table optionnelle */ });

  // Envoi en production (déclenche la fabrication).
  if (printifyOrderId) {
    await printify.sendOrderToProduction(cfg, printifyOrderId).catch(() => { /* auto en général */ });
  }

  await setStatus(order.id, "[ENVOYÉE FOURNISSEUR]", `Commande Printify ${printifyOrderId || "(id?)"} créée — Printify fabrique et expédie automatiquement.`, {
    supplierOrderId: printifyOrderId || `PRINTIFY-${order.id.slice(0, 8)}`,
  });
  await logActivity(companyId, `✓ [ENVOYÉE FOURNISSEUR] Commande ${order.id.slice(0, 8)} → Printify ${printifyOrderId} (fabrication + expédition automatiques)`);
  return { ok: true, status: "[ENVOYÉE FOURNISSEUR]", detail: `Printify ${printifyOrderId}`, supplierOrderId: printifyOrderId };
}

// Dépense fournisseur du jour (commandes auto réelles, hors dry-run).
async function spentTodayUsd(companyId: string): Promise<number> {
  const midnight = new Date(); midnight.setHours(0, 0, 0, 0);
  const rows = await db.select().from(schema.orders).where(and(
    eq(schema.orders.companyId, companyId),
    isNotNull(schema.orders.supplierOrderId),
    eq(schema.orders.dryRun, 0),
    gte(schema.orders.createdAt, midnight),
  ));
  return rows.reduce((sum, o) => sum + (o.supplierCost || 0), 0);
}

export interface FulfillResult { ok: boolean; status: string; detail: string; supplierOrderId?: string; dryRun?: boolean; }

// ── Fulfillment d'une commande [PAYÉE] ──
export async function fulfillOrder(companyId: string, orderId: string, opts?: { dryRun?: boolean }): Promise<FulfillResult> {
  const order = await db.select().from(schema.orders)
    .where(and(eq(schema.orders.id, orderId), eq(schema.orders.companyId, companyId))).get();
  if (!order) return { ok: false, status: "[ERREUR]", detail: "Commande introuvable" };
  if (order.supplierOrderId) return { ok: true, status: order.status, detail: "Déjà envoyée au fournisseur (idempotent)" , supplierOrderId: order.supplierOrderId };
  if (!order.status.startsWith("[PAYÉE]") && !order.status.startsWith("[ERREUR")) {
    return { ok: false, status: order.status, detail: `Statut actuel ${order.status} — seule une commande [PAYÉE] ou [ERREUR] (relance) peut partir au fournisseur` };
  }
  const items = await db.select().from(schema.orderItems).where(eq(schema.orderItems.orderId, orderId));
  const cjItems = items.filter((i) => i.supplierProductId && i.supplierVariantId);

  // ── Print-on-demand Printify ──
  // Prioritaire : si la commande contient des produits liés à Printify, on
  // envoie la commande à Printify (fabrication + expédition automatiques).
  {
    const secretsPod = await secretMap(companyId);
    const podCfg = printifyConfigFrom(secretsPod);
    let hasPrintifyItem = order.fulfillmentMode === "printify" || order.supplierPlatform === "printify";
    if (!hasPrintifyItem) {
      for (const it of items) {
        if (!it.productId) continue;
        const prod = await db.select().from(schema.products).where(eq(schema.products.id, it.productId)).get();
        if (prod?.printifyProductId) { hasPrintifyItem = true; break; }
      }
    }
    if (hasPrintifyItem) {
      if (!podCfg) {
        await setStatus(orderId, "[ERREUR]", "Printify non configuré (PRINTIFY_API_TOKEN manquant) — connecte ton token API Printify puis clique Réessayer");
        await logActivity(companyId, `✗ [ERREUR] Commande ${orderId.slice(0, 8)} : Printify non connecté — impossible de fabriquer/expédier`);
        return { ok: false, status: "[ERREUR]", detail: "Printify non configuré" };
      }
      return await fulfillPrintify(companyId, order, items, podCfg);
    }
  }

  // ── Expédition propre (self-fulfillment) ──
  // L'entreprise expédie elle-même (stock détenu, dropship posté par nous,
  // made-to-order). Décrément du stock + [À EXPÉDIER] + e-mail de confirmation.
  if (await isSelfFulfillment(order, items)) {
    const r = await startSelfFulfillment(companyId, order, items);
    return { ok: r.ok, status: r.status, detail: r.detail };
  }

  // ── Semi-auto (AliExpress / service / vid manquant) ──
  if (order.fulfillmentMode !== "auto" || !cjItems.length) {
    const why = order.supplierPlatform === "service" ? "prestation de service à commander chez le prestataire"
      : order.supplierPlatform === "aliexpress" ? "produit AliExpress à commander manuellement (lien dans la fiche)"
      : "références fournisseur incomplètes (variante non choisie ?)";
    await setStatus(orderId, "[À TRAITER]", `Semi-auto : ${why}`);
    await logActivity(companyId, `▶ [À TRAITER] Commande ${orderId.slice(0, 8)} en attente d'action manuelle — ${why}`);
    return { ok: true, status: "[À TRAITER]", detail: why };
  }

  // ── Full-auto CJ ──
  const secrets = await secretMap(companyId);
  const cfg = cjConfigFrom(secrets);
  if (!cfg) {
    await setStatus(orderId, "[ERREUR]", "CJ non configuré (CJ_EMAIL + CJ_API_KEY manquants)");
    await logActivity(companyId, `✗ [ERREUR] Commande ${orderId.slice(0, 8)} : CJ non configuré — connecte ton compte CJ puis clique Réessayer`);
    return { ok: false, status: "[ERREUR]", detail: "CJ non configuré" };
  }
  const dryRun = opts?.dryRun === true || secrets["CJ_DRY_RUN"] === "1" || order.dryRun === 1;

  // Adresse de livraison obligatoire.
  let addr: any = null;
  try { addr = JSON.parse(order.shippingAddress || "null"); } catch { /* adresse illisible */ }
  if (!addr?.line1 || !addr?.city || !addr?.country) {
    await setStatus(orderId, "[ERREUR]", "Adresse de livraison incomplète (line1/ville/pays manquant)");
    await logActivity(companyId, `✗ [ERREUR] Commande ${orderId.slice(0, 8)} : adresse de livraison incomplète`);
    return { ok: false, status: "[ERREUR]", detail: "Adresse incomplète" };
  }

  // Garde-fous dépense (uniquement en réel).
  const estimatedCost = items.reduce((s, i) => s + (i.unitCost || 0) * (i.quantity || 1), 0);
  if (!dryRun) {
    const cap = Number(secrets["CJ_DAILY_CAP_USD"] || "50");
    const spent = await spentTodayUsd(companyId);
    if (spent + estimatedCost > cap) {
      const d = `Plafond de dépense/jour atteint (${spent.toFixed(2)} + ${estimatedCost.toFixed(2)} > ${cap} USD). Augmente CJ_DAILY_CAP_USD ou relance demain.`;
      await setStatus(orderId, "[ERREUR]", d);
      await logActivity(companyId, `✗ [ERREUR] Commande ${orderId.slice(0, 8)} : ${d}`);
      return { ok: false, status: "[ERREUR]", detail: d };
    }
    const bal = await cj.getBalance(cfg);
    const balance = bal.ok ? Number((bal.data as any)?.amount ?? (bal.data as any)?.balance ?? 0) : null;
    if (balance != null && balance < estimatedCost) {
      const d = `Solde CJ insuffisant (${balance.toFixed(2)} USD < coût estimé ${estimatedCost.toFixed(2)} USD). Recharge ton solde CJ puis clique Réessayer.`;
      await setStatus(orderId, "[ERREUR]", d);
      await logActivity(companyId, `✗ [ERREUR] Commande ${orderId.slice(0, 8)} : ${d}`);
      return { ok: false, status: "[ERREUR]", detail: d };
    }
  }

  // Choix logistique : la moins chère qui livre le pays du client.
  let logisticName = "CJPacket Ordinary";
  const freight = await cj.freightCalculate(cfg, {
    startCountryCode: "CN",
    endCountryCode: String(addr.country),
    products: cjItems.map((i) => ({ vid: i.supplierVariantId!, quantity: i.quantity || 1 })),
  });
  if (freight.ok && Array.isArray(freight.data) && (freight.data as any[]).length) {
    const options = (freight.data as any[]).slice().sort((a, b) => Number(a?.logisticPrice ?? 1e9) - Number(b?.logisticPrice ?? 1e9));
    if (options[0]?.logisticName) logisticName = String(options[0].logisticName);
  }

  // ── Dry-run : simulation complète, zéro dépense ──
  if (dryRun) {
    const fakeId = `DRYRUN-${orderId.slice(0, 8)}`;
    await setStatus(orderId, "[ENVOYÉE FOURNISSEUR]", `SIMULATION (dry-run) — aucune dépense. Logistique choisie : ${logisticName}. Coût estimé : ${estimatedCost.toFixed(2)} USD.`, { supplierOrderId: fakeId, dryRun: 1 });
    await logActivity(companyId, `✓ [ENVOYÉE FOURNISSEUR] (SIMULATION) Commande ${orderId.slice(0, 8)} — dry-run, solde CJ non débité`);
    return { ok: true, status: "[ENVOYÉE FOURNISSEUR]", detail: "Simulation dry-run réussie", supplierOrderId: fakeId, dryRun: true };
  }

  // ── Commande réelle (payType 2 = solde CJ) ──
  const res = await cj.createOrder(cfg, {
    orderNumber: orderId,
    shippingCountryCode: String(addr.country),
    shippingProvince: String(addr.state || addr.city),
    shippingCity: String(addr.city),
    shippingAddress: [addr.line1, addr.line2].filter(Boolean).join(", "),
    shippingCustomerName: String(addr.name || order.customerName || "Client"),
    shippingZip: String(addr.zip || ""),
    shippingPhone: String(addr.phone || "0000000000"),
    logisticName,
    fromCountryCode: "CN",
    email: order.customerEmail || undefined,
    remark: "Velbaz auto-fulfillment",
    products: cjItems.map((i) => ({ vid: i.supplierVariantId!, quantity: i.quantity || 1 })),
    payType: 2,
  });
  if (!res.ok) {
    const d = `CJ createOrder refusé : ${res.message || "raison inconnue"}`;
    await setStatus(orderId, "[ERREUR]", d);
    await logActivity(companyId, `✗ [ERREUR] Commande ${orderId.slice(0, 8)} : ${d} — clique Réessayer après correction`);
    return { ok: false, status: "[ERREUR]", detail: d };
  }
  const data: any = res.data || {};
  const supplierOrderId = String(data.orderId || data.orderNum || data.id || "");
  const realCost = data.orderAmount != null ? Number(data.orderAmount) : estimatedCost;
  await setStatus(orderId, "[ENVOYÉE FOURNISSEUR]", `Commande CJ ${supplierOrderId} créée et payée par le solde (${realCost.toFixed(2)} USD, logistique ${logisticName})`, {
    supplierOrderId, supplierCost: realCost,
    marginAmount: order.amountTotal != null ? Number((order.amountTotal - realCost).toFixed(2)) : null,
  });
  // Marge enregistrée dans les revenus.
  if (order.amountTotal != null) {
    await db.insert(schema.revenueEvents).values({
      id: uuidv4(), companyId, type: "dropship_margin",
      amount: Number((order.amountTotal - realCost).toFixed(2)), currency: order.currency || "USD",
      source: "dropshipping", customerEmail: order.customerEmail,
      description: `Marge commande ${orderId.slice(0, 8)} (vente ${order.amountTotal} − coût CJ ${realCost.toFixed(2)})`,
    });
  }
  await logActivity(companyId, `✓ [ENVOYÉE FOURNISSEUR] Commande ${orderId.slice(0, 8)} → CJ ${supplierOrderId} (coût ${realCost.toFixed(2)} USD, marge ${(order.amountTotal != null ? order.amountTotal - realCost : 0).toFixed(2)})`);
  return { ok: true, status: "[ENVOYÉE FOURNISSEUR]", detail: `CJ ${supplierOrderId}`, supplierOrderId };
}

// ── Synchronisation du suivi (polling CJ) ──
// [ENVOYÉE FOURNISSEUR] → tracking → e-mail client → [LIVRÉE].
export async function syncTracking(companyId: string): Promise<{ checked: number; updated: number }> {
  const secrets = await secretMap(companyId);
  const cfg = cjConfigFrom(secrets);
  const rows = await db.select().from(schema.orders).where(and(
    eq(schema.orders.companyId, companyId),
    eq(schema.orders.status, "[ENVOYÉE FOURNISSEUR]"),
    isNotNull(schema.orders.supplierOrderId),
  ));
  let updated = 0;
  for (const o of rows) {
    if (o.dryRun === 1 || !cfg || o.supplierOrderId!.startsWith("DRYRUN-")) continue;
    const det = await cj.getOrderDetail(cfg, o.supplierOrderId!);
    if (!det.ok) continue;
    const d: any = det.data || {};
    const tracking = d.trackNumber || d.trackingNumber || null;
    const cjStatus = String(d.orderStatus || d.status || "").toUpperCase();
    if (tracking && !o.trackingNumber) {
      const trackingUrl = `https://www.cjpacket.com/?track=${encodeURIComponent(String(tracking))}`;
      await db.update(schema.orders).set({ trackingNumber: String(tracking), trackingUrl, updatedAt: new Date() }).where(eq(schema.orders.id, o.id));
      updated++;
      if (o.customerEmail) {
        await sendEmail({
          to: o.customerEmail,
          subject: "Votre commande est en route 📦",
          text: `Bonne nouvelle ! Votre commande a été expédiée.\n\nNuméro de suivi : ${tracking}\nSuivre le colis : ${trackingUrl}\n\nMerci pour votre achat !`,
        }).catch(() => { /* e-mail non configuré → le suivi reste visible au dashboard */ });
      }
      await logActivity(companyId, `▶ [EN ROUTE] Commande ${o.id.slice(0, 8)} expédiée — suivi ${tracking} (e-mail client ${o.customerEmail ? "envoyé" : "non configuré"})`);
    }
    if (cjStatus.includes("DELIVERED")) {
      await setStatus(o.id, "[LIVRÉE]", "Colis livré au client (statut CJ DELIVERED)");
      await logActivity(companyId, `✓ [LIVRÉE] Commande ${o.id.slice(0, 8)} livrée au client`);
      updated++;
    }
  }
  return { checked: rows.length, updated };
}

// ── Scheduler global : toutes les 30 min, pour toutes les entreprises actives ──
let trackingTimer: ReturnType<typeof setInterval> | null = null;
export function startTrackingScheduler() {
  if (trackingTimer) return;
  trackingTimer = setInterval(async () => {
    try {
      const pending = await db.selectDistinct({ companyId: schema.orders.companyId }).from(schema.orders)
        .where(eq(schema.orders.status, "[ENVOYÉE FOURNISSEUR]"));
      for (const p of pending) {
        try { await syncTracking(p.companyId); } catch (e) { console.error(`[tracking] ${p.companyId}`, e); }
      }
    } catch (e) { console.error("[tracking-scheduler]", e); }
  }, 30 * 60 * 1000);
}
