// ─── Site Cloner: deep multi-page scraper (Chrome headless) ─────────────────
// Rend un vrai navigateur sur chaque page (JS exécuté), extrait un « brief de
// clonage » ultra-détaillé : design (couleurs, polices, radius, ombres), la
// structure exacte de chaque page, TOUS les assets (images, fonds, polices,
// icônes, vidéos) en URL absolue, et suit la navigation interne pour cloner
// plusieurs pages du même domaine.
//
// Objectif : donner à l'IA de quoi reproduire le site À L'IDENTIQUE (design +
// contenu + pages + assets). Tout est best-effort : on ne throw jamais, on
// dégrade proprement (fallback fetch HTML) si Chrome est indisponible.

import { formatAppInteriorBrief, researchAppInterior } from './app-interior-research';
import { importOptional } from './lib/optional-import';

const CHROME_PATHS = ['/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/usr/bin/chromium'];

const NAV_TIMEOUT = 25000;
const MAX_PAGES = 6;              // pages max clonées (page racine incluse)
const MAX_HTML_CHARS = 7000;     // HTML structurel max par page
const MAX_TEXT_CHARS = 3500;     // texte lisible max par page
const MAX_ASSETS = 60;           // assets max listés par page

// Upload d'un buffer image via la commande sandbox `upload` → URL publique.
// Best-effort : renvoie '' en cas d'échec (le clone marche sans screenshot).
async function uploadScreenshot(buffer: Buffer, label: string): Promise<string> {
  try {
    const { execFileSync } = await import('node:child_process');
    const fs = await import('node:fs');
    const os = await import('node:os');
    const path = await import('node:path');
    const tmp = path.join(os.tmpdir(), `velbaz_shot_${label}_${Date.now()}.jpg`);
    fs.writeFileSync(tmp, buffer);
    const url = execFileSync('upload', [tmp], { encoding: 'utf-8', timeout: 30000 }).trim();
    try { fs.unlinkSync(tmp); } catch {}
    return url && url.startsWith('http') ? url : '';
  } catch (e: any) {
    console.error('[site-scraper] upload screenshot échoué:', e?.message);
    return '';
  }
}

async function launchBrowser() {
  const { chromium } = await importOptional<typeof import('playwright-core')>('playwright-core');
  const { existsSync } = await import('node:fs');
  const executablePath = CHROME_PATHS.find((p) => existsSync(p));
  if (!executablePath) throw new Error('Chrome introuvable');
  return chromium.launch({
    executablePath,
    headless: true,
    args: ['--no-sandbox', '--disable-dev-shm-usage', '--disable-gpu'],
  });
}

export interface ClonedAsset {
  url: string;
  type: 'image' | 'background' | 'font' | 'video' | 'svg' | 'icon' | 'other';
  note?: string; // alt, rôle (logo, hero…)
}

/** Effet au survol (hover) d'un élément interactif, mesuré dans un vrai navigateur. */
export interface HoverEffect {
  label: string;      // libellé lisible de l'élément (ex: bouton "Get started")
  changes: string[];  // diffs état-repos → état-survol (fond, transform, ombre…)
}

/** Animation déclenchée au scroll (apparition/glissement d'un élément). */
export interface ScrollAnimation {
  label: string;      // libellé lisible de l'élément animé
  from: string;       // état initial (hors viewport)
  to: string;         // état final (dans le viewport)
  transition: string; // transition/animation CSS détectée
}

/** Ensemble des interactions dynamiques capturées sur une page. */
export interface PageInteractions {
  hovers: HoverEffect[];
  scrollAnimations: ScrollAnimation[];
  libraries: string[]; // bibliothèques d'animation détectées (AOS, Framer, GSAP…)
}

export interface ClonedPage {
  url: string;
  path: string;
  title: string;
  description: string;
  headings: string[];
  text: string;
  structuralHtml: string;
  assets: ClonedAsset[];
  /** URL publique d'une capture visuelle pleine page — donnée à l'IA en vision
   *  pour reproduire l'APPARENCE réelle (layout, couleurs, espacements). */
  screenshot?: string;
  /** Interactions dynamiques (animations au scroll + effets hover) mesurées
   *  en rejouant la page dans un vrai navigateur — pour les reproduire à l'identique. */
  interactions?: PageInteractions;
}

