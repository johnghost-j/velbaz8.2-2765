/**
 * Social / Community API Routes
 */

import { Hono } from 'hono';
import crypto from 'node:crypto';
import { db } from '../database/index';
import { eq, and, desc, sql } from 'drizzle-orm';
import * as schema from '../database/schema';
import { v4 as uuidv4 } from 'uuid';
import { getPlatform, ensureFreshToken, setupDiscordGuild, hasRealKeys } from './platforms';
import { runContentPipeline, runEngagementPipeline, runCommunityAnalysis } from './pipeline';
import { startSocialMonitor, stopSocialMonitor, getMonitorStatus } from './monitor';

/**
 * Base URL publique utilisée pour construire les `redirect_uri` OAuth.
 *
 * [2026-09-11] Avant, `PUBLIC_URL` gagnait toujours. Pointé sur un domaine où
 * aucune app n'est publiée (velbaz.com → 404 Runable), la popup X atterrissait
 * sur une page « This site doesn't exist yet » après autorisation : le callback
 * n'était jamais exécuté, donc aucun jeton enregistré.
 *
 * On part donc de l'origine RÉELLE du navigateur : la popup revient toujours sur
 * l'app qui a lancé la connexion, quel que soit le domaine utilisé (aperçu ou
 * domaine final). Le proxy réécrit `Host`/`Origin` vers l'hôte interne du bac à
 * sable, donc le front envoie lui-même son `window.location.origin` ; on retombe
 * ensuite sur le `Referer`, puis l'en-tête `Host`, et enfin `PUBLIC_URL`.
 * `OAUTH_REDIRECT_BASE` force une valeur si besoin.
 */
function safeOrigin(value?: string | null): string | null {
  if (!value) return null;
  try {
    const u = new URL(value);
    if (!/^https?:$/.test(u.protocol)) return null;
    if (/^(localhost|127\.0\.0\.1|0\.0\.0\.0)$/.test(u.hostname)) return null;
    return u.origin;
  } catch {
    return null;
  }
}

function getPublicBaseUrl(c: any, clientOrigin?: string | null): string {
  const forced = process.env.OAUTH_REDIRECT_BASE;
  if (forced) return forced.replace(/\/$/, '');

  const fromClient = safeOrigin(clientOrigin);
  if (fromClient) return fromClient;

  const fromReferer = safeOrigin(c.req.header('referer'));
  if (fromReferer) return fromReferer;

  const fwdHost = c.req.header('x-forwarded-host') || c.req.header('host');
  if (fwdHost && !/^(localhost|127\.0\.0\.1|0\.0\.0\.0)(:|$)/.test(fwdHost)) {
    const fwdProto = c.req.header('x-forwarded-proto') || 'https';
    return `${fwdProto}://${fwdHost}`;
  }

  if (process.env.PUBLIC_URL) return process.env.PUBLIC_URL.replace(/\/$/, '');
  if (fwdHost) return `http://${fwdHost}`;
  return new URL(c.req.url).origin;
}

const social = new Hono();

// ─── État OAuth (PKCE) ────────────────────────────────────────────────────────
// [2026-09-11] Le code_verifier PKCE était gardé dans une Map en mémoire : tout
// redémarrage du serveur (ou une 2e instance derrière le load balancer) entre le
// clic « Connecter » et le retour de X faisait perdre le verifier → échange de
// token refusé, connexion qui échoue sans explication.
// Il voyage désormais CHIFFRÉ (AES-256-GCM) à l'intérieur du paramètre `state`,
// que X nous renvoie tel quel : aucun stockage serveur, résistant aux
// redémarrages, et X ne voit qu'un blob opaque.
const STATE_TTL_MS = 15 * 60 * 1000;

function stateKey(): Buffer {
  const secret =
    process.env.OAUTH_STATE_SECRET ||
    process.env.JWT_SECRET ||
    process.env.TWITTER_CLIENT_SECRET ||
    'velbaz-oauth-state';
  return crypto.createHash('sha256').update(secret).digest();
}

interface OAuthState {
  companyId: string;
  platform: string;
  ts: number;
  v?: string; // code_verifier PKCE
  r?: string; // redirect_uri exact utilisé à l'autorisation (doit être identique à l'échange)
}

