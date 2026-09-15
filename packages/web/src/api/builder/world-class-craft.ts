// ─── Base de craft "produits de classe mondiale" ─────────────────────────────
// Distillé de l'étude réelle des systèmes de design d'Apple, Stripe, Linear,
// Vercel (Geist), Airbnb et Notion — pas des impressions vagues, des règles
// concrètes et actionnables (valeurs px, courbes d'easing, ratios d'échelle)
// injectées dans CHAQUE génération pour que le rendu se rapproche du niveau
// de ces produits plutôt que d'un template générique.
//
// Objectif de ce fichier: donner à l'IA des CHIFFRES et des PATTERNS précis,
// pas des adjectifs ("beau", "premium") qu'elle ne sait pas transformer en CSS.

export const WORLD_CLASS_CRAFT = `## 🏆 CRAFT DE RÉFÉRENCE MONDIALE (Apple / Stripe / Linear / Vercel / Airbnb / Notion — patterns concrets à réutiliser)

Ces règles sont des TECHNIQUES RÉELLES observées sur ces produits, pas de l'inspiration vague. Applique-les comme des primitives, adaptées à la palette du design system du projet.

**1. ÉCHELLE TYPOGRAPHIQUE (Apple / Vercel Geist)**
- Échelle en base 4px, ratio ~1.25-1.333 entre crans: 12 / 14 / 16 / 20 / 25 / 32 / 40 / 56 / 72px. Ne saute jamais plus de 2 crans entre un titre et son sous-texte.
- Hero H1: 56-96px desktop (clamp(2.5rem, 6vw, 6rem)), poids 600-700, letter-spacing NÉGATIF (-0.02em à -0.04em sur les grandes tailles — Geist va jusqu'à -2.4px), line-height serré (1.05-1.1). C'est ce qui donne l'effet "Apple keynote" / "Geist display".
- Corps de texte: 16-18px, line-height 1.5-1.65, letter-spacing normal ou légèrement positif (0.01em) pour la lisibilité à cette taille.
- Une seule famille sans-serif pour tout le produit (jamais mélanger 2 fonts) + éventuellement une monospace pour du code/chiffres techniques (façon Geist Mono).

**2. FOND ET GRADIENTS (Stripe mesh gradient / Apple keynote glow)**
- Stripe: superposer 2-4 \`radial-gradient()\` translucides et flous en couches, PAS un simple linear-gradient plat. Positions décentrées (20% 20%, 80% 30%, 50% 100%) pour un effet organique, jamais symétrique.
- Chaque bloom de couleur est TRÈS flou (blur-3xl / 60-120px de flou) et à faible opacité (15-40%) pour rester subtil derrière le texte — jamais un aplat saturé plein cadre.
- Apple: fonds de section presque toujours unis (blanc pur, noir pur ou un gris très clair #F5F5F7) SAUF le héro produit qui peut avoir un glow ou un fond vidéo/produit — le contraste entre sections sombres et claires ALTERNÉES rythme le scroll (scrollytelling: chaque section a un fond différent du précédent, jamais 3 sections identiques d'affilée).
- Un seul mesh gradient par page maximum (dans le héro) — pas un fond animé sur chaque section, ça fatigue l'œil et nuit à la lisibilité.

**3. ESPACEMENT ET RYTHME VERTICAL (Vercel Geist / Linear)**
- Grille d'espacement stricte en base 4: 4/8/12/16/24/32/48/64/96/128px — jamais de valeur arbitraire type 13px ou 27px.
- Padding de section desktop: 96-160px vertical (py-24 à py-40), jamais moins de 64px entre deux sections majeures — c'est ce qui donne la sensation "haut de gamme" par opposition à un site tassé.
- Container max-width 1200-1280px avec padding horizontal 24-32px sur mobile — le contenu ne touche jamais le bord de l'écran.
- Linear: les listes/tableaux denses (issues tracker) utilisent une grille SERRÉE (8-12px de gap) — la densité varie donc selon le contexte: marketing = très aéré, outil de productivité = dense mais aligné au pixel près (jamais de désalignement de 1-2px entre colonnes).

**4. SURFACES, BORDURES, PROFONDEUR (Linear dark mode)**
- En sombre: fond de base quasi-noir teinté (#08090A à #0B0E14, jamais #000 pur), surfaces (cartes, panneaux) légèrement plus claires que le fond, distinguées par une BORDURE fine translucide (border-white/10 ou /8) plutôt que par une ombre portée — les ombres sont quasi invisibles en sombre, ce sont les bordures et les légers dégradés internes ("inner glow") qui créent la profondeur.
- En clair: l'inverse — ombres douces et diffuses (shadow-sm à shadow-lg avec beaucoup de flou et peu d'opacité, ex. \`0 8px 24px rgba(0,0,0,0.06)\`) plutôt que des bordures dures.
- Glassmorphism (nav sticky, modales): fond semi-transparent (bg-white/70 dark:bg-black/50) + \`backdrop-blur-xl\` + bordure 1px translucide. Utilisé avec parcimonie (nav, popovers), jamais sur des blocs de contenu pleine largeur.

**5. CARTES ET COMPOSANTS (Airbnb / Linear)**
- Carte Airbnb: image en haut ratio constant (4:3 ou 1:1) avec coins arrondis 12-16px sur l'image ELLE-MÊME (pas seulement le conteneur), contenu en dessous avec hiérarchie stricte (titre gras, sous-texte muted, prix en évidence). Au survol: la carte entière ne bouge pas violemment — seule l'image a un léger zoom (scale-105, transition 300-400ms) ou une ombre qui s'accentue légèrement. Jamais de rotation ou de rebond exagéré.
- Grilles de cartes: gap constant 16-24px, jamais de cartes de hauteurs incohérentes dans une même rangée (aligne les hauteurs via flex/grid, pas du contenu qui déborde).
- Boutons: hauteur cohérente sur tout le produit (36-44px), padding horizontal généreux (16-24px), un seul style de CTA principal répété partout (jamais 3 styles de bouton différents pour la même action).

**6. MOUVEMENT ET TRANSITIONS (Apple / Stripe timing réel)**
- Durées courtes pour le micro (hover, focus): 150-250ms. Durées moyennes pour l'apparition de contenu (fade-in, slide-up au scroll): 400-600ms. Jamais plus de 800ms pour une transition UI (au-delà ça semble lent/cassé).
- Easing: PAS de \`linear\` ni d'\`ease\` par défaut du navigateur — utilise des courbes cubic-bezier douces type \`cubic-bezier(0.16, 1, 0.3, 1)\` (ease-out prononcé, "easeOutExpo", utilisé largement chez Linear/Vercel) pour les apparitions, ou \`cubic-bezier(0.4, 0, 0.2, 1)\` (Material standard, bon compromis) pour les micro-interactions. Avec framer-motion: \`transition={{ duration: 0.5, ease: [0.16, 1, 0.3, 1] }}\`.
- Apparition de contenu au scroll: léger slide-up (translateY 12-24px → 0) + fade combinés, jamais un slide de plus de 40px (ça retarde trop la lecture) et jamais depuis les côtés (gauche/droite) pour du contenu vertical standard — verticalement seulement.
- Pas d'animation continue permanente qui capte l'attention en fond (pas de blob qui pulse sans arrêt) sauf un élément hero très ponctuel — le mouvement sert la hiérarchie, pas la décoration.

**7. IMAGERIE ET CONTENU (Apple product storytelling)**
- Apple: un produit hero est montré en GRAND (souvent plus grand que le viewport visible, coupé en bas) avec très peu de texte à côté — la photo EST le message. Le texte d'accompagnement est court (1 titre + 1 phrase), jamais un paragraphe à côté d'un produit hero.
- Structure "scrollytelling" B2C: alternance stricte image/texte, texte/image, sur fond alterné clair/sombre — chaque section raconte UN bénéfice, pas trois à la fois.
- Structure SaaS B2B (Stripe/Linear): hero avec proposition de valeur + CTA + capture d'écran produit ou mesh gradient, puis (seulement si de vrais clients/chiffres sont fournis) logos clients, puis grille de features avec icône+titre+phrase courte (jamais de paragraphe long dans une carte feature), puis preuve sociale/stats UNIQUEMENT si réelles — sinon FAQ ou démonstration de l'offre à la place, jamais de chiffre ni d'avis inventé —, puis CTA final répété.

**8. COHÉRENCE DE MARQUE SUR TOUT LE PARCOURS**
- Le même rayon de bordure, la même famille de police, la même palette de 1 accent + neutres réapparaissent identiques sur CHAQUE page — un produit "classe mondiale" se reconnaît car rien ne détonne d'une page à l'autre, pas parce qu'une page est spectaculaire et les autres négligées.
- Les états interactifs (hover, focus, disabled, loading) sont traités avec le même soin que l'état par défaut — c'est souvent ce détail (spinner cohérent, focus ring visible et stylé, disabled clairement grisé) qui distingue un produit soigné d'un prototype.`;
