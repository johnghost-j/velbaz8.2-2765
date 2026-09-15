"use client";

/* ─────────────────────────────────────────────────────────────────────────
 * RICH VIEW — bloc de texte richement formaté dans le chat.
 * L'IA émet [RICH_VIEW]{json}[/RICH_VIEW] pour structurer proprement
 * (titres, listes stylées, séparateurs, citations, paires clé/valeur).
 * ───────────────────────────────────────────────────────────────────────── */

type Block =
  | { type: "heading"; text: string; level?: 1 | 2 | 3 }
  | { type: "paragraph"; text: string }
  | { type: "list"; ordered?: boolean; items: string[] }
  | { type: "checklist"; items: { text: string; done?: boolean }[] }
  | { type: "quote"; text: string; author?: string }
  | { type: "divider" }
  | { type: "keyvalue"; pairs: { key: string; value: string }[] };

export interface RichViewData {
  accent?: string;
  blocks: Block[];
}

function inline(text: string, accent: string): React.ReactNode {
  // **gras** et `code`
  const parts = String(text).split(/(\*\*[^*]+\*\*|`[^`]+`)/g);
  return parts.map((p, i) => {
    if (p.startsWith("**") && p.endsWith("**")) return <strong key={i} style={{ fontWeight: 700, color: "var(--text-primary)" }}>{p.slice(2, -2)}</strong>;
    if (p.startsWith("`") && p.endsWith("`")) return <code key={i} style={{ fontFamily: "monospace", fontSize: "0.9em", background: "var(--surface-3)", padding: "1px 5px", borderRadius: 4, color: accent }}>{p.slice(1, -1)}</code>;
    return <span key={i}>{p}</span>;
  });
}

function CheckBox({ done, accent }: { done?: boolean; accent: string }) {
  return (
    <span style={{ flexShrink: 0, marginTop: 2, width: 16, height: 16, borderRadius: 4, border: `1.5px solid ${done ? accent : "var(--border-default)"}`, background: done ? accent : "transparent", color: "#fff", display: "inline-flex", alignItems: "center", justifyContent: "center" }}>
      {done && (
        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12l5 5l10 -10" /></svg>
      )}
    </span>
  );
}

export function RichView({ data }: { data: RichViewData }) {
  const blocks = Array.isArray(data.blocks) ? data.blocks : [];
  if (blocks.length === 0) return null;
  const accent = data.accent || "#6366F1";

  return (
    <div style={{ margin: "8px 0", border: "1px solid var(--border-default)", background: "var(--surface-2)", borderRadius: 12, padding: "14px 16px", display: "flex", flexDirection: "column", gap: 10 }}>
      {blocks.map((b, i) => {
        switch (b.type) {
          case "heading": {
            const lvl = b.level || 2;
            const sz = lvl === 1 ? 18 : lvl === 2 ? 15 : 13.5;
            return (
              <div key={i} style={{ display: "flex", alignItems: "center", gap: 8, marginTop: i === 0 ? 0 : 4 }}>
                <span style={{ width: 3, height: sz, borderRadius: 2, background: accent, flexShrink: 0 }} />
                <span style={{ fontSize: sz, fontWeight: 700, color: "var(--text-primary)" }}>{inline(b.text, accent)}</span>
              </div>
            );
          }
          case "paragraph":
            return <p key={i} style={{ margin: 0, fontSize: 13.5, lineHeight: 1.6, color: "var(--text-primary)" }}>{inline(b.text, accent)}</p>;
          case "list":
            return (
              <ol key={i} style={{ margin: 0, paddingLeft: 0, listStyle: "none", display: "flex", flexDirection: "column", gap: 5 }}>
                {(b.items || []).map((it, j) => (
                  <li key={j} style={{ display: "flex", gap: 9, fontSize: 13.5, lineHeight: 1.5, color: "var(--text-primary)" }}>
                    <span style={{ flexShrink: 0, color: accent, fontWeight: 700, minWidth: b.ordered ? 16 : "auto" }}>{b.ordered ? `${j + 1}.` : "•"}</span>
                    <span>{inline(it, accent)}</span>
                  </li>
                ))}
              </ol>
            );
          case "checklist":
            return (
              <ul key={i} style={{ margin: 0, padding: 0, listStyle: "none", display: "flex", flexDirection: "column", gap: 6 }}>
                {(b.items || []).map((it, j) => (
                  <li key={j} style={{ display: "flex", gap: 9, fontSize: 13.5, lineHeight: 1.5, color: "var(--text-primary)" }}>
                    <CheckBox done={it.done} accent={accent} />
                    <span style={{ opacity: it.done ? 0.6 : 1, textDecoration: it.done ? "line-through" : "none" }}>{inline(it.text, accent)}</span>
                  </li>
                ))}
              </ul>
            );
          case "quote":
            return (
              <blockquote key={i} style={{ margin: 0, padding: "6px 0 6px 14px", borderLeft: `3px solid ${accent}`, fontStyle: "italic", fontSize: 13.5, color: "var(--text-secondary, var(--text-dim))" }}>
                {inline(b.text, accent)}
                {b.author && <div style={{ fontStyle: "normal", fontSize: 12, color: "var(--text-dim)", marginTop: 4 }}>— {b.author}</div>}
              </blockquote>
            );
          case "divider":
            return <div key={i} style={{ height: 1, background: "var(--border-default)", margin: "2px 0" }} />;
          case "keyvalue":
            return (
              <div key={i} style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                {(b.pairs || []).map((p, j) => (
                  <div key={j} style={{ display: "flex", justifyContent: "space-between", gap: 12, fontSize: 13, borderBottom: "1px dashed var(--border-default)", paddingBottom: 5 }}>
                    <span style={{ color: "var(--text-dim)" }}>{p.key}</span>
                    <span style={{ color: "var(--text-primary)", fontWeight: 500, textAlign: "right" }}>{inline(p.value, accent)}</span>
                  </div>
                ))}
              </div>
            );
          default:
            return null;
        }
      })}
    </div>
  );
}
