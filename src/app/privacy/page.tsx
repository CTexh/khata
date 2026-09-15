import type { Metadata } from "next";
import Link from "next/link";
import { Logo } from "@/components/Logo";

export const metadata: Metadata = {
  title: "Privacy Policy — Khata",
  description: "What Khata stores, why, and who processes it.",
};

// Public on purpose (see PUBLIC_PATHS in src/proxy.ts): a privacy policy
// should be readable without an account. Keep this in step with what the app
// actually does.
const SECTIONS: { title: string; body: string[] }[] = [
  {
    title: "What Khata is",
    body: [
      "Khata is a private personal-finance app for tracking expenses, subscriptions and money lent to people. Accounts are created by its administrator; it is not open to the public.",
    ],
  },
  {
    title: "What we store",
    body: [
      "Your account: username, display name and a hashed password (never the password itself).",
      "What you record: expenses (amount, date, vendor, category and notes), subscriptions, people and ledger entries.",
      "Expenses imported from bank notification emails, where that has been set up for your account.",
      "For messages sent to the Khata assistant: the message id and which expense or Udhar Khata entries it created or changed, so a message is never added twice and UNDO can reverse it.",
      "Your conversation with the in-app assistant is kept only in your browser on that device, and is removed when you press Clear.",
    ],
  },
  {
    title: "Assistant messages and photos",
    body: [
      "Messages you send to the Khata assistant - typed, as a voice note, or with a photo of a bill or receipt - are used to add, change or remove your expenses, Udhar Khata entries, subscriptions and categories, or to answer a question about your own data, and you get a reply confirming it.",
      "Photos and voice notes are read once and are not kept. The original message text is kept as the expense's note.",
    ],
  },
  {
    title: "Services that process your data",
    body: [
      "Google (Gemini API) reads messages sent to the Khata assistant, bill photos and voice notes, to work out what they describe or ask. So that a message can be matched to the right person, it is also sent the names in your Udhar Khata, your category names and your subscription names. Khata uses Google's free tier, under which Google may use the content sent to it to improve its products.",
      "Vercel hosts the app, and Turso hosts its database.",
    ],
  },
  {
    title: "What we don't do",
    body: [
      "Khata does not sell your data, show ads, or share your data with anyone other than the services listed above, and only to provide the features described here.",
    ],
  },
  {
    title: "Keeping and deleting your data",
    body: [
      "Your data is kept until it is deleted. You can delete any expense, subscription or ledger entry in the app, and ask the assistant to undo the last change it made in the past 24 hours.",
      "To have your whole account and everything in it deleted, ask the administrator who gave you your account.",
    ],
  },
];

export default function PrivacyPage() {
  return (
    <main className="w-full max-w-2xl mx-auto min-h-dvh px-4 py-10 flex flex-col gap-6">
      <div className="flex items-center gap-3">
        <Logo size={40} />
        <span className="wordmark text-[26px]">Khata</span>
      </div>

      <article className="card p-6 sm:p-8 rise flex flex-col gap-6">
        <header>
          <h1 className="text-2xl font-bold">Privacy Policy</h1>
          <p className="text-[13px] mt-1" style={{ color: "var(--muted)" }}>
            Effective 15 September 2026
          </p>
        </header>

        {SECTIONS.map((s) => (
          <section key={s.title} className="flex flex-col gap-2">
            <h2 className="font-semibold text-[16px]">{s.title}</h2>
            {s.body.map((p) => (
              <p key={p} className="text-[14px] leading-relaxed" style={{ color: "var(--ink-2)" }}>
                {p}
              </p>
            ))}
          </section>
        ))}
      </article>

      <Link href="/login" className="text-[13px] underline underline-offset-2 self-center" style={{ color: "var(--muted)" }}>
        Back to Khata
      </Link>
    </main>
  );
}
