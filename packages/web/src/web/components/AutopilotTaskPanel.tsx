/**
 * AutopilotTaskPanel — planificateur de tâches IA affiché à la place de la preview
 * quand le mode auto est activé. 3 créneaux (matin / midi / soir), drag-and-drop,
 * édition, suppression → placeholder pointillé + ajout, loader "wave" + glow pendant
 * l'exécution, régénération auto quand tout est vide, œil flottant pour masquer.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { getAuthToken } from '../lib/token';
import { AnimatePresence, motion } from 'motion/react';

// ─── Types ──────────────────────────────────────────────────────────────────
type TimeSlot = 'morning' | 'noon' | 'evening';

interface Task {
  id: string;
  title: string;
  description: string | null;
  agent: string;
  type: string;
  status: string; // pending | waiting_approval | running | ...
  timeSlot: TimeSlot | null;
  slotOrder: number;
  scheduledFor: number | string | null;
  hasExactTime: boolean;
}

type Slots = Record<TimeSlot, Task[]>;

const SLOT_META: { key: TimeSlot; label: string; hint: string }[] = [
  { key: 'morning', label: 'Morning', hint: '6h – 12h' },
  { key: 'noon', label: 'Noon', hint: '12h – 18h' },
  { key: 'evening', label: 'Evening', hint: '18h – 24h' },
];

function authHeaders(): Record<string, string> {
  const t = getAuthToken();
  return t ? { Authorization: `Bearer ${t}` } : {};
}

// ─── Loader "wave" (dot matrix) ─────────────────────────────────────────────
function LoaderDotMatrix({ rows = 4, cols = 6, speed = 1.5, dotSize = 3 }: { rows?: number; cols?: number; speed?: number; dotSize?: number }) {
  const dots = useMemo(() => {
    const result: { delay: number }[] = [];
    for (let row = 0; row < rows; row++) {
      for (let col = 0; col < cols; col++) {
        const delay = ((row + col) / (rows + cols - 2)) * speed; // pattern "wave"
        result.push({ delay });
      }
    }
    return result;
  }, [rows, cols, speed]);
  const gap = dotSize * 1.6;
  return (
    <span aria-label="In progress" style={{ display: 'inline-flex' }}>
      <div style={{ display: 'grid', gridTemplateColumns: `repeat(${cols}, 1fr)`, gap }}>
        {dots.map((d, i) => (
          <span key={i} style={{
            width: dotSize, height: dotSize, borderRadius: 999,
            background: 'var(--blue-accent)',
            animation: `apwave-pulse ${speed}s ease-in-out infinite`,
            animationDelay: `${d.delay}s`, willChange: 'transform',
          }} />
        ))}
      </div>
    </span>
  );
}

// ─── Formatage de l'échéance ────────────────────────────────────────────────
function formatWhen(t: Task): string {
  if (!t.scheduledFor) return SLOT_META.find(s => s.key === (t.timeSlot || 'morning'))?.label || '';
  const d = new Date(typeof t.scheduledFor === 'string' ? t.scheduledFor : t.scheduledFor);
  const now = new Date();
  const sameDay = d.toDateString() === now.toDateString();
  const dayLabel = sameDay ? "today" : d.toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' });
  if (t.hasExactTime) return `${dayLabel} · ${d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}`;
  const slot = SLOT_META.find(s => s.key === (t.timeSlot || 'morning'))?.label;
  return `${dayLabel} · ${slot}`;
}

// ─── Carte de tâche ─────────────────────────────────────────────────────────
function TaskCard({ task, onEdit, onSchedule, onDelete, onDragStart, onDragEnd, onDropBefore }: {
  task: Task;
  onEdit: (t: Task) => void;
  onSchedule: (t: Task) => void;
  onDelete: (t: Task) => void;
  onDragStart: (t: Task) => void;
  onDragEnd: () => void;
  onDropBefore: (t: Task) => void;
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [over, setOver] = useState(false);
  const running = task.status === 'running';
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!menuOpen) return;
    const h = (e: MouseEvent) => { if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuOpen(false); };
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, [menuOpen]);

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 8, scale: 0.98 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, scale: 0.96, transition: { duration: 0.18 } }}
      transition={{ type: 'spring', stiffness: 380, damping: 30 }}
      draggable={!running}
      onDragStart={() => onDragStart(task)}
      onDragEnd={onDragEnd}
      onDragOver={(e) => { e.preventDefault(); setOver(true); }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => { e.preventDefault(); setOver(false); onDropBefore(task); }}
      style={{
        position: 'relative',
        flexShrink: 0,
        padding: '11px 13px',
        borderRadius: 14,
        background: 'var(--surface-2)',
        border: `1px solid ${running || over ? 'var(--border-hover)' : 'transparent'}`,
        cursor: running ? 'default' : 'grab',
        boxShadow: running ? '0 0 0 1px var(--border-hover)' : 'none',
      }}
    >
      {/* drop indicator au-dessus */}
      {over && <div style={{ position: 'absolute', top: -5, left: 10, right: 10, height: 2, borderRadius: 2, background: 'var(--text-secondary)' }} />}

      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 8 }}>
        <div style={{ minWidth: 0, flex: 1 }}>
          <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-secondary)', lineHeight: 1.3 }}>{task.title}</div>
          {task.description && (
            <div style={{ fontSize: 11.5, color: 'var(--text-dim)', marginTop: 3, lineHeight: 1.4, display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>
              {task.description}
            </div>
          )}
        </div>
        {/* menu 3 points */}
        <div ref={menuRef} style={{ position: 'relative', flexShrink: 0 }}>
          <button
            onClick={() => setMenuOpen(v => !v)}
            title="Options"
            style={{ width: 24, height: 24, borderRadius: 8, border: 'none', background: 'transparent', color: 'var(--text-dim)', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
          >
            <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor"><circle cx="8" cy="3" r="1.4" /><circle cx="8" cy="8" r="1.4" /><circle cx="8" cy="13" r="1.4" /></svg>
          </button>
          {menuOpen && (
            <div style={{ position: 'absolute', top: 28, right: 0, zIndex: 40, minWidth: 170, padding: 6, borderRadius: 12, background: 'var(--surface-1)', border: '1px solid var(--border-subtle)', boxShadow: '0 10px 30px -8px rgba(0,0,0,0.5)' }}>
              {[
                { label: '✏️  Edit the idea', fn: () => onEdit(task) },
                { label: '📅  Choose a date', fn: () => onSchedule(task) },
                { label: '🗑️  Delete', fn: () => onDelete(task), danger: true },
              ].map((it, i) => (
                <button key={i} onClick={() => { setMenuOpen(false); it.fn(); }}
                  style={{ width: '100%', textAlign: 'left', padding: '8px 10px', fontSize: 12.5, borderRadius: 8, border: 'none', background: 'transparent', color: it.danger ? '#e5658a' : 'var(--text-secondary)', cursor: 'pointer' }}
                  onMouseEnter={e => e.currentTarget.style.background = 'var(--surface-2)'}
                  onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
                >{it.label}</button>
              ))}
            </div>
          )}
        </div>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 7, gap: 8, flexShrink: 0 }}>
        <span style={{ fontSize: 10.5, fontWeight: 600, color: 'var(--text-dim)', padding: '3px 9px', borderRadius: 999, background: 'var(--surface-1)' }}>
          {formatWhen(task)}
        </span>
        {running
          ? <LoaderDotMatrix />
          : <span style={{ fontSize: 10, color: 'var(--text-dim)', textTransform: 'capitalize' }}>{task.agent}</span>}
      </div>
    </motion.div>
  );
}

