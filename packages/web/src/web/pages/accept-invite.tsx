import { useState, useEffect } from 'react';
import { Link, useLocation } from 'wouter';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';

const PENDING_KEY = 'velbaz_pending_invite';

export default function AcceptInvite() {
  const token = (() => {
    try { return new URLSearchParams(window.location.search).get('token') || ''; }
    catch { return ''; }
  })();

  const { user, loading: authLoading, logout } = useAuth();
  const [, navigate] = useLocation();
  const [checking, setChecking] = useState(true);
  const [info, setInfo] = useState<{ valid: boolean; projectName?: string; inviterName?: string; email?: string; status?: string } | null>(null);
  const [accepting, setAccepting] = useState(false);
  const [error, setError] = useState('');

  // Le compte actuellement connecté dans le navigateur correspond-il à l'adresse
  // invitée ? Si non (ex. le propriétaire est déjà connecté), on NE laisse PAS ce
  // compte accepter à la place de l'invité — on demande la bonne connexion.
  const wrongAccount = !!(user && info?.valid && info.email &&
    (user.email || '').toLowerCase() !== info.email.toLowerCase());

  // Récupère les infos de l'invitation.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!token) { setChecking(false); return; }
      try {
        const res = await api.invites.info(token);
        if (!cancelled) setInfo(res);
      } catch {
        if (!cancelled) setInfo({ valid: false });
      } finally {
        if (!cancelled) setChecking(false);
      }
    })();
    return () => { cancelled = true; };
  }, [token]);

  async function handleAccept() {
    if (accepting) return;
    setAccepting(true); setError('');
    try {
      const res = await api.invites.accept(token);
      if (res?.error) {
        // Mauvais compte connecté (ou propriétaire) → on déconnecte et on renvoie
        // vers la connexion/création avec la bonne adresse.
        if (res.wrongAccount) { await switchAccount(); return; }
        if (res.needAuth) { goAuth(); return; }
        setError(res.error); setAccepting(false); return;
      }
      try { localStorage.removeItem(PENDING_KEY); } catch {}
      // Rejoint le projet partagé → ouvre-le directement.
      navigate(`/chat/${res.companyId}`);
    } catch (e: any) {
      setError(e?.message || 'Network error');
      setAccepting(false);
    }
  }

  function goAuth() {
    // Mémorise l'invitation pour reprendre l'acceptation après connexion.
    try { localStorage.setItem(PENDING_KEY, token); } catch {}
    if (info?.email) { try { localStorage.setItem('velbaz_invite_email', info.email); } catch {} }
    navigate('/login');
  }

  function goRegister() {
    try { localStorage.setItem(PENDING_KEY, token); } catch {}
    if (info?.email) { try { localStorage.setItem('velbaz_invite_email', info.email); } catch {} }
    navigate('/register');
  }

  // Déconnecte le compte courant (ex. propriétaire) puis dirige vers la connexion,
  // en conservant l'invitation pour reprendre juste après.
  async function switchAccount() {
    try { localStorage.setItem(PENDING_KEY, token); } catch {}
    if (info?.email) { try { localStorage.setItem('velbaz_invite_email', info.email); } catch {} }
    try { await logout(); } catch {}
    navigate('/login');
  }

  async function switchAndRegister() {
    try { localStorage.setItem(PENDING_KEY, token); } catch {}
    if (info?.email) { try { localStorage.setItem('velbaz_invite_email', info.email); } catch {} }
    try { await logout(); } catch {}
    navigate('/register');
  }

  return (
    <div className="min-h-screen flex flex-col" style={{ background: 'var(--surface-0)' }}>
      <nav className="px-6 h-12 flex items-center" style={{ borderBottom: '1px solid var(--border-subtle)' }}>
        <Link href="/"><span className="text-[13px] font-semibold cursor-pointer" style={{ color: 'var(--text-secondary)' }}>velbaz</span></Link>
      </nav>

      <div className="flex-1 flex items-center justify-center px-6 py-20">
        <div className="w-full max-w-sm text-center">
          {(checking || authLoading) ? (
            <>
              <div className="flex gap-1 justify-center mb-4"><div className="typing-dot" style={{width:6,height:6,background:'var(--text-dim)'}}/><div className="typing-dot" style={{width:6,height:6,background:'var(--text-dim)'}}/><div className="typing-dot" style={{width:6,height:6,background:'var(--text-dim)'}}/></div>
              <p className="text-sm" style={{ color: 'var(--text-dim)' }}>Verifying invitation...</p>
            </>
          ) : (!info || !info.valid) ? (
            <>
              <h1 className="text-[18px] font-semibold mb-2" style={{ color: 'var(--text-primary)' }}>Invitation not found</h1>
              <p className="text-sm mb-6" style={{ color: 'var(--text-dim)' }}>This invitation link is invalid or has expired.</p>
              <Link href="/"><span className="text-[13px] font-medium cursor-pointer" style={{ color: 'var(--purple, #6366F1)' }}>Back to home</span></Link>
            </>
          ) : (
            <>
              <div className="flex items-center justify-center mx-auto mb-5 rounded-2xl" style={{ width: 52, height: 52, background: 'var(--surface-3)' }}>
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="var(--purple, #6366F1)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><line x1="19" y1="8" x2="19" y2="14"/><line x1="22" y1="11" x2="16" y2="11"/></svg>
              </div>
              <h1 className="text-[19px] font-semibold mb-2" style={{ color: 'var(--text-primary)' }}>
                {info.inviterName} is inviting you to collaborate
              </h1>
              <p className="text-sm mb-6" style={{ color: 'var(--text-dim)' }}>
                Join the project <strong style={{ color: 'var(--text-secondary)' }}>{info.projectName}</strong> to edit it together.
              </p>

              {error && <p className="text-[12.5px] mb-3" style={{ color: '#e5484d' }}>{error}</p>}

              {user && !wrongAccount ? (
                <button
                  onClick={handleAccept}
                  disabled={accepting}
                  className="w-full h-11 rounded-lg text-[14px] font-medium transition-colors disabled:opacity-60"
                  style={{ background: 'var(--purple, #6366F1)', color: '#fff', border: 'none', cursor: 'pointer' }}
                >
                  {accepting ? 'Joining project…' : 'Join project'}
                </button>
              ) : wrongAccount ? (
                <div className="flex flex-col gap-2.5">
                  <p className="text-[12.5px] mb-1" style={{ color: 'var(--text-dim)' }}>
                    This invitation is for <strong style={{ color: 'var(--text-secondary)' }}>{info.email}</strong>, but you are logged in as <strong style={{ color: 'var(--text-secondary)' }}>{user?.email}</strong>.
                    Sign in with the right account (or create one) to join the project.
                  </p>
                  <button onClick={switchAccount} disabled={accepting} className="w-full h-11 rounded-lg text-[14px] font-medium disabled:opacity-60" style={{ background: 'var(--purple, #6366F1)', color: '#fff', border: 'none', cursor: 'pointer' }}>Sign in with {info.email}</button>
                  <button onClick={switchAndRegister} disabled={accepting} className="w-full h-11 rounded-lg text-[14px] font-medium disabled:opacity-60" style={{ background: 'var(--surface-3)', color: 'var(--text-secondary)', border: '1px solid var(--surface-4)', cursor: 'pointer' }}>Create an account</button>
                </div>
              ) : (
                <div className="flex flex-col gap-2.5">
                  <p className="text-[12.5px] mb-1" style={{ color: 'var(--text-dim)' }}>Sign in or create an account to accept the invitation{info.email ? ` (${info.email})` : ''}.</p>
                  <button onClick={goAuth} className="w-full h-11 rounded-lg text-[14px] font-medium" style={{ background: 'var(--purple, #6366F1)', color: '#fff', border: 'none', cursor: 'pointer' }}>Sign in</button>
                  <button onClick={goRegister} className="w-full h-11 rounded-lg text-[14px] font-medium" style={{ background: 'var(--surface-3)', color: 'var(--text-secondary)', border: '1px solid var(--surface-4)', cursor: 'pointer' }}>Create an account</button>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
