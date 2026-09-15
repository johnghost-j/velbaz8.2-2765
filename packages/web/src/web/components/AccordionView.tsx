"use client";

import { useState } from "react";
import { AnimatePresence, motion } from "motion/react";

/* ─────────────────────────────────────────────────────────────────────────
 * ACCORDION VIEW — sections repliables (FAQ, détails…) dans le chat.
 * L'IA émet [ACCORDION_VIEW]{json}[/ACCORDION_VIEW].
 * ───────────────────────────────────────────────────────────────────────── */

interface Section {
  title: string;
  content: string;
}
export interface AccordionViewData {
  title?: string;
  sections: Section[];
  multiple?: boolean; // plusieurs ouverts en même temps
  defaultOpen?: number; // index ouvert par défaut
}

function Chevron({ open, color }: { open: boolean; color: string }) {
  return (
    <motion.svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"
      animate={{ rotate: open ? 180 : 0 }} transition={{ duration: 0.2 }} style={{ flexShrink: 0 }}>
      <path d="M6 9l6 6 6-6" />
    </motion.svg>
  );
}

export function AccordionView({ data }: { data: AccordionViewData }) {
  const sections = Array.isArray(data.sections) ? data.sections.filter((s) => s && s.title) : [];
  const [open, setOpen] = useState<number[]>(typeof data.defaultOpen === "number" ? [data.defaultOpen] : []);
  if (sections.length === 0) return null;

  const toggle = (i: number) => {
    setOpen((prev) => {
      if (prev.includes(i)) return prev.filter((x) => x !== i);
      return data.multiple ? [...prev, i] : [i];
    });
  };

  return (
    <div style={{ margin: "8px 0" }}>
      {data.title && <div style={{ fontSize: 14, fontWeight: 600, color: "var(--text-primary)", marginBottom: 8 }}>{data.title}</div>}
      <div style={{ border: "1px solid var(--border-default)", borderRadius: 12, overflow: "hidden", background: "var(--surface-2)" }}>
        {sections.map((s, i) => {
          const isOpen = open.includes(i);
          return (
            <div key={i} style={{ borderTop: i === 0 ? "none" : "1px solid var(--border-default)" }}>
              <button
                type="button"
                onClick={() => toggle(i)}
                style={{
                  width: "100%", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10,
                  padding: "12px 14px", background: "transparent", border: "none", cursor: "pointer", textAlign: "left",
                  fontSize: 13.5, fontWeight: 500, color: "var(--text-primary)",
                }}
              >
                <span>{s.title}</span>
                <Chevron open={isOpen} color="var(--text-dim)" />
              </button>
              <AnimatePresence initial={false}>
                {isOpen && (
                  <motion.div
                    initial={{ height: 0, opacity: 0 }}
                    animate={{ height: "auto", opacity: 1 }}
                    exit={{ height: 0, opacity: 0 }}
                    transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
                    style={{ overflow: "hidden" }}
                  >
                    <div style={{ padding: "0 14px 13px", fontSize: 13, lineHeight: 1.55, color: "var(--text-secondary, var(--text-dim))", whiteSpace: "pre-wrap" }}>
                      {s.content}
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          );
        })}
      </div>
    </div>
  );
}
