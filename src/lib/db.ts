import { createClient, type Client } from "@libsql/client";
import { randomUUID } from "crypto";
import { CATEGORIES, canonicalCategory, matchRuleCategory, normalizeVendor } from "@/lib/categorize";

let client: Client | null = null;

function getClient(): Client {
  if (!client) {
    client = createClient({
      url: process.env.TURSO_DATABASE_URL ?? "file:local.db",
      authToken: process.env.TURSO_AUTH_TOKEN,
    });
  }
  return client;
}

export function db(): Client {
  return getClient();
}

/* ---------- users ---------- */

export type User = {
  id: string;
  username: string;
  name: string | null;
  phone: string | null;
  password_hash: string;
  is_admin: boolean;
  created_at: string;
};

// Lazy migration for installations created before the "name" field existed -
// mirrors the ensureTablesExist() pattern used for subscriptions below.
// SELECT * against a DB missing this column simply omits it from the row
// (no error), so only writers (signup) need to call this first.
export async function ensureUserNameColumn(): Promise<void> {
  const c = await db();
  try {
    await c.execute(`ALTER TABLE users ADD COLUMN name TEXT`);
  } catch {
    // Column already exists.
  }
}

// Same lazy-migration pattern for the WhatsApp reminder opt-in phone number.
// (The sending side - WHATSAPP_PHONE_NUMBER_ID / WHATSAPP_ACCESS_TOKEN - is
// one shared Meta WhatsApp Business number for the whole app, set via env
// vars in src/lib/whatsapp.ts, not per-user.)
export async function ensureUserNotificationColumns(): Promise<void> {
  const c = await db();
  try {
    await c.execute(`ALTER TABLE users ADD COLUMN phone TEXT`);
  } catch {
    // Column already exists.
  }
}

export async function findUserByUsername(username: string): Promise<User | null> {
  const c = await db();
  const rs = await c.execute({
    sql: "SELECT * FROM users WHERE username = ? COLLATE NOCASE",
    args: [username],
  });
  const r = rs.rows[0];
  if (!r) return null;
  return {
    id: r.id as string,
    username: r.username as string,
    name: (r.name as string) ?? null,
    phone: (r.phone as string) ?? null,
    password_hash: r.password_hash as string,
    is_admin: Number(r.is_admin) === 1,
    created_at: r.created_at as string,
  };
}

export async function findUserById(id: string): Promise<User | null> {
  const c = await db();
  const rs = await c.execute({ sql: "SELECT * FROM users WHERE id = ?", args: [id] });
  const r = rs.rows[0];
  if (!r) return null;
  return {
    id: r.id as string,
    username: r.username as string,
    name: (r.name as string) ?? null,
    phone: (r.phone as string) ?? null,
    password_hash: r.password_hash as string,
    is_admin: Number(r.is_admin) === 1,
    created_at: r.created_at as string,
  };
}

export async function updateUserProfile(userId: string, name: string, phone: string): Promise<void> {
  await ensureUserNameColumn();
  await ensureUserNotificationColumns();
  const c = await db();
  await c.execute({
    sql: "UPDATE users SET name = ?, phone = ? WHERE id = ?",
    args: [name || null, phone || null, userId],
  });
}

export type ReminderRecipient = { id: string; phone: string };

export async function listUsersForReminders(): Promise<ReminderRecipient[]> {
  await ensureUserNotificationColumns();
  const c = await db();
  const rs = await c.execute(`SELECT id, phone FROM users WHERE phone IS NOT NULL AND phone != ''`);
  return rs.rows.map((r) => ({
    id: r.id as string,
    phone: r.phone as string,
  }));
}

export type UserSummary = {
  id: string;
  username: string;
  is_admin: boolean;
  created_at: string;
  people_count: number;
  expense_count: number;
};

export async function listUsers(): Promise<UserSummary[]> {
  const c = await db();
  const rs = await c.execute(`
    SELECT u.id, u.username, u.is_admin, u.created_at,
           (SELECT COUNT(*) FROM people p WHERE p.user_id = u.id) AS people_count,
           (SELECT COUNT(*) FROM expenses e WHERE e.user_id = u.id) AS expense_count
    FROM users u
    ORDER BY u.created_at ASC
  `);
  return rs.rows.map((r) => ({
    id: r.id as string,
    username: r.username as string,
    is_admin: Number(r.is_admin) === 1,
    created_at: r.created_at as string,
    people_count: Number(r.people_count),
    expense_count: Number(r.expense_count),
  }));
}

