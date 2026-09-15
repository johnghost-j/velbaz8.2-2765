import { useState, useEffect, useCallback, useRef, useLayoutEffect } from 'react';
import { createPortal } from 'react-dom';
import { useLocation } from 'wouter';
import { useAuth } from '../lib/auth';
import { CreditsEmptyPopup } from '../components/CreditsEmptyPopup';
import { api } from '../lib/api';
import { onDragReset } from '../lib/drag-guard';
import { BRAND, TIER_MAX, TIER_PRO, TIER_LITE } from '../lib/brand';
import { useHomeStore } from '../lib/home-store';
import { GlobalVideoSlot, isMainVideoReady, subscribeMainVideoReady } from '../components/GlobalVideo';
import { useIsMobile, useIsLandscape } from '../lib/useIsMobile';
import { useVoiceInput } from '../lib/use-voice-input';
import { VoiceMicButton, VoiceOverlay } from '../components/VoiceMic';
import { AuthModal } from '../components/AuthModal';
import { VelbazIcon } from '../components/VelbazIcon';
import { PanelToggleButton } from '../components/PanelToggleButton';
import { CommandChip, SlashCommandMenu, filterSlashCommands } from '../components/SlashMenu';
import { PANEL_CARD } from '../lib/panel-card';
import {
  SPECIALISTS,
  ALL_COMPANY,
  needsPreview,
  type SpecialistId,
  CONTINUE_STORAGE_KEY,
} from '../lib/specialists';
import { useI18n } from '../lib/i18n';
import { toastError } from '../lib/toast';

// ── Static fallback ideas (shown before AI loads) ──
const FALLBACK_IDEAS = [
  'An AI agent that automates customer support for e-commerce stores',
  'A SaaS that manages freelancer invoices, contracts and payments',
  'A micro-investment app that rounds up purchases and invests the change',
];

