import { useState, useRef, useEffect, useCallback } from 'react';
import { useIsMobile } from '../lib/useIsMobile';
import { VelbazIcon } from '../components/VelbazIcon';
import { api } from '../lib/api';
import { useAuth, isAdminUser } from '../lib/auth';

// ─────────────────────────────────────────────────────────────────────────────
// Scroll élastique : vitesse normale, puis résistance progressive dans la zone
// de fin (haut/bas) jusqu'à un arrêt fluide au lieu d'un blocage sec.
function useElasticScroll<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    const ZONE = 170;   // px de résistance avant chaque bord
    const EASE = 0.16;  // fluidité de l'animation
    let target = el.scrollTop;
    let current = el.scrollTop;
    let raf = 0;
    let running = false;

    const tick = () => {
      current += (target - current) * EASE;
      if (Math.abs(target - current) < 0.4) {
        current = target;
        running = false;
      }
      el.scrollTop = current;
      if (running) raf = requestAnimationFrame(tick);
    };

    const onWheel = (e: WheelEvent) => {
      const max = el.scrollHeight - el.clientHeight;
      if (max <= 0) return;                 // rien à scroller
      if (e.deltaY === 0) return;
      e.preventDefault();

      // resync si un scroll natif a bougé entre-temps
      if (!running) { target = el.scrollTop; current = el.scrollTop; }

      let delta = e.deltaY;
      // Résistance progressive selon la proximité du bord dans le sens du scroll
      if (delta > 0) {
        const room = max - target;          // place restante avant le bas
        if (room < ZONE) delta *= Math.max(0, room / ZONE);
      } else {
        const room = target;                // place restante avant le haut
        if (room < ZONE) delta *= Math.max(0, room / ZONE);
      }

      target = Math.max(0, Math.min(max, target + delta));
      if (!running) { running = true; raf = requestAnimationFrame(tick); }
    };

    el.addEventListener('wheel', onWheel, { passive: false });
    return () => { el.removeEventListener('wheel', onWheel); cancelAnimationFrame(raf); };
  }, []);
  return ref;
}

// ─────────────────────────────────────────────────────────────────────────────
// Money Maker — usine à entreprises autonome (couche "boss" au-dessus de Velbaz).
// Page 3 panneaux :
//   Gauche  = chat avec l'IA boss (+ toggle mode auto)
//   Centre  = salle des machines (IA qui se parlent + modifs/tâches par entreprise)
//   Droite  = portfolio (toutes les entreprises Money Maker + slots build/edit)
//
// PHASE 2 : coquille visuelle avec données mockées pour validation du design.
// Le branchement sur /api/money-maker/* arrive en phase 4-5.
// ─────────────────────────────────────────────────────────────────────────────

type Company = {
  id: string;
  name: string;
  emoji: string;
  /** Logo de la marque (data URI ou URL CDN) généré pour l'entreprise. */
  logo?: string;
  type: 'web' | 'mobile';
  status: 'building' | 'active' | 'queued' | 'improving' | 'paused' | 'killed';
  mrr: number;
  totalRevenue: number;
  note: string;
};

type FeedItem = {
  id: string;
  kind: 'spawn' | 'improve' | 'kill' | 'research' | 'chat' | 'agent';
  company?: string;
  agent?: string;
  text: string;
  time: string;
};

// ── UI helpers ───────────────────────────────────────────────────────────────
// Palette neutre : blanc / beige / noir / gris uniquement. La distinction entre
// statuts se fait par l'intensité (texte plein vs estompé + point plein/vide).
const STATUS_STYLE: Record<Company['status'], { label: string; strong: boolean; dot: 'filled' | 'ring' | 'muted' }> = {
  building: { label: 'Building', strong: true, dot: 'ring' },
  active: { label: 'Active', strong: true, dot: 'filled' },
  queued: { label: 'Queued', strong: false, dot: 'muted' },
  improving: { label: 'Improving', strong: true, dot: 'ring' },
  paused: { label: 'Paused', strong: false, dot: 'ring' },
  killed: { label: 'Killed', strong: false, dot: 'muted' },
};

const FEED_STYLE: Record<FeedItem['kind'], { label: string; icon: string }> = {
  research: { label: 'Research', icon: '🔍' },
  spawn: { label: 'New company', icon: '🚀' },
  improve: { label: 'Improving', icon: '🔧' },
  kill: { label: 'Deletion', icon: '🗑️' },
  chat: { label: 'Chat', icon: '💬' },
  agent: { label: 'Agent', icon: '🤖' },
};

function money(n: number) {
  return n >= 1000 ? `${(n / 1000).toFixed(1)}k€` : `${Math.round(n)}€`;
}

function timeAgo(at: any): string {
  const t = typeof at === 'number' ? at : new Date(at).getTime();
  if (!t || isNaN(t)) return '';
  const s = Math.max(0, Math.floor((Date.now() - t) / 1000));
  if (s < 60) return "just now";
  const m = Math.floor(s / 60); if (m < 60) return `${m} min ago`;
  const h = Math.floor(m / 60); if (h < 24) return `${h} h ago`;
  const d = Math.floor(h / 24); return `${d} d ago`;
}

// Mappe le type de run backend vers le style de feed de l'UI.
const RUN_KIND: Record<string, FeedItem['kind']> = {
  spawn: 'spawn', improve: 'improve', kill: 'kill', research: 'research', chat: 'chat', decision: 'agent',
};

type GoalCard = {
  feasible: boolean;
  needsAccept: boolean;
  targetMrr: number;
  deadline: string | null;
  assessment: string;
  proposal: { targetMrr: number; deadline: string | null; note: string } | null;
};

type EmailDraft = {
  id: string; companyId: string | null; type: string; subject: string; body: string;
  recipientEmail: string; recipientName: string | null; status: string; fromName: string | null;
  brandColor?: string | null; preheader?: string | null; cta?: { label: string; url: string } | null;
  createdAt: number | null;
};
type ChatMessage = { role: string; text: string; goal?: GoalCard | null; spawned?: string[]; emails?: EmailDraft[] };

/**
 * Petite carte d'aperçu du site d'une entreprise.
 * Une iframe figée (pointer-events-none) montre le site live ; un clic sur la
 * carte l'ouvre dans un nouvel onglet. On utilise un vrai <a target="_blank">
 * (et non window.open) pour ne jamais être bloqué par le sandbox/popup blocker.
 */
