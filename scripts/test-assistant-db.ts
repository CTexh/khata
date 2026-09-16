// Runs every assistant action that changes data - and UNDO for each - against a
// throwaway database built by scripts/migrate-db.mjs. No model is called: the
// actions are built directly, exactly as interpretCall() would produce them.
// Run with: node --experimental-strip-types --import ./scripts/alias-register.mjs scripts/test-assistant-db.ts
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const dir = mkdtempSync(join(tmpdir(), "khata-assistant-db-"));
const url = `file:${join(dir, "test.db")}`;
process.env.TURSO_DATABASE_URL = url;
delete process.env.TURSO_AUTH_TOKEN;
execFileSync(process.execPath, ["scripts/migrate-db.mjs"], {
  env: { ...process.env, TURSO_DATABASE_URL: url },
  stdio: "pipe",
});

const dbm = await import("../src/lib/db.ts");
const { runAction } = await import("../src/lib/assistant.ts");
type Action = Parameters<typeof runAction>[1];

let pass = 0;
let fail = 0;
function check(label: string, got: unknown, want: unknown) {
  if (JSON.stringify(got) === JSON.stringify(want)) {
    pass++;
  } else {
    fail++;
    console.log(`FAIL ${label}\n     got: ${JSON.stringify(got)}  want: ${JSON.stringify(want)}`);
  }
}

const c = dbm.db();
const userId = randomUUID();
const otherUser = randomUUID();
const now = new Date().toISOString();
for (const [id, username] of [[userId, "assistant-test"], [otherUser, "someone-else"]]) {
  await c.execute({
    sql: "INSERT INTO users (id, username, password_hash, is_admin, created_at) VALUES (?, ?, ?, 0, ?)",
    args: [id, username, "unused-test-placeholder", now],
  });
}
await dbm.ensureTablesExist();
await dbm.ensureCategoryTables();
await dbm.listUserCategories(userId); // seeds the default categories

const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Karachi" }).format(new Date());

async function act(action: Action): Promise<string> {
  const messageId = `test-${randomUUID()}`;
  await dbm.claimInboundMessage(messageId, userId);
  return (await runAction({ userId, messageId, text: "", image: null, audio: null }, action)) ?? "";
}
const undo = () => act({ ok: true, kind: "command", command: "undo" });
const one = async (sql: string, args: (string | number | null)[] = []) => (await c.execute({ sql, args })).rows[0] ?? null;
const count = async (sql: string, args: (string | number | null)[] = []) => Number((await one(sql, args))?.n ?? 0);
const target = (o: Record<string, unknown> = {}) => ({ which: "match", vendor: null, amount: null, date: null, category: null, ...o }) as never;

/* ---------- expenses: add, edit, delete, undo ---------- */

await act({ ok: true, kind: "expense", expense: { amount: 3000, vendor: "Shell", note: "fuel", date: today, categoryHint: "Car" } });
const shell = await one("SELECT * FROM expenses WHERE user_id = ? AND vendor = 'Shell'", [userId]);
check("expense added", [Number(shell?.amount), shell?.category], [3000, "Car"]);

let reply = await act({ ok: true, kind: "expense_edit", target: target({ which: "last_added" }), changes: { amount: 2500, category: "Groceries" } });
check("edit reply", reply.startsWith("*Expense updated*"), true);
let row = await one("SELECT amount, category FROM expenses WHERE id = ?", [shell?.id as string]);
check("expense edited", [Number(row?.amount), row?.category], [2500, "Groceries"]);
check("category correction taught a payee rule", (await one("SELECT category FROM expense_vendor_rules WHERE user_id = ? AND vendor_key = 'shell'", [userId]))?.category, "Groceries");

reply = await undo();
check("undo edit reply", reply.includes("Expense back to Rs 3,000 · Shell (Car)"), true);
row = await one("SELECT amount, category FROM expenses WHERE id = ?", [shell?.id as string]);
check("edit undone", [Number(row?.amount), row?.category], [3000, "Car"]);
check("taught rule removed by undo", await count("SELECT COUNT(*) AS n FROM expense_vendor_rules WHERE user_id = ? AND vendor_key = 'shell'", [userId]), 0);

