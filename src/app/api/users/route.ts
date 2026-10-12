import { route, readJson } from "@/lib/api";
import { userCreateSchema, createUser } from "@/modules/identity";

const select = { id: true, name: true, email: true, role: true, active: true, createdAt: true } as const;

export const GET = route("users.manage", async ({ db }) => db.user.findMany({ where: { isSystem: false }, orderBy: { createdAt: "asc" }, select: { ...select, username: true } }));

export const POST = route("users.manage", async ({ req, svc }) => createUser(svc, userCreateSchema.parse(await readJson(req))));

export const dynamic = "force-dynamic";
