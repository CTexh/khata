"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { fmtRs, fmtDateLabel } from "@/lib/format";
import { categoryVars } from "@/lib/category-style";
import { CategoryIcon, LeafIcon } from "@/components/CategoryIcon";
import { useCached } from "@/lib/swr";
import { ArrowUpIcon, HandshakeIcon, RepeatIcon } from "@/components/icons";

type Expense = {
  id: string;
  amount: number;
  note: string;
  vendor?: string;
  category?: string;
  expense_date: string;
  expense_datetime: string;
};

type Period = "today" | "week" | "month";

// Categories named on Home before the rest fold into "Other", and how many
// expenses the list shows before "See all" takes over.
const BREAKDOWN_SHOWN = 4;
const RECENT_SHOWN = 5;

const PERIODS: { id: Period; label: string; heading: string; compare: string }[] = [
  { id: "today", label: "Today", heading: "Today's expense", compare: "yesterday" },
  { id: "week", label: "This Week", heading: "This week's expense", compare: "last week" },
  { id: "month", label: "This Month", heading: "This month's expense", compare: "last month" },
];


// Local calendar days, as YYYY-MM-DD, matching how expense dates are stored.
function ymd(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function ranges(now: Date) {
  const day = (offset: number) => {
    const d = new Date(now);
    d.setDate(d.getDate() + offset);
    return ymd(d);
  };
  const weekday = (now.getDay() + 6) % 7; // Monday = 0
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const prevMonthStart = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  // The same number of days into last month, so "vs last month" compares like with like.
  const prevMonthSameDay = new Date(now.getFullYear(), now.getMonth() - 1, Math.min(now.getDate(), new Date(now.getFullYear(), now.getMonth(), 0).getDate()));
  return {
    today: { from: day(0), to: day(0), prevFrom: day(-1), prevTo: day(-1) },
    week: { from: day(-weekday), to: day(0), prevFrom: day(-weekday - 7), prevTo: day(-7) },
    month: { from: ymd(monthStart), to: day(0), prevFrom: ymd(prevMonthStart), prevTo: ymd(prevMonthSameDay) },
  } satisfies Record<Period, { from: string; to: string; prevFrom: string; prevTo: string }>;
}

function sum(list: Expense[], from: string, to: string) {
  return list.filter((e) => e.expense_date >= from && e.expense_date <= to).reduce((s, e) => s + e.amount, 0);
}

export default function Home() {
  const [period, setPeriod] = useState<Period>("today");
  // Everything here comes from the shared cache: a return visit renders at
  // once from the last answer while fresh figures load in the background.
  const now = new Date();
  const prevDate = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const thisMonth = useCached<Expense[]>(`/api/expenses?year=${now.getFullYear()}&month=${now.getMonth() + 1}`);
  const lastMonth = useCached<Expense[]>(`/api/expenses?year=${prevDate.getFullYear()}&month=${prevDate.getMonth() + 1}`);
  const peopleQ = useCached<{ balance: number }[]>("/api/people");
  const subsQ = useCached<{ amount: number; active: number | boolean; paid_this_period: boolean }[]>("/api/subscriptions");

  const loadError = thisMonth.failedStatus !== undefined && !thisMonth.data;
  // This month and last month cover every range shown, including a week
  // that started last month and the "vs last month" comparison.
  const expenses = useMemo(
    () => (thisMonth.data ? [...thisMonth.data, ...(lastMonth.data ?? [])] : loadError ? [] : null),
    [thisMonth.data, lastMonth.data, loadError]
  );
  const owed = useMemo(() => {
    if (!peopleQ.data) return null;
    const owing = peopleQ.data.filter((p) => p.balance > 0.005);
    return { total: owing.reduce((s, p) => s + p.balance, 0), people: owing.length };
  }, [peopleQ.data]);
  const subs = useMemo(() => {
    if (!subsQ.data) return null;
    const unpaid = subsQ.data.filter((s) => s.active && !s.paid_this_period);
    return { due: unpaid.reduce((s, x) => s + x.amount, 0), count: unpaid.length };
  }, [subsQ.data]);

  useEffect(() => {
    try {
      const saved = localStorage.getItem("khata-home-period");
      if (saved === "today" || saved === "week" || saved === "month") setPeriod(saved);
    } catch {}
  }, []);

  const choose = (p: Period) => {
    setPeriod(p);
    try {
      localStorage.setItem("khata-home-period", p);
    } catch {}
  };

  const view = useMemo(() => {
    if (!expenses) return null;
    const r = ranges(new Date())[period];
    const total = sum(expenses, r.from, r.to);
    const previous = sum(expenses, r.prevFrom, r.prevTo);
    const items = expenses
      .filter((e) => e.expense_date >= r.from && e.expense_date <= r.to)
      .sort(
        (a, b) =>
          b.expense_date.localeCompare(a.expense_date) ||
          (b.expense_datetime || "").localeCompare(a.expense_datetime || "")
      );
    const change = previous > 0 ? Math.round(((total - previous) / previous) * 100) : null;

    // Where the money went, biggest first. Everything past the fourth is one
    // "Other" line: a long list here would bury the rest of the page.
    const byCategory = new Map<string, number>();
    for (const e of items) {
      const key = e.category || "Uncategorised";
      byCategory.set(key, (byCategory.get(key) ?? 0) + e.amount);
    }
    const ranked = [...byCategory.entries()]
      .map(([category, amount]) => ({ category, amount }))
      .sort((a, b) => b.amount - a.amount);
    const lead = ranked.slice(0, BREAKDOWN_SHOWN);
    const rest = ranked.slice(BREAKDOWN_SHOWN);
    const breakdown = rest.length
      ? [...lead, { category: "Other", amount: rest.reduce((sum, r) => sum + r.amount, 0) }]
      : lead;

    return { total, previous, change, items, breakdown, categories: ranked.length };
  }, [expenses, period]);

  const meta = PERIODS.find((p) => p.id === period)!;

  return (
    <div className="flex flex-col gap-5 pb-2">
      <div className="segmented rise" role="group" aria-label="Period">
        {PERIODS.map((p) => (
          <button key={p.id} type="button" aria-pressed={period === p.id} onClick={() => choose(p.id)}>
            {p.label}
          </button>
        ))}
      </div>

      <section className="hero-panel p-6 sm:p-7 rise" aria-live="polite">
        <svg className="hero-deco" viewBox="0 0 400 200" preserveAspectRatio="none" aria-hidden style={{ opacity: 0.18 }}>
          {[0, 14, 28].map((o) => (
            <path key={o} d={`M-20 ${70 + o} C 90 ${-10 + o}, 190 ${190 + o}, 420 ${60 + o}`} fill="none" stroke="#8b7bff" strokeWidth="1.2" />
          ))}
        </svg>
        <p className="hero-muted text-[14px] font-semibold">{meta.heading}</p>
        <p className="mt-2 flex items-baseline gap-2 tabular">
          <span className="hero-muted text-[22px] font-bold">Rs</span>
          <span className="text-[46px] sm:text-[52px] font-extrabold leading-none tracking-tight">
            {view ? fmtRs(view.total).replace(/^−?Rs\s/, "") : <span className="skeleton align-middle" style={{ width: 150, height: 40, opacity: 0.3 }} />}
          </span>
        </p>
        <div className="mt-5 flex flex-wrap items-center gap-x-5 gap-y-2 text-[14px]">
          {view && view.change !== null ? (
            <span className="flex items-center gap-1.5">
              <span
                className="font-extrabold flex items-center gap-1"
                style={{ color: view.change > 0 ? "#ffb4a8" : "#7ee2a8" }}
              >
                <span style={{ display: "inline-flex", transform: view.change > 0 ? "none" : "rotate(180deg)" }}>
                  <ArrowUpIcon size={16} />
                </span>
                {Math.abs(view.change)}%
              </span>
              <span className="hero-muted">vs {meta.compare}</span>
            </span>
          ) : view ? (
            <span className="hero-muted">Nothing to compare with {meta.compare}</span>
          ) : null}
          {view && (
            <span className="hero-muted">
              {view.items.length} {view.items.length === 1 ? "expense" : "expenses"}
            </span>
          )}
        </div>
      </section>

      <section className="grid grid-cols-2 gap-3">
        <Link href="/udhar-khata" className="card p-4 rise flex flex-col gap-3">
          <span className="icon-tile !w-10 !h-10 !rounded-xl" style={{ background: "var(--accent-soft)", color: "var(--accent)" }}>
            <HandshakeIcon size={20} />
          </span>
          <span>
            <span className="block text-[12px] font-semibold" style={{ color: "var(--muted)" }}>
              Owed to you
            </span>
            <span className="block text-[18px] font-extrabold tabular truncate">
              {owed ? fmtRs(owed.total) : <span className="skeleton" style={{ width: 80, height: 18 }} />}
            </span>
            <span className="block text-[12px]" style={{ color: "var(--muted)" }}>
              {owed ? `${owed.people} ${owed.people === 1 ? "person" : "people"}` : " "}
            </span>
          </span>
        </Link>
        <Link href="/subscriptions" className="card p-4 rise flex flex-col gap-3">
          <span className="icon-tile !w-10 !h-10 !rounded-xl" style={{ background: "var(--good-soft)", color: "var(--good)" }}>
            <RepeatIcon size={20} />
          </span>
          <span>
            <span className="block text-[12px] font-semibold" style={{ color: "var(--muted)" }}>
              Subscriptions due
            </span>
            <span className="block text-[18px] font-extrabold tabular truncate">
              {subs ? fmtRs(subs.due) : <span className="skeleton" style={{ width: 80, height: 18 }} />}
            </span>
            <span className="block text-[12px]" style={{ color: "var(--muted)" }}>
              {subs ? (subs.count ? `${subs.count} unpaid` : "All paid") : " "}
            </span>
          </span>
        </Link>
      </section>

      {view && view.total > 0 && (
        // Where it went, at a glance: one bar for the shape of the period and
        // the biggest few named underneath. The full breakdown, and filtering
        // by category, live in Mera Khata.
        <Link href="/expenses" className="card p-4 rise block" aria-label="Where your money went - open Mera Khata">
          <div className="flex items-baseline justify-between gap-3">
            <h2 className="text-[15px] font-extrabold">Where it went</h2>
            <span className="text-[12px]" style={{ color: "var(--muted)" }}>
              {view.categories} {view.categories === 1 ? "category" : "categories"}
            </span>
          </div>
          <div className="mt-3 flex h-2 w-full overflow-hidden rounded-full gap-[2px]" style={{ background: "var(--hairline)" }} aria-hidden>
            {view.breakdown.map((b) => (
              <span
                key={b.category}
                style={{ width: `${(b.amount / view.total) * 100}%`, background: categoryVars(b.category).fg, minWidth: 3 }}
              />
            ))}
          </div>
          <ul className="mt-3 grid grid-cols-2 gap-x-4 gap-y-1.5">
            {view.breakdown.map((b) => (
              <li key={b.category} className="flex items-center gap-2 min-w-0">
                <span className="h-2 w-2 rounded-full shrink-0" style={{ background: categoryVars(b.category).fg }} aria-hidden />
                <span className="text-[13px] font-semibold truncate">{b.category}</span>
                <span className="text-[13px] font-extrabold tabular ml-auto shrink-0">{fmtRs(b.amount)}</span>
              </li>
            ))}
          </ul>
        </Link>
      )}

      <section className="flex flex-col gap-3" aria-labelledby="recent-title">
        <div className="section-head">
          <h2 id="recent-title" className="section-title">
            {meta.label}
          </h2>
          <Link href="/expenses" className="pill-link">
            See all
          </Link>
        </div>

        {view === null ? (
          [0, 1, 2].map((i) => (
            <div key={i} className="card p-4 flex items-center gap-3">
              <span className="icon-tile skeleton !rounded-2xl" />
              <span className="flex-1 flex flex-col gap-2">
                <span className="skeleton" style={{ width: "50%", height: 14 }} />
                <span className="skeleton" style={{ width: "30%", height: 12 }} />
              </span>
            </div>
          ))
        ) : loadError ? (
          <div className="card p-6 text-center text-[14px]" style={{ color: "var(--bad)" }} role="alert">
            Couldn&apos;t load your expenses. Check your connection and try again.
          </div>
        ) : view.items.length === 0 ? (
          <div className="card p-6 text-center">
            <p className="flex justify-center" style={{ color: "var(--muted)" }} aria-hidden>
              <LeafIcon size={30} />
            </p>
            <p className="font-bold mt-1">No expenses {period === "today" ? "today" : period === "week" ? "this week" : "this month"}</p>
            <p className="text-[13px] mt-1" style={{ color: "var(--muted)" }}>
              Anything you spend shows up here.
            </p>
            <Link href="/expenses?add=1" className="btn btn-expense mt-4 inline-flex">
              Log expense
            </Link>
          </div>
        ) : (
          view.items.slice(0, RECENT_SHOWN).map((e) => {
            const colors = categoryVars(e.category);
            const note = e.note.replace(/^(WhatsApp|Assistant):\s*/, "");
            return (
              // Opens this expense rather than the list it is in, so it does
              // not have to be found again.
              <Link
                key={e.id}
                href={`/expenses?open=${encodeURIComponent(e.id)}`}
                className="card p-4 flex items-center gap-3 rise"
              >
                <span className="icon-tile" style={{ background: colors.bg, color: colors.fg }} aria-hidden>
                  <CategoryIcon category={e.category} size={22} />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-[16px] font-extrabold truncate">{e.category || "Uncategorised"}</span>
                  <span className="block text-[14px] truncate" style={{ color: "var(--ink-2)" }}>
                    {e.vendor || note || "No description"}
                  </span>
                  <span className="block text-[12px] truncate" style={{ color: "var(--muted)" }}>
                    {period === "today" ? (e.vendor && note && note !== e.vendor ? note : "Today") : fmtDateLabel(e.expense_date)}
                  </span>
                </span>
                <span className="text-[16px] font-extrabold tabular shrink-0 self-start pt-0.5">{fmtRs(e.amount)}</span>
              </Link>
            );
          })
        )}
        {view && view.items.length > RECENT_SHOWN && (
          <Link href="/expenses" className="text-center text-[14px] font-bold py-2" style={{ color: "var(--accent)" }}>
            {view.items.length - RECENT_SHOWN} more in Mera Khata
          </Link>
        )}
      </section>
    </div>
  );
}
