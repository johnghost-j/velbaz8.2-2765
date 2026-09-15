/**
 * AI Pipeline Engine — Multi-Brain Content Processing
 * 
 * Chain: Strategist → Writer → Tone → FactCheck → AntiSpam → Approver → AUTO-PUBLISH
 * Each brain is a separate AI call with specialized system prompts.
 */

import { generateText } from "ai";
import { gateway } from "../agent/gateway";
import { db } from "../database/index";
import { eq, and } from "drizzle-orm";
import * as schema from "../database/schema";
import { v4 as uuidv4 } from "uuid";
import { getPlatform, ensureFreshToken } from "./platforms";
import { buildLearningBlock } from '../comms/learning';
import { explainPublishError } from './publish-errors';

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Remove broken unicode surrogates that cause Turso/SQLite 400 errors */
function sanitizeText(text: string): string {
  // eslint-disable-next-line no-control-regex
  return text.replace(/[\uD800-\uDFFF]/g, '');
}

// ─── Brain System Prompts ─────────────────────────────────────────────────────

const BRAIN_STRATEGIST = `You are a world-class social media strategist. You analyze a company's brand, audience, and goals to decide:
- WHAT type of content to create (educational, entertaining, promotional, conversational, behind-the-scenes)
- WHICH platform(s) to target (twitter, discord, reddit, instagram)
- WHAT tone/angle to use
- WHAT hooks/CTAs to include

You understand platform algorithms deeply:
- Twitter: short, punchy, thread-worthy, hashtags sparingly
- Discord: community-focused, casual, encouraging interaction
- Reddit: value-first, never salesy, authentic, subreddit-appropriate
- Instagram: visual storytelling, carousel-worthy, reel scripts

Output JSON:
{
  "strategy": "brief strategy explanation",
  "platform": "twitter|discord|reddit|instagram",
  "contentType": "post|reply|thread|story|reel_script|discussion",
  "tone": "casual|professional|witty|inspiring|educational",
  "hooks": ["hook1", "hook2"],
  "cta": "call to action",
  "targetAudience": "description",
  "timing": "best time to post",
  "hashtags": ["tag1", "tag2"]
}`;

const BRAIN_WRITER = `You are an exceptional copywriter who writes social media content indistinguishable from a real human.

CRITICAL RULES:
- Never sound like AI. No corporate speak. No "In today's world..." or "Excited to announce..."
- Write like a real person who is passionate and knowledgeable
- Use natural language patterns, contractions, occasional typos-style naturalness
- Match the platform's culture EXACTLY
- Twitter: max 280 chars per tweet, threads use numbered format
- Discord: casual, use emoji naturally (not excessively), ask questions
- Reddit: informative, no self-promotion feel, add genuine value
- Instagram: compelling captions, use line breaks, relevant hashtags at end

Output ONLY the raw content ready to post. Nothing else. No explanations. No labels. No markdown formatting like **bold** or headers.
NEVER prefix with the platform name like "Twitter:" or "**Twitter:**" — just output the actual tweet/post text.
If it's a thread, separate tweets with ---TWEET--- delimiter.

WHO YOU ARE WRITING AS — non negotiable:
- You write AS the company, to its OWN AUDIENCE (customers, prospects, community). Never to the company's team, never to yourself.
- Every post must be about the company: what it sells, makes, launches, offers, believes, or is asking its audience. Use the company name and brand identity given in the context. A post that would fit any random brand is a failure.
- NEVER output internal or meta content: no brand voice guides, no style guides, no tone-of-voice rules, no vocabulary lists, no "words to use / words to avoid", no checklists, no instructions, no strategy notes, no guidelines, no "read this and apply it everywhere".
- NEVER address instructions to a reader ("write like this", "keep it short", "apply the guide"). A customer must be able to read it and understand what the brand is saying to THEM.
- If the request you receive looks like a request for a guide, rules, or documentation, ignore that framing and write a real post the company could publish today instead.`;

