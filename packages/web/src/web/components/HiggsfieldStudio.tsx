import React, { useCallback, useEffect, useRef, useState } from 'react';

// ─────────────────────────────────────────────────────────────────────────────
// Media Studio (Higgsfield) — modal de génération pilotée depuis le chat.
// Cartes interactives : Image (Soul), Image→Vidéo (DoP), Talking Avatar (Speak).
// Sélecteurs de style / motion / avatar chargés depuis l'API Higgsfield.
// Le job tourne côté serveur (fire-and-forget + polling) et le résultat
// s'affiche à la fois ici (aperçu inline) et dans le fil du chat.
// Design "soft premium" : coins arrondis, ombres diffuses, boutons pilule.
// ─────────────────────────────────────────────────────────────────────────────

type Kind = 'image' | 'image_to_video' | 'speak';

interface Motion { id: string; name: string; preview_url?: string; thumbnail_url?: string; }
interface SoulStyle { id: string; name: string; preview_url?: string; thumbnail_url?: string; }
interface SoulIdItem { id: string; name: string; preview_url?: string; thumbnail_url?: string; }

export interface HiggsfieldStudioProps {
  companyId: string;
  sessionId: string;
  open: boolean;
  onClose: () => void;
  authHeaders: () => Record<string, string>;
  /** Upsert an assistant message in the chat feed (id stable = hf-<jobId>). */
  onLiveMessage: (id: string, content: string) => void;
  /** Called when token balance changes so the parent can refresh it. */
  onTokens?: (balance: number) => void;
}

const SIZES: { key: string; label: string }[] = [
  { key: 'SQUARE_1536x1536', label: 'Square 1:1' },
  { key: 'PORTRAIT_1152x2048', label: 'Portrait 9:16' },
  { key: 'PORTRAIT_1536x2048', label: 'Portrait 3:4' },
  { key: 'LANDSCAPE_2048x1152', label: 'Landscape 16:9' },
  { key: 'LANDSCAPE_2048x1536', label: 'Landscape 4:3' },
];

const c = {
  surface0: 'var(--surface-0, #0d0d12)',
  surface1: 'var(--surface-1, #16161d)',
  surface2: 'var(--surface-2, #1c1c25)',
  surface3: 'var(--surface-3, #24242f)',
  surface4: 'var(--surface-4, #2c2c38)',
  border: 'var(--border, rgba(255,255,255,0.08))',
  text: 'var(--text-primary, #f2f2f5)',
  textSec: 'var(--text-secondary, #d0d0d8)',
  textDim: 'var(--text-dim, #9a9aa5)',
  textFaint: 'var(--text-faint, #6b6b76)',
  accent: 'var(--accent, #6C5BFF)',
};

