/**
 * [2026-09-13] PROMOTION DES QUESTIONS EN TEXTE LIBRE → FORMULAIRE.
 *
 * Problème observé : l'IA finit régulièrement sa réponse par une question
 * posée en prose (« Dis-moi juste : tu veux plutôt démarrer avec
 * t-shirts/hoodies ou robes/ensembles comme premiers produits ? »). Elle
 * s'affiche alors comme du texte noyé dans le message, alors que le front
 * sait déjà rendre un vrai formulaire cliquable au-dessus de la barre de
 * saisie dès qu'un bloc [QUESTIONS]…[/QUESTIONS] est présent.
 *
 * Le prompt interdit déjà les questions hors bloc, mais les modèles s'en
 * écartent. Ce module est le FILET DE SÉCURITÉ côté serveur : il détecte la
 * question finale en prose, la transforme en bloc [QUESTIONS] au format
 * attendu par QuestionTool, et la retire du texte affiché pour éviter le
 * doublon (la question est déjà le titre du formulaire).
 *
 * Aucune dépendance : testable directement.
 */

export type PromotedOption = { id: string; label: string };
export type PromotedQuestion = {
  q: string;
  kind?: 'single' | 'multi' | 'text';
  options?: PromotedOption[];
  allowCustom?: boolean;
  placeholder?: string;
};

/**
 * Blocs protocolaires : une réponse qui en contient déjà un est laissée telle
 * quelle. Volontairement LARGE (n'importe quel marqueur en majuscules entre
 * crochets : [QUESTIONS], [POPUP], [BUILD_COMPANY], [TABLE_VIEW],
 * [COIN_CHART_VIEW], [PREDICTION_VIEW], [CALENDAR_VIEW], …) : ces blocs
 * embarquent du JSON brut que le découpage en phrases ne sait pas gérer.
 * Ne rien promouvoir est sans conséquence ; promouvoir du JSON tronqué
 * casserait la réponse affichée. Le doute profite donc au statu quo.
 */
const PROTOCOL_BLOCK_RE = /\[\/?[A-Z][A-Z0-9_]{2,}\]/;

/**
 * Questions RHÉTORIQUES / de politesse : ce ne sont pas de vraies demandes
 * d'information, les transformer en formulaire serait absurde.
 */
