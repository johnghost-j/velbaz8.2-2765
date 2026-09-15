// ─── Legal compliance pack for generated sites & apps ───────────────────────
// A DEDICATED legal AI runs FIRST (before page planning), adapts the legal
// documents to the project's COUNTRY / jurisdiction (RGPD/GDPR for the EU,
// CCPA/CPRA for California, LGPD for Brazil, PIPEDA for Canada, etc. — works for
// ANY country, the AI figures it out) and produces a full pack:
//   • Privacy Policy   • Terms of Service   • Legal Notice / Impressum
//   • Cookie Policy     • a cookie-consent banner
// The result is written into the generated app as `src/lib/legal-content.ts`
// (a plain JSON-ish data file, covered by the checkpoint/rollback/fork snapshot
// machinery). Static page components + the CookieBanner read from it.
import { generateText } from "ai";
import { gateway } from "../agent/gateway";

export interface LegalDoc {
  title: string;
  intro?: string;
  sections: Array<{ heading: string; body: string }>;
}

export interface CookieBannerCopy {
  message: string;   // main consent sentence
  accept: string;    // "Accept all"
  reject: string;    // "Reject non-essential"
  settings: string;  // "Manage / Preferences"
  learnMore: string; // link label → /cookies
  savedNote?: string; // small note after choosing
}

export interface LegalPack {
  country: string;          // resolved country / jurisdiction label
  frameworks: string[];     // e.g. ["RGPD/GDPR", "ePrivacy"]
  lastUpdated: string;      // ISO date
  privacy: LegalDoc;
  terms: LegalDoc;
  legalNotice: LegalDoc;
  cookies: LegalDoc;
  cookieBanner: CookieBannerCopy;
}

export interface PlanLegalInput {
  companyName: string;
  idea: string;
  industry?: string;
  country?: string;   // may be an ISO code, a country name, or empty (AI infers)
  lang: string;       // app language for the produced texts
}

function extractJSON(raw: string): any {
  let s = raw.trim();
  if (s.startsWith("```")) s = s.replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/, "");
  const start = s.indexOf("{");
  const end = s.lastIndexOf("}");
  if (start !== -1 && end !== -1) s = s.slice(start, end + 1);
  return JSON.parse(s);
}

const LEGAL_SYSTEM =
  "Tu es le Juriste de Velbaz — un expert en droit du numérique et en conformité internationale " +
  "(RGPD/GDPR UE, ePrivacy, CCPA/CPRA Californie, LGPD Brésil, PIPEDA Canada, UK-GDPR, APPI Japon, POPIA Afrique du Sud, " +
  "et le droit local de TOUT autre pays). Tu rédiges des documents juridiques clairs, complets et adaptés au PAYS indiqué. " +
  "Tu n'es pas avocat : tu produis des documents standards de bonne pratique, à faire relire par un professionnel. " +
  "Tu réponds UNIQUEMENT en JSON valide.";

// Build the AI prompt asking for a full, country-adapted legal pack.
function legalPrompt(input: PlanLegalInput): string {
  const langName = input.lang === "en" ? "anglais" : input.lang === "fr" ? "français" : input.lang;
  return `Entreprise: "${input.companyName}"
Idée / activité: ${input.idea?.slice(0, 1200) || "non précisé"}
Secteur: ${input.industry || "non précisé"}
Pays / juridiction visé: ${input.country?.trim() || "NON PRÉCISÉ — déduis le pays le plus probable de l'activité et précise-le"}
Langue de rédaction des documents: ${langName}

Produis un PACK JURIDIQUE COMPLET, rédigé DANS LA LANGUE ci-dessus, ADAPTÉ AU DROIT DU PAYS visé.
- Identifie les cadres applicables (ex: RGPD + ePrivacy pour l'UE, CCPA/CPRA pour la Californie/USA, LGPD pour le Brésil, PIPEDA pour le Canada, UK-GDPR pour le Royaume-Uni, etc.) et rédige en conséquence (bases légales, droits des utilisateurs, DPO/représentant, transferts hors zone, mentions obligatoires, etc.).
- Textes concrets, professionnels, prêts à publier — PAS de "[à compléter]" ni de crochets vides. Utilise le nom de l'entreprise. Reste générique là où une donnée précise manque (adresse, SIREN…) en le formulant proprement.
- 5 à 8 sections par document, chaque "body" = 2 à 5 phrases utiles.

Réponds en JSON STRICT (aucun texte hors JSON):
{
  "country": "Pays/juridiction retenu (ex: France, Union européenne, California (USA), Brésil…)",
  "frameworks": ["RGPD/GDPR", "ePrivacy"],
  "privacy":   {"title":"…","intro":"…","sections":[{"heading":"…","body":"…"}]},
  "terms":     {"title":"…","intro":"…","sections":[{"heading":"…","body":"…"}]},
  "legalNotice":{"title":"…","intro":"…","sections":[{"heading":"…","body":"…"}]},
  "cookies":   {"title":"…","intro":"…","sections":[{"heading":"…","body":"…"}]},
  "cookieBanner": {"message":"…","accept":"…","reject":"…","settings":"…","learnMore":"…","savedNote":"…"}
}`;
}

