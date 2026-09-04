import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import {
  db,
  ensureCategoryTables,
  getVendorRule,
  learnedCategoryForVendor,
  listUserCategories,
} from "@/lib/db";
import {
  canonicalCategory,
  isUnexplainedCategory,
  matchRuleCategory,
  normalizeVendor,
} from "@/lib/categorize";

export const dynamic = "force-dynamic";

type Row = {
  id: string;
  vendor: string | null;
  note: string | null;
  category: string | null;
  amount: number;
  expense_date: string;
};

type Change = {
  id: string;
  expense_date: string;
  vendor: string | null;
  note: string | null;
  amount: number;
  from: string | null;
  to: string | null;
  reason: "rule" | "vendor-rule" | "keyword" | "tidy" | "learned" | "unexplained";
  vendorKey: string;
};

// Works out what every existing expense's category *should* be, without
// writing anything. Deliberately a separate pass from resolveExpenseCategory:
// backfill must not learn from history (that is what it is fixing), and it
// also tidies inconsistent spellings like "Grocery" vs "Groceries".
async function planChanges(userId: string): Promise<{ changes: Change[]; scanned: number }> {
  await ensureCategoryTables();
  const c = await db();
  const rs = await c.execute({
    sql: `SELECT id, vendor, note, category, amount, expense_date FROM expenses WHERE user_id = ? ORDER BY expense_date DESC`,
    args: [userId],
  });

  const rows = rs.rows as unknown as Row[];
  const userCategories = await listUserCategories(userId);
  const changes: Change[] = [];
  const vendorRuleCache = new Map<string, string | null>();
  const learnedCache = new Map<string, string | null>();

  for (const r of rows) {
    const vendorKey = normalizeVendor(r.vendor);
    const current = r.category ?? null;

    let target: string | null = null;
    let reason: Change["reason"] = "tidy";

    if (vendorKey) {
      if (!vendorRuleCache.has(vendorKey)) {
        vendorRuleCache.set(vendorKey, await getVendorRule(userId, vendorKey));
      }
      const vr = vendorRuleCache.get(vendorKey) ?? null;
      if (vr) {
        target = vr;
        reason = "vendor-rule";
      }
    }

    // Keywords on the user's own categories, same precedence as at write time.
    if (!target) {
      const haystack = `${r.vendor ?? ""} ${r.note ?? ""}`.toLowerCase();
      const hit = haystack.trim()
        ? userCategories.find((cat) => cat.keywords.some((k) => haystack.includes(k)))
        : undefined;
      if (hit) {
        target = hit.name;
        reason = "keyword";
      }
    }

    if (!target) {
      const rule = matchRuleCategory(r.vendor, r.note);
      if (rule) {
        target = rule;
        reason = "rule";
      }
    }

    // Nothing explains this and the stored value is only the bank's shrug
    // ("Transfer", "RAAST"). Clear it so it lands in review for a decision
    // rather than sitting in a bucket that looks answered.
    let clear = false;
    if (!target && isUnexplainedCategory(current)) {
      clear = true;
      reason = "unexplained";
    }

    // No rule applies, so just fold the existing value onto the canonical
    // spelling ("Grocery" -> "Groceries") and leave the meaning alone.
    if (!clear && !target && current) {
      target = canonicalCategory(current);
      reason = "tidy";
    }

    // Never had a category at all - fall back to what this payee usually is.
    if (!clear && !target && !current && vendorKey) {
      if (!learnedCache.has(vendorKey)) {
        learnedCache.set(vendorKey, await learnedCategoryForVendor(userId, vendorKey));
      }
      const learned = learnedCache.get(vendorKey) ?? null;
      if (learned) {
        target = canonicalCategory(learned);
        reason = "learned";
      }
    }

    if (clear || (target && target !== current)) {
      changes.push({
        id: r.id,
        expense_date: r.expense_date,
        vendor: r.vendor,
        note: r.note,
        amount: Number(r.amount),
        from: current,
        to: clear ? null : target,
        reason,
        vendorKey,
      });
    }
  }

  return { changes, scanned: rows.length };
}

// Preview - shows exactly what would change, writes nothing.
export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  const { changes, scanned } = await planChanges(session.userId);

  // Grouped counts make the summary readable when there are hundreds of rows.
  const summary = new Map<string, number>();
  for (const ch of changes) {
    const key = `${ch.from ?? "(none)"} → ${ch.to ?? "Uncategorised"}`;
    summary.set(key, (summary.get(key) ?? 0) + 1);
  }

  return NextResponse.json({
    scanned,
    total: changes.length,
    summary: [...summary.entries()]
      .map(([label, count]) => ({ label, count }))
      .sort((a, b) => b.count - a.count),
    changes: changes.slice(0, 200),
  });
}

// Apply. Also backfills vendor_key on every row so the learned-category
// lookups have something to match on going forward.
export async function POST() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  const { changes } = await planChanges(session.userId);
  const c = await db();

  for (const ch of changes) {
    await c.execute({
      sql: "UPDATE expenses SET category = ?, vendor_key = ? WHERE id = ? AND user_id = ?",
      args: [ch.to, ch.vendorKey || null, ch.id, session.userId],
    });
  }

  // Fill vendor_key for everything else that was already categorised right.
  const rest = await c.execute({
    sql: `SELECT id, vendor FROM expenses WHERE user_id = ? AND (vendor_key IS NULL OR vendor_key = '')`,
    args: [session.userId],
  });
  for (const r of rest.rows) {
    const key = normalizeVendor(r.vendor as string | null);
    if (!key) continue;
    await c.execute({
      sql: "UPDATE expenses SET vendor_key = ? WHERE id = ? AND user_id = ?",
      args: [key, r.id as string, session.userId],
    });
  }

  return NextResponse.json({ ok: true, updated: changes.length });
}
