/**
 * ─── Fidélité à la QUANTITÉ demandée ────────────────────────────────────────
 *
 * Bug MESURÉ (13/09/2026, signalé par l'utilisateur) : « ajoute mon premier
 * produit » → l'IA a ajouté PLUSIEURS produits. Et quand aucun nombre n'est
 * donné, elle fait « ce qu'elle veut ».
 *
 * Un modèle de code laissé libre « remplit » toujours : on lui demande un
 * produit, il en génère une grille de six parce que ça fait plus joli. Le
 * résultat n'est pas ce que l'utilisateur a demandé — donc c'est faux, même
 * si c'est beau.
 *
 * Ce module lit la quantité RÉELLEMENT demandée dans la phrase et en fait une
 * contrainte explicite injectée dans les prompts d'édition :
 *   · « mon premier produit », « un produit », « un seul » → EXACTEMENT 1 ;
 *   · « 3 produits », « trois produits »                   → EXACTEMENT 3 ;
 *   · « des produits » (pluriel sans nombre)               → 3 MAXIMUM, annoncé.
 *
 * Ne s'active que sur les demandes d'AJOUT/CRÉATION : sur « change la couleur
 * en un bleu plus clair », la notion de quantité n'a aucun sens et le module
 * doit rester muet.
 *
 * Aucune dépendance : testable directement.
 */

export type RequestedCount = {
  /** Quantité exacte demandée, ou null si l'utilisateur n'a donné aucun nombre. */
  count: number | null;
  /** L'objet compté, tel qu'écrit par l'utilisateur ("produit", "page"…). */
  unit: string | null;
  /** Formulation au pluriel sans nombre ("des produits", "quelques pages"). */
  plural: boolean;
  /** Le fragment de la phrase qui porte la quantité (pour le citer au modèle). */
  quote: string;
};

const NONE: RequestedCount = { count: null, unit: null, plural: false, quote: '' };

/** Verbes d'ajout/création : hors de ce cadre, la quantité ne veut rien dire. */
const ADD_VERB =
  /\b(ajoute[rz]?|rajoute[rz]?|ajouter|cr[ée]{1,2}[rz]?|cr[ée]er|mets?|mettre|met[- ]?y|g[ée]n[èée]re[rz]?|ins[èée]re[rz]?|add|create|insert|put)\b/i;

/** Nombres écrits en lettres (FR + EN). */
const NUMBER_WORDS: Record<string, number> = {
  un: 1, une: 1, deux: 2, trois: 3, quatre: 4, cinq: 5, six: 6, sept: 7, huit: 8,
  neuf: 9, dix: 10, onze: 11, douze: 12,
  one: 1, two: 2, three: 3, four: 4, five: 5, six_en: 6, seven: 7, eight: 8,
  nine: 9, ten: 10, eleven: 11, twelve: 12,
};

/** Ordinaux : « mon PREMIER produit » = on en ajoute UN. */
const ORDINAL_ONE = /\b(premier|premi[èe]re|1\s*(er|re|ère)|first)\b/i;

/** Marqueurs de pluriel sans nombre. */
const PLURAL_DET = /\b(des|les|ces|mes|tes|ses|nos|vos|leurs|plusieurs|quelques|divers|differents?|diff[ée]rents?|some|several|a few|multiple)\b/i;

/** Insistance sur l'unité : « un seul », « juste un ». */
const ONLY_ONE = /\b(un|une|1)\s+seule?\b|\bjuste\s+(un|une|1)\b|\bseulement\s+(un|une|1)\b|\bune?\s+seule?\b|\bonly\s+one\b|\bjust\s+one\b|\ba\s+single\b/i;

/** Mots qui ne sont jamais des objets à compter (couleurs, notions, adverbes). */
const NOT_COUNTABLE = new Set([
  'peu', 'plus', 'moins', 'bleu', 'bleue', 'rouge', 'vert', 'verte', 'jaune', 'noir', 'noire',
  'blanc', 'blanche', 'gris', 'grise', 'rose', 'orange', 'violet', 'violette', 'couleur',
  'style', 'ton', 'air', 'look', 'aspect', 'cote', 'côté', 'fond', 'truc', 'chose', 'moment',
  'instant', 'coup', 'fois', 'clic', 'oeil', 'œil', 'peu_de', 'bit', 'touch', 'little',
]);

