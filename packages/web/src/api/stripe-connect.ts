// ─── Stripe Connect (Express) — service dynamique + routes ───────────────────
//
// Spec métier (équivalent Express/PostgreSQL demandé, adapté à la stack réelle
// du projet : Hono + Drizzle sur libSQL/SQLite) :
//   1. La clé STRIPE_SECRET_KEY n'est JAMAIS hardcodée. Elle est saisie depuis
//      l'Admin Panel et stockée CHIFFRÉE (AES-256-GCM) via le secret-store.
//      getStripeClient() lit la clé au runtime et instancie le SDK à la volée.
//   2. Onboarding Connect Express : create-connect-account + account link.
//   3. Statut du compte : retrieve + mise à jour des drapeaux en base.
//   4. Checkout avec commission plateforme (application_fee_amount) + transfert
//      vers le compte Connect du vendeur (destination charge).
//   5. Webhook signé (account.updated, checkout.session.completed).
//
import Stripe from 'stripe';
import type { Hono } from 'hono';
import { db } from './database/index';
import * as schema from './database/schema';
import { eq } from 'drizzle-orm';
import { getSecret, setSecret } from './secret-store';

// ── Commission plateforme par défaut (%) si non précisée dans la requête ──
const DEFAULT_PLATFORM_FEE_PERCENT = 10;

// ─────────────────────────────────────────────────────────────────────────────
// Client Stripe instancié dynamiquement depuis la clé chiffrée en base.
// On mémorise l'instance ET la clé qui l'a produite : si l'admin change la clé
// dans le panel, la clé en cache change → on recrée l'instance automatiquement.
// ─────────────────────────────────────────────────────────────────────────────
let _cachedKey: string | null = null;
let _cachedClient: Stripe | null = null;

/**
 * Renvoie une instance Stripe initialisée avec la clé secrète courante.
 * @throws si aucune clé n'est configurée dans l'Admin Panel.
 */
export function getStripeClient(): Stripe {
  const key = getSecret('STRIPE_SECRET_KEY');
  if (!key || !key.trim()) {
    throw new Error('Clé API Stripe non configurée dans l\'Admin Panel');
  }
  if (_cachedClient && _cachedKey === key) return _cachedClient;
  _cachedClient = new Stripe(key, { apiVersion: '2025-03-31.basil' as any });
  _cachedKey = key;
  return _cachedClient;
}

/** True si une clé Stripe est configurée (sans lever d'erreur). */
export function isStripeConfigured(): boolean {
  const key = getSecret('STRIPE_SECRET_KEY');
  return !!(key && key.trim());
}

// ── Helper : origine publique de la requête (preview / prod / localhost) ─────
function originOf(c: any): string {
  // Respecte un éventuel proxy (X-Forwarded-*), sinon l'URL de la requête.
  const proto = c.req.header('x-forwarded-proto');
  const host = c.req.header('x-forwarded-host') || c.req.header('host');
  if (proto && host) return `${proto}://${host}`;
  const u = new URL(c.req.url);
  return u.origin;
}

// ─────────────────────────────────────────────────────────────────────────────
// Services (logique métier isolée, réutilisable, gestion d'erreurs async/await)
// ─────────────────────────────────────────────────────────────────────────────

/** Crée (ou renvoie l'existant) le compte Connect Express de l'utilisateur. */
export async function ensureConnectAccount(user: { id: string; email: string; stripeAccountId?: string | null }): Promise<string> {
  if (user.stripeAccountId) return user.stripeAccountId;
  const stripe = getStripeClient();
  const account = await stripe.accounts.create({
    type: 'express',
    country: 'FR',
    email: user.email || undefined,
    capabilities: {
      card_payments: { requested: true },
      transfers: { requested: true },
    },
    business_type: 'individual',
    metadata: { userId: user.id },
  });
  await db.update(schema.users)
    .set({ stripeAccountId: account.id })
    .where(eq(schema.users.id, user.id));
  return account.id;
}

/** Génère un lien d'onboarding hébergé par Stripe pour le compte donné. */
export async function createOnboardingLink(accountId: string, origin: string): Promise<string> {
  const stripe = getStripeClient();
  const link = await stripe.accountLinks.create({
    account: accountId,
    refresh_url: `${origin}/api/stripe/refresh`,
    return_url: `${origin}/api/stripe/return`,
    type: 'account_onboarding',
  });
  return link.url;
}

