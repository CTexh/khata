"use client";

import { useCallback, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { TripSummary } from "@/lib/trips-db";
import { fmtRs, fmtDateLabel } from "@/lib/format";
import { Avatar } from "@/components/Avatar";
import { Sheet, useUnsaved } from "@/components/Sheet";
import { SuitcaseIcon } from "@/components/icons";
import { invalidate, useCached } from "@/lib/swr";
import { send } from "@/lib/submit";
import { LoadError } from "@/components/LoadError";
import { useTripsSection } from "./guard";

function Spinner() {
  return (
    <div className="flex justify-center py-16" role="status" aria-label="Loading trips">
      <div
        className="w-6 h-6 rounded-full border-2 animate-spin"
        style={{ borderColor: "var(--hairline)", borderTopColor: "var(--accent)" }}
      />
    </div>
  );
}

// "12–18 Oct" when both ends are known, one date when only one is.
function tripDates(trip: TripSummary): string {
  if (trip.startDate && trip.endDate) return `${fmtDateLabel(trip.startDate)} – ${fmtDateLabel(trip.endDate)}`;
  const one = trip.startDate ?? trip.endDate;
  return one ? fmtDateLabel(one) : "";
}

// Where you stand on a trip, in the fewest words that are still true.
function yourPosition(trip: TripSummary): { text: string; color: string } {
  const net = Math.round(trip.myNet * 100) / 100;
  if (net > 0) return { text: `You're owed ${fmtRs(net)}`, color: "var(--good)" };
  if (net < 0) return { text: `You owe ${fmtRs(-net)}`, color: "var(--bad)" };
  return { text: "You're square", color: "var(--muted)" };
}

function TripCard({ trip }: { trip: TripSummary }) {
  const dates = tripDates(trip);
  const position = yourPosition(trip);
  const closed = trip.status === "closed";

  return (
    <Link href={`/trips/${trip.id}`} className="card p-4 flex flex-col gap-3" style={{ opacity: closed ? 0.75 : 1 }}>
      <div className="flex items-start gap-3">
        <span className="min-w-0 flex-1">
          <span className="block text-[17px] font-bold truncate">{trip.name}</span>
          <span className="block text-[13px] mt-0.5" style={{ color: "var(--muted)" }}>
            {[dates, `${trip.members.length} ${trip.members.length === 1 ? "person" : "people"}`]
              .filter(Boolean)
              .join(" · ")}
          </span>
        </span>
        <span className="flex -space-x-2 shrink-0">
          {trip.members.slice(0, 4).map((m) => (
            <Avatar key={m.id} id={m.id} name={m.name} size={28} />
          ))}
        </span>
      </div>
      <div className="flex items-end justify-between gap-3">
        <span className="min-w-0">
          <span className="block text-[13px]" style={{ color: "var(--muted)" }}>
            {closed ? "Trip total" : "Spent"}
          </span>
          <span className="block text-[20px] font-extrabold tabular">{fmtRs(trip.totalSpent)}</span>
        </span>
        <span className="text-right min-w-0">
          {!closed && trip.potIn > 0 && (
            <span className="block text-[13px] tabular" style={{ color: "var(--muted)" }}>
              {fmtRs(trip.potLeft)} left in the pot
            </span>
          )}
          <span
            className="block text-[13px] font-semibold"
            style={{ color: closed ? "var(--muted)" : position.color }}
          >
            {closed ? "Closed" : position.text}
          </span>
        </span>
      </div>
    </Link>
  );
}

function NewTripForm({ onDone, onCancel }: { onDone: (id: string) => void; onCancel: () => void }) {
  const [name, setName] = useState("");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [who, setWho] = useState("");
  const [members, setMembers] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useUnsaved(Boolean(name.trim() || who.trim() || members.length));

  const addMember = () => {
    const trimmed = who.trim();
    if (!trimmed) return;
    if (members.some((m) => m.toLowerCase() === trimmed.toLowerCase())) {
      setError(`${trimmed} is already on the list`);
      return;
    }
    setMembers([...members, trimmed]);
    setWho("");
    setError("");
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    // Someone typed a name but never pressed Add - take it anyway.
    const all = who.trim() && !members.includes(who.trim()) ? [...members, who.trim()] : members;
    setBusy(true);
    setError("");
    const sent = await send<{ id: string }>("/api/trips", { body: { name, startDate, endDate, members: all } });
    setBusy(false);
    if (!sent.ok) {
      setError(sent.error);
      return;
    }
    onDone(sent.data.id);
  };

  return (
    <form onSubmit={submit} className="flex flex-col gap-3">
      <input
        className="field"
        aria-label="Trip name"
        placeholder="Where to? e.g. Hunza, December"
        value={name}
        onChange={(e) => setName(e.target.value)}
        required
      />
      <div className="grid gap-2 sm:grid-cols-2">
        <label className="flex flex-col gap-1.5">
          <span className="text-[13px]" style={{ color: "var(--muted)" }}>
            Starts
          </span>
          <input className="field" type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
        </label>
        <label className="flex flex-col gap-1.5">
          <span className="text-[13px]" style={{ color: "var(--muted)" }}>
            Ends
          </span>
          <input className="field" type="date" value={endDate} min={startDate || undefined} onChange={(e) => setEndDate(e.target.value)} />
        </label>
      </div>

      <div className="flex flex-col gap-2">
        <span className="text-[13px]" style={{ color: "var(--muted)" }}>
          Who else is going? You&apos;re on the trip already.
        </span>
        <div className="flex gap-2">
          <input
            className="field flex-1"
            aria-label="Add someone to the trip"
            autoCapitalize="words"
            autoCorrect="off"
            spellCheck={false}
            enterKeyHint="done"
            placeholder="Name"
            value={who}
            onChange={(e) => setWho(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                addMember();
              }
            }}
          />
          <button type="button" className="btn btn-ghost" onClick={addMember}>
            Add
          </button>
        </div>
        {members.length > 0 && (
          <div className="flex flex-wrap gap-2">
            {members.map((m) => (
              <button
                key={m}
                type="button"
                className="chip"
                onClick={() => setMembers(members.filter((x) => x !== m))}
                aria-label={`Remove ${m}`}
              >
                {m} ✕
              </button>
            ))}
          </div>
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
          {busy ? "Saving…" : "Start trip"}
        </button>
      </div>
    </form>
  );
}

export default function Trips() {
  const section = useTripsSection();
  const router = useRouter();
  const { data, failedStatus, refresh } = useCached<TripSummary[]>("/api/trips");
  const trips = data ?? null;
  const [adding, setAdding] = useState(false);
  const closeAdd = useCallback(() => setAdding(false), []);

  if (section === "failed") return <LoadError what="your trips" onRetry={() => location.reload()} />;
  if (trips === null && failedStatus !== undefined) return <LoadError what="your trips" onRetry={refresh} />;
  if (section !== "on" || trips === null) return <Spinner />;

  const open = trips.filter((t) => t.status === "open");
  const closed = trips.filter((t) => t.status === "closed");
  const owedToYou = open.reduce((sum, t) => sum + Math.max(0, t.myNet), 0);
  const youOwe = open.reduce((sum, t) => sum + Math.max(0, -t.myNet), 0);

  return (
    <>
      {open.length > 0 && (
        <section className="hero-panel p-6 rise">
          <p className="hero-muted text-[14px] font-semibold">
            {open.length === 1 ? "One trip on the go" : `${open.length} trips on the go`}
          </p>
          <p className="mt-1 flex items-baseline gap-2 tabular">
            <span className="hero-muted text-[20px] font-bold">Rs</span>
            <span className="text-[42px] font-extrabold leading-none tracking-tight">
              {fmtRs(open.reduce((sum, t) => sum + t.totalSpent, 0)).replace(/^−?Rs\s/, "")}
            </span>
          </p>
          <p className="hero-muted text-[13px] mt-2">
            {owedToYou > 0 || youOwe > 0
              ? [owedToYou > 0 ? `${fmtRs(owedToYou)} owed to you` : "", youOwe > 0 ? `you owe ${fmtRs(youOwe)}` : ""]
                  .filter(Boolean)
                  .join(" · ")
              : "Everyone is square so far"}
          </p>
        </section>
      )}

      <section className="section-head mt-4">
        <h2 className="section-title">{open.length ? "On the go" : "Trips"}</h2>
        <button
          className="tab-fab !w-14 !h-14 !m-0 !shadow-none"
          onClick={() => setAdding(true)}
          aria-label="Start a trip"
        >
          +
        </button>
      </section>

      {trips.length === 0 ? (
        <div className="card p-8 text-center rise flex flex-col items-center gap-3">
          <span style={{ color: "var(--muted)" }}>
            <SuitcaseIcon size={32} />
          </span>
          <p className="text-[17px] font-bold">No trips yet</p>
          <p className="text-[14px]" style={{ color: "var(--muted)" }}>
            Put everyone&apos;s money into one pot, spend from it, and Khata works out who owes whom at the end.
          </p>
          <button className="btn btn-primary" onClick={() => setAdding(true)}>
            Start a trip
          </button>
        </div>
      ) : (
        <div className="flex flex-col gap-3 rise">
          {open.map((trip) => (
            <TripCard key={trip.id} trip={trip} />
          ))}
          {open.length === 0 && (
            <p className="text-[14px] px-1" style={{ color: "var(--muted)" }}>
              Nothing on the go. Your finished trips are below.
            </p>
          )}
        </div>
      )}

      {closed.length > 0 && (
        <>
          <section className="section-head mt-6">
            <h2 className="section-title">Finished</h2>
          </section>
          <div className="flex flex-col gap-3">
            {closed.map((trip) => (
              <TripCard key={trip.id} trip={trip} />
            ))}
          </div>
        </>
      )}

      {adding && (
        <Sheet title="Start a trip" onClose={closeAdd}>
          <div className="card p-4">
            <NewTripForm
              onCancel={closeAdd}
              onDone={(id) => {
                setAdding(false);
                invalidate("/api/trips");
                router.push(`/trips/${id}`);
              }}
            />
          </div>
        </Sheet>
      )}
    </>
  );
}
