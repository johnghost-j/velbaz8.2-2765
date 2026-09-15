/**
 * App Builder API Routes
 * ----------------------
 * Wires the full-stack app generator (engine.ts) into Velbaz:
 *   POST /companies/:id/build-app     → generate a real React+Vite+Hono app (background job)
 *   GET  /companies/:id/build-status  → poll the current build job
 *   GET  /companies/:id/files         → list persisted project files
 *   GET  /companies/:id/preview/*     → reverse-proxy to the running dev server
 */

import { Hono } from "hono";
import { db } from "../database/index";
import { eq, and, desc } from "drizzle-orm";
import * as schema from "../database/schema";
import { v4 as uuidv4 } from "uuid";
import { generateApp, editApp, buildAppTsx, planApp } from "./engine";
import {
  writeFilesToDisk,
  writeFilesIncremental,
  installDeps,
  ensureRequiredDeps,
  buildWithAutoFix,
  startDevServer,
  stopDevServer,
  getRunningApp,
  ensureRunningApp,
  getPreviewRevision,
} from "./runner";
import type { RunningApp } from "./runner";
import type { ScaffoldFile } from "./scaffold";

const builder = new Hono();

// ─── Auth helper (self-contained; mirrors index.ts getUser) ──────────────────
async function getUser(c: any) {
  try {
    const token = c.req.header("Authorization")?.replace("Bearer ", "");
    if (!token) return null;
    const session = await db.select().from(schema.sessions).where(eq(schema.sessions.id, token)).get();
    if (!session || session.expiresAt < new Date()) return null;
    return (await db.select().from(schema.users).where(eq(schema.users.id, session.userId)).get()) || null;
  } catch {
    return null;
  }
}

async function ownedCompany(c: any) {
  const user = await getUser(c);
  if (!user) return { error: "Unauthorized" as const, status: 401 as const };
  const companyId = c.req.param("id");
  // Le propriétaire accède directement.
  let company = await db
    .select()
    .from(schema.companies)
    .where(and(eq(schema.companies.id, companyId), eq(schema.companies.userId, user.id)))
    .get();
  if (!company) {
    // Sinon : autorisé si collaborateur accepté du projet (édition partagée).
    const collab = await db
      .select()
      .from(schema.projectCollaborators)
      .where(and(
        eq(schema.projectCollaborators.companyId, companyId),
        eq(schema.projectCollaborators.userId, user.id),
        eq(schema.projectCollaborators.status, "accepted"),
      ))
      .get();
    if (collab) {
      company = await db.select().from(schema.companies).where(eq(schema.companies.id, companyId)).get();
    }
  }
  if (!company) return { error: "Not found" as const, status: 404 as const };
  return { company };
}

/** Primary language configured for the company (companies.languages[0]). */
function companyPrimaryLang(company: any): string | undefined {
  try {
    const langs = JSON.parse(company?.languages || "[]");
    if (Array.isArray(langs) && langs.length > 0 && langs[0]) return String(langs[0]).toLowerCase();
  } catch { /* ignore */ }
  return undefined;
}

// ─── Build job tracking (in-memory) ──────────────────────────────────────────
type BuildJob = {
  companyId: string;
  status: "running" | "completed" | "failed";
  step: string;
  logs: string[];
  previewUrl?: string;
  fileCount?: number;
  error?: string;
  startedAt: number;
  completedAt?: number;
};
const buildJobs = new Map<string, BuildJob>();

function fileTypeFor(path: string): string {
  if (path.startsWith("src/pages/")) return "page";
  if (path.startsWith("src/components/")) return "component";
  if (path.startsWith("src/lib/")) return "lib";
  if (path.startsWith("server/")) return "route";
  if (/\.(css|scss)$/.test(path)) return "style";
  if (/App\.tsx?$/.test(path)) return "layout";
  if (/(config|json|env|vite|tailwind|postcss|tsconfig|index\.html)/i.test(path)) return "config";
  return "asset";
}

// Fetch the AI-generated brand logo for a company so it can be shown in the
// generated site (Header/Footer/favicon). The logo is produced during company
// init and stored as a data URI in design_assets (type "logo"). Returns "" when
// none exists yet.
// ── Dropshipping : catalogue des produits sourcés (vrais produits fournisseur) ──
export interface DropshipCatalogItem {
  id: string;              // productId Velbaz (part dans la metadata Stripe)
  name: string;
  description: string | null;
  priceCents: number;      // prix de vente en centimes
  currency: string;
  imageUrl: string | null;
  supplier: string;        // cj | aliexpress | service
  variants: Array<{ vid: string | null; label: string; priceCents: number | null }>;
}

async function getDropshipCatalog(companyId: string): Promise<DropshipCatalogItem[]> {
  const rows = await db.select().from(schema.products)
    .where(and(eq(schema.products.companyId, companyId), eq(schema.products.status, "active")))
    .limit(30);
  const out: DropshipCatalogItem[] = [];
  for (const p of rows) {
    if (p.retailPrice == null || p.retailPrice <= 0) continue;
    let tags: string[] = [];
    try { tags = JSON.parse(p.tags || "[]"); } catch { /* tags libres */ }
    if (!tags.includes("dropshipping")) continue;
    const supplier = tags.includes("aliexpress") ? "aliexpress" : tags.includes("service") ? "service" : "cj";
    let variants: DropshipCatalogItem["variants"] = [];
    try {
      const vs = JSON.parse(p.variants || "[]");
      if (Array.isArray(vs)) variants = vs.slice(0, 50).map((v: any) => ({
        vid: v?.vid ? String(v.vid) : null,
        label: String(v?.label || ""),
        priceCents: v?.price != null && Number.isFinite(Number(v.price)) ? Math.round(Number(v.price) * 100) : null,
      }));
    } catch { /* variantes absentes */ }
    const img = await db.select().from(schema.productImages)
      .where(and(eq(schema.productImages.productId, p.id), eq(schema.productImages.companyId, companyId)))
      .orderBy(schema.productImages.sortOrder).limit(1);
    const imageUrl = img[0]?.imageData && /^https?:\/\//.test(img[0].imageData) ? img[0].imageData : null;
    out.push({
      id: p.id, name: p.name, description: p.description,
      priceCents: Math.round(p.retailPrice * 100), currency: "eur",
      imageUrl, supplier, variants,
    });
  }
  return out;
}

// Fichier src/lib/catalog.ts injecté dans le site généré : catalogue réel.
function catalogFileContent(catalog: DropshipCatalogItem[]): string {
  return `// ─── CATALOGUE RÉEL (généré par Velbaz — produits sourcés fournisseur) ───────
// Ne PAS inventer de produits : ce catalogue est la source de vérité.
// checkout() avec productId + vid déclenche la commande fournisseur automatique.
export interface CatalogVariant { vid: string | null; label: string; priceCents: number | null; }
export interface CatalogProduct {
  id: string; name: string; description: string | null;
  priceCents: number; currency: string; imageUrl: string | null;
  supplier: string; variants: CatalogVariant[];
}
export const CATALOG: CatalogProduct[] = ${JSON.stringify(catalog, null, 2)};
export function findProduct(id: string): CatalogProduct | undefined {
  return CATALOG.find((p) => p.id === id);
}
`;
}

