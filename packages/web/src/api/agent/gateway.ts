// ─── Gateway IA intelligent : clé perso (provider direct) ou Runable Gateway ──
//
// Comportement :
//   - Par défaut, tous les appels passent par le Runable AI Gateway.
//   - Dès qu'une clé perso VALIDE est configurée pour un provider (openai,
//     anthropic, google, ou "custom" OpenAI-compatible), les modèles de ce
//     provider (`openai/...`, `anthropic/...`, `google/...`) sont routés EN
//     DIRECT vers l'API du provider avec la clé perso — plus via le gateway.
//   - Repli automatique sur le gateway si pas de clé perso pour ce provider.
//
// Les clés sont injectées par secret-store.ts via setProviderKeys() (déchiffrées,
// jamais exposées au front). Le résolveur reste SYNCHRONE (cache mémoire) pour ne
// pas casser les ~centaines d'appels existants `gateway(model)`.
//
import { createGateway } from "@ai-sdk/gateway";
import { createOpenAI } from "@ai-sdk/openai";
import { createAnthropic } from "@ai-sdk/anthropic";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { wrapLanguageModel } from "ai";
import type { LanguageModel, LanguageModelMiddleware } from "ai";
import { createAiUsageMiddleware } from "../ai-usage/middleware";

export interface CustomProvider {
  apiKey: string;
  baseUrl?: string;
}

// Cache mémoire des clés perso (peuplé par secret-store.loadAllSecrets / écritures).
// Persisté sur globalThis pour survivre au HMR / re-eval SSR.
let providerKeys: Record<string, CustomProvider> =
  ((globalThis as any).__velbaz_provider_keys ??= {});

/** Remplace la table des clés perso et la fige sur globalThis. */
export function setProviderKeys(keys: Record<string, CustomProvider>) {
  providerKeys = keys;
  (globalThis as any).__velbaz_provider_keys = keys;
}

export function hasCustomProvider(provider: string): boolean {
  return !!providerKeys[provider]?.apiKey;
}

// ── Modèle IMAGE par défaut ─────────────────────────────────────────────────
// Nano Banana 2 Lite (Gemini 3.1 Flash Lite Image) : sortie 1K uniquement,
// ~0,034 $/image — le moins cher de la famille (NB1 2.5-flash : 0,039 $ ;
// NB2 : 0,067 $ ; NB Pro : 0,134 $ en 2K et 0,24 $ en 4K).
// Surchargeable via env IMAGE_MODEL.
export const IMAGE_MODEL: string =
  process.env.IMAGE_MODEL || "google/gemini-3.1-flash-lite-image";

// ── Modèle UNCENSORED par défaut (mode admin safety-off) ────────────────────
// Modifiable via env UNCENSORED_MODEL. Doit être un id OpenRouter préfixé
// "openrouter/". Défaut : Venice Uncensored (gratuit sur OpenRouter).
export const UNCENSORED_MODEL: string =
  process.env.UNCENSORED_MODEL || "openrouter/cognitivecomputations/dolphin-mistral-24b-venice-edition:free";

/** Vrai si une clé OpenRouter est configurée -> les modèles uncensored marchent. */
export function hasUncensoredProvider(): boolean {
  return !!(providerKeys["openrouter"]?.apiKey || process.env.OPENROUTER_API_KEY);
}

// Runable AI Gateway (défaut / repli).
const runableGateway = createGateway({
  baseURL: process.env.AI_GATEWAY_BASE_URL,
  apiKey: process.env.AI_GATEWAY_API_KEY,
});

