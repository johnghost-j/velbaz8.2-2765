// ─── Full-Stack App Scaffold ─────────────────────────────────────────────────
// Base file map for every generated app. This ALWAYS compiles and runs.
// The AI engine adds/overwrites app-specific files (pages, components, API
// routes, schema, stripe) on top of this foundation.
//
// Stack per generated app:
//   - Vite 7 + React 19 + Tailwind (frontend)
//   - Hono API mounted under /api via a Vite middleware plugin (dev)
//   - Stripe Checkout (real) via backend route, keys from env
//   - In-memory + JSON persistence fallback (upgradable to Drizzle/Turso)

import { type LegalPack, defaultLegalPack } from "./legal-compliance";

export interface ScaffoldFile {
  path: string;
  content: string;
}

export interface AppMeta {
  companyName: string;
  slug: string;
  primaryColor: string;
  accentColor: string;
  font: string;
  idea?: string;      // business idea → feeds the embedded AI system prompt
  tagline?: string;
  lang?: string;      // "fr" | "en" → language of the deterministic standard pages
  logoUrl?: string;   // generated brand logo (data URI or CDN URL) → shown in Header/Footer
  /** Floating AI assistant widget. OFF by default — only when the user asked
   *  for one (chatbot/assistant/live chat) or the AI plan decided it fits. */
  withAssistant?: boolean;
  /** Country-adapted legal pack produced by the dedicated legal AI (runs FIRST,
   *  before page planning). When absent, a generic RGPD/GDPR fallback is used so
   *  every generated app always ships legal pages + a cookie banner. */
  legal?: LegalPack;
  /** MODE CLONE ("Continuer une company" avec une URL). Le but est de recréer
   *  À L'IDENTIQUE le site source scrapé par Firecrawl — PAS de générer un
   *  produit SaaS. Quand true, le scaffold NE génère PAS les pages auth/légales/
   *  support ni la bannière cookies : on ne reproduit QUE ce que le site source
   *  contient réellement (fidélité stricte, standard testscrap). */
  cloneMode?: boolean;
  /** Système de compte/connexion. Absent/true = auth activée (défaut). false =
   *  l'utilisateur ne veut PAS de compte (ou le plan a jugé qu'aucun compte n'a
   *  de sens): le scaffold NE génère PAS les pages Login/Signup/Profile/Settings
   *  et le router (buildAppTsx) ne câble aucune route auth. La lib auth.tsx et
   *  server/auth.ts restent présents (inoffensifs) pour ne rien casser. */
  withAuth?: boolean;
}

/** Resolve the legal pack for scaffolding: the AI-produced pack when available,
 *  otherwise a solid generic fallback so pages/banner always render. */
function resolveLegal(meta: AppMeta): LegalPack {
  return meta.legal || defaultLegalPack({ companyName: meta.companyName, idea: meta.idea || "", lang: meta.lang || "fr" });
}

const PKG_JSON = (meta: AppMeta) => `{
  "name": "${meta.slug}",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "vite build",
    "preview": "vite preview"
  },
  "dependencies": {
    "react": "^19.0.0",
    "react-dom": "^19.0.0",
    "react-router-dom": "^7.1.1",
    "hono": "^4.6.14",
    "stripe": "^17.5.0",
    "lucide-react": "^0.469.0",
    "framer-motion": "^11.15.0",
    "@paper-design/shaders-react": "^0.0.77",
    "ai": "^7.0.9",
    "@ai-sdk/react": "^2.0.9",
    "zod": "^4.4.3"
  },
  "devDependencies": {
    "@vitejs/plugin-react": "^4.3.4",
    "vite": "^7.0.0",
    "tailwindcss": "^3.4.17",
    "autoprefixer": "^10.4.20",
    "postcss": "^8.4.49",
    "typescript": "^5.7.2",
    "@types/react": "^19.0.0",
    "@types/react-dom": "^19.0.0"
  }
}
`;

const VITE_CONFIG = `import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";
import { apiPlugin } from "./vite.api.js";

// base defaults to "/" for standalone/exported deploys. In the Velbaz preview it
// is set (via VITE_APP_BASE) to the proxy path so every emitted URL resolves.
const base = process.env.VITE_APP_BASE || "/";

export default defineConfig({
  base,
  plugins: [react(), apiPlugin(base)],
  // L'alias "@/" → "src/" est un CONTRAT du scaffold : les agents (test1,
  // builder) importent "@/lib/assets", "@/lib/brand", etc. Sans lui, chaque
  // import aliasé casse le bundle → page blanche sans erreur parlante.
  resolve: { alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) } },
  server: { host: true, allowedHosts: true },
});
`;

// A tiny Vite plugin that mounts the Hono API during dev. It intercepts requests
// to \`<base>api/*\` and forwards them to the Hono app (which uses basePath "/api").
const VITE_API_PLUGIN = `export function apiPlugin(base = "/") {
  const prefix = (base.endsWith("/") ? base.slice(0, -1) : base); // e.g. "" or "/api/companies/x/preview"
  const apiPath = prefix + "/api";
  return {
    name: "hono-api",
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        if (!req.url) return next();
        // Match only this app's own API calls (under the configured base).
        if (!(req.url === apiPath || req.url.startsWith(apiPath + "/") || req.url.startsWith(apiPath + "?"))) {
          return next();
        }
        try {
          const mod = await server.ssrLoadModule("/server/index.ts");
          const app = mod.default;
          // Strip the base prefix so Hono (basePath "/api") sees "/api/...".
          const honoUrl = "http://localhost" + req.url.slice(prefix.length);
          const chunks = [];
          for await (const c of req) chunks.push(c);
          const body = chunks.length ? Buffer.concat(chunks) : undefined;
          const request = new Request(honoUrl, {
            method: req.method,
            headers: req.headers,
            body: body && req.method !== "GET" && req.method !== "HEAD" ? body : undefined,
          });
          const response = await app.fetch(request);
          res.statusCode = response.status;
          response.headers.forEach((v, k) => res.setHeader(k, v));
          const buf = Buffer.from(await response.arrayBuffer());
          res.end(buf);
        } catch (e) {
          console.error("[api]", e);
          res.statusCode = 500;
          res.end(JSON.stringify({ error: String(e) }));
        }
      });
    },
  };
}
`;

const TSCONFIG = `{
  "compilerOptions": {
    "target": "ES2022",
    "useDefineForClassFields": true,
    "lib": ["ES2022", "DOM", "DOM.Iterable"],
    "module": "ESNext",
    "skipLibCheck": true,
    "moduleResolution": "bundler",
    "allowImportingTsExtensions": true,
    "resolveJsonModule": true,
    "isolatedModules": true,
    "noEmit": true,
    "jsx": "react-jsx",
    "strict": false,
    "esModuleInterop": true,
    "baseUrl": ".",
    "paths": { "@/*": ["src/*"] }
  },
  "include": ["src", "server"]
}
`;

// Brand constants shared across the generated site. LOGO_URL is the real
// generated brand logo (data URI or CDN URL); empty string when none exists,
// in which case components fall back to the wordmark.
const BRAND_TS = (meta: AppMeta) => `// Auto-generated brand assets. LOGO_URL is the AI-generated brand logo.
export const BRAND_NAME = ${JSON.stringify(meta.companyName)};
export const LOGO_URL = ${JSON.stringify(meta.logoUrl || "")};
`;

// AI-generated content images (hero, sections, gallery, about…). Keys are
// stable; values are compressed WebP data URIs. Empty at scaffold time — the
// build overwrites this file with the real manifest once visuals are generated.
export const IMAGES_TS = (urls: Record<string, string> = {}) =>
  `// Visuels générés par l'IA. Clés stables réutilisables dans les pages.\n` +
  `export const IMAGES: Record<string, string> = ${JSON.stringify(urls, null, 2)};\n`;

// Sons générés par l'IA (data URIs audio/mpeg) + métadonnées. Fichier de données
// simple → couvert par le checkpoint/rollback/fork comme src/lib/images.ts.
export const AUDIO_TS = (
  manifest: { urls?: Record<string, string>; meta?: Record<string, { kind: string; loop: boolean }> } = {},
) =>
  `// Sons générés par l'IA. Clés stables réutilisables via le hook useSound().\n` +
  `export const AUDIO: Record<string, string> = ${JSON.stringify(manifest.urls || {}, null, 2)};\n\n` +
  `export const AUDIO_META: Record<string, { kind: string; loop: boolean }> = ${JSON.stringify(manifest.meta || {}, null, 2)};\n`;

// Legal pack (produced by the dedicated legal AI, or generic fallback). Written
// as a plain data file so it's covered by the checkpoint/rollback/fork snapshot
// machinery, exactly like src/lib/images.ts. Pages + CookieBanner read from it.
export const LEGAL_CONTENT_TS = (pack: LegalPack) =>
  `// Documents juridiques adaptés au pays, générés par l'IA juridique de Velbaz.\n` +
  `// Éditable comme n'importe quel fichier du projet.\n` +
  `export interface LegalDoc { title: string; intro?: string; sections: Array<{ heading: string; body: string }>; }\n` +
  `export interface CookieBannerCopy { message: string; accept: string; reject: string; settings: string; learnMore: string; savedNote?: string; }\n` +
  `export interface LegalPack { country: string; frameworks: string[]; lastUpdated: string; privacy: LegalDoc; terms: LegalDoc; legalNotice: LegalDoc; cookies: LegalDoc; cookieBanner: CookieBannerCopy; }\n\n` +
  `export const LEGAL: LegalPack = ${JSON.stringify(pack, null, 2)};\n\n` +
  `export const COOKIE_BANNER = LEGAL.cookieBanner;\n`;

// Favicon de l'onglet : on utilise TOUJOURS le logo généré par l'IA quand il
// existe (data URI ou URL), pour que l'onglet corresponde exactement au logo du
// site. Sinon on génère un favicon de secours sur la couleur de marque avec
// l'initiale de l'entreprise — jamais l'icône par défaut de Vite.
function faviconHref(meta: AppMeta): string {
  if (meta.logoUrl && meta.logoUrl.trim()) return meta.logoUrl.trim();
  const initial = (meta.companyName || "?").trim().charAt(0).toUpperCase() || "?";
  const bg = meta.primaryColor || "#111827";
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" rx="14" fill="${bg}"/><text x="32" y="44" font-family="system-ui,-apple-system,sans-serif" font-size="36" font-weight="700" fill="#ffffff" text-anchor="middle">${initial}</text></svg>`;
  return `data:image/svg+xml,${encodeURIComponent(svg)}`;
}

const INDEX_HTML = (meta: AppMeta) => `<!doctype html>
<html lang="fr">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>${meta.companyName}</title>
    <link rel="icon" href="${faviconHref(meta)}" />
    <link rel="apple-touch-icon" href="${faviconHref(meta)}" />
    <link rel="preconnect" href="https://fonts.googleapis.com" />
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
    <link href="https://fonts.googleapis.com/css2?family=${encodeURIComponent(meta.font).replace(/%20/g, "+")}:wght@300;400;500;600;700;800;900&display=swap" rel="stylesheet" />
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/app-entry.tsx"></script>
  </body>
</html>
`;

const TAILWIND_CONFIG = (meta: AppMeta) => `export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  darkMode: "class",
  theme: {
    extend: {
      colors: {
        brand: "${meta.primaryColor}",
        accent: "${meta.accentColor}",
      },
      fontFamily: {
        sans: ["${meta.font}", "system-ui", "sans-serif"],
      },
    },
  },
  plugins: [],
};
`;

const POSTCSS_CONFIG = `export default {
  plugins: { tailwindcss: {}, autoprefixer: {} },
};
`;

const STYLES_CSS = `@tailwind base;
@tailwind components;
@tailwind utilities;

:root { color-scheme: light; }
html.dark { color-scheme: dark; }
html { scroll-behavior: smooth; }
body { margin: 0; -webkit-font-smoothing: antialiased; }

/* Global light/dark surface + text so the whole app reacts to the theme toggle,
   even on areas the page components don't explicitly style. */
body { background-color: #ffffff; color: #0f172a; transition: background-color .2s ease, color .2s ease; }
html.dark body { background-color: #0b0f19; color: #e5e7eb; }
`;

const MAIN_TSX = `import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import App from "./App";
import { ThemeProvider } from "./lib/theme";
import { AuthProvider } from "./lib/auth";
import { AppErrorBoundary } from "./lib/error-boundary";
import "./styles.css";

// BASE_URL is injected by Vite (matches the --base the dev server runs with,
// e.g. the Velbaz preview proxy path). Strip the trailing slash for react-router.
const basename = import.meta.env.BASE_URL.replace(/\\/$/, "");

// AUCUN rechargement automatique de la page (demande explicite : la preview
// ne doit jamais se réactualiser toute seule pendant que l'IA travaille).
// On se contente de tracer les erreurs hors du cycle de rendu React ;
// l'utilisateur garde le bouton "Recharger" de l'écran d'erreur.
window.addEventListener("vite:preloadError", (e) => {
  // eslint-disable-next-line no-console
  console.warn("[velbaz] chunk non chargé (pas de reload auto)", e);
});
window.addEventListener("unhandledrejection", (e) => {
  // eslint-disable-next-line no-console
  console.warn("[velbaz] promesse rejetée", e.reason);
});

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <AppErrorBoundary>
      <ThemeProvider>
        <AuthProvider>
          <BrowserRouter basename={basename}>
            <App />
          </BrowserRouter>
        </AuthProvider>
      </ThemeProvider>
    </AppErrorBoundary>
  </React.StrictMode>
);
`;

