import { createClient, type Client } from "@libsql/client";
import { randomUUID } from "crypto";
import {
  CATEGORIES,
  canonicalCategory,
  isUnexplainedCategory,
  matchRuleCategory,
  normalizeVendor,
} from "@/lib/categorize";
import type { HealthUpdate, ModelHealth } from "@/lib/expense-parse";

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

/* ---------- schema versions ---------- */

// Each ensure*() below creates tables, columns and indexes with IF NOT EXISTS
// or try/catch, which is safe but costs a round trip per statement - over
// twenty on a fresh server instance before the first query could run. Once a
// set of statements has run, its version is recorded in app_meta, and later
// instances skip it after a single read. Bump a version when its DDL changes.
let metaLoad: Promise<Map<string, string>> | null = null;

function loadMeta(): Promise<Map<string, string>> {
  metaLoad ??= (async () => {
    const c = db();
    try {
      const rs = await c.execute("SELECT key, value FROM app_meta");
      return new Map(rs.rows.map((r) => [r.key as string, r.value as string]));
    } catch {
      await c.execute("CREATE TABLE IF NOT EXISTS app_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)");
      return new Map<string, string>();
    }
  })().catch((err) => {
    metaLoad = null;
    throw err;
  });
  return metaLoad;
}

async function schemaCurrent(name: string, version: string): Promise<boolean> {
  try {
    return (await loadMeta()).get(name) === version;
  } catch {
    return false;
  }
}

async function markSchema(name: string, version: string): Promise<void> {
  await db().execute({
    sql: "INSERT INTO app_meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
    args: [name, version],
  });
  (await loadMeta()).set(name, version);
}

// Date bounds for a month ("2026-09" up to "2026-10") or a year ("2026" up to
// "2027"). Compared as strings they select the same rows as LIKE '2026-09%',
// but let SQLite use the (user_id, expense_date) index for the whole range
// instead of reading every expense the user has.
function dateBounds(year: number, month?: number): [string, string] {
  if (month === undefined) return [String(year), String(year + 1)];
  const pad = (n: number) => String(n).padStart(2, "0");
  const to = month === 12 ? `${year + 1}-01` : `${year}-${pad(month + 1)}`;
  return [`${year}-${pad(month)}`, to];
}

/* ---------- users ---------- */

export type User = {
  id: string;
  username: string;
  name: string | null;
  password_hash: string;
  is_admin: boolean;
  created_at: string;
};

// Lazy migration for installations created before the "name" field existed -
// mirrors the ensureTablesExist() pattern used for subscriptions below.
// SELECT * against a DB missing this column simply omits it from the row
// (no error), so only writers (signup) need to call this first.
let nameColumnEnsured = false;
export async function ensureUserNameColumn(): Promise<void> {
  if (nameColumnEnsured) return;
  nameColumnEnsured = true;
  const c = await db();
  try {
    await c.execute(`ALTER TABLE users ADD COLUMN name TEXT`);
  } catch {
    // Column already exists.
  }
}

/* ---------- login throttling ---------- */

// Wrong passwords per username in a rolling window. After this many, logins
// for that username are refused until the window has passed.
const LOGIN_MAX_FAILURES = 10;
const LOGIN_WINDOW_MS = 15 * 60_000;
let loginTableEnsured = false;

async function ensureLoginAttemptsTable(): Promise<void> {
  if (loginTableEnsured) return;
  if (await schemaCurrent("login_failures", "1")) {
    loginTableEnsured = true;
    return;
  }
  const c = await db();
  await c.execute(`CREATE TABLE IF NOT EXISTS login_failures (
    username TEXT PRIMARY KEY,
    count INTEGER NOT NULL,
    first_at INTEGER NOT NULL
  )`);
  await markSchema("login_failures", "1");
  loginTableEnsured = true;
}

export async function loginLocked(username: string): Promise<boolean> {
  await ensureLoginAttemptsTable();
  const c = await db();
  const rs = await c.execute({ sql: "SELECT count, first_at FROM login_failures WHERE username = ?", args: [username.toLowerCase()] });
  const r = rs.rows[0];
  if (!r) return false;
  return Number(r.count) >= LOGIN_MAX_FAILURES && Date.now() - Number(r.first_at) < LOGIN_WINDOW_MS;
}

export async function recordLoginFailure(username: string): Promise<void> {
  await ensureLoginAttemptsTable();
  const c = await db();
  const now = Date.now();
  // A failure after the window has passed starts a fresh count.
  await c.execute({
    sql: `INSERT INTO login_failures (username, count, first_at) VALUES (?, 1, ?)
          ON CONFLICT(username) DO UPDATE SET
            count = CASE WHEN ? - first_at >= ? THEN 1 ELSE count + 1 END,
            first_at = CASE WHEN ? - first_at >= ? THEN ? ELSE first_at END`,
    args: [username.toLowerCase(), now, now, LOGIN_WINDOW_MS, now, LOGIN_WINDOW_MS, now],
  });
}

export async function clearLoginFailures(username: string): Promise<void> {
  await ensureLoginAttemptsTable();
  const c = await db();
  await c.execute({ sql: "DELETE FROM login_failures WHERE username = ?", args: [username.toLowerCase()] });
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
    password_hash: r.password_hash as string,
    is_admin: Number(r.is_admin) === 1,
    created_at: r.created_at as string,
  };
}

// Email reminders: where to send them, whether they're on, and a log of what
// has been sent so a retried daily job never sends the same reminder twice.
let emailColumnsEnsured = false;
const EMAIL_SCHEMA = "1";
export async function ensureUserEmailColumns(): Promise<void> {
  if (emailColumnsEnsured) return;
  if (await schemaCurrent("user_email", EMAIL_SCHEMA)) {
    emailColumnsEnsured = true;
    return;
  }
  await ensureUserNameColumn();
  const c = await db();
  for (const sql of [
    `ALTER TABLE users ADD COLUMN email TEXT`,
    `ALTER TABLE users ADD COLUMN email_reminders INTEGER NOT NULL DEFAULT 1`,
  ]) {
    try {
      await c.execute(sql);
    } catch {
      // Column already exists.
    }
  }
  await c.execute(`CREATE TABLE IF NOT EXISTS reminder_log (
    user_id TEXT NOT NULL,
    item TEXT NOT NULL,
    sent_at TEXT NOT NULL,
    PRIMARY KEY (user_id, item)
  )`);
  await markSchema("user_email", EMAIL_SCHEMA);
  emailColumnsEnsured = true;
}

export type ProfileSettings = { name: string; email: string | null; emailReminders: boolean };

export async function getProfileSettings(userId: string): Promise<ProfileSettings | null> {
  await ensureUserEmailColumns();
  const c = await db();
  const rs = await c.execute({ sql: "SELECT name, email, email_reminders FROM users WHERE id = ?", args: [userId] });
  const r = rs.rows[0];
  if (!r) return null;
  return {
    name: (r.name as string) ?? "",
    email: (r.email as string) ?? null,
    emailReminders: Number(r.email_reminders ?? 1) === 1,
  };
}

export async function updateUserProfile(
  userId: string,
  fields: { name?: string; email?: string | null; emailReminders?: boolean }
): Promise<void> {
  await ensureUserEmailColumns();
  const sets: string[] = [];
  const args: (string | number | null)[] = [];
  if (fields.name !== undefined) {
    sets.push("name = ?");
    args.push(fields.name || null);
  }
  if (fields.email !== undefined) {
    sets.push("email = ?");
    args.push(fields.email || null);
  }
  if (fields.emailReminders !== undefined) {
    sets.push("email_reminders = ?");
    args.push(fields.emailReminders ? 1 : 0);
  }
  if (!sets.length) return;
  const c = await db();
  await c.execute({ sql: `UPDATE users SET ${sets.join(", ")} WHERE id = ?`, args: [...args, userId] });
}