reply = await act({ ok: true, kind: "expense_delete", target: target({ vendor: "shell" }) });
check("delete reply", reply.startsWith("*Expense deleted*"), true);
check("expense deleted", await count("SELECT COUNT(*) AS n FROM expenses WHERE id = ?", [shell?.id as string]), 0);
await undo();
row = await one("SELECT amount, category, created_at FROM expenses WHERE id = ?", [shell?.id as string]);
check("delete undone with the same row", [Number(row?.amount), row?.category, row?.created_at], [3000, "Car", shell?.created_at]);

await act({ ok: true, kind: "expense", expense: { amount: 800, vendor: "Shell", note: "fuel again", date: today, categoryHint: "Car" } });
reply = await act({ ok: true, kind: "expense_delete", target: target({ vendor: "shell" }) });
check("two matches are listed, not guessed", reply.startsWith("*Which one?*"), true);
check("nothing deleted when ambiguous", await count("SELECT COUNT(*) AS n FROM expenses WHERE user_id = ? AND vendor = 'Shell'", [userId]), 2);
reply = await act({ ok: true, kind: "expense_delete", target: target({ vendor: "shell", amount: 800 }) });
check("more detail picks one", await count("SELECT COUNT(*) AS n FROM expenses WHERE user_id = ? AND vendor = 'Shell'", [userId]), 1);
reply = await act({ ok: true, kind: "expense_edit", target: target({ vendor: "nobody" }), changes: { amount: 5 } });
check("no match is reported", reply.startsWith("*Couldn't find it*"), true);

/* ---------- Udhar Khata: new person, rename, delete, undo ---------- */

await act({ ok: true, kind: "ledger", ledger: { direction: "lend", entries: [{ person: "Habib", amount: 500, isNew: true }], note: null } });
const habib = await one("SELECT * FROM people WHERE user_id = ? AND name = 'Habib'", [userId]);
check("person added with a loan", await count("SELECT COUNT(*) AS n FROM transactions WHERE person_id = ?", [habib?.id as string]), 1);

reply = await act({ ok: true, kind: "person_rename", person: "Habib", newName: "Habib Ullah" });
check("rename reply", reply, "*Name changed*\n\nHabib → *Habib Ullah*\n\nReply *UNDO* to change it back.");
check("renamed", (await one("SELECT name FROM people WHERE id = ?", [habib?.id as string]))?.name, "Habib Ullah");
await undo();
check("rename undone", (await one("SELECT name FROM people WHERE id = ?", [habib?.id as string]))?.name, "Habib");

await act({ ok: true, kind: "due_date", due: { person: "Habib", date: today } });
check("due date set", (await one("SELECT due_date FROM people WHERE id = ?", [habib?.id as string]))?.due_date, today);
await undo();
check("due date undone", (await one("SELECT due_date FROM people WHERE id = ?", [habib?.id as string]))?.due_date, null);

reply = await act({ ok: true, kind: "person_delete", person: "Habib" });
check("delete person reply", reply.includes("1 entry removed"), true);
check("person and entries deleted", [await count("SELECT COUNT(*) AS n FROM people WHERE id = ?", [habib?.id as string]), await count("SELECT COUNT(*) AS n FROM transactions WHERE person_id = ?", [habib?.id as string])], [0, 0]);
await undo();
check("person and entries restored", [await count("SELECT COUNT(*) AS n FROM people WHERE id = ?", [habib?.id as string]), await count("SELECT COUNT(*) AS n FROM transactions WHERE person_id = ?", [habib?.id as string])], [1, 1]);

/* ---------- subscriptions ---------- */

reply = await act({ ok: true, kind: "subscription", sub: { action: "add", name: "Hulu", amount: 1200, firstDueDate: today } });
check("subscription added", [reply.startsWith("*Subscription added*"), await count("SELECT COUNT(*) AS n FROM subscriptions WHERE user_id = ? AND name = 'Hulu'", [userId])], [true, 1]);
await undo();
check("added subscription undone", await count("SELECT COUNT(*) AS n FROM subscriptions WHERE user_id = ? AND name = 'Hulu'", [userId]), 0);

