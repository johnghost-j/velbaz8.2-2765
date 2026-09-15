// ─────────────────────────────────────────────────────────────
//  CONFIG MARQUE — un seul endroit à changer pour renommer l'app
//  Change BRAND (et éventuellement les autres) puis rebuild.
// ─────────────────────────────────────────────────────────────

/** Nom affiché de l'app (partout dans l'UI). */
export const BRAND = 'Velbaz';

/** Slug minuscule dérivé du nom (utilisé pour domaine/emails par défaut). */
const SLUG = BRAND.toLowerCase().replace(/[^a-z0-9]/g, '');

/** Entité légale (mentions légales, docs). */
export const LEGAL_ENTITY = `${BRAND}, Inc.`;

/** Domaine principal. */
export const WEBSITE = `${SLUG}.app`;

/** Emails de contact. */
export const CONTACT_EMAIL = `legal@${SLUG}.app`;
export const SUPPORT_EMAIL = `support@${SLUG}.app`;

/** Juridiction (loi applicable dans les docs légaux). */
export const JURISDICTION = 'the State of Delaware, United States';

/** Noms des paliers de modèles. */
export const TIER_MAX = `${BRAND} Max`;
export const TIER_PRO = `${BRAND} Pro`;
export const TIER_LITE = `${BRAND} Lite`;
