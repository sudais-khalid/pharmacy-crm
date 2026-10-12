import { Prisma } from "@prisma/client";
import { route, readJson, pageParams } from "@/lib/api";
import { prisma } from "@/lib/prisma";
import { saleSchema, createSale } from "@/modules/sales";
import { dateOnly, addDays } from "@/lib/dates";

export const GET = route("sales.view", async ({ req }) => {
  const { page, pageSize, skip, take, sp } = pageParams(req);
  const q = sp.get("q")?.trim();
  const status = sp.get("status");
  const from = sp.get("from");
  const to = sp.get("to");
  const where: Prisma.SaleWhereInput = {};
  if (status === "COMPLETED" || status === "CANCELLED") where.status = status;
  if (q) where.OR = [{ invoiceNo: { contains: q, mode: "insensitive" } }, { customer: { name: { contains: q, mode: "insensitive" } } }];
  if (from || to) {
    where.createdAt = {};
    if (from) where.createdAt.gte = dateOnly(from);
    if (to) where.createdAt.lt = dateOnly(addDays(to, 1));
  }
  const [total, items] = await Promise.all([
    prisma.sale.count({ where }),
    prisma.sale.findMany({
      where, skip, take, orderBy: { createdAt: "desc" },
      include: { customer: { select: { name: true } }, user: { select: { name: true } }, _count: { select: { items: true } } },
    }),
  ]);
  return { total, page, pageSize, items };
});

export const POST = route("pos.use", async ({ req, user }) => {
  const input = saleSchema.parse(await readJson(req));
  const sale = await createSale({ ...input, customerId: input.customerId || null }, user);
  return { id: sale.id, invoiceNo: sale.invoiceNo, total: sale.total, amountPaid: sale.amountPaid };
});

export const dynamic = "force-dynamic";
