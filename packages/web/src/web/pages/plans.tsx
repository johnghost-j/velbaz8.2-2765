import { useAuth } from '../lib/auth';
import { useEffect, useState } from 'react';
import { api } from '../lib/api';
import { AnimatedCounter } from '../components/AnimatedCounter';
import { SupportPanel } from '../components/SupportPanel';

// Page abonnements — copie fidèle de la maquette fournie (fond noir, bandeau
// teal en haut de chaque carte, encadré image dans la carte, liste de features
// avec `—` / `✓` et lignes dépliables, bandeau support, liens FAQs / Help).
// Le contenu reste celui de Velbaz. Palette et polices INCHANGÉES : uniquement
// les tokens existants (--teal, --surface-*, --text-*, --border-*). Aucune
// dépendance ajoutée. L'image vit dans packages/web/public/images/.

const CARD_IMAGE = '/images/plan-highlight.jpg';

type Cell = 'no' | 'yes' | 'hi';

type Feature = {
  id: string;
  label: string;
  details?: string;
  cells: Record<string, Cell>; // par clé de plan
};

type Plan = {
  key: string;
  name: string;
  monthly: number;
  description: string;
  creditsMonthly: string;
  creditsDaily: string;
  cta: string;
  highlighted: boolean;
};

const PLANS: Plan[] = [
  {
    key: 'free',
    name: 'Free',
    monthly: 0,
    description: 'See what Velbaz can do',
    creditsMonthly: '100 queries monthly',
    creditsDaily: '1 project',
    cta: 'Downgrade',
    highlighted: false,
  },
  {
    key: 'business',
    name: 'Business',
    monthly: 29,
    description: 'Higher limits, priority support',
    creditsMonthly: '5,000 queries monthly',
    creditsDaily: '10 projects',
    cta: 'Upgrade',
    highlighted: true,
  },
  {
    key: 'enterprise',
    name: 'Enterprise',
    monthly: 99,
    description: 'Go beyond limits and imaginations',
    creditsMonthly: 'Unlimited queries',
    creditsDaily: 'Unlimited projects',
    cta: 'Upgrade',
    highlighted: false,
  },
];

// Les 3 lignes affichées dans l'encadré image de chaque carte.
const IMAGE_ROWS = [
  'Build websites with the AI editor',
  'Generate designs with Genesis',
  'Monetise with Money-Maker',
];

const FEATURES: Feature[] = [
  {
    id: 'full-suite',
    label: 'Full AI suite',
    cells: { free: 'no', business: 'no', enterprise: 'hi' },
  },
  {
    id: 'advanced',
    label: 'Advanced AI analysis',
    cells: { free: 'no', business: 'hi', enterprise: 'hi' },
  },
  {
    id: 'basic',
    label: 'Basic AI analysis',
    cells: { free: 'yes', business: 'yes', enterprise: 'yes' },
  },
  {
    id: 'support',
    label: 'Community support',
    cells: { free: 'yes', business: 'yes', enterprise: 'yes' },
  },
  {
    id: 'priority',
    label: 'Priority support',
    cells: { free: 'no', business: 'yes', enterprise: 'yes' },
  },
  {
    id: 'dedicated',
    label: 'Dedicated support',
    cells: { free: 'no', business: 'no', enterprise: 'yes' },
  },
  {
    id: 'reports',
    label: 'Custom reports',
    cells: { free: 'no', business: 'yes', enterprise: 'yes' },
  },
  {
    id: 'team',
    label: 'Team collaboration',
    cells: { free: 'no', business: 'yes', enterprise: 'yes' },
  },
  {
    id: 'sites',
    label: 'Websites & App building',
    details: 'Free database, Free Analytics, Stripe Integration, Free sub-domain, Android-iOS App building',
    cells: { free: 'no', business: 'yes', enterprise: 'yes' },
  },
  {
    id: 'chat',
    label: 'Multi-modal Chat',
    // Pas de noms de modèles : on décrit les capacités, jamais le fournisseur.
    details: 'Text, images, files, voice and web search in a single chat',
    cells: { free: 'yes', business: 'yes', enterprise: 'yes' },
  },
  {
    id: 'integrations',
    label: 'Custom integrations',
    cells: { free: 'no', business: 'no', enterprise: 'yes' },
  },
  {
    id: 'api',
    label: 'API access',
    cells: { free: 'no', business: 'no', enterprise: 'yes' },
  },
  {
    id: 'sso',
    label: 'SSO & advanced security',
    cells: { free: 'no', business: 'no', enterprise: 'yes' },
  },
  {
    id: 'assistant',
    label: 'Personal Assistant across every channel',
    details: 'Slack, Microsoft Teams, Telegram, iMessage, Discord',
    cells: { free: 'no', business: 'yes', enterprise: 'yes' },
  },
];

