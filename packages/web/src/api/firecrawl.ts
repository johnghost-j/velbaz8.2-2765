// ─── Firecrawl : scraping haute-fidélité pour clonage identique ──────────────
// Quand l'utilisateur veut cloner un site « à l'identique », on utilise l'API
// Firecrawl (si FIRECRAWL_API_KEY est présent) plutôt que le navigateur local :
// Firecrawl rend le JS, contourne les protections, et renvoie un JSON riche —
// markdown propre, HTML, liens, TOUTES les images, une CAPTURE pleine page, et
// même les tokens de marque (logo, couleurs, typographie, composants).
//
// On assemble tout dans un `SiteCloneResult` (même interface que le scraper
// local) → `formatCloneBrief` produit le brief que l'IA Velbaz utilise pour
// recopier le site au maximum. Best-effort : ne throw jamais, l'appelant
// retombe sur le scraper Chrome local si Firecrawl échoue.

import type { SiteCloneResult, ClonedPage, ClonedAsset } from './site-scraper';
import { researchAppInterior } from './app-interior-research';

const API_BASE = 'https://api.firecrawl.dev/v2';
const SCRAPE_TIMEOUT_MS = 30_000;
const MAX_PAGES = 6;
const MAX_HTML_CHARS = 7000;
const MAX_TEXT_CHARS = 3500;
const MAX_ASSETS = 80;

export function firecrawlEnabled(): boolean {
  return !!(process.env.FIRECRAWL_API_KEY && process.env.FIRECRAWL_API_KEY.trim());
}

function authHeaders() {
  return {
    'Authorization': `Bearer ${process.env.FIRECRAWL_API_KEY!.trim()}`,
    'Content-Type': 'application/json',
  };
}

function timeoutSignal(ms: number): AbortSignal {
  return AbortSignal.timeout(ms);
}

interface FirecrawlScrapeData {
  markdown?: string;
  html?: string;
  rawHtml?: string;
  links?: string[];
  images?: string[] | { url?: string; src?: string; alt?: string }[];
  screenshot?: string;
  branding?: any;
  metadata?: { title?: string; description?: string; language?: string; sourceURL?: string; url?: string };
}

/** Scrape UNE page via Firecrawl avec tous les formats utiles au clonage. */
async function scrapePage(url: string, fullPageScreenshot = true): Promise<FirecrawlScrapeData | null> {
  try {
    const body = {
      url,
      formats: [
        'markdown',
        'html',
        'links',
        'images',
        'branding',
        { type: 'screenshot', fullPage: fullPageScreenshot },
      ],
      onlyMainContent: false,
      blockAds: true,
      waitFor: 1500,
      timeout: SCRAPE_TIMEOUT_MS,
    };
    const res = await fetch(`${API_BASE}/scrape`, {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify(body),
      signal: timeoutSignal(SCRAPE_TIMEOUT_MS + 5000),
    });
    if (!res.ok) {
      const txt = await res.text().catch(() => '');
      console.error(`[firecrawl] scrape ${url} → HTTP ${res.status}: ${txt.slice(0, 200)}`);
      return null;
    }
    const json: any = await res.json();
    if (!json?.success || !json?.data) {
      console.error(`[firecrawl] scrape ${url} → réponse invalide: ${JSON.stringify(json).slice(0, 200)}`);
      return null;
    }
    return json.data as FirecrawlScrapeData;
  } catch (e: any) {
    console.error(`[firecrawl] scrape ${url} échec: ${e?.message}`);
    return null;
  }
}

