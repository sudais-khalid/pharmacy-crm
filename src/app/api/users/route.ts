import bcrypt from "bcryptjs";
import { route, readJson } from "@/lib/api";
import { prisma } from "@/lib/prisma";
import { userCreateSchema } from "@/modules/identity";

const select = { id: true, name: true, email: true, role: true, active: true, createdAt: true } as const;

export const GET = route("users.manage", async () => prisma.user.findMany({ orderBy: { createdAt: "asc" }, select }));

export const POST = route("users.manage", async ({ req }) => {
  const { password, ...data } = userCreateSchema.parse(await readJson(req));
  return prisma.user.create({ data: { ...data, passwordHash: await bcrypt.hash(password, 10) }, select });
});

export const dynamic = "force-dynamic";
