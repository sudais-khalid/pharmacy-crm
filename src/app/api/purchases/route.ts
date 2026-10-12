import { Prisma } from "@prisma/client";
import { route, readJson, pageParams } from "@/lib/api";
import { prisma } from "@/lib/prisma";
import { purchaseSchema, createPurchase } from "@/modules/procurement";

export const GET = route("purchases.view", async ({ req }) => {
  const { page, pageSize, skip, take, sp } = pageParams(req);
  const q = sp.get("q")?.trim();
  const where: Prisma.PurchaseWhereInput = {};
  if (sp.get("supplierId")) where.supplierId = sp.get("supplierId")!;
  if (q) where.OR = [{ number: { contains: q, mode: "insensitive" } }, { supplierInvoice: { contains: q, mode: "insensitive" } }, { supplier: { name: { contains: q, mode: "insensitive" } } }];
  const [total, items] = await Promise.all([
    prisma.purchase.count({ where }),
    prisma.purchase.findMany({ where, skip, take, orderBy: { createdAt: "desc" }, include: { supplier: { select: { name: true } }, _count: { select: { items: true } } } }),
  ]);
  return { total, page, pageSize, items };
});

export const POST = route("purchases.create", async ({ req, user }) => createPurchase(purchaseSchema.parse(await readJson(req)), user.id));

export const dynamic = "force-dynamic";