function coerceDoc(v: any, fallback: LegalDoc): LegalDoc {
  if (!v || typeof v !== "object") return fallback;
  const sections = Array.isArray(v.sections)
    ? v.sections
        .map((s: any) => ({ heading: String(s?.heading || "").trim(), body: String(s?.body || "").trim() }))
        .filter((s: any) => s.heading && s.body)
    : [];
  if (!sections.length) return fallback;
  return {
    title: String(v.title || fallback.title).trim(),
    intro: v.intro ? String(v.intro).trim() : fallback.intro,
    sections,
  };
}

// The dedicated legal AI. NEVER throws — on failure returns a solid generic
// (RGPD-flavoured) fallback pack so the build always ships legal pages.
export async function planLegalPack(
  input: PlanLegalInput,
  onProgress?: (msg: string) => void,
): Promise<LegalPack> {
  const fallback = defaultLegalPack(input);
  // [2026-09-05] Libellé de l'étape telle qu'elle s'affiche dans la liste de
  // tâches. Elle est posée ICI, à sa place RÉELLE : au tout début du codage,
  // avant la planification des pages — jamais pendant la génération des images
  // (elle n'y tourne pas, l'afficher là serait une fausse étape).
  onProgress?.(`⚖️ Vérification juridique — analyse de la conformité (${input.country?.trim() || "pays à déterminer"})…`);
  try {
    const { text } = await generateText({
      model: gateway("openai/gpt-5.4-mini"),
      system: LEGAL_SYSTEM,
      prompt: legalPrompt(input),
      maxOutputTokens: 8000,
    });
    const obj = extractJSON(text);
    const pack: LegalPack = {
      country: String(obj?.country || input.country || fallback.country).trim(),
      frameworks: Array.isArray(obj?.frameworks) && obj.frameworks.length
        ? obj.frameworks.map((f: any) => String(f)).slice(0, 8)
        : fallback.frameworks,
      lastUpdated: new Date().toISOString().slice(0, 10),
      privacy: coerceDoc(obj?.privacy, fallback.privacy),
      terms: coerceDoc(obj?.terms, fallback.terms),
      legalNotice: coerceDoc(obj?.legalNotice, fallback.legalNotice),
      cookies: coerceDoc(obj?.cookies, fallback.cookies),
      cookieBanner: {
        message: String(obj?.cookieBanner?.message || fallback.cookieBanner.message),
        accept: String(obj?.cookieBanner?.accept || fallback.cookieBanner.accept),
        reject: String(obj?.cookieBanner?.reject || fallback.cookieBanner.reject),
        settings: String(obj?.cookieBanner?.settings || fallback.cookieBanner.settings),
        learnMore: String(obj?.cookieBanner?.learnMore || fallback.cookieBanner.learnMore),
        savedNote: obj?.cookieBanner?.savedNote ? String(obj.cookieBanner.savedNote) : fallback.cookieBanner.savedNote,
      },
    };
    onProgress?.(`✅ Vérification juridique terminée — ${pack.country} (${pack.frameworks.join(", ")})`);
    return pack;
  } catch (e) {
    console.error("[planLegalPack] failed, using fallback:", e);
    onProgress?.("ℹ️ Vérification juridique — modèle standard appliqué (le modèle dédié n'a pas répondu)");
    return fallback;
  }
}

