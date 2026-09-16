// The Khata assistant: one message in, one reply out. Works out what the
// message records or asks - an expense, money lent or paid back, a change to a
// subscription or category, a question about the user's data - carries it
// out, and writes the reply. The in-app route delivers messages and fetches
// replies; nothing here depends on how that happens.
import {
  attachInboundExpense,
  attachInboundTransactions,
  attachInboundUndo,
  ensureTablesExist,
  insertExpense,
  listExpenses,
  listLedgerPeople,
  listRecentExpenses,
  listSubscriptions,
  listUserCategories,
  loadModelHealth,
  resolveExpenseCategory,
  saveModelHealth,
  setPersonDueDate,
  undoLastAssistantEntry,
  writeLedgerEntries,
  createSubscription,
  createUserCategory,
  deleteExpenseRow,
  deletePersonRow,
  deleteSubscription,
  deleteUserCategory,
  editExpenseRow,
  getCategorySnapshot,
  getExpenseRow,
  getPersonSnapshot,
  getSubscriptionSnapshot,
  lastAddedExpenseId,
  latestExpenseId,
  listExpenseRowsSince,
  listSubscriptionRows,
  markSubscriptionPaidTracked,
  renamePersonRow,
  updateSubscriptionFields,
  updateUserCategory,
  listExpensesInRange,
  listTx,
  getProfileSettings,
  updateUserProfile,
  recordAssistantFeedback,
  type Expense,
  type ExpenseRow,
  type LedgerPerson,
  type LedgerWrite,
} from "@/lib/db";
import {
  NOT_UNDERSTOOD,
  answerAppQuestion,
  detectCommand,
  matchExpenses,
  understandMessage,
  type Insight,
  type Action,
  type CategoryAction,
  type ChatTurn,
  type Command,
  type ExpenseChanges,
  type ExpenseTarget,
  type SubscriptionAction,
} from "@/lib/assistant-actions";
import {
  GeminiBusyError,
  addDays,
  pakistanToday,
  parseOffline,
  personKey,
  type Attempt,
  type HealthStore,
  type ParsedDueDate,
  type ParsedExpense,
  type ParsedLedger,
  type ParsedQuery,
} from "@/lib/expense-parse";
import {
  BUSY_REPLY,
  ERROR_REPLY,
  HELP_REPLY,
  ambiguousPersonReply,
  dueDateReply,
  expenseAddedReply,
  ledgerReply,
  periodLabel,
  recentExpensesReply,
  QUESTION_REFUSAL_HEADING,
  refusalReply,
  spendingReply,
  subscriptionsDueReply,
  udharPersonReply,
  udharSummaryReply,
  undoReply,
  categoriesListReply,
  categoryCreatedReply,
  categoryDeletedReply,
  categoryKeywordsReply,
  categoryRenamedReply,
  expenseDeletedReply,
  expenseEditedReply,
  personDeletedReply,
  personRenamedReply,
  subscriptionActiveReply,
  subscriptionAddedReply,
  subscriptionDeletedReply,
  subscriptionEditedReply,
  subscriptionPaidReply,
  whichExpenseReply,
  expenseListReply,
  rangeLabel,
  subscriptionsOverviewReply,
  whenPhrase,
  FEEDBACK_REPLY,
  appHelpReply,
  compareReply,
  expensesBatchReply,
  personHistoryReply,
  udharDueReply,
  type ExpenseView,
} from "@/lib/assistant-replies";

const health: HealthStore = { load: loadModelHealth, save: saveModelHealth };

export type AssistantInput = {
  userId: string;
  // Already recorded in whatsapp_inbound by the caller: it is what ties saved
  // entries to this message, so UNDO can reverse them.
  messageId: string;
  text: string;
  image: { data: string; mimeType: string } | null;
  // A voice note, already converted to a format Gemini accepts.
  audio: { data: string; mimeType: string } | null;
  // Recent turns of the conversation, so follow-ups like "change it to 2500"
  // can be understood.
  history?: ChatTurn[];
};

// One JSON line per message, so a message can be traced in Vercel's logs:
// what it was, which models were tried and how long each took, and how it
// ended. Deliberately no message text, amounts or names.
export type AssistantLog = {
  evt: "assistant";
  msg: string; // tail of the message id
  type: "text" | "image" | "audio";
  outcome: string;
  kind?: string;
  queryType?: string;
  direction?: "lend" | "repayment";
  entries?: number;
  newPeople?: number;
  category?: string | null;
  parser?: "gemini" | "offline";
  model?: string;
  attempts?: Attempt[];
  error?: string;
  totalMs: number;
};

// `heard` is what a voice note was transcribed to. The page shows it on the
// message the user sent, rather than repeating it back inside the reply.
export type AssistantResult = { reply: string | null; heard: string | null; log: AssistantLog };