// ── Comptage des crédits ────────────────────────────────────────────────────
// Chaque modèle rendu par gateway() est enveloppé par le middleware de mesure :
// tous les sites d'appel existants sont donc couverts sans être modifiés.
// `fullModelId` garde l'id COMPLET (ex. "anthropic/claude-sonnet-4.6") même quand
// le provider sous-jacent ne connaît que la partie après le slash.
function meter(model: unknown, fullModelId: string, routedVia: "gateway" | "direct-key"): LanguageModel {
  const spec = (model as { specificationVersion?: string })?.specificationVersion;
  // Le middleware implémente la spec v3 (celle que consomme ai@6). Certains
  // providers installés (@ai-sdk/anthropic@4, @ai-sdk/google@4) rendent du v4 :
  // on les laisse passer tels quels plutôt que de les envelopper de travers.
  if (typeof model === "string" || spec !== "v3") {
    if (spec && spec !== "v3") {
      console.warn(`[gateway] modèle ${fullModelId} en spec ${spec} — non compté (middleware v3)`);
    }
    return model as LanguageModel;
  }
  try {
    return wrapLanguageModel({
      model: model as Parameters<typeof wrapLanguageModel>[0]["model"],
      middleware: createAiUsageMiddleware(fullModelId, routedVia) as LanguageModelMiddleware,
    });
  } catch (e) {
    // Le comptage ne doit JAMAIS casser un appel IA.
    console.warn("[gateway] wrap comptage KO, modèle brut :", (e as Error).message);
    return model as LanguageModel;
  }
}

/**
 * Résout un identifiant de modèle ("anthropic/claude-...", "openai/gpt-...",
 * "google/gemini-...") vers un LanguageModel.
 *   - clé perso présente pour le provider -> appel direct provider.
 *   - sinon -> Runable Gateway (comportement historique inchangé).
 */
export function gateway(modelId: string): LanguageModel {
  // ── Routage UNCENSORED via OpenRouter (mode admin safety-off) ──────────────
  // Un id de modèle préfixé "openrouter/" est envoyé EN DIRECT à OpenRouter
  // (OpenAI-compatible), en conservant l'id COMPLET du modèle (ex.
  // "openrouter/venice/uncensored:free" -> modèle "venice/uncensored:free").
  // Nécessite OPENROUTER_API_KEY (ou une clé "openrouter" dans le secret-store).
  if (modelId.startsWith("openrouter/")) {
    const orKey = providerKeys["openrouter"]?.apiKey || process.env.OPENROUTER_API_KEY;
    const orModel = modelId.slice("openrouter/".length);
    if (orKey) {
      const orBase = providerKeys["openrouter"]?.baseUrl || "https://openrouter.ai/api/v1";
      try {
        return meter(createOpenAI({ apiKey: orKey, baseURL: orBase })(orModel), modelId, "direct-key");
      } catch (e) {
        console.warn(`[gateway] OpenRouter KO, repli gateway :`, (e as Error).message);
      }
    } else {
      console.warn("[gateway] modèle openrouter demandé mais AUCUNE clé OPENROUTER_API_KEY — repli gateway (censuré)");
    }
    // Pas de clé/échec -> on retombe sur le modèle par défaut du gateway (censuré).
    return meter(runableGateway(orModel), modelId, "gateway");
  }

  const slash = modelId.indexOf("/");
  const provider = slash > 0 ? modelId.slice(0, slash) : "";
  const name = slash > 0 ? modelId.slice(slash + 1) : modelId;
  const custom = provider ? providerKeys[provider] : undefined;

  if (custom?.apiKey) {
    try {
      switch (provider) {
        case "openai":
          return meter(createOpenAI({ apiKey: custom.apiKey, baseURL: custom.baseUrl })(name), modelId, "direct-key");
        case "anthropic":
          return meter(createAnthropic({ apiKey: custom.apiKey, baseURL: custom.baseUrl })(name), modelId, "direct-key");
        case "google":
          return meter(createGoogleGenerativeAI({ apiKey: custom.apiKey, baseURL: custom.baseUrl })(name), modelId, "direct-key");
      }
    } catch (e) {
      console.warn(`[gateway] provider perso ${provider} KO, repli gateway :`, (e as Error).message);
    }
  }

  // Provider "custom" OpenAI-compatible (OpenRouter, Groq, Together, DeepSeek…) :
  // s'applique quel que soit le préfixe si une clé "custom" est configurée.
  const customCompat = providerKeys["custom"];
  if (customCompat?.apiKey && customCompat.baseUrl && !custom?.apiKey) {
    try {
      return meter(
        createOpenAI({ apiKey: customCompat.apiKey, baseURL: customCompat.baseUrl })(name || modelId),
        modelId,
        "direct-key",
      );
    } catch (e) {
      console.warn(`[gateway] provider custom KO, repli gateway :`, (e as Error).message);
    }
  }

  return meter(runableGateway(modelId), modelId, "gateway");
}
