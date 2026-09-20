"use client";

import { useCallback, useState } from "react";
import type { AssistantFeedback, UserSummary } from "@/lib/db";
import { Avatar } from "@/components/Avatar";
import { Sheet } from "@/components/Sheet";
import { fmtWhen } from "@/lib/format";
import { useCached } from "@/lib/swr";
import { send } from "@/lib/submit";

/* ---------- create user ---------- */

function CreateUserForm({ onDone, onCancel }: { onDone: () => void; onCancel: () => void }) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError("");
    const sent = await send("/api/admin/users", { body: { username, password, name } });
    setBusy(false);
    if (!sent.ok) {
      setError(sent.error);
      return;
    }
    onDone();
  };

  return (
    <form onSubmit={submit} className="card p-4 flex flex-col gap-3">
      <input
        className="field"
        aria-label="Username"
        placeholder="Username"
        autoComplete="off"
        value={username}
        onChange={(e) => setUsername(e.target.value)}
        required
      />
      <input
        className="field"
        aria-label="Name"
        placeholder="Name (optional)"
        autoComplete="off"
        value={name}
        onChange={(e) => setName(e.target.value)}
      />
      <input
        className="field"
        aria-label="Password"
        placeholder="Password (min 6 characters)"
        type="password"
        autoComplete="new-password"
        value={password}
        onChange={(e) => setPassword(e.target.value)}
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
          {busy ? "Creating…" : "Create user"}
        </button>
      </div>
    </form>
  );
}

/* ---------- one user ---------- */

function UserSheet({ user, onClose, onChanged }: { user: UserSummary; onClose: () => void; onChanged: () => void }) {
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ text: string; bad?: boolean } | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [aiOn, setAiOn] = useState(user.ai_access);

  const toggleAi = async (next: boolean) => {
    setAiOn(next);
    setMessage(null);
    const sent = await send(`/api/admin/users/${user.id}`, { method: "PATCH", body: { aiAccess: next } });
    if (!sent.ok) {
      setAiOn(!next);
      setMessage({ text: sent.error, bad: true });
      return;
    }
    setMessage({ text: next ? `${user.username} can now use the assistant.` : `${user.username} no longer has the assistant.` });
    onChanged();
  };

  const savePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setMessage(null);
    const sent = await send(`/api/admin/users/${user.id}`, { method: "PUT", body: { password } });
    setBusy(false);
    if (!sent.ok) {
      setMessage({ text: sent.error, bad: true });
      return;
    }
    setPassword("");
    setMessage({ text: `Password updated for ${user.username}.` });
  };

  const remove = async () => {
    setBusy(true);
    const sent = await send(`/api/admin/users/${user.id}`, { method: "DELETE" });
    setBusy(false);
    if (!sent.ok) {
      setMessage({ text: sent.error, bad: true });
      setConfirmDelete(false);
      return;
    }
    onClose();
    onChanged();
  };

  return (
    <Sheet title={user.username} onClose={onClose}>
      <div className="card p-5 flex flex-col items-center text-center">
        <Avatar id={user.id} name={user.username} size={64} />
        <p className="text-[18px] font-extrabold mt-3">{user.username}</p>
        <p className="text-[13px]" style={{ color: "var(--muted)" }}>
          Joined {fmtWhen(user.created_at)} · {user.people_count} {user.people_count === 1 ? "loan" : "loans"} ·{" "}
          {user.expense_count} {user.expense_count === 1 ? "expense" : "expenses"}
        </p>
      </div>

      <label className="card p-4 flex items-center justify-between gap-3 cursor-pointer">
        <span className="min-w-0">
          <span className="block text-[15px] font-bold">Assistant access</span>
          <span className="block text-[13px]" style={{ color: "var(--muted)" }}>
            Let {user.username} use the AI assistant: the button in the middle of the tab bar, with voice notes and bill photos.
          </span>
        </span>
        <input
          type="checkbox"
          className="h-6 w-6 shrink-0 cursor-pointer accent-[var(--accent)]"
          checked={aiOn}
          onChange={(e) => toggleAi(e.target.checked)}
          aria-label={`Assistant access for ${user.username}`}
        />
      </label>

      <form onSubmit={savePassword} className="card p-4 flex flex-col gap-3">
        <p className="text-[14px] font-bold">Reset password</p>
        <input
          className="field"
          aria-label={`New password for ${user.username}`}
          placeholder="New password (min 6 characters)"
          type="password"
          autoComplete="new-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required
        />
        <button className="btn btn-primary" disabled={busy || !password}>
          {busy ? "Saving…" : "Save password"}
        </button>
      </form>

      {message && (
        <p className="text-[14px] text-center font-semibold" style={{ color: message.bad ? "var(--bad)" : "var(--good)" }} role="status">
          {message.text}
        </p>
      )}

      {confirmDelete ? (
        <div className="card p-4 flex flex-col gap-3">
          <p className="text-[14px] font-semibold text-center" style={{ color: "var(--bad)" }}>
            Delete {user.username}? Their loans and expenses are removed too.
          </p>
          <div className="grid grid-cols-2 gap-2">
            <button type="button" className="btn btn-ghost" onClick={() => setConfirmDelete(false)}>
              Cancel
            </button>
            <button type="button" className="btn btn-danger" disabled={busy} onClick={remove}>
              Delete
            </button>
          </div>
        </div>
      ) : (
        <button type="button" className="min-h-12 text-[14px] font-bold" style={{ color: "var(--bad)" }} onClick={() => setConfirmDelete(true)}>
          Delete {user.username}
        </button>
      )}
    </Sheet>
  );
}

