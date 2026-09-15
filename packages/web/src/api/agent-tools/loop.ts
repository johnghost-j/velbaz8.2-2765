// ─── Boucle d'agent : le modèle appelle ses outils jusqu'à avoir la réponse ──
//
// Une réponse de chat normale = 1 appel au modèle. Ici, tant que le modèle
// demande un outil (ouvrir une page, lancer une commande…), on l'exécute et on
// lui renvoie le résultat, jusqu'à ce qu'il rédige sa réponse finale ou qu'on
// atteigne le plafond d'étapes.
//
// Rien n'est masqué : chaque outil exécuté émet une étape `progress` visible
// dans le chat, et le journal des appels revient dans le résultat.

import { generateText, stepCountIs } from 'ai';
import { gateway } from '../agent/gateway';
import { buildAgentTools } from './tools';
import type { AgentProgress, ToolCall } from './types';

const MAX_STEPS = 12;              // garde-fou : jamais de boucle infinie
const CALL_TIMEOUT_MS = 600_000;   // 10 min pour toute la boucle
const FALLBACK_MODELS = ['openai/gpt-5.4-mini', 'google/gemini-3-flash'];

export interface AgentLoopOptions {
  system: string;
  /** Message utilisateur, ou contenu multimodal (pièces jointes). */
  content: string | any[];
  model: string;
  sessionId: string;
  companyId?: string;
  onProgress?: (step: AgentProgress) => void;
  maxOutputTokens?: number;
  maxSteps?: number;
}

export interface AgentLoopResult {
  text: string;
  calls: ToolCall[];
  steps: number;
}

function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`AI_TIMEOUT: ${label} exceeded ${ms}ms`)), ms);
    p.then((v) => { clearTimeout(t); resolve(v); }, (e) => { clearTimeout(t); reject(e); });
  });
}

/**
 * Lance la boucle. Renvoie null si le modèle est indisponible — l'appelant
 * retombe alors sur la génération de texte classique (pas de chat cassé).
 */
export async function runAgentLoop(opts: AgentLoopOptions): Promise<AgentLoopResult | null> {
  const calls: ToolCall[] = [];
  const tools = buildAgentTools({
    sessionId: opts.sessionId,
    companyId: opts.companyId,
    onProgress: opts.onProgress,
    log: calls,
  });

  const models = [opts.model, ...FALLBACK_MODELS.filter((m) => m !== opts.model)];
  let lastErr = '';

  for (const model of models) {
    try {
      const res = await withTimeout(
        generateText({
          model: gateway(model),
          system: opts.system,
          messages: [{ role: 'user', content: opts.content as any }],
          tools: tools as any,
          stopWhen: stepCountIs(opts.maxSteps ?? MAX_STEPS),
          maxOutputTokens: opts.maxOutputTokens ?? 1500,
          maxRetries: 0,
          abortSignal: AbortSignal.timeout(CALL_TIMEOUT_MS),
        }),
        CALL_TIMEOUT_MS,
        model,
      );
      const text = (res.text || '').trim();
      // Un modèle qui a travaillé mais n'a rien rédigé : on ne renvoie pas du
      // vide, l'appelant reprendra la main avec le journal des outils.
      if (!text && calls.length === 0) { lastErr = 'EMPTY_OUTPUT'; continue; }
      return { text, calls, steps: res.steps?.length ?? 1 };
    } catch (e: any) {
      lastErr = e?.message || String(e);
      console.log(`[agent-loop] ${model} a échoué :`, lastErr.slice(0, 200));
      // Certains modèles ne gèrent pas les outils : on tente le suivant.
      continue;
    }
  }
  console.log('[agent-loop] aucun modèle disponible pour la boucle d\'outils :', lastErr.slice(0, 200));
  return null;
}

/** Résumé lisible des outils utilisés (repli quand le modèle ne rédige rien). */
export function summarizeCalls(calls: ToolCall[]): string {
  if (!calls.length) return '';
  return calls.map((c) => `- ${c.tool} → ${c.ok ? 'ok' : 'échec'} : ${c.summary}`).join('\n');
}
