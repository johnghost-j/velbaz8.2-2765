// ─── Website Builder Agent — Multi-Page, Design Bible Powered ────────────────
// Generates COMPLETE multi-page websites with consistent design across all pages.
// Each page is generated individually with shared design context for consistency.

import { generateText } from "ai";
import { gateway } from "../agent/gateway";
import type { AgentConfig, CompanyContext, AgentResult } from "./types";
import { CONTENT_TRUTH, CONTENT_TRUTH_SHORT } from "../builder/content-truth";

// ─── Condensed Design Bible (from 73+ world-class sites) ─────────────────────

const DESIGN_BIBLE = `
## DESIGN BIBLE — World-Class Website Rules

### GOLDEN RULES
1. Generous whitespace: 80-120px between sections
2. ONE primary CTA per viewport
3. Visual hierarchy: H1 screams, body whispers
4. Consistency everywhere
5. Mobile-first (60%+ traffic is mobile)
6. Less is more

### ANTI-PATTERNS (NEVER DO)
- Walls of text — max 2-3 lines per block
- Carousel/slider heroes — single powerful hero
- More than 6 nav items
- Low contrast text
- Full-width text without max-width (65ch max)
- Multiple font families (max 2)
- Rainbow colors (max 3: primary, secondary, accent)
- No hover/focus states

### TYPOGRAPHY
- Font: Inter (default), alt: Plus Jakarta Sans, Space Grotesk
- Scale: 12/14/16/18/20/24/30/36/48/60/72px
- Headlines: line-height 1.1-1.2, letter-spacing -0.02em
- Body: line-height 1.5-1.7

### COLORS
- Background: #FFFFFF or #000000 or #F8FAFC/#0A0A0A
- Text: #111827 (light) or #F9FAFB (dark)
- Muted: #6B7280
- Borders: #E5E7EB (light) or #1F2937 (dark)

### SPACING (8px grid)
- Section: py-20 to py-32
- Container: max-w-7xl mx-auto px-6
- Card: p-6 to p-8

### BUTTONS
- Primary: bg-primary text-white px-6 py-3 rounded-lg font-medium
- Secondary: border border-gray-300 px-6 py-3 rounded-lg
- Ghost: text-primary hover:underline
- Min height: h-11 (44px touch target)

### RESPONSIVE
- Grid: 1 col mobile → 2 col md → 3-4 col lg
- Container: max-w-7xl (1280px)
`;

// ─── Site type detection ──────────────────────────────────────────────────────

const SITE_TYPE_HINTS: Record<string, string[]> = {
  saas: ['saas', 'software', 'app', 'plateforme', 'platform', 'outil', 'tool', 'dashboard', 'api', 'automation', 'productivité', 'productivity', 'crm', 'erp'],
  ecommerce: ['ecommerce', 'e-commerce', 'boutique', 'shop', 'store', 'vente', 'sell', 'produit', 'product', 'sneaker', 'vêtement', 'clothing', 'fashion', 'mode', 'bijou', 'jewelry', 'cosmétique', 'beauty', 'food', 'nourriture', 'livraison', 'marque', 'brand', 'premium', 'luxe', 'luxury', 'collection', 'accessoire', 'sac', 'montre', 'parfum', 'chaussure'],
  portfolio: ['portfolio', 'freelance', 'photographe', 'photographer', 'designer', 'artiste', 'artist', 'créatif', 'creative', 'agence', 'agency', 'studio'],
  restaurant: ['restaurant', 'café', 'coffee', 'bar', 'brasserie', 'traiteur', 'catering', 'boulangerie', 'bakery', 'pizzeria', 'sushi', 'bistro', 'menu'],
  blog: ['blog', 'magazine', 'journal', 'média', 'media', 'news', 'article', 'publication', 'éditorial', 'editorial', 'newsletter'],
  dashboard: ['dashboard', 'admin', 'tableau de bord', 'analytics', 'monitoring', 'reporting', 'backoffice', 'back-office'],
};

