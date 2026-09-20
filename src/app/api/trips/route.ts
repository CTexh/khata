import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { getProfileSettings } from "@/lib/db";
import { createTrip, listTrips } from "@/lib/trips-db";
import { DATE } from "../trips/guard";

export const dynamic = "force-dynamic";

export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  return NextResponse.json(await listTrips(session.userId));
}

// A new trip. Whoever creates it is on it: the settle-up has to know where
// they stand, and it is their app.
export async function POST(req: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const name = String(body.name ?? "").trim().slice(0, 80);
  const startDate = String(body.startDate ?? "").trim() || null;
  const endDate = String(body.endDate ?? "").trim() || null;
  const others = Array.isArray(body.members)
    ? body.members.map((m: unknown) => String(m).trim().slice(0, 60)).filter(Boolean)
    : [];

  if (!name) return NextResponse.json({ error: "Give the trip a name" }, { status: 400 });
  if ((startDate && !DATE.test(startDate)) || (endDate && !DATE.test(endDate))) {
    return NextResponse.json({ error: "Those dates don't look right" }, { status: 400 });
  }
  if (startDate && endDate && endDate < startDate) {
    return NextResponse.json({ error: "The trip can't end before it starts" }, { status: 400 });
  }

  const profile = await getProfileSettings(session.userId);
  const myName = String(body.myName ?? "").trim() || profile?.name?.trim() || "You";
  // Two people called "Ali" on one trip would make every balance a guess.
  const seen = new Set([myName.toLowerCase()]);
  const memberNames: string[] = [];
  for (const other of others) {
    const key = other.toLowerCase();
    if (seen.has(key)) return NextResponse.json({ error: `There are two people called ${other}` }, { status: 400 });
    seen.add(key);
    memberNames.push(other);
  }

  const id = await createTrip(session.userId, { name, startDate, endDate, myName, memberNames });
  return NextResponse.json({ id }, { status: 201 });
}
