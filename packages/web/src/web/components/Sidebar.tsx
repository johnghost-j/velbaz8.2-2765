import { Link, useLocation } from 'wouter';
import { useAuth, isAdminUser } from '../lib/auth';
import { VerifiedBadge } from './ui/verified-badge';
import { useSidebar } from '../lib/sidebar';
import { useIsMobile, useIsTouch } from '../lib/useIsMobile';
import { useTheme } from '../lib/theme';
import { useEffect, useState, useRef, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { api } from '../lib/api';
import { SupportPanel } from './SupportPanel';
import { AnimatedThemeToggler } from './AnimatedThemeToggler';

/** Durée de l'animation de largeur de la barre (doit rester égale à `duration-200`). */
const SIDEBAR_ANIM_MS = 200;
/**
 * Moment où le contenu interne prend sa forme réduite, ~50 ms avant la fin des
 * 200 ms de la barre : le rendu React arrive ainsi pendant les dernières frames
 * de l'animation, donc quand la barre s'arrête tout est déjà en place (aucun
 * délai perceptible). Seule constante à ajuster si c'est trop tôt / trop tard.
 */
const SIDEBAR_CONTENT_SWITCH_MS = 150;

export function Sidebar() {
  const { user } = useAuth();
  const [location, navigate] = useLocation();
  const { collapsed: collapsedRaw, toggle, projects, setProjects, projectsLoaded, setProjectsLoaded, mobileOpen, setMobileOpen, mobileDrag, setMobileDrag } = useSidebar();
  const isMobile = useIsMobile();
  const isTouch = useIsTouch();
  const swipeOn = isMobile && isTouch;

  // ── Swipe vers la gauche pour fermer le drawer (quand il est ouvert) ──
  const closeTouch = useRef<{ x: number; y: number; active: boolean; dir: 'h' | 'v' | null }>({ x: 0, y: 0, active: false, dir: null });
  const onDrawerTouchStart = (e: React.TouchEvent) => {
    if (!swipeOn) return;
    const t = e.touches[0];
    closeTouch.current = { x: t.clientX, y: t.clientY, active: true, dir: null };
  };
  const onDrawerTouchMove = (e: React.TouchEvent) => {
    if (!swipeOn || !closeTouch.current.active) return;
    const t = e.touches[0];
    const dx = t.clientX - closeTouch.current.x;
    const dy = t.clientY - closeTouch.current.y;
    if (closeTouch.current.dir == null) {
      if (Math.abs(dx) < 8 && Math.abs(dy) < 8) return;
      closeTouch.current.dir = Math.abs(dx) > Math.abs(dy) ? 'h' : 'v';
    }
    if (closeTouch.current.dir !== 'h') return;
    // Ouvert (base = 1) : glisser vers la gauche (dx < 0) ferme. Suivi accéléré.
    const w = Math.min(window.innerWidth * 0.5, 200);
    const p = Math.max(0, Math.min(1, 1 + dx / w));
    setMobileDrag(p);
  };
  const onDrawerTouchEnd = () => {
    if (!closeTouch.current.active) return;
    const wasDragging = mobileDrag != null;
    closeTouch.current.active = false;
    closeTouch.current.dir = null;
    if (!wasDragging) return;
    const p = mobileDrag ?? 1;
    setMobileOpen(p > 0.75);
    setMobileDrag(null);
  };
  // Dans le drawer mobile on affiche toujours la version "étendue" (labels visibles)
  const collapsedTarget = isMobile ? false : collapsedRaw;
  // La barre met 200 ms à changer de largeur (transition-[width] duration-200).
  // Le contenu interne (labels, historique de projets, boutons) ne doit PAS
  // basculer en mode réduit avant la fin de cette animation, sinon tout
  // rétrécit d'un coup alors que la barre, elle, est encore en train de se
  // fermer. On décale donc le basculement du contenu de la durée exacte de
  // l'animation à la fermeture (la barre rogne progressivement le contenu,
  // overflow: hidden), et on bascule immédiatement à l'ouverture pour que le
  // contenu se dévoile au même rythme que la barre s'élargit.
  const [collapsedContent, setCollapsedContent] = useState(collapsedTarget);
  useEffect(() => {
    if (!collapsedTarget) { setCollapsedContent(false); return; }
    const id = setTimeout(() => setCollapsedContent(true), SIDEBAR_CONTENT_SWITCH_MS);
    return () => clearTimeout(id);
  }, [collapsedTarget]);
  const collapsed = collapsedContent;
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState('');
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const editInputRef = useRef<HTMLInputElement>(null);

  // ── Section repliable (chevron à côté de "Projects") ──
  const [projectsOpen, setProjectsOpen] = useState(true);

  const handleRename = useCallback(async (id: string) => {
    const trimmed = editName.trim();
    if (!trimmed) { setEditingId(null); return; }
    try {
      await api.companies.rename(id, trimmed);
      setProjects(projects.map(p => p.id === id ? { ...p, name: trimmed } : p));
    } catch {}
    setEditingId(null);
  }, [editName, projects, setProjects]);

  const handleDelete = useCallback((id: string) => {
    // Optimistic: remove from UI immediately
    setProjects(projects.filter(p => p.id !== id));
    setDeletingId(null);
    if (location === `/chat/${id}` || location === `/company/${id}`) navigate('/');
    // Fire API in background
    api.companies.delete(id).catch(() => {});
  }, [projects, setProjects, location, navigate]);

  useEffect(() => {
    if (editingId && editInputRef.current) editInputRef.current.focus();
  }, [editingId]);

  const isActive = (path: string) => location === path;

  // Ferme le drawer mobile quand on change de page
  useEffect(() => { setMobileOpen(false); }, [location]);

  useEffect(() => {
    if (user) {
      api.companies.list().then((res: any) => {
        if (res.companies) {
          setProjects(res.companies.map((c: any) => ({
            id: c.id,
            name: c.name,
            logo: c.logo || '',
            createdAt: new Date(c.created_at),
          })));
        }
      }).catch(() => {}).finally(() => setProjectsLoaded(true));
    }
  }, [user]);

  // ===== MOBILE : plus de barre en haut =====
  // Demande explicite : le bandeau plein largeur (52px, wordmark "velbaz") a été
  // supprimé, il mangeait de la hauteur pour rien sur téléphone. Il ne reste
  // qu'un bouton menu flottant pour ouvrir le drawer (le swipe depuis le bord
  // gauche fonctionne aussi sur la home). Ne pas réintroduire de bandeau ni de
  // wordmark ici sans demande explicite.
  const mobileMenuButton = !mobileOpen && (
    <button
      onClick={() => setMobileOpen(true)}
      className="fixed flex items-center justify-center rounded-full"
      style={{
        top: 10,
        left: 10,
        zIndex: 60,
        width: 36,
        height: 36,
        color: 'var(--text-muted)',
        background: 'color-mix(in srgb, var(--surface-1) 72%, transparent)',
        backdropFilter: 'blur(8px)',
        WebkitBackdropFilter: 'blur(8px)',
        border: '1px solid var(--border-subtle)',
      }}
      aria-label="Open menu"
    >
      <svg width="20" height="20" viewBox="0 0 15 15" fill="none">
        <rect x="2" y="3" width="11" height="1.3" rx="0.65" fill="currentColor" />
        <rect x="2" y="6.85" width="11" height="1.3" rx="0.65" fill="currentColor" />
        <rect x="2" y="10.7" width="11" height="1.3" rx="0.65" fill="currentColor" />
      </svg>
    </button>
  );

  // Position du drawer mobile : suit le doigt pendant le swipe (mobileDrag 0..1),
  // sinon ouvert (0%) ou fermé (-100%).
  const mobileTransform = mobileDrag != null
    ? `translateX(calc(${mobileDrag} * 100% - 100%))`
    : (mobileOpen ? 'translateX(0)' : 'translateX(-100%)');

  const aside = (
    <aside
      onTouchStart={swipeOn ? onDrawerTouchStart : undefined}
      onTouchMove={swipeOn ? onDrawerTouchMove : undefined}
      onTouchEnd={swipeOn ? onDrawerTouchEnd : undefined}
      // Filet de sécurité : si la transition de largeur est coupée (ou absente,
      // ex. prefers-reduced-motion), on force l'état final du contenu.
      onTransitionEnd={(e) => {
        if (e.propertyName === 'width' && e.target === e.currentTarget) setCollapsedContent(collapsedTarget);
      }}
      className={isMobile
        ? 'fixed left-0 top-0 bottom-0 z-[70] flex flex-col'
        : 'fixed left-0 top-0 bottom-0 z-40 flex flex-col transition-[width] duration-200'}
      style={isMobile
        ? {
            width: '100vw',
            background: 'var(--surface-1)',
            overflow: 'hidden',
            transform: mobileTransform,
            transition: mobileDrag != null ? 'none' : 'transform 0.3s cubic-bezier(0.32, 0.72, 0, 1)',
            willChange: 'transform',
          }
        : {
            // Largeur revenue à une taille normale : les lignes, icônes et
            // libellés sont sobres, 248px suffisent sans couper les noms.
            width: collapsedTarget ? 48 : 248,
            background: 'var(--surface-1)',
            borderRight: '1px solid var(--border-subtle)',
            overflow: 'hidden',
          }}
    >
      {/* Top row */}
      <div
        className="flex items-center"
        style={{
          justifyContent: collapsed ? 'center' : 'space-between',
          padding: isMobile ? '14px 16px' : '12px 10px 4px 10px',
          borderBottom: isMobile ? '1px solid var(--border-subtle)' : undefined,
        }}
      >
        {!collapsed && (
          <Link href="/">
            <span className="font-semibold tracking-tight cursor-pointer pl-1" style={{ color: 'var(--text-muted)', fontSize: isMobile ? 17 : 14 }}>
              velbaz
            </span>
          </Link>
        )}
        {/* Icône à droite : replier / fermer. */}
        <div className="flex items-center gap-0.5 shrink-0">
          <button
            onClick={() => { if (isMobile) setMobileOpen(false); else toggle(); }}
            className="flex items-center justify-center rounded-md transition-colors shrink-0"
            style={{ color: 'var(--text-ghost)', width: isMobile ? 38 : 28, height: isMobile ? 38 : 28 }}
            onMouseEnter={e => { e.currentTarget.style.color = 'var(--text-muted)'; e.currentTarget.style.background = 'var(--surface-5)'; }}
            onMouseLeave={e => { e.currentTarget.style.color = 'var(--text-ghost)'; e.currentTarget.style.background = 'transparent'; }}
            aria-label={isMobile ? 'Close menu' : 'Collapse menu'}
          >
            {isMobile ? (
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M5 12h14M13 6l6 6-6 6" />
              </svg>
            ) : (
              // Icône "panneau" de la maquette : un rectangle avec une barre à gauche.
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round">
                <rect x="1.75" y="2.75" width="12.5" height="10.5" rx="2.5" />
                <path d="M5.75 2.75V13.25" />
              </svg>
            )}
          </button>
        </div>
      </div>

      {/* Nav */}
      <nav className="flex-1 px-2 py-2 space-y-0.5 overflow-y-auto">
        <NavItem href="/" icon={<HomeIcon />} label="Home" active={isActive('/') || isActive('/chat')} collapsed={collapsed} />
        <NavItem href="/dashboard" icon={<DashboardIcon />} label="Dashboard" active={isActive('/dashboard')} collapsed={collapsed} />


        {/* En-tête "Projects ⌄" de la maquette : libellé discret en casse
            normale + chevron qui replie la liste. */}
        {!collapsed && (
          <button
            onClick={() => setProjectsOpen(o => !o)}
            className="w-full flex items-center gap-1 pt-4 pb-1 px-2 text-left"
            style={{ color: 'var(--border-hover)' }}
            onMouseEnter={e => { e.currentTarget.style.color = 'var(--text-dim)'; }}
            onMouseLeave={e => { e.currentTarget.style.color = 'var(--border-hover)'; }}
          >
            <span className="text-[13px]">Projects</span>
            <Chevron open={projectsOpen} />
          </button>
        )}
        {collapsed && <div className="my-3 mx-1" style={{ height: 1, background: 'var(--border-subtle)' }} />}

        <div className="relative" style={{ maxHeight: collapsed ? 'none' : `${4 * 32}px`, overflow: collapsed ? 'visible' : 'hidden', display: !collapsed && !projectsOpen ? 'none' : undefined }}>
          <div
            className="sidebar-projects-scroll"
            style={{
              maxHeight: collapsed ? 'none' : `${4 * 32}px`,
              overflowY: collapsed ? 'visible' as any : 'auto',
              maskImage: !collapsed && projects.length > 4 ? 'linear-gradient(to bottom, transparent 0px, black 8px, black calc(100% - 8px), transparent 100%)' : 'none',
              WebkitMaskImage: !collapsed && projects.length > 4 ? 'linear-gradient(to bottom, transparent 0px, black 8px, black calc(100% - 8px), transparent 100%)' : 'none',
            }}
          >
            {!projectsLoaded && projects.length === 0 && (
              <div className={collapsed ? 'flex flex-col items-center gap-2 py-1' : 'space-y-1.5 px-0.5 py-1'}>
                {[0, 1, 2].map((i) => (
                  <div key={i} className={`flex items-center gap-2 ${collapsed ? 'justify-center px-0' : 'px-2'}`}>
                    <span className="shrink-0 w-[16px] h-[16px] rounded animate-pulse" style={{ background: 'var(--surface-4)' }} />
                    {!collapsed && (
                      <span className="h-2.5 rounded animate-pulse" style={{ background: 'var(--surface-4)', width: `${70 - i * 12}%` }} />
                    )}
                  </div>
                ))}
              </div>
            )}
            {projects.map((p) => {
              const isProjectActive = location === `/chat/${p.id}` || location === `/company/${p.id}`;
              const isEditing = editingId === p.id;
              const isDeleting = deletingId === p.id;
              const isHovered = hoveredId === p.id;

              if (isDeleting) {
                return (
                  <div key={p.id} className="flex items-center gap-1.5 px-3 py-2 rounded-lg" style={{ background: 'var(--surface-5)' }}>
                    <span className="text-[13px] flex-1 truncate" style={{ color: 'var(--destructive, #ef4444)' }}>Delete?</span>
                    <button onClick={() => handleDelete(p.id)} className="text-[12px] px-2 py-1 rounded font-medium" style={{ background: 'var(--destructive, #ef4444)', color: '#fff' }}>Yes</button>
                    <button onClick={() => setDeletingId(null)} className="text-[12px] px-2 py-1 rounded font-medium" style={{ color: 'var(--text-dim)' }}>No</button>
                  </div>
                );
              }

              return (
                <div
                  key={p.id}
                  className={`group flex items-center gap-3 px-2.5 py-1.5 rounded-lg cursor-pointer transition-colors relative ${collapsed ? 'justify-center px-0' : ''}`}
                  style={{ background: isProjectActive ? 'var(--surface-5)' : undefined }}
                  onMouseEnter={e => { setHoveredId(p.id); if (!isProjectActive) e.currentTarget.style.background = 'var(--surface-3)'; }}
                  onMouseLeave={e => { setHoveredId(null); if (!isProjectActive) e.currentTarget.style.background = 'transparent'; }}
                  onClick={() => { if (!isEditing) navigate(`/chat/${p.id}`); }}
                >
                  <span className="shrink-0 w-[16px] h-[16px] flex items-center justify-center rounded text-[10px] font-bold overflow-hidden"
                    style={{
                      background: p.logo && !p.loading ? 'transparent' : 'var(--surface-4)',
                      color: isProjectActive ? 'var(--text-primary)' : 'var(--text-ghost)',
                    }}>
                    {p.loading ? (
                      <span className="inline-block w-2.5 h-2.5 rounded-full border-2 animate-spin"
                        style={{ borderColor: 'var(--teal)', borderTopColor: 'transparent' }} />
                    ) : p.logo ? (
                      <img src={p.logo} alt={p.name} className="w-[16px] h-[16px] rounded object-contain" />
                    ) : (
                      p.name[0]?.toUpperCase() || '?'
                    )}
                  </span>
                  {!collapsed && (
                    isEditing ? (
                      <input
                        ref={editInputRef}
                        value={editName}
                        onChange={e => setEditName(e.target.value)}
                        onBlur={() => handleRename(p.id)}
                        onKeyDown={e => { if (e.key === 'Enter') handleRename(p.id); if (e.key === 'Escape') setEditingId(null); }}
                        onClick={e => e.stopPropagation()}
                        className="text-[13px] bg-transparent outline-none flex-1 min-w-0 py-0 px-0"
                        style={{ color: 'var(--text-secondary)', borderBottom: '1px solid var(--teal)' }}
                      />
                    ) : (
                      <>
                        <span className={`text-[13px] truncate flex-1 min-w-0 ${isProjectActive ? 'font-medium' : ''} ${p.loading ? 'animate-pulse' : ''}`}
                          style={{ color: p.loading ? 'var(--text-ghost)' : isProjectActive ? 'var(--teal)' : 'var(--text-faint)', fontStyle: p.loading ? 'italic' : 'normal' }}>
                          {p.loading ? 'Generating name…' : p.name}
                        </span>
                        {isHovered && (
                          <div className="flex items-center gap-0.5 shrink-0" onClick={e => e.stopPropagation()}>
                            <button
                              onClick={() => { setEditingId(p.id); setEditName(p.name); }}
                              className="w-[24px] h-[24px] flex items-center justify-center rounded-md transition-colors"
                              style={{ color: 'var(--text-ghost)' }}
                              onMouseEnter={e => { e.currentTarget.style.color = 'var(--text-secondary)'; e.currentTarget.style.background = 'var(--surface-5)'; }}
                              onMouseLeave={e => { e.currentTarget.style.color = 'var(--text-ghost)'; e.currentTarget.style.background = 'transparent'; }}
                              title="Rename"
                            >
                              <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M11 2L14 5L5 14H2V11L11 2Z" /></svg>
                            </button>
                            <button
                              onClick={() => setDeletingId(p.id)}
                              className="w-[24px] h-[24px] flex items-center justify-center rounded-md transition-colors"
                              style={{ color: 'var(--text-ghost)' }}
                              onMouseEnter={e => { e.currentTarget.style.color = 'var(--destructive, #ef4444)'; e.currentTarget.style.background = 'var(--surface-5)'; }}
                              onMouseLeave={e => { e.currentTarget.style.color = 'var(--text-ghost)'; e.currentTarget.style.background = 'transparent'; }}
                              title="Delete"
                            >
                              <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M3 4H13M5.5 4V3C5.5 2.4 5.9 2 6.5 2H9.5C10.1 2 10.5 2.4 10.5 3V4M6 7V12M10 7V12M4 4L4.5 14H11.5L12 4" /></svg>
                            </button>
                          </div>
                        )}
                      </>
                    )
                  )}
                </div>
              );
            })}
          </div>
        </div>

        {!collapsed && projectsOpen && projectsLoaded && projects.length === 0 && (
          <div className="px-2.5 py-2">
            <span className="text-[13px] italic" style={{ color: 'var(--border-default)' }}>No projects yet</span>
          </div>
        )}


        {/* ─── Money Maker : usine à entreprises autonome (BÊTA PRIVÉE — admin uniquement) ─── */}
        {isAdminUser(user) && (
        <div className="pt-3">
          <Link href="/money-maker">
            <div
              className={`group flex items-center rounded-lg cursor-pointer transition-colors ${collapsed ? 'justify-center px-0 py-1.5' : 'gap-2.5 px-2.5 py-1.5'}`}
              style={{
                background: isActive('/money-maker') ? 'var(--surface-5)' : 'transparent',
                border: '1px solid',
                borderColor: isActive('/money-maker') ? 'var(--border-default)' : 'var(--border-subtle)',
              }}
              onMouseEnter={e => { if (!isActive('/money-maker')) e.currentTarget.style.background = 'var(--surface-3)'; }}
              onMouseLeave={e => { if (!isActive('/money-maker')) e.currentTarget.style.background = 'transparent'; }}
              title="Money Maker"
            >
              <span className="shrink-0 w-[16px] h-[16px] flex items-center justify-center" style={{ color: isActive('/money-maker') ? 'var(--text-primary)' : 'var(--text-faint)' }}>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M12 1v22M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6" />
                </svg>
              </span>
              {!collapsed && (
                <span className="text-[13px] font-medium truncate" style={{ color: isActive('/money-maker') ? 'var(--text-primary)' : 'var(--text-faint)' }}>Money Maker</span>
              )}
            </div>
          </Link>
        </div>
        )}
      </nav>

      {/* Bottom */}
      <div className="px-2 pb-3 space-y-1.5">

      {user && (!user.plan || user.plan === 'free') && (
          <Link href="/plans">
            <div
              className="rounded-lg cursor-pointer flex items-center overflow-hidden"
              style={{
                background: 'var(--surface-1)',
                border: '1px solid var(--border-subtle)',
                height: 38,
                justifyContent: collapsed ? 'center' : undefined,
                paddingLeft: collapsed ? undefined : 12,
                paddingRight: collapsed ? undefined : 12,
              }}
              onMouseEnter={e => e.currentTarget.style.background = 'var(--surface-5)'}
              onMouseLeave={e => e.currentTarget.style.background = 'var(--surface-1)'}
            >
              {collapsed ? (
                <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="var(--text-secondary)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M2 11L8 3L14 11" />
                  <path d="M5 11V14H11V11" />
                </svg>
              ) : (
                <span className="text-[13px] font-semibold" style={{ color: 'var(--text-secondary)' }}>Upgrade to Business</span>
              )}
            </div>
          </Link>
        )}

        {user ? (
          <ProfilePopup user={user} collapsed={collapsed} />
        ) : (
          <Link href="/login">
            <div className={`flex items-center gap-2.5 px-2.5 py-1.5 rounded-lg cursor-pointer transition-colors ${collapsed ? 'justify-center' : ''}`}
              onMouseEnter={e => e.currentTarget.style.background = 'var(--surface-5)'}
              onMouseLeave={e => e.currentTarget.style.background = 'transparent'}>
              <div className="w-[26px] h-[26px] rounded-full flex items-center justify-center shrink-0" style={{ background: 'var(--border-default)', color: 'var(--text-dim)', fontSize: 13 }}>?</div>
              {!collapsed && <span className="text-[13px]" style={{ color: 'var(--text-dim)' }}>Sign In</span>}
            </div>
          </Link>
        )}
      </div>
    </aside>
  );

  if (isMobile) {
    return (
      <>
        {mobileMenuButton}
        {/* Backdrop qui apparaît/disparaît en fondu, suit le swipe */}
        <div
          onClick={() => setMobileOpen(false)}
          style={{
            position: 'fixed',
            inset: 0,
            zIndex: 65,
            background: 'rgba(0,0,0,0.5)',
            opacity: mobileDrag != null ? mobileDrag : (mobileOpen ? 1 : 0),
            pointerEvents: mobileOpen ? 'auto' : 'none',
            transition: mobileDrag != null ? 'none' : 'opacity 0.3s ease',
          }}
        />
        {aside}
      </>
    );
  }

  return aside;
}

function NavItem({ href, icon, label, active, collapsed, sub }: { href: string; icon: React.ReactNode; label: string; active: boolean; collapsed: boolean; sub?: string }) {
  return (
    <Link href={href}>
      <div
        /* Ligne compacte : icône 16, libellé 13, padding vertical léger. */
        className={`flex items-center gap-2.5 px-2.5 py-1.5 rounded-lg cursor-pointer transition-colors ${collapsed ? 'justify-center px-0' : ''}`}
        style={{ background: active ? 'var(--surface-5)' : undefined }}
        onMouseEnter={e => { if (!active) e.currentTarget.style.background = 'var(--surface-3)'; }}
        onMouseLeave={e => { if (!active) e.currentTarget.style.background = 'transparent'; }}
      >
        <span className={`shrink-0 w-[16px] h-[16px] flex items-center justify-center`} style={{ color: active ? 'var(--text-primary)' : 'var(--text-ghost)' }}>
          {icon}
        </span>
        {!collapsed && (
          <div className="min-w-0">
            <span className={`text-[13px] ${active ? 'font-medium' : ''}`} style={{ color: active ? 'var(--teal)' : 'var(--text-dim)' }}>{label}</span>
            {sub && <div className="text-[11px]" style={{ color: 'var(--text-ghost)' }}>{sub}</div>}
          </div>
        )}
      </div>
    </Link>
  );
}

/** Petit chevron des en-têtes de section (pointe en bas ouvert, à droite replié). */
function Chevron({ open }: { open: boolean }) {
  return (
    <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"
      style={{ transform: open ? 'rotate(0deg)' : 'rotate(-90deg)', transition: 'transform 150ms ease' }}>
      <path d="M4 6.5L8 10.5L12 6.5" />
    </svg>
  );
}

function HomeIcon() {
  return <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round"><path d="M2.5 6.5L8 2L13.5 6.5V13.5H2.5V6.5Z" /><path d="M6 13.5V9H10V13.5" /></svg>;
}
function DashboardIcon() {
  return <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round"><rect x="1.5" y="1.5" width="5" height="5" rx="1" /><rect x="9.5" y="1.5" width="5" height="5" rx="1" /><rect x="1.5" y="9.5" width="5" height="5" rx="1" /><rect x="9.5" y="9.5" width="5" height="5" rx="1" /></svg>;
}
function DownloadIcon() {
  return <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round"><path d="M8 2V10M8 10L5 7M8 10L11 7" /><path d="M2 12V13H14V12" /></svg>;
}
function AffiliateIcon() {
  return <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round"><circle cx="8" cy="5" r="3" /><path d="M2 14C2 11.2 4.7 9 8 9C11.3 9 14 11.2 14 14" /></svg>;
}
function CommunityIcon() {
  return <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round"><circle cx="5.5" cy="5" r="2.5" /><circle cx="10.5" cy="5" r="2.5" /><path d="M1 13c0-2.5 2-4.5 4.5-4.5.8 0 1.5.2 2.2.5" /><path d="M15 13c0-2.5-2-4.5-4.5-4.5-.8 0-1.5.2-2.2.5" /></svg>;
}

function ProfilePopup({ user, collapsed }: { user: { name: string; email: string }; collapsed: boolean }) {
  const [open, setOpen] = useState(false);
  const [visible, setVisible] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const portalRef = useRef<HTMLDivElement>(null);
  const btnRef = useRef<HTMLDivElement>(null);
  const openTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [popupPos, setPopupPos] = useState<{ left: number; bottom: number }>({ left: 0, bottom: 0 });
  const [, navigate] = useLocation();
  const { logout, user: authUser } = useAuth();
  const { toggle: toggleTheme, resolved } = useTheme();
  const [supportOpen, setSupportOpen] = useState(false);

  // Le popup est monté en permanence (juste invisible) : au premier survol il n'y a donc
  // aucun montage de portail à attendre, et la position est calculée de façon synchrone.
  const handleMouseEnter = () => {
    if (closeTimer.current) { clearTimeout(closeTimer.current); closeTimer.current = null; }
    if (openTimer.current) { clearTimeout(openTimer.current); openTimer.current = null; }
    if (btnRef.current) {
      const rect = btnRef.current.getBoundingClientRect();
      setPopupPos({ left: rect.left, bottom: window.innerHeight - rect.top });
    }
    setOpen(true);
    setVisible(true);
  };
  const handleMouseLeave = () => {
    if (openTimer.current) { clearTimeout(openTimer.current); openTimer.current = null; }
    setVisible(false);
    closeTimer.current = setTimeout(() => setOpen(false), 180);
  };

  useEffect(() => () => {
    if (openTimer.current) clearTimeout(openTimer.current);
    if (closeTimer.current) clearTimeout(closeTimer.current);
  }, []);

  useEffect(() => {
    if (!open) return;
    function handleClick(e: MouseEvent) {
      const target = e.target as Node;
      // Don't close if click is inside the trigger OR inside the portal popup
      if (ref.current?.contains(target)) return;
      if (portalRef.current?.contains(target)) return;
      setOpen(false);
    }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [open]);

  // Navigate helper: close popup first, then navigate on next tick so React doesn't fight
  const navTo = (path: string) => {
    setVisible(false);
    setOpen(false);
    setTimeout(() => navigate(path), 0);
  };

  const items = [
    { icon: <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round"><circle cx="8" cy="5" r="3" /><path d="M2 14C2 11.2 4.7 9 8 9C11.3 9 14 11.2 14 14" /></svg>, label: 'Profile', action: () => navTo('/settings') },
    { icon: <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round"><circle cx="8" cy="8" r="6" /><path d="M8 5V8L10 10" /></svg>, label: 'Activity', action: () => navTo('/dashboard') },

    // Entrée thème : on réutilise tel quel le bouton <AnimatedThemeToggler />
    // de la page Settings (même animation, même hover/tap). Rendu à part plus
    // bas car ce n'est pas une icône dans un <button>, c'est le bouton lui-même.
    { theme: true },
    { icon: <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round"><path d="M13.5 5.5L8 2L2.5 5.5V10.5L8 14L13.5 10.5V5.5Z" /><path d="M8 8V14M8 8L2.5 5.5M8 8L13.5 5.5" /></svg>, label: 'Plans', action: () => navTo('/plans') },

    { divider: true },
    { icon: <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round"><path d="M14 8.5A6 6 0 1 1 6.5 2.6L4.5 11l4.8-1.2A6 6 0 0 1 14 8.5Z" /></svg>, label: 'Support', action: () => { setVisible(false); setOpen(false); setSupportOpen(true); } },
    { icon: <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round"><path d="M2 8H11M11 8L8 5M11 8L8 11" /><path d="M11 2H13V14H11" /></svg>, label: 'Settings', action: () => navTo('/settings') },
    { icon: <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round"><path d="M6 2H3V14H6" /><path d="M10 5L14 8L10 11" /><path d="M14 8H6" /></svg>, label: 'Log out', action: async () => { setVisible(false); setOpen(false); await logout(); setTimeout(() => navigate('/'), 0); }, danger: true },
  ];

  return (
    <div className="relative" ref={ref} onMouseEnter={handleMouseEnter} onMouseLeave={handleMouseLeave}>
      <div
        ref={btnRef}
        /* Barre du bas de la maquette : une pilule (rounded-full + bordure)
           avec seulement l'avatar et le prénom — pas d'e-mail. */
        className={`flex items-center gap-2 py-1 rounded-full cursor-pointer transition-colors ${collapsed ? 'justify-center px-1.5' : 'pl-1.5 pr-3'}`}
        style={{ border: '1px solid var(--border-subtle)', background: 'var(--surface-2)' }}
        onMouseEnter={e => e.currentTarget.style.background = 'var(--surface-5)'}
        onMouseLeave={e => e.currentTarget.style.background = 'var(--surface-2)'}
      >
        <div className="relative shrink-0">
          <div className="w-[26px] h-[26px] rounded-full flex items-center justify-center text-[12px] font-semibold shrink-0" style={{ background: 'var(--teal)', color: 'var(--text-inverse)' }}>
            {user.name?.[0]?.toUpperCase() || 'U'}
          </div>
          {isAdminUser(user) && (
            <span style={{ position: 'absolute', top: -3, right: -3, lineHeight: 0 }}>
              <VerifiedBadge size={14} ringColor="var(--surface-1)" />
            </span>
          )}
        </div>
        {!collapsed && (
          <div className="text-[13px] font-medium truncate min-w-0 flex-1" style={{ color: 'var(--text-muted)' }}>{user.name}</div>
        )}
      </div>

      {createPortal(
        <div
          ref={portalRef}
          onMouseEnter={handleMouseEnter}
          onMouseLeave={handleMouseLeave}
          className="fixed w-56 z-[9999]"
          style={{
            left: popupPos.left,
            bottom: popupPos.bottom,
            paddingBottom: 6,
            pointerEvents: visible ? 'auto' : 'none',
            visibility: open || visible ? 'visible' : 'hidden',
          }}
        >
        <div className="w-full rounded-xl py-1.5 shadow-2xl"
          style={{
            background: 'var(--surface-2)',
            border: '1px solid var(--border-default)',
            opacity: visible ? 1 : 0,
            transform: visible ? 'translateY(0) scale(1)' : 'translateY(6px) scale(0.97)',
            transition: 'opacity 150ms ease, transform 150ms ease',
            pointerEvents: visible ? 'auto' : 'none',
          }}>
          <div className="px-3 py-2.5 mb-1" style={{ borderBottom: '1px solid var(--border-subtle)' }}>
            <div className="flex items-center gap-2.5">
              <div className="relative shrink-0">
                <div className="w-9 h-9 rounded-full flex items-center justify-center text-[13px] font-semibold shrink-0" style={{ background: 'var(--teal)', color: 'var(--text-inverse)' }}>
                  {user.name?.[0]?.toUpperCase() || 'U'}
                </div>
                {isAdminUser(user) && (
                  <span style={{ position: 'absolute', top: -3, right: -3, lineHeight: 0 }}>
                    <VerifiedBadge size={14} ringColor="var(--surface-2)" />
                  </span>
                )}
              </div>
              <div className="min-w-0">
                <div className="text-[13px] font-medium truncate" style={{ color: 'var(--text-secondary)' }}>{user.name}</div>
                <div className="text-[12px] truncate" style={{ color: 'var(--text-ghost)' }}>{user.email}</div>
                <div className="text-[12px] font-mono font-semibold mt-0.5" style={{ color: 'var(--teal)' }}>{authUser?.tokens ?? 0} credits</div>
              </div>
            </div>
          </div>

          {items.map((item, i) => {
            if ('divider' in item && item.divider) {
              return <div key={i} className="my-1" style={{ borderTop: '1px solid var(--border-subtle)' }} />;
            }
            // Entrée thème : le bouton animé de la page Settings, tel quel.
            // La ligne est un <div> (pas un <button>) pour ne pas imbriquer deux
            // boutons ; un clic ailleurs sur la ligne bascule aussi le thème,
            // mais on ne double pas la bascule quand le clic vient du bouton.
            if ('theme' in item && item.theme) {
              return (
                <div key={i}
                  onClick={e => { if ((e.target as HTMLElement).closest('button')) return; toggleTheme(); }}
                  className="w-full flex items-center gap-3 px-3.5 py-2 text-left cursor-pointer transition-colors"
                  style={{ color: 'var(--text-muted)' }}
                  onMouseEnter={e => e.currentTarget.style.background = 'var(--surface-4)'}
                  onMouseLeave={e => e.currentTarget.style.background = 'transparent'}>
                  {/* Le bouton mesure 32px (20px d'icône + 6px de padding) : on le
                      centre dans une case de 14px et on le met à l'échelle 14/20
                      pour qu'il tombe pile sur la colonne des autres icônes. */}
                  <span className="shrink-0 relative" style={{ width: 17, height: 17 }}>
                    <span className="absolute flex" style={{ top: '50%', left: '50%', transform: 'translate(-50%, -50%) scale(0.85)' }}>
                      <AnimatedThemeToggler />
                    </span>
                  </span>
                  <span className="text-[13px]">{resolved === 'dark' ? 'Light Mode' : 'Dark Mode'}</span>
                </div>
              );
            }
            const it = item as { icon: React.ReactNode; label: string; action: () => void; soon?: boolean; danger?: boolean };
            return (
              <button key={i} onClick={it.action}
                className="w-full flex items-center gap-3 px-3.5 py-2 text-left transition-colors"
                style={{ color: it.danger ? 'var(--destructive)' : 'var(--text-muted)' }}
                onMouseEnter={e => e.currentTarget.style.background = 'var(--surface-4)'}
                onMouseLeave={e => e.currentTarget.style.background = 'transparent'}>
                <span className="shrink-0 opacity-60">{it.icon}</span>
                <span className="text-[13px]">{it.label}</span>
                {it.soon && <span className="text-[9px] ml-auto px-1.5 py-0.5 rounded" style={{ background: 'var(--surface-4)', color: 'var(--text-ghost)' }}>Soon</span>}
              </button>
            );
          })}
        </div>
        </div>,
        document.body
      )}

      <SupportPanel open={supportOpen} onClose={() => setSupportOpen(false)} />
    </div>
  );
}
