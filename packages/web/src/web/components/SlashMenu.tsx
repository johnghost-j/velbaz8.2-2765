// ─── Menu des commandes « / » ────────────────────────────────────────────────
// Rectangle qui s'ouvre AU-DESSUS de la barre de prompt (home et chat) dès que
// l'utilisateur tape « / ». Il liste les commandes disponibles ; taper des
// lettres après le « / » filtre la liste (ex. « /g » → genesis). Un clic (ou
// Entrée) insère la commande dans la barre de prompt.
//
// Il est rendu dans un portail en position `fixed`, ancré sur la box de prompt :
// comme ça il flotte VRAIMENT au-dessus de la box et n'est jamais rogné par le
// `overflow` de celle-ci. Sa largeur est bornée (pas de rectangle inutilement
// large sur l'axe X).
//
// Fermeture : Échap, ou tout clic en dehors du menu et de la box de prompt
// (`onClose`) — donc dès que le curseur d'écriture quitte la box, le menu part.
import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

export interface SlashCommand {
  cmd: string;
  label: string;
  desc: string;
}

export const SLASH_COMMANDS: SlashCommand[] = [
  { cmd: 'genesis', label: '/genesis', desc: 'Prend le temps de réfléchir avant de créer' },
  { cmd: 'test1', label: '/test1', desc: "Agent autonome : il écrit ses propres tâches et livre une boutique" },
  { cmd: 'test2', label: '/test2', desc: "Visualise chaque page en image, puis construit le site d'après ces images" },
];

// Filtre par le texte tapé après le « / » (préfixe, puis contenu).
export function filterSlashCommands(query: string): SlashCommand[] {
  const q = query.trim().toLowerCase();
  if (!q) return SLASH_COMMANDS;
  const starts = SLASH_COMMANDS.filter(c => c.cmd.toLowerCase().startsWith(q));
  const rest = SLASH_COMMANDS.filter(c => !c.cmd.toLowerCase().startsWith(q) && c.cmd.toLowerCase().includes(q));
  return [...starts, ...rest];
}

const MENU_WIDTH = 320; // largeur fixe, volontairement compacte

function BoltIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" style={{ flexShrink: 0, color: 'var(--text-dim)' }}>
      <path d="M13 2L4.5 13.5H11L10 22L18.5 10.5H12L13 2Z" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" />
    </svg>
  );
}

// Petit rectangle affiché DANS la barre de prompt quand une commande valide est
// active (ex. « /genesis »). Cliquer sur la croix la retire.
export function CommandChip({ cmd, onRemove, innerRef }: { cmd: string; onRemove: () => void; innerRef?: React.Ref<HTMLSpanElement> }) {
  return (
    <span
      ref={innerRef}
      className="inline-flex items-center gap-1 h-[21px] pl-2 pr-0.5 rounded-md text-[12.5px] font-medium align-middle animate-popover-in"
      style={{
        background: 'var(--surface-4)',
        border: '1px solid var(--border-subtle)',
        color: 'var(--text-dim)',
        whiteSpace: 'nowrap',
      }}
    >
      /{cmd}
      <button
        type="button"
        onMouseDown={(e) => { e.preventDefault(); onRemove(); }}
        className="w-4 h-4 flex items-center justify-center rounded hover:opacity-70 shrink-0"
        style={{ color: 'currentColor' }}
        title="Retirer la commande"
      >
        <svg width="9" height="9" viewBox="0 0 10 10" fill="none"><path d="M2 2L8 8M8 2L2 8" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round"/></svg>
      </button>
    </span>
  );
}

