import {
  MAX_HISTORY_TURNS,
  NOT_UNDERSTOOD,
  TOOLS,
  buildSystemPrompt,
  extractFunctionCall,
  interpretCall,
  keywordList,
  matchByName,
  matchExpenses,
  nextDueDate,
  sanitizeHistory,
  type ActionContext,
  type ExpenseLite,
} from "../src/lib/assistant-actions.ts";
import {
  HELP_REPLY,
  categoriesListReply,
  categoryCreatedReply,
  categoryDeletedReply,
  categoryRenamedReply,
  expenseDeletedReply,
  expenseEditedReply,
  ordinal,
  personDeletedReply,
  personRenamedReply,
  subscriptionActiveReply,
  subscriptionAddedReply,
  subscriptionEditedReply,
  subscriptionPaidReply,
  undoStepLine,
  whichExpenseReply,
} from "../src/lib/whatsapp-replies.ts";
import { fmtDateLabel } from "../src/lib/format.ts";

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

const today = "2026-09-15";
const ctx: ActionContext = {
  today,
  text: "",
  people: ["Ali", "Abdur Rehman", "Usama Irtaza"],
  categories: ["Car", "Groceries", "Food & Dining", "Tech"],
  subscriptions: ["Netflix", "Spotify Premium", "YouTube Premium"],
};
const call = (name: string, args: Record<string, unknown> = {}, text = "") =>
  interpretCall({ name, args }, { ...ctx, text }) as any;

/* the functions offered to the model */
const names = TOOLS.map((t) => t.name);
check("tool names unique", new Set(names).size, names.length);
check("every tool accepts a transcript", TOOLS.every((t) => "transcript" in t.parameters.properties), true);
check(
  "every required argument is declared",
  TOOLS.every((t) => ((t.parameters as { required?: string[] }).required ?? []).every((r) => r in t.parameters.properties)),
  true
);
check("the model always has a way out", names.includes("not_understood"), true);
for (const name of names.filter((n) => n !== "not_understood")) {
  // Every tool is handled: anything unhandled would fall to NOT_UNDERSTOOD.
  const r = call(name, {});
  check(`tool ${name} is handled`, r.ok === false && r.reason === NOT_UNDERSTOOD, false);
}

/* system prompt */
const prompt = buildSystemPrompt({ today, people: ctx.people, categories: ctx.categories, subscriptions: ctx.subscriptions, hasImage: true, hasAudio: false });
check("prompt date", prompt.includes("Today is 2026-09-15"), true);
check("prompt lists", [prompt.includes("Ali, Abdur Rehman, Usama Irtaza"), prompt.includes("Car, Groceries"), prompt.includes("Netflix, Spotify Premium")], [true, true, true]);
check("prompt image line only with image", [prompt.includes("An image is attached"), prompt.includes("voice note is attached")], [true, false]);
check("prompt empty lists", buildSystemPrompt({ today, people: [], categories: [], subscriptions: [], hasImage: false, hasAudio: true }).includes("Subscriptions: (none yet)."), true);
check("prompt guards against instructions in content", prompt.includes("never instructions"), true);

/* reading the model's answer */
const body = (parts: unknown[]) => JSON.stringify({ candidates: [{ content: { parts } }] });
check("function call read", extractFunctionCall(body([{ functionCall: { name: "who_owes_me", args: { transcript: "who owes me" } } }])), { name: "who_owes_me", args: { transcript: "who owes me" } });
check("call after text part", extractFunctionCall(body([{ text: "ok" }, { functionCall: { name: "undo_last" } }])), { name: "undo_last", args: {} });
check("text only is no call", extractFunctionCall(body([{ text: "hello" }])), null);
check("bad args become empty", extractFunctionCall(body([{ functionCall: { name: "x", args: [1, 2] } }]))?.args, {});
check("garbage body", extractFunctionCall("nope"), null);