/** Interroge Stripe, met à jour les drapeaux en base, renvoie le statut. */
export async function syncAccountStatus(user: { id: string; stripeAccountId?: string | null }) {
  if (!user.stripeAccountId) {
    return { connected: false, onboardingCompleted: false, payoutsEnabled: false, detailsSubmitted: false };
  }
  const stripe = getStripeClient();
  const acct = await stripe.accounts.retrieve(user.stripeAccountId);
  const detailsSubmitted = !!acct.details_submitted;
  const payoutsEnabled = !!acct.payouts_enabled;
  await db.update(schema.users)
    .set({
      stripeOnboardingCompleted: detailsSubmitted,
      stripePayoutsEnabled: payoutsEnabled,
    })
    .where(eq(schema.users.id, user.id));
  return {
    connected: true,
    accountId: user.stripeAccountId,
    onboardingCompleted: detailsSubmitted,
    payoutsEnabled,
    detailsSubmitted,
    chargesEnabled: !!acct.charges_enabled,
    requirements: acct.requirements?.currently_due ?? [],
  };
}

/** Calcule la commission plateforme (en centimes) à partir du body. */
function resolveApplicationFee(amount: number, body: any): number {
  // Priorité : montant explicite > pourcentage explicite > défaut plateforme.
  if (body?.applicationFeeAmount != null) {
    return Math.max(0, Math.round(Number(body.applicationFeeAmount)));
  }
  const pct = body?.applicationFeePercent != null
    ? Number(body.applicationFeePercent)
    : DEFAULT_PLATFORM_FEE_PERCENT;
  return Math.max(0, Math.round((amount * pct) / 100));
}

