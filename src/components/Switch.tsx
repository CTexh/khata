"use client";

// One labelled on/off switch, shared by the Settings sheet and the
// notification screen. It lives on its own so that importing it does not drag
// the whole notifications screen into every page's download.
export function Switch({
  label,
  hint,
  checked,
  disabled,
  onChange,
}: {
  label: string;
  hint?: string;
  checked: boolean;
  disabled?: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <label className="flex items-start justify-between gap-3 min-h-11 cursor-pointer">
      <span className="min-w-0">
        <span className="block text-[15px] font-semibold">{label}</span>
        {hint && (
          <span className="block text-[12.5px] mt-0.5" style={{ color: "var(--muted)" }}>
            {hint}
          </span>
        )}
      </span>
      <input
        type="checkbox"
        className="h-6 w-6 mt-0.5 shrink-0 accent-[var(--accent)] cursor-pointer"
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
      />
    </label>
  );
}
