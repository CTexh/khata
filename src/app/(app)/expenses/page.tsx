"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { Expense, YearlyPoint } from "@/lib/db";
import { fmtRs, fmtDateLabel, MONTH_NAMES } from "@/lib/format";

type View = "month" | "year" | "categories";

// Category colors mapping - optimized for light and dark modes
const CATEGORY_COLORS: Record<string, { bg: string; darkBg: string; text: string; darkText: string }> = {
  "Food & Dining": { bg: "#FFF3CD", darkBg: "#8B6F47", text: "#856404", darkText: "#FFE66D" },
  Food: { bg: "#FFF3CD", darkBg: "#8B6F47", text: "#856404", darkText: "#FFE66D" },
  Transport: { bg: "#D1ECF1", darkBg: "#0D5470", text: "#0C5460", darkText: "#A8E6FF" },
  Shopping: { bg: "#F8D7DA", darkBg: "#7A2B2B", text: "#721C24", darkText: "#FF6B6B" },
  Utilities: { bg: "#D4EDDA", darkBg: "#2D5C3E", text: "#155724", darkText: "#6FD676" },
  Entertainment: { bg: "#E2E3E5", darkBg: "#505050", text: "#383D41", darkText: "#C8C8C8" },
  Healthcare: { bg: "#F8D7DA", darkBg: "#7A2B2B", text: "#721C24", darkText: "#FF6B6B" },
  Travel: { bg: "#D1ECF1", darkBg: "#0D5470", text: "#0C5460", darkText: "#A8E6FF" },
  Groceries: { bg: "#D4EDDA", darkBg: "#2D5C3E", text: "#155724", darkText: "#6FD676" },
  Restaurants: { bg: "#FFF3CD", darkBg: "#8B6F47", text: "#856404", darkText: "#FFE66D" },
  "Mobile Wallet Transfer": { bg: "#CCE5FF", darkBg: "#1E3A8A", text: "#0C47A1", darkText: "#93C5FD" },
  "Bank Fees": { bg: "#FFD9D9", darkBg: "#6B1F1F", text: "#A91F1F", darkText: "#FCA5A5" },
  // Canonical set (see src/lib/categorize.ts)
  Family: { bg: "#FCE7F3", darkBg: "#7A2E58", text: "#9D174D", darkText: "#F9A8D4" },
  Donations: { bg: "#FEF3C7", darkBg: "#78350F", text: "#92400E", darkText: "#FCD34D" },
  Tech: { bg: "#E0F2FE", darkBg: "#075985", text: "#075985", darkText: "#7DD3FC" },
  Medical: { bg: "#F8D7DA", darkBg: "#7A2B2B", text: "#721C24", darkText: "#FF6B6B" },
  Investment: { bg: "#DCFCE7", darkBg: "#14532D", text: "#166534", darkText: "#86EFAC" },
  Uncategorised: { bg: "#FEE2E2", darkBg: "#7F1D1D", text: "#991B1B", darkText: "#FCA5A5" },
  Car: { bg: "#DBEAFE", darkBg: "#1E40AF", text: "#1E3A8A", darkText: "#93C5FD" },
  "Bills & Utilities": { bg: "#D4EDDA", darkBg: "#2D5C3E", text: "#155724", darkText: "#6FD676" },
  Rent: { bg: "#EDE9FE", darkBg: "#4C1D95", text: "#5B21B6", darkText: "#C4B5FD" },
  "Mobile Top-up": { bg: "#CFFAFE", darkBg: "#155E75", text: "#155E75", darkText: "#A5F3FC" },
  Health: { bg: "#F8D7DA", darkBg: "#7A2B2B", text: "#721C24", darkText: "#FF6B6B" },
  Subscriptions: { bg: "#E0E7FF", darkBg: "#3730A3", text: "#3730A3", darkText: "#A5B4FC" },
  "Bank Charges": { bg: "#FFD9D9", darkBg: "#6B1F1F", text: "#A91F1F", darkText: "#FCA5A5" },
  Transfer: { bg: "#CCE5FF", darkBg: "#1E3A8A", text: "#0C47A1", darkText: "#93C5FD" },
  Other: { bg: "#E9ECEF", darkBg: "#404040", text: "#495057", darkText: "#BFBFBF" },
};

