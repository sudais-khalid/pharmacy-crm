import { route, readJson } from "@/lib/api";
import { expenseCategorySchema, listCategories, saveCategory } from "@/modules/finance";
import { requireExpenses } from "../_feature";

export const GET = route("finance.view", async ({ svc, db, user }) => {
  await requireExpenses(db, user.pharmacyId);
  return { items: await listCategories(svc) };
});

export const POST = route("expenses.manage", async ({ req, svc, db, user }) => {
  await requireExpenses(db, user.pharmacyId);
  return saveCategory(svc, expenseCategorySchema.parse(await readJson(req)));
});

export const dynamic = "force-dynamic";