await act({ ok: true, kind: "subscription", sub: { action: "add", name: "Netflix", amount: 1500, firstDueDate: today } });
const netflix = await one("SELECT * FROM subscriptions WHERE user_id = ? AND name = 'Netflix'", [userId]);
const netflixId = netflix?.id as string;
const payments = () => c.execute({ sql: "SELECT period, paid_at FROM subscription_payments WHERE subscription_id = ? ORDER BY period", args: [netflixId] });

reply = await act({ ok: true, kind: "subscription", sub: { action: "mark_paid", name: "Netflix" } });
check("mark paid reply", reply.startsWith("*Marked paid*"), true);
let rows = (await payments()).rows;
check("oldest period paid and next rolled in", [rows.filter((p) => p.paid_at).length, rows.length >= 2], [1, true]);
const beforeUndoCount = rows.length;
await undo();
rows = (await payments()).rows;
check("mark paid undone", [rows.filter((p) => p.paid_at).length, rows.length], [0, beforeUndoCount - 1]);

await act({ ok: true, kind: "subscription", sub: { action: "pause", name: "Netflix" } });
check("paused", Number((await one("SELECT active FROM subscriptions WHERE id = ?", [netflixId]))?.active), 0);
reply = await act({ ok: true, kind: "subscription", sub: { action: "pause", name: "Netflix" } });
check("pausing again changes nothing", reply.startsWith("*Nothing to change*"), true);
await undo();
check("pause undone", Number((await one("SELECT active FROM subscriptions WHERE id = ?", [netflixId]))?.active), 1);

await act({ ok: true, kind: "subscription", sub: { action: "edit", name: "Netflix", newName: null, amount: 1800, dueDay: 20 } });
let subRow = await one("SELECT amount, due_day FROM subscriptions WHERE id = ?", [netflixId]);
check("subscription edited", [Number(subRow?.amount), Number(subRow?.due_day)], [1800, 20]);
await undo();
subRow = await one("SELECT amount, due_day FROM subscriptions WHERE id = ?", [netflixId]);
check("subscription edit undone", [Number(subRow?.amount), Number(subRow?.due_day)], [1500, Number(netflix?.due_day)]);

const paymentsBeforeDelete = (await payments()).rows.length;
reply = await act({ ok: true, kind: "subscription", sub: { action: "delete", name: "Netflix" } });
check("subscription deleted", [reply.startsWith("*Subscription deleted*"), await count("SELECT COUNT(*) AS n FROM subscriptions WHERE id = ?", [netflixId]), (await payments()).rows.length], [true, 0, 0]);
await undo();
check("subscription and its payments restored", [await count("SELECT COUNT(*) AS n FROM subscriptions WHERE id = ?", [netflixId]), (await payments()).rows.length], [1, paymentsBeforeDelete]);

/* ---------- categories ---------- */

reply = await act({ ok: true, kind: "category", category: { action: "create", name: "Travel", keywords: ["flight"] } });
check("category created", [reply.startsWith("*Category created*"), (await one("SELECT keywords FROM expense_categories WHERE user_id = ? AND name = 'Travel'", [userId]))?.keywords], [true, "flight"]);
await undo();
check("category create undone", await count("SELECT COUNT(*) AS n FROM expense_categories WHERE user_id = ? AND name = 'Travel'", [userId]), 0);

await act({ ok: true, kind: "category", category: { action: "create", name: "Travel", keywords: [] } });
await act({ ok: true, kind: "expense", expense: { amount: 20000, vendor: "PIA", note: "flight", date: today, categoryHint: "Travel" } });
const pia = await one("SELECT id, category FROM expenses WHERE user_id = ? AND vendor = 'PIA'", [userId]);
check("expense in the new category", pia?.category, "Travel");

