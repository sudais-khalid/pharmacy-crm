import { route, readJson } from "@/lib/api";
import { expenseCategorySchema, saveCategory } from "@/modules/finance";
import { requireExpenses } from "../../_feature";

export const PUT = route("expenses.manage", async ({ req, params, svc, db, user }) => {
  await requireExpenses(db, user.pharmacyId);
  return saveCategory(svc, { id: params.id, ...expenseCategorySchema.parse(await readJson(req)) });
});

export const dynamic = "force-dynamic";
