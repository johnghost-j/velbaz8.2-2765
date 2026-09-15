// ─── Tarification IA : USD par million de tokens + conversion en crédits ─────
//
// Source unique de vérité pour le coût d'un appel IA. Utilisé par le middleware
// gateway (tous les appels texte/stream) et par les appels à coût forfaitaire
// (images). Si un modèle est inconnu, on applique DEFAULT_PRICE et on marque
// l'évènement `priced: "fallback"` pour que l'admin voie qu'il faut l'ajouter.

export interface ModelPrice {
  /** USD par million de tokens d'entrée non cachés. */
  input: number;
  /** USD par million de tokens de sortie. */
  output: number;
  /** USD par million de tokens d'entrée lus depuis le cache (défaut : 10% input). */
  cacheRead?: number;
  /** USD par million de tokens écrits en cache (défaut : 125% input). */
  cacheWrite?: number;
}

export const MODEL_PRICES: Record<string, ModelPrice> = {
  "anthropic/claude-haiku-4.5": { input: 1, output: 5 },
  "anthropic/claude-sonnet-4.5": { input: 3, output: 15 },
  "anthropic/claude-sonnet-4.6": { input: 3, output: 15 },
  "anthropic/claude-opus-4.6": { input: 15, output: 75 },
  "anthropic/claude-opus-4.7": { input: 15, output: 75 },
  "openai/gpt-5.4": { input: 1.25, output: 10 },
  "openai/gpt-5.4-mini": { input: 0.25, output: 2 },
  "openai/gpt-5.4-nano": { input: 0.05, output: 0.4 },
  "google/gemini-3-flash": { input: 0.5, output: 3 },
  "google/gemini-3-pro": { input: 2, output: 12 },
  "google/gemini-2.0-flash-001": { input: 0.1, output: 0.4 },
  "google/gemini-2.5-flash-image": { input: 0.3, output: 2.5 },
  "google/gemini-3-pro-image": { input: 2, output: 12 },
  // Nano Banana 2 Lite — modèle image par défaut (1K uniquement).
  "google/gemini-3.1-flash-lite-image": { input: 0.25, output: 1.5 },
  "google/gemini-3.1-flash-image": { input: 0.3, output: 2.5 },
};

/** Utilisé quand le modèle n'est pas dans la table (estimation prudente). */
export const DEFAULT_PRICE: ModelPrice = { input: 1, output: 5 };

/**
 * Coût forfaitaire par image générée (USD). Les modèles image facturent à
 * l'image, pas au token : quand un appel produit des fichiers, on compte
 * `nbImages × forfait` au lieu des tokens de sortie.
 */
// Tarifs publics Google (standard, hors batch), vérifiés le 2026-09-09 :
//   - 2.5 Flash Image (Nano Banana 1) ....... 0,039 $/image
//   - 3.1 Flash Lite Image (NB 2 Lite, 1K) .. 0,034 $/image
//   - 3.1 Flash Image (Nano Banana 2, 1K) ... 0,067 $/image
//   - 3 Pro Image (Nano Banana Pro) ......... 0,134 $ en 1K/2K, 0,24 $ en 4K
// (le forfait 3-pro-image reste au pire cas 4K, volontairement prudent)
export const IMAGE_FLAT_USD: Record<string, number> = {
  "google/gemini-2.5-flash-image": 0.039,
  "google/gemini-3.1-flash-lite-image": 0.034,
  "google/gemini-3.1-flash-image": 0.067,
  "google/gemini-3-pro-image": 0.24,
};

/** Combien de crédits vaut 1 USD. 3000 => 1 crédit = 0,000333 $. */
export const CREDITS_PER_USD: number = Number(process.env.AI_CREDITS_PER_USD) || 3000;

export function usdToCredits(usd: number): number {
  return Math.round(usd * CREDITS_PER_USD * 100) / 100;
}

export function isKnownModel(model: string): boolean {
  return model in MODEL_PRICES;
}

export function getPrice(model: string): ModelPrice {
  return MODEL_PRICES[model] ?? DEFAULT_PRICE;
}

export interface TokenCounts {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  reasoning: number;
}

/**
 * Coût USD d'un appel. `images > 0` bascule sur le forfait image pour la partie
 * sortie (les tokens d'entrée restent facturés normalement).
 */
export function computeCostUsd(model: string, tokens: TokenCounts, images = 0): number {
  const p = getPrice(model);
  const cacheReadPrice = p.cacheRead ?? p.input * 0.1;
  const cacheWritePrice = p.cacheWrite ?? p.input * 1.25;

  const inputUsd =
    (tokens.input * p.input + tokens.cacheRead * cacheReadPrice + tokens.cacheWrite * cacheWritePrice) / 1_000_000;

  const flat = IMAGE_FLAT_USD[model];
  const outputUsd =
    images > 0 && flat != null ? images * flat : (tokens.output * p.output) / 1_000_000;

  return Number((inputUsd + outputUsd).toFixed(6));
}