export async function runAssistant(input: AssistantInput): Promise<AssistantResult> {
  const started = Date.now();
  const log: AssistantLog = {
    evt: "assistant",
    msg: input.messageId.slice(-8),
    type: input.audio ? "audio" : input.image ? "image" : "text",
    outcome: "error",
    totalMs: 0,
  };
  let reply: string | null = null;
  const spoken: { heard: string | null } = { heard: null };
  try {
    reply = await handle(input, log, spoken);
  } catch (err) {
    const busy = err instanceof GeminiBusyError;
    log.outcome = busy ? "busy" : "error";
    log.error = (err as Error).message.slice(0, 300);
    if (busy) log.attempts = err.attempts;
    reply = busy ? BUSY_REPLY : ERROR_REPLY;
  } finally {
    log.totalMs = Date.now() - started;
    const line = JSON.stringify(log);
    if (log.outcome === "error") console.error(line);
    else if (log.outcome === "busy") console.warn(line);
    else console.log(line);
  }
  return { reply, heard: spoken.heard, log };
}

async function handle(
  input: AssistantInput,
  log: AssistantLog,
  spoken: { heard: string | null }
): Promise<string | null> {
  const { userId, text, image, audio } = input;

  const command = detectCommand(text);
  if (command === "help") {
    log.outcome = "help";
    return HELP_REPLY;
  }
  if (command === "undo") {
    const undone = await undoLastAssistantEntry(userId);
    log.outcome = undone ? "undone" : "undo_nothing";
    return undoReply(undone);
  }
  if (!text && !image && !audio) {
    log.outcome = "empty";
    return null;
  }

  const [categories, people, subscriptions] = await Promise.all([
    listUserCategories(userId).then((list) => list.map((c) => c.name)),
    listLedgerPeople(userId),
    listSubscriptionRows(userId),
  ]);
  const names = people.map((p) => p.name);

  let outcome: Action;
  let offline = false;
  let heard: string | null = null;
  try {
    const result = await understandMessage({
      text,
      image,
      audio,
      history: input.history ?? [],
      people: names,
      categories,
      subscriptions: subscriptions.map((sub) => sub.name),
      today: pakistanToday(),
      health,
    });
    outcome = result.action;
    heard = result.transcript;
    spoken.heard = result.transcript;
    log.parser = "gemini";
    log.model = result.model;
    log.attempts = result.attempts;
  } catch (err) {
    // Every model failed. A simple text expense can still be read without the
    // model; photos, questions and Udhar Khata updates can't, so those get "busy".
    if (!(err instanceof GeminiBusyError) || image || audio) throw err;
    log.attempts = err.attempts;
    log.parser = "offline";
    outcome = parseOffline(text, pakistanToday(), names);
    if (!outcome.ok) throw err;
    offline = true;
  }

  // What was heard travels back separately: the page shows it as the message
  // that was sent, so a mishearing is obvious without the reply repeating it.
  return act(input, outcome, heard, people, categories, offline, log);
}

async function act(
  input: AssistantInput,
  outcome: Action,
  heard: string | null,
  people: LedgerPerson[],
  categories: string[],
  offline: boolean,
  log: AssistantLog
): Promise<string | null> {
  // A spoken "undo" or "help" can only be recognised once it's transcribed.
  const spoken = heard ? detectCommand(heard) : null;
  if (spoken === "help") {
    log.outcome = "help";
    return HELP_REPLY;
  }
  if (spoken === "undo") {
    const undone = await undoLastAssistantEntry(input.userId);
    log.outcome = undone ? "undone" : "undo_nothing";
    return undoReply(undone);
  }

  if (!outcome.ok) {
    log.outcome = "rejected";
    // Kept for the Admin page, so what people ask for that the assistant
    // can't do becomes the list of what to teach it next.
    const said = (heard ?? input.text).trim();
    if (outcome.reason === NOT_UNDERSTOOD && said) {
      await recordAssistantFeedback(input.userId, "not_understood", said).catch(() => {});
    }
    return refusalReply(outcome.reason, outcome.question ? QUESTION_REFUSAL_HEADING : undefined);
  }
  switch (outcome.kind) {
    case "command":
      return runCommand(input, outcome.command, log);
    case "expense_edit":
      return editExpense(input, outcome.target, outcome.changes, log);
    case "expense_delete":
      return deleteExpense(input, outcome.target, log);
    case "person_rename":
      return renamePerson(input, outcome.person, outcome.newName, people, log);
    case "person_delete":
      return deletePerson(input, outcome.person, people, log);
    case "subscription":
      return runSubscription(input, outcome.sub, log);
    case "category":
      return runCategory(input, outcome.category, log);
    case "expenses_batch":
      return saveExpenses(input, outcome.expenses, categories, log);
    case "insight":
      return answerInsight(input.userId, outcome.insight, people, log);
    case "app_question":
      return answerHelp(outcome.question, log);
    case "feedback":
      await recordAssistantFeedback(input.userId, "suggestion", outcome.text);
      log.kind = "feedback";
      log.outcome = "feedback_saved";
      return FEEDBACK_REPLY;
  }
  if (outcome.kind === "query") return answerQuery(input.userId, outcome.query, people, log);
  if (outcome.kind === "due_date") return saveDueDate(input, outcome.due, people, log);
  if (outcome.kind === "ledger") return saveLedger(input, outcome.ledger, people, log);
  return saveExpense(input, outcome.expense, categories, offline, log);
}