export type ReminderRecipient = { id: string; username: string; name: string | null; email: string };

export async function listReminderRecipients(): Promise<ReminderRecipient[]> {
  await ensureUserEmailColumns();
  const c = await db();
  const rs = await c.execute(
    "SELECT id, username, name, email FROM users WHERE email IS NOT NULL AND email <> '' AND email_reminders = 1"
  );
  return rs.rows.map((r) => ({
    id: r.id as string,
    username: r.username as string,
    name: (r.name as string) ?? null,
    email: r.email as string,
  }));
}

// The reminder keys from `items` that haven't been sent to this user yet.
export async function unsentReminders(userId: string, items: string[]): Promise<Set<string>> {
  if (!items.length) return new Set();
  await ensureUserEmailColumns();
  const c = await db();
  const rs = await c.execute({
    sql: `SELECT item FROM reminder_log WHERE user_id = ? AND item IN (${items.map(() => "?").join(",")})`,
    args: [userId, ...items],
  });
  const sent = new Set(rs.rows.map((r) => r.item as string));
  return new Set(items.filter((i) => !sent.has(i)));
}

export async function markRemindersSent(userId: string, items: string[]): Promise<void> {
  if (!items.length) return;
  const c = await db();
  const now = new Date().toISOString();
  await c.batch(
    items.map((item) => ({
      sql: "INSERT OR IGNORE INTO reminder_log (user_id, item, sent_at) VALUES (?, ?, ?)",
      args: [userId, item, now],
    })),
    "write"
  );
}

