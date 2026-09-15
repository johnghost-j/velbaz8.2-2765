// ─── Dedicated Marketing Strategy AI (Claude Opus) ──────────────────────────
// A DEDICATED, professional marketing AI that produces a REAL, ready-to-execute
// go-to-market strategy for the project being built: positioning, ICP, channels
// ranked by ROI, an acquisition funnel, ad copy (Meta/Google/TikTok), email
// templates, SEO keywords, a 30-day content calendar, social posts, KPIs and a
// starter budget split.
//
// The output is delivered to the user IN THE CHAT (the AI "speaks") together with
// DOWNLOADABLE FILES (rendered as rounded chips). The markdown files are stored
// in the generated project's `projectFiles` under `marketing/` so they are covered
// by the existing checkpoint / rollback / fork snapshot machinery.
//
// This module NEVER throws — on any AI failure it falls back to a solid built-in
// strategy so a build always ships with a usable marketing pack.
import { generateText } from "ai";
import { gateway } from "../agent/gateway";
import { currentDateContext } from "./prompts";

export interface MarketingFile {
  name: string;    // display name, e.g. "Stratégie Marketing.md"
  path: string;    // project file path, e.g. "marketing/Strategie-Marketing.md"
  content: string; // markdown content
}

export interface MarketingPlan {
  intro: string;          // short chat message the AI "speaks"
  files: MarketingFile[]; // downloadable markdown documents
}

export interface PlanMarketingInput {
  companyName: string;
  idea: string;
  industry?: string;
  country?: string;
  targetAudience?: string;
  lang?: "fr" | "en";
}

// Pull the first JSON object out of a model response (handles ```json fences).
function extractJSON(raw: string): any | null {
  if (!raw) return null;
  let s = raw.trim();
  const fence = s.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) s = fence[1].trim();
  const start = s.indexOf("{");
  const end = s.lastIndexOf("}");
  if (start === -1 || end === -1 || end <= start) return null;
  const slice = s.slice(start, end + 1);
  try {
    return JSON.parse(slice);
  } catch {
    // Best-effort: strip trailing commas then retry.
    try {
      return JSON.parse(slice.replace(/,\s*([}\]])/g, "$1"));
    } catch {
      return null;
    }
  }
}

const MARKETING_SYSTEM = `Tu es le Directeur Marketing de Velbaz — un growth marketer et copywriter d'élite (niveau CMO de scale-up).
Tu produis des stratégies marketing CONCRÈTES, EXÉCUTABLES et PROFESSIONNELLES — jamais de théorie creuse, jamais de placeholders.
Tu écris le VRAI copy (vraies accroches, vrais emails, vrais posts), avec des chiffres réalistes.
Tu adaptes canaux, ton et budget au pays / marché indiqué et au secteur réel du produit.
Tu réponds STRICTEMENT en JSON valide, sans texte autour.${currentDateContext()}`;

