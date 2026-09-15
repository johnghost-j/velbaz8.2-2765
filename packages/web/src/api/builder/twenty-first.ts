// ─── 21st.dev integration — vision-driven component selection ────────────────
// Velbaz's app/site generator builds with REAL, hand-crafted, curated components
// from 21st.dev instead of inventing everything from scratch.
//
// PIPELINE (per search query):
//   1. SEARCH the registry → list of candidates (name, description, usage_count,
//      preview_url, video_url, code CDN url).
//   2. Text relevance + featured filter → keep on-topic, high-usage candidates.
//   3. VISION ANALYSIS → for the top candidates, download the preview image and
//      have a vision model actually LOOK at it and score it (beauty, fit with the
//      project's design/vibe, brand-color coherence, richness, functional fit).
//   4. LIKE / DON'T-LIKE LOOP → keep the highest-scoring candidate above the
//      visual bar. If nothing clears it, REFORMULATE the query and search again
//      (up to a few attempts) before giving up.
//   5. Return the winner's real source code (downloaded from the CDN) plus a
//      short note of WHY it was chosen, so the page generator can wire it in.
//
// The API key lives in .env as TWENTY_FIRST_API_KEY. When present, the
// integration is ALWAYS on — no admin toggle, no per-user setup.
//
// API: POST https://api.21st.dev/api/search  (header: x-api-key)
//   body: { search, page, per_page }
//   -> { results: [{ name, preview_url, video_url,
//                     component_data: { name, description, code (CDN url) },
//                     component_user_data: { username }, usage_count }],
//        metadata: { pagination: { total, total_pages } } }

import { generateText } from "ai";
import { createHash } from "node:crypto";
import { gateway } from "../agent/gateway";
import { db } from "../database/index";
import { componentCache, visionVerdictCache, componentCodeCache } from "../database/schema";
import { eq } from "drizzle-orm";

const SEARCH_URL = "https://api.21st.dev/api/search";

// Registry search results are project-independent, so we cache them in the DB
// and reuse across every site/company. Fresh for this many ms (7 days) before
// we re-hit the 21st.dev API.
const SEARCH_CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

// A component is considered "featured" only if its real community usage clears
// this bar. Keeps us inside the curated/featured pool.
const FEATURED_MIN_USAGE = 3000;

// How many candidates to pull per query before filtering down.
const SEARCH_PER_PAGE = 15;

// How many of the top text-relevant candidates get the (costly) vision analysis.
const VISION_CANDIDATES = 4;

// A candidate must score at least this (out of 100) on the vision analysis to be
// "liked". Below this, we reformulate and search again.
const VISION_LIKE_THRESHOLD = 70;

// If nothing is "liked" but the best candidate scores at least this, we accept
// it immediately instead of burning time on reformulation rounds — the page
// generator adapts it anyway. Big latency win with negligible quality loss.
const VISION_ACCEPT_THRESHOLD = 60;

// Max search attempts per query (initial + reformulations) in the like/dislike loop.
// 2 (down from 3): with the batched vision call + accept threshold, a second
// round is only needed when the first is genuinely bad.
const MAX_SEARCH_ATTEMPTS = 2;

// Hard wall-clock budget for ONE fetchComponent() call. Past this, we return the
// best candidate seen so far instead of starting another search/vision round.
const FETCH_TIME_BUDGET_MS = 40_000;

// Vision verdicts are stable for a given (preview, visual context) pair — cache
// for 14 days so repeated builds (and other projects with similar vibes) skip
// the vision model entirely.
const VERDICT_CACHE_TTL_MS = 14 * 24 * 60 * 60 * 1000;

// Component source code from the CDN is immutable per URL — cache 30 days.
const CODE_CACHE_TTL_MS = 30 * 24 * 60 * 60 * 1000;

// Vision-capable models on the gateway (Claude + GPT confirmed working; Gemini
// returns empty on images so it's the last resort text-only fallback).
const VISION_MODELS = ["anthropic/claude-sonnet-4.6", "openai/gpt-5.4"];

export function getApiKey(): string {
  return process.env.TWENTY_FIRST_API_KEY || "";
}

