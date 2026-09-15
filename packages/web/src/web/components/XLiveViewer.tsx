/**
 * XLiveViewer — le vrai site X (Twitter) DANS l'app.
 *
 * Le serveur pilote un Chrome réel (profil persistant par entreprise) et
 * diffuse l'écran en JPEG via SSE (`/api/x-live/frames`). Ici on affiche ces
 * images et on renvoie clics / molette / clavier au serveur
 * (`/api/x-live/input`). Les vidéos X fonctionnent : c'est un vrai Chrome qui
 * les décode (l'image bouge ; le son n'est pas encore relayé).
 *
 * Purement additif : aucun composant existant n'est supprimé.
 */

import { useEffect, useRef, useState, useCallback } from 'react';

interface Props {
  companyId: string;
  /** URL de départ, ex. https://x.com/home */
  startUrl?: string;
  className?: string;
}

/**
 * Voie WebSocket (active) : une seule connexion, images JPEG poussées en
 * binaire dès que Chrome repeint, entrées renvoyées par le même tuyau.
 * C'est la seule voie vraiment fluide : ni SSE ni MJPEG ne passent, le plugin
 * Hono de dev met les réponses en flux dans un tampon (elles ressortent vides).
 */
const X_LIVE_WS = true;
/** Voie MJPEG : conservée, mais bufferisée en dev → inactive. */
const X_LIVE_MJPEG = false;
/** Voie SSE conservée mais désactivée : le flux est bufferisé par le plugin Hono en dev. */
const X_LIVE_SSE = false;
/** Cadence du polling d'images JPEG (ms) — repli si MJPEG désactivé. */
const X_LIVE_POLL_MS = 120;

const KEY_CODES: Record<string, number> = {
  Backspace: 8, Tab: 9, Enter: 13, Shift: 16, Control: 17, Alt: 18, Escape: 27,
  ' ': 32, PageUp: 33, PageDown: 34, End: 35, Home: 36,
  ArrowLeft: 37, ArrowUp: 38, ArrowRight: 39, ArrowDown: 40, Delete: 46,
};

