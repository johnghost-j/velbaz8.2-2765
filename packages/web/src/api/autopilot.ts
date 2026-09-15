/**
 * VELBAZ AUTOPILOT ENGINE
 * 
 * 4 AI agents running a company 24/7:
 * - Strategist: morning plan, revenue analysis, decides what to do
 * - Content: creates posts, articles, images
 * - Marketing: posts on social, engages with audience
 * - Analytics: tracks stats, detects anomalies
 * 
 * Work cycle:
 * 1. Morning plan (~8am) — Strategist analyzes and plans the day
 * 2. Hourly tick — check if tasks need execution
 * 3. Event-reactive — respond to new data
 * 4. Can WAIT — not every tick produces action
 */

import { db } from './database/index';
import { eq, and, desc, asc, gte, lte, isNull, or, sql, count } from 'drizzle-orm';
import { dbRetry } from './db-retry';
import * as schema from './database/schema';
import { v4 as uuidv4 } from 'uuid';
import { runContentPipeline } from './social/pipeline';
import { sendEmail, isEmailConfigured } from './email-provider';
import { materializeDueEvents, type CalendarCategory } from './ai-calendar';
import { runWithAiContext, newRunId } from './ai-usage/context';

// Mappe une catégorie du calendrier interne vers un type de tâche autopilot.
const CALENDAR_CAT_TO_TASK: Record<CalendarCategory, { type: string; agent: AgentName }> = {
  marketing: { type: 'create_post', agent: 'marketing' },
  task: { type: 'adjust_strategy', agent: 'strategist' },
  reminder: { type: 'send_email', agent: 'marketing' },
  update: { type: 'edit_website', agent: 'content' },
  deadline: { type: 'adjust_strategy', agent: 'strategist' },
  client_meeting: { type: 'schedule_appointment', agent: 'strategist' },
};

// Fabrique une tâche autopilot À PARTIR d'un événement du calendrier interne
// (utilisée par materializeDueEvents quand la date d'un événement est arrivée).
async function createTaskFromCalendar(
  companyId: string,
  when: Date,
  title: string,
  description: string,
  category: CalendarCategory,
): Promise<string> {
  const map = CALENDAR_CAT_TO_TASK[category] || CALENDAR_CAT_TO_TASK.task;
  const today = new Date().toISOString().split('T')[0];
  const plan = await db.select().from(schema.autopilotPlans)
    .where(and(eq(schema.autopilotPlans.companyId, companyId), eq(schema.autopilotPlans.date, today))).get();
  return createTask(companyId, plan?.id || null, {
    type: map.type,
    title,
    description,
    agent: map.agent,
    priority: category === 'deadline' || category === 'client_meeting' ? 2 : 5,
    scheduledFor: when,
    hasExactTime: when.getHours() !== 0 || when.getMinutes() !== 0,
    input: { fromCalendar: true, category },
  });
}

// ─── Types ──────────────────────────────────────────────────────────────────

type AgentName = 'strategist' | 'content' | 'marketing' | 'analytics';

interface AgentContext {
  company: typeof schema.companies.$inferSelect;
  config: typeof schema.autopilotConfig.$inferSelect;
  plan: typeof schema.autopilotPlans.$inferSelect | null;
  userId: string;
}

interface TaskAction {
  type: string;
  title: string;
  description: string;
  agent: AgentName;
  priority?: number;
  scheduledFor?: Date;
  input?: any;
  dependsOn?: string;
  timeSlot?: TimeSlot;
  hasExactTime?: boolean;
}

// ─── Time slots (matin / midi / soir) ───────────────────────────────────────
export type TimeSlot = 'morning' | 'noon' | 'evening';

// Créneaux à heures fixes : matin 6-12h, midi 12-18h, soir 18-24h (et 0-6h → soir)
export function slotFromDate(date: Date): TimeSlot {
  const h = date.getHours();
  if (h >= 6 && h < 12) return 'morning';
  if (h >= 12 && h < 18) return 'noon';
  return 'evening';
}

// Heure de début (locale) d'un créneau, pour dater une tâche sans heure précise
function slotStartHour(slot: TimeSlot): number {
  if (slot === 'morning') return 6;
  if (slot === 'noon') return 12;
  return 18;
}

// ─── Import callAI from main (we'll use a shared reference) ──────────────

// These get set by initAutopilot() from index.ts
let _callAI: (model: string, systemPrompt: string, userMessage: string, maxTokens?: number) => Promise<string>;
let _deductTokens: (userId: string, action: string, customCost?: number) => Promise<{ ok: boolean; balance: number; error?: string }>;
let _pickModel: (task?: string) => string;

export function initAutopilot(deps: {
  callAI: typeof _callAI;
  deductTokens: typeof _deductTokens;
  pickModel: typeof _pickModel;
}) {
  _callAI = deps.callAI;
  _deductTokens = deps.deductTokens;
  _pickModel = deps.pickModel;
  console.log('[Autopilot] Engine initialized');
}

// ─── Agent System Prompts ──────────────────────────────────────────────────

const AGENT_PROMPTS: Record<AgentName, string> = {
  strategist: `You are the STRATEGIST agent of Velbaz Autopilot. You are the CEO brain of this AI team.

Your job:
- Every morning, analyze the company's current state and create a daily plan
- Decide WHAT to do, WHEN, and WHY
- Diagnose revenue problems: Is it traffic? Conversion? Product-market fit? Pricing?
- Prioritize ruthlessly — focus on what moves the needle
- Coordinate the other agents (Content, Marketing, Analytics)

You think in terms of business outcomes:
- Revenue growth, customer acquisition, brand awareness
- You understand funnels: Awareness → Interest → Desire → Action
- You track what worked and what didn't

IMPORTANT RULES:
- Be specific. Not "create content" but "create a Twitter thread about [specific topic] because [reason]"
- Include timing: when should each task happen
- Consider dependencies: content must be created before it can be posted
- If things are going well, don't change strategy — double down
- If things aren't working, diagnose WHY and pivot

Output format: Always respond in valid JSON.`,

  content: `You are the CONTENT agent of Velbaz Autopilot. You are the creative brain.

Your job:
- Create compelling posts, articles, captions, and content ideas
- Match the brand voice and style
- Write for specific platforms (Twitter is short/punchy, LinkedIn is professional, Instagram is visual)
- Generate image descriptions when visual content is needed
- Create content that drives engagement and conversions

IMPORTANT RULES:
- Every piece of content must have a clear purpose (awareness, engagement, conversion)
- Use hooks that grab attention in the first line
- Include calls to action when appropriate
- Adapt tone to the platform
- Reference current trends when relevant

Output format: Always respond in valid JSON.`,

  marketing: `You are the MARKETING agent of Velbaz Autopilot. You are the distribution brain.

Your job:
- Decide the best time and platform to post content
- Execute posting across connected social platforms
- Monitor engagement and respond to comments
- Optimize posting schedule based on what gets the most engagement
- Grow the audience strategically

IMPORTANT RULES:
- Don't spam — quality over quantity
- Best times vary by platform (research and adapt)
- Engage authentically with comments — don't be robotic
- Track what content types perform best on each platform
- If a post is doing well, amplify it

Output format: Always respond in valid JSON.`,

  analytics: `You are the ANALYTICS agent of Velbaz Autopilot. You are the data brain.

Your job:
- Track key metrics: followers, engagement rate, website traffic, conversion
- Detect anomalies: sudden drops or spikes
- Identify trends: what content types work best, best posting times
- Report insights to the Strategist for decision-making
- Monitor competitor activity when possible

IMPORTANT RULES:
- Focus on actionable insights, not vanity metrics
- "Likes went up 20%" is useless. "Twitter threads get 3x more engagement than single tweets" is actionable
- Flag critical issues immediately (account suspended, massive traffic drop, etc.)
- Track week-over-week and month-over-month trends
- Correlate actions with outcomes

Output format: Always respond in valid JSON.`,
};

