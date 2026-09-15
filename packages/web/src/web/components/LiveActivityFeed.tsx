import { useEffect, useRef, useState, useMemo, useCallback } from 'react';
import { getAuthToken } from '../lib/token';

// ─────────────────────────────────────────────────────────────────────────────
// LiveActivityFeed — panneau temps réel de TOUT ce que l'IA fait.
// - Se connecte au flux SSE /api/companies/:id/activity/stream
// - Section "EN COURS" : les actions que l'IA exécute maintenant (spinner)
// - Section "HISTORY" : tout ce qui a été fait, horodaté
// - Statuts détectables SANS couleur : mots [IN PROGRESS]/[DONE]/[ERROR] + symboles ▶ ✓ ✗
// ─────────────────────────────────────────────────────────────────────────────

export type LiveActivity = {
  id: string;
  agentRole: string;
  action: string;
  message: string;
  metadata?: string | null;
  createdAt: string | number | null;
};

/** Message d'équipe inter-agents ? → renvoie "Émetteur → Destinataire" pour l'afficher. */
function teamRoute(a: LiveActivity): string | null {
  if (!a.metadata) return null;
  try {
    const m = JSON.parse(a.metadata);
    if (m?.team && m.from && m.to) return `${m.from} → ${m.to}`;
  } catch { /* metadata non-JSON */ }
  return null;
}

const ROLE_LABELS: Record<string, string> = {
  ceo: 'Direction',
  engineering: 'Engineering',
  design: 'Design',
  marketing: 'Marketing',
  supply_chain: 'Logistique',
  finance: 'Finance',
  sales: 'Ventes',
  support: 'Support',
  legal: 'Juridique',
  hr: 'RH',
};

function roleLabel(role: string) {
  return ROLE_LABELS[role] || role.charAt(0).toUpperCase() + role.slice(1);
}

function timeLabel(createdAt: string | number | null): string {
  if (!createdAt) return '';
  const d = typeof createdAt === 'number' ? new Date(createdAt * (createdAt < 1e12 ? 1000 : 1)) : new Date(createdAt);
  if (isNaN(d.getTime())) return '';
  return d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

function statusOf(a: LiveActivity): 'running' | 'done' | 'error' {
  if (a.action === 'error' || /^✗|erreur|échec|failed/i.test(a.message)) return 'error';
  if (a.action === 'executing' || a.action === 'spawned') return 'running';
  return 'done';
}

function cleanMessage(msg: string): string {
  // Retire les tags internes [IMG:...] et les emojis de tête redondants avec le statut
  return msg.replace(/\[IMG:[^\]]+\]/g, '').replace(/^([✅✓✗⚠️]|🎨|📐|📸|🏭|🚚|⚙️|🌐|🚀|📦|💼|🧠|🔍|✍️|🖼️|📝|🧪|🔧)\s*/u, '').trim();
}

