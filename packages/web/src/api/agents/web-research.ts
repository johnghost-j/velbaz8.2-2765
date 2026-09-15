// ─── Web Research Module — VRAIE recherche web + scraping (sans clé API) ─────
// Utilisé par l'Agent Research pour analyser des données RÉELLES au lieu d'inventer.
// - webSearch(): résultats via DuckDuckGo HTML (pas de clé requise)
// - scrapeUrl(): fetch + extraction texte propre (title, description, headings, body)
// - extractReferenceUrls(): détecte "comme X", "like X.com", domaines dans l'idée
// - researchReference(): scrape la référence + trouve/scrape des concurrents
// - findKnownReference(): base curée (Velbaz, Lovable, Bolt, v0, Notion…) pour
//   les produits privés/non scrapables — injecte une spec riche et fiable.

import { findKnownReference, formatKnownReference } from "./known-references";
import { findIndustryPlaybook, formatIndustryPlaybook } from "./industry-playbooks";
import { webSearchResults } from "../web-tools";

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";

async function timedFetch(url: string, ms = 8000): Promise<Response | null> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms);
  try {
    const res = await fetch(url, {
      signal: ctrl.signal,
      headers: {
        "User-Agent": UA,
        Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.9,fr;q=0.8",
      },
      redirect: "follow",
    });
    return res;
  } catch {
    return null;
  } finally {
    clearTimeout(t);
  }
}

function decodeEntities(s: string): string {
  return s
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#x27;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/&#(\d+);/g, (_, d) => String.fromCharCode(parseInt(d, 10)));
}

function stripTags(html: string): string {
  return decodeEntities(
    html
      .replace(/<script[\s\S]*?<\/script>/gi, " ")
      .replace(/<style[\s\S]*?<\/style>/gi, " ")
      .replace(/<[^>]+>/g, " ")
      .replace(/\s+/g, " ")
  ).trim();
}

export interface SearchResult {
  title: string;
  url: string;
  snippet: string;
}

// Primary: DuckDuckGo HTML (accurate, relevance-verified). Fallback: Bing RSS
// (its results were observed to be completely off-topic for some queries, so it
// is now LAST resort only).
export async function webSearch(query: string, limit = 6): Promise<SearchResult[]> {
  // ── 1) DuckDuckGo structured search — same engine as the chat web access ──
  try {
    const ddg = await webSearchResults(query, limit);
    if (ddg.length > 0) return ddg;
  } catch { /* fall through */ }

  // ── 2) Bing RSS feed — last resort (relevance is unreliable) ──
  const rss = await bingRssSearch(query, limit);
  if (rss.length > 0) return rss;

  // ── 2) Fallback: DuckDuckGo HTML/lite (often 202-challenged, best-effort) ──
  const endpoints = [
    `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`,
    `https://lite.duckduckgo.com/lite/?q=${encodeURIComponent(query)}`,
  ];
  for (const ep of endpoints) {
    const res = await timedFetch(ep, 9000);
    if (!res || !res.ok) continue;
    const html = await res.text();
    const results: SearchResult[] = [];

    const linkRe =
      /<a[^>]+class="result__a"[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi;
    let m: RegExpExecArray | null;
    while ((m = linkRe.exec(html)) !== null && results.length < limit) {
      let href = decodeEntities(m[1]);
      const ddg = href.match(/uddg=([^&]+)/);
      if (ddg) href = decodeURIComponent(ddg[1]);
      const title = stripTags(m[2]);
      if (href.startsWith("http") && title) {
        results.push({ title, url: href, snippet: "" });
      }
    }

    const snipRe = /<a[^>]+class="result__snippet"[^>]*>([\s\S]*?)<\/a>/gi;
    let si = 0;
    let sm: RegExpExecArray | null;
    while ((sm = snipRe.exec(html)) !== null && si < results.length) {
      results[si].snippet = stripTags(sm[1]);
      si++;
    }

    if (results.length === 0) {
      const liteRe = /<a[^>]+href="(https?:\/\/[^"]+)"[^>]*>([\s\S]*?)<\/a>/gi;
      while ((m = liteRe.exec(html)) !== null && results.length < limit) {
        const href = decodeEntities(m[1]);
        const title = stripTags(m[2]);
        if (
          title.length > 8 &&
          !href.includes("duckduckgo.com") &&
          !href.includes("javascript:")
        ) {
          results.push({ title, url: href, snippet: "" });
        }
      }
    }

    if (results.length > 0) return results;
  }
  return [];
}

