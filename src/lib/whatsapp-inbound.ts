// What happens to a message sent to the Khata WhatsApp number: find whose
// number it is, work out what it records - an expense, or money lent or paid
// back in Udhar Khata - save it, and reply. Runs after the webhook has already
// answered Meta, so nothing here can make Meta retry.
import {
  attachInboundExpense,
  attachInboundTransactions,
  claimInboundMessage,
  findUserIdByPhone,
  insertExpense,
  listLedgerPeople,
  listUserCategories,
  loadModelHealth,
  resolveExpenseCategory,
  saveModelHealth,
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
  type ParsedExpense,
  type ParsedLedger,
} from "@/lib/expense-parse";
import { downloadWhatsAppMedia, sendWhatsAppText } from "@/lib/whatsapp";
import { detectCommand, extractMessages, type InboundMessage } from "@/lib/whatsapp-webhook";
import {
  BUSY_REPLY,
  ERROR_REPLY,
  HELP_REPLY,
  UNSUPPORTED_REPLY,
  ambiguousPersonReply,
  expenseAddedReply,
  ledgerReply,
  refusalReply,
  undoReply,
} from "@/lib/whatsapp-replies";

const health: HealthStore = { load: loadModelHealth, save: saveModelHealth };

// One JSON line per message, so a message can be traced in Vercel's logs:
// what it was, which models were tried and how long each took, and how it
// ended. Deliberately no message text, amounts or names.
type LogLine = {
  evt: "whatsapp";
  msg: string; // tail of Meta's message id
  type: string;
  outcome: string;
  kind?: "expense" | "ledger";
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

export async function handleInbound(payload: unknown): Promise<void> {
  for (const message of extractMessages(payload)) {
    const started = Date.now();
    const log: LogLine = {
      evt: "whatsapp",
      msg: message.id.slice(-8),
      type: message.type,
      outcome: "error",
      totalMs: 0,
    };
    try {
      await handleMessage(message, log);
    } catch (err) {
      const busy = err instanceof GeminiBusyError;
      log.outcome = busy ? "busy" : "error";
      log.error = (err as Error).message.slice(0, 300);
      if (busy) log.attempts = err.attempts;
      await reply(message.from, busy ? BUSY_REPLY : ERROR_REPLY);
    } finally {
      log.totalMs = Date.now() - started;
      const line = JSON.stringify(log);
      if (log.outcome === "error") console.error(line);
      else if (log.outcome === "busy") console.warn(line);
      else console.log(line);
    }
  }
}

async function reply(to: string, body: string): Promise<void> {
  const res = await sendWhatsAppText(to, body);
  if (!res.ok) console.error("[whatsapp] reply failed:", res.error);
}

async function handleMessage(message: InboundMessage, log: LogLine): Promise<void> {
  // Numbers that aren't on any profile get no reply at all: answering would
  // confirm to a stranger that the number is wired to someone's finances.
  const userId = await findUserIdByPhone(message.from);
  if (!userId) {
    log.outcome = "ignored_unregistered";
    return;
  }
  if (!(await claimInboundMessage(message.id, userId))) {
    log.outcome = "duplicate";
    return;
  }

  const command = detectCommand(message.text);
  if (command === "help") {
    log.outcome = "help";
    return reply(message.from, HELP_REPLY);
  }
  if (command === "undo") {
    const undone = await undoLastWhatsAppEntry(userId);
    log.outcome = undone ? "undone" : "undo_nothing";
    return reply(message.from, undoReply(undone));
  }

  if (message.type !== "text" && message.type !== "image") {
    log.outcome = "unsupported";
    return reply(message.from, UNSUPPORTED_REPLY);
  }
  if (message.type === "text" && !message.text) {
    log.outcome = "empty";
    return;
  }

  const [categories, people] = await Promise.all([
    listUserCategories(userId).then((list) => list.map((c) => c.name)),
    listLedgerPeople(userId),
  ]);
  const names = people.map((p) => p.name);
  const image = message.imageId ? await downloadWhatsAppMedia(message.imageId) : null;

  let outcome: ParseOutcome;
  let offline = false;
  try {
    const result = await parseMessage({ text: message.text, image, categories, people: names, health });
    outcome = result.outcome;
    log.parser = "gemini";
    log.model = result.model;
    log.attempts = result.attempts;
  } catch (err) {
    // Every model failed. A simple text expense can still be read without the
    // model; photos and Udhar Khata updates can't, so those get "busy".
    if (!(err instanceof GeminiBusyError) || image) throw err;
    log.attempts = err.attempts;
    log.parser = "offline";
    outcome = parseOffline(message.text, pakistanToday(), names);
    if (!outcome.ok) throw err;
    offline = true;
  }

  if (!outcome.ok) {
    log.outcome = "rejected";
    return reply(message.from, refusalReply(outcome.reason));
  }
  if (outcome.kind === "ledger") return saveLedger(userId, message, outcome.ledger, people, log);
  return saveExpense(userId, message, outcome.expense, categories, offline, log);
}

async function saveExpense(
  userId: string,
  message: InboundMessage,
  expense: ParsedExpense,
  categories: string[],
  offline: boolean,
  log: LogLine
): Promise<void> {
  const resolution = await resolveExpenseCategory({
    userId,
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
    userId,
    amount: expense.amount,
    note: `WhatsApp: ${expense.note}`,
    expenseDateTime: toStoredDateTime(expense.date),
    vendor: expense.vendor,
    category,
    vendorKey: resolution.vendorKey,
  });
  await attachInboundExpense(message.id, id);

  log.kind = "expense";
  log.category = category;
  log.outcome = "added";
  await reply(
    message.from,
    expenseAddedReply({
      amount: expense.amount,
      category,
      vendor: expense.vendor,
      date: expense.date,
      today: pakistanToday(),
      offline,
    })
  );
}

async function saveLedger(
  userId: string,
  message: InboundMessage,
  ledger: ParsedLedger,
  people: LedgerPerson[],
  log: LogLine
): Promise<void> {
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
      return reply(
        message.from,
        matches.length > 1
          ? ambiguousPersonReply(entry.person)
          : refusalReply(`I couldn't find ${entry.person} in your Udhar Khata.`)
      );
    }
    const person = matches[0];
    // "Paid everything back": the amount is whatever they owe right now.
    let amount = entry.amount ?? 0;
    if (entry.all) {
      if (person.balance < 0.005) {
        log.outcome = "nothing_to_settle";
        return reply(
          message.from,
          refusalReply(`${person.name} doesn't owe you anything right now, so there's nothing to settle.`)
        );
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

  const { txIds, createdPeople } = await writeLedgerEntries(
    userId,
    rows.map((r) => r.write),
    ledger.note ? `WhatsApp: ${ledger.note}` : "WhatsApp"
  );
  // Recorded before any check, so whatever was written can still be undone.
  await attachInboundTransactions(message.id, txIds, createdPeople);
  if (txIds.length !== rows.length) {
    throw new Error(`Udhar Khata: wrote ${txIds.length} of ${rows.length} entries`);
  }

  log.kind = "ledger";
  log.direction = ledger.direction;
  log.entries = rows.length;
  log.newPeople = createdPeople.length;
  log.outcome = "added";
  await reply(
    message.from,
    ledgerReply({
      direction: ledger.direction,
      lines: rows.map(({ name, amount, balance, isNew, settled }) => ({ name, amount, balance, isNew, settled })),
    })
  );
}

// The app stores the wall-clock time the expense happened with a Z suffix
// (see fromLocalDateTime in the expenses page), not true UTC. Matching that
// keeps WhatsApp entries sorted correctly among ones typed into the form.
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
