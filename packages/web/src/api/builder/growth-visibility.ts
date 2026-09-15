// ─── Dedicated Growth & Visibility AI (Claude Opus) ─────────────────────────
// A DEDICATED PR / content director that "reflects" and PROPOSES how to make the
// generated app/site KNOWN to the world. It produces a REAL, ready-to-execute
// visibility pack for the project being built:
//   1. Journalists & media  — REAL journalists/outlets found via live web search
//      (name, outlet, beat, public profile/article link, and a public contact ONLY
//      when it genuinely appears in the search results — never invented).
//   2. Press release         — ready to send.
//   3. Encyclopedic entry     — neutral Wikipedia-style reference article.
//   4. Directory listings     — ready copy for Product Hunt, Crunchbase, BetaList…
//   5. Blog articles          — full SEO articles ready to publish.
//   6. Newsletter             — welcome email + first 2 issues, ready to send.
//   7. Editorial calendar      — 30-day content plan across channels.
//   8. Reference mini-sites    — plan + ready-to-publish HTML pages that can rank
//      on Google so the project gets a "Wikipedia-like" external presence.
//
// The output is delivered to the user IN THE CHAT (the AI "speaks") together with
// DOWNLOADABLE FILES (rendered as rounded chips), plus a PROPOSAL to wire a
// functional newsletter section and a blog page into the app. Files are stored in
// the generated project's `projectFiles` under `visibilite/` so they are covered
// by the existing checkpoint / rollback / fork snapshot machinery.
//
// This module NEVER throws — on any AI failure it falls back to a solid built-in
// pack so a build always ships with a usable visibility kit.
import { generateText } from "ai";
import { gateway } from "../agent/gateway";
import { currentDateContext } from "./prompts";
import { webSearch, type SearchResult } from "../agents/web-research";

export interface VisibilityFile {
  name: string;    // display name, e.g. "Journalistes & Médias.md"
  path: string;    // project file path, e.g. "visibilite/Journalistes-Medias.md"
  content: string; // markdown content
}

export interface VisibilityPlan {
  intro: string;            // short chat message the AI "speaks"
  files: VisibilityFile[];  // downloadable markdown documents
  /** Proposal offering to wire newsletter + blog into the app (assistant chat). */
  proposal: string;
}

export interface PlanVisibilityInput {
  companyName: string;
  idea: string;
  industry?: string;
  country?: string;
  targetAudience?: string;
  url?: string;             // public URL/domain of the app, if known
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
    try {
      return JSON.parse(slice.replace(/,\s*([}\]])/g, "$1"));
    } catch {
      return null;
    }
  }
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

function coerceFiles(raw: any): VisibilityFile[] {
  if (!Array.isArray(raw)) return [];
  const files: VisibilityFile[] = [];
  for (const f of raw) {
    const name = typeof f?.name === "string" && f.name.trim() ? f.name.trim() : "";
    const content = typeof f?.content === "string" ? f.content.trim() : "";
    if (!name || !content || content.length < 40) continue;
    const fileName = /\.md$/i.test(name) ? name : `${name}.md`;
    files.push({ name: fileName, path: `visibilite/${slugifyName(fileName)}`, content });
  }
  return files;
}

// ── Live web research for REAL journalists / media ──────────────────────────
// Builds a few targeted queries from the project's industry/country and returns
// deduped real results (title/url/snippet). These are passed verbatim to the AI
// so it can ground the journalist list in reality and only surface contacts that
// truly appear in the snippets — it must NOT invent emails.
async function researchJournalists(input: PlanVisibilityInput): Promise<SearchResult[]> {
  const fr = input.lang !== "en";
  const sector = input.industry || input.idea.slice(0, 60);
  const geo = input.country ? ` ${input.country}` : "";
  const queries = fr
    ? [
        `journalistes tech${geo} qui couvrent ${sector}`,
        `médias${geo} startups ${sector} contact rédaction`,
        `blogueurs influenceurs ${sector}${geo} email contact`,
      ]
    : [
        `tech journalists${geo} covering ${sector}`,
        `${sector} startup media outlets${geo} editorial contact`,
        `${sector} bloggers influencers${geo} email contact`,
      ];
  const all: SearchResult[] = [];
  const seen = new Set<string>();
  for (const q of queries) {
    const res = await webSearch(q, 6).catch(() => [] as SearchResult[]);
    for (const r of res) {
      const key = (r.url || r.title || "").toLowerCase();
      if (!key || seen.has(key)) continue;
      seen.add(key);
      all.push(r);
      if (all.length >= 18) break;
    }
    if (all.length >= 18) break;
  }
  return all;
}

