import { useState } from 'react';
import { Link } from 'wouter';
import { api } from '../lib/api';

export default function ForgotPassword() {
  const [email, setEmail] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [sent, setSent] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const res = await api.auth.forgotPassword({ email });
      if (res.error) { setError(res.error); setLoading(false); return; }
      setSent(true);
    } catch (err: any) {
      setError(err?.message || 'Network error');
    }
    setLoading(false);
  }

  return (
    <div className="min-h-screen flex flex-col" style={{ background: 'var(--surface-0)' }}>
      <nav className="px-6 h-12 flex items-center" style={{ borderBottom: '1px solid var(--border-subtle)' }}>
        <Link href="/"><span className="text-[13px] font-semibold cursor-pointer" style={{ color: 'var(--text-secondary)' }}>velbaz</span></Link>
      </nav>

      <div className="flex-1 flex items-center justify-center px-6 py-20">
        <div className="w-full max-w-sm">
          {sent ? (
            <div className="text-center">
              <div className="w-12 h-12 rounded-full flex items-center justify-center mx-auto mb-5" style={{ background: 'var(--teal-subtle-bg, rgba(45,212,191,0.12))' }}>
                <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="var(--text-secondary)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/><polyline points="22,6 12,13 2,6"/></svg>
              </div>
              <h1 className="text-2xl font-semibold tracking-tight mb-2" style={{ color: 'var(--text-primary)' }}>Check your inbox.</h1>
              <p className="text-sm leading-relaxed" style={{ color: 'var(--text-dim)' }}>
                If an account exists with <span style={{ color: 'var(--text-secondary)' }}>{email}</span>, you will receive an email with a link to reset your password. The link is valid for 1 hour.
              </p>
              <Link href="/login"><span className="inline-block mt-6 text-[13px] font-medium cursor-pointer" style={{ color: 'var(--teal)' }}>← Back to login</span></Link>
            </div>
          ) : (
            <>
              <div className="text-center mb-8">
                <h1 className="text-2xl font-semibold tracking-tight mb-2" style={{ color: 'var(--text-primary)' }}>Forgot your password?</h1>
                <p className="text-sm" style={{ color: 'var(--text-dim)' }}>Enter your email and we'll send you a reset link.</p>
              </div>

              <form onSubmit={handleSubmit} className="space-y-3.5">
                <div>
                  <label className="text-[11px] font-medium uppercase tracking-wider block mb-1.5" style={{ color: 'var(--text-dim)' }}>Email</label>
                  <input type="email" autoComplete="username" value={email} onChange={e => setEmail(e.target.value)} required
                    placeholder="you@company.com"
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
                      Sending...
                    </span>
                  ) : 'Send link'}
                </button>
              </form>

              <p className="text-center text-[13px] mt-5" style={{ color: 'var(--text-dim)' }}>
                <Link href="/login"><span className="font-medium cursor-pointer" style={{ color: 'var(--teal)' }}>← Back to login</span></Link>
              </p>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
