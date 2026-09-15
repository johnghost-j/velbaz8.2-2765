// Retry wrapper for transient DB errors (Turso ECONNRESET, etc.)
//
// [2026-09-10] Extrait de index.ts pour être réutilisable ailleurs (autopilot,
// etc.) sans import circulaire : index.ts importe autopilot.ts, donc autopilot
// ne peut pas importer index.ts.
export async function dbRetry<T>(fn: () => Promise<T>, retries = 4): Promise<T> {
  for (let i = 0; i <= retries; i++) {
    try { return await fn(); }
    catch (e: any) {
      // RangeError from libsql for oversized integers — not retryable
      if (e instanceof RangeError) throw e;
      // Inspect the whole error chain (drizzle wraps the libsql/undici cause).
      const msg = `${e?.message || ''} ${e?.cause?.message || ''} ${e?.cause?.code || ''} ${e?.code || ''}`;
      const retryable = /ECONNRESET|Failed query|SQLITE_BUSY|fetch failed|socket connection was closed|closed unexpectedly|other side closed|UND_ERR|terminated|ETIMEDOUT| EPIPE|network|timed out|Timeout/i.test(msg);
      if (i < retries && retryable) {
        // Exponential-ish backoff with jitter: 150, 350, 700, 1200 ms.
        const delay = [150, 350, 700, 1200][i] ?? 1200;
        await new Promise(r => setTimeout(r, delay + Math.floor(Math.random() * 100)));
        continue;
      }
      throw e;
    }
  }
  throw new Error('dbRetry exhausted');
}

export default dbRetry;
