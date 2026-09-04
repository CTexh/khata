import ExcelJS from "exceljs";
import { categoryTotals, listExpenses } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { MONTH_NAMES } from "@/lib/format";

export const dynamic = "force-dynamic";

// Excel export of a period's expenses. Scope is set by the query string:
//   ?year=2026                    -> the whole year
//   ?year=2026&month=8            -> one month
//   ?year=2026&month=8&category=X -> one category within that month
//   ?year=2026&category=X         -> one category across the year
export async function GET(req: Request) {
  const session = await getSession();
  if (!session) {
    return Response.json({ error: "Not authenticated" }, { status: 401 });
  }

  const url = new URL(req.url);
  const year = Number(url.searchParams.get("year")) || new Date().getFullYear();
  const monthParam = url.searchParams.get("month");
  const month = monthParam ? Number(monthParam) : undefined;
  const category = url.searchParams.get("category")?.trim() || undefined;

  if (month !== undefined && (!Number.isInteger(month) || month < 1 || month > 12)) {
    return Response.json({ error: "Invalid month" }, { status: 400 });
  }

  const [expenses, breakdown] = await Promise.all([
    listExpenses(session.userId, { year, month, category }),
    categoryTotals(session.userId, { year, month }),
  ]);

  const periodLabel = month ? `${MONTH_NAMES[month - 1]} ${year}` : String(year);
  const scopeLabel = category ? `${periodLabel} · ${category}` : periodLabel;

  const wb = new ExcelJS.Workbook();
  wb.created = new Date();

  /* --- detail sheet --- */
  const sheet = wb.addWorksheet("Expenses");
  sheet.columns = [
    { header: "Date", key: "date", width: 14 },
    { header: "Vendor", key: "vendor", width: 28 },
    { header: "Category", key: "category", width: 20 },
    { header: "Note", key: "note", width: 34 },
    { header: "Amount (Rs)", key: "amount", width: 15 },
  ];

  for (const e of expenses) {
    sheet.addRow({
      // A real Date so Excel can sort and filter it as one.
      date: new Date(`${e.expense_date}T00:00:00Z`),
      vendor: e.vendor ?? "",
      category: e.category ?? "Uncategorised",
      note: e.note ?? "",
      amount: e.amount,
    });
  }

  const total = expenses.reduce((s, e) => s + e.amount, 0);
  const totalRow = sheet.addRow({ note: `Total — ${scopeLabel}`, amount: total });
  totalRow.font = { bold: true };

  sheet.getColumn("date").numFmt = "dd mmm yyyy";
  // Numeric, not text, so the columns stay summable in Excel.
  sheet.getColumn("amount").numFmt = "#,##0.00";
  sheet.getRow(1).font = { bold: true };
  sheet.views = [{ state: "frozen", ySplit: 1 }];
  sheet.autoFilter = { from: "A1", to: "E1" };

  /* --- summary sheet (skipped when the export is already one category) --- */
  if (!category) {
    const summary = wb.addWorksheet("By category");
    summary.columns = [
      { header: "Category", key: "category", width: 24 },
      { header: "Expenses", key: "count", width: 12 },
      { header: "Total (Rs)", key: "total", width: 16 },
      { header: "Share", key: "share", width: 10 },
    ];
    const grand = breakdown.reduce((s, c) => s + c.total, 0);
    for (const c of breakdown) {
      summary.addRow({
        category: c.category,
        count: c.count,
        total: c.total,
        share: grand > 0 ? c.total / grand : 0,
      });
    }
    const sumRow = summary.addRow({ category: `Total — ${periodLabel}`, total: grand });
    sumRow.font = { bold: true };
    summary.getColumn("total").numFmt = "#,##0.00";
    summary.getColumn("share").numFmt = "0.0%";
    summary.getRow(1).font = { bold: true };
    summary.views = [{ state: "frozen", ySplit: 1 }];
  }

  const buffer = await wb.xlsx.writeBuffer();

  const slug = (s: string) => s.replace(/[^a-zA-Z0-9]+/g, "-").replace(/^-|-$/g, "");
  const namePart = month ? `${year}-${String(month).padStart(2, "0")}` : `${year}`;
  const filename = `khata-expenses-${namePart}${category ? `-${slug(category)}` : ""}.xlsx`;

  return new Response(buffer, {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "no-store",
    },
  });
}
