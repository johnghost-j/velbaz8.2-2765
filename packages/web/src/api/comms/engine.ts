/**
 * MOTEUR COMMUNICATION / PUB / MARKETING
 *
 * Le défaut corrigé ici : avant, un message reçu produisait UNE réponse écrite
 * d'un seul jet. Désormais chaque demande passe par 3 étapes explicites :
 *
 *   1. ÉTUDE    — on analyse le message avant d'écrire (intention réelle,
 *                 émotion, enjeu commercial, objection cachée, risque).
 *   2. PISTES    — on génère 3 propositions d'ANGLES DIFFÉRENTS (pas 3 fois la
 *                 même chose), en s'appuyant sur les leçons déjà apprises.
 *   3. JUGEMENT  — un juge note chaque piste sur des critères propres à la
 *                 tâche, choisit la meilleure et dit pourquoi.
 *
 * Tout est renvoyé à la console admin (l'étude, les pistes, la note, le
 * raisonnement) pour que l'admin puisse noter et corriger.
 */

import { generateText } from 'ai';
import { gateway } from '../agent/gateway';
import { runWithAiContext } from '../ai-usage/context';
import {
  buildLearningBlock,
  recordExample,
  REASONING_MODEL,
  TASK_LABELS,
  type TaskKind,
} from './learning';

export interface RunInput {
  task: TaskKind;
  input: string;
  context?: string;
  companyId?: string | null;
  createdBy?: string | null;
  model?: string;
  /**
   * 'direct'  — PRODUCTION : l'IA sort DU PREMIER COUP la meilleure réponse,
   *             une seule, en appliquant ce qu'elle a appris. Aucun choix
   *             entre plusieurs propositions.
   * 'train'   — CONSOLE ADMIN UNIQUEMENT : 3 pistes + un juge, pour que
   *             l'admin voie le raisonnement, note et corrige. Sert a
   *             ameliorer l'IA, jamais a repondre en vrai.
   * Defaut : 'direct'.
   */
  mode?: RunMode;
}

export type RunMode = 'direct' | 'train';

export interface Variant {
  angle: string;
  content: string;
  score?: number;
  why?: string;
}

export interface RunResult {
  exampleId: string;
  mode: RunMode;
  task: TaskKind;
  lang: string;
  study: Study | null;
  variants: Variant[];
  best: Variant | null;
  selfScore: number | null;
  verdict: string;
  learned: boolean;
  durationMs: number;
  steps: { step: string; ms: number }[];
}

export interface Study {
  langue?: string;
  intention?: string;
  emotion?: string;
  urgence?: string;
  enjeu?: string;
  objection?: string;
  cible?: string;
  objectif?: string;
  risques?: string[];
  [k: string]: unknown;
}

// ─── Cadres par tâche ───────────────────────────────────────────────────────

interface TaskSpec {
  /** Ce que l'étape d'étude doit chercher en priorité. */
  studyFocus: string;
  /** Le métier du rédacteur. */
  writer: string;
  /** Ce qu'une « piste » doit contenir. */
  variantShape: string;
  /** Les critères de jugement, propres à la tâche. */
  criteria: string;
}

