import { useState, useEffect } from 'react';
import { Link } from 'wouter';
import { api } from '../lib/api';

export default function ResetPassword() {
  const token = (() => {
    try { return new URLSearchParams(window.location.search).get('token') || ''; }
    catch { return ''; }
  })();

  const [checking, setChecking] = useState(true);
  const [validToken, setValidToken] = useState(false);
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [done, setDone] = useState(false);
  const [countdown, setCountdown] = useState(15);

  // Vérifie la validité du jeton au chargement.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!token) { setChecking(false); setValidToken(false); return; }
      try {
        const res = await api.auth.validateResetToken(token);
        if (!cancelled) setValidToken(!!res.valid);
      } catch {
        if (!cancelled) setValidToken(false);
      } finally {
        if (!cancelled) setChecking(false);
      }
    })();
    return () => { cancelled = true; };
  }, [token]);

  // Après confirmation : décompte 15s puis fermeture de la page.
  useEffect(() => {
    if (!done) return;
    const iv = setInterval(() => setCountdown((c) => (c > 0 ? c - 1 : 0)), 1000);
    const t = setTimeout(() => {
      // Tente de fermer l'onglet ; si le navigateur le bloque, redirige vers login.
      window.close();
      setTimeout(() => { window.location.href = '/login'; }, 300);
    }, 15000);
    return () => { clearInterval(iv); clearTimeout(t); };
  }, [done]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    if (password.length < 8) { setError('Password must be at least 8 characters.'); return; }
    if (password !== confirm) { setError('The two passwords do not match.'); return; }
    setLoading(true);
    try {
      const res = await api.auth.resetPassword({ token, password });
      if (res.error) { setError(res.error); setLoading(false); return; }
      setDone(true);
    } catch (err: any) {
      setError(err?.message || 'Network error');
    }
    setLoading(false);
  }

  const inputStyle = { background: 'var(--surface-3)', border: '1px solid var(--border-default)', color: 'var(--text-secondary)' } as const;

  return (
    <div className="min-h-screen flex flex-col" style={{ background: 'var(--surface-0)' }}>
      <nav className="px-6 h-12 flex items-center" style={{ borderBottom: '1px solid var(--border-subtle)' }}>
        <Link href="/"><span className="text-[13px] font-semibold cursor-pointer" style={{ color: 'var(--text-secondary)' }}>velbaz</span></Link>
      </nav>

      <div className="flex-1 flex items-center justify-center px-6 py-20">
        <div className="w-full max-w-sm">
          {checking ? (
            <div className="text-center">
              <div className="flex gap-1 justify-center mb-4"><div className="typing-dot" style={{width:6,height:6,background:'var(--text-dim)'}}/><div className="typing-dot" style={{width:6,height:6,background:'var(--text-dim)'}}/><div className="typing-dot" style={{width:6,height:6,background:'var(--text-dim)'}}/></div>
              <p className="text-sm" style={{ color: 'var(--text-dim)' }}>Verifying link...</p>
            </div>
          ) : done ? (
            <div className="text-center">
              <div className="w-12 h-12 rounded-full flex items-center justify-center mx-auto mb-5" style={{ background: 'var(--teal-subtle-bg, rgba(45,212,191,0.12))' }}>
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="var(--text-secondary)" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
              </div>
              <h1 className="text-2xl font-semibold tracking-tight mb-2" style={{ color: 'var(--text-primary)' }}>Password updated.</h1>
              <p className="text-sm leading-relaxed" style={{ color: 'var(--text-dim)' }}>
                Your new password has been saved. You can now log in.
              </p>
              <p className="text-[13px] mt-6" style={{ color: 'var(--text-dim)' }}>
                This page will close in <span style={{ color: 'var(--text-primary)', fontWeight: 600 }}>{countdown}s</span>.
              </p>
              <Link href="/login"><span className="inline-block mt-3 text-[13px] font-medium cursor-pointer" style={{ color: 'var(--teal)' }}>Log in now →</span></Link>
            </div>
          ) : !validToken ? (
            <div className="text-center">
              <div className="w-12 h-12 rounded-full flex items-center justify-center mx-auto mb-5" style={{ background: 'var(--red-subtle-bg)' }}>
                <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="var(--red-text)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
              </div>
              <h1 className="text-2xl font-semibold tracking-tight mb-2" style={{ color: 'var(--text-primary)' }}>Invalid or expired link.</h1>
              <p className="text-sm leading-relaxed" style={{ color: 'var(--text-dim)' }}>
                This reset link is no longer valid. Please submit a new request from the login page.
              </p>
              <Link href="/forgot-password"><span className="inline-block mt-6 text-[13px] font-medium cursor-pointer" style={{ color: 'var(--teal)' }}>Submit a new request</span></Link>
            </div>
          ) : (
            <>
              <div className="text-center mb-8">
                <h1 className="text-2xl font-semibold tracking-tight mb-2" style={{ color: 'var(--text-primary)' }}>New password.</h1>
                <p className="text-sm" style={{ color: 'var(--text-dim)' }}>Choose a new password for your account.</p>
              </div>

              <form onSubmit={handleSubmit} className="space-y-3.5">
                <div>
                  <label className="text-[11px] font-medium uppercase tracking-wider block mb-1.5" style={{ color: 'var(--text-dim)' }}>New password</label>
                  <input type="password" autoComplete="new-password" value={password} onChange={e => setPassword(e.target.value)} required
                    placeholder="••••••••" className="w-full px-3.5 py-2.5 text-[13px] rounded-lg focus:outline-none" style={inputStyle} />
                </div>
                <div>
                  <label className="text-[11px] font-medium uppercase tracking-wider block mb-1.5" style={{ color: 'var(--text-dim)' }}>Confirm password</label>
                  <input type="password" autoComplete="new-password" value={confirm} onChange={e => setConfirm(e.target.value)} required
                    placeholder="••••••••" className="w-full px-3.5 py-2.5 text-[13px] rounded-lg focus:outline-none" style={inputStyle} />
                </div>

                {error && (
                  <div className="text-[13px] px-3.5 py-2.5 rounded-lg" style={{ background: 'var(--red-subtle-bg)', border: '1px solid var(--red-subtle-border)', color: 'var(--red-text)' }}>
                    {error}
                  </div>
                )}

                <button type="submit" disabled={loading}
                  className="w-full py-2.5 text-[13px] font-medium rounded-lg disabled:opacity-30 transition-colors"
                  style={{ background: 'var(--btn-primary-bg)', color: 'var(--btn-primary-fg)' }}>
                  {loading ? (
                    <span className="flex items-center justify-center gap-2">
                      <div className="flex gap-0.5"><div className="typing-dot" style={{width:4,height:4,background:'var(--btn-primary-fg)'}}/><div className="typing-dot" style={{width:4,height:4,background:'var(--btn-primary-fg)'}}/><div className="typing-dot" style={{width:4,height:4,background:'var(--btn-primary-fg)'}}/></div>
                      Saving...
                    </span>
                  ) : 'Confirm new password'}
                </button>
              </form>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
