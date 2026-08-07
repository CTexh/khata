"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { Person, Tx } from "@/lib/db";
import { fmtRs, fmtWhen, fmtFull, dueDateInfo, todayLocalYMD } from "@/lib/format";
import { Avatar } from "@/components/Avatar";

/* ---------- small components ---------- */

function Spinner() {
  return (
    <div className="flex justify-center py-16" role="status" aria-label="Loading loan records">
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
          <div key={t.label} className="tile px-3 py-2.5">
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
  const [dueDate, setDueDate] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError("");
    const res = await fetch("/api/people", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, amount: Number(amount), note, dueDate }),
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
        className="field"
        aria-label="Person's name"
        placeholder="Person's name"
        value={name}
        onChange={(e) => setName(e.target.value)}
        required
      />
      <input
        className="field tabular"
        aria-label="Amount lent"
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
        aria-label="Loan note"
        placeholder="Note — e.g. cash for bike repair (optional)"
        value={note}
        onChange={(e) => setNote(e.target.value)}
      />
      <div className="grid min-w-0 gap-2 sm:grid-cols-[auto_minmax(0,1fr)] sm:items-center">
        <label className="text-[13px]" style={{ color: "var(--muted)" }}>
          Reach out by
        </label>
        <input
          className="field"
          aria-label="Reach-out date"
          type="date"
          value={dueDate}
          min={todayLocalYMD()}
          onChange={(e) => setDueDate(e.target.value)}
          placeholder="Optional"
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
        className="field tabular"
        aria-label={mode === "lend" ? "Amount lent" : "Amount received"}
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
        aria-label="Transaction description"
        placeholder="Short description (optional)"
        value={note}
        onChange={(e) => setNote(e.target.value)}
      />
      {error && (
        <p className="text-[13px]" style={{ color: "var(--bad)" }} role="alert">
          {error}
        </p>
      )}
      <div className="form-actions">
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
  const [editingDue, setEditingDue] = useState(false);
  const [dueDraft, setDueDraft] = useState(person.due_date ?? "");
  const [dueBusy, setDueBusy] = useState(false);

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

  const saveDueDate = async () => {
    setDueBusy(true);
    await fetch(`/api/people/${person.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ dueDate: dueDraft }),
    });
    setDueBusy(false);
    setEditingDue(false);
    onChanged();
  };

  const due = dueDateInfo(person.due_date);
  const dueColor =
    due?.status === "overdue"
      ? "var(--bad)"
      : due?.status === "soon"
        ? "#e07a1f"
        : "var(--accent)";
  const dueSoft =
    due?.status === "overdue"
      ? "var(--bad-soft)"
      : due?.status === "soon"
        ? "rgba(224, 122, 31, 0.14)"
        : "var(--accent-soft)";

  return (
    <div className="card overflow-hidden rise">
      <button
        onClick={onToggle}
        aria-expanded={expanded}
        className="w-full flex items-center gap-3 p-4 text-left cursor-pointer"
      >
        <Avatar id={person.id} name={person.name} />
        <div className="min-w-0 flex-1">
          <p className="font-semibold truncate">{person.name}</p>
          <p className="text-[12px]" style={{ color: "var(--muted)" }}>
            {person.tx_count} {person.tx_count === 1 ? "entry" : "entries"} · updated{" "}
            {fmtWhen(person.last_activity)}
          </p>
          {!settled && due && (
            <span
              className="inline-block text-[11px] font-semibold px-2 py-0.5 rounded-full mt-1"
              style={{ background: dueSoft, color: dueColor }}
            >
              {due.label}
            </span>
          )}
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
            <div className="grid grid-cols-1 min-[400px]:grid-cols-2 gap-2 pt-4">
              <button className="btn btn-primary flex-1" onClick={() => setForm("lend")}>
                <span>💸</span> I lent more
              </button>
              <button className="btn btn-good flex-1" onClick={() => setForm("repay")}>
                <span>💰</span> They paid back
              </button>
            </div>
          )}

          {editingDue ? (
            <div className="grid min-w-0 grid-cols-2 gap-2 pt-4 sm:grid-cols-[minmax(0,1fr)_auto_auto] sm:items-center">
              <input
                className="field col-span-2 sm:col-span-1"
                aria-label="Reach-out date"
                type="date"
                value={dueDraft}
                onChange={(e) => setDueDraft(e.target.value)}
              />
              <button
                className="btn btn-ghost !py-2 text-[12px] shrink-0"
                onClick={() => {
                  setDueDraft(person.due_date ?? "");
                  setEditingDue(false);
                }}
              >
                Cancel
              </button>
              <button
                className="btn btn-primary !py-2 text-[12px] shrink-0"
                disabled={dueBusy}
                onClick={saveDueDate}
              >
                {dueBusy ? "Saving…" : "Save"}
              </button>
            </div>
          ) : (
            <div className="flex items-center justify-between pt-4">
              <p className="text-[13px]" style={{ color: "var(--muted)" }}>
                {due ? (
                  <>
                    Reach out by{" "}
                    <span className="font-medium" style={{ color: "var(--ink-2)" }}>
                      {due.label.replace(/^(Due|Overdue · )/, "")}
                    </span>
                  </>
                ) : (
                  "No reach-out date set"
                )}
              </p>
              <button
                className="btn btn-ghost !py-2 text-[12px] shrink-0"
                onClick={() => setEditingDue(true)}
              >
                {due ? "Change" : "Set date"}
              </button>
            </div>
          )}

          <div className="mt-4">
            {txs === null ? (
              <p className="text-[13px] py-2" style={{ color: "var(--muted)" }} role="status">
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
    <>
      <div className="flex items-center justify-end -mt-2">
        {!adding && people !== null && (
          <button className="btn btn-primary" onClick={() => setAdding(true)}>
            Add borrower
          </button>
        )}
      </div>

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
              aria-label="Search people"
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
                  Tap “Add borrower” to add the first person who owes you.
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
    </>
  );
}
