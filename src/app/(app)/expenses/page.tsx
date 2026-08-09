"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { Expense, YearlyPoint } from "@/lib/db";
import { fmtRs, fmtDateLabel, MONTH_NAMES } from "@/lib/format";
import { WhatsAppIcon } from "@/components/icons";

type View = "month" | "year";

// Category colors mapping - optimized for light and dark modes
const CATEGORY_COLORS: Record<string, { bg: string; darkBg: string; text: string; darkText: string }> = {
  "Food & Dining": { bg: "#FFF3CD", darkBg: "#8B6F47", text: "#856404", darkText: "#FFE66D" },
  Food: { bg: "#FFF3CD", darkBg: "#8B6F47", text: "#856404", darkText: "#FFE66D" },
  Transport: { bg: "#D1ECF1", darkBg: "#0D5470", text: "#0C5460", darkText: "#A8E6FF" },
  Shopping: { bg: "#F8D7DA", darkBg: "#7A2B2B", text: "#721C24", darkText: "#FF6B6B" },
  Utilities: { bg: "#D4EDDA", darkBg: "#2D5C3E", text: "#155724", darkText: "#6FD676" },
  Entertainment: { bg: "#E2E3E5", darkBg: "#505050", text: "#383D41", darkText: "#C8C8C8" },
  Healthcare: { bg: "#F8D7DA", darkBg: "#7A2B2B", text: "#721C24", darkText: "#FF6B6B" },
  Travel: { bg: "#D1ECF1", darkBg: "#0D5470", text: "#0C5460", darkText: "#A8E6FF" },
  Groceries: { bg: "#D4EDDA", darkBg: "#2D5C3E", text: "#155724", darkText: "#6FD676" },
  Restaurants: { bg: "#FFF3CD", darkBg: "#8B6F47", text: "#856404", darkText: "#FFE66D" },
  "Mobile Wallet Transfer": { bg: "#CCE5FF", darkBg: "#1E3A8A", text: "#0C47A1", darkText: "#93C5FD" },
  "Bank Fees": { bg: "#FFD9D9", darkBg: "#6B1F1F", text: "#A91F1F", darkText: "#FCA5A5" },
};

function getCategoryColor(category?: string) {
  if (!category) return { bg: "var(--accent-soft)", darkBg: "var(--accent-soft)", text: "var(--accent)", darkText: "var(--accent)" };
  const color = CATEGORY_COLORS[category] || { bg: "#E9ECEF", darkBg: "#404040", text: "#495057", darkText: "#BFBFBF" };
  return color;
}

// Respects the app's manual theme toggle (data-theme attribute) first,
// falling back to the OS preference when the user hasn't overridden it.
function isDarkMode(): boolean {
  if (typeof document === "undefined") return false;
  const explicit = document.documentElement.dataset.theme;
  if (explicit === "dark") return true;
  if (explicit === "light") return false;
  return typeof window !== "undefined" && window.matchMedia("(prefers-color-scheme: dark)").matches;
}

function toLocalDateTime(iso: string): string {
  if (!iso) return "";
  const date = new Date(iso);
  return date.toISOString().slice(0, 16);
}

function fromLocalDateTime(local: string): string {
  if (!local) return "";
  return new Date(local + ":00Z").toISOString();
}

/* ---------- detail modal ---------- */

