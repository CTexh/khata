"use client";

import { useCallback, useMemo, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import type { TripDetail, TripMember, TripSpend } from "@/lib/trips-db";
import { POT } from "@/lib/trip-split";
import { fmtRs, fmtDateLabel, todayLocalYMD } from "@/lib/format";
import { Avatar } from "@/components/Avatar";
import { Sheet } from "@/components/Sheet";
import { invalidate, useCached } from "@/lib/swr";
import { useTripsSection } from "../guard";

function Spinner() {
  return (
    <div className="flex justify-center py-16" role="status" aria-label="Loading trip">
      <div
        className="w-6 h-6 rounded-full border-2 animate-spin"
        style={{ borderColor: "var(--hairline)", borderTopColor: "var(--accent)" }}
      />
    </div>
  );
}

const nameOf = (trip: TripDetail, id: string) =>
  id === POT ? "the pot" : trip.members.find((m) => m.id === id)?.name ?? "someone";

/* ---------- spending ---------- */

function SpendForm({
  trip,
  existing,
  onDone,
  onCancel,
}: {
  trip: TripDetail;
  existing?: TripSpend;
  onDone: () => void;
  onCancel: () => void;
}) {
  const [amount, setAmount] = useState(existing ? String(existing.amount) : "");
  const [vendor, setVendor] = useState(existing?.vendor ?? "");
  const [spentAt, setSpentAt] = useState((existing?.spentAt ?? todayLocalYMD()).slice(0, 10));
  const [payer, setPayer] = useState<string>(
    existing?.paidFrom === "member" ? existing.payerMemberId ?? POT : POT
  );
  // Nobody ticked means everyone, which is what a stored expense with no
  // shares means too.
  const [between, setBetween] = useState<string[]>(
    existing?.participants.length ? existing.participants : trip.members.map((m) => m.id)
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const toggle = (id: string) =>
    setBetween((current) => (current.includes(id) ? current.filter((x) => x !== id) : [...current, id]));

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!between.length) {
      setError("Who was this for?");
      return;
    }
    setBusy(true);
    setError("");
    const url = existing ? `/api/trips/${trip.id}/expenses/${existing.id}` : `/api/trips/${trip.id}/expenses`;
    const res = await fetch(url, {
      method: existing ? "PATCH" : "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        amount: Number(amount),
        vendor,
        spentAt,
        paidFrom: payer === POT ? "pot" : "member",
        payerMemberId: payer === POT ? null : payer,
        participants: between,
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

  const everyone = between.length === trip.members.length;

  return (
    <form onSubmit={submit} className="flex flex-col gap-3">
      <input
        className="field tabular"
        aria-label="Amount"
        placeholder="Amount (Rs)"
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
        aria-label="What for"
        placeholder="What for? e.g. dinner at Cafe de Hunza"
        value={vendor}
        onChange={(e) => setVendor(e.target.value)}
      />
      <label className="flex flex-col gap-1.5">
        <span className="text-[13px]" style={{ color: "var(--muted)" }}>
          When
        </span>
        <input className="field" type="date" value={spentAt} onChange={(e) => setSpentAt(e.target.value)} />
      </label>

      <label className="flex flex-col gap-1.5">
        <span className="text-[13px]" style={{ color: "var(--muted)" }}>
          Paid with
        </span>
        <select className="field" value={payer} onChange={(e) => setPayer(e.target.value)}>
          <option value={POT}>The pot</option>
          {trip.members.map((m) => (
            <option key={m.id} value={m.id}>
              {m.name} paid personally
            </option>
          ))}
        </select>
      </label>

      <div className="flex flex-col gap-2">
        <div className="flex items-center justify-between gap-2">
          <span className="text-[13px]" style={{ color: "var(--muted)" }}>
            Split between
          </span>
          <button
            type="button"
            className="text-[13px] font-semibold"
            style={{ color: "var(--accent)" }}
            onClick={() => setBetween(everyone ? [] : trip.members.map((m) => m.id))}
          >
            {everyone ? "Clear" : "Everyone"}
          </button>
        </div>
        <div className="flex flex-wrap gap-2">
          {trip.members.map((m) => {
            const on = between.includes(m.id);
            return (
              <button
                key={m.id}
                type="button"
                className="chip"
                aria-pressed={on}
                onClick={() => toggle(m.id)}
                style={
                  on
                    ? { background: "var(--accent-soft)", color: "var(--accent)", borderColor: "var(--accent)" }
                    : { opacity: 0.6 }
                }
              >
                {m.name}
              </button>
            );
          })}
        </div>
        {between.length > 0 && Number(amount) > 0 && (
          <p className="text-[12.5px] tabular" style={{ color: "var(--muted)" }}>
            {fmtRs(Number(amount) / between.length)} each
          </p>
        )}
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
          {busy ? "Saving…" : existing ? "Save" : "Add expense"}
        </button>
      </div>
    </form>
  );
}

function SpendSheet({ trip, spend, onClose }: { trip: TripDetail; spend: TripSpend; onClose: () => void }) {
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);

  const remove = async () => {
    setBusy(true);
    await fetch(`/api/trips/${trip.id}/expenses/${spend.id}`, { method: "DELETE" });
    invalidate("/api/trips");
    onClose();
  };

  return (
    <Sheet title="Expense" onClose={onClose}>
      <div className="card p-4">
        <SpendForm
          trip={trip}
          existing={spend}
          onCancel={onClose}
          onDone={() => {
            invalidate("/api/trips");
            onClose();
          }}
        />
      </div>
      {confirming ? (
        <div className="card p-4 mt-3 flex flex-col gap-3" style={{ background: "var(--bad-soft)" }}>
          <p className="text-[14px] font-semibold">Remove this expense from the trip?</p>
          <div className="form-actions">
            <button className="btn btn-ghost" onClick={() => setConfirming(false)}>
              Cancel
            </button>
            <button className="btn btn-danger" onClick={remove} disabled={busy}>
              {busy ? "Removing…" : "Remove"}
            </button>
          </div>
        </div>
      ) : (
        <button className="btn btn-ghost w-full mt-3" style={{ color: "var(--bad)" }} onClick={() => setConfirming(true)}>
          Remove expense
        </button>
      )}
    </Sheet>
  );
}

function SpendingTab({ trip, onOpen }: { trip: TripDetail; onOpen: (spend: TripSpend) => void }) {
  if (!trip.expenses.length) {
    return (
      <div className="card p-8 text-center rise flex flex-col items-center gap-2">
        <p className="text-[17px] font-bold">Nothing spent yet</p>
        <p className="text-[14px]" style={{ color: "var(--muted)" }}>
          Add what the trip spends as it happens, and Khata keeps everyone&apos;s share up to date.
        </p>
      </div>
    );
  }
  return (
    <ul className="list-card rise">
      {trip.expenses.map((spend) => {
        const between = spend.participants.length || trip.members.length;
        const who =
          spend.paidFrom === "pot" ? "From the pot" : `${nameOf(trip, spend.payerMemberId ?? "")} paid`;
        return (
          <li key={spend.id}>
            <button className="list-row w-full text-left" onClick={() => onOpen(spend)}>
              <span className="min-w-0 flex-1">
                <span className="block text-[15px] font-semibold truncate">{spend.vendor || "Trip expense"}</span>
                <span className="block text-[12.5px] mt-0.5" style={{ color: "var(--muted)" }}>
                  {who} · split {between === trip.members.length ? "between everyone" : `${between} ways`} ·{" "}
                  {fmtDateLabel(spend.spentAt.slice(0, 10))}
                </span>
              </span>
              <span className="text-[15px] font-bold tabular shrink-0">{fmtRs(spend.amount)}</span>
            </button>
          </li>
        );
      })}
    </ul>
  );
}

/* ---------- people ---------- */

function DepositForm({ trip, onDone, onCancel }: { trip: TripDetail; onDone: () => void; onCancel: () => void }) {
  const [memberId, setMemberId] = useState(trip.members[0]?.id ?? "");
  const [amount, setAmount] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError("");
    const res = await fetch(`/api/trips/${trip.id}/deposits`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ memberId, amount: Number(amount) }),
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
      <label className="flex flex-col gap-1.5">
        <span className="text-[13px]" style={{ color: "var(--muted)" }}>
          Who put money in
        </span>
        <select className="field" value={memberId} onChange={(e) => setMemberId(e.target.value)}>
          {trip.members.map((m) => (
            <option key={m.id} value={m.id}>
              {m.name}
            </option>
          ))}
        </select>
      </label>
      <input
        className="field tabular"
        aria-label="Amount"
        placeholder="Amount (Rs)"
        type="number"
        inputMode="decimal"
        min="1"
        step="any"
        value={amount}
        onChange={(e) => setAmount(e.target.value)}
        required
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
        <button className="btn btn-primary" disabled={busy}>
          {busy ? "Saving…" : "Add to the pot"}
        </button>
      </div>
    </form>
  );
}