function getCategoryColor(category?: string) {
  if (!category) return { bg: "var(--accent-soft)", darkBg: "var(--accent-soft)", text: "var(--accent)", darkText: "var(--accent)" };
  const color = CATEGORY_COLORS[category] || { bg: "#E9ECEF", darkBg: "#404040", text: "#495057", darkText: "#BFBFBF" };
  return color;
}

// Respects the app's manual theme toggle (data-theme attribute) first,
// falling back to the OS preference when the user hasn't overridden it.
function isDarkMode(): boolean {
  if (typeof document === "undefined") return false;
  const explicit = document.documentElement.dataset.theme;
  if (explicit === "dark") return true;
  if (explicit === "light") return false;
  return typeof window !== "undefined" && window.matchMedia("(prefers-color-scheme: dark)").matches;
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

function useCategories() {
  const [categories, setCategories] = useState<UserCategory[]>([]);

  const reload = useCallback(async () => {
    const res = await fetch("/api/categories");
    if (!res.ok) return;
    const d = await res.json();
    setCategories(d.categories ?? []);
  }, []);

  useEffect(() => {
    reload();
  }, [reload]);

  return { categories, setCategories, reload };
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
  const categoryColor = getCategoryColor(expense.category);
  const isDark = isDarkMode();

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
                      background: isDark ? "#334155" : categoryColor.bg,
                      color: isDark ? "#cbd5e1" : categoryColor.text,
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
                <label className="block text-[12px] font-medium mb-1.5" style={{ color: isDark ? "#b0b0b0" : "#666666" }}>
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
                <label className="block text-[12px] font-medium mb-1.5" style={{ color: isDark ? "#b0b0b0" : "#666666" }}>
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
                <label className="block text-[12px] font-medium mb-1.5" style={{ color: isDark ? "#b0b0b0" : "#666666" }}>
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
                <label className="block text-[12px] font-medium mb-1.5" style={{ color: isDark ? "#b0b0b0" : "#666666" }}>
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
                <label className="block text-[12px] font-medium mb-1.5" style={{ color: isDark ? "#b0b0b0" : "#666666" }}>
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
  to: string;
  reason: "rule" | "vendor-rule" | "keyword" | "tidy" | "learned";
};

const REASON_LABEL: Record<RecatChange["reason"], string> = {
  keyword: "keyword on one of your categories",
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
  const categoryColor = getCategoryColor(expense.category);
  const isDark = isDarkMode();

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
              background: isDark ? "#334155" : categoryColor.bg,
              color: isDark ? "#cbd5e1" : categoryColor.text,
            }}
          >
            {expense.category}
          </span>
        )}
      </div>

      {/* Title and Date */}
      <div className="min-w-0">
        <p className="text-[14px] truncate font-medium" style={{ color: isDark ? "#f1f5f9" : "#1a1a1a" }}>{expense.vendor || "Expense"}</p>
        <p className="text-[12px] truncate" style={{ color: isDark ? "#94a3b8" : "#666666" }}>
          {fmtDateLabel(expense.expense_date)}
        </p>
      </div>

      {/* Amount - Right Aligned */}
      <span className="tabular text-[14px] font-semibold text-right" style={{ color: isDark ? "#f1f5f9" : "#1a1a1a" }}>
        {fmtRs(expense.amount)}
      </span>
      </button>
    </li>
  );
}

/* ---------- month view ---------- */