function marketingPrompt(input: PlanMarketingInput): string {
  const fr = input.lang !== "en";
  return `Crée une stratégie marketing COMPLÈTE et prête à lancer pour ce projet.

## PROJET
- Nom: ${input.companyName}
- Idée / description: ${input.idea}
${input.industry ? `- Secteur: ${input.industry}` : ""}
${input.targetAudience ? `- Audience visée: ${input.targetAudience}` : ""}
${input.country ? `- Pays / marché principal: ${input.country} (adapte canaux, plateformes, ton et devise)` : ""}
- Langue de rédaction des documents: ${fr ? "FRANÇAIS" : "ANGLAIS"}

## CE QUE TU DOIS PRODUIRE (contenu RÉEL, pas des exemples génériques)
1. Positionnement + proposition de valeur unique (1 phrase forte).
2. Client idéal (ICP) : 2 personas courts (qui, douleur, déclencheur d'achat).
3. Canaux d'acquisition classés par ROI potentiel (avec pourquoi + première action concrète).
4. Entonnoir (awareness → considération → conversion → rétention) avec le levier clé de chaque étape.
5. Ad copy PRÊT À PUBLIER : 3 publicités (Meta, Google, TikTok) — accroche + corps + CTA.
6. 2 emails complets (cold outreach + newsletter) — objet + corps rédigé.
7. 10 mots-clés SEO ciblés (avec intention de recherche).
8. Calendrier de contenu 30 jours (semaine par semaine, thèmes + formats + plateformes).
9. 3 posts sociaux prêts à publier (Instagram, LinkedIn, X/Twitter).
10. KPIs à suivre + répartition de budget de départ (en % sur les canaux prioritaires).

## FORMAT DE SORTIE — JSON STRICT
Réponds UNIQUEMENT avec cet objet JSON (le champ "content" de chaque fichier est du MARKDOWN complet, bien structuré avec titres ##, listes, tableaux si utile) :
{
  "intro": "2-3 phrases, à la première personne, où tu résumes la stratégie et invites à ouvrir les fichiers ci-dessous. Ton chaleureux et pro.",
  "files": [
    { "name": "Stratégie Marketing.md", "content": "# Stratégie Marketing — ${input.companyName}\\n\\n... markdown complet : positionnement, ICP, canaux, entonnoir, KPIs, budget ..." },
    { "name": "Publicités & Emails.md", "content": "# Publicités & Emails\\n\\n... les 3 ad copy + les 2 emails, en markdown ..." },
    { "name": "Calendrier de contenu 30 jours.md", "content": "# Calendrier de contenu — 30 jours\\n\\n... SEO + calendrier semaine par semaine + 3 posts sociaux ..." }
  ]
}
Écris du contenu DENSE et utilisable immédiatement. Pas de "[insérer ici]". Pas de commentaire hors JSON.`;
}

function slugifyName(name: string): string {
  const base = name.replace(/\.md$/i, "");
  const slug = base
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60) || "document";
  return `${slug}.md`;
}

function coerceFiles(raw: any): MarketingFile[] {
  if (!Array.isArray(raw)) return [];
  const files: MarketingFile[] = [];
  for (const f of raw) {
    const name = typeof f?.name === "string" && f.name.trim() ? f.name.trim() : "";
    const content = typeof f?.content === "string" ? f.content.trim() : "";
    if (!name || !content || content.length < 40) continue;
    const fileName = /\.md$/i.test(name) ? name : `${name}.md`;
    files.push({ name: fileName, path: `marketing/${slugifyName(fileName)}`, content });
  }
  return files;
}

/**
 * Run the dedicated marketing AI. NEVER throws — falls back to a solid built-in
 * strategy on any failure so a build always ships with a usable marketing pack.
 */
export async function planMarketingStrategy(
  input: PlanMarketingInput,
  onProgress?: (msg: string) => void,
): Promise<MarketingPlan> {
  const p = (m: string) => { try { onProgress?.(m); } catch { /* ignore */ } };
  const market = input.country ? ` (${input.country})` : "";
  p(`📣 Directeur Marketing — élaboration de la stratégie${market}…`);
  try {
    const { text } = await generateText({
      model: gateway("openai/gpt-5.4-mini"),
      system: MARKETING_SYSTEM,
      prompt: marketingPrompt(input),
      maxOutputTokens: 12000,
    });
    const json = extractJSON(text);
    if (!json) throw new Error("marketing: unparseable JSON");
    const files = coerceFiles(json.files);
    if (!files.length) throw new Error("marketing: no usable files");
    const intro = typeof json.intro === "string" && json.intro.trim()
      ? json.intro.trim()
      : defaultIntro(input);
    p(`✅ Stratégie marketing prête — ${files.length} document(s)`);
    return { intro, files };
  } catch (err: any) {
    p(`⚠️ Stratégie marketing — repli sur le modèle intégré (${err?.message || "erreur IA"})`);
    return defaultMarketingPlan(input);
  }
}

function defaultIntro(input: PlanMarketingInput): string {
  const fr = input.lang !== "en";
  return fr
    ? `J'ai préparé une stratégie marketing complète pour ${input.companyName} : positionnement, canaux prioritaires, publicités, emails, SEO et un calendrier de contenu sur 30 jours. Tout est dans les fichiers ci-dessous — clique pour les télécharger.`
    : `I've put together a complete marketing strategy for ${input.companyName}: positioning, priority channels, ads, emails, SEO and a 30-day content calendar. Everything is in the files below — click to download.`;
}