// A crash in ANY page component (bad import, undefined var, bad prop, etc.)
// must never leave the user staring at a blank white/black screen. This
// top-level boundary catches render-time exceptions anywhere in the app tree
// and shows a friendly, actionable screen instead — with a one-click reload
// and (in dev) the raw error message to speed up debugging.
const ERROR_BOUNDARY_TSX = `import { Component, type ReactNode } from "react";

interface Props { children: ReactNode; }
interface State { error: Error | null; }

export class AppErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: { componentStack: string }) {
    // eslint-disable-next-line no-console
    console.error("[AppErrorBoundary] Caught render error:", error, info.componentStack);
  }

  handleReload = () => {
    this.setState({ error: null });
    window.location.reload();
  };

  render() {
    if (!this.state.error) return this.props.children;
    const isDev = Boolean(import.meta.env.DEV);
    return (
      <div
        style={{
          minHeight: "100vh",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          padding: "24px",
          fontFamily: "system-ui, -apple-system, sans-serif",
          background: "#0b0f19",
          color: "#e5e7eb",
        }}
      >
        <div style={{ maxWidth: 480, textAlign: "center" }}>
          <div style={{ fontSize: 40, marginBottom: 12 }}>⚠️</div>
          <h1 style={{ fontSize: 20, fontWeight: 600, marginBottom: 8 }}>
            Un problème est survenu sur cette page
          </h1>
          <p style={{ fontSize: 14, color: "#9ca3af", marginBottom: 20, lineHeight: 1.5 }}>
            Quelque chose a empêché l'affichage de cette page. Vous pouvez réessayer — vos données sont conservées.
          </p>
          {isDev && this.state.error && (
            <pre
              style={{
                textAlign: "left",
                fontSize: 12,
                background: "#111827",
                border: "1px solid #242830",
                borderRadius: 8,
                padding: 12,
                marginBottom: 20,
                overflow: "auto",
                maxHeight: 200,
                color: "#fca5a5",
              }}
            >
              {String(this.state.error.stack || this.state.error.message)}
            </pre>
          )}
          <button
            onClick={this.handleReload}
            style={{
              background: "#D4FF3A",
              color: "#0C0E10",
              border: "none",
              borderRadius: 999,
              padding: "10px 24px",
              fontSize: 14,
              fontWeight: 600,
              cursor: "pointer",
            }}
          >
            Recharger la page
          </button>
        </div>
      </div>
    );
  }
}
`;

// ─── Theme (dark/light) ──────────────────────────────────────────────────────
const THEME_TSX = `import { createContext, useContext, useEffect, useState, type ReactNode } from "react";

type Theme = "light" | "dark";
interface ThemeCtx { theme: Theme; toggle: () => void; setTheme: (t: Theme) => void; }

const Ctx = createContext<ThemeCtx>({ theme: "light", toggle: () => {}, setTheme: () => {} });

function getInitial(): Theme {
  if (typeof window === "undefined") return "light";
  const saved = localStorage.getItem("theme");
  if (saved === "light" || saved === "dark") return saved;
  return window.matchMedia?.("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setThemeState] = useState<Theme>(getInitial);

  useEffect(() => {
    const root = document.documentElement;
    if (theme === "dark") root.classList.add("dark");
    else root.classList.remove("dark");
    localStorage.setItem("theme", theme);
  }, [theme]);

  const setTheme = (t: Theme) => setThemeState(t);
  const toggle = () => setThemeState((p) => (p === "dark" ? "light" : "dark"));

  return <Ctx.Provider value={{ theme, toggle, setTheme }}>{children}</Ctx.Provider>;
}

export function useTheme() { return useContext(Ctx); }
`;

// ─── Auth (real client context backed by the Hono /api/auth endpoints) ───────
const AUTH_TSX = `import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { X, LogIn, UserPlus, Loader2 } from "lucide-react";
import { api } from "./api";

export interface User { id: string; email: string; name: string; createdAt: number; }
interface AuthCtx {
  user: User | null;
  loading: boolean;
  login: (email: string, password: string) => Promise<void>;
  signup: (name: string, email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  updateProfile: (patch: Partial<Pick<User, "name" | "email">>) => Promise<void>;
  // Exécute "action" si connecté, sinon ouvre la popup de connexion. Renvoie true si autorisé.
  requireAuth: (action?: () => void) => boolean;
  openAuthModal: (mode?: "login" | "signup") => void;
}

const Ctx = createContext<AuthCtx>(null as any);

function getToken() { return localStorage.getItem("auth_token") || ""; }
function setToken(t: string) { t ? localStorage.setItem("auth_token", t) : localStorage.removeItem("auth_token"); }

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [modalOpen, setModalOpen] = useState(false);
  const [modalMode, setModalMode] = useState<"login" | "signup">("login");

  const auth = (path: string, body?: any) =>
    api(path, {
      method: body ? "POST" : "GET",
      headers: { Authorization: "Bearer " + getToken() },
      body: body ? JSON.stringify(body) : undefined,
    });

  useEffect(() => {
    if (!getToken()) { setLoading(false); return; }
    // Le compte doit rester connecté tant que la session est valide, même si
    // l'utilisateur ferme l'onglet/le site et revient plus tard (localStorage
    // survit à la fermeture du navigateur — contrairement à sessionStorage).
    // On NE déconnecte JAMAIS sur une erreur réseau/serveur transitoire
    // (hors-ligne, cold start, 500, timeout) — seulement sur un vrai 401
    // (token expiré/invalide), sinon un simple aller-retour réseau raté
    // effacerait le compte de l'utilisateur.
    auth("/auth/me")
      .then((r: any) => setUser(r.user))
      .catch((e: any) => { if (e?.status === 401) setToken(""); /* sinon: on garde le token, on réessaiera */ })
      .finally(() => setLoading(false));
  }, []);

  const login = async (email: string, password: string) => {
    const r: any = await auth("/auth/login", { email, password });
    setToken(r.token); setUser(r.user);
  };
  const signup = async (name: string, email: string, password: string) => {
    const r: any = await auth("/auth/signup", { name, email, password });
    setToken(r.token); setUser(r.user);
  };
  const logout = async () => {
    try { await auth("/auth/logout", {}); } catch {}
    setToken(""); setUser(null);
  };
  const updateProfile = async (patch: Partial<Pick<User, "name" | "email">>) => {
    const r: any = await auth("/auth/profile", patch);
    setUser(r.user);
  };

  const openAuthModal = (mode: "login" | "signup" = "login") => { setModalMode(mode); setModalOpen(true); };
  const requireAuth = (action?: () => void) => {
    if (user) { if (action) action(); return true; }
    openAuthModal("login");
    return false;
  };

  return (
    <Ctx.Provider value={{ user, loading, login, signup, logout, updateProfile, requireAuth, openAuthModal }}>
      {children}
      <AuthModal open={modalOpen} mode={modalMode} setMode={setModalMode} onClose={() => setModalOpen(false)} />
    </Ctx.Provider>
  );
}

export function useAuth() { return useContext(Ctx); }

// Hook pratique: renvoie la fonction requireAuth pour protéger une action derrière la connexion.
// Ex: const requireAuth = useRequireAuth(); <button onClick={() => requireAuth(() => addToCart(item))}>…
export function useRequireAuth() { return useContext(Ctx).requireAuth; }

// Popup de connexion/inscription (login + signup dans une seule modale), affichée par-dessus le contenu.
function AuthModal({ open, mode, setMode, onClose }: { open: boolean; mode: "login" | "signup"; setMode: (m: "login" | "signup") => void; onClose: () => void; }) {
  const { login, signup } = useAuth();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => { if (open) { setError(""); setPassword(""); } }, [open]);
  if (!open) return null;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(""); setBusy(true);
    try {
      if (mode === "signup") await signup(name, email, password);
      else await login(email, password);
      onClose();
    } catch (err: any) {
      setError(err?.message || "Une erreur est survenue");
    } finally { setBusy(false); }
  };

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={onClose} />
      <div className="relative w-full max-w-md rounded-2xl bg-white dark:bg-[#0f1420] border border-gray-100 dark:border-white/10 shadow-2xl p-8">
        <button onClick={onClose} aria-label="Fermer" className="absolute right-4 top-4 h-9 w-9 inline-flex items-center justify-center rounded-full text-gray-400 hover:bg-gray-100 dark:hover:bg-white/10 transition">
          <X className="h-5 w-5" />
        </button>
        <h2 className="text-2xl font-bold tracking-tight text-gray-900 dark:text-white">
          {mode === "signup" ? "Créer un compte" : "Connexion"}
        </h2>
        <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
          {mode === "signup" ? "Inscris-toi pour continuer." : "Connecte-toi pour continuer."}
        </p>
        <form onSubmit={submit} className="mt-6 space-y-4">
          {mode === "signup" && (
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">Nom</label>
              <input required value={name} onChange={(e) => setName(e.target.value)}
                className="mt-1 w-full rounded-lg border border-gray-200 dark:border-white/10 bg-white dark:bg-white/5 px-3 py-2 text-gray-900 dark:text-white outline-none focus:ring-2 focus:ring-brand" />
            </div>
          )}
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">E-mail</label>
            <input type="email" autoComplete="username" required value={email} onChange={(e) => setEmail(e.target.value)}
              className="mt-1 w-full rounded-lg border border-gray-200 dark:border-white/10 bg-white dark:bg-white/5 px-3 py-2 text-gray-900 dark:text-white outline-none focus:ring-2 focus:ring-brand" />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">Mot de passe</label>
            <input type="password" autoComplete={mode === "signup" ? "new-password" : "current-password"} minLength={mode === "signup" ? 8 : undefined} required value={password} onChange={(e) => setPassword(e.target.value)}
              className="mt-1 w-full rounded-lg border border-gray-200 dark:border-white/10 bg-white dark:bg-white/5 px-3 py-2 text-gray-900 dark:text-white outline-none focus:ring-2 focus:ring-brand" />
          </div>
          {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}
          <button type="submit" disabled={busy}
            className="w-full inline-flex items-center justify-center gap-2 rounded-lg bg-brand px-4 py-2.5 font-semibold text-white hover:opacity-90 disabled:opacity-60 transition">
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : (mode === "signup" ? <UserPlus className="h-4 w-4" /> : <LogIn className="h-4 w-4" />)}
            {mode === "signup" ? "S'inscrire" : "Se connecter"}
          </button>
        </form>
        <p className="mt-5 text-center text-sm text-gray-500 dark:text-gray-400">
          {mode === "signup" ? "Déjà un compte ?" : "Pas encore de compte ?"}{" "}
          <button onClick={() => setMode(mode === "signup" ? "login" : "signup")} className="font-semibold text-brand hover:underline">
            {mode === "signup" ? "Se connecter" : "Créer un compte"}
          </button>
        </p>
      </div>
    </div>
  );
}

// Guard a route: ouvre la popup de connexion quand l'utilisateur n'est pas connecté (au lieu de rediriger).
export function ProtectedRoute({ children }: { children: ReactNode }) {
  const { user, loading, openAuthModal } = useAuth();
  useEffect(() => { if (!loading && !user) openAuthModal("login"); }, [loading, user]);
  if (loading) return <div className="min-h-screen flex items-center justify-center text-gray-400">Chargement…</div>;
  if (!user) return (
    <div className="min-h-[70vh] flex flex-col items-center justify-center gap-4 text-center px-4">
      <LogIn className="h-10 w-10 text-brand" />
      <h2 className="text-xl font-bold text-gray-900 dark:text-white">Connexion requise</h2>
      <p className="text-gray-500 dark:text-gray-400 max-w-sm">Connecte-toi pour accéder à cette page.</p>
      <button onClick={() => openAuthModal("login")} className="inline-flex items-center gap-2 rounded-lg bg-brand px-5 py-2.5 font-semibold text-white hover:opacity-90 transition">
        <LogIn className="h-4 w-4" /> Se connecter
      </button>
    </div>
  );
  return <>{children}</>;
}
`;

// ─── Theme toggle button (fixed, always available) ───────────────────────────
const THEME_TOGGLE_TSX = `import { Moon, Sun } from "lucide-react";
import { useTheme } from "../lib/theme";

// Reusable inline toggle for headers/navs.
export default function ThemeToggle({ className = "" }: { className?: string }) {
  const { theme, toggle } = useTheme();
  return (
    <button
      onClick={toggle}
      aria-label={theme === "dark" ? "Passer en clair" : "Passer en sombre"}
      className={"inline-flex h-9 w-9 items-center justify-center rounded-full border border-gray-200 dark:border-white/10 bg-white/70 dark:bg-white/5 text-gray-700 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-white/10 transition " + className}
    >
      {theme === "dark" ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
    </button>
  );
}
`;

// Minimal App shell. The AI engine overwrites App.tsx with real routes/pages.
const APP_TSX = (meta: AppMeta) => `import { Routes, Route } from "react-router-dom";
import Home from "./pages/Home";

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<Home />} />
    </Routes>
  );
}
`;

