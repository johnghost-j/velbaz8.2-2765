// ─── MOTEUR /genesis — PIPELINE CHIMERA ──────────────────────────────────────
// Transcription EXACTE du skill `chimera` (Runable) dans le moteur de l'app :
// on invente une marque d'un monde impossible, on rend UN CADRE PAR PAGE avec
// l'interface et le texte DÉJÀ DANS L'IMAGE, on déshabille chaque cadre pour en
// tirer une plaque propre, on découpe les assets, puis on compile la spec de
// construction du vrai site marchand.
//
// Différence avec le moteur historique (genesis.ts, 8 phases, conservé intact) :
//   - genesis photographie un monde plausible ; chimera en construit un
//     impossible et le photographie comme s'il était ordinaire.
//   - genesis rend UNE maquette de home ; chimera rend N cadres, un par page,
//     décidés par la liste de pages de la phase 1 (jamais un nombre fixe).
//   - le brief de construction est propre à chimera : cadre par page, plaque en
//     fond bord à bord, découpe par-dessus, vrai HTML vivant au-dessus.
//
// Règles dures du skill, encodées ici et non négociables :
//   - UNE seule loi de réalité brisée, suivie avec un littéralisme obsessionnel.
//   - Toujours le jour, toujours lumineux, MAIS le soleil n'est jamais visible
//     ni source de lumière : on nomme ce qui émet la lumière.
//   - Jamais un paysage naturel comme lieu ; jamais usine / atelier / labo /
//     backstage comme décor de page ; jamais de produit qui flotte par défaut.
//   - Palette claire et saturée. Un cadre sombre est refusé.
//   - Aucune porte d'approbation : le run va au bout tout seul.

import { generateText } from "ai";
import { getSharp } from './lib/optional-import';
import { gateway } from "./agent/gateway";
import { generateContentImage } from "./builder/images";
import { extractDesignSystem, type GenesisAsset, type GenesisEvent, type GenesisMockup, type GenesisPhaseLog, type GenesisResult } from "./genesis";
import { persistChimeraAsset, type PersistedChimeraAsset } from "./chimera-assets";
// Banque de références visuelles du skill (298 captures choisies par le propriétaire).
import { LOOKBOOK_COUNT, lookbookBlock } from "./chimera-lookbook";
import { runWithAiContext, newRunId } from "./ai-usage/context";

// Textuel = gpt-5.4-mini (choix utilisateur : ~3x plus rapide que gemini-3-flash
// et que les Claude sur ces prompts). La VISION reste inchangée : mini n'est pas
// utilisé pour analyser les cadres.
const WORLD_MODEL = "openai/gpt-5.4-mini";   // invention du monde : température haute
const THINK_MODEL = "openai/gpt-5.4-mini";   // prompts de cadres, spec finale
const FAST_MODEL = "openai/gpt-5.4-mini";    // repli
// [2026-09-05] gemini-3-flash brûlait tout son budget en reasoning tokens : la
// réponse revenait vide, le JSON était illisible et le cadre passait pour
// « conforme » sans avoir été contrôlé. Appel payé, résultat jeté.
const VISION_MODEL = "anthropic/claude-sonnet-4.6"; // vérification des cadres (multimodal)

const PHASE_TIMEOUT_MS = 180_000;

/** Nombre maximum de cadres rendus sur un run (garde-fou de coût). */
export const CHIMERA_MAX_FRAMES = 7;
/** Nombre minimum de cadres : home, produit, lookbook. */
export const CHIMERA_MIN_FRAMES = 3;
/** Régénérations autorisées par cadre quand la vérification échoue.
 *  [2026-09-05] Passé à 0 sur demande : un seul rendu payé par page. Un cadre
 *  refusé est CONSERVÉ et SIGNALÉ (note visible + réserve), jamais repayé. */
export const CHIMERA_MAX_FRAME_RETRIES = 0;
/** Plafond dur du nombre d'images payées sur un run, extractions comprises.
 *  Les cadres de pages (phase 3) passent en premier, les découpes (phase 4)
 *  consomment ce qui reste. Atteindre le plafond est annoncé, jamais silencieux. */
export const CHIMERA_MAX_IMAGES = 20;
/** Cadres rendus en parallèle (le reste passe par vagues). */
const CHIMERA_FRAME_CONCURRENCY = 3;

// ── Économies de crédits (phase 4) ─────────────────────────────────────────
// Les cadres visibles (phase 3), leurs modèles, leurs prompts et leur définition
// ne changent pas. On coupe seulement le travail d'extraction qui était payé puis
// jeté. Repasser une constante à false rétablit exactement l'ancien chemin.
/** Pas de fond ni de découpe quand la plaque propre a échoué : ces images sortent polluées par l'interface et finissent jetées. */
export const CHIMERA_SKIP_LAYERS_WITHOUT_CLEAN = true;
/** Découpe d'abord, fond ensuite : si l'incrustation alpha échoue, le fond sans produit ne sert à rien et n'est pas payé. */
export const CHIMERA_SKIP_BG_WITHOUT_CUTOUT = true;
/** Rôles de page où le constructeur pose réellement une découpe produit en couche flottante. */
export const CHIMERA_CUTOUT_ROLES = ["hero", "product", "lookbook", "scroll"];

// ── Appel LLM isolé (aucun historique partagé entre phases) ─────────────────
async function call(opts: { model: string; system: string; prompt: string; maxTokens: number; temperature?: number }): Promise<string> {
  const run = async (modelId: string) => {
    const res = await generateText({
      model: gateway(modelId),
      system: opts.system,
      prompt: opts.prompt,
      maxOutputTokens: opts.maxTokens,
      ...(opts.temperature !== undefined ? { temperature: opts.temperature } : {}),
      maxRetries: 1,
      abortSignal: AbortSignal.timeout(PHASE_TIMEOUT_MS),
    });
    return (res.text || "").trim();
  };
  try {
    const out = await run(opts.model);
    if (out) return out;
    throw new Error("empty output");
  } catch (e) {
    console.warn("[chimera] modèle", opts.model, "KO →", (e as Error).message, "— repli", FAST_MODEL);
    return await run(FAST_MODEL);
  }
}

function softClean(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "").replace(/,(\s*[}\]])/g, "$1");
}

function extractJson(raw: string): any {
  const fence = raw.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const body = fence ? fence[1] : raw;
  const start = body.indexOf("{");
  const end = body.lastIndexOf("}");
  if (start === -1 || end <= start) throw new Error("aucun JSON trouvé dans la sortie");
  const slice = body.slice(start, end + 1);
  try { return JSON.parse(slice); } catch { /* seconde chance */ }
  return JSON.parse(softClean(slice));
}

// ═══════════════════════════════════════════════════════════════════════════
// PHASE 1 — BIBLE DU MONDE ET CONCEPT  (references/worldsmith.md)
// ═══════════════════════════════════════════════════════════════════════════

