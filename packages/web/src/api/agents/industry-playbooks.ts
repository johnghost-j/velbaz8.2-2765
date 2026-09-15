// ─── Playbooks sectoriels (meilleurs du monde, par TYPE d'entreprise) ────────
// known-references.ts couvre les PRODUITS NOMMÉS ("comme Lovable", "comme
// Notion"). Ce fichier couvre l'AUTRE cas, bien plus fréquent : une idée
// d'entreprise générique sans nom de référence ("une salle de sport", "un
// cabinet dentaire", "une marque de vêtements", "une agence immobilière"…).
//
// Pour CHAQUE grand type d'entreprise du monde réel, on injecte trois choses :
//  1. QUI sont les meilleurs acteurs réels du secteur (ce qu'ils font
//     concrètement, pas juste leur nom),
//  2. les PATTERNS produit/design/conversion qu'ils ont en commun,
//  3. les DÉFAUTS À ÉVITER — les erreurs récurrentes, documentées et
//     mesurées sur des vrais sites du secteur (audits Baymard, NN/g, retours
//     de conversion), qui font perdre la confiance ou les conversions.
// But : que Velbaz construise un site/app au niveau de ces références, jamais
// un template générique, et qu'il évite d'entrée les pièges classiques.
//
// Chaque `pitfalls` est issu de recherches réelles sur les meilleures et les
// pires pratiques du secteur (mises à jour 2025-2026), pas d'intuition.

export interface IndustryPlaybook {
  /** Mots-clés (normalisés) qui déclenchent ce playbook. Substring match. */
  aliases: string[];
  name: string;
  /** Brief injecté dans les prompts de plan + design (forces à imiter). */
  brief: string;
  /** Défauts/anti-patterns documentés du secteur à ne JAMAIS reproduire. */
  pitfalls: string;
}

