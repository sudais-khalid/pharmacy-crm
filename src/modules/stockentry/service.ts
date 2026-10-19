import type { Prisma } from "@prisma/client";
import { runInTx } from "@/lib/db";
import { AppError } from "@/lib/errors";
import { addDays, dateOnly, todayStr } from "@/lib/dates";
import { D, ZERO } from "@/lib/money";
import type { Tx } from "@/lib/prisma";
import type { ServiceContext } from "@/modules/identity";
import { audit, emit, nextNumber } from "@/modules/platform";
import { createPurchase, purchaseLine } from "@/modules/procurement";
import { learnAlias, matchMedicine } from "./matching";
import type { IntakeDraftInput, IntakeLineInput } from "./schema";

/**
 * Stock entry (architecture, section 6.1): every way of bringing stock in produces a draft with lines,
 * reviewed on one grid and posted through the tested stock-in code: a supplier bill through
 * createPurchase, a stock list as opening batches. Posting, marking the draft posted and learning the
 * reviewer's matches happen in one transaction.
 */
const EDITABLE = ["DRAFT", "NEEDS_REVIEW", "FAILED"] as const;
const date = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : null);

export const intakeInclude = {
  supplier: { select: { id: true, name: true } },
  pages: { orderBy: { pageNo: "asc" as const }, select: { pageNo: true, fileId: true } },
  lines: { orderBy: { lineNo: "asc" as const }, include: { medicine: { select: { id: true, name: true, unit: true, salePrice: true, purchasePrice: true } } } },
  purchase: { select: { id: true, number: true } },
} satisfies Prisma.StockIntakeInclude;

export async function createIntake(ctx: ServiceContext, input: { kind: "PURCHASE_BILL" | "STOCK_LIST"; source: "MANUAL" | "IMPORT" | "OCR"; status?: "DRAFT" | "UPLOADED" }) {
  return runInTx(ctx, async (tx) => {
    const n = await nextNumber(tx, "STOCK_ENTRY");
    const number = `SE-${todayStr().replace(/-/g, "")}-${String(n).padStart(5, "0")}`;
    const intake = await tx.stockIntake.create({ data: { number, kind: input.kind, source: input.source, status: input.status ?? "DRAFT", createdById: ctx.actor.id } });
    await audit(tx, ctx, { action: "stockEntry.create", entity: "StockIntake", entityId: intake.id, after: { number, kind: input.kind, source: input.source } });
    return intake;
  });
}

export async function getIntake(ctx: ServiceContext, id: string) {
  return runInTx(ctx, async (tx) => {
    const intake = await tx.stockIntake.findUnique({ where: { id }, include: intakeInclude });
    if (!intake) throw new AppError(404, "Stock entry not found.");
    return { ...intake, checks: await checkIntake(tx, intake) };
  });
}

export async function listIntakes(ctx: ServiceContext, filter: { status?: "open" | "posted" | "all"; page?: number }) {
  const page = Math.max(1, filter.page ?? 1);
  const pageSize = 25;
  const where: Prisma.StockIntakeWhereInput =
    filter.status === "posted" ? { status: "POSTED" } : filter.status === "all" ? {} : { status: { notIn: ["POSTED", "DISCARDED"] } };
  return runInTx(ctx, async (tx) => {
    const [total, rows] = await Promise.all([
      tx.stockIntake.count({ where }),
      tx.stockIntake.findMany({
        where, orderBy: { createdAt: "desc" }, skip: (page - 1) * pageSize, take: pageSize,
        select: { id: true, number: true, kind: true, source: true, status: true, supplierInvoice: true, billTotal: true, createdAt: true, updatedAt: true, supplier: { select: { name: true } }, purchase: { select: { number: true } }, _count: { select: { lines: true, pages: true } } },
      }),
    ]);
    return { total, page, pageSize, items: rows };
  });
}

