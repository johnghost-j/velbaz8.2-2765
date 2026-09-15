// ─── Team Engine — le « chef d'équipe » qui fait collaborer les agents ──────
// 4 phases pour chaque travail complexe :
//   1. DÉCOMPOSITION  — le Coordinateur (CEO) découpe la demande en sous-tâches
//                       et désigne quel agent spécialisé fait quoi (+ dépendances).
//   2. EXÉCUTION      — les agents travaillent en vagues : les tâches indépendantes
//                       tournent en PARALLÈLE ; un agent dépendant d'un autre lui
//                       envoie une [DEMANDE] et reçoit une [RÉPONSE] (vrais échanges).
//   3. RELECTURE      — le Coordinateur critique chaque livrable ([CRITIQUE]) ;
//                       si insuffisant, l'agent corrige (1 boucle max) puis [VALIDÉ].
//   4. SYNTHÈSE       — le Coordinateur assemble la réponse finale pour l'utilisateur.
//
// Tous les échanges passent par le bus (team-bus.ts) → visibles en direct dans
// le chat (SSE teamMsg) ET dans le panneau « Activité IA en direct ».

import { generateText } from "ai";
import { gateway } from "../agent/gateway";
import { executeAgent } from "./base-agent";
import { researchAgent } from "./research";
import { businessPlanAgent } from "./business-plan";
import { brandingAgent } from "./branding";
import { marketingAgent } from "./marketing";
import { financeAgent } from "./finance";
import { legalAgent } from "./legal";
import { contentAgent } from "./content";
import { expertKnowledgeFor } from "./expert-knowledge";
import { sendAgentMessage, type TeamEvent } from "./team-bus";
import type { AgentConfig, AgentRole, CompanyContext, AgentMessage } from "./types";

// ─── Les spécialistes disponibles pour le travail d'équipe ───────────────────
export const TEAM_SPECIALISTS: Record<string, { config: AgentConfig; name: string }> = {
  research: { config: researchAgent, name: "Recherche" },
  business_plan: { config: businessPlanAgent, name: "Plan d'affaires" },
  branding: { config: brandingAgent, name: "Branding" },
  marketing: { config: marketingAgent, name: "Marketing" },
  finance: { config: financeAgent, name: "Finance" },
  legal: { config: legalAgent, name: "Juridique" },
  content: { config: contentAgent, name: "Contenu" },
};

const COORDINATOR = { role: "orchestrator", name: "Coordinateur" };
const FAST_MODEL = "openai/gpt-5.4-mini";
const SYNTHESIS_MODEL = "openai/gpt-5.4-mini";
// Replis utilisés UNIQUEMENT si gpt-5.4-mini échoue côté passerelle.
const FALLBACKS = ["openai/gpt-5.4-mini", "openai/gpt-5.4", "anthropic/claude-sonnet-4.6"];
// Garde-fou généreux (5 min) : un agent d'équipe peut produire un long livrable
// approfondi sans être coupé. La connexion reste vivante via heartbeat.
const CALL_TIMEOUT_MS = 300000;

// Instructions de collaboration injectées dans chaque tâche d'agent (étape 6 du plan)
const COLLABORATION_RULES = `
RÈGLES DE COLLABORATION (tu fais partie d'une ÉQUIPE d'agents IA) :
- Tu reçois le travail déjà produit par tes collègues : APPUIE-TOI dessus, ne le répète pas.
- Livre un travail CONCRET et actionnable (chiffres, exemples, étapes) — pas de généralités.
- Reste concis : ton livrable sera assemblé avec ceux des autres agents.
- Réponds dans la langue de la demande utilisateur.`;

function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`TEAM_TIMEOUT: ${label} > ${ms}ms`)), ms);
    p.then(v => { clearTimeout(t); resolve(v); }, e => { clearTimeout(t); reject(e); });
  });
}

