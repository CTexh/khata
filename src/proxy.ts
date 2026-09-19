import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { verifyToken, verifyRoutineSecret, SESSION_COOKIE_NAME } from "@/lib/auth";

// Pages that open without logging in. A privacy policy should be readable
// without an account.
const PUBLIC_PATHS = ["/login", "/signup", "/privacy"];
// The subset a logged-in user is sent away from - they have no use for the
// login form, but may well want to read the privacy policy.
const AUTH_PAGES = ["/login", "/signup"];

// Only these exact paths may authenticate via x-routine-secret. Scoping it
// here (rather than a blanket bypass) means a leaked/guessed secret can never
// skip login for admin pages or any other route - it only ever unlocks the
// email routine's own endpoints.
const ROUTINE_AUTH_PATHS = new Set(["/api/expenses", "/api/routine/unseen", "/api/routine/ingest"]);

export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const token = request.cookies.get(SESSION_COOKIE_NAME)?.value;
  const session = token ? verifyToken(token) : null;
  const isApi = pathname.startsWith("/api/");
  const isPublic = PUBLIC_PATHS.includes(pathname);

  const hasValidRoutineSecret =
    ROUTINE_AUTH_PATHS.has(pathname) &&
    verifyRoutineSecret(request.headers.get("x-routine-secret"));

  if (!session && !isPublic && !hasValidRoutineSecret) {
    if (isApi) {
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    }
    const url = new URL("/login", request.url);
    url.searchParams.set("next", pathname + request.nextUrl.search);
    return NextResponse.redirect(url);
  }

  if (session && AUTH_PAGES.includes(pathname)) {
    return NextResponse.redirect(new URL("/", request.url));
  }

  const isAdminRoute = pathname.startsWith("/admin") || pathname.startsWith("/api/admin");
  if (isAdminRoute && !session?.isAdmin) {
    if (isApi) {
      return NextResponse.json({ error: "Admin access required" }, { status: 403 });
    }
    return NextResponse.redirect(new URL("/", request.url));
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon|manifest.json|icon-|apple-touch-icon|sw.js|api/auth|api/cron).*)"],
};