/** Saves the header and every line as they are on the grid (autosave). Lines are replaced as a whole. */
export async function saveDraft(ctx: ServiceContext, id: string, input: IntakeDraftInput) {
  return runInTx(ctx, async (tx) => {
    const intake = await tx.stockIntake.findUnique({ where: { id }, select: { status: true, kind: true } });
    if (!intake) throw new AppError(404, "Stock entry not found.");
    if (!(EDITABLE as readonly string[]).includes(intake.status)) throw new AppError(409, "This stock entry can no longer be changed.");
    if (input.supplierId && intake.kind === "PURCHASE_BILL") {
      const s = await tx.supplier.findUnique({ where: { id: input.supplierId }, select: { id: true } });
      if (!s) throw new AppError(404, "Supplier not found.");
    }
    await tx.stockIntakeLine.deleteMany({ where: { intakeId: id } });
    if (input.lines.length) {
      await tx.stockIntakeLine.createMany({
        data: input.lines.map((l, i) => ({
          intakeId: id, lineNo: i + 1, rawText: l.rawText, name: l.name, medicineId: l.medicineId, batchNumber: l.batchNumber,
          expiryDate: l.expiryDate ? dateOnly(l.expiryDate) : null, quantity: l.quantity, bonusQty: l.bonusQty, rate: l.rate, discountPercent: l.discountPercent,
          taxAmount: l.taxAmount, amount: l.amount, salePrice: l.salePrice, matchMethod: l.matchMethod, confidence: l.confidence,
          boxes: (l.boxes ?? undefined) as Prisma.InputJsonValue | undefined, ignored: l.ignored,
        })),
      });
    }
    const updated = await tx.stockIntake.update({
      where: { id },
      data: {
        supplierId: intake.kind === "PURCHASE_BILL" ? input.supplierId : null, supplierInvoice: input.supplierInvoice,
        billDate: input.billDate ? dateOnly(input.billDate) : null, billTotal: input.billTotal, billDiscount: input.billDiscount,
        paid: input.paid, paymentMethod: input.paymentMethod, note: input.note, updatedById: ctx.actor.id,
      },
      include: intakeInclude,
    });
    return { ...updated, checks: await checkIntake(tx, updated) };
  });
}

type FullIntake = Prisma.StockIntakeGetPayload<{ include: typeof intakeInclude }>;
export type IntakeIssue = { line: number | null; field: string; message: string };

/** Lines that take part (not removed by the reviewer, not completely empty). */
const activeLines = (i: FullIntake) => i.lines.filter((l) => !l.ignored && (l.medicineId || l.name || l.quantity !== null || l.batchNumber));

/**
 * The rules of architecture section 6.1.1. Errors block posting; warnings are shown but never block.
 * Totals: for a supplier bill with a bill total, the lines must add up to it (within 1.00) unless the
 * reviewer explains the difference in the note.
 */
