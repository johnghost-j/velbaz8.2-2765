import { useEffect, useRef, useState } from 'react';
import { api } from '../lib/api';

/* ─────────────────────────────────────────────────────────────
   IA — Aperçu de marque AVANT le build.
   Quand Velbaz s'apprête à construire une nouvelle entreprise, ce
   pop-up s'affiche au-dessus du prompt : il génère une proposition
   de marque (logo + palette + typo + tagline) que l'utilisateur peut
   VALIDER ou faire CHANGER (feedback → régénération, côté client).
   - Valider  → verrouille la marque en base, puis onApproved() lance le build.
   - Change  → l'utilisateur donne un retour, on régénère (boucle client).
   Aucun aller-retour LLM via le chat : appels directs /brand-preview.
   ───────────────────────────────────────────────────────────── */

interface BrandProduct {
  name: string;
  imageUrl: string; // URL du mockup RÉEL Printify (jamais une image IA)
}

interface BrandData {
  name: string;
  tagline: string;
  concept: string;
  palette: string[];
  fonts: { heading: string; body: string };
  logoDataUrl: string;
  businessType: 'clothing' | 'physical_product' | 'service_digital';
  products: BrandProduct[];
}

interface Props {
  companyId: string;
  title?: string;
  message?: string;
  /** true = l'utilisateur a EXPLICITEMENT demandé le logo dans la barre de
   *  prompt → on affiche le rectangle d'aperçu (logo + détails) à valider.
   *  false = phase marque automatique avant un build → AUCUN rectangle, AUCUN
   *  spinner : la marque est validée toute seule et le build démarre (sauf si
   *  de VRAIS produits Printify existent, auquel cas on montre le rectangle). */
  logoRequest?: boolean;
  /** Appelé après validation+verrouillage : lance réellement le build. */
  onApproved: () => void;
  /** Ferme le pop-up sans lancer le build. */
  onDismiss: () => void;
}

type Phase = 'loading' | 'ready' | 'refining' | 'approving' | 'error';

