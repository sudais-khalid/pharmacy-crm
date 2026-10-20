import { z } from "zod";
import { runInTx } from "@/lib/db";
import type { Tx } from "@/lib/prisma";
import { can, type ServiceContext } from "@/modules/identity";
import { audit } from "@/modules/platform";
import { D } from "@/lib/money";
import { AppError } from "@/lib/errors";
import { money, optText } from "@/lib/validation";
import { customerSchema } from "./schema";

/**
 * Customers with what they already owed before the pharmacy started using the app (roadmap 9.9). The
 * amount is one ADJUSTMENT line on the customer's account, so payments settle it like any other balance.
 */
export const customerWithOpeningSchema = customerSchema.extend({ openingBalance: money.default(0) });
export const customerImportSchema = z.object({
  rows: z.array(z.object({ name: z.string().trim().min(1, "Name is required").max(120), phone: optText, creditLimit: money.default(0), openingBalance: money.default(0) })).min(1).max(1000),
});
export type CustomerWithOpening = z.infer<typeof customerWithOpeningSchema>;
export const OPENING_NOTE = "Opening balance (owed before using the app)";

async function create(tx: Tx, ctx: ServiceContext, input: CustomerWithOpening) {
  const { openingBalance, ...data } = input;
  const customer = await tx.customer.create({ data });
  const opening = D(openingBalance).toDecimalPlaces(2);
  // a balance from before the app is a setup figure, not something the counter enters
  if (opening.gt(0) && !can(ctx.actor, "settings.manage")) throw new AppError(403, "Only the Pharmacy Admin can enter an opening balance.");
  if (opening.gt(0)) await tx.customerLedger.create({ data: { customerId: customer.id, kind: "ADJUSTMENT", debit: opening, description: OPENING_NOTE, userId: ctx.actor.id } });
  await audit(tx, ctx, { action: "customer.create", entity: "Customer", entityId: customer.id, after: { name: customer.name, openingBalance: opening } });
  return customer;
}

export async function createCustomer(ctx: ServiceContext, input: CustomerWithOpening) {
  return runInTx(ctx, (tx) => create(tx, ctx, input));
}

/** Many at once (the setup wizard): a row whose name and phone already exist is skipped, not doubled. */
export async function importCustomers(ctx: ServiceContext, rows: z.infer<typeof customerImportSchema>["rows"]) {
  return runInTx(ctx, async (tx) => {
    let created = 0;
    const skipped: string[] = [];
    for (const r of rows) {
      const exists = await tx.customer.findFirst({ where: { name: { equals: r.name, mode: "insensitive" }, phone: r.phone ?? null }, select: { id: true } });
      if (exists) { skipped.push(r.name); continue; }
      await create(tx, ctx, customerWithOpeningSchema.parse(r));
      created++;
    }
    return { created, skipped };
  });
}
