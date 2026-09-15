import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { setLoginAsOpen } from '../lib/token';

// Fenêtre "login-as" du panneau admin : un rectangle déplaçable contenant l'app
// entière dans un <iframe>, connectée au compte de l'utilisateur.
//
// Sécurité :
//  - le token n'est jamais dans l'URL : l'iframe reçoit un code à usage unique
//    (60 s) qu'elle échange par POST contre le token (voir lib/token.ts) ;
//  - le token de l'iframe vit en mémoire dans SON frame → l'onglet admin garde
//    sa propre session, rien n'est écrit dans localStorage ;
//  - fermer la fenêtre suffit à oublier la session (30 min côté serveur).
//
// Déclenchée par la commande `login-as <email|userId>` qui émet l'évènement
// 'velbaz-login-as' avec { code, user }.

interface Target { id: string; email: string; name?: string | null }

// Taille de la « page » affichée dans la fenêtre. Fixe : c'est ce qui permet
// de défiler en X et en Y au lieu de comprimer la mise en page.
const VIEW_W = 1280;
const VIEW_H = 900;

export function LoginAsWindow() {
  const [open, setOpen] = useState(false);
  const [code, setCode] = useState<string | null>(null);
  const [target, setTarget] = useState<Target | null>(null);
  const [pos, setPos] = useState({ x: 0, y: 0 });
  const [size, setSize] = useState({ w: 1024, h: 700 });
  const [nonce, setNonce] = useState(0);
  const [scale, setScale] = useState(1);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const [page, setPage] = useState({ w: VIEW_W, h: VIEW_H });
  const drag = useRef<{ dx: number; dy: number } | null>(null);
  const viewport = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const handler = (e: Event) => {
      const d = (e as CustomEvent).detail || {};
      if (!d.code) return;
      const w = Math.min(1024, window.innerWidth - 80);
      const h = Math.min(700, window.innerHeight - 80);
      setSize({ w, h });
      setPos({ x: Math.max(20, (window.innerWidth - w) / 2), y: Math.max(20, (window.innerHeight - h) / 2) });
      setTarget(d.user || null);
      setCode(d.code);
      setNonce(n => n + 1);
      setOpen(true);
    };
    window.addEventListener('velbaz-login-as', handler as EventListener);
    return () => window.removeEventListener('velbaz-login-as', handler as EventListener);
  }, []);

  // Tant que la fenêtre est ouverte, l'onglet parent se met en veille : plus
  // aucune reprise « retour au premier plan » (re-sync du chat, relance vidéo)
  // ne se déclenche, donc plus de chats dupliqués ni de bugs d'affichage.
  useEffect(() => {
    setLoginAsOpen(open);
    return () => setLoginAsOpen(false);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const move = (e: MouseEvent) => {
      if (!drag.current) return;
      setPos({ x: e.clientX - drag.current.dx, y: e.clientY - drag.current.dy });
    };
    const up = () => { drag.current = null; };
    window.addEventListener('mousemove', move);
    window.addEventListener('mouseup', up);
    return () => { window.removeEventListener('mousemove', move); window.removeEventListener('mouseup', up); };
  }, [open]);

  // Mise à l'échelle : l'app est rendue en mise en page bureau (au moins
  // VIEW_W de large) puis dézoomée pour occuper EXACTEMENT toute la fenêtre.
  // La page interne fait toujours la taille réelle de la zone divisée par le
  // zoom → aucune bande noire, aucun défilement, rien de comprimé.
  useEffect(() => {
    if (!open) return;
    const el = viewport.current;
    if (!el) return;
    const fit = () => {
      const w = el.clientWidth;
      const h = el.clientHeight;
      if (!w || !h) return;
      const s = Math.min(1, w / VIEW_W, h / VIEW_H);
      setScale(s);
      setOffset({ x: 0, y: 0 });
      setPage({ w: Math.round(w / s), h: Math.round(h / s) });
    };
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(el);
    window.addEventListener('resize', fit);
    return () => { ro.disconnect(); window.removeEventListener('resize', fit); };
  }, [open, nonce]);

  if (!open || !code) return null;

  const label = target?.name || target?.email || 'utilisateur';

  return createPortal(
    <div
      style={{
        position: 'fixed',
        left: pos.x,
        top: pos.y,
        width: size.w,
        height: size.h,
        zIndex: 2147483000,
        display: 'flex',
        flexDirection: 'column',
        background: 'var(--bg, #0b0f19)',
        border: '1px solid var(--border, rgba(255,255,255,0.14))',
        borderRadius: 10,
        overflow: 'hidden',
        boxShadow: '0 24px 80px rgba(0,0,0,0.6)',
        resize: 'both',
      }}
    >
      {/* Barre de titre : glisser pour déplacer. */}
      <div
        onMouseDown={e => { drag.current = { dx: e.clientX - pos.x, dy: e.clientY - pos.y }; }}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 10,
          padding: '8px 10px',
          cursor: 'move',
          userSelect: 'none',
          borderBottom: '1px solid var(--border, rgba(255,255,255,0.14))',
          fontSize: 12,
          fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
        }}
      >
        <span style={{ color: 'var(--danger, #ef4444)', fontWeight: 700 }}>LOGIN-AS</span>
        <span style={{ opacity: 0.85, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {label} · {target?.email} · session 30 min
        </span>
        <div style={{ flex: 1 }} />
        <button
          onClick={() => setNonce(n => n + 1)}
          title="Recharger"
          style={btn}
        >↻</button>
        <button
          onClick={() => { setOpen(false); setCode(null); }}
          title="Quitter le compte"
          style={btn}
        >✕</button>
      </div>

      {/* Aucun défilement : l'app garde sa mise en page de bureau (VIEW_W × VIEW_H)
          et c'est l'échelle qui s'adapte à la fenêtre. Tout tient toujours dedans,
          rien n'est comprimé, rien à faire défiler. */}
      <div
        ref={viewport}
        style={{
          flex: 1,
          minHeight: 0,
          overflow: 'hidden',
          position: 'relative',
          background: 'var(--bg, #0b0f19)',
        }}
      >
        <iframe
          key={nonce}
          src={`/?imp=${encodeURIComponent(code)}`}
          title={`Compte de ${label}`}
          style={{
            display: 'block',
            position: 'absolute',
            top: 0,
            left: 0,
            width: page.w,
            height: page.h,
            border: 'none',
            background: 'var(--bg, #0b0f19)',
            transform: `translate(${offset.x}px, ${offset.y}px) scale(${scale})`,
            transformOrigin: 'top left',
          }}
        />
      </div>
    </div>,
    document.body,
  );
}

const btn: React.CSSProperties = {
  width: 24,
  height: 24,
  display: 'grid',
  placeItems: 'center',
  border: 'none',
  borderRadius: 6,
  background: 'transparent',
  color: 'inherit',
  opacity: 0.7,
  cursor: 'pointer',
  fontSize: 13,
};

export default LoginAsWindow;
