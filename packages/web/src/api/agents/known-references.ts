// ─── Base de connaissances de références curées ──────────────────────────────
// Quand l'utilisateur dit "comme Velbaz", "clone de Lovable", "type v0"… la
// recherche web seule peut échouer (produit privé, résultats pauvres, site en
// SPA non scrapable). Cette base fournit une SPEC RICHE et PRÉCISE directement
// à l'IA : positionnement, features cœur, pages/écrans, modèle de données,
// features IA embarquées, vibe design. C'est ce qui permet de reproduire
// fidèlement un produit du niveau de sa vraie version.
//
// Chaque entrée est écrite comme un brief produit prêt à injecter dans le
// prompt de planification + design.

export interface KnownReference {
  /** Aliases reconnus (minuscules, sans accents) qui pointent vers cette spec. */
  aliases: string[];
  /** Nom canonique affiché. */
  name: string;
  /** Catégorie courte. */
  category: string;
  /** Brief produit complet injecté dans le prompt. Markdown autorisé. */
  brief: string;
}

const REFERENCES: KnownReference[] = [
  {
    aliases: ["velbaz", "synaps", "synapse", "polsia"],
    name: "Velbaz",
    category: "Générateur d'entreprises & d'apps par IA (type Lovable + business builder)",
    brief: `**PRODUIT** : plateforme IA qui crée une ENTREPRISE COMPLÈTE de A à Z à partir d'un simple prompt. L'utilisateur décrit son idée ("une app de livraison de repas bio"), et l'IA génère automatiquement : le nom, le logo, l'identité de marque, un VRAI site/app web full-stack fonctionnel, la stratégie marketing, et pilote les opérations. C'est un croisement entre Lovable (génération d'app par IA) et un fondateur de startup autonome.

**FEATURES CŒUR (ce que l'utilisateur final FAIT dans l'app)** :
- **Prompt bar / chat de création** : l'utilisateur tape son idée d'entreprise en langage naturel ; l'IA pose quelques questions de cadrage puis lance la génération.
- **Génération de marque** : nom d'entreprise, logo IA, palette, tagline, identité complète.
- **Génération de site/app web** : un vrai produit React déployable est construit en direct (pages, fonctionnalités, base de données), avec aperçu live dans un iframe pendant la construction.
- **Swarm d'agents IA** : plusieurs agents spécialisés (Design, Développement, Marketing, Recherche, Opérations, Contenu) travaillent en parallèle, chacun avec son statut en temps réel dans un panneau d'activité.
- **Édition par chat** : après génération, l'utilisateur dit "rends le header bleu" / "ajoute une page pricing" et l'IA modifie le bon fichier, l'aperçu se met à jour instantanément (HMR).
- **Marketing automation** : génération de posts sociaux, calendrier de contenu, campagnes.
- **Dashboard entreprise** : vue d'ensemble de l'entreprise créée (site, métriques, tâches des agents, crédits consommés).
- **Bibliothèque de projets/entreprises** : liste des entreprises générées, reprise/itération sur chacune.
- **Système de crédits** : chaque génération consomme des crédits ; compteur visible, page de facturation avec plans.

**ÉCRANS / PAGES À CONSTRUIRE** :
1. Accueil / prompt bar hero (route "/") — grande barre de prompt centrale "Décris ton entreprise…", exemples cliquables, CTA. C'est LE cœur, façon Lovable/ChatGPT.
2. Studio de génération (route "/build/:id" ou "/company/:id") — split-pane : à gauche le chat + progression live des agents, à droite l'aperçu du site généré dans un iframe + onglet Code (arborescence de fichiers + viewer).
3. Bibliothèque des entreprises/projets (route "/projects" ou "/dashboard") — grille de cartes, chaque entreprise avec logo, nom, statut, date ; états vide + skeleton.
4. Détail d'une entreprise (route "/company/:id") — dashboard : aperçu du site, tâches des agents, marketing, métriques, crédits.
5. Marketing (route "/marketing") — génération et calendrier de posts sociaux, campagnes.
6. Facturation / crédits (route "/billing") — plans, compteur de crédits, upgrade via checkout.

**MODÈLE DE DONNÉES (entities)** :
- companies : name, idea, industry, status, logoUrl, siteUrl, createdAt
- projects/generations : companyId, prompt, status, previewUrl, files, createdAt
- agentTasks : companyId, agentName, status, message, createdAt
- credits : userId, balance, plan

**FEATURES IA EMBARQUÉES (aiChat)** : génération de nom+tagline, génération de plan d'entreprise, génération de contenu marketing, assistant conversationnel de création et d'édition. Utilise aiChat() partout où l'utilisateur crée par IA.

**VIBE DESIGN** : premium, éditorial, sombre par défaut, typographie massive, mise en page asymétrique, dégradés subtils, sensation de produit "AI-first" haut de gamme (niveau Lovable, Linear, Vercel). La prompt bar hero doit être spectaculaire.`,
  },
  {
    aliases: ["lovable", "lovable.dev", "loveable"],
    name: "Lovable",
    category: "Générateur d'apps web full-stack par IA",
    brief: `**PRODUIT** : "Idea to app in seconds." L'utilisateur décrit une app en langage naturel, l'IA génère une application web full-stack complète (React + backend + base de données), éditable par chat, déployable en un clic.

**FEATURES CŒUR** :
- Prompt bar centrale géante sur l'accueil : "Ask Lovable to create a…" avec suggestions.
- Éditeur split : chat de génération/itération à gauche, aperçu live de l'app à droite (+ onglet code, arborescence de fichiers).
- Itération par langage naturel : "add a login page", "make it dark mode" → l'app se met à jour en direct.
- Historique/bibliothèque des projets, reprise d'un projet.
- Connexion Supabase (auth + DB), déploiement, publication de domaine.
- Système de crédits / messages par plan.

**ÉCRANS** : Accueil prompt hero (/), Éditeur de projet (/project/:id, split chat+preview+code), Bibliothèque de projets (/projects, grille), Facturation (/billing). 

**ENTITIES** : projects (prompt, name, previewUrl, status), messages (projectId, role, content), files (projectId, path, content).

**IA EMBARQUÉE** : génération d'app par prompt, édition par chat (aiChat partout).

**VIBE** : clair et chaleureux OU sombre premium, gradients doux, très soigné, focus total sur la prompt bar.`,
  },
  {
    aliases: ["bolt", "bolt.new", "stackblitz bolt"],
    name: "Bolt.new",
    category: "Générateur d'apps par IA (in-browser fullstack)",
    brief: `**PRODUIT** : "Prompt, run, edit & deploy full-stack web apps." Génération d'apps par IA avec exécution réelle dans le navigateur (WebContainers).

**FEATURES CŒUR** : prompt bar hero ("What do you want to build?"), éditeur avec terminal + preview live + arborescence de fichiers, itération par chat, déploiement, import depuis Figma/GitHub.

**ÉCRANS** : Accueil prompt (/), Éditeur (/project/:id : chat + code + terminal + preview), Projets (/projects). ENTITIES : projects, messages, files.

**VIBE** : sombre, technique, développeur, accents électriques.`,
  },
  {
    aliases: ["v0", "v0.dev", "vercel v0"],
    name: "v0 by Vercel",
    category: "Générateur d'UI/composants par IA",
    brief: `**PRODUIT** : génération d'interfaces et de composants React/Tailwind par IA à partir d'un prompt ou d'une image. Chat → UI générée avec preview live et code copiable.

**FEATURES CŒUR** : prompt bar ("Describe what you want to build"), preview + code côte à côte, variations d'une même génération, fork/itération, bibliothèque de créations, communauté.

**ÉCRANS** : Accueil prompt (/), Chat/génération (/chat/:id : preview + code + variations), Bibliothèque (/projects). ENTITIES : chats, generations (code, preview), messages.

**VIBE** : noir & blanc minimaliste ultra-premium (style Vercel), typographie nette, beaucoup d'espace.`,
  },
  {
    aliases: ["notion"],
    name: "Notion",
    category: "Espace de travail / éditeur de documents par blocs",
    brief: `**PRODUIT** : espace de travail tout-en-un — documents, wikis, bases de données, tâches, organisés en pages imbriquées avec des blocs.

**FEATURES CŒUR** : éditeur de pages par blocs (texte, titres, listes, todo, tableaux), sidebar arborescente de pages, création/déplacement/suppression de pages, bases de données (vue table/board/liste), recherche.

**ÉCRANS** : Espace de travail (/ : sidebar pages + éditeur de blocs central, CRUD réel via data), Détail page (/page/:id), Recherche. ENTITIES : pages (title, blocks, parentId, icon), blocks.

**IA** : assistant de rédaction (aiChat) — "continue writing", résumé, amélioration.

**VIBE** : épuré, blanc, typographie lisible, très fonctionnel.`,
  },
  {
    aliases: ["trello", "kanban"],
    name: "Trello",
    category: "Tableau kanban de gestion de tâches",
    brief: `**PRODUIT** : tableaux kanban avec colonnes (listes) et cartes déplaçables par glisser-déposer.

**FEATURES CŒUR** : board avec colonnes, cartes (titre, description, labels, checklist, échéance), drag & drop entre colonnes, plusieurs boards, détail de carte en modal.

**ÉCRANS** : Board (/ : colonnes + cartes, CRUD + drag&drop via data), Détail carte (modal ou /card/:id), Liste des boards (/boards). ENTITIES : boards, lists, cards (title, desc, listId, order, labels).

**VIBE** : coloré, cartes blanches, fond dégradé, léger et rapide.`,
  },
  {
    aliases: ["airbnb"],
    name: "Airbnb",
    category: "Marketplace de location de logements",
    brief: `**PRODUIT** : recherche, découverte et réservation de logements chez l'habitant.

**FEATURES CŒUR** : recherche (destination, dates, voyageurs), grille de logements avec photos/prix/note, filtres, page détail logement (galerie, description, calendrier, réservation), réservations de l'utilisateur, favoris.

**ÉCRANS** : Accueil recherche + grille (/), Détail logement (/listing/:id, réservation via checkout), Mes réservations (/trips), Favoris (/wishlist). ENTITIES : listings (title, price, location, photos, rating), bookings (listingId, dates), wishlist.

**VIBE** : clair, photos immersives, rose corail signature, arrondi doux.`,
  },
  {
    aliases: ["shopify"],
    name: "Shopify",
    category: "Plateforme e-commerce / création de boutique",
    brief: `**PRODUIT** : créer et gérer une boutique en ligne — produits, panier, paiement, commandes.

**FEATURES CŒUR** : catalogue produits (grille + détail), panier, checkout réel, gestion des produits (admin CRUD), commandes, dashboard ventes.

**ÉCRANS** : Boutique/catalogue (/), Détail produit (/product/:id, ajout panier), Panier + checkout (/cart), Admin produits (/admin/products, CRUD via data), Commandes (/orders). ENTITIES : products (title, price, images, stock), orders, cartItems.

**VIBE** : propre, commerce, vert Shopify ou personnalisable.`,
  },
];

