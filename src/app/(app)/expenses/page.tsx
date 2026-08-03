"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { Expense, YearlyPoint } from "@/lib/db";
import { fmtRs, fmtDateLabel, MONTH_NAMES, todayLocalYMD } from "@/lib/format";

type View = "month" | "year";

// Category colors mapping
const CATEGORY_COLORS: Record<string, { bg: string; text: string }> = {
  "Food & Dining": { bg: "#FFF3CD", text: "#856404" },
  Food: { bg: "#FFF3CD", text: "#856404" },
  Transport: { bg: "#D1ECF1", text: "#0C5460" },
  Shopping: { bg: "#F8D7DA", text: "#721C24" },
  Utilities: { bg: "#D4EDDA", text: "#155724" },
  Entertainment: { bg: "#E2E3E5", text: "#383D41" },
  Healthcare: { bg: "#F8D7DA", text: "#721C24" },
  Travel: { bg: "#D1ECF1", text: "#0C5460" },
  Groceries: { bg: "#D4EDDA", text: "#155724" },
  Restaurants: { bg: "#FFF3CD", text: "#856404" },
};

function getCategoryColor(category?: string) {
  if (!category) return { bg: "var(--accent-soft)", text: "var(--accent)" };
  return CATEGORY_COLORS[category] || { bg: "#E9ECEF", text: "#495057" };
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
  onEdit,
  onDelete,
}: {
  expense: Expense;
  onClose: () => void;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const handleDelete = async () => {
    if (!confirm("Delete this expense? This can't be undone.")) return;
    await fetch(`/api/expenses/${expense.id}`, { method: "DELETE" });
    onDelete();
  };

  const dt = expense.expense_datetime ? new Date(expense.expense_datetime) : new Date(expense.expense_date);
  const categoryColor = getCategoryColor(expense.category);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: "rgba(0,0,0,0.5)" }}
      onClick={onClose}
    >
      <div
        className="bg-white dark:bg-gray-900 rounded-lg p-6 max-w-sm w-full"
        style={{ boxShadow: "0 10px 40px rgba(0,0,0,0.2)" }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between mb-4">
          <p className="text-[15px] font-semibold">Expense Details</p>
          <button
            onClick={onClose}
            className="text-[20px] opacity-50 hover:opacity-100 transition"
          >
            ✕
          </button>
        </div>

        <div className="space-y-3">
          <div>
            <p className="text-[12px] font-medium" style={{ color: "var(--muted)" }}>
              Amount
            </p>
            <p className="text-[24px] font-bold tabular">{fmtRs(expense.amount)}</p>
          </div>

          {expense.note && (
            <div>
              <p className="text-[12px] font-medium" style={{ color: "var(--muted)" }}>
                Note
              </p>
              <p className="text-[14px]">{expense.note}</p>
            </div>
          )}

          {expense.vendor && (
            <div>
              <p className="text-[12px] font-medium" style={{ color: "var(--muted)" }}>
                Vendor
              </p>
              <p className="text-[14px]">{expense.vendor}</p>
            </div>
          )}

          {expense.category && (
            <div>
              <p className="text-[12px] font-medium" style={{ color: "var(--muted)" }}>
                Category
              </p>
              <div
                className="inline-block px-3 py-1 rounded-full text-[12px] font-medium mt-1"
                style={{
                  background: categoryColor.bg,
                  color: categoryColor.text,
                }}
              >
                {expense.category}
              </div>
            </div>
          )}

          <div>
            <p className="text-[12px] font-medium" style={{ color: "var(--muted)" }}>
              Date & Time
            </p>
            <p className="text-[14px]">
              {dt.toLocaleDateString("en-US", {
                weekday: "short",
                year: "numeric",
                month: "short",
                day: "numeric",
              })}
              {" at "}
              {dt.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" })}
            </p>
          </div>

          <div>
            <p className="text-[12px] font-medium" style={{ color: "var(--muted)" }}>
              Created
            </p>
            <p className="text-[14px]">
              {new Date(expense.created_at).toLocaleDateString("en-US", {
                year: "numeric",
                month: "short",
                day: "numeric",
              })}
            </p>
          </div>
        </div>

        <div className="flex gap-2 justify-end mt-6">
          <button className="btn btn-ghost" onClick={onClose}>
            Close
          </button>
          <button className="btn btn-ghost" onClick={onEdit}>
            Edit
          </button>
          <button className="btn btn-danger" onClick={handleDelete}>
            Delete
          </button>
        </div>
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
  const amountRef = useRef<HTMLInputElement>(null);

  useEffect(() => amountRef.current?.focus(), []);

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
          ref={amountRef}
          className="field tabular !text-3xl !font-bold !py-4 !pl-14"
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
          type="datetime-local"
          value={datetime}
          onChange={(e) => setDateTime(e.target.value)}
          required
        />
      </div>
      {error && (
        <p className="text-[13px]" style={{ color: "var(--bad)" }}>
          {error}
        </p>
      )}
      <div className="flex gap-2 justify-end">
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

  return (
    <li
      className="flex items-center gap-3 py-3 border-b last:border-b-0 cursor-pointer hover:opacity-75 transition"
      style={{ borderColor: "var(--hairline)" }}
      onClick={onView}
    >
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2 mb-0.5">
          <p className="text-[14px] truncate font-medium">{expense.vendor || "Expense"}</p>
          {expense.category && (
            <span
              className="text-[11px] font-medium px-2 py-0.5 rounded-full shrink-0 whitespace-nowrap"
              style={{
                background: categoryColor.bg,
                color: categoryColor.text,
              }}
            >
              {expense.category}
            </span>
          )}
        </div>
        <div className="flex items-center justify-between gap-2">
          <p className="text-[12px] truncate" style={{ color: "var(--muted)" }}>
            {fmtDateLabel(expense.expense_date)}
          </p>
        </div>
      </div>
      <span className="tabular text-[14px] font-semibold shrink-0">
        {fmtRs(expense.amount)}
      </span>
    </li>
  );
}

/* ---------- month view ---------- */

function MonthView({
  year,
  month,
  onNav,
  refreshKey,
  onEdit,
  onViewDetail,
}: {
  year: number;
  month: number;
  onNav: (dir: -1 | 1) => void;
  refreshKey: number;
  onEdit: (e: Expense) => void;
  onViewDetail: (e: Expense) => void;
}) {
  const [expenses, setExpenses] = useState<Expense[] | null>(null);
  const [search, setSearch] = useState("");
  const [bump, setBump] = useState(0);

  const load = useCallback(async () => {
    setExpenses(null);
    const res = await fetch(`/api/expenses?year=${year}&month=${month}`);
    setExpenses(await res.json());
  }, [year, month]);

  useEffect(() => {
    load();
  }, [load, refreshKey, bump]);

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
          placeholder="Search by amount, note, vendor, or category…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          autoFocus={search !== ""}
        />

        {expenses === null ? (
          <p className="text-[13px] py-4" style={{ color: "var(--muted)" }}>
            Loading…
          </p>
        ) : filtered?.length === 0 ? (
          <p className="text-[13px] py-4 text-center" style={{ color: "var(--muted)" }}>
            {search ? "No matching expenses" : `No expenses logged in ${MONTH_NAMES[month - 1]}.`}
          </p>
        ) : (
          <ul>
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
  const [editing, setEditing] = useState<Expense | null>(null);
  const [viewingDetail, setViewingDetail] = useState<Expense | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);

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
      <div className="flex items-center justify-end -mt-2">
        {!adding && !editing && !viewingDetail && (
          <button className="btn btn-expense" onClick={() => setAdding(true)}>
            Log expense
          </button>
        )}
      </div>

      {(adding || editing) && (
        <ExpenseForm
          editing={editing}
          onCancel={() => {
            setAdding(false);
            setEditing(null);
          }}
          onDone={() => {
            setAdding(false);
            setEditing(null);
            refresh();
          }}
        />
      )}

      {viewingDetail && (
        <DetailModal
          expense={viewingDetail}
          onClose={() => setViewingDetail(null)}
          onEdit={() => {
            setEditing(viewingDetail);
            setViewingDetail(null);
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
          onEdit={setEditing}
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
