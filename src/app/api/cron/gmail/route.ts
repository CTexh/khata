import { NextResponse, after } from "next/server";
import { ensureTablesExist } from "@/lib/db";
import { syncGmailExpenses } from "@/lib/gmail-sync";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// The Gmail import on its own, for running it by hand and for watching what it
// decided. /api/cron/run does the same thing on its ordinary schedule, so
// nothing has to call this - it is the door to open when a payment has not
// turned up and the question is why.
//
// Guarded by CRON_SECRET; /api/cron/* is outside the session check in proxy.ts,
// as a scheduled caller has no session.
export async function GET(req: Request) {
  const auth = req.headers.get("authorization");
  if (!process.env.CRON_SECRET || auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  await ensureTablesExist();
  const { summary, notify } = await syncGmailExpenses();
  // After the response: what was imported is told to the user without the
  // caller waiting on a push service.
  after(notify);
  if (!summary.ok) console.error(JSON.stringify({ evt: "gmail_sync", ...summary }));
  else if (summary.state === "imported") console.log(JSON.stringify({ evt: "gmail_sync", ...summary }));
  return NextResponse.json(summary, { status: summary.ok ? 200 : 500 });
}