/* ---------- assistant feedback ---------- */

// What people asked the assistant for that it can't do yet, and messages it
// didn't understand - the list to improve it from.
function FeedbackSection() {
  const { data: items, refresh } = useCached<AssistantFeedback[]>("/api/admin/feedback");
  const [busy, setBusy] = useState(false);

  const remove = async (id?: string) => {
    setBusy(true);
    await fetch(`/api/admin/feedback${id ? `?id=${encodeURIComponent(id)}` : ""}`, { method: "DELETE" });
    await refresh().catch(() => {});
    setBusy(false);
  };

  return (
    <section className="flex flex-col gap-3" aria-labelledby="feedback-title">
      <div className="section-head">
        <h2 id="feedback-title" className="section-title">
          Assistant feedback
        </h2>
        {items && items.length > 0 && (
          <button type="button" className="pill-link" disabled={busy} onClick={() => remove()}>
            Clear all
          </button>
        )}
      </div>
      {!items ? (
        <div className="list-card px-4 py-4 text-[14px]" style={{ color: "var(--muted)" }} role="status">
          Loading…
        </div>
      ) : items.length === 0 ? (
        <div className="list-card px-4 py-4 text-[14px]" style={{ color: "var(--muted)" }}>
          Nothing yet. Suggestions people give the assistant, and messages it couldn&apos;t handle, show up here.
        </div>
      ) : (
        <ul className="list-card">
          {items.map((f) => (
            <li key={f.id} className="flex items-start gap-3 px-2 py-3">
              <span className="min-w-0 flex-1">
                <span className="flex items-center gap-2">
                  <span
                    className="chip"
                    style={
                      f.kind === "suggestion"
                        ? { background: "var(--good-soft)", color: "var(--good)" }
                        : { background: "var(--accent-soft)", color: "var(--accent)" }
                    }
                  >
                    {f.kind === "suggestion" ? "Suggestion" : "Not understood"}
                  </span>
                  <span className="text-[12px] truncate" style={{ color: "var(--muted)" }}>
                    {f.username} · {fmtWhen(f.created_at)}
                  </span>
                </span>
                <span className="block text-[14px] mt-1 break-words">{f.text}</span>
              </span>
              <button
                type="button"
                className="chat-round !w-9 !h-9 shrink-0"
                aria-label="Remove"
                disabled={busy}
                onClick={() => remove(f.id)}
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" aria-hidden>
                  <path d="M6 6l12 12M18 6L6 18" />
                </svg>
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/* ---------- page ---------- */

export default function AdminPage() {
  const { data: users, failedStatus, refresh } = useCached<UserSummary[]>("/api/admin/users");
  const [creating, setCreating] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);
  const close = useCallback(() => setOpenId(null), []);
  const closeCreate = useCallback(() => setCreating(false), []);
  const denied = failedStatus === 401 || failedStatus === 403;
  const open = users?.find((u) => u.id === openId) ?? null;

  if (denied) {
    return (
      <div className="card p-6 text-center rise" role="alert">
        <p style={{ color: "var(--bad)" }}>You don&apos;t have access to this page.</p>
      </div>
    );
  }

  return (
    <>
      <div className="section-head">
        <h2 className="section-title">
          {users ? `${users.length} ${users.length === 1 ? "user" : "users"}` : "Users"}
        </h2>
        <button type="button" className="tab-fab !w-12 !h-12 !m-0 !shadow-none" aria-label="Create user" onClick={() => setCreating(true)}>
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" aria-hidden>
            <path d="M12 5v14M5 12h14" />
          </svg>
        </button>
      </div>

      {!users ? (
        <div className="list-card" role="status" aria-label="Loading users">
          {[0, 1, 2].map((i) => (
            <div key={i} className="flex items-center gap-3 px-2 py-3">
              <span className="skeleton" style={{ width: 40, height: 40 }} />
              <span className="skeleton" style={{ width: "50%", height: 14 }} />
            </div>
          ))}
        </div>
      ) : (
        <ul className="list-card rise">
          {users.map((u) => (
            <li key={u.id}>
              <button type="button" className="list-row" onClick={() => !u.is_admin && setOpenId(u.id)} disabled={u.is_admin}>
                <Avatar id={u.id} name={u.username} size={42} />
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-1.5 text-[16px] font-bold truncate">
                    {u.username}
                    {u.is_admin && (
                      <span className="chip" style={{ background: "var(--accent-soft)", color: "var(--accent)" }}>
                        Admin
                      </span>
                    )}
                    {!u.is_admin && u.ai_access && (
                      <span className="chip" style={{ background: "var(--good-soft)", color: "var(--good)" }}>
                        AI
                      </span>
                    )}
                  </span>
                  <span className="block text-[12px] truncate" style={{ color: "var(--muted)" }}>
                    Joined {fmtWhen(u.created_at)} · {u.people_count} loans · {u.expense_count} expenses
                  </span>
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}

      <FeedbackSection />

      {open && <UserSheet user={open} onClose={close} onChanged={refresh} />}

      {creating && (
        <Sheet title="New user" onClose={closeCreate}>
          <CreateUserForm
            onCancel={closeCreate}
            onDone={() => {
              setCreating(false);
              refresh();
            }}
          />
        </Sheet>
      )}
    </>
  );
}
