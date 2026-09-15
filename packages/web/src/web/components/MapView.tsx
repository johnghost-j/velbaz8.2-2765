"use client";

import { useMemo } from "react";

/* ─────────────────────────────────────────────────────────────────────────
 * MAP VIEW — carte / localisation affichée dans le chat.
 * [MAP_VIEW]{json}[/MAP_VIEW] :
 * { "title":"Boutique — Bruxelles", "address":"Rue Neuve 12, 1000 Bruxelles",
 *   "lat":50.85, "lng":4.35, "zoom":14,
 *   "markers":[{"lat":50.85,"lng":4.35,"label":"Magasin"}] }
 *
 * Self-contained : iframe OpenStreetMap (aucune clé API), overlay à la charte,
 * lien "Open dans Maps". Si pas de lat/lng mais une adresse → géo via la
 * recherche OSM embarquée (embed q=adresse).
 * ───────────────────────────────────────────────────────────────────────── */

interface Marker { lat: number; lng: number; label?: string }
export interface MapViewData {
  title?: string;
  subtitle?: string;
  address?: string;
  lat?: number;
  lng?: number;
  zoom?: number;
  markers?: Marker[];
}

const IconPin = () => (
  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z" />
    <circle cx="12" cy="10" r="3" />
  </svg>
);
const IconExternal = () => (
  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6M15 3h6v6M10 14L21 3" />
  </svg>
);

export function MapView({ data }: { data: MapViewData }) {
  const hasCoords = typeof data.lat === "number" && typeof data.lng === "number";
  const zoom = data.zoom ?? 14;

  const { embedSrc, externalHref } = useMemo(() => {
    if (hasCoords) {
      const lat = data.lat as number, lng = data.lng as number;
      const d = 0.02 / Math.max(1, zoom / 12);
      const bbox = `${lng - d}%2C${lat - d}%2C${lng + d}%2C${lat + d}`;
      return {
        embedSrc: `https://www.openstreetmap.org/export/embed.html?bbox=${bbox}&layer=mapnik&marker=${lat}%2C${lng}`,
        externalHref: `https://www.openstreetmap.org/?mlat=${lat}&mlon=${lng}#map=${zoom}/${lat}/${lng}`,
      };
    }
    const q = encodeURIComponent(data.address || data.title || "");
    return {
      embedSrc: `https://www.openstreetmap.org/export/embed.html?layer=mapnik&query=${q}`,
      externalHref: `https://www.openstreetmap.org/search?query=${q}`,
    };
  }, [data.address, data.title, data.lat, data.lng, zoom, hasCoords]);

  return (
    <div
      style={{
        border: "1px solid var(--border-default)",
        background: "var(--surface-2)",
        borderRadius: 16,
        overflow: "hidden",
        margin: "8px 0",
        maxWidth: 520,
      }}
    >
      {(data.title || data.address) && (
        <div style={{ display: "flex", alignItems: "flex-start", gap: 10, padding: "12px 14px" }}>
          <span style={{ color: "var(--accent)", flexShrink: 0, marginTop: 2 }}><IconPin /></span>
          <div style={{ flex: 1, minWidth: 0 }}>
            {data.title && <div style={{ fontSize: 14, fontWeight: 600, color: "var(--text-primary)" }}>{data.title}</div>}
            {(data.subtitle || data.address) && (
              <div style={{ fontSize: 12, color: "var(--text-dim)", marginTop: 1 }}>{data.subtitle || data.address}</div>
            )}
          </div>
          <a
            href={externalHref}
            target="_blank"
            rel="noopener noreferrer"
            style={{
              flexShrink: 0, display: "inline-flex", alignItems: "center", gap: 5,
              padding: "5px 10px", borderRadius: 999,
              border: "1px solid var(--border-default)", background: "transparent",
              color: "var(--text-secondary)", textDecoration: "none", fontSize: 12, fontWeight: 500,
            }}
          >
            <IconExternal /> Open
          </a>
        </div>
      )}
      <div style={{ position: "relative", width: "100%", height: 260, background: "var(--surface-3)" }}>
        <iframe
          title={data.title || "map"}
          src={embedSrc}
          loading="lazy"
          referrerPolicy="no-referrer-when-downgrade"
          style={{ width: "100%", height: "100%", border: 0, display: "block" }}
        />
      </div>
    </div>
  );
}

export default MapView;