export function XLiveViewer({ companyId, startUrl = 'https://x.com/home', className }: Props) {
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [frame, setFrame] = useState<string | null>(null);
  const [frameUrl, setFrameUrl] = useState<string | null>(null);
  const [status, setStatus] = useState<'idle' | 'starting' | 'live' | 'error'>('idle');
  const [error, setError] = useState<string | null>(null);
  const [addr, setAddr] = useState(startUrl);
  const boxRef = useRef<HTMLDivElement>(null);
  const sizeRef = useRef({ w: 1280, h: 900 });
  const wsRef = useRef<WebSocket | null>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [wsReady, setWsReady] = useState(false);

  // ─── Démarrage de la session ───
  useEffect(() => {
    let cancelled = false;
    setStatus('starting');
    (async () => {
      try {
        const res = await fetch('/api/x-live/start', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ companyId, url: startUrl }),
        });
        const data = await res.json() as any;
        if (cancelled) return;
        if (!res.ok || !data.sessionId) throw new Error(data.error || `Erreur ${res.status}`);
        sizeRef.current = { w: data.width || 1280, h: data.height || 900 };
        setSessionId(data.sessionId);
        setStatus('live');
      } catch (e: any) {
        if (!cancelled) { setError(e?.message || 'Démarrage impossible'); setStatus('error'); }
      }
    })();
    return () => { cancelled = true; };
  }, [companyId, startUrl]);

  // ─── Flux d'images (SSE) — conservé mais désactivé : le flux est bufferisé en dev ───
  useEffect(() => {
    if (!X_LIVE_SSE) return;
    if (!sessionId) return;
    const es = new EventSource(`/api/x-live/frames?s=${sessionId}`);
    es.onmessage = (ev) => {
      try {
        const p = JSON.parse(ev.data);
        if (p.d) setFrame(p.d);
      } catch {}
    };
    es.onerror = () => { /* le navigateur reconnecte tout seul */ };
    return () => es.close();
  }, [sessionId]);

  // ─── Flux d'images (polling d'images JPEG) — repli, inactif si MJPEG ───
  useEffect(() => {
    if (X_LIVE_SSE || X_LIVE_MJPEG) return;
    if (!sessionId) return;
    let stopped = false;
    let lastUrl: string | null = null;
    let since = 0;
    const tick = async () => {
      while (!stopped) {
        try {
          // Long-poll : le serveur répond dès qu'une image plus récente existe.
          const res = await fetch(`/api/x-live/frame?s=${sessionId}&since=${since}`, { cache: 'no-store' });
          if (res.ok) {
            since = Number(res.headers.get('X-Frame-At') || 0) || since;
            const blob = await res.blob();
            if (stopped) break;
            const url = URL.createObjectURL(blob);
            setFrameUrl(url);
            if (lastUrl) URL.revokeObjectURL(lastUrl);
            lastUrl = url;
            continue; // enchaîne immédiatement, aucune attente fixe
          }
        } catch {}
        await new Promise((r) => setTimeout(r, X_LIVE_POLL_MS));
      }
    };
    tick();
    return () => {
      stopped = true;
      if (lastUrl) URL.revokeObjectURL(lastUrl);
    };
  }, [sessionId]);

  // ─── Flux d'images (WebSocket) — voie active, une seule connexion ───
  useEffect(() => {
    if (!X_LIVE_WS) return;
    if (!sessionId) return;
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    const ws = new WebSocket(`${proto}://${location.host}/x-live-ws?s=${sessionId}`);
    ws.binaryType = 'blob';
    wsRef.current = ws;
    let disposed = false;
    let busy = false;

    ws.onopen = () => setWsReady(true);
    ws.onclose = () => setWsReady(false);
    ws.onmessage = async (ev) => {
      if (disposed || busy || !(ev.data instanceof Blob)) return;
      busy = true; // on saute les images tant que la précédente se décode
      try {
        const bmp = await createImageBitmap(ev.data);
        const cv = canvasRef.current;
        if (cv && !disposed) {
          if (cv.width !== bmp.width || cv.height !== bmp.height) {
            cv.width = bmp.width; cv.height = bmp.height;
          }
          cv.getContext('2d')?.drawImage(bmp, 0, 0);
        }
        bmp.close();
      } catch {}
      busy = false;
    };

    return () => {
      disposed = true;
      wsRef.current = null;
      setWsReady(false);
      try { ws.close(); } catch {}
    };
  }, [sessionId]);

  // ─── Conversion coordonnées écran → coordonnées Chrome ───
  const toRemote = useCallback((e: { clientX: number; clientY: number }) => {
    const el = boxRef.current;
    if (!el) return { x: 0, y: 0 };
    const r = el.getBoundingClientRect();
    const { w, h } = sizeRef.current;
    return {
      x: Math.max(0, Math.min(w, ((e.clientX - r.left) / r.width) * w)),
      y: Math.max(0, Math.min(h, ((e.clientY - r.top) / r.height) * h)),
    };
  }, []);

  const send = useCallback((payload: any) => {
    if (!sessionId) return;
    // Voie rapide : le WebSocket déjà ouvert (aucun aller-retour HTTP).
    const ws = wsRef.current;
    if (X_LIVE_WS && ws && ws.readyState === WebSocket.OPEN) {
      try { ws.send(JSON.stringify(payload)); return; } catch {}
    }
    fetch('/api/x-live/input', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessionId, ...payload }),
    }).catch(() => {});
  }, [sessionId]);

  const nav = useCallback((payload: any) => {
    if (!sessionId) return;
    fetch('/api/x-live/nav', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessionId, ...payload }),
    }).catch(() => {});
  }, [sessionId]);

  // ─── Clavier (quand la vue a le focus) ───
  const onKey = useCallback((e: React.KeyboardEvent | KeyboardEvent) => {
    if (!sessionId) return;
    e.preventDefault();
    const printable = e.key.length === 1 && !e.ctrlKey && !e.metaKey;
    const modifiers = (e.altKey ? 1 : 0) | (e.ctrlKey ? 2 : 0) | (e.metaKey ? 4 : 0) | (e.shiftKey ? 8 : 0);
    if (printable) {
      send({ kind: 'text', text: e.key });
      return;
    }
    send({
      kind: 'key', type: 'rawKeyDown', key: e.key, code: e.code,
      keyCode: KEY_CODES[e.key] ?? e.key.toUpperCase().charCodeAt(0), modifiers,
    });
    send({
      kind: 'key', type: 'keyUp', key: e.key, code: e.code,
      keyCode: KEY_CODES[e.key] ?? e.key.toUpperCase().charCodeAt(0), modifiers,
    });
  }, [send, sessionId]);

  // ─── Focus clavier ───
  //
  // Avant : les touches n'arrivaient que si le <div> gardait le focus DOM ;
  // dès qu'un clic partait ailleurs (ou que React re-rendait), il fallait
  // recliquer hors de la zone pour pouvoir écrire. Maintenant : dès qu'on a
  // cliqué DANS l'écran distant, on capte le clavier au niveau de la fenêtre
  // jusqu'au prochain clic en dehors.
  const engagedRef = useRef(false);
  useEffect(() => {
    if (!sessionId) return;
    const onDown = (e: MouseEvent) => {
      const el = boxRef.current;
      engagedRef.current = !!el && el.contains(e.target as Node);
      if (engagedRef.current) { try { el!.focus({ preventScroll: true }); } catch {} }
    };
    const onWinKey = (e: KeyboardEvent) => {
      if (!engagedRef.current) return;
      // Laisse la barre d'adresse (ou tout autre champ réel) se comporter normalement.
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
      onKey(e);
    };
    window.addEventListener('mousedown', onDown, true);
    window.addEventListener('keydown', onWinKey, true);
    return () => {
      window.removeEventListener('mousedown', onDown, true);
      window.removeEventListener('keydown', onWinKey, true);
    };
  }, [sessionId, onKey]);

  // ─── Molette (listener non passif pour pouvoir bloquer le scroll de la page) ───
  useEffect(() => {
    const el = boxRef.current;
    if (!el || !sessionId) return;
    const handler = (e: WheelEvent) => {
      e.preventDefault();
      const { x, y } = toRemote(e);
      send({ kind: 'wheel', x, y, deltaX: e.deltaX, deltaY: e.deltaY });
    };
    el.addEventListener('wheel', handler, { passive: false });
    return () => el.removeEventListener('wheel', handler);
  }, [sessionId, send, toRemote]);

  const ratio = sizeRef.current.h / sizeRef.current.w;

  return (
    <div className={`flex flex-col h-full min-h-0 ${className || ''}`}>
      {/* Barre d'adresse */}
      <div className="flex items-center gap-1.5 px-2 py-1.5 shrink-0" style={{ borderBottom: '1px solid var(--border-subtle)' }}>
        <button onClick={() => nav({ action: 'back' })} className="w-6 h-6 rounded flex items-center justify-center" style={{ color: 'var(--text-dim)' }} title="Retour">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><path d="M15 18l-6-6 6-6"/></svg>
        </button>
        <button onClick={() => nav({ action: 'forward' })} className="w-6 h-6 rounded flex items-center justify-center" style={{ color: 'var(--text-dim)' }} title="Suivant">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><path d="M9 18l6-6-6-6"/></svg>
        </button>
        <button onClick={() => nav({ action: 'reload' })} className="w-6 h-6 rounded flex items-center justify-center" style={{ color: 'var(--text-dim)' }} title="Recharger">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><path d="M21 12a9 9 0 1 1-2.64-6.36M21 3v6h-6"/></svg>
        </button>
        <form
          className="flex-1"
          onSubmit={(e) => { e.preventDefault(); nav({ url: addr.startsWith('http') ? addr : `https://${addr}` }); }}
        >
          <input
            value={addr}
            onChange={(e) => setAddr(e.target.value)}
            spellCheck={false}
            className="w-full text-[11px] px-2 py-1 rounded-md outline-none"
            style={{ background: 'var(--surface-2)', color: 'var(--text-dim)', border: '1px solid var(--border-subtle)' }}
          />
        </form>
        <span className="text-[9px] px-1.5 py-0.5 rounded shrink-0"
          style={{ background: status === 'live' ? 'rgba(16,185,129,0.15)' : 'rgba(148,163,184,0.15)', color: status === 'live' ? '#10b981' : 'var(--text-ghost)' }}>
          {status === 'live' ? 'LIVE' : status === 'starting' ? '…' : status === 'error' ? 'ERR' : ''}
        </span>
      </div>

      {/* Écran distant */}
      <div className="flex-1 min-h-0 overflow-auto" style={{ background: '#000' }}>
        <div
          ref={boxRef}
          tabIndex={0}
          onKeyDown={onKey}
          onMouseDown={(e) => { const { x, y } = toRemote(e); send({ kind: 'mouse', type: 'mousePressed', x, y, clickCount: e.detail || 1 }); }}
          onMouseUp={(e) => { const { x, y } = toRemote(e); send({ kind: 'mouse', type: 'mouseReleased', x, y, clickCount: e.detail || 1 }); }}
          onMouseMove={(e) => { if (e.buttons) { const { x, y } = toRemote(e); send({ kind: 'mouse', type: 'mouseMoved', x, y }); } }}
          onContextMenu={(e) => e.preventDefault()}
          className="w-full outline-none select-none"
          style={{ aspectRatio: `${sizeRef.current.w} / ${sizeRef.current.h}`, position: 'relative', cursor: 'default' }}
        >
          {X_LIVE_WS ? (
            <canvas
              ref={canvasRef}
              style={{ width: '100%', height: '100%', display: wsReady ? 'block' : 'none' }}
            />
          ) : null}
          {X_LIVE_WS ? (wsReady ? null : (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-2">
              <div className="w-5 h-5 rounded-full border-2 border-t-transparent animate-spin" style={{ borderColor: '#fff', borderTopColor: 'transparent' }}/>
              <span className="text-[11px]" style={{ color: 'rgba(255,255,255,0.6)' }}>
                {status === 'error' ? (error || 'Erreur') : 'Ouverture de X…'}
              </span>
            </div>
          )) : (X_LIVE_MJPEG ? sessionId : X_LIVE_SSE ? frame : frameUrl) ? (
            <img
              src={X_LIVE_MJPEG
                ? `/api/x-live/mjpeg?s=${sessionId}`
                : X_LIVE_SSE ? `data:image/jpeg;base64,${frame}` : (frameUrl as string)}
              draggable={false}
              alt=""
              style={{ width: '100%', height: '100%', display: 'block', objectFit: 'fill' }}
            />
          ) : (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-2">
              <div className="w-5 h-5 rounded-full border-2 border-t-transparent animate-spin" style={{ borderColor: '#fff', borderTopColor: 'transparent' }}/>
              <span className="text-[11px]" style={{ color: 'rgba(255,255,255,0.6)' }}>
                {status === 'error' ? (error || 'Erreur') : 'Ouverture de X…'}
              </span>
            </div>
          )}
          <div style={{ position: 'absolute', inset: 0, pointerEvents: 'none', aspectRatio: `${1 / ratio}` }} />
        </div>
      </div>
    </div>
  );
}

export default XLiveViewer;
