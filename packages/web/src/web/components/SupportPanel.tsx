import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { api } from '../lib/api';

interface Msg { role: 'assistant' | 'user'; content: string }

const WELCOME: Msg = {
  role: 'assistant',
  content: "Hello! I'm the Velbaz assistant. I know the whole app and can explain and help with everything: creating a site, editing it, publishing, managing your domains, credits, plans… How can I help you?",
};

export function SupportPanel({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [mounted, setMounted] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [messages, setMessages] = useState<Msg[]>([WELCOME]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const shapeRef = useRef<HTMLDivElement>(null);

  // Mount → force a layout flush → expand circle into rounded rectangle.
  // Sans ce flush, le navigateur ne peint parfois jamais l'état « cercle »
  // et la transition d'ouverture est sautée (la popup apparaît d'un coup).
  useEffect(() => {
    if (open) {
      setMounted(true);
      return;
    }
    // Closing: collapse back to circle, then unmount.
    setExpanded(false);
    const t = window.setTimeout(() => setMounted(false), 500);
    return () => window.clearTimeout(t);
  }, [open]);

  useEffect(() => {
    if (!mounted || !open || expanded) return;
    // Enregistre l'état replié dans le navigateur AVANT d'étendre.
    void shapeRef.current?.offsetHeight;
    const raf = requestAnimationFrame(() => setExpanded(true));
    return () => cancelAnimationFrame(raf);
  }, [mounted, open, expanded]);

  useEffect(() => {
    if (expanded) setTimeout(() => inputRef.current?.focus(), 350);
  }, [expanded]);

  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [messages, loading]);

  const send = async () => {
    const text = input.trim();
    if (!text || loading) return;
    const history = messages.map(m => ({ role: m.role, content: m.content }));
    setMessages(m => [...m, { role: 'user', content: text }]);
    setInput('');
    setLoading(true);
    try {
      const res: any = await api.support.chat(text, history);
      setMessages(m => [...m, { role: 'assistant', content: res?.reply || "I couldn't answer, try again." }]);
    } catch {
      setMessages(m => [...m, { role: 'assistant', content: "Sorry, something went wrong. Try again in a moment." }]);
    } finally {
      setLoading(false);
    }
  };

  if (!mounted) return null;

  return createPortal(
    <div className="fixed inset-0 z-[10000]" style={{ pointerEvents: expanded ? 'auto' : 'none' }}>
      {/* Backdrop — visuel uniquement : un clic dehors ne doit PAS fermer la popup */}
      <div
        className="absolute inset-0"
        style={{
          background: 'rgba(8,10,14,0.45)',
          backdropFilter: 'blur(2px)',
          opacity: expanded ? 1 : 0,
          transition: 'opacity 320ms ease',
        }}
      />

      {/* The morphing shape: circle → rounded rectangle */}
      <div
        ref={shapeRef}
        className="absolute overflow-hidden flex flex-col"
        style={{
          right: expanded ? 20 : 34,
          bottom: expanded ? 24 : 34,
          width: expanded ? 'min(400px, calc(100vw - 40px))' : 60,
          height: expanded ? 'min(660px, calc(100vh - 48px))' : 60,
          borderRadius: expanded ? 24 : 999,
          background: 'var(--surface-1)',
          border: '1px solid var(--border-default)',
          boxShadow: expanded
            ? '0 24px 80px rgba(0,0,0,0.45), 0 2px 8px rgba(0,0,0,0.2)'
            : '0 8px 30px rgba(0,0,0,0.35)',
          transform: expanded ? 'scale(1)' : 'scale(0.9)',
          transformOrigin: 'bottom right',
          transition: 'width 460ms cubic-bezier(0.22,1,0.36,1), height 460ms cubic-bezier(0.22,1,0.36,1), border-radius 460ms cubic-bezier(0.22,1,0.36,1), transform 460ms cubic-bezier(0.22,1,0.36,1)',
          pointerEvents: 'auto',
        }}
      >
        {/* Circle-state icon (fades out as it expands). pointerEvents: une fois
            invisible elle ne doit PLUS capter les clics — sinon elle bloque le
            bouton X et le champ de saisie. */}
        <div
          className="absolute inset-0 flex items-center justify-center"
          style={{
            opacity: expanded ? 0 : 1,
            transition: 'opacity 200ms ease',
            pointerEvents: expanded ? 'none' : 'auto',
          }}
        >
          <SupportGlyph />
        </div>

        {/* Panel content (fades in) */}
        <div
          className="flex flex-col h-full"
          style={{ opacity: expanded ? 1 : 0, transition: 'opacity 260ms ease 180ms' }}
        >
          {/* Header — "Velbaz" at the very top */}
          <div
            className="flex items-center gap-3 px-4 py-3.5 shrink-0"
            style={{ borderBottom: '1px solid var(--border-subtle)', background: 'var(--surface-2)' }}
          >
            <div
              className="w-9 h-9 rounded-full flex items-center justify-center shrink-0"
              style={{ background: 'var(--surface-4)', color: 'var(--text-primary)' }}
            >
              <SupportGlyph small />
            </div>
            <div className="min-w-0 flex-1">
              <div className="text-[15px] font-semibold tracking-tight" style={{ color: 'var(--text-primary)' }}>Velbaz</div>
              <div className="text-[11px] flex items-center gap-1.5" style={{ color: 'var(--text-ghost)' }}>
                <span className="inline-block w-1.5 h-1.5 rounded-full" style={{ background: '#22c55e', boxShadow: '0 0 6px #22c55e' }} />
                Support en direct
              </div>
            </div>
            <button
              onClick={onClose}
              className="w-8 h-8 rounded-lg flex items-center justify-center transition-colors"
              style={{ color: 'var(--text-muted)' }}
              onMouseEnter={e => (e.currentTarget.style.background = 'var(--surface-4)')}
              onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
              aria-label="Fermer"
            >
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round"><path d="M4 4L12 12M12 4L4 12" /></svg>
            </button>
          </div>

          {/* Messages */}
          <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 py-4 space-y-3" style={{ background: 'var(--surface-1)' }}>
            {messages.map((m, i) => (
              <MessageBubble key={i} msg={m} index={i} />
            ))}
            {loading && <TypingBubble />}
          </div>

          {/* Input */}
          <div className="px-3 pb-3 pt-2 shrink-0" style={{ borderTop: '1px solid var(--border-subtle)', background: 'var(--surface-2)' }}>
            <div
              className="flex items-end gap-2 rounded-2xl px-3 py-2"
              style={{ background: 'var(--surface-4)', border: '1px solid var(--border-subtle)' }}
            >
              <textarea
                ref={inputRef}
                value={input}
                onChange={e => setInput(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } }}
                rows={1}
                placeholder="Pose ta question…"
                className="flex-1 bg-transparent resize-none outline-none text-[13px] leading-5 max-h-28"
                style={{ color: 'var(--text-primary)' }}
              />
              <button
                onClick={send}
                disabled={!input.trim() || loading}
                className="w-8 h-8 rounded-full flex items-center justify-center shrink-0 transition-all"
                style={{
                  background: input.trim() && !loading ? 'var(--btn-primary-bg)' : 'var(--surface-5)',
                  color: input.trim() && !loading ? 'var(--btn-primary-fg)' : 'var(--text-ghost)',
                  cursor: input.trim() && !loading ? 'pointer' : 'default',
                }}
                aria-label="Envoyer"
              >
                <svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"><path d="M8 13V3M8 3L4 7M8 3L12 7" /></svg>
              </button>
            </div>
            <div className="text-[10px] text-center mt-1.5" style={{ color: 'var(--text-ghost)' }}>Velbaz AI assistant · powered by AI</div>
          </div>
        </div>
      </div>

      <style>{`
        @keyframes velbaz-bubble-in { from { opacity: 0; transform: translateY(8px) scale(0.98); } to { opacity: 1; transform: translateY(0) scale(1); } }
        @keyframes velbaz-dot { 0%, 60%, 100% { transform: translateY(0); opacity: 0.4; } 30% { transform: translateY(-4px); opacity: 1; } }
      `}</style>
    </div>,
    document.body,
  );
}