function encodeState(payload: OAuthState): string {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', stateKey(), iv);
  const enc = Buffer.concat([cipher.update(JSON.stringify(payload), 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `v2.${iv.toString('base64url')}.${enc.toString('base64url')}.${tag.toString('base64url')}`;
}

function decodeState(state: string): OAuthState | null {
  try {
    if (state.startsWith('v2.')) {
      const [, ivB64, encB64, tagB64] = state.split('.');
      const decipher = crypto.createDecipheriv('aes-256-gcm', stateKey(), Buffer.from(ivB64, 'base64url'));
      decipher.setAuthTag(Buffer.from(tagB64, 'base64url'));
      const dec = Buffer.concat([decipher.update(Buffer.from(encB64, 'base64url')), decipher.final()]);
      const payload = JSON.parse(dec.toString('utf8')) as OAuthState;
      if (!payload.companyId || !payload.platform) return null;
      if (Date.now() - (payload.ts || 0) > STATE_TTL_MS) return null;
      return payload;
    }
    // Ancien format (base64url JSON en clair) — toléré le temps que les flux en
    // cours au moment du déploiement se terminent.
    const payload = JSON.parse(Buffer.from(state, 'base64url').toString()) as OAuthState;
    return payload.companyId && payload.platform ? payload : null;
  } catch {
    return null;
  }
}

// ─── OAuth Flow ────────────────────────────────────────────────────────────────

// Initiate OAuth connection
social.post('/companies/:id/social/connect', async (c) => {
  const companyId = c.req.param('id');
  const { platform: platformName, origin: clientOrigin } = await c.req.json() as {
    platform: string;
    origin?: string;
  };

  // ─── Demo mode: no API keys → instant simulated connection ───
  if (!hasRealKeys(platformName)) {
    const demoUsername = `${platformName}_user`;
    
    // Upsert connection directly (no OAuth needed)
    const existing = await db.select().from(schema.socialConnections)
      .where(and(eq(schema.socialConnections.companyId, companyId), eq(schema.socialConnections.platform, platformName)))
      .get();

    if (existing) {
      await db.update(schema.socialConnections).set({
        accessToken: `demo_token_${Date.now()}`,
        refreshToken: `demo_refresh_${Date.now()}`,
        tokenExpiresAt: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000),
        platformUserId: `demo_${platformName}_${Date.now()}`,
        platformUsername: demoUsername,
        isActive: 1,
        lastUsedAt: new Date(),
      }).where(eq(schema.socialConnections.id, existing.id));
    } else {
      await db.insert(schema.socialConnections).values({
        id: uuidv4(),
        companyId,
        platform: platformName,
        accessToken: `demo_token_${Date.now()}`,
        refreshToken: `demo_refresh_${Date.now()}`,
        tokenExpiresAt: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000),
        platformUserId: `demo_${platformName}_${Date.now()}`,
        platformUsername: demoUsername,
        isActive: 1,
        lastUsedAt: new Date(),
      });
    }

    // Return demo mode response — no popup needed
    return c.json({ demo: true, connected: true, platform: platformName, username: demoUsername });
  }

  // ─── Real OAuth flow ───
  const adapter = getPlatform(platformName);
  const baseUrl = getPublicBaseUrl(c, clientOrigin);
  const redirectUri = `${baseUrl}/api/social/callback/${platformName}`;

  // Le state doit déjà contenir le code_verifier, or l'adaptateur ne le génère
  // qu'en construisant l'URL : on appelle d'abord avec un state provisoire pour
  // récupérer le verifier, puis on reconstruit l'URL avec le state définitif.
  const probe = adapter.getAuthUrl('__probe__', redirectUri);
  const codeVerifier = typeof probe === 'string' ? undefined : probe.codeVerifier;
  const state = encodeState({ companyId, platform: platformName, ts: Date.now(), v: codeVerifier, r: redirectUri });

  let authUrl: string;
  if (typeof probe === 'string') {
    authUrl = probe.replace('state=__probe__', `state=${state}`);
  } else {
    // Même verifier → même code_challenge : on remplace juste le state.
    authUrl = probe.url.replace('state=__probe__', `state=${state}`);
  }

  if (authUrl.includes('__probe__')) {
    return c.json({ error: `OAuth state non injecté pour ${platformName}` }, 500);
  }

  console.log(`[oauth:connect] ${platformName} — redirect_uri=${redirectUri}`);
  return c.json({ authUrl, state, redirectUri });
});

// Diagnostic : quelles plateformes sont RÉELLEMENT connectables, et avec quelle
// URL de callback exacte à enregistrer chez le fournisseur. Sans clés, l'app
// retombe en mode démo (fausse connexion) — c'est ici qu'on le voit.
social.get('/social/config', (c) => {
  // `?origin=` permet de tester exactement ce que le front enverra.
  const baseUrl = getPublicBaseUrl(c, c.req.query('origin'));
  const platforms = ['twitter', 'discord', 'reddit', 'instagram'].map((p) => ({
    platform: p,
    real: hasRealKeys(p),
    mode: hasRealKeys(p) ? 'oauth' : 'demo',
    callbackUrl: `${baseUrl}/api/social/callback/${p}`,
  }));
  return c.json({
    baseUrl,
    publicUrlConfigured: !!process.env.PUBLIC_URL,
    platforms,
  });
});

// OAuth callback — returns HTML that posts message to opener window
social.get('/social/callback/:platform', async (c) => {
  const platformName = c.req.param('platform');
  const code = c.req.query('code');
  const stateStr = c.req.query('state');
  const guildIdParam = c.req.query('guild_id'); // Discord sends this when bot is added
  const permissionsParam = c.req.query('permissions');

  console.log(`[oauth:callback] ${platformName} — code=${code ? 'yes' : 'no'}, state=${stateStr ? 'yes' : 'no'}, guild_id=${guildIdParam || 'none'}`);

  if (!code || !stateStr) {
    console.error(`[oauth:callback] Missing code or state for ${platformName}`);
    return c.html(oauthResultPage(false, platformName, 'Missing code or state'));
  }

  const parsedState = decodeState(stateStr);
  let stateData: { companyId: string; platform: string };
  if (parsedState) {
    stateData = parsedState;
  } else {
    return c.html(oauthResultPage(false, platformName, 'État OAuth invalide ou expiré (plus de 15 min) — relance la connexion'));
  }

  if (stateData.platform && stateData.platform !== platformName) {
    return c.html(oauthResultPage(false, platformName, 'État OAuth incohérent'));
  }

  const adapter = getPlatform(platformName);
  // Le redirect_uri de l'échange de jeton doit être STRICTEMENT identique à celui
  // envoyé à l'autorisation : on le relit dans le state plutôt que de le
  // reconstruire (le proxy réécrit l'en-tête Host, on ne retomberait pas dessus).
  const redirectUri =
    parsedState.r || `${getPublicBaseUrl(c)}/api/social/callback/${platformName}`;

  // code_verifier PKCE : transporté chiffré dans le state (cf. encodeState).
  const codeVerifier = parsedState.v;

  try {
    const tokens = await adapter.exchangeCode(code, redirectUri, codeVerifier);
    console.log(`[oauth:callback] ${platformName} tokens received — user: ${tokens.platformUsername}`);

    // For Discord: setup channels in the guild the bot was added to
    const metadata: Record<string, any> = {};
    if (platformName === 'discord') {
      // Get the guild ID from: query params (Discord sends guild_id), or token exchange response
      const guildId = guildIdParam || (tokens as any)._guildId;
      const guildName = (tokens as any)._guildName;
      
      if (guildId) {
        try {
          const company = await db.select().from(schema.companies).where(eq(schema.companies.id, stateData.companyId)).get();
          const companyName = company?.name || 'Community';
          
          console.log(`[oauth:callback] Discord — setting up guild ${guildId} (${guildName})...`);
          const setupResult = await setupDiscordGuild(guildId, companyName, stateData.companyId);
          
          metadata.guildId = setupResult.guildId;
          metadata.channelIds = setupResult.channelIds;
          metadata.inviteUrl = setupResult.inviteUrl;
          metadata.guildName = guildName;
          console.log(`[oauth:callback] Discord guild setup done! Channels: ${Object.keys(setupResult.channelIds).length}, invite: ${setupResult.inviteUrl}`);
          
          // Clear old channels for this company+discord, then insert new ones
          await db.delete(schema.communityChannels).where(
            and(eq(schema.communityChannels.companyId, stateData.companyId), eq(schema.communityChannels.platform, 'discord'))
          );
          
          // Store channels in DB
          for (const [chName, chId] of Object.entries(setupResult.channelIds)) {
            await db.insert(schema.communityChannels).values({
              id: uuidv4(),
              companyId: stateData.companyId,
              platform: 'discord',
              channelType: 'channel',
              name: chName,
              platformId: chId as string,
              parentId: setupResult.guildId,
            });
          }
          // Store server entry
          await db.insert(schema.communityChannels).values({
            id: uuidv4(),
            companyId: stateData.companyId,
            platform: 'discord',
            channelType: 'server',
            name: guildName || `${companyName} Server`,
            platformId: setupResult.guildId,
            metadata: JSON.stringify({ inviteUrl: setupResult.inviteUrl }),
          });
          
          // Send a welcome message
          const welcomeChannelId = setupResult.channelIds['welcome'] || setupResult.channelIds['general-chat'] || Object.values(setupResult.channelIds)[0];
          if (welcomeChannelId) {
            const botToken = process.env.DISCORD_BOT_TOKEN || '';
            await fetch(`https://discord.com/api/v10/channels/${welcomeChannelId}/messages`, {
              method: 'POST',
              headers: { Authorization: `Bot ${botToken}`, 'Content-Type': 'application/json' },
              body: JSON.stringify({
                content: `# 👋 Welcome to ${guildName || companyName}!\n\nThis server has been set up by **Velbaz AI**. Here's what you'll find:\n\n📋 **Welcome** — Start here, read the rules, introduce yourself\n💬 **General** — Chat with the community\n📢 **Updates** — Announcements, changelogs, tips\n🛟 **Support** — Get help, report bugs, request features\n🌟 **Community** — Showcase your work, share feedback\n\nThe AI bot is active and will respond to your questions! 🤖`,
              }),
            });
            console.log(`[oauth:callback] Welcome message sent to ${welcomeChannelId}`);
          }
        } catch (e: any) {
          console.error(`[oauth:callback] Discord guild setup failed:`, e.message);
          metadata.serverError = e.message;
          metadata.guildId = guildId; // Store guild ID even if setup fails
        }
      } else {
        console.warn(`[oauth:callback] Discord — no guild_id received. Bot may not have been added to a server.`);
        metadata.serverError = 'No guild_id received from Discord OAuth';
      }
    }

    // Upsert connection
    const existing = await db.select().from(schema.socialConnections)
      .where(and(eq(schema.socialConnections.companyId, stateData.companyId), eq(schema.socialConnections.platform, platformName)))
      .get();

    const connectionData = {
      accessToken: tokens.accessToken,
      refreshToken: tokens.refreshToken,
      tokenExpiresAt: tokens.expiresAt,
      platformUserId: tokens.platformUserId,
      platformUsername: tokens.platformUsername,
      isActive: 1,
      lastUsedAt: new Date(),
      metadata: Object.keys(metadata).length > 0 ? JSON.stringify(metadata) : null,
    };

    if (existing) {
      await db.update(schema.socialConnections).set(connectionData).where(eq(schema.socialConnections.id, existing.id));
    } else {
      await db.insert(schema.socialConnections).values({
        id: uuidv4(),
        companyId: stateData.companyId,
        platform: platformName,
        ...connectionData,
      });
    }

    console.log(`[oauth:callback] ${platformName} connection saved successfully`);
    return c.html(oauthResultPage(true, platformName, undefined, tokens.platformUsername));
  } catch (err: any) {
    console.error(`[oauth:callback] OAuth error for ${platformName}:`, err.message);
    return c.html(oauthResultPage(false, platformName, err.message || 'OAuth failed'));
  }
});

/** Generate the HTML page that communicates OAuth result back to the opener window */
function oauthResultPage(success: boolean, platform: string, error?: string, username?: string): string {
  const message = JSON.stringify({
    type: success ? 'oauth-success' : 'oauth-error',
    platform,
    username: username || null,
    error: error || null,
  });
  return `<!DOCTYPE html>
<html>
<head><title>Connecting ${platform}...</title>
<style>
  body { font-family: system-ui, sans-serif; display: flex; align-items: center; justify-content: center; height: 100vh; margin: 0; background: #0a0a0a; color: #fff; }
  .card { text-align: center; padding: 2rem; }
  .spinner { width: 40px; height: 40px; border: 3px solid #333; border-top-color: #6366f1; border-radius: 50%; animation: spin 0.8s linear infinite; margin: 0 auto 1rem; }
  @keyframes spin { to { transform: rotate(360deg); } }
  .success { color: #22c55e; }
  .error { color: #ef4444; }
</style>
</head>
<body>
<div class="card">
  ${success 
    ? `<div class="success">&#10003;</div><p>Connected to ${platform}${username ? ` as @${username}` : ''}!</p>`
    : `<div class="error">&#10007;</div><p>Failed to connect ${platform}</p><p style="font-size:0.8rem;color:#888">${error || ''}</p>`
  }
  <p style="font-size:0.8rem;color:#666">This window will close automatically...</p>
</div>
<script>
  try {
    if (window.opener) {
      window.opener.postMessage(${message}, '*');
    }
  } catch(e) {}
  setTimeout(() => window.close(), 2000);
</script>
</body>
</html>`;
}

// ─── Connections Management ────────────────────────────────────────────────────

social.get('/companies/:id/social/connections', async (c) => {
  const companyId = c.req.param('id');
  const rows = await db.select({
    id: schema.socialConnections.id,
    platform: schema.socialConnections.platform,
    platformUsername: schema.socialConnections.platformUsername,
    platformUserId: schema.socialConnections.platformUserId,
    accessToken: schema.socialConnections.accessToken,
    isActive: schema.socialConnections.isActive,
    lastUsedAt: schema.socialConnections.lastUsedAt,
    createdAt: schema.socialConnections.createdAt,
  }).from(schema.socialConnections)
    .where(eq(schema.socialConnections.companyId, companyId));
  // `isDemo` : connexion simulée (aucune clé API configurée au moment du clic).
  // Le jeton lui-même n'est JAMAIS renvoyé au navigateur.
  const connections = rows.map(({ accessToken, ...r }) => ({
    ...r,
    isDemo: typeof accessToken === 'string' && accessToken.startsWith('demo_token_'),
  }));
  return c.json(connections);
});

social.delete('/companies/:id/social/:platform', async (c) => {
  const companyId = c.req.param('id');
  const platform = c.req.param('platform');
  await db.update(schema.socialConnections).set({ isActive: 0 })
    .where(and(eq(schema.socialConnections.companyId, companyId), eq(schema.socialConnections.platform, platform)));
  return c.json({ ok: true });
});

// ─── Content Generation (AI Pipeline) ──────────────────────────────────────────

social.post('/companies/:id/social/generate', async (c) => {
  const companyId = c.req.param('id');
  const { platform, prompt: customPrompt } = await c.req.json() as { platform?: string; prompt?: string };
  console.log(`[route:generate] Called for company=${companyId}, platform=${platform}`);

  const company = await db.select().from(schema.companies).where(eq(schema.companies.id, companyId)).get();
  if (!company) {
    console.log(`[route:generate] Company not found: ${companyId}`);
    return c.json({ error: 'Company not found' }, 404);
  }
  console.log(`[route:generate] Found company: ${company.name}`);

  const result = await runContentPipeline({
    companyId,
    companyName: company.name,
    companyIdea: company.idea,
    soulMd: company.soulMd || undefined,
    platform,
    customPrompt,
  });

  // If pipeline aborted due to connection issue, return 400 so frontend knows
  if (result.publishError && result.steps.length === 1 && result.steps[0].brain === 'preflight') {
    return c.json({ error: result.publishError, type: 'connection_required' }, 400);
  }

  return c.json(result);
});

// ─── Posts Management ──────────────────────────────────────────────────────────

social.get('/companies/:id/social/posts', async (c) => {
  const companyId = c.req.param('id');
  const status = c.req.query('status');
  const platform = c.req.query('platform');

  let query = db.select().from(schema.socialPosts)
    .where(eq(schema.socialPosts.companyId, companyId))
    .orderBy(desc(schema.socialPosts.createdAt))
    .limit(50);

  const posts = await query;
  const filtered = posts.filter(p => {
    if (status && p.status !== status) return false;
    if (platform && p.platform !== platform) return false;
    return true;
  });
  return c.json(filtered);
});

social.post('/companies/:id/social/posts/:postId/approve', async (c) => {
  const postId = c.req.param('postId');
  await db.update(schema.socialPosts).set({ status: 'approved' }).where(eq(schema.socialPosts.id, postId));
  return c.json({ ok: true });
});

social.post('/companies/:id/social/posts/:postId/reject', async (c) => {
  const postId = c.req.param('postId');
  await db.update(schema.socialPosts).set({ status: 'rejected' }).where(eq(schema.socialPosts.id, postId));
  return c.json({ ok: true });
});

// Manually publish a specific post (for posts that weren't auto-published)
social.post('/companies/:id/social/posts/:postId/publish', async (c) => {
  const companyId = c.req.param('id');
  const postId = c.req.param('postId');

  const post = await db.select().from(schema.socialPosts).where(eq(schema.socialPosts.id, postId)).get();
  if (!post) return c.json({ error: 'Post not found' }, 404);

  const connection = await db.select().from(schema.socialConnections)
    .where(and(eq(schema.socialConnections.companyId, companyId), eq(schema.socialConnections.platform, post.platform), eq(schema.socialConnections.isActive, 1)))
    .get();

  if (!connection) return c.json({ error: `Not connected to ${post.platform}` }, 400);

  try {
    // Refresh token before publishing
    const freshToken = await ensureFreshToken(connection);
    const adapter = getPlatform(post.platform);
    
    // For Discord, look up the channel to post to
    let postOptions: any = undefined;
    if (post.platform === 'discord' && connection.metadata) {
      const meta = JSON.parse(connection.metadata as string);
      const channelId = meta.channelIds?.['announcements'] || meta.channelIds?.['general-chat'] || Object.values(meta.channelIds || {})[0];
      if (channelId) postOptions = { channelId };
    }
    
    const result = await adapter.post(freshToken, post.content, postOptions);

    await db.update(schema.socialPosts).set({
      status: 'published',
      platformPostId: result.platformPostId,
      platformPostUrl: result.url,
      publishedAt: new Date(),
    }).where(eq(schema.socialPosts.id, postId));

    return c.json({ ok: true, url: result.url, platformPostId: result.platformPostId });
  } catch (err: any) {
    await db.update(schema.socialPosts).set({ status: 'failed' }).where(eq(schema.socialPosts.id, postId));
    return c.json({ error: err.message }, 500);
  }
});

// ─── Live Feed (SSE) ───────────────────────────────────────────────────────────

social.get('/companies/:id/social/feed', async (c) => {
  const companyId = c.req.param('id');

  const [posts, interactions, pipelineLogs] = await Promise.all([
    db.select().from(schema.socialPosts)
      .where(eq(schema.socialPosts.companyId, companyId))
      .orderBy(desc(schema.socialPosts.createdAt)).limit(20),
    db.select().from(schema.socialInteractions)
      .where(eq(schema.socialInteractions.companyId, companyId))
      .orderBy(desc(schema.socialInteractions.createdAt)).limit(20),
    db.select().from(schema.aiPipelineLogs)
      .where(eq(schema.aiPipelineLogs.companyId, companyId))
      .orderBy(desc(schema.aiPipelineLogs.createdAt)).limit(50),
  ]);

  type FeedItem = { type: string; timestamp: any; data: any };
  const feed: FeedItem[] = [
    ...posts.map(p => ({ type: 'post', timestamp: p.createdAt, data: p })),
    ...interactions.map(i => ({ type: 'interaction', timestamp: i.createdAt, data: i })),
    ...pipelineLogs.map(l => ({ type: 'brain', timestamp: l.createdAt, data: { brain: l.brainName, score: l.score, postId: l.postId, duration: l.durationMs } })),
  ].sort((a, b) => {
    const ta = a.timestamp instanceof Date ? a.timestamp.getTime() : Number(a.timestamp || 0);
    const tb = b.timestamp instanceof Date ? b.timestamp.getTime() : Number(b.timestamp || 0);
    return tb - ta;
  }).slice(0, 50);

  return c.json(feed);
});

// ─── Analytics ─────────────────────────────────────────────────────────────────

social.get('/companies/:id/social/analytics', async (c) => {
  const companyId = c.req.param('id');

  const posts = await db.select().from(schema.socialPosts)
    .where(eq(schema.socialPosts.companyId, companyId));

  const connections = await db.select().from(schema.socialConnections)
    .where(and(eq(schema.socialConnections.companyId, companyId), eq(schema.socialConnections.isActive, 1)));

  const interactions = await db.select().from(schema.socialInteractions)
    .where(eq(schema.socialInteractions.companyId, companyId));

  const totalPosts = posts.length;
  const publishedPosts = posts.filter(p => p.status === 'published').length;
  const totalImpressions = posts.reduce((sum, p) => sum + (p.impressions || 0), 0);
  const totalEngagements = posts.reduce((sum, p) => sum + (p.engagements || 0), 0);
  const avgScore = posts.length > 0 ? posts.reduce((sum, p) => sum + (p.finalScore || 0), 0) / posts.length : 0;

  const byPlatform: Record<string, { posts: number; published: number; impressions: number; engagements: number }> = {};
  for (const p of posts) {
    if (!byPlatform[p.platform]) byPlatform[p.platform] = { posts: 0, published: 0, impressions: 0, engagements: 0 };
    byPlatform[p.platform].posts++;
    if (p.status === 'published') byPlatform[p.platform].published++;
    byPlatform[p.platform].impressions += p.impressions || 0;
    byPlatform[p.platform].engagements += p.engagements || 0;
  }

  const sentimentBreakdown = {
    positive: interactions.filter(i => i.sentiment === 'positive').length,
    neutral: interactions.filter(i => i.sentiment === 'neutral').length,
    negative: interactions.filter(i => i.sentiment === 'negative').length,
  };

  return c.json({
    connectedPlatforms: connections.map(c => c.platform),
    totalPosts, publishedPosts, totalImpressions, totalEngagements,
    avgScore: Math.round(avgScore * 10) / 10,
    byPlatform, sentimentBreakdown,
    totalInteractions: interactions.length,
  });
});

// ─── Discord Server Management ─────────────────────────────────────────────────

// Manual re-setup of Discord guild channels (if the auto-setup during OAuth failed)
social.post('/companies/:id/discord/setup-guild', async (c) => {
  const companyId = c.req.param('id');
  
  const connection = await db.select().from(schema.socialConnections)
    .where(and(eq(schema.socialConnections.companyId, companyId), eq(schema.socialConnections.platform, 'discord'), eq(schema.socialConnections.isActive, 1)))
    .get();

  if (!connection?.metadata) return c.json({ error: 'No Discord connection with guild info' }, 400);
  const meta = JSON.parse(connection.metadata);
  if (!meta.guildId) return c.json({ error: 'No guild ID in connection metadata' }, 400);

  const company = await db.select().from(schema.companies).where(eq(schema.companies.id, companyId)).get();
  const result = await setupDiscordGuild(meta.guildId, company?.name || 'Community', companyId);

  // Clear old and insert new
  await db.delete(schema.communityChannels).where(
    and(eq(schema.communityChannels.companyId, companyId), eq(schema.communityChannels.platform, 'discord'))
  );
  for (const [chName, chId] of Object.entries(result.channelIds)) {
    await db.insert(schema.communityChannels).values({
      id: uuidv4(), companyId, platform: 'discord', channelType: 'channel', name: chName, platformId: chId, parentId: result.guildId,
    });
  }

  // Update connection metadata
  meta.channelIds = result.channelIds;
  meta.inviteUrl = result.inviteUrl;
  await db.update(schema.socialConnections).set({ metadata: JSON.stringify(meta) }).where(eq(schema.socialConnections.id, connection.id));

  return c.json({ guildId: result.guildId, channels: result.channelIds, inviteUrl: result.inviteUrl });
});

// ─── Marketplace ───────────────────────────────────────────────────────────────

social.get('/companies/:id/marketplace', async (c) => {
  const companyId = c.req.param('id');
  const listings = await db.select().from(schema.marketplaceListings)
    .where(eq(schema.marketplaceListings.companyId, companyId))
    .orderBy(desc(schema.marketplaceListings.createdAt));
  return c.json(listings);
});

social.post('/companies/:id/marketplace', async (c) => {
  const companyId = c.req.param('id');
  const body = await c.req.json() as any;
  const listing = {
    id: uuidv4(),
    companyId,
    title: body.title,
    description: body.description,
    category: body.category || 'product',
    price: body.price || 0,
    currency: body.currency || 'EUR',
    images: body.images ? JSON.stringify(body.images) : null,
    tags: body.tags ? JSON.stringify(body.tags) : null,
    sellerName: body.sellerName,
    contactEmail: body.contactEmail,
    externalUrl: body.externalUrl,
    status: 'active',
  };
  await db.insert(schema.marketplaceListings).values(listing);
  return c.json(listing);
});

social.get('/marketplace', async (c) => {
  const category = c.req.query('category');
  const listings = await db.select().from(schema.marketplaceListings)
    .where(eq(schema.marketplaceListings.status, 'active'))
    .orderBy(desc(schema.marketplaceListings.createdAt))
    .limit(50);
  const filtered = category ? listings.filter(l => l.category === category) : listings;
  return c.json(filtered);
});

// ─── Engagement (reply to interactions) ────────────────────────────────────────

social.post('/companies/:id/social/engage', async (c) => {
  const companyId = c.req.param('id');
  const { interactionId } = await c.req.json() as { interactionId: string };

  const interaction = await db.select().from(schema.socialInteractions)
    .where(eq(schema.socialInteractions.id, interactionId)).get();
  if (!interaction) return c.json({ error: 'Interaction not found' }, 404);

  const company = await db.select().from(schema.companies).where(eq(schema.companies.id, companyId)).get();
  if (!company) return c.json({ error: 'Company not found' }, 404);

  const result = await runEngagementPipeline({
    companyId,
    companyName: company.name,
    companyIdea: company.idea,
    soulMd: company.soulMd || undefined,
    interaction: {
      content: interaction.content || '',
      author: interaction.authorUsername || 'unknown',
      platform: interaction.platform,
      postId: interaction.postId || undefined,
    },
  });

  // Update interaction with AI response and whether it was actually sent
  await db.update(schema.socialInteractions).set({
    aiResponse: result.response,
    aiResponseStatus: result.replySent ? 'sent' : result.shouldRespond ? 'pending' : 'skipped',
    priority: result.priority,
  }).where(eq(schema.socialInteractions.id, interactionId));

  return c.json(result);
});

// ─── Learn Communication Style ─────────────────────────────────────────────────

social.post('/companies/:id/social/learn-style', async (c) => {
  const companyId = c.req.param('id');

  try {
    const [company] = await db.select().from(schema.companies).where(eq(schema.companies.id, companyId)).limit(1);
    if (!company) return c.json({ error: 'Company not found' }, 404);

    const connections = await db.select().from(schema.socialConnections).where(eq(schema.socialConnections.companyId, companyId));

    // Run pipeline with skipPublish (this is style learning, not actual content to post)
    const result = await runContentPipeline({
      companyId,
      companyName: company.name,
      companyIdea: company.idea,
      soulMd: company.soulMd || undefined,
      contentType: 'communication_style',
      topic: `Create a complete communication style guide for ${company.name}. Define tone, vocabulary, response patterns, emoji usage, humor level, formality. This will be used for ALL social interactions. Connected platforms: ${connections.map(c => c.platform).join(', ')}`,
      skipPublish: true,
    });

    // Store the style in soulMd
    const socialStyleSection = `\n\n## Social Communication Style\n${result.content}`;
    const updatedSoul = (company.soulMd || '') + socialStyleSection;
    await db.update(schema.companies).set({ soulMd: updatedSoul }).where(eq(schema.companies.id, companyId));

    return c.json({ success: true, style: result.content });
  } catch (err: any) {
    console.error('learn-style error:', err);
    return c.json({ error: err.message }, 500);
  }
});