// Pages légales dropshipping (obligatoires : CGV, livraison réelle, retours, mentions).
// Injectées comme le catalogue — l'IA les affiche, elle ne les invente pas.
function legalFileContent(companyName: string): string {
  const pages = [
    {
      slug: "cgv",
      title: "Conditions Générales de Vente",
      body: `Les présentes CGV régissent les ventes conclues sur la boutique ${companyName}.

1. Commande — Toute commande vaut acceptation des prix et descriptions des produits. La commande est confirmée après paiement via Stripe (paiement sécurisé).

2. Prix — Les prix sont indiqués toutes taxes comprises. ${companyName} se réserve le droit de modifier ses prix à tout moment ; les produits sont facturés au prix en vigueur au moment de la commande.

3. Expédition — Les produits sont expédiés directement depuis les entrepôts de nos fournisseurs partenaires. Le délai de livraison constaté est de 7 à 15 jours ouvrés après confirmation de la commande. Un numéro de suivi est envoyé par e-mail dès l'expédition.

4. Droit de rétractation — Conformément à la législation européenne, vous disposez de 14 jours à compter de la réception pour exercer votre droit de rétractation, sans justification. Les frais de retour restent à votre charge sauf produit défectueux.

5. Remboursement — Le remboursement intervient sous 14 jours après réception du retour, sur le moyen de paiement utilisé lors de la commande.

6. Service client — Pour toute question ou réclamation, contactez-nous via la page contact du site. Réponse sous 48 h ouvrées.`,
    },
    {
      slug: "livraison",
      title: "Livraison & Suivi",
      body: `Délais réels — Nos produits sont expédiés depuis les entrepôts de nos fournisseurs partenaires (principalement en Asie). Comptez 7 à 15 jours ouvrés de livraison après confirmation de commande. Ce délai est affiché avant l'achat : pas de mauvaise surprise.

Suivi — Dès l'expédition, vous recevez par e-mail un numéro de suivi avec un lien pour suivre votre colis en temps réel.

Frais — Les frais de livraison (le cas échéant) sont affichés avant le paiement. Adresse de livraison collectée de façon sécurisée par Stripe au moment du paiement.

Zones desservies — Union européenne, Royaume-Uni, Suisse, Norvège, États-Unis et Canada.`,
    },
    {
      slug: "retours",
      title: "Retours & Remboursements",
      body: `Vous avez 14 jours après réception pour changer d'avis (droit de rétractation européen).

Comment faire — Contactez-nous via la page contact avec votre numéro de commande. Nous vous indiquons l'adresse de retour. Le produit doit être renvoyé dans son état d'origine.

Produit défectueux ou non conforme — Envoyez-nous une photo : remboursement intégral ou renvoi gratuit, sans retour exigé dans la plupart des cas.

Remboursement — Sous 14 jours après validation du retour, sur votre moyen de paiement d'origine.`,
    },
    {
      slug: "mentions-legales",
      title: "Mentions légales",
      body: `Éditeur du site — ${companyName}.

Vente en dropshipping — Les produits vendus sur ce site sont expédiés directement par nos fournisseurs partenaires. ${companyName} reste votre unique interlocuteur : commande, livraison, retours et remboursements sont gérés par nous.

Paiement — Les paiements sont traités par Stripe. Aucune donnée bancaire n'est stockée sur ce site.

Données personnelles — Les informations collectées (e-mail, adresse de livraison) servent uniquement au traitement de votre commande et ne sont jamais revendues. Vous pouvez demander leur suppression via la page contact.

Hébergement — Site propulsé par Velbaz.`,
    },
  ];
  return `// ─── PAGES LÉGALES (générées par Velbaz — dropshipping conforme UE) ──────────
// Affiche ces textes tels quels : délais réels, rétractation 14 j, mentions.
export interface LegalPage { slug: string; title: string; body: string; }
export const LEGAL_PAGES: LegalPage[] = ${JSON.stringify(pages, null, 2)};
export function findLegalPage(slug: string): LegalPage | undefined {
  return LEGAL_PAGES.find((p) => p.slug === slug);
}
`;
}

// Consigne boutique pour le prompt de génération (ctx.products).
function dropshipProductsPrompt(catalog: DropshipCatalogItem[]): string {
  const lines = catalog.slice(0, 10).map((p) =>
    `${p.name} — ${(p.priceCents / 100).toFixed(2)}€${p.variants.length ? ` (${p.variants.length} variantes)` : ""}`);
  return `CATALOGUE RÉEL de ${catalog.length} produit(s) injecté dans src/lib/catalog.ts (import { CATALOG, findProduct } depuis "../lib/catalog").
RÈGLES BOUTIQUE OBLIGATOIRES:
- La page produits/boutique liste les produits de CATALOG (nom, imageUrl, prix = priceCents/100) — N'INVENTE AUCUN produit.
- Bouton Acheter → checkout([{ name: p.name, amount: variante?.priceCents ?? p.priceCents, quantity: qty, currency: p.currency, productId: p.id, vid: variante?.vid ?? undefined }]) importé depuis "../lib/api". Si le produit a des variantes, l'utilisateur DOIT en choisir une avant l'achat.
- Stripe collecte l'adresse de livraison automatiquement (produits physiques) — pas besoin de formulaire d'adresse.
- Affiche les délais de livraison réels (7-15 jours ouvrés) et un lien vers les CGV/politique de retour.
- PAGES LÉGALES : src/lib/legal.ts est injecté (import { LEGAL_PAGES, findLegalPage } depuis "../lib/legal"). Crée une page /legal (ou une page par slug) qui affiche LEGAL_PAGES tel quel (title + body, paragraphes séparés par les sauts de ligne), et mets des liens "CGV", "Livraison", "Retours", "Mentions légales" dans le footer de TOUTES les pages. N'invente PAS d'autres textes légaux.
Produits: ${lines.join(" | ")}`;
}

async function getCompanyLogoUrl(companyId: string): Promise<string> {
  try {
    const asset = await db
      .select()
      .from(schema.designAssets)
      .where(and(eq(schema.designAssets.companyId, companyId), eq(schema.designAssets.type, "logo")))
      .orderBy(desc(schema.designAssets.createdAt))
      .get();
    return asset?.content || "";
  } catch {
    return "";
  }
}

// [2026-09-04] `waitForCompanyLogo` SUPPRIMÉE. Elle sondait la base 120 s en
// bloquant tout le build, puis abandonnait en silence (`return ""`). C'était un
// timeout de repli qui masquait l'échec réel de génération du logo — exactement
// ce qu'on ne veut plus. Le logo se lit désormais sans attente
// (`getCompanyLogoUrl`) et le build ne se bloque plus jamais dessus.

async function persistFiles(companyId: string, files: ScaffoldFile[]) {
  const now = new Date().toISOString();
  // wipe prior project files for this company
  await db.delete(schema.projectFiles).where(eq(schema.projectFiles.companyId, companyId)).catch(() => {});
  for (const f of files) {
    await db
      .insert(schema.projectFiles)
      .values({
        id: uuidv4(),
        companyId,
        filePath: f.path,
        content: f.content,
        fileType: fileTypeFor(f.path),
        version: 1,
        createdAt: now,
        updatedAt: now,
      })
      .catch(() => {});
  }
}

// Upsert only changed files (used by chat edits) — bumps version, keeps the rest.
async function upsertFiles(companyId: string, files: ScaffoldFile[]) {
  const now = new Date().toISOString();
  for (const f of files) {
    const existing = await db
      .select()
      .from(schema.projectFiles)
      .where(and(eq(schema.projectFiles.companyId, companyId), eq(schema.projectFiles.filePath, f.path)))
      .get();
    if (existing) {
      await db
        .update(schema.projectFiles)
        .set({ content: f.content, version: (existing.version || 1) + 1, updatedAt: now })
        .where(eq(schema.projectFiles.id, existing.id))
        .catch(() => {});
    } else {
      await db
        .insert(schema.projectFiles)
        .values({
          id: uuidv4(),
          companyId,
          filePath: f.path,
          content: f.content,
          fileType: fileTypeFor(f.path),
          version: 1,
          createdAt: now,
          updatedAt: now,
        })
        .catch(() => {});
    }
  }
}

