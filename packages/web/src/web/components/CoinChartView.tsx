"use client";

/* ─────────────────────────────────────────────────────────────────────────
 * COIN CHART VIEW — graphique chandelier crypto avec de VRAIES données.
 * L'IA émet [COIN_CHART:SYMBOL:INTERVAL] ; le backend l'intercepte, récupère
 * les bougies réelles (Binance/CoinGecko) + indicateurs, et injecte un bloc
 * [COIN_CHART_VIEW]{json}[/COIN_CHART_VIEW]. Ce composant ne fabrique JAMAIS
 * de données : il n'affiche que ce que le serveur a rempli.
 * Design adapté du composant chandelier « CandleChart » (SVG pur + motion/react).
 * ───────────────────────────────────────────────────────────────────────── */

import { useMemo, useRef, useState, useEffect } from "react";
import { motion, useReducedMotion } from "motion/react";

const UP = "var(--chart-up, #34c28a)";
const DOWN = "var(--chart-down, #d0625f)";
const EASE = [0.16, 1, 0.3, 1] as const;

export interface CoinCandle { o: number; h: number; l: number; c: number; v: number; t: number }
export interface CoinIndicators {
  trend?: "bullish" | "bearish" | "neutral";
  rsi14?: number | null;
  macd?: { macd: number; signal: number; histogram: number } | null;
  sma20?: number | null;
  sma50?: number | null;
  sma200?: number | null;
  ema20?: number | null;
  bollinger?: { upper: number; middle: number; lower: number } | null;
  support?: number | null;
  resistance?: number | null;
}
export interface CoinQuote {
  symbol?: string; price?: number; changePct24h?: number;
  high24h?: number; low24h?: number; volume24h?: number; source?: string;
}
export interface CoinNewsItem { title: string; source: string; url: string; publishedAt?: number; snippet?: string }
export interface CoinNewsBundle {
  symbol: string;
  coinLabel?: string;
  sentiment: "bullish" | "bearish" | "neutral";
  score: number;           // -100 … +100
  confidence?: string;
  summary?: string;
  catalysts?: string[];
  items?: CoinNewsItem[];
  macro?: CoinNewsItem[];
  fetchedAt?: number;
}
export interface CoinChartViewData {
  symbol: string;          // "BTC/USDT"
  interval?: string;       // "1d"
  candles: CoinCandle[];
  indicators?: CoinIndicators;
  quote?: CoinQuote | null;
  source?: string;         // "binance" | "coingecko"
  news?: CoinNewsBundle | null;
}

const VB_W = 560;
const VB_H = 300;
const AXIS_W = 52;
const VOL_H = 46;
const GAP = 8;
const PLOT_H = VB_H - VOL_H - GAP;

const TIMEFRAMES: Array<{ label: string; interval: string }> = [
  { label: "1H", interval: "1h" },
  { label: "4H", interval: "4h" },
  { label: "1D", interval: "1d" },
  { label: "1W", interval: "1w" },
];

const SANS = "inherit";

function fmtPrice(v: number): string {
  if (!isFinite(v)) return "—";
  const abs = Math.abs(v);
  const dp = abs >= 1000 ? 2 : abs >= 1 ? 2 : abs >= 0.01 ? 4 : 8;
  return v.toLocaleString("en-US", { minimumFractionDigits: dp, maximumFractionDigits: dp });
}
function fmtCompact(v: number): string {
  if (!isFinite(v) || v === 0) return "—";
  if (v >= 1e9) return (v / 1e9).toFixed(2) + "B";
  if (v >= 1e6) return (v / 1e6).toFixed(2) + "M";
  if (v >= 1e3) return (v / 1e3).toFixed(1) + "K";
  return v.toFixed(0);
}
function fmtStamp(t: number, interval: string): string {
  const d = new Date(t);
  const opts: Intl.DateTimeFormatOptions = interval === "1h" || interval === "4h"
    ? { month: "short", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false }
    : { year: "2-digit", month: "short", day: "2-digit" };
  return d.toLocaleString("en-GB", opts).replace(",", "");
}
function fmtDay(t: number, interval: string): string {
  const d = new Date(t);
  return interval === "1h" || interval === "4h"
    ? d.toLocaleString("en-GB", { day: "2-digit", hour: "2-digit", hour12: false }).replace(",", "")
    : d.toLocaleDateString("en-GB", { day: "2-digit", month: "short" });
}

