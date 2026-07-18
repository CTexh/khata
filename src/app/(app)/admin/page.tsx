"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { UserSummary } from "@/lib/db";
import { Avatar } from "@/components/Avatar";
import { fmtWhen } from "@/lib/format";

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

/* ---------- create user ---------- */

function CreateUserForm({ onDone, onCancel }: { onDone: () => void; onCancel: () => void }) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => ref.current?.focus(), []);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError("");
    const res = await fetch("/api/admin/users", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username, password }),
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
      <p className="font-semibold">New user</p>
      <input
        ref={ref}
        className="field"
        placeholder="Username"
        value={username}
        onChange={(e) => setUsername(e.target.value)}
        required
      />
      <input
        className="field"
        placeholder="Password (min 6 characters)"
        type="password"
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        required
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
        <button className="btn btn-admin" disabled={busy}>
          {busy ? "Creating…" : "Create user"}
        </button>
      </div>
    </form>
  );
}

/* ---------- reset password ---------- */

function ResetPasswordForm({
  user,
  onDone,
  onCancel,
}: {
  user: UserSummary;
  onDone: () => void;
  onCancel: () => void;
}) {
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => ref.current?.focus(), []);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError("");
    const res = await fetch(`/api/admin/users/${user.id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password }),
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
    <form onSubmit={submit} className="flex flex-col gap-2 mt-3 pt-3 border-t" style={{ borderColor: "var(--hairline)" }}>
      <input
        ref={ref}
        className="field"
        placeholder={`New password for ${user.username}`}
        type="password"
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        required
      />
      {error && (
        <p className="text-[13px]" style={{ color: "var(--bad)" }}>
          {error}
        </p>
      )}
      <div className="flex gap-2 justify-end">
        <button type="button" className="btn btn-ghost !py-2 text-[12px]" onClick={onCancel}>
          Cancel
        </button>
        <button className="btn btn-primary !py-2 text-[12px]" disabled={busy}>
          {busy ? "Saving…" : "💾 Save password"}
        </button>
      </div>
    </form>
  );
}

/* ---------- user row ---------- */

function UserRow({ user, onChanged }: { user: UserSummary; onChanged: () => void }) {
  const [resetting, setResetting] = useState(false);

  const remove = async () => {
    if (
      !confirm(
        `Delete ${user.username}'s account? This permanently removes their loans and expenses too.`
      )
    )
      return;
    const res = await fetch(`/api/admin/users/${user.id}`, { method: "DELETE" });
    if (!res.ok) {
      const j = await res.json().catch(() => ({}));
      alert(j.error ?? "Couldn't delete that user");
      return;
    }
    onChanged();
  };

  return (
    <li className="p-3 border-b last:border-b-0" style={{ borderColor: "var(--hairline)" }}>
      <div className="flex items-center gap-3">
        <Avatar id={user.id} name={user.username} size={40} />
        <div className="min-w-0 flex-1">
          <p className="font-semibold truncate flex items-center gap-1.5">
            {user.username}
            {user.is_admin && (
              <span
                className="text-[10px] font-bold px-1.5 py-0.5 rounded-full"
                style={{ background: "var(--accent-soft)", color: "var(--accent)" }}
              >
                ADMIN
              </span>
            )}
          </p>
          <p className="text-[12px]" style={{ color: "var(--muted)" }}>
            Joined {fmtWhen(user.created_at)} · {user.people_count} loan
            {user.people_count === 1 ? "" : "s"} · {user.expense_count} expense
            {user.expense_count === 1 ? "" : "s"}
          </p>
        </div>
        {!user.is_admin && (
          <div className="flex gap-1.5 shrink-0">
            <button
              onClick={() => setResetting((v) => !v)}
              className="btn btn-ghost !py-2 !px-3 text-[12px]"
            >
              <span>🔑</span> Password
            </button>
            <button
              onClick={remove}
              className="btn btn-danger !py-2 !px-3 text-[12px]"
            >
              <span>🗑</span> Delete
            </button>
          </div>
        )}
      </div>

      {resetting && (
        <ResetPasswordForm
          user={user}
          onCancel={() => setResetting(false)}
          onDone={() => {
            setResetting(false);
            alert(`Password updated for ${user.username}.`);
          }}
        />
      )}
    </li>
  );
}

/* ---------- page ---------- */

export default function AdminPage() {
  const [users, setUsers] = useState<UserSummary[] | null>(null);
  const [error, setError] = useState("");
  const [creating, setCreating] = useState(false);

  const load = useCallback(async () => {
    const res = await fetch("/api/admin/users");
    if (!res.ok) {
      setError("You don't have access to this page.");
      return;
    }
    setUsers(await res.json());
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <>
      <div className="flex items-center justify-end -mt-2">
        {!error && !creating && (
          <button className="btn btn-admin" onClick={() => setCreating(true)}>
            Create user
          </button>
        )}
      </div>

      {error && (
        <div className="card p-6 text-center rise">
          <p style={{ color: "var(--bad)" }}>{error}</p>
        </div>
      )}

      {creating && (
        <CreateUserForm
          onCancel={() => setCreating(false)}
          onDone={() => {
            setCreating(false);
            load();
          }}
        />
      )}

      {!error && users === null && <Spinner />}

      {!error && users && (
        <div className="card p-2 rise">
          <ul className="flex flex-col">
            {users.map((u) => (
              <UserRow key={u.id} user={u} onChanged={load} />
            ))}
          </ul>
        </div>
      )}

      <footer className="text-center text-[12px] py-4" style={{ color: "var(--muted)" }}>
        {users?.length ?? 0} registered user{users?.length === 1 ? "" : "s"}
      </footer>
    </>
  );
}
