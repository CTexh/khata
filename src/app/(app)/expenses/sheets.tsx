"use client";

// Two screens that are opened now and then, and were downloaded every time
// anyone opened Mera Khata: managing the category list, and previewing a
// re-categorisation of a whole period. They live here so the expenses page
// does not carry them until one is asked for.

import { useEffect, useState } from "react";
import { fmtRs, fmtDateLabel } from "@/lib/format";
import { Sheet } from "@/components/Sheet";
import { send } from "@/lib/submit";
import type { UserCategory } from "./page";

type RecatChange = {
  id: string;
  expense_date: string;
  vendor: string | null;
  note: string | null;
  amount: number;
  from: string | null;
  to: string | null;
  reason: "rule" | "vendor-rule" | "keyword" | "tidy" | "learned" | "unexplained";
};

const REASON_LABEL: Record<RecatChange["reason"], string> = {
  keyword: "keyword on one of your categories",
  unexplained: "nothing explains it - needs your decision",
  rule: "family/car rule",
  "vendor-rule": "your rule for this payee",
  tidy: "same category, consistent spelling",
  learned: "how you usually categorise this payee",
};

// Shows exactly what a re-categorisation would change before anything is
// written, so a bad rule can be spotted rather than silently rewriting history.

export function ManageCategoriesModal({
  categories,
  onClose,
  onChanged,
}: {
  categories: UserCategory[];
  onClose: () => void;
  onChanged: (next: UserCategory[]) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [newName, setNewName] = useState("");
  const [newKeywords, setNewKeywords] = useState("");
  const [editing, setEditing] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [editKeywords, setEditKeywords] = useState("");
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const [confirmReset, setConfirmReset] = useState(false);

  const save = async (method: string, body?: unknown, qs = "") => {
    setBusy(true);
    setError("");
    const sent = await send<{ categories?: UserCategory[] }>(`/api/categories${qs}`, { method, body });
    setBusy(false);
    if (!sent.ok) {
      setError(sent.error);
      return false;
    }
    onChanged(sent.data.categories ?? []);
    return true;
  };

  const add = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newName.trim()) return;
    if (await save("POST", { name: newName.trim(), keywords: newKeywords.trim() })) {
      setNewName("");
      setNewKeywords("");
    }
  };

  const saveEdit = async () => {
    if (!editing) return;
    if (await save("PATCH", { name: editing, newName: editName, keywords: editKeywords })) {
      setEditing(null);
    }
  };

  return (
    <Sheet title="Manage categories" onClose={onClose}>

        <form onSubmit={add} className="card p-4 flex flex-col gap-2">
          <p className="text-[13px] font-semibold">New category</p>
          <input
            className="field"
            aria-label="New category name"
            placeholder="Name, e.g. Gym"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
          />
          <input
            className="field"
            aria-label="New category keywords"
            placeholder="Auto-match keywords, comma separated (optional)"
            value={newKeywords}
            onChange={(e) => setNewKeywords(e.target.value)}
          />
          <p className="text-[12px]" style={{ color: "var(--muted)" }}>
            Keywords make it automatic: anything whose payee or note contains one
            lands here on its own.
          </p>
          <div className="form-actions">
            <button className="btn btn-primary !py-2 text-[13px]" disabled={busy || !newName.trim()}>
              {busy ? "Saving…" : "Add category"}
            </button>
          </div>
        </form>

        {error && (
          <p className="text-[13px] px-1" style={{ color: "var(--bad)" }} role="alert">
            {error}
          </p>
        )}

        <div className="px-1">
          {confirmReset ? (
            <div className="rounded-xl px-3 py-2.5" style={{ background: "var(--surface-2)" }}>
              <p className="text-[13px]">
                Replace your list with the standard set? Your expenses keep their
                current categories - run Re-categorise afterwards to fold them onto
                the new names.
              </p>
              <div className="form-actions">
                <button
                  type="button"
                  className="btn btn-ghost !py-2 text-[12px]"
                  onClick={() => setConfirmReset(false)}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  className="btn btn-primary !py-2 text-[12px]"
                  disabled={busy}
                  onClick={async () => {
                    if (await save("POST", { reset: true })) setConfirmReset(false);
                  }}
                >
                  Reset
                </button>
              </div>
            </div>
          ) : (
            <button
              type="button"
              className="text-[12px] underline underline-offset-2 cursor-pointer"
              style={{ color: "var(--muted)" }}
              onClick={() => setConfirmReset(true)}
            >
              Reset to the standard set
            </button>
          )}
        </div>

        <ul className="flex flex-col gap-2">
          {categories.map((c) => (
            <li key={c.name} className="card px-3 py-2.5">
              {editing === c.name ? (
                <div className="flex flex-col gap-2">
                  <input
                    className="field"
                    aria-label="Category name"
                    value={editName}
                    onChange={(e) => setEditName(e.target.value)}
                  />
                  <input
                    className="field"
                    aria-label="Category keywords"
                    placeholder="Keywords, comma separated"
                    value={editKeywords}
                    onChange={(e) => setEditKeywords(e.target.value)}
                  />
                  <div className="form-actions">
                    <button
                      type="button"
                      className="btn btn-ghost !py-2 text-[12px]"
                      onClick={() => setEditing(null)}
                    >
                      Cancel
                    </button>
                    <button
                      type="button"
                      className="btn btn-primary !py-2 text-[12px]"
                      onClick={saveEdit}
                      disabled={busy}
                    >
                      Save
                    </button>
                  </div>
                </div>
              ) : confirmDelete === c.name ? (
                <div className="flex flex-col gap-2">
                  <p className="text-[13px]">
                    Delete <strong>{c.name}</strong>? Its expenses go back to
                    uncategorised so you can re-sort them.
                  </p>
                  <div className="form-actions">
                    <button
                      type="button"
                      className="btn btn-ghost !py-2 text-[12px]"
                      onClick={() => setConfirmDelete(null)}
                    >
                      Cancel
                    </button>
                    <button
                      type="button"
                      className="btn btn-danger !py-2 text-[12px]"
                      disabled={busy}
                      onClick={async () => {
                        if (await save("DELETE", undefined, `?name=${encodeURIComponent(c.name)}`)) {
                          setConfirmDelete(null);
                        }
                      }}
                    >
                      Delete
                    </button>
                  </div>
                </div>
              ) : (
                <div className="flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-[13px] font-semibold truncate">{c.name}</p>
                    <p className="text-[12px] truncate" style={{ color: "var(--muted)" }}>
                      {c.keywords.length ? c.keywords.join(", ") : "No auto-match keywords"}
                    </p>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <button
                      type="button"
                      className="text-[12px] underline underline-offset-2 cursor-pointer"
                      style={{ color: "var(--muted)" }}
                      onClick={() => {
                        setEditing(c.name);
                        setEditName(c.name);
                        setEditKeywords(c.keywords.join(", "));
                      }}
                    >
                      Edit
                    </button>
                    <button
                      type="button"
                      className="text-[12px] underline underline-offset-2 cursor-pointer"
                      style={{ color: "var(--bad)" }}
                      onClick={() => setConfirmDelete(c.name)}
                    >
                      Delete
                    </button>
                  </div>
                </div>
              )}
            </li>
          ))}
        </ul>
    </Sheet>
  );
}

