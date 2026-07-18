"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Person, Tx } from "@/lib/db";

/* ---------- formatting ---------- */

function fmtRs(n: number): string {
  const abs = Math.abs(n);
  const s = abs.toLocaleString("en-PK", {
    maximumFractionDigits: Number.isInteger(abs) ? 0 : 2,
    minimumFractionDigits: 0,
  });
  return `${n < 0 ? "−" : ""}Rs ${s}`;
}

function fmtWhen(iso: string): string {
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

function fmtFull(iso: string): string {
  return new Date(iso).toLocaleString("en-PK", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

const initials = (name: string) =>
  name
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? "")
    .join("");

const AVATAR_HUES = [212, 160, 38, 265, 350, 20, 190, 300];
const hueFor = (id: string) => {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  return AVATAR_HUES[h % AVATAR_HUES.length];
};

/* ---------- logo ---------- */

function Logo({ size = 44 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 64 64"
      className="logo-float shrink-0"
      aria-label="Khata logo"
    >
      <defs>
        <linearGradient id="lg-drop" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="var(--accent)" />
          <stop offset="0.55" stopColor="var(--accent-2)" />
          <stop offset="1" stopColor="var(--good-2)" />
        </linearGradient>
        <radialGradient id="lg-shine" cx="0.32" cy="0.22" r="0.5">
          <stop offset="0" stopColor="#fff" stopOpacity="0.85" />
          <stop offset="1" stopColor="#fff" stopOpacity="0" />
        </radialGradient>
      </defs>
      {/* liquid droplet / coin blob */}
      <path
        d="M32 4C40 16 56 24 56 39c0 13.3-10.7 21-24 21S8 52.3 8 39C8 24 24 16 32 4z"
        fill="url(#lg-drop)"
      />
      <path
        d="M32 4C40 16 56 24 56 39c0 13.3-10.7 21-24 21S8 52.3 8 39C8 24 24 16 32 4z"
        fill="url(#lg-shine)"
      />
      {/* rupee mark */}
      <g
        stroke="#fff"
        strokeWidth="4.2"
        strokeLinecap="round"
        strokeLinejoin="round"
        fill="none"
      >
        <path d="M24 26h16M24 33h16M26 26c6 0 9 2.5 9 7 0 4.5-3 7.5-9 7.5l12 9" />
      </g>
    </svg>
  );
}

/* ---------- small components ---------- */

function Avatar({ person, size = 40 }: { person: Person; size?: number }) {
  const hue = hueFor(person.id);
  return (
    <div
      className="avatar-liquid flex items-center justify-center font-bold shrink-0"
      style={{
        width: size,
        height: size,
        fontSize: size * 0.36,
        background: `linear-gradient(135deg, oklch(0.72 0.16 ${hue}), oklch(0.52 0.19 ${(hue + 40) % 360}))`,
        color: "#fff",
        textShadow: "0 1px 2px rgba(0,0,20,0.25)",
      }}
    >
      {initials(person.name)}
    </div>
  );
}

function ThemeToggle() {
  const [dark, setDark] = useState<boolean | null>(null);

  useEffect(() => {
    const root = document.documentElement;
    setDark(
      root.dataset.theme === "dark" ||
        (!root.dataset.theme &&
          window.matchMedia("(prefers-color-scheme: dark)").matches)
    );
  }, []);

  const toggle = () => {
    const next = !dark;
    document.documentElement.dataset.theme = next ? "dark" : "light";
    try {
      localStorage.setItem("khata-theme", next ? "dark" : "light");
    } catch {}
    setDark(next);
  };

  return (
    <button
      onClick={toggle}
      aria-label="Toggle dark mode"
      className="btn btn-ghost !p-0 w-10 h-10 text-[17px]"
    >
      {dark === null ? "◐" : dark ? "☀️" : "🌙"}
    </button>
  );
}

function Spinner() {
  return (
    <div className="flex justify-center py-16">
      <div
        className="w-6 h-6 rounded-full border-2 animate-spin"
        style={{ borderColor: "var(--hairline)", borderTopColor: "var(--accent)" }}
      />
    </div>
  );
}

/* ---------- dashboard ---------- */

function Dashboard({ people }: { people: Person[] }) {
  const owing = people.filter((p) => p.balance > 0);
  const total = people.reduce((s, p) => s + p.balance, 0);
  const lent = people.reduce((s, p) => s + p.lent, 0);
  const max = Math.max(...owing.map((p) => p.balance), 1);
  const top = owing.slice(0, 6);

  return (
    <section className="card p-5 sm:p-6 rise">
      <p className="text-[13px] font-medium" style={{ color: "var(--muted)" }}>
        Total outstanding
      </p>
      <p className="hero-num text-4xl sm:text-5xl font-bold tracking-tight mt-1 tabular">
        {fmtRs(total)}
      </p>

      <div className="grid grid-cols-2 gap-3 mt-5">
        {[
          { label: "People", value: String(owing.length) },
          { label: "Total lent", value: fmtRs(lent) },
        ].map((t) => (
          <div
            key={t.label}
            className="tile px-3 py-2.5"
          >
            <p className="text-[11px] font-medium" style={{ color: "var(--muted)" }}>
              {t.label}
            </p>
            <p className="text-sm sm:text-base font-semibold tabular truncate mt-0.5">
              {t.value}
            </p>
          </div>
        ))}
      </div>

      {top.length > 0 && (
        <div className="mt-6">
          <p className="text-[13px] font-medium mb-3" style={{ color: "var(--muted)" }}>
            Who owes the most
          </p>
          <div className="flex flex-col gap-3">
            {top.map((p) => (
              <div key={p.id}>
                <div className="flex items-baseline justify-between gap-3 mb-1">
                  <span className="text-[13px] font-medium truncate">{p.name}</span>
                  <span
                    className="text-[13px] tabular shrink-0"
                    style={{ color: "var(--ink-2)" }}
                  >
                    {fmtRs(p.balance)}
                  </span>
                </div>
                <div
                  className="h-2 rounded-full overflow-hidden"
                  style={{ background: "var(--surface-2)" }}
                >
                  <div
                    className="h-full rounded-full transition-[width] duration-500"
                    style={{
                      width: `${(p.balance / max) * 100}%`,
                      background:
                        "linear-gradient(90deg, var(--accent), var(--accent-2))",
                      minWidth: 8,
                    }}
                  />
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </section>
  );
}

/* ---------- add person ---------- */

function AddPersonForm({
  onDone,
  onCancel,
}: {
  onDone: () => void;
  onCancel: () => void;
}) {
  const [name, setName] = useState("");
  const [amount, setAmount] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const nameRef = useRef<HTMLInputElement>(null);
  useEffect(() => nameRef.current?.focus(), []);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError("");
    const res = await fetch("/api/people", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, amount: Number(amount), note }),
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
    <form onSubmit={submit} className="card p-5 rise flex flex-col gap-3">
      <p className="font-semibold">New loan record</p>
      <input
        ref={nameRef}
        className="field"
        placeholder="Person's name"
        value={name}
        onChange={(e) => setName(e.target.value)}
        required
      />
      <input
        className="field tabular"
        placeholder="Amount lent (Rs)"
        type="number"
        inputMode="decimal"
        min="1"
        step="any"
        value={amount}
        onChange={(e) => setAmount(e.target.value)}
        required
      />
      <input
        className="field"
        placeholder="Note — e.g. cash for bike repair (optional)"
        value={note}
        onChange={(e) => setNote(e.target.value)}
      />
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
          {busy ? "Saving…" : "Add record"}
        </button>
      </div>
    </form>
  );
}

/* ---------- transaction form ---------- */

function TxForm({
  mode,
  onDone,
  onCancel,
  personId,
}: {
  mode: "lend" | "repay";
  personId: string;
  onDone: () => void;
  onCancel: () => void;
}) {
  const [amount, setAmount] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const amountRef = useRef<HTMLInputElement>(null);
  useEffect(() => amountRef.current?.focus(), []);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const n = Number(amount);
    setBusy(true);
    setError("");
    const res = await fetch(`/api/people/${personId}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ amount: mode === "lend" ? n : -n, note }),
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
    <form onSubmit={submit} className="flex flex-col gap-2.5 rise">
      <input
        ref={amountRef}
        className="field tabular"
        placeholder={mode === "lend" ? "Amount lent (Rs)" : "Amount received (Rs)"}
        type="number"
        inputMode="decimal"
        min="1"
        step="any"
        value={amount}
        onChange={(e) => setAmount(e.target.value)}
        required
      />
      <input
        className="field"
        placeholder="Short description (optional)"
        value={note}
        onChange={(e) => setNote(e.target.value)}
      />
      {error && (
        <p className="text-[13px]" style={{ color: "var(--bad)" }}>
          {error}
        </p>
      )}
      <div className="flex gap-2 justify-end">
        <button type="button" className="btn btn-ghost" onClick={onCancel}>
          Cancel
        </button>
        <button
          className={`btn ${mode === "lend" ? "btn-primary" : "btn-good"}`}
          disabled={busy}
        >
          {busy ? "Saving…" : mode === "lend" ? "💸 Add to loan" : "💰 Record payment"}
        </button>
      </div>
    </form>
  );
}

/* ---------- person card ---------- */

function PersonCard({
  person,
  expanded,
  onToggle,
  onChanged,
}: {
  person: Person;
  expanded: boolean;
  onToggle: () => void;
  onChanged: () => void;
}) {
  const [txs, setTxs] = useState<Tx[] | null>(null);
  const [form, setForm] = useState<"lend" | "repay" | null>(null);

  const loadTxs = useCallback(async () => {
    const res = await fetch(`/api/people/${person.id}`);
    setTxs(await res.json());
  }, [person.id]);

  useEffect(() => {
    if (expanded) loadTxs();
    else setForm(null);
  }, [expanded, loadTxs]);

  const settled = person.balance <= 0;

  const remove = async () => {
    if (!confirm(`Delete ${person.name}'s record and full history? This can't be undone.`))
      return;
    await fetch(`/api/people/${person.id}`, { method: "DELETE" });
    onChanged();
  };

  return (
    <div className="card overflow-hidden rise">
      <button
        onClick={onToggle}
        className="w-full flex items-center gap-3 p-4 text-left cursor-pointer"
      >
        <Avatar person={person} />
        <div className="min-w-0 flex-1">
          <p className="font-semibold truncate">{person.name}</p>
          <p className="text-[12px]" style={{ color: "var(--muted)" }}>
            {person.tx_count} {person.tx_count === 1 ? "entry" : "entries"} · updated{" "}
            {fmtWhen(person.last_activity)}
          </p>
        </div>
        <div className="text-right shrink-0">
          {settled ? (
            <span
              className="text-[12px] font-semibold px-2 py-1 rounded-full"
              style={{ background: "var(--good-soft)", color: "var(--good)" }}
            >
              Settled ✓
            </span>
          ) : (
            <p className="font-bold tabular text-[17px]">{fmtRs(person.balance)}</p>
          )}
        </div>
        <svg
          width="16"
          height="16"
          viewBox="0 0 16 16"
          className={`shrink-0 transition-transform ${expanded ? "rotate-180" : ""}`}
          style={{ color: "var(--muted)" }}
        >
          <path
            d="M4 6l4 4 4-4"
            stroke="currentColor"
            strokeWidth="1.8"
            fill="none"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </button>

      {expanded && (
        <div className="px-4 pb-4 border-t" style={{ borderColor: "var(--hairline)" }}>
          {form ? (
            <div className="pt-4">
              <TxForm
                mode={form}
                personId={person.id}
                onCancel={() => setForm(null)}
                onDone={() => {
                  setForm(null);
                  loadTxs();
                  onChanged();
                }}
              />
            </div>
          ) : (
            <div className="flex gap-2 pt-4">
              <button className="btn btn-primary flex-1" onClick={() => setForm("lend")}>
                <span>💸</span> I lent more
              </button>
              <button className="btn btn-good flex-1" onClick={() => setForm("repay")}>
                <span>💰</span> They paid back
              </button>
            </div>
          )}

          <div className="mt-4">
            {txs === null ? (
              <p className="text-[13px] py-2" style={{ color: "var(--muted)" }}>
                Loading history…
              </p>
            ) : (
              <ul className="flex flex-col">
                {txs.map((t) => (
                  <li
                    key={t.id}
                    className="flex items-center gap-3 py-2.5 border-b last:border-b-0"
                    style={{ borderColor: "var(--hairline)" }}
                  >
                    <span
                      className="w-7 h-7 rounded-full flex items-center justify-center text-[13px] font-bold shrink-0"
                      style={
                        t.amount > 0
                          ? { background: "var(--accent-soft)", color: "var(--accent)" }
                          : { background: "var(--good-soft)", color: "var(--good)" }
                      }
                    >
                      {t.amount > 0 ? "↑" : "↓"}
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="text-[14px] truncate">
                        {t.note || (t.amount > 0 ? "Lent" : "Payment received")}
                      </p>
                      <p className="text-[12px]" style={{ color: "var(--muted)" }}>
                        {fmtFull(t.created_at)}
                      </p>
                    </div>
                    <span
                      className="tabular text-[14px] font-semibold shrink-0"
                      style={{ color: t.amount > 0 ? "var(--ink)" : "var(--good)" }}
                    >
                      {t.amount > 0 ? "+" : "−"}
                      {fmtRs(Math.abs(t.amount))}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <button
            onClick={remove}
            className="btn btn-danger mt-4 !py-2 !px-4 text-[12px]"
          >
            <span>🗑</span> Delete record
          </button>
        </div>
      )}
    </div>
  );
}

/* ---------- page ---------- */

export default function Home() {
  const [people, setPeople] = useState<Person[] | null>(null);
  const [adding, setAdding] = useState(false);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [query, setQuery] = useState("");

  const load = useCallback(async () => {
    const res = await fetch("/api/people");
    setPeople(await res.json());
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const filtered = useMemo(() => {
    if (!people) return null;
    const q = query.trim().toLowerCase();
    return q ? people.filter((p) => p.name.toLowerCase().includes(q)) : people;
  }, [people, query]);

  return (
    <main className="w-full max-w-xl mx-auto px-4 py-6 sm:py-10 flex flex-col gap-5">
      <header className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Logo />
          <div>
            <h1 className="wordmark text-[26px] leading-tight">Khata</h1>
            <p className="text-[13px]" style={{ color: "var(--muted)" }}>
              Your loan ledger
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <ThemeToggle />
          {!adding && (
            <button className="btn btn-primary" onClick={() => setAdding(true)}>
              <span>📒</span> Add borrower
            </button>
          )}
        </div>
      </header>

      {people === null ? (
        <Spinner />
      ) : (
        <>
          {adding && (
            <AddPersonForm
              onCancel={() => setAdding(false)}
              onDone={() => {
                setAdding(false);
                load();
              }}
            />
          )}

          <Dashboard people={people} />

          {people.length > 3 && (
            <input
              className="field"
              placeholder="Search people…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          )}

          <section className="flex flex-col gap-3">
            {people.length === 0 && !adding && (
              <div className="card p-8 text-center rise">
                <p className="text-3xl mb-2">🪙</p>
                <p className="font-semibold">No records yet</p>
                <p className="text-[14px] mt-1" style={{ color: "var(--muted)" }}>
                  Tap “New record” to add the first person who owes you.
                </p>
              </div>
            )}
            {filtered?.map((p) => (
              <PersonCard
                key={p.id}
                person={p}
                expanded={expanded === p.id}
                onToggle={() => setExpanded(expanded === p.id ? null : p.id)}
                onChanged={load}
              />
            ))}
          </section>
        </>
      )}

      <footer className="text-center text-[12px] py-4" style={{ color: "var(--muted)" }}>
        Khata · synced across your devices
      </footer>
    </main>
  );
}
