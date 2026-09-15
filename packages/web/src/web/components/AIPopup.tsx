import { useState, useEffect } from 'react';

/* ─────────────────────────────────────────────────────────────
   AI-triggered popups. The AI emits a [POPUP]{json}[/POPUP] block
   and the chat renders the matching popup above the input box.
   ───────────────────────────────────────────────────────────── */

export type PopupType =
  | 'confirm'
  | 'preview'
  | 'choice'
  | 'alert'
  | 'progress'
  | 'secret'
  | 'delete_secret'
  | 'recap'
  | 'info'
  | 'upgrade'
  | 'product_preview'
  | 'invention_preview'
  | 'brand_preview'
  | 'printify_design';

export interface PopupOption { id: string; label: string; description?: string; imageUrl?: string }
export interface PopupField { key: string; label: string; placeholder?: string }
export interface PopupRecapItem { label: string; value?: string }

export interface PopupConfig {
  type: PopupType;
  title?: string;
  message?: string;
  // confirm / alert / recap
  confirmLabel?: string;
  cancelLabel?: string;
  danger?: boolean;
  level?: 'warning' | 'danger';
  // preview
  imageUrl?: string;
  previewUrl?: string;
  // choice
  options?: PopupOption[];
  // secret
  fields?: PopupField[];
  // delete_secret — keys to remove
  keys?: string[];
  // recap
  items?: PopupRecapItem[];
  // progress
  percent?: number;
  canPause?: boolean;
  canStop?: boolean;
  // info
  autoDismiss?: boolean;
  // upgrade — in-app navigation target for the primary button (e.g. "/plans")
  redirectTo?: string;
  // product_preview (IA) — description du produit à visualiser
  description?: string;
}

/** True when the popup blocks the AI and requires an explicit user response. */
export function isBlockingPopup(type: PopupType): boolean {
  return type !== 'progress' && type !== 'info';
}

interface AIPopupProps {
  popup: PopupConfig;
  /** Send a response back to the AI (as a follow-up user message). */
  onRespond: (response: string) => void;
  /** Dismiss without sending anything back (non-blocking popups). */
  onDismiss: () => void;
  /** Store secret values securely; returns true on success. */
  onSaveSecrets?: (values: Record<string, string>) => Promise<boolean>;
  /** Delete previously-stored secret keys; returns true on success. */
  onDeleteSecrets?: (keys: string[]) => Promise<boolean>;
}

/* ─── Shared shell ─── */
function Shell({
  icon,
  label,
  labelColor,
  borderColor,
  children,
}: {
  icon: React.ReactNode;
  label: string;
  labelColor: string;
  borderColor?: string;
  children: React.ReactNode;
}) {
  return (
    <div
      className="mb-3 rounded-xl overflow-hidden question-popup-enter"
      style={{
        background: 'var(--surface-2)',
        border: `1px solid ${borderColor || 'var(--border-default)'}`,
        boxShadow: '0 -4px 24px rgba(0,0,0,0.15)',
      }}
    >
      <div
        className="px-4 py-2.5 flex items-center gap-2"
        style={{ borderBottom: '1px solid var(--border-subtle)' }}
      >
        <div
          className="w-5 h-5 rounded-md flex items-center justify-center shrink-0"
          style={{ background: 'var(--surface-4)' }}
        >
          {icon}
        </div>
        <span className="text-[11px] font-semibold" style={{ color: labelColor }}>
          {label}
        </span>
      </div>
      {children}
    </div>
  );
}

