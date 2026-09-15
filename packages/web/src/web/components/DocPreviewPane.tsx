// ─── Aperçu éditable d'un fichier du chat, dans le rectangle de preview ─────
//
// [2026-09-10] Demande utilisateur : « quand je clique sur le fichier dans le
// chat, ça télécharge tout de suite ; je veux que le contenu s'affiche dans le
// rectangle de preview à la place du site, avec le téléchargement en haut à
// droite, et que je puisse modifier le contenu — sauf quand l'IA travaille,
// où ça doit me le dire ».
//
// Le document est rendu MIS EN FORME (titres, gras, tableaux) et directement
// éditable (contentEditable). À la sauvegarde, le DOM est reconverti en
// Markdown (lib/doc-markdown.ts) et réenregistré dans project_files.
// Sauvegarde automatique (1,2 s après la dernière frappe) ET bouton explicite.

import { useState, useEffect, useRef, useCallback } from 'react';
import { getAuthToken } from '../lib/token';
import { markdownToHtml, htmlToMarkdown } from '../lib/doc-markdown';
import PreviewWideButton from './PreviewWideButton';

export const AI_BUSY_MESSAGE = "L'IA travaille sur ce projet — édition bloquée le temps qu'elle termine.";

interface Props {
  companyId: string;
  path: string;
  label: string;
  /** true = l'IA travaille : lecture seule + bandeau d'explication. */
  locked: boolean;
  onClose: () => void;
  /** true = la preview occupe deja toute la largeur du chat. */
  wide?: boolean;
  /** Fourni = la fleche d'elargissement s'affiche a gauche du titre. */
  onToggleWide?: () => void;
}

type SaveState = 'idle' | 'dirty' | 'saving' | 'saved' | 'error';

