// ─── Navigateur pilotable : l'IA ouvre un VRAI Chrome et s'en sert ──────────
//
// Contrairement à `web-tools.ts` (qui télécharge le HTML d'une page), ce module
// tient une session de navigateur PERSISTANTE par chat : l'IA ouvre une page,
// clique, remplit un formulaire, se connecte, fait défiler, prend des captures
// — et l'état (cookies, session, onglet courant) survit d'un outil à l'autre.
//
// Discrétion (« ne pas être repéré comme robot ») :
//   - vrai Chrome installé, pas un binaire de test, et le drapeau
//     `--enable-automation` est retiré ;
//   - `navigator.webdriver` neutralisé, plus les correctifs d'empreinte
//     classiques (plugins, langues, chrome runtime, WebGL) injectés AVANT le
//     premier script de la page ;
//   - en-têtes, langue, fuseau et taille d'écran cohérents entre eux ;
//   - frappe caractère par caractère et petites pauses aléatoires.
// Ça suffit pour ne pas être bloqué par les protections courantes. Ça ne casse
// pas un CAPTCHA : quand il y en a un, l'outil le dit franchement.

import type { Browser, BrowserContext, Page } from 'playwright-core';
import { existsSync } from 'node:fs';
import { importOptional } from '../lib/optional-import';

const CHROME_PATHS = [
  '/usr/bin/google-chrome',
  '/usr/bin/google-chrome-stable',
  '/opt/google/chrome/chrome',
  '/usr/bin/chromium',
  '/usr/bin/chromium-browser',
];

const NAV_TIMEOUT_MS = 45_000;
const ACTION_TIMEOUT_MS = 20_000;
const MAX_TEXT_CHARS = 12_000;
const IDLE_MS = 10 * 60 * 1000; // session fermée après 10 min sans usage

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';

// Correctifs d'empreinte injectés avant tout script de la page.
const STEALTH_INIT = `
(() => {
  // 1. Le marqueur le plus regardé.
  Object.defineProperty(Navigator.prototype, 'webdriver', { get: () => false, configurable: true });
  // 2. Un vrai Chrome expose window.chrome.
  if (!window.chrome) window.chrome = {};
  if (!window.chrome.runtime) window.chrome.runtime = {};
  // 3. Un navigateur sans tête annonce 0 plugin et 0 langue. Les tests de
  //    détection vérifient aussi le TYPE : il faut de vrais Plugin/PluginArray,
  //    pas un tableau d'objets anonymes.
  try {
    const mk = (name, filename, description) => {
      const mime = Object.create(MimeType.prototype);
      Object.defineProperties(mime, {
        type: { value: 'application/pdf' },
        suffixes: { value: 'pdf' },
        description: { value: description },
      });
      const plugin = Object.create(Plugin.prototype);
      Object.defineProperties(plugin, {
        name: { value: name },
        filename: { value: filename },
        description: { value: description },
        length: { value: 1 },
        0: { value: mime },
      });
      return plugin;
    };
    const list = [
      mk('PDF Viewer', 'internal-pdf-viewer', 'Portable Document Format'),
      mk('Chrome PDF Viewer', 'internal-pdf-viewer', 'Portable Document Format'),
      mk('Chromium PDF Viewer', 'internal-pdf-viewer', 'Portable Document Format'),
      mk('Microsoft Edge PDF Viewer', 'internal-pdf-viewer', 'Portable Document Format'),
      mk('WebKit built-in PDF', 'internal-pdf-viewer', 'Portable Document Format'),
    ];
    const arr = Object.create(PluginArray.prototype);
    list.forEach((pl, i) => Object.defineProperty(arr, i, { value: pl, enumerable: true }));
    Object.defineProperties(arr, {
      length: { value: list.length },
      item: { value: (i) => list[i] || null },
      namedItem: { value: (n) => list.find((pl) => pl.name === n) || null },
      refresh: { value: () => undefined },
    });
    Object.defineProperty(navigator, 'plugins', { get: () => arr, configurable: true });
  } catch (e) { /* prototypes indisponibles : on laisse le natif */ }
  Object.defineProperty(navigator, 'languages', { get: () => ['fr-BE', 'fr', 'en-US', 'en'], configurable: true });
  // 4. Les permissions doivent répondre comme un Chrome normal.
  const origQuery = window.navigator.permissions && window.navigator.permissions.query;
  if (origQuery) {
    window.navigator.permissions.query = (p) =>
      p && p.name === 'notifications'
        ? Promise.resolve({ state: Notification.permission })
        : origQuery(p);
  }
  // 5. WebGL : un rendu logiciel trahit tout de suite le mode sans tête.
  const getParam = WebGLRenderingContext.prototype.getParameter;
  WebGLRenderingContext.prototype.getParameter = function (p) {
    if (p === 37445) return 'Intel Inc.';
    if (p === 37446) return 'Intel Iris OpenGL Engine';
    return getParam.apply(this, [p]);
  };
  // 6. Cohérence matérielle.
  Object.defineProperty(navigator, 'hardwareConcurrency', { get: () => 8, configurable: true });
  Object.defineProperty(navigator, 'deviceMemory', { get: () => 8, configurable: true });
})();
`;