// ─── Logging ────────────────────────────────────────────────────────────────

async function logAction(
  companyId: string,
  agent: AgentName | 'system',
  action: string,
  message: string,
  details?: any,
  taskId?: string,
  tokensUsed?: number,
  level: 'info' | 'warning' | 'error' | 'success' = 'info'
) {
  await db.insert(schema.autopilotLogs).values({
    id: uuidv4(),
    companyId,
    taskId: taskId || null,
    agent,
    action,
    message,
    details: details ? JSON.stringify(details) : null,
    tokensUsed: tokensUsed || 0,
    level,
  });
}

async function createInsight(
  companyId: string,
  category: string,
  title: string,
  description: string,
  severity: 'critical' | 'warning' | 'info' | 'positive' = 'info',
  recommendation?: string
) {
  await db.insert(schema.autopilotInsights).values({
    id: uuidv4(),
    companyId,
    category,
    title,
    description,
    severity,
    recommendation: recommendation || null,
    expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000), // 7 days
  });
}

// ─── Task Management ────────────────────────────────────────────────────────

async function createTask(companyId: string, planId: string | null, task: TaskAction): Promise<string> {
  const id = uuidv4();
  
  // Check if approval mode is on
  const config = await db.select().from(schema.autopilotConfig)
    .where(eq(schema.autopilotConfig.companyId, companyId)).get();
  
  const requiresApproval = config?.approvalMode && 
    ['edit_website', 'create_post', 'engage_comment', 'adjust_strategy'].includes(task.type);

  // Determine the time slot: explicit > derived from scheduledFor > current time
  const timeSlot: TimeSlot = task.timeSlot
    || slotFromDate(task.scheduledFor || new Date());

  // slotOrder = end of the target slot (new tasks go to the bottom of their slot)
  const slotRows = await db.select({ so: schema.autopilotTasks.slotOrder })
    .from(schema.autopilotTasks)
    .where(and(
      eq(schema.autopilotTasks.companyId, companyId),
      eq(schema.autopilotTasks.timeSlot, timeSlot),
    ));
  const nextOrder = slotRows.reduce((m, r) => Math.max(m, (r.so ?? 0) + 1), 0);

  await db.insert(schema.autopilotTasks).values({
    id,
    companyId,
    planId,
    agent: task.agent,
    type: task.type,
    title: task.title,
    description: task.description,
    input: task.input ? JSON.stringify(task.input) : null,
    priority: task.priority || 5,
    scheduledFor: task.scheduledFor || null,
    timeSlot,
    slotOrder: nextOrder,
    hasExactTime: task.hasExactTime || false,
    requiresApproval: requiresApproval || false,
    status: requiresApproval ? 'waiting_approval' : 'pending',
    dependsOn: task.dependsOn || null,
  });

  if (requiresApproval) {
    await logAction(companyId, task.agent, 'task_needs_approval', 
      `Task "${task.title}" needs your approval`, { taskId: id, type: task.type });
  }

  return id;
}

async function getNextTask(companyId: string): Promise<typeof schema.autopilotTasks.$inferSelect | null> {
  const now = new Date();
  
  // Get the highest priority pending task that's ready to run
  const task = await db.select().from(schema.autopilotTasks)
    .where(and(
      eq(schema.autopilotTasks.companyId, companyId),
      eq(schema.autopilotTasks.status, 'pending'),
      or(
        isNull(schema.autopilotTasks.scheduledFor),
        lte(schema.autopilotTasks.scheduledFor, now)
      ),
    ))
    .orderBy(asc(schema.autopilotTasks.priority), asc(schema.autopilotTasks.createdAt))
    .limit(1)
    .get();

  if (!task) return null;

  // Check dependencies
  if (task.dependsOn) {
    const dep = await db.select().from(schema.autopilotTasks)
      .where(eq(schema.autopilotTasks.id, task.dependsOn)).get();
    if (dep && dep.status !== 'completed') return null; // dependency not done yet
  }

  return task;
}

// ─── Agent Calls ────────────────────────────────────────────────────────────

async function callAgent(
  agent: AgentName,
  ctx: AgentContext,
  prompt: string,
  maxTokens = 2000
): Promise<any> {
  const model = _pickModel(agent === 'strategist' ? 'think' : 'default');
  
  // Deduct token
  const tokenResult = await _deductTokens(ctx.userId, 'autopilot_tick', 1);
  if (!tokenResult.ok) {
    await logAction(ctx.company.id, 'system', 'tokens_depleted', 
      'Autopilot paused — no tokens remaining', null, undefined, 0, 'warning');
    throw new Error('NO_TOKENS');
  }

  const systemPrompt = AGENT_PROMPTS[agent] + `\n\nCompany context:
- Name: ${ctx.company.name}
- Industry: ${ctx.company.industry || 'Unknown'}
- Business idea: ${ctx.company.idea || 'Not specified'}
- Current date: ${new Date().toISOString().split('T')[0]}
- Current time (UTC): ${new Date().toISOString().split('T')[1].slice(0, 5)}`;

  try {
    const response = await _callAI(model, systemPrompt, prompt, maxTokens);
    
    await logAction(ctx.company.id, agent, 'ai_call', 
      `${agent} agent thinking...`, { promptLength: prompt.length, model }, undefined, 1);
    
    // Try to parse as JSON
    try {
      const jsonMatch = response.match(/\{[\s\S]*\}/);
      if (jsonMatch) return JSON.parse(jsonMatch[0]);
      const arrMatch = response.match(/\[[\s\S]*\]/);
      if (arrMatch) return JSON.parse(arrMatch[0]);
    } catch {}
    
    return { text: response };
  } catch (e: any) {
    if (e.message === 'NO_TOKENS') throw e;
    await logAction(ctx.company.id, agent, 'ai_error', 
      `${agent} agent error: ${e.message?.slice(0, 200)}`, null, undefined, 0, 'error');
    throw e;
  }
}

// ─── Morning Planning ───────────────────────────────────────────────────────