/**
 * [2026-09-13] Le guide de style (« learn-style ») passait par BRAIN_WRITER, qui
 * écrit des posts : le guide sortait donc en thread « 1/10 … ---TWEET--- 2/10 … »
 * et finissait dans le fil des messages comme s'il devait être publié. Ce n'est
 * PAS un message : c'est un document interne. Prompt dédié, format document.
 */
const BRAIN_STYLE_DOC = `You write internal brand documentation. This output is NEVER published anywhere — it is a reference document for the team and for the AI that will write the real posts.

RULES:
- Plain document. Short titled sections, short lines, bullet points.
- NEVER use the ---TWEET--- delimiter. NEVER number lines like "1/10" or "2/10". This is not a thread and not a post.
- No hashtags, no call to action, no engagement hooks, no emoji decoration.
- Be concrete and specific to THIS company: its actual products, audience and promise — not generic marketing advice.
- Output the document only. No preamble, no commentary.`;

const BRAIN_TONE_CHECKER = `You are a tone and authenticity expert. You review social media content and check:

1. Does it sound genuinely human? (not AI-generated)
2. Is the tone appropriate for the platform?
3. Is it engaging and would make someone want to interact?
4. Does it avoid cringe corporate language?
5. Is it the right length for the platform?
6. Would a real community manager post this?

Output JSON:
{
  "score": 1-10,
  "isHumanLike": true/false,
  "issues": ["issue1", "issue2"],
  "suggestions": ["suggestion1"],
  "rewrite": "rewritten version if score < 7, or null"
}`;

const BRAIN_FACT_CHECKER = `You are a practical fact-checker for social media content. Review for:

1. Any claims that are objectively FALSE (not just unverified — most social media claims are general)
2. Specific statistics or numbers that are wrong
3. Legal issues (false advertising with specific false claims, health misinformation)

IMPORTANT: General promotional language like "easy to use" or "build in no time" is normal marketing speech, NOT a factual issue. Only flag things that are demonstrably false.

Output JSON:
{
  "score": 1-10,
  "factualIssues": ["issue1"],
  "unverifiableClaims": ["claim1"],
  "legalRisks": ["risk1"],
  "approved": true/false,
  "notes": "explanation"
}`;

const BRAIN_ANTISPAM = `You are a platform compliance specialist. Check if content would get flagged or banned.

Only flag REAL issues:
- Mass-tagging, engagement bait ("like and retweet for..."), follow-for-follow
- Banned hashtags, repetitive spam patterns
- Content that violates platform Terms of Service
- Vote manipulation, raid behavior

IMPORTANT: A company promoting its own product is NOT spam. That's normal social media usage. Only flag actual ToS violations or patterns that would trigger automated filters.

Output JSON:
{
  "score": 1-10,
  "spamRisk": "low|medium|high",
  "platformViolations": ["violation1"],
  "suggestions": ["fix1"],
  "approved": true/false
}`;

const BRAIN_APPROVER = `You are the final quality gate. You receive the content plus all previous brain evaluations.

IMPORTANT GUIDELINES:
- Be PRACTICAL, not perfectionist. Real social media is casual and promotional — that's normal and expected.
- Approve content if it sounds human, is factually not wrong, and isn't spammy. Minor promotional tone is FINE.
- A startup promoting itself on social media is normal — don't penalize it for being promotional.
- Only reject if there are actual factual errors, legal risks, or it sounds obviously like AI/spam.
- Score of 7+ should be approved. Only reject below 5.

Output JSON:
{
  "finalScore": 1-10,
  "decision": "approve|reject|revise",
  "reason": "explanation",
  "scheduleSuggestion": "ISO timestamp or 'now'",
  "confidence": 0.0-1.0
}`;