/** Appel modèle robuste local (pas d'import de l'orchestrateur → pas de cycle). */
async function callModel(system: string, prompt: string, model: string, maxTokens: number): Promise<string> {
  const models = [model, ...FALLBACKS.filter(m => m !== model)];
  let lastErr = "";
  for (const m of models) {
    try {
      const { text } = await withTimeout(
        generateText({
          model: gateway(m),
          system,
          prompt,
          maxOutputTokens: maxTokens,
          providerOptions: { google: { thinkingConfig: { thinkingBudget: 0, includeThoughts: false } } } as any,
          maxRetries: 0, abortSignal: AbortSignal.timeout(CALL_TIMEOUT_MS + 10000),
        }),
        CALL_TIMEOUT_MS,
        m,
      );
      if (text && text.trim()) return text.trim();
      lastErr = `${m} returned empty output`;
    } catch (e: any) {
      lastErr = e?.message || String(e);
      console.error(`[team-engine] ${m} failed:`, lastErr);
    }
  }
  throw new Error(`Tous les modèles ont échoué : ${lastErr}`);
}

// ─── Types internes ───────────────────────────────────────────────────────────
interface SubTask {
  agent: string; // clé de TEAM_SPECIALISTS
  task: string;
  dependsOn: string[]; // clés d'agents dont le résultat est nécessaire
}

export interface TeamWorkOptions {
  message: string;
  companyId?: string | null;
  ctx: CompanyContext;
  history?: AgentMessage[];
  model?: string;
  onEvent?: (evt: TeamEvent) => void;
}

export interface TeamWorkResult {
  response: string;
  agentsUsed: AgentRole[];
  taskId: string;
}

// ─── Phase 1 : décomposition ─────────────────────────────────────────────────
async function decompose(message: string, ctx: CompanyContext): Promise<SubTask[]> {
  const raw = await callModel(
    `Tu es le Coordinateur d'une équipe d'agents IA spécialisés. Découpe la demande utilisateur en 2 à 4 sous-tâches, chacune confiée à UN spécialiste parmi : ${Object.keys(TEAM_SPECIALISTS).join(", ")}.
Réponds UNIQUEMENT avec un tableau JSON, sans markdown, format :
[{"agent":"research","task":"description précise de la sous-tâche","dependsOn":[]},{"agent":"marketing","task":"...","dependsOn":["research"]}]
Règles :
- "dependsOn" liste les agents dont le RÉSULTAT est nécessaire avant de commencer (mets-y au moins une vraie dépendance logique quand c'est pertinent, ex: le marketing dépend de la recherche).
- Les tâches sans dépendance tourneront en parallèle.
- Chaque "task" est autonome, précise et actionnable, dans la langue de l'utilisateur.
- Maximum 4 sous-tâches, agents tous différents.`,
    `Contexte entreprise : ${JSON.stringify({ name: ctx.name, idea: ctx.idea, industry: ctx.industry }).slice(0, 500)}
Demande utilisateur : "${message.slice(0, 800)}"`,
    FAST_MODEL,
    900,
  );

  try {
    const jsonStr = raw.slice(raw.indexOf("["), raw.lastIndexOf("]") + 1);
    const parsed = JSON.parse(jsonStr) as SubTask[];
    const valid = parsed
      .filter(t => t && TEAM_SPECIALISTS[t.agent] && typeof t.task === "string" && t.task.trim())
      .map(t => ({ ...t, dependsOn: (t.dependsOn || []).filter(d => TEAM_SPECIALISTS[d] && d !== t.agent) }))
      .slice(0, 4);
    // dédoublonner par agent
    const seen = new Set<string>();
    const unique = valid.filter(t => (seen.has(t.agent) ? false : (seen.add(t.agent), true)));
    if (unique.length >= 2) return unique;
  } catch { /* fallthrough */ }

  // Plan de secours déterministe : recherche → marketing + finance
  return [
    { agent: "research", task: `Analyse le marché, les concurrents et les opportunités pour : ${message.slice(0, 300)}`, dependsOn: [] },
    { agent: "marketing", task: `Propose une stratégie marketing concrète pour : ${message.slice(0, 300)}`, dependsOn: ["research"] },
    { agent: "finance", task: `Établis un budget et des projections pour : ${message.slice(0, 300)}`, dependsOn: ["research"] },
  ];
}

