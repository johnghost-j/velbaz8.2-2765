// ─── Secret Store sécurisé (AES-256-GCM) + résolveur runtime ─────────────────
//
// Objectif : permettre à l'admin de saisir des clés API depuis le panel admin,
// les stocker CHIFFRÉES au repos, et les résoudre au runtime — SANS jamais
// exposer la valeur en clair au front (write-only).
//
// Sécurité :
//   - Chiffrement AES-256-GCM. La master key est dérivée (scrypt) d'un secret
//     serveur (SECRET_STORE_KEY, repli BETTER_AUTH_SECRET). Elle vit UNIQUEMENT
//     dans l'env, jamais en base. Sans elle, les valeurs chiffrées sont illisibles.
//   - L'API ne renvoie jamais la valeur déchiffrée : seulement { isSet, last4 }.
//   - Déchiffrement uniquement ici, côté serveur, au moment de l'usage.
//   - Cache mémoire (déchiffré) pour éviter de taper la DB à chaque appel IA ;
//     rafraîchi à chaque écriture/suppression + au boot.
//
import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from 'node:crypto';
import { db } from './database/index';
import * as schema from './database/schema';
import { eq } from 'drizzle-orm';
import { setProviderKeys, type CustomProvider } from './agent/gateway';

// ── Master key (dérivée, jamais stockée) ──
function masterKey(): Buffer {
  const secret =
    process.env.SECRET_STORE_KEY ||
    process.env.BETTER_AUTH_SECRET ||
    'velbaz-insecure-dev-fallback-change-me';
  // Sel fixe : on veut une clé déterministe par déploiement (sinon on ne pourrait
  // plus déchiffrer). La robustesse vient du secret lui-même (48 octets aléatoires).
  return scryptSync(secret, 'velbaz-secret-store::v1', 32);
}

/** Chiffre une valeur en clair -> "v1:ivB64:tagB64:cipherB64". */
export function encryptSecret(plain: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', masterKey(), iv);
  const enc = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `v1:${iv.toString('base64')}:${tag.toString('base64')}:${enc.toString('base64')}`;
}

/** Déchiffre "v1:iv:tag:cipher" -> clair. Renvoie null si corrompu / mauvaise clé. */
export function decryptSecret(payload: string | null | undefined): string | null {
  if (!payload) return null;
  try {
    const [v, ivB64, tagB64, dataB64] = payload.split(':');
    if (v !== 'v1' || !ivB64 || !tagB64 || !dataB64) return null;
    const decipher = createDecipheriv('aes-256-gcm', masterKey(), Buffer.from(ivB64, 'base64'));
    decipher.setAuthTag(Buffer.from(tagB64, 'base64'));
    const dec = Buffer.concat([decipher.update(Buffer.from(dataB64, 'base64')), decipher.final()]);
    return dec.toString('utf8');
  } catch {
    return null;
  }
}

function last4(s: string): string {
  return s.length <= 4 ? '••••' : s.slice(-4);
}

// ── Caches mémoire (valeurs déchiffrées, jamais envoyées au front) ──
const secretCache: Map<string, string> = ((globalThis as any).__velbaz_secret_cache ??= new Map());
const providerCache: Map<string, { apiKey: string; baseUrl?: string; enabled: boolean; status: string }> =
  ((globalThis as any).__velbaz_provider_cache ??= new Map());

// Noms de secrets "génériques" gérés par le panel (hors clés IA providers).
export const KNOWN_SECRETS = [
  'RESEND_API_KEY',
  'RESEND_FROM',
  'HF_CREDENTIALS',
  'HF_API_KEY',
  'HF_API_SECRET',
  'GITHUB_TOKEN',
  'GITHUB_OWNER',
  'EMAIL_WEBHOOK_SECRET',
  // ── Stripe (clé secrète live/test + secret de signature webhook) ──
  // Stockées CHIFFRÉES, saisies depuis l'Admin Panel. Jamais hardcodées.
  'STRIPE_SECRET_KEY',
  'STRIPE_WEBHOOK_SECRET',
  // ── Publication / hébergement ("Publish your website") ──
  // Jeton du fournisseur de déploiement (ex. Vercel/Netlify) utilisé pour
  // provisionner un vrai domaine + un domaine personnalisé. Optionnel : sans lui,
  // le site est quand même publié sur l'hébergement interne Velbaz (/s/:subdomain).
  'VELBAZ_DEPLOY_TOKEN',
] as const;