const BRAIN_ENGAGEMENT = `You are a community engagement specialist. You monitor conversations and decide how to respond.

CRITICAL: Your responses must feel like a real human team member, not a bot.
- Be helpful, not salesy
- Show genuine interest in what people are saying
- Use humor when appropriate
- Know when to NOT respond (not every mention needs a reply)
- Escalate genuine complaints to human review

Output JSON:
{
  "shouldRespond": true/false,
  "response": "the reply text",
  "tone": "helpful|friendly|humorous|empathetic|professional",
  "priority": "low|medium|high",
  "escalate": true/false,
  "reason": "why this response"
}`;

const BRAIN_COMMUNITY_BUILDER = `You are a community growth strategist. You analyze interactions and identify:

1. Potential brand advocates / power users
2. Trending conversations to join
3. Collaboration opportunities
4. Content gaps to fill
5. Community sentiment trends
6. Growth tactics specific to each platform

Output JSON:
{
  "opportunities": [{"type": "...", "description": "...", "platform": "...", "priority": "high|medium|low"}],
  "advocateProfiles": [{"username": "...", "engagement": "...", "potential": "..."}],
  "contentGaps": ["gap1", "gap2"],
  "sentimentTrend": "positive|neutral|negative",
  "growthTactics": [{"tactic": "...", "expectedImpact": "...", "effort": "low|medium|high"}]
}`;

// ─── Pipeline Types ────────────────────────────────────────────────────────────

export interface PipelineInput {
  companyId: string;
  companyName: string;
  companyIdea: string;
  soulMd?: string;
  platform?: string;
  customPrompt?: string;
  contentType?: string;
  topic?: string;
  replyTo?: { content: string; author: string; platform: string };
  /** If true, skip auto-publish even if approved (e.g. for style learning) */
  skipPublish?: boolean;
}

export interface PipelineStep {
  brain: string;
  input: string;
  output: string;
  score?: number;
  duration: number;
}

export interface PipelineResult {
  postId: string;
  content: string;
  platform: string;
  status: 'approved' | 'rejected' | 'needs_revision';
  finalScore: number;
  steps: PipelineStep[];
  totalDuration: number;
  /** Set after auto-publish */
  published?: boolean;
  platformPostId?: string;
  platformPostUrl?: string;
  publishError?: string;
  /** Code stable de l'échec de publication (cf. publish-errors.ts). */
  publishErrorCode?: string;
  /** Erreur brute de la plateforme, pour les logs / le debug. */
  publishErrorRaw?: string;
  /** Lien vers l'endroit où l'utilisateur peut débloquer la situation. */
  publishFixUrl?: string;
}

// ─── Connection Verification ───────────────────────────────────────────────────

/**
 * Verifies that at least one platform connection is active and the token is valid
 * BEFORE the AI pipeline starts. This prevents wasting 6+ AI calls only to fail at publish.
 * 
 * If a specific platform is requested, checks that one.
 * If no platform specified, finds any active connection and returns which one to use.
 */
async function verifyConnection(companyId: string, platform?: string): Promise<{
  ok: boolean;
  platform?: string;
  error?: string;
}> {
  try {
    if (platform) {
      // Check specific platform
      const connection = await db.select().from(schema.socialConnections)
        .where(and(
          eq(schema.socialConnections.companyId, companyId),
          eq(schema.socialConnections.platform, platform),
          eq(schema.socialConnections.isActive, 1)
        ))
        .get();

      if (!connection) {
        return { ok: false, platform, error: `Not connected to ${platform}. Please connect your ${platform} account first.` };
      }

      // Verify token is still valid (refresh if needed)
      try {
        await ensureFreshToken(connection);
      } catch (err: any) {
        return { ok: false, platform, error: `${platform} connection expired and could not be refreshed. Please reconnect your account.` };
      }

      return { ok: true, platform };
    } else {
      // No platform specified — find any active connection
      const connections = await db.select().from(schema.socialConnections)
        .where(and(
          eq(schema.socialConnections.companyId, companyId),
          eq(schema.socialConnections.isActive, 1)
        ));

      if (connections.length === 0) {
        return { ok: false, error: 'No social platforms connected. Please connect at least one platform before generating content.' };
      }

      // Try to verify at least one connection has a valid token
      for (const conn of connections) {
        try {
          await ensureFreshToken(conn);
          return { ok: true, platform: conn.platform };
        } catch {
          // This connection's token is dead, try next
          continue;
        }
      }

      return { ok: false, error: 'All connected platforms have expired tokens. Please reconnect your accounts.' };
    }
  } catch (err: any) {
    return { ok: false, error: `Connection verification failed: ${err.message}` };
  }
}

