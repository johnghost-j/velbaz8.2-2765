/**
 * MONEY MAKER ENGINE — la couche "boss" autonome au-dessus de Velbaz.
 *
 * Le boss réfléchit seul, cherche ce qui est en trending, crée lui-même des
 * entreprises (origin="money_maker", ISOLÉES des projets perso), démarre leur
 * Velbaz complet (agents + autopilot + calendrier) entraîné "profit-first",
 * respecte une limite de 5 slots build/edit simultanés, évalue le portefeuille
 * et décide keep / improve / kill.
 *
 * Réutilise l'infra existante : callAI + AI gateway (injectés depuis index.ts),
 * webSearchResults (web-tools), AGENT_SWARM + soul/agents/heartbeat docs
 * (agents/swarm), et l'autopilot par entreprise (enableAutopilot).
 *
 * Aucun nouveau moteur : chaque entreprise tourne sur l'autopilot existant.
 */

import { db } from './database/index';
import { eq, and, desc, sql, count, inArray } from 'drizzle-orm';
import * as schema from './database/schema';
import { v4 as uuidv4 } from 'uuid';
import { webSearchResults } from './web-tools';
import { AGENT_SWARM, generateSoulMd, generateAgentsMd, generateHeartbeatMd } from './agents/swarm';
import { enableAutopilot } from './autopilot';
import { sendEmailAuto, emailProvider } from './email-provider';

// ─── Dépendances injectées depuis index.ts (même pattern que initAutopilot) ──
// ⚠️ En dev, Vite (ssrLoadModule) peut charger DEUX instances de ce module :
// celle qui reçoit initMoneyMaker() au boot, et celle qui exécute les routes.
// Si on stockait les deps dans des `let` locaux au module, l'instance des routes
// aurait `_pickModel === undefined` → "is not a function". On stocke donc les
// deps sur globalThis (partagé entre toutes les instances) et on y accède via
// des accesseurs. Robuste en dev comme en prod.
type MMDeps = {
  callAI: (model: string, systemPrompt: string, userMessage: string, maxTokens?: number) => Promise<string>;
  pickModel: (task?: string) => string;
  deductTokens: (userId: string, action: string, customCost?: number) => Promise<{ ok: boolean; balance: number; error?: string }>;
  startBuild: (company: any, styleReference?: string) => string;
};

function _mmDeps(): MMDeps {
  const d = (globalThis as any).__velbaz_mm_deps as MMDeps | undefined;
  if (!d) throw new Error('MoneyMaker engine not initialized (initMoneyMaker not called)');
  return d;
}

const _callAI: MMDeps['callAI'] = (...args) => _mmDeps().callAI(...args);
const _pickModel: MMDeps['pickModel'] = (...args) => _mmDeps().pickModel(...args);
const _deductTokens: MMDeps['deductTokens'] = (...args) => _mmDeps().deductTokens(...args);
const _startBuild: MMDeps['startBuild'] = (...args) => _mmDeps().startBuild(...args);

export function initMoneyMaker(deps: MMDeps) {
  (globalThis as any).__velbaz_mm_deps = deps;
  console.log('[MoneyMaker] Engine initialized');
}

// ─── Prompts "entraînés pour faire de l'argent" ──────────────────────────────

const BOSS_SYSTEM = `You are the MONEY MAKER BOSS — an autonomous venture builder that runs a portfolio of real internet businesses to generate REAL revenue.

Your only goal: maximize real money (real Stripe revenue, real paying customers). Not vanity, not demos.

How you think:
- Hunt for trending, underserved niches with clear willingness-to-pay. Prefer simple SaaS / digital products / micro-tools that a small web or mobile app can monetize FAST.
- Validate product-market fit quickly and cheaply. Ship a real, payable product (Stripe wired) on day one.
- Double down on winners (growing MRR). Cut losers fast (no revenue after the kill threshold).
- Every business must have a concrete, believable revenue model: pricing, target customer, acquisition channel.

You are ruthless, concrete and numbers-driven. No fluff.`;

const STRATEGIST_PROFIT_MISSION = `PROFIT-FIRST MANDATE (Money Maker company):
Your #1 job is to generate REAL revenue as fast as possible. Every task must move MRR up.
- Prioritize: get the product payable (Stripe), get first paying customers, then scale acquisition.
- Kill anything that doesn't drive revenue. Double down on what converts.
- Track MRR/ARR weekly. If flat at 0, change the offer, pricing, or channel — don't just "post more".`;

// ─── Helpers config / journal ────────────────────────────────────────────────

export async function getConfig(userId: string) {
  let cfg = await db.select().from(schema.moneyMakerConfig)
    .where(eq(schema.moneyMakerConfig.userId, userId)).get();
  if (!cfg) {
    const row = {
      id: uuidv4(),
      userId,
      enabled: false,
      autoSpawn: true,
      maxConcurrent: 5,
      killAfterDays: 14,
      strategyNote: null as string | null,
    };
    await db.insert(schema.moneyMakerConfig).values(row);
    cfg = await db.select().from(schema.moneyMakerConfig)
      .where(eq(schema.moneyMakerConfig.userId, userId)).get();
  }
  return cfg!;
}

export async function updateConfig(userId: string, patch: Partial<{
  enabled: boolean; autoSpawn: boolean; maxConcurrent: number; killAfterDays: number; strategyNote: string;
  emailAutoSend: boolean; emailFromName: string | null;
}>) {
  await getConfig(userId); // ensure exists
  await db.update(schema.moneyMakerConfig)
    .set({ ...patch, updatedAt: new Date() })
    .where(eq(schema.moneyMakerConfig.userId, userId));
  return getConfig(userId);
}

export async function logRun(userId: string, run: {
  type: 'spawn' | 'improve' | 'kill' | 'research' | 'decision' | 'chat';
  companyId?: string | null;
  title: string;
  detail?: string;
  meta?: any;
  status?: 'running' | 'done' | 'failed';
}): Promise<string> {
  const id = uuidv4();
  await db.insert(schema.moneyMakerRuns).values({
    id,
    userId,
    type: run.type,
    companyId: run.companyId || null,
    title: run.title,
    detail: run.detail || null,
    meta: run.meta ? JSON.stringify(run.meta) : null,
    status: run.status || 'done',
  });
  return id;
}

// ─── Concurrency gate (max 5 slots build/edit actifs) ────────────────────────

export async function activeSlots(userId: string): Promise<number> {
  const r = await db.select({ n: count() }).from(schema.moneyMakerQueue)
    .where(and(eq(schema.moneyMakerQueue.userId, userId), eq(schema.moneyMakerQueue.status, 'active'))).get();
  return r?.n || 0;
}

export async function hasFreeSlot(userId: string): Promise<boolean> {
  const cfg = await getConfig(userId);
  return (await activeSlots(userId)) < cfg.maxConcurrent;
}

/** Marque un item de queue done/failed et démarre le suivant si un slot se libère. */
export async function releaseSlot(userId: string, queueId: string, status: 'done' | 'failed') {
  await db.update(schema.moneyMakerQueue).set({ status })
    .where(eq(schema.moneyMakerQueue.id, queueId));
  await drainQueue(userId);
}

/** Prend les items 'queued' tant qu'il reste des slots libres et les active. */
export async function drainQueue(userId: string) {
  let free = (await getConfig(userId)).maxConcurrent - (await activeSlots(userId));
  if (free <= 0) return;
  const queued = await db.select().from(schema.moneyMakerQueue)
    .where(and(eq(schema.moneyMakerQueue.userId, userId), eq(schema.moneyMakerQueue.status, 'queued')))
    .orderBy(schema.moneyMakerQueue.createdAt).limit(free).all();
  for (const item of queued) {
    await activateQueueItem(userId, item);
    free--;
    if (free <= 0) break;
  }
}

async function activateQueueItem(userId: string, item: typeof schema.moneyMakerQueue.$inferSelect) {
  await db.update(schema.moneyMakerQueue)
    .set({ status: 'active', slotStartedAt: new Date() })
    .where(eq(schema.moneyMakerQueue.id, item.id));
  try {
    if (item.kind === 'build') {
      const payload = item.payload ? JSON.parse(item.payload) : {};
      const companyId = item.companyId || await createBusiness(userId, payload);
      if (!item.companyId) {
        await db.update(schema.moneyMakerQueue).set({ companyId }).where(eq(schema.moneyMakerQueue.id, item.id));
      }
      const company = await db.select().from(schema.companies).where(eq(schema.companies.id, companyId)).get();
      if (company) _startBuild(company);
      // Le build tourne en tâche de fond ; on libère le slot après un délai raisonnable
      // (le build a démarré ; l'autopilot prend le relais). On considère le slot pris
      // pendant le build, libéré quand le statut passe 'active' avec output — géré par le tick.
      await logRun(userId, { type: 'spawn', companyId, title: `Build lancé : ${payload.name || 'entreprise'}`, detail: payload.idea, meta: payload });
    }
  } catch (e: any) {
    console.error('[MoneyMaker] activateQueueItem failed', e);
    await db.update(schema.moneyMakerQueue).set({ status: 'failed' }).where(eq(schema.moneyMakerQueue.id, item.id));
    await logRun(userId, { type: 'decision', title: 'Échec build', detail: String(e?.message || e), status: 'failed' });
  }
}