// Everyone the daily job runs for.
export async function listUserIds(): Promise<string[]> {
  const c = await db();
  const rs = await c.execute("SELECT id FROM users");
  return rs.rows.map((r) => r.id as string);
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

// Removes an account and everything it owns, in one batch: if any statement
// fails, nothing is deleted. subscriptions references users, so the account
// row has to go last - deleting it before the subscriptions is what made
// deleting anyone with a subscription fail with a foreign-key error.
export async function deleteUser(id: string): Promise<void> {
  // Every table the batch touches must exist, even on a database that has
  // never used reminders or the assistant.
  await Promise.all([
    ensureTablesExist(),
    ensureCategoryTables(),
    ensureUserEmailColumns(),
    ensureFeedbackTable(),
    ensureLoginAttemptsTable(),
  ]);
  const user = await findUserById(id);
  const c = await db();
  await c.batch(
    [
      {
        sql: `DELETE FROM transactions WHERE person_id IN (SELECT id FROM people WHERE user_id = ?)`,
        args: [id],
      },
      { sql: "DELETE FROM people WHERE user_id = ?", args: [id] },
      { sql: "DELETE FROM expenses WHERE user_id = ?", args: [id] },
      {
        sql: `DELETE FROM subscription_payments WHERE subscription_id IN (SELECT id FROM subscriptions WHERE user_id = ?)`,
        args: [id],
      },
      { sql: "DELETE FROM subscriptions WHERE user_id = ?", args: [id] },
      { sql: "DELETE FROM expense_categories WHERE user_id = ?", args: [id] },
      { sql: "DELETE FROM expense_vendor_rules WHERE user_id = ?", args: [id] },
      { sql: "DELETE FROM whatsapp_inbound WHERE user_id = ?", args: [id] },
      { sql: "DELETE FROM reminder_log WHERE user_id = ?", args: [id] },
      { sql: "DELETE FROM assistant_feedback WHERE user_id = ?", args: [id] },
      ...(user ? [{ sql: "DELETE FROM login_failures WHERE username = ?", args: [user.username.toLowerCase()] }] : []),
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
  const filter = opts.category ? categoryFilter(opts.category) : { sql: "", args: [] };
  const rs = await c.execute({
    sql: `SELECT * FROM expenses WHERE user_id = ? AND expense_date >= ? AND expense_date < ?${filter.sql} ORDER BY expense_date DESC, created_at DESC`,
    args: [userId, ...dateBounds(opts.year, opts.month), ...filter.args],
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
  const rs = await c.execute({
    sql: `SELECT COALESCE(NULLIF(TRIM(category), ''), ?) AS category,
                 SUM(amount) AS total,
                 COUNT(*) AS count
          FROM expenses
          WHERE user_id = ? AND expense_date >= ? AND expense_date < ?
          GROUP BY category
          ORDER BY total DESC`,
    args: [UNCATEGORISED, userId, ...dateBounds(opts.year, opts.month)],
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
    sql: `SELECT id FROM expenses WHERE user_id = ? AND category = 'Subscriptions' AND expense_date >= ? AND expense_date < ?`,
    args: [userId, ...dateBounds(year, month)],
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

/* ---------- expense categorisation ----------
 * See src/lib/categorize.ts for the deterministic half. This half holds the
 * two layers that need the database: per-vendor rules the user has taught by
 * setting a category by hand, and the category they've historically used most
 * for the same vendor.
 */

let categoryTablesEnsured = false;

const CATEGORY_SCHEMA = "2";
export async function ensureCategoryTables(): Promise<void> {
  if (categoryTablesEnsured) return;
  if (await schemaCurrent("category_tables", CATEGORY_SCHEMA)) {
    categoryTablesEnsured = true;
    return;
  }
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
  // Indexes behind the queries every expenses page makes. scripts/migrate-db.mjs
  // creates two of these, but that script is run by hand - creating them here
  // as well means a database that never had it run still gets them, and
  // IF NOT EXISTS makes the repeat harmless. Without these, listing a month
  // scans the whole expenses table and sorts it.
  for (const sql of [
    `CREATE INDEX IF NOT EXISTS idx_expenses_vendor_key ON expenses (user_id, vendor_key)`,
    `CREATE INDEX IF NOT EXISTS idx_expenses_user_date ON expenses (user_id, expense_date)`,
    `CREATE INDEX IF NOT EXISTS idx_expenses_user_category ON expenses (user_id, category)`,
    // Every balance sums a person's transactions; without this SQLite built a
    // temporary index on each /api/people request.
    `CREATE INDEX IF NOT EXISTS idx_transactions_person ON transactions (person_id, created_at)`,
    `CREATE INDEX IF NOT EXISTS idx_people_user ON people (user_id)`,
  ]) {
    try {
      await c.execute(sql);
    } catch {
      // Index already exists, or the column it covers predates this build.
    }
  }
  // One row per assistant message. The table keeps the name it had when
  // messages also arrived on WhatsApp - renaming a live table isn't worth the
  // risk. The primary key stops a retried message being processed twice, and
  // the columns record what each message changed, for UNDO.
  await c.execute(`CREATE TABLE IF NOT EXISTS whatsapp_inbound (
    message_id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    expense_id TEXT,
    created_at TEXT NOT NULL
  )`);
  try {
    await c.execute(
      `CREATE INDEX IF NOT EXISTS idx_whatsapp_inbound_user ON whatsapp_inbound (user_id, created_at)`
    );
  } catch {
    // Index already exists.
  }
  // Udhar Khata transactions a message created, as a JSON array of ids.
  try {
    await c.execute(`ALTER TABLE whatsapp_inbound ADD COLUMN tx_ids TEXT`);
  } catch {
    // Column already exists.
  }
  // People a message added to Udhar Khata, so UNDO can remove them again.
  try {
    await c.execute(`ALTER TABLE whatsapp_inbound ADD COLUMN person_ids TEXT`);
  } catch {
    // Column already exists.
  }
  // Values a message changed, saved beforehand so UNDO can put them back.
  try {
    await c.execute(`ALTER TABLE whatsapp_inbound ADD COLUMN undo_json TEXT`);
  } catch {
    // Column already exists.
  }
  // The finished reply for an in-app message, which the page fetches once it's
  // ready rather than holding one long request open.
  try {
    await c.execute(`ALTER TABLE whatsapp_inbound ADD COLUMN reply TEXT`);
  } catch {
    // Column already exists.
  }
  // Which Gemini models have been answering. Shared across server instances,
  // so a model found overloaded on one request is skipped on the next even
  // when Vercel runs it somewhere else. Times are epoch milliseconds.
  await c.execute(`CREATE TABLE IF NOT EXISTS ai_model_health (
    model TEXT PRIMARY KEY,
    busy_until INTEGER NOT NULL DEFAULT 0,
    last_ok_at INTEGER NOT NULL DEFAULT 0,
    last_ms INTEGER,
    updated_at INTEGER NOT NULL
  )`);
  await markSchema("category_tables", CATEGORY_SCHEMA);
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
      // Alphabetical: this list is scanned to find a known name, so seed order
      // just makes it a hunt. The breakdown chart stays sorted by amount,
      // since there the question is what costs most, not where a name sits.
      sql: `SELECT name, keywords FROM expense_categories WHERE user_id = ? ORDER BY name COLLATE NOCASE ASC`,
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

  // A category that only means "don't know" - "Transfer", "Other", "Misc" -
  // is not a category, it is an unanswered question. Drop any that are still
  // on the list from an earlier version so they stop being pickable.
  const stale = rs.rows.filter((r) => isUnexplainedCategory(r.name as string));
  if (stale.length > 0) {
    await c.batch(
      stale.map((r) => ({
        sql: `DELETE FROM expense_categories WHERE user_id = ? AND name = ?`,
        args: [userId, r.name as string],
      })),
      "write"
    );
  }

  return rs.rows
    .filter((r) => !isUnexplainedCategory(r.name as string))
    .map((r) => ({
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
};

export type SubscriptionWithStatus = Subscription & {
  current_period: string;
  current_due_date: string;
  current_payment_id: string;
  paid_this_period: boolean;
  status: "paid" | "due-today" | "due-soon" | "upcoming" | "inactive";
  history: PaymentRecord[];
};

// Dates in Pakistan time. UTC (what these used to return) is five hours
// behind, so between midnight and 5am subscriptions showed yesterday's status
// and the month rolled over five hours late.
const pkDate = (ms: number) => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Karachi" }).format(new Date(ms));

function currentPeriodStr(): string {
  return pkDate(Date.now()).slice(0, 7);
}

export function todayYMD(): string {
  return pkDate(Date.now());
}

export function tomorrowYMD(): string {
  return pkDate(Date.now() + 24 * 60 * 60 * 1000);
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
  const soon = pkDate(Date.now() + 7 * 24 * 60 * 60 * 1000);
  const ids = rs.rows.map((r) => r.id as string);

  // One read for every subscription's history. This month's payment row is
  // only written when it's missing - about once a month per subscription -
  // instead of an INSERT OR IGNORE batch on every page load.
  const loadHistory = async () => {
    const histRs = await c.execute({
      sql: `SELECT id, subscription_id, period, due_date, paid_at
            FROM subscription_payments WHERE subscription_id IN (${ids.map(() => "?").join(",")}) ORDER BY period DESC`,
      args: ids,
    });
    const bySub = new Map<string, PaymentRecord[]>();
    for (const h of histRs.rows) {
      const subId = h.subscription_id as string;
      const list = bySub.get(subId) ?? [];
      list.push({
        id: h.id as string,
        period: h.period as string,
        due_date: h.due_date as string,
        paid_at: (h.paid_at as string) ?? null,
      });
      bySub.set(subId, list);
    }
    return bySub;
  };

  let historyBySub = await loadHistory();
  const missing = rs.rows.filter(
    (r) => Number(r.active ?? 1) === 1 && !(historyBySub.get(r.id as string) ?? []).some((h) => h.period === period)
  );
  if (missing.length > 0) {
    await c.batch(
      missing.map((r) => ({
        sql: `INSERT OR IGNORE INTO subscription_payments (id, subscription_id, period, due_date, paid_at, created_at)
              VALUES (?, ?, ?, ?, NULL, ?)`,
        args: [randomUUID(), r.id as string, period, clampedDateForPeriod(period, Number(r.due_day)), new Date().toISOString()],
      })),
      "write"
    );
    historyBySub = await loadHistory();
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

const SUBSCRIPTION_SCHEMA = "1";
export async function ensureTablesExist(): Promise<void> {
  if (tablesEnsured) return;
  if (await schemaCurrent("subscription_tables", SUBSCRIPTION_SCHEMA)) {
    tablesEnsured = true;
    return;
  }
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

  // Columns left from the retired WhatsApp reminders. Kept so older databases
  // and restored payment rows stay consistent.
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

  // Every subscriptions read filters by user_id; subscription_payments is
  // already covered by its UNIQUE(subscription_id, period) constraint.
  try {
    await c.execute(`CREATE INDEX IF NOT EXISTS idx_subscriptions_user ON subscriptions (user_id)`);
  } catch {
    // Index already exists.
  }

  await markSchema("subscription_tables", SUBSCRIPTION_SCHEMA);
  tablesEnsured = true;
}

/* ---------- expense writes shared by the app and the assistant ---------- */

// The one place an expense row is written, used by POST /api/expenses and by
// the assistant, so both store dates and vendor keys the same way.
export async function insertExpense(opts: {
  userId: string;
  amount: number;
  note: string;
  expenseDateTime: string;
  vendor: string | null;
  category: string | null;
  vendorKey: string | null;
}): Promise<string> {
  const c = await db();
  const id = randomUUID();
  await c.execute({
    sql: "INSERT INTO expenses (id, user_id, amount, note, expense_date, expense_datetime, created_at, vendor, category, vendor_key) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
    args: [
      id,
      opts.userId,
      opts.amount,
      opts.note,
      opts.expenseDateTime.substring(0, 10),
      opts.expenseDateTime,
      new Date().toISOString(),
      opts.vendor,
      opts.category,
      opts.vendorKey || null,
    ],
  });
  return id;
}

/* ---------- assistant messages ---------- */

// True only for the first delivery of a message id; a redelivery returns false.
export async function claimInboundMessage(messageId: string, userId: string): Promise<boolean> {
  await ensureCategoryTables();
  const c = await db();
  const rs = await c.execute({
    sql: "INSERT OR IGNORE INTO whatsapp_inbound (message_id, user_id, created_at) VALUES (?, ?, ?)",
    args: [messageId, userId, new Date().toISOString()],
  });
  return rs.rowsAffected === 1;
}

export async function attachInboundExpense(messageId: string, expenseId: string): Promise<void> {
  const c = await db();
  await c.execute({
    sql: "UPDATE whatsapp_inbound SET expense_id = ? WHERE message_id = ?",
    args: [expenseId, messageId],
  });
}

export async function attachInboundTransactions(
  messageId: string,
  txIds: string[],
  personIds: string[] = []
): Promise<void> {
  const c = await db();
  await c.execute({
    sql: "UPDATE whatsapp_inbound SET tx_ids = ?, person_ids = ? WHERE message_id = ?",
    args: [JSON.stringify(txIds), JSON.stringify(personIds), messageId],
  });
}

function idList(raw: unknown): string[] {
  try {
    const parsed = JSON.parse((raw as string) ?? "[]");
    return Array.isArray(parsed) ? parsed.filter((x): x is string => typeof x === "string") : [];
  } catch {
    return [];
  }
}

// Rows as stored, kept whole inside undo steps so a delete can be reversed exactly.
export type ExpenseRow = {
  id: string;
  user_id: string;
  amount: number;
  note: string;
  expense_date: string;
  expense_datetime: string;
  created_at: string;
  vendor: string | null;
  category: string | null;
  vendor_key: string | null;
};
export type SubscriptionRow = {
  id: string;
  user_id: string;
  name: string;
  amount: number;
  due_day: number;
  logo_url: string | null;
  active: number;
  created_at: string;
};
export type PaymentRow = {
  id: string;
  subscription_id: string;
  period: string;
  due_date: string;
  paid_at: string | null;
  created_at: string;
  reminder_day_before_sent_at: string | null;
  reminder_due_today_sent_at: string | null;
};
export type PersonRow = { id: string; name: string; created_at: string; user_id: string; due_date: string | null };
export type TxRow = { id: string; person_id: string; amount: number; note: string; created_at: string };
export type CategoryRow = { name: string; keywords: string | null; sort_order: number; created_at: string };
export type RuleRow = { vendor_key: string; category: string; updated_at: string };

// How to put back something an assistant message changed, rather than added.
// Written before the change, so UNDO restores exactly what was there.
export type UndoStep =
  | { op: "set_due_date"; personId: string; name: string; dueDate: string | null }
  | { op: "restore_expense"; row: ExpenseRow }
  | { op: "revert_expense"; before: ExpenseRow; rule: { vendorKey: string; category: string | null } | null }
  | { op: "remove_subscription"; id: string; name: string }
  | { op: "restore_subscription"; sub: SubscriptionRow; payments: PaymentRow[] }
  | { op: "revert_subscription"; before: SubscriptionRow }
  | { op: "unmark_paid"; name: string; paymentId: string; addedPaymentId: string | null }
  | { op: "rename_person"; personId: string; name: string; renamedTo: string }
  | { op: "restore_person"; person: PersonRow; transactions: TxRow[] }
  | { op: "remove_category"; name: string }
  | { op: "rename_category"; from: string; to: string }
  | { op: "restore_category"; category: CategoryRow; expenseIds: string[]; rules: RuleRow[] }
  | { op: "set_category_keywords"; name: string; keywords: string | null }
  | { op: "remove_expense"; id: string; amount: number; vendor: string | null }
  | { op: "set_email_reminders"; on: boolean };

const UNDO_OPS = new Set<string>([
  "set_due_date",
  "restore_expense",
  "revert_expense",
  "remove_subscription",
  "restore_subscription",
  "revert_subscription",
  "unmark_paid",
  "rename_person",
  "restore_person",
  "remove_category",
  "rename_category",
  "restore_category",
  "set_category_keywords",
  "remove_expense",
  "set_email_reminders",
]);

// Undo steps are written only by this app, so a known op is trusted as shaped.
function parseUndoSteps(raw: unknown): UndoStep[] {
  try {
    const parsed = JSON.parse((raw as string) ?? "[]");
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((step): step is UndoStep => typeof step?.op === "string" && UNDO_OPS.has(step.op));
  } catch {
    return [];
  }
}

export async function attachInboundUndo(messageId: string, steps: UndoStep[]): Promise<void> {
  const c = await db();
  await c.execute({
    sql: "UPDATE whatsapp_inbound SET undo_json = ? WHERE message_id = ?",
    args: [JSON.stringify(steps), messageId],
  });
}

export type UndoResult = {
  expense: { amount: number; vendor: string | null } | null;
  transactions: { name: string; amount: number }[];
  peopleRemoved: string[];
  steps: UndoStep[];
};

// Reverses the most recent thing the assistant added or changed in the last
// 24 hours. Scoped to the assistant on purpose: UNDO never reaches into
// something added on the app's own pages or imported from a bank email.
// Anything already deleted in the app is skipped, and a person the message
// added is only removed if nothing else has been recorded against them since.
export async function undoLastAssistantEntry(userId: string): Promise<UndoResult | null> {
  await ensureCategoryTables();
  const c = await db();
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const rs = await c.execute({
    sql: `SELECT message_id, expense_id, tx_ids, person_ids, undo_json FROM whatsapp_inbound
          WHERE user_id = ? AND created_at >= ?
            AND (expense_id IS NOT NULL
                 OR (tx_ids IS NOT NULL AND tx_ids != '[]')
                 OR (person_ids IS NOT NULL AND person_ids != '[]')
                 OR (undo_json IS NOT NULL AND undo_json != '[]'))
          ORDER BY created_at DESC LIMIT 1`,
    args: [userId, since],
  });
  const row = rs.rows[0];
  if (!row) return null;

  const txIds = idList(row.tx_ids);
  const personIds = idList(row.person_ids);
  const undoSteps = parseUndoSteps(row.undo_json);
  const placeholders = (n: number) => Array.from({ length: n }, () => "?").join(", ");

  const expenseId = (row.expense_id as string) ?? null;
  const expenseRs = expenseId
    ? await c.execute({
        sql: "SELECT amount, vendor FROM expenses WHERE id = ? AND user_id = ?",
        args: [expenseId, userId],
      })
    : null;
  const txRs = txIds.length
    ? await c.execute({
        sql: `SELECT t.id, t.amount, p.name FROM transactions t JOIN people p ON p.id = t.person_id
              WHERE p.user_id = ? AND t.id IN (${placeholders(txIds.length)})`,
        args: [userId, ...txIds],
      })
    : null;
  // A person counts as removable only if every transaction they have is one
  // this UNDO is about to delete.
  const peopleRs = personIds.length
    ? await c.execute({
        sql: `SELECT p.id, p.name,
                (SELECT COUNT(*) FROM transactions t
                 WHERE t.person_id = p.id${txIds.length ? ` AND t.id NOT IN (${placeholders(txIds.length)})` : ""}) AS others
              FROM people p WHERE p.user_id = ? AND p.id IN (${placeholders(personIds.length)})`,
        args: [...txIds, userId, ...personIds],
      })
    : null;

  const expenseRow = expenseRs?.rows[0];
  const txRows = txRs?.rows ?? [];
  const removablePeople = (peopleRs?.rows ?? []).filter((p) => Number(p.others) === 0);

  const statements: { sql: string; args: (string | number | null)[] }[] = [
    {
      sql: "UPDATE whatsapp_inbound SET expense_id = NULL, tx_ids = NULL, person_ids = NULL, undo_json = NULL WHERE message_id = ?",
      args: [row.message_id as string],
    },
  ];
  if (expenseRow && expenseId) {
    statements.push({ sql: "DELETE FROM expenses WHERE id = ? AND user_id = ?", args: [expenseId, userId] });
  }
  for (const t of txRows) {
    statements.push({ sql: "DELETE FROM transactions WHERE id = ?", args: [t.id as string] });
  }
  // Runs after the transaction deletes in the same batch, and re-checks that
  // nothing new was recorded against the person in the meantime.
  for (const p of removablePeople) {
    statements.push({
      sql: `DELETE FROM people WHERE id = ? AND user_id = ?
            AND NOT EXISTS (SELECT 1 FROM transactions WHERE person_id = ?)`,
      args: [p.id as string, userId, p.id as string],
    });
  }
  // Anything the message changed rather than added, put back as it was.
  statements.push(...undoStatements(userId, undoSteps));
  await c.batch(statements, "write");

  if (!expenseRow && !txRows.length && !removablePeople.length && !undoSteps.length) return null;
  return {
    expense: expenseRow
      ? { amount: Number(expenseRow.amount), vendor: (expenseRow.vendor as string) ?? null }
      : null,
    transactions: txRows.map((t) => ({ name: t.name as string, amount: Number(t.amount) })),
    peopleRemoved: removablePeople.map((p) => p.name as string),
    steps: undoSteps,
  };
}

/* ---------- assistant feedback ---------- */

// Suggestions people give the assistant, and messages it couldn't handle -
// the list to improve it from. Shown to admins on the Admin page.
let feedbackTableEnsured = false;
async function ensureFeedbackTable(): Promise<void> {
  if (feedbackTableEnsured) return;
  if (await schemaCurrent("assistant_feedback", "1")) {
    feedbackTableEnsured = true;
    return;
  }
  const c = await db();
  await c.execute(`CREATE TABLE IF NOT EXISTS assistant_feedback (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    kind TEXT NOT NULL,
    text TEXT NOT NULL,
    created_at TEXT NOT NULL
  )`);
  await markSchema("assistant_feedback", "1");
  feedbackTableEnsured = true;
}

export type AssistantFeedback = {
  id: string;
  username: string;
  kind: "suggestion" | "not_understood";
  text: string;
  created_at: string;
};

export async function recordAssistantFeedback(
  userId: string,
  kind: AssistantFeedback["kind"],
  text: string
): Promise<void> {
  await ensureFeedbackTable();
  const c = await db();
  await c.execute({
    sql: "INSERT INTO assistant_feedback (id, user_id, kind, text, created_at) VALUES (?, ?, ?, ?, ?)",
    args: [randomUUID(), userId, kind, text.slice(0, 500), new Date().toISOString()],
  });
}

export async function listAssistantFeedback(limit = 100): Promise<AssistantFeedback[]> {
  await ensureFeedbackTable();
  const c = await db();
  const rs = await c.execute({
    sql: `SELECT f.id, COALESCE(u.username, 'deleted user') AS username, f.kind, f.text, f.created_at
          FROM assistant_feedback f LEFT JOIN users u ON u.id = f.user_id
          ORDER BY f.created_at DESC LIMIT ?`,
    args: [limit],
  });
  return rs.rows.map((r) => ({
    id: r.id as string,
    username: r.username as string,
    kind: r.kind === "suggestion" ? "suggestion" : "not_understood",
    text: r.text as string,
    created_at: r.created_at as string,
  }));
}

// Deletes one item, or all of them when no id is given.
export async function deleteAssistantFeedback(id?: string): Promise<void> {
  await ensureFeedbackTable();
  const c = await db();
  if (id) await c.execute({ sql: "DELETE FROM assistant_feedback WHERE id = ?", args: [id] });
  else await c.execute("DELETE FROM assistant_feedback");
}

/* ---------- Udhar Khata from the assistant ---------- */

export type LedgerPerson = {
  id: string;
  name: string;
  balance: number;
  lent: number;
  received: number;
  dueDate: string | null;
};

export async function listLedgerPeople(userId: string): Promise<LedgerPerson[]> {
  return (await listPeople(userId)).map((p) => ({
    id: p.id,
    name: p.name,
    balance: p.balance,
    lent: p.lent,
    received: p.received,
    dueDate: p.due_date,
  }));
}

export type LedgerWrite =
  | { personId: string; amount: number }
  | { newName: string; amount: number };

// Same rows the Udhar Khata page writes: a positive amount is money lent, a
// negative one is money paid back, and a new person gets a people row plus
// their first transaction, as adding a borrower in the app does. Inserts for
// existing people only happen if the person belongs to this user, checked in
// the same statement, and everything for one message is one batch.
export async function writeLedgerEntries(
  userId: string,
  entries: LedgerWrite[],
  note: string
): Promise<{ txIds: string[]; createdPeople: string[] }> {
  if (!entries.length) return { txIds: [], createdPeople: [] };
  const c = await db();
  const now = new Date().toISOString();
  const statements: { sql: string; args: (string | number)[] }[] = [];
  const txIds: string[] = [];
  const txStatement: number[] = [];
  const createdPeople: string[] = [];

  for (const e of entries) {
    const txId = randomUUID();
    txIds.push(txId);
    if ("newName" in e) {
      const personId = randomUUID();
      createdPeople.push(personId);
      statements.push({
        sql: "INSERT INTO people (id, name, created_at, user_id, due_date) VALUES (?, ?, ?, ?, NULL)",
        args: [personId, e.newName, now, userId],
      });
      statements.push({
        sql: "INSERT INTO transactions (id, person_id, amount, note, created_at) VALUES (?, ?, ?, ?, ?)",
        args: [txId, personId, e.amount, note, now],
      });
    } else {
      statements.push({
        sql: `INSERT INTO transactions (id, person_id, amount, note, created_at)
              SELECT ?, id, ?, ?, ? FROM people WHERE id = ? AND user_id = ?`,
        args: [txId, e.amount, note, now, e.personId, userId],
      });
    }
    txStatement.push(statements.length - 1);
  }

  const results = await c.batch(statements, "write");
  return {
    txIds: txIds.filter((_, i) => results[txStatement[i]]?.rowsAffected === 1),
    createdPeople,
  };
}

/* ---------- AI model health ---------- */

export async function loadModelHealth(): Promise<Map<string, ModelHealth>> {
  await ensureCategoryTables();
  const c = await db();
  const rs = await c.execute("SELECT model, busy_until, last_ok_at FROM ai_model_health");
  return new Map(
    rs.rows.map((r) => [
      r.model as string,
      { busyUntil: Number(r.busy_until), lastOkAt: Number(r.last_ok_at) },
    ])
  );
}

// Applied in order, so when one message tried the same model twice the later
// result is the one kept. A success clears any cooldown; a failure keeps the
// time of the model's last success, which is what puts it first again once
// it recovers.
export async function saveModelHealth(updates: HealthUpdate[]): Promise<void> {
  if (!updates.length) return;
  await ensureCategoryTables();
  const c = await db();
  const now = Date.now();
  await c.batch(
    updates.map((u) =>
      u.ok
        ? {
            sql: `INSERT INTO ai_model_health (model, busy_until, last_ok_at, last_ms, updated_at)
                  VALUES (?, 0, ?, ?, ?)
                  ON CONFLICT(model) DO UPDATE SET busy_until = 0, last_ok_at = excluded.last_ok_at,
                    last_ms = excluded.last_ms, updated_at = excluded.updated_at`,
            args: [u.model, now, u.ms, now],
          }
        : {
            sql: `INSERT INTO ai_model_health (model, busy_until, last_ok_at, last_ms, updated_at)
                  VALUES (?, ?, 0, ?, ?)
                  ON CONFLICT(model) DO UPDATE SET busy_until = excluded.busy_until,
                    last_ms = excluded.last_ms, updated_at = excluded.updated_at`,
            args: [u.model, u.busyUntil, u.ms, now],
          }
    ),
    "write"
  );
}

/* ---------- reads and small writes for assistant questions ---------- */

// Udhar Khata entries made in a time window (ISO timestamps, end exclusive),
// oldest first, with the person's name - for the daily recap email.
export async function listLedgerActivity(
  userId: string,
  fromIso: string,
  toIso: string
): Promise<{ name: string; amount: number; created_at: string }[]> {
  const c = await db();
  const rs = await c.execute({
    sql: `SELECT p.name, t.amount, t.created_at FROM transactions t
          JOIN people p ON p.id = t.person_id
          WHERE p.user_id = ? AND t.created_at >= ? AND t.created_at < ?
          ORDER BY t.created_at ASC`,
    args: [userId, fromIso, toIso],
  });
  return rs.rows.map((r) => ({ name: r.name as string, amount: Number(r.amount), created_at: r.created_at as string }));
}

// Expenses between two days, inclusive (YYYY-MM-DD), newest first.
export async function listExpensesInRange(userId: string, from: string, to: string): Promise<Expense[]> {
  const c = await db();
  const rs = await c.execute({
    sql: "SELECT * FROM expenses WHERE user_id = ? AND expense_date >= ? AND expense_date <= ? ORDER BY expense_date DESC, created_at DESC",
    args: [userId, from, to],
  });
  return rs.rows.map(rowToExpense);
}

export async function listRecentExpenses(userId: string, limit: number): Promise<Expense[]> {
  const c = await db();
  const rs = await c.execute({
    sql: "SELECT * FROM expenses WHERE user_id = ? ORDER BY expense_date DESC, created_at DESC LIMIT ?",
    args: [userId, limit],
  });
  return rs.rows.map(rowToExpense);
}

// Sets or clears a person's due date, only if they belong to this user.
// Returns the value it replaced, so the change can be undone - or null when
// the person isn't theirs.
export async function setPersonDueDate(
  userId: string,
  personId: string,
  dueDate: string | null
): Promise<{ previous: string | null } | null> {
  const c = await db();
  const rs = await c.execute({
    sql: "SELECT due_date FROM people WHERE id = ? AND user_id = ?",
    args: [personId, userId],
  });
  const row = rs.rows[0];
  if (!row) return null;
  await c.execute({
    sql: "UPDATE people SET due_date = ? WHERE id = ? AND user_id = ?",
    args: [dueDate, personId, userId],
  });
  return { previous: (row.due_date as string) ?? null };
}

/* ---------- in-app assistant replies ---------- */

export async function saveInboundReply(messageId: string, reply: string): Promise<void> {
  const c = await db();
  await c.execute({
    sql: "UPDATE whatsapp_inbound SET reply = ? WHERE message_id = ?",
    args: [reply, messageId],
  });
}

// null when the message doesn't exist or isn't this user's; reply is null
// while it is still being worked on.
export async function getInboundReply(
  messageId: string,
  userId: string
): Promise<{ reply: string | null } | null> {
  await ensureCategoryTables();
  const c = await db();
  const rs = await c.execute({
    sql: "SELECT reply FROM whatsapp_inbound WHERE message_id = ? AND user_id = ?",
    args: [messageId, userId],
  });
  const row = rs.rows[0];
  return row ? { reply: (row.reply as string) ?? null } : null;
}

/* ---------- undo: putting changed things back ---------- */

type Statement = { sql: string; args: (string | number | null)[] };

// The statements that reverse each step, in order. Every one is scoped to the
// user, so a step can never touch someone else's data.
export function undoStatements(userId: string, steps: UndoStep[]): Statement[] {
  const out: Statement[] = [];
  const now = new Date().toISOString();
  for (const step of steps) {
    switch (step.op) {
      case "set_due_date":
        out.push({
          sql: "UPDATE people SET due_date = ? WHERE id = ? AND user_id = ?",
          args: [step.dueDate, step.personId, userId],
        });
        break;

      case "restore_expense": {
        const r = step.row;
        if (r.user_id !== userId) break;
        out.push({
          sql: `INSERT OR IGNORE INTO expenses (id, user_id, amount, note, expense_date, expense_datetime, created_at, vendor, category, vendor_key)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          args: [r.id, r.user_id, r.amount, r.note, r.expense_date, r.expense_datetime, r.created_at, r.vendor, r.category, r.vendor_key],
        });
        break;
      }

      case "revert_expense": {
        const b = step.before;
        out.push({
          sql: `UPDATE expenses SET amount = ?, note = ?, expense_date = ?, expense_datetime = ?, vendor = ?, category = ?, vendor_key = ?
                WHERE id = ? AND user_id = ?`,
          args: [b.amount, b.note, b.expense_date, b.expense_datetime, b.vendor, b.category, b.vendor_key, b.id, userId],
        });
        if (step.rule) {
          out.push(
            step.rule.category === null
              ? {
                  sql: "DELETE FROM expense_vendor_rules WHERE user_id = ? AND vendor_key = ?",
                  args: [userId, step.rule.vendorKey],
                }
              : {
                  sql: `INSERT INTO expense_vendor_rules (user_id, vendor_key, category, updated_at) VALUES (?, ?, ?, ?)
                        ON CONFLICT(user_id, vendor_key) DO UPDATE SET category = excluded.category, updated_at = excluded.updated_at`,
                  args: [userId, step.rule.vendorKey, step.rule.category, now],
                }
          );
        }
        break;
      }

      case "remove_subscription":
        out.push(
          {
            sql: `DELETE FROM subscription_payments WHERE subscription_id IN (SELECT id FROM subscriptions WHERE id = ? AND user_id = ?)`,
            args: [step.id, userId],
          },
          { sql: "DELETE FROM subscriptions WHERE id = ? AND user_id = ?", args: [step.id, userId] }
        );
        break;

      case "restore_subscription": {
        const sub = step.sub;
        if (sub.user_id !== userId) break;
        out.push({
          sql: `INSERT OR IGNORE INTO subscriptions (id, user_id, name, amount, due_day, logo_url, created_at, active)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
          args: [sub.id, sub.user_id, sub.name, sub.amount, sub.due_day, sub.logo_url, sub.created_at, sub.active],
        });
        for (const p of step.payments) {
          out.push({
            sql: `INSERT OR IGNORE INTO subscription_payments
                    (id, subscription_id, period, due_date, paid_at, created_at, reminder_day_before_sent_at, reminder_due_today_sent_at)
                  VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
            args: [p.id, sub.id, p.period, p.due_date, p.paid_at, p.created_at, p.reminder_day_before_sent_at, p.reminder_due_today_sent_at],
          });
        }
        break;
      }

      case "revert_subscription": {
        const b = step.before;
        out.push({
          sql: "UPDATE subscriptions SET name = ?, amount = ?, due_day = ?, active = ? WHERE id = ? AND user_id = ?",
          args: [b.name, b.amount, b.due_day, b.active, b.id, userId],
        });
        break;
      }

      case "unmark_paid":
        out.push({
          sql: `UPDATE subscription_payments SET paid_at = NULL
                WHERE id = ? AND subscription_id IN (SELECT id FROM subscriptions WHERE user_id = ?)`,
          args: [step.paymentId, userId],
        });
        // The next month's entry that marking paid added - but only if nothing
        // has been paid against it since.
        if (step.addedPaymentId) {
          out.push({
            sql: `DELETE FROM subscription_payments
                  WHERE id = ? AND paid_at IS NULL AND subscription_id IN (SELECT id FROM subscriptions WHERE user_id = ?)`,
            args: [step.addedPaymentId, userId],
          });
        }
        break;

      case "rename_person":
        out.push({ sql: "UPDATE people SET name = ? WHERE id = ? AND user_id = ?", args: [step.name, step.personId, userId] });
        break;

      case "restore_person": {
        const p = step.person;
        if (p.user_id !== userId) break;
        out.push({
          sql: "INSERT OR IGNORE INTO people (id, name, created_at, user_id, due_date) VALUES (?, ?, ?, ?, ?)",
          args: [p.id, p.name, p.created_at, p.user_id, p.due_date],
        });
        for (const t of step.transactions) {
          out.push({
            sql: "INSERT OR IGNORE INTO transactions (id, person_id, amount, note, created_at) VALUES (?, ?, ?, ?, ?)",
            args: [t.id, p.id, t.amount, t.note, t.created_at],
          });
        }
        break;
      }

      case "remove_category":
        out.push(
          { sql: "DELETE FROM expense_categories WHERE user_id = ? AND name = ?", args: [userId, step.name] },
          { sql: "UPDATE expenses SET category = NULL WHERE user_id = ? AND category = ?", args: [userId, step.name] },
          { sql: "DELETE FROM expense_vendor_rules WHERE user_id = ? AND category = ?", args: [userId, step.name] }
        );
        break;

      case "rename_category":
        out.push(
          { sql: "UPDATE expense_categories SET name = ? WHERE user_id = ? AND name = ?", args: [step.to, userId, step.from] },
          { sql: "UPDATE expenses SET category = ? WHERE user_id = ? AND category = ?", args: [step.to, userId, step.from] },
          { sql: "UPDATE expense_vendor_rules SET category = ? WHERE user_id = ? AND category = ?", args: [step.to, userId, step.from] }
        );
        break;

      case "restore_category": {
        const k = step.category;
        out.push({
          sql: "INSERT OR IGNORE INTO expense_categories (user_id, name, keywords, sort_order, created_at) VALUES (?, ?, ?, ?, ?)",
          args: [userId, k.name, k.keywords, k.sort_order, k.created_at],
        });
        // Only expenses still uncategorised go back: one given a new category
        // since the delete keeps it.
        for (let i = 0; i < step.expenseIds.length; i += 100) {
          const ids = step.expenseIds.slice(i, i + 100);
          out.push({
            sql: `UPDATE expenses SET category = ? WHERE user_id = ? AND category IS NULL AND id IN (${ids.map(() => "?").join(", ")})`,
            args: [k.name, userId, ...ids],
          });
        }
        for (const r of step.rules) {
          out.push({
            sql: "INSERT OR IGNORE INTO expense_vendor_rules (user_id, vendor_key, category, updated_at) VALUES (?, ?, ?, ?)",
            args: [userId, r.vendor_key, r.category, r.updated_at],
          });
        }
        break;
      }

      case "set_category_keywords":
        out.push({
          sql: "UPDATE expense_categories SET keywords = ? WHERE user_id = ? AND name = ?",
          args: [step.keywords, userId, step.name],
        });
        break;

      case "remove_expense":
        out.push({ sql: "DELETE FROM expenses WHERE id = ? AND user_id = ?", args: [step.id, userId] });
        break;

      case "set_email_reminders":
        out.push({ sql: "UPDATE users SET email_reminders = ? WHERE id = ?", args: [step.on ? 1 : 0, userId] });
        break;
    }
  }
  return out;
}

/* ---------- assistant: expenses ---------- */

function toExpenseRow(r: Record<string, unknown>): ExpenseRow {
  return {
    id: r.id as string,
    user_id: r.user_id as string,
    amount: Number(r.amount),
    note: (r.note as string) ?? "",
    expense_date: r.expense_date as string,
    expense_datetime: (r.expense_datetime as string) ?? "",
    created_at: r.created_at as string,
    vendor: (r.vendor as string) ?? null,
    category: (r.category as string) ?? null,
    vendor_key: (r.vendor_key as string) ?? null,
  };
}

export async function getExpenseRow(userId: string, id: string): Promise<ExpenseRow | null> {
  await ensureCategoryTables();
  const c = await db();
  const rs = await c.execute({ sql: "SELECT * FROM expenses WHERE id = ? AND user_id = ?", args: [id, userId] });
  return rs.rows[0] ? toExpenseRow(rs.rows[0]) : null;
}

export async function listExpenseRowsSince(userId: string, sinceYmd: string, limit = 400): Promise<ExpenseRow[]> {
  await ensureCategoryTables();
  const c = await db();
  const rs = await c.execute({
    sql: "SELECT * FROM expenses WHERE user_id = ? AND expense_date >= ? ORDER BY expense_date DESC, created_at DESC LIMIT ?",
    args: [userId, sinceYmd, limit],
  });
  return rs.rows.map(toExpenseRow);
}

// The expense most recently added by the assistant that still exists - what
// "it" or "the last one" means.
export async function lastAddedExpenseId(userId: string): Promise<string | null> {
  await ensureCategoryTables();
  const c = await db();
  const rs = await c.execute({
    sql: `SELECT w.expense_id FROM whatsapp_inbound w JOIN expenses e ON e.id = w.expense_id AND e.user_id = w.user_id
          WHERE w.user_id = ? ORDER BY w.created_at DESC LIMIT 1`,
    args: [userId],
  });
  return (rs.rows[0]?.expense_id as string) ?? null;
}

export async function latestExpenseId(userId: string): Promise<string | null> {
  const c = await db();
  const rs = await c.execute({
    sql: "SELECT id FROM expenses WHERE user_id = ? ORDER BY created_at DESC LIMIT 1",
    args: [userId],
  });
  return (rs.rows[0]?.id as string) ?? null;
}

// Applies the given changes and returns the row before and after, plus the
// payee rule it replaced when the category was corrected - everything UNDO
// needs to put it back.
export async function editExpenseRow(
  userId: string,
  id: string,
  changes: { amount?: number; vendor?: string; note?: string; category?: string | null; date?: string }
): Promise<{ before: ExpenseRow; after: ExpenseRow; rule: { vendorKey: string; category: string | null } | null } | null> {
  const before = await getExpenseRow(userId, id);
  if (!before) return null;

  const vendor = changes.vendor !== undefined ? changes.vendor : before.vendor;
  const time = before.expense_datetime.includes("T") ? before.expense_datetime.slice(10) : "T00:00:00Z";
  const after: ExpenseRow = {
    ...before,
    amount: changes.amount ?? before.amount,
    note: changes.note ?? before.note,
    vendor,
    vendor_key: normalizeVendor(vendor) || null,
    category: changes.category !== undefined ? changes.category : before.category,
    expense_date: changes.date ?? before.expense_date,
    expense_datetime: changes.date ? `${changes.date}${time}` : before.expense_datetime,
  };

  const c = await db();
  await c.execute({
    sql: `UPDATE expenses SET amount = ?, note = ?, expense_date = ?, expense_datetime = ?, vendor = ?, category = ?, vendor_key = ?
          WHERE id = ? AND user_id = ?`,
    args: [after.amount, after.note, after.expense_date, after.expense_datetime, after.vendor, after.category, after.vendor_key, id, userId],
  });

  // A category corrected by hand becomes the standing rule for that payee, as
  // it does when an expense is edited in the app.
  let rule: { vendorKey: string; category: string | null } | null = null;
  if (changes.category && after.vendor_key && changes.category !== before.category) {
    const previous = await getVendorRule(userId, after.vendor_key);
    await upsertVendorRule(userId, after.vendor_key, changes.category);
    rule = { vendorKey: after.vendor_key, category: previous };
  }
  return { before, after, rule };
}

export async function deleteExpenseRow(userId: string, id: string): Promise<ExpenseRow | null> {
  const before = await getExpenseRow(userId, id);
  if (!before) return null;
  const c = await db();
  await c.execute({ sql: "DELETE FROM expenses WHERE id = ? AND user_id = ?", args: [id, userId] });
  return before;
}

/* ---------- assistant: subscriptions ---------- */

function toSubscriptionRow(r: Record<string, unknown>): SubscriptionRow {
  return {
    id: r.id as string,
    user_id: r.user_id as string,
    name: r.name as string,
    amount: Number(r.amount),
    due_day: Number(r.due_day),
    logo_url: (r.logo_url as string) ?? null,
    active: Number(r.active ?? 1),
    created_at: r.created_at as string,
  };
}

function toPaymentRow(r: Record<string, unknown>): PaymentRow {
  return {
    id: r.id as string,
    subscription_id: r.subscription_id as string,
    period: r.period as string,
    due_date: r.due_date as string,
    paid_at: (r.paid_at as string) ?? null,
    created_at: r.created_at as string,
    reminder_day_before_sent_at: (r.reminder_day_before_sent_at as string) ?? null,
    reminder_due_today_sent_at: (r.reminder_due_today_sent_at as string) ?? null,
  };
}

export async function listSubscriptionRows(userId: string): Promise<SubscriptionRow[]> {
  await ensureTablesExist();
  const c = await db();
  const rs = await c.execute({
    sql: "SELECT * FROM subscriptions WHERE user_id = ? ORDER BY created_at ASC",
    args: [userId],
  });
  return rs.rows.map(toSubscriptionRow);
}

export async function getSubscriptionSnapshot(
  userId: string,
  id: string
): Promise<{ sub: SubscriptionRow; payments: PaymentRow[] } | null> {
  await ensureTablesExist();
  const c = await db();
  const rs = await c.execute({ sql: "SELECT * FROM subscriptions WHERE id = ? AND user_id = ?", args: [id, userId] });
  if (!rs.rows[0]) return null;
  const payments = await c.execute({
    sql: "SELECT * FROM subscription_payments WHERE subscription_id = ? ORDER BY period ASC",
    args: [id],
  });
  return { sub: toSubscriptionRow(rs.rows[0]), payments: payments.rows.map(toPaymentRow) };
}

export async function updateSubscriptionFields(
  userId: string,
  id: string,
  fields: { name?: string; amount?: number; due_day?: number; active?: boolean }
): Promise<{ before: SubscriptionRow; after: SubscriptionRow } | null> {
  const snapshot = await getSubscriptionSnapshot(userId, id);
  if (!snapshot) return null;
  const before = snapshot.sub;
  const after: SubscriptionRow = {
    ...before,
    name: fields.name ?? before.name,
    amount: fields.amount ?? before.amount,
    due_day: fields.due_day ?? before.due_day,
    active: fields.active === undefined ? before.active : fields.active ? 1 : 0,
  };
  const c = await db();
  await c.execute({
    sql: "UPDATE subscriptions SET name = ?, amount = ?, due_day = ?, active = ? WHERE id = ? AND user_id = ?",
    args: [after.name, after.amount, after.due_day, after.active, id, userId],
  });
  return { before, after };
}

// Same rule as marking paid in the app - the oldest unpaid month is paid and
// the next month rolled in - but it reports which rows it touched, so UNDO can
// reverse exactly that.
export async function markSubscriptionPaidTracked(
  userId: string,
  id: string
): Promise<
  | { status: "paid"; paymentId: string; period: string; addedPaymentId: string | null; nextDueDate: string }
  | { status: "nothing_due" }
  | null
> {
  await ensureTablesExist();
  const c = await db();
  const subRs = await c.execute({ sql: "SELECT due_day FROM subscriptions WHERE id = ? AND user_id = ?", args: [id, userId] });
  if (!subRs.rows[0]) return null;
  const dueDay = Number(subRs.rows[0].due_day);

  await ensurePeriodPayment(id, dueDay, currentPeriodStr());
  const unpaidRs = await c.execute({
    sql: "SELECT id, period FROM subscription_payments WHERE subscription_id = ? AND paid_at IS NULL ORDER BY period ASC LIMIT 1",
    args: [id],
  });
  const unpaid = unpaidRs.rows[0];
  if (!unpaid) return { status: "nothing_due" };

  const now = new Date().toISOString();
  await c.execute({ sql: "UPDATE subscription_payments SET paid_at = ? WHERE id = ?", args: [now, unpaid.id as string] });

  const next = nextPeriod(unpaid.period as string);
  const nextDueDate = clampedDateForPeriod(next, dueDay);
  const addedId = randomUUID();
  const added = await c.execute({
    sql: `INSERT OR IGNORE INTO subscription_payments (id, subscription_id, period, due_date, paid_at, created_at)
          VALUES (?, ?, ?, ?, NULL, ?)`,
    args: [addedId, id, next, nextDueDate, now],
  });
  return {
    status: "paid",
    paymentId: unpaid.id as string,
    period: unpaid.period as string,
    addedPaymentId: added.rowsAffected === 1 ? addedId : null,
    nextDueDate,
  };
}

/* ---------- assistant: people ---------- */

export async function getPersonSnapshot(
  userId: string,
  id: string
): Promise<{ person: PersonRow; transactions: TxRow[] } | null> {
  const c = await db();
  const rs = await c.execute({ sql: "SELECT * FROM people WHERE id = ? AND user_id = ?", args: [id, userId] });
  const r = rs.rows[0];
  if (!r) return null;
  const tx = await c.execute({ sql: "SELECT * FROM transactions WHERE person_id = ? ORDER BY created_at ASC", args: [id] });
  return {
    person: {
      id: r.id as string,
      name: r.name as string,
      created_at: r.created_at as string,
      user_id: r.user_id as string,
      due_date: (r.due_date as string) ?? null,
    },
    transactions: tx.rows.map((t) => ({
      id: t.id as string,
      person_id: t.person_id as string,
      amount: Number(t.amount),
      note: (t.note as string) ?? "",
      created_at: t.created_at as string,
    })),
  };
}

// Returns the name it replaced, or null when the person isn't this user's.
export async function renamePersonRow(userId: string, id: string, name: string): Promise<string | null> {
  const snapshot = await getPersonSnapshot(userId, id);
  if (!snapshot) return null;
  const c = await db();
  await c.execute({ sql: "UPDATE people SET name = ? WHERE id = ? AND user_id = ?", args: [name, id, userId] });
  return snapshot.person.name;
}

// Same as deleting a person in the app: their entries go with them.
export async function deletePersonRow(userId: string, id: string): Promise<void> {
  const c = await db();
  await c.batch(
    [
      {
        sql: "DELETE FROM transactions WHERE person_id IN (SELECT id FROM people WHERE id = ? AND user_id = ?)",
        args: [id, userId],
      },
      { sql: "DELETE FROM people WHERE id = ? AND user_id = ?", args: [id, userId] },
    ],
    "write"
  );
}

/* ---------- assistant: categories ---------- */

// Everything a category change affects, so UNDO can put it all back: the
// category, the expenses in it, and the payee rules that point at it.
export async function getCategorySnapshot(
  userId: string,
  name: string
): Promise<{ category: CategoryRow; expenseIds: string[]; rules: RuleRow[] } | null> {
  await ensureCategoryTables();
  const c = await db();
  const rs = await c.execute({
    sql: "SELECT name, keywords, sort_order, created_at FROM expense_categories WHERE user_id = ? AND name = ?",
    args: [userId, name],
  });
  const r = rs.rows[0];
  if (!r) return null;
  const [expenses, rules] = await Promise.all([
    c.execute({ sql: "SELECT id FROM expenses WHERE user_id = ? AND category = ? LIMIT 2000", args: [userId, name] }),
    c.execute({
      sql: "SELECT vendor_key, category, updated_at FROM expense_vendor_rules WHERE user_id = ? AND category = ?",
      args: [userId, name],
    }),
  ]);
  return {
    category: {
      name: r.name as string,
      keywords: (r.keywords as string) ?? null,
      sort_order: Number(r.sort_order),
      created_at: r.created_at as string,
    },
    expenseIds: expenses.rows.map((e) => e.id as string),
    rules: rules.rows.map((x) => ({
      vendor_key: x.vendor_key as string,
      category: x.category as string,
      updated_at: x.updated_at as string,
    })),
  };
}