export async function deleteUser(id: string): Promise<void> {
  const c = await db();
  await c.batch(
    [
      {
        sql: `DELETE FROM transactions WHERE person_id IN (SELECT id FROM people WHERE user_id = ?)`,
        args: [id],
      },
      { sql: "DELETE FROM people WHERE user_id = ?", args: [id] },
      { sql: "DELETE FROM expenses WHERE user_id = ?", args: [id] },
      { sql: "DELETE FROM users WHERE id = ?", args: [id] },
    ],
    "write"
  );
}

/* ---------- people / loans (scoped per user) ---------- */

export type Person = {
  id: string;
  name: string;
  created_at: string;
  due_date: string | null;
  balance: number;
  lent: number;
  received: number;
  tx_count: number;
  last_activity: string;
};

export type Tx = {
  id: string;
  person_id: string;
  amount: number;
  note: string;
  created_at: string;
};

export async function listPeople(userId: string): Promise<Person[]> {
  const c = await db();
  const rs = await c.execute({
    sql: `
      SELECT p.id, p.name, p.created_at, p.due_date,
             COALESCE(SUM(t.amount), 0) AS balance,
             COALESCE(SUM(CASE WHEN t.amount > 0 THEN t.amount ELSE 0 END), 0) AS lent,
             COALESCE(SUM(CASE WHEN t.amount < 0 THEN -t.amount ELSE 0 END), 0) AS received,
             COUNT(t.id) AS tx_count,
             COALESCE(MAX(t.created_at), p.created_at) AS last_activity
      FROM people p
      LEFT JOIN transactions t ON t.person_id = p.id
      WHERE p.user_id = ?
      GROUP BY p.id
      ORDER BY balance DESC, p.name ASC
    `,
    args: [userId],
  });
  return rs.rows.map((r) => ({
    id: r.id as string,
    name: r.name as string,
    created_at: r.created_at as string,
    due_date: (r.due_date as string) ?? null,
    balance: Number(r.balance),
    lent: Number(r.lent),
    received: Number(r.received),
    tx_count: Number(r.tx_count),
    last_activity: r.last_activity as string,
  }));
}

export async function updatePersonDueDate(
  personId: string,
  dueDate: string | null
): Promise<void> {
  const c = await db();
  await c.execute({
    sql: "UPDATE people SET due_date = ? WHERE id = ?",
    args: [dueDate, personId],
  });
}

export async function personBelongsToUser(personId: string, userId: string): Promise<boolean> {
  const c = await db();
  const rs = await c.execute({
    sql: "SELECT id FROM people WHERE id = ? AND user_id = ?",
    args: [personId, userId],
  });
  return rs.rows.length > 0;
}

export async function listTx(personId: string): Promise<Tx[]> {
  const c = await db();
  const rs = await c.execute({
    sql: `SELECT * FROM transactions WHERE person_id = ? ORDER BY created_at DESC, id DESC`,
    args: [personId],
  });
  return rs.rows.map((r) => ({
    id: r.id as string,
    person_id: r.person_id as string,
    amount: Number(r.amount),
    note: (r.note as string) ?? "",
    created_at: r.created_at as string,
  }));
}

/* ---------- expenses (scoped per user) ---------- */

export type Expense = {
  id: string;
  user_id: string;
  amount: number;
  note: string;
  expense_date: string;
  expense_datetime: string;
  created_at: string;
  vendor?: string;
  category?: string;
};

// Rows with no category are reported under this label so they stay visible in
// breakdowns instead of silently vanishing from the totals.
export const UNCATEGORISED = "Uncategorised";

// SQL fragment + args for "this expense is in this category", handling the
// uncategorised bucket (NULL or empty string) as a first-class choice.
function categoryFilter(category: string): { sql: string; args: string[] } {
  if (category === UNCATEGORISED) {
    return { sql: " AND (category IS NULL OR category = '')", args: [] };
  }
  return { sql: " AND category = ?", args: [category] };
}

export async function listExpenses(
  userId: string,
  opts: { year: number; month?: number; category?: string }
): Promise<Expense[]> {
  const c = await db();
  const prefix =
    opts.month !== undefined
      ? `${opts.year}-${String(opts.month).padStart(2, "0")}`
      : `${opts.year}`;

  const filter = opts.category ? categoryFilter(opts.category) : { sql: "", args: [] };
  const rs = await c.execute({
    sql: `SELECT * FROM expenses WHERE user_id = ? AND expense_date LIKE ?${filter.sql} ORDER BY expense_date DESC, created_at DESC`,
    args: [userId, `${prefix}%`, ...filter.args],
  });
  return rs.rows.map(rowToExpense);
}