async function runMorningPlan(ctx: AgentContext): Promise<void> {
  const today = new Date().toISOString().split('T')[0];
  
  // Check if we already have a plan for today
  const existing = await db.select().from(schema.autopilotPlans)
    .where(and(
      eq(schema.autopilotPlans.companyId, ctx.company.id),
      eq(schema.autopilotPlans.date, today),
    )).get();
  
  if (existing) return; // Already planned today

  await logAction(ctx.company.id, 'strategist', 'morning_plan_start', 
    '🌅 Starting morning planning session', null, undefined, 0, 'info');

  // Gather context for the strategist
  const [recentPosts, recentLogs, socialConnections, pages] = await Promise.all([
    db.select().from(schema.socialPosts)
      .where(eq(schema.socialPosts.companyId, ctx.company.id))
      .orderBy(desc(schema.socialPosts.createdAt))
      .limit(10),
    db.select().from(schema.autopilotLogs)
      .where(eq(schema.autopilotLogs.companyId, ctx.company.id))
      .orderBy(desc(schema.autopilotLogs.createdAt))
      .limit(20),
    db.select().from(schema.socialConnections)
      .where(eq(schema.socialConnections.companyId, ctx.company.id)),
    db.select({ slug: schema.websitePages.slug, title: schema.websitePages.title })
      .from(schema.websitePages)
      .where(eq(schema.websitePages.companyId, ctx.company.id)),
  ]);

  // Check yesterday's plan performance
  const yesterday = new Date(Date.now() - 86400000).toISOString().split('T')[0];
  const yesterdayPlan = await db.select().from(schema.autopilotPlans)
    .where(and(
      eq(schema.autopilotPlans.companyId, ctx.company.id),
      eq(schema.autopilotPlans.date, yesterday),
    )).get();

  const connectedPlatforms = socialConnections
    .filter(c => c.isActive)
    .map(c => c.platform);

  const prompt = `It's morning. Time to plan today for ${ctx.company.name}.

COMPANY STATUS:
- Business: ${ctx.company.idea || 'No description'}
- Industry: ${ctx.company.industry || 'Unknown'}
- Connected social platforms: ${connectedPlatforms.length > 0 ? connectedPlatforms.join(', ') : 'NONE — recommend connecting platforms first'}
- Website pages: ${pages.length > 0 ? pages.map(p => p.title || p.slug).join(', ') : 'No website yet'}

RECENT POSTS (last 10):
${recentPosts.length > 0 ? recentPosts.map(p => 
  `- [${p.platform}] ${p.content?.slice(0, 100)} (status: ${p.status}, engagement: ${p.engagements || 0} engagements, ${p.replies || 0} replies, ${p.impressions || 0} impressions)`
).join('\n') : 'No posts yet — this is a fresh start!'}

${yesterdayPlan ? `YESTERDAY'S PLAN:
- Goals: ${yesterdayPlan.goals}
- Completed: ${yesterdayPlan.completedTasks}/${yesterdayPlan.totalTasks} tasks
- Status: ${yesterdayPlan.status}` : 'No previous plan — this is day 1!'}

RECENT ACTIVITY:
${recentLogs.slice(0, 10).map(l => `- [${l.agent}] ${l.message}`).join('\n') || 'No previous activity'}

Create today's plan. Respond with JSON:
{
  "summary": "Brief human-readable summary of today's plan",
  "goals": ["goal1", "goal2", "goal3"],
  "revenueAnalysis": {
    "currentState": "assessment of where the business stands",
    "blocker": "main thing preventing revenue (traffic/conversion/product/none)",
    "recommendation": "what to fix"
  },
  "tasks": [
    {
      "type": "create_post|edit_website|analyze_metrics|engage_comment|create_article|adjust_strategy|send_email|schedule_appointment|improve_app",
      "agent": "content|marketing|analytics|strategist",
      "title": "specific task title",
      "description": "what exactly to do and why",
      "priority": 1-10,
      "slot": "morning|noon|evening (which part of the day this task belongs to)",
      "hour": 6-23 (optional — exact hour to execute, UTC)
    }
  ],
  "waitUntil": "optional — if we should skip some hours and wait for data"
}

IMPORTANT: Spread tasks across the three slots (morning, noon, evening) so the day is balanced. You can create ANY kind of task — send emails, schedule appointments/calls, improve the app, edit the website, create content, analyze metrics, etc.`;

  try {
    const plan = await callAgent('strategist', ctx, prompt, 3000);
    
    // Save the plan
    const planId = uuidv4();
    const tasks = plan.tasks || [];
    
    await db.insert(schema.autopilotPlans).values({
      id: planId,
      companyId: ctx.company.id,
      date: today,
      summary: plan.summary || 'Daily plan created',
      goals: JSON.stringify(plan.goals || []),
      strategy: JSON.stringify({ waitUntil: plan.waitUntil }),
      revenueAnalysis: plan.revenueAnalysis ? JSON.stringify(plan.revenueAnalysis) : null,
      totalTasks: tasks.length,
    });

    // Create tasks from the plan
    for (const task of tasks) {
      const hasExactTime = typeof task.hour === 'number';
      const slot: TimeSlot | undefined =
        task.slot === 'morning' || task.slot === 'noon' || task.slot === 'evening'
          ? task.slot
          : undefined;
      const scheduledFor = hasExactTime
        ? new Date(new Date().setUTCHours(task.hour, 0, 0, 0))
        : slot
          ? new Date(new Date().setHours(slotStartHour(slot), 0, 0, 0))
          : undefined;

      await createTask(ctx.company.id, planId, {
        type: task.type || 'create_post',
        title: task.title || 'Untitled task',
        description: task.description || '',
        agent: (task.agent as AgentName) || 'content',
        priority: task.priority || 5,
        scheduledFor,
        timeSlot: slot,
        hasExactTime,
        input: task,
      });
    }

    // Create revenue insight if analysis found a blocker
    if (plan.revenueAnalysis?.blocker && plan.revenueAnalysis.blocker !== 'none') {
      await createInsight(
        ctx.company.id,
        'revenue',
        `Revenue blocker: ${plan.revenueAnalysis.blocker}`,
        plan.revenueAnalysis.currentState || 'Analysis in progress',
        'warning',
        plan.revenueAnalysis.recommendation
      );
    }

    // Update config
    await db.update(schema.autopilotConfig).set({
      lastMorningPlanAt: new Date(),
      updatedAt: new Date(),
    }).where(eq(schema.autopilotConfig.companyId, ctx.company.id));

    await logAction(ctx.company.id, 'strategist', 'morning_plan_complete',
      `📋 Daily plan ready: ${plan.summary || 'Plan created'}. ${tasks.length} tasks scheduled.`,
      { planId, goals: plan.goals, taskCount: tasks.length }, undefined, 0, 'success');

  } catch (e: any) {
    if (e.message === 'NO_TOKENS') return;
    await logAction(ctx.company.id, 'strategist', 'morning_plan_failed',
      `Morning planning failed: ${e.message?.slice(0, 200)}`, null, undefined, 0, 'error');
  }
}

// ─── Reflect & generate new tasks (when all slots empty / all done) ─────────
async function reflectAndGenerate(ctx: AgentContext): Promise<number> {
  // Count active (visible) tasks — if there are still some, no need to reflect
  const active = await db.select({ c: count() }).from(schema.autopilotTasks)
    .where(and(
      eq(schema.autopilotTasks.companyId, ctx.company.id),
      or(
        eq(schema.autopilotTasks.status, 'pending'),
        eq(schema.autopilotTasks.status, 'waiting_approval'),
        eq(schema.autopilotTasks.status, 'running'),
      ),
    )).get();
  if ((active?.c || 0) > 0) return 0;

  await logAction(ctx.company.id, 'strategist', 'reflect_start',
    '🤔 Réflexion : toutes les tâches sont terminées, génération de nouvelles tâches…', null, undefined, 0, 'info');

  const recentLogs = await db.select().from(schema.autopilotLogs)
    .where(eq(schema.autopilotLogs.companyId, ctx.company.id))
    .orderBy(desc(schema.autopilotLogs.createdAt)).limit(15);

  const prompt = `All current tasks for ${ctx.company.name} are done. Reflect on what to do next and create a fresh batch of tasks.

Company: ${ctx.company.idea || ctx.company.name}
Industry: ${ctx.company.industry || 'Unknown'}

RECENT ACTIVITY:
${recentLogs.map(l => `- [${l.agent}] ${l.message}`).join('\n') || 'No previous activity'}

Create 3 to 6 new tasks spread across the three slots (morning, noon, evening). You can create ANY kind of task: send emails, schedule appointments/calls, improve the app, edit the website, create content/posts, analyze metrics, etc.

Respond with JSON:
{
  "tasks": [
    {
      "type": "create_post|edit_website|analyze_metrics|engage_comment|create_article|adjust_strategy|send_email|schedule_appointment|improve_app",
      "agent": "content|marketing|analytics|strategist",
      "title": "specific task title",
      "description": "what exactly to do and why",
      "priority": 1-10,
      "slot": "morning|noon|evening",
      "hour": 6-23 (optional exact hour, UTC)
    }
  ]
}`;

  try {
    const result = await callAgent('strategist', ctx, prompt, 3000);
    const tasks = result.tasks || [];
    const today = new Date().toISOString().split('T')[0];
    const plan = await db.select().from(schema.autopilotPlans)
      .where(and(eq(schema.autopilotPlans.companyId, ctx.company.id), eq(schema.autopilotPlans.date, today))).get();

    for (const task of tasks) {
      const hasExactTime = typeof task.hour === 'number';
      const slot: TimeSlot | undefined =
        task.slot === 'morning' || task.slot === 'noon' || task.slot === 'evening' ? task.slot : undefined;
      const scheduledFor = hasExactTime
        ? new Date(new Date().setUTCHours(task.hour, 0, 0, 0))
        : slot ? new Date(new Date().setHours(slotStartHour(slot), 0, 0, 0)) : undefined;
      await createTask(ctx.company.id, plan?.id || null, {
        type: task.type || 'create_post',
        title: task.title || 'Untitled task',
        description: task.description || '',
        agent: (task.agent as AgentName) || 'content',
        priority: task.priority || 5,
        scheduledFor,
        timeSlot: slot,
        hasExactTime,
        input: task,
      });
    }
    await logAction(ctx.company.id, 'strategist', 'reflect_complete',
      `✨ ${tasks.length} nouvelles tâches générées.`, { count: tasks.length }, undefined, 0, 'success');
    return tasks.length;
  } catch (e: any) {
    if (e.message === 'NO_TOKENS') return 0;
    await logAction(ctx.company.id, 'strategist', 'reflect_failed',
      `Réflexion échouée: ${e.message?.slice(0, 200)}`, null, undefined, 0, 'error');
    return 0;
  }
}

