// ─── Agent de Raisonnement (Velbaz) ───────────────────────────────────────────
// Un agent DÉDIÉ, séparé du travail réel (design/code/QA), dont le seul rôle
// est d'OBSERVER une tâche en cours et d'EXPLIQUER en langage naturel:
//   1) AVANT: "je vais faire X parce que Y" (intention + raison)
//   2) APRÈS: "j'ai fait X, résultat Z" (bilan + explication du résultat)
// Ce texte est émis comme un événement [REASONING:<taskKey>] dans le flux de
// progression (onProgress), au même titre que [CODE_START]/[CODE_DONE], pour
// s'afficher SOUS la tâche correspondante dans le chat (à côté des groupes
// Recherche/Design/Développement...).
//
// Contrainte de coût/latence: on utilise un modèle RAPIDE (pas le modèle
// principal de génération) et on adapte la longueur au niveau de complexité
// de la tâche (court pour une étape simple, plus détaillé pour une étape
// structurante comme le plan ou le design system).

import { generateText } from "ai";
import { gateway } from "../agent/gateway";

const REASONING_MODEL = "openai/gpt-5.4-mini";

export type ReasoningComplexity = "low" | "medium" | "high";

export interface ReasoningTask {
  /** Identifiant stable de la tâche (ex: "plan", "design", "page:Home.tsx", "qa:Home.tsx"). */
  key: string;
  /** Nom lisible de la tâche pour le prompt (ex: "Génération du plan de l'app"). */
  label: string;
  /** Contexte court utile pour que le raisonnement soit spécifique, pas générique. */
  context: string;
  complexity: ReasoningComplexity;
}

const MAX_TOKENS_BY_COMPLEXITY: Record<ReasoningComplexity, number> = {
  low: 120,
  medium: 220,
  high: 380,
};

const SYSTEM_INTENT = `Tu es l'Agent de Raisonnement de Velbaz. Ton seul rôle: expliquer à l'utilisateur, en français, simple et concret, ce qu'un autre agent IA s'apprête à faire et POURQUOI — jamais le faire toi-même.
Règles:
- COMMENCE OBLIGATOIREMENT ta première phrase par "Je vais " (ex: "Je vais construire la page d'accueil parce que…"). Jamais de titre, jamais de préfixe du type "Ce que je vais faire :".
- Parle à la première personne, ton direct de collègue technique, jamais de jargon creux.
- Explique le POURQUOI (contrainte business, choix technique, dépendance à une étape précédente).
- Adapte la longueur à la complexité indiquée: reste court pour une tâche simple, plus détaillé pour une tâche structurante.
- Aucune ponctuation décorative, aucun emoji, pas de markdown. Texte brut uniquement.`;

const SYSTEM_OUTCOME = `Tu es l'Agent de Raisonnement de Velbaz. Ton seul rôle: expliquer à l'utilisateur, en français, simple et concret, ce qu'un autre agent IA VIENT de faire et quel est le résultat — jamais refaire le travail toi-même.
Règles:
- COMMENCE OBLIGATOIREMENT ta première phrase par "J'ai " (ex: "J'ai construit la page d'accueil et…"). Jamais de titre, jamais de préfixe du type "Ce que j'ai fait :".
- Parle à la première personne, ton direct de collègue technique.
- Si le résultat a des limites ou des compromis (score QA, données ignorées, etc.), dis-le honnêtement.
- Adapte la longueur à la complexité indiquée: reste court pour une tâche simple, plus détaillé pour une tâche structurante.
- Aucune ponctuation décorative, aucun emoji, pas de markdown. Texte brut uniquement.`;

async function callReasoning(system: string, prompt: string, complexity: ReasoningComplexity): Promise<string> {
  try {
    const { text } = await generateText({
      model: gateway(REASONING_MODEL),
      system,
      prompt,
      maxOutputTokens: MAX_TOKENS_BY_COMPLEXITY[complexity],
    });
    return (text || "").trim();
  } catch (e: any) {
    return ""; // best-effort — le raisonnement ne doit jamais casser le build
  }
}

/**
 * Génère le raisonnement "AVANT" (intention + raison) pour une tâche, et
 * l'émet immédiatement via onProgress sous forme d'événement [REASONING:key:intent].
 */
export async function explainIntent(
  task: ReasoningTask,
  onProgress?: (msg: string) => void,
): Promise<void> {
  const prompt = `Tâche à venir: "${task.label}"
Contexte: ${task.context}
Complexité: ${task.complexity}

Explique en 1 à 4 phrases (selon la complexité) ce que tu vas faire pour cette tâche précise et pourquoi, à la première personne.`;
  const text = await callReasoning(SYSTEM_INTENT, prompt, task.complexity);
  if (text) onProgress?.(`[REASONING:${task.key}:intent]${text}`);
}

/**
 * Génère le raisonnement "APRÈS" (bilan + résultat) pour une tâche, et
 * l'émet via onProgress sous forme d'événement [REASONING:key:outcome].
 */
export async function explainOutcome(
  task: ReasoningTask,
  outcomeContext: string,
  onProgress?: (msg: string) => void,
): Promise<void> {
  const prompt = `Tâche terminée: "${task.label}"
Contexte initial: ${task.context}
Résultat obtenu: ${outcomeContext}
Complexité: ${task.complexity}

Explique en 1 à 4 phrases (selon la complexité) ce que tu as fait et le résultat, à la première personne. Sois honnête sur les limites s'il y en a.`;
  const text = await callReasoning(SYSTEM_OUTCOME, prompt, task.complexity);
  if (text) onProgress?.(`[REASONING:${task.key}:outcome]${text}`);
}

/**
 * Enrobe une tâche async avec un raisonnement avant/après automatique.
 * Best-effort: si les appels de raisonnement échouent ou prennent du temps,
 * la tâche réelle n'est jamais bloquée au-delà de ce que l'appel IA lui-même
 * prend (les deux explains sont "fire-and-forget" côté progression, mais on
 * attend l'intent AVANT de lancer le travail pour que l'ordre d'affichage
 * dans le chat reste correct: intention → travail → résultat).
 */
export async function withReasoning<T>(
  task: ReasoningTask,
  work: () => Promise<T>,
  describeOutcome: (result: T) => string,
  onProgress?: (msg: string) => void,
): Promise<T> {
  await explainIntent(task, onProgress);
  const result = await work();
  try {
    await explainOutcome(task, describeOutcome(result), onProgress);
  } catch { /* best-effort */ }
  return result;
}