/** Découvre les URLs internes du site (pour cloner plusieurs pages). */
async function mapSite(rootUrl: string, limit = 25): Promise<string[]> {
  try {
    const res = await fetch(`${API_BASE}/map`, {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify({ url: rootUrl, limit }),
      signal: timeoutSignal(30_000),
    });
    if (!res.ok) return [];
    const json: any = await res.json();
    const links: any[] = json?.links || json?.data?.links || json?.data || [];
    const urls = links
      .map((l: any) => (typeof l === 'string' ? l : l?.url))
      .filter((u: any): u is string => typeof u === 'string' && /^https?:\/\//.test(u));
    return Array.from(new Set(urls));
  } catch (e: any) {
    console.error(`[firecrawl] map ${rootUrl} échec: ${e?.message}`);
    return [];
  }
}

function hostname(u: string): string {
  try { return new URL(u).hostname.replace(/^www\./, ''); } catch { return ''; }
}

function normUrl(u: string): string {
  try {
    const url = new URL(u);
    url.hash = '';
    let s = url.href;
    if (s.endsWith('/')) s = s.slice(0, -1);
    return s;
  } catch { return u; }
}

/** Extrait un HTML structurel léger depuis le HTML rendu (scripts/styles retirés). */
function structuralize(html: string): string {
  return (html || '')
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, '')
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Extrait les titres (h1/h2/h3) depuis le HTML. */
function extractHeadings(html: string): string[] {
  const out: string[] = [];
  const re = /<(h[1-3])[^>]*>([\s\S]*?)<\/\1>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) && out.length < 25) {
    const text = m[2].replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
    if (text.length > 3) out.push(`${m[1].toUpperCase()}: ${text}`);
  }
  return out;
}

/** Extrait TOUTES les vidéos de la page depuis le HTML rendu :
 *  - <video src> et <video><source src>  (+ poster)
 *  - iframes YouTube / Vimeo / Wistia / Loom (lecteurs embarqués)
 *  Renvoie des assets typés 'video' (poster typé 'image') en URL absolue. */
