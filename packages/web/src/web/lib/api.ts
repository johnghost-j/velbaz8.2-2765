import { createORPCClient } from "@orpc/client";
import { getAuthToken } from './token';
import { RPCLink } from "@orpc/client/fetch";
import { createTanstackQueryUtils } from "@orpc/tanstack-query";
import type { AppRouterClient } from "../../api";

const link = new RPCLink({ url: `${window.location.origin}/api/rpc` });

/** Client oRPC typé du template : await client.ping() */
export const client: AppRouterClient = createORPCClient(link);

/** Helpers TanStack Query : useQuery(orpc.ping.queryOptions()) */
export const orpc = createTanstackQueryUtils(client);

// ─── Client REST historique de Velbaz (toutes les routes /api/* Hono) ────────
const BASE = '/api';

// ─── Real-time token sync ────────────────────────────────────────────────────
// Global listener that any store can subscribe to for token balance updates
type TokenListener = (tokens: number) => void;
const tokenListeners: Set<TokenListener> = new Set();
export function onTokenUpdate(fn: TokenListener) { tokenListeners.add(fn); return () => { tokenListeners.delete(fn); }; }
function notifyTokenUpdate(tokens: number) { tokenListeners.forEach(fn => fn(tokens)); }

function syncTokensFromResponse(data: any) {
  if (data && typeof data === 'object') {
    // Backend sends tokenBalance on success/error responses after deduction
    if (typeof data.tokenBalance === 'number') notifyTokenUpdate(data.tokenBalance);
    // Also check nested user object (auth responses)
    if (data.user && typeof data.user.tokens === 'number') notifyTokenUpdate(data.user.tokens);
  }
}

function getToken() {
  return getAuthToken();
}

function headers() {
  const token = getToken();
  return {
    'Content-Type': 'application/json',
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };
}

async function request(path: string, options: RequestInit = {}, retries = 2) {
  for (let i = 0; i <= retries; i++) {
    try {
      const res = await fetch(`${BASE}${path}`, {
        ...options,
        headers: { ...headers(), ...options.headers },
      });
      // Tolerate non-JSON responses (e.g. a raw "Internal Server Error" 500 from the dev proxy)
      let data: any;
      const raw = await res.text();
      try { data = raw ? JSON.parse(raw) : {}; }
      catch {
        if (i < retries) { await new Promise(r => setTimeout(r, 500 * (i + 1))); continue; }
        data = { error: raw || `HTTP ${res.status}` };
      }
      // Auto-sync token balance from every API response
      syncTokensFromResponse(data);
      // Retry on server-side DB errors (transient)
      if (data?.error && i < retries && typeof data.error === 'string' && (data.error.includes('ECONNRESET') || data.error.includes('Failed query'))) {
        await new Promise(r => setTimeout(r, 500 * (i + 1)));
        continue;
      }
      return data;
    } catch (e) {
      if (i < retries) { await new Promise(r => setTimeout(r, 500 * (i + 1))); continue; }
      throw e;
    }
  }
}