// ─── Recherche de tendances → idées d'entreprises chiffrées ──────────────────

export interface BusinessIdea {
  name: string;
  idea: string;          // pitch complet (marché, angle, cible)
  industry: string;
  projectType: 'web' | 'mobile';
  revenueModel: string;  // pricing + comment ça gagne
  niche: string;
  why: string;           // pourquoi c'est en trending / opportunité
}

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
    promise.then(v => { clearTimeout(t); resolve(v); }, e => { clearTimeout(t); reject(e); });
  });
}

function fallbackIdeas(n: number): BusinessIdea[] {
  const pool: BusinessIdea[] = [
    {
      name: 'InvoiceZen',
      idea: 'A lightweight invoice follow-up tool for freelancers and tiny agencies. It tracks unpaid invoices, sends polite reminder sequences, and gives clients a one-click Stripe payment link.',
      industry: 'SaaS', projectType: 'web',
      revenueModel: '$12/mo per freelancer, $29/mo for small teams, charged through Stripe subscriptions.',
      niche: 'Freelancer invoice collection',
      why: 'Cash-flow pain is constant, urgent, and directly tied to willingness-to-pay.',
    },
    {
      name: 'ReviewLift',
      idea: 'A local-business review request system for dentists, salons, and restaurants. It automates SMS/email review asks after appointments and filters unhappy customers into private feedback.',
      industry: 'Marketing', projectType: 'web',
      revenueModel: '$39/mo per location, Stripe subscription, with setup upsell.',
      niche: 'Local business reputation management',
      why: 'Local businesses know reviews drive revenue and pay for simple tools that increase ratings.',
    },
    {
      name: 'CreatorBriefs',
      idea: 'A brief generator and campaign tracker for small brands hiring micro-influencers. It creates contracts, deliverable checklists, UTM links, and performance summaries.',
      industry: 'Creator', projectType: 'web',
      revenueModel: '$19/mo for creators/brands, $49/mo for agencies via Stripe.',
      niche: 'Micro-influencer campaign operations',
      why: 'Micro-influencer spend keeps growing, but execution is still spreadsheet-heavy.',
    },
  ];
  return pool.slice(0, Math.max(1, n));
}

export async function researchTrends(userId: string, n = 1, strategyNote?: string): Promise<BusinessIdea[]> {
  const runId = await logRun(userId, { type: 'research', title: 'Recherche de tendances…', status: 'running' });
  // 1) Signaux de trending via recherche web (best-effort)
  let signals = '';
  try {
    const queries = ['trending SaaS niches 2026', 'profitable micro saas ideas', 'trending digital products to sell'];
    const q = queries[Math.floor(Math.random() * queries.length)];
    const results = await withTimeout(webSearchResults(q, 6), 15000, 'trend web search');
    signals = results.map(r => `- ${r.title}: ${r.snippet}`).join('\n').slice(0, 2500);
  } catch { /* no web = on laisse l'IA proposer */ }

  const model = _pickModel('reasoning');
  const sys = `${BOSS_SYSTEM}\n\nOutput STRICT JSON: an array of ${n} business idea objects. No prose.`;
  const user = `Trending signals (may be noisy):\n${signals || '(none available — use your own market knowledge)'}\n\n${strategyNote ? `Owner strategy note: ${strategyNote}\n\n` : ''}Propose ${n} concrete, monetizable business idea(s) I can build as a small web or mobile app and charge for with Stripe FAST.

Each object: {"name": "short brand", "idea": "2-3 sentence pitch: market, target customer, the actual product", "industry": "one word", "projectType": "web" | "mobile", "revenueModel": "pricing + how it makes money", "niche": "the specific niche", "why": "why it's trending / the opportunity"}

Return ONLY the JSON array.`;

  let ideas: BusinessIdea[] = [];
  try {
    const raw = await withTimeout(_callAI(model, sys, user, 1800), 60000, 'trend AI research');
    ideas = parseIdeas(raw);
  } catch (e) {
    console.error('[MoneyMaker] researchTrends AI failed', e);
  }
  ideas = ideas.slice(0, n);
  if (!ideas.length) {
    ideas = fallbackIdeas(n);
    await db.update(schema.moneyMakerRuns)
      .set({ status: 'done', detail: `Fallback utilisé (recherche IA indisponible).\n${ideas.map(i => `• ${i.name} — ${i.niche} (${i.projectType}) : ${i.revenueModel}`).join('\n')}`, meta: JSON.stringify(ideas) })
      .where(eq(schema.moneyMakerRuns.id, runId));
    return ideas;
  }
  await db.update(schema.moneyMakerRuns)
    .set({ status: 'done', detail: ideas.map(i => `• ${i.name} — ${i.niche} (${i.projectType}) : ${i.revenueModel}`).join('\n'), meta: JSON.stringify(ideas) })
    .where(eq(schema.moneyMakerRuns.id, runId));
  return ideas;
}

function parseIdeas(raw: string): BusinessIdea[] {
  let text = raw.trim();
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fence) text = fence[1].trim();
  const start = text.indexOf('[');
  const end = text.lastIndexOf(']');
  if (start !== -1 && end !== -1) text = text.slice(start, end + 1);
  try {
    const arr = JSON.parse(text);
    if (Array.isArray(arr)) {
      return arr.filter(x => x && x.name && x.idea).map((x: any) => ({
        name: String(x.name).slice(0, 40),
        idea: String(x.idea).slice(0, 600),
        industry: String(x.industry || 'Technology').slice(0, 30),
        projectType: x.projectType === 'mobile' ? 'mobile' : 'web',
        revenueModel: String(x.revenueModel || '').slice(0, 300),
        niche: String(x.niche || '').slice(0, 80),
        why: String(x.why || '').slice(0, 300),
      }));
    }
  } catch { /* fallthrough */ }
  return [];
}

// ─── Création d'une entreprise Money Maker (company + agents + autopilot) ─────

/** Crée la company (origin=money_maker) + soul/mission + agents + autopilot profit-first. Retourne companyId. */
export async function createBusiness(userId: string, idea: BusinessIdea): Promise<string> {
  const companyId = uuidv4();
  const info = { name: idea.name, idea: idea.idea, industry: idea.industry };
  const soulMd = generateSoulMd(info);
  const agentsMd = generateAgentsMd(info);
  const heartbeatMd = generateHeartbeatMd(info);
  const missionMd = `${STRATEGIST_PROFIT_MISSION}\n\n## ${idea.name}\n\n**Niche:** ${idea.niche}\n**Revenue model:** ${idea.revenueModel}\n**Why now:** ${idea.why}\n\n**Mission:** Reach real paying customers and grow MRR. Ship a payable product (Stripe) immediately, validate PMF fast, double down on what converts.`;

  await db.insert(schema.companies).values({
    id: companyId,
    userId,
    name: idea.name,
    idea: idea.idea,
    status: 'building',
    industry: idea.industry,
    projectType: idea.projectType,
    origin: 'money_maker',
    soulMd, agentsMd, heartbeatMd, missionMd,
    autoHeartbeat: 1,
  });

  // Spawn agents (même swarm que Velbaz)
  for (const def of AGENT_SWARM) {
    const agentId = uuidv4();
    const prompt = def.systemPrompt({ name: idea.name, idea: idea.idea, industry: idea.industry, soulMd });
    await db.insert(schema.agents).values({
      id: agentId, companyId, role: def.role, name: def.name, model: def.model,
      systemPrompt: prompt, status: 'active', dailyBudget: def.dailyBudget,
    });
    await db.insert(schema.agentSkills).values({
      id: uuidv4(), companyId, agentId, agentRole: def.role,
      skillMd: def.initialSkillMd({ name: idea.name }), version: 1,
    }).catch(() => {});
    await db.insert(schema.agentActivity).values({
      id: uuidv4(), companyId, agentId, agentRole: def.role,
      action: 'spawned', message: `${def.name} is now active and ready to work`,
    }).catch(() => {});
  }

  // Autopilot ON (profit-first) — la boucle autonome de l'entreprise
  await enableAutopilot(companyId).catch((e) => console.error('[MoneyMaker] enableAutopilot', e));
  return companyId;
}

