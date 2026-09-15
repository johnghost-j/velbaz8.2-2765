/**
 * X LIVE — navigateur X (Twitter) réel, embarqué dans l'app.
 *
 * x.com refuse d'être affiché dans une iframe (X-Frame-Options / CSP).
 * On lance donc un vrai Google Chrome côté serveur, avec un profil
 * PERSISTANT par entreprise (la session reste connectée d'une fois à
 * l'autre), et on diffuse l'écran au front via CDP `Page.startScreencast`.
 * Les clics / touches / molette du front sont renvoyés dans Chrome via
 * `Input.dispatch*`. Résultat : le vrai site X, utilisable, vidéos comprises
 * (Chrome stable = codecs H.264 présents).
 *
 * Rien n'est supprimé ailleurs : ce module est purement additif.
 * Drapeau d'arrêt d'urgence : X_LIVE_ENABLED=false dans .env.
 */

import { Hono } from 'hono';
import { spawn, type ChildProcess } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const X_LIVE_ENABLED = process.env.X_LIVE_ENABLED !== 'false';

const PROFILES_DIR = path.join(os.homedir(), '.velbaz-x-profiles');
const VIEW_W = 1280;
const VIEW_H = 900;
/** Qualité JPEG : plus bas = images plus légères = moins de latence. */
const FRAME_QUALITY = 38;
/** Intervalle entre deux demandes de capture tant qu'un spectateur regarde (ms). */
const CAPTURE_MS = 12;
/** Captures menées en parallèle : recouvre l'aller-retour CDP (~55 ms) → 60 img/s. */
const MAX_INFLIGHT = 6;
/** Une session inactive (aucun spectateur, aucune commande) est tuée après ce délai. */
const IDLE_MS = 10 * 60 * 1000;

type Frame = { data: string; meta: any };

interface Session {
  id: string;
  companyId: string;
  proc: ChildProcess;
  ws: WebSocket;
  targetId: string;
  port: number;
  msgId: number;
  pending: Map<number, (v: any) => void>;
  subs: Set<(f: Frame) => void>;
  lastFrame: Frame | null;
  lastFrameAt: number;
  poller: ReturnType<typeof setInterval> | null;
  lastUsed: number;
  url: string;
  ready: boolean;
}

// Les sessions vivent sur globalThis : le rechargement à chaud de Vite
// ré-évalue ce module, et une Map locale serait alors repartie vide (la
// session existait pour /start mais plus pour /frames).
const g = globalThis as any;
const sessions: Map<string, Session> = (g.__xLiveSessions ||= new Map<string, Session>());
/** companyId → sessionId (une seule session live par entreprise) */
const byCompany: Map<string, string> = (g.__xLiveByCompany ||= new Map<string, string>());

function sleep(ms: number) { return new Promise((r) => setTimeout(r, ms)); }

function profileDir(companyId: string) {
  return path.join(PROFILES_DIR, companyId.replace(/[^a-zA-Z0-9_-]/g, '_'));
}

/** Le profil existe et contient des cookies → l'utilisateur s'est déjà connecté à X. */
export function xProfileExists(companyId: string): boolean {
  try {
    return fs.existsSync(path.join(profileDir(companyId), 'Default', 'Cookies'));
  } catch { return false; }
}

async function readDevToolsPort(dir: string): Promise<number> {
  for (let i = 0; i < 80; i++) {
    try {
      const raw = fs.readFileSync(path.join(dir, 'DevToolsActivePort'), 'utf8').split('\n');
      const p = Number(raw[0]);
      if (p > 0) return p;
    } catch { /* pas encore écrit */ }
    await sleep(250);
  }
  throw new Error('Chrome n\'a pas ouvert son port DevTools');
}

function cdp(s: Session, method: string, params: any = {}): Promise<any> {
  const id = ++s.msgId;
  return new Promise((resolve) => {
    s.pending.set(id, resolve);
    try { s.ws.send(JSON.stringify({ id, method, params })); } catch { resolve(null); }
    setTimeout(() => { if (s.pending.delete(id)) resolve(null); }, 15000);
  });
}

