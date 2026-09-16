"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { Person, Tx } from "@/lib/db";
import { fmtRs, fmtWhen, fmtFull, fmtDateLabel, dueDateInfo, todayLocalYMD } from "@/lib/format";
import { Avatar } from "@/components/Avatar";
import { Sheet, SheetRow } from "@/components/Sheet";
import { invalidate, useCached } from "@/lib/swr";
import { CoinsIcon } from "@/components/CategoryIcon";

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

/* ---------- summary ---------- */

function Dashboard({ people }: { people: Person[] }) {
  const total = people.filter((p) => p.balance > 0).reduce((sum, p) => sum + p.balance, 0);

  // The one number that matters. Who owes it, how overdue they are and how
  // much has come back are all in the list below, per person, where they can
  // be acted on.
  return (
    <section className="hero-panel p-6 rise">
      <p className="hero-muted text-[14px] font-semibold">Owed to you</p>
      <p className="mt-1 flex items-baseline gap-2 tabular">
        <span className="hero-muted text-[20px] font-bold">Rs</span>
        <span className="text-[42px] font-extrabold leading-none tracking-tight">
          {fmtRs(total).replace(/^−?Rs\s/, "")}
        </span>
      </p>
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
    <form onSubmit={submit} className="flex flex-col gap-3">
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
          {busy ? "Saving…" : mode === "lend" ? "Add to loan" : "Record payment"}
        </button>
      </div>
    </form>
  );
}

/* ---------- person ---------- */

function dueStyle(status: "overdue" | "soon" | "upcoming" | undefined) {
  return status === "overdue"
    ? { background: "var(--bad-soft)", color: "var(--bad)" }
    : status === "soon"
      ? { background: "rgba(224, 122, 31, 0.14)", color: "#c2410c" }
      : { background: "var(--accent-soft)", color: "var(--accent)" };
}

function PersonRow({ person, onOpen }: { person: Person; onOpen: () => void }) {
  const settled = person.balance <= 0;
  const due = settled ? null : dueDateInfo(person.due_date);
  return (
    <li>
      <button type="button" className="list-row" onClick={onOpen}>
        <Avatar id={person.id} name={person.name} size={46} />
        <span className="min-w-0 flex-1">
          <span className="block text-[16px] font-bold truncate">{person.name}</span>
          <span className="flex items-center gap-2 mt-0.5 min-w-0">
            {due ? (
              <span className="chip" style={dueStyle(due.status)}>
                {due.label}
              </span>
            ) : (
              <span className="text-[12px] truncate" style={{ color: "var(--muted)" }}>
                Updated {fmtWhen(person.last_activity)}
              </span>
            )}
          </span>
        </span>
        {settled ? (
          <span className="chip" style={{ background: "var(--good-soft)", color: "var(--good)" }}>
            Settled
          </span>
        ) : (
          <span className="text-[16px] font-extrabold tabular shrink-0">{fmtRs(person.balance)}</span>
        )}
      </button>
    </li>
  );
}

