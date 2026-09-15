/**
 * Platform Adapters — Twitter/X, Discord, Reddit, Instagram
 * 
 * Each adapter handles OAuth + API calls for its platform.
 * OAuth keys come from env vars (set later), user tokens from DB.
 */

import { db } from "../database/index";
import { eq, and } from "drizzle-orm";
import * as schema from "../database/schema";
import crypto from "crypto";

// ─── Types ─────────────────────────────────────────────────────────────────────

export interface PlatformAdapter {
  name: string;
  getAuthUrl(state: string, redirectUri: string): string | { url: string; codeVerifier?: string };
  exchangeCode(code: string, redirectUri: string, codeVerifier?: string): Promise<{ accessToken: string; refreshToken?: string; expiresAt?: Date; platformUserId: string; platformUsername: string }>;
  refreshAccessToken?(refreshToken: string): Promise<{ accessToken: string; refreshToken?: string; expiresAt?: Date }>;
  post(accessToken: string, content: string, options?: any): Promise<{ platformPostId: string; url: string }>;
  reply(accessToken: string, postId: string, content: string): Promise<{ platformPostId: string; url: string }>;
  getProfile(accessToken: string): Promise<{ id: string; username: string; displayName: string; followers: number; avatar?: string }>;
  getNotifications?(accessToken: string, since?: Date): Promise<Array<{ id: string; type: string; content: string; author: string; postId?: string; createdAt: Date }>>;
}

// ─── PKCE Helpers ──────────────────────────────────────────────────────────────

function generateCodeVerifier(): string {
  return crypto.randomBytes(32).toString('base64url');
}

function generateCodeChallenge(verifier: string): string {
  return crypto.createHash('sha256').update(verifier).digest('base64url');
}

// ─── Token Refresh Helper ──────────────────────────────────────────────────────

/**
 * Ensures we have a fresh access token. If expired (or within 5 min of expiry),
 * refreshes using the platform adapter and updates the DB.
 * Returns a valid access token.
 */
export async function ensureFreshToken(connection: {
  id: string;
  platform: string;
  accessToken: string;
  refreshToken: string | null;
  tokenExpiresAt: Date | null;
}): Promise<string> {
  const adapter = getPlatform(connection.platform);
  
  // If no expiry info or no refresh capability, return current token
  if (!connection.tokenExpiresAt || !connection.refreshToken || !adapter.refreshAccessToken) {
    return connection.accessToken;
  }

  // Check if token expires within 5 minutes
  const fiveMinFromNow = new Date(Date.now() + 5 * 60 * 1000);
  if (connection.tokenExpiresAt > fiveMinFromNow) {
    return connection.accessToken; // Still valid
  }

  // Token expired or expiring soon — refresh it
  console.log(`[token-refresh] Refreshing ${connection.platform} token for connection ${connection.id}`);
  try {
    const refreshed = await adapter.refreshAccessToken(connection.refreshToken);
    
    // Update DB with new tokens
    await db.update(schema.socialConnections).set({
      accessToken: refreshed.accessToken,
      refreshToken: refreshed.refreshToken || connection.refreshToken,
      tokenExpiresAt: refreshed.expiresAt,
      lastUsedAt: new Date(),
    }).where(eq(schema.socialConnections.id, connection.id));

    console.log(`[token-refresh] Successfully refreshed ${connection.platform} token`);
    return refreshed.accessToken;
  } catch (err) {
    console.error(`[token-refresh] Failed to refresh ${connection.platform} token:`, err);
    // Return current token as fallback — it might still work
    return connection.accessToken;
  }
}

// ─── Twitter/X Adapter ─────────────────────────────────────────────────────────

/**
 * Scopes demandés au compte X de l'utilisateur.
 *   tweet.read / tweet.write  → lire et publier des posts
 *   users.read                → identifier le compte connecté (@handle, followers)
 *   offline.access            → obtenir un refresh_token (sinon la connexion
 *                               expire au bout de 2 h et il faut se reconnecter)
 * NB : ces scopes exigent que l'app X soit en permission « Read and write ».
 */
const TWITTER_SCOPES = 'tweet.read tweet.write users.read offline.access';

/**
 * Appel du endpoint token de X, valable pour les deux types d'app :
 *   • confidential client (Client ID + Secret) → authentification HTTP Basic
 *   • public client (Client ID seul)           → client_id dans le corps
 * X renvoie des erreurs très laconiques : on les remonte telles quelles pour
 * qu'elles soient lisibles dans la fenêtre de connexion.
 */