// ─── POST /companies/:id/plan-pages ──────────────────────────────────────────
// Plan-only pass: returns the proposed page list (no code generated) so the
// frontend can show a page-selection questionnaire. The user then picks which
// pages to keep and can add custom ones before launching the full build.
builder.post("/companies/:id/plan-pages", async (c) => {
  const res = await ownedCompany(c);
  if ("error" in res) return c.json({ error: res.error }, res.status);
  const company = res.company;

  let userMessage = "";
  try {
    const body = await c.req.json();
    userMessage = body?.message || body?.prompt || "";
  } catch { /* no body */ }

  try {
    const plan = await planApp({
      companyName: company.name,
      idea: company.idea || "",
      industry: company.industry || undefined,
      userMessage,
      preferredLang: companyPrimaryLang(company),
    }, undefined, { skipResearch: true });
    // Only expose the fields the questionnaire needs. Everything else
    // (entities, appType) is recomputed at build time.
    const pages = (plan.pages || []).map((p) => ({
      name: p.name,
      file: p.file,
      route: p.route,
      purpose: p.purpose || "",
      sections: p.sections || "",
      isCore: !!p.isCore,
      hasForm: !!p.hasForm,
      hasPayment: !!p.hasPayment,
    }));
    return c.json({ appType: plan.appType, pages }, 200);
  } catch (err: any) {
    return c.json({ error: String(err?.message || err).slice(0, 300) }, 500);
  }
});

// ─── POST /companies/:id/select-pages ────────────────────────────────────────
// Persist the pages the user chose in the questionnaire (kept pages + any
// custom ones they added). These become authoritative at build time and skip
// AI planning. Pass an empty array / omit to clear the selection (AI plans).
builder.post("/companies/:id/select-pages", async (c) => {
  const res = await ownedCompany(c);
  if ("error" in res) return c.json({ error: res.error }, res.status);
  const companyId = res.company.id;

  let pages: any[] = [];
  try {
    const body = await c.req.json();
    if (Array.isArray(body?.pages)) pages = body.pages;
  } catch { /* no body */ }

  // Normalize + guard: every page needs a name/route/file. Auto-derive file &
  // route for custom pages the user typed by hand.
  const slug = (s: string) => (s || "page").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "page";
  const clean = pages
    .filter((p) => p && typeof p.name === "string" && p.name.trim().length > 0)
    .map((p, i) => {
      const name = p.name.trim();
      const base = slug(name);
      const file = typeof p.file === "string" && p.file.trim() ? p.file.trim() : `${name.replace(/[^a-zA-Z0-9]/g, "")}.tsx`;
      const route = typeof p.route === "string" && p.route.trim() ? p.route.trim() : (i === 0 ? "/" : `/${base}`);
      return {
        name,
        file,
        route,
        purpose: typeof p.purpose === "string" ? p.purpose : "",
        sections: typeof p.sections === "string" ? p.sections : "",
        isCore: !!p.isCore,
        hasForm: !!p.hasForm,
        hasPayment: !!p.hasPayment,
        custom: !!p.custom,
      };
    });

  await db
    .update(schema.companies)
    .set({ selectedPages: clean.length ? JSON.stringify(clean) : null })
    .where(eq(schema.companies.id, companyId))
    .catch(() => {});

  return c.json({ ok: true, count: clean.length }, 200);
});

// ─── POST /companies/:id/build-app ───────────────────────────────────────────
builder.post("/companies/:id/build-app", async (c) => {
  const res = await ownedCompany(c);
  if ("error" in res) return c.json({ error: res.error }, res.status);
  const company = res.company;
  const companyId = company.id;

  const existing = buildJobs.get(companyId);
  if (existing?.status === "running") {
    return c.json({ status: "already_running", step: existing.step });
  }

  let userMessage = "";
  try {
    const body = await c.req.json();
    userMessage = body?.message || body?.prompt || "";
  } catch {
    /* no body */
  }

  const job: BuildJob = {
    companyId,
    status: "running",
    step: "Démarrage…",
    logs: [],
    startedAt: Date.now(),
  };
  buildJobs.set(companyId, job);
  const push = (msg: string) => {
    job.step = msg;
    job.logs.push(msg);
    if (job.logs.length > 200) job.logs.shift();
    console.log(`[build-app:${companyId}] ${msg}`);
  };

  // Fire and forget
  (async () => {
    try {
      // ── [2026-09-04] PLUS D'ATTENTE BLOQUANTE SUR LE LOGO ────────────────
      // Avant : `await waitForCompanyLogo(companyId, push)` sondait la base
      // pendant 120 s AVANT la moindre autre tâche. Résultat : après validation
      // du plan, l'écran affichait une seule ligne figée « ⏳ Attente du logo »
      // et se bloquait ~125 s, puis la fonction rendait "" EN SILENCE — l'échec
      // de génération du logo était masqué par le timeout au lieu d'être traité.
      // Le build démarre maintenant IMMÉDIATEMENT et streame ses vraies tâches.
      const logoUrl = await getCompanyLogoUrl(companyId);
      if (logoUrl) push("🎨 Logo de marque intégré au site");
      else push("ℹ️ Logo de marque pas encore disponible — le site est généré sans, il sera appliqué dès qu'il est prêt");
      // ── Dropshipping : si l'entreprise a des produits sourcés (vrais produits
      // fournisseur avec prix), le site est généré AVEC la boutique branchée :
      // catalogue réel injecté (src/lib/catalog.ts) + consigne dans le prompt.
      const catalog = await getDropshipCatalog(companyId);
      if (catalog.length) push(`🛒 Boutique branchée : ${catalog.length} produit(s) sourcé(s) injecté(s) dans le site`);

      // ── APERÇU EN DIRECT (HMR) ────────────────────────────────────────────
      // L'engine émet un scaffold COMPLET bootable (stubs skeleton pour chaque
      // page) dès que le routage est connu, puis chaque vraie page via des
      // émissions successives. On écrit ce scaffold sur disque et on démarre
      // Vite IMMÉDIATEMENT : l'utilisateur voit l'app tourner (skeleton) en
      // quelques secondes, puis chaque page réelle REMPLACE son stub → HMR →
      // l'aperçu se remplit page par page SOUS SES YEUX (au lieu d'un skeleton
      // figé jusqu'à la toute fin). `onFileReady` est best-effort : s'il échoue,
      // le build continue et l'aperçu final s'affiche normalement à la fin.
      let liveStarted = false;
      let liveStarting: Promise<void> | null = null;
      const onFileReady = async (files: ScaffoldFile[], kind: string) => {
        if (!files.length) return;
        try {
          if (!liveStarted) {
            // Première émission (scaffold complet) : écrire + installer + démarrer Vite.
            if (!liveStarting) {
              liveStarting = (async () => {
                const d = await writeFilesToDisk(companyId, files);
                await ensureRequiredDeps(d);
                const inst = await installDeps(d);
                if (!inst.ok) push("⚠️ Installation partielle — aperçu en direct quand même");
                const app = await startDevServer(companyId, d);
                job.previewUrl = `/api/companies/${companyId}/preview/`;
                liveStarted = true;
                push(`🌐 Aperçu en direct prêt — le site se construit sous vos yeux (port ${app.port})`);
              })();
            }
            await liveStarting;
          } else {
            // Émissions suivantes (pages, images, wiring) : écriture incrémentale.
            // `milestone: false` pour les snapshots partiels d'une page en cours
            // de streaming (code encore incomplet) : on écrit sur disque mais on
            // ne déclenche PAS de rechargement de l'aperçu, sinon il rechargerait
            // toutes les secondes sur du code à moitié écrit.
            await writeFilesIncremental(companyId, files, {
              milestone: kind !== "page-partial",
            });
          }
        } catch {
          /* aperçu best-effort : ne jamais casser le build */
        }
      };

      const generated = await generateApp(
        {
          companyName: company.name,
          idea: company.idea || "",
          industry: company.industry || undefined,
          userMessage,
          logoUrl,
          preferredLang: companyPrimaryLang(company),
          products: catalog.length ? dropshipProductsPrompt(catalog) : undefined,
          country: (company as any).country || undefined,
        },
        push,
        undefined,
        undefined,
        undefined,
        onFileReady,
      );

      // Keep the design system + plan alongside the project so future chat edits
      // stay on-brand and can deterministically regenerate App.tsx routing.
      const filesWithMeta = [
        ...generated.files,
        ...(catalog.length ? [
          { path: "src/lib/catalog.ts", content: catalogFileContent(catalog) },
          { path: "src/lib/legal.ts", content: legalFileContent(company.name) },
        ] : []),
        { path: ".velbaz/design.json", content: JSON.stringify(generated.design ?? {}, null, 2) },
        { path: ".velbaz/plan.json", content: JSON.stringify(generated.plan ?? {}, null, 2) },
      ];

      let dir: string;
      if (liveStarted) {
        // L'aperçu en direct tourne déjà : les fichiers sont sur disque et Vite
        // est démarré. On écrit la version FINALE en incrémental (pas de rm -rf,
        // pas de réinstall, pas de 2ᵉ serveur) — HMR reflète la mise à jour.
        push(`💾 Finalisation de ${filesWithMeta.length} fichiers…`);
        dir = await writeFilesIncremental(companyId, filesWithMeta);
      } else {
        // Aperçu en direct non démarré (fallback) : écriture fraîche + install.
        push(`💾 Écriture de ${filesWithMeta.length} fichiers…`);
        dir = await writeFilesToDisk(companyId, filesWithMeta);

        // Heal missing runtime deps the generated code imports (framer-motion…)
        // before install, so an unresolved import never blanks the preview.
        await ensureRequiredDeps(dir);

        push("📦 Installation des dépendances…");
        const install = await installDeps(dir);
        if (!install.ok) push("⚠️ Installation partielle — poursuite du build");
      }

      push("🏗️ Build + auto-correction…");
      const built = await buildWithAutoFix(dir, generated.files, push);
      // Refléter les fichiers auto-corrigés dans l'aperçu en direct (HMR).
      if (liveStarted) { try { await writeFilesIncremental(companyId, built.files); } catch {} }
      const finalFiles = [
        ...built.files,
        ...(catalog.length && !built.files.some((f) => f.path === "src/lib/catalog.ts")
          ? [{ path: "src/lib/catalog.ts", content: catalogFileContent(catalog) }] : []),
        ...(catalog.length && !built.files.some((f) => f.path === "src/lib/legal.ts")
          ? [{ path: "src/lib/legal.ts", content: legalFileContent(company.name) }] : []),
        { path: ".velbaz/design.json", content: JSON.stringify(generated.design ?? {}, null, 2) },
        { path: ".velbaz/plan.json", content: JSON.stringify(generated.plan ?? {}, null, 2) },
      ];

      push("💾 Sauvegarde des fichiers en base…");
      await persistFiles(companyId, finalFiles);

      // Réutiliser le serveur déjà lancé par l'aperçu en direct ; sinon le démarrer.
      let runningApp = getRunningApp(companyId);
      if (!runningApp) {
        push("🚀 Démarrage du serveur de prévisualisation…");
        runningApp = await startDevServer(companyId, dir);
      }

      job.previewUrl = `/api/companies/${companyId}/preview/`;
      job.fileCount = finalFiles.length;
      job.status = "completed";
      job.completedAt = Date.now();
      push(`✅ App prête — ${finalFiles.length} fichiers, aperçu sur le port ${runningApp.port}`);

      // Activity log
      await db
        .insert(schema.agentActivity)
        .values({
          id: uuidv4(),
          companyId,
          agentRole: "engineering",
          action: "completed",
          message: `✅ App full-stack générée — ${finalFiles.length} fichiers (${generated.plan.appType})`,
        })
        .catch(() => {});
    } catch (err: any) {
      job.status = "failed";
      job.error = String(err?.message || err).slice(0, 500);
      job.completedAt = Date.now();
      push(`✗ Échec: ${job.error}`);
    }
  })();

  return c.json({ status: "started" });
});

