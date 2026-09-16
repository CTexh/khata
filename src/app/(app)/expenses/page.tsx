"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { Expense } from "@/lib/db";
import { fmtRs, fmtDateLabel, MONTH_NAMES } from "@/lib/format";
import { categoryVars } from "@/lib/category-style";
import { CategoryIcon, DownloadIcon, FolderIcon, LeafIcon, QuestionIcon } from "@/components/CategoryIcon";
import { SparkleIcon } from "@/components/icons";
import { Sheet, SheetRow } from "@/components/Sheet";
import { fetchKey, invalidate, isFresh, peek, useCached } from "@/lib/swr";

// Expense times are stored as Pakistan wall-clock time with a Z suffix - the
// assistant saves them the same way - so they are read and written as they
// are, with no time-zone conversion. The form used to start from the UTC time,
// five hours behind Pakistan, and a late-night expense could land on the
// previous day.
function pakistanNowLocal(): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Karachi",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date());
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "00";
  return `${get("year")}-${get("month")}-${get("day")}T${get("hour")}:${get("minute")}`;
}

function toLocalDateTime(stored: string): string {
  if (!stored) return "";
  return stored.length === 10 ? `${stored}T00:00` : stored.slice(0, 16);
}

function fromLocalDateTime(local: string): string {
  if (!local) return "";
  return `${local}:00Z`;
}

/* ---------- categories ---------- */

type UserCategory = { name: string; keywords: string[] };

// One category list, shared by every component on the page. Three components
// each ran their own fetch, so opening the page hit /api/categories three
// times - and a category created in Manage categories never reached the
// dropdowns in the form or the detail modal, because each held its own copy.
let categoryCache: UserCategory[] | null = null;
let categoryInflight: Promise<UserCategory[]> | null = null;
const categorySubscribers = new Set<(c: UserCategory[]) => void>();

function publishCategories(next: UserCategory[]) {
  categoryCache = next;
  for (const notify of categorySubscribers) notify(next);
}

function loadCategories(): Promise<UserCategory[]> {
  if (categoryCache) return Promise.resolve(categoryCache);
  // Show the last known list straight away; the fetch below refreshes it.
  const warm = peek<{ categories?: UserCategory[] }>("/api/categories");
  if (warm?.categories) {
    publishCategories(warm.categories);
    // Loaded moments ago (by the app's opening request, say): no need to ask again.
    if (isFresh("/api/categories")) return Promise.resolve(warm.categories);
  }
  categoryInflight ??= fetchKey<{ categories?: UserCategory[] }>("/api/categories")
    .then((d) => {
      const list: UserCategory[] = d.categories ?? [];
      publishCategories(list);
      return list;
    })
    .catch(() => [])
    .finally(() => {
      categoryInflight = null;
    });
  return categoryInflight;
}

function useCategories() {
  const [categories, setCategories] = useState<UserCategory[]>(() => categoryCache ?? []);

  useEffect(() => {
    categorySubscribers.add(setCategories);
    loadCategories();
    return () => {
      categorySubscribers.delete(setCategories);
    };
  }, []);

  return { categories, setCategories: publishCategories };
}

// Categories are always picked, never typed - that is what stops the list
// sprouting "Furniture", "Grocery" and "Groceries" as separate things. New
// ones are made deliberately in Manage categories.
function CategorySelect({
  value,
  onChange,
  categories,
  disabled,
  ariaLabel,
}: {
  value: string;
  onChange: (v: string) => void;
  categories: UserCategory[];
  disabled?: boolean;
  ariaLabel: string;
}) {
  // An expense may already carry a category that has since been renamed or
  // removed; keep showing it rather than silently switching it to something
  // else the moment this renders.
  const missing = value && !categories.some((c) => c.name === value);

  return (
    <select
      className="field"
      aria-label={ariaLabel}
      value={value}
      disabled={disabled}
      onChange={(e) => onChange(e.target.value)}
    >
      <option value="">Uncategorised</option>
      {missing && <option value={value}>{value}</option>}
      {categories.map((c) => (
        <option key={c.name} value={c.name}>
          {c.name}
        </option>
      ))}
    </select>
  );
}