function PersonSheet({
  person,
  onClose,
  onChanged,
}: {
  person: Person;
  onClose: () => void;
  onChanged: () => void;
}) {
  const { data: txData } = useCached<Tx[]>(`/api/people/${person.id}`);
  const txs = txData ?? null;
  const [form, setForm] = useState<"lend" | "repay" | null>(null);
  const [editingDue, setEditingDue] = useState(false);
  const [dueDraft, setDueDraft] = useState(person.due_date ?? "");
  const [dueBusy, setDueBusy] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  // A change here refreshes this history and every balance that shows it.
  const loadTxs = () => invalidate("/api/people");

  const settled = person.balance <= 0;
  const due = settled ? null : dueDateInfo(person.due_date);

  const remove = async () => {
    await fetch(`/api/people/${person.id}`, { method: "DELETE" });
    onClose();
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

  return (
    <Sheet title={person.name} onClose={onClose}>
      <div className="card p-5 flex flex-col items-center text-center">
        <Avatar id={person.id} name={person.name} size={64} />
        <p className="text-[13px] font-semibold mt-3" style={{ color: "var(--muted)" }}>
          {settled ? "All settled" : "Owes you"}
        </p>
        <p className="text-[36px] font-extrabold tabular leading-tight" style={settled ? { color: "var(--good)" } : undefined}>
          {fmtRs(Math.max(person.balance, 0))}
        </p>
        {due && (
          <span className="chip mt-1" style={dueStyle(due.status)}>
            {due.label}
          </span>
        )}
        <div className="grid grid-cols-2 gap-2 w-full mt-4">
          <button className={`btn ${form === "lend" ? "btn-primary" : "btn-ghost"}`} onClick={() => setForm(form === "lend" ? null : "lend")}>
            Lent more
          </button>
          <button className={`btn ${form === "repay" ? "btn-good" : "btn-ghost"}`} onClick={() => setForm(form === "repay" ? null : "repay")}>
            Paid back
          </button>
        </div>
        {form && (
          <div className="w-full mt-3 text-left">
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
        )}
      </div>

      <div className="card px-4 py-1">
        <SheetRow label="Lent in total">{fmtRs(person.lent)}</SheetRow>
        <SheetRow label="Paid back">
          <span style={{ color: "var(--good)" }}>{fmtRs(person.received)}</span>
        </SheetRow>
        <div className="flex items-center justify-between gap-3 py-3">
          <span className="text-[14px]" style={{ color: "var(--muted)" }}>
            Reach out by
          </span>
          {editingDue ? null : (
            <button type="button" className="text-[15px] font-bold" style={{ color: "var(--accent)" }} onClick={() => setEditingDue(true)}>
              {person.due_date ? fmtDateLabel(person.due_date) : "Set date"}
            </button>
          )}
        </div>
        {editingDue && (
          <div className="flex flex-col gap-2 pb-3">
            <input
              className="field"
              aria-label="Reach-out date"
              type="date"
              value={dueDraft}
              onChange={(e) => setDueDraft(e.target.value)}
            />
            <div className="form-actions">
              {person.due_date && (
                <button
                  type="button"
                  className="btn btn-ghost !min-h-11 !py-2 mr-auto"
                  onClick={() => setDueDraft("")}
                >
                  Clear
                </button>
              )}
              <button
                type="button"
                className="btn btn-ghost !min-h-11 !py-2"
                onClick={() => {
                  setDueDraft(person.due_date ?? "");
                  setEditingDue(false);
                }}
              >
                Cancel
              </button>
              <button type="button" className="btn btn-primary !min-h-11 !py-2" disabled={dueBusy} onClick={saveDueDate}>
                {dueBusy ? "Saving…" : "Save"}
              </button>
            </div>
          </div>
        )}
      </div>

      <div className="flex flex-col gap-2">
        <h3 className="text-[13px] font-bold uppercase tracking-wide px-1" style={{ color: "var(--muted)" }}>
          History
        </h3>
        <div className="card px-3 py-1">
          {txs === null ? (
            // Shaped like the rows it is waiting for, so the sheet is already
            // the size it will be when they arrive.
            <ul role="status" aria-label="Loading history">
              {[0, 1, 2].map((i) => (
                <li
                  key={i}
                  className="flex items-center gap-3 py-3 border-b last:border-b-0"
                  style={{ borderColor: "var(--hairline)" }}
                >
                  <span className="skeleton !rounded-xl" style={{ width: 40, height: 40 }} />
                  <span className="min-w-0 flex-1 flex flex-col gap-2">
                    <span className="skeleton" style={{ width: "50%", height: 13 }} />
                    <span className="skeleton" style={{ width: "32%", height: 11 }} />
                  </span>
                  <span className="skeleton shrink-0" style={{ width: 62, height: 15 }} />
                </li>
              ))}
            </ul>
          ) : txs.length === 0 ? (
            <p className="text-[13px] py-3" style={{ color: "var(--muted)" }}>
              No entries yet.
            </p>
          ) : (
            <ul>
              {txs.map((t) => (
                <li
                  key={t.id}
                  className="flex items-center gap-3 py-3 border-b last:border-b-0"
                  style={{ borderColor: "var(--hairline)" }}
                >
                  <span
                    className="icon-tile !w-10 !h-10 !rounded-xl !text-[15px] font-bold"
                    style={
                      t.amount > 0
                        ? { background: "var(--accent-soft)", color: "var(--accent)" }
                        : { background: "var(--good-soft)", color: "var(--good)" }
                    }
                    aria-hidden
                  >
                    {t.amount > 0 ? "↑" : "↓"}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-[14px] font-semibold truncate">
                      {t.note || (t.amount > 0 ? "Lent" : "Paid back")}
                    </span>
                    <span className="block text-[12px]" style={{ color: "var(--muted)" }}>
                      {fmtFull(t.created_at)}
                    </span>
                  </span>
                  <span
                    className="tabular text-[15px] font-extrabold shrink-0"
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
      </div>

      {confirmDelete ? (
        <div className="card p-4 flex flex-col gap-3">
          <p className="text-[14px] font-semibold text-center" style={{ color: "var(--bad)" }}>
            Delete {person.name} and their full history? This can&apos;t be undone.
          </p>
          <div className="grid grid-cols-2 gap-2">
            <button type="button" className="btn btn-ghost" onClick={() => setConfirmDelete(false)}>
              Cancel
            </button>
            <button type="button" className="btn btn-danger" onClick={remove}>
              Delete
            </button>
          </div>
        </div>
      ) : (
        <button
          type="button"
          className="min-h-12 text-[14px] font-bold"
          style={{ color: "var(--bad)" }}
          onClick={() => setConfirmDelete(true)}
        >
          Delete {person.name}
        </button>
      )}
    </Sheet>
  );
}

/* ---------- page ---------- */

type Filter = "owing" | "settled" | "all";

export default function UdharKhata() {
  const { data: peopleData } = useCached<Person[]>("/api/people");
  const people = peopleData ?? null;
  const [adding, setAdding] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<Filter>("owing");

  const load = useCallback(() => invalidate("/api/people"), []);

  // A reminder links to /udhar-khata?open=<id>: open that person.
  useEffect(() => {
    if (!peopleData) return;
    const id = new URLSearchParams(window.location.search).get("open");
    if (!id) return;
    const person = peopleData.find((p) => p.id === id);
    if (person) {
      setFilter(person.balance > 0 ? "owing" : "all");
      setOpenId(id);
    }
    window.history.replaceState(null, "", "/udhar-khata");
  }, [peopleData]);

  const counts = useMemo(() => {
    const list = people ?? [];
    return {
      owing: list.filter((p) => p.balance > 0).length,
      settled: list.filter((p) => p.balance <= 0).length,
      all: list.length,
    };
  }, [people]);

  const filtered = useMemo(() => {
    if (!people) return null;
    const q = query.trim().toLowerCase();
    return people
      .filter((p) => (filter === "owing" ? p.balance > 0 : filter === "settled" ? p.balance <= 0 : true))
      .filter((p) => !q || p.name.toLowerCase().includes(q));
  }, [people, query, filter]);

  const open = people?.find((p) => p.id === openId) ?? null;
  const closeSheet = useCallback(() => setOpenId(null), []);
  const closeAdd = useCallback(() => setAdding(false), []);

  if (people === null) return <Spinner />;

  return (
    <>
      <Dashboard people={people} />

      <div className="flex items-center gap-2">
        <div className="segmented flex-1" role="group" aria-label="Show">
          {(
            [
              ["owing", "Owes you"],
              ["settled", "Settled"],
              ["all", "All"],
            ] as const
          ).map(([id, label]) => (
            <button key={id} type="button" aria-pressed={filter === id} onClick={() => setFilter(id)}>
              {label}
              <span className="ml-1 opacity-70 tabular">{counts[id]}</span>
            </button>
          ))}
        </div>
        <button type="button" className="tab-fab !w-14 !h-14 !m-0 !shadow-none" aria-label="Add borrower" onClick={() => setAdding(true)}>
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" aria-hidden>
            <path d="M12 5v14M5 12h14" />
          </svg>
        </button>
      </div>

      {people.length > 5 && (
        <input
          className="field !rounded-full"
          aria-label="Search people"
          placeholder="Search people…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      )}

      {people.length === 0 ? (
        <div className="card p-8 text-center rise">
          <p className="flex justify-center mb-2" style={{ color: "var(--muted)" }} aria-hidden>
            <CoinsIcon size={32} />
          </p>
          <p className="font-bold">No one here yet</p>
          <p className="text-[14px] mt-1" style={{ color: "var(--muted)" }}>
            Add the first person who owes you, or tell the assistant &ldquo;lent Ali 2000&rdquo;.
          </p>
          <button type="button" className="btn btn-primary mt-4" onClick={() => setAdding(true)}>
            Add borrower
          </button>
        </div>
      ) : filtered && filtered.length === 0 ? (
        <div className="card p-6 text-center text-[14px]" style={{ color: "var(--muted)" }}>
          {query ? "No one matches that name." : filter === "owing" ? "Nobody owes you anything right now." : "No settled records."}
        </div>
      ) : (
        <ul className="list-card rise">
          {filtered?.map((p) => (
            <PersonRow key={p.id} person={p} onOpen={() => setOpenId(p.id)} />
          ))}
        </ul>
      )}

      {open && <PersonSheet person={open} onClose={closeSheet} onChanged={load} />}

      {adding && (
        <Sheet title="New borrower" onClose={closeAdd}>
          <div className="card p-4">
            <AddPersonForm
              onCancel={closeAdd}
              onDone={() => {
                setAdding(false);
                load();
              }}
            />
          </div>
        </Sheet>
      )}
    </>
  );
}
