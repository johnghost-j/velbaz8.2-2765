"use client";

/* ─────────────────────────────────────────────────────────────────────────
 * SOCIAL PREVIEW — maquette de post réseaux sociaux dans le chat.
 * [SOCIAL_VIEW]{json}[/SOCIAL_VIEW] :
 * { "platform":"instagram|linkedin|facebook|twitter|tiktok",
 *   "author":"My Brand", "handle":"@mamarque", "avatar":"https://…",
 *   "image":"https://…", "caption":"Texte du post…",
 *   "hashtags":["#bio","#local"], "likes":128, "comments":14 }
 *
 * Self-contained : maquette à la charte, header (avatar+nom), média,
 * légende + hashtags, barre d'actions selon la plateforme.
 * ───────────────────────────────────────────────────────────────────────── */

export interface SocialViewData {
  platform?: "instagram" | "linkedin" | "facebook" | "twitter" | "tiktok";
  author?: string;
  handle?: string;
  avatar?: string;
  image?: string;
  caption?: string;
  hashtags?: string[];
  likes?: number;
  comments?: number;
}

const PLATFORM: Record<string, { label: string; color: string }> = {
  instagram: { label: "Instagram", color: "#E1306C" },
  linkedin: { label: "LinkedIn", color: "#0A66C2" },
  facebook: { label: "Facebook", color: "#1877F2" },
  twitter: { label: "X", color: "#111111" },
  tiktok: { label: "TikTok", color: "#000000" },
};

const IconHeart = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.7l-1-1.1a5.5 5.5 0 0 0-7.8 7.8l1.1 1L12 21l7.7-7.6 1.1-1a5.5 5.5 0 0 0 0-7.8z" /></svg>
);
const IconComment = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 11.5a8.38 8.38 0 0 1-8.5 8.5 8.5 8.5 0 0 1-3.9-.9L3 21l1.9-5.6a8.5 8.5 0 0 1-.9-3.9A8.38 8.38 0 0 1 12.5 3 8.5 8.5 0 0 1 21 11.5z" /></svg>
);
const IconShare = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8M16 6l-4-4-4 4M12 2v13" /></svg>
);

export function SocialPreview({ data }: { data: SocialViewData }) {
  const p = PLATFORM[data.platform || "instagram"] || PLATFORM.instagram;
  const initials = (data.author || "M").trim().charAt(0).toUpperCase();

  return (
    <div
      style={{
        border: "1px solid var(--border-default)",
        background: "var(--surface-2)",
        borderRadius: 14,
        overflow: "hidden",
        margin: "8px 0",
        maxWidth: 400,
      }}
    >
      {/* Header */}
      <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 12px" }}>
        {data.avatar ? (
          <img src={data.avatar} alt="" style={{ width: 36, height: 36, borderRadius: "50%", objectFit: "cover", flexShrink: 0 }} />
        ) : (
          <span style={{ width: 36, height: 36, borderRadius: "50%", background: p.color, color: "#fff", display: "inline-flex", alignItems: "center", justifyContent: "center", fontWeight: 700, flexShrink: 0 }}>{initials}</span>
        )}
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 13, fontWeight: 600, color: "var(--text-primary)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{data.author || "My Brand"}</div>
          {data.handle && <div style={{ fontSize: 11, color: "var(--text-dim)" }}>{data.handle}</div>}
        </div>
        <span style={{ fontSize: 11, fontWeight: 600, color: p.color, flexShrink: 0 }}>{p.label}</span>
      </div>

      {/* Media */}
      {data.image && (
        <div style={{ width: "100%", background: "var(--surface-3)" }}>
          <img src={data.image} alt="" style={{ width: "100%", display: "block", maxHeight: 400, objectFit: "cover" }} />
        </div>
      )}

      {/* Actions */}
      <div style={{ display: "flex", alignItems: "center", gap: 16, padding: "10px 12px 6px", color: "var(--text-secondary)" }}>
        <span style={{ display: "inline-flex", alignItems: "center", gap: 5, fontSize: 13 }}><IconHeart />{typeof data.likes === "number" ? data.likes : ""}</span>
        <span style={{ display: "inline-flex", alignItems: "center", gap: 5, fontSize: 13 }}><IconComment />{typeof data.comments === "number" ? data.comments : ""}</span>
        <span style={{ display: "inline-flex", alignItems: "center", marginLeft: "auto" }}><IconShare /></span>
      </div>

      {/* Caption */}
      {(data.caption || (data.hashtags && data.hashtags.length > 0)) && (
        <div style={{ padding: "0 12px 14px" }}>
          {data.caption && (
            <div style={{ fontSize: 13.5, lineHeight: 1.5, color: "var(--text-secondary)", whiteSpace: "pre-wrap" }}>
              {data.author && <strong style={{ color: "var(--text-primary)", marginRight: 6 }}>{data.author}</strong>}
              {data.caption}
            </div>
          )}
          {data.hashtags && data.hashtags.length > 0 && (
            <div style={{ marginTop: 6, display: "flex", flexWrap: "wrap", gap: 6 }}>
              {data.hashtags.map((h, i) => (
                <span key={i} style={{ fontSize: 12.5, color: p.color, fontWeight: 500 }}>{h.startsWith("#") ? h : `#${h}`}</span>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default SocialPreview;
