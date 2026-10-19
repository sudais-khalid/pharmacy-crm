import { route, pageParams, AppError } from "@/lib/api";
import { can } from "@/modules/identity";

/** Who bought a medicine, when, how many and at what price, newest first; returns are shown on each line. A cashier sees their own invoices only. */
export const GET = route("medicines.view", async ({ req, params, db, user }) => {
  const { page, pageSize, skip, take } = pageParams(req, 25);
  const medicine = await db.medicine.findUnique({ where: { id: params.id }, select: { id: true, name: true } });
  if (!medicine) throw new AppError(404, "Medicine not found.");
  const where = { medicineId: medicine.id, sale: can(user, "sales.viewAll") ? {} : { userId: user.id } };
  const [total, rows, sold] = await Promise.all([
    db.saleItem.count({ where }),
    db.saleItem.findMany({
      where, skip, take, orderBy: { sale: { createdAt: "desc" } },
      select: {
        id: true, quantity: true, unitPrice: true, lineTotal: true, costPrice: true,
        batch: { select: { batchNumber: true } }, returns: { select: { quantity: true } },
        sale: { select: { id: true, invoiceNo: true, createdAt: true, status: true, customerName: true, customer: { select: { name: true } }, user: { select: { name: true } } } },
      },
    }),
    db.saleItem.aggregate({ where: { ...where, sale: { ...where.sale, status: "COMPLETED" } }, _sum: { quantity: true, lineTotal: true } }),
  ]);
  return {
    medicine, total, page, pageSize,
    soldQty: sold._sum.quantity ?? 0, soldValue: sold._sum.lineTotal ?? 0,
    items: rows.map(({ returns, ...r }) => ({ ...r, returnedQty: returns.reduce((n, x) => n + x.quantity, 0) })),
  };
});

export const dynamic = "force-dynamic";