// Where an entry came from, shown in its note in the app.
const SOURCE_LABEL = "Assistant";

// Every figure in an answer comes from the database. The model only decided
// which question was asked.
async function answerQuery(
  userId: string,
  query: ParsedQuery,
  people: LedgerPerson[],
  log: AssistantLog
): Promise<string> {
  log.kind = "query";
  log.queryType = query.type;
  log.outcome = "answered";
  const today = pakistanToday();

  switch (query.type) {
    case "udhar_person": {
      const found: LedgerPerson[] = [];
      for (const name of query.people) {
        const matches = people.filter((p) => personKey(p.name) === personKey(name));
        if (matches.length > 1) {
          log.outcome = "ambiguous_person";
          return ambiguousPersonReply(name);
        }
        if (matches.length === 1) found.push(matches[0]);
      }
      return udharPersonReply(
        found.map((p) => ({
          name: p.name,
          balance: p.balance,
          lent: p.lent,
          received: p.received,
          dueDate: p.dueDate,
        })),
        today
      );
    }

    case "udhar_summary":
      return udharSummaryReply(
        people.filter((p) => p.balance >= 0.005).map((p) => ({ name: p.name, balance: p.balance }))
      );

    case "spending": {
      const matched = await expensesFor(userId, query);
      // A breakdown only makes sense for an unfiltered total.
      const byCategory = new Map<string, number>();
      if (!query.category && !query.vendor) {
        for (const e of matched) {
          const key = e.category || "Uncategorised";
          byCategory.set(key, (byCategory.get(key) ?? 0) + e.amount);
        }
      }
      return spendingReply({
        label: queryLabel(query, today),
        filter: [query.category, query.vendor].filter(Boolean).join(" · ") || null,
        total: matched.reduce((sum, e) => sum + e.amount, 0),
        count: matched.length,
        byCategory: [...byCategory]
          .map(([category, total]) => ({ category, total }))
          .sort((a, b) => b.total - a.total),
      });
    }

    case "expense_list": {
      const matched = await expensesFor(userId, query);
      const sorted =
        query.sort === "biggest"
          ? [...matched].sort((a, b) => b.amount - a.amount)
          : matched; // already newest first
      const hasPeriod = Boolean(query.from || query.year);
      const what = [query.category, query.vendor].filter(Boolean).join(" · ");
      const title = `${query.sort === "biggest" ? "Biggest" : "Latest"} ${what ? `${what} ` : ""}expenses${
        hasPeriod ? ` ${whenPhrase(queryLabel(query, today))}` : ""
      }`;
      return expenseListReply({
        title,
        items: sorted.slice(0, query.limit ?? 10).map((e) => ({
          date: e.expense_date,
          amount: e.amount,
          vendor: e.vendor ?? null,
          category: e.category ?? null,
          note: e.note,
        })),
        matched: matched.length,
        total: matched.reduce((sum, e) => sum + e.amount, 0),
      });
    }

    case "subscriptions_overview": {
      await ensureTablesExist();
      const subs = await listSubscriptions(userId);
      return subscriptionsOverviewReply(
        subs.map((sub) => ({
          name: sub.name,
          amount: sub.amount,
          active: Boolean(sub.active),
          paid: sub.paid_this_period,
          dueDate: sub.current_due_date,
        })),
        today
      );
    }

    case "recent_expenses": {
      const rows = await listRecentExpenses(userId, 5);
      return recentExpensesReply(
        rows.map((e) => ({
          date: e.expense_date,
          amount: e.amount,
          vendor: e.vendor ?? null,
          category: e.category ?? null,
          note: e.note,
        }))
      );
    }

    case "subscriptions_due": {
      await ensureTablesExist();
      const subs = await listSubscriptions(userId);
      return subscriptionsDueReply(
        subs
          .filter((sub) => sub.active && !sub.paid_this_period)
          .map((sub) => ({ name: sub.name, amount: sub.amount, dueDate: sub.current_due_date })),
        today
      );
    }
  }
}

