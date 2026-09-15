// The Khata assistant: one message in - typed in the app, or sent on WhatsApp -
// one reply out. Works out what the message records (an expense, money lent or
// paid back, a due date) or asks (a question about the user's data), saves it,
// and writes the reply. Nothing here knows how the message arrived or how the
// reply is delivered; each channel handles that and calls runAssistant().
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
  undoLastWhatsAppEntry,
  writeLedgerEntries,
  type LedgerPerson,
  type LedgerWrite,
} from "@/lib/db";
import {
  GeminiBusyError,
  pakistanToday,
  parseMessage,
  parseOffline,
  personKey,
  type Attempt,
  type HealthStore,
  type ParseOutcome,
  type ParsedDueDate,
  type ParsedExpense,
  type ParsedLedger,
  type ParsedQuery,
} from "@/lib/expense-parse";
import { detectCommand } from "@/lib/whatsapp-webhook";
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
  withTranscript,
} from "@/lib/whatsapp-replies";

const health: HealthStore = { load: loadModelHealth, save: saveModelHealth };

export type AssistantChannel = "whatsapp" | "app";

export type AssistantInput = {
  userId: string;
  // Already recorded in whatsapp_inbound by the caller: it is what ties saved
  // entries to this message, so UNDO can reverse them.
  messageId: string;
  channel: AssistantChannel;
  text: string;
  image: { data: string; mimeType: string } | null;
  // A voice note, already converted to a format Gemini accepts.
  audio: { data: string; mimeType: string } | null;
};

// One JSON line per message, so a message can be traced in Vercel's logs:
// what it was, which models were tried and how long each took, and how it
// ended. Deliberately no message text, amounts or names.
export type AssistantLog = {
  evt: "assistant";
  channel: AssistantChannel;
  msg: string; // tail of the message id
  type: "text" | "image" | "audio";
  outcome: string;
  kind?: "expense" | "ledger" | "query" | "due_date";
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

export type AssistantResult = { reply: string | null; log: AssistantLog };

export async function runAssistant(input: AssistantInput): Promise<AssistantResult> {
  const started = Date.now();
  const log: AssistantLog = {
    evt: "assistant",
    channel: input.channel,
    msg: input.messageId.slice(-8),
    type: input.audio ? "audio" : input.image ? "image" : "text",
    outcome: "error",
    totalMs: 0,
  };
  let reply: string | null = null;
  try {
    reply = await handle(input, log);
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
  return { reply, log };
}

async function handle(input: AssistantInput, log: AssistantLog): Promise<string | null> {
  const { userId, text, image, audio } = input;

  const command = detectCommand(text);
  if (command === "help") {
    log.outcome = "help";
    return HELP_REPLY;
  }
  if (command === "undo") {
    const undone = await undoLastWhatsAppEntry(userId);
    log.outcome = undone ? "undone" : "undo_nothing";
    return undoReply(undone);
  }
  if (!text && !image && !audio) {
    log.outcome = "empty";
    return null;
  }

  const [categories, people] = await Promise.all([
    listUserCategories(userId).then((list) => list.map((c) => c.name)),
    listLedgerPeople(userId),
  ]);
  const names = people.map((p) => p.name);

  let outcome: ParseOutcome;
  let offline = false;
  let heard: string | null = null;
  try {
    const result = await parseMessage({ text, image, audio, categories, people: names, health });
    outcome = result.outcome;
    heard = result.transcript;
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

  const reply = await act(input, outcome, heard, people, categories, offline, log);
  // For a voice note, what was heard comes first, so a mishearing is caught
  // before the saved result is trusted.
  return reply === null ? null : withTranscript(heard, reply);
}

async function act(
  input: AssistantInput,
  outcome: ParseOutcome,
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
    const undone = await undoLastWhatsAppEntry(input.userId);
    log.outcome = undone ? "undone" : "undo_nothing";
    return undoReply(undone);
  }

  if (!outcome.ok) {
    log.outcome = "rejected";
    return refusalReply(outcome.reason, outcome.question ? QUESTION_REFUSAL_HEADING : undefined);
  }
  if (outcome.kind === "query") return answerQuery(input.userId, outcome.query, people, log);
  if (outcome.kind === "due_date") return saveDueDate(input, outcome.due, people, log);
  if (outcome.kind === "ledger") return saveLedger(input, outcome.ledger, people, log);
  return saveExpense(input, outcome.expense, categories, offline, log);
}

// Where an entry came from, shown in its note in the app.
const sourceLabel = (channel: AssistantChannel) => (channel === "whatsapp" ? "WhatsApp" : "Assistant");

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
      const year = query.year ?? Number(today.slice(0, 4));
      const rows = await listExpenses(userId, {
        year,
        month: query.month ?? undefined,
        category: query.category ?? undefined,
      });
      const needle = query.vendor?.toLowerCase();
      const matched = needle
        ? rows.filter((e) => `${e.vendor ?? ""} ${e.note}`.toLowerCase().includes(needle))
        : rows;
      // A breakdown only makes sense for an unfiltered total.
      const byCategory = new Map<string, number>();
      if (!query.category && !needle) {
        for (const e of matched) {
          const key = e.category || "Uncategorised";
          byCategory.set(key, (byCategory.get(key) ?? 0) + e.amount);
        }
      }
      return spendingReply({
        label: periodLabel(year, query.month),
        filter: [query.category, query.vendor].filter(Boolean).join(" · ") || null,
        total: matched.reduce((sum, e) => sum + e.amount, 0),
        count: matched.length,
        byCategory: [...byCategory]
          .map(([category, total]) => ({ category, total }))
          .sort((a, b) => b.total - a.total),
      });
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
    note: `${sourceLabel(input.channel)}: ${expense.note}`,
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

  const label = sourceLabel(input.channel);
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