async function launch(companyId: string, startUrl: string): Promise<Session> {
  const dir = profileDir(companyId);
  fs.mkdirSync(dir, { recursive: true });

  // Un Chrome orphelin (rechargement à chaud du serveur) garde le profil
  // verrouillé : le nouveau process refuserait de démarrer. On le tue d'abord.
  try {
    spawn('pkill', ['-9', '-f', `user-data-dir=${dir}`], { stdio: 'ignore' });
    await sleep(1200);
  } catch {}
  try { fs.unlinkSync(path.join(dir, 'DevToolsActivePort')); } catch {}
  try { fs.unlinkSync(path.join(dir, 'SingletonLock')); } catch {}
  try { fs.unlinkSync(path.join(dir, 'SingletonSocket')); } catch {}
  try { fs.unlinkSync(path.join(dir, 'SingletonCookie')); } catch {}

  const proc = spawn('google-chrome', [
    '--headless=new',
    '--remote-debugging-port=0',
    `--user-data-dir=${dir}`,
    `--window-size=${VIEW_W},${VIEW_H}`,
    '--no-sandbox',
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-dev-shm-usage',
    '--disable-blink-features=AutomationControlled',
    '--autoplay-policy=no-user-gesture-required',
    '--force-device-scale-factor=1',
    'about:blank',
  ], { stdio: 'ignore', detached: false });

  const port = await readDevToolsPort(dir);

  const res = await fetch(`http://127.0.0.1:${port}/json/new?${encodeURIComponent(startUrl)}`, { method: 'PUT' });
  const target: any = await res.json();
  if (!target?.webSocketDebuggerUrl) throw new Error('Aucune cible CDP');

  const ws = new WebSocket(target.webSocketDebuggerUrl);
  const s: Session = {
    id: `xl_${Math.random().toString(36).slice(2, 10)}`,
    companyId,
    proc,
    ws,
    targetId: target.id,
    port,
    msgId: 0,
    pending: new Map(),
    subs: new Set(),
    lastFrame: null,
    lastFrameAt: 0,
    poller: null,
    lastUsed: Date.now(),
    url: startUrl,
    ready: false,
  };

  ws.onmessage = (ev: any) => {
    let m: any;
    try { m = JSON.parse(String(ev.data)); } catch { return; }
    if (m.id && s.pending.has(m.id)) {
      const fn = s.pending.get(m.id)!;
      s.pending.delete(m.id);
      fn(m.result);
      return;
    }
    if (m.method === 'Page.screencastFrame') {
      const f: Frame = { data: m.params.data, meta: m.params.metadata };
      s.lastFrame = f;
      s.lastFrameAt = Date.now();
      for (const sub of s.subs) { try { sub(f); } catch {} }
      try { ws.send(JSON.stringify({ id: ++s.msgId, method: 'Page.screencastFrameAck', params: { sessionId: m.params.sessionId } })); } catch {}
    } else if (m.method === 'Page.frameNavigated' && !m.params?.frame?.parentId) {
      s.url = m.params.frame.url || s.url;
    }
  };

  await new Promise<void>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('WebSocket CDP: délai dépassé')), 15000);
    ws.onopen = () => { clearTimeout(t); resolve(); };
    ws.onerror = () => { clearTimeout(t); reject(new Error('WebSocket CDP: erreur')); };
  });

  await cdp(s, 'Page.enable');
  await cdp(s, 'Runtime.enable');
  await cdp(s, 'Page.startScreencast', { format: 'jpeg', quality: 62, maxWidth: VIEW_W, maxHeight: VIEW_H, everyNthFrame: 1 });
  s.ready = true;

  // Cadence de capture.
  //
  // Le screencast de Chrome headless ne pousse une image qu'au repaint et
  // plafonnait à ~2 images/s : c'est ÇA le "délai énorme", pas le réseau. Tant
  // qu'un spectateur regarde, on capture donc nous-mêmes en continu
  // (`optimizeForSpeed`).
  //
  // Une capture prend ~55 ms aller-retour CDP : en n'en lançant qu'une à la
  // fois on plafonnait à ~17 images/s. On en garde donc plusieurs en vol
  // (MAX_INFLIGHT) — les allers-retours se recouvrent et le débit double.
  // Les réponses peuvent revenir dans le désordre : une image plus vieille que
  // la dernière publiée est jetée.
  let inflight = 0;
  s.poller = setInterval(async () => {
    const watching = s.subs.size > 0;
    if (inflight >= (watching ? MAX_INFLIGHT : 1)) return;
    // Personne ne regarde : on garde juste une image fraîche de temps en temps.
    if (!watching) {
      if (s.lastFrame) return;
      if (Date.now() - s.lastFrameAt < 2000) return;
    }
    inflight++;
    const askedAt = Date.now();
    try {
      const shot = await cdp(s, 'Page.captureScreenshot', {
        format: 'jpeg', quality: FRAME_QUALITY, optimizeForSpeed: true,
      });
      if (shot?.data && askedAt >= s.lastFrameAt) {
        const f: Frame = { data: shot.data, meta: null };
        s.lastFrame = f;
        s.lastFrameAt = Date.now();
        for (const sub of s.subs) { try { sub(f); } catch {} }
      }
    } catch {} finally { inflight--; }
  }, CAPTURE_MS);

  sessions.set(s.id, s);
  byCompany.set(companyId, s.id);
  return s;
}