// The expenses a question covers: a day range, a month or year, or - for a
// list with no period - the most recent ones. Category and search word are
// applied here so every question type filters the same way.
async function expensesFor(userId: string, query: ParsedQuery): Promise<Expense[]> {
  const rows = query.from && query.to
    ? await listExpensesInRange(userId, query.from, query.to)
    : query.year
      ? await listExpenses(userId, { year: query.year, month: query.month ?? undefined })
      : await listRecentExpenses(userId, 500);
  const category = query.category?.toLowerCase();
  const needle = query.vendor?.toLowerCase();
  return rows.filter((e) => {
    if (category && (e.category || "Uncategorised").toLowerCase() !== category) return false;
    if (needle && !`${e.vendor ?? ""} ${e.note} ${e.category ?? ""}`.toLowerCase().includes(needle)) return false;
    return true;
  });
}

function queryLabel(query: ParsedQuery, today: string): string {
  if (query.label) return query.label;
  if (query.from && query.to) return rangeLabel(query.from, query.to);
  return periodLabel(query.year ?? Number(today.slice(0, 4)), query.month);
}

async function saveDueDate(
  input: AssistantInput,
  due: ParsedDueDate,
  people: LedgerPerson[],
  log: AssistantLog
): Promise<string> {
  const matches = people.filter((p) => personKey(p.name) === personKey(due.person));
  if (matches.length !== 1) {
    log.outcome = matches.length > 1 ? "ambiguous_person" : "rejected";
    return matches.length > 1
      ? ambiguousPersonReply(due.person)
      : refusalReply(`I couldn't find ${due.person} in your Udhar Khata.`);
  }
  const person = matches[0];
  const result = await setPersonDueDate(input.userId, person.id, due.date);
  if (!result) {
    log.outcome = "rejected";
    return refusalReply(`I couldn't find ${person.name} in your Udhar Khata.`);
  }
  // The old value, so UNDO puts it back exactly - including "no due date".
  await attachInboundUndo(input.messageId, [
    { op: "set_due_date", personId: person.id, name: person.name, dueDate: result.previous },
  ]);

  log.kind = "due_date";
  log.outcome = due.date ? "due_set" : "due_cleared";
  return dueDateReply({ name: person.name, date: due.date });
}

async function saveExpense(
  input: AssistantInput,
  expense: ParsedExpense,
  categories: string[],
  offline: boolean,
  log: AssistantLog
): Promise<string> {
  const resolution = await resolveExpenseCategory({
    userId: input.userId,
    vendor: expense.vendor,
    note: expense.note,
    provided: expense.categoryHint,
    explicit: false,
  });
  // The strict fallback only knows the built-in names, so a category the user
  // created themselves would be dropped. The model picked the hint from the
  // user's own list, so an exact match there is kept.
  const category =
    resolution.category ??
    categories.find((c) => c.toLowerCase() === expense.categoryHint?.toLowerCase()) ??
    null;

  const id = await insertExpense({
    userId: input.userId,
    amount: expense.amount,
    note: `${SOURCE_LABEL}: ${expense.note}`,
    expenseDateTime: toStoredDateTime(expense.date),
    vendor: expense.vendor,
    category,
    vendorKey: resolution.vendorKey,
  });
  await attachInboundExpense(input.messageId, id);

  log.kind = "expense";
  log.category = category;
  log.outcome = "added";
  return expenseAddedReply({
    amount: expense.amount,
    category,
    vendor: expense.vendor,
    date: expense.date,
    today: pakistanToday(),
    offline,
  });
}

async function saveLedger(
  input: AssistantInput,
  ledger: ParsedLedger,
  people: LedgerPerson[],
  log: AssistantLog
): Promise<string> {
  // Same sign convention as the Udhar Khata page: lent is positive, paid back negative.
  const sign = ledger.direction === "lend" ? 1 : -1;
  const rows: {
    write: LedgerWrite;
    name: string;
    amount: number;
    balance: number;
    isNew: boolean;
    settled?: boolean;
  }[] = [];

  for (const entry of ledger.entries) {
    if (entry.isNew) {
      const amount = entry.amount ?? 0;
      rows.push({
        write: { newName: entry.person, amount: sign * amount },
        name: entry.person,
        amount,
        balance: sign * amount,
        isNew: true,
      });
      continue;
    }
    // Validation matched the name against this same list, but two people can
    // share a name ("Ali" and "ali"). Writing to either would be a guess.
    const matches = people.filter((p) => personKey(p.name) === personKey(entry.person));
    if (matches.length !== 1) {
      log.outcome = matches.length > 1 ? "ambiguous_person" : "rejected";
      return matches.length > 1
        ? ambiguousPersonReply(entry.person)
        : refusalReply(`I couldn't find ${entry.person} in your Udhar Khata.`);
    }
    const person = matches[0];
    // "Paid everything back": the amount is whatever they owe right now.
    let amount = entry.amount ?? 0;
    if (entry.all) {
      if (person.balance < 0.005) {
        log.outcome = "nothing_to_settle";
        return refusalReply(`${person.name} doesn't owe you anything right now, so there's nothing to settle.`);
      }
      amount = Math.round(person.balance * 100) / 100;
    }
    rows.push({
      write: { personId: person.id, amount: sign * amount },
      name: person.name,
      amount,
      balance: person.balance + sign * amount,
      isNew: false,
      settled: entry.all === true,
    });
  }

  const label = SOURCE_LABEL;
  const { txIds, createdPeople } = await writeLedgerEntries(
    input.userId,
    rows.map((r) => r.write),
    ledger.note ? `${label}: ${ledger.note}` : label
  );
  // Recorded before any check, so whatever was written can still be undone.
  await attachInboundTransactions(input.messageId, txIds, createdPeople);
  if (txIds.length !== rows.length) {
    throw new Error(`Udhar Khata: wrote ${txIds.length} of ${rows.length} entries`);
  }

  log.kind = "ledger";
  log.direction = ledger.direction;
  log.entries = rows.length;
  log.newPeople = createdPeople.length;
  log.outcome = "added";
  return ledgerReply({
    direction: ledger.direction,
    lines: rows.map(({ name, amount, balance, isNew, settled }) => ({ name, amount, balance, isNew, settled })),
  });
}

