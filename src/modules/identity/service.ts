import bcrypt from "bcryptjs";
import { runInTx } from "@/lib/db";
import { AppError } from "@/lib/errors";
import type { Tx } from "@/lib/prisma";
import { audit } from "@/modules/platform";
import type { ServiceContext } from "./context";
import { ADMIN_ROLE_ID, missingPermissions, rolePermissions } from "./permissions";
import { roleSelect } from "./roles";
import { issueStaffToken, temporaryPassword } from "./tokens";

/**
 * Staff accounts of one pharmacy, managed by people with users.manage (docs/plan/05-roadmap.md, task 3.3).
 * Two rules keep this safe: nobody can manage an account, or give a role, with more access than they have
 * themselves, and every pharmacy keeps at least one active Pharmacy Admin (also enforced by a trigger).
 */
const BCRYPT_COST = 10;
export const staffSelect = {
  id: true, name: true, username: true, email: true, active: true, mustChangePassword: true, lastLoginAt: true, createdAt: true,
  role: { select: { id: true, key: true, name: true, system: true } },
} as const;

export type UserCreateInput = { name: string; email: string; username?: string; roleId: string; credentials: "invite" | "password" };
export type UserUpdateInput = { name?: string; roleId?: string; active?: boolean };

/** Login name from an email's local part: lower case letters, digits, dot, dash and underscore. */
export function usernameFromEmail(email: string) {
  return email.split("@")[0].toLowerCase().replace(/[^a-z0-9._-]/g, "") || "user";
}

const LAST_ADMIN = "A pharmacy needs at least one active Pharmacy Admin. Make someone else Pharmacy Admin first.";

/** A role this actor may give: in their pharmacy (or a template) and with no permission they lack. */
async function assignableRole(ctx: ServiceContext, tx: Tx, roleId: string) {
  const role = await tx.role.findUnique({ where: { id: roleId }, select: roleSelect });
  if (!role) throw new AppError(400, "Choose a role.", { fields: { roleId: "Unknown role" } });
  if (missingPermissions(ctx.actor, rolePermissions(role)).length) {
    throw new AppError(403, `You cannot give the ${role.name} role: it has permissions you do not have.`, { fields: { roleId: "More access than yours" } });
  }
  return role;
}

/** The account, if this actor may manage it (not a system account, not more access than theirs). */
async function manageable(ctx: ServiceContext, tx: Tx, id: string) {
  const user = await tx.user.findUnique({ where: { id }, select: { ...staffSelect, isSystem: true, role: { select: roleSelect } } });
  if (!user || user.isSystem) throw new AppError(404, "User not found.");
  if (missingPermissions(ctx.actor, rolePermissions(user.role)).length) {
    throw new AppError(403, `${user.name} has access you do not have, so you cannot change this account.`);
  }
  return user;
}

async function checkSeat(tx: Tx, pharmacyId: string) {
  const pharmacy = await tx.pharmacy.findUniqueOrThrow({ where: { id: pharmacyId }, select: { maxUsers: true } });
  if ((await tx.user.count({ where: { active: true, isSystem: false } })) >= pharmacy.maxUsers) {
    throw new AppError(409, `This pharmacy's plan allows ${pharmacy.maxUsers} active staff accounts. Deactivate one or ask your software provider for more.`);
  }
}

/** Stops a change that would leave no active Pharmacy Admin; the database trigger is the last line. */
async function keepOneAdmin(tx: Tx, user: { id: string; active: boolean; role: { id: string } }, after: { active: boolean; roleId: string }) {
  const wasAdmin = user.active && user.role.id === ADMIN_ROLE_ID;
  const staysAdmin = after.active && after.roleId === ADMIN_ROLE_ID;
  if (!wasAdmin || staysAdmin) return;
  const others = await tx.user.count({ where: { id: { not: user.id }, active: true, isSystem: false, roleId: ADMIN_ROLE_ID } });
  if (others === 0) throw new AppError(409, LAST_ADMIN);
}

/** Maps the trigger's error, in case two changes raced past the check above. */
function lastAdminError(e: unknown): never {
  if (e instanceof Error && e.message.includes("at least one active Pharmacy Admin")) throw new AppError(409, LAST_ADMIN);
  throw e;
}

export async function listStaff(ctx: ServiceContext) {
  return runInTx(ctx, async (tx) => {
    const [users, pharmacy] = await Promise.all([
      tx.user.findMany({ where: { isSystem: false }, orderBy: [{ active: "desc" }, { name: "asc" }], select: { ...staffSelect, role: { select: roleSelect } } }),
      tx.pharmacy.findUniqueOrThrow({ where: { id: ctx.pharmacyId }, select: { maxUsers: true } }),
    ]);
    return {
      seats: { used: users.filter((u) => u.active).length, max: pharmacy.maxUsers },
      items: users.map(({ role, ...u }) => ({
        ...u,
        role: { id: role.id, key: role.key, name: role.name, system: role.system },
        // whether this actor may change the account (no more access than theirs, not themselves)
        manageable: u.id !== ctx.actor.id && missingPermissions(ctx.actor, rolePermissions(role)).length === 0,
      })),
    };
  });
}

