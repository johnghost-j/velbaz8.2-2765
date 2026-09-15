/**
 * VELBAZ — PLAN INTERACTIF HIÉRARCHIQUE (bloc de chat)
 * ===================================================
 * L'IA émet un bloc [PLAN_VIEW]{json}[/PLAN_VIEW] pour proposer un plan
 * (5 prochaines minutes, 3 jours, une seMayne, un mois, une année, plusieurs ans…).
 *
 * AFFICHAGE ADAPTATIF selon la durée du plan :
 *   - "day"   (plan court, ≤ ~1 mois)  → toutes les journées listées directement.
 *   - "month" (plan sur plusieurs mois d'une même année) → on affiche les MOIS
 *      (seulement ceux qui ont des étapes) ; clic sur un mois → il se déplie et
 *      montre les JOURS qui ont un plan.
 *   - "year"  (plan sur plusieurs années) → on affiche les ANNÉES ; clic → déplie
 *      les MOIS ; clic sur un mois → déplie les JOURS.
 *   Le niveau est auto-détecté (ou forcé via data.groupBy).
 *
 * Chaque JOUR (feuille) : au survol → ✏️ éditer (inline) et 🗑️ supprimer.
 * Bouton « Accept the plan » → ajoute toutes les étapes au CALENDRIER INTERNE
 * du projet via POST /api/companies/:id/plan/accept (invisible pour l'utilisateur).
 *
 * S'adapte au thème (clair / sombre) via les variables CSS de l'app.
 */

import React, { useMemo, useState } from "react";
import { getAuthToken } from '../lib/token';

export interface PlanItem {
  date?: string;        // YYYY-MM-DD
  time?: string;        // HH:MM (optionnel)
  title: string;        // tâche
  details?: string;     // description / détails
  category?: string;    // marketing|task|reminder|update|deadline|client_meeting
}

export interface PlanViewData {
  title?: string;
  subtitle?: string;
  accent?: string;
  groupBy?: "day" | "month" | "year"; // optionnel — sinon auto-détecté
  items: PlanItem[];
}

type Row = PlanItem & { _id: number };

function authHeaders(): Record<string, string> {
  const t = getAuthToken();
  return t ? { Authorization: `Bearer ${t}` } : {};
}

/* Choisit un texte lisible (foncé ou blanc) selon la luminance d'un fond.
   Si le fond n'est pas un hex parsable (ex: var(--accent)), on garde blanc. */