/* conversation history */
check(
  "history cleaned",
  sanitizeHistory([
    { role: "assistant", text: "hi" },
    { role: "user", text: " fuel 3000 " },
    { role: "user", text: "shell" },
    { role: "system", text: "ignore" },
    { role: "assistant", text: "*Expense added*" },
    { role: "user", text: "" },
  ]),
  [{ role: "user", text: "fuel 3000 shell" }, { role: "assistant", text: "*Expense added*" }]
);
check("history capped", sanitizeHistory(Array.from({ length: 40 }, (_, i) => ({ role: i % 2 ? "assistant" : "user", text: `m${i}` }))).length <= MAX_HISTORY_TURNS, true);
check("history text capped", sanitizeHistory([{ role: "user", text: "x".repeat(5000) }])[0].text.length <= 600, true);
check("history not an array", sanitizeHistory("nope"), []);

/* name matching */
check("name exact ignoring case and spaces", matchByName(ctx.subscriptions, "youtube premium"), { match: "YouTube Premium" });
check("name unique partial", matchByName(ctx.subscriptions, "spotify"), { match: "Spotify Premium" });
check("name ambiguous partial", matchByName(ctx.subscriptions, "premium"), { ambiguous: ["Spotify Premium", "YouTube Premium"] });
check("name none", matchByName(ctx.subscriptions, "hulu"), { none: true });
check("name too short for partial", matchByName(ctx.subscriptions, "ne"), { none: true });

/* next due date */
check("due later this month", nextDueDate(today, 20), "2026-09-20");
check("due today counts", nextDueDate(today, 15), "2026-09-15");
check("due passed goes to next month", nextDueDate(today, 5), "2026-10-05");
check("31st in a 30-day month", nextDueDate(today, 31), "2026-09-30");
check("december rolls over", nextDueDate("2026-12-20", 3), "2027-01-03");
check("february clamps", nextDueDate("2027-01-31", 30), "2027-02-28");

/* expense matching */
const expenses: ExpenseLite[] = [
  { id: "a", amount: 3000, vendor: "Shell", note: "fuel", category: "Car", date: "2026-09-14" },
  { id: "b", amount: 500, vendor: null, note: "Assistant: fuel at attock", category: "Car", date: "2026-09-15" },
  { id: "c", amount: 387, vendor: "Daraz", note: "", category: null, date: "2026-09-15" },
];
const t = (o: Partial<{ vendor: string; amount: number; date: string; category: string }>) => ({ which: "match" as const, vendor: null, amount: null, date: null, category: null, ...o });
check("match by vendor in note", matchExpenses(expenses, t({ vendor: "attock" })).map((e) => e.id), ["b"]);
check("match by amount tolerance", matchExpenses(expenses, t({ amount: 3000.4 })).map((e) => e.id), ["a"]);
check("match uncategorised", matchExpenses(expenses, t({ category: "Uncategorised" })).map((e) => e.id), ["c"]);
check("match several", matchExpenses(expenses, t({ category: "Car" })).map((e) => e.id), ["a", "b"]);
check("match date and category", matchExpenses(expenses, t({ category: "Car", date: "2026-09-14" })).map((e) => e.id), ["a"]);

/* existing actions go through the tested validators */
check("add expense", call("add_expense", { amount: 3000, vendor: "Shell", category: "car" }).kind, "expense");
check("add expense bad amount", call("add_expense", { amount: -3 }).ok, false);
check("lend", call("lend_money", { entries: [{ person: "ali", amount: 700 }] }).ledger?.entries, [{ person: "Ali", amount: 700, isNew: false }]);
check("repay all", call("record_repayment", { entries: [{ person: "Ali", all: true }] }, "ali paid all his debt").ledger?.entries, [{ person: "Ali", amount: null, isNew: false, all: true }]);
check("due date", call("set_due_date", { person: "ali", date: "2026-10-01" }).due, { person: "Ali", date: "2026-10-01" });
check("due date clear", call("set_due_date", { person: "ali", clear: true }).due, { person: "Ali", date: null });
check("person balance", call("person_balance", { people: ["abdurrehman"] }).query?.people, ["Abdur Rehman"]);
check("who owes me", call("who_owes_me").query?.type, "udhar_summary");
check("spending", [call("spending_total", { month: 8, category: "car" }).query?.month, call("spending_total", { month: 8, category: "car" }).query?.category], [8, "Car"]);
check("recent", call("recent_expenses").query?.type, "recent_expenses");
check("subscriptions due", call("subscriptions_due").query?.type, "subscriptions_due");
check("commands", [call("undo_last").command, call("show_help").command, call("list_categories").command], ["undo", "help", "list_categories"]);
check("not understood", call("not_understood").reason, NOT_UNDERSTOOD);
check("unknown function", call("transfer_crypto").ok, false);
check("no call", (interpretCall(null, ctx) as any).reason, NOT_UNDERSTOOD);