async function twitterTokenRequest(
  params: Record<string, string>,
  label: string,
): Promise<any> {
  const clientId = process.env.TWITTER_CLIENT_ID || '';
  const clientSecret = process.env.TWITTER_CLIENT_SECRET || '';
  const headers: Record<string, string> = { 'Content-Type': 'application/x-www-form-urlencoded' };
  const body: Record<string, string> = { ...params };
  if (clientSecret) {
    headers.Authorization = `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString('base64')}`;
  } else {
    body.client_id = clientId;
  }

  const res = await fetch('https://api.twitter.com/2/oauth2/token', {
    method: 'POST',
    headers,
    body: new URLSearchParams(body),
  });
  const text = await res.text();
  if (!res.ok) {
    let hint = '';
    if (res.status === 401) hint = " — Client ID/Secret invalides, ou l'app X n'est pas un « Web App, Automated App or Bot » (confidential client).";
    else if (text.includes('redirect_uri')) hint = " — la Callback URI enregistrée dans le portail X ne correspond pas exactement à PUBLIC_URL.";
    else if (text.includes('code_verifier') || text.includes('invalid_grant')) hint = " — code expiré ou déjà utilisé : relance la connexion.";
    throw new Error(`Twitter ${label} failed (${res.status}): ${text}${hint}`);
  }
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`Twitter ${label} : réponse illisible de X (${text.slice(0, 120)})`);
  }
}

export const twitter: PlatformAdapter = {
  name: 'twitter',

  getAuthUrl(state: string, redirectUri: string) {
    const clientId = process.env.TWITTER_CLIENT_ID || '';
    const scopes = TWITTER_SCOPES;
    const codeVerifier = generateCodeVerifier();
    const codeChallenge = generateCodeChallenge(codeVerifier);
    // x.com est le domaine courant du flux d'autorisation (twitter.com redirige,
    // mais la redirection casse certains navigateurs en popup bloquée).
    const url = `https://x.com/i/oauth2/authorize?response_type=code&client_id=${encodeURIComponent(clientId)}&redirect_uri=${encodeURIComponent(redirectUri)}&scope=${encodeURIComponent(scopes)}&state=${state}&code_challenge=${codeChallenge}&code_challenge_method=S256`;
    return { url, codeVerifier };
  },

  async exchangeCode(code: string, redirectUri: string, codeVerifier?: string) {
    const data = await twitterTokenRequest(
      {
        code,
        grant_type: 'authorization_code',
        redirect_uri: redirectUri,
        code_verifier: codeVerifier || '',
      },
      'token exchange',
    );
    const profile = await this.getProfile(data.access_token);
    return { accessToken: data.access_token, refreshToken: data.refresh_token, expiresAt: new Date(Date.now() + data.expires_in * 1000), platformUserId: profile.id, platformUsername: profile.username };
  },

  async refreshAccessToken(refreshToken: string) {
    const data = await twitterTokenRequest(
      { refresh_token: refreshToken, grant_type: 'refresh_token' },
      'token refresh',
    );
    return { accessToken: data.access_token, refreshToken: data.refresh_token, expiresAt: new Date(Date.now() + data.expires_in * 1000) };
  },

  async post(accessToken: string, content: string) {
    // Handle threads: split by ---TWEET--- delimiter
    const tweets = content.split(/---TWEET---/i).map(t => t.trim()).filter(Boolean);
    
    // If single tweet and too long, truncate to 280 chars
    if (tweets.length === 1 && tweets[0].length > 280) {
      tweets[0] = tweets[0].slice(0, 277) + '...';
    }
    
    let firstTweetId = '';
    let lastTweetId = '';
    
    for (let i = 0; i < tweets.length; i++) {
      let tweetText = tweets[i];
      // Truncate individual tweets to 280 chars
      if (tweetText.length > 280) tweetText = tweetText.slice(0, 277) + '...';
      
      const body: any = { text: tweetText };
      // Thread: reply to previous tweet
      if (lastTweetId) {
        body.reply = { in_reply_to_tweet_id: lastTweetId };
      }
      
      console.log(`[twitter] Posting tweet ${i + 1}/${tweets.length}: "${tweetText.slice(0, 60)}..."`);
      const res = await fetch('https://api.twitter.com/2/tweets', {
        method: 'POST',
        headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const errText = await res.text();
        throw new Error(`Twitter post failed (${res.status}): ${errText}`);
      }
      const data = await res.json() as any;
      const tweetId = data.data?.id || '';
      if (i === 0) firstTweetId = tweetId;
      lastTweetId = tweetId;
    }
    
    return { platformPostId: firstTweetId, url: `https://x.com/i/status/${firstTweetId}` };
  },

  async reply(accessToken: string, postId: string, content: string) {
    const res = await fetch('https://api.twitter.com/2/tweets', {
      method: 'POST',
      headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: content, reply: { in_reply_to_tweet_id: postId } }),
    });
    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`Twitter reply failed (${res.status}): ${errText}`);
    }
    const data = await res.json() as any;
    return { platformPostId: data.data?.id || '', url: `https://x.com/i/status/${data.data?.id}` };
  },

  async getProfile(accessToken: string) {
    const res = await fetch('https://api.twitter.com/2/users/me?user.fields=public_metrics,profile_image_url', {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`Twitter getProfile failed (${res.status}): ${errText}`);
    }
    const data = await res.json() as any;
    return { id: data.data?.id || '', username: data.data?.username || '', displayName: data.data?.name || '', followers: data.data?.public_metrics?.followers_count || 0, avatar: data.data?.profile_image_url };
  },

  async getNotifications(accessToken: string, since?: Date) {
    const profile = await this.getProfile(accessToken);
    const res = await fetch(`https://api.twitter.com/2/users/${profile.id}/mentions?max_results=20&tweet.fields=created_at,author_id`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    const data = await res.json() as any;
    return (data.data || []).map((t: any) => ({
      id: t.id, type: 'mention', content: t.text, author: t.author_id, createdAt: new Date(t.created_at),
    }));
  },
};