export function BrandPreviewPopup({ companyId, logoRequest = false, onApproved, onDismiss }: Props) {
  const [phase, setPhase] = useState<Phase>('loading');
  const [brand, setBrand] = useState<BrandData | null>(null);
  const [feedbackText, setFeedbackText] = useState('');
  const [showFeedback, setShowFeedback] = useState(false);
  const [error, setError] = useState('');
  const [closing, setClosing] = useState(false);
  const startedRef = useRef(false);
  const autoDoneRef = useRef(false);

  // Mode automatique (logoRequest = false) : rien ne doit s'afficher et le build
  // doit démarrer tout seul dès que la marque est prête — SAUF s'il y a de VRAIS
  // produits Printify, seul cas où le rectangle d'aperçu a un sens.
  function autoFinish(b: BrandData) {
    if (logoRequest || autoDoneRef.current) return false;
    if (b.products.length > 0) return false; // vrais produits → on montre le rectangle
    autoDoneRef.current = true;
    approve(b);
    return true;
  }

  // Étape 2 (séparée) : fabrique les VRAIS produits Printify. Ne bloque JAMAIS
  // l'affichage de la marque + du logo. Le rectangle "produit" ne charge que
  // pendant cet appel, et uniquement si un produit est réellement fabriqué.
  async function loadProducts() {
    // Fabrication SILENCIEUSE des vrais mockups Printify en arrière-plan.
    // Aucun rectangle de chargement : la vitrine n'apparaît QUE si de vrais
    // produits arrivent. S'il n'y a que le logo → rien ne s'affiche.
    try {
      const res: any = await Promise.race([
        api.brand.products(companyId),
        new Promise((_, reject) => setTimeout(() => reject(new Error('TIMEOUT')), 180000)),
      ]);
      const products = Array.isArray(res?.products) ? res.products.filter((p: any) => p?.imageUrl) : [];
      setBrand((prev) => {
        const next = prev ? { ...prev, products } : prev;
        if (next) autoFinish(next);
        return next;
      });
    } catch {
      // Échec/timeout produits → on n'affiche simplement aucun produit (logo seul).
      setBrand((prev) => {
        const next = prev ? { ...prev, products: [] } : prev;
        if (next) autoFinish(next);
        return next;
      });
    }
  }

  async function generate(feedback?: string) {
    setPhase(feedback ? 'refining' : 'loading');
    setError('');
    try {
      // Garde-fou : si la passerelle bloque, on ne reste jamais figé en chargement.
      const res: any = await Promise.race([
        api.brand.preview(companyId, feedback ? { feedback } : {}),
        new Promise((_, reject) => setTimeout(() => reject(new Error('TIMEOUT')), 150000)),
      ]);
      if (res?.logoDataUrl || (Array.isArray(res?.products) && res.products.length)) {
        const brandData: BrandData = {
          name: res.name || '',
          tagline: res.tagline || '',
          concept: res.concept || '',
          palette: Array.isArray(res.palette) ? res.palette : [],
          fonts: res.fonts || { heading: 'Inter', body: 'Inter' },
          logoDataUrl: res.logoDataUrl || '',
          businessType: res.businessType || 'physical_product',
          products: Array.isArray(res.products) ? res.products.filter((p: any) => p?.imageUrl) : [],
        };
        setBrand(brandData);
        // Cache la marque : au rechargement de la page, on la ré-affiche telle
        // quelle au lieu de tout regénérer (évite le « ça recommence »).
        try { localStorage.setItem(`velbaz_brand_data_${companyId}`, JSON.stringify(brandData)); } catch { /* quota/prive */ }
        setPhase('ready');
        setShowFeedback(false);
        setFeedbackText('');
        // La marque est affichée. Si des produits sont en attente de fabrication
        // (Printify branché), on les charge à part — le rectangle produit charge
        // alors sans figer tout le pop-up.
        const hasProducts = Array.isArray(res.products) && res.products.some((p: any) => p?.imageUrl);
        if (res?.productsPending && !hasProducts) loadProducts();
        // Mode automatique : pas de produits en vue → on valide et on construit
        // sans rien afficher. Si des produits sont en fabrication, la décision
        // est prise dans loadProducts() quand ils arrivent.
        else autoFinish(brandData);
      } else {
        setError(res?.error || 'Brand generation failed.');
        setPhase('error');
        failSoft();
      }
    } catch (e: any) {
      setError(
        e?.message === 'TIMEOUT'
          ? "Generation is taking too long (the AI gateway may be overloaded). Please try again."
          : (e?.message || 'Network error.'),
      );
      setPhase('error');
      failSoft();
    }
  }

  // Mode automatique : si la marque échoue, on ne bloque JAMAIS le build derrière
  // un message d'erreur — on lance la construction (le logo sera généré pendant
  // l'init, et l'étape apparaît dans la liste d'activité comme les autres).
  function failSoft() {
    if (logoRequest || autoDoneRef.current) return;
    autoDoneRef.current = true;
    onApproved();
  }

  useEffect(() => {
    if (startedRef.current) return;
    startedRef.current = true;
    // Au rechargement : si une marque a déjà été générée pour ce projet, on la
    // ré-affiche directement (pas de re-génération = plus de « ça recommence »).
    try {
      const cached = localStorage.getItem(`velbaz_brand_data_${companyId}`);
      if (cached) {
        const brandData = JSON.parse(cached) as BrandData;
        if (brandData?.logoDataUrl || (brandData?.products && brandData.products.length)) {
          brandData.products = Array.isArray(brandData.products) ? brandData.products : [];
          setBrand(brandData);
          setPhase('ready');
          autoFinish(brandData);
          return;
        }
      }
    } catch { /* cache illisible → génération normale */ }
    generate();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function approve(override?: BrandData) {
    const b = override || brand;
    if (!b) return;
    setPhase('approving');
    try {
      await api.brand.approve(companyId, {
        logoDataUrl: b.logoDataUrl,
        palette: b.palette,
        fonts: b.fonts,
        tagline: b.tagline,
      });
      try { localStorage.removeItem(`velbaz_brand_data_${companyId}`); } catch { /* ignore */ }
      onApproved();
    } catch (e: any) {
      setError(e?.message || 'Brand approval failed.');
      setPhase('error');
      // MODE AUTOMATIQUE : ce composant ne rend RIEN ici, donc l'erreur est
      // invisible et le build resterait bloqué en silence après le « C'est
      // parti, je lance tout ! ». Le verrouillage de la marque n'est qu'un
      // préalable : on lance la construction quand même (le logo est de toute
      // façon régénéré/enregistré pendant l'init).
      if (!logoRequest) onApproved();
    }
  }

  // Fermeture sans validation → on lance la suppression des produits Printify
  // temporaires (best-effort, non bloquant), on joue l'animation de sortie, puis
  // on ferme réellement. La fermeture ne dépend JAMAIS du réseau : même si le
  // discard échoue, le pop-up se ferme.
  function handleDismiss() {
    if (closing) return;
    try { api.brand.discard(companyId).catch(() => {}); } catch { /* jamais bloquant */ }
    try { localStorage.removeItem(`velbaz_brand_data_${companyId}`); } catch { /* ignore */ }
    setClosing(true);
    window.setTimeout(() => onDismiss(), 210); // durée de l'animation de sortie
  }

  const busy = phase === 'loading' || phase === 'refining' || phase === 'approving';

  // MODE AUTOMATIQUE (logoRequest = false) : AUCUN rendu, jamais — ni spinner,
  // ni texte, ni rectangle, quelle que soit la phase (loading / refining /
  // approving / error). La marque est validée en silence par autoFinish() ou
  // failSoft() ; la génération du logo se voit UNIQUEMENT comme ligne de tâche
  // dans la liste d'activité du chat. Seule exception : de VRAIS produits
  // Printify existent → le rectangle d'aperçu a un sens, on le montre.
  if (!logoRequest && !(brand && brand.products.length > 0)) return null;

  // Pendant la génération de la marque → PAS de gros rectangle. On affiche une
  // simple ligne de tâche (spinner + texte), comme les autres étapes. Le
  // rectangle est réservé à l'aperçu marque + PRODUITS une fois prêt.
  if (phase === 'loading' || phase === 'refining') {
    return (
      <div
        className={`mb-3 flex items-center gap-2.5 px-1 py-1 ${closing ? 'question-popup-exit' : 'question-popup-enter'}`}
      >
        <Spinner />
        <span className="text-[13px]" style={{ color: 'var(--text-dim)' }}>
          {phase === 'refining' ? 'Regenerating brand…' : 'Designing brand…'}
        </span>
      </div>
    );
  }

  return (
    <div
      className={`mb-3 rounded-xl w-full ${closing ? 'question-popup-exit' : 'question-popup-enter'}`}
      style={{
        background: 'var(--surface-4)',
        border: '1px solid var(--border-subtle)',
        maxHeight: '60vh',
        overflowY: 'auto',
      }}
    >
      <div className="p-4">
        {phase === 'error' && (
          <div className="flex flex-col items-center gap-2 py-10 px-4 text-center">
            <span className="text-[12px]" style={{ color: 'var(--red-text)' }}>{error}</span>
            <button onClick={() => generate()} className="h-8 px-4 rounded-lg text-[12px] font-medium" style={{ background: 'var(--surface-2)', color: 'var(--text-dim)', border: '1px solid var(--border-default)' }}>
              Retry
            </button>
          </div>
        )}

        {(phase === 'ready' || phase === 'approving') && brand && (
          <div className="flex flex-col gap-4">
            {/* En-tête : petit logo + nom */}
            <div className="flex items-center gap-3">
              <div
                className="w-10 h-10 rounded-lg overflow-hidden shrink-0 flex items-center justify-center"
                style={{ background: '#fff', border: '1px solid var(--border-subtle)' }}
              >
                {brand.logoDataUrl && (
                  <img src={brand.logoDataUrl} alt="Logo" className="max-w-full max-h-full object-contain" />
                )}
              </div>
              <div className="min-w-0">
                <p className="text-[15px] font-semibold truncate" style={{ color: 'var(--text-primary)', fontFamily: `'${brand.fonts.heading}', sans-serif` }}>
                  {brand.name}
                </p>
                {brand.tagline && (
                  <p className="text-[12px] truncate" style={{ color: 'var(--text-muted)', fontFamily: `'${brand.fonts.body}', sans-serif` }}>
                    {brand.tagline}
                  </p>
                )}
              </div>
            </div>

            {/* Vitrine PRODUITS */}
            {brand.products.length > 0 ? (
              <div>
                <p className="text-[11px] font-semibold mb-2 uppercase tracking-wide" style={{ color: 'var(--text-dim)' }}>
                  {brand.businessType === 'clothing'
                    ? (brand.products.length > 1 ? 'The collection' : 'The garment')
                    : (brand.products.length > 1 ? 'The products' : 'The product')}
                </p>
                <div
                  className="grid gap-2.5"
                  style={{ gridTemplateColumns: `repeat(${Math.min(brand.products.length, 2)}, minmax(0, 1fr))` }}
                >
                  {brand.products.map((p, i) => (
                    <div
                      key={i}
                      className="rounded-lg overflow-hidden flex flex-col"
                      style={{ background: '#fff', border: '1px solid var(--border-subtle)' }}
                    >
                      <div className="w-full" style={{ aspectRatio: '1 / 1' }}>
                        <img src={p.imageUrl} alt={p.name} className="w-full h-full object-cover" />
                      </div>
                      {p.name && (
                        <div className="px-2.5 py-1.5">
                          <p className="text-[12px] font-medium truncate" style={{ color: '#111' }}>{p.name}</p>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            ) : null}
            {/* AUCUN rectangle de chargement pour un logo seul. La fabrication des
               produits Printify se fait en arrière-plan, en silence : la vitrine
               n'apparaît QUE quand de VRAIS mockups Printify sont prêts. S'il n'y
               a que le logo → rien ne s'affiche ici. */}

            {/* Palette + Typo (compact) */}
            <div className="flex flex-wrap items-end gap-x-5 gap-y-2">
              {brand.palette.length > 0 && (
                <div className="flex items-center gap-1.5">
                  {brand.palette.map((c, i) => (
                    <div key={i} className="flex flex-col items-center gap-1">
                      <div className="w-7 h-7 rounded-md" style={{ background: c, border: '1px solid var(--border-subtle)' }} />
                      <span className="text-[8px] uppercase tracking-wide" style={{ color: 'var(--text-dim)' }}>{c}</span>
                    </div>
                  ))}
                </div>
              )}
              <div className="flex items-center gap-4 text-[11px] pb-1" style={{ color: 'var(--text-dim)' }}>
                <span>Heading: <span style={{ color: 'var(--text-muted)' }}>{brand.fonts.heading}</span></span>
                <span>Body: <span style={{ color: 'var(--text-muted)' }}>{brand.fonts.body}</span></span>
              </div>
            </div>
          </div>
        )}

        {/* Champ feedback */}
        {showFeedback && phase === 'ready' && (
          <div className="mt-3">
            <textarea
              value={feedbackText}
              onChange={(e) => setFeedbackText(e.target.value)}
              placeholder="What should we change? (colors, logo style, name, vibe…)"
              rows={2}
              className="w-full rounded-lg px-3 py-2 text-[12px] resize-none"
              style={{ background: 'var(--surface-2)', color: 'var(--text-primary)', border: '1px solid var(--border-default)', outline: 'none' }}
            />
          </div>
        )}

        {/* Actions */}
        {phase === 'ready' && !showFeedback && (
          <div className="mt-3 flex items-center gap-2 flex-wrap">
            <button onClick={() => approve()} className="h-8 px-4 rounded-lg text-[12px] font-medium flex items-center gap-1.5" style={{ background: 'var(--btn-primary-bg)', color: 'var(--btn-primary-fg)' }}>
              <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="2"><path d="M2 6L5 9L10 3" /></svg>
              Approve brand — start building
            </button>
            <button onClick={() => setShowFeedback(true)} className="h-8 px-4 rounded-lg text-[12px] font-medium" style={{ background: 'var(--surface-2)', color: 'var(--text-dim)', border: '1px solid var(--border-default)' }}>
              Change
            </button>
            <button onClick={handleDismiss} className="h-8 px-3 rounded-lg text-[12px] font-medium ml-auto" style={{ background: 'transparent', color: 'var(--text-dim)' }}>
              Close
            </button>
          </div>
        )}
        {phase === 'ready' && showFeedback && (
          <div className="mt-3 flex items-center gap-2 flex-wrap">
            <button
              onClick={() => feedbackText.trim() && generate(feedbackText.trim())}
              disabled={!feedbackText.trim()}
              className="h-8 px-4 rounded-lg text-[12px] font-medium"
              style={{ background: 'var(--btn-primary-bg)', color: 'var(--btn-primary-fg)', opacity: feedbackText.trim() ? 1 : 0.5 }}
            >
              Regenerate
            </button>
            <button onClick={() => { setShowFeedback(false); setFeedbackText(''); }} className="h-8 px-4 rounded-lg text-[12px] font-medium" style={{ background: 'var(--surface-2)', color: 'var(--text-dim)', border: '1px solid var(--border-default)' }}>
              Back
            </button>
          </div>
        )}
        {(phase === 'approving' || (busy && phase !== 'loading' && phase !== 'refining')) && (
          <div className="mt-3 flex items-center gap-2 py-1">
            <Spinner small />
            <span className="text-[11px]" style={{ color: 'var(--text-dim)' }}>
              {phase === 'approving' ? 'Locking brand…' : 'Generating…'}
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