export async function checkIntake(tx: Tx, intake: FullIntake) {
  const errors: IntakeIssue[] = [];
  const warnings: IntakeIssue[] = [];
  const today = todayStr();
  const soon = addDays(today, 90);
  const lines = activeLines(intake);
  const bill = intake.kind === "PURCHASE_BILL";
  if (bill && !intake.supplierId) errors.push({ line: null, field: "supplierId", message: "Choose the supplier." });
  if (!lines.length) errors.push({ line: null, field: "lines", message: "Add at least one line." });
  if (bill && intake.supplierId && intake.supplierInvoice) {
    const twice = await tx.purchase.findFirst({ where: { supplierId: intake.supplierId, supplierInvoice: intake.supplierInvoice }, select: { number: true } });
    if (twice) errors.push({ line: null, field: "supplierInvoice", message: `This invoice is already recorded as ${twice.number}.` });
  }
  let linesTotal = ZERO;
  for (const l of lines) {
    const n = l.lineNo;
    const expiry = date(l.expiryDate);
    if (!l.medicineId) errors.push({ line: n, field: "medicineId", message: `Line ${n}: choose the medicine${l.name ? ` for "${l.name}"` : ""}.` });
    if (!l.batchNumber) errors.push({ line: n, field: "batchNumber", message: `Line ${n}: the batch number is missing.` });
    if (!expiry) errors.push({ line: n, field: "expiryDate", message: `Line ${n}: the expiry date is missing.` });
    else if (expiry < today) errors.push({ line: n, field: "expiryDate", message: `Line ${n}: the expiry date has passed.` });
    else if (expiry <= soon) warnings.push({ line: n, field: "expiryDate", message: `Line ${n}: expires within 90 days (${expiry}).` });
    if (!l.quantity || l.quantity <= 0) errors.push({ line: n, field: "quantity", message: `Line ${n}: the quantity must be more than zero.` });
    if (bill && l.rate === null) errors.push({ line: n, field: "rate", message: `Line ${n}: the rate is missing.` });
    if (l.medicine && l.rate !== null && Number(l.medicine.purchasePrice) > 0) {
      const last = Number(l.medicine.purchasePrice);
      const diff = (Number(l.rate) - last) / last;
      if (Math.abs(diff) > 0.1) warnings.push({ line: n, field: "rate", message: `Line ${n}: rate ${Number(l.rate).toFixed(2)} is ${Math.round(Math.abs(diff) * 100)}% ${diff > 0 ? "above" : "below"} the last purchase (${last.toFixed(2)}).` });
    }
    if (l.quantity && l.quantity > 0 && l.rate !== null) {
      const calc = purchaseLine({ medicineId: "", batchNumber: "", expiryDate: "", quantity: l.quantity, bonusQty: l.bonusQty ?? 0, purchasePrice: Number(l.rate), discountPercent: Number(l.discountPercent ?? 0), taxAmount: Number(l.taxAmount ?? 0), salePrice: 0 });
      linesTotal = linesTotal.plus(calc.lineTotal);
      const sale = l.salePrice ?? l.medicine?.salePrice;
      if (sale !== null && sale !== undefined && D(sale).lt(calc.effectiveCost)) warnings.push({ line: n, field: "salePrice", message: `Line ${n}: the sale price is below cost (${calc.effectiveCost.toFixed(2)}).` });
      if (l.amount !== null && D(l.amount).minus(calc.lineTotal).abs().gt(1)) warnings.push({ line: n, field: "amount", message: `Line ${n}: the amount on the bill (${Number(l.amount).toFixed(2)}) differs from quantity times rate (${calc.lineTotal.toFixed(2)}).` });
    }
    if (bill && l.medicineId && l.batchNumber && intake.supplierId) {
      const other = await tx.purchaseItem.findFirst({ where: { medicineId: l.medicineId, batchNumber: l.batchNumber, purchase: { supplierId: { not: intake.supplierId } } }, select: { purchase: { select: { supplier: { select: { name: true } } } } } });
      if (other) warnings.push({ line: n, field: "batchNumber", message: `Line ${n}: batch ${l.batchNumber} was received from ${other.purchase.supplier.name} before.` });
    }
  }
  const total = linesTotal.minus(intake.billDiscount);
  if (bill && intake.billTotal !== null && total.minus(intake.billTotal).abs().gt(1)) {
    const msg = `Lines add up to ${total.toFixed(2)}, the bill says ${D(intake.billTotal).toFixed(2)}.`;
    if (intake.note) warnings.push({ line: null, field: "billTotal", message: `${msg} Reason: ${intake.note}` });
    else errors.push({ line: null, field: "billTotal", message: `${msg} Fix the lines, or explain the difference in the note.` });
  }
  return { errors, warnings, linesTotal: linesTotal.toFixed(2), total: total.toFixed(2) };
}

/** Fills empty medicine cells from the printed text (barcode, alias, similar name). */
export async function autoMatch(tx: Tx, intakeId: string, supplierId: string | null) {
  const lines = await tx.stockIntakeLine.findMany({ where: { intakeId, medicineId: null, ignored: false }, select: { id: true, name: true, rawText: true } });
  for (const l of lines) {
    const m = await matchMedicine(tx, l.name ?? l.rawText ?? "", supplierId);
    if (m) await tx.stockIntakeLine.update({ where: { id: l.id }, data: { medicineId: m.medicineId, matchMethod: m.method } });
  }
}