export type CategoryPoint = { category: string; total: number; count: number };

// Spending grouped by category for a month (or a whole year when `month` is
// omitted), biggest first - the shape the report chart renders directly.
export async function categoryTotals(
  userId: string,
  opts: { year: number; month?: number }
): Promise<CategoryPoint[]> {
  const c = await db();
  const prefix =
    opts.month !== undefined
      ? `${opts.year}-${String(opts.month).padStart(2, "0")}`
      : `${opts.year}`;
  const rs = await c.execute({
    sql: `SELECT COALESCE(NULLIF(TRIM(category), ''), ?) AS category,
                 SUM(amount) AS total,
                 COUNT(*) AS count
          FROM expenses
          WHERE user_id = ? AND expense_date LIKE ?
          GROUP BY category
          ORDER BY total DESC`,
    args: [UNCATEGORISED, userId, `${prefix}%`],
  });
  return rs.rows.map((r) => ({
    category: r.category as string,
    total: Number(r.total),
    count: Number(r.count),
  }));
}

export async function getExpense(id: string, userId: string): Promise<Expense | null> {
  const c = await db();
  const rs = await c.execute({
    sql: "SELECT * FROM expenses WHERE id = ? AND user_id = ?",
    args: [id, userId],
  });
  const r = rs.rows[0];
  return r ? rowToExpense(r) : null;
}

function rowToExpense(r: Record<string, unknown>): Expense {
  const dt = (r.expense_datetime as string) ?? "";
  return {
    id: r.id as string,
    user_id: r.user_id as string,
    amount: Number(r.amount),
    note: (r.note as string) ?? "",
    expense_date: r.expense_date as string,
    expense_datetime: dt,
    created_at: r.created_at as string,
    vendor: (r.vendor as string) ?? undefined,
    category: (r.category as string) ?? undefined,
  };
}