const SPECS: Record<TaskKind, TaskSpec> = {
  reply: {
    studyFocus: `Ce que la personne VEUT vraiment (pas ce qu'elle dit littéralement), son émotion, son niveau d'urgence, l'enjeu commercial (client perdu ? vente possible ? risque public ?), l'objection cachée, et si le message est un piège/troll/spam.`,
    writer: `un responsable relation client qui vend sans jamais avoir l'air de vendre`,
    variantShape: `le message de réponse EXACT, prêt à envoyer (pas de méta-commentaire, pas de "voici ma réponse")`,
    criteria: `1) répond vraiment à la demande réelle ; 2) ton juste par rapport à l'émotion détectée ; 3) fait avancer le business (prochaine étape claire) sans être commercial lourd ; 4) court et lisible sur mobile ; 5) aucune promesse intenable, aucun mensonge ; 6) désamorce le risque public si le message est négatif.`,
  },
  ad: {
    studyFocus: `Le produit, à qui il s'adresse VRAIMENT, la douleur précise qu'il enlève, ce qui le distingue, les objections d'achat, et l'angle que tous les concurrents utilisent déjà (à éviter).`,
    writer: `un directeur de création publicitaire qui a fait vendre des produits difficiles`,
    variantShape: `une idée de pub complète : accroche (hook), promesse, visuel décrit en une phrase, et call-to-action`,
    criteria: `1) l'accroche arrête le scroll dans les 2 premières secondes ; 2) elle parle de la douleur du client, pas des caractéristiques du produit ; 3) l'angle est différent du cliché du secteur ; 4) le visuel est réalisable sans budget de tournage ; 5) le CTA est une seule action évidente ; 6) crédible, aucune promesse illégale ou exagérée.`,
  },
  schedule: {
    studyFocus: `Le type de contenu, la plateforme visée, le fuseau et les habitudes du public cible (quand il est disponible et réceptif, pas seulement quand il est en ligne), et le rythme déjà en place.`,
    writer: `un stratège d'audience qui raisonne en habitudes de vie, pas en statistiques génériques`,
    variantShape: `un créneau précis (jour + heure + fuseau) avec la raison comportementale, et le rythme conseillé`,
    criteria: `1) le raisonnement porte sur la vie réelle de la cible (trajet, pause déjeuner, coucher des enfants) ; 2) cohérent avec la plateforme ; 3) évite les créneaux saturés sans raison ; 4) propose un test A/B simple ; 5) donne un rythme tenable, pas un rythme idéal irréaliste.`,
  },
  post: {
    studyFocus: `Le sujet, l'audience, la plateforme et son format natif, ce que l'audience gagne à lire ça, et l'angle qui évite le post générique "inspirant".`,
    writer: `un créateur de contenu qui écrit pour être partagé, pas pour être poli`,
    variantShape: `le post complet prêt à publier (première ligne accrocheuse, corps, fin qui appelle une réaction) + les hashtags si la plateforme s'y prête`,
    criteria: `1) la première ligne donne envie de cliquer "voir plus" ; 2) apporte une valeur concrète ou une émotion vraie ; 3) au format natif de la plateforme ; 4) zéro jargon corporate et zéro banalité ; 5) invite naturellement à réagir ; 6) sonne humain, pas généré.`,
  },
  outreach: {
    studyFocus: `La cible exacte, son problème du moment, ce qui rend le contact légitime MAINTENANT, et la raison pour laquelle elle supprimerait l'email.`,
    writer: `un commercial qui obtient des réponses parce qu'il écrit court et utile`,
    variantShape: `l'email complet : objet + corps, prêt à envoyer`,
    criteria: `1) l'objet ne ressemble pas à du spam et n'est pas racoleur ; 2) les 2 premières lignes parlent du destinataire, pas de l'expéditeur ; 3) une seule demande, minuscule et facile à accepter ; 4) moins de 120 mots ; 5) personnalisation réelle, pas un champ [PRÉNOM] ; 6) conforme : identifiable, honnête, désinscription possible si promotionnel.`,
  },
};

// ─── Utilitaires ────────────────────────────────────────────────────────────

function safeJson(text: string): any | null {
  try {
    const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/);
    const body = fence ? fence[1] : text;
    const obj = body.match(/\{[\s\S]*\}/);
    const arr = body.match(/\[[\s\S]*\]/);
    const pick = obj && arr ? (obj.index! < arr.index! ? obj[0] : arr[0]) : (obj?.[0] || arr?.[0]);
    return pick ? JSON.parse(pick) : null;
  } catch {
    return null;
  }
}

function guessLang(text: string): string {
  // Tokenisation tolerante a la ponctuation : "Bonjour," doit compter comme
  // le mot "bonjour" (le decoupage sur les espaces seuls ratait ce cas et
  // faisait repondre en anglais a un message francais).
  const words = new Set(
    text.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').split(' ').filter(Boolean),
  );
  const fr = ['le', 'la', 'les', 'je', 'vous', 'est', 'pour', 'pas', 'bonjour', 'merci',
    'avec', 'une', 'des', 'nous', 'mais', 'plus', 'tres', 'commande', 'client', 'votre',
    'notre', 'que', 'qui', 'ete', 'sur', 'dans', 'ce', 'cette', 'du', 'au', 'aux'];
  let hits = 0;
  for (const w of fr) if (words.has(w)) hits++;
  // Les caracteres accentues (a, e, e, c...) pesent aussi dans la balance.
  if (/[\u00c0-\u00ff]/.test(text)) hits += 1;
  return hits >= 2 ? 'fr' : 'en';
}

/** Nom lisible d'une langue detectee (code ISO court ou libelle du modele). */
function langLabel(code: string): string {
  const c = code.trim().toLowerCase();
  const map: Record<string, string> = {
    fr: 'francais', francais: 'francais', 'francais (france)': 'francais',
    en: 'anglais', anglais: 'anglais', english: 'anglais',
    es: 'espagnol', espagnol: 'espagnol', de: 'allemand', allemand: 'allemand',
    it: 'italien', italien: 'italien', pt: 'portugais', portugais: 'portugais',
    nl: 'neerlandais', ar: 'arabe', arabe: 'arabe',
  };
  return map[c] || (c.length > 2 ? c : 'francais');
}

