# Storefront — prompts de cadres

Tu écris UN prompt d'image, pour UN cadre d'un site marchand fictif. Le prompt doit produire une
CAPTURE D'ÉCRAN de page de boutique en ligne, avec la navigation, les boutons, les prix et le texte
DÉJÀ DANS L'IMAGE. Jamais une illustration légendée après coup.

**Regarde les références avant de prompter.** `references/looks/` contient dix écrans réels choisis
par le propriétaire. Regarde-en au moins trois avec l'outil `look`, à chaque run, et nomme celui
dont ton cadre est le plus proche. C'est la barre de qualité cible, pas un moodboard à copier
chaîne par chaîne.

| fichier  | quoi en voler |
| -------- | ------------- |
| `01.png` | Mesh gradient doux plein cadre (bleu → rose → orange), barre haute blanche, titre centré énorme, une grande carte d'entrée arrondie, petit CTA pilule sombre en haut à droite. |
| `02.png` | Même squelette sur un lavis *bleu ciel pâle → blanc* : nav pilule blanche flottante avec wordmark + liens déroulants, pilule d'annonce au-dessus du titre, chips de suggestion sous la carte, un bouton accent lime. |
| `03.png` | Champ de couleur pur — lilas à pêche à lueur orange, rien d'autre — avec une seule barre arrondie sombre flottant au milieu, rangée d'icônes dedans. La preuve qu'un objet sur un dégradé suffit. |
| `04.png` | Ciel photographique derrière un titre display noir *énorme* qui chevauche le sujet, petite nav pilule flottant décollée du bord haut, une carte de verre dépoli, un minuscule CTA pilule avec un point. |
| `05.png` | Version pièce sombre : page quasi noire, fine barre latérale gauche, titre centré, champ d'entrée arrondi sombre, un unique ruban de lumière soyeux comme seule imagerie. |
| `06.png` | Sombre + un accent chaud (orange) : une expression colorée dans le titre, arc d'horizon lumineux en bas, carte d'entrée sombre, rangée de petites cartes de features sous la ligne de flottaison. |
| `07.png` | UI d'éditeur : canevas sombre, display type rempli en dégradé, barre de commande flottante en bas avec chips de contrôle et un bouton d'action jaune acide. |
| `08.png` | Registre illustration granuleuse — couleurs complémentaires franches et plates (cobalt/orange), grain lourd. À utiliser quand le monde doit sembler dessiné, pas photographié. |
| `09.png` | Photo produit propre : sujet sur un mur pâle et égal, lumière douce, aucun accessoire, aucun drame. L'extrémité calme de la gamme. |
| `10.png` | App desktop dense : table de données, barre latérale, pilules de statut colorées, vrais contrôles. Pour une page type tableau de bord, jamais pour un hero. |

## Règle zéro — la page est une surface dessinée, pas une photographie

Aucune des dix références de ce skill n'est une photo cinématique plein cadre avec une interface
posée dessus. Leur fond est DESSINÉ : un mesh gradient saturé, un champ de couleur, une
illustration granuleuse, un canevas quasi noir avec une seule lueur. La photographie, quand elle
existe, vit À L'INTÉRIEUR du layout : un produit détouré posé sur le dégradé, ou une image dans une
carte arrondie.

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

## Le squelette, dans l'ordre

Presque toutes les références sont ces cinq parties :

1. **BARRE HAUTE** — soit blanche/translucide sur toute la largeur, soit une BARRE PILULE FLOTTANTE
   avec 18-22px d'air au-dessus. Wordmark + petite marque à gauche ; 4-6 liens de nav à 13-14px
   centrés ; à droite un lien fantôme et UN bouton pilule plein dans la couleur d'accent. Pour une
   boutique, le groupe de droite est « Search » · « Account » · « Bag (0) ».
2. **PILULE D'ANNONCE** (optionnelle) — petite capsule arrondie centrée au-dessus du titre : une
   étiquette colorée, une phrase courte, une flèche.
3. **BLOC DE TITRE, CENTRÉ** — une très grande ligne, 56-96px, sans-serif géométrique medium ou
   semibold, tracking serré, sombre sur clair ou blanc sur sombre. Une sous-ligne de 15-17px en
   dessous, grise, une phrase. Option : une expression du titre dans la couleur d'accent.
