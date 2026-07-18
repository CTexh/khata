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
        <linearGradient id="lg-drop" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="var(--accent)" />
          <stop offset="0.55" stopColor="var(--accent-2)" />
          <stop offset="1" stopColor="var(--good-2)" />
        </linearGradient>
        <radialGradient id="lg-shine" cx="0.32" cy="0.22" r="0.5">
          <stop offset="0" stopColor="#fff" stopOpacity="0.85" />
          <stop offset="1" stopColor="#fff" stopOpacity="0" />
        </radialGradient>
      </defs>
      <path
        d="M32 4C40 16 56 24 56 39c0 13.3-10.7 21-24 21S8 52.3 8 39C8 24 24 16 32 4z"
        fill="url(#lg-drop)"
      />
      <path
        d="M32 4C40 16 56 24 56 39c0 13.3-10.7 21-24 21S8 52.3 8 39C8 24 24 16 32 4z"
        fill="url(#lg-shine)"
      />
      <g
        stroke="#fff"
        strokeWidth="4.2"
        strokeLinecap="round"
        strokeLinejoin="round"
        fill="none"
      >
        <path d="M24 26h16M24 33h16M26 26c6 0 9 2.5 9 7 0 4.5-3 7.5-9 7.5l12 9" />
      </g>
    </svg>
  );
}
