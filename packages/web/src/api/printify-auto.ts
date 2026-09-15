// ─── Création automatique d'un produit Printify à partir d'un design IA ───────
// Utilisé au build (pour transformer chaque design produit en vrai produit
// print-on-demand vendable) et à la demande. Choisit un blueprint (t-shirt par
// défaut), le premier print provider disponible, active toutes les variantes
// (tailles/couleurs), place le design sur la face avant, crée + publie le produit.
// Retourne le mapping à stocker en DB (printifyProductId + variantes avec vid Printify).

import * as printify from "./printify";
import * as printifyDesign from "./printify-design";

// Blueprints Printify courants (fallback si l'IA n'en fournit pas).
export const DEFAULT_BLUEPRINTS: Record<string, number> = {
  tshirt: 6, // Unisex Jersey Short Sleeve Tee (Bella+Canvas 3001)
  hoodie: 77, // Unisex Heavy Blend Hooded Sweatshirt
  mug: 68, // 11oz Mug
  poster: 5, // Poster
  totebag: 397, // Tote Bag
  sticker: 400, // Kiss-Cut Stickers
  phonecase: 268, // iPhone case
};

// Devine le blueprint le plus adapté depuis le nom/catégorie du produit.
export function guessBlueprint(text: string): number {
  const t = (text || "").toLowerCase();
  if (/hoodie|sweat|pull|capuche/.test(t)) return DEFAULT_BLUEPRINTS.hoodie;
  if (/mug|tasse|cup/.test(t)) return DEFAULT_BLUEPRINTS.mug;
  if (/poster|affiche|print|wall/.test(t)) return DEFAULT_BLUEPRINTS.poster;
  if (/tote|bag|sac|cabas/.test(t)) return DEFAULT_BLUEPRINTS.totebag;
  if (/sticker|autocollant/.test(t)) return DEFAULT_BLUEPRINTS.sticker;
  if (/phone|case|coque|iphone|samsung/.test(t)) return DEFAULT_BLUEPRINTS.phonecase;
  return DEFAULT_BLUEPRINTS.tshirt; // défaut : t-shirt
}

export interface AutoProductInput {
  title: string;
  description: string;
  designDataUrl: string; // data:image/...;base64,... (design/artwork à imprimer)
  priceCents: number; // prix de vente unitaire en centimes
  blueprintId?: number; // sinon deviné depuis le title
  maxVariants?: number; // limite le nombre de variantes activées (défaut 100)
}

export interface AutoProductResult {
  ok: boolean;
  error?: string;
  printifyProductId?: string;
  blueprintId?: number;
  providerId?: number;
  imageId?: string;
  variants?: Array<{ vid: number; label: string; price: number }>;
  published?: boolean;
}

// Crée + publie un produit Printify complet à partir d'un design.
export async function autoCreatePrintifyProduct(
  cfg: printify.PrintifyConfig,
  input: AutoProductInput,
): Promise<AutoProductResult> {
  try {
    const shopId = await printify.resolveShopId(cfg);
    if (!shopId) return { ok: false, error: "Aucun shop Printify trouvé" };
    cfg = { ...cfg, shopId };

    const blueprintId = input.blueprintId || guessBlueprint(input.title);

    // 1. Premier print provider disponible pour ce blueprint.
    const provRes = await printify.getBlueprintProviders(cfg, blueprintId);
    if (!provRes.ok) return { ok: false, error: `Providers introuvables (blueprint ${blueprintId}): ${provRes.message || provRes.status}` };
    const providers: any[] = Array.isArray(provRes.data) ? provRes.data : [];
    if (!providers.length) return { ok: false, error: `Aucun print provider pour le blueprint ${blueprintId}` };
    const providerId = Number(providers[0].id);

    // 2. Variantes du blueprint/provider.
    const varRes = await printify.getBlueprintVariants(cfg, blueprintId, providerId);
    if (!varRes.ok) return { ok: false, error: `Variantes introuvables: ${varRes.message || varRes.status}` };
    const rawVariants: any[] = (varRes.data as any)?.variants || [];
    if (!rawVariants.length) return { ok: false, error: "Aucune variante disponible" };
    const cap = input.maxVariants ?? 100;
    const chosen = rawVariants.slice(0, cap);
    const price = Math.max(100, Math.round(input.priceCents || 2500));

    const variantInputs: printify.PrintifyVariantInput[] = chosen.map((v) => ({
      id: Number(v.id),
      price,
      is_enabled: true,
    }));
    const variantIds = variantInputs.map((v) => v.id);

    // 3. Construction des print_areas (design sur la face avant).
    const areas: printifyDesign.DesignPrintArea[] = [
      {
        position: "front",
        layers: [
          { type: "image", dataUrl: input.designDataUrl, x: 0.5, y: 0.5, scale: 0.9 },
        ],
      },
    ];
    let printAreas: printify.PrintifyPrintArea[];
    try {
      printAreas = await printifyDesign.buildPrintAreas(cfg, areas, variantIds);
    } catch (e: any) {
      return { ok: false, error: `Échec construction du design: ${e?.message || e}` };
    }
    const imageId = String(printAreas?.[0]?.placeholders?.[0]?.images?.[0]?.id || "");

    // 4. Création du produit.
    const productInput: printify.PrintifyProductInput = {
      title: input.title.slice(0, 120),
      description: (input.description || input.title).slice(0, 2000),
      blueprint_id: blueprintId,
      print_provider_id: providerId,
      variants: variantInputs,
      print_areas: printAreas,
    };
    const created = await printify.createProduct(cfg, productInput);
    if (!created.ok) return { ok: false, error: `createProduct refusé: ${created.message || created.status}`, blueprintId, providerId, imageId };
    const printifyProductId = String((created.data as any)?.id || "");
    if (!printifyProductId) return { ok: false, error: "createProduct: id manquant", blueprintId, providerId, imageId };

    // 5. Publication (rend le produit vendable).
    let published = false;
    const pub = await printify.publishProduct(cfg, printifyProductId);
    published = pub.ok;

    // Labels des variantes (taille/couleur) pour le sélecteur du site.
    const labelFor = (v: any): string => {
      if (v?.title) return String(v.title);
      const opts = v?.options && typeof v.options === "object" ? Object.values(v.options).join(" / ") : "";
      return opts || `Variante ${v?.id}`;
    };
    const variants = chosen.map((v) => ({ vid: Number(v.id), label: labelFor(v), price: price / 100 }));

    return { ok: true, printifyProductId, blueprintId, providerId, imageId, variants, published };
  } catch (e: any) {
    return { ok: false, error: e?.message || String(e) };
  }
}

// Récupère l'URL du mockup (photo produit RÉELLE générée par Printify) d'un
// produit. C'est cette image — et jamais une image inventée par l'IA — qu'on
// affiche. Renvoie '' si aucun mockup disponible.
export async function fetchDefaultMockup(cfg: printify.PrintifyConfig, productId: string): Promise<string> {
  try {
    const shopId = await printify.resolveShopId(cfg);
    if (!shopId) return '';
    const res = await printify.getProduct({ ...cfg, shopId }, String(productId));
    if (!res.ok) return '';
    const images: any[] = (res.data as any)?.images || [];
    if (!images.length) return '';
    const def = images.find((i) => i?.is_default) || images.find((i) => i?.is_selected_for_publishing) || images[0];
    return String(def?.src || '');
  } catch { return ''; }
}