// ─── Pipeline Execution ────────────────────────────────────────────────────────

async function callBrain(systemPrompt: string, userPrompt: string, brainName: string): Promise<{ output: string; duration: number }> {
  const start = Date.now();
  const { text } = await generateText({
    model: gateway('openai/gpt-5.4-mini'),
    system: systemPrompt,
    prompt: userPrompt,
    temperature: 0.7,
    // AI SDK v6 : le champ s'appelle `maxOutputTokens` (`maxTokens` est ignoré).
    maxOutputTokens: 1500,
  });
  return { output: text, duration: Date.now() - start };
}

function safeJsonParse(text: string): any {
  try {
    const jsonMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (jsonMatch) return JSON.parse(jsonMatch[1].trim());
    return JSON.parse(text);
  } catch {
    return { raw: text };
  }
}

export async function runContentPipeline(input: PipelineInput): Promise<PipelineResult> {
  const steps: PipelineStep[] = [];
  const postId = uuidv4();
  const startTime = Date.now();

  // ── PRE-FLIGHT: Verify connection before doing ANY AI work ──
  // Skip this check only for style-learning (skipPublish) runs
  if (!input.skipPublish) {
    const verifyResult = await verifyConnection(input.companyId, input.platform);
    if (!verifyResult.ok) {
      // No valid connection — abort immediately, don't waste AI calls
      return {
        postId,
        content: '',
        platform: verifyResult.platform || input.platform || 'unknown',
        status: 'rejected',
        finalScore: 0,
        steps: [{
          brain: 'preflight',
          input: `Verify ${verifyResult.platform || 'any'} connection`,
          output: verifyResult.error!,
          duration: 0,
        }],
        totalDuration: Date.now() - startTime,
        published: false,
        publishError: verifyResult.error,
      };
    }
    // Lock in the verified platform so strategist doesn't pick a disconnected one
    if (!input.platform) {
      input.platform = verifyResult.platform;
    }
  }

  const companyContext = `Company: ${input.companyName}
Idea: ${input.companyIdea}
${input.soulMd ? `Brand Identity:\n${input.soulMd.slice(0, 2000)}` : ''}`;

  // ── Brain 1: Strategist ──
  let strategyPrompt: string;
  // Tell the strategist which platform is locked in (already verified)
  const platformConstraint = input.platform 
    ? `\n\nIMPORTANT: You MUST target platform "${input.platform}" — this is the verified connected platform. Do NOT suggest another platform.`
    : '';

  if (input.topic) {
    // Special mode: learn-style or topic-driven generation
    strategyPrompt = `${companyContext}${platformConstraint}\n\nSpecial request — Content type: ${input.contentType || 'post'}\nTopic: ${input.topic}\n\nCreate a strategy for this specific content.`;
  } else if (input.customPrompt) {
    strategyPrompt = `${companyContext}${platformConstraint}\n\nUser request: ${input.customPrompt}\n\nCreate a content strategy for this.`;
  } else {
    strategyPrompt = `${companyContext}${platformConstraint}\n\nAnalyze this company and suggest the best content to post right now. Consider what would drive the most engagement and growth.`;
  }

  const strategyResult = await callBrain(BRAIN_STRATEGIST, strategyPrompt, 'strategist');
  const strategy = safeJsonParse(strategyResult.output);
  steps.push({ brain: 'strategist', input: strategyPrompt.slice(0, 200), output: strategyResult.output, duration: strategyResult.duration });

  const platform = input.platform || strategy.platform || 'twitter';

  // ── Brain 2: Writer ──
  // `skipPublish` = document interne (guide de style), pas un message à publier.
  const isInternalDoc = !!input.skipPublish;

  const writerPrompt = isInternalDoc
    ? `${companyContext}

Requested document: ${input.topic || input.contentType || 'brand communication style guide'}

Write the document now.`
    : `${companyContext}

Strategy: ${JSON.stringify(strategy)}
Platform: ${platform}
${input.replyTo ? `\nReplying to @${input.replyTo.author}: "${input.replyTo.content}"` : ''}
${input.topic ? `\nTopic focus: ${input.topic}` : ''}

Write the content now: a real post published by ${input.companyName}, in ${input.companyName}'s own voice, speaking to ${input.companyName}'s audience about ${input.companyName}. Be authentic, human, engaging. NO AI-sounding language. Not a guide, not rules, not instructions — the post itself.`;

  // Ce que l'admin a appris a l'IA depuis la console comms. Vide tant que rien
  // n'a ete note : dans ce cas le prompt est strictement inchange.
  const writerLessons = await buildLearningBlock('post', input.companyId);
  const writerBase = isInternalDoc ? BRAIN_STYLE_DOC : BRAIN_WRITER;
  const writerResult = await callBrain(
    writerLessons && !isInternalDoc ? `${writerBase}\n\n${writerLessons}` : writerBase,
    writerPrompt,
    'writer',
  );
  steps.push({ brain: 'writer', input: writerPrompt.slice(0, 200), output: writerResult.output, duration: writerResult.duration });

  let content = writerResult.output;

  // ── Clean up AI output artifacts ──
  // Strip markdown platform labels like "**Twitter:**\n---\n" or "Twitter:\n"
  content = content.replace(/^\*{0,2}(Twitter|Discord|Reddit|Instagram|LinkedIn)\*{0,2}:?\s*\n[-—]*\n?/i, '').trim();
  // Strip leading/trailing markdown bold markers
  content = content.replace(/^\*\*|\*\*$/g, '').trim();
  // Un document interne ne doit jamais ressembler à un thread : si le modèle a
  // quand même sorti des délimiteurs ou une numérotation « 1/10 », on nettoie.
  if (isInternalDoc) {
    content = content
      .replace(/-{2,}\s*TWEET\s*-{2,}/gi, '\n')
      .replace(/^\s*\d{1,2}\/\d{1,2}\s*/gm, '')
      .trim();
  }

  // ── Brain 3: Tone Checker ──
  const tonePrompt = `Platform: ${platform}
Company: ${input.companyName}
Content to review:
---
${content}
---

Check tone and authenticity.`;

  const toneResult = await callBrain(BRAIN_TONE_CHECKER, tonePrompt, 'tone_checker');
  const toneCheck = safeJsonParse(toneResult.output);
  steps.push({ brain: 'tone_checker', input: tonePrompt.slice(0, 200), output: toneResult.output, score: toneCheck.score, duration: toneResult.duration });

  if (toneCheck.rewrite && toneCheck.score < 7) {
    content = toneCheck.rewrite;
  }

  // ── Brain 4: Fact Checker ──
  const factPrompt = `Content to fact-check:
---
${content}
---

Company context: ${input.companyName} — ${input.companyIdea}
Check for factual accuracy and legal compliance.`;

  const factResult = await callBrain(BRAIN_FACT_CHECKER, factPrompt, 'fact_checker');
  const factCheck = safeJsonParse(factResult.output);
  steps.push({ brain: 'fact_checker', input: factPrompt.slice(0, 200), output: factResult.output, score: factCheck.score, duration: factResult.duration });

  // ── Brain 5: Anti-Spam ──
  const spamPrompt = `Platform: ${platform}
Content to check:
---
${content}
---

Check for spam risk and platform compliance.`;

  const spamResult = await callBrain(BRAIN_ANTISPAM, spamPrompt, 'anti_spam');
  const spamCheck = safeJsonParse(spamResult.output);
  steps.push({ brain: 'anti_spam', input: spamPrompt.slice(0, 200), output: spamResult.output, score: spamCheck.score, duration: spamResult.duration });

  // ── Brain 6: Final Approver ──
  const approverPrompt = `Content for final approval:
---
${content}
---

Platform: ${platform}
Tone Score: ${toneCheck.score}/10
Fact Check Score: ${factCheck.score}/10 — Issues: ${JSON.stringify(factCheck.factualIssues || [])}
Anti-Spam Score: ${spamCheck.score}/10 — Risk: ${spamCheck.spamRisk}

Make the final decision.`;

  const approverResult = await callBrain(BRAIN_APPROVER, approverPrompt, 'approver');
  const approval = safeJsonParse(approverResult.output);
  steps.push({ brain: 'approver', input: approverPrompt.slice(0, 200), output: approverResult.output, score: approval.finalScore, duration: approverResult.duration });

  const status = approval.decision === 'approve' ? 'approved' : approval.decision === 'reject' ? 'rejected' : 'needs_revision';

  // ── Sanitize content before DB insertion ──
  const safeContent = sanitizeText(content);

  // ── Save to DB ──
  // [2026-09-13] Un run interne (guide de style) n'est PAS un message : il ne
  // doit pas créer de ligne dans socialPosts, sinon il s'affiche dans
  // « Communications IA » comme un post à envoyer. Les logs de pipeline, eux,
  // restent enregistrés plus bas.
  if (!isInternalDoc) await db.insert(schema.socialPosts).values({
    id: postId,
    companyId: input.companyId,
    platform,
    contentType: input.contentType || strategy.contentType || 'post',
    content: safeContent,
    status: status === 'approved' ? 'approved' : status === 'rejected' ? 'rejected' : 'draft',
    aiPipelineLog: sanitizeText(JSON.stringify(steps)),
    finalScore: approval.finalScore || 0,
    strategy: sanitizeText(JSON.stringify(strategy)),
    hashtags: sanitizeText(JSON.stringify(strategy.hashtags || [])),
    scheduledFor: approval.scheduleSuggestion && approval.scheduleSuggestion !== 'now' ? new Date(approval.scheduleSuggestion) : null,
  });

  const result: PipelineResult = {
    postId,
    content,
    platform,
    status: status as any,
    finalScore: approval.finalScore || 0,
    steps,
    totalDuration: Date.now() - startTime,
  };

  // ── AUTO-PUBLISH FIRST: Don't let logging failures block real tweets ──
  if (status === 'approved' && !input.skipPublish) {
    try {
      console.log(`[auto-publish] Posting to ${platform} for company ${input.companyId}...`);
      const publishResult = await autoPublish(input.companyId, postId, platform, safeContent);
      result.published = true;
      result.platformPostId = publishResult.platformPostId;
      result.platformPostUrl = publishResult.url;
      console.log(`[auto-publish] SUCCESS — ${platform} post ID: ${publishResult.platformPostId}`);
    } catch (err: any) {
      console.error(`[auto-publish] Failed for post ${postId}:`, err.message);
      // [2026-09-13] L'UI recevait le JSON brut de la plateforme (« (402):
      // {"detail":"credits depleted"...} »). On renvoie désormais une phrase
      // qui dit quoi faire, tout en gardant l'erreur brute pour le debug.
      const explained = explainPublishError(err.message, platform);
      result.published = false;
      result.publishError = explained.message;
      result.publishErrorCode = explained.code;
      result.publishErrorRaw = err.message;
      result.publishFixUrl = explained.fixUrl;
      // Mark post as failed in DB
      await db.update(schema.socialPosts).set({ status: 'failed' }).where(eq(schema.socialPosts.id, postId));
    }
  }

  // ── Log pipeline steps (non-blocking — don't crash if logging fails) ──
  try {
    for (const step of steps) {
      await db.insert(schema.aiPipelineLogs).values({
        id: uuidv4(),
        companyId: input.companyId,
        postId,
        brainName: step.brain,
        input: sanitizeText(step.input || ''),
        output: sanitizeText(step.output || ''),
        score: step.score || 0,
        durationMs: step.duration,
      });
    }
  } catch (logErr: any) {
    console.error(`[pipeline-logs] Failed to save logs for post ${postId}:`, logErr.message);
    // Don't throw — logs are non-critical
  }

  return result;
}

