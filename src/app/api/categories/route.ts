import { route, readJson } from "@/lib/api";
import { prisma } from "@/lib/prisma";
import { categorySchema } from "@/lib/schemas";

export const GET = route("medicines.view", async () => prisma.category.findMany({ orderBy: { name: "asc" } }));

export const POST = route("medicines.manage", async ({ req }) => {
  const { name } = categorySchema.parse(await readJson(req));
  return prisma.category.create({ data: { name } });
});

export const dynamic = "force-dynamic";