function DetailModal({
  expense,
  onClose,
  onSaved,
  onDelete,
}: {
  expense: Expense;
  onClose: () => void;
  onSaved: (updated: Expense) => void;
  onDelete: () => void;
}) {
  const [mode, setMode] = useState<"view" | "edit">("view");
  const [amount, setAmount] = useState("");
  const [note, setNote] = useState("");
  const [vendor, setVendor] = useState("");
  const [category, setCategory] = useState("");
  const [date, setDate] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const dialogRef = useRef<HTMLDivElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);

  // Lock background scroll while the modal is open
  useEffect(() => {
    const body = document.body;
    const scrollY = window.scrollY;
    const previous = {
      overflow: body.style.overflow,
      position: body.style.position,
      top: body.style.top,
      width: body.style.width,
    };

    body.style.overflow = "hidden";
    body.style.position = "fixed";
    body.style.top = `-${scrollY}px`;
    body.style.width = "100%";

    return () => {
      body.style.overflow = previous.overflow;
      body.style.position = previous.position;
      body.style.top = previous.top;
      body.style.width = previous.width;
      window.scrollTo(0, scrollY);
    };
  }, []);

  useEffect(() => {
    closeButtonRef.current?.focus({ preventScroll: true });
  }, []);

  const handleDialogKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "Escape") {
      event.preventDefault();
      onClose();
      return;
    }
    if (event.key !== "Tab") return;

    const focusable = dialogRef.current?.querySelectorAll<HTMLElement>(
      'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])'
    );
    if (!focusable?.length) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  };

  const startEdit = () => {
    setAmount(String(expense.amount));
    setNote(expense.note ?? "");
    setVendor(expense.vendor ?? "");
    setCategory(expense.category ?? "");
    setDate((expense.expense_datetime || expense.expense_date).slice(0, 10));
    setError("");
    setMode("edit");
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError("");
    const res = await fetch(`/api/expenses/${expense.id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        amount: Number(amount),
        note,
        expense_datetime: `${date}T00:00:00Z`,
        vendor,
        category,
      }),
    });
    setBusy(false);
    if (!res.ok) {
      const j = await res.json().catch(() => ({}));
      setError(j.error ?? "Something went wrong");
      return;
    }
    onSaved({
      ...expense,
      amount: Number(amount),
      note,
      vendor,
      category,
      expense_date: date,
      expense_datetime: `${date}T00:00:00Z`,
    });
    setMode("view");
  };

  const handleDelete = async () => {
    if (!confirm("Delete this expense? This can't be undone.")) return;
    await fetch(`/api/expenses/${expense.id}`, { method: "DELETE" });
    onDelete();
  };

  const dt = expense.expense_datetime ? new Date(expense.expense_datetime) : new Date(expense.expense_date);
  const categoryColor = getCategoryColor(expense.category);
  const isDark = isDarkMode();

  return (
    <div
      className="modal-backdrop fixed inset-0 z-50 flex items-center justify-center overflow-hidden backdrop-blur-sm"
      style={{ background: "rgba(0,0,0,0.75)", overscrollBehavior: "none" }}
      onClick={onClose}
    >
      <div
        ref={dialogRef}
        className="modal-panel card rise w-full max-w-xl overflow-y-auto"
        style={{ color: "var(--ink)", overscrollBehavior: "contain" }}
        onClick={(e) => e.stopPropagation()}
        onKeyDown={handleDialogKeyDown}
        role="dialog"
        aria-modal="true"
        aria-labelledby="expense-dialog-title"
      >
        {/* Header */}
        <div
          className="flex items-center justify-between p-5 border-b sticky top-0 z-10"
          style={{ borderColor: "var(--hairline)", background: "var(--surface)" }}
        >
          <h2 id="expense-dialog-title" className="text-[16px] font-semibold" style={{ color: "var(--ink)" }}>
            {mode === "edit" ? "Edit Expense" : "Expense Details"}
          </h2>
          <button
            ref={closeButtonRef}
            onClick={onClose}
            type="button"
            aria-label="Close expense dialog"
            className="inline-flex h-12 w-12 items-center justify-center text-[20px] opacity-50 hover:opacity-100 transition"
            style={{ color: "var(--ink-2)" }}
          >
            ✕
          </button>
        </div>

        {mode === "view" ? (
          <>
            {/* Content */}
            <div className="p-5 space-y-3">
              {/* Title and Amount row */}
              <div className="flex items-center justify-between gap-3">
                <p className="text-[14px] font-semibold flex-1 min-w-0 truncate" style={{ color: "var(--ink)" }}>{expense.vendor || "Expense"}</p>
                <p className="text-[18px] font-bold tabular shrink-0" style={{ color: "var(--ink)" }}>{fmtRs(expense.amount)}</p>
              </div>

              {/* Category Badge */}
              {expense.category && (
                <div>
                  <div
                    className="inline-block px-2.5 py-1 rounded-full text-[11px] font-semibold"
                    style={{
                      background: isDark ? "#334155" : categoryColor.bg,
                      color: isDark ? "#cbd5e1" : categoryColor.text,
                    }}
                  >
                    {expense.category}
                  </div>
                </div>
              )}

              {/* Divider */}
              <div style={{ background: "var(--hairline)", height: "1px" }} />

              {/* Details section */}
              {(expense.note) && (
                <div>
                  <p className="text-[12px] font-medium mb-1.5" style={{ color: "var(--muted)" }}>
                    Note
                  </p>
                  <p className="text-[13px] leading-relaxed" style={{ color: "var(--ink-2)" }}>{expense.note}</p>
                </div>
              )}

              <div>
                <p className="text-[12px] font-medium mb-1" style={{ color: "var(--muted)" }}>
                  Date
                </p>
                <p className="text-[13px]" style={{ color: "var(--ink-2)" }}>
                  {dt.toLocaleDateString("en-US", {
                    year: "numeric",
                    month: "short",
                    day: "numeric",
                  })}
                </p>
              </div>
            </div>

            {/* Footer */}
            <div className="form-actions p-5 border-t" style={{ borderColor: "var(--hairline)" }}>
              <button className="btn btn-ghost !text-[13px]" onClick={onClose}>
                Close
              </button>
              <button className="btn btn-ghost !text-[13px]" onClick={startEdit}>
                Edit
              </button>
              <button className="btn btn-danger !text-[13px]" onClick={handleDelete}>
                Delete
              </button>
            </div>
          </>
        ) : (
          <form onSubmit={handleSave}>
            <div className="p-5 space-y-4">
              <div>
                <label className="block text-[12px] font-medium mb-1.5" style={{ color: isDark ? "#b0b0b0" : "#666666" }}>
                  Amount
                </label>
                <input
                  className="field"
                  aria-label="Amount"
                  type="number"
                  inputMode="decimal"
                  min="0.01"
                  step="any"
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  required
                />
              </div>
              <div>
                <label className="block text-[12px] font-medium mb-1.5" style={{ color: isDark ? "#b0b0b0" : "#666666" }}>
                  Vendor/Merchant
                </label>
                <input
                  className="field"
                  aria-label="Vendor or merchant"
                  placeholder="Where did you spend? (optional)"
                  value={vendor}
                  onChange={(e) => setVendor(e.target.value)}
                />
              </div>
              <div>
                <label className="block text-[12px] font-medium mb-1.5" style={{ color: isDark ? "#b0b0b0" : "#666666" }}>
                  Category
                </label>
                <input
                  className="field"
                  aria-label="Category"
                  placeholder="Groceries, Transport, etc. (optional)"
                  value={category}
                  onChange={(e) => setCategory(e.target.value)}
                />
              </div>
              <div>
                <label className="block text-[12px] font-medium mb-1.5" style={{ color: isDark ? "#b0b0b0" : "#666666" }}>
                  Note
                </label>
                <input
                  className="field"
                  aria-label="Note"
                  placeholder="What was it for? (optional)"
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                />
              </div>
              <div className="min-w-0">
                <label className="block text-[12px] font-medium mb-1.5" style={{ color: isDark ? "#b0b0b0" : "#666666" }}>
                  Date
                </label>
                <input
                  className="field block min-w-0 max-w-full"
                  aria-label="Date"
                  style={{ inlineSize: "100%", minInlineSize: 0, maxInlineSize: "100%" }}
                  type="date"
                  value={date}
                  onChange={(e) => setDate(e.target.value)}
                  required
                />
              </div>
              {error && (
                <p className="text-[13px]" style={{ color: "var(--bad)" }} role="alert">
                  {error}
                </p>
              )}
            </div>

            {/* Footer */}
            <div className="form-actions p-5 border-t" style={{ borderColor: "var(--hairline)" }}>
              <button type="button" className="btn btn-ghost !text-[13px]" onClick={() => setMode("view")}>
                Cancel
              </button>
              <button className="btn btn-primary !text-[13px]" disabled={busy}>
                {busy ? "Saving…" : "Save changes"}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}

/* ---------- quick add / edit form ---------- */

function ExpenseForm({
  editing,
  onDone,
  onCancel,
}: {
  editing: Expense | null;
  onDone: () => void;
  onCancel: () => void;
}) {
  const [amount, setAmount] = useState(editing ? String(editing.amount) : "");
  const [note, setNote] = useState(editing?.note ?? "");
  const [datetime, setDateTime] = useState(
    editing ? toLocalDateTime(editing.expense_datetime || editing.expense_date) : toLocalDateTime(new Date().toISOString())
  );
  const [vendor, setVendor] = useState(editing?.vendor ?? "");
  const [category, setCategory] = useState(editing?.category ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError("");
    const url = editing ? `/api/expenses/${editing.id}` : "/api/expenses";
    const method = editing ? "PUT" : "POST";
    const res = await fetch(url, {
      method,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        amount: Number(amount),
        note,
        expense_datetime: fromLocalDateTime(datetime),
        vendor,
        category,
      }),
    });
    setBusy(false);
    if (!res.ok) {
      const j = await res.json().catch(() => ({}));
      setError(j.error ?? "Something went wrong");
      return;
    }
    onDone();
  };

  return (
    <form onSubmit={submit} className="card p-5 sm:p-6 rise flex flex-col gap-4">
      <p className="font-semibold">{editing ? "Edit expense" : "New expense"}</p>
      <div className="relative">
        <span
          className="absolute left-4 top-1/2 -translate-y-1/2 text-2xl font-bold pointer-events-none"
          style={{ color: "var(--muted)" }}
        >
          Rs
        </span>
        <input
          className="field tabular !text-3xl !font-bold !py-4 !pl-14"
          aria-label="Expense amount"
          placeholder="0"
          type="number"
          inputMode="decimal"
          min="0.01"
          step="any"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          required
        />
      </div>
      <div>
        <label className="block text-[13px] font-medium mb-1.5" style={{ color: "var(--muted)" }}>
          Note
        </label>
        <input
          className="field"
          aria-label="Expense note"
          placeholder="What was it for? (optional)"
          value={note}
          onChange={(e) => setNote(e.target.value)}
        />
      </div>
      <div>
        <label className="block text-[13px] font-medium mb-1.5" style={{ color: "var(--muted)" }}>
          Vendor/Merchant
        </label>
        <input
          className="field"
          aria-label="Vendor or merchant"
          placeholder="Where did you spend? (optional)"
          value={vendor}
          onChange={(e) => setVendor(e.target.value)}
        />
      </div>
      <div>
        <label className="block text-[13px] font-medium mb-1.5" style={{ color: "var(--muted)" }}>
          Category
        </label>
        <input
          className="field"
          aria-label="Expense category"
          placeholder="Groceries, Transport, etc. (optional)"
          value={category}
          onChange={(e) => setCategory(e.target.value)}
        />
      </div>
      <div>
        <label className="block text-[13px] font-medium mb-1.5" style={{ color: "var(--muted)" }}>
          Date & Time
        </label>
        <input
          className="field"
          aria-label="Expense date and time"
          type="datetime-local"
          value={datetime}
          onChange={(e) => setDateTime(e.target.value)}
          required
        />
      </div>
      {error && (
        <p className="text-[13px]" style={{ color: "var(--bad)" }} role="alert">
          {error}
        </p>
      )}
      <div className="form-actions">
        <button type="button" className="btn btn-ghost" onClick={onCancel}>
          Cancel
        </button>
        <button className="btn btn-primary" disabled={busy}>
          {busy ? "Saving…" : editing ? "Save changes" : "Add expense"}
        </button>
      </div>
    </form>
  );
}

/* ---------- expense row ---------- */

function ExpenseRow({
  expense,
  onView,
}: {
  expense: Expense;
  onView: () => void;
}) {
  const categoryColor = getCategoryColor(expense.category);
  const isDark = isDarkMode();

  return (
    <li className="border-b last:border-b-0" style={{ borderColor: "var(--hairline)" }}>
      <button
        type="button"
        className="grid w-full items-center gap-3 py-3 px-1 text-left cursor-pointer hover:opacity-75 transition"
        style={{ gridTemplateColumns: "32% minmax(0, 1fr) 24%" }}
        onClick={onView}
        aria-label={`View ${expense.vendor || "expense"}, ${fmtRs(expense.amount)}`}
      >
      {/* Category Badge - Fixed Width */}
      <div className="min-w-0">
        {expense.category && (
          <span
            className="max-w-full overflow-hidden text-ellipsis text-[11px] font-medium px-2.5 py-1 rounded-full whitespace-nowrap inline-block align-middle"
            style={{
              background: isDark ? "#334155" : categoryColor.bg,
              color: isDark ? "#cbd5e1" : categoryColor.text,
            }}
          >
            {expense.category}
          </span>
        )}
      </div>

      {/* Title and Date */}
      <div className="min-w-0">
        <p className="text-[14px] truncate font-medium" style={{ color: isDark ? "#f1f5f9" : "#1a1a1a" }}>{expense.vendor || "Expense"}</p>
        <p className="text-[12px] truncate" style={{ color: isDark ? "#94a3b8" : "#666666" }}>
          {fmtDateLabel(expense.expense_date)}
        </p>
      </div>

      {/* Amount - Right Aligned */}
      <span className="tabular text-[14px] font-semibold text-right" style={{ color: isDark ? "#f1f5f9" : "#1a1a1a" }}>
        {fmtRs(expense.amount)}
      </span>
      </button>
    </li>
  );
}

/* ---------- month view ---------- */

function MonthView({
  year,
  month,
  onNav,
  refreshKey,
  onViewDetail,
}: {
  year: number;
  month: number;
  onNav: (dir: -1 | 1) => void;
  refreshKey: number;
  onViewDetail: (e: Expense) => void;
}) {
  const [expenses, setExpenses] = useState<Expense[] | null>(null);
  const [search, setSearch] = useState("");

  const load = useCallback(async () => {
    setExpenses(null);
    const res = await fetch(`/api/expenses?year=${year}&month=${month}`);
    setExpenses(await res.json());
  }, [year, month]);

  useEffect(() => {
    load();
  }, [load, refreshKey]);

  const filtered = expenses
    ?.filter((e) => {
      if (!search.trim()) return true;
      const q = search.toLowerCase();
      return (
        String(e.amount).includes(q) ||
        (e.note?.toLowerCase().includes(q) ?? false) ||
        (e.vendor?.toLowerCase().includes(q) ?? false) ||
        (e.category?.toLowerCase().includes(q) ?? false)
      );
    })
    .sort((a, b) => new Date(b.expense_datetime || b.expense_date).getTime() - new Date(a.expense_datetime || a.expense_date).getTime());

  const total = filtered?.reduce((s, e) => s + e.amount, 0) ?? 0;

  return (
    <>
      <div className="card p-5 sm:p-6 rise">
        <div className="flex items-center justify-between mb-4">
          <button
            onClick={() => onNav(-1)}
            aria-label="Previous month"
            className="btn btn-nav !p-0 w-9 h-9"
          >
            ←
          </button>
          <p className="font-semibold text-[15px]">
            {MONTH_NAMES[month - 1]} {year}
          </p>
          <button
            onClick={() => onNav(1)}
            aria-label="Next month"
            className="btn btn-nav !p-0 w-9 h-9"
          >
            →
          </button>
        </div>

        <p className="text-[13px] font-medium" style={{ color: "var(--muted)" }}>
          {search ? "Filtered total" : "Spent this month"}
        </p>
        <p className="hero-num text-4xl font-bold tracking-tight mt-1 tabular">
          {fmtRs(total)}
        </p>
      </div>

      <section className="card p-5 sm:p-6 rise">
        <div className="flex items-center justify-between mb-4">
          <p className="font-semibold">History</p>
          <p className="text-[12px]" style={{ color: "var(--muted)" }}>
            {filtered?.length ?? 0} {filtered?.length === 1 ? "expense" : "expenses"}
          </p>
        </div>

        <input
          className="field mb-4"
          aria-label="Search expenses"
          placeholder="Search by amount, note, vendor, or category…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />

        {expenses === null ? (
          <p className="text-[13px] py-4" style={{ color: "var(--muted)" }} role="status">
            Loading…
          </p>
        ) : filtered?.length === 0 ? (
          <p className="text-[13px] py-4 text-center" style={{ color: "var(--muted)" }}>
            {search ? "No matching expenses" : `No expenses logged in ${MONTH_NAMES[month - 1]}.`}
          </p>
        ) : (
          <ul className="pb-2">
            {filtered?.map((e) => (
              <ExpenseRow
                key={e.id}
                expense={e}
                onView={() => onViewDetail(e)}
              />
            ))}
          </ul>
        )}
      </section>
    </>
  );
}

/* ---------- yearly bar chart ---------- */

function YearlyChart({ points }: { points: YearlyPoint[] }) {
  const max = Math.max(...points.map((p) => p.total), 1);
  const highestIdx = points.reduce(
    (best, p, i) => (p.total > points[best].total ? i : best),
    0
  );
  const MONTH_ABBR = ["J", "F", "M", "A", "M", "J", "J", "A", "S", "O", "N", "D"];

  return (
    <div className="flex items-end gap-1.5 sm:gap-2.5 h-40 mt-2">
      {points.map((p, i) => {
        const h = p.total > 0 ? Math.max((p.total / max) * 100, 4) : 2;
        const isHighest = i === highestIdx && p.total > 0;
        return (
          <div key={p.month} className="flex-1 flex flex-col items-center gap-1.5 h-full">
            <div className="flex-1 w-full flex items-end">
              <div
                className="w-full rounded-t-lg transition-[height] duration-500"
                style={{
                  height: `${h}%`,
                  background: isHighest
                    ? "linear-gradient(180deg, var(--accent-2), var(--accent))"
                    : "linear-gradient(180deg, var(--accent), var(--accent-2))",
                  opacity: isHighest ? 1 : 0.55,
                  boxShadow: isHighest ? "0 0 14px var(--accent-soft)" : undefined,
                }}
                title={`${MONTH_NAMES[i]}: ${fmtRs(p.total)} (${p.count} expense${p.count === 1 ? "" : "s"})`}
              />
            </div>
            <span
              className="text-[10px] font-medium"
              style={{ color: isHighest ? "var(--accent)" : "var(--muted)" }}
            >
              {MONTH_ABBR[i]}
            </span>
          </div>
        );
      })}
    </div>
  );
}

/* ---------- year view ---------- */

function YearView({
  year,
  onNav,
  refreshKey,
}: {
  year: number;
  onNav: (dir: -1 | 1) => void;
  refreshKey: number;
}) {
  const [data, setData] = useState<{ yearly: YearlyPoint[] } | null>(null);

  useEffect(() => {
    setData(null);
    fetch(`/api/expenses/stats?year=${year}`)
      .then((r) => r.json())
      .then(setData);
  }, [year, refreshKey]);

  const total = data?.yearly.reduce((s, p) => s + p.total, 0) ?? 0;
  const highest = data?.yearly.reduce(
    (best, p) => (p.total > best.total ? p : best),
    { month: 1, total: 0, count: 0 }
  );

  return (
    <div className="card p-5 sm:p-6 rise">
      <div className="flex items-center justify-between mb-4">
        <button
          onClick={() => onNav(-1)}
          aria-label="Previous year"
          className="btn btn-nav !p-0 w-9 h-9"
        >
          ←
        </button>
        <p className="font-semibold text-[15px]">{year}</p>
        <button
          onClick={() => onNav(1)}
          aria-label="Next year"
          className="btn btn-nav !p-0 w-9 h-9"
        >
          →
        </button>
      </div>

      <p className="text-[13px] font-medium" style={{ color: "var(--muted)" }}>
        Spent in {year}
      </p>
      <p className="hero-num text-4xl font-bold tracking-tight mt-1 tabular">{fmtRs(total)}</p>

      {data ? <YearlyChart points={data.yearly} /> : <div className="h-40 mt-2" />}

      {highest && highest.total > 0 && (
        <div className="tile px-3 py-2.5 mt-5 inline-flex">
          <div>
            <p className="text-[11px] font-medium" style={{ color: "var(--muted)" }}>
              Highest-spending month
            </p>
            <p className="text-sm font-semibold mt-0.5">
              {MONTH_NAMES[highest.month - 1]} — <span className="tabular">{fmtRs(highest.total)}</span>
            </p>
          </div>
        </div>
      )}
    </div>
  );
}

/* ---------- page ---------- */

export default function ExpensesPage() {
  const now = new Date();
  const [view, setView] = useState<View>("month");
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth() + 1);
  const [chartYear, setChartYear] = useState(now.getFullYear());
  const [adding, setAdding] = useState(false);
  const [viewingDetail, setViewingDetail] = useState<Expense | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const [sendingReport, setSendingReport] = useState(false);
  const [reportMsg, setReportMsg] = useState<{ text: string; bad?: boolean } | null>(null);

  const sendWhatsAppReport = async () => {
    setSendingReport(true);
    setReportMsg(null);
    const res = await fetch("/api/expenses/whatsapp-report", { method: "POST" });
    setSendingReport(false);
    if (res.ok) {
      setReportMsg({ text: "Sent — check WhatsApp." });
    } else {
      const j = await res.json().catch(() => ({}));
      setReportMsg({ text: j.error ?? "Couldn't send.", bad: true });
    }
  };

  const navMonth = (dir: -1 | 1) => {
    let m = month + dir;
    let y = year;
    if (m < 1) {
      m = 12;
      y -= 1;
    } else if (m > 12) {
      m = 1;
      y += 1;
    }
    setMonth(m);
    setYear(y);
  };

  const refresh = () => setRefreshKey((k) => k + 1);

  const views: { id: View; label: string }[] = [
    { id: "month", label: "This month" },
    { id: "year", label: "Yearly" },
  ];

  return (
    <>
      {!adding && !viewingDetail && (
        <div className="flex flex-col items-end -mt-2 gap-2">
          <button className="btn btn-expense" onClick={() => setAdding(true)}>
            Log expense
          </button>
          <button
            className="btn btn-whatsapp !p-0 w-11 h-11"
            onClick={sendWhatsAppReport}
            disabled={sendingReport}
            aria-label="Send current total to WhatsApp"
            title="Send current total to WhatsApp"
          >
            <WhatsAppIcon size={19} className={sendingReport ? undefined : "btn-whatsapp-icon"} />
          </button>
        </div>
      )}

      {reportMsg && !adding && !viewingDetail && (
        <p
          className="text-[13px] -mt-2 text-right"
          style={{ color: reportMsg.bad ? "var(--bad)" : "var(--good)" }}
          role="status"
        >
          {reportMsg.text}
        </p>
      )}

      {adding && (
        <ExpenseForm
          editing={null}
          onCancel={() => setAdding(false)}
          onDone={() => {
            setAdding(false);
            refresh();
          }}
        />
      )}

      {viewingDetail && (
        <DetailModal
          expense={viewingDetail}
          onClose={() => setViewingDetail(null)}
          onSaved={(updated) => {
            setViewingDetail(updated);
            refresh();
          }}
          onDelete={() => {
            setViewingDetail(null);
            refresh();
          }}
        />
      )}

      <div className="flex items-center gap-2">
        {views.map((v) => (
          <button
            key={v.id}
            onClick={() => setView(v.id)}
            className={`btn !py-2 text-[13px] ${view === v.id ? "btn-primary" : "btn-ghost"}`}
          >
            {v.label}
          </button>
        ))}
      </div>

      {view === "month" && (
        <MonthView
          year={year}
          month={month}
          onNav={navMonth}
          refreshKey={refreshKey}
          onViewDetail={setViewingDetail}
        />
      )}
      {view === "year" && (
        <YearView
          year={chartYear}
          onNav={(dir) => setChartYear((y) => y + dir)}
          refreshKey={refreshKey}
        />
      )}

      <footer className="text-center text-[12px] py-4" style={{ color: "var(--muted)" }}>
        Mera Khata · your everyday spending, sorted
      </footer>
    </>
  );
}
