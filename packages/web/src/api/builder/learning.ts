// ─── Mémoire d'apprentissage globale du Builder ──────────────────────────────
// Chaque génération de page passe par une QA automatique (analyzePage) AVANT
// et APRÈS une éventuelle correction (fixPage). Ce module capture ce signal —
// uniquement automatique, aucune intervention humaine — pour que Velbaz
// s'améliore PROGRESSIVEMENT et pour TOUT LE MONDE: plus l'IA génère de sites,
// moins elle refait les mêmes erreurs fonctionnelles (handlers morts, liens
// cassés, données statiques, etc.), sur TOUTE la plateforme.
//
// Principe:
// 1) À chaque page, on observe les QAIssue détectés (avant) et le score après
//    correction (fixPage). Un pattern "corrigé avec succès" (score après >
//    score avant) renforce la leçon associée à son `issue.code`.
// 2) Les leçons sont GLOBALES (pas de companyId/userId) — un seul pool partagé.
// 3) Avant de générer une page, on relit les leçons les plus fiables et on les
//    injecte dans le prompt système sous forme de rappels courts et concrets,
//    pour prévenir l'erreur plutôt que la corriger après coup.
// 4) Élagage automatique: une leçon dont la fiabilité tombe trop bas (le
//    "correctif" ne marche plus / n'apporte rien) est supprimée toute seule —
//    pas de mauvais apprentissage qui s'accumule indéfiniment.

import { randomUUID } from "crypto";
import { eq, sql } from "drizzle-orm";
import { db } from "../database";
import { builderLessons } from "../database/schema";
import type { QAReport, QAIssue } from "./qa";

// Libellés génériques (aucune référence à un business précis) associés à
// chaque code d'issue — c'est ce texte, pas le détail spécifique d'une page,
// qui est mémorisé et réutilisé pour tout le monde.
const LESSON_TEXT: Record<string, string> = {
  DEAD_HANDLER: "Ne jamais laisser onClick={() => {}} ou un handler vide — chaque bouton doit déclencher une vraie action (navigation, data.*, api(), aiChat(), checkout(), ou set d'état utilisé).",
  CONSOLE_LOG: "Ne pas laisser de console.log/warn/debug dans le code final — c'est presque toujours le signe d'un comportement réel manquant à câbler.",
  DEAD_LINK: 'Ne jamais utiliser href="#" — toujours un <Link to="/…"> vers une route réelle du site ou une vraie action.',
  PLACEHOLDER: "Ne jamais laisser de TODO, FIXME, lorem ipsum ou placeholder de contenu — toujours du texte réaliste et spécifique au business dès la première génération.",
  ALERT: "Ne pas utiliser alert() — préférer un vrai retour UI (toast, message d'état, redirection).",
  CORE_NO_DATA: "Une page CŒUR (espace de travail principal) doit utiliser data.list/create/update/remove dès la génération — jamais de contenu statique pour une page dont le rôle est un vrai CRUD.",
  CORE_STATIC: "Une page CŒUR doit avoir useState/useEffect dès le départ — sans état ni effet, elle n'a aucune interactivité réelle.",
  STATIC_DATA: "Éviter les gros tableaux d'objets codés en dur sur les pages cœur — charger via data.* dès la génération initiale plutôt que de coder des données statiques puis les remplacer après coup.",
  PAY_NO_CHECKOUT: "Si une page est marquée payante, le bouton d'achat doit appeler checkout() dès la génération — jamais un bouton visuel sans logique.",
  FORM_MISSING: "Si un formulaire est attendu sur une page, générer directement de vrais <form>/<input>/<textarea>, pas juste la mise en page visuelle.",
  UNCONTROLLED_FORM: "Chaque champ de formulaire doit être contrôlé (value + onChange sur un useState) dès la première génération.",
  INERT_BUTTONS: "Quand une page a plusieurs boutons, vérifier dès la génération que chacun déclenche une action réelle (data/api/ai/checkout/navigation/état) — ne pas générer de boutons juste décoratifs.",
  DUPLICATE_TEXT: "Ne jamais afficher deux fois le même texte long à l'écran — garder UNE occurrence visible (et remettre className=\"sr-only\" sur les copies d'accessibilité).",
  ANIM_NO_WAIT: 'Toujours mettre mode="wait" sur <AnimatePresence> pour du texte rotatif — sinon ancien et nouveau contenu s\'affichent en même temps.',
  THEME_MISMATCH: "Une seule palette pour toute l'app: jamais de fond de page sombre codé en dur (bg-[#0b0f19], bg-gray-900) quand le Layout/Header est clair — le sombre passe uniquement par la variante dark:.",
  SCROLL_RESET: "Jamais de scrollIntoView() (fait défiler toute la page) ni de setInterval qui appelle un setState (re-render en boucle) — scroller un panneau via ref.current.scrollTop, animer via CSS (animate-pulse).",
  OVERLOADED_HOME: "La page d'accueil a UN objectif (héro + valeur + CTA, ≤5 sections) — les stats, listes CRUD et pricing détaillé vivent sur leurs propres pages, la home y renvoie par des liens.",
  BROKEN_LAYOUT: "Ne jamais rendre un <nav> sticky ou un gros <footer> global dans une page — le Layout partagé fournit déjà Header et Footer (sinon double barre à l'écran).",
};

