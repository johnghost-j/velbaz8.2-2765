/**
 * SocialConnectPopup — Multi-step animated popup during project creation
 * Asks user which platforms to connect (Twitter/X, Discord, Reddit, Instagram)
 * Then redirects to OAuth for each selected platform.
 */

import { useState, useEffect } from 'react';
import { getAuthToken } from '../lib/token';
import { createPortal } from 'react-dom';

function getToken() {
  return getAuthToken();
}

const PLATFORMS = [
  {
    id: 'twitter',
    name: 'Twitter / X',
    icon: (
      <svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor">
        <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z"/>
      </svg>
    ),
    color: '#000',
    darkColor: '#fff',
    desc: 'Post tweets, reply to mentions, build your audience',
  },
  {
    id: 'discord',
    name: 'Discord',
    icon: (
      <svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor">
        <path d="M20.317 4.37a19.791 19.791 0 0 0-4.885-1.515.074.074 0 0 0-.079.037c-.21.375-.444.864-.608 1.25a18.27 18.27 0 0 0-5.487 0 12.64 12.64 0 0 0-.617-1.25.077.077 0 0 0-.079-.037A19.736 19.736 0 0 0 3.677 4.37a.07.07 0 0 0-.032.027C.533 9.046-.32 13.58.099 18.057a.082.082 0 0 0 .031.057 19.9 19.9 0 0 0 5.993 3.03.078.078 0 0 0 .084-.028 14.09 14.09 0 0 0 1.226-1.994.076.076 0 0 0-.041-.106 13.107 13.107 0 0 1-1.872-.892.077.077 0 0 1-.008-.128 10.2 10.2 0 0 0 .372-.292.074.074 0 0 1 .077-.01c3.928 1.793 8.18 1.793 12.062 0a.074.074 0 0 1 .078.01c.12.098.246.198.373.292a.077.077 0 0 1-.006.127 12.299 12.299 0 0 1-1.873.892.077.077 0 0 0-.041.107c.36.698.772 1.362 1.225 1.993a.076.076 0 0 0 .084.028 19.839 19.839 0 0 0 6.002-3.03.077.077 0 0 0 .032-.054c.5-5.177-.838-9.674-3.549-13.66a.061.061 0 0 0-.031-.03z"/>
      </svg>
    ),
    color: '#5865F2',
    darkColor: '#5865F2',
    desc: 'Create servers, moderate channels, animate your community',
  },
  {
    id: 'reddit',
    name: 'Reddit',
    icon: (
      <svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor">
        <path d="M12 0A12 12 0 0 0 0 12a12 12 0 0 0 12 12 12 12 0 0 0 12-12A12 12 0 0 0 12 0zm5.01 4.744c.688 0 1.25.561 1.25 1.249a1.25 1.25 0 0 1-2.498.056l-2.597-.547-.8 3.747c1.824.07 3.48.632 4.674 1.488.308-.309.73-.491 1.207-.491.968 0 1.754.786 1.754 1.754 0 .716-.435 1.333-1.01 1.614a3.111 3.111 0 0 1 .042.52c0 2.694-3.13 4.87-7.004 4.87-3.874 0-7.004-2.176-7.004-4.87 0-.183.015-.366.043-.534A1.748 1.748 0 0 1 4.028 12c0-.968.786-1.754 1.754-1.754.463 0 .898.196 1.207.49 1.207-.883 2.878-1.43 4.744-1.487l.885-4.182a.342.342 0 0 1 .14-.197.35.35 0 0 1 .238-.042l2.906.617a1.214 1.214 0 0 1 1.108-.701zM9.25 12C8.561 12 8 12.562 8 13.25c0 .687.561 1.248 1.25 1.248.687 0 1.248-.561 1.248-1.249 0-.688-.561-1.249-1.249-1.249zm5.5 0c-.687 0-1.248.561-1.248 1.25 0 .687.561 1.248 1.249 1.248.688 0 1.249-.561 1.249-1.249 0-.687-.562-1.249-1.25-1.249zm-5.466 3.99a.327.327 0 0 0-.231.094.33.33 0 0 0 0 .463c.842.842 2.484.913 2.961.913.477 0 2.105-.056 2.961-.913a.361.361 0 0 0 .029-.463.33.33 0 0 0-.464 0c-.547.533-1.684.73-2.512.73-.828 0-1.979-.196-2.512-.73a.326.326 0 0 0-.232-.095z"/>
      </svg>
    ),
    color: '#FF4500',
    darkColor: '#FF4500',
    desc: 'Post in subreddits, engage authentically, drive traffic',
  },
  {
    id: 'instagram',
    name: 'Instagram',
    icon: (
      <svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor">
        <path d="M12 2.163c3.204 0 3.584.012 4.85.07 3.252.148 4.771 1.691 4.919 4.919.058 1.265.069 1.645.069 4.849 0 3.205-.012 3.584-.069 4.849-.149 3.225-1.664 4.771-4.919 4.919-1.266.058-1.644.07-4.85.07-3.204 0-3.584-.012-4.849-.07-3.26-.149-4.771-1.699-4.919-4.92-.058-1.265-.07-1.644-.07-4.849 0-3.204.013-3.583.07-4.849.149-3.227 1.664-4.771 4.919-4.919 1.266-.057 1.645-.069 4.849-.069zm0-2.163c-3.259 0-3.667.014-4.947.072-4.358.2-6.78 2.618-6.98 6.98-.059 1.281-.073 1.689-.073 4.948 0 3.259.014 3.668.072 4.948.2 4.358 2.618 6.78 6.98 6.98 1.281.058 1.689.072 4.948.072 3.259 0 3.668-.014 4.948-.072 4.354-.2 6.782-2.618 6.979-6.98.059-1.28.073-1.689.073-4.948 0-3.259-.014-3.667-.072-4.947-.196-4.354-2.617-6.78-6.979-6.98-1.281-.059-1.69-.073-4.949-.073zm0 5.838c-3.403 0-6.162 2.759-6.162 6.162s2.759 6.163 6.162 6.163 6.162-2.759 6.162-6.163c0-3.403-2.759-6.162-6.162-6.162zm0 10.162c-2.209 0-4-1.79-4-4 0-2.209 1.791-4 4-4s4 1.791 4 4c0 2.21-1.791 4-4 4zm6.406-11.845c-.796 0-1.441.645-1.441 1.44s.645 1.44 1.441 1.44c.795 0 1.439-.645 1.439-1.44s-.644-1.44-1.439-1.44z"/>
      </svg>
    ),
    color: '#E4405F',
    darkColor: '#E4405F',
    desc: 'Share stories, reels, engage with followers visually',
  },
];

