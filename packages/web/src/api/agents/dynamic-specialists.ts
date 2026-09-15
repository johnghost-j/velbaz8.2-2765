// ─── Dynamic Specialist Factory ──────────────────────────────────────────────
// « Si la personne demande quelque chose qu'aucune IA n'est vraiment spécialisée
//    pour faire, Velbaz crée une IA spécifique à la demande pour que ce soit parfait. »
//
// Quand une demande relève d'un domaine pointu NON couvert par les spécialistes
// prédéfinis (finance, marketing, crypto, prédiction…) et non déjà couvert par un
// spécialiste dynamique existant, un LLM puissant SYNTHÉTISE un expert sur-mesure :
// persona, méthodologie, format de sortie, garde-fous et outils Velbaz disponibles.
// Le spécialiste est persisté (réutilisable, affiché dans l'équipe) et répond
// immédiatement — jamais de refus, jamais une réponse générique à moitié.

import { generateText } from "ai";
import { gateway, UNCENSORED_MODEL, hasUncensoredProvider } from "../agent/gateway";
import { db, client, ensureRuntimeTables } from "../database";
import * as schema from "../database/schema";
import { eq, and, desc, sql } from "drizzle-orm";
import { v4 as uuidv4 } from "uuid";
import { SAFETY_OFF_OVERRIDE } from "./types";

export interface DynamicSpecialistDef {
  id: string;
  companyId: string;
  slug: string;
  label: string;
  labelEn: string;
  desc: string;
  emoji: string;
  color: string;
  domain: string;
  brief: string;
  systemPrompt: string;
  keywords: string[];
}

// Textuel = gpt-5.4-mini (choix utilisateur : ~3x plus rapide). Les entrées
// suivantes ne servent QUE si la passerelle refuse/échoue sur mini.
// [2026-09-08] claude-sonnet-4.6 retiré (12× plus cher que mini) —
// gemini-3-flash est le repli économique.
const SYNTH_MODELS = [
  "openai/gpt-5.4-mini",
  "google/gemini-3-flash",
];

const AI_TIMEOUT_MS = 45000;

function slugify(input: string): string {
  const base = (input || "")
    .toLowerCase()
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 40) || "expert";
  return `dyn_${base}`;
}

async function synthGenerate(system: string, prompt: string, maxTokens: number, preferModel?: string): Promise<string> {
  // En mode uncensored, on essaie d'abord le vrai modèle uncensored (OpenRouter),
  // puis on retombe sur les modèles normaux si indisponible.
  const models = preferModel ? [preferModel, ...SYNTH_MODELS] : SYNTH_MODELS;
  for (const model of models) {
    try {
      const res = await generateText({
        model: gateway(model),
        system,
        prompt,
        maxOutputTokens: maxTokens,
        maxRetries: 0,
        abortSignal: AbortSignal.timeout(AI_TIMEOUT_MS),
      });
      const text = (res.text || "").trim();
      if (text) return text;
    } catch (e: any) {
      console.log(`[dyn-spec] model ${model} failed:`, e?.message);
      continue;
    }
  }
  throw new Error("DYN_SPEC_AI_UNAVAILABLE");
}

function extractJson(raw: string): any | null {
  if (!raw) return null;
  // Retire les fences éventuelles ```json … ```
  let s = raw.trim().replace(/^```(?:json)?/i, "").replace(/```$/i, "").trim();
  const start = s.indexOf("{");
  const end = s.lastIndexOf("}");
  if (start === -1 || end === -1 || end <= start) return null;
  s = s.slice(start, end + 1);
  try { return JSON.parse(s); } catch {}
  // Tolère les virgules traînantes
  try { return JSON.parse(s.replace(/,\s*([}\]])/g, "$1")); } catch {}
  return null;
}

