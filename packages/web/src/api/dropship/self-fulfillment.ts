// ─── Moteur d'expédition PROPRE (self-fulfillment) ───────────────────────────
// Pour les entreprises qui expédient elles-mêmes leurs produits physiques :
//   - stock détenu (owned stock)
//   - dropshipping où c'est L'ENTREPRISE qui poste le colis
//   - made-to-order (fabrication à la commande)
//
// Aucune API/compte transporteur requis : l'admin saisit le n° de suivi à la main
// et choisit le transporteur dans une liste. Le back mappe transporteur → URL de
// suivi, décrémente le stock, gère les alertes de stock bas, fait avancer le
// statut et envoie les e-mails client automatiques à chaque étape.
//
// Flux statut (convention crochets FR, texte + symbole, jamais couleur seule) :
//   [PAYÉE] → [À EXPÉDIER] → [EXPÉDIÉE] → [LIVRÉE]

import { db } from "../database/index";
import * as schema from "../database/schema";
import { and, eq } from "drizzle-orm";
import { v4 as uuidv4 } from "uuid";
import { sendEmail } from "../email-provider";

// ── Helpers statut (auto-suffisants pour éviter tout import circulaire) ──
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

async function logActivity(companyId: string, message: string, role = "operations") {
  await db.insert(schema.agentActivity).values({ id: uuidv4(), companyId, agentRole: role, action: "completed", message });
}

// ── Transporteurs supportés (aucun compte requis) ──
// name = identifiant stable | label = affichage | url(n) = page de suivi publique.
export interface Carrier { name: string; label: string; url: (tn: string) => string; }
export const CARRIERS: Carrier[] = [
  { name: "bpost", label: "Bpost (Belgique)", url: (n) => `https://track.bpost.cloud/btr/web/#/search?itemCode=${encodeURIComponent(n)}` },
  { name: "colissimo", label: "Colissimo / La Poste", url: (n) => `https://www.laposte.fr/outils/suivre-vos-envois?code=${encodeURIComponent(n)}` },
  { name: "chronopost", label: "Chronopost", url: (n) => `https://www.chronopost.fr/tracking-no-cms/suivi-page?listeNumerosLT=${encodeURIComponent(n)}` },
  { name: "mondialrelay", label: "Mondial Relay", url: (n) => `https://www.mondialrelay.fr/suivi-de-colis/?numeroExpedition=${encodeURIComponent(n)}` },
  { name: "dhl", label: "DHL", url: (n) => `https://www.dhl.com/be-fr/home/tracking/tracking-express.html?submit=1&tracking-id=${encodeURIComponent(n)}` },
  { name: "ups", label: "UPS", url: (n) => `https://www.ups.com/track?tracknum=${encodeURIComponent(n)}` },
  { name: "fedex", label: "FedEx", url: (n) => `https://www.fedex.com/fedextrack/?trknbr=${encodeURIComponent(n)}` },
  { name: "gls", label: "GLS", url: (n) => `https://gls-group.com/track?match=${encodeURIComponent(n)}` },
  { name: "dpd", label: "DPD", url: (n) => `https://www.dpd.com/be/fr/suivi/?parcelNr=${encodeURIComponent(n)}` },
  { name: "autre", label: "Autre transporteur", url: (n) => `https://www.google.com/search?q=suivi+colis+${encodeURIComponent(n)}` },
];

export function carrierTrackingUrl(name: string | null | undefined, trackingNumber: string): string {
  const c = CARRIERS.find((x) => x.name === String(name || "").toLowerCase());
  return (c || CARRIERS[CARRIERS.length - 1]).url(trackingNumber);
}

export function carrierLabel(name: string | null | undefined): string {
  const c = CARRIERS.find((x) => x.name === String(name || "").toLowerCase());
  return c ? c.label : "Transporteur";
}

// ── Détection : commande à expédier soi-même ? ──
// Vrai si le mode est explicitement "self" OU si aucun fournisseur externe
// (ni Printify, ni CJ, ni AliExpress/service) n'est rattaché.
export async function isSelfFulfillment(order: any, items: any[]): Promise<boolean> {
  if (order.fulfillmentMode === "self" || order.supplierPlatform === "self") return true;
  const externalPlatforms = new Set(["cj", "aliexpress", "service", "printify"]);
  if (order.supplierPlatform && externalPlatforms.has(order.supplierPlatform)) return false;
  if (order.fulfillmentMode === "auto" || order.fulfillmentMode === "printify") return false;
  // Aucune référence fournisseur externe sur aucune ligne → self.
  for (const it of items) {
    if (it.supplierProductId || it.supplierVariantId) return false;
    if (it.productId) {
      const prod = await db.select().from(schema.products).where(eq(schema.products.id, it.productId)).get();
      if (prod?.printifyProductId) return false;
    }
  }
  return true;
}

