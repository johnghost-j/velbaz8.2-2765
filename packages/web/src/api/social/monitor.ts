/**
 * Social Monitor — Real-time platform tracking & AI auto-responses
 * 
 * - Discord: WebSocket Gateway (real-time message events)
 * - Twitter: Polling mentions every 2 min
 * - AI responds naturally via BRAIN_ENGAGEMENT
 * - Tracks all interactions in DB
 * - Adds emoji reactions sometimes (not always)
 */

import { generateText } from "ai";
import { gateway } from "../agent/gateway";
import { db } from "../database/index";
import { eq, and, desc } from "drizzle-orm";
import * as schema from "../database/schema";
import { v4 as uuidv4 } from "uuid";
import { getPlatform, ensureFreshToken } from "./platforms";
import WebSocket from "ws";
import { runEngagementBrain } from "./pipeline";

// ─── State ──────────────────────────────────────────────────────────────────

let discordWs: WebSocket | null = null;
let discordHeartbeatInterval: Timer | null = null;
let discordSessionId: string | null = null;
let discordSequence: number | null = null;
let discordResumeUrl: string | null = null;
let twitterPollInterval: Timer | null = null;
let monitorRunning = false;

// Track processed messages to avoid duplicates
const processedMessages = new Set<string>();
const MAX_PROCESSED = 5000;

// ─── Discord Gateway (WebSocket) ────────────────────────────────────────────

const DISCORD_GATEWAY_URL = 'wss://gateway.discord.gg/?v=10&encoding=json';

// Privileged intents: MESSAGE_CONTENT (1<<15), GUILD_MEMBERS (1<<1), GUILD_PRESENCES (1<<8)
// These must be enabled in Discord Developer Portal > Bot > Privileged Gateway Intents
// Without MESSAGE_CONTENT, message content is empty for non-mention messages
// GUILD_MESSAGE_REACTIONS (1<<12) is NOT privileged but requires GUILD_MESSAGES
// Gateway intents: https://discord.com/developers/docs/events/gateway#list-of-intents
// Privileged (must enable in Developer Portal): GUILD_MEMBERS(1<<1), GUILD_PRESENCES(1<<8), MESSAGE_CONTENT(1<<15)
// Without MESSAGE_CONTENT, message.content is empty for non-mention messages
// To enable MESSAGE_CONTENT: Discord Developer Portal > Bot > Privileged Gateway Intents > toggle on
// Then add (1 << 15) here. Without it, only @mention messages have content.
const DISCORD_INTENTS = 
  (1 << 0)  | // GUILDS — guild create/update/delete events
  (1 << 9);   // GUILD_MESSAGES — message events in guild channels
// NOTE: Emoji reactions and message content intents added once enabled in Developer Portal

interface DiscordMessage {
  id: string;
  channel_id: string;
  guild_id?: string;
  author: { id: string; username: string; bot?: boolean };
  content: string;
  timestamp: string;
  referenced_message?: DiscordMessage | null;
}

function connectDiscordGateway() {
  const botToken = process.env.DISCORD_BOT_TOKEN;
  if (!botToken) {
    console.log('[monitor:discord] No BOT_TOKEN, skipping Discord gateway');
    return;
  }

  const url = discordResumeUrl || DISCORD_GATEWAY_URL;
  console.log(`[monitor:discord] Connecting to gateway...`);
  
  discordWs = new WebSocket(url);

  discordWs.on('open', () => {
    console.log('[monitor:discord] WebSocket connected');
  });

  discordWs.on('message', async (raw: Buffer) => {
    try {
      const data = JSON.parse(raw.toString());
      handleDiscordEvent(data, botToken);
    } catch (e: any) {
      console.error('[monitor:discord] Parse error:', e.message);
    }
  });

  discordWs.on('close', (code: number, reason: Buffer) => {
    console.log(`[monitor:discord] WebSocket closed: ${code} — ${reason.toString()}`);
    if (discordHeartbeatInterval) clearInterval(discordHeartbeatInterval);
    
    // Reconnect after 5s (unless code 4004 = invalid token)
    if (code !== 4004 && monitorRunning) {
      console.log('[monitor:discord] Reconnecting in 5s...');
      setTimeout(connectDiscordGateway, 5000);
    }
  });

  discordWs.on('error', (err: Error) => {
    console.error('[monitor:discord] WebSocket error:', err.message);
  });
}

