// ─── Dashboard du projet (bouton « Dashboard » de la barre du site) ──────────
//
// [2026-09-13] Demande de l'utilisateur : « je veux pas que la barre à droite
// choisisse si c'est Preview ou Code ; je veux que Preview, Code et le reste
// pour le site soient dans le Dashboard (le bouton Dashboard de la barre du
// site en haut, pas celui du chat). »
//
// Le bouton « Dashboard » de PreviewTopBar ouvre donc CE panneau, qui rassemble
// tout ce qui concerne le site :
//
//   ┌──────────────┬──────────────────────────────────────────┐
//   │ Aperçu       │                                          │
//   │ Code         │   contenu de la section choisie          │
//   │ Commandes    │                                          │
//   │ Appareil     │                                          │
//   │ Équipe       │                                          │
//   └──────────────┴──────────────────────────────────────────┘
//
// « Aperçu » n'est pas une section : il RESSORT du dashboard et rend la main à
// l'aperçu du site (c'est l'autre moitié du sélecteur Preview/Dashboard de la
// barre du haut).
//
// La colonne de navigation vit DANS la zone de contenu : ce n'est pas une
// deuxième barre d'outils. La barre du haut (PreviewTopBar) reste la seule
// barre, conformément à sa maquette.
//
// Le contenu de la section active est fourni par l'appelant (`children`) : les
// panneaux lourds (Code, Commandes) ne sont ainsi montés que quand on les
// regarde vraiment.

import type { ReactNode } from 'react';

export type DashSection = 'code' | 'orders' | 'devices' | 'team';

function IconEye() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
      <path d="M2.5 12s3.6-6.5 9.5-6.5S21.5 12 21.5 12s-3.6 6.5-9.5 6.5S2.5 12 2.5 12Z" /><circle cx="12" cy="12" r="2.6" />
    </svg>
  );
}
function IconCode() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="16 18 22 12 16 6" /><polyline points="8 6 2 12 8 18" />
    </svg>
  );
}
function IconBag() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
      <path d="M4.5 8h15l-1.2 11a2 2 0 0 1-2 1.8H7.7a2 2 0 0 1-2-1.8L4.5 8Z" /><path d="M9 8V6a3 3 0 0 1 6 0v2" />
    </svg>
  );
}
function IconDevices() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
      <rect x="2.5" y="4.5" width="12" height="9.5" rx="1.8" /><path d="M6 18h5" /><rect x="16.5" y="9" width="5" height="10.5" rx="1.6" />
    </svg>
  );
}
function IconTeam() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="9" cy="8.5" r="3.2" /><path d="M2.8 19.5a6.4 6.4 0 0 1 12.4 0" /><path d="M16.2 5.9a3.2 3.2 0 0 1 0 5.4M17.6 19.5a6.5 6.5 0 0 0-1.4-4" />
    </svg>
  );
}

export default function ProjectDashboard({
  section,
  onSection,
  onPreview,
  showDevices,
  children,
}: {
  section: DashSection;
  onSection: (s: DashSection) => void;
  /** Ressort du dashboard vers l'aperçu du site. */
  onPreview: () => void;
  /** Bascule Web/Téléphone : seulement pour un projet qui a les deux. */
  showDevices: boolean;
  children: ReactNode;
}) {
  const items: { id: DashSection; label: string; icon: ReactNode }[] = [
    { id: 'code', label: 'Code', icon: <IconCode /> },
    { id: 'orders', label: 'Commandes', icon: <IconBag /> },
    ...(showDevices ? [{ id: 'devices' as DashSection, label: 'Appareil', icon: <IconDevices /> }] : []),
    { id: 'team', label: 'Équipe', icon: <IconTeam /> },
  ];

  return (
    <div className="pdash">
      <nav className="pdash-nav">
        <button type="button" className="pdash-item" onClick={onPreview} title="Revenir à l'aperçu du site">
          <span className="pdash-ico"><IconEye /></span>
          <span>Aperçu</span>
          <svg className="pdash-out" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="9 6 15 12 9 18" />
          </svg>
        </button>
        <div className="pdash-sep" />
        {items.map(it => (
          <button
            key={it.id}
            type="button"
            className="pdash-item"
            data-on={section === it.id}
            onClick={() => onSection(it.id)}
          >
            <span className="pdash-ico">{it.icon}</span>
            <span>{it.label}</span>
          </button>
        ))}
      </nav>
      <div className="pdash-body">{children}</div>
    </div>
  );
}

/** Carte d'une section légère du dashboard (Appareil, Équipe). */
export function DashCard({ title, hint, children }: { title: string; hint?: string; children: ReactNode }) {
  return (
    <div className="pdash-card">
      <div className="pdash-card-title">{title}</div>
      {hint && <div className="pdash-card-hint">{hint}</div>}
      <div style={{ marginTop: 12 }}>{children}</div>
    </div>
  );
}
