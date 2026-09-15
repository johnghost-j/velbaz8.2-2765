// ─── Recherche de l'INTÉRIEUR d'une app (clone 100%) ─────────────────────────
// Quand on clone une APP (pas juste une landing), l'essentiel est derrière le
// login : dashboard, éditeur, générateur IA, galerie de templates, paramètres…
// Firecrawl ne voit que le mur de connexion. On reconstruit donc l'intérieur en
// CHERCHANT SUR LE WEB des captures réelles de ces écrans (docs officielles,
// reviews, YouTube thumbnails, articles) → l'IA de code sait alors à quoi
// ressemble chaque écran interne et le recrée à l'identique visuellement.
//
// Best-effort : ne throw jamais, dégrade proprement si aucune image trouvée.

import { imageSearchResults, type ImageResult } from './web-tools';

export interface InteriorScreen {
  /** Nom lisible de l'écran (ex: « Éditeur / Générateur d'app »). */
  name: string;
  /** Requêtes qui ont servi à le trouver. */
  query: string;
  /** Captures réelles trouvées sur le web (URLs). */
  images: { url: string; caption?: string; source?: string }[];
}

export interface AppInteriorResearch {
  appName: string;
  /** Écrans internes reconstruits depuis la recherche d'images. */
  screens: InteriorScreen[];
  /** Toutes les routes internes découvertes (à recréer). */
  discoveredRoutes: { path: string; label: string }[];
  notes: string[];
}

export interface InteriorPreviewEvent {
  id: string;
  label: string;
  preview?: {
    kind: 'browse' | 'screenshot' | 'search' | 'code' | 'analyze';
    imageUrl?: string;
    url?: string;
    caption?: string;
  };
}

/** Déduit un nom de marque exploitable depuis le nom du site ou l'URL. */
function deriveAppName(rootUrl: string, siteName?: string): string {
  const clean = (siteName || '').trim();
  if (clean && clean.length <= 40) return clean;
  try {
    const host = new URL(rootUrl).hostname.replace(/^www\./, '');
    return host.split('.')[0];
  } catch {
    return clean || 'app';
  }
}

// Les écrans internes typiques d'une app SaaS / app-builder à reconstruire.
// Chaque écran a plusieurs requêtes (on prend la 1ʳᵉ qui donne des résultats).
function screenQueries(app: string, host: string): { name: string; queries: string[] }[] {
  return [
    { name: 'Tableau de bord / Dashboard', queries: [`${app} dashboard interface screenshot`, `${host} dashboard ui`, `${app} workspace screenshot`] },
    { name: 'Éditeur / Générateur (cœur du produit)', queries: [`${app} app builder editor screenshot`, `${app} editor interface`, `${host} editor ui screenshot`] },
    { name: 'Chat / Prompt IA', queries: [`${app} AI chat prompt interface screenshot`, `${app} generate app prompt ui`] },
    { name: 'Galerie de templates / apps', queries: [`${app} templates gallery screenshot`, `${app} apps gallery ui`] },
    { name: 'Paramètres / Profil / Facturation', queries: [`${app} settings billing screenshot`, `${app} account settings ui`] },
  ];
}

/**
 * Recherche l'intérieur d'une app : pour chaque écran interne clé, cherche des
 * captures réelles sur le web. Renvoie une recherche structurée + les routes
 * découvertes, prête à être injectée dans le brief de clonage.
 */