// ── Calcul du coût d'expédition ──
// Lit shippingConfig.zones (JSON) :
//   [{ name, countries:["BE","FR"], rates:[{ maxWeightKg, price }], default? }]
// Repli : flatRate. Livraison gratuite si total >= freeShippingThreshold.
export interface ShippingQuote { cost: number; free: boolean; zone: string; detail: string; }
export async function calcShipping(companyId: string, items: any[], countryCode: string, orderTotal?: number): Promise<ShippingQuote> {
  const cfg = await db.select().from(schema.shippingConfig).where(eq(schema.shippingConfig.companyId, companyId)).get();
  // Poids total (kg) depuis la fiche produit.
  let totalWeight = 0;
  for (const it of items) {
    let w = 0.3; // défaut 300 g/article si poids inconnu
    if (it.productId) {
      const prod = await db.select().from(schema.products).where(eq(schema.products.id, it.productId)).get();
      if (prod?.weight != null && prod.weight > 0) w = prod.weight;
    }
    totalWeight += w * (it.quantity || 1);
  }
  const cc = String(countryCode || "").toUpperCase();

  // Livraison gratuite au-dessus du seuil.
  if (cfg?.freeShippingThreshold != null && orderTotal != null && orderTotal >= cfg.freeShippingThreshold) {
    return { cost: 0, free: true, zone: "gratuite", detail: `Livraison gratuite (commande ≥ ${cfg.freeShippingThreshold} €)` };
  }

  // Zones configurées.
  if (cfg?.zones) {
    try {
      const zones: any[] = JSON.parse(cfg.zones);
      if (Array.isArray(zones) && zones.length) {
        const zone = zones.find((z) => Array.isArray(z.countries) && z.countries.map((x: string) => String(x).toUpperCase()).includes(cc))
          || zones.find((z) => z.default === true || z.isDefault === true);
        if (zone) {
          const rates: any[] = Array.isArray(zone.rates) ? [...zone.rates].sort((a, b) => Number(a.maxWeightKg) - Number(b.maxWeightKg)) : [];
          const tier = rates.find((r) => totalWeight <= Number(r.maxWeightKg));
          const chosen = tier || rates[rates.length - 1];
          if (chosen) {
            return { cost: Number(chosen.price) || 0, free: false, zone: String(zone.name || cc), detail: `Zone ${zone.name || cc}, ${totalWeight.toFixed(2)} kg` };
          }
          if (zone.flatRate != null) return { cost: Number(zone.flatRate), free: false, zone: String(zone.name || cc), detail: `Zone ${zone.name || cc}, tarif fixe` };
        }
      }
    } catch { /* zones illisibles → repli flatRate */ }
  }

  // Repli : tarif fixe global.
  const flat = cfg?.flatRate != null ? Number(cfg.flatRate) : 5;
  return { cost: flat, free: false, zone: "défaut", detail: `Tarif fixe (${totalWeight.toFixed(2)} kg)` };
}

