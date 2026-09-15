// ─── Capture de l'aperçu du site (PREMIER ÉCRAN) ─────────────────────────────
// [2026-09-13] Le mini-rectangle d'aperçu du chat montre exactement ce qu'on voit
// EN ARRIVANT sur le site : le premier écran, pas la page déroulée.
//   - d'abord une <iframe> de 340px : la page était coupée à une hauteur arbitraire
//     qui ne correspondait à rien ;
//   - puis une capture pleine page : l'utilisateur ne voulait pas la partie à
//     dérouler, seulement l'écran d'accueil ;
//   - donc : capture d'UN viewport desktop (1280x800), mise en page réelle.
// Une iframe ne convient pas : à la largeur de la carte, il faudrait la mettre à
// l'échelle et la page se remettrait en page en format mobile. La capture garde la
// mise en page desktop et se réduit proprement.
//
// Le résultat est mis en cache par (projet + révision de l'aperçu) : une capture
// coûte un lancement de Chrome, on ne la refait donc que si le site a changé.

import { importOptional } from '../lib/optional-import';
import { getPreviewRevision } from './runner';

const CHROME_PATHS = ['/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/usr/bin/chromium'];

/** Viewport desktop de référence : la page est mise en page comme sur un écran. */
const SHOT_WIDTH = 1280;
const SHOT_VIEWPORT_HEIGHT = 800;
/** Une capture reste valable 3 min à révision identique (le temps de vie d'un onglet de chat). */
const CACHE_TTL_MS = 3 * 60 * 1000;

interface Shot { buf: Buffer; at: number; key: string }

const cache = new Map<string, Shot>();
/** Une seule capture à la fois par projet : évite N lancements de Chrome en parallèle. */
const inFlight = new Map<string, Promise<Buffer>>();

function revKey(companyId: string): string {
  try {
    const { rev, mrev } = getPreviewRevision(companyId);
    return `${rev}:${mrev}`;
  } catch {
    return '0:0';
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

async function capture(url: string): Promise<Buffer> {
  const browser = await launchBrowser();
  try {
    const ctx = await browser.newContext({
      viewport: { width: SHOT_WIDTH, height: SHOT_VIEWPORT_HEIGHT },
      deviceScaleFactor: 1,
    });
    const page = await ctx.newPage();
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45_000 });
    await page.waitForLoadState('networkidle', { timeout: 15_000 }).catch(() => {});
    // Les polices, images et animations d'entrée du héro se posent.
    await page.waitForTimeout(2200);

    // 1) Bandeau cookies : il flotte au-dessus du contenu et gâcherait la
    //    vignette. On clique « Tout accepter » quand un tel bouton existe.
    await page.evaluate(() => {
      const re = /^(tout accepter|j'accepte|accepter|accept all|accept)$/i;
      const btns = Array.from(document.querySelectorAll('button, a[role="button"]'));
      const hit = btns.find((b) => re.test((b.textContent || '').trim()));
      if (hit) (hit as HTMLElement).click();
    }).catch(() => {});
    await page.waitForTimeout(400);

    // 2) Après l'acceptation, certains sites laissent un toast (« Vos préférences
    //    sont enregistrées… »). On masque les calques flottants dont le texte
    //    parle de cookies/consentement : ils n'appartiennent pas à l'écran d'accueil.
    await page.evaluate(() => {
      const re = /(cookie|consentement|vos préférences|preferences sont enregistr|préférences sont enregistr)/i;
      for (const el of Array.from(document.body.querySelectorAll<HTMLElement>('*'))) {
        const pos = getComputedStyle(el).position;
        if (pos !== 'fixed' && pos !== 'sticky') continue;
        const txt = (el.textContent || '').trim();
        if (txt.length > 400 || !re.test(txt)) continue;
        el.style.setProperty('display', 'none', 'important');
      }
    }).catch(() => {});
    await page.waitForTimeout(200);

    // Les animations en cours sont figées pour que la capture soit nette et
    // reproductible (même image à révision identique).
    await page.addStyleTag({
      content: `*,*::before,*::after{animation-play-state:paused!important;transition:none!important}
        html{scroll-behavior:auto!important}`,
    }).catch(() => {});
    await page.waitForTimeout(250);

    // Un seul viewport, depuis le haut : exactement l'écran d'arrivée.
    const buf = await page.screenshot({ type: 'jpeg', quality: 78, fullPage: false });
    return Buffer.from(buf);
  } finally {
    await browser.close().catch(() => {});
  }
}

/**
 * Capture du premier écran de l'aperçu, en cache par projet + révision.
 * Ne jette que si Chrome ou la page est réellement inaccessible : l'appelant
 * répond alors 503 et le client réessaie.
 */
export async function getPreviewShot(companyId: string, internalUrl: string): Promise<Buffer> {
  const key = revKey(companyId);
  const hit = cache.get(companyId);
  if (hit && hit.key === key && Date.now() - hit.at < CACHE_TTL_MS) return hit.buf;

  const running = inFlight.get(companyId);
  if (running) return running;

  const job = capture(internalUrl)
    .then((buf) => {
      cache.set(companyId, { buf, at: Date.now(), key });
      return buf;
    })
    .finally(() => { inFlight.delete(companyId); });
  inFlight.set(companyId, job);
  return job;
}
