export function fmtRs(n: number): string {
  const abs = Math.abs(n);
  const s = abs.toLocaleString("en-PK", {
    maximumFractionDigits: Number.isInteger(abs) ? 0 : 2,
    minimumFractionDigits: 0,
  });
  return `${n < 0 ? "−" : ""}Rs ${s}`;
}

export function fmtWhen(iso: string): string {
  const d = new Date(iso);
  const now = new Date();
  const diff = (now.getTime() - d.getTime()) / 1000;
  if (diff < 60) return "just now";
  if (diff < 3600) return `${Math.floor(diff / 60)} min ago`;
  if (diff < 86400 && d.getDate() === now.getDate())
    return d.toLocaleTimeString("en-PK", { hour: "numeric", minute: "2-digit" });
  return d.toLocaleDateString("en-PK", {
    day: "numeric",
    month: "short",
    year: d.getFullYear() === now.getFullYear() ? undefined : "numeric",
  });
}

// How long ago, the way a notification list reads it: "Just now", "5 min
// ago", "3 hr ago", "Yesterday", a weekday within the week, then the date.
// `now` is a parameter so it can be tested against a fixed moment.
export function fmtAgo(iso: string, now: Date = new Date()): string {
  const d = new Date(iso);
  const secs = (now.getTime() - d.getTime()) / 1000;
  if (secs < 60) return "Just now";
  if (secs < 3600) return `${Math.floor(secs / 60)} min ago`;
  const startOf = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const days = Math.round((startOf(now) - startOf(d)) / 86_400_000);
  if (days === 0) return `${Math.floor(secs / 3600)} hr ago`;
  if (days === 1) return "Yesterday";
  if (days < 7) return d.toLocaleDateString("en-PK", { weekday: "long" });
  return d.toLocaleDateString("en-PK", {
    day: "numeric",
    month: "short",
    year: d.getFullYear() === now.getFullYear() ? undefined : "numeric",
  });
}

export function fmtFull(iso: string): string {
  return new Date(iso).toLocaleString("en-PK", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

export function fmtDateLabel(ymd: string): string {
  const [y, m, d] = ymd.split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString("en-PK", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

export const initials = (name: string) =>
  name
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? "")
    .join("");

export const AVATAR_HUES = [212, 160, 38, 265, 350, 20, 190, 300];

export const hueFor = (id: string) => {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  return AVATAR_HUES[h % AVATAR_HUES.length];
};

export const MONTH_NAMES = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

export function todayLocalYMD(): string {
  const d = new Date();
  const tz = d.getTimezoneOffset();
  const local = new Date(d.getTime() - tz * 60000);
  return local.toISOString().slice(0, 10);
}

export type DueStatus = "overdue" | "soon" | "upcoming";

export function dueDateInfo(
  dueDate: string | null
): { label: string; status: DueStatus } | null {
  if (!dueDate) return null;
  const today = todayLocalYMD();
  const diffDays = Math.round(
    (new Date(dueDate + "T00:00:00").getTime() - new Date(today + "T00:00:00").getTime()) /
      86400000
  );
  const label = fmtDateLabel(dueDate).replace(/ \d{4}$/, "");
  if (diffDays < 0) return { label: `Overdue · ${label}`, status: "overdue" };
  if (diffDays <= 3) return { label: `Due ${label}`, status: "soon" };
  return { label: `Due ${label}`, status: "upcoming" };
}
