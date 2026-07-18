"use client";

import { useCallback, useEffect, useState } from "react";
import type { UserSummary } from "@/lib/db";
import { AppShell } from "@/components/AppShell";
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

export default function AdminPage() {
  const [users, setUsers] = useState<UserSummary[] | null>(null);
  const [error, setError] = useState("");

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

  const remove = async (u: UserSummary) => {
    if (
      !confirm(
        `Delete ${u.username}'s account? This permanently removes their loans and expenses too.`
      )
    )
      return;
    const res = await fetch(`/api/admin/users/${u.id}`, { method: "DELETE" });
    if (!res.ok) {
      const j = await res.json().catch(() => ({}));
      alert(j.error ?? "Couldn't delete that user");
      return;
    }
    load();
  };

  return (
    <AppShell>
      <div className="flex items-center justify-between -mt-2">
        <h2 className="text-[17px] font-bold">🛠️ Admin — Users</h2>
      </div>

      {error && (
        <div className="card p-6 text-center rise">
          <p style={{ color: "var(--bad)" }}>{error}</p>
        </div>
      )}

      {!error && users === null && <Spinner />}

      {!error && users && (
        <div className="card p-2 rise">
          <ul className="flex flex-col">
            {users.map((u) => (
              <li
                key={u.id}
                className="flex items-center gap-3 p-3 border-b last:border-b-0"
                style={{ borderColor: "var(--hairline)" }}
              >
                <Avatar id={u.id} name={u.username} size={40} />
                <div className="min-w-0 flex-1">
                  <p className="font-semibold truncate flex items-center gap-1.5">
                    {u.username}
                    {u.is_admin && (
                      <span
                        className="text-[10px] font-bold px-1.5 py-0.5 rounded-full"
                        style={{ background: "var(--accent-soft)", color: "var(--accent)" }}
                      >
                        ADMIN
                      </span>
                    )}
                  </p>
                  <p className="text-[12px]" style={{ color: "var(--muted)" }}>
                    Joined {fmtWhen(u.created_at)} · {u.people_count} loan
                    {u.people_count === 1 ? "" : "s"} · {u.expense_count} expense
                    {u.expense_count === 1 ? "" : "s"}
                  </p>
                </div>
                {!u.is_admin && (
                  <button
                    onClick={() => remove(u)}
                    className="btn btn-danger !py-2 !px-3 text-[12px] shrink-0"
                  >
                    <span>🗑</span> Delete
                  </button>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}

      <footer className="text-center text-[12px] py-4" style={{ color: "var(--muted)" }}>
        {users?.length ?? 0} registered user{users?.length === 1 ? "" : "s"}
      </footer>
    </AppShell>
  );
}