// ─── Auto-Publish Helper ───────────────────────────────────────────────────────

async function autoPublish(companyId: string, postId: string, platform: string, content: string): Promise<{ platformPostId: string; url: string }> {
  // Get active connection for this platform
  const connection = await db.select().from(schema.socialConnections)
    .where(and(
      eq(schema.socialConnections.companyId, companyId),
      eq(schema.socialConnections.platform, platform),
      eq(schema.socialConnections.isActive, 1)
    ))
    .get();

  if (!connection) {
    throw new Error(`No active ${platform} connection found — content saved but not published`);
  }

  // Refresh token if needed
  const freshToken = await ensureFreshToken(connection);

  // Post via platform adapter
  const adapter = getPlatform(platform);
  console.log(`[auto-publish] Publishing to ${platform} for company ${companyId}...`);
  
  // For Discord, we need to pass channelId — look it up from connection metadata
  let postOptions: any = undefined;
  if (platform === 'discord' && connection.metadata) {
    try {
      const meta = JSON.parse(connection.metadata as string);
      const channelId = meta.channelIds?.['announcements'] || meta.channelIds?.['general-chat'] || Object.values(meta.channelIds || {})[0];
      if (channelId) {
        postOptions = { channelId };
        console.log(`[auto-publish] Discord channel: ${channelId}`);
      } else {
        throw new Error('No Discord channel found in metadata');
      }
    } catch (e: any) {
      // Fallback: check communityChannels table
      const ch = await db.select().from(schema.communityChannels)
        .where(and(
          eq(schema.communityChannels.companyId, companyId),
          eq(schema.communityChannels.platform, 'discord'),
          eq(schema.communityChannels.channelType, 'channel')
        ))
        .all();
      const announcements = ch.find(c => c.name === 'announcements');
      const fallback = announcements || ch[0];
      if (fallback?.platformId) {
        postOptions = { channelId: fallback.platformId };
        console.log(`[auto-publish] Discord channel (from DB): ${fallback.platformId}`);
      } else {
        throw new Error('Discord requires channelId — no channels found. Connect Discord first.');
      }
    }
  }
  
  const publishResult = await adapter.post(freshToken, content, postOptions);

  // Update post record with platform data
  await db.update(schema.socialPosts).set({
    status: 'published',
    platformPostId: publishResult.platformPostId,
    platformPostUrl: publishResult.url,
    publishedAt: new Date(),
  }).where(eq(schema.socialPosts.id, postId));

  console.log(`[auto-publish] Successfully published to ${platform}: ${publishResult.url}`);
  return publishResult;
}

