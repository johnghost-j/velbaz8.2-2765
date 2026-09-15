// ─── RGPD / GDPR: export & suppression de compte ─────────────────────────────
// Cascade de suppression réutilisée par l'admin ET le self-service utilisateur.
// Export = toutes les données personnelles au format JSON (droit à la portabilité).

import { db } from './database/index';
import { client } from './database/client';
import * as schema from './database/schema';
import { eq } from 'drizzle-orm';

// La cascade était écrite table par table : chaque nouvelle table liée à une
// company (autopilot_config, autopilot_logs, ...) cassait la suppression avec
// une violation de clé étrangère. On découvre donc les tables à vider
// directement dans le schéma SQLite : tout ce qui porte une colonne
// `company_id` / `user_id` est purgé, y compris les tables ajoutées plus tard.
const COMPANY_COLS = ['company_id', 'buyer_company_id'];
const USER_COLS = ['user_id'];

function ident(name: string): string {
  return `"${name.replace(/"/g, '""')}"`;
}

type Target = { table: string; col: string };

/** Toutes les tables réelles de la base, avec leurs colonnes. */
async function tableColumns(): Promise<Map<string, string[]>> {
  const map = new Map<string, string[]>();
  const tables = await client.execute(
    `select name from sqlite_master where type = 'table' and name not like 'sqlite_%'`,
  );
  for (const row of tables.rows) {
    const name = String((row as any).name);
    try {
      const cols = await client.execute(`pragma table_info(${ident(name)})`);
      map.set(name, cols.rows.map((r: any) => String(r.name)));
    } catch {
      // table illisible (vue système, table interne) → ignorée
    }
  }
  return map;
}

async function targetsFor(cols: string[]): Promise<Target[]> {
  const all = await tableColumns();
  const targets: Target[] = [];
  for (const [table, list] of all) {
    if (table === 'companies' || table === 'users') continue; // supprimées en dernier
    for (const col of cols) if (list.includes(col)) targets.push({ table, col });
  }
  return targets;
}

/**
 * Vide les tables cibles pour une valeur donnée. Certaines tables filles se
 * référencent entre elles (product_images → products) : on repasse tant que
 * des suppressions progressent, au lieu de dépendre d'un ordre codé en dur.
 */
async function deleteAll(targets: Target[], value: string): Promise<void> {
  let pending = targets;
  let lastError: unknown = null;
  while (pending.length) {
    const failed: Target[] = [];
    for (const t of pending) {
      try {
        await client.execute({ sql: `delete from ${ident(t.table)} where ${ident(t.col)} = ?`, args: [value] });
      } catch (e) {
        lastError = e;
        failed.push(t);
      }
    }
    if (failed.length === pending.length) throw lastError; // aucun progrès → vraie erreur
    pending = failed;
  }
}

/** Supprime toutes les données d'une company (réutilisé par delete user). */
export async function purgeCompanyData(companyId: string): Promise<void> {
  await deleteAll(await targetsFor(COMPANY_COLS), companyId);
}

/** Suppression complète d'un utilisateur et de toutes ses companies. */
export async function purgeUserData(userId: string): Promise<{ companiesDeleted: number }> {
  const userCompanies = await db.select().from(schema.companies).where(eq(schema.companies.userId, userId)).all();
  const companyTargets = await targetsFor(COMPANY_COLS);
  for (const comp of userCompanies) {
    await deleteAll(companyTargets, comp.id);
  }
  await deleteAll(await targetsFor(USER_COLS), userId);
  await db.delete(schema.companies).where(eq(schema.companies.userId, userId));
  await db.delete(schema.users).where(eq(schema.users.id, userId));
  return { companiesDeleted: userCompanies.length };
}

/** Export complet des données d'un utilisateur (portabilité RGPD). */
export async function exportUserData(userId: string): Promise<any> {
  const user = await db.select().from(schema.users).where(eq(schema.users.id, userId)).get();
  if (!user) return null;
  const { passwordHash, ...safeUser } = user as any; // on n'exporte JAMAIS le hash

  const companies = await db.select().from(schema.companies).where(eq(schema.companies.userId, userId)).all();
  const companyIds = companies.map((c) => c.id);

  const perCompany = await Promise.all(companyIds.map(async (cid) => ({
    company: companies.find((c) => c.id === cid),
    agents: await db.select().from(schema.agents).where(eq(schema.agents.companyId, cid)).all(),
    tasks: await db.select().from(schema.tasks).where(eq(schema.tasks.companyId, cid)).all(),
    documents: await db.select().from(schema.documents).where(eq(schema.documents.companyId, cid)).all(),
    emails: await db.select().from(schema.emails).where(eq(schema.emails.companyId, cid)).all(),
    emailsInbox: await db.select().from(schema.emailsInbox).where(eq(schema.emailsInbox.companyId, cid)).all(),
    websitePages: await db.select().from(schema.websitePages).where(eq(schema.websitePages.companyId, cid)).all(),
    products: await db.select().from(schema.products).where(eq(schema.products.companyId, cid)).all(),
  })));

  const tokenTransactions = await db.select().from(schema.tokenTransactions).where(eq(schema.tokenTransactions.userId, userId)).all();
  const notifications = await db.select().from(schema.notifications).where(eq(schema.notifications.userId, userId)).all();

  return {
    exportedAt: new Date().toISOString(),
    format: 'velbaz-gdpr-export-v1',
    user: safeUser,
    companies: perCompany,
    tokenTransactions,
    notifications,
  };
}
