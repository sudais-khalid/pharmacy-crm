import bcrypt from "bcryptjs";
import { randomBytes } from "node:crypto";
import type { PrismaClient } from "@prisma/client";
import { platformDb } from "@/lib/platform-db";
import type { Tx } from "@/lib/prisma";
import { AppError } from "@/lib/errors";
import { SESSION_MAX_AGE_S, type VerifiedSession } from "@/lib/session-token";
import { audit } from "@/modules/platform";

/**
 * Platform support: the Developer working inside one pharmacy with Pharmacy Admin rights
 * (docs/plan/02-architecture.md, section 5.4). The work is done as the pharmacy's hidden support account
 * (so sales and stock rows keep a valid staff user) while every audit row names the Developer and the
 * support session, which the pharmacy sees as "Platform support".
 */
type Meta = { ip?: string | null; userAgent?: string | null };
const MAX_AGE_MS = SESSION_MAX_AGE_S.support * 1000;
export const SUPPORT_USERNAME = "platform-support";

/**
 * The pharmacy's hidden support account, created when missing (pharmacies carried over from a single-shop
 * installation have none). It can never sign in: its password is a hash of random bytes nobody knows.
 */
export async function ensureSupportAccount(db: Tx | PrismaClient, pharmacyId: string) {
  const existing = await db.user.findFirst({ where: { pharmacyId, isSystem: true }, select: { id: true } });
  if (existing) return existing;
  const passwordHash = await bcrypt.hash(randomBytes(32).toString("base64url"), 10);
  return db.user.create({
    data: { pharmacyId, name: "Platform support", username: SUPPORT_USERNAME, email: `support-${pharmacyId}@system.invalid`, passwordHash, role: "ADMIN", isSystem: true },
    select: { id: true },
  });
}

export async function startSupportSession(devId: string, pharmacyId: string, reason: string, meta: Meta = {}) {
  const trimmed = reason.trim();
  if (trimmed.length < 3) throw new AppError(400, "Give a reason for the support session.", { fields: { reason: "Required" } });
  const pharmacy = await platformDb.pharmacy.findUnique({ where: { id: pharmacyId }, select: { id: true } });
  if (!pharmacy) throw new AppError(404, "Pharmacy not found.");
  return platformDb.$transaction(async (tx) => {
    await ensureSupportAccount(tx, pharmacyId);
    // one open session per Developer and pharmacy
    await tx.supportSession.updateMany({ where: { platformUserId: devId, pharmacyId, endedAt: null }, data: { endedAt: new Date() } });
    const session = await tx.supportSession.create({ data: { platformUserId: devId, pharmacyId, reason: trimmed } });
    await audit(tx, { actor: { id: devId }, meta, realm: "PLATFORM", supportSessionId: session.id }, {
      action: "support.start", entity: "Pharmacy", entityId: pharmacyId, pharmacyId, after: { reason: trimmed },
    });
    return session;
  });
}

export type SupportInfo = { sessionId: string; devId: string; devName: string; reason: string };

/** The hidden support account and session details behind a verified support token, or null. */
export async function loadSupportSession(token: VerifiedSession | null) {
  if (!token?.pid || !token.ssid) return null;
  const [dev, session, account] = await Promise.all([
    platformDb.platformUser.findUnique({ where: { id: token.sub }, select: { id: true, name: true, sessionVersion: true, totpEnabledAt: true } }),
    platformDb.supportSession.findUnique({ where: { id: token.ssid } }),
    platformDb.user.findFirst({
      where: { pharmacyId: token.pid, isSystem: true },
      select: { id: true, name: true, email: true, username: true, role: true, pharmacyId: true },
    }),
  ]);
  if (!dev || !dev.totpEnabledAt || dev.sessionVersion !== token.sv) return null;
  if (!session || session.endedAt || session.platformUserId !== dev.id || session.pharmacyId !== token.pid) return null;
  if (Date.now() - session.startedAt.getTime() > MAX_AGE_MS) return null;
  if (!account) return null;
  const support: SupportInfo = { sessionId: session.id, devId: dev.id, devName: dev.name, reason: session.reason };
  return { ...account, mustChangePassword: false, support };
}

export async function endSupportSession(sessionId: string, devId: string, meta: Meta = {}) {
  const session = await platformDb.supportSession.findUnique({ where: { id: sessionId } });
  if (!session || session.platformUserId !== devId) throw new AppError(404, "Support session not found.");
  if (!session.endedAt) {
    await platformDb.$transaction(async (tx) => {
      await tx.supportSession.update({ where: { id: sessionId }, data: { endedAt: new Date() } });
      await audit(tx, { actor: { id: devId }, meta, realm: "PLATFORM", supportSessionId: sessionId }, {
        action: "support.end", entity: "Pharmacy", entityId: session.pharmacyId, pharmacyId: session.pharmacyId,
      });
    });
  }
  return { pharmacyId: session.pharmacyId };
}
