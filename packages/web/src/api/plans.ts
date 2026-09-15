// ─── Plans & droits — SOURCE UNIQUE DE VÉRITÉ ────────────────────────────────
// Un abonnement doit être VRAI : ce fichier définit, pour chaque plan, les
// limites (nombre de projets, puissance IA) et les fonctionnalités réellement
// accessibles. Le serveur refuse tout ce qui n'est pas inclus dans le plan de
// l'utilisateur — le tableau comparatif de la page /plans n'est plus décoratif.
//
// Paiement : pour l'instant la souscription est appliquée directement
// (POST /plans/subscribe) sans passeur de paiement. Stripe sera branché
// ensuite : il suffira d'encadrer cet endpoint par un checkout et de garder la
// même mise à jour de `users.plan`.

export type PlanKey = 'free' | 'business' | 'enterprise';

export type PlanFeature =
  | 'mobileApp'        // construction d'apps Android / iOS
  | 'autopilot'        // l'équipe IA qui travaille toute seule
  | 'reports'          // documents & rapports générés
  | 'advancedModels'   // niveaux de modèle Pro / Max dans le chat
  | 'team'             // collaborateurs sur un projet
  | 'buyCredits'       // achat de crédits supplémentaires
  | 'removeBadge'      // retirer le badge « Made with Velbaz »
  | 'prioritySupport'
  | 'apiAccess'
  | 'integrations'
  | 'sso'
  | 'dedicatedSupport';

export type TierKey = 'lite' | 'pro' | 'max';

export interface PlanConfig {
  key: PlanKey;
  name: string;
  monthlyPrice: number;
  /** -1 = illimité */
  maxProjects: number;
  /** Crédits offerts à la souscription (0 = aucun) */
  monthlyCredits: number;
  /** Puissance IA maximale utilisable dans le chat */
  maxTier: TierKey;
  features: Record<PlanFeature, boolean>;
}

const F = false, T = true;

export const PLAN_ORDER: PlanKey[] = ['free', 'business', 'enterprise'];

export const PLAN_CONFIG: Record<PlanKey, PlanConfig> = {
  free: {
    key: 'free',
    name: 'Free',
    monthlyPrice: 0,
    maxProjects: 1,
    monthlyCredits: 0,
    maxTier: 'lite',
    features: {
      mobileApp: F, autopilot: F, reports: F, advancedModels: F, team: F,
      buyCredits: F, removeBadge: F, prioritySupport: F,
      apiAccess: F, integrations: F, sso: F, dedicatedSupport: F,
    },
  },
  business: {
    key: 'business',
    name: 'Business',
    monthlyPrice: 29,
    maxProjects: 10,
    monthlyCredits: 75_000,
    maxTier: 'max',
    features: {
      mobileApp: T, autopilot: T, reports: T, advancedModels: T, team: T,
      buyCredits: T, removeBadge: T, prioritySupport: T,
      apiAccess: F, integrations: F, sso: F, dedicatedSupport: F,
    },
  },
  enterprise: {
    key: 'enterprise',
    name: 'Enterprise',
    monthlyPrice: 99,
    maxProjects: -1,
    monthlyCredits: 500_000,
    maxTier: 'max',
    features: {
      mobileApp: T, autopilot: T, reports: T, advancedModels: T, team: T,
      buyCredits: T, removeBadge: T, prioritySupport: T,
      apiAccess: T, integrations: T, sso: T, dedicatedSupport: T,
    },
  },
};

/**
 * Ramène n'importe quelle valeur stockée en base à une clé de plan connue.
 * `pro` est l'ancien nom de `business` (endpoint admin historique) ; toute
 * valeur inconnue (`banned`, null, faute de frappe…) retombe sur `free` pour
 * les DROITS — la colonne `users.plan` n'est jamais réécrite ici.
 */
export function normalizePlan(plan?: string | null): PlanKey {
  const p = String(plan || 'free').trim().toLowerCase();
  if (p === 'business' || p === 'pro' || p === 'biz') return 'business';
  if (p === 'enterprise' || p === 'ent') return 'enterprise';
  return 'free';
}

export function planConfig(plan?: string | null): PlanConfig {
  return PLAN_CONFIG[normalizePlan(plan)];
}

export function can(plan: string | null | undefined, feature: PlanFeature): boolean {
  return planConfig(plan).features[feature];
}

