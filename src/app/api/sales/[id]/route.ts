import { route, AppError } from "@/lib/api";
import { can } from "@/modules/identity";

/** One invoice with its lines, what was already returned from each, and its returns. A cashier sees only their own. */
export const GET = route("sales.view", async ({ params, db, user }) => {
  const sale = await db.sale.findUnique({
    where: { id: params.id },
    include: {
      customer: { select: { id: true, name: true, phone: true, address: true } },
      user: { select: { name: true } },
      items: {
        include: { medicine: { select: { name: true, unit: true } }, batch: { select: { batchNumber: true, expiryDate: true } }, returns: { select: { quantity: true } } },
        orderBy: { id: "asc" },
      },
      returns: { orderBy: { createdAt: "asc" }, select: { id: true, number: true, total: true, refundMethod: true, createdAt: true, reason: true } },
    },
  });
  if (!sale || (sale.userId !== user.id && !can(user, "sales.viewAll"))) throw new AppError(404, "Invoice not found.");
  return { ...sale, items: sale.items.map(({ returns, ...i }) => ({ ...i, returnedQty: returns.reduce((n, r) => n + r.quantity, 0) })) };
});

export const dynamic = "force-dynamic";
