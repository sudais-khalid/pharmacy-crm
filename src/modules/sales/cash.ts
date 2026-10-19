import { Prisma } from "@prisma/client";
import type { Tx } from "@/lib/prisma";
import { runInTx } from "@/lib/db";
import { AppError } from "@/lib/errors";
import { D } from "@/lib/money";
import { can, type ServiceContext } from "@/modules/identity";
import { audit, getSettings, notify } from "@/modules/platform";

/**
 * Cash drawer sessions (roadmap 5.3; data model, section 3.2). A cashier opens a session with the float in
 * the drawer, sales and cash refunds are linked to it, pay-ins and pay-outs are recorded, and at close the
 * counted cash is compared with what the drawer should hold:
 *
 *   expected = opening float + cash taken on sales - cash refunds + pay-ins - pay-outs
 *
 * "Cash taken on sales" is the amount paid on completed cash and credit sales (a credit sale's down payment
 * is cash); card sales never reach the drawer, and change given back is already netted out of amountPaid.
 */

export type SessionSummary = {
  openingFloat: number;
  cashSales: number;
  cardSales: number;
  creditSales: number;
  salesCount: number;
  cashRefunds: number;
  payIns: number;
  payOuts: number;
  expectedCash: number;
};

export async function sessionSummary(tx: Tx, sessionId: string): Promise<SessionSummary> {
  const session = await tx.cashSession.findUnique({ where: { id: sessionId }, select: { openingFloat: true } });
  if (!session) throw new AppError(404, "Cash session not found.");
  const [byMethod, refunds, moves] = await Promise.all([
    tx.sale.groupBy({ by: ["paymentMethod"], where: { cashSessionId: sessionId, status: "COMPLETED" }, _sum: { amountPaid: true, total: true }, _count: true }),
    tx.saleReturn.aggregate({ where: { cashSessionId: sessionId, refundMethod: "CASH" }, _sum: { total: true } }),
    tx.cashMovement.groupBy({ by: ["type"], where: { sessionId }, _sum: { amount: true } }),
  ]);
  const sum = (m: string, f: "amountPaid" | "total") => D(byMethod.find((r) => r.paymentMethod === m)?._sum[f] ?? 0);
  const cashSales = sum("CASH", "amountPaid").plus(sum("CREDIT", "amountPaid"));
  const cashRefunds = D(refunds._sum.total ?? 0);
  const payIns = D(moves.find((r) => r.type === "PAY_IN")?._sum.amount ?? 0);
  const payOuts = D(moves.find((r) => r.type === "PAY_OUT")?._sum.amount ?? 0);
  const expected = D(session.openingFloat).plus(cashSales).minus(cashRefunds).plus(payIns).minus(payOuts);
  return {
    openingFloat: Number(session.openingFloat),
    cashSales: Number(cashSales),
    cardSales: Number(sum("CARD", "total")),
    creditSales: Number(sum("CREDIT", "total").minus(sum("CREDIT", "amountPaid"))),
    salesCount: byMethod.reduce((n, r) => n + r._count, 0),
    cashRefunds: Number(cashRefunds),
    payIns: Number(payIns),
    payOuts: Number(payOuts),
    expectedCash: Number(expected.toDecimalPlaces(2)),
  };
}

/** The open session of a user, or null. */
export async function openSessionOf(tx: Tx, userId: string) {
  return tx.cashSession.findFirst({ where: { userId, status: "OPEN" } });
}

/**
 * The session a payment must be linked to. With cash sessions switched on and required, money cannot be
 * taken in cash without an open drawer; card and credit sales are linked when a drawer is open.
 */
export async function sessionForPayment(tx: Tx, ctx: ServiceContext, takesCash: boolean): Promise<string | null> {
  const settings = await getSettings(tx, ctx.pharmacyId);
  if (!settings.cashSessionsOn) return null;
  const session = await openSessionOf(tx, ctx.actor.id);
  if (!session && takesCash && settings.requireCashSession) throw new AppError(409, "Open your cash drawer first: cash cannot be taken without an open session.");
  return session?.id ?? null;
}

async function requireOn(tx: Tx, pharmacyId: string) {
  if (!(await getSettings(tx, pharmacyId)).cashSessionsOn) throw new AppError(409, "Cash drawer sessions are not switched on for this pharmacy.");
}

async function sessionFor(tx: Tx, ctx: ServiceContext, id: string) {
  const session = await tx.cashSession.findUnique({ where: { id } });
  // someone else's drawer is invisible without cash.manage
  if (!session || (session.userId !== ctx.actor.id && !can(ctx.actor, "cash.manage"))) throw new AppError(404, "Cash session not found.");
  return session;
}

export async function openSession(ctx: ServiceContext, input: { openingFloat: number }) {
  return runInTx(ctx, async (tx) => {
    await requireOn(tx, ctx.pharmacyId);
    if (await openSessionOf(tx, ctx.actor.id)) throw new AppError(409, "Your cash drawer is already open.");
    try {
      const session = await tx.cashSession.create({ data: { userId: ctx.actor.id, openingFloat: D(input.openingFloat).toDecimalPlaces(2) } });
      await audit(tx, ctx, { action: "cash.open", entity: "CashSession", entityId: session.id, after: { openingFloat: session.openingFloat } });
      return session;
    } catch (e) {
      // two tabs opening at once: the partial unique index keeps one open drawer per person
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") throw new AppError(409, "Your cash drawer is already open.");
      throw e;
    }
  });
}