const P1_WORLD_SYSTEM = `Tu inventes des marques venues de mondes qui n'existent pas, puis tu vends
leurs produits pour de vrai. Entrée : une catégorie de produit, parfois un adjectif. Tout le reste
— le monde, sa physique, ses matières, ses rituels, ses clients — est à toi.

LA DEMANDE DE L'UTILISATEUR FAIT LOI — ELLE N'EST JAMAIS RÉÉCRITE. Ta liberté ne porte QUE sur ce
que l'utilisateur n'a pas dit. Avant d'inventer quoi que ce soit, relis sa demande et recopie dans
"user_contract" : le produit exact qui est en vente (sa catégorie, au mot près : si l'utilisateur
dit vêtement, on vend des vêtements et rien d'autre — pas un accessoire, pas un flacon, pas un
objet cousin), plus chaque contrainte qu'il a écrite (style, couleurs, ambiance, public, gamme de
prix, pays, langue, nom). Ce que l'utilisateur a écrit ÉCRASE tes préférences, tes registres et tes
réflexes — y compris ceux listés plus bas. Si un choix d'invention entre en conflit avec sa demande,
c'est le choix d'invention qui tombe.
Le monde inventé habille ce produit, il ne le remplace pas : à la fin, un inconnu qui regarde le
site doit nommer, en une seconde, exactement le produit que l'utilisateur a demandé. Un produit
substitué, dérivé ou « plus intéressant » est un échec du run, pas une trouvaille.

CONSTRUIS À L'ENVERS, DEPUIS LE TRAVAIL BANAL DU PRODUIT. Jamais depuis une esthétique. Réponds
d'abord, en une ligne chacune : que fait physiquement ce produit pour le corps qui l'utilise ? quel
est le sol, l'air, la température, la distance qu'il doit survivre ? contre quel danger a-t-il été
fait, et ce danger est-il vivant ? qu'utilisait-on avant, et à quel prix ? de quoi est-il fait, d'où
vient cette matière, qui la récolte ? que devient-il usé — enterré, nourri, rendu, relâché ? qui
l'achète, et qu'a cette personne peur de perdre ?

LA RÈGLE DE LA LOI UNIQUE. Brise UNE seule loi de la réalité, profondément, et obéis à toutes les
autres avec un littéralisme obsessionnel. Énonce la loi brisée en une phrase qu'un enfant peut
répéter, puis propage-la jusqu'à ses conséquences ennuyeuses. Cinq impossibilités empilées = du
bruit, et le bruit lit « fantasy générique d'IA ».

REGISTRES DISPONIBLES (invente à l'intérieur, ne les copie pas) : surreal-domestic (objets
ordinaires, une règle tordue, pièces banales et lumière du jour — chaussures, mobilier, cuisine,
papeterie) · mythic-artefact (le produit comme relique, exhumée, patinée — cuir, métal, montres,
outils, bijoux) · bio-organic (matière vivante, poussée, respirante — parfum, soin, textile,
alimentaire) · deep-technical (une technologie inventée traitée comme une infrastructure ennuyeuse,
câblage, étiquettes, numéros de série — lunettes, audio, mobilité, sportswear) · illustrated /
storybook (peint, cel-shadé, texture imprimée — jouets, enfance, confiserie, jeux) ·
prismatic-glass (tout est transparent, réfracte, projette de la couleur — parfum, lunettes,
boissons, bijoux) · confection-surreal (la matière se comporte comme du sucre, du glaçage, du gel,
de la cire — cosmétique, chaussures, petits objets) · sky-and-water (nuage, vapeur, embruns,
courant, vent rendu visible, à midi jamais la nuit — sportswear, outerwear, voyage) ·
paper-theatre (monde construit, découpé, plié, peint, coutures visibles — jouets, papeterie, maison)
· cosmic-quiet (échelle énorme, humain minuscule, en version DIURNE seulement ; il avale le produit,
à utiliser rarement).
Écris le premier registre qui t'est venu : il est DISQUALIFIÉ comme réflexe de catégorie. Choisis
parmi les autres et dis en une ligne pourquoi les finalistes ont perdu. Les marques mémorables
naissent du frottement : des sneakers en prismatic-glass, un parfum en deep-technical.

LOI DE LUMIÈRE ET DE COULEUR — CLAIR PAR DÉFAUT. Contrainte dure sur chaque cadre, pas une humeur :
- Lumière de jour, mais LE SOLEIL N'EST JAMAIS DANS L'IMAGE ET N'EST JAMAIS LA SOURCE. Pas de
  disque solaire, pas de coucher, pas de rayons, pas de flare, pas d'heure dorée. Nomme ce qui
  émet réellement la lumière : un ciel blanc, un plafond lumineux, un mur de verre dépoli, la
  matière inventée elle-même. Ce n'est jamais « le soleil ».
- Pas de nuit, pas de crépuscule, pas de grotte, pas de pénombre, pas de fond noir.
- Le cadre est HIGH-KEY : sa valeur moyenne est claire, les ombres restent ouvertes et colorées.
- La couleur est le sujet : plusieurs teintes qui chantent ensemble plus une qui n'est pas
  d'accord, toutes réellement saturées. Brun, kaki, ardoise, boue, cendre = état d'échec.
- CE N'EST PAS UN LIEU DE NATURE. Le décor est bâti, fabriqué ou inventé : intérieur, hall,
  boutique, espace de transit, structure fabriquée, scène, ou champ pur de couleur et de matière.
  Forêt, roche, désert, plage, falaise, mousse, prairie, montagne : refusés comme LIEU. Nuage,
  vent rendu visible, eau claire, embruns, brume contre-jour sont bienvenus comme ÉLÉMENTS clairs
  à l'intérieur de ce décor bâti — jamais comme paysage.
- Nomme le lieu en trois mots. Si ces trois mots décrivent un paysage naturel extérieur, ou si la
  source de lumière est le soleil, recommence le monde.
- L'émerveillement plutôt que la menace. Étrange, vertigineux, tenu — jamais menaçant, jamais drôle.

TENUE PROFESSIONNELLE DE L'IDÉE — CE N'EST PAS UNE BLAGUE. Le monde est fantaisiste, la MARQUE est
sérieuse : une maison premium réelle qui vend un vrai produit à de vrais clients. L'idée doit pouvoir
être présentée à un investisseur sans faire sourire personne. Refusés d'office :
- l'humour, le gag, le clin d'œil, le second degré, le jeu de mots, le nom de marque qui plaisante ;
- le registre enfantin ou cartoon : mascotte, personnage, visage dessiné, yeux collés sur un objet,
  bulle de bande dessinée, emoji, pouce en l'air, typographie ronde et rebondie, autocollants ;
- le carnavalesque : confettis, ballons, guirlandes, feux d'artifice, tout ce qui lit « fête » ;
- le prétexte absurde qui remplace un vrai bénéfice produit — la loi brisée est traitée avec le même
  sérieux qu'une contrainte d'ingénierie, jamais comme une plaisanterie.
Test à passer avant d'écrire le JSON : lis ton concept à voix haute comme un communiqué de presse de
maison de luxe. S'il fait rire ou s'il sonne « produit pour enfants » alors que l'utilisateur n'a pas
demandé un produit pour enfants, recommence. Fantaisie et coloré, oui ; rigolo, non.
Les registres illustrated/storybook et confection-surreal restent disponibles, mais traités en
premium adulte : matière et lumière tenues, composition sobre, aucun personnage.

PAS D'IDÉE PAR DÉFAUT — LE TIRAGE DE COMPOSITION. Le réflexe à tuer : le produit qui flotte en
plein air au-dessus d'un fond coloré, centré, avec une lueur dessous. BANNI par défaut.
LE DÉFAUT EST LA BELLE PHOTO PRODUIT PROFESSIONNELLE : le produit détouré, entier, net, cadré au
centre ou légèrement décentré, posé dans le champ de couleur DESSINÉ de la page avec une ombre de
contact douce, éclairé comme de la vraie photo produit — égal, clair, sans drame, sans décor. C'est
ce que sont le hero et la page produit, sauf raison écrite.
Écris l'image qui t'est venue en tête à la lecture de la catégorie : elle est DISQUALIFIÉE. Puis
liste cinq façons de présenter le produit et choisis celle qui argumente le plus fort avec le monde
inventé : photo produit détourée (défaut) · posé sur une surface bâtie avec son ombre de contact ·
tenu/offert par des mains seules, produit entier et net · dans son contenant, coffret, présentoir,
vitrine, distributeur · multiplié (étagère, grille, file, pile) · à l'échelle extrême (macro de la
matière) · à plat et graphique (catalogué, éclaté, dessiné) · ambiance avec un corps qui le porte
(UN SEUL cadre du set, le lookbook).
Deux présentations sont rayées : LE PRODUIT EN TRAIN D'ÊTRE FABRIQUÉ (atelier, usine, bain de
teinture, presse, établi, ligne de production) et UN MANNEQUIN QUI TRAVERSE UNE SCÈNE en hero. Les
deux transforment la page en reportage photo et le produit en décor.
La lévitation n'est sur la table que si la loi brisée porte littéralement sur la gravité, et alors
dans un seul cadre du set.

LES CINQ TESTS — l'idée ne passe que si elle les franchit tous : 1) elle argumente (le monde dit
quelque chose du produit qu'une légende aurait dit) ; 2) elle est physique (tu peux nommer la
source de lumière, la température, la surface, ce qui touche quoi) ; 3) elle n'est pas échangeable
(le même monde avec une autre catégorie = recommence) ; 4) ce n'est pas la première chose que tu as
pensée ; 5) elle ne te répète pas.

COHÉRENCE ENTRE LES CADRES : la loi brisée se comporte à l'identique partout (même direction, même
intensité) ; la matière inventée réagit pareil à la lumière partout (si elle brille, elle éclaire ce
qui l'entoure et projette un rebond coloré) ; les ombres sont d'accord avec la source nommée ;
l'usure et la saleté existent (un objet impossible immaculé est un rendu, un objet éraflé est un
produit) ; entre deux cadres, au moins DEUX choses changent parmi distance de caméra, contact avec
une surface, présence d'un corps, entier vs détail, direction de la lumière.

ANTI-GÉNÉRIQUE : pas de runes lumineuses, de nébuleuses violettes, de rochers flottants, d'éclats
de cristal, de silhouettes de cathédrale, d'« atmosphère magique éthérée ». Pas de symétrie
parfaite, pas de dégradé radial parfait derrière le produit, pas de halo. Une imperfection
volontaire (poussière, empreinte, éraflure, réparation, brume inégale). Optique réelle (chute de
profondeur de champ, vignettage, une haute lumière brûlée, perspective honnête). Quelque chose de
banal dans le cadre (une étiquette, un prix, un câble, une miette, un ticket) : la croyance vit là.

SORTIE : STRICTEMENT du JSON, sans texte autour, exactement ce schéma :
{
 "user_contract": {"product": "le produit exact en vente, recopié de la demande de l'utilisateur au mot près", "product_plain": "ce produit nommé en 2-4 mots ordinaires, tel qu'un inconnu le dirait en voyant l'image", "constraints": ["chaque contrainte écrite par l'utilisateur : style, couleurs, ambiance, public, prix, pays, langue, nom — [] s'il n'en a donné aucune"], "free_to_invent": ["ce que l'utilisateur n'a PAS dit et que tu inventes donc librement"]},
 "brand_name": "inventé, prononçable, 1-3 syllabes, étranger à l'anglais mais dicible. INTERDITS : Lumina, Aether, Nova, Elysian, Zenith, Vertex, Solace, Eldoria, Arcanum",
 "reflex_disqualified": {"register": "le registre réflexe, disqualifié", "image": "l'image réflexe, disqualifiée"},
 "mundane_job": ["7 lignes : le travail banal, le sol/air/température/distance, le danger, l'avant, la matière et qui la récolte, la fin de vie, l'acheteur et sa peur"],
 "impossible_premise": "UNE phrase : la seule loi de réalité que ce monde brise",
 "premise_consequences": ["3-5 conséquences ennuyeuses et littérales de cette loi"],
 "world_bible": {"place": "ce que le lieu est physiquement — bâti, fabriqué ou inventé", "place_three_words": "trois mots", "weather": "...", "hour_and_light": "toujours le jour", "light_source": "ce qui émet la lumière, et ce n'est JAMAIS le soleil", "life": "ce qui pousse ou vit là", "fear": "ce que craignent les habitants", "trade": "ce qu'ils échangent"},
 "material": {"name": "matière inventée", "behaviour": "ce qu'elle fait sous la chaleur, l'eau, le temps, le toucher"},
 "ritual": "comment le produit est acquis, porté, nourri, retiré — nomme le geste",
 "register": {"chosen": "un registre de la liste", "why_others_lost": "une ligne"},
 "art_direction": "UN paragraphe : médium, optique, grain, étalonnage, façon de montrer, une émotion en un mot. Clair, high-key, du côté de l'émerveillement. Ce paragraphe sera recopié VERBATIM dans chaque prompt d'image.",
 "presentation": {"chosen": "la présentation retenue, tirée de la liste", "why": "une ligne"},
 "interface_register": {"closest_look": "01.png..10.png", "background_type": "mesh gradient | photographic scene | grainy illustration | plain field", "chrome": "light | dark"},
 "palette": {"dominant": "#hex clair et lumineux", "support": "#hex qui n'est pas d'accord", "accent": "#hex fort", "light": "#hex", "dark": "#hex pour le texte seulement"},
 "typography": {"display": "police réelle", "display_source": "URL Google Fonts / Fontshare", "text": "police réelle", "text_source": "URL", "setting": "comment elle est composée"},
 "currency": {"unit": "unité monétaire du monde", "symbol": "symbole ou suffixe", "note": "une ligne sur le taux vers l'euro"},
 "copy_deck": {"nav": ["4-6 liens"], "announcement": "petite pilule d'annonce", "headline": "le grand titre", "sub": "une phrase", "cta": "libellé du bouton", "chips": ["3-6 chips"], "product": {"name": "...", "price_world": "prix dans la devise du monde", "price_eur": "équivalent en euros", "sizes": ["4 tailles"], "variants": ["3 variantes, avec un #hex chacune"], "specs": ["4-6 lignes de spec écrites dans la langue du monde"]}, "footer": "..."},
 "pages": [{"n": 1, "slug": "hero", "name": "Accueil", "role": "hero|scroll|product|lookbook|category|ritual|cart", "purpose": "...", "storyboard": "un paragraphe : la scène de ce cadre", "reuse_imagery": true, "strings_budget": 8}],
 "frame_count_reason": "une ligne : combien de cadres et pourquoi"
}

Contraintes sur "pages" : la liste des pages que le site aura VRAIMENT, un cadre par page. Trois est
le plancher (hero, produit, lookbook), cinq à sept est normal pour un monde riche. Jamais de
remplissage pour atteindre un nombre, jamais une vraie page supprimée pour y arriver. Budget de
chaînes par cadre : hero ≈ 8, page de défilement ≈ 16-20, page produit ≈ 12, lookbook ≈ 3.
"reuse_imagery" = true seulement quand le site réutilisera l'image de ce cadre comme couche vivante
(hero, produit, sections bord à bord).
Toute la copie est écrite dans la langue du brief de l'utilisateur (français par défaut).`;

