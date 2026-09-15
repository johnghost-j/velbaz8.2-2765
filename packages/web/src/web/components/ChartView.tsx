"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { motion, useSpring, useTransform, type MotionValue } from "motion/react";

/* ─────────────────────────────────────────────────────────────────────────
 * CHART VIEW — graphiques que l'IA peut afficher dans le chat.
 * L'IA émet [CHART_VIEW]{json}[/CHART_VIEW] avec les VRAIES données.
 * Self-contained : SVG pur + motion/react, aucune lib de charts externe.
 *
 * Variants :
 *  - "bar"    : barres verticales
 *  - "line"   : courbe lissée
 *  - "area"   : courbe + aire dégradée (style ClippedAreaChart)
 *  - "pie"    : camembert
 *  - "donut"  : anneau (avec total au centre)
 *  - "gauge"  : jauge (demi-cercle) avec valeur animée
 * ───────────────────────────────────────────────────────────────────────── */

interface Point {
  label: string;
  value: number;
  color?: string;
}
export interface ChartViewData {
  variant?: "bar" | "line" | "area" | "pie" | "donut" | "gauge";
  title?: string;
  subtitle?: string;
  unit?: string; // ex "€", "%", "ventes"
  points: Point[];
  // gauge only
  min?: number;
  max?: number;
  color?: string; // couleur d'accent globale
}

const PALETTE = [
  "#6366F1", "#10B981", "#F59E0B", "#EC4899",
  "#3B82F6", "#8B5CF6", "#EF4444", "#14B8A6",
  "#F97316", "#0EA5E9",
];

function fmt(n: number, unit?: string) {
  const s = Number.isInteger(n) ? n.toLocaleString("fr-FR") : n.toLocaleString("fr-FR", { maximumFractionDigits: 1 });
  if (!unit) return s;
  if (unit === "%" || unit === "€" || unit === "$") return unit === "€" || unit === "$" ? `${s} ${unit}` : `${s}${unit}`;
  return `${s} ${unit}`;
}

/* ─── Shell ─── */
function Shell({ title, subtitle, children }: { title?: string; subtitle?: string; children: React.ReactNode }) {
  return (
    <div
      style={{
        border: "1px solid var(--border-default)",
        background: "var(--surface-2)",
        borderRadius: 12,
        overflow: "hidden",
        margin: "8px 0",
      }}
    >
      {(title || subtitle) && (
        <div style={{ padding: "12px 14px 4px" }}>
          {title && <div style={{ fontSize: 14, fontWeight: 600, color: "var(--text-primary)" }}>{title}</div>}
          {subtitle && <div style={{ fontSize: 12, color: "var(--text-dim)", marginTop: 2 }}>{subtitle}</div>}
        </div>
      )}
      <div style={{ padding: "10px 14px 14px" }}>{children}</div>
    </div>
  );
}

/* ─── Legend ─── */
function Legend({ points, colors, unit }: { points: Point[]; colors: string[]; unit?: string }) {
  return (
    <div style={{ display: "flex", flexWrap: "wrap", gap: "6px 14px", marginTop: 12 }}>
      {points.map((p, i) => (
        <div key={i} style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, color: "var(--text-secondary, var(--text-dim))" }}>
          <span style={{ width: 9, height: 9, borderRadius: 3, background: colors[i], flexShrink: 0 }} />
          <span style={{ color: "var(--text-primary)" }}>{p.label}</span>
          <span style={{ color: "var(--text-dim)" }}>{fmt(p.value, unit)}</span>
        </div>
      ))}
    </div>
  );
}

