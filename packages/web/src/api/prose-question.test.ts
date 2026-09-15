import { describe, expect, it } from 'bun:test';
import { promoteProseQuestion, promoteProseQuestionList } from './prose-question';

describe('promoteProseQuestion', () => {
  it('promeut le cas réel signalé (t-shirts/hoodies ou robes/ensembles)', () => {
    const reply =
      "Là maintenant, je lance la mise en ligne complète de CoutureNova + la boutique, puis je déploie le plan de visibilité (contenu + publicités + newsletter) sur les 14 prochains jours. Ensuite, on optimise tout avec les premiers retours (ajustement du message, produits les plus demandés, pages qui convertissent le mieux).\nDis-moi juste : tu veux plutôt démarrer avec t-shirts/hoodies ou robes/ensembles comme premiers produits ?";
    const r = promoteProseQuestion(reply);
    expect(r.promoted).not.toBeNull();
    expect(r.promoted!.kind).toBe('single');
    expect(r.promoted!.options!.map(o => o.label)).toEqual([
      'T-shirts/hoodies',
      'Robes/ensembles',
    ]);
    expect(r.promoted!.allowCustom).toBe(true);
    // La question quitte le texte affiché et part dans le bloc.
    expect(r.reply).toContain('[QUESTIONS]');
    expect(r.reply).toContain('[/QUESTIONS]');
    expect(r.reply).not.toContain('Dis-moi juste');
    expect(r.reply).toContain('plan de visibilité');
  });

  it('tombe en question texte quand il n’y a pas d’alternative', () => {
    const r = promoteProseQuestion('Le site est prêt. Quel nom veux-tu pour la boutique ?');
    expect(r.promoted).not.toBeNull();
    expect(r.promoted!.kind).toBe('text');
    expect(r.promoted!.q).toBe('Quel nom veux-tu pour la boutique ?');
    expect(r.reply.startsWith('Le site est prêt.')).toBe(true);
  });

  it('gère trois alternatives séparées par des virgules', () => {
    const r = promoteProseQuestion('Tu préfères commencer par Instagram, TikTok ou LinkedIn ?');
    expect(r.promoted!.options!.map(o => o.label)).toEqual(['Instagram', 'TikTok', 'LinkedIn']);
  });

  it('ne touche pas une réponse contenant déjà un bloc [QUESTIONS]', () => {
    const reply = 'Ok.\n\n[QUESTIONS][{"q":"Nom ?","kind":"text"}][/QUESTIONS]';
    const r = promoteProseQuestion(reply);
    expect(r.promoted).toBeNull();
    expect(r.reply).toBe(reply);
  });

  it('ne touche pas une réponse contenant un [POPUP]', () => {
    const reply = 'Je te montre.\n[POPUP]{"type":"info","title":"a","message":"b"}[/POPUP] On y va ?';
    const r = promoteProseQuestion(reply);
    expect(r.promoted).toBeNull();
  });

  it('ignore les questions rhétoriques', () => {
    for (const s of ['Le site est en ligne. Ça marche ?', "C'est fait. Autre chose ?"]) {
      expect(promoteProseQuestion(s).promoted).toBeNull();
    }
  });

  it('ignore une question suivie de texte réel (pas une question finale)', () => {
    const r = promoteProseQuestion(
      'Tu veux du rouge ou du bleu ? Je partirais sur du rouge, plus proche de ta marque.',
    );
    expect(r.promoted).toBeNull();
  });

  it('ne promeut rien sans question', () => {
    const r = promoteProseQuestion('Le site est en ligne, la boutique est active.');
    expect(r.promoted).toBeNull();
    expect(r.reply).toBe('Le site est en ligne, la boutique est active.');
  });

  it('refuse des alternatives trop longues (ce sont des phrases)', () => {
    const r = promoteProseQuestion(
      'On fait quoi : je refonds entièrement la page d’accueil avec un nouveau système de design ou je garde la structure actuelle en changeant seulement les couleurs et les typographies ?',
    );
    expect(r.promoted!.kind).toBe('text');
  });

  it('ne touche pas une réponse contenant un bloc de vue (JSON brut)', () => {
    const raw =
      'Voilà le comparatif.\n\n[TABLE_VIEW]{"cols":["Produit","Prix"],"rows":[["T-shirt","29"],["Hoodie","59"]]}[/TABLE_VIEW]\n\nTu préfères le noir ou le blanc ?';
    const r = promoteProseQuestion(raw);
    expect(r.promoted).toBeNull();
    expect(r.reply).toBe(raw);
  });

  it('ne touche pas une réponse contenant un graphique ou une prédiction', () => {
    for (const tag of ['COIN_CHART_VIEW', 'PREDICTION_VIEW', 'CALENDAR_VIEW']) {
      const raw = `Regarde.\n\n[${tag}]{"a":1}[/${tag}]\n\nOn part sur A ou B ?`;
      const r = promoteProseQuestion(raw);
      expect(r.promoted).toBeNull();
    }
  });

  it('produit un JSON de bloc relisible', () => {
    const r = promoteProseQuestion('Prêt. Tu veux du noir ou du blanc ?');
    const m = r.reply.match(/\[QUESTIONS\]([\s\S]*?)\[\/QUESTIONS\]/);
    expect(m).not.toBeNull();
    const parsed = JSON.parse(m![1]);
    expect(Array.isArray(parsed)).toBe(true);
    expect(parsed[0].q).toContain('noir');
  });
});

