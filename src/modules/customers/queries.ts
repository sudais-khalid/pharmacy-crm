import { Prisma } from "@prisma/client";
import { prisma, type Tx } from "@/lib/prisma";
import { ZERO } from "@/lib/money";

type Db = Tx | typeof prisma;

/** Amount the customer currently owes (debit - credit). */
export async function customerBalance(db: Db, customerId: string): Promise<Prisma.Decimal> {
  const r = await db.customerLedger.aggregate({ where: { customerId }, _sum: { debit: true, credit: true } });
  return (r._sum.debit ?? ZERO).minus(r._sum.credit ?? ZERO);
}
