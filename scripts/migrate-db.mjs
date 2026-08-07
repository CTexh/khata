import { createClient } from "@libsql/client";
import { randomBytes, randomUUID, scryptSync } from "node:crypto";

const url = process.env.TURSO_DATABASE_URL ?? "file:local.db";
const client = createClient({ url, authToken: process.env.TURSO_AUTH_TOKEN });

await client.batch(
  [
    `CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      username TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      is_admin INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL
    )`,
    `CREATE TABLE IF NOT EXISTS people (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      created_at TEXT NOT NULL,
      user_id TEXT REFERENCES users(id),
      due_date TEXT
    )`,
    `CREATE TABLE IF NOT EXISTS transactions (
      id TEXT PRIMARY KEY,
      person_id TEXT NOT NULL REFERENCES people(id) ON DELETE CASCADE,
      amount REAL NOT NULL,
      note TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL
    )`,
    `CREATE TABLE IF NOT EXISTS expenses (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      amount REAL NOT NULL,
      note TEXT NOT NULL DEFAULT '',
      expense_date TEXT,
      expense_datetime TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL,
      vendor TEXT,
      category TEXT
    )`,
    `CREATE INDEX IF NOT EXISTS idx_people_user ON people(user_id)`,
    `CREATE INDEX IF NOT EXISTS idx_expenses_user_date ON expenses(user_id, expense_date)`,
  ],
  "write"
);

for (const sql of [
  `ALTER TABLE people ADD COLUMN user_id TEXT REFERENCES users(id)`,
  `ALTER TABLE people ADD COLUMN due_date TEXT`,
  `ALTER TABLE expenses ADD COLUMN vendor TEXT`,
  `ALTER TABLE expenses ADD COLUMN category TEXT`,
  `ALTER TABLE expenses ADD COLUMN expense_datetime TEXT DEFAULT ''`,
]) {
  try {
    await client.execute(sql);
  } catch {
    // Existing installations already have the column.
  }
}

const adminUsername = process.env.ADMIN_USERNAME;
const adminPassword = process.env.ADMIN_PASSWORD;
if (adminUsername && adminPassword) {
  const salt = randomBytes(16).toString("hex");
  const passwordHash = `${salt}:${scryptSync(adminPassword, salt, 64).toString("hex")}`;
  await client.execute({
    sql: `INSERT INTO users (id, username, password_hash, is_admin, created_at)
          VALUES (?, ?, ?, 1, ?)
          ON CONFLICT(username) DO UPDATE SET is_admin = 1`,
    args: [randomUUID(), adminUsername, passwordHash, new Date().toISOString()],
  });
}

client.close();
console.log("Database migration complete.");