// Solid built-in fallback so a build NEVER ships without a marketing pack.
function defaultMarketingPlan(input: PlanMarketingInput): MarketingPlan {
  const fr = input.lang !== "en";
  const name = input.companyName || (fr ? "votre projet" : "your project");
  const idea = input.idea || "";
  const market = input.country ? input.country : (fr ? "votre marché" : "your market");

  const strategyMd = fr
    ? `# Stratégie Marketing — ${name}

## Positionnement
${name} aide sa cible à résoudre un problème concret${idea ? ` : ${idea}.` : "."} Proposition de valeur : livrer le résultat plus vite, plus simplement, sans friction.

## Client idéal (ICP)
- **Persona 1** — utilisateur direct : cherche une solution rapide, déclencheur = perte de temps/argent.
- **Persona 2** — décideur : cherche un ROI mesurable, déclencheur = objectif de croissance.

## Canaux d'acquisition (classés par ROI)
1. **SEO + contenu** — coût faible, effet composé. 1re action : publier 4 articles piliers.
2. **Publicité payante (Meta/Google)** — rapide à tester. 1re action : 2 campagnes à petit budget.
3. **Partenariats / communautés** — confiance élevée. 1re action : lister 10 communautés cibles sur ${market}.
4. **Email** — meilleure rétention. 1re action : séquence de bienvenue en 3 emails.

## Entonnoir
- Awareness : contenu SEO + social.
- Considération : lead magnet + retargeting.
- Conversion : offre d'essai + preuve sociale.
- Rétention : onboarding + newsletter.

## KPIs
CAC, taux de conversion visiteur→inscription, activation, rétention 30 j, LTV.

## Budget de départ (indicatif)
- 40 % contenu/SEO · 40 % publicité payante · 20 % outils & email.`
    : `# Marketing Strategy — ${name}

## Positioning
${name} helps its audience solve a concrete problem${idea ? `: ${idea}.` : "."} Value proposition: deliver the outcome faster and simpler, with zero friction.

## Ideal Customer (ICP)
- **Persona 1** — end user: wants a fast solution, trigger = wasted time/money.
- **Persona 2** — decision maker: wants measurable ROI, trigger = growth goal.

## Acquisition channels (ranked by ROI)
1. **SEO + content** — low cost, compounding. First action: publish 4 pillar articles.
2. **Paid ads (Meta/Google)** — fast to test. First action: 2 small-budget campaigns.
3. **Partnerships / communities** — high trust. First action: list 10 target communities in ${market}.
4. **Email** — best retention. First action: 3-email welcome sequence.

## Funnel
- Awareness: SEO + social content.
- Consideration: lead magnet + retargeting.
- Conversion: trial offer + social proof.
- Retention: onboarding + newsletter.

## KPIs
CAC, visitor→signup conversion, activation, 30-day retention, LTV.

## Starter budget (indicative)
- 40% content/SEO · 40% paid ads · 20% tools & email.`;

  const adsMd = fr
    ? `# Publicités & Emails — ${name}

## Publicités prêtes à publier
### Meta (Instagram/Facebook)
- **Accroche :** Le raccourci que vous cherchiez.
- **Corps :** ${name} vous fait gagner des heures dès le premier jour. Essayez gratuitement.
- **CTA :** Commencer

### Google (Search)
- **Accroche :** ${name} — résultats en minutes
- **Corps :** Simple, rapide, efficace. Rejoignez les premiers utilisateurs.
- **CTA :** Essayer maintenant

### TikTok
- **Accroche :** POV : tu découvres ${name}
- **Corps :** 15 s pour montrer le avant/après. Musique tendance + sous-titres.
- **CTA :** Teste gratuitement

## Emails
### Cold outreach
- **Objet :** Une idée pour {prénom}
- **Corps :** Bonjour {prénom}, j'ai vu que vous travailliez sur X. ${name} pourrait vous faire gagner du temps sur Y. Ouvert à un échange de 10 min ?

### Newsletter
- **Objet :** Ce que ${name} peut faire pour vous cette semaine
- **Corps :** 3 nouveautés, 1 astuce, 1 témoignage RÉEL d'un vrai client (à recueillir — jamais inventé). CTA clair vers l'app.`
    : `# Ads & Emails — ${name}

## Ready-to-publish ads
### Meta
- **Headline:** The shortcut you were looking for.
- **Body:** ${name} saves you hours from day one. Try it free.
- **CTA:** Get started

### Google (Search)
- **Headline:** ${name} — results in minutes
- **Body:** Simple, fast, effective. Join the first users.
- **CTA:** Try now

### TikTok
- **Headline:** POV: you discover ${name}
- **Body:** 15s before/after demo. Trending audio + captions.
- **CTA:** Try it free

## Emails
### Cold outreach
- **Subject:** A quick idea for {first_name}
- **Body:** Hi {first_name}, saw you're working on X. ${name} could save you time on Y. Open to a 10-min chat?

### Newsletter
- **Subject:** What ${name} can do for you this week
- **Body:** 3 updates, 1 tip, 1 REAL testimonial from an actual customer (collect it — never fabricate one). Clear CTA to the app.`;

  const calendarMd = fr
    ? `# Calendrier de contenu — 30 jours — ${name}

## Mots-clés SEO cibles
1. ${name.toLowerCase()} · 2. alternative à … · 3. comment faire X · 4. meilleur outil pour Y · 5. X pas cher · 6. X gratuit · 7. tutoriel X · 8. X vs concurrent · 9. avis X · 10. X pour débutants

## Calendrier (4 semaines)
- **Semaine 1 — Notoriété :** 2 articles piliers (SEO), 3 posts sociaux, 1 court format vidéo.
- **Semaine 2 — Éducation :** 1 guide pratique, 1 newsletter, 2 posts + 1 carrousel.
- **Semaine 3 — Preuve :** 1 étude de cas/témoignage issus d'un VRAI client (à recueillir avec son accord ; aucun faux avis — c'est illégal), 1 démo vidéo, 2 posts.
- **Semaine 4 — Conversion :** offre limitée, retargeting, 1 webinaire/live, récap newsletter.

## 3 posts sociaux prêts
- **Instagram :** Avant/après en 3 slides. Légende courte + CTA en bio.
- **LinkedIn :** Le problème qu'on résout, en 5 lignes + 1 chiffre réel et vérifiable + question finale.
- **X/Twitter :** Thread de 5 tweets : le déclic, la douleur, la solution, la preuve, le CTA.`
    : `# Content Calendar — 30 days — ${name}

## Target SEO keywords
1. ${name.toLowerCase()} · 2. alternative to … · 3. how to do X · 4. best tool for Y · 5. cheap X · 6. free X · 7. X tutorial · 8. X vs competitor · 9. X review · 10. X for beginners

## Calendar (4 weeks)
- **Week 1 — Awareness:** 2 pillar articles (SEO), 3 social posts, 1 short video.
- **Week 2 — Education:** 1 how-to guide, 1 newsletter, 2 posts + 1 carousel.
- **Week 3 — Proof:** 1 case study/testimonial from a REAL customer (collect it with their consent; fake reviews are illegal), 1 demo video, 2 posts.
- **Week 4 — Conversion:** limited offer, retargeting, 1 webinar/live, newsletter recap.

## 3 ready social posts
- **Instagram:** 3-slide before/after. Short caption + CTA in bio.
- **LinkedIn:** The problem we solve in 5 lines + 1 real, verifiable stat + closing question.
- **X/Twitter:** 5-tweet thread: the spark, the pain, the solution, the proof, the CTA.`;

  const files: MarketingFile[] = [
    { name: fr ? "Stratégie Marketing.md" : "Marketing Strategy.md", path: "marketing/Strategie-Marketing.md", content: strategyMd },
    { name: fr ? "Publicités & Emails.md" : "Ads & Emails.md", path: "marketing/Publicites-et-Emails.md", content: adsMd },
    { name: fr ? "Calendrier de contenu 30 jours.md" : "Content Calendar 30 days.md", path: "marketing/Calendrier-Contenu-30j.md", content: calendarMd },
  ];
  return { intro: defaultIntro(input), files };
}