/** Normalise un texte pour matcher les alias (minuscules, sans accents/ponctuation). */
function normalize(s: string): string {
  return (s || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9\s.]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Cherche dans l'idée/le message une référence connue. Retourne la première
 * spec curée trouvée, ou null. On matche les alias comme mots entiers pour
 * éviter les faux positifs (ex: "bolt" dans "boltée").
 */
export function findKnownReference(text: string): KnownReference | null {
  const t = normalize(text);
  if (!t) return null;
  for (const ref of REFERENCES) {
    for (const alias of ref.aliases) {
      const a = normalize(alias);
      // mot entier (ou expression) entouré de limites non-alphanumériques
      const re = new RegExp(`(^|[^a-z0-9])${a.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}([^a-z0-9]|$)`);
      if (re.test(t)) return ref;
    }
  }
  return null;
}

/** Bloc markdown prêt à injecter dans le prompt quand une référence est trouvée. */
export function formatKnownReference(ref: KnownReference): string {
  return `## 🎯 RÉFÉRENCE CONNUE — ${ref.name} (${ref.category})
L'utilisateur veut un produit de ce type. Voici une spécification détaillée et fiable de ce produit — REPRODUIS FIDÈLEMENT ses fonctionnalités, ses écrans et son modèle de données pour l'utilisateur final. Ne te contente pas d'une landing page : construis le VRAI produit interactif.

${ref.brief}`;
}