function ManageCategoriesModal({
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

  const send = async (method: string, body?: unknown, qs = "") => {
    setBusy(true);
    setError("");
    const res = await fetch(`/api/categories${qs}`, {
      method,
      headers: body ? { "Content-Type": "application/json" } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    });
    setBusy(false);
    const d = await res.json().catch(() => ({}));
    if (!res.ok) {
      setError(d.error ?? "Something went wrong");
      return false;
    }
    onChanged(d.categories ?? []);
    return true;
  };

  const add = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newName.trim()) return;
    if (await send("POST", { name: newName.trim(), keywords: newKeywords.trim() })) {
      setNewName("");
      setNewKeywords("");
    }
  };

  const saveEdit = async () => {
    if (!editing) return;
    if (await send("PATCH", { name: editing, newName: editName, keywords: editKeywords })) {
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
                    if (await send("POST", { reset: true })) setConfirmReset(false);
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
                        if (await send("DELETE", undefined, `?name=${encodeURIComponent(c.name)}`)) {
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

/* ---------- expense details ---------- */

function DetailModal({
  expense,
  onClose,
  onSaved,
  onDelete,
}: {
  expense: Expense;
  onClose: () => void;
  onSaved: (updated: Expense) => void;
  onDelete: () => void;
}) {
  const { categories } = useCategories();
  const [mode, setMode] = useState<"view" | "edit">("view");
  const [amount, setAmount] = useState("");
  const [note, setNote] = useState("");
  const [vendor, setVendor] = useState("");
  const [category, setCategory] = useState("");
  const [date, setDate] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [confirmDelete, setConfirmDelete] = useState(false);

  const startEdit = () => {
    setAmount(String(expense.amount));
    setNote(expense.note ?? "");
    setVendor(expense.vendor ?? "");
    setCategory(expense.category ?? "");
    setDate((expense.expense_datetime || expense.expense_date).slice(0, 10));
    setError("");
    setMode("edit");
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError("");
    // Keep the time of day when only the date is unchanged.
    const original = expense.expense_datetime || `${expense.expense_date}T00:00:00Z`;
    const datetime = original.slice(0, 10) === date ? original : `${date}T00:00:00Z`;
    const res = await fetch(`/api/expenses/${expense.id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ amount: Number(amount), note, expense_datetime: datetime, vendor, category }),
    });
    setBusy(false);
    if (!res.ok) {
      const j = await res.json().catch(() => ({}));
      setError(j.error ?? "Something went wrong");
      return;
    }
    onSaved({ ...expense, amount: Number(amount), note, vendor, category, expense_date: date, expense_datetime: datetime });
    setMode("view");
  };

  const handleDelete = async () => {
    setBusy(true);
    const res = await fetch(`/api/expenses/${expense.id}`, { method: "DELETE" });
    setBusy(false);
    if (!res.ok) {
      setError("Couldn't delete that expense. Please try again.");
      setConfirmDelete(false);
      return;
    }
    onDelete();
  };

  const color = categoryVars(expense.category);
  const note_ = (expense.note ?? "").replace(/^(WhatsApp|Assistant):\s*/, "");

  return (
    <Sheet title={mode === "edit" ? "Edit expense" : "Expense"} onClose={onClose}>
      {mode === "view" ? (
        <>
          <div className="card p-5 flex flex-col items-center text-center">
            <span className="icon-tile !w-16 !h-16 !rounded-[22px]" style={{ background: color.bg, color: color.fg }} aria-hidden>
              <CategoryIcon category={expense.category} size={30} />
            </span>
            <p className="text-[16px] font-bold mt-3 max-w-full truncate">{expense.vendor || note_ || "Expense"}</p>
            <p className="text-[36px] font-extrabold tabular leading-tight">{fmtRs(expense.amount)}</p>
            <span className="chip mt-1" style={{ background: color.bg, color: color.fg }}>
              {expense.category || "Uncategorised"}
            </span>
          </div>

          <div className="card px-4 py-1">
            <SheetRow label="Date">{fmtDateLabel(expense.expense_date)}</SheetRow>
            {expense.vendor && <SheetRow label="Paid to">{expense.vendor}</SheetRow>}
            {note_ && (
              <div className="py-3">
                <p className="text-[14px]" style={{ color: "var(--muted)" }}>
                  Note
                </p>
                <p className="text-[15px] mt-1 break-words">{note_}</p>
              </div>
            )}
          </div>

          {error && (
            <p className="text-[13px] text-center" style={{ color: "var(--bad)" }} role="alert">
              {error}
            </p>
          )}

          {confirmDelete ? (
            <div className="card p-4 flex flex-col gap-3">
              <p className="text-[14px] font-semibold text-center" style={{ color: "var(--bad)" }}>
                Delete this expense? This can&apos;t be undone.
              </p>
              <div className="grid grid-cols-2 gap-2">
                <button type="button" className="btn btn-ghost" onClick={() => setConfirmDelete(false)}>
                  Cancel
                </button>
                <button type="button" className="btn btn-danger" disabled={busy} onClick={handleDelete}>
                  {busy ? "Deleting…" : "Delete"}
                </button>
              </div>
            </div>
          ) : (
            <>
              <button type="button" className="btn btn-primary w-full" onClick={startEdit}>
                Edit expense
              </button>
              <button type="button" className="min-h-12 text-[14px] font-bold" style={{ color: "var(--bad)" }} onClick={() => setConfirmDelete(true)}>
                Delete expense
              </button>
            </>
          )}
        </>
      ) : (
        <form onSubmit={handleSave} className="card p-4 flex flex-col gap-4">
          <label className="flex flex-col gap-1.5">
            <span className="text-[13px] font-semibold" style={{ color: "var(--muted)" }}>Amount (Rs)</span>
            <input className="field tabular" type="number" inputMode="decimal" min="0.01" step="any" value={amount} onChange={(e) => setAmount(e.target.value)} required />
          </label>
          <label className="flex flex-col gap-1.5">
            <span className="text-[13px] font-semibold" style={{ color: "var(--muted)" }}>Paid to</span>
            <input className="field" placeholder="Shop or person (optional)" value={vendor} onChange={(e) => setVendor(e.target.value)} />
          </label>
          <div className="flex flex-col gap-1.5">
            <span className="text-[13px] font-semibold" style={{ color: "var(--muted)" }}>Category</span>
            <CategorySelect ariaLabel="Category" value={category} categories={categories} onChange={setCategory} />
          </div>
          <label className="flex flex-col gap-1.5">
            <span className="text-[13px] font-semibold" style={{ color: "var(--muted)" }}>Note</span>
            <input className="field" placeholder="What was it for? (optional)" value={note} onChange={(e) => setNote(e.target.value)} />
          </label>
          <label className="flex flex-col gap-1.5 min-w-0">
            <span className="text-[13px] font-semibold" style={{ color: "var(--muted)" }}>Date</span>
            <input className="field" type="date" value={date} onChange={(e) => setDate(e.target.value)} required />
          </label>
          {error && (
            <p className="text-[13px]" style={{ color: "var(--bad)" }} role="alert">
              {error}
            </p>
          )}
          <div className="form-actions">
            <button type="button" className="btn btn-ghost" onClick={() => setMode("view")}>
              Cancel
            </button>
            <button className="btn btn-primary" disabled={busy}>
              {busy ? "Saving…" : "Save changes"}
            </button>
          </div>
        </form>
      )}
    </Sheet>
  );
}

/* ---------- quick add / edit form ---------- */

function ExpenseForm({
  editing,
  onDone,
  onCancel,
}: {
  editing: Expense | null;
  onDone: () => void;
  onCancel: () => void;
}) {
  const [amount, setAmount] = useState(editing ? String(editing.amount) : "");
  const [note, setNote] = useState(editing?.note ?? "");
  const [datetime, setDateTime] = useState(
    editing ? toLocalDateTime(editing.expense_datetime || editing.expense_date) : pakistanNowLocal()
  );
  const [vendor, setVendor] = useState(editing?.vendor ?? "");
  const [category, setCategory] = useState(editing?.category ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const { categories } = useCategories();
  // Once the user edits the category themselves, stop overwriting it.
  const [categoryTouched, setCategoryTouched] = useState(Boolean(editing?.category));
  const [autoFilled, setAutoFilled] = useState(false);
  const [suggesting, setSuggesting] = useState(false);

  // Ask the server what this payee usually is, and pre-fill it. Debounced so
  // it fires once the user stops typing rather than on every keystroke.
  useEffect(() => {
    if (categoryTouched) return;
    const v = vendor.trim();
    const n = note.trim();
    if (!v && !n) {
      setAutoFilled(false);
      return;
    }

    let cancelled = false;
    const timer = setTimeout(async () => {
      setSuggesting(true);
      try {
        const res = await fetch("/api/expenses/categorize", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ vendor: v, note: n }),
        });
        if (!res.ok || cancelled) return;
        const d = await res.json();
        if (cancelled || !d.category) return;
        setCategory(d.category);
        setAutoFilled(true);
      } catch {
        // Suggestion is a convenience - failing to get one is not an error.
      } finally {
        if (!cancelled) setSuggesting(false);
      }
    }, 450);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [vendor, note, categoryTouched]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError("");
    const url = editing ? `/api/expenses/${editing.id}` : "/api/expenses";
    const method = editing ? "PUT" : "POST";
    const res = await fetch(url, {
      method,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        amount: Number(amount),
        note,
        expense_datetime: fromLocalDateTime(datetime),
        vendor,
        category,
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

  return (
    <form onSubmit={submit} className="card p-4 flex flex-col gap-4">
      <div className="relative">
        <span
          className="absolute left-4 top-1/2 -translate-y-1/2 text-2xl font-bold pointer-events-none"
          style={{ color: "var(--muted)" }}
        >
          Rs
        </span>
        <input
          className="field tabular !text-3xl !font-bold !py-4 !pl-14"
          aria-label="Expense amount"
          placeholder="0"
          type="number"
          inputMode="decimal"
          min="0.01"
          step="any"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          required
        />
      </div>
      <div>
        <label className="block text-[13px] font-medium mb-1.5" style={{ color: "var(--muted)" }}>
          Vendor/Merchant
        </label>
        <input
          className="field"
          aria-label="Vendor or merchant"
          placeholder="Where did you spend? (optional)"
          value={vendor}
          onChange={(e) => setVendor(e.target.value)}
        />
      </div>
      <div>
        <label
          className="flex items-center gap-2 text-[13px] font-medium mb-1.5"
          style={{ color: "var(--muted)" }}
        >
          Category
          {suggesting && <span className="text-[11px]">checking…</span>}
          {!suggesting && autoFilled && (
            <span
              className="text-[10px] font-bold px-1.5 py-0.5 rounded-full"
              style={{ background: "var(--accent-soft)", color: "var(--accent)" }}
            >
              AUTO
            </span>
          )}
        </label>
        <CategorySelect
          ariaLabel="Expense category"
          value={category}
          categories={categories}
          onChange={(v) => {
            setCategory(v);
            setCategoryTouched(true);
            setAutoFilled(false);
          }}
        />
      </div>
      <div>
        <label className="block text-[13px] font-medium mb-1.5" style={{ color: "var(--muted)" }}>
          Note
        </label>
        <input
          className="field"
          aria-label="Expense note"
          placeholder="What was it for? (optional)"
          value={note}
          onChange={(e) => setNote(e.target.value)}
        />
      </div>
      <div>
        <label className="block text-[13px] font-medium mb-1.5" style={{ color: "var(--muted)" }}>
          Date & Time
        </label>
        <input
          className="field"
          aria-label="Expense date and time"
          type="datetime-local"
          value={datetime}
          onChange={(e) => setDateTime(e.target.value)}
          required
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
          {busy ? "Saving…" : editing ? "Save changes" : "Add expense"}
        </button>
      </div>
    </form>
  );
}

/* ---------- re-categorise (backfill) ---------- */

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
function RecategorizeModal({ onClose, onApplied }: { onClose: () => void; onApplied: () => void }) {
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
    const res = await fetch("/api/expenses/recategorize", { method: "POST" });
    setApplying(false);
    if (!res.ok) {
      setError("Couldn't apply the changes");
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

/* ---------- expense row ---------- */

function ExpenseRow({
  expense,
  onView,
  hideDate = false,
}: {
  expense: Expense;
  onView: () => void;
  hideDate?: boolean;
}) {
  const categoryColor = categoryVars(expense.category);

  const note = expense.note.replace(/^(WhatsApp|Assistant):\s*/, "");

  return (
    <li>
      <button
        type="button"
        className="flex w-full items-center gap-3 py-2.5 text-left cursor-pointer rounded-2xl transition hover:bg-[var(--surface-2)]"
        onClick={onView}
        aria-label={`View ${expense.vendor || "expense"}, ${fmtRs(expense.amount)}`}
      >
        <span className="icon-tile" style={{ background: categoryColor.bg, color: categoryColor.fg }} aria-hidden>
          <CategoryIcon category={expense.category} size={22} />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-[15px] truncate font-bold" style={{ color: "var(--ink)" }}>
            {expense.vendor || note || "Expense"}
          </span>
          <span className="block text-[12px] truncate" style={{ color: "var(--muted)" }}>
            {expense.category ? (
              <span className="font-semibold" style={{ color: categoryColor.fg }}>
                {expense.category}
              </span>
            ) : (
              "Uncategorised"
            )}
            {hideDate ? (note && expense.vendor ? ` · ${note}` : "") : ` · ${fmtDateLabel(expense.expense_date)}`}
          </span>
        </span>
        <span className="tabular text-[15px] font-extrabold text-right shrink-0" style={{ color: "var(--ink)" }}>
          {fmtRs(expense.amount)}
        </span>
      </button>
    </li>
  );
}

/* ---------- category report ---------- */

type CategoryPoint = { category: string; total: number; count: number };

// One row of the "needs a category" queue. Assigning here also teaches the
// rule for that payee, so the same transfer never has to be sorted twice.
function ReviewRow({
  expense,
  categories,
  onAssigned,
}: {
  expense: Expense;
  categories: UserCategory[];
  onAssigned: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const assign = async (category: string) => {
    if (!category) return;
    setBusy(true);
    setError("");
    const res = await fetch(`/api/expenses/${expense.id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        amount: expense.amount,
        note: expense.note ?? "",
        expense_datetime: expense.expense_datetime || `${expense.expense_date}T00:00:00Z`,
        vendor: expense.vendor ?? "",
        category,
      }),
    });
    setBusy(false);
    if (!res.ok) {
      setError("Couldn't save");
      return;
    }
    onAssigned();
  };

  return (
    <li className="py-3" style={{ borderBottom: "1px solid var(--hairline)" }}>
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[14px] font-semibold truncate">
            {expense.vendor || expense.note || "Expense"}
          </p>
          <p className="text-[12px]" style={{ color: "var(--muted)" }}>
            {fmtDateLabel(expense.expense_date)}
            {expense.note && expense.vendor ? ` · ${expense.note}` : ""}
          </p>
        </div>
        <p className="text-[14px] font-semibold tabular shrink-0">{fmtRs(expense.amount)}</p>
      </div>
      <div className="flex items-center gap-2 mt-2">
        <select
          className="field !py-2 text-[13px]"
          aria-label={`Category for ${expense.vendor || "expense"}`}
          defaultValue=""
          disabled={busy}
          onChange={(e) => assign(e.target.value)}
        >
          <option value="" disabled>
            {busy ? "Saving…" : "Pick a category…"}
          </option>
          {categories.map((c) => (
            <option key={c.name} value={c.name}>
              {c.name}
            </option>
          ))}
        </select>
        {error && (
          <span className="text-[12px]" style={{ color: "var(--bad)" }} role="alert">
            {error}
          </span>
        )}
      </div>
    </li>
  );
}

function dayHeading(ymd: string): string {
  const d = new Date();
  const local = (x: Date) =>
    `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, "0")}-${String(x.getDate()).padStart(2, "0")}`;
  if (ymd === local(d)) return "Today";
  d.setDate(d.getDate() - 1);
  if (ymd === local(d)) return "Yesterday";
  const [y, m, day] = ymd.split("-").map(Number);
  return new Date(y, m - 1, day).toLocaleDateString("en-PK", {
    weekday: "short",
    day: "numeric",
    month: "short",
    year: y === new Date().getFullYear() ? undefined : "numeric",
  });
}

// The single expenses view. A compact summary, a row of category chips that
// filter the list, a short breakdown, and the expenses grouped by day.
function ExpensesView({
  onViewDetail,
  onRecategorize,
  onAdd,
}: {
  onViewDetail: (e: Expense) => void;
  onRecategorize: () => void;
  onAdd: () => void;
}) {
  const now = new Date();
  const [scope, setScope] = useState<"month" | "year">("month");
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth() + 1);
  const [selected, setSelected] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [searching, setSearching] = useState(false);
  const { categories, setCategories } = useCategories();
  const [managing, setManaging] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);

  const monthParam = scope === "month" ? `&month=${month}` : "";
  const periodLabel = scope === "month" ? `${MONTH_NAMES[month - 1]} ${year}` : String(year);
  const isCurrent = scope === "month" ? year === now.getFullYear() && month === now.getMonth() + 1 : year === now.getFullYear();

  // Totals for this period and the one before (for "vs last month"), from the
  // shared cache. Moving to a period not seen yet keeps the previous figures
  // on screen, dimmed, until the new ones arrive - the page never blanks.
  const prevParams =
    scope === "year" ? `year=${year - 1}` : month === 1 ? `year=${year - 1}&month=12` : `year=${year}&month=${month - 1}`;
  const totals = useCached<{ total: number; categories: CategoryPoint[] }>(`/api/expenses/categories?year=${year}${monthParam}`);
  const previous = useCached<{ total: number }>(`/api/expenses/categories?${prevParams}`);
  const shownTotals = useRef(totals.data);
  if (totals.data) shownTotals.current = totals.data;
  const data = totals.data ?? shownTotals.current ?? null;
  const refreshing = !totals.data;
  const loadError =
    totals.failedStatus !== undefined && !totals.data ? "Could not load this period. Check your connection and try again." : "";
  const previousTotal = previous.data ? Number(previous.data.total) || 0 : null;

  // A different period starts unfiltered.
  useEffect(() => {
    setSelected(null);
  }, [year, month, scope]);

  // A whole year of expenses is a wall of rows nobody reads, so over a year
  // the list only appears once a category has been picked - and until then it
  // isn't even fetched.
  const showHistory = scope === "month" || Boolean(selected);
  const historyRef = useRef<HTMLElement>(null);

  // Picking a category is a request to see those expenses, so bring them to
  // the reader rather than making them scroll past the breakdown.
  useEffect(() => {
    if (!selected) return;
    const el = historyRef.current;
    if (!el) return;
    const reduceMotion =
      typeof window !== "undefined" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    el.scrollIntoView({ behavior: reduceMotion ? "auto" : "smooth", block: "start" });
  }, [selected]);

  const list = useCached<Expense[]>(
    showHistory
      ? `/api/expenses?year=${year}${monthParam}${selected ? `&category=${encodeURIComponent(selected)}` : ""}`
      : null
  );
  const expenses = list.data ?? (list.failedStatus !== undefined ? [] : null);

  const nav = (dir: -1 | 1) => {
    if (scope === "year") {
      setYear((y) => y + dir);
      return;
    }
    let m = month + dir;
    let y = year;
    if (m < 1) {
      m = 12;
      y -= 1;
    } else if (m > 12) {
      m = 1;
      y += 1;
    }
    setMonth(m);
    setYear(y);
  };

  const filtered = expenses
    ?.filter((e) => {
      if (!search.trim()) return true;
      const q = search.toLowerCase();
      return (
        String(e.amount).includes(q) ||
        (e.note?.toLowerCase().includes(q) ?? false) ||
        (e.vendor?.toLowerCase().includes(q) ?? false) ||
        (e.category?.toLowerCase().includes(q) ?? false)
      );
    })
    // Two different questions, two orderings. The plain list is a ledger -
    // what happened, most recent first. Drilling into a category asks where
    // the money went, so the biggest amounts lead.
    .sort((a, b) => {
      const byDate =
        new Date(b.expense_datetime || b.expense_date).getTime() -
        new Date(a.expense_datetime || a.expense_date).getTime();
      return selected ? b.amount - a.amount || byDate : byDate;
    });

  const shownTotal = filtered?.reduce((sum, e) => sum + e.amount, 0) ?? 0;

  // Grouped by day for the ledger view; a category drill-down stays one list
  // ordered by amount.
  const groups: { day: string; items: Expense[]; total: number }[] = [];
  if (filtered && !selected) {
    for (const e of filtered) {
      const last = groups[groups.length - 1];
      if (last && last.day === e.expense_date) {
        last.items.push(e);
        last.total += e.amount;
      } else {
        groups.push({ day: e.expense_date, items: [e], total: e.amount });
      }
    }
  }

  const exportHref = `/api/expenses/export?year=${year}${monthParam}${
    selected ? `&category=${encodeURIComponent(selected)}` : ""
  }`;

  const points = data?.categories ?? [];
  const needsReview = points.find((c) => c.category === "Uncategorised");
  const change =
    data && previousTotal !== null && previousTotal > 0
      ? Math.round(((data.total - previousTotal) / previousTotal) * 100)
      : null;
  const count = points.reduce((s, p) => s + p.count, 0);
  const pick = (c: string | null) => setSelected((cur) => (c === null || cur === c ? null : c));

  return (
    <>
      <div className="flex items-center gap-2">
        <div className="segmented flex-1" role="group" aria-label="Period type">
          {(["month", "year"] as const).map((s) => (
            <button key={s} type="button" aria-pressed={scope === s} onClick={() => setScope(s)}>
              {s === "month" ? "Month" : "Year"}
            </button>
          ))}
        </div>
        <div className="relative shrink-0">
          <button
            type="button"
            className="chat-round !w-[56px] !h-[56px]"
            aria-label="More actions"
            aria-haspopup="menu"
            aria-expanded={menuOpen}
            onClick={() => setMenuOpen((v) => !v)}
          >
            <svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
              <circle cx="5" cy="12" r="2" />
              <circle cx="12" cy="12" r="2" />
              <circle cx="19" cy="12" r="2" />
            </svg>
          </button>
          {menuOpen && (
            <>
              <div className="fixed inset-0 z-10" onClick={() => setMenuOpen(false)} aria-hidden />
              <div className="chat-menu rise !left-auto right-0 !bottom-auto top-[64px] !w-[250px]" role="menu">
                <button type="button" role="menuitem" className="chat-menu-item" onClick={() => { setMenuOpen(false); setManaging(true); }}>
                  <span className="chat-menu-icon" aria-hidden><FolderIcon size={20} /></span>
                  Manage categories
                </button>
                <button type="button" role="menuitem" className="chat-menu-item" onClick={() => { setMenuOpen(false); onRecategorize(); }}>
                  <span className="chat-menu-icon" aria-hidden><SparkleIcon size={20} /></span>
                  Re-categorise
                </button>
                <a role="menuitem" className="chat-menu-item" href={exportHref} download onClick={() => setMenuOpen(false)}>
                  <span className="chat-menu-icon" aria-hidden><DownloadIcon size={20} /></span>
                  Download Excel
                </a>
              </div>
            </>
          )}
        </div>
      </div>

      <section className="hero-panel p-6 rise" aria-live="polite">
        <div className="flex items-center justify-between gap-2 -mx-2 -mt-2">
          <button
            type="button"
            onClick={() => nav(-1)}
            aria-label={scope === "year" ? "Previous year" : "Previous month"}
            className="h-11 w-11 rounded-full flex items-center justify-center"
            style={{ background: "rgba(255,255,255,0.1)" }}
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
              <path d="M15 5l-7 7 7 7" />
            </svg>
          </button>
          <p className="text-[15px] font-bold">{periodLabel}</p>
          <button
            type="button"
            onClick={() => nav(1)}
            disabled={isCurrent}
            aria-label={scope === "year" ? "Next year" : "Next month"}
            className="h-11 w-11 rounded-full flex items-center justify-center disabled:opacity-30"
            style={{ background: "rgba(255,255,255,0.1)" }}
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
              <path d="M9 5l7 7-7 7" />
            </svg>
          </button>
        </div>

        <p className="hero-muted text-[14px] font-semibold mt-4">Total spent</p>
        <p
          className="mt-1 flex items-baseline gap-2 tabular"
          style={{ opacity: refreshing && data ? 0.5 : 1, transition: "opacity .18s ease" }}
        >
          <span className="hero-muted text-[20px] font-bold">Rs</span>
          <span className="text-[42px] font-extrabold leading-none tracking-tight">
            {data ? fmtRs(data.total).replace(/^−?Rs\s/, "") : <span className="skeleton align-middle" style={{ width: 140, height: 36, opacity: 0.3 }} />}
          </span>
        </p>
        <div className="mt-3 flex flex-wrap items-center gap-x-5 gap-y-1 text-[14px]">
          {change !== null && (
            <span>
              <span className="font-extrabold" style={{ color: change > 0 ? "#ffb4a8" : "#7ee2a8" }}>
                {change > 0 ? "↑" : "↓"} {Math.abs(change)}%
              </span>{" "}
              <span className="hero-muted">vs last {scope}</span>
            </span>
          )}
          {data && (
            <span className="hero-muted">
              {count} {count === 1 ? "expense" : "expenses"}
            </span>
          )}
        </div>
      </section>

      {needsReview && selected !== "Uncategorised" && (
        <button
          type="button"
          onClick={() => pick("Uncategorised")}
          className="card p-4 w-full text-left flex items-center gap-3 rise"
        >
          <span
            className="icon-tile !w-11 !h-11"
            style={{ background: "var(--cat-uncategorised-bg)", color: "var(--cat-uncategorised-fg)" }}
            aria-hidden
          >
            <QuestionIcon size={20} />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block text-[15px] font-bold">
              {needsReview.count} {needsReview.count === 1 ? "expense needs" : "expenses need"} a category
            </span>
            <span className="block text-[13px]" style={{ color: "var(--muted)" }}>
              {fmtRs(needsReview.total)} · tap to sort them out
            </span>
          </span>
          <span style={{ color: "var(--muted)" }} aria-hidden>›</span>
        </button>
      )}

      {points.length > 0 && (
        <section ref={historyRef} className="flex flex-col gap-3 scroll-mt-4" aria-labelledby="history-title">
          <div className="section-head">
            <h2 id="history-title" className="section-title truncate">
              {selected ?? "Expenses"}
            </h2>
            <div className="flex items-center gap-2 shrink-0">
              <button
                type="button"
                className="chat-round !w-12 !h-12"
                aria-label="Search expenses"
                aria-pressed={searching}
                onClick={() => {
                  setSearching((v) => !v);
                  if (searching) setSearch("");
                }}
              >
                <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden>
                  <circle cx="11" cy="11" r="6.5" />
                  <path d="M20 20l-4-4" />
                </svg>
              </button>
              <button type="button" className="tab-fab !w-12 !h-12 !m-0 !shadow-none" aria-label="Log expense" onClick={onAdd}>
                <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" aria-hidden>
                  <path d="M12 5v14M5 12h14" />
                </svg>
              </button>
            </div>
          </div>

          {/* "All" stays put; the categories scroll sideways beside it, so a
              long list neither wraps into a wall of pills nor hides anything -
              it just keeps going past the edge. */}
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => pick(null)}
              aria-pressed={!selected}
              className="cat-pill shrink-0"
              data-on={!selected ? "" : undefined}
            >
              All
            </button>
            <div className="nav-scroll flex gap-2 overflow-x-auto flex-1 -mr-4 pr-4 py-0.5" role="group" aria-label="Filter by category">
              {points.map((p) => (
                <button
                  key={p.category}
                  type="button"
                  onClick={() => pick(p.category)}
                  aria-pressed={selected === p.category}
                  className="cat-pill shrink-0"
                  data-on={selected === p.category ? "" : undefined}
                >
                  <CategoryIcon category={p.category} size={16} />
                  {p.category}
                </button>
              ))}
            </div>
          </div>

          {searching && (
            <input
              className="field !rounded-full"
              aria-label="Search expenses"
              placeholder="Search amount, note, vendor…"
              value={search}
              autoFocus
              onChange={(e) => setSearch(e.target.value)}
            />
          )}

          {(selected || search.trim()) && filtered && (
            <p className="text-[13px] px-1" style={{ color: "var(--muted)" }}>
              {filtered.length} {filtered.length === 1 ? "expense" : "expenses"} · {fmtRs(shownTotal)}
              {selected ? " · biggest first" : ""}
            </p>
          )}

          {!showHistory ? (
            <div className="card p-6 text-center text-[14px]" style={{ color: "var(--muted)" }}>
              Pick a category above to see its expenses for {periodLabel}.
            </div>
          ) : expenses === null ? (
            <div className="card p-4 flex flex-col gap-3" role="status" aria-label="Loading expenses">
              {[0, 1, 2].map((i) => (
                <div key={i} className="flex items-center gap-3">
                  <span className="icon-tile skeleton !rounded-2xl" />
                  <span className="flex-1 flex flex-col gap-2">
                    <span className="skeleton" style={{ width: "55%", height: 14 }} />
                    <span className="skeleton" style={{ width: "30%", height: 12 }} />
                  </span>
                </div>
              ))}
            </div>
          ) : filtered?.length === 0 ? (
            <div className="card p-6 text-center text-[14px]" style={{ color: "var(--muted)" }}>
              {search ? "No matching expenses" : `No expenses in ${periodLabel}.`}
            </div>
          ) : selected ? (
            <div className="card px-3 py-1 rise">
              <ul>
                {filtered?.map((e) =>
                  selected === "Uncategorised" ? (
                    <ReviewRow
                      key={e.id}
                      expense={e}
                      categories={categories}
                      onAssigned={() => invalidate("/api/expenses")}
                    />
                  ) : (
                    <ExpenseRow key={e.id} expense={e} onView={() => onViewDetail(e)} />
                  )
                )}
              </ul>
            </div>
          ) : (
            groups.map((g) => (
              <div key={g.day} className="flex flex-col gap-1.5">
                <div className="flex items-baseline justify-between px-1 pt-1">
                  <h3 className="text-[13px] font-bold uppercase tracking-wide" style={{ color: "var(--muted)" }}>
                    {dayHeading(g.day)}
                  </h3>
                  <span className="text-[13px] font-bold tabular" style={{ color: "var(--muted)" }}>
                    {fmtRs(g.total)}
                  </span>
                </div>
                <div className="card px-3 py-1">
                  <ul>
                    {g.items.map((e) => (
                      <ExpenseRow key={e.id} expense={e} onView={() => onViewDetail(e)} hideDate />
                    ))}
                  </ul>
                </div>
              </div>
            ))
          )}
        </section>
      )}

      {loadError ? (
        <div className="card p-5 text-[14px]" style={{ color: "var(--bad)" }} role="alert">
          {loadError}
        </div>
      ) : data && points.length === 0 ? (
        <div className="card p-8 text-center rise">
          <p className="flex justify-center" style={{ color: "var(--muted)" }} aria-hidden>
            <LeafIcon size={32} />
          </p>
          <p className="font-bold mt-1">No expenses in {periodLabel}</p>
          <p className="text-[13px] mt-1" style={{ color: "var(--muted)" }}>
            Log one, or tell the assistant what you spent.
          </p>
          <button type="button" className="btn btn-expense mt-4" onClick={onAdd}>
            Log expense
          </button>
        </div>
      ) : null}

      {managing && (
        <ManageCategoriesModal
          categories={categories}
          onClose={() => setManaging(false)}
          onChanged={(next) => {
            setCategories(next);
            invalidate("/api/expenses");
          }}
        />
      )}

    </>
  );
}

