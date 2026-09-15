"use client";

/* ─────────────────────────────────────────────────────────────────────────
 * PREDICTION VIEW — carte de prédiction ancrée sur des DONNÉES RÉELLES.
 * L'IA émet [PREDICT:sujet] ; le backend récupère les VRAIES cotes Polymarket
 * (probability en argent réel) + les actus réelles récentes (Google Actu) et
 * injecte un bloc [PREDICTION_VIEW]{json}[/PREDICTION_VIEW]. Ce composant
 * n'invente rien : il n'affiche que ce que le serveur a rempli.
 * ───────────────────────────────────────────────────────────────────────── */

import { motion } from "motion/react";

export interface PredictionOutcome { label: string; probability: number }
export interface PredictionMarket {
  question: string;
  outcomes: PredictionOutcome[];
  volume: number;
  liquidity: number;
  endDate: string | null;
  url: string;
  closed: boolean;
}
export interface PredictionHeadline { title: string; source: string; url: string; publishedAt: number }
export interface PredictionViewData {
  query: string;
  markets: PredictionMarket[];
  headlines: PredictionHeadline[];
  topProbability: number | null;
  topStatement: string | null;
  summary: string;
  hasData: boolean;
  fetchedAt: number;
}

const EASE = [0.16, 1, 0.3, 1] as const;

function pct(x: number): number { return Math.round(x * 100); }
function fmtMoney(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M $`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(0)}k $`;
  return `${Math.round(n)} $`;
}
function fmtDate(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "";
  return d.toLocaleDateString("fr-FR", { day: "numeric", month: "short", year: "numeric" });
}
function timeAgo(ms: number): string {
  if (!ms) return "";
  const diff = Date.now() - ms;
  const h = Math.floor(diff / 3_600_000);
  if (h < 1) return "less than 1 h ago";
  if (h < 24) return `${h} h ago`;
  const d = Math.floor(h / 24);
  return `${d} d ago`;
}

// Couleur d'une probability (rouge faible → vert fort)
function probColor(p: number): string {
  if (p >= 0.6) return "var(--chart-up, #34c28a)";
  if (p <= 0.4) return "var(--chart-down, #d0625f)";
  return "var(--blue-accent, #4ea1ff)";
}

function OutcomeBar({ o, delay }: { o: PredictionOutcome; delay: number }) {
  const p = Math.max(0, Math.min(1, o.probability));
  const col = probColor(p);
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 6 }}>
      <span style={{ fontSize: 12, color: "var(--text-secondary)", minWidth: 78, flexShrink: 0 }}>{o.label}</span>
      <div style={{ position: "relative", flex: 1, height: 10, borderRadius: 999, background: "var(--surface-1)", overflow: "hidden" }}>
        <motion.div
          initial={{ width: 0 }}
          animate={{ width: `${pct(p)}%` }}
          transition={{ duration: 0.7, ease: EASE, delay }}
          style={{ height: "100%", borderRadius: 999, background: col }}
        />
      </div>
      <span style={{ fontSize: 12.5, fontWeight: 700, color: col, minWidth: 40, textAlign: "right", flexShrink: 0 }}>{pct(p)}%</span>
    </div>
  );
}

