import { useEffect, useRef, useState } from 'react';

// ─── Suivi discret du mode réflexion ─────────────────────────────────────────
// IMPORTANT (confidentialité produit) : ce panneau ne doit RIEN révéler de la
// mécanique interne — ni le nom des phases, ni leur nombre, ni les sorties
// intermédiaires, ni les variantes générées, ni les scores de l'auto-critique.
// L'utilisateur voit uniquement des tâches génériques (« Réflexion en cours »,
// « Création des visuels »…) pour que la méthode ne soit pas copiable en
// regardant simplement le chat.

export interface GenesisPhaseState {
  phase: number;
  title: string;
  status: 'pending' | 'running' | 'done';
  output?: string;
  ms?: number;
}

export interface GenesisAssetState {
  elementId: string;
  role: string;
  url: string;
  prompt: string;
  variant: number;
  score?: number;
  segmented?: boolean;
}

export interface GenesisCritiqueState {
  cycle: number;
  elementId: string;
  variant: number;
  concept: number;
  coherence: number;
  aiSignature: number;
  sensory: number;
  average: number;
  verdict: string;
  fixes: string[];
}

/** Une proposition de maquette soumise au clic de l'utilisateur. */
export interface GenesisChoiceState {
  runId: string;
  round: number;
  question: string;
  canAskMore: boolean;
  options: { id: string; url: string; score: number; label: string }[];
}

export interface GenesisRunState {
  runId: string;
  brief: string;
  status: 'running' | 'done' | 'error';
  /** Non nul quand le moteur attend que l'utilisateur choisisse une maquette. */
  choice?: GenesisChoiceState | null;
  phases: GenesisPhaseState[];
  assets: GenesisAssetState[];
  critiques: GenesisCritiqueState[];
  notes: string[];
  spec?: string;
  error?: string;
}

// Titres internes — conservés pour le typage de l'état, JAMAIS affichés.
export const GENESIS_PHASE_TITLES: { phase: number; title: string }[] = [
  { phase: 1, title: 'internal' },
  { phase: 2, title: 'internal' },
  { phase: 3, title: 'internal' },
  { phase: 4, title: 'internal' },
  { phase: 5, title: 'internal' },
  { phase: 6, title: 'internal' },
  { phase: 7, title: 'internal' },
  { phase: 8, title: 'internal' },
];

export function emptyGenesisRun(runId: string, brief: string): GenesisRunState {
  return {
    runId,
    brief,
    status: 'running',
    phases: GENESIS_PHASE_TITLES.map(p => ({ ...p, status: 'pending' as const })),
    assets: [],
    critiques: [],
    notes: [],
  };
}

// ── Tâches montrées à l'utilisateur ──────────────────────────────────────────
// Plusieurs étapes internes sont regroupées sous une même tâche générique : on
// ne laisse donc pas deviner le découpage réel du moteur.
const TASKS: { id: string; label: string; upTo: number }[] = [
  { id: 'think', label: 'Réflexion en cours', upTo: 4 },
  { id: 'visuals', label: 'Création des visuels', upTo: 6 },
  { id: 'final', label: 'Mise au propre', upTo: 8 },
];

// Petites icônes locales, identiques visuellement à celles des tâches du chat.
function GPCheckIcon({ className, style }: { className?: string; style?: React.CSSProperties }) {
  return (
    <svg className={className} style={style} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 8.5l3.2 3.2L13 4.8" />
    </svg>
  );
}
function GPDotIcon({ className, style }: { className?: string; style?: React.CSSProperties }) {
  return (
    <svg className={className} style={style} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6">
      <circle cx="8" cy="8" r="5" />
    </svg>
  );
}
function GPSubIcon({ className, style }: { className?: string; style?: React.CSSProperties }) {
  return (
    <svg className={className} style={style} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round">
      <path d="M4 8h8" />
    </svg>
  );
}

// ── Détail affiché sous chaque tâche ─────────────────────────────────────────
// Ce sont des libellés de HAUT NIVEAU sur la marque (ce à quoi l'IA réfléchit),
// jamais la mécanique interne : aucun nom de phase, aucun nombre d'étapes du
// moteur, aucune sortie brute, aucune variante, aucun score de critique.
const TASK_DETAILS: Record<string, string[]> = {
  think: [
    "Lecture de l'idée et de ce qu'elle promet",
    'Analyse du marché et des marques comparables',
    'Positionnement et public visé',
    'Angle de différenciation',
    'Nom, ton de voix et personnalité',
    'Direction artistique et palette',
    'Matières, formes et détails signature',
    'Structure des pages et parcours',
  ],
  visuals: [
    'Recherche des références visuelles',
    'Cadrage et composition des images',
    'Rendu des visuels de la marque',
    'Sélection des meilleurs rendus',
    'Retouches et détourage',
  ],
  final: [
    "Assemblage de l'univers de marque",
    'Vérification de la cohérence générale',
    'Relecture des textes et des détails',
    'Préparation de la construction',
  ],
};

