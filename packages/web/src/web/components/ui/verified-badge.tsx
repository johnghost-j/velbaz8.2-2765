/**
 * Pastille « Verified » à poser sur un rond de profil.
 * Rendu identique au badge shadcn/originui : contour festonné (couleur du fond),
 * disque plein (couleur d'accent) et coche évidée.
 *
 * Usage :
 *   <div className="relative shrink-0">
 *     <div className="w-14 h-14 rounded-full …">A</div>
 *     <span className="absolute -top-1 -end-1"><VerifiedBadge /></span>
 *   </div>
 */
export function VerifiedBadge({
  size = 20,
  ringColor = 'var(--surface-1)',
  color = 'var(--teal)',
  className,
}: {
  size?: number;
  /** Couleur du contour festonné + de la coche : doit matcher le fond derrière le badge. */
  ringColor?: string;
  /** Couleur du disque. */
  color?: string;
  className?: string;
}) {
  return (
    <span className={className} aria-hidden={false}>
      <svg
        width={size}
        height={size}
        viewBox="0 0 24 24"
        xmlns="http://www.w3.org/2000/svg"
        style={{ display: 'block' }}
        role="img"
        aria-label="Verified"
      >
        <path
          d="M3.046 8.277A4.402 4.402 0 0 1 8.303 3.03a4.4 4.4 0 0 1 7.411 0 4.397 4.397 0 0 1 5.19 3.068c.207.713.23 1.466.067 2.19a4.4 4.4 0 0 1 0 7.415 4.403 4.403 0 0 1-3.06 5.187 4.398 4.398 0 0 1-2.186.072 4.398 4.398 0 0 1-7.422 0 4.398 4.398 0 0 1-5.257-5.248 4.4 4.4 0 0 1 0-7.437Z"
          fill={ringColor}
        />
        <path
          d="M4.674 8.954a3.602 3.602 0 0 1 4.301-4.293 3.6 3.6 0 0 1 6.064 0 3.598 3.598 0 0 1 4.3 4.302 3.6 3.6 0 0 1 0 6.067 3.6 3.6 0 0 1-4.29 4.302 3.6 3.6 0 0 1-6.074 0 3.598 3.598 0 0 1-4.3-4.293 3.6 3.6 0 0 1 0-6.085Z"
          fill={color}
        />
        <path
          d="M15.707 9.293a1 1 0 0 1 0 1.414l-4 4a1 1 0 0 1-1.414 0l-2-2a1 1 0 1 1 1.414-1.414L11 12.586l3.293-3.293a1 1 0 0 1 1.414 0Z"
          fill={ringColor}
        />
      </svg>
      <span className="sr-only">Verified</span>
    </span>
  );
}

export default VerifiedBadge;
