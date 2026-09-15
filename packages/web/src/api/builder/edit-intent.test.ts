import { describe, expect, it } from 'bun:test';
import { isContinuationRequest, isBugReportRequest, claimsWorkWithoutDoing } from './edit-intent';

describe('isContinuationRequest', () => {
  it('reconnaît le message exact du bug rapporté', () => {
    expect(isContinuationRequest("continue l'ancien truc que tu t'étais arrêté sur le bug d'avant")).toBe(true);
  });

  it('reconnaît les ordres de continuation courants', () => {
    for (const m of [
      'continue',
      'continue stp',
      'reprends où tu t\'es arrêté',
      'reprend le travail',
      'poursuis la modification',
      'termine ce que tu avais commencé',
      'finis le truc',
      'tu t\'es arrêté au milieu, vas-y',
      'la tâche est pas finie',
      'keep going',
      'finish what you started',
      'resume where you stopped',
    ]) {
      expect(isContinuationRequest(m)).toBe(true);
    }
  });

  it('ne déclenche pas sur une simple question à propos de l\'arrêt', () => {
    for (const m of [
      'pourquoi tu t\'es arrêté ?',
      'explique-moi pourquoi ça s\'est arrêté',
      'why did you stop?',
    ]) {
      expect(isContinuationRequest(m)).toBe(false);
    }
  });

  it('ne déclenche pas sur du bavardage', () => {
    for (const m of ['salut', 'merci beaucoup', 'c\'est quoi ce bouton ?', '']) {
      expect(isContinuationRequest(m)).toBe(false);
    }
  });
});

describe('isBugReportRequest', () => {
  it('reconnaît un vrai rapport de bug', () => {
    for (const m of [
      'les images ne s\'affichent pas sur la page de personnalisation',
      'le bouton ne marche plus',
      'ça plante quand je clique',
      'y a un bug sur le configurateur',
      'rien ne se passe quand je valide',
      'page blanche sur la page produit',
      'the checkout button doesn\'t work',
      'nothing happens when I click',
    ]) {
      expect(isBugReportRequest(m)).toBe(true);
    }
  });

  it('laisse au chat les demandes d\'explication / analyse', () => {
    for (const m of [
      'explique-moi pourquoi les images ne s\'affichent pas',
      'analyse le bug et dis-moi ce que tu vois',
      'pourquoi ça ne marche pas ?',
    ]) {
      expect(isBugReportRequest(m)).toBe(false);
    }
  });

  it('ne déclenche pas sur un message neutre', () => {
    for (const m of ['salut', 'le site est beau', 'ajoute une page contact', '']) {
      expect(isBugReportRequest(m)).toBe(false);
    }
  });
});

describe('claimsWorkWithoutDoing', () => {
  it('détecte la fausse promesse exacte du bug rapporté', () => {
    expect(claimsWorkWithoutDoing(
      "Je continue et je mets en place le système pour que la page de personnalisation affiche automatiquement les images du vélo que tu as choisi. ✅ Je l'applique sur le configurateur.",
    )).toBe(true);
    expect(claimsWorkWithoutDoing(
      "Je continue l’ancien truc : je reprends là où ça a bloqué et je fais le nécessaire pour que tout s’applique correctement.",
    )).toBe(true);
  });

  it('détecte les autres formulations de promesse', () => {
    for (const r of [
      'Je vais ajouter la section tarifs tout de suite.',
      "J'applique la correction sur la page d'accueil.",
      'Je corrige ça maintenant.',
      'Je m\'en occupe.',
      "I'll apply the fix now.",
      "I'm updating the page.",
    ]) {
      expect(claimsWorkWithoutDoing(r)).toBe(true);
    }
  });

  it('ne déclenche pas quand la réponse PROPOSE ou QUESTIONNE', () => {
    for (const r of [
      'Je peux ajouter une section tarifs si tu veux — tu préfères 3 ou 4 offres ?',
      'Tu veux que je le fasse maintenant ?',
      'Voici trois idées : un bandeau, une FAQ, un formulaire. Dis-moi laquelle tu veux.',
      'Want me to apply it?',
    ]) {
      expect(claimsWorkWithoutDoing(r)).toBe(false);
    }
  });

  it('ne déclenche pas sur une réponse purement descriptive', () => {
    for (const r of [
      'Ta page produit utilise un carrousel React avec trois images.',
      'Le bug vient du chemin des images, qui pointe vers un dossier absent.',
      '',
    ]) {
      expect(claimsWorkWithoutDoing(r)).toBe(false);
    }
  });
});
