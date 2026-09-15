/**
 * Affichage des toasts (voir lib/toast.ts). Monté UNE seule fois par app.tsx.
 *
 * Choix d'implémentation :
 *  - en bas au centre : c'est là que regarde l'utilisateur après un clic sur un
 *    bouton d'action, et ça ne recouvre ni la barre du haut de l'aperçu ni la
 *    barre de prompt du chat ;
 *  - `pointer-events: none` sur la pile, réactivé sur chaque toast, pour ne
 *    jamais voler un clic destiné à l'interface en dessous ;
 *  - trois maximum à l'écran : au-delà on empile du bruit ;
 *  - `role="status"` + `aria-live="polite"` : le message est annoncé sans
 *    interrompre ce que fait l'utilisateur.
 */

import { useEffect, useRef, useState } from 'react';
import { onToast, type ToastItem } from '../lib/toast';
import { useI18n } from '../lib/i18n';

const MAX_VISIBLE = 3;

export function ToastHost() {
  const { t } = useI18n();
  const [items, setItems] = useState<ToastItem[]>([]);
  const timers = useRef(new Map<number, number>());

  useEffect(() => {
    const off = onToast(item => {
      setItems(prev => [...prev, item].slice(-MAX_VISIBLE));
      const id = window.setTimeout(() => {
        setItems(prev => prev.filter(t => t.id !== item.id));
        timers.current.delete(item.id);
      }, item.duration);
      timers.current.set(item.id, id);
    });
    return () => {
      off();
      timers.current.forEach(id => window.clearTimeout(id));
      timers.current.clear();
    };
  }, []);

  const dismiss = (id: number) => {
    const t = timers.current.get(id);
    if (t) { window.clearTimeout(t); timers.current.delete(id); }
    setItems(prev => prev.filter(x => x.id !== id));
  };

  if (items.length === 0) return null;

  return (
    <div className="toast-stack" role="status" aria-live="polite" data-testid="toast-stack">
      {items.map(item => (
        <button
          key={item.id}
          type="button"
          className={`toast toast--${item.kind}`}
          onClick={() => dismiss(item.id)}
          title={t('toast.dismiss')}
        >
          <span className="toast-icon" aria-hidden>
            {item.kind === 'success' ? (
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12" /></svg>
            ) : item.kind === 'error' ? (
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
            ) : (
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="9" /><line x1="12" y1="11" x2="12" y2="16" /><line x1="12" y1="7.5" x2="12" y2="7.6" /></svg>
            )}
          </span>
          <span className="toast-text">{item.message}</span>
        </button>
      ))}
    </div>
  );
}

export default ToastHost;
