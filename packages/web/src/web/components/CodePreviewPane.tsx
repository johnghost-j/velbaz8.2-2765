// ─── Grand aperçu de code dans le rectangle de preview ──────────────────────
//
// [2026-09-14] Demande utilisateur : « je veux pouvoir cliquer sur le code et,
// comme pour les textes, que ça montre le code coloré dans un rectangle ».
//
// Deux onglets :
//   • Diff     → les lignes ajoutées en VERT, supprimées en ROUGE, contexte en
//                gris, sur toute la ligne (retours à la ligne inclus).
//   • Fichier  → le contenu ACTUEL du fichier sur le projet, colorié.
//
// Jamais de défilement horizontal : les lignes longues passent à la ligne
// (demande explicite de l'utilisateur pour le texte comme pour le code).

import { useEffect, useMemo, useRef, useState } from 'react';
import { getAuthToken } from '../lib/token';
import {
  lineDiff, countDiffStats, diffLineBg, diffLineColor, diffLineSign,
  type DiffOp,
} from '../lib/code-diff';
import PreviewWideButton from './PreviewWideButton';

interface Props {
  companyId: string;
  filePath?: string;
  oldContent?: string;
  newContent?: string;
  variant?: 'edit' | 'write';
  onClose: () => void;
  wide?: boolean;
  onToggleWide?: () => void;
}

const MONO = '"SF Mono", "Fira Code", "JetBrains Mono", ui-monospace, SFMono-Regular, Menlo, monospace';

// ── Coloration syntaxique légère (onglet « Fichier ») ────────────────────────
// Volontairement minimale et sans dépendance : mots-clés, chaînes, commentaires,
// nombres. Suffisant pour lire du TS/TSX/JS/CSS/JSON dans l'aperçu.
const KEYWORDS = new Set([
  'import', 'from', 'export', 'default', 'const', 'let', 'var', 'function', 'return',
  'if', 'else', 'for', 'while', 'do', 'switch', 'case', 'break', 'continue', 'new',
  'class', 'extends', 'implements', 'interface', 'type', 'enum', 'async', 'await',
  'try', 'catch', 'finally', 'throw', 'typeof', 'instanceof', 'in', 'of', 'this',
  'super', 'null', 'undefined', 'true', 'false', 'void', 'as', 'public', 'private',
  'protected', 'readonly', 'static', 'get', 'set', 'yield', 'delete',
]);

type Tok = { text: string; color?: string };

function tokenizeLine(line: string): Tok[] {
  const out: Tok[] = [];
  const kwColor = 'var(--purple-text, #c084fc)';
  const strColor = 'var(--green-text, #4ade80)';
  const comColor = 'var(--text-ghost)';
  const numColor = 'var(--orange-text, #fb923c)';
  let i = 0;
  // Commentaire plein ligne
  const trimmed = line.trimStart();
  if (trimmed.startsWith('//') || trimmed.startsWith('*') || trimmed.startsWith('/*')) {
    return [{ text: line, color: comColor }];
  }
  let buf = '';
  const flush = () => {
    if (!buf) return;
    // Découpe le tampon en mots pour colorier les mots-clés
    const parts = buf.split(/(\b)/);
    let word = '';
    for (const p of parts) word += p;
    const words = word.split(/([^A-Za-z0-9_$]+)/);
    for (const w of words) {
      if (!w) continue;
      if (KEYWORDS.has(w)) out.push({ text: w, color: kwColor });
      else if (/^\d+(\.\d+)?$/.test(w)) out.push({ text: w, color: numColor });
      else out.push({ text: w });
    }
    buf = '';
  };
  while (i < line.length) {
    const ch = line[i];
    if (ch === '"' || ch === "'" || ch === '`') {
      flush();
      let j = i + 1;
      while (j < line.length && line[j] !== ch) {
        if (line[j] === '\\') j++;
        j++;
      }
      out.push({ text: line.slice(i, Math.min(j + 1, line.length)), color: strColor });
      i = j + 1;
      continue;
    }
    if (ch === '/' && line[i + 1] === '/') {
      flush();
      out.push({ text: line.slice(i), color: comColor });
      i = line.length;
      continue;
    }
    buf += ch;
    i++;
  }
  flush();
  return out.length > 0 ? out : [{ text: line }];
}

