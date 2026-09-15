import { useLocation, useRoute } from 'wouter';
import { useEffect } from 'react';
import { BRAND, LEGAL_ENTITY, CONTACT_EMAIL, SUPPORT_EMAIL, JURISDICTION, WEBSITE } from '../lib/brand';

// ─── Config entreprise (voir src/web/lib/brand.ts pour renommer l'app) ──
const COMPANY = BRAND;
const LAST_UPDATED = 'July 25, 2026';

// ─── Types ───────────────────────────────────────────────────
type Block =
  | { h: string }            // heading
  | { p: string }            // paragraph
  | { list: string[] };      // bullet list

interface LegalDoc {
  slug: string;
  title: string;
  short: string;
  blocks: Block[];
}

// ─── Documents ───────────────────────────────────────────────
export const LEGAL_DOCS: LegalDoc[] = [
  {
    slug: 'terms',
    title: 'Terms of Service',
    short: 'Terms',
    blocks: [
      { p: `Welcome to ${COMPANY}. These Terms of Service ("Terms") govern your access to and use of the ${COMPANY} website, applications, APIs, and related services (collectively, the "Service") operated by ${LEGAL_ENTITY} ("${COMPANY}", "we", "us", or "our"). By creating an account or using the Service, you agree to be bound by these Terms. If you do not agree, do not use the Service.` },

      { h: '1. Eligibility' },
      { p: 'You must be at least 13 years old (or the minimum age of digital consent in your country) to use the Service. If you use the Service on behalf of an organization, you represent that you are authorized to bind that organization to these Terms.' },

      { h: '2. Your Account' },
      { p: 'You are responsible for safeguarding your account credentials and for all activity that occurs under your account. You must notify us immediately of any unauthorized use. We are not liable for any loss resulting from unauthorized use of your account.' },

      { h: '3. The Service' },
      { p: `${COMPANY} is an AI-powered platform that helps you generate, build, and deploy websites and applications. You can create projects, generate content and code, and use integrated third-party tools. Features may change, be added, or be removed over time.` },

      { h: '4. Your Content & Ownership' },
      { p: 'You retain ownership of the content, prompts, code, and materials you submit to or generate with the Service ("User Content"). You grant us a worldwide, non-exclusive license to host, store, process, and display your User Content solely to operate and improve the Service.' },
      { p: 'Subject to your compliance with these Terms and payment of applicable fees, you own the output generated for you by the Service, to the extent permitted by law. You are responsible for ensuring your use of any output complies with applicable law and third-party rights.' },

      { h: '5. Acceptable Use' },
      { p: 'Your use of the Service is subject to our Acceptable Use Policy. You agree not to misuse the Service, including by attempting to reverse-engineer, disrupt, or gain unauthorized access to any part of it.' },

      { h: '6. Payments, Subscriptions & Tokens' },
      { list: [
        'Paid plans and token/credit purchases are billed in advance and are described at checkout.',
        'Subscriptions renew automatically until cancelled. You can cancel at any time from your account settings.',
        'Fees are exclusive of taxes unless stated otherwise; you are responsible for applicable taxes.',
        'We may change prices with reasonable prior notice. Continued use after a price change constitutes acceptance.',
        'Refunds are handled according to our Refund Policy.',
      ] },

      { h: '7. Third-Party Services' },
      { p: 'The Service integrates third-party providers (including AI model providers, payment processors, and hosting/deployment platforms). Your use of those integrations may be subject to their own terms. We are not responsible for third-party services.' },

      { h: '8. Intellectual Property' },
      { p: `The Service, including its software, design, and trademarks, is owned by ${LEGAL_ENTITY} and protected by intellectual property laws. These Terms do not grant you any right to use our branding without prior written permission.` },

      { h: '9. Termination' },
      { p: 'You may stop using the Service at any time. We may suspend or terminate your access if you violate these Terms or if required by law. Upon termination, your right to use the Service ceases immediately.' },

      { h: '10. Disclaimers' },
      { p: 'The Service is provided "as is" and "as available" without warranties of any kind. AI-generated output may be inaccurate, incomplete, or unsuitable for your purpose. You are responsible for reviewing and validating any output before relying on it.' },

      { h: '11. Limitation of Liability' },
      { p: `To the maximum extent permitted by law, ${LEGAL_ENTITY} shall not be liable for any indirect, incidental, special, consequential, or punitive damages, or any loss of profits or data, arising from your use of the Service. Our total liability shall not exceed the amount you paid us in the twelve months preceding the claim.` },

      { h: '12. Governing Law' },
      { p: `These Terms are governed by the laws of ${JURISDICTION}, without regard to conflict-of-law principles. Any disputes shall be subject to the exclusive jurisdiction of the courts located there.` },

      { h: '13. Changes to These Terms' },
      { p: 'We may update these Terms from time to time. We will post the updated version with a new "Last updated" date. Material changes will be communicated where appropriate.' },

      { h: '14. Contact' },
      { p: `Questions about these Terms? Contact us at ${CONTACT_EMAIL}.` },
    ],
  },

  {
    slug: 'privacy',
    title: 'Privacy Policy',
    short: 'Privacy',
    blocks: [
      { p: `This Privacy Policy explains how ${LEGAL_ENTITY} ("${COMPANY}", "we", "us") collects, uses, and protects your personal information when you use the Service. We are committed to protecting your privacy.` },

      { h: '1. Information We Collect' },
      { list: [
        'Account information: name, email address, and password (stored hashed).',
        'Content: prompts, projects, code, and files you create or upload.',
        'Payment information: processed by our payment provider; we do not store full card numbers.',
        'Usage data: log data, device and browser information, IP address, and interactions with the Service.',
        'Cookies and similar technologies (see our Cookie Policy).',
      ] },

      { h: '2. How We Use Your Information' },
      { list: [
        'To provide, operate, and maintain the Service.',
        'To process payments and manage subscriptions.',
        'To improve, personalize, and develop new features.',
        'To communicate with you about your account, updates, and support.',
        'To detect, prevent, and address fraud, abuse, and security issues.',
        'To comply with legal obligations.',
      ] },

      { h: '3. AI Processing' },
      { p: 'To generate output, your prompts and relevant content may be sent to third-party AI model providers. We take reasonable steps to work with providers that maintain appropriate data protection standards. We do not sell your personal information.' },

      { h: '4. Legal Bases (GDPR)' },
      { p: 'Where applicable, we process personal data on the basis of contract performance, our legitimate interests, your consent, and compliance with legal obligations.' },

      { h: '5. Data Sharing' },
      { p: 'We share data with service providers (hosting, analytics, payment, AI, email) strictly to operate the Service, and when required by law or to protect our rights. We do not sell personal data.' },

      { h: '6. Data Retention' },
      { p: 'We retain your information for as long as your account is active or as needed to provide the Service, comply with legal obligations, resolve disputes, and enforce our agreements.' },

      { h: '7. Security' },
      { p: 'We implement technical and organizational measures to protect your data, including encryption of sensitive credentials at rest. No method of transmission or storage is 100% secure, and we cannot guarantee absolute security.' },

      { h: '8. Your Rights' },
      { list: [
        'Access, correct, or delete your personal data.',
        'Object to or restrict certain processing.',
        'Data portability where applicable.',
        'Withdraw consent at any time.',
        'Lodge a complaint with a supervisory authority.',
      ] },

      { h: '9. International Transfers' },
      { p: 'Your information may be processed in countries other than your own. Where required, we use appropriate safeguards for such transfers.' },

      { h: "10. Children's Privacy" },
      { p: 'The Service is not directed to children under 13, and we do not knowingly collect data from them. If you believe a child has provided us data, contact us and we will delete it.' },

      { h: '11. Changes to This Policy' },
      { p: 'We may update this Privacy Policy from time to time. We will post the updated version with a new "Last updated" date.' },

      { h: '12. Contact' },
      { p: `For privacy requests or questions, contact us at ${CONTACT_EMAIL}.` },
    ],
  },

  {
    slug: 'cookies',
    title: 'Cookie Policy',
    short: 'Cookies',
    blocks: [
      { p: `This Cookie Policy explains how ${COMPANY} uses cookies and similar technologies when you visit ${WEBSITE} or use the Service.` },

      { h: '1. What Are Cookies?' },
      { p: 'Cookies are small text files stored on your device that help websites function and remember information about your visit. We also use similar technologies such as local storage and pixels.' },

      { h: '2. Types of Cookies We Use' },
      { list: [
        'Essential cookies: required for authentication, security, and core functionality (e.g. keeping you signed in).',
        'Preference cookies: remember your settings such as theme (dark/light).',
        'Analytics cookies: help us understand how the Service is used so we can improve it.',
        'Payment cookies: set by our payment provider to process transactions securely.',
      ] },

      { h: '3. Managing Cookies' },
      { p: 'You can control and delete cookies through your browser settings. Blocking essential cookies may prevent parts of the Service from working correctly.' },

      { h: '4. Third-Party Cookies' },
      { p: 'Some cookies are set by third-party services we use (such as analytics and payment providers). Their use of cookies is governed by their own policies.' },

      { h: '5. Changes to This Policy' },
      { p: 'We may update this Cookie Policy periodically. The "Last updated" date reflects the latest revision.' },

      { h: '6. Contact' },
      { p: `Questions about cookies? Contact us at ${CONTACT_EMAIL}.` },
    ],
  },

  {
    slug: 'refund',
    title: 'Refund Policy',
    short: 'Refunds',
    blocks: [
      { p: `This Refund Policy describes when and how you may be eligible for a refund for purchases made on ${COMPANY}.` },

      { h: '1. Subscriptions' },
      { p: 'Subscription fees are billed in advance and are generally non-refundable, except where required by applicable law. You may cancel at any time; cancellation stops future renewals, and you retain access until the end of the current billing period.' },

      { h: '2. Tokens & Credits' },
      { p: 'Tokens, credits, or other consumable units are non-refundable once purchased, and unused amounts are not redeemable for cash, except where required by law.' },

      { h: '3. Eligibility for a Refund' },
      { list: [
        'You were charged in error or charged more than once for the same purchase.',
        'A technical fault on our side prevented you from using a paid feature and we were unable to resolve it within a reasonable time.',
        'A refund is required under applicable consumer protection law.',
      ] },

      { h: '4. How to Request a Refund' },
      { p: `To request a refund, contact ${SUPPORT_EMAIL} within 14 days of the charge, including your account email and the transaction details. We review each request individually.` },

      { h: '5. Processing' },
      { p: 'Approved refunds are issued to the original payment method. Processing times depend on your payment provider and typically take 5–10 business days.' },

      { h: '6. Chargebacks' },
      { p: 'If you initiate a chargeback without first contacting us, we may suspend your account while the dispute is resolved. We encourage you to reach out to us first so we can help.' },

      { h: '7. Contact' },
      { p: `For billing and refund questions, contact ${SUPPORT_EMAIL}.` },
    ],
  },

  {
    slug: 'acceptable-use',
    title: 'Acceptable Use Policy',
    short: 'Acceptable Use',
    blocks: [
      { p: `This Acceptable Use Policy ("AUP") sets out the rules for using ${COMPANY}. It applies to everyone who accesses the Service. Violations may result in suspension or termination.` },

      { h: '1. Prohibited Activities' },
      { p: 'You may not use the Service to create, host, or distribute content or applications that:' },
      { list: [
        'Are illegal, or that promote or facilitate illegal activity.',
        'Infringe intellectual property, privacy, or other rights of others.',
        'Contain malware, phishing, or other malicious code.',
        'Are sexually explicit involving minors, or that exploit or endanger children.',
        'Harass, threaten, defame, or incite violence or hatred against others.',
        'Spread deliberate misinformation, fraud, or deceptive schemes.',
        'Generate spam or unsolicited bulk communications.',
      ] },

      { h: '2. Platform Integrity' },
      { list: [
        'Do not attempt to reverse-engineer, decompile, or bypass security controls.',
        'Do not probe, scan, or test the vulnerability of the Service without authorization.',
        'Do not overload, disrupt, or interfere with the Service or its infrastructure.',
        'Do not use bots or automated means to abuse rate limits, credits, or free tiers.',
        'Do not resell or sublicense the Service without authorization.',
      ] },

      { h: '3. Responsible AI Use' },
      { p: 'You are responsible for how you use AI-generated output. Do not use the Service to generate content intended to deceive, impersonate, or cause harm. Always review output before publishing or relying on it.' },

      { h: '4. Enforcement' },
      { p: 'We may investigate suspected violations and take action, including removing content, suspending or terminating accounts, and cooperating with law enforcement where appropriate.' },

      { h: '5. Reporting Abuse' },
      { p: `To report a violation of this AUP, contact ${SUPPORT_EMAIL}.` },
    ],
  },

  {
    slug: 'legal-notice',
    title: 'Legal Notice & Contact',
    short: 'Legal Notice',
    blocks: [
      { h: 'Publisher' },
      { p: `The Service is published and operated by ${LEGAL_ENTITY}, incorporated in ${JURISDICTION}.` },

      { h: 'Website' },
      { p: `${WEBSITE}` },

      { h: 'Contact' },
      { list: [
        `General & legal: ${CONTACT_EMAIL}`,
        `Support & billing: ${SUPPORT_EMAIL}`,
      ] },

      { h: 'Hosting' },
      { p: 'The Service is hosted on managed cloud infrastructure provided by our hosting and deployment partners.' },

      { h: 'Intellectual Property' },
      { p: `All trademarks, logos, and brand elements displayed on the Service are the property of ${LEGAL_ENTITY} or their respective owners and may not be used without prior written permission.` },

      { h: 'Reporting a Concern' },
      { p: `For legal notices, intellectual property claims, or data requests, please contact ${CONTACT_EMAIL}.` },
    ],
  },
];