// ─────────────────────────────────────────────────────────────────────────────
// Enregistrement des routes sur l'app Hono existante.
// deps = helpers d'auth vivant dans index.ts (getUser / requireAdmin).
// ─────────────────────────────────────────────────────────────────────────────
export function registerStripeRoutes(
  app: Hono<any>,
  deps: {
    getUser: (c: any) => Promise<any>;
    requireAdmin: (c: any) => Promise<any>;
  },
) {
  const { getUser, requireAdmin } = deps;

  // ── ADMIN : enregistrer / mettre à jour la clé secrète Stripe ──────────────
  // POST /api/admin/settings/stripe-key  { secretKey, webhookSecret? }
  // Stockée chiffrée. Reset du client en cache pour prise en compte immédiate.
  app.post('/admin/settings/stripe-key', async (c) => {
    const admin = await requireAdmin(c);
    if (!admin) return c.json({ error: 'Forbidden' }, 403);
    const body = await c.req.json().catch(() => ({}));
    const secretKey = String(body?.secretKey ?? body?.value ?? '').trim();
    const webhookSecret = typeof body?.webhookSecret === 'string' ? body.webhookSecret.trim() : '';
    if (!secretKey) return c.json({ error: 'secretKey requis' }, 400);
    if (!/^(sk|rk)_(test|live)_/.test(secretKey)) {
      return c.json({ error: 'Format de clé invalide (attendu sk_live_… / sk_test_…)' }, 400);
    }
    await setSecret('STRIPE_SECRET_KEY', secretKey, admin.id);
    if (webhookSecret) await setSecret('STRIPE_WEBHOOK_SECRET', webhookSecret, admin.id);
    // Invalide le cache : la prochaine getStripeClient() reconstruit l'instance.
    _cachedClient = null;
    _cachedKey = null;
    // Vérifie la validité de la clé sans exposer la valeur.
    try {
      const stripe = getStripeClient();
      // `null` = compte plateforme (le SDK exige l'argument : sans lui la
      // requête part sur /v1/accounts/undefined et le test échoue toujours).
      const acct = await stripe.accounts.retrieve(null);
      return c.json({ ok: true, valid: true, platformAccount: acct.id, last4: secretKey.slice(-4) }, 200);
    } catch (e: any) {
      return c.json({ ok: true, valid: false, error: e?.message || 'Clé enregistrée mais test échoué' }, 200);
    }
  });

  // ── ADMIN : statut de config Stripe (write-only, jamais la clé) ────────────
  app.get('/admin/settings/stripe-status', async (c) => {
    const admin = await requireAdmin(c);
    if (!admin) return c.json({ error: 'Forbidden' }, 403);
    const key = getSecret('STRIPE_SECRET_KEY');
    const wh = getSecret('STRIPE_WEBHOOK_SECRET');
    return c.json({
      secretKeySet: !!(key && key.trim()),
      secretKeyLast4: key ? key.slice(-4) : null,
      mode: key ? (key.includes('_live_') ? 'live' : 'test') : null,
      webhookSecretSet: !!(wh && wh.trim()),
    }, 200);
  });

  // ── Onboarding : crée le compte Connect + renvoie le lien d'onboarding ─────
  // POST /api/stripe/create-connect-account  (protégé)
  app.post('/stripe/create-connect-account', async (c) => {
    const user = await getUser(c);
    if (!user) return c.json({ error: 'Unauthorized' }, 401);
    try {
      const accountId = await ensureConnectAccount(user);
      const url = await createOnboardingLink(accountId, originOf(c));
      return c.json({ ok: true, accountId, url }, 200);
    } catch (e: any) {
      const msg = e?.message || 'Erreur Stripe';
      const code = /non configurée/.test(msg) ? 503 : 500;
      return c.json({ error: msg }, code);
    }
  });

  // ── Statut du compte Connect (interroge Stripe + met à jour la base) ───────
  // GET /api/stripe/account-status  (protégé)
  app.get('/stripe/account-status', async (c) => {
    const user = await getUser(c);
    if (!user) return c.json({ error: 'Unauthorized' }, 401);
    try {
      const status = await syncAccountStatus(user);
      return c.json({ ok: true, ...status }, 200);
    } catch (e: any) {
      const msg = e?.message || 'Erreur Stripe';
      const code = /non configurée/.test(msg) ? 503 : 500;
      return c.json({ error: msg }, code);
    }
  });

  // ── Callbacks d'onboarding (retour navigateur, pas d'auth requise) ─────────
  // Stripe renvoie l'utilisateur ici. On resynchronise puis on redirige vers
  // le front (page réglages paiements). refresh = lien expiré → à régénérer.
  app.get('/stripe/return', async (c) => {
    const origin = originOf(c);
    return c.redirect(`${origin}/settings/payments?stripe=return`);
  });
  app.get('/stripe/refresh', async (c) => {
    const origin = originOf(c);
    return c.redirect(`${origin}/settings/payments?stripe=refresh`);
  });

  // ── Checkout : paiement client + commission plateforme + transfert vendeur ─
  // POST /api/stripe/create-checkout-session
  // body: { sellerAccountId? , sellerUserId?, amount, currency?, productName?,
  //         productId?, quantity?, applicationFeePercent? | applicationFeeAmount? }
  app.post('/stripe/create-checkout-session', async (c) => {
    const buyer = await getUser(c).catch(() => null); // acheteur peut être invité
    try {
      const stripe = getStripeClient();
      const body = await c.req.json().catch(() => ({}));
      const origin = originOf(c);

      // Résolution du compte Connect vendeur : soit fourni directement,
      // soit déduit d'un sellerUserId (on va chercher son stripe_account_id).
      let sellerAccountId: string | null = body?.sellerAccountId ? String(body.sellerAccountId) : null;
      let sellerUserId: string | null = body?.sellerUserId ? String(body.sellerUserId) : null;
      if (!sellerAccountId && sellerUserId) {
        const seller = await db.select().from(schema.users).where(eq(schema.users.id, sellerUserId)).get();
        if (!seller?.stripeAccountId) return c.json({ error: 'Vendeur sans compte Stripe configuré' }, 400);
        if (!seller.stripePayoutsEnabled) return c.json({ error: 'Le compte du vendeur n\'est pas encore activé pour les paiements' }, 400);
        sellerAccountId = seller.stripeAccountId;
      }
      if (!sellerAccountId) return c.json({ error: 'sellerAccountId ou sellerUserId requis' }, 400);

      const amount = Math.round(Number(body?.amount)); // centimes
      if (!Number.isFinite(amount) || amount <= 0) return c.json({ error: 'amount (centimes) invalide' }, 400);
      const currency = String(body?.currency || 'eur').toLowerCase();
      const quantity = Math.max(1, Math.round(Number(body?.quantity) || 1));
      const productName = String(body?.productName || 'Commande');
      const applicationFeeAmount = resolveApplicationFee(amount * quantity, body);

      const session = await stripe.checkout.sessions.create({
        mode: 'payment',
        line_items: [{
          quantity,
          price_data: {
            currency,
            unit_amount: amount,
            product_data: { name: productName },
          },
        }],
        payment_intent_data: {
          application_fee_amount: applicationFeeAmount,
          transfer_data: { destination: sellerAccountId },
        },
        success_url: `${origin}/checkout/success?session_id={CHECKOUT_SESSION_ID}`,
        cancel_url: `${origin}/checkout/cancel`,
        metadata: {
          productId: body?.productId ? String(body.productId) : '',
          sellerUserId: sellerUserId || '',
          buyerUserId: buyer?.id || '',
        },
      });

      // Trace la commande en base (statut pending → mis à jour par le webhook).
      const orderId = crypto.randomUUID();
      const now = new Date();
      await db.insert(schema.stripeConnectOrders).values({
        id: orderId,
        buyerUserId: buyer?.id || null,
        sellerUserId,
        sellerAccountId,
        productId: body?.productId ? String(body.productId) : null,
        amount: amount * quantity,
        currency,
        applicationFeeAmount,
        stripeSessionId: session.id,
        status: 'pending',
        metadata: JSON.stringify({ productName, quantity }),
        createdAt: now,
        updatedAt: now,
      }).catch((e) => console.error('[stripe] insert order failed:', e?.message));

      return c.json({ ok: true, id: session.id, url: session.url }, 200);
    } catch (e: any) {
      const msg = e?.message || 'Erreur Stripe';
      const code = /non configurée/.test(msg) ? 503 : 500;
      return c.json({ error: msg }, code);
    }
  });

  // ── Webhook Stripe : signature vérifiée sur le corps BRUT ──────────────────
  // POST /api/stripe/webhook  (pas d'auth ; raw body via c.req.text())
  app.post('/stripe/webhook', async (c) => {
    const sig = c.req.header('stripe-signature');
    const whSecret = getSecret('STRIPE_WEBHOOK_SECRET') || process.env.STRIPE_WEBHOOK_SECRET || '';
    if (!whSecret) return c.json({ error: 'Webhook non configuré' }, 503);
    if (!sig) return c.json({ error: 'Signature manquante' }, 400);

    let event: Stripe.Event;
    try {
      const stripe = getStripeClient();
      const raw = await c.req.text(); // corps EXACT non parsé (obligatoire)
      event = stripe.webhooks.constructEvent(raw, sig, whSecret);
    } catch (e: any) {
      console.error('[stripe:webhook] signature invalide:', e?.message);
      return c.json({ error: `Webhook signature verification failed: ${e?.message}` }, 400);
    }

    try {
      switch (event.type) {
        case 'account.updated': {
          const acct = event.data.object as Stripe.Account;
          await db.update(schema.users)
            .set({
              stripeOnboardingCompleted: !!acct.details_submitted,
              stripePayoutsEnabled: !!acct.payouts_enabled,
            })
            .where(eq(schema.users.stripeAccountId, acct.id));
          break;
        }
        case 'checkout.session.completed': {
          const s = event.data.object as Stripe.Checkout.Session;
          await db.update(schema.stripeConnectOrders)
            .set({
              status: s.payment_status === 'paid' ? 'paid' : 'pending',
              stripePaymentIntentId: (s.payment_intent as string) || null,
              updatedAt: new Date(),
            })
            .where(eq(schema.stripeConnectOrders.stripeSessionId, s.id));
          break;
        }
        case 'checkout.session.expired': {
          const s = event.data.object as Stripe.Checkout.Session;
          await db.update(schema.stripeConnectOrders)
            .set({ status: 'expired', updatedAt: new Date() })
            .where(eq(schema.stripeConnectOrders.stripeSessionId, s.id));
          break;
        }
        default:
          // événement non géré : on l'accuse quand même (200) pour éviter les retries.
          break;
      }
      return c.json({ received: true }, 200);
    } catch (e: any) {
      console.error('[stripe:webhook] traitement échoué:', e?.message);
      return c.json({ error: 'Erreur traitement webhook' }, 500);
    }
  });
}
