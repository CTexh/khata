export function Logo({ size = 44 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 64 64"
      className="logo-float shrink-0"
      aria-label="Khata logo"
    >
      <defs>
        <linearGradient id="lg-badge" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="var(--accent)" />
          <stop offset="0.55" stopColor="var(--accent-2)" />
          <stop offset="1" stopColor="var(--good-2)" />
        </linearGradient>
        <linearGradient id="lg-glass" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#fff" stopOpacity="0.55" />
          <stop offset="0.5" stopColor="#fff" stopOpacity="0.08" />
          <stop offset="0.5" stopColor="#fff" stopOpacity="0" />
        </linearGradient>
        <radialGradient id="lg-glow" cx="0.28" cy="0.22" r="0.55">
          <stop offset="0" stopColor="#fff" stopOpacity="0.9" />
          <stop offset="1" stopColor="#fff" stopOpacity="0" />
        </radialGradient>
      </defs>

      {/* liquid squircle badge */}
      <rect x="3" y="3" width="58" height="58" rx="19" fill="url(#lg-badge)" />
      <rect x="3" y="3" width="58" height="58" rx="19" fill="url(#lg-glow)" />
      {/* glass sheen over the top half */}
      <path d="M3 22c0-10.5 8.5-19 19-19h20c10.5 0 19 8.5 19 19v6H3v-6z" fill="url(#lg-glass)" />

      {/* bold liquid "K" monogram */}
      <g
        stroke="#fff"
        strokeWidth="6.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        fill="none"
      >
        <path d="M20 16v32" />
        <path d="M40 16 22 32" />
        <path d="M27 30 41 48" />
      </g>
    </svg>
  );
}
