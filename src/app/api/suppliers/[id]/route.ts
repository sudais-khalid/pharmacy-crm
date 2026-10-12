import { route, readJson, AppError } from "@/lib/api";
import { supplierSchema } from "@/modules/procurement";
import { D, ZERO } from "@/lib/money";

export const GET = route("suppliers.view", async ({ params, db }) => {
  const supplier = await db.supplier.findUnique({ where: { id: params.id } });
  if (!supplier) throw new AppError(404, "Supplier not found.");
  const [ledger, purchases, purchased, paid] = await Promise.all([
    db.supplierLedger.findMany({ where: { supplierId: supplier.id }, orderBy: { createdAt: "asc" } }),
    db.purchase.findMany({ where: { supplierId: supplier.id }, orderBy: { createdAt: "desc" }, take: 100, include: { _count: { select: { items: true } } } }),
    db.purchase.aggregate({ where: { supplierId: supplier.id }, _sum: { total: true } }),
    db.supplierLedger.aggregate({ where: { supplierId: supplier.id, kind: "PAYMENT" }, _sum: { credit: true } }),
  ]);
  let running = ZERO;
  const ledgerRows = ledger.map((l) => {
    running = running.plus(l.debit).minus(l.credit);
    return { ...l, balance: running };
  });
  return { supplier, balance: running, totalPurchases: D(purchased._sum.total ?? 0), totalPayments: D(paid._sum.credit ?? 0), ledger: ledgerRows, purchases };
});

export const PUT = route("suppliers.manage", async ({ req, params, db }) =>
  db.supplier.update({ where: { id: params.id }, data: supplierSchema.parse(await readJson(req)) }),
);

export const dynamic = "force-dynamic";
