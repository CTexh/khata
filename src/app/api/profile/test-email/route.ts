import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import {
  categoryTotals,
  ensureTablesExist,
  getProfileSettings,
  listExpensesInRange,
  listLedgerActivity,
  listLedgerPeople,
  listSubscriptions,
} from "@/lib/db";
import { mailConfigured, sendMail } from "@/lib/mailer";
import {
  buildRecap,
  dailyRecapEmail,
  monthlySummaryEmail,
  subscriptionReminderEmail,
  udharReminderEmail,
  type ReminderEmail,
} from "@/lib/reminders";
import { addDays, pakistanToday } from "@/lib/expense-parse";
import { MONTH_NAMES } from "@/lib/format";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const APP_URL = process.env.APP_URL ?? "https://khata-delta.vercel.app";

// Sends one sample of every reminder email to the address in the user's
// profile, built from their own records where they have them, so the content
// and links can be checked before relying on the real thing. Nothing is
// logged as sent, so real reminders are unaffected.
export async function POST() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  if (!mailConfigured()) {
    return NextResponse.json({ error: "Email reminders aren't set up on the server yet." }, { status: 503 });
  }
  const settings = await getProfileSettings(session.userId);
  if (!settings?.email) {
    return NextResponse.json({ error: "Save your email address first." }, { status: 400 });
  }

  await ensureTablesExist();
  const today = pakistanToday();
  const name = settings.name || session.username;
  const [subs, people] = await Promise.all([listSubscriptions(session.userId), listLedgerPeople(session.userId)]);

  const sub = subs.find((s) => s.active && !s.paid_this_period) ?? subs.find((s) => s.active) ?? subs[0];
  const subItem = sub
    ? { key: "test", id: sub.id, name: sub.name, amount: sub.amount }
    : { key: "test", id: "", name: "Netflix", amount: 1500 };
  const person = [...people].sort((a, b) => b.balance - a.balance)[0];
  const personItem =
    person && person.balance >= 0.005
      ? { key: "test", id: person.id, name: person.name, amount: person.balance, date: today }
      : { key: "test", id: person?.id ?? "", name: person?.name ?? "Ali", amount: 2000, date: today };

  const [y, m] = today.split("-").map(Number);
  const [sy, sm] = m === 1 ? [y - 1, 12] : [y, m - 1];
  const totals = await categoryTotals(session.userId, { year: sy, month: sm });
  const owing = people.filter((p) => p.balance >= 0.005);

  const samples: ReminderEmail[] = [
    subscriptionReminderEmail({ name, item: { ...subItem, date: addDays(today, 1) }, stage: "before", appUrl: APP_URL }),
    subscriptionReminderEmail({ name, item: { ...subItem, date: today }, stage: "due", appUrl: APP_URL }),
    udharReminderEmail({ name, item: personItem, appUrl: APP_URL }),
    monthlySummaryEmail({
      name,
      summary: {
        label: `${MONTH_NAMES[sm - 1]} ${sy}`,
        total: totals.reduce((s, c) => s + c.total, 0),
        count: totals.reduce((s, c) => s + c.count, 0),
        top: totals.map((c) => ({ category: c.category, total: c.total })),
      },
      owed: { total: owing.reduce((s, p) => s + p.balance, 0), people: owing.length },
      appUrl: APP_URL,
    }),
  ];

  // The recap covers yesterday, as the 4:30am email does.
  const recapDate = addDays(today, -1);
  const recap = await buildRecap(recapDate, {
    expenses: (from, to) => listExpensesInRange(session.userId, from, to),
    ledger: (from, to) => listLedgerActivity(session.userId, from, to),
    subscriptions: async () => subs,
  });
  samples.push(dailyRecapEmail({ name, recap, appUrl: APP_URL }));

  let sent = 0;
  try {
    for (const email of samples) {
      await sendMail({ to: settings.email, ...email, subject: `[Test] ${email.subject}` });
      sent++;
    }
  } catch (err) {
    console.error(JSON.stringify({ evt: "test_email", sent, error: (err as Error).message.slice(0, 200) }));
    return NextResponse.json(
      { error: sent ? `Sent ${sent} of ${samples.length}, then sending failed. Please try again later.` : "Couldn't send the email. Please try again later." },
      { status: 502 }
    );
  }
  return NextResponse.json({ sent, to: settings.email });
}