// The app stores the wall-clock time the expense happened with a Z suffix
// (see fromLocalDateTime in the expenses page), not true UTC. Matching that
// keeps assistant entries sorted correctly among ones typed into the form.
function toStoredDateTime(date: string): string {
  if (date !== pakistanToday()) return `${date}T00:00:00Z`;
  const time = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Karachi",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date());
  return `${date}T${time}:00Z`;
}

/* ---------- commands ---------- */

async function runCommand(input: AssistantInput, command: Command, log: AssistantLog): Promise<string> {
  log.kind = "command";
  if (command === "help") {
    log.outcome = "help";
    return HELP_REPLY;
  }
  if (command === "undo") {
    const undone = await undoLastAssistantEntry(input.userId);
    log.outcome = undone ? "undone" : "undo_nothing";
    return undoReply(undone);
  }
  log.outcome = "answered";
  return categoriesListReply(await listUserCategories(input.userId));
}

/* ---------- changing and deleting expenses ---------- */

// How far back a description like "the Shell one" is searched.
const RECENT_DAYS = 120;
const NOT_FOUND = "Couldn't find it";

const daysBefore = (today: string, days: number) =>
  new Date(Date.parse(today + "T00:00:00Z") - days * 86_400_000).toISOString().slice(0, 10);

const expenseView = (e: ExpenseRow): ExpenseView => ({
  amount: e.amount,
  vendor: e.vendor,
  category: e.category,
  date: e.expense_date,
  note: e.note.replace(/^(WhatsApp|Assistant):\s*/, ""),
});

// Finds the one expense a message means. When several fit, the user is shown
// them and asked - a change is never applied to a guess.
async function findExpense(
  userId: string,
  target: ExpenseTarget
): Promise<{ row: ExpenseRow } | { reply: string; outcome: string }> {
  if (target.which !== "match") {
    const id =
      target.which === "last_added"
        ? (await lastAddedExpenseId(userId)) ?? (await latestExpenseId(userId))
        : await latestExpenseId(userId);
    const row = id ? await getExpenseRow(userId, id) : null;
    return row ? { row } : { reply: refusalReply("There are no expenses yet.", NOT_FOUND), outcome: "not_found" };
  }

  const today = pakistanToday();
  const recent = daysBefore(today, RECENT_DAYS);
  const since = target.date && target.date < recent ? target.date : recent;
  const rows = await listExpenseRowsSince(userId, since);
  const matches = matchExpenses(
    rows.map((r) => ({ id: r.id, amount: r.amount, vendor: r.vendor, note: r.note, category: r.category, date: r.expense_date })),
    target
  );
  if (matches.length === 0) {
    return {
      reply: refusalReply('No expense matches that. Send "last expenses" to see recent ones.', NOT_FOUND),
      outcome: "not_found",
    };
  }
  if (matches.length > 1) {
    const byId = new Map(rows.map((r) => [r.id, r]));
    return { reply: whichExpenseReply(matches.map((m) => expenseView(byId.get(m.id) as ExpenseRow))), outcome: "ambiguous" };
  }
  return { row: rows.find((r) => r.id === matches[0].id) as ExpenseRow };
}

