/**
 * GhostLogo – Luxury ghost brand mark for GHOST platform.
 * Usage: <GhostLogo size={24} className="text-cyan-400" />
 */
export default function GhostLogo({ size = 24, className = "" }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 32 32"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      aria-label="GHOST"
    >
      <defs>
        <radialGradient id="ghost-body-grad" cx="50%" cy="40%" r="55%">
          <stop offset="0%" stopColor="currentColor" stopOpacity="1" />
          <stop offset="100%" stopColor="currentColor" stopOpacity="0.75" />
        </radialGradient>
        <filter id="ghost-glow-filter" x="-40%" y="-40%" width="180%" height="180%">
          <feGaussianBlur stdDeviation="1.2" result="blur" />
          <feMerge>
            <feMergeNode in="blur" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
      </defs>

      {/* Ghost body: rounded dome, wavy hem */}
      <path
        d="M16 3C10.477 3 6 7.477 6 13V27
           L9 24.5 L12 27 L16 24.5 L20 27 L23 24.5 L26 27
           V13C26 7.477 21.523 3 16 3Z"
        fill="url(#ghost-body-grad)"
        filter="url(#ghost-glow-filter)"
      />

      {/* Left eye */}
      <ellipse cx="12" cy="13.5" rx="2" ry="2" fill="rgba(0,0,0,0.75)" />
      <circle cx="12.7" cy="12.8" r="0.65" fill="white" opacity="0.8" />

      {/* Right eye */}
      <ellipse cx="20" cy="13.5" rx="2" ry="2" fill="rgba(0,0,0,0.75)" />
      <circle cx="20.7" cy="12.8" r="0.65" fill="white" opacity="0.8" />
    </svg>
  );
}