// ─── Panneau « Continuer une company » ───
// Remplace la box de prompt : rectangle gris avec (1) un champ lien de site à
// analyser, (2) « ou » + un prompt plus foncé pour décrire, (3) le choix des
// experts (toute la company OU multi-sélection), (4) bouton Continuer en bas à droite.
function ContinuePanel(props: {
  url: string;
  setUrl: (v: string) => void;
  desc: string;
  setDesc: (v: string) => void;
  descRef: React.RefObject<HTMLTextAreaElement>;
  specialists: SpecialistId[];
  isAllCompany: boolean;
  toggleAllCompany: () => void;
  toggleSpecialist: (id: SpecialistId) => void;
  ready: boolean;
}) {
  const { url, setUrl, desc, setDesc, descRef, specialists, isAllCompany, toggleAllCompany, toggleSpecialist, ready } = props;
  const willPreview = needsPreview(specialists);
  const isMobile = useIsMobile();

  // ── Flux en 2 étapes ──
  // 1) On montre uniquement le lien du site + « ou » + la description.
  // 2) Après « Continuer », on révèle le choix des experts + le bouton final.
  const [step, setStep] = useState<1 | 2>(1);
  const step1Ready = url.trim().length > 0 || desc.trim().length > 0;

  // ── Morph de hauteur entre les étapes : le rectangle grandit/rétrécit en
  // douceur au lieu de se téléporter (supprime la saccade au clic « Continuer »).
  const panelRef = useRef<HTMLDivElement>(null);
  const prevH = useRef<number | null>(null);
  function goToStep(next: 1 | 2) {
    if (next === step) return;
    const el = panelRef.current;
    if (el) prevH.current = el.getBoundingClientRect().height;
    setStep(next);
  }
  useLayoutEffect(() => {
    const el = panelRef.current;
    if (!el || prevH.current == null) return;
    const from = prevH.current;
    prevH.current = null;
    const to = el.getBoundingClientRect().height;
    if (Math.abs(from - to) < 1) return;
    el.style.overflow = 'hidden';
    const anim = el.animate(
      [{ height: `${from}px` }, { height: `${to}px` }],
      { duration: 300, easing: 'cubic-bezier(0.4, 0, 0.2, 1)' },
    );
    const clear = () => { el.style.overflow = ''; };
    anim.onfinish = clear;
    anim.oncancel = clear;
  }, [step]);

  return (
    <div ref={panelRef}>
      <div
        key={step}
        className="px-5 pt-5 pb-1 continue-panel-in"
      >
        {step === 1 ? (
          <>
            {/* ── Lien du site à analyser ── */}
            <label className="block text-[12px] font-medium mb-1.5" style={{ color: 'var(--text-secondary)' }}>
              Your site link ({BRAND} analyzes it thoroughly)
            </label>
            <div
              className="flex items-center gap-2 px-3 h-11 rounded-xl"
              style={{ background: 'var(--surface-4)', border: '1px solid var(--border-subtle)' }}
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" style={{ color: 'var(--text-dim)', flexShrink: 0 }}>
                <circle cx="12" cy="12" r="10" /><line x1="2" y1="12" x2="22" y2="12" /><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
              </svg>
              <input
                type="url"
                value={url}
                onChange={e => setUrl(e.target.value)}
                onKeyDown={e => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    if (step1Ready) goToStep(2);
                  }
                }}
                placeholder="https://mon-entreprise.com"
                className="flex-1 bg-transparent text-[14px] focus:outline-none"
                style={{ color: 'var(--text-primary)', fontSize: isMobile ? 16 : undefined }}
              />
            </div>

            {/* ── Séparateur « ou » ── */}
            <div className="flex items-center gap-3 my-3.5">
              <div className="flex-1 h-px" style={{ background: 'var(--border-subtle)' }} />
              <span className="text-[13px] font-medium uppercase tracking-wide" style={{ color: 'var(--text-secondary)' }}>ou</span>
              <div className="flex-1 h-px" style={{ background: 'var(--border-subtle)' }} />
            </div>

            {/* ── Prompt plus foncé pour décrire ── */}
            <div
              className="rounded-xl px-4 py-3"
              style={{ background: 'var(--surface-0)', border: '1px solid var(--border-subtle)' }}
            >
              <textarea
                ref={descRef}
                value={desc}
                onChange={e => {
                  setDesc(e.target.value);
                  const ta = descRef.current;
                  if (ta) { ta.style.height = 'auto'; ta.style.height = Math.min(ta.scrollHeight, 130) + 'px'; }
                }}
                onKeyDown={e => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    if (step1Ready) setStep(2);
                  }
                }}
                placeholder="Describe your business and what you want to achieve… (Shift+Enter for a new line)"
                rows={2}
                className="w-full bg-transparent text-[14px] focus:outline-none resize-none leading-relaxed"
                style={{ color: 'var(--text-secondary)', maxHeight: 130, fontSize: isMobile ? 16 : undefined }}
              />
            </div>
          </>
        ) : (
          <>
            {/* ── Rappel + retour ── */}
            <div className="flex items-center gap-2 mb-4">
              <button
                type="button"
                onClick={() => setStep(1)}
                className="flex items-center justify-center w-8 h-8 rounded-full shrink-0 transition-all"
                style={{ background: 'var(--surface-4)', border: '1px solid var(--border-subtle)', color: 'var(--text-secondary)' }}
                aria-label="Back"
              >
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><line x1="19" y1="12" x2="5" y2="12" /><polyline points="12 19 5 12 12 5" /></svg>
              </button>
              <span className="text-[12.5px] truncate" style={{ color: 'var(--text-dim)' }}>
                {url.trim() ? url.trim() : desc.trim()}
              </span>
            </div>

            {/* ── Choix des experts ── */}
            <div className="text-[12px] font-medium mb-2" style={{ color: 'var(--text-secondary)' }}>
              What should {BRAND} help you with?&nbsp;
            </div>

            {/* Toute la company (exclusif) */}
            <button
              type="button"
              onClick={toggleAllCompany}
              className="w-full flex items-center gap-3 px-3.5 py-2.5 rounded-xl mb-2 text-left transition-all"
              style={{
                background: isAllCompany ? 'var(--teal-bg)' : 'var(--surface-3)',
                border: `1px solid ${isAllCompany ? 'var(--border-hover)' : 'var(--border-subtle)'}`,
              }}
            >
              <span
                className="w-4 h-4 rounded-full flex items-center justify-center shrink-0"
                style={{ border: `2px solid ${isAllCompany ? 'var(--text-primary)' : 'var(--border-default)'}`, background: isAllCompany ? 'var(--text-primary)' : 'transparent' }}
              >
                {isAllCompany && <svg width="8" height="8" viewBox="0 0 10 10" fill="none"><path d="M2 5L4 7L8 3" stroke="#06222E" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" /></svg>}
              </span>
              <span className="flex-1">
                <span className="block text-[13.5px] font-semibold" style={{ color: 'var(--text-primary)' }}>{ALL_COMPANY.label}</span>
                <span className="block text-[11.5px] mt-0.5" style={{ color: 'var(--text-dim)' }}>{ALL_COMPANY.desc}</span>
              </span>
            </button>

            {/* Experts spécialisés (multi-choix).
                Toujours cliquables : si « The whole company » est cochée, cliquer un
                expert le sélectionne ET décoche « The whole company » (voir toggleSpecialist). */}
            <div
              className="grid grid-cols-2 gap-2 transition-opacity"
              style={{ opacity: isAllCompany ? 0.65 : 1 }}
            >
              {SPECIALISTS.map(sp => {
                const active = specialists.includes(sp.id);
                return (
                  <button
                    key={sp.id}
                    type="button"
                    onClick={() => toggleSpecialist(sp.id)}
                    className="flex items-start gap-2 px-3 py-2 rounded-lg text-left transition-all"
                    style={{
                      background: active ? 'var(--teal-bg)' : 'var(--surface-3)',
                      border: `1px solid ${active ? 'var(--border-hover)' : 'var(--border-subtle)'}`,
                    }}
                  >
                    <span
                      className="w-3.5 h-3.5 rounded flex items-center justify-center shrink-0 mt-0.5"
                      style={{ border: `1.5px solid ${active ? 'var(--text-primary)' : 'var(--border-default)'}`, background: active ? 'var(--text-primary)' : 'transparent' }}
                    >
                      {active && <svg width="8" height="8" viewBox="0 0 10 10" fill="none"><path d="M2 5L4 7L8 3" stroke="#06222E" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" /></svg>}
                    </span>
                    <span className="flex-1 min-w-0">
                      <span className="block text-[12.5px] font-medium truncate" style={{ color: 'var(--text-primary)' }}>{sp.label}</span>
                      <span className="block text-[10.5px] mt-0.5 leading-tight" style={{ color: 'var(--text-dim)' }}>{sp.desc}</span>
                    </span>
                  </button>
                );
              })}
            </div>
          </>
        )}
      </div>

      {/* ── Barre du bas PERSISTANTE : même structure aux 2 étapes, rien ne saute ── */}
      <div className="px-5 pb-4 flex items-center justify-between gap-3">
        <span
          className="text-[11px] transition-opacity duration-300 truncate"
          style={{ color: 'var(--text-faint)', opacity: step === 2 ? 1 : 0, pointerEvents: 'none' }}
        >
          {willPreview ? 'Site preview enabled' : 'Expert mode — no site preview'}
        </span>
        {(() => {
          const active = step === 1 ? step1Ready : ready;
          return (
            <button
              type={step === 1 ? 'button' : 'submit'}
              onClick={step === 1 ? () => step1Ready && goToStep(2) : undefined}
              disabled={!active}
              className="flex items-center gap-2 px-4 h-9 rounded-full text-[13px] font-semibold transition-all disabled:opacity-40 shrink-0"
              style={{ background: active ? '#ffffff' : 'var(--surface-4)', color: active ? '#000000' : 'var(--text-dim)' }}
            >
              Continue
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><line x1="5" y1="12" x2="19" y2="12" /><polyline points="12 5 19 12 12 19" /></svg>
            </button>
          );
        })()}
      </div>
    </div>
  );
}