function MonthView({
  year,
  month,
  onNav,
  refreshKey,
  onViewDetail,
  onRecategorize,
}: {
  year: number;
  month: number;
  onNav: (dir: -1 | 1) => void;
  refreshKey: number;
  onViewDetail: (e: Expense) => void;
  onRecategorize: () => void;
}) {
  const [expenses, setExpenses] = useState<Expense[] | null>(null);
  const [search, setSearch] = useState("");

  const load = useCallback(async () => {
    setExpenses(null);
    const res = await fetch(`/api/expenses?year=${year}&month=${month}`);
    setExpenses(await res.json());
  }, [year, month]);

  useEffect(() => {
    load();
  }, [load, refreshKey]);

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
    .sort((a, b) => new Date(b.expense_datetime || b.expense_date).getTime() - new Date(a.expense_datetime || a.expense_date).getTime());

  const total = filtered?.reduce((s, e) => s + e.amount, 0) ?? 0;

  return (
    <>
      <div className="card p-5 sm:p-6 rise">
        <div className="flex items-center justify-between mb-4">
          <button
            onClick={() => onNav(-1)}
            aria-label="Previous month"
            className="btn btn-nav !p-0 w-9 h-9"
          >
            ←
          </button>
          <p className="font-semibold text-[15px]">
            {MONTH_NAMES[month - 1]} {year}
          </p>
          <button
            onClick={() => onNav(1)}
            aria-label="Next month"
            className="btn btn-nav !p-0 w-9 h-9"
          >
            →
          </button>
        </div>

        <p className="text-[13px] font-medium" style={{ color: "var(--muted)" }}>
          {search ? "Filtered total" : "Spent this month"}
        </p>
        <p className="hero-num text-4xl font-bold tracking-tight mt-1 tabular">
          {fmtRs(total)}
        </p>
      </div>

      <section className="card p-5 sm:p-6 rise">
        <div className="flex items-center justify-between mb-4 gap-3">
          <p className="font-semibold">History</p>
          <div className="flex items-center gap-3 shrink-0">
            <button
              type="button"
              onClick={onRecategorize}
              className="text-[12px] underline underline-offset-2 cursor-pointer"
              style={{ color: "var(--muted)" }}
            >
              Re-categorise
            </button>
            <p className="text-[12px]" style={{ color: "var(--muted)" }}>
              {filtered?.length ?? 0} {filtered?.length === 1 ? "expense" : "expenses"}
            </p>
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
            {search ? "No matching expenses" : `No expenses logged in ${MONTH_NAMES[month - 1]}.`}
          </p>
        ) : (
          <ul className="pb-2">
            {filtered?.map((e) => (
              <ExpenseRow
                key={e.id}
                expense={e}
                onView={() => onViewDetail(e)}
              />
            ))}
          </ul>
        )}
      </section>
    </>
  );
}

/* ---------- yearly bar chart ---------- */

function YearlyChart({ points }: { points: YearlyPoint[] }) {
  const max = Math.max(...points.map((p) => p.total), 1);
  const highestIdx = points.reduce(
    (best, p, i) => (p.total > points[best].total ? i : best),
    0
  );
  const MONTH_ABBR = ["J", "F", "M", "A", "M", "J", "J", "A", "S", "O", "N", "D"];

  return (
    <div className="flex items-end gap-1.5 sm:gap-2.5 h-40 mt-2">
      {points.map((p, i) => {
        const h = p.total > 0 ? Math.max((p.total / max) * 100, 4) : 2;
        const isHighest = i === highestIdx && p.total > 0;
        return (
          <div key={p.month} className="flex-1 flex flex-col items-center gap-1.5 h-full">
            <div className="flex-1 w-full flex items-end">
              <div
                className="w-full rounded-t-lg transition-[height] duration-500"
                style={{
                  height: `${h}%`,
                  background: isHighest
                    ? "linear-gradient(180deg, var(--accent-2), var(--accent))"
                    : "linear-gradient(180deg, var(--accent), var(--accent-2))",
                  opacity: isHighest ? 1 : 0.55,
                  boxShadow: isHighest ? "0 0 14px var(--accent-soft)" : undefined,
                }}
                title={`${MONTH_NAMES[i]}: ${fmtRs(p.total)} (${p.count} expense${p.count === 1 ? "" : "s"})`}
              />
            </div>
            <span
              className="text-[10px] font-medium"
              style={{ color: isHighest ? "var(--accent)" : "var(--muted)" }}
            >
              {MONTH_ABBR[i]}
            </span>
          </div>
        );
      })}
    </div>
  );
}