// ─── Heuristique 0-coût : la demande vaut-elle un expert dédié ? ──────────────
// Écarte le trivial, les salutations, et tout ce qui touche au site/app (géré
// ailleurs). Garde les demandes d'aide/analyse/conseil/méthode sur un sujet.
const NON_EXPERT_RE = /\b(merci|thanks|salut|bonjour|hello|hey|coucou|ok\b|d'accord|super|cool|parfait|g[ée]nial|bravo|lol|mdr)\b/i;
const SITE_APP_RE = /\b(site\s*web|website|landing|page\s*d'accueil|mon\s*app|l['ea]?\s*app(?:li)?|bouton|couleur|design|preview|aper[çc]u|section|header|footer|menu|navbar|d[ée]ploie|publie|met\s*en\s*ligne)\b/i;
const EXPERT_SIGNAL_RE = /\b(comment|pourquoi|explique|conseil|aide[- ]?moi|aide moi|peux[- ]tu|analyse|optimis|strat[ée]gie|m[ée]thode|plan|calcul|formule|dosage|protocole|proc[ée]dure|diagnos|recommand|meilleure?\s*fa[çc]on|best\s*way|comment\s*faire|que\s*dois|quelles?\s*[ée]tapes?|guide|tutoriel|expert|sp[ée]cialis|technique|r[ée]gime|entra[îi]nement|recette|juridiqu|m[ée]dical|sant[ée]|fiscal|impôt|astro|traduction|traduis|coach|apprend|enseigne)\b/i;

export function dynamicHeuristic(message: string): boolean {
  const m = (message || "").trim();
  if (m.length < 15) return false;
  if (NON_EXPERT_RE.test(m) && m.length < 40) return false;
  if (SITE_APP_RE.test(m)) return false;
  return EXPERT_SIGNAL_RE.test(m) || m.length > 80;
}

// ─── Réutilisation : un spécialiste dynamique existant couvre-t-il déjà ça ? ──
export async function listDynamic(companyId: string): Promise<DynamicSpecialistDef[]> {
  if (!companyId) return [];
  await ensureRuntimeTables();
  try {
    const rows = await db.select().from(schema.dynamicSpecialists)
      .where(eq(schema.dynamicSpecialists.companyId, companyId))
      .orderBy(desc(schema.dynamicSpecialists.createdAt))
      .limit(60);
    return rows.map(rowToDef);
  } catch (e: any) {
    console.error("[dyn-spec] listDynamic failed:", e?.message);
    return [];
  }
}

function rowToDef(r: any): DynamicSpecialistDef {
  let kw: string[] = [];
  try { kw = JSON.parse(r.keywords || "[]"); } catch {}
  if (!Array.isArray(kw)) kw = [];
  return {
    id: r.id, companyId: r.companyId, slug: r.slug,
    label: r.label, labelEn: r.labelEn || r.label, desc: r.desc || "",
    emoji: r.emoji || "🧠", color: r.color || "#6366f1",
    domain: r.domain || "", brief: r.brief || "",
    systemPrompt: r.systemPrompt, keywords: kw,
  };
}

function tokenize(s: string): string[] {
  return (s || "").toLowerCase()
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .split(/[^a-z0-9]+/).filter((w) => w.length >= 4);
}

/** Cherche un spécialiste dynamique déjà créé qui couvre la demande (score de recouvrement de mots-clés). */
export async function findMatchingDynamic(companyId: string, message: string): Promise<DynamicSpecialistDef | null> {
  const all = await listDynamic(companyId);
  if (all.length === 0) return null;
  const msgTokens = new Set(tokenize(message));
  if (msgTokens.size === 0) return null;
  let best: { def: DynamicSpecialistDef; score: number } | null = null;
  for (const def of all) {
    const kwTokens = new Set([
      ...def.keywords.flatMap(tokenize),
      ...tokenize(def.label),
      ...tokenize(def.domain),
    ]);
    let hits = 0;
    for (const t of kwTokens) if (msgTokens.has(t)) hits++;
    if (hits >= 2 && (!best || hits > best.score)) best = { def, score: hits };
  }
  return best?.def || null;
}

