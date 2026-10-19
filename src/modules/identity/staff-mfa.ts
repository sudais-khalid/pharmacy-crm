import QRCode from "qrcode";
import { platformDb } from "@/lib/platform-db";
import { runInTx } from "@/lib/db";
import { AppError } from "@/lib/errors";
import { isLimited, recordHit, clearBucket } from "@/lib/rate-limit";
import { open, seal } from "@/lib/secret-box";
import { newTotpSecret, otpauthUri, verifyTotp } from "@/lib/totp";
import { audit } from "@/modules/platform";
import type { ServiceContext } from "./context";
import { missingPermissions, rolePermissions } from "./permissions";
import { roleSelect } from "./roles";
import { hashRecoveryCode, newRecoveryCodes } from "./second-factor";

/**
 * Staff two-factor sign-in (docs/plan/05-roadmap.md, task 3.4): optional for each person, required for
 * everyone when the Pharmacy Admin turns it on. After the password, a session stays "second factor
 * pending" until a code (or a recovery code) is entered; with the requirement on, people without an
 * authenticator set one up first. These calls run before a full session exists, so they use the
 * platform client and check the account themselves.
 */
const WINDOW_MS = 15 * 60 * 1000;
type Meta = { ip?: string | null; userAgent?: string | null };
const staffCtx = (u: { id: string; pharmacyId: string }, meta?: Meta) => ({ actor: { id: u.id }, meta, realm: "STAFF" as const });

async function account(userId: string) {
  const user = await platformDb.user.findUnique({ where: { id: userId }, select: { id: true, username: true, pharmacyId: true, totpSecret: true, totpEnabledAt: true, totpLastStep: true, recoveryCodes: true, sessionVersion: true, pharmacy: { select: { name: true } } } });
  if (!user) throw new AppError(404, "Account not found.");
  return user;
}

/** What a session still needs: "verify" a code, "enrol" an authenticator (required by the pharmacy), or nothing. */
export function pendingSecondFactor(user: { totpEnabledAt: Date | null }, required: boolean, mfaDone: boolean): "verify" | "enrol" | null {
  if (user.totpEnabledAt) return mfaDone ? null : "verify";
  return required ? "enrol" : null;
}

export async function startStaffEnrolment(userId: string) {
  const user = await account(userId);
  if (user.totpEnabledAt) throw new AppError(409, "Two-factor sign-in is already set up.");
  let secret = user.totpSecret ? open(user.totpSecret) : null;
  if (!secret) {
    secret = newTotpSecret();
    await platformDb.user.update({ where: { id: userId }, data: { totpSecret: seal(secret) } });
  }
  const uri = otpauthUri(secret, `${user.username} (${user.pharmacy.name})`);
  const qrSvg = await QRCode.toString(uri, { type: "svg", margin: 1, width: 204 });
  return { secret: secret.replace(/(.{4})/g, "$1 ").trim(), uri, qrSvg };
}

/** Finishes set-up with a first code. Returns the recovery codes, shown once. */
export async function confirmStaffEnrolment(userId: string, code: string, meta: Meta = {}) {
  const user = await account(userId);
  if (user.totpEnabledAt) throw new AppError(409, "Two-factor sign-in is already set up.");
  if (!user.totpSecret) throw new AppError(409, "Start the set-up first.");
  const step = verifyTotp(open(user.totpSecret), code);
  if (step === null) throw new AppError(400, "That code is not valid. Check the time on your phone and try again.", { fields: { code: "Not valid" } });
  const codes = newRecoveryCodes();
  await platformDb.user.update({ where: { id: userId }, data: { totpEnabledAt: new Date(), totpLastStep: BigInt(step), recoveryCodes: codes.map(hashRecoveryCode) } });
  await audit(platformDb, staffCtx(user, meta), { action: "user.mfa.enrol", entity: "User", entityId: userId, pharmacyId: user.pharmacyId });
  return { recoveryCodes: codes, sessionVersion: user.sessionVersion };
}

