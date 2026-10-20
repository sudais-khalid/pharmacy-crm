import { Prisma } from "@prisma/client";
import type { Tx } from "@/lib/prisma";
import { runInTx, tenantTransaction } from "@/lib/db";
import { addDays, dateOnly, todayStr } from "@/lib/dates";
import { localDate } from "@/lib/sql-dates";
import type { ServiceContext } from "@/modules/identity";

/**
 * Daily money figures (roadmap 8.2, 8.6; architecture, section 6.5), by the pharmacy's local day:
 *
 *   net sales    = completed sales after invoice discounts, less customer refunds
 *   COGS         = cost of the exact batches sold, less the cost of returned items put back in stock
 *   gross profit = net sales - COGS
 *   stock losses = damage and expiry write-offs at batch cost (a damaged customer return is not counted
 *                  again: its cost stays in COGS)
 *   net profit   = gross profit - stock losses - expenses (cancelled expenses excluded)
 *
 * Cancelled sales count nowhere. The figures come from the source tables; DailySummary keeps a copy per
 * day for dashboards, refreshed by the report.rollup job and rebuildable from scratch.
 */
export type Figures = {
  grossSales: number; discounts: number; returns: number; netSales: number; cogs: number; grossProfit: number;
  stockLosses: number; expenses: number; netProfit: number; purchases: number; invoiceCount: number;
};
const ZERO: Figures = { grossSales: 0, discounts: 0, returns: 0, netSales: 0, cogs: 0, grossProfit: 0, stockLosses: 0, expenses: 0, netProfit: 0, purchases: 0, invoiceCount: 0 };
const r2 = (n: number) => Math.round(n * 100) / 100;

function finish(f: Omit<Figures, "netSales" | "grossProfit" | "netProfit">): Figures {
  const netSales = r2(f.grossSales - f.discounts - f.returns);
  const grossProfit = r2(netSales - f.cogs);
  return { ...f, netSales, grossProfit, netProfit: r2(grossProfit - f.stockLosses - f.expenses) };
}

export function addFigures(a: Figures, b: Figures): Figures {
  return finish({
    grossSales: r2(a.grossSales + b.grossSales), discounts: r2(a.discounts + b.discounts), returns: r2(a.returns + b.returns), cogs: r2(a.cogs + b.cogs),
    stockLosses: r2(a.stockLosses + b.stockLosses), expenses: r2(a.expenses + b.expenses), purchases: r2(a.purchases + b.purchases), invoiceCount: a.invoiceCount + b.invoiceCount,
  });
}

type Row = { d: string; v: Prisma.Decimal | number | bigint | null; n?: bigint | number | null };

/** Every day from `from` to `to` (inclusive), with its figures; days without activity are zero. */
export async function dailyFigures(tx: Tx, from: string, to: string): Promise<Map<string, Figures>> {
  const at = (col: Prisma.Sql) => localDate(col);
  const between = (col: Prisma.Sql) => Prisma.sql`${at(col)} BETWEEN ${from}::date AND ${to}::date`;
  const [sales, discounts, cogsSold, refunds, cogsBack, losses, expenses, purchases] = await Promise.all([
    tx.$queryRaw<Row[]>`SELECT ${at(Prisma.sql`s."createdAt"`)}::text AS d, SUM(s.subtotal) AS v, COUNT(*) AS n FROM "Sale" s WHERE s.status = 'COMPLETED' AND ${between(Prisma.sql`s."createdAt"`)} GROUP BY 1`,
    tx.$queryRaw<Row[]>`SELECT ${at(Prisma.sql`s."createdAt"`)}::text AS d, SUM(s.discount) AS v FROM "Sale" s WHERE s.status = 'COMPLETED' AND ${between(Prisma.sql`s."createdAt"`)} GROUP BY 1`,
    tx.$queryRaw<Row[]>`SELECT ${at(Prisma.sql`s."createdAt"`)}::text AS d, SUM(i.quantity * i."costPrice") AS v FROM "SaleItem" i JOIN "Sale" s ON s.id = i."saleId" WHERE s.status = 'COMPLETED' AND ${between(Prisma.sql`s."createdAt"`)} GROUP BY 1`,
    tx.$queryRaw<Row[]>`SELECT ${at(Prisma.sql`r."createdAt"`)}::text AS d, SUM(r.total) AS v FROM "SaleReturn" r WHERE ${between(Prisma.sql`r."createdAt"`)} GROUP BY 1`,
    tx.$queryRaw<Row[]>`SELECT ${at(Prisma.sql`r."createdAt"`)}::text AS d, SUM(i.quantity * i."costPrice") AS v FROM "SaleReturnItem" i JOIN "SaleReturn" r ON r.id = i."returnId" WHERE i.restock AND ${between(Prisma.sql`r."createdAt"`)} GROUP BY 1`,
    tx.$queryRaw<Row[]>`SELECT ${at(Prisma.sql`m."createdAt"`)}::text AS d, SUM(-m.quantity * b."purchasePrice") AS v FROM "StockMovement" m JOIN "Batch" b ON b.id = m."batchId"
      WHERE m.type IN ('DAMAGE', 'EXPIRY') AND (m.reference IS NULL OR m.reference NOT LIKE 'RET-%') AND ${between(Prisma.sql`m."createdAt"`)} GROUP BY 1`,
    tx.$queryRaw<Row[]>`SELECT e.date::text AS d, SUM(e.amount) AS v FROM "Expense" e WHERE e."cancelledAt" IS NULL AND e.date BETWEEN ${from}::date AND ${to}::date GROUP BY 1`,
    tx.$queryRaw<Row[]>`SELECT p."purchaseDate"::text AS d, SUM(p.total) AS v FROM "Purchase" p WHERE p."purchaseDate" BETWEEN ${from}::date AND ${to}::date GROUP BY 1`,
  ]);
  const days = new Map<string, Omit<Figures, "netSales" | "grossProfit" | "netProfit">>();
  for (let d = from; d <= to; d = addDays(d, 1)) days.set(d, { grossSales: 0, discounts: 0, returns: 0, cogs: 0, stockLosses: 0, expenses: 0, purchases: 0, invoiceCount: 0 });
  const put = (rows: Row[], apply: (f: Omit<Figures, "netSales" | "grossProfit" | "netProfit">, v: number, r: Row) => void) => {
    for (const r of rows) {
      const f = days.get(r.d.slice(0, 10));
      if (f) apply(f, r2(Number(r.v ?? 0)), r);
    }
  };
  put(sales, (f, v, r) => { f.grossSales += v; f.invoiceCount += Number(r.n ?? 0); });
  put(discounts, (f, v) => { f.discounts += v; });
  put(cogsSold, (f, v) => { f.cogs += v; });
  put(refunds, (f, v) => { f.returns += v; });
  put(cogsBack, (f, v) => { f.cogs = r2(f.cogs - v); });
  put(losses, (f, v) => { f.stockLosses += v; });
  put(expenses, (f, v) => { f.expenses += v; });
  put(purchases, (f, v) => { f.purchases += v; });
  return new Map([...days].map(([d, f]) => [d, finish(f)]));
}