export const AI_PROVIDERS = ['openai', 'anthropic', 'google', 'custom'] as const;
export type AiProvider = (typeof AI_PROVIDERS)[number];

// ─── Résolution runtime d'un secret : cache -> DB -> process.env ─────────────
export function getSecret(name: string): string {
  const cached = secretCache.get(name);
  if (cached !== undefined) return cached;
  // Pas en cache : repli env (le cache est peuplé au boot par loadAllSecrets()).
  return process.env[name] || '';
}

/** Pousse la config providers déchiffrée vers le gateway (routing clé perso). */
function syncGateway() {
  const map: Record<string, CustomProvider> = {};
  for (const [provider, cfg] of providerCache) {
    // Routage DIRECT uniquement si : activé + clé présente + PAS marquée invalide.
    // Une clé non encore testée ('unknown') est tentée en direct ; dès qu'un test
    // la marque 'invalid', elle est retirée -> repli automatique sur le gateway.
    if (cfg.enabled && cfg.apiKey && cfg.status !== 'invalid') {
      map[provider] = { apiKey: cfg.apiKey, baseUrl: cfg.baseUrl };
    }
  }
  setProviderKeys(map);
}

// ─── Chargement initial (boot) : DB -> caches ────────────────────────────────
export async function loadAllSecrets(): Promise<void> {
  try {
    const rows = await db.select().from(schema.secretStore);
    secretCache.clear();
    for (const r of rows) {
      const v = decryptSecret(r.valueEnc);
      if (v != null) secretCache.set(r.name, v);
    }
    const providers = await db.select().from(schema.aiProviderConfig);
    providerCache.clear();
    for (const p of providers) {
      const key = decryptSecret(p.apiKeyEnc);
      if (key != null) {
        providerCache.set(p.provider, {
          apiKey: key,
          baseUrl: p.baseUrl || undefined,
          enabled: !!p.enabled,
          status: p.status || 'unknown',
        });
      }
    }
    syncGateway();
    console.log(
      `[secret-store] chargé : ${secretCache.size} secret(s), ${providerCache.size} provider(s) IA`,
    );
  } catch (e) {
    console.warn('[secret-store] chargement initial échoué (tables manquantes ?) :', (e as Error).message);
  }
}

// ─── Écriture / suppression secrets génériques ───────────────────────────────
export async function setSecret(name: string, value: string, updatedBy?: string): Promise<void> {
  const enc = encryptSecret(value);
  const now = new Date();
  await db
    .insert(schema.secretStore)
    .values({ name, valueEnc: enc, last4: last4(value), updatedBy: updatedBy || null, updatedAt: now })
    .onConflictDoUpdate({
      target: schema.secretStore.name,
      set: { valueEnc: enc, last4: last4(value), updatedBy: updatedBy || null, updatedAt: now },
    });
  secretCache.set(name, value);
}

export async function deleteSecret(name: string): Promise<void> {
  await db.delete(schema.secretStore).where(eq(schema.secretStore.name, name));
  secretCache.delete(name);
}

// ─── Écriture / suppression providers IA ─────────────────────────────────────
export async function setAiProvider(
  provider: AiProvider,
  apiKey: string,
  opts: { baseUrl?: string; updatedBy?: string } = {},
): Promise<void> {
  const enc = encryptSecret(apiKey);
  const now = new Date();
  await db
    .insert(schema.aiProviderConfig)
    .values({
      provider,
      apiKeyEnc: enc,
      baseUrl: opts.baseUrl || null,
      enabled: true,
      status: 'unknown',
      last4: last4(apiKey),
      updatedBy: opts.updatedBy || null,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: schema.aiProviderConfig.provider,
      set: {
        apiKeyEnc: enc,
        baseUrl: opts.baseUrl || null,
        enabled: true,
        status: 'unknown',
        last4: last4(apiKey),
        updatedBy: opts.updatedBy || null,
        updatedAt: now,
      },
    });
  providerCache.set(provider, { apiKey, baseUrl: opts.baseUrl, enabled: true, status: 'unknown' });
  syncGateway();
}