const normalize = (s: string) =>
  String(s || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '');

/** Un mot est-il au pluriel ? (FR : finale en s/x, hors faux positifs) */
function isPluralWord(word: string): boolean {
  const w = normalize(word);
  if (/(ss|us|as|is)$/.test(w)) return false; // "bus", "colis", "pays"…
  return /[sx]$/.test(w);
}

/** Le mot compté, juste après la quantité. */
function unitAfter(segment: string): string | null {
  const m = segment.match(/^[\s,]*([a-zàâäéèêëîïôöùûüç'-]{3,30})/i);
  if (!m) return null;
  const w = m[1].replace(/^l'/, '');
  if (NOT_COUNTABLE.has(normalize(w))) return null;
  // Adjectifs/qualificatifs courants qui précèdent le vrai nom : on les saute.
  if (/^(nouveau|nouvelle|nouveaux|nouvelles|autre|autres|petit|petite|grand|grande|new|other)$/i.test(w)) {
    return unitAfter(segment.replace(/^[\s,]*[a-zàâäéèêëîïôöùûüç'-]+/i, ''));
  }
  return w;
}

/**
 * Lit la quantité demandée dans un message utilisateur.
 * Ne renvoie une quantité QUE pour une demande d'ajout/création.
 */
export function parseRequestedCount(message: string): RequestedCount {
  const raw = String(message || '');
  if (!raw.trim()) return NONE;

  const verb = raw.match(ADD_VERB);
  if (!verb) return NONE;

  // On ne lit la quantité que DANS la demande d'ajout (après le verbe) : un
  // nombre situé ailleurs ("j'ai 3 idées, ajoute un produit") n'est pas la
  // quantité demandée.
  const after = raw.slice((verb.index || 0) + verb[0].length);

  // 1. « un seul », « juste un » : l'utilisateur INSISTE sur l'unité.
  const only = after.match(ONLY_ONE);
  if (only) {
    const seg = after.slice((only.index || 0) + only[0].length);
    return { count: 1, unit: unitAfter(seg), plural: false, quote: only[0].trim() };
  }

  // 2. Chiffre explicite : « 3 produits ».
  const digit = after.match(/\b(\d{1,3})\s+([a-zàâäéèêëîïôöùûüç'-]{3,30})/i);
  if (digit) {
    const n = parseInt(digit[1], 10);
    if (n >= 1 && n <= 200 && !NOT_COUNTABLE.has(normalize(digit[2]))) {
      return { count: n, unit: digit[2], plural: n > 1, quote: `${digit[1]} ${digit[2]}` };
    }
  }

  // 3. Nombre en lettres : « trois produits ».
  const wordNum = after.match(
    /\b(deux|trois|quatre|cinq|six|sept|huit|neuf|dix|onze|douze|two|three|four|five|seven|eight|nine|ten|eleven|twelve)\s+([a-zàâäéèêëîïôöùûüç'-]{3,30})/i,
  );
  if (wordNum) {
    const n = NUMBER_WORDS[normalize(wordNum[1])];
    if (n && !NOT_COUNTABLE.has(normalize(wordNum[2]))) {
      return { count: n, unit: wordNum[2], plural: n > 1, quote: `${wordNum[1]} ${wordNum[2]}` };
    }
  }

  // 4. Ordinal : « mon PREMIER produit » → on en ajoute UN.
  const ord = after.match(ORDINAL_ONE);
  if (ord) {
    const seg = after.slice((ord.index || 0) + ord[0].length);
    const unit = unitAfter(seg) || unitAfter(after.slice(0, ord.index || 0).split(/\s+/).slice(-2).join(' '));
    return { count: 1, unit, plural: false, quote: after.slice(Math.max(0, (ord.index || 0) - 12), (ord.index || 0) + ord[0].length + 14).trim() };
  }

  // 5. Déterminant + nom : le NOMBRE GRAMMATICAL tranche.
  const det = after.match(
    /\b(un|une|le|la|l'|ce|cet|cette|mon|ma|ton|ta|son|sa|des|les|ces|mes|tes|ses|plusieurs|quelques|a|an|the|some|several)\s*([a-zàâäéèêëîïôöùûüç'-]{3,30})/i,
  );
  if (det) {
    const determiner = det[1];
    // Le nom réel peut être précédé d'un adjectif (« un NOUVEAU produit ») :
    // unitAfter() les saute, sinon l'unité citée au modèle serait « nouveau ».
    const afterDet = after.slice((det.index || 0) + determiner.length);
    const noun = unitAfter(afterDet) || det[2];
    if (NOT_COUNTABLE.has(normalize(noun))) return NONE;
    const pluralDet = PLURAL_DET.test(determiner);
    const pluralNoun = isPluralWord(noun);
    if (pluralDet || pluralNoun) {
      return { count: null, unit: noun, plural: true, quote: `${determiner} ${noun}` };
    }
    return { count: 1, unit: noun, plural: false, quote: `${determiner} ${noun}` };
  }

  // 6. Nom nu après le verbe : « ajoute produit vélo ».
  const bare = unitAfter(after);
  if (bare) {
    const plural = isPluralWord(bare);
    return { count: plural ? null : 1, unit: bare, plural, quote: bare };
  }

  return NONE;
}

/** Plafond appliqué quand l'utilisateur parle au pluriel sans donner de nombre. */
export const UNSPECIFIED_PLURAL_CAP = 3;

/**
 * Contrainte de quantité à injecter dans un prompt d'édition.
 * Renvoie null quand la demande ne porte aucune quantité lisible : on n'invente
 * pas de contrainte, on reste muet.
 */
export function countConstraint(message: string, lang = 'fr'): string | null {
  const parsed = parseRequestedCount(message);
  if (parsed.count === null && !parsed.plural) return null;

  const en = lang === 'en';
  const unit = parsed.unit ? `"${parsed.unit}"` : en ? 'item(s)' : 'élément(s)';

  if (parsed.count !== null) {
    const n = parsed.count;
    return en
      ? `## EXACT QUANTITY — MANDATORY
The user asked for EXACTLY ${n} ${unit} (their words: "${parsed.quote}"). Add EXACTLY ${n}, no more.
- Do NOT add extras "for demo purposes", "to fill the grid" or "to make it look better".
- If the layout looks empty with ${n}, that is FINE: an honest layout with ${n} ${unit} beats a grid the user never asked for.
- Adding ${n + 1} or more is a FAILURE, even if the result looks nicer.`
      : `## QUANTITÉ EXACTE — IMPÉRATIF
L'utilisateur a demandé EXACTEMENT ${n} ${unit} (ses mots : « ${parsed.quote} »). Tu en ajoutes EXACTEMENT ${n}, pas un de plus.
- N'ajoute AUCUN élément « d'exemple », « pour remplir la grille » ou « pour faire plus joli ».
- Si la mise en page paraît vide avec ${n}, c'est NORMAL et c'est ACCEPTÉ : une grille honnête à ${n} ${unit} vaut mieux qu'une grille inventée.
- En ajouter ${n + 1} ou plus est un ÉCHEC, même si le rendu est plus beau.
- La structure d'affichage (grille, liste) doit s'adapter à ${n}, pas l'inverse.`;
  }

  return en
    ? `## QUANTITY — NO NUMBER GIVEN
The user used a plural without a number ("${parsed.quote}"). Add ${UNSPECIFIED_PLURAL_CAP} ${unit} AT MOST, and state how many you added in your summary so they can ask for more. Never generate a large batch on your own initiative.`
    : `## QUANTITÉ — AUCUN NOMBRE DONNÉ
L'utilisateur a employé un pluriel sans nombre (« ${parsed.quote} »). Tu en ajoutes ${UNSPECIFIED_PLURAL_CAP} AU MAXIMUM, et tu DIS combien tu en as ajouté dans ton résumé pour qu'il puisse en demander plus. Tu ne génères JAMAIS un gros lot de ta propre initiative.`;
}

// ─── VÉRIFICATION MÉCANIQUE (le prompt ne suffit pas) ────────────────────────
// Constat de terrain [2026-09-13] : même avec « EXACTEMENT 1 » en majuscules
// dans le prompt, le modèle de code ajoutait 2 produits de plus « pour que la
// grille soit belle ». On ne lui fait donc plus confiance : on COMPTE les
// éléments avant/après, et une réécriture qui dépasse la quantité demandée est
// rejetée puis refaite avec le chiffre réel de son dépassement.

/** Clés qui marquent le début d'un élément dans une liste de données. */
const ITEM_KEYS = [/\bid\s*:/g, /\bname\s*:/g, /\btitle\s*:/g, /\blabel\s*:/g, /\bslug\s*:/g];

/**
 * Estime le nombre d'éléments de liste présents dans un fichier.
 * Heuristique volontairement simple : on ne s'en sert que pour un DELTA
 * avant/après sur le MÊME fichier, où le bruit se compense.
 */
export function countListItems(content: string): number {
  if (!content) return 0;
  let max = 0;
  for (const re of ITEM_KEYS) {
    const n = (content.match(re) || []).length;
    if (n > max) max = n;
  }
  return max;
}

/** Combien d'éléments une réécriture a-t-elle ajoutés ? (négatif = suppression) */
export function addedItems(before: string, after: string): number {
  return countListItems(after) - countListItems(before);
}

/**
 * Rappel correctif à coller à l'instruction quand la tentative précédente a
 * dépassé la quantité demandée. On lui donne les chiffres EXACTS (il en a mis
 * N, il en fallait M) plus la cible totale à atteindre dans le fichier.
 */
export function overshootFeedback(
  added: number,
  requested: number,
  beforeTotal: number,
  lang = 'fr',
): string {
  const target = beforeTotal + requested;
  return lang === 'en'
    ? `## PREVIOUS ATTEMPT REJECTED — TOO MANY ITEMS
You added ${added} items; the user asked for EXACTLY ${requested}. Redo it: keep ONLY ${requested} new item(s) — the most relevant one(s) — and delete the ${added - requested} extra one(s) you invented. The file had ${beforeTotal} item(s); it must end with EXACTLY ${target}. Do not delete any pre-existing item.`
    : `## TENTATIVE PRÉCÉDENTE REFUSÉE — TROP D'ÉLÉMENTS
Tu en as ajouté ${added} alors que l'utilisateur en a demandé EXACTEMENT ${requested}. Recommence : tu gardes SEULEMENT ${requested} nouvel(s) élément(s) — le/les plus pertinent(s) — et tu SUPPRIMES les ${added - requested} que tu as inventés en plus. Le fichier en contenait ${beforeTotal} ; il doit en contenir EXACTEMENT ${target} à la fin. Tu ne supprimes aucun élément déjà présent.`;
}

/**
 * Cible chiffrée ajoutée à l'instruction AVANT la première tentative : donner
 * le total attendu (« il y en a 1, il doit y en avoir 2 ») marche bien mieux
 * qu'un simple « ajoute 1 », que le modèle lit comme « ajoute au moins 1 ».
 */
export function targetTotalHint(beforeTotal: number, requested: number, lang = 'fr'): string {
  const target = beforeTotal + requested;
  return lang === 'en'
    ? `## TARGET COUNT IN THIS FILE
This file currently holds ${beforeTotal} item(s) of that kind. After your edit it must hold EXACTLY ${target} — you add ${requested}, you remove none, you invent none.`
    : `## COMPTE CIBLE DANS CE FICHIER
Ce fichier contient actuellement ${beforeTotal} élément(s) de ce type. Après ta modification il doit en contenir EXACTEMENT ${target} — tu en ajoutes ${requested}, tu n'en supprimes aucun, tu n'en inventes aucun.`;
}
