// ─── DÉPRÉCIÉ — remplacé par ai-usage/ ───────────────────────────────────────
//
// Cet ancien logger écrivait une ligne JSONL par appel IA dans
// data/ai-usage.jsonl. Il avait trois défauts : non persistant (perdu à chaque
// redéploiement), aucun endpoint pour le lire, et seulement 9 sites d'appel
// instrumentés alors que le code fait des centaines d'appels IA.
//
// Le comptage se fait désormais AU NIVEAU DU GATEWAY : agent/gateway.ts
// enveloppe chaque modèle avec ai-usage/middleware.ts, donc 100 % des appels
// sont mesurés et persistés en base (table ai_usage_events) avec leur contexte
// d'attribution (feature, utilisateur, société, projet, run).
//
// `logAiUsage` reste exporté en no-op pour ne casser aucun import résiduel :
// l'appeler enregistrerait un doublon de ce que le middleware a déjà compté.
//
// -> Pour taguer un appel, utilise runWithAiContext() de ai-usage/context.ts.
// -> Pour lire les données, utilise les routes /api/admin/ai-usage/*.

/** @deprecated No-op. Le comptage est fait par ai-usage/middleware.ts. */
export function logAiUsage(_model: string, _usage: unknown, _tag: string, _flatCost?: number): void {
  // Volontairement vide : éviter le double comptage.
}
