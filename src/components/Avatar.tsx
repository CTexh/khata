import { hueFor, initials } from "@/lib/format";

export function Avatar({
  id,
  name,
  size = 40,
}: {
  id: string;
  name: string;
  size?: number;
}) {
  const hue = hueFor(id);
  return (
    <div
      className="avatar-liquid flex items-center justify-center font-bold shrink-0"
      style={{
        width: size,
        height: size,
        fontSize: size * 0.36,
        background: `linear-gradient(135deg, oklch(0.72 0.16 ${hue}), oklch(0.52 0.19 ${(hue + 40) % 360}))`,
        color: "#fff",
        textShadow: "0 1px 2px rgba(0,0,20,0.25)",
      }}
    >
      {initials(name)}
    </div>
  );
}