/** Met une idée en file d'attente de build (respecte les 5 slots). */
export async function enqueueBuild(userId: string, idea: BusinessIdea): Promise<{ queued: boolean; queueId: string }> {
  const id = uuidv4();
  await db.insert(schema.moneyMakerQueue).values({
    id, userId, kind: 'build', payload: JSON.stringify(idea), status: 'queued',
  });
  await drainQueue(userId);
  const item = await db.select().from(schema.moneyMakerQueue).where(eq(schema.moneyMakerQueue.id, id)).get();
  return { queued: item?.status === 'queued', queueId: id };
}

/** Recherche + spawn immédiat (forcé depuis le chat/bouton). */
export async function spawnNow(userId: string, strategyNote?: string): Promise<{ ideas: BusinessIdea[]; spawned: string[] }> {
  const cfg = await getConfig(userId);
  const free = cfg.maxConcurrent - (await activeSlots(userId));
  const want = Math.max(1, Math.min(free > 0 ? free : 1, 1));
  const ideas = await researchTrends(userId, want, strategyNote ?? cfg.strategyNote ?? undefined);
  const spawned: string[] = [];
  for (const idea of ideas) {
    const { queueId } = await enqueueBuild(userId, idea);
    spawned.push(queueId);
  }
  return { ideas, spawned };
}

// ─── Évaluation du portefeuille (keep / improve / kill) ──────────────────────

export async function evaluatePortfolio(userId: string): Promise<void> {
  const cfg = await getConfig(userId);
  const companies = await db.select().from(schema.companies)
    .where(and(eq(schema.companies.userId, userId), eq(schema.companies.origin, 'money_maker'))).all();
  const now = Date.now();
  const killMs = cfg.killAfterDays * 24 * 60 * 60 * 1000;

  for (const co of companies) {
    if (co.status === 'killed') continue;
    const created = co.createdAt ? new Date(co.createdAt as any).getTime() : now;
    const ageMs = now - created;
    const mrr = co.mrr || 0;
    const revenue = co.totalRevenue || 0;

    if (mrr > 0 || revenue > 0) {
      // Gagnant : on double la mise (tâche d'amélioration ciblée croissance)
      await logRun(userId, { type: 'decision', companyId: co.id, title: `Keep & scale : ${co.name}`, detail: `MRR ${mrr}€ — on double la mise sur la croissance.` });
      continue;
    }

    if (ageMs >= killMs) {
      // 0€ après le seuil → kill (soft, réversible)
      await db.update(schema.companies).set({ status: 'killed', updatedAt: new Date() }).where(eq(schema.companies.id, co.id));
      await logRun(userId, { type: 'kill', companyId: co.id, title: `Kill : ${co.name}`, detail: `0€ après ${cfg.killAfterDays} jours. Statut 'killed' (réversible).` });
    } else if (ageMs >= killMs / 2) {
      // Mi-parcours sans revenu → improve (pivot offre/pricing/canal)
      await logRun(userId, { type: 'improve', companyId: co.id, title: `Improve : ${co.name}`, detail: `Pas encore de revenu — pivot offre/pricing/canal d'acquisition.` });
    }
  }
}

// ─── Boucle maître (bossTick) + scheduler global ─────────────────────────────

/** Le mode auto est-il toujours actif ? (re-check live entre les étapes) */
async function _isEnabled(userId: string): Promise<boolean> {
  const c = await db.select({ enabled: schema.moneyMakerConfig.enabled })
    .from(schema.moneyMakerConfig).where(eq(schema.moneyMakerConfig.userId, userId)).get();
  return !!c?.enabled;
}

export async function bossTick(userId: string): Promise<void> {
  const cfg = await getConfig(userId);
  if (!cfg.enabled) return;
  await db.update(schema.moneyMakerConfig).set({ lastTickAt: new Date() }).where(eq(schema.moneyMakerConfig.userId, userId));

  // 1) Spawn si le boss est en autoSpawn et qu'il reste des slots
  try {
    if (cfg.autoSpawn && (await hasFreeSlot(userId))) {
      const ideas = await researchTrends(userId, 1, cfg.strategyNote ?? undefined);
      if (!(await _isEnabled(userId))) return;   // désactivé pendant la recherche → stop net
      for (const idea of ideas) {
        if (!(await _isEnabled(userId))) return;
        await enqueueBuild(userId, idea);
      }
    }
  } catch (e) { console.error('[MoneyMaker] tick spawn', e); }

  if (!(await _isEnabled(userId))) return;
  // 2) Draine la file (au cas où des slots se sont libérés)
  try { await drainQueue(userId); } catch (e) { console.error('[MoneyMaker] tick drain', e); }

  if (!(await _isEnabled(userId))) return;
  // 3) Évalue le portefeuille
  try { await evaluatePortfolio(userId); } catch (e) { console.error('[MoneyMaker] tick eval', e); }
}

/**
 * ARRÊT COMPLET du mode auto : ne se contente pas de couper les prochains ticks,
 * il stoppe réellement toute l'activité autonome en cours pour cet owner :
 *  - désactive l'autopilot de CHAQUE entreprise money_maker active/building,
 *  - annule les items de file en attente (queued) pour ne rien relancer,
 *  - relâche les slots des builds en cours (queue active → cancelled).
 * Les entreprises passent en 'paused' (réversible via Reprendre), jamais supprimées.
 */
export async function haltMoneyMaker(userId: string): Promise<void> {
  const { disableAutopilot } = await import('./autopilot');

  // 1) Stoppe l'autopilot + met en pause toutes les entreprises encore actives.
  const cos = await db.select().from(schema.companies)
    .where(and(eq(schema.companies.userId, userId), eq(schema.companies.origin, 'money_maker'))).all();
  for (const co of cos) {
    if (co.status === 'active' || co.status === 'building') {
      await disableAutopilot(co.id).catch(() => {});
      await db.update(schema.companies).set({ status: 'paused', updatedAt: new Date() })
        .where(eq(schema.companies.id, co.id));
    }
  }

  // 2) Annule tout ce qui est en file (rien ne doit se relancer).
  await db.update(schema.moneyMakerQueue).set({ status: 'cancelled' })
    .where(and(
      eq(schema.moneyMakerQueue.userId, userId),
      inArray(schema.moneyMakerQueue.status, ['queued', 'active']),
    ));

  await logRun(userId, { type: 'decision', title: 'Mode auto désactivé — activité stoppée', detail: `${cos.length} entreprise(s) mises en pause, file vidée.` });
}

/** Libère les slots des builds terminés (company sortie de 'building'). */
export async function reconcileSlots(userId: string): Promise<void> {
  const active = await db.select().from(schema.moneyMakerQueue)
    .where(and(eq(schema.moneyMakerQueue.userId, userId), eq(schema.moneyMakerQueue.status, 'active'))).all();
  for (const item of active) {
    if (!item.companyId) continue;
    const co = await db.select().from(schema.companies).where(eq(schema.companies.id, item.companyId)).get();
    if (co && co.status !== 'building') {
      await db.update(schema.moneyMakerQueue).set({ status: 'done' }).where(eq(schema.moneyMakerQueue.id, item.id));
    }
  }
  await drainQueue(userId);
}

let _schedulerHandle: any = null;
export function startMoneyMakerScheduler() {
  if (_schedulerHandle) return;
  const INTERVAL = 5 * 60 * 1000; // 5 min
  _schedulerHandle = setInterval(async () => {
    try {
      const configs = await db.select().from(schema.moneyMakerConfig)
        .where(eq(schema.moneyMakerConfig.enabled, true)).all();
      for (const cfg of configs) {
        await reconcileSlots(cfg.userId).catch(() => {});
        await bossTick(cfg.userId).catch(() => {});
      }
    } catch (e) { console.error('[MoneyMaker] scheduler', e); }
  }, INTERVAL);
  console.log('[MoneyMaker] Scheduler started (5 min)');
}

export function stopMoneyMakerScheduler() {
  if (_schedulerHandle) { clearInterval(_schedulerHandle); _schedulerHandle = null; }
}

// ─── État global pour l'UI (portfolio + queue + slots) ───────────────────────