const PLAYBOOKS: IndustryPlaybook[] = [
  {
    aliases: ["saas", "startup tech", "logiciel", "application web", "outil en ligne", "plateforme b2b", "software"],
    name: "SaaS / Logiciel B2B",
    brief: `**MEILLEURS DU SECTEUR** : Stripe (paiements, docs impeccables), Linear (gestion de projet, vitesse perçue), Notion (espace de travail), Vercel (dev tools), HubSpot (marketing/CRM).
**PATTERNS COMMUNS** : hero avec proposition de valeur en 1 phrase + capture d'écran produit réelle ou mesh gradient + CTA "Essai gratuit"/"Commencer" (jamais "En savoir plus" en CTA principal). Bandeau de logos clients juste sous le hero UNIQUEMENT si de vrais clients sont fournis (sinon supprimer ce bandeau — aucun logo inventé). Grille de features avec icône + titre court + 1 phrase (jamais de pavé de texte). Section preuve sociale seulement avec des éléments RÉELS fournis (aucune stat ni témoignage inventé ; sinon la remplacer par une FAQ ou une démonstration de l'offre). Page pricing avec 3 plans, le plan du milieu mis en avant visuellement, essai gratuit sans CB si possible. Footer riche (produit, ressources, société, légal). Le produit lui-même doit être un VRAI espace de travail fonctionnel (CRUD), pas juste une vitrine.`,
    pitfalls: `**DÉFAUTS À ÉVITER** : hero "énigme" — un titre poétique/abstrait qui ne dit pas ce que fait le produit (on doit comprendre l'offre en 5 secondes). CTA principal mou ("En savoir plus", "Découvrir") au lieu d'une action ("Commencer gratuitement"). Zéro preuve : pas de logos, pas de chiffres, pas de témoignage réel → aucune confiance. Surcharge d'informations dans une seule section (mur de texte, 12 features d'affilée). Site "construit comme un projet de dev" et non comme une page de vente (jargon technique en hero, pas de bénéfice client). Pricing caché ou "Contactez-nous" partout. Pas d'optimisation mobile (CTA hors écran, formulaires illisibles).`,
  },
  {
    aliases: ["e-commerce", "ecommerce", "boutique en ligne", "vente en ligne", "marque de vetements", "marque de mode", "sneakers", "cosmetique", "bijoux", "accessoires de mode"],
    name: "E-commerce / Marque produit",
    brief: `**MEILLEURS DU SECTEUR** : Shopify (plateforme), Nike/Glossier/Allbirds (marques DTC), Zara (mode rapide). Points communs des meilleures boutiques DTC (Glossier, Allbirds, Warby Parker) : photographie produit soignée sur fond neutre, storytelling de marque authentique, avis clients visibles partout (étoiles + nombre), politique de retour claire et rassurante.
**PATTERNS COMMUNS** : page d'accueil = vitrine produit (pas de dashboard) avec héro produit phare, grille catégories, best-sellers. Page produit: galerie zoomable, sélecteur taille/couleur en direct, avis clients, produits similaires, bouton "Ajouter au panier" fixe/sticky sur mobile. Panier latéral (drawer) sans quitter la page. Checkout en 1-2 étapes max, badges de confiance (paiement sécurisé, livraison, retours). Newsletter avec code promo à l'inscription. Barre de livraison gratuite ("Plus que 20€ pour la livraison gratuite").`,
    pitfalls: `**DÉFAUTS À ÉVITER** (audits Baymard : 62% des sites e-commerce ont une UX de fiche produit médiocre) : images produit basse résolution, non zoomables ou sur fond incohérent. Description produit "fluffy"/marketing creux au lieu d'infos concrètes (matière, dimensions, entretien). Avis clients absents ou cachés. Frais de livraison surprises révélés seulement au checkout (première cause d'abandon panier). Compte obligatoire forcé avant l'achat (proposer le guest checkout). Checkout à rallonge multi-pages. Navigation surchargée (trop de catégories/dropdowns). Pas de bouton "Ajouter au panier" sticky sur mobile. Politique de retour introuvable.`,
  },
  {
    aliases: ["restaurant", "cafe", "brasserie", "bistrot", "pizzeria", "traiteur", "boulangerie", "patisserie"],
    name: "Restaurant / Food service",
    brief: `**MEILLEURS DU SECTEUR** : sites de groupes de restaurants premium (Big Mamma, Noma, Eleven Madison Park) — photographie du plat en pleine largeur, ambiance immersive, réservation en 2 clics. Toast/OpenTable pour la logique de réservation.
**PATTERNS COMMUNS** : hero avec photo immersive du lieu/plat signature + overlay sombre pour lisibilité du texte. Menu clair et scannable (catégories, prix, description courte, badges allergènes/végé). Réservation de table qui PERSISTE (date, heure, nombre de couverts, données via data.create) — pas juste un lien tel:. Galerie photo (ambiance, plats). Horaires et localisation visibles immédiatement (carte, adresse cliquable). Avis clients. Menu à emporter/livraison si pertinent avec commande réelle (panier + checkout).`,
    pitfalls: `**DÉFAUTS À ÉVITER** (erreurs n°1 des sites de restaurant) : menu en PDF téléchargeable au lieu d'un menu HTML natif et responsive. Musique/vidéo en autoplay. Page d'intro "splash" avant d'accéder au site. Bouton de réservation absent ou noyé (il doit être visible et sticky). Horaires, adresse et téléphone introuvables (doivent être immédiats). Menu obsolète ou sans prix. Images de plats en stock générique plutôt que du vrai établissement. Temps de chargement long à cause d'images non compressées. Menu surchargé et illisible sans hiérarchie visuelle.`,
  },
  {
    aliases: ["immobilier", "agence immobiliere", "promoteur immobilier", "location de logement", "syndic"],
    name: "Immobilier",
    brief: `**MEILLEURS DU SECTEUR** : Zillow/SeLoger/Redfin (recherche de biens avec filtres avancés + carte interactive), Airbnb (fiches logement immersives).
**PATTERNS COMMUNS** : recherche principale = barre de filtres (ville, prix, surface, pièces, type de bien) au-dessus d'une grille/carte de biens. Fiche bien: galerie photo grand format, prix en évidence, caractéristiques en icônes (surface, pièces, étage, DPE), carte de localisation, formulaire de contact/visite qui persiste (data.create), biens similaires. Espace "mes favoris" et "mes visites programmées". Simulateur de financement/mensualités si pertinent. Jamais de dashboard de gestion interne sauf demande explicite d'outil agence.`,
    pitfalls: `**DÉFAUTS À ÉVITER** : site non responsive alors que la majorité des recherches immobilières se font sur mobile. Fiches biens incomplètes ou photos basse qualité/peu nombreuses. Aucun CTA clair (prise de contact/visite) sur la fiche. Homepage encombrée (sidebars chargés, bannières clignotantes, blocs de texte denses). Pop-ups intrusifs dès l'arrivée. Recherche sans vrais filtres ou sans carte. Pages lentes (images énormes non optimisées). Navigation confuse. Prix ou DPE non affichés en évidence.`,
  },
  {
    aliases: ["salle de sport", "fitness", "coach sportif", "gym", "musculation", "cours de fitness", "yoga", "pilates"],
    name: "Fitness / Salle de sport",
    brief: `**MEILLEURS DU SECTEUR** : Peloton (communauté + suivi de perf), ClassPass/Mindbody (réservation de cours multi-salles), Nike Training Club (programmes).
**PATTERNS COMMUNS** : hero énergique (photo/vidéo d'entraînement, typographie forte, ton motivant). Planning des cours en grille horaire avec réservation de créneau qui persiste (data.create: cours, coach, place restante). Fiches coachs/profs avec spécialité. Page abonnements/tarifs (mensuel, pass séance, engagement) avec CTA "Rejoindre" branché checkout(). Suivi personnel si l'app le permet (séances réservées, progression) sur un espace membre connecté (useAuth). Galerie des installations. Essai gratuit/séance découverte mis en avant.`,
    pitfalls: `**DÉFAUTS À ÉVITER** (les "7 erreurs mortelles" des sites de gym) : hero négligé/générique sans énergie ni promesse claire. Aucune preuve sociale (avant/après, témoignages, nombre de membres). Navigation compliquée pour trouver horaires et tarifs. Site lent. Tarifs cachés ou absents (les prospects veulent le prix avant de venir). Planning des cours statique/PDF au lieu d'une grille réservable. Pas de CTA "Essai gratuit"/"Séance découverte" mis en avant. Téléphone/adresse difficiles à trouver.`,
  },
  {
    aliases: ["clinique", "cabinet dentaire", "dentiste", "medecin", "clinique medicale", "hopital", "sante", "kinesitherapeute", "osteopathe", "psychologue"],
    name: "Santé / Clinique",
    brief: `**MEILLEURS DU SECTEUR** : Zocdoc (prise de RDV médical instantanée avec créneaux réels), One Medical (parcours patient clair et rassurant), Doctolib (référence FR: recherche par spécialité/ville + créneaux en direct).
**PATTERNS COMMUNS** : ton rassurant et professionnel (jamais tape-à-l'œil), palette sobre (blanc/bleu-vert clinique), photos de l'équipe réelles (pas de stock générique visible). Prise de RDV en ligne = fonctionnalité CŒUR: sélection du motif de consultation → créneau disponible → confirmation, données persistées via data.create (patient, date, motif). Pages par spécialité/praticien. Infos pratiques immédiates (adresse, horaires, urgences, mutuelles/assurances acceptées). Respect absolu de l'exactitude médicale : aucune promesse de guérison, aucun contenu médical inventé.`,
    pitfalls: `**DÉFAUTS À ÉVITER** : template générique bourré de photos stock impersonnelles (les patients veulent voir la VRAIE équipe/le vrai lieu). Coordonnées et téléphone cachés (doivent être sur chaque page). Pas de prise de RDV en ligne (obliger à appeler aux heures de bureau fait fuir). Non responsive / "pincer-zoomer" pour lire. Chargement lent (vidéos lourdes). Texte trop petit et illisible. Jargon médical anxiogène au lieu d'un ton rassurant. Promesses de résultat/guérison (interdites, déontologie). Contenu médical inventé.`,
  },
  {
    aliases: ["ecole", "formation en ligne", "e-learning", "cours en ligne", "universite", "academie", "bootcamp", "organisme de formation"],
    name: "Éducation / E-learning",
    brief: `**MEILLEURS DU SECTEUR** : Coursera/Udemy (catalogue de cours + progression), Duolingo (gamification, streaks, motivation quotidienne), Khan Academy (accès gratuit, clarté pédagogique).
**PATTERNS COMMUNS** : catalogue de cours/formations en grille avec filtres (niveau, catégorie, durée). Fiche cours: programme détaillé, formateur, avis, prix, bouton "S'inscrire" (checkout si payant). Espace apprenant connecté: mes cours, progression (barre %, badges), prochaine leçon à reprendre. Éléments de gamification si pertinent (streaks, points, certificats en fin de parcours). Preuve sociale forte (nombre d'étudiants, taux de réussite, témoignages avec résultat concret).`,
    pitfalls: `**DÉFAUTS À ÉVITER** : objectifs pédagogiques vagues ou absents (l'apprenant doit savoir ce qu'il saura faire à la fin). Fiche cours = mur de texte sans programme structuré (le "cours encyclopédie"). Zéro interactivité ni feedback (le "cours zombie"). Pas de preuve d'efficacité (résultats, avis concrets). Prix flou. Aucune progression visible dans l'espace apprenant (barre %, reprendre où on s'est arrêté). Navigation verrouillée/rigide. Non accessible (contrastes, navigation clavier). Interface non responsive.`,
  },
  {
    aliases: ["hotel", "voyage", "agence de voyage", "tourisme", "location de vacances", "auberge", "resort"],
    name: "Voyage / Hôtellerie",
    brief: `**MEILLEURS DU SECTEUR** : Booking.com (recherche + comparateur ultra efficace), Airbnb (fiches logement immersives + confiance via avis), Marriott (fidélité, expérience premium).
**PATTERNS COMMUNS** : recherche principale (destination, dates, voyageurs) en hero sur fond photo immersif. Grille de résultats avec prix, note, photo, équipements clés. Fiche établissement: galerie photo grand format, équipements en icônes, carte, avis détaillés, réservation avec calcul de prix live (nuits × tarif + taxes) persistée via data.create + checkout() pour l'acompte. Urgence/rareté honnête si pertinent ("plus que 2 chambres disponibles" — seulement si réellement calculé depuis les données, jamais inventé).`,
    pitfalls: `**DÉFAUTS À ÉVITER** (tueurs de conversion hôtel) : moteur de réservation absent "above the fold" ou renvoyant vers un site tiers (perte de confiance et de résultats directs). Pages lentes à cause d'images de propriété non compressées (cause n°1 de perte de réservation). Site traité comme une brochure statique sans booking réel. Processus de réservation complexe/multi-étapes. Pas de mobile-first (la plupart des recherches voyage sont mobiles). Rareté inventée ("plus que 1 chambre" faux) qui détruit la confiance. Avis absents.`,
  },
  {
    aliases: ["fintech", "banque en ligne", "neobanque", "assurance", "investissement", "trading", "crypto", "paiement en ligne"],
    name: "Finance / Fintech",
    brief: `**MEILLEURS DU SECTEUR** : Stripe (confiance via clarté technique), Revolut/N26/Monzo (néobanques, onboarding fluide), Wise/Mercury (transparence des frais affichée noir sur blanc), Robinhood (simplicité de l'investissement grand public).
**PATTERNS COMMUNS** : confiance = priorité n°1 — design sobre, chiffres et frais TOUJOURS explicites (jamais de frais cachés suggérés), badges de sécurité/régulation visibles PRÈS des CTA (pas enterrés dans le footer). Séquence de confiance : qualité visuelle → signaux réglementaires → transparence de l'équipe → preuve produit → chiffres. Dashboard compte (solde, transactions, graphique d'évolution) comme cœur fonctionnel pour un produit grand public. Onboarding en étapes claires. Simulateurs (épargne, prêt, conversion) avec calcul live via useState. Champs sensibles masqués, icône cadenas. Aucune promesse de gain irréaliste ; vocabulaire financier exact et prudent.`,
    pitfalls: `**DÉFAUTS À ÉVITER** : badges de sécurité/régulation enterrés dans le footer au lieu d'être près des CTA de signup. Frais cachés ou suggérés flous (les meilleurs affichent les frais noir sur blanc, comme Wise). Promesses de gains irréalistes (surtout crypto/trading) — illégal et destructeur de confiance. Design tape-à-l'œil qui sape la crédibilité. Absence de signaux de sécurité (cadenas, champs masqués, mention chiffrement). Pas de transparence sur l'équipe/la société. Jargon financier flou. Onboarding long et opaque.`,
  },
  {
    aliases: ["salon de coiffure", "institut de beaute", "spa", "esthetique", "manucure", "barbier", "onglerie"],
    name: "Beauté / Bien-être",
    brief: `**MEILLEURS DU SECTEUR** : Fresha/Mindbody (réservation beauté en ligne, référence du secteur), Sephora (vitrine produit + expertise conseil), Glossier (communauté + esthétique épurée).
**PATTERNS COMMUNS** : esthétique soignée et chaleureuse (photos des prestations/résultats, palette douce). Catalogue de prestations avec durée + prix affichés clairement. Réservation de créneau par prestation/praticien qui persiste (data.create), rappel des disponibilités en direct. Fiches équipe (spécialité, photo). Galerie avant/après ou réalisations. Programme de fidélité si pertinent. Vente de produits associés en complément (mini e-commerce) si le business le prévoit.`,
    pitfalls: `**DÉFAUTS À ÉVITER** : expérience de réservation mobile qui n'est pas réellement mobile (formulaire minuscule, calendrier inutilisable au doigt). Prix et durées des prestations absents (les clients veulent savoir avant de réserver). Pas de réservation en ligne du tout (obliger à téléphoner). Galerie de réalisations générique/stock au lieu du vrai travail. Site beau mais qui ne guide pas vers la réservation (le CTA "Réserver" doit être omniprésent). Avis clients absents ou non gérés. Navigation confuse.`,
  },
  {
    aliases: ["marque de voiture", "concessionnaire", "moto", "automobile", "vehicule electrique"],
    name: "Automobile",
    brief: `**MEILLEURS DU SECTEUR** : Tesla (showroom épuré, configurateur en temps réel, essai/réservation en ligne), Porsche (photographie produit haut de gamme), Carvana (parcours d'achat 100% en ligne et transparent).
**PATTERNS COMMUNS** : showroom = page d'accueil listant les modèles en grand format visuel, jamais un dashboard de gestion. Layout aéré, beaucoup de blanc, grandes images, sections claires (description, caractéristiques, véhicules similaires). Page modèle: galerie, caractéristiques techniques, prix de départ, DEUX CTA clairs (demande d'info + réservation d'essai). CONFIGURATEUR interactif (couleur, finition, options) avec PRIX RECALCULÉ EN DIRECT (useState) et sauvegarde de la configuration (data.create). Réservation d'essai routier ou pré-commande avec acompte (checkout() si applicable). Localisateur de concessions. Simulateur de financement.`,
    pitfalls: `**DÉFAUTS À ÉVITER** : photos de véhicules peu nombreuses ou basse qualité (le média produit est décisif dans l'auto). Aucun CTA clair sur la fiche modèle (chaque véhicule doit avoir formulaire de contact ET réservation d'essai). Interface encombrée/complexe au lieu d'un layout épuré type showroom. Configurateur sans prix recalculé en direct. Prix de départ caché. Site lent (galeries lourdes). Pas de personnalité (aucune histoire ni équipe). Pas de mobile-first.`,
  },
  {
    aliases: ["cabinet d avocat", "avocat", "notaire", "expert comptable", "cabinet comptable", "conseil juridique"],
    name: "Services juridiques / Conseil",
    brief: `**MEILLEURS DU SECTEUR** : grands cabinets internationaux (Clifford Chance, Baker McKenzie) pour le sérieux institutionnel, et cabinets modernes type LegalZoom/Rocket Lawyer pour l'accessibilité et la clarté des offres.
**PATTERNS COMMUNS** : ton sobre et crédible (typographie classique, palette neutre bleu marine/gris/blanc, PAS de gradients flashy). Clarté = conversion : dire clairement ce qu'on fait et pour qui, en langage normal. Domaines d'expertise clairement listés. Profils des avocats/associés (parcours, spécialité, photo professionnelle). Prise de rendez-vous/consultation qui persiste (data.create). Articles/actualités juridiques pour asseoir l'expertise (blog). Formulaire de contact confidentiel mis en avant. Aucune promesse de résultat judiciaire (déontologie).`,
    pitfalls: `**DÉFAUTS À ÉVITER** : jargon juridique impénétrable au lieu d'un langage clair orienté client. Site daté/austère qui décrédibilise un cabinet pourtant compétent. Design encombré, contenu "filler" creux. Pas de profils d'avocats avec vraies photos et parcours. Aucun CTA de prise de contact/consultation clair. Promesses de résultat judiciaire (interdites). Titres et paragraphes trop longs (préférer titres accrocheurs + phrases courtes). Absence de signaux de sérieux/confidentialité.`,
  },
  {
    aliases: ["ong", "association caritative", "organisation a but non lucratif", "fondation", "nonprofit", "collecte de dons"],
    name: "Association / ONG",
    brief: `**MEILLEURS DU SECTEUR** : charity: water (storytelling d'impact chiffré et transparent), Doctors Without Borders/MSF (urgence + confiance institutionnelle).
**PATTERNS COMMUNS** : mission énoncée en une phrase forte dès le hero, avec photo/vidéo d'impact réel (pas de stock générique froid). Chiffres d'impact mis en avant (nombre de bénéficiaires, fonds collectés) — toujours crédibles, jamais inventés au hasard. Bouton "Faire un don" omniprésent et visuellement distinct, montants suggérés + montant libre, checkout() pour le paiement. Don qui reste SUR le site (les redirections externes créent de la méfiance). Transparence (répartition des fonds, rapports annuels). Bénévolat: formulaire d'inscription qui persiste.`,
    pitfalls: `**DÉFAUTS À ÉVITER** : formulaire de don long, création de compte obligatoire ou redirection vers un site tiers pour donner (chaque étape/friction fait chuter les dons). CTA "Faire un don" faible ou noyé (doit être omniprésent et distinct). Homepage surchargée sans hiérarchie. Impact non montré (pas de chiffres, pas d'histoires concrètes de bénéficiaires). Photos stock froides au lieu d'images réelles de terrain. Non responsive. Chiffres d'impact inventés (destructeur de confiance). Pas de transparence sur l'usage des fonds.`,
  },
  {
    aliases: ["agence marketing", "agence de communication", "agence digitale", "agence de design", "agence web", "agence creative"],
    name: "Agence (marketing / design / digital)",
    brief: `**MEILLEURS DU SECTEUR** : Pentagram (portfolio créatif haut de gamme, mise en page audacieuse), Huge/AKQA (études de cas immersives orientées résultats chiffrés).
**PATTERNS COMMUNS** : portfolio de projets/études de cas comme cœur du site — grandes images, mise en page éditoriale asymétrique, résultats chiffrés par projet (+40% de conversion, etc.). Page services claire (ce que l'agence fait concrètement, pas de jargon vide). Équipe avec vraies personnalités. Processus de travail expliqué en étapes. CTA "Démarrer un projet" avec formulaire de brief qui persiste (data.create), pas juste une adresse email.`,
    pitfalls: `**DÉFAUTS À ÉVITER** : études de cas sans résultats chiffrés (juste de jolies images sans "avant/après" ni impact business). Jargon marketing vide qui ne dit pas ce que l'agence fait concrètement. Branding incohérent d'une page à l'autre (une agence qui se vend le design DOIT être irréprochable). Trop de pop-ups. Projets "filler" ou portfolio trop mince. CTA générique (mailto:) au lieu d'un vrai formulaire de brief. Navigation confuse. Pas de vraie équipe/personnalité.`,
  },
  {
    aliases: ["livraison", "logistique", "transport de marchandise", "flotte de vehicule", "coursier"],
    name: "Logistique / Livraison",
    brief: `**MEILLEURS DU SECTEUR** : Uber Eats/DoorDash (suivi de commande en temps réel, UX de commande ultra rapide), FedEx/UPS (suivi de colis clair et rassurant).
**PATTERNS COMMUNS** : suivi de commande/colis avec statuts explicites (texte + icône, jamais couleur seule): "En préparation", "En route", "Livré". Estimation de délai affichée. Formulaire de demande de livraison/devis qui persiste (data.create) avec calcul de prix si applicable (distance/poids via useState). Zone de couverture (carte). Espace client avec historique des livraisons.`,
    pitfalls: `**DÉFAUTS À ÉVITER** : statut de livraison indiqué par la couleur seule (illisible pour daltoniens — toujours texte + icône). Aucune estimation de délai. Pas de suivi en temps réel ni de numéro de suivi. Zone de couverture floue. Formulaire de devis sans calcul de prix. Navigation confuse, site lent. Pas d'espace client avec historique. Absence d'infos de contact en cas de problème.`,
  },
  {
    aliases: ["media", "journal en ligne", "magazine", "blog d actualite", "site d information", "newsletter payante"],
    name: "Média / Publishing",
    brief: `**MEILLEURS DU SECTEUR** : The New York Times / Le Monde (hiérarchie éditoriale forte, typographie de lecture soignée), Substack (newsletter + abonnement simple).
**PATTERNS COMMUNS** : page d'accueil = une du journal, hiérarchie visuelle stricte (article phare en grand, secondaires en grille), typographie de lecture optimisée (serif ou sans-serif très lisible, line-height généreux). Articles avec vraie mise en page éditoriale (chapô, sous-titres, images légendées). Abonnement/paywall si pertinent (checkout() pour l'abonnement). Newsletter avec inscription réelle (POST /subscribe). Recherche et catégories/rubriques claires.`,
    pitfalls: `**DÉFAUTS À ÉVITER** : mur de publicités/pop-ups qui masquent le contenu dès l'arrivée. Typographie de lecture négligée (texte petit, line-height serré, contraste faible) alors que c'est le cœur du produit. Homepage sans hiérarchie (tout au même niveau). Articles en pavé sans chapô, sous-titres ni images légendées. Paywall agressif avant toute valeur. Navigation par rubriques absente. Temps de chargement long. Newsletter en simple lien mailto au lieu d'une vraie inscription.`,
  },
  {
    aliases: ["jeu video", "studio de jeu", "jeu mobile", "jeu en ligne"],
    name: "Gaming",
    brief: `**MEILLEURS DU SECTEUR** : Riot Games/Epic Games (pages de jeu immersives, vidéo/trailer en hero, univers visuel fort), Discord (communauté de joueurs).
**PATTERNS COMMUNS** : hero visuellement spectaculaire (trailer/artwork plein cadre, typographie impactante, ambiance sombre souvent). Fiche jeu: trailer, galerie de screenshots, configuration requise, plateformes disponibles, bouton "Jouer/Télécharger". Communauté (forum, classements, profils joueurs) si le produit est un jeu jouable dans l'app. Événements/actualités du jeu.`,
    pitfalls: `**DÉFAUTS À ÉVITER** : hero fade/générique sans artwork ni trailer (le gaming vit de l'immersion visuelle). Pas de screenshots ni de vidéo de gameplay. Configuration requise et plateformes absentes. CTA de téléchargement/jeu peu visible. Univers visuel incohérent. Site lent malgré des assets lourds non optimisés. Aucune dimension communautaire (classements, actus) alors que le public l'attend.`,
  },
  {
    aliases: ["marketplace", "place de marche", "plateforme de mise en relation"],
    name: "Marketplace (deux faces)",
    brief: `**MEILLEURS DU SECTEUR** : Airbnb (hôtes/voyageurs), Etsy (vendeurs artisans/acheteurs), Uber (chauffeurs/passagers) — tous résolvent la confiance entre 2 parties inconnues.
**PATTERNS COMMUNS** : DEUX parcours distincts et clairs dès le hero (ex: "Je cherche" vs "Je propose"). Fiches offres avec avis/notes pour instaurer la confiance. Recherche + filtres puissants. Processus de mise en relation ou réservation qui persiste (data.create), paiement sécurisé via checkout() avec répartition claire (frais de service affichés). Espace vendeur/prestataire pour gérer ses annonces (CRUD via data.*).`,
    pitfalls: `**DÉFAUTS À ÉVITER** : les deux faces (offre/demande) mélangées et confuses dès l'accueil (chaque public doit voir son parcours immédiatement). Aucun mécanisme de confiance (pas d'avis, pas de notes, pas de vérification) — fatal pour une marketplace entre inconnus. Frais de service cachés jusqu'au paiement. Recherche/filtres faibles. Fiches d'offre pauvres. Pas d'espace vendeur pour gérer ses annonces. Branding incohérent qui réduit la confiance. Trop de pop-ups.`,
  },
  {
    aliases: ["reseau social", "communaute en ligne", "forum", "application de rencontre"],
    name: "Réseau social / Communauté",
    brief: `**MEILLEURS DU SECTEUR** : Instagram (fil visuel, simplicité de publication), Reddit/Discord (communautés thématiques, modération), Bumble/Hinge (mise en relation avec profils soignés).
**PATTERNS COMMUNS** : fil de contenu (posts, likes, commentaires) branché sur data.* en vrai CRUD, pas de posts statiques. Profils utilisateurs riches et personnalisables. Notifications/interactions en temps réel perçu (au minimum re-fetch après action). Onboarding qui capte l'intérêt dès les premières secondes (suggestions, contenu pertinent immédiat, pas d'écran vide).`,
    pitfalls: `**DÉFAUTS À ÉVITER** : "empty state" décourageant au premier login (fil vide, aucune suggestion) — l'onboarding doit montrer de la valeur immédiate. Posts/interactions factices/statiques au lieu d'un vrai CRUD. Aucun feedback après une action (like/commentaire sans mise à jour visible). Profils pauvres, non personnalisables. Pas de modération ni de signalement (indispensable). Publication compliquée. Navigation confuse entre fil, profil et notifications.`,
  },
  {
    aliases: ["plombier", "electricien", "artisan", "entreprise de nettoyage", "service a domicile", "jardinier", "demenagement", "reparation"],
    name: "Services à domicile / Artisan",
    brief: `**MEILLEURS DU SECTEUR** : Angi/TaskRabbit (mise en relation avec artisan + devis rapide), Thumbtack (demande de devis en quelques clics).
**PATTERNS COMMUNS** : demande de devis/intervention en formulaire court (type de besoin, urgence, adresse) qui persiste (data.create), réponse rapide mise en avant ("devis sous 24h"). Zone d'intervention claire. Galerie de réalisations avant/après. Avis clients avec note. Tarification transparente (à l'heure, forfait) si possible. Prise de RDV d'intervention. Téléphone visible en haut à droite sur chaque page.`,
    pitfalls: `**DÉFAUTS À ÉVITER** : téléphone/contact difficile à trouver (doit être visible en permanence, idéalement cliquable sur mobile). Formulaire de devis trop long ou intimidant (le garder court : besoin, urgence, adresse). Aucune preuve (pas d'avis, pas de photos avant/après). Zone d'intervention non précisée. Aucune indication de prix ni de délai de réponse. Site non responsive alors que beaucoup cherchent en urgence sur mobile. Chargement lent.`,
  },
  {
    aliases: ["photographe", "portfolio creatif", "artiste", "illustrateur", "videaste", "architecte", "designer independant"],
    name: "Portfolio créatif / Freelance",
    brief: `**MEILLEURS DU SECTEUR** : portfolios Awwwards-tier, Behance (mise en avant de projets), studios d'architecture premium (Foster + Partners: minimalisme, grandes images).
**PATTERNS COMMUNS** : le TRAVAIL est le contenu principal — grandes images/vidéos pleine largeur, mise en page épurée qui ne rivalise jamais avec les visuels (typographie discrète, beaucoup de blanc). Grille de projets avec transition douce vers le détail. À propos avec vraie personnalité (pas générique). Contact simple et direct (formulaire qui persiste ou lien direct), disponibilité affichée si freelance.`,
    pitfalls: `**DÉFAUTS À ÉVITER** : trop peu OU trop de projets (montrer les meilleurs, pas tout — les projets "filler" affaiblissent l'ensemble). Manque d'explication/contexte par projet (rôle, problème, résultat) OU au contraire surdose de process/deliverables au détriment du résultat. Fautes d'orthographe/typo (rédhibitoire). Liens cassés ou projets obsolètes. Design du portfolio médiocre qui rivalise avec/écrase le travail. Buzzwords et adjectifs creux au lieu de substance. Contact introuvable. Pas de version récente.`,
  },
  {
    aliases: ["mariage", "wedding planner", "organisation d evenement", "traiteur evenementiel", "salle de reception"],
    name: "Événementiel / Mariage",
    brief: `**MEILLEURS DU SECTEUR** : The Knot/Zola (planification de mariage, listes et prestataires), studios d'événementiel haut de gamme (esthétique romantique/élégante).
**PATTERNS COMMUNS** : esthétique élégante et chaleureuse (photographie réelle d'événements, typographie soignée avec une touche serif souvent). Galerie de réalisations par type d'événement. Demande de devis/disponibilité qui persiste (data.create) avec date d'événement, nombre d'invités, type de prestation. Témoignages de couples/clients. Forfaits/prestations clairement détaillés avec prix indicatif.`,
    pitfalls: `**DÉFAUTS À ÉVITER** : galerie en photos stock génériques au lieu de vraies réalisations (l'émotion et la preuve viennent du réel). Aucun formulaire de demande de disponibilité qui capture date + nombre d'invités + type de prestation. Pas de témoignages de clients. Forfaits/prix totalement absents (donner au moins un ordre d'idée). Esthétique incohérente ou froide. Site lent (galeries lourdes non optimisées). Pas de mobile-first. Navigation confuse entre types d'événements.`,
  },
];