const MAX_INJECTED_LESSONS = 8;
const MIN_RELIABILITY = 0.35; // en dessous de ce seuil, la leçon est élaguée
const MIN_OCCURRENCES_TO_PRUNE = 5; // on laisse le temps à une leçon de faire ses preuves

/**
 * Enregistre le résultat d'une passe QA (avant génération/correction) pour
 * CHAQUE issue détectée. Purement automatique — appelé après analyzePage(),
 * jamais depuis une correction manuelle de l'utilisateur.
 *
 * @param before Rapport QA avant correction (ou rapport final si aucune correction n'a été tentée).
 * @param after  Rapport QA après fixPage(), si une correction a été tentée (sinon undefined).
 */
export async function recordQAOutcome(before: QAReport, after?: QAReport): Promise<void> {
  if (!before.issues.length) return; // rien à apprendre sur une page déjà propre
  const scoreAfter = after?.score ?? before.score;

  for (const issue of before.issues) {
    await upsertLesson(issue, before.score, scoreAfter);
  }
}

async function upsertLesson(issue: QAIssue, scoreBefore: number, scoreAfter: number): Promise<void> {
  const lessonText = LESSON_TEXT[issue.code];
  if (!lessonText) return; // code inconnu (nouvelle règle non encore documentée) → ignoré, pas de leçon vague

  const improved = scoreAfter > scoreBefore;
  try {
    const existing = await db.query.builderLessons.findFirst({
      where: (t, { eq }) => eq(t.issueCode, issue.code),
    });

    if (!existing) {
      await db.insert(builderLessons).values({
        id: randomUUID(),
        issueCode: issue.code,
        lesson: lessonText,
        occurrences: 1,
        avgScoreBefore: scoreBefore,
        avgScoreAfter: scoreAfter,
        reliability: improved ? 1 : 0,
      });
      return;
    }

    // Moyenne mobile pondérée par l'historique (borne à 200 échantillons pour
    // que le signal récent garde du poids sans jamais repartir de zéro).
    const n = Math.min(existing.occurrences, 200);
    const nextN = n + 1;
    const avgBefore = (existing.avgScoreBefore * n + scoreBefore) / nextN;
    const avgAfter = (existing.avgScoreAfter * n + scoreAfter) / nextN;
    const reliability = (existing.reliability * n + (improved ? 1 : 0)) / nextN;

    await db.update(builderLessons)
      .set({
        occurrences: existing.occurrences + 1,
        avgScoreBefore: avgBefore,
        avgScoreAfter: avgAfter,
        reliability,
        lesson: lessonText, // toujours la version générique à jour (pas de dérive de texte)
        lastSeenAt: sql`(unixepoch())`,
      })
      .where(eq(builderLessons.id, existing.id));

    // Élagage: si une leçon a fait ses preuves (assez d'occurrences) mais que
    // sa fiabilité est tombée trop bas, elle ne sert plus à rien — on la
    // retire pour ne pas polluer le prompt avec du bruit.
    if (existing.occurrences + 1 >= MIN_OCCURRENCES_TO_PRUNE && reliability < MIN_RELIABILITY) {
      await db.delete(builderLessons).where(eq(builderLessons.id, existing.id));
    }
  } catch (e) {
    // L'apprentissage ne doit JAMAIS casser un build — on avale l'erreur.
    console.warn("[learning] recordQAOutcome failed:", (e as any)?.message || e);
  }
}

/**
 * Relit les leçons globales les plus fiables et fréquentes, et retourne un
 * bloc de texte prêt à être injecté dans le prompt système AVANT génération
 * (voir CODE_SYSTEM). Vide si aucune leçon exploitable n'existe encore.
 */
export async function getLearnedPromptBlock(): Promise<string> {
  try {
    const rows = await db.query.builderLessons.findMany({
      where: (t, { gte, and }) => and(gte(t.reliability, MIN_RELIABILITY), gte(t.occurrences, 1)),
    });
    if (!rows.length) return "";

    // Priorité: fiabilité, puis fréquence (plus vu = plus solide), puis gain de score.
    const ranked = rows
      .map((r) => ({ ...r, gain: r.avgScoreAfter - r.avgScoreBefore }))
      .sort((a, b) => (b.reliability - a.reliability) || (b.occurrences - a.occurrences) || (b.gain - a.gain))
      .slice(0, MAX_INJECTED_LESSONS);

    const lines = ranked.map((r) => `- ${r.lesson}`).join("\n");
    return `\n\nLEÇONS APPRISES (issues automatiquement de l'analyse QA de générations précédentes sur toute la plateforme — respecte-les dès cette génération pour ne pas refaire les mêmes erreurs):\n${lines}`;
  } catch (e) {
    console.warn("[learning] getLearnedPromptBlock failed:", (e as any)?.message || e);
    return "";
  }
}