/* editing and deleting expenses */
check(
  "edit last added",
  call("edit_expense", { target: { which: "last_added" }, changes: { amount: 2500, category: "groceries" } }),
  { ok: true, kind: "expense_edit", target: { which: "last_added", vendor: null, amount: null, date: null, category: null }, changes: { amount: 2500, category: "Groceries" } }
);
check("edit to uncategorised", call("edit_expense", { target: { which: "latest" }, changes: { category: "Uncategorised" } }).changes, { category: null });
check("edit with no changes refused", call("edit_expense", { target: { which: "latest" }, changes: {} }).ok, false);
check("edit to unknown category refused", call("edit_expense", { target: { which: "latest" }, changes: { category: "Travel" } }).reason.includes("create category Travel"), true);
check("edit bad amount refused", call("edit_expense", { target: { which: "latest" }, changes: { amount: 0 } }).ok, false);
check("edit future date refused", call("edit_expense", { target: { which: "latest" }, changes: { date: "2026-09-20" } }).ok, false);
check("edit impossible date refused", call("edit_expense", { target: { which: "latest" }, changes: { date: "2026-02-30" } }).ok, false);
check("edit with a vague target refused", call("edit_expense", { target: { which: "match" }, changes: { amount: 5 } }).ok, false);
check("unknown which becomes match", call("delete_expense", { target: { which: "that one", vendor: "shell" } }).target?.which, "match");
check("delete by details", call("delete_expense", { target: { which: "match", vendor: "Shell", amount: "3000", date: "2026-09-14" } }).target, { which: "match", vendor: "Shell", amount: 3000, date: "2026-09-14", category: null });
check("delete target category matched", call("delete_expense", { target: { which: "match", category: "tech" } }).target?.category, "Tech");

/* people */
check("rename person", call("rename_person", { person: "ali", new_name: "ali raza" }), { ok: true, kind: "person_rename", person: "Ali", newName: "Ali Raza" });
check("rename unknown refused", call("rename_person", { person: "Bilal", new_name: "Bilal Khan" }).ok, false);
check("rename onto another person refused", call("rename_person", { person: "Ali", new_name: "abdur rehman" }).ok, false);
check("rename to digits refused", call("rename_person", { person: "Ali", new_name: "ali 2" }).ok, false);
check("rename to same refused", call("rename_person", { person: "Ali", new_name: "Ali" }).ok, false);
check("delete person", call("delete_person", { person: "usama irtaza" }), { ok: true, kind: "person_delete", person: "Usama Irtaza" });
check("delete unknown person refused", call("delete_person", { person: "Bilal" }).ok, false);

/* subscriptions */
check("add subscription by day", call("add_subscription", { name: "Hulu", amount: 1200, due_day: 5 }).sub, { action: "add", name: "Hulu", amount: 1200, firstDueDate: "2026-10-05" });
check("add subscription by date", call("add_subscription", { name: "Hulu", amount: 1200, first_due_date: "2026-09-25" }).sub?.firstDueDate, "2026-09-25");
check("add existing refused", call("add_subscription", { name: "netflix", amount: 1500, due_day: 3 }).ok, false);
check("add without day refused", call("add_subscription", { name: "Hulu", amount: 1200 }).ok, false);
check("add bad day refused", call("add_subscription", { name: "Hulu", amount: 1200, due_day: 40 }).ok, false);
check("add far date refused", call("add_subscription", { name: "Hulu", amount: 1200, first_due_date: "2028-01-01" }).ok, false);
check("mark paid partial name", call("mark_subscription_paid", { name: "spotify" }).sub, { action: "mark_paid", name: "Spotify Premium" });
check("pause ambiguous refused", call("pause_subscription", { name: "premium" }).reason.includes("Spotify Premium, YouTube Premium"), true);
check("resume", call("resume_subscription", { name: "YouTube" }).sub?.action, "resume");
check("delete unknown refused", call("delete_subscription", { name: "Hulu" }).ok, false);
check("edit subscription", call("edit_subscription", { name: "netflix", amount: 1800, due_day: 20 }).sub, { action: "edit", name: "Netflix", newName: null, amount: 1800, dueDay: 20 });
check("edit subscription rename", call("edit_subscription", { name: "netflix", new_name: "Netflix HD" }).sub?.newName, "Netflix HD");
check("edit subscription nothing refused", call("edit_subscription", { name: "netflix", new_name: "Netflix" }).ok, false);
check("edit subscription bad day refused", call("edit_subscription", { name: "netflix", due_day: 0 }).ok, false);
check("edit subscription onto another refused", call("edit_subscription", { name: "netflix", new_name: "spotify premium" }).ok, false);