function getDoc(slug: string | undefined): LegalDoc | undefined {
  return LEGAL_DOCS.find((d) => d.slug === slug);
}

// ─── Page ────────────────────────────────────────────────────
export default function Legal() {
  const [, params] = useRoute('/legal/:doc');
  const [, navigate] = useLocation();
  const slug = params?.doc;
  const doc = getDoc(slug) || LEGAL_DOCS[0];

  useEffect(() => {
    window.scrollTo(0, 0);
  }, [slug]);

  return (
    <div className="min-h-screen w-full" style={{ background: 'var(--surface-0)', color: 'var(--text-primary)' }}>
      {/* Aligné à gauche (pas de mx-auto) : la page est déjà décalée par la
          barre latérale de l'app, un centrage en plus la poussait trop à droite. */}
      <div className="w-full max-w-5xl px-5 md:px-6 py-10 md:py-16">
        <div className="flex flex-col md:flex-row gap-8 md:gap-12">
          {/* Colonne de gauche : reste fixe au scroll (sticky dans le conteneur
              scrollable de <main>), seul le texte du document défile. */}
          {/* `md:top-16` = 64 px : la colonne se fige à la même hauteur qu'au
              chargement (py-16), pas collée au bord haut de la fenêtre. */}
          <aside className="md:w-56 shrink-0 md:sticky md:self-start md:top-16 md:max-h-[calc(100dvh-10rem)] md:overflow-y-auto">
            {/* Header */}
            <button
              onClick={() => navigate('/')}
              className="text-[13px] mb-8 inline-flex items-center gap-1.5 transition-colors hover:opacity-80"
              style={{ color: 'var(--text-dim)' }}
            >
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M19 12H5M12 19l-7-7 7-7" /></svg>
              Back to {COMPANY}
            </button>
            <div className="text-[11px] uppercase tracking-widest mb-3" style={{ color: 'var(--text-dim)' }}>Legal</div>
            <nav className="flex flex-col gap-1">
              {LEGAL_DOCS.map((d) => {
                const active = d.slug === doc.slug;
                return (
                  <button
                    key={d.slug}
                    onClick={() => navigate(`/legal/${d.slug}`)}
                    className="text-left text-[13px] px-3 py-2 rounded-md transition-colors"
                    style={{
                      background: active ? 'var(--surface-4, rgba(128,128,128,0.12))' : 'transparent',
                      color: active ? 'var(--text-primary)' : 'var(--text-secondary)',
                      fontWeight: active ? 600 : 400,
                    }}
                  >
                    {d.title}
                  </button>
                );
              })}
            </nav>
          </aside>

          {/* Content */}
          <article className="flex-1 min-w-0">
            <h1 className="text-3xl md:text-4xl font-semibold tracking-tight mb-2">{doc.title}</h1>
            <p className="text-[13px] mb-8" style={{ color: 'var(--text-dim)' }}>Last updated: {LAST_UPDATED}</p>

            <div className="flex flex-col gap-4 leading-relaxed">
              {doc.blocks.map((b, i) => {
                if ('h' in b) {
                  return <h2 key={i} className="text-lg md:text-xl font-semibold mt-5 mb-0" style={{ color: 'var(--text-primary)' }}>{b.h}</h2>;
                }
                if ('list' in b) {
                  return (
                    <ul key={i} className="flex flex-col gap-2 pl-5" style={{ listStyle: 'disc', color: 'var(--text-secondary)' }}>
                      {b.list.map((li, j) => (
                        <li key={j} className="text-[14.5px] leading-relaxed">{li}</li>
                      ))}
                    </ul>
                  );
                }
                return <p key={i} className="text-[14.5px]" style={{ color: 'var(--text-secondary)' }}>{b.p}</p>;
              })}
            </div>

            {/* Footer links */}
            <div className="mt-14 pt-6 flex flex-wrap gap-x-5 gap-y-2" style={{ borderTop: '1px solid var(--border-subtle)' }}>
              {LEGAL_DOCS.map((d) => (
                <button
                  key={d.slug}
                  onClick={() => navigate(`/legal/${d.slug}`)}
                  className="text-[12px] transition-colors hover:opacity-80"
                  style={{ color: 'var(--text-dim)' }}
                >
                  {d.title}
                </button>
              ))}
            </div>
            <p className="mt-6 text-[12px]" style={{ color: 'var(--text-dim)' }}>
              © {new Date().getFullYear()} {LEGAL_ENTITY}. All rights reserved.
            </p>
          </article>
        </div>
      </div>
    </div>
  );
}
