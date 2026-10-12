import { route, readJson } from "@/lib/api";
import { categorySchema } from "@/modules/catalog";

export const GET = route("medicines.view", async ({ db }) => db.category.findMany({ orderBy: { name: "asc" } }));

export const POST = route("medicines.manage", async ({ req, db }) => {
  const { name } = categorySchema.parse(await readJson(req));
  return db.category.create({ data: { name } });
});

export const dynamic = "force-dynamic";
