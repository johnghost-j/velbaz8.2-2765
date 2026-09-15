/**
 * ─── Anti-boucle de questions ────────────────────────────────────────────────
 *
 * Bug MESURÉ (13/09/2026, signalé par l'utilisateur) : après avoir répondu au
 * questionnaire, l'IA reposait ENCORE des questions — souvent les mêmes (nom,
 * cible, style…) — tour après tour. L'utilisateur tournait en rond sans jamais
 * arriver au build : « après avoir répondu ça me repose encore, je veux que ça
 * mette tout en une fois ».
 *
 * Ce module est le garde-fou serveur, indépendant du bon vouloir du modèle :
 *   1. un sujet DÉJÀ RÉPONDU n'est JAMAIS reposé (règle absolue) ;
 *   2. au-delà de MAX_QUESTION_ROUNDS tours de questions, on ne demande plus
 *      rien : l'IA décide elle-même avec ce qu'elle a ;
 *   3. exception : si l'utilisateur demande LUI-MÊME qu'on (re)pose des
 *      questions, il les obtient — c'est lui qui mène.
 *
 * Le rapprochement se fait par SUJET, pas par texte exact : « Quel nom veux-tu
 * donner à ton projet ? » et « Nom de la marque : tu gardes X ou 2-3 autres
 * noms ? » sont le même sujet, donc la seconde ne repasse pas.
 *
 * Aucune dépendance : testable directement.
 */

export type GateQuestion = { q: string; [k: string]: any };
export type GateMessage = { role: string; content: string };

/**
 * Nombre de tours de questions autorisés dans une conversation.
 * 2 = le questionnaire initial + un seul rattrapage. L'utilisateur a dit
 * explicitement que deux fois passe, mais pas plus.
 */
export const MAX_QUESTION_ROUNDS = 2;

/** Sujets de découverte : un sujet répondu une fois ne se redemande plus. */
const TOPICS: { id: string; re: RegExp }[] = [
  { id: 'country', re: /\b(pays|juridiction|country|jurisdiction)\b/i },
  { id: 'name', re: /\b(nom|nommer|s'appelle|appeler|name|naming|brand name)\b/i },
  { id: 'audience', re: /\b(cible|cibles|public|audience|clientèle|clients?|target)\b/i },
  {
    id: 'style',
    re: /\b(style|design|univers|identité visuelle|identite visuelle|ambiance|ambiances|couleurs?|charte|look|visual|branding)\b/i,
  },
  { id: 'price', re: /\b(prix|tarifs?|pricing|price|budget|panier moyen|abonnement|monétisation|monetisation)\b/i },
  { id: 'product', re: /\b(produits?|services?|gamme|catalogue|offre|offres|products?|items?)\b/i },
  { id: 'size', re: /\b(tailles?|coupes?|sizes?|fit|fits)\b/i },
  { id: 'diff', re: /\b(différenc\w*|differenc\w*|concurrents?|competitors?|unique|apart|avantage)\b/i },
  { id: 'goal', re: /\b(but|objectif|objectifs|goal|goals|pour quoi|what is this for)\b/i },
  { id: 'channel', re: /\b(réseaux|reseaux|instagram|tiktok|linkedin|canaux|channels?)\b/i },
  { id: 'delivery', re: /\b(livraison|expédition|expedition|shipping|delivery|stock)\b/i },
  { id: 'payment', re: /\b(paiement|paiements|payment|payments|stripe|carte bancaire)\b/i },
];

/** Texte réduit à sa forme comparable (accents, ponctuation, espaces). */
export function normalizeQuestion(q: string): string {
  return String(q || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/**
 * Sujet d'une question. Faute de sujet connu, on retombe sur le texte
 * normalisé : on ne dédoublonne alors que les questions littéralement
 * identiques, ce qui reste exactement le comportement voulu (ne pas répéter).
 */
export function topicOf(question: string): string {
  const raw = String(question || '');
  for (const t of TOPICS) {
    if (t.re.test(raw)) return t.id;
  }
  return `raw:${normalizeQuestion(raw).slice(0, 60)}`;
}

/** Tours de questions déjà joués (messages assistant portant un bloc questions). */
export function countQuestionRounds(history: GateMessage[] | undefined): number {
  return (history || []).filter(
    m => m.role === 'assistant' && /\[QUESTIONS(_ASKED)?\]/.test(m.content || ''),
  ).length;
}

/** Questions contenues dans un bloc [QUESTIONS] d'un message d'historique. */
function questionsInMessage(content: string): string[] {
  const out: string[] = [];
  const text = String(content || '');
  const re = /\[QUESTIONS\]([\s\S]*?)(?:\[\/QUESTIONS\]|$)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    // Les libellés suffisent : on lit les "q":"…" sans exiger un JSON complet
    // (une réponse tronquée doit compter comme posée malgré tout).
    const qRe = /"q"\s*:\s*"((?:[^"\\]|\\.)*)"/g;
    let q: RegExpExecArray | null;
    while ((q = qRe.exec(m[1]))) {
      try {
        out.push(JSON.parse(`"${q[1]}"`));
      } catch {
        out.push(q[1]);
      }
    }
  }
  return out;
}