// ─── Shared Layout: Header + page content + Footer, rendered ONCE ────────────
// Every content route renders inside <Layout> so Header/Footer are consistent
// and pages never re-implement navigation. Uses react-router <Outlet/>.
// L'assistant IA flottant n'est PAS rendu par défaut : uniquement quand
// l'utilisateur l'a demandé ou que le plan IA l'a jugé pertinent (withAssistant).
const LAYOUT_TSX = (meta: AppMeta) => `import { Outlet, useLocation } from "react-router-dom";
import { useEffect } from "react";
import Header from "./Header";
import Footer from "./Footer";
${meta.cloneMode ? "" : `import CookieBanner from "./CookieBanner";\nimport SoundToggle from "./SoundToggle";\n`}${meta.withAssistant ? `import AIAssistant from "./AIAssistant";\n` : ""}
// Remonte en haut de la page à chaque changement de route (comportement
// attendu d'une navigation multi-pages). On ignore les changements de simple
// ancre (#section) pour laisser le défilement vers l'ancre fonctionner.
function ScrollToTop() {
  const { pathname, hash } = useLocation();
  useEffect(() => {
    if (hash) return;
    window.scrollTo({ top: 0, left: 0, behavior: "auto" });
  }, [pathname, hash]);
  return null;
}

export default function Layout() {
  return (
    <div className="min-h-screen flex flex-col bg-white text-gray-900 dark:bg-[#0b0f19] dark:text-gray-100 transition-colors">
      <ScrollToTop />
      <Header />
      <main className="flex-1">
        <Outlet />
      </main>
      <Footer />
${meta.withAssistant ? "      <AIAssistant />\n" : ""}${meta.cloneMode ? "" : "      <CookieBanner />\n"}    </div>
  );
}
`;

// ─── Default auth pages (real, wired to /api/auth) ───────────────────────────
const LOGIN_TSX = `import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { LogIn, Loader2 } from "lucide-react";
import { useAuth } from "../lib/auth";

export default function Login() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(""); setBusy(true);
    try { await login(email, password); navigate("/profile"); }
    catch (err: any) { setError(err?.message || "Identifiants invalides"); }
    finally { setBusy(false); }
  };

  return (
    <div className="min-h-[80vh] flex items-center justify-center px-4 py-16">
      <div className="w-full max-w-md">
        <div className="bg-white dark:bg-white/5 rounded-2xl shadow-xl border border-gray-100 dark:border-white/10 p-8">
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Connexion</h1>
          <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">Ravi de te revoir.</p>
          <form onSubmit={submit} className="mt-6 space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">E-mail</label>
              <input type="email" autoComplete="username" required value={email} onChange={(e) => setEmail(e.target.value)}
                className="mt-1 w-full rounded-lg border border-gray-200 dark:border-white/10 bg-white dark:bg-white/5 px-3 py-2 text-gray-900 dark:text-white outline-none focus:ring-2 focus:ring-brand" />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">Mot de passe</label>
              <input type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)}
                className="mt-1 w-full rounded-lg border border-gray-200 dark:border-white/10 bg-white dark:bg-white/5 px-3 py-2 text-gray-900 dark:text-white outline-none focus:ring-2 focus:ring-brand" />
            </div>
            {error && <p className="text-sm text-red-500">{error}</p>}
            <button type="submit" disabled={busy}
              className="w-full inline-flex items-center justify-center gap-2 rounded-lg bg-brand px-4 py-2.5 font-semibold text-white hover:opacity-90 transition disabled:opacity-60">
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <LogIn className="h-4 w-4" />} Se connecter
            </button>
          </form>
          <p className="mt-6 text-center text-sm text-gray-500 dark:text-gray-400">
            Pas encore de compte ? <Link to="/signup" className="font-semibold text-brand hover:underline">Créer un compte</Link>
          </p>
        </div>
      </div>
    </div>
  );
}
`;

const SIGNUP_TSX = (meta: AppMeta) => {
  const fr = (meta.lang || "fr") !== "en";
  const t = {
    title: fr ? "Créer un compte" : "Create an account",
    sub: fr ? "Rejoins-nous en quelques secondes." : "Join us in seconds.",
    name: fr ? "Nom" : "Name",
    email: "E-mail",
    password: fr ? "Mot de passe" : "Password",
    cta: fr ? "Créer mon compte" : "Create my account",
    have: fr ? "Déjà inscrit ?" : "Already have an account?",
    signin: fr ? "Se connecter" : "Sign in",
    fail: fr ? "Inscription impossible" : "Sign up failed",
    mustAccept: fr
      ? "Vous devez accepter la Politique de confidentialité et les Conditions d'utilisation."
      : "You must accept the Privacy Policy and Terms of Service.",
    accept: fr ? "J'accepte la" : "I agree to the",
    privacy: fr ? "Politique de confidentialité" : "Privacy Policy",
    and: fr ? "et les" : "and the",
    terms: fr ? "Conditions d'utilisation" : "Terms of Service",
  };
  return `import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { UserPlus, Loader2 } from "lucide-react";
import { useAuth } from "../lib/auth";

export default function Signup() {
  const { signup } = useAuth();
  const navigate = useNavigate();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [accepted, setAccepted] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!accepted) { setError(${JSON.stringify(t.mustAccept)}); return; }
    setError(""); setBusy(true);
    try { await signup(name, email, password); navigate("/profile"); }
    catch (err: any) { setError(err?.message || ${JSON.stringify(t.fail)}); }
    finally { setBusy(false); }
  };

  return (
    <div className="min-h-[80vh] flex items-center justify-center px-4 py-16">
      <div className="w-full max-w-md">
        <div className="bg-white dark:bg-white/5 rounded-2xl shadow-xl border border-gray-100 dark:border-white/10 p-8">
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white">${t.title}</h1>
          <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">${t.sub}</p>
          <form onSubmit={submit} className="mt-6 space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">${t.name}</label>
              <input type="text" required value={name} onChange={(e) => setName(e.target.value)}
                className="mt-1 w-full rounded-lg border border-gray-200 dark:border-white/10 bg-white dark:bg-white/5 px-3 py-2 text-gray-900 dark:text-white outline-none focus:ring-2 focus:ring-brand" />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">${t.email}</label>
              <input type="email" autoComplete="username" required value={email} onChange={(e) => setEmail(e.target.value)}
                className="mt-1 w-full rounded-lg border border-gray-200 dark:border-white/10 bg-white dark:bg-white/5 px-3 py-2 text-gray-900 dark:text-white outline-none focus:ring-2 focus:ring-brand" />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">${t.password}</label>
              <input type="password" autoComplete="new-password" required minLength={8} value={password} onChange={(e) => setPassword(e.target.value)}
                className="mt-1 w-full rounded-lg border border-gray-200 dark:border-white/10 bg-white dark:bg-white/5 px-3 py-2 text-gray-900 dark:text-white outline-none focus:ring-2 focus:ring-brand" />
            </div>
            <label className="flex items-start gap-2.5 text-sm text-gray-600 dark:text-gray-300 cursor-pointer select-none">
              <input type="checkbox" checked={accepted} onChange={(e) => setAccepted(e.target.checked)}
                className="mt-0.5 h-4 w-4 shrink-0 rounded border-gray-300 dark:border-white/20 text-brand focus:ring-brand accent-[color:var(--brand,#4f46e5)]" />
              <span>${t.accept} <Link to="/privacy" target="_blank" className="font-medium text-brand hover:underline">${t.privacy}</Link> ${t.and} <Link to="/terms" target="_blank" className="font-medium text-brand hover:underline">${t.terms}</Link>.</span>
            </label>
            {error && <p className="text-sm text-red-500">{error}</p>}
            <button type="submit" disabled={busy || !accepted}
              className="w-full inline-flex items-center justify-center gap-2 rounded-lg bg-brand px-4 py-2.5 font-semibold text-white hover:opacity-90 transition disabled:opacity-50 disabled:cursor-not-allowed">
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <UserPlus className="h-4 w-4" />} ${t.cta}
            </button>
          </form>
          <p className="mt-6 text-center text-sm text-gray-500 dark:text-gray-400">
            ${t.have} <Link to="/login" className="font-semibold text-brand hover:underline">${t.signin}</Link>
          </p>
        </div>
      </div>
    </div>
  );
}
`;
};

const PROFILE_TSX = `import { User, Mail, Calendar, LogOut, Settings as SettingsIcon } from "lucide-react";
import { Link, useNavigate } from "react-router-dom";
import { useAuth } from "../lib/auth";

export default function Profile() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  if (!user) return null;

  const initials = user.name.split(" ").map((p) => p[0]).slice(0, 2).join("").toUpperCase();
  const handleLogout = async () => { await logout(); navigate("/"); };

  return (
    <div className="max-w-2xl mx-auto px-4 py-16">
      <div className="bg-white dark:bg-white/5 rounded-2xl shadow-sm border border-gray-100 dark:border-white/10 overflow-hidden">
        <div className="h-28 bg-gradient-to-r from-brand to-accent" />
        <div className="px-8 pb-8">
          <div className="-mt-12 flex items-end gap-4">
            <div className="h-24 w-24 rounded-full bg-gradient-to-br from-brand to-accent flex items-center justify-center text-2xl font-bold text-white ring-4 ring-white dark:ring-[#0b0f19]">
              {initials}
            </div>
            <div className="pb-2">
              <h1 className="text-2xl font-bold text-gray-900 dark:text-white">{user.name}</h1>
              <p className="text-sm text-gray-500 dark:text-gray-400">{user.email}</p>
            </div>
          </div>

          <div className="mt-8 space-y-3">
            <div className="flex items-center gap-3 rounded-xl bg-gray-50 dark:bg-white/5 px-4 py-3">
              <User className="h-5 w-5 text-brand" />
              <div><p className="text-xs text-gray-500 dark:text-gray-400">Nom</p><p className="font-medium text-gray-900 dark:text-white">{user.name}</p></div>
            </div>
            <div className="flex items-center gap-3 rounded-xl bg-gray-50 dark:bg-white/5 px-4 py-3">
              <Mail className="h-5 w-5 text-brand" />
              <div><p className="text-xs text-gray-500 dark:text-gray-400">E-mail</p><p className="font-medium text-gray-900 dark:text-white">{user.email}</p></div>
            </div>
            <div className="flex items-center gap-3 rounded-xl bg-gray-50 dark:bg-white/5 px-4 py-3">
              <Calendar className="h-5 w-5 text-brand" />
              <div><p className="text-xs text-gray-500 dark:text-gray-400">Membre depuis</p><p className="font-medium text-gray-900 dark:text-white">{new Date(user.createdAt).toLocaleDateString("fr-FR", { year: "numeric", month: "long" })}</p></div>
            </div>
          </div>

          <div className="mt-8 flex flex-wrap gap-3">
            <Link to="/settings" className="inline-flex items-center gap-2 rounded-lg border border-gray-200 dark:border-white/10 px-4 py-2 font-medium text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-white/5 transition">
              <SettingsIcon className="h-4 w-4" /> Paramètres
            </Link>
            <button onClick={handleLogout} className="inline-flex items-center gap-2 rounded-lg bg-red-50 dark:bg-red-500/10 px-4 py-2 font-medium text-red-600 dark:text-red-400 hover:bg-red-100 dark:hover:bg-red-500/20 transition">
              <LogOut className="h-4 w-4" /> Se déconnecter
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
`;

const SETTINGS_TSX = `import { useState } from "react";
import { Save, Loader2, Moon, Sun, Monitor } from "lucide-react";
import { useAuth } from "../lib/auth";
import { useTheme } from "../lib/theme";

export default function Settings() {
  const { user, updateProfile } = useAuth();
  const { theme, setTheme } = useTheme();
  const [name, setName] = useState(user?.name || "");
  const [email, setEmail] = useState(user?.email || "");
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);
  if (!user) return null;

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true); setSaved(false);
    try { await updateProfile({ name, email }); setSaved(true); setTimeout(() => setSaved(false), 2500); }
    finally { setBusy(false); }
  };

  return (
    <div className="max-w-2xl mx-auto px-4 py-16">
      <h1 className="text-3xl font-bold text-gray-900 dark:text-white">Paramètres</h1>
      <p className="mt-1 text-gray-500 dark:text-gray-400">Gère ton compte et tes préférences.</p>

      <section className="mt-8 bg-white dark:bg-white/5 rounded-2xl border border-gray-100 dark:border-white/10 p-6">
        <h2 className="text-lg font-semibold text-gray-900 dark:text-white">Profil</h2>
        <form onSubmit={save} className="mt-4 space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">Nom</label>
            <input value={name} onChange={(e) => setName(e.target.value)}
              className="mt-1 w-full rounded-lg border border-gray-200 dark:border-white/10 bg-white dark:bg-white/5 px-3 py-2 text-gray-900 dark:text-white outline-none focus:ring-2 focus:ring-brand" />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">E-mail</label>
            <input type="email" value={email} onChange={(e) => setEmail(e.target.value)}
              className="mt-1 w-full rounded-lg border border-gray-200 dark:border-white/10 bg-white dark:bg-white/5 px-3 py-2 text-gray-900 dark:text-white outline-none focus:ring-2 focus:ring-brand" />
          </div>
          <button type="submit" disabled={busy}
            className="inline-flex items-center gap-2 rounded-lg bg-brand px-4 py-2.5 font-semibold text-white hover:opacity-90 transition disabled:opacity-60">
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />} Enregistrer
          </button>
          {saved && <span className="ml-3 text-sm text-green-600 dark:text-green-400">✓ Enregistré</span>}
        </form>
      </section>

      <section className="mt-6 bg-white dark:bg-white/5 rounded-2xl border border-gray-100 dark:border-white/10 p-6">
        <h2 className="text-lg font-semibold text-gray-900 dark:text-white">Apparence</h2>
        <p className="text-sm text-gray-500 dark:text-gray-400">Choisis ton thème.</p>
        <div className="mt-4 grid grid-cols-2 gap-3 max-w-xs">
          <button onClick={() => setTheme("light")}
            className={"flex items-center justify-center gap-2 rounded-lg border px-4 py-3 font-medium transition " + (theme === "light" ? "border-brand bg-brand/10 text-brand" : "border-gray-200 dark:border-white/10 text-gray-700 dark:text-gray-300")}>
            <Sun className="h-4 w-4" /> Clair
          </button>
          <button onClick={() => setTheme("dark")}
            className={"flex items-center justify-center gap-2 rounded-lg border px-4 py-3 font-medium transition " + (theme === "dark" ? "border-brand bg-brand/10 text-brand" : "border-gray-200 dark:border-white/10 text-gray-700 dark:text-gray-300")}>
            <Moon className="h-4 w-4" /> Sombre
          </button>
        </div>
      </section>
    </div>
  );
}
`;