export interface BrowserSession {
  id: string;
  browser: Browser;
  context: BrowserContext;
  page: Page;
  lastUsed: number;
}

const sessions = new Map<string, BrowserSession>();

function rand(min: number, max: number) { return Math.floor(Math.random() * (max - min + 1)) + min; }
async function humanPause(min = 120, max = 420) {
  await new Promise((r) => setTimeout(r, rand(min, max)));
}

/** Ouvre (ou retrouve) la session de navigateur d'un chat. */
export async function getBrowserSession(sessionId: string): Promise<BrowserSession> {
  const existing = sessions.get(sessionId);
  if (existing && !existing.page.isClosed()) {
    existing.lastUsed = Date.now();
    return existing;
  }
  if (existing) await closeBrowserSession(sessionId);

  const { chromium } = await importOptional<typeof import('playwright-core')>('playwright-core');
  const executablePath = CHROME_PATHS.find((p) => existsSync(p));
  if (!executablePath) throw new Error("Chrome n'est pas installé sur cette machine.");

  const browser = await chromium.launch({
    executablePath,
    headless: true,
    args: [
      '--no-sandbox',
      '--disable-dev-shm-usage',
      '--disable-gpu',
      // Retire le bandeau/indice « pilotage automatisé » que Chrome expose.
      '--disable-blink-features=AutomationControlled',
      '--disable-features=IsolateOrigins,site-per-process,AutomationControlled',
      '--start-maximized',
      '--lang=fr-BE',
    ],
    ignoreDefaultArgs: ['--enable-automation'],
  });

  const context = await browser.newContext({
    userAgent: UA,
    viewport: { width: 1440, height: 900 },
    screen: { width: 1920, height: 1080 },
    deviceScaleFactor: 1,
    locale: 'fr-BE',
    timezoneId: 'Europe/Brussels',
    // Une géoloc cohérente avec le fuseau évite les incohérences détectables.
    geolocation: { latitude: 50.8503, longitude: 4.3517 },
    permissions: [],
    colorScheme: 'light',
    extraHTTPHeaders: {
      'Accept-Language': 'fr-BE,fr;q=0.9,en-US;q=0.8,en;q=0.7',
      'Sec-CH-UA': '"Google Chrome";v="126", "Chromium";v="126", "Not-A.Brand";v="24"',
      'Sec-CH-UA-Mobile': '?0',
      'Sec-CH-UA-Platform': '"Windows"',
      'Upgrade-Insecure-Requests': '1',
    },
  });
  await context.addInitScript(STEALTH_INIT);
  context.setDefaultTimeout(ACTION_TIMEOUT_MS);
  context.setDefaultNavigationTimeout(NAV_TIMEOUT_MS);

  const page = await context.newPage();
  const sess: BrowserSession = { id: sessionId, browser, context, page, lastUsed: Date.now() };
  sessions.set(sessionId, sess);
  sweepIdle();
  return sess;
}

/** Ferme la session et libère Chrome. */
export async function closeBrowserSession(sessionId: string): Promise<void> {
  const s = sessions.get(sessionId);
  if (!s) return;
  sessions.delete(sessionId);
  try { await s.context.close(); } catch { /* déjà fermé */ }
  try { await s.browser.close(); } catch { /* déjà fermé */ }
}

/** Ferme les sessions laissées ouvertes (un Chrome oublié consomme la RAM). */
function sweepIdle() {
  const now = Date.now();
  for (const [id, s] of sessions) {
    if (now - s.lastUsed > IDLE_MS) void closeBrowserSession(id);
  }
}