export default function LiveActivityFeed({ companyId, aiWorking }: { companyId: string; aiWorking?: boolean }) {
  const [items, setItems] = useState<LiveActivity[]>([]);
  const [open, setOpen] = useState(false);
  const [connected, setConnected] = useState(false);
  const [unseen, setUnseen] = useState(0);
  const esRef = useRef<EventSource | null>(null);
  const listRef = useRef<HTMLDivElement | null>(null);
  const openRef = useRef(open);
  openRef.current = open;

  const upsert = useCallback((a: LiveActivity) => {
    setItems(prev => {
      const idx = prev.findIndex(p => p.id === a.id);
      if (idx >= 0) {
        const next = [...prev];
        next[idx] = a;
        return next;
      }
      const next = [...prev, a];
      return next.length > 300 ? next.slice(next.length - 300) : next;
    });
    if (!openRef.current) setUnseen(n => n + 1);
  }, []);

  useEffect(() => {
    if (!companyId) return;
    let stopped = false;
    let retryTimer: ReturnType<typeof setTimeout> | null = null;

    const connect = () => {
      if (stopped) return;
      const token = getAuthToken() || '';
      const es = new EventSource(`/api/companies/${companyId}/activity/stream?token=${encodeURIComponent(token)}`);
      esRef.current = es;

      es.addEventListener('backfill', (e: MessageEvent) => {
        try {
          const arr: LiveActivity[] = JSON.parse(e.data);
          setItems(arr.slice(-300));
          setUnseen(0);
          setConnected(true);
        } catch {}
      });
      es.addEventListener('activity', (e: MessageEvent) => {
        try { upsert(JSON.parse(e.data)); } catch {}
      });
      es.addEventListener('update', (e: MessageEvent) => {
        try { upsert(JSON.parse(e.data)); } catch {}
      });
      es.addEventListener('ping', () => setConnected(true));
      es.onopen = () => setConnected(true);
      es.onerror = () => {
        setConnected(false);
        es.close();
        if (!stopped) retryTimer = setTimeout(connect, 3000);
      };
    };

    connect();
    return () => {
      stopped = true;
      if (retryTimer) clearTimeout(retryTimer);
      esRef.current?.close();
      esRef.current = null;
      setItems([]);
      setConnected(false);
    };
  }, [companyId, upsert]);

  // Auto-scroll en bas quand de nouvelles entrées arrivent et que le panneau est ouvert
  useEffect(() => {
    if (open && listRef.current) listRef.current.scrollTop = listRef.current.scrollHeight;
  }, [items, open]);

  useEffect(() => { if (open) setUnseen(0); }, [open]);

  // "En cours" = entrées executing des 20 dernières minutes non suivies d'une
  // entrée terminée avec le même texte nettoyé.
  const { running, history } = useMemo(() => {
    const doneTexts = new Set(
      items.filter(a => statusOf(a) !== 'running').map(a => cleanMessage(a.message).replace(/^✓\s*/, ''))
    );
    const now = Date.now();
    const running: LiveActivity[] = [];
    const history: LiveActivity[] = [];
    for (const a of items) {
      if (statusOf(a) === 'running') {
        const txt = cleanMessage(a.message);
        const ts = a.createdAt ? new Date(typeof a.createdAt === 'number' ? a.createdAt * (a.createdAt < 1e12 ? 1000 : 1) : a.createdAt).getTime() : 0;
        const fresh = ts === 0 || now - ts < 20 * 60 * 1000;
        if (fresh && !doneTexts.has(txt)) { running.push(a); continue; }
      }
      history.push(a);
    }
    return { running: running.slice(-6), history };
  }, [items]);

  const isActive = running.length > 0 || !!aiWorking;

  // Auto-ouverture quand l'IA commence à travailler
  const prevActiveRef = useRef(false);
  useEffect(() => {
    if (isActive && !prevActiveRef.current) setOpen(true);
    prevActiveRef.current = isActive;
  }, [isActive]);

  if (!companyId) return null;

  return (
    <div className="fixed bottom-4 right-4 z-[60] flex flex-col items-end" style={{ maxWidth: 'min(420px, calc(100vw - 24px))' }}>
      {open && (
        <div
          className="mb-2 w-[400px] max-w-full rounded-2xl overflow-hidden shadow-2xl flex flex-col"
          style={{ background: 'var(--surface-2, #111318)', border: '1px solid var(--border-default, #2a2d35)', maxHeight: '60vh' }}
        >
          {/* Header */}
          <div className="flex items-center justify-between px-4 py-2.5" style={{ borderBottom: '1px solid var(--border-default, #2a2d35)' }}>
            <div className="flex items-center gap-2">
              <span className="text-[13px] font-semibold" style={{ color: 'var(--text-secondary, #d7dae0)' }}>
                Live AI Activity
              </span>
              <span className="text-[10px] px-1.5 py-0.5 rounded font-mono" style={{ background: 'var(--surface-4, #22252d)', color: 'var(--text-dim, #8a8f9a)' }}>
                {connected ? 'CONNECTED' : 'RECONNECTING…'}
              </span>
            </div>
            <button
              onClick={() => setOpen(false)}
              aria-label="Collapse activity panel"
              className="w-6 h-6 flex items-center justify-center rounded hover:opacity-80"
              style={{ color: 'var(--text-dim, #8a8f9a)' }}
            >
              <svg width="12" height="12" viewBox="0 0 10 10" fill="none"><path d="M1 3l4 4 4-4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg>
            </button>
          </div>

          {/* EN COURS */}
          <div className="px-4 pt-3 pb-2" style={{ borderBottom: running.length > 0 ? '1px solid var(--border-default, #2a2d35)' : 'none' }}>
            <div className="text-[10px] font-bold tracking-wider mb-1.5" style={{ color: 'var(--text-dim, #8a8f9a)' }}>
              ▶ IN PROGRESS {running.length > 0 ? `(${running.length})` : ''}
            </div>
            {running.length === 0 ? (
              <div className="text-[12px] pb-1" style={{ color: 'var(--text-dim, #8a8f9a)' }}>
                {aiWorking ? 'The AI is working — waiting for the next detail…' : 'No tasks in progress right now.'}
              </div>
            ) : (
              <div className="flex flex-col gap-1.5 pb-1">
                {running.map(a => (
                  <div key={a.id} className="flex items-start gap-2">
                    <span className="mt-[3px] inline-block w-3 h-3 rounded-full border-2 animate-spin flex-shrink-0" style={{ borderColor: 'var(--text-dim, #8a8f9a)', borderTopColor: 'transparent' }} />
                    <div className="min-w-0">
                      <div className="text-[12px] leading-snug break-words" style={{ color: 'var(--text-secondary, #d7dae0)' }}>{cleanMessage(a.message)}</div>
                      <div className="text-[10px] font-mono" style={{ color: 'var(--text-dim, #8a8f9a)' }}>[IN PROGRESS] {teamRoute(a) || roleLabel(a.agentRole)} · {timeLabel(a.createdAt)}</div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* HISTORY */}
          <div ref={listRef} className="px-4 py-2 overflow-y-auto flex-1" style={{ minHeight: 80 }}>
            <div className="text-[10px] font-bold tracking-wider mb-1.5 sticky top-0" style={{ color: 'var(--text-dim, #8a8f9a)', background: 'var(--surface-2, #111318)' }}>
              HISTORY ({history.length})
            </div>
            {history.length === 0 ? (
              <div className="text-[12px]" style={{ color: 'var(--text-dim, #8a8f9a)' }}>Nothing yet — everything the AI does will appear here.</div>
            ) : (
              <div className="flex flex-col gap-1">
                {history.map(a => {
                  const st = statusOf(a);
                  const symbol = st === 'error' ? '✗' : st === 'running' ? '▶' : '✓';
                  const word = st === 'error' ? 'ERROR' : st === 'running' ? 'STARTED' : 'DONE';
                  return (
                    <div key={a.id} className="flex items-start gap-2 py-0.5">
                      <span className="text-[12px] font-bold flex-shrink-0 w-3 text-center" aria-hidden style={{ color: 'var(--text-muted, #b3b8c2)' }}>{symbol}</span>
                      <div className="min-w-0">
                        <div className="text-[12px] leading-snug break-words" style={{ color: 'var(--text-muted, #b3b8c2)' }}>{cleanMessage(a.message)}</div>
                        <div className="text-[10px] font-mono" style={{ color: 'var(--text-dim, #8a8f9a)' }}>[{word}] {roleLabel(a.agentRole)} · {timeLabel(a.createdAt)}</div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Bouton flottant */}
      <button
        onClick={() => setOpen(o => !o)}
        aria-label={open ? "Collapse AI activity" : "View live AI activity"}
        className="flex items-center gap-2 px-3.5 h-9 rounded-full shadow-lg text-[12px] font-medium hover:opacity-90 transition-opacity"
        style={{ background: 'var(--surface-3, #1a1d24)', border: '1px solid var(--border-default, #2a2d35)', color: 'var(--text-secondary, #d7dae0)' }}
      >
        {isActive ? (
          <span className="inline-block w-3 h-3 rounded-full border-2 animate-spin" style={{ borderColor: 'currentColor', borderTopColor: 'transparent' }} />
        ) : (
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none"><path d="M22 12h-4l-3 9L9 3l-3 9H2" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/></svg>
        )}
        <span>{isActive ? 'AI working…' : 'AI Activity'}</span>
        {!open && unseen > 0 && (
          <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full" style={{ background: 'var(--blue-accent, #3b82f6)', color: '#fff' }}>
            +{unseen}
          </span>
        )}
      </button>
    </div>
  );
}