// Public wrapper for the API "reflect now" endpoint
export async function triggerReflect(companyId: string): Promise<{ created: number }> {
  const company = await db.select().from(schema.companies)
    .where(eq(schema.companies.id, companyId)).get();
  if (!company) return { created: 0 };
  const config = await db.select().from(schema.autopilotConfig)
    .where(eq(schema.autopilotConfig.companyId, companyId)).get();
  if (!config) return { created: 0 };
  const ctx: AgentContext = { company, config, plan: null, userId: company.userId };
  const created = await reflectAndGenerate(ctx);
  return { created };
}

// ─── Task Executors ─────────────────────────────────────────────────────────

async function executeTask(task: typeof schema.autopilotTasks.$inferSelect, ctx: AgentContext): Promise<void> {
  // Mark as running
  await db.update(schema.autopilotTasks).set({ 
    status: 'running', startedAt: new Date() 
  }).where(eq(schema.autopilotTasks.id, task.id));

  await logAction(ctx.company.id, task.agent as AgentName, 'task_start',
    `⚡ Running: ${task.title}`, { taskId: task.id, type: task.type }, task.id);

  try {
    let output: any;

    switch (task.type) {
      case 'create_post':
        output = await executeCreatePost(task, ctx);
        break;
      case 'edit_website':
        output = await executeEditWebsite(task, ctx);
        break;
      case 'analyze_metrics':
        output = await executeAnalyzeMetrics(task, ctx);
        break;
      case 'engage_comment':
        output = await executeEngageComment(task, ctx);
        break;
      case 'create_article':
        output = await executeCreateArticle(task, ctx);
        break;
      case 'adjust_strategy':
        output = await executeAdjustStrategy(task, ctx);
        break;
      case 'send_email':
        output = await executeSendEmail(task, ctx);
        break;
      case 'schedule_appointment':
        output = await executeScheduleAppointment(task, ctx);
        break;
      case 'improve_app':
        output = await executeImproveApp(task, ctx);
        break;
      default:
        output = { skipped: true, reason: `Unknown task type: ${task.type}` };
    }

    // [2026-09-13] Un exécuteur qui ne lève pas d'exception n'a pas forcément
    // réussi : `executeCreatePost` renvoie `posted: false` quand la plateforme
    // a refusé le post. On affichait quand même « ✅ Completed », donc l'IA
    // annonçait un envoi qui n'avait jamais eu lieu. Le résultat est désormais
    // lu avant de conclure.
    const declaredFailure =
      output && typeof output === 'object' &&
      (output.posted === false || output.published === false || Boolean(output.error));
    const declaredSkip = Boolean(output && typeof output === 'object' && output.skipped);
    const failureReason = output?.error || output?.reason || 'la plateforme n\'a pas confirmé';

    await db.update(schema.autopilotTasks).set({
      status: declaredFailure ? 'failed' : 'completed',
      output: JSON.stringify(output),
      error: declaredFailure ? String(failureReason).slice(0, 500) : null,
      completedAt: new Date(),
    }).where(eq(schema.autopilotTasks.id, task.id));

    // Update plan task count — une tâche ratée ne compte pas comme faite.
    if (task.planId && !declaredFailure) {
      await db.update(schema.autopilotPlans).set({
        completedTasks: sql`completed_tasks + 1`,
      }).where(eq(schema.autopilotPlans.id, task.planId));
    }

    if (declaredFailure) {
      await logAction(ctx.company.id, task.agent as AgentName, 'task_failed',
        `❌ Échec : ${task.title} — ${String(failureReason).slice(0, 200)}`,
        { taskId: task.id, output }, task.id, 0, 'error');
    } else if (declaredSkip) {
      await logAction(ctx.company.id, task.agent as AgentName, 'task_complete',
        `⏭️ Ignoré : ${task.title} — ${String(output.reason || 'rien à faire').slice(0, 200)}`,
        { taskId: task.id, output }, task.id, 0, 'success');
    } else {
      await logAction(ctx.company.id, task.agent as AgentName, 'task_complete',
        `✅ Completed: ${task.title}`, { taskId: task.id, output }, task.id, 0, 'success');
    }

  } catch (e: any) {
    if (e.message === 'NO_TOKENS') {
      // Revert to pending so it can retry when tokens are available
      await db.update(schema.autopilotTasks).set({ status: 'pending' })
        .where(eq(schema.autopilotTasks.id, task.id));
      return;
    }

    await db.update(schema.autopilotTasks).set({
      status: 'failed',
      error: e.message?.slice(0, 500),
      completedAt: new Date(),
    }).where(eq(schema.autopilotTasks.id, task.id));

    await logAction(ctx.company.id, task.agent as AgentName, 'task_failed',
      `❌ Failed: ${task.title} — ${e.message?.slice(0, 200)}`, null, task.id, 0, 'error');
  }
}

// ─── Task Type Executors ────────────────────────────────────────────────────

async function executeCreatePost(task: typeof schema.autopilotTasks.$inferSelect, ctx: AgentContext): Promise<any> {
  const input = task.input ? JSON.parse(task.input) : {};
  
  // Ask Content agent to write the post
  const contentPrompt = `Create a social media post for ${ctx.company.name}.

Task: ${task.description}
${input.platform ? `Platform: ${input.platform}` : 'Choose the best platform'}
${input.topic ? `Topic: ${input.topic}` : ''}

Company: ${ctx.company.idea || ctx.company.name}
Industry: ${ctx.company.industry || 'General'}

Respond with JSON:
{
  "content": "the post text (platform-appropriate length)",
  "platform": "twitter|linkedin|instagram|facebook",
  "hashtags": ["tag1", "tag2"],
  "imagePrompt": "description for AI image generation (or null if text-only)",
  "callToAction": "what the reader should do",
  "hook": "the attention-grabbing first line"
}`;

  const postPlan = await callAgent('content', ctx, contentPrompt, 1500);
  
  // Use the existing content pipeline to actually create and post
  const platform = postPlan.platform || input.platform || 'twitter';
  
  // Check if platform is connected
  const connection = await db.select().from(schema.socialConnections)
    .where(and(
      eq(schema.socialConnections.companyId, ctx.company.id),
      eq(schema.socialConnections.platform, platform),
      eq(schema.socialConnections.isActive, 1),
    )).get();

  if (!connection) {
    await createInsight(ctx.company.id, 'content', 
      `Can't post to ${platform}`, 
      `${platform} is not connected. Connect it in Social settings to enable posting.`,
      'warning',
      `Go to Social settings and connect ${platform}`);
    return { skipped: true, reason: `${platform} not connected` };
  }

  // Run through existing pipeline
  try {
    // `companyName` / `companyIdea` sont OBLIGATOIRES : le pipeline les injecte
    // dans chaque prompt IA (« un post publié par ${companyName} »). Sans eux
    // l'IA écrivait littéralement « undefined » à la place du nom de la boîte.
    const result = await runContentPipeline({
      companyId: ctx.company.id,
      companyName: ctx.company.name,
      companyIdea: ctx.company.idea || '',
      soulMd: ctx.company.soulMd || undefined,
      platform,
      customPrompt: postPlan.content || task.description,
    });
    // [2026-09-13] BUG CORRIGÉ : on renvoyait `posted: true` dès que le
    // pipeline ne levait pas d'exception. Or `runContentPipeline` attrape
    // l'échec de publication en interne et le remonte dans `published` /
    // `publishError` — l'autopilote annonçait donc « posté » alors que X
    // avait refusé (402 credits depleted, 401, 429…). On se fie maintenant
    // uniquement à la confirmation de la plateforme.
    const reallyPublished = result.published === true;
    if (!reallyPublished) {
      await createInsight(
        ctx.company.id,
        'content',
        `Post ${platform} NON publié`,
        result.publishError || `${platform} n'a pas confirmé la publication — le texte est enregistré mais rien n'est parti.`,
        'warning',
        result.publishFixUrl
          ? `Débloque le compte ici : ${result.publishFixUrl}, puis relance la publication.`
          : `Corrige la cause ci-dessus puis relance la publication.`,
      );
      return {
        posted: false,
        platform,
        postId: result.postId,
        status: result.status,
        error: result.publishError || 'Publication non confirmée par la plateforme',
        errorCode: result.publishErrorCode,
        content: result.content,
      };
    }
    return {
      posted: true,
      platform,
      postId: result.postId,
      status: result.status,
      url: result.platformPostUrl,
    };
  } catch (e: any) {
    return { posted: false, error: e.message, content: postPlan.content };
  }
}