/* ---------- page ---------- */

export default function ExpensesPage() {
  const [adding, setAdding] = useState(false);
  const [viewingDetail, setViewingDetail] = useState<Expense | null>(null);
  const [recategorizing, setRecategorizing] = useState(false);

  // Any change refreshes every cached expense figure - this page and Home.
  const refresh = () => invalidate("/api/expenses");
  const closeAdd = useCallback(() => setAdding(false), []);
  const closeDetail = useCallback(() => setViewingDetail(null), []);
  const closeRecat = useCallback(() => setRecategorizing(false), []);

  // The daily recap notification links to /expenses?add=1 to add a missed expense.
  useEffect(() => {
    if (new URLSearchParams(window.location.search).get("add") !== "1") return;
    setAdding(true);
    window.history.replaceState(null, "", "/expenses");
  }, []);

  return (
    <>
      {adding && (
        <Sheet title="New expense" onClose={closeAdd}>
          <ExpenseForm
            editing={null}
            onCancel={closeAdd}
            onDone={() => {
              setAdding(false);
              refresh();
            }}
          />
        </Sheet>
      )}

      {recategorizing && (
        <RecategorizeModal
          onClose={closeRecat}
          onApplied={() => {
            setRecategorizing(false);
            refresh();
          }}
        />
      )}

      {viewingDetail && (
        <DetailModal
          expense={viewingDetail}
          onClose={closeDetail}
          onSaved={(updated) => {
            setViewingDetail(updated);
            refresh();
          }}
          onDelete={() => {
            setViewingDetail(null);
            refresh();
          }}
        />
      )}

      <ExpensesView
        onViewDetail={setViewingDetail}
        onRecategorize={() => setRecategorizing(true)}
        onAdd={() => setAdding(true)}
      />
    </>
  );
}