export interface SiteCloneResult {
  rootUrl: string;
  siteName: string;
  lang: string;
  design: {
    colors: string[];
    backgrounds: string[];
    textColors: string[];
    fonts: string[];
    radii: string[];
    shadows: string[];
    buttonStyles: string[];
  };
  navigation: { label: string; href: string }[];
  pages: ClonedPage[];
  allAssets: ClonedAsset[];
  ok: boolean;
  note?: string;
  /** Source du clonage : 'firecrawl' (haute fidélité) ou 'chrome' (fallback local). */
  source?: 'firecrawl' | 'chrome';
  /** Captures visuelles pleine page du site (URLs) — pour reproduire l'apparence à l'identique. */
  screenshots?: { url: string; page: string }[];
  /** Tokens de marque riches renvoyés par Firecrawl (logo, typographie, composants…). */
  branding?: {
    logo?: string;
    typography?: any;
    spacing?: any;
    components?: any;
    colors?: Record<string, string>;
  };
  /** Recherche de l'intérieur de l'app (écrans derrière login reconstruits via recherche d'images web). */
  appResearch?: import('./app-interior-research').AppInteriorResearch;
}

// Le script exécuté DANS la page pour tout extraire d'un coup.
function pageExtractor() {
  const abs = (u: string | null | undefined): string => {
    if (!u) return '';
    try { return new URL(u, location.href).href; } catch { return ''; }
  };
  const clean = (s: string) => (s || '').replace(/\s+/g, ' ').trim();

  // ── Design tokens : on échantillonne les éléments visibles ──
  const els = Array.from(document.querySelectorAll('*')).slice(0, 4000) as HTMLElement[];
  const colorFreq: Record<string, number> = {};
  const bgFreq: Record<string, number> = {};
  const textFreq: Record<string, number> = {};
  const fontFreq: Record<string, number> = {};
  const radiusSet = new Set<string>();
  const shadowSet = new Set<string>();
  const bump = (m: Record<string, number>, k: string) => { if (k && !/rgba?\(0, 0, 0, 0\)|transparent/.test(k)) m[k] = (m[k] || 0) + 1; };

  for (const el of els) {
    const r = el.getBoundingClientRect();
    if (r.width < 2 || r.height < 2) continue;
    const cs = getComputedStyle(el);
    bump(textFreq, cs.color);
    bump(bgFreq, cs.backgroundColor);
    const ff = clean(cs.fontFamily).split(',')[0].replace(/["']/g, '');
    if (ff) fontFreq[ff] = (fontFreq[ff] || 0) + 1;
    if (cs.borderRadius && cs.borderRadius !== '0px') radiusSet.add(cs.borderRadius);
    if (cs.boxShadow && cs.boxShadow !== 'none') shadowSet.add(cs.boxShadow);
    bump(colorFreq, cs.backgroundColor);
    bump(colorFreq, cs.color);
  }
  const topN = (m: Record<string, number>, n: number) =>
    Object.entries(m).sort((a, b) => b[1] - a[1]).slice(0, n).map(([k]) => k);

  // ── Boutons : capture le style réel de quelques boutons/CTA ──
  const btnStyles: string[] = [];
  const btns = Array.from(document.querySelectorAll('button, a[class*="btn"], a[class*="button"], [role="button"]')).slice(0, 6) as HTMLElement[];
  for (const b of btns) {
    const cs = getComputedStyle(b);
    const label = clean(b.textContent || '').slice(0, 24);
    if (!label) continue;
    btnStyles.push(`"${label}" → fond ${cs.backgroundColor}, texte ${cs.color}, radius ${cs.borderRadius}, padding ${cs.padding}, police ${clean(cs.fontFamily).split(',')[0]}`);
  }

  // ── Navigation (liens du header/nav) ──
  const navLinks: { label: string; href: string }[] = [];
  const navScope = document.querySelector('header, nav') || document.body;
  for (const a of Array.from(navScope.querySelectorAll('a[href]')).slice(0, 30) as HTMLAnchorElement[]) {
    const label = clean(a.textContent || '');
    const href = abs(a.getAttribute('href'));
    if (label && href && href.startsWith('http')) navLinks.push({ label: label.slice(0, 40), href });
  }

  // ── Headings ──
  const headings = (Array.from(document.querySelectorAll('h1, h2, h3')) as HTMLElement[])
    .map((h) => `${h.tagName}: ${clean(h.textContent || '')}`).filter((t) => t.length > 4).slice(0, 25);

  // ── Assets : images, backgrounds, fonts, video, svg ──
  const assets: { url: string; type: string; note?: string }[] = [];
  const pushAsset = (url: string, type: string, note?: string) => {
    if (!url || !url.startsWith('http')) return;
    if (assets.some((a) => a.url === url)) return;
    assets.push({ url, type, note });
  };
  for (const img of Array.from(document.querySelectorAll('img')) as HTMLImageElement[]) {
    const inHeader = !!img.closest('header, nav');
    pushAsset(abs(img.currentSrc || img.src), 'image', clean(img.alt) || (inHeader ? 'logo/header' : undefined));
    const ss = img.getAttribute('srcset');
    if (ss) ss.split(',').forEach((part) => pushAsset(abs(part.trim().split(' ')[0]), 'image'));
  }
  for (const s of Array.from(document.querySelectorAll('source[srcset]')) as HTMLSourceElement[]) {
    (s.getAttribute('srcset') || '').split(',').forEach((part) => pushAsset(abs(part.trim().split(' ')[0]), 'image'));
  }
  for (const v of Array.from(document.querySelectorAll('video')) as HTMLVideoElement[]) {
    pushAsset(abs(v.src), 'video');
    for (const src of Array.from(v.querySelectorAll('source'))) pushAsset(abs(src.getAttribute('src')), 'video');
    pushAsset(abs(v.poster), 'image', 'poster vidéo');
  }
  // Background images
  for (const el of els.slice(0, 1500)) {
    const bg = getComputedStyle(el).backgroundImage;
    if (bg && bg !== 'none') {
      const m = bg.match(/url\(["']?([^"')]+)["']?\)/);
      if (m) pushAsset(abs(m[1]), 'background');
    }
  }
  // Icons / favicons
  for (const l of Array.from(document.querySelectorAll('link[rel*="icon"], link[rel="apple-touch-icon"]')) as HTMLLinkElement[]) {
    pushAsset(abs(l.getAttribute('href')), 'icon', 'favicon');
  }
  // Fonts (stylesheets & @font-face src via performance entries)
  const fonts = new Set<string>();
  try {
    for (const e of performance.getEntriesByType('resource') as PerformanceResourceTiming[]) {
      if (/\.(woff2?|ttf|otf|eot)(\?|$)/i.test(e.name)) fonts.add(e.name);
    }
  } catch { /* noop */ }
  fonts.forEach((f) => pushAsset(f, 'font'));

  // ── HTML structurel : on retire scripts/styles/svg-inline mais on garde
  //    la structure, les classes et le texte (pour reproduire le layout) ──
  const clone = document.body.cloneNode(true) as HTMLElement;
  clone.querySelectorAll('script, style, noscript, template, iframe').forEach((n) => n.remove());
  clone.querySelectorAll('svg').forEach((n) => { n.innerHTML = ''; });
  let structuralHtml = clone.innerHTML.replace(/\s+/g, ' ');

  const bodyCs = getComputedStyle(document.body);

  return {
    title: document.title || '',
    description: (document.querySelector('meta[name="description"]') as HTMLMetaElement)?.content || '',
    lang: document.documentElement.lang || '',
    text: clean(document.body.innerText || ''),
    headings,
    navLinks,
    assets,
    structuralHtml,
    design: {
      colors: topN(colorFreq, 10),
      backgrounds: topN(bgFreq, 6),
      textColors: topN(textFreq, 6),
      fonts: Object.entries(fontFreq).sort((a, b) => b[1] - a[1]).slice(0, 5).map(([k]) => k),
      radii: Array.from(radiusSet).slice(0, 6),
      shadows: Array.from(shadowSet).slice(0, 4),
      buttonStyles: btnStyles,
      bodyBg: bodyCs.backgroundColor,
      bodyColor: bodyCs.color,
    },
  };
}

function sameDomain(a: string, b: string): boolean {
  try {
    const ua = new URL(a); const ub = new URL(b);
    return ua.hostname.replace(/^www\./, '') === ub.hostname.replace(/^www\./, '');
  } catch { return false; }
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

/**
 * Capture les INTERACTIONS dynamiques d'une page rendue : animations
 * déclenchées au scroll (fade-in, slide-up…) et effets au survol (hover).
 *
 * Méthode (dans un vrai navigateur, l'état des animations est réel) :
 *  1. Snapshot initial en haut de page (éléments encore « avant animation »).
 *  2. Scroll progressif → déclenche les reveal-on-scroll → snapshot final.
 *     Diff opacity/transform initial vs final = animation au scroll.
 *  3. Survol réel (Playwright `hover` → pseudo-classe CSS `:hover` active) de
 *     quelques éléments interactifs → diff repos/survol = effet hover.
 *
 * Doit être appelée AVANT le scroll de lazy-load (sinon les animations
 * « once » ont déjà joué). Best-effort : ne throw jamais.
 */
async function captureInteractions(page: any): Promise<PageInteractions> {
  const result: PageInteractions = { hovers: [], scrollAnimations: [], libraries: [] };
  try {
    // ── Phase 1 — snapshot initial + repérage des candidats à l'animation ──
    const initial: any = await page.evaluate(() => {
      const clean = (s: string) => (s || '').replace(/\s+/g, ' ').trim();
      const libs: string[] = [];
      if (document.querySelector('[data-aos]')) libs.push('AOS (animate on scroll)');
      if (document.querySelector('[data-projection-id],[data-framer-name]') || (window as any).__framer_events) libs.push('Framer Motion');
      if ((window as any).gsap || (window as any).ScrollTrigger || document.querySelector('[data-gsap]')) libs.push('GSAP / ScrollTrigger');
      if (document.querySelector('[data-scroll],[data-scroll-speed]')) libs.push('Locomotive Scroll');
      if (document.querySelector('.wow,[class*="animate__"]')) libs.push('animate.css / WOW.js');

      window.scrollTo(0, 0);
      const desc = (el: Element) => {
        const t = el.tagName.toLowerCase();
        const cls = (el.getAttribute('class') || '').split(/\s+/).filter(Boolean).slice(0, 2).join('.');
        const txt = clean((el as HTMLElement).innerText || '').slice(0, 32);
        return `${t}${cls ? '.' + cls : ''}${txt ? ` « ${txt} »` : ''}`;
      };
      // Candidats sémantiques (sections, titres, images, cartes…)
      const semantic = Array.from(document.querySelectorAll(
        'section, header, footer, [class*="section"], h1, h2, h3, img, [class*="card"], [class*="reveal"], [class*="fade"], [data-aos], [data-framer-name], article'
      )) as HTMLElement[];
      // + tout élément déjà dans un état « pré-animation » au chargement
      //   (opacity < 1 ou transform actif) → typique des reveal-on-scroll JS.
      const hiddenNow: HTMLElement[] = [];
      for (const el of Array.from(document.querySelectorAll('body *')).slice(0, 4000) as HTMLElement[]) {
        const cs = getComputedStyle(el);
        const op = parseFloat(cs.opacity);
        const tf = cs.transform;
        const r = el.getBoundingClientRect();
        if (r.width < 20 || r.height < 12) continue;
        if ((op < 0.95 || (tf && tf !== 'none')) && el.children.length < 40) hiddenNow.push(el);
        if (hiddenNow.length >= 160) break;
      }
      const seen = new Set<HTMLElement>();
      const cands = [...semantic, ...hiddenNow].filter((el) => (seen.has(el) ? false : (seen.add(el), true))).slice(0, 180);
      const snap = cands.map((el, i) => {
        el.setAttribute('data-velbaz-anim', String(i));
        const cs = getComputedStyle(el);
        return {
          i, desc: desc(el),
          opacity: cs.opacity, transform: cs.transform,
          transition: cs.transition, animationName: cs.animationName,
        };
      });
      return { libs, snap };
    });
    result.libraries = initial.libs || [];

    // ── Phase 2 — scroll progressif pour déclencher les animations ──
    await page.evaluate(() => new Promise<void>((res) => {
      let y = 0;
      const step = () => {
        window.scrollBy(0, Math.round(window.innerHeight * 0.8));
        y += window.innerHeight * 0.8;
        if (y < document.body.scrollHeight && y < 15000) setTimeout(step, 220);
        else setTimeout(res, 450);
      };
      step();
    }));

    const finalSnap: any[] = await page.evaluate(() => {
      const out: any[] = [];
      document.querySelectorAll('[data-velbaz-anim]').forEach((el) => {
        const cs = getComputedStyle(el as HTMLElement);
        out.push({ i: Number(el.getAttribute('data-velbaz-anim')), opacity: cs.opacity, transform: cs.transform });
      });
      return out;
    });
    const finalMap = new Map<number, any>(finalSnap.map((s) => [s.i, s]));

    for (const s of initial.snap as any[]) {
      const f = finalMap.get(s.i);
      if (!f) continue;
      const hasTransition = (s.transition && s.transition !== 'all 0s ease 0s' && /opacity|transform|all/.test(s.transition)) || (s.animationName && s.animationName !== 'none');
      const opacityChanged = Math.abs(parseFloat(s.opacity) - parseFloat(f.opacity)) > 0.05;
      const transformChanged = s.transform !== f.transform && (s.transform !== 'none' || f.transform !== 'none');
      const startsHidden = parseFloat(s.opacity) < 0.9 || s.transform !== 'none';
      if ((opacityChanged || transformChanged) && (hasTransition || startsHidden)) {
        result.scrollAnimations.push({
          label: s.desc,
          from: `opacity ${s.opacity}, transform ${s.transform}`,
          to: `opacity ${f.opacity}, transform ${f.transform}`,
          transition: s.animationName && s.animationName !== 'none' ? `animation: ${s.animationName}` : (s.transition || ''),
        });
      }
    }
    result.scrollAnimations = result.scrollAnimations.slice(0, 18);

    // ── Phase 3 — effets hover réels ──
    await page.evaluate(() => window.scrollTo(0, 0));
    const hoverTargets: any[] = await page.evaluate(() => {
      const clean = (s: string) => (s || '').replace(/\s+/g, ' ').trim();
      const seen = new Set<string>();
      const targets: any[] = [];
      const els = Array.from(document.querySelectorAll(
        'button, a[class*="btn"], a[class*="button"], [role="button"], [class*="card"], nav a, [class*="cta"]'
      )) as HTMLElement[];
      let idx = 0;
      for (const el of els) {
        const r = el.getBoundingClientRect();
        if (r.width < 8 || r.height < 8) continue;
        const label = clean(el.innerText || el.getAttribute('aria-label') || '').slice(0, 30);
        const key = el.tagName + '|' + label;
        if (seen.has(key)) continue;
        seen.add(key);
        el.setAttribute('data-velbaz-hov', String(idx));
        const cs = getComputedStyle(el);
        targets.push({
          idx, label: label || el.tagName.toLowerCase(),
          rest: { background: cs.backgroundColor, color: cs.color, transform: cs.transform, boxShadow: cs.boxShadow, borderColor: cs.borderColor, opacity: cs.opacity, filter: cs.filter },
        });
        idx++;
        if (idx >= 8) break;
      }
      return targets;
    });

    for (const t of hoverTargets) {
      try {
        await page.hover(`[data-velbaz-hov="${t.idx}"]`, { timeout: 2500 });
        await page.waitForTimeout(320);
        const hov: any = await page.evaluate((idx: number) => {
          const el = document.querySelector(`[data-velbaz-hov="${idx}"]`) as HTMLElement;
          if (!el) return null;
          const cs = getComputedStyle(el);
          return { background: cs.backgroundColor, color: cs.color, transform: cs.transform, boxShadow: cs.boxShadow, borderColor: cs.borderColor, opacity: cs.opacity, filter: cs.filter };
        }, t.idx);
        if (!hov) continue;
        const changes: string[] = [];
        const cmp = (k: string, nice: string) => { if (t.rest[k] !== hov[k]) changes.push(`${nice}: ${t.rest[k]} → ${hov[k]}`); };
        cmp('background', 'fond'); cmp('color', 'texte'); cmp('transform', 'transform');
        cmp('boxShadow', 'ombre'); cmp('borderColor', 'bordure'); cmp('opacity', 'opacité'); cmp('filter', 'filtre');
        if (changes.length) result.hovers.push({ label: t.label, changes });
        await page.mouse.move(2, 2).catch(() => {});
      } catch { /* best-effort */ }
    }
    result.hovers = result.hovers.slice(0, 10);
  } catch (e: any) {
    console.error('[site-scraper] capture interactions échouée:', e?.message);
  }
  return result;
}

/**
 * Clone en profondeur un site à partir de son URL : rend chaque page avec un
 * vrai navigateur, extrait design + structure + assets, et suit la navigation
 * interne (même domaine) jusqu'à MAX_PAGES.
 */
export async function scrapeSiteForClone(rootUrl: string, opts?: { maxPages?: number }): Promise<SiteCloneResult> {
  const maxPages = Math.min(opts?.maxPages ?? MAX_PAGES, 10);
  const result: SiteCloneResult = {
    rootUrl,
    siteName: '',
    lang: '',
    design: { colors: [], backgrounds: [], textColors: [], fonts: [], radii: [], shadows: [], buttonStyles: [] },
    navigation: [],
    pages: [],
    allAssets: [],
    ok: false,
  };

  let browser: any = null;
  try {
    browser = await launchBrowser();
    const ctx = await browser.newContext({
      viewport: { width: 1440, height: 900 },
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
      locale: 'fr-FR',
    });

    const queue: string[] = [normUrl(rootUrl)];
    const visited = new Set<string>();
    const assetMap = new Map<string, ClonedAsset>();
    const deadline = Date.now() + 95000; // budget temps global (~95s)

    while (queue.length > 0 && result.pages.length < maxPages) {
      if (Date.now() > deadline) { console.warn('[site-scraper] budget temps atteint — arrêt'); break; }
      const url = queue.shift()!;
      if (visited.has(url)) continue;
      visited.add(url);

      const page = await ctx.newPage();
      try {
        await page.goto(url, { waitUntil: 'networkidle', timeout: NAV_TIMEOUT }).catch(async () => {
          // networkidle échoue sur les sites très animés → on retente en load
          await page.goto(url, { waitUntil: 'load', timeout: NAV_TIMEOUT });
        });
        // Laisse le temps aux animations/lazy-load + scroll pour déclencher le lazy
        await page.waitForTimeout(1200);

        // ── Capture des interactions (animations au scroll + hover) ── sur les
        // premières pages (budget temps). DOIT se faire AVANT le scroll de
        // lazy-load, sinon les animations « once » ont déjà joué.
        let interactions: PageInteractions | undefined;
        if (result.pages.length < 3 && Date.now() < deadline - 12000) {
          interactions = await captureInteractions(page);
        }

        await page.evaluate(() => new Promise<void>((res) => {
          let y = 0; const step = () => { window.scrollBy(0, window.innerHeight); y += window.innerHeight;
            if (y < document.body.scrollHeight && y < 12000) setTimeout(step, 120); else { window.scrollTo(0, 0); setTimeout(res, 200); } };
          step();
        }));

        const data: any = await page.evaluate(pageExtractor);

        // ── Capture visuelle pleine page ── l'IA de code la reçoit en vision
        // pour reproduire l'APPARENCE réelle (layout, couleurs, espacements),
        // pas seulement le texte/HTML. Best-effort : n'interrompt jamais le scrape.
        let shotUrl = '';
        try {
          const buf = await page.screenshot({ fullPage: true, type: 'jpeg', quality: 72 });
          shotUrl = await uploadScreenshot(Buffer.from(buf), `p${result.pages.length}`);
          if (shotUrl) {
            (result.screenshots ||= []).push({ url: shotUrl, page: new URL(url).pathname || '/' });
          }
        } catch (e: any) {
          console.error(`[site-scraper] screenshot échouée ${url}: ${e?.message}`);
        }

        const u = new URL(url);
        const cp: ClonedPage = {
          url,
          path: u.pathname || '/',
          title: data.title,
          description: data.description,
          headings: data.headings,
          text: (data.text || '').slice(0, MAX_TEXT_CHARS),
          structuralHtml: (data.structuralHtml || '').slice(0, MAX_HTML_CHARS),
          assets: (data.assets || []).slice(0, MAX_ASSETS),
          screenshot: shotUrl || undefined,
          interactions,
        };
        result.pages.push(cp);

        // Design/nom/lang depuis la page racine
        if (result.pages.length === 1) {
          result.lang = data.lang || '';
          result.siteName = (data.title || '').split(/[|\-–—·]/)[0].trim();
          result.design = {
            colors: data.design.colors,
            backgrounds: data.design.backgrounds,
            textColors: data.design.textColors,
            fonts: data.design.fonts,
            radii: data.design.radii,
            shadows: data.design.shadows,
            buttonStyles: data.design.buttonStyles,
          };
          result.navigation = (data.navLinks || []).slice(0, 12);
        }

        // Agrège les assets globaux
        for (const a of cp.assets) if (!assetMap.has(a.url)) assetMap.set(a.url, a);

        // Ajoute les liens internes à la file
        for (const link of (data.navLinks || []) as { href: string }[]) {
          const n = normUrl(link.href);
          if (sameDomain(rootUrl, n) && !visited.has(n) && !queue.includes(n) && !/\.(pdf|zip|jpg|png|svg|mp4|json)(\?|$)/i.test(n)) {
            queue.push(n);
          }
        }
      } catch (e: any) {
        console.error(`[site-scraper] page échouée ${url}: ${e?.message}`);
      } finally {
        await page.close().catch(() => {});
      }
    }

    result.allAssets = Array.from(assetMap.values());
    result.ok = result.pages.length > 0;
    if (!result.ok) result.note = 'Aucune page rendue';

    // INTÉRIEUR DE L'APP : écrans derrière login reconstruits via recherche web
    // (best-effort, time-boxed). Routes découvertes = pages visitées + file.
    if (result.ok) {
      try {
        const routeSet = new Set<string>();
        const routes: { path: string; label: string }[] = [];
        const addRoute = (u: string) => {
          try {
            const p = new URL(u).pathname.replace(/\/+$/, '') || '/';
            if (routeSet.has(p)) return;
            routeSet.add(p);
            routes.push({ path: p, label: p === '/' ? 'Accueil' : (p.split('/').filter(Boolean).pop() || p).replace(/[-_]/g, ' ') });
          } catch { /* noop */ }
        };
        for (const p of result.pages) addRoute(p.url);
        for (const u of visited) addRoute(u);
        result.appResearch = await researchAppInterior(rootUrl, {
          siteName: result.siteName,
          discoveredRoutes: routes.slice(0, 60),
          deadlineMs: 35000,
        });
      } catch (e: any) {
        console.error(`[site-scraper] recherche intérieur échec: ${e?.message}`);
      }
    }
  } catch (e: any) {
    result.ok = false;
    result.note = `Navigateur indisponible: ${String(e?.message || e).slice(0, 120)}`;
    console.error('[site-scraper] échec global:', e?.message);
  } finally {
    if (browser) await browser.close().catch(() => {});
  }
  return result;
}

/** Formate les interactions (animations scroll + hover) d'une page en lignes de brief. */
function formatInteractions(it: PageInteractions | undefined): string[] {
  if (!it) return [];
  const lines: string[] = [];
  if (!it.scrollAnimations.length && !it.hovers.length && !it.libraries.length) return [];
  lines.push(`\n⚡ INTERACTIONS & ANIMATIONS (mesurées sur le VRAI site — REPRODUIS-LES À L'IDENTIQUE)`);
  if (it.libraries.length) {
    lines.push(`Bibliothèques d'animation détectées : ${it.libraries.join(', ')}. Reproduis l'effet visuel équivalent (Framer Motion / CSS transitions / IntersectionObserver).`);
  }
  if (it.scrollAnimations.length) {
    lines.push(`Animations au SCROLL (l'élément s'anime en entrant dans le viewport — implémente-les avec IntersectionObserver + transition, ou Framer Motion whileInView) :`);
    for (const a of it.scrollAnimations) {
      lines.push(`   • ${a.label} : ${a.from}  →  ${a.to}${a.transition ? `  [${a.transition}]` : ''}`);
    }
  }
  if (it.hovers.length) {
    lines.push(`Effets au SURVOL (hover — reproduis ces transitions exactes sur les éléments correspondants) :`);
    for (const h of it.hovers) {
      lines.push(`   • ${h.label} : ${h.changes.join(' · ')}`);
    }
  }
  return lines;
}

/** Formate le résultat de clonage en brief markdown injecté dans le contexte IA. */
export function formatCloneBrief(r: SiteCloneResult): string {
  if (!r.ok) return '';
  const d = r.design;
  const lines: string[] = [];
  lines.push(`\n\n═══════════════════════════════════════════════════════`);
  lines.push(`BRIEF DE CLONAGE — REPRODUIS CE SITE À L'IDENTIQUE`);
  lines.push(`Site source : ${r.rootUrl}`);
  lines.push(`Nom : ${r.siteName || '(inconnu)'} · Langue : ${r.lang || 'fr'}`);
  lines.push(`Pages clonées : ${r.pages.length} · Assets détectés : ${r.allAssets.length}`);
  lines.push(`Méthode : ${r.source === 'firecrawl' ? 'Firecrawl (haute fidélité)' : 'navigateur local'}`);
  lines.push(`───────────────────────────────────────────────────────`);

  // ── Captures visuelles pleine page : la RÉFÉRENCE ABSOLUE de l'apparence ──
  if (r.screenshots && r.screenshots.length > 0) {
    lines.push(`\n### 📸 CAPTURES VISUELLES DU SITE (référence d'apparence — COPIE CE RENDU)`);
    lines.push(`Ces images sont des captures pleine page du VRAI site. Reproduis fidèlement ce que tu vois : disposition, proportions, espacements, couleurs, hiérarchie visuelle.`);
    lines.push(r.screenshots.map((s) => `- ${s.page} → ${s.url}`).join('\n'));
  }

  // ── Branding riche (Firecrawl) : logo + typographie + composants ──
  if (r.branding) {
    const b = r.branding;
    lines.push(`\n### 🎨 IDENTITÉ DE MARQUE (valeurs exactes extraites — respecte-les)`);
    if (b.logo) {
      if (b.logo.startsWith('data:')) {
        // Logo inline (data-URI, souvent un SVG) : réutilisable tel quel.
        const snippet = b.logo.length > 4000 ? b.logo.slice(0, 4000) + '…[tronqué]' : b.logo;
        lines.push(`- Logo (data-URI inline, réutilise-le directement dans le HTML) : ${snippet}`);
      } else {
        lines.push(`- Logo (réutilise cette URL) : ${b.logo}`);
      }
    }
    if (b.colors) lines.push(`- Couleurs : ${Object.entries(b.colors).map(([k, v]) => `${k}=${v}`).join(' · ')}`);
    if (b.typography) lines.push(`- Typographie : ${JSON.stringify(b.typography)}`);
    if (b.spacing) lines.push(`- Espacements/radius : ${JSON.stringify(b.spacing)}`);
    if (b.components) lines.push(`- Composants (styles boutons/cartes…) : ${JSON.stringify(b.components).slice(0, 1200)}`);
  }

  lines.push(`\n### DESIGN GLOBAL (reproduis EXACTEMENT ces valeurs)`);
  lines.push(`- Couleurs dominantes : ${d.colors.join(' · ') || 'n/a'}`);
  lines.push(`- Fonds : ${d.backgrounds.join(' · ') || 'n/a'}`);
  lines.push(`- Couleurs de texte : ${d.textColors.join(' · ') || 'n/a'}`);
  lines.push(`- Polices : ${d.fonts.join(', ') || 'n/a'}`);
  lines.push(`- Border-radius : ${d.radii.join(', ') || 'n/a'}`);
  lines.push(`- Ombres : ${d.shadows.join(' | ') || 'n/a'}`);
  if (d.buttonStyles.length) lines.push(`- Boutons/CTA :\n${d.buttonStyles.map((b) => `   • ${b}`).join('\n')}`);
  if (r.navigation.length) {
    lines.push(`\n### NAVIGATION (recrée ce menu)`);
    lines.push(r.navigation.map((n) => `- ${n.label} → ${n.href}`).join('\n'));
  }
  lines.push(`\n### PAGES À RECRÉER (une par une, à l'identique)`);
  for (const p of r.pages) {
    lines.push(`\n──── PAGE : ${p.path}  (${p.url}) ────`);
    lines.push(`Titre : ${p.title}`);
    if (p.description) lines.push(`Meta description : ${p.description}`);
    if (p.headings.length) lines.push(`Titres :\n${p.headings.map((h) => `  ${h}`).join('\n')}`);
    if (p.text) lines.push(`Contenu texte :\n${p.text}`);
    if (p.assets.length) {
      lines.push(`Assets de la page (URL absolues — télécharge/réutilise-les) :`);
      lines.push(p.assets.map((a) => `  [${a.type}] ${a.url}${a.note ? ` (${a.note})` : ''}`).join('\n'));
    }
    lines.push(`Structure HTML (rendue, nettoyée — respecte l'ordre/les sections) :\n${p.structuralHtml}`);
    lines.push(...formatInteractions(p.interactions));
  }
  lines.push(`\n### TOUS LES ASSETS DU SITE (${r.allAssets.length}) — à télécharger et intégrer`);
  lines.push(r.allAssets.slice(0, 120).map((a) => `- [${a.type}] ${a.url}${a.note ? ` (${a.note})` : ''}`).join('\n'));
  // ── Intérieur de l'app (écrans derrière login reconstruits via recherche web) ──
  if (r.appResearch && (r.appResearch.screens.length || r.appResearch.discoveredRoutes.length)) {
    lines.push(formatAppInteriorBrief(r.appResearch));
  }
  lines.push(`\n### INSTRUCTION`);
  lines.push(`Reproduis ce site À L'IDENTIQUE sur la stack (design, couleurs, polices, layout, contenu, toutes les pages ci-dessus et la navigation). Intègre les vrais assets via leurs URLs. Respecte fidèlement l'apparence et l'agencement de chaque page.`);
  lines.push(`═══════════════════════════════════════════════════════\n`);
  let brief = lines.join('\n');
  // Plafond de sécurité : évite de saturer le contexte de l'IA sur de très
  // gros sites (on garde design + contenu, on coupe le surplus de HTML brut).
  const MAX_BRIEF = 90000;
  if (brief.length > MAX_BRIEF) {
    brief = brief.slice(0, MAX_BRIEF) + '\n… [brief tronqué — reproduis fidèlement ce qui précède]\n';
  }
  return brief;
}

/**
 * Brief FOCALISÉ sur UNE seule page scrapée, retrouvée par sa route (path).
 * Sert au mode clone: on donne à l'IA le contenu réel EXACT de cette page
 * (titres, texte, structure HTML rendue, assets) pour la reproduire à
 * l'identique — sans inventer de CRUD ni de contenu marketing générique.
 */
export function formatClonePageBrief(r: SiteCloneResult, route: string): string {
  if (!r.ok || !r.pages?.length) return '';
  const norm = (s: string) => (s || '/').replace(/\/+$/, '') || '/';
  const target = norm(route);
  // Match par path normalisé ; sinon, la première page (souvent la home).
  const p =
    r.pages.find((pg) => norm(pg.path) === target) ||
    (target === '/' ? r.pages[0] : undefined);
  if (!p) return '';
  const lines: string[] = [];
  lines.push(`\n### 📄 CONTENU RÉEL DE CETTE PAGE (scrapé sur ${p.url}) — REPRODUIS-LE À L'IDENTIQUE`);
  lines.push(`Titre : ${p.title || '(sans titre)'}`);
  if (p.description) lines.push(`Meta description : ${p.description}`);
  if (p.headings?.length) lines.push(`Titres (ordre exact) :\n${p.headings.map((h) => `  • ${h}`).join('\n')}`);
  if (p.text) lines.push(`Texte de la page (reprends ces textes EXACTS, ne les réécris pas) :\n${p.text}`);
  if (p.assets?.length) {
    lines.push(`Assets de la page (URLs absolues — intègre-les via <img src>) :`);
    lines.push(p.assets.map((a) => `  [${a.type}] ${a.url}${a.note ? ` (${a.note})` : ''}`).join('\n'));
  }
  if (p.structuralHtml) {
    lines.push(`Structure HTML rendue (respecte l'ordre et les sections tel quel) :\n${p.structuralHtml}`);
  }
  lines.push(...formatInteractions(p.interactions));
  let brief = lines.join('\n');
  const MAX = 60000;
  if (brief.length > MAX) brief = brief.slice(0, MAX) + '\n… [tronqué — reproduis fidèlement ce qui précède]\n';
  return brief;
}
