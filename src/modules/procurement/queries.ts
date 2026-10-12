import { Prisma } from "@prisma/client";
import { prisma, type Tx } from "@/lib/prisma";
import { ZERO } from "@/lib/money";

type Db = Tx | typeof prisma;

/** Amount we currently owe the supplier (debit - credit). */
export async function supplierBalance(db: Db, supplierId: string): Promise<Prisma.Decimal> {
  const r = await db.supplierLedger.aggregate({ where: { supplierId }, _sum: { debit: true, credit: true } });
  return (r._sum.debit ?? ZERO).minus(r._sum.credit ?? ZERO);
}