// Une ligne de la liste — icône + titre, description en dessous si présente.
export function SlashRow({
  label, desc, active, onHover, onPick,
}: { label: string; desc?: string; active: boolean; onHover: () => void; onPick: () => void }) {
  return (
    <button
      type="button"
      onMouseEnter={onHover}
      onMouseDown={(e) => { e.preventDefault(); onPick(); }}
      className="w-full flex items-center gap-3 px-3 py-2.5 text-left rounded-xl transition-colors"
      style={{ background: active ? 'var(--surface-3)' : 'transparent' }}
    >
      <BoltIcon />
      <span className="min-w-0 flex-1">
        <span className="block text-[14px] font-medium truncate" style={{ color: 'var(--text-primary)' }}>{label}</span>
        {desc && <span className="block text-[12px] truncate mt-[1px]" style={{ color: 'var(--text-faint)' }}>{desc}</span>}
      </span>
    </button>
  );
}

// Suit la position de l'élément d'ancrage (box de prompt) : recalcule à chaque
// frame tant que le menu est ouvert (scroll, resize, ouverture du panneau…).
function useAnchorRect(anchor: HTMLElement | null) {
  const [rect, setRect] = useState<DOMRect | null>(null);
  useEffect(() => {
    if (!anchor) return;
    let raf = 0;
    const update = () => {
      setRect(anchor.getBoundingClientRect());
      raf = requestAnimationFrame(update);
    };
    update();
    return () => cancelAnimationFrame(raf);
  }, [anchor]);
  return rect;
}

// Coquille du menu : rectangle arrondi flottant au-dessus de la box de prompt.
export function SlashMenuShell({
  anchor, children, onClose,
}: { anchor: HTMLElement | null; children: React.ReactNode; onClose?: () => void }) {
  const rect = useAnchorRect(anchor);
  const menuRef = useRef<HTMLDivElement | null>(null);

  // Clic en dehors (n'importe où sauf le menu et la box de prompt) → on ferme.
  useEffect(() => {
    if (!onClose) return;
    const onDown = (e: MouseEvent | TouchEvent) => {
      const t = e.target as Node | null;
      if (!t) return;
      if (menuRef.current?.contains(t)) return;
      if (anchor?.contains(t)) return;
      onClose();
    };
    document.addEventListener('mousedown', onDown, true);
    document.addEventListener('touchstart', onDown, true);
    return () => {
      document.removeEventListener('mousedown', onDown, true);
      document.removeEventListener('touchstart', onDown, true);
    };
  }, [anchor, onClose]);

  if (typeof document === 'undefined') return null;

  // Position par défaut si l'ancre n'est pas encore mesurée.
  const left = rect ? Math.max(12, Math.min(rect.left, window.innerWidth - MENU_WIDTH - 12)) : 12;
  const bottom = rect ? Math.max(12, window.innerHeight - rect.top + 10) : 100;

  return createPortal(
    <div
      ref={menuRef}
      className="fixed rounded-2xl z-[10000] overflow-hidden animate-popover-in"
      style={{
        left,
        bottom,
        width: MENU_WIDTH,
        background: 'var(--surface-2)',
        border: '1px solid var(--border-subtle)',
        maxHeight: 320,
        display: 'flex',
        flexDirection: 'column',
      }}
    >
      <div className="p-2 overflow-y-auto flex flex-col gap-0.5" style={{ maxHeight: 316 }}>
        {children}
      </div>
    </div>,
    document.body,
  );
}

// Menu complet « commandes seules » (utilisé sur la home).
export function SlashCommandMenu({
  anchor, commands, index, setIndex, onPick, onClose,
}: {
  anchor: HTMLElement | null;
  commands: SlashCommand[];
  index: number;
  setIndex: (i: number) => void;
  onPick: (cmd: string) => void;
  onClose?: () => void;
}) {
  return (
    <SlashMenuShell anchor={anchor} onClose={onClose}>
      {commands.length === 0 ? (
        <div className="px-3 py-5 text-center text-[12px]" style={{ color: 'var(--text-faint)' }}>Aucune commande</div>
      ) : commands.map((c, i) => (
        <SlashRow
          key={c.cmd}
          label={c.label}
          desc={c.desc}
          active={i === index}
          onHover={() => setIndex(i)}
          onPick={() => onPick(c.cmd)}
        />
      ))}
    </SlashMenuShell>
  );
}