async function editExpense(
  input: AssistantInput,
  target: ExpenseTarget,
  changes: ExpenseChanges,
  log: AssistantLog
): Promise<string> {
  log.kind = "expense_edit";
  const found = await findExpense(input.userId, target);
  if ("reply" in found) {
    log.outcome = found.outcome;
    return found.reply;
  }
  const result = await editExpenseRow(input.userId, found.row.id, changes);
  if (!result) {
    log.outcome = "not_found";
    return refusalReply("That expense no longer exists.", NOT_FOUND);
  }
  await attachInboundUndo(input.messageId, [{ op: "revert_expense", before: result.before, rule: result.rule }]);
  log.outcome = "edited";
  return expenseEditedReply({ before: expenseView(result.before), after: expenseView(result.after) });
}

async function deleteExpense(input: AssistantInput, target: ExpenseTarget, log: AssistantLog): Promise<string> {
  log.kind = "expense_delete";
  const found = await findExpense(input.userId, target);
  if ("reply" in found) {
    log.outcome = found.outcome;
    return found.reply;
  }
  const deleted = await deleteExpenseRow(input.userId, found.row.id);
  if (!deleted) {
    log.outcome = "not_found";
    return refusalReply("That expense no longer exists.", NOT_FOUND);
  }
  await attachInboundUndo(input.messageId, [{ op: "restore_expense", row: deleted }]);
  log.outcome = "deleted";
  return expenseDeletedReply(expenseView(deleted));
}

/* ---------- people ---------- */

function onePerson(people: LedgerPerson[], name: string, log: AssistantLog): LedgerPerson | string {
  const matches = people.filter((p) => personKey(p.name) === personKey(name));
  if (matches.length === 1) return matches[0];
  log.outcome = matches.length > 1 ? "ambiguous_person" : "not_found";
  return matches.length > 1
    ? ambiguousPersonReply(name)
    : refusalReply(`I couldn't find ${name} in your Udhar Khata.`, NOT_FOUND);
}

async function renamePerson(
  input: AssistantInput,
  name: string,
  newName: string,
  people: LedgerPerson[],
  log: AssistantLog
): Promise<string> {
  log.kind = "person";
  const person = onePerson(people, name, log);
  if (typeof person === "string") return person;
  const previous = await renamePersonRow(input.userId, person.id, newName);
  if (previous === null) {
    log.outcome = "not_found";
    return refusalReply(`I couldn't find ${name} in your Udhar Khata.`, NOT_FOUND);
  }
  await attachInboundUndo(input.messageId, [{ op: "rename_person", personId: person.id, name: previous, renamedTo: newName }]);
  log.outcome = "person_renamed";
  return personRenamedReply({ from: previous, to: newName });
}

async function deletePerson(input: AssistantInput, name: string, people: LedgerPerson[], log: AssistantLog): Promise<string> {
  log.kind = "person";
  const person = onePerson(people, name, log);
  if (typeof person === "string") return person;
  const snapshot = await getPersonSnapshot(input.userId, person.id);
  if (!snapshot) {
    log.outcome = "not_found";
    return refusalReply(`I couldn't find ${name} in your Udhar Khata.`, NOT_FOUND);
  }
  await deletePersonRow(input.userId, person.id);
  await attachInboundUndo(input.messageId, [
    { op: "restore_person", person: snapshot.person, transactions: snapshot.transactions },
  ]);
  log.outcome = "person_deleted";
  return personDeletedReply({ name: person.name, balance: person.balance, entries: snapshot.transactions.length });
}

/* ---------- subscriptions ---------- */

