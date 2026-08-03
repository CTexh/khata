import { NextResponse } from "next/server";
import { db, findUserByUsername } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  try {
    const { username, year, month } = await req.json();

    // Get user
    const user = await findUserByUsername(username);
    if (!user) {
      return NextResponse.json({ error: "User not found" }, { status: 404 });
    }

    // Build date prefix for the month
    const prefix = `${year}-${String(month).padStart(2, "0")}`;

    const c = await db();

    // Count expenses to delete
    const countRes = await c.execute({
      sql: "SELECT COUNT(*) as count FROM expenses WHERE user_id = ? AND expense_date LIKE ?",
      args: [user.id, `${prefix}%`],
    });

    const count = Number(countRes.rows[0].count);

    // Delete expenses
    await c.execute({
      sql: "DELETE FROM expenses WHERE user_id = ? AND expense_date LIKE ?",
      args: [user.id, `${prefix}%`],
    });

    return NextResponse.json({
      success: true,
      deleted: count,
      message: `Deleted ${count} expenses for ${username} in ${prefix}`
    });
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}
