/**
 * Easter eggs — [2026-09-15].
 *
 * Règle commune aux trois œufs de ce lot (nom de projet, 404, secousse) :
 * aucun ne change le comportement réel de l'app. On peut tous les retirer en
 * supprimant leur appel, sans rien casser d'autre.
 *
 * Ici : le nom du projet. Quelqu'un qui appelle son projet « Skynet »,
 * « HAL 9000 » ou « Jarvis » sait exactement ce qu'il fait — on lui répond.
 * Le clin d'œil s'affiche comme le premier message de la conversation, puis
 * l'IA enchaîne normalement : rien n'est bloqué, rien n'est envoyé au serveur,
 * et le message n'est pas enregistré dans l'historique.
 */

/** Réduit un nom à sa forme comparable : minuscules, sans accents ni ponctuation. */
function normalize(name: string): string {
  return name
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '') // accents combinants
    .replace(/[^a-z0-9]/g, '');
}

interface NameEgg {
  /** Formes normalisées qui déclenchent l'œuf. */
  keys: string[];
  /** Clé i18n du message : le texte vit dans lib/i18n.tsx, comme tout le reste
   *  de l'interface. Un œuf codé en dur en français dans un module anglais
   *  était exactement l'incohérence qu'on venait de corriger ailleurs. */
  messageKey: string;
}

const NAME_EGGS: NameEgg[] = [
  { keys: ['skynet'], messageKey: 'egg.name.skynet' },
  { keys: ['hal9000', 'hal'], messageKey: 'egg.name.hal' },
  { keys: ['jarvis'], messageKey: 'egg.name.jarvis' },
];

/**
 * Renvoie la CLÉ i18n du clin d'œil correspondant au nom du projet, ou `null`.
 *
 * Comparaison sur le nom ENTIER, pas en « contient » : sinon un projet appelé
 * « Halal Food » déclencherait l'œuf HAL, ce qui serait juste incompréhensible
 * pour son auteur.
 */
export function projectNameEgg(name: string | null | undefined): string | null {
  if (!name) return null;
  const n = normalize(name);
  if (!n) return null;
  for (const egg of NAME_EGGS) {
    if (egg.keys.includes(n)) return egg.messageKey;
  }
  return null;
}
