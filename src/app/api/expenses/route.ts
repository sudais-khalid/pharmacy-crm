import { route, readJson, AppError } from "@/lib/api";
import { createExpense, expenseSchema, listExpenses } from "@/modules/finance";
import { requireExpenses } from "./_feature";

const MAX_RECEIPT = 8 * 1024 * 1024;

export const GET = route("finance.view", async ({ req, svc, db, user }) => {
  await requireExpenses(db, user.pharmacyId);
  const sp = req.nextUrl.searchParams;
  return listExpenses(svc, { from: sp.get("from") || undefined, to: sp.get("to") || undefined, categoryId: sp.get("categoryId") || undefined, includeCancelled: sp.get("cancelled") === "1", page: Number(sp.get("page")) || 1 });
});

/** Records an expense: JSON, or a form with an optional "receipt" photo. */
export const POST = route("expenses.manage", async ({ req, svc, db, user }) => {
  await requireExpenses(db, user.pharmacyId);
  if ((req.headers.get("content-type") ?? "").startsWith("multipart/form-data")) {
    const form = await req.formData();
    const file = form.get("receipt");
    const receipt = file && typeof file !== "string" && file.size ? Buffer.from(await file.arrayBuffer()) : null;
    if (receipt && receipt.length > MAX_RECEIPT) throw new AppError(413, "The receipt photo is larger than 8 MB.");
    const fields = Object.fromEntries([...form.entries()].filter(([k, v]) => k !== "receipt" && typeof v === "string"));
    return createExpense(svc, expenseSchema.parse(fields), receipt);
  }
  return createExpense(svc, expenseSchema.parse(await readJson(req)));
}, { idempotent: true });

export const dynamic = "force-dynamic";