function normalize(s: string): string {
  return (s || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Cherche le playbook sectoriel le plus pertinent pour cette idée/industrie.
 * Substring match (les alias sont souvent des expressions multi-mots) —
 * retourne le PREMIER match, donc les alias les plus spécifiques doivent
 * être listés avant les plus génériques dans PLAYBOOKS si besoin d'arbitrage.
 */
export function findIndustryPlaybook(text: string): IndustryPlaybook | null {
  const t = normalize(text);
  if (!t) return null;
  for (const p of PLAYBOOKS) {
    for (const alias of p.aliases) {
      if (t.includes(normalize(alias))) return p;
    }
  }
  return null;
}

export function formatIndustryPlaybook(p: IndustryPlaybook): string {
  return `## 🏆 PLAYBOOK SECTORIEL — ${p.name}
Ce type d'entreprise a des références mondiales éprouvées. Vise CE niveau (fonctionnalités, structure, exigences de confiance), sans copier leurs marques — construis une identité propre du même calibre. Imite les forces ci-dessous ET évite explicitement les défauts documentés du secteur.

${p.brief}

${p.pitfalls}

⚠️ VÉRITÉ DU CONTENU — ce playbook décrit des STRUCTURES, pas une autorisation d'inventer. Toute section de ce playbook qui repose sur une preuve (avis/témoignages, notes en étoiles, logos de clients ou de presse, chiffres de preuve sociale, récompenses, labels/certifications, avant/après, nombre de membres, adresse/horaires/téléphone, prix et délais) ne se remplit JAMAIS avec des données inventées : soit tu la branches sur de VRAIES données persistées avec un état vide honnête, soit tu marques l'information comme « [À compléter] », soit tu SUPPRIMES la section. Une fois les paiements et le domaine connectés, ce site vend à de vrais clients : un faux avis ou un faux label est une infraction (UE : directive 2005/29/CE modifiée par (UE) 2019/2161 ; US : FTC 16 CFR Part 465).`;
}
