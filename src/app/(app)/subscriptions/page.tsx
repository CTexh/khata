"use client";

import { useEffect, useState, useCallback } from "react";
import { fmtRs } from "@/lib/format";

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

type Subscription = {
  id: string;
  user_id: string;
  name: string;
  amount: number;
  due_day: number;
  logo_url: string | null;
  next_payment_date: string;
  created_at: string;
  status: "due-today" | "due-soon" | "upcoming";
};

type FormState = {
  name: string;
  amount: string;
  date: string;
  logo_url: string;
  logoLoading: boolean;
};

function Avatar({ name, logoUrl, size }: { name: string; logoUrl: string | null; size: "sm" | "lg" }) {
  const [failed, setFailed] = useState(false);
  const dim = size === "sm" ? "w-10 h-10" : "w-16 h-16";
  const text = size === "sm" ? "text-xs" : "text-lg";

  if (logoUrl && !failed) {
    return (
      <img
        src={logoUrl}
        alt={name}
        className={`${dim} rounded object-cover shrink-0`}
        onError={() => setFailed(true)}
      />
    );
  }
  return (
    <div
      className={`${dim} rounded bg-gradient-to-br from-accent to-accent-2 flex items-center justify-center text-white ${text} font-bold shrink-0`}
    >
      {name.slice(0, 2).toUpperCase()}
    </div>
  );
}

function todayLocalYMD(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
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

  const loadSubscriptions = useCallback(async () => {
    try {
      setLoading(true);
      const res = await fetch("/api/subscriptions");
      if (!res.ok) throw new Error("Failed to load subscriptions");
      const data = await res.json();
      setSubscriptions(data);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadSubscriptions();
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
        setForm((prev) => ({ ...prev, logo_url: `https://logo.clearbit.com/${domain}` }));
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

    const dueDay = Number(form.date.split("-")[2]);

    try {
      const res = await fetch("/api/subscriptions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: form.name,
          amount: parseFloat(form.amount),
          due_day: dueDay,
          logo_url: form.logo_url || null,
        }),
      });

      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || "Failed to create subscription");
      }

      setForm({ name: "", amount: "", date: todayLocalYMD(), logo_url: "", logoLoading: false });
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

  const monthlyTotal = subscriptions.reduce((sum, sub) => sum + sub.amount, 0);
  const statusColors = {
    "due-today": "bg-red-500/20 text-red-600 dark:text-red-400",
    "due-soon": "bg-orange-500/20 text-orange-600 dark:text-orange-400",
    "upcoming": "bg-gray-500/20 text-gray-600 dark:text-gray-400",
  };
  const statusLabels = {
    "due-today": "DUE TODAY",
    "due-soon": "DUE SOON",
    "upcoming": "UPCOMING",
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
          onClick={() => setShowForm(!showForm)}
          className="btn btn-primary"
        >
          + Add
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
          <div className="flex gap-4">
            {form.logo_url && <Avatar name={form.name || "?"} logoUrl={form.logo_url} size="sm" />}
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
              onClick={() => setShowForm(false)}
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
          subscriptions.map((sub) => (
            <div key={sub.id}>
              <div
                className="card p-4 cursor-pointer hover:opacity-80 transition-opacity"
                onClick={() => setExpanded(expanded === sub.id ? null : sub.id)}
              >
                <div className="flex items-center gap-4">
                  <Avatar name={sub.name} logoUrl={sub.logo_url} size="sm" />
                  <div className="flex-1 min-w-0">
                    <p className="font-semibold truncate">{sub.name}</p>
                    <p className="text-sm" style={{ color: "var(--muted)" }}>
                      Due {new Date(sub.next_payment_date).toLocaleDateString()}
                    </p>
                  </div>
                  {justPaidId === sub.id ? (
                    <span className="px-3 py-1 rounded-full text-xs font-semibold bg-emerald-500/20 text-emerald-600 dark:text-emerald-400">
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
                <div className="card p-6 mt-2 flex flex-col gap-4">
                  <div className="flex items-start gap-4">
                    <Avatar name={sub.name} logoUrl={sub.logo_url} size="lg" />
                    <div className="flex-1">
                      <h3 className="text-lg font-bold">{sub.name}</h3>
                      <p className="text-2xl font-bold tabular">{fmtRs(sub.amount)}</p>
                      <p className="text-sm" style={{ color: "var(--muted)" }}>
                        Due {sub.due_day}th of each month
                      </p>
                      <p className="text-sm" style={{ color: "var(--muted)" }}>
                        Next payment: {new Date(sub.next_payment_date).toLocaleDateString()}
                      </p>
                    </div>
                  </div>

                  {confirmDeleteId === sub.id ? (
                    <div className="flex flex-col gap-3">
                      <p className="text-sm font-semibold" style={{ color: "var(--bad)" }}>
                        Delete {sub.name}? This cannot be undone.
                      </p>
                      <div className="flex gap-3">
                        <button
                          onClick={() => handleDelete(sub.id)}
                          disabled={actionLoading === sub.id}
                          className="btn btn-danger flex-1"
                        >
                          {actionLoading === sub.id ? "Deleting..." : "Yes, delete"}
                        </button>
                        <button
                          type="button"
                          onClick={() => setConfirmDeleteId(null)}
                          className="btn btn-ghost flex-1"
                        >
                          Cancel
                        </button>
                      </div>
                    </div>
                  ) : (
                    <div className="flex gap-3">
                      <button
                        onClick={() => handleMarkPaid(sub.id)}
                        disabled={actionLoading === sub.id}
                        className="btn btn-good flex-1"
                      >
                        {actionLoading === sub.id ? "Marking..." : "✓ Mark Paid"}
                      </button>
                      <button
                        onClick={() => setConfirmDeleteId(sub.id)}
                        disabled={actionLoading === sub.id}
                        className="btn btn-danger flex-1"
                      >
                        Delete
                      </button>
                    </div>
                  )}
                </div>
              )}
            </div>
          ))
        )}
      </div>
    </main>
  );
}
