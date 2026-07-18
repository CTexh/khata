import { createClient, type Client } from "@libsql/client";

let client: Client | null = null;
let ready: Promise<void> | null = null;

function getClient(): Client {
  if (!client) {
    client = createClient({
      url: process.env.TURSO_DATABASE_URL ?? "file:local.db",
      authToken: process.env.TURSO_AUTH_TOKEN,
    });
  }
  return client;
}

async function hasColumn(c: Client, table: string, column: string): Promise<boolean> {
  const rs = await c.execute(`PRAGMA table_info(${table})`);
  return rs.rows.some((r) => (r.name as string) === column);
}

export async function db(): Promise<Client> {
  const c = getClient();
  if (!ready) {
    ready = (async () => {
      await c.execute(`CREATE TABLE IF NOT EXISTS users (
        id TEXT PRIMARY KEY,
        username TEXT NOT NULL UNIQUE,
        password_hash TEXT NOT NULL,
        is_admin INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL
      )`);
      await c.execute(`CREATE TABLE IF NOT EXISTS people (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        created_at TEXT NOT NULL
      )`);
      await c.execute(`CREATE TABLE IF NOT EXISTS transactions (
        id TEXT PRIMARY KEY,
        person_id TEXT NOT NULL REFERENCES people(id) ON DELETE CASCADE,
        amount REAL NOT NULL,
        note TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL
      )`);
      await c.execute(`CREATE TABLE IF NOT EXISTS expenses (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        amount REAL NOT NULL,
        note TEXT NOT NULL DEFAULT '',
        expense_date TEXT NOT NULL,
        created_at TEXT NOT NULL
      )`);

      // migrate: scope people to a user (older single-user schema had no user_id)
      if (!(await hasColumn(c, "people", "user_id"))) {
        await c.execute(`ALTER TABLE people ADD COLUMN user_id TEXT REFERENCES users(id)`);
      }

      await c.execute(
        `CREATE INDEX IF NOT EXISTS idx_people_user ON people(user_id)`
      );
      await c.execute(
        `CREATE INDEX IF NOT EXISTS idx_expenses_user_date ON expenses(user_id, expense_date)`
      );
    })();
  }
  await ready;
  return c;
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
      SELECT p.id, p.name, p.created_at,
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
    balance: Number(r.balance),
    lent: Number(r.lent),
    received: Number(r.received),
    tx_count: Number(r.tx_count),
    last_activity: r.last_activity as string,
  }));
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
  created_at: string;
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
  return {
    id: r.id as string,
    user_id: r.user_id as string,
    amount: Number(r.amount),
    note: (r.note as string) ?? "",
    expense_date: r.expense_date as string,
    created_at: r.created_at as string,
  };
}

export type YearlyPoint = { month: number; total: number; count: number };

export async function yearlyExpenseTotals(userId: string, year: number): Promise<YearlyPoint[]> {
  const c = await db();
  const rs = await c.execute({
    sql: `
      SELECT substr(expense_date, 6, 2) AS month, SUM(amount) AS total, COUNT(*) AS count
      FROM expenses
      WHERE user_id = ? AND substr(expense_date, 1, 4) = ?
      GROUP BY month
    `,
    args: [userId, String(year)],
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