function Btn({
  onClick,
  children,
  variant = 'primary',
  color,
}: {
  onClick: () => void;
  children: React.ReactNode;
  variant?: 'primary' | 'ghost' | 'danger';
  color?: string;
}) {
  const base = 'h-8 px-4 rounded-lg text-[12px] font-medium transition-opacity flex items-center gap-1.5';
  if (variant === 'ghost') {
    return (
      <button
        onClick={onClick}
        className={base}
        style={{ background: 'var(--surface-4)', color: 'var(--text-dim)', border: '1px solid var(--border-default)' }}
      >
        {children}
      </button>
    );
  }
  if (variant === 'danger') {
    return (
      <button
        onClick={onClick}
        className={base}
        style={{ background: 'var(--red-subtle-bg)', color: 'var(--red-text)', border: '1px solid var(--red-subtle-border)' }}
      >
        {children}
      </button>
    );
  }
  return (
    <button
      onClick={onClick}
      className={base}
      style={{ background: color || 'var(--btn-primary-bg)', color: 'var(--btn-primary-fg)' }}
      onMouseEnter={(e) => (e.currentTarget.style.opacity = '0.85')}
      onMouseLeave={(e) => (e.currentTarget.style.opacity = '1')}
    >
      {children}
    </button>
  );
}

const Check = () => (
  <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="2"><path d="M2 6L5 9L10 3" /></svg>
);