export async function addCashMovement(ctx: ServiceContext, sessionId: string, input: { type: "PAY_IN" | "PAY_OUT"; amount: number; reason: string }) {
  return runInTx(ctx, async (tx) => {
    const session = await sessionFor(tx, ctx, sessionId);
    if (session.status !== "OPEN") throw new AppError(409, "This cash session is closed.");
    const amount = D(input.amount).toDecimalPlaces(2);
    if (input.type === "PAY_OUT") {
      const { expectedCash } = await sessionSummary(tx, sessionId);
      if (amount.gt(expectedCash)) throw new AppError(409, `The drawer should only hold ${expectedCash.toFixed(2)}.`);
    }
    const m = await tx.cashMovement.create({ data: { sessionId, type: input.type, amount, reason: input.reason, userId: ctx.actor.id } });
    await audit(tx, ctx, { action: input.type === "PAY_IN" ? "cash.payIn" : "cash.payOut", entity: "CashSession", entityId: sessionId, after: { amount, reason: input.reason } });
    return m;
  });
}

/** Closes a drawer with the counted cash. A difference above the pharmacy's threshold needs a note and tells the managers. */
export async function closeSession(ctx: ServiceContext, sessionId: string, input: { countedCash: number; note?: string | null }) {
  return runInTx(ctx, async (tx) => {
    const session = await sessionFor(tx, ctx, sessionId);
    if (session.status !== "OPEN") throw new AppError(409, "This cash session is already closed.");
    const summary = await sessionSummary(tx, sessionId);
    const counted = D(input.countedCash).toDecimalPlaces(2);
    const difference = counted.minus(summary.expectedCash);
    const settings = await getSettings(tx, ctx.pharmacyId);
    const large = difference.abs().gt(settings.cashDiffThreshold);
    if (large && !input.note?.trim()) throw new AppError(400, `The drawer is ${difference.isNeg() ? "short" : "over"} by ${difference.abs().toFixed(2)}. Add a note to close it.`);
    const closed = await tx.cashSession.update({
      where: { id: sessionId },
      data: { status: "CLOSED", closedAt: new Date(), expectedCash: summary.expectedCash, countedCash: counted, difference, note: input.note?.trim() || null, closedById: ctx.actor.id },
      include: { user: { select: { name: true } } },
    });
    await audit(tx, ctx, { action: "cash.close", entity: "CashSession", entityId: sessionId, before: { status: "OPEN" }, after: { expectedCash: summary.expectedCash, countedCash: counted, difference, note: closed.note } });
    if (large) {
      await notify(tx, ctx.pharmacyId, {
        type: "CASH_DIFFERENCE", severity: "WARNING", audiencePermission: "cash.manage", dedupeKey: `cash-diff:${sessionId}`, link: `/cash/${sessionId}`,
        title: `${closed.user.name}'s drawer closed ${difference.isNeg() ? "short" : "over"} by ${difference.abs().toFixed(2)}`,
        body: closed.note ?? "",
      });
    }
    return { ...closed, summary };
  });
}

export async function getSession(ctx: ServiceContext, id: string) {
  return runInTx(ctx, async (tx) => {
    const session = await sessionFor(tx, ctx, id);
    const [summary, movements, user, closedBy] = await Promise.all([
      sessionSummary(tx, id),
      tx.cashMovement.findMany({ where: { sessionId: id }, orderBy: { createdAt: "asc" }, include: { user: { select: { name: true } } } }),
      tx.user.findUnique({ where: { id: session.userId }, select: { name: true } }),
      session.closedById ? tx.user.findUnique({ where: { id: session.closedById }, select: { name: true } }) : null,
    ]);
    return { ...session, user, closedBy, summary, movements };
  });
}

/** The caller's open session with its running totals, or null. */
export async function mySession(ctx: ServiceContext) {
  return runInTx(ctx, async (tx) => {
    const settings = await getSettings(tx, ctx.pharmacyId);
    const session = settings.cashSessionsOn ? await openSessionOf(tx, ctx.actor.id) : null;
    return {
      enabled: settings.cashSessionsOn,
      required: settings.cashSessionsOn && settings.requireCashSession,
      session: session ? { ...session, summary: await sessionSummary(tx, session.id) } : null,
    };
  });
}

/** Sessions, newest first: everyone's with cash.manage, otherwise the caller's own. */
export async function listSessions(ctx: ServiceContext, filter: { status?: "OPEN" | "CLOSED"; page?: number }) {
  const page = Math.max(1, filter.page ?? 1);
  const pageSize = 25;
  const where: Prisma.CashSessionWhereInput = {
    ...(can(ctx.actor, "cash.manage") ? {} : { userId: ctx.actor.id }),
    ...(filter.status ? { status: filter.status } : {}),
  };
  return runInTx(ctx, async (tx) => {
    const [total, rows] = await Promise.all([
      tx.cashSession.count({ where }),
      tx.cashSession.findMany({ where, orderBy: { openedAt: "desc" }, skip: (page - 1) * pageSize, take: pageSize, include: { user: { select: { name: true } } } }),
    ]);
    const items = await Promise.all(rows.map(async (r) => ({ ...r, expectedCash: r.expectedCash ?? (await sessionSummary(tx, r.id)).expectedCash })));
    return { total, page, pageSize, items };
  });
}

