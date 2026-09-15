// ─────────────────────────────────────────────────────────────────────────────
// Higgsfield MCP (Marketing Studio) integration
//
// The raw Cloud API key (higgsfield.ts) only exposes the base generation catalog
// (DoP / Soul / Speak). The real **Marketing Studio** — UGC ad generation and
// Virtual Try-On presets — is only reachable through Higgsfield's MCP server
// (https://mcp.higgsfield.ai/mcp), gated by OAuth.
//
// Design goal (owner's requirement):
//   • The OWNER connects ONCE (single browser login to the master Higgsfield
//     account). All ad generation for every Velbaz user is then billed to that
//     master account. End-users never log in or see anything.
//   • We use the Authorization-Code + PKCE flow with `offline_access`, so the
//     server keeps a long-lived refresh_token and mints access tokens forever.
//
// Everything here is developer-only (wired behind /admin routes). Invisible to
// users, exactly like the AI-usage log.
// ─────────────────────────────────────────────────────────────────────────────

import { createHash, randomBytes } from "node:crypto";
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";

const MCP_ORIGIN = "https://mcp.higgsfield.ai";
const AUTHORIZE_URL = `${MCP_ORIGIN}/oauth2/authorize`;
const TOKEN_URL = `${MCP_ORIGIN}/oauth2/token`;
const REGISTER_URL = `${MCP_ORIGIN}/oauth2/register`;
const MCP_ENDPOINT = `${MCP_ORIGIN}/mcp`;
const RESOURCE = `${MCP_ORIGIN}/mcp`;
const SCOPE = "openid email offline_access";

// Persisted, developer-only. Never exposed to users.
const STORE_PATH = join(process.cwd(), "data", "higgsfield-oauth.json");

// ── Token store ──────────────────────────────────────────────────────────────
interface TokenStore {
  client_id: string;
  client_secret?: string;
  redirect_uri: string;
  refresh_token?: string;
  access_token?: string;
  /** epoch ms */
  expires_at?: number;
  account_email?: string;
  connected_at?: number;
}

function readStore(): TokenStore | null {
  try {
    if (!existsSync(STORE_PATH)) return null;
    return JSON.parse(readFileSync(STORE_PATH, "utf8")) as TokenStore;
  } catch {
    return null;
  }
}

function writeStore(s: TokenStore): void {
  try {
    mkdirSync(dirname(STORE_PATH), { recursive: true });
    writeFileSync(STORE_PATH, JSON.stringify(s, null, 2), "utf8");
  } catch (e) {
    console.error("[hf-mcp] writeStore failed:", e);
  }
}

export function isMcpConnected(): boolean {
  const s = readStore();
  return !!(s && s.refresh_token);
}

export function getMcpStatus() {
  const s = readStore();
  return {
    connected: !!(s && s.refresh_token),
    accountEmail: s?.account_email || null,
    connectedAt: s?.connected_at || null,
    tokenValidUntil: s?.expires_at || null,
  };
}

export function disconnectMcp(): void {
  try {
    if (existsSync(STORE_PATH)) writeFileSync(STORE_PATH, "{}", "utf8");
  } catch {}
}

// ── PKCE + pending-auth (in-memory, keyed by state) ───────────────────────────
interface Pending {
  verifier: string;
  client_id: string;
  client_secret?: string;
  redirect_uri: string;
  createdAt: number;
}
const pending = new Map<string, Pending>();

function b64url(buf: Buffer): string {
  return buf.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

async function registerClient(redirectUri: string): Promise<{ client_id: string; client_secret?: string }> {
  const res = await fetch(REGISTER_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      client_name: "Velbaz AI",
      redirect_uris: [redirectUri],
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
      token_endpoint_auth_method: "none",
      scope: SCOPE,
    }),
  });
  if (!res.ok) throw new Error(`client registration failed (${res.status}): ${await res.text()}`);
  const j = (await res.json()) as { client_id: string; client_secret?: string };
  if (!j.client_id) throw new Error("registration returned no client_id");
  return { client_id: j.client_id, client_secret: j.client_secret };
}

