"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { fmtRs, fmtDateLabel } from "@/lib/format";
import { categoryEmoji, categoryVars } from "@/lib/category-style";
import { ASSISTANT_DRAFT_KEY } from "@/lib/assistant-draft";
import { ArrowUpIcon, CameraIcon, HandshakeIcon, MicIcon, RepeatIcon, SparkleIcon } from "@/components/icons";

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

const PERIODS: { id: Period; label: string; heading: string; compare: string }[] = [
  { id: "today", label: "Today", heading: "Today's expense", compare: "yesterday" },
  { id: "week", label: "This Week", heading: "This week's expense", compare: "last week" },
  { id: "month", label: "This Month", heading: "This month's expense", compare: "last month" },
];


const SUGGESTIONS = ["fuel 3000 shell", "what did I spend this week?", "who owes me?", "mark Netflix paid"];

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
  const router = useRouter();
  const [period, setPeriod] = useState<Period>("today");
  const [expenses, setExpenses] = useState<Expense[] | null>(null);
  const [owed, setOwed] = useState<{ total: number; people: number } | null>(null);
  const [subs, setSubs] = useState<{ due: number; count: number } | null>(null);
  const [draft, setDraft] = useState("");
  const [loadError, setLoadError] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    try {
      const saved = localStorage.getItem("khata-home-period");
      if (saved === "today" || saved === "week" || saved === "month") setPeriod(saved);
    } catch {}

    // This month and last month cover every range shown, including a week
    // that started last month and the "vs last month" comparison.
    const now = new Date();
    const prev = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const month = (d: Date) =>
      fetch(`/api/expenses?year=${d.getFullYear()}&month=${d.getMonth() + 1}`).then((r) => {
        if (!r.ok) throw new Error(String(r.status));
        return r.json() as Promise<Expense[]>;
      });
    Promise.all([month(now), month(prev)])
      .then(([a, b]) => setExpenses([...a, ...b]))
      .catch(() => {
        setExpenses([]);
        setLoadError(true);
      });

    fetch("/api/people")
      .then((r) => r.json())
      .then((people: { balance: number }[]) => {
        const owing = people.filter((p) => p.balance > 0.005);
        setOwed({ total: owing.reduce((s, p) => s + p.balance, 0), people: owing.length });
      })
      .catch(() => setOwed({ total: 0, people: 0 }));

    fetch("/api/subscriptions")
      .then((r) => r.json())
      .then((list: { amount: number; active: number | boolean; paid_this_period: boolean }[]) => {
        const unpaid = list.filter((s) => s.active && !s.paid_this_period);
        setSubs({ due: unpaid.reduce((s, x) => s + x.amount, 0), count: unpaid.length });
      })
      .catch(() => setSubs({ due: 0, count: 0 }));
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
    return { total, previous, change, items };
  }, [expenses, period]);

  const meta = PERIODS.find((p) => p.id === period)!;

  const ask = (text: string, mode?: "voice" | "photo") => {
    try {
      if (text.trim()) sessionStorage.setItem(ASSISTANT_DRAFT_KEY, text.trim());
    } catch {}
    router.push(mode ? `/assistant?start=${mode}` : "/assistant");
  };

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

      {/* The assistant, right on Home: type and go, or jump straight to voice or a bill photo. */}
      <section className="card p-4 rise" aria-labelledby="ask-title">
        <div className="flex items-center gap-2 mb-3">
          <span
            className="flex h-8 w-8 items-center justify-center rounded-full text-white"
            style={{ background: "linear-gradient(135deg, var(--accent), var(--accent-2))" }}
            aria-hidden
          >
            <SparkleIcon size={18} />
          </span>
          <h2 id="ask-title" className="text-[16px] font-extrabold">
            Ask Khata
          </h2>
          <span className="text-[12px] ml-auto" style={{ color: "var(--muted)" }}>
            Add, change or ask anything
          </span>
        </div>
        <form
          className="flex items-center gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (draft.trim()) ask(draft);
            else inputRef.current?.focus();
          }}
        >
          <input
            ref={inputRef}
            className="field flex-1 !rounded-full"
            value={draft}
            maxLength={1000}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.nativeEvent.isComposing) {
                e.preventDefault();
                if (draft.trim()) ask(draft);
              }
            }}
            placeholder="fuel 3000 shell, or: who owes me?"
            aria-label="Message to the assistant"
            enterKeyHint="send"
          />
          {draft.trim() ? (
            <button className="btn btn-primary !p-0 w-12 h-12 shrink-0" aria-label="Send to the assistant">
              <span style={{ display: "inline-flex", transform: "rotate(90deg)" }}>
                <ArrowUpIcon size={20} />
              </span>
            </button>
          ) : (
            <>
              <button type="button" className="btn btn-ghost !p-0 w-12 h-12 shrink-0" aria-label="Snap a bill" onClick={() => ask("", "photo")}>
                <CameraIcon size={20} />
              </button>
              <button type="button" className="btn btn-primary !p-0 w-12 h-12 shrink-0" aria-label="Record a voice note" onClick={() => ask("", "voice")}>
                <MicIcon size={20} />
              </button>
            </>
          )}
        </form>
        <div className="nav-scroll mt-3 flex gap-2 overflow-x-auto -mx-1 px-1">
          {SUGGESTIONS.map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => ask(s)}
              className="shrink-0 rounded-full px-3.5 min-h-10 text-[13px] font-semibold"
              style={{ background: "var(--accent-soft)", color: "var(--accent)" }}
            >
              {s}
            </button>
          ))}
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
            Couldn&apos;t load your expenses. Pull to refresh or try again shortly.
          </div>
        ) : view.items.length === 0 ? (
          <div className="card p-6 text-center">
            <p className="text-[28px]" aria-hidden>
              🌿
            </p>
            <p className="font-bold mt-1">No expenses {period === "today" ? "today" : period === "week" ? "this week" : "this month"}</p>
            <p className="text-[13px] mt-1" style={{ color: "var(--muted)" }}>
              Tell the assistant what you spent, or snap a bill.
            </p>
          </div>
        ) : (
          view.items.slice(0, 8).map((e) => {
            const colors = categoryVars(e.category);
            const note = e.note.replace(/^(WhatsApp|Assistant):\s*/, "");
            return (
              <Link key={e.id} href="/expenses" className="card p-4 flex items-center gap-3 rise">
                <span className="icon-tile" style={{ background: colors.bg }} aria-hidden>
                  {categoryEmoji(e.category)}
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
        {view && view.items.length > 8 && (
          <Link href="/expenses" className="text-center text-[14px] font-bold py-2" style={{ color: "var(--accent)" }}>
            {view.items.length - 8} more in Mera Khata
          </Link>
        )}
      </section>
    </div>
  );
}
