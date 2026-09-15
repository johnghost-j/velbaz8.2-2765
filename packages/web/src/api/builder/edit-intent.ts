// ─── Intention d'ÉDITION : continuation, rapport de bug, fausses promesses ───
// [2026-09-14] Bug rapporté (plusieurs fois) : « des fois l'IA dit "je vais
// faire" ou "je continue" mais c'est que du texte et l'IA ne travaille pas ».
//
// Cause réelle (reproduite en direct) : le message « continue l'ancien truc que
// tu t'étais arrêté sur le bug d'avant » n'était pas reconnu comme une demande
// de MODIFICATION (aucun verbe de la liste EDIT : "continue" n'en fait pas
// partie), donc il partait dans le chat/orchestrateur. Deux symptômes, une
// seule cause :
//   1. L'avancement s'affichait en liste plate (« Velbaz is working… »,
//      « Compréhension de la demande », « Rédaction de la réponse ») au lieu des
//      groupes de tâches (« ✓ Task complete · 42 steps ») que produit le vrai
//      flux d'édition (événements buildStep).
//   2. La réponse n'était QUE du texte (« Je continue et je mets en place… »)
//      sans aucune modification réelle des fichiers.
//
// Ce module contient les détecteurs PURS (testables) utilisés par
// isAppEditRequest() (routage) et par le backstop anti-fausse-promesse du chat.