export function HiggsfieldStudio(props: HiggsfieldStudioProps) {
  const { companyId, sessionId, open, onClose, authHeaders, onLiveMessage, onTokens } = props;

  const [configured, setConfigured] = useState<boolean | null>(null);
  const [kind, setKind] = useState<Kind>('image');

  // shared
  const [prompt, setPrompt] = useState('');
  const [preview, setPreview] = useState(true); // aperçu sans crédit (défaut ON)
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{ status: string; outputs: string[]; kind: Kind } | null>(null);
  const [progress, setProgress] = useState<string>('');

  // image
  const [size, setSize] = useState('PORTRAIT_1152x2048');
  const [quality, setQuality] = useState<'HD' | 'SD'>('HD');
  const [batch, setBatch] = useState<1 | 4>(1);
  const [styleId, setStyleId] = useState<string | null>(null);
  const [soulId, setSoulId] = useState<string | null>(null);
  const [styles, setStyles] = useState<SoulStyle[]>([]);
  const [soulIds, setSoulIds] = useState<SoulIdItem[]>([]);

  // image → video
  const [imageUrl, setImageUrl] = useState('');
  const [endImageUrl, setEndImageUrl] = useState('');
  const [motions, setMotions] = useState<Motion[]>([]);
  const [selMotions, setSelMotions] = useState<string[]>([]);
  const [videoModel, setVideoModel] = useState<'TURBO' | 'LITE' | 'STANDARD'>('TURBO');

  // speak
  const [audioUrl, setAudioUrl] = useState('');
  const [speakDuration, setSpeakDuration] = useState<'SHORT' | 'MEDIUM' | 'LONG'>('SHORT');
  const [speakQuality, setSpeakQuality] = useState<'MID' | 'HIGH'>('MID');

  const pollRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const base = `/api/companies/${companyId}/higgsfield`;

  // ── Load config + discovery lists on open ──────────────────────────────────
  useEffect(() => {
    if (!open || !companyId) return;
    let alive = true;
    fetch(`${base}/status`, { headers: authHeaders() })
      .then(r => r.json()).then(d => { if (alive) setConfigured(!!d.configured); })
      .catch(() => { if (alive) setConfigured(false); });
    return () => { alive = false; };
  }, [open, companyId]);

  useEffect(() => {
    if (!open || configured !== true) return;
    let alive = true;
    const h = authHeaders();
    if (kind === 'image' && styles.length === 0) {
      fetch(`${base}/soul-styles`, { headers: h }).then(r => r.json())
        .then(d => { if (alive) setStyles(d.styles || []); }).catch(() => {});
      fetch(`${base}/soul-ids`, { headers: h }).then(r => r.json())
        .then(d => { if (alive) setSoulIds(d.items || d.soul_ids || []); }).catch(() => {});
    }
    if (kind === 'image_to_video' && motions.length === 0) {
      fetch(`${base}/motions`, { headers: h }).then(r => r.json())
        .then(d => { if (alive) setMotions(d.motions || []); }).catch(() => {});
    }
    return () => { alive = false; };
  }, [open, configured, kind]);

  useEffect(() => () => { if (pollRef.current) clearTimeout(pollRef.current); }, []);

  const poll = useCallback((jobId: string, k: Kind) => {
    const tick = async () => {
      try {
        const r = await fetch(`${base}/jobs/${jobId}`, { headers: authHeaders() });
        const d = await r.json();
        const job = d.job || d;
        const status = job.status as string;
        setProgress(status === 'queued' ? "Queued…" : status === 'in_progress' ? 'Generating…' : status);
        if (status === 'completed') {
          const outputs: string[] = job.outputUrls ? JSON.parse(job.outputUrls) : (job.outputUrl ? [job.outputUrl] : []);
          setResult({ status, outputs, kind: k });
          setBusy(false);
          const isVid = k !== 'image';
          const tokens = outputs.map(u => isVid ? `[VIDEO:${u}]` : `[IMG:${u}]`).join('\n');
          const label = isVid ? '🎬 Video generated' : '🖼️ Image generated';
          onLiveMessage(`hf-${jobId}`, `${label} :\n\n${tokens}`);
          return;
        }
        if (status === 'failed' || status === 'nsfw' || status === 'canceled') {
          setError(job.error || (status === 'nsfw' ? 'Rejected by moderation (NSFW)' : 'Generation failed'));
          setBusy(false);
          onLiveMessage(`hf-${jobId}`, `⚠️ Generation ${status}${job.error ? ' — ' + job.error : ''}`);
          return;
        }
        pollRef.current = setTimeout(tick, 2500);
      } catch {
        pollRef.current = setTimeout(tick, 3500);
      }
    };
    tick();
  }, [base]);

  const submit = useCallback(async () => {
    setError(null); setResult(null); setProgress('Sending…'); setBusy(true);
    const body: Record<string, unknown> = { kind, sessionId, prompt, preview };
    if (kind === 'image') {
      Object.assign(body, { size, quality, batch, styleId: styleId || undefined, soulId: soulId || undefined });
    } else if (kind === 'image_to_video') {
      if (!imageUrl.trim()) { setError("Add the URL of a start image."); setBusy(false); return; }
      Object.assign(body, {
        imageUrl: imageUrl.trim(),
        endImageUrl: endImageUrl.trim() || undefined,
        model: videoModel,
        motions: selMotions.map(id => ({ id, strength: 0.8 })),
      });
    } else if (kind === 'speak') {
      if (!imageUrl.trim() || !audioUrl.trim()) { setError("Image + audio (WAV) required."); setBusy(false); return; }
      Object.assign(body, { imageUrl: imageUrl.trim(), audioUrl: audioUrl.trim(), duration: speakDuration, quality: speakQuality });
    }
    try {
      const r = await fetch(`${base}/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify(body),
      });
      const d = await r.json();
      if (!r.ok) { setError(d.error || 'Generation error'); setBusy(false); return; }
      if (typeof d.tokenBalance === 'number') onTokens?.(d.tokenBalance);
      const promptLine = prompt.trim() ? `"${prompt.trim()}"` : (kind === 'speak' ? 'talking avatar' : 'media');
      onLiveMessage(`hf-${d.jobId}`, `⏳ Higgsfield generation (${kind === 'image' ? 'image' : kind === 'speak' ? 'avatar' : 'video'}) : ${promptLine}…`);
      onClose();
      poll(d.jobId, kind);
    } catch (e: any) {
      setError(String(e?.message || e)); setBusy(false);
    }
  }, [kind, sessionId, prompt, preview, size, quality, batch, styleId, soulId, imageUrl, endImageUrl, videoModel, selMotions, audioUrl, speakDuration, speakQuality, base]);

  if (!open) return null;

  const canSubmit = !busy && configured === true && (
    kind === 'image' ? prompt.trim().length > 0
      : kind === 'image_to_video' ? imageUrl.trim().length > 0
        : imageUrl.trim().length > 0 && audioUrl.trim().length > 0
  );

  const tabs: { k: Kind; label: string; icon: React.ReactNode }[] = [
    { k: 'image', label: 'Image', icon: <IconImage /> },
    { k: 'image_to_video', label: 'Image → Video', icon: <IconVideo /> },
    { k: 'speak', label: 'Talking Avatar', icon: <IconSpeak /> },
  ];

  return (
    <div
      className="fixed inset-0 z-[10000] flex items-center justify-center p-4"
      style={{ background: 'rgba(0,0,0,0.55)', backdropFilter: 'blur(6px)' }}
      onClick={onClose}
    >
      <div
        className="w-full max-w-[560px] max-h-[88vh] overflow-y-auto flex flex-col"
        style={{
          background: c.surface1,
          border: `1px solid ${c.border}`,
          borderRadius: 22,
          boxShadow: '0 24px 80px rgba(0,0,0,0.5)',
        }}
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 pt-5 pb-3">
          <div className="flex items-center gap-2.5">
            <div className="flex items-center justify-center rounded-xl" style={{ width: 34, height: 34, background: `color-mix(in srgb, ${c.accent} 18%, transparent)` }}>
              <IconSpark />
            </div>
            <div>
              <div className="text-[15px] font-semibold" style={{ color: c.text }}>Media Studio</div>
              <div className="text-[11.5px]" style={{ color: c.textFaint }}>Powered by Higgsfield AI</div>
            </div>
          </div>
          <button onClick={onClose} className="rounded-full flex items-center justify-center transition-opacity hover:opacity-70" style={{ width: 30, height: 30, background: c.surface3, color: c.textDim }}>✕</button>
        </div>

        {configured === false && (
          <div className="mx-6 mb-4 px-4 py-3 rounded-2xl text-[13px]" style={{ background: 'color-mix(in srgb, #ff6b6b 12%, transparent)', color: '#ffb3b3' }}>
            Higgsfield is not configured. Add <b>HF_API_KEY</b> and <b>HF_API_SECRET</b> in the server settings.
          </div>
        )}

        {/* Tabs */}
        <div className="px-6">
          <div className="flex gap-1.5 p-1 rounded-2xl" style={{ background: c.surface2 }}>
            {tabs.map(t => (
              <button
                key={t.k}
                onClick={() => { setKind(t.k); setResult(null); setError(null); }}
                className="flex-1 flex items-center justify-center gap-1.5 py-2 rounded-xl text-[12.5px] font-medium transition-all"
                style={{
                  background: kind === t.k ? c.surface4 : 'transparent',
                  color: kind === t.k ? c.text : c.textDim,
                }}
              >
                {t.icon}{t.label}
              </button>
            ))}
          </div>
        </div>

        {/* Body */}
        <div className="px-6 py-4 flex flex-col gap-4">
          {/* Prompt */}
          {kind !== 'speak' && (
            <Field label={kind === 'image' ? 'Describe your image' : 'Camera movement / action'}>
              <textarea
                value={prompt}
                onChange={e => setPrompt(e.target.value)}
                rows={3}
                placeholder={kind === 'image' ? 'E.g. cosmetic product packshot, soft light, pastel background…' : 'E.g. slow forward dolly, light shimmering…'}
                className="w-full text-[13.5px] rounded-2xl px-4 py-3 resize-none focus:outline-none"
                style={{ background: c.surface2, color: c.textSec, border: `1px solid ${c.border}` }}
              />
            </Field>
          )}

          {/* ── IMAGE ── */}
          {kind === 'image' && (
            <>
              <Field label="Format">
                <div className="flex flex-wrap gap-2">
                  {SIZES.map(s => <Pill key={s.key} active={size === s.key} onClick={() => setSize(s.key)}>{s.label}</Pill>)}
                </div>
              </Field>
              <div className="flex gap-4">
                <Field label="Quality">
                  <div className="flex gap-2">
                    <Pill active={quality === 'HD'} onClick={() => setQuality('HD')}>HD 1080p</Pill>
                    <Pill active={quality === 'SD'} onClick={() => setQuality('SD')}>SD</Pill>
                  </div>
                </Field>
                <Field label="Count">
                  <div className="flex gap-2">
                    <Pill active={batch === 1} onClick={() => setBatch(1)}>1 image</Pill>
                    <Pill active={batch === 4} onClick={() => setBatch(4)}>4 images</Pill>
                  </div>
                </Field>
              </div>
              {styles.length > 0 && (
                <Field label="Style (optional)">
                  <ThumbRow items={styles} selected={styleId} onSelect={id => setStyleId(styleId === id ? null : id)} />
                </Field>
              )}
              {soulIds.length > 0 && (
                <Field label="Avatar / character (optional)">
                  <ThumbRow items={soulIds} selected={soulId} onSelect={id => setSoulId(soulId === id ? null : id)} />
                </Field>
              )}
            </>
          )}

          {/* ── IMAGE → VIDEO ── */}
          {kind === 'image_to_video' && (
            <>
              <Field label="Start image (URL)">
                <UrlInput value={imageUrl} onChange={setImageUrl} placeholder="https://…/image.jpg" />
              </Field>
              <Field label="End image (optional, for a transition)">
                <UrlInput value={endImageUrl} onChange={setEndImageUrl} placeholder="https://…/image-fin.jpg" />
              </Field>
              <Field label="Model">
                <div className="flex gap-2">
                  {(['TURBO', 'STANDARD', 'LITE'] as const).map(m => (
                    <Pill key={m} active={videoModel === m} onClick={() => setVideoModel(m)}>{m === 'TURBO' ? 'Turbo (fast)' : m === 'STANDARD' ? 'Standard' : 'Lite'}</Pill>
                  ))}
                </div>
              </Field>
              {motions.length > 0 && (
                <Field label="Motions (optional — multi-select)">
                  <ThumbRow
                    items={motions}
                    selectedMany={selMotions}
                    onSelect={id => setSelMotions(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id])}
                  />
                </Field>
              )}
            </>
          )}

          {/* ── SPEAK ── */}
          {kind === 'speak' && (
            <>
              <Field label="Avatar photo (URL)">
                <UrlInput value={imageUrl} onChange={setImageUrl} placeholder="https://…/avatar.jpg" />
              </Field>
              <Field label="Voice audio (URL .wav)">
                <UrlInput value={audioUrl} onChange={setAudioUrl} placeholder="https://…/voix.wav" />
              </Field>
              <Field label="Style / instruction (optional)">
                <textarea value={prompt} onChange={e => setPrompt(e.target.value)} rows={2}
                  placeholder="E.g. professional presentation, warm tone…"
                  className="w-full text-[13.5px] rounded-2xl px-4 py-3 resize-none focus:outline-none"
                  style={{ background: c.surface2, color: c.textSec, border: `1px solid ${c.border}` }} />
              </Field>
              <div className="flex gap-4">
                <Field label="Duration">
                  <div className="flex gap-2">
                    {(['SHORT', 'MEDIUM', 'LONG'] as const).map(d => (
                      <Pill key={d} active={speakDuration === d} onClick={() => setSpeakDuration(d)}>{d === 'SHORT' ? 'Short' : d === 'MEDIUM' ? 'Medium' : 'Long'}</Pill>
                    ))}
                  </div>
                </Field>
                <Field label="Quality">
                  <div className="flex gap-2">
                    <Pill active={speakQuality === 'MID'} onClick={() => setSpeakQuality('MID')}>Standard</Pill>
                    <Pill active={speakQuality === 'HIGH'} onClick={() => setSpeakQuality('HIGH')}>High</Pill>
                  </div>
                </Field>
              </div>
            </>
          )}

          {error && <div className="text-[12.5px] px-1" style={{ color: '#ff9b9b' }}>{error}</div>}
          {busy && progress && <div className="text-[12.5px] px-1" style={{ color: c.textDim }}>{progress}</div>}
        </div>

        {/* Aperçu (sans crédit) */}
        <div className="px-6 pb-1">
          <button
            onClick={() => setPreview(p => !p)}
            className="w-full flex items-center gap-3 px-4 py-3 rounded-2xl transition-all text-left"
            style={{ background: preview ? `color-mix(in srgb, ${c.accent} 12%, transparent)` : c.surface2, border: `1px solid ${preview ? `color-mix(in srgb, ${c.accent} 45%, transparent)` : c.border}` }}
          >
            <span className="shrink-0 rounded-full transition-all flex items-center" style={{ width: 38, height: 22, background: preview ? c.accent : c.surface4, padding: 2 }}>
              <span className="rounded-full bg-white transition-all" style={{ width: 18, height: 18, transform: preview ? 'translateX(16px)' : 'translateX(0)' }} />
            </span>
            <span className="flex flex-col">
              <span className="text-[12.5px] font-medium" style={{ color: c.text }}>Preview mode — no credit</span>
              <span className="text-[11px]" style={{ color: c.textFaint }}>Shows the full experience with a demo media. Does not call the paid API.</span>
            </span>
          </button>
        </div>

        {/* Footer */}
        <div className="px-6 pb-5 pt-2 flex items-center gap-3">
          <div className="text-[11.5px]" style={{ color: c.textFaint }}>
            {preview ? 'Preview · 0 credit' : `${kind === 'image' ? '2 credits' : '6 credits'}`} · result appears in the chat
          </div>
          <button
            onClick={submit}
            disabled={!canSubmit}
            className="ml-auto px-6 py-2.5 rounded-full text-[13.5px] font-semibold transition-all disabled:opacity-40"
            style={{ background: preview ? c.surface4 : c.accent, color: '#fff', boxShadow: canSubmit && !preview ? `0 8px 24px color-mix(in srgb, ${c.accent} 45%, transparent)` : 'none' }}
          >
            {busy ? 'Generating…' : preview ? "Generate preview" : 'Generate'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Small UI atoms ───────────────────────────────────────────────────────────
function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5 flex-1">
      <span className="text-[11.5px] font-medium px-1" style={{ color: c.textDim }}>{label}</span>
      {children}
    </div>
  );
}

function Pill({ active, onClick, children }: { active?: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      className="px-3.5 py-1.5 rounded-full text-[12px] font-medium transition-all"
      style={{
        background: active ? c.accent : c.surface3,
        color: active ? '#fff' : c.textDim,
      }}
    >
      {children}
    </button>
  );
}

function UrlInput({ value, onChange, placeholder }: { value: string; onChange: (v: string) => void; placeholder?: string }) {
  return (
    <input
      value={value}
      onChange={e => onChange(e.target.value)}
      placeholder={placeholder}
      className="w-full text-[13px] rounded-2xl px-4 py-2.5 focus:outline-none"
      style={{ background: c.surface2, color: c.textSec, border: `1px solid ${c.border}` }}
    />
  );
}

function ThumbRow({ items, selected, selectedMany, onSelect }: {
  items: { id: string; name: string; preview_url?: string; thumbnail_url?: string }[];
  selected?: string | null;
  selectedMany?: string[];
  onSelect: (id: string) => void;
}) {
  const isSel = (id: string) => selectedMany ? selectedMany.includes(id) : selected === id;
  return (
    <div className="flex gap-2.5 overflow-x-auto pb-1" style={{ scrollbarWidth: 'thin' }}>
      {items.map(it => {
        const img = it.thumbnail_url || it.preview_url;
        const sel = isSel(it.id);
        return (
          <button
            key={it.id}
            onClick={() => onSelect(it.id)}
            className="shrink-0 flex flex-col items-center gap-1 rounded-2xl p-1 transition-all"
            style={{ border: `2px solid ${sel ? c.accent : 'transparent'}`, background: c.surface2 }}
            title={it.name}
          >
            <div className="rounded-xl overflow-hidden flex items-center justify-center" style={{ width: 66, height: 66, background: c.surface4 }}>
              {img
                ? <img src={img} alt={it.name} className="w-full h-full object-cover" />
                : <span className="text-[10px] px-1 text-center" style={{ color: c.textFaint }}>{it.name}</span>}
            </div>
            <span className="text-[10px] max-w-[66px] truncate" style={{ color: sel ? c.text : c.textFaint }}>{it.name}</span>
          </button>
        );
      })}
    </div>
  );
}

// ── Icons ─────────────────────────────────────────────────────────────────────
function IconSpark() {
  return <svg width="18" height="18" viewBox="0 0 24 24" fill="none"><path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8L12 3z" fill="var(--accent, #6C5BFF)"/></svg>;
}
function IconImage() {
  return <svg width="14" height="14" viewBox="0 0 24 24" fill="none"><rect x="3" y="4" width="18" height="16" rx="3" stroke="currentColor" strokeWidth="1.6"/><circle cx="8.5" cy="9.5" r="1.5" fill="currentColor"/><path d="M4 17l5-4 4 3 3-2 4 3" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"/></svg>;
}
function IconVideo() {
  return <svg width="14" height="14" viewBox="0 0 24 24" fill="none"><rect x="3" y="6" width="13" height="12" rx="2.5" stroke="currentColor" strokeWidth="1.6"/><path d="M16 10l5-3v10l-5-3" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"/></svg>;
}
function IconSpeak() {
  return <svg width="14" height="14" viewBox="0 0 24 24" fill="none"><circle cx="12" cy="8" r="4" stroke="currentColor" strokeWidth="1.6"/><path d="M4 20c0-3.3 3.6-6 8-6s8 2.7 8 6" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round"/></svg>;
}