const HOME_TSX = (meta: AppMeta) => `export default function Home() {
  return (
    <main className="min-h-screen flex items-center justify-center bg-white text-gray-900">
      <div className="text-center">
        <h1 className="text-5xl font-bold" style={{ color: "${meta.primaryColor}" }}>
          ${meta.companyName}
        </h1>
        <p className="mt-4 text-gray-500">App en cours de génération…</p>
      </div>
    </main>
  );
}
`;

// Hono backend. AI adds real routes; checkout is wired for real Stripe.
const SERVER_INDEX = (meta: AppMeta) => `import { Hono } from "hono";
import { cors } from "hono/cors";
import { checkoutRoute } from "./stripe";
import { authRoute } from "./auth";
import { aiRoute } from "./ai";
import { dataRoute } from "./data";

const app = new Hono().basePath("/api");

app.use("*", cors());

app.get("/health", (c) => c.json({ ok: true, app: "${meta.slug}" }, 200));

// In-memory data store (upgradable to a real DB). Persists during dev session.
export const store: Record<string, any[]> = {
  orders: [],
  contacts: [],
  subscribers: [],
};

// Envoie une soumission de formulaire (contact/support) par email au
// propriétaire de l'entreprise, via le serveur Velbaz parent (qui gère le
// provider d'envoi — send-email interne puis Resend). Fire-and-forget : on ne
// bloque jamais la réponse à l'utilisateur, et on stocke toujours en mémoire.
async function forwardEmail(kind: string, body: any) {
  if (!process.env.VELBAZ_API_URL || !process.env.COMPANY_ID) return;
  try {
    await fetch(process.env.VELBAZ_API_URL + "/companies/" + process.env.COMPANY_ID + "/contact", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ kind, ...body }),
    });
  } catch {}
}

app.post("/contact", async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const entry = { id: crypto.randomUUID(), ...body, createdAt: Date.now() };
  store.contacts.push(entry);
  forwardEmail("contact", body).catch(() => {});
  return c.json({ ok: true, entry }, 200);
});

app.post("/subscribe", async (c) => {
  const body = await c.req.json().catch(() => ({}));
  store.subscribers.push({ id: crypto.randomUUID(), ...body, createdAt: Date.now() });
  forwardEmail("subscribe", body).catch(() => {});
  return c.json({ ok: true }, 200);
});

app.post("/support", async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const entry = { id: crypto.randomUUID(), ...body, createdAt: Date.now() };
  store.contacts.push(entry);
  forwardEmail("support", body).catch(() => {});
  return c.json({ ok: true, entry }, 200);
});

app.route("/", checkoutRoute);
app.route("/", authRoute);
app.route("/", aiRoute);
app.route("/", dataRoute);

export default app;
`;

// Generic persisted CRUD backend. Every app gets a REST data API out of the box
// so features actually STORE and READ data (JSON file → survives dev restarts).
// Frontend uses the \`data\` helper in lib/api.ts. Scoped per authenticated user
// when a Bearer token is present, otherwise a shared "public" scope.
const SERVER_DATA = `import { Hono } from "hono";
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";

export const dataRoute = new Hono();

const DB_FILE = ".data/data.json";
type Row = Record<string, any> & { id: string; createdAt: number; updatedAt: number; _scope: string };
type DB = Record<string, Row[]>; // collection -> rows

function load(): DB {
  try { if (existsSync(DB_FILE)) return JSON.parse(readFileSync(DB_FILE, "utf8")); } catch {}
  return {};
}
function save(db: DB) {
  try { mkdirSync(dirname(DB_FILE), { recursive: true }); writeFileSync(DB_FILE, JSON.stringify(db, null, 2)); } catch {}
}
let db: DB = load();

// Derive a data scope from the auth session file (per-user), else "public".
function scopeOf(c: any): string {
  const token = (c.req.header("authorization") || "").replace(/^Bearer\\s+/i, "");
  if (!token) return "public";
  try {
    const auth = JSON.parse(readFileSync(".data/auth.json", "utf8"));
    const uid = auth?.sessions?.[token];
    return uid ? "u:" + uid : "public";
  } catch { return "public"; }
}

function coll(name: string): Row[] { return (db[name] ||= []); }
function safeName(n: string): string { return (n || "").replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 40) || "items"; }

// List (optionally filtered by ?query fields, exact match).
dataRoute.get("/data/:collection", (c) => {
  const name = safeName(c.req.param("collection"));
  const scope = scopeOf(c);
  const q = c.req.query();
  let rows = coll(name).filter((r) => r._scope === scope);
  for (const [k, v] of Object.entries(q)) {
    if (["_sort", "_order", "_limit"].includes(k)) continue;
    rows = rows.filter((r) => String(r[k]) === String(v));
  }
  if (q._sort) {
    const dir = q._order === "asc" ? 1 : -1;
    rows = [...rows].sort((a, b) => (a[q._sort!] > b[q._sort!] ? dir : a[q._sort!] < b[q._sort!] ? -dir : 0));
  } else {
    rows = [...rows].sort((a, b) => b.createdAt - a.createdAt);
  }
  if (q._limit) rows = rows.slice(0, parseInt(q._limit) || rows.length);
  return c.json(rows.map(({ _scope, ...r }) => r), 200);
});

dataRoute.get("/data/:collection/:id", (c) => {
  const name = safeName(c.req.param("collection"));
  const scope = scopeOf(c);
  const row = coll(name).find((r) => r.id === c.req.param("id") && r._scope === scope);
  if (!row) return c.json({ error: "not_found" }, 404);
  const { _scope, ...pub } = row;
  return c.json(pub, 200);
});

dataRoute.post("/data/:collection", async (c) => {
  const name = safeName(c.req.param("collection"));
  const scope = scopeOf(c);
  const body = await c.req.json().catch(() => ({}));
  const now = Date.now();
  const row: Row = { ...body, id: body.id || crypto.randomUUID(), createdAt: now, updatedAt: now, _scope: scope };
  coll(name).push(row);
  save(db);
  const { _scope, ...pub } = row;
  return c.json(pub, 201);
});

dataRoute.put("/data/:collection/:id", async (c) => {
  const name = safeName(c.req.param("collection"));
  const scope = scopeOf(c);
  const body = await c.req.json().catch(() => ({}));
  const rows = coll(name);
  const i = rows.findIndex((r) => r.id === c.req.param("id") && r._scope === scope);
  if (i === -1) return c.json({ error: "not_found" }, 404);
  rows[i] = { ...rows[i], ...body, id: rows[i].id, _scope: scope, updatedAt: Date.now() };
  save(db);
  const { _scope, ...pub } = rows[i];
  return c.json(pub, 200);
});

dataRoute.delete("/data/:collection/:id", (c) => {
  const name = safeName(c.req.param("collection"));
  const scope = scopeOf(c);
  const rows = coll(name);
  const i = rows.findIndex((r) => r.id === c.req.param("id") && r._scope === scope);
  if (i === -1) return c.json({ error: "not_found" }, 404);
  rows.splice(i, 1);
  save(db);
  return c.json({ ok: true }, 200);
});
`;

// Real auth backend: signup/login/logout/me/profile. Passwords hashed with
// scrypt, sessions are opaque tokens. Persists to a JSON file so accounts
// survive dev restarts. Upgradable to a real DB later.
const SERVER_AUTH = `import { Hono } from "hono";
import { scryptSync, randomBytes, timingSafeEqual } from "node:crypto";
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";

export const authRoute = new Hono();

const DB_FILE = ".data/auth.json";
interface DBUser { id: string; email: string; name: string; passHash: string; createdAt: number; }
interface DB { users: DBUser[]; sessions: Record<string, string>; }

function loadDB(): DB {
  try { if (existsSync(DB_FILE)) return JSON.parse(readFileSync(DB_FILE, "utf8")); } catch {}
  return { users: [], sessions: {} };
}
function saveDB(db: DB) {
  try { mkdirSync(dirname(DB_FILE), { recursive: true }); writeFileSync(DB_FILE, JSON.stringify(db, null, 2)); } catch {}
}
let db: DB = loadDB();

function hashPassword(pw: string): string {
  const salt = randomBytes(16).toString("hex");
  const hash = scryptSync(pw, salt, 64).toString("hex");
  return salt + ":" + hash;
}
function verifyPassword(pw: string, stored: string): boolean {
  const [salt, hash] = stored.split(":");
  if (!salt || !hash) return false;
  const test = scryptSync(pw, salt, 64);
  const orig = Buffer.from(hash, "hex");
  return test.length === orig.length && timingSafeEqual(test, orig);
}
function publicUser(u: DBUser) { return { id: u.id, email: u.email, name: u.name, createdAt: u.createdAt }; }
function tokenFor(c: any): string { return (c.req.header("authorization") || "").replace(/^Bearer\\s+/i, ""); }
function currentUser(c: any): DBUser | null {
  const uid = db.sessions[tokenFor(c)];
  return uid ? db.users.find((u) => u.id === uid) || null : null;
}

authRoute.post("/auth/signup", async (c) => {
  const { name, email, password } = await c.req.json().catch(() => ({}));
  if (!name || !email || !password) return c.json({ message: "Champs manquants" }, 400);
  if (String(password).length < 6) return c.json({ message: "Mot de passe trop court (min 6)" }, 400);
  if (db.users.some((u) => u.email.toLowerCase() === String(email).toLowerCase()))
    return c.json({ message: "Cet e-mail est déjà utilisé" }, 409);
  const user: DBUser = { id: crypto.randomUUID(), email, name, passHash: hashPassword(password), createdAt: Date.now() };
  db.users.push(user);
  const token = randomBytes(24).toString("hex");
  db.sessions[token] = user.id;
  saveDB(db);
  return c.json({ token, user: publicUser(user) }, 200);
});

authRoute.post("/auth/login", async (c) => {
  const { email, password } = await c.req.json().catch(() => ({}));
  const user = db.users.find((u) => u.email.toLowerCase() === String(email || "").toLowerCase());
  if (!user || !verifyPassword(password || "", user.passHash))
    return c.json({ message: "E-mail ou mot de passe incorrect" }, 401);
  const token = randomBytes(24).toString("hex");
  db.sessions[token] = user.id;
  saveDB(db);
  return c.json({ token, user: publicUser(user) }, 200);
});

authRoute.post("/auth/logout", (c) => {
  const t = tokenFor(c);
  if (db.sessions[t]) { delete db.sessions[t]; saveDB(db); }
  return c.json({ ok: true }, 200);
});

authRoute.get("/auth/me", (c) => {
  const user = currentUser(c);
  if (!user) return c.json({ message: "Non authentifié" }, 401);
  return c.json({ user: publicUser(user) }, 200);
});

authRoute.post("/auth/profile", async (c) => {
  const user = currentUser(c);
  if (!user) return c.json({ message: "Non authentifié" }, 401);
  const { name, email } = await c.req.json().catch(() => ({}));
  if (name) user.name = name;
  if (email) user.email = email;
  saveDB(db);
  return c.json({ user: publicUser(user) }, 200);
});
`;