reply = await act({ ok: true, kind: "category", category: { action: "rename", name: "Travel", newName: "Trips" } });
check("rename moves expenses", [reply.includes("1 expense moved with it"), (await one("SELECT category FROM expenses WHERE id = ?", [pia?.id as string]))?.category], [true, "Trips"]);
await undo();
check("category rename undone", [(await one("SELECT category FROM expenses WHERE id = ?", [pia?.id as string]))?.category, await count("SELECT COUNT(*) AS n FROM expense_categories WHERE user_id = ? AND name = 'Travel'", [userId])], ["Travel", 1]);

await act({ ok: true, kind: "category", category: { action: "keywords", name: "Travel", keywords: ["flight", "hotel"] } });
check("keywords set", (await one("SELECT keywords FROM expense_categories WHERE user_id = ? AND name = 'Travel'", [userId]))?.keywords, "flight, hotel");
await undo();
check("keywords undone", (await one("SELECT keywords FROM expense_categories WHERE user_id = ? AND name = 'Travel'", [userId]))?.keywords ?? null, null);

reply = await act({ ok: true, kind: "category", category: { action: "delete", name: "Travel" } });
check("delete category uncategorises", [reply.includes("1 expense is now uncategorised"), (await one("SELECT category FROM expenses WHERE id = ?", [pia?.id as string]))?.category ?? null], [true, null]);
await undo();
check("category delete undone", [(await one("SELECT category FROM expenses WHERE id = ?", [pia?.id as string]))?.category, await count("SELECT COUNT(*) AS n FROM expense_categories WHERE user_id = ? AND name = 'Travel'", [userId])], ["Travel", 1]);

/* ---------- questions and commands still work ---------- */

reply = await act({ ok: true, kind: "query", query: { type: "spending", people: [], year: Number(today.slice(0, 4)), month: Number(today.slice(5, 7)), category: null, vendor: null } });
check("spending answer", reply.startsWith("*Spent in"), true);
reply = await act({ ok: true, kind: "command", command: "list_categories" });
check("categories listed", [reply.startsWith("*Your categories*"), reply.includes("Travel")], [true, true]);

/* ---------- several expenses, reminders, feedback, insights ---------- */

reply = await act({
  ok: true,
  kind: "expenses_batch",
  expenses: [
    { amount: 100, vendor: "Tea Stall", note: "tea", date: today, categoryHint: null },
    { amount: 250, vendor: "Metro Bus", note: "bus", date: today, categoryHint: null },
  ],
});
const batchCount = () => count("SELECT COUNT(*) AS n FROM expenses WHERE user_id = ? AND vendor IN ('Tea Stall', 'Metro Bus')", [userId]);
check("batch added", [reply.startsWith("*2 expenses added*"), reply.includes("Total: Rs 350"), await batchCount()], [true, true, 2]);
reply = await undo();
check("batch undone together", [reply.includes("Expense removed: Rs 100 · Tea Stall"), reply.includes("Expense removed: Rs 250 · Metro Bus"), await batchCount()], [true, true, 0]);

reply = await act({ ok: true, kind: "feedback", text: "please add budgets" });
check("suggestion saved", [reply.startsWith("*Thanks - noted*"), (await dbm.listAssistantFeedback()).some((f) => f.text === "please add budgets" && f.kind === "suggestion")], [true, true]);
await runAction({ userId, messageId: `test-${randomUUID()}`, text: "what's the weather", image: null, audio: null }, { ok: false, reason: "I couldn't tell what to do with that. Try: fuel 3000 shell, who owes me?, mark Netflix paid - or tap What can I say?" });
check("not understood is logged for review", (await dbm.listAssistantFeedback()).some((f) => f.text === "what's the weather" && f.kind === "not_understood"), true);
await dbm.deleteAssistantFeedback();
check("feedback cleared", (await dbm.listAssistantFeedback()).length, 0);

