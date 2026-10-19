import { z } from "zod";
import { route, readJson } from "@/lib/api";
import { AppError } from "@/lib/errors";
import { can, createRole, duplicateRole, listRoles, roleCatalog, roleInputSchema } from "@/modules/identity";

/** Roles with the permission catalog. Staff managers read them too, to choose a role for an account. */
export const GET = route(null, async ({ user, svc }) => {
  if (!can(user, "roles.manage") && !can(user, "users.manage")) throw new AppError(403, "You do not have permission to do this.");
  return { roles: await listRoles(svc), ...roleCatalog() };
});

const copySchema = z.object({ copyFrom: z.string().uuid() });

/** A new custom role, or a copy of an existing one ({ copyFrom }). */
export const POST = route("roles.manage", async ({ req, svc }) => {
  const body = await readJson(req);
  const copy = copySchema.safeParse(body);
  return copy.success ? duplicateRole(svc, copy.data.copyFrom) : createRole(svc, roleInputSchema.parse(body));
});

export const dynamic = "force-dynamic";