// ─── POST /companies/:id/edit-app ────────────────────────────────────────────
// Apply a natural-language edit to the already-generated app (Lovable-style).
builder.post("/companies/:id/edit-app", async (c) => {
  const res = await ownedCompany(c);
  if ("error" in res) return c.json({ error: res.error }, res.status);
  const companyId = res.company.id;

  const existing = buildJobs.get(companyId);
  if (existing?.status === "running") {
    return c.json({ status: "already_running", step: existing.step });
  }

  let userMessage = "";
  try {
    const body = await c.req.json();
    userMessage = body?.message || body?.prompt || "";
  } catch { /* no body */ }
  if (!userMessage.trim()) return c.json({ error: "empty_message" }, 400);

  const job: BuildJob = { companyId, status: "running", step: "Analyse…", logs: [], startedAt: Date.now() };
  buildJobs.set(companyId, job);
  const push = (msg: string) => {
    job.step = msg;
    job.logs.push(msg);
    if (job.logs.length > 200) job.logs.shift();
    console.log(`[edit-app:${companyId}] ${msg}`);
  };

  (async () => {
    try {
      // Load current project from DB
      const rows = await db.select().from(schema.projectFiles).where(eq(schema.projectFiles.companyId, companyId));
      if (!rows.length) throw new Error("Aucune app à modifier — génère-la d'abord.");
      const files = rows.map((r) => ({ path: r.filePath, content: r.content, type: r.fileType }));
      let design: any = undefined;
      const designRow = files.find((f) => f.path === ".velbaz/design.json");
      if (designRow) { try { design = JSON.parse(designRow.content); } catch { /* ignore */ } }
      let plan: any = { pages: [] };
      const planRow = files.find((f) => f.path === ".velbaz/plan.json");
      if (planRow) { try { plan = JSON.parse(planRow.content); } catch { /* ignore */ } }

      const result = await editApp(userMessage, files, design, push);

      // If the edit added new content pages, merge them into the plan and
      // deterministically regenerate App.tsx routing (never AI-truncated).
      const extraFiles: ScaffoldFile[] = [];
      if (result.newRoutes.length) {
        const existingRoutes = new Set((plan.pages || []).map((p: any) => p.route));
        for (const nr of result.newRoutes) {
          if (!existingRoutes.has(nr.route)) {
            plan.pages = plan.pages || [];
            plan.pages.push({ name: nr.name, file: nr.file, route: nr.route, purpose: "", sections: "" });
          }
        }
        // Respecte l'état auth du projet: si l'app a été générée SANS système de
        // compte (pas de src/pages/Login.tsx), on ne réintroduit pas les routes
        // auth en régénérant le routage — sinon imports cassés + /login fantôme.
        const projectHasAuth = files.some((f) => f.path === "src/pages/Login.tsx");
        const appTsx = buildAppTsx(plan.pages, false, projectHasAuth);
        extraFiles.push({ path: "src/App.tsx", content: appTsx });
        extraFiles.push({ path: ".velbaz/plan.json", content: JSON.stringify(plan, null, 2) });
        push("🔗 Mise à jour du routage (App.tsx)…");
      }

      const allChanged = [...result.changed, ...extraFiles];

      // Write changed files live (Vite HMR reflects them immediately)
      push("💾 Application des changements…");
      const dir = await writeFilesIncremental(companyId, allChanged);

      // If the dev server isn't running, bring it up
      let runningApp = getRunningApp(companyId);
      if (!runningApp) {
        push("🚀 Démarrage du serveur de prévisualisation…");
        runningApp = await startDevServer(companyId, dir);
      }

      // Verify build; auto-fix if the edit broke something
      push("🏗️ Vérification…");
      const built = await buildWithAutoFix(dir, [...files, ...allChanged].reduce((acc, f) => {
        const i = acc.findIndex((x) => x.path === f.path);
        if (i >= 0) acc[i] = { path: f.path, content: f.content }; else acc.push({ path: f.path, content: f.content });
        return acc;
      }, [] as ScaffoldFile[]), push);
      // Persist changed + any auto-fixed files
      const changedPaths = new Set(allChanged.map((f) => f.path));
      const toPersist = built.files.filter((f) => changedPaths.has(f.path));
      // plan.json isn't part of the build set — persist it explicitly if updated.
      const planFile = allChanged.find((f) => f.path === ".velbaz/plan.json");
      if (planFile && !toPersist.some((f) => f.path === ".velbaz/plan.json")) toPersist.push(planFile);
      await upsertFiles(companyId, toPersist.length ? toPersist : allChanged);

      job.previewUrl = `/api/companies/${companyId}/preview/`;
      job.fileCount = allChanged.length;
      job.status = "completed";
      job.completedAt = Date.now();
      push(`✅ ${result.summary}`);

      await db.insert(schema.agentActivity).values({
        id: uuidv4(),
        companyId,
        agentRole: "engineering",
        action: "completed",
        message: `✏️ Édition app: ${result.summary}`,
      }).catch(() => {});
    } catch (err: any) {
      job.status = "failed";
      job.error = String(err?.message || err).slice(0, 500);
      job.completedAt = Date.now();
      push(`✗ Échec: ${job.error}`);
    }
  })();

  return c.json({ status: "started" });
});