export const api = {
  auth: {
    register: (data: { email: string; name: string; password: string; deviceId?: string }) =>
      request('/auth/register', { method: 'POST', body: JSON.stringify(data) }),
    login: (data: { email: string; password: string }) =>
      request('/auth/login', { method: 'POST', body: JSON.stringify(data) }),
    logout: () => request('/auth/logout', { method: 'POST' }),
    me: () => request('/auth/me'),
    forgotPassword: (data: { email: string }) =>
      request('/auth/forgot-password', { method: 'POST', body: JSON.stringify(data) }),
    validateResetToken: (token: string) =>
      request(`/auth/reset-password/validate?token=${encodeURIComponent(token)}`),
    resetPassword: (data: { token: string; password: string }) =>
      request('/auth/reset-password', { method: 'POST', body: JSON.stringify(data) }),
  },
  companies: {
    list: () => request('/companies'),
    create: (data: { idea: string; name?: string; industry?: string }) =>
      request('/companies', { method: 'POST', body: JSON.stringify(data) }),
    quickCreate: (data: { idea: string; name?: string; industry?: string; languages?: string[]; country?: string; deferName?: boolean }) =>
      request('/companies/quick', { method: 'POST', body: JSON.stringify(data) }),
    initialize: (id: string) =>
      request(`/companies/${id}/initialize`, { method: 'POST' }),
    get: (id: string) => request(`/companies/${id}`),
    rename: (id: string, name: string) => request(`/companies/${id}/rename`, { method: 'PUT', body: JSON.stringify({ name }) }),
    refreshMeta: (id: string, idea?: string) => request(`/companies/${id}/refresh-meta`, { method: 'POST', body: JSON.stringify({ idea: idea || '' }) }),
    delete: (id: string) => request(`/companies/${id}`, { method: 'DELETE' }),
    buildWebsite: (id: string, styleReference?: string) => request(`/companies/${id}/build-website`, { method: 'POST', body: JSON.stringify({ styleReference: styleReference || '' }) }),
    // Plan-only: returns the proposed page list (no code) for the selection questionnaire.
    planPages: (id: string, message?: string) => request(`/companies/${id}/plan-pages`, { method: 'POST', body: JSON.stringify({ message: message || '' }) }),
    // Persist the user's chosen pages (kept + custom). Empty clears the selection.
    selectPages: (id: string, pages: any[]) => request(`/companies/${id}/select-pages`, { method: 'POST', body: JSON.stringify({ pages }) }),
    pages: (id: string) => request(`/companies/${id}/pages`),
    marketing: (id: string) => request(`/companies/${id}/marketing`),
    publicRecent: () => request('/companies/public/recent'),
    heartbeat: (id: string) => request(`/companies/${id}/heartbeat`, { method: 'POST' }),
    autoHeartbeat: {
      get: (id: string) => request(`/companies/${id}/auto-heartbeat`),
      toggle: (id: string, enabled: boolean) => request(`/companies/${id}/auto-heartbeat`, { method: 'POST', body: JSON.stringify({ enabled }) }),
    },
    jobs: (id: string) => request(`/companies/${id}/jobs`),
    job: (id: string, jobId: string) => request(`/companies/${id}/jobs/${jobId}`),
    checkpoints: (id: string) => request(`/companies/${id}/checkpoints`),
    rollback: (id: string, checkpointId: string) => request(`/companies/${id}/rollback/${checkpointId}`, { method: 'POST' }),
    fork: (id: string) => request(`/companies/${id}/fork`, { method: 'POST' }),
    cancelBuild: (id: string) => request(`/companies/${id}/cancel-build`, { method: 'POST' }),
    orchestrate: (id: string, goal: string) => request(`/companies/${id}/orchestrate`, { method: 'POST', body: JSON.stringify({ goal }) }),
    agents: (id: string) => request(`/companies/${id}/agents`),
    languages: {
      get: (id: string) => request(`/companies/${id}/languages`),
      update: (id: string, languages: string[]) => request(`/companies/${id}/languages`, { method: 'PUT', body: JSON.stringify({ languages }) }),
      translate: (id: string, targetLang: string) => request(`/companies/${id}/translate`, { method: 'POST', body: JSON.stringify({ targetLang }) }),
    },
    websiteLinks: {
      get: (id: string) => request(`/companies/${id}/website-links`),
      update: (id: string, links: Record<string, string>) => request(`/companies/${id}/website-links`, { method: 'PUT', body: JSON.stringify({ links }) }),
    },
    updatePageHtml: (id: string, slug: string, html: string, lang?: string) =>
      request(`/companies/${id}/pages/${slug}`, { method: 'PUT', body: JSON.stringify({ html, lang }) }),
    siteEdit: (id: string, instruction: string, targetSlug?: string) =>
      request(`/companies/${id}/site-edit`, { method: 'POST', body: JSON.stringify({ instruction, targetSlug }) }),
    // ─── Project File System (Lovable-style) ──────────────────────────
    projectFiles: {
      list: (id: string) => request(`/companies/${id}/project-files`),
      get: (id: string, filePath: string) => request(`/companies/${id}/project-files/${filePath}`),
      content: (id: string, filePath: string) => request(`/companies/${id}/project-file?path=${encodeURIComponent(filePath)}`),
      update: (id: string, filePath: string, content: string) =>
        request(`/companies/${id}/project-files`, { method: 'PUT', body: JSON.stringify({ filePath, content }) }),
    },
    // ─── App mobile (Expo) ────────────────────────────────────────────
    detectType: (id: string) => request(`/companies/${id}/detect-type`, { method: 'POST' }),
    setProjectType: (id: string, projectType: 'web' | 'mobile' | 'both') =>
      request(`/companies/${id}/project-type`, { method: 'POST', body: JSON.stringify({ projectType }) }),
    mobile: {
      status: (id: string) => request(`/companies/${id}/mobile/status`),
      start: (id: string) => request(`/companies/${id}/mobile/start`, { method: 'POST' }),
    },
    // Édition de projet React via patch de source par l'IA. La route répond en
    // SSE (la génération de code peut durer plusieurs minutes) : on lit le flux
    // jusqu'au bout, on relaie la progression et on renvoie le résultat final.
    // AUCUN timeout — on laisse Claude finir.
    projectEdit: async (
      id: string,
      instruction: string,
      currentPage?: string,
      onProgress?: (msg: string) => void,
      edits?: Array<{ kind: 'text' | 'style' | 'delete'; tagName?: string; oldText?: string; newText?: string; textSnippet?: string; property?: string; value?: string }>,
      // [2026-09-13] Élément cliqué dans le mode Edit visuel : permet au serveur
      // de retrouver le fichier qui REND vraiment l'élément (un composant
      // partagé Header/Footer, pas forcément le fichier de la page affichée).
      element?: { path?: string; text?: string; tagName?: string },
    ): Promise<{ ok: boolean; summary?: string; changed?: string[]; error?: string }> => {
      const res = await fetch(`${BASE}/companies/${id}/project-edit`, {
        method: 'POST',
        headers: { ...headers(), 'Content-Type': 'application/json' },
        body: JSON.stringify({ instruction, currentPage, edits, element }),
      });
      if (!res.ok || !res.body) {
        return { ok: false, error: `HTTP ${res.status}` };
      }
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buf = '';
      let final: any = null;
      let lastError: string | undefined;
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        const parts = buf.split('\n\n');
        buf = parts.pop() || '';
        for (const part of parts) {
          const line = part.split('\n').find(l => l.startsWith('data: '));
          if (!line) continue; // heartbeat/comment
          try {
            const evt = JSON.parse(line.slice(6));
            if (evt.progress && onProgress) onProgress(evt.progress);
            if (evt.error) lastError = evt.error;
            if (evt.done) final = evt;
          } catch { /* ignore malformed chunk */ }
        }
      }
      if (final) return { ok: !!final.ok, summary: final.summary, changed: final.changed, error: final.ok ? undefined : (lastError || 'Edit failed') };
      return { ok: false, error: lastError || 'Connexion interrompue' };
    },
    secrets: {
      list: (id: string) => request(`/companies/${id}/secrets`),
      set: (id: string, values: Record<string, string>) =>
        request(`/companies/${id}/secrets`, { method: 'POST', body: JSON.stringify({ values }) }),
      delete: (id: string, keys: string[]) =>
        request(`/companies/${id}/secrets/delete`, { method: 'POST', body: JSON.stringify({ keys }) }),
    },
    // ─── Printify (print-on-demand) ──────────────────────────────────
    printify: {
      status: (id: string) => request(`/companies/${id}/printify/status`),
      catalog: (id: string) => request(`/companies/${id}/printify/catalog`),
      blueprint: (id: string, blueprintId: number | string) => request(`/companies/${id}/printify/catalog/${blueprintId}`),
      upload: (id: string, data: { fileName?: string; url?: string; dataUrl?: string }) =>
        request(`/companies/${id}/printify/upload`, { method: 'POST', body: JSON.stringify(data) }),
      // Design multi-calques (image + texte) — voir printAreas côté serveur.
      createProduct: (id: string, design: any) =>
        request(`/companies/${id}/printify/create-product`, { method: 'POST', body: JSON.stringify(design) }),
      sync: (id: string) => request(`/companies/${id}/printify/sync`, { method: 'POST', body: JSON.stringify({}) }),
    },
    devServer: {
      start: (id: string) => request(`/companies/${id}/preview/start`, { method: 'POST' }),
      stop: (id: string) => request(`/companies/${id}/preview/stop`, { method: 'POST' }),
      status: (id: string) => request(`/companies/${id}/build-status`),
    },
    // ─── Collaborateurs de projet (inviter un ami à co-éditer) ────────
    collaborators: {
      list: (id: string) => request(`/companies/${id}/collaborators`),
      invite: (id: string, emails: string) =>
        request(`/companies/${id}/collaborators`, { method: 'POST', body: JSON.stringify({ emails }) }),
      remove: (id: string, collabId: string) =>
        request(`/companies/${id}/collaborators/${collabId}`, { method: 'DELETE' }),
    },
  },
  invites: {
    info: (token: string) => request(`/invites/${encodeURIComponent(token)}`),
    accept: (token: string) => request(`/invites/${encodeURIComponent(token)}/accept`, { method: 'POST' }),
  },
  products: {
    // Génère un aperçu produit HQ rapide (draft). refinePrompt + draftId pour reboucler.
    visualize: (companyId: string, data: { description: string; refinePrompt?: string; draftId?: string }) =>
      request(`/companies/${companyId}/product-visualize`, { method: 'POST', body: JSON.stringify(data) }),
    // Valide un draft → l'ajoute au catalogue (produit + visuels multiples).
    approveDraft: (companyId: string, draftId: string) =>
      request(`/companies/${companyId}/product-visualize/${draftId}/approve`, { method: 'POST' }),
  },
  inventions: {
    // L'IA réfléchit à une invention (concept, fiche technique, faisabilité, brevet) + rendu design.
    visualize: (companyId: string, data: { description: string; refinePrompt?: string }) =>
      request(`/companies/${companyId}/invention-visualize`, { method: 'POST', body: JSON.stringify(data) }),
  },
  brand: {
    // Génère une proposition de marque (logo + palette + typo + tagline). feedback pour reboucler.
    preview: (companyId: string, data?: { feedback?: string }) =>
      request(`/companies/${companyId}/brand-preview`, { method: 'POST', body: JSON.stringify(data || {}) }),
    // Valide et verrouille la marque en base (le build la réutilise).
    approve: (companyId: string, data: { logoDataUrl: string; palette: string[]; fonts: { heading: string; body: string }; tagline: string }) =>
      request(`/companies/${companyId}/brand-preview/approve`, { method: 'POST', body: JSON.stringify(data) }),
    // Étape 2 : fabrique les VRAIS produits Printify (mockups). Appel séparé et
    // lent — le rectangle "produit" ne charge que pendant cet appel.
    products: (companyId: string) =>
      request(`/companies/${companyId}/brand-preview/products`, { method: 'POST' }),
    // Abandon : supprime les produits Printify temporaires + vide le cache d'aperçu.
    discard: (companyId: string) =>
      request(`/companies/${companyId}/brand-preview/discard`, { method: 'POST' }),
  },
  tasks: {
    recent: () => request('/tasks/recent'),
    publicRecent: () => request('/tasks/public/recent'),
  },
  documents: {
    recent: () => request('/documents/recent'),
    generate: (data: { companyId: string; type: string }) =>
      request('/documents/generate', { method: 'POST', body: JSON.stringify(data) }),
  },
  emails: {
    list: (companyId: string) => request(`/companies/${companyId}/emails`),
    inbox: (companyId: string) => request(`/companies/${companyId}/emails/inbox`),
    generate: (companyId: string, type: string) =>
      request(`/companies/${companyId}/emails/generate`, { method: 'POST', body: JSON.stringify({ type }) }),
    send: (companyId: string, data: { emailId?: string; to: string; subject: string; body: string; bodyHtml?: string }) =>
      request(`/companies/${companyId}/emails/send`, { method: 'POST', body: JSON.stringify(data) }),
    config: {
      get: (companyId: string) => request(`/companies/${companyId}/email-config`),
      set: (companyId: string, data: { fromEmail: string; fromName: string; domain?: string; replyTo?: string; signature?: string }) =>
        request(`/companies/${companyId}/email-config`, { method: 'POST', body: JSON.stringify(data) }),
    },
  },
  agentActions: {
    list: (companyId: string) => request(`/companies/${companyId}/agent-actions`),
    think: (companyId: string, goal?: string) =>
      request(`/companies/${companyId}/agent/think`, { method: 'POST', body: JSON.stringify({ goal }) }),
  },
  ads: {
    list: (companyId: string) => request(`/companies/${companyId}/ads`),
    generate: (companyId: string, platform: string) =>
      request(`/companies/${companyId}/ads/generate`, { method: 'POST', body: JSON.stringify({ platform }) }),
  },
  growth: {
    status: (companyId: string) => request(`/companies/${companyId}/growth/status`),
    config: (companyId: string) => request(`/companies/${companyId}/growth/config`),
    setConfig: (companyId: string, data: any) => request(`/companies/${companyId}/growth/config`, { method: 'POST', body: JSON.stringify(data) }),
    leads: (companyId: string) => request(`/companies/${companyId}/growth/leads`),
    generateLeads: (companyId: string, count = 8) => request(`/companies/${companyId}/growth/leads/generate`, { method: 'POST', body: JSON.stringify({ count }) }),
    outreach: (companyId: string) => request(`/companies/${companyId}/growth/outreach`),
    sendOutreach: (companyId: string, data: { leadId: string; channel: string }) => request(`/companies/${companyId}/growth/outreach`, { method: 'POST', body: JSON.stringify(data) }),
    campaign: (companyId: string, data: { count?: number; goal?: string } = {}) => request(`/companies/${companyId}/growth/campaign`, { method: 'POST', body: JSON.stringify(data) }),
  },
  revenue: {
    get: (companyId: string) => request(`/companies/${companyId}/revenue`),
  },
  skills: {
    list: (companyId: string) => request(`/companies/${companyId}/skills`),
  },
  browser: {
    list: (companyId: string) => request(`/companies/${companyId}/browser-tasks`),
    run: (companyId: string, data: { type: string; url?: string; query?: string }) =>
      request(`/companies/${companyId}/browser-tasks`, { method: 'POST', body: JSON.stringify(data) }),
  },
  seo: {
    generate: (companyId: string, data: { type: string; keyword?: string }) =>
      request(`/companies/${companyId}/seo/generate`, { method: 'POST', body: JSON.stringify(data) }),
  },
  images: {
    generate: (companyId: string, type: string, prompt?: string) =>
      request(`/companies/${companyId}/generate-image`, { method: 'POST', body: JSON.stringify({ type, prompt }) }),
    list: (companyId: string) => request(`/companies/${companyId}/images`),
  },
  chat: {
    // `tier` (lite/pro/max) est LU par le backend (/chat) et PRIME sur `model`.
    // Il doit rester dans le type : sans lui l'appel ne compile pas et le
    // niveau choisi par l'utilisateur serait perdu.
    send: (data: { message: string; sessionId?: string; model?: string; tier?: string; companyId?: string }) =>
      request('/chat', { method: 'POST', body: JSON.stringify(data) }),
    save: (data: { sessionId: string; role: string; content: string; model?: string }) =>
      request('/chat/save', { method: 'POST', body: JSON.stringify(data) }),
    history: (sessionId: string) => request(`/chat/${sessionId}`),
    migrate: (fromSessionId: string, toSessionId: string) =>
      request('/chat/migrate', { method: 'POST', body: JSON.stringify({ fromSessionId, toSessionId }) }),
  },
  crm: {
    customers: {
      list: (companyId: string) => request(`/companies/${companyId}/customers`),
      create: (companyId: string, data: { name: string; email?: string; phone?: string; company?: string; source?: string; notes?: string; tags?: string[] }) =>
        request(`/companies/${companyId}/customers`, { method: 'POST', body: JSON.stringify(data) }),
      update: (companyId: string, custId: string, data: any) =>
        request(`/companies/${companyId}/customers/${custId}`, { method: 'PUT', body: JSON.stringify(data) }),
      delete: (companyId: string, custId: string) =>
        request(`/companies/${companyId}/customers/${custId}`, { method: 'DELETE' }),
    },
    deals: {
      list: (companyId: string) => request(`/companies/${companyId}/deals`),
      create: (companyId: string, data: { title: string; value?: number; customerId?: string; stage?: string; priority?: string; notes?: string; source?: string }) =>
        request(`/companies/${companyId}/deals`, { method: 'POST', body: JSON.stringify(data) }),
      update: (companyId: string, dealId: string, data: any) =>
        request(`/companies/${companyId}/deals/${dealId}`, { method: 'PUT', body: JSON.stringify(data) }),
      delete: (companyId: string, dealId: string) =>
        request(`/companies/${companyId}/deals/${dealId}`, { method: 'DELETE' }),
    },
    stats: (companyId: string) => request(`/companies/${companyId}/crm/stats`),
    analyzeEmails: (companyId: string) =>
      request(`/companies/${companyId}/crm/analyze-emails`, { method: 'POST' }),
  },
  ideas: {
    generate: (projects?: { name: string; industry: string; idea: string }[]) =>
      request('/ideas/generate', { method: 'POST', body: JSON.stringify({ projects }) }),
  },
  templates: {
    list: () => request('/templates'),
    get: (slug: string) => request(`/templates/${slug}`),
    seed: () => request('/templates/seed', { method: 'POST' }),
    recommend: (industry?: string, idea?: string) =>
      request(`/templates/recommend?industry=${encodeURIComponent(industry || '')}&idea=${encodeURIComponent(idea || '')}`),
    buildFromTemplate: (companyId: string, templateSlug: string) =>
      request(`/companies/${companyId}/build-website-from-template`, { method: 'POST', body: JSON.stringify({ templateSlug }) }),
    generatePreviews: (industry?: string, idea?: string, companyName?: string) =>
      request('/templates/generate-previews', { method: 'POST', body: JSON.stringify({ industry, idea, companyName }) }),
  },
  stats: {
    live: () => request('/stats/live'),
  },
  activity: {
    recent: () => request('/activity/recent'),
  },
  tokens: {
    balance: () => request('/tokens/balance'),
    packages: () => request('/tokens/packages'),
    history: () => request('/tokens/history'),
    purchase: (packageId: string) =>
      request('/tokens/purchase', { method: 'POST', body: JSON.stringify({ packageId }) }),
  },
  // ─── Abonnements ───
  // `subscribe` applique le plan IMMÉDIATEMENT côté serveur (pas de Stripe
  // pour l'instant) : le clic sur « Upgrade » change réellement les droits.
  plans: {
    me: () => request('/plans/me'),
    subscribe: (plan: string, billing?: 'monthly' | 'yearly') =>
      request('/plans/subscribe', { method: 'POST', body: JSON.stringify({ plan, billing: billing || 'monthly' }) }),
  },
  // ─── Money Maker : usine à entreprises autonome (couche boss) ───
  moneyMaker: {
    state: () => request('/money-maker/state'),
    toggle: (enabled: boolean) => request('/money-maker/toggle', { method: 'POST', body: JSON.stringify({ enabled }) }),
    updateConfig: (patch: { autoSpawn?: boolean; maxConcurrent?: number; killAfterDays?: number; strategyNote?: string; emailAutoSend?: boolean; emailFromName?: string | null }) =>
      request('/money-maker/config', { method: 'PUT', body: JSON.stringify(patch) }),
    feed: (since?: number) => request(`/money-maker/feed${since ? `?since=${since}` : ''}`),
    company: (id: string) => request(`/money-maker/companies/${id}`),
    companyAction: (id: string, action: 'pause' | 'resume' | 'kill' | 'boost' | 'restore') =>
      request(`/money-maker/companies/${id}/action`, { method: 'POST', body: JSON.stringify({ action }) }),
    spawn: () => request('/money-maker/spawn', { method: 'POST', body: '{}' }),
    chat: (message: string, history?: Array<{ role: string; content: string }>) =>
      request('/money-maker/chat', { method: 'POST', body: JSON.stringify({ message, history: history || [] }) }),
    acceptGoal: () => request('/money-maker/goal/accept', { method: 'POST', body: '{}' }),
    emails: {
      list: () => request('/money-maker/emails'),
      compose: (message: string, history?: Array<{ role: string; content: string }>) =>
        request('/money-maker/emails/compose', { method: 'POST', body: JSON.stringify({ message, history: history || [] }) }),
      send: (id: string, fromName?: string) =>
        request(`/money-maker/emails/${id}/send`, { method: 'POST', body: JSON.stringify({ fromName }) }),
      discard: (id: string, reason?: string) =>
        request(`/money-maker/emails/${id}/discard`, { method: 'POST', body: JSON.stringify({ reason: reason || '' }) }),
    },
  },
  beta: {
    check: (deviceId: string) =>
      request('/beta/check', { method: 'POST', body: JSON.stringify({ deviceId }) }),
    verify: (code: string, deviceId: string) =>
      request('/beta/verify', { method: 'POST', body: JSON.stringify({ code, deviceId }) }),
    adminList: () => request('/admin/beta/codes'),
    adminGenerate: (count: number, label?: string) =>
      request('/admin/beta/generate', { method: 'POST', body: JSON.stringify({ count, label }) }),
    adminCreate: (data: { code: string; label?: string; maxUses?: number | null }) =>
      request('/admin/beta/codes', { method: 'POST', body: JSON.stringify(data) }),
    adminUpdate: (id: string, patch: { active?: boolean; maxUses?: number | null; uses?: number; label?: string }) =>
      request(`/admin/beta/codes/${id}`, { method: 'PATCH', body: JSON.stringify(patch) }),
  },
  support: {
    chat: (message: string, history: { role: string; content: string }[]) =>
      request('/support/chat', { method: 'POST', body: JSON.stringify({ message, history }) }),
  },
};
