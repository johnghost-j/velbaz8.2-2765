import { useEffect, useRef, useState, useCallback } from 'react';
import { PublishModal } from './PublishModal';
import { getAuthToken } from '../lib/token';

type BuildStatus = {
  status: 'none' | 'running' | 'completed' | 'failed';
  step?: string;
  logs?: string[];
  previewUrl?: string;
  fileCount?: number;
  error?: string;
};

type ProjectFile = { path: string; type: string; content: string };
type ChatMsg = { role: 'user' | 'assistant'; text: string };

type Task = { label: string; state: 'active' | 'done' | 'warn' | 'error' };

// Turn the REAL backend progress stream into live task items.
// Each push from the generator is a genuine step (plan, design, each component,
// each page by name, routing, install, build, preview). The most recent one is
// still running (active); everything before it is finished. State is derived
// from the message itself — nothing is pre-written or hardcoded.
function toTasks(logs?: string[]): Task[] {
  if (!logs || logs.length === 0) return [{ label: 'Starting…', state: 'active' }];
  return logs.map((raw, i) => {
    const last = i === logs.length - 1;
    const s = raw.trim();
    let state: Task['state'] = last ? 'active' : 'done';
    if (/^(✗|❌)/.test(s)) state = 'error';
    else if (/^(⚠️|⚠)/.test(s)) state = 'warn';
    else if (s.startsWith('✅') && !last) state = 'done';
    // Strip leading status emoji so the label reads like a clean task line.
    const label = s.replace(/^(✅|✗|❌|⚠️|⚠)\s*/, '').trim() || s;
    return { label, state };
  });
}

function authHeaders(json = false): Record<string, string> {
  const token = getAuthToken();
  const h: Record<string, string> = { Authorization: `Bearer ${token}` };
  if (json) h['Content-Type'] = 'application/json';
  return h;
}

