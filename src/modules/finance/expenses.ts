import { Prisma } from "@prisma/client";
import type { Tx } from "@/lib/prisma";
import { runInTx } from "@/lib/db";
import { AppError } from "@/lib/errors";
import { dateOnly, todayStr } from "@/lib/dates";
import { D } from "@/lib/money";
import { storeFile } from "@/lib/files";
import { sniffImage } from "@/lib/images";
import type { ServiceContext } from "@/modules/identity";
import { audit, nextNumber } from "@/modules/platform";

/**
 * Expenses (roadmap 8.1; data model, section 5): the running costs that turn gross profit into net
 * profit. Paying a supplier is not an expense (it settles a payable). Expenses are never deleted; a
 * mistake is cancelled with a reason, and cancelled expenses count nowhere. Cash taken from a drawer
 * is linked to that drawer's session.
 */
export const DEFAULT_CATEGORIES = ["Rent", "Salaries", "Electricity", "Gas and water", "Internet and phone", "Maintenance", "Transport", "Other"];

/** The pharmacy's categories, with the usual ones created the first time. */
export async function listCategories(ctx: ServiceContext) {
  return runInTx(ctx, async (tx) => {
    if (!(await tx.expenseCategory.count())) await tx.expenseCategory.createMany({ data: DEFAULT_CATEGORIES.map((name) => ({ name })), skipDuplicates: true });
    return tx.expenseCategory.findMany({ orderBy: { name: "asc" } });
  });
}

export async function saveCategory(ctx: ServiceContext, input: { id?: string | null; name: string; active?: boolean }) {
  return runInTx(ctx, async (tx) => {
    if (input.id && !(await tx.expenseCategory.findUnique({ where: { id: input.id }, select: { id: true } }))) throw new AppError(404, "Expense category not found.");
    const name = input.name.trim();
    const clash = await tx.expenseCategory.findFirst({ where: { name: { equals: name, mode: "insensitive" }, ...(input.id ? { id: { not: input.id } } : {}) } });
    if (clash) throw new AppError(409, `There is already a category called ${clash.name}.`, { fields: { name: "Already exists" } });
    const cat = input.id
      ? await tx.expenseCategory.update({ where: { id: input.id }, data: { name, ...(input.active !== undefined ? { active: input.active } : {}) } })
      : await tx.expenseCategory.create({ data: { name } });
    await audit(tx, ctx, { action: input.id ? "expenseCategory.update" : "expenseCategory.create", entity: "ExpenseCategory", entityId: cat.id, after: { name: cat.name, active: cat.active } });
    return cat;
  });
}

export type ExpenseInput = { categoryId: string; amount: number; date: string; method: "CASH" | "CARD"; description: string; fromDrawer?: boolean };

export async function createExpense(ctx: ServiceContext, input: ExpenseInput, receipt?: Buffer | null) {
  return runInTx(ctx, async (tx) => {
    const category = await tx.expenseCategory.findUnique({ where: { id: input.categoryId } });
    if (!category || !category.active) throw new AppError(404, "Expense category not found.");
    if (input.date > todayStr()) throw new AppError(400, "An expense cannot be dated in the future.");
    let cashSessionId: string | null = null;
    if (input.fromDrawer) {
      if (input.method !== "CASH") throw new AppError(400, "Only cash comes out of the drawer.");
      const session = await tx.cashSession.findFirst({ where: { userId: ctx.actor.id, status: "OPEN" }, select: { id: true } });
      if (!session) throw new AppError(409, "Open your cash drawer first, or record the expense as not paid from the drawer.");
      cashSessionId = session.id;
    }
    let receiptFileId: string | null = null;
    if (receipt?.length) {
      const info = sniffImage(receipt);
      if (!info) throw new AppError(400, "The receipt photo is not a JPEG, PNG or WebP picture.");
      receiptFileId = (await storeFile(tx, { purpose: "EXPENSE_RECEIPT", mime: info.mime, data: receipt, width: info.width, height: info.height, uploadedById: ctx.actor.id })).id;
    }
    const n = await nextNumber(tx, "EXPENSE");
    const number = `EXP-${input.date.replace(/-/g, "")}-${String(n).padStart(5, "0")}`;
    const expense = await tx.expense.create({
      data: {
        number, categoryId: category.id, amount: D(input.amount).toDecimalPlaces(2), date: dateOnly(input.date), method: input.method,
        description: input.description.trim(), receiptFileId, cashSessionId, userId: ctx.actor.id,
      },
    });
    await audit(tx, ctx, { action: "expense.create", entity: "Expense", entityId: expense.id, after: { number, category: category.name, amount: expense.amount, date: input.date, method: input.method, fromDrawer: !!cashSessionId } });
    return expense;
  });
}

export async function cancelExpense(ctx: ServiceContext, id: string, reason: string) {
  return runInTx(ctx, async (tx) => {
    const res = await tx.expense.updateMany({ where: { id, cancelledAt: null }, data: { cancelledAt: new Date(), cancelReason: reason } });
    if (!res.count) {
      if (!(await tx.expense.findUnique({ where: { id }, select: { id: true } }))) throw new AppError(404, "Expense not found.");
      throw new AppError(409, "This expense is already cancelled.");
    }
    const e = await tx.expense.findUniqueOrThrow({ where: { id } });
    await audit(tx, ctx, { action: "expense.cancel", entity: "Expense", entityId: id, before: { cancelled: false }, after: { cancelled: true, reason, amount: e.amount } });
    return e;
  });
}

export async function listExpenses(ctx: ServiceContext, filter: { from?: string; to?: string; categoryId?: string; includeCancelled?: boolean; page?: number }) {
  const page = Math.max(1, filter.page ?? 1);
  const where: Prisma.ExpenseWhereInput = {
    ...(filter.includeCancelled ? {} : { cancelledAt: null }),
    ...(filter.categoryId ? { categoryId: filter.categoryId } : {}),
    ...(filter.from || filter.to ? { date: { ...(filter.from ? { gte: dateOnly(filter.from) } : {}), ...(filter.to ? { lte: dateOnly(filter.to) } : {}) } } : {}),
  };
  return runInTx(ctx, async (tx) => {
    const [total, items, sum, byCategory] = await Promise.all([
      tx.expense.count({ where }),
      tx.expense.findMany({ where, orderBy: [{ date: "desc" }, { createdAt: "desc" }], skip: (page - 1) * 25, take: 25, include: { category: { select: { name: true } }, user: { select: { name: true } } } }),
      tx.expense.aggregate({ where: { ...where, cancelledAt: null }, _sum: { amount: true } }),
      tx.expense.groupBy({ by: ["categoryId"], where: { ...where, cancelledAt: null }, _sum: { amount: true } }),
    ]);
    const cats = await tx.expenseCategory.findMany({ where: { id: { in: byCategory.map((b) => b.categoryId) } }, select: { id: true, name: true } });
    return {
      total, page, pageSize: 25, items, sum: sum._sum.amount ?? D(0),
      byCategory: byCategory.map((b) => ({ category: cats.find((c) => c.id === b.categoryId)?.name ?? "", amount: b._sum.amount ?? D(0) })).sort((a, b) => Number(b.amount) - Number(a.amount)),
    };
  });
}

/** Expenses paid from a drawer, for its expected cash. */
export async function drawerExpenses(tx: Tx, sessionId: string) {
  return D((await tx.expense.aggregate({ where: { cashSessionId: sessionId, cancelledAt: null }, _sum: { amount: true } }))._sum.amount ?? 0);
}
