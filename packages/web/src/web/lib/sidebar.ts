import { create } from 'zustand';

interface Project {
  id: string;
  name: string;
  createdAt: Date;
  /** Brand logo (data URI or CDN URL) — shown next to the project name. */
  logo?: string;
  /** True while the AI is still generating the real project name. */
  loading?: boolean;
}

interface SidebarState {
  collapsed: boolean;
  projects: Project[];
  /** False until the project list has been fetched at least once from the API. */
  projectsLoaded: boolean;
  /** Mobile drawer open/closed state (shared so the page content can shift). */
  mobileOpen: boolean;
  /** Live swipe progress 0..1 while dragging the drawer; null when not dragging. */
  mobileDrag: number | null;
  toggle: () => void;
  addProject: (p: Project) => void;
  updateProject: (id: string, patch: Partial<Project>) => void;
  setProjects: (ps: Project[]) => void;
  setProjectsLoaded: (v: boolean) => void;
  setMobileOpen: (v: boolean) => void;
  setMobileDrag: (v: number | null) => void;
}

const CACHE_KEY = 'velbaz_projects_cache';

/** Read the cached project list so the sidebar renders instantly on reload. */
function readCache(): Project[] {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    if (!raw) return [];
    const arr = JSON.parse(raw);
    if (!Array.isArray(arr)) return [];
    return arr.map((c: any) => ({
      id: c.id,
      name: c.name,
      logo: c.logo || '',
      createdAt: new Date(c.createdAt),
    }));
  } catch {
    return [];
  }
}

/** Persist the project list (without transient flags) for instant next load. */
function writeCache(ps: Project[]) {
  try {
    const slim = ps
      .filter((p) => !p.loading)
      .map((p) => ({ id: p.id, name: p.name, logo: p.logo || '', createdAt: p.createdAt }));
    localStorage.setItem(CACHE_KEY, JSON.stringify(slim));
  } catch {
    /* ignore quota / SSR */
  }
}

const cached = typeof window !== 'undefined' ? readCache() : [];

/**
 * Vide l'historique de projets affiché à gauche + son cache disque.
 * Appelé à la déconnexion : sans ça, la liste du compte précédent restait
 * visible (elle est lue depuis localStorage au chargement du store).
 */
export function clearProjectsCache(): void {
  try {
    localStorage.removeItem(CACHE_KEY);
    // caches par projet (état des réseaux sociaux, etc.) du compte quitté
    for (const k of Object.keys(localStorage)) {
      if (k.startsWith('velbaz_social_') || k.startsWith('velbaz_projects')) localStorage.removeItem(k);
    }
  } catch {
    /* quota / SSR */
  }
  try {
    useSidebar.setState({ projects: [], projectsLoaded: false });
  } catch {
    /* store pas encore prêt */
  }
}

export const useSidebar = create<SidebarState>((set) => ({
  collapsed: false,
  projects: cached,
  // If we have a cache, consider the list "loaded" for UI purposes so we never
  // flash an empty/skeleton state; the background refresh will reconcile it.
  projectsLoaded: cached.length > 0,
  mobileOpen: false,
  mobileDrag: null,
  toggle: () => set((s) => ({ collapsed: !s.collapsed })),
  setMobileOpen: (v) => set({ mobileOpen: v }),
  setMobileDrag: (v) => set({ mobileDrag: v }),
  addProject: (p) =>
    set((s) => {
      const next = [p, ...s.projects.filter((x) => x.id !== p.id)];
      writeCache(next);
      return { projects: next };
    }),
  updateProject: (id, patch) =>
    set((s) => {
      const next = s.projects.map((x) => (x.id === id ? { ...x, ...patch } : x));
      writeCache(next);
      return { projects: next };
    }),
  setProjects: (ps) => {
    writeCache(ps);
    set({ projects: ps });
  },
  setProjectsLoaded: (v) => set({ projectsLoaded: v }),
}));
