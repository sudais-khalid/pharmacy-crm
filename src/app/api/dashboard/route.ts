import { Prisma } from "@prisma/client";
import { route } from "@/lib/api";
import { getSettings } from "@/modules/platform";
import { todayStr, addDays, dateOnly } from "@/lib/dates";
import { localDate } from "@/lib/sql-dates";
import { can } from "@/modules/identity";
import { D } from "@/lib/money";

export const GET = route("dashboard.view", async ({ user, db }) => {
  const setting = await getSettings(db, user.pharmacyId);
  const today = todayStr();
  const warnTo = addDays(today, setting.expiryWarningDays);
  const full = can(user, "reports.view");

  const [todaySales, totalCustomers, totalMedicines, lowStock, expiringCount, expiredCount, expiringBatches, chart, top, money] = await Promise.all([
    db.$queryRaw<{ total: Prisma.Decimal; count: number; cogs: Prisma.Decimal }[]>`
      SELECT COALESCE(SUM(s.total),0) AS total, COUNT(*)::int AS count,
             COALESCE(SUM((SELECT SUM(i.quantity*i."costPrice") FROM "SaleItem" i WHERE i."saleId"=s.id)),0) AS cogs
      FROM "Sale" s WHERE s.status='COMPLETED' AND ${localDate(Prisma.sql`s."createdAt"`)} = ${today}::date`,
    db.customer.count({ where: { active: true } }),
    db.medicine.count({ where: { active: true } }),
    db.$queryRaw<{ id: string; name: string; minStock: number; stock: number; total: number }[]>`
      SELECT m.id, m.name, m."minStock", COALESCE(SUM(b.quantity) FILTER (WHERE b."expiryDate" >= ${today}::date),0)::int AS stock,
             COUNT(*) OVER ()::int AS total
      FROM "Medicine" m LEFT JOIN "Batch" b ON b."medicineId" = m.id
      WHERE m.active GROUP BY m.id
      HAVING COALESCE(SUM(b.quantity) FILTER (WHERE b."expiryDate" >= ${today}::date),0) <= m."minStock"
      ORDER BY stock ASC, m.name LIMIT 8`,
    db.batch.count({ where: { quantity: { gt: 0 }, expiryDate: { gte: dateOnly(today), lte: dateOnly(warnTo) } } }),
    db.batch.count({ where: { quantity: { gt: 0 }, expiryDate: { lt: dateOnly(today) } } }),
    db.batch.findMany({
      where: { quantity: { gt: 0 }, expiryDate: { lte: dateOnly(warnTo) } },
      orderBy: { expiryDate: "asc" }, take: 8, include: { medicine: { select: { name: true } } },
    }),
    db.$queryRaw<{ label: string; day: string; total: Prisma.Decimal; invoices: number }[]>`
      SELECT to_char(d, 'DD Mon') AS label, to_char(d, 'YYYY-MM-DD') AS day, COALESCE(SUM(s.total),0) AS total, COUNT(s.id)::int AS invoices
      FROM generate_series(${today}::date - 13, ${today}::date, '1 day'::interval) AS d
      LEFT JOIN "Sale" s ON ${localDate(Prisma.sql`s."createdAt"`)} = d::date AND s.status = 'COMPLETED'
      GROUP BY d ORDER BY d`,
    db.$queryRaw<{ name: string; qty: number; revenue: Prisma.Decimal }[]>`
      SELECT m.name, SUM(i.quantity)::int AS qty, SUM(i."lineTotal") AS revenue
      FROM "SaleItem" i JOIN "Sale" s ON s.id = i."saleId" JOIN "Medicine" m ON m.id = i."medicineId"
      WHERE s.status = 'COMPLETED' AND ${localDate(Prisma.sql`s."createdAt"`)} >= ${addDays(today, -29)}::date
      GROUP BY m.name ORDER BY qty DESC LIMIT 5`,
    full
      ? Promise.all([
          db.customerLedger.aggregate({ _sum: { debit: true, credit: true } }),
          db.supplierLedger.aggregate({ _sum: { debit: true, credit: true } }),
        ])
      : Promise.resolve(null),
  ]);

  const t = todaySales[0];
  return {
    today: { sales: t.total, invoices: t.count, profit: can(user, "cost.view") ? D(t.total).minus(t.cogs) : null },
    totalCustomers, totalMedicines,
    lowStockCount: lowStock[0]?.total ?? 0, lowStock,
    expiringCount, expiredCount, expiringBatches: expiringBatches.map((b) => ({ ...b, daysLeft: Math.round((b.expiryDate.getTime() - dateOnly(today).getTime()) / 86400000) })),
    warningDays: setting.expiryWarningDays,
    salesChart: chart,
    topMedicines: top,
    receivables: money ? D(money[0]._sum.debit ?? 0).minus(money[0]._sum.credit ?? 0) : null,
    payables: money ? D(money[1]._sum.debit ?? 0).minus(money[1]._sum.credit ?? 0) : null,
  };
});

export const dynamic = "force-dynamic";