export async function getState(userId: string) {
  const cfg = await getConfig(userId);
  const companies = await db.select().from(schema.companies)
    .where(and(eq(schema.companies.userId, userId), eq(schema.companies.origin, 'money_maker')))
    .orderBy(desc(schema.companies.createdAt)).all();
  const queue = await db.select().from(schema.moneyMakerQueue)
    .where(and(eq(schema.moneyMakerQueue.userId, userId), inArray(schema.moneyMakerQueue.status, ['queued', 'active'])))
    .orderBy(schema.moneyMakerQueue.createdAt).all();
  const slotsUsed = await activeSlots(userId);
  const totalRevenue = companies.reduce((s, c) => s + (c.totalRevenue || 0), 0);
  const totalMrr = companies.reduce((s, c) => s + (c.mrr || 0), 0);
  return {
    config: cfg,
    companies,
    queue,
    slotsUsed,
    maxSlots: cfg.maxConcurrent,
    totals: { totalRevenue, totalMrr, active: companies.filter(c => c.status !== 'killed').length },
  };
}

/** Feed central : décisions du boss + activité inter-agents des entreprises MM. */
export async function getFeed(userId: string, sinceMs?: number) {
  const runs = await db.select().from(schema.moneyMakerRuns)
    .where(eq(schema.moneyMakerRuns.userId, userId))
    .orderBy(desc(schema.moneyMakerRuns.createdAt)).limit(60).all();
  // Activité inter-agents des entreprises money_maker
  const mmCompanies = await db.select({ id: schema.companies.id, name: schema.companies.name }).from(schema.companies)
    .where(and(eq(schema.companies.userId, userId), eq(schema.companies.origin, 'money_maker'))).all();
  const nameById = new Map(mmCompanies.map(c => [c.id, c.name]));
  let agentActs: any[] = [];
  if (mmCompanies.length > 0) {
    agentActs = await db.select().from(schema.agentActivity)
      .where(inArray(schema.agentActivity.companyId, mmCompanies.map(c => c.id)))
      .orderBy(desc(schema.agentActivity.createdAt)).limit(60).all();
  }
  const items = [
    ...runs.map(r => ({
      kind: 'run' as const, id: r.id, type: r.type, companyId: r.companyId,
      company: r.companyId ? nameById.get(r.companyId) || null : null,
      title: r.title, detail: r.detail, at: r.createdAt,
    })),
    ...agentActs.map(a => ({
      kind: 'agent' as const, id: a.id, type: a.action, companyId: a.companyId,
      company: nameById.get(a.companyId) || null, agentRole: a.agentRole,
      title: a.message, detail: null, at: a.createdAt,
    })),
  ].sort((x, y) => new Date(y.at as any).getTime() - new Date(x.at as any).getTime());
  const filtered = sinceMs ? items.filter(i => new Date(i.at as any).getTime() > sinceMs) : items;
  return filtered.slice(0, 80);
}

export async function getCompanyDetail(userId: string, companyId: string) {
  const company = await db.select().from(schema.companies)
    .where(and(eq(schema.companies.id, companyId), eq(schema.companies.userId, userId))).get();
  if (!company) return null;
  const agents = await db.select().from(schema.agents).where(eq(schema.agents.companyId, companyId)).all();
  const tasks = await db.select().from(schema.autopilotTasks)
    .where(eq(schema.autopilotTasks.companyId, companyId))
    .orderBy(desc(schema.autopilotTasks.createdAt)).limit(20).all();
  return { company, agents, tasks };
}

// ─── Chat boss : comprend l'intention, route vers la bonne entreprise ────────

export interface GoalEvaluation {
  feasible: boolean;
  needsAccept: boolean;                                   // true quand une proposition ajustée attend l'Accept de l'owner
  targetMrr: number;                                      // objectif MRR mensuel demandé (€)
  deadline: string | null;                                // ISO YYYY-MM-DD
  assessment: string;                                     // raisonnement de faisabilité (langue de l'owner)
  proposal: { targetMrr: number; deadline: string | null; note: string } | null; // version réaliste ajustée
}

export interface BossChatReply {
  reply: string;
  action?: string;          // spawn | improve | kill | pause | resume | boost | question | goal | email | none
  companyId?: string | null;
  question?: { text: string; options?: string[] } | null;
  spawned?: string[];
  goal?: GoalEvaluation | null;
  emails?: EmailDraft[];    // brouillons/emails créés par ce tour de chat
}

export interface EmailDraft {
  id: string;
  companyId: string | null;
  type: string;             // prospection | collab | promo | support | relance | presse | autre
  subject: string;
  body: string;             // HTML
  recipientEmail: string;
  recipientName: string | null;
  status: string;           // draft | sent | not_sent | discarded
  fromName: string | null;
  brandColor: string | null; // couleur principale de la marque (pour la carte)
  preheader: string | null;
  cta: { label: string; url: string } | null;
  createdAt: number | null;
}

function fallbackGoal(message: string): GoalEvaluation {
  const money = message.match(/([0-9][0-9\s.,]*)\s*(?:€|eur|euros?|\$|usd|k\b)/i);
  let target = money ? Number(money[1].replace(/\s/g, '').replace(',', '.')) : 5000;
  if (/\bk\b/i.test(money?.[0] || '')) target *= 1000;
  target = Math.max(500, Math.round(target));
  const now = new Date();
  const deadline = new Date(now.getFullYear(), now.getMonth() + 6, now.getDate());
  const months = Math.max(1, Math.round((deadline.getTime() - now.getTime()) / (30 * 24 * 60 * 60 * 1000)));
  const feasible = target <= months * 1500;
  const realistic = Math.max(1500, months * 1200);
  return {
    feasible,
    needsAccept: !feasible,
    targetMrr: target,
    deadline: deadline.toISOString().slice(0, 10),
    assessment: feasible
      ? `Objectif faisable : ${target}€/mois en environ ${months} mois. Je vais orienter Money Maker vers des offres SaaS simples, Stripe-ready, avec acquisition directe et maximum 5 builds actifs.`
      : `Objectif trop agressif pour une exécution réaliste en ${months} mois. Je propose plutôt ${realistic}€/mois sur la même période, puis montée progressive après validation des premières ventes.`,
    proposal: feasible ? null : { targetMrr: realistic, deadline: deadline.toISOString().slice(0, 10), note: 'Version réaliste proposée par défaut faute de cible temporelle exploitable.' },
  };
}

export async function evaluateGoal(userId: string, message: string): Promise<GoalEvaluation> {
  const state = await getState(userId);
  const model = _pickModel('reasoning');
  const now = new Date().toISOString().slice(0, 10);
  const prompt = `Owner request: ${message}
Today: ${now}
Current Money Maker portfolio:
- companies: ${state.companies.length}
- active build/edit slots: ${state.slotsUsed}/${state.maxSlots}
- current total MRR: ${state.totals.totalMrr}€

Evaluate whether the owner's revenue target is realistic for this autonomous venture-builder.
Return STRICT JSON only:
{
  "feasible": boolean,
  "targetMrr": number,
  "deadline": "YYYY-MM-DD or null",
  "assessment": "short answer in the owner's language, concrete and direct",
  "proposal": {"targetMrr": number, "deadline": "YYYY-MM-DD or null", "note": "short realistic alternative"} | null
}
Rules:
- targetMrr is monthly recurring revenue in EUR if a monthly goal is implied. If the owner gives one-time revenue, convert to a practical monthly target and explain.
- Be ambitious but real: cold start internet SaaS/apps are uncertain. If target or timing is unrealistic, feasible=false and proposal must contain a realistic adjusted target/deadline.
- If feasible=true, proposal=null and assessment says you can prepare the system now.
- Mention that public deploy/domain finalization happens through Runable publish UI, while apps are built Stripe-ready.`;

  let g: GoalEvaluation;
  try {
    const raw = await withTimeout(_callAI(model, BOSS_SYSTEM, prompt, 900), 45000, 'evaluateGoal callAI');
    let t = raw.trim();
    const fence = t.match(/```(?:json)?\s*([\s\S]*?)```/); if (fence) t = fence[1].trim();
    const s = t.indexOf('{'), e = t.lastIndexOf('}');
    if (s !== -1 && e !== -1) t = t.slice(s, e + 1);
    const parsed = JSON.parse(t);
    g = {
      feasible: !!parsed.feasible,
      needsAccept: !parsed.feasible,
      targetMrr: Math.max(0, Math.round(Number(parsed.targetMrr) || 0)),
      deadline: parsed.deadline || null,
      assessment: String(parsed.assessment || '').slice(0, 1800),
      proposal: parsed.proposal ? {
        targetMrr: Math.max(0, Math.round(Number(parsed.proposal.targetMrr) || 0)),
        deadline: parsed.proposal.deadline || null,
        note: String(parsed.proposal.note || '').slice(0, 800),
      } : null,
    };
    if (!g.assessment) g = fallbackGoal(message);
  } catch {
    g = fallbackGoal(message);
  }

  const acceptedTarget = g.feasible ? g.targetMrr : null;
  const acceptedDeadline = g.feasible && g.deadline ? new Date(g.deadline) : null;
  await updateConfig(userId, {
    strategyNote: g.feasible
      ? `Money Maker goal: reach ${g.targetMrr}€/mois${g.deadline ? ` by ${g.deadline}` : ''}. Prioritize Stripe-ready products, fast validation, direct acquisition, and kill/boost decisions against this target.`
      : undefined as any,
  });
  await db.update(schema.moneyMakerConfig).set({
    goalTargetMrr: acceptedTarget,
    goalDeadline: acceptedDeadline,
    goalStatus: g.feasible ? 'accepted' : null,
    goalAssessment: g.assessment,
    goalPending: g.proposal ? JSON.stringify({ ...g.proposal, originalTargetMrr: g.targetMrr, originalDeadline: g.deadline }) : null,
    goalOriginal: message,
    updatedAt: new Date(),
  }).where(eq(schema.moneyMakerConfig.userId, userId));

  await logRun(userId, {
    type: 'decision',
    title: g.feasible ? `Objectif accepté : ${g.targetMrr}€/mois` : `Objectif à ajuster : ${g.targetMrr}€/mois`,
    detail: g.assessment,
    meta: g,
  });
  return g;
}