/**
 * Step 1 — owner clicks "connect". Registers a client bound to THIS origin's
 * callback, generates PKCE, returns the login URL for the owner to open.
 */
export async function startAuth(origin: string): Promise<{ authUrl: string; state: string }> {
  const redirectUri = `${origin.replace(/\/$/, "")}/api/admin/higgsfield/oauth/callback`;
  const { client_id, client_secret } = await registerClient(redirectUri);

  const verifier = b64url(randomBytes(48));
  const challenge = b64url(createHash("sha256").update(verifier).digest());
  const state = b64url(randomBytes(24));

  pending.set(state, { verifier, client_id, client_secret, redirect_uri: redirectUri, createdAt: Date.now() });
  // prune old pendings (>15 min)
  for (const [k, v] of pending) if (Date.now() - v.createdAt > 15 * 60_000) pending.delete(k);

  const q = new URLSearchParams({
    response_type: "code",
    client_id,
    redirect_uri: redirectUri,
    scope: SCOPE,
    state,
    code_challenge: challenge,
    code_challenge_method: "S256",
    resource: RESOURCE,
  });
  return { authUrl: `${AUTHORIZE_URL}?${q.toString()}`, state };
}

/**
 * Step 2 — Higgsfield redirects the owner's browser back here with ?code&state.
 * Exchanges the code for tokens and persists the refresh_token.
 */
export async function handleCallback(code: string, state: string): Promise<{ accountEmail: string | null }> {
  const p = pending.get(state);
  if (!p) throw new Error("état invalide ou expiré — relance « higgsfield connect »");
  pending.delete(state);

  const body = new URLSearchParams({
    grant_type: "authorization_code",
    code,
    redirect_uri: p.redirect_uri,
    client_id: p.client_id,
    code_verifier: p.verifier,
    resource: RESOURCE,
  });
  if (p.client_secret) body.set("client_secret", p.client_secret);

  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  if (!res.ok) throw new Error(`token exchange failed (${res.status}): ${await res.text()}`);
  const tok = (await res.json()) as {
    access_token: string;
    refresh_token?: string;
    expires_in?: number;
    id_token?: string;
  };
  if (!tok.access_token) throw new Error("token response missing access_token");

  const accountEmail = decodeEmailFromIdToken(tok.id_token) || decodeEmailFromIdToken(tok.access_token);
  const store: TokenStore = {
    client_id: p.client_id,
    client_secret: p.client_secret,
    redirect_uri: p.redirect_uri,
    refresh_token: tok.refresh_token,
    access_token: tok.access_token,
    expires_at: Date.now() + (tok.expires_in ? tok.expires_in * 1000 : 3600_000) - 60_000,
    account_email: accountEmail || undefined,
    connected_at: Date.now(),
  };
  writeStore(store);
  return { accountEmail };
}

