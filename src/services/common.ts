import { Prisma } from "@prisma/client";
import { prisma, type Tx } from "@/lib/prisma";

export const D = (v: Prisma.Decimal.Value) => new Prisma.Decimal(v);
export const ZERO = new Prisma.Decimal(0);

type Db = Tx | typeof prisma;

/** Amount the customer currently owes (debit - credit). */
export async function customerBalance(db: Db, customerId: string): Promise<Prisma.Decimal> {
  const r = await db.customerLedger.aggregate({ where: { customerId }, _sum: { debit: true, credit: true } });
  return (r._sum.debit ?? ZERO).minus(r._sum.credit ?? ZERO);
}

/** Amount we currently owe the supplier (debit - credit). */
export async function supplierBalance(db: Db, supplierId: string): Promise<Prisma.Decimal> {
  const r = await db.supplierLedger.aggregate({ where: { supplierId }, _sum: { debit: true, credit: true } });
  return (r._sum.debit ?? ZERO).minus(r._sum.credit ?? ZERO);
}
