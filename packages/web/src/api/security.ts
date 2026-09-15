// ─── Security helpers: admin config + rate limiting ─────────────────────────
// Stack managé: 1 process Bun + Turso. Rate-limit en mémoire (suffisant pour un
// process unique). Persisté sur globalThis pour survivre au HMR / SSR re-eval.

import type { Context } from 'hono';

// ── Admin allowlist (env-driven, hardcoded fallback for backward compat) ──
const DEFAULT_ADMIN = 'johnemadmansour1@gmail.com';
export const ADMIN_EMAILS: string[] = (process.env.ADMIN_EMAILS || DEFAULT_ADMIN)
  .split(',')
  .map((e) => e.trim().toLowerCase())
  .filter(Boolean);

export function isAdminUser(user: { email?: string | null; role?: string | null } | null | undefined): boolean {
  if (!user) return false;
  if (user.role === 'admin') return true;
  if (user.email && ADMIN_EMAILS.includes(user.email.toLowerCase())) return true;
  return false;
}

// ── Rate limiter (fixed window, in-memory) ──
interface Bucket { count: number; resetAt: number; }
const buckets: Map<string, Bucket> = ((globalThis as any).__velbaz_ratelimit ??= new Map<string, Bucket>());

export interface RateLimitOptions {
  windowMs: number;   // fenêtre en ms
  max: number;        // requêtes max par fenêtre
  key?: string;       // préfixe de bucket (sinon dérivé du path)
}

function clientId(c: Context): string {
  // Priorité: user session token > IP forwardée > IP directe
  const auth = c.req.header('Authorization');
  if (auth) return 'tok:' + auth.slice(-24);
  const fwd = c.req.header('x-forwarded-for');
  if (fwd) return 'ip:' + fwd.split(',')[0].trim();
  const real = c.req.header('x-real-ip');
  if (real) return 'ip:' + real;
  return 'ip:unknown';
}

/**
 * Middleware Hono de rate-limit. Renvoie 429 avec Retry-After au dépassement.
 * Usage: app.use('/auth/*', rateLimit({ windowMs: 60_000, max: 10 }))
 */
export function rateLimit(opts: RateLimitOptions) {
  const { windowMs, max } = opts;
  return async (c: Context, next: () => Promise<void>) => {
    const now = Date.now();
    const scope = opts.key || new URL(c.req.url).pathname;
    const id = `${scope}|${clientId(c)}`;
    let b = buckets.get(id);
    if (!b || b.resetAt <= now) {
      b = { count: 0, resetAt: now + windowMs };
      buckets.set(id, b);
    }
    b.count++;
    const remaining = Math.max(0, max - b.count);
    c.header('X-RateLimit-Limit', String(max));
    c.header('X-RateLimit-Remaining', String(remaining));
    c.header('X-RateLimit-Reset', String(Math.ceil(b.resetAt / 1000)));
    if (b.count > max) {
      const retryAfter = Math.ceil((b.resetAt - now) / 1000);
      c.header('Retry-After', String(retryAfter));
      return c.json({ error: 'Too many requests. Please slow down.', retryAfter }, 429);
    }
    await next();
  };
}

// ── Security headers (défense en profondeur — anti phishing/clickjacking/MIME-sniff) ──
// Appliqué à TOUTES les réponses API: le site Velbaz lui-même ET les sites/apps
// générés par l'IA (servis via /api/companies/:id/preview et /website) en héritent.
export const SECURITY_HEADERS: Record<string, string> = {
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'SAMEORIGIN',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'Permissions-Policy': 'geolocation=(self), camera=(), microphone=(self), payment=(self)',
  'Strict-Transport-Security': 'max-age=63072000; includeSubDomains; preload',
  'X-DNS-Prefetch-Control': 'off',
  'Cross-Origin-Opener-Policy': 'same-origin-allow-popups',
  // CSP: assez strict pour bloquer l'injection de scripts/tiers non prévus, tout en
  // laissant passer ce dont l'app (Velbaz + apps générées) a réellement besoin:
  // Google Fonts (design system), images/data URLs (visuels générés), appels API https.
  'Content-Security-Policy': [
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    "font-src 'self' https://fonts.gstatic.com data:",
    "img-src 'self' data: blob: https:",
    "connect-src 'self' https: wss:",
    "media-src 'self' data: blob: https:",
    "frame-src 'self'",
    "frame-ancestors 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
  ].join('; '),
};

// Les previews d'apps générées (/companies/:id/preview*, /companies/:id/mobile-preview*,
// /website*) sont servies par le dev server Vite intégré: elles ont besoin d'un script
// inline (preamble React-Refresh) et d'eval (HMR) pour fonctionner. Une CSP stricte
// script-src 'self' bloque silencieusement ce script inline → page blanche.
// On leur applique donc une CSP assouplie au lieu de la CSP stricte du site Velbaz.
const PREVIEW_PATH_RE = /\/companies\/[^/]+\/(preview|mobile-preview)(\/|$)|\/website(\/|$)/;

const PREVIEW_CSP = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline' 'unsafe-eval'",
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "font-src 'self' https://fonts.gstatic.com data:",
  "img-src 'self' data: blob: https:",
  "connect-src 'self' https: wss: ws:",
  "media-src 'self' data: blob: https:",
  "frame-src 'self' https:",
  "frame-ancestors 'self'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
].join('; ');

/** Middleware Hono: pose les en-têtes de sécurité sur chaque réponse API. */
export function securityHeaders() {
  return async (c: Context, next: () => Promise<void>) => {
    await next();
    const isPreview = PREVIEW_PATH_RE.test(c.req.path);
    for (const [k, v] of Object.entries(SECURITY_HEADERS)) {
      c.header(k, isPreview && k === 'Content-Security-Policy' ? PREVIEW_CSP : v);
    }
  };
}

// ── Validation mot de passe / email (durcissement inscription & connexion) ──
export function isValidEmail(email: string): boolean {
  return typeof email === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) && email.length <= 254;
}

/** Politique minimale: 8 caractères. Rejette aussi les mots de passe triviaux les plus courants. */
const COMMON_WEAK_PASSWORDS = new Set([
  'password', '12345678', '123456789', 'azerty123', 'motdepasse', 'password1', 'qwerty123', '11111111', 'password123',
]);
export function passwordPolicyError(password: string): string | null {
  if (typeof password !== 'string' || password.length < 8) return 'Le mot de passe doit contenir au moins 8 caractères.';
  if (password.length > 128) return 'Mot de passe trop long.';
  if (COMMON_WEAK_PASSWORDS.has(password.toLowerCase())) return 'Ce mot de passe est trop commun, choisis-en un plus robuste.';
  return null;
}

// Nettoyage périodique des buckets expirés (évite la fuite mémoire)
if (!(globalThis as any).__velbaz_ratelimit_gc) {
  (globalThis as any).__velbaz_ratelimit_gc = setInterval(() => {
    const now = Date.now();
    for (const [k, b] of buckets) if (b.resetAt <= now) buckets.delete(k);
  }, 5 * 60_000);
  // ne bloque pas l'arrêt du process
  (((globalThis as any).__velbaz_ratelimit_gc as any).unref?.());
}
