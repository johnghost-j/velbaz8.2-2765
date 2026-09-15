"use client";

import { motion, useMotionValue, useSpring, useTransform } from "motion/react";

/* ─────────────────────────────────────────────────────────────────────────
 * CARD VIEW — cartes visuelles (client, produit, idée…) dans le chat.
 * L'IA émet [CARD_VIEW]{json}[/CARD_VIEW] avec les VRAIES données.
 * Effet 3D parallax au survol (motion/react). Self-contained + CSS vars.
 * ───────────────────────────────────────────────────────────────────────── */

interface CardBadge { label: string; color?: string }
interface CardField { label: string; value: string }
interface CardItem {
  title: string;
  subtitle?: string;
  image?: string; // url image (produit / avatar)
  emoji?: string; // alternative visuelle si pas d'image
  price?: string; // ex "29,99 €"
  badge?: CardBadge | string;
  fields?: CardField[]; // paires clé/valeur
  tags?: string[];
  accent?: string;
}
export interface CardViewData {
  variant?: "product" | "client" | "idea" | "generic";
  title?: string;
  cards: CardItem[];
}

function badgeOf(b?: CardBadge | string) {
  if (!b) return null;
  if (typeof b === "string") return { label: b, color: "#6366F1" };
  return { label: b.label, color: b.color || "#6366F1" };
}

function ParallaxCard({ card, variant }: { card: CardItem; variant: string }) {
  const x = useMotionValue(0);
  const y = useMotionValue(0);
  const xs = useSpring(x, { stiffness: 300, damping: 30 });
  const ys = useSpring(y, { stiffness: 300, damping: 30 });
  const rotateX = useTransform(ys, [-0.5, 0.5], ["9deg", "-9deg"]);
  const rotateY = useTransform(xs, [-0.5, 0.5], ["-9deg", "9deg"]);
  const zTop = useTransform(ys, [-0.5, 0.5], [18, -18]);

  const onMove = (e: React.MouseEvent<HTMLDivElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    x.set((e.clientX - r.left) / r.width - 0.5);
    y.set((e.clientY - r.top) / r.height - 0.5);
  };
  const onLeave = () => { x.set(0); y.set(0); };

  const accent = card.accent || "#6366F1";
  const badge = badgeOf(card.badge);

  return (
    <motion.div
      onMouseMove={onMove}
      onMouseLeave={onLeave}
      style={{ rotateX, rotateY, transformStyle: "preserve-3d", perspective: 800 }}
      className="velbaz-card"
    >
      <div
        style={{
          transform: "translateZ(20px)", transformStyle: "preserve-3d",
          border: "1px solid var(--border-default)", background: "var(--surface-2)",
          borderRadius: 14, padding: 14, height: "100%", display: "flex", flexDirection: "column", gap: 10,
        }}
      >
        {/* Visuel */}
        {(card.image || card.emoji) && (
          <motion.div style={{ translateY: zTop, transform: "translateZ(30px)" }}>
            {card.image ? (
              <img src={card.image} alt={card.title} style={{ width: "100%", height: variant === "client" ? 96 : 130, objectFit: "cover", borderRadius: 10, display: "block" }} />
            ) : (
              <div style={{ width: "100%", height: 96, borderRadius: 10, background: `${accent}1a`, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 40 }}>{card.emoji}</div>
            )}
          </motion.div>
        )}

        <motion.div style={{ transform: "translateZ(24px)" }}>
          <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 8 }}>
            <div style={{ minWidth: 0 }}>
              <div style={{ fontSize: 14, fontWeight: 600, color: "var(--text-primary)" }}>{card.title}</div>
              {card.subtitle && <div style={{ fontSize: 12, color: "var(--text-dim)", marginTop: 2 }}>{card.subtitle}</div>}
            </div>
            {badge && (
              <span style={{ flexShrink: 0, fontSize: 10, fontWeight: 600, padding: "3px 8px", borderRadius: 999, color: badge.color, background: `${badge.color}1f` }}>{badge.label}</span>
            )}
          </div>

          {card.price && <div style={{ fontSize: 18, fontWeight: 700, color: accent, marginTop: 8 }}>{card.price}</div>}

          {card.fields && card.fields.length > 0 && (
            <div style={{ marginTop: 10, display: "flex", flexDirection: "column", gap: 5 }}>
              {card.fields.map((f, i) => (
                <div key={i} style={{ display: "flex", justifyContent: "space-between", gap: 10, fontSize: 12 }}>
                  <span style={{ color: "var(--text-dim)" }}>{f.label}</span>
                  <span style={{ color: "var(--text-primary)", fontWeight: 500, textAlign: "right" }}>{f.value}</span>
                </div>
              ))}
            </div>
          )}

          {card.tags && card.tags.length > 0 && (
            <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 10 }}>
              {card.tags.map((t, i) => (
                <span key={i} style={{ fontSize: 10, padding: "2px 8px", borderRadius: 999, background: "var(--surface-3)", color: "var(--text-secondary, var(--text-dim))", border: "1px solid var(--border-default)" }}>{t}</span>
              ))}
            </div>
          )}
        </motion.div>
      </div>
    </motion.div>
  );
}

export function CardView({ data }: { data: CardViewData }) {
  const cards = Array.isArray(data.cards) ? data.cards.filter((c) => c && c.title) : [];
  if (cards.length === 0) return null;
  const variant = data.variant || "generic";
  return (
    <div style={{ margin: "8px 0" }}>
      {data.title && <div style={{ fontSize: 14, fontWeight: 600, color: "var(--text-primary)", marginBottom: 8 }}>{data.title}</div>}
      <div style={{ display: "grid", gridTemplateColumns: `repeat(auto-fill, minmax(200px, 1fr))`, gap: 12 }}>
        {cards.map((c, i) => (
          <ParallaxCard key={i} card={c} variant={variant} />
        ))}
      </div>
    </div>
  );
}