function kill(s: Session) {
  if (s.poller) { clearInterval(s.poller); s.poller = null; }
  try { s.ws.close(); } catch {}
  try { s.proc.kill('SIGKILL'); } catch {}
  sessions.delete(s.id);
  if (byCompany.get(s.companyId) === s.id) byCompany.delete(s.companyId);
}

/**
 * Pont WebSocket.
 *
 * Le plugin Vite `x-live-ws-plugin` tourne dans le MÊME process mais dans un
 * autre graphe de modules : il ne peut pas importer ce fichier. On publie donc
 * deux fonctions sur globalThis, qu'il appelle. Aucune route existante n'est
 * touchée : SSE, MJPEG et polling restent en place.
 */
g.__xLiveAttach = (sessionId: string, send: (jpeg: Buffer) => void): (() => void) | null => {
  const s = sessions.get(sessionId);
  if (!s) return null;
  const push = (f: Frame) => { try { send(Buffer.from(f.data, 'base64')); } catch {} };
  if (s.lastFrame) push(s.lastFrame);
  s.subs.add(push);
  s.lastUsed = Date.now();
  return () => { s.subs.delete(push); s.lastUsed = Date.now(); };
};

g.__xLiveInput = async (sessionId: string, body: any): Promise<void> => {
  const s = sessions.get(sessionId);
  if (!s) return;
  s.lastUsed = Date.now();
  const k = body.kind as string;
  if (k === 'mouse') {
    await cdp(s, 'Input.dispatchMouseEvent', {
      type: body.type, x: Math.round(body.x), y: Math.round(body.y),
      button: body.button || 'left',
      buttons: body.type === 'mousePressed' ? 1 : 0,
      clickCount: body.clickCount ?? (body.type === 'mouseMoved' ? 0 : 1),
      modifiers: body.modifiers || 0,
    });
  } else if (k === 'wheel') {
    await cdp(s, 'Input.dispatchMouseEvent', {
      type: 'mouseWheel', x: Math.round(body.x), y: Math.round(body.y),
      deltaX: body.deltaX || 0, deltaY: body.deltaY || 0, modifiers: body.modifiers || 0,
    });
  } else if (k === 'key') {
    await cdp(s, 'Input.dispatchKeyEvent', {
      type: body.type || 'keyDown', key: body.key, code: body.code,
      windowsVirtualKeyCode: body.keyCode, nativeVirtualKeyCode: body.keyCode,
      text: body.text, unmodifiedText: body.text, modifiers: body.modifiers || 0,
    });
  } else if (k === 'text') {
    await cdp(s, 'Input.insertText', { text: String(body.text || '') });
  }
};

// Ménage des sessions inactives
setInterval(() => {
  const now = Date.now();
  for (const s of [...sessions.values()]) {
    if (s.subs.size === 0 && now - s.lastUsed > IDLE_MS) kill(s);
  }
}, 60_000);

const xlive = new Hono();

/** Démarre (ou récupère) la session live d'une entreprise. */
xlive.post('/x-live/start', async (c) => {
  if (!X_LIVE_ENABLED) return c.json({ error: 'X Live désactivé' }, 503);
  const body = await c.req.json().catch(() => ({} as any));
  const companyId = String(body.companyId || 'sandbox');
  const url = String(body.url || 'https://x.com/home');

  const existingId = byCompany.get(companyId);
  const existing = existingId ? sessions.get(existingId) : null;
  if (existing && existing.ready) {
    existing.lastUsed = Date.now();
    return c.json({ sessionId: existing.id, url: existing.url, width: VIEW_W, height: VIEW_H, reused: true });
  }

  try {
    const s = await launch(companyId, url);
    return c.json({ sessionId: s.id, url: s.url, width: VIEW_W, height: VIEW_H, reused: false });
  } catch (e: any) {
    return c.json({ error: e?.message || 'Lancement impossible' }, 500);
  }
});

