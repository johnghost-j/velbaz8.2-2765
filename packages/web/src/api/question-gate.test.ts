import { describe, expect, it } from 'bun:test';
import {
  answeredTopics,
  countQuestionRounds,
  EXHAUSTED_FALLBACK_EN,
  EXHAUSTED_FALLBACK_FR,
  gateQuestions,
  gateReply,
  MAX_QUESTION_ROUNDS,
  parseQuestionsBlock,
  topicOf,
  userWantsQuestions,
} from './question-gate';

const Q = (q: string) => ({ q });

const askedBlock = (qs: string[]) =>
  `[QUESTIONS]${JSON.stringify(qs.map(q => ({ q, kind: 'text' })))}[/QUESTIONS]`;

describe('topicOf', () => {
  it('rapproche deux formulations du même sujet', () => {
    expect(topicOf('Quel nom veux-tu donner à ton projet ?')).toBe(
      topicOf('Nom de la marque : tu gardes CoutureNova ou tu veux 2-3 autres noms ?'),
    );
    expect(topicOf('Qui est ton public cible principal ?')).toBe(
      topicOf('Cible : âge + style de vie'),
    );
    expect(topicOf('Quel style visuel te plaît le plus ?')).toBe(
      topicOf('Univers/design : plutôt minimal chic, streetwear ?'),
    );
  });

  it('distingue deux sujets différents', () => {
    expect(topicOf('Quel est ton modèle de prix ?')).not.toBe(topicOf('Dans quel pays ?'));
  });
});

describe('countQuestionRounds', () => {
  it('compte les tours posés, marqueur inclus', () => {
    const history = [
      { role: 'user', content: 'une marque de vêtements' },
      { role: 'assistant', content: askedBlock(['Quel nom ?']) },
      { role: 'user', content: 'Quel nom ?: CoutureNova' },
      { role: 'assistant', content: 'ok\n\n[QUESTIONS_ASKED]\n[QUESTIONS][{"q":"Quel pays ?"}][/QUESTIONS]' },
    ];
    expect(countQuestionRounds(history)).toBe(2);
  });
});

describe('answeredTopics', () => {
  it('marque un sujet comme réglé quand l’utilisateur a répondu', () => {
    const history = [
      { role: 'assistant', content: askedBlock(['Quel nom veux-tu ?', 'Quel est ton public cible ?']) },
      { role: 'user', content: 'Quel nom veux-tu ?: CoutureNova | Quel est ton public cible ?: femmes 25-35' },
    ];
    const settled = answeredTopics(history);
    expect(settled.has('name')).toBe(true);
    expect(settled.has('audience')).toBe(true);
    expect(settled.has('price')).toBe(false);
  });

  it('ne marque rien quand les questions sont restées sans réponse', () => {
    const history = [{ role: 'assistant', content: askedBlock(['Quel nom veux-tu ?']) }];
    expect(answeredTopics(history).size).toBe(0);
  });
});

describe('gateQuestions', () => {
  // Cas RÉEL signalé : l'utilisateur a répondu, l'IA repose les mêmes sujets.
  const answeredHistory = [
    { role: 'user', content: 'je veux une marque de vêtements' },
    {
      role: 'assistant',
      content: askedBlock([
        'Nom de la marque : tu gardes CoutureNova ?',
        'Cible : âge + style de vie',
        'Univers/design : minimal chic ou streetwear ?',
      ]),
    },
    {
      role: 'user',
      content:
        'Nom de la marque : tu gardes CoutureNova ?: CoutureNova | Cible : âge + style de vie: 18-30 streetwear | Univers/design : minimal chic ou streetwear ?: streetwear',
    },
  ];

  it('ne repose JAMAIS un sujet déjà répondu', () => {
    const d = gateQuestions(
      [Q('Quel nom veux-tu donner à ta marque ?'), Q('Qui est ton public cible ?')],
      answeredHistory,
      'ok',
    );
    expect(d.kept).toEqual([]);
    expect(d.exhausted).toBe(true);
    expect(d.dropped.every(x => x.reason === 'already-answered')).toBe(true);
  });

  it('laisse passer un sujet NOUVEAU après un tour répondu', () => {
    const d = gateQuestions(
      [Q('Quel nom veux-tu ?'), Q('Dans quel pays seras-tu actif ?')],
      answeredHistory,
      'ok',
    );
    expect(d.kept.map(k => k.q)).toEqual(['Dans quel pays seras-tu actif ?']);
    expect(d.exhausted).toBe(false);
  });

  it('coupe tout au-delà de la limite de tours', () => {
    const many = [
      { role: 'assistant', content: askedBlock(['Quel nom ?']) },
      { role: 'user', content: 'Quel nom ?: X' },
      { role: 'assistant', content: askedBlock(['Quel pays ?']) },
      { role: 'user', content: 'Quel pays ?: France' },
    ];
    expect(countQuestionRounds(many)).toBe(MAX_QUESTION_ROUNDS);
    const d = gateQuestions([Q('Quelles tailles proposes-tu ?')], many, 'ok');
    expect(d.kept).toEqual([]);
    expect(d.dropped[0].reason).toBe('max-rounds');
    expect(d.exhausted).toBe(true);
  });

  it('rend les questions quand l’UTILISATEUR les réclame, même après la limite', () => {
    const many = [
      { role: 'assistant', content: askedBlock(['Quel nom ?']) },
      { role: 'user', content: 'Quel nom ?: X' },
      { role: 'assistant', content: askedBlock(['Quel pays ?']) },
      { role: 'user', content: 'Quel pays ?: France' },
    ];
    const d = gateQuestions([Q('Quel nom veux-tu ?'), Q('Quelles tailles ?')], many, 'repose-moi les questions');
    expect(d.kept.length).toBe(2);
    expect(d.exhausted).toBe(false);
  });

  it('dédoublonne deux fois le même sujet dans un seul lot', () => {
    const d = gateQuestions([Q('Quel nom veux-tu ?'), Q('Quel est le nom de la marque ?')], [], 'idée');
    expect(d.kept.length).toBe(1);
  });

  it('laisse un premier questionnaire intact', () => {
    const qs = [Q('Dans quel pays ?'), Q('Quel nom ?'), Q('Quel style ?'), Q('Quelle cible ?')];
    const d = gateQuestions(qs, [{ role: 'user', content: 'une marque de vêtements' }], 'une marque');
    expect(d.kept.length).toBe(4);
    expect(d.changed).toBe(false);
  });
});

