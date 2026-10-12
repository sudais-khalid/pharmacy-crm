import { route, readJson, AppError } from "@/lib/api";
import { prisma } from "@/lib/prisma";
import { customerSchema } from "@/modules/customers";
import { D, ZERO } from "@/lib/money";

export const GET = route("customers.view", async ({ params }) => {
  const customer = await prisma.customer.findUnique({ where: { id: params.id } });
  if (!customer) throw new AppError(404, "Customer not found.");
  const [ledger, sales, purchased, paid] = await Promise.all([
    prisma.customerLedger.findMany({ where: { customerId: customer.id }, orderBy: { createdAt: "asc" } }),
    prisma.sale.findMany({ where: { customerId: customer.id }, orderBy: { createdAt: "desc" }, take: 100, include: { _count: { select: { items: true } } } }),
    prisma.sale.aggregate({ where: { customerId: customer.id, status: "COMPLETED" }, _sum: { total: true } }),
    prisma.customerLedger.aggregate({ where: { customerId: customer.id, kind: "PAYMENT" }, _sum: { credit: true } }),
  ]);
  let running = ZERO;
  const ledgerRows = ledger.map((l) => {
    running = running.plus(l.debit).minus(l.credit);
    return { ...l, balance: running };
  });
  return {
    customer,
    balance: running,
    totalPurchases: D(purchased._sum.total ?? 0),
    totalPayments: D(paid._sum.credit ?? 0),
    ledger: ledgerRows,
    sales,
  };
});

export const PUT = route("customers.manage", async ({ req, params }) =>
  prisma.customer.update({ where: { id: params.id }, data: customerSchema.parse(await readJson(req)) }),
);

export const dynamic = "force-dynamic";