interface SocialConnectPopupProps {
  companyId: string;
  companyName?: string;
  open: boolean;
  onClose: () => void;
  onComplete: (selectedPlatforms: string[]) => void;
}

export function SocialConnectPopup({ companyId, companyName, open, onClose, onComplete }: SocialConnectPopupProps) {
  const [step, setStep] = useState<'select' | 'connecting' | 'done'>('select');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [connecting, setConnecting] = useState<string | null>(null);
  const [connected, setConnected] = useState<Set<string>>(new Set());
  const [visible, setVisible] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});

  useEffect(() => {
    if (open) {
      requestAnimationFrame(() => requestAnimationFrame(() => setVisible(true)));
    } else {
      setVisible(false);
    }
  }, [open]);

  // Listen for OAuth callback messages
  useEffect(() => {
    const handleMessage = (e: MessageEvent) => {
      if (e.data?.type === 'oauth-success') {
        setConnected(prev => new Set([...prev, e.data.platform]));
        setConnecting(null);
      }
    };
    window.addEventListener('message', handleMessage);
    return () => window.removeEventListener('message', handleMessage);
  }, []);

  const togglePlatform = (id: string) => {
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  // Vérifie côté serveur qu'une connexion réelle existe pour cette plateforme.
  // Ne jamais se fier à la simple fermeture de la popup OAuth.
  const verifyConnection = async (platformId: string): Promise<boolean> => {
    try {
      const token = getToken();
      const res = await fetch(`/api/companies/${companyId}/social/connections`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      if (!res.ok) return false;
      const data = await res.json() as any;
      const list: any[] = Array.isArray(data) ? data : (data.connections ?? []);
      return list.some(c => c.platform === platformId && Boolean(c.isActive) && !c.isDemo);
    } catch {
      return false;
    }
  };

  const startConnecting = async () => {
    if (selected.size === 0) {
      onComplete([]);
      return;
    }
    setStep('connecting');

    // Ne jamais relancer l'OAuth pour un compte déjà lié : X renvoie
    // "Something went wrong" quand on ré-autorise une session déjà active.
    const toConnect: string[] = [];
    for (const platformId of selected) {
      if (await verifyConnection(platformId)) {
        setConnected(prev => new Set([...prev, platformId]));
      } else {
        toConnect.push(platformId);
      }
    }
    if (toConnect.length === 0) {
      setConnecting(null);
      setStep('done');
      return;
    }

    for (const platformId of toConnect) {
      setConnecting(platformId);
      try {
        const token = getToken();
        const res = await fetch(`/api/companies/${companyId}/social/connect`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
          },
          // L'origine réelle du navigateur : le proxy réécrit Host/Origin côté serveur,
          // donc c'est le seul moyen fiable de faire revenir la popup OAuth ici.
          body: JSON.stringify({ platform: platformId, origin: window.location.origin }),
        });

        if (!res.ok) {
          const text = await res.text();
          throw new Error(`Server error ${res.status}: ${text.slice(0, 100)}`);
        }

        const data = await res.json() as { authUrl?: string; demo?: boolean; connected?: boolean };

        if (data.demo) {
          // Demo mode — instant, no popup needed
          setConnected(prev => new Set([...prev, platformId]));
        } else if (data.authUrl) {
          // Real OAuth — open popup
          const w = window.open(data.authUrl, `oauth_${platformId}`, 'width=600,height=700,left=200,top=100');
          if (!w) throw new Error('Popup bloquée par le navigateur — autorise les fenêtres surgissantes puis réessaie');

          const outcome = await new Promise<'success' | 'closed' | 'timeout'>((resolve) => {
            const cleanup = () => {
              window.removeEventListener('message', handleMsg);
              clearInterval(interval);
              clearTimeout(timer);
            };
            const handleMsg = (e: MessageEvent) => {
              if (e.data?.type === 'oauth-success' && e.data?.platform === platformId) {
                cleanup();
                resolve('success');
              }
            };
            window.addEventListener('message', handleMsg);
            const interval = setInterval(() => {
              if (w.closed) {
                cleanup();
                // Laisse le temps à un éventuel message de nous parvenir juste avant la fermeture
                setTimeout(() => resolve('closed'), 400);
              }
            }, 500);
            const timer = setTimeout(() => { cleanup(); resolve('timeout'); }, 120000);
          });

          if (outcome === 'success') {
            setConnected(prev => new Set([...prev, platformId]));
          } else {
            // La popup s'est fermée sans confirmation : on demande au serveur la vérité.
            const ok = await verifyConnection(platformId);
            if (ok) {
              setConnected(prev => new Set([...prev, platformId]));
            } else {
              throw new Error(
                outcome === 'timeout'
                  ? 'Délai dépassé — la connexion n’a pas été confirmée'
                  : 'Connexion annulée ou refusée — aucune autorisation reçue',
              );
            }
          }
        } else {
          throw new Error('No authUrl or demo flag in response');
        }
      } catch (err: any) {
        setErrors(prev => ({ ...prev, [platformId]: err.message }));
      }
    }

    setConnecting(null);
    setStep('done');
  };

  const handleDone = () => {
    onComplete(Array.from(connected));
    onClose();
    // Reset
    setTimeout(() => { setStep('select'); setSelected(new Set()); setConnected(new Set()); setErrors({}); }, 300);
  };

  const handleSkip = () => {
    onComplete([]);
    onClose();
    setTimeout(() => { setStep('select'); setSelected(new Set()); }, 300);
  };

  if (!open) return null;

  return createPortal(
    <div
      className="fixed inset-0 z-[9999] flex items-center justify-center"
      style={{
        background: visible ? 'rgba(0,0,0,0.6)' : 'rgba(0,0,0,0)',
        backdropFilter: visible ? 'blur(8px)' : 'blur(0px)',
        transition: 'background 300ms ease, backdrop-filter 300ms ease',
      }}
      onClick={(e) => { if (e.target === e.currentTarget) handleSkip(); }}
    >
      <div
        style={{
          opacity: visible ? 1 : 0,
          transform: visible ? 'translateY(0) scale(1)' : 'translateY(20px) scale(0.95)',
          transition: 'opacity 300ms ease, transform 300ms cubic-bezier(0.16, 1, 0.3, 1)',
          background: 'var(--surface-1)',
          border: '1px solid var(--border-default)',
          maxWidth: 520,
          width: '90vw',
        }}
        className="rounded-2xl overflow-hidden shadow-2xl"
      >
        {/* Header */}
        <div className="px-6 pt-6 pb-4" style={{ borderBottom: '1px solid var(--border-subtle)' }}>
          <div className="flex items-center gap-3 mb-2">
            <div className="w-10 h-10 rounded-xl flex items-center justify-center" style={{ background: 'var(--surface-4)', color: 'var(--text-primary)' }}>
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/>
                <circle cx="9" cy="7" r="4"/>
                <path d="M23 21v-2a4 4 0 0 0-3-3.87"/>
                <path d="M16 3.13a4 4 0 0 1 0 7.75"/>
              </svg>
            </div>
            <div>
              <h2 className="text-[16px] font-semibold" style={{ color: 'var(--text-primary)' }}>
                Community & Social AI
              </h2>
              <p className="text-[12px]" style={{ color: 'var(--text-ghost)' }}>
                {companyName ? `${companyName} — ` : ''}Connect your platforms
              </p>
            </div>
          </div>
          <p className="text-[13px] leading-relaxed" style={{ color: 'var(--text-muted)' }}>
            Our AI will manage your social presence — posting content, replying to people, growing your community.
            All communications are verified by 6 AI brains before publishing.
          </p>
        </div>

        {/* Body */}
        <div className="px-6 py-5">
          {step === 'select' && (
            <div className="space-y-3">
              <p className="text-[11px] font-medium uppercase tracking-wider mb-3" style={{ color: 'var(--text-ghost)' }}>
                Select platforms to connect
              </p>
              {PLATFORMS.map((p) => (
                <button
                  key={p.id}
                  onClick={() => togglePlatform(p.id)}
                  className="w-full flex items-center gap-3 px-4 py-3 rounded-xl transition-all"
                  style={{
                    background: selected.has(p.id) ? 'var(--surface-4)' : 'var(--surface-2)',
                    border: `1.5px solid ${selected.has(p.id) ? 'var(--border-hover)' : 'var(--border-subtle)'}`,
                  }}
                >
                  <div className="shrink-0 w-10 h-10 rounded-lg flex items-center justify-center" style={{ color: p.color, background: `${p.color}15` }}>
                    {p.icon}
                  </div>
                  <div className="flex-1 text-left">
                    <div className="text-[13px] font-medium" style={{ color: 'var(--text-primary)' }}>{p.name}</div>
                    <div className="text-[11px]" style={{ color: 'var(--text-ghost)' }}>{p.desc}</div>
                  </div>
                  <div className="shrink-0 w-5 h-5 rounded-md flex items-center justify-center transition-colors"
                    style={{
                      background: selected.has(p.id) ? 'var(--text-primary)' : 'transparent',
                      border: `2px solid ${selected.has(p.id) ? 'var(--text-primary)' : 'var(--border-default)'}`,
                    }}>
                    {selected.has(p.id) && (
                      <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M2.5 6L5 8.5L9.5 3.5"/>
                      </svg>
                    )}
                  </div>
                </button>
              ))}
            </div>
          )}

          {step === 'connecting' && (
            <div className="space-y-4 py-4">
              <div className="flex items-center justify-center mb-4">
                <div className="w-12 h-12 rounded-full border-2 border-t-transparent animate-spin" style={{ borderColor: 'var(--teal)', borderTopColor: 'transparent' }}/>
              </div>
              <p className="text-center text-[14px] font-medium" style={{ color: 'var(--text-primary)' }}>
                Connecting platforms...
              </p>
              <div className="space-y-2 mt-4">
                {Array.from(selected).map(id => {
                  const p = PLATFORMS.find(pp => pp.id === id)!;
                  const isConnected = connected.has(id);
                  const isConnecting = connecting === id;
                  const hasError = errors[id];
                  return (
                    <div key={id} className="flex items-center gap-3 px-4 py-2.5 rounded-lg" style={{ background: 'var(--surface-2)' }}>
                      <div className="shrink-0" style={{ color: p.color }}>{p.icon}</div>
                      <span className="text-[13px] flex-1" style={{ color: 'var(--text-muted)' }}>{p.name}</span>
                      {isConnected && <span className="text-[11px] px-2 py-0.5 rounded-full font-medium" style={{ background: 'rgba(16,185,129,0.15)', color: '#10b981' }}>Connected</span>}
                      {isConnecting && <div className="w-4 h-4 rounded-full border-2 border-t-transparent animate-spin" style={{ borderColor: p.color, borderTopColor: 'transparent' }}/>}
                      {hasError && <span className="text-[11px] px-2 py-0.5 rounded-full" style={{ background: 'rgba(239,68,68,0.15)', color: '#ef4444' }}>Failed</span>}
                      {!isConnected && !isConnecting && !hasError && <span className="text-[11px]" style={{ color: 'var(--text-ghost)' }}>Waiting...</span>}
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {step === 'done' && (
            <div className="py-6 text-center">
              <div className="w-16 h-16 rounded-full mx-auto mb-4 flex items-center justify-center" style={{ background: 'rgba(16,185,129,0.15)' }}>
                <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="#10b981" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M20 6L9 17l-5-5"/>
                </svg>
              </div>
              <h3 className="text-[16px] font-semibold mb-1" style={{ color: 'var(--text-primary)' }}>
                {connected.size > 0 ? 'Platforms Connected!' : 'Setup Complete'}
              </h3>
              <p className="text-[13px]" style={{ color: 'var(--text-ghost)' }}>
                {connected.size > 0
                  ? `${connected.size} platform${connected.size > 1 ? 's' : ''} connected. AI brains are ready to work.`
                  : 'You can connect platforms later from the Community tab.'}
              </p>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 pb-5 flex items-center gap-3" style={{ justifyContent: step === 'select' ? 'space-between' : 'flex-end' }}>
          {step === 'select' && (
            <>
              <button onClick={handleSkip} className="text-[12px] px-4 py-2 rounded-lg transition-colors"
                style={{ color: 'var(--text-ghost)' }}
                onMouseEnter={e => e.currentTarget.style.color = 'var(--text-muted)'}
                onMouseLeave={e => e.currentTarget.style.color = 'var(--text-ghost)'}>
                Skip for now
              </button>
              <button onClick={startConnecting}
                className="text-[13px] font-medium px-5 py-2.5 rounded-xl transition-all"
                style={{
                  background: selected.size > 0 ? 'var(--btn-primary-bg)' : 'var(--surface-4)',
                  color: selected.size > 0 ? 'var(--text-inverse)' : 'var(--text-ghost)',
                  cursor: selected.size > 0 ? 'pointer' : 'default',
                }}>
                {selected.size > 0 ? `Connect ${selected.size} Platform${selected.size > 1 ? 's' : ''}` : 'Select platforms'}
              </button>
            </>
          )}
          {step === 'done' && (
            <button onClick={handleDone}
              className="text-[13px] font-medium px-6 py-2.5 rounded-xl"
              style={{ background: 'var(--btn-primary-bg)', color: 'var(--btn-primary-fg)' }}>
              Continue
            </button>
          )}
        </div>
      </div>
    </div>,
    document.body
  );
}