await act({ ok: true, kind: "ledger", ledger: { direction: "lend", entries: [{ person: "Zara Test", amount: 1500, isNew: true }], note: "books" } });
await act({ ok: true, kind: "ledger", ledger: { direction: "repayment", entries: [{ person: "Zara Test", amount: 500, isNew: false }], note: null } });
reply = await act({ ok: true, kind: "insight", insight: { type: "person_history", person: "Zara Test" } });
check("person history", [reply.startsWith("*Zara Test's khata*"), reply.includes("Lent Rs 1,500"), reply.includes("Paid back Rs 500")], [true, true, true]);
await c.execute({ sql: "UPDATE people SET due_date = ? WHERE user_id = ? AND name = 'Zara Test'", args: [today, userId] });
reply = await act({ ok: true, kind: "insight", insight: { type: "udhar_due", days: 7 } });
check("who is due", [reply.startsWith("*Who is due to pay back*"), reply.includes("Zara Test: Rs 1,000")], [true, true]);
reply = await act({ ok: true, kind: "insight", insight: { type: "compare", a: { from: today, to: today, label: "Today" }, b: { from: "2000-01-01", to: "2000-01-01", label: "Yesterday" }, category: null } });
check("compare answers", [reply.startsWith("*Today vs yesterday*"), reply.includes("Yesterday, same days: Rs 0")], [true, true]);

/* ---------- another user's data is never touched ---------- */

await c.execute({
  sql: "INSERT INTO expenses (id, user_id, amount, note, expense_date, expense_datetime, created_at, vendor, category) VALUES (?, ?, 999, '', ?, '', ?, 'Shell', 'Car')",
  args: [randomUUID(), otherUser, today, now],
});
const steps = dbm.undoStatements(userId, [
  { op: "restore_expense", row: { id: "x", user_id: otherUser, amount: 1, note: "", expense_date: today, expense_datetime: "", created_at: now, vendor: null, category: null, vendor_key: null } },
]);
check("undo refuses to restore another user's row", steps.length, 0);
await act({ ok: true, kind: "expense_delete", target: target({ vendor: "shell", amount: 999 }) });
check("other user's expense untouched", await count("SELECT COUNT(*) AS n FROM expenses WHERE user_id = ?", [otherUser]), 1);

/* ---------- assistant access ---------- */

check("assistant access is off by default", await dbm.userHasAi(userId), false);
await dbm.setUserAiAccess(userId, true);
check("admin can switch assistant access on", [await dbm.userHasAi(userId), (await dbm.listUsers()).find((u) => u.id === userId)?.ai_access], [true, true]);
await dbm.setUserAiAccess(userId, false);
check("and off again", await dbm.userHasAi(userId), false);
const adminId = randomUUID();
await c.execute({ sql: "INSERT INTO users (id, username, password_hash, is_admin, created_at) VALUES (?, 'an-admin', 'unused', 1, ?)", args: [adminId, now] });
check("admins always have assistant access", [await dbm.userHasAi(adminId), (await dbm.listUsers()).find((u) => u.id === adminId)?.ai_access], [true, true]);
check("unknown account has no access", await dbm.userHasAi(randomUUID()), false);

/* ---------- deleting an account removes everything it owns ---------- */

const doomed = randomUUID();
await c.execute({
  sql: "INSERT INTO users (id, username, password_hash, is_admin, created_at) VALUES (?, 'delete-me', 'unused', 0, ?)",
  args: [doomed, now],
});
await dbm.listUserCategories(doomed); // seeds categories
const doomedSub = await dbm.createSubscription(doomed, "Netflix", 1500, today);
await dbm.listSubscriptions(doomed); // writes this month's payment row
await c.execute({
  sql: "INSERT INTO expenses (id, user_id, amount, note, expense_date, expense_datetime, created_at) VALUES (?, ?, 50, '', ?, '', ?)",
  args: [randomUUID(), doomed, today, now],
});
const doomedPerson = randomUUID();
await c.execute({ sql: "INSERT INTO people (id, name, created_at, user_id) VALUES (?, 'Kamran', ?, ?)", args: [doomedPerson, now, doomed] });
await c.execute({ sql: "INSERT INTO transactions (id, person_id, amount, note, created_at) VALUES (?, ?, 300, '', ?)", args: [randomUUID(), doomedPerson, now] });
await dbm.recordAssistantFeedback(doomed, "suggestion", "delete me too");
const otherBefore = await count("SELECT COUNT(*) AS n FROM expenses WHERE user_id = ?", [otherUser]);

