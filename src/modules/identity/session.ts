import { cookies } from "next/headers";
import { SignJWT, jwtVerify } from "jose";
import { prisma } from "@/lib/prisma";
import type { Role } from "./permissions";

export const SESSION_COOKIE = "pharmacy_session";
const MAX_AGE = 60 * 60 * 8; // 8 hours

function secret() {
  const s = process.env.JWT_SECRET;
  if (!s || s.length < 32) throw new Error("JWT_SECRET must be set and at least 32 characters long");
  return new TextEncoder().encode(s);
}

export type SessionUser = { id: string; name: string; email: string; role: Role };

export async function createSessionToken(userId: string) {
  return new SignJWT({}).setProtectedHeader({ alg: "HS256" }).setSubject(userId).setIssuedAt().setExpirationTime(`${MAX_AGE}s`).sign(secret());
}

export async function setSessionCookie(userId: string) {
  const token = await createSessionToken(userId);
  (await cookies()).set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: MAX_AGE,
  });
}

export async function clearSessionCookie() {
  (await cookies()).set(SESSION_COOKIE, "", { httpOnly: true, path: "/", maxAge: 0 });
}

/** Returns the logged-in user (re-checked against the DB so disabled users are locked out immediately). */
export async function getSessionUser(): Promise<SessionUser | null> {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, secret());
    if (!payload.sub) return null;
    const user = await prisma.user.findUnique({
      where: { id: payload.sub },
      select: { id: true, name: true, email: true, role: true, active: true },
    });
    if (!user || !user.active) return null;
    return { id: user.id, name: user.name, email: user.email, role: user.role };
  } catch {
    return null;
  }
}
