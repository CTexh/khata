// Sends realistic messages to the real Gemini API and checks the model picks
// the right action and that Khata's checks accept it. Uses sample names only
// and never touches a database. Needs GEMINI_API_KEY (e.g. in .env.local):
//   node --experimental-strip-types --env-file-if-exists=.env.local scripts/smoke-assistant-live.ts
import { understandMessage, type ChatTurn } from "../src/lib/assistant-actions.ts";

if (!process.env.GEMINI_API_KEY) {
  console.log("GEMINI_API_KEY is not set - add it to .env.local to run the live check.");
  process.exit(2);
}

const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Karachi" }).format(new Date());
const people = ["Ali", "Abdur Rehman", "Usama Irtaza", "Ahmed Zahid"];
const categories = ["Car", "Groceries", "Food & Dining", "Shopping", "Tech", "Medical"];
const subscriptions = ["Netflix", "Spotify Premium", "YouTube Premium"];

const afterAdding: ChatTurn[] = [
  { role: "user", text: "fuel 3000 shell" },
  { role: "assistant", text: "*Expense added* Amount: Rs 3,000 Category: Car Vendor: Shell Reply *UNDO* to remove it." },
];

const cases: { text: string; want: string; history?: ChatTurn[]; kind?: string }[] = [
  { text: "fuel 3000 shell", want: "add_expense", kind: "expense" },
  { text: "How much abdurrehman owe me", want: "person_balance", kind: "query" },
  { text: "who owes me?", want: "who_owes_me", kind: "query" },
  { text: "ahmed zahid paid all his dept", want: "record_repayment", kind: "ledger" },
  { text: "add new borrower habib ullah with 500 in his name", want: "lend_money", kind: "ledger" },
  { text: "change it to 2500", want: "edit_expense", history: afterAdding, kind: "expense_edit" },
  { text: "delete yesterday's fuel", want: "delete_expense", kind: "expense_delete" },
  { text: "mark netflix paid", want: "mark_subscription_paid", kind: "subscription" },
  { text: "add spotify family 1200 due on the 5th", want: "add_subscription", kind: "subscription" },
  { text: "pause youtube", want: "pause_subscription", kind: "subscription" },
  { text: "create category travel with keywords flight and hotel", want: "create_category", kind: "category" },
  { text: "rename tech to gadgets", want: "rename_category", kind: "category" },
  { text: "rename ali to ali raza", want: "rename_person", kind: "person_rename" },
  { text: "what did I spend this month", want: "spending_total", kind: "query" },
  { text: "ali will pay back on 1st october", want: "set_due_date", kind: "due_date" },
  { text: "what's the weather like in lahore", want: "not_understood" },
];

let good = 0;
for (const c of cases) {
  const started = Date.now();
  try {
    const result = await understandMessage({
      text: c.text,
      image: null,
      audio: null,
      history: c.history ?? [],
      people,
      categories,
      subscriptions,
      today,
    });
    const action = result.action as { ok: boolean; kind?: string; reason?: string };
    // interpretCall doesn't expose the function name, so the action kind stands in for it.
    const picked = action.ok ? action.kind : `refused: ${action.reason}`;
    const pass = c.kind ? action.ok && action.kind === c.kind : !action.ok;
    if (pass) good++;
    console.log(`${pass ? "ok  " : "MISS"} ${c.text.padEnd(55)} want ${c.want.padEnd(24)} got ${picked}  [${result.model}, ${Date.now() - started}ms]`);
  } catch (err) {
    console.log(`ERR  ${c.text.padEnd(55)} ${(err as Error).message.slice(0, 200)}`);
  }
}
console.log(`\n${good}/${cases.length} as expected`);
process.exit(good === cases.length ? 0 : 1);
