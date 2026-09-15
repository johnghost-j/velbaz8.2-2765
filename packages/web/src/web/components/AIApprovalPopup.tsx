import { useState, useEffect } from 'react';

interface AIApprovalPopupProps {
  decision: string;
  agentRole: string;
  onAccept: () => void;
  onDecline: (reason: string) => void;
}

export function AIApprovalPopup({ decision, agentRole, onAccept, onDecline }: AIApprovalPopupProps) {
  const [showDeclineInput, setShowDeclineInput] = useState(false);
  const [declineText, setDeclineText] = useState('');

  const roleName = agentRole === 'design' ? 'Design Agent'
    : agentRole === 'engineer' || agentRole === 'engineering' ? 'Engineering Agent'
    : agentRole === 'ceo' ? 'CEO Agent'
    : agentRole === 'marketing' ? 'Marketing Agent'
    : agentRole === 'supply_chain' ? 'Supply Chain Agent'
    : agentRole || 'Agent';

  return (
    <div className="mb-3 rounded-xl overflow-hidden question-popup-enter"
      style={{
        background: 'var(--surface-2)',
        border: '1px solid var(--teal-subtle-border)',
        boxShadow: '0 -4px 24px rgba(0,0,0,0.15)',
      }}
    >
      {/* Header */}
      <div className="px-4 py-2.5 flex items-center gap-2" style={{ borderBottom: '1px solid var(--border-subtle)' }}>
        <div className="w-5 h-5 rounded-md flex items-center justify-center" style={{ background: 'var(--teal-bg)' }}>
          <svg width="11" height="11" viewBox="0 0 16 16" fill="none" stroke="var(--text-secondary)" strokeWidth="1.5">
            <path d="M8 1L2 4.5V11.5L8 15L14 11.5V4.5L8 1Z"/>
          </svg>
        </div>
        <span className="text-[11px] font-semibold" style={{ color: 'var(--teal)' }}>Approval Required</span>
        <span className="text-[10px] ml-auto" style={{ color: 'var(--text-ghost)' }}>{roleName}</span>
      </div>

      {/* Decision text */}
      <div className="px-4 py-3">
        <p className="text-[12px] leading-relaxed" style={{ color: 'var(--text-muted)' }}>{decision}</p>
      </div>

      {/* Actions */}
      <div className="px-4 py-3" style={{ borderTop: '1px solid var(--border-subtle)' }}>
        {!showDeclineInput ? (
          <div className="flex items-center gap-2">
            <button onClick={onAccept}
              className="h-8 px-4 rounded-lg text-[12px] font-medium flex items-center gap-1.5 transition-opacity"
              style={{ background: 'var(--btn-primary-bg)', color: 'var(--btn-primary-fg)' }}
              onMouseEnter={e => e.currentTarget.style.opacity = '0.85'}
              onMouseLeave={e => e.currentTarget.style.opacity = '1'}
            >
              <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="2"><path d="M2 6L5 9L10 3"/></svg>
              Accept
            </button>
            <button onClick={() => setShowDeclineInput(true)}
              className="h-8 px-4 rounded-lg text-[12px] font-medium transition-colors"
              style={{ background: 'var(--surface-4)', color: 'var(--text-dim)', border: '1px solid var(--border-default)' }}
              onMouseEnter={e => { e.currentTarget.style.background = 'var(--red-subtle-bg)'; e.currentTarget.style.color = 'var(--red-text)'; }}
              onMouseLeave={e => { e.currentTarget.style.background = 'var(--surface-4)'; e.currentTarget.style.color = 'var(--text-dim)'; }}
            >
              Decline
            </button>
          </div>
        ) : (
          <div>
            <p className="text-[11px] mb-2" style={{ color: 'var(--text-dim)' }}>Explain what you'd prefer instead:</p>
            <textarea
              value={declineText}
              onChange={e => setDeclineText(e.target.value)}
              placeholder="I'd rather..."
              autoFocus
              className="w-full h-16 px-3 py-2 rounded-lg text-[12px] outline-none resize-none"
              style={{ background: 'var(--surface-3)', border: '1px solid var(--border-default)', color: 'var(--text-muted)' }}
              onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey && declineText.trim()) { e.preventDefault(); onDecline(declineText.trim()); } }}
            />
            <div className="flex items-center gap-2 mt-2">
              <button onClick={() => { if (declineText.trim()) onDecline(declineText.trim()); }}
                className="h-8 px-4 rounded-lg text-[12px] font-medium transition-colors"
                style={{
                  background: declineText.trim() ? 'var(--red-subtle-bg)' : 'var(--surface-3)',
                  color: declineText.trim() ? 'var(--red-text)' : 'var(--text-ghost)',
                  border: `1px solid ${declineText.trim() ? 'var(--red-subtle-border)' : 'var(--border-default)'}`,
                  opacity: declineText.trim() ? 1 : 0.5,
                  cursor: declineText.trim() ? 'pointer' : 'not-allowed',
                }}
              >
                Send & Decline
              </button>
              <button onClick={() => { setShowDeclineInput(false); setDeclineText(''); }}
                className="h-8 px-3 rounded-lg text-[12px] transition-colors"
                style={{ color: 'var(--text-ghost)' }}
              >
                Cancel
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

/** Check if AI approval mode is enabled */
export function isAIApprovalEnabled(): boolean {
  try { return localStorage.getItem('velbaz_ai_approval') === 'true'; } catch { return false; }
}
