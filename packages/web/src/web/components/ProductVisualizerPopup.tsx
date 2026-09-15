import { useEffect, useRef, useState } from 'react';
import { api } from '../lib/api';

/* ─────────────────────────────────────────────────────────────
   IA — Visualiseur produit.
   L'IA émet [POPUP]{"type":"product_preview","description":"…"}[/POPUP].
   Ce composant génère une belle image produit HQ, l'affiche, puis :
   - Valider  → ajoute le produit au catalogue (produit + visuels multiples)
   - Start over → l'utilisateur réécrit un brief, on régénère (boucle CÔTÉ CLIENT)
   Aucun aller-retour LLM : appels directs aux endpoints /product-visualize.
   ───────────────────────────────────────────────────────────── */

interface Props {
  companyId: string;
  description: string;
  title?: string;
  message?: string;
  /** Notifie le chat du résultat final (message user de suivi). */
  onRespond: (response: string) => void;
  /** Ferme le pop-up sans rien envoyer. */
  onDismiss: () => void;
}

type Phase = 'loading' | 'ready' | 'refining' | 'approving' | 'error';

export function ProductVisualizerPopup({ companyId, description, title, message, onRespond, onDismiss }: Props) {
  const [phase, setPhase] = useState<Phase>('loading');
  const [dataUrl, setDataUrl] = useState<string>('');
  const [draftId, setDraftId] = useState<string>('');
  const [refineText, setRefineText] = useState('');
  const [showRefine, setShowRefine] = useState(false);
  const [error, setError] = useState('');
  const startedRef = useRef(false);

  async function generate(refinePrompt?: string) {
    setPhase(refinePrompt ? 'refining' : 'loading');
    setError('');
    try {
      const res: any = await api.products.visualize(companyId, {
        description,
        ...(refinePrompt ? { refinePrompt } : {}),
        ...(draftId ? { draftId } : {}),
      });
      if (res?.dataUrl) {
        setDataUrl(res.dataUrl);
        if (res.draftId) setDraftId(res.draftId);
        setPhase('ready');
        setShowRefine(false);
        setRefineText('');
      } else {
        setError(res?.error || "Image generation failed.");
        setPhase('error');
      }
    } catch (e: any) {
      setError(e?.message || 'Network error.');
      setPhase('error');
    }
  }

  // Génère le premier aperçu au montage.
  useEffect(() => {
    if (startedRef.current) return;
    startedRef.current = true;
    generate();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function approve() {
    if (!draftId) return;
    setPhase('approving');
    try {
      const res: any = await api.products.approveDraft(companyId, draftId);
      const name = res?.product?.name || 'le produit';
      onRespond(`[PRODUCT VALIDATED] The user approved "${name}" — it is added to the catalog and the visuals (angles + model shots) are being generated. Confirm briefly and propose the next step.`);
    } catch (e: any) {
      setError(e?.message || "Failed to add to catalogue.");
      setPhase('error');
    }
  }

  const busy = phase === 'loading' || phase === 'refining' || phase === 'approving';

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
            <rect x="3" y="3" width="18" height="18" rx="2" /><circle cx="8.5" cy="8.5" r="1.5" /><path d="M21 15l-5-5L5 21" />
          </svg>
        </div>
        <span className="text-[11px] font-semibold" style={{ color: 'var(--teal)' }}>
          AI — Product visualization
        </span>
      </div>

      <div className="px-4 py-3">
        {title && <p className="text-[13px] font-semibold mb-1" style={{ color: 'var(--text-primary)' }}>{title}</p>}
        {message && <p className="text-[12px] leading-relaxed mb-2" style={{ color: 'var(--text-muted)' }}>{message}</p>}
        <p className="text-[11px] leading-relaxed mb-3" style={{ color: 'var(--text-dim)' }}>{description}</p>

        {/* Zone image */}
        <div
          className="rounded-lg overflow-hidden flex items-center justify-center"
          style={{ background: 'var(--surface-4)', minHeight: 220, border: '1px solid var(--border-subtle)' }}
        >
          {phase === 'loading' && (
            <div className="flex flex-col items-center gap-2 py-10">
              <Spinner />
              <span className="text-[11px]" style={{ color: 'var(--text-dim)' }}>Creating a first preview…</span>
            </div>
          )}
          {phase === 'refining' && (
            <div className="flex flex-col items-center gap-2 py-10">
              <Spinner />
              <span className="text-[11px]" style={{ color: 'var(--text-dim)' }}>Regenerating with your adjustments…</span>
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
          {(phase === 'ready' || phase === 'approving') && dataUrl && (
            <img src={dataUrl} alt="Product preview" className="w-full h-auto object-contain" style={{ maxHeight: 420 }} />
          )}
        </div>

        {/* Champ refine */}
        {showRefine && phase === 'ready' && (
          <div className="mt-3">
            <textarea
              value={refineText}
              onChange={(e) => setRefineText(e.target.value)}
              placeholder="What should we change? (color, material, angle, mood…)"
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
            <button onClick={approve} className="h-8 px-4 rounded-lg text-[12px] font-medium flex items-center gap-1.5" style={{ background: 'var(--btn-primary-bg)', color: 'var(--btn-primary-fg)' }}>
              <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="2"><path d="M2 6L5 9L10 3" /></svg>
              Approve — add to catalogue
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
            <span className="text-[11px]" style={{ color: 'var(--text-dim)' }}>
              {phase === 'approving' ? 'Adding to catalogue…' : 'Generating…'}
            </span>
          </div>
        )}
      </div>
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