// ── Démarrage : commande [PAYÉE] → [À EXPÉDIER] ──
// Décrémente le stock, déclenche les alertes de stock bas, e-mail de confirmation.
export interface SelfResult { ok: boolean; status: string; detail: string; }
export async function startSelfFulfillment(companyId: string, order: any, items: any[]): Promise<SelfResult> {
  // Décrément du stock (produits en stock détenu / made-to-order suivant leur stock).
  const lowStock: string[] = [];
  for (const it of items) {
    if (!it.productId) continue;
    const prod = await db.select().from(schema.products).where(eq(schema.products.id, it.productId)).get();
    if (!prod) continue;
    const current = prod.stockQuantity ?? 0;
    const next = current - (it.quantity || 1);
    await db.update(schema.products).set({ stockQuantity: next, updatedAt: new Date() }).where(eq(schema.products.id, prod.id));
    const reorder = prod.reorderPoint ?? 10;
    if (next <= reorder) lowStock.push(`${prod.name} (reste ${next}, seuil ${reorder})`);
  }

  await setStatus(order.id, "[À EXPÉDIER]", "Commande payée — à préparer et expédier depuis votre stock", { fulfillmentMode: "self", supplierPlatform: "self" });
  await logActivity(companyId, `▶ [À EXPÉDIER] Commande ${order.id.slice(0, 8)} à préparer (expédition propre)`);

  // Alertes de stock bas (journal + e-mail admin si configuré).
  if (lowStock.length) {
    const msg = `⚠ Stock bas après commande ${order.id.slice(0, 8)} : ${lowStock.join(" · ")}`;
    await logActivity(companyId, msg, "operations");
    const company = await db.select().from(schema.companies).where(eq(schema.companies.id, companyId)).get();
    const owner = company?.userId ? await db.select().from(schema.users).where(eq(schema.users.id, company.userId)).get() : null;
    if (owner?.email) {
      await sendEmail({
        to: owner.email,
        subject: `⚠ Stock bas — ${company?.name || "votre boutique"}`,
        text: `Attention, le stock de certains produits est bas :\n\n${lowStock.join("\n")}\n\nPensez à réapprovisionner.`,
      }).catch(() => { /* e-mail non configuré → l'alerte reste au journal */ });
    }
  }

  // E-mail de confirmation au client.
  if (order.customerEmail) {
    await sendEmail({
      to: order.customerEmail,
      subject: "Votre commande est confirmée ✅",
      text: `Merci pour votre commande !\n\nNous préparons votre colis. Vous recevrez un e-mail avec le numéro de suivi dès l'expédition.\n\nRéférence : ${order.id.slice(0, 8).toUpperCase()}`,
    }).catch(() => { /* e-mail non configuré → statut visible au dashboard */ });
  }

  return { ok: true, status: "[À EXPÉDIER]", detail: lowStock.length ? `À expédier — ${lowStock.length} alerte(s) stock bas` : "À expédier" };
}

// ── Expédition : [À EXPÉDIER] → [EXPÉDIÉE] ──
// L'admin saisit le transporteur + n° de suivi. E-mail de suivi au client.
export async function shipSelfOrder(
  companyId: string,
  orderId: string,
  input: { carrier: string; trackingNumber: string; trackingUrl?: string },
): Promise<SelfResult> {
  const order = await db.select().from(schema.orders)
    .where(and(eq(schema.orders.id, orderId), eq(schema.orders.companyId, companyId))).get();
  if (!order) return { ok: false, status: "[ERREUR]", detail: "Commande introuvable" };
  const tn = String(input.trackingNumber || "").trim();
  if (!tn) return { ok: false, status: order.status, detail: "Numéro de suivi requis" };

  const carrier = String(input.carrier || "autre").toLowerCase();
  const trackingUrl = String(input.trackingUrl || "").trim() || carrierTrackingUrl(carrier, tn);
  const cLabel = carrierLabel(carrier);

  await setStatus(orderId, "[EXPÉDIÉE]", `Expédiée via ${cLabel} — suivi ${tn}`, {
    trackingNumber: tn, trackingUrl, supplierPlatform: "self", fulfillmentMode: "self",
    supplierOrderId: order.supplierOrderId || `${carrier.toUpperCase()}-${tn}`,
  });
  await logActivity(companyId, `✓ [EXPÉDIÉE] Commande ${orderId.slice(0, 8)} via ${cLabel} — suivi ${tn}`);

  if (order.customerEmail) {
    await sendEmail({
      to: order.customerEmail,
      subject: "Votre commande est en route 📦",
      text: `Bonne nouvelle ! Votre colis a été expédié via ${cLabel}.\n\nNuméro de suivi : ${tn}\nSuivre le colis : ${trackingUrl}\n\nMerci pour votre achat !`,
    }).catch(() => { /* e-mail non configuré → suivi visible au dashboard */ });
  }
  return { ok: true, status: "[EXPÉDIÉE]", detail: `Expédiée via ${cLabel} (suivi ${tn})` };
}

// ── Livraison : [EXPÉDIÉE] → [LIVRÉE] ──
export async function markSelfDelivered(companyId: string, orderId: string): Promise<SelfResult> {
  const order = await db.select().from(schema.orders)
    .where(and(eq(schema.orders.id, orderId), eq(schema.orders.companyId, companyId))).get();
  if (!order) return { ok: false, status: "[ERREUR]", detail: "Commande introuvable" };
  await setStatus(orderId, "[LIVRÉE]", "Colis livré au client");
  await logActivity(companyId, `✓ [LIVRÉE] Commande ${orderId.slice(0, 8)} livrée au client`);
  if (order.customerEmail) {
    await sendEmail({
      to: order.customerEmail,
      subject: "Votre colis est livré 🎉",
      text: `Votre colis a été livré. Nous espérons qu'il vous plaît !\n\nMerci pour votre confiance.`,
    }).catch(() => { /* e-mail non configuré */ });
  }
  return { ok: true, status: "[LIVRÉE]", detail: "Livrée" };
}

