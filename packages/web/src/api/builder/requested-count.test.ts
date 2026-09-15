import { describe, expect, it } from 'bun:test';
import { countConstraint, parseRequestedCount, UNSPECIFIED_PLURAL_CAP, countListItems, addedItems, overshootFeedback, targetTotalHint } from './requested-count';

describe('parseRequestedCount — cas signalé par l’utilisateur', () => {
  it('« ajoute mon premier produit » = EXACTEMENT 1', () => {
    const r = parseRequestedCount('ajoute mon premier produit');
    expect(r.count).toBe(1);
    expect(r.plural).toBe(false);
  });

  it('« ajoute mon premier produit vélo » = 1, unité reconnue', () => {
    const r = parseRequestedCount('ajoute mon premier produit vélo');
    expect(r.count).toBe(1);
    expect(r.unit).toBe('produit');
  });

  it('« rajoute un produit » = 1', () => {
    expect(parseRequestedCount('rajoute un produit').count).toBe(1);
  });

  it('« ajoute un seul produit » = 1', () => {
    const r = parseRequestedCount('ajoute un seul produit');
    expect(r.count).toBe(1);
    expect(r.unit).toBe('produit');
  });

  it('« ajoute juste une page contact » = 1', () => {
    const r = parseRequestedCount('ajoute juste une page contact');
    expect(r.count).toBe(1);
  });
});

describe('parseRequestedCount — nombres explicites', () => {
  it('chiffre : « ajoute 3 produits »', () => {
    const r = parseRequestedCount('ajoute 3 produits');
    expect(r.count).toBe(3);
    expect(r.unit).toBe('produits');
    expect(r.plural).toBe(true);
  });

  it('lettres : « ajoute trois produits »', () => {
    expect(parseRequestedCount('ajoute trois produits').count).toBe(3);
  });

  it('chiffre élevé : « crée 12 pages »', () => {
    expect(parseRequestedCount('crée 12 pages').count).toBe(12);
  });

  it('anglais : « add 2 products »', () => {
    expect(parseRequestedCount('add 2 products').count).toBe(2);
  });

  it('ne lit que le nombre de la DEMANDE, pas un nombre de contexte', () => {
    const r = parseRequestedCount("j'ai 12 idées en tête, ajoute un produit vélo");
    expect(r.count).toBe(1);
    expect(r.unit).toBe('produit');
  });
});

describe('parseRequestedCount — pluriel sans nombre', () => {
  it('« ajoute des produits » → pluriel, aucun nombre', () => {
    const r = parseRequestedCount('ajoute des produits');
    expect(r.count).toBeNull();
    expect(r.plural).toBe(true);
  });

  it('« ajoute quelques produits » → pluriel, aucun nombre', () => {
    const r = parseRequestedCount('ajoute quelques produits');
    expect(r.count).toBeNull();
    expect(r.plural).toBe(true);
  });

  it('nom nu au pluriel : « ajoute produits » → pluriel', () => {
    expect(parseRequestedCount('ajoute produits').plural).toBe(true);
  });
});

describe('parseRequestedCount — reste muet quand la quantité ne veut rien dire', () => {
  it('demande de style : « change la couleur en un bleu plus clair »', () => {
    const r = parseRequestedCount('change la couleur en un bleu plus clair');
    expect(r.count).toBeNull();
    expect(r.plural).toBe(false);
  });

  it('aucun verbe d’ajout : « pourquoi le site est lent ? »', () => {
    expect(parseRequestedCount('pourquoi le site est lent ?').count).toBeNull();
  });

  it('message vide', () => {
    expect(parseRequestedCount('').count).toBeNull();
  });

  it('mot non comptable après le verbe : « mets un peu de marge »', () => {
    const r = parseRequestedCount('mets un peu de marge');
    expect(r.count).toBeNull();
  });

  it('faux pluriel : « ajoute un bus » reste singulier', () => {
    const r = parseRequestedCount('ajoute un bus');
    expect(r.count).toBe(1);
    expect(r.plural).toBe(false);
  });

  it('saute l’adjectif pour trouver le nom : « ajoute un nouveau produit »', () => {
    const r = parseRequestedCount('ajoute un nouveau produit');
    expect(r.count).toBe(1);
    expect(r.unit).toBe('produit');
  });
});

describe('countConstraint', () => {
  it('exige la quantité exacte et interdit les extras', () => {
    const c = countConstraint('ajoute mon premier produit vélo')!;
    expect(c).toContain('EXACTEMENT 1');
    expect(c).toContain('produit');
    expect(c).toMatch(/ÉCHEC/);
    // Le cœur du bug : l'IA « remplissait » la grille de son propre chef.
    expect(c).toContain('pour faire plus joli');
  });

  it('plafonne un pluriel sans nombre et impose de le dire', () => {
    const c = countConstraint('ajoute des produits')!;
    expect(c).toContain(String(UNSPECIFIED_PLURAL_CAP));
    expect(c).toContain('MAXIMUM');
  });

  it('reprend le nombre demandé tel quel', () => {
    expect(countConstraint('ajoute 4 produits')!).toContain('EXACTEMENT 4');
  });

  it('version anglaise', () => {
    const c = countConstraint('add 2 products', 'en')!;
    expect(c).toContain('EXACTLY 2');
    expect(c).toContain('FAILURE');
  });

  it('null quand la demande ne porte aucune quantité', () => {
    expect(countConstraint('change la couleur du titre en rouge')).toBeNull();
    expect(countConstraint('pourquoi le site est lent ?')).toBeNull();
  });
});

describe("countListItems / addedItems — garde-fou mécanique", () => {
  const before = `const SEED = [
  { id: "a", name: "Un" },
];`;
  const afterOne = `const SEED = [
  { id: "a", name: "Un" },
  { id: "b", name: "Deux" },
];`;
  const afterThree = `const SEED = [
  { id: "a", name: "Un" },
  { id: "b", name: "Deux" },
  { id: "c", name: "Trois" },
  { id: "d", name: "Quatre" },
];`;

  it("compte les éléments d'une liste de données", () => {
    expect(countListItems(before)).toBe(1);
    expect(countListItems(afterThree)).toBe(4);
    expect(countListItems("")).toBe(0);
  });

  it("mesure le nombre réel d'éléments ajoutés", () => {
    expect(addedItems(before, afterOne)).toBe(1);
    expect(addedItems(before, afterThree)).toBe(3);
    expect(addedItems(before, before)).toBe(0);
  });

  it("détecte le dépassement exact du bug signalé (1 demandé, 3 ajoutés)", () => {
    const over = addedItems(before, afterThree);
    expect(over).toBeGreaterThan(1);
    const fb = overshootFeedback(over, 1, countListItems(before), "fr");
    expect(fb).toContain("3");
    expect(fb).toContain("EXACTEMENT 1");
    expect(fb).toContain("EXACTEMENT 2"); // total cible = 1 existant + 1 demandé
  });

  it("donne le compte cible avant la première tentative", () => {
    const hint = targetTotalHint(1, 1, "fr");
    expect(hint).toContain("EXACTEMENT 2");
    const hintEn = targetTotalHint(4, 2, "en");
    expect(hintEn).toContain("EXACTLY 6");
  });
});