export default function CoinChartView({ data }: { data: CoinChartViewData }) {
  const reduced = useReducedMotion();
  const [live, setLive] = useState<CoinChartViewData>(data);
  const [interval, setIntervalState] = useState<string>(data.interval || "1d");
  const [loading, setLoading] = useState(false);
  const [hover, setHover] = useState<number | null>(null);
  const svgRef = useRef<SVGSVGElement>(null);

  useEffect(() => { setLive(data); setIntervalState(data.interval || "1d"); }, [data]);

  const candles = live.candles || [];
  const n = candles.length;

  // Échelle prix dynamique (min/max réels + marge)
  const { min, max, maxVolume } = useMemo(() => {
    if (!n) return { min: 0, max: 1, maxVolume: 1 };
    let lo = Infinity, hi = -Infinity, mv = 0;
    for (const k of candles) { if (k.l < lo) lo = k.l; if (k.h > hi) hi = k.h; if (k.v > mv) mv = k.v; }
    const pad = (hi - lo) * 0.08 || hi * 0.02;
    return { min: Math.max(0, lo - pad), max: hi + pad, maxVolume: mv || 1 };
  }, [candles, n]);

  const plotW = VB_W - AXIS_W;
  const slot = n ? plotW / n : plotW;
  const bodyW = Math.max(1.5, slot * 0.6);
  const xMid = (i: number) => i * slot + slot / 2;
  const range = max - min || 1;
  const yPrice = (v: number) => (1 - (v - min) / range) * PLOT_H;

  const ind = live.indicators || {};
  const q = live.quote || null;
  const news = live.news || null;
  const last = candles[n - 1];
  const active = candles[hover ?? n - 1] || last;

  const changePct = q?.changePct24h ?? (last ? ((last.c - candles[0].c) / candles[0].c) * 100 : 0);
  const up24 = (changePct ?? 0) >= 0;

  const ticks = useMemo(() => {
    const out: number[] = [];
    for (let i = 0; i <= 4; i++) out.push(min + (range * i) / 4);
    return out.reverse();
  }, [min, range]);

  const dateLabels = useMemo(
    () => (n ? Array.from({ length: 6 }, (_, i) => candles[Math.min(n - 1, Math.floor((i * n) / 6))]) : []),
    [candles, n]
  );

  const onMove = (e: React.PointerEvent) => {
    const el = svgRef.current; if (!el || !n) return;
    const r = el.getBoundingClientRect();
    const px = ((e.clientX - r.left) / r.width) * VB_W;
    setHover(Math.max(0, Math.min(n - 1, Math.floor(px / slot))));
  };

  async function switchInterval(iv: string) {
    if (iv === interval || loading) return;
    setIntervalState(iv);
    setLoading(true);
    try {
      const res = await fetch(`/api/crypto/ohlc?symbol=${encodeURIComponent(live.symbol)}&interval=${iv}&limit=120`);
      if (res.ok) {
        const fresh = await res.json();
        if (fresh && Array.isArray(fresh.candles) && fresh.candles.length) setLive({ ...fresh, symbol: live.symbol });
      }
    } catch { /* garde les données actuelles */ }
    finally { setLoading(false); }
  }

  const chgActive = active ? active.c - active.o : 0;
  const upActive = chgActive >= 0;
  const legend: Array<[string, string, string?]> = active ? [
    ["Open", fmtPrice(active.o)],
    ["High", fmtPrice(active.h)],
    ["Low", fmtPrice(active.l)],
    ["Close", fmtPrice(active.c)],
    ["Chg", `${upActive ? "+" : "−"}${Math.abs((chgActive / (active.o || 1)) * 100).toFixed(2)}%`, upActive ? UP : DOWN],
  ] : [];

  const tipLeft = hover !== null && hover > n / 2;
  const trendColor = ind.trend === "bullish" ? UP : ind.trend === "bearish" ? DOWN : "var(--foreground)";
  const trendLabel = ind.trend === "bullish" ? "Bullish" : ind.trend === "bearish" ? "Bearish" : "Neutral";

  // Lignes de moyennes mobiles (path SVG)
  const maPath = (period: 20 | 50 | 200): string | null => {
    const key = `sma${period}` as const;
    const val = (ind as any)[key];
    if (val == null || !n) return null;
    // On approxime la MA courante en ligne horizontale au dernier niveau connu
    return null; // (lignes MA rendues via niveaux ponctuels ci-dessous pour rester lisibles)
  };

  return (
    <div className="my-3 w-full max-w-[620px] rounded-2xl border border-foreground/[0.06] p-4"
      style={{ background: "var(--card)" }}>
      {/* header */}
      <div className="flex items-end justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <span className="text-[11px] font-semibold uppercase tracking-[0.1em] text-foreground/70">{live.symbol}</span>
            {ind.trend && (
              <span className="rounded-full px-2 py-0.5 text-[9px] font-semibold uppercase tracking-wide"
                style={{ color: trendColor, background: `color-mix(in srgb, ${trendColor} 12%, transparent)` }}>
                {trendLabel}
              </span>
            )}
            <span className="text-[9px] uppercase tracking-[0.1em] text-foreground/25">· {live.source || "market"}</span>
          </div>
          <div className="mt-1.5 flex items-baseline gap-2">
            <span className="tabular-nums text-foreground/90" style={{ fontSize: 24, lineHeight: 1 }}>
              ${fmtPrice(q?.price ?? last?.c ?? 0)}
            </span>
            <span className="tabular-nums text-[12px]" style={{ color: up24 ? UP : DOWN }}>
              {up24 ? "+" : "−"}{Math.abs(changePct ?? 0).toFixed(2)}%
            </span>
          </div>
        </div>
        <div className="flex items-center gap-0.5 rounded-full border border-foreground/[0.06] p-0.5">
          {TIMEFRAMES.map((tf) => {
            const on = tf.interval === interval;
            return (
              <button key={tf.interval} type="button" aria-pressed={on} onClick={() => switchInterval(tf.interval)}
                className={`relative rounded-full px-2.5 py-1 text-[10px] tracking-[0.06em] transition-colors duration-200 ${on ? "text-foreground" : "text-foreground/40 hover:text-foreground/70"}`}>
                {on && (
                  <motion.span layoutId={`coin-tf-${live.symbol}`} className="absolute inset-0 rounded-full bg-foreground/[0.08]"
                    transition={reduced ? { duration: 0 } : { type: "spring", stiffness: 500, damping: 38 }} />
                )}
                <span className="relative">{tf.label}</span>
              </button>
            );
          })}
        </div>
      </div>

      {/* OHLC legend */}
      <div className="mt-3 flex flex-wrap gap-x-5 gap-y-1.5">
        {legend.map(([label, value, color]) => (
          <span key={label} className="flex items-center gap-1.5">
            <span className="text-[10px] uppercase tracking-[0.1em] text-foreground/35">{label}</span>
            <span className="tabular-nums text-[11px]" style={{ color: color ?? "color-mix(in srgb, var(--foreground) 80%, transparent)" }}>{value}</span>
          </span>
        ))}
      </div>

      {/* chart */}
      <div className="relative mt-3">
        {loading && (
          <div className="absolute inset-0 z-20 flex items-center justify-center rounded-lg" style={{ background: "color-mix(in srgb, var(--card) 60%, transparent)" }}>
            <span className="text-[11px] text-foreground/50">Loading…</span>
          </div>
        )}
        <svg ref={svgRef} viewBox={`0 0 ${VB_W} ${VB_H}`} className="w-full touch-none" onPointerMove={onMove} onPointerLeave={() => setHover(null)} role="img" aria-label={`${live.symbol} candlestick chart`}>
          {/* gridlines + échelle prix */}
          {ticks.map((t, i) => (
            <g key={i}>
              <line x1={0} x2={plotW} y1={yPrice(t)} y2={yPrice(t)} stroke="color-mix(in srgb, var(--foreground) 5%, transparent)" strokeWidth="1" />
              <text x={VB_W - 4} y={yPrice(t) + 3} textAnchor="end" fill="color-mix(in srgb, var(--foreground) 30%, transparent)" style={{ fontSize: 8.5 }}>{fmtPrice(t)}</text>
            </g>
          ))}

          {/* niveaux support / résistance (vrais niveaux calculés) */}
          {ind.resistance != null && ind.resistance <= max && ind.resistance >= min && (
            <g>
              <line x1={0} x2={plotW} y1={yPrice(ind.resistance)} y2={yPrice(ind.resistance)} stroke={DOWN} strokeOpacity="0.5" strokeDasharray="4 4" strokeWidth="1" />
              <text x={4} y={yPrice(ind.resistance) - 3} fill={DOWN} style={{ fontSize: 8 }}>R {fmtPrice(ind.resistance)}</text>
            </g>
          )}
          {ind.support != null && ind.support <= max && ind.support >= min && (
            <g>
              <line x1={0} x2={plotW} y1={yPrice(ind.support)} y2={yPrice(ind.support)} stroke={UP} strokeOpacity="0.5" strokeDasharray="4 4" strokeWidth="1" />
              <text x={4} y={yPrice(ind.support) - 3} fill={UP} style={{ fontSize: 8 }}>S {fmtPrice(ind.support)}</text>
            </g>
          )}

          {/* dernier close */}
          {last && (
            <line x1={0} x2={plotW} y1={yPrice(last.c)} y2={yPrice(last.c)} stroke={up24 ? UP : DOWN} strokeOpacity="0.35" strokeDasharray="2 4" strokeWidth="1" />
          )}

          {/* bougies */}
          <motion.g initial={reduced ? undefined : { opacity: 0 }} animate={{ opacity: 1 }} transition={reduced ? { duration: 0 } : { duration: 0.5, ease: EASE }}>
            {candles.map((k, i) => {
              const color = k.c >= k.o ? UP : DOWN;
              const top = yPrice(Math.max(k.o, k.c));
              const bottom = yPrice(Math.min(k.o, k.c));
              const dim = hover !== null && hover !== i;
              return (
                <g key={i} style={{ opacity: dim ? 0.45 : 1 }}>
                  <line x1={xMid(i)} x2={xMid(i)} y1={yPrice(k.h)} y2={yPrice(k.l)} stroke={color} strokeWidth="1" vectorEffect="non-scaling-stroke" />
                  <rect x={xMid(i) - bodyW / 2} y={top} width={bodyW} height={Math.max(1, bottom - top)} fill={color} />
                </g>
              );
            })}
          </motion.g>

          {/* volume */}
          <g transform={`translate(0 ${PLOT_H + GAP})`}>
            {candles.map((k, i) => {
              const h = (k.v / maxVolume) * VOL_H;
              const dim = hover !== null && hover !== i;
              return <rect key={i} x={xMid(i) - bodyW / 2} y={VOL_H - h} width={bodyW} height={h} fill={k.c >= k.o ? UP : DOWN} fillOpacity={dim ? 0.3 : 0.55} />;
            })}
          </g>

          {/* crosshair */}
          {hover !== null && (
            <line x1={xMid(hover)} x2={xMid(hover)} y1={0} y2={VB_H} stroke="color-mix(in srgb, var(--foreground) 18%, transparent)" strokeWidth="1" vectorEffect="non-scaling-stroke" />
          )}
        </svg>

        {/* tooltip */}
        {hover !== null && active && (
          <div className="pointer-events-none absolute top-1 z-10 min-w-[140px] rounded-lg border border-foreground/[0.06] px-3 py-2.5"
            style={{ background: "var(--card)", boxShadow: "0 12px 32px rgba(0,0,0,0.4)", left: `${(xMid(hover) / VB_W) * 100}%`, transform: tipLeft ? "translateX(calc(-100% - 12px))" : "translateX(12px)" }} role="status">
            <div className="text-[10px] text-foreground/45">{fmtStamp(active.t, interval)}</div>
            <div className="mt-1.5 flex flex-col gap-1">
              {(["o", "h", "l", "c"] as const).map((key, idx) => (
                <div key={key} className="flex items-center justify-between gap-4">
                  <span className="text-[10px] uppercase tracking-[0.1em] text-foreground/40">{["Open", "High", "Low", "Close"][idx]}</span>
                  <span className="tabular-nums text-[11px] text-foreground/85">{fmtPrice(active[key])}</span>
                </div>
              ))}
              {active.v > 0 && (
                <div className="flex items-center justify-between gap-4 border-t border-foreground/[0.06] pt-1">
                  <span className="text-[10px] uppercase tracking-[0.1em] text-foreground/40">Vol</span>
                  <span className="tabular-nums text-[11px] text-foreground/85">{fmtCompact(active.v)}</span>
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      {/* date axis */}
      <div className="mt-2 flex justify-between border-t border-foreground/[0.06] pr-[52px] pt-2">
        {dateLabels.map((k, i) => (
          <span key={i} className="tabular-nums text-[9px] text-foreground/30">{k ? fmtDay(k.t, interval) : ""}</span>
        ))}
      </div>

      {/* indicateurs (vrais chiffres calculés côté serveur) */}
      <div className="mt-3 grid grid-cols-2 gap-x-5 gap-y-1.5 sm:grid-cols-4">
        {ind.rsi14 != null && (
          <Stat label="RSI (14)" value={ind.rsi14.toFixed(1)} color={ind.rsi14 >= 70 ? DOWN : ind.rsi14 <= 30 ? UP : undefined} />
        )}
        {ind.macd && <Stat label="MACD" value={ind.macd.histogram.toFixed(2)} color={ind.macd.histogram >= 0 ? UP : DOWN} />}
        {ind.sma50 != null && <Stat label="SMA 50" value={fmtPrice(ind.sma50)} />}
        {ind.sma200 != null && <Stat label="SMA 200" value={fmtPrice(ind.sma200)} />}
        {q?.volume24h != null && <Stat label="Vol 24h" value={fmtCompact(q.volume24h)} />}
        {ind.bollinger && <Stat label="BB upper" value={fmtPrice(ind.bollinger.upper)} />}
      </div>

      {/* News & sentiment — actualités RÉELLES (flux publics) + sentiment calculé côté serveur */}
      {news && (news.items?.length || news.summary) && (
        <div className="mt-4 rounded-xl border border-foreground/[0.06] p-3" style={{ background: "var(--muted, rgba(127,127,127,0.05))" }}>
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-[10px] font-medium uppercase tracking-[0.12em] text-foreground/45">Actu &amp; sentiment</span>
            <SentimentBadge sentiment={news.sentiment} score={news.score} />
            {news.confidence && (
              <span className="text-[9px] text-foreground/35">confidence {news.confidence}</span>
            )}
          </div>
          {news.summary && (
            <p className="mt-2 text-[11px] leading-relaxed text-foreground/70">{news.summary}</p>
          )}
          {!!news.catalysts?.length && (
            <ul className="mt-1.5 flex flex-col gap-0.5">
              {news.catalysts.map((cat, i) => (
                <li key={i} className="text-[10px] leading-snug text-foreground/50">• {cat}</li>
              ))}
            </ul>
          )}
          {!!news.items?.length && (
            <div className="mt-2.5 flex flex-col gap-1.5 border-t border-foreground/[0.06] pt-2.5">
              {news.items.slice(0, 5).map((it, i) => (
                <a key={i} href={it.url || "#"} target="_blank" rel="noopener noreferrer"
                  className="group flex items-start gap-2 text-[11px] leading-snug text-foreground/75 hover:text-foreground transition-colors">
                  <span className="mt-[1px] shrink-0 rounded px-1.5 py-0.5 text-[8px] uppercase tracking-wide text-foreground/45" style={{ background: "var(--card)" }}>{it.source}</span>
                  <span className="group-hover:underline">{it.title}</span>
                </a>
              ))}
            </div>
          )}
          {!!news.macro?.length && (
            <div className="mt-2.5 border-t border-foreground/[0.06] pt-2">
              <span className="text-[9px] uppercase tracking-[0.1em] text-foreground/35">Macro / markets</span>
              <div className="mt-1 flex flex-col gap-1">
                {news.macro.slice(0, 3).map((it, i) => (
                  <a key={i} href={it.url || "#"} target="_blank" rel="noopener noreferrer"
                    className="text-[10px] leading-snug text-foreground/55 hover:text-foreground/85 hover:underline transition-colors">
                    {it.title} <span className="text-foreground/30">— {it.source}</span>
                  </a>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      <p className="mt-3 text-[9px] leading-relaxed text-foreground/35">
        Real market data and news ({live.source || "market"} · public RSS feeds). This is not financial advice — crypto trading involves a risk of capital loss.
      </p>
    </div>
  );
}

function SentimentBadge({ sentiment, score }: { sentiment: "bullish" | "bearish" | "neutral"; score: number }) {
  const cfg = sentiment === "bullish"
    ? { label: "Bullish", color: UP, bg: "rgba(52,194,138,0.14)" }
    : sentiment === "bearish"
      ? { label: "Bearish", color: DOWN, bg: "rgba(208,98,95,0.14)" }
      : { label: "Neutral", color: "var(--foreground)", bg: "rgba(127,127,127,0.14)" };
  return (
    <span className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium"
      style={{ color: cfg.color, background: cfg.bg }}>
      {cfg.label}
      <span className="tabular-nums opacity-70">{score >= 0 ? "+" : ""}{score}</span>
    </span>
  );
}

function Stat({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <div className="flex flex-col">
      <span className="text-[9px] uppercase tracking-[0.1em] text-foreground/35">{label}</span>
      <span className="tabular-nums text-[12px]" style={{ color: color ?? "var(--foreground)" }}>{value}</span>
    </div>
  );
}
