// ─── PHASE 9 — Boucle de conformité visuelle ─────────────────────────────────
// Le maillon manquant du moteur /genesis : jusqu'ici PERSONNE ne regardait la
// page réellement construite. On capture donc la page dans un vrai navigateur,
// on la compare à la maquette d'écran validée en phase 4bis, et un juge visuel
// isolé renvoie une liste de corrections concrètes que l'agent de code applique.
// Max 3 cycles (piloté côté client), puis on s'arrête, conforme ou non.

import { generateText } from "ai";
import { gateway } from "./agent/gateway";
import { importOptional } from './lib/optional-import';

const VISION_MODEL = "google/gemini-3-flash";
const CHROME_PATHS = ["/usr/bin/google-chrome", "/usr/bin/google-chrome-stable", "/usr/bin/chromium"];

export const GENESIS_MAX_VERIFY_CYCLES = 3;

export interface GenesisVerifyResult {
  ok: boolean;              // capture + jugement réalisés
  conform: boolean;         // page jugée conforme à la maquette
  score: number;            // 0-10
  corrections: string[];    // instructions concrètes pour l'agent de code
  verdict: string;          // texte brut du juge
  shot?: string;            // data URI de la capture (debug)
  error?: string;
}

const JUDGE_SYSTEM = `Tu es directeur artistique. Tu reçois DEUX images :
1) la MAQUETTE de référence validée (ce que la page doit être) ;
2) la CAPTURE de la page réellement construite dans un navigateur.

Ta mission : lister ce qui doit changer DANS LE CODE pour que la capture
ressemble à la maquette. Tu compares uniquement ce qui est reproductible en
HTML/CSS : patron de composition, géométrie et proportions, échelle et graisse
typographiques, cadrage et taille des images, palette, zones de vide, ordre de
superposition, alignements de bord, micro-détails (filet, méta-infos, nav).

Ne demande JAMAIS de reproduire le faux texte de la maquette : le texte réel
est celui de la page construite, c'est normal qu'il diffère.

Note de 0 à 10 la fidélité globale (10 = même page). Le seuil de conformité
est 8. En dessous, écris entre 3 et 8 corrections, chacune formulée comme une
instruction exécutable et mesurable, par exemple :
« Le titre du hero fait environ 6vw : passe-le à 14vw, letter-spacing -0.04em,
et fais-le déborder à droite du viewport de 4vw. »
Jamais de commentaire vague type « rendre plus élégant ».

Termine par une dernière ligne JSON compacte, exactement :
{"score":N,"conform":true|false,"corrections":["…"]}

Budget de sortie : 350 mots maximum.`;

async function launchBrowser() {
  const { chromium } = await importOptional<typeof import('playwright-core')>('playwright-core');
  const { existsSync } = await import("node:fs");
  const executablePath = CHROME_PATHS.find(p => existsSync(p));
  if (!executablePath) throw new Error("Chrome introuvable");
  return chromium.launch({
    executablePath,
    headless: true,
    args: ["--no-sandbox", "--disable-dev-shm-usage", "--disable-gpu"],
  });
}

/** Capture la page en 1440x900 (au-dessus de la ligne de flottaison + page entière). */
export async function screenshotPage(url: string): Promise<string> {
  const browser = await launchBrowser();
  try {
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
    const page = await ctx.newPage();
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 45_000 });
    // On laisse les polices, images et animations d'entrée se poser.
    await page.waitForTimeout(4500);
    const buf = await page.screenshot({ type: "jpeg", quality: 78, fullPage: false });
    return `data:image/jpeg;base64,${buf.toString("base64")}`;
  } finally {
    await browser.close().catch(() => {});
  }
}

/**
 * Compare la page construite à la maquette de référence et renvoie les
 * corrections à appliquer. Ne jette jamais : en cas de panne on renvoie
 * `ok: false` et l'appelant continue sans boucle de conformité.
 */
export async function verifyAgainstMockup(opts: {
  url: string;
  mockupDataUrl: string;
  intent?: string;
}): Promise<GenesisVerifyResult> {
  let shot = "";
  try {
    shot = await screenshotPage(opts.url);
  } catch (e) {
    return { ok: false, conform: true, score: 0, corrections: [], verdict: "", error: `capture KO : ${(e as Error).message}` };
  }
  try {
    const res = await generateText({
      model: gateway(VISION_MODEL),
      system: JUDGE_SYSTEM,
      messages: [{
        role: "user",
        content: [
          { type: "text", text: `Image 1 = MAQUETTE de référence. Image 2 = CAPTURE de la page construite.${opts.intent ? `\n\nIntention écrite :\n${opts.intent.slice(0, 3000)}` : ""}` },
          { type: "image", image: opts.mockupDataUrl },
          { type: "image", image: shot },
        ],
      }] as any,
      maxOutputTokens: 900,
      maxRetries: 1,
      abortSignal: AbortSignal.timeout(180_000),
    });
    const raw = res.text || "";
    let score = 0;
    let conform = false;
    let corrections: string[] = [];
    const line = raw.match(/\{[^{}]*"score"[\s\S]*?\}\s*$/);
    if (line) {
      try {
        const j = JSON.parse(line[0]);
        score = Number(j.score) || 0;
        conform = Boolean(j.conform);
        if (Array.isArray(j.corrections)) corrections = j.corrections.map(String).filter(Boolean);
      } catch { /* repli ci-dessous */ }
    }
    if (!score) {
      const m = raw.match(/\b(\d{1,2})\s*\/\s*10/);
      if (m) score = Number(m[1]);
    }
    if (score >= 8) conform = true;
    if (conform) corrections = [];
    return { ok: true, conform, score, corrections, verdict: raw, shot };
  } catch (e) {
    return { ok: false, conform: true, score: 0, corrections: [], verdict: "", shot, error: `juge KO : ${(e as Error).message}` };
  }
}