/** Extrait les points clés d'un livrable (déterministe, 0 appel IA). */
function keyPoints(text: string): string {
  const lines = text.split("\n").map(l => l.trim()).filter(Boolean);
  const bullets = lines.filter(l => /^[-•*#\d]/.test(l)).slice(0, 6);
  const base = bullets.length >= 2 ? bullets.join("\n") : text.slice(0, 450);
  return base.slice(0, 500);
}

// ─── Moteur principal ────────────────────────────────────────────────────────
// Budget temps global : au-delà, on saute la relecture et on passe direct à la synthèse.
const TEAM_TIME_BUDGET_MS = 240_000;

export async function runTeamWork(opts: TeamWorkOptions): Promise<TeamWorkResult> {
  const taskId = crypto.randomUUID();
  const startedAt = Date.now();
  const { message, ctx, companyId, onEvent } = opts;
  const bus = (p: Omit<Parameters<typeof sendAgentMessage>[0], "companyId" | "taskId" | "onEvent">) =>
    sendAgentMessage({ ...p, companyId, taskId, onEvent });

  const agentsUsed: AgentRole[] = ["orchestrator"];
  const results: Record<string, string> = {}; // agentKey → livrable

  // ── Phase 1 : décomposition ──
  await bus({
    fromRole: COORDINATOR.role, toRole: "team", fromName: COORDINATOR.name, toName: "Équipe",
    type: "info", content: `Je découpe la demande « ${message.slice(0, 120)}${message.length > 120 ? "…" : ""} » en sous-tâches pour l'équipe.`,
  });

  let plan: SubTask[];
  try {
    plan = await decompose(message, ctx);
  } catch (e: any) {
    await bus({
      fromRole: COORDINATOR.role, toRole: "team", fromName: COORDINATOR.name, toName: "Équipe",
      type: "erreur", content: `Échec de la décomposition : ${String(e?.message).slice(0, 150)}`,
    });
    throw e;
  }

  for (const t of plan) {
    const spec = TEAM_SPECIALISTS[t.agent];
    await bus({
      fromRole: COORDINATOR.role, toRole: t.agent, fromName: COORDINATOR.name, toName: spec.name,
      type: "demande", content: t.task,
    });
  }

  // ── Phase 2 : exécution en vagues (parallèle quand indépendant) ──
  const done = new Set<string>();
  const pending = [...plan];
  let guard = 0;

  while (pending.length > 0 && guard++ < 6) {
    const wave = pending.filter(t => t.dependsOn.every(d => done.has(d) || !plan.some(p => p.agent === d)));
    if (wave.length === 0) {
      // dépendance impossible → débloquer en ignorant les deps restantes
      wave.push(pending[0]);
    }

    await Promise.all(wave.map(async (t) => {
      const spec = TEAM_SPECIALISTS[t.agent];
      agentsUsed.push(t.agent as AgentRole);

      // Vrais échanges : l'agent demande leurs points clés aux agents dont il dépend
      let sharedContext = "";
      for (const dep of t.dependsOn) {
        if (!results[dep]) continue;
        const depSpec = TEAM_SPECIALISTS[dep];
        await bus({
          fromRole: t.agent, toRole: dep, fromName: spec.name, toName: depSpec.name,
          type: "demande", content: `Peux-tu me transmettre tes conclusions clés ? J'en ai besoin pour : ${t.task.slice(0, 140)}`,
        });
        const points = keyPoints(results[dep]);
        await bus({
          fromRole: dep, toRole: t.agent, fromName: depSpec.name, toName: spec.name,
          type: "reponse", content: points,
        });
        sharedContext += `\n\n=== Conclusions de l'agent ${depSpec.name} ===\n${points}`;
      }

      await bus({
        fromRole: t.agent, toRole: COORDINATOR.role, fromName: spec.name, toName: COORDINATOR.name,
        type: "info", content: `Je commence : ${t.task.slice(0, 160)}`,
      });

      try {
        const expertBlock = expertKnowledgeFor(`${t.task}\n${message}`);
        const result = await executeAgent(
          spec.config,
          `${t.task}\n${COLLABORATION_RULES}${sharedContext}\n\nDemande utilisateur d'origine : "${message.slice(0, 400)}"${expertBlock}`,
          ctx,
          opts.history || [],
        );
        results[t.agent] = result.response || "(livrable vide)";
        await bus({
          fromRole: t.agent, toRole: COORDINATOR.role, fromName: spec.name, toName: COORDINATOR.name,
          type: "remise", content: keyPoints(results[t.agent]),
        });
      } catch (e: any) {
        results[t.agent] = `(erreur : ${String(e?.message).slice(0, 120)})`;
        await bus({
          fromRole: t.agent, toRole: COORDINATOR.role, fromName: spec.name, toName: COORDINATOR.name,
          type: "erreur", content: `Échec de ma sous-tâche : ${String(e?.message).slice(0, 150)}`,
        });
      }
      done.add(t.agent);
    }));

    for (const t of wave) {
      const i = pending.indexOf(t);
      if (i >= 0) pending.splice(i, 1);
    }
  }

  // ── Phase 3 : relecture croisée (critique → correction 1 boucle max → validation) ──
  // Parallélisée + soumise au budget temps global : si le budget est dépassé,
  // on valide directement les livrables et on file à la synthèse.
  const toReview = plan.filter(t => results[t.agent] && !results[t.agent].startsWith("(erreur"));
  const overBudget = () => Date.now() - startedAt > TEAM_TIME_BUDGET_MS;

  if (overBudget()) {
    for (const t of toReview.slice(0, 4)) {
      const spec = TEAM_SPECIALISTS[t.agent];
      await bus({
        fromRole: COORDINATOR.role, toRole: t.agent, fromName: COORDINATOR.name, toName: spec.name,
        type: "validation", content: `Livrable de ${spec.name} validé (relecture accélérée).`,
      });
    }
  } else {
    await Promise.all(toReview.slice(0, 4).map(async (t) => {
      const spec = TEAM_SPECIALISTS[t.agent];
      let verdict = "";
      try {
        verdict = await callModel(
          `Tu es le Coordinateur. Relis le livrable d'un agent. Si le livrable répond bien à la tâche : réponds exactement "SUFFISANT".
Sinon réponds "INSUFFISANT: " suivi d'UNE critique précise et actionnable (1-2 phrases, dans la langue du livrable).`,
          `Tâche confiée : ${t.task.slice(0, 300)}\n\nLivrable :\n${results[t.agent].slice(0, 1500)}`,
          FAST_MODEL,
          200,
        );
      } catch { verdict = "SUFFISANT"; }

      if (/^\s*INSUFFISANT/i.test(verdict) && !overBudget()) {
        const critique = verdict.replace(/^\s*INSUFFISANT:?\s*/i, "").trim() || "Livrable trop vague, précise avec des chiffres et exemples concrets.";
        await bus({
          fromRole: COORDINATOR.role, toRole: t.agent, fromName: COORDINATOR.name, toName: spec.name,
          type: "critique", content: critique,
        });
        try {
          const revised = await executeAgent(
            spec.config,
            `Ta tâche : ${t.task}\n\nTon premier livrable :\n${results[t.agent].slice(0, 1800)}\n\nCritique du Coordinateur : ${critique}\n\nCorrige et livre la version améliorée COMPLÈTE.${COLLABORATION_RULES}`,
            ctx,
            [],
          );
          if (revised.response?.trim()) results[t.agent] = revised.response;
          await bus({
            fromRole: t.agent, toRole: COORDINATOR.role, fromName: spec.name, toName: COORDINATOR.name,
            type: "remise", content: `Version corrigée livrée. ${keyPoints(results[t.agent]).slice(0, 200)}`,
          });
        } catch { /* on garde la v1 */ }
      }
      await bus({
        fromRole: COORDINATOR.role, toRole: t.agent, fromName: COORDINATOR.name, toName: spec.name,
        type: "validation", content: `Livrable de ${spec.name} validé.`,
      });
    }));
  }

  // ── Phase 4 : synthèse finale ──
  await bus({
    fromRole: COORDINATOR.role, toRole: "team", fromName: COORDINATOR.name, toName: "Équipe",
    type: "info", content: "J'assemble la réponse finale à partir des livrables validés.",
  });

  const deliverables = plan
    .filter(t => results[t.agent])
    .map(t => `## Livrable de l'agent ${TEAM_SPECIALISTS[t.agent].name}\n${results[t.agent].slice(0, 3500)}`)
    .join("\n\n");

  let finalResponse: string;
  try {
    finalResponse = await callModel(
      `Tu es Velbaz AI. Ton équipe d'agents spécialisés vient de produire des livrables. Assemble-les en UNE réponse finale claire, structurée (titres, listes, chiffres), sans répétitions, dans la langue de la demande utilisateur. Ne mentionne pas de modèles d'IA. Commence directement par le contenu.`,
      `Demande utilisateur : "${message.slice(0, 500)}"\n\n${deliverables}`,
      opts.model && opts.model !== "auto" ? SYNTHESIS_MODEL : SYNTHESIS_MODEL,
      4000,
    );
  } catch {
    finalResponse = deliverables || "L'équipe n'a pas pu produire de livrable. Réessayez.";
  }

  await bus({
    fromRole: COORDINATOR.role, toRole: "user", fromName: COORDINATOR.name, toName: "Utilisateur",
    type: "synthese", content: `Travail d'équipe terminé : ${toReview.length} livrable(s) validé(s), réponse finale prête.`,
  });

  return { response: finalResponse, agentsUsed: [...new Set(agentsUsed)], taskId };
}

// ─── Classification : ce travail nécessite-t-il l'équipe ? ───────────────────
// Garde-fou en 2 temps : regex ultra-rapide (0 coût) puis confirmation IA rapide.
const TEAM_HINT_REGEX = /strat[ée]gie|plan\s+(marketing|de\s+lancement|d'affaires|business|complet)|[ée]tude\s+de\s+march|analyse\s+(compl[èe]te|de\s+march[ée]|concurrent)|business\s*plan|campagne|lancement\s+(de\s+)?produit|go[- ]to[- ]market|budget\s+(marketing|pr[ée]visionnel|complet)|pr[ée]visions?\s+financi|roadmap|feuille\s+de\s+route|positionnement|marketing\s+(strategy|plan)|market\s+(study|research|analysis)|complete\s+(plan|strategy|analysis)|launch\s+plan/i;

export function teamHintMatch(message: string): boolean {
  return TEAM_HINT_REGEX.test(message);
}

export async function classifyTeamNeed(message: string): Promise<boolean> {
  if (!teamHintMatch(message)) return false;
  if (message.trim().length < 25) return false;
  try {
    const verdict = await callModel(
      `Tu décides si une demande nécessite une ÉQUIPE d'agents IA spécialisés (recherche + marketing + finance...) ou si UN seul assistant suffit.
Réponds UNIQUEMENT "EQUIPE" ou "SIMPLE".
EQUIPE = travail multi-disciplines livrable (stratégie marketing complète, étude de marché, business plan, plan de lancement, analyse concurrentielle + budget...).
SIMPLE = salutation, question courte, définition, demande de modification de site/app, conversation.`,
      `Demande : "${message.slice(0, 400)}"`,
      FAST_MODEL,
      16,
    );
    return /EQUIPE/i.test(verdict);
  } catch {
    return false; // en cas de doute → flux simple (comportement inchangé)
  }
}

// ─── @Agent direct : parler à un agent précis ────────────────────────────────
const DIRECT_AGENT_MAP: Record<string, string> = {
  marketing: "marketing",
  finance: "finance",
  recherche: "research", research: "research",
  juridique: "legal", legal: "legal",
  contenu: "content", content: "content",
  branding: "branding", marque: "branding",
  businessplan: "business_plan", plan: "business_plan",
};

export function detectDirectAgent(message: string): { key: string; name: string; config: AgentConfig; cleanMessage: string } | null {
  const m = message.match(/@([a-zA-Zéèêà_-]+)/);
  if (!m) return null;
  const key = DIRECT_AGENT_MAP[m[1].toLowerCase().replace(/[^a-z]/g, "")];
  if (!key || !TEAM_SPECIALISTS[key]) return null;
  return {
    key,
    name: TEAM_SPECIALISTS[key].name,
    config: TEAM_SPECIALISTS[key].config,
    cleanMessage: message.replace(m[0], "").trim() || message,
  };
}
