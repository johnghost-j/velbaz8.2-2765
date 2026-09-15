// ─── Nettoyage du code renvoyé par le modèle ────────────────────────────────
//
// [2026-09-14] Bug constaté en direct : après une édition, src/components/
// Footer.tsx commençait par TROIS paragraphes de raisonnement en français
// ("Je dois vérifier: le fichier actuel contient déjà …") suivis du vrai code.
// Le fichier écrit sur le projet était donc un .tsx invalide → la page cassait.
//
// L'ancien `cleanCode` ne retirait la clôture Markdown que si la réponse
// COMMENÇAIT par ``` . Dès que le modèle écrit une phrase avant (ou met son
// code dans un bloc ``` au milieu de son explication), tout partait dans le
// fichier.
//
// Règle appliquée ici, dans cet ordre :
//   1. S'il existe un bloc ```lang … ``` → on ne garde QUE le plus gros bloc.
//   2. Sinon, on coupe tout ce qui précède la première ligne qui ressemble
//      vraiment à du code (import / export / "use client" / déclaration / JSX…).
//   3. On retire une éventuelle queue de prose après la dernière ligne de code.

/** Une ligne qui peut légitimement ouvrir un fichier de code. */
const CODE_START_LINE = new RegExp(
  '^(?:' +
    '["\']use (?:client|server|strict)["\'];?' +       // directive
    '|import\\b' +
    '|export\\b' +
    '|const\\b|let\\b|var\\b' +
    '|function\\b|async\\s+function\\b' +
    '|class\\b|interface\\b|type\\s+[A-Za-z_$]' +
    '|enum\\b|declare\\b|namespace\\b' +
    '|@[A-Za-z]' +                                      // décorateur / at-rule CSS
    '|#!' +                                             // shebang
    '|\\/\\*|\\/\\/' +                                  // commentaire
    '|[{\\[]' +                                         // JSON
    '|<[A-Za-z!/]' +                                    // JSX / HTML
    '|[.#:*A-Za-z][-\\w .#:>()\\[\\]="\',]*\\{\\s*$' +  // sélecteur CSS
    ')',
);

/** Dernière ligne plausible de code (fin de fichier). */
const CODE_END_LINE = /[});\]>]\s*;?\s*$|^\s*(?:\}|\)|\]|>)/;

function extractLargestFencedBlock(s: string): string | null {
  const re = /```[ \t]*([A-Za-z0-9+#._-]*)[ \t]*\r?\n([\s\S]*?)```/g;
  let best: string | null = null;
  let m: RegExpExecArray | null;
  while ((m = re.exec(s)) !== null) {
    const lang = (m[1] || '').toLowerCase();
    // Un bloc explicitement non-code (ex: ```text, ```md) ne remplace pas un
    // bloc de code déjà trouvé, mais sert de repli s'il n'y a que lui.
    const body = m[2];
    if (best === null || body.length > best.length) {
      if (!/^(?:text|txt|md|markdown|log|output)$/.test(lang) || best === null) best = body;
    }
  }
  if (best === null) {
    // Bloc ouvert mais jamais refermé (réponse tronquée) : on garde la suite.
    const open = s.match(/```[ \t]*[A-Za-z0-9+#._-]*[ \t]*\r?\n([\s\S]*)$/);
    if (open) return open[1];
  }
  return best;
}

/**
 * Renvoie le code seul : sans clôture Markdown, sans préambule ni conclusion
 * en prose. Le contenu du code lui-même n'est jamais réécrit.
 */
export function sanitizeModelCode(raw: string): string {
  let s = (raw ?? '').replace(/\r\n/g, '\n').trim();
  if (!s) return '';

  // 1. Bloc Markdown, où qu'il soit dans la réponse.
  if (s.includes('```')) {
    const fenced = extractLargestFencedBlock(s);
    if (fenced !== null && fenced.trim().length >= 20) s = fenced.trim();
    else s = s.replace(/```[A-Za-z0-9+#._-]*/g, '').trim();
  }

  const lines = s.split('\n');

  // 2. Préambule en prose : on saute jusqu'à la première ligne de code.
  let start = 0;
  while (start < lines.length) {
    const t = lines[start].trim();
    if (t === '') { start++; continue; }
    if (CODE_START_LINE.test(t)) break;
    start++;
  }
  // Aucune ligne de code reconnue → la réponse n'est probablement pas du code :
  // on rend la valeur d'origine plutôt que de renvoyer du vide.
  if (start >= lines.length) return s;

  // 3. Queue en prose après la fin du code.
  let end = lines.length - 1;
  while (end > start) {
    const t = lines[end].trim();
    if (t === '') { end--; continue; }
    if (CODE_END_LINE.test(t) || CODE_START_LINE.test(t)) break;
    // Une phrase en fin de réponse ("Voilà, le fichier est à jour.") : on la
    // retire, mais seulement si elle ressemble à de la prose (espaces, pas de
    // ponctuation de code).
    if (/^[A-Za-zÀ-ÿ*#][^{}();=<>]*$/.test(t) && t.includes(' ')) { end--; continue; }
    break;
  }

  return lines.slice(start, end + 1).join('\n').trim();
}
