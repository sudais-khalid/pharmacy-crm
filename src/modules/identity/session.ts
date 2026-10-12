import { cookies } from "next/headers";
import { platformDb } from "@/lib/platform-db";
import { SESSION_COOKIES, SESSION_MAX_AGE_S, signSession, verifySession, needsRefresh, type SessionRealm, type VerifiedSession } from "@/lib/session-token";
import type { Role } from "./permissions";

export type SessionUser = { id: string; name: string; email: string; username: string; role: Role; pharmacyId: string };
export type PlatformSessionUser = { id: string; name: string; email: string; mfa: boolean; totpEnabled: boolean };

const cookieOptions = (realm: SessionRealm) => ({
  httpOnly: true,
  sameSite: "lax" as const,
  secure: process.env.NODE_ENV === "production",
  path: "/",
  maxAge: SESSION_MAX_AGE_S[realm],
});

async function readToken(realm: SessionRealm) {
  return (await cookies()).get(SESSION_COOKIES[realm])?.value;
}

async function writeToken(realm: SessionRealm, token: string) {
  (await cookies()).set(SESSION_COOKIES[realm], token, cookieOptions(realm));
}

export async function clearSession(realm: SessionRealm) {
  (await cookies()).set(SESSION_COOKIES[realm], "", { ...cookieOptions(realm), maxAge: 0 });
}

// ---------------------------------------------------------------- staff realm

export async function setStaffSession(user: { id: string; pharmacyId: string; sessionVersion: number }) {
  await writeToken("staff", await signSession("staff", { sub: user.id, pid: user.pharmacyId, sv: user.sessionVersion }));
}

/**
 * The account behind a verified staff token, re-checked against the database on every request, so
 * deactivation, a role change, a password reset or a forced logout (all bump sessionVersion) end the
 * session at once. System accounts never have staff sessions.
 */
export async function loadStaffSession(session: VerifiedSession | null): Promise<(SessionUser & { sessionVersion: number }) | null> {
  if (!session?.pid) return null;
  const user = await platformDb.user.findUnique({
    where: { id: session.sub },
    select: { id: true, name: true, email: true, username: true, role: true, active: true, isSystem: true, pharmacyId: true, sessionVersion: true },
  });
  if (!user || !user.active || user.isSystem) return null;
  if (user.pharmacyId !== session.pid || user.sessionVersion !== session.sv) return null;
  return { id: user.id, name: user.name, email: user.email, username: user.username, role: user.role, pharmacyId: user.pharmacyId, sessionVersion: user.sessionVersion };
}

/** Logged-in staff member, or null. With `refresh`, re-issues an ageing token (only allowed in route handlers). */
export async function getSessionUser(opts: { refresh?: boolean } = {}): Promise<SessionUser | null> {
  const session = await verifySession("staff", await readToken("staff"));
  const user = await loadStaffSession(session);
  if (!user) return null;
  if (opts.refresh && session && needsRefresh(session)) await setStaffSession(user);
  const { sessionVersion: _sv, ...rest } = user;
  return rest;
}

// ---------------------------------------------------------------- platform realm

export async function setPlatformSession(dev: { id: string; sessionVersion: number }, mfa: boolean) {
  await writeToken("platform", await signSession("platform", { sub: dev.id, sv: dev.sessionVersion, mfa }));
}

export async function loadPlatformSession(session: VerifiedSession | null): Promise<(PlatformSessionUser & { sessionVersion: number }) | null> {
  if (!session) return null;
  const dev = await platformDb.platformUser.findUnique({ where: { id: session.sub } });
  if (!dev || dev.sessionVersion !== session.sv) return null;
  return { id: dev.id, name: dev.name, email: dev.email, mfa: session.mfa === true, totpEnabled: !!dev.totpEnabledAt, sessionVersion: dev.sessionVersion };
}

/**
 * The signed-in Developer. By default only a session that has passed the second factor counts;
 * enrolment and code entry pass `requireMfa: false`.
 */
export async function getPlatformUser(opts: { requireMfa?: boolean; refresh?: boolean } = {}): Promise<PlatformSessionUser | null> {
  const session = await verifySession("platform", await readToken("platform"));
  const dev = await loadPlatformSession(session);
  if (!dev) return null;
  if ((opts.requireMfa ?? true) && !dev.mfa) return null;
  if (opts.refresh && session && needsRefresh(session)) await setPlatformSession(dev, dev.mfa);
  const { sessionVersion: _sv, ...rest } = dev;
  return rest;
}