// ─── Synthèse d'un nouveau spécialiste par LLM ────────────────────────────────
const SYNTH_SYSTEM = `Tu es l'architecte d'agents de Velbaz. À partir d'une demande utilisateur, tu décides s'il faut créer un SPÉCIALISTE IA dédié, puis tu conçois sa fiche complète.

Crée un spécialiste UNIQUEMENT si la demande relève d'un domaine d'EXPERTISE précis qui mérite une persona experte dédiée (ex: nutrition sportive, droit fiscal, astronomie, traduction juridique, coaching vocal, agronomie, cybersécurité, pédagogie…). NE crée PAS de spécialiste pour: bavardage, salutations, création/édition de site ou d'app, ou une simple reformulation.

Réponds STRICTEMENT en JSON (aucun texte autour), au format:
{
  "create": true|false,
  "label": "Nom FR du rôle, humain et précis (ex: \\"Expert en nutrition sportive\\")",
  "labelEn": "English role name",
  "desc": "Une phrase FR décrivant ce que fait ce spécialiste",
  "emoji": "un seul emoji représentatif",
  "color": "#hexcolor vif cohérent avec le domaine",
  "domain": "tag court du domaine (ex: nutrition_sportive)",
  "keywords": ["8 à 15 mots-clés FR/EN qui déclenchent ce spécialiste"],
  "brief": "1-2 phrases: 'Agis comme … : …' résumé de mission",
  "systemPrompt": "PERSONA EXPERTE COMPLÈTE en français (250-500 mots): identité et niveau d'expertise; méthodologie de raisonnement étape par étape propre au domaine; le FORMAT de réponse attendu; les garde-fous/limites (ne jamais inventer de chiffres, disclaimers si santé/droit/finance); et le rappel qu'il peut demander des précisions si une info indispensable manque. Écris-le comme un vrai prompt système opérationnel."
}

Si create=false, renvoie juste {"create": false}.`;

export async function synthesizeSpecialist(
  message: string,
  ctx: { name?: string; idea?: string; industry?: string } = {},
): Promise<DynamicSpecialistDef | null> {
  const ctxLine = [
    ctx.name && `Entreprise: ${ctx.name}`,
    ctx.industry && `Secteur: ${ctx.industry}`,
    ctx.idea && `Activité: ${String(ctx.idea).slice(0, 200)}`,
  ].filter(Boolean).join(" | ");
  const prompt = `Demande de l'utilisateur:\n"""${message.slice(0, 1200)}"""\n${ctxLine ? `\nContexte entreprise: ${ctxLine}\n` : ""}\nConçois le spécialiste dédié idéal (ou create=false si non pertinent).`;
  let raw: string;
  try {
    raw = await synthGenerate(SYNTH_SYSTEM, prompt, 1400);
  } catch (e: any) {
    console.error("[dyn-spec] synth generate failed:", e?.message);
    return null;
  }
  const j = extractJson(raw);
  if (!j || j.create !== true) return null;
  if (!j.label || !j.systemPrompt || String(j.systemPrompt).length < 80) return null;
  const domain = String(j.domain || j.label || "expert").slice(0, 60);
  const def: DynamicSpecialistDef = {
    id: uuidv4(),
    companyId: "",
    slug: slugify(domain),
    label: String(j.label).slice(0, 80),
    labelEn: String(j.labelEn || j.label).slice(0, 80),
    desc: String(j.desc || "").slice(0, 200),
    emoji: (String(j.emoji || "🧠").match(/\p{Emoji}/u)?.[0]) || "🧠",
    color: /^#([0-9a-f]{6})$/i.test(String(j.color)) ? j.color : "#6366f1",
    domain,
    brief: String(j.brief || "").slice(0, 400),
    systemPrompt: String(j.systemPrompt).slice(0, 6000),
    keywords: Array.isArray(j.keywords) ? j.keywords.map((k: any) => String(k)).slice(0, 20) : [],
  };
  return def;
}