const VISIBILITY_SYSTEM = `Tu es le Directeur PR & Contenu de Velbaz — un expert en relations presse, SEO et growth content (niveau Head of Communications d'une scale-up).
Tu produis des documents CONCRETS, PRÊTS À PUBLIER et PROFESSIONNELS — jamais de théorie creuse, jamais de placeholders "[insérer ici]".
Tu écris le VRAI contenu (vrais articles, vrais emails, vrai communiqué, vraie fiche encyclopédique neutre).
RÈGLE ABSOLUE SUR LES CONTACTS : tu ne DOIS JAMAIS inventer d'email, de téléphone ou de handle. Tu n'utilises QUE les contacts publics qui apparaissent réellement dans les résultats de recherche fournis. Si aucun contact n'apparaît, mets le lien du profil/média public et écris "contact via le média" — jamais une adresse inventée.
Tu adaptes le ton, les médias et les plateformes au pays / marché indiqué et au secteur réel du produit.
Tu réponds STRICTEMENT en JSON valide, sans texte autour.${currentDateContext()}`;

function visibilityPrompt(input: PlanVisibilityInput, research: SearchResult[]): string {
  const fr = input.lang !== "en";
  const researchBlock = research.length
    ? research.map((r, i) => `[${i + 1}] ${r.title}\n    ${r.url}\n    ${r.snippet || ""}`).join("\n")
    : "(aucun résultat de recherche disponible — base-toi sur des médias réels et connus du secteur, sans inventer de contacts)";

  return `Élabore un PACK VISIBILITÉ & RELATIONS PRESSE complet et prêt à exécuter pour ce projet.

## PROJET
- Nom: ${input.companyName}
- Idée / description: ${input.idea}
${input.industry ? `- Secteur: ${input.industry}` : ""}
${input.targetAudience ? `- Audience visée: ${input.targetAudience}` : ""}
${input.country ? `- Pays / marché principal: ${input.country} (adapte médias, plateformes, ton et langue)` : ""}
${input.url ? `- URL publique: ${input.url}` : ""}
- Langue de rédaction des documents: ${fr ? "FRANÇAIS" : "ANGLAIS"}

## RÉSULTATS DE RECHERCHE WEB (journalistes / médias réels — source de vérité pour les contacts)
${researchBlock}

## CE QUE TU DOIS PRODUIRE — un tableau "files" de documents markdown RÉELS et DENSES :
1. "Journalistes & Médias" — un tableau de 8 à 15 journalistes / médias / blogueurs RÉELS et PERTINENTS pour ce secteur${input.country ? ` sur ${input.country}` : ""}. Pour chacun : Nom · Média · Sujet/angle qu'il couvre · Lien public (profil ou article, tiré des résultats) · Contact public UNIQUEMENT s'il apparaît dans les résultats, sinon "contact via le média". Ajoute pour chaque entrée une phrase d'angle : pourquoi CE journaliste s'intéresserait à ${input.companyName}.
2. "Communiqué de Presse" — communiqué complet prêt à envoyer (titre accrocheur, chapô, corps, citation du fondateur, boilerplate, contact presse).
3. "Fiche Encyclopédique" — article de référence NEUTRE façon Wikipédia (ton encyclopédique, sections: Présentation, Historique, Fonctionnement, Réception), pour publication sur des wikis/annuaires. Pas de langage promotionnel.
4. "Fiches Annuaires" — copie prête à soumettre pour Product Hunt, Crunchbase, BetaList, AlternativeTo et 2-3 annuaires pertinents au secteur/pays (tagline, description courte, description longue, tags).
5. "Articles de Blog" — 3 articles de blog COMPLETS et optimisés SEO (titre, meta description, 500-800 mots chacun, sous-titres H2/H3), sujets ciblés sur le secteur et les requêtes de l'audience.
6. "Newsletter" — un email de bienvenue + les 2 premiers numéros complets (objet + corps rédigé), avec CTA vers l'app.
7. "Calendrier Éditorial" — planning de contenu sur 30 jours (tableau: jour, canal, format, sujet, objectif).
8. "Sites de Référence" — plan + 1 à 2 pages HTML COMPLÈTES prêtes à publier (mini-site de référence / page "à propos de ${input.companyName}") conçues pour être indexées et ranker sur Google, afin de créer une présence externe façon Wikipédia. Inclus le HTML complet dans des blocs de code.

## FORMAT DE SORTIE (JSON strict)
{
  "intro": "message court et chaleureux que l'IA dit dans le chat pour présenter le pack (2-3 phrases)",
  "proposal": "message court proposant d'ajouter DANS l'app une section newsletter fonctionnelle (formulaire câblé) et une page blog avec les articles — demande à l'utilisateur son feu vert",
  "files": [ { "name": "Journalistes & Médias", "content": "markdown..." }, ... ]
}

Écris du contenu DENSE et utilisable immédiatement. Pas de "[insérer ici]". Pas de commentaire hors JSON. N'invente AUCUN contact.`;
}

