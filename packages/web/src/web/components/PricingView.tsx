"use client";

/* ─────────────────────────────────────────────────────────────────────────
 * PRICING VIEW — comparaison côte à côte / grille tarifaire dans le chat.
 * L'IA émet [PRICING_VIEW]{json}[/PRICING_VIEW] avec les VRAIES options.
 * Colonnes = plans/options comparés, lignes de features avec ✓/✗ ou valeur.
 * ───────────────────────────────────────────────────────────────────────── */

interface Plan {
  name: string;
  price?: string; // ex "29 €"
  period?: string; // ex "/mois"
  description?: string;
  highlight?: boolean; // plan mis en avant
  badge?: string; // ex "Populaire"
  cta?: string; // libellé bouton (décoratif)
  features?: (string | boolean)[]; // aligné sur data.features
  accent?: string;
}
export interface PricingViewData {
  title?: string;
  subtitle?: string;
  features?: string[]; // libellés des lignes comparées
  plans: Plan[];
}

function Val({ v, accent }: { v: string | boolean; accent: string }) {
  if (v === true)
    return <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke={accent} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12l5 5L20 7" /></svg>;
  if (v === false || v === "" || v == null)
    return <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--text-dim)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ opacity: 0.5 }}><path d="M6 6l12 12M18 6L6 18" /></svg>;
  return <span style={{ fontSize: 12.5, color: "var(--text-primary)", fontWeight: 500 }}>{String(v)}</span>;
}

export function PricingView({ data }: { data: PricingViewData }) {
  const plans = Array.isArray(data.plans) ? data.plans.filter((p) => p && p.name) : [];
  if (plans.length === 0) return null;
  const features = Array.isArray(data.features) ? data.features : [];
  const defAccent = "#6366F1";

  return (
    <div style={{ margin: "8px 0" }}>
      {(data.title || data.subtitle) && (
        <div style={{ marginBottom: 10 }}>
          {data.title && <div style={{ fontSize: 15, fontWeight: 700, color: "var(--text-primary)" }}>{data.title}</div>}
          {data.subtitle && <div style={{ fontSize: 12.5, color: "var(--text-dim)", marginTop: 2 }}>{data.subtitle}</div>}
        </div>
      )}
      <div style={{ display: "grid", gridTemplateColumns: `repeat(auto-fit, minmax(190px, 1fr))`, gap: 12 }}>
        {plans.map((p, i) => {
          const accent = p.accent || defAccent;
          const hl = p.highlight;
          return (
            <div
              key={i}
              style={{
                position: "relative",
                border: hl ? `1.5px solid ${accent}` : "1px solid var(--border-default)",
                background: hl ? `${accent}0d` : "var(--surface-2)",
                borderRadius: 14, padding: "18px 16px 16px",
                display: "flex", flexDirection: "column", gap: 4,
                boxShadow: hl ? `0 8px 30px ${accent}22` : "none",
              }}
            >
              {(p.badge || hl) && (
                <span style={{ position: "absolute", top: -10, left: 16, fontSize: 10.5, fontWeight: 700, color: "#fff", background: accent, padding: "3px 10px", borderRadius: 999 }}>
                  {p.badge || "Recommended"}
                </span>
              )}
              <div style={{ fontSize: 14, fontWeight: 700, color: "var(--text-primary)" }}>{p.name}</div>
              {p.description && <div style={{ fontSize: 11.5, color: "var(--text-dim)", lineHeight: 1.4 }}>{p.description}</div>}
              {p.price && (
                <div style={{ display: "flex", alignItems: "baseline", gap: 3, marginTop: 6 }}>
                  <span style={{ fontSize: 26, fontWeight: 800, color: hl ? accent : "var(--text-primary)" }}>{p.price}</span>
                  {p.period && <span style={{ fontSize: 12, color: "var(--text-dim)" }}>{p.period}</span>}
                </div>
              )}

              {features.length > 0 && (
                <div style={{ marginTop: 10, display: "flex", flexDirection: "column", gap: 8, borderTop: "1px solid var(--border-default)", paddingTop: 12 }}>
                  {features.map((f, j) => (
                    <div key={j} style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      <span style={{ flexShrink: 0, width: 16, display: "inline-flex", justifyContent: "center" }}>
                        <Val v={p.features?.[j] ?? false} accent={accent} />
                      </span>
                      <span style={{ fontSize: 12, color: "var(--text-secondary, var(--text-dim))" }}>{f}</span>
                    </div>
                  ))}
                </div>
              )}

              {p.cta && (
                <div
                  style={{
                    marginTop: 14, textAlign: "center", fontSize: 12.5, fontWeight: 600, padding: "9px 12px", borderRadius: 9,
                    color: hl ? "#fff" : accent,
                    background: hl ? accent : `${accent}18`,
                  }}
                >
                  {p.cta}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
