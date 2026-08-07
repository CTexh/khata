import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { verifyToken, verifyRoutineSecret, SESSION_COOKIE_NAME } from "@/lib/auth";

const PUBLIC_PATHS = ["/login", "/signup"];

// Only this exact path may authenticate via x-routine-secret. Scoping it here
// (rather than a blanket bypass) means a leaked/guessed secret can never skip
// login for admin pages or any other route — it only ever unlocks this one.
const ROUTINE_AUTH_PATH = "/api/expenses";

export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const token = request.cookies.get(SESSION_COOKIE_NAME)?.value;
  const session = token ? verifyToken(token) : null;
  const isApi = pathname.startsWith("/api/");
  const isPublic = PUBLIC_PATHS.includes(pathname);

  const hasValidRoutineSecret =
    pathname === ROUTINE_AUTH_PATH &&
    verifyRoutineSecret(request.headers.get("x-routine-secret"));

  if (!session && !isPublic && !hasValidRoutineSecret) {
    if (isApi) {
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    }
    const url = new URL("/login", request.url);
    url.searchParams.set("next", pathname);
    return NextResponse.redirect(url);
  }

  if (session && isPublic) {
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
  matcher: ["/((?!_next/static|_next/image|favicon|manifest.json|icon-|apple-touch-icon|api/auth).*)"],
};
