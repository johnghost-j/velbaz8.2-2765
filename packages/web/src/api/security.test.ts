import { describe, it, expect, beforeEach } from 'vitest';
import { isAdminUser, rateLimit } from './security';

describe('isAdminUser', () => {
  it('true si role admin', () => {
    expect(isAdminUser({ email: 'x@y.com', role: 'admin' })).toBe(true);
  });
  it('true si email dans allowlist (défaut)', () => {
    expect(isAdminUser({ email: 'johnemadmansour1@gmail.com', role: 'user' })).toBe(true);
  });
  it('insensible à la casse', () => {
    expect(isAdminUser({ email: 'JohnEmAdMansour1@Gmail.com', role: 'user' })).toBe(true);
  });
  it('false pour user normal', () => {
    expect(isAdminUser({ email: 'random@user.com', role: 'user' })).toBe(false);
  });
  it('false si null/undefined', () => {
    expect(isAdminUser(null)).toBe(false);
    expect(isAdminUser(undefined)).toBe(false);
  });
});

// Faux Context Hono minimal pour tester le middleware.
function makeCtx(headers: Record<string, string> = {}, path = '/api/auth/login') {
  const set: Record<string, string> = {};
  let jsonBody: any = null;
  let jsonStatus = 200;
  return {
    ctx: {
      req: { url: `http://localhost:4200${path}`, header: (k: string) => headers[k.toLowerCase()] },
      header: (k: string, v: string) => { set[k] = v; },
      json: (b: any, s: number) => { jsonBody = b; jsonStatus = s; return { b, s }; },
    } as any,
    getStatus: () => jsonStatus,
    getBody: () => jsonBody,
    getHeaders: () => set,
  };
}

describe('rateLimit', () => {
  beforeEach(() => { (globalThis as any).__velbaz_ratelimit = new Map(); });

  it('laisse passer sous la limite', async () => {
    const mw = rateLimit({ windowMs: 60_000, max: 3, key: 'test-a' });
    let nextCalls = 0;
    const { ctx } = makeCtx({ 'x-forwarded-for': '1.1.1.1' });
    for (let i = 0; i < 3; i++) await mw(ctx, async () => { nextCalls++; });
    expect(nextCalls).toBe(3);
  });

  it('bloque avec 429 au-delà de la limite', async () => {
    const mw = rateLimit({ windowMs: 60_000, max: 2, key: 'test-b' });
    const c = makeCtx({ 'x-forwarded-for': '2.2.2.2' });
    let nextCalls = 0;
    await mw(c.ctx, async () => { nextCalls++; });
    await mw(c.ctx, async () => { nextCalls++; });
    await mw(c.ctx, async () => { nextCalls++; }); // 3e → bloqué
    expect(nextCalls).toBe(2);
    expect(c.getStatus()).toBe(429);
    expect(c.getBody()?.error).toMatch(/too many/i);
  });

  it('sépare les buckets par client', async () => {
    const mw = rateLimit({ windowMs: 60_000, max: 1, key: 'test-c' });
    const a = makeCtx({ 'x-forwarded-for': '3.3.3.3' });
    const b = makeCtx({ 'x-forwarded-for': '4.4.4.4' });
    let ok = 0;
    await mw(a.ctx, async () => { ok++; });
    await mw(b.ctx, async () => { ok++; }); // client différent → passe
    expect(ok).toBe(2);
  });

  it('pose les headers X-RateLimit-*', async () => {
    const mw = rateLimit({ windowMs: 60_000, max: 5, key: 'test-d' });
    const c = makeCtx({ 'x-forwarded-for': '5.5.5.5' });
    await mw(c.ctx, async () => {});
    const h = c.getHeaders();
    expect(h['X-RateLimit-Limit']).toBe('5');
    expect(h['X-RateLimit-Remaining']).toBe('4');
  });
});
