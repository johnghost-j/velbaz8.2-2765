import * as HoverCardPrimitive from '@radix-ui/react-hover-card';
import React, { useState } from 'react';
import { AnimatePresence, motion, useMotionValue, useSpring } from 'motion/react';

/**
 * ColorPreview — hover over a hex color code to see a swatch preview.
 * Shows the color as a large swatch + hex label + copied feedback.
 */
export function ColorPreview({ color, children }: { color: string; children: React.ReactNode }) {
  const [isOpen, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);

  const springConfig = { stiffness: 100, damping: 15 };
  const x = useMotionValue(0);
  const translateX = useSpring(x, springConfig);

  const handleMouseMove = (event: React.MouseEvent) => {
    const targetRect = (event.target as HTMLElement).getBoundingClientRect();
    const eventOffsetX = event.clientX - targetRect.left;
    const offsetFromCenter = (eventOffsetX - targetRect.width / 2) / 2;
    x.set(offsetFromCenter);
  };

  // Determine if color is light or dark for contrast text
  const hexToRgb = (hex: string) => {
    const h = hex.replace('#', '');
    return { r: parseInt(h.slice(0, 2), 16), g: parseInt(h.slice(2, 4), 16), b: parseInt(h.slice(4, 6), 16) };
  };
  const rgb = hexToRgb(color);
  const luminance = (0.299 * rgb.r + 0.587 * rgb.g + 0.114 * rgb.b) / 255;
  const textColor = luminance > 0.5 ? '#000' : '#fff';

  const handleClick = async () => {
    try {
      await navigator.clipboard.writeText(color);
      setCopied(true);
      setTimeout(() => setCopied(false), 1200);
    } catch {}
  };

  return (
    <HoverCardPrimitive.Root openDelay={50} closeDelay={100} onOpenChange={setOpen}>
      <HoverCardPrimitive.Trigger onMouseMove={handleMouseMove} asChild>
        <span
          onClick={handleClick}
          style={{
            cursor: 'pointer',
            fontWeight: 600,
            color: 'var(--text-secondary)',
            borderBottom: '2px solid ' + color,
            paddingBottom: 1,
            display: 'inline-flex',
            alignItems: 'center',
            gap: 4,
          }}
        >
          <span
            style={{
              display: 'inline-block',
              width: 10,
              height: 10,
              borderRadius: 3,
              backgroundColor: color,
              border: '1px solid rgba(128,128,128,0.3)',
              flexShrink: 0,
            }}
          />
          {children}
        </span>
      </HoverCardPrimitive.Trigger>

      <HoverCardPrimitive.Portal>
        <HoverCardPrimitive.Content
          side="top"
          align="center"
          sideOffset={10}
          style={{ transformOrigin: 'var(--radix-hover-card-content-transform-origin)', zIndex: 9999 }}
        >
          <AnimatePresence>
            {isOpen && (
              <motion.div
                initial={{ opacity: 0, y: 20, scale: 0.6 }}
                animate={{ opacity: 1, y: 0, scale: 1, transition: { type: 'spring', stiffness: 260, damping: 20 } }}
                exit={{ opacity: 0, y: 20, scale: 0.6 }}
                style={{ x: translateX, borderRadius: 12, overflow: 'hidden', boxShadow: '0 8px 30px rgba(0,0,0,0.35)' }}
              >
                <div
                  style={{
                    padding: 4,
                    background: 'var(--surface-3)',
                    border: '1px solid var(--border-default)',
                    borderRadius: 12,
                  }}
                >
                  {/* Main swatch */}
                  <div
                    style={{
                      width: 140,
                      height: 80,
                      borderRadius: 8,
                      backgroundColor: color,
                      display: 'flex',
                      flexDirection: 'column',
                      alignItems: 'center',
                      justifyContent: 'center',
                      gap: 4,
                    }}
                  >
                    <span style={{ fontSize: 14, fontWeight: 700, color: textColor, fontFamily: 'monospace' }}>
                      {color.toUpperCase()}
                    </span>
                    <span style={{ fontSize: 10, color: textColor, opacity: 0.7 }}>
                      {copied ? '✓ Copied!' : `rgb(${rgb.r}, ${rgb.g}, ${rgb.b})`}
                    </span>
                  </div>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </HoverCardPrimitive.Content>
      </HoverCardPrimitive.Portal>
    </HoverCardPrimitive.Root>
  );
}

/**
 * ColorPalettePreview — hover over a group of colors to see them together.
 * Used when multiple hex codes appear close together (e.g. "Primary: #C4704B, Accent: #87A878")
 */
export function ColorPalettePreview({ colors, children }: { colors: string[]; children: React.ReactNode }) {
  const [isOpen, setOpen] = useState(false);

  const springConfig = { stiffness: 100, damping: 15 };
  const x = useMotionValue(0);
  const translateX = useSpring(x, springConfig);

  const handleMouseMove = (event: React.MouseEvent) => {
    const targetRect = (event.target as HTMLElement).getBoundingClientRect();
    const eventOffsetX = event.clientX - targetRect.left;
    const offsetFromCenter = (eventOffsetX - targetRect.width / 2) / 2;
    x.set(offsetFromCenter);
  };

  return (
    <HoverCardPrimitive.Root openDelay={50} closeDelay={100} onOpenChange={setOpen}>
      <HoverCardPrimitive.Trigger onMouseMove={handleMouseMove} asChild>
        <span style={{ cursor: 'pointer' }}>{children}</span>
      </HoverCardPrimitive.Trigger>

      <HoverCardPrimitive.Portal>
        <HoverCardPrimitive.Content
          side="top"
          align="center"
          sideOffset={10}
          style={{ transformOrigin: 'var(--radix-hover-card-content-transform-origin)', zIndex: 9999 }}
        >
          <AnimatePresence>
            {isOpen && (
              <motion.div
                initial={{ opacity: 0, y: 20, scale: 0.6 }}
                animate={{ opacity: 1, y: 0, scale: 1, transition: { type: 'spring', stiffness: 260, damping: 20 } }}
                exit={{ opacity: 0, y: 20, scale: 0.6 }}
                style={{ x: translateX, borderRadius: 12, overflow: 'hidden', boxShadow: '0 8px 30px rgba(0,0,0,0.35)' }}
              >
                <div
                  style={{
                    padding: 4,
                    background: 'var(--surface-3)',
                    border: '1px solid var(--border-default)',
                    borderRadius: 12,
                    display: 'flex',
                    gap: 0,
                    overflow: 'hidden',
                  }}
                >
                  {colors.map((c, i) => {
                    const h = c.replace('#', '');
                    const rgb = { r: parseInt(h.slice(0, 2), 16), g: parseInt(h.slice(2, 4), 16), b: parseInt(h.slice(4, 6), 16) };
                    const lum = (0.299 * rgb.r + 0.587 * rgb.g + 0.114 * rgb.b) / 255;
                    const tc = lum > 0.5 ? '#000' : '#fff';
                    return (
                      <div
                        key={c + i}
                        style={{
                          width: 64,
                          height: 72,
                          backgroundColor: c,
                          display: 'flex',
                          flexDirection: 'column',
                          alignItems: 'center',
                          justifyContent: 'flex-end',
                          padding: '0 0 6px 0',
                          borderRadius: i === 0 ? '8px 0 0 8px' : i === colors.length - 1 ? '0 8px 8px 0' : 0,
                        }}
                      >
                        <span style={{ fontSize: 9, fontWeight: 700, color: tc, fontFamily: 'monospace', opacity: 0.9 }}>
                          {c.toUpperCase()}
                        </span>
                      </div>
                    );
                  })}
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </HoverCardPrimitive.Content>
      </HoverCardPrimitive.Portal>
    </HoverCardPrimitive.Root>
  );
}
