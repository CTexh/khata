type IconProps = { size?: number; className?: string };

const base = {
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 2,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
};

export function HomeIcon({ size = 24, className }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" className={className} aria-hidden>
      <path {...base} d="M4 10.5 12 4l8 6.5V19a1.5 1.5 0 0 1-1.5 1.5H15v-6h-6v6H5.5A1.5 1.5 0 0 1 4 19v-8.5z" />
    </svg>
  );
}

export function SparkleIcon({ size = 24, className }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" className={className} aria-hidden>
      <path
        {...base}
        d="M12 3.5c.5 3.9 2.6 6 6.5 6.5-3.9.5-6 2.6-6.5 6.5-.5-3.9-2.6-6-6.5-6.5 3.9-.5 6-2.6 6.5-6.5z"
      />
      <path {...base} d="M18.5 15.5c.2 1.5 1 2.3 2.5 2.5-1.5.2-2.3 1-2.5 2.5-.2-1.5-1-2.3-2.5-2.5 1.5-.2 2.3-1 2.5-2.5z" />
    </svg>
  );
}

export function MicIcon({ size = 24, className }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" className={className} aria-hidden>
      <rect {...base} x="9" y="3" width="6" height="11" rx="3" />
      <path {...base} d="M5 11a7 7 0 0 0 14 0M12 18v3" />
    </svg>
  );
}

export function CameraIcon({ size = 24, className }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" className={className} aria-hidden>
      <path {...base} d="M4 8.5A1.5 1.5 0 0 1 5.5 7h2l1.5-2h6l1.5 2h2A1.5 1.5 0 0 1 20 8.5V18a1.5 1.5 0 0 1-1.5 1.5h-13A1.5 1.5 0 0 1 4 18V8.5z" />
      <circle {...base} cx="12" cy="13" r="3.5" />
    </svg>
  );
}

export function ArrowUpIcon({ size = 24, className }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" className={className} aria-hidden>
      <path {...base} d="M12 19V5M6 11l6-6 6 6" />
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