/**
 * Run the dedicated growth/visibility AI. NEVER throws — falls back to a solid
 * built-in pack on any failure so a build always ships with a usable kit.
 */
export async function planVisibilityStrategy(
  input: PlanVisibilityInput,
  onProgress?: (msg: string) => void,
): Promise<VisibilityPlan> {
  const p = (m: string) => { try { onProgress?.(m); } catch { /* ignore */ } };
  const market = input.country ? ` (${input.country})` : "";
  p(`📰 Directeur PR & Contenu — recherche de journalistes réels${market}…`);
  const research = await researchJournalists(input).catch(() => [] as SearchResult[]);
  if (research.length) p(`🔎 ${research.length} médias / journalistes trouvés via recherche web`);
  p(`✍️ Rédaction du pack visibilité (presse, blog, newsletter, annuaires, fiche encyclopédique)…`);
  try {
    const { text } = await generateText({
      model: gateway("openai/gpt-5.4-mini"),
      system: VISIBILITY_SYSTEM,
      prompt: visibilityPrompt(input, research),
      maxOutputTokens: 16000,
    });
    const json = extractJSON(text);
    if (!json) throw new Error("visibility: unparseable JSON");
    const files = coerceFiles(json.files);
    if (!files.length) throw new Error("visibility: no usable files");
    const intro = typeof json.intro === "string" && json.intro.trim()
      ? json.intro.trim()
      : defaultIntro(input);
    const proposal = typeof json.proposal === "string" && json.proposal.trim()
      ? json.proposal.trim()
      : defaultProposal(input);
    p(`✅ Pack visibilité prêt — ${files.length} document(s)`);
    return { intro, files, proposal };
  } catch (err: any) {
    p(`⚠️ Pack visibilité — repli sur le modèle intégré (${err?.message || "erreur IA"})`);
    return defaultVisibilityPlan(input, research);
  }
}

function defaultIntro(input: PlanVisibilityInput): string {
  const fr = input.lang !== "en";
  return fr
    ? `J'ai aussi réfléchi à comment faire CONNAÎTRE ${input.companyName} : j'ai préparé un pack visibilité complet — une liste de journalistes et médias réels à contacter, un communiqué de presse, une fiche encyclopédique, des fiches pour les annuaires, des articles de blog, une newsletter et un calendrier éditorial. Tout est téléchargeable ci-dessous.`
    : `I also thought about how to get ${input.companyName} KNOWN: I've prepared a full visibility pack — a list of real journalists and media to reach out to, a press release, an encyclopedic entry, directory listings, blog articles, a newsletter and an editorial calendar. Everything is downloadable below.`;
}

function defaultProposal(input: PlanVisibilityInput): string {
  const fr = input.lang !== "en";
  return fr
    ? `Veux-tu que j'ajoute directement DANS ${input.companyName} : (1) une section newsletter avec un vrai formulaire d'inscription (câblé à la base de données) et (2) une page Blog avec les articles déjà rédigés ? Dis-moi oui et je le fais.`
    : `Want me to add directly INTO ${input.companyName}: (1) a newsletter section with a real, database-wired signup form and (2) a Blog page with the articles already written? Say yes and I'll do it.`;
}

