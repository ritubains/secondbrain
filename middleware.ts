import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

// Presence-only gate: the backend JWT_SECRET never leaves the API.
// Stale/forged cookies still fail closed at the API (401) — see the
// 401 backstop in app/notes/page.tsx.
export function middleware(req: NextRequest) {
  const hasSession = Boolean(req.cookies.get("session")?.value);
  const { pathname, search } = req.nextUrl;

  if (pathname === "/" || pathname === "/login") {
    if (hasSession && pathname === "/login") return NextResponse.redirect(new URL("/notes", req.url));
    if (pathname === "/") {
      return NextResponse.redirect(new URL(hasSession ? "/notes" : "/login", req.url));
    }
    return NextResponse.next();
  }

  if (pathname.startsWith("/notes") && !hasSession) {
    const url = new URL("/login", req.url);
    url.searchParams.set("next", pathname + search);
    return NextResponse.redirect(url);
  }
  return NextResponse.next();
}

export const config = { matcher: ["/", "/login", "/notes/:path*"] };
