import { route, readJson } from "@/lib/api";
import { deleteRole, roleInputSchema, updateRole } from "@/modules/identity";

export const PUT = route("roles.manage", async ({ req, params, svc }) => updateRole(svc, params.id, roleInputSchema.parse(await readJson(req))));

export const DELETE = route("roles.manage", async ({ params, svc }) => deleteRole(svc, params.id));

export const dynamic = "force-dynamic";