function detectSiteType(ctx: CompanyContext): string {
  const words = `${ctx.idea || ''} ${ctx.industry || ''} ${ctx.name || ''}`.toLowerCase().split(/[\s,;.!?'"()-]+/);
  let bestMatch = 'saas';
  let bestScore = 0;
  for (const [type, keywords] of Object.entries(SITE_TYPE_HINTS)) {
    const score = keywords.filter(k => words.some(w => w === k || (k.length >= 4 && w.startsWith(k)))).length;
    if (score > bestScore) { bestScore = score; bestMatch = type; }
  }
  return bestMatch;
}

// ─── Pages per site type ──────────────────────────────────────────────────────

interface PageDef {
  slug: string;
  title: string;
  description: string;
  sections: string;
}

const SITE_PAGES: Record<string, PageDef[]> = {
  saas: [
    { slug: 'index', title: 'Accueil', description: 'Landing page principale', sections: 'Hero avec headline puissant + CTA, Bandeau de bénéfices (PAS de logos clients/presse inventés), 3-4 Features clés avec icônes, Section "Comment ça marche" (3 étapes), FAQ (4-5 vraies questions sur le produit), CTA final, Footer' },
    { slug: 'features', title: 'Fonctionnalités', description: 'Détail de toutes les fonctionnalités', sections: 'Hero features, Grid détaillé de 6-8 features (icône + titre + description + screenshot), Tableau récapitulatif des fonctionnalités (aucune comparaison avec un concurrent nommé), Intégrations, CTA, Footer' },
    { slug: 'pricing', title: 'Tarifs', description: 'Plans et prix', sections: 'Hero tarifs, 3 plans (Starter/Pro/Enterprise) avec toggle mensuel/annuel, Tableau comparatif des features, FAQ pricing (5-6 questions), CTA "Essai gratuit", Footer' },
    { slug: 'about', title: 'À propos', description: 'Histoire et équipe', sections: 'Hero avec mission statement, Notre histoire (timeline), Valeurs (3-4 cards), Équipe (photos + rôles), Chiffres clés, CTA rejoindre, Footer' },
    { slug: 'contact', title: 'Contact', description: 'Formulaire de contact', sections: 'Hero contact, Formulaire (nom, email, sujet, message) + infos de contact, Carte/localisation, FAQ générale, Footer' },
  ],
  ecommerce: [
    { slug: 'index', title: 'Accueil', description: 'Page vitrine principale', sections: 'Hero full-width avec produit phare + CTA "Shop Now", Catégories en images, Produits populaires (grid 4 produits), Bannière promo, Section "Pourquoi nous choisir" (livraison, retours, qualité — sans chiffre ni délai inventé), FAQ, Newsletter signup, Footer' },
    { slug: 'products', title: 'Produits', description: 'Catalogue produits', sections: 'Hero collection, Filtres (catégorie, taille, prix, couleur), Grid produits (8-12 produits avec image, nom, prix, badge "New"/"Sale"), Pagination, Footer' },
    { slug: 'about', title: 'Notre Histoire', description: 'La marque', sections: 'Hero avec photo lifestyle, Notre histoire et mission, Nos valeurs (artisanat, durabilité, style), Processus de fabrication, Chiffres (clients, pays, produits), Instagram feed, Footer' },
    { slug: 'faq', title: 'FAQ', description: 'Questions fréquentes', sections: 'Hero FAQ, Sections: Commandes, Livraison, Retours, Tailles, Paiement (accordion), Contact rapide, Footer' },
    { slug: 'contact', title: 'Contact', description: 'Service client', sections: 'Hero contact, 3 cards (Email, Téléphone, Chat), Formulaire de contact, Horaires du service client, Adresse/carte, Footer' },
  ],
  portfolio: [
    { slug: 'index', title: 'Portfolio', description: 'Page principale avec projets', sections: 'Hero avec nom + titre + tagline, Grid projets (6-8 projets avec image + titre, hover effect), Clients/logos, Section compétences, CTA contact, Footer' },
    { slug: 'about', title: 'À propos', description: 'Bio et parcours', sections: 'Hero avec photo, Bio détaillée, Parcours/expérience (timeline), Compétences (barres/tags), Outils/technologies, Télécharger CV, Footer' },
    { slug: 'services', title: 'Services', description: 'Ce que je propose', sections: 'Hero services, 4-6 services (icône + titre + description + prix indicatif), Processus de travail (4 étapes), FAQ services, CTA, Footer' },
    { slug: 'contact', title: 'Contact', description: 'Me contacter', sections: 'Hero contact, Formulaire simple, Réseaux sociaux, Disponibilité, Footer' },
  ],
  restaurant: [
    { slug: 'index', title: 'Accueil', description: 'Page principale du restaurant', sections: 'Hero full-width photo + nom du restaurant + tagline, À propos court (2 phrases + photo chef), Menu highlights (3-4 plats phares), Réservation CTA, Galerie photos (6 images), Horaires + adresse (marqués "[À compléter]" si non fournis), FAQ, Footer' },
    { slug: 'menu', title: 'La Carte', description: 'Menu complet', sections: 'Hero avec photo ambiance, Sections menu: Entrées, Plats, Desserts, Boissons (chaque item: nom + description + prix), Menu du jour/suggestion du chef, Note allergènes, CTA réservation, Footer' },
    { slug: 'about', title: 'Notre Histoire', description: 'Le restaurant et le chef', sections: 'Hero avec photo intérieur, Notre histoire, Le chef (photo + bio), Notre philosophie (produits locaux, saison), Galerie ambiance, Presse/récompenses, Footer' },
    { slug: 'reservations', title: 'Réservation', description: 'Réserver une table', sections: 'Hero, Formulaire réservation (date, heure, nombre, nom, tel, notes), Infos pratiques (horaires, adresse, parking), Plan d\'accès, Événements privés/groupes, Footer' },
    { slug: 'contact', title: 'Contact', description: 'Nous contacter', sections: 'Hero, Infos (adresse, tel, email), Horaires, Carte Google Maps, Formulaire contact, Réseaux sociaux, Footer' },
  ],
  blog: [
    { slug: 'index', title: 'Blog', description: 'Page principale du blog', sections: 'Hero avec article vedette (grande image + titre + extrait), Grid articles récents (6 articles: image + titre + date + catégorie), Sidebar: catégories + newsletter, Pagination, Footer' },
    { slug: 'about', title: 'À propos', description: 'À propos du blog/auteur', sections: 'Hero, Bio auteur avec photo, Mission du blog, Sujets couverts, Newsletter CTA, Réseaux sociaux, Footer' },
    { slug: 'contact', title: 'Contact', description: 'Contact et collaboration', sections: 'Hero, Formulaire contact, Propositions de collaboration, Réseaux sociaux, Footer' },
  ],
  dashboard: [
    { slug: 'index', title: 'Dashboard', description: 'Tableau de bord principal', sections: 'Sidebar nav (logo, menu items avec icônes, user avatar), Top bar (search, notifications, profile), Stats cards (4 KPIs), Graphique principal, Tableau de données récentes, Quick actions' },
  ],
};

// ─── Site type-specific design notes ──────────────────────────────────────────

const SITE_TYPE_DESIGN: Record<string, string> = {
  saas: 'Style: Moderne, clean. Couleur accent: bleu ou violet. Hero centré, gradient subtil. Social proof tôt.',
  ecommerce: 'Style: Visuel, produit-centré. Hero full-width produit. Grid produits avec hover. Trust badges. CTA "Ajouter au panier".',
  portfolio: 'Style: Minimaliste, travail parle. Monochrome + 1 accent. Grandes images. Typographie expressive.',
  restaurant: 'Style: Chaleureux, photos food. Palette chaude. Typography élégante. Réservation proéminente.',
  blog: 'Style: Clean, lisible. Contenu roi. Max 65ch. Line-height généreuse. Newsletter CTA.',
  dashboard: 'Style: Dense mais aéré. Sidebar + topbar. Cards blanches sur fond gris. Données claires.',
};

// ─── Nom de marque : le nom du projet fait FOI ────────────────────────────────
// Bug corrigé : l'IA inventait un `companyName` dans le design system, différent
// du nom du projet affiché dans l'app. Le site portait donc une autre marque que
// le projet. Désormais, si le projet a un vrai nom (pas un placeholder), ce nom
// est IMPOSÉ partout (design system + chaque page).
const PLACEHOLDER_BRAND_NAMES = /^(nouveau projet|new project|mon app|ma app|my app|app|application|untitled|sans titre|velbaz co|company|entreprise|n\/a)$/i;
export function isPlaceholderBrandName(n?: string | null): boolean {
  const s = (n || '').trim();
  return !s || PLACEHOLDER_BRAND_NAMES.test(s);
}

// ─── Generate a consistent design system for all pages ────────────────────────

function buildDesignSystemPrompt(ctx: CompanyContext, siteType: string, lang: string): string {
  const brandColors = ctx.branding?.colors;
  const brandTypo = ctx.branding?.typography;
  const lockedName = !isPlaceholderBrandName(ctx.name) ? (ctx.name || '').trim() : '';

  return `Tu es un web designer WORLD-CLASS. Crée le DESIGN SYSTEM JSON pour un site "${siteType}" pour "${ctx.name || 'cette entreprise'}".
${lockedName ? `
⚠️ RÈGLE ABSOLUE — NOM DE MARQUE IMPOSÉ
Le nom de l'entreprise est EXACTEMENT: "${lockedName}"
- "companyName" DOIT valoir exactement "${lockedName}" (même orthographe, même casse)
- N'invente JAMAIS un autre nom, ne le traduis pas, ne l'abrège pas, n'ajoute pas de suffixe (pas de "Inc", "Studio", "Co", etc.)
` : ''}

CONTEXTE:
- Entreprise: ${ctx.name || 'N/A'}
- Idée: ${ctx.idea || 'N/A'}
- Audience: ${ctx.targetAudience || 'N/A'}
- Style demandé: ${ctx.style || SITE_TYPE_DESIGN[siteType] || 'Moderne et professionnel'}
${brandColors ? `- Couleurs branding: ${JSON.stringify(brandColors)}` : ''}
${brandTypo ? `- Typo branding: ${JSON.stringify(brandTypo)}` : ''}

Réponds UNIQUEMENT avec ce JSON (pas de texte avant/après):
{
  "companyName": "${lockedName || '...'}",
  "tagline": "...",
  "colors": {
    "primary": "#...",
    "secondary": "#...",
    "accent": "#...",
    "background": "#...",
    "surface": "#...",
    "text": "#...",
    "textMuted": "#...",
    "border": "#..."
  },
  "font": "Inter",
  "darkMode": false,
  "navLinks": [{"label": "...", "href": "/..."}],
  "footerLinks": [{"group": "...", "links": [{"label": "...", "href": "/..."}]}],
  "socialLinks": [{"platform": "...", "url": "#"}],
  "ctaText": "...",
  "ctaHref": "/...",
  "lang": "${lang}"
}`;
}

// ─── Generate a single page HTML ──────────────────────────────────────────────

function buildPagePrompt(
  ctx: CompanyContext,
  siteType: string,
  page: PageDef,
  designSystem: string,
  allPages: PageDef[],
  lang: string,
): string {
  const navLinksHint = allPages.map(p => `<a href="/${p.slug === 'index' ? '' : p.slug}">${p.title}</a>`).join(', ');
  const lockedName = !isPlaceholderBrandName(ctx.name) ? (ctx.name || '').trim() : '';

  return `Tu es un web designer WORLD-CLASS formé sur 73 top sites (Stripe, Linear, Apple, Vercel).

## TA MISSION
Générer le HTML COMPLET pour la page "${page.title}" (/${page.slug}) du site "${ctx.name || 'cette entreprise'}".
${lockedName ? `
## ⚠️ NOM DE MARQUE IMPOSÉ (RÈGLE N°1)
La marque du site est EXACTEMENT: "${lockedName}"
- Utilise "${lockedName}" tel quel dans le <title>, le logo/wordmark de la nav, le footer, le copyright et partout où la marque apparaît
- N'invente JAMAIS un autre nom, ne le traduis pas, ne l'abrège pas, n'ajoute aucun suffixe
` : ''}

## DESIGN SYSTEM (applique ces styles PARTOUT)
${designSystem}

## DESIGN BIBLE
${DESIGN_BIBLE}

${SITE_TYPE_DESIGN[siteType] || ''}

## PAGE À GÉNÉRER
- Slug: /${page.slug}
- Titre: ${page.title}
- Description: ${page.description}
- Sections requises: ${page.sections}

## NAVIGATION (même sur CHAQUE page)
Pages du site: ${navLinksHint}
- La nav DOIT être identique sur toutes les pages
- Le footer DOIT être identique sur toutes les pages
- Marque la page courante comme active dans la nav

## CONTEXTE ENTREPRISE
${ctx.name ? `- Nom: ${ctx.name}` : ''}
${ctx.idea ? `- Idée: ${ctx.idea}` : ''}
${ctx.industry ? `- Industrie: ${ctx.industry}` : ''}
${ctx.targetAudience ? `- Audience: ${ctx.targetAudience}` : ''}
${ctx.priceRange ? `- Prix: ${ctx.priceRange}` : ''}
${ctx.products ? `- Produits: ${ctx.products}` : ''}

${ctx.content?.websiteCopy ? `## CONTENU (utilise-le)
${JSON.stringify(ctx.content.websiteCopy).slice(0, 1000)}` : ''}

## RÈGLES TECHNIQUES STRICTES
1. **Tailwind CSS CDN** — <script src="https://cdn.tailwindcss.com"></script>
2. **Google Fonts** — Inter par défaut
3. **Tailwind config inline** avec les couleurs du design system
4. **Menu mobile fonctionnel** — hamburger + toggle JS
5. **Hover states** sur TOUT (boutons, cartes, liens)
6. **100% responsive** — mobile first
7. **Contenu VÉRIDIQUE** — JAMAIS de "Lorem ipsum", et JAMAIS de fait inventé (voir VÉRITÉ DU CONTENU ci-dessous)
8. **Images** — gradients CSS ou SVG abstraits (PAS d'URLs d'images cassées)
9. **Langue: ${lang === 'fr' ? 'FRANÇAIS' : lang === 'en' ? 'ENGLISH' : lang.toUpperCase()}**
10. **Scroll reveal animations** — IntersectionObserver, fade-in subtil
11. **LIENS INTERNES** — utilise href="/{slug}" pour les liens entre pages (PAS .html)
12. **Chaque section DOIT avoir du vrai contenu** — pas de placeholder vide, et ce contenu doit être VRAI (rien d'inventé)

${CONTENT_TRUTH}

## FORMAT DE SORTIE
Réponds UNIQUEMENT avec le code HTML complet (<!DOCTYPE html> ... </html>).
PAS de \`\`\`html, PAS de commentaire, PAS d'explication. JUSTE le HTML.`;
}

// ─── Multi-page generation engine ─────────────────────────────────────────────

export interface WebsiteGenerationResult {
  pages: Array<{ slug: string; title: string; html: string }>;
  siteType: string;
  designSystem: any;
}

const FALLBACK_MODELS = ['google/gemini-3-flash', 'google/gemini-2.0-flash-001'];

async function callAIWithFallback(system: string, prompt: string, model: string, maxTokens: number): Promise<string> {
  try {
    // maxRetries: 1 — avant 0 : un hoquet réseau consommait directement le
    // modèle principal et dégradait la génération du site.
    const { text } = await generateText({ model: gateway(model), system, prompt, maxOutputTokens: maxTokens, maxRetries: 1, abortSignal: AbortSignal.timeout(300000) });
    return text || '';
  } catch (err: any) {
    console.log(`[website] Primary model ${model} failed: ${err?.message}. Trying fallbacks...`);
    for (const fallback of FALLBACK_MODELS) {
      if (fallback === model) continue;
      try {
        const { text } = await generateText({ model: gateway(fallback), system, prompt, maxOutputTokens: maxTokens, maxRetries: 0, abortSignal: AbortSignal.timeout(300000) });
        return text || '';
      } catch { continue; }
    }
    throw err;
  }
}

function detectLanguage(text: string): string {
  const frWords = /\b(je|tu|il|elle|nous|vous|une?|les?|des?|est|sont|dans|avec|pour|sur|pas|qui|que|quoi|salut|bonjour|merci|créer?|crée|marque|boutique|vente)\b/gi;
  const matches = text.match(frWords);
  return (matches && matches.length >= 2) ? 'fr' : 'en';
}

export async function generateMultiPageWebsite(
  ctx: CompanyContext,
  userMessage: string,
  onProgress?: (msg: string) => void,
): Promise<WebsiteGenerationResult> {
  const siteType = detectSiteType(ctx);
  const lang = detectLanguage(`${userMessage} ${ctx.idea || ''}`);
  const pages = SITE_PAGES[siteType] || SITE_PAGES.saas;
  const model = 'anthropic/claude-sonnet-4.6';

  onProgress?.(`🎨 Type de site détecté: ${siteType}. ${pages.length} pages à générer...`);

  // ── Step 1: Generate design system ──
  onProgress?.(`🎨 Création du design system...`);
  const dsPrompt = buildDesignSystemPrompt(ctx, siteType, lang);
  const dsRaw = await callAIWithFallback(
    'Tu es un designer. Réponds UNIQUEMENT en JSON valide, sans markdown, sans code fences.',
    dsPrompt,
    model,
    2000,
  );
  
  // Parse design system JSON
  let designSystem: any = {};
  try {
    const jsonMatch = dsRaw.match(/\{[\s\S]*\}/);
    if (jsonMatch) designSystem = JSON.parse(jsonMatch[0]);
  } catch (e) {
    console.error('[website] Failed to parse design system JSON:', e);
    designSystem = { companyName: ctx.name || 'Company', colors: { primary: '#3B82F6', background: '#FFFFFF', text: '#111827' }, font: 'Inter' };
  }

  // Le nom du projet fait FOI : si le projet a un vrai nom, il écrase celui que
  // l'IA a pu inventer dans le JSON — sinon le site sortait avec une autre marque
  // que le nom affiché dans l'app.
  const projectName = (ctx.name || '').trim();
  if (!isPlaceholderBrandName(projectName)) {
    if (designSystem.companyName && designSystem.companyName.trim() !== projectName) {
      console.log(`[website] brand name forced: "${designSystem.companyName}" → "${projectName}"`);
    }
    designSystem.companyName = projectName;
  } else if (isPlaceholderBrandName(designSystem.companyName)) {
    designSystem.companyName = projectName || designSystem.companyName || 'Company';
  }

  const designSystemStr = JSON.stringify(designSystem, null, 2);
  onProgress?.(`✅ Design system créé (${designSystem.companyName || ctx.name})`);

  // ── Step 2: Generate each page ──
  const generatedPages: Array<{ slug: string; title: string; html: string }> = [];

  for (let i = 0; i < pages.length; i++) {
    const page = pages[i];
    onProgress?.(`📄 Génération page ${i + 1}/${pages.length}: ${page.title}...`);
    
    try {
      const pagePrompt = buildPagePrompt(ctx, siteType, page, designSystemStr, pages, lang);
      const html = await callAIWithFallback(
        'Tu es un expert HTML/Tailwind. Génère UNIQUEMENT du HTML complet. Pas de markdown, pas de code fences. Commence par <!DOCTYPE html>.',
        pagePrompt,
        model,
        16000,
      );
      
      // Clean up the HTML — remove code fences if AI added them
      let cleanHtml = html.trim();
      if (cleanHtml.startsWith('```')) {
        cleanHtml = cleanHtml.replace(/^```(?:html)?\s*\n?/, '').replace(/\n?```\s*$/, '');
      }
      
      // Verify it starts with DOCTYPE or <html
      if (!cleanHtml.startsWith('<!DOCTYPE') && !cleanHtml.startsWith('<html')) {
        const docStart = cleanHtml.indexOf('<!DOCTYPE');
        const htmlStart = cleanHtml.indexOf('<html');
        const start = docStart !== -1 ? docStart : htmlStart;
        if (start !== -1) {
          cleanHtml = cleanHtml.substring(start);
        }
      }
      
      // Ensure it ends with </html>
      const htmlEnd = cleanHtml.lastIndexOf('</html>');
      if (htmlEnd !== -1 && htmlEnd < cleanHtml.length - 10) {
        cleanHtml = cleanHtml.substring(0, htmlEnd + 7);
      }
      
      if (cleanHtml.length > 500) {
        generatedPages.push({ slug: page.slug, title: page.title, html: cleanHtml });
        onProgress?.(`✅ Page "${page.title}" générée (${Math.round(cleanHtml.length / 1024)}KB)`);
      } else {
        console.error(`[website] Page ${page.slug} too short (${cleanHtml.length} chars), skipping`);
        onProgress?.(`⚠️ Page "${page.title}" trop courte, skip`);
      }
    } catch (err: any) {
      console.error(`[website] Failed to generate page ${page.slug}:`, err?.message);
      onProgress?.(`⚠️ Erreur page "${page.title}": ${err?.message?.slice(0, 100)}`);
    }
  }

  return {
    pages: generatedPages,
    siteType,
    designSystem,
  };
}

// ─── Agent Config (for compatibility with executeAgent) ───────────────────────
// This is still used for simple single-page generation (e.g., quick preview).
// For full multi-page generation, use generateMultiPageWebsite() directly.

export const websiteAgent: AgentConfig = {
  role: 'website',
  name: 'Website Builder Agent',
  model: 'anthropic/claude-sonnet-4.6',
  maxTokens: 16000,

  systemPrompt: (ctx: CompanyContext) => {
    const siteType = detectSiteType(ctx);
    const pages = SITE_PAGES[siteType] || SITE_PAGES.saas;
    const pageList = pages.map(p => `- /${p.slug}: ${p.title} — ${p.description}`).join('\n');

    return `Tu es l'Agent Website Builder de Velbaz — un web designer WORLD-CLASS.

## TON RÔLE
Générer le HTML COMPLET de la page d'accueil (index) du site web.

## DESIGN BIBLE
${DESIGN_BIBLE}

## TYPE DE SITE: ${siteType.toUpperCase()}
${SITE_TYPE_DESIGN[siteType] || ''}

## PAGES DU SITE (tu génères SEULEMENT index ici, les autres pages seront générées séparément)
${pageList}

## CONTEXTE
${ctx.name ? `- Nom: ${ctx.name}` : '- Nom: [À déterminer]'}
${ctx.idea ? `- Idée: ${ctx.idea}` : ''}
${ctx.industry ? `- Industrie: ${ctx.industry}` : ''}

${ctx.branding ? `## BRANDING
- Couleurs: ${JSON.stringify(ctx.branding.colors || {})}
- Typo: ${JSON.stringify(ctx.branding.typography || {})}` : ''}

## FORMAT
Réponds avec le HTML complet dans un bloc \`\`\`html ... \`\`\`.
- Tailwind CSS CDN
- Inter font
- Menu mobile fonctionnel
- Responsive
- Contenu VÉRIDIQUE (jamais Lorem ipsum, jamais de fait inventé)
- Minimum 6 sections
- Liens vers les autres pages: ${pages.map(p => `/${p.slug === 'index' ? '' : p.slug}`).join(', ')}

${CONTENT_TRUTH_SHORT}`;
  },

  parseOutput: (raw: string, ctx: CompanyContext): AgentResult => {
    let htmlContent = '';
    const htmlMatch = raw.match(/```html\s*([\s\S]*?)```/);
    if (htmlMatch) {
      htmlContent = htmlMatch[1].trim();
    } else if (raw.includes('<!DOCTYPE html>') || raw.includes('<html')) {
      const start = raw.indexOf('<!DOCTYPE html>') !== -1 ? raw.indexOf('<!DOCTYPE html>') : raw.indexOf('<html');
      const end = raw.lastIndexOf('</html>');
      htmlContent = end !== -1 ? raw.substring(start, end + 7) : raw.substring(start);
    }

    const siteType = detectSiteType(ctx);
    const pages = SITE_PAGES[siteType] || SITE_PAGES.saas;

    if (htmlContent) {
      return {
        response: `✅ Page d'accueil générée. ${pages.length - 1} autres pages en attente de génération.`,
        data: {
          website: {
            html: htmlContent,
            siteType,
            pages: [{ slug: 'index', title: 'Accueil', html: htmlContent }],
            generated: true,
            generatedAt: new Date().toISOString(),
            totalPages: pages.length,
            pendingPages: pages.filter(p => p.slug !== 'index').map(p => p.slug),
          }
        },
        shouldBuild: true,
      };
    }

    return {
      response: raw,
      data: { website: { fullSpec: raw, siteType, generated: false } },
    };
  }
};

// ─── Exports ──────────────────────────────────────────────────────────────────
export { detectSiteType, DESIGN_BIBLE, SITE_TYPE_DESIGN, SITE_PAGES };