// ─── Placeholder vide (pointillé + bouton +) ────────────────────────────────
function EmptySlotPlaceholder({ onAdd, onDrop, dragActive }: { onAdd: () => void; onDrop: () => void; dragActive: boolean }) {
  const [over, setOver] = useState(false);
  return (
    <div
      onDragOver={(e) => { e.preventDefault(); setOver(true); }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => { e.preventDefault(); setOver(false); onDrop(); }}
      style={{
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        minHeight: 72, borderRadius: 14,
        border: `1.5px dashed ${over ? 'var(--border-hover)' : 'var(--border-subtle)'}`,
        background: over ? 'var(--surface-3)' : 'transparent',
        transition: 'all 0.15s',
      }}
    >
      {dragActive ? (
        <span style={{ fontSize: 11.5, color: 'var(--text-dim)' }}>Drop here</span>
      ) : (
        <button onClick={onAdd} title="Add a task"
          style={{ width: 34, height: 34, borderRadius: 999, border: 'none', cursor: 'pointer', background: 'var(--surface-2)', color: 'var(--text-secondary)', display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: '0 2px 8px -3px rgba(0,0,0,0.4)' }}>
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M8 3v10M3 8h10" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" /></svg>
        </button>
      )}
    </div>
  );
}

// ─── Popup générique ────────────────────────────────────────────────────────
function Popup({ title, children, onClose }: { title: string; children: React.ReactNode; onClose: () => void }) {
  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, zIndex: 60, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(0,0,0,0.45)', backdropFilter: 'blur(4px)' }}>
      <div onClick={e => e.stopPropagation()} style={{ width: 360, maxWidth: '90vw', padding: 18, borderRadius: 18, background: 'var(--surface-1)', border: '1px solid var(--border-subtle)', boxShadow: '0 20px 60px -12px rgba(0,0,0,0.6)' }}>
        <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--text-secondary)', marginBottom: 12 }}>{title}</div>
        {children}
      </div>
    </div>
  );
}