// ─── Discord Adapter ───────────────────────────────────────────────────────────

export const discord: PlatformAdapter = {
  name: 'discord',

  getAuthUrl(state: string, redirectUri: string): string {
    const clientId = process.env.DISCORD_CLIENT_ID || '';
    // Use bot scope so Discord shows server selector and adds bot to the guild
    // permissions=8 = Administrator, lets the bot create channels, manage server etc.
    // Also request identify scope so we can get the user's profile
    const scopes = 'bot identify applications.commands';
    const permissions = '8'; // Administrator
    return `https://discord.com/api/oauth2/authorize?client_id=${clientId}&redirect_uri=${encodeURIComponent(redirectUri)}&response_type=code&scope=${encodeURIComponent(scopes)}&permissions=${permissions}&state=${state}`;
  },

  async exchangeCode(code: string, redirectUri: string) {
    console.log('[discord] Exchanging code for token...');
    const res = await fetch('https://discord.com/api/oauth2/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ client_id: process.env.DISCORD_CLIENT_ID || '', client_secret: process.env.DISCORD_CLIENT_SECRET || '', grant_type: 'authorization_code', code, redirect_uri: redirectUri }),
    });
    if (!res.ok) {
      const errText = await res.text();
      console.error(`[discord] Token exchange failed (${res.status}): ${errText}`);
      throw new Error(`Discord token exchange failed (${res.status}): ${errText}`);
    }
    const data = await res.json() as any;
    console.log('[discord] Token exchange success, scopes:', data.scope);
    
    // If we got an access_token with identify scope, get user profile
    let platformUserId = '';
    let platformUsername = '';
    if (data.access_token) {
      try {
        const profile = await this.getProfile(data.access_token);
        platformUserId = profile.id;
        platformUsername = profile.username;
        console.log('[discord] Got profile:', profile.username);
      } catch (e: any) {
        console.warn('[discord] Could not fetch profile:', e.message);
        // Fallback: use guild info if available
        if (data.guild) {
          platformUserId = data.guild.id;
          platformUsername = data.guild.name;
        }
      }
    }
    
    // Discord bot OAuth also returns guild info
    if (data.guild) {
      console.log('[discord] Guild from token exchange:', data.guild.id, data.guild.name);
    }
    
    return { 
      accessToken: data.access_token || process.env.DISCORD_BOT_TOKEN || '', 
      refreshToken: data.refresh_token || '', 
      expiresAt: new Date(Date.now() + (data.expires_in || 604800) * 1000), 
      platformUserId, 
      platformUsername,
      // Attach guild info for the callback to use
      _guildId: data.guild?.id,
      _guildName: data.guild?.name,
    };
  },

  async refreshAccessToken(refreshToken: string) {
    // Bot tokens don't expire, but if we have user tokens we can refresh
    if (!refreshToken) {
      return { accessToken: process.env.DISCORD_BOT_TOKEN || '', refreshToken: '', expiresAt: new Date(Date.now() + 365 * 86400000) };
    }
    const res = await fetch('https://discord.com/api/oauth2/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ client_id: process.env.DISCORD_CLIENT_ID || '', client_secret: process.env.DISCORD_CLIENT_SECRET || '', grant_type: 'refresh_token', refresh_token: refreshToken }),
    });
    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`Discord token refresh failed (${res.status}): ${errText}`);
    }
    const data = await res.json() as any;
    return { accessToken: data.access_token, refreshToken: data.refresh_token, expiresAt: new Date(Date.now() + data.expires_in * 1000) };
  },

  async post(accessToken: string, content: string, options?: { channelId: string }) {
    const channelId = options?.channelId;
    if (!channelId) throw new Error('Discord requires channelId');
    const botToken = process.env.DISCORD_BOT_TOKEN || '';
    const res = await fetch(`https://discord.com/api/v10/channels/${channelId}/messages`, {
      method: 'POST',
      headers: { Authorization: `Bot ${botToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ content }),
    });
    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`Discord post failed (${res.status}): ${errText}`);
    }
    const data = await res.json() as any;
    return { platformPostId: data.id || '', url: `https://discord.com/channels/${data.guild_id || ''}/${channelId}/${data.id}` };
  },

  async reply(accessToken: string, postId: string, content: string) {
    // postId format: "channelId:messageId" (set by monitor) or just messageId
    const botToken = process.env.DISCORD_BOT_TOKEN || '';
    let channelId: string;
    let messageId: string;
    if (postId.includes(':')) {
      [channelId, messageId] = postId.split(':');
    } else {
      // Fallback: try to get channel from message
      messageId = postId;
      // We need channelId — try fetching from Discord (not ideal, but works)
      throw new Error('Discord reply requires postId format "channelId:messageId"');
    }
    const res = await fetch(`https://discord.com/api/v10/channels/${channelId}/messages`, {
      method: 'POST',
      headers: { Authorization: `Bot ${botToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ content, message_reference: { message_id: messageId } }),
    });
    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`Discord reply failed (${res.status}): ${errText}`);
    }
    const data = await res.json() as any;
    return { platformPostId: data.id || '', url: `https://discord.com/channels/${data.guild_id || ''}/${channelId}/${data.id}` };
  },

  async getProfile(accessToken: string) {
    const res = await fetch('https://discord.com/api/v10/users/@me', {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`Discord getProfile failed (${res.status}): ${errText}`);
    }
    const data = await res.json() as any;
    return { id: data.id || '', username: data.username || '', displayName: data.global_name || data.username || '', followers: 0, avatar: data.avatar ? `https://cdn.discordapp.com/avatars/${data.id}/${data.avatar}.png` : undefined };
  },
};

// ─── Reddit Adapter ────────────────────────────────────────────────────────────

export const reddit: PlatformAdapter = {
  name: 'reddit',

  getAuthUrl(state: string, redirectUri: string): string {
    const clientId = process.env.REDDIT_CLIENT_ID || '';
    const scopes = 'identity submit read mysubreddits';
    return `https://www.reddit.com/api/v1/authorize?client_id=${clientId}&response_type=code&state=${state}&redirect_uri=${encodeURIComponent(redirectUri)}&duration=permanent&scope=${scopes}`;
  },

  async exchangeCode(code: string, redirectUri: string) {
    const res = await fetch('https://www.reddit.com/api/v1/access_token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', Authorization: `Basic ${Buffer.from(`${process.env.REDDIT_CLIENT_ID}:${process.env.REDDIT_CLIENT_SECRET}`).toString('base64')}`, 'User-Agent': 'Velbaz/1.0' },
      body: new URLSearchParams({ grant_type: 'authorization_code', code, redirect_uri: redirectUri }),
    });
    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`Reddit token exchange failed (${res.status}): ${errText}`);
    }
    const data = await res.json() as any;
    const profile = await this.getProfile(data.access_token);
    return { accessToken: data.access_token, refreshToken: data.refresh_token, expiresAt: new Date(Date.now() + data.expires_in * 1000), platformUserId: profile.id, platformUsername: profile.username };
  },

  async refreshAccessToken(refreshToken: string) {
    const res = await fetch('https://www.reddit.com/api/v1/access_token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', Authorization: `Basic ${Buffer.from(`${process.env.REDDIT_CLIENT_ID}:${process.env.REDDIT_CLIENT_SECRET}`).toString('base64')}`, 'User-Agent': 'Velbaz/1.0' },
      body: new URLSearchParams({ grant_type: 'refresh_token', refresh_token: refreshToken }),
    });
    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`Reddit token refresh failed (${res.status}): ${errText}`);
    }
    const data = await res.json() as any;
    return { accessToken: data.access_token, refreshToken: data.refresh_token, expiresAt: new Date(Date.now() + data.expires_in * 1000) };
  },

  async post(accessToken: string, content: string, options?: { subreddit: string; title: string }) {
    const res = await fetch('https://oauth.reddit.com/api/submit', {
      method: 'POST',
      headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': 'Velbaz/1.0' },
      body: new URLSearchParams({ kind: 'self', sr: options?.subreddit || '', title: options?.title || '', text: content }),
    });
    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`Reddit post failed (${res.status}): ${errText}`);
    }
    const data = await res.json() as any;
    const postUrl = data?.json?.data?.url || '';
    return { platformPostId: data?.json?.data?.id || '', url: postUrl };
  },

  async reply(accessToken: string, postId: string, content: string) {
    const res = await fetch('https://oauth.reddit.com/api/comment', {
      method: 'POST',
      headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': 'Velbaz/1.0' },
      body: new URLSearchParams({ thing_id: postId, text: content }),
    });
    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`Reddit reply failed (${res.status}): ${errText}`);
    }
    const data = await res.json() as any;
    return { platformPostId: data?.json?.data?.things?.[0]?.data?.id || '', url: '' };
  },

  async getProfile(accessToken: string) {
    const res = await fetch('https://oauth.reddit.com/api/v1/me', {
      headers: { Authorization: `Bearer ${accessToken}`, 'User-Agent': 'Velbaz/1.0' },
    });
    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`Reddit getProfile failed (${res.status}): ${errText}`);
    }
    const data = await res.json() as any;
    return { id: data.id || '', username: data.name || '', displayName: data.subreddit?.title || data.name || '', followers: data.subreddit?.subscribers || 0, avatar: data.icon_img };
  },
};