/**
 * Une réponse utilisateur compilée par le formulaire ressemble à
 * « Question 1: réponse | Question 2: réponse ». On en extrait les libellés
 * de questions effectivement répondus.
 */
function answeredLabelsInUserMessage(content: string): string[] {
  const text = String(content || '');
  if (!text.includes(':')) return [];
  return text
    .split('|')
    .map(seg => seg.split(':')[0].trim())
    .filter(seg => seg.length > 2 && seg.length < 200);
}

/**
 * Sujets sur lesquels l'utilisateur s'est DÉJÀ exprimé : posés dans un tour
 * précédent puis suivis d'une réponse, ou nommés dans une réponse compilée.
 */
export function answeredTopics(history: GateMessage[] | undefined): Set<string> {
  const msgs = history || [];
  const settled = new Set<string>();

  for (let i = 0; i < msgs.length; i++) {
    const m = msgs[i];
    if (m.role === 'assistant') {
      const asked = questionsInMessage(m.content);
      if (!asked.length) continue;
      // Un tour ne compte comme répondu que si l'utilisateur a bien parlé après.
      const answered = msgs.slice(i + 1).some(n => n.role === 'user' && (n.content || '').trim().length > 0);
      if (!answered) continue;
      for (const q of asked) settled.add(topicOf(q));
    } else if (m.role === 'user') {
      for (const label of answeredLabelsInUserMessage(m.content)) settled.add(topicOf(label));
    }
  }
  return settled;
}

/** L'utilisateur demande-t-il LUI-MÊME (re)poser des questions ? */
export function userWantsQuestions(message: string): boolean {
  return /\b(repose[rz]?|re-?pose[rz]?|reposer|redemande[rz]?|pose[rz]?[- ]moi|redonne[rz]?[- ]?moi|remontre[rz]?|réaffiche|reaffiche|affiche[rz]? (?:les|tes) questions|(?:les|tes) questions|ask me again|ask (?:me )?(?:the )?questions again|show (?:me )?the questions)\b/i.test(
    String(message || ''),
  );
}

export type GateDecision = {
  /** Questions à conserver (éventuellement vide). */
  kept: GateQuestion[];
  /** Questions retirées, avec la raison. */
  dropped: { q: string; reason: 'already-answered' | 'max-rounds' }[];
  /** Vrai si le filtre a retiré quelque chose. */
  changed: boolean;
  /** Vrai si plus AUCUNE question ne doit être posée. */
  exhausted: boolean;
};

/**
 * Filtre un lot de questions avant affichage.
 * @param questions questions que le modèle veut poser
 * @param history   conversation (rôles user/assistant)
 * @param message   dernier message de l'utilisateur
 */
