"use client";

/* ─────────────────────────────────────────────────────────────────────────
 * MESSAGE PREVIEW — maquette d'email ou de SMS affichée dans le chat.
 * [MESSAGE_VIEW]{json}[/MESSAGE_VIEW] :
 *  Email :
 *   { "channel":"email", "from":"Sarah — Velbaz <sarah@…>", "to":"client@…",
 *     "subject":"…", "body":"Bonjour…\n\n…", "cta":{"label":"Voir l'offre","url":"…"} }
 *  SMS :
 *   { "channel":"sms", "from":"Velbaz", "to":"+32…", "body":"…" }
 *
 * Self-contained : maquette à la charte (entête expéditeur/objet + corps).
 * ───────────────────────────────────────────────────────────────────────── */

interface CTA { label: string; url?: string }
export interface MessageViewData {
  channel?: "email" | "sms";
  from?: string;
  to?: string;
  subject?: string;
  body: string;
  cta?: CTA;
  time?: string;
}

const IconMail = () => (
  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <rect x="2" y="4" width="20" height="16" rx="2" /><path d="m22 7-10 6L2 7" />
  </svg>
);
const IconChat = () => (
  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M21 11.5a8.38 8.38 0 0 1-8.5 8.5 8.5 8.5 0 0 1-3.9-.9L3 21l1.9-5.6a8.5 8.5 0 0 1-.9-3.9A8.38 8.38 0 0 1 12.5 3 8.5 8.5 0 0 1 21 11.5z" />
  </svg>
);

function paragraphs(body: string) {
  return body.split(/\n{2,}/).map((p) => p.trim()).filter(Boolean);
}

export function MessagePreview({ data }: { data: MessageViewData }) {
  const isSms = data.channel === "sms";

  if (isSms) {
    return (
      <div style={{ margin: "8px 0", maxWidth: 360 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 7, marginBottom: 6, color: "var(--text-dim)", fontSize: 12 }}>
          <IconChat /> SMS {data.to ? `· ${data.to}` : ""}
        </div>
        <div
          style={{
            background: "var(--accent)", color: "#fff",
            padding: "10px 14px", borderRadius: "16px 16px 16px 4px",
            fontSize: 14, lineHeight: 1.45, whiteSpace: "pre-wrap", maxWidth: 300,
          }}
        >
          {data.body}
        </div>
        {data.from && <div style={{ fontSize: 11, color: "var(--text-ghost)", marginTop: 4 }}>From: {data.from}</div>}
      </div>
    );
  }

  return (
    <div
      style={{
        border: "1px solid var(--border-default)",
        background: "var(--surface-2)",
        borderRadius: 14,
        overflow: "hidden",
        margin: "8px 0",
        maxWidth: 480,
      }}
    >
      <div style={{ padding: "12px 16px", borderBottom: "1px solid var(--border-default)", background: "var(--surface-3)" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 7, color: "var(--text-dim)", fontSize: 11, marginBottom: 6, textTransform: "uppercase", letterSpacing: 0.4 }}>
          <IconMail /> Email
        </div>
        {data.subject && (
          <div style={{ fontSize: 15, fontWeight: 700, color: "var(--text-primary)", marginBottom: 4 }}>{data.subject}</div>
        )}
        <div style={{ fontSize: 12, color: "var(--text-secondary)" }}>
          {data.from && <span><strong style={{ color: "var(--text-primary)" }}>From:</strong> {data.from}</span>}
          {data.from && data.to && <span style={{ margin: "0 8px", color: "var(--text-ghost)" }}>·</span>}
          {data.to && <span><strong style={{ color: "var(--text-primary)" }}>To:</strong> {data.to}</span>}
        </div>
      </div>
      <div style={{ padding: "16px" }}>
        {paragraphs(data.body).map((p, i) => (
          <p key={i} style={{ margin: i === 0 ? "0 0 10px" : "0 0 10px", fontSize: 14, lineHeight: 1.55, color: "var(--text-secondary)", whiteSpace: "pre-wrap" }}>
            {p}
          </p>
        ))}
        {data.cta && (
          <a
            href={data.cta.url || "#"}
            target="_blank"
            rel="noopener noreferrer"
            style={{
              display: "inline-block", marginTop: 6,
              padding: "9px 20px", borderRadius: 8,
              background: "var(--accent)", color: "#fff",
              textDecoration: "none", fontSize: 14, fontWeight: 600,
            }}
          >
            {data.cta.label}
          </a>
        )}
      </div>
    </div>
  );
}

export default MessagePreview;