describe('promoteProseQuestionList', () => {
  // Cas RÉEL signalé le 13/09/2026 : l'IA repose ses questions en liste
  // numérotée ; le formulaire affichait alors un questionnaire générique.
  const realList = `On repart proprement. Voilà ce qu'il me manque :

1) Nom de la marque : tu gardes CoutureNova ou tu veux 2-3 autres noms ?
2) Cible : âge + style de vie (ex : 18–30 streetwear, femmes 25–35 élégant, etc.)
3) Univers/design : plutôt minimal chic, streetwear, romantique, vintage, ou autre ? (couleurs/ambiances)
4) Produits au lancement : t-shirts/hoodies ou robes/ensembles (et lesquels exactement)
5) Tailles & coupes : plutôt ajusté, oversize, les deux ? (XS à XXL ?)

Réponds en quelques mots par ligne.`;

  it('promeut les VRAIES questions de la liste (pas un questionnaire générique)', () => {
    const r = promoteProseQuestionList(realList);
    expect(r.promoted.length).toBe(5);
    expect(r.promoted[0].q).toContain('Nom de la marque');
    expect(r.promoted[1].q).toContain('Cible');
    expect(r.promoted[2].q).toContain('Univers/design');
    expect(r.promoted[3].q).toContain('Produits au lancement');
    expect(r.promoted[4].q).toContain('Tailles');
  });

  it('garde le nom existant comme option cliquable', () => {
    const r = promoteProseQuestionList(realList);
    expect(r.promoted[0].kind).toBe('single');
    expect(r.promoted[0].options!.map(o => o.label)).toEqual(['CoutureNova', '2-3 autres noms']);
    expect(r.promoted[0].allowCustom).toBe(true);
  });

  it('transforme un exemple entre parenthèses en placeholder', () => {
    const r = promoteProseQuestionList(realList);
    expect(r.promoted[1].kind).toBe('text');
    expect(r.promoted[1].placeholder).toContain('18–30 streetwear');
    expect(r.promoted[1].q).not.toContain('(');
  });

  it('nettoie « plutôt » et jette le choix bouche-trou « ou autre »', () => {
    const r = promoteProseQuestionList(realList);
    expect(r.promoted[2].options!.map(o => o.label)).toEqual([
      'Minimal chic',
      'Streetwear',
      'Romantique',
      'Vintage',
    ]);
    expect(r.promoted[4].options!.map(o => o.label)).toEqual(['Ajusté', 'Oversize', 'Les deux']);
  });

  it('retire la liste et la consigne « Réponds… » du texte affiché', () => {
    const r = promoteProseQuestionList(realList);
    expect(r.reply).toContain('Voilà ce qu\'il me manque');
    expect(r.reply).not.toContain('1)');
    expect(r.reply).not.toContain('Réponds en quelques mots');
    const m = r.reply.match(/\[QUESTIONS\]([\s\S]*?)\[\/QUESTIONS\]/);
    expect(JSON.parse(m![1]).length).toBe(5);
  });

  it('ne touche pas une liste de livrables (ce ne sont pas des questions)', () => {
    const r = promoteProseQuestionList(
      "C'est en ligne.\n\n1) J'ai publié la boutique\n2) J'ai branché le paiement\n3) J'ai lancé la campagne\n\nTu veux voir le résultat ?",
    );
    expect(r.promoted).toEqual([]);
  });

  it('ne touche pas une liste sans aucune question', () => {
    const r = promoteProseQuestionList(
      'Plan :\n1) Boutique\n2) Paiement\n3) Publicité\n\nOn avance comme ça ?',
    );
    expect(r.promoted).toEqual([]);
  });

  it('ne touche pas une réponse contenant déjà un bloc protocolaire', () => {
    const raw = `${realList}\n\n[QUESTIONS][{"q":"Déjà là ?"}][/QUESTIONS]`;
    const r = promoteProseQuestionList(raw);
    expect(r.promoted).toEqual([]);
    expect(r.reply).toBe(raw);
  });

  it('gère les puces et les listes numérotées « 1. »', () => {
    const r = promoteProseQuestionList(
      'Il me manque deux infos :\n- Quel pays ?\n- Quel budget mensuel ?',
    );
    expect(r.promoted.length).toBe(2);
    expect(r.promoted[0].q).toBe('Quel pays ?');
    const r2 = promoteProseQuestionList(
      'Deux choses :\n1. Quel nom veux-tu ?\n2. Quelle cible viser ?',
    );
    expect(r2.promoted.length).toBe(2);
  });

  it('produit un JSON relisible par le pipeline', () => {
    const r = promoteProseQuestionList(realList);
    const m = r.reply.match(/\[QUESTIONS\]([\s\S]*?)\[\/QUESTIONS\]/);
    const parsed = JSON.parse(m![1]);
    expect(parsed.every((q: any) => typeof q.q === 'string' && q.q.length > 2)).toBe(true);
  });

  it('ne propose JAMAIS « juste un test » comme option', () => {
    const r = promoteProseQuestionList(realList);
    const labels = r.promoted.flatMap(q => (q.options || []).map(o => o.label.toLowerCase()));
    expect(labels.some(l => /test/.test(l))).toBe(false);
  });
});
