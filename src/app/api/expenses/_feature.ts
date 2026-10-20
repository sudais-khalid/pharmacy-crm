import type { Tx } from "@/lib/prisma";
import { AppError } from "@/lib/api";
import { getFeatureFlags } from "@/modules/platform";

/** Expenses are a feature the Developer can switch off per pharmacy. */
export async function requireExpenses(db: Tx, pharmacyId: string) {
  if (!(await getFeatureFlags(db, pharmacyId)).expenses) throw new AppError(404, "Expenses are switched off for this pharmacy.");
}