/* categories */
check("create category", call("create_category", { name: "Travel", keywords: ["Flight", " hotel ", "flight"] }).category, { action: "create", name: "Travel", keywords: ["flight", "hotel"] });
check("keywords from a string", keywordList("flight, hotel,,"), ["flight", "hotel"]);
check("create existing refused", call("create_category", { name: "groceries" }).ok, false);
check("create catch-all refused", call("create_category", { name: "Transfer" }).ok, false);
check("create uncategorised refused", call("create_category", { name: "Uncategorised" }).ok, false);
check("create too long refused", call("create_category", { name: "x".repeat(45) }).ok, false);
check("rename category", call("rename_category", { name: "tech", new_name: "Gadgets" }).category, { action: "rename", name: "Tech", newName: "Gadgets" });
check("rename category partial", call("rename_category", { name: "food", new_name: "Eating out" }).category?.name, "Food & Dining");
check("rename onto existing refused", call("rename_category", { name: "Tech", new_name: "car" }).ok, false);
check("delete category", call("delete_category", { name: "car" }).category, { action: "delete", name: "Car" });
check("delete unknown category refused", call("delete_category", { name: "Travel" }).ok, false);
check("set keywords", call("set_category_keywords", { name: "Car", keywords: ["petrol", "Shell"] }).category, { action: "keywords", name: "Car", keywords: ["petrol", "shell"] });

