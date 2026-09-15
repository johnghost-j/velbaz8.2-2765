"use client";

import { AnimatedCounter } from "./AnimatedCounter";

/* ─────────────────────────────────────────────────────────────────────────
 * STATS VIEW — cartes de statistiques / KPI dans le chat.
 * L'IA émet [STATS_VIEW]{json}[/STATS_VIEW] avec les VRAIES données.
 * Les chiffres utilisent l'ANIMATION rolling-digit (slot-machine) de l'app
 * via <AnimatedCounter/> — même design que partout ailleurs sur le site.
 * ───────────────────────────────────────────────────────────────────────── */

interface Kpi {
  label: string;
  value: number;
  prefix?: string; // ex "€"
  suffix?: string; // ex "%", " ventes"
  decimals?: number;
  delta?: number; // variation en % (positif = hausse)
  hint?: string; // petite note sous la valeur
  color?: string; // couleur d'accent de la valeur
}
export interface StatsViewData {
  title?: string;
  subtitle?: string;
  items: Kpi[];
}

function Arrow({ up }: { up: boolean }) {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
      {up ? <path d="M12 19V5M5 12l7-7 7 7" /> : <path d="M12 5v14M5 12l7 7 7-7" />}
    </svg>
  );
}

export function StatsView({ data }: { data: StatsViewData }) {
  const items = Array.isArray(data.items) ? data.items.filter((k) => k && typeof k.value === "number") : [];
  if (items.length === 0) return null;

  return (
    <div style={{ margin: "8px 0" }}>
      {(data.title || data.subtitle) && (
        <div style={{ marginBottom: 8 }}>
          {data.title && <div style={{ fontSize: 14, fontWeight: 600, color: "var(--text-primary)" }}>{data.title}</div>}
          {data.subtitle && <div style={{ fontSize: 12, color: "var(--text-dim)", marginTop: 2 }}>{data.subtitle}</div>}
        </div>
      )}
      <div style={{ display: "grid", gridTemplateColumns: `repeat(auto-fit, minmax(150px, 1fr))`, gap: 10 }}>
        {items.map((k, i) => {
          const hasDelta = typeof k.delta === "number";
          const up = (k.delta ?? 0) >= 0;
          return (
            <div key={i} style={{ border: "1px solid var(--border-default)", background: "var(--surface-2)", borderRadius: 12, padding: "14px 14px 12px" }}>
              <div style={{ fontSize: 12, color: "var(--text-dim)", marginBottom: 8, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{k.label}</div>
              <div style={{ display: "flex", alignItems: "baseline", gap: 8, flexWrap: "wrap" }}>
                <AnimatedCounter
                  value={k.value}
                  prefix={k.prefix || ""}
                  suffix={k.suffix || ""}
                  decimals={k.decimals ?? (Number.isInteger(k.value) ? 0 : 1)}
                  fontSize={26}
                  style={{ fontWeight: 700, color: k.color || "var(--text-primary)" }}
                />
                {hasDelta && (
                  <span
                    style={{
                      display: "inline-flex", alignItems: "center", gap: 3,
                      fontSize: 11, fontWeight: 600, padding: "2px 6px", borderRadius: 999,
                      color: up ? "#10B981" : "#EF4444",
                      background: up ? "rgba(16,185,129,0.12)" : "rgba(239,68,68,0.12)",
                    }}
                  >
                    <Arrow up={up} />
                    {Math.abs(k.delta as number).toLocaleString("fr-FR", { maximumFractionDigits: 1 })}%
                  </span>
                )}
              </div>
              {k.hint && <div style={{ fontSize: 11, color: "var(--text-dim)", marginTop: 6 }}>{k.hint}</div>}
            </div>
          );
        })}
      </div>
    </div>
  );
}
