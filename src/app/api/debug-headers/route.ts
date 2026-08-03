import { NextResponse } from "next/server";

export async function POST(req: Request) {
  const headers: Record<string, string> = {};
  req.headers.forEach((value, key) => {
    headers[key] = value;
  });

  return NextResponse.json({
    message: "Debug endpoint",
    headers,
    secretHeader: req.headers.get("x-routine-secret"),
  });
}