// Bing RSS: https://www.bing.com/search?format=rss&q=... → parseable XML <item>s.
async function bingRssSearch(query: string, limit: number): Promise<SearchResult[]> {
  const url = `https://www.bing.com/search?format=rss&q=${encodeURIComponent(
    query
  )}&setlang=en&cc=US&count=${Math.max(limit, 10)}`;
  const res = await timedFetch(url, 9000);
  if (!res || !res.ok) return [];
  const xml = await res.text();
  const results: SearchResult[] = [];
  const cdata = (s: string) =>
    decodeEntities(s.replace(/^<!\[CDATA\[/, "").replace(/\]\]>$/, "")).trim();
  const itemRe = /<item>([\s\S]*?)<\/item>/gi;
  let m: RegExpExecArray | null;
  while ((m = itemRe.exec(xml)) !== null && results.length < limit) {
    const block = m[1];
    const title = cdata((block.match(/<title>([\s\S]*?)<\/title>/) || [])[1] || "");
    const link = cdata((block.match(/<link>([\s\S]*?)<\/link>/) || [])[1] || "");
    const desc = stripTags(
      cdata((block.match(/<description>([\s\S]*?)<\/description>/) || [])[1] || "")
    );
    if (link.startsWith("http") && title) {
      results.push({ title, url: link, snippet: desc });
    }
  }
  return results;
}

export interface ScrapedPage {
  url: string;
  title: string;
  description: string;
  headings: string[];
  text: string;
  ok: boolean;
}