/** Creates the account and returns how it gets its first password: a link, or a temporary password shown once. */
export async function createUser(ctx: ServiceContext, input: UserCreateInput) {
  const password = input.credentials === "password" ? temporaryPassword() : null;
  // an invite account has no usable password until the link is redeemed
  const passwordHash = await bcrypt.hash(password ?? temporaryPassword() + temporaryPassword(), BCRYPT_COST);
  const user = await runInTx(ctx, async (tx) => {
    await checkSeat(tx, ctx.pharmacyId);
    const role = await assignableRole(ctx, tx, input.roleId);
    const username = input.username ?? usernameFromEmail(input.email);
    const taken = await tx.user.findFirst({ where: { OR: [{ username }, { email: input.email }] }, select: { username: true } });
    if (taken) {
      throw new AppError(409, taken.username === username ? "This username is already in use." : "This email is already in use.", { fields: taken.username === username ? { username: "Already in use" } : { email: "Already in use" } });
    }
    const created = await tx.user.create({
      data: { name: input.name, email: input.email, username, roleId: role.id, passwordHash, mustChangePassword: !!password },
      select: staffSelect,
    });
    await audit(tx, ctx, { action: "user.create", entity: "User", entityId: created.id, after: { name: created.name, username, role: role.name, credentials: input.credentials } });
    return created;
  });
  if (password) return { user, credentials: { kind: "password" as const, password } };
  const link = await issueStaffToken(user.id, "INVITE", { realm: ctx.realm ?? "STAFF", id: ctx.auditActorId ?? ctx.actor.id, meta: ctx.meta });
  return { user, credentials: { kind: "invite" as const, path: link.path, expiresAt: link.expiresAt } };
}

/** Name, role or active state. A role change or deactivation ends every session of the account. */
export async function updateUser(ctx: ServiceContext, id: string, input: UserUpdateInput) {
  if (id === ctx.actor.id && (input.active === false || input.roleId !== undefined)) {
    throw new AppError(409, "You cannot change your own role or deactivate your own account.");
  }
  return runInTx(ctx, async (tx) => {
    const before = await manageable(ctx, tx, id);
    const role = input.roleId && input.roleId !== before.role.id ? await assignableRole(ctx, tx, input.roleId) : before.role;
    const active = input.active ?? before.active;
    if (active && !before.active) await checkSeat(tx, ctx.pharmacyId);
    await keepOneAdmin(tx, before, { active, roleId: role.id });
    const revoke = role.id !== before.role.id || (!active && before.active);
    const after = await tx.user
      .update({ where: { id }, data: { name: input.name ?? before.name, roleId: role.id, active, ...(revoke ? { sessionVersion: { increment: 1 } } : {}) }, select: staffSelect })
      .catch(lastAdminError);
    const changed: Record<string, [unknown, unknown]> = {};
    if (after.name !== before.name) changed.name = [before.name, after.name];
    if (after.role.id !== before.role.id) changed.role = [before.role.name, after.role.name];
    if (after.active !== before.active) changed.active = [before.active, after.active];
    const action = before.active && !after.active ? "user.deactivate" : !before.active && after.active ? "user.activate" : changed.role ? "user.role.change" : "user.update";
    await audit(tx, ctx, {
      action, entity: "User", entityId: id,
      before: Object.fromEntries(Object.entries(changed).map(([k, v]) => [k, v[0]])),
      after: Object.fromEntries(Object.entries(changed).map(([k, v]) => [k, v[1]])),
    });
    return after;
  });
}

/** Ends every session of a staff account on its next request. */
export async function forceLogout(ctx: ServiceContext, id: string) {
  return runInTx(ctx, async (tx) => {
    await manageable(ctx, tx, id);
    await tx.user.update({ where: { id }, data: { sessionVersion: { increment: 1 } } });
    await audit(tx, ctx, { action: "user.logout.force", entity: "User", entityId: id });
    return { ok: true };
  });
}

/** A password reset link for a staff member (shown once to the person issuing it). */
export async function issueStaffReset(ctx: ServiceContext, id: string) {
  await runInTx(ctx, (tx) => manageable(ctx, tx, id));
  const link = await issueStaffToken(id, "RESET", { realm: ctx.realm ?? "STAFF", id: ctx.auditActorId ?? ctx.actor.id, meta: ctx.meta });
  return { path: link.path, expiresAt: link.expiresAt };
}

/** A temporary password, changed at the next sign-in; existing sessions end. Shown once. */
export async function setTemporaryPassword(ctx: ServiceContext, id: string) {
  const password = temporaryPassword();
  const passwordHash = await bcrypt.hash(password, BCRYPT_COST);
  return runInTx(ctx, async (tx) => {
    await manageable(ctx, tx, id);
    await tx.user.update({ where: { id }, data: { passwordHash, mustChangePassword: true, sessionVersion: { increment: 1 } } });
    await audit(tx, ctx, { action: "user.password.temporary", entity: "User", entityId: id });
    return { password };
  });
}
