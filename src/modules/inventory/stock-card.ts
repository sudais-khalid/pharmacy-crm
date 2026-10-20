import { Prisma } from "@prisma/client";
import { runInTx } from "@/lib/db";
import { AppError } from "@/lib/errors";
import { localDate } from "@/lib/sql-dates";
import type { ServiceContext } from "@/modules/identity";

/**
 * Stock card (roadmap 6.5, requirement R2): for one medicine and a range of local days, the opening
 * balance, what came in and went out by movement type, every movement with a running balance, and the
 * closing balance. The opening is worked back from today's batch quantities, so the closing for a range
 * ending today always equals the stock on the shelf, whatever history came before movements were kept.
 */

const MAX_LINES = 2000;
type Line = { id: string; type: string; quantity: number; reference: string | null; note: string | null; createdAt: Date; batchNumber: string; userName: string | null };

export async function stockCard(ctx: ServiceContext, medicineId: string, range: { from: string; to: string }) {
  if (range.from > range.to) throw new AppError(400, "The start date must be before the end date.");
  return runInTx(ctx, async (tx) => {
    const medicine = await tx.medicine.findUnique({ where: { id: medicineId }, select: { id: true, name: true, unit: true } });
    if (!medicine) throw new AppError(404, "Medicine not found.");
    const created = Prisma.sql`m."createdAt"`;
    const [{ current }] = await tx.$queryRaw<{ current: bigint }[]>`SELECT COALESCE(SUM(quantity), 0) AS current FROM "Batch" WHERE "medicineId" = ${medicineId}`;
    const [{ since }] = await tx.$queryRaw<{ since: bigint }[]>`
      SELECT COALESCE(SUM(m.quantity), 0) AS since FROM "StockMovement" m WHERE m."medicineId" = ${medicineId} AND ${localDate(created)} >= ${range.from}::date`;
    const lines = await tx.$queryRaw<Line[]>`
      SELECT m.id, m.type::text AS type, m.quantity, m.reference, m.note, m."createdAt", b."batchNumber", u.name AS "userName"
      FROM "StockMovement" m JOIN "Batch" b ON b.id = m."batchId" LEFT JOIN "User" u ON u.id = m."userId"
      WHERE m."medicineId" = ${medicineId} AND ${localDate(created)} BETWEEN ${range.from}::date AND ${range.to}::date
      ORDER BY m."createdAt", m.id
      LIMIT ${MAX_LINES + 1}`;
    const truncated = lines.length > MAX_LINES;
    const [{ net }] = await tx.$queryRaw<{ net: bigint }[]>`
      SELECT COALESCE(SUM(m.quantity), 0) AS net FROM "StockMovement" m
      WHERE m."medicineId" = ${medicineId} AND ${localDate(created)} BETWEEN ${range.from}::date AND ${range.to}::date`;
    const totals = await tx.$queryRaw<{ type: string; inQty: bigint; outQty: bigint }[]>`
      SELECT m.type::text AS type, COALESCE(SUM(m.quantity) FILTER (WHERE m.quantity > 0), 0) AS "inQty", COALESCE(-SUM(m.quantity) FILTER (WHERE m.quantity < 0), 0) AS "outQty"
      FROM "StockMovement" m WHERE m."medicineId" = ${medicineId} AND ${localDate(created)} BETWEEN ${range.from}::date AND ${range.to}::date
      GROUP BY m.type ORDER BY m.type`;

    const opening = Number(current) - Number(since);
    let balance = opening;
    const rows = lines.slice(0, MAX_LINES).map((l) => {
      balance += l.quantity;
      return { ...l, balance };
    });
    const into = Object.fromEntries(totals.filter((t) => Number(t.inQty) > 0).map((t) => [t.type, Number(t.inQty)]));
    const outOf = Object.fromEntries(totals.filter((t) => Number(t.outQty) > 0).map((t) => [t.type, Number(t.outQty)]));
    return {
      medicine, from: range.from, to: range.to,
      opening, in: into, out: outOf,
      totalIn: Object.values(into).reduce((a, b) => a + b, 0), totalOut: Object.values(outOf).reduce((a, b) => a + b, 0),
      closing: opening + Number(net),
      lines: rows, truncated,
    };
  });
}