const RHETORICAL_RE =
  /^(ok|okay|d'accord|parfait|super|ça marche|c'est bon|tu vois|non\s*\?|n'est-ce pas|right|make sense|makes sense|des questions|une question|autre chose|quoi d'autre|besoin d'autre chose|anything else|any questions?)\s*\??$/i;

/** Amorces à retirer devant la question (« Dis-moi juste : … »). */
const LEAD_IN_RE =
  /^(?:(?:alors|donc|bref|et|mais)\s+)?(?:dis[- ]moi|dites[- ]moi|raconte[- ]moi|précise[- ]moi|confirme[- ]moi|tell me|let me know|just tell me)\s*(?:juste|simplement|vite|rapidement|only|just)?\s*[:,–—-]?\s*/i;

/** Découpe la réponse en « phrases » en gardant la ponctuation finale. */
function splitSentences(text: string): string[] {
  const out: string[] = [];
  let buf = '';
  for (const ch of text) {
    buf += ch;
    if (ch === '?' || ch === '!' || ch === '.' || ch === '\n') {
      out.push(buf);
      buf = '';
    }
  }
  if (buf.trim()) out.push(buf);
  return out;
}

/** Retire le formatage markdown inline pour obtenir un libellé propre. */
function stripMarkdown(s: string): string {
  return s
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/[*_`]+/g, '')
    .trim();
}

/**
 * Extrait les alternatives d'une question du type « A ou B », « A or B »,
 * « A, B ou C ». Renvoie [] si rien d'exploitable.
 */
function extractAlternatives(question: string): string[] {
  // On travaille sur le corps de la question, sans le « ? » final.
  let body = question.replace(/\s*\?+\s*$/, '');

  // La partie utile commence après le dernier marqueur d'alternative
  // (« plutôt », « préfères-tu », « veux-tu »…) quand il y en a un.
  const sepRe = /\s+(?:ou bien|ou|or)\s+/i;
  if (!sepRe.test(body)) return [];

  // Coupe une éventuelle queue commune après la dernière alternative
  // (« … comme premiers produits ») : on la garde hors des libellés.
  const parts = body
    .split(/\s*,\s*|\s+(?:ou bien|ou|or)\s+/i)
    .map(p => stripMarkdown(p))
    .filter(Boolean);
  if (parts.length < 2) return [];

  // Le premier segment porte souvent la formulation de la question
  // (« tu veux plutôt démarrer avec t-shirts/hoodies ») : on ne conserve que
  // sa fin, après le dernier verbe/préposition d'introduction.
  const INTRO_RE =
    /^.*?\b(?:avec|par|sur|pour|en|de|des|du|d'|le|la|les|un|une|with|by|on|for|start(?:ing)?\s+with|prefer)\s+/i;

  const cleaned: string[] = [];
  for (let i = 0; i < parts.length; i++) {
    let p = parts[i];
    if (i === 0) {
      const m = p.match(INTRO_RE);
      if (m) p = p.slice(m[0].length).trim();
    }
    if (i === parts.length - 1) {
      // Queue commune : « robes/ensembles comme premiers produits »
      p = p.replace(/\s+\b(?:comme|en tant que|pour|as|for)\b\s+.*$/i, '').trim();
    }
    // Un libellé d'option reste court : au-delà, c'est une phrase, pas un choix.
    if (!p || p.length > 48 || p.split(/\s+/).length > 6) return [];
    cleaned.push(p);
  }

  // 2 à 4 options distinctes, non vides.
  const uniq = [...new Set(cleaned.map(c => c.replace(/\s*[.:;]+$/, '')))].filter(Boolean);
  if (uniq.length < 2 || uniq.length > 4) return [];
  return uniq;
}

function slugId(label: string, idx: number): string {
  const base = label
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 24);
  return base || `opt${idx + 1}`;
}

// ─── Listes de questions numérotées ─────────────────────────────────────────
// Cas MESURÉ (13/09/2026) : l'IA écrit ses questions en liste numérotée en
// texte libre (« 1) Nom de la marque : tu gardes X ou tu veux 2-3 autres
// noms ? 2) Cible : âge + style de vie (ex : …) … »). Aucun bloc [QUESTIONS]
// n'est émis : l'utilisateur n'a AUCUN formulaire, et le filet de
// l'orchestrateur remplaçait alors ces questions — précises et adaptées au
// projet — par un questionnaire GÉNÉRIQUE pré-fait. On promeut donc les
// VRAIES questions de l'IA ; le questionnaire par défaut ne sert plus que
// quand il n'y a strictement rien à récupérer.

/** Puce ou numéro en début de ligne : « 1) », « 2. », « - », « • ». */
const LIST_MARKER_RE = /^\s*(?:\(?\d{1,2}[).:\-\]]|[-*•–])\s+/;

/** Une ligne qui RACONTE au lieu de demander : la liste n'est pas un questionnaire. */
const STATEMENT_RE =
  /^(?:j'ai\b|j'|je\s+(?:vais|viens)|fait\b|terminé|ajouté|créé|mis\s+en\s+place|livré|done\b|added\b|created\b|i've\b|i\s+(?:have|added|created|built))/i;

/** Consigne de réponse devenue inutile une fois le formulaire affiché. */
const ANSWER_INSTRUCTION_RE =
  /^(?:réponds?|répondez|reponds?|answer|reply|tu peux répondre|you can (?:answer|reply))\b/i;

/** « plutôt … », « rather … » devant une alternative. */
const QUALIFIER_RE = /^(?:plutôt|plus|rather|more)\s+/i;

/** « tu gardes CoutureNova » → « CoutureNova ». */
const PRONOUN_VERB_RE =
  /^(?:tu|vous|on|je)\s+(?:gardes?|garde|veux|voulez|préfères?|preferes?|prends?|prend|pars?|part|restes?|reste|choisis|choisit|aimes?|aime|want|prefer|keep|pick)\s+(?:plutôt\s+|rather\s+)?(?:avec\s+|sur\s+|pour\s+|with\s+|on\s+|for\s+)?/i;

/** Option qui ne veut rien dire comme choix : « ou autre », « etc. ». */
const FILLER_OPTION_RE =
  /^(?:autre|autres|un autre|something else|other|others|etc\.?|ou autre|…|\.\.\.)$/i;

/**
 * Alternatives d'un ITEM de liste : plus permissif que `extractAlternatives`
 * (jusqu'à 6 choix, nettoyage des amorces « plutôt »/« tu veux »), parce que
 * l'item est déjà identifié comme une question et que son libellé porte la
 * question — les segments restants sont donc bien des choix.
 */
function extractItemAlternatives(body: string): string[] {
  const core = body.replace(/\s*\?+\s*$/, '').trim();
  // « A ou B » est le cas franc. Sans « ou », on accepte une énumération par
  // virgules (« plutôt ajusté, oversize, les deux ? ») mais on l'exige plus
  // stricte : 3 choix minimum et des libellés très courts, sinon une phrase à
  // virgules finirait découpée en fausses options.
  const hasOr = /\s+(?:ou bien|ou|or)\s+/i.test(core);

  const segments = core
    .split(/\s*[,;]\s*|\s+(?:ou bien|ou|or)\s+/i)
    .map(s => stripMarkdown(s).replace(/^\(|\)$/g, '').trim())
    .map(s => s.replace(QUALIFIER_RE, '').replace(PRONOUN_VERB_RE, '').trim())
    .map(s => s.replace(/\s*[.:;]+$/, '').trim())
    .filter(s => s && !FILLER_OPTION_RE.test(s));

  if (!hasOr && segments.length < 3) return [];

  // Un libellé d'option reste court ; au-delà c'est une phrase, pas un choix.
  const maxWords = hasOr ? 6 : 4;
  for (const s of segments) {
    if (s.length > 48 || s.split(/\s+/).length > maxWords) return [];
  }
  const uniq = [...new Set(segments)];
  if (uniq.length < 2 || uniq.length > 6) return [];
  return uniq;
}

/** Transforme une ligne de liste en question exploitable par le formulaire. */
function itemToQuestion(rawItem: string): PromotedQuestion | null {
  let item = stripMarkdown(rawItem.replace(LIST_MARKER_RE, '')).trim();
  if (!item || item.length < 4 || item.length > 200) return null;
  if (STATEMENT_RE.test(item)) return null;

  // Parenthèse finale : exemple (« (ex : 18-30 streetwear…) ») ou précision.
  // Elle sort du libellé et devient le placeholder du champ.
  let hint = '';
  const paren = item.match(/\(([^()]{3,120})\)\s*$/);
  if (paren) {
    hint = paren[1].trim();
    item = item.slice(0, paren.index).trim();
  }
  if (!item || item.length < 4) return null;

  // Corps après l'étiquette (« Cible : âge + style de vie »).
  const colon = item.match(/^([^:]{2,60}?)\s*:\s*(.+)$/);
  const body = colon ? colon[2].trim() : item;

  const q = item.charAt(0).toUpperCase() + item.slice(1);
  const alts = extractItemAlternatives(body);
  if (alts.length) {
    return {
      q,
      kind: 'single',
      options: alts.map((label, i) => ({
        id: slugId(label, i),
        label: label.charAt(0).toUpperCase() + label.slice(1),
      })),
      allowCustom: true,
    };
  }

  const placeholder = /^(?:ex|e\.g|par ex|exemple)\b/i.test(hint)
    ? hint.charAt(0).toUpperCase() + hint.slice(1)
    : hint
      ? `Ex : ${hint}`
      : 'Ta réponse…';
  return { q, kind: 'text', placeholder };
}

export type ListPromotionResult = {
  /** Réponse réécrite : liste retirée du texte + bloc [QUESTIONS] ajouté. */
  reply: string;
  /** Les questions promues (vide si rien n'a été transformé). */
  promoted: PromotedQuestion[];
};

/**
 * Détecte une LISTE de questions écrite en texte libre et la promeut en bloc
 * [QUESTIONS] (les vraies questions de l'IA, pas un questionnaire générique).
 * Ne touche à rien si la réponse contient déjà un bloc protocolaire, si la
 * liste ne comporte pas au moins deux questions, ou si un item raconte un
 * travail fait au lieu de demander une information.
 */
export function promoteProseQuestionList(rawReply: string): ListPromotionResult {
  const reply = rawReply || '';
  if (!reply.trim()) return { reply, promoted: [] };
  if (PROTOCOL_BLOCK_RE.test(reply)) return { reply, promoted: [] };
  if (!reply.includes('?')) return { reply, promoted: [] };

  const lines = reply.split('\n');
  // Bloc de liste le plus long (tolère une ligne vide entre deux items).
  let best: { start: number; end: number; idx: number[] } | null = null;
  let cur: { start: number; end: number; idx: number[] } | null = null;
  for (let i = 0; i < lines.length; i++) {
    const isItem = LIST_MARKER_RE.test(lines[i]);
    const isBlank = !lines[i].trim();
    if (isItem) {
      if (!cur) cur = { start: i, end: i, idx: [] };
      cur.end = i;
      cur.idx.push(i);
    } else if (cur && !isBlank) {
      if (!best || cur.idx.length > best.idx.length) best = cur;
      cur = null;
    }
  }
  if (cur && (!best || cur.idx.length > best.idx.length)) best = cur;
  if (!best || best.idx.length < 2) return { reply, promoted: [] };

  const items = best.idx.map(i => lines[i]);
  // La liste doit VRAIMENT interroger : au moins deux items interrogatifs, ou
  // trois items dont un interrogatif (liste « étiquette : valeur attendue »).
  const withQ = items.filter(s => s.includes('?')).length;
  if (!(withQ >= 2 || (items.length >= 3 && withQ >= 1))) return { reply, promoted: [] };

  const promoted: PromotedQuestion[] = [];
  for (const raw of items) {
    const q = itemToQuestion(raw);
    if (!q) return { reply, promoted: [] }; // un seul item douteux → on ne touche à rien
    promoted.push(q);
  }
  if (promoted.length < 2) return { reply, promoted: [] };
  if (promoted.length > 8) return { reply, promoted: [] };

  // Texte affiché : ce qui précède la liste + ce qui suit, sans la consigne
  // « Réponds en quelques mots » (le formulaire la rend inutile).
  const before = lines.slice(0, best.start).join('\n').trim();
  const after = lines
    .slice(best.end + 1)
    .filter(l => !ANSWER_INSTRUCTION_RE.test(l.trim()))
    .join('\n')
    .trim();
  const body = [before, after].filter(Boolean).join('\n\n').trim();
  const rebuilt = `${body}\n\n[QUESTIONS]${JSON.stringify(promoted)}[/QUESTIONS]`.trim();

  return { reply: rebuilt, promoted };
}

export type PromotionResult = {
  /** Réponse réécrite : question retirée du texte + bloc [QUESTIONS] ajouté. */
  reply: string;
  /** La question promue, ou null si rien n'a été transformé. */
  promoted: PromotedQuestion | null;
};

/**
 * Détecte une question posée en prose à la FIN de la réponse et la promeut en
 * bloc [QUESTIONS]. Ne touche pas la réponse si :
 *  - elle contient déjà un bloc protocolaire (questions/popup/plan…) ;
 *  - aucune phrase interrogative ne termine la réponse ;
 *  - la question est rhétorique/de politesse.
 */
export function promoteProseQuestion(rawReply: string): PromotionResult {
  const reply = rawReply || '';
  if (!reply.trim()) return { reply, promoted: null };
  if (PROTOCOL_BLOCK_RE.test(reply)) return { reply, promoted: null };
  if (!reply.includes('?')) return { reply, promoted: null };

  const sentences = splitSentences(reply);

  // On cherche la dernière phrase interrogative NON vide, et on exige qu'elle
  // soit vraiment en fin de réponse (rien de substantiel après).
  let idx = -1;
  for (let i = sentences.length - 1; i >= 0; i--) {
    const s = sentences[i].trim();
    if (!s) continue;
    if (s.endsWith('?')) { idx = i; break; }
    // Du texte réel après la question → ce n'est pas une question finale.
    if (s.replace(/[\s\-–—*_`]/g, '').length > 0) return { reply, promoted: null };
  }
  if (idx === -1) return { reply, promoted: null };

  const rawQuestion = sentences[idx].trim();
  let question = stripMarkdown(rawQuestion);

  // Amorce « Dis-moi juste : » retirée, la question devient autonome.
  question = question.replace(LEAD_IN_RE, '').trim();
  if (question) question = question.charAt(0).toUpperCase() + question.slice(1);

  if (!question || question.length < 8 || question.length > 300) {
    return { reply, promoted: null };
  }
  if (RHETORICAL_RE.test(question.replace(/\s*\?+\s*$/, '').trim())) {
    return { reply, promoted: null };
  }

  const alts = extractAlternatives(question);
  const promoted: PromotedQuestion = alts.length
    ? {
        q: question,
        kind: 'single',
        options: alts.map((label, i) => ({
          id: slugId(label, i),
          label: label.charAt(0).toUpperCase() + label.slice(1),
        })),
        allowCustom: true,
      }
    : { q: question, kind: 'text', placeholder: 'Ta réponse…' };

  // Texte affiché : on enlève la question (elle est le titre du formulaire).
  const kept = sentences.slice(0, idx).join('').replace(/\s+$/, '');
  const body = kept.trim();
  const rebuilt = `${body}\n\n[QUESTIONS]${JSON.stringify([promoted])}[/QUESTIONS]`;

  return { reply: rebuilt, promoted };
}