export async function saveDynamic(def: DynamicSpecialistDef, companyId: string): Promise<DynamicSpecialistDef> {
  await ensureRuntimeTables();
  const toSave = { ...def, companyId };
  try {
    await db.insert(schema.dynamicSpecialists).values({
      id: toSave.id,
      companyId,
      slug: toSave.slug,
      label: toSave.label,
      labelEn: toSave.labelEn,
      desc: toSave.desc,
      emoji: toSave.emoji,
      color: toSave.color,
      domain: toSave.domain,
      brief: toSave.brief,
      systemPrompt: toSave.systemPrompt,
      keywords: JSON.stringify(toSave.keywords),
      useCount: 1,
    }).onConflictDoNothing();
  } catch (e: any) {
    console.error("[dyn-spec] saveDynamic failed:", e?.message);
  }
  return toSave;
}

export async function bumpUse(id: string): Promise<void> {
  try {
    await db.update(schema.dynamicSpecialists)
      .set({ useCount: sql`${schema.dynamicSpecialists.useCount} + 1` })
      .where(eq(schema.dynamicSpecialists.id, id));
  } catch {}
}

// ─── Exécution du spécialiste dynamique ───────────────────────────────────────
// Construit le system prompt final (persona + accès outils Velbaz + langue) et
// génère la réponse experte, en injectant l'historique récent.
const TOOLS_NOTE = `

OUTILS VELBAZ DISPONIBLES (utilise-les si pertinent, sinon ignore) :
- Prédiction d'évènement ancrée sur le réel : émets [PREDICT:sujet en anglais] pour obtenir de VRAIES cotes Polymarket + actu.
- Graphique crypto réel : [COIN_CHART:SYMBOL:INTERVAL].
- Recherche web temps réel : si tu as besoin d'une info actuelle, indique-le clairement.
N'invente JAMAIS de chiffres, de prix, de statistiques ou de faits : appuie-toi sur des données réelles ou dis explicitement que c'est une estimation. Réponds dans la langue de l'utilisateur.`;

export function buildDynamicSystemPrompt(def: DynamicSpecialistDef, ctx: { name?: string; idea?: string; industry?: string } = {}): string {
  const ctxLine = [
    ctx.name && `Entreprise: ${ctx.name}`,
    ctx.industry && `Secteur: ${ctx.industry}`,
    ctx.idea && `Activité: ${String(ctx.idea).slice(0, 300)}`,
  ].filter(Boolean).join(" | ");
  return `${def.systemPrompt}${ctxLine ? `\n\nContexte de l'entreprise cliente: ${ctxLine}` : ""}${TOOLS_NOTE}`;
}

export async function runDynamicSpecialist(
  def: DynamicSpecialistDef,
  message: string,
  history: { role: string; content: string }[] = [],
  ctx: { name?: string; idea?: string; industry?: string } = {},
  safetyOff = false,
): Promise<string> {
  const system = `${buildDynamicSystemPrompt(def, ctx)}${safetyOff ? SAFETY_OFF_OVERRIDE : ''}`;
  const convo = history.length > 0
    ? history.slice(-12).filter((m) => m.role !== "system")
        .map((m) => `${m.role === "user" ? "User" : def.label}: ${m.content.slice(0, 700)}`).join("\n") + `\nUser: ${message}`
    : message;
  const preferModel = safetyOff && hasUncensoredProvider() ? UNCENSORED_MODEL : undefined;
  const text = await synthGenerate(system, convo, 1600, preferModel);
  return text;
}

// Marqueur machine-lisible en tête de réponse → carte front "✨ Nouveau spécialiste".
export function newSpecialistMarker(def: DynamicSpecialistDef, isNew: boolean): string {
  const payload = {
    label: def.label, emoji: def.emoji, color: def.color,
    desc: def.desc, domain: def.domain, isNew,
  };
  return `[NEW_SPECIALIST]${JSON.stringify(payload)}[/NEW_SPECIALIST]`;
}