export async function scrapeUrl(url: string, maxChars = 4000): Promise<ScrapedPage> {
  const empty: ScrapedPage = {
    url,
    title: "",
    description: "",
    headings: [],
    text: "",
    ok: false,
  };
  if (!/^https?:\/\//.test(url)) url = "https://" + url;
  const res = await timedFetch(url, 9000);
  if (!res || !res.ok) return empty;
  const ct = res.headers.get("content-type") || "";
  if (!ct.includes("text/html") && !ct.includes("text/plain")) return empty;

  const html = (await res.text()).slice(0, 600_000);

  const titleM = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  const title = titleM ? stripTags(titleM[1]) : "";

  const descM =
    html.match(
      /<meta[^>]+name=["']description["'][^>]+content=["']([^"']+)["']/i
    ) ||
    html.match(
      /<meta[^>]+property=["']og:description["'][^>]+content=["']([^"']+)["']/i
    );
  const description = descM ? decodeEntities(descM[1]).trim() : "";

  const headings: string[] = [];
  const hRe = /<h[1-3][^>]*>([\s\S]*?)<\/h[1-3]>/gi;
  let hm: RegExpExecArray | null;
  while ((hm = hRe.exec(html)) !== null && headings.length < 25) {
    const h = stripTags(hm[1]);
    if (h && h.length < 160) headings.push(h);
  }

  // Prefer main/article body if present
  const bodyM =
    html.match(/<main[\s\S]*?<\/main>/i) ||
    html.match(/<article[\s\S]*?<\/article>/i) ||
    html.match(/<body[\s\S]*?<\/body>/i);
  const text = stripTags(bodyM ? bodyM[0] : html).slice(0, maxChars);

  return {
    url,
    title,
    description,
    headings,
    text,
    ok: title.length > 0 || text.length > 100,
  };
}

export interface ExtractedRefs {
  /** Explicit domains typed by the user (respected as-is). */
  domains: string[];
  /** Bare brand names ("comme Notion") — resolved to a real site via search. */
  brands: string[];
}

// Detect a reference the user points at: "comme lovable.com", "like Notion",
// "similaire à stripe", a bare domain, etc.
export function extractReferences(idea: string): ExtractedRefs {
  const domains = new Set<string>();
  const brands = new Set<string>();
  if (!idea) return { domains: [], brands: [] };

  // Explicit domains anywhere in the text
  const domainRe =
    /\b((?:https?:\/\/)?(?:www\.)?[a-z0-9][a-z0-9-]{1,60}\.(?:com|io|co|ai|app|dev|net|org|xyz|so|gg))\b/gi;
  let m: RegExpExecArray | null;
  while ((m = domainRe.exec(idea)) !== null) {
    const d = m[1].toLowerCase().replace(/^https?:\/\//, "").replace(/^www\./, "");
    domains.add(d);
  }

  // "comme X" / "like X" / "similaire à X" / "inspiré de X" (bare brand names)
  const refRe =
    /(?:comme|like|similaire\s+à|similar\s+to|inspir[ée]?\s+(?:de|par|by)|clone\s+(?:de|of)?|à\s+la\s+(?:mani[èe]re|fa[çc]on)\s+de|style|type)\s+([a-z0-9][a-z0-9 .&-]{1,40})/gi;
  while ((m = refRe.exec(idea)) !== null) {
    const raw = m[1].trim().split(/[,.;\n]|\bet\b|\band\b|\bpour\b|\bqui\b/)[0].trim();
    if (!raw) continue;
    if (/\.(com|io|co|ai|app|dev|net|org|xyz|so|gg)$/i.test(raw)) {
      domains.add(raw.toLowerCase().replace(/^www\./, ""));
    } else if (/^[a-z0-9][a-z0-9 &-]{1,30}$/i.test(raw) && raw.length >= 2) {
      brands.add(raw.trim());
    }
  }

  // Don't search a brand if the user already gave its explicit domain
  const domainRoots = new Set(
    Array.from(domains).map((d) => d.split(".")[0])
  );
  const cleanBrands = Array.from(brands).filter(
    (b) => !domainRoots.has(b.replace(/\s+/g, "").toLowerCase())
  );

  return {
    domains: Array.from(domains).slice(0, 3),
    brands: cleanBrands.slice(0, 2),
  };
}

// Backwards-compatible helper (domains only).
export function extractReferenceUrls(idea: string): string[] {
  return extractReferences(idea).domains;
}

// Resolve a bare brand name ("Notion") to its most likely official domain via search.
async function resolveBrandDomain(brand: string): Promise<string | null> {
  const results = await webSearch(`${brand} official site`, 6);
  if (!results.length) return null;
  const slug = brand.replace(/[^a-z0-9]/gi, "").toLowerCase();
  const badHosts =
    /(wikipedia|linkedin|crunchbase|facebook|twitter|x\.com|youtube|instagram|reddit|glassdoor|g2\.com|capterra|trustpilot|producthunt)/i;
  for (const r of results) {
    try {
      const host = new URL(r.url).hostname.replace(/^www\./, "");
      if (badHosts.test(host)) continue;
      const root = host.split(".")[0];
      // Prefer a host whose root matches the brand slug
      if (slug.includes(root) || root.includes(slug.slice(0, 6))) return host;
    } catch {
      /* ignore */
    }
  }
  // Fallback: first non-blacklisted host
  for (const r of results) {
    try {
      const host = new URL(r.url).hostname.replace(/^www\./, "");
      if (!badHosts.test(host)) return host;
    } catch {
      /* ignore */
    }
  }
  return null;
}

export interface WebResearchBundle {
  referenceSummaries: Array<{ url: string; title: string; summary: string }>;
  searchFindings: string;
  hasRealData: boolean;
  /** Spec curée d'une référence connue (Velbaz, Lovable…) si détectée. */
  knownReference?: string;
  /** Playbook du secteur (meilleurs du monde par TYPE d'entreprise) si détecté. */
  industryPlaybook?: string;
}

// The company "idea" often arrives as a full chat transcript
// ("User: salut\nAI: Salut! 👋 ...\nUser: je veux une app de ...").
// Using it verbatim as a search topic leaks conversational chatter into the
// task panel. Distill it down to the actual business concept.
function cleanTopic(idea: string, industry?: string): string {
  let t = (idea || "").trim();
  if (t.includes("\n") || /\b(User|AI|Assistant)\s*:/i.test(t)) {
    // Transcript format — keep only the USER lines (their described intent),
    // drop the assistant chit-chat, and strip the "User:" prefixes.
    const userLines = t
      .split("\n")
      .filter((l) => /^\s*User\s*:/i.test(l))
      .map((l) => l.replace(/^\s*User\s*:/i, "").trim())
      .filter(Boolean);
    if (userLines.length) {
      // Prefer the longest user line — that's usually the real idea, not "salut".
      t = userLines.sort((a, b) => b.length - a.length)[0] || t;
    } else {
      // No explicit user lines — just take the first line.
      t = (t.split("\n")[0] || "").trim();
    }
  }
  // Drop leftover role markers, greetings and filler.
  t = t
    .replace(/\b(User|AI|Assistant)\s*:/gi, " ")
    .replace(/[👋🚀✨🎉]/gu, " ")
    .replace(/^\s*(salut|bonjour|hello|hi|hey|coucou|merci|thanks|ok|d'accord)\b[\s,!.]*/i, "")
    .replace(/\s+/g, " ")
    .trim();
  // If nothing meaningful survived, fall back to the industry.
  if (t.length < 4) t = industry || "";
  return t.slice(0, 80);
}

// Full research pass: scrape reference(s) + run market/competitor searches.
export async function gatherWebResearch(
  idea: string,
  industry?: string,
  onProgress?: (msg: string) => void
): Promise<WebResearchBundle> {
  const bundle: WebResearchBundle = {
    referenceSummaries: [],
    searchFindings: "",
    hasRealData: false,
  };

  // Distill the (possibly transcript-shaped) idea into a clean concept before
  // extracting references — otherwise greetings/AI replies leak into the panel.
  const cleanedIdea = cleanTopic(idea, industry);

  // 0) Référence CONNUE (base curée) : Velbaz, Lovable, Bolt, v0, Notion…
  // On matche sur l'idée nettoyée ET le message brut (au cas où le nom du
  // produit vit dans le transcript). Prioritaire car fiable et riche.
  const known =
    findKnownReference(cleanedIdea) || findKnownReference(idea);
  if (known) {
    bundle.knownReference = formatKnownReference(known);
    bundle.hasRealData = true;
    onProgress?.(`🎯 Référence reconnue : ${known.name} — spec produit chargée`);
  }

  // 0bis) Playbook SECTORIEL (meilleurs du monde par TYPE d'entreprise) —
  // se déclenche même SANS référence nommée (ex: "une salle de sport", "un
  // cabinet dentaire"). Complémentaire à la référence connue, pas exclusif :
  // une idée peut être à la fois un produit nommé ET matcher un secteur.
  const playbook = findIndustryPlaybook(`${cleanedIdea} ${industry || ""}`);
  if (playbook) {
    bundle.industryPlaybook = formatIndustryPlaybook(playbook);
    bundle.hasRealData = true;
    onProgress?.(`🏆 Secteur détecté : ${playbook.name} — meilleures pratiques du secteur chargées`);
  }

  const { domains, brands } = extractReferences(cleanedIdea);
  const refs = [...domains];

  // Resolve bare brand names ("comme Notion") → real official domain via search.
  for (const brand of brands) {
    // Si ce brand est DÉJÀ couvert par la base curée, ne pas tenter de le
    // résoudre en domaine web : ça donne souvent un faux positif (ex: "Velbaz"
    // → merriam-webster.com) qui pollue la recherche. La spec connue suffit.
    if (known && findKnownReference(brand)) {
      onProgress?.(`   → "${brand}" couvert par la spec connue (${known.name})`);
      continue;
    }
    onProgress?.(`🔎 Résolution de "${brand}"…`);
    const resolved = await resolveBrandDomain(brand);
    if (resolved && !refs.includes(resolved)) {
      refs.push(resolved);
      onProgress?.(`   → ${brand} = ${resolved}`);
    }
  }

  // 1) Scrape referenced sites
  if (refs.length) {
    onProgress?.(`🔎 Analyse des références: ${refs.join(", ")}`);
    const scraped = await Promise.all(refs.slice(0, 3).map((r) => scrapeUrl(r, 3500)));
    for (const p of scraped) {
      if (p.ok) {
        const summary = [
          p.description && `Description: ${p.description}`,
          p.headings.length && `Sections: ${p.headings.slice(0, 12).join(" | ")}`,
          p.text && `Extrait: ${p.text.slice(0, 1200)}`,
        ]
          .filter(Boolean)
          .join("\n");
        bundle.referenceSummaries.push({ url: p.url, title: p.title, summary });
        bundle.hasRealData = true;
      }
    }
  }

  // 2) DEEP market + competitor research — everything needed to build the BEST
  // company in this space: competitors, pricing, market size, customer pain
  // points, marketing strategies. All queries run in PARALLEL for speed.
  const topic = cleanedIdea;
  const year = new Date().getFullYear();
  const queries: string[] = [];
  if (refs.length) {
    queries.push(`${refs[0]} alternatives concurrents`);
    queries.push(`${refs[0]} pricing avis review`);
  }
  if (topic) {
    queries.push(`meilleurs ${topic} entreprises concurrents ${year}`);
    queries.push(`${topic} market size trends ${year}`);
    queries.push(`${topic} prix tarifs business model`);
    queries.push(`${topic} avis clients problèmes complaints`);
    queries.push(`${topic} stratégie marketing cible audience`);
  }

  const uniq = [...new Set(queries)].slice(0, 6);
  onProgress?.(`🌐 Recherche web approfondie : ${uniq.length} requêtes (concurrents, prix, marché, avis clients, marketing)…`);
  const searchResults = await Promise.all(
    uniq.map(async (q) => ({ q, results: await webSearch(q, 5).catch(() => [] as SearchResult[]) }))
  );

  const findings: string[] = [];
  const competitorHosts: string[] = [];
  const badHosts = /google|youtube|facebook|wikipedia|reddit|linkedin|twitter|x\.com|instagram|tiktok|amazon\.|quora|medium\.com|forbes|capterra|g2\.com|trustpilot|producthunt|github|apple\.com|play\.google/i;
  for (const { q, results } of searchResults) {
    if (!results.length) continue;
    bundle.hasRealData = true;
    onProgress?.(`   ✓ "${q}" → ${results.length} résultats`);
    findings.push(
      `### "${q}"\n` +
        results
          .map((r, i) => `${i + 1}. ${r.title} — ${r.url}${r.snippet ? `\n   ${r.snippet}` : ""}`)
          .join("\n")
    );
    // Collect real competitor sites from the competitor-focused queries
    if (/concurrent|competitor|alternative|meilleur/i.test(q)) {
      for (const r of results) {
        try {
          const host = new URL(r.url).hostname.replace(/^www\./, "");
          if (!badHosts.test(host) && !refs.includes(host) && !competitorHosts.includes(host)) {
            competitorHosts.push(host);
          }
        } catch { /* ignore */ }
      }
    }
  }
  bundle.searchFindings = findings.join("\n\n");

  // 3) SCRAPE the top competitor sites found — real offers, pricing, positioning
  const toScrape = competitorHosts.slice(0, 3);
  if (toScrape.length) {
    onProgress?.(`🔎 Analyse des sites concurrents : ${toScrape.join(", ")}`);
    const scrapedComp = await Promise.all(toScrape.map((h) => scrapeUrl(h, 3000)));
    for (const p of scrapedComp) {
      if (p.ok && (p.description || p.text)) {
        const summary = [
          p.description && `Description: ${p.description}`,
          p.headings.length && `Sections: ${p.headings.slice(0, 10).join(" | ")}`,
          p.text && `Extrait: ${p.text.slice(0, 900)}`,
        ]
          .filter(Boolean)
          .join("\n");
        bundle.referenceSummaries.push({ url: p.url, title: `CONCURRENT — ${p.title || p.url}`, summary });
        bundle.hasRealData = true;
        onProgress?.(`   ✓ Concurrent analysé : ${p.title || p.url}`);
      }
    }
  }

  return bundle;
}

// Compact block injected into the Research Agent's prompt.
export function formatResearchForPrompt(bundle: WebResearchBundle): string {
  if (!bundle.hasRealData) return "";
  const parts: string[] = ["## 🔴 DONNÉES WEB RÉELLES — recherche Google/web effectuée à l'instant (utilise-les, ne les invente pas)",
    "OBJECTIF : créer la MEILLEURE entreprise du marché. Analyse les concurrents ci-dessous (offres, prix, faiblesses, plaintes clients) et fais SYSTÉMATIQUEMENT mieux qu'eux : positionnement plus fort, offre plus claire, prix plus malin, réponse directe aux problèmes que les clients signalent chez eux."];
  // La spec curée d'une référence connue passe EN PREMIER — c'est la source la
  // plus fiable et la plus complète (features, écrans, data model).
  if (bundle.knownReference) {
    parts.push("\n" + bundle.knownReference);
  }
  if (bundle.industryPlaybook) {
    parts.push("\n" + bundle.industryPlaybook);
  }
  if (bundle.referenceSummaries.length) {
    parts.push("\n### Références analysées (scrapées en direct)");
    for (const r of bundle.referenceSummaries) {
      parts.push(`\n**${r.title || r.url}** (${r.url})\n${r.summary}`);
    }
  }
  if (bundle.searchFindings) {
    parts.push("\n### Résultats de recherche web\n" + bundle.searchFindings);
  }
  return parts.join("\n");
}
