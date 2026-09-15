// Velbaz Icon — Grey text that glows/illuminates when AI is working

type IconState = 'idle' | 'thinking' | 'coding' | 'designing' | 'analyzing' | 'building' | 'done';

interface VelbazIconProps {
  state?: IconState;
  size?: number;
  className?: string;
}

export function VelbazIcon({ state = 'idle', size = 24, className = '' }: VelbazIconProps) {
  const isActive = state !== 'idle' && state !== 'done';
  const width = size * 2.8;
  const id = `si-${Math.random().toString(36).slice(2, 7)}`;

  return (
    <div
      className={`velbaz-icon ${className}`}
      style={{
        width,
        height: size,
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        flexShrink: 0,
      }}
    >
      <svg viewBox="0 0 140 50" width={width} height={size} fill="none">
        <defs>
          {isActive && (
            <filter id={`${id}-glow`} x="-20%" y="-20%" width="140%" height="140%">
              <feGaussianBlur in="SourceGraphic" stdDeviation="2" result="blur" />
              <feMerge>
                <feMergeNode in="blur" />
                <feMergeNode in="SourceGraphic" />
              </feMerge>
            </filter>
          )}
        </defs>

        <text
          x="70"
          y="35"
          textAnchor="middle"
          fontFamily="'Inter', 'SF Pro Display', -apple-system, system-ui, sans-serif"
          fontWeight="600"
          fontSize="32"
          letterSpacing="1"
          fill={isActive ? '#ffffff' : '#888888'}
          filter={isActive ? `url(#${id}-glow)` : undefined}
        >
          {isActive && (
            <animate
              attributeName="fill"
              values="#888888;#ffffff;#888888"
              dur="2s"
              repeatCount="indefinite"
              calcMode="spline"
              keySplines="0.4 0 0.6 1;0.4 0 0.6 1"
            />
          )}
          velbaz
        </text>
      </svg>
    </div>
  );
}

// Detect icon state from build context
export function detectIconState(model?: string, text?: string): IconState {
  if (!model && !text) return 'idle';
  const t = (text || '').toLowerCase();
  const m = (model || '').toLowerCase();

  if (t.includes('finaliz') || t.includes('live') || t.includes('done') || t.includes('complete')) return 'done';
  if (t.includes('website') || t.includes('building') || t.includes('engineering') || m.includes('opus')) return 'coding';
  if (t.includes('logo') || t.includes('image') || t.includes('design') || t.includes('visual') || m.includes('banana')) return 'designing';
  if (t.includes('analyz') || t.includes('scan') || t.includes('seo') || t.includes('research')) return 'analyzing';
  if (t.includes('deploy') || t.includes('agent') || t.includes('heartbeat')) return 'building';
  if (t.includes('think') || t.includes('plan') || t.includes('strateg') || m.includes('gemini')) return 'thinking';
  
  return 'thinking';
}