function AddMemberForm({ trip, onDone, onCancel }: { trip: TripDetail; onDone: () => void; onCancel: () => void }) {
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError("");
    const res = await fetch(`/api/trips/${trip.id}/members`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name }),
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
        aria-label="Name"
        placeholder="Name"
        value={name}
        onChange={(e) => setName(e.target.value)}
        required
      />
      <p className="text-[12.5px]" style={{ color: "var(--muted)" }}>
        They share only what you tick them on from now, so nothing already recorded changes.
      </p>
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
          {busy ? "Saving…" : "Add to trip"}
        </button>
      </div>
    </form>
  );
}

function PersonSheet({ trip, member, onClose }: { trip: TripDetail; member: TripMember; onClose: () => void }) {
  const state = trip.state.members.find((m) => m.memberId === member.id);
  const deposits = trip.deposits.filter((d) => d.memberId === member.id);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const remove = async () => {
    setBusy(true);
    setError("");
    const res = await fetch(`/api/trips/${trip.id}/members/${member.id}`, { method: "DELETE" });
    setBusy(false);
    if (!res.ok) {
      const j = await res.json().catch(() => ({}));
      setError(j.error ?? "Couldn't remove them");
      return;
    }
    invalidate("/api/trips");
    onClose();
  };

  const net = state?.net ?? 0;

  return (
    <Sheet title={member.name} onClose={onClose}>
      <div className="card p-4 flex flex-col gap-2">
        <div className="flex justify-between text-[14px]">
          <span style={{ color: "var(--muted)" }}>Put into the pot</span>
          <span className="tabular font-semibold">{fmtRs(state?.deposited ?? 0)}</span>
        </div>
        <div className="flex justify-between text-[14px]">
          <span style={{ color: "var(--muted)" }}>Paid out of pocket</span>
          <span className="tabular font-semibold">{fmtRs(state?.paidOutOfPocket ?? 0)}</span>
        </div>
        <div className="flex justify-between text-[14px]">
          <span style={{ color: "var(--muted)" }}>Their share of the spending</span>
          <span className="tabular font-semibold">{fmtRs(state?.share ?? 0)}</span>
        </div>
        <div className="flex justify-between text-[15px] pt-2" style={{ borderTop: "1px solid var(--hairline)" }}>
          <span className="font-semibold">{net >= 0 ? "Owed back" : "Still owes"}</span>
          <span className="tabular font-extrabold" style={{ color: net >= 0 ? "var(--good)" : "var(--bad)" }}>
            {fmtRs(Math.abs(net))}
          </span>
        </div>
      </div>

      {deposits.length > 0 && (
        <ul className="list-card mt-3">
          {deposits.map((d) => (
            <li key={d.id} className="list-row">
              <span className="min-w-0 flex-1 text-[14px]">
                Put in on {fmtDateLabel(d.createdAt.slice(0, 10))}
              </span>
              <span className="flex items-center gap-3 shrink-0">
                <span className="tabular font-semibold">{fmtRs(d.amount)}</span>
                {trip.status === "open" && (
                  <button
                    className="text-[13px]"
                    style={{ color: "var(--bad)" }}
                    onClick={async () => {
                      await fetch(`/api/trips/${trip.id}/deposits/${d.id}`, { method: "DELETE" });
                      invalidate("/api/trips");
                      onClose();
                    }}
                  >
                    Remove
                  </button>
                )}
              </span>
            </li>
          ))}
        </ul>
      )}

      {error && (
        <p className="text-[13px] mt-3 px-1" style={{ color: "var(--bad)" }} role="alert">
          {error}
        </p>
      )}
      {trip.status === "open" && !member.isMe && (
        <button className="btn btn-ghost w-full mt-3" style={{ color: "var(--bad)" }} onClick={remove} disabled={busy}>
          {busy ? "Removing…" : "Remove from trip"}
        </button>
      )}
    </Sheet>
  );
}