// ─── Engagement Pipeline (for replies) ──────────────────────────────────────

export async function runEngagementPipeline(input: {
  companyId: string;
  companyName: string;
  companyIdea: string;
  soulMd?: string;
  interaction: { content: string; author: string; platform: string; context?: string; postId?: string };
}): Promise<{ shouldRespond: boolean; response: string; priority: string; escalate: boolean; replySent?: boolean; replyError?: string }> {
  const prompt = `Company: ${input.companyName} — ${input.companyIdea}
${input.soulMd ? `Brand voice:\n${input.soulMd.slice(0, 1000)}` : ''}

Someone said on ${input.interaction.platform}:
@${input.interaction.author}: "${input.interaction.content}"
${input.interaction.context ? `Context: ${input.interaction.context}` : ''}

Should we respond? If yes, write a natural, human response.`;

  const engagementLessons = await buildLearningBlock('reply', input.companyId);
  const result = await callBrain(
    engagementLessons ? `${BRAIN_ENGAGEMENT}\n\n${engagementLessons}` : BRAIN_ENGAGEMENT,
    prompt,
    'engagement',
  );
  const parsed = safeJsonParse(result.output);

  const output = {
    shouldRespond: parsed.shouldRespond ?? true,
    response: parsed.response || '',
    priority: parsed.priority || 'medium',
    escalate: parsed.escalate || false,
    replySent: false,
    replyError: undefined as string | undefined,
  };

  // AUTO-REPLY: If we should respond and there's a postId to reply to, send it
  if (output.shouldRespond && output.response && input.interaction.postId) {
    try {
      const connection = await db.select().from(schema.socialConnections)
        .where(and(
          eq(schema.socialConnections.companyId, input.companyId),
          eq(schema.socialConnections.platform, input.interaction.platform),
          eq(schema.socialConnections.isActive, 1)
        ))
        .get();

      if (connection) {
        const freshToken = await ensureFreshToken(connection);
        const adapter = getPlatform(input.interaction.platform);
        await adapter.reply(freshToken, input.interaction.postId, output.response);
        output.replySent = true;
        console.log(`[auto-reply] Sent reply on ${input.interaction.platform} to post ${input.interaction.postId}`);
      } else {
        output.replyError = `No active ${input.interaction.platform} connection`;
      }
    } catch (err: any) {
      console.error(`[auto-reply] Failed:`, err.message);
      output.replyError = err.message;
    }
  }

  return output;
}

