"use client";

/* ─────────────────────────────────────────────────────────────────────────
 * REVIEW VIEW — notes / étoiles / reviews clients dans le chat.
 * [REVIEW_VIEW]{json}[/REVIEW_VIEW] :
 * { "title":"Avis clients", "average":4.6, "max":5, "count":128,
 *   "distribution":[80,30,10,5,3],   // (optionnel) nb d'reviews pour 5★,4★,3★,2★,1★
 *   "reviews":[{"author":"Julie","rating":5,"text":"…","date":"12 mars",
 *               "avatar":"https://…","verified":true}] }
 *
 * Self-contained : synthèse (moyenne + étoiles + répartition) puis cartes d'reviews.
 * ───────────────────────────────────────────────────────────────────────── */

interface Review {
  author?: string;
  rating: number;
  text?: string;
  date?: string;
  avatar?: string;
  verified?: boolean;
}
export interface ReviewViewData {
  title?: string;
  average?: number;
  max?: number;
  count?: number;
  distribution?: number[]; // [5★,4★,3★,2★,1★]
  reviews?: Review[];
}

function Stars({ rating, max, size = 15 }: { rating: number; max: number; size?: number }) {
  return (
    <span style={{ display: "inline-flex", gap: 1 }}>
      {Array.from({ length: max }).map((_, i) => {
        const fill = Math.max(0, Math.min(1, rating - i)); // 0..1 for partial
        return (
          <span key={i} style={{ position: "relative", width: size, height: size, display: "inline-block" }}>
            <Star size={size} color="var(--border-default)" />
            <span style={{ position: "absolute", inset: 0, width: `${fill * 100}%`, overflow: "hidden" }}>
              <Star size={size} color="#F5A623" />
            </span>
          </span>
        );
      })}
    </span>
  );
}
function Star({ size, color }: { size: number; color: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill={color} style={{ display: "block" }}>
      <path d="M12 2l2.9 6.3 6.9.7-5.2 4.6 1.5 6.8L12 17.8 5.9 21.2l1.5-6.8L2.2 9l6.9-.7z" />
    </svg>
  );
}

export function ReviewView({ data }: { data: ReviewViewData }) {
  const max = data.max || 5;
  const reviews = data.reviews || [];
  const dist = data.distribution;
  const distTotal = dist ? dist.reduce((s, n) => s + n, 0) || 1 : 0;

  return (
    <div
      style={{
        border: "1px solid var(--border-default)",
        background: "var(--surface-2)",
        borderRadius: 16,
        overflow: "hidden",
        margin: "8px 0",
        maxWidth: 480,
      }}
    >
      {(typeof data.average === "number" || data.title) && (
        <div style={{ padding: "16px", borderBottom: reviews.length ? "1px solid var(--border-default)" : "none", display: "flex", gap: 18, alignItems: "center" }}>
          {typeof data.average === "number" && (
            <div style={{ textAlign: "center", flexShrink: 0 }}>
              <div style={{ fontSize: 34, fontWeight: 800, color: "var(--text-primary)", lineHeight: 1 }}>{data.average.toFixed(1)}</div>
              <div style={{ margin: "6px 0 2px" }}><Stars rating={data.average} max={max} size={14} /></div>
              {typeof data.count === "number" && <div style={{ fontSize: 11.5, color: "var(--text-dim)" }}>{data.count} reviews</div>}
            </div>
          )}
          <div style={{ flex: 1, minWidth: 0 }}>
            {data.title && <div style={{ fontSize: 14, fontWeight: 600, color: "var(--text-primary)", marginBottom: dist ? 8 : 0 }}>{data.title}</div>}
            {dist && dist.map((n, i) => {
              const stars = max - i;
              return (
                <div key={i} style={{ display: "flex", alignItems: "center", gap: 8, margin: "2px 0" }}>
                  <span style={{ fontSize: 11, color: "var(--text-dim)", width: 24, textAlign: "right" }}>{stars}★</span>
                  <div style={{ flex: 1, height: 6, borderRadius: 999, background: "var(--surface-4)", overflow: "hidden" }}>
                    <div style={{ width: `${(n / distTotal) * 100}%`, height: "100%", background: "#F5A623", borderRadius: 999 }} />
                  </div>
                  <span style={{ fontSize: 11, color: "var(--text-ghost)", width: 30 }}>{n}</span>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {reviews.length > 0 && (
        <div style={{ display: "flex", flexDirection: "column" }}>
          {reviews.map((r, i) => {
            const initials = (r.author || "?").trim().charAt(0).toUpperCase();
            return (
              <div key={i} style={{ padding: "14px 16px", borderBottom: i < reviews.length - 1 ? "1px solid var(--border-default)" : "none" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 6 }}>
                  {r.avatar ? (
                    <img src={r.avatar} alt="" style={{ width: 32, height: 32, borderRadius: "50%", objectFit: "cover", flexShrink: 0 }} />
                  ) : (
                    <span style={{ width: 32, height: 32, borderRadius: "50%", background: "var(--surface-4)", color: "var(--text-secondary)", display: "inline-flex", alignItems: "center", justifyContent: "center", fontWeight: 700, fontSize: 13, flexShrink: 0 }}>{initials}</span>
                  )}
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                      <span style={{ fontSize: 13, fontWeight: 600, color: "var(--text-primary)" }}>{r.author || "Customer"}</span>
                      {r.verified && <span style={{ fontSize: 10, color: "#10B981", fontWeight: 600 }}>✓ verified</span>}
                    </div>
                    <div style={{ marginTop: 2 }}><Stars rating={r.rating} max={max} size={12} /></div>
                  </div>
                  {r.date && <span style={{ fontSize: 11, color: "var(--text-ghost)", flexShrink: 0 }}>{r.date}</span>}
                </div>
                {r.text && <div style={{ fontSize: 13.5, lineHeight: 1.5, color: "var(--text-secondary)", whiteSpace: "pre-wrap" }}>{r.text}</div>}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

export default ReviewView;
