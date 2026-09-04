"use client";

import { useEffect, useRef, useState } from "react";
import type { Expense } from "@/lib/db";
import { fmtRs, fmtDateLabel, MONTH_NAMES } from "@/lib/format";

// Category colours live in globals.css as --cat-<slug>-bg/fg, defined once per
// theme. Reading them as CSS variables means the badge is correct on the very
// first paint: nothing here has to know whether the app is in dark mode, which
// is what used to make these colours disagree with the server-rendered HTML.
// The var() fallback covers categories with no palette entry of their own.
function categoryVars(category?: string | null): { bg: string; fg: string } {
  const slug = (category ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  if (!slug) return { bg: "var(--cat-default-bg)", fg: "var(--cat-default-fg)" };
  return {
    bg: `var(--cat-${slug}-bg, var(--cat-default-bg))`,
    fg: `var(--cat-${slug}-fg, var(--cat-default-fg))`,
  };
}

function toLocalDateTime(iso: string): string {
  if (!iso) return "";
  const date = new Date(iso);
  return date.toISOString().slice(0, 16);
}

function fromLocalDateTime(local: string): string {
  if (!local) return "";
  return new Date(local + ":00Z").toISOString();
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
  categoryInflight ??= fetch("/api/categories")
    .then((r) => (r.ok ? r.json() : { categories: [] }))
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
    <div
      className="modal-backdrop fixed inset-0 z-50 flex items-center justify-center overflow-hidden backdrop-blur-sm"
      style={{ background: "rgba(0,0,0,0.75)", overscrollBehavior: "none" }}
      onClick={onClose}
    >
      <div
        className="modal-panel card rise w-full max-w-lg overflow-y-auto"
        style={{ color: "var(--ink)", overscrollBehavior: "contain" }}
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="cats-title"
      >
        <div
          className="flex items-center justify-between p-5 border-b sticky top-0 z-10"
          style={{ borderColor: "var(--hairline)", background: "var(--surface)" }}
        >
          <h2 id="cats-title" className="text-[16px] font-semibold">
            Manage categories
          </h2>
          <button
            onClick={onClose}
            type="button"
            aria-label="Close"
            className="inline-flex h-10 w-10 items-center justify-center text-[20px] opacity-50 hover:opacity-100 transition"
          >
            ✕
          </button>
        </div>

        <form onSubmit={add} className="p-5 flex flex-col gap-2 border-b" style={{ borderColor: "var(--hairline)" }}>
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
          <p className="text-[13px] px-5 pt-3" style={{ color: "var(--bad)" }} role="alert">
            {error}
          </p>
        )}

        <div className="px-5 pt-4">
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

        <ul className="p-5 flex flex-col gap-2">
          {categories.map((c) => (
            <li key={c.name} className="rounded-xl px-3 py-2.5" style={{ background: "var(--surface-2)" }}>
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
      </div>
    </div>
  );
}

/* ---------- detail modal ---------- */

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
  const dialogRef = useRef<HTMLDivElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);

  // Lock background scroll while the modal is open
  useEffect(() => {
    const body = document.body;
    const scrollY = window.scrollY;
    const previous = {
      overflow: body.style.overflow,
      position: body.style.position,
      top: body.style.top,
      width: body.style.width,
    };

    body.style.overflow = "hidden";
    body.style.position = "fixed";
    body.style.top = `-${scrollY}px`;
    body.style.width = "100%";

    return () => {
      body.style.overflow = previous.overflow;
      body.style.position = previous.position;
      body.style.top = previous.top;
      body.style.width = previous.width;
      window.scrollTo(0, scrollY);
    };
  }, []);

  useEffect(() => {
    closeButtonRef.current?.focus({ preventScroll: true });
  }, []);

  const handleDialogKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "Escape") {
      event.preventDefault();
      onClose();
      return;
    }
    if (event.key !== "Tab") return;

    const focusable = dialogRef.current?.querySelectorAll<HTMLElement>(
      'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])'
    );
    if (!focusable?.length) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  };

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
    const res = await fetch(`/api/expenses/${expense.id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        amount: Number(amount),
        note,
        expense_datetime: `${date}T00:00:00Z`,
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
    onSaved({
      ...expense,
      amount: Number(amount),
      note,
      vendor,
      category,
      expense_date: date,
      expense_datetime: `${date}T00:00:00Z`,
    });
    setMode("view");
  };

  const handleDelete = async () => {
    if (!confirm("Delete this expense? This can't be undone.")) return;
    await fetch(`/api/expenses/${expense.id}`, { method: "DELETE" });
    onDelete();
  };

  const dt = expense.expense_datetime ? new Date(expense.expense_datetime) : new Date(expense.expense_date);
  const categoryColor = categoryVars(expense.category);

  return (
    <div
      className="modal-backdrop fixed inset-0 z-50 flex items-center justify-center overflow-hidden backdrop-blur-sm"
      style={{ background: "rgba(0,0,0,0.75)", overscrollBehavior: "none" }}
      onClick={onClose}
    >
      <div
        ref={dialogRef}
        className="modal-panel card rise w-full max-w-xl overflow-y-auto"
        style={{ color: "var(--ink)", overscrollBehavior: "contain" }}
        onClick={(e) => e.stopPropagation()}
        onKeyDown={handleDialogKeyDown}
        role="dialog"
        aria-modal="true"
        aria-labelledby="expense-dialog-title"
      >
        {/* Header */}
        <div
          className="flex items-center justify-between p-5 border-b sticky top-0 z-10"
          style={{ borderColor: "var(--hairline)", background: "var(--surface)" }}
        >
          <h2 id="expense-dialog-title" className="text-[16px] font-semibold" style={{ color: "var(--ink)" }}>
            {mode === "edit" ? "Edit Expense" : "Expense Details"}
          </h2>
          <button
            ref={closeButtonRef}
            onClick={onClose}
            type="button"
            aria-label="Close expense dialog"
            className="inline-flex h-12 w-12 items-center justify-center text-[20px] opacity-50 hover:opacity-100 transition"
            style={{ color: "var(--ink-2)" }}
          >
            ✕
          </button>
        </div>

        {mode === "view" ? (
          <>
            {/* Content */}
            <div className="p-5 space-y-3">
              {/* Title and Amount row */}
              <div className="flex items-center justify-between gap-3">
                <p className="text-[14px] font-semibold flex-1 min-w-0 truncate" style={{ color: "var(--ink)" }}>{expense.vendor || "Expense"}</p>
                <p className="text-[18px] font-bold tabular shrink-0" style={{ color: "var(--ink)" }}>{fmtRs(expense.amount)}</p>
              </div>

              {/* Category Badge */}
              {expense.category && (
                <div>
                  <div
                    className="inline-block px-2.5 py-1 rounded-full text-[11px] font-semibold"
                    style={{
                      background: categoryColor.bg,
                      color: categoryColor.fg,
                    }}
                  >
                    {expense.category}
                  </div>
                </div>
              )}

              {/* Divider */}
              <div style={{ background: "var(--hairline)", height: "1px" }} />

              {/* Details section */}
              {(expense.note) && (
                <div>
                  <p className="text-[12px] font-medium mb-1.5" style={{ color: "var(--muted)" }}>
                    Note
                  </p>
                  <p className="text-[13px] leading-relaxed" style={{ color: "var(--ink-2)" }}>{expense.note}</p>
                </div>
              )}

              <div>
                <p className="text-[12px] font-medium mb-1" style={{ color: "var(--muted)" }}>
                  Date
                </p>
                <p className="text-[13px]" style={{ color: "var(--ink-2)" }}>
                  {dt.toLocaleDateString("en-US", {
                    year: "numeric",
                    month: "short",
                    day: "numeric",
                  })}
                </p>
              </div>
            </div>

            {/* Footer */}
            <div className="form-actions p-5 border-t" style={{ borderColor: "var(--hairline)" }}>
              <button className="btn btn-ghost !text-[13px]" onClick={onClose}>
                Close
              </button>
              <button className="btn btn-ghost !text-[13px]" onClick={startEdit}>
                Edit
              </button>
              <button className="btn btn-danger !text-[13px]" onClick={handleDelete}>
                Delete
              </button>
            </div>
          </>
        ) : (
          <form onSubmit={handleSave}>
            <div className="p-5 space-y-4">
              <div>
                <label className="block text-[12px] font-medium mb-1.5" style={{ color: "var(--muted)" }}>
                  Amount
                </label>
                <input
                  className="field"
                  aria-label="Amount"
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
                <label className="block text-[12px] font-medium mb-1.5" style={{ color: "var(--muted)" }}>
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
                <label className="block text-[12px] font-medium mb-1.5" style={{ color: "var(--muted)" }}>
                  Category
                </label>
                <CategorySelect
                  ariaLabel="Category"
                  value={category}
                  categories={categories}
                  onChange={setCategory}
                />
              </div>
              <div>
                <label className="block text-[12px] font-medium mb-1.5" style={{ color: "var(--muted)" }}>
                  Note
                </label>
                <input
                  className="field"
                  aria-label="Note"
                  placeholder="What was it for? (optional)"
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                />
              </div>
              <div className="min-w-0">
                <label className="block text-[12px] font-medium mb-1.5" style={{ color: "var(--muted)" }}>
                  Date
                </label>
                <input
                  className="field block min-w-0 max-w-full"
                  aria-label="Date"
                  style={{ inlineSize: "100%", minInlineSize: 0, maxInlineSize: "100%" }}
                  type="date"
                  value={date}
                  onChange={(e) => setDate(e.target.value)}
                  required
                />
              </div>
              {error && (
                <p className="text-[13px]" style={{ color: "var(--bad)" }} role="alert">
                  {error}
                </p>
              )}
            </div>

            {/* Footer */}
            <div className="form-actions p-5 border-t" style={{ borderColor: "var(--hairline)" }}>
              <button type="button" className="btn btn-ghost !text-[13px]" onClick={() => setMode("view")}>
                Cancel
              </button>
              <button className="btn btn-primary !text-[13px]" disabled={busy}>
                {busy ? "Saving…" : "Save changes"}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
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
    editing ? toLocalDateTime(editing.expense_datetime || editing.expense_date) : toLocalDateTime(new Date().toISOString())
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
    <form onSubmit={submit} className="card p-5 sm:p-6 rise flex flex-col gap-4">
      <p className="font-semibold">{editing ? "Edit expense" : "New expense"}</p>
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
    <div
      className="modal-backdrop fixed inset-0 z-50 flex items-center justify-center overflow-hidden backdrop-blur-sm"
      style={{ background: "rgba(0,0,0,0.75)", overscrollBehavior: "none" }}
      onClick={onClose}
    >
      <div
        className="modal-panel card rise w-full max-w-xl overflow-y-auto"
        style={{ color: "var(--ink)", overscrollBehavior: "contain" }}
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="recat-title"
      >
        <div
          className="flex items-center justify-between p-5 border-b sticky top-0 z-10"
          style={{ borderColor: "var(--hairline)", background: "var(--surface)" }}
        >
          <h2 id="recat-title" className="text-[16px] font-semibold">
            Re-categorise expenses
          </h2>
          <button
            onClick={onClose}
            type="button"
            aria-label="Close"
            className="inline-flex h-10 w-10 items-center justify-center text-[20px] opacity-50 hover:opacity-100 transition"
          >
            ✕
          </button>
        </div>

        <div className="p-5 flex flex-col gap-3">
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

        <div
          className="form-actions p-5 border-t"
          style={{ borderColor: "var(--hairline)" }}
        >
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
      </div>
    </div>
  );
}

/* ---------- expense row ---------- */

function ExpenseRow({
  expense,
  onView,
}: {
  expense: Expense;
  onView: () => void;
}) {
  const categoryColor = categoryVars(expense.category);

  return (
    <li className="border-b last:border-b-0" style={{ borderColor: "var(--hairline)" }}>
      <button
        type="button"
        className="grid w-full items-center gap-3 py-3 px-1 text-left cursor-pointer hover:opacity-75 transition"
        style={{ gridTemplateColumns: "32% minmax(0, 1fr) 24%" }}
        onClick={onView}
        aria-label={`View ${expense.vendor || "expense"}, ${fmtRs(expense.amount)}`}
      >
      {/* Category Badge - Fixed Width */}
      <div className="min-w-0">
        {expense.category && (
          <span
            className="max-w-full overflow-hidden text-ellipsis text-[11px] font-medium px-2.5 py-1 rounded-full whitespace-nowrap inline-block align-middle"
            style={{
              background: categoryColor.bg,
              color: categoryColor.fg,
            }}
          >
            {expense.category}
          </span>
        )}
      </div>

      {/* Title and Date */}
      <div className="min-w-0">
        <p className="text-[14px] truncate font-medium" style={{ color: "var(--ink)" }}>{expense.vendor || "Expense"}</p>
        <p className="text-[12px] truncate" style={{ color: "var(--muted)" }}>
          {fmtDateLabel(expense.expense_date)}
        </p>
      </div>

      {/* Amount - Right Aligned */}
      <span className="tabular text-[14px] font-semibold text-right" style={{ color: "var(--ink)" }}>
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

// Horizontal bars: category names are long ("Bills & Utilities") and this is
// read on a phone, so vertical columns would clip the labels. Each bar is a
// button that drills into the expenses behind it.
function CategoryChart({
  points,
  selected,
  onSelect,
}: {
  points: CategoryPoint[];
  selected: string | null;
  onSelect: (category: string) => void;
}) {
  const max = Math.max(...points.map((p) => p.total), 1);
  const grand = points.reduce((s, p) => s + p.total, 0);

  return (
    <div className="flex flex-col gap-2.5 mt-4">
      {points.map((p) => {
        const color = categoryVars(p.category);
        const isSelected = selected === p.category;
        const share = grand > 0 ? (p.total / grand) * 100 : 0;
        return (
          <button
            key={p.category}
            type="button"
            onClick={() => onSelect(p.category)}
            aria-pressed={isSelected}
            className="w-full text-left rounded-xl px-3 py-2.5 transition"
            style={{
              background: isSelected ? "var(--surface-2)" : "transparent",
              outline: isSelected ? "1px solid var(--ring)" : "none",
            }}
          >
            <div className="flex items-center justify-between gap-3">
              <span className="text-[13px] font-semibold truncate">{p.category}</span>
              <span className="text-[13px] font-semibold tabular shrink-0">{fmtRs(p.total)}</span>
            </div>
            <div
              className="mt-1.5 h-2.5 w-full rounded-full overflow-hidden"
              style={{ background: "var(--hairline)" }}
            >
              <div
                className="h-full rounded-full transition-[width] duration-500"
                style={{
                  width: `${Math.max((p.total / max) * 100, 2)}%`,
                  background: color.fg,
                }}
              />
            </div>
            <p className="text-[11px] mt-1" style={{ color: "var(--muted)" }}>
              {p.count} expense{p.count === 1 ? "" : "s"} · {share.toFixed(share < 10 ? 1 : 0)}%
            </p>
          </button>
        );
      })}
    </div>
  );
}

// The single expenses view. The breakdown and the history were two pages
// showing the same period over the same data, so the chart is now the filter
// for the list beneath it: picking a category narrows the history in place
// rather than navigating somewhere else.
function ExpensesView({
  refreshKey,
  onViewDetail,
  onRecategorize,
}: {
  refreshKey: number;
  onViewDetail: (e: Expense) => void;
  onRecategorize: () => void;
}) {
  const now = new Date();
  const [scope, setScope] = useState<"month" | "year">("month");
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth() + 1);
  const [data, setData] = useState<{ total: number; categories: CategoryPoint[] } | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [expenses, setExpenses] = useState<Expense[] | null>(null);
  const [search, setSearch] = useState("");
  const [loadError, setLoadError] = useState("");
  const [refreshing, setRefreshing] = useState(true);
  const { categories, setCategories } = useCategories();
  const [managing, setManaging] = useState(false);

  const monthParam = scope === "month" ? `&month=${month}` : "";
  const periodLabel = scope === "month" ? `${MONTH_NAMES[month - 1]} ${year}` : String(year);

  // Stepping quickly through months used to let an older reply overwrite a
  // newer one, and a failed request left "Loading…" on screen for good. The
  // previous period stays visible while the next one loads, so moving between
  // months no longer blanks the page.
  useEffect(() => {
    const ac = new AbortController();
    setSelected(null);
    setRefreshing(true);
    setLoadError("");
    fetch(`/api/expenses/categories?year=${year}${monthParam}`, { signal: ac.signal })
      .then((r) => {
        if (!r.ok) throw new Error("load failed");
        return r.json();
      })
      .then((d) => {
        setData(d);
        setRefreshing(false);
      })
      .catch(() => {
        if (ac.signal.aborted) return;
        setLoadError("Could not load this period. Check your connection and try again.");
        setRefreshing(false);
      });
    return () => ac.abort();
  }, [year, month, scope, monthParam, refreshKey]);

  // A whole year of expenses is a wall of rows nobody reads, so over a year
  // the list only appears once a category has been picked - and until then it
  // isn't even fetched.
  const showHistory = scope === "month" || Boolean(selected);
  const historyRef = useRef<HTMLElement>(null);

  // Picking a bar is a request to see those expenses, and they sit below a
  // full-height chart - so bring them to the reader rather than making them
  // scroll past everything they just filtered out.
  useEffect(() => {
    if (!selected) return;
    const el = historyRef.current;
    if (!el) return;
    const reduceMotion =
      typeof window !== "undefined" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    el.scrollIntoView({ behavior: reduceMotion ? "auto" : "smooth", block: "start" });
  }, [selected]);

  useEffect(() => {
    if (!showHistory) {
      setExpenses(null);
      return;
    }
    const ac = new AbortController();
    const categoryParam = selected ? `&category=${encodeURIComponent(selected)}` : "";
    fetch(`/api/expenses?year=${year}${monthParam}${categoryParam}`, { signal: ac.signal })
      .then((r) => {
        if (!r.ok) throw new Error("load failed");
        return r.json();
      })
      .then((rows) => setExpenses(Array.isArray(rows) ? rows : []))
      .catch(() => {
        if (ac.signal.aborted) return;
        setExpenses([]);
      });
    return () => ac.abort();
  }, [showHistory, selected, year, month, scope, monthParam, refreshKey]);

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
    // Two different questions, two orderings. The plain month list is a
    // ledger - what happened, most recent first. Drilling into a category
    // asks where the money went, so the biggest amounts lead and equal
    // amounts fall back to newest.
    .sort((a, b) => {
      const byDate =
        new Date(b.expense_datetime || b.expense_date).getTime() -
        new Date(a.expense_datetime || a.expense_date).getTime();
      return selected ? b.amount - a.amount || byDate : byDate;
    });

  const shownTotal = filtered?.reduce((sum, e) => sum + e.amount, 0) ?? 0;
  const isNarrowed = Boolean(selected) || Boolean(search.trim());

  const exportHref = `/api/expenses/export?year=${year}${monthParam}${
    selected ? `&category=${encodeURIComponent(selected)}` : ""
  }`;

  const needsReview = data?.categories.find((c) => c.category === "Uncategorised");

  return (
    <>
      <div className="card p-5 sm:p-6 rise">
        <div className="flex items-center gap-2 mb-4">
          {(["month", "year"] as const).map((s) => (
            <button
              key={s}
              onClick={() => setScope(s)}
              className={`btn !py-1.5 !px-3.5 text-[12px] ${scope === s ? "btn-primary" : "btn-ghost"}`}
            >
              {s === "month" ? "By month" : "By year"}
            </button>
          ))}
        </div>

        <div className="flex items-center justify-between mb-4">
          <button
            onClick={() => nav(-1)}
            aria-label={scope === "year" ? "Previous year" : "Previous month"}
            className="btn btn-nav !p-0 w-9 h-9"
          >
            ←
          </button>
          <p className="font-semibold text-[15px]">{periodLabel}</p>
          <button
            onClick={() => nav(1)}
            aria-label={scope === "year" ? "Next year" : "Next month"}
            className="btn btn-nav !p-0 w-9 h-9"
          >
            →
          </button>
        </div>

        <p className="text-[13px] font-medium" style={{ color: "var(--muted)" }}>
          Spent in {periodLabel}
        </p>
        <p
          className="hero-num text-4xl font-bold tracking-tight mt-1 tabular"
          style={{ opacity: refreshing && data ? 0.45 : 1, transition: "opacity .18s ease" }}
        >
          {fmtRs(data?.total ?? 0)}
        </p>

        {needsReview && (
          <button
            type="button"
            onClick={() => setSelected("Uncategorised")}
            className="tile px-3 py-2.5 mt-4 w-full text-left cursor-pointer"
            style={{ borderLeft: "3px solid var(--bad)" }}
          >
            <p className="text-[13px] font-semibold">
              {needsReview.count} expense{needsReview.count === 1 ? "" : "s"} need a category
            </p>
            <p className="text-[12px] mt-0.5" style={{ color: "var(--muted)" }}>
              {fmtRs(needsReview.total)} nothing could explain — tap to sort them out
            </p>
          </button>
        )}

        {loadError ? (
          <p className="text-[13px] py-6" style={{ color: "var(--bad)" }} role="alert">
            {loadError}
          </p>
        ) : data === null ? (
          <p className="text-[13px] py-6" style={{ color: "var(--muted)" }} role="status">
            Loading…
          </p>
        ) : data.categories.length === 0 ? (
          <p className="text-[13px] py-6 text-center" style={{ color: "var(--muted)" }}>
            No expenses in {periodLabel}.
          </p>
        ) : (
          <div style={{ opacity: refreshing ? 0.45 : 1, transition: "opacity .18s ease" }}>
          <CategoryChart
            points={data.categories}
            selected={selected}
            onSelect={(c) => setSelected((cur) => (cur === c ? null : c))}
          />
          </div>
        )}

        <div className="form-actions mt-5">
          <button
            type="button"
            className="btn btn-ghost !py-2 text-[13px]"
            onClick={() => setManaging(true)}
          >
            Manage categories
          </button>
          <button
            type="button"
            className="btn btn-ghost !py-2 text-[13px]"
            onClick={onRecategorize}
          >
            Re-categorise
          </button>
          <a className="btn btn-ghost !py-2 text-[13px]" href={exportHref} download>
            Download Excel{selected ? ` · ${selected}` : ""}
          </a>
        </div>
      </div>

      {managing && (
        <ManageCategoriesModal
          categories={categories}
          onClose={() => setManaging(false)}
          onChanged={setCategories}
        />
      )}

      {showHistory && (
      <section ref={historyRef} className="card p-5 sm:p-6 rise">
        <div className="flex items-center justify-between mb-4 gap-3">
          <div className="min-w-0">
            <p className="font-semibold truncate">{selected ?? "History"}</p>
            {isNarrowed && (
              <p className="text-[12px]" style={{ color: "var(--muted)" }}>
                {filtered?.length ?? 0} of {expenses?.length ?? 0} · {fmtRs(shownTotal)}
              </p>
            )}
          </div>
          <div className="flex items-center gap-3 shrink-0">
            {selected && (
              <button
                type="button"
                onClick={() => setSelected(null)}
                className="btn btn-ghost !py-2 !px-3 text-[12px]"
              >
                Clear
              </button>
            )}
            {!isNarrowed && (
              <p className="text-[12px]" style={{ color: "var(--muted)" }}>
                {filtered?.length ?? 0} {filtered?.length === 1 ? "expense" : "expenses"}
              </p>
            )}
          </div>
        </div>

        <input
          className="field mb-4"
          aria-label="Search expenses"
          placeholder="Search by amount, note, vendor, or category…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />

        {expenses === null ? (
          <p className="text-[13px] py-4" style={{ color: "var(--muted)" }} role="status">
            Loading…
          </p>
        ) : filtered?.length === 0 ? (
          <p className="text-[13px] py-4 text-center" style={{ color: "var(--muted)" }}>
            {search ? "No matching expenses" : `No expenses in ${periodLabel}.`}
          </p>
        ) : (
          <ul className="pb-2">
            {filtered?.map((e) =>
              selected === "Uncategorised" ? (
                <ReviewRow
                  key={e.id}
                  expense={e}
                  categories={categories}
                  onAssigned={() =>
                    setExpenses((cur) => cur?.filter((r) => r.id !== e.id) ?? null)
                  }
                />
              ) : (
                <ExpenseRow key={e.id} expense={e} onView={() => onViewDetail(e)} />
              )
            )}
          </ul>
        )}
      </section>
      )}
    </>
  );
}

/* ---------- page ---------- */

export default function ExpensesPage() {
  const [adding, setAdding] = useState(false);
  const [viewingDetail, setViewingDetail] = useState<Expense | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const [recategorizing, setRecategorizing] = useState(false);

  const refresh = () => setRefreshKey((k) => k + 1);

  return (
    <>
      <div className="flex items-center justify-end -mt-2">
        {!adding && !viewingDetail && (
          <button className="btn btn-expense" onClick={() => setAdding(true)}>
            Log expense
          </button>
        )}
      </div>

      {adding && (
        <ExpenseForm
          editing={null}
          onCancel={() => setAdding(false)}
          onDone={() => {
            setAdding(false);
            refresh();
          }}
        />
      )}

      {recategorizing && (
        <RecategorizeModal
          onClose={() => setRecategorizing(false)}
          onApplied={() => {
            setRecategorizing(false);
            refresh();
          }}
        />
      )}

      {viewingDetail && (
        <DetailModal
          expense={viewingDetail}
          onClose={() => setViewingDetail(null)}
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
        refreshKey={refreshKey}
        onViewDetail={setViewingDetail}
        onRecategorize={() => setRecategorizing(true)}
      />

      <footer className="text-center text-[12px] py-4" style={{ color: "var(--muted)" }}>
        Mera Khata · your everyday spending, sorted
      </footer>
    </>
  );
}
