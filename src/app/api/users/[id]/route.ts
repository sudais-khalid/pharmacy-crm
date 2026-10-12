import { route, readJson } from "@/lib/api";
import { userUpdateSchema, updateUser } from "@/modules/identity";

export const PUT = route("users.manage", async ({ req, params, svc }) => updateUser(svc, params.id, userUpdateSchema.parse(await readJson(req))));

export const dynamic = "force-dynamic";