// ── Détection de blocage ─────────────────────────────────────────────────────
// Quand une protection nous arrête, on le DIT au lieu de renvoyer une page
// vide que l'IA interpréterait comme un contenu réel.
export function detectBlock(html: string, title: string, status: number | null): string | null {
  const h = `${title}\n${html}`.toLowerCase();
  if (/just a moment|checking your browser|cf-challenge|cf_chl|attention required/.test(h)) {
    return 'Cloudflare affiche une page de vérification (challenge navigateur).';
  }
  if (/recaptcha|hcaptcha|g-recaptcha|captcha/.test(h)) {
    return 'La page demande un CAPTCHA.';
  }
  if (/access denied|forbidden|you have been blocked|unusual traffic|are you a robot/.test(h)) {
    return "La page bloque l'accès (trafic jugé automatisé).";
  }
  if (status === 403) return 'Le serveur a répondu 403 (accès refusé).';
  if (status === 429) return 'Le serveur a répondu 429 (trop de requêtes).';
  return null;
}

export interface PageSnapshot {
  url: string;
  title: string;
  status: number | null;
  text: string;
  /** Éléments cliquables/saisissables, avec un sélecteur utilisable tel quel. */
  elements: { ref: string; kind: string; label: string; selector: string }[];
  blocked: string | null;
}

/**
 * Photographie l'état de la page pour l'IA : texte lisible + inventaire des
 * éléments interactifs avec un sélecteur prêt à l'emploi.
 */
export async function snapshot(page: Page, status: number | null = null): Promise<PageSnapshot> {
  const data = await page.evaluate((maxChars: number) => {
    const visible = (el: Element) => {
      const r = el.getBoundingClientRect();
      const st = window.getComputedStyle(el);
      return r.width > 0 && r.height > 0 && st.visibility !== 'hidden' && st.display !== 'none';
    };
    const label = (el: Element): string => {
      const e = el as HTMLElement;
      const raw =
        e.getAttribute('aria-label') ||
        (e as HTMLInputElement).placeholder ||
        e.getAttribute('name') ||
        e.getAttribute('title') ||
        (e.innerText || '').trim() ||
        (e as HTMLInputElement).value ||
        e.getAttribute('alt') ||
        '';
      return raw.replace(/\s+/g, ' ').trim().slice(0, 80);
    };
    // Sélecteur stable : id, puis attributs de test, puis nth-of-type.
    const selectorFor = (el: Element): string => {
      const e = el as HTMLElement;
      if (e.id && /^[A-Za-z][\w-]*$/.test(e.id)) return `#${e.id}`;
      for (const attr of ['data-testid', 'data-test', 'name']) {
        const v = e.getAttribute(attr);
        if (v) return `${e.tagName.toLowerCase()}[${attr}="${v.replace(/"/g, '\\"')}"]`;
      }
      const parts: string[] = [];
      let cur: Element | null = e;
      let depth = 0;
      while (cur && cur.nodeType === 1 && depth < 5) {
        const tag = cur.tagName.toLowerCase();
        if (tag === 'html' || tag === 'body') break;
        const parent: Element | null = cur.parentElement;
        if (!parent) { parts.unshift(tag); break; }
        const sameTag = Array.from(parent.children).filter((c) => c.tagName === cur!.tagName);
        parts.unshift(sameTag.length > 1 ? `${tag}:nth-of-type(${sameTag.indexOf(cur) + 1})` : tag);
        cur = parent;
        depth++;
      }
      return parts.join(' > ');
    };

    const nodes = Array.from(
      document.querySelectorAll('a[href], button, input, textarea, select, [role="button"], [role="link"], [onclick]'),
    ).filter(visible).slice(0, 80);

    const elements = nodes.map((el, i) => {
      const tag = el.tagName.toLowerCase();
      const type = (el as HTMLInputElement).type || '';
      const kind =
        tag === 'a' ? 'lien'
        : tag === 'select' ? 'liste'
        : tag === 'textarea' ? 'champ'
        : tag === 'input'
          ? (['checkbox', 'radio'].includes(type) ? 'case'
            : ['submit', 'button'].includes(type) ? 'bouton' : 'champ')
          : 'bouton';
      return { ref: `e${i + 1}`, kind, label: label(el) || `(${kind} sans libellé)`, selector: selectorFor(el) };
    });

    const body = document.body ? (document.body.innerText || '') : '';
    return {
      title: document.title || '',
      text: body.replace(/\n{3,}/g, '\n\n').trim().slice(0, maxChars),
      html: document.documentElement.outerHTML.slice(0, 4000),
      elements,
    };
  }, MAX_TEXT_CHARS);

  return {
    url: page.url(),
    title: data.title,
    status,
    text: data.text,
    elements: data.elements,
    blocked: detectBlock(data.html, data.title, status),
  };
}