describe('userWantsQuestions', () => {
  it('reconnaît une demande explicite', () => {
    expect(userWantsQuestions('repose-moi les questions')).toBe(true);
    expect(userWantsQuestions('tu peux me redemander')).toBe(true);
    expect(userWantsQuestions('ask me the questions again')).toBe(true);
  });
  it('ne se déclenche pas sur un message normal', () => {
    expect(userWantsQuestions('vas-y lance le site')).toBe(false);
    expect(userWantsQuestions('CoutureNova, streetwear, 18-30')).toBe(false);
  });
});

describe('parseQuestionsBlock', () => {
  it('lit un bloc valide', () => {
    const qs = parseQuestionsBlock(`Salut\n\n${askedBlock(['Quel nom ?'])}`);
    expect(qs!.length).toBe(1);
  });
  it('renvoie null sans bloc', () => {
    expect(parseQuestionsBlock('aucune question ici')).toBeNull();
  });
});

describe('gateReply', () => {
  const answeredHistory = [
    { role: 'assistant', content: askedBlock(['Quel nom veux-tu ?', 'Quelle cible ?']) },
    { role: 'user', content: 'Quel nom veux-tu ?: CoutureNova | Quelle cible ?: 18-30' },
  ];

  it('retire le bloc entier quand tout est déjà répondu et garde le texte utile', () => {
    const intro =
      "Parfait, j'ai bien noté le nom et la cible, je pars donc sur un univers minimaliste et une boutique en trois pages.";
    const r = gateReply(`${intro}\n\n${askedBlock(['Quel nom veux-tu ?', 'Quelle cible ?'])}`, answeredHistory, 'ok');
    expect(r.decision!.exhausted).toBe(true);
    expect(r.reply).not.toContain('[QUESTIONS]');
    expect(r.reply).toBe(intro);
  });

  it('remplace une amorce orpheline par la phrase de repli', () => {
    // « Encore deux précisions : » annonçait le formulaire qu'on vient de
    // retirer : le laisser seul à l'écran serait un mensonge.
    const r = gateReply(
      `Encore deux précisions :\n\n${askedBlock(['Quel nom veux-tu ?', 'Quelle cible ?'])}`,
      answeredHistory,
      'ok',
    );
    expect(r.reply).not.toContain('[QUESTIONS]');
    expect(r.reply).not.toContain('précisions');
    expect(r.reply).toBe(EXHAUSTED_FALLBACK_FR);
  });

  it('accepte une phrase de repli personnalisée (langue du client)', () => {
    const r = gateReply(
      `Two quick things:\n\n${askedBlock(['Quel nom veux-tu ?', 'Quelle cible ?'])}`,
      answeredHistory,
      'ok',
      EXHAUSTED_FALLBACK_EN,
    );
    expect(r.reply).toBe(EXHAUSTED_FALLBACK_EN);
  });

  it('ne garde que les questions légitimes', () => {
    const r = gateReply(
      `Encore deux choses.\n\n${askedBlock(['Quel nom veux-tu ?', 'Dans quel pays ?'])}`,
      answeredHistory,
      'ok',
    );
    const kept = parseQuestionsBlock(r.reply)!;
    expect(kept.length).toBe(1);
    expect(kept[0].q).toBe('Dans quel pays ?');
  });

  it('ne touche pas une réponse sans questions', () => {
    const raw = 'Le site est en ligne.';
    const r = gateReply(raw, answeredHistory, 'ok');
    expect(r.reply).toBe(raw);
    expect(r.decision).toBeNull();
  });
});
