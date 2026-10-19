import type { PrismaClient } from "@prisma/client";
import { z } from "zod";
import { runInTx } from "@/lib/db";
import { AppError } from "@/lib/errors";
import type { Tx } from "@/lib/prisma";
import { audit } from "@/modules/platform";
import type { ServiceContext } from "./context";
import {
  ALL_PERMISSIONS, LANDING_PATHS, PERMISSION_CATALOG, PERMISSION_GROUPS, SYSTEM_ROLES, SYSTEM_ROLE_KEYS,
  isPermission, missingPermissions, rolePermissions, type Permission, type PermissionHolder,
} from "./permissions";

/**
 * Roles (docs/plan/02-architecture.md, section 5.5): the three templates plus custom roles per pharmacy.
 * No escalation: a role can only be given permissions the person editing it holds, and only a role whose
 * permissions they all hold can be assigned by them.
 */

export type SessionRole = { id: string; key: string; name: string; system: boolean; landingPath: string };

/** The role columns a session needs. */
export const roleSelect = { id: true, key: true, name: true, system: true, permissions: true, landingPath: true } as const;
type RoleRow = { id: string; key: string; name: string; system: boolean; permissions: string[]; landingPath: string };

export function sessionRole(role: RoleRow): { role: SessionRole; permissions: Permission[] } {
  const { permissions: _stored, ...rest } = role;
  return { role: rest, permissions: rolePermissions(role) };
}

/** Writes the templates as defined in code (startup, tests). Their rows exist for the foreign keys. */
export async function ensureSystemRoles(db: PrismaClient | Tx) {
  for (const key of SYSTEM_ROLE_KEYS) {
    const r = SYSTEM_ROLES[key];
    const data = { key, name: r.name, description: r.description, system: true, permissions: [...r.permissions], landingPath: r.landingPath };
    await db.role.upsert({ where: { id: r.id }, create: { id: r.id, pharmacyId: null, ...data }, update: data });
  }
}

export const roleInputSchema = z.object({
  name: z.string().trim().min(2, "Give the role a name").max(60),
  description: z.string().trim().max(200).optional().or(z.literal("").transform(() => undefined)),
  permissions: z.array(z.string()).max(ALL_PERMISSIONS.length).transform((list, c) => {
    const unknown = list.filter((p) => !isPermission(p));
    if (unknown.length) c.addIssue({ code: "custom", message: `Unknown permissions: ${unknown.join(", ")}` });
    return [...new Set(list.filter(isPermission))];
  }),
  landingPath: z.string().max(60),
});
export type RoleInput = z.infer<typeof roleInputSchema>;

const slug = (name: string) => name.toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40) || "role";

function checkGrant(actor: PermissionHolder, permissions: readonly string[], verb: string) {
  const missing = missingPermissions(actor, permissions);
  if (missing.length) {
    const labels = missing.map((m) => PERMISSION_CATALOG.find((p) => p.key === m)?.label ?? m);
    throw new AppError(403, `You can only ${verb} permissions you have yourself. Missing: ${labels.join("; ")}.`, { fields: { permissions: "Includes permissions you do not have" } });
  }
}

function checkLanding(input: RoleInput) {
  const landing = LANDING_PATHS.find((l) => l.path === input.landingPath);
  if (!landing) throw new AppError(400, "Choose a first screen from the list.", { fields: { landingPath: "Unknown screen" } });
  if (!input.permissions.includes(landing.permission)) {
    throw new AppError(400, `This role cannot open ${landing.label}, so it cannot be its first screen.`, { fields: { landingPath: "Not allowed for this role" } });
  }
}