/** Posts the draft: a supplier bill as a purchase, a stock list as opening batches. */
export async function postIntake(ctx: ServiceContext, id: string) {
  return runInTx(ctx, async (tx) => {
    // the row lock makes a second, concurrent post wait and then see POSTED
    await tx.$queryRaw`SELECT 1 FROM "StockIntake" WHERE id = ${id} FOR UPDATE`;
    const intake = await tx.stockIntake.findUnique({ where: { id }, include: intakeInclude });
    if (!intake) throw new AppError(404, "Stock entry not found.");
    if (intake.status === "POSTED") throw new AppError(409, `Already posted${intake.purchase ? ` as ${intake.purchase.number}` : ""}.`);
    if (!(EDITABLE as readonly string[]).includes(intake.status)) throw new AppError(409, "This stock entry cannot be posted.");
    const checks = await checkIntake(tx, intake);
    if (checks.errors.length) throw new AppError(400, checks.errors[0].message, { details: { errors: checks.errors } });
    const lines = activeLines(intake);
    const svc = { ...ctx, tx };
    let reference = intake.number;

    if (intake.kind === "PURCHASE_BILL") {
      const purchase = await createPurchase(svc, {
        supplierId: intake.supplierId!, supplierInvoice: intake.supplierInvoice, purchaseDate: date(intake.billDate) ?? todayStr(),
        discount: Number(intake.billDiscount), paid: Number(intake.paid), paymentMethod: (intake.paymentMethod as "CASH" | "CARD" | null) ?? "CASH",
        note: intake.note ?? `Stock entry ${intake.number}`, intakeId: intake.id,
        items: lines.map((l) => ({
          medicineId: l.medicineId!, batchNumber: l.batchNumber!, expiryDate: date(l.expiryDate)!, quantity: l.quantity!, bonusQty: l.bonusQty ?? 0,
          purchasePrice: Number(l.rate), discountPercent: Number(l.discountPercent ?? 0), taxAmount: Number(l.taxAmount ?? 0),
          salePrice: Number(l.salePrice ?? l.medicine!.salePrice),
        })),
      });
      reference = purchase.number;
    } else {
      for (const l of lines) await openingStock(tx, ctx.actor.id, intake.number, l);
    }
    for (const l of lines) if (l.medicineId && (l.name || l.rawText) && l.matchMethod !== "BARCODE") await learnAlias(tx, ctx.pharmacyId, l.name ?? l.rawText!, intake.supplierId, l.medicineId);
    await tx.stockIntake.update({ where: { id }, data: { status: "POSTED", postedAt: new Date(), updatedById: ctx.actor.id } });
    await audit(tx, ctx, { action: "stockEntry.post", entity: "StockIntake", entityId: id, after: { number: intake.number, kind: intake.kind, reference, lines: lines.length } });
    await emit(tx, "StockEntryPosted", { intakeId: id, number: intake.number, reference, medicineIds: [...new Set(lines.map((l) => l.medicineId!))] });
    return { id, number: intake.number, reference };
  });
}

/** A stock list line: a new batch, or more of an existing one, with an OPENING movement. */
async function openingStock(tx: Tx, userId: string, reference: string, l: FullIntake["lines"][number]) {
  const expiry = date(l.expiryDate)!;
  const cost = l.rate !== null ? Number(l.rate) : Number(l.medicine!.purchasePrice);
  const sale = Number(l.salePrice ?? l.medicine!.salePrice);
  const units = l.quantity! + (l.bonusQty ?? 0);
  let batch = await tx.batch.findUnique({ where: { medicineId_batchNumber: { medicineId: l.medicineId!, batchNumber: l.batchNumber! } } });
  if (batch && date(batch.expiryDate) !== expiry) throw new AppError(409, `Batch ${l.batchNumber} of ${l.medicine!.name} already exists with a different expiry date.`);
  batch = batch
    ? await tx.batch.update({ where: { id: batch.id }, data: { quantity: { increment: units }, salePrice: sale } })
    : await tx.batch.create({ data: { medicineId: l.medicineId!, batchNumber: l.batchNumber!, expiryDate: dateOnly(expiry), quantity: units, purchasePrice: cost, salePrice: sale } });
  await tx.stockMovement.create({ data: { medicineId: l.medicineId!, batchId: batch.id, type: "OPENING", quantity: units, balanceAfter: batch.quantity, reference, note: "Opening stock", userId } });
}

export async function discardIntake(ctx: ServiceContext, id: string) {
  return runInTx(ctx, async (tx) => {
    const intake = await tx.stockIntake.findUnique({ where: { id }, select: { status: true, number: true } });
    if (!intake) throw new AppError(404, "Stock entry not found.");
    if (intake.status === "POSTED") throw new AppError(409, "A posted stock entry cannot be discarded.");
    await tx.stockIntake.update({ where: { id }, data: { status: "DISCARDED", updatedById: ctx.actor.id } });
    await audit(tx, ctx, { action: "stockEntry.discard", entity: "StockIntake", entityId: id, after: { number: intake.number } });
    return { ok: true };
  });
}

export type { IntakeDraftInput, IntakeLineInput };
