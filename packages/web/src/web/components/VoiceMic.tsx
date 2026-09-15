import * as React from 'react';

export function VoiceMicButton({ isListening, onClick, size = 7 }: { isListening: boolean; onClick: () => void; size?: number }) {
  const dim = size * 4;
  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
      className={`voice-mic-btn flex items-center justify-center rounded-full transition-all${isListening ? ' voice-mic-active' : ''}`}
      style={{
        width: dim,
        height: dim,
        // Jamais compressible : dans une rangée flex serrée (barre de prompt
        // rétrécie), le bouton doit garder son disque, pas devenir un ovale.
        flexShrink: 0,
        background: isListening ? 'var(--text-primary, #fff)' : 'var(--surface-4, #333)',
        color: isListening ? 'var(--surface-0, #000)' : 'var(--text-ghost, #888)',
        border: 'none',
        cursor: 'pointer',
        WebkitTapHighlightColor: 'transparent',
        touchAction: 'manipulation',
      }}
      title={isListening ? 'Stop dictation' : 'Voice dictation'}
      aria-label={isListening ? 'Stop dictation' : 'Voice dictation'}
      aria-pressed={isListening}
    >
      {isListening ? (
        <svg width={size * 1.7} height={size * 1.7} viewBox="0 0 12 12" fill="none">
          <rect x="2.5" y="2.5" width="7" height="7" rx="2" fill="currentColor" />
        </svg>
      ) : (
        <svg width={size * 1.85} height={size * 1.85} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <rect x="9" y="1" width="6" height="12" rx="3" />
          <path d="M5 10a7 7 0 0 0 14 0" />
          <line x1="12" y1="17" x2="12" y2="21" />
          <line x1="8" y1="21" x2="16" y2="21" />
        </svg>
      )}
    </button>
  );
}

/**
 * Full-panel live-dictation UI. Overlays the input area while listening:
 * a large stop button, an elapsed timer, a live audio visualizer, and a
 * status label. Cleaner, calmer look inspired by the AIVoiceInput design.
 */
const VIS_BARS = 48;

export function VoiceOverlay({
  voiceBars,
  onStop,
}: {
  voiceBars: number[];
  onStop?: () => void;
}) {
  const [time, setTime] = React.useState(0);
  const [seeds] = React.useState<number[]>(() =>
    Array.from({ length: VIS_BARS }, () => Math.random())
  );

  React.useEffect(() => {
    const id = setInterval(() => setTime((t) => t + 1), 1000);
    return () => clearInterval(id);
  }, []);

  // Overall mic intensity (0..1) drives the visualizer amplitude live.
  const intensity = voiceBars.length
    ? Math.min(1, voiceBars.reduce((a, b) => a + b, 0) / voiceBars.length + 0.15)
    : 0.4;

  const fmt = (s: number) =>
    `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;

  return (
    <div className="voice-panel" aria-live="polite">
      <button
        type="button"
        className="voice-panel-btn"
        onClick={(e) => {
          e.stopPropagation();
          onStop?.();
        }}
        title="Stop dictation"
        aria-label="Stop dictation"
      >
        <span className="voice-panel-square" />
      </button>

      <span className="voice-panel-time">{fmt(time)}</span>

      <div className="voice-panel-vis">
        {seeds.map((seed, i) => {
          // Center bars react a bit more for a natural waveform shape.
          const center = 1 - Math.abs(i - VIS_BARS / 2) / (VIS_BARS / 2);
          const h = 20 + seed * 80 * (0.5 + center * 0.5) * (0.4 + intensity * 0.6);
          return (
            <span
              key={i}
              className="voice-panel-bar"
              style={{ height: `${Math.min(100, h)}%`, animationDelay: `${i * 0.05}s` }}
            />
          );
        })}
      </div>

      <p className="voice-panel-label">Listening...</p>
    </div>
  );
}

/** Banner shown when mic permission is denied — with retry + instructions */
export function MicDeniedBanner({ onRetry, onDismiss }: { onRetry: () => void; onDismiss: () => void }) {
  return (
    <div style={{
      position: 'absolute',
      bottom: '100%',
      left: 0,
      right: 0,
      marginBottom: 8,
      padding: '12px 16px',
      borderRadius: 12,
      background: 'var(--surface-3, #1a1a24)',
      border: '1px solid var(--border-default, #2a2a3a)',
      boxShadow: '0 4px 24px rgba(0,0,0,0.3)',
      zIndex: 50,
      animation: 'micBannerIn 0.2s ease-out',
    }}>
      <style>{`@keyframes micBannerIn { from { opacity:0; transform:translateY(8px); } to { opacity:1; transform:translateY(0); } }`}</style>
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
        <div style={{
          width: 32, height: 32, borderRadius: 8,
          background: 'rgba(239,68,68,0.15)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          flexShrink: 0,
        }}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#ef4444" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <rect x="9" y="1" width="6" height="12" rx="3" />
            <line x1="1" y1="1" x2="23" y2="23" />
          </svg>
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <p style={{ margin: 0, fontSize: 13, fontWeight: 600, color: 'var(--text-primary, #e2e8f0)' }}>
            Microphone blocked
          </p>
          <p style={{ margin: '4px 0 0', fontSize: 12, color: 'var(--text-muted, #94a3b8)', lineHeight: 1.4 }}>
            Click the 🔒 icon in the address bar → allow the microphone → then try again.
          </p>
          <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
            <button
              onClick={onRetry}
              style={{
                padding: '6px 14px', borderRadius: 8, border: 'none', cursor: 'pointer',
                fontSize: 12, fontWeight: 600,
                background: 'var(--btn-primary-bg)', color: 'var(--btn-primary-fg)',
              }}
            >
              Retry
            </button>
            <button
              onClick={onDismiss}
              style={{
                padding: '6px 14px', borderRadius: 8, border: '1px solid var(--border-default, #2a2a3a)',
                cursor: 'pointer', fontSize: 12, fontWeight: 500,
                background: 'transparent', color: 'var(--text-muted, #94a3b8)',
              }}
            >
              Close
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