// Embedded AI assistant backend. Talks to the Runable AI gateway with the
// managed key inherited from the parent process env (no per-app config needed).
// Exposes POST /ai/chat (JSON) and POST /ai/stream (SSE token stream). The
// system prompt is business-specific so the assistant knows the app it lives in.
const SERVER_AI = (meta: AppMeta) => {
  const idea = (meta.idea || "").replace(/`/g, "'").slice(0, 600);
  const sys = `Tu es l'assistant IA intégré de "${meta.companyName}"${meta.tagline ? ` (${meta.tagline})` : ""}.${idea ? ` Contexte du produit: ${idea}.` : ""} Tu aides les visiteurs et les clients: tu réponds à leurs questions sur le produit, tu les guides, tu proposes des recommandations pertinentes et tu restes chaleureux, concis et utile. Réponds dans la langue de l'utilisateur. Si une demande sort de ton périmètre, oriente poliment vers le contact humain.`;
  return `import { Hono } from "hono";
import { streamText, generateText, createGateway } from "ai";

export const aiRoute = new Hono();

// The Runable-managed gateway. Keys are provided via env (inherited from the
// host); the business never has to configure anything.
const gateway = createGateway({
  baseURL: process.env.AI_GATEWAY_BASE_URL,
  apiKey: process.env.AI_GATEWAY_API_KEY,
});
const MODEL = process.env.AI_MODEL || "anthropic/claude-sonnet-4.6";

// Product-aware system prompt. Generated from the business idea at build time.
const SYSTEM_PROMPT = ${JSON.stringify(sys)};

type Msg = { role: "user" | "assistant" | "system"; content: string };

function normalize(body: any): Msg[] {
  const msgs: Msg[] = Array.isArray(body?.messages) ? body.messages : [];
  const clean = msgs
    .filter((m) => m && (m.role === "user" || m.role === "assistant") && typeof m.content === "string")
    .slice(-20);
  if (!clean.length && typeof body?.message === "string") clean.push({ role: "user", content: body.message });
  return clean;
}

function ready(): boolean { return !!(process.env.AI_GATEWAY_BASE_URL && process.env.AI_GATEWAY_API_KEY); }

// Non-streaming chat — simplest to consume from the frontend.
aiRoute.post("/ai/chat", async (c) => {
  if (!ready()) return c.json({ error: "ai_not_configured", message: "L'assistant IA n'est pas configuré." }, 503);
  const body = await c.req.json().catch(() => ({}));
  const messages = normalize(body);
  if (!messages.length) return c.json({ error: "empty" }, 400);
  try {
    const { text } = await generateText({
      model: gateway(MODEL),
      system: SYSTEM_PROMPT + (body?.systemExtra ? "\\n" + String(body.systemExtra).slice(0, 6000) : ""),
      messages,
      // Budget pilotable par le client (ex: génération d'app single-file) —
      // borné 1200-32000, défaut 16000 pour permettre de VRAIES sorties longues.
      maxOutputTokens: Math.min(Math.max(parseInt(body?.maxTokens) || 16000, 1200), 32000),
    });
    return c.json({ reply: text }, 200);
  } catch (e: any) {
    return c.json({ error: "ai_error", message: e?.message || "Erreur IA" }, 500);
  }
});

// Streaming chat — Server-Sent Events, one token chunk per "data:" line.
aiRoute.post("/ai/stream", async (c) => {
  if (!ready()) return c.json({ error: "ai_not_configured" }, 503);
  const body = await c.req.json().catch(() => ({}));
  const messages = normalize(body);
  if (!messages.length) return c.json({ error: "empty" }, 400);
  try {
    const result = streamText({
      model: gateway(MODEL),
      // [2026-09-05] Bug 21 — le "\\n" doit rester doublement échappé ici : ce
      // bloc est un template literal qui ÉCRIT le fichier server/ai.ts de l'app
      // générée. Avec un simple échappement, un VRAI saut de ligne était écrit
      // dans le littéral de chaîne du fichier généré → "Unterminated string
      // literal" → esbuild refusait de transformer server/ai.ts → TOUTE l'API
      // de l'app générée répondait 500 (aucune donnée ne se chargeait). La
      // route /ai/chat juste au-dessus, elle, était déjà correcte.
      system: SYSTEM_PROMPT + (body?.systemExtra ? "\\n" + String(body.systemExtra).slice(0, 6000) : ""),
      messages,
      // Budget pilotable par le client, borné 1200-32000 (défaut 16000) — un
      // écran générateur/éditeur doit pouvoir streamer de VRAIES sorties longues
      // (une app/un composant complet), pas être tronqué à 1200 tokens.
      maxOutputTokens: Math.min(Math.max(parseInt(body?.maxTokens) || 16000, 1200), 32000),
    });
    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      async start(controller) {
        // Le client peut fermer l'onglet en plein stream : enqueue lève alors
        // "Controller is already closed" et faisait planter la route.
        let gone = false;
        const push = (chunk: string) => {
          if (gone) return;
          try { controller.enqueue(encoder.encode(chunk)); } catch { gone = true; }
        };
        try {
          for await (const delta of result.textStream) {
            if (gone) break;
            push("data: " + JSON.stringify({ delta }) + "\\n\\n");
          }
          push("data: [DONE]\\n\\n");
        } catch (e: any) {
          push("data: " + JSON.stringify({ error: e?.message || "stream_error" }) + "\\n\\n");
        } finally {
          try { controller.close(); } catch {}
        }
      },
    });
    return new Response(stream, {
      headers: { "Content-Type": "text/event-stream", "Cache-Control": "no-cache", Connection: "keep-alive" },
    });
  } catch (e: any) {
    return c.json({ error: "ai_error", message: e?.message }, 500);
  }
});

// Lets the frontend know whether to show the assistant.
aiRoute.get("/ai/status", (c) => c.json({ ready: ready(), model: MODEL }, 200));
`;
};

// Real Stripe Checkout. Uses STRIPE_SECRET_KEY from env; falls back to a clear
// error if the business hasn't connected keys yet (so the UI can prompt them).
const SERVER_STRIPE = `import { Hono } from "hono";
import Stripe from "stripe";

export const checkoutRoute = new Hono();

function getStripe(): Stripe | null {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) return null;
  return new Stripe(key);
}

// Pays de livraison acceptés (clientèle EU/US — dropshipping).
const SHIPPING_COUNTRIES = ["US","CA","GB","FR","DE","IT","ES","NL","BE","PT","IE","AT","LU","CH","SE","DK","NO","FI","PL","CZ","GR","RO","HU"];

// Create a Stripe Checkout Session for one or more line items.
// Body: { items: [{ name, amount /* cents */, quantity, currency?, productId?, vid? }], mode?, physical? }
// productId/vid (référence produit + variante fournisseur) partent dans la
// metadata de la session → Velbaz crée la commande et lance le fulfillment.
checkoutRoute.post("/checkout", async (c) => {
  const stripe = getStripe();
  if (!stripe) {
    return c.json(
      { error: "stripe_not_connected", message: "Connecte tes clés Stripe pour activer les paiements." },
      400
    );
  }
  const body = await c.req.json().catch(() => ({}));
  const items = Array.isArray(body.items) ? body.items : [];
  if (!items.length) return c.json({ error: "no_items" }, 400);

  const origin = c.req.header("origin") || new URL(c.req.url).origin;
  // Produit physique (dropshipping) → on collecte l'adresse de livraison.
  const physical = body.physical === true || items.some((it: any) => it.productId || it.vid);
  // Références compactes pour le fulfillment: [{p: productId, v: vid, q: qty}]
  const itemsMeta = JSON.stringify(items.map((it: any) => ({ p: it.productId || null, v: it.vid || null, q: it.quantity || 1 }))).slice(0, 490);
  try {
    const session = await stripe.checkout.sessions.create({
      mode: body.mode === "subscription" ? "subscription" : "payment",
      line_items: items.map((it: any) => ({
        price_data: {
          currency: it.currency || "eur",
          product_data: { name: it.name },
          unit_amount: Math.round(it.amount),
          ...(body.mode === "subscription" ? { recurring: { interval: it.interval || "month" } } : {}),
        },
        quantity: it.quantity || 1,
      })),
      ...(physical ? { shipping_address_collection: { allowed_countries: SHIPPING_COUNTRIES as any }, phone_number_collection: { enabled: true } } : {}),
      metadata: { companyId: process.env.COMPANY_ID || "", items: itemsMeta },
      success_url: origin + "/success?session_id={CHECKOUT_SESSION_ID}",
      cancel_url: origin + "/cancel",
    });
    return c.json({ url: session.url, id: session.id }, 200);
  } catch (e: any) {
    return c.json({ error: "stripe_error", message: e?.message }, 500);
  }
});

// Verify a completed session (for the success page) + notify Velbaz so the
// order is recorded [PAYÉE] and fulfillment starts (idempotent server-side).
checkoutRoute.get("/checkout/:id", async (c) => {
  const stripe = getStripe();
  if (!stripe) return c.json({ error: "stripe_not_connected" }, 400);
  try {
    const session = await stripe.checkout.sessions.retrieve(c.req.param("id"));
    if (session.payment_status === "paid" && process.env.VELBAZ_API_URL && process.env.COMPANY_ID) {
      // Fire-and-forget: Velbaz re-vérifie la session avec sa propre clé Stripe.
      fetch(process.env.VELBAZ_API_URL + "/companies/" + process.env.COMPANY_ID + "/orders/confirm", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId: session.id }),
      }).catch(() => {});
    }
    return c.json({ status: session.payment_status, amount: session.amount_total }, 200);
  } catch (e: any) {
    return c.json({ error: e?.message }, 500);
  }
});
`;

const API_CLIENT = `// Typed fetch helper for the frontend.
// BASE_URL is "/" standalone, or the Velbaz preview proxy path in preview mode.
const API_BASE = (import.meta.env.BASE_URL || "/").replace(/\\/$/, "") + "/api";
function authHeaders(): Record<string, string> {
  try { const t = localStorage.getItem("auth_token"); return t ? { Authorization: "Bearer " + t } : {}; } catch { return {}; }
}
export async function api<T = any>(path: string, opts?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(API_BASE + path, {
      headers: { "Content-Type": "application/json", ...authHeaders(), ...(opts?.headers || {}) },
      ...opts,
    });
  } catch (networkErr: any) {
    // Erreur réseau (hors ligne, serveur qui redémarre, etc.) — jamais un token invalide.
    const e: any = new Error(networkErr?.message || "Erreur réseau");
    e.status = 0;
    throw e;
  }
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    const e: any = new Error(body.message || res.statusText);
    e.status = res.status; // 401 = session invalide, tout le reste = erreur transitoire (ne pas déconnecter)
    throw e;
  }
  return res.json();
}

// ─── Persisted data layer ─────────────────────────────────────────────────────
// A real REST-backed store (/api/data/:collection) that survives restarts and is
// scoped to the logged-in user. Use this for EVERY feature that creates/reads
// data: tasks, projects, posts, orders, listings, messages, bookings, etc.
//   const tasks = await data.list("tasks");
//   const t = await data.create("tasks", { title, done: false });
//   await data.update("tasks", t.id, { done: true });
//   await data.remove("tasks", t.id);
export const data = {
  list<T = any>(collection: string, query?: Record<string, string | number>): Promise<T[]> {
    const qs = query ? "?" + new URLSearchParams(Object.entries(query).map(([k, v]) => [k, String(v)])).toString() : "";
    return api<T[]>("/data/" + collection + qs);
  },
  get<T = any>(collection: string, id: string): Promise<T> {
    return api<T>("/data/" + collection + "/" + id);
  },
  create<T = any>(collection: string, body: Record<string, any>): Promise<T> {
    return api<T>("/data/" + collection, { method: "POST", body: JSON.stringify(body) });
  },
  update<T = any>(collection: string, id: string, body: Record<string, any>): Promise<T> {
    return api<T>("/data/" + collection + "/" + id, { method: "PUT", body: JSON.stringify(body) });
  },
  remove(collection: string, id: string): Promise<{ ok: boolean }> {
    return api("/data/" + collection + "/" + id, { method: "DELETE" });
  },
};

// Start a Stripe Checkout and redirect the user.
// Pour un produit physique du catalogue (dropshipping), passe productId et vid
// (variante fournisseur) — l'adresse de livraison sera collectée par Stripe et
// la commande fournisseur partira automatiquement après paiement.
export async function checkout(items: Array<{ name: string; amount: number; quantity?: number; currency?: string; productId?: string; vid?: string }>, mode?: "payment" | "subscription") {
  const r = await api<{ url?: string; error?: string; message?: string }>("/checkout", {
    method: "POST",
    body: JSON.stringify({ items, mode }),
  });
  if (r.url) { window.location.href = r.url; return; }
  throw new Error(r.message || r.error || "checkout_failed");
}
`;

// ─── Embedded AI client (frontend) ───────────────────────────────────────────
const AI_CLIENT = `// Client for the app's embedded AI assistant (backed by /api/ai/*).
import { api } from "./api";

export interface ChatMessage { role: "user" | "assistant"; content: string; }

// One-shot chat. Returns the assistant reply text.
export async function aiChat(messages: ChatMessage[], systemExtra?: string): Promise<string> {
  const r = await api<{ reply?: string; message?: string }>("/ai/chat", {
    method: "POST",
    body: JSON.stringify({ messages, systemExtra }),
  });
  return r.reply || "";
}

// Streaming chat via SSE. Calls onDelta with each token chunk.
export async function aiStream(
  messages: ChatMessage[],
  onDelta: (chunk: string) => void,
): Promise<void> {
  const base = (import.meta.env.BASE_URL || "/").replace(/\\/$/, "") + "/api";
  const res = await fetch(base + "/ai/stream", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ messages }),
  });
  if (!res.ok || !res.body) throw new Error("Assistant indisponible");
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    const lines = buf.split("\\n\\n");
    buf = lines.pop() || "";
    for (const line of lines) {
      const t = line.trim();
      if (!t.startsWith("data:")) continue;
      const payload = t.slice(5).trim();
      if (payload === "[DONE]") return;
      try { const j = JSON.parse(payload); if (j.delta) onDelta(j.delta); } catch {}
    }
  }
}

