import { useEffect, useRef, useState } from 'react';
import { api } from '../lib/api';

/* ─────────────────────────────────────────────────────────────
   IA — Inventeur.
   L'IA émet [POPUP]{"type":"invention_preview","description":"…"}[/POPUP].
   Ce composant fait réfléchir l'IA à une invention puis affiche une carte :
   rendu design + concept + fiche technique + faisabilité + ébauche de brevet.
   - Recommencer  → l'utilisateur ajuste, on régénère (boucle CÔTÉ CLIENT)
   - Créer le site → renvoie un message au chat pour bâtir un site de présentation
   Appel direct à /invention-visualize (aucun aller-retour LLM depuis le chat).
   ───────────────────────────────────────────────────────────── */

interface Props {
  companyId: string;
  description: string;
  title?: string;
  message?: string;
  onRespond: (response: string) => void;
  onDismiss: () => void;
}

type Phase = 'loading' | 'ready' | 'refining' | 'error';

interface Invention {
  dataUrl: string;
  name: string;
  tagline: string;
  concept: string;
  techSheet: string;
  materials: string;
  feasibility: string;
  patent: string;
}

type Tab = 'concept' | 'tech' | 'patent';

export function InventionVisualizerPopup({ companyId, description, title, message, onRespond, onDismiss }: Props) {
  const [phase, setPhase] = useState<Phase>('loading');
  const [inv, setInv] = useState<Invention | null>(null);
  const [tab, setTab] = useState<Tab>('concept');
  const [refineText, setRefineText] = useState('');
  const [showRefine, setShowRefine] = useState(false);
  const [error, setError] = useState('');
  const startedRef = useRef(false);

  async function generate(refinePrompt?: string) {
    setPhase(refinePrompt ? 'refining' : 'loading');
    setError('');
    try {
      const res: any = await api.inventions.visualize(companyId, {
        description,
        ...(refinePrompt ? { refinePrompt } : {}),
      });
      if (res?.dataUrl || res?.concept) {
        setInv({
          dataUrl: res.dataUrl || '',
          name: res.name || 'Invention',
          tagline: res.tagline || '',
          concept: res.concept || '',
          techSheet: res.techSheet || '',
          materials: res.materials || '',
          feasibility: res.feasibility || '',
          patent: res.patent || '',
        });
        setPhase('ready');
        setShowRefine(false);
        setRefineText('');
        setTab('concept');
      } else {
        setError(res?.error || 'Invention generation failed.');
        setPhase('error');
      }
    } catch (e: any) {
      setError(e?.message || 'Network error.');
      setPhase('error');
    }
  }

  useEffect(() => {
    if (startedRef.current) return;
    startedRef.current = true;
    generate();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function buildSite() {
    if (!inv) return;
    onRespond(`[INVENTION VALIDATED] Build a presentation website for the invention "${inv.name}"${inv.tagline ? ` (${inv.tagline})` : ''}. Concept: ${inv.concept} Technical sheet: ${inv.techSheet} Materials: ${inv.materials} Feasibility: ${inv.feasibility}. Make a premium showcase site that clearly presents the invention, how it works and its benefits.`);
  }

  const busy = phase === 'loading' || phase === 'refining';

  return (
    <div
      className="mb-3 rounded-xl overflow-hidden question-popup-enter"
      style={{
        background: 'var(--surface-2)',
        border: '1px solid var(--teal-subtle-border)',
        boxShadow: '0 -4px 24px rgba(0,0,0,0.15)',
      }}
    >
      {/* Header */}
      <div className="px-4 py-2.5 flex items-center gap-2" style={{ borderBottom: '1px solid var(--border-subtle)' }}>
        <div className="w-5 h-5 rounded-md flex items-center justify-center shrink-0" style={{ background: 'var(--surface-4)' }}>
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="var(--text-secondary)" strokeWidth="2">
            <path d="M9 18h6" /><path d="M10 22h4" /><path d="M12 2a7 7 0 0 0-4 12.7c.6.5 1 1.3 1 2.1V17h6v-.2c0-.8.4-1.6 1-2.1A7 7 0 0 0 12 2z" />
          </svg>
        </div>
        <span className="text-[11px] font-semibold" style={{ color: 'var(--teal)' }}>
          AI — Inventor
        </span>
      </div>

      <div className="px-4 py-3">
        {title && <p className="text-[13px] font-semibold mb-1" style={{ color: 'var(--text-primary)' }}>{title}</p>}
        {message && <p className="text-[12px] leading-relaxed mb-2" style={{ color: 'var(--text-muted)' }}>{message}</p>}
        {phase !== 'ready' && (
          <p className="text-[11px] leading-relaxed mb-3" style={{ color: 'var(--text-dim)' }}>{description}</p>
        )}

        {/* Zone image */}
        <div
          className="rounded-lg overflow-hidden flex items-center justify-center"
          style={{ background: 'var(--surface-4)', minHeight: 200, border: '1px solid var(--border-subtle)' }}
        >
          {phase === 'loading' && (
            <div className="flex flex-col items-center gap-2 py-10">
              <Spinner />
              <span className="text-[11px]" style={{ color: 'var(--text-dim)' }}>AI is thinking about the invention…</span>
            </div>
          )}
          {phase === 'refining' && (
            <div className="flex flex-col items-center gap-2 py-10">
              <Spinner />
              <span className="text-[11px]" style={{ color: 'var(--text-dim)' }}>New version with your adjustments…</span>
            </div>
          )}
          {phase === 'error' && (
            <div className="flex flex-col items-center gap-2 py-10 px-4 text-center">
              <span className="text-[12px]" style={{ color: 'var(--red-text)' }}>{error}</span>
              <button onClick={() => generate()} className="h-8 px-4 rounded-lg text-[12px] font-medium" style={{ background: 'var(--surface-2)', color: 'var(--text-dim)', border: '1px solid var(--border-default)' }}>
                Retry
              </button>
            </div>
          )}
          {phase === 'ready' && inv?.dataUrl && (
            <img src={inv.dataUrl} alt="Invention rendering" className="w-full h-auto object-contain" style={{ maxHeight: 380 }} />
          )}
          {phase === 'ready' && !inv?.dataUrl && (
            <div className="py-10 px-4 text-center text-[11px]" style={{ color: 'var(--text-dim)' }}>Visual rendering unavailable — the concept below still stands.</div>
          )}
        </div>

        {/* Nom + tagline */}
        {phase === 'ready' && inv && (
          <div className="mt-3">
            <p className="text-[14px] font-semibold" style={{ color: 'var(--text-primary)' }}>{inv.name}</p>
            {inv.tagline && <p className="text-[12px] mt-0.5" style={{ color: 'var(--text-muted)' }}>{inv.tagline}</p>}

            {/* Onglets */}
            <div className="flex items-center gap-1 mt-3 mb-2">
              <TabBtn active={tab === 'concept'} onClick={() => setTab('concept')}>Concept</TabBtn>
              <TabBtn active={tab === 'tech'} onClick={() => setTab('tech')}>Tech sheet</TabBtn>
              <TabBtn active={tab === 'patent'} onClick={() => setTab('patent')}>Patent</TabBtn>
            </div>

            <div className="rounded-lg px-3 py-2.5 text-[12px] leading-relaxed" style={{ background: 'var(--surface-4)', border: '1px solid var(--border-subtle)', color: 'var(--text-muted)', maxHeight: 220, overflowY: 'auto' }}>
              {tab === 'concept' && (
                <div className="whitespace-pre-wrap">{inv.concept || '—'}</div>
              )}
              {tab === 'tech' && (
                <div className="space-y-2">
                  {inv.techSheet && <div className="whitespace-pre-wrap">{inv.techSheet}</div>}
                  {inv.materials && <Field label="Materials & components" value={inv.materials} />}
                  {inv.feasibility && <Field label="Feasibility" value={inv.feasibility} />}
                </div>
              )}
              {tab === 'patent' && (
                <div className="whitespace-pre-wrap">{inv.patent || '—'}</div>
              )}
            </div>
          </div>
        )}

        {/* Champ refine */}
        {showRefine && phase === 'ready' && (
          <div className="mt-3">
            <textarea
              value={refineText}
              onChange={(e) => setRefineText(e.target.value)}
              placeholder="What should change? (function, materials, shape, use…)"
              rows={2}
              className="w-full rounded-lg px-3 py-2 text-[12px] resize-none"
              style={{ background: 'var(--surface-4)', color: 'var(--text-primary)', border: '1px solid var(--border-default)', outline: 'none' }}
            />
          </div>
        )}
      </div>

      {/* Actions */}
      <div className="px-4 py-3 flex items-center gap-2 flex-wrap" style={{ borderTop: '1px solid var(--border-subtle)' }}>
        {phase === 'ready' && !showRefine && (
          <>
            <button onClick={buildSite} className="h-8 px-4 rounded-lg text-[12px] font-medium flex items-center gap-1.5" style={{ background: 'var(--btn-primary-bg)', color: 'var(--btn-primary-fg)' }}>
              <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="2"><path d="M2 6L5 9L10 3" /></svg>
              Create the showcase site
            </button>
            <button onClick={() => setShowRefine(true)} className="h-8 px-4 rounded-lg text-[12px] font-medium" style={{ background: 'var(--surface-4)', color: 'var(--text-dim)', border: '1px solid var(--border-default)' }}>
              Start over
            </button>
            <button onClick={onDismiss} className="h-8 px-3 rounded-lg text-[12px] font-medium ml-auto" style={{ background: 'transparent', color: 'var(--text-dim)' }}>
              Close
            </button>
          </>
        )}
        {phase === 'ready' && showRefine && (
          <>
            <button
              onClick={() => refineText.trim() && generate(refineText.trim())}
              disabled={!refineText.trim()}
              className="h-8 px-4 rounded-lg text-[12px] font-medium"
              style={{ background: 'var(--btn-primary-bg)', color: 'var(--btn-primary-fg)', opacity: refineText.trim() ? 1 : 0.5 }}
            >
              Regenerate
            </button>
            <button onClick={() => { setShowRefine(false); setRefineText(''); }} className="h-8 px-4 rounded-lg text-[12px] font-medium" style={{ background: 'var(--surface-4)', color: 'var(--text-dim)', border: '1px solid var(--border-default)' }}>
              Back
            </button>
          </>
        )}
        {busy && (
          <div className="flex items-center gap-2 py-1">
            <Spinner small />
            <span className="text-[11px]" style={{ color: 'var(--text-dim)' }}>Generating…</span>
          </div>
        )}
      </div>
    </div>
  );
}

function TabBtn({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      className="h-7 px-3 rounded-lg text-[11px] font-medium transition-colors"
      style={{
        background: active ? 'var(--btn-primary-bg)' : 'var(--surface-4)',
        color: active ? 'var(--btn-primary-fg)' : 'var(--text-dim)',
        border: active ? '1px solid var(--btn-primary-bg)' : '1px solid var(--border-default)',
      }}
    >
      {children}
    </button>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-[10px] uppercase tracking-wide mb-0.5" style={{ color: 'var(--text-dim)' }}>{label}</p>
      <p className="whitespace-pre-wrap" style={{ color: 'var(--text-muted)' }}>{value}</p>
    </div>
  );
}

function Spinner({ small }: { small?: boolean }) {
  const s = small ? 14 : 22;
  return (
    <svg width={s} height={s} viewBox="0 0 24 24" fill="none" style={{ animation: 'spin 0.8s linear infinite' }}>
      <circle cx="12" cy="12" r="9" stroke="var(--border-default)" strokeWidth="3" />
      <path d="M21 12a9 9 0 0 0-9-9" stroke="var(--teal)" strokeWidth="3" strokeLinecap="round" />
    </svg>
  );
}