// ── Solid built-in fallback so a build NEVER ships without a visibility pack ──
function defaultVisibilityPlan(input: PlanVisibilityInput, research: SearchResult[]): VisibilityPlan {
  const fr = input.lang !== "en";
  const name = input.companyName || (fr ? "votre projet" : "your project");
  const idea = input.idea || "";
  const sector = input.industry || (fr ? "votre secteur" : "your sector");
  const geo = input.country || (fr ? "votre marché" : "your market");

  // Journalist table grounded in whatever real results we did fetch.
  const jRows = research.slice(0, 12).map((r) => {
    const outlet = (() => {
      try { return new URL(r.url).hostname.replace(/^www\./, ""); } catch { return r.url; }
    })();
    const emailMatch = (r.snippet || "").match(/[\w.+-]+@[\w-]+\.[\w.-]+/);
    const contact = emailMatch ? emailMatch[0] : (fr ? "contact via le média" : "contact via outlet");
    return `| ${r.title.slice(0, 60)} | ${outlet} | ${r.url} | ${contact} |`;
  }).join("\n");

  const journalistsMd = fr
    ? `# Journalistes & Médias — ${name}

Liste de médias et journalistes réels repérés pour le secteur « ${sector} »${input.country ? ` sur ${geo}` : ""}. Les contacts affichés proviennent uniquement des sources publiques ; sinon, passe par la page contact/rédaction du média.

| Média / Journaliste | Source | Lien public | Contact public |
|---|---|---|---|
${jRows || `| (relance une recherche depuis l'onglet Visibilité pour peupler cette liste) | — | — | — |`}

## Comment les contacter
1. Personnalise chaque message : cite un article récent qu'ils ont écrit.
2. Pitch en 3 lignes : le problème, ce que ${name} change, pourquoi c'est nouveau maintenant.
3. Joins le communiqué de presse + 2 visuels. Relance une fois après 5 jours ouvrés.`
    : `# Journalists & Media — ${name}

Real outlets and journalists spotted for the "${sector}" sector${input.country ? ` in ${geo}` : ""}. Displayed contacts come only from public sources; otherwise use the outlet's contact/newsroom page.

| Outlet / Journalist | Source | Public link | Public contact |
|---|---|---|---|
${jRows || `| (run a search from the Visibility tab to populate this list) | — | — | — |`}

## How to reach out
1. Personalize every message: reference a recent article they wrote.
2. 3-line pitch: the problem, what ${name} changes, why it's new now.
3. Attach the press release + 2 visuals. Follow up once after 5 business days.`;

  const pressMd = fr
    ? `# Communiqué de Presse — ${name}

**POUR DIFFUSION IMMÉDIATE**

## ${name} lance ${idea ? idea.slice(0, 80) : "une nouvelle solution"} pour ${geo}

${geo}, ${new Date().toLocaleDateString("fr-FR")} — ${name} annonce le lancement de sa solution destinée à ${input.targetAudience || "son marché"}. ${idea}

« Nous voulons rendre cela simple et accessible à tous », déclare le fondateur de ${name}.

### À propos de ${name}
${name} est une solution du secteur ${sector}. ${idea}

**Contact presse :** ${input.url || "voir le site officiel"}`
    : `# Press Release — ${name}

**FOR IMMEDIATE RELEASE**

## ${name} launches ${idea ? idea.slice(0, 80) : "a new solution"} for ${geo}

${geo}, ${new Date().toLocaleDateString("en-US")} — ${name} announces the launch of its solution for ${input.targetAudience || "its market"}. ${idea}

"We want to make this simple and accessible to everyone," says ${name}'s founder.

### About ${name}
${name} is a ${sector} solution. ${idea}

**Press contact:** ${input.url || "see official website"}`;

  const encycloMd = fr
    ? `# ${name}

**${name}** est ${idea ? idea : `un produit du secteur ${sector}`}.

## Présentation
${name} propose une solution destinée à ${input.targetAudience || "son marché"}.

## Historique
Le projet a été lancé en ${new Date().getFullYear()}.

## Fonctionnement
${idea}

## Réception
(à compléter avec les premières mentions presse et retours utilisateurs)`
    : `# ${name}

**${name}** is ${idea ? idea : `a product in the ${sector} sector`}.

## Overview
${name} offers a solution for ${input.targetAudience || "its market"}.

## History
The project launched in ${new Date().getFullYear()}.

## How it works
${idea}

## Reception
(to be completed with early press mentions and user feedback)`;

  const directoryMd = fr
    ? `# Fiches Annuaires — ${name}

## Product Hunt
- **Tagline :** ${name} — ${idea.slice(0, 60)}
- **Description :** ${idea}
- **Tags :** ${sector}, productivité, ${geo}

## Crunchbase / BetaList / AlternativeTo
- **Description courte :** ${name}, solution ${sector}.
- **Description longue :** ${idea}`
    : `# Directory Listings — ${name}

## Product Hunt
- **Tagline:** ${name} — ${idea.slice(0, 60)}
- **Description:** ${idea}
- **Tags:** ${sector}, productivity, ${geo}

## Crunchbase / BetaList / AlternativeTo
- **Short description:** ${name}, a ${sector} solution.
- **Long description:** ${idea}`;

  const blogMd = fr
    ? `# Articles de Blog — ${name}

## Article 1 — Pourquoi ${sector} a besoin de ${name}
*Meta : Découvrez comment ${name} change la donne dans ${sector}.*

(500-800 mots — introduction du problème, solution, bénéfices, CTA vers l'app.)

## Article 2 — Guide pratique
*Meta : Le guide pas-à-pas pour bien démarrer.*

## Article 3 — Étude de cas / retour d'expérience
*Meta : Comment nos utilisateurs gagnent du temps avec ${name}.*`
    : `# Blog Articles — ${name}

## Article 1 — Why ${sector} needs ${name}
*Meta: Discover how ${name} changes the game in ${sector}.*

## Article 2 — Practical guide

## Article 3 — Case study`;

  const newsletterMd = fr
    ? `# Newsletter — ${name}

## Email de bienvenue
**Objet :** Bienvenue chez ${name} 👋
Merci de votre inscription ! Voici comment tirer le meilleur de ${name}…

## Numéro 1
**Objet :** 3 façons d'utiliser ${name} cette semaine

## Numéro 2
**Objet :** Nouveautés + une astuce de pro`
    : `# Newsletter — ${name}

## Welcome email
**Subject:** Welcome to ${name} 👋

## Issue 1
**Subject:** 3 ways to use ${name} this week

## Issue 2
**Subject:** What's new + a pro tip`;

  const calendarMd = fr
    ? `# Calendrier Éditorial 30 jours — ${name}

| Jour | Canal | Format | Sujet | Objectif |
|---|---|---|---|---|
| 1 | Blog | Article | Pourquoi ${name} | SEO / notoriété |
| 3 | LinkedIn | Post | Problème du secteur | Engagement |
| 5 | Newsletter | Email | Bienvenue | Rétention |
| 8 | Presse | Pitch | Communiqué | Couverture média |
| 12 | Blog | Guide | Prise en main | SEO |
| 15 | Réseaux | Carrousel | Astuces | Portée |
| 20 | Annuaires | Soumission | Product Hunt | Acquisition |
| 25 | Newsletter | Email | Nouveautés | Rétention |
| 30 | Blog | Étude de cas | Preuve sociale | Conversion |`
    : `# 30-Day Editorial Calendar — ${name}

| Day | Channel | Format | Topic | Goal |
|---|---|---|---|---|
| 1 | Blog | Article | Why ${name} | SEO / awareness |
| 5 | Newsletter | Email | Welcome | Retention |
| 8 | Press | Pitch | Press release | Media coverage |
| 20 | Directories | Submission | Product Hunt | Acquisition |`;

  const refSiteMd = fr
    ? `# Sites de Référence — ${name}

Publie ces pages sur un domaine/hébergement gratuit (GitHub Pages, Notion public, Medium) pour créer une présence externe indexable sur Google.

## Page "À propos de ${name}"
\`\`\`html
<!DOCTYPE html>
<html lang="fr"><head><meta charset="utf-8">
<title>${name} — ${sector}</title>
<meta name="description" content="${idea.slice(0, 150)}">
</head><body>
<h1>${name}</h1>
<p>${idea}</p>
<h2>Ce que propose ${name}</h2>
<p>Solution ${sector} pour ${input.targetAudience || "son marché"}.</p>
<p><a href="${input.url || "#"}">Site officiel</a></p>
</body></html>
\`\`\``
    : `# Reference Sites — ${name}

Publish these pages on free hosting (GitHub Pages, public Notion, Medium) to build an indexable external presence on Google.

## "About ${name}" page
\`\`\`html
<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8">
<title>${name} — ${sector}</title>
<meta name="description" content="${idea.slice(0, 150)}">
</head><body>
<h1>${name}</h1>
<p>${idea}</p>
<p><a href="${input.url || "#"}">Official site</a></p>
</body></html>
\`\`\``;

  const rawFiles: { name: string; content: string }[] = [
    { name: "Journalistes & Médias", content: journalistsMd },
    { name: "Communiqué de Presse", content: pressMd },
    { name: "Fiche Encyclopédique", content: encycloMd },
    { name: "Fiches Annuaires", content: directoryMd },
    { name: "Articles de Blog", content: blogMd },
    { name: "Newsletter", content: newsletterMd },
    { name: "Calendrier Éditorial", content: calendarMd },
    { name: "Sites de Référence", content: refSiteMd },
  ];
  const files = coerceFiles(rawFiles);
  return { intro: defaultIntro(input), files, proposal: defaultProposal(input) };
}
