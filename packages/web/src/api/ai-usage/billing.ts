// ─── Débit réel des crédits sur le coût IA constaté ─────────────────────────
//
// Règle de facturation : 1 $ de coût IA réellement consommé = 3000 crédits
// débités du solde de l'utilisateur (CREDITS_PER_USD dans pricing.ts).
// Le coût n'est connu qu'APRÈS l'appel : le débit est donc post-payé, branché
// sur le flush de l'enregistreur (recorder.ts), qui voit passer 100 % des
// appels IA du gateway (texte, stream, images).
//
// Les call sites (index.ts) ne font plus qu'une GARDE a priori : ils vérifient
// que le solde couvre une estimation de l'action, sans rien débiter.
//
// Règle absolue héritée du recorder : ceci ne doit JAMAIS ralentir ni casser un
// appel IA. Aucune fonction d'ici ne throw.

import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { db } from "../database/index";
import { users, tokenTransactions } from "../database/schema";

export interface UsageCharge {
  userId: string;
  /** Crédits réels (fractionnaires) à débiter. */
  credits: number;
  /** Fonctionnalité dominante du lot, pour la ligne de transaction. */
  feature?: string | null;
  /** Coût USD cumulé du lot, pour la note. */
  costUsd?: number;
}

// Les crédits réels sont fractionnaires (2 décimales) alors que le solde et les
// transactions sont des entiers. On garde le reste en mémoire par utilisateur
// pour ne rien perdre ni surfacturer sur la durée.
// Persisté sur globalThis : survit au re-eval SSR de Vite.
const carry: Map<string, number> = ((globalThis as any).__velbaz_credit_carry ??= new Map<string, number>());

/**
 * Débite un utilisateur du coût IA réel. Le solde ne descend jamais sous 0.
 * Ne throw jamais.
 */
export async function chargeRealUsage(charge: UsageCharge): Promise<void> {
  try {
    const { userId } = charge;
    if (!userId) return;
    const raw = Number(charge.credits);
    if (!Number.isFinite(raw) || raw <= 0) return;

    const pending = (carry.get(userId) ?? 0) + raw;
    const whole = Math.floor(pending);
    carry.set(userId, Number((pending - whole).toFixed(4)));
    if (whole <= 0) return;

    const user = await db.select().from(users).where(eq(users.id, userId)).get();
    if (!user) return;
    const newBalance = Math.max(0, user.tokens - whole);
    const applied = user.tokens - newBalance;
    if (applied <= 0) return;

    await db.update(users).set({ tokens: newBalance }).where(eq(users.id, userId));
    await db.insert(tokenTransactions).values({
      id: randomUUID(),
      userId,
      amount: -applied,
      type: "usage",
      action: charge.feature ? `ai:${charge.feature}` : "ai",
      balance: newBalance,
      note:
        charge.costUsd != null
          ? `Coût IA réel ${charge.costUsd.toFixed(6)} $ → ${raw.toFixed(2)} crédits`
          : null,
    });
  } catch (e) {
    console.warn("[ai-billing] débit KO :", (e as Error).message);
  }
}

/**
 * Regroupe un lot d'évènements par utilisateur et débite chacun une seule fois.
 * Ne throw jamais.
 */
export async function chargeBatch(
  rows: Array<{ userId?: string | null; credits?: number | null; costUsd?: number | null; feature?: string | null }>,
): Promise<void> {
  try {
    const per = new Map<string, { credits: number; costUsd: number; features: Map<string, number> }>();
    for (const r of rows) {
      const uid = r.userId;
      if (!uid) continue;
      const credits = Number(r.credits ?? 0);
      if (!Number.isFinite(credits) || credits <= 0) continue;
      const acc = per.get(uid) ?? { credits: 0, costUsd: 0, features: new Map<string, number>() };
      acc.credits += credits;
      acc.costUsd += Number(r.costUsd ?? 0) || 0;
      const f = r.feature || "unknown";
      acc.features.set(f, (acc.features.get(f) ?? 0) + credits);
      per.set(uid, acc);
    }
    for (const [userId, acc] of per) {
      let top = "unknown";
      let best = -1;
      for (const [f, v] of acc.features) if (v > best) { best = v; top = f; }
      await chargeRealUsage({ userId, credits: acc.credits, costUsd: acc.costUsd, feature: top });
    }
  } catch (e) {
    console.warn("[ai-billing] lot KO :", (e as Error).message);
  }
}