// ─── GET /companies/:id/build-status ─────────────────────────────────────────
builder.get("/companies/:id/build-status", async (c) => {
  const res = await ownedCompany(c);
  if ("error" in res) return c.json({ error: res.error }, res.status);
  const job = buildJobs.get(res.company.id);
  const runningApp = getRunningApp(res.company.id);
  if (!job) {
    return c.json({
      status: runningApp ? "completed" : "none",
      previewUrl: runningApp ? `/api/companies/${res.company.id}/preview/` : undefined,
    });
  }
  return c.json({
    status: job.status,
    step: job.step,
    logs: job.logs.slice(-40),
    previewUrl: job.previewUrl,
    fileCount: job.fileCount,
    error: job.error,
  });
});

// ─── GET /companies/:id/files ────────────────────────────────────────────────
builder.get("/companies/:id/files", async (c) => {
  const res = await ownedCompany(c);
  if ("error" in res) return c.json({ error: res.error }, res.status);
  const rows = await db
    .select()
    .from(schema.projectFiles)
    .where(eq(schema.projectFiles.companyId, res.company.id));
  return c.json({
    files: rows
      .filter((r) => !r.filePath.startsWith(".velbaz/"))
      .map((r) => ({ path: r.filePath, type: r.fileType, content: r.content }))
      .sort((a, b) => a.path.localeCompare(b.path)),
  });
});

// ─── GET /companies/:id/github/status ────────────────────────────────────────
// Tells the UI whether a GitHub token is configured. Everything is implemented;
// the button just waits for the API key to be present in the env.
builder.get("/companies/:id/github/status", async (c) => {
  const res = await ownedCompany(c);
  if ("error" in res) return c.json({ error: res.error }, res.status);
  const { isGithubConfigured } = await import("./github-export");
  return c.json({ configured: isGithubConfigured() });
});

// ─── POST /companies/:id/export-github ───────────────────────────────────────
// Exports the whole project to a PRIVATE GitHub repository (one commit on main).
builder.post("/companies/:id/export-github", async (c) => {
  const res = await ownedCompany(c);
  if ("error" in res) return c.json({ error: res.error }, res.status);
  const { exportToGithub, isGithubConfigured, toRepoName } = await import("./github-export");

  if (!isGithubConfigured()) {
    return c.json({ error: "github_not_configured" }, 400);
  }

  // Gather every persisted project file (skip internal .velbaz/ metadata).
  const rows = await db
    .select()
    .from(schema.projectFiles)
    .where(eq(schema.projectFiles.companyId, res.company.id));
  const files = rows
    .filter((r) => !r.filePath.startsWith(".velbaz/"))
    .map((r) => ({ path: r.filePath, content: r.content || "" }));

  if (files.length === 0) {
    return c.json({ error: "no_files" }, 400);
  }

  // Optional custom repo name from the request body, else the project name.
  let requestedName = "";
  try { requestedName = (await c.req.json())?.repoName || ""; } catch { /* no body */ }
  const repoName = toRepoName(requestedName || res.company.name || "velbaz-project");

  const result = await exportToGithub(repoName, files, {
    description: `${res.company.name || "Velbaz project"} — exported from Velbaz`,
    commitMessage: "Export from Velbaz",
  });

  if (!result.ok) {
    return c.json({ error: result.error, detail: result.detail }, 400);
  }
  return c.json(result);
});

// ─── POST /companies/:id/preview/stop ────────────────────────────────────────
builder.post("/companies/:id/preview/stop", async (c) => {
  const res = await ownedCompany(c);
  if ("error" in res) return c.json({ error: res.error }, res.status);
  stopDevServer(res.company.id);
  return c.json({ ok: true });
});

// ─── POST /companies/:id/preview/start ───────────────────────────────────────
// Restart the dev server from files already on disk (or re-materialized from DB).
builder.post("/companies/:id/preview/start", async (c) => {
  const res = await ownedCompany(c);
  if ("error" in res) return c.json({ error: res.error }, res.status);
  const companyId = res.company.id;
  try {
    // Route through the same locked revive path the proxy uses (ensureRunningApp),
    // instead of calling startDevServer directly. Calling startDevServer here
    // unconditionally used to race with the proxy's own auto-heal (both can fire
    // around the same time — e.g. page reload hitting /preview/* right after the
    // client calls /preview/start) and spawn TWO Vite dev servers for the same
    // company on different ports. Whichever one won the `running` map race got
    // served, so the app could intermittently serve a stale port/build. The
    // per-company lock in ensureRunningApp coalesces both callers onto one server.
    const app = await ensureRunningApp(companyId, {
      getFiles: async () => {
        const rows = await db
          .select()
          .from(schema.projectFiles)
          .where(eq(schema.projectFiles.companyId, companyId));
        return rows.map((r) => ({ path: r.filePath, content: r.content }));
      },
    });
    if (!app) return c.json({ error: "no_files" }, 400);
    return c.json({ ok: true, previewUrl: `/api/companies/${companyId}/preview/`, port: app.port });
  } catch (e: any) {
    return c.json({ error: String(e?.message || e) }, 500);
  }
});

// ─── "Made with Velbaz" badge ─────────────────────────────────────────────────
// Injected at SERVE TIME into the HTML of every generated site (preview +
// published) so it always reflects the CURRENT plan status: if the owner later
// downgrades to free, the badge reappears on the very next request without any
// rebuild. It is NOT baked into the generated React source for exactly this
// reason.
const VELBAZ_URL = process.env.VELBAZ_URL || "https://velbaz.com";
const VELBAZ_BADGE_HTML =
  `<a href="${VELBAZ_URL}" target="_blank" rel="noopener noreferrer" data-velbaz-badge="1" ` +
  // Design: shadcn/ui Button (variant default, rounded-full) — texte seul, sans
  // pastille avatar. Équivalent CSS inline du composant React, car ce markup est
  // injecté dans des sites tiers (ni Tailwind ni React ici).
  `style="position:fixed;bottom:18px;right:18px;z-index:2147483647;` +
  `display:inline-flex;align-items:center;justify-content:center;box-sizing:border-box;` +
  `height:40px;padding:0 16px;gap:2px;` +
  `background:#0b0f19;color:#fff;` +
  `font:500 13px/1 ui-sans-serif,system-ui,-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;` +
  `text-decoration:none;white-space:nowrap;` +
  `border-radius:9999px;border:1px solid rgba(255,255,255,.10);` +
  `box-shadow:0 1px 2px rgba(0,0,0,.05),0 8px 24px rgba(0,0,0,.30);` +
  `transition:background-color .15s ease,transform .15s ease,box-shadow .15s ease" ` +
  `onmouseover="this.style.background='#151b2b';this.style.transform='translateY(-1px)';this.style.boxShadow='0 1px 2px rgba(0,0,0,.05),0 12px 30px rgba(0,0,0,.40)'" ` +
  `onmouseout="this.style.background='#0b0f19';this.style.transform='none';this.style.boxShadow='0 1px 2px rgba(0,0,0,.05),0 8px 24px rgba(0,0,0,.30)'">` +
  `Made with&nbsp;<strong style="font-weight:700">Velbaz</strong></a>`;

