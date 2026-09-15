"use client";

import { useState } from "react";
import { AnimatePresence, motion } from "motion/react";

/* ─────────────────────────────────────────────────────────────────────────
 * STEPS VIEW — étapes / timeline / checklist dans le chat.
 * L'IA émet [STEPS_VIEW]{json}[/STEPS_VIEW] avec les VRAIES données.
 * Même design que le "Plan des pages" (PagePlanTool).
 *
 * Variants :
 *  - "steps"     : étapes numérotées
 *  - "timeline"  : chronologie verticale (ligne + pastilles)
 *  - "checklist" : cases NON colorées ; un clic sur la case révèle le
 *                  détail juste au-dessus de l'item.
 * ───────────────────────────────────────────────────────────────────────── */

interface StepItem {
  title: string;
  detail?: string; // apparaît au-dessus au clic (checklist) ou sous le titre
  meta?: string; // ex date, durée
  done?: boolean;
}
export interface StepsViewData {
  variant?: "steps" | "timeline" | "checklist";
  title?: string;
  items: StepItem[];
  accent?: string;
}

function IconCheck({ size = 12 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
      <path d="M5 12l5 5l10 -10" />
    </svg>
  );
}
function IconList() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M9 6h11M9 12h11M9 18h11M4 6h.01M4 12h.01M4 18h.01" />
    </svg>
  );
}

function Shell({ label, count, children }: { label: string; count: number; children: React.ReactNode }) {
  return (
    <div style={{ border: "1px solid var(--border-default)", background: "var(--surface-2)", borderRadius: 10, overflow: "hidden", margin: "8px 0" }}>
      <div style={{ height: 30, borderBottom: "1px solid var(--border-default)", padding: "0 12px", display: "flex", alignItems: "center", justifyContent: "space-between", fontSize: 12, color: "var(--text-dim)" }}>
        <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}><IconList /> {label}</span>
        <span>{count} item{count > 1 ? "s" : ""}</span>
      </div>
      <div style={{ padding: "10px 12px 12px", background: "var(--surface-2)" }}>{children}</div>
    </div>
  );
}

/* ─── STEPS (numérotées) ─── */
function StepsList({ items, accent }: { items: StepItem[]; accent: string }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
      {items.map((it, i) => (
        <div key={i} style={{ display: "flex", gap: 10, padding: "8px 6px", borderRadius: 8 }}>
          <div style={{ flexShrink: 0, width: 24, height: 24, borderRadius: 999, background: it.done ? accent : `${accent}22`, color: it.done ? "#fff" : accent, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 12, fontWeight: 700 }}>
            {it.done ? <IconCheck /> : i + 1}
          </div>
          <div style={{ minWidth: 0, flex: 1 }}>
            <div style={{ fontSize: 13, fontWeight: 500, color: "var(--text-primary)" }}>{it.title}</div>
            {it.detail && <div style={{ fontSize: 12, color: "var(--text-dim)", marginTop: 2 }}>{it.detail}</div>}
            {it.meta && <div style={{ fontSize: 11, color: accent, marginTop: 3 }}>{it.meta}</div>}
          </div>
        </div>
      ))}
    </div>
  );
}

/* ─── TIMELINE ─── */
function TimelineList({ items, accent }: { items: StepItem[]; accent: string }) {
  return (
    <div style={{ position: "relative", paddingLeft: 6 }}>
      {items.map((it, i) => (
        <div key={i} style={{ display: "flex", gap: 12, position: "relative", paddingBottom: i === items.length - 1 ? 0 : 16 }}>
          <div style={{ position: "relative", display: "flex", flexDirection: "column", alignItems: "center" }}>
            <div style={{ width: 14, height: 14, borderRadius: 999, background: it.done ? accent : "var(--surface-2)", border: `2px solid ${accent}`, flexShrink: 0, zIndex: 1 }} />
            {i !== items.length - 1 && <div style={{ width: 2, flex: 1, background: "var(--border-default)", marginTop: 2 }} />}
          </div>
          <div style={{ minWidth: 0, flex: 1, paddingBottom: 2 }}>
            {it.meta && <div style={{ fontSize: 11, fontWeight: 600, color: accent }}>{it.meta}</div>}
            <div style={{ fontSize: 13, fontWeight: 500, color: "var(--text-primary)" }}>{it.title}</div>
            {it.detail && <div style={{ fontSize: 12, color: "var(--text-dim)", marginTop: 2 }}>{it.detail}</div>}
          </div>
        </div>
      ))}
    </div>
  );
}

/* ─── CHECKLIST (cases non colorées, clic → détail au-dessus) ─── */
function ChecklistRow({ item, accent }: { item: StepItem; accent: string }) {
  const [open, setOpen] = useState(false);
  return (
    <div>
      <AnimatePresence initial={false}>
        {open && item.detail && (
          <motion.div
            initial={{ opacity: 0, height: 0, y: 6 }}
            animate={{ opacity: 1, height: "auto", y: 0 }}
            exit={{ opacity: 0, height: 0, y: 6 }}
            transition={{ duration: 0.2 }}
            style={{ overflow: "hidden" }}
          >
            <div style={{ margin: "0 0 6px 34px", padding: "8px 10px", background: "var(--surface-3)", border: `1px solid ${accent}55`, borderRadius: 8, fontSize: 12, color: "var(--text-secondary, var(--text-dim))" }}>
              {item.detail}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
      <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "7px 6px", borderRadius: 8 }}>
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-label={open ? "Hide detail" : "View detail"}
          style={{
            flexShrink: 0, width: 20, height: 20, borderRadius: 5, cursor: "pointer",
            display: "inline-flex", alignItems: "center", justifyContent: "center",
            border: `1.5px solid ${open ? accent : "var(--border-default)"}`,
            background: "transparent", color: open ? accent : "transparent", transition: "all .15s",
          }}
        >
          <IconCheck size={12} />
        </button>
        <div style={{ minWidth: 0, flex: 1 }}>
          <div style={{ fontSize: 13, color: "var(--text-primary)" }}>{item.title}</div>
          {item.meta && <div style={{ fontSize: 11, color: "var(--text-dim)" }}>{item.meta}</div>}
        </div>
      </div>
    </div>
  );
}

export function StepsView({ data }: { data: StepsViewData }) {
  const items = Array.isArray(data.items) ? data.items.filter((i) => i && i.title) : [];
  if (items.length === 0) return null;
  const variant = data.variant || "steps";
  const accent = data.accent || "#6366F1";
  const label = variant === "timeline" ? "Timeline" : variant === "checklist" ? "Checklist" : "Steps";

  const wrapped = (
    <>
      {data.title && <p style={{ fontSize: 13, color: "var(--text-primary)", margin: "0 0 8px" }}>{data.title}</p>}
      {variant === "steps" && <StepsList items={items} accent={accent} />}
      {variant === "timeline" && <TimelineList items={items} accent={accent} />}
      {variant === "checklist" && (
        <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
          {items.map((it, i) => <ChecklistRow key={i} item={it} accent={accent} />)}
        </div>
      )}
    </>
  );

  return <Shell label={label} count={items.length}>{wrapped}</Shell>;
}