/** Profit and loss by day or month, with totals: the months are exactly the sums of their days. */
export async function profitAndLoss(ctx: Pick<ServiceContext, "pharmacyId" | "tx">, range: { from: string; to: string; unit: "day" | "month" }) {
  return runInTx(ctx, async (tx) => {
    const days = await dailyFigures(tx, range.from, range.to);
    const periods = new Map<string, Figures>();
    for (const [d, f] of days) {
      const key = range.unit === "month" ? d.slice(0, 7) : d;
      periods.set(key, addFigures(periods.get(key) ?? ZERO, f));
    }
    const rows = [...periods].map(([period, f]) => ({ period, ...f }));
    const totals = [...days.values()].reduce(addFigures, ZERO);
    return { rows, totals };
  });
}

/** Totals for a range and for the same number of days just before it (sales comparisons, roadmap 8.4). */
export async function compareWithPrevious(ctx: Pick<ServiceContext, "pharmacyId" | "tx">, from: string, to: string) {
  const days = Math.round((dateOnly(to).getTime() - dateOnly(from).getTime()) / 86_400_000) + 1;
  const prevTo = addDays(from, -1);
  const prevFrom = addDays(prevTo, -(days - 1));
  return runInTx(ctx, async (tx) => {
    const [now, before] = await Promise.all([dailyFigures(tx, from, to), dailyFigures(tx, prevFrom, prevTo)]);
    return { current: [...now.values()].reduce(addFigures, ZERO), previous: [...before.values()].reduce(addFigures, ZERO), previousFrom: prevFrom, previousTo: prevTo };
  });
}

/** Writes the days' figures to DailySummary (report.rollup). */
export async function rollup(pharmacyId: string, from: string, to: string) {
  return tenantTransaction(pharmacyId, async (tx) => {
    const days = await dailyFigures(tx, from, to);
    for (const [d, f] of days) {
      const data = {
        grossSales: f.grossSales, discounts: f.discounts, returns: f.returns, netSales: f.netSales, cogs: f.cogs, stockLosses: f.stockLosses,
        expenses: f.expenses, purchases: f.purchases, invoiceCount: f.invoiceCount,
      };
      await tx.dailySummary.upsert({ where: { pharmacyId_date: { pharmacyId, date: dateOnly(d) } }, create: { date: dateOnly(d), ...data }, update: data });
    }
    return { days: days.size };
  });
}

/** Rebuilds every DailySummary row from the source tables, from the first day with any activity. */
export async function rebuildSummaries(pharmacyId: string, today = todayStr()) {
  const first = await tenantTransaction(pharmacyId, async (tx) => {
    const [row] = await tx.$queryRaw<{ d: string | null }[]>`
      SELECT LEAST(
        (SELECT MIN(${localDate(Prisma.sql`"createdAt"`)}) FROM "Sale"),
        (SELECT MIN("purchaseDate") FROM "Purchase"),
        (SELECT MIN(date) FROM "Expense"),
        (SELECT MIN(${localDate(Prisma.sql`"createdAt"`)}) FROM "StockMovement")
      )::text AS d`;
    await tx.dailySummary.deleteMany({});
    return row?.d?.slice(0, 10) ?? null;
  });
  if (!first) return { days: 0 };
  return rollup(pharmacyId, first, today);
}

/** Reads DailySummary for a range (dashboards). */
export async function summaryRange(tx: Tx, from: string, to: string) {
  const rows = await tx.dailySummary.findMany({ where: { date: { gte: dateOnly(from), lte: dateOnly(to) } }, orderBy: { date: "asc" } });
  return rows.map((r) => finish({
    grossSales: Number(r.grossSales), discounts: Number(r.discounts), returns: Number(r.returns), cogs: Number(r.cogs), stockLosses: Number(r.stockLosses),
    expenses: Number(r.expenses), purchases: Number(r.purchases), invoiceCount: r.invoiceCount,
  }));
}

export { ZERO as NO_FIGURES };