// Badge visibility rule: show = !(badgeHidden && ownerHasPaidPlan).
// - badge_hidden not set                     → always show
// - badge_hidden set BUT owner is on free    → show (reappears after downgrade)
// - badge_hidden set AND owner is paid        → hide
async function shouldShowVelbazBadge(companyId: string): Promise<boolean> {
  try {
    const company = await db
      .select({ userId: schema.companies.userId, badgeHidden: schema.companies.badgeHidden })
      .from(schema.companies)
      .where(eq(schema.companies.id, companyId))
      .get();
    if (!company) return true;
    if (!company.badgeHidden) return true;
    const owner = await db
      .select({ plan: schema.users.plan })
      .from(schema.users)
      .where(eq(schema.users.id, company.userId))
      .get();
    const ownerPaid = !!owner && (owner.plan || "free").toLowerCase() !== "free";
    return !ownerPaid;
  } catch {
    return true; // fail open → badge stays visible
  }
}

// ─── Aperçu EN DIRECT sans WebSocket ─────────────────────────────────────────
// [2026-09-11] Correctif « l'aperçu montre un squelette au lieu du vrai code ».
//
// Le HMR de Vite est INOPÉRANT derrière l'aperçu : son client ouvre le
// WebSocket sur l'URL publique de la page (`/api/companies/<id>/preview/`),
// donc sur le reverse proxy ci-dessous, qui est un `fetch()` HTTP sans
// `Upgrade` — vérifié : la requête d'upgrade ne reçoit jamais de 101. Vite
// bascule alors sur son repli direct `localhost:<portVite>`, injoignable depuis
// le navigateur de l'utilisateur. Conséquence : les stubs squelette écrits au
// démarrage restaient affichés pendant TOUT le build, et le vrai site
// n'apparaissait qu'à la fin, quand le panneau remontait une iframe neuve.
//
// On remplace donc le canal HMR par un rechargement piloté par révision :
//   1. `runner.ts` incrémente une révision à chaque écriture de fichier ;
//   2. la route publique ci-dessous l'expose ;
//   3. le script ci-dessous est injecté dans le HTML servi par le proxy et
//      recharge l'iframe dès que la révision a bougé PUIS s'est stabilisée
//      (≈1,5 s sans écriture = une page vient de finir d'être générée).
//
// `location.reload()` conserve l'URL courante : si l'utilisateur a navigué dans
// l'aperçu, il reste sur SA page — elle se met simplement à jour. C'est la
// différence avec l'ancien remontage d'iframe (qui ramenait à l'accueil) que
// l'utilisateur avait explicitement refusé.
const PREVIEW_ACTIVE_MS = 5 * 60 * 1000; // écriture récente = build/édition en cours

// Publique (comme le proxy /preview/*) : le script tourne DANS l'iframe du site
// généré, il n'a aucun jeton d'authentification à présenter.
builder.get("/companies/:id/preview-revision", (c) => {
  const { rev, mrev, at } = getPreviewRevision(c.req.param("id"));
  return c.json(
    { rev, mrev, at, active: at > 0 && Date.now() - at < PREVIEW_ACTIVE_MS },
    200,
    { "Cache-Control": "no-store, no-cache, must-revalidate, max-age=0" },
  );
});

function liveReloadScript(companyId: string, bootRev: number, bootMrev: number): string {
  return `<script data-velbaz-live="1">(function(){
var u="/api/companies/${companyId}/preview-revision";
var r0=${bootRev},m0=${bootMrev},quiet=Date.now(),pending=false,start=Date.now();
// Le rechargement doit être le moins visible possible : on restitue la position
// de défilement d'avant le rechargement (l'URL, elle, est déjà conservée par
// location.reload()).
var K="__velbaz_preview_scroll";
try{
  var s=sessionStorage.getItem(K);
  if(s!==null){sessionStorage.removeItem(K);
    var y=parseInt(s,10)||0;
    if(y>0){var n=0,ri=setInterval(function(){window.scrollTo(0,y);if(++n>20)clearInterval(ri);},50);}
  }
}catch(e){}
var iv=setInterval(tick,1200);
function stop(){clearInterval(iv);}
function tick(){
  // Aperçu laissé ouvert sans aucun jalon : on arrête de sonder après 10 min.
  if(!pending&&Date.now()-start>600000){stop();return;}
  fetch(u,{cache:"no-store"}).then(function(r){return r.json()}).then(function(d){
    if(!d)return;
    var rev=d.rev||0,mrev=d.mrev||0;
    // Toute écriture (même un snapshot partiel) = build encore en cours d'écriture
    // sur CE fichier : on repousse le rechargement pour ne jamais afficher du
    // code à moitié écrit.
    if(rev!==r0){r0=rev;quiet=Date.now();}
    // Jalon = une vraie page / le header / le footer / les images viennent d'être
    // écrits en entier : il y a du nouveau contenu réel à montrer.
    if(mrev!==m0){m0=mrev;pending=true;}
    if(!d.active&&!pending){stop();return;}
    if(pending&&Date.now()-quiet>1500&&!document.hidden){
      stop();
      try{sessionStorage.setItem(K,String(window.scrollY||0));}catch(e){}
      location.reload();
    }
  }).catch(function(){});
}
})();</script>`;
}