/** Va sur une URL en attendant que la page soit réellement posée. */
export async function navigate(page: Page, url: string): Promise<number | null> {
  const target = /^https?:\/\//i.test(url) ? url : `https://${url}`;
  const res = await page.goto(target, { waitUntil: 'domcontentloaded', timeout: NAV_TIMEOUT_MS });
  // Laisse le JS s'installer, sans bloquer sur les pages qui ne se taisent jamais.
  await page.waitForLoadState('networkidle', { timeout: 8000 }).catch(() => { /* pas grave */ });
  await humanPause(250, 700);
  return res ? res.status() : null;
}

/** Clique — en visant d'abord le sélecteur, sinon le texte visible. */
export async function click(page: Page, selectorOrText: string): Promise<string> {
  const tryClick = async (loc: any, how: string) => {
    await loc.first().scrollIntoViewIfNeeded({ timeout: 5000 }).catch(() => { /* déjà visible */ });
    await humanPause();
    await loc.first().click({ timeout: ACTION_TIMEOUT_MS });
    return how;
  };
  let how: string;
  try {
    how = await tryClick(page.locator(selectorOrText), `sélecteur "${selectorOrText}"`);
  } catch {
    // Repli : le libellé visible, ce que l'IA a le plus souvent sous la main.
    try {
      how = await tryClick(page.getByRole('button', { name: selectorOrText }), `bouton « ${selectorOrText} »`);
    } catch {
      try {
        how = await tryClick(page.getByRole('link', { name: selectorOrText }), `lien « ${selectorOrText} »`);
      } catch {
        how = await tryClick(page.getByText(selectorOrText, { exact: false }), `texte « ${selectorOrText} »`);
      }
    }
  }
  // Un clic déclenche souvent une navigation : on l'attend brièvement.
  await page.waitForLoadState('domcontentloaded', { timeout: 8000 }).catch(() => { /* pas de nav */ });
  await humanPause(300, 800);
  return how;
}

/** Saisit du texte caractère par caractère (rythme humain). */
export async function type(page: Page, selector: string, text: string, submit = false): Promise<void> {
  const loc = page.locator(selector).first();
  await loc.scrollIntoViewIfNeeded({ timeout: 5000 }).catch(() => { /* déjà visible */ });
  await loc.click({ timeout: ACTION_TIMEOUT_MS });
  await humanPause(80, 200);
  await loc.fill('');
  for (const ch of text) {
    await loc.press(ch === ' ' ? 'Space' : ch, { delay: rand(35, 130) }).catch(async () => {
      // Certaines touches ne se pressent pas directement (accents, emojis).
      await loc.type(ch, { delay: rand(35, 130) });
    });
  }
  if (submit) {
    await humanPause(200, 500);
    await loc.press('Enter');
    await page.waitForLoadState('domcontentloaded', { timeout: 10_000 }).catch(() => { /* pas de nav */ });
  }
  await humanPause();
}

/** Fait défiler la page (en bas, en haut, ou d'un nombre de pixels). */
export async function scroll(page: Page, to: 'bottom' | 'top' | number): Promise<void> {
  if (to === 'bottom') {
    // Par paliers : c'est ce qui déclenche les chargements paresseux.
    await page.evaluate(async () => {
      await new Promise<void>((resolve) => {
        let y = 0;
        const step = () => {
          window.scrollBy(0, 400);
          y += 400;
          if (y >= document.body.scrollHeight || y > 20000) return resolve();
          setTimeout(step, 120);
        };
        step();
      });
    });
  } else if (to === 'top') {
    await page.evaluate(() => window.scrollTo(0, 0));
  } else {
    await page.evaluate((px: number) => window.scrollBy(0, px), to);
  }
  await humanPause(300, 700);
}

/** Capture l'écran et renvoie le JPEG. */
export async function screenshot(page: Page, fullPage = false): Promise<Buffer> {
  return page.screenshot({ type: 'jpeg', quality: 72, fullPage, timeout: 20_000 });
}