function decodeEmailFromIdToken(jwt?: string): string | null {
  if (!jwt) return null;
  try {
    const parts = jwt.split(".");
    if (parts.length < 2) return null;
    const payload = JSON.parse(Buffer.from(parts[1].replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8"));
    return payload.email || payload.sub || null;
  } catch {
    return null;
  }
}

// ── Access token (auto-refresh) ────────────────────────────────────────────────
let refreshing: Promise<string> | null = null;

async function getAccessToken(): Promise<string> {
  const s = readStore();
  if (!s || !s.refresh_token) throw new Error("Higgsfield MCP non connecté (owner doit lancer « higgsfield connect »)");
  if (s.access_token && s.expires_at && Date.now() < s.expires_at) return s.access_token;

  if (refreshing) return refreshing;
  refreshing = (async () => {
    try {
      const body = new URLSearchParams({
        grant_type: "refresh_token",
        refresh_token: s.refresh_token!,
        client_id: s.client_id,
        resource: RESOURCE,
      });
      if (s.client_secret) body.set("client_secret", s.client_secret);
      const res = await fetch(TOKEN_URL, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body,
      });
      if (!res.ok) throw new Error(`refresh failed (${res.status}): ${await res.text()}`);
      const tok = (await res.json()) as { access_token: string; refresh_token?: string; expires_in?: number };
      const updated: TokenStore = {
        ...s,
        access_token: tok.access_token,
        refresh_token: tok.refresh_token || s.refresh_token,
        expires_at: Date.now() + (tok.expires_in ? tok.expires_in * 1000 : 3600_000) - 60_000,
      };
      writeStore(updated);
      return tok.access_token;
    } finally {
      refreshing = null;
    }
  })();
  return refreshing;
}

// ── MCP JSON-RPC transport (Streamable HTTP) ───────────────────────────────────
let sessionId: string | null = null;
let initialized = false;
let rpcId = 1;

/** Parse an MCP HTTP response that may be JSON or SSE (text/event-stream). */
async function parseMcpResponse(res: Response): Promise<any> {
  const ct = res.headers.get("content-type") || "";
  const text = await res.text();
  if (ct.includes("text/event-stream")) {
    // collect the last `data:` JSON payload that has an id/result/error
    let last: any = null;
    for (const line of text.split(/\r?\n/)) {
      const m = line.match(/^data:\s*(.*)$/);
      if (!m) continue;
      try {
        const obj = JSON.parse(m[1]);
        if (obj && (obj.result !== undefined || obj.error !== undefined)) last = obj;
      } catch {}
    }
    return last;
  }
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`unexpected MCP response: ${text.slice(0, 300)}`);
  }
}

async function rpc(method: string, params: any, isNotification = false): Promise<any> {
  const token = await getAccessToken();
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    Accept: "application/json, text/event-stream",
    Authorization: `Bearer ${token}`,
    "MCP-Protocol-Version": "2025-06-18",
  };
  if (sessionId) headers["Mcp-Session-Id"] = sessionId;

  const payload: any = { jsonrpc: "2.0", method, params };
  if (!isNotification) payload.id = rpcId++;

  const res = await fetch(MCP_ENDPOINT, { method: "POST", headers, body: JSON.stringify(payload) });
  const sid = res.headers.get("mcp-session-id") || res.headers.get("Mcp-Session-Id");
  if (sid) sessionId = sid;

  if (isNotification) return null;
  if (!res.ok) {
    // session expired → reset and let caller retry through ensureInit
    if (res.status === 404 || res.status === 400) {
      sessionId = null;
      initialized = false;
    }
    throw new Error(`MCP ${method} failed (${res.status}): ${(await res.text()).slice(0, 300)}`);
  }
  const parsed = await parseMcpResponse(res);
  if (parsed?.error) throw new Error(`MCP ${method} error: ${JSON.stringify(parsed.error)}`);
  return parsed?.result;
}

async function ensureInit(): Promise<void> {
  if (initialized && sessionId) return;
  const result = await rpc("initialize", {
    protocolVersion: "2025-06-18",
    capabilities: {},
    clientInfo: { name: "velbaz", version: "1.0" },
  });
  initialized = true;
  // notify initialized (best-effort)
  try {
    await rpc("notifications/initialized", {}, true);
  } catch {}
  return result;
}

export interface McpTool {
  name: string;
  description?: string;
  inputSchema?: any;
}

export async function listTools(): Promise<McpTool[]> {
  await ensureInit();
  const result = await rpc("tools/list", {});
  return (result?.tools || []) as McpTool[];
}

export interface McpCallResult {
  content: Array<{ type: string; text?: string; [k: string]: any }>;
  structuredContent?: any;
  isError?: boolean;
  raw: any;
}