function PeopleTab({ trip, onOpen }: { trip: TripDetail; onOpen: (member: TripMember) => void }) {
  return (
    <ul className="list-card rise">
      {trip.members.map((member) => {
        const state = trip.state.members.find((m) => m.memberId === member.id);
        const net = Math.round((state?.net ?? 0) * 100) / 100;
        return (
          <li key={member.id}>
            <button className="list-row w-full text-left" onClick={() => onOpen(member)}>
              <Avatar id={member.id} name={member.name} size={38} />
              <span className="min-w-0 flex-1">
                <span className="block text-[15px] font-semibold truncate">
                  {member.name}
                  {member.isMe ? " (you)" : ""}
                </span>
                <span className="block text-[12.5px] mt-0.5 tabular" style={{ color: "var(--muted)" }}>
                  Put in {fmtRs(state?.deposited ?? 0)} · share {fmtRs(state?.share ?? 0)}
                </span>
              </span>
              <span
                className="text-[14px] font-bold tabular shrink-0"
                style={{ color: net > 0 ? "var(--good)" : net < 0 ? "var(--bad)" : "var(--muted)" }}
              >
                {net === 0 ? "square" : net > 0 ? `+${fmtRs(net)}` : `−${fmtRs(-net)}`}
              </span>
            </button>
          </li>
        );
      })}
    </ul>
  );
}

