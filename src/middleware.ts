import { NextResponse, type NextRequest } from "next/server";
import { jwtVerify } from "jose";

const COOKIE = "pharmacy_session";

async function valid(token?: string) {
  if (!token) return false;
  try {
    await jwtVerify(token, new TextEncoder().encode(process.env.JWT_SECRET || ""));
    return true;
  } catch {
    return false;
  }
}

export async function middleware(req: NextRequest) {
  const ok = await valid(req.cookies.get(COOKIE)?.value);
  const { pathname } = req.nextUrl;
  if (pathname === "/login") {
    return ok ? NextResponse.redirect(new URL("/dashboard", req.url)) : NextResponse.next();
  }
  if (!ok) {
    const url = new URL("/login", req.url);
    if (pathname !== "/") url.searchParams.set("next", pathname);
    return NextResponse.redirect(url);
  }
  return NextResponse.next();
}

export const config = { matcher: ["/((?!api|_next/static|_next/image|favicon.ico).*)"] };