// ─── ALL /companies/:id/preview/* → reverse proxy to dev server ──────────────
// The dev server runs Vite with `--base /api/companies/:id/preview/`, i.e. the
// exact public path this proxy is reachable at. So we forward the full pathname
// (including the base) straight through — every URL Vite emits already resolves.
builder.all("/companies/:id/preview/*", async (c) => {
  const companyId = c.req.param("id");

  // The wildcard route above also matches the bare base path with NO trailing
  // slash (e.g. ".../preview" with nothing after it). If we proxied that as-is,
  // the child Vite dev server (configured with base ".../preview/") wouldn't
  // recognize the URL as being under its base and would answer with its own
  // "did you mean to visit .../preview/ instead?" 404 — which looked like a
  // blank/broken preview. Redirect to the trailing-slash URL instead, exactly
  // like Vite itself would for its root, so every entrypoint always resolves.
  {
    const reqUrl = new URL(c.req.url);
    const base = `/api/companies/${companyId}/preview`;
    if (reqUrl.pathname === base) {
      return c.redirect(`${base}/${reqUrl.search}`, 302);
    }
  }

  // Auto-heal: if the dev server isn't running (Velbaz restarted, Vite crashed,
  // or the map is cold), re-materialize from DB and restart it instead of
  // failing with 503. This keeps the preview from "disappearing".
  // `ensureRunningApp` renvoie `RunningApp | null` : le type doit accepter
  // null, sinon la réaffectation ci-dessous ne compile pas.
  let runningApp: RunningApp | null | undefined = getRunningApp(companyId);
  if (!runningApp) {
    runningApp = await ensureRunningApp(companyId, {
      getFiles: async () => {
        const rows = await db
          .select()
          .from(schema.projectFiles)
          .where(eq(schema.projectFiles.companyId, companyId));
        return rows.map((r) => ({ path: r.filePath, content: r.content }));
      },
    });
  }
  if (!runningApp) {
    return c.text("Preview not running. Build the app first.", 503);
  }

  const url = new URL(c.req.url);
  const upstream = `${runningApp.url}${url.pathname}${url.search}`;

  const headers = new Headers();
  c.req.raw.headers.forEach((v, k) => {
    const key = k.toLowerCase();
    // Drop hop-by-hop + conditional headers so upstream always returns a full 200 body
    // (we don't cache bodies here, so a 304 would render blank).
    if (["host", "connection", "content-length", "if-none-match", "if-modified-since"].includes(key)) return;
    headers.set(k, v);
  });

  const rawBody = ["GET", "HEAD"].includes(c.req.method) ? undefined : await c.req.raw.arrayBuffer();
  const doFetch = (target: string) =>
    fetch(target, { method: c.req.method, headers, body: rawBody, redirect: "manual" });

  try {
    let upstreamRes: Response;
    try {
      upstreamRes = await doFetch(upstream);
    } catch (firstErr) {
      // The dev server we had on file is dead (crashed/OOM-killed since the
      // last request). Self-heal in-request instead of surfacing an error
      // page: re-materialize + restart, then retry once against the fresh
      // port. This is what turns a "site went blank and stayed broken" into
      // a single slightly-slower reload.
      const revived = await ensureRunningApp(companyId, {
        getFiles: async () => {
          const rows = await db
            .select()
            .from(schema.projectFiles)
            .where(eq(schema.projectFiles.companyId, companyId));
          return rows.map((r) => ({ path: r.filePath, content: r.content }));
        },
      });
      if (!revived) throw firstErr;
      const retryUpstream = `${revived.url}${url.pathname}${url.search}`;
      upstreamRes = await doFetch(retryUpstream);
    }

    const outHeaders = new Headers();
    upstreamRes.headers.forEach((v, k) => {
      const key = k.toLowerCase();
      // Drop conditional/caching validators from the upstream Vite dev server.
      // Public preview URLs (company.runable.site) are fronted by a caching
      // layer we don't control (Google-fronted proxy in front of the tunnel —
      // observed via `via: 1.1 google` on responses that were otherwise missing
      // our own security headers, i.e. NOT hitting this process directly for
      // every hop). Vite's own "Cache-Control: no-cache" only asks that layer to
      // *revalidate* before reuse, and it kept re-serving an old cached HTML
      // (stale `src/main.tsx` reference) instead of the current one — reusing a
      // stale entry it had cached before an on-disk fix landed, no matter what
      // cache-busting query string we sent. Force a hard "no-store" from this
      // proxy on every response and strip etag/last-modified so nothing upstream
      // of us has a validator to (mis)use for a conditional/cached reuse.
      if (["content-encoding", "content-length", "transfer-encoding", "connection", "etag", "last-modified", "cache-control"].includes(key))
        return;
      outHeaders.set(k, v);
    });
    outHeaders.set("Cache-Control", "no-store, no-cache, must-revalidate, max-age=0");
    outHeaders.set("Pragma", "no-cache");

    // 204/304 (and other null-body statuses) must not carry a body.
    if (upstreamRes.status === 204 || upstreamRes.status === 304) {
      return new Response(null, { status: upstreamRes.status, headers: outHeaders });
    }

    // HTML pages get the "Made with Velbaz" badge injected at serve time, unless
    // the owner has a paid plan AND hid it. Only HTML 200s are rewritten; every
    // other asset (JS/CSS/images) passes straight through untouched.
    const ctype = (upstreamRes.headers.get("content-type") || "").toLowerCase();
    if (upstreamRes.status === 200 && ctype.includes("text/html")) {
      let html = new TextDecoder().decode(await upstreamRes.arrayBuffer());
      if (await shouldShowVelbazBadge(companyId)) {
        html = html.includes("</body>")
          ? html.replace("</body>", `${VELBAZ_BADGE_HTML}</body>`)
          : html + VELBAZ_BADGE_HTML;
      }
      // Rechargement en direct : injecté UNIQUEMENT quand des fichiers viennent
      // d'être écrits (build ou édition en cours). Un site publié consulté hors
      // build ne reçoit donc aucun script et ne sonde rien.
      const { rev, mrev, at } = getPreviewRevision(companyId);
      if (at > 0 && Date.now() - at < PREVIEW_ACTIVE_MS) {
        const tag = liveReloadScript(companyId, rev, mrev);
        html = html.includes("</body>") ? html.replace("</body>", `${tag}</body>`) : html + tag;
      }
      return new Response(html, { status: upstreamRes.status, headers: outHeaders });
    }

    const buf = await upstreamRes.arrayBuffer();
    return new Response(buf, { status: upstreamRes.status, headers: outHeaders });
  } catch (e: any) {
    // Even the self-heal failed — return a real HTML page (not a bare text/plain
    // body) so this never renders as a blank white screen, and auto-retry from
    // the client after a short delay in case the server finishes starting up.
    return c.html(
      `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="refresh" content="4">
      <style>body{font-family:system-ui,sans-serif;background:#0b0f19;color:#e5e7eb;display:flex;
      align-items:center;justify-content:center;min-height:100vh;margin:0;text-align:center;padding:24px}
      </style></head><body><div><div style="font-size:40px;margin-bottom:12px">🔄</div>
      <div style="font-size:16px;margin-bottom:6px">Redémarrage de l'aperçu…</div>
      <div style="font-size:13px;opacity:.6">${String(e?.message || e).slice(0, 200)}</div></div></body></html>`,
      502,
    );
  }
});

// ─── Project files (Code tab) ────────────────────────────────────────────────
// Ces routes n'existaient pas → le frontend recevait 404, donc pas de preview
// React et un onglet Code vide.

// GET /companies/:id/project-files → liste { files: [{path, type, size}] }
builder.get("/companies/:id/project-files", async (c) => {
  const res = await ownedCompany(c);
  if ("error" in res) return c.json({ error: res.error }, res.status);
  const rows = await db.select().from(schema.projectFiles)
    .where(eq(schema.projectFiles.companyId, res.company.id)).all();
  const files = rows
    .map((f) => ({ path: f.filePath, type: f.fileType, size: (f.content || "").length }))
    .sort((a, b) => a.path.localeCompare(b.path));
  return c.json({ files });
});

// GET /companies/:id/project-files/* → contenu d'un fichier { content }
builder.get("/companies/:id/project-files/*", async (c) => {
  const res = await ownedCompany(c);
  if ("error" in res) return c.json({ error: res.error }, res.status);
  const prefix = `/companies/${c.req.param("id")}/project-files/`;
  const idx = c.req.path.indexOf(prefix);
  const filePath = decodeURIComponent(c.req.path.slice(idx + prefix.length));
  if (!filePath) return c.json({ error: "Missing file path" }, 400);
  const file = await db.select().from(schema.projectFiles)
    .where(and(eq(schema.projectFiles.companyId, res.company.id), eq(schema.projectFiles.filePath, filePath)))
    .get();
  if (!file) return c.json({ error: "File not found" }, 404);
  return c.json({ content: file.content, path: file.filePath, type: file.fileType, version: file.version });
});

// PUT /companies/:id/project-files → sauvegarde { filePath, content }
builder.put("/companies/:id/project-files", async (c) => {
  const res = await ownedCompany(c);
  if ("error" in res) return c.json({ error: res.error }, res.status);
  const { filePath, content } = await c.req.json();
  if (!filePath || typeof content !== "string") return c.json({ error: "Missing filePath or content" }, 400);
  if (content.length > 2_000_000) return c.json({ error: "File too large" }, 413);
  const existing = await db.select().from(schema.projectFiles)
    .where(and(eq(schema.projectFiles.companyId, res.company.id), eq(schema.projectFiles.filePath, filePath)))
    .get();
  const now = new Date().toISOString();
  if (existing) {
    // Historique de version pour undo
    await db.insert(schema.projectFileVersions).values({
      id: uuidv4(), companyId: res.company.id, filePath,
      content: existing.content, version: existing.version || 1, createdAt: now,
    }).catch(() => {});
    await db.update(schema.projectFiles)
      .set({ content, version: (existing.version || 1) + 1, updatedAt: now })
      .where(eq(schema.projectFiles.id, existing.id));
  } else {
    await db.insert(schema.projectFiles).values({
      id: uuidv4(), companyId: res.company.id, filePath, content,
      fileType: filePath.startsWith("src/pages/") ? "page" : filePath.startsWith("src/components/") ? "component" : "config",
      version: 1, createdAt: now, updatedAt: now,
    });
  }
  // Répercute sur le projet matérialisé pour que le dev server recharge
  try { await writeFilesIncremental(res.company.id, [{ path: filePath, content }] as ScaffoldFile[]); } catch {}
  return c.json({ ok: true });
});

