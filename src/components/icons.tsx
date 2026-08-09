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

export function EditIcon({ size = 24, className }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" className={className} aria-hidden>
      <path {...base} d="M4 20.5h4L18.5 10 15 6.5 4.5 17v3.5Z" />
      <path {...base} d="M13.2 8.3 16.7 11.8" />
    </svg>
  );
}

export function WhatsAppIcon({ size = 24, className }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" className={className} aria-hidden fill="currentColor">
      <path d="M12.04 2C6.58 2 2.13 6.45 2.13 11.91c0 1.75.46 3.46 1.33 4.97L2 22l5.25-1.38a9.9 9.9 0 0 0 4.79 1.22h.01c5.46 0 9.91-4.45 9.91-9.91C21.96 6.45 17.5 2 12.04 2Zm0 18.15h-.01a8.24 8.24 0 0 1-4.2-1.15l-.3-.18-3.12.82.83-3.04-.2-.31a8.22 8.22 0 0 1-1.26-4.38c0-4.55 3.71-8.26 8.27-8.26 2.21 0 4.28.86 5.84 2.42a8.2 8.2 0 0 1 2.42 5.85c0 4.56-3.71 8.23-8.27 8.23Zm4.53-6.17c-.25-.12-1.47-.72-1.7-.81-.23-.08-.39-.12-.56.13-.17.24-.64.81-.78.97-.14.17-.29.19-.53.06-.25-.12-1.04-.38-1.98-1.22-.73-.65-1.23-1.46-1.37-1.7-.14-.25-.02-.38.11-.5.11-.11.25-.29.37-.43.12-.15.16-.25.25-.42.08-.16.04-.31-.02-.43-.06-.12-.56-1.34-.76-1.84-.2-.48-.4-.42-.56-.42-.14 0-.31-.02-.47-.02s-.43.06-.66.31c-.23.24-.86.85-.86 2.06 0 1.22.89 2.4 1.01 2.56.12.17 1.75 2.67 4.24 3.75.59.26 1.05.41 1.41.52.59.19 1.13.16 1.55.1.47-.07 1.47-.6 1.68-1.19.21-.58.21-1.08.14-1.19-.06-.11-.23-.17-.48-.29Z" />
    </svg>
  );
}