export function AppBuilderTab({ companyId, companyName }: { companyId: string; companyName: string }) {
  const [status, setStatus] = useState<BuildStatus>({ status: 'none' });
  const [message, setMessage] = useState('');
  const [chat, setChat] = useState<ChatMsg[]>([]);
  const [files, setFiles] = useState<ProjectFile[]>([]);
  const [activeFile, setActiveFile] = useState<string | null>(null);
  const [view, setView] = useState<'preview' | 'code'>('preview');
  const [iframeKey, setIframeKey] = useState(0);
  const [publishOpen, setPublishOpen] = useState(false);
  const publishBtnRef = useRef<HTMLButtonElement | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const logsEndRef = useRef<HTMLDivElement>(null);
  const chatEndRef = useRef<HTMLDivElement>(null);

  const previewUrl = `/api/companies/${companyId}/preview/`;
  const isBusy = status.status === 'running';
  const hasApp = files.length > 0;

  const loadFiles = useCallback(async () => {
    try {
      const res = await fetch(`/api/companies/${companyId}/files`, { headers: authHeaders() });
      const data = await res.json();
      if (data.files) {
        setFiles(data.files);
        setActiveFile((prev) => prev || (data.files[0]?.path ?? null));
      }
    } catch { /* ignore */ }
  }, [companyId]);

  const loadStatus = useCallback(async () => {
    try {
      const res = await fetch(`/api/companies/${companyId}/build-status`, { headers: authHeaders() });
      const data: BuildStatus = await res.json();
      setStatus(data);
      if (data.status === 'completed' || data.status === 'failed') {
        if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }
        if (data.status === 'completed') {
          loadFiles();
          setIframeKey((k) => k + 1);
          const last = data.logs?.[data.logs.length - 1] || 'Done.';
          setChat((c) => [...c, { role: 'assistant', text: last.replace(/^✅\s*/, '') }]);
        } else {
          setChat((c) => [...c, { role: 'assistant', text: `⚠️ ${data.error || 'Failed'}` }]);
        }
      }
    } catch { /* ignore */ }
  }, [companyId, loadFiles]);

  useEffect(() => { loadStatus(); loadFiles(); /* eslint-disable-next-line */ }, [companyId]);
  useEffect(() => { logsEndRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [status.logs]);
  useEffect(() => { chatEndRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [chat, isBusy]);
  useEffect(() => () => { if (pollRef.current) clearInterval(pollRef.current); }, []);

  const startPolling = () => {
    if (pollRef.current) clearInterval(pollRef.current);
    pollRef.current = setInterval(loadStatus, 1500);
  };

  const send = async () => {
    const text = message.trim();
    if (!text || isBusy) return;
    setChat((c) => [...c, { role: 'user', text }]);
    setMessage('');
    const endpoint = hasApp ? 'edit-app' : 'build-app';
    setStatus({ status: 'running', step: hasApp ? 'Analyzing…' : 'Starting…', logs: [] });
    await fetch(`/api/companies/${companyId}/${endpoint}`, {
      method: 'POST',
      headers: authHeaders(true),
      body: JSON.stringify({ message: text }),
    });
    startPolling();
  };

  const activeFileContent = files.find((f) => f.path === activeFile)?.content || '';

  return (
    <div className="flex gap-4" style={{ height: 680 }}>
      {/* ─── Chat panel ─── */}
      <div className="w-[360px] shrink-0 flex flex-col rounded-xl overflow-hidden"
        style={{ background: 'var(--surface-1)', border: '1px solid var(--border-default)' }}>
        <div className="px-4 py-3 flex items-center gap-2" style={{ borderBottom: '1px solid var(--border-default)' }}>
          <span className="text-[13px] font-semibold" style={{ color: 'var(--text-primary)' }}>⚡ App Builder</span>
          {hasApp && <span className="text-[10px] px-2 py-0.5 rounded-full" style={{ background: 'var(--surface-3)', color: 'var(--text-dim)' }}>edit mode</span>}
        </div>

        {/* Messages */}
        <div className="flex-1 overflow-y-auto p-3 space-y-3">
          {chat.length === 0 && !isBusy && (
            <div className="text-[12px] leading-relaxed" style={{ color: 'var(--text-dim)' }}>
              {hasApp
                ? 'Tell me what to change — e.g. "add a profile page", "add dark mode", "change the color to green".'
                : `Describe the app to build for ${companyName}. E.g. "a company like lovable.com".`}
            </div>
          )}
          {chat.map((m, i) => (
            <div key={i} className={m.role === 'user' ? 'flex justify-end' : 'flex justify-start'}>
              <div className="text-[12px] px-3 py-2 rounded-lg max-w-[85%] leading-relaxed"
                style={m.role === 'user'
                  ? { background: 'var(--accent-primary)', color: '#fff' }
                  : { background: 'var(--surface-3)', color: 'var(--text-primary)' }}>
                {m.text}
              </div>
            </div>
          ))}
          {isBusy && (
            <div className="flex justify-start w-full">
              <div className="text-[11px] px-3 py-2.5 rounded-lg w-full" style={{ background: 'var(--surface-2)' }}>
                <div className="flex items-center gap-2 mb-2.5">
                  <span className="inline-block w-1.5 h-1.5 rounded-full animate-pulse" style={{ background: 'var(--teal)' }} />
                  <span className="text-[11px] font-semibold" style={{ color: 'var(--text-secondary)' }}>
                    {hasApp ? 'Applying changes' : "Building the app"}
                  </span>
                </div>
                <div className="max-h-[280px] overflow-y-auto space-y-1.5 pr-1">
                  {toTasks(status.logs).map((t, i) => (
                    <div key={i} className="flex items-start gap-2 text-[11px] leading-snug">
                      <span className="mt-[1px] shrink-0 w-3.5 text-center">
                        {t.state === 'active' && (
                          <span className="inline-block w-3 h-3 rounded-full border-2 animate-spin align-middle"
                            style={{ borderColor: 'var(--teal)', borderTopColor: 'transparent' }} />
                        )}
                        {t.state === 'done' && <span style={{ color: 'var(--teal)' }}>✓</span>}
                        {t.state === 'warn' && <span style={{ color: '#f59e0b' }}>!</span>}
                        {t.state === 'error' && <span style={{ color: '#ef4444' }}>✕</span>}
                      </span>
                      <span style={{
                        color: t.state === 'active' ? 'var(--text-primary)'
                          : t.state === 'error' ? '#ef4444'
                          : t.state === 'warn' ? '#f59e0b'
                          : 'var(--text-dim)',
                        fontWeight: t.state === 'active' ? 500 : 400,
                      }}>
                        {t.label}
                      </span>
                    </div>
                  ))}
                  <div ref={logsEndRef} />
                </div>
              </div>
            </div>
          )}
          <div ref={chatEndRef} />
        </div>

        {/* Input */}
        <div className="p-3" style={{ borderTop: '1px solid var(--border-default)' }}>
          <div className="flex items-end gap-2">
            <textarea
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } }}
              rows={2}
              placeholder={hasApp ? 'Describe your change…' : 'Describe your app…'}
              className="flex-1 text-[12px] px-3 py-2 rounded-lg outline-none resize-none"
              style={{ background: 'var(--surface-2)', color: 'var(--text-primary)', border: '1px solid var(--border-default)' }}
            />
            <button onClick={send} disabled={isBusy || !message.trim()}
              className="text-[12px] font-semibold px-3 py-2 rounded-lg shrink-0"
              style={{ background: isBusy ? 'var(--surface-3)' : 'var(--accent-primary)', color: '#fff', opacity: isBusy || !message.trim() ? 0.5 : 1 }}>
              {isBusy ? '…' : hasApp ? '✏️' : '⚡'}
            </button>
          </div>
        </div>
      </div>

      {/* ─── Preview / Code panel ─── */}
      <div className="flex-1 flex flex-col min-w-0">
        <div className="flex items-center gap-1 mb-3">
          {(['preview', 'code'] as const).map((v) => (
            <button key={v} onClick={() => setView(v)}
              className="text-[11px] px-3 py-1.5 rounded-md transition-colors"
              style={view === v
                ? { background: 'var(--surface-3)', color: 'var(--text-primary)', border: '1px solid var(--border-default)' }
                : { color: 'var(--text-dim)' }}>
              {v === 'preview' ? '👁 Preview' : `📄 Code (${files.length})`}
            </button>
          ))}
          {view === 'preview' && hasApp && (
            <>
              <button onClick={() => setIframeKey((k) => k + 1)}
                className="text-[11px] px-2 py-1.5 rounded-md ml-1" style={{ color: 'var(--text-dim)' }}>↻</button>
              <button type="button" onClick={() => window.open(previewUrl, '_blank', 'noopener,noreferrer')}
                className="text-[11px] px-3 py-1.5 rounded-md ml-auto" style={{ background: 'var(--btn-primary-bg)', color: 'var(--btn-primary-fg)', border: 'none', cursor: 'pointer' }}>Open ↗</button>
              <button ref={publishBtnRef} onClick={() => setPublishOpen(true)}
                className="text-[11px] font-semibold px-3 py-1.5 rounded-md" style={{ background: '#fff', color: '#111' }}>↑ Publish</button>
            </>
          )}
        </div>
        {publishOpen && <PublishModal companyId={companyId} onClose={() => setPublishOpen(false)} anchorRef={publishBtnRef} />}

        {!hasApp && !isBusy && (
          <div className="flex-1 rounded-xl flex flex-col items-center justify-center text-center p-10"
            style={{ background: 'var(--surface-1)', border: '1px dashed var(--border-default)' }}>
            <div className="text-[32px] mb-2">⚡</div>
            <div className="text-[15px] font-semibold mb-1" style={{ color: 'var(--text-primary)' }}>Full-stack app generator</div>
            <div className="text-[12px] max-w-[420px]" style={{ color: 'var(--text-dim)' }}>
              Real React + Vite + Hono app: backend, database, auth, dark/light, embedded AI and Stripe Checkout. Describe your idea in the chat to start generating.
            </div>
          </div>
        )}

        {(hasApp || isBusy) && view === 'preview' && (
          <div className="flex-1 rounded-xl overflow-hidden" style={{ border: '1px solid var(--border-default)', background: '#fff' }}>
            {hasApp ? (
              <iframe key={iframeKey} src={previewUrl} className="w-full h-full" style={{ border: 'none' }} title={`${companyName} app preview`} />
            ) : (
              <div className="w-full h-full flex items-center justify-center text-[13px]" style={{ color: 'var(--text-dim)' }}>
                Generating…
              </div>
            )}
          </div>
        )}

        {view === 'code' && (
          <div className="flex-1 flex gap-3 min-h-0">
            <div className="w-[220px] shrink-0 overflow-y-auto rounded-xl p-2" style={{ background: 'var(--surface-1)', border: '1px solid var(--border-default)' }}>
              {files.map((f) => (
                <button key={f.path} onClick={() => setActiveFile(f.path)}
                  className="w-full text-left text-[11px] px-2 py-1.5 rounded-md truncate transition-colors"
                  style={activeFile === f.path ? { background: 'var(--surface-3)', color: 'var(--text-primary)' } : { color: 'var(--text-dim)' }}
                  title={f.path}>
                  {f.path}
                </button>
              ))}
            </div>
            <div className="flex-1 overflow-auto rounded-xl p-3 min-w-0" style={{ background: 'var(--surface-0)', border: '1px solid var(--border-default)' }}>
              <pre className="font-mono text-[11px] leading-relaxed whitespace-pre-wrap" style={{ color: 'var(--text-secondary)' }}>
                {activeFileContent}
              </pre>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
