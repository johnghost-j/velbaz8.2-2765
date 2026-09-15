// ─── Fichiers du chat livrés en PDF ──────────────────────────────────────────
//
// [2026-09-05] Demande utilisateur : « partout dans Velbaz, quand l'IA met un
// fichier dans le chat, ça doit se télécharger en PDF ».
//
// Les fichiers que l'IA dépose dans le chat (balises [FILE:chemin|libellé]) sont
// stockés en TEXTE dans `projectFiles` : du Markdown la plupart du temps, parfois
// du code ou du texte brut. La route `/companies/:id/file-download` renvoyait ce
// texte tel quel. Ici on le transforme en vrai PDF.
//
// Choix du moteur : Chrome headless via `playwright-core`, DÉJÀ une dépendance du
// dépôt et déjà utilisé ailleurs (site-scraper, live-qa, genesis-verify, test1).
// Aucune nouvelle dépendance n'est ajoutée. Si Chrome est introuvable, on ne
// bricole pas un faux PDF : on lève, et l'appelant retombe sur le fichier
// d'origine en disant pourquoi.

import { importOptional } from './lib/optional-import';

const CHROME_PATHS = ['/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/usr/bin/chromium'];

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// Passes « en ligne » : gras, italique, code, liens. Appliquées APRÈS
// l'échappement HTML, donc rien de ce qui vient du texte ne peut injecter de
// balise.
function inline(s: string): string {
  let out = escapeHtml(s);
  out = out.replace(/`([^`]+)`/g, '<code>$1</code>');
  out = out.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  out = out.replace(/(^|[^*])\*([^*\n]+)\*/g, '$1<em>$2</em>');
  out = out.replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g, '<a href="$2">$1</a>');
  return out;
}

/**
 * Markdown → HTML. Volontairement compact : titres, listes, tableaux, citations,
 * blocs de code, séparateurs, paragraphes. Ce qui n'est pas reconnu reste du
 * texte, jamais perdu.
 */
export function markdownToHtml(md: string): string {
  const lines = md.replace(/\r\n/g, '\n').split('\n');
  const out: string[] = [];
  let inCode = false;
  let listType: 'ul' | 'ol' | null = null;
  let para: string[] = [];

  const closeList = () => { if (listType) { out.push(`</${listType}>`); listType = null; } };
  const flushPara = () => {
    if (para.length) { out.push(`<p>${inline(para.join(' '))}</p>`); para = []; }
  };

  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i];

    // Bloc de code : tout est pris tel quel jusqu'à la clôture.
    if (/^\s*```/.test(raw)) {
      if (inCode) { out.push('</code></pre>'); inCode = false; }
      else { flushPara(); closeList(); out.push('<pre><code>'); inCode = true; }
      continue;
    }
    if (inCode) { out.push(escapeHtml(raw)); continue; }

    // Tableau Markdown : ligne d'en-tête + ligne de tirets + corps.
    if (/^\s*\|/.test(raw) && /^\s*\|?[\s:|-]+\|/.test(lines[i + 1] || '')) {
      flushPara(); closeList();
      const cells = (r: string) => r.trim().replace(/^\||\|$/g, '').split('|').map(c => c.trim());
      const head = cells(raw);
      out.push('<table><thead><tr>' + head.map(h => `<th>${inline(h)}</th>`).join('') + '</tr></thead><tbody>');
      i += 2;
      while (i < lines.length && /^\s*\|/.test(lines[i])) {
        out.push('<tr>' + cells(lines[i]).map(c => `<td>${inline(c)}</td>`).join('') + '</tr>');
        i++;
      }
      i--;
      out.push('</tbody></table>');
      continue;
    }

    if (!raw.trim()) { flushPara(); closeList(); continue; }

    const h = raw.match(/^(#{1,6})\s+(.*)$/);
    if (h) {
      flushPara(); closeList();
      const lvl = h[1].length;
      out.push(`<h${lvl}>${inline(h[2])}</h${lvl}>`);
      continue;
    }

    if (/^\s*(---|\*\*\*|___)\s*$/.test(raw)) { flushPara(); closeList(); out.push('<hr/>'); continue; }

    if (/^\s*>\s?/.test(raw)) {
      flushPara(); closeList();
      out.push(`<blockquote>${inline(raw.replace(/^\s*>\s?/, ''))}</blockquote>`);
      continue;
    }

    const ul = raw.match(/^\s*[-*+]\s+(.*)$/);
    const ol = raw.match(/^\s*\d+[.)]\s+(.*)$/);
    if (ul || ol) {
      flushPara();
      const want: 'ul' | 'ol' = ul ? 'ul' : 'ol';
      if (listType !== want) { closeList(); out.push(`<${want}>`); listType = want; }
      // Case à cocher Markdown : rendue comme une vraie case, pas comme « [x] ».
      const body = (ul ? ul[1] : ol![1]).replace(/^\[( |x|X)\]\s*/, (_m, c) => (c === ' ' ? '☐ ' : '☑ '));
      out.push(`<li>${inline(body)}</li>`);
      continue;
    }

    para.push(raw.trim());
  }
  if (inCode) out.push('</code></pre>');
  flushPara();
  closeList();
  return out.join('\n');
}