const inputStyle: React.CSSProperties = {
  width: '100%', padding: '10px 12px', fontSize: 13, borderRadius: 12,
  background: 'var(--surface-2)', border: '1px solid var(--border-subtle)',
  color: 'var(--text-secondary)', outline: 'none', resize: 'vertical' as const,
};
const pillBtn = (primary: boolean): React.CSSProperties => ({
  padding: '9px 18px', fontSize: 13, fontWeight: 600, borderRadius: 999, cursor: 'pointer',
  border: primary ? 'none' : '1px solid var(--border-subtle)',
  background: primary ? 'var(--btn-primary-bg)' : 'transparent',
  color: primary ? 'var(--btn-primary-fg)' : 'var(--text-dim)',
});

// ─── Panneau principal ──────────────────────────────────────────────────────
export default function AutopilotTaskPanel({ companyId }: { companyId: string }) {
  const [slots, setSlots] = useState<Slots>({ morning: [], noon: [], evening: [] });
  const [hidden, setHidden] = useState(false);
  const [reflecting, setReflecting] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const dragTask = useRef<Task | null>(null);
  const [dragActive, setDragActive] = useState(false);

  // popups
  const [editing, setEditing] = useState<Task | null>(null);
  const [scheduling, setScheduling] = useState<Task | null>(null);
  const [adding, setAdding] = useState<TimeSlot | null>(null);

  const api = useCallback((path: string, init?: RequestInit) =>
    fetch(`/api/companies/${companyId}/autopilot${path}`, {
      ...init,
      headers: { 'Content-Type': 'application/json', ...authHeaders(), ...init?.headers },
    }), [companyId]);

  const load = useCallback(async () => {
    try {
      const r = await api('/slots');
      if (!r.ok) return;
      const data = await r.json();
      setSlots({ morning: data.morning || [], noon: data.noon || [], evening: data.evening || [] });
      setLoaded(true);
    } catch { /* ignore */ }
  }, [api]);

  // Poll toutes les 8s
  useEffect(() => {
    load();
    const iv = setInterval(load, 8000);
    return () => clearInterval(iv);
  }, [load]);

  const total = slots.morning.length + slots.noon.length + slots.evening.length;

  // Réflexion auto quand tout est vide/terminé
  useEffect(() => {
    if (!loaded || total > 0 || reflecting) return;
    setReflecting(true);
    api('/reflect', { method: 'POST' })
      .then(() => load())
      .finally(() => setTimeout(() => setReflecting(false), 3000));
  }, [loaded, total, reflecting, api, load]);

  // ── Drag-and-drop ──
  const persist = useCallback((next: Slots) => {
    api('/tasks/reorder', {
      method: 'PATCH',
      body: JSON.stringify({ slots: {
        morning: next.morning.map(t => t.id),
        noon: next.noon.map(t => t.id),
        evening: next.evening.map(t => t.id),
      } }),
    }).catch(() => {});
  }, [api]);

  const removeFromAll = (s: Slots, id: string): Slots => ({
    morning: s.morning.filter(t => t.id !== id),
    noon: s.noon.filter(t => t.id !== id),
    evening: s.evening.filter(t => t.id !== id),
  });

  const dropInSlotAt = (slot: TimeSlot, beforeId: string | null) => {
    const moving = dragTask.current;
    if (!moving) return;
    setSlots(prev => {
      const cleaned = removeFromAll(prev, moving.id);
      const updated: Task = { ...moving, timeSlot: slot };
      const arr = [...cleaned[slot]];
      const idx = beforeId ? arr.findIndex(t => t.id === beforeId) : -1;
      if (idx === -1) arr.push(updated); else arr.splice(idx, 0, updated);
      const next = { ...cleaned, [slot]: arr };
      persist(next);
      return next;
    });
    dragTask.current = null;
    setDragActive(false);
  };

  // ── Actions serveur ──
  const doDelete = (t: Task) => {
    setSlots(prev => removeFromAll(prev, t.id));
    api(`/tasks/${t.id}`, { method: 'DELETE' }).catch(() => {});
  };
  const doAdd = async (slot: TimeSlot, title: string, description: string) => {
    await api('/tasks', { method: 'POST', body: JSON.stringify({ timeSlot: slot, title, description }) });
    setAdding(null);
    load();
  };
  const doEdit = async (t: Task, title: string, description: string) => {
    setSlots(prev => {
      const map = (arr: Task[]) => arr.map(x => x.id === t.id ? { ...x, title, description } : x);
      return { morning: map(prev.morning), noon: map(prev.noon), evening: map(prev.evening) };
    });
    setEditing(null);
    await api(`/tasks/${t.id}`, { method: 'PATCH', body: JSON.stringify({ title, description }) });
  };
  const doSchedule = async (t: Task, scheduledFor: string, hasExactTime: boolean) => {
    setScheduling(null);
    await api(`/tasks/${t.id}/schedule`, { method: 'PATCH', body: JSON.stringify({ scheduledFor, hasExactTime }) });
    load();
  };

  // ── Œil masqué : petit bouton flottant pour réafficher ──
  if (hidden) {
    return (
      <button onClick={() => setHidden(false)} title="Show tasks"
        style={{ position: 'absolute', top: 14, right: 14, zIndex: 25, width: 38, height: 38, borderRadius: 999, border: '1px solid var(--border-subtle)', background: 'var(--surface-2)', color: 'var(--text-secondary)', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: '0 4px 14px -4px rgba(0,0,0,0.4)' }}>
        <EyeIcon off />
      </button>
    );
  }

  return (
    <div style={{ position: 'relative', width: '100%', height: '100%', display: 'flex', flexDirection: 'column', overflow: 'hidden', padding: '16px 16px 16px' }}>
      <style>{`
        @keyframes apwave-pulse { 0%,100%{opacity:.15;transform:scale(.3)} 50%{opacity:1;transform:scale(1)} }
        @keyframes apglow { 0%,100%{box-shadow:0 0 0 1px var(--border-hover),0 0 16px -4px var(--border-hover)} 50%{box-shadow:0 0 0 1px var(--border-hover),0 0 26px 0px var(--border-hover)} }
      `}</style>

      {/* œil flottant */}
      <button onClick={() => setHidden(true)} title="Hide tasks"
        style={{ position: 'absolute', top: 12, right: 12, zIndex: 25, width: 34, height: 34, borderRadius: 999, border: '1px solid var(--border-subtle)', background: 'var(--surface-2)', color: 'var(--text-dim)', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <EyeIcon />
      </button>

      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12, flexShrink: 0 }}>
        <div style={{ width: 6, height: 6, borderRadius: 999, background: 'var(--blue-accent)' }} />
        <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-secondary)' }}>AI tasks</div>
        {reflecting && <span style={{ fontSize: 11, color: 'var(--text-dim)' }}>· reflecting…</span>}
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 16, flex: 1, minHeight: 0, overflowY: 'auto', paddingRight: 2 }}>
        {SLOT_META.map(({ key, label, hint }) => {
          const list = slots[key];
          return (
            <div key={key} style={{ display: 'flex', flexDirection: 'column', flexShrink: 0 }}>
              <div style={{ display: 'flex', alignItems: 'baseline', gap: 6, marginBottom: 8, paddingLeft: 2, flexShrink: 0 }}>
                <span style={{ fontSize: 11, fontWeight: 600, letterSpacing: 0.3, color: 'var(--text-dim)' }}>{label}</span>
                <span style={{ fontSize: 10.5, color: 'var(--text-ghost, var(--text-dim))' }}>{hint}</span>
              </div>
              <div
                onDragOver={(e) => { e.preventDefault(); }}
                onDrop={(e) => { e.preventDefault(); dropInSlotAt(key, null); }}
                style={{ display: 'flex', flexDirection: 'column', gap: 8 }}
              >
                <AnimatePresence mode="popLayout">
                  {list.map(task => (
                    <TaskCard key={task.id} task={task}
                      onEdit={setEditing}
                      onSchedule={setScheduling}
                      onDelete={doDelete}
                      onDragStart={(t) => { dragTask.current = t; setDragActive(true); }}
                      onDragEnd={() => { setDragActive(false); }}
                      onDropBefore={(t) => dropInSlotAt(key, t.id)}
                    />
                  ))}
                </AnimatePresence>
                {list.length === 0 && (
                  <EmptySlotPlaceholder dragActive={dragActive} onAdd={() => setAdding(key)} onDrop={() => dropInSlotAt(key, null)} />
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* Popups */}
      {editing && <EditPopup task={editing} onClose={() => setEditing(null)} onSave={doEdit} />}
      {adding && <AddPopup slot={adding} onClose={() => setAdding(null)} onAdd={doAdd} />}
      {scheduling && <SchedulePopup task={scheduling} onClose={() => setScheduling(null)} onSave={doSchedule} />}
    </div>
  );
}

// ─── Icône œil ──────────────────────────────────────────────────────────────
function EyeIcon({ off }: { off?: boolean }) {
  return off
    ? <svg width="17" height="17" viewBox="0 0 20 20" fill="none"><path d="M2 10s3-6 8-6 8 6 8 6-3 6-8 6-8-6-8-6Z" stroke="currentColor" strokeWidth="1.4" /><circle cx="10" cy="10" r="2.4" stroke="currentColor" strokeWidth="1.4" /></svg>
    : <svg width="17" height="17" viewBox="0 0 20 20" fill="none"><path d="M3 3l14 14M8.2 8.3A2.4 2.4 0 0010 12.4a2.4 2.4 0 001.8-.8M6.3 6.4C4 7.7 2 10 2 10s3 6 8 6a8.6 8.6 0 003.7-.8M9 4.1A9 9 0 0110 4c5 0 8 6 8 6a15 15 0 01-2 2.6" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" /></svg>;
}

// ─── Popups concrètes ───────────────────────────────────────────────────────
function EditPopup({ task, onClose, onSave }: { task: Task; onClose: () => void; onSave: (t: Task, title: string, desc: string) => void }) {
  const [title, setTitle] = useState(task.title);
  const [desc, setDesc] = useState(task.description || '');
  return (
    <Popup title="Edit task" onClose={onClose}>
      <input value={title} onChange={e => setTitle(e.target.value)} placeholder="Title" style={{ ...inputStyle, marginBottom: 10 }} />
      <textarea value={desc} onChange={e => setDesc(e.target.value)} placeholder="Idea / description" rows={4} style={inputStyle} />
      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 14 }}>
        <button style={pillBtn(false)} onClick={onClose}>Cancel</button>
        <button style={pillBtn(true)} onClick={() => title.trim() && onSave(task, title.trim(), desc.trim())}>Save</button>
      </div>
    </Popup>
  );
}

function AddPopup({ slot, onClose, onAdd }: { slot: TimeSlot; onClose: () => void; onAdd: (slot: TimeSlot, title: string, desc: string) => void }) {
  const [title, setTitle] = useState('');
  const [desc, setDesc] = useState('');
  const label = SLOT_META.find(s => s.key === slot)?.label;
  return (
    <Popup title={`New task — ${label}`} onClose={onClose}>
      <input autoFocus value={title} onChange={e => setTitle(e.target.value)} placeholder="Task idea" style={{ ...inputStyle, marginBottom: 10 }} />
      <textarea value={desc} onChange={e => setDesc(e.target.value)} placeholder="Details (optional)" rows={3} style={inputStyle} />
      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 14 }}>
        <button style={pillBtn(false)} onClick={onClose}>Cancel</button>
        <button style={pillBtn(true)} onClick={() => title.trim() && onAdd(slot, title.trim(), desc.trim())}>Add</button>
      </div>
    </Popup>
  );
}

function SchedulePopup({ task, onClose, onSave }: { task: Task; onClose: () => void; onSave: (t: Task, iso: string, hasExactTime: boolean) => void }) {
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [time, setTime] = useState('');
  const save = () => {
    const hasExactTime = !!time;
    const iso = new Date(`${date}T${time || '00:00'}:00`).toISOString();
    onSave(task, iso, hasExactTime);
  };
  return (
    <Popup title="Choose a date" onClose={onClose}>
      <label style={{ fontSize: 11.5, color: 'var(--text-dim)' }}>Day</label>
      <input type="date" value={date} onChange={e => setDate(e.target.value)} style={{ ...inputStyle, marginTop: 4, marginBottom: 12 }} />
      <label style={{ fontSize: 11.5, color: 'var(--text-dim)' }}>Time (optional)</label>
      <input type="time" value={time} onChange={e => setTime(e.target.value)} style={{ ...inputStyle, marginTop: 4 }} />
      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 14 }}>
        <button style={pillBtn(false)} onClick={onClose}>Cancel</button>
        <button style={pillBtn(true)} onClick={save}>Save</button>
      </div>
    </Popup>
  );
}