await dbm.deleteUser(doomed);
const left = async (table: string, where = "user_id = ?") => count(`SELECT COUNT(*) AS n FROM ${table} WHERE ${where}`, [doomed]);
check(
  "account with a subscription deletes cleanly",
  [
    await left("users", "id = ?"),
    await left("subscriptions"),
    await count("SELECT COUNT(*) AS n FROM subscription_payments WHERE subscription_id = ?", [doomedSub.id]),
    await left("expenses"),
    await left("people"),
    await count("SELECT COUNT(*) AS n FROM transactions WHERE person_id = ?", [doomedPerson]),
    await left("expense_categories"),
    await left("assistant_feedback"),
  ],
  [0, 0, 0, 0, 0, 0, 0, 0]
);
check("other accounts untouched by a delete", await count("SELECT COUNT(*) AS n FROM expenses WHERE user_id = ?", [otherUser]), otherBefore);

/* ---------- reminders: who is notified, and the claim ---------- */

const mailUser = randomUUID();
await c.execute({
  sql: "INSERT INTO users (id, username, password_hash, is_admin, created_at) VALUES (?, ?, 'x', 0, ?)",
  args: [mailUser, "reminder-test", now],
});

// An account with no device registered has nowhere to send to.
check("no device means no recipient", await dbm.getNotificationRecipient(mailUser), null);
check("and it is not in the list", (await dbm.listNotificationRecipients()).some((u) => u.id === mailUser), false);

await dbm.savePushSubscription(mailUser, { endpoint: "https://push.example/first", p256dh: "k", auth: "a" });
const fresh = await dbm.getNotificationRecipient(mailUser);
check("a registered device gets every kind by default", fresh?.prefs, {
  subscriptions: true,
  udhar: true,
  dailyRecap: true,
  monthlySummary: true,
});
check("and is in the list", (await dbm.listNotificationRecipients()).filter((u) => u.id === mailUser).length, 1);

await dbm.updateUserProfile(mailUser, { prefs: { dailyRecap: false } });
const narrowed = await dbm.getNotificationRecipient(mailUser);
check("one kind switched off leaves the rest alone", narrowed?.prefs, {
  subscriptions: true,
  udhar: true,
  dailyRecap: false,
  monthlySummary: true,
});

// The claim is what stops two senders - a scheduled run and the app's
// catch-up - sending the same reminder.
const key = "recap:2026-09-15";
check("first claim wins", await dbm.claimReminder(mailUser, key), true);
check("second claim finds it taken", await dbm.claimReminder(mailUser, key), false);
check("another account isn't blocked by it", await dbm.claimReminder(userId, key), true);
await dbm.releaseReminder(mailUser, key);
check("a released claim can be taken again", await dbm.claimReminder(mailUser, key), true);

/* ---------- push notifications: one row per device ---------- */

const device = { endpoint: "https://push.example/abc", p256dh: "key-one", auth: "auth-one" };
await dbm.savePushSubscription(mailUser, device);
await dbm.savePushSubscription(mailUser, { ...device, endpoint: "https://push.example/second" });
check("each device is its own row", (await dbm.listPushSubscriptions(mailUser)).length, 3);

// The same phone subscribing again replaces its row rather than adding one.
await dbm.savePushSubscription(mailUser, { ...device, p256dh: "key-two" });
const devices = await dbm.listPushSubscriptions(mailUser);
check("re-subscribing replaces that device", [devices.length, devices.find((d) => d.endpoint === device.endpoint)?.p256dh], [3, "key-two"]);

await dbm.deletePushSubscription(device.endpoint, mailUser);
check("a device can be removed", (await dbm.listPushSubscriptions(mailUser)).length, 2);
check("another account sees none of them", (await dbm.listPushSubscriptions(userId)).length, 0);

await dbm.deleteUser(mailUser);
check("deleting an account takes its devices with it", (await dbm.listPushSubscriptions(mailUser)).length, 0);

c.close();
rmSync(dir, { recursive: true, force: true });
console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
