import { useEffect, useLayoutEffect, useRef, useState, useCallback } from 'react';
import { useLocation } from 'wouter';
import { getAuthToken } from '../lib/token';

// ─── "Publish your website" ──────────────────────────────────────────────────
// Popup fidèle au design Runable : sous-domaine éditable (disponibilité vérifiée
// en direct), "More Settings" qui déplie Availability + Visibility AVEC
// animation, lien "Add custom domain" qui ouvre la vraie page Domains du
// projet, puis lien live après publication.
// Backend réel : /api/companies/:id/publish… (débit des crédits d'hébergement
// au moment de publier).

type PublishState = {
  published: boolean;
  publishedAt?: number | null;
  subdomain: string | null;
  subdomainDisplay: string | null;
  liveUrl: string | null;
  availabilityMode: 'wake' | 'always';
  visibility: 'public' | 'private';
  customDomain: string | null;
  deployConfigured: boolean;
  hostingCost?: { wake: number; always: number };
  hostingBilledMode?: string | null;
  hostingBilledAt?: number | null;
  nextCharge?: number;
};

// Palette GRISE (demande explicite du 2026-09-13 : « fait que elle soit gris et
// pas noire »). Ne pas revenir à un fond quasi noir sans demande.
const C = {
  card: '#2c2c30',
  cardBorder: '#46464d',
  field: '#3a3a40',
  fieldBorder: '#52525a',
  fieldBorderHi: '#6d6d77',
  text: '#f7f7f8',
  dim: '#b3b3ba',
  faint: '#93939c',
  white: '#ffffff',
  chip: '#45454c',
  segOn: '#5a5a63',
};

function authHeaders(json = false): Record<string, string> {
  const h: Record<string, string> = { Authorization: `Bearer ${getAuthToken() || ''}` };
  if (json) h['Content-Type'] = 'application/json';
  return h;
}

function IconCopy({ size = 15 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="9" y="9" width="11" height="11" rx="2" /><path d="M5 15V5a2 2 0 0 1 2-2h10" />
    </svg>
  );
}
function IconEdit({ size = 15 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 20h9" /><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z" />
    </svg>
  );
}
function IconCheck({ size = 16 }: { size?: number }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M20 6 9 17l-5-5" /></svg>;
}
function IconX({ size = 16 }: { size?: number }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M18 6 6 18M6 6l12 12" /></svg>;
}
function IconCredit({ size = 13 }: { size?: number }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><circle cx="12" cy="12" r="9" /><path d="M12 7v10M9 9.5a3 3 0 0 1 3-1.5c1.5 0 2.5 1 2.5 2s-1 1.8-2.5 2-2.5 1-2.5 2 1 2 2.5 2a3 3 0 0 0 3-1.5" /></svg>;
}