async function runSubscription(input: AssistantInput, sub: SubscriptionAction, log: AssistantLog): Promise<string> {
  log.kind = "subscription";
  const { userId, messageId } = input;

  if (sub.action === "add") {
    const created = await createSubscription(userId, sub.name, sub.amount, sub.firstDueDate);
    await attachInboundUndo(messageId, [{ op: "remove_subscription", id: created.id, name: created.name }]);
    log.outcome = "subscription_added";
    return subscriptionAddedReply({ name: sub.name, amount: sub.amount, firstDueDate: sub.firstDueDate });
  }

  const matches = (await listSubscriptionRows(userId)).filter((row) => row.name === sub.name);
  if (matches.length !== 1) {
    log.outcome = "not_found";
    return refusalReply(
      matches.length
        ? `More than one subscription is called ${sub.name}. Rename one in the app first.`
        : `You don't have a subscription called ${sub.name}.`,
      NOT_FOUND
    );
  }
  const row = matches[0];
  const gone = () => {
    log.outcome = "not_found";
    return refusalReply(`${row.name} no longer exists.`, NOT_FOUND);
  };

  switch (sub.action) {
    case "mark_paid": {
      const paid = await markSubscriptionPaidTracked(userId, row.id);
      if (!paid) return gone();
      if (paid.status === "nothing_due") {
        log.outcome = "nothing_due";
        return refusalReply(`${row.name} is already paid up.`, "Nothing to pay");
      }
      await attachInboundUndo(messageId, [
        { op: "unmark_paid", name: row.name, paymentId: paid.paymentId, addedPaymentId: paid.addedPaymentId },
      ]);
      log.outcome = "subscription_paid";
      return subscriptionPaidReply({ name: row.name, amount: row.amount, period: paid.period, nextDueDate: paid.nextDueDate });
    }

    case "pause":
    case "resume": {
      const active = sub.action === "resume";
      if ((row.active === 1) === active) {
        log.outcome = "unchanged";
        return refusalReply(`${row.name} is already ${active ? "active" : "paused"}.`, "Nothing to change");
      }
      const updated = await updateSubscriptionFields(userId, row.id, { active });
      if (!updated) return gone();
      await attachInboundUndo(messageId, [{ op: "revert_subscription", before: updated.before }]);
      log.outcome = active ? "subscription_resumed" : "subscription_paused";
      return subscriptionActiveReply({ name: row.name, active });
    }

    case "edit": {
      const updated = await updateSubscriptionFields(userId, row.id, {
        name: sub.newName ?? undefined,
        amount: sub.amount ?? undefined,
        due_day: sub.dueDay ?? undefined,
      });
      if (!updated) return gone();
      await attachInboundUndo(messageId, [{ op: "revert_subscription", before: updated.before }]);
      log.outcome = "subscription_edited";
      const view = (r: typeof updated.before) => ({ name: r.name, amount: r.amount, dueDay: r.due_day });
      return subscriptionEditedReply({ before: view(updated.before), after: view(updated.after) });
    }

    case "delete": {
      const snapshot = await getSubscriptionSnapshot(userId, row.id);
      if (!snapshot) return gone();
      await deleteSubscription(row.id, userId);
      await attachInboundUndo(messageId, [{ op: "restore_subscription", sub: snapshot.sub, payments: snapshot.payments }]);
      log.outcome = "subscription_deleted";
      return subscriptionDeletedReply({ name: row.name, payments: snapshot.payments.length });
    }
  }
}

/* ---------- categories ---------- */

async function runCategory(input: AssistantInput, category: CategoryAction, log: AssistantLog): Promise<string> {
  log.kind = "category";
  const { userId, messageId } = input;
  const existing = await listUserCategories(userId);

  if (category.action === "create") {
    if (existing.some((c) => c.name.toLowerCase() === category.name.toLowerCase())) {
      log.outcome = "exists";
      return refusalReply(`You already have a category called ${category.name}.`, "Already there");
    }
    await createUserCategory(userId, category.name, category.keywords.join(", "));
    await attachInboundUndo(messageId, [{ op: "remove_category", name: category.name }]);
    log.outcome = "category_created";
    return categoryCreatedReply({ name: category.name, keywords: category.keywords });
  }

  const snapshot = await getCategorySnapshot(userId, category.name);
  if (!snapshot) {
    log.outcome = "not_found";
    return refusalReply(`You don't have a category called ${category.name}.`, NOT_FOUND);
  }

  switch (category.action) {
    case "rename": {
      if (existing.some((c) => c.name !== category.name && c.name.toLowerCase() === category.newName.toLowerCase())) {
        log.outcome = "exists";
        return refusalReply(`You already have a category called ${category.newName}.`, "Already there");
      }
      await updateUserCategory(userId, category.name, { newName: category.newName });
      await attachInboundUndo(messageId, [{ op: "rename_category", from: category.newName, to: category.name }]);
      log.outcome = "category_renamed";
      return categoryRenamedReply({ from: category.name, to: category.newName, moved: snapshot.expenseIds.length });
    }
    case "delete": {
      await deleteUserCategory(userId, category.name);
      await attachInboundUndo(messageId, [
        { op: "restore_category", category: snapshot.category, expenseIds: snapshot.expenseIds, rules: snapshot.rules },
      ]);
      log.outcome = "category_deleted";
      return categoryDeletedReply({ name: category.name, expenses: snapshot.expenseIds.length });
    }
    case "keywords": {
      await updateUserCategory(userId, category.name, { keywords: category.keywords.join(", ") });
      await attachInboundUndo(messageId, [
        { op: "set_category_keywords", name: category.name, keywords: snapshot.category.keywords },
      ]);
      log.outcome = "category_keywords";
      return categoryKeywordsReply({ name: category.name, keywords: category.keywords });
    }
  }
}

/* ---------- several expenses at once ---------- */

