import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { findUserById, listExpenses } from "@/lib/db";
import { sendWhatsAppMonthlyReport } from "@/lib/whatsapp";
import { fmtRs, MONTH_NAMES } from "@/lib/format";

export const dynamic = "force-dynamic";

// On-demand version of the automatic end-of-month report - sends the
// current calendar month's running total right now, whatever it is so far.
export async function POST() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  const user = await findUserById(session.userId);
  if (!user?.phone) {
    return NextResponse.json(
      { error: "Add your WhatsApp number in your profile first (top-right menu → Edit Profile)." },
      { status: 400 }
    );
  }

  const now = new Date();
  const year = now.getFullYear();
  const month = now.getMonth() + 1;
  const expenses = await listExpenses(session.userId, { year, month });
  const total = expenses.reduce((sum, e) => sum + e.amount, 0);

  const result = await sendWhatsAppMonthlyReport(
    user.phone,
    `${MONTH_NAMES[month - 1]} ${year} (so far)`,
    fmtRs(total)
  );

  if (!result.ok) {
    return NextResponse.json({ error: result.error ?? "Couldn't send" }, { status: 502 });
  }
  return NextResponse.json({ success: true });
}