export async function aiReady(): Promise<boolean> {
  try { const r = await api<{ ready: boolean }>("/ai/status"); return !!r.ready; } catch { return false; }
}
`;

// ─── Embedded AI assistant widget (floating chat, dark-aware) ────────────────
const AI_ASSISTANT_TSX = `import { useState, useRef, useEffect } from "react";
import { MessageCircle, X, Send, Loader2, Sparkles } from "lucide-react";
import { aiStream, type ChatMessage } from "../lib/ai";

// Floating AI assistant available on every page. Streams replies token-by-token.
export default function AIAssistant() {
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([
    { role: "assistant", content: "Bonjour 👋 Je suis votre assistant. Comment puis-je vous aider ?" },
  ]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => { scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" }); }, [messages, open]);

  const send = async () => {
    const text = input.trim();
    if (!text || busy) return;
    const next: ChatMessage[] = [...messages, { role: "user", content: text }];
    setMessages(next);
    setInput("");
    setBusy(true);
    setMessages((m) => [...m, { role: "assistant", content: "" }]);
    try {
      await aiStream(next, (delta) => {
        setMessages((m) => {
          const copy = [...m];
          copy[copy.length - 1] = { role: "assistant", content: copy[copy.length - 1].content + delta };
          return copy;
        });
      });
    } catch {
      setMessages((m) => {
        const copy = [...m];
        copy[copy.length - 1] = { role: "assistant", content: "Désolé, l'assistant est momentanément indisponible." };
        return copy;
      });
    } finally { setBusy(false); }
  };

  return (
    <>
      <button
        onClick={() => setOpen((o) => !o)}
        aria-label="Assistant IA"
        className="fixed bottom-5 right-5 z-50 inline-flex h-14 w-14 items-center justify-center rounded-full bg-brand text-white shadow-lg shadow-brand/30 hover:scale-105 active:scale-95 transition"
      >
        {open ? <X className="h-6 w-6" /> : <MessageCircle className="h-6 w-6" />}
      </button>

      {open && (
        <div className="fixed bottom-24 right-5 z-50 flex h-[32rem] w-[92vw] max-w-sm flex-col overflow-hidden rounded-2xl border border-gray-200 dark:border-white/10 bg-white dark:bg-[#0b0f19] shadow-2xl">
          <div className="flex items-center gap-2 border-b border-gray-100 dark:border-white/10 bg-gradient-to-r from-brand to-accent px-4 py-3 text-white">
            <Sparkles className="h-5 w-5" />
            <div>
              <p className="text-sm font-semibold leading-none">Assistant IA</p>
              <p className="text-[11px] opacity-80">En ligne</p>
            </div>
          </div>

          <div ref={scrollRef} className="flex-1 space-y-3 overflow-y-auto px-4 py-4">
            {messages.map((m, i) => (
              <div key={i} className={m.role === "user" ? "flex justify-end" : "flex justify-start"}>
                <div className={
                  "max-w-[85%] whitespace-pre-wrap rounded-2xl px-3.5 py-2 text-sm " +
                  (m.role === "user"
                    ? "bg-brand text-white rounded-br-sm"
                    : "bg-gray-100 dark:bg-white/5 text-gray-800 dark:text-gray-100 rounded-bl-sm")
                }>
                  {m.content || (busy && i === messages.length - 1 ? <Loader2 className="h-4 w-4 animate-spin" /> : "")}
                </div>
              </div>
            ))}
          </div>

          <div className="border-t border-gray-100 dark:border-white/10 p-3">
            <div className="flex items-center gap-2">
              <input
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") send(); }}
                placeholder="Écrivez votre message…"
                className="flex-1 rounded-full border border-gray-200 dark:border-white/10 bg-gray-50 dark:bg-white/5 px-4 py-2 text-sm text-gray-900 dark:text-white outline-none focus:ring-2 focus:ring-brand"
              />
              <button onClick={send} disabled={busy || !input.trim()}
                className="inline-flex h-9 w-9 items-center justify-center rounded-full bg-brand text-white hover:opacity-90 transition disabled:opacity-50">
                {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
`;

// ─── Standard pages (deterministic, no LLM cost) ─────────────────────────────
// Every complete product ships these. Generated from templates so they're
// always present, always compile, and stay on-brand. The AI engine focuses its
// budget on the functional screens instead.

// Generic legal-page renderer. Every legal page (Terms, Privacy, Legal Notice,
// Cookies) reads its content from the shared `LEGAL` data object in
// src/lib/legal-content.ts (produced by the dedicated legal AI, country-adapted)
// so the copy stays consistent, editable, and covered by checkpoints.
const LEGAL_PAGE_TSX = (component: string, docKey: "terms" | "privacy" | "legalNotice" | "cookies", meta: AppMeta) => {
  const fr = (meta.lang || "fr") !== "en";
  const locale = fr ? "fr-FR" : "en-US";
  const updated = fr ? "Dernière mise à jour" : "Last updated";
  const juris = fr ? "Cadre applicable" : "Applicable framework";
  return `import { LEGAL } from "../lib/legal-content";

export default function ${component}() {
  const doc = LEGAL.${docKey};
  return (
    <section className="mx-auto max-w-3xl px-4 py-16">
      <h1 className="text-3xl font-bold text-gray-900 dark:text-white">{doc.title}</h1>
      <p className="mt-2 text-sm text-gray-500 dark:text-gray-400">
        ${updated}: {new Date(LEGAL.lastUpdated).toLocaleDateString("${locale}", { year: "numeric", month: "long", day: "numeric" })}
        {LEGAL.frameworks?.length ? " · ${juris}: " + LEGAL.frameworks.join(", ") : ""}
      </p>
      {doc.intro && <p className="mt-4 text-gray-600 dark:text-gray-300">{doc.intro}</p>}
      <div className="mt-8 max-w-none space-y-6 text-gray-600 dark:text-gray-300">
        {doc.sections.map((s, i) => (
          <div key={i}>
            <h2 className="text-xl font-semibold text-gray-900 dark:text-white">{s.heading}</h2>
            <p className="mt-1">{s.body}</p>
          </div>
        ))}
      </div>
    </section>
  );
}
`;
};

const TERMS_TSX = (meta: AppMeta) => LEGAL_PAGE_TSX("Terms", "terms", meta);
const PRIVACY_TSX = (meta: AppMeta) => LEGAL_PAGE_TSX("Privacy", "privacy", meta);
const LEGAL_NOTICE_TSX = (meta: AppMeta) => LEGAL_PAGE_TSX("LegalNotice", "legalNotice", meta);
const COOKIES_TSX = (meta: AppMeta) => LEGAL_PAGE_TSX("Cookies", "cookies", meta);

// Cookie-consent banner. Reads copy from the country-adapted legal pack and
// persists the visitor's choice in localStorage (accept / reject non-essential).
const COOKIE_BANNER_TSX = `import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { COOKIE_BANNER } from "../lib/legal-content";

const KEY = "cookie-consent";

export default function CookieBanner() {
  const [visible, setVisible] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    try { if (!localStorage.getItem(KEY)) setVisible(true); } catch { setVisible(true); }
  }, []);

  const choose = (choice: "all" | "essential") => {
    try {
      localStorage.setItem(KEY, JSON.stringify({ choice, at: new Date().toISOString() }));
    } catch { /* storage may be unavailable */ }
    setSaved(true);
    window.setTimeout(() => setVisible(false), 900);
  };

  if (!visible) return null;
  return (
    <div className="fixed inset-x-0 bottom-0 z-[60] p-3 sm:p-4">
      <div className="mx-auto max-w-4xl rounded-2xl border border-gray-200 dark:border-white/10 bg-white/95 dark:bg-[#0b0f19]/95 backdrop-blur shadow-2xl p-4 sm:p-5">
        {saved ? (
          <p className="text-sm text-gray-700 dark:text-gray-200">{COOKIE_BANNER.savedNote || "✓"}</p>
        ) : (
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-sm text-gray-600 dark:text-gray-300">
              {COOKIE_BANNER.message}{" "}
              <Link to="/cookies" className="underline hover:text-brand">{COOKIE_BANNER.learnMore}</Link>
            </p>
            <div className="flex shrink-0 items-center gap-2">
              <button onClick={() => choose("essential")}
                className="rounded-full border border-gray-300 dark:border-white/15 px-4 py-2 text-sm font-medium text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-white/5 transition">
                {COOKIE_BANNER.reject}
              </button>
              <button onClick={() => choose("all")}
                className="rounded-full bg-brand px-4 py-2 text-sm font-semibold text-white hover:opacity-90 transition">
                {COOKIE_BANNER.accept}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
`;

const SUPPORT_TSX = (meta: AppMeta) => {
  const fr = (meta.lang || "fr") !== "en";
  const co = meta.companyName;
  const faqs = fr
    ? [
        ["Comment créer un compte ?", `Cliquez sur « S'inscrire » en haut à droite, renseignez votre e-mail et un mot de passe, et vous êtes prêt à utiliser ${co}.`],
        ["Comment gérer mon abonnement ?", "Rendez-vous dans la page Facturation depuis votre compte pour changer, mettre à niveau ou annuler votre plan à tout moment."],
        ["Puis-je annuler à tout moment ?", "Oui. L'annulation prend effet à la fin de la période en cours et aucun montant supplémentaire n'est débité."],
        ["Comment réinitialiser mon mot de passe ?", "Sur la page de connexion, utilisez le lien de réinitialisation ; vous recevrez un e-mail pour définir un nouveau mot de passe."],
        ["Mes données sont-elles sécurisées ?", "Oui, nous appliquons des mesures de sécurité standard de l'industrie. Consultez notre politique de confidentialité pour plus de détails."],
      ]
    : [
        ["How do I create an account?", `Click "Sign up" at the top right, enter your email and a password, and you're ready to use ${co}.`],
        ["How do I manage my subscription?", "Go to the Billing page from your account to change, upgrade or cancel your plan anytime."],
        ["Can I cancel anytime?", "Yes. Cancellation takes effect at the end of the current period and no further charges are made."],
        ["How do I reset my password?", "On the login page, use the reset link; you'll receive an email to set a new password."],
        ["Is my data secure?", "Yes, we apply industry-standard security measures. See our privacy policy for details."],
      ];
  return `import { useState } from "react";
import { Mail, ChevronDown, MessageSquare, LifeBuoy } from "lucide-react";
import { api } from "../lib/api";

const FAQS: [string, string][] = ${JSON.stringify(faqs)};

export default function Support() {
  const [open, setOpen] = useState<number | null>(0);
  const [form, setForm] = useState({ name: "", email: "", message: "" });
  const [sent, setSent] = useState(false);
  const [sending, setSending] = useState(false);
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSending(true);
    try { await api("/support", { method: "POST", body: JSON.stringify(form) }); } catch {}
    setSending(false); setSent(true); setForm({ name: "", email: "", message: "" });
  };
  return (
    <section className="mx-auto max-w-4xl px-4 py-16">
      <div className="flex items-center gap-3">
        <LifeBuoy className="h-7 w-7 text-brand" />
        <h1 className="text-3xl font-bold text-gray-900 dark:text-white">${fr ? "Aide & Support" : "Help & Support"}</h1>
      </div>
      <p className="mt-3 text-gray-600 dark:text-gray-300">${fr ? "Une question ? Consultez la FAQ ou écrivez-nous, nous répondons rapidement." : "Got a question? Check the FAQ or reach out — we reply fast."}</p>

      <div className="mt-10 grid gap-10 md:grid-cols-2">
        <div>
          <h2 className="mb-4 text-lg font-semibold text-gray-900 dark:text-white">${fr ? "Questions fréquentes" : "Frequently asked questions"}</h2>
          <div className="space-y-2">
            {FAQS.map(([q, a], i) => (
              <div key={i} className="rounded-xl border border-gray-200 dark:border-white/10">
                <button onClick={() => setOpen(open === i ? null : i)} className="flex w-full items-center justify-between px-4 py-3 text-left font-medium text-gray-900 dark:text-white">
                  {q}
                  <ChevronDown className={"h-4 w-4 transition-transform " + (open === i ? "rotate-180" : "")} />
                </button>
                {open === i && <p className="px-4 pb-4 text-sm text-gray-600 dark:text-gray-300">{a}</p>}
              </div>
            ))}
          </div>
        </div>

        <div>
          <h2 className="mb-4 flex items-center gap-2 text-lg font-semibold text-gray-900 dark:text-white"><MessageSquare className="h-5 w-5 text-brand" /> ${fr ? "Nous contacter" : "Contact us"}</h2>
          {sent ? (
            <div className="rounded-xl border border-green-200 bg-green-50 p-6 text-green-800 dark:border-green-500/20 dark:bg-green-500/10 dark:text-green-300">${fr ? "Merci ! Votre message a bien été envoyé. Nous revenons vers vous très vite." : "Thanks! Your message was sent. We'll get back to you shortly."}</div>
          ) : (
            <form onSubmit={submit} className="space-y-4">
              <input required value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} placeholder="${fr ? "Votre nom" : "Your name"}" className="w-full rounded-lg border border-gray-300 bg-white px-4 py-2.5 text-gray-900 outline-none focus:border-brand dark:border-white/10 dark:bg-white/5 dark:text-white" />
              <input required type="email" value={form.email} onChange={e => setForm({ ...form, email: e.target.value })} placeholder="${fr ? "Votre e-mail" : "Your email"}" className="w-full rounded-lg border border-gray-300 bg-white px-4 py-2.5 text-gray-900 outline-none focus:border-brand dark:border-white/10 dark:bg-white/5 dark:text-white" />
              <textarea required value={form.message} onChange={e => setForm({ ...form, message: e.target.value })} placeholder="${fr ? "Comment pouvons-nous aider ?" : "How can we help?"}" rows={5} className="w-full rounded-lg border border-gray-300 bg-white px-4 py-2.5 text-gray-900 outline-none focus:border-brand dark:border-white/10 dark:bg-white/5 dark:text-white" />
              <button disabled={sending} className="inline-flex items-center gap-2 rounded-lg bg-brand px-5 py-2.5 font-semibold text-white hover:opacity-90 disabled:opacity-60"><Mail className="h-4 w-4" /> ${fr ? "Envoyer" : "Send"}</button>
            </form>
          )}
        </div>
      </div>
    </section>
  );
}
`;
};

const NOTFOUND_TSX = (meta: AppMeta) => {
  const fr = (meta.lang || "fr") !== "en";
  return `import { Link } from "react-router-dom";

export default function NotFound() {
  return (
    <section className="flex min-h-[70vh] flex-col items-center justify-center px-4 text-center">
      <p className="text-7xl font-black text-brand">404</p>
      <h1 className="mt-4 text-2xl font-bold text-gray-900 dark:text-white">${fr ? "Page introuvable" : "Page not found"}</h1>
      <p className="mt-2 max-w-md text-gray-500 dark:text-gray-400">${fr ? "La page que vous cherchez a été déplacée ou n'existe plus." : "The page you're looking for was moved or no longer exists."}</p>
      <Link to="/" className="mt-6 inline-block rounded-lg bg-brand px-5 py-2.5 font-semibold text-white hover:opacity-90">${fr ? "Retour à l'accueil" : "Back home"}</Link>
    </section>
  );
}
`;
};


// ── Liquid : effet "liquid metal" (WebGL) réutilisable ──────────────────────
// Composant prêt à l'emploi que l'IA peut poser n'importe où (fond de hero,
// carte, bouton, section décorative…). Supporte :
//   • animated={false}  → liquide FIGÉ (speed 0, aucun coût CPU, ne bouge pas)
//   • animated={true}   → liquide qui bouge (défaut)
//   • shape             → "none" | "circle" | "daisy" | "diamond" | "metaballs"
//   • preset            → "default" | "noir" | "backdrop" | "stripes"
//   • image             → URL/HTMLImageElement : le liquide épouse l'image
//   • + tous les paramètres du shader (colorBack, colorTint, repetition,
//     softness, distortion, contour, shiftRed, shiftBlue, angle, scale,
//     rotation, offsetX, offsetY, speed, fit…)
// Rien n'oblige à l'utiliser : c'est une option décorative parmi d'autres.
const LIQUID_TSX = `import { Suspense, type CSSProperties } from "react";
import { LiquidMetal, liquidMetalPresets, type LiquidMetalProps } from "@paper-design/shaders-react";

export type LiquidShape = "none" | "circle" | "daisy" | "diamond" | "metaballs";
export type LiquidPreset = "default" | "noir" | "backdrop" | "stripes";

// Index des presets officiels par nom (insensible à la casse).
const PRESETS: Record<string, Record<string, unknown>> = (() => {
  const map: Record<string, Record<string, unknown>> = {};
  for (const p of liquidMetalPresets) {
    map[String((p as any).name || "").toLowerCase()] = (p as any).params as Record<string, unknown>;
  }
  return map;
})();

export interface LiquidProps extends Partial<LiquidMetalProps> {
  /** Preset de départ : "default" | "noir" | "backdrop" | "stripes". */
  preset?: LiquidPreset | string;
  /** false = figé (ne bouge pas, speed 0). true = animé. Défaut: true. */
  animated?: boolean;
  className?: string;
  style?: CSSProperties;
}

/**
 * <Liquid /> — fond/décor "liquid metal".
 * Exemples :
 *   <Liquid preset="default" style={{ position:"absolute", inset:0 }} />
 *   <Liquid animated={false} shape="metaballs" colorTint="#7c3aed" />
 *   <Liquid image="/logo.png" shape="none" />
 */
export default function Liquid({ preset, animated = true, shape, className, style, ...rest }: LiquidProps) {
  const base = preset ? (PRESETS[String(preset).toLowerCase()] || {}) : {};
  const params: Record<string, unknown> = { ...base, ...(rest as Record<string, unknown>) };
  if (shape !== undefined) params.shape = shape;
  // Statique => speed 0 (stoppe la boucle de rendu). Sinon on garde la vitesse
  // fournie, ou celle du preset, ou 1 par défaut.
  const providedSpeed = (rest as any).speed;
  params.speed = animated ? (providedSpeed ?? (base as any).speed ?? 1) : 0;
  return (
    <Suspense fallback={<div className={className} style={style} aria-hidden />}>
      <LiquidMetal
        {...(params as object)}
        className={className}
        style={{ width: "100%", height: "100%", ...style }}
      />
    </Suspense>
  );
}
`;

const GRADIENT_BG_TSX = `import { useRef, useMemo, Suspense, type CSSProperties } from "react";
import { Canvas, useFrame } from "@react-three/fiber";
import * as THREE from "three";

export type GradientShape =
  | "diagonal"
  | "radial"
  | "horizontal"
  | "vertical"
  | "conic"
  | "waves";

const SHAPE_INDEX: Record<GradientShape, number> = {
  diagonal: 0,
  radial: 1,
  horizontal: 2,
  vertical: 3,
  conic: 4,
  waves: 5,
};

export interface GradientBackgroundProps {
  /** 2 à 4 couleurs, du plus sombre au plus clair. Défaut: bleu. */
  colors?: string[];
  /** Forme / direction du dégradé. Défaut: "diagonal". */
  shape?: GradientShape;
  /** Vitesse d'animation. 0 = figé (aucun coût CPU). Défaut: 1. */
  speed?: number;
  /** Tramage rétro (bandes façon 8-bit). Défaut: true. */
  dither?: boolean;
  /** Intensité du bruit organique 0..1. Défaut: 0.25. */
  grain?: number;
  /** Fondu clair dans le coin bas-gauche (comme un halo). Défaut: false. */
  fadeCorner?: boolean;
  className?: string;
  style?: CSSProperties;
}

const vertexShader = \`
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
\`;

const fragmentShader = \`
uniform float uTime;
uniform vec3 uColor0;
uniform vec3 uColor1;
uniform vec3 uColor2;
uniform vec3 uColor3;
uniform int uShape;
uniform float uGrain;
uniform float uDither;
uniform float uFadeCorner;
varying vec2 vUv;

vec3 permute(vec3 x) { return mod(((x*34.0)+1.0)*x, 289.0); }

float snoise(vec2 v){
  const vec4 C = vec4(0.211324865405187, 0.366025403784439,
           -0.577350269189626, 0.024390243902439);
  vec2 i  = floor(v + dot(v, C.yy));
  vec2 x0 = v - i + dot(i, C.xx);
  vec2 i1;
  i1 = (x0.x > x0.y) ? vec2(1.0, 0.0) : vec2(0.0, 1.0);
  vec4 x12 = x0.xyxy + C.xxzz;
  x12.xy -= i1;
  i = mod(i, 289.0);
  vec3 p = permute( permute( i.y + vec3(0.0, i1.y, 1.0))
  + i.x + vec3(0.0, i1.x, 1.0));
  vec3 m = max(0.5 - vec3(dot(x0,x0), dot(x12.xy,x12.xy), dot(x12.zw,x12.zw)), 0.0);
  m = m*m; m = m*m;
  vec3 x = 2.0 * fract(p * C.www) - 1.0;
  vec3 h = abs(x) - 0.5;
  vec3 ox = floor(x + 0.5);
  vec3 a0 = x - ox;
  m *= 1.79284291400159 - 0.85373472095314 * ( a0*a0 + h*h );
  vec3 g;
  g.x  = a0.x  * x0.x  + h.x  * x0.y;
  g.yz = a0.yz * x12.xz + h.yz * x12.yw;
  return 130.0 * dot(m, g);
}

float bayer4x4(vec2 uv) {
  int x = int(mod(uv.x, 4.0));
  int y = int(mod(uv.y, 4.0));
  int m[16];
  m[0]=0; m[1]=8; m[2]=2; m[3]=10;
  m[4]=12; m[5]=4; m[6]=14; m[7]=6;
  m[8]=3; m[9]=11; m[10]=1; m[11]=9;
  m[12]=15; m[13]=7; m[14]=13; m[15]=5;
  return float(m[y*4+x]) / 16.0;
}

vec3 ramp(float t) {
  t = clamp(t, 0.0, 1.0);
  if (t < 0.3333) return mix(uColor0, uColor1, t / 0.3333);
  else if (t < 0.6666) return mix(uColor1, uColor2, (t - 0.3333) / 0.3333);
  return mix(uColor2, uColor3, (t - 0.6666) / 0.3334);
}

void main() {
  vec2 uv = vUv;
  float coord = 0.5;
  if (uShape == 0) coord = (uv.x + uv.y) * 0.5;          // diagonal
  else if (uShape == 1) coord = 1.0 - length(uv - 0.5) * 1.4; // radial
  else if (uShape == 2) coord = uv.x;                     // horizontal
  else if (uShape == 3) coord = uv.y;                     // vertical
  else if (uShape == 4) {                                 // conic
    vec2 d = uv - 0.5;
    coord = (atan(d.y, d.x) + 3.14159265) / 6.2831853;
  } else if (uShape == 5) {                               // waves
    coord = uv.y + sin(uv.x * 6.2831853 + uTime * 0.6) * 0.12
                 + sin(uv.x * 12.0 - uTime * 0.3) * 0.05;
  }

  float noise = snoise(uv * 1.5 + vec2(uTime * 0.05, uTime * 0.03)) * uGrain;
  float t = coord * 1.15 + noise;

  vec3 color;
  if (uDither > 0.5) {
    float d = bayer4x4(gl_FragCoord.xy);
    float steps = 4.0;
    float q = floor(t * steps + d) / steps;
    color = ramp(q);
  } else {
    color = ramp(t);
  }

  if (uFadeCorner > 0.5) {
    float fadeMask = smoothstep(0.0, 0.28, length(uv));
    color = mix(vec3(1.0), color, fadeMask);
  }

  float vignette = smoothstep(1.25, 0.3, length(uv - 0.5));
  color = mix(color, color * 0.95, (1.0 - vignette) * 0.3);

  gl_FragColor = vec4(color, 1.0);
}
\`;

function hexToRgb(hex: string): [number, number, number] {
  let h = hex.replace("#", "").trim();
  if (h.length === 3) h = h.split("").map((c) => c + c).join("");
  const n = parseInt(h || "000000", 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function rgbToHex(r: number, g: number, b: number): string {
  const to = (v: number) => Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, "0");
  return "#" + to(r) + to(g) + to(b);
}

// Échantillonne un dégradé continu sur les couleurs fournies (t dans [0,1]).
function sampleGradient(stops: string[], t: number): string {
  if (stops.length === 1) return stops[0];
  const x = Math.max(0, Math.min(1, t)) * (stops.length - 1);
  const i = Math.floor(x);
  if (i >= stops.length - 1) return stops[stops.length - 1];
  const f = x - i;
  const a = hexToRgb(stops[i]);
  const b = hexToRgb(stops[i + 1]);
  return rgbToHex(a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f, a[2] + (b[2] - a[2]) * f);
}

// Toujours ramener à 4 arrêts lissés uniformément (2 couleurs => dégradé plein
// sur toute la surface, identique à un dégradé deux tons classique).
function normalizeColors(colors?: string[]): string[] {
  const src = colors && colors.length ? colors : ["#0f172a", "#3b82f6", "#93c5fd", "#f0f9ff"];
  if (src.length === 1) return [src[0], src[0], src[0], src[0]];
  return [0, 1, 2, 3].map((i) => sampleGradient(src, i / 3));
}

function Plane(props: Required<Pick<GradientBackgroundProps, "colors" | "shape" | "speed" | "dither" | "grain" | "fadeCorner">>) {
  const meshRef = useRef<THREE.Mesh>(null);
  const cols = normalizeColors(props.colors);
  const uniforms = useMemo(
    () => ({
      uTime: { value: 0 },
      uColor0: { value: new THREE.Color(cols[0]) },
      uColor1: { value: new THREE.Color(cols[1]) },
      uColor2: { value: new THREE.Color(cols[2]) },
      uColor3: { value: new THREE.Color(cols[3]) },
      uShape: { value: SHAPE_INDEX[props.shape] ?? 0 },
      uGrain: { value: props.grain },
      uDither: { value: props.dither ? 1 : 0 },
      uFadeCorner: { value: props.fadeCorner ? 1 : 0 },
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  useFrame((state) => {
    uniforms.uTime.value = state.clock.getElapsedTime() * props.speed;
    uniforms.uColor0.value.set(cols[0]);
    uniforms.uColor1.value.set(cols[1]);
    uniforms.uColor2.value.set(cols[2]);
    uniforms.uColor3.value.set(cols[3]);
    uniforms.uShape.value = SHAPE_INDEX[props.shape] ?? 0;
    uniforms.uGrain.value = props.grain;
    uniforms.uDither.value = props.dither ? 1 : 0;
    uniforms.uFadeCorner.value = props.fadeCorner ? 1 : 0;
  });

  return (
    <mesh ref={meshRef} scale={[2, 2, 1]}>
      <planeGeometry args={[2, 2]} />
      <shaderMaterial
        vertexShader={vertexShader}
        fragmentShader={fragmentShader}
        uniforms={uniforms}
        transparent
        depthWrite={false}
        depthTest={false}
      />
    </mesh>
  );
}

/**
 * <GradientBackground /> — fond dégradé animé en shader (WebGL/three.js).
 * Couleurs ET forme entièrement éditables. À poser en fond absolu.
 * Exemples :
 *   <GradientBackground className="absolute inset-0 -z-10" />
 *   <GradientBackground colors={["#3b0764","#a855f7","#f0abfc"]} shape="radial" />
 *   <GradientBackground colors={["#052e16","#22c55e"]} shape="waves" speed={0.6} />
 *   <GradientBackground shape="diagonal" speed={0} dither />  // figé
 */
export default function GradientBackground({
  colors,
  shape = "diagonal",
  speed = 1,
  dither = true,
  grain = 0.25,
  fadeCorner = false,
  className,
  style,
}: GradientBackgroundProps) {
  const c = normalizeColors(colors);
  return (
    <div
      className={className}
      style={{ position: "absolute", inset: 0, pointerEvents: "none", ...style }}
      aria-hidden
    >
      <Suspense fallback={null}>
        <Canvas
          camera={{ position: [0, 0, 1] }}
          dpr={[1, 1]}
          frameloop={speed === 0 ? "demand" : "always"}
          gl={{ antialias: false, alpha: true }}
        >
          <Plane colors={c} shape={shape} speed={speed} dither={dither} grain={grain} fadeCorner={fadeCorner} />
        </Canvas>
      </Suspense>
    </div>
  );
}
`;

const SOUND_TSX = `import { createContext, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { AUDIO, AUDIO_META } from "./audio";

// Système de son OPTIONNEL. Ne joue JAMAIS rien en autoplay : les sfx sont
// déclenchés par une interaction, l'ambiance par un bouton. Un mute global est
// persisté dans localStorage. Sûr même si aucun son n'existe (no-op).

type SoundCtx = {
  muted: boolean;
  setMuted: (v: boolean) => void;
  toggleMuted: () => void;
  play: (key: string) => void;
  ambientKey: string | null;
  ambientPlaying: boolean;
  toggleAmbient: (key?: string) => void;
  hasAudio: boolean;
  hasAmbient: boolean;
};

const Ctx = createContext<SoundCtx | null>(null);
const STORAGE_KEY = "velbaz:sound:muted";

// Première clé de type "music" = piste d'ambiance par défaut.
function defaultAmbient(): string | null {
  for (const k of Object.keys(AUDIO)) {
    if (AUDIO_META[k]?.kind === "music") return k;
  }
  return null;
}

export function SoundProvider({ children }: { children: ReactNode }) {
  const hasAudio = Object.keys(AUDIO).length > 0;
  const ambientDefault = useMemo(defaultAmbient, []);
  const [muted, setMutedState] = useState<boolean>(() => {
    if (typeof window === "undefined") return false;
    return window.localStorage.getItem(STORAGE_KEY) === "1";
  });
  const [ambientKey, setAmbientKey] = useState<string | null>(null);
  const [ambientPlaying, setAmbientPlaying] = useState(false);
  const ambientRef = useRef<HTMLAudioElement | null>(null);

  const setMuted = (v: boolean) => {
    setMutedState(v);
    try { window.localStorage.setItem(STORAGE_KEY, v ? "1" : "0"); } catch { /* ignore */ }
  };
  const toggleMuted = () => setMuted(!muted);

  // Coupe/reprend l'ambiance quand on (dé)coupe le son.
  useEffect(() => {
    const el = ambientRef.current;
    if (!el) return;
    if (muted) el.pause();
    else if (ambientPlaying) void el.play().catch(() => {});
  }, [muted, ambientPlaying]);

  const play = (key: string) => {
    if (muted || !hasAudio) return;
    const src = AUDIO[key];
    if (!src) return;
    try {
      const a = new Audio(src);
      a.volume = 0.6;
      void a.play().catch(() => {});
    } catch { /* ignore */ }
  };

  const toggleAmbient = (key?: string) => {
    const target = key || ambientKey || ambientDefault;
    if (!target || !AUDIO[target]) return;
    // Nouvelle piste demandée → on remplace l'élément courant.
    if (!ambientRef.current || ambientKey !== target) {
      ambientRef.current?.pause();
      const a = new Audio(AUDIO[target]);
      a.loop = true;
      a.volume = 0.35;
      ambientRef.current = a;
      setAmbientKey(target);
      if (!muted) void a.play().catch(() => {});
      setAmbientPlaying(true);
      return;
    }
    // Même piste → toggle play/pause.
    const el = ambientRef.current;
    if (ambientPlaying) { el.pause(); setAmbientPlaying(false); }
    else { if (!muted) void el.play().catch(() => {}); setAmbientPlaying(true); }
  };

  useEffect(() => () => { ambientRef.current?.pause(); ambientRef.current = null; }, []);

  const value: SoundCtx = {
    muted, setMuted, toggleMuted, play,
    ambientKey, ambientPlaying, toggleAmbient,
    hasAudio, hasAmbient: !!ambientDefault,
  };
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

// Hook sûr : renvoie des no-ops si aucun SoundProvider n'englobe l'arbre.
export function useSound(): SoundCtx {
  const ctx = useContext(Ctx);
  if (ctx) return ctx;
  return {
    muted: false, setMuted: () => {}, toggleMuted: () => {}, play: () => {},
    ambientKey: null, ambientPlaying: false, toggleAmbient: () => {},
    hasAudio: false, hasAmbient: false,
  };
}
`;

const SOUND_TOGGLE_TSX = `import { Volume2, VolumeX } from "lucide-react";
import { useSound } from "../lib/sound";

// Bouton de coupure global. Ne s'affiche QUE si le projet a des sons — sinon il
// se retire complètement (aucun encombrement pour les sites sans audio).
export default function SoundToggle({ className = "" }: { className?: string }) {
  const { muted, toggleMuted, hasAudio } = useSound();
  if (!hasAudio) return null;
  return (
    <button
      type="button"
      onClick={toggleMuted}
      aria-label={muted ? "Activer le son" : "Couper le son"}
      title={muted ? "Activer le son" : "Couper le son"}
      className={\`fixed bottom-4 left-4 z-50 flex h-11 w-11 items-center justify-center rounded-full border border-black/10 bg-white/80 text-gray-800 shadow-lg backdrop-blur transition hover:scale-105 dark:border-white/10 dark:bg-white/10 dark:text-gray-100 \${className}\`}
    >
      {muted ? <VolumeX className="h-5 w-5" /> : <Volume2 className="h-5 w-5" />}
    </button>
  );
}
`;

export function buildScaffold(meta: AppMeta): ScaffoldFile[] {
  // ── MODE CLONE ────────────────────────────────────────────────────────────
  // On recrée le site source À L'IDENTIQUE : on NE génère PAS les pages standard
  // inventées (auth, légales, support), NI la bannière cookies. Seules les vraies
  // pages scrapées seront construites. On garde toute l'infra (api, brand, theme,
  // auth lib, layout, serveur) pour que l'app reste bootable et éditable ensuite.
  if (meta.cloneMode) {
    return [
      { path: "package.json", content: PKG_JSON(meta) },
      { path: "vite.config.ts", content: VITE_CONFIG },
      { path: "vite.api.js", content: VITE_API_PLUGIN },
      { path: "tsconfig.json", content: TSCONFIG },
      { path: "index.html", content: INDEX_HTML(meta) },
      { path: "tailwind.config.js", content: TAILWIND_CONFIG(meta) },
      { path: "postcss.config.js", content: POSTCSS_CONFIG },
      { path: "src/styles.css", content: STYLES_CSS },
      { path: "src/app-entry.tsx", content: MAIN_TSX },
      { path: "src/App.tsx", content: APP_TSX(meta) },
      { path: "src/pages/Home.tsx", content: HOME_TSX(meta) },
      { path: "src/lib/api.ts", content: API_CLIENT },
      { path: "src/lib/brand.ts", content: BRAND_TS(meta) },
      { path: "src/lib/images.ts", content: IMAGES_TS() },
      { path: "src/lib/ai.ts", content: AI_CLIENT },
      { path: "src/lib/theme.tsx", content: THEME_TSX },
      { path: "src/lib/auth.tsx", content: AUTH_TSX },
      { path: "src/lib/error-boundary.tsx", content: ERROR_BOUNDARY_TSX },
      { path: "src/components/Layout.tsx", content: LAYOUT_TSX(meta) },
      { path: "src/components/ThemeToggle.tsx", content: THEME_TOGGLE_TSX },
      { path: "src/components/Liquid.tsx", content: LIQUID_TSX },
      { path: "src/components/GradientBackground.tsx", content: GRADIENT_BG_TSX },
      { path: "src/pages/NotFound.tsx", content: NOTFOUND_TSX(meta) },
      { path: "server/index.ts", content: SERVER_INDEX(meta) },
      { path: "server/stripe.ts", content: SERVER_STRIPE },
      { path: "server/auth.ts", content: SERVER_AUTH },
      { path: "server/ai.ts", content: SERVER_AI(meta) },
      { path: "server/data.ts", content: SERVER_DATA },
    ];
  }
  // Pages d'auth: générées seulement si l'app a un système de compte.
  // withAuth === false → on ne les crée pas (buildAppTsx ne les route pas non plus).
  const authPages: ScaffoldFile[] = meta.withAuth === false ? [] : [
    { path: "src/pages/Login.tsx", content: LOGIN_TSX },
    { path: "src/pages/Signup.tsx", content: SIGNUP_TSX(meta) },
    { path: "src/pages/Profile.tsx", content: PROFILE_TSX },
    { path: "src/pages/Settings.tsx", content: SETTINGS_TSX },
  ];
  return [
    { path: "package.json", content: PKG_JSON(meta) },
    { path: "vite.config.ts", content: VITE_CONFIG },
    { path: "vite.api.js", content: VITE_API_PLUGIN },
    { path: "tsconfig.json", content: TSCONFIG },
    { path: "index.html", content: INDEX_HTML(meta) },
    { path: "tailwind.config.js", content: TAILWIND_CONFIG(meta) },
    { path: "postcss.config.js", content: POSTCSS_CONFIG },
    { path: "src/styles.css", content: STYLES_CSS },
    { path: "src/app-entry.tsx", content: MAIN_TSX },
    { path: "src/App.tsx", content: APP_TSX(meta) },
    { path: "src/pages/Home.tsx", content: HOME_TSX(meta) },
    { path: "src/lib/api.ts", content: API_CLIENT },
    { path: "src/lib/brand.ts", content: BRAND_TS(meta) },
    { path: "src/lib/images.ts", content: IMAGES_TS() },
    { path: "src/lib/legal-content.ts", content: LEGAL_CONTENT_TS(resolveLegal(meta)) },
    { path: "src/lib/ai.ts", content: AI_CLIENT },
    { path: "src/lib/theme.tsx", content: THEME_TSX },
    { path: "src/lib/auth.tsx", content: AUTH_TSX },
    { path: "src/lib/error-boundary.tsx", content: ERROR_BOUNDARY_TSX },
    { path: "src/components/Layout.tsx", content: LAYOUT_TSX(meta) },
    { path: "src/components/CookieBanner.tsx", content: COOKIE_BANNER_TSX },
    { path: "src/components/AIAssistant.tsx", content: AI_ASSISTANT_TSX },
    { path: "src/components/ThemeToggle.tsx", content: THEME_TOGGLE_TSX },
    { path: "src/components/Liquid.tsx", content: LIQUID_TSX },
    { path: "src/components/GradientBackground.tsx", content: GRADIENT_BG_TSX },
    ...authPages,
    { path: "src/pages/Terms.tsx", content: TERMS_TSX(meta) },
    { path: "src/pages/Privacy.tsx", content: PRIVACY_TSX(meta) },
    { path: "src/pages/LegalNotice.tsx", content: LEGAL_NOTICE_TSX(meta) },
    { path: "src/pages/Cookies.tsx", content: COOKIES_TSX(meta) },
    { path: "src/pages/Support.tsx", content: SUPPORT_TSX(meta) },
    { path: "src/pages/NotFound.tsx", content: NOTFOUND_TSX(meta) },
    { path: "server/index.ts", content: SERVER_INDEX(meta) },
    { path: "server/stripe.ts", content: SERVER_STRIPE },
    { path: "server/auth.ts", content: SERVER_AUTH },
    { path: "server/ai.ts", content: SERVER_AI(meta) },
    { path: "server/data.ts", content: SERVER_DATA },
  ];
}