/** Enlève les accents pour que « arrêté » matche aussi « arrete ». */
function fold(s: string): string {
  return (s || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[’`´]/g, "'")
    .trim();
}

// Le message demande juste une EXPLICATION sur un arrêt / un bug ("pourquoi tu
// t'es arrêté ?", "explique-moi le bug") → la réponse est des mots, pas du code.
const EXPLAIN_ONLY = /^(pourquoi|explique|expliques|dis[- ]moi pourquoi|comment ca se fait|c'est quoi le (probleme|souci|bug)|why|explain)\b/;

// Verbes de CONTINUATION (impératif / 1re personne) : « continue », « reprends »,
// « poursuis », « termine », « finis », « achève », « resume », « finish »…
const CONTINUE_VERB = /\b(continu(e|es|ez|er|ons)|recontinue|repren(ds?|dre|ez|ons)|poursui(s|t|vre|vez|vons)|termin(e|es|ez|er|ons)|fini(s|r|ssez|ssons)|achev(e|es|er|ez)|complet(e|es|er)|resume|finish|continue|keep going|carry on|go on|pick (it |this )?up)\b/;

// Contexte de travail INTERROMPU : « tu t'es arrêté », « ça s'est arrêté »,
// « l'ancien truc », « là où tu en étais », « pas fini », « le reste »…
const INTERRUPTED_CTX = /(t'?es arrete|t'?etais arrete|s'?est arrete|sest arrete|tu as arrete|arrete au milieu|l'?ancien truc|l'?ancienne (tache|demande|modif)|ce que tu (faisais|avais commence)|la ou tu (en )?(etais|t'?es arrete)|ou tu t'?es arrete|(pas|non) (fini|termine|finie|terminee)|reste a faire|le reste (de|du)|tache interrompue|travail interrompu|modif(ication)? interrompue|interrupted|unfinished|where you (left off|stopped)|you stopped)/;

/**
 * « continue ce que tu faisais », « reprends là où tu t'es arrêté »,
 * « continue l'ancien truc qui s'était arrêté sur le bug »…
 * = une VRAIE demande de travail (édition), pas une conversation.
 */
export function isContinuationRequest(message: string): boolean {
  const m = fold(message);
  if (!m) return false;
  if (EXPLAIN_ONLY.test(m)) return false;
  if (CONTINUE_VERB.test(m)) return true;
  return INTERRUPTED_CTX.test(m);
}

// Quelque chose est CASSÉ / ne s'affiche pas / ne marche pas → l'utilisateur
// veut que ce soit RÉPARÉ (édition), même sans verbe « corrige ».
const BUG_REPORT = /(ne (?:marche(?:nt)?|fonctionne(?:nt)?|s'?affiche(?:nt)?|apparai(?:t|ssent)|charge(?:nt)?|s'?ouvre(?:nt)?|se met(?:tent)? a jour|repond(?:ent)?|se lance(?:nt)?|se charge(?:nt)?)\s*(?:pas|plus)|(?:marche(?:nt)?|fonctionne(?:nt)?|s'?affiche(?:nt)?|apparai(?:t|ssent)|charge(?:nt)?|s'?ouvre(?:nt)?|se met(?:tent)? a jour|repond(?:ent)?|se lance(?:nt)?|se charge(?:nt)?)\s*(?:pas|plus)\b|rien ne se passe|rien n'?apparait|rien ne s'?affiche|toujours (?:pas|rien)|c'?est casse|est casse|est cassee|y a un bug|il y a un bug|un bug\b|le bug\b|ce bug\b|des bugs|bugue|bug[ée]|une erreur|des erreurs|message d'?erreur|ca plante|plante\b|crash|s'?affiche(?:nt)? mal|mal affiche|pas cliquable|bouton mort|page blanche|doesn'?t work|does not work|not working|doesn'?t show|isn'?t showing|nothing happens|is broken|a bug\b|an error\b|error message|blank page)/;

// L'utilisateur veut seulement une analyse/explication du problème.
const ANALYSIS_ONLY = /\b(explique|expliques|expliquer|analyse|analyser|decris|decrire|resume|resumer|diagnostique|explain|analyze|analyse|describe|summarize)\b/;

/**
 * « les images ne s'affichent pas sur la page de personnalisation »,
 * « le bouton ne marche plus », « y a un bug sur le configurateur »…
 * = demande implicite de CORRECTION → doit passer par le vrai flux d'édition.
 */
export function isBugReportRequest(message: string): boolean {
  const m = fold(message);
  if (!m) return false;
  if (EXPLAIN_ONLY.test(m) || ANALYSIS_ONLY.test(m)) return false;
  return BUG_REPORT.test(m);
}

// ─── Backstop anti « fausse promesse » ───────────────────────────────────────
// La réponse PRÉTEND faire / continuer le travail (« Je continue et je mets en
// place… », « ✅ Je l'applique sur le configurateur », « Je vais ajouter… »)
// alors qu'aucune modification n'a été lancée.

const CLAIM = /(\bje (continue|reprends|poursuis|termine|finis|m'?y mets|m'?en occupe|m'?en charge|le fais|la fais|les fais|fais ca|fais cela|applique|l'?applique|les applique|mets? en place|mets? ca en place|corrige|repare|ajoute|rajoute|modifie|change|remplace|cree|creer|implemente|integre|developpe|mets? a jour|lance (la )?(modif|correction|mise a jour))\b|\bj'?(applique|ajoute|integre|implemente|attaque|y vais|actualise|active)\b|\bje vais (le |la |les |te |vous |tout )?(faire|appliquer|ajouter|rajouter|creer|modifier|changer|corriger|reparer|mettre|integrer|implementer|developper|remplacer|continuer|reprendre|terminer|finir)\b|\bc'?est (parti|en cours)\b|\b(i'?ll|i will|i am going to|i'?m going to|let me) (do|apply|add|implement|fix|update|change|create|build|continue|resume|finish)\b|\bi'?m (applying|adding|implementing|fixing|updating|continuing)\b)/;

// La réponse PROPOSE / DEMANDE au lieu d'affirmer (« je peux ajouter X si tu
// veux », « tu veux que je le fasse ? ») → ce n'est pas une fausse promesse.
const OFFER = /(\bje (peux|pourrais|propose|suggere)\b|\btu (veux|voudrais|preferes|souhaites)\b|\bveux[- ]?tu\b|\bsouhaites[- ]?tu\b|\bdis[- ]moi (si|ce que|quoi)\b|\bsi tu (veux|preferes|es d'?accord|valides)\b|\bdois[- ]je\b|\bon fait (comme ca|quoi)\b|\bje te propose\b|\bwant me to\b|\bshould i\b|\bwould you like\b|\blet me know\b|\bif you want\b)/;

/**
 * Vrai quand une réponse de chat (aucune édition réelle lancée) affirme
 * pourtant qu'elle fait / continue / applique le travail. Le serveur enchaîne
 * alors sur une VRAIE édition au lieu de laisser du texte creux.
 */
export function claimsWorkWithoutDoing(reply: string): boolean {
  const r = fold(reply);
  if (!r) return false;
  // Une réponse qui propose/questionne n'est pas une promesse tenue à honorer.
  if (OFFER.test(r)) return false;
  return CLAIM.test(r);
}
