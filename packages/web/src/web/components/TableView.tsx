"use client";

import { useMemo, useState } from "react";

/* ─────────────────────────────────────────────────────────────────────────
 * TABLE VIEW — tableaux que l'IA peut afficher dans le chat.
 * L'IA émet [TABLE_VIEW]{json}[/TABLE_VIEW] avec les vraies données + un
 * "variant" (style). Le composant est self-contained (aucune lib externe).
 *
 * Variants :
 *  - "simple"  : table basique (badges de statut, total en pied)      (design 1)
 *  - "grid"    : tableur type Excel (lignes/colonnes numérotées)      (design 2)
 *  - "data"    : tri + recherche + pagination                         (design 3)
 *  - "matrix"  : matrice de comparaison ✓/✗ avec en-têtes groupés     (design 4)
 *  - "tags"    : recherche/tri + tags + actions éditer/supprimer      (design 5)
 *  - "editorial": éditorial épuré, grand texte, lignes aérées, en-têtes
 *                 gris discrets, un seul filet sous l'en-tête, pas de
 *                 bordures verticales, texte qui passe sur plusieurs lignes,
 *                 **gras** géré dans les cellules                       (design 6)
 * ───────────────────────────────────────────────────────────────────────── */

type Align = "left" | "right" | "center";
type CellType =
  | "text"
  | "badge"
  | "number"
  | "money"
  | "tags"
  | "link"
  | "check"
  | "actions";

interface Column {
  key: string;
  label: string;
  align?: Align;
  type?: CellType;
  group?: string; // pour la matrice (en-tête groupé)
}
interface FooterCell {
  key: string;
  label?: string;
  value?: string;
}
export interface TableViewData {
  variant?: "simple" | "grid" | "data" | "matrix" | "tags" | "editorial" | "bordered";
  title?: string;
  subtitle?: string;
  columns: Column[];
  rows: Record<string, any>[];
  footer?: FooterCell[];
  searchable?: boolean;
  sortable?: boolean;
  pageSize?: number;
}

/* ─── Helpers ─── */
const BADGE_COLORS: Record<string, string> = {
  active: "#10B981",
  actif: "#10B981",
  ok: "#10B981",
  success: "#10B981",
  done: "#10B981",
  terminé: "#10B981",
  inactive: "#94A3B8",
  inactif: "#94A3B8",
  pending: "#F59E0B",
  "en attente": "#F59E0B",
  warning: "#F59E0B",
  error: "#EF4444",
  erreur: "#EF4444",
  failed: "#EF4444",
  annulé: "#EF4444",
};
function badgeColor(v: string): string {
  return BADGE_COLORS[String(v).toLowerCase().trim()] || "#6C5BFF";
}
function isTruthyCheck(v: any): boolean {
  if (typeof v === "boolean") return v;
  const s = String(v).toLowerCase().trim();
  return s === "true" || s === "yes" || s === "oui" || s === "✓" || (/^\d/.test(s) && s !== "0" && s !== "no");
}
function isMoneyNegative(v: any): boolean {
  return /-/.test(String(v));
}
/* Rendu inline avec **gras** (et *italique*) pour le variant éditorial. */
function renderRich(input: any): React.ReactNode {
  const text = typeof input === "object" && input !== null ? JSON.stringify(input) : String(input ?? "");
  const parts = text.split(/(\*\*[^*]+\*\*|\*[^*]+\*)/g).filter((p) => p !== "");
  return parts.map((p, i) => {
    if (/^\*\*[^*]+\*\*$/.test(p)) return <strong key={i} style={{ fontWeight: 700, color: "var(--text-primary)" }}>{p.slice(2, -2)}</strong>;
    if (/^\*[^*]+\*$/.test(p)) return <em key={i}>{p.slice(1, -1)}</em>;
    return <span key={i}>{p}</span>;
  });
}