// ── Suivi public (page client) : match par ID de commande + e-mail ──
export async function lookupTracking(orderIdPrefix: string, email: string): Promise<
  | { ok: true; order: { ref: string; status: string; trackingNumber: string | null; trackingUrl: string | null; carrier: string | null; createdAt: any; timeline: any[]; items: { name: string; quantity: number }[] } }
  | { ok: false; error: string }
> {
  const ref = String(orderIdPrefix || "").trim().toLowerCase();
  const em = String(email || "").trim().toLowerCase();
  if (!ref || !em) return { ok: false, error: "Référence et e-mail requis" };
  // Match par préfixe d'ID (les clients voient les 8 premiers caractères) + e-mail exact.
  const rows = await db.select().from(schema.orders).limit(2000);
  const order = rows.find((o) => o.id.toLowerCase().startsWith(ref) && String(o.customerEmail || "").toLowerCase() === em);
  if (!order) return { ok: false, error: "Aucune commande trouvée pour cette référence et cet e-mail" };
  const items = await db.select().from(schema.orderItems).where(eq(schema.orderItems.orderId, order.id));
  let timeline: any[] = [];
  try { timeline = JSON.parse(order.statusLog || "[]"); } catch { /* journal illisible */ }
  // Carrier extrait du supplierOrderId (ex "BPOST-XXXX") si dispo.
  const carrier = order.supplierOrderId && order.supplierOrderId.includes("-")
    ? order.supplierOrderId.split("-")[0].toLowerCase() : null;
  return {
    ok: true,
    order: {
      ref: order.id.slice(0, 8).toUpperCase(),
      status: order.status,
      trackingNumber: order.trackingNumber,
      trackingUrl: order.trackingUrl,
      carrier: carrier ? carrierLabel(carrier) : null,
      createdAt: order.createdAt,
      timeline: timeline.map((t) => ({ at: t.at, status: t.status, detail: t.detail })),
      items: items.map((i) => ({ name: i.name, quantity: i.quantity })),
    },
  };
}

// ── Étiquette d'expédition imprimable (HTML + code-barres Code128 en SVG) ──
// Zéro dépendance externe, zéro API. Le front récupère le HTML et l'ouvre pour
// impression / « Enregistrer en PDF ».
const CODE128_PATTERNS = [
  "212222","222122","222221","121223","121322","131222","122213","122312","132212","221213",
  "221312","231212","112232","122132","122231","113222","123122","123221","223211","221132",
  "221231","213212","223112","312131","311222","321122","321221","312212","322112","322211",
  "212123","212321","232121","111323","131123","131321","112313","132113","132311","211313",
  "231113","231311","112133","112331","132131","113123","113321","133121","313121","211331",
  "231131","213113","213311","213131","311123","311321","331121","312113","312311","332111",
  "314111","221411","431111","111224","111422","121124","121421","141122","141221","112214",
  "112412","122114","122411","142112","142211","241211","221114","413111","241112","134111",
  "111242","121142","121241","114212","124112","124211","411212","421112","421211","212141",
  "214121","412121","111143","111341","131141","114113","114311","411113","411311","113141",
  "114131","311141","411131","211412","211214","211232","2331112",
];

function code128BSvg(data: string, height = 60): string {
  // Code 128B : caractères ASCII 32..126.
  const clean = (data || "").replace(/[^\x20-\x7e]/g, "").slice(0, 40) || "0";
  const START_B = 104, STOP = 106;
  const values: number[] = [START_B];
  for (const ch of clean) {
    const v = ch.charCodeAt(0) - 32;
    if (v >= 0 && v < 95) values.push(v);
  }
  // Checksum.
  let sum = START_B;
  for (let i = 1; i < values.length; i++) sum += values[i] * i;
  values.push(sum % 103);
  values.push(STOP);

  // Construction des barres (module = 2px).
  const mod = 2;
  let x = 0;
  const rects: string[] = [];
  for (const v of values) {
    const pattern = CODE128_PATTERNS[v] || CODE128_PATTERNS[0];
    for (let i = 0; i < pattern.length; i++) {
      const w = parseInt(pattern[i], 10) * mod;
      if (i % 2 === 0) rects.push(`<rect x="${x}" y="0" width="${w}" height="${height}" fill="#000"/>`);
      x += w;
    }
  }
  return `<svg width="${x}" height="${height}" viewBox="0 0 ${x} ${height}" xmlns="http://www.w3.org/2000/svg" preserveAspectRatio="none">${rects.join("")}</svg>`;
}

