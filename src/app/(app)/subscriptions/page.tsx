"use client";

import { useEffect, useState, useCallback } from "react";
import { fmtRs, hueFor, initials } from "@/lib/format";

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

function fmtShortMonth(period: string): string {
  const [y, m] = period.split("-").map(Number);
  return new Date(y, m - 1, 1).toLocaleDateString(undefined, { month: "short" });
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

/* ---------- subscription detail (hero-style tile) ---------- */

function SubscriptionDetail({
  sub,
  confirmDelete,
  actionLoading,
  onMarkPaid,
  onAskDelete,
  onCancelDelete,
  onDelete,
  onToggleActive,
}: {
  sub: Subscription;
  confirmDelete: boolean;
  actionLoading: boolean;
  onMarkPaid: () => void;
  onAskDelete: () => void;
  onCancelDelete: () => void;
  onDelete: () => void;
  onToggleActive: () => void;
}) {
  const statusText = !sub.active
    ? "Inactive"
    : sub.paid_this_period
      ? "Active"
      : sub.status === "due-today"
        ? "Due today"
        : sub.status === "due-soon"
          ? "Due soon"
          : "Upcoming";
  const statusColor = !sub.active
    ? "var(--muted)"
    : sub.status === "due-today"
      ? "var(--bad)"
      : sub.status === "due-soon"
        ? "#e07a1f"
        : "var(--good)";

  const nextPaymentDate = sub.paid_this_period
    ? nextDueDate(sub.current_period, sub.due_day)
    : sub.current_due_date;

  const timelineNodes = [...sub.history].slice(0, 5).reverse();
  const paidCount = sub.history.filter((h) => h.paid_at).length;
  const totalSpent = paidCount * sub.amount;
  const earliestPeriod = sub.history[sub.history.length - 1]?.period ?? sub.current_period;
  const span = fmtSpan(monthsBetween(earliestPeriod, sub.current_period));

  return (
    <div className="card p-6 mt-2 flex flex-col gap-6 rise">
      <div className="flex flex-col items-center text-center gap-2">
        <Avatar id={sub.id} name={sub.name} logoUrl={sub.logo_url} size="lg" />
        <p
          className="text-[11px] font-bold uppercase tracking-wide mt-1"
          style={{ color: statusColor }}
        >
          Status: {statusText}
        </p>
        <h3 className="text-2xl font-extrabold">{sub.name}</h3>
        <p className="text-[13px]" style={{ color: "var(--muted)" }}>
          {sub.active ? "Subscription" : "Was"} on the {ordinal(sub.due_day)} of every month
        </p>
        <span className="tile inline-flex items-center gap-1.5 px-3 py-1 text-[12px] font-semibold mt-1">
          🔁 Monthly
        </span>
      </div>

      {sub.active ? (
        <div className="flex flex-col items-center text-center gap-1">
          <p
            className="text-[11px] font-semibold uppercase tracking-wide"
            style={{ color: "var(--muted)" }}
          >
            Next Payment
          </p>
          <p className="hero-num text-4xl font-black tabular">−{fmtRs(sub.amount)}</p>
          <p className="text-[13px]" style={{ color: "var(--muted)" }}>
            Expected around{" "}
            <span className="font-semibold" style={{ color: "var(--accent)" }}>
              {fmtLongDate(nextPaymentDate)}
            </span>
          </p>
        </div>
      ) : (
        <p className="text-[13px] text-center" style={{ color: "var(--muted)" }}>
          This subscription is deactivated — no charges are being tracked.
        </p>
      )}

      {timelineNodes.length > 1 && (
        <div className="sub-timeline">
          {timelineNodes.map((h, i) => (
            <div key={h.id} className="sub-timeline-seg">
              <div className="sub-timeline-node">
                <div className={`sub-timeline-dot ${h.paid_at ? "paid" : "pending"}`} />
                <span className="sub-timeline-label">{fmtShortMonth(h.period)}</span>
              </div>
              {i < timelineNodes.length - 1 && (
                <div
                  className={`sub-timeline-connector ${timelineNodes[i + 1].paid_at ? "paid" : "pending"}`}
                />
              )}
            </div>
          ))}
        </div>
      )}

      {paidCount > 0 && (
        <p className="text-[13px] text-center" style={{ color: "var(--muted)" }}>
          💡 You&apos;ve spent <span className="font-semibold tabular" style={{ color: "var(--ink)" }}>{fmtRs(totalSpent)}</span> over {span} on this vendor.
        </p>
      )}

      {confirmDelete ? (
        <div className="flex flex-col gap-3">
          <p className="text-sm font-semibold text-center" style={{ color: "var(--bad)" }}>
            Permanently delete {sub.name}? This erases its full history and cannot be undone.
          </p>
          <div className="flex gap-3">
            <button onClick={onDelete} disabled={actionLoading} className="btn btn-danger flex-1">
              {actionLoading ? "Deleting..." : "Yes, delete"}
            </button>
            <button type="button" onClick={onCancelDelete} className="btn btn-ghost flex-1">
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          <div className="flex gap-3">
            {sub.active ? (
              <>
                <button
                  onClick={onMarkPaid}
                  disabled={actionLoading || sub.paid_this_period}
                  className="btn btn-good flex-1"
                >
                  {actionLoading ? "Marking..." : "Paid"}
                </button>
                <button onClick={onToggleActive} disabled={actionLoading} className="btn btn-ghost flex-1">
                  {actionLoading ? "Deactivating..." : "Deactivate"}
                </button>
              </>
            ) : (
              <button onClick={onToggleActive} disabled={actionLoading} className="btn btn-good flex-1">
                {actionLoading ? "Reactivating..." : "Reactivate"}
              </button>
            )}
          </div>
          <button
            onClick={onAskDelete}
            disabled={actionLoading}
            className="text-[12px] font-semibold text-center"
            style={{ color: "var(--bad)" }}
          >
            Delete permanently
          </button>
        </div>
      )}

      <div className="flex flex-col gap-2 pt-2" style={{ borderTop: "1px solid var(--hairline)" }}>
        <p className="text-[13px] font-semibold" style={{ color: "var(--muted)" }}>
          Recent Transactions ({sub.history.length})
        </p>
        <div className="flex flex-col gap-1.5">
          {sub.history.map((h) => (
            <div key={h.id} className="flex items-center gap-3 text-sm py-1">
              <span
                className="w-2 h-2 rounded-full shrink-0"
                style={{ background: h.paid_at ? "var(--good)" : "var(--muted)" }}
              />
              <span className="flex-1">{fmtPeriod(h.period)}</span>
              {h.paid_at ? (
                <span className="tabular" style={{ color: "var(--good)" }}>
                  Paid {new Date(h.paid_at).toLocaleDateString()}
                </span>
              ) : (
                <span className="tabular" style={{ color: "var(--muted)" }}>
                  Due {new Date(h.due_date).toLocaleDateString()}
                </span>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

export default function Subscriptions() {
  const [subscriptions, setSubscriptions] = useState<Subscription[]>([]);
  const [loading, setLoading] = useState(true);
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

  // Full-page spinner only on the very first load - re-running this after a
  // mutation (mark paid, delete, toggle active) shouldn't blank out the
  // already-visible list, that's a jarring flash on every action.
  const loadSubscriptions = useCallback(async (isInitial = false) => {
    try {
      if (isInitial) setLoading(true);
      const res = await fetch("/api/subscriptions");
      if (!res.ok) throw new Error("Failed to load subscriptions");
      const data = await res.json();
      setSubscriptions(data);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      if (isInitial) setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadSubscriptions(true);
  }, [loadSubscriptions]);

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
  const statusColors = {
    paid: "bg-emerald-500/20 text-emerald-600 dark:text-emerald-400",
    "due-today": "bg-red-500/20 text-red-600 dark:text-red-400",
    "due-soon": "bg-orange-500/20 text-orange-600 dark:text-orange-400",
    upcoming: "bg-gray-500/20 text-gray-600 dark:text-gray-400",
    inactive: "bg-gray-500/20 text-gray-500 dark:text-gray-400",
  };
  const statusLabels = {
    paid: "PAID",
    "due-today": "DUE TODAY",
    "due-soon": "DUE SOON",
    upcoming: "UPCOMING",
    inactive: "INACTIVE",
  };

  if (loading) return <Spinner />;

  return (
    <main id="main-content" className="flex flex-col gap-5">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold">Subscriptions</h2>
          <p className="text-sm" style={{ color: "var(--muted)" }}>
            Total this month: <span className="tabular font-semibold">{fmtRs(monthlyTotal)}</span>
          </p>
        </div>
        <button
          onClick={() => (showForm ? closeForm() : setShowForm(true))}
          className="btn btn-primary"
        >
          Add
        </button>
      </div>

      {error && (
        <div className="card p-4" style={{ borderLeftWidth: "4px", borderLeftColor: "var(--bad)" }}>
          <p className="text-sm font-semibold" style={{ color: "var(--bad)" }}>
            {error}
          </p>
        </div>
      )}

      {showForm && (
        <form onSubmit={handleAddSubscription} className="card p-6 flex flex-col gap-4">
          <div className="flex gap-4 items-end">
            {form.logo_url && (
              <Avatar id={form.name || "new"} name={form.name || "?"} logoUrl={form.logo_url} size="sm" />
            )}
            <div className="flex-1 flex flex-col gap-1.5">
              <label className="text-[13px]" style={{ color: "var(--muted)" }}>
                Name
              </label>
              <input
                type="text"
                aria-label="Subscription name"
                placeholder="e.g., Netflix"
                className="field w-full"
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                onBlur={(e) => {
                  if (e.target.value && !form.logo_url) {
                    handleLogoFetch(e.target.value);
                  }
                }}
                required
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="flex flex-col gap-1.5">
              <label className="text-[13px]" style={{ color: "var(--muted)" }}>
                Rs
              </label>
              <input
                type="number"
                inputMode="decimal"
                step="0.01"
                min="0"
                aria-label="Amount in Rs"
                placeholder="0"
                className="field tabular"
                value={form.amount}
                onChange={(e) => setForm({ ...form, amount: e.target.value })}
                required
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <label className="text-[13px]" style={{ color: "var(--muted)" }}>
                Date
              </label>
              <input
                type="date"
                aria-label="Due date"
                className="field"
                value={form.date}
                onChange={(e) => setForm({ ...form, date: e.target.value })}
                required
              />
            </div>
          </div>

          <div className="flex gap-3">
            <button type="submit" className="btn btn-primary flex-1">
              {form.logoLoading ? "Fetching logo..." : "Add Subscription"}
            </button>
            <button
              type="button"
              onClick={closeForm}
              className="btn btn-ghost flex-1"
            >
              Cancel
            </button>
          </div>
        </form>
      )}

      <div className="flex flex-col gap-3">
        {subscriptions.length === 0 ? (
          <div className="card p-8 text-center">
            <p style={{ color: "var(--muted)" }}>No subscriptions yet. Add one to get started!</p>
          </div>
        ) : (
          <>
            {activeSubscriptions.map((sub) => (
              <div key={sub.id}>
                <div
                  className="card p-4 cursor-pointer hover:opacity-80 transition-opacity"
                  onClick={() => setExpanded(expanded === sub.id ? null : sub.id)}
                >
                  <div className="flex items-center gap-4">
                    <Avatar id={sub.id} name={sub.name} logoUrl={sub.logo_url} size="sm" />
                    <div className="flex-1 min-w-0">
                      <p className="font-semibold truncate">{sub.name}</p>
                      <p className="text-sm" style={{ color: "var(--muted)" }}>
                        {sub.paid_this_period
                          ? `Paid for ${fmtPeriod(sub.current_period)}`
                          : `Due ${new Date(sub.current_due_date).toLocaleDateString()}`}
                      </p>
                    </div>
                    {justPaidId === sub.id ? (
                      <span className={`px-3 py-1 rounded-full text-xs font-semibold ${statusColors.paid}`}>
                        ✓ PAID
                      </span>
                    ) : (
                      <span className={`px-3 py-1 rounded-full text-xs font-semibold ${statusColors[sub.status]}`}>
                        {statusLabels[sub.status]}
                      </span>
                    )}
                  </div>
                </div>

                {expanded === sub.id && (
                  <SubscriptionDetail
                    sub={sub}
                    confirmDelete={confirmDeleteId === sub.id}
                    actionLoading={actionLoading === sub.id}
                    onMarkPaid={() => handleMarkPaid(sub.id)}
                    onAskDelete={() => setConfirmDeleteId(sub.id)}
                    onCancelDelete={() => setConfirmDeleteId(null)}
                    onDelete={() => handleDelete(sub.id)}
                    onToggleActive={() => handleToggleActive(sub.id, !sub.active)}
                  />
                )}
              </div>
            ))}

            {inactiveSubscriptions.length > 0 && (
              <>
                <p
                  className="text-[12px] font-semibold uppercase tracking-wide mt-2"
                  style={{ color: "var(--muted)" }}
                >
                  Deactivated
                </p>
                {inactiveSubscriptions.map((sub) => (
                  <div key={sub.id}>
                    <div
                      className="card p-4 cursor-pointer hover:opacity-80 transition-opacity"
                      style={{ opacity: 0.6 }}
                      onClick={() => setExpanded(expanded === sub.id ? null : sub.id)}
                    >
                      <div className="flex items-center gap-4">
                        <Avatar id={sub.id} name={sub.name} logoUrl={sub.logo_url} size="sm" />
                        <div className="flex-1 min-w-0">
                          <p className="font-semibold truncate">{sub.name}</p>
                          <p className="text-sm" style={{ color: "var(--muted)" }}>
                            {fmtRs(sub.amount)} / month
                          </p>
                        </div>
                        <span className={`px-3 py-1 rounded-full text-xs font-semibold ${statusColors.inactive}`}>
                          {statusLabels.inactive}
                        </span>
                      </div>
                    </div>

                    {expanded === sub.id && (
                      <SubscriptionDetail
                        sub={sub}
                        confirmDelete={confirmDeleteId === sub.id}
                        actionLoading={actionLoading === sub.id}
                        onMarkPaid={() => handleMarkPaid(sub.id)}
                        onAskDelete={() => setConfirmDeleteId(sub.id)}
                        onCancelDelete={() => setConfirmDeleteId(null)}
                        onDelete={() => handleDelete(sub.id)}
                        onToggleActive={() => handleToggleActive(sub.id, !sub.active)}
                      />
                    )}
                  </div>
                ))}
              </>
            )}
          </>
        )}
      </div>
    </main>
  );
}