export default function Home() {
  const { t } = useI18n();
  const { user } = useAuth();
  const [, navigate] = useLocation();
  const [idea, setIdea] = useState(() => {
    try { return localStorage.getItem('velbaz_draft_idea') || ''; } catch { return ''; }
  });
  const [planMode, setPlanMode] = useState(false);
  const [showAuth, setShowAuth] = useState(false);
  // Panneau latéral droit (même bouton que dans le chat)
  const [panelOpen, setPanelOpen] = useState(false);

  // ── Persiste le brouillon du prompt : survit au refresh / changement de page ──
  useEffect(() => {
    try {
      if (idea.trim()) localStorage.setItem('velbaz_draft_idea', idea);
      else localStorage.removeItem('velbaz_draft_idea');
    } catch { /* stockage indisponible */ }
  }, [idea]);

  // ── Mode : créer une nouvelle company OU continuer une existante ──
  const [mode, setMode] = useState<'create' | 'continue'>('create');
  // Indicateur glissant du sélecteur de mode (mesure les largeurs réelles).
  const modeCreateRef = useRef<HTMLButtonElement>(null);
  const modeContinueRef = useRef<HTMLButtonElement>(null);
  const [modeIndicator, setModeIndicator] = useState<{ left: number; width: number }>({ left: 0, width: 0 });
  useLayoutEffect(() => {
    const el = mode === 'create' ? modeCreateRef.current : modeContinueRef.current;
    if (el) setModeIndicator({ left: el.offsetLeft, width: el.offsetWidth });
  }, [mode]);

  // ── Morph de hauteur : la box de prompt grandit/rétrécit au lieu de se téléporter ──
  const morphRef = useRef<HTMLDivElement>(null);
  const morphFromH = useRef<number | null>(null);
  function switchMode(next: 'create' | 'continue') {
    if (next === mode) return;
    const el = morphRef.current;
    if (el) morphFromH.current = el.getBoundingClientRect().height;
    setMode(next);
  }
  useLayoutEffect(() => {
    const el = morphRef.current;
    if (!el || morphFromH.current == null) return;
    const from = morphFromH.current;
    morphFromH.current = null;
    const to = el.getBoundingClientRect().height;
    if (Math.abs(from - to) < 1) return;
    el.animate(
      [{ height: `${from}px` }, { height: `${to}px` }],
      { duration: 360, easing: 'cubic-bezier(0.4, 0, 0.2, 1)' },
    );
  }, [mode]);

  const [contUrl, setContUrl] = useState('');
  const [contDesc, setContDesc] = useState('');
  const [contSpecialists, setContSpecialists] = useState<SpecialistId[]>(['all']);
  const contDescRef = useRef<HTMLTextAreaElement>(null);

  const isAllCompany = contSpecialists.includes('all');
  function toggleAllCompany() {
    setContSpecialists(isAllCompany ? [] : ['all']);
  }
  function toggleSpecialist(id: SpecialistId) {
    setContSpecialists(prev => {
      // Choisir un expert précis désactive « toute la company ».
      const base: SpecialistId[] = prev.filter(s => s !== 'all');
      return base.includes(id) ? base.filter(s => s !== id) : [...base, id];
    });
  }
  const continueReady =
    contSpecialists.length > 0 && (contUrl.trim().length > 0 || contDesc.trim().length > 0);

  function handleContinueSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!continueReady) return;
    const cfg = { url: contUrl.trim(), description: contDesc.trim(), specialists: contSpecialists };
    sessionStorage.setItem(CONTINUE_STORAGE_KEY, JSON.stringify(cfg));
    if (!user) { setShowAuth(true); return; }
    navigate('/chat');
  }
  const voice = useVoiceInput(useCallback((text: string, _isFinal?: boolean) => {
    setIdea(text);
  }, []));

  const { suggestedIdeas, companies, loaded, setSuggestedIdeas, setCompanies, setLoaded } = useHomeStore();

  // ── AI idea generation state ──
  const [ideaLoading, setIdeaLoading] = useState(false);
  const [ideaMode, setIdeaMode] = useState(false);

  // ── File attachment state ──
  type Attachment = { id: string; name: string; type: 'image' | 'document' | 'text'; data: string; mimeType: string; size: number; previewUrl?: string };
  const MAX_FILE_SIZE = 10 * 1024 * 1024;
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [isDragOver, setIsDragOver] = useState(false);
  const dragCounterRef = useRef(0);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  // ── Menu des commandes « / » (même comportement que dans le chat) ──
  const [slashOpen, setSlashOpen] = useState(false);
  // Commande active affichée en petit rectangle dans la barre de prompt.
  const [cmdChip, setCmdChip] = useState<string | null>(null);
  const cmdChipRef = useRef<HTMLSpanElement | null>(null);
  const [cmdChipW, setCmdChipW] = useState(0);
  useEffect(() => {
    if (!cmdChip) { setCmdChipW(0); return; }
    const id = requestAnimationFrame(() => setCmdChipW(cmdChipRef.current?.offsetWidth ?? 0));
    return () => cancelAnimationFrame(id);
  }, [cmdChip]);
  const [slashQuery, setSlashQuery] = useState('');
  const [slashIndex, setSlashIndex] = useState(0);
  const slashStartRef = useRef<number>(-1);
  const promptBoxRef = useRef<HTMLDivElement>(null); // ancre du menu "/" (box de prompt)
  const slashCommands = filterSlashCommands(slashQuery);
  const isMobile = useIsMobile();
  const isLandscape = useIsLandscape();

  // ── Reveal the whole page only once the background video is ready ──
  // Avoids showing a half-loaded state (UI without video). The site fades in
  // as one, so it always looks fully loaded.
  const [pageReady, setPageReady] = useState(isMainVideoReady());
  useEffect(() => {
    if (pageReady) return;
    return subscribeMainVideoReady(() => setPageReady(true));
  }, [pageReady]);

  // ── Model tier selector ──
  type ModelTier = 'max' | 'pro' | 'lite';
  // [2026-09-08] Défaut 'lite' (était 'max') — voir chat.tsx : éviter de
  // brûler des crédits opus sur du simple texte.
  const [modelTier, setModelTier] = useState<ModelTier>(() => (localStorage.getItem('velbaz_model_tier') as ModelTier) || 'lite');
  const [showModelPicker, setShowModelPicker] = useState(false);
  const [pickerClosing, setPickerClosing] = useState(false);
  const pickerCloseTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Le panneau s'ouvre SOUS le bouton -> on ancre par le haut.
  const [tierPickerPos, setTierPickerPos] = useState<{ top: number; right: number } | null>(null);
  const modelPickerRef = useRef<HTMLDivElement>(null);
  const modelBtnRef = useRef<HTMLButtonElement>(null);
  const MODEL_TIERS: { id: ModelTier; label: string; desc: string; tokens: string }[] = [
    { id: 'max',  label: TIER_MAX,  desc: 'Most powerful models',    tokens: '3× tokens' },
    { id: 'pro',  label: TIER_PRO,  desc: 'Good power/cost balance',  tokens: '2× tokens' },
    { id: 'lite', label: TIER_LITE, desc: 'Light and economical',            tokens: '1× tokens' },
  ];
  const currentTier = MODEL_TIERS.find(t => t.id === modelTier)!;

  // Ferme le sélecteur en jouant d'abord l'animation de sortie
  function closeTierPicker() {
    if (pickerClosing) return;
    setPickerClosing(true);
    if (pickerCloseTimer.current) clearTimeout(pickerCloseTimer.current);
    pickerCloseTimer.current = setTimeout(() => {
      setShowModelPicker(false);
      setPickerClosing(false);
    }, 95);
  }

  useEffect(() => () => { if (pickerCloseTimer.current) clearTimeout(pickerCloseTimer.current); }, []);

  function openTierPicker() {
    if (showModelPicker) { closeTierPicker(); return; }
    if (pickerCloseTimer.current) clearTimeout(pickerCloseTimer.current);
    setPickerClosing(false);
    if (modelBtnRef.current) {
      const r = modelBtnRef.current.getBoundingClientRect();
      // Ouverture vers le bas, avec clamp pour ne jamais sortir du viewport (panneau ~176px).
      setTierPickerPos({
        top: Math.min(r.bottom + 8, Math.max(8, window.innerHeight - 184)),
        right: window.innerWidth - r.right,
      });
    }
    setShowModelPicker(true);
  }

  useEffect(() => {
    if (!showModelPicker) return;
    const handler = (e: MouseEvent) => {
      if (modelPickerRef.current && !modelPickerRef.current.contains(e.target as Node) &&
          modelBtnRef.current && !modelBtnRef.current.contains(e.target as Node)) {
        closeTierPicker();
      }
    };
    document.addEventListener('click', handler);
    return () => document.removeEventListener('click', handler);
  }, [showModelPicker]);

  async function processFile(file: File): Promise<Attachment | null> {
    // [2026-09-15] Était un window.alert() bloquant, en anglais en dur.
    if (file.size > MAX_FILE_SIZE) { toastError(t('toast.fileTooLarge', { name: file.name })); return null; }
    const mimeType = file.type || 'application/octet-stream';
    let type: Attachment['type'] = 'document';
    if (mimeType.startsWith('image/')) type = 'image';
    else if (mimeType.startsWith('text/') || /\.(txt|md|csv|json|js|ts|jsx|tsx|py|html|css|yml|yaml|xml|sh|rb|go|java|c|cpp|rs)$/i.test(file.name)) type = 'text';
    return new Promise(resolve => {
      const reader = new FileReader();
      reader.onload = () => {
        const data = reader.result as string;
        resolve({ id: `att-${Date.now()}-${Math.random().toString(36).slice(2)}`, name: file.name, type, data, mimeType, size: file.size, previewUrl: type === 'image' ? data : undefined });
      };
      reader.onerror = () => resolve(null);
      reader.readAsDataURL(file);
    });
  }

  const lastDropTime = useRef(0);
  async function handleFilesSelected(files: FileList | File[]) {
    const now = Date.now();
    if (now - lastDropTime.current < 300) return;
    lastDropTime.current = now;
    const processed = await Promise.all(Array.from(files).map(processFile));
    const valid = processed.filter(Boolean) as Attachment[];
    setAttachments(prev => [...prev, ...valid]);
  }

  function removeAttachment(id: string) { setAttachments(prev => prev.filter(a => a.id !== id)); }

  function handlePaste(e: React.ClipboardEvent<HTMLTextAreaElement>) {
    const items = e.clipboardData?.items;
    if (!items) return;
    const imageItems = Array.from(items).filter(i => i.kind === 'file' && i.type.startsWith('image/'));
    if (imageItems.length === 0) return;
    e.preventDefault();
    const files = imageItems.map(i => i.getAsFile()).filter(Boolean) as File[];
    handleFilesSelected(files);
  }

  // ── Prevent browser default file drop ──
  useEffect(() => {
    // [2026-09-13] Uniquement pour les glissements de FICHIERS : voir la note
    // dans lib/drag-guard.ts (un preventDefault sur tous les dragover gardait
    // la session de glissement du navigateur ouverte et gelait la souris).
    const prevent = (e: DragEvent) => { if (e.dataTransfer?.types?.includes('Files')) e.preventDefault(); };
    document.addEventListener('dragover', prevent);
    document.addEventListener('drop', prevent);
    return () => { document.removeEventListener('dragover', prevent); document.removeEventListener('drop', prevent); };
  }, []);

  // Filet : la surcouche « Drop here » ne peut jamais rester affichée.
  useEffect(() => onDragReset(() => { dragCounterRef.current = 0; setIsDragOver(false); }), []);

  // ── Load user companies on mount ──
  useEffect(() => {
    if (loaded) return;
    if (user) {
      api.companies.list().then((res: any) => {
        const cos = res.companies || [];
        setCompanies(cos);
        setLoaded();
      }).catch(() => { setLoaded(); });
    } else {
      setLoaded();
    }
  }, [user, loaded]);

  // ── Generate AI ideas ──
  async function generateAIIdeas() {
    setIdeaLoading(true);
    setIdeaMode(true);
    try {
      const projects = companies.map((c: any) => ({
        name: c.name || '',
        industry: c.industry || '',
        idea: c.idea || '',
      }));
      const res: any = await api.ideas.generate(projects.length > 0 ? projects : undefined);
      const newIdeas = res.ideas || FALLBACK_IDEAS;
      setSuggestedIdeas(newIdeas);
    } catch {
      setSuggestedIdeas(FALLBACK_IDEAS);
    } finally {
      setIdeaLoading(false);
    }
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (idea.trim() || attachments.length > 0 || cmdChip) {
      sessionStorage.setItem('velbaz_idea', (cmdChip ? `/${cmdChip} ` : '') + idea);
      // Le prompt est lancé : on efface le brouillon persistant
      try { localStorage.removeItem('velbaz_draft_idea'); } catch { /* noop */ }
      // Transmet le mode plan au chat (bug corrigé : le toggle n'était jamais transmis)
      if (planMode) sessionStorage.setItem('velbaz_plan_mode', '1');
      else sessionStorage.removeItem('velbaz_plan_mode');
      if (attachments.length > 0) {
        sessionStorage.setItem('velbaz_attachments', JSON.stringify(attachments));
      }
      if (!user) {
        setShowAuth(true);
      } else {
        navigate('/chat');
      }
    }
  }

  // Détecte le « / » tapé dans la barre de prompt pour ouvrir le menu.
  function updateSlashFromInput(val: string, caret: number) {
    // Commande valide tapée à la main en tête de prompt → devient une puce.
    const typed = val.match(/^\/([a-zA-Z]+)[ \n]/);
    if (typed && !cmdChip && filterSlashCommands(typed[1]).some(c => c.cmd === typed[1].toLowerCase())) {
      setCmdChip(typed[1].toLowerCase());
      setIdea(val.slice(typed[0].length));
      setSlashOpen(false);
      slashStartRef.current = -1;
      return;
    }
    let start = -1;
    for (let i = caret - 1; i >= 0; i--) {
      const ch = val[i];
      if (ch === '/') {
        const prev = i === 0 ? '' : val[i - 1];
        if (i === 0 || prev === ' ' || prev === '\n') start = i;
        break;
      }
      if (ch === ' ' || ch === '\n') break;
    }
    if (start >= 0) {
      const query = val.slice(start + 1, caret);
      if (!/\s/.test(query)) {
        slashStartRef.current = start;
        setSlashQuery(query);
        setSlashIndex(0);
        setSlashOpen(true);
        return;
      }
    }
    if (slashOpen) { setSlashOpen(false); slashStartRef.current = -1; }
  }

  // Insère la commande choisie (ex. « /genesis ») dans la barre de prompt.
  function pickSlashCommand(cmd: string) {
    const start = slashStartRef.current;
    const el = textareaRef.current;
    const caret = el?.selectionStart ?? idea.length;
    const before = start >= 0 ? idea.slice(0, start) : idea;
    const after = start >= 0 ? idea.slice(caret) : '';
    // La commande devient une puce dans la barre — elle sort du texte tapé.
    setCmdChip(cmd);
    setIdea((before + after).replace(/^\s+/, ''));
    setSlashOpen(false);
    setSlashQuery('');
    slashStartRef.current = -1;
    setTimeout(() => textareaRef.current?.focus(), 0);
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (slashOpen && slashCommands.length > 0) {
      if (e.key === 'ArrowDown') { e.preventDefault(); setSlashIndex(i => (i + 1) % slashCommands.length); return; }
      if (e.key === 'ArrowUp') { e.preventDefault(); setSlashIndex(i => (i - 1 + slashCommands.length) % slashCommands.length); return; }
      if (e.key === 'Enter' || e.key === 'Tab') {
        e.preventDefault();
        pickSlashCommand(slashCommands[Math.min(slashIndex, slashCommands.length - 1)].cmd);
        return;
      }
    }
    if (slashOpen && e.key === 'Escape') { e.preventDefault(); setSlashOpen(false); slashStartRef.current = -1; return; }
    // Retour arrière au tout début du texte → retire la puce de commande.
    if (e.key === 'Backspace' && cmdChip && (textareaRef.current?.selectionStart ?? 0) === 0 && (textareaRef.current?.selectionEnd ?? 0) === 0) {
      e.preventDefault();
      setCmdChip(null);
      return;
    }
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSubmit(e as any);
    }
  }

  function useIdea(text: string) {
    setIdea(text);
  }

  // ── Skeleton pill for loading state ──
  function IdeaSkeleton({ index }: { index: number }) {
    // Vary widths to look organic
    const widths = [220, 260, 195];
    return (
      <div
        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full idea-skeleton-shimmer"
        style={{
          width: widths[index % 3],
          height: 32,
          background: 'var(--surface-3)',
          border: '1px solid var(--border-subtle)',
          animationDelay: `${index * 0.15}s`,
        }}
      >
        <div className="w-[11px] h-[11px] rounded-sm shrink-0" style={{ background: 'var(--border-default)' }} />
        <div className="flex-1 h-[10px] rounded-full" style={{ background: 'var(--border-default)', opacity: 0.5 }} />
      </div>
    );
  }

  return (
    <div
      className={`h-full flex flex-col relative ${(isMobile && isLandscape) || (isMobile && mode === 'continue') ? 'overflow-y-auto' : 'overflow-hidden'}`}
      style={{
        background: 'var(--surface-0)',
        opacity: pageReady ? 1 : 0,
        // Le panneau de droite POUSSE le contenu au lieu de passer par-dessus.
        paddingRight: !isMobile && user && panelOpen ? 280 : 0,
        transition: 'opacity 0.6s ease, padding-right 0.38s cubic-bezier(0.22, 1, 0.36, 1)',
      }}
    >
      {/* ─── Crédits épuisés — pop-up centrée au milieu de la page d'accueil ─── */}
      <CreditsEmptyPopup variant="center" />

      {!user && (
        <div className="flex items-center justify-end px-5 h-10 shrink-0 gap-3 relative z-10">
          <button type="button" onClick={() => navigate('/login')} className="text-[12px] transition-colors" style={{ color: 'var(--text-dim)', background: 'none', border: 'none', cursor: 'pointer' }}>Sign In</button>
          <button type="button" onClick={() => navigate('/register')} className="text-[12px] font-medium px-3 py-1.5 rounded-md transition-colors" style={{ background: 'var(--text-secondary)', color: 'var(--surface-0)', border: 'none', cursor: 'pointer' }}>Get Started</button>
        </div>
      )}

      <div className={`flex items-start justify-center px-6 relative z-10 ${isMobile ? 'w-full shrink-0 py-3' : 'flex-1 overflow-y-auto py-8'}`}>
        <div className="w-full max-w-[620px]" style={{ marginTop: isMobile ? '2vh' : '9vh' }}>
          <div className={isMobile ? 'mb-4' : 'mb-6'} style={{ display: 'grid' }}>
            {([
              { id: 'create' as const, title: 'What should we build?', sub: 'Describe your idea. ' + BRAND + ' handles everything else.' },
              { id: 'continue' as const, title: 'Let\'s continue your business', sub: 'Share your site + choose your experts. ' + BRAND + ' picks up and develops.' },
            ]).map(h => {
              const active = mode === h.id;
              return (
              <div
                key={h.id}
                style={{
                  gridArea: '1 / 1',
                  opacity: active ? 1 : 0,
                  transform: active ? 'translateY(0)' : 'translateY(10px)',
                  transition: 'opacity 0.38s cubic-bezier(0.4,0,0.2,1), transform 0.38s cubic-bezier(0.4,0,0.2,1)',
                  willChange: 'opacity, transform',
                  pointerEvents: active ? 'auto' : 'none',
                }}
              >
                <h1 className="text-[38px] md:text-[48px] font-medium tracking-tight text-center mb-3 leading-[1.12]" style={{ color: 'var(--text-primary)' }}>{h.title}</h1>
                <p className="text-[14px] text-center" style={{ color: 'var(--text-dim)' }}>{h.sub}</p>
              </div>
              );
            })}
          </div>

          {/* ── Sélecteur de mode : créer / continuer ── */}
          <div className="flex justify-center mb-5">
            <div
              className="relative inline-flex p-1 rounded-full"
              style={{ background: 'var(--surface-3)', border: '1px solid var(--border-subtle)' }}
            >
              {/* Indicateur qui glisse d'un onglet à l'autre */}
              <span
                aria-hidden
                className="absolute top-1 bottom-1 rounded-full pointer-events-none"
                style={{
                  left: modeIndicator.left,
                  width: modeIndicator.width,
                  background: 'var(--surface-0)',
                  boxShadow: '0 1px 6px rgba(0,0,0,0.25)',
                  transition: 'left 0.32s cubic-bezier(0.34,1.4,0.5,1), width 0.32s cubic-bezier(0.34,1.4,0.5,1)',
                }}
              />
              {([
                { id: 'create' as const, label: 'Create a company', ref: modeCreateRef },
                { id: 'continue' as const, label: 'Continue a company', ref: modeContinueRef },
              ]).map(m => (
                <button
                  key={m.id}
                  ref={m.ref}
                  type="button"
                  onClick={() => switchMode(m.id)}
                  className="relative z-10 px-4 h-8 rounded-full text-[12.5px] font-medium transition-colors"
                  style={{
                    color: mode === m.id ? 'var(--text-primary)' : 'var(--text-dim)',
                  }}
                >
                  {m.label}
                </button>
              ))}
            </div>
          </div>

          <form onSubmit={mode === 'create' ? handleSubmit : handleContinueSubmit}>
            <div className="relative">
            {/* Live voice panel — floats ABOVE the bar (outside overflow:hidden box) */}
            {mode === 'create' && voice.isListening && <VoiceOverlay voiceBars={voice.voiceBars} onStop={voice.stopListening} />}
            {/* Box unique et persistante : la même box devient le rectangle gris. */}
            <div
              ref={promptBoxRef}
              className="rounded-3xl relative"
              onDragOver={(e) => { if (mode !== 'create') return; e.preventDefault(); e.stopPropagation(); }}
              onDragEnter={(e) => { if (mode !== 'create') return; e.preventDefault(); e.stopPropagation(); if (e.dataTransfer?.types.includes('Files')) { dragCounterRef.current += 1; setIsDragOver(true); } }}
              onDragLeave={(e) => { if (mode !== 'create') return; e.preventDefault(); e.stopPropagation(); dragCounterRef.current -= 1; if (dragCounterRef.current <= 0) { dragCounterRef.current = 0; setIsDragOver(false); } }}
              onDrop={(e) => { if (mode !== 'create') return; e.preventDefault(); e.stopPropagation(); dragCounterRef.current = 0; setIsDragOver(false); if (e.dataTransfer?.files?.length) handleFilesSelected(e.dataTransfer.files); }}
              style={{
                background: 'var(--surface-3)',
                border: `1px solid ${isDragOver ? 'var(--text-primary)' : voice.isListening && mode === 'create' ? 'var(--text-primary)' : 'var(--border-default)'}`,
                boxShadow: isDragOver ? '0 0 0 3px rgba(45,212,191,0.15)' : voice.isListening && mode === 'create' ? '0 0 24px rgba(255,255,255,0.1)' : '0 8px 30px rgba(0,0,0,0.24)',
                transition: 'border-color 0.2s, box-shadow 0.2s',
                overflow: 'hidden',
              }}
            >
              <div ref={morphRef} style={{ overflow: 'hidden' }}>
              {mode === 'continue' ? (
                <ContinuePanel
                  url={contUrl}
                  setUrl={setContUrl}
                  desc={contDesc}
                  setDesc={setContDesc}
                  descRef={contDescRef}
                  specialists={contSpecialists}
                  isAllCompany={isAllCompany}
                  toggleAllCompany={toggleAllCompany}
                  toggleSpecialist={toggleSpecialist}
                  ready={continueReady}
                />
              ) : (
              <div className="mode-content-in">
              {/* Drag overlay */}
              {isDragOver && (
                <div className="absolute inset-0 z-20 flex flex-col items-center justify-center gap-1 rounded-3xl pointer-events-none" style={{ background: 'rgba(45,212,191,0.07)' }}>
                  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" style={{ color: 'var(--text-secondary)' }}><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/><polyline points="17 8 12 3 7 8" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/><line x1="12" y1="3" x2="12" y2="15" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/></svg>
                  <span className="text-[12px] font-medium" style={{ color: 'var(--teal)' }}>Drop here</span>
                </div>
              )}

              {/* Attachment previews */}
              {attachments.length > 0 && (
                <div className="px-4 pt-3 flex flex-wrap gap-2">
                  {attachments.map(att => (
                    <div key={att.id} className="relative flex items-center gap-1.5 rounded-lg overflow-hidden" style={{ background: 'var(--surface-4)', border: '1px solid var(--border)', maxWidth: 160 }}>
                      {att.type === 'image' && att.previewUrl ? (
                        <img src={att.previewUrl} alt={att.name} className="w-10 h-10 object-cover flex-shrink-0" style={{ borderRight: '1px solid var(--border)' }} />
                      ) : (
                        <div className="w-10 h-10 flex items-center justify-center flex-shrink-0 text-[10px] font-semibold" style={{ background: 'var(--surface-3)', color: 'var(--teal)', borderRight: '1px solid var(--border)' }}>
                          {att.type === 'document' ? 'PDF' : att.name.split('.').pop()?.toUpperCase()?.slice(0, 4) || 'FILE'}
                        </div>
                      )}
                      <span className="text-[11px] truncate pr-5 py-1" style={{ color: 'var(--text-secondary)', maxWidth: 80 }}>{att.name}</span>
                      <button type="button" onClick={() => removeAttachment(att.id)} className="absolute top-0 right-0 w-4 h-4 flex items-center justify-center rounded-bl-md" style={{ background: 'var(--surface-3)', color: 'var(--text-dim)', fontSize: 10, lineHeight: 1 }}>×</button>
                    </div>
                  ))}
                </div>
              )}

              <div className="px-5 pt-4 pb-2 relative">
                {cmdChip && (
                  <span style={{ position: 'absolute', left: 20, top: 17, zIndex: 2 }}>
                    <CommandChip innerRef={cmdChipRef} cmd={cmdChip} onRemove={() => { setCmdChip(null); textareaRef.current?.focus(); }} />
                  </span>
                )}
                {slashOpen && (
                  <SlashCommandMenu
                    anchor={promptBoxRef.current}
                    commands={slashCommands}
                    index={slashIndex}
                    setIndex={setSlashIndex}
                    onPick={pickSlashCommand}
                    onClose={() => { setSlashOpen(false); slashStartRef.current = -1; }}
                  />
                )}
                <textarea
                  ref={textareaRef}
                  value={idea}
                  onChange={e => {
                    setIdea(e.target.value);
                    updateSlashFromInput(e.target.value, e.target.selectionStart ?? e.target.value.length);
                    const ta = textareaRef.current;
                    if (ta) {
                      ta.style.height = 'auto';
                      const newH = Math.min(ta.scrollHeight, 140);
                      ta.style.height = newH + 'px';
                    }
                  }}
                  onKeyDown={handleKeyDown}
                  onPaste={handlePaste}
                  placeholder={voice.isListening ? 'Parle maintenant...' : voice.isTranscribing ? '' : "Type your idea here..."}
                  rows={1}
                  className="w-full text-[15px] bg-transparent focus:outline-none resize-none leading-relaxed relative z-[1]"
                  style={{ color: voice.isListening ? 'var(--text-dim)' : 'var(--text-secondary)', overflow: 'hidden', transition: 'height 0.15s ease', maxHeight: 140, fontSize: isMobile ? 16 : undefined, textIndent: cmdChip ? cmdChipW + 6 : 0 }}
                />
                {voice.isTranscribing && (
                  <div className="absolute inset-0 flex items-center px-5 gap-2" style={{ color: 'var(--text-dim)', fontSize: 14 }}>
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ animation: 'spin 1s linear infinite', flexShrink: 0 }}>
                      <path d="M21 12a9 9 0 1 1-6.219-8.56" />
                    </svg>
                    Transcription en cours...
                  </div>
                )}
              </div>
              <div className="px-4 pb-3 flex items-center gap-2">
                {/* Attach button */}
                <div className="relative w-7 h-7">
                  <div className="w-7 h-7 flex items-center justify-center rounded-md" style={{ color: 'var(--text-dim)' }}>
                    <svg width="15" height="15" viewBox="0 0 15 15" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
                      <path d="M7.5 2.5V12.5M2.5 7.5H12.5" />
                    </svg>
                  </div>
                  <input
                    ref={fileInputRef}
                    type="file"
                    multiple
                    accept="image/*,.pdf,.txt,.md,.csv,.json,.js,.ts,.jsx,.tsx,.py,.html,.css,.yml,.yaml,.xml,.sh,.rb,.go,.java,.c,.cpp,.rs"
                    onChange={e => { if (e.target.files?.length) { handleFilesSelected(e.target.files); e.target.value = ''; } }}
                    style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', opacity: 0, cursor: 'pointer', fontSize: 0 }}
                    title="Attach file"
                  />
                </div>
                <div className="flex-1" />
                <button
                  ref={modelBtnRef}
                  type="button"
                  onClick={openTierPicker}
                  className="flex items-center gap-1 px-2.5 py-1 rounded-md text-[12px] transition-all hover:opacity-80"
                  style={{ background: 'var(--surface-4)', color: 'var(--text-dim)' }}
                  title="Choisir le mode"
                >
                  <span>{currentTier.label}</span>
                  <svg width="10" height="10" viewBox="0 0 10 10" fill="none"><path d="M2.5 4L5 6.5L7.5 4" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round"/></svg>
                </button>
                {showModelPicker && tierPickerPos && createPortal(
                  <div
                    ref={modelPickerRef}
                    className={`rounded-xl shadow-xl ${pickerClosing ? 'animate-popover-out-down' : 'animate-popover-in-down'}`}
                    style={{
                      position: 'fixed',
                      top: tierPickerPos.top,
                      right: tierPickerPos.right,
                      background: 'var(--surface-1)',
                      border: '1px solid var(--border)',
                      minWidth: 210,
                      overflow: 'hidden',
                      zIndex: 100000,
                    }}
                  >
                    {MODEL_TIERS.map(tier => (
                      <button
                        key={tier.id}
                        type="button"
                        onClick={() => {
                          setModelTier(tier.id);
                          localStorage.setItem('velbaz_model_tier', tier.id);
                          closeTierPicker();
                        }}
                        className="w-full flex items-center justify-between px-4 py-2.5 text-left transition-all hover:opacity-80"
                        style={{
                          background: modelTier === tier.id ? 'var(--surface-3)' : 'transparent',
                          color: 'var(--text-primary)',
                        }}
                      >
                        <div>
                          <div className="text-[13px] font-medium">{tier.label}</div>
                          <div className="text-[11px] mt-0.5" style={{ color: 'var(--text-faint)' }}>{tier.desc}</div>
                        </div>
                        <div className="text-[11px] ml-3 shrink-0" style={{ color: 'var(--text-faint)' }}>{tier.tokens}</div>
                      </button>
                    ))}
                  </div>,
                  document.body
                )}
                {/* Plan mode toggle */}
                <button
                  type="button"
                  onClick={() => setPlanMode(p => !p)}
                  className="flex items-center justify-center px-4 h-7 rounded-full text-[12px] font-medium transition-all hover:opacity-80"
                  style={{
                    // Actif = noir (comme le bouton envoyer), plus bleu. En thème sombre le token
                    // s'inverse en clair, sinon la pastille serait invisible sur le fond sombre.
                    background: planMode ? 'var(--btn-primary-bg)' : 'var(--surface-4)',
                    color: planMode ? 'var(--btn-primary-fg)' : 'var(--text-dim)',
                  }}
                  title={planMode ? 'Plan mode enabled — the AI creates a plan before working' : 'Enable plan mode'}
                >
                  Plan
                </button>
                {/* Barre de prompte vide -> bouton dictée ; dès qu'il y a du texte (ou une pièce jointe) -> bouton envoyer */}
                {(idea.trim() || attachments.length > 0) ? (
                  <button
                    type="submit"
                    disabled={voice.isTranscribing}
                    className="w-8 h-8 flex items-center justify-center rounded-full transition-all disabled:opacity-40"
                    style={{ background: '#ffffff', color: '#000000' }}
                  >
                    {/* Flèche vers la DROITE, trait fin */}
                    <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round"><line x1="5" y1="12" x2="19" y2="12"/><polyline points="12 5 19 12 12 19"/></svg>
                  </button>
                ) : (
                  <VoiceMicButton isListening={voice.isListening} onClick={voice.toggle} size={8} />
                )}
              </div>
              </div>
              )}
              </div>
            </div>
            </div>
          </form>

          {/* ── Idea Suggestions Area (create mode only) ── */}
          <div
            aria-hidden={mode !== 'create'}
            style={{
              opacity: mode === 'create' ? 1 : 0,
              maxHeight: mode === 'create' ? 600 : 0,
              overflow: 'hidden',
              pointerEvents: mode === 'create' ? 'auto' : 'none',
              transition: 'opacity 0.3s ease, max-height 0.42s cubic-bezier(0.4,0,0.2,1)',
            }}
          >
          <>
          <div className="flex flex-wrap justify-center gap-2 mt-4">
            {ideaLoading ? (
              /* ── Loading skeletons: same shape as idea pills ── */
              <>
                {[0, 1, 2].map(i => (
                  <IdeaSkeleton key={i} index={i} />
                ))}
                <div className="w-full flex justify-center mt-1">
                  <div className="flex items-center gap-2 text-[11px]" style={{ color: 'var(--text-ghost)' }}>
                    <VelbazIcon state="thinking" size={16} />
                    <span>{BRAND} is thinking of ideas{companies.length > 0 ? ' based on your projects' : ''}...</span>
                  </div>
                </div>
              </>
            ) : (
              /* ── Real ideas ── */
              <>
                {suggestedIdeas.map((s, i) => (
                  <button
                    key={`${s}-${i}`}
                    type="button"
                    onClick={() => useIdea(s)}
                    className={`inline-flex items-center gap-1.5 text-[12px] px-3 py-1.5 rounded-full transition-all text-left ${ideaMode ? 'idea-fade-in' : ''}`}
                    style={{
                      color: 'var(--text-dim)',
                      border: '1px solid var(--border-default)',
                      animationDelay: ideaMode ? `${i * 0.1}s` : undefined,
                    }}
                    onMouseEnter={e => { e.currentTarget.style.background = 'var(--surface-3)'; e.currentTarget.style.color = 'var(--text-secondary)'; }}
                    onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = 'var(--text-dim)'; }}
                  >
                    <svg width="11" height="11" viewBox="0 0 11 11" fill="none" stroke="currentColor" strokeWidth="1.1" strokeLinecap="round" strokeLinejoin="round">
                      <rect x="1.5" y="1.5" width="8" height="8" rx="1.5" />
                    </svg>
                    {s.length > 55 ? s.slice(0, 55) + '...' : s}
                  </button>
                ))}

                {/* ── Idea Mode Button ── */}
                <button
                  type="button"
                  onClick={generateAIIdeas}
                  disabled={ideaLoading}
                  className="inline-flex items-center gap-1.5 text-[12px] px-3 py-1.5 rounded-full transition-all group"
                  style={{
                    color: ideaMode ? 'var(--text-primary)' : 'var(--text-ghost)',
                    border: `1px solid ${ideaMode ? 'var(--border-hover)' : 'var(--border-subtle)'}`,
                    background: ideaMode ? 'var(--surface-3)' : 'transparent',
                  }}
                  onMouseEnter={e => { e.currentTarget.style.background = ideaMode ? 'var(--surface-4)' : 'var(--surface-3)'; e.currentTarget.style.color = ideaMode ? 'var(--text-primary)' : 'var(--text-secondary)'; }}
                  onMouseLeave={e => { e.currentTarget.style.background = ideaMode ? 'var(--surface-3)' : 'transparent'; e.currentTarget.style.color = ideaMode ? 'var(--text-primary)' : 'var(--text-ghost)'; }}
                >
                  <VelbazIcon state={ideaMode ? 'thinking' : 'idle'} size={14} />
                  {ideaMode ? 'More AI ideas' : 'Idea mode'}
                </button>
              </>
            )}
          </div>

          {user && companies.length > 0 && ideaMode && !ideaLoading && (
            <p className="text-[10px] text-center mt-2 idea-fade-in" style={{ color: 'var(--blue-accent)', opacity: 0.6 }}>
              Personalized based on your {companies.length} project{companies.length > 1 ? 's' : ''}
            </p>
          )}
          </>
          </div>
        </div>
      </div>

      {/* Video : desktop = épinglée en bas ; mobile = dans le flux, scrolle avec le contenu */}
      <div
        className={`pointer-events-none video-section ${isMobile ? 'relative w-full shrink-0' : 'absolute inset-x-0 bottom-0'}`}
        style={{
          height: isMobile ? 300 : 500,
          zIndex: 0,
          marginTop: isMobile ? -270 : undefined,
          // Desktop : entre 770px et 1280px la vidéo descend (plus basse) ;
          // plus la largeur augmente, moins elle est basse → 0 à 1280px et au-delà.
          bottom: isMobile ? undefined : 'clamp(-130px, calc(25.49vw - 326.28px), 0px)',
        }}
      >
        <div
          className="absolute inset-x-0 top-0 video-fade-overlay"
          style={{
            height: isMobile ? 130 : 160,
            zIndex: 2,
          }}
        />
        <GlobalVideoSlot visible={true} />
        {/* Fondu vers noir pur en bas (mobile) pour supprimer le gris */}
        {isMobile && (
          <div
            className="absolute inset-x-0 bottom-0 pointer-events-none video-bottom-fade"
            style={{
              height: 180,
              zIndex: 3,
            }}
          />
        )}
      </div>
      {/* Aplat solide sous la vidéo (mobile) — couleur du thème, cf. .video-below-fill */}
      {isMobile && (
        <div className="w-full flex-1 shrink-0 pointer-events-none video-below-fill" style={{ minHeight: 24, zIndex: 0 }} />
      )}

      {/* Footer : liens légaux */}
      <div
        className={`${isMobile ? 'relative w-full shrink-0 py-6' : 'absolute inset-x-0 bottom-0 py-3'} flex flex-wrap items-center justify-center gap-x-4 gap-y-1.5 px-4`}
        style={{ zIndex: 20 }}
      >
        <a href="/legal/terms" className="text-[11px] transition-colors hover:opacity-100" style={{ color: 'var(--text-dim)', opacity: 0.75 }}>Terms</a>
        <a href="/legal/privacy" className="text-[11px] transition-colors hover:opacity-100" style={{ color: 'var(--text-dim)', opacity: 0.75 }}>Privacy</a>
        <a href="/legal/cookies" className="text-[11px] transition-colors hover:opacity-100" style={{ color: 'var(--text-dim)', opacity: 0.75 }}>Cookies</a>
        <a href="/legal/refund" className="text-[11px] transition-colors hover:opacity-100" style={{ color: 'var(--text-dim)', opacity: 0.75 }}>Refunds</a>
        <a href="/legal/acceptable-use" className="text-[11px] transition-colors hover:opacity-100" style={{ color: 'var(--text-dim)', opacity: 0.75 }}>Acceptable Use</a>
        <a href="/legal/legal-notice" className="text-[11px] transition-colors hover:opacity-100" style={{ color: 'var(--text-dim)', opacity: 0.75 }}>Legal Notice</a>
        <span className="text-[11px]" style={{ color: 'var(--text-dim)', opacity: 0.5 }}>© {new Date().getFullYear()} {BRAND}</span>
      </div>

      {/* ─── Bouton flottant à DROITE + panneau qui vient de la droite ─── */}
      {!isMobile && user && (
        <PanelToggleButton
          open={panelOpen}
          onClick={() => setPanelOpen(v => !v)}
          style={{
            position: 'absolute',
            top: 12,
            right: panelOpen ? 292 : 12,
            zIndex: 90,
            transition: 'right 0.4s cubic-bezier(0.22, 1, 0.36, 1), transform 0.2s, box-shadow 0.2s, background 0.15s',
          }}
        />
      )}

      {!isMobile && user && (
        <div
          style={{
            position: 'absolute', top: 0, bottom: 0, right: 0, width: 280, zIndex: 85,
            background: 'transparent', borderLeft: 'none',
            boxShadow: 'none',
            transform: panelOpen ? 'translateX(0)' : 'translateX(100%)',
            transition: 'transform 0.38s cubic-bezier(0.22, 1, 0.36, 1)',
            display: 'flex', flexDirection: 'column', overflowY: 'auto',
            pointerEvents: panelOpen ? 'auto' : 'none',
          }}
        >
          <div style={{ padding: '14px 14px 8px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexShrink: 0 }}>
            <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)' }}>Context</span>
            <button
              onClick={() => setPanelOpen(false)}
              title="Fermer"
              style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-ghost)', display: 'flex', padding: 4 }}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="9 18 15 12 9 6" /></svg>
            </button>
          </div>

          {/* Sections en cartes séparées (pas un seul bloc) */}
          <div style={{ padding: '4px 10px 12px', display: 'flex', flexDirection: 'column', gap: 10 }}>
            <div style={PANEL_CARD}>
              <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-secondary)' }}>Canvas</div>
            </div>

            <div style={PANEL_CARD}>
              <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-secondary)' }}>Model Preference</div>
              <div style={{ fontSize: 11, color: 'var(--text-ghost)', marginTop: 2 }}>Applied across all Agent mode chats.</div>
            </div>
          </div>
        </div>
      )}

      <AuthModal
        open={showAuth}
        onClose={() => setShowAuth(false)}
        onSuccess={() => {
          setShowAuth(false);
          navigate('/chat');
        }}
      />
    </div>
  );
}