/* ---------- settling up ---------- */

function SettleTab({ trip, onRefresh }: { trip: TripDetail; onRefresh: () => void }) {
  const rows =
    trip.status === "closed"
      ? trip.settlements.map((s) => ({
          id: s.id,
          from: s.fromMemberId,
          to: s.toMemberId,
          amount: s.amount,
          paid: Boolean(s.paidAt),
        }))
      : trip.settleUp.map((t, i) => ({ id: String(i), from: t.from, to: t.to, amount: t.amount, paid: false }));

  if (!rows.length) {
    return (
      <div className="card p-8 text-center rise flex flex-col items-center gap-2">
        <p className="text-[17px] font-bold">Everyone is square</p>
        <p className="text-[14px]" style={{ color: "var(--muted)" }}>
          Nothing to settle — what everyone put in matches what they used.
        </p>
      </div>
    );
  }

  return (
    <>
      {trip.status === "open" && (
        <p className="text-[13px] px-1 mb-2" style={{ color: "var(--muted)" }}>
          Where things stand right now. Closing the trip fixes this list so it can be ticked off.
        </p>
      )}
      <ul className="list-card rise">
        {rows.map((row) => (
          <li key={row.id}>
            <div className="list-row">
              <span className="min-w-0 flex-1">
                <span className="block text-[15px] font-semibold truncate" style={{ opacity: row.paid ? 0.55 : 1 }}>
                  {row.from === POT ? `The pot pays ${nameOf(trip, row.to)}` : `${nameOf(trip, row.from)} pays ${nameOf(trip, row.to)}`}
                </span>
                {row.from === POT && (
                  <span className="block text-[12.5px] mt-0.5" style={{ color: "var(--muted)" }}>
                    Money left over, handed back
                  </span>
                )}
              </span>
              <span className="flex items-center gap-3 shrink-0">
                <span className="text-[15px] font-bold tabular" style={{ opacity: row.paid ? 0.55 : 1 }}>
                  {fmtRs(row.amount)}
                </span>
                {trip.status === "closed" && (
                  <input
                    type="checkbox"
                    className="h-6 w-6 accent-[var(--accent)] cursor-pointer"
                    aria-label={`Mark ${fmtRs(row.amount)} as paid`}
                    checked={row.paid}
                    onChange={async (e) => {
                      await fetch(`/api/trips/${trip.id}/settlements/${row.id}`, {
                        method: "PATCH",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({ paid: e.target.checked }),
                      });
                      onRefresh();
                    }}
                  />
                )}
              </span>
            </div>
          </li>
        ))}
      </ul>
    </>
  );
}