export function PublishModal({
  companyId,
  onClose,
  anchorRef,
}: {
  companyId: string;
  onClose: () => void;
  /**
   * [2026-09-13] Bouton "Publish" auquel la popup doit s'accrocher.
   * Fourni → la popup s'ouvre JUSTE EN DESSOUS du bouton (menu déroulant, pas
   * de voile sombre au centre de l'écran). Demande explicite de l'utilisateur :
   * ne pas revenir à une popup centrée sans demande.
   */
  anchorRef?: React.RefObject<HTMLElement | null>;
}) {
  const [, navigate] = useLocation();
  const [st, setSt] = useState<PublishState | null>(null);
  const [loading, setLoading] = useState(true);
  const [moreOpen, setMoreOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  // Édition du sous-domaine.
  const [editing, setEditing] = useState(false);
  const [editVal, setEditVal] = useState('');
  const [checkState, setCheckState] = useState<{ available: boolean; error: string | null } | null>(null);
  const checkTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Popup de succès (lien live).
  const [publishedLink, setPublishedLink] = useState<string | null>(null);
  const [copied, setCopied] = useState('');

  // Animation d'agrandissement de la popup : la zone "More Settings" passe de
  // 0 à sa hauteur réelle mesurée (pas de valeur en dur).
  const moreRef = useRef<HTMLDivElement | null>(null);
  const [moreH, setMoreH] = useState(0);
  useEffect(() => {
    if (!moreOpen) { setMoreH(0); return; }
    const el = moreRef.current;
    if (!el) return;
    setMoreH(el.scrollHeight);
    // Après l'animation, laisse la hauteur libre (contenu qui change de taille).
    const t = setTimeout(() => setMoreH(-1), 320);
    return () => clearTimeout(t);
  }, [moreOpen, st?.visibility, st?.availabilityMode]);

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/companies/${companyId}/publish`, { headers: authHeaders() });
      const data = await res.json();
      if (res.ok) {
        setSt(data);
        if (data.published && data.liveUrl) setPublishedLink(data.liveUrl);
      }
    } catch { /* ignore */ }
    setLoading(false);
  }, [companyId]);

  useEffect(() => { load(); }, [load]);

  // Fermer avec Échap.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const startEdit = () => {
    setEditVal(st?.subdomain || '');
    setCheckState(null);
    setEditing(true);
  };

  const onEditChange = (v: string) => {
    const clean = v.toLowerCase().replace(/[^a-z0-9-]/g, '');
    setEditVal(clean);
    setCheckState(null);
    if (checkTimer.current) clearTimeout(checkTimer.current);
    if (!clean) return;
    checkTimer.current = setTimeout(async () => {
      try {
        const res = await fetch(`/api/companies/${companyId}/publish/check?value=${encodeURIComponent(clean)}`, { headers: authHeaders() });
        const data = await res.json();
        setCheckState({ available: !!data.available, error: data.error || null });
      } catch { /* ignore */ }
    }, 350);
  };

  const confirmEdit = async () => {
    if (!editVal || (checkState && !checkState.available)) return;
    setBusy(true); setErr('');
    try {
      const res = await fetch(`/api/companies/${companyId}/publish/settings`, {
        method: 'POST', headers: authHeaders(true), body: JSON.stringify({ subdomain: editVal }),
      });
      const data = await res.json();
      if (!res.ok) { setErr(data.error || 'Error'); }
      else { setSt(data); setEditing(false); }
    } catch { setErr('Network error'); }
    setBusy(false);
  };

  const setAvailability = async (mode: 'wake' | 'always') => {
    if (!st) return;
    setSt({ ...st, availabilityMode: mode });
    const res = await fetch(`/api/companies/${companyId}/publish/settings`, {
      method: 'POST', headers: authHeaders(true), body: JSON.stringify({ availabilityMode: mode }),
    }).catch(() => null);
    if (res && res.ok) { const d = await res.json().catch(() => null); if (d) setSt(d); }
  };
  const setVisibility = async (vis: 'public' | 'private') => {
    if (!st) return;
    setSt({ ...st, visibility: vis });
    await fetch(`/api/companies/${companyId}/publish/settings`, {
      method: 'POST', headers: authHeaders(true), body: JSON.stringify({ visibility: vis }),
    }).catch(() => {});
  };

  const publish = async () => {
    if (editing) return;
    setBusy(true); setErr('');
    try {
      const res = await fetch(`/api/companies/${companyId}/publish`, {
        method: 'POST', headers: authHeaders(true),
        body: JSON.stringify({
          availabilityMode: st?.availabilityMode,
          visibility: st?.visibility,
        }),
      });
      const data = await res.json();
      if (!res.ok) { setErr(data.error || 'Échec de la publication'); }
      else { setSt(data); setPublishedLink(data.liveUrl); }
    } catch { setErr('Network error'); }
    setBusy(false);
  };

  const copy = async (text: string, tag: string) => {
    try { await navigator.clipboard.writeText(text); setCopied(tag); setTimeout(() => setCopied(''), 1500); } catch { /* ignore */ }
  };

  const canPublish = !busy && !editing && !!st;
  const cost = st?.hostingCost || { wake: 500, always: 5000 };
  const nextCharge = st?.nextCharge ?? cost[st?.availabilityMode || 'wake'];

  // ── Placement sous le bouton "Publish" (mode ancré) ───────────────────────
  // On mesure le bouton et le panneau à chaque ouverture / changement de taille
  // et on place le panneau juste en dessous, bord droit aligné sur le bouton.
  // Si ça déborde de l'écran on recale dans la fenêtre (jamais hors champ).
  const anchored = !!anchorRef;
  const panelRef = useRef<HTMLDivElement | null>(null);
  const [pos, setPos] = useState<{ top: number; left: number; maxH: number } | null>(null);

  useLayoutEffect(() => {
    if (!anchored) return;
    const place = () => {
      const btn = anchorRef?.current;
      const panel = panelRef.current;
      if (!btn || !panel) return;
      const a = btn.getBoundingClientRect();
      const pw = panel.offsetWidth || 320;
      const ph = panel.offsetHeight || 300;
      const M = 8;            // marge minimale avec les bords de la fenêtre
      const GAP = 8;          // espace entre le bouton et le panneau
      const vw = window.innerWidth;
      const vh = window.innerHeight;
      // Horizontal : aligné à droite du bouton, puis borné à la fenêtre.
      let left = a.right - pw;
      left = Math.min(Math.max(M, left), Math.max(M, vw - pw - M));
      // Vertical : en dessous du bouton. Hauteur dispo en dessous, sinon on
      // remonte le panneau (sans jamais passer au-dessus du bord haut).
      const top = a.bottom + GAP;
      const maxH = Math.max(200, vh - top - M);
      setPos({ top: Math.min(top, Math.max(M, vh - Math.min(ph, maxH) - M)), left, maxH });
    };
    place();
    window.addEventListener('resize', place);
    window.addEventListener('scroll', place, true);
    const ro = new ResizeObserver(place);
    if (panelRef.current) ro.observe(panelRef.current);
    if (anchorRef?.current) ro.observe(anchorRef.current);
    return () => {
      window.removeEventListener('resize', place);
      window.removeEventListener('scroll', place, true);
      ro.disconnect();
    };
  }, [anchored, anchorRef, loading, moreOpen, moreH, editing, publishedLink]);

  return (
    <div
      onMouseDown={onClose}
      style={anchored ? {
        // Couche invisible : sert seulement à fermer au clic extérieur.
        position: 'fixed', inset: 0, zIndex: 9999, background: 'transparent',
      } : {
        position: 'fixed', inset: 0, zIndex: 9999,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        background: 'rgba(0,0,0,0.55)', backdropFilter: 'blur(2px)',
      }}
    >
      <div
        ref={panelRef}
        data-testid="publish-panel"
        onMouseDown={(e) => e.stopPropagation()}
        style={{
          // [2026-09-13] Version compacte : c'est un menu deroulant sous le
          // bouton, pas une grande modale. Ne pas regrossir sans demande.
          width: 320,
          maxWidth: 'min(92vw, 320px)', overflowY: 'auto',
          background: C.card, border: `1px solid ${C.cardBorder}`, borderRadius: 12,
          padding: 15, boxShadow: '0 14px 34px rgba(0,0,0,0.55)',
          fontFamily: 'system-ui, -apple-system, sans-serif', color: C.text,
          // La popup s'agrandit en douceur quand "More Settings" se déplie.
          transition: 'width .28s cubic-bezier(.4,0,.2,1)',
          ...(anchored ? {
            position: 'fixed' as const,
            top: pos?.top ?? -9999,
            left: pos?.left ?? -9999,
            maxHeight: pos ? pos.maxH : '90vh',
            // Évite le flash en haut à gauche avant la première mesure.
            visibility: pos ? ('visible' as const) : ('hidden' as const),
          } : null),
        }}
      >
        {/* [2026-09-13] AUCUN écran de chargement : la popup affiche tout de
            suite le formulaire complet, les réglages du serveur se remplissent
            derrière quand ils arrivent. Ne pas remettre de « Chargement… ». */}
        {(
          <>
            <div style={{ fontSize: 15, fontWeight: 700, letterSpacing: -0.2 }}>Publish your website</div>
            <div style={{ fontSize: 11.5, color: C.dim, marginTop: 2 }}>This will help you get discovered</div>

            {/* Your Subdomain */}
            <div style={{ marginTop: 14, fontSize: 12 }}>Your Subdomain</div>
            <div style={{ display: 'flex', gap: 6, marginTop: 6, alignItems: 'stretch' }}>
              <div
                style={{
                  flex: 1, display: 'flex', alignItems: 'center', gap: 2,
                  background: C.field, border: `1px solid ${editing ? C.fieldBorderHi : C.fieldBorder}`,
                  borderRadius: 9, padding: '0 10px', height: 36, minWidth: 0,
                }}
              >
                {editing ? (
                  <>
                    <input
                      autoFocus
                      value={editVal}
                      onChange={(e) => onEditChange(e.target.value)}
                      onKeyDown={(e) => { if (e.key === 'Enter') confirmEdit(); }}
                      data-testid="subdomain-input"
                      style={{
                        flex: 1, minWidth: 0, background: 'transparent', border: 'none', outline: 'none',
                        color: C.text, fontSize: 12.5,
                      }}
                    />
                    <span style={{ color: C.faint, fontSize: 12.5, whiteSpace: 'nowrap' }}>.velbaz.site</span>
                  </>
                ) : (
                  <span style={{ fontSize: 12.5, color: C.text, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {st?.subdomainDisplay || '—'}
                  </span>
                )}
              </div>

              {editing ? (
                <>
                  <IconBtn onClick={() => { setEditing(false); setErr(''); }} title="Annuler"><IconX /></IconBtn>
                  <IconBtn
                    onClick={confirmEdit}
                    disabled={!editVal || (checkState ? !checkState.available : false) || busy}
                    title="Confirmer"
                  ><IconCheck /></IconBtn>
                </>
              ) : (
                <>
                  <IconBtn onClick={() => copy(st?.subdomainDisplay || '', 'sub')} title="Copier">
                    {copied === 'sub' ? <IconCheck /> : <IconCopy />}
                  </IconBtn>
                  <IconBtn onClick={startEdit} title="Modifier"><IconEdit /></IconBtn>
                </>
              )}
            </div>
            {editing && checkState && !checkState.available && (
              <div style={{ fontSize: 11, color: '#ff6b6b', marginTop: 6 }}>{checkState.error}</div>
            )}
            {editing && checkState && checkState.available && (
              <div style={{ fontSize: 11, color: '#4ade80', marginTop: 6 }}>Disponible</div>
            )}

            {/* Add custom domain → vraie page Domains du projet */}
            <button
              onClick={() => { onClose(); navigate(`/company/${companyId}?tab=domains`); }}
              data-testid="add-custom-domain"
              style={{
                marginTop: 12, background: 'none', border: 'none', cursor: 'pointer', padding: 0,
                color: C.dim, fontSize: 12, display: 'inline-flex', alignItems: 'center', gap: 5,
              }}
            >
              Add custom domain
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M7 17 17 7M8 7h9v9" /></svg>
            </button>

            {/* More Settings */}
            <button
              onClick={() => setMoreOpen((v) => !v)}
              data-testid="more-settings"
              style={{
                width: '100%', marginTop: 14, background: 'none', border: 'none', cursor: 'pointer',
                padding: 0, color: C.text, fontSize: 13,
                display: 'flex', alignItems: 'center', justifyContent: 'space-between',
              }}
            >
              <span>More Settings</span>
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
                style={{ transform: moreOpen ? 'rotate(90deg)' : 'none', transition: 'transform .25s cubic-bezier(.4,0,.2,1)' }}>
                <path d="m9 18 6-6-6-6" />
              </svg>
            </button>

            {/* Zone dépliable animée (hauteur + opacité) */}
            <div
              style={{
                height: moreOpen ? (moreH === -1 ? 'auto' : moreH) : 0,
                opacity: moreOpen ? 1 : 0,
                overflow: moreH === -1 && moreOpen ? 'visible' : 'hidden',
                transition: 'height .28s cubic-bezier(.4,0,.2,1), opacity .24s ease',
              }}
            >
              <div ref={moreRef} style={{ paddingTop: 14 }}>
                {/* Availability */}
                <div style={{ fontSize: 12, marginBottom: 8 }}>Availability</div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                  <AvailCard
                    title="Wake on Active" credits={`${cost.wake} credits/month`}
                    desc={<>Sleeps between visits.<br />Loads in 3-5 sec.</>}
                    selected={st?.availabilityMode === 'wake'}
                    onClick={() => setAvailability('wake')}
                  />
                  <AvailCard
                    title="Always On" credits={`${cost.always} credits/month`}
                    desc={<>Always live.<br />Instant load, every time.</>}
                    selected={st?.availabilityMode === 'always'}
                    onClick={() => setAvailability('always')}
                  />
                </div>

                {/* Visibility */}
                <div style={{ fontSize: 12, marginTop: 14, marginBottom: 8 }}>Visibility</div>
                <div style={{ display: 'flex', background: C.field, border: `1px solid ${C.fieldBorder}`, borderRadius: 9, padding: 3, gap: 3 }}>
                  {(['public', 'private'] as const).map((v) => (
                    <button
                      key={v}
                      onClick={() => setVisibility(v)}
                      style={{
                        flex: 1, padding: '7px 0', borderRadius: 7, border: 'none', cursor: 'pointer',
                        fontSize: 12, textTransform: 'capitalize',
                        background: st?.visibility === v ? C.segOn : 'transparent',
                        color: st?.visibility === v ? C.white : C.dim,
                        fontWeight: st?.visibility === v ? 600 : 400,
                        boxShadow: st?.visibility === v ? 'inset 0 0 0 1px #3a3a3a' : 'none',
                      }}
                    >
                      {v}
                    </button>
                  ))}
                </div>
                <div style={{ fontSize: 11, color: C.faint, marginTop: 8 }}>
                  {st?.visibility === 'public'
                    ? 'Visible to search engines and anyone with the link.'
                    : 'Hidden from search engines. Only you can access it.'}
                </div>
              </div>
            </div>

            {err && <div style={{ fontSize: 11.5, color: '#ff6b6b', marginTop: 10 }} data-testid="publish-error">{err}</div>}

            {/* Publish button */}
            <button
              onClick={publish}
              disabled={!canPublish}
              data-testid="publish-confirm"
              style={{
                width: '100%', marginTop: 16, height: 40, borderRadius: 10, border: 'none',
                cursor: canPublish ? 'pointer' : 'default', fontSize: 13.5, fontWeight: 600,
                background: editing ? '#5a5a5a' : C.white,
                color: editing ? '#cfcfcf' : '#111',
                opacity: busy ? 0.7 : 1, transition: 'opacity .15s',
              }}
            >
              {busy ? 'Publishing…' : st?.published ? 'Update' : 'Publish'}
            </button>
            {/* Coût réel du prochain clic (0 = période de 30 jours déjà payée) */}
            <div style={{ fontSize: 10.5, color: C.faint, marginTop: 7, textAlign: 'center' }}>
              {nextCharge > 0
                ? `${nextCharge} crédits seront débités pour 30 jours d'hébergement.`
                : 'Période de 30 jours déjà payée — aucun crédit débité.'}
            </div>

            {/* Popup lien live (sous le bouton) */}
            {publishedLink && (
              <div
                style={{
                  marginTop: 12, padding: 11, borderRadius: 10,
                  background: '#12261a', border: '1px solid #1f4531',
                }}
              >
                <div style={{ fontSize: 11.5, color: '#4ade80', fontWeight: 600, display: 'flex', alignItems: 'center', gap: 6 }}>
                  <IconCheck size={13} /> Site published
                </div>
                <div style={{ display: 'flex', gap: 6, marginTop: 8, alignItems: 'center' }}>
                  <a
                    href={publishedLink} target="_blank" rel="noopener noreferrer"
                    style={{
                      flex: 1, minWidth: 0, fontSize: 11.5, color: '#d6ffe6', textDecoration: 'none',
                      overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                      background: '#0e1c14', border: '1px solid #1f4531', borderRadius: 8, padding: '8px 10px',
                    }}
                  >
                    {publishedLink}
                  </a>
                  <IconBtn onClick={() => copy(publishedLink, 'live')} title="Copier">
                    {copied === 'live' ? <IconCheck /> : <IconCopy />}
                  </IconBtn>
                  <a
                    href={publishedLink} target="_blank" rel="noopener noreferrer"
                    style={{
                      display: 'flex', alignItems: 'center', justifyContent: 'center', width: 36, height: 36,
                      background: '#0e1c14', border: '1px solid #1f4531', borderRadius: 9, color: '#d6ffe6',
                    }}
                    title="Ouvrir"
                  >
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M7 17 17 7M8 7h9v9" /></svg>
                  </a>
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

// ─── Sous-composants ─────────────────────────────────────────────────────────

function IconBtn({
  children, onClick, title, disabled,
}: { children: React.ReactNode; onClick: () => void; title?: string; disabled?: boolean }) {
  return (
    <button
      onClick={onClick} title={title} disabled={disabled}
      style={{
        width: 36, height: 36, flexShrink: 0, borderRadius: 9,
        background: C.field, border: `1px solid ${C.fieldBorder}`,
        color: disabled ? '#555' : C.dim, cursor: disabled ? 'default' : 'pointer',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        transition: 'color .12s, border-color .12s',
      }}
      onMouseEnter={(e) => { if (!disabled) { e.currentTarget.style.color = C.text; e.currentTarget.style.borderColor = C.fieldBorderHi; } }}
      onMouseLeave={(e) => { e.currentTarget.style.color = disabled ? '#555' : C.dim; e.currentTarget.style.borderColor = C.fieldBorder; }}
    >
      {children}
    </button>
  );
}

function AvailCard({
  title, credits, desc, selected, onClick,
}: {
  title: string; credits: string; desc: React.ReactNode; selected: boolean; onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      style={{
        textAlign: 'left', background: C.field, cursor: 'pointer',
        border: `1px solid ${selected ? C.fieldBorderHi : C.fieldBorder}`,
        borderRadius: 10, padding: 10, position: 'relative',
        boxShadow: selected ? 'inset 0 0 0 1px #4a4a4a' : 'none',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <span style={{ fontSize: 12, fontWeight: 600, color: C.text }}>{title}</span>
        <span style={{
          width: 15, height: 15, borderRadius: '50%', flexShrink: 0,
          border: `2px solid ${selected ? C.white : '#555'}`,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}>
          {selected && <span style={{ width: 7, height: 7, borderRadius: '50%', background: C.white }} />}
        </span>
      </div>
      <span style={{
        display: 'inline-flex', alignItems: 'center', gap: 4, marginTop: 8,
        background: C.chip, border: `1px solid ${C.fieldBorder}`, borderRadius: 20,
        padding: '3px 6px', fontSize: 9.5, color: C.dim,
        // Panneau compact : la pastille tient sur une ligne dans les 2 cartes.
        whiteSpace: 'nowrap',
      }}>
        <IconCredit size={11} /> {credits}
      </span>
      <div style={{ fontSize: 10.5, color: C.dim, marginTop: 8, lineHeight: 1.45 }}>{desc}</div>
    </button>
  );
}