// ═══════════════════════════════════════════════════════════════════════════
// PHASE 2 — PROMPTS DE CADRES  (references/storefront.md + <prompting>)
// ═══════════════════════════════════════════════════════════════════════════

const P2_FRAME_SYSTEM = `Tu écris UN prompt d'image, pour UN cadre d'un site marchand fictif. Le
prompt doit produire une CAPTURE D'ÉCRAN de page de boutique en ligne, avec la navigation, les
boutons, les prix et le texte DÉJÀ DANS L'IMAGE. Jamais une illustration légendée après coup.

RÈGLE ZÉRO — LA PAGE EST UNE SURFACE DESSINÉE, PAS UNE PHOTOGRAPHIE. Aucune des dix références de
ce skill n'est une photo cinématique plein cadre avec une interface posée dessus. Leur fond est
DESSINÉ : un mesh gradient saturé, un champ de couleur, une illustration granuleuse, un canevas
quasi noir avec une seule lueur. La photographie, quand elle existe, vit À L'INTÉRIEUR du layout :
un produit détouré posé sur le dégradé, ou une image dans une carte arrondie.
- Le fond est de la COULEUR DESSINÉE par défaut. Énonce-le comme un dégradé : « smooth mesh
  gradient from #XXXXXX top-left through #XXXXXX to #XXXXXX bottom », ou « flat #XXXXXX field ».
- Le produit arrive comme un OBJET DÉTOURÉ POSÉ DANS CETTE COULEUR, avec une ombre de contact
  douce. Pas une personne qui traverse une pièce photographiée.
- Le produit est le sujet, photographié professionnellement : entier, net, correctement
  proportionné, éclairé également comme de la vraie photo produit, centré ou légèrement décentré
  avec de l'air autour. Pas d'atelier, pas de ligne de production, pas de mannequin qui marche, pas
  d'accessoires qui racontent une histoire. Si un inconnu ne peut pas dire ce qui est en vente en
  une seconde, le cadre est raté.
- UN SEUL cadre de tout le set peut être une scène photographique bord à bord : le lookbook.
- La couleur doit être forte. Les palettes pastel-industriel délavées (carrelage menthe, vert
  hôpital, beige pâle, béton mouillé) lisent comme une photo de stock.

LE SQUELETTE, DANS L'ORDRE (presque toutes les références sont ces cinq parties) :
1. BARRE HAUTE — soit blanche/translucide sur toute la largeur, soit une BARRE PILULE FLOTTANTE
   avec 18-22px d'air au-dessus. Wordmark + petite marque à gauche ; 4-6 liens de nav à 13-14px
   centrés ; à droite un lien fantôme et UN bouton pilule plein dans la couleur d'accent. Pour une
   boutique, le groupe de droite est « Search » · « Account » · « Bag (0) ».
2. PILULE D'ANNONCE (optionnelle) — petite capsule arrondie centrée au-dessus du titre : une
   étiquette colorée, une phrase courte, une flèche.
3. BLOC DE TITRE, CENTRÉ — une très grande ligne, 56-96px, sans-serif géométrique medium ou
   semibold, tracking serré, sombre sur clair ou blanc sur sombre. Une sous-ligne de 15-17px en
   dessous, grise, une phrase. Option : une expression du titre dans la couleur d'accent.
4. L'OBJET HERO — exactement un élément focal sous le titre, centré, avec beaucoup d'air autour :
   une grande carte arrondie (rayon 20-28px) qui est un champ, un panneau produit, un bloc de prix
   ou un panneau de verre ; ou le produit lui-même posé libre sur le dégradé. Un petit bouton
   circulaire ou pilule à l'intérieur, dans l'accent.
5. RANGÉE DE CHIPS — 3-6 petits chips arrondis en contour sous l'objet hero, puis éventuellement
   une rangée de 3-4 petites cartes tout en bas du cadre, à moitié coupées par le bord pour prouver
   que la page défile.

CE QUI FAIT LIRE « LOGICIEL DE 2026 » :
- Centré, contenu, aéré. Le contenu vit dans une colonne de ~1100-1200px avec de larges marges
  vides. Environ 45-55% du cadre est vide. L'encombrement est le mode d'échec principal.
- Rayons et douceur : pilules 999px pour les boutons et la nav, 20-28px pour les cartes, 12-16px
  pour les chips. Ombres larges, douces et faibles — jamais une ombre portée dure, jamais une boîte
  grise de 1px. Chips carrés à coins durs = refusé.
- UNE couleur d'accent, utilisée trois fois au maximum : le bouton, une petite étiquette, une lueur.
- La typo est le design. Une sans-serif géométrique, deux tailles qui comptent : le titre énorme et
  le petit tout-le-reste. Pas de nostalgie serif, pas de tracking large.
- PETITE UI, GRAND TITRE. Nav 13-14px, chips 12-13px, boutons 13-14px. Le titre fait 5-6× la taille
  de la nav. C'est ce rapport qui rend la capture crédible.
- La boutique appartient au monde par le VOCABULAIRE, jamais par la structure : les libellés, la
  devise, les lignes de spec et la note de retour sont écrits dans la langue du monde, mais la
  barre reste une barre, les chips restent des chips, le sac compte les articles, et chaque prix est
  visible.
- Lisibilité d'abord : gare le titre sur la zone la plus calme, ou sur un panneau dépoli. Texte
  sombre sur fond clair, blanc sur fond saturé ou sombre. L'accent apparaît une fois dans l'UI et
  une fois dans la scène, pour que l'interface appartienne à l'image.

ORDRE DU PROMPT, OBLIGATOIRE : Cadre → Direction artistique → Loi du monde → Produit & matière →
Lumière → Réserve de composition → Palette → Interface → Rendu.
La phrase de direction artistique est IDENTIQUE dans chaque prompt de cadre, recopiée verbatim.

GABARIT (remplis-le, garde l'ordre, retire ce que le cadre n'a pas) :
« Screenshot of a modern e-commerce website page, full-bleed browser viewport, no browser chrome, no
device frame, no mockup, no phone — the image is the page itself. [Direction artistique verbatim.]
[Le monde en termes physiques, sa loi brisée énoncée comme si elle était ordinaire.] [Le produit, sa
matière inventée, sa pose exacte, le rituel autour.] [Éclairage nommé, toujours diurne : direction,
dureté, température, où tombe l'ombre — et quelle est la source impossible. High-key et lumineux,
ombres colorées ouvertes, pas de noir, pas de nuit.] Composition: centred column, roughly half the
frame empty, the product presented as [la présentation choisie — jamais flottante sauf si la loi
brisée est la gravité]. Background: [dégradé / champ / illustration décrit précisément]. Palette
#___, #___, accent #___. [Rendu spécifique au médium : 85mm photographic, ou painted matte with
grain, ou flat illustration — jamais « digital art ».] [Puis l'interface, moderne et contemporaine :
barre pilule flottante ou barre haute affleurante, titre centré énorme, une carte arrondie focale,
une rangée de chips, un bouton pilule plein dans l'accent — net, vectoriel, petit texte, ombres
larges et douces, avec les chaînes LITTÉRALES du copy deck placées par position.] Only these
strings, spelled exactly, nothing else anywhere. »

RÈGLES DURES :
- Respecte le budget de chaînes du cadre. Au-delà, les lettres se déforment : coupe la copie, ne te
  bats pas avec le modèle.
- Nomme le mobilier explicitement : « utility strip », « navigation bar », « search field »,
  « product cards », « size chips », « shopping bag (0) », « hairline divider », « footer ».
- Jamais « lorem ipsum », jamais « placeholder », jamais un nom de marque réelle, et JAMAIS les
  mots « fantasy art », « epic », « highly detailed », « trending on artstation » : ces quatre mots
  produisent le look générique.
- Rappelle la palette hex dans chaque prompt.
- INTERDITS ABSOLUS dans le cadre : cadre sombre, nuit, noir, gothique · soleil visible ou soleil
  comme source · paysage naturel comme lieu · usine, atelier, ligne de production, teinturerie,
  laboratoire, entrepôt, backstage, plateau comme décor de page · produit qui flotte (sauf loi de
  gravité brisée) · mannequin qui marche en hero · palette boueuse (brun, kaki, ardoise, cendre) ·
  menace · runes, nébuleuses violettes, cristaux · symétrie parfaite · annotations de travail (px,
  %, cotes, repères, wireframe).

SORTIE : le prompt d'image et RIEN d'autre. Pas de préambule, pas de guillemets autour, pas de
markdown, pas de commentaire. Un seul paragraphe dense, en anglais (le générateur d'images
travaille mieux en anglais), mais les CHAÎNES DE TEXTE À AFFICHER sont recopiées telles quelles
dans la langue du copy deck.`;

// ═══════════════════════════════════════════════════════════════════════════
// VÉRIFICATION DES CADRES — passe de vision isolée
// ═══════════════════════════════════════════════════════════════════════════

