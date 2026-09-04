import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import {
  createUserCategory,
  deleteUserCategory,
  listUserCategories,
  updateUserCategory,
} from "@/lib/db";

export const dynamic = "force-dynamic";

// The user's own category list. Categories are chosen from here rather than
// typed, so the set stays small and consistent.
export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  return NextResponse.json({ categories: await listUserCategories(session.userId) });
}

export async function POST(req: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  const body = await req.json();
  const name = String(body.name ?? "").trim();
  const keywords = String(body.keywords ?? "").trim();

  if (!name) return NextResponse.json({ error: "Name is required" }, { status: 400 });
  if (name.length > 40) {
    return NextResponse.json({ error: "Name is too long" }, { status: 400 });
  }

  const existing = await listUserCategories(session.userId);
  if (existing.some((c) => c.name.toLowerCase() === name.toLowerCase())) {
    return NextResponse.json({ error: "That category already exists" }, { status: 409 });
  }

  await createUserCategory(session.userId, name, keywords);
  return NextResponse.json({ ok: true, categories: await listUserCategories(session.userId) }, { status: 201 });
}

export async function PATCH(req: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  const body = await req.json();
  const name = String(body.name ?? "").trim();
  const newName = body.newName === undefined ? undefined : String(body.newName).trim();
  const keywords = body.keywords === undefined ? undefined : String(body.keywords).trim();

  if (!name) return NextResponse.json({ error: "Name is required" }, { status: 400 });
  if (newName !== undefined && !newName) {
    return NextResponse.json({ error: "Name can't be empty" }, { status: 400 });
  }

  await updateUserCategory(session.userId, name, { newName, keywords });
  return NextResponse.json({ ok: true, categories: await listUserCategories(session.userId) });
}

export async function DELETE(req: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  const name = new URL(req.url).searchParams.get("name")?.trim();
  if (!name) return NextResponse.json({ error: "Name is required" }, { status: 400 });

  await deleteUserCategory(session.userId, name);
  return NextResponse.json({ ok: true, categories: await listUserCategories(session.userId) });
}