export default function DocPreviewPane({ companyId, path, label, locked, onClose, wide, onToggleWide }: Props) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saveState, setSaveState] = useState<SaveState>('idle');
  const [dlOpen, setDlOpen] = useState(false);
  const bodyRef = useRef<HTMLDivElement | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lockedRef = useRef(locked);
  lockedRef.current = locked;

  const token = getAuthToken() || '';
  const pdfName = /\.[a-z0-9]{1,6}$/i.test(label) ? label.replace(/\.[a-z0-9]{1,6}$/i, '.pdf') : `${label}.pdf`;
  const srcName = path.split('/').pop() || label || 'document.md';
  const dlBase = `/api/companies/${companyId}/file-download?path=${encodeURIComponent(path)}&token=${encodeURIComponent(token)}`;

  // ── Chargement de la source ───────────────────────────────────────────────
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    setSaveState('idle');
    fetch(`/api/companies/${companyId}/file-content?path=${encodeURIComponent(path)}`, {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then(async (r) => {
        const j = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(j?.error || `Erreur ${r.status}`);
        return j as { content: string };
      })
      .then((j) => {
        if (cancelled) return;
        if (bodyRef.current) bodyRef.current.innerHTML = markdownToHtml(j.content || '');
        setLoading(false);
      })
      .catch((e) => {
        if (cancelled) return;
        setError(e?.message || 'Chargement impossible');
        setLoading(false);
      });
    return () => { cancelled = true; };
  }, [companyId, path, token]);

  // ── Sauvegarde ────────────────────────────────────────────────────────────
  const save = useCallback(async () => {
    if (!bodyRef.current || lockedRef.current) return;
    const content = htmlToMarkdown(bodyRef.current);
    setSaveState('saving');
    try {
      const r = await fetch(`/api/companies/${companyId}/file-content`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ path, content }),
      });
      if (!r.ok) throw new Error(String(r.status));
      setSaveState('saved');
    } catch {
      setSaveState('error');
    }
  }, [companyId, path, token]);

  const onInput = useCallback(() => {
    if (lockedRef.current) return;
    setSaveState('dirty');
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => { void save(); }, 1200);
  }, [save]);

  // Sauvegarde en attente : on la déclenche avant de fermer / de démonter.
  useEffect(() => () => {
    if (timerRef.current) clearTimeout(timerRef.current);
  }, []);

  const saveNow = useCallback(() => {
    if (timerRef.current) clearTimeout(timerRef.current);
    void save();
  }, [save]);

  const statusText =
    saveState === 'saving' ? 'Enregistrement…'
    : saveState === 'saved' ? 'Enregistré'
    : saveState === 'dirty' ? 'Modifié'
    : saveState === 'error' ? 'Échec de l’enregistrement'
    : '';

  const btn: React.CSSProperties = {
    display: 'inline-flex', alignItems: 'center', gap: 6,
    height: 30, padding: '0 10px', borderRadius: 8, fontSize: 12, fontWeight: 600,
    background: 'var(--surface-3)', border: '1px solid var(--border-subtle)',
    color: 'var(--text-secondary)', cursor: 'pointer', whiteSpace: 'nowrap',
  };

  return (
    <div style={{
      flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column',
      background: 'var(--surface-1)', border: '1px solid var(--border-subtle)',
      borderRadius: 12, overflow: 'hidden',
    }}>
      {/* ── Barre du haut : nom à gauche, téléchargement + fermeture à droite ── */}
      <div className="doc-preview-topbar" style={{
        display: 'flex', alignItems: 'center', gap: 8,
        paddingTop: 8, paddingBottom: 8, paddingLeft: 10,
        borderBottom: '1px solid var(--border-subtle)', background: 'var(--surface-2)', flexShrink: 0,
      }}>
        {onToggleWide && <PreviewWideButton wide={!!wide} onClick={onToggleWide} />}
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ color: 'var(--text-tertiary, #888)', flexShrink: 0 }}>
          <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><polyline points="14 2 14 8 20 8" />
        </svg>
        <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {label}
        </span>
        {statusText && (
          <span style={{ fontSize: 11, color: saveState === 'error' ? '#e5484d' : 'var(--text-tertiary, #888)', flexShrink: 0 }}>
            {statusText}
          </span>
        )}

        <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 6 }}>
          {!locked && (
            <button type="button" onClick={saveNow} disabled={saveState === 'saving'} style={{ ...btn, opacity: saveState === 'saving' ? 0.6 : 1 }} title="Enregistrer les modifications">
              Enregistrer
            </button>
          )}

          {/* Téléchargement : PDF ou fichier source */}
          <div style={{ position: 'relative' }}>
            <button type="button" onClick={() => setDlOpen((v) => !v)} style={btn} title="Télécharger">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><polyline points="7 10 12 15 17 10" /><line x1="12" y1="15" x2="12" y2="3" />
              </svg>
              Télécharger
            </button>
            {dlOpen && (
              <div style={{
                position: 'absolute', top: 34, right: 0, zIndex: 20, minWidth: 170,
                background: 'var(--surface-2)', border: '1px solid var(--border-subtle)',
                borderRadius: 10, padding: 4, boxShadow: '0 8px 24px rgba(0,0,0,0.28)',
              }}>
                <a href={dlBase} download={pdfName} onClick={() => setDlOpen(false)}
                   style={{ display: 'block', padding: '7px 10px', borderRadius: 7, fontSize: 12.5, color: 'var(--text-primary)', textDecoration: 'none' }}>
                  PDF — {pdfName}
                </a>
                <a href={`${dlBase}&raw=1`} download={srcName} onClick={() => setDlOpen(false)}
                   style={{ display: 'block', padding: '7px 10px', borderRadius: 7, fontSize: 12.5, color: 'var(--text-primary)', textDecoration: 'none' }}>
                  Fichier source — {srcName}
                </a>
              </div>
            )}
          </div>

          <button type="button" onClick={() => { if (!locked && saveState === 'dirty') saveNow(); onClose(); }}
                  style={{ ...btn, padding: '0 8px' }} title="Fermer l'aperçu">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M18 6L6 18M6 6l12 12" />
            </svg>
          </button>
        </div>
      </div>

      {/* ── Bandeau : édition bloquée pendant que l'IA travaille ── */}
      {locked && (
        <div style={{
          display: 'flex', alignItems: 'center', gap: 8, padding: '8px 12px', flexShrink: 0,
          background: 'rgba(245, 158, 11, 0.12)', borderBottom: '1px solid rgba(245, 158, 11, 0.28)',
          color: '#b45309', fontSize: 12.5, fontWeight: 500,
        }}>
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
            <rect x="3" y="11" width="18" height="11" rx="2" /><path d="M7 11V7a5 5 0 0 1 10 0v4" />
          </svg>
          {AI_BUSY_MESSAGE}
        </div>
      )}

      {/* ── Contenu ── */}
      {/* [2026-09-14] Defilement VERTICAL uniquement : l'utilisateur ne veut
          plus avoir a faire glisser le texte de gauche a droite. */}
      <div style={{ flex: 1, minWidth: 0, minHeight: 0, overflowY: 'auto', overflowX: 'hidden', padding: '20px 24px' }}>
        {loading && <div style={{ fontSize: 13, color: 'var(--text-tertiary, #888)' }}>Chargement…</div>}
        {error && <div style={{ fontSize: 13, color: '#e5484d' }}>{error}</div>}
        <div
          ref={bodyRef}
          className="doc-preview-body"
          contentEditable={!locked && !loading && !error}
          suppressContentEditableWarning
          onInput={onInput}
          onBlur={() => { if (!locked && saveState === 'dirty') saveNow(); }}
          spellCheck={false}
          style={{
            outline: 'none',
            minHeight: '100%',
            fontSize: 14.5,
            lineHeight: 1.7,
            color: 'var(--text-primary)',
            cursor: locked ? 'default' : 'text',
            opacity: locked ? 0.75 : 1,
            display: loading || error ? 'none' : 'block',
          }}
        />
      </div>
    </div>
  );
}