function CloseSheet({ trip, onClose, onDone }: { trip: TripDetail; onClose: () => void; onDone: () => void }) {
  const me = trip.members.find((m) => m.isMe);
  const myShare = trip.state.members.find((m) => m.memberId === me?.id)?.share ?? 0;
  const mine = trip.settleUp.filter((t) => t.from !== POT && me && (t.from === me.id || t.to === me.id));
  const [addToMyExpenses, setAddToMyExpenses] = useState(true);
  const [pushToUdhar, setPushToUdhar] = useState(mine.length > 0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const close = async () => {
    setBusy(true);
    setError("");
    const res = await fetch(`/api/trips/${trip.id}/close`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ addToMyExpenses, pushToUdhar }),
    });
    setBusy(false);
    if (!res.ok) {
      const j = await res.json().catch(() => ({}));
      setError(j.error ?? "Couldn't close the trip");
      return;
    }
    onDone();
  };

  return (
    <Sheet title="Close the trip" onClose={onClose}>
      <div className="card p-4 flex flex-col gap-2">
        <div className="flex justify-between text-[14px]">
          <span style={{ color: "var(--muted)" }}>The trip spent</span>
          <span className="tabular font-semibold">{fmtRs(trip.totalSpent)}</span>
        </div>
        <div className="flex justify-between text-[14px]">
          <span style={{ color: "var(--muted)" }}>Left in the pot</span>
          <span className="tabular font-semibold">{fmtRs(trip.potLeft)}</span>
        </div>
        <div className="flex justify-between text-[15px] pt-2" style={{ borderTop: "1px solid var(--hairline)" }}>
          <span className="font-semibold">It cost you</span>
          <span className="tabular font-extrabold">{fmtRs(myShare)}</span>
        </div>
      </div>

      <div className="card p-4 mt-3">
        <p className="text-[15px] font-bold mb-2">To settle up</p>
        {trip.settleUp.length ? (
          <ul className="flex flex-col gap-1.5">
            {trip.settleUp.map((t, i) => (
              <li key={i} className="flex justify-between text-[14px]">
                <span className="min-w-0 truncate">
                  {t.from === POT ? `The pot pays ${nameOf(trip, t.to)}` : `${nameOf(trip, t.from)} pays ${nameOf(trip, t.to)}`}
                </span>
                <span className="tabular font-semibold shrink-0 ml-3">{fmtRs(t.amount)}</span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-[14px]" style={{ color: "var(--muted)" }}>
            Nothing — everyone is square.
          </p>
        )}
      </div>

      <div className="card p-4 mt-3 flex flex-col gap-3">
        <label className="flex items-start justify-between gap-3 cursor-pointer">
          <span className="min-w-0">
            <span className="block text-[15px] font-semibold">Add my share to Mera Khata</span>
            <span className="block text-[12.5px] mt-0.5" style={{ color: "var(--muted)" }}>
              One expense for {fmtRs(myShare)}, so your monthly spending includes the trip.
            </span>
          </span>
          <input
            type="checkbox"
            className="h-6 w-6 mt-0.5 shrink-0 accent-[var(--accent)] cursor-pointer"
            checked={addToMyExpenses}
            onChange={(e) => setAddToMyExpenses(e.target.checked)}
          />
        </label>
        <label className="flex items-start justify-between gap-3 cursor-pointer" style={{ opacity: mine.length ? 1 : 0.5 }}>
          <span className="min-w-0">
            <span className="block text-[15px] font-semibold">Send what&apos;s unpaid to Udhar Khata</span>
            <span className="block text-[12.5px] mt-0.5" style={{ color: "var(--muted)" }}>
              {mine.length
                ? `${mine.length} ${mine.length === 1 ? "payment" : "payments"} involving you, so Khata keeps chasing them.`
                : "Nothing between you and anyone else to chase."}
            </span>
          </span>
          <input
            type="checkbox"
            className="h-6 w-6 mt-0.5 shrink-0 accent-[var(--accent)] cursor-pointer"
            checked={pushToUdhar}
            disabled={!mine.length}
            onChange={(e) => setPushToUdhar(e.target.checked)}
          />
        </label>
      </div>

      {error && (
        <p className="text-[13px] mt-3 px-1" style={{ color: "var(--bad)" }} role="alert">
          {error}
        </p>
      )}
      <div className="form-actions mt-3">
        <button className="btn btn-ghost" onClick={onClose}>
          Not yet
        </button>
        <button className="btn btn-primary" onClick={close} disabled={busy}>
          {busy ? "Closing…" : "Close trip"}
        </button>
      </div>
    </Sheet>
  );
}

/* ---------- the trip ---------- */

export default function TripPage() {
  const section = useTripsSection();
  const router = useRouter();
  const params = useParams<{ id: string }>();
  const id = params.id;
  const { data, failedStatus, refresh } = useCached<TripDetail>(id ? `/api/trips/${id}` : null);
  const trip = data ?? null;

  const [tab, setTab] = useState<"spending" | "people" | "settle">("spending");
  const [addingSpend, setAddingSpend] = useState(false);
  const [openSpend, setOpenSpend] = useState<TripSpend | null>(null);
  const [openMember, setOpenMember] = useState<TripMember | null>(null);
  const [addingDeposit, setAddingDeposit] = useState(false);
  const [addingMember, setAddingMember] = useState(false);
  const [closing, setClosing] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  // Deleting a closed trip: by default, take back the expense and the Udhar
  // entries it wrote, since deleting it says the trip never counted.
  const [undoOnDelete, setUndoOnDelete] = useState(true);

  const reload = useCallback(() => {
    invalidate("/api/trips");
    refresh();
  }, [refresh]);

  // The sheet keeps showing the expense it was opened with, so it has to be
  // taken from the freshly loaded trip after an edit.
  const openSpendLive = useMemo(
    () => (openSpend && trip ? trip.expenses.find((e) => e.id === openSpend.id) ?? null : null),
    [openSpend, trip]
  );
  const openMemberLive = useMemo(
    () => (openMember && trip ? trip.members.find((m) => m.id === openMember.id) ?? null : null),
    [openMember, trip]
  );

  if (failedStatus === 404) {
    return (
      <div className="card p-8 text-center rise flex flex-col items-center gap-3">
        <p className="text-[17px] font-bold">That trip is gone</p>
        <button className="btn btn-primary" onClick={() => router.push("/trips")}>
          Back to trips
        </button>
      </div>
    );
  }
  if (section !== "on" || trip === null) return <Spinner />;

  const closed = trip.status === "closed";
  const spentFromPot = trip.potIn > 0 ? Math.min(1, (trip.potIn - trip.potLeft) / trip.potIn) : 0;

  return (
    <>
      <section className="hero-panel p-6 rise">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="hero-muted text-[14px] font-semibold truncate">{trip.name}</p>
            <p className="mt-1 flex items-baseline gap-2 tabular">
              <span className="hero-muted text-[20px] font-bold">Rs</span>
              <span className="text-[42px] font-extrabold leading-none tracking-tight">
                {fmtRs(trip.totalSpent).replace(/^−?Rs\s/, "")}
              </span>
            </p>
            <p className="hero-muted text-[13px] mt-2 tabular">
              {trip.potIn > 0
                ? `${fmtRs(trip.potLeft)} left of the ${fmtRs(trip.potIn)} everyone put in`
                : "Nothing in the pot yet"}
            </p>
          </div>
          <button
            className="text-[13px] font-semibold shrink-0 hero-muted"
            onClick={() => router.push("/trips")}
            aria-label="Back to trips"
          >
            All trips
          </button>
        </div>
        {trip.potIn > 0 && (
          <div className="mt-3 h-1.5 rounded-full overflow-hidden" style={{ background: "rgba(255,255,255,0.25)" }}>
            <div style={{ width: `${Math.round(spentFromPot * 100)}%`, height: "100%", background: "#fff" }} />
          </div>
        )}
      </section>

      {closed && (
        <div className="card p-4 mt-4 flex items-center gap-3" style={{ background: "var(--accent-soft)" }}>
          <span className="min-w-0 flex-1 text-[14px]">
            This trip is closed. Tick payments off below as they happen.
          </span>
          <button
            className="btn btn-ghost shrink-0"
            onClick={async () => {
              await fetch(`/api/trips/${trip.id}`, {
                method: "PATCH",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ status: "open" }),
              });
              reload();
            }}
          >
            Reopen
          </button>
        </div>
      )}

      <section className="section-head mt-4">
        <div className="segmented" role="group" aria-label="What to show">
          <button aria-pressed={tab === "spending"} onClick={() => setTab("spending")}>
            Spending
          </button>
          <button aria-pressed={tab === "people"} onClick={() => setTab("people")}>
            People
          </button>
          <button aria-pressed={tab === "settle"} onClick={() => setTab("settle")}>
            Settle up
          </button>
        </div>
        {!closed && tab !== "settle" && (
          <button
            className="tab-fab !w-14 !h-14 !m-0 !shadow-none"
            onClick={() => (tab === "spending" ? setAddingSpend(true) : setAddingDeposit(true))}
            aria-label={tab === "spending" ? "Add an expense" : "Add to the pot"}
          >
            +
          </button>
        )}
      </section>

      {tab === "spending" && <SpendingTab trip={trip} onOpen={setOpenSpend} />}
      {tab === "people" && (
        <>
          <PeopleTab trip={trip} onOpen={setOpenMember} />
          {!closed && (
            <button className="btn btn-ghost w-full mt-3" onClick={() => setAddingMember(true)}>
              Add someone to the trip
            </button>
          )}
        </>
      )}
      {tab === "settle" && <SettleTab trip={trip} onRefresh={reload} />}

      {!closed && (
        <button className="btn btn-primary w-full mt-4" onClick={() => setClosing(true)}>
          Close trip and settle up
        </button>
      )}

      {confirmDelete ? (
        <div className="card p-4 mt-4 flex flex-col gap-3" style={{ background: "var(--bad-soft)" }}>
          <p className="text-[14px] font-semibold">
            Delete this trip for good? Its spending, deposits and settle-up go with it.
          </p>
          {closed && (trip.expenseId || trip.settlements.some((s) => s.personId)) && (
            <label className="flex items-start justify-between gap-3 cursor-pointer">
              <span className="min-w-0">
                <span className="block text-[14px] font-semibold">Also take back what closing it added</span>
                <span className="block text-[12.5px] mt-0.5" style={{ color: "var(--muted)" }}>
                  {[
                    trip.expenseId ? "the expense in Mera Khata" : "",
                    trip.settlements.some((s) => s.personId) ? "the Udhar Khata entries" : "",
                  ]
                    .filter(Boolean)
                    .join(" and ")}
                  . Leave this off if the money really did change hands.
                </span>
              </span>
              <input
                type="checkbox"
                className="h-6 w-6 mt-0.5 shrink-0 accent-[var(--accent)] cursor-pointer"
                checked={undoOnDelete}
                onChange={(e) => setUndoOnDelete(e.target.checked)}
              />
            </label>
          )}
          <div className="form-actions">
            <button className="btn btn-ghost" onClick={() => setConfirmDelete(false)}>
              Cancel
            </button>
            <button
              className="btn btn-danger"
              onClick={async () => {
                await fetch(`/api/trips/${trip.id}${closed && undoOnDelete ? "?undo=1" : ""}`, { method: "DELETE" });
                invalidate("/api/trips");
                invalidate("/api/expenses");
                invalidate("/api/people");
                router.push("/trips");
              }}
            >
              Delete trip
            </button>
          </div>
        </div>
      ) : (
        <button className="btn btn-ghost w-full mt-4" style={{ color: "var(--bad)" }} onClick={() => setConfirmDelete(true)}>
          Delete trip
        </button>
      )}

      {addingSpend && (
        <Sheet title="New expense" onClose={() => setAddingSpend(false)}>
          <div className="card p-4">
            <SpendForm
              trip={trip}
              onCancel={() => setAddingSpend(false)}
              onDone={() => {
                setAddingSpend(false);
                reload();
              }}
            />
          </div>
        </Sheet>
      )}
      {openSpendLive && <SpendSheet trip={trip} spend={openSpendLive} onClose={() => setOpenSpend(null)} />}
      {openMemberLive && <PersonSheet trip={trip} member={openMemberLive} onClose={() => setOpenMember(null)} />}
      {addingDeposit && (
        <Sheet title="Add to the pot" onClose={() => setAddingDeposit(false)}>
          <div className="card p-4">
            <DepositForm
              trip={trip}
              onCancel={() => setAddingDeposit(false)}
              onDone={() => {
                setAddingDeposit(false);
                reload();
              }}
            />
          </div>
        </Sheet>
      )}
      {addingMember && (
        <Sheet title="Someone else is coming" onClose={() => setAddingMember(false)}>
          <div className="card p-4">
            <AddMemberForm
              trip={trip}
              onCancel={() => setAddingMember(false)}
              onDone={() => {
                setAddingMember(false);
                reload();
              }}
            />
          </div>
        </Sheet>
      )}
      {closing && (
        <CloseSheet
          trip={trip}
          onClose={() => setClosing(false)}
          onDone={() => {
            setClosing(false);
            setTab("settle");
            reload();
            invalidate("/api/expenses");
            invalidate("/api/people");
          }}
        />
      )}
    </>
  );
}