export async function acceptGoalProposal(userId: string) {
  const cfg = await getConfig(userId);
  if (!cfg.goalPending) throw new Error('no pending goal proposal');
  const pending = JSON.parse(cfg.goalPending);
  const targetMrr = Math.max(0, Math.round(Number(pending.targetMrr) || 0));
  const deadline = pending.deadline ? new Date(pending.deadline) : null;
  const strategyNote = `Money Maker goal accepted: reach ${targetMrr}€/mois${pending.deadline ? ` by ${pending.deadline}` : ''}. Prioritize Stripe-ready products, fast validation, direct acquisition, and kill/boost decisions against this target.`;
  await db.update(schema.moneyMakerConfig).set({
    goalTargetMrr: targetMrr,
    goalDeadline: deadline,
    goalStatus: 'accepted',
    goalAssessment: pending.note || cfg.goalAssessment,
    goalPending: null,
    strategyNote,
    updatedAt: new Date(),
  }).where(eq(schema.moneyMakerConfig.userId, userId));
  await logRun(userId, { type: 'decision', title: `Objectif accepté : ${targetMrr}€/mois`, detail: pending.note || strategyNote, meta: pending });
  return getState(userId);
}

// Détecte un ordre explicite de LANCER des entreprises ("lance une app fitness",
// "crée 3 startups", "launch a business"). Renvoie le nombre demandé (1..5) ou 0.
// Déterministe → 0 dépendance au LLM pour la commande la plus courante du boss.
function _looksLikeSpawn(message: string): number {
  const m = message.toLowerCase();
  const verb = /(lance|lancer|démarre|demarre|démarrer|crée|cree|créer|creer|construis|construire|build|launch|start|create|monte|monter|ouvre|ouvrir)/i;
  const noun = /(entreprise|entreprises|app|apps|application|applications|business|bizness|startup|startups|bo[iî]te|boites|boîtes|site|sites|produit|produits|projet|projets|saas)/i;
  if (!verb.test(m) || !noun.test(m)) return 0;
  // "ne lance pas", "n'ouvre pas" → pas un ordre de spawn
  if (/\b(ne|n['’ ])\s*\w+\s+pas\b/i.test(m) || /\b(don['’]?t|do not)\b/i.test(m)) return 0;
  // Extrait un nombre (chiffre ou mot) juste avant le nom, sinon 1.
  let count = 1;
  const digit = m.match(/\b(\d{1,2})\b/);
  if (digit) count = parseInt(digit[1], 10);
  else {
    const words: Record<string, number> = { un: 1, une: 1, deux: 2, trois: 3, quatre: 4, cinq: 5, a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5 };
    for (const [w, n] of Object.entries(words)) { if (new RegExp(`\\b${w}\\b`, 'i').test(m)) { count = n; break; } }
  }
  return Math.max(1, Math.min(count, 5));
}

