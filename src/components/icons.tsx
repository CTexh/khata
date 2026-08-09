type IconProps = { size?: number; className?: string };

const base = {
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 2,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
};

export function WalletIcon({ size = 24, className }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" className={className} aria-hidden>
      <path {...base} d="M7 7V6a3 3 0 0 1 3-3h4a3 3 0 0 1 3 3v1" />
      <rect {...base} x="3" y="7" width="18" height="13" rx="3.2" />
      <path {...base} d="M3 11.5h18" />
      <circle cx="16.2" cy="14.6" r="1.4" fill="currentColor" stroke="none" />
    </svg>
  );
}

export function ReceiptIcon({ size = 24, className }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" className={className} aria-hidden>
      <path
        {...base}
        d="M6.5 3h11v17.2l-2.1-1.3-1.9 1.3-1.9-1.3-1.9 1.3-1.9-1.3-1.3.9V3z"
      />
      <path {...base} d="M9 8h6M9 11.5h6M9 15h3.5" />
    </svg>
  );
}

export function HandshakeIcon({ size = 24, className }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" className={className} aria-hidden>
      <circle {...base} cx="8.5" cy="7.5" r="3" />
      <path {...base} d="M3 20c0-3.3 2.5-6 5.5-6s5.5 2.7 5.5 6" />
      <circle {...base} cx="17" cy="9" r="2.3" />
      <path {...base} d="M14.3 20c.2-3 2-5.3 4.2-5.3.9 0 1.8.4 2.5 1.1" />
    </svg>
  );
}

export function RepeatIcon({ size = 24, className }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" className={className} aria-hidden>
      <path {...base} d="M4 12a8 8 0 0 1 13.3-6" />
      <path {...base} d="M17.3 3v3.6h-3.6" />
      <path {...base} d="M20 12a8 8 0 0 1-13.3 6" />
      <path {...base} d="M6.7 21v-3.6h3.6" />
    </svg>
  );
}