function esc(s: any): string {
  return String(s ?? "").replace(/[&<>"']/g, (m) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[m]!));
}

export async function buildLabelHtml(companyId: string, orderId: string): Promise<string | null> {
  const order = await db.select().from(schema.orders)
    .where(and(eq(schema.orders.id, orderId), eq(schema.orders.companyId, companyId))).get();
  if (!order) return null;
  const company = await db.select().from(schema.companies).where(eq(schema.companies.id, companyId)).get();
  const items = await db.select().from(schema.orderItems).where(eq(schema.orderItems.orderId, orderId));
  let addr: any = {};
  try { addr = JSON.parse(order.shippingAddress || "{}"); } catch { /* adresse illisible */ }

  const ref = order.id.slice(0, 8).toUpperCase();
  const barcodeValue = order.trackingNumber || ref;
  const barcode = code128BSvg(barcodeValue, 64);
  const totalWeight = items.reduce((s) => s, 0);

  const itemsRows = items.map((it) => `<tr><td>${esc(it.quantity)}×</td><td>${esc(it.name)}${it.variantLabel ? ` — ${esc(it.variantLabel)}` : ""}</td></tr>`).join("");
  void totalWeight;

  return `<!DOCTYPE html><html lang="fr"><head><meta charset="utf-8"><title>Étiquette ${ref}</title>
<style>
  @page { size: A6; margin: 6mm; }
  * { box-sizing: border-box; }
  body { font-family: -apple-system, Segoe UI, Roboto, Arial, sans-serif; margin: 0; padding: 14px; color: #000; }
  .label { border: 2px solid #000; border-radius: 6px; padding: 14px; max-width: 420px; margin: 0 auto; }
  .row { display: flex; justify-content: space-between; align-items: flex-start; gap: 10px; }
  .from { font-size: 11px; color: #333; }
  .to { margin-top: 10px; padding-top: 10px; border-top: 1px dashed #000; }
  .to h2 { margin: 0 0 4px; font-size: 12px; text-transform: uppercase; letter-spacing: 1px; color: #555; }
  .to .name { font-size: 18px; font-weight: 800; }
  .to .addr { font-size: 15px; line-height: 1.4; }
  .carrier { font-size: 13px; font-weight: 700; margin-top: 10px; padding-top: 10px; border-top: 1px dashed #000; }
  .barcode { text-align: center; margin-top: 12px; }
  .barcode svg { max-width: 100%; height: 64px; }
  .barcode .num { font-family: ui-monospace, Menlo, Consolas, monospace; font-size: 13px; letter-spacing: 2px; margin-top: 4px; }
  table { width: 100%; font-size: 11px; border-collapse: collapse; margin-top: 10px; }
  td { padding: 2px 4px; border-bottom: 1px solid #eee; vertical-align: top; }
  .ref { font-weight: 800; font-size: 15px; }
  @media print { .noprint { display: none; } body { padding: 0; } }
</style></head>
<body>
  <div class="noprint" style="text-align:center;margin-bottom:12px;">
    <button onclick="window.print()" style="padding:8px 16px;font-size:14px;font-weight:700;cursor:pointer;">🖨 Imprimer / Enregistrer en PDF</button>
  </div>
  <div class="label">
    <div class="row">
      <div class="from"><strong>${esc(company?.name || "Expéditeur")}</strong><br>Expéditeur</div>
      <div class="ref">#${esc(ref)}</div>
    </div>
    <div class="to">
      <h2>Destinataire</h2>
      <div class="name">${esc(addr.name || order.customerName || "Client")}</div>
      <div class="addr">
        ${esc(addr.line1 || "")}${addr.line2 ? "<br>" + esc(addr.line2) : ""}<br>
        ${esc(addr.zip || "")} ${esc(addr.city || "")}${addr.state ? ", " + esc(addr.state) : ""}<br>
        <strong>${esc(addr.country || "")}</strong>
        ${addr.phone ? "<br>☎ " + esc(addr.phone) : ""}
      </div>
    </div>
    ${order.trackingNumber ? `<div class="carrier">Transporteur : ${esc(carrierLabel((order.supplierOrderId || "").split("-")[0]))} · Suivi : ${esc(order.trackingNumber)}</div>` : ""}
    <div class="barcode">
      ${barcode}
      <div class="num">${esc(barcodeValue)}</div>
    </div>
    <table>${itemsRows}</table>
  </div>
</body></html>`;
}