const FRAME_CHECK_SYSTEM = `Tu contrôles UNE image censée être la capture d'écran d'une page de
boutique en ligne. Tu ne juges pas le goût : tu vérifies des faits. Réponds STRICTEMENT en JSON :
{"has_nav": true|false, "has_button": true|false, "has_headline": true|false,
 "reads_as_screen": true|false, "text_mangled": true|false, "is_dark": true|false,
 "sun_visible": true|false, "natural_landscape": true|false, "floating_product": true|false,
 "factory_scenery": true|false, "walking_model_hero": true|false, "muddy_palette": true|false,
 "ui_oversized": true|false, "work_annotations": true|false, "product_readable": true|false,
 "childish_gag": true|false, "professional": true|false,
 "score": 0-10, "fails": ["ce qui cloche, en une phrase chacun"]}
Définitions : has_nav = une barre de navigation existe, en haut, avec des liens. has_button = au
moins un bouton cliquable dessiné (pilule ou carte d'action). has_headline = un bloc de titre
nettement plus grand que le reste. reads_as_screen = ça lit comme une page de site, pas comme une
illustration avec une légende. text_mangled = des lettres sont déformées, illisibles ou inventées.
is_dark = la valeur moyenne de l'image est sombre (nuit, pénombre, fond noir). sun_visible = un
disque solaire, un coucher, des rayons ou un flare sont visibles. natural_landscape = le LIEU est un
paysage naturel (forêt, roche, désert, plage, falaise, prairie, montagne). floating_product = le
produit flotte en plein air sans contact ni support. factory_scenery = usine, atelier, ligne de
production, teinturerie, laboratoire, entrepôt, backstage ou plateau sert de décor. ui_oversized =
l'interface est surdimensionnée, flotte au centre ou est détachée des bords de la page.
work_annotations = des mesures sont DESSINÉES dans l'image (px, %, cotes, flèches de dimension,
repères de wireframe). product_readable = un inconnu peut dire en une seconde ce qui est en vente.
childish_gag = registre enfantin, cartoon ou blagueur : mascotte, personnage, visage dessiné, yeux
collés sur un objet, bulle de BD, emoji, autocollant, confetti, ballon, guirlande, jeu de mots
affiché, typographie ronde et rebondie. professional = ça lit comme une vraie maison premium qui vend
sérieusement son produit ; répondre false si ça lit comme une plaisanterie ou un produit-gadget.`;

interface FrameCheck {
  ok: boolean;
  /** false = le contrôle n'a PAS pu avoir lieu. Ce n'est PAS un cadre conforme. */
  checked: boolean;
  score: number;
  fails: string[];
  raw: string;
}

