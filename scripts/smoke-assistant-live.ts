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

const cases: {
  text: string;
  want: string;
  history?: ChatTurn[];
  kind?: string;
  label?: string;
  category?: string;
  month?: number;
  type?: string;
}[] = [
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
  { text: "how much did I spend today", want: "spending_total", kind: "query", label: "Today" },
  { text: "aaj kitna kharcha hua", want: "spending_total", kind: "query", label: "Today" },
  { text: "spending this week", want: "spending_total", kind: "query", label: "This week" },
  { text: "what did I spend this week?", want: "spending_total", kind: "query", label: "This week", type: "spending" },
  { text: "how much on food last month", want: "spending_total", kind: "query", label: "Last month", category: "Food & Dining" },
  { text: "how much did I spend on fuel in august", want: "spending_total", kind: "query", month: 8 },
  { text: "show my biggest expenses this month", want: "list_expenses", kind: "query", type: "expense_list" },
  { text: "list my subscriptions", want: "subscriptions_overview", kind: "query", type: "subscriptions_overview" },
  { text: "gave ali 2000", want: "lend_money", kind: "ledger" },
  { text: "usama ko 500 udhar diye", want: "lend_money", kind: "ledger" },
  { text: "irtaza ne 300 wapas kiye", want: "record_repayment", kind: "ledger" },
  { text: "paid electricity bill 8500", want: "add_expense", kind: "expense" },
  { text: "kal 1200 ka khana khaya kfc", want: "add_expense", kind: "expense" },
  { text: "paid netflix", want: "mark_subscription_paid", kind: "subscription" },
  { text: "fuel 3000 and lunch 800", want: "add_expenses", kind: "expenses_batch" },
  { text: "show me ali's full history", want: "person_history", kind: "insight" },
  { text: "compare this month with last month", want: "compare_spending", kind: "insight" },
  { text: "who has to pay me back this week", want: "udhar_due", kind: "insight" },
  { text: "how do I set up email reminders?", want: "app_help", kind: "app_question" },
  { text: "turn off my email reminders", want: "set_email_reminders", kind: "reminders" },
  { text: "I wish the app had a budget feature", want: "send_feedback", kind: "feedback" },
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
    const action = result.action as {
      ok: boolean;
      kind?: string;
      reason?: string;
      query?: { type: string; label?: string | null; category: string | null; month: number | null };
    };
    // interpretCall doesn't expose the function name, so the action kind stands in for it.
    const q = action.query;
    const picked = action.ok ? `${action.kind}${q ? ` ${q.type}/${q.label ?? q.month}/${q.category}` : ""}` : `refused: ${action.reason}`;
    const pass =
      (c.kind ? action.ok && action.kind === c.kind : !action.ok) &&
      (c.label === undefined || q?.label === c.label) &&
      (c.category === undefined || q?.category === c.category) &&
      (c.month === undefined || q?.month === c.month) &&
      (c.type === undefined || q?.type === c.type);
    if (pass) good++;
    console.log(`${pass ? "ok  " : "MISS"} ${c.text.padEnd(55)} want ${c.want.padEnd(24)} got ${picked}  [${result.model}, ${Date.now() - started}ms]`);
  } catch (err) {
    console.log(`ERR  ${c.text.padEnd(55)} ${(err as Error).message.slice(0, 200)}`);
  }
}
console.log(`\n${good}/${cases.length} as expected`);
process.exit(good === cases.length ? 0 : 1);