async function executeEditWebsite(task: typeof schema.autopilotTasks.$inferSelect, ctx: AgentContext): Promise<any> {
  const input = task.input ? JSON.parse(task.input) : {};
  
  // Ask Strategist what to change
  const editPrompt = `You need to edit the website for ${ctx.company.name}.

Task: ${task.description}

What specific changes should be made? Respond with JSON:
{
  "page": "which page to edit (home, about, etc.)",
  "changes": ["specific change 1", "specific change 2"],
  "reasoning": "why these changes will improve the business",
  "newContent": "any new text content to add"
}`;

  const editPlan = await callAgent('strategist', ctx, editPrompt, 1500);
  
  // For now, log the recommendation. Full website editing integration comes in Step 6
  await createInsight(ctx.company.id, 'content',
    `Website improvement: ${editPlan.page || 'homepage'}`,
    editPlan.changes?.join('; ') || task.description,
    'info',
    editPlan.reasoning
  );

  return { planned: true, changes: editPlan.changes, page: editPlan.page };
}

async function executeAnalyzeMetrics(task: typeof schema.autopilotTasks.$inferSelect, ctx: AgentContext): Promise<any> {
  // Gather all available data
  const [posts, connections] = await Promise.all([
    db.select().from(schema.socialPosts)
      .where(eq(schema.socialPosts.companyId, ctx.company.id))
      .orderBy(desc(schema.socialPosts.createdAt))
      .limit(30),
    db.select().from(schema.socialConnections)
      .where(eq(schema.socialConnections.companyId, ctx.company.id)),
  ]);

  // La table social_posts n'a pas de colonnes `likes`/`comments` : les vraies
  // colonnes sont `engagements`, `replies`, `impressions` et `clicks`. On lisait
  // donc `undefined` partout et l'analyse IA tournait sur des zéros.
  const totalEngagements = posts.reduce((sum, p) => sum + (p.engagements || 0), 0);
  const totalReplies = posts.reduce((sum, p) => sum + (p.replies || 0), 0);
  const totalImpressions = posts.reduce((sum, p) => sum + (p.impressions || 0), 0);
  const publishedPosts = posts.filter(p => p.status === 'published');
  const avgEngagement = publishedPosts.length > 0
    ? (totalEngagements + totalReplies) / publishedPosts.length
    : 0;

  const analyticsPrompt = `Analyze the performance data for ${ctx.company.name}.

DATA:
- Total posts: ${posts.length} (${publishedPosts.length} published)
- Total engagements: ${totalEngagements}
- Total replies: ${totalReplies}
- Total impressions: ${totalImpressions}
- Average engagement per post: ${avgEngagement.toFixed(1)}
- Connected platforms: ${connections.map(c => `${c.platform} (${c.isActive ? 'active' : 'inactive'})`).join(', ') || 'none'}

RECENT POSTS:
${publishedPosts.slice(0, 10).map(p => 
  `- [${p.platform}] "${p.content?.slice(0, 80)}" — ${p.engagements || 0} engagements, ${p.replies || 0} replies`
).join('\n') || 'No published posts yet'}

Provide analysis. Respond with JSON:
{
  "summary": "brief overview of performance",
  "insights": [
    {"title": "insight title", "description": "detail", "severity": "positive|info|warning|critical", "category": "content|audience|traffic|revenue", "recommendation": "the single concrete action to take for this insight"}
  ],
  "recommendations": ["actionable rec 1", "actionable rec 2"],
  "bestPerforming": "what type of content works best",
  "worstPerforming": "what to stop doing"
}`;

  const analysis = await callAgent('analytics', ctx, analyticsPrompt, 2000);

  // Save insights
  if (analysis.insights) {
    for (const insight of analysis.insights.slice(0, 5)) {
      await createInsight(
        ctx.company.id,
        insight.category || 'content',
        insight.title,
        insight.description,
        insight.severity || 'info',
        insight.recommendation || undefined
      );
    }
  }

  return analysis;
}

async function executeEngageComment(task: typeof schema.autopilotTasks.$inferSelect, ctx: AgentContext): Promise<any> {
  // Placeholder — requires social API integration
  return { skipped: true, reason: 'Comment engagement not yet integrated' };
}

async function executeCreateArticle(task: typeof schema.autopilotTasks.$inferSelect, ctx: AgentContext): Promise<any> {
  const input = task.input ? JSON.parse(task.input) : {};
  
  const articlePrompt = `Write a blog article for ${ctx.company.name}.

Task: ${task.description}
${input.topic ? `Topic: ${input.topic}` : ''}

Company: ${ctx.company.idea || ctx.company.name}
Industry: ${ctx.company.industry || 'General'}

Write a complete, engaging article (600-1000 words). Respond with JSON:
{
  "title": "article title",
  "content": "full article in markdown",
  "metaDescription": "SEO meta description (160 chars)",
  "tags": ["tag1", "tag2"]
}`;

  const article = await callAgent('content', ctx, articlePrompt, 4000);
  
  // Store as a document
  if (article.title && article.content) {
    await db.insert(schema.documents).values({
      id: uuidv4(),
      companyId: ctx.company.id,
      title: article.title,
      content: article.content,
      type: 'blog',
    });
  }

  return article;
}

async function executeAdjustStrategy(task: typeof schema.autopilotTasks.$inferSelect, ctx: AgentContext): Promise<any> {
  const input = task.input ? JSON.parse(task.input) : {};
  
  // Get recent insights
  const insights = await db.select().from(schema.autopilotInsights)
    .where(eq(schema.autopilotInsights.companyId, ctx.company.id))
    .orderBy(desc(schema.autopilotInsights.createdAt))
    .limit(10);

  const strategyPrompt = `Review and adjust strategy for ${ctx.company.name}.

Task: ${task.description}

CURRENT INSIGHTS:
${insights.map(i => `- [${i.severity}] ${i.title}: ${i.description}`).join('\n') || 'No insights yet'}

What strategic adjustments should be made? Respond with JSON:
{
  "assessment": "current situation assessment",
  "adjustments": ["adjustment 1", "adjustment 2"],
  "newPriorities": ["priority 1", "priority 2"],
  "reasoning": "why these changes"
}`;

  const strategy = await callAgent('strategist', ctx, strategyPrompt, 2000);
  
  await createInsight(ctx.company.id, 'revenue',
    'Strategy adjustment',
    strategy.assessment || 'Strategy reviewed',
    'info',
    strategy.adjustments?.join('; ') || null
  );

  return strategy;
}

