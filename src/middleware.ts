import { NextResponse, type NextRequest } from "next/server";
import { SESSION_COOKIES, verifySession } from "@/lib/session-token";

/** Pages anyone may open (sign-in, invitation and password reset links). */
const PUBLIC_PREFIXES = ["/login", "/p/", "/invite/", "/reset/"];

/**
 * Page guard. Developer console pages need a platform session, everything else a staff session.
 * Signatures and realms are checked here; the account itself is re-checked on every API call and page load.
 */
export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;

  if (pathname === "/platform/login") return NextResponse.next();
  if (pathname === "/platform" || pathname.startsWith("/platform/")) {
    const ok = await verifySession("platform", req.cookies.get(SESSION_COOKIES.platform)?.value);
    return ok ? NextResponse.next() : NextResponse.redirect(new URL("/platform/login", req.url));
  }

  const staff =
    (await verifySession("support", req.cookies.get(SESSION_COOKIES.support)?.value)) ??
    (await verifySession("staff", req.cookies.get(SESSION_COOKIES.staff)?.value));
  if (pathname === "/login") return staff ? NextResponse.redirect(new URL("/home", req.url)) : NextResponse.next();
  if (PUBLIC_PREFIXES.some((p) => pathname.startsWith(p))) return NextResponse.next();
  if (!staff) {
    const url = new URL("/login", req.url);
    if (pathname !== "/") url.searchParams.set("next", pathname);
    return NextResponse.redirect(url);
  }
  return NextResponse.next();
}

// the installable app's manifest, service worker, offline page and icons are public files
export const config = { matcher: ["/((?!api|_next/static|_next/image|favicon.ico|manifest.webmanifest|sw.js|offline.html|icons/).*)"] };