/** Plan le moins cher qui débloque cette fonctionnalité. */
export function requiredPlanFor(feature: PlanFeature): PlanKey {
  for (const key of PLAN_ORDER) if (PLAN_CONFIG[key].features[feature]) return key;
  return 'enterprise';
}

const FEATURE_LABEL: Record<PlanFeature, string> = {
  mobileApp: 'La création d\'applications Android / iOS',
  autopilot: 'L\'Autopilot (l\'équipe IA qui travaille en autonomie)',
  reports: 'La génération de documents & rapports',
  advancedModels: 'Les niveaux d\'IA Pro et Max',
  team: 'Les collaborateurs sur un projet',
  buyCredits: 'L\'achat de crédits supplémentaires',
  removeBadge: 'Le retrait du badge « Made with Velbaz »',
  prioritySupport: 'Le support prioritaire',
  apiAccess: 'L\'accès API',
  integrations: 'Les intégrations personnalisées',
  sso: 'Le SSO',
  dedicatedSupport: 'Le support dédié',
};

/**
 * Message d'erreur prêt à renvoyer au client quand le plan ne couvre pas la
 * fonctionnalité. `null` = accès autorisé.
 */
export function featureGate(
  plan: string | null | undefined,
  feature: PlanFeature,
): { error: string; feature: PlanFeature; plan: PlanKey; upgradeTo: PlanKey } | null {
  if (can(plan, feature)) return null;
  const need = requiredPlanFor(feature);
  return {
    // Formulation neutre : évite tout accord de genre approximatif selon le
    // libellé de la fonctionnalité.
    error: `Fonctionnalité réservée au plan ${PLAN_CONFIG[need].name} : ${FEATURE_LABEL[feature]}. Passe au plan ${PLAN_CONFIG[need].name} pour y accéder.`,
    feature,
    plan: normalizePlan(plan),
    upgradeTo: need,
  };
}

/** Limite de projets du plan (-1 = illimité). */
export function maxProjects(plan?: string | null): number {
  return planConfig(plan).maxProjects;
}

export function projectLimitError(plan: string | null | undefined, current: number): { error: string; plan: PlanKey; upgradeTo: PlanKey; limit: number } | null {
  const cfg = planConfig(plan);
  if (cfg.maxProjects < 0 || current < cfg.maxProjects) return null;
  const next: PlanKey = cfg.key === 'free' ? 'business' : 'enterprise';
  return {
    error: `Limite du plan ${cfg.name} atteinte : ${cfg.maxProjects} projet${cfg.maxProjects > 1 ? 's' : ''}. Passe au plan ${PLAN_CONFIG[next].name} pour ${PLAN_CONFIG[next].maxProjects < 0 ? 'des projets illimités' : `${PLAN_CONFIG[next].maxProjects} projets`}.`,
    plan: cfg.key,
    upgradeTo: next,
    limit: cfg.maxProjects,
  };
}

// ─── Durée d'abonnement ──────────────────────────────────────────────────────
// Un abonnement offert depuis le panel admin, ou souscrit sur /plans, porte une
// date de fin (`users.plan_expires_at`). Passée cette date, le compte retombe
// automatiquement en Free — les droits sont calculés avec la date, la colonne
// `plan` est remise à jour au premier passage de l'utilisateur.

/** Durée par défaut d'un abonnement selon le cycle de facturation. */
export const DEFAULT_DURATION_DAYS = { monthly: 30, yearly: 365 } as const;

export function addDays(from: Date, days: number): Date {
  return new Date(from.getTime() + days * 86_400_000);
}

export function addMonths(from: Date, months: number): Date {
  const d = new Date(from.getTime());
  const day = d.getDate();
  d.setMonth(d.getMonth() + months);
  if (d.getDate() < day) d.setDate(0); // 31 janvier + 1 mois → 28/29 février
  return d;
}

/**
 * Interprète une durée saisie à la main : `30d`, `3m`, `2 mois`, `1y`, `1 an`,
 * une date `2026-12-31` / `31-12-2026` / `31/12/2026`, ou `forever` / `illimité`
 * / `permanent` / `never` pour un abonnement sans fin.
 * `{ ok: false }` = saisie incomprise (on ne devine pas, on prévient).
 */
