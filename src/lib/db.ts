import { createClient, type Client } from "@libsql/client";
import { randomUUID } from "crypto";

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
  password_hash: string;
  is_admin: boolean;
  created_at: string;
};

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
    password_hash: r.password_hash as string,
    is_admin: Number(r.is_admin) === 1,
    created_at: r.created_at as string,
  };
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

export async function listExpenses(
  userId: string,
  opts: { year: number; month?: number }
): Promise<Expense[]> {
  const c = await db();
  const prefix =
    opts.month !== undefined
      ? `${opts.year}-${String(opts.month).padStart(2, "0")}`
      : `${opts.year}`;
  const rs = await c.execute({
    sql: `SELECT * FROM expenses WHERE user_id = ? AND expense_date LIKE ? ORDER BY expense_date DESC, created_at DESC`,
    args: [userId, `${prefix}%`],
  });
  return rs.rows.map(rowToExpense);
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

/* ---------- subscriptions (scoped per user) ---------- */

export type Subscription = {
  id: string;
  user_id: string;
  name: string;
  amount: number;
  due_day: number;
  logo_url: string | null;
  next_payment_date: string;
  created_at: string;
};

export type SubscriptionWithStatus = Subscription & {
  status: "due-today" | "due-soon" | "upcoming";
  last_paid_date: string | null;
};

export async function listSubscriptions(userId: string): Promise<SubscriptionWithStatus[]> {
  const c = await db();
  const rs = await c.execute({
    sql: `SELECT * FROM subscriptions WHERE user_id = ? ORDER BY next_payment_date ASC`,
    args: [userId],
  });

  const today = new Date().toISOString().split("T")[0];
  const soon = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString().split("T")[0];

  return rs.rows.map((r) => {
    const next_payment_date = r.next_payment_date as string;
    let status: "due-today" | "due-soon" | "upcoming";
    if (next_payment_date <= today) status = "due-today";
    else if (next_payment_date <= soon) status = "due-soon";
    else status = "upcoming";

    return {
      id: r.id as string,
      user_id: r.user_id as string,
      name: r.name as string,
      amount: Number(r.amount),
      due_day: Number(r.due_day),
      logo_url: (r.logo_url as string) ?? null,
      next_payment_date,
      created_at: r.created_at as string,
      status,
      last_paid_date: null,
    };
  });
}

export async function createSubscription(
  userId: string,
  name: string,
  amount: number,
  due_day: number,
  logo_url?: string
): Promise<Subscription> {
  const c = await db();
  const id = randomUUID();
  const created_at = new Date().toISOString();
  const next_payment_date = getNextPaymentDate(due_day);

  await c.execute({
    sql: `INSERT INTO subscriptions (id, user_id, name, amount, due_day, logo_url, next_payment_date, created_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    args: [id, userId, name, amount, due_day, logo_url || null, next_payment_date, created_at],
  });

  return { id, user_id: userId, name, amount, due_day, logo_url: logo_url || null, next_payment_date, created_at };
}

export async function markSubscriptionPaid(subscriptionId: string, userId: string): Promise<void> {
  const c = await db();
  const rs = await c.execute({
    sql: `SELECT due_day FROM subscriptions WHERE id = ? AND user_id = ?`,
    args: [subscriptionId, userId],
  });

  const r = rs.rows[0];
  if (!r) throw new Error("Subscription not found");

  const due_day = Number(r.due_day);
  const next_payment_date = getNextPaymentDate(due_day);

  await c.execute({
    sql: `UPDATE subscriptions SET next_payment_date = ? WHERE id = ?`,
    args: [next_payment_date, subscriptionId],
  });
}

export async function deleteSubscription(subscriptionId: string, userId: string): Promise<void> {
  const c = await db();
  await c.execute({
    sql: `DELETE FROM subscriptions WHERE id = ? AND user_id = ?`,
    args: [subscriptionId, userId],
  });
}

export async function getSubscriptionMonthlyTotal(userId: string, month: number, year: number): Promise<number> {
  const c = await db();
  const rs = await c.execute({
    sql: `
      SELECT SUM(amount) as total FROM subscriptions
      WHERE user_id = ? AND next_payment_date >= ? AND next_payment_date < ?
    `,
    args: [userId, `${year}-${String(month).padStart(2, "0")}-01`, `${year}-${String(month + 1).padStart(2, "0")}-01`],
  });

  const r = rs.rows[0];
  return r ? Number(r.total) || 0 : 0;
}

function getNextPaymentDate(due_day: number): string {
  const today = new Date();
  let year = today.getFullYear();
  let month = today.getMonth() + 1;

  if (today.getDate() >= due_day) {
    month += 1;
    if (month > 12) {
      month = 1;
      year += 1;
    }
  }

  const lastDay = new Date(year, month, 0).getDate();
  const day = Math.min(due_day, lastDay);

  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

/* Ensure tables exist */
export async function ensureTablesExist(): Promise<void> {
  const c = await db();
  await c.batch([
    {
      sql: `CREATE TABLE IF NOT EXISTS subscriptions (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        name TEXT NOT NULL,
        amount REAL NOT NULL,
        due_day INTEGER NOT NULL,
        logo_url TEXT,
        next_payment_date TEXT NOT NULL,
        created_at TEXT NOT NULL,
        FOREIGN KEY(user_id) REFERENCES users(id)
      )`,
    },
  ], "write");
}
