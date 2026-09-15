"use client";

/* ─────────────────────────────────────────────────────────────────────────
 * ALERT VIEW — encadrés d'alerte / info / conseil / succès dans le chat.
 * L'IA émet [ALERT_VIEW]{json}[/ALERT_VIEW].
 * ───────────────────────────────────────────────────────────────────────── */

export interface AlertViewData {
  kind?: "info" | "tip" | "success" | "warning" | "danger";
  title?: string;
  message: string;
  items?: string[]; // liste optionnelle sous le message
}

const STYLES: Record<string, { color: string; label: string; icon: React.ReactNode }> = {
  info: {
    color: "#3B82F6", label: "Info",
    icon: <><circle cx="12" cy="12" r="10" /><path d="M12 16v-4M12 8h.01" /></>,
  },
  tip: {
    color: "#8B5CF6", label: "Tip",
    icon: <><path d="M9 18h6M10 22h4M12 2a7 7 0 0 0-4 12.7c.6.5 1 1.3 1 2.1V17h6v-.2c0-.8.4-1.6 1-2.1A7 7 0 0 0 12 2z" /></>,
  },
  success: {
    color: "#10B981", label: "Success",
    icon: <><circle cx="12" cy="12" r="10" /><path d="M8 12l3 3 5-6" /></>,
  },
  warning: {
    color: "#F59E0B", label: "Warning",
    icon: <><path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z" /><path d="M12 9v4M12 17h.01" /></>,
  },
  danger: {
    color: "#EF4444", label: "Alert",
    icon: <><circle cx="12" cy="12" r="10" /><path d="M12 8v4M12 16h.01" /></>,
  },
};

export function AlertView({ data }: { data: AlertViewData }) {
  if (!data || !data.message) return null;
  const kind = data.kind && STYLES[data.kind] ? data.kind : "info";
  const s = STYLES[kind];
  return (
    <div
      style={{
        margin: "8px 0", display: "flex", gap: 12, padding: "12px 14px",
        borderRadius: 12, border: `1px solid ${s.color}44`,
        background: `${s.color}12`, borderLeft: `3px solid ${s.color}`,
      }}
    >
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke={s.color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0, marginTop: 1 }}>
        {s.icon}
      </svg>
      <div style={{ minWidth: 0 }}>
        <div style={{ fontSize: 13, fontWeight: 600, color: s.color, marginBottom: data.title ? 3 : 0 }}>
          {data.title || s.label}
        </div>
        <div style={{ fontSize: 13, color: "var(--text-primary)", lineHeight: 1.5 }}>{data.message}</div>
        {data.items && data.items.length > 0 && (
          <ul style={{ margin: "8px 0 0", padding: 0, listStyle: "none", display: "flex", flexDirection: "column", gap: 4 }}>
            {data.items.map((it, i) => (
              <li key={i} style={{ display: "flex", gap: 8, fontSize: 12.5, color: "var(--text-secondary, var(--text-dim))" }}>
                <span style={{ color: s.color, flexShrink: 0 }}>•</span>
                <span>{it}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
