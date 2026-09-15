// ─── Panneau visuel du run /test1 ────────────────────────────────────────────
// Rendu vivant du run agentique : la liste de tâches que l'agent a écrite
// lui-même, leur état (à faire / en cours / terminée + durée), le journal des
// notes, et l'horloge du run. Remplace l'ancien rendu en texte markdown brut
// (« - [ ] ⟳ … ») qui ressemblait à un log, pas à l'app.

export interface Test1TaskState {
  id: string;
  title: string;
  state: 'todo' | 'run' | 'done';
  ms?: number;
  result?: string;
}

export interface Test1RunState {
  category: string;
  startedAt: number;
  status: 'running' | 'done' | 'error';
  tasks: Test1TaskState[];
  notes: string[];
  brandName?: string;
  companyId?: string;
  previewUrl?: string;
}

function fmtMs(ms: number): string {
  const s = Math.round(ms / 1000);
  return s < 60 ? `${s} s` : `${Math.floor(s / 60)} min ${s % 60} s`;
}

function CheckIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
      <path d="M2.5 6.5L5 9L9.5 3.5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function Test1Panel({ run, now }: { run: Test1RunState; now: number }) {
  const elapsed = Math.max(0, Math.round((now - run.startedAt) / 1000));
  const doneCount = run.tasks.filter(t => t.state === 'done').length;

  return (
    <div
      className="rounded-2xl p-4 text-[13px] leading-relaxed"
      style={{
        background: 'var(--surface-1, rgba(255,255,255,0.04))',
        border: '1px solid var(--border, rgba(255,255,255,0.10))',
      }}
    >
      {/* En-tête : commande + horloge vivante */}
      <div className="flex items-center justify-between gap-3 mb-3">
        <div className="flex items-center gap-2 min-w-0">
          <span
            className="inline-flex items-center h-[22px] px-2 rounded-md text-[12px] font-semibold shrink-0"
            style={{ background: 'var(--surface-4, rgba(255,255,255,0.08))', color: 'var(--text-primary)' }}
          >
            /test1
          </span>
          <span className="font-medium truncate" style={{ color: 'var(--text-primary)' }}>
            {run.brandName || run.category}
          </span>
        </div>
        <span className="shrink-0 tabular-nums" style={{ color: 'var(--text-dim)' }}>
          {run.status === 'running' && <span className="animate-pulse mr-1.5">●</span>}
          {fmtMs(elapsed)}
        </span>
      </div>

      {/* Barre de progression du plan */}
      {run.tasks.length > 0 && (
        <div className="mb-3">
          <div className="flex items-center justify-between mb-1.5">
            <span style={{ color: 'var(--text-dim)' }}>Plan de l'agent</span>
            <span className="tabular-nums" style={{ color: 'var(--text-dim)' }}>
              {doneCount}/{run.tasks.length}
            </span>
          </div>
          <div className="h-1 rounded-full overflow-hidden" style={{ background: 'var(--surface-4, rgba(255,255,255,0.08))' }}>
            <div
              className="h-full rounded-full transition-all duration-500"
              style={{
                width: `${run.tasks.length ? Math.round((doneCount / run.tasks.length) * 100) : 0}%`,
                background: 'var(--accent, #7c5cff)',
              }}
            />
          </div>
        </div>
      )}

      {/* Tâches */}
      {run.tasks.length > 0 && (
        <div className="flex flex-col gap-1.5 mb-3">
          {run.tasks.map(t => (
            <div key={t.id} className="flex items-start gap-2.5">
              <span
                className={`mt-[3px] w-4 h-4 rounded-full flex items-center justify-center shrink-0 ${t.state === 'run' ? 'animate-pulse' : ''}`}
                style={{
                  background:
                    t.state === 'done'
                      ? 'var(--accent, #7c5cff)'
                      : t.state === 'run'
                        ? 'transparent'
                        : 'transparent',
                  border:
                    t.state === 'done'
                      ? 'none'
                      : `1.5px solid ${t.state === 'run' ? 'var(--accent, #7c5cff)' : 'var(--border, rgba(255,255,255,0.18))'}`,
                  color: '#fff',
                }}
              >
                {t.state === 'done' && <CheckIcon />}
                {t.state === 'run' && (
                  <span className="w-1.5 h-1.5 rounded-full" style={{ background: 'var(--accent, #7c5cff)' }} />
                )}
              </span>
              <div className="min-w-0 flex-1">
                <span
                  style={{
                    color: t.state === 'done' ? 'var(--text-secondary)' : 'var(--text-primary)',
                    opacity: t.state === 'todo' ? 0.65 : 1,
                  }}
                >
                  {t.title}
                </span>
                {t.state === 'done' && t.ms != null && (
                  <span className="tabular-nums" style={{ color: 'var(--text-dim)' }}> · {fmtMs(t.ms)}</span>
                )}
                {t.state === 'done' && t.result && (
                  <div className="text-[12px] truncate" style={{ color: 'var(--text-dim)' }} title={t.result}>
                    {t.result}
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Journal : les 6 dernières notes */}
      {run.notes.length > 0 && (
        <div className="flex flex-col gap-1 pt-2" style={{ borderTop: '1px solid var(--border, rgba(255,255,255,0.08))' }}>
          {run.notes.slice(-6).map((n, i) => (
            <div key={i} className="text-[12px] truncate" style={{ color: 'var(--text-dim)' }} title={n}>
              · {n}
            </div>
          ))}
        </div>
      )}

      {/* Lien vers le site livré */}
      {run.status === 'done' && run.companyId && (
        <a
          href={`/chat/${run.companyId}`}
          className="mt-3 inline-flex items-center gap-1.5 h-8 px-3 rounded-full text-[12.5px] font-medium transition-transform hover:-translate-y-px"
          style={{ background: 'var(--accent, #7c5cff)', color: '#fff' }}
        >
          Ouvrir le projet {run.brandName || ''} →
        </a>
      )}
    </div>
  );
}