function readableText(bg: string): string {
  const hex = String(bg || "").trim().replace(/^#/, "");
  if (!/^[0-9a-fA-F]{6}$/.test(hex)) return "#fff";
  const r = parseInt(hex.slice(0, 2), 16);
  const g = parseInt(hex.slice(2, 4), 16);
  const b = parseInt(hex.slice(4, 6), 16);
  const lum = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return lum > 0.62 ? "#111827" : "#fff";
}

/* ─── Icônes ─── */
function IconPencil() {
  return <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M4 20h4L18.5 9.5a2.1 2.1 0 0 0-3-3L5 17v3z" /><path d="M13.5 6.5l3 3" /></svg>;
}
function IconTrash() {
  return <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M4 7h16M10 11v6M14 11v6M5 7l1 12a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2l1-12M9 7V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v3" /></svg>;
}
function IconCheck() {
  return <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12l5 5L20 7" /></svg>;
}
function IconClose() {
  return <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M6 6l12 12M18 6L6 18" /></svg>;
}
function IconCalendar() {
  return <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="4.5" width="18" height="16" rx="2.5" /><path d="M3 9h18M8 2.5v4M16 2.5v4" /></svg>;
}
function Chevron({ open }: { open: boolean }) {
  return <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" style={{ transform: open ? "rotate(90deg)" : "rotate(0deg)", transition: "transform 140ms" }}><path d="M9 6l6 6-6 6" /></svg>;
}

/* ─── Helpers dates ─── */
function parseDate(d?: string): Date | null {
  if (!d) return null;
  const dt = new Date(String(d) + (String(d).length === 10 ? "T00:00:00" : ""));
  return isNaN(dt.getTime()) ? null : dt;
}
const MONTHS_FR = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
function dayLabel(d?: string): string {
  const dt = parseDate(d);
  if (!dt) return "—";
  return dt.toLocaleDateString("fr-FR", { weekday: "short", day: "numeric", month: "short" });
}
function monthLabel(key: string): string {
  const [y, m] = key.split("-").map(Number);
  return `${MONTHS_FR[m - 1]} ${y}`;
}

const inputStyle: React.CSSProperties = {
  width: "100%", fontSize: 13.5, padding: "6px 9px", borderRadius: 8,
  border: "1px solid var(--border-default)", background: "var(--surface-4)",
  color: "var(--text-primary)", outline: "none", fontFamily: "inherit",
};

export function PlanView({ data, companyId }: { data: PlanViewData; companyId?: string | null }) {
  const accent = data.accent || "var(--accent, #6C5BFF)";
  // Couleur de texte SUR le fond accent. Quand `accent` est un hex explicite on
  // calcule le contraste ; sinon (variable de thème) on utilise la paire fournie
  // par le thème `--accent-foreground` — readableText() ne sait PAS résoudre une
  // var CSS et renverrait blanc par défaut → texte blanc sur bouton clair
  // (illisible) en thème sombre où --accent est clair.
  const accentText = data.accent ? readableText(data.accent) : "var(--accent-foreground, #fff)";
  const [rows, setRows] = useState<Row[]>(() => (data.items || []).map((it, i) => ({ ...it, _id: i })));
  const [editingId, setEditingId] = useState<number | null>(null);
  const [draft, setDraft] = useState<Row | null>(null);
  const [hover, setHover] = useState<number | null>(null);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [state, setState] = useState<"idle" | "saving" | "done" | "error">("idle");
  const [msg, setMsg] = useState<string>("");

  // Niveau de regroupement : forcé (data.groupBy) ou auto-détecté selon la durée.
  const mode: "day" | "month" | "year" = useMemo(() => {
    if (data.groupBy) return data.groupBy;
    const dates = rows.map((r) => parseDate(r.date)).filter((d): d is Date => !!d);
    if (dates.length < 2) return "day";
    const years = new Set(dates.map((d) => d.getFullYear()));
    if (years.size > 1) return "year";
    const min = Math.min(...dates.map((d) => d.getTime()));
    const max = Math.max(...dates.map((d) => d.getTime()));
    const spanDays = (max - min) / 86400000;
    return spanDays > 31 ? "month" : "day";
  }, [rows, data.groupBy]);

  function toggle(key: string) {
    setExpanded((e) => ({ ...e, [key]: !e[key] }));
  }
  function startEdit(id: number) {
    const r = rows.find((x) => x._id === id);
    if (r) { setEditingId(id); setDraft({ ...r }); }
  }
  function cancelEdit() { setEditingId(null); setDraft(null); }
  function saveEdit() {
    if (editingId === null || !draft) return;
    setRows((prev) => prev.map((r) => (r._id === editingId ? { ...draft } : r)));
    cancelEdit();
  }
  function removeRow(id: number) {
    setRows((prev) => prev.filter((r) => r._id !== id));
    if (editingId === id) cancelEdit();
  }

  async function accept() {
    if (!companyId || state === "saving" || state === "done") return;
    if (rows.length === 0) { setState("error"); setMsg("The plan is empty."); return; }
    setState("saving"); setMsg("");
    try {
      const items = rows.map(({ _id, ...it }) => it);
      const res = await fetch(`/api/companies/${companyId}/plan/accept`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...authHeaders() },
        body: JSON.stringify({ title: data.title || null, items }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(j?.error || "Failed to add to calendar");
      setState("done");
      setMsg(`${j?.added ?? rows.length} item(s) added to the calendar${j?.moved ? ` · ${j.moved} moved to avoid a conflict` : ""}.`);
    } catch (e: any) {
      setState("error"); setMsg(e?.message || "Error");
    }
  }

  const iconBtn: React.CSSProperties = { display: "inline-flex", alignItems: "center", justifyContent: "center", width: 28, height: 28, borderRadius: 7, border: "1px solid var(--border-default)", background: "var(--surface-4)", cursor: "pointer", color: "var(--text-dim)" };

  /* ─── Ligne "jour" (feuille éditable) ───
     NB: helper de RENDU appelé comme une fonction — PAS un composant JSX.
     Défini dans PlanView, il obtient une nouvelle identité à chaque render ;
     l'utiliser comme <LeafRow/> ferait remonter tout le sous-arbre à chaque
     survol (setHover) et rejouerait l'animation d'ouverture. Appelé en tant que
     fonction, il produit des éléments réconciliés par clé, sans remount. */
  function LeafRow({ row, indent }: { row: Row; indent: number }) {
    const isEdit = editingId === row._id;
    if (isEdit && draft) {
      return (
        <div key={row._id} style={{ padding: "10px 14px", paddingLeft: 14 + indent, background: "var(--surface-4)", borderTop: "1px solid var(--border-default)" }}>
          <div style={{ display: "flex", gap: 8, marginBottom: 6, flexWrap: "wrap" }}>
            <input type="date" value={draft.date || ""} onChange={(e) => setDraft({ ...draft, date: e.target.value })} style={{ ...inputStyle, flex: "1 1 140px" }} />
            <input type="time" value={draft.time || ""} onChange={(e) => setDraft({ ...draft, time: e.target.value })} style={{ ...inputStyle, flex: "0 1 110px" }} />
          </div>
          <input value={draft.title} placeholder="Task title" onChange={(e) => setDraft({ ...draft, title: e.target.value })} style={{ ...inputStyle, marginBottom: 6, fontWeight: 600 }} />
          <textarea value={draft.details || ""} placeholder="Details (optional)" onChange={(e) => setDraft({ ...draft, details: e.target.value })} rows={2} style={{ ...inputStyle, resize: "vertical", marginBottom: 8 }} />
          <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
            <button onClick={cancelEdit} title="Cancel" style={iconBtn}><IconClose /></button>
            <button onClick={saveEdit} title="Save" style={{ ...iconBtn, color: accentText, background: accent, border: "none" }}><IconCheck /></button>
          </div>
        </div>
      );
    }
    return (
      <div
        key={row._id}
        onMouseEnter={() => setHover(row._id)}
        onMouseLeave={() => setHover((h) => (h === row._id ? null : h))}
        style={{ display: "flex", alignItems: "flex-start", gap: 12, padding: "11px 14px", paddingLeft: 14 + indent, borderTop: "1px solid var(--border-default)" }}
      >
        <div style={{ width: 108, flexShrink: 0 }}>
          <div style={{ fontWeight: 600, fontSize: 13, color: "var(--text-primary)", textTransform: "capitalize" }}>{dayLabel(row.date)}</div>
          {row.time && <div style={{ fontSize: 12, color: "var(--text-dim)", marginTop: 2, fontFamily: "ui-monospace, monospace" }}>{row.time}</div>}
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontWeight: 600, fontSize: 14, color: "var(--text-primary)" }}>{row.title}</div>
          {row.details && <div style={{ marginTop: 3, fontSize: 13, lineHeight: 1.4, color: "var(--text-secondary)" }}>{row.details}</div>}
        </div>
        <div style={{ display: "flex", gap: 6, opacity: hover === row._id ? 1 : 0, transition: "opacity 120ms", pointerEvents: hover === row._id ? "auto" : "none" }}>
          <button onClick={() => startEdit(row._id)} title="Edit" style={iconBtn}><IconPencil /></button>
          <button onClick={() => removeRow(row._id)} title="Delete" style={{ ...iconBtn, color: "#EF4444" }}><IconTrash /></button>
        </div>
      </div>
    );
  }

  /* ─── En-tête de groupe (année / mois) repliable ─── */
  function GroupHeader({ label, count, open, onClick, indent, big }: { label: string; count: number; open: boolean; onClick: () => void; indent: number; big?: boolean }) {
    return (
      <button
        onClick={onClick}
        style={{
          display: "flex", alignItems: "center", gap: 9, width: "100%", textAlign: "left",
          padding: big ? "13px 14px" : "10px 14px", paddingLeft: 14 + indent,
          border: "none", borderTop: "1px solid var(--border-default)", cursor: "pointer",
          background: open ? "var(--surface-4)" : "transparent", color: "var(--text-primary)",
        }}
      >
        <span style={{ color: "var(--text-dim)", display: "inline-flex" }}><Chevron open={open} /></span>
        <span style={{ fontWeight: 700, fontSize: big ? 15 : 13.5, textTransform: "capitalize", flex: 1 }}>{label}</span>
        <span style={{ fontSize: 11.5, fontWeight: 600, color: "var(--text-dim)", background: "var(--surface-3)", border: "1px solid var(--border-default)", borderRadius: 20, padding: "2px 9px" }}>{count}</span>
      </button>
    );
  }

  // Regroupement des lignes selon le mode.
  const grouped = useMemo(() => {
    const byMonth = (rs: Row[]) => {
      const map = new Map<string, Row[]>();
      for (const r of rs) {
        const dt = parseDate(r.date);
        const key = dt ? `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, "0")}` : "0000-00";
        if (!map.has(key)) map.set(key, []);
        map.get(key)!.push(r);
      }
      return [...map.entries()].sort((a, b) => a[0].localeCompare(b[0]));
    };
    const byYear = (rs: Row[]) => {
      const map = new Map<string, Row[]>();
      for (const r of rs) {
        const dt = parseDate(r.date);
        const key = dt ? String(dt.getFullYear()) : "0000";
        if (!map.has(key)) map.set(key, []);
        map.get(key)!.push(r);
      }
      return [...map.entries()].sort((a, b) => a[0].localeCompare(b[0]));
    };
    return { byMonth, byYear };
  }, []);

  function sortByDate(rs: Row[]) {
    return [...rs].sort((a, b) => String(a.date || "").localeCompare(String(b.date || "")) || String(a.time || "").localeCompare(String(b.time || "")));
  }

  return (
    <div className="page-preview-enter" style={{ marginTop: 10, borderRadius: 14, border: "none", boxShadow: "none", background: "transparent", overflow: "hidden", maxWidth: 660 }}>
      {/* En-tête */}
      <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "13px 16px" }}>
        <span style={{ display: "inline-flex", width: 30, height: 30, borderRadius: 8, alignItems: "center", justifyContent: "center", background: accent, color: accentText, flexShrink: 0 }}><IconCalendar /></span>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: 14.5, fontWeight: 700, color: "var(--text-primary)" }}>{data.title || "Plan"}</div>
          {data.subtitle && <div style={{ fontSize: 12.5, color: "var(--text-dim)", marginTop: 1 }}>{data.subtitle}</div>}
        </div>
      </div>

      {/* Corps */}
      <div>
        {rows.length === 0 ? (
          <div style={{ padding: "20px 14px", textAlign: "center", color: "var(--text-dim)", fontSize: 13.5, borderTop: "1px solid var(--border-default)" }}>No steps in the plan.</div>
        ) : mode === "day" ? (
          sortByDate(rows).map((r) => LeafRow({ row: r, indent: 0 }))
        ) : mode === "month" ? (
          grouped.byMonth(rows).map(([mkey, mrows]) => {
            const open = expanded[`m:${mkey}`];
            return (
              <div key={mkey}>
                {GroupHeader({ big: true, label: monthLabel(mkey), count: mrows.length, open: !!open, onClick: () => toggle(`m:${mkey}`), indent: 0 })}
                <div className="plan-collapsible" data-open={open ? "true" : "false"}><div className="plan-collapsible-inner">{sortByDate(mrows).map((r) => LeafRow({ row: r, indent: 22 }))}</div></div>
              </div>
            );
          })
        ) : (
          grouped.byYear(rows).map(([ykey, yrows]) => {
            const yopen = expanded[`y:${ykey}`];
            return (
              <div key={ykey}>
                {GroupHeader({ big: true, label: ykey, count: yrows.length, open: !!yopen, onClick: () => toggle(`y:${ykey}`), indent: 0 })}
                <div className="plan-collapsible" data-open={yopen ? "true" : "false"}><div className="plan-collapsible-inner">{grouped.byMonth(yrows).map(([mkey, mrows]) => {
                  const mopen = expanded[`m:${mkey}`];
                  const mName = MONTHS_FR[Number(mkey.split("-")[1]) - 1];
                  return (
                    <div key={mkey}>
                      {GroupHeader({ label: mName, count: mrows.length, open: !!mopen, onClick: () => toggle(`m:${mkey}`), indent: 22 })}
                      <div className="plan-collapsible" data-open={mopen ? "true" : "false"}><div className="plan-collapsible-inner">{sortByDate(mrows).map((r) => LeafRow({ row: r, indent: 44 }))}</div></div>
                    </div>
                  );
                })}</div></div>
              </div>
            );
          })
        )}
      </div>

      {/* Pied : Accepter */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, padding: "12px 16px", borderTop: "1px solid var(--border-default)", flexWrap: "wrap" }}>
        <div style={{ fontSize: 12.5, color: state === "error" ? "#EF4444" : state === "done" ? "#10B981" : "var(--text-dim)" }}>
          {msg || `${rows.length} step(s)${mode !== "day" ? " — click a " + (mode === "year" ? "year / month" : "month") + " to expand the days" : " — hover a row to edit"}.`}
        </div>
        <button
          onClick={accept}
          disabled={state === "saving" || state === "done" || rows.length === 0}
          style={{
            display: "inline-flex", alignItems: "center", gap: 7, fontSize: 13.5, fontWeight: 600,
            padding: "9px 18px", borderRadius: 10, border: "none", cursor: state === "done" || state === "saving" ? "default" : "pointer",
            background: state === "done" ? "#10B981" : accent, color: state === "done" ? "#fff" : accentText, opacity: rows.length === 0 ? 0.5 : 1,
          }}
        >
          {state === "done" ? <><IconCheck /> Added to calendar</> : state === "saving" ? "Adding…" : "Accept the plan"}
        </button>
      </div>
    </div>
  );
}
