"use client";

/* ─────────────────────────────────────────────────────────────────────────
 * CONTACT VIEW — fiche coordonnées (client, agent, entreprise) dans le chat.
 * [CONTACT_VIEW]{json}[/CONTACT_VIEW] :
 * { "name":"Sarah Dupont", "role":"Agent d'appel IA", "company":"Velbaz",
 *   "avatar":"https://…", "phone":"+32…", "email":"…", "website":"…",
 *   "address":"…", "tags":["VIP"], "accent":"#6366F1" }
 *
 * Self-contained : carte à la charte, avatar/initiales, lignes cliquables
 * (tel:/mailto:/http), tags.
 * ───────────────────────────────────────────────────────────────────────── */

export interface ContactViewData {
  name: string;
  role?: string;
  company?: string;
  avatar?: string;
  phone?: string;
  email?: string;
  website?: string;
  address?: string;
  tags?: string[];
  accent?: string;
}

const IconPhone = () => (
  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3 19.5 19.5 0 0 1-6-6 19.8 19.8 0 0 1-3-8.6A2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.1 1 .4 1.9.7 2.8a2 2 0 0 1-.5 2.1L8.1 9.9a16 16 0 0 0 6 6l1.3-1.3a2 2 0 0 1 2.1-.5c.9.3 1.8.6 2.8.7a2 2 0 0 1 1.7 2z" /></svg>
);
const IconMail = () => (
  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="2" y="4" width="20" height="16" rx="2" /><path d="m22 7-10 6L2 7" /></svg>
);
const IconGlobe = () => (
  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10" /><path d="M2 12h20M12 2a15 15 0 0 1 0 20 15 15 0 0 1 0-20z" /></svg>
);
const IconPin = () => (
  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z" /><circle cx="12" cy="10" r="3" /></svg>
);

function Row({ icon, children, href }: { icon: React.ReactNode; children: React.ReactNode; href?: string }) {
  const inner = (
    <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "7px 0", color: "var(--text-secondary)", fontSize: 13.5 }}>
      <span style={{ color: "var(--text-dim)", flexShrink: 0, display: "inline-flex" }}>{icon}</span>
      <span style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{children}</span>
    </div>
  );
  if (!href) return inner;
  return <a href={href} target="_blank" rel="noopener noreferrer" style={{ textDecoration: "none", color: "inherit", display: "block" }}>{inner}</a>;
}

export function ContactView({ data }: { data: ContactViewData }) {
  const accent = data.accent || "var(--accent)";
  const initials = data.name.trim().split(/\s+/).slice(0, 2).map((w) => w.charAt(0).toUpperCase()).join("");
  let siteHost = data.website || "";
  try { if (data.website) siteHost = new URL(data.website.startsWith("http") ? data.website : `https://${data.website}`).hostname.replace("www.", ""); } catch { /* keep raw */ }

  return (
    <div
      style={{
        border: "1px solid var(--border-default)",
        background: "var(--surface-2)",
        borderRadius: 16,
        overflow: "hidden",
        margin: "8px 0",
        maxWidth: 380,
      }}
    >
      <div style={{ height: 44, background: `linear-gradient(90deg, ${accent}, transparent)`, opacity: 0.35 }} />
      <div style={{ padding: "0 16px 16px", marginTop: -22 }}>
        <div style={{ display: "flex", alignItems: "flex-end", gap: 12, marginBottom: 10 }}>
          {data.avatar ? (
            <img src={data.avatar} alt="" style={{ width: 56, height: 56, borderRadius: 14, objectFit: "cover", border: "3px solid var(--surface-2)", flexShrink: 0 }} />
          ) : (
            <span style={{ width: 56, height: 56, borderRadius: 14, background: accent, color: "#fff", display: "inline-flex", alignItems: "center", justifyContent: "center", fontWeight: 700, fontSize: 20, border: "3px solid var(--surface-2)", flexShrink: 0 }}>{initials}</span>
          )}
          <div style={{ minWidth: 0, paddingBottom: 2 }}>
            <div style={{ fontSize: 16, fontWeight: 700, color: "var(--text-primary)" }}>{data.name}</div>
            {(data.role || data.company) && (
              <div style={{ fontSize: 12.5, color: "var(--text-dim)" }}>
                {data.role}{data.role && data.company ? " · " : ""}{data.company}
              </div>
            )}
          </div>
        </div>

        {data.tags && data.tags.length > 0 && (
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 6 }}>
            {data.tags.map((t, i) => (
              <span key={i} style={{ fontSize: 11, fontWeight: 600, color: accent, background: "var(--surface-4)", borderRadius: 999, padding: "2px 9px" }}>{t}</span>
            ))}
          </div>
        )}

        <div style={{ borderTop: "1px solid var(--border-default)", marginTop: 4 }}>
          {data.phone && <Row icon={<IconPhone />} href={`tel:${data.phone.replace(/\s/g, "")}`}>{data.phone}</Row>}
          {data.email && <Row icon={<IconMail />} href={`mailto:${data.email}`}>{data.email}</Row>}
          {data.website && <Row icon={<IconGlobe />} href={data.website.startsWith("http") ? data.website : `https://${data.website}`}>{siteHost}</Row>}
          {data.address && <Row icon={<IconPin />} href={`https://www.openstreetmap.org/search?query=${encodeURIComponent(data.address)}`}>{data.address}</Row>}
        </div>
      </div>
    </div>
  );
}

export default ContactView;
