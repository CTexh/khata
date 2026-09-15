// Sends email through Gmail's SMTP server with an app password, so reminders
// cost nothing and need no domain of their own. Set in Vercel:
//   GMAIL_USER          the Gmail address emails come from
//   GMAIL_APP_PASSWORD  a 16-character app password for that account
import nodemailer, { type Transporter } from "nodemailer";

let transporter: Transporter | null = null;

export function mailConfigured(): boolean {
  return Boolean(process.env.GMAIL_USER && process.env.GMAIL_APP_PASSWORD);
}

function transport(): Transporter {
  transporter ??= nodemailer.createTransport({
    host: "smtp.gmail.com",
    port: 465,
    secure: true,
    auth: {
      user: process.env.GMAIL_USER,
      // Google shows app passwords in groups of four; the spaces aren't part of it.
      pass: (process.env.GMAIL_APP_PASSWORD ?? "").replace(/\s+/g, ""),
    },
  });
  return transporter;
}

export async function sendMail(message: { to: string; subject: string; text: string; html: string }): Promise<void> {
  if (!mailConfigured()) throw new Error("Email is not set up (GMAIL_USER / GMAIL_APP_PASSWORD)");
  await transport().sendMail({
    from: `Khata <${process.env.GMAIL_USER}>`,
    ...message,
  });
}
