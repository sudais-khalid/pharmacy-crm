import bcrypt from "bcryptjs";
import { createHash, randomBytes } from "node:crypto";
import { platformDb } from "@/lib/platform-db";
import { AppError } from "@/lib/errors";
import { audit } from "@/modules/platform";

/**
 * Invite and password reset links for staff accounts (docs/plan/02-architecture.md, section 5.6).
 * A link carries 256 random bits; only its SHA-256 is stored. Links are single use, expire, and issuing a
 * new link for the same account and purpose revokes the older ones. Redemption happens before sign-in,
 * so this module works with the platform client.
 */
export type TokenPurpose = "INVITE" | "RESET";
const LIFETIME_MS: Record<TokenPurpose, number> = { INVITE: 72 * 3600 * 1000, RESET: 3600 * 1000 };
const BCRYPT_COST = 10;

const hashToken = (token: string) => createHash("sha256").update(token).digest("hex");

export type Issuer = { realm: "PLATFORM" | "STAFF"; id: string; meta?: { ip?: string | null; userAgent?: string | null } };

/** Creates a link for a staff account. Returns the raw token once; the caller builds and shows the URL. */
export async function issueStaffToken(userId: string, purpose: TokenPurpose, by: Issuer) {
  const user = await platformDb.user.findUnique({ where: { id: userId }, select: { id: true, pharmacyId: true, isSystem: true } });
  if (!user || user.isSystem) throw new AppError(404, "User not found.");
  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + LIFETIME_MS[purpose]);
  await platformDb.$transaction(async (tx) => {
    await tx.authToken.updateMany({ where: { subjectId: userId, purpose, usedAt: null, revokedAt: null }, data: { revokedAt: new Date() } });
    await tx.authToken.create({
      data: { realm: "STAFF", subjectId: userId, pharmacyId: user.pharmacyId, purpose, tokenHash: hashToken(token), expiresAt, createdByRealm: by.realm, createdById: by.id },
    });
    await audit(tx, { actor: { id: by.id }, meta: by.meta, realm: by.realm }, {
      action: purpose === "INVITE" ? "user.invite.issue" : "user.reset.issue", entity: "User", entityId: userId, after: { expiresAt }, pharmacyId: user.pharmacyId,
    });
  });
  return { token, expiresAt, path: `/${purpose === "INVITE" ? "invite" : "reset"}/${token}` };
}

async function findValid(token: string) {
  const row = await platformDb.authToken.findUnique({ where: { tokenHash: hashToken(token) } });
  if (!row || row.realm !== "STAFF") return { row: null, problem: "This link is not valid." };
  if (row.usedAt) return { row: null, problem: "This link has already been used." };
  if (row.revokedAt) return { row: null, problem: "This link was replaced by a newer one." };
  if (row.expiresAt.getTime() < Date.now()) return { row: null, problem: "This link has expired. Ask for a new one." };
  return { row, problem: null };
}

/** What the link page shows before the password is chosen. Never reveals anything for invalid links. */
export async function inspectStaffToken(token: string) {
  const { row, problem } = await findValid(token);
  if (!row) return { valid: false as const, problem };
  const user = await platformDb.user.findUnique({ where: { id: row.subjectId }, select: { name: true, username: true, active: true, pharmacy: { select: { name: true, slug: true, status: true } } } });
  if (!user || !user.active || ["SUSPENDED", "DEACTIVATED"].includes(user.pharmacy.status)) return { valid: false as const, problem: "This account cannot be activated right now. Contact your administrator." };
  return { valid: true as const, purpose: row.purpose, name: user.name, username: user.username, pharmacy: { name: user.pharmacy.name, slug: user.pharmacy.slug }, expiresAt: row.expiresAt };
}

/** A temporary password people can type: 16 letters and digits without look-alikes, in groups of four. */
export function temporaryPassword() {
  const alphabet = "abcdefghjkmnpqrstuvwxyz23456789";
  const raw = Array.from(randomBytes(16), (b) => alphabet[b % alphabet.length]).join("");
  return raw.match(/.{4}/g)!.join("-");
}

export function checkNewPassword(password: string, username?: string) {
  if (password.length < 10) throw new AppError(400, "Use at least 10 characters.", { fields: { password: "Use at least 10 characters." } });
  if (password.length > 100) throw new AppError(400, "Use at most 100 characters.");
  if (username && password.toLowerCase().includes(username.toLowerCase())) throw new AppError(400, "The password must not contain the username.");
}

/** Sets the password from a link, marks the link used and ends every existing session of the account. */
export async function redeemStaffToken(token: string, password: string, meta: Issuer["meta"] = {}) {
  const info = await inspectStaffToken(token);
  if (!info.valid) throw new AppError(400, info.problem ?? "This link is not valid.");
  checkNewPassword(password, info.username);
  const passwordHash = await bcrypt.hash(password, BCRYPT_COST);
  const tokenHash = hashToken(token);
  return platformDb.$transaction(async (tx) => {
    // claim the token atomically so two submissions cannot both succeed
    const claimed = await tx.authToken.updateMany({ where: { tokenHash, usedAt: null, revokedAt: null, expiresAt: { gt: new Date() } }, data: { usedAt: new Date() } });
    if (claimed.count !== 1) throw new AppError(400, "This link has already been used.");
    const row = await tx.authToken.findUniqueOrThrow({ where: { tokenHash } });
    const user = await tx.user.update({
      where: { id: row.subjectId },
      data: { passwordHash, mustChangePassword: false, sessionVersion: { increment: 1 } },
      select: { id: true, pharmacyId: true },
    });
    await audit(tx, { actor: { id: user.id }, meta }, { action: row.purpose === "INVITE" ? "user.invite.accept" : "user.reset.complete", entity: "User", entityId: user.id, pharmacyId: user.pharmacyId });
    return { pharmacySlug: info.pharmacy.slug, username: info.username };
  });
}

/** Signed-in staff changing their own password (required after a temporary password). */
export async function changeOwnPassword(userId: string, current: string, next: string, meta: Issuer["meta"] = {}) {
  const user = await platformDb.user.findUnique({ where: { id: userId } });
  if (!user || !(await bcrypt.compare(current, user.passwordHash))) throw new AppError(400, "The current password is not correct.", { fields: { currentPassword: "Not correct" } });
  if (current === next) throw new AppError(400, "Choose a password different from the current one.");
  checkNewPassword(next, user.username);
  const updated = await platformDb.user.update({
    where: { id: userId },
    data: { passwordHash: await bcrypt.hash(next, BCRYPT_COST), mustChangePassword: false, sessionVersion: { increment: 1 } },
    select: { id: true, pharmacyId: true, sessionVersion: true },
  });
  await audit(platformDb, { actor: { id: userId }, meta }, { action: "user.password.change", entity: "User", entityId: userId, pharmacyId: updated.pharmacyId });
  return updated;
}