export function parsePlanDuration(
  input: string | null | undefined,
  from: Date = new Date(),
): { ok: true; expiresAt: Date | null } | { ok: false; error: string } {
  const raw = String(input ?? '').trim().toLowerCase();
  if (!raw) return { ok: true, expiresAt: null };
  if (['forever', 'infini', 'illimite', 'illimité', 'permanent', 'never', 'jamais', 'lifetime', 'a vie', 'à vie'].includes(raw)) {
    return { ok: true, expiresAt: null };
  }

  // Date explicite : 2026-12-31 (ISO) ou 31/12/2026 / 31-12-2026 (FR)
  const iso = raw.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})$/);
  if (iso) {
    const d = new Date(Number(iso[1]), Number(iso[2]) - 1, Number(iso[3]), 23, 59, 59);
    if (isNaN(d.getTime())) return { ok: false, error: `Date invalide : ${input}` };
    return { ok: true, expiresAt: d };
  }
  const fr = raw.match(/^(\d{1,2})[-/](\d{1,2})[-/](\d{4})$/);
  if (fr) {
    const d = new Date(Number(fr[3]), Number(fr[2]) - 1, Number(fr[1]), 23, 59, 59);
    if (isNaN(d.getTime())) return { ok: false, error: `Date invalide : ${input}` };
    return { ok: true, expiresAt: d };
  }

  // Durée relative : 30d, 3m, 1y, "2 mois", "1 an", "45 jours"…
  const rel = raw.match(/^(\d+)\s*(d|j|jour|jours|day|days|w|s|semaine|semaines|week|weeks|m|mois|month|months|y|a|an|ans|annee|année|year|years)?$/);
  if (rel) {
    const n = Number(rel[1]);
    if (!n || n < 0) return { ok: false, error: `Durée invalide : ${input}` };
    const unit = rel[2] || 'd';
    if (/^(d|j|jour|jours|day|days)$/.test(unit)) return { ok: true, expiresAt: addDays(from, n) };
    if (/^(w|s|semaine|semaines|week|weeks)$/.test(unit)) return { ok: true, expiresAt: addDays(from, n * 7) };
    if (/^(m|mois|month|months)$/.test(unit)) return { ok: true, expiresAt: addMonths(from, n) };
    return { ok: true, expiresAt: addMonths(from, n * 12) };
  }

  return { ok: false, error: `Durée non comprise : « ${input} ». Exemples : 30d, 3m, 1y, 2026-12-31, forever.` };
}

/** L'abonnement est-il arrivé à échéance ? (pas de date = sans fin) */
export function isPlanExpired(expiresAt: Date | number | null | undefined, now: Date = new Date()): boolean {
  if (expiresAt === null || expiresAt === undefined) return false;
  const ms = expiresAt instanceof Date ? expiresAt.getTime() : Number(expiresAt) * (Number(expiresAt) < 1e12 ? 1000 : 1);
  if (!ms || isNaN(ms)) return false;
  return ms <= now.getTime();
}

/** Plan réellement actif : retombe sur `free` si l'abonnement a expiré. */
export function activePlan(plan: string | null | undefined, expiresAt: Date | number | null | undefined): PlanKey {
  const key = normalizePlan(plan);
  if (key === 'free') return key;
  return isPlanExpired(expiresAt) ? 'free' : key;
}

/** Date lisible en français : « 31 décembre 2026 ». */
export function formatPlanDate(expiresAt: Date | number | null | undefined): string {
  if (expiresAt === null || expiresAt === undefined) return 'sans date de fin';
  const ms = expiresAt instanceof Date ? expiresAt.getTime() : Number(expiresAt) * (Number(expiresAt) < 1e12 ? 1000 : 1);
  if (!ms || isNaN(ms)) return 'sans date de fin';
  return new Date(ms).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' });
}

const TIER_RANK: Record<TierKey, number> = { lite: 0, pro: 1, max: 2 };

/**
 * Plafonne la puissance IA demandée par le client selon le plan.
 * Un compte Free reste sur le niveau léger : réellement « moins fort ».
 */
export function capTier(tier: string | undefined | null, plan?: string | null): TierKey {
  const asked = (String(tier || '').toLowerCase() as TierKey);
  const wanted: TierKey = TIER_RANK[asked] === undefined ? 'lite' : asked;
  const ceiling = planConfig(plan).maxTier;
  return TIER_RANK[wanted] > TIER_RANK[ceiling] ? ceiling : wanted;
}