export default function CodePreviewPane({
  companyId, filePath, oldContent, newContent, variant = 'write',
  onClose, wide, onToggleWide,
}: Props) {
  const fileName = filePath?.split('/').pop() || 'code';
  const token = getAuthToken() || '';
  const hasDiff = variant === 'edit' ? (oldContent !== undefined && newContent !== undefined) : !!newContent;

  const [tab, setTab] = useState<'diff' | 'file'>(hasDiff ? 'diff' : 'file');
  const [fileText, setFileText] = useState<string | null>(null);
  const [fileErr, setFileErr] = useState<string | null>(null);
  const [fileLoading, setFileLoading] = useState(false);
  const [copied, setCopied] = useState(false);
  const bodyRef = useRef<HTMLDivElement | null>(null);

  // ── Contenu actuel du fichier (onglet « Fichier ») ──────────────────────────
  useEffect(() => {
    if (tab !== 'file' || fileText !== null || !filePath || !companyId) return;
    let cancelled = false;
    setFileLoading(true);
    setFileErr(null);
    fetch(`/api/companies/${companyId}/file-content?path=${encodeURIComponent(filePath)}`, {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then(async (r) => {
        const j = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(j?.error || `Erreur ${r.status}`);
        return j as { content: string };
      })
      .then((j) => { if (!cancelled) { setFileText(j.content ?? ''); setFileLoading(false); } })
      .catch((e) => {
        if (cancelled) return;
        // Repli : au moins le nouveau contenu connu de la carte de code.
        setFileErr(e?.message || 'Lecture impossible');
        setFileText(newContent ?? '');
        setFileLoading(false);
      });
    return () => { cancelled = true; };
  }, [tab, fileText, filePath, companyId, token, newContent]);

  const diffOps = useMemo<DiffOp[]>(() => {
    if (variant === 'edit' && oldContent !== undefined && newContent !== undefined) {
      return lineDiff(oldContent, newContent);
    }
    return (newContent ?? '').split('\n').map((text) => ({ type: 'add' as const, text }));
  }, [variant, oldContent, newContent]);

  const stats = useMemo(() => countDiffStats(diffOps), [diffOps]);

  const copySource = tab === 'diff'
    ? diffOps.filter(o => o.type !== 'remove').map(o => o.text).join('\n')
    : (fileText ?? newContent ?? '');

  const doCopy = () => {
    try {
      void navigator.clipboard?.writeText(copySource);
      setCopied(true);
      setTimeout(() => setCopied(false), 1400);
    } catch { /* clipboard indisponible */ }
  };

  // Remonter en haut à chaque changement d'onglet / de fichier.
  useEffect(() => { if (bodyRef.current) bodyRef.current.scrollTop = 0; }, [tab, filePath]);

  const btn: React.CSSProperties = {
    display: 'inline-flex', alignItems: 'center', gap: 6,
    height: 30, padding: '0 10px', borderRadius: 8, fontSize: 12, fontWeight: 600,
    background: 'var(--surface-3)', border: '1px solid var(--border-subtle)',
    color: 'var(--text-secondary)', cursor: 'pointer', whiteSpace: 'nowrap',
  };
  const tabBtn = (active: boolean): React.CSSProperties => ({
    height: 26, padding: '0 10px', borderRadius: 7, fontSize: 12, fontWeight: 600,
    cursor: 'pointer', whiteSpace: 'nowrap',
    background: active ? 'var(--surface-0)' : 'transparent',
    border: `1px solid ${active ? 'var(--border-default)' : 'transparent'}`,
    color: active ? 'var(--text-primary)' : 'var(--text-tertiary, #888)',
  });

  const dlUrl = filePath
    ? `/api/companies/${companyId}/file-download?path=${encodeURIComponent(filePath)}&token=${encodeURIComponent(token)}&raw=1`
    : undefined;

  // ── Lignes affichées ────────────────────────────────────────────────────────
  const fileLines = useMemo(() => (fileText ?? '').split('\n'), [fileText]);
  const gutterW = Math.max(30, String(Math.max(diffOps.length, fileLines.length)).length * 8 + 16);

  return (
    <div style={{
      flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column',
      background: 'var(--surface-1)', border: '1px solid var(--border-subtle)',
      borderRadius: 12, overflow: 'hidden',
    }}>
      {/* ── Barre du haut ── */}
      <div className="doc-preview-topbar" style={{
        display: 'flex', alignItems: 'center', gap: 8,
        paddingTop: 8, paddingBottom: 8, paddingLeft: 10,
        borderBottom: '1px solid var(--border-subtle)', background: 'var(--surface-2)', flexShrink: 0,
      }}>
        {onToggleWide && <PreviewWideButton wide={!!wide} onClick={onToggleWide} />}
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ color: 'var(--text-tertiary, #888)', flexShrink: 0 }}>
          <polyline points="16 18 22 12 16 6" /><polyline points="8 6 2 12 8 18" />
        </svg>
        <span title={filePath} style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {fileName}
        </span>
        {(stats.added > 0 || stats.removed > 0) && (
          <span style={{ fontSize: 11, fontFamily: MONO, display: 'inline-flex', gap: 6, flexShrink: 0 }}>
            {stats.added > 0 && <span style={{ color: 'var(--green-text, #4ade80)' }}>+{stats.added}</span>}
            {stats.removed > 0 && <span style={{ color: 'var(--red-text, #ff6b6b)' }}>-{stats.removed}</span>}
          </span>
        )}

        <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 6 }}>
          {/* Onglets Diff / Fichier */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 2, padding: 2, borderRadius: 9, background: 'var(--surface-3)' }}>
            {hasDiff && (
              <button type="button" onClick={() => setTab('diff')} style={tabBtn(tab === 'diff')}>
                {variant === 'edit' ? 'Diff' : 'Code'}
              </button>
            )}
            {filePath && (
              <button type="button" onClick={() => setTab('file')} style={tabBtn(tab === 'file')}>
                Fichier complet
              </button>
            )}
          </div>

          <button type="button" onClick={doCopy} style={btn} title="Copier le code">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <rect x="9" y="9" width="12" height="12" rx="2" /><path d="M5 15V5a2 2 0 0 1 2-2h10" />
            </svg>
            {copied ? 'Copié' : 'Copier'}
          </button>

          {dlUrl && (
            <a href={dlUrl} download={fileName} style={{ ...btn, textDecoration: 'none' }} title="Télécharger le fichier">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><polyline points="7 10 12 15 17 10" /><line x1="12" y1="15" x2="12" y2="3" />
              </svg>
            </a>
          )}

          <button type="button" onClick={onClose} style={{ ...btn, padding: '0 8px' }} title="Fermer l'aperçu du code">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M18 6L6 18M6 6l12 12" />
            </svg>
          </button>
        </div>
      </div>

      {fileErr && tab === 'file' && (
        <div style={{
          padding: '7px 12px', fontSize: 12, flexShrink: 0,
          background: 'rgba(245, 158, 11, 0.12)', borderBottom: '1px solid rgba(245, 158, 11, 0.28)', color: '#b45309',
        }}>
          {fileErr} — affichage du code de cette modification.
        </div>
      )}

      {/* ── Corps : jamais de défilement horizontal ── */}
      <div
        ref={bodyRef}
        style={{
          flex: 1, minHeight: 0, minWidth: 0,
          overflowY: 'auto', overflowX: 'hidden',
          background: 'var(--surface-0)',
          fontFamily: MONO, fontSize: 12.5, lineHeight: 1.6,
          padding: '8px 0',
        }}
      >
        {tab === 'diff' ? (
          diffOps.map((op, i) => (
            <div key={i} style={{ display: 'flex', alignItems: 'flex-start', minWidth: 0, background: diffLineBg(op.type) }}>
              <span style={{
                userSelect: 'none', width: gutterW, paddingRight: 8, textAlign: 'right',
                flexShrink: 0, color: 'var(--text-ghost)', opacity: 0.7,
              }}>{i + 1}</span>
              <span style={{ userSelect: 'none', width: 14, textAlign: 'center', flexShrink: 0, color: diffLineColor(op.type) }}>
                {diffLineSign(op.type)}
              </span>
              {/* La couleur porte sur TOUTE la ligne, retours à la ligne compris. */}
              <span style={{
                whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', wordBreak: 'break-word',
                flex: 1, minWidth: 0, paddingRight: 12, color: diffLineColor(op.type),
              }}>{op.text || ' '}</span>
            </div>
          ))
        ) : fileLoading ? (
          <div style={{ padding: '10px 14px', fontSize: 13, color: 'var(--text-tertiary, #888)', fontFamily: 'inherit' }}>Chargement…</div>
        ) : (
          fileLines.map((line, i) => (
            <div key={i} style={{ display: 'flex', alignItems: 'flex-start', minWidth: 0 }}>
              <span style={{
                userSelect: 'none', width: gutterW, paddingRight: 8, textAlign: 'right',
                flexShrink: 0, color: 'var(--text-ghost)', opacity: 0.7,
              }}>{i + 1}</span>
              <span style={{
                whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', wordBreak: 'break-word',
                flex: 1, minWidth: 0, paddingRight: 12, paddingLeft: 6, color: 'var(--text-secondary)',
              }}>
                {tokenizeLine(line).map((t, k) => (
                  <span key={k} style={t.color ? { color: t.color } : undefined}>{t.text}</span>
                ))}
                {line === '' ? ' ' : null}
              </span>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