// ─── Instagram Adapter ─────────────────────────────────────────────────────────

export const instagram: PlatformAdapter = {
  name: 'instagram',

  getAuthUrl(state: string, redirectUri: string): string {
    const clientId = process.env.INSTAGRAM_CLIENT_ID || '';
    const scopes = 'instagram_basic,instagram_content_publish,instagram_manage_comments,instagram_manage_insights';
    return `https://api.instagram.com/oauth/authorize?client_id=${clientId}&redirect_uri=${encodeURIComponent(redirectUri)}&scope=${scopes}&response_type=code&state=${state}`;
  },

  async exchangeCode(code: string, redirectUri: string) {
    // Step 1: short-lived token
    const res1 = await fetch('https://api.instagram.com/oauth/access_token', {
      method: 'POST',
      body: new URLSearchParams({ client_id: process.env.INSTAGRAM_CLIENT_ID || '', client_secret: process.env.INSTAGRAM_CLIENT_SECRET || '', grant_type: 'authorization_code', redirect_uri: redirectUri, code }),
    });
    if (!res1.ok) {
      const errText = await res1.text();
      throw new Error(`Instagram short token exchange failed (${res1.status}): ${errText}`);
    }
    const short = await res1.json() as any;
    // Step 2: exchange for long-lived
    const res2 = await fetch(`https://graph.instagram.com/access_token?grant_type=ig_exchange_token&client_secret=${process.env.INSTAGRAM_CLIENT_SECRET}&access_token=${short.access_token}`);
    const long = await res2.json() as any;
    const profile = await this.getProfile(long.access_token || short.access_token);
    return { accessToken: long.access_token || short.access_token, refreshToken: long.access_token, expiresAt: new Date(Date.now() + (long.expires_in || 3600) * 1000), platformUserId: short.user_id?.toString() || profile.id, platformUsername: profile.username };
  },

  async refreshAccessToken(refreshToken: string) {
    // Instagram long-lived tokens can be refreshed
    const res = await fetch(`https://graph.instagram.com/refresh_access_token?grant_type=ig_refresh_token&access_token=${refreshToken}`);
    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`Instagram token refresh failed (${res.status}): ${errText}`);
    }
    const data = await res.json() as any;
    return { accessToken: data.access_token, expiresAt: new Date(Date.now() + (data.expires_in || 5184000) * 1000) };
  },

  async post(accessToken: string, content: string, options?: { imageUrl?: string }) {
    // Instagram Graph API requires media (image/video) — text-only not supported
    const igUserId = (await this.getProfile(accessToken)).id;
    if (!options?.imageUrl) {
      return { platformPostId: '', url: `https://instagram.com` };
    }
    // Step 1: Create media container
    const res1 = await fetch(`https://graph.instagram.com/${igUserId}/media`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ image_url: options.imageUrl, caption: content, access_token: accessToken }),
    });
    if (!res1.ok) {
      const errText = await res1.text();
      throw new Error(`Instagram media container creation failed (${res1.status}): ${errText}`);
    }
    const container = await res1.json() as any;
    // Step 2: Publish
    const res2 = await fetch(`https://graph.instagram.com/${igUserId}/media_publish`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ creation_id: container.id, access_token: accessToken }),
    });
    if (!res2.ok) {
      const errText = await res2.text();
      throw new Error(`Instagram publish failed (${res2.status}): ${errText}`);
    }
    const pub = await res2.json() as any;
    return { platformPostId: pub.id || '', url: `https://instagram.com/p/${pub.id}` };
  },

  async reply(accessToken: string, postId: string, content: string) {
    const res = await fetch(`https://graph.instagram.com/${postId}/replies`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: content, access_token: accessToken }),
    });
    const data = await res.json() as any;
    return { platformPostId: data.id || '', url: '' };
  },

  async getProfile(accessToken: string) {
    const res = await fetch(`https://graph.instagram.com/me?fields=id,username,account_type,media_count&access_token=${accessToken}`);
    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`Instagram getProfile failed (${res.status}): ${errText}`);
    }
    const data = await res.json() as any;
    return { id: data.id || '', username: data.username || '', displayName: data.username || '', followers: 0, avatar: undefined };
  },
};

