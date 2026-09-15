/**
 * Global HTTP dispatcher (Node/undici only).
 *
 * Fixes intermittent 20-60s AI-call stalls: each new outbound connection did a
 * fresh DNS lookup (getaddrinfo on the libuv threadpool). With a single UDP
 * nameserver, a lost packet costs 5s+ per retry and the 4 threadpool slots can
 * all be stuck in getaddrinfo — the process then can't even OPEN a socket to
 * the AI gateway until DNS unblocks (verified via strace: zero connect()
 * syscalls during the stalls).
 *
 * Mitigation:
 *  - DNS interceptor: caches lookups (respects TTL, min 30s / max 5min) so at
 *    most one lookup per host per TTL window.
 *  - IPv4 affinity: the sandbox has no IPv6 route (connect → ENETUNREACH).
 *  - Long keep-alive: reuses warm connections so DNS is rarely needed at all.
 *
 * No-op under Bun (Bun's fetch doesn't use undici dispatchers).
 */
export async function installHttpAgent(): Promise<void> {
  const isBun = typeof (globalThis as any).Bun !== 'undefined';
  if (isBun || !process.versions?.node) return;
  try {
    const { Agent, setGlobalDispatcher, interceptors } = await import('undici');
    let agent: any = new Agent({
      keepAliveTimeout: 60_000,        // keep idle sockets 60s (vs ~4s default)
      keepAliveMaxTimeout: 10 * 60_000,
      connect: { timeout: 10_000 },
    });
    if (interceptors?.dns) {
      agent = agent.compose(interceptors.dns({
        minTTL: 30_000,
        maxTTL: 5 * 60_000,
        dualStack: false,
        affinity: 4,                   // IPv4 only — no IPv6 route in sandbox
      } as any));
    }
    setGlobalDispatcher(agent);
    console.log('[http-agent] Global undici dispatcher installed (DNS cache + 60s keep-alive)');
  } catch (err: any) {
    console.log('[http-agent] Skipped (undici unavailable):', err?.message);
  }
}