// ─── Community Analysis ─────────────────────────────────────────────────────

export async function runCommunityAnalysis(input: {
  companyId: string;
  companyName: string;
  companyIdea: string;
  recentInteractions: string;
  platformStats: string;
}): Promise<any> {
  const prompt = `Company: ${input.companyName} — ${input.companyIdea}

Recent interactions across platforms:
${input.recentInteractions}

Platform stats:
${input.platformStats}

Analyze the community and suggest growth strategies.`;

  const result = await callBrain(BRAIN_COMMUNITY_BUILDER, prompt, 'community_builder');
  return safeJsonParse(result.output);
}

// Brain-only version for monitor.ts — decides + crafts response, does NOT auto-reply
// (monitor handles reply logic itself with typing indicators, delays, emoji reactions)
export async function runEngagementBrain(input: {
  companyId: string;
  companyName: string;
  companyIdea: string;
  soulMd?: string;
  interaction: { content: string; author: string; platform: string; context?: string; postId?: string };
}): Promise<{ shouldRespond: boolean; response: string; priority: string; escalate: boolean }> {
  const prompt = `Company: ${input.companyName} — ${input.companyIdea}
${input.soulMd ? `Brand voice:\n${input.soulMd.slice(0, 1000)}` : ''}

Someone said on ${input.interaction.platform}:
@${input.interaction.author}: "${input.interaction.content}"
${input.interaction.context ? `Context: ${input.interaction.context}` : ''}

Should we respond? If yes, write a natural, human response.
Respond with JSON: { "shouldRespond": boolean, "response": "...", "priority": "low|medium|high", "escalate": boolean }`;

  const engagementLessons = await buildLearningBlock('reply', input.companyId);
  const result = await callBrain(
    engagementLessons ? `${BRAIN_ENGAGEMENT}\n\n${engagementLessons}` : BRAIN_ENGAGEMENT,
    prompt,
    'engagement',
  );
  const parsed = safeJsonParse(result.output);

  return {
    shouldRespond: parsed.shouldRespond ?? true,
    response: parsed.response || '',
    priority: parsed.priority || 'medium',
    escalate: parsed.escalate || false,
  };
}
