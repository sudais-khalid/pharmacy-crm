import { route, readJson } from "@/lib/api";
import { createUser, listStaff, userCreateSchema } from "@/modules/identity";

export const GET = route("users.manage", async ({ svc }) => listStaff(svc));

/** Returns the account and, once, its invite link or temporary password. */
export const POST = route("users.manage", async ({ req, svc }) => createUser(svc, userCreateSchema.parse(await readJson(req))));

export const dynamic = "force-dynamic";
