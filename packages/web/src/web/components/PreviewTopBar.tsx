// ─── Barre du haut du rectangle d'aperçu ─────────────────────────────────────
//
// [2026-09-13] Refonte demandée avec capture d'écran de référence : UNE seule
// barre en haut du rectangle, qui rassemble tout.
//
//   «  [ Preview | Dashboard ]  📌      ( ▭▾ | /chemin      ↻  ↗ )      ⌥ Edit  Publish  ✕
//
//  - «            : l'aperçu prend toute la largeur du chat (et revient).
//  - Preview/Dash. : bascule aperçu du site ↔ tableau de bord (commandes).
//  - 📌            : épingle l'aperçu (plus de fermeture ni de redimension).
//  - ▭▾           : appareil simulé — Mobile / Tablet / Desktop. Le site
//                    RÉTRÉCIT à cette largeur dans le rectangle.
//  - /chemin       : page affichée, cliquable pour changer de page.
//  - ↻            : recharge l'aperçu.
//  - ↗            : ouvre le site dans un onglet du navigateur (vraie URL).
//  - Edit          : [2026-09-13] BRANCHÉ. Bascule le mode d'édition visuelle
//                    de l'aperçu : le bouton devient « Exit edit », le survol
//                    d'un élément du site le cerne en bleu, et un clic ouvre
//                    une bulle où l'on écrit la modification demandée (l'IA
//                    reçoit la page + le sélecteur DOM exact → édition ciblée
//                    et rapide). Logique : lib/edit-picker.ts + WebsitePreview.
//  - Publish       : ouvre la popup de publication (ancrée sous le bouton).
//  - ✕            : ferme le rectangle.
//
// Ne pas revenir à l'ancienne barre (titre + Publish + croix) ni remettre une
// deuxième barre d'adresse dans l'aperçu sans demande explicite.

import { useEffect, useRef, useState } from 'react';
import type { PreviewApi, PreviewViewport } from '../pages/chat';

function IconMobile({ size = 13 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
      <rect x="7" y="2.5" width="10" height="19" rx="2.5" /><path d="M11 18.5h2" />
    </svg>
  );
}
function IconTablet({ size = 13 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3.5" y="4.5" width="17" height="13" rx="2" /><path d="M9 20.5h9" />
    </svg>
  );
}
function IconDesktop({ size = 13 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
      <rect x="2.5" y="4" width="19" height="12.5" rx="2" /><path d="M8.5 20.5h7M12 16.5v4" />
    </svg>
  );
}

const VP: { id: PreviewViewport; label: string; icon: (p: { size?: number }) => React.JSX.Element }[] = [
  { id: 'mobile', label: 'Mobile', icon: IconMobile },
  { id: 'tablet', label: 'Tablet', icon: IconTablet },
  { id: 'desktop', label: 'Desktop', icon: IconDesktop },
];

/* Ordre d'effacement quand le groupe de droite sort du rectangle : du moins
   utile au plus utile. Publish, la croix et le segment restent toujours. */
const DROPS = ['slots', 'pin', 'edit'] as const;