// ─── Get Messages (for live feed) ──────────────────────────────────────────────

social.get('/companies/:id/social/messages', async (c) => {
  const companyId = c.req.param('id');

  try {
    const interactions = await db.select().from(schema.socialInteractions)
      .where(eq(schema.socialInteractions.companyId, companyId))
      .orderBy(desc(schema.socialInteractions.createdAt))
      .limit(20);

    const posts = await db.select().from(schema.socialPosts)
      .where(eq(schema.socialPosts.companyId, companyId))
      .orderBy(desc(schema.socialPosts.createdAt))
      .limit(20);

    const messages = [
      ...interactions.map(i => ({
        id: i.id,
        platform: i.platform,
        direction: 'in' as const,
        text: i.content || '',
        time: new Date(i.createdAt!).toLocaleTimeString('fr-BE', { hour: '2-digit', minute: '2-digit' }),
        author: i.authorUsername,
      })),
      ...posts.map(p => ({
        id: p.id,
        platform: p.platform,
        direction: 'out' as const,
        text: p.content || '',
        time: new Date(p.createdAt!).toLocaleTimeString('fr-BE', { hour: '2-digit', minute: '2-digit' }),
        author: 'AI',
      })),
    ].sort((a, b) => b.time.localeCompare(a.time)).slice(0, 20);

    return c.json({ messages });
  } catch (err: any) {
    return c.json({ messages: [] });
  }
});

// ─── Monitor Control Routes ──────────────────────────────────────────────────

social.get('/social/monitor/status', async (c) => {
  return c.json(getMonitorStatus());
});

social.post('/social/monitor/start', async (c) => {
  startSocialMonitor();
  return c.json({ ok: true, message: 'Monitor started' });
});

social.post('/social/monitor/stop', async (c) => {
  stopSocialMonitor();
  return c.json({ ok: true, message: 'Monitor stopped' });
});

export default social;
