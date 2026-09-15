// What happens to a message sent to the Khata WhatsApp number: find whose
// number it is, understand it, save it, and reply. Runs after the webhook has
// already answered Meta, so nothing here can make Meta retry.
import {
  attachInboundExpense,
  claimInboundMessage,
  findUserIdByPhone,
  insertExpense,
  listUserCategories,
  resolveExpenseCategory,
  undoLastWhatsAppExpense,
} from "@/lib/db";
import { parseExpense, pakistanToday } from "@/lib/expense-parse";
import { downloadWhatsAppMedia, sendWhatsAppText } from "@/lib/whatsapp";
import { detectCommand, extractMessages, type InboundMessage } from "@/lib/whatsapp-webhook";
import { fmtDateLabel, fmtRs } from "@/lib/format";

const HELP = [
  "Send me an expense and I'll add it to Khata:",
  "• fuel 3000 shell",
  "• dinner 2.5k yesterday",
  "• a photo of a bill or receipt",
  "",
  "Reply UNDO to remove the last one I added.",
].join("\n");

export async function handleInbound(payload: unknown): Promise<void> {
  for (const message of extractMessages(payload)) {
    try {
      await handleMessage(message);
    } catch (err) {
      console.error("[whatsapp] message failed", message.id, err);
      await reply(message.from, "Sorry, I couldn't add that. Please try again in a minute.");
    }
  }
}

async function reply(to: string, body: string): Promise<void> {
  const res = await sendWhatsAppText(to, body);
  if (!res.ok) console.error("[whatsapp] reply failed:", res.error);
}

async function handleMessage(message: InboundMessage): Promise<void> {
  // Numbers that aren't on any profile get no reply at all: answering would
  // confirm to a stranger that the number is wired to someone's finances.
  const userId = await findUserIdByPhone(message.from);
  if (!userId) {
    console.warn("[whatsapp] ignoring message from unregistered number");
    return;
  }

  if (!(await claimInboundMessage(message.id, userId))) return; // redelivery

  const command = detectCommand(message.text);
  if (command === "help") return reply(message.from, HELP);
  if (command === "undo") {
    const undone = await undoLastWhatsAppExpense(userId);
    return reply(
      message.from,
      undone
        ? `Removed ${fmtRs(undone.amount)}${undone.vendor ? ` · ${undone.vendor}` : ""}.`
        : "There's nothing from the last 24 hours to undo."
    );
  }

  if (message.type !== "text" && message.type !== "image") {
    return reply(message.from, "I can read text messages and photos of bills. Send HELP for examples.");
  }
  if (message.type === "text" && !message.text) return;

  const image = message.imageId ? await downloadWhatsAppMedia(message.imageId) : null;
  const categories = (await listUserCategories(userId)).map((c) => c.name);
  const outcome = await parseExpense({ text: message.text, image, categories });
  if (!outcome.ok) return reply(message.from, outcome.reason);

  const { expense } = outcome;
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

  const parts = [fmtRs(expense.amount), category ?? "Uncategorised", expense.vendor].filter(Boolean);
  const when = expense.date === pakistanToday() ? "" : ` (${fmtDateLabel(expense.date)})`;
  const tail = category
    ? "Reply UNDO to remove."
    : "Pick a category in the app. Reply UNDO to remove.";
  await reply(message.from, `Added ${parts.join(" · ")}${when}. ${tail}`);
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