// ─── Main Tick (runs every hour) ────────────────────────────────────────────

async function executeSendEmail(task: typeof schema.autopilotTasks.$inferSelect, ctx: AgentContext): Promise<any> {
  const input = task.input ? JSON.parse(task.input) : {};

  // Draft the email with the content agent
  const draftPrompt = `Draft an email for ${ctx.company.name}.

Task: ${task.description}
${input.to ? `Recipient: ${input.to}` : ''}

Company: ${ctx.company.idea || ctx.company.name}
Industry: ${ctx.company.industry || 'General'}

Respond with JSON:
{
  "to": "recipient email (use the one provided, or the company owner if none)",
  "subject": "email subject",
  "html": "email body as simple HTML"
}`;

  const draft = await callAgent('content', ctx, draftPrompt, 2000);
  // Fall back to the company owner's email if no recipient was specified
  let ownerEmail: string | null = null;
  if (!input.to && !draft.to) {
    const owner = await db.select({ email: schema.users.email })
      .from(schema.users).where(eq(schema.users.id, ctx.company.userId)).get();
    ownerEmail = owner?.email || null;
  }
  const to = input.to || draft.to || ownerEmail || null;

  if (!to) {
    return { skipped: true, reason: 'No recipient email available', draft };
  }

  if (!isEmailConfigured()) {
    // Dry-run: keep the draft so the user can review/send later
    return { drafted: true, sent: false, reason: 'Email provider not configured (dry-run)', to, subject: draft.subject };
  }

  const res = await sendEmail({ to, subject: draft.subject || 'Message', html: draft.html || draft.text || '' });
  return { sent: res.ok, id: res.id, error: res.error, to, subject: draft.subject };
}

async function executeScheduleAppointment(task: typeof schema.autopilotTasks.$inferSelect, ctx: AgentContext): Promise<any> {
  // A scheduled appointment/reminder is primarily a dated task that lives in a slot.
  // Executing it = confirming the appointment and logging it. The scheduling itself
  // happens at creation time (scheduledFor + timeSlot).
  const when = task.scheduledFor ? new Date(task.scheduledFor) : null;
  await logAction(ctx.company.id, 'strategist', 'appointment',
    `📅 Rendez-vous: ${task.title}${when ? ` — ${when.toLocaleString('fr-FR')}` : ''}`,
    { taskId: task.id, scheduledFor: when?.toISOString() }, task.id, 0, 'info');
  return { scheduled: true, when: when?.toISOString() || null, title: task.title };
}

async function executeImproveApp(task: typeof schema.autopilotTasks.$inferSelect, ctx: AgentContext): Promise<any> {
  // Ask the strategist to produce a concrete improvement proposal for the app.
  const prompt = `Propose a concrete improvement for ${ctx.company.name}'s app/website.

Task: ${task.description}
Company: ${ctx.company.idea || ctx.company.name}

Respond with JSON:
{
  "area": "what part of the app to improve",
  "change": "the specific change to make",
  "impact": "expected impact",
  "priority": 1-10
}`;
  const proposal = await callAgent('strategist', ctx, prompt, 2000);
  await createInsight(
    ctx.company.id,
    'product',
    `App improvement: ${proposal.area || task.title}`,
    proposal.change || task.description || '',
    'info',
    proposal.impact || null,
  );
  return proposal;
}

function tick(companyId: string): Promise<void> {
  // Étiquette les appels IA du tick autopilot (suivi des crédits, ai-usage/).
  return runWithAiContext({ feature: "autopilot", companyId, runId: newRunId() }, () => tickInner(companyId));
}

async function tickInner(companyId: string): Promise<void> {
  const config = await db.select().from(schema.autopilotConfig)
    .where(eq(schema.autopilotConfig.companyId, companyId)).get();
  
  if (!config?.enabled) return;

  const company = await db.select().from(schema.companies)
    .where(eq(schema.companies.id, companyId)).get();
  if (!company) return;

  const currentHour = new Date().getUTCHours();
  
  // Check work hours
  if (currentHour < config.workStartHour || currentHour > config.workEndHour) {
    return; // Outside work hours
  }

  const ctx: AgentContext = {
    company,
    config,
    plan: null,
    userId: company.userId,
  };

  // Morning plan (first tick of the day, or if no plan exists)
  const today = new Date().toISOString().split('T')[0];
  const todayPlan = await db.select().from(schema.autopilotPlans)
    .where(and(
      eq(schema.autopilotPlans.companyId, companyId),
      eq(schema.autopilotPlans.date, today),
    )).get();

  // ── Calendrier interne : matérialiser les événements dont la date est arrivée ──
  // Crée automatiquement une tâche pour chaque échéance atteinte, avec gestion
  // des conflits (une tâche = une date ; décalage auto sauf rdv client/deadline).
  try {
    const mat = await materializeDueEvents(companyId, createTaskFromCalendar);
    if (mat.created > 0) {
      await logAction(companyId, 'strategist', 'calendar_materialized',
        `🗓️ ${mat.created} échéance(s) du calendrier transformée(s) en tâche(s).`,
        { created: mat.created, conflicts: mat.conflicts }, undefined, 0, 'info');
    }
    for (const cf of mat.conflicts) {
      await logAction(companyId, 'strategist', 'calendar_conflict', cf, null, undefined, 0, 'warning');
    }
  } catch (e: any) {
    console.error(`[Autopilot] calendar materialize failed for ${companyId}:`, e?.message);
  }

  if (!todayPlan) {
    await runMorningPlan(ctx);
    // After planning, get the fresh plan
    ctx.plan = await db.select().from(schema.autopilotPlans)
      .where(and(
        eq(schema.autopilotPlans.companyId, companyId),
        eq(schema.autopilotPlans.date, today),
      )).get() || null;
  } else {
    ctx.plan = todayPlan;
  }

  // Check daily limits
  const todayStart = new Date(today + 'T00:00:00Z');
  const todayPostCount = await db.select({ count: count() }).from(schema.autopilotTasks)
    .where(and(
      eq(schema.autopilotTasks.companyId, companyId),
      eq(schema.autopilotTasks.type, 'create_post'),
      eq(schema.autopilotTasks.status, 'completed'),
    )).get();

  const postsToday = todayPostCount?.count || 0;
  if (postsToday >= config.maxPostsPerDay) {
    await logAction(companyId, 'system', 'limit_reached', 
      `Daily post limit reached (${postsToday}/${config.maxPostsPerDay}). Skipping post tasks.`);
  }

  // Execute next available task
  const nextTask = await getNextTask(companyId);
  if (nextTask) {
    // Skip post tasks if at limit
    if (nextTask.type === 'create_post' && postsToday >= config.maxPostsPerDay) {
      await db.update(schema.autopilotTasks).set({ status: 'cancelled' })
        .where(eq(schema.autopilotTasks.id, nextTask.id));
    } else {
      await executeTask(nextTask, ctx);
    }
  } else {
    // No tasks left — reflect and generate a fresh batch across the 3 slots
    const created = await reflectAndGenerate(ctx);
    if (created === 0) {
      await logAction(companyId, 'system', 'idle',
        `No tasks to run this hour. Waiting.`);
    }
  }

  // Update last tick
  await db.update(schema.autopilotConfig).set({
    lastTickAt: new Date(),
    updatedAt: new Date(),
  }).where(eq(schema.autopilotConfig.companyId, companyId));
}

// ─── Scheduler ──────────────────────────────────────────────────────────────

let tickInterval: ReturnType<typeof setInterval> | null = null;