/* ---------- year view ---------- */

function YearView({
  year,
  onNav,
  refreshKey,
}: {
  year: number;
  onNav: (dir: -1 | 1) => void;
  refreshKey: number;
}) {
  const [data, setData] = useState<{ yearly: YearlyPoint[] } | null>(null);

  useEffect(() => {
    setData(null);
    fetch(`/api/expenses/stats?year=${year}`)
      .then((r) => r.json())
      .then(setData);
  }, [year, refreshKey]);

  const total = data?.yearly.reduce((s, p) => s + p.total, 0) ?? 0;
  const highest = data?.yearly.reduce(
    (best, p) => (p.total > best.total ? p : best),
    { month: 1, total: 0, count: 0 }
  );

  return (
    <div className="card p-5 sm:p-6 rise">
      <div className="flex items-center justify-between mb-4">
        <button
          onClick={() => onNav(-1)}
          aria-label="Previous year"
          className="btn btn-nav !p-0 w-9 h-9"
        >
          ←
        </button>
        <p className="font-semibold text-[15px]">{year}</p>
        <button
          onClick={() => onNav(1)}
          aria-label="Next year"
          className="btn btn-nav !p-0 w-9 h-9"
        >
          →
        </button>
      </div>

      <p className="text-[13px] font-medium" style={{ color: "var(--muted)" }}>
        Spent in {year}
      </p>
      <p className="hero-num text-4xl font-bold tracking-tight mt-1 tabular">{fmtRs(total)}</p>

      {data ? <YearlyChart points={data.yearly} /> : <div className="h-40 mt-2" />}

      {highest && highest.total > 0 && (
        <div className="tile px-3 py-2.5 mt-5 inline-flex">
          <div>
            <p className="text-[11px] font-medium" style={{ color: "var(--muted)" }}>
              Highest-spending month
            </p>
            <p className="text-sm font-semibold mt-0.5">
              {MONTH_NAMES[highest.month - 1]} — <span className="tabular">{fmtRs(highest.total)}</span>
            </p>
          </div>
        </div>
      )}
    </div>
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
  const isDark = isDarkMode();

  return (
    <div className="flex flex-col gap-2.5 mt-4">
      {points.map((p) => {
        const color = getCategoryColor(p.category);
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
                  background: isDark ? color.darkBg : color.bg,
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

function CategoriesView({
  refreshKey,
  onViewDetail,
}: {
  refreshKey: number;
  onViewDetail: (e: Expense) => void;
}) {
  const now = new Date();
  const [scope, setScope] = useState<"month" | "year">("month");
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth() + 1);
  const [data, setData] = useState<{ total: number; categories: CategoryPoint[] } | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [rows, setRows] = useState<Expense[] | null>(null);
  const { categories, setCategories } = useCategories();
  const [managing, setManaging] = useState(false);

  const monthParam = scope === "month" ? `&month=${month}` : "";
  const periodLabel = scope === "month" ? `${MONTH_NAMES[month - 1]} ${year}` : String(year);

  useEffect(() => {
    setData(null);
    setSelected(null);
    fetch(`/api/expenses/categories?year=${year}${monthParam}`)
      .then((r) => r.json())
      .then(setData);
  }, [year, month, scope, monthParam, refreshKey]);

  useEffect(() => {
    if (!selected) {
      setRows(null);
      return;
    }
    setRows(null);
    fetch(`/api/expenses?year=${year}${monthParam}&category=${encodeURIComponent(selected)}`)
      .then((r) => r.json())
      .then(setRows);
  }, [selected, year, month, scope, monthParam, refreshKey]);

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
        <p className="hero-num text-4xl font-bold tracking-tight mt-1 tabular">
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
              {needsReview.count} transfer{needsReview.count === 1 ? "" : "s"} need a category
            </p>
            <p className="text-[12px] mt-0.5" style={{ color: "var(--muted)" }}>
              {fmtRs(needsReview.total)} the feed couldn&apos;t explain — tap to sort them out
            </p>
          </button>
        )}

        {data === null ? (
          <p className="text-[13px] py-6" style={{ color: "var(--muted)" }} role="status">
            Loading…
          </p>
        ) : data.categories.length === 0 ? (
          <p className="text-[13px] py-6 text-center" style={{ color: "var(--muted)" }}>
            No expenses in {periodLabel}.
          </p>
        ) : (
          <CategoryChart
            points={data.categories}
            selected={selected}
            onSelect={(c) => setSelected((cur) => (cur === c ? null : c))}
          />
        )}

        <div className="form-actions mt-5">
          <button
            type="button"
            className="btn btn-ghost !py-2 text-[13px]"
            onClick={() => setManaging(true)}
          >
            Manage categories
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

      {selected && (
        <section className="card p-5 sm:p-6 rise">
          <div className="flex items-center justify-between mb-4 gap-3">
            <div className="min-w-0">
              <p className="font-semibold truncate">{selected}</p>
              <p className="text-[12px]" style={{ color: "var(--muted)" }}>
                {periodLabel}
              </p>
            </div>
            <button
              type="button"
              onClick={() => setSelected(null)}
              className="btn btn-ghost !py-2 !px-3 text-[12px] shrink-0"
            >
              Clear
            </button>
          </div>

          {rows === null ? (
            <p className="text-[13px] py-4" style={{ color: "var(--muted)" }} role="status">
              Loading…
            </p>
          ) : rows.length === 0 ? (
            <p className="text-[13px] py-4 text-center" style={{ color: "var(--muted)" }}>
              Nothing here.
            </p>
          ) : (
            <ul className="pb-2">
              {rows.map((e) =>
                selected === "Uncategorised" ? (
                  <ReviewRow
                    key={e.id}
                    expense={e}
                    categories={categories}
                    onAssigned={() => setRows((cur) => cur?.filter((r) => r.id !== e.id) ?? null)}
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
  const now = new Date();
  const [view, setView] = useState<View>("month");
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth() + 1);
  const [chartYear, setChartYear] = useState(now.getFullYear());
  const [adding, setAdding] = useState(false);
  const [viewingDetail, setViewingDetail] = useState<Expense | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const [recategorizing, setRecategorizing] = useState(false);

  const navMonth = (dir: -1 | 1) => {
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

  const refresh = () => setRefreshKey((k) => k + 1);

  const views: { id: View; label: string }[] = [
    { id: "month", label: "This month" },
    { id: "year", label: "Yearly" },
    { id: "categories", label: "Categories" },
  ];

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

      <div className="flex items-center gap-2">
        {views.map((v) => (
          <button
            key={v.id}
            onClick={() => setView(v.id)}
            className={`btn !py-2 text-[13px] ${view === v.id ? "btn-primary" : "btn-ghost"}`}
          >
            {v.label}
          </button>
        ))}
      </div>

      {view === "month" && (
        <MonthView
          year={year}
          month={month}
          onNav={navMonth}
          refreshKey={refreshKey}
          onViewDetail={setViewingDetail}
          onRecategorize={() => setRecategorizing(true)}
        />
      )}
      {view === "categories" && (
        <CategoriesView refreshKey={refreshKey} onViewDetail={setViewingDetail} />
      )}
      {view === "year" && (
        <YearView
          year={chartYear}
          onNav={(dir) => setChartYear((y) => y + dir)}
          refreshKey={refreshKey}
        />
      )}

      <footer className="text-center text-[12px] py-4" style={{ color: "var(--muted)" }}>
        Mera Khata · your everyday spending, sorted
      </footer>
    </>
  );
}
