import { Prisma } from "@prisma/client";
import { route, readJson, pageParams } from "@/lib/api";
import { createCustomer, customerWithOpeningSchema } from "@/modules/customers";

export const GET = route("customers.view", async ({ req, db }) => {
  const { page, pageSize, skip, take, sp } = pageParams(req);
  const q = sp.get("q")?.trim();
  const where: Prisma.CustomerWhereInput = {};
  if (sp.get("active") === "1") where.active = true;
  if (q) where.OR = [{ name: { contains: q, mode: "insensitive" } }, { phone: { contains: q } }, { email: { contains: q, mode: "insensitive" } }];
  const [total, rows] = await Promise.all([
    db.customer.count({ where }),
    db.customer.findMany({ where, skip, take, orderBy: { name: "asc" } }),
  ]);
  const sums = await db.customerLedger.groupBy({ by: ["customerId"], where: { customerId: { in: rows.map((r) => r.id) } }, _sum: { debit: true, credit: true } });
  const bal = new Map(sums.map((s) => [s.customerId, new Prisma.Decimal(s._sum.debit ?? 0).minus(s._sum.credit ?? 0)]));
  return { total, page, pageSize, items: rows.map((r) => ({ ...r, balance: bal.get(r.id) ?? new Prisma.Decimal(0) })) };
});

export const POST = route("customers.manage", async ({ req, svc }) => createCustomer(svc, customerWithOpeningSchema.parse(await readJson(req))));

export const dynamic = "force-dynamic";
