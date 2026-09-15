// ─── Middleware de comptage : capture TOUS les appels IA du gateway ──────────
//
// Branché dans agent/gateway.ts via wrapLanguageModel : chaque modèle rendu par
// `gateway(...)` est enveloppé, donc les ~500 sites d'appel existants sont
// couverts sans modification. Capture : tokens (dont cache/raisonnement), durée,
// modèle, statut (ok/error → coût gaspillé), images produites, et le contexte
// d'attribution ambiant (feature/user/projet/run).

import type { LanguageModelV3Middleware, LanguageModelV3StreamPart, LanguageModelV3Usage } from "@ai-sdk/provider";
import { getAiContext } from "./context";
import { computeCostUsd, isKnownModel } from "./pricing";
import { recordAiUsage } from "./recorder";

function tokensFrom(usage: LanguageModelV3Usage | undefined) {
  return {
    input: usage?.inputTokens?.noCache ?? usage?.inputTokens?.total ?? 0,
    output: usage?.outputTokens?.total ?? 0,
    cacheRead: usage?.inputTokens?.cacheRead ?? 0,
    cacheWrite: usage?.inputTokens?.cacheWrite ?? 0,
    reasoning: usage?.outputTokens?.reasoning ?? 0,
  };
}

interface EmitOptions {
  modelId: string;
  provider: string;
  routedVia: string;
  kind: "text" | "stream";
  startedAt: number;
  usage?: LanguageModelV3Usage;
  images?: number;
  status: "ok" | "error";
  errorMessage?: string;
  finishReason?: string;
}

function emit(o: EmitOptions): void {
  const ctx = getAiContext();
  const tokens = tokensFrom(o.usage);
  const images = o.images ?? 0;
  recordAiUsage({
    startedAt: o.startedAt,
    endedAt: Date.now(),
    model: o.modelId,
    provider: o.provider,
    routedVia: o.routedVia,
    kind: images > 0 ? "image" : o.kind,
    feature: ctx?.feature ?? "unknown",
    label: ctx?.label ?? null,
    route: ctx?.route ?? null,
    runId: ctx?.runId ?? null,
    userId: ctx?.userId ?? null,
    userEmail: ctx?.userEmail ?? null,
    companyId: ctx?.companyId ?? null,
    projectId: ctx?.projectId ?? null,
    inputTokens: tokens.input,
    outputTokens: tokens.output,
    cacheReadTokens: tokens.cacheRead,
    cacheWriteTokens: tokens.cacheWrite,
    reasoningTokens: tokens.reasoning,
    images,
    costUsd: computeCostUsd(o.modelId, tokens, images),
    priced: isKnownModel(o.modelId) ? "table" : "fallback",
    status: o.status,
    errorMessage: o.errorMessage ?? null,
    finishReason: o.finishReason ?? null,
  });
}

/**
 * Crée le middleware pour un identifiant de modèle donné.
 * `fullModelId` est l'id complet ("anthropic/claude-sonnet-4.6") : le modèle
 * sous-jacent, lui, ne connaît souvent que la partie après le slash.
 */
export function createAiUsageMiddleware(fullModelId: string, routedVia: string): LanguageModelV3Middleware {
  const slash = fullModelId.indexOf("/");
  const provider = slash > 0 ? fullModelId.slice(0, slash) : "unknown";

  return {
    specificationVersion: "v3",

    async wrapGenerate({ doGenerate }) {
      const startedAt = Date.now();
      try {
        const result = await doGenerate();
        const images = result.content.filter((c) => c.type === "file").length;
        emit({
          modelId: fullModelId,
          provider,
          routedVia,
          kind: "text",
          startedAt,
          usage: result.usage,
          images,
          status: "ok",
          finishReason: result.finishReason?.unified,
        });
        return result;
      } catch (e) {
        // Un appel raté coûte quand même les tokens d'entrée côté provider dans
        // la plupart des cas : on l'enregistre pour mesurer le gaspillage.
        emit({
          modelId: fullModelId,
          provider,
          routedVia,
          kind: "text",
          startedAt,
          status: "error",
          errorMessage: (e as Error)?.message ?? String(e),
        });
        throw e;
      }
    },

    async wrapStream({ doStream }) {
      const startedAt = Date.now();
      let result: Awaited<ReturnType<typeof doStream>>;
      try {
        result = await doStream();
      } catch (e) {
        emit({
          modelId: fullModelId,
          provider,
          routedVia,
          kind: "stream",
          startedAt,
          status: "error",
          errorMessage: (e as Error)?.message ?? String(e),
        });
        throw e;
      }

      let usage: LanguageModelV3Usage | undefined;
      let finishReason: string | undefined;
      let images = 0;
      let streamError: string | undefined;
      let emitted = false;

      const finalize = () => {
        if (emitted) return;
        emitted = true;
        emit({
          modelId: fullModelId,
          provider,
          routedVia,
          kind: "stream",
          startedAt,
          usage,
          images,
          status: streamError ? "error" : "ok",
          errorMessage: streamError,
          finishReason,
        });
      };

      // `cancel` existe à l'exécution (Bun/Node) mais pas encore dans le type
      // `Transformer` de la lib TS installée -> cast pour garder le comportement.
      const transformer = {
        transform(part: LanguageModelV3StreamPart, controller: TransformStreamDefaultController<LanguageModelV3StreamPart>) {
          if (part.type === "finish") {
            usage = part.usage;
            finishReason = part.finishReason?.unified;
          } else if (part.type === "file") {
            images += 1;
          } else if (part.type === "error") {
            streamError = (part.error as Error)?.message ?? String(part.error);
          }
          controller.enqueue(part);
        },
        flush() {
          finalize();
        },
        cancel() {
          // Stream abandonné (timeout, client parti) : les tokens déjà produits
          // sont facturés, on enregistre ce qu'on a vu.
          streamError = streamError ?? "stream aborted";
          finalize();
        },
      };

      const transform = new TransformStream<LanguageModelV3StreamPart, LanguageModelV3StreamPart>(
        transformer as Transformer<LanguageModelV3StreamPart, LanguageModelV3StreamPart>,
      );

      return { ...result, stream: result.stream.pipeThrough(transform) };
    },
  };
}