/** A code from the authenticator (each works once) or a recovery code (used up). */
export async function verifyStaffSecondFactor(userId: string, input: { code?: string; recoveryCode?: string }, meta: Meta = {}) {
  const bucket = `staff-mfa:${userId}`;
  if (await isLimited(bucket, 6, WINDOW_MS)) throw new AppError(429, "Too many attempts. Try again in a few minutes.");
  const user = await account(userId);
  if (!user.totpEnabledAt || !user.totpSecret) throw new AppError(409, "Two-factor sign-in is not set up.");
  if (input.code) {
    const step = verifyTotp(open(user.totpSecret), input.code, { notAfterStep: user.totpLastStep === null ? null : Number(user.totpLastStep) });
    if (step !== null) {
      await platformDb.user.update({ where: { id: userId }, data: { totpLastStep: BigInt(step), lastLoginAt: new Date() } });
      await clearBucket(bucket);
      return { method: "totp" as const, sessionVersion: user.sessionVersion };
    }
  } else if (input.recoveryCode) {
    const h = hashRecoveryCode(input.recoveryCode);
    if (user.recoveryCodes.includes(h)) {
      const left = user.recoveryCodes.filter((c) => c !== h);
      await platformDb.user.update({ where: { id: userId }, data: { recoveryCodes: left, lastLoginAt: new Date() } });
      await clearBucket(bucket);
      await audit(platformDb, staffCtx(user, meta), { action: "user.mfa.recovery", entity: "User", entityId: userId, pharmacyId: user.pharmacyId, after: { recoveryCodesLeft: left.length } });
      return { method: "recovery" as const, recoveryCodesLeft: left.length, sessionVersion: user.sessionVersion };
    }
  }
  await recordHit(bucket);
  throw new AppError(401, "That code is not valid.", { fields: { code: "Not valid" } });
}

/** Turns one's own two-factor sign-in off, with a current code; not while the pharmacy requires it. */
export async function disableOwnSecondFactor(userId: string, code: string, meta: Meta = {}) {
  const user = await account(userId);
  const settings = await platformDb.pharmacySettings.findUnique({ where: { pharmacyId: user.pharmacyId }, select: { requireStaffTotp: true } });
  if (settings?.requireStaffTotp) throw new AppError(409, "Your pharmacy requires two-factor sign-in for everyone.");
  await verifyStaffSecondFactor(userId, { code }, meta);
  await platformDb.user.update({ where: { id: userId }, data: { totpSecret: null, totpEnabledAt: null, totpLastStep: null, recoveryCodes: [] } });
  await audit(platformDb, staffCtx(user, meta), { action: "user.mfa.disable", entity: "User", entityId: userId, pharmacyId: user.pharmacyId });
  return { ok: true };
}

/** For a staff member who lost their phone: removes the authenticator and ends their sessions. */
export async function resetStaffSecondFactor(ctx: ServiceContext, id: string) {
  return runInTx(ctx, async (tx) => {
    const user = await tx.user.findUnique({ where: { id }, select: { id: true, isSystem: true, name: true, role: { select: roleSelect } } });
    if (!user || user.isSystem) throw new AppError(404, "User not found.");
    if (missingPermissions(ctx.actor, rolePermissions(user.role)).length) throw new AppError(403, `${user.name} has access you do not have, so you cannot change this account.`);
    await tx.user.update({ where: { id }, data: { totpSecret: null, totpEnabledAt: null, totpLastStep: null, recoveryCodes: [], sessionVersion: { increment: 1 } } });
    await audit(tx, ctx, { action: "user.mfa.reset", entity: "User", entityId: id });
    return { ok: true };
  });
}

/** Requires (or stops requiring) two-factor sign-in for all staff of the pharmacy. */
export async function setStaffTotpRequired(ctx: ServiceContext, required: boolean) {
  return runInTx(ctx, async (tx) => {
    await tx.pharmacySettings.update({ where: { pharmacyId: ctx.pharmacyId }, data: { requireStaffTotp: required } });
    await audit(tx, ctx, { action: "settings.update", entity: "Pharmacy", entityId: ctx.pharmacyId, after: { requireStaffTotp: required } });
    return { requireStaffTotp: required };
  });
}