async function saveExpenses(
  input: AssistantInput,
  expenses: ParsedExpense[],
  categories: string[],
  log: AssistantLog
): Promise<string> {
  const saved: { id: string; amount: number; vendor: string | null; note: string; category: string | null }[] = [];
  for (const expense of expenses) {
    const resolution = await resolveExpenseCategory({
      userId: input.userId,
      vendor: expense.vendor,
      note: expense.note,
      provided: expense.categoryHint,
      explicit: false,
    });
    const category =
      resolution.category ??
      categories.find((c) => c.toLowerCase() === expense.categoryHint?.toLowerCase()) ??
      null;
    const id = await insertExpense({
      userId: input.userId,
      amount: expense.amount,
      note: `${SOURCE_LABEL}: ${expense.note}`,
      expenseDateTime: toStoredDateTime(expense.date),
      vendor: expense.vendor,
      category,
      vendorKey: resolution.vendorKey,
    });
    saved.push({ id, amount: expense.amount, vendor: expense.vendor, note: expense.note, category });
  }
  // One UNDO removes the whole message's worth.
  await attachInboundUndo(
    input.messageId,
    saved.map((e) => ({ op: "remove_expense" as const, id: e.id, amount: e.amount, vendor: e.vendor }))
  );
  log.kind = "expenses";
  log.entries = saved.length;
  log.outcome = "added";
  return expensesBatchReply(saved);
}

/* ---------- insights ---------- */

async function answerInsight(userId: string, insight: Insight, people: LedgerPerson[], log: AssistantLog): Promise<string> {
  log.kind = "insight";
  log.queryType = insight.type;
  log.outcome = "answered";
  const today = pakistanToday();

  if (insight.type === "person_history") {
    const person = onePerson(people, insight.person, log);
    if (typeof person === "string") return person;
    const txs = await listTx(person.id);
    return personHistoryReply({
      name: person.name,
      balance: person.balance,
      lent: person.lent,
      received: person.received,
      dueDate: person.dueDate,
      entries: txs.map((t) => ({ amount: t.amount, note: t.note, date: t.created_at.slice(0, 10) })),
    });
  }

  if (insight.type === "compare") {
    const [now, before] = await Promise.all([
      listExpensesInRange(userId, insight.a.from, insight.a.to),
      listExpensesInRange(userId, insight.b.from, insight.b.to),
    ]);
    const inCategory = (e: Expense) => !insight.category || (e.category || "Uncategorised") === insight.category;
    const a = now.filter(inCategory);
    const b = before.filter(inCategory);
    const sum = (list: Expense[]) => list.reduce((s, e) => s + e.amount, 0);
    const byCategory = (list: Expense[]) => {
      const m = new Map<string, number>();
      for (const e of list) m.set(e.category || "Uncategorised", (m.get(e.category || "Uncategorised") ?? 0) + e.amount);
      return m;
    };
    const ca = byCategory(a);
    const cb = byCategory(b);
    const changes = insight.category
      ? []
      : [...new Set([...ca.keys(), ...cb.keys()])]
          .map((category) => ({ category, delta: (ca.get(category) ?? 0) - (cb.get(category) ?? 0) }))
          .sort((x, y) => Math.abs(y.delta) - Math.abs(x.delta));
    return compareReply({
      a: { label: insight.a.label, total: sum(a), count: a.length },
      b: { label: insight.b.label, total: sum(b), count: b.length },
      category: insight.category,
      changes,
    });
  }

  const horizon = addDays(today, insight.days);
  const owing = people.filter((p) => p.balance >= 0.005 && p.dueDate);
  const row = (p: LedgerPerson) => ({ name: p.name, balance: p.balance, dueDate: p.dueDate as string });
  return udharDueReply({
    days: insight.days,
    overdue: owing.filter((p) => (p.dueDate as string) < today).map(row).sort((x, y) => x.dueDate.localeCompare(y.dueDate)),
    soon: owing
      .filter((p) => (p.dueDate as string) >= today && (p.dueDate as string) <= horizon)
      .map(row)
      .sort((x, y) => x.dueDate.localeCompare(y.dueDate)),
  });
}

/* ---------- the app itself ---------- */

async function answerHelp(question: string, log: AssistantLog): Promise<string> {
  log.kind = "help_question";
  try {
    const answer = await answerAppQuestion(question, health);
    log.outcome = answer ? "answered" : "help_fallback";
    return answer ? appHelpReply(answer) : HELP_REPLY;
  } catch {
    log.outcome = "help_fallback";
    return HELP_REPLY;
  }
}

// Runs an action that has already been understood, without calling the model.
// Used by scripts/test-assistant-db.ts; the message id must already be recorded
// with claimInboundMessage so UNDO can find what it changed.
export async function runAction(input: AssistantInput, action: Action): Promise<string | null> {
  const log: AssistantLog = {
    evt: "assistant",
    msg: input.messageId.slice(-8),
    type: "text",
    outcome: "error",
    totalMs: 0,
  };
  const [categories, people] = await Promise.all([
    listUserCategories(input.userId).then((list) => list.map((c) => c.name)),
    listLedgerPeople(input.userId),
  ]);
  return act(input, action, null, people, categories, false, log);
}