// Détecte une intention "objectif de revenu" à partir d'un montant + verbe cible.
function _looksLikeGoal(message: string): boolean {
  const m = message.toLowerCase();
  const hasMoney = /([0-9][0-9\s.,]*)\s*(?:€|eur|euros?|\$|usd|k\b|millions?|million)/i.test(m)
    || /\b\d[\d\s.,]*\s*(?:par mois|\/mois|mrr|arr|month)/i.test(m);
  const hasIntent = /(faire|atteindre|gagner|générer|generer|vise|viser|objectif|but|target|reach|make|earn|hit|d['’ ]ici|par mois|\/mois|mrr|arr)/i.test(m);
  return hasMoney && hasIntent;
}

export async function bossChat(userId: string, message: string, history: Array<{ role: string; content: string }>): Promise<BossChatReply> {
  await logRun(userId, { type: 'chat', title: message.slice(0, 120) });

  // ── Fast-path OBJECTIF : si le message est clairement une cible de revenu,
  // on saute l'appel d'intention du bossChat (économie d'un round-trip AI) et
  // on évalue directement la faisabilité. Détection déterministe + instantanée.
  if (_looksLikeGoal(message)) {
    const g = await evaluateGoal(userId, message);
    return { reply: g.assessment, action: 'goal', goal: g };
  }

  // ── Fast-path EMAIL : ordre explicite d'écrire/envoyer un email. Déterministe.
  if (_looksLikeEmail(message)) {
    return composeEmailFromChat(userId, message, history);
  }

  // ── Fast-path SPAWN : ordre explicite de lancer des entreprises. Déterministe,
  // ne dépend pas du JSON du LLM (peu fiable) — la commande cœur du boss marche
  // toujours. On lance, puis on renvoie les NOMS pour l'aperçu dans le chat.
  {
    const n = _looksLikeSpawn(message);
    if (n > 0) {
      const spawned: string[] = [];
      for (let i = 0; i < n; i++) {
        const r = await spawnNow(userId, message);
        spawned.push(...r.ideas.map(idea => idea.name));
      }
      const reply = spawned.length
        ? (spawned.length === 1
          ? `C'est parti — je lance ${spawned[0]}. Je construis le site, branche Stripe et j'attaque l'acquisition. Suis l'avancement dans le portfolio.`
          : `C'est parti — je lance ${spawned.length} entreprises : ${spawned.join(', ')}. Je les construis et les mets en marché. Suis l'avancement dans le portfolio.`)
        : `Tous les slots sont occupés (max atteint). Mets une entreprise en pause ou augmente les slots pour en lancer une nouvelle.`;
      return { reply, action: spawned.length ? 'spawn' : 'none', spawned: spawned.length ? spawned : undefined };
    }
  }

  const companies = await db.select({ id: schema.companies.id, name: schema.companies.name, status: schema.companies.status, mrr: schema.companies.mrr })
    .from(schema.companies)
    .where(and(eq(schema.companies.userId, userId), eq(schema.companies.origin, 'money_maker'))).all();
  const roster = companies.map(c => `- ${c.name} (id:${c.id}, status:${c.status}, MRR:${c.mrr || 0}€)`).join('\n') || '(aucune entreprise pour l\'instant)';

  const model = _pickModel('reasoning');
  const sys = `${BOSS_SYSTEM}

You are chatting with the OWNER of the portfolio. Reply in the OWNER'S LANGUAGE (match their message language; French if they write French).

Current portfolio:
${roster}

Decide the intent and respond with STRICT JSON only:
{"reply": "natural language answer to the owner", "action": "spawn" | "improve" | "kill" | "pause" | "resume" | "boost" | "question" | "goal" | "none", "companyId": "<id or null>", "count": <number of new businesses to spawn, only for action=spawn, default 1>, "question": {"text": "...", "options": ["..."]} | null}

Rules:
- If the owner states a REVENUE TARGET/OBJECTIVE ("je veux faire 10000€ par mois d'ici décembre", "atteindre 5k MRR", "make $X by <date>"), action="goal" (leave reply short, feasibility is computed separately).
- If the owner asks to launch/create businesses ("lance 3 apps fitness"), action="spawn" with count.
- If they refer to a specific company but it's AMBIGUOUS (name doesn't clearly match one company), action="question" and ask which one (options = candidate names).
- If they clearly target a company (improve/kill/pause/resume/boost its X), set companyId to that company's id.
- Otherwise action="none" and just answer helpfully.
- Keep "reply" concise and concrete.`;
  const hist = history.slice(-6).map(h => `${h.role}: ${h.content}`).join('\n');
  const user = `${hist ? hist + '\n' : ''}owner: ${message}`;

  let parsed: any = {};
  try {
    const raw = await withTimeout(_callAI(model, sys, user, 900), 40000, 'bossChat callAI');
    let t = raw.trim();
    const fence = t.match(/```(?:json)?\s*([\s\S]*?)```/); if (fence) t = fence[1].trim();
    const s = t.indexOf('{'), e = t.lastIndexOf('}');
    if (s !== -1 && e !== -1) t = t.slice(s, e + 1);
    parsed = JSON.parse(t);
  } catch (e) {
    // Fallback robuste : le modèle n'a pas renvoyé de JSON exploitable.
    // On détecte au moins une intention "objectif de revenu" pour ne jamais
    // rater la feature goal, sinon on demande de reformuler.
    if (_looksLikeGoal(message)) {
      const g = await evaluateGoal(userId, message);
      return { reply: g.assessment, action: 'goal', goal: g };
    }
    return { reply: "J'ai eu un souci pour analyser ta demande, reformule ?", action: 'none' };
  }

  const action = String(parsed.action || 'none');
  const reply = String(parsed.reply || '').slice(0, 1500) || 'Ok.';
  const companyId = parsed.companyId && companies.some(c => c.id === parsed.companyId) ? parsed.companyId : null;

  try {
    if (action === 'spawn') {
      const count = Math.max(1, Math.min(Number(parsed.count) || 1, 5));
      // On renvoie les NOMS des entreprises lancées (pas les queueIds) : le front
      // les retrouve dans le portfolio par nom, aussi bien en file d'attente qu'une
      // fois l'entreprise live — l'aperçu se met à jour automatiquement.
      const spawned: string[] = [];
      for (let i = 0; i < count; i++) {
        const r = await spawnNow(userId, message);
        spawned.push(...r.ideas.map(idea => idea.name));
      }
      return { reply, action, spawned };
    }
    if (action === 'question') {
      return { reply, action, question: parsed.question || { text: reply } };
    }
    if (action === 'goal') {
      const g = await evaluateGoal(userId, message);
      return { reply: g.assessment || reply, action, goal: g };
    }
    if (['improve', 'kill', 'pause', 'resume', 'boost'].includes(action) && companyId) {
      const mapped = action === 'improve' ? 'boost' : action;
      await companyAction(userId, companyId, mapped as any);
      return { reply, action, companyId };
    }
  } catch (e) {
    console.error('[MoneyMaker] bossChat action failed', e);
  }
  return { reply, action: 'none', companyId };
}

// ─── EMAILS : l'IA rédige + envoie des emails pros (admin-only via routes) ────

function _toDraft(row: typeof schema.emails.$inferSelect, fromName: string | null, brandColor?: string | null): EmailDraft {
  let cta: { label: string; url: string } | null = null;
  try { cta = row.cta ? JSON.parse(row.cta) : null; } catch { cta = null; }
  return {
    id: row.id,
    companyId: row.companyId,
    type: row.type,
    subject: row.subject,
    body: row.body,
    recipientEmail: row.recipientEmail || '',
    recipientName: row.recipientName,
    status: row.status,
    fromName,
    brandColor: brandColor || null,
    preheader: row.preheader || null,
    cta,
    createdAt: row.createdAt ? new Date(row.createdAt as any).getTime() : null,
  };
}

// Vérifie qu'un email appartient bien à une entreprise money_maker de l'owner.
async function _ownedEmail(userId: string, emailId: string) {
  const row = await db.select().from(schema.emails).where(eq(schema.emails.id, emailId)).get();
  if (!row) return null;
  const co = await db.select().from(schema.companies)
    .where(and(eq(schema.companies.id, row.companyId), eq(schema.companies.userId, userId), eq(schema.companies.origin, 'money_maker'))).get();
  if (!co) return null;
  return { row, company: co };
}

// Détecte une intention "envoyer/écrire un email". Déterministe.
function _looksLikeEmail(message: string): boolean {
  const m = message.toLowerCase();
  const hasEmailAddr = /[\w.+-]+@[\w-]+\.[\w.-]+/.test(message);
  const verb = /(envoie|envoyer|écris|ecris|écrire|ecrire|rédige|redige|rédiger|rediger|contacte|contacter|relance|relancer|mail|maile|e-?mail|send|write|email|reach out|follow.?up)/i;
  const noun = /(email|e-?mail|mail|courriel|message|newsletter)/i;
  if (hasEmailAddr && verb.test(m)) return true;
  return verb.test(m) && noun.test(m);
}

function _emailType(message: string): string {
  const m = message.toLowerCase();
  if (/prospect|démarch|demarch|cold|acqui|nouveau client|new client/.test(m)) return 'prospection';
  if (/collab|partenariat|partner|deal/.test(m)) return 'collab';
  if (/promo|offre|discount|réduc|reduc|solde|launch|lancement/.test(m)) return 'promo';
  if (/support|aide|help|assistance|problème|probleme|ticket/.test(m)) return 'support';
  if (/relance|follow.?up|rappel|reminder/.test(m)) return 'relance';
  if (/presse|press|média|media|journalist/.test(m)) return 'presse';
  return 'autre';
}

// Résout l'entreprise "from" : companyId explicite, sinon dernière entreprise
// money_maker de l'owner. Renvoie null si l'owner n'a aucune entreprise.
async function _resolveCompany(userId: string, preferId?: string | null) {
  if (preferId) {
    const c = await db.select().from(schema.companies)
      .where(and(eq(schema.companies.id, preferId), eq(schema.companies.userId, userId), eq(schema.companies.origin, 'money_maker'))).get();
    if (c) return c;
  }
  return db.select().from(schema.companies)
    .where(and(eq(schema.companies.userId, userId), eq(schema.companies.origin, 'money_maker')))
    .orderBy(desc(schema.companies.createdAt)).get();
}

// ─── Branding email ──────────────────────────────────────────────────────────
// Identité visuelle d'une entreprise pour habiller ses emails : couleurs, logo,
// police, accroche. Source = checkpoint du dernier build-website (design réel du
// site généré). Repli déterministe (couleur dérivée du nom) si pas de build.
export interface CompanyBrand {
  name: string;
  primary: string;   // couleur principale (header, bouton)
  accent: string;    // couleur secondaire
  text: string;      // couleur du texte
  bg: string;        // fond de la carte email
  logoUrl: string | null;
  font: string;
  tagline: string | null;
  website: string | null;
}

function _hex(c: any): string | null {
  if (typeof c !== 'string') return null;
  const s = c.trim();
  return /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(s) ? s : null;
}

// Couleur stable dérivée du nom (repli si aucun design de marque connu).
function _brandColorFromName(name: string): string {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
  const palette = ['#4F46E5', '#0EA5E9', '#059669', '#DC2626', '#D97706', '#7C3AED', '#DB2777', '#0891B2', '#2563EB', '#16A34A'];
  return palette[h % palette.length];
}

export async function getCompanyBrand(company: typeof schema.companies.$inferSelect): Promise<CompanyBrand> {
  let colors: any = {};
  let logoUrl: string | null = null;
  let font: string | undefined;
  let tagline: string | null = null;
  try {
    const exec = await db.select().from(schema.executionState)
      .where(and(eq(schema.executionState.companyId, company.id), eq(schema.executionState.processType, 'build-website')))
      .orderBy(desc(schema.executionState.startedAt)).limit(1).get();
    if (exec?.checkpoint) {
      const cp: any = JSON.parse(exec.checkpoint || '{}');
      const design = cp.design || cp.meta || {};
      colors = design.colors || {};
      if (!colors.primary && cp.meta?.primaryColor) colors = { primary: cp.meta.primaryColor, accent: cp.meta.accentColor };
      logoUrl = (typeof cp.meta?.n === 'string' && cp.meta.n.startsWith('http')) ? cp.meta.n : null;
      font = design.font || cp.meta?.font;
      tagline = design.tagline || cp.meta?.tagline || null;
    }
  } catch { /* repli ci-dessous */ }

  const primary = _hex(colors.primary) || _brandColorFromName(company.name);
  const accent = _hex(colors.accent) || primary;
  return {
    name: company.name,
    primary,
    accent,
    text: _hex(colors.text) || '#1f2937',
    bg: '#ffffff',
    logoUrl,
    font: (font && String(font).slice(0, 60)) || "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif",
    tagline: tagline ? String(tagline).slice(0, 120) : null,
    website: company.website || null,
  };
}

// Un peu plus sombre qu'une couleur (pour dégradés / hover).
function _darken(hex: string, amt = 0.12): string {
  const m = hex.replace('#', '');
  const full = m.length === 3 ? m.split('').map(x => x + x).join('') : m;
  const num = parseInt(full, 16);
  let r = (num >> 16) & 255, g = (num >> 8) & 255, b = num & 255;
  r = Math.max(0, Math.round(r * (1 - amt)));
  g = Math.max(0, Math.round(g * (1 - amt)));
  b = Math.max(0, Math.round(b * (1 - amt)));
  return '#' + ((r << 16) | (g << 8) | b).toString(16).padStart(6, '0');
}

// Initiales pour un logo textuel de repli (si pas d'image de logo).
function _initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  const s = parts.length >= 2 ? parts[0][0] + parts[1][0] : name.slice(0, 2);
  return s.toUpperCase();
}

// Habille un fragment HTML (corps rédigé par l'IA) dans un template email pro et
// brandé aux couleurs de l'entreprise. Tables + styles inline = compatible Gmail.
export function renderBrandedEmail(opts: {
  brand: CompanyBrand;
  fromName: string;
  bodyHtml: string;
  preheader?: string | null;
  cta?: { label: string; url: string } | null;
  recipientName?: string | null;
}): string {
  const { brand } = opts;
  const p = brand.primary;
  const pDark = _darken(p, 0.16);
  const logo = brand.logoUrl
    ? `<img src="${brand.logoUrl}" alt="${_esc(brand.name)}" height="40" style="height:40px;max-height:40px;width:auto;display:block;border:0;outline:none;text-decoration:none;">`
    : `<span style="font-size:22px;font-weight:800;color:#ffffff;letter-spacing:-0.4px;">${_esc(brand.name)}</span>`;
  const initials = _initials(brand.name);
  const badge = brand.logoUrl ? '' :
    `<td width="44" style="width:44px;padding-right:12px;vertical-align:middle;">
       <div style="width:44px;height:44px;border-radius:12px;background:rgba(255,255,255,0.18);text-align:center;line-height:44px;font-size:17px;font-weight:800;color:#ffffff;">${_esc(initials)}</div>
     </td>`;
  const preheader = opts.preheader
    ? `<div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent;height:0;width:0;">${_esc(opts.preheader)}</div>`
    : '';
  const ctaBlock = opts.cta && opts.cta.url && opts.cta.label
    ? `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:26px 0 6px;">
         <tr><td style="border-radius:10px;background:${p};">
           <a href="${_escAttr(opts.cta.url)}" style="display:inline-block;padding:13px 30px;font-size:15px;font-weight:600;color:#ffffff;text-decoration:none;border-radius:10px;">${_esc(opts.cta.label)} &nbsp;→</a>
         </td></tr>
       </table>`
    : '';
  const websiteFooter = brand.website
    ? `<a href="${_escAttr(brand.website)}" style="color:${p};text-decoration:none;">${_esc(brand.website.replace(/^https?:\/\//, ''))}</a> · `
    : '';

  return `<!DOCTYPE html>
<html lang="und"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"><meta http-equiv="X-UA-Compatible" content="IE=edge"></head>
<body style="margin:0;padding:0;background:#f4f5f7;">
${preheader}
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f4f5f7;padding:32px 12px;font-family:${brand.font};">
  <tr><td align="center">
    <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background:${brand.bg};border-radius:16px;overflow:hidden;box-shadow:0 4px 24px rgba(15,23,42,0.07);">
      <tr><td style="background:linear-gradient(135deg,${p} 0%,${pDark} 100%);padding:26px 40px;">
        <table role="presentation" cellpadding="0" cellspacing="0"><tr>${badge}<td style="vertical-align:middle;">
          ${logo}
          ${brand.tagline ? `<div style="font-size:12px;color:rgba(255,255,255,0.82);margin-top:4px;">${_esc(brand.tagline)}</div>` : ''}
        </td></tr></table>
      </td></tr>
      <tr><td style="padding:38px 40px 30px;color:${brand.text};font-size:15px;line-height:1.62;">
        <div style="color:${brand.text};font-size:15px;line-height:1.62;">${opts.bodyHtml}</div>
        ${ctaBlock}
      </td></tr>
      <tr><td style="background:#f9fafb;padding:20px 40px;border-top:1px solid #eef0f3;">
        <div style="font-size:12px;color:#9aa1ab;line-height:1.6;">
          ${websiteFooter}${_esc(opts.fromName)}<br>
          Vous recevez cet email dans le cadre d'une prise de contact professionnelle.
        </div>
      </td></tr>
    </table>
    <div style="font-size:11px;color:#b6bcc6;margin-top:16px;">Envoyé par ${_esc(brand.name)}</div>
  </td></tr>
</table>
</body></html>`;
}

function _esc(s: string): string {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
function _escAttr(s: string): string {
  return _esc(s).replace(/"/g, '&quot;');
}

/**
 * L'IA rédige un email pro à partir de la demande du chat, puis l'enregistre en
 * brouillon (ou l'envoie direct si emailAutoSend). Renvoie un BossChatReply.
 */
export async function composeEmailFromChat(userId: string, message: string, history: Array<{ role: string; content: string }>): Promise<BossChatReply> {
  // 1. Destinataire
  const addr = message.match(/[\w.+-]+@[\w-]+\.[\w.-]+/);
  if (!addr) {
    return {
      reply: "À qui dois-je envoyer cet email ? Donne-moi l'adresse du destinataire (ex: contact@exemple.com).",
      action: 'question',
      question: { text: "Adresse email du destinataire ?" },
    };
  }
  const recipientEmail = addr[0];

  // 2. Entreprise expéditrice
  const company = await _resolveCompany(userId);
  if (!company) {
    return {
      reply: "Je n'ai encore aucune entreprise dans le portfolio pour signer cet email. Lance d'abord une entreprise (ex : « lance une app fitness »), puis je pourrai envoyer des emails en son nom.",
      action: 'none',
    };
  }

  const cfg = await getConfig(userId);
  const type = _emailType(message);
  const brand = await getCompanyBrand(company);

  // 3. Nom d'expéditeur : override dans le message > config > nom entreprise
  let fromName = cfg.emailFromName || company.name;
  const asMatch = message.match(/(?:de la part de|au nom de|signe(?:r)? (?:avec|par)|from|sender|expéditeur|expediteur)\s*[:=]?\s*["“]?([A-Za-z0-9À-ÿ &._-]{2,40})/i);
  if (asMatch) fromName = asMatch[1].trim();

  // 4. Rédaction par l'IA (langue auto selon contexte/destinataire)
  const model = _pickModel('reasoning');
  const sys = `${BOSS_SYSTEM}

Tu es le responsable communication de l'entreprise "${company.name}" (${company.idea}).
Rédige UN email professionnel, court, humain et convaincant, prêt à envoyer.

Le corps sera automatiquement habillé dans un template email pro et brandé (header
avec logo + couleurs de l'entreprise, bouton CTA, footer). Tu écris UNIQUEMENT le
contenu, pas la mise en page — pas de header, pas de logo, pas de signature stylée,
pas de bouton (le bouton = le champ "cta").

Consignes:
- Détecte automatiquement la langue la plus pertinente pour le destinataire (nom de domaine, contexte, langue de la demande) et écris DANS CETTE LANGUE.
- Type d'email: ${type}.
- Ton pro mais chaleureux, orienté valeur concrète. Court (3-5 courts paragraphes max). Pas de blabla ni de placeholders type [Nom].
- Ouvre par une accroche personnalisée si tu peux déduire qui est le destinataire. Termine par une phrase de clôture + le nom "${fromName}" (juste le texte, pas de bloc signature).
- Corps = fragment HTML propre : <p>, <br>, <strong>, <ul><li>. PAS de <a> bouton (utilise "cta"), pas de <html>/<head>/<body>, pas de style inline, pas d'images.
- "preheader" = une phrase d'aperçu (~60-90 caractères) qui donne envie d'ouvrir (affichée par Gmail).
- "cta" = l'action principale sous forme de bouton, OU null si aucune action web pertinente. url = une vraie URL plausible (ex: le site de l'entreprise) ou null.

Réponds en JSON STRICT uniquement:
{"subject": "...", "preheader": "...", "body": "<p>...</p>", "cta": {"label": "...", "url": "https://..."} | null, "recipientName": "<prénom/nom si déduisible sinon null>", "language": "fr|en|..."}`;
  const hist = history.slice(-4).map(h => `${h.role}: ${h.content}`).join('\n');
  const user = `${hist ? hist + '\n' : ''}Demande de l'owner: ${message}\nDestinataire: ${recipientEmail}`;

  let parsed: any = {};
  try {
    const raw = await withTimeout(_callAI(model, sys, user, 1200), 45000, 'composeEmail callAI');
    let t = raw.trim();
    const fence = t.match(/```(?:json)?\s*([\s\S]*?)```/); if (fence) t = fence[1].trim();
    const s = t.indexOf('{'), e = t.lastIndexOf('}');
    if (s !== -1 && e !== -1) t = t.slice(s, e + 1);
    parsed = JSON.parse(t);
  } catch (e) {
    return { reply: "Je n'ai pas réussi à rédiger l'email, reformule ta demande ?", action: 'none' };
  }

  const subject = String(parsed.subject || '').slice(0, 200) || `Un message de ${company.name}`;
  const body = String(parsed.body || '').slice(0, 8000) || `<p>Bonjour,</p><p>...</p><p>${fromName}</p>`;
  const recipientName = parsed.recipientName ? String(parsed.recipientName).slice(0, 120) : null;
  const preheader = parsed.preheader ? String(parsed.preheader).slice(0, 160) : null;
  // CTA : l'IA en propose un ; à défaut d'URL on retombe sur le site de l'entreprise.
  let cta: { label: string; url: string } | null = null;
  if (parsed.cta && parsed.cta.label) {
    const url = String(parsed.cta.url || company.website || '').trim();
    if (/^https?:\/\//i.test(url)) cta = { label: String(parsed.cta.label).slice(0, 40), url: url.slice(0, 400) };
  }

  // 5. Enregistre le brouillon
  const id = uuidv4();
  await db.insert(schema.emails).values({
    id,
    companyId: company.id,
    type,
    subject,
    body,
    preheader,
    cta: cta ? JSON.stringify(cta) : null,
    recipientEmail,
    recipientName,
    status: 'draft',
    generatedBy: 'money_maker',
  });

  // 6. Auto-send si validation humaine désactivée
  if (cfg.emailAutoSend) {
    const sent = await sendEmailDraft(userId, id, fromName);
    const row = await db.select().from(schema.emails).where(eq(schema.emails.id, id)).get();
    return {
      reply: sent.ok
        ? `Email envoyé à ${recipientEmail} au nom de ${fromName}.\nObjet : « ${subject} »`
        : `J'ai rédigé l'email mais l'envoi a échoué (${sent.error || 'erreur'}). Il reste en brouillon, tu peux réessayer.`,
      action: 'email',
      companyId: company.id,
      emails: row ? [_toDraft(row, fromName, brand.primary)] : [],
    };
  }

  const row = await db.select().from(schema.emails).where(eq(schema.emails.id, id)).get();
  await logRun(userId, { type: 'decision', companyId: company.id, title: `Brouillon email (${type}) → ${recipientEmail}`, detail: subject });
  return {
    reply: `Voici un brouillon d'email (${type}) pour ${recipientEmail}, signé ${fromName}. Relis-le et clique sur Envoyer, ou dis-moi quoi ajuster.`,
    action: 'email',
    companyId: company.id,
    emails: row ? [_toDraft(row, fromName, brand.primary)] : [],
  };
}

/** Envoie un brouillon existant (validation humaine ou auto). */
export async function sendEmailDraft(userId: string, emailId: string, fromNameOverride?: string) {
  const owned = await _ownedEmail(userId, emailId);
  if (!owned) return { ok: false, error: 'Email introuvable' };
  const { row, company } = owned;
  if (row.status === 'sent') return { ok: true, alreadySent: true };
  if (!row.recipientEmail) return { ok: false, error: 'Pas de destinataire' };

  const cfg = await getConfig(userId);
  const fromName = fromNameOverride || cfg.emailFromName || company.name;

  // Habille le corps dans le template brandé (couleurs + logo de l'entreprise).
  const brand = await getCompanyBrand(company);
  let cta: { label: string; url: string } | null = null;
  try { cta = row.cta ? JSON.parse(row.cta) : null; } catch { cta = null; }
  const html = renderBrandedEmail({
    brand,
    fromName,
    bodyHtml: row.body,
    preheader: row.preheader,
    cta,
    recipientName: row.recipientName,
  });

  const res = await sendEmailAuto({
    to: row.recipientEmail,
    subject: row.subject,
    html,
    from: fromName,
  });

  const status = res.ok ? 'sent' : 'not_sent';
  await db.update(schema.emails).set({ status }).where(eq(schema.emails.id, emailId));
  if (res.ok) {
    await db.update(schema.companies)
      .set({ emailsSent: sql`${schema.companies.emailsSent} + 1`, updatedAt: new Date() })
      .where(eq(schema.companies.id, company.id));
    await logRun(userId, { type: 'decision', companyId: company.id, title: `Email envoyé (${row.type}) → ${row.recipientEmail}`, detail: `Objet : ${row.subject} — via ${emailProvider()}` });
  }
  return res;
}

/** Liste les emails (brouillons + envoyés) des entreprises money_maker de l'owner. */
export async function listEmails(userId: string, limit = 50): Promise<EmailDraft[]> {
  const cfg = await getConfig(userId);
  const cos = await db.select({ id: schema.companies.id, name: schema.companies.name }).from(schema.companies)
    .where(and(eq(schema.companies.userId, userId), eq(schema.companies.origin, 'money_maker'))).all();
  if (!cos.length) return [];
  const nameById = new Map(cos.map(c => [c.id, c.name]));
  // Couleur de marque par entreprise (stable, dérivée du nom en repli).
  const colorById = new Map(cos.map(c => [c.id, _brandColorFromName(c.name)]));
  const rows = await db.select().from(schema.emails)
    .where(inArray(schema.emails.companyId, cos.map(c => c.id)))
    .orderBy(desc(schema.emails.createdAt)).limit(limit).all();
  return rows.map(r => _toDraft(r, cfg.emailFromName || nameById.get(r.companyId) || null, colorById.get(r.companyId) || null));
}

/** Rejette un brouillon (soft, status='discarded'). */
export async function discardEmail(userId: string, emailId: string, reason?: string) {
  const owned = await _ownedEmail(userId, emailId);
  if (!owned) return { ok: false, error: 'Email introuvable' };
  const cleanReason = (reason || '').trim().slice(0, 500) || null;
  await db.update(schema.emails)
    .set({ status: 'discarded', discardReason: cleanReason })
    .where(eq(schema.emails.id, emailId));
  if (cleanReason) {
    await logRun(userId, { type: 'decision', companyId: owned.company.id, title: `Email refusé → ${owned.row.recipientEmail}`, detail: `Raison : ${cleanReason}` });
  }
  return { ok: true };
}

export async function companyAction(userId: string, companyId: string, action: 'pause' | 'resume' | 'kill' | 'boost' | 'revive') {
  const company = await db.select().from(schema.companies)
    .where(and(eq(schema.companies.id, companyId), eq(schema.companies.userId, userId))).get();
  if (!company) throw new Error('not found');
  const { disableAutopilot } = await import('./autopilot');
  switch (action) {
    case 'pause':
      await disableAutopilot(companyId);
      await db.update(schema.companies).set({ status: 'paused', updatedAt: new Date() }).where(eq(schema.companies.id, companyId));
      await logRun(userId, { type: 'decision', companyId, title: `Pause : ${company.name}` });
      break;
    case 'resume':
      await enableAutopilot(companyId);
      await db.update(schema.companies).set({ status: 'active', updatedAt: new Date() }).where(eq(schema.companies.id, companyId));
      await logRun(userId, { type: 'decision', companyId, title: `Resume : ${company.name}` });
      break;
    case 'kill':
      await disableAutopilot(companyId);
      await db.update(schema.companies).set({ status: 'killed', updatedAt: new Date() }).where(eq(schema.companies.id, companyId));
      await logRun(userId, { type: 'kill', companyId, title: `Kill manuel : ${company.name}`, detail: 'Soft-delete réversible.' });
      break;
    case 'revive':
      await db.update(schema.companies).set({ status: 'active', updatedAt: new Date() }).where(eq(schema.companies.id, companyId));
      await enableAutopilot(companyId);
      await logRun(userId, { type: 'decision', companyId, title: `Revive : ${company.name}` });
      break;
    case 'boost':
      await logRun(userId, { type: 'improve', companyId, title: `Boost : ${company.name}`, detail: 'Priorité croissance renforcée.' });
      break;
  }
  return getState(userId);
}
