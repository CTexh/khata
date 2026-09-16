"use client";

import { useEffect, useState, useCallback } from "react";
import { fmtRs, hueFor, initials } from "@/lib/format";
import { Sheet, SheetRow } from "@/components/Sheet";
import { invalidate, useCached } from "@/lib/swr";
import { CheckIcon, ClockIcon, RecurringIcon } from "@/components/CategoryIcon";

function Spinner() {
  return (
    <div className="flex justify-center py-16" role="status" aria-label="Loading subscriptions">
      <div
        className="w-6 h-6 rounded-full border-2 animate-spin"
        style={{ borderColor: "var(--hairline)", borderTopColor: "var(--accent)" }}
      />
    </div>
  );
}

type PaymentRecord = {
  id: string;
  period: string; // "YYYY-MM"
  due_date: string; // "YYYY-MM-DD"
  paid_at: string | null;
};

type Subscription = {
  id: string;
  user_id: string;
  name: string;
  amount: number;
  due_day: number;
  logo_url: string | null;
  active: boolean;
  created_at: string;
  current_period: string;
  current_due_date: string;
  paid_this_period: boolean;
  status: "paid" | "due-today" | "due-soon" | "upcoming" | "inactive";
  history: PaymentRecord[];
};

type FormState = {
  name: string;
  amount: string;
  date: string;
  logo_url: string;
  logoLoading: boolean;
};

// logo.clearbit.com was shut down when HubSpot absorbed Clearbit - it no
// longer resolves at all. unavatar.io is a live replacement that chains
// through several logo/favicon sources for a domain, with
// `?fallback=false` so an unknown domain 404s instead of masking failure
// behind a generic placeholder image (which would defeat the initials
// fallback below).
function guessDomain(name: string): string | null {
  const trimmed = name.trim().toLowerCase();
  // Already looks like a domain (e.g. someone typed "youtube.com" as the
  // name) - use it as-is rather than stripping the dot and mangling it
  // into "youtubecom.com".
  if (/^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(trimmed)) return trimmed;
  const slug = trimmed.replace(/\+/g, "plus").replace(/[^a-z0-9]/g, "");
  return slug ? `${slug}.com` : null;
}

function Avatar({
  id,
  name,
  logoUrl,
  size,
}: {
  id: string;
  name: string;
  logoUrl: string | null;
  size: "sm" | "lg";
}) {
  const guessed = guessDomain(name);
  const sources = [logoUrl, guessed ? `https://unavatar.io/${guessed}?fallback=false` : null].filter(
    (s): s is string => !!s
  );
  const [srcIndex, setSrcIndex] = useState(0);
  const dim = size === "sm" ? "w-10 h-10" : "w-16 h-16";
  const text = size === "sm" ? "text-xs" : "text-lg";
  const hue = hueFor(id || name);

  const src = sources[srcIndex];
  if (src) {
    return (
      <img
        src={src}
        alt={name}
        className={`${dim} rounded-full object-cover shrink-0 bg-white`}
        onError={() => setSrcIndex((i) => i + 1)}
      />
    );
  }
  return (
    <div
      className={`${dim} rounded-full flex items-center justify-center text-white ${text} font-bold shrink-0`}
      style={{
        background: `linear-gradient(135deg, oklch(0.72 0.16 ${hue}), oklch(0.52 0.19 ${(hue + 40) % 360}))`,
        textShadow: "0 1px 2px rgba(0,0,20,0.25)",
      }}
    >
      {initials(name)}
    </div>
  );
}

function ordinal(n: number): string {
  const s = ["th", "st", "nd", "rd"];
  const v = n % 100;
  return `${n}${s[(v - 20) % 10] || s[v] || s[0]}`;
}

function monthsBetween(fromPeriod: string, toPeriod: string): number {
  const [fy, fm] = fromPeriod.split("-").map(Number);
  const [ty, tm] = toPeriod.split("-").map(Number);
  return (ty - fy) * 12 + (tm - fm) + 1;
}