function extractVideos(html: string, baseUrl?: string): ClonedAsset[] {
  const out: ClonedAsset[] = [];
  const seen = new Set<string>();
  const abs = (u: string): string => {
    if (!u) return '';
    try { return baseUrl ? new URL(u, baseUrl).href : u; } catch { return u; }
  };
  const push = (rawUrl: string, type: ClonedAsset['type'], note?: string) => {
    const url = abs(rawUrl.trim());
    if (!url || !/^https?:\/\//.test(url) || seen.has(url)) return;
    seen.add(url);
    out.push({ url, type, note });
  };
  // <video ...> ... </video>  (capture src, poster, et <source> internes)
  const videoRe = /<video\b([^>]*)>([\s\S]*?)<\/video>/gi;
  let vm: RegExpExecArray | null;
  while ((vm = videoRe.exec(html)) && out.length < 40) {
    const attrs = vm[1] || '';
    const inner = vm[2] || '';
    const src = /\bsrc\s*=\s*["']([^"']+)["']/i.exec(attrs)?.[1];
    if (src) push(src, 'video');
    const poster = /\bposter\s*=\s*["']([^"']+)["']/i.exec(attrs)?.[1];
    if (poster) push(poster, 'image', 'poster vidéo');
    const srcRe = /<source\b[^>]*\bsrc\s*=\s*["']([^"']+)["'][^>]*>/gi;
    let sm: RegExpExecArray | null;
    while ((sm = srcRe.exec(inner))) push(sm[1], 'video');
  }
  // <video src="..."> auto-fermant (sans balise de fermeture)
  const selfVideoRe = /<video\b[^>]*\bsrc\s*=\s*["']([^"']+)["'][^>]*\/?>/gi;
  let sv: RegExpExecArray | null;
  while ((sv = selfVideoRe.exec(html)) && out.length < 40) push(sv[1], 'video');
  // iframes de lecteurs vidéo embarqués (YouTube, Vimeo, Wistia, Loom…)
  const iframeRe = /<iframe\b[^>]*\bsrc\s*=\s*["']([^"']+)["'][^>]*>/gi;
  let im: RegExpExecArray | null;
  while ((im = iframeRe.exec(html)) && out.length < 40) {
    const u = im[1];
    if (/youtube\.com|youtu\.be|player\.vimeo\.com|vimeo\.com|wistia\.|loom\.com|dailymotion\.com|jwplayer/i.test(u)) {
      push(u, 'video', 'lecteur vidéo embarqué');
    }
  }
  return out;
}

function toImageUrls(images: FirecrawlScrapeData['images']): { url: string; alt?: string }[] {
  if (!images) return [];
  return (images as any[])
    .map((i) => (typeof i === 'string' ? { url: i } : { url: i?.url || i?.src, alt: i?.alt }))
    .filter((i) => typeof i.url === 'string' && /^https?:\/\//.test(i.url));
}

function normalizeBranding(b: any): SiteCloneResult['branding'] | undefined {
  if (!b || typeof b !== 'object') return undefined;
  // Le logo n'est PAS un champ racine : Firecrawl le renvoie dans `branding.images.logo`
  // (souvent une URL http OU un data-URI SVG directement inlinable).
  const logo: string | undefined =
    (typeof b.logo === 'string' && b.logo) ||
    (b.images && typeof b.images === 'object' && (b.images.logo || b.images.icon || b.images.favicon)) ||
    undefined;
  return {
    logo: typeof logo === 'string' ? logo : undefined,
    colors: b.colors && typeof b.colors === 'object' ? b.colors : undefined,
    typography: b.typography,
    spacing: b.spacing,
    components: b.components,
  };
}

/** Résume les styles de composants (boutons) de Firecrawl en lignes lisibles. */
function componentButtonStyles(components: any): string[] {
  if (!components || typeof components !== 'object') return [];
  const out: string[] = [];
  for (const key of ['buttonPrimary', 'buttonSecondary']) {
    const c = components[key];
    if (c && typeof c === 'object') {
      const parts = [
        c.background && `fond ${c.background}`,
        c.textColor && `texte ${c.textColor}`,
        c.borderRadius && `radius ${c.borderRadius}`,
      ].filter(Boolean);
      if (parts.length) out.push(`${key === 'buttonPrimary' ? 'Bouton principal' : 'Bouton secondaire'} : ${parts.join(', ')}`);
    }
  }
  return out;
}

/**
 * Clone un site via Firecrawl : map → scrape des pages clés (avec captures +
 * branding + images) → assemble un SiteCloneResult haute fidélité.
 */
export interface FirecrawlPreviewEvent {
  id: string;
  label: string;
  preview?: {
    kind: 'browse' | 'screenshot' | 'search' | 'code' | 'analyze';
    imageUrl?: string;
    url?: string;
    caption?: string;
  };
}

export async function scrapeSiteWithFirecrawl(
  rootUrl: string,
  opts?: { maxPages?: number; onPreview?: (e: FirecrawlPreviewEvent) => void },
): Promise<SiteCloneResult> {
  const emit = opts?.onPreview ?? (() => {});
  const hostShort = (u: string) => { try { return new URL(u).hostname.replace(/^www\./, ''); } catch { return u; } };
  const pathShort = (u: string) => { try { const p = new URL(u).pathname; return p === '/' ? 'accueil' : p; } catch { return u; } };
  // Aperçu INSTANTANÉ de l'URL en cours de navigation : un service de capture à
  // la volée rend la page immédiatement, donc l'utilisateur VOIT ce que l'IA
  // ouvre dès la phase « Navigation », sans attendre la vraie capture Firecrawl
  // (qui n'arrive qu'à la fin du scrape). La capture pleine page Firecrawl la
  // remplace ensuite quand elle est prête.
  const livePreview = (u: string) => `https://image.thum.io/get/width/1200/noanimate/${u}`;
  const maxPages = Math.min(opts?.maxPages ?? MAX_PAGES, 8);
  const result: SiteCloneResult = {
    rootUrl,
    siteName: '',
    lang: '',
    design: { colors: [], backgrounds: [], textColors: [], fonts: [], radii: [], shadows: [], buttonStyles: [] },
    navigation: [],
    pages: [],
    allAssets: [],
    ok: false,
    source: 'firecrawl',
    screenshots: [],
  };

  // 1) Découverte des pages internes (best-effort).
  const rootHost = hostname(rootUrl);
  let candidates = await mapSite(rootUrl, 30);
  candidates = candidates.filter((u) => hostname(u) === rootHost && !/\.(pdf|zip|jpg|jpeg|png|svg|gif|mp4|webp|json|xml|css|js)(\?|$)/i.test(u));
  // Priorise la racine, puis des pages courtes (souvent les pages principales).
  const root = normUrl(rootUrl);
  const ordered = [root, ...candidates.map(normUrl).filter((u) => u !== root)]
    .filter((u, i, arr) => arr.indexOf(u) === i)
    .sort((a, b) => (a === root ? -1 : b === root ? 1 : a.length - b.length))
    .slice(0, maxPages);

  const targets = ordered.length > 0 ? ordered : [root];
  const assetMap = new Map<string, ClonedAsset>();

  // 2) Scrape en parallèle (Firecrawl gère la concurrence côté serveur).
  // Capture PLEINE PAGE sur CHAQUE page + extraction de TOUTES les images et
  // vidéos + détails (HTML/texte/headings) : l'IA de code reçoit ainsi une
  // référence visuelle et un inventaire complet pour cloner chaque page à
  // l'identique. Best-effort : chaque page qui échoue est simplement ignorée.
  emit({ id: 'cam-map', label: `Analyse de la structure de ${hostShort(rootUrl)}`, preview: { kind: 'analyze', url: rootUrl, imageUrl: livePreview(rootUrl), caption: `${targets.length} page(s) détectée(s)` } });
  const scraped = await Promise.all(targets.map(async (u, i) => {
    emit({ id: `cam-browse-${i}`, label: `Navigation : ${pathShort(u)}`, preview: { kind: 'browse', url: u, imageUrl: livePreview(u), caption: `Ouverture de ${pathShort(u)}` } });
    // Capture PLEINE PAGE sur CHAQUE page (pas seulement l'accueil) → l'IA de
    // code reçoit une image fidèle de chaque page à reconstruire (vision).
    const data = await scrapePage(u, true);
    // Capture réelle disponible → on l'envoie tout de suite à la « caméra live ».
    if (data?.screenshot) {
      emit({ id: `cam-shot-${i}`, label: `Capture : ${pathShort(u)}`, preview: { kind: 'screenshot', imageUrl: data.screenshot, url: u, caption: `${hostShort(u)} — ${pathShort(u)}` } });
    }
    return data;
  }));

  for (let i = 0; i < targets.length; i++) {
    const url = targets[i];
    const data = scraped[i];
    if (!data) continue;

    const html = data.html || data.rawHtml || '';
    let u: URL | null = null;
    try { u = new URL(url); } catch { /* noop */ }

    const imgs = toImageUrls(data.images);
    const pageAssets: ClonedAsset[] = imgs.slice(0, MAX_ASSETS).map((im) => ({
      url: im.url,
      type: 'image' as const,
      note: im.alt || undefined,
    }));
    // VIDÉOS : Firecrawl ne renvoie pas les vidéos → on les extrait du HTML
    // rendu (<video>/<source>/poster + iframes YouTube/Vimeo/Wistia/Loom).
    const vids = extractVideos(html, url);
    for (const v of vids) if (!pageAssets.some((a) => a.url === v.url)) pageAssets.push(v);
    if (vids.length) {
      emit({ id: `cam-vid-${i}`, label: `${vids.filter((v) => v.type === 'video').length} vidéo(s) détectée(s) : ${pathShort(url)}`, preview: { kind: 'analyze', url, caption: `${vids.filter((v) => v.type === 'video').length} vidéo(s)` } });
    }

    const cp: ClonedPage = {
      url,
      path: u?.pathname || '/',
      title: data.metadata?.title || '',
      description: data.metadata?.description || '',
      headings: extractHeadings(html),
      text: (data.markdown || '').slice(0, MAX_TEXT_CHARS),
      structuralHtml: structuralize(html).slice(0, MAX_HTML_CHARS),
      assets: pageAssets,
      // Capture pleine page → passée EN VISION à l'IA de code (mode clone) pour
      // reproduire l'apparence réelle (layout/couleurs/typo), pas juste le texte.
      screenshot: data.screenshot || undefined,
    };
    result.pages.push(cp);

    // Capture visuelle de la page.
    if (data.screenshot) result.screenshots!.push({ url: data.screenshot, page: cp.path });

    // Page racine → design/branding/nom/langue + navigation.
    if (result.pages.length === 1 || url === root) {
      result.lang = data.metadata?.language || result.lang || '';
      if (!result.siteName) result.siteName = (data.metadata?.title || '').split(/[|\-–—·]/)[0].trim();
      const branding = normalizeBranding(data.branding);
      if (branding) {
        result.branding = branding;
        if (branding.colors) {
          const vals = Object.values(branding.colors).filter((v): v is string => typeof v === 'string');
          result.design.colors = vals;
          if (branding.colors.background) result.design.backgrounds = [branding.colors.background];
          if (branding.colors.textPrimary) result.design.textColors = [branding.colors.textPrimary];
        }
        const fam = branding.typography?.fontFamilies;
        if (fam) result.design.fonts = Array.from(new Set(Object.values(fam).filter((v): v is string => typeof v === 'string')));
        // `branding.fonts` = [{family, role}] : source de police complémentaire.
        if (Array.isArray(data.branding?.fonts)) {
          const famNames = data.branding.fonts.map((f: any) => f?.family).filter((f: any): f is string => typeof f === 'string');
          result.design.fonts = Array.from(new Set([...result.design.fonts, ...famNames]));
        }
        if (branding.spacing?.borderRadius) result.design.radii = [branding.spacing.borderRadius];
        // Styles de boutons depuis les composants Firecrawl.
        const btnStyles = componentButtonStyles(branding.components);
        if (btnStyles.length) result.design.buttonStyles = btnStyles;
      }
      // Navigation depuis les liens internes.
      const navLinks = (data.links || [])
        .filter((l) => hostname(l) === rootHost)
        .slice(0, 12)
        .map((href) => ({ label: (new URL(href).pathname.split('/').filter(Boolean).pop() || 'Accueil').replace(/[-_]/g, ' '), href }));
      result.navigation = navLinks;
    }

    // Agrège tous les assets globaux.
    for (const a of pageAssets) if (!assetMap.has(a.url)) assetMap.set(a.url, a);
  }

  // Ajoute les captures comme assets visuels de référence.
  for (const s of result.screenshots!) {
    if (!assetMap.has(s.url)) assetMap.set(s.url, { url: s.url, type: 'image', note: `capture visuelle ${s.page}` });
  }
  // N'ajoute le logo à la liste d'assets que si c'est une vraie URL http
  // (un data-URI est déjà inlinable et bloaterait la liste).
  if (result.branding?.logo && /^https?:\/\//.test(result.branding.logo) && !assetMap.has(result.branding.logo)) {
    assetMap.set(result.branding.logo, { url: result.branding.logo, type: 'image', note: 'logo' });
  }

  result.allAssets = Array.from(assetMap.values());
  result.ok = result.pages.length > 0;
  if (!result.ok) result.note = 'Firecrawl n\'a renvoyé aucune page';
  const vidCount = result.allAssets.filter((a) => a.type === 'video').length;
  console.log(`[firecrawl] Clone ${rootUrl} → ${result.pages.length} page(s), ${result.allAssets.length} asset(s) (dont ${vidCount} vidéo(s)), ${result.screenshots!.length} capture(s), branding=${!!result.branding}`);

  // 3) INTÉRIEUR DE L'APP : les écrans clés sont derrière le login → Firecrawl ne
  // voit que le mur de connexion. On reconstruit l'intérieur en cherchant des
  // captures réelles sur le web (best-effort, time-boxed). On alimente aussi la
  // liste COMPLÈTE des routes découvertes (pas seulement le top-12 nav).
  try {
    const discoveredRoutes = buildDiscoveredRoutes(rootUrl, candidates, result.pages.map((p) => p.path));
    emit({ id: 'interior', label: `Reconstruction de l'intérieur de ${hostShort(rootUrl)}`, preview: { kind: 'analyze', url: rootUrl, caption: 'Recherche des écrans derrière login' } });
    result.appResearch = await researchAppInterior(rootUrl, {
      siteName: result.siteName,
      discoveredRoutes,
      deadlineMs: 40000,
      onPreview: (e) => emit({ id: e.id, label: e.label, preview: e.preview as any }),
    });
    console.log(`[firecrawl] Intérieur ${rootUrl} → ${result.appResearch.screens.length} écran(s) reconstruit(s), ${discoveredRoutes.length} route(s) découverte(s)`);
  } catch (e: any) {
    console.error(`[firecrawl] recherche intérieur échec: ${e?.message}`);
  }

  return result;
}

/** Construit la liste complète des routes internes découvertes (paths uniques). */
function buildDiscoveredRoutes(rootUrl: string, mapped: string[], scrapedPaths: string[]): { path: string; label: string }[] {
  const rootHost = hostname(rootUrl);
  const seen = new Set<string>();
  const routes: { path: string; label: string }[] = [];
  const add = (path: string) => {
    const p = path || '/';
    if (seen.has(p)) return;
    seen.add(p);
    const label = p === '/' ? 'Accueil' : (p.split('/').filter(Boolean).pop() || p).replace(/[-_]/g, ' ');
    routes.push({ path: p, label });
  };
  for (const p of scrapedPaths) add(p);
  for (const u of mapped) {
    if (hostname(u) !== rootHost) continue;
    try { add(new URL(u).pathname.replace(/\/+$/, '') || '/'); } catch { /* noop */ }
  }
  return routes.slice(0, 60);
}
