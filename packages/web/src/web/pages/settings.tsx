import { useAuth, isAdminUser } from '../lib/auth';
import { VerifiedBadge } from '../components/ui/verified-badge';
import { useLocation } from 'wouter';
import React, { useState, useEffect, useRef } from 'react';
import { useTheme } from '../lib/theme';
import { AnimatedThemeToggler } from '../components/AnimatedThemeToggler';
import { api } from '../lib/api';
import { useI18n, LOCALES, type Locale } from '../lib/i18n';

type Section = 'general' | 'ai' | 'account';

export default function Settings() {
  const { user, logout, loading: authLoading } = useAuth();
  const [, navigate] = useLocation();
  const { toggle: toggleTheme, resolved } = useTheme();
  const { locale, setLocale, t } = useI18n();

  const [section, setSection] = useState<Section>('general');
  const [notifications, setNotifications] = useState(true);
  const [emailDigest, setEmailDigest] = useState(false);
  const [autoHeartbeat, setAutoHeartbeat] = useState<boolean | null>(null);
  const companyIdsRef = useRef<string[]>([]);
  const [language, setLanguage] = useState('en');

  // Load auto-heartbeat state from all companies (only on mount / user login)
  const heartbeatFetched = useRef(false);
  useEffect(() => {
    if (!user) return;
    if (heartbeatFetched.current) return;
    heartbeatFetched.current = true;
    api.companies.list().then(res => {
      const companies = res.companies || [];
      companyIdsRef.current = companies.map((c: any) => c.id);
      const allEnabled = companies.length > 0 && companies.every((c: any) => Number(c.autoHeartbeat) === 1);
      setAutoHeartbeat(allEnabled);
    }).catch(() => setAutoHeartbeat(false));
  }, [user?.id]);

  // Toggle auto-heartbeat for ALL companies
  const handleAutoHeartbeatToggle = async (enabled: boolean) => {
    if (enabled) {
      const ok = window.confirm(
        "Enable Auto Heartbeat on ALL your projects?\n\nYour AI agents will work on their own and automatically consume credits every hour, on every project, even when you're not logged in."
      );
      if (!ok) return;
    }
    const ids = companyIdsRef.current;
    if (ids.length === 0) {
      // companyIds not loaded yet — fetch them first
      const res = await api.companies.list().catch(() => null);
      if (res?.companies) {
        companyIdsRef.current = res.companies.map((c: any) => c.id);
      }
      if (companyIdsRef.current.length === 0) return;
    }
    setAutoHeartbeat(enabled);
    // Fire all toggles, then verify
    await Promise.allSettled(companyIdsRef.current.map(cid => api.companies.autoHeartbeat.toggle(cid, enabled)));
    // Verify actual state from server
    const verify = await api.companies.list().catch(() => null);
    if (verify?.companies) {
      const actual = verify.companies.length > 0 && verify.companies.every((c: any) => Number(c.autoHeartbeat) === 1);
      setAutoHeartbeat(actual);
    }
  };
  const [deleteConfirm, setDeleteConfirm] = useState(false);

  // AI Approval Mode
  const [aiApprovalMode, setAiApprovalMode] = useState(() => {
    try { return localStorage.getItem('velbaz_ai_approval') === 'true'; } catch { return false; }
  });

  useEffect(() => {
    try { localStorage.setItem('velbaz_ai_approval', String(aiApprovalMode)); } catch {}
  }, [aiApprovalMode]);

  // Ne pas rejeter vers /login pendant que la session est encore en cours de vérification
  useEffect(() => {
    if (!authLoading && !user) navigate('/login');
  }, [authLoading, user]);

  if (authLoading) return <div className="h-full" style={{ background: 'var(--surface-0)' }} />;
  if (!user) return null;

  const handleLogout = async () => { await logout(); navigate('/'); };

  const sections: { id: Section; label: string; icon: React.ReactNode }[] = [
    { id: 'general', label: t('settings.nav.general'), icon: <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round"><circle cx="8" cy="8" r="2.5"/><path d="M8 1.5V3M8 13V14.5M1.5 8H3M13 8H14.5M3.3 3.3L4.3 4.3M11.7 11.7L12.7 12.7M12.7 3.3L11.7 4.3M4.3 11.7L3.3 12.7"/></svg> },
    { id: 'ai', label: t('settings.nav.ai'), icon: <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round"><path d="M8 1L2 4.5V11.5L8 15L14 11.5V4.5L8 1Z"/><path d="M8 8V15M8 8L2 4.5M8 8L14 4.5"/></svg> },
    { id: 'account', label: t('settings.nav.account'), icon: <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round"><circle cx="8" cy="5" r="3"/><path d="M2 14C2 11.2 4.7 9 8 9C11.3 9 14 11.2 14 14"/></svg> },
  ];

  return (
    <div className="h-full flex" style={{ background: 'var(--surface-0)' }}>
      {/* Left nav */}
      <div className="w-[220px] shrink-0 py-8 px-5 flex flex-col" style={{ borderRight: '1px solid var(--border-subtle)' }}>
        <h1 className="text-[15px] font-semibold mb-6 px-2" style={{ color: 'var(--text-secondary)' }}>{t('settings.title')}</h1>
        <nav className="space-y-0.5 flex-1">
          {sections.map(s => (
            <button
              key={s.id}
              onClick={() => setSection(s.id)}
              className="w-full flex items-center gap-2.5 px-2.5 py-2 rounded-lg text-left transition-all"
              style={{
                background: section === s.id ? 'var(--surface-4)' : 'transparent',
                color: section === s.id ? 'var(--text-secondary)' : 'var(--text-dim)',
              }}
              onMouseEnter={e => { if (section !== s.id) e.currentTarget.style.background = 'var(--surface-3)'; }}
              onMouseLeave={e => { if (section !== s.id) e.currentTarget.style.background = 'transparent'; }}
            >
              <span className="shrink-0 opacity-70">{s.icon}</span>
              <span className="text-[13px] font-medium">{s.label}</span>
            </button>
          ))}
        </nav>
        <div className="px-2 pt-4" style={{ borderTop: '1px solid var(--border-subtle)' }}>
          <div className="text-[10px]" style={{ color: 'var(--text-ghost)' }}>velbaz v0.1</div>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto py-8 px-10">
        <div className="w-full max-w-[900px]">
          {section === 'general' && <GeneralSection
            notifications={notifications} setNotifications={setNotifications}
            emailDigest={emailDigest} setEmailDigest={setEmailDigest}
            autoHeartbeat={autoHeartbeat} setAutoHeartbeat={handleAutoHeartbeatToggle}
            language={locale} setLanguage={setLocale}
            theme={resolved} toggleTheme={toggleTheme} t={t}
          />}
          {section === 'ai' && <AISection aiApprovalMode={aiApprovalMode} setAiApprovalMode={setAiApprovalMode} t={t} />}
          {section === 'account' && <AccountSection
            user={user} handleLogout={handleLogout}
            deleteConfirm={deleteConfirm} setDeleteConfirm={setDeleteConfirm}
            navigate={navigate} t={t}
          />}
        </div>
      </div>
    </div>
  );
}

/* ── General ── */
function GeneralSection({ notifications, setNotifications, emailDigest, setEmailDigest, autoHeartbeat, setAutoHeartbeat, language, setLanguage, theme, toggleTheme, t }: any) {
  return (
    <>
      <SectionHeader title={t('general.title')} desc={t('general.desc')} />

      <Card title={t('general.notifications')}>
        <div className="space-y-4">
          <ToggleRow label={t('general.push')} desc={t('general.push.desc')} value={notifications} onChange={setNotifications} />
          <ToggleRow label={t('general.digest')} desc={t('general.digest.desc')} value={emailDigest} onChange={setEmailDigest} />
          <ToggleRow label={t('general.heartbeat')} desc={t('general.heartbeat.desc')} value={autoHeartbeat ?? false} onChange={setAutoHeartbeat} disabled={autoHeartbeat === null} />
        </div>
      </Card>

      <Card title={t('general.appearance')}>
        <div className="flex items-center justify-between">
          <div>
            <div className="text-[13px] font-medium" style={{ color: 'var(--text-muted)' }}>{t('general.theme')}</div>
            <div className="text-[11px] mt-0.5" style={{ color: 'var(--text-ghost)' }}>{theme === 'dark' ? t('general.theme.dark') : t('general.theme.light')}</div>
          </div>
          <AnimatedThemeToggler />
        </div>
      </Card>

      <Card title={t('lang.card')}>
        <LanguagePicker language={language} setLanguage={setLanguage} t={t} />
      </Card>
    </>
  );
}

/* ── Sélecteur de langue (remplace le <select> natif) ── */
function LanguagePicker({ language, setLanguage, t }: { language: Locale; setLanguage: (l: Locale) => void; t: (k: string) => string }) {
  const [open, setOpen] = useState(false);
  const [closing, setClosing] = useState(false);
  const current = LOCALES.find(l => l.code === language) ?? LOCALES[0];

  // Démontage différé : sans ça la modale disparaîtrait sèchement, sans animation de sortie.
  const close = () => {
    if (closing) return;
    setClosing(true);
    setTimeout(() => { setOpen(false); setClosing(false); }, 150);
  };

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') close(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, closing]);

  const pick = (code: Locale) => { setLanguage(code); close(); };

  return (
    <div className="relative">
      <label className="text-[11px] font-medium mb-2 block" style={{ color: 'var(--text-dim)' }}>{t('lang.label')}</label>
      <button
        onClick={() => (open ? close() : setOpen(true))}
        className="h-11 px-3.5 rounded-xl text-[13px] w-full flex items-center gap-3 text-left transition-colors"
        style={{ background: 'var(--surface-3)', border: '1px solid var(--border-default)', color: 'var(--text-muted)' }}
        onMouseEnter={e => e.currentTarget.style.background = 'var(--surface-4)'}
        onMouseLeave={e => e.currentTarget.style.background = 'var(--surface-3)'}
      >
        <span className="w-7 h-7 rounded-lg flex items-center justify-center shrink-0 text-[10px] font-semibold uppercase tracking-wider"
          style={{ background: 'var(--surface-4)', color: 'var(--text-dim)' }}>{current.code}</span>
        <span className="flex-1 min-w-0">
          <span className="block font-medium truncate" style={{ color: 'var(--text-secondary)' }}>{current.label}</span>
          <span className="block text-[10px] truncate" style={{ color: 'var(--text-ghost)' }}>{current.region}</span>
        </span>
        <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" style={{ color: 'var(--text-ghost)' }}>
          <path d="M4 6.5L8 10.5L12 6.5"/>
        </svg>
      </button>
      <div className="text-[10px] mt-2" style={{ color: 'var(--text-ghost)' }}>{t('lang.hint')}</div>

      {open && (
        <>
          {/* Clic hors du menu : ferme, sans voile ni flou */}
          <div onClick={close} style={{ position: 'fixed', inset: 0, zIndex: 190, background: 'transparent' }} />
          <div
            role="listbox"
            className={`absolute left-0 right-0 rounded-xl overflow-hidden ${closing ? 'animate-lang-pop-out' : 'animate-lang-pop-in'}`}
            style={{ top: 'calc(100% - 22px)', zIndex: 200, background: 'var(--surface-1, var(--surface-2))', border: '1px solid var(--border-default)', boxShadow: '0 14px 34px rgba(0,0,0,0.28)' }}
          >
            <div className="p-1 max-h-[180px] overflow-y-auto">
              {LOCALES.map((l, i) => {
                const active = l.code === language;
                return (
                  <button
                    key={l.code}
                    onClick={() => pick(l.code)}
                    className="w-full flex items-center gap-2.5 px-2.5 py-1.5 rounded-lg text-left transition-colors animate-lang-row-in"
                    style={{ background: active ? 'var(--surface-4)' : 'transparent', animationDelay: `${30 + i * 25}ms` }}
                    onMouseEnter={e => { if (!active) e.currentTarget.style.background = 'var(--surface-3)'; }}
                    onMouseLeave={e => { if (!active) e.currentTarget.style.background = 'transparent'; }}
                  >
                    <span className="w-5 h-5 rounded-md flex items-center justify-center shrink-0 text-[9px] font-semibold uppercase tracking-wider"
                      style={{ background: 'var(--surface-4)', color: 'var(--text-dim)' }}>{l.code}</span>
                    <span className="flex-1 min-w-0 flex items-center gap-2">
                      <span className="text-[12px] font-medium truncate" style={{ color: 'var(--text-secondary)' }}>{l.label}</span>
                      <span className="text-[10px] truncate" style={{ color: 'var(--text-ghost)' }}>{l.region}</span>
                    </span>
                    {active && (
                      <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" style={{ color: 'var(--text-dim)' }}>
                        <path d="M3 8.5L6.2 11.5L13 4.8"/>
                      </svg>
                    )}
                  </button>
                );
              })}
            </div>
          </div>
        </>
      )}
    </div>
  );
}

/* ── AI Behavior ── */
function AISection({ aiApprovalMode, setAiApprovalMode, t }: { aiApprovalMode: boolean; setAiApprovalMode: (v: boolean) => void; t: (k: string) => string }) {
  return (
    <>
      <SectionHeader title={t('ai.title')} desc={t('ai.desc')} />

      <Card>
        <div className="flex gap-4">
          <div className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0" style={{ background: aiApprovalMode ? 'var(--teal-bg)' : 'var(--surface-4)' }}>
            <svg width="18" height="18" viewBox="0 0 16 16" fill="none" stroke={aiApprovalMode ? 'var(--text-secondary)' : 'var(--text-ghost)'} strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round">
              <path d="M8 1L2 4.5V11.5L8 15L14 11.5V4.5L8 1Z"/>
              <path d="M5.5 8L7 9.5L10.5 6"/>
            </svg>
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center justify-between mb-1">
              <div className="text-[14px] font-semibold" style={{ color: 'var(--text-secondary)' }}>Manual Approval Mode</div>
              <ToggleSwitch value={aiApprovalMode} onChange={setAiApprovalMode} />
            </div>
            <p className="text-[12px] leading-relaxed" style={{ color: 'var(--text-dim)' }}>
              When enabled, the AI will pause before each major decision and ask for your approval. You can accept the proposed action or decline it with an explanation to redirect the AI.
            </p>
          </div>
        </div>

        {aiApprovalMode && (
          <div className="mt-5 pt-5" style={{ borderTop: '1px solid var(--border-subtle)' }}>
            <div className="flex items-start gap-3 p-4 rounded-xl" style={{ background: 'var(--teal-subtle-bg)', border: '1px solid var(--teal-subtle-border)' }}>
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="var(--text-secondary)" strokeWidth="1.3" className="shrink-0 mt-0.5">
                <circle cx="8" cy="8" r="6"/>
                <path d="M8 5V8.5M8 10.5V11"/>
              </svg>
              <div>
                <div className="text-[12px] font-medium mb-1" style={{ color: 'var(--teal)' }}>How it works</div>
                <p className="text-[11px] leading-relaxed" style={{ color: 'var(--text-dim)' }}>
                  Before each action (designing products, writing content, choosing strategies...), a popup will appear in the chat showing what the AI wants to do. You can:
                </p>
                <ul className="mt-2 space-y-1.5">
                  <li className="flex items-center gap-2 text-[11px]" style={{ color: 'var(--text-dim)' }}>
                    <span className="w-5 h-5 rounded-md flex items-center justify-center shrink-0" style={{ background: 'var(--teal-bg)' }}>
                      <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="var(--text-secondary)" strokeWidth="1.5"><path d="M2 5L4 7L8 3"/></svg>
                    </span>
                    <span><strong>Accept</strong> — the AI proceeds with its plan</span>
                  </li>
                  <li className="flex items-center gap-2 text-[11px]" style={{ color: 'var(--text-dim)' }}>
                    <span className="w-5 h-5 rounded-md flex items-center justify-center shrink-0" style={{ background: 'var(--red-subtle-bg)' }}>
                      <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="var(--destructive)" strokeWidth="1.5"><path d="M2.5 2.5L7.5 7.5M7.5 2.5L2.5 7.5"/></svg>
                    </span>
                    <span><strong>Decline</strong> — explain what you want instead, and the AI will adapt</span>
                  </li>
                </ul>
              </div>
            </div>

            {/* Demo preview */}
            <div className="mt-4">
              <div className="text-[10px] font-medium uppercase tracking-widest mb-2" style={{ color: 'var(--text-ghost)' }}>Preview</div>
              <ApprovalPopupDemo />
            </div>
          </div>
        )}
      </Card>

      <Card title="Autonomy Level">
        <p className="text-[12px] mb-4" style={{ color: 'var(--text-dim)' }}>
          Choose how independently your AI agents operate. Higher autonomy means fewer interruptions but less control.
        </p>
        <div className="space-y-2">
          {[
            { level: 'full', label: 'Full Autonomy', desc: 'AI acts on all decisions without asking', disabled: aiApprovalMode },
            { level: 'major', label: 'Major Decisions Only', desc: 'AI asks approval for big decisions (budget, strategy)', disabled: false },
            { level: 'all', label: 'Every Decision', desc: 'AI asks approval for every action it takes', disabled: false },
          ].map(opt => (
            <label key={opt.level}
              className="flex items-center gap-3 p-3 rounded-lg cursor-pointer transition-colors"
              style={{
                background: (!aiApprovalMode && opt.level === 'full') || (aiApprovalMode && opt.level === 'all') ? 'var(--surface-4)' : 'var(--surface-2)',
                border: `1px solid ${(!aiApprovalMode && opt.level === 'full') || (aiApprovalMode && opt.level === 'all') ? 'var(--border-hover)' : 'var(--border-default)'}`,
                opacity: opt.disabled ? 0.4 : 1,
                pointerEvents: opt.disabled ? 'none' : 'auto',
              }}
              onMouseEnter={e => { if (!opt.disabled) e.currentTarget.style.background = 'var(--surface-4)'; }}
              onMouseLeave={e => { if (!opt.disabled) e.currentTarget.style.background = (!aiApprovalMode && opt.level === 'full') || (aiApprovalMode && opt.level === 'all') ? 'var(--surface-4)' : 'var(--surface-2)'; }}
            >
              <div className="w-4 h-4 rounded-full flex items-center justify-center shrink-0"
                style={{
                  border: `2px solid ${(!aiApprovalMode && opt.level === 'full') || (aiApprovalMode && opt.level === 'all') ? 'var(--text-primary)' : 'var(--border-hover)'}`,
                }}>
                {((!aiApprovalMode && opt.level === 'full') || (aiApprovalMode && opt.level === 'all')) && (
                  <div className="w-2 h-2 rounded-full" style={{ background: 'var(--text-primary)' }} />
                )}
              </div>
              <div>
                <div className="text-[12px] font-medium" style={{ color: 'var(--text-muted)' }}>{opt.label}</div>
                <div className="text-[10px]" style={{ color: 'var(--text-ghost)' }}>{opt.desc}</div>
              </div>
            </label>
          ))}
        </div>
      </Card>
    </>
  );
}

/* ── Account ── */
function AccountSection({ user, handleLogout, deleteConfirm, setDeleteConfirm, navigate, t }: any) {
  return (
    <>
      <SectionHeader title={t('account.title')} desc={t('account.desc')} />

      <Card>
        <div className="flex items-center gap-4">
          <div className="relative shrink-0">
            <div className="w-14 h-14 rounded-full flex items-center justify-center text-lg font-bold shrink-0" style={{ background: 'var(--teal)', color: 'var(--text-inverse)' }}>
              {user.name?.[0]?.toUpperCase() || 'U'}
            </div>
            {isAdminUser(user) && (
              <span style={{ position: 'absolute', top: -3, right: -3, lineHeight: 0 }}>
                <VerifiedBadge size={20} ringColor="var(--surface-1)" />
              </span>
            )}
          </div>
          <div className="flex-1 min-w-0">
            <div className="text-[16px] font-semibold" style={{ color: 'var(--text-secondary)' }}>{user.name}</div>
            <div className="text-[12px]" style={{ color: 'var(--text-dim)' }}>{user.email}</div>
          </div>
          <button onClick={() => navigate('/profile')}
            className="px-3 py-1.5 rounded-lg text-[11px] font-medium transition-colors shrink-0"
            style={{ background: 'var(--surface-3)', border: '1px solid var(--border-default)', color: 'var(--text-muted)' }}
            onMouseEnter={e => e.currentTarget.style.background = 'var(--surface-4)'}
            onMouseLeave={e => e.currentTarget.style.background = 'var(--surface-3)'}
          >
            Edit Profile
          </button>
        </div>
      </Card>

      <Card title="Plan">
        <div className="flex items-center justify-between">
          <div>
            <div className="flex items-center gap-2">
              <span className="text-[15px] font-semibold capitalize" style={{ color: 'var(--text-secondary)' }}>{user.plan || 'Free'}</span>
              {user.plan === 'free' && <span className="text-[9px] px-1.5 py-0.5 rounded font-medium" style={{ background: 'var(--surface-4)', color: 'var(--text-dim)' }}>Limited</span>}
              {user.plan === 'business' && <span className="text-[9px] px-1.5 py-0.5 rounded font-medium" style={{ background: 'var(--teal-subtle)', color: 'var(--teal)' }}>Active</span>}
            </div>
            <div className="text-[11px] mt-1" style={{ color: 'var(--text-ghost)' }}>
              {user.plan === 'free' ? 'Upgrade for unlimited agents and features' : 'You have access to all features'}
            </div>
          </div>
          <button onClick={() => navigate('/plans')}
            className="px-3 py-1.5 rounded-lg text-[11px] font-medium transition-colors"
            style={{ background: 'var(--surface-3)', border: '1px solid var(--border-default)', color: 'var(--text-muted)' }}
            onMouseEnter={e => e.currentTarget.style.background = 'var(--surface-4)'}
            onMouseLeave={e => e.currentTarget.style.background = 'var(--surface-3)'}
          >
            {user.plan === 'free' ? 'Upgrade' : 'Manage'}
          </button>
        </div>
      </Card>

      <Card title="Session">
        <div className="flex items-center justify-between">
          <div>
            <div className="text-[12px] font-medium" style={{ color: 'var(--text-muted)' }}>Currently signed in</div>
            <div className="text-[11px] mt-0.5" style={{ color: 'var(--text-ghost)' }}>{user.email}</div>
          </div>
          <button onClick={handleLogout}
            className="h-9 px-4 rounded-lg text-[12px] font-medium transition-colors"
            style={{ background: 'var(--surface-3)', color: 'var(--text-muted)', border: '1px solid var(--border-default)' }}
            onMouseEnter={e => { e.currentTarget.style.background = 'var(--red-subtle-bg)'; e.currentTarget.style.color = 'var(--red-text)'; e.currentTarget.style.borderColor = 'var(--red-subtle-border)'; }}
            onMouseLeave={e => { e.currentTarget.style.background = 'var(--surface-3)'; e.currentTarget.style.color = 'var(--text-muted)'; e.currentTarget.style.borderColor = 'var(--border-default)'; }}
          >
            Sign Out
          </button>
        </div>
      </Card>

      <Card danger>
        <h3 className="text-[13px] font-medium mb-2" style={{ color: 'var(--destructive)' }}>Danger Zone</h3>
        <p className="text-[11px] mb-4" style={{ color: 'var(--text-dim)' }}>
          Once you delete your account, there is no going back. All your companies, agents and data will be permanently removed.
        </p>
        {!deleteConfirm ? (
          <button onClick={() => setDeleteConfirm(true)}
            className="h-9 px-4 rounded-lg text-[12px] font-medium transition-colors"
            style={{ background: 'var(--red-subtle-bg)', color: 'var(--red-text)', border: '1px solid var(--red-subtle-border)' }}
            onMouseEnter={e => e.currentTarget.style.background = 'var(--destructive)'}
            onMouseLeave={e => e.currentTarget.style.background = 'var(--red-subtle-bg)'}
          >
            Delete Account
          </button>
        ) : (
          <div className="flex items-center gap-2">
            <button onClick={() => setDeleteConfirm(false)}
              className="h-9 px-4 rounded-lg text-[12px] font-medium"
              style={{ background: 'var(--surface-3)', color: 'var(--text-muted)', border: '1px solid var(--border-default)' }}>
              Cancel
            </button>
            <button className="h-9 px-4 rounded-lg text-[12px] font-medium"
              style={{ background: 'var(--destructive)', color: '#fff' }}>
              Yes, Delete Everything
            </button>
          </div>
        )}
      </Card>
    </>
  );
}

/* ── Demo Popup ── */
function ApprovalPopupDemo() {
  const [state, setState] = useState<'pending' | 'accepted' | 'declined'>('pending');
  const [declineText, setDeclineText] = useState('');
  const [showDeclineInput, setShowDeclineInput] = useState(false);

  const reset = () => { setState('pending'); setShowDeclineInput(false); setDeclineText(''); };

  return (
    <div className="rounded-xl overflow-hidden" style={{ background: 'var(--surface-2)', border: '1px solid var(--border-default)' }}>
      {/* Header */}
      <div className="px-4 py-3 flex items-center gap-2" style={{ borderBottom: '1px solid var(--border-subtle)' }}>
        <div className="w-6 h-6 rounded-md flex items-center justify-center" style={{ background: 'var(--teal-bg)' }}>
          <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="var(--text-secondary)" strokeWidth="1.5">
            <path d="M8 1L2 4.5V11.5L8 15L14 11.5V4.5L8 1Z"/>
          </svg>
        </div>
        <span className="text-[11px] font-semibold" style={{ color: 'var(--teal)' }}>AI Decision — Approval Required</span>
      </div>

      {/* Content */}
      <div className="px-4 py-3">
        <p className="text-[12px] leading-relaxed" style={{ color: 'var(--text-muted)' }}>
          I'd like to create 3 product mockups for the new "Summer Collection" using a minimalist photography style on white backgrounds. Each product will be shown from the front with soft studio lighting.
        </p>
      </div>

      {/* Actions */}
      <div className="px-4 py-3" style={{ borderTop: '1px solid var(--border-subtle)' }}>
        {state === 'pending' && !showDeclineInput && (
          <div className="flex items-center gap-2">
            <button onClick={() => setState('accepted')}
              className="h-8 px-4 rounded-lg text-[12px] font-medium flex items-center gap-1.5 transition-colors"
              style={{ background: 'var(--btn-primary-bg)', color: 'var(--btn-primary-fg)' }}
              onMouseEnter={e => e.currentTarget.style.opacity = '0.9'}
              onMouseLeave={e => e.currentTarget.style.opacity = '1'}
            >
              <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="2"><path d="M2 6L5 9L10 3"/></svg>
              Accept
            </button>
            <button onClick={() => setShowDeclineInput(true)}
              className="h-8 px-4 rounded-lg text-[12px] font-medium transition-colors"
              style={{ background: 'var(--surface-4)', color: 'var(--text-dim)', border: '1px solid var(--border-default)' }}
              onMouseEnter={e => { e.currentTarget.style.background = 'var(--red-subtle-bg)'; e.currentTarget.style.color = 'var(--red-text)'; }}
              onMouseLeave={e => { e.currentTarget.style.background = 'var(--surface-4)'; e.currentTarget.style.color = 'var(--text-dim)'; }}
            >
              Decline
            </button>
          </div>
        )}

        {showDeclineInput && state === 'pending' && (
          <div>
            <p className="text-[11px] mb-2" style={{ color: 'var(--text-dim)' }}>Explain what you'd prefer instead:</p>
            <textarea
              value={declineText}
              onChange={e => setDeclineText(e.target.value)}
              placeholder="I'd rather use a lifestyle setting with warm tones..."
              className="w-full h-16 px-3 py-2 rounded-lg text-[12px] outline-none resize-none"
              style={{ background: 'var(--surface-3)', border: '1px solid var(--border-default)', color: 'var(--text-muted)' }}
            />
            <div className="flex items-center gap-2 mt-2">
              <button onClick={() => setState('declined')}
                className="h-8 px-4 rounded-lg text-[12px] font-medium transition-colors"
                style={{ background: 'var(--red-subtle-bg)', color: 'var(--red-text)', border: '1px solid var(--red-subtle-border)' }}
              >
                Send & Decline
              </button>
              <button onClick={() => setShowDeclineInput(false)}
                className="h-8 px-3 rounded-lg text-[12px] transition-colors"
                style={{ color: 'var(--text-ghost)' }}
              >
                Cancel
              </button>
            </div>
          </div>
        )}

        {state === 'accepted' && (
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="var(--text-secondary)" strokeWidth="1.5"><circle cx="7" cy="7" r="5"/><path d="M4.5 7L6 8.5L9.5 5"/></svg>
              <span className="text-[12px] font-medium" style={{ color: 'var(--teal)' }}>Approved — AI is proceeding</span>
            </div>
            <button onClick={reset} className="text-[10px] underline" style={{ color: 'var(--text-ghost)' }}>Reset demo</button>
          </div>
        )}

        {state === 'declined' && (
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="var(--destructive)" strokeWidth="1.5"><circle cx="7" cy="7" r="5"/><path d="M5 5L9 9M9 5L5 9"/></svg>
              <span className="text-[12px] font-medium" style={{ color: 'var(--destructive)' }}>Declined — AI will adapt to your feedback</span>
            </div>
            <button onClick={reset} className="text-[10px] underline" style={{ color: 'var(--text-ghost)' }}>Reset demo</button>
          </div>
        )}
      </div>
    </div>
  );
}

/* ── Shared Components ── */
function SectionHeader({ title, desc }: { title: string; desc: string }) {
  return (
    <div className="mb-6">
      <h2 className="text-[20px] font-semibold mb-1" style={{ color: 'var(--text-secondary)' }}>{title}</h2>
      <p className="text-[13px]" style={{ color: 'var(--text-dim)' }}>{desc}</p>
    </div>
  );
}

function Card({ title, children, danger }: { title?: string; children: React.ReactNode; danger?: boolean }) {
  return (
    <div className="rounded-xl p-5 mb-4" style={{ background: 'var(--surface-1)', border: `1px solid ${danger ? 'var(--red-subtle-border)' : 'var(--border-subtle)'}` }}>
      {title && <h3 className="text-[13px] font-medium mb-4" style={{ color: danger ? 'var(--destructive)' : 'var(--text-dim)' }}>{title}</h3>}
      {children}
    </div>
  );
}

function ToggleRow({ label, desc, value, onChange, disabled }: { label: string; desc: string; value: boolean; onChange: (v: boolean) => void; disabled?: boolean }) {
  return (
    <div className="flex items-center justify-between" style={{ opacity: disabled ? 0.5 : 1, pointerEvents: disabled ? 'none' : 'auto' }}>
      <div>
        <div className="text-[13px] font-medium" style={{ color: 'var(--text-muted)' }}>{label}</div>
        <div className="text-[11px] mt-0.5" style={{ color: 'var(--text-ghost)' }}>{desc}</div>
      </div>
      <ToggleSwitch value={value} onChange={onChange} />
    </div>
  );
}

function ToggleSwitch({ value, onChange }: { value: boolean; onChange: (v: boolean) => void }) {
  const TRACK_W = 34;
  const TRACK_H = 20;
  const THUMB = 16;
  const PAD = 2;
  const TRAVEL = TRACK_W - THUMB - PAD * 2;
  const PILL_EXT = 2;
  const PRESS_EXT = 4;
  const PRESS_SHRINK = 4;

  const [hovered, setHovered] = React.useState(false);
  const [pressed, setPressed] = React.useState(false);

  const thumbW = pressed ? THUMB + PRESS_EXT : hovered ? THUMB + PILL_EXT : THUMB;
  const thumbH = pressed ? THUMB - PRESS_SHRINK : THUMB;
  const thumbY = pressed ? PAD + PRESS_SHRINK / 2 : PAD;
  const extra = thumbW - THUMB;
  const thumbX = value ? PAD + TRAVEL - extra : PAD;

  return (
    <button
      onClick={() => onChange(!value)}
      onPointerEnter={() => setHovered(true)}
      onPointerLeave={() => { setHovered(false); setPressed(false); }}
      onPointerDown={() => setPressed(true)}
      onPointerUp={() => setPressed(false)}
      className="relative shrink-0 rounded-full outline-none cursor-pointer select-none touch-none"
      style={{
        width: TRACK_W,
        height: TRACK_H,
        background: value
          ? (hovered ? '#5C89F2' : '#6B97FF')
          : (hovered ? 'var(--text-ghost)' : 'var(--border-default)'),
        transition: 'background 80ms ease',
      }}
    >
      <div
        className="absolute rounded-full"
        style={{
          width: thumbW,
          height: thumbH,
          top: thumbY,
          left: thumbX,
          background: '#fff',
          boxShadow: '0 1px 3px rgba(0,0,0,.2)',
          transition: 'all 160ms cubic-bezier(0.34, 1.56, 0.64, 1)',
        }}
      />
    </button>
  );
}