function SitePreviewCard({ company }: { company: Company }) {
  const src = `/api/companies/${company.id}/preview/`;
  // Le site n'est réellement servi qu'une fois l'app matérialisée (pas en file
  // d'attente ni en tout début de build) → sinon on montre un état "en cours"
  // au lieu d'une iframe vide qui a l'air cassée. L'aperçu se remplit tout seul
  // au prochain refresh une fois l'entreprise construite.
  const live = !company.id.startsWith('q_') && company.status !== 'queued';
  return (
    <a
      href={src}
      target="_blank"
      rel="noopener noreferrer"
      title={`Open ${company.name} in a new tab`}
      className="group relative block rounded-xl overflow-hidden shrink-0 transition-all"
      style={{ width: 180, border: '1px solid var(--border-default)', background: 'var(--surface-0)' }}
    >
      <div className="relative w-full overflow-hidden" style={{ height: 108, background: 'var(--surface-2)' }}>
        {live ? (
          <iframe
            src={src}
            title={company.name}
            tabIndex={-1}
            scrolling="no"
            sandbox="allow-scripts allow-same-origin"
            className="border-0 pointer-events-none"
            style={{ width: 720, height: 432, transform: 'scale(0.25)', transformOrigin: 'top left' }}
          />
        ) : (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-1.5" style={{ color: 'var(--text-ghost)' }}>
            <span className="w-5 h-5 rounded-full border-2 border-current border-t-transparent animate-spin" style={{ opacity: 0.5 }} />
            <span className="text-[10px] font-medium">Building…</span>
          </div>
        )}
        {/* voile hover + icône ouvrir */}
        <div className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity" style={{ background: 'rgba(0,0,0,0.35)' }}>
          <span className="flex items-center gap-1 text-[11px] font-semibold px-2 py-1 rounded-md" style={{ background: '#fff', color: '#111' }}>
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>
            Open
          </span>
        </div>
      </div>
      <div className="flex items-center gap-1.5 px-2 py-1.5">
        {company.logo
          ? <img src={company.logo} alt="" className="w-4 h-4 rounded object-contain shrink-0" />
          : <span className="w-4 h-4 rounded flex items-center justify-center text-[9px] font-bold shrink-0" style={{ background: 'var(--surface-4)', color: 'var(--text-secondary)' }}>{company.name[0]?.toUpperCase() || '?'}</span>}
        <span className="text-[11px] font-semibold truncate" style={{ color: 'var(--text-primary)' }}>{company.name}</span>
      </div>
    </a>
  );
}

export default function MoneyMaker() {
  const { user, loading: authLoading } = useAuth();
  const admin = isAdminUser(user);

  // BÊTA PRIVÉE : Money Maker n'est accessible qu'à l'admin. Si un non-admin
  // atteint /money-maker (lien direct, manip URL…), on ne monte JAMAIS l'app :
  // aucune requête réseau, aucune donnée. Le backend refuse déjà tout en 403.
  if (!authLoading && !admin) {
    return (
      <div className="flex-1 flex items-center justify-center px-6" style={{ background: 'var(--surface-1)' }}>
        <div className="max-w-md text-center">
          <div className="text-[15px] font-bold mb-2" style={{ color: 'var(--text-primary)' }}>Money Maker · Private Beta</div>
          <p className="text-[13px] leading-relaxed" style={{ color: 'var(--text-secondary)' }}>
            This feature is in restricted access and is not yet available for your account.
          </p>
        </div>
      </div>
    );
  }
  if (authLoading) {
    return <div className="flex-1" style={{ background: 'var(--surface-1)' }} />;
  }

  return <MoneyMakerInner />;
}