export default function PredictionView({ data }: { data: PredictionViewData }) {
  const { query, markets = [], headlines = [], topProbability, summary } = data;
  const hasMarkets = markets.length > 0;

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, ease: EASE }}
      style={{
        margin: "12px 0",
        borderRadius: 16,
        border: "1px solid var(--border-subtle)",
        background: "var(--surface-2)",
        overflow: "hidden",
      }}
    >
      {/* En-tête */}
      <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "12px 14px", borderBottom: "1px solid var(--border-subtle)" }}>
        <div style={{ width: 26, height: 26, borderRadius: 8, background: "var(--surface-1)", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
          <svg width="15" height="15" viewBox="0 0 20 20" fill="none">
            <path d="M3 14l4-5 3 3 4-6" stroke="var(--text-secondary)" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
            <circle cx="17" cy="5" r="1.6" fill="var(--text-secondary)" />
          </svg>
        </div>
        <div style={{ minWidth: 0, flex: 1 }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: "var(--text-secondary)", lineHeight: 1.3 }}>Prediction — {query}</div>
          <div style={{ fontSize: 10.5, color: "var(--text-dim)" }}>Polymarket odds (real money) + news · {timeAgo(data.fetchedAt)}</div>
        </div>
        {topProbability != null && (
          <div style={{ textAlign: "right", flexShrink: 0 }}>
            <div style={{ fontSize: 20, fontWeight: 800, color: probColor(topProbability), lineHeight: 1 }}>{pct(topProbability)}%</div>
            <div style={{ fontSize: 9.5, color: "var(--text-dim)" }}>probability</div>
          </div>
        )}
      </div>

      {/* Synthèse */}
      {summary && (
        <div style={{ padding: "10px 14px", fontSize: 12, color: "var(--text-dim)", lineHeight: 1.5, borderBottom: hasMarkets || headlines.length ? "1px solid var(--border-subtle)" : "none" }}>
          {summary}
        </div>
      )}

      {/* Marchés Polymarket réels */}
      {hasMarkets && (
        <div style={{ padding: "12px 14px", display: "flex", flexDirection: "column", gap: 14 }}>
          {markets.slice(0, 6).map((m, i) => (
            <a key={i} href={m.url} target="_blank" rel="noopener noreferrer"
              style={{ display: "block", textDecoration: "none", padding: "10px 12px", borderRadius: 12, background: "var(--surface-1)", border: "1px solid var(--border-subtle)" }}>
              <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 8 }}>
                <span style={{ fontSize: 12.5, fontWeight: 600, color: "var(--text-secondary)", lineHeight: 1.35 }}>{m.question}</span>
                <span style={{ fontSize: 10, color: "var(--text-dim)", flexShrink: 0, whiteSpace: "nowrap" }}>{fmtMoney(m.volume)}</span>
              </div>
              {m.outcomes.slice(0, 4).map((o, j) => <OutcomeBar key={j} o={o} delay={0.1 + j * 0.05} />)}
              {m.endDate && <div style={{ fontSize: 10, color: "var(--text-dim)", marginTop: 8 }}>Expiry: {fmtDate(m.endDate)}</div>}
            </a>
          ))}
        </div>
      )}

      {/* Actus réelles récentes */}
      {headlines.length > 0 && (
        <div style={{ padding: "12px 14px", borderTop: hasMarkets ? "1px solid var(--border-subtle)" : "none" }}>
          <div style={{ fontSize: 10.5, fontWeight: 700, color: "var(--text-dim)", textTransform: "uppercase", letterSpacing: 0.4, marginBottom: 8 }}>Recent news</div>
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {headlines.slice(0, 6).map((h, i) => (
              <a key={i} href={h.url} target="_blank" rel="noopener noreferrer"
                style={{ display: "flex", gap: 8, textDecoration: "none", alignItems: "baseline" }}>
                <span style={{ width: 5, height: 5, borderRadius: 999, background: "var(--blue-accent, #4ea1ff)", flexShrink: 0, transform: "translateY(-2px)" }} />
                <span style={{ minWidth: 0, flex: 1 }}>
                  <span style={{ fontSize: 12, color: "var(--text-secondary)", lineHeight: 1.4 }}>{h.title}</span>
                  <span style={{ fontSize: 10, color: "var(--text-dim)", marginLeft: 6 }}>· {h.source}{h.publishedAt ? ` · ${timeAgo(h.publishedAt)}` : ""}</span>
                </span>
              </a>
            ))}
          </div>
        </div>
      )}

      {/* Disclaimer */}
      <div style={{ padding: "8px 14px 10px", fontSize: 10, color: "var(--text-dim)", borderTop: "1px solid var(--border-subtle)", fontStyle: "italic" }}>
        A prediction remains uncertain — odds reflect the market at a given moment, not a guarantee.
      </div>
    </motion.div>
  );
}