/* ─── BAR ─── */
function BarChart({ points, unit }: { points: Point[]; unit?: string }) {
  const max = Math.max(...points.map((p) => p.value), 1);
  const colors = points.map((p, i) => p.color || PALETTE[i % PALETTE.length]);
  return (
    <div>
      <div style={{ display: "flex", alignItems: "flex-end", gap: 10, height: 160, paddingTop: 8 }}>
        {points.map((p, i) => {
          const h = Math.max((p.value / max) * 100, 1.5);
          return (
            <div key={i} style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", height: "100%", justifyContent: "flex-end", minWidth: 0 }}>
              <div style={{ fontSize: 11, fontWeight: 600, color: "var(--text-primary)", marginBottom: 4 }}>{fmt(p.value, unit)}</div>
              <motion.div
                initial={{ height: 0 }}
                animate={{ height: `${h}%` }}
                transition={{ duration: 0.7, delay: i * 0.06, ease: [0.22, 1, 0.36, 1] }}
                style={{ width: "100%", maxWidth: 46, background: colors[i], borderRadius: "6px 6px 0 0" }}
              />
            </div>
          );
        })}
      </div>
      <div style={{ display: "flex", gap: 10, marginTop: 6 }}>
        {points.map((p, i) => (
          <div key={i} style={{ flex: 1, textAlign: "center", fontSize: 11, color: "var(--text-dim)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{p.label}</div>
        ))}
      </div>
    </div>
  );
}

/* ─── LINE / AREA ─── */
function LineChart({ points, unit, area, color }: { points: Point[]; unit?: string; area?: boolean; color?: string }) {
  const W = 520, H = 180, PAD = 10;
  const accent = color || PALETTE[0];
  const vals = points.map((p) => p.value);
  const max = Math.max(...vals, 1);
  const min = Math.min(...vals, 0);
  const range = max - min || 1;
  const n = points.length;
  const xs = (i: number) => (n === 1 ? W / 2 : PAD + (i * (W - 2 * PAD)) / (n - 1));
  const ys = (v: number) => H - PAD - ((v - min) / range) * (H - 2 * PAD);

  // Smooth cubic path
  const coords = points.map((p, i) => [xs(i), ys(p.value)] as [number, number]);
  let d = "";
  coords.forEach(([x, y], i) => {
    if (i === 0) { d += `M ${x} ${y}`; return; }
    const [px, py] = coords[i - 1];
    const cx = (px + x) / 2;
    d += ` C ${cx} ${py}, ${cx} ${y}, ${x} ${y}`;
  });
  const areaD = `${d} L ${xs(n - 1)} ${H - PAD} L ${xs(0)} ${H - PAD} Z`;
  const gid = useMemo(() => `cg-${Math.random().toString(36).slice(2)}`, []);

  return (
    <div>
      <svg viewBox={`0 0 ${W} ${H}`} style={{ width: "100%", height: "auto", display: "block" }}>
        <defs>
          <linearGradient id={gid} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={accent} stopOpacity="0.35" />
            <stop offset="100%" stopColor={accent} stopOpacity="0" />
          </linearGradient>
        </defs>
        {[0.25, 0.5, 0.75].map((f) => (
          <line key={f} x1={PAD} x2={W - PAD} y1={PAD + f * (H - 2 * PAD)} y2={PAD + f * (H - 2 * PAD)} stroke="var(--border-default)" strokeWidth="1" opacity="0.4" />
        ))}
        {area && <motion.path d={areaD} fill={`url(#${gid})`} initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.8, delay: 0.3 }} />}
        <motion.path d={d} fill="none" stroke={accent} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"
          initial={{ pathLength: 0 }} animate={{ pathLength: 1 }} transition={{ duration: 1, ease: "easeInOut" }} />
        {coords.map(([x, y], i) => (
          <motion.circle key={i} cx={x} cy={y} r="3.5" fill="var(--surface-2)" stroke={accent} strokeWidth="2"
            initial={{ scale: 0 }} animate={{ scale: 1 }} transition={{ delay: 0.6 + i * 0.05 }} />
        ))}
      </svg>
      <div style={{ display: "flex", justifyContent: "space-between", marginTop: 4 }}>
        {points.map((p, i) => (
          <div key={i} style={{ fontSize: 11, color: "var(--text-dim)", flex: 1, textAlign: n === 1 ? "center" : i === 0 ? "left" : i === n - 1 ? "right" : "center" }}>{p.label}</div>
        ))}
      </div>
    </div>
  );
}

/* ─── PIE / DONUT ─── */
function PieChart({ points, unit, donut }: { points: Point[]; unit?: string; donut?: boolean }) {
  const total = points.reduce((s, p) => s + p.value, 0) || 1;
  const colors = points.map((p, i) => p.color || PALETTE[i % PALETTE.length]);
  const R = 70, C = 90, sw = donut ? 26 : R;
  const rr = donut ? R - sw / 2 : R;
  const circ = 2 * Math.PI * rr;
  let acc = 0;
  const segs = points.map((p, i) => {
    const frac = p.value / total;
    const seg = { color: colors[i], dash: frac * circ, offset: -acc * circ, frac };
    acc += frac;
    return seg;
  });
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 18, flexWrap: "wrap" }}>
      <svg viewBox="0 0 180 180" style={{ width: 150, height: 150, flexShrink: 0 }}>
        <g transform="rotate(-90 90 90)">
          {donut ? (
            segs.map((s, i) => (
              <motion.circle key={i} cx={C} cy={C} r={rr} fill="none" stroke={s.color} strokeWidth={sw}
                strokeDasharray={`${s.dash} ${circ}`}
                initial={{ strokeDashoffset: circ }} animate={{ strokeDashoffset: s.offset }}
                transition={{ duration: 0.9, delay: i * 0.08, ease: [0.22, 1, 0.36, 1] }} />
            ))
          ) : (
            segs.map((s, i) => (
              <motion.circle key={i} cx={C} cy={C} r={rr / 2} fill="none" stroke={s.color} strokeWidth={rr}
                strokeDasharray={`${(s.frac) * Math.PI * rr} ${Math.PI * rr}`}
                initial={{ strokeDashoffset: Math.PI * rr }} animate={{ strokeDashoffset: -segs.slice(0, i).reduce((a, x) => a + x.frac, 0) * Math.PI * rr }}
                transition={{ duration: 0.9, delay: i * 0.08 }} />
            ))
          )}
        </g>
        {donut && (
          <text x="90" y="90" textAnchor="middle" dominantBaseline="central" fill="var(--text-primary)" fontSize="20" fontWeight="700">
            {fmt(total, unit)}
          </text>
        )}
      </svg>
      <div style={{ flex: 1, minWidth: 140 }}>
        <Legend points={points} colors={colors} unit={unit} />
      </div>
    </div>
  );
}

