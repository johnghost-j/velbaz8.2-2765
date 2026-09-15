import { useEffect, useState } from 'react';
import { useBeta } from '../lib/beta';

/**
 * Porte d'entrée bêta : tant que l'appareil n'a pas validé un code, on affiche
 * un écran de saisie de code plein écran. Une fois validé (ou appareil/IP déjà
 * connu, ou admin), on rend l'application normalement.
 */
export function BetaGate({ children }: { children: React.ReactNode }) {
  const { status, init, verify } = useBeta();
  const [code, setCode] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  useEffect(() => { init(); }, []);

  if (status === 'granted') return <>{children}</>;

  // Pendant la vérification initiale : petit écran neutre (évite le flash du gate).
  if (status === 'checking') {
    return (
      <div className="min-h-screen flex items-center justify-center" style={{ background: 'var(--surface-0)' }}>
        <div style={{
          width: 34, height: 34, borderRadius: '50%',
          border: '3px solid var(--border-subtle)', borderTopColor: '#34D9A6',
          animation: 'spin 0.9s linear infinite',
        }} />
        <style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style>
      </div>
    );
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!code.trim() || loading) return;
    setError('');
    setLoading(true);
    const res = await verify(code.trim());
    setLoading(false);
    if (!res.ok) setError(res.message || 'Invalid code.');
    // Si ok, le store passe en "granted" → ce composant rendra children.
  }

  return (
    <div className="min-h-screen flex flex-col items-center justify-center px-6 relative overflow-hidden"
      style={{ background: 'var(--surface-0)' }}>
      {/* Halo décoratif */}
      <div aria-hidden style={{
        position: 'absolute', top: '-20%', left: '50%', transform: 'translateX(-50%)',
        width: 560, height: 560, borderRadius: '50%', pointerEvents: 'none',
        background: 'radial-gradient(circle, rgba(52,217,166,0.14) 0%, rgba(52,217,166,0) 70%)',
      }} />

      <div className="w-full max-w-sm relative" style={{ zIndex: 1 }}>
        <div className="text-center mb-8">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full mb-5" style={{
            background: 'rgba(52,217,166,0.10)', border: '1px solid rgba(52,217,166,0.35)',
          }}>
            <span style={{ width: 6, height: 6, borderRadius: '50%', background: '#34D9A6', display: 'inline-block' }} />
            <span className="text-[11px] font-semibold tracking-wide" style={{ color: '#34D9A6' }}>PRIVATE BETA ACCESS</span>
          </div>
          <h1 className="text-2xl font-semibold tracking-tight mb-2" style={{ color: 'var(--text-primary)' }}>
            Enter your access code
          </h1>
          <p className="text-sm" style={{ color: 'var(--text-dim)' }}>
            Velbaz is in invite-only beta. Enter your code to try the app.
          </p>
        </div>

        <form onSubmit={submit} className="space-y-3.5">
          <div>
            <label className="text-[11px] font-medium uppercase tracking-wider block mb-1.5" style={{ color: 'var(--text-dim)' }}>
              Invitation code
            </label>
            <input
              value={code}
              onChange={e => { setCode(e.target.value); setError(''); }}
              autoFocus
              autoCapitalize="characters"
              spellCheck={false}
              placeholder="EX : VELBAZ-BETA"
              className="w-full px-3.5 py-3 text-[14px] rounded-lg focus:outline-none tracking-wider text-center"
              style={{
                background: 'var(--surface-3)',
                border: `1px solid ${error ? '#e5484d' : 'var(--border-default)'}`,
                color: 'var(--text-primary)', textTransform: 'uppercase',
              }}
            />
          </div>

          {error && (
            <p className="text-[12px] text-center" style={{ color: '#e5484d' }}>{error}</p>
          )}

          <button
            type="submit"
            disabled={loading || !code.trim()}
            className="w-full py-3 text-[14px] font-semibold rounded-lg transition-opacity"
            style={{
              background: '#34D9A6', color: '#04241b',
              opacity: loading || !code.trim() ? 0.55 : 1,
              cursor: loading || !code.trim() ? 'not-allowed' : 'pointer',
            }}
          >
            {loading ? 'Verifying…' : 'Access Velbaz'}
          </button>
        </form>

        <p className="text-[11px] text-center mt-6" style={{ color: 'var(--text-ghost, var(--text-dim))' }}>
          No code? Request an invite from the team.
        </p>
      </div>
    </div>
  );
}