export default function PreviewTopBar({
  title,
  wide, onToggleWide,
  mode, onMode,
  pinned, onTogglePin,
  viewport, onViewport,
  api,
  showBrowserControls,
  showModes,
  showPublish, publishRef, onPublish,
  showEdit,
  showWide = true,
  showPin = true,
  showDevice = true,
  onClose,
  githubSlot,
  collaboratorsSlot,
}: {
  title: string;
  wide: boolean; onToggleWide: () => void;
  /* [2026-09-13] « Dashboard » n'est plus le panneau Commandes : c'est le
     conteneur (Code / Commandes / Appareil / Équipe). Il reste donc allumé
     pour toutes ses sections, et `onMode('dashboard')` rouvre la dernière. */
  mode: 'preview' | 'code' | 'orders' | 'devices' | 'team'; onMode: (m: 'preview' | 'dashboard') => void;
  pinned: boolean; onTogglePin: () => void;
  viewport: PreviewViewport; onViewport: (v: PreviewViewport) => void;
  api: PreviewApi | null;
  showBrowserControls: boolean;
  showModes: boolean;
  showPublish: boolean;
  publishRef: React.RefObject<HTMLButtonElement | null>;
  onPublish: () => void;
  showEdit: boolean;
  /* [2026-09-14] Sur telephone la meme barre est utilisee, mais deux boutons
     n'y ont aucun sens : « elargir l'apercu sur tout le chat » (l'apercu est
     deja plein ecran) et l'epingle (rien a redimensionner). */
  showWide?: boolean;
  showPin?: boolean;
  /* Sur telephone, simuler « Mobile / Tablet / Desktop » dans un ecran de
     390 px n'a pas de sens : l'appareil disparait de la pilule et rend sa
     place au chemin, qui reste utile (changer de page). */
  showDevice?: boolean;
  onClose: () => void;
  githubSlot?: React.ReactNode;
  collaboratorsSlot?: React.ReactNode;
}) {
  const [vpOpen, setVpOpen] = useState(false);
  const [pagesOpen, setPagesOpen] = useState(false);
  const [spin, setSpin] = useState(false);
  const vpWrap = useRef<HTMLDivElement | null>(null);
  const pagesWrap = useRef<HTMLDivElement | null>(null);
  const barRef = useRef<HTMLDivElement | null>(null);
  const centerRef = useRef<HTMLDivElement | null>(null);

  /* ── [2026-09-14] Ce qui n'a plus la place S'EFFACE, au lieu de sortir ─────
     Deux problemes, meme principe : aucun bouton de cette barre ne se
     comprime, donc quand on retrecit le rectangle ils finissaient par se
     coller entre eux (la pilule ecrasee a ~10 px) ou par SORTIR du rectangle
     (Publish et la croix passaient derriere le bord droit).
     Maintenant : la pilule a une largeur plancher et disparait quand la place
     manque, puis les elements du groupe de droite disparaissent un par un,
     du moins utile au plus utile, tant que ca depasse :
        1. equipe + GitHub   2. epingle   3. Edit
     « Preview | Dashboard », Publish et la croix restent toujours la. */
  const [tight, setTight] = useState(false);
  const [drop, setDrop] = useState(0);
  const [squeeze, setSqueeze] = useState(false);
  const pillRef = useRef<HTMLDivElement | null>(null);
  const rightRef = useRef<HTMLDivElement | null>(null);
  const slotsRef = useRef<HTMLSpanElement | null>(null);
  const pinRef = useRef<HTMLButtonElement | null>(null);
  const editRef = useRef<HTMLButtonElement | null>(null);
  // Largeur reelle de chaque element effacable, apprise quand il est visible
  // (sinon il n'est plus dans le DOM et on ne peut plus la mesurer).
  const wRef = useRef<Record<string, number>>({ slots: 90, pin: 34, edit: 71 });

  useEffect(() => {
    const el = barRef.current;
    if (!el) return;
    const apply = () => {
      const learn = (k: string, node: HTMLElement | null) => {
        if (node && node.offsetWidth > 0) wRef.current[k] = node.offsetWidth + 6; // + gouttiere
      };
      learn('slots', slotsRef.current);
      learn('pin', pinRef.current);
      learn('edit', editRef.current);

      const cs = getComputedStyle(el);
      const gap = parseFloat(cs.columnGap) || 0;
      const kids = Array.from(el.children) as HTMLElement[];

      // UNE seule mesure pour tout : la place libre au centre = largeur utile
      // de la barre moins tout ce qui ne se comprime pas (fleche, segment,
      // epingle, groupe de droite, gouttieres, marges interieures).
      let used = (parseFloat(cs.paddingLeft) || 0) + (parseFloat(cs.paddingRight) || 0) + gap * Math.max(0, kids.length - 1);
      for (const k of kids) if (k !== centerRef.current) used += k.offsetWidth;
      const free = el.clientWidth - used;

      // PILL = largeur mini de la pilule (ses icones + le chemin). C'est la
      // cible : on prefere effacer les decorations plutot que la pilule.
      const PILL = showDevice ? 112 : 84;

      // 1) Quand la place manque, on efface l'element suivant du groupe de
      //    droite (equipe/GitHub, puis epingle, puis Edit) pour LIBERER la
      //    place de la pilule. On le remet quand il rentre sans la recasser.
      setDrop(prev => {
        if (free < PILL && prev < DROPS.length) return prev + 1;
        if (prev > 0) {
          const back = wRef.current[DROPS[prev - 1]] ?? 40;
          if (free - back >= PILL + 8) return prev - 1;
        }
        return prev;
      });

      // 2) La pilule ne s'efface qu'en DERNIER : tout le reste est deja parti
      //    et il n'y a toujours pas ses 112 px.
      setTight(prev => {
        const lacks = prev ? free < PILL + 8 : free < PILL;
        const next = lacks && drop >= DROPS.length;
        return next === prev ? prev : next;
      });

      // 3) Dernier recours : tout est deja efface et ca depasse encore. Le
      //    segment Preview|Dashboard devient le seul a se comprimer (il
      //    tronque), pour que Publish et la croix restent DANS le rectangle.
      setSqueeze(prev => {
        if (!prev) return free < 0 && drop >= DROPS.length;
        return !(free > 16);
      });
    };
    apply();
    const ro = new ResizeObserver(apply);
    ro.observe(el);
    return () => ro.disconnect();
  }, [tight, drop, squeeze, showDevice]);

  const gone = (k: (typeof DROPS)[number]) => DROPS.indexOf(k) < drop;

  // Fermeture des deux menus au clic extérieur.
  useEffect(() => {
    if (!vpOpen && !pagesOpen) return;
    const onDown = (e: MouseEvent) => {
      if (vpOpen && vpWrap.current && !vpWrap.current.contains(e.target as Node)) setVpOpen(false);
      if (pagesOpen && pagesWrap.current && !pagesWrap.current.contains(e.target as Node)) setPagesOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [vpOpen, pagesOpen]);

  const editing = !!api?.editMode;
  const cur = VP.find(v => v.id === viewport) || VP[2];
  const CurIcon = cur.icon;
  const pages = api?.pages || [];

  return (
    <div ref={barRef} className="preview-tb">
      {/* ── Gauche ── */}
      {showWide && (
      <button
        type="button"
        onClick={onToggleWide}
        className="preview-tb-icon"
        title={wide ? "Réduire l'aperçu" : "Élargir l'aperçu sur tout le chat"}
        aria-label={wide ? "Réduire l'aperçu" : "Élargir l'aperçu sur tout le chat"}
      >
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
          style={{ transform: wide ? 'rotate(180deg)' : 'none', transition: 'transform 0.28s cubic-bezier(0.22, 1, 0.36, 1)' }}>
          <polyline points="11 17 6 12 11 7" /><polyline points="18 17 13 12 18 7" />
        </svg>
      </button>
      )}

      {showModes ? (
        <div className={`preview-tb-seg${squeeze ? ' preview-tb-seg--sq' : ''}`}>
          <button type="button" data-on={mode === 'preview'} onClick={() => onMode('preview')}>Preview</button>
          <button type="button" data-on={mode !== 'preview'} onClick={() => onMode('dashboard')}>Dashboard</button>
        </div>
      ) : (
        <span className="preview-tb-title">{title}</span>
      )}

      {showPin && !gone('pin') && (
      <button
        type="button"
        ref={pinRef}
        onClick={onTogglePin}
        className={`preview-tb-icon${pinned ? ' preview-tb-icon--on' : ''}`}
        title={pinned ? "Désépingler l'aperçu" : "Épingler l'aperçu (pas de fermeture ni de redimensionnement)"}
        aria-label="Épingler l'aperçu"
        data-testid="preview-pin"
      >
        {/* Punaise : remplie quand l'aperçu est épinglé, contour sinon. */}
        <svg width="14" height="14" viewBox="0 0 24 24" fill={pinned ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
          <path d="M12 16.5V22" /><path d="M9.2 10.6V4.5h5.6v6.1l2.2 3.4H7L9.2 10.6Z" />
        </svg>
      </button>
      )}

      {/* ── Centre : appareil + chemin + recharger + ouvrir dans le navigateur ── */}
      <div ref={centerRef} className="preview-tb-center">
        {showBrowserControls && !tight && (
          <div ref={pillRef} className={`preview-tb-url${showDevice ? '' : ' preview-tb-url--nodev'}`}>
            {showDevice && (
            <div ref={vpWrap} style={{ position: 'relative', display: 'flex' }}>
              <button
                type="button"
                className={`preview-tb-sq${vpOpen ? ' preview-tb-sq--on' : ''}`}
                onClick={() => { setVpOpen(v => !v); setPagesOpen(false); }}
                title={`Appareil : ${cur.label}`}
                data-testid="preview-viewport"
              >
                <CurIcon size={13} />
              </button>
              {vpOpen && (
                <div className="preview-tb-menu" data-testid="preview-viewport-menu">
                  {VP.map(v => {
                    const Ico = v.icon;
                    return (
                      <button
                        key={v.id}
                        type="button"
                        data-on={v.id === viewport}
                        onClick={() => { onViewport(v.id); setVpOpen(false); }}
                      >
                        <Ico size={14} />
                        <span>{v.label}</span>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
            )}

            <div ref={pagesWrap} style={{ position: 'relative', flex: 1, minWidth: 0, display: 'flex' }}>
              <button
                type="button"
                className="preview-tb-path"
                onClick={() => { if (pages.length > 1) { setPagesOpen(v => !v); setVpOpen(false); } }}
                style={{ cursor: pages.length > 1 ? 'pointer' : 'default' }}
                title={pages.length > 1 ? 'Changer de page' : api?.path || '/'}
                data-testid="preview-path"
              >
                {api?.path || '/'}
              </button>
              {pagesOpen && pages.length > 1 && (
                <div className="preview-tb-menu preview-tb-menu--pages">
                  {pages.map(p => (
                    <button
                      key={p.slug}
                      type="button"
                      data-on={('/' + (p.slug === 'index' ? '' : p.slug)) === (api?.path || '/')}
                      onClick={() => { api?.navigate(p.slug); setPagesOpen(false); }}
                    >
                      <span style={{ opacity: 0.75, fontFamily: 'monospace', fontSize: 10.5 }}>/{p.slug === 'index' ? '' : p.slug}</span>
                      <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.title}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>

            <button
              type="button"
              className="preview-tb-mini"
              onClick={() => { api?.refresh(); setSpin(true); setTimeout(() => setSpin(false), 650); }}
              title="Recharger l'aperçu"
              data-testid="preview-reload"
            >
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
                style={{ transform: spin ? 'rotate(360deg)' : 'none', transition: spin ? 'transform .65s ease' : 'none' }}>
                <path d="M21 12a9 9 0 1 1-3.2-6.9" /><path d="M21 4v5h-5" />
              </svg>
            </button>

            <a
              className="preview-tb-mini"
              href={api?.url || '#'}
              target="_blank"
              rel="noopener noreferrer"
              title="Ouvrir le site dans un onglet du navigateur"
              data-testid="preview-open-tab"
            >
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M7 17 17 7M8 7h9v9" />
              </svg>
            </a>
          </div>
        )}
      </div>

      {/* ── Droite ── */}
      <div ref={rightRef} className="preview-tb-right">
        {!gone('slots') && (collaboratorsSlot || githubSlot) && (
          <span ref={slotsRef} className="preview-tb-slots">
            {collaboratorsSlot}
            {githubSlot}
          </span>
        )}
        {showEdit && !gone('edit') && (
          <button
            type="button"
            ref={editRef}
            className="preview-tb-edit"
            data-on={editing ? 'true' : 'false'}
            onClick={() => api?.toggleEditMode()}
            disabled={!api}
            title={editing
              ? "Quitter l'édition visuelle"
              : "Édition visuelle : survole un élément du site, clique, écris la modification"}
            data-testid="preview-edit"
          >
            {editing ? (
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M18 6L6 18M6 6l12 12" />
              </svg>
            ) : (
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M12 20h9" /><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z" />
              </svg>
            )}
            {editing ? 'Exit edit' : 'Edit'}
          </button>
        )}
        {showPublish && (
          <button
            ref={publishRef}
            className="preview-tb-publish"
            onClick={onPublish}
            title="Publish your website"
            data-testid="preview-publish"
          >
            Publish
          </button>
        )}
        <button
          type="button"
          className="preview-tb-icon"
          onClick={onClose}
          disabled={pinned}
          style={pinned ? { opacity: 0.35, cursor: 'default' } : undefined}
          title={pinned ? "Aperçu épinglé — désépingle pour fermer" : "Fermer l'aperçu"}
          aria-label="Fermer l'aperçu"
          data-testid="preview-close"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M18 6L6 18M6 6l12 12" />
          </svg>
        </button>
      </div>
    </div>
  );
}