function handleDiscordEvent(data: any, botToken: string) {
  const { op, t, s, d } = data;
  
  if (s) discordSequence = s;

  switch (op) {
    case 10: // Hello — start heartbeat + identify
      const heartbeatMs = d.heartbeat_interval;
      console.log(`[monitor:discord] Hello, heartbeat every ${heartbeatMs}ms`);
      
      if (discordHeartbeatInterval) clearInterval(discordHeartbeatInterval);
      discordHeartbeatInterval = setInterval(() => {
        discordWs?.send(JSON.stringify({ op: 1, d: discordSequence }));
      }, heartbeatMs);
      
      // Send initial heartbeat
      discordWs?.send(JSON.stringify({ op: 1, d: null }));
      
      // Identify or Resume
      if (discordSessionId && discordResumeUrl) {
        discordWs?.send(JSON.stringify({
          op: 6, d: { token: botToken, session_id: discordSessionId, seq: discordSequence }
        }));
      } else {
        discordWs?.send(JSON.stringify({
          op: 2, d: {
            token: botToken,
            intents: DISCORD_INTENTS,
            properties: { os: 'linux', browser: 'velbaz', device: 'velbaz' },
          }
        }));
      }
      break;

    case 11: // Heartbeat ACK
      break;

    case 0: // Dispatch
      if (t === 'READY') {
        discordSessionId = d.session_id;
        discordResumeUrl = d.resume_gateway_url;
        console.log(`[monitor:discord] Ready! Session: ${discordSessionId}, guilds: ${d.guilds?.length || 0}`);
      }
      
      if (t === 'MESSAGE_CREATE') {
        handleDiscordMessage(d as DiscordMessage);
      }
      
      if (t === 'GUILD_MEMBER_ADD') {
        handleNewMember(d);
      }
      break;

    case 7: // Reconnect
      console.log('[monitor:discord] Server requested reconnect');
      discordWs?.close();
      break;

    case 9: // Invalid session
      console.log('[monitor:discord] Invalid session, re-identifying...');
      discordSessionId = null;
      discordResumeUrl = null;
      setTimeout(() => connectDiscordGateway(), 2000);
      break;
  }
}