export function startAutopilotScheduler() {
  if (tickInterval) return;
  
  console.log('[Autopilot] Scheduler started — ticking every 30 minutes');
  
  // Tick every 30 minutes
  tickInterval = setInterval(async () => {
    try {
      // Get all enabled companies
      const configs = await db.select().from(schema.autopilotConfig)
        .where(eq(schema.autopilotConfig.enabled, true));
      
      for (const config of configs) {
        try {
          await tick(config.companyId);
        } catch (e: any) {
          console.error(`[Autopilot] Tick failed for company ${config.companyId}:`, e.message);
        }
      }
    } catch (e: any) {
      console.error('[Autopilot] Scheduler error:', e.message);
    }
  }, 30 * 60 * 1000); // 30 minutes

  // Startup catch-up tick après 5s. Ne tick QUE les companies dont le dernier
  // tick remonte à > ~25 min — évite le double-tick / spam quand le serveur
  // redémarre fréquemment (crash-loop, redéploiement). Rattrape les ticks manqués
  // pendant que le serveur était down (durabilité du scheduler in-process).
  setTimeout(async () => {
    const configs = await db.select().from(schema.autopilotConfig)
      .where(eq(schema.autopilotConfig.enabled, true));
    const now = Date.now();
    const MIN_GAP_MS = 25 * 60 * 1000;
    for (const config of configs) {
      const last = config.lastTickAt ? new Date(config.lastTickAt).getTime() : 0;
      if (now - last < MIN_GAP_MS) {
        console.log(`[Autopilot] skip startup tick for ${config.companyId} — last tick ${Math.round((now - last) / 60000)}min ago`);
        continue;
      }
      try { await tick(config.companyId); } catch {}
    }
  }, 5000);
}

export function stopAutopilotScheduler() {
  if (tickInterval) {
    clearInterval(tickInterval);
    tickInterval = null;
    console.log('[Autopilot] Scheduler stopped');
  }
}

// ─── Manual trigger (for API) ───────────────────────────────────────────────

export async function triggerTick(companyId: string): Promise<void> {
  await tick(companyId);
}

export async function enableAutopilot(companyId: string): Promise<void> {
  const existing = await db.select().from(schema.autopilotConfig)
    .where(eq(schema.autopilotConfig.companyId, companyId)).get();
  
  if (existing) {
    await db.update(schema.autopilotConfig).set({ 
      enabled: true, updatedAt: new Date() 
    }).where(eq(schema.autopilotConfig.companyId, companyId));
  } else {
    await db.insert(schema.autopilotConfig).values({
      id: uuidv4(),
      companyId,
      enabled: true,
    });
  }

  await logAction(companyId, 'system', 'enabled', '🚀 Autopilot enabled! AI team is now active.');
  
  // Trigger immediate tick
  setTimeout(() => tick(companyId).catch(() => {}), 2000);
}

export async function disableAutopilot(companyId: string): Promise<void> {
  await db.update(schema.autopilotConfig).set({ 
    enabled: false, updatedAt: new Date() 
  }).where(eq(schema.autopilotConfig.companyId, companyId));

  // Cancel pending tasks
  await db.update(schema.autopilotTasks).set({ status: 'cancelled' })
    .where(and(
      eq(schema.autopilotTasks.companyId, companyId),
      or(
        eq(schema.autopilotTasks.status, 'pending'),
        eq(schema.autopilotTasks.status, 'waiting_approval'),
      ),
    ));

  await logAction(companyId, 'system', 'disabled', '⏸️ Autopilot disabled. AI team is paused.');
}

export async function setApprovalMode(companyId: string, enabled: boolean): Promise<void> {
  await db.update(schema.autopilotConfig).set({ 
    approvalMode: enabled, updatedAt: new Date() 
  }).where(eq(schema.autopilotConfig.companyId, companyId));

  await logAction(companyId, 'system', 'approval_mode', 
    enabled ? '🔒 Approval mode ON — AI will ask before acting' : '🔓 Approval mode OFF — AI acts autonomously');
}

export async function approveTask(taskId: string, userId: string): Promise<void> {
  await db.update(schema.autopilotTasks).set({ 
    status: 'pending', 
    approvedAt: new Date(), 
    approvedBy: userId 
  }).where(eq(schema.autopilotTasks.id, taskId));
}

export async function rejectTask(taskId: string, reason?: string): Promise<void> {
  await db.update(schema.autopilotTasks).set({ 
    status: 'rejected', 
    rejectedAt: new Date(), 
    rejectionReason: reason || null 
  }).where(eq(schema.autopilotTasks.id, taskId));
}

// ─── Query helpers ──────────────────────────────────────────────────────────

export async function getAutopilotStatus(companyId: string) {
  // [2026-09-10] Statut d'autopilot = route pollée en boucle par l'UI. Une
  // simple coupure réseau Turso ("Failed query") la faisait répondre 500 et
  // l'onglet Autopilot affichait une erreur. Chaque lecture passe désormais par
  // dbRetry (backoff court sur erreurs transitoires uniquement).
  const config = await dbRetry(() => db.select().from(schema.autopilotConfig)
    .where(eq(schema.autopilotConfig.companyId, companyId)).get());
  
  const today = new Date().toISOString().split('T')[0];
  const plan = await dbRetry(() => db.select().from(schema.autopilotPlans)
    .where(and(
      eq(schema.autopilotPlans.companyId, companyId),
      eq(schema.autopilotPlans.date, today),
    )).get());

  const pendingTasks = await dbRetry(() => db.select({ count: count() }).from(schema.autopilotTasks)
    .where(and(
      eq(schema.autopilotTasks.companyId, companyId),
      eq(schema.autopilotTasks.status, 'pending'),
    )).get());

  const awaitingApproval = await dbRetry(() => db.select({ count: count() }).from(schema.autopilotTasks)
    .where(and(
      eq(schema.autopilotTasks.companyId, companyId),
      eq(schema.autopilotTasks.status, 'waiting_approval'),
    )).get());

  // Check if AI is CURRENTLY running a task
  const runningTask = await dbRetry(() => db.select().from(schema.autopilotTasks)
    .where(and(
      eq(schema.autopilotTasks.companyId, companyId),
      eq(schema.autopilotTasks.status, 'running'),
    ))
    .orderBy(desc(schema.autopilotTasks.startedAt))
    .limit(1)
    .get());

  const recentLogs = await dbRetry(() => db.select().from(schema.autopilotLogs)
    .where(eq(schema.autopilotLogs.companyId, companyId))
    .orderBy(desc(schema.autopilotLogs.createdAt))
    .limit(10));

  // Count completed tasks today
  // [2026-09-10] Le filtre de date manquait : « terminées aujourd'hui »
  // affichait en réalité TOUTES les tâches terminées depuis la création de
  // l'entreprise, un compteur qui ne redescendait jamais.
  const startOfToday = new Date();
  startOfToday.setHours(0, 0, 0, 0);
  const completedToday = await dbRetry(() => db.select({ count: count() }).from(schema.autopilotTasks)
    .where(and(
      eq(schema.autopilotTasks.companyId, companyId),
      eq(schema.autopilotTasks.status, 'completed'),
      gte(schema.autopilotTasks.completedAt, startOfToday),
    )).get());

  return {
    enabled: config?.enabled || false,
    approvalMode: config?.approvalMode || false,
    lastTick: config?.lastTickAt,
    lastMorningPlan: config?.lastMorningPlanAt,
    isWorking: !!runningTask,
    currentTask: runningTask ? {
      id: runningTask.id,
      title: runningTask.title,
      agent: runningTask.agent,
      type: runningTask.type,
      startedAt: runningTask.startedAt,
    } : null,
    completedToday: completedToday?.count || 0,
    todayPlan: plan ? {
      summary: plan.summary,
      goals: JSON.parse(plan.goals || '[]'),
      progress: `${plan.completedTasks}/${plan.totalTasks}`,
    } : null,
    pendingTasks: pendingTasks?.count || 0,
    awaitingApproval: awaitingApproval?.count || 0,
    recentActivity: recentLogs.map(l => ({
      agent: l.agent,
      action: l.action,
      message: l.message,
      level: l.level,
      time: l.createdAt,
    })),
    config: config ? {
      workStartHour: config.workStartHour,
      workEndHour: config.workEndHour,
      maxPostsPerDay: config.maxPostsPerDay,
      maxWebsiteEditsPerDay: config.maxWebsiteEditsPerDay,
    } : null,
  };
}