function MoneyMakerInner() {
  const isMobile = useIsMobile();
  const [autoMode, setAutoMode] = useState(false);
  const [emailAutoSend, setEmailAutoSend] = useState(false);
  const [mobileTab, setMobileTab] = useState<'chat' | 'machine' | 'portfolio'>('machine');
  const [input, setInput] = useState('');
  const [chat, setChat] = useState<ChatMessage[]>([
    { role: 'boss', text: 'Hi 👋 I\'m the Money Maker boss. I hunt for trends and launch profitable companies without you having to give me an idea. Turn on auto mode and I\'ll handle everything — or give me a direction.' },
  ]);
  const [sending, setSending] = useState(false);
  // File d'attente des prompts : si l'IA est occupée, les nouveaux prompts s'empilent ici (FIFO)
  const [queue, setQueue] = useState<string[]>([]);
  const [companies, setCompanies] = useState<Company[]>([]);
  const [feed, setFeed] = useState<FeedItem[]>([]);
  const [slotsUsed, setSlotsUsed] = useState(0);
  const [maxSlots, setMaxSlots] = useState(5);
  const [loading, setLoading] = useState(true);
  const chatEndRef = useRef<HTMLDivElement>(null);
  const promptRef = useRef<HTMLTextAreaElement>(null);
  const chatScrollRef = useElasticScroll<HTMLDivElement>();
  const machineScrollRef = useElasticScroll<HTMLDivElement>();
  const portfolioScrollRef = useElasticScroll<HTMLDivElement>();

  // ── Largeurs redimensionnables des panneaux gauche / droite (en px) ──
  const containerRef = useRef<HTMLDivElement>(null);
  const [leftW, setLeftW] = useState(340);
  const [rightW, setRightW] = useState(360);
  const dragRef = useRef<null | { side: 'left' | 'right'; startX: number; startW: number }>(null);

  useEffect(() => {
    function onMove(e: PointerEvent) {
      const d = dragRef.current;
      if (!d) return;
      // [2026-09-13] Même correctif que le rectangle de preview du chat : si le
      // bouton a été relâché sans qu'on voie le pointerup (menu contextuel, clic
      // droit pendant le glissement…), on arrête au lieu de rester collé au
      // curseur avec la sélection de texte coupée.
      if (e.buttons === 0) { onUp(); return; }
      const total = containerRef.current?.clientWidth ?? window.innerWidth;
      const dx = e.clientX - d.startX;
      const MIN = 260;
      const CENTER_MIN = 320;
      if (d.side === 'left') {
        const max = total - rightW - CENTER_MIN;
        setLeftW(Math.max(MIN, Math.min(d.startW + dx, max)));
      } else {
        const max = total - leftW - CENTER_MIN;
        setRightW(Math.max(MIN, Math.min(d.startW - dx, max)));
      }
    }
    function onUp() {
      dragRef.current = null;
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    }
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onUp);
    window.addEventListener('contextmenu', onUp);
    window.addEventListener('blur', onUp);
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onUp);
      window.removeEventListener('contextmenu', onUp);
      window.removeEventListener('blur', onUp);
    };
  }, [leftW, rightW]);

  function startDrag(side: 'left' | 'right', e: React.PointerEvent) {
    e.preventDefault();
    dragRef.current = { side, startX: e.clientX, startW: side === 'left' ? leftW : rightW };
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
  }

  useEffect(() => { chatEndRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [chat]);

  // ── Chargement de l'état + feed depuis le backend, polling léger ──
  const refreshState = useCallback(async () => {
    try {
      const st: any = await api.moneyMaker.state();
      const queued: Company[] = (st.queue || [])
        .filter((q: any) => q.status === 'queued' && !q.companyId)
        .map((q: any) => {
          let p: any = {}; try { p = q.payload ? JSON.parse(q.payload) : {}; } catch {}
          return { id: `q_${q.id}`, name: p.name || 'Idea', emoji: '', type: p.projectType === 'mobile' ? 'mobile' : 'web', status: 'queued' as const, mrr: 0, totalRevenue: 0, note: p.niche || 'Queued' };
        });
      const live: Company[] = (st.companies || []).map((c: any) => ({
        id: c.id,
        name: c.name,
        emoji: '',
        type: c.projectType === 'mobile' ? 'mobile' : 'web',
        status: (['building', 'active', 'paused', 'killed'].includes(c.status) ? c.status : 'active') as Company['status'],
        mrr: c.mrr || 0,
        totalRevenue: c.totalRevenue || 0,
        note: c.description || c.industry || c.idea?.slice(0, 60) || '',
      }));
      setCompanies([...live, ...queued]);
      setSlotsUsed(st.slotsUsed || 0);
      setMaxSlots(st.maxSlots || 5);
      setAutoMode(!!st.config?.enabled);
      setEmailAutoSend(!!st.config?.emailAutoSend);
    } catch { /* not signed in / offline */ }
    finally { setLoading(false); }
  }, []);

  const refreshFeed = useCallback(async () => {
    try {
      const r: any = await api.moneyMaker.feed();
      const items: FeedItem[] = (r.feed || []).map((f: any) => ({
        id: f.id,
        kind: f.kind === 'agent' ? 'agent' : (RUN_KIND[f.type] || 'agent'),
        company: f.company || undefined,
        agent: f.agentRole ? (f.agentRole[0].toUpperCase() + f.agentRole.slice(1)) : undefined,
        text: f.detail ? `${f.title}\n${f.detail}` : f.title,
        time: timeAgo(f.at),
      }));
      setFeed(items);
    } catch { /* ignore */ }
  }, []);

  useEffect(() => {
    refreshState(); refreshFeed();
    const iv = setInterval(() => { refreshState(); refreshFeed(); }, 8000);
    return () => clearInterval(iv);
  }, [refreshState, refreshFeed]);

  async function onToggle(v: boolean) {
    setAutoMode(v);
    try { await api.moneyMaker.toggle(v); } catch {}
    refreshState(); refreshFeed();
  }

  async function onAction(id: string, action: 'pause' | 'resume' | 'kill' | 'boost' | 'restore') {
    if (id.startsWith('q_')) return;
    try { await api.moneyMaker.companyAction(id, action); } catch {}
    refreshState(); refreshFeed();
  }

  async function onEmailAutoSend(v: boolean) {
    setEmailAutoSend(v);
    try { await api.moneyMaker.updateConfig({ emailAutoSend: v }); } catch {}
  }

  // Met à jour un brouillon d'email dans le fil de chat (statut après envoi/rejet).
  function patchEmail(id: string, patch: Partial<EmailDraft>) {
    setChat(c => c.map(m => m.emails ? { ...m, emails: m.emails.map(e => e.id === id ? { ...e, ...patch } : e) } : m));
  }

  async function sendDraft(email: EmailDraft) {
    patchEmail(email.id, { status: 'sending' });
    try {
      const r: any = await api.moneyMaker.emails.send(email.id, email.fromName || undefined);
      if (r?.ok) {
        patchEmail(email.id, { status: 'sent' });
      } else {
        patchEmail(email.id, { status: 'draft' });
        setChat(c => [...c, { role: 'boss', text: `Failed to send to ${email.recipientEmail} (${r?.error || 'error'}). The draft is still available.` }]);
      }
    } catch {
      patchEmail(email.id, { status: 'draft' });
    }
    refreshFeed();
  }

  async function discardDraft(email: EmailDraft, reason?: string) {
    patchEmail(email.id, { status: 'discarded' });
    try { await api.moneyMaker.emails.discard(email.id, reason); } catch {}
  }

  async function acceptGoal() {
    try {
      await api.moneyMaker.acceptGoal();
      setChat(c => [...c, { role: 'boss', text: 'Goal accepted. I\'ve locked it into the Money Maker strategy and I\'ll judge companies against this target.' }]);
      refreshState(); refreshFeed();
    } catch {
      setChat(c => [...c, { role: 'boss', text: 'Impossible d\'accepter : aucune proposition en attente.' }]);
    }
  }

  const activeSlots = slotsUsed;
  const totalMrr = companies.reduce((s, c) => s + c.mrr, 0);
  const activeCount = companies.filter(c => c.status === 'active').length;
  const best = [...companies].sort((a, b) => b.mrr - a.mrr)[0];

  // Exécute réellement un prompt auprès de l'IA (utilise l'historique courant).
  async function runPrompt(msg: string) {
    const history = chat.slice(-6).map(m => ({ role: m.role === 'user' ? 'user' : 'assistant', content: m.text }));
    setChat(c => [...c, { role: 'user', text: msg }]);
    setSending(true);
    try {
      const r: any = await api.moneyMaker.chat(msg, history);
      setChat(c => [...c, { role: 'boss', text: r.reply || 'Ok.', goal: r.goal || null, spawned: Array.isArray(r.spawned) && r.spawned.length ? r.spawned : undefined, emails: Array.isArray(r.emails) && r.emails.length ? r.emails : undefined }]);
      refreshState(); refreshFeed();
    } catch {
      setChat(c => [...c, { role: 'boss', text: 'Connection issue — try again.' }]);
    } finally {
      setSending(false);
    }
  }

  // Soumission depuis le champ : si l'IA est occupée, le prompt part en file d'attente
  // (affiché au-dessus de la barre) au lieu d'être envoyé tout de suite.
  function send() {
    const msg = input.trim();
    if (!msg) return;
    setInput('');
    if (promptRef.current) promptRef.current.style.height = 'auto';
    if (sending) {
      setQueue(q => [...q, msg]);
    } else {
      runPrompt(msg);
    }
  }

  // Dès que l'IA se libère et qu'il reste des prompts en file, on lance le suivant (ordre strict FIFO).
  useEffect(() => {
    if (!sending && queue.length > 0) {
      const next = queue[0];
      setQueue(q => q.slice(1));
      runPrompt(next);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sending, queue]);

  // ── PANNEAU GAUCHE : chat boss ──
  const ChatPanel = (
    <div className="flex flex-col h-full" style={{ background: 'var(--surface-0)' }}>
      <div className="px-4 py-3 flex items-center justify-between shrink-0" style={{ borderBottom: '1px solid var(--border-subtle)' }}>
        <div className="flex items-center gap-2">
          <span className="w-6 h-6 flex items-center justify-center rounded-md text-[13px]" style={{ background: 'var(--surface-4)', color: 'var(--text-primary)', fontWeight: 700 }}>$</span>
          <div className="flex flex-col">
            <span className="text-[13px] font-semibold" style={{ color: 'var(--text-primary)' }}>Boss</span>
            <span className="text-[10px]" style={{ color: 'var(--text-ghost)' }}>Talk to the AI that runs everything</span>
          </div>
        </div>
      </div>

      {/* Toggle mode auto */}
      <div className="px-4 py-3 shrink-0" style={{ borderBottom: '1px solid var(--border-subtle)' }}>
        <div className="flex items-center justify-between rounded-lg px-3 py-2.5" style={{ background: 'var(--surface-2)', border: '1px solid', borderColor: autoMode ? 'var(--border-default)' : 'var(--border-subtle)' }}>
          <div className="flex flex-col">
            <span className="text-[12px] font-semibold" style={{ color: 'var(--text-primary)' }}>Auto mode</span>
            <span className="text-[10px]" style={{ color: 'var(--text-ghost)' }}>{autoMode ? 'The boss launches and manages on its own' : "Paused — you're in control"}</span>
          </div>
          <ToggleSwitch value={autoMode} onChange={onToggle} />
        </div>
        {/* Validation humaine des emails : ON = l'IA crée un brouillon à valider,
            OFF = l'IA envoie directement. */}
        <div className="flex items-center justify-between rounded-lg px-3 py-2.5 mt-2" style={{ background: 'var(--surface-2)', border: '1px solid var(--border-subtle)' }}>
          <div className="flex flex-col">
            <span className="text-[12px] font-semibold" style={{ color: 'var(--text-primary)' }}>Email validation</span>
            <span className="text-[10px]" style={{ color: 'var(--text-ghost)' }}>{emailAutoSend ? 'Send directly without validation' : 'Draft to validate before sending'}</span>
          </div>
          <ToggleSwitch value={!emailAutoSend} onChange={(v) => onEmailAutoSend(!v)} />
        </div>
      </div>

      {/* Messages */}
      <div ref={chatScrollRef} className="flex-1 overflow-y-auto px-4 py-4 space-y-3">
        {chat.map((m, i) => (
          <div key={i} className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}>
            <div className="max-w-[85%] rounded-2xl px-3.5 py-2.5 text-[12.5px] leading-relaxed" style={{
              background: m.role === 'user' ? 'var(--text-primary)' : 'var(--surface-2)',
              color: m.role === 'user' ? 'var(--surface-0)' : 'var(--text-secondary)',
              border: m.role === 'user' ? 'none' : '1px solid var(--border-subtle)',
            }}>
              <div>{m.text}</div>
              {m.goal?.needsAccept && m.goal.proposal && (
                <div className="mt-3 rounded-xl p-3" style={{ background: 'var(--surface-0)', border: '1px solid var(--border-default)' }}>
                  <div className="text-[10px] uppercase tracking-wide mb-1" style={{ color: 'var(--text-ghost)' }}>Realistic proposal</div>
                  <div className="text-[18px] font-bold" style={{ color: 'var(--text-primary)' }}>{money(m.goal.proposal.targetMrr)}/month</div>
                  <div className="text-[11px] mt-1" style={{ color: 'var(--text-ghost)' }}>{m.goal.proposal.deadline ? `Deadline: ${m.goal.proposal.deadline}` : 'Flexible deadline'}</div>
                  <p className="text-[11.5px] mt-2 leading-relaxed" style={{ color: 'var(--text-secondary)' }}>{m.goal.proposal.note}</p>
                  <button
                    onClick={acceptGoal}
                    className="mt-3 w-full h-8 rounded-lg text-[12px] font-semibold transition-all"
                    style={{ background: 'var(--btn-primary-bg)', color: 'var(--btn-primary-fg)' }}
                  >Accept</button>
                </div>
              )}
              {m.goal && !m.goal.needsAccept && (
                <div className="mt-3 rounded-xl p-3" style={{ background: 'var(--surface-0)', border: '1px solid var(--border-default)' }}>
                  <div className="text-[10px] uppercase tracking-wide mb-1" style={{ color: 'var(--text-ghost)' }}>Goal accepted</div>
                  <div className="text-[18px] font-bold" style={{ color: 'var(--text-primary)' }}>{money(m.goal.targetMrr)}/month</div>
                  <div className="text-[11px] mt-1" style={{ color: 'var(--text-ghost)' }}>{m.goal.deadline ? `Deadline: ${m.goal.deadline}` : 'Flexible deadline'}</div>
                </div>
              )}
              {m.spawned && m.spawned.length > 0 && (() => {
                // Retrouve les entreprises spawnées dans le portfolio pour l'aperçu cliquable.
                const cards = m.spawned
                  .map(name => companies.find(c => c.name === name))
                  .filter((c): c is Company => !!c);
                if (cards.length === 0) return null;
                return (
                  <div className="mt-3 flex flex-wrap gap-2">
                    {cards.map(co => <SitePreviewCard key={co.id} company={co} />)}
                  </div>
                );
              })()}
              {m.emails && m.emails.length > 0 && (
                <div className="mt-3 space-y-2">
                  {m.emails.map(email => (
                    <EmailCard key={email.id} email={email} onSend={() => sendDraft(email)} onDiscard={(reason) => discardDraft(email, reason)} />
                  ))}
                </div>
              )}
            </div>
          </div>
        ))}
        <div ref={chatEndRef} />
      </div>

      {/* Input */}
      <div className="px-3 py-3 shrink-0" style={{ borderTop: '1px solid var(--border-subtle)' }}>
        {/* File d'attente : prompts en attente pendant que l'IA travaille */}
        {queue.length > 0 && (
          <div className="mb-2 space-y-1.5">
            <div className="flex items-center gap-1.5 px-1">
              <span className="text-[9.5px] uppercase tracking-wide font-semibold" style={{ color: 'var(--text-ghost)' }}>Queued · {queue.length}</span>
              <span className="w-1 h-1 rounded-full animate-pulse" style={{ background: 'var(--text-ghost)' }} />
            </div>
            {queue.map((q, i) => (
              <div key={i} className="flex items-center gap-2 rounded-xl px-3 py-2 text-[12px]" style={{ background: 'var(--surface-2)', border: '1px dashed var(--border-default)', color: 'var(--text-secondary)' }}>
                <span className="w-4 h-4 flex items-center justify-center rounded text-[9px] font-bold shrink-0" style={{ background: 'var(--surface-4)', color: 'var(--text-primary)' }}>{i + 1}</span>
                <span className="flex-1 truncate">{q}</span>
                <button
                  onClick={() => setQueue(qq => qq.filter((_, idx) => idx !== i))}
                  className="shrink-0 opacity-50 hover:opacity-100 transition-opacity"
                  style={{ color: 'var(--text-ghost)' }}
                  title="Remove from queue"
                >
                  <svg width="12" height="12" viewBox="0 0 14 14" fill="none"><path d="M4 4L10 10M10 4L4 10" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/></svg>
                </button>
              </div>
            ))}
          </div>
        )}
        <div
          onMouseDown={e => {
            // Cliquer n'importe où dans la box (sauf sur un bouton) focus le champ.
            if ((e.target as HTMLElement).closest('button')) return;
            if (e.target !== promptRef.current) {
              e.preventDefault();
              promptRef.current?.focus();
            }
          }}
          className="rounded-2xl relative cursor-text"
          style={{
            background: 'var(--surface-3)',
            border: '1px solid var(--border-default)',
            transition: 'border-color 0.2s, box-shadow 0.2s',
            overflow: 'hidden',
          }}
        >
          <div className="px-4 pt-3 pb-1.5 relative">
            <textarea
              ref={promptRef}
              value={input}
              onChange={e => {
                setInput(e.target.value);
                const t = e.currentTarget;
                t.style.height = 'auto';
                t.style.height = Math.min(t.scrollHeight, 200) + 'px';
              }}
              onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } }}
              placeholder="Talk to the boss… (e.g. launch 3 productivity apps)"
              rows={2}
              className="w-full text-[14px] bg-transparent focus:outline-none resize-none leading-relaxed overflow-y-auto"
              style={{ color: 'var(--text-secondary)', minHeight: 46, maxHeight: 200 }}
            />
          </div>
          <div className="px-3.5 py-2 flex items-center gap-1.5">
            <div className="ml-auto flex items-center gap-1.5">
              <button
                onClick={send}
                disabled={!input.trim()}
                className="w-7 h-7 flex items-center justify-center rounded-md transition-all disabled:opacity-15"
                style={{ background: input.trim() ? 'var(--text-ghost)' : 'var(--surface-4)', color: input.trim() ? '#fff' : 'var(--text-ghost)' }}
              >
                <svg width="13" height="13" viewBox="0 0 14 14" fill="none">
                  <path d="M3 7H11M11 7L7.5 3.5M11 7L7.5 10.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                </svg>
              </button>
            </div>
          </div>
        </div>
        <p className="text-[10px] text-center mt-1.5" style={{ color: 'var(--border-hover)' }}>Enter to send · Shift+Enter for new line</p>
      </div>
    </div>
  );

  // ── PANNEAU CENTRE : salle des machines ──
  const MachinePanel = (
    <div className="flex flex-col h-full" style={{ background: 'var(--surface-1)' }}>
      <div className="px-4 py-3 flex items-center justify-between shrink-0" style={{ borderBottom: '1px solid var(--border-subtle)' }}>
        <div className="flex flex-col">
          <span className="text-[13px] font-semibold" style={{ color: 'var(--text-primary)' }}>Engine room</span>
          <span className="text-[10px]" style={{ color: 'var(--text-ghost)' }}>AIs think, talk to each other and modify companies</span>
        </div>
        <span className="flex items-center gap-1.5 text-[10px] px-2 py-1 rounded-full" style={{ background: 'var(--surface-3)', color: 'var(--text-secondary)', border: '1px solid var(--border-subtle)' }}>
          <span className="w-1.5 h-1.5 rounded-full animate-pulse" style={{ background: 'var(--text-primary)' }} /> Live
        </span>
      </div>
      <div ref={machineScrollRef} className="flex-1 overflow-y-auto px-4 py-4 space-y-3">
        {feed.length === 0 && (
          <div className="flex flex-col items-center justify-center h-full text-center px-6">
            <VelbazIcon state="idle" size={28} />
            <p className="text-[12px] mt-3" style={{ color: 'var(--text-ghost)' }}>
              {autoMode ? 'The boss is starting… trend research and AIs will appear here.' : 'Enable auto mode or talk to the boss to start the AIs.'}
            </p>
          </div>
        )}
        {feed.map(f => {
          const s = FEED_STYLE[f.kind];
          const isAgent = f.kind === 'agent';
          return (
            <div key={f.id} className="px-1 py-3" style={{ borderBottom: '1px solid var(--border-subtle)' }}>
              <div className="flex items-center gap-2 mb-1.5">
                <VelbazIcon state="idle" size={16} />
                {isAgent && f.agent ? (
                  <span className="text-[11px] font-semibold" style={{ color: '#6B97FF' }}>{f.agent}{f.company ? ` · ${f.company}` : ''}</span>
                ) : (
                  <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded" style={{ background: 'var(--surface-4)', color: 'var(--text-secondary)' }}>{s.label}{f.company ? ` · ${f.company}` : ''}</span>
                )}
                <span className="text-[9px] ml-auto" style={{ color: 'var(--text-ghost)' }}>{f.time}</span>
              </div>
              <p className="text-[12px] leading-relaxed whitespace-pre-wrap" style={{ color: 'var(--text-secondary)' }}>{f.text}</p>
            </div>
          );
        })}
      </div>
    </div>
  );

  // ── PANNEAU DROITE : portfolio ──
  const PortfolioPanel = (
    <div className="flex flex-col h-full" style={{ background: 'var(--surface-0)' }}>
      {/* Barre revenu */}
      <div className="px-4 py-3 shrink-0" style={{ borderBottom: '1px solid var(--border-subtle)' }}>
        <div className="grid grid-cols-3 gap-2">
          <div className="rounded-lg px-2.5 py-2" style={{ background: 'var(--surface-2)' }}>
            <div className="text-[9px] uppercase tracking-wide" style={{ color: 'var(--text-ghost)' }}>Total MRR</div>
            <div className="text-[15px] font-bold" style={{ color: 'var(--text-primary)' }}>{money(totalMrr)}</div>
          </div>
          <div className="rounded-lg px-2.5 py-2" style={{ background: 'var(--surface-2)' }}>
            <div className="text-[9px] uppercase tracking-wide" style={{ color: 'var(--text-ghost)' }}>Active</div>
            <div className="text-[15px] font-bold" style={{ color: 'var(--text-primary)' }}>{activeCount}</div>
          </div>
          <div className="rounded-lg px-2.5 py-2" style={{ background: 'var(--surface-2)' }}>
            <div className="text-[9px] uppercase tracking-wide" style={{ color: 'var(--text-ghost)' }}>Top</div>
            <div className="text-[13px] font-bold truncate" style={{ color: 'var(--text-primary)' }}>{best?.name || '—'}</div>
          </div>
        </div>
      </div>

      {/* Slots */}
      <div className="px-4 py-2.5 flex items-center justify-between shrink-0" style={{ borderBottom: '1px solid var(--border-subtle)' }}>
        <span className="text-[11px] font-semibold" style={{ color: 'var(--text-secondary)' }}>Companies</span>
        <span className="text-[10px] px-2 py-0.5 rounded-full" style={{ background: 'var(--surface-3)', color: 'var(--text-secondary)', border: '1px solid var(--border-subtle)', fontWeight: activeSlots >= maxSlots ? 700 : 500 }}>{activeSlots}/{maxSlots} active slots</span>
      </div>

      {/* Liste */}
      <div ref={portfolioScrollRef} className="flex-1 overflow-y-auto px-3 py-3 space-y-2">
        {!loading && companies.length === 0 && (
          <div className="flex flex-col items-center justify-center h-full text-center px-6">
            <span className="w-9 h-9 flex items-center justify-center rounded-lg text-[15px]" style={{ background: 'var(--surface-3)', color: 'var(--text-ghost)', fontWeight: 700 }}>$</span>
            <p className="text-[12px] mt-3" style={{ color: 'var(--text-ghost)' }}>No companies. Enable auto mode or tell the boss to launch a company.</p>
          </div>
        )}
        {companies.map(co => {
          const s = STATUS_STYLE[co.status];
          const isQueue = co.id.startsWith('q_');
          return (
            <div key={co.id} className="px-1 py-2.5" style={{ borderBottom: '1px solid var(--border-subtle)', opacity: co.status === 'killed' ? 0.6 : 1 }}>
              {(() => {
                const info = (
                  <>
                    <span className="w-8 h-8 rounded-lg flex items-center justify-center text-[13px] font-bold overflow-hidden shrink-0" style={{ background: co.logo ? 'transparent' : 'var(--surface-4)', color: 'var(--text-secondary)' }}>
                      {co.logo ? <img src={co.logo} alt={co.name} className="w-8 h-8 rounded-lg object-contain" /> : (co.name[0]?.toUpperCase() || '?')}
                    </span>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-1.5">
                        <span className="text-[12.5px] font-semibold truncate" style={{ color: 'var(--text-primary)' }}>{co.name}</span>
                        <span className="text-[9px] px-1.5 py-0.5 rounded" style={{ background: 'var(--surface-5)', color: 'var(--text-ghost)' }}>{co.type === 'mobile' ? '📱' : '🌐'} {co.type}</span>
                      </div>
                      <span className="text-[10px] truncate block" style={{ color: 'var(--text-ghost)' }}>{co.note}</span>
                    </div>
                    <div className="flex flex-col items-end shrink-0">
                      <span className="flex items-center gap-1 text-[9px] px-1.5 py-0.5 rounded-full font-medium" style={{ background: 'var(--surface-4)', color: s.strong ? 'var(--text-primary)' : 'var(--text-ghost)' }}>
                        <span className="w-1.5 h-1.5 rounded-full" style={{
                          background: s.dot === 'filled' ? 'var(--text-primary)' : s.dot === 'ring' ? 'transparent' : 'var(--text-ghost)',
                          border: s.dot === 'ring' ? '1.5px solid var(--text-primary)' : 'none',
                        }} />
                        {s.label}
                      </span>
                      {co.mrr > 0 && <span className="text-[11px] font-bold mt-1" style={{ color: 'var(--text-primary)' }}>{money(co.mrr)}/m</span>}
                    </div>
                  </>
                );
                // Entreprise réelle → toute la ligne info ouvre le site live dans un
                // nouvel onglet (vrai <a target="_blank">, jamais window.open).
                return isQueue ? (
                  <div className="flex items-center gap-2.5">{info}</div>
                ) : (
                  <a
                    href={`/api/companies/${co.id}/preview/`}
                    target="_blank"
                    rel="noopener noreferrer"
                    title={`Open ${co.name}'s website`}
                    className="flex items-center gap-2.5 rounded-lg -mx-1 px-1 py-0.5 transition-colors hover:bg-[var(--surface-2)]"
                  >
                    {info}
                  </a>
                );
              })()}
              {!isQueue && (
                <div className="flex items-center gap-1.5 mt-2 pl-[42px]">
                  {co.status === 'killed' ? (
                    <ActionBtn label="Restore" onClick={() => onAction(co.id, 'restore')} />
                  ) : (
                    <>
                      {co.status === 'paused'
                        ? <ActionBtn label="Resume" onClick={() => onAction(co.id, 'resume')} />
                        : <ActionBtn label="Pause" onClick={() => onAction(co.id, 'pause')} />}
                      <ActionBtn label="Boost" onClick={() => onAction(co.id, 'boost')} />
                      <ActionBtn label="Kill" onClick={() => onAction(co.id, 'kill')} />
                    </>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );

  // ── LAYOUT ──
  if (isMobile) {
    return (
      <div className="flex flex-col h-full" style={{ background: 'var(--surface-0)' }}>
        <div className="flex shrink-0" style={{ borderBottom: '1px solid var(--border-subtle)' }}>
          {([['chat', 'Boss'], ['machine', 'Machines'], ['portfolio', 'Portfolio']] as const).map(([k, label]) => (
            <button key={k} onClick={() => setMobileTab(k)} className="flex-1 py-2.5 text-[12px] font-semibold transition-colors relative"
              style={{ color: mobileTab === k ? 'var(--text-primary)' : 'var(--text-ghost)' }}>
              {label}
              {mobileTab === k && <span className="absolute bottom-0 left-0 right-0 h-0.5" style={{ background: 'var(--text-primary)' }} />}
            </button>
          ))}
        </div>
        <div className="flex-1 min-h-0">
          {mobileTab === 'chat' && ChatPanel}
          {mobileTab === 'machine' && MachinePanel}
          {mobileTab === 'portfolio' && PortfolioPanel}
        </div>
      </div>
    );
  }

  return (
    <div ref={containerRef} className="flex h-full overflow-hidden">
      <div style={{ width: leftW, flexShrink: 0, borderRight: '1px solid var(--border-subtle)' }}>{ChatPanel}</div>
      <ResizeHandle onPointerDown={e => startDrag('left', e)} />
      <div style={{ flex: 1, minWidth: 0 }}>{MachinePanel}</div>
      <ResizeHandle onPointerDown={e => startDrag('right', e)} />
      <div style={{ width: rightW, flexShrink: 0, borderLeft: '1px solid var(--border-subtle)' }}>{PortfolioPanel}</div>
    </div>
  );
}

// Petit bouton d'action neutre pour les cartes du portfolio.
function ActionBtn({ label, onClick }: { label: string; onClick: () => void }) {
  const [h, setH] = useState(false);
  return (
    <button
      onClick={onClick}
      onMouseEnter={() => setH(true)}
      onMouseLeave={() => setH(false)}
      className="text-[10px] px-2 py-0.5 rounded transition-colors"
      style={{
        background: h ? 'var(--surface-4)' : 'transparent',
        color: h ? 'var(--text-primary)' : 'var(--text-ghost)',
        border: '1px solid var(--border-subtle)',
      }}
    >{label}</button>
  );
}

// Carte d'un email rédigé par l'IA : aperçu + Envoyer / Rejeter.
const EMAIL_TYPE_LABEL: Record<string, string> = {
  prospection: 'Prospection', collab: 'Collaboration', promo: 'Promo',
  support: 'Support', relance: 'Relance', presse: 'Presse', autre: 'Email',
};
function _emailInitials(name: string): string {
  const parts = (name || '?').trim().split(/\s+/).filter(Boolean);
  const s = parts.length >= 2 ? parts[0][0] + parts[1][0] : (name || '?').slice(0, 2);
  return s.toUpperCase();
}

function EmailCard({ email, onSend, onDiscard }: { email: EmailDraft; onSend: () => void; onDiscard: (reason?: string) => void }) {
  const [open, setOpen] = useState(false);
  const [declineOpen, setDeclineOpen] = useState(false);
  const [reason, setReason] = useState('');
  const sent = email.status === 'sent';
  const discarded = email.status === 'discarded';
  const sending = email.status === 'sending';
  // Les boutons Accept/Decline n'apparaissent QUE tant que l'email attend une
  // validation (statut 'draft'). Un email déjà envoyé (auto ou manuel) n'en a pas.
  const needsValidation = email.status === 'draft';
  const brand = email.brandColor || '#6B97FF';

  function confirmDecline() {
    setDeclineOpen(false);
    onDiscard(reason.trim() || undefined);
    setReason('');
  }

  return (
    <div
      className="rounded-xl overflow-hidden"
      style={{ background: 'var(--surface-0)', border: '1px solid var(--border-default)', opacity: discarded ? 0.6 : 1 }}
    >
      {/* En-tête brandé façon email : couleur + expéditeur */}
      <div className="flex items-center gap-2.5 px-3 py-2.5" style={{ background: `linear-gradient(135deg, ${brand} 0%, ${brand}cc 100%)` }}>
        <div
          className="shrink-0 flex items-center justify-center rounded-lg text-[12px] font-extrabold"
          style={{ width: 30, height: 30, background: 'rgba(255,255,255,0.22)', color: '#fff' }}
        >{_emailInitials(email.fromName || '?')}</div>
        <div className="min-w-0 flex-1">
          <div className="text-[12px] font-bold text-white truncate">{email.fromName || 'Email'}</div>
          <div className="text-[9.5px] text-white/80 truncate">{EMAIL_TYPE_LABEL[email.type] || 'Email'}</div>
        </div>
        {sent && <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full" style={{ background: 'rgba(255,255,255,0.9)', color: '#1f8f52' }}>✓ Sent</span>}
        {discarded && <span className="text-[10px] font-medium px-2 py-0.5 rounded-full" style={{ background: 'rgba(255,255,255,0.85)', color: '#8a3d3d' }}>Declined</span>}
        {needsValidation && <span className="text-[10px] font-medium px-2 py-0.5 rounded-full" style={{ background: 'rgba(255,255,255,0.85)', color: brand }}>To validate</span>}
      </div>

      <div className="p-3">
        <div className="text-[10px] mb-0.5" style={{ color: 'var(--text-ghost)' }}>
          To: {email.recipientName ? `${email.recipientName} · ` : ''}{email.recipientEmail}
        </div>
        <div className="text-[12.5px] font-semibold mb-1" style={{ color: 'var(--text-primary)' }}>{email.subject}</div>
        <div
          className="text-[11.5px] leading-relaxed overflow-hidden email-body"
          style={{ color: 'var(--text-secondary)', maxHeight: open ? 'none' : 64 }}
          dangerouslySetInnerHTML={{ __html: email.body }}
        />
        {email.cta && (
          <div className="mt-2">
            <span className="inline-block text-[11px] font-semibold px-3 py-1.5 rounded-lg" style={{ background: brand, color: '#fff' }}>
              {email.cta.label} →
            </span>
          </div>
        )}
        <div className="flex items-center justify-between mt-1.5">
          <button onClick={() => setOpen(o => !o)} className="text-[10px]" style={{ color: 'var(--text-ghost)' }}>
            {open ? 'Collapse' : 'See all'}
          </button>
          {discarded && email.status === 'discarded' && <span className="text-[9px]" style={{ color: 'var(--text-ghost)' }}>Reason saved</span>}
        </div>

        {/* Boutons uniquement quand l'IA demande la validation */}
        {needsValidation && !declineOpen && (
          <div className="flex gap-2 mt-2.5">
            <button
              onClick={onSend}
              disabled={sending}
              className="flex-1 h-8 rounded-lg text-[12px] font-semibold text-white transition-all disabled:opacity-60"
              style={{ background: brand }}
            >Accept</button>
            <button
              onClick={() => setDeclineOpen(true)}
              disabled={sending}
              className="px-3 h-8 rounded-lg text-[12px] font-medium transition-all disabled:opacity-60"
              style={{ background: 'var(--surface-2)', color: 'var(--text-secondary)', border: '1px solid var(--border-subtle)' }}
            >Decline</button>
          </div>
        )}
        {sending && (
          <div className="mt-2.5 text-[11px] text-center" style={{ color: 'var(--text-ghost)' }}>Sending…</div>
        )}

        {/* Pop-up de refus : écrire pourquoi puis Decline */}
        {declineOpen && (
          <div className="mt-2.5 rounded-lg p-2.5" style={{ background: 'var(--surface-2)', border: '1px solid var(--border-subtle)' }}>
            <div className="text-[11px] font-semibold mb-1.5" style={{ color: 'var(--text-primary)' }}>Why decline this email?</div>
            <textarea
              autoFocus
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="E.g. too salesy, wrong recipient, rephrase the offer…"
              rows={3}
              className="w-full text-[11.5px] rounded-md p-2 resize-none outline-none"
              style={{ background: 'var(--surface-0)', color: 'var(--text-primary)', border: '1px solid var(--border-default)' }}
            />
            <div className="flex gap-2 mt-2">
              <button
                onClick={confirmDecline}
                className="flex-1 h-8 rounded-lg text-[12px] font-semibold text-white transition-all"
                style={{ background: '#D9534F' }}
              >Decline</button>
              <button
                onClick={() => { setDeclineOpen(false); setReason(''); }}
                className="px-3 h-8 rounded-lg text-[12px] font-medium transition-all"
                style={{ background: 'var(--surface-0)', color: 'var(--text-secondary)', border: '1px solid var(--border-subtle)' }}
              >Cancel</button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// Poignée de redimensionnement verticale entre deux panneaux.
function ResizeHandle({ onPointerDown }: { onPointerDown: (e: React.PointerEvent) => void }) {
  const [hover, setHover] = useState(false);
  return (
    <div
      onPointerDown={onPointerDown}
      onPointerEnter={() => setHover(true)}
      onPointerLeave={() => setHover(false)}
      className="shrink-0 self-stretch flex items-center justify-center"
      style={{ width: 8, cursor: 'col-resize', touchAction: 'none' }}
    >
      <div style={{ width: 2, height: '100%', background: hover ? 'var(--text-ghost)' : 'transparent', transition: 'background 120ms ease' }} />
    </div>
  );
}

// Switch identique à celui de la page Settings.
function ToggleSwitch({ value, onChange }: { value: boolean; onChange: (v: boolean) => void }) {
  const TRACK_W = 34;
  const TRACK_H = 20;
  const THUMB = 16;
  const PAD = 2;
  const TRAVEL = TRACK_W - THUMB - PAD * 2;
  const PILL_EXT = 2;
  const PRESS_EXT = 4;
  const PRESS_SHRINK = 4;

  const [hovered, setHovered] = useState(false);
  const [pressed, setPressed] = useState(false);

  const thumbW = pressed ? THUMB + PRESS_EXT : hovered ? THUMB + PILL_EXT : THUMB;
  const thumbH = pressed ? THUMB - PRESS_SHRINK : THUMB;
  const thumbY = pressed ? PAD + PRESS_SHRINK / 2 : PAD;
  const extra = thumbW - THUMB;
  const thumbX = value ? PAD + TRAVEL - extra : PAD;

  return (
    <button
      onClick={() => onChange(!value)}
      onPointerEnter={() => setHovered(true)}
      onPointerLeave={() => { setHovered(false); setPressed(false); }}
      onPointerDown={() => setPressed(true)}
      onPointerUp={() => setPressed(false)}
      className="relative shrink-0 rounded-full outline-none cursor-pointer select-none touch-none"
      style={{
        width: TRACK_W,
        height: TRACK_H,
        background: value
          ? (hovered ? '#5C89F2' : '#6B97FF')
          : (hovered ? 'var(--text-ghost)' : 'var(--border-default)'),
        transition: 'background 80ms ease',
      }}
    >
      <div
        className="absolute rounded-full"
        style={{
          width: thumbW,
          height: thumbH,
          top: thumbY,
          left: thumbX,
          background: '#fff',
          boxShadow: '0 1px 3px rgba(0,0,0,.2)',
          transition: 'all 160ms cubic-bezier(0.34, 1.56, 0.64, 1)',
        }}
      />
    </button>
  );
}