async function handleDiscordMessage(msg: DiscordMessage) {
  // Skip bot messages (including our own)
  if (msg.author.bot) return;
  
  // Without MESSAGE_CONTENT intent, non-mention messages have empty content
  // Log but skip processing empty messages
  if (!msg.content || msg.content.trim() === '') {
    console.log(`[monitor:discord] Empty content from @${msg.author.username} in channel ${msg.channel_id} (enable MESSAGE_CONTENT intent for full access)`);
    return;
  }
  
  // Skip if already processed
  if (processedMessages.has(msg.id)) return;
  processedMessages.add(msg.id);
  if (processedMessages.size > MAX_PROCESSED) {
    const first = processedMessages.values().next().value;
    if (first) processedMessages.delete(first);
  }

  const botId = process.env.DISCORD_CLIENT_ID || '';
  const botToken = process.env.DISCORD_BOT_TOKEN || '';
  
  console.log(`[monitor:discord] Message from @${msg.author.username} in ${msg.channel_id}: ${msg.content.slice(0, 100)}`);

  // Find which company this guild belongs to
  const channel = await db.select().from(schema.communityChannels)
    .where(and(
      eq(schema.communityChannels.platformId, msg.channel_id),
      eq(schema.communityChannels.platform, 'discord'),
    )).get();
  
  if (!channel && msg.guild_id) {
    // Try to find by guild (parent)
    const server = await db.select().from(schema.communityChannels)
      .where(and(
        eq(schema.communityChannels.platformId, msg.guild_id),
        eq(schema.communityChannels.channelType, 'server'),
      )).get();
    if (!server) {
      console.log(`[monitor:discord] Unknown guild ${msg.guild_id}, ignoring`);
      return;
    }
  }
  
  const companyId = channel?.companyId || (await findCompanyByGuild(msg.guild_id));
  if (!companyId) {
    console.log(`[monitor:discord] No company found for guild, ignoring`);
    return;
  }

  // Get company info for AI context
  const company = await db.select().from(schema.companies)
    .where(eq(schema.companies.id, companyId)).get();
  if (!company) return;

  // Get channel name to understand context
  const channelName = channel?.name || 'unknown';
  
  // Store the interaction in DB
  const interactionId = uuidv4();
  await db.insert(schema.socialInteractions).values({
    id: interactionId,
    companyId,
    platform: 'discord',
    type: 'message',
    authorId: msg.author.id,
    authorUsername: msg.author.username,
    content: msg.content,
    aiResponseStatus: 'pending',
    sentiment: null,
    priority: 'medium',
  });

  // Decide if we should respond based on channel type
  const readOnlyChannels = ['welcome', 'rules', 'announcements', 'changelog', 'tips-and-tricks'];
  if (readOnlyChannels.includes(channelName)) {
    // These are read-only, user shouldn't be writing here (permissions should prevent it)
    // But if somehow they do, ignore
    return;
  }

  // Channels where the bot should actively engage
  const activeChannels = ['general-chat', 'help', 'bug-reports', 'feature-requests', 'feedback', 'showcase', 'introductions', 'off-topic'];
  
  // Check if bot was mentioned or if it's a support channel
  const botMentioned = msg.content.includes(`<@${botId}>`) || msg.content.includes(`<@!${botId}>`);
  const isHelpChannel = ['help', 'bug-reports', 'feature-requests'].includes(channelName);
  const isIntro = channelName === 'introductions';
  
  // AI decides whether to respond
  // Higher chance of responding if: mentioned, help channel, or introduction
  const shouldProcess = botMentioned || isHelpChannel || isIntro || activeChannels.includes(channelName);
  
  if (!shouldProcess) {
    await db.update(schema.socialInteractions)
      .set({ aiResponseStatus: 'skipped' })
      .where(eq(schema.socialInteractions.id, interactionId));
    return;
  }

  try {
    // Use AI engagement brain to decide + craft response
    const result = await runEngagementBrain({
      companyId,
      companyName: company.name,
      companyIdea: company.idea,
      soulMd: company.soulMd || undefined,
      interaction: {
        platform: 'discord',
        content: msg.content,
        author: msg.author.username,
        postId: `${msg.channel_id}:${msg.id}`,
        context: `Channel: #${channelName}. ${botMentioned ? 'Bot was directly mentioned.' : ''} ${isHelpChannel ? 'This is a support channel — be helpful.' : ''} ${isIntro ? 'User is introducing themselves — be welcoming.' : ''}`,
      },
    });

    if (result.shouldRespond && result.response) {
      // Maybe add an emoji reaction first (30% chance)
      const shouldReact = Math.random() < 0.3;
      if (shouldReact) {
        const reactionEmojis = getContextualEmoji(channelName, msg.content);
        const emoji = reactionEmojis[Math.floor(Math.random() * reactionEmojis.length)];
        try {
          await fetch(`https://discord.com/api/v10/channels/${msg.channel_id}/messages/${msg.id}/reactions/${encodeURIComponent(emoji)}/@me`, {
            method: 'PUT',
            headers: { Authorization: `Bot ${botToken}` },
          });
        } catch {}
      }

      // Small typing delay to feel natural (1-3s)
      const delay = 1000 + Math.random() * 2000;
      
      // Show typing indicator
      await fetch(`https://discord.com/api/v10/channels/${msg.channel_id}/typing`, {
        method: 'POST',
        headers: { Authorization: `Bot ${botToken}` },
      });

      await new Promise(r => setTimeout(r, delay));

      // Send the response (as reply to the message)
      const res = await fetch(`https://discord.com/api/v10/channels/${msg.channel_id}/messages`, {
        method: 'POST',
        headers: { Authorization: `Bot ${botToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          content: result.response,
          message_reference: { message_id: msg.id },
          allowed_mentions: { replied_user: true },
        }),
      });

      if (res.ok) {
        const reply = await res.json() as any;
        console.log(`[monitor:discord] Replied to @${msg.author.username}: ${result.response.slice(0, 80)}...`);
        
        await db.update(schema.socialInteractions)
          .set({ 
            aiResponse: result.response, 
            aiResponseStatus: 'sent',
            sentiment: result.priority === 'high' ? 'negative' : 'neutral',
            priority: result.priority,
          })
          .where(eq(schema.socialInteractions.id, interactionId));
      } else {
        const errText = await res.text();
        console.error(`[monitor:discord] Reply failed: ${errText}`);
        await db.update(schema.socialInteractions)
          .set({ aiResponseStatus: 'failed', aiResponse: result.response })
          .where(eq(schema.socialInteractions.id, interactionId));
      }
    } else {
      // AI decided not to respond — maybe just react with an emoji (20% chance)
      const shouldReact = Math.random() < 0.2;
      if (shouldReact) {
        const emoji = getContextualEmoji(channelName, msg.content)[0];
        try {
          await fetch(`https://discord.com/api/v10/channels/${msg.channel_id}/messages/${msg.id}/reactions/${encodeURIComponent(emoji)}/@me`, {
            method: 'PUT',
            headers: { Authorization: `Bot ${botToken}` },
          });
        } catch {}
      }
      
      await db.update(schema.socialInteractions)
        .set({ aiResponseStatus: 'skipped', aiResponse: result.response || null })
        .where(eq(schema.socialInteractions.id, interactionId));
    }
  } catch (err: any) {
    console.error(`[monitor:discord] AI engagement error:`, err.message);
    await db.update(schema.socialInteractions)
      .set({ aiResponseStatus: 'failed' })
      .where(eq(schema.socialInteractions.id, interactionId));
  }
}

