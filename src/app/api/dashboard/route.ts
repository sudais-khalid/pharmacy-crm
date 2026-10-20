import { Prisma } from "@prisma/client";
import { route } from "@/lib/api";
import { getSettings } from "@/modules/platform";
import { todayStr, addDays, dateOnly } from "@/lib/dates";
import { localDate } from "@/lib/sql-dates";
import { can } from "@/modules/identity";
import { D } from "@/lib/money";
import { addFigures, dailyFigures, NO_FIGURES } from "@/modules/finance";

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

  // the owner's view (UI plan 4.4): month to date, a 30-day trend against the 30 days before, profit by category
  const owner = can(user, "finance.view") && can(user, "cost.view") ? await (async () => {
    const monthStart = `${today.slice(0, 8)}01`;
    const from60 = addDays(today, -59);
    const days = await dailyFigures(db, from60 < monthStart ? from60 : monthStart, today);
    const sum = (from: string, to: string) => [...days].filter(([d]) => d >= from && d <= to).map(([, f]) => f).reduce(addFigures, NO_FIGURES);
    const trend = Array.from({ length: 30 }, (_, i) => {
      const d = addDays(today, i - 29);
      return { day: d, label: d.slice(5), current: days.get(d)?.netSales ?? 0, previous: days.get(addDays(d, -30))?.netSales ?? 0 };
    });
    const [byCategory, cashDifferences, expenses] = await Promise.all([
      db.$queryRaw<{ category: string; sales: Prisma.Decimal; profit: Prisma.Decimal }[]>`
        SELECT COALESCE(c.name, 'No category') AS category,
               SUM(i."lineTotal" * CASE WHEN s.subtotal > 0 THEN s.total / s.subtotal ELSE 1 END) AS sales,
               SUM(i."lineTotal" * CASE WHEN s.subtotal > 0 THEN s.total / s.subtotal ELSE 1 END - i.quantity * i."costPrice") AS profit
        FROM "SaleItem" i JOIN "Sale" s ON s.id = i."saleId" JOIN "Medicine" m ON m.id = i."medicineId" LEFT JOIN "Category" c ON c.id = m."categoryId"
        WHERE s.status = 'COMPLETED' AND ${localDate(Prisma.sql`s."createdAt"`)} >= ${monthStart}::date GROUP BY 1 ORDER BY profit DESC LIMIT 8`,
      db.cashSession.findMany({ where: { status: "CLOSED", closedAt: { gte: dateOnly(addDays(today, -30)) }, NOT: { difference: 0 } }, orderBy: { closedAt: "desc" }, take: 6, include: { user: { select: { name: true } } } }),
      db.$queryRaw<{ category: string; amount: Prisma.Decimal }[]>`
        SELECT c.name AS category, SUM(e.amount) AS amount FROM "Expense" e JOIN "ExpenseCategory" c ON c.id = e."categoryId"
        WHERE e."cancelledAt" IS NULL AND e.date >= ${monthStart}::date GROUP BY c.name ORDER BY amount DESC`,
    ]);
    return {
      today: days.get(today) ?? NO_FIGURES, monthToDate: sum(monthStart, today),
      last30: sum(addDays(today, -29), today).netSales, previous30: sum(from60, addDays(today, -30)).netSales,
      trend, byCategory, expenses,
      cashDifferences: cashDifferences.map((x) => ({ id: x.id, user: x.user.name, closedAt: x.closedAt, difference: x.difference, note: x.note })),
    };
  })() : null;

  // the pharmacist's view: what needs doing in stock
  const ops = can(user, "inventory.view") ? await (async () => {
    const [toReview, ordersDue, orderStatus, adjustments] = await Promise.all([
      db.stockIntake.count({ where: { status: { in: ["NEEDS_REVIEW", "FAILED"] } } }),
      db.purchaseOrder.findMany({ where: { status: { in: ["SENT", "PARTIALLY_RECEIVED"] }, expectedDate: { lte: dateOnly(today) } }, orderBy: { expectedDate: "asc" }, take: 6, select: { id: true, number: true, expectedDate: true, supplier: { select: { name: true } } } }),
      db.purchaseOrder.groupBy({ by: ["status"], where: { status: { in: ["DRAFT", "SENT", "PARTIALLY_RECEIVED"] } }, _count: true }),
      db.stockMovement.findMany({ where: { type: { in: ["ADJUSTMENT", "DAMAGE", "EXPIRY", "SUPPLIER_RETURN"] } }, orderBy: { createdAt: "desc" }, take: 8, select: { id: true, type: true, quantity: true, createdAt: true, note: true, medicine: { select: { id: true, name: true } }, batch: { select: { batchNumber: true } }, user: { select: { name: true } } } }),
    ]);
    const alertTo = addDays(today, setting.expiryAlertDays);
    const expiringSoon = await db.batch.count({ where: { quantity: { gt: 0 }, setAsideAt: null, expiryDate: { gte: dateOnly(today), lte: dateOnly(alertTo) } } });
    return { toReview, ordersDue, orderStatus: Object.fromEntries(orderStatus.map((o) => [o.status, o._count])), adjustments, expiringSoon, alertDays: setting.expiryAlertDays };
  })() : null;

  const t = todaySales[0];
  return {
    owner, ops,
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