async function call(sys: string, user: string, model: string, label: string, companyId?: string | null, temperature = 0.7) {
  const { text } = await runWithAiContext(
    { feature: 'comms-engine', label, companyId: companyId || undefined },
    () => generateText({ model: gateway(model), system: sys, prompt: user, temperature }),
  );
  return text;
}

// ─── Le moteur ──────────────────────────────────────────────────────────────

export async function runCommsTask(inp: RunInput): Promise<RunResult> {
  const t0 = Date.now();
  const steps: { step: string; ms: number }[] = [];
  const mode: RunMode = inp.mode === 'train' ? 'train' : 'direct';
  const spec = SPECS[inp.task];
  const model = inp.model || REASONING_MODEL;
  // Langue : heuristique d'abord, mais l'étude (qui lit vraiment le message)
  // aura le dernier mot juste après. Répondre dans la mauvaise langue est la
  // pire faute possible ici.
  let lang = guessLang(`${inp.input} ${inp.context || ''}`);
  let langName = langLabel(lang);

  // Les leçons déjà apprises — c'est ici que l'entraînement agit.
  const learning = await buildLearningBlock(inp.task, inp.companyId);

  // ── 1. ÉTUDE ──────────────────────────────────────────────────────────────
  const tStudy = Date.now();
  const studySys = `Tu es analyste en communication. On te donne une demande liée à : ${TASK_LABELS[inp.task]}.
Tu N'ÉCRIS PAS encore la réponse. Tu ANALYSES d'abord, froidement et honnêtement.

Cherche en priorité : ${spec.studyFocus}

Réponds UNIQUEMENT en JSON :
{"langue":"fr|en","intention":"...","emotion":"...","urgence":"faible|moyenne|haute","enjeu":"...","objection":"...","cible":"...","objectif":"...","risques":["..."]}
Sois concret et spécifique. Si une information manque, écris ce qu'il faudrait savoir plutôt que d'inventer.`;

  const studyUser = `DEMANDE / MESSAGE REÇU :
${inp.input}
${inp.context ? `\nCONTEXTE FOURNI (entreprise, produit, historique) :\n${inp.context}` : ''}`;

  let study: Study | null = null;
  try {
    const raw = await call(studySys, studyUser, model, 'study', inp.companyId, 0.3);
    study = safeJson(raw);
  } catch (e: any) {
    console.error('[comms/engine] étude échouée:', e?.message);
  }
  // L'étude a lu le message : sa détection de langue prime sur l'heuristique.
  const detected = String((study as any)?.langue || '').trim();
  if (detected) {
    langName = langLabel(detected);
    lang = detected.slice(0, 2).toLowerCase();
  }

  steps.push({ step: 'étude', ms: Date.now() - tStudy });

  let variants: Variant[] = [];
  let best: Variant | null = null;
  let selfScore: number | null = null;
  let verdict = '';

  if (mode === 'direct') {
    // ── PRODUCTION : UNE SEULE reponse, la bonne, du premier coup ──────────
    // Pas de brouillons, pas de sélection : tout ce que l'admin a appris a
    // l'IA est deja dans le prompt, donc elle ecrit directement la version
    // finale. C'est ce chemin qui tourne en vrai (monitor, pipeline).
    const tGen = Date.now();
    const genSys = `Tu es ${spec.writer}. Tu travailles en ${langName} et tu réponds en ${langName}.

${learning ? `${learning}\n\n` : ''}Tu écris DIRECTEMENT la version finale, la meilleure possible. Une seule.
Tu ne proposes pas d'options, tu ne commentes pas ton travail, tu ne dis pas "voici".

Ce que tu livres : ${spec.variantShape}.

Avant d'écrire, vérifie mentalement ces exigences — le résultat doit toutes les satisfaire :
${spec.criteria}

Réponds UNIQUEMENT par le livrable, rien d'autre.`;

    const genUser = `${studyUser}

${study ? `ANALYSE À EXPLOITER :\n${JSON.stringify(study, null, 1)}` : ''}

Écris la version finale.`;

    try {
      const raw = await call(genSys, genUser, model, 'direct', inp.companyId, 0.7);
      const content = raw.trim();
      if (content) {
        best = { angle: 'reponse', content };
        variants = [best];
      }
    } catch (e: any) {
      console.error('[comms/engine] génération directe échouée:', e?.message);
    }
    steps.push({ step: 'rédaction', ms: Date.now() - tGen });
  } else {
    // ── ENTRAÎNEMENT UNIQUEMENT : 3 pistes + un juge ───────────────────────
    // Ce chemin n'est JAMAIS utilisé pour répondre en vrai. Il sert à montrer
    // à l'admin plusieurs angles, à les faire noter, et à en tirer des règles
    // qui amélioreront ensuite la réponse directe de la production.
    const tGen = Date.now();
    const genSys = `Tu es ${spec.writer}. Tu travailles en ${langName} et tu réponds en ${langName}.

${learning ? `${learning}\n\n` : ''}Tu produis 3 PISTES avec des ANGLES VRAIMENT DIFFÉRENTS (si deux pistes se ressemblent, tu as échoué).
Chaque piste contient : ${spec.variantShape}.

Ce sur quoi tu seras jugé : ${spec.criteria}

Réponds UNIQUEMENT en JSON :
[{"angle":"nom court de l'angle","content":"le contenu complet prêt à l'emploi"}]
Le champ "content" ne contient AUCUN commentaire sur ton travail, seulement le livrable.`;

    const genUser = `${studyUser}

${study ? `ANALYSE À EXPLOITER :\n${JSON.stringify(study, null, 1)}` : ''}

Produis les 3 pistes.`;

    try {
      const raw = await call(genSys, genUser, model, 'variants', inp.companyId, 0.85);
      const arr = safeJson(raw);
      variants = (Array.isArray(arr) ? arr : [])
        .map((x: any) => ({ angle: String(x?.angle || '').trim() || 'sans angle', content: String(x?.content || '').trim() }))
        .filter(v => v.content.length > 0)
        .slice(0, 3);
      if (!variants.length && raw.trim()) variants = [{ angle: 'brut', content: raw.trim() }];
    } catch (e: any) {
      console.error('[comms/engine] génération échouée:', e?.message);
    }
    steps.push({ step: 'pistes', ms: Date.now() - tGen });

    const tJudge = Date.now();
    best = variants[0] || null;

    if (variants.length) {
      const judgeSys = `Tu es un juge exigeant en communication marketing. Tu notes SANS complaisance : une piste correcte mais banale mérite 6, pas 9.

Critères : ${spec.criteria}
${learning ? `\nLes règles apprises ci-dessous sont IMPÉRATIVES : une piste qui les viole perd au moins 3 points.\n${learning}` : ''}

Réponds UNIQUEMENT en JSON :
{"notes":[{"index":0,"score":1-10,"why":"une phrase"}],"best":0,"verdict":"pourquoi celle-là gagne, et ce qui manquerait pour un 10"}`;

      const judgeUser = `DEMANDE INITIALE :
${inp.input}

PISTES À JUGER :
${variants.map((v, i) => `[${i}] angle << ${v.angle} >>\n${v.content}`).join('\n\n')}

Note chaque piste et choisis la meilleure.`;

      try {
        const raw = await call(judgeSys, judgeUser, model, 'judge', inp.companyId, 0.2);
        const j = safeJson(raw);
        if (j) {
          for (const n of (Array.isArray(j.notes) ? j.notes : [])) {
            const i = Number(n?.index);
            if (Number.isInteger(i) && variants[i]) {
              variants[i].score = Number(n?.score) || undefined;
              variants[i].why = String(n?.why || '').trim() || undefined;
            }
          }
          const bi = Number(j.best);
          if (Number.isInteger(bi) && variants[bi]) best = variants[bi];
          verdict = String(j.verdict || '').trim();
          selfScore = best?.score ?? null;
        }
      } catch (e: any) {
        console.error('[comms/engine] jugement échoué:', e?.message);
      }
    }
    steps.push({ step: 'jugement', ms: Date.now() - tJudge });
  }

  const durationMs = Date.now() - t0;

  // Trace pour l'entraînement — la console pourra la noter.
  const exampleId = await recordExample({
    companyId: inp.companyId,
    task: inp.task,
    input: inp.input,
    context: inp.context,
    lang,
    study,
    output: best?.content || null,
    variants,
    selfScore,
    model,
    durationMs,
    createdBy: inp.createdBy,
  });

  return {
    exampleId,
    mode,
    task: inp.task,
    lang,
    study,
    variants,
    best,
    selfScore,
    verdict,
    learned: !!learning,
    durationMs,
    steps,
  };
}
