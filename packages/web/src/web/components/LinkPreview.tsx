import * as HoverCardPrimitive from '@radix-ui/react-hover-card';
import React from 'react';
import { AnimatePresence, motion, useMotionValue, useSpring } from 'motion/react';

type LinkPreviewProps = {
  children: React.ReactNode;
  url: string;
  className?: string;
  width?: number;
  height?: number;
  quality?: number;
} & (
  | { isStatic: true; imageSrc: string }
  | { isStatic?: false; imageSrc?: never }
);

export function LinkPreview({
  children,
  url,
  className,
  width = 200,
  height = 125,
  quality = 50,
  isStatic = false,
  imageSrc = '',
}: LinkPreviewProps) {
  // Extract URL parts for smart preview
  let domain = '';
  let pathname = '/';
  try {
    const parsed = new URL(url);
    domain = parsed.hostname.replace('www.', '');
    pathname = parsed.pathname;
  } catch {
    domain = url;
  }

  // Build a unique Microlink screenshot URL per link
  // Include a hash of the full URL to bust any browser-level caching
  const microlinkSrc = `https://api.microlink.io/?url=${encodeURIComponent(url)}&screenshot=true&meta=false&embed=screenshot.url&colorScheme=dark&viewport.isMobile=true&viewport.deviceScaleFactor=1&viewport.width=${width * 3}&viewport.height=${height * 3}`;

  const [isOpen, setOpen] = React.useState(false);
  const [imgLoaded, setImgLoaded] = React.useState(false);
  const [imgError, setImgError] = React.useState(false);
  // Track if we've ever been hovered — only start loading image on first hover
  const [hasHovered, setHasHovered] = React.useState(false);

  const springConfig = { stiffness: 100, damping: 15 };
  const x = useMotionValue(0);
  const translateX = useSpring(x, springConfig);

  const handleMouseMove = (event: React.MouseEvent) => {
    const targetRect = (event.target as HTMLElement).getBoundingClientRect();
    const eventOffsetX = event.clientX - targetRect.left;
    const offsetFromCenter = (eventOffsetX - targetRect.width / 2) / 2;
    x.set(offsetFromCenter);
  };

  // Pretty path display (e.g. "/about" → "About", "/contact-us" → "Contact Us")
  const prettyPath = pathname === '/' || pathname === ''
    ? ''
    : pathname.replace(/^\//, '').replace(/[-_]/g, ' ').replace(/\b\w/g, c => c.toUpperCase());

  // Determine the image source
  const imgSrc = isStatic ? imageSrc : microlinkSrc;

  // Rich fallback with domain + path + favicon
  const renderFallback = () => (
    <div style={{
      width,
      height,
      borderRadius: 8,
      background: 'var(--surface-2)',
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 6,
      padding: 12,
    }}>
      <img
        src={`https://www.google.com/s2/favicons?domain=${domain}&sz=32`}
        width={24}
        height={24}
        alt=""
        style={{ borderRadius: 4 }}
      />
      <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-primary)', textAlign: 'center', wordBreak: 'break-all' }}>
        {domain}
      </span>
      {prettyPath && (
        <span style={{ fontSize: 10, color: 'var(--text-muted)', textAlign: 'center', wordBreak: 'break-all' }}>
          /{pathname.replace(/^\//, '')}
        </span>
      )}
    </div>
  );

  // Loading skeleton
  const renderLoading = () => (
    <div style={{
      width,
      height,
      borderRadius: 8,
      background: 'var(--surface-2)',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
    }}>
      <div style={{
        width: 20, height: 20, borderRadius: '50%',
        border: '2px solid var(--text-ghost)',
        borderTopColor: 'var(--text-secondary)',
        animation: 'spin 0.8s linear infinite',
      }} />
    </div>
  );

  return (
    <HoverCardPrimitive.Root
      openDelay={50}
      closeDelay={100}
      onOpenChange={(open) => {
        setOpen(open);
        if (open && !hasHovered) {
          setHasHovered(true);
        }
      }}
    >
      <HoverCardPrimitive.Trigger
        onMouseMove={handleMouseMove}
        className={className}
        asChild
      >
        <a
          href={url}
          target="_blank"
          rel="noopener noreferrer"
          style={{ textDecoration: 'none', cursor: 'pointer' }}
        >
          {children}
        </a>
      </HoverCardPrimitive.Trigger>

      <HoverCardPrimitive.Portal>
        <HoverCardPrimitive.Content
          className="link-preview-content"
          side="top"
          align="center"
          sideOffset={10}
          style={{
            transformOrigin: 'var(--radix-hover-card-content-transform-origin)',
            zIndex: 9999,
          }}
        >
          <AnimatePresence>
            {isOpen && (
              <motion.div
                initial={{ opacity: 0, y: 20, scale: 0.6 }}
                animate={{
                  opacity: 1, y: 0, scale: 1,
                  transition: { type: 'spring', stiffness: 260, damping: 20 },
                }}
                exit={{ opacity: 0, y: 20, scale: 0.6 }}
                style={{ x: translateX, borderRadius: 12, overflow: 'hidden', boxShadow: '0 8px 30px rgba(0,0,0,0.35)' }}
              >
                <a
                  href={url}
                  target="_blank"
                  rel="noopener noreferrer"
                  style={{
                    display: 'block',
                    padding: 4,
                    background: 'var(--surface-3)',
                    border: '1px solid var(--border-default)',
                    borderRadius: 12,
                    textDecoration: 'none',
                    fontSize: 0,
                  }}
                >
                  {imgError ? (
                    renderFallback()
                  ) : !hasHovered || !imgLoaded ? (
                    <>
                      {renderLoading()}
                      {/* Hidden img to trigger load — only starts when hovered */}
                      {hasHovered && (
                        <img
                          src={imgSrc}
                          width={1}
                          height={1}
                          alt=""
                          style={{ position: 'absolute', opacity: 0, pointerEvents: 'none' }}
                          onLoad={() => setImgLoaded(true)}
                          onError={() => setImgError(true)}
                        />
                      )}
                    </>
                  ) : (
                    <img
                      src={imgSrc}
                      width={width}
                      height={height}
                      alt="preview"
                      style={{ borderRadius: 8, objectFit: 'cover', width, height }}
                      onError={() => setImgError(true)}
                    />
                  )}
                </a>
              </motion.div>
            )}
          </AnimatePresence>
        </HoverCardPrimitive.Content>
      </HoverCardPrimitive.Portal>
    </HoverCardPrimitive.Root>
  );
}