function MessageBubble({ msg, index }: { msg: Msg; index: number }) {
  const isUser = msg.role === 'user';
  return (
    <div
      className={`flex ${isUser ? 'justify-end' : 'justify-start'}`}
      style={{ animation: `velbaz-bubble-in 260ms ease ${Math.min(index, 6) * 20}ms both` }}
    >
      <div
        className="max-w-[85%] px-3.5 py-2.5 text-[13px] leading-[1.5] whitespace-pre-wrap"
        style={
          isUser
            ? { background: 'var(--btn-primary-bg)', color: 'var(--btn-primary-fg)', borderRadius: '16px 16px 4px 16px' }
            : { background: 'var(--surface-4)', color: 'var(--text-primary)', borderRadius: '16px 16px 16px 4px' }
        }
      >
        {msg.content}
      </div>
    </div>
  );
}

function TypingBubble() {
  return (
    <div className="flex justify-start" style={{ animation: 'velbaz-bubble-in 200ms ease both' }}>
      <div className="px-4 py-3 flex items-center gap-1" style={{ background: 'var(--surface-4)', borderRadius: '16px 16px 16px 4px' }}>
        {[0, 1, 2].map(i => (
          <span
            key={i}
            className="inline-block w-1.5 h-1.5 rounded-full"
            style={{ background: 'var(--text-muted)', animation: `velbaz-dot 1.2s ease ${i * 0.15}s infinite` }}
          />
        ))}
      </div>
    </div>
  );
}

function SupportGlyph({ small }: { small?: boolean }) {
  const s = small ? 18 : 26;
  return (
    <svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" style={small ? {} : { color: 'var(--text-secondary)' }}>
      <path d="M21 11.5a8.5 8.5 0 0 1-12.6 7.4L3 20.5l1.7-5.1A8.5 8.5 0 1 1 21 11.5Z" />
      <circle cx="8.5" cy="11.5" r="0.6" fill="currentColor" />
      <circle cx="12" cy="11.5" r="0.6" fill="currentColor" />
      <circle cx="15.5" cy="11.5" r="0.6" fill="currentColor" />
    </svg>
  );
}