export function gateQuestions(
  questions: GateQuestion[] | undefined,
  history: GateMessage[] | undefined,
  message = '',
): GateDecision {
  const list = (questions || []).filter(q => q && typeof q.q === 'string' && q.q.trim().length > 2);
  if (!list.length) return { kept: [], dropped: [], changed: false, exhausted: false };

  // L'utilisateur réclame les questions : il les a, sans filtre de tour. Seul
  // le dédoublonnage interne reste (deux fois la même question dans un lot).
  const onDemand = userWantsQuestions(message);

  const settled = answeredTopics(history);
  const rounds = countQuestionRounds(history);
  const capReached = !onDemand && rounds >= MAX_QUESTION_ROUNDS;

  const kept: GateQuestion[] = [];
  const dropped: { q: string; reason: 'already-answered' | 'max-rounds' }[] = [];
  const seen = new Set<string>();

  for (const q of list) {
    const topic = topicOf(q.q);
    if (seen.has(topic)) {
      dropped.push({ q: q.q, reason: 'already-answered' });
      continue;
    }
    if (!onDemand && settled.has(topic)) {
      dropped.push({ q: q.q, reason: 'already-answered' });
      continue;
    }
    if (capReached) {
      dropped.push({ q: q.q, reason: 'max-rounds' });
      continue;
    }
    seen.add(topic);
    kept.push(q);
  }

  return {
    kept,
    dropped,
    changed: dropped.length > 0,
    exhausted: kept.length === 0,
  };
}

const QUESTIONS_BLOCK_RE = /\[QUESTIONS\][\s\S]*?(?:\[\/QUESTIONS\]|$)/;

/** Extrait les questions d'un bloc [QUESTIONS] présent dans une réponse. */
export function parseQuestionsBlock(reply: string): GateQuestion[] | null {
  const m = String(reply || '').match(QUESTIONS_BLOCK_RE);
  if (!m) return null;
  const inner = m[0].replace(/^\[QUESTIONS\]/, '').replace(/\[\/QUESTIONS\]$/, '');
  const fb = inner.indexOf('[');
  const lb = inner.lastIndexOf(']');
  try {
    const parsed = JSON.parse(fb !== -1 && lb > fb ? inner.slice(fb, lb + 1) : inner.trim());
    if (Array.isArray(parsed)) {
      return parsed.filter((q: any) => q && typeof q.q === 'string');
    }
  } catch {
    /* bloc illisible : traité comme absent */
  }
  return null;
}

export type GatedReply = {
  /** Réponse réécrite (bloc filtré, ou retiré s'il ne reste rien). */
  reply: string;
  /** Décision appliquée, ou null si la réponse ne posait pas de questions. */
  decision: GateDecision | null;
};

/**
 * Quand on retire TOUT le questionnaire, la réponse peut se réduire à une
 * amorce (« Parfait, encore deux précisions : ») qui n'a plus de sens seule.
 * On la remplace alors par une phrase qui dit la vérité : on a de quoi
 * travailler, la main est à l'utilisateur.
 */
export const EXHAUSTED_FALLBACK_FR =
  "J'ai déjà tout ce qu'il me faut — tu m'as répondu sur ces points. Dis-moi « go » et je lance la création (tu pourras tout ajuster ensuite).";
export const EXHAUSTED_FALLBACK_EN =
  "I already have what I need — you've answered these. Say “go” and I'll start building (you can adjust anything afterwards).";

/** En dessous de ce nombre de caractères, le reste du texte ne tient pas seul. */
const MIN_STANDALONE_LEN = 40;

/**
 * Applique le garde-fou à une réponse complète : réécrit le bloc [QUESTIONS]
 * avec les seules questions légitimes, ou le supprime entièrement quand il ne
 * reste rien à demander.
 *
 * @param fallback phrase de repli si le texte restant ne tient pas seul
 */
export function gateReply(
  reply: string,
  history: GateMessage[] | undefined,
  message = '',
  fallback: string = EXHAUSTED_FALLBACK_FR,
): GatedReply {
  const text = String(reply || '');
  const questions = parseQuestionsBlock(text);
  if (!questions || !questions.length) return { reply: text, decision: null };

  const decision = gateQuestions(questions, history, message);
  if (!decision.changed) return { reply: text, decision };

  if (decision.kept.length) {
    return {
      reply: text.replace(QUESTIONS_BLOCK_RE, `[QUESTIONS]${JSON.stringify(decision.kept)}[/QUESTIONS]`),
      decision,
    };
  }

  const stripped = text.replace(QUESTIONS_BLOCK_RE, '').replace(/\n{3,}/g, '\n\n').trim();
  // Une amorce orpheline (« Encore deux précisions : ») annonce un formulaire
  // qui n'existe plus : on ne laisse jamais ça à l'écran.
  const orphanIntro = /[:?]\s*$/.test(stripped) || stripped.length < MIN_STANDALONE_LEN;
  return { reply: orphanIntro ? fallback : stripped, decision };
}