export async function callTool(name: string, args: Record<string, unknown>): Promise<McpCallResult> {
  await ensureInit();
  let result: any;
  try {
    result = await rpc("tools/call", { name, arguments: args });
  } catch (e) {
    // one retry after a fresh init if the session got dropped
    if (!sessionId || !initialized) {
      await ensureInit();
      result = await rpc("tools/call", { name, arguments: args });
    } else {
      throw e;
    }
  }
  return {
    content: result?.content || [],
    structuredContent: result?.structuredContent,
    isError: !!result?.isError,
    raw: result,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Marketing Studio ad pipeline (product → ad video)
//
// Full chain, all billed to the master account:
//   1. importMediaUrl(publicImageUrl)  → media_id
//   2. createProduct({mediaId,url,...}) → product_id  (Marketing Studio product)
//   3. submitAdVideo({productId, mode, ...}) → { jobId } | { planRequired } | { error }
//   4. pollJob(jobId) → { status:'completed', urls:[mp4...] }
// ─────────────────────────────────────────────────────────────────────────────

function firstText(r: McpCallResult): string {
  return (r.content || []).map((c) => c.text || "").join(" ");
}

/** Pull the finished media (video/image) URLs out of a job/generation result. */
function extractMediaUrls(r: McpCallResult): string[] {
  const sc = r.structuredContent || {};
  const out: string[] = [];
  const buckets = [sc.results, sc.generation?.results, sc.outputs, sc.generation?.outputs];
  for (const b of buckets) {
    if (Array.isArray(b)) {
      for (const x of b) {
        const u = x?.url || x?.output_url || x?.media_url || x?.video_url || (typeof x === "string" ? x : null);
        if (typeof u === "string" && /^https?:\/\//.test(u)) out.push(u);
      }
    }
  }
  if (out.length) return [...new Set(out)];
  // fallback: any CDN media URL found anywhere in the payload
  return extractUrls(r).filter(
    (u) => /\.(mp4|webm|mov|m4v)(\?|$)/i.test(u) || /cloudfront|cdn|higgsfield|storage/i.test(u),
  );
}

/** Import an https media URL into Higgsfield storage → confirmed media_id. */
export async function importMediaUrl(
  url: string,
  type: "image" | "video" | "audio" | "auto" = "image",
): Promise<string> {
  const r = await callTool("media_import_url", { url, type });
  const id = r.structuredContent?.media_id || r.structuredContent?.id;
  if (!id) throw new Error("media_import_url: pas de media_id (" + firstText(r).slice(0, 160) + ")");
  return String(id);
}

/** Create a Marketing Studio product from an imported media. Returns product_id. */
export async function createProduct(opts: {
  mediaId: string;
  url: string;
  title?: string;
  description?: string;
}): Promise<string> {
  const r = await callTool("show_marketing_studio", {
    action: "create",
    type: "product",
    title: opts.title || "Product",
    description: opts.description || undefined,
    medias: [{ value: opts.mediaId, role: "image", url: opts.url }],
  });
  const items: any[] = r.structuredContent?.items || [];
  const match =
    items.find((p: any) => (p.medias || []).some((m: any) => m.media_input_id === opts.mediaId)) ||
    items[0];
  const id = match?.id;
  if (!id) throw new Error("createProduct: pas de product id (" + firstText(r).slice(0, 160) + ")");
  return String(id);
}

export interface AdVideoOptions {
  productId?: string;
  mode: string; // Marketing Studio preset slug
  prompt?: string;
  aspectRatio?: string; // default 9:16
  resolution?: string; // default 720p
  generateAudio?: boolean; // default true
  avatarId?: string;
  durationSeconds?: number;
}

/** Preflight the credit cost of an ad video without submitting a job. */
export async function adVideoCost(o: AdVideoOptions): Promise<number | null> {
  const r = await callTool("generate_video", { params: { ...buildAdParams(o), get_cost: true } });
  const c = r.structuredContent?.cost;
  return typeof c?.credits === "number" ? c.credits : null;
}

function buildAdParams(o: AdVideoOptions): Record<string, unknown> {
  const params: Record<string, unknown> = {
    model: "marketing_studio_video",
    mode: o.mode,
    aspect_ratio: o.aspectRatio || "9:16",
    resolution: o.resolution || "720p",
    generate_audio: o.generateAudio !== false,
  };
  if (o.productId) params.product_ids = [o.productId];
  if (o.prompt) params.prompt = o.prompt;
  if (o.avatarId) params.avatar_ids = [o.avatarId];
  if (o.durationSeconds) params.duration = o.durationSeconds;
  return params;
}

export interface AdSubmit {
  jobId?: string;
  error?: string;
  planRequired?: boolean;
}

/** Submit a Marketing Studio ad video generation. */
export async function submitAdVideo(o: AdVideoOptions): Promise<AdSubmit> {
  const r = await callTool("generate_video", { params: buildAdParams(o) });
  const sc = r.structuredContent || {};
  if (sc.error || r.isError) {
    const err = String(sc.error || firstText(r) || "generation error");
    const planRequired = /plan|upgrade|basic plan|subscription/i.test(err) || sc.monetization_intent === "upgrade";
    return { error: err, planRequired };
  }
  const jobId =
    sc.jobId || sc.job_id || sc.id || sc.generation?.id || (Array.isArray(sc.jobs) && sc.jobs[0]?.id) || (Array.isArray(sc.items) && sc.items[0]?.id);
  if (!jobId) return { error: "submitAdVideo: pas de jobId (" + JSON.stringify(sc).slice(0, 200) + ")" };
  return { jobId: String(jobId) };
}

export interface AdJobResult {
  status: string; // completed | failed | timeout
  jobId: string;
  urls: string[];
  error?: string;
}

/** Poll a job until terminal state or timeout. Handles ip_detected reveal. */
export async function pollJob(jobId: string, opts: { timeoutMs?: number } = {}): Promise<AdJobResult> {
  const timeout = opts.timeoutMs ?? 8 * 60_000;
  const start = Date.now();
  let delay = 5000;
  while (Date.now() - start < timeout) {
    const r = await callTool("job_status", { jobId, sync: true });
    const sc = r.structuredContent || {};
    const status = String(sc.status || sc.state || "").toLowerCase();
    if (status === "ip_detected") {
      await callTool("reveal_generation", { jobId }).catch(() => {});
      const rr = await callTool("job_status", { jobId, sync: true });
      return { status: "completed", jobId, urls: extractMediaUrls(rr) };
    }
    if (["completed", "succeeded", "success", "done"].includes(status)) {
      return { status: "completed", jobId, urls: extractMediaUrls(r) };
    }
    if (["failed", "error", "canceled", "cancelled"].includes(status)) {
      return { status: "failed", jobId, urls: [], error: String(sc.error || sc.fail_reason || "generation failed") };
    }
    const waitMs = sc.poll_after_seconds ? Number(sc.poll_after_seconds) * 1000 : delay;
    await new Promise((res) => setTimeout(res, Math.min(waitMs, 15000)));
    delay = Math.min(delay * 1.3, 15000);
  }
  return { status: "timeout", jobId, urls: [], error: "poll timeout" };
}

/** Extract all URLs (image/video CDN links) from a tool-call result. */
export function extractUrls(r: McpCallResult): string[] {
  const urls: string[] = [];
  const push = (u: any) => {
    if (typeof u === "string" && /^https?:\/\//.test(u)) urls.push(u);
  };
  const walk = (v: any) => {
    if (!v) return;
    if (typeof v === "string") {
      const m = v.match(/https?:\/\/[^\s"')]+/g);
      if (m) m.forEach(push);
    } else if (Array.isArray(v)) v.forEach(walk);
    else if (typeof v === "object") Object.values(v).forEach(walk);
  };
  for (const c of r.content || []) walk(c);
  if (r.structuredContent) walk(r.structuredContent);
  return [...new Set(urls)];
}