const TOKEN_PACKAGES = [
  // 1 € = 1000 credits
  { id: 'credits_4990', tokens: 4990, price: 4.99, best: false },
  { id: 'credits_9990', tokens: 9990, price: 9.99, best: false },
  { id: 'credits_24990', tokens: 24990, price: 24.99, best: false },
  { id: 'credits_49990', tokens: 49990, price: 49.99, best: true },
];

// 12 mois payés 10 → 2 mois offerts (≈ -17 %).
const YEARLY_FACTOR = 10;

const FAQ = [
  {
    q: 'Can I change plan at any time?',
    a: 'Yes. Upgrades apply immediately and downgrades take effect at the end of the current period. Unused credits stay on your account.',
  },
  {
    q: 'What is a credit?',
    a: 'Credits are consumed when the AI builds, analyses or publishes. €1 = 1,000 credits, and they never expire.',
  },
  {
    q: 'Do I need a credit card for the Free plan?',
    a: 'No. The Free plan is available without any payment method and you can stay on it as long as you want.',
  },
  {
    q: 'Can I get an invoice for my company?',
    a: 'Every payment generates a downloadable invoice with your billing details, VAT number included.',
  },
];

// Trie les features d'une carte : les lignes mises en avant d'abord, puis les
// incluses, puis les non incluses — comme dans la maquette.
function orderFor(planKey: string) {
  const rank = (c: Cell) => (c === 'hi' ? 0 : c === 'yes' ? 1 : 2);
  return [...FEATURES].sort((a, b) => rank(a.cells[planKey]) - rank(b.cells[planKey]));
}

function Mark({ state }: { state: Cell }) {
  if (state === 'no') {
    return (
      <span
        className="shrink-0 inline-flex items-center justify-center"
        style={{ width: 13, height: 18, color: 'var(--text-ghost)', fontSize: 13, lineHeight: 1 }}
        aria-label="not included"
      >
        —
      </span>
    );
  }
  return (
    <svg
      className="shrink-0"
      width="13"
      height="18"
      viewBox="0 0 16 16"
      fill="none"
      stroke={state === 'hi' ? 'var(--text-primary)' : 'var(--text-muted)'}
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-label="included"
    >
      <path d="M3 8.5L6.2 11.5L13 4.8" />
    </svg>
  );
}

function CreditIcon({ daily }: { daily?: boolean }) {
  return (
    <svg
      className="shrink-0"
      width="14"
      height="14"
      viewBox="0 0 16 16"
      fill="none"
      stroke="var(--text-muted)"
      strokeWidth="1.3"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {daily ? (
        <>
          <path d="M13.5 8a5.5 5.5 0 1 1-1.7-4" />
          <path d="M13.6 1.8V4.2H11.2" />
        </>
      ) : (
        <>
          <ellipse cx="8" cy="6" rx="5.5" ry="2.4" />
          <path d="M2.5 6v3.6c0 1.3 2.5 2.4 5.5 2.4s5.5-1.1 5.5-2.4V6" />
        </>
      )}
    </svg>
  );
}

