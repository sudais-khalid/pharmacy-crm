import { route, readJson, AppError } from "@/lib/api";
import { prisma } from "@/lib/prisma";
import { supplierSchema } from "@/lib/schemas";
import { D, ZERO } from "@/services/common";

export const GET = route("suppliers.view", async ({ params }) => {
  const supplier = await prisma.supplier.findUnique({ where: { id: params.id } });
  if (!supplier) throw new AppError(404, "Supplier not found.");
  const [ledger, purchases, purchased, paid] = await Promise.all([
    prisma.supplierLedger.findMany({ where: { supplierId: supplier.id }, orderBy: { createdAt: "asc" } }),
    prisma.purchase.findMany({ where: { supplierId: supplier.id }, orderBy: { createdAt: "desc" }, take: 100, include: { _count: { select: { items: true } } } }),
    prisma.purchase.aggregate({ where: { supplierId: supplier.id }, _sum: { total: true } }),
    prisma.supplierLedger.aggregate({ where: { supplierId: supplier.id, kind: "PAYMENT" }, _sum: { credit: true } }),
  ]);
  let running = ZERO;
  const ledgerRows = ledger.map((l) => {
    running = running.plus(l.debit).minus(l.credit);
    return { ...l, balance: running };
  });
  return { supplier, balance: running, totalPurchases: D(purchased._sum.total ?? 0), totalPayments: D(paid._sum.credit ?? 0), ledger: ledgerRows, purchases };
});

export const PUT = route("suppliers.manage", async ({ req, params }) =>
  prisma.supplier.update({ where: { id: params.id }, data: supplierSchema.parse(await readJson(req)) }),
);

export const dynamic = "force-dynamic";