/** Page HTML complète, mise en page pour l'impression A4. */
export function buildPrintableHtml(title: string, bodyHtml: string): string {
  return `<!doctype html>
<html lang="fr"><head><meta charset="utf-8"/><title>${escapeHtml(title)}</title>
<style>
  @page { size: A4; margin: 18mm 16mm; }
  * { box-sizing: border-box; }
  body { margin: 0; font-family: -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
         font-size: 11.5pt; line-height: 1.62; color: #16181d; }
  h1, h2, h3, h4, h5, h6 { line-height: 1.25; margin: 1.5em 0 0.5em; color: #0b0c0f; page-break-after: avoid; }
  h1 { font-size: 22pt; margin-top: 0; letter-spacing: -0.01em; }
  h2 { font-size: 16pt; } h3 { font-size: 13pt; } h4, h5, h6 { font-size: 11.5pt; }
  p { margin: 0 0 0.85em; }
  ul, ol { margin: 0 0 0.9em; padding-left: 1.25em; }
  li { margin: 0.18em 0; }
  a { color: #4338ca; text-decoration: none; word-break: break-word; }
  code { font-family: ui-monospace, "SF Mono", Menlo, Consolas, monospace; font-size: 9.8pt;
         background: #f3f4f6; padding: 0.1em 0.34em; border-radius: 4px; }
  pre { background: #f7f8fa; border: 1px solid #e6e8ec; border-radius: 8px; padding: 10px 12px;
        overflow-wrap: break-word; white-space: pre-wrap; page-break-inside: avoid; }
  pre code { background: none; padding: 0; font-size: 9.4pt; }
  blockquote { margin: 0 0 0.9em; padding: 0.1em 0 0.1em 0.9em; border-left: 3px solid #d8dbe2; color: #4a4f5a; }
  hr { border: none; border-top: 1px solid #e6e8ec; margin: 1.6em 0; }
  table { width: 100%; border-collapse: collapse; margin: 0 0 1em; font-size: 10pt; page-break-inside: avoid; }
  th, td { border: 1px solid #e2e4ea; padding: 6px 9px; text-align: left; vertical-align: top; }
  th { background: #f5f6f8; font-weight: 600; }
  .doc-title { font-size: 9pt; color: #8b909a; letter-spacing: 0.04em; text-transform: uppercase;
               border-bottom: 1px solid #e6e8ec; padding-bottom: 6px; margin-bottom: 18px; }
</style></head>
<body><div class="doc-title">${escapeHtml(title)}</div>${bodyHtml}</body></html>`;
}

/**
 * Rend un contenu texte/Markdown en PDF. Lève si Chrome est introuvable ou si le
 * rendu échoue — l'appelant décide quoi faire, on ne renvoie jamais un PDF vide
 * ou factice.
 */
export async function textToPdf(content: string, title: string): Promise<Uint8Array> {
  const { existsSync } = await import('node:fs');
  const exe = CHROME_PATHS.find(p => existsSync(p));
  if (!exe) throw new Error('Chrome introuvable : conversion PDF impossible');
  const { chromium } = await importOptional<typeof import('playwright-core')>('playwright-core');
  const browser = await chromium.launch({
    executablePath: exe,
    headless: true,
    args: ['--no-sandbox', '--disable-dev-shm-usage', '--disable-gpu'],
  });
  try {
    const page = await browser.newPage();
    const isMarkdownish = /(^|\n)\s{0,3}(#{1,6}\s|[-*+]\s|\d+[.)]\s|\||>|```)/.test(content);
    const body = isMarkdownish
      ? markdownToHtml(content)
      : `<pre><code>${escapeHtml(content)}</code></pre>`;
    await page.setContent(buildPrintableHtml(title, body), { waitUntil: 'load', timeout: 20000 });
    const pdf = await page.pdf({ format: 'A4', printBackground: true });
    return pdf;
  } finally {
    await browser.close().catch(() => {});
  }
}

/** `rapport.md` → `rapport.pdf` ; un nom sans extension reçoit `.pdf`. */
export function pdfFileName(name: string): string {
  return /\.[a-z0-9]{1,6}$/i.test(name) ? name.replace(/\.[a-z0-9]{1,6}$/i, '.pdf') : `${name}.pdf`;
}
