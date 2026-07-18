"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { Expense, YearlyPoint } from "@/lib/db";
import { fmtRs, fmtDateLabel, MONTH_NAMES, todayLocalYMD } from "@/lib/format";

type View = "month" | "year";

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
  const [date, setDate] = useState(editing?.expense_date ?? todayLocalYMD());
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
      body: JSON.stringify({ amount: Number(amount), note, date }),
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
    <form onSubmit={submit} className="card p-5 sm:p-6 rise flex flex-col gap-3">
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
      <input
        className="field"
        placeholder="What was it for? (optional)"
        value={note}
        onChange={(e) => setNote(e.target.value)}
      />
      <div className="flex items-center gap-2">
        <label className="text-[13px] shrink-0" style={{ color: "var(--muted)" }}>
          Date
        </label>
        <input
          className="field"
          type="date"
          value={date}
          max={todayLocalYMD()}
          onChange={(e) => setDate(e.target.value)}
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
          {busy ? "Saving…" : editing ? "💾 Save changes" : "➕ Add expense"}
        </button>
      </div>
    </form>
  );
}

/* ---------- expense row ---------- */

function ExpenseRow({
  expense,
  onEdit,
  onDeleted,
}: {
  expense: Expense;
  onEdit: () => void;
  onDeleted: () => void;
}) {
  const remove = async () => {
    if (!confirm("Delete this expense? This can't be undone.")) return;
    await fetch(`/api/expenses/${expense.id}`, { method: "DELETE" });
    onDeleted();
  };

  return (
    <li
      className="flex items-center gap-3 py-3 border-b last:border-b-0"
      style={{ borderColor: "var(--hairline)" }}
    >
      <div className="min-w-0 flex-1">
        <p className="text-[14px] truncate font-medium">{expense.note || "Expense"}</p>
        <p className="text-[12px]" style={{ color: "var(--muted)" }}>
          {fmtDateLabel(expense.expense_date)}
          {" · logged "}
          {new Date(expense.created_at).toLocaleTimeString("en-PK", {
            hour: "numeric",
            minute: "2-digit",
          })}
        </p>
      </div>
      <span className="tabular text-[14px] font-semibold shrink-0">
        {fmtRs(expense.amount)}
      </span>
      <div className="flex gap-1 shrink-0">
        <button
          onClick={onEdit}
          aria-label="Edit expense"
          className="btn btn-ghost !p-0 w-8 h-8 text-[13px]"
        >
          ✏️
        </button>
        <button
          onClick={remove}
          aria-label="Delete expense"
          className="btn btn-danger !p-0 w-8 h-8 text-[13px]"
        >
          🗑
        </button>
      </div>
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
}: {
  year: number;
  month: number;
  onNav: (dir: -1 | 1) => void;
  refreshKey: number;
  onEdit: (e: Expense) => void;
}) {
  const [expenses, setExpenses] = useState<Expense[] | null>(null);
  const [bump, setBump] = useState(0);

  const load = useCallback(async () => {
    setExpenses(null);
    const res = await fetch(`/api/expenses?year=${year}&month=${month}`);
    setExpenses(await res.json());
  }, [year, month]);

  useEffect(() => {
    load();
  }, [load, refreshKey, bump]);

  const total = expenses?.reduce((s, e) => s + e.amount, 0) ?? 0;

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
          Spent this month
        </p>
        <p className="hero-num text-4xl font-bold tracking-tight mt-1 tabular">
          {fmtRs(total)}
        </p>
      </div>

      <section className="card p-5 sm:p-6 rise">
        <p className="font-semibold mb-2">History</p>
        {expenses === null ? (
          <p className="text-[13px] py-4" style={{ color: "var(--muted)" }}>
            Loading…
          </p>
        ) : expenses.length === 0 ? (
          <p className="text-[13px] py-4 text-center" style={{ color: "var(--muted)" }}>
            No expenses logged in {MONTH_NAMES[month - 1]}.
          </p>
        ) : (
          <ul>
            {expenses.map((e) => (
              <ExpenseRow
                key={e.id}
                expense={e}
                onEdit={() => onEdit(e)}
                onDeleted={() => setBump((b) => b + 1)}
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
      <div className="flex items-center justify-between -mt-2">
        <h2 className="text-[17px] font-bold">🧾 Mera Khata</h2>
        {!adding && !editing && (
          <button className="btn btn-primary" onClick={() => setAdding(true)}>
            <span>➕</span> Log expense
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
