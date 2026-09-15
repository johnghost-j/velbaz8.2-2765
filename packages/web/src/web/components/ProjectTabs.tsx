import { Link, useLocation } from 'wouter';
import { useBuildStore } from '../lib/build-store';

/**
 * [2026-09-05 bug 19] Badge « genesis ».
 * Posé À DROITE des boutons Chat / Dashboard du chat (pas dans la barre
 * latérale). Il n'apparaît que si la commande /genesis pilote réellement le
 * projet ouvert (`genesisMode`, posé et retiré par le chat lui-même). Aucun
 * état inventé : pas de badge = pas de mode genesis.
 */
function GenesisBadge() {
  return (
    <span
      title="mode genesis actif"
      className="text-[10px] font-semibold uppercase px-2 py-1 rounded-md"
      style={{
        color: 'var(--text-primary)',
        background: 'var(--surface-4)',
        border: '1px solid var(--border-hover)',
        letterSpacing: '0.08em',
        lineHeight: 1,
      }}
    >
      genesis
    </span>
  );
}

export function ProjectTabs({ projectId, active }: { projectId: string; active: 'chat' | 'dashboard' }) {
  const genesisMode = useBuildStore((st) => st.genesisMode);
  const tabs = [
    { key: 'chat', label: 'Chat', href: `/chat/${projectId}`, icon: <ChatIcon /> },
    { key: 'dashboard', label: 'Dashboard', href: `/company/${projectId}`, icon: <DashboardIcon /> },
  ];

  return (
    <div className="inline-flex items-center gap-2">
    {/* [2026-09-15] Zones cliquables agrandies : ces onglets étaient hauts de
        26 px, difficiles à viser. Même dessin, plus de padding. */}
    <div className="inline-flex rounded-xl p-1" style={{ background: 'var(--surface-1)', border: '1px solid var(--border-subtle)' }}>
      {tabs.map(t => (
        <Link key={t.key} href={t.href}>
          <button
            className="flex items-center gap-2 px-4 py-2 text-[13px] font-medium rounded-lg transition-colors"
            style={
              active === t.key
                ? { background: 'var(--surface-5)', color: 'var(--text-primary)' }
                : { color: 'var(--text-ghost)' }
            }
            onMouseEnter={e => { if (active !== t.key) e.currentTarget.style.color = 'var(--text-muted)'; }}
            onMouseLeave={e => { if (active !== t.key) e.currentTarget.style.color = 'var(--text-ghost)'; }}
          >
            <span className="shrink-0 opacity-80">{t.icon}</span>
            {t.label}
          </button>
        </Link>
      ))}
    </div>
    {genesisMode && <GenesisBadge />}
    </div>
  );
}

function ChatIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round">
      <path d="M2 3H14V11H9L6 14V11H2V3Z" />
    </svg>
  );
}

function DashboardIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round">
      <rect x="1.5" y="1.5" width="5" height="5" rx="1" />
      <rect x="9.5" y="1.5" width="5" height="5" rx="1" />
      <rect x="1.5" y="9.5" width="5" height="5" rx="1" />
      <rect x="9.5" y="9.5" width="5" height="5" rx="1" />
    </svg>
  );
}