// Always on when a key is configured. Reject obviously-wrong values (e.g. a
// URL pasted by mistake) so we never fire malformed requests.
export function isEnabled(): boolean {
  const k = getApiKey().trim();
  if (!k) return false;
  if (/^https?:\/\//i.test(k)) return false; // a URL was pasted, not a key
  return true;
}

// ─── Types ───────────────────────────────────────────────────────────────────

export interface FetchedComponent {
  searchQuery: string;
  snippet: string;
  /** Short reason from the vision analysis explaining why this was picked. */
  reason?: string;
  /** The preview image URL that was analysed. */
  previewUrl?: string;
  /** Visual score 0-100 from the vision analysis. */
  visualScore?: number;
}

/** Context passed to the vision analyser so it can judge fit with THIS project. */
export interface VisualContext {
  companyName?: string;
  industry?: string;
  vibe?: string;
  designNotes?: string;
  /** Brand palette (hex strings) so the analyser can judge colour coherence. */
  colors?: string[];
  /** What functional role this component must play on the page. */
  role?: string;
}

interface SearchResult {
  name?: string;
  usage_count?: number;
  preview_url?: string;
  video_url?: string;
  demo_id?: number;
  component_data?: {
    name?: string;
    description?: string;
    code?: string; // CDN url to the real .tsx source
    install_command?: string;
  };
  component_user_data?: { username?: string; name?: string };
}

// ─── Text relevance scoring ────────────────────────────────────────────────

const STOP_WORDS = new Set([
  "the", "a", "an", "and", "or", "with", "for", "of", "to", "in", "on", "your",
  "animated", "interactive", "modern", "premium", "ui", "component", "components",
  "responsive", "clean", "minimal", "beautiful", "custom", "simple",
]);

function tokenize(s: string | undefined): string[] {
  return (s || "").toLowerCase().match(/[a-z0-9]+/g) || [];
}

function relevanceOf(query: string, r: SearchResult): { score: number; headMatch: boolean } {
  const qTokens = tokenize(query).filter((t) => t.length > 1 && !STOP_WORDS.has(t));
  if (!qTokens.length) return { score: 0, headMatch: false };
  const nameSet = new Set(tokenize(r.component_data?.name || r.name));
  const descSet = new Set(tokenize(r.component_data?.description));
  let score = 0;
  for (const t of qTokens) {
    if (nameSet.has(t)) score += 2;
    else if (descSet.has(t)) score += 1;
  }
  const head = qTokens[qTokens.length - 1];
  const headMatch = nameSet.has(head) || descSet.has(head);
  return { score, headMatch };
}

// Rank candidates by text relevance first (must be on-topic), then usage_count.
// Returns the on-topic candidates in order, best first.
function rankRelevant(query: string, results: SearchResult[]): SearchResult[] {
  return results
    .filter((r) => r.component_data?.code)
    .map((r) => ({ r, rel: relevanceOf(query, r) }))
    .filter((x) => x.rel.headMatch || x.rel.score >= 4)
    .sort(
      (a, b) =>
        b.rel.score - a.rel.score ||
        (b.r.usage_count ?? 0) - (a.r.usage_count ?? 0),
    )
    .map((x) => x.r);
}

// ─── Network helpers ─────────────────────────────────────────────────────────

// DB-backed cache for a registry search. Returns cached results if fresh,
// otherwise null (caller then hits the API and stores the result).
async function readSearchCache(key: string): Promise<SearchResult[] | null> {
  try {
    const row = await db
      .select()
      .from(componentCache)
      .where(eq(componentCache.query, key))
      .limit(1)
      .then((r) => r[0]);
    if (!row) return null;
    const age = Date.now() - (row.createdAt ? row.createdAt.getTime() : 0);
    if (age > SEARCH_CACHE_TTL_MS) return null; // stale
    const parsed = JSON.parse(row.results);
    return Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

async function writeSearchCache(key: string, results: SearchResult[]): Promise<void> {
  try {
    const payload = JSON.stringify(results);
    await db
      .insert(componentCache)
      .values({ query: key, results: payload, createdAt: new Date() })
      .onConflictDoUpdate({
        target: componentCache.query,
        set: { results: payload, createdAt: new Date() },
      });
  } catch {
    // Cache write failures must never break generation.
  }
}

async function searchRegistry(query: string): Promise<SearchResult[]> {
  const apiKey = getApiKey();
  if (!apiKey) return [];

  const cacheKey = query.toLowerCase().trim();
  const cached = await readSearchCache(cacheKey);
  if (cached) return cached;

  try {
    const ctrl = new AbortController();
    const timeout = setTimeout(() => ctrl.abort(), 20000);
    const res = await fetch(SEARCH_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-api-key": apiKey },
      body: JSON.stringify({ search: query, page: 1, per_page: SEARCH_PER_PAGE }),
      signal: ctrl.signal,
    });
    clearTimeout(timeout);
    if (!res.ok) {
      console.error(`[21st] search ${res.status} for "${query}"`);
      return [];
    }
    const data: any = await res.json();
    const results = Array.isArray(data?.results) ? data.results : [];
    if (results.length) void writeSearchCache(cacheKey, results);
    return results;
  } catch (e: any) {
    console.error(`[21st] search error for "${query}":`, e?.message || e);
    return [];
  }
}

// Download the real component source (.tsx) from the 21st.dev CDN.
// DB-cached: a given CDN URL is immutable, so we only ever download it once.
async function fetchSourceCode(url: string): Promise<string> {
  try {
    const row = await db
      .select()
      .from(componentCodeCache)
      .where(eq(componentCodeCache.url, url))
      .limit(1)
      .then((r) => r[0]);
    if (row && Date.now() - (row.createdAt?.getTime() ?? 0) < CODE_CACHE_TTL_MS) {
      return row.code;
    }
  } catch { /* cache miss path below */ }

  try {
    const ctrl = new AbortController();
    const timeout = setTimeout(() => ctrl.abort(), 15000);
    const res = await fetch(url, { signal: ctrl.signal });
    clearTimeout(timeout);
    if (!res.ok) return "";
    const code = await res.text();
    if (typeof code !== "string" || !code.trim()) return "";
    try {
      await db
        .insert(componentCodeCache)
        .values({ url, code, createdAt: new Date() })
        .onConflictDoUpdate({ target: componentCodeCache.url, set: { code, createdAt: new Date() } });
    } catch { /* cache write failures never break generation */ }
    return code;
  } catch {
    return "";
  }
}

// In-memory LRU-ish cache for downloaded preview images (per process). The same
// featured components come back across queries/pages constantly.
const previewImageCache = new Map<string, { buffer: Buffer; mediaType: string } | null>();
const PREVIEW_CACHE_MAX = 200;

// Download a preview image and return it as a base64 buffer + media type, ready
// to feed to a vision model. Returns null on failure / non-image content.
async function fetchPreviewImage(
  url: string,
): Promise<{ buffer: Buffer; mediaType: string } | null> {
  if (previewImageCache.has(url)) return previewImageCache.get(url) ?? null;
  const result = await fetchPreviewImageUncached(url);
  if (previewImageCache.size >= PREVIEW_CACHE_MAX) {
    const first = previewImageCache.keys().next().value;
    if (first !== undefined) previewImageCache.delete(first);
  }
  previewImageCache.set(url, result);
  return result;
}

async function fetchPreviewImageUncached(
  url: string,
): Promise<{ buffer: Buffer; mediaType: string } | null> {
  try {
    const ctrl = new AbortController();
    const timeout = setTimeout(() => ctrl.abort(), 15000);
    const res = await fetch(url, { signal: ctrl.signal });
    clearTimeout(timeout);
    if (!res.ok) return null;
    const mediaType = (res.headers.get("content-type") || "image/png")
      .split(";")[0]
      .trim();
    if (!mediaType.startsWith("image/")) return null;
    const buffer = Buffer.from(await res.arrayBuffer());
    if (buffer.length < 500) return null; // too small to be a real preview
    return { buffer, mediaType };
  } catch {
    return null;
  }
}

// ─── Vision analysis ─────────────────────────────────────────────────────────

interface VisionVerdict {
  score: number; // 0-100
  liked: boolean;
  reason: string;
}

// ── Verdict cache ──
// A verdict is stable for a given (preview image, visual context) pair. Keyed
// by a hash of both so repeated builds NEVER re-run the vision model on a
// component they've already judged in a similar context.
function verdictCacheKey(previewUrl: string, vctx: VisualContext): string {
  const ctxSig = [
    (vctx.vibe || "").toLowerCase().slice(0, 120),
    (vctx.colors || []).slice(0, 6).join(",").toLowerCase(),
    (vctx.role || "").toLowerCase().slice(0, 120),
  ].join("|");
  return createHash("sha1").update(`${previewUrl}|${ctxSig}`).digest("hex");
}

async function readVerdictCache(key: string): Promise<VisionVerdict | null> {
  try {
    const row = await db
      .select()
      .from(visionVerdictCache)
      .where(eq(visionVerdictCache.key, key))
      .limit(1)
      .then((r) => r[0]);
    if (!row) return null;
    if (Date.now() - (row.createdAt?.getTime() ?? 0) > VERDICT_CACHE_TTL_MS) return null;
    return {
      score: row.score,
      liked: row.score >= VISION_LIKE_THRESHOLD,
      reason: row.reason || "",
    };
  } catch {
    return null;
  }
}

async function writeVerdictCache(key: string, v: VisionVerdict): Promise<void> {
  try {
    await db
      .insert(visionVerdictCache)
      .values({ key, score: v.score, reason: v.reason, createdAt: new Date() })
      .onConflictDoUpdate({
        target: visionVerdictCache.key,
        set: { score: v.score, reason: v.reason, createdAt: new Date() },
      });
  } catch { /* never break generation */ }
}

// Judge SEVERAL candidate previews in ONE vision call (instead of one call per
// candidate). Combined with the verdict cache, this cuts vision latency ~4-8x.
// Returns verdicts aligned with the input array (null where unusable).
async function analysePreviewsBatch(
  candidates: SearchResult[],
  vctx: VisualContext,
): Promise<Array<VisionVerdict | null>> {
  const out: Array<VisionVerdict | null> = candidates.map(() => null);

  // 1. Cache pass + parallel image downloads for the misses.
  const misses: Array<{ idx: number; key: string; img: { buffer: Buffer; mediaType: string } }> = [];
  await Promise.all(
    candidates.map(async (c, idx) => {
      if (!c.preview_url) return;
      const key = verdictCacheKey(c.preview_url, vctx);
      const cached = await readVerdictCache(key);
      if (cached) { out[idx] = cached; return; }
      const img = await fetchPreviewImage(c.preview_url);
      if (img) misses.push({ idx, key, img });
    }),
  );
  if (!misses.length) return out;

  const palette = (vctx.colors || []).slice(0, 6).join(", ");
  const system = `Tu es un DIRECTEUR ARTISTIQUE senior extrêmement exigeant. On te montre les IMAGES de prévisualisation de ${misses.length} composants UI issus de 21st.dev, numérotés. Tu dois juger CHACUN: est-il assez BEAU et adapté pour être intégré dans le projet donné ?

Juge chaque composant sur 5 axes:
1. BEAUTÉ / qualité premium générale (pro, soigné, haut de gamme ?)
2. COHÉRENCE avec le design/vibe voulu du projet.
3. COHÉRENCE des COULEURS avec la marque (palette donnée). Un composant adaptable (neutre) est OK; des couleurs criardes incompatibles sont pénalisées.
4. RICHESSE / densité visuelle (détails, profondeur, sensation d'interactivité/animation).
5. ADÉQUATION FONCTIONNELLE au rôle attendu.

Sois sévère: fade, générique, cassé, vide ou hors-sujet → score bas (<70). Vraiment premium et adapté → 80-100.

Réponds UNIQUEMENT en JSON strict (aucun markdown):
{"verdicts": [{"i": <numéro du composant>, "score": <0-100>, "reason": "<1 phrase courte en français>"}]}
Un verdict par composant montré, dans n'importe quel ordre, mais avec le bon "i".`;

  const content: any[] = [
    {
      type: "text",
      text: `## PROJET
- Nom: ${vctx.companyName || "?"}
- Industrie: ${vctx.industry || "?"}
- Design/vibe voulu: ${vctx.vibe || "?"} — ${vctx.designNotes || ""}
- Palette de marque: ${palette || "non spécifiée (composant doit être neutre/adaptable)"}
- Rôle attendu de la pièce: ${vctx.role || "?"}

## COMPOSANTS À JUGER (${misses.length})`,
    },
  ];
  for (let k = 0; k < misses.length; k++) {
    const c = candidates[misses[k].idx];
    content.push({
      type: "text",
      text: `### Composant ${k + 1}
- Nom: ${c.component_data?.name || c.name || "?"}
- Description: ${(c.component_data?.description || "?").slice(0, 200)}
- Popularité (usages communauté): ${c.usage_count ?? "?"}`,
    });
    content.push({ type: "image", image: misses[k].img.buffer, mediaType: misses[k].img.mediaType });
  }

  for (const model of VISION_MODELS) {
    try {
      const { text } = await generateText({
        model: gateway(model),
        system,
        maxOutputTokens: 250 * misses.length + 200,
        messages: [{ role: "user", content }],
      });
      const parsed = safeJson(text);
      const arr: any[] = Array.isArray(parsed?.verdicts) ? parsed.verdicts : [];
      if (!arr.length) continue;
      let got = 0;
      for (const v of arr) {
        const k = Math.round(Number(v?.i)) - 1;
        if (k < 0 || k >= misses.length) continue;
        if (typeof v?.score !== "number") continue;
        const score = Math.max(0, Math.min(100, Math.round(v.score)));
        const verdict: VisionVerdict = {
          score,
          liked: score >= VISION_LIKE_THRESHOLD,
          reason: String(v.reason || "").slice(0, 240),
        };
        out[misses[k].idx] = verdict;
        void writeVerdictCache(misses[k].key, verdict);
        got++;
      }
      if (got > 0) return out;
    } catch (e: any) {
      console.error(`[21st] vision batch ${model} error:`, e?.message || e);
    }
  }
  return out;
}

function safeJson(raw: string): any {
  try {
    let s = (raw || "").trim();
    if (s.startsWith("```")) s = s.replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/, "");
    const start = s.indexOf("{");
    const end = s.lastIndexOf("}");
    if (start !== -1 && end !== -1) s = s.slice(start, end + 1);
    return JSON.parse(s);
  } catch {
    return null;
  }
}

// Ask a fast model to REFORMULATE a search query after nothing was liked, so the
// next attempt finds different/better candidates. Keeps it 2-5 English words.
async function reformulateQuery(
  original: string,
  vctx: VisualContext,
  triedNames: string[],
  rejectionReasons: string[],
): Promise<string | null> {
  const system = `Tu reformules une requête de recherche de composant UI pour 21st.dev. On n'a pas aimé les résultats précédents. Propose une requête DIFFÉRENTE (2 à 5 mots ANGLAIS) qui cible le même rôle fonctionnel mais avec un angle/style différent pour trouver un composant plus beau et mieux adapté. Réponds UNIQUEMENT avec la nouvelle requête, sans guillemets ni ponctuation.`;
  const prompt = `Requête d'origine: "${original}"
Rôle voulu: ${vctx.role || original}
Design/vibe du projet: ${vctx.vibe || "?"} ${vctx.designNotes || ""}
Composants déjà vus et REJETÉS: ${triedNames.join("; ") || "aucun"}
Pourquoi rejetés: ${rejectionReasons.join(" | ") || "trop fades / hors-sujet"}

Nouvelle requête (2-5 mots anglais):`;
  // Fast model first (reformulation is trivial), premium fallback.
  for (const model of ["openai/gpt-5.4-mini", "openai/gpt-5.4"]) {
    try {
      const { text } = await generateText({
        model: gateway(model),
        system,
        prompt,
        maxOutputTokens: 40,
      });
      const q = (text || "").trim().replace(/^["'`]+|["'`]+$/g, "").split("\n")[0].trim();
      if (q && q.toLowerCase() !== original.toLowerCase() && q.length <= 60) return q;
    } catch { /* try next model */ }
  }
  return null;
}

// ─── Core: fetch ONE component via the full vision-driven loop ────────────────

async function buildFetched(
  searchQuery: string,
  winner: SearchResult,
  verdict: VisionVerdict | null,
): Promise<FetchedComponent | null> {
  const codeUrl = winner.component_data?.code;
  if (!codeUrl) return null;
  const code = await fetchSourceCode(codeUrl);
  if (!code.trim()) return null;

  const name = winner.component_data?.name || winner.name || "Component";
  const author = winner.component_user_data?.username
    ? ` by @${winner.component_user_data.username}`
    : "";
  const usage = winner.usage_count ? ` — ${winner.usage_count} usages` : "";
  const scoreTag = verdict ? ` — visual ${verdict.score}/100` : "";
  const header = `// 21st.dev FEATURED: ${name}${author}${usage}${scoreTag}\n`;
  const snippet = `${header}${code}`.trim().slice(0, 26000);

  return {
    searchQuery,
    snippet,
    reason: verdict?.reason,
    previewUrl: winner.preview_url,
    visualScore: verdict?.score,
  };
}

// Fetch the single BEST component for one query, using the vision-driven
// like/don't-like loop. `vctx` enables the vision analysis; without it we fall
// back to text-only relevance (still works, just no visual judgement).
export async function fetchComponent(
  searchQuery: string,
  vctx?: VisualContext,
): Promise<FetchedComponent | null> {
  if (!isEnabled()) return null;

  let query = searchQuery;
  const triedNames: string[] = [];
  const rejectionReasons: string[] = [];
  const startedAt = Date.now();
  const budgetLeft = () => FETCH_TIME_BUDGET_MS - (Date.now() - startedAt);
  // Track the best candidate seen across ALL attempts, so if nothing clears the
  // visual bar we can still return the best-looking one rather than nothing.
  let bestOverall: { result: SearchResult; verdict: VisionVerdict | null; query: string } | null = null;

  for (let attempt = 0; attempt < MAX_SEARCH_ATTEMPTS; attempt++) {
    const results = await searchRegistry(query);
    if (!results.length) {
      if (budgetLeft() < 8000) break;
      const next = vctx ? await reformulateQuery(query, vctx, triedNames, rejectionReasons) : null;
      if (!next) break;
      query = next;
      continue;
    }

    const ranked = rankRelevant(query, results);
    if (!ranked.length) {
      if (budgetLeft() < 8000) break;
      const next = vctx ? await reformulateQuery(query, vctx, triedNames, rejectionReasons) : null;
      if (!next) break;
      query = next;
      continue;
    }

    // No vision context → pure text+usage pick (legacy behaviour).
    if (!vctx) {
      const featured = ranked.find((r) => (r.usage_count ?? 0) >= FEATURED_MIN_USAGE) || ranked[0];
      return buildFetched(searchQuery, featured, null);
    }

    // Vision analysis of the top N candidates — ONE batched vision call for all
    // of them (cache-first), instead of one call per candidate.
    const topN = ranked.slice(0, VISION_CANDIDATES);
    const batchVerdicts = await analysePreviewsBatch(topN, vctx);
    const verdicts = topN.map((r, i) => ({ result: r, verdict: batchVerdicts[i] }));

    // Rank by visual score (candidates without a verdict fall back to usage-based).
    const scored = verdicts
      .map(({ result, verdict }) => ({
        result,
        verdict,
        effScore: verdict ? verdict.score : Math.min(65, 40 + (result.usage_count ?? 0) / 1000),
      }))
      .sort((a, b) => b.effScore - a.effScore);

    for (const s of scored) {
      if (!bestOverall || s.effScore > (bestOverall.verdict?.score ?? 0)) {
        bestOverall = { result: s.result, verdict: s.verdict, query };
      }
    }

    // Did anything clear the "liked" bar? Take the best liked one.
    const liked = scored.find((s) => s.verdict?.liked);
    if (liked) {
      return buildFetched(searchQuery, liked.result, liked.verdict);
    }

    // Nothing "liked", but the best is decent → accept it now instead of paying
    // for another search + vision round. The page generator adapts it anyway.
    const top = scored[0];
    if (top && top.effScore >= VISION_ACCEPT_THRESHOLD) {
      return buildFetched(searchQuery, top.result, top.verdict);
    }

    // Time budget exhausted → stop here, return the best seen below.
    if (budgetLeft() < 8000) break;

    // Nothing liked → remember what we rejected and reformulate for another try.
    for (const s of scored) {
      const nm = s.result.component_data?.name || s.result.name;
      if (nm) triedNames.push(nm);
      if (s.verdict?.reason) rejectionReasons.push(s.verdict.reason);
    }
    const next = await reformulateQuery(query, vctx, triedNames, rejectionReasons);
    if (!next) break;
    query = next;
  }

  // Loop exhausted with nothing "liked". Return the best-looking candidate we
  // saw (the page generator can still adapt/improve it). The engine decides
  // whether to use it or let the AI generate from scratch inspired by it.
  if (bestOverall) {
    return buildFetched(searchQuery, bestOverall.result, bestOverall.verdict);
  }
  return null;
}

// ─── Template inspiration ─────────────────────────────────────────────────
// Before generating, Velbaz explores 21st.dev's full-page / section TEMPLATES
// (heroes, landing sections, dashboards, marketing blocks) that match the
// project, LOOKS at their preview images with a vision model, and distils a
// short "layout & style inspiration" brief. That brief is injected into the
// design-system + page prompts so the whole app is composed like real, polished
// 21st.dev templates instead of a generic AI layout.

export interface TemplateInspiration {
  /** A concise design brief distilled from looking at real 21st.dev templates. */
  brief: string;
  /** Names of the templates that inspired it (for logging / transparency). */
  sources: string[];
}

// Minimal shape of a page we build template queries for.
export interface PageForInspiration {
  name: string;
  route: string;
  purpose?: string;
  sections?: string;
  isCore?: boolean;
}

// Detect the ARCHETYPE of a page from its name/route/purpose/sections and turn
// it into template search queries that match THAT kind of page. This is what
// makes template inspiration targeted per page: an AI-chat page searches chat
// UI templates, a dashboard searches dashboard layouts, a landing page searches
// hero/features, etc. — instead of always pulling generic landing templates.
function templateQueriesForPage(page: PageForInspiration | undefined, vctx: VisualContext): string[] {
  const vibe = (vctx.vibe || "").toLowerCase();
  const industry = (vctx.industry || "").toLowerCase();

  // No page context → fall back to a generic project-level set (used for shared
  // components like Header/Footer and as a last resort).
  if (!page) {
    const base = ["hero section landing", "features section", "call to action section"];
    const extra: string[] = [];
    if (/saas|app|dashboard|analytics|b2b/.test(industry + vibe)) extra.push("dashboard layout", "pricing section");
    if (/shop|store|ecommerce|commerce|boutique|product/.test(industry + vibe)) extra.push("product showcase section", "ecommerce hero");
    if (/agency|portfolio|studio|creative|design/.test(industry + vibe)) extra.push("portfolio showcase", "bento grid section");
    return [...base, ...extra].slice(0, 5);
  }

  const hay = `${page.name} ${page.route} ${page.purpose || ""} ${page.sections || ""}`.toLowerCase();
  const has = (re: RegExp) => re.test(hay);
  const q: string[] = [];

  // Archetype detection → targeted queries.
  if (has(/chat|assistant|conversation|message|prompt|ia\b|ai\b|copilot|llm|gpt/)) {
    q.push("ai chat interface", "chat conversation ui", "prompt input bar", "message thread ui");
  }
  if (has(/dashboard|tableau de bord|analytics|statistiqu|metric|kpi|overview|espace de travail|workspace/)) {
    q.push("dashboard layout", "analytics dashboard", "data table section", "stats cards grid");
  }
  if (has(/pricing|tarif|abonnement|plan|subscription|forfait/)) {
    q.push("pricing section", "pricing table cards", "subscription plans");
  }
  if (has(/product|produit|boutique|shop|store|ecommerce|catalog|panier|cart/)) {
    q.push("product grid section", "product card showcase", "ecommerce listing", "shopping cart ui");
  }
  if (has(/portfolio|galerie|gallery|projet|showcase|réalisation|work\b/)) {
    q.push("portfolio showcase", "bento grid section", "image gallery grid");
  }
  if (has(/settings|paramètre|profil|profile|compte|account|préférence/)) {
    q.push("settings page layout", "profile settings form", "account settings ui");
  }
  if (has(/login|connexion|signin|signup|inscription|register|auth|mot de passe/)) {
    q.push("authentication form", "login signup card", "auth screen ui");
  }
  if (has(/blog|article|actualité|news|post|magazine|contenu/)) {
    q.push("blog article layout", "blog post grid", "content magazine layout");
  }
  if (has(/contact|support|aide|help|faq|nous joindre/)) {
    q.push("contact section form", "faq accordion section", "support contact ui");
  }
  if (has(/onboard|bienvenue|welcome|getting started|démarrage/)) {
    q.push("onboarding flow ui", "welcome screen steps");
  }
  if (has(/calendar|calendrier|agenda|planning|schedule|réservation|booking|rendez-vous/)) {
    q.push("calendar scheduling ui", "booking section", "timeline agenda ui");
  }
  if (has(/kanban|board|tâche|task|todo|projet/)) {
    q.push("kanban board ui", "task list section");
  }
  if (has(/feed|social|communauté|community|réseau/)) {
    q.push("social feed ui", "activity feed section");
  }

  // Landing / marketing home: route "/" and not the functional core, or the
  // page reads like a marketing home. Give it the classic premium sections.
  const isMarketingHome =
    (page.route === "/" && !page.isCore) ||
    has(/landing|accueil|home|hero|présentation|vitrine|marketing/);
  if (isMarketingHome || q.length === 0) {
    q.push("hero section landing", "features section", "call to action section");
    if (/saas|app|analytics|b2b/.test(industry + vibe)) q.push("bento features grid");
  }

  // De-dupe while preserving order, cap at 5.
  return Array.from(new Set(q)).slice(0, 5);
}

// ─── Design tokens FROM 21st.dev (colors + typography + treatments) ──────────
// This is what makes 21st.dev THE source of the design (not just inspiration).
// Instead of inventing a palette, Velbaz searches 21st.dev for templates that
// match the project's industry/vibe, LOOKS at their real preview images with a
// vision model, and EXTRACTS the actual design tokens FROM those images:
// exact hex colors, font family, radius, and signature visual treatments.
// These tokens are then locked into the app's design system so every page
// inherits a palette that genuinely originates from real 21st.dev components —
// eliminating the generic "AI look" (default indigo/gray, fades).

export interface ExtractedDesignTokens {
  colors: {
    primary: string;
    accent: string;
    background: string;
    surface: string;
    text: string;
    muted: string;
    border: string;
  };
  font: string;
  radius: string;
  designNotes: string;
  vibe?: string;
  /** Template names the tokens were derived from (for transparency/logging). */
  sources: string[];
}

const HEX_RE = /^#[0-9a-fA-F]{6}$/;
function isHex(v: any): v is string {
  return typeof v === "string" && HEX_RE.test(v.trim());
}

// Build a set of INDUSTRY/VIBE-targeted template queries whose previews best
// reveal a cohesive visual identity (hero + full landing/dashboard shots carry
// the most color/typography signal).
function designTokenQueries(vctx: VisualContext): string[] {
  const hay = `${vctx.industry || ""} ${vctx.vibe || ""} ${vctx.designNotes || ""}`.toLowerCase();
  const q: string[] = ["hero section landing", "landing page template"];
  if (/saas|app|dashboard|analytics|b2b|fintech|tech/.test(hay)) q.push("dashboard layout", "saas landing hero");
  if (/shop|store|ecommerce|commerce|boutique|product|retail|mode|fashion/.test(hay)) q.push("ecommerce hero", "product showcase section");
  if (/agency|portfolio|studio|creative|design|art/.test(hay)) q.push("portfolio showcase", "creative agency hero");
  if (/food|restaurant|cafe|hotel|travel|wellness|beauty|luxury/.test(hay)) q.push("premium landing hero", "luxury brand section");
  if (/health|medical|finance|bank|legal|corporate|insurance/.test(hay)) q.push("corporate landing section");
  return Array.from(new Set(q)).slice(0, 5);
}

// Search 21st.dev, grab the best on-topic template previews, and have a vision
// model EXTRACT concrete design tokens from what it actually sees. Returns null
// when the integration is off or nothing usable is found (engine falls back to
// its AI design step only then).
export async function fetchDesignTokens(
  vctx: VisualContext,
): Promise<ExtractedDesignTokens | null> {
  if (!isEnabled()) return null;

  const queries = designTokenQueries(vctx);
  const picks = await Promise.all(
    queries.map(async (q) => {
      const results = await searchRegistry(q);
      const ranked = rankRelevant(q, results);
      const pool = ranked.length
        ? ranked
        : [...results]
            .filter((r) => r.component_data?.code && r.preview_url)
            .sort((a, b) => (b.usage_count ?? 0) - (a.usage_count ?? 0));
      const best = pool.find((r) => (r.usage_count ?? 0) >= FEATURED_MIN_USAGE) || pool[0];
      if (!best?.preview_url) return null;
      const img = await fetchPreviewImage(best.preview_url);
      if (!img) return null;
      return { name: best.component_data?.name || best.name || q, img };
    }),
  );
  const usable = picks.filter((p): p is NonNullable<typeof p> => !!p).slice(0, 5);
  if (!usable.length) return null;

  const system = `Tu es un DIRECTEUR ARTISTIQUE expert en design tokens. On te montre plusieurs IMAGES de templates/composants RÉELS et polis provenant de 21st.dev, choisis pour matcher un projet précis. Ta mission: EXTRAIRE un système de design cohérent EN OBSERVANT VRAIMENT ces images — les couleurs réelles qu'elles utilisent, leur typographie, leurs arrondis, leurs traitements visuels.

RÈGLES:
- Les COULEURS doivent provenir de ce que tu VOIS dans les images (couleur dominante d'accent, fonds, surfaces, textes, bordures). Pige les vraies teintes — pas de bleu/indigo générique par défaut, pas de gris fade "IA". Si les templates ont une identité forte (ex: vert profond, orange chaud, violet électrique, noir premium), RESTITUE-la fidèlement.
- Compose une palette HARMONIEUSE et cohérente entre les templates observés (ils partagent une famille esthétique). Choisis des hex précis à 6 chiffres.
- La TYPOGRAPHIE: déduis une Google Font qui correspond au caractère observé (géométrique, grotesque, serif, etc.). Ex: Inter, Geist, Space Grotesk, Sora, Plus Jakarta Sans, Manrope, Instrument Sans, Bricolage Grotesque…
- Le RADIUS et les TRAITEMENTS (gradients, glass, ombres, bordures, profondeur, motifs) doivent refléter ce que montrent les images.

Réponds UNIQUEMENT en JSON strict (aucun markdown):
{
  "vibe": "3-4 mots décrivant l'esthétique observée",
  "colors": { "primary": "#hex", "accent": "#hex", "background": "#hex", "surface": "#hex", "text": "#hex", "muted": "#hex", "border": "#hex" },
  "font": "nom Google Font",
  "radius": "valeur css (ex: 0.75rem)",
  "designNotes": "3-4 phrases DÉCRIVANT les traitements visuels réels observés dans ces templates (gradients, ombres, spacing, densité, animations) et comment les reproduire"
}`;

  const content: any[] = [
    {
      type: "text",
      text: `## PROJET
- Nom: ${vctx.companyName || "?"}
- Industrie: ${vctx.industry || "?"}
- Direction voulue (indicative): ${vctx.vibe || "?"} — ${vctx.designNotes || ""}

Voici ${usable.length} templates 21st.dev pertinents pour ce projet. Observe-les et EXTRAIS le système de design (tokens) à partir de ce que tu vois réellement.`,
    },
  ];
  for (const p of usable) {
    content.push({ type: "text", text: `Template: ${p.name}`.slice(0, 200) });
    content.push({ type: "image", image: p.img.buffer, mediaType: p.img.mediaType });
  }

  for (const model of VISION_MODELS) {
    try {
      const { text } = await generateText({
        model: gateway(model),
        system,
        maxOutputTokens: 700,
        messages: [{ role: "user", content }],
      });
      const parsed = safeJson(text);
      const c = parsed?.colors;
      // Require a genuine, well-formed palette extracted from the images.
      if (
        c &&
        isHex(c.primary) && isHex(c.accent) && isHex(c.background) &&
        isHex(c.surface) && isHex(c.text) && isHex(c.muted) && isHex(c.border)
      ) {
        return {
          colors: {
            primary: c.primary.trim(), accent: c.accent.trim(),
            background: c.background.trim(), surface: c.surface.trim(),
            text: c.text.trim(), muted: c.muted.trim(), border: c.border.trim(),
          },
          font: (typeof parsed.font === "string" && parsed.font.trim()) || "Inter",
          radius: (typeof parsed.radius === "string" && parsed.radius.trim()) || "0.75rem",
          designNotes: String(parsed.designNotes || "").slice(0, 600),
          vibe: typeof parsed.vibe === "string" ? parsed.vibe.slice(0, 80) : undefined,
          sources: usable.map((u) => u.name),
        };
      }
    } catch (e: any) {
      console.error(`[21st] design token extraction ${model} error:`, e?.message || e);
    }
  }
  return null;
}

// Explore matching templates on 21st.dev and return a vision-derived design
// brief. Returns null when the integration is off or nothing usable is found.
export async function fetchTemplateInspiration(
  vctx: VisualContext,
  page?: PageForInspiration,
): Promise<TemplateInspiration | null> {
  if (!isEnabled()) return null;

  const queries = templateQueriesForPage(page, vctx);
  // Pull the single best (most-used, on-topic) template per query and grab its
  // preview image for visual inspection.
  const picks = await Promise.all(
    queries.map(async (q) => {
      const results = await searchRegistry(q);
      const ranked = rankRelevant(q, results);
      // For INSPIRATION (mood, not an exact component match) the query is already
      // targeted, so if strict relevance ranking filters everything out, fall
      // back to the most-used result that has code + a preview. This keeps chat/
      // niche pages (whose components rarely name-match the query) inspired too.
      const pool = ranked.length
        ? ranked
        : [...results]
            .filter((r) => r.component_data?.code && r.preview_url)
            .sort((a, b) => (b.usage_count ?? 0) - (a.usage_count ?? 0));
      const best =
        pool.find((r) => (r.usage_count ?? 0) >= FEATURED_MIN_USAGE) || pool[0];
      if (!best?.preview_url) return null;
      const img = await fetchPreviewImage(best.preview_url);
      if (!img) return null;
      return {
        name: best.component_data?.name || best.name || q,
        desc: best.component_data?.description || "",
        img,
      };
    }),
  );
  const usable = picks.filter((p): p is NonNullable<typeof p> => !!p).slice(0, 5);
  if (!usable.length) return null;

  const palette = (vctx.colors || []).slice(0, 6).join(", ");
  const pageLine = page
    ? `\n\nLe brief vise SPÉCIFIQUEMENT la page "${page.name}" (route ${page.route}) — un écran de type: ${page.purpose || page.name}. Concentre le brief sur CE type d'écran (sa structure, ses composants clés, ses interactions), pas sur un site générique.`
    : "";
  const system = `Tu es un DIRECTEUR ARTISTIQUE. On te montre plusieurs IMAGES de templates/sections réels et polis provenant de 21st.dev. Analyse-les VISUELLEMENT et distille un BRIEF DE DESIGN concret et actionnable pour construire un site premium dans le même esprit, adapté au projet donné.${pageLine}

Le brief doit couvrir, en puces courtes et concrètes:
- STRUCTURE de layout (héros, disposition des sections, rythme, alternance, grilles/bento).
- ESPACEMENT & densité (généreux vs dense), largeur de contenu.
- TYPOGRAPHIE (échelle, contraste titre/corps, poids).
- TRAITEMENTS visuels marquants (gradients, glass, ombres, bordures, motifs, profondeur).
- MICRO-INTERACTIONS / animations suggérées.
Ne décris PAS chaque image une par une. Synthétise en UN brief cohérent, exploitable. 10-14 puces max. Français.`;

  const content: any[] = [
    {
      type: "text",
      text: `## PROJET
- Nom: ${vctx.companyName || "?"}
- Industrie: ${vctx.industry || "?"}
- Design/vibe voulu: ${vctx.vibe || "?"} — ${vctx.designNotes || ""}
- Palette de marque: ${palette || "à définir (neutre/adaptable)"}

Voici ${usable.length} templates 21st.dev pertinents. Regarde-les et produis le brief de design.`,
    },
  ];
  for (const p of usable) {
    content.push({ type: "text", text: `Template: ${p.name} — ${p.desc}`.slice(0, 300) });
    content.push({ type: "image", image: p.img.buffer, mediaType: p.img.mediaType });
  }

  for (const model of VISION_MODELS) {
    try {
      const { text } = await generateText({
        model: gateway(model),
        system,
        maxOutputTokens: 900,
        messages: [{ role: "user", content }],
      });
      const brief = (text || "").trim();
      if (brief.length > 40) {
        return { brief: brief.slice(0, 3500), sources: usable.map((u) => u.name) };
      }
    } catch (e: any) {
      console.error(`[21st] template inspiration ${model} error:`, e?.message || e);
    }
  }
  return null;
}

// Fetch featured components for multiple queries in parallel (deduped, capped).
// `vctx` (optional) turns on the vision-driven selection loop for every query.
export async function fetchComponents(
  queries: Array<{ searchQuery: string; message?: string; vctx?: VisualContext }>,
  cap = 4,
): Promise<FetchedComponent[]> {
  if (!isEnabled()) return [];
  const seen = new Set<string>();
  const unique = queries
    .filter((q) => {
      const k = q.searchQuery.toLowerCase().trim();
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    })
    .slice(0, cap);
  const results = await Promise.all(unique.map((q) => fetchComponent(q.searchQuery, q.vctx)));
  return results.filter((r): r is FetchedComponent => !!r);
}