async function checkFrame(dataUrl: string, budget: number): Promise<FrameCheck> {
  try {
    const res = await generateText({
      model: gateway(VISION_MODEL),
      system: FRAME_CHECK_SYSTEM,
      messages: [{
        role: "user",
        content: [
          { type: "text", text: `Cette image doit être une capture de page de boutique en ligne, lumineuse, de jour, avec environ ${budget} chaînes de texte. Contrôle-la.` },
          { type: "image", image: dataUrl },
        ],
      }] as any,
      maxOutputTokens: 1200,
      maxRetries: 1,
      abortSignal: AbortSignal.timeout(PHASE_TIMEOUT_MS),
    });
    const raw = (res.text || "").trim();
    let j: any;
    // Contrôle illisible : on garde le cadre (il est payé, on ne le rejette pas et
    // on n'en repaie pas un autre) mais on ne ment pas en le disant conforme.
    if (!raw) return { ok: false, checked: false, score: -1, fails: ["le modèle de vision n'a renvoyé aucun texte"], raw };
    try { j = extractJson(raw); } catch { return { ok: false, checked: false, score: -1, fails: ["réponse du modèle de vision illisible (JSON invalide)"], raw }; }
    const fails: string[] = Array.isArray(j.fails) ? j.fails.map(String) : [];
    // Portes dures du skill : chacune fait échouer le cadre.
    const gates: [boolean, string][] = [
      [j.has_nav === false, "aucune barre de navigation"],
      [j.has_button === false, "aucun bouton"],
      [j.has_headline === false, "aucun bloc de titre"],
      [j.reads_as_screen === false, "lit comme une illustration légendée, pas comme un écran"],
      [j.text_mangled === true, "texte déformé ou inventé"],
      [j.is_dark === true, "cadre sombre (chimera est diurne)"],
      [j.sun_visible === true, "soleil visible ou soleil comme source de lumière"],
      [j.natural_landscape === true, "paysage naturel comme lieu"],
      [j.factory_scenery === true, "usine / atelier / labo / backstage comme décor de page"],
      [j.walking_model_hero === true, "mannequin qui marche en hero"],
      [j.muddy_palette === true, "palette boueuse"],
      [j.ui_oversized === true, "interface surdimensionnée ou détachée des bords"],
      [j.work_annotations === true, "annotations de travail dessinées dans l'image"],
      [j.product_readable === false, "on ne voit pas ce qui est en vente"],
      [j.childish_gag === true, "registre enfantin / cartoon / blague (mascotte, emoji, confetti, jeu de mots)"],
      [j.professional === false, "ne lit pas comme une maison premium sérieuse"],
    ];
    const hard = gates.filter(([bad]) => bad).map(([, why]) => why);
    const score = typeof j.score === "number" ? j.score : -1;
    return { ok: hard.length === 0, checked: true, score, fails: [...hard, ...fails], raw };
  } catch (e) {
    console.warn("[chimera] contrôle de cadre KO:", (e as Error).message);
    return { ok: false, checked: false, score: -1, fails: [`contrôle impossible : ${(e as Error).message}`], raw: "" };
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// TRANSCRIPTION DES CADRES RENDUS  (skill chimera, phase 4 : « read every -ui.png »)
// ═══════════════════════════════════════════════════════════════════════════
//
// [2026-09-05] CAUSE RÉELLE de « /genesis ne recrée pas le site à partir de
// l'image ». Le cadre pleine page AVEC son interface (…-ui) était bien rendu et
// bien écrit sur le disque, mais :
//   1. il était EXCLU du manifeste d'images du constructeur
//      (builder/images.ts, chimeraImageManifest : « if (a.kind === "ui") continue »),
//   2. PERSONNE ne le regardait, sauf extractDesignSystem() — sur le seul cadre
//      d'accueil, et seulement pour relever couleurs, polices et rayons.
// Ce que recevait l'agent qui écrit le code d'une page, c'était donc le PROMPT
// du cadre : le texte qu'on avait DEMANDÉ au générateur d'images, jamais ce que
// le générateur avait réellement dessiné. Résultat : le site était écrit à
// partir de texte, avec la plaque déshabillée posée en fond — un décor, pas une
// reconstruction. C'est exactement le reproche de l'utilisateur.
//
// Correctif : chaque cadre rendu est relu par le modèle de vision et transcrit
// en un relevé exhaustif (sections de haut en bas, chaînes au mot près,
// positions, tailles, couleurs, composants). Ce relevé fait LOI devant le
// prompt, et il est acheminé jusqu'au prompt de code de SA page.
//
// Aucun repli silencieux : une transcription qui échoue est annoncée, comptée
// dans les réserves du run, et la page concernée est signalée comme non
// reconstruite depuis son image.

const TRANSCRIBE_SYSTEM = `Tu es un relevé d'écran. On te donne UNE capture d'une page de site
marchand. Tu la décris pour un développeur qui ne verra JAMAIS cette image et qui doit la
reconstruire en HTML/React à l'identique.

Tu ne juges pas, tu n'améliores pas, tu n'inventes pas. Tu relèves ce qui est dessiné.

MÉTHODE — de haut en bas, section par section, dans l'ordre visuel réel.
Pour CHAQUE section, donne :
- son rôle (barre d'annonce, barre de navigation, hero, grille de produits, bande de chiffres,
  panneau produit, bloc éditorial, pied de page…) ;
- sa hauteur approximative en proportion de la page (ex : « ~55% de la hauteur ») ;
- son fond : couleur pleine (#hex relevé), dégradé (sens + teintes #hex), ou image bord à bord
  (dis alors ce que l'image montre) ;
- sa mise en page : nombre de colonnes, alignement, largeur du contenu, air autour ;
- CHAQUE chaîne de texte, RECOPIÉE AU MOT PRÈS, entre guillemets, dans l'ordre de lecture, avec
  sa position (gauche/centre/droite), sa taille relative (énorme titre, corps, petite mention),
  sa graisse, sa casse et sa couleur #hex ;
- CHAQUE contrôle : bouton (libellé, forme, rayon, couleur de fond, couleur du texte), chip,
  pastille de variante (avec son #hex), champ de saisie (texte indicatif), lien, compteur du sac,
  flèche, pagination ;
- CHAQUE image ou objet visuel : ce que c'est, où il est, quelle part du cadre il occupe.

ENSUITE, en fin de relevé :
- PALETTE : les #hex réellement présents, du plus couvrant au plus rare.
- TYPOGRAPHIE : la ou les familles apparentes (géométrique sans-serif, grotesque, serif…), le
  rapport de taille entre le titre et le corps, l'interlettrage remarquable.
- RAYONS ET OMBRES : valeurs apparentes en px.
- CE QUI EST ILLISIBLE : si une zone est floue ou si des lettres sont abîmées, dis-le à cet
  endroit précis au lieu d'inventer une chaîne. C'est une information utile, pas un échec.

RÈGLES DURES :
- Aucune chaîne inventée. Si tu ne lis pas, tu écris « illisible ».
- Pas de conseil, pas de critique, pas de « on pourrait ». Du relevé.
- Pas de code, pas de balise, pas de bloc de code. Du texte structuré en tirets.
- Sois long et précis : ce relevé REMPLACE l'image pour celui qui code.

SORTIE : le relevé seul, en français, rien autour.`;

/**
 * Relève une capture de cadre rendue et la transcrit en texte reconstructible.
 * Renvoie "" en cas d'échec — l'appelant DOIT le signaler, jamais l'avaler.
 */
export async function transcribeFrame(dataUrl: string, ctx: { brandName: string; pageName: string; role: string }): Promise<string> {
  try {
    const res = await generateText({
      model: gateway(VISION_MODEL),
      messages: [{
        role: "user",
        content: [
          {
            type: "text",
            text: `Marque : ${ctx.brandName}. Cette capture est la page « ${ctx.pageName} » (rôle : ${ctx.role}) du site.\n\nRelève-la intégralement, de haut en bas, selon la méthode.`,
          },
          { type: "image", image: dataUrl },
        ],
      }] as any,
      system: TRANSCRIBE_SYSTEM,
      maxOutputTokens: 6000,
      maxRetries: 1,
      abortSignal: AbortSignal.timeout(PHASE_TIMEOUT_MS),
    });
    return (res.text || "").trim();
  } catch (e) {
    console.warn("[chimera] transcription de cadre KO:", (e as Error).message);
    return "";
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// PHASE 4 — PLAQUES PROPRES ET DÉCOUPES
// ═══════════════════════════════════════════════════════════════════════════

const STRIP_UI_PROMPT = `Remove every text, button, navigation bar, logo, chip, price label and
interface element from this image. Keep the image completely unchanged otherwise — same subject,
same framing, same light, same colours, same composition. Fill where the interface was with a
plausible continuation of the scene. No text anywhere, no letter, no number, no watermark.`;

const ERASE_PRODUCT_PROMPT = `Remove the product entirely from this image. Keep the environment,
the light, the atmosphere, the colours and the camera exactly as they are. Fill where the product
stood with a plausible continuation of the scene. No text anywhere, no product-shaped smudge, no
ghost outline.`;

const ISOLATE_PRODUCT_PROMPT = `Keep only the product from this image, exactly as it is — same
shape, same material, same lighting, same angle, same colours, sharp and whole. Replace the entire
background with a perfectly uniform flat pure chroma green field (#00FF00), edge to edge, with no
gradient, no shadow, no reflection and no text of any kind. The product must not touch the edges of
the frame.`;

/**
 * Détourage par incrustation couleur : le raffinement ci-dessus repose le produit
 * sur un vert pur, on retire ce vert en alpha avec sharp, puis on rogne. Renvoie
 * null quand l'alpha obtenue est manifestement fausse (quasi vide ou quasi pleine).
 */
async function chromaKeyToAlpha(dataUrl: string): Promise<string | null> {
  try {
    const b64 = dataUrl.split(",")[1] ?? "";
    if (!b64) return null;
    const sharp = await getSharp();
    const src = sharp(Buffer.from(b64, "base64"));
    const { data, info } = await src.ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    const px = info.width * info.height;
    const ch = info.channels;
    if (ch < 4) return null;
    let cleared = 0;
    for (let i = 0; i < px; i++) {
      const o = i * ch;
      const r = data[o], g = data[o + 1], b = data[o + 2];
      // Vert dominant et franc = fond. Seuils volontairement stricts pour ne pas
      // manger un produit vert.
      if (g > 110 && g - r > 55 && g - b > 55) {
        data[o + 3] = 0;
        cleared++;
      }
    }
    const ratio = cleared / px;
    if (ratio < 0.08 || ratio > 0.95) {
      console.warn(`[chimera] incrustation abandonnée (fond détecté à ${(ratio * 100).toFixed(0)}%)`);
      return null;
    }
    const out = await sharp(data, { raw: { width: info.width, height: info.height, channels: 4 } })
      .png()
      .trim({ threshold: 1 })
      .resize({ width: 1600, withoutEnlargement: true })
      .webp({ quality: 88, alphaQuality: 100 })
      .toBuffer();
    return `data:image/webp;base64,${out.toString("base64")}`;
  } catch (e) {
    console.warn("[chimera] incrustation KO:", (e as Error).message);
    return null;
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// PHASE 5 — SPEC DE CONSTRUCTION DU VRAI SITE
// ═══════════════════════════════════════════════════════════════════════════

const P5_SPEC_SYSTEM = `Tu compiles le CAHIER DES CHARGES exécutable d'un vrai site marchand, à
partir d'un concept de monde impossible et d'un jeu de cadres déjà rendus (un par page, interface
comprise dans l'image). L'agent de code qui lira ce document n'aura RIEN d'autre. Il ne voit pas les
images : tout ce qui doit être construit doit être ÉCRIT, avec des valeurs exactes.

Le site est une VRAIE boutique qui fonctionne, pas une jolie page :
- La nav route réellement entre les pages annoncées.
- Page produit : les chips de taille et les pastilles de variante sélectionnent et changent d'état,
  quantité, ajout au panier.
- Panier : vrai tiroir ou vraie page, lignes, édition de quantité, suppression, sous-total,
  persistance (localStorage).
- Les prix affichent la devise du monde ET l'équivalent euro, partout, de la même façon.
- Défilement : la découpe du produit se décale en parallaxe contre sa plaque, les sections se
  révèlent, easing lent (600-900 ms).
- Responsive : le mobile RECOMPOSE le hero au lieu de l'écraser.
- L'ornement est dans le mouvement et la matière, jamais dans des contrôles inutilisables.
  Interdits : typo display illisible dans la nav, polices décoratives sous 14px, champs de
  particules qui mangent le défilement, son en lecture automatique, animation qui retarde un clic.

Structure obligatoire du document, dans cet ordre, avec des valeurs chiffrées partout :
1. DESIGN SYSTEM VERROUILLÉ — palette hex et rôle de chaque couleur, polices réelles + URL de leur
   source, échelle typographique complète, grille, largeur max, padding de page, rythme des
   sections, rayons (pilules 999px, cartes 20-28px, chips 12-16px), ombres (larges, douces,
   faibles), anatomie exacte de la barre de nav, des boutons, des chips, des cartes, du pied de
   page, durées et easings. Ces valeurs sont la loi sur TOUTES les pages.
2. LE MONDE EN UNE PAGE — la loi brisée, la source de lumière nommée, la matière, le rituel, le
   vocabulaire de la boutique. Ce que le texte du site doit savoir sans jamais l'expliquer.
3. COPY DECK INTÉGRAL — chaque chaîne affichée, page par page, recopiée à l'identique depuis le
   concept. Aucune invention, aucune traduction, aucun placeholder.
4. PAGE PAR PAGE — pour chaque page : route, cadre de référence, plaque de fond utilisée, découpe
   posée dessus, ordre des sections, position et taille de chaque bloc, comportement au survol,
   ce qui est cliquable et où ça mène.
5. MÉCANIQUE MARCHANDE — état du panier, forme des données, persistance, règles de prix (devise du
   monde + euro), sélection de taille et de variante, compteur du sac dans la nav.
6. MOUVEMENT — chaque animation avec sa durée en ms, son delay, son easing, son amplitude en px ou
   %, et son repli sous prefers-reduced-motion.
7. IMAGES — pour chaque asset : son identifiant, son rôle exact dans la page, sa largeur/hauteur
   déclarées, son loading, son fetchpriority. Plaques en fond bord à bord ; découpes par-dessus ;
   au-dessus, du VRAI HTML : texte, liens, chips, boutons. JAMAIS une image d'interface livrée comme
   une image d'interface : chaque lien, chip, prix et bouton visible dans les cadres existe comme
   élément vivant.
8. RITE DE CHARGEMENT — préchargement des images critiques (new Image() + await img.decode()),
   écran de chargement de marque pendant ce temps (fond de la palette, wordmark, progression
   déterminée dans la couleur d'accent — jamais un spinner par défaut), fondu de ~600 ms quand tout
   est résolu, résolution aussi sur error, libération forcée après 8 s. Sous la ligne de flottaison,
   le flou LQIP est derrière l'image réelle pour que rien ne se peigne de haut en bas.
9. CONTRÔLE FINAL — la liste de ce qui rend le livrable REFUSÉ : un site qui ressemble aux cadres
   mais où rien ne clique · une image d'UI affichée comme photo d'interface · un prix manquant ·
   un panier qui ne persiste pas · une page qui redéfinit une couleur, une police, un rayon ou un
   style de bouton · un dégradé violet sur blanc · une grille de cartes arrondies interchangeables
   sans raison · Inter / Roboto / Space Grotesk / Open Sans par défaut · un placeholder.

Écris en français, en markdown, dense, sans préambule et sans conclusion.`;

// ═══════════════════════════════════════════════════════════════════════════
// MOTEUR
// ═══════════════════════════════════════════════════════════════════════════

export interface RunChimeraOptions {
  brief: string;
  emit: (e: GenesisEvent) => void;
  /** Coupe toute génération d'images : concept + spec seulement. */
  skipVisuals?: boolean;
  signal?: AbortSignal;
}

interface ChimeraFrame {
  n: number;
  slug: string;
  name: string;
  role: string;
  budget: number;
  reuse: boolean;
  prompt: string;
  uiUrl: string | null;
  cleanUrl: string | null;
  bgUrl: string | null;
  cutUrl: string | null;
  check: FrameCheck | null;
  attempts: number;
  /** Relevé exhaustif du cadre RENDU (vision). Fait loi devant `prompt`. */
  transcript?: string | null;
  /** Fichiers réellement écrits sur le disque (et servis en HTTP). */
  uiFile?: PersistedChimeraAsset | null;
  cleanFile?: PersistedChimeraAsset | null;
  bgFile?: PersistedChimeraAsset | null;
  cutFile?: PersistedChimeraAsset | null;
}

/** Fichier persisté + à quoi il correspond. */
interface ChimeraFileRef extends PersistedChimeraAsset {
  kind: "ui" | "clean" | "background" | "product";
  frame: number;
  slug: string;
}

const pad = (n: number) => String(n).padStart(2, "0");

/** Détecte « /chimera <brief> » ou « /genesis <brief> » en tête de message. */
export function parseChimeraCommand(message: string): { active: boolean; brief: string } {
  const m = (message || "").trim();
  const hit = m.match(/^\/(chimera|genesis|vision)\b[\s:]*([\s\S]*)$/i);
  if (!hit) return { active: false, brief: m };
  return { active: true, brief: (hit[2] || "").trim() };
}

// Étiquette tous les appels IA du run pour le suivi des crédits (ai-usage/).
export function runChimera(opts: RunChimeraOptions): Promise<GenesisResult> {
  return runWithAiContext(
    { feature: "chimera", label: opts.brief.trim().slice(0, 80), runId: newRunId() },
    () => runChimeraInner(opts),
  );
}

async function runChimeraInner(opts: RunChimeraOptions): Promise<GenesisResult> {
  const t0 = Date.now();
  const runId = `chi_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
  const emit = opts.emit;
  const brief = opts.brief.trim();
  const phases: GenesisPhaseLog[] = [];
  const assets: GenesisAsset[] = [];
  const mockups: GenesisMockup[] = [];
  const files: ChimeraFileRef[] = [];
  const weaknesses: string[] = [];
  let degraded = false;
  // ── Budget d'images du run ───────────────────────────────────────────────
  // Chaque appel au générateur d'images passe par ce guichet. Rien n'est
  // rattrapé ni relancé en douce : quand le plafond tombe, ça se voit.
  let imagesUsed = 0;
  let imageBudgetAnnounced = false;
  const takeImageBudget = (what: string): boolean => {
    if (imagesUsed >= CHIMERA_MAX_IMAGES) {
      if (!imageBudgetAnnounced) {
        imageBudgetAnnounced = true;
        degraded = true;
        emit({ type: "note", text: `⚠️ Plafond de ${CHIMERA_MAX_IMAGES} images atteint sur ce run — les visuels suivants ne sont pas générés.` });
        weaknesses.push(`plafond de ${CHIMERA_MAX_IMAGES} images atteint : une partie des visuels n'a pas été produite (${what} et la suite).`);
      }
      return false;
    }
    imagesUsed += 1;
    return true;
  };

  emit({ type: "start", runId, brief });

  const phase = async <T>(n: number, title: string, fn: () => Promise<T>): Promise<T> => {
    if (opts.signal?.aborted) throw new Error("run annulé");
    emit({ type: "phase_start", phase: n, title });
    const t = Date.now();
    const out = await fn();
    const ms = Date.now() - t;
    const text = typeof out === "string" ? out : JSON.stringify(out, null, 2);
    phases.push({ phase: n, title, output: text, ms });
    emit({ type: "phase_done", phase: n, title, output: text, ms });
    return out;
  };

  // ── PHASE 1 — Bible du monde et concept ──────────────────────────────────
  const concept = await phase(1, "Bible du monde et concept", async () => {
    const raw = await call({
      model: WORLD_MODEL, system: P1_WORLD_SYSTEM,
      prompt: `Demande de l'utilisateur : « ${brief} »\n\nInvente le monde, écris le concept complet. JSON strict, rien autour.`,
      maxTokens: 9000, temperature: 1,
    });
    try { return extractJson(raw); } catch (e) {
      console.warn("[chimera] concept illisible, seconde tentative:", (e as Error).message);
      const retry = await call({
        model: THINK_MODEL, system: P1_WORLD_SYSTEM,
        prompt: `Demande de l'utilisateur : « ${brief} »\n\nJSON STRICT uniquement, aucun texte autour, aucun bloc de code.`,
        maxTokens: 9000, temperature: 0.9,
      });
      return extractJson(retry);
    }
  });

  const brandName = String(concept?.brand_name || "").trim() || "Sans nom";
  // Produit exact demandé par l'utilisateur, relevé en phase 1. Sert de garde-fou
  // dans CHAQUE rendu d'image : le modèle ne peut plus vendre un produit cousin.
  const productPlain = String(
    concept?.user_contract?.product_plain || concept?.user_contract?.product || "",
  ).trim().replace(/["`\\]/g, "").slice(0, 120);
  const palette = concept?.palette ?? {};
  const artDirection = String(concept?.art_direction || "").trim();
  const copyDeck = concept?.copy_deck ?? {};
  const conceptJson = JSON.stringify(concept, null, 2);

  emit({ type: "note", text: `Monde inventé : ${brandName}. ${String(concept?.impossible_premise || "").slice(0, 180)}` });

  // Liste de pages : c'est elle qui décide le nombre de cadres, jamais un chiffre fixe.
  const rawPages: any[] = Array.isArray(concept?.pages) ? concept.pages : [];
  const pages = rawPages
    .filter(p => p && (p.slug || p.name))
    .slice(0, CHIMERA_MAX_FRAMES)
    .map((p, i) => ({
      n: Number(p.n) || i + 1,
      slug: String(p.slug || p.name || `page-${i + 1}`).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, ""),
      name: String(p.name || p.slug || `Page ${i + 1}`),
      role: String(p.role || (i === 0 ? "hero" : "scroll")),
      purpose: String(p.purpose || ""),
      storyboard: String(p.storyboard || ""),
      budget: Number(p.strings_budget) || (i === 0 ? 8 : 14),
      reuse: p.reuse_imagery !== false,
    }));

  if (pages.length < CHIMERA_MIN_FRAMES) {
    weaknesses.push(`liste de pages trop courte (${pages.length}) — le plancher du skill est ${CHIMERA_MIN_FRAMES} cadres.`);
    const fillers = [
      { role: "hero", name: "Accueil", slug: "accueil" },
      { role: "product", name: "Produit", slug: "produit" },
      { role: "lookbook", name: "Lookbook", slug: "lookbook" },
    ];
    for (const f of fillers) {
      if (pages.length >= CHIMERA_MIN_FRAMES) break;
      if (pages.some(p => p.role === f.role)) continue;
      pages.push({ n: pages.length + 1, slug: f.slug, name: f.name, role: f.role, purpose: "", storyboard: "", budget: f.role === "lookbook" ? 3 : 12, reuse: true });
    }
  }

  emit({ type: "note", text: `${pages.length} cadres à rendre — un par page. ${String(concept?.frame_count_reason || "").slice(0, 160)}` });

  const paletteLine = `Palette ${palette.dominant ?? ""}, ${palette.support ?? ""}, accent ${palette.accent ?? ""}, encre ${palette.dark ?? ""}.`;

  // ── PHASE 2 — Prompts de cadres ──────────────────────────────────────────
  const framePrompts = await phase(2, "Prompts de cadres", async () => {
    const out: string[] = [];
    for (const p of pages) {
      const prompt = await call({
        model: THINK_MODEL, system: P2_FRAME_SYSTEM,
        prompt: `DEMANDE DE L'UTILISATEUR — FAIT LOI, LE PRODUIT MONTRÉ EST CELUI-LÀ : « ${brief} »
Contrat relevé en phase 1 : ${JSON.stringify(concept?.user_contract ?? {})}
MARQUE : ${brandName}
CADRE ${p.n} — rôle « ${p.role} », page « ${p.name} ». Budget de chaînes : ${p.budget}.
BUT DE LA PAGE : ${p.purpose}
STORYBOARD DE CE CADRE : ${p.storyboard}

DIRECTION ARTISTIQUE À RECOPIER VERBATIM :
${artDirection}

${paletteLine}
Registre d'interface visé : ${JSON.stringify(concept?.interface_register ?? {})}
Présentation du produit retenue : ${JSON.stringify(concept?.presentation ?? {})}
Loi brisée : ${concept?.impossible_premise}
Bible du monde : ${JSON.stringify(concept?.world_bible ?? {})}
Matière : ${JSON.stringify(concept?.material ?? {})}
Rituel : ${concept?.ritual}
Typographie : ${JSON.stringify(concept?.typography ?? {})}
Devise : ${JSON.stringify(concept?.currency ?? {})}

COPY DECK — n'utilise QUE ces chaînes, orthographiées exactement :
${JSON.stringify(copyDeck, null, 2)}

${lookbookBlock(`${p.role} ${p.name}`, p.n * 7919 + brief.length)}

Cadres déjà écrits pour ce site (varie au moins DEUX choses : distance de caméra, contact avec une
surface, présence d'un corps, entier vs détail, direction de la lumière) :
${out.length ? out.map((o, i) => `— cadre ${i + 1} : ${o.slice(0, 320)}`).join("\n") : "— aucun, c'est le premier"}

Écris maintenant le prompt d'image de ce cadre. Le prompt seul, rien d'autre.`,
        maxTokens: 1600, temperature: 0.9,
      });
      out.push(prompt.replace(/^```[\s\S]*?\n/, "").replace(/```$/, "").trim());
    }
    return out;
  });

  const frames: ChimeraFrame[] = pages.map((p, i) => ({
    n: p.n, slug: p.slug, name: p.name, role: p.role, budget: p.budget, reuse: p.reuse,
    prompt: framePrompts[i] ?? "", uiUrl: null, cleanUrl: null, bgUrl: null, cutUrl: null,
    check: null, attempts: 0, transcript: null,
  }));

  // Garde-fou d'interface commun à tous les rendus : ce sont les phrases qui
  // font la différence entre « capture de boutique » et « illustration ».
  const RENDER_GUARD =
    ` MANDATORY: the only brand name that may appear anywhere in this image is "${brandName}", spelled exactly like that.`
    + ` MANDATORY: this is a finished website screenshot, never an annotated design plan: no percentage labels, no pixel dimensions,`
    + ` no coordinate markers, no dimension lines or arrows, no wireframe callouts, no layout guide overlays, no ruler marks.`
    + ` MANDATORY: daylight and high-key — no night, no dusk, no black background, no visible sun, no sunbeams, no lens flare.`
    + ` MANDATORY: the place is built, made or invented — never a natural landscape, never a factory, workshop, production line, laboratory or backstage.`
    // Le produit montré doit être CELUI QUE L'UTILISATEUR A DEMANDÉ, pas un
    // cousin plus photogénique choisi par le modèle.
    + (productPlain
      ? ` MANDATORY: the product on sale in this image is exactly "${productPlain}" — the real, recognisable object, shown professionally as itself.`
        + ` Never substitute a related, derivative or more photogenic product, never show only packaging, props or accessories instead of it.`
      : "")
    // Idée fantaisiste, marque SÉRIEUSE : aucun registre enfantin ni blagueur.
    + ` MANDATORY: this is a serious premium brand, never a joke and never childish: no mascot, no character, no drawn face,`
    + ` no googly eyes on objects, no comic speech bubble, no emoji, no sticker, no confetti, no balloons, no party garland,`
    + ` no bouncy rounded cartoon lettering, no toy-like plastic finish. Adult, composed, professional retail photography.`
    + ` ${paletteLine} Only the strings listed above, spelled exactly, nothing else anywhere.`;

  // ── PHASE 3 — Cadres, interface intégrée ─────────────────────────────────
  if (!opts.skipVisuals) {
    await phase(3, "Cadres, interface intégrée", async () => {
      const renderOne = async (f: ChimeraFrame): Promise<void> => {
        for (let attempt = 1; attempt <= CHIMERA_MAX_FRAME_RETRIES + 1; attempt++) {
          f.attempts = attempt;
          const fixes = f.check?.fails?.length
            ? `\n\nCORRECTIONS OBLIGATOIRES sur le rendu précédent (le cadre a été refusé) :\n- ${f.check.fails.join("\n- ")}\n`
              + (attempt > 1 ? `Réduis la quantité de texte affiché : garde au maximum ${Math.max(4, f.budget - 4 * (attempt - 1))} chaînes.` : "")
            : "";
          if (!takeImageBudget(`cadre ${f.n} « ${f.name} »`)) {
            weaknesses.push(`cadre ${f.n} (${f.name}) : non rendu, plafond de ${CHIMERA_MAX_IMAGES} images atteint.`);
            return;
          }
          const url = await generateContentImage(f.prompt + fixes + RENDER_GUARD, "wide", 1920, { allowText: true });
          if (!url) { if (attempt === CHIMERA_MAX_FRAME_RETRIES + 1) weaknesses.push(`cadre ${f.n} (${f.name}) : générateur d'images en échec.`); continue; }
          const check = await checkFrame(url, f.budget);
          f.check = check;
          // On garde toujours le dernier rendu : mieux vaut un cadre imparfait
          // qu'aucune référence pour la construction.
          f.uiUrl = url;
          // [2026-09-05] Le cadre est écrit sur le disque AVANT d'être annoncé.
          // Sans fichier, la spec ne peut citer aucune image et le site serait
          // bâti à partir de texte seul. Et surtout : c'est l'URL du fichier
          // (petite, chargeable par le navigateur) qui part au client — pas la
          // data URI de plusieurs Mo, que le chat ne parvenait pas à afficher.
          const savedUi = await persistChimeraAsset(runId, `${pad(f.n)}-${f.slug}-ui`, url);
          if (savedUi) { f.uiFile = savedUi; files.push({ ...savedUi, kind: "ui", frame: f.n, slug: f.slug }); }
          const asset: GenesisAsset = {
            elementId: f.n === 1 ? "__mockup" : `frame-${f.n}-${f.slug}`,
            role: "mockup", url: savedUi?.relUrl || url, prompt: f.prompt, variant: attempt, score: check.score,
          };
          assets.push(asset);
          emit({ type: "asset", asset });
          mockups.push({
            url, prompt: f.prompt, attempt, score: check.score, accepted: check.ok,
            verdict: check.raw.slice(0, 4000), fixes: check.fails, round: f.n, variant: attempt,
          });
          if (check.ok) return;
          console.warn(`[chimera] cadre ${f.n} refusé (essai ${attempt}) : ${check.fails.join(" | ")}`);
          // Aucun nouvel essai n'est payé : le défaut est annoncé tel quel.
          if (attempt === CHIMERA_MAX_FRAME_RETRIES + 1) {
            emit({ type: "note", text: check.checked
              ? `⚠️ Cadre ${f.n} « ${f.name} » conservé avec des défauts (aucun second rendu n'est payé) : ${check.fails.join(" · ").slice(0, 220)}`
              : `⚠️ Cadre ${f.n} « ${f.name} » NON CONTRÔLÉ — ${check.fails.join(" · ").slice(0, 220)}. Le cadre est gardé tel quel, sa qualité n'est pas garantie.` });
          }
        }
        degraded = true;
        weaknesses.push(f.check && !f.check.checked
          ? `cadre ${f.n} (${f.name}) NON CONTRÔLÉ (${f.check.fails.join(" · ")}) : gardé tel quel, sa conformité n'a pas pu être vérifiée.`
          : `cadre ${f.n} (${f.name}) conservé malgré ses défauts : ${f.check?.fails.join(" · ") || "non détaillés"}`);
      };

      for (let i = 0; i < frames.length; i += CHIMERA_FRAME_CONCURRENCY) {
        const wave = frames.slice(i, i + CHIMERA_FRAME_CONCURRENCY);
        emit({ type: "note", text: `Rendu des cadres ${wave.map(f => f.n).join(", ")} sur ${frames.length}.` });
        await Promise.all(wave.map(renderOne));
      }
      const okCount = frames.filter(f => f.check?.ok).length;
      const uncheckedCount = frames.filter(f => f.check && !f.check.checked).length;
      if (uncheckedCount > 0) {
        emit({ type: "note", text: `⚠️ ${uncheckedCount} cadre(s) n'ont pas pu être contrôlés (modèle de vision indisponible) — ils sont gardés sans garantie de qualité.` });
      }
      return frames.map(f => `cadre ${f.n} « ${f.name} » (${f.role}) — ${f.check?.ok ? "conforme" : f.check && !f.check.checked ? "NON CONTRÔLÉ" : "conservé avec réserves"}, essais ${f.attempts}, note ${f.check?.score ?? "n/a"}\n${f.prompt}`).join("\n\n")
        + `\n\n${okCount}/${frames.length} cadres conformes du contrôle${uncheckedCount ? `, ${uncheckedCount} non contrôlé(s)` : ""}.`;
    });

    // ── PHASE 4 — Plaques propres et découpes ──────────────────────────────
    await phase(4, "Plaques propres et découpes", async () => {
      const targets = frames.filter(f => f.uiUrl && f.reuse);
      if (!targets.length) return "Aucun cadre réutilisé comme couche vivante : pas de plaque à produire.";
      const lines: string[] = [];
      // Compteur d'images d'extraction non lancées parce qu'elles auraient été jetées.
      let saved0 = 0;

      const stripOne = async (f: ChimeraFrame) => {
        // (a) plaque propre : on déshabille le cadre de toute son interface.
        if (!takeImageBudget(`plaque propre du cadre ${f.n}`)) {
          lines.push(`cadre ${f.n} « ${f.name} » → aucune extraction : plafond d'images atteint`);
          return;
        }
        const clean = await generateContentImage(STRIP_UI_PROMPT, "wide", 1920, { refImages: [f.uiUrl!] });
        if (clean) {
          f.cleanUrl = clean;
          const saved = await persistChimeraAsset(runId, `${pad(f.n)}-${f.slug}-clean`, clean);
          if (saved) { f.cleanFile = saved; files.push({ ...saved, kind: "clean", frame: f.n, slug: f.slug }); }
          const a: GenesisAsset = { elementId: `clean-${f.n}-${f.slug}`, role: "background", url: saved?.relUrl || clean, prompt: STRIP_UI_PROMPT, variant: 1 };
          assets.push(a); emit({ type: "asset", asset: a });
        } else {
          weaknesses.push(`cadre ${f.n} : plaque propre non produite, la construction devra composer sur le cadre habillé.`);
        }

        // Sans plaque propre, le fond et la découpe se feraient depuis un cadre
        // encore habillé : les deux images sortiraient polluées d'interface et
        // seraient jetées. On ne les paie pas.
        if (!f.cleanUrl && CHIMERA_SKIP_LAYERS_WITHOUT_CLEAN) {
          saved0 += 2;
          lines.push(`cadre ${f.n} « ${f.name} » → plaque propre KO, fond et découpe non lancés (auraient été jetés)`);
          return;
        }

        const base = f.cleanUrl ?? f.uiUrl!;

        // (b) découpe du produit AVANT le fond : isolement sur vert pur puis
        // incrustation en alpha. Le fond sans produit n'a de sens que si cette
        // découpe existe pour se reposer dessus, donc on l'évalue d'abord.
        const wantsCutout = CHIMERA_CUTOUT_ROLES.includes(f.role);
        if (wantsCutout) {
          const iso = takeImageBudget(`découpe du cadre ${f.n}`)
            ? await generateContentImage(ISOLATE_PRODUCT_PROMPT, "wide", 1600, { refImages: [base] })
            : null;
          if (iso) {
            const cut = await chromaKeyToAlpha(iso);
            if (cut) {
              f.cutUrl = cut;
              const saved = await persistChimeraAsset(runId, `product-${pad(f.n)}-${f.slug}`, cut);
              if (saved) { f.cutFile = saved; files.push({ ...saved, kind: "product", frame: f.n, slug: f.slug }); }
              const a: GenesisAsset = { elementId: `product-${f.n}-${f.slug}`, role: "cutout", url: saved?.relUrl || cut, prompt: ISOLATE_PRODUCT_PROMPT, variant: 1, segmented: true };
              assets.push(a); emit({ type: "asset", asset: a });
            } else {
              weaknesses.push(`cadre ${f.n} : découpe alpha refusée (alpha sale) — la plaque propre sert de couche unique.`);
            }
          }
        } else {
          saved0 += 1;
        }

        // (c) plaque de fond : produit effacé, elle passe sous du texte vivant.
        // Sans découpe posée par-dessus, personne ne l'utilise.
        if (f.cutUrl || !CHIMERA_SKIP_BG_WITHOUT_CUTOUT) {
          const bg = takeImageBudget(`fond sans produit du cadre ${f.n}`)
            ? await generateContentImage(ERASE_PRODUCT_PROMPT, "wide", 1920, { refImages: [base] })
            : null;
          if (bg) {
            f.bgUrl = bg;
            const saved = await persistChimeraAsset(runId, `background-${pad(f.n)}-${f.slug}`, bg);
            if (saved) { f.bgFile = saved; files.push({ ...saved, kind: "background", frame: f.n, slug: f.slug }); }
            const a: GenesisAsset = { elementId: `background-${f.n}-${f.slug}`, role: "background", url: saved?.relUrl || bg, prompt: ERASE_PRODUCT_PROMPT, variant: 1 };
            assets.push(a); emit({ type: "asset", asset: a });
          }
        } else {
          saved0 += 1;
        }
        lines.push(`cadre ${f.n} « ${f.name} » → plaque propre ${f.cleanUrl ? "ok" : "KO"}, découpe ${f.cutUrl ? "ok" : wantsCutout ? "KO" : "non requise"}, fond sans produit ${f.bgUrl ? "ok" : "non lancé"}`);
      };

      for (let i = 0; i < targets.length; i += CHIMERA_FRAME_CONCURRENCY) {
        const wave = targets.slice(i, i + CHIMERA_FRAME_CONCURRENCY);
        emit({ type: "note", text: `Découpe des cadres ${wave.map(f => f.n).join(", ")}.` });
        await Promise.all(wave.map(stripOne));
      }
      return lines.join("\n");
    });
  }

  // ── Transcription des cadres rendus ──────────────────────────────────────
  // Le site doit être RECONSTRUIT à partir de l'image de la page, pas décoré
  // avec son fond. Chaque cadre habillé est relu par le modèle de vision ; le
  // relevé part ensuite dans le prompt de code de SA page (bloc CADRE-TRANSCRIT
  // en fin de spec, lu de façon déterministe par le constructeur).
  {
    const targets = frames.filter(f => f.uiUrl);
    if (targets.length) {
      emit({ type: "note", text: `Relevé des ${targets.length} page(s) rendues — le code sera écrit d'après l'image, pas d'après le prompt.` });
      for (let i = 0; i < targets.length; i += CHIMERA_FRAME_CONCURRENCY) {
        if (opts.signal?.aborted) throw new Error("run annulé");
        const wave = targets.slice(i, i + CHIMERA_FRAME_CONCURRENCY);
        await Promise.all(wave.map(async (f) => {
          const t = await transcribeFrame(f.uiUrl!, { brandName, pageName: f.name, role: f.role });
          if (t && t.length > 400) {
            f.transcript = t;
            emit({ type: "note", text: `Page « ${f.name} » relevée (${t.length} caractères de mise en page exacte).` });
          } else {
            // Pas de repli silencieux : la page se construira depuis le prompt
            // seul, et ça se dit.
            degraded = true;
            weaknesses.push(`cadre ${f.n} « ${f.name} » : relevé de l'image ${t ? "trop court" : "impossible"} — cette page sera écrite d'après le prompt, pas d'après son image.`);
            emit({ type: "note", text: `⚠️ Page « ${f.name} » : impossible de relever l'image rendue — elle ne sera pas reconstruite à l'identique.` });
          }
        }));
      }
    }
  }

  // ── Design system verrouillé, relevé sur le cadre hero ───────────────────
  const hero = frames.find(f => f.role === "hero" && f.uiUrl) ?? frames.find(f => f.uiUrl) ?? null;
  let designSystem = "";
  if (hero?.uiUrl) {
    designSystem = await extractDesignSystem(hero.uiUrl, brandName);
    if (designSystem) emit({ type: "note", text: "Design system relevé sur le cadre d'accueil — il s'applique à chaque page." });
  }
  const designLock = designSystem
    ? `DESIGN SYSTEM VERROUILLÉ — S'APPLIQUE À CHAQUE PAGE DU SITE, AUCUNE DÉRIVE
Relevé directement sur le cadre d'accueil rendu. Ces valeurs sont la loi : accueil, pages internes, listes, fiches, panier, pied de page utilisent exactement la même palette, les mêmes polices, la même échelle typographique, les mêmes composants, les mêmes rayons et les mêmes durées. Une page qui introduit une autre couleur d'accent, une autre police ou un autre style de bouton est un ÉCHEC.

${designSystem}`
    : "";

  // ── PHASE 5 — Spec de construction ───────────────────────────────────────
  // Index des assets : ce sont de VRAIS fichiers servis en HTTP par ce serveur
  // (`/api/chimera/assets/<runId>/<fichier>`), donc utilisables tels quels dans
  // le site construit — et c'est aussi cette URL qui est envoyée au chat.
  const assetIndex = files.length
    ? files.map(f => `- ${f.kind === "ui" ? "référence d'écran (à transcrire, JAMAIS à afficher)" : f.kind === "clean" ? "plaque propre (fond bord à bord)" : f.kind === "background" ? "fond sans produit (fond bord à bord)" : "découpe produit sur transparence (par-dessus le fond)"} — cadre ${f.frame} ${f.slug} → ${f.url} (${Math.round(f.bytes / 1024)} Ko)`).join("\n")
    : assets.length
      ? assets.map(a => `- ${a.elementId} (${a.role}${a.segmented ? ", détouré alpha" : ""}) → asset://${runId}/${a.elementId}/${a.variant}`).join("\n")
      : "- (aucun asset : mode concept seul)";

  const frameSheet = frames.map(f => `### Cadre ${f.n} — ${f.name} (${f.role}), route /${f.slug === "hero" || f.role === "hero" ? "" : f.slug}
- Réutilisé comme couche vivante : ${f.reuse ? "oui" : "non"}
- Assets disponibles (URLs réelles, à utiliser telles quelles dans le code) : ${[
      f.uiFile && `référence d'écran (NE PAS afficher, seulement transcrire) ${f.uiFile.url}`,
      f.cleanFile && `plaque propre ${f.cleanFile.url}`,
      f.bgFile && `fond sans produit ${f.bgFile.url}`,
      f.cutFile && `découpe produit alpha ${f.cutFile.url}`,
    ].filter(Boolean).join("\n  · ") || "aucun"}
- Budget de chaînes du cadre : ${f.budget}
- Contrôle : ${f.check?.ok ? "conforme" : f.check && !f.check.checked ? `NON CONTRÔLÉ (${f.check.fails.join(" · ")}) — qualité non garantie` : `réserves — ${f.check?.fails.join(" · ") || "non contrôlé"}`}
- Prompt du cadre (ce qu'on a DEMANDÉ au générateur — indicatif seulement) :
${f.prompt}
${f.transcript
      ? `- RELEVÉ DE L'IMAGE RENDUE — FAIT LOI, PRIME SUR LE PROMPT CI-DESSUS.
  Cette page doit être reconstruite en vrai HTML d'après ce relevé : mêmes sections dans le même
  ordre, mêmes chaînes au mot près, mêmes positions, mêmes couleurs, même échelle typographique.
${f.transcript}`
      : "- RELEVÉ DE L'IMAGE : INDISPONIBLE — cette page ne peut pas être reconstruite à l'identique, dis-le au lieu de bricoler."}`).join("\n\n");

  const spec = await phase(5, "Spec de construction", () =>
    call({
      model: THINK_MODEL, system: P5_SPEC_SYSTEM,
      prompt: `Demande initiale : « ${brief} »

MARQUE : ${brandName} — c'est le seul nom autorisé partout. « genesis », « chimera » et « vision » sont des noms de commandes internes : ils n'apparaissent JAMAIS dans la marque, le contenu ou le naming.

${designLock}

CONCEPT COMPLET (bible du monde, matière, rituel, registre, palette, typographie, devise, copy deck, liste de pages) :
${conceptJson}

CADRES RENDUS — un par page, interface comprise dans l'image :
${frameSheet}

ASSETS RÉELLEMENT DISPONIBLES :
${assetIndex}

RÈGLE DE COMPOSITION NON NÉGOCIABLE : chaque section se compose de la plaque de fond bord à bord,
puis de la découpe du produit par-dessus, puis de VRAI texte et de VRAIS contrôles HTML au-dessus.
Jamais un cadre livré comme une capture d'écran affichée. Tout ce qui est dessiné dans un cadre
(lien, chip, prix, bouton, compteur du sac) existe comme élément vivant.

${degraded ? `RÉSERVES DU RUN (à compenser dans le code, pas à ignorer) :\n- ${weaknesses.join("\n- ")}\n` : ""}
Compile maintenant le cahier des charges.`,
      maxTokens: 9000, temperature: 0.3,
    }));

  // Bloc d'assets ajouté de façon DÉTERMINISTE (pas laissé au modèle) : sans ces
  // URLs dans la spec, le constructeur bâtit le site à partir de texte seul et
  // les images ne servent à rien.
  const assetContract = files.length
    ? `\n\n---\n\nASSETS RÉELS DU RUN — URLS À UTILISER TELLES QUELLES (aucune autre image n'est autorisée)
Ces fichiers existent sur le serveur et se chargent en HTTP. Recopie les chemins exactement.

${assetIndex}

RÈGLES D'EMPLOI :
- Une image « fond sans produit » ou « plaque propre » se pose en fond bord à bord (full-bleed) de sa section.
- Une image « découpe produit » se pose PAR-DESSUS le fond de la même page, même échelle et même cadrage que dans le cadre d'origine.
- Une « référence d'écran » (…-ui) ne s'affiche JAMAIS dans le site : elle sert uniquement à transcrire la mise en page, les textes et les positions en vrai HTML.
- Aucun placeholder, aucune image de stock, aucune URL inventée.`
    : "";

  // [2026-09-05] Si des visuels ont été produits mais qu'AUCUN n'a pu être
  // écrit sur disque, la spec ne contient aucune URL : le site serait construit
  // à partir de texte seul, silencieusement, avec des images de stock. On le
  // dit haut et fort au lieu de laisser le bug passer inaperçu.
  if (!opts.skipVisuals && assets.length > 0 && files.length === 0) {
    degraded = true;
    weaknesses.push("aucun visuel n'a pu être enregistré sur le serveur : le site ne peut PAS être construit à partir des images générées.");
    emit({ type: "note", text: "⚠️ Aucun visuel enregistré sur le serveur — le site ne pourra pas être bâti sur les images générées." });
  }

  // Compte réel des images payées sur ce run, annoncé au client : le coût se
  // constate pendant le run, il ne se découvre pas après.
  if (!opts.skipVisuals) {
    emit({ type: "note", text: `Images générées sur ce run : ${imagesUsed} / ${CHIMERA_MAX_IMAGES} au maximum.` });
  }

  // ── Relevés de page, en clair et de façon DÉTERMINISTE ───────────────────
  // Le modèle qui compile la spec peut résumer, couper ou reformuler : ce bloc
  // est ajouté par le code, jamais par le modèle, avec des marqueurs que le
  // constructeur sait retrouver page par page (builder/engine.ts).
  const transcriptBlock = frames.some(f => f.transcript)
    ? "\n\n---\n\nRELEVÉS DES PAGES RENDUES — LE SITE SE RECONSTRUIT D'APRÈS EUX\n"
      + "Chaque bloc ci-dessous décrit ce qui est RÉELLEMENT dessiné sur la page correspondante.\n"
      + "C'est la référence : mêmes sections dans le même ordre, mêmes chaînes au mot près, mêmes\n"
      + "positions, mêmes couleurs. Le prompt du cadre ne sert qu'à comprendre l'intention.\n\n"
      + frames.filter(f => f.transcript).map(f =>
          `[[CADRE-TRANSCRIT route=/${f.slug === "hero" || f.role === "hero" ? "" : f.slug} nom=${f.name} cadre=${f.n}]]\n${f.transcript}\n[[/CADRE-TRANSCRIT]]`,
        ).join("\n\n")
    : "";

  const specFull = (designLock ? `${designLock}\n\n---\n\n${spec}` : spec) + assetContract + transcriptBlock;

  const heroMockup: GenesisMockup | null = hero?.uiUrl
    ? (mockups.filter(m => m.url === hero.uiUrl)[0] ?? null)
    : null;

  const result: GenesisResult = {
    runId, brief, brandName,
    brandIdentity: JSON.stringify(concept?.typography ?? {}, null, 2),
    pendingFixes: heroMockup?.fixes ?? [],
    positioning: String(concept?.impossible_premise || ""),
    sensory: JSON.stringify(concept?.world_bible ?? {}, null, 2),
    association: JSON.stringify({ material: concept?.material, ritual: concept?.ritual, register: concept?.register }, null, 2),
    interaction: JSON.stringify({ pages, presentation: concept?.presentation, interface_register: concept?.interface_register }, null, 2),
    sceneGraph: concept,
    assetPlan: frameSheet,
    assets, critiques: [],
    segmentation: frames.map(f => `${f.n}:${f.slug} clean=${!!f.cleanUrl} bg=${!!f.bgUrl} cut=${!!f.cutUrl}`).join("\n"),
    designSystem, spec: specFull, mockups, mockup: heroMockup,
    phases, degraded, weaknesses, durationMs: Date.now() - t0,
  };
  emit({ type: "done", runId, result });
  return result;
}