// ─── Discord Server Management ─────────────────────────────────────────────────

/**
 * Setup channels in an existing Discord guild where the bot is already a member.
 * Called after the bot-invite OAuth flow adds the bot to a user's server.
 */
export async function setupDiscordGuild(guildId: string, companyName: string, companyId?: string): Promise<{ guildId: string; channelIds: Record<string, string>; inviteUrl: string }> {
  const botToken = process.env.DISCORD_BOT_TOKEN || '';
  const headers = { Authorization: `Bot ${botToken}`, 'Content-Type': 'application/json' };
  
  console.log(`[discord] Setting up guild ${guildId} for "${companyName}"...`);
  
  // Set guild icon from company logo if available
  if (companyId) {
    try {
      const logoAsset = await db.select({ content: schema.designAssets.content }).from(schema.designAssets)
        .where(and(eq(schema.designAssets.companyId, companyId), eq(schema.designAssets.type, 'logo')))
        .get();
      
      let logoDataUri = '';
      if (logoAsset?.content) {
        // Content is already a data URI like "data:image/png;base64,..."
        // But might have "data:undefined;base64," — fix the mime type
        let content = logoAsset.content;
        if (content.includes('data:undefined;')) {
          content = content.replace('data:undefined;', 'data:image/png;');
        }
        logoDataUri = content;
      }
      
      if (!logoDataUri) {
        // Fallback: check documents table for image_logo
        const logoDoc = await db.select({ content: schema.documents.content }).from(schema.documents)
          .where(and(eq(schema.documents.companyId, companyId), eq(schema.documents.type, 'image_logo')))
          .get();
        if (logoDoc?.content) {
          let content = logoDoc.content;
          if (content.includes('data:undefined;')) {
            content = content.replace('data:undefined;', 'data:image/png;');
          }
          logoDataUri = content;
        }
      }
      
      if (logoDataUri) {
        console.log(`[discord] Setting guild icon from company logo...`);
        const iconRes = await fetch(`https://discord.com/api/v10/guilds/${guildId}`, {
          method: 'PATCH', headers,
          body: JSON.stringify({ icon: logoDataUri }),
        });
        if (iconRes.ok) {
          console.log(`[discord] Guild icon set successfully!`);
        } else {
          const errText = await iconRes.text();
          console.warn(`[discord] Failed to set guild icon: ${errText}`);
        }
      }
    } catch (e: any) {
      console.warn(`[discord] Error setting guild icon:`, e.message);
    }
  }
  
  // Step 1: Get existing channels so we don't create duplicates
  const channelsRes = await fetch(`https://discord.com/api/v10/guilds/${guildId}/channels`, {
    headers: { Authorization: `Bot ${botToken}` },
  });
  
  let existingChannels: any[] = [];
  if (channelsRes.ok) {
    existingChannels = await channelsRes.json() as any[];
    console.log(`[discord] Guild has ${existingChannels.length} existing channels`);
  } else {
    const errText = await channelsRes.text();
    console.error(`[discord] Failed to get channels (${channelsRes.status}): ${errText}`);
    throw new Error(`Cannot access guild channels (${channelsRes.status}): ${errText}`);
  }

  // Check if we already set up this guild (look for our category names)
  const ourCategoryNames = ['📋 Welcome', '💬 General', '📢 Updates', '🛟 Support', '🌟 Community', '🔊 Voice'];
  const alreadySetup = existingChannels.some((ch: any) => ch.type === 4 && ourCategoryNames.includes(ch.name));
  
  if (alreadySetup) {
    console.log(`[discord] Guild already set up, collecting existing channel IDs...`);
    const channelIds: Record<string, string> = {};
    for (const ch of existingChannels) {
      if (ch.type === 0 || ch.type === 2) { // text or voice
        channelIds[ch.name] = ch.id;
      }
    }
    
    // Enforce read-only permissions on announcement/info channels
    const roChannels = ['welcome', 'rules', 'announcements', 'changelog', 'tips-and-tricks'];
    const botId = process.env.DISCORD_CLIENT_ID || '';
    for (const chName of roChannels) {
      const chId = channelIds[chName];
      if (!chId) continue;
      // Deny SEND_MESSAGES for @everyone
      await fetch(`https://discord.com/api/v10/channels/${chId}/permissions/${guildId}`, {
        method: 'PUT', headers,
        body: JSON.stringify({ allow: '1024', deny: '2048', type: 0 }),
      });
      // Allow SEND_MESSAGES for bot
      await fetch(`https://discord.com/api/v10/channels/${chId}/permissions/${botId}`, {
        method: 'PUT', headers,
        body: JSON.stringify({ allow: '274877909056', deny: '0', type: 1 }),
      });
    }
    
    // Get invite
    let inviteUrl = '';
    const firstCh = channelIds['welcome'] || channelIds['general-chat'] || Object.values(channelIds)[0];
    if (firstCh) {
      try {
        const invRes = await fetch(`https://discord.com/api/v10/channels/${firstCh}/invites`, { headers: { Authorization: `Bot ${botToken}` } });
        if (invRes.ok) {
          const invites = await invRes.json() as any[];
          if (invites.length > 0) inviteUrl = `https://discord.gg/${invites[0].code}`;
        }
      } catch {}
    }
    return { guildId, channelIds, inviteUrl };
  }

  // Channels that should be READ-ONLY for members (only bot/AI can post)
  const readOnlyChannels = new Set(['welcome', 'rules', 'announcements', 'changelog', 'tips-and-tricks']);
  
  // Discord permission bits
  const SEND_MESSAGES = '2048';      // 0x800
  const SEND_MESSAGES_IN_THREADS = '274877906944'; // 0x4000000000
  const ADD_REACTIONS = '64';        // 0x40
  const VIEW_CHANNEL = '1024';       // 0x400
  
  const botClientId = process.env.DISCORD_CLIENT_ID || '';
  
  // Helper to create a channel with optional permission overwrites
  const createChannel = async (name: string, type: number, parentId?: string, isReadOnly?: boolean): Promise<{ id: string; name: string }> => {
    const body: any = { name, type };
    if (parentId) body.parent_id = parentId;
    
    // If read-only: deny SEND_MESSAGES for @everyone, allow for bot
    if (isReadOnly) {
      body.permission_overwrites = [
        {
          id: guildId, // @everyone role ID = guild ID
          type: 0,     // 0 = role overwrite
          allow: VIEW_CHANNEL,
          deny: SEND_MESSAGES,
        },
        {
          id: botClientId, // Bot application/user
          type: 1,         // 1 = member overwrite
          allow: (BigInt(SEND_MESSAGES) | BigInt(SEND_MESSAGES_IN_THREADS) | BigInt(ADD_REACTIONS)).toString(),
          deny: '0',
        },
      ];
    }
    
    const res = await fetch(`https://discord.com/api/v10/guilds/${guildId}/channels`, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const errText = await res.text();
      console.warn(`[discord] Channel "${name}" failed: ${errText}`);
      return { id: '', name };
    }
    const ch = await res.json() as any;
    console.log(`[discord] Channel "${name}" created${isReadOnly ? ' (read-only)' : ''}: ${ch.id}`);
    return { id: ch.id, name: ch.name };
  };

  // Step 2: Create categories + channels
  // readOnly flag marks channels where only the bot can post
  const categories = [
    { name: '📋 Welcome', channels: [
      { name: 'welcome', type: 0, readOnly: true },
      { name: 'rules', type: 0, readOnly: true },
      { name: 'introductions', type: 0, readOnly: false },
    ]},
    { name: '💬 General', channels: [
      { name: 'general-chat', type: 0, readOnly: false },
      { name: 'off-topic', type: 0, readOnly: false },
    ]},
    { name: '📢 Updates', channels: [
      { name: 'announcements', type: 0, readOnly: true },
      { name: 'changelog', type: 0, readOnly: true },
      { name: 'tips-and-tricks', type: 0, readOnly: true },
    ]},
    { name: '🛟 Support', channels: [
      { name: 'help', type: 0, readOnly: false },
      { name: 'bug-reports', type: 0, readOnly: false },
      { name: 'feature-requests', type: 0, readOnly: false },
    ]},
    { name: '🌟 Community', channels: [
      { name: 'showcase', type: 0, readOnly: false },
      { name: 'feedback', type: 0, readOnly: false },
    ]},
    { name: '🔊 Voice', channels: [
      { name: 'voice-chat', type: 2, readOnly: false },
    ]},
  ];

  const channelIds: Record<string, string> = {};

  for (const cat of categories) {
    const category = await createChannel(cat.name, 4); // 4 = GUILD_CATEGORY
    if (!category.id) continue;
    for (const ch of cat.channels) {
      const created = await createChannel(ch.name, ch.type, category.id, ch.readOnly);
      if (created.id) {
        channelIds[created.name] = created.id;
      }
    }
  }

  console.log(`[discord] Created ${Object.keys(channelIds).length} channels`);

  // Step 3: Delete old default channels (the ones Discord auto-creates)
  for (const ch of existingChannels) {
    if (!Object.values(channelIds).includes(ch.id)) {
      try {
        await fetch(`https://discord.com/api/v10/channels/${ch.id}`, {
          method: 'DELETE',
          headers: { Authorization: `Bot ${botToken}` },
        });
      } catch {}
    }
  }
  
  // Step 4: Create permanent invite
  const firstTextChannel = channelIds['welcome'] || channelIds['general-chat'] || Object.values(channelIds)[0];
  let inviteUrl = '';
  if (firstTextChannel) {
    try {
      const invRes = await fetch(`https://discord.com/api/v10/channels/${firstTextChannel}/invites`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ max_age: 0, max_uses: 0, unique: false }),
      });
      if (invRes.ok) {
        const inv = await invRes.json() as any;
        inviteUrl = `https://discord.gg/${inv.code}`;
        console.log(`[discord] Invite created: ${inviteUrl}`);
      }
    } catch (e) {
      console.warn('[discord] Could not create invite:', e);
    }
  }
  
  return { guildId, channelIds, inviteUrl };
}

