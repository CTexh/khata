// What the import would make of a set of bank alerts, without reading Gmail or
// writing anything. Synthetic alerts in the shape the three banks send, so the
// decisions can be checked after changing the rules or the prompt.
//
//   node --experimental-strip-types --env-file=.env.local \
//     --import ./scripts/alias-register.mjs scripts/try-email-decisions.ts
import { decideEmails } from "../src/lib/gmail-sync.ts";
import { pakistanToday } from "../src/lib/expense-parse.ts";

const today = pakistanToday();
const receivedMs = Date.now();

const emails = [
  {
    id: "aaa001",
    receivedMs,
    from: "alerts@bankalhabib.com",
    subject: "Debit Alert",
    text: `Dear Walli Ullah,\nYour account ending 4417 has been debited with PKR 4,324.00 on ${today} at 14:03 for a card transaction at FOODPANDA PK LHR.\nAvailable balance: PKR 51,204.19\nBank Al Habib Limited`,
  },
  {
    id: "aaa002",
    receivedMs,
    from: "ebanking@meezanbank.com",
    subject: "Funds Transfer Confirmation",
    text: `Dear Walli Ullah,\nRaast transfer of PKR 25,000.00 to CHATTHA TECHNOLOGIES (Allied Bank) was successful on ${today} at 11:20.\nReference 993201`,
  },
  {
    id: "aaa003",
    receivedMs,
    from: "alerts@abl.com",
    subject: "Bill Payment Successful",
    text: `Dear Customer,\nYour bill payment of PKR 1,800.00 to ZONG POSTPAID for consumer 03141234567 was successful on ${today}.`,
  },
  {
    id: "aaa004",
    receivedMs,
    from: "alerts@bankalhabib.com",
    subject: "Credit Alert",
    text: `Dear Walli Ullah,\nYour account ending 4417 has been credited with PKR 120,000.00 on ${today} - inward remittance from ACME CLIENT LTD.`,
  },
  {
    id: "aaa005",
    receivedMs,
    from: "alerts@abl.com",
    subject: "Transaction Declined",
    text: `Dear Customer,\nYour card transaction of PKR 9,999.00 at AMAZON.COM on ${today} was DECLINED due to insufficient funds.`,
  },
  {
    id: "aaa006",
    receivedMs,
    from: "alerts@bankalhabib.com",
    subject: "ATM Withdrawal",
    text: `Dear Walli Ullah,\nCash withdrawal of PKR 20,000.00 from ATM DHA PHASE 5 LAHORE on ${today} at 19:41. Available balance PKR 31,204.19.`,
  },
  {
    id: "aaa007",
    receivedMs,
    from: "newsletter@meezanbank.com",
    subject: "Introducing our new Roshan Digital Account",
    text: "Open a Roshan Digital Account today and enjoy profit rates up to 20%. Terms and conditions apply.",
  },
];

const { decisions, model } = await decideEmails(emails, ["Food", "Transport", "Groceries", "Bills", "Cash"], today);

console.log(`\nmodel: ${model}   today: ${today}\n`);
for (const e of emails) {
  const d = decisions.get(e.id);
  const line =
    d?.kind === "expense"
      ? `EXPENSE  Rs ${d.amount}  ${d.vendor ?? "(no payee)"}  ${d.date}  [${d.category ?? "no category"}]  ${d.note}`
      : `skip     ${d?.reason ?? "(no answer)"}`;
  console.log(`${e.subject.padEnd(42)} ${line}`);
}