4. **L'OBJET HERO** — exactement un élément focal sous le titre, centré, avec beaucoup d'air
   autour : une grande carte arrondie (rayon 20-28px) qui est un champ, un panneau produit, un
   bloc de prix ou un panneau de verre ; ou le produit lui-même posé libre sur le dégradé. Un petit
   bouton circulaire ou pilule à l'intérieur, dans l'accent.
5. **RANGÉE DE CHIPS** — 3-6 petits chips arrondis en contour sous l'objet hero, puis
   éventuellement une rangée de 3-4 petites cartes tout en bas du cadre, à moitié coupées par le
   bord pour prouver que la page défile.

## Ce qui fait lire « logiciel de 2026 »

- Centré, contenu, aéré. Le contenu vit dans une colonne de ~1100-1200px avec de larges marges
  vides. Environ 45-55% du cadre est vide. L'encombrement est le mode d'échec principal.
- Rayons et douceur : pilules 999px pour les boutons et la nav, 20-28px pour les cartes, 12-16px
  pour les chips. Ombres larges, douces et faibles — jamais une ombre portée dure, jamais une boîte
  grise de 1px. Chips carrés à coins durs = refusé.
- UNE couleur d'accent, utilisée trois fois au maximum : le bouton, une petite étiquette, une
  lueur.
- La typo est le design. Une sans-serif géométrique, deux tailles qui comptent : le titre énorme et
  le petit tout-le-reste. Pas de nostalgie serif, pas de tracking large.
- PETITE UI, GRAND TITRE. Nav 13-14px, chips 12-13px, boutons 13-14px. Le titre fait 5-6× la
  taille de la nav. C'est ce rapport qui rend la capture crédible.
- La boutique appartient au monde par le VOCABULAIRE, jamais par la structure : les libellés, la
  devise, les lignes de spec et la note de retour sont écrits dans la langue du monde, mais la
  barre reste une barre, les chips restent des chips, le sac compte les articles, et chaque prix
  est visible.
- Lisibilité d'abord : gare le titre sur la zone la plus calme, ou sur un panneau dépoli. Texte
  sombre sur fond clair, blanc sur fond saturé ou sombre. L'accent apparaît une fois dans l'UI et
  une fois dans la scène, pour que l'interface appartienne à l'image.

## Ordre du prompt, obligatoire

Cadre → Direction artistique → Loi du monde → Produit & matière → Lumière → Réserve de composition
→ Palette → Interface → Rendu.

La phrase de direction artistique est IDENTIQUE dans chaque prompt de cadre, recopiée verbatim.

## Gabarit

Remplis-le, garde l'ordre, retire ce que le cadre n'a pas :

« Screenshot of a modern e-commerce website page, full-bleed browser viewport, no browser chrome,
no device frame, no mockup, no phone — the image is the page itself. [Direction artistique
verbatim.] [Le monde en termes physiques, sa loi brisée énoncée comme si elle était ordinaire.] [Le
produit, sa matière inventée, sa pose exacte, le rituel autour.] [Éclairage nommé, toujours diurne :
direction, dureté, température, où tombe l'ombre — et quelle est la source impossible. High-key et
lumineux, ombres colorées ouvertes, pas de noir, pas de nuit.] Composition: centred column, roughly
half the frame empty, the product presented as [la présentation choisie — jamais flottante sauf si
la loi brisée est la gravité]. Background: [dégradé / champ / illustration décrit précisément].
Palette #___, #___, accent #___. [Rendu spécifique au médium : 85mm photographic, ou painted matte
with grain, ou flat illustration — jamais « digital art ».] [Puis l'interface, moderne et
contemporaine : barre pilule flottante ou barre haute affleurante, titre centré énorme, une carte
arrondie focale, une rangée de chips, un bouton pilule plein dans l'accent — net, vectoriel, petit
texte, ombres larges et douces, avec les chaînes LITTÉRALES du copy deck placées par position.]
Only these strings, spelled exactly, nothing else anywhere. »

## Règles dures

- Respecte le budget de chaînes du cadre (hero ≈ 8, page de défilement ≈ 16-20, page produit ≈ 12,
  lookbook ≈ 3). Au-delà, les lettres se déforment : coupe la copie, ne te bats pas avec le modèle.
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

## Sortie

Le prompt d'image et RIEN d'autre. Pas de préambule, pas de guillemets autour, pas de markdown, pas
de commentaire. Un seul paragraphe dense, en anglais (le générateur d'images travaille mieux en
anglais), mais les CHAÎNES DE TEXTE À AFFICHER sont recopiées telles quelles dans la langue du copy
deck.