/* ─── GAUGE ─── */
function GaugeNumber({ mv, decimals }: { mv: MotionValue<number>; decimals: number }) {
  const [txt, setTxt] = useState("0");
  useEffect(() => mv.on("change", (v) => setTxt(v.toLocaleString("fr-FR", { maximumFractionDigits: decimals, minimumFractionDigits: decimals }))), [mv, decimals]);
  return <>{txt}</>;
}
function GaugeChart({ points, unit, min = 0, max = 100, color }: { points: Point[]; unit?: string; min?: number; max?: number; color?: string }) {
  const value = points[0]?.value ?? 0;
  const accent = color || points[0]?.color || PALETTE[1];
  const pct = Math.max(0, Math.min(1, (value - min) / (max - min || 1)));
  const R = 80, sw = 16, cx = 100, cy = 100;
  const circ = Math.PI * R; // half circle
  const spring = useSpring(0, { stiffness: 90, damping: 20 });
  const dash = useTransform(spring, (v) => `${v * circ} ${2 * Math.PI * R}`);
  const numMv = useTransform(spring, (v) => min + v * (max - min));
  const ref = useRef(false);
  useEffect(() => { if (!ref.current) { ref.current = true; spring.set(pct); } }, [pct, spring]);
  const decimals = Number.isInteger(value) ? 0 : 1;
  return (
    <div style={{ display: "flex", justifyContent: "center" }}>
      <svg viewBox="0 10 200 110" style={{ width: 220, maxWidth: "100%" }}>
        <g transform="rotate(180 100 100)">
          <path d={`M ${cx - R} ${cy} A ${R} ${R} 0 0 1 ${cx + R} ${cy}`} fill="none" stroke="var(--surface-4, var(--border-default))" strokeWidth={sw} strokeLinecap="round" />
          <motion.circle cx={cx} cy={cy} r={R} fill="none" stroke={accent} strokeWidth={sw} strokeLinecap="round"
            strokeDasharray={dash as any} transform={`rotate(0 ${cx} ${cy})`} style={{ transformOrigin: `${cx}px ${cy}px` }} />
        </g>
        <text x="100" y="92" textAnchor="middle" fill="var(--text-primary)" fontSize="30" fontWeight="700">
          <GaugeNumber mv={numMv} decimals={decimals} />{unit === "%" ? "%" : ""}
        </text>
        {points[0]?.label && <text x="100" y="112" textAnchor="middle" fill="var(--text-dim)" fontSize="12">{points[0].label}</text>}
      </svg>
    </div>
  );
}

/* ─── Router ─── */
export function ChartView({ data }: { data: ChartViewData }) {
  const variant = data.variant || "bar";
  const points = Array.isArray(data.points) ? data.points.filter((p) => p && typeof p.value === "number") : [];
  if (points.length === 0 && variant !== "gauge") return null;

  let body: React.ReactNode = null;
  if (variant === "bar") body = <BarChart points={points} unit={data.unit} />;
  else if (variant === "line") body = <LineChart points={points} unit={data.unit} color={data.color} />;
  else if (variant === "area") body = <LineChart points={points} unit={data.unit} area color={data.color} />;
  else if (variant === "pie") body = <PieChart points={points} unit={data.unit} />;
  else if (variant === "donut") body = <PieChart points={points} unit={data.unit} donut />;
  else if (variant === "gauge") body = <GaugeChart points={points} unit={data.unit} min={data.min} max={data.max} color={data.color} />;

  return <Shell title={data.title} subtitle={data.subtitle}>{body}</Shell>;
}
