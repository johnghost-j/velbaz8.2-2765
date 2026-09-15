import { Route, Switch, useLocation } from "wouter";
import { Provider } from "./components/provider";
import { AgentFeedback } from "@runablehq/website-runtime";
import { useAuth } from "./lib/auth";
import { Sidebar } from "./components/Sidebar";
import { useSidebar } from "./lib/sidebar";
import { watchBrowserTheme } from "./lib/favicon";
import { installDragGuard } from "./lib/drag-guard";
import { useIsMobile, useIsTouch } from "./lib/useIsMobile";
import { SplashScreen } from "./components/SplashScreen";

import { AdminPanel } from "./components/AdminPanel";
import { SocialSandboxOverlay } from "./components/SocialSandboxOverlay";
import { AdminNotice } from "./components/AdminNotice";
import { LoginAsWindow } from "./components/LoginAsWindow";
import { setImpersonation } from "./lib/token";
import { useEffect, useState, useRef, lazy, Suspense } from "react";
import Index from "./pages/index";
import Login from "./pages/login";
import Register from "./pages/register";
import ForgotPassword from "./pages/forgot-password";
import ResetPassword from "./pages/reset-password";
import AcceptInvite from "./pages/accept-invite";
import Dashboard from "./pages/dashboard";
import Profile from "./pages/profile";
import Track from "./pages/track";
// Pages lourdes chargées à la demande : elles ne sont plus dans le bundle
// initial, donc /dashboard s'affiche sans attendre le code du chat, de
// l'éditeur, etc. (chat.tsx ≈ 7 700 lignes, editor.tsx ≈ 2 500).
const CompanyDetail = lazy(() => import("./pages/company"));
const Editor = lazy(() => import("./pages/editor"));
const Chat = lazy(() => import("./pages/chat"));
const Settings = lazy(() => import("./pages/settings"));
const Plans = lazy(() => import("./pages/plans"));
const CommunityPage = lazy(() => import("./pages/community"));
const MoneyMaker = lazy(() => import("./pages/money-maker"));
const Legal = lazy(() => import("./pages/legal"));
const Guide = lazy(() => import("./pages/guide"));
import { NotFoundGlitch } from "./components/NotFoundGlitch";
import { ToastHost } from "./components/ToastHost";
const NO_SIDEBAR = ['/login', '/register', '/forgot-password', '/reset-password', '/accept-invite', '/track', '/guide'];
const NO_SIDEBAR_PATTERNS = [/\/company\/[^/]+\/editor/];

// Redirection interne sans rechargement dur de la page (pas de window.location).
function ClientRedirect({ to }: { to: string }) {
  const [, navigate] = useLocation();
  useEffect(() => { navigate(to, { replace: true }); }, [to, navigate]);
  return null;
}

function SandboxWrapper() {
  const [open, setOpen] = useState(false);
  const [sandbox, setSandbox] = useState<any>(null);
  useEffect(() => {
    const handler = (e: Event) => {
      const ce = e as CustomEvent;
      setSandbox(ce.detail || null);
      setOpen(true);
    };
    window.addEventListener('open-sandbox', handler as EventListener);
    return () => window.removeEventListener('open-sandbox', handler as EventListener);
  }, []);
  return <SocialSandboxOverlay open={open} onClose={() => setOpen(false)} />;
}