async function handleNewMember(data: any) {
  const guildId = data.guild_id;
  const user = data.user;
  if (!user || user.bot) return;

  console.log(`[monitor:discord] New member: @${user.username} joined guild ${guildId}`);
  
  const companyId = await findCompanyByGuild(guildId);
  if (!companyId) return;

  const company = await db.select().from(schema.companies)
    .where(eq(schema.companies.id, companyId)).get();
  
  // Find welcome channel
  const welcomeCh = await db.select().from(schema.communityChannels)
    .where(and(
      eq(schema.communityChannels.companyId, companyId),
      eq(schema.communityChannels.platform, 'discord'),
      eq(schema.communityChannels.name, 'welcome'),
    )).get();

  if (!welcomeCh?.platformId) return;

  const botToken = process.env.DISCORD_BOT_TOKEN || '';
  
  // Send a personalized welcome
  const welcomeMessages = [
    `Hey <@${user.id}>, bienvenue ! 👋 Content de te voir ici.`,
    `<@${user.id}> vient d'arriver ! Welcome aboard 🎉`,
    `Bienvenue <@${user.id}> ! N'hésite pas à te présenter dans <#introductions> 😊`,
    `Oh, un nouveau ! Salut <@${user.id}> 👋 Fais comme chez toi.`,
    `<@${user.id}> welcome ! Check les rules et amuse-toi bien ici.`,
  ];
  
  const welcome = welcomeMessages[Math.floor(Math.random() * welcomeMessages.length)];
  // Replace <#introductions> with actual channel reference
  const introCh = await db.select().from(schema.communityChannels)
    .where(and(
      eq(schema.communityChannels.companyId, companyId),
      eq(schema.communityChannels.name, 'introductions'),
    )).get();
  
  const finalWelcome = introCh?.platformId 
    ? welcome.replace('<#introductions>', `<#${introCh.platformId}>`)
    : welcome.replace(' dans <#introductions>', '');

  await fetch(`https://discord.com/api/v10/channels/${welcomeCh.platformId}/messages`, {
    method: 'POST',
    headers: { Authorization: `Bot ${botToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ content: finalWelcome }),
  });

  // Track interaction
  await db.insert(schema.socialInteractions).values({
    id: uuidv4(),
    companyId,
    platform: 'discord',
    type: 'join',
    authorId: user.id,
    authorUsername: user.username,
    content: 'New member joined',
    aiResponse: finalWelcome,
    aiResponseStatus: 'sent',
    sentiment: 'positive',
    priority: 'low',
  });
}

// ─── Twitter Polling ────────────────────────────────────────────────────────

async function pollTwitterMentions() {
  try {
    await _pollTwitterMentions();
  } catch (err: any) {
    // Never let a background poll crash the whole server (e.g. Turso ECONNRESET)
    console.error('[monitor:twitter] Poll cycle failed (ignored):', err?.message || err);
  }
}

async function _pollTwitterMentions() {
  console.log('[monitor:twitter] Polling mentions...');
  
  // Get all companies with active Twitter connections
  const connections = await db.select().from(schema.socialConnections)
    .where(and(
      eq(schema.socialConnections.platform, 'twitter'),
      eq(schema.socialConnections.isActive, 1),
    ));

  for (const conn of connections) {
    try {
      const freshToken = await ensureFreshToken(conn);
      const adapter = getPlatform('twitter');
      
      // Get mentions
      const notifications = await (adapter as any).getNotifications(freshToken);
      
      for (const notif of notifications) {
        // Skip if already processed
        if (processedMessages.has(`tw-${notif.id}`)) continue;
        processedMessages.add(`tw-${notif.id}`);
        
        // Skip if it's old (> 10 min)
        const age = Date.now() - new Date(notif.createdAt).getTime();
        if (age > 10 * 60 * 1000) continue;

        // Check if already in DB
        const existing = await db.select({ id: schema.socialInteractions.id })
          .from(schema.socialInteractions)
          .where(and(
            eq(schema.socialInteractions.companyId, conn.companyId),
            eq(schema.socialInteractions.platform, 'twitter'),
            eq(schema.socialInteractions.authorId, notif.id),
          )).get();
        if (existing) continue;

        console.log(`[monitor:twitter] New mention: ${notif.content?.slice(0, 80)}`);

        const company = await db.select().from(schema.companies)
          .where(eq(schema.companies.id, conn.companyId)).get();
        if (!company) continue;

        // Store interaction
        const interactionId = uuidv4();
        await db.insert(schema.socialInteractions).values({
          id: interactionId,
          companyId: conn.companyId,
          platform: 'twitter',
          type: 'mention',
          authorId: notif.author || notif.id,
          authorUsername: notif.author || 'unknown',
          content: notif.content,
          aiResponseStatus: 'pending',
        });

        // AI engagement
        try {
          const result = await runEngagementBrain({
            companyId: conn.companyId,
            companyName: company.name,
            companyIdea: company.idea,
            soulMd: company.soulMd || undefined,
            interaction: {
              platform: 'twitter',
              content: notif.content,
              author: notif.author || 'user',
              postId: notif.id,
              context: 'Twitter mention. Keep reply under 280 chars. Be conversational.',
            },
          });

          if (result.shouldRespond && result.response) {
            // Reply on Twitter
            try {
              await adapter.reply(freshToken, notif.id, result.response);
              console.log(`[monitor:twitter] Replied: ${result.response.slice(0, 80)}`);
              
              await db.update(schema.socialInteractions)
                .set({ aiResponse: result.response, aiResponseStatus: 'sent' })
                .where(eq(schema.socialInteractions.id, interactionId));
            } catch (err: any) {
              console.error(`[monitor:twitter] Reply failed:`, err.message);
              await db.update(schema.socialInteractions)
                .set({ aiResponse: result.response, aiResponseStatus: 'failed' })
                .where(eq(schema.socialInteractions.id, interactionId));
            }
          } else {
            await db.update(schema.socialInteractions)
              .set({ aiResponseStatus: 'skipped' })
              .where(eq(schema.socialInteractions.id, interactionId));
          }
        } catch (err: any) {
          console.error(`[monitor:twitter] AI error:`, err.message);
        }
      }
    } catch (err: any) {
      console.error(`[monitor:twitter] Poll error for ${conn.companyId}:`, err.message);
    }
  }
}

// ─── Helpers ────────────────────────────────────────────────────────────────

async function findCompanyByGuild(guildId?: string): Promise<string | null> {
  if (!guildId) return null;
  const server = await db.select().from(schema.communityChannels)
    .where(and(
      eq(schema.communityChannels.platformId, guildId),
      eq(schema.communityChannels.channelType, 'server'),
    )).get();
  return server?.companyId || null;
}

function getContextualEmoji(channelName: string, content: string): string[] {
  const lowContent = content.toLowerCase();
  
  // Context-based emojis
  if (['help', 'bug-reports'].includes(channelName)) {
    return ['👀', '🔍', '🛠️', '💡'];
  }
  if (channelName === 'feature-requests') {
    return ['💡', '🤔', '👀', '✨'];
  }
  if (channelName === 'showcase') {
    return ['🔥', '🎉', '💪', '👏', '⭐'];
  }
  if (channelName === 'introductions') {
    return ['👋', '🎉', '😊', '🤝'];
  }
  if (channelName === 'feedback') {
    return ['🙏', '💡', '👀', '❤️'];
  }
  
  // Content-based emojis
  if (lowContent.includes('merci') || lowContent.includes('thank')) return ['❤️', '🙏', '😊'];
  if (lowContent.includes('cool') || lowContent.includes('nice') || lowContent.includes('great')) return ['🔥', '💪', '🎉'];
  if (lowContent.includes('help') || lowContent.includes('aide')) return ['👀', '🤝', '💡'];
  if (lowContent.includes('bug') || lowContent.includes('error')) return ['👀', '🔍', '🛠️'];
  if (lowContent.includes('?')) return ['🤔', '👀', '💡'];
  
  // Default
  return ['👍', '👀', '😊', '🙌'];
}

// ─── Public API ─────────────────────────────────────────────────────────────

export function startSocialMonitor() {
  if (monitorRunning) {
    console.log('[monitor] Already running');
    return;
  }
  monitorRunning = true;
  console.log('[monitor] 🚀 Starting social monitor...');

  // Start Discord WebSocket gateway
  connectDiscordGateway();

  // Start Twitter polling (every 2 minutes)
  pollTwitterMentions(); // Initial poll
  twitterPollInterval = setInterval(pollTwitterMentions, 2 * 60 * 1000);

  console.log('[monitor] ✅ Social monitor started — Discord (WebSocket) + Twitter (2min poll)');
}

export function stopSocialMonitor() {
  monitorRunning = false;
  
  if (discordWs) {
    discordWs.close(1000, 'Shutting down');
    discordWs = null;
  }
  if (discordHeartbeatInterval) {
    clearInterval(discordHeartbeatInterval);
    discordHeartbeatInterval = null;
  }
  if (twitterPollInterval) {
    clearInterval(twitterPollInterval);
    twitterPollInterval = null;
  }
  
  discordSessionId = null;
  discordResumeUrl = null;
  
  console.log('[monitor] Social monitor stopped');
}

export function getMonitorStatus() {
  return {
    running: monitorRunning,
    discord: {
      connected: discordWs?.readyState === WebSocket.OPEN,
      sessionId: discordSessionId,
    },
    twitter: {
      polling: !!twitterPollInterval,
    },
    processedMessages: processedMessages.size,
  };
}