/** Templates and this pharmacy's custom roles, with how many active staff hold each. */
export async function listRoles(ctx: ServiceContext) {
  return runInTx(ctx, async (tx) => {
    const rows = await tx.role.findMany({
      where: { OR: [{ pharmacyId: null }, { pharmacyId: ctx.pharmacyId }] },
      orderBy: [{ system: "desc" }, { name: "asc" }],
      select: { ...roleSelect, description: true, _count: { select: { users: { where: { active: true, isSystem: false } } } } },
    });
    const order = (r: { key: string; system: boolean }) => (r.system ? SYSTEM_ROLE_KEYS.indexOf(r.key as never) : 99);
    return rows
      .sort((a, b) => order(a) - order(b))
      .map(({ _count, ...r }) => ({ ...r, permissions: rolePermissions(r), users: _count.users, assignable: missingPermissions(ctx.actor, rolePermissions(r)).length === 0 }));
  });
}

/** What the role editor needs besides the roles: the catalog, its groups and the possible first screens. */
export function roleCatalog() {
  return { groups: PERMISSION_GROUPS, permissions: PERMISSION_CATALOG, landingPaths: LANDING_PATHS };
}

export async function createRole(ctx: ServiceContext, input: RoleInput) {
  checkGrant(ctx.actor, input.permissions, "give");
  checkLanding(input);
  return runInTx(ctx, async (tx) => {
    const base = `custom-${slug(input.name)}`;
    let key = base;
    for (let i = 2; await tx.role.findFirst({ where: { pharmacyId: ctx.pharmacyId, key }, select: { id: true } }); i++) key = `${base}-${i}`;
    const role = await tx.role.create({ data: { key, name: input.name, description: input.description ?? null, permissions: input.permissions, landingPath: input.landingPath } });
    await audit(tx, ctx, { action: "role.create", entity: "Role", entityId: role.id, after: { name: role.name, permissions: role.permissions, landingPath: role.landingPath } });
    return role;
  });
}

/** A copy of a template or custom role, to edit (the templates themselves are read-only). */
export async function duplicateRole(ctx: ServiceContext, id: string) {
  const source = await runInTx(ctx, (tx) => tx.role.findUnique({ where: { id }, select: { ...roleSelect, description: true } }));
  if (!source) throw new AppError(404, "Role not found.");
  return createRole(ctx, { name: `${source.name} (copy)`.slice(0, 60), description: source.description ?? undefined, permissions: rolePermissions(source), landingPath: source.landingPath });
}

/** Edits a custom role. Its staff get the new permissions on their next request. */
export async function updateRole(ctx: ServiceContext, id: string, input: RoleInput) {
  return runInTx(ctx, async (tx) => {
    const before = await tx.role.findUnique({ where: { id } });
    if (!before) throw new AppError(404, "Role not found.");
    if (before.system || before.pharmacyId === null) throw new AppError(409, "The standard roles cannot be changed. Duplicate one to make your own.");
    checkLanding(input);
    // only what is added needs to be held; removing is always possible
    checkGrant(ctx.actor, input.permissions.filter((p) => !before.permissions.includes(p)), "give");
    const after = await tx.role.update({ where: { id }, data: { name: input.name, description: input.description ?? null, permissions: input.permissions, landingPath: input.landingPath } });
    await audit(tx, ctx, {
      action: "role.update", entity: "Role", entityId: id,
      before: { name: before.name, permissions: before.permissions, landingPath: before.landingPath },
      after: { name: after.name, permissions: after.permissions, landingPath: after.landingPath },
    });
    return after;
  });
}

export async function deleteRole(ctx: ServiceContext, id: string) {
  return runInTx(ctx, async (tx) => {
    const role = await tx.role.findUnique({ where: { id }, select: { id: true, name: true, system: true, pharmacyId: true, _count: { select: { users: true } } } });
    if (!role) throw new AppError(404, "Role not found.");
    if (role.system || role.pharmacyId === null) throw new AppError(409, "The standard roles cannot be deleted.");
    if (role._count.users > 0) throw new AppError(409, `${role._count.users} staff account(s) still have this role. Give them another role first.`);
    await tx.role.delete({ where: { id } });
    await audit(tx, ctx, { action: "role.delete", entity: "Role", entityId: id, before: { name: role.name } });
    return { ok: true };
  });
}