// ─── Demo/Simulation Mode ──────────────────────────────────────────────────────

/**
 * Returns true if we have real API keys for the given platform.
 * When false, the system runs in demo mode (simulated connections & posts).
 */
export function hasRealKeys(platform: string): boolean {
  switch (platform) {
    case 'twitter': return !!(process.env.TWITTER_CLIENT_ID && process.env.TWITTER_CLIENT_SECRET);
    case 'discord': return !!(process.env.DISCORD_CLIENT_ID && process.env.DISCORD_CLIENT_SECRET);
    case 'reddit': return !!(process.env.REDDIT_CLIENT_ID && process.env.REDDIT_CLIENT_SECRET);
    case 'instagram': return !!(process.env.INSTAGRAM_CLIENT_ID && process.env.INSTAGRAM_CLIENT_SECRET);
    default: return false;
  }
}

/** Demo adapter — simulates posting when no real API keys are configured */
const demoAdapter: PlatformAdapter = {
  name: 'demo',
  getAuthUrl(state: string, redirectUri: string) {
    return `${redirectUri}?code=demo_code_${Date.now()}&state=${state}`;
  },
  async exchangeCode(code: string) {
    return {
      accessToken: `demo_token_${Date.now()}`,
      refreshToken: `demo_refresh_${Date.now()}`,
      expiresAt: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000), // 1 year
      platformUserId: `demo_user_${Date.now()}`,
      platformUsername: 'demo_account',
    };
  },
  async refreshAccessToken(refreshToken: string) {
    return {
      accessToken: `demo_token_${Date.now()}`,
      refreshToken,
      expiresAt: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000),
    };
  },
  async post(accessToken: string, content: string) {
    const id = `demo_post_${Date.now()}`;
    console.log(`[demo-publish] Content posted (simulated): ${content.slice(0, 100)}...`);
    return { platformPostId: id, url: `https://demo.example.com/post/${id}` };
  },
  async reply(accessToken: string, postId: string, content: string) {
    const id = `demo_reply_${Date.now()}`;
    console.log(`[demo-reply] Reply sent (simulated): ${content.slice(0, 100)}...`);
    return { platformPostId: id, url: `https://demo.example.com/reply/${id}` };
  },
  async getProfile(accessToken: string) {
    return { id: 'demo_user', username: 'demo_account', displayName: 'Demo Account', followers: 0 };
  },
};

// ─── Platform Registry ──────────────────────────────────────────────────────────

export const platforms: Record<string, PlatformAdapter> = { twitter, discord, reddit, instagram };

/**
 * Returns the real adapter if API keys are configured, otherwise returns the demo adapter.
 */
export function getPlatform(name: string): PlatformAdapter {
  const p = platforms[name];
  if (!p) throw new Error(`Unknown platform: ${name}`);
  
  // No demo mode — require real API keys
  if (!hasRealKeys(name)) {
    throw new Error(`No API keys configured for ${name}. Set ${name.toUpperCase()}_CLIENT_ID and ${name.toUpperCase()}_CLIENT_SECRET in .env`);
  }
  
  console.log(`[getPlatform] Using REAL adapter for ${name}`);
  
  return p;
}