// Idempotent: skips insertion if a subscriptions-total expense already
// exists for this user in this month, so a re-run of the month-end cron
// (retry, redeploy) never double-books it.
export async function ensureMonthlySubscriptionsExpense(
  userId: string,
  year: number,
  month: number,
  total: number
): Promise<boolean> {
  if (total <= 0) return false;
  const c = await db();
  const prefix = `${year}-${String(month).padStart(2, "0")}`;
  const existing = await c.execute({
    sql: `SELECT id FROM expenses WHERE user_id = ? AND category = 'Subscriptions' AND expense_date LIKE ?`,
    args: [userId, `${prefix}%`],
  });
  if (existing.rows.length > 0) return false;

  const lastDay = new Date(year, month, 0).getDate();
  const expenseDate = `${prefix}-${String(lastDay).padStart(2, "0")}`;
  await c.execute({
    sql: `INSERT INTO expenses (id, user_id, amount, note, expense_date, expense_datetime, created_at, vendor, category)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    args: [
      randomUUID(),
      userId,
      total,
      `Subscriptions total (${MONTH_NAMES_FULL[month - 1]} ${year})`,
      expenseDate,
      `${expenseDate}T00:00:00Z`,
      new Date().toISOString(),
      null,
      "Subscriptions",
    ],
  });
  return true;
}

const MONTH_NAMES_FULL = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

export type YearlyPoint = { month: number; total: number; count: number };

export async function yearlyExpenseTotals(userId: string, year: number): Promise<YearlyPoint[]> {
  const c = await db();
  const rs = await c.execute({
    sql: `
      SELECT substr(expense_date, 6, 2) AS month, SUM(amount) AS total, COUNT(*) AS count
      FROM expenses
      WHERE user_id = ? AND expense_date >= ? AND expense_date < ?
      GROUP BY month
    `,
    args: [userId, `${year}-01-01`, `${year + 1}-01-01`],
  });
  const map = new Map<number, YearlyPoint>();
  for (const r of rs.rows) {
    const m = Number(r.month);
    map.set(m, { month: m, total: Number(r.total), count: Number(r.count) });
  }
  return Array.from({ length: 12 }, (_, i) => {
    const m = i + 1;
    return map.get(m) ?? { month: m, total: 0, count: 0 };
  });
}

/* ---------- expense categorisation ----------
 * See src/lib/categorize.ts for the deterministic half. This half holds the
 * two layers that need the database: per-vendor rules the user has taught by
 * setting a category by hand, and the category they've historically used most
 * for the same vendor.
 */

let categoryTablesEnsured = false;

export async function ensureCategoryTables(): Promise<void> {
  if (categoryTablesEnsured) return;
  const c = await db();
  await c.execute(`CREATE TABLE IF NOT EXISTS expense_vendor_rules (
    user_id TEXT NOT NULL,
    vendor_key TEXT NOT NULL,
    category TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    PRIMARY KEY (user_id, vendor_key)
  )`);
  // The user's own category list. Categories are picked from here, never
  // typed free-hand, which is what keeps the list short instead of growing a
  // tail of near-duplicates. `keywords` lets a category the user invented
  // start catching expenses on its own.
  await c.execute(`CREATE TABLE IF NOT EXISTS expense_categories (
    user_id TEXT NOT NULL,
    name TEXT NOT NULL,
    keywords TEXT,
    sort_order INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL,
    PRIMARY KEY (user_id, name)
  )`);
  // Normalised payee, so "EURO STORE CROW" and "Euro Store Crow" look up the
  // same learned category. Written on every insert/update from here on, and
  // backfilled for older rows by the re-categorise action.
  try {
    await c.execute(`ALTER TABLE expenses ADD COLUMN vendor_key TEXT`);
  } catch {
    // Column already exists.
  }
  try {
    await c.execute(
      `CREATE INDEX IF NOT EXISTS idx_expenses_vendor_key ON expenses (user_id, vendor_key)`
    );
  } catch {
    // Index already exists.
  }
  categoryTablesEnsured = true;
}

export type UserCategory = { name: string; keywords: string[] };

// The user's category list, seeded from the built-in set the first time it is
// read so a new account starts with something sensible rather than nothing.
export async function listUserCategories(userId: string): Promise<UserCategory[]> {
  await ensureCategoryTables();
  const c = await db();

  const read = async () =>
    c.execute({
      sql: `SELECT name, keywords FROM expense_categories WHERE user_id = ? ORDER BY sort_order ASC, name ASC`,
      args: [userId],
    });

  let rs = await read();
  if (rs.rows.length === 0) {
    const now = new Date().toISOString();
    await c.batch(
      CATEGORIES.map((name, i) => ({
        sql: `INSERT OR IGNORE INTO expense_categories (user_id, name, keywords, sort_order, created_at)
              VALUES (?, ?, NULL, ?, ?)`,
        args: [userId, name, i, now],
      })),
      "write"
    );
    rs = await read();
  }

  return rs.rows.map((r) => ({
    name: r.name as string,
    keywords: String(r.keywords ?? "")
      .split(",")
      .map((k) => k.trim().toLowerCase())
      .filter(Boolean),
  }));
}

// Replaces the user's list with the current built-in set. Expenses keep
// whatever category string they already had - the re-categorise pass is what
// folds those onto the new names - so this never destroys history.
export async function resetUserCategories(userId: string): Promise<void> {
  await ensureCategoryTables();
  const c = await db();
  const now = new Date().toISOString();
  await c.execute({ sql: `DELETE FROM expense_categories WHERE user_id = ?`, args: [userId] });
  await c.batch(
    CATEGORIES.map((name, i) => ({
      sql: `INSERT INTO expense_categories (user_id, name, keywords, sort_order, created_at)
            VALUES (?, ?, NULL, ?, ?)`,
      args: [userId, name, i, now],
    })),
    "write"
  );
}

export async function createUserCategory(
  userId: string,
  name: string,
  keywords: string
): Promise<void> {
  await listUserCategories(userId); // ensures the table is seeded first
  const c = await db();
  const rs = await c.execute({
    sql: `SELECT COALESCE(MAX(sort_order), 0) + 1 AS next FROM expense_categories WHERE user_id = ?`,
    args: [userId],
  });
  await c.execute({
    sql: `INSERT OR IGNORE INTO expense_categories (user_id, name, keywords, sort_order, created_at)
          VALUES (?, ?, ?, ?, ?)`,
    args: [userId, name, keywords || null, Number(rs.rows[0].next), new Date().toISOString()],
  });
}

// Renaming carries the existing expenses across, so a rename never orphans
// history into a category that no longer exists.
export async function updateUserCategory(
  userId: string,
  name: string,
  changes: { newName?: string; keywords?: string }
): Promise<void> {
  await ensureCategoryTables();
  const c = await db();
  const newName = changes.newName?.trim();

  if (newName && newName !== name) {
    await c.execute({
      sql: `UPDATE expense_categories SET name = ?, keywords = COALESCE(?, keywords) WHERE user_id = ? AND name = ?`,
      args: [newName, changes.keywords ?? null, userId, name],
    });
    await c.execute({
      sql: `UPDATE expenses SET category = ? WHERE user_id = ? AND category = ?`,
      args: [newName, userId, name],
    });
    await c.execute({
      sql: `UPDATE expense_vendor_rules SET category = ? WHERE user_id = ? AND category = ?`,
      args: [newName, userId, name],
    });
    return;
  }

  await c.execute({
    sql: `UPDATE expense_categories SET keywords = ? WHERE user_id = ? AND name = ?`,
    args: [changes.keywords ?? null, userId, name],
  });
}

// Deleting sends its expenses back to the review queue rather than destroying
// them, and drops the learned rules that pointed at it.
export async function deleteUserCategory(userId: string, name: string): Promise<void> {
  await ensureCategoryTables();
  const c = await db();
  await c.execute({
    sql: `DELETE FROM expense_categories WHERE user_id = ? AND name = ?`,
    args: [userId, name],
  });
  await c.execute({
    sql: `UPDATE expenses SET category = NULL WHERE user_id = ? AND category = ?`,
    args: [userId, name],
  });
  await c.execute({
    sql: `DELETE FROM expense_vendor_rules WHERE user_id = ? AND category = ?`,
    args: [userId, name],
  });
}

// Records "for this payee, I mean this category" - taught implicitly whenever
// the user saves an expense with a category by hand.
export async function upsertVendorRule(
  userId: string,
  vendorKey: string,
  category: string
): Promise<void> {
  if (!vendorKey || !category) return;
  await ensureCategoryTables();
  const c = await db();
  await c.execute({
    sql: `INSERT INTO expense_vendor_rules (user_id, vendor_key, category, updated_at)
          VALUES (?, ?, ?, ?)
          ON CONFLICT(user_id, vendor_key) DO UPDATE SET category = excluded.category, updated_at = excluded.updated_at`,
    args: [userId, vendorKey, category, new Date().toISOString()],
  });
}

export async function getVendorRule(userId: string, vendorKey: string): Promise<string | null> {
  if (!vendorKey) return null;
  await ensureCategoryTables();
  const c = await db();
  const rs = await c.execute({
    sql: `SELECT category FROM expense_vendor_rules WHERE user_id = ? AND vendor_key = ?`,
    args: [userId, vendorKey],
  });
  return (rs.rows[0]?.category as string) ?? null;
}

// The category this user has used most often for this payee before.
export async function learnedCategoryForVendor(
  userId: string,
  vendorKey: string
): Promise<string | null> {
  if (!vendorKey) return null;
  await ensureCategoryTables();
  const c = await db();
  const rs = await c.execute({
    sql: `SELECT category, COUNT(*) AS uses
          FROM expenses
          WHERE user_id = ? AND vendor_key = ? AND category IS NOT NULL AND category != ''
          GROUP BY category
          ORDER BY uses DESC
          LIMIT 1`,
    args: [userId, vendorKey],
  });
  return (rs.rows[0]?.category as string) ?? null;
}

export type CategoryResolution = {
  category: string | null;
  vendorKey: string;
  // Which layer decided, so the UI can explain itself and the re-categorise
  // preview can show why each row is changing.
  source: "vendor-rule" | "keyword" | "rule" | "provided" | "learned" | "none";
};

// The full pipeline. `provided` is whatever category came in on the request -
// typed by the user, or supplied by the email-sync routine.
//
// `explicit` marks a category a human chose in the UI right now. That always
// wins, otherwise an older vendor rule would quietly discard the correction
// the user just made.
//
// Failing that, a vendor rule wins: it is the user's standing instruction
// about this exact payee, so it beats even the built-in family/car rules.
// The built-in rules come next and deliberately outrank a `provided` category
// from the feed, because the bank labels money sent to family as "Transfer" -
// overriding that is the entire point.
export async function resolveExpenseCategory(opts: {
  userId: string;
  vendor: string | null;
  note: string | null;
  provided: string | null;
  explicit?: boolean;
}): Promise<CategoryResolution> {
  const vendorKey = normalizeVendor(opts.vendor);

  if (opts.explicit) {
    const chosen = canonicalCategory(opts.provided);
    if (chosen) return { category: chosen, vendorKey, source: "provided" };
  }

  const vendorRule = await getVendorRule(opts.userId, vendorKey);
  if (vendorRule) return { category: vendorRule, vendorKey, source: "vendor-rule" };

  // Keywords the user attached to their own categories. These sit above the
  // built-in rules because they are the user's explicit configuration, and
  // they are what makes a category they invented start catching expenses
  // without having to be taught one payee at a time.
  const haystack = `${opts.vendor ?? ""} ${opts.note ?? ""}`.toLowerCase();
  if (haystack.trim()) {
    for (const cat of await listUserCategories(opts.userId)) {
      if (cat.keywords.some((k) => haystack.includes(k))) {
        return { category: cat.name, vendorKey, source: "keyword" };
      }
    }
  }

  const rule = matchRuleCategory(opts.vendor, opts.note);
  if (rule) return { category: rule, vendorKey, source: "rule" };

  // A category from the email-sync routine is only a guess, so it is folded
  // strictly onto the known set. Anything unrecognised - notably the bank's
  // catch-all "Transfer" - is dropped, so the expense surfaces as
  // uncategorised for review rather than hiding in a meaningless bucket.
  const provided = canonicalCategory(opts.provided, !opts.explicit);
  if (provided) return { category: provided, vendorKey, source: "provided" };

  const learned = await learnedCategoryForVendor(opts.userId, vendorKey);
  if (learned) return { category: learned, vendorKey, source: "learned" };

  return { category: null, vendorKey, source: "none" };
}

/* ---------- subscriptions (scoped per user) ----------
 * `subscriptions` holds the recurring definition (name, amount, due day).
 * `subscription_payments` holds one row per calendar month ("period",
 * format YYYY-MM) that subscription was due - due_date, and paid_at once
 * marked paid. This is what lets a tile show "paid this month" vs. "due"
 * and a full history when expanded, and lets a new month roll a fresh
 * due entry into view automatically (lazily created on read, no cron
 * needed) instead of overwriting a single mutable next-due-date field.
 */

export type Subscription = {
  id: string;
  user_id: string;
  name: string;
  amount: number;
  due_day: number;
  logo_url: string | null;
  active: boolean;
  created_at: string;
};

export type PaymentRecord = {
  id: string;
  period: string; // "YYYY-MM"
  due_date: string; // "YYYY-MM-DD"
  paid_at: string | null;
  reminder_day_before_sent_at: string | null;
  reminder_due_today_sent_at: string | null;
};

export type SubscriptionWithStatus = Subscription & {
  current_period: string;
  current_due_date: string;
  current_payment_id: string;
  paid_this_period: boolean;
  reminder_day_before_sent: boolean;
  reminder_due_today_sent: boolean;
  status: "paid" | "due-today" | "due-soon" | "upcoming" | "inactive";
  history: PaymentRecord[];
};

function currentPeriodStr(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

export function todayYMD(): string {
  return new Date().toISOString().split("T")[0];
}

export function tomorrowYMD(): string {
  return new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString().split("T")[0];
}

function nextPeriod(period: string): string {
  const [y, m] = period.split("-").map(Number);
  return m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, "0")}`;
}

function clampedDateForPeriod(period: string, due_day: number): string {
  const [y, m] = period.split("-").map(Number);
  const lastDay = new Date(y, m, 0).getDate();
  return `${period}-${String(Math.min(due_day, lastDay)).padStart(2, "0")}`;
}

// Idempotent: INSERT OR IGNORE relies on the UNIQUE(subscription_id, period)
// constraint so calling this on every list load never creates duplicates.
async function ensurePeriodPayment(subscriptionId: string, due_day: number, period: string): Promise<void> {
  const c = await db();
  await c.execute({
    sql: `INSERT OR IGNORE INTO subscription_payments (id, subscription_id, period, due_date, paid_at, created_at)
          VALUES (?, ?, ?, ?, NULL, ?)`,
    args: [randomUUID(), subscriptionId, period, clampedDateForPeriod(period, due_day), new Date().toISOString()],
  });
}

export async function listSubscriptions(userId: string): Promise<SubscriptionWithStatus[]> {
  const c = await db();
  const rs = await c.execute({
    sql: `SELECT * FROM subscriptions WHERE user_id = ? ORDER BY created_at ASC`,
    args: [userId],
  });
  if (rs.rows.length === 0) return [];

  const period = currentPeriodStr();
  const today = todayYMD();
  const soon = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString().split("T")[0];
  const ids = rs.rows.map((r) => r.id as string);

  // Was N sequential ensurePeriodPayment + N sequential history SELECTs
  // (2N+1 round trips to a remote DB). Batch the inserts into one
  // transaction and pull every subscription's history in a single
  // IN-list SELECT instead - 3 round trips total regardless of N.
  const insertStmts = rs.rows
    .filter((r) => Number(r.active ?? 1) === 1)
    .map((r) => ({
      sql: `INSERT OR IGNORE INTO subscription_payments (id, subscription_id, period, due_date, paid_at, created_at)
            VALUES (?, ?, ?, ?, NULL, ?)`,
      args: [
        randomUUID(),
        r.id as string,
        period,
        clampedDateForPeriod(period, Number(r.due_day)),
        new Date().toISOString(),
      ],
    }));
  if (insertStmts.length > 0) await c.batch(insertStmts, "write");

  const histRs = await c.execute({
    sql: `SELECT id, subscription_id, period, due_date, paid_at, reminder_day_before_sent_at, reminder_due_today_sent_at
          FROM subscription_payments WHERE subscription_id IN (${ids.map(() => "?").join(",")}) ORDER BY period DESC`,
    args: ids,
  });
  const historyBySub = new Map<string, PaymentRecord[]>();
  for (const h of histRs.rows) {
    const subId = h.subscription_id as string;
    const list = historyBySub.get(subId) ?? [];
    list.push({
      id: h.id as string,
      period: h.period as string,
      due_date: h.due_date as string,
      paid_at: (h.paid_at as string) ?? null,
      reminder_day_before_sent_at: (h.reminder_day_before_sent_at as string) ?? null,
      reminder_due_today_sent_at: (h.reminder_due_today_sent_at as string) ?? null,
    });
    historyBySub.set(subId, list);
  }

  const result: SubscriptionWithStatus[] = [];
  for (const r of rs.rows) {
    const id = r.id as string;
    const due_day = Number(r.due_day);
    const active = Number(r.active ?? 1) === 1;
    const history = historyBySub.get(id) ?? [];

    const current = history.find((h) => h.period === period) ?? history[0];
    const paid = !!current.paid_at;
    let status: SubscriptionWithStatus["status"];
    if (!active) status = "inactive";
    else if (paid) status = "paid";
    else if (current.due_date <= today) status = "due-today";
    else if (current.due_date <= soon) status = "due-soon";
    else status = "upcoming";

    result.push({
      id,
      user_id: r.user_id as string,
      name: r.name as string,
      amount: Number(r.amount),
      due_day,
      logo_url: (r.logo_url as string) ?? null,
      active,
      created_at: r.created_at as string,
      current_period: current.period,
      current_due_date: current.due_date,
      current_payment_id: current.id,
      paid_this_period: paid,
      reminder_day_before_sent: !!current.reminder_day_before_sent_at,
      reminder_due_today_sent: !!current.reminder_due_today_sent_at,
      status,
      history,
    });
  }
  return result;
}

export async function createSubscription(
  userId: string,
  name: string,
  amount: number,
  date: string, // "YYYY-MM-DD" - exact first due date, as picked in the form
  logo_url?: string
): Promise<Subscription> {
  const c = await db();
  const id = randomUUID();
  const created_at = new Date().toISOString();
  const due_day = Number(date.split("-")[2]);

  await c.execute({
    sql: `INSERT INTO subscriptions (id, user_id, name, amount, due_day, logo_url, created_at)
          VALUES (?, ?, ?, ?, ?, ?, ?)`,
    args: [id, userId, name, amount, due_day, logo_url || null, created_at],
  });

  // First period's payment uses the exact picked date rather than the
  // day-of-month clamp, since the user chose it directly.
  await c.execute({
    sql: `INSERT INTO subscription_payments (id, subscription_id, period, due_date, paid_at, created_at)
          VALUES (?, ?, ?, ?, NULL, ?)`,
    args: [randomUUID(), id, date.slice(0, 7), date, created_at],
  });

  return { id, user_id: userId, name, amount, due_day, logo_url: logo_url || null, active: true, created_at };
}

export async function markSubscriptionPaid(subscriptionId: string, userId: string): Promise<void> {
  const c = await db();
  const subRs = await c.execute({
    sql: `SELECT due_day FROM subscriptions WHERE id = ? AND user_id = ?`,
    args: [subscriptionId, userId],
  });
  const subRow = subRs.rows[0];
  if (!subRow) throw new Error("Subscription not found");
  const due_day = Number(subRow.due_day);

  await ensurePeriodPayment(subscriptionId, due_day, currentPeriodStr());

  // Pay the oldest unpaid period, not just "this month" - if a month was
  // skipped, this catches it up instead of silently leaving it unpaid.
  const unpaidRs = await c.execute({
    sql: `SELECT id, period FROM subscription_payments WHERE subscription_id = ? AND paid_at IS NULL ORDER BY period ASC LIMIT 1`,
    args: [subscriptionId],
  });
  const unpaid = unpaidRs.rows[0];
  if (!unpaid) return;

  await c.execute({
    sql: `UPDATE subscription_payments SET paid_at = ? WHERE id = ?`,
    args: [new Date().toISOString(), unpaid.id],
  });

  // Immediately roll the next month's due entry in, as requested.
  await ensurePeriodPayment(subscriptionId, due_day, nextPeriod(unpaid.period as string));
}

// The `IS NULL` guard makes this safe to call more than once for the same
// payment/kind (e.g. a cron retry) without overwriting an earlier timestamp.
export async function markReminderSent(
  paymentId: string,
  kind: "day_before" | "due_today"
): Promise<void> {
  const c = await db();
  const column = kind === "day_before" ? "reminder_day_before_sent_at" : "reminder_due_today_sent_at";
  await c.execute({
    sql: `UPDATE subscription_payments SET ${column} = ? WHERE id = ? AND ${column} IS NULL`,
    args: [new Date().toISOString(), paymentId],
  });
}

export async function deleteSubscription(subscriptionId: string, userId: string): Promise<void> {
  const c = await db();
  await c.batch(
    [
      {
        sql: `DELETE FROM subscription_payments WHERE subscription_id IN (SELECT id FROM subscriptions WHERE id = ? AND user_id = ?)`,
        args: [subscriptionId, userId],
      },
      { sql: `DELETE FROM subscriptions WHERE id = ? AND user_id = ?`, args: [subscriptionId, userId] },
    ],
    "write"
  );
}

/* Ensure tables exist */
// Schema is fixed once a warm serverless instance has run this once - the
// CREATE TABLE IF NOT EXISTS + 4 sequential ALTER TABLE round trips were
// re-running on every single subscriptions request, adding real latency
// for zero effect after the first call. Cache in-process instead.
let tablesEnsured = false;

export async function ensureTablesExist(): Promise<void> {
  if (tablesEnsured) return;
  const c = await db();
  await c.batch(
    [
      {
        sql: `CREATE TABLE IF NOT EXISTS subscriptions (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        name TEXT NOT NULL,
        amount REAL NOT NULL,
        due_day INTEGER NOT NULL,
        logo_url TEXT,
        created_at TEXT NOT NULL,
        FOREIGN KEY(user_id) REFERENCES users(id)
      )`,
      },
      {
        sql: `CREATE TABLE IF NOT EXISTS subscription_payments (
        id TEXT PRIMARY KEY,
        subscription_id TEXT NOT NULL,
        period TEXT NOT NULL,
        due_date TEXT NOT NULL,
        paid_at TEXT,
        created_at TEXT NOT NULL,
        FOREIGN KEY(subscription_id) REFERENCES subscriptions(id),
        UNIQUE(subscription_id, period)
      )`,
      },
    ],
    "write"
  );

  // Migration: earlier version of this table had a NOT NULL
  // next_payment_date column, which the new per-month payments model
  // replaced. Drop it on any DB created before this change so inserts
  // (which no longer supply that column) don't fail the constraint.
  try {
    await c.execute(`ALTER TABLE subscriptions DROP COLUMN next_payment_date`);
  } catch {
    // Column already gone (fresh DB) or DROP COLUMN unsupported - fine either way.
  }

  // Migration: "active" lets a subscription be paused (deactivated) without
  // losing its payment history, then reactivated later for audit purposes.
  try {
    await c.execute(`ALTER TABLE subscriptions ADD COLUMN active INTEGER NOT NULL DEFAULT 1`);
  } catch {
    // Column already exists.
  }

  // Migration: tracks whether the day-before/due-today WhatsApp reminder has
  // already gone out for this period, so the daily cron never double-sends.
  try {
    await c.execute(`ALTER TABLE subscription_payments ADD COLUMN reminder_day_before_sent_at TEXT`);
  } catch {
    // Column already exists.
  }
  try {
    await c.execute(`ALTER TABLE subscription_payments ADD COLUMN reminder_due_today_sent_at TEXT`);
  } catch {
    // Column already exists.
  }

  tablesEnsured = true;
}
