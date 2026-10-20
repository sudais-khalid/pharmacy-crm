import { route, readJson } from "@/lib/api";
import { cancelExpense, cancelExpenseSchema } from "@/modules/finance";
import { requireExpenses } from "../../_feature";

export const POST = route("expenses.manage", async ({ req, params, svc, db, user }) => {
  await requireExpenses(db, user.pharmacyId);
  return cancelExpense(svc, params.id, cancelExpenseSchema.parse(await readJson(req)).reason);
});

export const dynamic = "force-dynamic";
