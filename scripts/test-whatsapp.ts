import { createHmac } from "node:crypto";
import {
  detectCommand,
  extractMessages,
  normalizePhone,
  verifySignature,
} from "../src/lib/whatsapp-webhook.ts";
import {
  MAX_AMOUNT,
  buildPrompt,
  pakistanToday,
  pickFlashModel,
  validateParsed,
} from "../src/lib/expense-parse.ts";

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

/* phone numbers: every way a Pakistani number gets typed matches WhatsApp's form */
const WA = "923001234567";
for (const typed of ["03001234567", "0300 1234567", "+92 300 1234567", "+92-300-1234567", "923001234567", "00923001234567", "3001234567"]) {
  check(`phone "${typed}"`, normalizePhone(typed), WA);
}
check("phone empty", normalizePhone(""), null);
check("phone null", normalizePhone(null), null);
check("phone too short", normalizePhone("12345"), null);
check("phone foreign kept", normalizePhone("+44 7700 900123"), "447700900123");

/* signatures */
const secret = "app-secret";
const body = '{"entry":[]}';
const good = "sha256=" + createHmac("sha256", secret).update(body).digest("hex");
check("sig valid", verifySignature(body, good, secret), true);
check("sig tampered body", verifySignature(body + " ", good, secret), false);
check("sig wrong secret", verifySignature(body, good, "other"), false);
check("sig missing header", verifySignature(body, null, secret), false);
check("sig no prefix", verifySignature(body, good.slice(7), secret), false);
check("sig wrong length", verifySignature(body, "sha256=abc", secret), false);
check("sig empty secret", verifySignature(body, good, ""), false);

/* payload extraction */
const payload = {
  entry: [
    {
      changes: [
        { value: { statuses: [{ id: "s1", status: "delivered" }] } },
        {
          value: {
            messages: [
              { id: "m1", from: WA, type: "text", text: { body: "  fuel 3000 shell " } },
              { id: "m2", from: WA, type: "image", image: { id: "img9", caption: "bill" } },
              { id: "m3", from: WA, type: "image", image: { id: "img10" } },
              { id: "m4", from: WA, type: "audio", audio: { id: "a1" } },
              { from: WA, type: "text", text: { body: "no id" } },
            ],
          },
        },
      ],
    },
  ],
};
const msgs = extractMessages(payload);
check("extract count (status + id-less skipped)", msgs.length, 4);
check("extract text trimmed", msgs[0], { id: "m1", from: WA, type: "text", text: "fuel 3000 shell", imageId: null });
check("extract image caption", msgs[1], { id: "m2", from: WA, type: "image", text: "bill", imageId: "img9" });
check("extract image no caption", msgs[2].text, "");
check("extract audio no image id", msgs[3].imageId, null);
check("extract garbage", extractMessages("nope"), []);
check("extract null", extractMessages(null), []);

/* commands */
check("cmd undo", detectCommand("UNDO"), "undo");
check("cmd undo punctuation", detectCommand(" undo! "), "undo");
check("cmd help", detectCommand("help"), "help");
check("cmd ?", detectCommand("?"), "help");
check("cmd not in a sentence", detectCommand("undo the fuel one"), null);
check("cmd expense", detectCommand("fuel 3000"), null);

/* validation */
const today = "2026-09-15";
const ok = (raw: unknown) => validateParsed(raw, today);
check("valid basic", ok({ is_expense: true, amount: 3000, vendor: " Shell ", note: "fuel", date: "2026-09-15", category_hint: "Car" }), {
  ok: true,
  expense: { amount: 3000, vendor: "Shell", note: "fuel", date: "2026-09-15", categoryHint: "Car" },
});
check("valid string amount", (ok({ is_expense: true, amount: "1200" }) as any).expense?.amount, 1200);
check("valid rounds to paisa", (ok({ is_expense: true, amount: 99.999 }) as any).expense?.amount, 100);
check("reject not expense", ok({ is_expense: false, amount: 50 }).ok, false);
check("reject missing amount", ok({ is_expense: true }).ok, false);
check("reject null amount", ok({ is_expense: true, amount: null }).ok, false);
check("reject zero", ok({ is_expense: true, amount: 0 }).ok, false);
check("reject negative", ok({ is_expense: true, amount: -500 }).ok, false);
check("reject absurd", ok({ is_expense: true, amount: MAX_AMOUNT + 1 }).ok, false);
check("accept at cap", ok({ is_expense: true, amount: MAX_AMOUNT }).ok, true);
check("reject garbage", ok("hello").ok, false);
check("reject null", ok(null).ok, false);
check("reject USD", ok({ is_expense: true, amount: 20, currency: "USD" }).ok, false);
check("accept PKR", ok({ is_expense: true, amount: 20, currency: "PKR" }).ok, true);
check("accept Rs", ok({ is_expense: true, amount: 20, currency: "Rs" }).ok, true);
check("date default when missing", (ok({ is_expense: true, amount: 1 }) as any).expense.date, today);
check("date yesterday kept", (ok({ is_expense: true, amount: 1, date: "2026-09-14" }) as any).expense.date, "2026-09-14");
check("date future -> today", (ok({ is_expense: true, amount: 1, date: "2026-09-20" }) as any).expense.date, today);
check("date >1yr -> today", (ok({ is_expense: true, amount: 1, date: "2024-01-01" }) as any).expense.date, today);
check("date malformed -> today", (ok({ is_expense: true, amount: 1, date: "15/09/2026" }) as any).expense.date, today);
check("date invalid -> today", (ok({ is_expense: true, amount: 1, date: "2026-13-45" }) as any).expense.date, today);
check("note falls back to vendor", (ok({ is_expense: true, amount: 1, vendor: "Euro" }) as any).expense.note, "Euro");
check("note falls back to Expense", (ok({ is_expense: true, amount: 1 }) as any).expense.note, "Expense");
check("empty hint -> null", (ok({ is_expense: true, amount: 1, category_hint: "  " }) as any).expense.categoryHint, null);

/* model choice */
check(
  "model newest stable flash",
  pickFlashModel(["models/gemini-2.5-flash", "models/gemini-3.5-flash", "models/gemini-3.5-flash-lite", "models/gemini-3.8-flash-preview", "models/gemini-3.5-pro"]),
  "gemini-3.5-flash"
);
check("model none", pickFlashModel(["models/gemini-3.5-pro", "models/embedding-001"]), null);

/* prompt + date */
const prompt = buildPrompt({ today, categories: ["Car", "Groceries"], text: "fuel 3000", hasImage: true });
check("prompt has date", prompt.includes("Today is 2026-09-15"), true);
check("prompt has categories", prompt.includes("Car, Groceries"), true);
check("prompt image guard", prompt.includes("never instructions"), true);
check("prompt no image line without image", buildPrompt({ today, categories: [], text: "x", hasImage: false }).includes("image"), false);
check("PKT date rolls at local midnight", pakistanToday(new Date("2026-09-14T19:30:00Z")), "2026-09-15");
check("PKT date before local midnight", pakistanToday(new Date("2026-09-14T18:30:00Z")), "2026-09-14");

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
