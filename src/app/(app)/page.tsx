"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { fmtRs } from "@/lib/format";
import { WalletIcon, ReceiptIcon, HandshakeIcon, RepeatIcon } from "@/components/icons";

type CurrentUser = { id: string; username: string; name: string | null; isAdmin: boolean };

type CardStat = {
  href: string;
  icon: React.ReactNode;
  title: string;
  subtitle: string;
  statLabel: string;
  statValue: string | null;
  accent: string;
  accent2: string;
};

function useGreeting(name: string | undefined) {
  const hour = new Date().getHours();
  const part = hour < 12 ? "Good morning" : hour < 17 ? "Good afternoon" : "Good evening";
  return name ? `${part}, ${name}` : part;
}

export default function HeroHome() {
  const [user, setUser] = useState<CurrentUser | null>(null);
  const [owed, setOwed] = useState<number | null>(null);
  const [subsTotal, setSubsTotal] = useState<number | null>(null);
  const [spentMonth, setSpentMonth] = useState<number | null>(null);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
    fetch("/api/auth/me").then((r) => r.json()).then((d) => setUser(d.user));

    fetch("/api/people")
      .then((r) => r.json())
      .then((people: { balance: number }[]) =>
        setOwed(people.reduce((s, p) => s + Math.max(p.balance, 0), 0))
      )
      .catch(() => setOwed(0));

    fetch("/api/subscriptions")
      .then((r) => r.json())
      .then((subs: { amount: number }[]) =>
        setSubsTotal(subs.reduce((s, sub) => s + sub.amount, 0))
      )
      .catch(() => setSubsTotal(0));

    const now = new Date();
    fetch(`/api/expenses?year=${now.getFullYear()}&month=${now.getMonth() + 1}`)
      .then((r) => r.json())
      .then((expenses: { amount: number }[]) =>
        setSpentMonth(expenses.reduce((s, e) => s + e.amount, 0))
      )
      .catch(() => setSpentMonth(0));
  }, []);

  const greeting = useGreeting(user?.name || user?.username);

  const cards: CardStat[] = [
    {
      href: "/expenses",
      icon: <ReceiptIcon size={24} />,
      title: "Mera Khata",
      subtitle: "Track what you spend, month by month",
      statLabel: "Spent this month",
      statValue: spentMonth === null ? null : fmtRs(spentMonth),
      accent: "#f5a623",
      accent2: "#e07a1f",
    },
    {
      href: "/udhar-khata",
      icon: <HandshakeIcon size={24} />,
      title: "Udhar Khata",
      subtitle: "Who owes you, and how much",
      statLabel: "Total outstanding",
      statValue: owed === null ? null : fmtRs(owed),
      accent: "var(--accent)",
      accent2: "var(--accent-2)",
    },
    {
      href: "/subscriptions",
      icon: <RepeatIcon size={24} />,
      title: "Subscriptions",
      subtitle: "Every recurring payment, in one place",
      statLabel: "Due this month",
      statValue: subsTotal === null ? null : fmtRs(subsTotal),
      accent: "var(--good-2)",
      accent2: "var(--good)",
    },
  ];

  return (
    <div className="flex flex-col gap-8 pt-2 pb-4">
      <section
        className="flex flex-col items-center text-center gap-3 pt-4 pb-2"
        style={{
          opacity: mounted ? 1 : 0,
          transform: mounted ? "translateY(0)" : "translateY(10px)",
          transition: "opacity 500ms ease, transform 500ms ease",
        }}
      >
        <div className="hero-badge logo-float" style={{ color: "#fff" }} aria-hidden>
          <WalletIcon size={32} />
        </div>
        <p className="text-[13px] font-semibold" style={{ color: "var(--muted)" }}>
          {greeting}
        </p>
        <h1 className="wordmark text-[40px] sm:text-[52px] leading-[1.05]">
          Your money, sorted.
        </h1>
        <p className="text-[14px] max-w-xs" style={{ color: "var(--muted)" }}>
          Loans, spending, and subscriptions — one glass-clear view of everything moving through
          your pocket.
        </p>
      </section>

      <section className="grid grid-cols-1 gap-4">
        {cards.map((c, i) => (
          <Link
            key={c.href}
            href={c.href}
            className="hero-card card p-5 sm:p-6 rise"
            style={{ animationDelay: `${120 + i * 90}ms` }}
          >
            <div className="flex items-center gap-4">
              <div
                className="hero-card-icon shrink-0"
                style={{
                  background: `linear-gradient(135deg, ${c.accent}, ${c.accent2})`,
                  color: "#fff",
                }}
                aria-hidden
              >
                {c.icon}
              </div>
              <div className="min-w-0 flex-1">
                <p className="font-bold text-[18px] truncate">{c.title}</p>
                <p className="text-[13px] truncate" style={{ color: "var(--muted)" }}>
                  {c.subtitle}
                </p>
              </div>
              <svg
                width="18"
                height="18"
                viewBox="0 0 16 16"
                className="hero-card-chevron shrink-0"
                style={{ color: "var(--muted)" }}
                aria-hidden
              >
                <path
                  d="M6 3l5 5-5 5"
                  stroke="currentColor"
                  strokeWidth="1.8"
                  fill="none"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            </div>
            <div
              className="mt-4 pt-4 flex items-baseline justify-between"
              style={{ borderTop: "1px solid var(--hairline)" }}
            >
              <span className="text-[12px] font-medium" style={{ color: "var(--muted)" }}>
                {c.statLabel}
              </span>
              <span className="text-[17px] font-bold tabular">
                {c.statValue ?? (
                  <span
                    className="inline-block rounded-full animate-pulse"
                    style={{ width: 64, height: 14, background: "var(--surface-2)" }}
                  />
                )}
              </span>
            </div>
          </Link>
        ))}
      </section>

      <footer className="text-center text-[12px] pt-2" style={{ color: "var(--muted)" }}>
        Khata · synced across your devices
      </footer>
    </div>
  );
}