/* replies */
const view = { amount: 3000, vendor: "Shell", category: "Car", date: "2026-09-14", note: "fuel" };
check(
  "edited reply shows only what changed",
  expenseEditedReply({ before: view, after: { ...view, amount: 2500, category: "Groceries" } }),
  `*Expense updated*\n\nShell · ${fmtDateLabel("2026-09-14")}\n\nAmount: Rs 3,000 → Rs 2,500\nCategory: Car → Groceries\n\nReply *UNDO* to change it back.`
);
check("edited reply with nothing different", expenseEditedReply({ before: view, after: view }).includes("It already had those details."), true);
check("deleted reply", expenseDeletedReply({ ...view, category: null }), `*Expense deleted*\n\nRs 3,000 · Shell · Uncategorised · ${fmtDateLabel("2026-09-14")}\n\nReply *UNDO* to bring it back.`);
check("which reply caps at five", whichExpenseReply(Array.from({ length: 7 }, () => view)).includes("…and 2 more"), true);
check("which reply count", whichExpenseReply([view, view]).includes("2 expenses match that:"), true);
check("renamed reply", personRenamedReply({ from: "Ali", to: "Ali Raza" }), "*Name changed*\n\nAli → *Ali Raza*\n\nReply *UNDO* to change it back.");
check("person deleted reply", personDeletedReply({ name: "Ali", balance: 700, entries: 1 }), "*Removed from Udhar Khata*\n\n*Ali*\n1 entry removed\nBalance: owes you Rs 700\n\nReply *UNDO* to bring them back.");
check("subscription added reply", subscriptionAddedReply({ name: "Hulu", amount: 1200, firstDueDate: "2026-10-05" }).includes(`First due: ${fmtDateLabel("2026-10-05")}`), true);
check("subscription paid reply", subscriptionPaidReply({ name: "Netflix", amount: 1500, period: "2026-09", nextDueDate: "2026-10-03" }), `*Marked paid*\n\n*Netflix*: Rs 1,500\nPaid for September 2026\nNext due: ${fmtDateLabel("2026-10-03")}\n\nReply *UNDO* to mark it unpaid.`);
check("paused reply", subscriptionActiveReply({ name: "Netflix", active: false }).startsWith("*Subscription paused*"), true);
check("subscription edited reply", subscriptionEditedReply({ before: { name: "Netflix", amount: 1500, dueDay: 3 }, after: { name: "Netflix", amount: 1800, dueDay: 21 } }), "*Subscription updated*\n\n*Netflix*\nAmount: Rs 1,500 → Rs 1,800\nDue: the 3rd → the 21st\n\nReply *UNDO* to change it back.");
check("category created reply", categoryCreatedReply({ name: "Travel", keywords: ["flight"] }), "*Category created*\n\n*Travel*\nKeywords: flight\n\nReply *UNDO* to remove it.");
check("category renamed reply", categoryRenamedReply({ from: "Tech", to: "Gadgets", moved: 3 }).includes("3 expenses moved with it"), true);
check("category deleted reply", [categoryDeletedReply({ name: "Car", expenses: 1 }).includes("1 expense is now uncategorised"), categoryDeletedReply({ name: "Car", expenses: 0 }).includes("It had no expenses.")], [true, true]);
check("categories list reply", categoriesListReply([{ name: "Car", keywords: ["fuel"] }, { name: "Tech", keywords: [] }]), "*Your categories*\n\nCar (fuel)\nTech\n\nSay: create category Travel, to add one.");
check("ordinals", [1, 2, 3, 4, 11, 12, 13, 21, 22, 23, 31].map(ordinal), ["1st", "2nd", "3rd", "4th", "11th", "12th", "13th", "21st", "22nd", "23rd", "31st"]);
check("help covers everything", ["*Expenses*", "*Udhar Khata*", "*Subscriptions*", "*Categories*", "*Questions*"].every((h) => HELP_REPLY.includes(h)), true);

/* undo lines */
const row = { id: "e", user_id: "u", amount: 500, note: "", expense_date: today, expense_datetime: "", created_at: "", vendor: "Shell", category: "Car", vendor_key: "shell" };
const sub = { id: "s", user_id: "u", name: "Netflix", amount: 1500, due_day: 3, logo_url: null, active: 0, created_at: "" };
check(
  "undo lines",
  [
    undoStepLine({ op: "restore_expense", row }),
    undoStepLine({ op: "revert_expense", before: row, rule: null }),
    undoStepLine({ op: "remove_subscription", id: "s", name: "Hulu" }),
    undoStepLine({ op: "restore_subscription", sub, payments: [] }),
    undoStepLine({ op: "revert_subscription", before: sub }),
    undoStepLine({ op: "unmark_paid", name: "Netflix", paymentId: "p", addedPaymentId: null }),
    undoStepLine({ op: "rename_person", personId: "p", name: "Ali", renamedTo: "Ali Raza" }),
    undoStepLine({ op: "restore_person", person: { id: "p", name: "Ali", created_at: "", user_id: "u", due_date: null }, transactions: [] }),
    undoStepLine({ op: "remove_category", name: "Travel" }),
    undoStepLine({ op: "rename_category", from: "Gadgets", to: "Tech" }),
    undoStepLine({ op: "restore_category", category: { name: "Car", keywords: null, sort_order: 1, created_at: "" }, expenseIds: [], rules: [] }),
    undoStepLine({ op: "set_category_keywords", name: "Car", keywords: null }),
  ],
  [
    "Expense back: Rs 500 · Shell",
    "Expense back to Rs 500 · Shell (Car)",
    "Subscription removed: Hulu",
    "Subscription back: Netflix",
    "Netflix back to Rs 1,500, due on the 3rd (paused)",
    "Netflix marked unpaid again",
    "Ali Raza renamed back to Ali",
    "Ali back in Udhar Khata",
    "Category removed: Travel",
    "Category renamed back to Tech",
    "Category back: Car",
    "Keywords for Car put back",
  ]
);

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
