import { Prisma } from "@prisma/client";
import { route, readJson, pageParams } from "@/lib/api";
import { can } from "@/modules/identity";
import { saleSchema, createSale } from "@/modules/sales";
import { dateOnly, addDays } from "@/lib/dates";

/** Invoices. Without sales.viewAll (a cashier) only the caller's own. `invoice` finds one by its exact number (returns, QR scan). */
export const GET = route("sales.view", async ({ req, db, user }) => {
  const { page, pageSize, skip, take, sp } = pageParams(req);
  const q = sp.get("q")?.trim();
  const invoice = sp.get("invoice")?.trim();
  const status = sp.get("status");
  const from = sp.get("from");
  const to = sp.get("to");
  const where: Prisma.SaleWhereInput = can(user, "sales.viewAll") ? {} : { userId: user.id };
  if (status === "COMPLETED" || status === "CANCELLED") where.status = status;
  if (invoice) where.invoiceNo = { equals: invoice, mode: "insensitive" };
  if (q) {
    where.OR = [
      { invoiceNo: { contains: q, mode: "insensitive" } }, { customer: { name: { contains: q, mode: "insensitive" } } },
      { customerName: { contains: q, mode: "insensitive" } }, { customerPhone: { contains: q } },
    ];
  }
  if (from || to) {
    where.createdAt = {};
    if (from) where.createdAt.gte = dateOnly(from);
    if (to) where.createdAt.lt = dateOnly(addDays(to, 1));
  }
  const [total, items] = await Promise.all([
    db.sale.count({ where }),
    db.sale.findMany({
      where, skip, take, orderBy: { createdAt: "desc" },
      include: { customer: { select: { name: true } }, user: { select: { name: true } }, _count: { select: { items: true, returns: true } } },
    }),
  ]);
  return { total, page, pageSize, items };
});

export const POST = route("pos.use", async ({ req, svc }) => {
  const input = saleSchema.parse(await readJson(req));
  const sale = await createSale(svc, { ...input, customerId: input.customerId || null });
  return { id: sale.id, invoiceNo: sale.invoiceNo, total: sale.total, amountPaid: sale.amountPaid, changeGiven: sale.changeGiven };
}, { idempotent: true });

export const dynamic = "force-dynamic";