export function GenesisPanel({ run }: { run: GenesisRunState }) {
  const doneCount = run.phases.filter(p => p.status === 'done').length;

  // Horloge locale : le détail de la tâche en cours se dévoile ligne par ligne
  // (une toutes les ~7 s) pour que ça vive, comme les étapes du chat normal.
  const [tick, setTick] = useState(0);
  useEffect(() => {
    if (run.status !== 'running') return;
    const t = setInterval(() => setTick(v => v + 1), 1000);
    return () => clearInterval(t);
  }, [run.status]);

  const startedAt = useRef<Record<string, number>>({});

  const taskStatus = (upTo: number, index: number): 'pending' | 'running' | 'done' | 'error' => {
    if (run.status === 'done') return 'done';
    if (doneCount >= upTo) return 'done';
    const prevUpTo = index === 0 ? 0 : TASKS[index - 1].upTo;
    if (doneCount >= prevUpTo) return run.status === 'error' ? 'error' : 'running';
    return 'pending';
  };

  // Détail d'une tâche : libellés génériques + (pour les visuels) les éléments
  // réellement produits, nommés côté marque.
  const detailsFor = (id: string): string[] => {
    const base = [...(TASK_DETAILS[id] || [])];
    if (id === 'visuals') {
      const seen = new Set<string>();
      for (const a of run.assets) {
        const label = (a.role || a.elementId || '').replace(/[_-]+/g, ' ').trim();
        if (!label || seen.has(label)) continue;
        seen.add(label);
        base.push(`Visuel « ${label} » prêt`);
      }
    }
    return base;
  };

  // Même rendu que les groupes de tâches du chat normal : une liste de lignes,
  // sans rectangle ni carte. La tâche en cours est en shimmer, celles déjà
  // faites restent affichées avec leur détail.
  return (
    <div className="w-full my-2 space-y-0.5">
      {TASKS.map((t, i) => {
        const st = taskStatus(t.upTo, i);
        if (st === 'pending') return null;
        const isRunning = st === 'running';
        const details = detailsFor(t.id);

        if (isRunning && !startedAt.current[t.id]) startedAt.current[t.id] = Date.now();
        const elapsed = isRunning ? (Date.now() - (startedAt.current[t.id] || Date.now())) / 1000 : 0;
        const shown = isRunning
          ? details.slice(0, Math.min(details.length, 1 + Math.floor(elapsed / 7)))
          : details;

        return (
          <div key={t.id} className="w-full">
            <div className="flex items-center gap-2 h-8 text-sm text-left">
              {st === 'done' ? (
                <GPCheckIcon className="w-3.5 h-3.5 shrink-0" style={{ color: 'var(--text-dim)' }} />
              ) : (
                <GPDotIcon className="w-3.5 h-3.5 shrink-0" style={{ color: 'var(--text-ghost)' }} />
              )}
              <span
                className={`shrink-0 text-[13px] ${isRunning ? 'an-tg-shimmer' : ''}`}
                style={isRunning ? undefined : { color: 'var(--text-muted)' }}
              >
                {t.label}
              </span>
              <span className="text-[13px] truncate min-w-0 flex-1" style={{ color: 'var(--text-ghost)' }}>
                {details.length > 1 ? ` · ${details.length} étapes` : ''}
              </span>
            </div>

            <div className="pl-5 space-y-0.5">
              {shown.map((d, j) => {
                const live = isRunning && j === shown.length - 1;
                return (
                  <div key={`${t.id}-${j}`} className={live ? 'build-live-step-enter' : ''}>
                    <div className="flex items-center gap-2 h-7 text-sm" style={{ color: 'var(--text-dim)' }}>
                      <GPSubIcon className="w-3.5 h-3.5 shrink-0" style={{ color: 'var(--text-ghost)' }} />
                      <span className={`truncate ${live ? 'an-tg-shimmer' : ''}`}>{d}</span>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        );
      })}
      {run.status === 'error' && run.error && (
        <div className="flex items-center gap-2 h-7 text-sm pl-5" style={{ color: 'var(--text-dim)' }}>
          <span className="truncate">{run.error}</span>
        </div>
      )}
      {tick < 0 && <span />}
    </div>
  );
}