// Generic, sane default (used on AI failure). Language-aware FR/EN.
export function defaultLegalPack(input: PlanLegalInput): LegalPack {
  const fr = (input.lang || "fr") !== "en";
  const co = input.companyName;
  const country = input.country?.trim() || (fr ? "Union européenne" : "European Union");
  const D = (title: string, intro: string, sections: Array<[string, string]>): LegalDoc => ({
    title, intro, sections: sections.map(([heading, body]) => ({ heading, body })),
  });
  if (fr) {
    return {
      country,
      frameworks: ["RGPD/GDPR", "ePrivacy"],
      lastUpdated: new Date().toISOString().slice(0, 10),
      privacy: D("Politique de confidentialité",
        `La présente politique explique comment ${co} collecte, utilise et protège vos données personnelles, conformément au RGPD.`,
        [
          ["1. Données collectées", `Nous collectons les informations que vous fournissez (nom, e-mail) et les données d'usage nécessaires au fonctionnement du service.`],
          ["2. Bases légales", `Le traitement repose sur votre consentement, l'exécution du contrat, notre intérêt légitime ou une obligation légale, selon le cas.`],
          ["3. Utilisation", `Vos données servent à fournir et améliorer ${co}, assurer la sécurité et communiquer avec vous.`],
          ["4. Partage", `Nous ne vendons pas vos données. Elles peuvent être confiées à des sous-traitants (hébergement, paiement) strictement pour fournir le service.`],
          ["5. Conservation", `Les données sont conservées le temps nécessaire aux finalités décrites, puis supprimées ou anonymisées.`],
          ["6. Vos droits", `Vous disposez des droits d'accès, de rectification, d'effacement, d'opposition et de portabilité. Contactez-nous pour les exercer.`],
          ["7. Transferts", `Tout transfert hors de l'Espace économique européen est encadré par des garanties appropriées (clauses contractuelles types).`],
          ["8. Contact", `Pour toute question relative à vos données, contactez-nous via la page support.`],
        ]),
      terms: D("Conditions d'utilisation",
        `Les présentes conditions régissent l'accès et l'utilisation de ${co}.`,
        [
          ["1. Acceptation", `En utilisant ${co}, vous acceptez ces conditions. À défaut, n'utilisez pas le service.`],
          ["2. Utilisation du service", `Vous vous engagez à un usage licite et à ne pas détourner le service à des fins frauduleuses ou nuisibles.`],
          ["3. Comptes", `Vous êtes responsable de la confidentialité de vos identifiants et des activités sur votre compte.`],
          ["4. Paiements", `Les offres payantes sont facturées à l'avance ; l'accès reste actif jusqu'à la fin de la période payée.`],
          ["5. Propriété intellectuelle", `Les contenus et marques de ${co} restent notre propriété ou celle de nos partenaires.`],
          ["6. Responsabilité", `Le service est fourni « en l'état ». Dans les limites de la loi, nous déclinons toute responsabilité pour les dommages indirects.`],
          ["7. Résiliation", `Nous pouvons suspendre un compte en cas de violation des présentes conditions.`],
          ["8. Droit applicable", `Ces conditions sont régies par le droit applicable dans la juridiction de ${co}.`],
        ]),
      legalNotice: D("Mentions légales",
        `Informations légales relatives à l'éditeur du site ${co}.`,
        [
          ["Éditeur", `Le site ${co} est édité par ${co}. Les coordonnées complètes (raison sociale, adresse, immatriculation) sont disponibles sur demande.`],
          ["Directeur de la publication", `Le représentant légal de ${co}.`],
          ["Hébergement", `Le site est hébergé par un prestataire d'hébergement professionnel.`],
          ["Contact", `Pour toute question, utilisez la page support du site.`],
          ["Propriété intellectuelle", `L'ensemble des éléments du site est protégé. Toute reproduction sans autorisation est interdite.`],
        ]),
      cookies: D("Politique de cookies",
        `Cette politique décrit l'usage des cookies sur ${co}.`,
        [
          ["1. Qu'est-ce qu'un cookie ?", `Un cookie est un petit fichier déposé sur votre appareil pour faire fonctionner le site et mesurer son audience.`],
          ["2. Cookies essentiels", `Nécessaires au fonctionnement (session, sécurité) — ils ne requièrent pas de consentement.`],
          ["3. Cookies de mesure / marketing", `Déposés uniquement avec votre consentement, ils nous aident à améliorer le service.`],
          ["4. Gestion du consentement", `Vous pouvez accepter, refuser ou modifier vos choix à tout moment via la bannière de cookies.`],
          ["5. Durée", `Les cookies ont une durée de vie limitée, conformément à la réglementation.`],
        ]),
      cookieBanner: {
        message: `Nous utilisons des cookies pour faire fonctionner le site et, avec votre accord, en mesurer l'audience.`,
        accept: "Tout accepter",
        reject: "Refuser",
        settings: "Personnaliser",
        learnMore: "En savoir plus",
        savedNote: "Vos préférences ont été enregistrées.",
      },
    };
  }
  return {
    country,
    frameworks: ["GDPR", "ePrivacy"],
    lastUpdated: new Date().toISOString().slice(0, 10),
    privacy: D("Privacy Policy",
      `This policy explains how ${co} collects, uses and protects your personal data.`,
      [
        ["1. Data we collect", `We collect the information you provide (name, email) and usage data required to run the service.`],
        ["2. Legal bases", `Processing relies on your consent, contract performance, our legitimate interest or a legal obligation, as applicable.`],
        ["3. How we use data", `Your data is used to provide and improve ${co}, ensure security and communicate with you.`],
        ["4. Sharing", `We do not sell your data. It may be shared with processors (hosting, payments) strictly to deliver the service.`],
        ["5. Retention", `Data is kept only as long as necessary for the stated purposes, then deleted or anonymized.`],
        ["6. Your rights", `You have rights of access, rectification, erasure, objection and portability. Contact us to exercise them.`],
        ["7. Transfers", `Any transfer outside your region is covered by appropriate safeguards.`],
        ["8. Contact", `For any question about your data, reach us via the support page.`],
      ]),
    terms: D("Terms of Service",
      `These terms govern access to and use of ${co}.`,
      [
        ["1. Acceptance", `By using ${co}, you agree to these terms. If you do not agree, do not use the service.`],
        ["2. Use of service", `You agree to lawful use and not to misuse the service for fraudulent or harmful purposes.`],
        ["3. Accounts", `You are responsible for keeping your credentials confidential and for activity on your account.`],
        ["4. Payments", `Paid plans are billed in advance; access remains active until the end of the paid period.`],
        ["5. Intellectual property", `${co}'s content and marks remain our property or that of our partners.`],
        ["6. Liability", `The service is provided "as is". To the extent permitted by law, we disclaim liability for indirect damages.`],
        ["7. Termination", `We may suspend an account that breaches these terms.`],
        ["8. Governing law", `These terms are governed by the law applicable in ${co}'s jurisdiction.`],
      ]),
    legalNotice: D("Legal Notice",
      `Legal information about the publisher of ${co}.`,
      [
        ["Publisher", `The ${co} website is published by ${co}. Full details (legal name, address, registration) are available on request.`],
        ["Managing director", `The legal representative of ${co}.`],
        ["Hosting", `The site is hosted by a professional hosting provider.`],
        ["Contact", `For any question, use the support page.`],
        ["Intellectual property", `All elements of the site are protected. Reproduction without permission is prohibited.`],
      ]),
    cookies: D("Cookie Policy",
      `This policy describes the use of cookies on ${co}.`,
      [
        ["1. What is a cookie?", `A cookie is a small file stored on your device to run the site and measure audience.`],
        ["2. Essential cookies", `Required for operation (session, security) — they do not require consent.`],
        ["3. Analytics / marketing cookies", `Set only with your consent, they help us improve the service.`],
        ["4. Managing consent", `You can accept, reject or change your choices anytime via the cookie banner.`],
        ["5. Duration", `Cookies have a limited lifetime, in line with regulations.`],
      ]),
    cookieBanner: {
      message: `We use cookies to run the site and, with your consent, to measure audience.`,
      accept: "Accept all",
      reject: "Reject",
      settings: "Customize",
      learnMore: "Learn more",
      savedNote: "Your preferences have been saved.",
    },
  };
}