export async function researchAppInterior(
  rootUrl: string,
  opts?: {
    siteName?: string;
    discoveredRoutes?: { path: string; label: string }[];
    perScreen?: number;      // nb d'images par écran (défaut 3)
    onPreview?: (e: InteriorPreviewEvent) => void;
    deadlineMs?: number;     // budget temps global
  },
): Promise<AppInteriorResearch> {
  const emit = opts?.onPreview ?? (() => {});
  const perScreen = Math.min(Math.max(opts?.perScreen ?? 3, 1), 6);
  const deadline = Date.now() + (opts?.deadlineMs ?? 45000);
  let host = rootUrl;
  try { host = new URL(rootUrl).hostname.replace(/^www\./, ''); } catch { /* noop */ }
  const appName = deriveAppName(rootUrl, opts?.siteName);

  const research: AppInteriorResearch = {
    appName,
    screens: [],
    discoveredRoutes: opts?.discoveredRoutes || [],
    notes: [],
  };

  const specs = screenQueries(appName, host);
  emit({ id: 'interior-start', label: `Recherche de l'intérieur de ${appName}`, preview: { kind: 'search', caption: `Reconstruction des écrans internes de ${appName}` } });

  const globalSeen = new Set<string>();
  for (const spec of specs) {
    if (Date.now() > deadline) { research.notes.push('Budget temps atteint — recherche interrompue.'); break; }
    let found: ImageResult[] = [];
    let usedQuery = spec.queries[0];
    for (const q of spec.queries) {
      if (Date.now() > deadline) break;
      const r = await imageSearchResults(q, perScreen + 3);
      const fresh = r.filter((i) => !globalSeen.has(i.url));
      if (fresh.length) { found = fresh; usedQuery = q; break; }
    }
    if (!found.length) continue;
    const images = found.slice(0, perScreen).map((i) => {
      globalSeen.add(i.url);
      return { url: i.url, caption: i.title, source: i.source };
    });
    research.screens.push({ name: spec.name, query: usedQuery, images });
    emit({
      id: `interior-${spec.name}`,
      label: `Écran trouvé : ${spec.name}`,
      preview: { kind: 'screenshot', imageUrl: images[0].url, caption: `${appName} — ${spec.name}` },
    });
  }

  if (!research.screens.length) {
    research.notes.push("Aucune capture d'écran interne trouvée sur le web — reconstruis l'intérieur à partir des conventions du secteur et des indices de la landing.");
  }
  return research;
}

/** Formate la recherche d'intérieur en section de brief pour l'IA de code. */
export function formatAppInteriorBrief(r: AppInteriorResearch): string {
  if (!r) return '';
  const lines: string[] = [];
  lines.push(`\n\n═══════════════════════════════════════════════════════`);
  lines.push(`🔒 INTÉRIEUR DE L'APP — RECONSTRUIS-LE À L'IDENTIQUE (écrans derrière login)`);
  lines.push(`App : ${r.appName}`);
  lines.push(`Ce clone n'est PAS qu'une landing : c'est une APP complète. Recrée AUSSI`);
  lines.push(`tout l'intérieur (dashboard, éditeur/générateur, chat IA, templates,`);
  lines.push(`paramètres). Les captures ci-dessous viennent du web (docs officielles,`);
  lines.push(`reviews) — sers-t'en comme RÉFÉRENCE VISUELLE pour reproduire chaque écran.`);
  lines.push(`───────────────────────────────────────────────────────`);

  if (r.discoveredRoutes.length) {
    lines.push(`\n### 🗺️ TOUTES LES ROUTES DÉCOUVERTES (recrée une page pour chacune)`);
    lines.push(r.discoveredRoutes.slice(0, 40).map((rt) => `- ${rt.path}${rt.label ? `  (${rt.label})` : ''}`).join('\n'));
  }

  if (r.screens.length) {
    for (const s of r.screens) {
      lines.push(`\n### 🖥️ ÉCRAN : ${s.name}`);
      lines.push(`Références visuelles (reproduis fidèlement la disposition, les panneaux, la densité d'info) :`);
      lines.push(s.images.map((im) => `  - ${im.url}${im.caption ? `  « ${im.caption} »` : ''}`).join('\n'));
    }
    lines.push(`\n### INSTRUCTION INTÉRIEUR`);
    lines.push(`Analyse ces captures EN VISION et recrée chaque écran interne à l'identique :`);
    lines.push(`layout (sidebar, panneaux, zone de preview), composants, densité, couleurs,`);
    lines.push(`états. Pour un app-builder : reproduis l'éditeur (chat IA à gauche, preview`);
    lines.push(`live à droite, arbre de fichiers, barre d'actions). Étape 1 = fidélité`);
    lines.push(`VISUELLE totale ; la logique réelle sera branchée ensuite.`);
  }

  if (r.notes.length) lines.push(`\nNotes : ${r.notes.join(' ')}`);
  lines.push(`═══════════════════════════════════════════════════════\n`);
  return lines.join('\n');
}
