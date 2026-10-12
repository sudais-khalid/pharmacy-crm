import bcrypt from "bcryptjs";
import { runInTx } from "@/lib/db";
import { AppError } from "@/lib/errors";
import { audit } from "@/modules/platform";
import type { ServiceContext } from "./context";
import type { Role } from "./permissions";

const BCRYPT_COST = 10;
const publicFields = { id: true, name: true, email: true, role: true, active: true, createdAt: true } as const;

export type UserCreateInput = { name: string; email: string; password: string; role: Role; username?: string };

/** Login name from an email's local part: lower case letters, digits, dot, dash and underscore. */
export function usernameFromEmail(email: string) {
  return email.split("@")[0].toLowerCase().replace(/[^a-z0-9._-]/g, "") || "user";
}
export type UserUpdateInput = { name?: string; role?: Role; active?: boolean; password?: string };

export async function createUser(ctx: ServiceContext, input: UserCreateInput) {
  const { password, username, ...data } = input;
  const passwordHash = await bcrypt.hash(password, BCRYPT_COST);
  return runInTx(ctx, async (tx) => {
    const user = await tx.user.create({ data: { ...data, username: username ?? usernameFromEmail(data.email), passwordHash }, select: publicFields });
    await audit(tx, ctx, { action: "user.create", entity: "User", entityId: user.id, after: { name: user.name, email: user.email, role: user.role } });
    return user;
  });
}

/** Updates a user. Passwords never reach the audit log, only the fact that one changed. */
export async function updateUser(ctx: ServiceContext, id: string, input: UserUpdateInput) {
  const { password, ...data } = input;
  if (id === ctx.actor.id && (data.active === false || (data.role && data.role !== "ADMIN"))) {
    throw new AppError(409, "You cannot deactivate or demote your own account.");
  }
  const passwordHash = password ? await bcrypt.hash(password, BCRYPT_COST) : undefined;
  return runInTx(ctx, async (tx) => {
    const before = await tx.user.findUnique({ where: { id }, select: publicFields });
    if (!before) throw new AppError(404, "User not found.");
    const after = await tx.user.update({ where: { id }, data: { ...data, ...(passwordHash ? { passwordHash } : {}) }, select: publicFields });

    const keys = (["name", "role", "active"] as const).filter((k) => before[k] !== after[k]);
    const action = before.active && !after.active ? "user.deactivate" : passwordHash && !keys.length ? "user.password.reset" : "user.update";
    await audit(tx, ctx, {
      action, entity: "User", entityId: id,
      before: Object.fromEntries(keys.map((k) => [k, before[k]])),
      after: { ...Object.fromEntries(keys.map((k) => [k, after[k]])), ...(passwordHash ? { passwordChanged: true } : {}) },
    });
    return { id: after.id, name: after.name, email: after.email, role: after.role, active: after.active };
  });
}
