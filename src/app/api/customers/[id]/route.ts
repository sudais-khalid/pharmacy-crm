import { route, readJson, AppError } from "@/lib/api";
import { customerSchema } from "@/modules/customers";
import { D, ZERO } from "@/lib/money";

export const GET = route("customers.view", async ({ params, db }) => {
  const customer = await db.customer.findUnique({ where: { id: params.id } });
  if (!customer) throw new AppError(404, "Customer not found.");
  const [ledger, sales, returns, purchased, paid] = await Promise.all([
    db.customerLedger.findMany({ where: { customerId: customer.id }, orderBy: { createdAt: "asc" } }),
    db.sale.findMany({ where: { customerId: customer.id }, orderBy: { createdAt: "desc" }, take: 100, include: { _count: { select: { items: true } } } }),
    db.saleReturn.findMany({ where: { sale: { customerId: customer.id } }, orderBy: { createdAt: "desc" }, take: 100, include: { sale: { select: { invoiceNo: true } }, _count: { select: { items: true } } } }),
    db.sale.aggregate({ where: { customerId: customer.id, status: "COMPLETED" }, _sum: { total: true } }),
    db.customerLedger.aggregate({ where: { customerId: customer.id, kind: "PAYMENT" }, _sum: { credit: true } }),
  ]);
  let running = ZERO;
  const ledgerRows = ledger.map((l) => {
    running = running.plus(l.debit).minus(l.credit);
    return { ...l, balance: running };
  });
  // one story, newest first: purchases (and cancellations), returns and payments
  const timeline = [
    ...sales.map((x) => ({ at: x.createdAt, kind: "SALE" as const, title: `Bought ${x._count.items} item${x._count.items === 1 ? "" : "s"} on ${x.invoiceNo}`, amount: x.total, link: `/invoice/${x.id}`, cancelled: x.status === "CANCELLED" })),
    ...sales.filter((x) => x.cancelledAt).map((x) => ({ at: x.cancelledAt!, kind: "CANCEL" as const, title: `${x.invoiceNo} cancelled${x.cancelReason ? `: ${x.cancelReason}` : ""}`, amount: x.total, link: `/invoice/${x.id}`, cancelled: false })),
    ...returns.map((r) => ({ at: r.createdAt, kind: "RETURN" as const, title: `Returned ${r._count.items} item${r._count.items === 1 ? "" : "s"} from ${r.sale.invoiceNo} (${r.refundMethod === "CREDIT" ? "credit note" : `${r.refundMethod.toLowerCase()} refund`})`, amount: r.total, link: `/invoice/returns/${r.id}`, cancelled: false })),
    ...ledger.filter((l) => l.kind === "PAYMENT" && !l.saleId).map((l) => ({ at: l.createdAt, kind: "PAYMENT" as const, title: l.description, amount: l.credit, link: null, cancelled: false })),
  ].sort((a, b) => b.at.getTime() - a.at.getTime());
  return {
    customer,
    timeline,
    balance: running,
    totalPurchases: D(purchased._sum.total ?? 0),
    totalPayments: D(paid._sum.credit ?? 0),
    ledger: ledgerRows,
    sales,
  };
});

export const PUT = route("customers.manage", async ({ req, params, db }) =>
  db.customer.update({ where: { id: params.id }, data: customerSchema.parse(await readJson(req)) }),
);

export const dynamic = "force-dynamic";