/** Le profil est-il déjà connecté à X ? (présence de cookies) */
xlive.get('/x-live/status', (c) => {
  const companyId = c.req.query('companyId') || 'sandbox';
  const sid = byCompany.get(companyId);
  return c.json({
    enabled: X_LIVE_ENABLED,
    hasProfile: xProfileExists(companyId),
    sessionId: sid && sessions.get(sid) ? sid : null,
    width: VIEW_W,
    height: VIEW_H,
  });
});

/** Diagnostic interne (additif) : état des sessions. */
xlive.get('/x-live/debug', (c) => c.json({
  sessions: [...sessions.values()].map(s => ({
    id: s.id, companyId: s.companyId, ready: s.ready, url: s.url,
    subs: s.subs.size, lastFrameAt: s.lastFrameAt, hasFrame: !!s.lastFrame,
    frameBytes: s.lastFrame ? s.lastFrame.data.length : 0,
    wsState: s.ws.readyState, poller: !!s.poller, port: s.port,
  })),
}));

/** Flux d'images (SSE) : une image JPEG base64 par repaint. */
xlive.get('/x-live/frames', (c) => {
  const wanted = c.req.query('s') || '';
  const s = sessions.get(wanted);
  if (!s) {
    return c.json({ error: 'Session inconnue', wanted, connues: [...sessions.keys()] }, 404);
  }

  const stream = new ReadableStream({
    start(controller) {
      const enc = new TextEncoder();
      const push = (f: Frame) => {
        try {
          controller.enqueue(enc.encode(`data: ${JSON.stringify({ d: f.data, m: f.meta })}\n\n`));
        } catch {}
      };
      if (s.lastFrame) push(s.lastFrame);
      s.subs.add(push);
      const ping = setInterval(() => {
        s.lastUsed = Date.now();
        try { controller.enqueue(enc.encode(': ping\n\n')); } catch {}
      }, 15000);
      (c.req.raw.signal as AbortSignal)?.addEventListener('abort', () => {
        clearInterval(ping);
        s.subs.delete(push);
        s.lastUsed = Date.now();
        try { controller.close(); } catch {}
      });
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  });
});

/**
 * Flux MJPEG (multipart/x-mixed-replace) : UNE seule connexion HTTP, le
 * navigateur décode les images nativement dans un <img> (comme une webcam).
 * Aucune requête par image, aucun aller-retour JS → c'est la voie la plus
 * fluide possible sans WebSocket.
 */
xlive.get('/x-live/mjpeg', (c) => {
  const s = sessions.get(c.req.query('s') || '');
  if (!s) return c.json({ error: 'Session inconnue' }, 404);

  const BOUNDARY = 'velbazframe';
  const enc = new TextEncoder();

  const stream = new ReadableStream({
    start(controller) {
      let closed = false;
      const push = (f: Frame) => {
        if (closed) return;
        try {
          const bin = Buffer.from(f.data, 'base64');
          controller.enqueue(enc.encode(`--${BOUNDARY}\r\nContent-Type: image/jpeg\r\nContent-Length: ${bin.length}\r\n\r\n`));
          controller.enqueue(new Uint8Array(bin));
          controller.enqueue(enc.encode('\r\n'));
          s.lastUsed = Date.now();
        } catch { closed = true; }
      };
      if (s.lastFrame) push(s.lastFrame);
      s.subs.add(push);
      (c.req.raw.signal as AbortSignal)?.addEventListener('abort', () => {
        closed = true;
        s.subs.delete(push);
        s.lastUsed = Date.now();
        try { controller.close(); } catch {}
      });
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': `multipart/x-mixed-replace; boundary=${BOUNDARY}`,
      'Cache-Control': 'no-cache, no-store, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  });
});

/**
 * Une image JPEG (repli fiable au SSE : le front interroge en boucle).
 *
 * Avec `since=<lastFrameAt>` la requête est tenue ouverte (long-poll) jusqu'à
 * ce qu'une image PLUS RÉCENTE arrive : plus d'attente fixe côté client, donc
 * la latence tombe au temps de rendu de Chrome.
 */
xlive.get('/x-live/frame', async (c) => {
  const s = sessions.get(c.req.query('s') || '');
  if (!s) return c.json({ error: 'Session inconnue' }, 404);
  s.lastUsed = Date.now();

  const since = Number(c.req.query('since') || 0);

  // Long-poll : on attend une image plus récente que `since` (max 5 s).
  if (since > 0) {
    const deadline = Date.now() + 5000;
    while (s.lastFrameAt <= since && Date.now() < deadline) {
      await new Promise<void>((resolve) => {
        const t = setTimeout(() => { s.subs.delete(cb); resolve(); }, 120);
        const cb = () => { clearTimeout(t); s.subs.delete(cb); resolve(); };
        s.subs.add(cb);
      });
    }
  }

  let data = s.lastFrame?.data || null;
  // Image trop vieille (ou aucune) → capture immédiate.
  if (!data || Date.now() - s.lastFrameAt > 400) {
    const shot = await cdp(s, 'Page.captureScreenshot', { format: 'jpeg', quality: FRAME_QUALITY });
    if (shot?.data) {
      s.lastFrame = { data: shot.data, meta: null };
      s.lastFrameAt = Date.now();
      data = shot.data;
    }
  }
  if (!data) return c.json({ error: 'Aucune image' }, 503);

  const bin = Buffer.from(data, 'base64');
  return new Response(bin, {
    headers: {
      'Content-Type': 'image/jpeg',
      'Cache-Control': 'no-store',
      'X-Frame-At': String(s.lastFrameAt),
    },
  });
});

/** Entrées utilisateur : souris, molette, clavier. */
xlive.post('/x-live/input', async (c) => {
  const body = await c.req.json().catch(() => ({} as any));
  const s = sessions.get(String(body.sessionId || ''));
  if (!s) return c.json({ error: 'Session inconnue' }, 404);
  s.lastUsed = Date.now();

  const k = body.kind as string;
  if (k === 'mouse') {
    await cdp(s, 'Input.dispatchMouseEvent', {
      type: body.type, // mousePressed | mouseReleased | mouseMoved
      x: Math.round(body.x), y: Math.round(body.y),
      button: body.button || 'left',
      buttons: body.type === 'mousePressed' ? 1 : 0,
      clickCount: body.clickCount ?? (body.type === 'mouseMoved' ? 0 : 1),
      modifiers: body.modifiers || 0,
    });
  } else if (k === 'wheel') {
    await cdp(s, 'Input.dispatchMouseEvent', {
      type: 'mouseWheel',
      x: Math.round(body.x), y: Math.round(body.y),
      deltaX: body.deltaX || 0, deltaY: body.deltaY || 0,
      modifiers: body.modifiers || 0,
    });
  } else if (k === 'key') {
    await cdp(s, 'Input.dispatchKeyEvent', {
      type: body.type || 'keyDown', // keyDown | keyUp | rawKeyDown
      key: body.key,
      code: body.code,
      windowsVirtualKeyCode: body.keyCode,
      nativeVirtualKeyCode: body.keyCode,
      text: body.text,
      unmodifiedText: body.text,
      modifiers: body.modifiers || 0,
    });
  } else if (k === 'text') {
    await cdp(s, 'Input.insertText', { text: String(body.text || '') });
  } else {
    return c.json({ error: 'kind inconnu' }, 400);
  }
  return c.json({ ok: true });
});

/** Navigation : url directe, retour, suivant, rechargement. */
xlive.post('/x-live/nav', async (c) => {
  const body = await c.req.json().catch(() => ({} as any));
  const s = sessions.get(String(body.sessionId || ''));
  if (!s) return c.json({ error: 'Session inconnue' }, 404);
  s.lastUsed = Date.now();

  if (body.url) {
    await cdp(s, 'Page.navigate', { url: String(body.url) });
  } else if (body.action === 'reload') {
    await cdp(s, 'Page.reload', {});
  } else if (body.action === 'back' || body.action === 'forward') {
    const hist = await cdp(s, 'Page.getNavigationHistory', {});
    if (hist) {
      const idx = body.action === 'back' ? hist.currentIndex - 1 : hist.currentIndex + 1;
      const entry = hist.entries?.[idx];
      if (entry) await cdp(s, 'Page.navigateToHistoryEntry', { entryId: entry.id });
    }
  }
  return c.json({ ok: true, url: s.url });
});

/** Arrêt manuel (le profil, donc la session X, est conservé). */
xlive.post('/x-live/stop', async (c) => {
  const body = await c.req.json().catch(() => ({} as any));
  const s = sessions.get(String(body.sessionId || ''));
  if (s) kill(s);
  return c.json({ ok: true });
});

export default xlive;
