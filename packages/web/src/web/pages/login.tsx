import { useState } from 'react';
import { Link, useLocation } from 'wouter';
import { useAuth } from '../lib/auth';
import AuthSidePanel from '../components/auth-side-panel';

export default function Login() {
  // Pré-remplit l'email invité si l'utilisateur vient d'une invitation.
  const [email, setEmail] = useState(() => { try { return localStorage.getItem('velbaz_invite_email') || ''; } catch { return ''; } });
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const { login } = useAuth();
  const [, navigate] = useLocation();

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    setLoading(true);
    const res = await login(email, password);
    setLoading(false);
    if (res.error) { setError(res.error); return; }
    const pending = (() => { try { return localStorage.getItem('velbaz_pending_invite'); } catch { return null; } })();
    try { localStorage.removeItem('velbaz_invite_email'); } catch {}
    if (pending) { navigate(`/accept-invite?token=${encodeURIComponent(pending)}`); return; }
    navigate('/dashboard');
  }

  return (
    <div className="min-h-screen flex flex-col" style={{ background: 'var(--surface-0)' }}>
      <nav className="px-6 h-12 flex items-center" style={{ borderBottom: '1px solid var(--border-subtle)' }}>
        <Link href="/"><span className="text-[13px] font-semibold cursor-pointer" style={{ color: 'var(--text-secondary)' }}>velbaz</span></Link>
      </nav>

      <div className="flex-1 flex flex-col lg:flex-row items-stretch px-6 py-10 lg:py-12 gap-10 lg:gap-0">
        {/* Colonne gauche : formulaire de connexion */}
        <div className="flex-1 flex items-center justify-center lg:px-12">
          <div className="w-full max-w-sm">
            <div className="text-center mb-8">
              <h1 className="text-2xl font-semibold tracking-tight mb-2" style={{ color: 'var(--text-primary)' }}>Welcome back.</h1>
            <p className="text-sm" style={{ color: 'var(--text-dim)' }}>Sign in to your account.</p>
          </div>

          <form onSubmit={handleSubmit} className="space-y-3.5">
            <div>
              <label className="text-[11px] font-medium uppercase tracking-wider block mb-1.5" style={{ color: 'var(--text-dim)' }}>Email</label>
              <input type="email" autoComplete="username" value={email} onChange={e => setEmail(e.target.value)} required
                placeholder="you@company.com"
                className="w-full px-3.5 py-2.5 text-[13px] rounded-lg focus:outline-none"
                style={{ background: 'var(--surface-3)', border: '1px solid var(--border-default)', color: 'var(--text-secondary)' }} />
            </div>
            <div>
              <div className="flex items-center justify-between mb-1.5">
                <label className="text-[11px] font-medium uppercase tracking-wider" style={{ color: 'var(--text-dim)' }}>Password</label>
                <Link href="/forgot-password"><span className="text-[11px] font-medium cursor-pointer hover:underline" style={{ color: 'var(--teal)' }}>Forgot password?</span></Link>
              </div>
              <input type="password" autoComplete="current-password" value={password} onChange={e => setPassword(e.target.value)} required
                placeholder="••••••••"
                className="w-full px-3.5 py-2.5 text-[13px] rounded-lg focus:outline-none"
                style={{ background: 'var(--surface-3)', border: '1px solid var(--border-default)', color: 'var(--text-secondary)' }} />
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
                  Signing in...
                </span>
              ) : 'Sign In'}
            </button>
          </form>

            <p className="text-center text-[13px] mt-5" style={{ color: 'var(--text-dim)' }}>
              Don't have an account?{' '}
              <Link href="/register"><span className="font-medium cursor-pointer" style={{ color: 'var(--teal)' }}>Create one</span></Link>
            </p>
          </div>
        </div>
        {/* Colonne droite : image */}
        <div className="hidden lg:block flex-1">
          <AuthSidePanel src="/images/login-right.webp" label="Your image goes here — drop it in public/images/login-right.png" />
        </div>
      </div>
    </div>
  );
}