function fmtSpan(months: number): string {
  if (months < 1) return "this month";
  if (months === 1) return "1 month";
  if (months < 12) return `${months} months`;
  const years = Math.round((months / 12) * 10) / 10;
  return years === 1 ? "1 year" : `${years} years`;
}

function todayLocalYMD(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function fmtPeriod(period: string): string {
  const [y, m] = period.split("-").map(Number);
  return new Date(y, m - 1, 1).toLocaleDateString(undefined, { month: "long", year: "numeric" });
}

function nextDueDate(period: string, due_day: number): string {
  const [y, m] = period.split("-").map(Number);
  const ny = m === 12 ? y + 1 : y;
  const nm = m === 12 ? 1 : m + 1;
  const lastDay = new Date(ny, nm, 0).getDate();
  const day = Math.min(due_day, lastDay);
  return `${ny}-${String(nm).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function fmtLongDate(ymd: string): string {
  const [y, m, d] = ymd.split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString(undefined, { month: "long", day: "numeric" });
}

/* ---------- subscription detail ---------- */

const STATUS_CHIP: Record<Subscription["status"], { label: string; style: React.CSSProperties }> = {
  paid: { label: "Paid", style: { background: "var(--good-soft)", color: "var(--good)" } },
  "due-today": { label: "Due today", style: { background: "var(--bad-soft)", color: "var(--bad)" } },
  "due-soon": { label: "Due soon", style: { background: "rgba(224, 122, 31, 0.14)", color: "#c2410c" } },
  upcoming: { label: "Upcoming", style: { background: "var(--accent-soft)", color: "var(--accent)" } },
  inactive: { label: "Paused", style: { background: "var(--surface-2)", color: "var(--muted)" } },
};

// The server calls anything unpaid on or past its due date "due-today"; a date
// that has already gone by reads better as overdue.
function chipFor(sub: Subscription) {
  if (!sub.active) return STATUS_CHIP.inactive;
  if (sub.status === "due-today" && sub.current_due_date < todayLocalYMD()) {
    return { label: "Overdue", style: STATUS_CHIP["due-today"].style };
  }
  return STATUS_CHIP[sub.status];
}

function SubscriptionDetail({
  sub,
  confirmDelete,
  actionLoading,
  justPaid,
  onClose,
  onMarkPaid,
  onAskDelete,
  onCancelDelete,
  onDelete,
  onToggleActive,
}: {
  sub: Subscription;
  confirmDelete: boolean;
  actionLoading: boolean;
  justPaid: boolean;
  onClose: () => void;
  onMarkPaid: () => void;
  onAskDelete: () => void;
  onCancelDelete: () => void;
  onDelete: () => void;
  onToggleActive: () => void;
}) {
  const chip = chipFor(sub);
  const nextPaymentDate = sub.paid_this_period
    ? nextDueDate(sub.current_period, sub.due_day)
    : sub.current_due_date;

  const paidCount = sub.history.filter((h) => h.paid_at).length;
  const totalSpent = paidCount * sub.amount;
  const earliestPeriod = sub.history[sub.history.length - 1]?.period ?? sub.current_period;
  const span = fmtSpan(monthsBetween(earliestPeriod, sub.current_period));

  return (
    <Sheet title={sub.name} onClose={onClose}>
      <div className="card p-5 flex flex-col items-center text-center">
        <Avatar id={sub.id} name={sub.name} logoUrl={sub.logo_url} size="lg" />
        <span className="chip mt-3 inline-flex items-center gap-1" style={chip.style}>
          {justPaid ? (
            <>
              <CheckIcon size={14} />
              Paid
            </>
          ) : (
            chip.label
          )}
        </span>
        <p className="mt-2 flex items-baseline gap-1 tabular">
          <span className="text-[36px] font-extrabold leading-tight">{fmtRs(sub.amount)}</span>
          <span className="text-[14px] font-semibold" style={{ color: "var(--muted)" }}>
            / month
          </span>
        </p>
        {sub.active && (
          <p className="text-[14px] mt-1" style={{ color: "var(--muted)" }}>
            {sub.paid_this_period ? "Paid for this month" : "Not paid yet this month"}
          </p>
        )}

        {confirmDelete ? (
          <div className="w-full mt-4 flex flex-col gap-3">
            <p className="text-[14px] font-semibold" style={{ color: "var(--bad)" }}>
              Delete {sub.name} and its payment history? This can&apos;t be undone.
            </p>
            <div className="grid grid-cols-2 gap-2">
              <button type="button" onClick={onCancelDelete} className="btn btn-ghost">
                Cancel
              </button>
              <button type="button" onClick={onDelete} disabled={actionLoading} className="btn btn-danger">
                {actionLoading ? "Deleting…" : "Delete"}
              </button>
            </div>
          </div>
        ) : sub.active ? (
          <div className="grid grid-cols-2 gap-2 w-full mt-4">
            <button
              type="button"
              onClick={onMarkPaid}
              disabled={actionLoading || sub.paid_this_period}
              className="btn btn-good"
            >
              {sub.paid_this_period ? (
                <span className="inline-flex items-center gap-1.5">
                  <CheckIcon size={16} />
                  Paid
                </span>
              ) : actionLoading ? (
                "Saving…"
              ) : (
                "Mark paid"
              )}
            </button>
            <button type="button" onClick={onToggleActive} disabled={actionLoading} className="btn btn-ghost">
              Pause
            </button>
          </div>
        ) : (
          <button type="button" onClick={onToggleActive} disabled={actionLoading} className="btn btn-good w-full mt-4">
            {actionLoading ? "Saving…" : "Resume"}
          </button>
        )}
      </div>

      <div className="card px-4 py-1">
        {sub.active && <SheetRow label="Next payment">{fmtLongDate(nextPaymentDate)}</SheetRow>}
        <SheetRow label="Due">{ordinal(sub.due_day)} of every month</SheetRow>
        <SheetRow label="Paid so far">
          {fmtRs(totalSpent)}
          <span className="block text-[12px] font-semibold" style={{ color: "var(--muted)" }}>
            {paidCount} {paidCount === 1 ? "payment" : "payments"} · {span}
          </span>
        </SheetRow>
      </div>

      {sub.history.length > 0 && (
        <div className="flex flex-col gap-2">
          <h3 className="text-[13px] font-bold uppercase tracking-wide px-1" style={{ color: "var(--muted)" }}>
            History
          </h3>
          <div className="card px-3 py-1">
            <ul>
              {sub.history.map((h) => (
                <li
                  key={h.id}
                  className="flex items-center gap-3 py-3 border-b last:border-b-0"
                  style={{ borderColor: "var(--hairline)" }}
                >
                  <span
                    className="icon-tile !w-10 !h-10 !rounded-xl"
                    style={
                      h.paid_at
                        ? { background: "var(--good-soft)", color: "var(--good)" }
                        : { background: "var(--surface-2)", color: "var(--muted)" }
                    }
                    aria-hidden
                  >
                    {h.paid_at ? <CheckIcon size={18} /> : <ClockIcon size={18} />}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-[14px] font-semibold">{fmtPeriod(h.period)}</span>
                    <span className="block text-[12px]" style={{ color: "var(--muted)" }}>
                      {h.paid_at
                        ? `Paid ${new Date(h.paid_at).toLocaleDateString("en-PK", { day: "numeric", month: "short" })}`
                        : `Due ${fmtLongDate(h.due_date)}`}
                    </span>
                  </span>
                  <span
                    className="tabular text-[15px] font-extrabold shrink-0"
                    style={{ color: h.paid_at ? "var(--ink)" : "var(--muted)" }}
                  >
                    {fmtRs(sub.amount)}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}

      {!confirmDelete && (
        <button
          type="button"
          onClick={onAskDelete}
          disabled={actionLoading}
          className="min-h-12 text-[14px] font-bold"
          style={{ color: "var(--bad)" }}
        >
          Delete {sub.name}
        </button>
      )}
    </Sheet>
  );
}

export default function Subscriptions() {
  const { data: subsData, failedStatus, refresh: refreshSubs } = useCached<Subscription[]>("/api/subscriptions");
  const subscriptions = subsData ?? [];
  const loading = subsData === undefined && failedStatus === undefined;
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [justPaidId, setJustPaidId] = useState<string | null>(null);
  const [form, setForm] = useState<FormState>({
    name: "",
    amount: "",
    date: todayLocalYMD(),
    logo_url: "",
    logoLoading: false,
  });

  // Served from the shared cache, so the list shows at once; after a change the
  // list and Home's figures are refreshed together.
  const loadSubscriptions = useCallback(async () => {
    invalidate("/api/subscriptions");
    await refreshSubs();
  }, [refreshSubs]);

  // A reminder email links to /subscriptions?open=<id>: open that record.
  useEffect(() => {
    if (!subsData) return;
    const id = new URLSearchParams(window.location.search).get("open");
    if (!id) return;
    if (subsData.some((s) => s.id === id)) setExpanded(id);
    window.history.replaceState(null, "", "/subscriptions");
  }, [subsData]);

  const handleLogoFetch = useCallback(async (name: string) => {
    if (!name.trim()) return;

    setForm((prev) => ({ ...prev, logoLoading: true }));
    try {
      const response = await fetch(
        `https://autocomplete.clearbit.com/v1/companies/suggest?query=${encodeURIComponent(name)}`
      );
      const data = await response.json();
      // Clearbit's suggest endpoint no longer returns a populated `logo`
      // field (it's always null now) - but `domain` is still populated,
      // and Clearbit's separate logo CDN serves a logo for any domain.
      const domain = data?.[0]?.domain;
      if (domain) {
        setForm((prev) => ({ ...prev, logo_url: `https://unavatar.io/${domain}?fallback=false` }));
      }
    } catch (err) {
      console.error("Failed to fetch logo:", err);
    } finally {
      setForm((prev) => ({ ...prev, logoLoading: false }));
    }
  }, []);

  const handleAddSubscription = useCallback(async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.name || !form.amount || !form.date) {
      setError("Please fill in all fields");
      return;
    }

    try {
      const res = await fetch("/api/subscriptions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: form.name,
          amount: parseFloat(form.amount),
          date: form.date,
          logo_url: form.logo_url || null,
        }),
      });

      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || "Failed to create subscription");
      }

      setForm(emptyForm());
      setShowForm(false);
      await loadSubscriptions();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
    }
  }, [form, loadSubscriptions]);

  const handleMarkPaid = useCallback(async (id: string) => {
    setError(null);
    setActionLoading(id);
    try {
      const res = await fetch(`/api/subscriptions/${id}/mark-paid`, { method: "POST" });
      if (!res.ok) throw new Error("Failed to mark as paid");
      await loadSubscriptions();
      setJustPaidId(id);
      setTimeout(() => setJustPaidId((cur) => (cur === id ? null : cur)), 2000);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setActionLoading(null);
    }
  }, [loadSubscriptions]);

  const handleDelete = useCallback(async (id: string) => {
    setError(null);
    setActionLoading(id);
    try {
      const res = await fetch(`/api/subscriptions/${id}`, { method: "DELETE" });
      if (!res.ok) throw new Error("Failed to delete subscription");
      await loadSubscriptions();
      setExpanded(null);
      setConfirmDeleteId(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setActionLoading(null);
    }
  }, [loadSubscriptions]);

  const handleToggleActive = useCallback(async (id: string, active: boolean) => {
    setError(null);
    setActionLoading(id);
    try {
      const res = await fetch(`/api/subscriptions/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ active }),
      });
      if (!res.ok) throw new Error(`Failed to ${active ? "reactivate" : "deactivate"} subscription`);
      await loadSubscriptions();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setActionLoading(null);
    }
  }, [loadSubscriptions]);

  const emptyForm = (): FormState => ({
    name: "",
    amount: "",
    date: todayLocalYMD(),
    logo_url: "",
    logoLoading: false,
  });

  const closeForm = useCallback(() => {
    setShowForm(false);
    setForm(emptyForm());
  }, []);

  // due-today first (most urgent), then due-soon, upcoming, and paid last;
  // ties broken by due date so the soonest within a status bubbles up.
  const STATUS_ORDER: Record<Subscription["status"], number> = {
    "due-today": 0,
    "due-soon": 1,
    upcoming: 2,
    paid: 3,
    inactive: 4,
  };
  const activeSubscriptions = subscriptions
    .filter((s) => s.active)
    .sort(
      (a, b) =>
        STATUS_ORDER[a.status] - STATUS_ORDER[b.status] ||
        a.current_due_date.localeCompare(b.current_due_date)
    );
  const inactiveSubscriptions = subscriptions.filter((s) => !s.active);
  const monthlyTotal = activeSubscriptions.reduce((sum, sub) => sum + sub.amount, 0);

  if (loading) return <Spinner />;

  const open = subscriptions.find((sub) => sub.id === expanded) ?? null;
  const unpaid = activeSubscriptions.filter((sub) => !sub.paid_this_period);
  const unpaidTotal = unpaid.reduce((sum, sub) => sum + sub.amount, 0);

  const row = (sub: Subscription) => {
    const chip = chipFor(sub);
    return (
      <li key={sub.id}>
        <button
          type="button"
          className="list-row"
          onClick={() => {
            setConfirmDeleteId(null);
            setExpanded(sub.id);
          }}
        >
          <Avatar id={sub.id} name={sub.name} logoUrl={sub.logo_url} size="sm" />
          <span className="min-w-0 flex-1">
            <span className="block text-[16px] font-bold truncate">{sub.name}</span>
            <span className="block text-[12px] truncate" style={{ color: "var(--muted)" }}>
              {!sub.active
                ? "Paused"
                : sub.paid_this_period
                  ? `Next ${fmtLongDate(nextDueDate(sub.current_period, sub.due_day))}`
                  : `Due ${fmtLongDate(sub.current_due_date)}`}
            </span>
          </span>
          <span className="flex flex-col items-end gap-1 shrink-0">
            <span className="text-[15px] font-extrabold tabular">{fmtRs(sub.amount)}</span>
            <span className="chip inline-flex items-center gap-1" style={chip.style}>
              {justPaidId === sub.id ? (
                <>
                  <CheckIcon size={13} />
                  Paid
                </>
              ) : (
                chip.label
              )}
            </span>
          </span>
        </button>
      </li>
    );
  };

  return (
    <div className="flex flex-col gap-5">
      <section className="hero-panel p-6 rise">
        <p className="hero-muted text-[14px] font-semibold">Every month</p>
        <p className="mt-1 flex items-baseline gap-2 tabular">
          <span className="hero-muted text-[20px] font-bold">Rs</span>
          <span className="text-[42px] font-extrabold leading-none tracking-tight">
            {fmtRs(monthlyTotal).replace(/^−?Rs\s/, "")}
          </span>
        </p>
        <div className="mt-3 flex flex-wrap gap-x-5 gap-y-1 text-[14px]">
          <span>
            <span className="font-extrabold">{activeSubscriptions.length}</span> <span className="hero-muted">active</span>
          </span>
          {unpaid.length > 0 ? (
            <span>
              <span className="font-extrabold" style={{ color: "#ffb4a8" }}>{fmtRs(unpaidTotal)}</span>{" "}
              <span className="hero-muted">still to pay</span>
            </span>
          ) : activeSubscriptions.length > 0 ? (
            <span className="font-extrabold" style={{ color: "#7ee2a8" }}>All paid this month</span>
          ) : null}
        </div>
      </section>

      <div className="section-head">
        <h2 className="section-title">Your subscriptions</h2>
        <button type="button" className="tab-fab !w-12 !h-12 !m-0 !shadow-none" aria-label="Add subscription" onClick={() => setShowForm(true)}>
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" aria-hidden>
            <path d="M12 5v14M5 12h14" />
          </svg>
        </button>
      </div>

      {(error || (failedStatus !== undefined && !subsData)) && (
        <div className="card p-4 text-[14px] font-semibold" style={{ color: "var(--bad)" }} role="alert">
          {error ?? "Couldn't load your subscriptions. Check your connection and try again."}
        </div>
      )}

      {subscriptions.length === 0 ? (
        <div className="card p-8 text-center">
          <p className="flex justify-center mb-2" style={{ color: "var(--muted)" }} aria-hidden>
            <RecurringIcon size={32} />
          </p>
          <p className="font-bold">No subscriptions yet</p>
          <p className="text-[14px] mt-1" style={{ color: "var(--muted)" }}>
            Add Netflix, Spotify, your gym - anything you pay every month.
          </p>
          <button type="button" className="btn btn-primary mt-4" onClick={() => setShowForm(true)}>
            Add subscription
          </button>
        </div>
      ) : (
        <>
          {activeSubscriptions.length > 0 && <ul className="list-card rise">{activeSubscriptions.map(row)}</ul>}
          {inactiveSubscriptions.length > 0 && (
            <>
              <h3 className="text-[13px] font-bold uppercase tracking-wide px-1" style={{ color: "var(--muted)" }}>
                Paused
              </h3>
              <ul className="list-card" style={{ opacity: 0.75 }}>
                {inactiveSubscriptions.map(row)}
              </ul>
            </>
          )}
        </>
      )}

      {open && (
        <SubscriptionDetail
          sub={open}
          confirmDelete={confirmDeleteId === open.id}
          actionLoading={actionLoading === open.id}
          justPaid={justPaidId === open.id}
          onClose={() => {
            setExpanded(null);
            setConfirmDeleteId(null);
          }}
          onMarkPaid={() => handleMarkPaid(open.id)}
          onAskDelete={() => setConfirmDeleteId(open.id)}
          onCancelDelete={() => setConfirmDeleteId(null)}
          onDelete={() => handleDelete(open.id)}
          onToggleActive={() => handleToggleActive(open.id, !open.active)}
        />
      )}

      {showForm && (
        <Sheet title="New subscription" onClose={closeForm}>
          <form onSubmit={handleAddSubscription} className="card p-4 flex flex-col gap-3">
            <div className="flex gap-3 items-end">
              {form.logo_url && <Avatar id={form.name || "new"} name={form.name || "?"} logoUrl={form.logo_url} size="sm" />}
              <label className="flex-1 flex flex-col gap-1.5">
                <span className="text-[13px] font-semibold" style={{ color: "var(--muted)" }}>
                  Name
                </span>
                <input
                  type="text"
                  placeholder="e.g. Netflix"
                  className="field w-full"
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                  onBlur={(e) => {
                    if (e.target.value && !form.logo_url) handleLogoFetch(e.target.value);
                  }}
                  required
                />
              </label>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <label className="flex flex-col gap-1.5">
                <span className="text-[13px] font-semibold" style={{ color: "var(--muted)" }}>
                  Amount (Rs)
                </span>
                <input
                  type="number"
                  inputMode="decimal"
                  step="0.01"
                  min="0"
                  placeholder="0"
                  className="field tabular"
                  value={form.amount}
                  onChange={(e) => setForm({ ...form, amount: e.target.value })}
                  required
                />
              </label>
              <label className="flex flex-col gap-1.5">
                <span className="text-[13px] font-semibold" style={{ color: "var(--muted)" }}>
                  First due date
                </span>
                <input
                  type="date"
                  className="field"
                  value={form.date}
                  onChange={(e) => setForm({ ...form, date: e.target.value })}
                  required
                />
              </label>
            </div>
            <div className="form-actions mt-1">
              <button type="button" onClick={closeForm} className="btn btn-ghost">
                Cancel
              </button>
              <button type="submit" className="btn btn-primary">
                {form.logoLoading ? "Fetching logo…" : "Add subscription"}
              </button>
            </div>
          </form>
        </Sheet>
      )}
    </div>
  );
}
