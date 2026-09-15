import { client } from "./client";

// ─── Runtime idempotent table creation ───────────────────────────────────────
// Nouvelles tables ajoutées sans passer par `db:push` : on les crée au démarrage
// avec CREATE TABLE IF NOT EXISTS pour que la feature marche immédiatement.
let _ensured: Promise<void> | null = null;
export function ensureRuntimeTables(): Promise<void> {
  if (_ensured) return _ensured;
  _ensured = (async () => {
    try {
      await client.execute(`
        CREATE TABLE IF NOT EXISTS dynamic_specialists (
          id TEXT PRIMARY KEY,
          company_id TEXT NOT NULL,
          slug TEXT NOT NULL,
          label TEXT NOT NULL,
          label_en TEXT,
          descr TEXT,
          emoji TEXT,
          color TEXT,
          domain TEXT,
          brief TEXT,
          system_prompt TEXT NOT NULL,
          keywords TEXT,
          use_count INTEGER DEFAULT 0,
          created_at INTEGER DEFAULT (unixepoch())
        )`);
      await client.execute(`CREATE INDEX IF NOT EXISTS dyn_spec_company_idx ON dynamic_specialists (company_id)`);
      await client.execute(`CREATE UNIQUE INDEX IF NOT EXISTS dyn_spec_company_slug_idx ON dynamic_specialists (company_id, slug)`);
      // Jetons de réinitialisation de mot de passe (mot de passe oublié)
      await client.execute(`
        CREATE TABLE IF NOT EXISTS password_reset_tokens (
          id TEXT PRIMARY KEY,
          user_id TEXT NOT NULL,
          expires_at INTEGER NOT NULL,
          used_at INTEGER,
          created_at INTEGER DEFAULT (unixepoch())
        )`);
      await client.execute(`CREATE INDEX IF NOT EXISTS prt_user_idx ON password_reset_tokens (user_id)`);
      // Collaborateurs de projet (invitation d'un ami à co-éditer un projet)
      await client.execute(`
        CREATE TABLE IF NOT EXISTS project_collaborators (
          id TEXT PRIMARY KEY,
          company_id TEXT NOT NULL,
          email TEXT NOT NULL,
          user_id TEXT,
          role TEXT NOT NULL DEFAULT 'editor',
          status TEXT NOT NULL DEFAULT 'pending',
          invite_token TEXT NOT NULL,
          invited_by_user_id TEXT NOT NULL,
          created_at INTEGER DEFAULT (unixepoch()),
          accepted_at INTEGER
        )`);
      await client.execute(`CREATE INDEX IF NOT EXISTS pc_company_idx ON project_collaborators (company_id)`);
      await client.execute(`CREATE INDEX IF NOT EXISTS pc_user_idx ON project_collaborators (user_id)`);
      await client.execute(`CREATE UNIQUE INDEX IF NOT EXISTS pc_token_idx ON project_collaborators (invite_token)`);
      await client.execute(`CREATE UNIQUE INDEX IF NOT EXISTS pc_company_email_idx ON project_collaborators (company_id, email)`);
      // "Made with Velbaz" badge — colonne ajoutée sans db:push. Défaut 0 (badge visible).
      // Ne peut être mis à 1 que si le propriétaire a un plan payant ; sinon le
      // badge réapparaît (contrôle live au moment de servir la page).
      await client.execute(`ALTER TABLE companies ADD COLUMN badge_hidden INTEGER DEFAULT 0`)
        .catch(() => {}); // colonne déjà présente → ignore
      // ── Publication du site ("Publish your website") — colonnes ajoutées sans db:push ──
      await client.execute(`ALTER TABLE companies ADD COLUMN subdomain TEXT`).catch(() => {});
      await client.execute(`ALTER TABLE companies ADD COLUMN published INTEGER DEFAULT 0`).catch(() => {});
      await client.execute(`ALTER TABLE companies ADD COLUMN published_at INTEGER`).catch(() => {});
      await client.execute(`ALTER TABLE companies ADD COLUMN availability_mode TEXT DEFAULT 'wake'`).catch(() => {});
      await client.execute(`ALTER TABLE companies ADD COLUMN visibility TEXT DEFAULT 'public'`).catch(() => {});
      await client.execute(`ALTER TABLE companies ADD COLUMN custom_domain TEXT`).catch(() => {});
      // Facturation de l'hébergement (Availability) : dernier débit + mode facturé.
      await client.execute(`ALTER TABLE companies ADD COLUMN hosting_billed_at INTEGER`).catch(() => {});
      await client.execute(`ALTER TABLE companies ADD COLUMN hosting_billed_mode TEXT`).catch(() => {});
      await client.execute(`CREATE UNIQUE INDEX IF NOT EXISTS companies_subdomain_idx ON companies (subdomain)`).catch(() => {});
      // ── Stripe Connect : colonnes vendeur sur users (ajout sans db:push) ──
      await client.execute(`ALTER TABLE users ADD COLUMN stripe_account_id TEXT`).catch(() => {});
      await client.execute(`ALTER TABLE users ADD COLUMN stripe_onboarding_completed INTEGER DEFAULT 0`).catch(() => {});
      await client.execute(`ALTER TABLE users ADD COLUMN stripe_payouts_enabled INTEGER DEFAULT 0`).catch(() => {});
      // ── Fin d'abonnement (null = sans date de fin) ──
      await client.execute(`ALTER TABLE users ADD COLUMN plan_expires_at INTEGER`).catch(() => {});
      // ── Table des paiements Stripe Connect (marketplace) ──
      await client.execute(`
        CREATE TABLE IF NOT EXISTS stripe_connect_orders (
          id TEXT PRIMARY KEY,
          buyer_user_id TEXT,
          seller_user_id TEXT,
          seller_account_id TEXT NOT NULL,
          product_id TEXT,
          amount INTEGER NOT NULL,
          currency TEXT NOT NULL DEFAULT 'eur',
          application_fee_amount INTEGER NOT NULL DEFAULT 0,
          stripe_session_id TEXT,
          stripe_payment_intent_id TEXT,
          status TEXT NOT NULL DEFAULT 'pending',
          metadata TEXT,
          created_at INTEGER DEFAULT (unixepoch()),
          updated_at INTEGER DEFAULT (unixepoch())
        )`);
      await client.execute(`CREATE UNIQUE INDEX IF NOT EXISTS sco_session_idx ON stripe_connect_orders (stripe_session_id)`);
      await client.execute(`CREATE INDEX IF NOT EXISTS sco_seller_idx ON stripe_connect_orders (seller_user_id)`);
      await client.execute(`CREATE INDEX IF NOT EXISTS sco_buyer_idx ON stripe_connect_orders (buyer_user_id)`);
      // ── ENTRAÎNEMENT COMMUNICATION / PUB / MARKETING ────────────────────
      // `comms_training_examples` : chaque test lancé depuis la console admin
      // (message étudié → réponse produite), plus la note 1-10 et la correction
      // écrite par l'admin. C'est la mémoire brute de l'entraînement.
      await client.execute(`
        CREATE TABLE IF NOT EXISTS comms_training_examples (
          id TEXT PRIMARY KEY,
          company_id TEXT,
          task TEXT NOT NULL,
          input TEXT NOT NULL,
          context TEXT,
          lang TEXT,
          study TEXT,
          output TEXT,
          variants TEXT,
          self_score REAL,
          score REAL,
          correction TEXT,
          model TEXT,
          duration_ms INTEGER,
          created_by TEXT,
          created_at INTEGER DEFAULT (unixepoch()),
          rated_at INTEGER
        )`);
      await client.execute(`CREATE INDEX IF NOT EXISTS cte_task_idx ON comms_training_examples (task)`);
      await client.execute(`CREATE INDEX IF NOT EXISTS cte_company_idx ON comms_training_examples (company_id)`);
      await client.execute(`CREATE INDEX IF NOT EXISTS cte_score_idx ON comms_training_examples (score)`);
      await client.execute(`CREATE INDEX IF NOT EXISTS cte_created_idx ON comms_training_examples (created_at)`);
      // `comms_playbook` : les LEÇONS distillées à partir des notes/corrections.
      // C'est ce que l'IA relit avant chaque réponse en production — le vrai
      // support de « l'entraînement » (pas de fine-tuning, mais un savoir qui
      // s'accumule et pèse sur chaque génération).
      await client.execute(`
        CREATE TABLE IF NOT EXISTS comms_playbook (
          id TEXT PRIMARY KEY,
          company_id TEXT,
          task TEXT NOT NULL,
          rule TEXT NOT NULL,
          kind TEXT NOT NULL DEFAULT 'do',
          weight REAL NOT NULL DEFAULT 1,
          hits INTEGER NOT NULL DEFAULT 0,
          source_example_id TEXT,
          active INTEGER NOT NULL DEFAULT 1,
          created_at INTEGER DEFAULT (unixepoch()),
          updated_at INTEGER DEFAULT (unixepoch())
        )`);
      await client.execute(`CREATE INDEX IF NOT EXISTS cpb_task_idx ON comms_playbook (task)`);
      await client.execute(`CREATE INDEX IF NOT EXISTS cpb_company_idx ON comms_playbook (company_id)`);
      await client.execute(`CREATE INDEX IF NOT EXISTS cpb_active_idx ON comms_playbook (active)`);
    } catch (e: any) {
      console.error("[db] ensureRuntimeTables failed:", e?.message);
    }
  })();
  return _ensured;
}
// Lance la création au chargement du module (non bloquant).
ensureRuntimeTables();