function AppRoutes() {
  const { init, user } = useAuth();
  const [location] = useLocation();
  const { collapsed, mobileOpen, mobileDrag, setMobileOpen, setMobileDrag } = useSidebar();
  const isMobile = useIsMobile();
  const isTouch = useIsTouch();
  const [ready, setReady] = useState(false);

  // Fenêtre "login-as" : l'iframe reçoit un code à usage unique (?imp=…) qu'on
  // échange contre le token AVANT d'initialiser l'auth. Le token reste en
  // mémoire dans ce frame (lib/token.ts) : la session de l'onglet parent n'est
  // pas touchée, et le code est retiré de l'URL juste après.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const code = params.get('imp');
    if (!code) { init(); return; }
    (async () => {
      try {
        const res = await fetch('/api/impersonate/exchange', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ code }),
        }).then(r => r.json());
        if (res?.token) setImpersonation(res.token, res.email);
      } catch { /* code expiré → écran de login normal */ }
      params.delete('imp');
      const q = params.toString();
      window.history.replaceState({}, '', window.location.pathname + (q ? `?${q}` : ''));
      init();
    })();
  }, []);

  // Skip transition on first render to prevent teleportation
  useEffect(() => {
    requestAnimationFrame(() => {
      requestAnimationFrame(() => setReady(true));
    });
  }, []);

  const showSidebar = !NO_SIDEBAR.includes(location) && !NO_SIDEBAR_PATTERNS.some(p => p.test(location));
  // Desktop : la sidebar pousse le contenu vers la droite.
  // Mobile : plus de barre en haut (supprimée), donc aucun décalage vertical :
  // le contenu occupe toute la hauteur, le bouton menu flotte par-dessus.
  const sidebarWidth = showSidebar && !isMobile ? (collapsed ? 48 : 260) : 0;
  const topOffset = 0;

  // ── Swipe pour ouvrir/fermer le drawer (mobile, page home) ──
  const drawerWidth = () => window.innerWidth;
  const touch = useRef<{ x: number; y: number; active: boolean; dir: 'h' | 'v' | null }>({ x: 0, y: 0, active: false, dir: null });
  const swipeEnabled = isMobile && isTouch && showSidebar && location === '/';

  const onTouchStart = (e: React.TouchEvent) => {
    if (!swipeEnabled) return;
    const t = e.touches[0];
    touch.current = { x: t.clientX, y: t.clientY, active: true, dir: null };
  };
  const onTouchMove = (e: React.TouchEvent) => {
    if (!swipeEnabled || !touch.current.active) return;
    const t = e.touches[0];
    const dx = t.clientX - touch.current.x;
    const dy = t.clientY - touch.current.y;
    if (touch.current.dir == null) {
      if (Math.abs(dx) < 8 && Math.abs(dy) < 8) return;
      touch.current.dir = Math.abs(dx) > Math.abs(dy) ? 'h' : 'v';
    }
    if (touch.current.dir !== 'h') return;
    // Suivi accéléré : un petit swipe suffit (distance de référence courte).
    const w = Math.min(drawerWidth() * 0.5, 200);
    // Fermé : glisser vers la droite ouvre. Ouvert : glisser vers la gauche ferme.
    const base = mobileOpen ? 1 : 0;
    const p = Math.max(0, Math.min(1, base + dx / w));
    setMobileDrag(p);
  };
  const onTouchEnd = () => {
    if (!touch.current.active) return;
    const wasDragging = mobileDrag != null;
    touch.current.active = false;
    touch.current.dir = null;
    if (!wasDragging) return;
    const p = mobileDrag ?? 0;
    setMobileOpen(p > 0.25);
    setMobileDrag(null);
  };

  // Décalage du contenu : suit le swipe, sinon ouvert/fermé.
  const contentShift = (isMobile && showSidebar)
    ? (mobileDrag != null ? mobileDrag * drawerWidth() : (mobileOpen ? drawerWidth() : 0))
    : 0;

  return (
    <div className="flex h-[100dvh] overflow-hidden">
      {showSidebar && <Sidebar />}
      <main
        onTouchStart={onTouchStart}
        onTouchMove={onTouchMove}
        onTouchEnd={onTouchEnd}
        className={`flex-1 flex flex-col overflow-hidden ${ready ? 'transition-all duration-200' : ''}`}
        style={{
          marginLeft: sidebarWidth,
          marginTop: topOffset,
          // [2026-09-15] Plus de `calc(100dvh - 52px)` ici : ces 52px
          // compensaient le bandeau mobile supprimé depuis. Il ne restait
          // qu'une bande morte en bas de l'écran, qui remontait la barre de
          // prompt du chat au-dessus du bas du téléphone.
          height: undefined,
          transform: contentShift ? `translateX(${contentShift}px)` : undefined,
          transition: mobileDrag != null
            ? 'none'
            : (swipeEnabled ? 'transform 0.3s cubic-bezier(0.32, 0.72, 0, 1)' : (ready ? undefined : 'none')),
        }}
      >
        <div className="flex-1 min-h-0 overflow-auto">
          <Suspense fallback={
            <div className="min-h-screen flex items-center justify-center" style={{ background: 'var(--surface-0)' }}>
              <div className="flex gap-1"><div className="typing-dot" /><div className="typing-dot" /><div className="typing-dot" /></div>
            </div>
          }>
          <Switch>
          <Route path="/" component={Index} />
          <Route path="/chat/:id?">{(params) => <Chat key="chat-singleton" />}</Route>
          <Route path="/login" component={Login} />
          <Route path="/register" component={Register} />
          <Route path="/forgot-password" component={ForgotPassword} />
          <Route path="/reset-password" component={ResetPassword} />
          <Route path="/accept-invite" component={AcceptInvite} />
          <Route path="/dashboard" component={Dashboard} />
          <Route path="/launch">{() => <ClientRedirect to="/" />}</Route>
          <Route path="/profile" component={Profile} />
          <Route path="/settings" component={Settings} />
          <Route path="/plans" component={Plans} />
          <Route path="/community" component={CommunityPage} />
          <Route path="/money-maker" component={MoneyMaker} />
          <Route path="/track" component={Track} />
          <Route path="/guide" component={Guide} />
          <Route path="/legal/:doc" component={Legal} />
          <Route path="/legal">{() => <ClientRedirect to="/legal/terms" />}</Route>
          <Route path="/company/:id/editor" component={Editor} />
          <Route path="/company/:id" component={CompanyDetail} />
          <Route>
            {() => <NotFoundGlitch className="min-h-screen" />}
          </Route>
          </Switch>
          </Suspense>
        </div>
      </main>
      {/* Notification admin : visible par le destinataire, donc hors garde admin. */}
      {user && <AdminNotice />}
      {user?.email === 'johnemadmansour1@gmail.com' && (
        <>
          <AdminPanel userEmail={user.email} />
          <SandboxWrapper />
          {/* Fenêtre login-as : ouverte par la commande admin `login-as`. */}
          <LoginAsWindow />
        </>
      )}
    </div>
  );
}

function App() {
  // Icône d'onglet : suit le thème du navigateur/OS (clair → V noir,
  // sombre → V blanc), et rebascule en direct si l'utilisateur change son
  // thème système. Voir lib/favicon.ts.
  useEffect(() => { watchBrowserTheme(); }, []);
  // [2026-09-13] Garde anti-gel : empêche le glissement natif du texte
  // sélectionné de laisser une session de drag ouverte (souris prise, plus
  // aucun clic, F5 obligatoire). Voir lib/drag-guard.ts.
  useEffect(() => installDragGuard(), []);
  return (
    <Provider>
      <SplashScreen />
      <AppRoutes />
      {/* [2026-09-15] Pile de toasts — un seul point de montage pour toute
          l'app, les appels se font via `toast()` (lib/toast.ts). */}
      <ToastHost />
      {import.meta.env.DEV && <AgentFeedback />}
    </Provider>
  );
}

export default App;