export default function Plans() {
  const { user, updateTokens, setUser } = useAuth();
  // `pro` est l'ancien nom de `business` en base : on l'aligne pour que la
  // carte Business s'affiche bien comme le plan actif.
  const rawPlan = (user?.plan || 'free').toLowerCase();
  const currentPlan = rawPlan === 'pro' || rawPlan === 'biz' ? 'business' : rawPlan === 'ent' ? 'enterprise' : rawPlan;
  const [purchasing, setPurchasing] = useState<string | null>(null);
  const [purchaseSuccess, setPurchaseSuccess] = useState<string | null>(null);
  // Souscription en cours + résultat, affichés sous les cartes.
  const [subscribing, setSubscribing] = useState<string | null>(null);
  const [planMsg, setPlanMsg] = useState<{ ok: boolean; text: string; key: string } | null>(null);
  const [yearly, setYearly] = useState(false);
  // Fin d'abonnement (null = sans date de fin), lue au chargement.
  const [expiresAt, setExpiresAt] = useState<string | null>(null);
  const [openFaq, setOpenFaq] = useState<number | null>(0);
  const [showFaq, setShowFaq] = useState(false);
  // Popup de support (même composant que celui de la sidebar).
  const [supportOpen, setSupportOpen] = useState(false);
  // Lignes dépliées, clé `${planKey}:${featureId}`.
  const [openRows, setOpenRows] = useState<Record<string, boolean>>({});

  useEffect(() => {
    let alive = true;
    api.plans.me()
      .then((res: any) => { if (alive && res && !res.error) setExpiresAt(res.expiresAt || null); })
      .catch(() => {});
    return () => { alive = false; };
  }, [user?.plan]);

  async function buyTokens(pkgId: string) {
    setPurchasing(pkgId);
    setPurchaseSuccess(null);
    try {
      const res = await api.tokens.purchase(pkgId);
      if (res.ok) {
        updateTokens(res.tokens);
        const pkg = TOKEN_PACKAGES.find(p => p.id === pkgId);
        setPurchaseSuccess(`${pkg?.tokens.toLocaleString('en-US')} credits added! New balance: ${res.tokens.toLocaleString('en-US')}`);
      } else {
        setPurchaseSuccess(res.error || 'Purchase failed');
      }
    } catch { setPurchaseSuccess('Network error'); }
    setPurchasing(null);
  }

  // Changement de plan RÉEL : le serveur met à jour `users.plan` tout de suite
  // et renvoie le nouveau solde de crédits. Stripe viendra s'insérer avant cet
  // appel plus tard, sans rien changer ici.
  async function choosePlan(planKey: string) {
    if (planKey === currentPlan || subscribing) return;
    setSubscribing(planKey);
    setPlanMsg(null);
    try {
      const res = await api.plans.subscribe(planKey, yearly ? 'yearly' : 'monthly');
      if (res?.ok) {
        if (user) setUser({ ...user, plan: res.plan, tokens: typeof res.tokens === 'number' ? res.tokens : user.tokens });
        if (!res.alreadyActive) setExpiresAt(res.expiresAt || null);
        const name = PLANS.find(p => p.key === res.plan)?.name || res.plan;
        setPlanMsg({
          ok: true,
          key: res.plan,
          text: res.alreadyActive
            ? `You are already on the ${name} plan.`
            : `${name} plan active!${res.creditsGranted ? ` ${Number(res.creditsGranted).toLocaleString('en-US')} credits added.` : ''}`,
        });
      } else {
        setPlanMsg({ ok: false, key: planKey, text: res?.error || 'Could not change plan' });
      }
    } catch {
      setPlanMsg({ ok: false, key: planKey, text: 'Network error' });
    }
    setSubscribing(null);
  }

  const pillStyle = {
    background: 'var(--surface-2)',
    border: '1px solid var(--border-subtle)',
    color: 'var(--text-muted)',
  } as const;

  return (
    <div className="min-h-screen" style={{ background: 'var(--surface-0)' }}>
      <div className="relative max-w-6xl mx-auto px-6 pt-5 pb-14">
        {/* ===== Barre du haut : Go back ===== */}
        <div className="relative flex items-start justify-between gap-4">
          <button
            onClick={() => window.history.back()}
            className="inline-flex items-center gap-2 h-8 px-3.5 rounded-full text-[12.5px] font-medium transition-colors"
            style={{ ...pillStyle, cursor: 'pointer' }}
            onMouseEnter={e => { e.currentTarget.style.background = 'var(--surface-3)'; }}
            onMouseLeave={e => { e.currentTarget.style.background = 'var(--surface-2)'; }}
          >
            <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
              <path d="M13 8H3M6.5 4.5L3 8l3.5 3.5" />
            </svg>
            Go back
          </button>
        </div>

        {/* ===== Titre + bascule ===== */}
        <div className="text-center -mt-2" style={{ animation: 'fade-in 0.35s ease both' }}>
          <h1
            style={{ fontSize: 34, fontWeight: 400, letterSpacing: '-0.01em', color: 'var(--text-secondary)', lineHeight: 1.2 }}
          >
            The only AI agent you need
          </h1>

          <div
            className="inline-flex items-center gap-1 mt-6 p-1 rounded-full"
            style={{ background: 'var(--surface-1)', border: '1px solid var(--border-subtle)' }}
          >
            {[
              { label: 'Monthly', value: false },
              { label: 'Annually · Save 17%', value: true },
            ].map(opt => {
              const active = yearly === opt.value;
              return (
                <button
                  key={opt.label}
                  onClick={() => setYearly(opt.value)}
                  className="px-3.5 h-7 rounded-full text-[12.5px] font-medium transition-all"
                  style={{
                    background: active ? 'var(--surface-4)' : 'transparent',
                    color: active ? 'var(--text-primary)' : 'var(--text-dim)',
                    border: 'none',
                    cursor: 'pointer',
                  }}
                >
                  {opt.label}
                </button>
              );
            })}
          </div>

          {user && (
            <div className="mt-5">
              <span className="text-[12px]" style={{ color: 'var(--text-dim)' }}>
                <AnimatedCounter value={user.tokens || 0} fontSize={12} suffix=" credits" /> remaining
              </span>
            </div>
          )}
        </div>

        {/* ===== Cartes ===== */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-5 items-start mt-8">
          {PLANS.map((plan, i) => {
            const isCurrent = currentPlan === plan.key;
            const hi = plan.highlighted;
            const price = plan.monthly === 0 ? 0 : yearly ? plan.monthly * YEARLY_FACTOR : plan.monthly;
            const period = plan.monthly === 0 ? '/month' : yearly ? '/year' : '/month';
            // Bouton blanc pour les offres à souscrire, gris pour un retour en arrière.
            const white = plan.key !== 'free';

            return (
              <div
                key={plan.key}
                className="relative rounded-xl flex flex-col overflow-hidden"
                style={{
                  background: 'var(--surface-1)',
                  border: `1px solid ${hi ? 'var(--border-hover)' : 'var(--border-subtle)'}`,
                  marginTop: hi ? -10 : 0,
                  animation: 'slide-up 0.4s ease both',
                  animationDelay: `${0.05 * (i + 1)}s`,
                }}
              >
                {/* Pas de bandeau « Limited Time » : offre retirée à la demande. */}
                <div className="flex flex-col flex-1" style={{ padding: '18px 16px' }}>
                  {/* Nom + badge */}
                  <div className="flex items-center justify-between gap-2">
                    <h2 className="text-[14px] font-medium" style={{ color: 'var(--text-primary)' }}>{plan.name}</h2>
                    {hi && (
                      <span
                        className="text-[10px] font-semibold px-2 py-0.5 rounded-full"
                        style={{ background: 'var(--teal-bg)', color: 'var(--teal)', border: '1px solid var(--teal-subtle-border)', whiteSpace: 'nowrap' }}
                      >
                        Most Popular
                      </span>
                    )}
                    {isCurrent && !hi && (
                      <span
                        className="text-[10px] font-semibold px-2 py-0.5 rounded-full"
                        style={{ background: 'var(--surface-3)', color: 'var(--text-muted)', border: '1px solid var(--border-default)', whiteSpace: 'nowrap' }}
                      >
                        Active
                      </span>
                    )}
                  </div>
                  <p className="text-[11.5px] mt-1.5" style={{ color: 'var(--text-dim)' }}>{plan.description}</p>

                  {/* Prix. Alignement en flex-end et non en baseline : les cellules
                      du compteur mesurent fontSize * 1.2 et le chiffre est centré
                      dedans, donc la ligne de base synthétisée tombe ~10 px sous le
                      chiffre. On recale « $ » et la période à la main. */}
                  <div className="flex gap-1 mt-3" style={{ alignItems: 'flex-end' }}>
                    <span style={{ fontSize: 11, fontWeight: 500, color: 'var(--text-muted)', marginBottom: 16 }}>$</span>
                    <AnimatedCounter
                      value={price}
                      duration={200}
                      fontSize={30}
                      style={{ fontWeight: 500, lineHeight: 1, letterSpacing: '-0.01em', color: 'var(--text-primary)' }}
                    />
                    <span className="text-[11.5px]" style={{ color: 'var(--text-dim)', marginBottom: 7 }}>{period}</span>
                  </div>

                  {/* Bouton pleine largeur */}
                  <button
                    disabled={isCurrent || subscribing !== null}
                    onClick={() => choosePlan(plan.key)}
                    className="w-full rounded-lg text-[12.5px] font-medium transition-all mt-3.5"
                    style={
                      isCurrent
                        ? { height: 36, background: 'var(--surface-3)', color: 'var(--text-ghost)', border: '1px solid var(--border-subtle)', cursor: 'default' }
                        : white
                          ? { height: 36, background: '#fff', color: '#000', border: 'none', cursor: subscribing ? 'wait' : 'pointer' }
                          : { height: 36, background: 'var(--surface-3)', color: 'var(--text-secondary)', border: '1px solid var(--border-subtle)', cursor: subscribing ? 'wait' : 'pointer' }
                    }
                    onMouseEnter={e => {
                      if (isCurrent) return;
                      e.currentTarget.style.opacity = '0.88';
                    }}
                    onMouseLeave={e => {
                      e.currentTarget.style.opacity = '1';
                    }}
                  >
                    {isCurrent
                      ? 'Current Plan'
                      : subscribing === plan.key
                        ? 'Activating…'
                        : plan.cta}
                  </button>
                  {isCurrent && expiresAt && (
                    <div className="text-[11px] mt-2 text-center" style={{ color: 'var(--text-muted)' }}>
                      Active until {new Date(expiresAt).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })}
                    </div>
                  )}
                  {planMsg && planMsg.key === plan.key && subscribing === null && (
                    <div
                      className="text-[11px] mt-2 text-center"
                      style={{ color: planMsg.ok ? 'var(--teal)' : '#ef4444' }}
                    >
                      {planMsg.text}
                    </div>
                  )}

                  {/* Deux lignes de quotas */}
                  <div className="mt-4 space-y-2.5">
                    <div className="flex items-center gap-2 text-[12px]" style={{ color: 'var(--text-secondary)' }}>
                      <CreditIcon />
                      {plan.creditsMonthly}
                    </div>
                    <div className="flex items-center gap-2 text-[12px]" style={{ color: 'var(--text-secondary)' }}>
                      <CreditIcon daily />
                      {plan.creditsDaily}
                    </div>
                  </div>

                  {/* Encadré image */}
                  <div
                    className="mt-4 rounded-lg overflow-hidden relative"
                    style={{ border: '1px solid var(--border-subtle)' }}
                  >
                    <img
                      src={CARD_IMAGE}
                      alt=""
                      aria-hidden
                      style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover' }}
                    />
                    <div className="relative px-3 py-3 space-y-2.5">
                      {IMAGE_ROWS.map((row, r) => (
                        <div key={row} className="flex items-center gap-2.5">
                          <span
                            className="shrink-0 inline-flex items-center justify-center rounded-full"
                            style={{ width: 20, height: 20, background: 'rgba(0,0,0,0.55)' }}
                          >
                            <svg width="11" height="11" viewBox="0 0 16 16" fill="none" stroke="#fff" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
                              {r === 0 && <><rect x="2" y="3" width="12" height="9" rx="1.5" /><path d="M2 6h12" /></>}
                              {r === 1 && <><path d="M8 2v12M2 8h12" /><circle cx="8" cy="8" r="6" /></>}
                              {r === 2 && <><path d="M3 4h10v7H8l-3 2.5V11H3z" /></>}
                            </svg>
                          </span>
                          <span className="text-[11.5px]" style={{ color: '#ECECEC' }}>{row}</span>
                        </div>
                      ))}
                    </div>
                  </div>

                  {/* Liste de features */}
                  <ul className="mt-5 space-y-2.5 flex-1">
                    {orderFor(plan.key).map(f => {
                      const state = f.cells[plan.key];
                      const rowKey = `${plan.key}:${f.id}`;
                      const open = !!openRows[rowKey];
                      const color =
                        state === 'hi' ? 'var(--teal)' : state === 'yes' ? 'var(--text-secondary)' : 'var(--text-dim)';
                      return (
                        <li key={f.id}>
                          <div className="flex items-start gap-2">
                            <Mark state={state} />
                            {f.details && state !== 'no' ? (
                              <button
                                onClick={() => setOpenRows(s => ({ ...s, [rowKey]: !s[rowKey] }))}
                                className="flex items-center gap-1.5 text-left text-[12px]"
                                style={{ background: 'none', border: 'none', padding: 0, color, cursor: 'pointer', lineHeight: 1.45 }}
                              >
                                {f.label}
                                <svg
                                  width="11"
                                  height="11"
                                  viewBox="0 0 16 16"
                                  fill="none"
                                  stroke="var(--text-dim)"
                                  strokeWidth="1.8"
                                  strokeLinecap="round"
                                  strokeLinejoin="round"
                                  style={{ flexShrink: 0, transition: 'transform 0.18s ease', transform: open ? 'rotate(90deg)' : 'none' }}
                                >
                                  <path d="M6 3.5L10.5 8L6 12.5" />
                                </svg>
                              </button>
                            ) : (
                              <span className="text-[12px]" style={{ color, lineHeight: 1.45 }}>{f.label}</span>
                            )}
                          </div>
                          {f.details && state !== 'no' && (
                            <div
                              style={{
                                display: 'grid',
                                gridTemplateRows: open ? '1fr' : '0fr',
                                transition: 'grid-template-rows 0.2s ease',
                              }}
                            >
                              <div style={{ overflow: 'hidden' }}>
                                <p className="text-[11px] pt-1.5 pl-[21px]" style={{ color: 'var(--text-ghost)', lineHeight: 1.55 }}>
                                  {f.details}
                                </p>
                              </div>
                            </div>
                          )}
                        </li>
                      );
                    })}
                  </ul>
                </div>
              </div>
            );
          })}
        </div>

        {/* ===== Bandeau support dédié ===== */}
        <div
          className="mt-6 rounded-xl flex flex-wrap items-center justify-between gap-4"
          style={{ background: 'var(--surface-1)', border: '1px solid var(--border-subtle)', padding: '18px 20px' }}
        >
          <div style={{ maxWidth: 720 }}>
            <div className="text-[14px] font-medium" style={{ color: 'var(--text-primary)' }}>
              Need dedicated human support?
            </div>
            <p className="text-[11.5px] mt-1" style={{ color: 'var(--text-dim)', lineHeight: 1.5 }}>
              Dedicated account manager to help with anything, learning modules, onboarding assistance, lead generation, optimising ads etc.
            </p>
          </div>
          <button
            onClick={() => setSupportOpen(true)}
            className="rounded-lg text-[12.5px] font-medium px-4 transition-opacity"
            style={{ height: 36, background: '#fff', color: '#000', border: 'none', cursor: 'pointer' }}
            onMouseEnter={e => { e.currentTarget.style.opacity = '0.88'; }}
            onMouseLeave={e => { e.currentTarget.style.opacity = '1'; }}
          >
            Contact sales
          </button>
        </div>

        {/* ===== Crédits (offres payantes uniquement) ===== */}
        {currentPlan !== 'free' && (
          <div className="mt-16">
            <div className="text-center mb-7">
              <h2 className="font-medium mb-2" style={{ fontSize: 22, letterSpacing: '-0.01em', color: 'var(--text-primary)' }}>
                Need more credits?
              </h2>
              <p className="text-[12.5px]" style={{ color: 'var(--text-dim)' }}>
                Top up any time — €1 = 1,000 credits, and they never expire.
              </p>
            </div>

            {purchaseSuccess && (
              <div
                className="max-w-md mx-auto mb-5 px-4 py-3 rounded-xl text-[12.5px] text-center"
                style={{
                  background: purchaseSuccess.includes('added') ? 'var(--green-subtle-bg)' : 'var(--red-subtle-bg)',
                  border: `1px solid ${purchaseSuccess.includes('added') ? 'var(--green-subtle-border)' : 'var(--red-subtle-border)'}`,
                  color: purchaseSuccess.includes('added') ? 'var(--green-text)' : 'var(--red-text)',
                  animation: 'slide-up 0.3s ease both',
                }}
              >
                {purchaseSuccess}
              </div>
            )}

            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 max-w-4xl mx-auto">
              {TOKEN_PACKAGES.map(pkg => (
                <div
                  key={pkg.id}
                  className="relative rounded-xl flex flex-col text-center"
                  style={{
                    background: 'var(--surface-1)',
                    border: `1px solid ${pkg.best ? 'var(--border-hover)' : 'var(--border-subtle)'}`,
                    padding: '22px 16px',
                  }}
                >
                  {pkg.best && (
                    <span
                      className="absolute text-[9.5px] font-semibold px-2 py-0.5 rounded-full"
                      style={{
                        top: -8,
                        left: '50%',
                        transform: 'translateX(-50%)',
                        whiteSpace: 'nowrap',
                        background: 'var(--teal)',
                        color: 'var(--text-inverse)',
                      }}
                    >
                      Best value
                    </span>
                  )}

                  <div style={{ color: 'var(--text-primary)' }}>
                    <AnimatedCounter value={pkg.tokens} fontSize={24} />
                  </div>
                  <div className="text-[10.5px] mt-1" style={{ letterSpacing: '0.06em', color: 'var(--text-ghost)', textTransform: 'uppercase' }}>
                    credits
                  </div>

                  <div style={{ height: 1, background: 'var(--border-subtle)', margin: '16px 0' }} />

                  <div className="text-[18px] font-semibold" style={{ color: 'var(--text-primary)' }}>
                    ${pkg.price}
                  </div>
                  <div className="text-[10.5px] mt-0.5 mb-4" style={{ color: 'var(--text-ghost)' }}>
                    ${(pkg.price / (pkg.tokens / 1000)).toFixed(2)} / 1k credits
                  </div>

                  <button
                    onClick={() => buyTokens(pkg.id)}
                    disabled={purchasing === pkg.id}
                    className="mt-auto w-full rounded-lg text-[12.5px] font-medium transition-all disabled:opacity-40"
                    style={{
                      height: 36,
                      background: pkg.best ? '#fff' : 'var(--surface-3)',
                      color: pkg.best ? '#000' : 'var(--text-secondary)',
                      border: pkg.best ? 'none' : '1px solid var(--border-subtle)',
                      cursor: purchasing === pkg.id ? 'default' : 'pointer',
                    }}
                  >
                    {purchasing === pkg.id ? 'Purchasing…' : 'Buy credits'}
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* ===== FAQs / Help ===== */}
        <div className="flex items-center justify-center gap-6 mt-12">
          {[
            { label: 'FAQs', onClick: () => setShowFaq(v => !v) },
            { label: 'Help', onClick: () => setShowFaq(true) },
          ].map(link => (
            <button
              key={link.label}
              onClick={link.onClick}
              className="inline-flex items-center gap-1.5 text-[12px]"
              style={{ background: 'none', border: 'none', color: 'var(--text-dim)', cursor: 'pointer' }}
            >
              <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round">
                <circle cx="8" cy="8" r="6" />
                <path d="M6.4 6.2A1.7 1.7 0 0 1 9.7 6.8c0 1.1-1.7 1.3-1.7 2.3" />
                <path d="M8 11.4v0" />
              </svg>
              {link.label}
            </button>
          ))}
        </div>

        {/* Accordéon FAQ, replié par défaut — ouvert par les liens ci-dessus. */}
        {showFaq && (
          <div className="mt-6 max-w-2xl mx-auto" style={{ animation: 'slide-up 0.3s ease both' }}>
            <div className="rounded-xl overflow-hidden" style={{ background: 'var(--surface-1)', border: '1px solid var(--border-subtle)' }}>
              {FAQ.map((item, i) => {
                const open = openFaq === i;
                return (
                  <div key={item.q} style={{ borderTop: i === 0 ? 'none' : '1px solid var(--border-subtle)' }}>
                    <button
                      onClick={() => setOpenFaq(open ? null : i)}
                      className="w-full flex items-center justify-between gap-4 text-left px-5 py-4"
                      style={{ background: 'transparent', border: 'none', cursor: 'pointer' }}
                    >
                      <span className="text-[13px] font-medium" style={{ color: open ? 'var(--text-primary)' : 'var(--text-secondary)' }}>
                        {item.q}
                      </span>
                      <svg
                        width="13"
                        height="13"
                        viewBox="0 0 16 16"
                        fill="none"
                        stroke={open ? 'var(--text-primary)' : 'var(--text-dim)'}
                        strokeWidth="2"
                        strokeLinecap="round"
                        style={{ flexShrink: 0, transition: 'transform 0.2s ease', transform: open ? 'rotate(45deg)' : 'rotate(0deg)' }}
                      >
                        <path d="M8 3.5V12.5M3.5 8H12.5" />
                      </svg>
                    </button>
                    <div
                      style={{
                        display: 'grid',
                        gridTemplateRows: open ? '1fr' : '0fr',
                        transition: 'grid-template-rows 0.22s ease',
                      }}
                    >
                      <div style={{ overflow: 'hidden' }}>
                        <p className="text-[12.5px] px-5 pb-4" style={{ color: 'var(--text-dim)', lineHeight: 1.6 }}>
                          {item.a}
                        </p>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>

      {/* Popup de support — même composant que celui de la sidebar. */}
      <SupportPanel open={supportOpen} onClose={() => setSupportOpen(false)} />
    </div>
  );
}