export async function setAiProviderEnabled(provider: AiProvider, enabled: boolean): Promise<void> {
  await db
    .update(schema.aiProviderConfig)
    .set({ enabled, updatedAt: new Date() })
    .where(eq(schema.aiProviderConfig.provider, provider));
  const cur = providerCache.get(provider);
  if (cur) providerCache.set(provider, { ...cur, enabled });
  syncGateway();
}

export async function deleteAiProvider(provider: AiProvider): Promise<void> {
  await db.delete(schema.aiProviderConfig).where(eq(schema.aiProviderConfig.provider, provider));
  providerCache.delete(provider);
  syncGateway();
}

export async function setAiProviderStatus(
  provider: AiProvider,
  status: 'valid' | 'invalid' | 'unknown',
  message?: string,
): Promise<void> {
  await db
    .update(schema.aiProviderConfig)
    .set({ status, statusMessage: message || null, updatedAt: new Date() })
    .where(eq(schema.aiProviderConfig.provider, provider));
  const cur = providerCache.get(provider);
  if (cur) providerCache.set(provider, { ...cur, status });
  // Re-synchronise le gateway : une clé marquée 'invalid' est retirée du routage
  // direct (repli gateway) ; une clé re-validée y est réintégrée.
  syncGateway();
}

/** Renvoie la clé déchiffrée d'un provider (usage serveur uniquement, ex. test). */
export function getAiProviderKey(provider: string): { apiKey: string; baseUrl?: string } | null {
  const c = providerCache.get(provider);
  return c && c.apiKey ? { apiKey: c.apiKey, baseUrl: c.baseUrl } : null;
}

// ─── Statuts write-only pour le panel (JAMAIS la valeur en clair) ────────────
export async function listSecretStatus(): Promise<
  Array<{ name: string; isSet: boolean; last4: string | null; updatedAt: number | null; source: 'db' | 'env' | 'none' }>
> {
  const rows = await db.select().from(schema.secretStore);
  const byName = new Map(rows.map((r) => [r.name, r]));
  return KNOWN_SECRETS.map((name) => {
    const row = byName.get(name);
    if (row) {
      return {
        name,
        isSet: true,
        last4: row.last4,
        updatedAt: row.updatedAt ? new Date(row.updatedAt).getTime() : null,
        source: 'db' as const,
      };
    }
    const envVal = process.env[name];
    return {
      name,
      isSet: !!(envVal && envVal.replace(/"/g, '').trim()),
      last4: envVal ? last4(envVal) : null,
      updatedAt: null,
      source: (envVal ? 'env' : 'none') as 'env' | 'none',
    };
  });
}

export async function listAiProviderStatus(): Promise<
  Array<{ provider: string; isSet: boolean; last4: string | null; baseUrl: string | null; enabled: boolean; status: string; statusMessage: string | null; updatedAt: number | null }>
> {
  const rows = await db.select().from(schema.aiProviderConfig);
  const byProvider = new Map(rows.map((r) => [r.provider, r]));
  return AI_PROVIDERS.map((provider) => {
    const row = byProvider.get(provider);
    if (!row) {
      return { provider, isSet: false, last4: null, baseUrl: null, enabled: false, status: 'none', statusMessage: null, updatedAt: null };
    }
    return {
      provider,
      isSet: true,
      last4: row.last4,
      baseUrl: row.baseUrl,
      enabled: !!row.enabled,
      status: row.status || 'unknown',
      statusMessage: row.statusMessage,
      updatedAt: row.updatedAt ? new Date(row.updatedAt).getTime() : null,
    };
  });
}
