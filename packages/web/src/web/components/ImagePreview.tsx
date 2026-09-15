import * as HoverCardPrimitive from '@radix-ui/react-hover-card';
import React, { useState } from 'react';
import { AnimatePresence, motion, useMotionValue, useSpring } from 'motion/react';

/**
 * ImagePreview — hover over generated image references to see a preview.
 * Shows the image in a hover card with smooth spring animation.
 */
export function ImagePreview({
  src,
  alt,
  children,
  width = 240,
  height = 160,
}: {
  src: string;
  alt?: string;
  children: React.ReactNode;
  width?: number;
  height?: number;
}) {
  const [isOpen, setOpen] = useState(false);
  const [imgError, setImgError] = useState(false);
  const [isMounted, setIsMounted] = useState(false);

  React.useEffect(() => { setIsMounted(true); }, []);

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
    <>
      {/* Preload */}
      {isMounted && !imgError && (
        <div style={{ display: 'none' }}>
          <img src={src} alt="preload" onError={() => setImgError(true)} />
        </div>
      )}

      <HoverCardPrimitive.Root openDelay={50} closeDelay={100} onOpenChange={setOpen}>
        <HoverCardPrimitive.Trigger onMouseMove={handleMouseMove} asChild>
          <span
            style={{
              cursor: 'pointer',
              fontWeight: 600,
              color: 'var(--text-secondary)',
              borderBottom: '1px dashed var(--text-ghost)',
              paddingBottom: 1,
              display: 'inline-flex',
              alignItems: 'center',
              gap: 4,
            }}
          >
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
                    {!imgError ? (
                      <img
                        src={src}
                        alt={alt || 'preview'}
                        style={{
                          borderRadius: 8,
                          objectFit: 'cover',
                          width,
                          height,
                          display: 'block',
                        }}
                        onError={() => setImgError(true)}
                      />
                    ) : (
                      <div
                        style={{
                          width,
                          height,
                          borderRadius: 8,
                          background: 'var(--surface-2)',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          fontSize: 11,
                          color: 'var(--text-ghost)',
                        }}
                      >
                        Image unavailable
                      </div>
                    )}
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </HoverCardPrimitive.Content>
        </HoverCardPrimitive.Portal>
      </HoverCardPrimitive.Root>
    </>
  );
}