/* ─── Variant "editorial" : grand texte, aéré, sans bordures ─── */
function EditorialTable({ data }: { data: TableViewData }) {
  const cols = data.columns || [];
  const rows = data.rows || [];
  return (
    <div
      className="page-preview-enter"
      style={{ marginTop: 10, borderRadius: 14, border, background: "var(--surface-2, var(--surface-3))", overflow: "hidden", maxWidth: 640 }}
    >
      {(data.title || data.subtitle) && (
        <div style={{ padding: "16px 22px 4px" }}>
          {data.title && <div style={{ fontSize: 17, fontWeight: 700, color: "var(--text-primary)" }}>{data.title}</div>}
          {data.subtitle && <div style={{ fontSize: 13.5, color: "var(--text-dim)", marginTop: 2 }}>{data.subtitle}</div>}
        </div>
      )}
      <div style={{ overflowX: "auto", padding: "6px 8px 14px" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", tableLayout: "fixed" }}>
          <thead>
            <tr>
              {cols.map((c) => (
                <th
                  key={c.key}
                  style={{
                    padding: "14px 14px 12px",
                    fontSize: 15,
                    fontWeight: 400,
                    color: "var(--text-dim)",
                    textAlign: (c.align as any) || "left",
                    borderBottom: "1px solid var(--border-default)",
                    verticalAlign: "bottom",
                  }}
                >
                  {c.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr><td colSpan={cols.length} style={{ padding: 24, textAlign: "center", color: "var(--text-dim)", fontSize: 15 }}>No data.</td></tr>
            ) : (
              rows.map((row, ri) => (
                <tr key={ri}>
                  {cols.map((c, ci) => (
                    <td
                      key={c.key}
                      style={{
                        padding: "22px 14px",
                        fontSize: 16.5,
                        lineHeight: 1.35,
                        color: ci === 0 ? "var(--text-primary)" : "var(--text-secondary)",
                        textAlign: (c.align as any) || "left",
                        verticalAlign: "top",
                        whiteSpace: "normal",
                        wordBreak: "break-word",
                      }}
                    >
                      {renderRich(row[c.key])}
                    </td>
                  ))}
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/* ─── Icônes ─── */
function IconCheck() {
  return <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#10B981" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12l5 5L20 7" /></svg>;
}
function IconX() {
  return <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#EF4444" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M6 6l12 12M18 6L6 18" /></svg>;
}
function IconPencil() {
  return <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M4 20h4L18.5 9.5a2.1 2.1 0 0 0-3-3L5 17v3z" /><path d="M13.5 6.5l3 3" /></svg>;
}
function IconTrash() {
  return <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M4 7h16M10 11v6M14 11v6M5 7l1 12a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2l1-12M9 7V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v3" /></svg>;
}
function IconSort({ dir }: { dir?: "asc" | "desc" | null }) {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ opacity: dir ? 1 : 0.4 }}>
      {dir === "desc" ? <path d="M6 9l6 6 6-6" /> : dir === "asc" ? <path d="M6 15l6-6 6 6" /> : <><path d="M8 9l4-4 4 4" /><path d="M16 15l-4 4-4-4" /></>}
    </svg>
  );
}

const border = "1px solid var(--border-default)";

/* ─── Rendu d'une cellule ─── */
function Cell({ col, row }: { col: Column; row: Record<string, any> }) {
  const v = row[col.key];
  const type = col.type || "text";
  if (type === "check") {
    const ok = isTruthyCheck(v);
    const versionLike = typeof v === "string" && /[0-9]/.test(v) && v.toLowerCase() !== "no";
    return (
      <span style={{ display: "inline-flex", flexDirection: "column", alignItems: "center", gap: 1 }}>
        {ok ? <IconCheck /> : <IconX />}
        {versionLike && <span style={{ fontSize: 9.5, color: "var(--text-dim)" }}>{v}</span>}
      </span>
    );
  }
  if (type === "badge") {
    const label = typeof v === "object" && v ? v.label : v;
    const color = typeof v === "object" && v && v.color ? v.color : badgeColor(String(label));
    return <span style={{ fontSize: 11, fontWeight: 600, color, background: `${color}22`, borderRadius: 6, padding: "2px 8px", display: "inline-block" }}>{String(label)}</span>;
  }
  if (type === "tags") {
    const arr: string[] = Array.isArray(v) ? v : String(v || "").split(",").map((s) => s.trim()).filter(Boolean);
    return (
      <span style={{ display: "inline-flex", flexWrap: "wrap", gap: 4 }}>
        {arr.map((t, i) => (
          <span key={i} style={{ fontSize: 10.5, fontWeight: 500, color: "var(--text-secondary)", background: "var(--surface-4)", border, borderRadius: 6, padding: "1px 7px" }}>{t}</span>
        ))}
      </span>
    );
  }
  if (type === "money") {
    const neg = isMoneyNegative(v);
    return <span style={{ fontFamily: "ui-monospace, monospace", fontSize: 12.5, color: neg ? "#EF4444" : "var(--text-primary)" }}>{String(v ?? "")}</span>;
  }
  if (type === "number") {
    return <span style={{ fontFamily: "ui-monospace, monospace", fontSize: 12.5, color: "var(--text-secondary)" }}>{String(v ?? "")}</span>;
  }
  if (type === "link") {
    const url = typeof v === "object" && v ? v.url : v;
    const label = typeof v === "object" && v ? v.label || v.url : v;
    return <a href={url} target="_blank" rel="noopener noreferrer" style={{ color: "var(--accent, #6C5BFF)", fontSize: 12.5, textDecoration: "none", fontWeight: 500 }}>{String(label)}</a>;
  }
  if (type === "actions") {
    return (
      <span style={{ display: "inline-flex", gap: 8, color: "var(--text-dim)" }}>
        <span style={{ cursor: "default" }} title="Edit"><IconPencil /></span>
        <span style={{ cursor: "default", color: "#EF4444" }} title="Delete"><IconTrash /></span>
      </span>
    );
  }
  // text (supporte **gras** / *italique*)
  return <span style={{ fontSize: 12.5, color: "var(--text-secondary)" }}>{renderRich(v)}</span>;
}

/* ─── Composant principal ─── */
export function TableView({ data }: { data: TableViewData }) {
  const variant = data.variant || "simple";
  if (variant === "editorial") return <EditorialTable data={data} />;
  const cols = data.columns || [];
  const allRows = data.rows || [];
  const searchable = data.searchable ?? (variant === "data" || variant === "tags");
  const sortable = data.sortable ?? (variant === "data" || variant === "tags");
  const pageSize = data.pageSize ?? (variant === "data" ? 8 : 0);

  const [query, setQuery] = useState("");
  const [sortKey, setSortKey] = useState<string | null>(null);
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");
  const [page, setPage] = useState(0);

  const filtered = useMemo(() => {
    let r = allRows;
    if (searchable && query.trim()) {
      const q = query.toLowerCase();
      r = r.filter((row) => cols.some((c) => String(row[c.key] ?? "").toLowerCase().includes(q)));
    }
    if (sortable && sortKey) {
      r = [...r].sort((a, b) => {
        const av = a[sortKey], bv = b[sortKey];
        const an = parseFloat(String(av).replace(/[^0-9.-]/g, ""));
        const bn = parseFloat(String(bv).replace(/[^0-9.-]/g, ""));
        let cmp: number;
        if (!isNaN(an) && !isNaN(bn)) cmp = an - bn;
        else cmp = String(av ?? "").localeCompare(String(bv ?? ""));
        return sortDir === "asc" ? cmp : -cmp;
      });
    }
    return r;
  }, [allRows, cols, query, sortKey, sortDir, searchable, sortable]);

  const totalPages = pageSize ? Math.max(1, Math.ceil(filtered.length / pageSize)) : 1;
  const pageRows = pageSize ? filtered.slice(page * pageSize, page * pageSize + pageSize) : filtered;

  function toggleSort(key: string) {
    if (!sortable) return;
    if (sortKey === key) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else { setSortKey(key); setSortDir("asc"); }
  }

  // Groupes (matrice) : construit une ligne d'en-tête supérieure.
  const groups = useMemo(() => {
    if (variant !== "matrix") return null;
    const g: { label: string; span: number }[] = [];
    for (const c of cols) {
      const label = c.group || "";
      const last = g[g.length - 1];
      if (last && last.label === label) last.span += 1;
      else g.push({ label, span: 1 });
    }
    return g.some((x) => x.label) ? g : null;
  }, [cols, variant]);

  const th: React.CSSProperties = { padding: "8px 12px", fontSize: 11, fontWeight: 600, color: "var(--text-dim)", textTransform: "uppercase", letterSpacing: 0.4, textAlign: "left", whiteSpace: "nowrap" };
  const td: React.CSSProperties = { padding: "9px 12px", borderTop: border, verticalAlign: "middle" };

  return (
    <div className="page-preview-enter" style={{ marginTop: 10, borderRadius: 14, border, background: "var(--surface-2, var(--surface-3))", overflow: "hidden", maxWidth: 620 }}>
      {/* Titre + recherche */}
      {(data.title || data.subtitle || searchable) && (
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, padding: "12px 14px", borderBottom: border, flexWrap: "wrap" }}>
          <div>
            {data.title && <div style={{ fontSize: 14, fontWeight: 600, color: "var(--text-primary)" }}>{data.title}</div>}
            {data.subtitle && <div style={{ fontSize: 12, color: "var(--text-dim)", marginTop: 1 }}>{data.subtitle}</div>}
          </div>
          {searchable && (
            <input
              value={query}
              onChange={(e) => { setQuery(e.target.value); setPage(0); }}
              placeholder="Search…"
              style={{ fontSize: 12.5, padding: "6px 10px", borderRadius: 8, border, background: "var(--surface-4)", color: "var(--text-primary)", outline: "none", minWidth: 150 }}
            />
          )}
        </div>
      )}

      <div style={{ overflowX: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12.5 }}>
          <thead>
            {groups && (
              <tr>
                {variant === "grid" && <th style={{ ...th, width: 34 }} />}
                {groups.map((g, i) => (
                  <th key={i} colSpan={g.span} style={{ ...th, textAlign: "center", borderBottom: border, color: "var(--text-secondary)" }}>{g.label}</th>
                ))}
              </tr>
            )}
            <tr>
              {variant === "grid" && <th style={{ ...th, width: 34, textAlign: "center", borderRight: border }}>#</th>}
              {cols.map((c) => (
                <th
                  key={c.key}
                  onClick={() => toggleSort(c.key)}
                  style={{ ...th, textAlign: c.align || (c.type === "money" || c.type === "number" ? "right" : c.type === "check" || c.type === "actions" ? "center" : "left"), cursor: sortable ? "pointer" : "default", borderBottom: border, borderRight: variant === "bordered" ? border : undefined, userSelect: "none" }}
                >
                  <span style={{ display: "inline-flex", alignItems: "center", gap: 4, justifyContent: c.align === "right" ? "flex-end" : c.align === "center" ? "center" : "flex-start" }}>
                    {c.label}
                    {sortable && <IconSort dir={sortKey === c.key ? sortDir : null} />}
                  </span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {pageRows.length === 0 ? (
              <tr><td colSpan={cols.length + (variant === "grid" ? 1 : 0)} style={{ ...td, textAlign: "center", color: "var(--text-dim)", padding: "18px" }}>No data.</td></tr>
            ) : (
              pageRows.map((row, ri) => (
                <tr key={ri} style={{ background: variant !== "matrix" && ri % 2 === 1 ? "var(--surface-3, transparent)" : "transparent" }}>
                  {variant === "grid" && <td style={{ ...td, textAlign: "center", color: "var(--text-dim)", fontSize: 11, borderRight: border, fontFamily: "ui-monospace, monospace" }}>{page * (pageSize || 0) + ri + 1}</td>}
                  {cols.map((c, ci) => (
                    <td key={c.key} style={{ ...td, textAlign: c.align || (c.type === "money" || c.type === "number" ? "right" : c.type === "check" || c.type === "actions" ? "center" : "left"), borderRight: variant === "grid" || variant === "matrix" || variant === "bordered" ? border : undefined, ...(variant === "bordered" && ci === 0 ? { fontWeight: 700, color: "var(--text-primary)" } : {}) }}>
                      <Cell col={c} row={row} />
                    </td>
                  ))}
                </tr>
              ))
            )}
          </tbody>
          {data.footer && data.footer.length > 0 && (
            <tfoot>
              <tr style={{ background: "var(--surface-4)" }}>
                {variant === "grid" && <td style={{ ...td, borderTop: border }} />}
                {cols.map((c, i) => {
                  const f = data.footer!.find((x) => x.key === c.key);
                  return (
                    <td key={c.key} style={{ ...td, borderTop: border, textAlign: c.align || (c.type === "money" || c.type === "number" ? "right" : "left"), fontWeight: 700, color: "var(--text-primary)", fontSize: 12.5 }}>
                      {f ? (f.label ? `${f.label} ` : "") + (f.value ?? "") : (i === 0 && !data.footer!.some((x) => x.key === c.key) ? "" : "")}
                    </td>
                  );
                })}
              </tr>
            </tfoot>
          )}
        </table>
      </div>

      {/* Pagination */}
      {pageSize > 0 && totalPages > 1 && (
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "9px 14px", borderTop: border }}>
          <span style={{ fontSize: 11.5, color: "var(--text-dim)" }}>{filtered.length} row{filtered.length > 1 ? "s" : ""} · page {page + 1}/{totalPages}</span>
          <div style={{ display: "flex", gap: 6 }}>
            <button onClick={() => setPage((p) => Math.max(0, p - 1))} disabled={page === 0} style={pageBtn(page === 0)}>Previous</button>
            <button onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))} disabled={page >= totalPages - 1} style={pageBtn(page >= totalPages - 1)}>Next</button>
          </div>
        </div>
      )}
    </div>
  );
}

function pageBtn(disabled: boolean): React.CSSProperties {
  return {
    fontSize: 12,
    fontWeight: 600,
    padding: "5px 11px",
    borderRadius: 7,
    border,
    background: "var(--surface-4)",
    color: "var(--text-secondary)",
    cursor: disabled ? "not-allowed" : "pointer",
    opacity: disabled ? 0.5 : 1,
  };
}
