import { useEffect, useRef, useState } from 'react';
import { BRAND } from '../lib/brand';

// ─────────────────────────────────────────────────────────────
//  Guide de reprise du projet sur Runable — version web de RUNABLE.md
//  Route : /guide  (page autonome, sans sidebar applicative)
// ─────────────────────────────────────────────────────────────

const ACCENT = '#5EE9A8';

type SectionDef = { id: string; num: string; title: string };

const SECTIONS: SectionDef[] = [
  { id: 'quoi', num: '01', title: "Ce que c'est" },
  { id: 'demarrage', num: '02', title: 'Démarrage après un import' },
  { id: 'env', num: '03', title: "Variables d'environnement" },
  { id: 'regles', num: '04', title: 'Règles du template' },
  { id: 'etat', num: '05', title: 'État vérifié' },
  { id: 'dette', num: '06', title: 'Dette connue' },
];

// ─── Bloc de code avec bouton copier ─────────────────────────
function Code({ lines }: { lines: [string, string?][] }) {
  const [copied, setCopied] = useState(false);

  const copy = () => {
    const text = lines.map(([cmd]) => cmd).join('\n');
    navigator.clipboard?.writeText(text).then(
      () => {
        setCopied(true);
        window.setTimeout(() => setCopied(false), 1600);
      },
      () => undefined,
    );
  };

  return (
    <div className="group relative my-6 overflow-hidden rounded-lg border border-[#2C2C2C] bg-[#141414]">
      <div className="flex items-center justify-between border-b border-[#242424] px-4 py-2">
        <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-[#5C5C5C]">bash</span>
        <button
          type="button"
          onClick={copy}
          className="font-mono text-[10px] uppercase tracking-[0.14em] text-[#6E6E6E] transition-colors hover:text-[#E8E8E8]"
        >
          {copied ? 'copié ✓' : 'copier'}
        </button>
      </div>
      <pre className="overflow-x-auto px-4 py-4">
        <code className="font-mono text-[13px] leading-[1.85]">
          {lines.map(([cmd, comment], i) => (
            <div key={i} className="whitespace-pre">
              <span className="select-none text-[#3D3D3D]">$ </span>
              <span className="text-[#E8E8E8]">{cmd}</span>
              {comment ? <span className="text-[#5C5C5C]">{'  # ' + comment}</span> : null}
            </div>
          ))}
        </code>
      </pre>
    </div>
  );
}

// ─── En-tête de section ──────────────────────────────────────
function SectionHead({ num, title, id }: SectionDef) {
  return (
    <div className="mb-7 flex items-baseline gap-4">
      <span className="font-mono text-xs tracking-[0.2em]" style={{ color: ACCENT }}>
        {num}
      </span>
      <h2 id={id} className="scroll-mt-28 text-[26px] font-semibold leading-tight tracking-[-0.02em] text-[#F2F2F2]">
        {title}
      </h2>
    </div>
  );
}

function Section({ def, children }: { def: SectionDef; children: React.ReactNode }) {
  return (
    <section className="border-t border-[#242424] py-14 first:border-t-0">
      <SectionHead {...def} />
      <div className="max-w-[62ch] text-[15px] leading-[1.75] text-[#B4B4B4]">{children}</div>
    </section>
  );
}

function K({ children }: { children: React.ReactNode }) {
  return (
    <code className="rounded border border-[#2C2C2C] bg-[#1F1F1F] px-1.5 py-0.5 font-mono text-[12.5px] text-[#DCDCDC]">
      {children}
    </code>
  );
}

// ─── Page ────────────────────────────────────────────────────
export default function Guide() {
  const [active, setActive] = useState(SECTIONS[0].id);
  const mainRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    document.title = `Reprendre ${BRAND} sur Runable — Guide`;
  }, []);

  // Scroll-spy sur les titres de section
  useEffect(() => {
    const targets = SECTIONS.map((s) => document.getElementById(s.id)).filter(
      (el): el is HTMLElement => el !== null,
    );
    if (targets.length === 0) return;

    // Le conteneur de scroll est un parent en overflow-auto (layout de l'app),
    // pas la fenêtre : on écoute donc le premier ancêtre scrollable.
    let scroller: HTMLElement | Window = window;
    let node: HTMLElement | null = mainRef.current;
    while (node) {
      const oy = getComputedStyle(node).overflowY;
      if ((oy === 'auto' || oy === 'scroll') && node.scrollHeight > node.clientHeight + 8) {
        scroller = node;
        break;
      }
      node = node.parentElement;
    }

    const compute = () => {
      const line = 140; // ligne de lecture sous le haut du viewport
      let current = targets[0].id;
      for (const t of targets) {
        if (t.getBoundingClientRect().top - line <= 0) current = t.id;
      }
      setActive(current);
    };

    compute();
    scroller.addEventListener('scroll', compute, { passive: true });
    window.addEventListener('resize', compute);
    return () => {
      scroller.removeEventListener('scroll', compute);
      window.removeEventListener('resize', compute);
    };
  }, []);

  const jump = (id: string) => {
    document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  return (
    <div className="min-h-screen bg-[#1A1A1A] text-[#E8E8E8]">
      {/* halo décoratif */}
      <div
        aria-hidden
        className="pointer-events-none fixed inset-x-0 top-0 h-[420px] opacity-[0.55]"
        style={{
          background:
            'radial-gradient(60% 100% at 18% 0%, rgba(94,233,168,0.10) 0%, rgba(94,233,168,0) 70%)',
        }}
      />

      <div className="relative mx-auto max-w-[1180px] px-6 md:px-10">
        {/* ── Hero ── */}
        <header className="pt-16 pb-4 md:pt-24">
          <div className="mb-6 flex flex-wrap items-center gap-2.5">
            <span
              className="rounded-full border px-3 py-1 font-mono text-[10px] uppercase tracking-[0.16em]"
              style={{ borderColor: 'rgba(94,233,168,0.3)', color: ACCENT }}
            >
              Vérifié · 3 août 2026
            </span>
            <span className="rounded-full border border-[#2C2C2C] px-3 py-1 font-mono text-[10px] uppercase tracking-[0.16em] text-[#7A7A7A]">
              Monorepo Bun
            </span>
            <span className="rounded-full border border-[#2C2C2C] px-3 py-1 font-mono text-[10px] uppercase tracking-[0.16em] text-[#7A7A7A]">
              Template managé
            </span>
          </div>

          <h1 className="max-w-[20ch] text-[44px] font-bold leading-[1.04] tracking-[-0.035em] text-[#F5F5F5] md:text-[68px]">
            Reprendre <span style={{ color: ACCENT }}>{BRAND}</span> sur Runable.
          </h1>

          <p className="mt-6 max-w-[58ch] text-[17px] leading-[1.7] text-[#9C9C9C]">
            Tout ce qu'il faut pour que le projet reparte proprement après un export / ré-import
            GitHub → Runable, sans rien deviner.
          </p>
        </header>

        {/* ── Corps : TOC + contenu ── */}
        <div className="flex gap-14 pb-[42vh] pt-10">
          {/* TOC */}
          <aside className="hidden w-[210px] shrink-0 lg:block">
            <nav className="sticky top-16">
              <p className="mb-4 font-mono text-[10px] uppercase tracking-[0.2em] text-[#5C5C5C]">
                Sommaire
              </p>
              <ul className="space-y-0.5">
                {SECTIONS.map((s) => {
                  const on = active === s.id;
                  return (
                    <li key={s.id}>
                      <button
                        type="button"
                        onClick={() => jump(s.id)}
                        className="flex w-full items-baseline gap-2.5 border-l py-1.5 pl-3 text-left text-[13.5px] leading-snug transition-colors"
                        style={{
                          borderColor: on ? ACCENT : '#2A2A2A',
                          color: on ? '#F0F0F0' : '#787878',
                        }}
                      >
                        <span className="font-mono text-[10px] text-[#4A4A4A]">{s.num}</span>
                        <span>{s.title}</span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            </nav>
          </aside>

          {/* Contenu */}
          <main ref={mainRef} className="min-w-0 flex-1">
            {/* 01 */}
            <Section def={SECTIONS[0]}>
              <p>
                Monorepo Bun (workspaces + Turborepo), sur le template managé Runable. Trois
                packages, une seule base de code.
              </p>

              <div className="mt-7 overflow-hidden rounded-lg border border-[#2A2A2A]">
                <table className="w-full text-left text-[13.5px]">
                  <thead>
                    <tr className="border-b border-[#2A2A2A] bg-[#1F1F1F]">
                      <th className="px-4 py-3 font-mono text-[10px] uppercase tracking-[0.14em] text-[#6E6E6E]">
                        Package
                      </th>
                      <th className="px-4 py-3 font-mono text-[10px] uppercase tracking-[0.14em] text-[#6E6E6E]">
                        Rôle
                      </th>
                      <th className="px-4 py-3 font-mono text-[10px] uppercase tracking-[0.14em] text-[#6E6E6E]">
                        Techno
                      </th>
                    </tr>
                  </thead>
                  <tbody className="text-[#A8A8A8]">
                    {[
                      [
                        'packages/web',
                        'frontend et API sur un seul port',
                        'Vite 7 · React 19 · Hono · Drizzle (Turso)',
                      ],
                      ['packages/mobile', 'app mobile', 'Expo SDK 54 · expo-router'],
                      ['packages/desktop', 'coque desktop (charge le web)', 'Electron · Vite'],
                    ].map(([pkg, role, tech]) => (
                      <tr key={pkg} className="border-b border-[#242424] last:border-b-0">
                        <td className="px-4 py-3 align-top">
                          <span className="font-mono text-[12.5px] text-[#E0E0E0]">{pkg}</span>
                        </td>
                        <td className="px-4 py-3 align-top">{role}</td>
                        <td className="px-4 py-3 align-top">{tech}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <p className="mt-6">
                Le serveur web sert le front sur <K>/*</K> et l'API sur <K>/api/*</K> via le plugin{' '}
                <K>vite/plugins/hono-dev-plugin.ts</K>.
              </p>
            </Section>

            {/* 02 */}
            <Section def={SECTIONS[1]}>
              <p>Quatre commandes, dans cet ordre :</p>
              <Code
                lines={[
                  ['bun install', 'installe tout le monorepo (bun.lock est committé)'],
                  ['cp .env.template .env', 'puis remplir les valeurs — voir section 03'],
                  ['cd packages/web && bun run db:push && cd ../..', 'crée/actualise les tables Turso'],
                  ['bun run dev', 'web + API sur http://localhost:4200'],
                ]}
              />

              <h3 className="mt-10 mb-1 text-[15px] font-semibold text-[#E8E8E8]">
                Autres commandes (depuis la racine)
              </h3>
              <Code
                lines={[
                  ['bun run dev --port 4500', 'changer de port'],
                  ['bun run build', 'build de prod (web + desktop)'],
                  ['bun run lint', 'eslint (packages/web)'],
                  ['bun run typecheck', 'tsc des packages'],
                  ['bun run start', 'prod via pm2 (ecosystem.config.cjs)'],
                  ['bun run kill:port', 'libère le port 4200'],
                  ['bun run dev:mobile', 'Expo'],
                  ['bun run dev:desktop', 'Electron'],
                ]}
              />

              <h3 className="mt-10 mb-1 text-[15px] font-semibold text-[#E8E8E8]">
                Sur Runable, le dev tourne dans tmux
              </h3>
              <Code
                lines={[
                  ['tmux new-session -d -s website_4200 -c $(pwd) "bun run dev"'],
                  ['tmux capture-pane -pt website_4200 -S -30', 'voir les logs'],
                ]}
              />
            </Section>

            {/* 03 */}
            <Section def={SECTIONS[2]}>
              <ul className="space-y-3">
                <li className="flex gap-3">
                  <span style={{ color: ACCENT }}>—</span>
                  <span>
                    <strong className="font-semibold text-[#E4E4E4]">
                      Un seul fichier : <K>.env</K> à la racine
                    </strong>{' '}
                    (chargé automatiquement par Bun et Vite). Ne jamais créer <K>.env.local</K>,{' '}
                    <K>.env.production</K>, etc. : elles ne sont pas déployées.
                  </span>
                </li>
                <li className="flex gap-3">
                  <span style={{ color: ACCENT }}>—</span>
                  <span>
                    <K>.env</K> est volontairement hors git. <K>.env.template</K> liste{' '}
                    <em>toutes</em> les clés utilisées par le code, avec commentaires. Les clés
                    commentées sont optionnelles : la fonctionnalité se désactive proprement si
                    elles sont vides.
                  </span>
                </li>
              </ul>

              <h3 className="mt-9 mb-4 text-[15px] font-semibold text-[#E8E8E8]">
                Minimum pour démarrer
              </h3>
              <div className="overflow-hidden rounded-lg border border-[#2A2A2A]">
                <table className="w-full text-left text-[13.5px]">
                  <tbody className="text-[#A8A8A8]">
                    {[
                      ['DATABASE_URL, DATABASE_AUTH_TOKEN', 'base Turso (sinon aucune donnée)'],
                      ['AI_GATEWAY_BASE_URL, AI_GATEWAY_API_KEY', 'tous les agents IA'],
                      ['BETTER_AUTH_SECRET', 'sessions / auth'],
                      ['ADMIN_EMAILS', 'accès aux pages admin'],
                      ['S3_*', 'upload de fichiers (Tigris)'],
                      ['SECRET_STORE_KEY', 'chiffrement du coffre de clés API (prod)'],
                    ].map(([key, why]) => (
                      <tr key={key} className="border-b border-[#242424] last:border-b-0">
                        <td className="w-[46%] px-4 py-3 align-top">
                          <span className="font-mono text-[12.5px]" style={{ color: ACCENT }}>
                            {key}
                          </span>
                        </td>
                        <td className="px-4 py-3 align-top">{why}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <div className="mt-7 rounded-lg border-l-2 bg-[#1F1F1F] p-5" style={{ borderColor: ACCENT }}>
                <p className="text-[14px] leading-relaxed text-[#B8B8B8]">
                  Sur Runable, <K>APPLICATION_ID</K>, <K>VITE_APPLICATION_ID</K>,{' '}
                  <K>VITE_RUNABLE_AUTH_ISSUER</K>, <K>RUNABLE_URL</K>, <K>DATABASE_*</K> et{' '}
                  <K>S3_*</K> sont fournis par la plateforme au moment de l'import.{' '}
                  <strong className="font-semibold text-[#E4E4E4]">
                    Ne pas les écrire en dur.
                  </strong>
                </p>
              </div>
            </Section>

            {/* 04 */}
            <Section def={SECTIONS[3]}>
              <p className="mb-6">
                Si l'une de ces règles est violée, <K>bun run lint</K> casse.
              </p>
              <ol className="space-y-5">
                {[
                  <>
                    Les fichiers/dossiers préfixés <K>__</K> (<K>__core/</K>, <K>__client.ts</K>,{' '}
                    <K>vite/__plugins/</K>, <K>__lint-rules/</K>) sont gérés par la plateforme : ne
                    pas les modifier, supprimer ou en créer. Intégrité vérifiée par sha256 via{' '}
                    <K>.runable/protected-files.json</K>.
                  </>,
                  <>
                    Tous les assets web (images, vidéos, polices, audio) vont dans{' '}
                    <K>packages/web/public/</K> et sont référencés par URL absolue (
                    <K>/images/x.png</K>), jamais importés depuis le code.
                  </>,
                  <>
                    Une feature d'API = un fichier dans <K>packages/web/src/api/routes/</K>, composé
                    dans <K>src/api/index.ts</K>. Les <K>index.ts</K> ne font que composer /
                    réexporter.
                  </>,
                  <>Les routes HTTP brutes ne servent qu'aux webhooks et au streaming.</>,
                  <>
                    Ne pas retirer l'analytics (<K>vite/plugins/runable-analytics-plugin.ts</K>).
                  </>,
                ].map((item, i) => (
                  <li key={i} className="flex gap-4">
                    <span className="mt-0.5 font-mono text-[11px] text-[#4A4A4A]">
                      {String(i + 1).padStart(2, '0')}
                    </span>
                    <span>{item}</span>
                  </li>
                ))}
              </ol>
            </Section>

            {/* 05 */}
            <Section def={SECTIONS[4]}>
              <div className="grid gap-3 sm:grid-cols-2">
                {[
                  ['bun run build', 'OK (web + desktop)'],
                  ['bun run lint', 'OK — 0 erreur, warnings hérités'],
                  ['Fichiers protégés __', 'conformes au manifeste'],
                  ['Serveur dev', 'HTTP 200 sur localhost:4200'],
                ].map(([what, status]) => (
                  <div
                    key={what}
                    className="rounded-lg border border-[#2A2A2A] bg-[#1F1F1F] p-4"
                  >
                    <div className="mb-1.5 flex items-center gap-2">
                      <span
                        className="grid h-4 w-4 place-items-center rounded-full text-[9px] font-bold text-[#0F1F18]"
                        style={{ background: ACCENT }}
                      >
                        ✓
                      </span>
                      <span className="font-mono text-[12px] text-[#E0E0E0]">{what}</span>
                    </div>
                    <p className="pl-6 text-[13px] text-[#8E8E8E]">{status}</p>
                  </div>
                ))}
              </div>
            </Section>

            {/* 06 */}
            <Section def={SECTIONS[5]}>
              <p className="mb-6">Not blocking execution, but good to know.</p>

              <div className="space-y-4">
                <div className="rounded-lg border border-[#3A3120] bg-[#211C14] p-5">
                  <p className="mb-2 font-mono text-[11px] uppercase tracking-[0.14em] text-[#D9A84E]">
                    Types de l'API non couverts
                  </p>
                  <p className="text-[14px] leading-relaxed text-[#AFAFAF]">
                    <K>packages/web/src/api</K> n'est pas couvert par <K>tsc</K> dans le build (le{' '}
                    <K>tsconfig.app.json</K> n'inclut que <K>src/web</K>). Le check existe à part :{' '}
                    <K>cd packages/web && bun run typecheck:api</K> → ~77 erreurs de types héritées,
                    surtout dans <K>src/api/index.ts</K>. Le runtime n'est pas affecté (Bun/Vite
                    transpilent sans vérif de types), mais le <K>typecheck</K> du package mobile
                    échoue à cause de ces types.
                  </p>
                </div>

                <div className="rounded-lg border border-[#3A3120] bg-[#211C14] p-5">
                  <p className="mb-2 font-mono text-[11px] uppercase tracking-[0.14em] text-[#D9A84E]">
                    Dépôt lourd — ~660 Mo
                  </p>
                  <p className="text-[14px] leading-relaxed text-[#AFAFAF]">
                    Les rendus vidéo (<K>frames_in/</K>, <K>frames_out/</K>, <K>frames_s1/</K>, ~430
                    Mo de PNG) sont suivis par git, ce qui ralentit fortement clone et export. Rien
                    n'a été supprimé ; on peut les sortir du suivi git (fichiers conservés sur le
                    disque) sur demande.
                  </p>
                </div>
              </div>
            </Section>

            <footer className="border-t border-[#242424] pt-8">
              <p className="font-mono text-[11px] uppercase tracking-[0.16em] text-[#5C5C5C]">
                Source : RUNABLE.md · racine du dépôt
              </p>
            </footer>
          </main>
        </div>
      </div>
    </div>
  );
}
