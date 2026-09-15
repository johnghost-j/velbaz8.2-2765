import { useState, useEffect, useRef } from 'react';
import { useAuth } from '../lib/auth';

type Tab = 'login' | 'register';

interface AuthModalProps {
  open: boolean;
  onClose: () => void;
  onSuccess: () => void;
  defaultTab?: Tab;
}

export function AuthModal({ open, onClose, onSuccess, defaultTab = 'register' }: AuthModalProps) {
  const [tab, setTab] = useState<Tab>(defaultTab);
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [visible, setVisible] = useState(false);
  const { login, register } = useAuth();
  const panelRef = useRef<HTMLDivElement>(null);
  const emailRef = useRef<HTMLInputElement>(null);
  const nameRef = useRef<HTMLInputElement>(null);

  // Animate in
  useEffect(() => {
    if (open) {
      requestAnimationFrame(() => requestAnimationFrame(() => setVisible(true)));
    } else {
      setVisible(false);
    }
  }, [open]);

  // Focus first field on open/tab switch
  useEffect(() => {
    if (!open) return;
    const timer = setTimeout(() => {
      if (tab === 'register') nameRef.current?.focus();
      else emailRef.current?.focus();
    }, 150);
    return () => clearTimeout(timer);
  }, [open, tab]);

  // Reset on tab switch
  useEffect(() => {
    setError('');
    setPassword('');
  }, [tab]);

  // Close on escape
  useEffect(() => {
    if (!open) return;
    function handleEsc(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    window.addEventListener('keydown', handleEsc);
    return () => window.removeEventListener('keydown', handleEsc);
  }, [open, onClose]);

  if (!open) return null;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError('');

    if (tab === 'register' && password.length < 6) {
      setError('Password must be at least 6 characters');
      return;
    }

    setLoading(true);
    try {
      if (tab === 'login') {
        const res = await login(email, password);
        if (res.error) { setError(res.error); setLoading(false); return; }
      } else {
        const res = await register(name, email, password);
        if (res.error) { setError(res.error); setLoading(false); return; }
      }
      setLoading(false);
      onSuccess();
    } catch (err: any) {
      setError(err.message || 'Something went wrong');
      setLoading(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center px-4"
      style={{
        background: visible ? 'rgba(0,0,0,0.6)' : 'rgba(0,0,0,0)',
        backdropFilter: visible ? 'blur(8px)' : 'blur(0px)',
        WebkitBackdropFilter: visible ? 'blur(8px)' : 'blur(0px)',
        transition: 'background 0.3s ease, backdrop-filter 0.3s ease',
      }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div
        ref={panelRef}
        className="w-full max-w-[400px] rounded-2xl overflow-hidden"
        style={{
          background: 'var(--surface-1)',
          border: '1px solid var(--border-default)',
          boxShadow: '0 24px 80px rgba(0,0,0,0.5), 0 0 1px rgba(255,255,255,0.05) inset',
          transform: visible ? 'translateY(0) scale(1)' : 'translateY(20px) scale(0.97)',
          opacity: visible ? 1 : 0,
          transition: 'transform 0.35s cubic-bezier(0.16,1,0.3,1), opacity 0.25s ease',
        }}
      >
        {/* Header */}
        <div className="px-6 pt-6 pb-0">
          <div className="flex items-center justify-between mb-1">
            <div className="flex items-center gap-2">
              <div className="w-6 h-6 rounded-md flex items-center justify-center" style={{ background: 'var(--surface-4)' }}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ color: 'var(--text-secondary)' }}>
                  <path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4" /><polyline points="10 17 15 12 10 7" /><line x1="15" y1="12" x2="3" y2="12" />
                </svg>
              </div>
              <span className="text-[13px] font-semibold tracking-tight" style={{ color: 'var(--text-secondary)' }}>velbaz</span>
            </div>
            <button
              onClick={onClose}
              className="w-7 h-7 flex items-center justify-center rounded-lg transition-colors"
              style={{ color: 'var(--text-dim)' }}
              onMouseEnter={e => e.currentTarget.style.background = 'var(--surface-4)'}
              onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
            >
              <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
                <path d="M3 3L11 11M11 3L3 11" />
              </svg>
            </button>
          </div>

          <h2 className="text-[22px] font-semibold tracking-tight mt-4" style={{ color: 'var(--text-primary)' }}>
            {tab === 'login' ? 'Welcome back' : 'Create your account'}
          </h2>
          <p className="text-[13px] mt-1 mb-5" style={{ color: 'var(--text-dim)' }}>
            {tab === 'login' ? 'Sign in to launch your idea.' : 'Start building in seconds. Free forever.'}
          </p>

          {/* Tabs */}
          <div className="flex rounded-lg p-0.5" style={{ background: 'var(--surface-3)' }}>
            {(['register', 'login'] as Tab[]).map(t => (
              <button
                key={t}
                onClick={() => setTab(t)}
                className="flex-1 py-2 text-[12px] font-medium rounded-md transition-all"
                style={{
                  background: tab === t ? 'var(--surface-5)' : 'transparent',
                  color: tab === t ? 'var(--text-primary)' : 'var(--text-dim)',
                  boxShadow: tab === t ? '0 1px 3px rgba(0,0,0,0.2)' : 'none',
                }}
              >
                {t === 'register' ? 'Create Account' : 'Sign In'}
              </button>
            ))}
          </div>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} className="px-6 pt-5 pb-6">
          <div className="space-y-3">
            {tab === 'register' && (
              <div>
                <label className="text-[11px] font-medium uppercase tracking-wider block mb-1.5" style={{ color: 'var(--text-dim)' }}>Name</label>
                <input
                  ref={nameRef}
                  type="text"
                  value={name}
                  onChange={e => setName(e.target.value)}
                  required
                  placeholder="Your name"
                  className="w-full px-3.5 py-2.5 text-[13px] rounded-lg focus:outline-none transition-colors"
                  style={{
                    background: 'var(--surface-3)',
                    border: '1px solid var(--border-default)',
                    color: 'var(--text-secondary)',
                  }}
                  onFocus={e => e.currentTarget.style.borderColor = 'var(--border-hover)'}
                  onBlur={e => e.currentTarget.style.borderColor = 'var(--border-default)'}
                />
              </div>
            )}
            <div>
              <label className="text-[11px] font-medium uppercase tracking-wider block mb-1.5" style={{ color: 'var(--text-dim)' }}>Email</label>
              <input
                ref={emailRef}
                type="email"
                value={email}
                onChange={e => setEmail(e.target.value)}
                required
                placeholder="you@company.com"
                className="w-full px-3.5 py-2.5 text-[13px] rounded-lg focus:outline-none transition-colors"
                style={{
                  background: 'var(--surface-3)',
                  border: '1px solid var(--border-default)',
                  color: 'var(--text-secondary)',
                }}
                onFocus={e => e.currentTarget.style.borderColor = 'var(--border-hover)'}
                onBlur={e => e.currentTarget.style.borderColor = 'var(--border-default)'}
              />
            </div>
            <div>
              <label className="text-[11px] font-medium uppercase tracking-wider block mb-1.5" style={{ color: 'var(--text-dim)' }}>Password</label>
              <input
                type="password"
                value={password}
                onChange={e => setPassword(e.target.value)}
                required
                placeholder={tab === 'register' ? 'Min. 6 characters' : '••••••••'}
                className="w-full px-3.5 py-2.5 text-[13px] rounded-lg focus:outline-none transition-colors"
                style={{
                  background: 'var(--surface-3)',
                  border: '1px solid var(--border-default)',
                  color: 'var(--text-secondary)',
                }}
                onFocus={e => e.currentTarget.style.borderColor = 'var(--border-hover)'}
                onBlur={e => e.currentTarget.style.borderColor = 'var(--border-default)'}
              />
            </div>
          </div>

          {/* Error */}
          {error && (
            <div
              className="mt-3 text-[12px] px-3.5 py-2.5 rounded-lg flex items-center gap-2"
              style={{
                background: 'rgba(239,68,68,0.08)',
                border: '1px solid rgba(239,68,68,0.15)',
                color: '#f87171',
              }}
            >
              <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
                <circle cx="7" cy="7" r="5.5" /><path d="M7 4.5V7.5M7 9.5V9.5" />
              </svg>
              {error}
            </div>
          )}

          {/* Submit */}
          <button
            type="submit"
            disabled={loading}
            className="w-full mt-4 py-2.5 text-[13px] font-medium rounded-lg disabled:opacity-40 transition-all relative overflow-hidden"
            style={{
              background: 'var(--text-primary)',
              color: 'var(--surface-0)',
            }}
            onMouseEnter={e => { if (!loading) e.currentTarget.style.opacity = '0.9'; }}
            onMouseLeave={e => { e.currentTarget.style.opacity = '1'; }}
          >
            {loading ? (
              <span className="flex items-center justify-center gap-2">
                <svg className="animate-spin" width="14" height="14" viewBox="0 0 14 14" fill="none">
                  <circle cx="7" cy="7" r="5.5" stroke="currentColor" strokeWidth="1.5" opacity="0.25" />
                  <path d="M12.5 7a5.5 5.5 0 00-5.5-5.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
                </svg>
                {tab === 'login' ? 'Signing in...' : 'Creating account...'}
              </span>
            ) : (
              tab === 'login' ? 'Sign In' : 'Create Account'
            )}
          </button>
        </form>
      </div>
    </div>
  );
}