export function RecategorizeModal({ onClose, onApplied }: { onClose: () => void; onApplied: () => void }) {
  const [loading, setLoading] = useState(true);
  const [applying, setApplying] = useState(false);
  const [data, setData] = useState<{
    scanned: number;
    total: number;
    summary: { label: string; count: number }[];
    changes: RecatChange[];
  } | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    fetch("/api/expenses/recategorize")
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error("Couldn't build a preview"))))
      .then(setData)
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  const apply = async () => {
    setApplying(true);
    const sent = await send("/api/expenses/recategorize");
    setApplying(false);
    if (!sent.ok) {
      setError(sent.error);
      return;
    }
    onApplied();
  };

  return (
    <Sheet title="Re-categorise expenses" onClose={onClose}>

        <div className="card p-4 flex flex-col gap-3">
          {loading && (
            <p className="text-[13px]" style={{ color: "var(--muted)" }} role="status">
              Working out what would change…
            </p>
          )}

          {error && (
            <p className="text-[13px]" style={{ color: "var(--bad)" }} role="alert">
              {error}
            </p>
          )}

          {data && !loading && (
            <>
              <p className="text-[13px]" style={{ color: "var(--muted)" }}>
                Scanned {data.scanned} expenses.{" "}
                {data.total === 0 ? (
                  <>Nothing needs changing.</>
                ) : (
                  <>
                    <strong style={{ color: "var(--ink)" }}>{data.total}</strong> would change.
                    Nothing is saved until you apply.
                  </>
                )}
              </p>

              {data.summary.length > 0 && (
                <ul className="flex flex-col gap-1">
                  {data.summary.map((s) => (
                    <li
                      key={s.label}
                      className="flex items-center justify-between text-[13px] py-1.5 px-3 rounded-lg"
                      style={{ background: "var(--surface-2)" }}
                    >
                      <span className="truncate">{s.label}</span>
                      <span className="tabular font-semibold shrink-0 ml-3">{s.count}</span>
                    </li>
                  ))}
                </ul>
              )}

              {data.changes.length > 0 && (
                <details>
                  <summary className="text-[13px] cursor-pointer" style={{ color: "var(--muted)" }}>
                    See individual expenses
                  </summary>
                  <ul className="flex flex-col gap-2 mt-2">
                    {data.changes.map((ch) => (
                      <li
                        key={ch.id}
                        className="text-[12px] py-2 px-3 rounded-lg"
                        style={{ background: "var(--surface-2)" }}
                      >
                        <div className="flex items-center justify-between gap-3">
                          <span className="font-semibold truncate">
                            {ch.vendor || ch.note || "Expense"}
                          </span>
                          <span className="tabular shrink-0">{fmtRs(ch.amount)}</span>
                        </div>
                        <div style={{ color: "var(--muted)" }}>
                          {fmtDateLabel(ch.expense_date)} · {ch.from ?? "uncategorised"} →{" "}
                          <strong style={{ color: "var(--ink)" }}>{ch.to}</strong> ·{" "}
                          {REASON_LABEL[ch.reason]}
                        </div>
                      </li>
                    ))}
                  </ul>
                  {data.total > data.changes.length && (
                    <p className="text-[12px] mt-2" style={{ color: "var(--muted)" }}>
                      Showing the first {data.changes.length} of {data.total}.
                    </p>
                  )}
                </details>
              )}
            </>
          )}
        </div>

        <div className="form-actions">
          <button type="button" className="btn btn-ghost" onClick={onClose}>
            Cancel
          </button>
          <button
            type="button"
            className="btn btn-primary"
            onClick={apply}
            disabled={applying || loading || !data || data.total === 0}
          >
            {applying ? "Applying…" : data ? `Apply ${data.total} change${data.total === 1 ? "" : "s"}` : "Apply"}
          </button>
        </div>
    </Sheet>
  );
}