// Get activity summary since a given timestamp (for "while you were away")
export async function getAutopilotActivitySince(companyId: string, since: Date) {
  const logs = await db.select().from(schema.autopilotLogs)
    .where(and(
      eq(schema.autopilotLogs.companyId, companyId),
      sql`${schema.autopilotLogs.createdAt} > ${since}`,
    ))
    .orderBy(desc(schema.autopilotLogs.createdAt))
    .limit(100);

  const completedTasks = await db.select().from(schema.autopilotTasks)
    .where(and(
      eq(schema.autopilotTasks.companyId, companyId),
      eq(schema.autopilotTasks.status, 'completed'),
      sql`${schema.autopilotTasks.completedAt} > ${since}`,
    ))
    .orderBy(desc(schema.autopilotTasks.completedAt));

  const newInsights = await db.select().from(schema.autopilotInsights)
    .where(and(
      eq(schema.autopilotInsights.companyId, companyId),
      sql`${schema.autopilotInsights.createdAt} > ${since}`,
    ))
    .orderBy(desc(schema.autopilotInsights.createdAt));

  // Group actions by agent
  const agentSummary: Record<string, number> = {};
  for (const l of logs) {
    agentSummary[l.agent] = (agentSummary[l.agent] || 0) + 1;
  }

  return {
    totalActions: logs.length,
    completedTasks: completedTasks.map(t => ({
      id: t.id, title: t.title, agent: t.agent, type: t.type, completedAt: t.completedAt,
    })),
    newInsights: newInsights.map(i => ({
      id: i.id, title: i.title, severity: i.severity, category: i.category,
    })),
    agentSummary,
    logs: logs.slice(0, 20).map(l => ({
      agent: l.agent, action: l.action, message: l.message, level: l.level, time: l.createdAt,
    })),
  };
}

export async function getAutopilotLogs(companyId: string, limit = 50, offset = 0) {
  return db.select().from(schema.autopilotLogs)
    .where(eq(schema.autopilotLogs.companyId, companyId))
    .orderBy(desc(schema.autopilotLogs.createdAt))
    .limit(limit)
    .offset(offset);
}

export async function getAutopilotInsights(companyId: string) {
  return db.select().from(schema.autopilotInsights)
    .where(and(
      eq(schema.autopilotInsights.companyId, companyId),
      or(
        eq(schema.autopilotInsights.status, 'new'),
        eq(schema.autopilotInsights.status, 'acknowledged'),
      ),
    ))
    .orderBy(desc(schema.autopilotInsights.createdAt))
    .limit(20);
}

export async function getAutopilotTasks(companyId: string, status?: string) {
  const conditions = [eq(schema.autopilotTasks.companyId, companyId)];
  if (status) conditions.push(eq(schema.autopilotTasks.status, status));
  
  return db.select().from(schema.autopilotTasks)
    .where(and(...conditions))
    .orderBy(desc(schema.autopilotTasks.createdAt))
    .limit(50);
}

// ─── Build-page scheduler helpers (grouped by slot) ─────────────────────────

const ACTIVE_STATUSES = ['pending', 'waiting_approval', 'running'] as const;

// Return only the active/visible tasks grouped into the 3 slots, ordered so the
// soonest task is at the top of each slot.
export async function getAutopilotSlots(companyId: string) {
  const rows = await db.select().from(schema.autopilotTasks)
    .where(and(
      eq(schema.autopilotTasks.companyId, companyId),
      or(...ACTIVE_STATUSES.map(s => eq(schema.autopilotTasks.status, s))),
    ))
    .orderBy(asc(schema.autopilotTasks.slotOrder), asc(schema.autopilotTasks.createdAt));

  const slots: Record<TimeSlot, typeof rows> = { morning: [], noon: [], evening: [] };
  for (const r of rows) {
    const slot = (r.timeSlot as TimeSlot) || slotFromDate(r.scheduledFor ? new Date(r.scheduledFor) : new Date());
    (slots[slot] ||= []).push(r);
  }
  return slots;
}

// Move / reorder a task into a slot at a given position
export async function moveAutopilotTask(companyId: string, taskId: string, timeSlot: TimeSlot, slotOrder: number) {
  await db.update(schema.autopilotTasks)
    .set({ timeSlot, slotOrder })
    .where(and(eq(schema.autopilotTasks.id, taskId), eq(schema.autopilotTasks.companyId, companyId)));

  // Re-normalise the ordering within the target slot so positions stay stable
  const rows = await db.select({ id: schema.autopilotTasks.id }).from(schema.autopilotTasks)
    .where(and(
      eq(schema.autopilotTasks.companyId, companyId),
      eq(schema.autopilotTasks.timeSlot, timeSlot),
      or(...ACTIVE_STATUSES.map(s => eq(schema.autopilotTasks.status, s))),
    ))
    .orderBy(asc(schema.autopilotTasks.slotOrder), asc(schema.autopilotTasks.createdAt));
  let i = 0;
  for (const r of rows) {
    await db.update(schema.autopilotTasks).set({ slotOrder: i++ })
      .where(eq(schema.autopilotTasks.id, r.id));
  }
}

// Persist a full new arrangement of the 3 slots at once (drag-and-drop).
// `slots` maps each slot to the ordered list of task IDs it should contain.
export async function reorderAutopilotSlots(companyId: string, slots: Partial<Record<TimeSlot, string[]>>) {
  for (const slot of ['morning', 'noon', 'evening'] as TimeSlot[]) {
    const ids = slots[slot];
    if (!ids) continue;
    let i = 0;
    for (const id of ids) {
      await db.update(schema.autopilotTasks)
        .set({ timeSlot: slot, slotOrder: i++ })
        .where(and(eq(schema.autopilotTasks.id, id), eq(schema.autopilotTasks.companyId, companyId)));
    }
  }
}

// Edit a task's idea/description (and optionally title)
export async function editAutopilotTask(companyId: string, taskId: string, patch: { title?: string; description?: string }) {
  const set: any = {};
  if (patch.title !== undefined) set.title = patch.title;
  if (patch.description !== undefined) set.description = patch.description;
  if (Object.keys(set).length === 0) return;
  await db.update(schema.autopilotTasks).set(set)
    .where(and(eq(schema.autopilotTasks.id, taskId), eq(schema.autopilotTasks.companyId, companyId)));
}

// Set a precise date (with or without hour) via the 3-dot menu
export async function scheduleAutopilotTask(companyId: string, taskId: string, scheduledFor: Date, hasExactTime: boolean) {
  const timeSlot = slotFromDate(scheduledFor);
  await db.update(schema.autopilotTasks)
    .set({ scheduledFor, hasExactTime, timeSlot })
    .where(and(eq(schema.autopilotTasks.id, taskId), eq(schema.autopilotTasks.companyId, companyId)));
}

// Delete a task (leaves the slot free → dashed placeholder in the UI)
export async function deleteAutopilotTask(companyId: string, taskId: string) {
  await db.delete(schema.autopilotTasks)
    .where(and(eq(schema.autopilotTasks.id, taskId), eq(schema.autopilotTasks.companyId, companyId)));
}

// Add a user-created task into a specific slot (the "+" popup)
export async function addAutopilotTask(companyId: string, timeSlot: TimeSlot, title: string, description?: string): Promise<string> {
  const today = new Date().toISOString().split('T')[0];
  const plan = await db.select().from(schema.autopilotPlans)
    .where(and(eq(schema.autopilotPlans.companyId, companyId), eq(schema.autopilotPlans.date, today))).get();
  const scheduledFor = new Date(new Date().setHours(slotStartHour(timeSlot), 0, 0, 0));
  return createTask(companyId, plan?.id || null, {
    type: 'adjust_strategy',
    title,
    description: description || title,
    agent: 'strategist',
    priority: 5,
    scheduledFor,
    timeSlot,
    hasExactTime: false,
    input: { userCreated: true },
  });
}
