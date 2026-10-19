import { cookies } from "next/headers";
import { platformDb } from "@/lib/platform-db";
import { SESSION_COOKIES, SESSION_MAX_AGE_S, signSession, verifySession, needsRefresh, type SessionRealm, type VerifiedSession } from "@/lib/session-token";
import type { Permission } from "./permissions";
import { roleSelect, sessionRole, type SessionRole } from "./roles";
import { loadSupportSession, type SupportInfo } from "./support";
import { pendingSecondFactor } from "./staff-mfa";

export type SessionUser = {
  id: string; name: string; email: string; username: string; pharmacyId: string; mustChangePassword: boolean;
  role: SessionRole;
  /** Resolved from the role on every request, so a role change or a role edit applies at once. */
  permissions: Permission[];
  /** Set when the Developer is working inside the pharmacy (platform support). */
  support?: SupportInfo;
  /** Still to do after the password: enter an authenticator code, or set one up (pharmacy requires it). */
  secondFactor?: "verify" | "enrol" | null;
};
export type PlatformSessionUser = { id: string; name: string; email: string; mfa: boolean; totpEnabled: boolean; sessionVersion: number };

/** Pharmacies in these states cannot be used by their staff (the Developer can still open them). */
export const BLOCKED_STATUSES: string[] = ["SUSPENDED", "DEACTIVATED"];

const cookieOptions = (realm: SessionRealm) => ({
  httpOnly: true,
  sameSite: "lax" as const,
  // The desktop app serves plain http on the shop network (tablets at http://192.168.x.x), where browsers
  // drop Secure cookies; it sets SESSION_COOKIE_SECURE=0. Servers behind HTTPS keep the default.
  secure: process.env.NODE_ENV === "production" && process.env.SESSION_COOKIE_SECURE !== "0",
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

/** mfa: the second factor was entered in this session (it only matters for accounts that use one). */
export async function setStaffSession(user: { id: string; pharmacyId: string; sessionVersion: number }, mfa = false) {
  await writeToken("staff", await signSession("staff", { sub: user.id, pid: user.pharmacyId, sv: user.sessionVersion, mfa }));
}

/**
 * The account behind a verified staff token, re-checked against the database on every request, so
 * deactivation, a role change, a password reset or a forced logout (all bump sessionVersion) end the
 * session at once. System accounts never have staff sessions.
 */
export async function loadStaffSession(session: VerifiedSession | null): Promise<(SessionUser & { sessionVersion: number; mfa: boolean }) | null> {
  if (!session?.pid) return null;
  const user = await platformDb.user.findUnique({
    where: { id: session.sub },
    select: { id: true, name: true, email: true, username: true, role: { select: roleSelect }, active: true, isSystem: true, pharmacyId: true, sessionVersion: true, mustChangePassword: true, totpEnabledAt: true, pharmacy: { select: { status: true, settings: { select: { requireStaffTotp: true } } } } },
  });
  if (!user || !user.active || user.isSystem) return null;
  if (user.pharmacyId !== session.pid || user.sessionVersion !== session.sv) return null;
  if (BLOCKED_STATUSES.includes(user.pharmacy.status)) return null;
  return { id: user.id, name: user.name, email: user.email, username: user.username, ...sessionRole(user.role), pharmacyId: user.pharmacyId, mustChangePassword: user.mustChangePassword, sessionVersion: user.sessionVersion,
    secondFactor: pendingSecondFactor(user, user.pharmacy.settings?.requireStaffTotp ?? false, session.mfa === true), mfa: session.mfa === true };
}

/**
 * Logged-in staff member, or null. A platform support session, when present, takes precedence: the
 * Developer chose to work inside this pharmacy. With `refresh`, re-issues an ageing staff token
 * (only allowed in route handlers).
 */
export async function getSessionUser(opts: { refresh?: boolean } = {}): Promise<SessionUser | null> {
  const supportToken = await readToken("support");
  if (supportToken) {
    const support = await loadSupportSession(await verifySession("support", supportToken));
    if (support) return support;
  }
  const session = await verifySession("staff", await readToken("staff"));
  const user = await loadStaffSession(session);
  if (!user) return null;
  if (opts.refresh && session && needsRefresh(session)) await setStaffSession(user, user.mfa);
  const { sessionVersion: _sv, mfa: _mfa, ...rest } = user;
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
  return dev;
}

// ---------------------------------------------------------------- support realm

export async function setSupportSession(dev: { id: string; sessionVersion: number }, pharmacyId: string, supportSessionId: string) {
  await writeToken("support", await signSession("support", { sub: dev.id, sv: dev.sessionVersion, pid: pharmacyId, ssid: supportSessionId }));
}

export async function readSupportToken() {
  return verifySession("support", await readToken("support"));
}
