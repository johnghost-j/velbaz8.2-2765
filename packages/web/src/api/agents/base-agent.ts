// ─── Base Agent — shared execution logic for all sub-agents ──────────────────

import { generateText } from "ai";
import { gateway } from "../agent/gateway";
import { SOLUTION_MINDSET } from "./types";
import type { AgentConfig, AgentResult, CompanyContext, AgentMessage } from "./types";

export async function executeAgent(
  config: AgentConfig,
  userMessage: string,
  ctx: CompanyContext,
  history: AgentMessage[] = []
): Promise<AgentResult> {
  const systemPrompt = config.systemPrompt(ctx);
  
  // Build conversation for context
  const conversationContext = history.length > 0
    ? history.map(m => `${m.role === 'user' ? 'User' : 'Agent'}: ${m.content.slice(0, 600)}`).join('\n') + `\nUser: ${userMessage}`
    : userMessage;

  try {
    const { text } = await generateText({
      model: gateway(config.model),
      system: systemPrompt,
      prompt: conversationContext,
      maxOutputTokens: config.maxTokens,
      // maxRetries: 2 — avant c'était 0, donc un seul hoquet réseau (429, 503,
      // socket coupé) tuait l'agent et faisait s'arrêter le run tout seul.
      maxRetries: 2, abortSignal: AbortSignal.timeout(300000),
    });

    const raw = text || '';

    // Use custom parser if provided, otherwise default
    if (config.parseOutput) {
      return config.parseOutput(raw, ctx);
    }

    return defaultParseOutput(raw, ctx);
  } catch (err: any) {
    const msg = err?.message || String(err);
    console.error(`[${config.role}] Agent error:`, msg);
    
    // Erreur récupérable → on tente des modèles de secours EN CASCADE.
    // On couvre non seulement les crédits/rate-limit mais AUSSI les pannes de
    // gateway et les timeouts (« Gateway request failed », « operation timed out »,
    // « AbortError »…) : c'est précisément ce qui faisait échouer les agents
    // d'équipe et rendait la réponse finale vide/dégradée.
    const RECOVERABLE = /insufficient|credits|rate.?limit|gateway|timed?.?out|timeout|abort|fetch|network|ECONNRESET|ECONNREFUSED|socket|502|503|504|Invalid error response/i;
    if (RECOVERABLE.test(msg)) {
      // Textuel = gpt-5.4-mini en principal ; ces replis ne servent QUE si mini
      // échoue côté passerelle (crédits, rate-limit, timeout).
      // [2026-09-08] claude-sonnet-4.6 retiré (12× plus cher que mini) —
      // gemini-3-flash est le repli économique.
      const fallbackModels = ['openai/gpt-5.4-mini', 'google/gemini-3-flash'];
      for (const fallback of fallbackModels) {
        if (fallback === config.model) continue;
        try {
          console.log(`[${config.role}] Retrying with fallback model: ${fallback}`);
          const { text } = await generateText({
            model: gateway(fallback),
            system: `${config.systemPrompt(ctx)}\n${SOLUTION_MINDSET}`,
            prompt: history.length > 0
              ? history.map(m => `${m.role === 'user' ? 'User' : 'Agent'}: ${m.content.slice(0, 600)}`).join('\n') + `\nUser: ${userMessage}`
              : userMessage,
            maxOutputTokens: config.maxTokens,
            maxRetries: 1, abortSignal: AbortSignal.timeout(300000),
          });
          const raw = text || '';
          if (raw.trim()) {
            if (config.parseOutput) return config.parseOutput(raw, ctx);
            return defaultParseOutput(raw, ctx);
          }
        } catch (fallbackErr: any) {
          console.error(`[${config.role}] Fallback ${fallback} failed:`, fallbackErr?.message);
        }
      }
    }
    
    return {
      response: msg.includes('Insufficient credits') 
        ? `⚠️ Crédits IA épuisés. Veuillez recharger vos crédits pour continuer.`
        : `Erreur temporaire. Réessayez.`,
      data: {},
    };
  }
}

function defaultParseOutput(raw: string, _ctx: CompanyContext): AgentResult {
  const shouldBuild = raw.includes('[BUILD_COMPANY]');
  const cleanResponse = raw.replace(/\[BUILD_COMPANY\]/g, '').trim();

  // Extract [QUESTIONS] block
  const questionsMatch = cleanResponse.match(/\[QUESTIONS\]([\s\S]*?)\[\/QUESTIONS\]/);
  const questions = questionsMatch ? questionsMatch[0] : undefined;

  // Extract skill updates
  const skillUpdates: string[] = [];
  const skillRegex = /\[SKILL_UPDATE:\s*(.*?)\]/g;
  let match;
  while ((match = skillRegex.exec(raw)) !== null) {
    skillUpdates.push(match[1].trim());
  }

  return {
    response: cleanResponse,
    shouldBuild,
    questions,
    skillUpdates,
    data: {},
  };
}

// Helper: run multiple agents in parallel
export async function executeAgentsParallel(
  configs: AgentConfig[],
  userMessage: string,
  ctx: CompanyContext,
  history: AgentMessage[] = []
): Promise<Map<string, AgentResult>> {
  const results = new Map<string, AgentResult>();
  
  const promises = configs.map(async (config) => {
    const result = await executeAgent(config, userMessage, ctx, history);
    results.set(config.role, result);
  });

  await Promise.all(promises);
  return results;
}