/* ─── Main component ─── */
export function AIPopup({ popup, onRespond, onDismiss, onSaveSecrets, onDeleteSecrets, onCreatePrintifyProduct }: AIPopupProps) {
  const [declineMode, setDeclineMode] = useState(false);
  const [declineText, setDeclineText] = useState('');
  const [secretValues, setSecretValues] = useState<Record<string, string>>({});
  const [savingSecrets, setSavingSecrets] = useState(false);
  const [deletingSecrets, setDeletingSecrets] = useState(false);
  const [creatingPrintify, setCreatingPrintify] = useState(false);

  // Auto-dismiss info popups
  useEffect(() => {
    if (popup.type === 'info' && popup.autoDismiss !== false) {
      const t = setTimeout(() => onDismiss(), 5000);
      return () => clearTimeout(t);
    }
  }, [popup]);

  const title = popup.title || '';
  const message = popup.message || '';

  /* CONFIRM */
  if (popup.type === 'confirm') {
    const danger = !!popup.danger;
    return (
      <Shell
        icon={<svg width="11" height="11" viewBox="0 0 16 16" fill="none" stroke={danger ? 'var(--red-text)' : 'var(--text-secondary)'} strokeWidth="1.5"><path d="M8 1L2 4.5V11.5L8 15L14 11.5V4.5L8 1Z" /></svg>}
        label={danger ? 'Important confirmation' : 'Confirmation'}
        labelColor={danger ? 'var(--red-text)' : 'var(--teal)'}
        borderColor={danger ? 'var(--red-subtle-border)' : 'var(--teal-subtle-border)'}
      >
        <div className="px-4 py-3">
          {title && <p className="text-[13px] font-semibold mb-1" style={{ color: 'var(--text-primary)' }}>{title}</p>}
          <p className="text-[12px] leading-relaxed" style={{ color: 'var(--text-muted)' }}>{message}</p>
        </div>
        <div className="px-4 py-3 flex items-center gap-2" style={{ borderTop: '1px solid var(--border-subtle)' }}>
          <Btn onClick={() => onRespond(`[CONFIRMÉ] ${title || message}`)} variant={danger ? 'danger' : 'primary'}>
            {!danger && <Check />} {popup.confirmLabel || 'Confirm'}
          </Btn>
          <Btn onClick={() => onRespond(`[ANNULÉ] The user declined: ${title || message}. Do not execute this action.`)} variant="ghost">
            {popup.cancelLabel || 'Cancel'}
          </Btn>
        </div>
      </Shell>
    );
  }

  /* UPGRADE — action bloquée réservée aux plans payants, bouton → page Plans */
  if (popup.type === 'upgrade') {
    const target = popup.redirectTo || '/plans';
    return (
      <Shell
        icon={<svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="var(--text-secondary)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M8 13V3M8 3L4 7M8 3l4 4" /></svg>}
        label="Paid plan required"
        labelColor="var(--teal)"
        borderColor="var(--teal-subtle-border)"
      >
        <div className="px-4 py-3">
          {title && <p className="text-[13px] font-semibold mb-1" style={{ color: 'var(--text-primary)' }}>{title}</p>}
          <p className="text-[12px] leading-relaxed" style={{ color: 'var(--text-muted)' }}>{message}</p>
        </div>
        <div className="px-4 py-3 flex items-center gap-2" style={{ borderTop: '1px solid var(--border-subtle)' }}>
          <Btn onClick={() => onRespond(`__NAVIGATE__${target}`)}>
            {popup.confirmLabel || 'View plans'}
          </Btn>
          <Btn onClick={() => onDismiss()} variant="ghost">
            {popup.cancelLabel || 'Later'}
          </Btn>
        </div>
      </Shell>
    );
  }

  /* PRINTIFY DESIGN — récapitulatif du design multi-calques + création */
  if (popup.type === 'printify_design') {
    const design = popup.design || {};
    const areas: { position: string; layers: any[] }[] = Array.isArray(design.printAreas) ? design.printAreas : [];
    const layerLabel = (l: any) =>
      l?.type === 'text'
        ? `Text "${String(l.text || '').slice(0, 40)}"${l.color ? ` · ${l.color}` : ''}`
        : `Image${l?.pattern ? ' (repeated pattern)' : ''}${typeof l?.scale === 'number' ? ` · scale ${l.scale}` : ''}`;
    const handleCreate = async () => {
      if (!onCreatePrintifyProduct || creatingPrintify) return;
      setCreatingPrintify(true);
      const res = await onCreatePrintifyProduct(design);
      setCreatingPrintify(false);
      onRespond(res.ok
        ? `[PRINTIFY CRÉÉ] ${res.message}`
        : `[PRINTIFY FAILED] Product creation failed: ${res.message}. Analyze the error and propose a fix.`);
    };
    return (
      <Shell
        icon={<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="var(--text-secondary)" strokeWidth="2"><path d="M20.38 3.46L16 2a4 4 0 0 1-8 0L3.62 3.46a2 2 0 0 0-1.34 2.23l.58 3.47a1 1 0 0 0 .99.84H6v10a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2V10h2.15a1 1 0 0 0 .99-.84l.58-3.47a2 2 0 0 0-1.34-2.23z" strokeLinecap="round" strokeLinejoin="round" /></svg>}
        label="Printify Design"
        labelColor="var(--teal)"
        borderColor="var(--teal-subtle-border)"
      >
        <div className="px-4 py-3">
          {title && <p className="text-[13px] font-semibold mb-1" style={{ color: 'var(--text-primary)' }}>{title}</p>}
          {message && <p className="text-[12px] leading-relaxed mb-2" style={{ color: 'var(--text-muted)' }}>{message}</p>}
          <div className="rounded-lg px-3 py-2 space-y-1.5" style={{ background: 'var(--surface-3)', border: '1px solid var(--border-subtle)' }}>
            <p className="text-[12px] font-semibold" style={{ color: 'var(--text-primary)' }}>
              {design.title || 'Product'}{typeof design.price === 'number' ? ` — ${(design.price / 100).toFixed(2)} €` : ''}
            </p>
            {areas.map((a, i) => (
              <div key={i}>
                <p className="text-[11px] font-medium" style={{ color: 'var(--text-dim)' }}>Area: {a.position}</p>
                {(a.layers || []).map((l, j) => (
                  <p key={j} className="text-[11px] pl-3" style={{ color: 'var(--text-muted)' }}>• {layerLabel(l)}</p>
                ))}
              </div>
            ))}
          </div>
        </div>
        <div className="px-4 py-3 flex items-center gap-2" style={{ borderTop: '1px solid var(--border-subtle)' }}>
          <Btn onClick={handleCreate}>
            {creatingPrintify ? 'Creating…' : (<><Check /> {popup.confirmLabel || 'Create on Printify'}</>)}
          </Btn>
          {!creatingPrintify && (
            <Btn onClick={() => onRespond(`[ANNULÉ] The user does not want to create this Printify product: ${design.title || title}. Ask them what they want to change.`)} variant="ghost">
              {popup.cancelLabel || 'Cancel'}
            </Btn>
          )}
        </div>
      </Shell>
    );
  }

  /* ALERT */
  if (popup.type === 'alert') {
    const danger = popup.level !== 'warning';
    const c = danger ? 'var(--red-text)' : '#f59e0b';
    return (
      <Shell
        icon={<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke={c} strokeWidth="2"><path d="M12 9v4M12 17h.01M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" strokeLinecap="round" strokeLinejoin="round" /></svg>}
        label={danger ? 'Alert — risk' : 'Warning'}
        labelColor={c}
        borderColor={danger ? 'var(--red-subtle-border)' : 'rgba(245,158,11,0.4)'}
      >
        <div className="px-4 py-3">
          {title && <p className="text-[13px] font-semibold mb-1" style={{ color: c }}>{title}</p>}
          <p className="text-[12px] leading-relaxed" style={{ color: 'var(--text-muted)' }}>{message}</p>
        </div>
        <div className="px-4 py-3 flex items-center gap-2" style={{ borderTop: '1px solid var(--border-subtle)' }}>
          <Btn onClick={() => onRespond(`[COMPRIS — CONTINUER] Understood, continue despite the risk: ${title || message}. Continue.`)} variant="danger">
            {popup.confirmLabel || 'Continue anyway'}
          </Btn>
          <Btn onClick={() => onRespond(`[STOP] Stop because of the risk: ${title || message}.`)} variant="ghost">
            {popup.cancelLabel || 'Stop'}
          </Btn>
        </div>
      </Shell>
    );
  }

  /* CHOICE */
  if (popup.type === 'choice') {
    return (
      <Shell
        icon={<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="var(--text-secondary)" strokeWidth="2"><path d="M9 11l3 3L22 4M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11" strokeLinecap="round" strokeLinejoin="round" /></svg>}
        label="Choice"
        labelColor="var(--teal)"
        borderColor="var(--teal-subtle-border)"
      >
        <div className="px-4 py-3">
          {title && <p className="text-[13px] font-semibold mb-1" style={{ color: 'var(--text-primary)' }}>{title}</p>}
          {message && <p className="text-[12px] leading-relaxed mb-3" style={{ color: 'var(--text-muted)' }}>{message}</p>}
          <div className="space-y-1.5">
            {(popup.options || []).map((opt, i) => (
              <button
                key={opt.id || i}
                onClick={() => onRespond(`[CHOIX] ${opt.label}`)}
                className="w-full text-left rounded-lg p-2.5 flex items-center gap-3 transition-colors"
                style={{ background: 'var(--surface-3)', border: '1px solid var(--border-default)' }}
                onMouseEnter={(e) => (e.currentTarget.style.borderColor = 'var(--border-hover)')}
                onMouseLeave={(e) => (e.currentTarget.style.borderColor = 'var(--border-default)')}
              >
                {opt.imageUrl && (
                  <img src={opt.imageUrl} alt="" className="w-12 h-12 rounded-md object-cover shrink-0" />
                )}
                <span className="flex-1">
                  <span className="text-[12px] font-medium block" style={{ color: 'var(--text-primary)' }}>{opt.label}</span>
                  {opt.description && <span className="text-[11px] block mt-0.5" style={{ color: 'var(--text-dim)' }}>{opt.description}</span>}
                </span>
              </button>
            ))}
          </div>
        </div>
      </Shell>
    );
  }

  /* PREVIEW */
  if (popup.type === 'preview') {
    const src = popup.imageUrl || popup.previewUrl;
    return (
      <Shell
        icon={<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="var(--text-secondary)" strokeWidth="2"><path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7z" strokeLinecap="round" strokeLinejoin="round" /><circle cx="12" cy="12" r="3" /></svg>}
        label="Preview"
        labelColor="var(--teal)"
        borderColor="var(--teal-subtle-border)"
      >
        <div className="px-4 py-3">
          {title && <p className="text-[13px] font-semibold mb-1" style={{ color: 'var(--text-primary)' }}>{title}</p>}
          {message && <p className="text-[12px] leading-relaxed mb-2" style={{ color: 'var(--text-muted)' }}>{message}</p>}
          {src && (
            popup.previewUrl && !popup.imageUrl ? (
              <div className="rounded-lg overflow-hidden" style={{ border: '1px solid var(--border-default)', height: 260 }}>
                <iframe src={src} title="preview" className="w-full h-full" style={{ border: 'none' }} />
              </div>
            ) : (
              <img src={src} alt="preview" className="w-full rounded-lg" style={{ border: '1px solid var(--border-default)' }} />
            )
          )}
        </div>
        <div className="px-4 py-3 flex items-center gap-2" style={{ borderTop: '1px solid var(--border-subtle)' }}>
          <Btn onClick={() => onRespond(`[APERÇU VALIDÉ] Parfait, continue.`)}><Check /> {popup.confirmLabel || 'Validate'}</Btn>
          {!declineMode ? (
            <Btn onClick={() => setDeclineMode(true)} variant="ghost">{popup.cancelLabel || 'Edit'}</Btn>
          ) : null}
        </div>
        {declineMode && (
          <div className="px-4 pb-3">
            <textarea
              value={declineText}
              onChange={(e) => setDeclineText(e.target.value)}
              autoFocus
              placeholder="What should I change?"
              className="w-full h-16 px-3 py-2 rounded-lg text-[12px] outline-none resize-none"
              style={{ background: 'var(--surface-3)', border: '1px solid var(--border-default)', color: 'var(--text-muted)' }}
              onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey && declineText.trim()) { e.preventDefault(); onRespond(`[APERÇU À MODIFIER] ${declineText.trim()}`); } }}
            />
            <div className="mt-2">
              <Btn onClick={() => declineText.trim() && onRespond(`[APERÇU À MODIFIER] ${declineText.trim()}`)} variant="ghost">Send</Btn>
            </div>
          </div>
        )}
      </Shell>
    );
  }

  /* SECRET */
  if (popup.type === 'secret') {
    const fields = popup.fields || [];
    const allFilled = fields.every((f) => (secretValues[f.key] || '').trim().length > 0);
    const submit = async () => {
      if (!allFilled) return;
      if (onSaveSecrets) {
        setSavingSecrets(true);
        const ok = await onSaveSecrets(secretValues);
        setSavingSecrets(false);
        if (!ok) { onRespond(`[KEYS — FAILED] Could not save the keys, try again.`); return; }
      }
      onRespond(`[KEYS PROVIDED] ${fields.map((f) => f.key).join(', ')} — securely saved. Continue.`);
    };
    return (
      <Shell
        icon={<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="var(--text-secondary)" strokeWidth="2"><rect x="3" y="11" width="18" height="11" rx="2" /><path d="M7 11V7a5 5 0 0 1 10 0v4" strokeLinecap="round" strokeLinejoin="round" /></svg>}
        label="Secure information"
        labelColor="var(--teal)"
        borderColor="var(--teal-subtle-border)"
      >
        <div className="px-4 py-3 space-y-2.5">
          {title && <p className="text-[13px] font-semibold" style={{ color: 'var(--text-primary)' }}>{title}</p>}
          {message && <p className="text-[12px] leading-relaxed" style={{ color: 'var(--text-muted)' }}>{message}</p>}
          {fields.map((f) => (
            <div key={f.key}>
              <label className="text-[11px] block mb-1" style={{ color: 'var(--text-dim)' }}>{f.label}</label>
              <input
                type="password"
                value={secretValues[f.key] || ''}
                onChange={(e) => setSecretValues((p) => ({ ...p, [f.key]: e.target.value }))}
                placeholder={f.placeholder || '••••••••'}
                autoComplete="off"
                className="w-full h-8 px-3 rounded-lg text-[12px] outline-none"
                style={{ background: 'var(--surface-3)', border: '1px solid var(--border-default)', color: 'var(--text-muted)' }}
              />
            </div>
          ))}
          <p className="text-[10px]" style={{ color: 'var(--text-ghost)' }}>🔒 Server-side encrypted — never displayed or written in the chat, regardless of the type of information (key, password, identifier…).</p>
        </div>
        <div className="px-4 py-3 flex items-center gap-2" style={{ borderTop: '1px solid var(--border-subtle)' }}>
          <button
            onClick={submit}
            disabled={!allFilled || savingSecrets}
            className="h-8 px-4 rounded-lg text-[12px] font-medium flex items-center gap-1.5"
            style={{ background: 'var(--btn-primary-bg)', color: 'var(--btn-primary-fg)', opacity: allFilled && !savingSecrets ? 1 : 0.5, cursor: allFilled && !savingSecrets ? 'pointer' : 'not-allowed' }}
          >
            <Check /> {savingSecrets ? 'Saving…' : (popup.confirmLabel || 'Save')}
          </button>
          <Btn onClick={() => onRespond(`[KEYS DECLINED] The user is not providing the keys right now.`)} variant="ghost">Later</Btn>
        </div>
      </Shell>
    );
  }

  /* DELETE SECRET */
  if (popup.type === 'delete_secret') {
    const keys = popup.keys || [];
    const confirmDelete = async () => {
      if (!keys.length) return;
      if (onDeleteSecrets) {
        setDeletingSecrets(true);
        const ok = await onDeleteSecrets(keys);
        setDeletingSecrets(false);
        if (!ok) { onRespond(`[KEY DELETION — FAILED] Could not delete ${keys.join(', ')}, try again.`); return; }
      }
      onRespond(`[KEYS DELETED] ${keys.join(', ')} have been deleted.`);
    };
    return (
      <Shell
        icon={<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="var(--red, #ef4444)" strokeWidth="2"><path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2m3 0-1 14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2L4 6" strokeLinecap="round" strokeLinejoin="round" /></svg>}
        label="Delete key"
        labelColor="var(--red, #ef4444)"
        borderColor="var(--border-default)"
      >
        <div className="px-4 py-3 space-y-2">
          {title && <p className="text-[13px] font-semibold" style={{ color: 'var(--text-primary)' }}>{title}</p>}
          {message && <p className="text-[12px] leading-relaxed" style={{ color: 'var(--text-muted)' }}>{message}</p>}
          {keys.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {keys.map((k) => (
                <span key={k} className="text-[11px] px-2 py-1 rounded-md font-mono" style={{ background: 'var(--surface-3)', color: 'var(--text-muted)' }}>{k}</span>
              ))}
            </div>
          )}
        </div>
        <div className="px-4 py-3 flex items-center gap-2" style={{ borderTop: '1px solid var(--border-subtle)' }}>
          <button
            onClick={confirmDelete}
            disabled={deletingSecrets}
            className="h-8 px-4 rounded-lg text-[12px] font-medium flex items-center gap-1.5"
            style={{ background: '#ef4444', color: '#fff', opacity: deletingSecrets ? 0.6 : 1, cursor: deletingSecrets ? 'not-allowed' : 'pointer' }}
          >
            {deletingSecrets ? 'Deleting…' : (popup.confirmLabel || 'Delete')}
          </button>
          <Btn onClick={() => onRespond(`[SUPPRESSION ANNULÉE] L'utilisateur garde ${keys.join(', ')}.`)} variant="ghost">Cancel</Btn>
        </div>
      </Shell>
    );
  }

  /* RECAP */
  if (popup.type === 'recap') {
    return (
      <Shell
        icon={<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="var(--text-secondary)" strokeWidth="2"><path d="M9 11l3 3L22 4M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11" strokeLinecap="round" strokeLinejoin="round" /></svg>}
        label="Summary — to confirm"
        labelColor="var(--teal)"
        borderColor="var(--teal-subtle-border)"
      >
        <div className="px-4 py-3">
          {title && <p className="text-[13px] font-semibold mb-1" style={{ color: 'var(--text-primary)' }}>{title}</p>}
          {message && <p className="text-[12px] leading-relaxed mb-2" style={{ color: 'var(--text-muted)' }}>{message}</p>}
          <div className="rounded-lg divide-y" style={{ background: 'var(--surface-3)', border: '1px solid var(--border-default)' }}>
            {(popup.items || []).map((it, i) => (
              <div key={i} className="px-3 py-2 flex items-center justify-between gap-3">
                <span className="text-[12px]" style={{ color: 'var(--text-muted)' }}>{it.label}</span>
                {it.value && <span className="text-[12px] font-medium text-right" style={{ color: 'var(--text-primary)' }}>{it.value}</span>}
              </div>
            ))}
          </div>
        </div>
        <div className="px-4 py-3 flex items-center gap-2" style={{ borderTop: '1px solid var(--border-subtle)' }}>
          <Btn onClick={() => onRespond(`[RECAP CONFIRMED] Everything looks good, execute.`)}><Check /> {popup.confirmLabel || 'Confirm all'}</Btn>
          {!declineMode ? (
            <Btn onClick={() => setDeclineMode(true)} variant="ghost">{popup.cancelLabel || 'Edit'}</Btn>
          ) : null}
        </div>
        {declineMode && (
          <div className="px-4 pb-3">
            <textarea
              value={declineText}
              onChange={(e) => setDeclineText(e.target.value)}
              autoFocus
              placeholder="What should I change in this plan?"
              className="w-full h-16 px-3 py-2 rounded-lg text-[12px] outline-none resize-none"
              style={{ background: 'var(--surface-3)', border: '1px solid var(--border-default)', color: 'var(--text-muted)' }}
              onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey && declineText.trim()) { e.preventDefault(); onRespond(`[RÉCAP À MODIFIER] ${declineText.trim()}`); } }}
            />
            <div className="mt-2">
              <Btn onClick={() => declineText.trim() && onRespond(`[RÉCAP À MODIFIER] ${declineText.trim()}`)} variant="ghost">Send</Btn>
            </div>
          </div>
        )}
      </Shell>
    );
  }

  /* PROGRESS (non-blocking) */
  if (popup.type === 'progress') {
    const pct = typeof popup.percent === 'number' ? Math.max(0, Math.min(100, popup.percent)) : null;
    return (
      <Shell
        icon={<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="var(--text-secondary)" strokeWidth="2" className="animate-spin"><path d="M21 12a9 9 0 1 1-6.219-8.56" strokeLinecap="round" /></svg>}
        label="In progress"
        labelColor="var(--teal)"
      >
        <div className="px-4 py-3">
          {title && <p className="text-[13px] font-semibold mb-1" style={{ color: 'var(--text-primary)' }}>{title}</p>}
          {message && <p className="text-[12px] leading-relaxed mb-2" style={{ color: 'var(--text-muted)' }}>{message}</p>}
          {pct !== null && (
            <div className="h-1.5 rounded-full overflow-hidden" style={{ background: 'var(--surface-4)' }}>
              <div className="h-full rounded-full transition-all" style={{ width: `${pct}%`, background: 'var(--teal)' }} />
            </div>
          )}
        </div>
        {(popup.canPause || popup.canStop) && (
          <div className="px-4 py-3 flex items-center gap-2" style={{ borderTop: '1px solid var(--border-subtle)' }}>
            {popup.canPause && <Btn onClick={() => onRespond(`[PAUSE] Put the task on pause.`)} variant="ghost">Pause</Btn>}
            {popup.canStop && <Btn onClick={() => onRespond(`[STOP] Stop the current task.`)} variant="danger">Stop</Btn>}
          </div>
        )}
      </Shell>
    );
  }

  /* INFO (non-blocking, auto-dismiss) */
  if (popup.type === 'info') {
    return (
      <Shell
        icon={<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="var(--text-secondary)" strokeWidth="2"><circle cx="12" cy="12" r="10" /><path d="M12 16v-4M12 8h.01" strokeLinecap="round" /></svg>}
        label="Info"
        labelColor="var(--teal)"
      >
        <div className="px-4 py-3 flex items-start justify-between gap-3">
          <div>
            {title && <p className="text-[13px] font-semibold mb-0.5" style={{ color: 'var(--text-primary)' }}>{title}</p>}
            <p className="text-[12px] leading-relaxed" style={{ color: 'var(--text-muted)' }}>{message}</p>
          </div>
          <button onClick={onDismiss} className="text-[11px] shrink-0" style={{ color: 'var(--text-ghost)' }}>✕</button>
        </div>
      </Shell>
    );
  }

  return null;
}