// ═══ APP MOBILE (Expo) ════════════════════════════════════════════════════
// Statut, (re)démarrage du tunnel Expo Go, et static serving de la preview web
// (export `expo export -p web`) affichée dans le cadre iPhone.

// GET /companies/:id/mobile/status → { running, expoUrl, webPreviewReady }
builder.get("/companies/:id/mobile/status", async (c) => {
  const res = await ownedCompany(c);
  if ("error" in res) return c.json({ error: res.error }, res.status);
  const companyId = res.company.id;
  const { getRunningMobile, mobileDistDir, mobileDir } = await import("./runner-mobile");
  const { existsSync } = await import("node:fs");
  const { join } = await import("node:path");
  const running = getRunningMobile(companyId);
  // Une construction (ou reconstruction) est-elle en cours pour ce projet ?
  const activeJob = await db.select({ id: schema.jobQueue.id }).from(schema.jobQueue)
    .where(and(eq(schema.jobQueue.companyId, companyId), eq(schema.jobQueue.status, "running")))
    .limit(1).all().catch(() => [] as any[]);
  // L'app mobile existe-t-elle vraiment (sur disque ou fichiers mobile/ en DB) ?
  const hasMobileFiles = existsSync(join(mobileDir(companyId), "package.json")) ||
    (await db.select({ filePath: schema.projectFiles.filePath }).from(schema.projectFiles)
      .where(eq(schema.projectFiles.companyId, companyId)).all().catch(() => [] as any[]))
      .some((r: any) => r.filePath.startsWith("mobile/"));
  return c.json({
    running: !!running,
    // URL exp:// vivante si le tunnel tourne, sinon la dernière connue (DB).
    expoUrl: running?.expoUrl || (res.company as any).expoUrl || null,
    webPreviewReady: existsSync(join(mobileDistDir(companyId), "index.html")),
    building: activeJob.length > 0,
    hasMobileFiles,
  });
});

// POST /companies/:id/mobile/start → relance le tunnel Expo (QR code) et,
// si besoin, re-matérialise le projet depuis la DB (préfixe mobile/) + re-export.
builder.post("/companies/:id/mobile/start", async (c) => {
  const res = await ownedCompany(c);
  if ("error" in res) return c.json({ error: res.error }, res.status);
  const companyId = res.company.id;
  try {
    const {
      getRunningMobile, mobileDir, mobileDistDir,
      writeMobileFilesToDisk, installMobileDeps, exportMobileWeb, startExpoTunnel,
    } = await import("./runner-mobile");
    const { existsSync } = await import("node:fs");
    const { join } = await import("node:path");

    // Re-matérialiser depuis la DB si le dossier /tmp a disparu (restart sandbox).
    if (!existsSync(join(mobileDir(companyId), "package.json"))) {
      const rows = await db.select().from(schema.projectFiles)
        .where(eq(schema.projectFiles.companyId, companyId)).all();
      const mobileFiles = rows
        .filter((r) => r.filePath.startsWith("mobile/"))
        .map((r) => ({ path: r.filePath.slice("mobile/".length), content: r.content }));
      if (!mobileFiles.length) {
        // Conversion interrompue : le projet est marqué web+mobile mais l'app
        // mobile n'a jamais été sauvegardée. On la RECONSTRUIT tout seul en
        // tâche de fond au lieu de renvoyer une erreur.
        const { getMobileRebuilder } = await import("./runner-mobile");
        const rebuild = getMobileRebuilder();
        if (rebuild) {
          await rebuild(companyId);
          return c.json({ ok: true, rebuilding: true });
        }
        return c.json({ error: "no_mobile_files" }, 400);
      }
      const dir = await writeMobileFilesToDisk(companyId, mobileFiles as ScaffoldFile[]);
      await installMobileDeps(dir);
    }
    if (!existsSync(join(mobileDistDir(companyId), "index.html"))) {
      await exportMobileWeb(companyId).catch(() => ({ ok: false }));
    }
    const running = getRunningMobile(companyId) || await startExpoTunnel(companyId);
    await db.update(schema.companies).set({ expoUrl: running.expoUrl, updatedAt: new Date() } as any)
      .where(eq(schema.companies.id, companyId)).catch(() => {});
    return c.json({
      ok: true,
      expoUrl: running.expoUrl,
      webPreviewReady: existsSync(join(mobileDistDir(companyId), "index.html")),
    });
  } catch (e: any) {
    return c.json({ error: String(e?.message || e) }, 500);
  }
});

// GET /companies/:id/mobile-preview/* → static serving de dist/ (public : cette
// route est chargée dans une <iframe>, comme le proxy /preview/ web).
builder.get("/companies/:id/mobile-preview/*", async (c) => {
  const companyId = c.req.param("id");
  const { readMobileDistFile } = await import("./runner-mobile");
  const marker = `/companies/${companyId}/mobile-preview`;
  const idx = c.req.path.indexOf(marker);
  const urlPath = idx >= 0 ? c.req.path.slice(idx + marker.length) : "/";
  const file = await readMobileDistFile(companyId, urlPath || "/");
  if (!file) return c.text("Preview mobile indisponible. Construis l'app d'abord.", 503);
  return new Response(file.body, { headers: { "Content-Type": file.mime, "Cache-Control": "no-cache" } });
});
// Sans wildcard (racine exacte) : /mobile-preview et /mobile-preview/
builder.get("/companies/:id/mobile-preview", async (c) => {
  const companyId = c.req.param("id");
  const { readMobileDistFile } = await import("./runner-mobile");
  const file = await readMobileDistFile(companyId, "/");
  if (!file) return c.text("Preview mobile indisponible. Construis l'app d'abord.", 503);
  return new Response(file.body, { headers: { "Content-Type": file.mime, "Cache-Control": "no-cache" } });
});

// ─── GET /companies/:id/preview-shot → capture de l'aperçu (1er écran) ───────
// [2026-09-13] Le mini-rectangle d'aperçu du chat montre ce qu'on voit en
// ARRIVANT sur le site : un viewport desktop, pas la page déroulée
// (voir preview-shot.ts). Publique comme le proxy /preview/* : chargée dans <img>.
builder.get("/companies/:id/preview-shot", async (c) => {
  const companyId = c.req.param("id");

  // `ensureRunningApp` renvoie `RunningApp | null` : le type doit accepter
  // null, sinon la réaffectation ci-dessous ne compile pas.
  let runningApp: RunningApp | null | undefined = getRunningApp(companyId);
  if (!runningApp) {
    runningApp = await ensureRunningApp(companyId, {
      getFiles: async () => {
        const rows = await db
          .select()
          .from(schema.projectFiles)
          .where(eq(schema.projectFiles.companyId, companyId));
        return rows.map((r) => ({ path: r.filePath, content: r.content }));
      },
    });
  }
  if (!runningApp) return c.text("Preview not running. Build the app first.", 503);

  try {
    const { getPreviewShot } = await import("./preview-shot");
    // Le serveur Vite enfant sert le site sous la même base que le proxy public.
    const url = `${runningApp.url}/api/companies/${companyId}/preview/`;
    const buf = await getPreviewShot(companyId, url);
    return new Response(new Uint8Array(buf), {
      headers: {
        "Content-Type": "image/jpeg",
        // Le client casse le cache avec ?t= ; la mise en cache réelle est faite
        // côté serveur, par révision de l'aperçu.
        "Cache-Control": "no-store",
      },
    });
  } catch (e: any) {
    return c.text(`Preview shot failed: ${String(e?.message || e)}`, 503);
  }
});

export default builder;
